/**
 * Validación contra un proyecto Supabase REAL (roomly-validation-3, Fase 3).
 * Matriz: PR1–PR12, CH1–CH11, RO1–RO9, RE1–RE9, CRA1–CRA6 (Fase 3.1),
 * SVC1–SVC5 y GC1–GC4 (servicios del servidor), AU2 — ver
 * docs/SUPABASE_VALIDATION.md.
 *
 * Reglas de esta suite:
 *   - Toda aserción de autorización usa un cliente propio con el JWT real
 *     del usuario (signInWithPassword) o sin sesión (anon).
 *   - service_role solo prepara datos, limpia datos, y ejecuta las
 *     operaciones de servidor explícitamente autorizadas (PR11, RO7). En SVC
 *     y GC se inyecta (`deps.adminClient`) en los dos servicios que lo usan
 *     en el servidor, lib/services/{compatibility,matching}.ts, como hace la
 *     app; la sesión de esos servicios es siempre el JWT real del usuario.
 *     D6 = B no cambia: este proceso es el runner, nunca la app ni el
 *     navegador.
 *   - Nunca se imprime ninguna variable de entorno, clave ni contraseña.
 *   - Se niega a ejecutarse si la URL no es la del proyecto de validación.
 *
 * NO forma parte de `npm run test`: se ejecuta con `npm run test:supabase`
 * desde el workflow manual .github/workflows/supabase-validation.yml.
 */
import {
  createClient,
  type PostgrestError,
  type SupabaseClient,
} from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { appendFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  CURRENT_QUESTIONNAIRE_VERSION,
  QUESTIONNAIRE_V1,
  QUESTIONNAIRE_V2,
} from "@/lib/matching/questionnaire";
import type { Question, Questionnaire } from "@/lib/matching/types";
import {
  getOwnQuestionnaire,
  saveQuestionnaireAnswers,
} from "@/lib/services/compatibility";
import {
  CANDIDATE_SELECT,
  getCandidates,
  type CandidateDTO,
} from "@/lib/services/matching";
import type { DbClient } from "@/lib/services/result";
import { createTestUser } from "./test-users";

// ---------------------------------------------------------------------------
// Entorno y guardas de destino
// ---------------------------------------------------------------------------
const REQUIRED_ENV = [
  "SUPABASE_VALIDATION_URL",
  "SUPABASE_VALIDATION_ANON_KEY",
  "SUPABASE_VALIDATION_SERVICE_ROLE_KEY",
  "SUPABASE_VALIDATION_PROJECT_REF",
  "SUPABASE_VALIDATION_DB_URL",
] as const;

function readEnv() {
  const missing = REQUIRED_ENV.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    // Solo nombres, nunca valores.
    throw new Error(`Faltan variables de entorno: ${missing.join(", ")}`);
  }
  const url = process.env.SUPABASE_VALIDATION_URL!;
  const ref = process.env.SUPABASE_VALIDATION_PROJECT_REF!;
  if (new URL(url).hostname !== `${ref}.supabase.co`) {
    throw new Error(
      "SUPABASE_VALIDATION_URL no corresponde al project ref de validación"
    );
  }
  return {
    url,
    anonKey: process.env.SUPABASE_VALIDATION_ANON_KEY!,
    serviceKey: process.env.SUPABASE_VALIDATION_SERVICE_ROLE_KEY!,
  };
}

/**
 * F1 — Identidad verificada DESDE EL PROPIO PROYECTO antes de crear o borrar
 * nada: ejecuta tests/supabase/guard.sh (la misma guarda que usan los
 * scripts SQL), que exige la marca `COMMENT ON DATABASE postgres IS
 * 'roomly-validation-3'` en la base de datos a la que apuntan los secrets
 * (las marcas de los proyectos de validación anteriores, Fases 1 y 2.8, no
 * pasan).
 * Sin fallback: cualquier fallo aborta la suite. El mensaje propagado es
 * solo el de la guarda, que nunca incluye valores de variables.
 */
function verifyValidationProjectIdentity() {
  const guard = path.join(process.cwd(), "tests/supabase/guard.sh");
  try {
    execFileSync(
      "bash",
      [
        guard,
        "SUPABASE_VALIDATION_URL",
        "SUPABASE_VALIDATION_ANON_KEY",
        "SUPABASE_VALIDATION_SERVICE_ROLE_KEY",
      ],
      { stdio: ["ignore", "pipe", "pipe"], env: process.env }
    );
  } catch (err) {
    const stderr = (err as { stderr?: Buffer }).stderr?.toString().trim();
    throw new Error(
      `Destino NO reconocido como roomly-validation-3; la suite no se ejecuta.\n${stderr ?? ""}`
    );
  }
}

const env = readEnv();
const CLIENT_OPTIONS = {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
};

// Sin tipos de Database a propósito: la suite necesita enviar columnas que
// los tipos (correctamente) no permiten, para demostrar que la BD las rechaza.
type Client = SupabaseClient;

const service: Client = createClient(env.url, env.serviceKey, CLIENT_OPTIONS);
const anon: Client = createClient(env.url, env.anonKey, CLIENT_OPTIONS);

const RUN = randomBytes(4).toString("hex");
const RESULTS: string[] = [];

/**
 * F2 — Formato EXACTO de los emails de prueba. La limpieza solo puede tocar
 * usuarios cuyo email encaje entero en este patrón (prefijo, id de 8
 * hexadecimales, actor de una letra y dominio example.com exacto).
 */
const TEST_EMAIL = /^roomly-val-[0-9a-f]{8}-[a-z]@example\.com$/;
const testEmail = (key: string) => `roomly-val-${RUN}-${key}@example.com`;

function record(line: string) {
  RESULTS.push(line);
  console.log(line);
}

// ---------------------------------------------------------------------------
// Actores: A, B, C (chat), O (propietario), R (denunciante), T (denunciado), D (admin),
// S (SVC1–SVC3 y SVC5), U (SVC4: de la v1 a la v2), V (quien mira en GC)
// ---------------------------------------------------------------------------
type Actor = { key: string; id: string; email: string; client: Client };
const actors: Record<string, Actor> = {};
const ACTOR_KEYS = ["a", "b", "c", "o", "r", "t", "d", "s", "u", "v"] as const;
const A = () => actors.a;
const B = () => actors.b;
const C = () => actors.c;
const O = () => actors.o;
const R = () => actors.r;
const T = () => actors.t;
const D = () => actors.d;
const S = () => actors.s;
const U = () => actors.u;
const V = () => actors.v;

/**
 * Todos los usuarios de prueba creados por ESTE run: los actores con sesión y
 * los candidatos de GC, que no inician sesión (así no se piden más tokens a
 * Auth de los necesarios). `createTestUser` apunta cada id aquí nada más
 * crearlo, antes de iniciar sesión o de cualquier otro paso, y el teardown
 * borra exactamente estos ids (más los restos de runs anteriores, F2). Un Set:
 * ningún id se intenta borrar dos veces.
 */
const testUserIds = new Set<string>();

const conv1 = randomUUID();
const conv2 = randomUUID();
const roomId = randomUUID();
let cityId = "";
let reportId = "";

/** F3 — Conversaciones creadas por ESTA ejecución: las únicas que se borran. */
const createdConversationIds = new Set<string>();
/** Se pone a true solo cuando la guarda F1 ha pasado. Sin ella, no se limpia nada. */
let identityVerified = false;

// ---------------------------------------------------------------------------
// Helpers de aserción
// ---------------------------------------------------------------------------
function expectPgError(error: PostgrestError | null, code: string) {
  expect(error, `se esperaba el error ${code}`).not.toBeNull();
  expect(error?.code).toBe(code);
}

/**
 * F5 — Rechazo que procede del trigger de moderación de rooms (H5): SQLSTATE
 * 42501 Y el mensaje propio del trigger (`room_moderation: ...`, definido en
 * la migración 20260926120000). PostgREST devuelve el mensaje de Postgres
 * tal cual en `message`; si alguna vez llegara distinto, el test falla de
 * forma visible (nunca pasa en falso).
 */
function expectModerationRejection(error: PostgrestError | null) {
  expectPgError(error, "42501");
  expect(error?.message, "el rechazo debe venir del trigger de moderación").toMatch(
    /^room_moderation:/
  );
}

/** F4 — Éxito es exactamente `error === null`; cualquier error falla el test. */
function expectOk(error: PostgrestError | null) {
  expect(
    error,
    error ? `error inesperado: ${error.code} ${error.message}` : undefined
  ).toBeNull();
}

// ---------------------------------------------------------------------------
// Limpieza respetando H6: primero dependencias, después usuarios.
// Solo toca datos creados por usuarios de prueba (F2) y conversaciones
// creadas por la suite (F3). Si algo de un usuario de prueba está enlazado
// con datos ajenos, NO se borra: el teardown falla de forma visible.
// ---------------------------------------------------------------------------
async function teardownUsers(userIds: string[], conversationIds: string[]) {
  if (userIds.length === 0 && conversationIds.length === 0) return;
  const failures: string[] = [];
  const step = async (
    label: string,
    run: () => PromiseLike<{ error: PostgrestError | null }>
  ) => {
    const { error } = await run();
    if (error) failures.push(`${label}: ${error.code} ${error.message}`);
  };

  if (conversationIds.length > 0) {
    await step("messages", () =>
      service.from("messages").delete().in("conversation_id", conversationIds)
    );
    await step("conversation_participants", () =>
      service
        .from("conversation_participants")
        .delete()
        .in("conversation_id", conversationIds)
    );
    await step("conversations", () =>
      service.from("conversations").delete().in("id", conversationIds)
    );
  }

  if (userIds.length > 0) {
    // Solo filas CREADAS por usuarios de prueba (quien las crea es de prueba).
    await step("reports", () =>
      service.from("reports").delete().in("reporter_id", userIds)
    );
    await step("admin_action_logs", () =>
      service.from("admin_action_logs").delete().in("admin_id", userIds)
    );
    await step("interests", () =>
      service.from("interests").delete().in("from_user_id", userIds)
    );
    await step("matches", () =>
      service.from("matches").delete().in("user_a_id", userIds).in("user_b_id", userIds)
    );
    // rooms → room_addresses/room_images/favorites caen en cascada.
    await step("rooms", () => service.from("rooms").delete().in("owner_id", userIds));
    await step("profiles", () => service.from("profiles").delete().in("id", userIds));

    for (const id of userIds) {
      const { error } = await service.auth.admin.deleteUser(id);
      if (error) failures.push(`deleteUser: ${error.message}`);
    }

    // Comprobación final: ni perfiles ni lo que cae en cascada desde ellos
    // (preferencias y test de SVC/GC). Solo cuenta las filas de estos
    // usuarios de prueba; si queda alguna, el teardown falla de forma visible.
    for (const [table, column] of [
      ["profiles", "id"],
      ["housing_preferences", "profile_id"],
      ["compatibility_responses", "profile_id"],
    ] as const) {
      const { count, error } = await service
        .from(table)
        .select(column, { count: "exact", head: true })
        .in(column, userIds);
      if (error)
        failures.push(`comprobación de ${table}: ${error.code} ${error.message}`);
      else if (count !== 0)
        failures.push(`quedan ${count} filas de ${table} de usuarios de prueba`);
    }
  }

  if (failures.length > 0) {
    throw new Error(`Teardown incompleto:\n  ${failures.join("\n  ")}`);
  }
}

/** F2 — Usuarios de ejecuciones anteriores: solo emails con el formato exacto. */
async function staleValidationUserIds(): Promise<string[]> {
  const { data, error } = await service.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw new Error(`listUsers: ${error.message}`);
  return data.users.filter((u) => TEST_EMAIL.test(u.email ?? "")).map((u) => u.id);
}

/**
 * F3 — Conversaciones que dejó una ejecución anterior interrumpida: solo las
 * que tienen EXCLUSIVAMENTE participantes de prueba. Una conversación con
 * cualquier participante ajeno nunca se toca.
 */
async function staleValidationConversationIds(userIds: string[]): Promise<string[]> {
  if (userIds.length === 0) return [];
  const testUsers = new Set(userIds);
  const { data: mine, error } = await service
    .from("conversation_participants")
    .select("conversation_id")
    .in("user_id", userIds);
  if (error) throw new Error(`participants: ${error.message}`);
  const candidates = [...new Set((mine ?? []).map((p) => p.conversation_id as string))];
  if (candidates.length === 0) return [];

  const { data: all, error: allError } = await service
    .from("conversation_participants")
    .select("conversation_id, user_id")
    .in("conversation_id", candidates);
  if (allError) throw new Error(`participants: ${allError.message}`);
  return candidates.filter((id) =>
    (all ?? [])
      .filter((p) => p.conversation_id === id)
      .every((p) => testUsers.has(p.user_id as string))
  );
}

// ---------------------------------------------------------------------------
// Preparación (service_role) y sesiones reales (JWT de cada usuario)
// ---------------------------------------------------------------------------
beforeAll(async () => {
  // F1: lo PRIMERO. Si falla, no se crea ni se borra nada.
  verifyValidationProjectIdentity();
  identityVerified = true;

  // Restos de ejecuciones anteriores interrumpidas (F2 + F3).
  const staleUsers = await staleValidationUserIds();
  await teardownUsers(staleUsers, await staleValidationConversationIds(staleUsers));

  for (const key of ACTOR_KEYS) {
    const email = testEmail(key);
    if (!TEST_EMAIL.test(email)) throw new Error("formato de email de prueba inválido");
    const password = randomBytes(24).toString("base64url"); // nunca se imprime
    const client = createClient(env.url, env.anonKey, CLIENT_OPTIONS);
    // El id queda en `testUserIds` antes de iniciar sesión: si el login falla
    // (p. ej. por un límite de Auth), el teardown de este run lo borra.
    const id = await createTestUser({
      key,
      email,
      password,
      admin: service.auth.admin,
      registry: testUserIds,
      signIn: (credentials) => client.auth.signInWithPassword(credentials),
    });
    actors[key] = { key, id, email, client };
  }

  // Perfiles de todos salvo A (A crea el suyo en PR4, como haría el producto).
  const { error: profilesError } = await service.from("profiles").insert(
    ACTOR_KEYS.filter((k) => k !== "a").map((k) => ({
      id: actors[k].id,
      full_name: `Validación ${k.toUpperCase()}`,
      date_of_birth: "2000-01-01",
      // Sin DEFAULT desde la Fase 2.3: siempre se envía explícitamente.
      seeking_status: "looking_for_room",
    }))
  );
  if (profilesError) throw new Error(`profiles: ${profilesError.message}`);

  const { data: city, error: cityError } = await service
    .from("cities")
    .select("id")
    .eq("slug", "barcelona")
    .single();
  if (cityError || !city) throw new Error(`cities: ${cityError?.message}`);
  cityId = city.id;
}, 120_000);

afterAll(async () => {
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary && RESULTS.length > 0) {
    appendFileSync(
      summary,
      `\n### Resultados registrados (supabase-js)\n\n${RESULTS.map((r) => `- ${r}`).join("\n")}\n`
    );
  }
  // Sin identidad verificada no se ha creado nada y no se toca nada.
  if (!identityVerified) return;
  // Cada actor está en `testUserIds` desde que se creó, haya iniciado sesión o no.
  await teardownUsers([...testUserIds], [...createdConversationIds]);
}, 120_000);

// ===========================================================================
// PROFILES
// ===========================================================================
describe("Profiles (PR)", () => {
  const baseProfile = () => ({
    id: A().id,
    full_name: "Validación A",
    date_of_birth: "2000-01-01",
    seeking_status: "looking_for_room",
  });

  it("PR1: un usuario no puede crear su propio perfil con role=admin", async () => {
    const { error } = await A()
      .client.from("profiles")
      .insert({ ...baseProfile(), role: "admin" });
    expectPgError(error, "42501");
  });

  it("PR2: un usuario no puede fijar deleted_at al crear su perfil", async () => {
    const { error } = await A()
      .client.from("profiles")
      .insert({ ...baseProfile(), deleted_at: new Date().toISOString() });
    expectPgError(error, "42501");
  });

  it("PR3: un usuario no puede crear el perfil de otra persona", async () => {
    const { error } = await A()
      .client.from("profiles")
      .insert({ ...baseProfile(), id: randomUUID() });
    expectPgError(error, "42501");
  });

  it("PR4: un usuario crea su propio perfil con los campos permitidos y queda role=user", async () => {
    const { data, error } = await A()
      .client.from("profiles")
      .insert({ ...baseProfile(), bio: "hola" })
      .select("id, role")
      .single();
    expectOk(error);
    expect(data?.role).toBe("user");
  });

  it("PR5: un usuario no puede cambiar su role", async () => {
    const { error } = await A()
      .client.from("profiles")
      .update({ role: "admin" })
      .eq("id", A().id);
    expectPgError(error, "42501");
  });

  it("PR6: un usuario no puede cambiar su deleted_at", async () => {
    const { error } = await A()
      .client.from("profiles")
      .update({ deleted_at: null })
      .eq("id", A().id);
    expectPgError(error, "42501");
  });

  it("PR7: un usuario actualiza sus campos permitidos", async () => {
    const { data, error } = await A()
      .client.from("profiles")
      .update({ full_name: "Validación A editada", bio: "nueva bio" })
      .eq("id", A().id)
      .select("full_name");
    expectOk(error);
    expect(data).toHaveLength(1);
  });

  it("PR8: upsert() del propio perfil — se REGISTRA el comportamiento real (restricción de diseño, no se relajan permisos)", async () => {
    const { error } = await A()
      .client.from("profiles")
      .upsert({ ...baseProfile(), full_name: "Validación A upsert" });
    if (error) {
      record(
        `PR8: upsert() de profiles RECHAZADO por Supabase: ${error.code} — ${error.message}`
      );
    } else {
      record("PR8: upsert() de profiles ACEPTADO por Supabase (sin incluir role)");
    }
    // Invariante de seguridad, pase lo que pase con el upsert:
    const { data } = await service
      .from("profiles")
      .select("role")
      .eq("id", A().id)
      .single();
    expect(data?.role).toBe("user");
  });

  it("PR9: upsert() con role=admin es rechazado", async () => {
    const { error } = await A()
      .client.from("profiles")
      .upsert({ ...baseProfile(), role: "admin" });
    expectPgError(error, "42501");
    const { data } = await service
      .from("profiles")
      .select("role")
      .eq("id", A().id)
      .single();
    expect(data?.role).toBe("user");
  });

  it("PR10: anon no puede crear perfiles ni leer profiles", async () => {
    const insert = await anon
      .from("profiles")
      .insert({ id: randomUUID(), full_name: "x", date_of_birth: "2000-01-01" });
    expectPgError(insert.error, "42501");

    const select = await anon.from("profiles").select("id");
    expectOk(select.error);
    expect(select.data).toHaveLength(0);

    // H3 (conocido, no se corrige en este checkpoint): se registra la exposición.
    const preview = await anon.from("public_profile_previews").select("id, role");
    record(
      `PR10/H3: anon lee public_profile_previews → ${preview.error ? `error ${preview.error.code}` : `${preview.data?.length ?? 0} filas (incluye la columna role)`}`
    );
  });

  it("PR11: el servidor (service_role) sí puede asignar role=admin", async () => {
    const { data, error } = await service
      .from("profiles")
      .update({ role: "admin" })
      .eq("id", D().id)
      .select("role")
      .single();
    expectOk(error);
    expect(data?.role).toBe("admin");
  });

  it("PR12: is_admin() refleja el rol real de cada JWT", async () => {
    const asA = await A().client.rpc("is_admin");
    expectOk(asA.error);
    expect(asA.data).toBe(false);

    const asD = await D().client.rpc("is_admin");
    expectOk(asD.error);
    expect(asD.data).toBe(true);
  });
});

// ===========================================================================
// CHAT — A y B en conversación 1, C en conversación 2
// ===========================================================================
describe("Chat (CH)", () => {
  beforeAll(async () => {
    const conv = await service
      .from("conversations")
      .insert([{ id: conv1 }, { id: conv2 }]);
    if (conv.error) throw new Error(`conversations: ${conv.error.message}`);
    // F3: se registran explícitamente para que el teardown borre solo estas.
    createdConversationIds.add(conv1);
    createdConversationIds.add(conv2);
    const parts = await service.from("conversation_participants").insert([
      { conversation_id: conv1, user_id: A().id },
      { conversation_id: conv1, user_id: B().id },
      { conversation_id: conv2, user_id: C().id },
    ]);
    if (parts.error) throw new Error(`participants: ${parts.error.message}`);
    const msgs = await service.from("messages").insert([
      { conversation_id: conv1, sender_id: A().id, content: "privado A->B" },
      { conversation_id: conv2, sender_id: C().id, content: "nota de C" },
    ]);
    if (msgs.error) throw new Error(`messages: ${msgs.error.message}`);
  });

  const messagesOf = (client: Client, conversationId: string) =>
    client.from("messages").select("id, content").eq("conversation_id", conversationId);

  it("CH1: A y B leen los mensajes de la conversación 1", async () => {
    for (const actor of [A(), B()]) {
      const { data, error } = await messagesOf(actor.client, conv1);
      expectOk(error);
      expect(data?.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("CH2: A y B NO leen mensajes de la conversación 2", async () => {
    for (const actor of [A(), B()]) {
      const { data, error } = await messagesOf(actor.client, conv2);
      expectOk(error);
      expect(data).toHaveLength(0);
    }
  });

  it("CH3: A y B NO pueden insertar mensajes en la conversación 2", async () => {
    for (const actor of [A(), B()]) {
      const { error } = await actor.client
        .from("messages")
        .insert({ conversation_id: conv2, sender_id: actor.id, content: "intrusión" });
      expectPgError(error, "42501");
    }
  });

  it("CH4: C no accede de ninguna forma a la conversación 1", async () => {
    const msgs = await messagesOf(C().client, conv1);
    expectOk(msgs.error);
    expect(msgs.data).toHaveLength(0);

    const conv = await C().client.from("conversations").select("id").eq("id", conv1);
    expectOk(conv.error);
    expect(conv.data).toHaveLength(0);

    const parts = await C()
      .client.from("conversation_participants")
      .select("user_id")
      .eq("conversation_id", conv1);
    expectOk(parts.error);
    expect(parts.data).toHaveLength(0);

    const insert = await C()
      .client.from("messages")
      .insert({ conversation_id: conv1, sender_id: C().id, content: "intrusión" });
    expectPgError(insert.error, "42501");
  });

  it("CH5: cada participante ve exactamente los participantes de sus conversaciones", async () => {
    const asA = await A()
      .client.from("conversation_participants")
      .select("conversation_id, user_id");
    expectOk(asA.error);
    expect(new Set(asA.data?.map((p) => p.user_id))).toEqual(new Set([A().id, B().id]));
    expect(asA.data?.every((p) => p.conversation_id === conv1)).toBe(true);

    const asC = await C().client.from("conversation_participants").select("user_id");
    expectOk(asC.error);
    expect(asC.data?.map((p) => p.user_id)).toEqual([C().id]);
  });

  it("CH6: C lee y escribe en la conversación 2, en la que participa", async () => {
    const read = await messagesOf(C().client, conv2);
    expectOk(read.error);
    expect(read.data?.length).toBeGreaterThanOrEqual(1);

    const write = await C()
      .client.from("messages")
      .insert({ conversation_id: conv2, sender_id: C().id, content: "otra nota" })
      .select("id");
    expectOk(write.error);
    expect(write.data).toHaveLength(1);
  });

  it("CH7: ninguna consulta del chat produce recursión RLS (42P17)", async () => {
    for (const actor of [A(), B(), C()]) {
      for (const table of ["messages", "conversations", "conversation_participants"]) {
        const { error } = await actor.client.from(table).select("*").limit(5);
        expect(error?.code, `${actor.key} → ${table}`).not.toBe("42P17");
        expectOk(error);
      }
    }
  });

  it("CH8: A no puede enviar un mensaje suplantando a B", async () => {
    const { error } = await A()
      .client.from("messages")
      .insert({ conversation_id: conv1, sender_id: B().id, content: "suplantación" });
    expectPgError(error, "42501");
  });

  it("CH9: fila de participante — last_read_at propio sí; conversation_id no; la fila de B no", async () => {
    const own = await A()
      .client.from("conversation_participants")
      .update({ last_read_at: new Date().toISOString() })
      .eq("conversation_id", conv1)
      .eq("user_id", A().id)
      .select("user_id");
    expectOk(own.error);
    expect(own.data).toHaveLength(1);

    const jump = await A()
      .client.from("conversation_participants")
      .update({ conversation_id: conv2 })
      .eq("user_id", A().id);
    expectPgError(jump.error, "42501");

    const other = await A()
      .client.from("conversation_participants")
      .update({ last_read_at: new Date().toISOString() })
      .eq("user_id", B().id)
      .select("user_id");
    expectOk(other.error);
    expect(other.data).toHaveLength(0);
  });

  it("CH10: is_conversation_participant vía API — solo sobre uno mismo, y anon no puede llamarla", async () => {
    const mine = await A().client.rpc("is_conversation_participant", {
      p_conversation_id: conv1,
    });
    expectOk(mine.error);
    expect(mine.data).toBe(true);

    const notMine = await A().client.rpc("is_conversation_participant", {
      p_conversation_id: conv2,
    });
    expectOk(notMine.error);
    expect(notMine.data).toBe(false);

    const asAnon = await anon.rpc("is_conversation_participant", {
      p_conversation_id: conv1,
    });
    expect(asAnon.error, "anon no debe poder ejecutar la función").not.toBeNull();
    expect(asAnon.data).not.toBe(true);
    record(
      `CH10: anon → is_conversation_participant rechazado con ${asAnon.error?.code}`
    );
  });

  it("CH11: un cliente no puede crear conversaciones, participantes ni matches", async () => {
    // Se registra antes del intento: si por error se aceptara, el teardown la borra.
    const attemptedId = randomUUID();
    createdConversationIds.add(attemptedId);
    const conv = await A().client.from("conversations").insert({ id: attemptedId });
    expectPgError(conv.error, "42501");

    const part = await A()
      .client.from("conversation_participants")
      .insert({ conversation_id: conv2, user_id: A().id });
    expectPgError(part.error, "42501");

    const [low, high] = [A().id, B().id].sort();
    const match = await A()
      .client.from("matches")
      .insert({ user_a_id: low, user_b_id: high, compatibility_score: 50 });
    expectPgError(match.error, "42501");
  });
});

// ===========================================================================
// ROOMS — O propietario, D admin
// ===========================================================================
describe("Rooms (RO)", () => {
  const roomRow = (status: string) => ({
    id: roomId,
    owner_id: O().id,
    title: "Habitación de validación",
    city_id: cityId,
    price_month: 450,
    available_from: "2026-10-01",
    status,
  });
  const setStatus = (client: Client, status: string) =>
    client.from("rooms").update({ status }).eq("id", roomId).select("status");

  it("RO1: el propietario publica y edita su habitación", async () => {
    const insert = await O().client.from("rooms").insert(roomRow("active")).select("id");
    expectOk(insert.error);
    expect(insert.data).toHaveLength(1);

    const edit = await O()
      .client.from("rooms")
      .update({ title: "Habitación luminosa", price_month: 430 })
      .eq("id", roomId)
      .select("title");
    expectOk(edit.error);
    expect(edit.data).toHaveLength(1);
  });

  it("RO2: el propietario pausa y reactiva (paused ↔ active)", async () => {
    const paused = await setStatus(O().client, "paused");
    expectOk(paused.error);
    expect(paused.data?.[0]?.status).toBe("paused");

    const active = await setStatus(O().client, "active");
    expectOk(active.error);
    expect(active.data?.[0]?.status).toBe("active");
  });

  it("RO3: el propietario NO puede marcar removed", async () => {
    const { error } = await setStatus(O().client, "removed");
    expectModerationRejection(error);
  });

  it("RO4: un admin sí puede marcar removed", async () => {
    const { data, error } = await setStatus(D().client, "removed");
    expectOk(error);
    expect(data?.[0]?.status).toBe("removed");
  });

  it("RO5: el propietario NO puede sacar de removed (ni a active ni a paused)", async () => {
    expectModerationRejection((await setStatus(O().client, "active")).error);
    expectModerationRejection((await setStatus(O().client, "paused")).error);
  });

  it("RO6: el propietario NO puede reactivar vía upsert (INSERT ... ON CONFLICT DO UPDATE)", async () => {
    const { error } = await O().client.from("rooms").upsert(roomRow("active"));
    record(
      `RO6: upsert de room removed → ${error ? `${error.code} — ${error.message}` : "ACEPTADO"}`
    );
    expectModerationRejection(error);
    const { data } = await service
      .from("rooms")
      .select("status")
      .eq("id", roomId)
      .single();
    expect(data?.status).toBe("removed");
  });

  it("RO7: reactivación autorizada — admin, y también el servidor (service_role)", async () => {
    const byAdmin = await setStatus(D().client, "active");
    expectOk(byAdmin.error);
    expect(byAdmin.data?.[0]?.status).toBe("active");

    const toRemoved = await setStatus(D().client, "removed");
    expectOk(toRemoved.error);

    const byServer = await setStatus(service, "active");
    expectOk(byServer.error);
    expect(byServer.data?.[0]?.status).toBe("active");
  });

  it("RO8: anon ve la habitación activa y no la removed", async () => {
    const visible = await anon.from("rooms").select("id").eq("id", roomId);
    expectOk(visible.error);
    expect(visible.data).toHaveLength(1);

    expectOk((await setStatus(D().client, "removed")).error);
    const hidden = await anon.from("rooms").select("id").eq("id", roomId);
    expectOk(hidden.error);
    expect(hidden.data).toHaveLength(0);

    expectOk((await setStatus(D().client, "active")).error);
  });

  it("RO9: la dirección exacta solo la ve el propietario", async () => {
    const insert = await O()
      .client.from("room_addresses")
      .insert({ room_id: roomId, address_exact: "Carrer de Validació 1, 3r 2a" })
      .select("room_id");
    expectOk(insert.error);
    expect(insert.data).toHaveLength(1);

    for (const client of [A().client, D().client, anon]) {
      const { data, error } = await client
        .from("room_addresses")
        .select("address_exact")
        .eq("room_id", roomId);
      expectOk(error);
      expect(data).toHaveLength(0);
    }

    const own = await O()
      .client.from("room_addresses")
      .select("address_exact")
      .eq("room_id", roomId);
    expectOk(own.error);
    expect(own.data).toHaveLength(1);
  });
});

// ===========================================================================
// REPORTS — R denunciante, T denunciado, D admin
// ===========================================================================
describe("Reports (RE)", () => {
  const base = () => ({ reporter_id: R().id, reported_user_id: T().id, reason: "spam" });

  it("RE1: el usuario crea un reporte válido; nace pending y sin resolver", async () => {
    const { data, error } = await R()
      .client.from("reports")
      .insert({ ...base(), description: "me envía spam" })
      .select("id, status, resolved_by, resolved_at")
      .single();
    expectOk(error);
    expect(data?.status).toBe("pending");
    expect(data?.resolved_by).toBeNull();
    expect(data?.resolved_at).toBeNull();
    reportId = data!.id;
  });

  it.each([
    ["RE2", { status: "resolved" }],
    ["RE3", { resolved_by: "__D__" }],
    ["RE4", { resolved_at: "__NOW__" }],
    ["RE5", { resolution_notes: "cerrado" }],
  ])(
    "%s: no se puede fijar un campo administrativo al crear (%o)",
    async (_id, extra) => {
      const resolved = Object.fromEntries(
        Object.entries(extra).map(([k, v]) => [
          k,
          v === "__D__" ? D().id : v === "__NOW__" ? new Date().toISOString() : v,
        ])
      );
      const { error } = await R()
        .client.from("reports")
        .insert({ ...base(), ...resolved });
      expectPgError(error, "42501");
    }
  );

  it("RE6: no se puede crear un reporte en nombre de otra persona", async () => {
    const { error } = await R()
      .client.from("reports")
      .insert({ ...base(), reporter_id: T().id, reported_user_id: R().id });
    expectPgError(error, "42501");
  });

  it("RE7: quien reporta no puede cerrar su propio reporte", async () => {
    const { data, error } = await R()
      .client.from("reports")
      .update({ status: "dismissed" })
      .eq("id", reportId)
      .select("id");
    expectOk(error);
    expect(data).toHaveLength(0);
  });

  it("RE8: la persona denunciada no ve el reporte", async () => {
    const { data, error } = await T().client.from("reports").select("id");
    expectOk(error);
    expect(data).toHaveLength(0);
  });

  it("RE9: un admin resuelve el reporte (UPDATE vía reports_admin_all)", async () => {
    const { data, error } = await D()
      .client.from("reports")
      .update({
        status: "resolved",
        resolved_by: D().id,
        resolved_at: new Date().toISOString(),
        resolution_notes: "revisado en validación",
      })
      .eq("id", reportId)
      .select("status, resolved_by");
    expectOk(error);
    expect(data).toHaveLength(1);
    expect(data?.[0]?.status).toBe("resolved");
    expect(data?.[0]?.resolved_by).toBe(D().id);
  });
});

// ===========================================================================
// AUTH — AU2: lista de redirects permitidos de Supabase Auth
// ===========================================================================
// ===========================================================================
// COMPATIBILITY RESPONSES (Fase 3.1, D6 = B: la escritura del test se valida
// aquí y en la suite SQL, sin dar service_role a la app del workflow)
// ===========================================================================
describe("Compatibility responses (CRA)", () => {
  const TABLE = "compatibility_responses";

  beforeAll(async () => {
    // El servidor (service_role) es el único escritor: B tiene un borrador.
    const { error } = await service.from(TABLE).insert({
      profile_id: B().id,
      questionnaire_version: 1,
      answers: {},
      completed_at: null,
    });
    expectOk(error);
  });

  it("CRA1: B lee su fila con su JWT; C no la ve", async () => {
    const own = await B()
      .client.from(TABLE)
      .select("profile_id")
      .eq("profile_id", B().id);
    expectOk(own.error);
    expect(own.data).toHaveLength(1);
    const other = await C()
      .client.from(TABLE)
      .select("profile_id")
      .eq("profile_id", B().id);
    expectOk(other.error);
    expect(other.data).toHaveLength(0);
  });

  it("CRA2: B no escribe por PostgREST: ni INSERT, ni UPDATE de completed_at/versión, ni DELETE", async () => {
    const insert = await C().client.from(TABLE).insert({
      profile_id: C().id,
      questionnaire_version: 1,
      answers: {},
      completed_at: null,
    });
    expectPgError(insert.error, "42501");
    const complete = await B()
      .client.from(TABLE)
      .update({ completed_at: new Date().toISOString() })
      .eq("profile_id", B().id);
    expectPgError(complete.error, "42501");
    const version = await B()
      .client.from(TABLE)
      .update({ questionnaire_version: 99 })
      .eq("profile_id", B().id);
    expectPgError(version.error, "42501");
    const remove = await B().client.from(TABLE).delete().eq("profile_id", B().id);
    expectPgError(remove.error, "42501");
  });

  it("CRA3: anon no lee respuestas", async () => {
    const { error } = await anon.from(TABLE).select("profile_id");
    expectPgError(error, "42501");
  });

  it("CRA4: service_role completa una vez; después la fecha no cambia en la misma versión (S4)", async () => {
    const first = await service
      .from(TABLE)
      .update({ completed_at: "2026-10-02T10:00:00Z" })
      .eq("profile_id", B().id);
    expectOk(first.error);
    const again = await service
      .from(TABLE)
      .update({ completed_at: "2026-10-03T10:00:00Z" })
      .eq("profile_id", B().id);
    expectPgError(again.error, "23514");
    expect(again.error?.message).toMatch(/^questionnaire_completed_locked:/);
  });

  it("CRA5: no se baja de versión (S3) y se sube completando en la misma escritura (S5)", async () => {
    const up = await service
      .from(TABLE)
      .update({ questionnaire_version: 2, completed_at: "2026-10-04T10:00:00Z" })
      .eq("profile_id", B().id);
    expectOk(up.error);
    const down = await service
      .from(TABLE)
      .update({ questionnaire_version: 1 })
      .eq("profile_id", B().id);
    expectPgError(down.error, "23514");
    expect(down.error?.message).toMatch(/^questionnaire_version_downgrade:/);
  });

  it("CRA6: con la cuenta eliminada, ni service_role escribe (trigger para todos los roles)", async () => {
    const deactivate = await service
      .from("profiles")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", C().id);
    expectOk(deactivate.error);
    try {
      const { error } = await service.from(TABLE).insert({
        profile_id: C().id,
        questionnaire_version: 1,
        answers: {},
        completed_at: null,
      });
      expectPgError(error, "23514");
      expect(error?.message).toMatch(/^account_deleted:/);
    } finally {
      const restore = await service
        .from("profiles")
        .update({ deleted_at: null })
        .eq("id", C().id);
      expectOk(restore.error);
    }
  });
});

// ===========================================================================
// SERVICIOS DEL SERVIDOR (SVC, GC): los dos recorridos que usan service_role
// dentro de la app. Se llama a los servicios reales con el JWT real del
// usuario y con service_role inyectado en `deps.adminClient`, como hace el
// servidor. Nada de esto llega a la app ni al navegador (D6 = B).
// ===========================================================================

/** Los servicios esperan el cliente tipado de la app; aquí es el mismo cliente, sin tipos. */
const asDb = (client: Client) => client as unknown as DbClient;

/**
 * Una petición a PostgREST tal como salió y su respuesta cruda. Sin el host:
 * la URL del proyecto nunca se guarda ni se imprime.
 */
type Observed = {
  method: string;
  path: string;
  params: URLSearchParams;
  data: unknown;
  error: PostgrestError | null;
};

/**
 * `client` sin cambios, pero observado: por cada consulta que se espera,
 * apunta en `sink` el método, la ruta, los parámetros y la respuesta cruda de
 * PostgREST, y devuelve esa misma respuesta. No toca la petición ni el
 * resultado; el servicio no sabe que se le observa.
 */
function observed(client: Client, sink: Observed[]): Client {
  const isRequest = (value: object) =>
    "method" in value && "url" in value && value.url instanceof URL;
  const wrap = <T extends object>(target: T): T =>
    new Proxy(target, {
      get(obj, prop) {
        const value = Reflect.get(obj, prop, obj);
        if (typeof value !== "function") return value;
        if (prop === "then" && isRequest(obj)) {
          const request = obj as unknown as { method: string; url: URL };
          return (
            onFulfilled?: (result: unknown) => unknown,
            onRejected?: (reason: unknown) => unknown
          ) =>
            value.call(
              obj,
              (result: { data: unknown; error: PostgrestError | null }) => {
                sink.push({
                  method: request.method,
                  path: request.url.pathname,
                  params: new URLSearchParams(request.url.searchParams),
                  data: result.data,
                  error: result.error,
                });
                return onFulfilled ? onFulfilled(result) : result;
              },
              onRejected
            );
        }
        return (...args: unknown[]) => {
          const out = value.apply(obj, args);
          return out !== null && typeof out === "object" ? wrap(out) : out;
        };
      },
    });
  return wrap(client);
}

/** Respuestas válidas: el mínimo de cada escala, o el valor siguiente. */
const low = (q: Question) => q.scale.min;
const next = (q: Question) => q.scale.min + 1;
function answersOf(
  questionnaire: Questionnaire,
  value: (q: Question) => number,
  ids?: readonly string[]
): Record<string, number> {
  return Object.fromEntries(
    questionnaire.questions
      .filter((q) => !ids || ids.includes(q.id))
      .map((q) => [q.id, value(q)])
  );
}

/**
 * Preferencias de vivienda y, si se pide, el onboarding completado, en el
 * orden que exige el esquema: el trigger de onboarding pide antes unas
 * preferencias con ciudad.
 */
async function prepareStudent(
  id: string,
  housing: Record<string, unknown>,
  { onboarding = true }: { onboarding?: boolean } = {}
) {
  const prefs = await service
    .from("housing_preferences")
    .insert({ profile_id: id, ...housing });
  expectOk(prefs.error);
  if (onboarding) {
    const done = await service
      .from("profiles")
      .update({ onboarding_completed_at: new Date().toISOString() })
      .eq("id", id);
    expectOk(done.error);
  }
}

/** Estado de partida del test, escrito directamente por service_role (no es lo que se prueba). */
async function seedResponse(
  id: string,
  version: number,
  answers: Record<string, number>,
  completedAt: string | null
) {
  const { error } = await service.from("compatibility_responses").insert({
    profile_id: id,
    questionnaire_version: version,
    answers,
    completed_at: completedAt,
  });
  expectOk(error);
}

type StoredResponse = {
  questionnaire_version: number;
  answers: Record<string, number>;
  completed_at: string | null;
};

/** La fila guardada, leída con service_role para comprobar lo que hay de verdad en la BD. */
async function storedResponse(id: string): Promise<StoredResponse | null> {
  const { data, error } = await service
    .from("compatibility_responses")
    .select("questionnaire_version, answers, completed_at")
    .eq("profile_id", id)
    .maybeSingle();
  expectOk(error);
  return data as StoredResponse | null;
}

/**
 * Candidato de GC: usuario de prueba sin sesión (F2) con su perfil.
 * `createTestUser` apunta su id en `testUserIds` antes de crear el perfil,
 * para que el teardown lo borre aunque falle lo que venga después.
 */
async function createCandidate(key: string, fullName: string): Promise<string> {
  if ((ACTOR_KEYS as readonly string[]).includes(key)) {
    throw new Error(`la clave ${key} ya es de un actor con sesión`);
  }
  const email = testEmail(key);
  if (!TEST_EMAIL.test(email)) throw new Error("formato de email de prueba inválido");
  const id = await createTestUser({
    key,
    email,
    password: randomBytes(24).toString("base64url"), // nunca se usa ni se imprime
    admin: service.auth.admin,
    registry: testUserIds,
  });
  const profile = await service.from("profiles").insert({
    id,
    full_name: fullName,
    date_of_birth: "2000-03-15",
    seeking_status: "looking_for_room",
  });
  expectOk(profile.error);
  return id;
}

const V1_IDS = QUESTIONNAIRE_V1.questions.map((q) => q.id);
const V2_IDS = QUESTIONNAIRE_V2.questions.map((q) => q.id);
/** Las 21 preguntas que siguen igual en la v2. */
const SHARED_IDS = V2_IDS.filter((id) => V1_IDS.includes(id));
/** Los ocho ids nuevos de la v2 (`_v2`). */
const NEW_IDS = V2_IDS.filter((id) => !V1_IDS.includes(id));
/** Los ocho ids de la v1 que la v2 sustituye. */
const REPLACED_IDS = V1_IDS.filter((id) => !V2_IDS.includes(id));
const questionV2 = (id: string) => QUESTIONNAIRE_V2.questions.find((q) => q.id === id)!;

describe("Guardado del test por el servicio del servidor (SVC)", () => {
  const deps = { adminClient: () => asDb(service) };
  /** Primer guardado parcial: cinco preguntas comunes y una nueva. */
  const PARTIAL = answersOf(QUESTIONNAIRE_V2, low, [
    ...SHARED_IDS.slice(0, 5),
    NEW_IDS[0],
  ]);
  let firstCompletedAt: string | null = null;

  beforeAll(async () => {
    // Precondiciones de la v2 vigente; si cambian, estos casos no prueban lo que dicen.
    expect(CURRENT_QUESTIONNAIRE_VERSION).toBe(2);
    expect([SHARED_IDS.length, NEW_IDS.length, REPLACED_IDS.length]).toEqual([21, 8, 8]);
    // S y U: perfil (creado arriba), preferencias con ciudad y onboarding completo.
    await prepareStudent(S().id, { city_id: cityId });
    await prepareStudent(U().id, { city_id: cityId });
  });

  it("SVC1: respuestas parciales de la v2 → borrador de la versión 2, que se relee con la sesión del usuario", async () => {
    const result = await saveQuestionnaireAnswers(asDb(S().client), PARTIAL, deps);
    expect(result).toEqual({
      ok: true,
      data: { status: "draft", answers: PARTIAL, storedVersion: 2, currentVersion: 2 },
    });
    expect(await storedResponse(S().id)).toEqual({
      questionnaire_version: 2,
      answers: PARTIAL,
      completed_at: null,
    });
    // Con el JWT del usuario: su fila (RLS) y el servicio de lectura.
    const own = await S()
      .client.from("compatibility_responses")
      .select("questionnaire_version, answers, completed_at")
      .eq("profile_id", S().id);
    expectOk(own.error);
    expect(own.data).toEqual([
      { questionnaire_version: 2, answers: PARTIAL, completed_at: null },
    ]);
    expect(await getOwnQuestionnaire(asDb(S().client))).toEqual({
      ok: true,
      data: { status: "draft", answers: PARTIAL, storedVersion: 2, currentVersion: 2 },
    });
  });

  it("SVC2: con las 29 respuestas el test queda completado y se fija completed_at", async () => {
    const rest = answersOf(
      QUESTIONNAIRE_V2,
      low,
      V2_IDS.filter((id) => !(id in PARTIAL))
    );
    const result = await saveQuestionnaireAnswers(asDb(S().client), rest, deps);
    expect(result).toMatchObject({
      ok: true,
      data: { status: "completed", storedVersion: 2 },
    });
    const row = await storedResponse(S().id);
    expect(row?.questionnaire_version).toBe(2);
    expect(row?.answers).toEqual({ ...PARTIAL, ...rest });
    expect(Object.keys(row?.answers ?? {}).sort()).toEqual([...V2_IDS].sort());
    expect(row?.completed_at).not.toBeNull();
    firstCompletedAt = row?.completed_at ?? null;
  });

  it("SVC3: volver a guardar un test completado cambia la respuesta, pero no completed_at", async () => {
    expect(firstCompletedAt, "depende de SVC2").not.toBeNull();
    const id = SHARED_IDS[0];
    const changed = { [id]: questionV2(id).scale.max };
    const result = await saveQuestionnaireAnswers(asDb(S().client), changed, deps);
    expect(result).toMatchObject({ ok: true, data: { status: "completed" } });
    const row = await storedResponse(S().id);
    expect(row?.answers[id]).toBe(changed[id]);
    expect(Object.keys(row?.answers ?? {})).toHaveLength(29);
    expect(row?.completed_at).toBe(firstCompletedAt);
  });

  it("SVC4: de una fila v1 completada a la v2 en una sola escritura: 21 respuestas reutilizadas y ocho ids descartados", async () => {
    const v1Answers = answersOf(QUESTIONNAIRE_V1, next);
    const v1CompletedAt = "2026-10-01T10:00:00+00:00";
    await seedResponse(U().id, 1, v1Answers, v1CompletedAt);

    const sink: Observed[] = [];
    const result = await saveQuestionnaireAnswers(
      asDb(U().client),
      answersOf(QUESTIONNAIRE_V2, low, NEW_IDS),
      { adminClient: () => asDb(observed(service, sink)) }
    );
    expect(result).toMatchObject({
      ok: true,
      data: { status: "completed", storedVersion: 2 },
    });

    // Una sola escritura con service_role: el UPDATE condicionado a la fila
    // tal como se leyó (su perfil y la versión 1; como estaba completada, sin
    // condición sobre completed_at).
    expect(sink.length).toBe(1);
    const [write] = sink;
    expectOk(write.error);
    expect(write.method).toBe("PATCH");
    expect(write.path).toBe("/rest/v1/compatibility_responses");
    expect(write.params.getAll("profile_id")).toEqual([`eq.${U().id}`]);
    expect(write.params.getAll("questionnaire_version")).toEqual(["eq.1"]);
    expect(write.params.has("completed_at")).toBe(false);

    // Lo que quedó en la BD: el trigger dejó subir de versión y completar a la vez (S5).
    const row = await storedResponse(U().id);
    expect(row?.questionnaire_version).toBe(2);
    expect(row?.completed_at).not.toBeNull();
    expect(Date.parse(row?.completed_at ?? "")).not.toBe(Date.parse(v1CompletedAt));
    const saved = row?.answers ?? {};
    expect(Object.keys(saved).sort()).toEqual([...V2_IDS].sort());
    for (const id of SHARED_IDS) expect(saved[id], id).toBe(v1Answers[id]);
    for (const id of NEW_IDS) expect(saved[id], id).toBe(low(questionV2(id)));
    for (const id of REPLACED_IDS) expect(saved, id).not.toHaveProperty(id);

    // Y sobre esa misma fila el trigger no deja volver a la v1 (S3).
    const down = await service
      .from("compatibility_responses")
      .update({ questionnaire_version: 1 })
      .eq("profile_id", U().id);
    expectPgError(down.error, "23514");
    expect(down.error?.message).toMatch(/^questionnaire_version_downgrade:/);
  });

  it.each<[string, () => Record<string, number>]>([
    ["un id de la v1 que la v2 sustituye", () => ({ [REPLACED_IDS[0]]: 1 })],
    [
      "una respuesta fuera de la escala",
      () => ({ [NEW_IDS[0]]: questionV2(NEW_IDS[0]).scale.max + 1 }),
    ],
  ])("SVC5: %s se rechaza sin escribir nada", async (_label, input) => {
    const before = await storedResponse(S().id);
    let adminCalls = 0;
    const result = await saveQuestionnaireAnswers(asDb(S().client), input(), {
      adminClient: () => {
        adminCalls += 1;
        return asDb(service);
      },
    });
    expect(result.ok).toBe(false);
    expect(result.ok ? null : result.error).toBe("validation");
    expect(adminCalls, "service_role no se llega a pedir").toBe(0);
    expect(await storedResponse(S().id)).toEqual(before);
  });
});

describe("Candidatos de /explorar por el servicio del servidor (GC)", () => {
  /** Fecha fija para la edad: quien nació el 2000-03-15 tiene 26 años. */
  const TODAY = "2026-06-15";
  const deps = (sink?: Observed[]) => ({
    adminClient: () => asDb(sink ? observed(service, sink) : service),
    today: () => TODAY,
  });
  const ids = {
    eligible: "",
    v1: "",
    draft: "",
    otherCity: "",
    deleted: "",
    admin: "",
    noOnboarding: "",
  };
  let university = { id: "", name: "" };
  /** Quien no debe aparecer nunca: quien mira y cada candidato que falla un criterio. */
  const excluded = (): Array<[string, string]> => [
    ["quien mira", V().id],
    ["test v1 completado", ids.v1],
    ["borrador de la v2", ids.draft],
    ["otra ciudad", ids.otherCity],
    ["cuenta desactivada", ids.deleted],
    ["rol admin", ids.admin],
    ["onboarding incompleto", ids.noOnboarding],
  ];

  beforeAll(async () => {
    const madrid = await service
      .from("cities")
      .select("id")
      .eq("slug", "madrid")
      .single();
    expectOk(madrid.error);
    const upf = await service
      .from("universities")
      .select("id, name")
      .eq("slug", "upf")
      .single();
    expectOk(upf.error);
    university = { id: upf.data?.id, name: upf.data?.name };

    const completedAt = new Date().toISOString();
    const v2 = answersOf(QUESTIONNAIRE_V2, low);

    // Quien mira: en Barcelona, sin presupuesto ni fechas, con el test v2 completado.
    await prepareStudent(V().id, { city_id: cityId });
    await seedResponse(V().id, 2, v2, completedAt);

    // El elegible: con universidad (nombre leído de la tabla de referencia con
    // el JWT de quien mira) y un presupuesto exacto que el DTO no debe enseñar.
    ids.eligible = await createCandidate("e", "Validación GC elegible");
    await prepareStudent(ids.eligible, {
      city_id: cityId,
      university_id: university.id,
      budget_min: 437,
      budget_max: 683,
    });
    await seedResponse(ids.eligible, 2, answersOf(QUESTIONNAIRE_V2, next), completedAt);

    // Cada uno de los demás falla un solo criterio de los que filtra la consulta.
    ids.v1 = await createCandidate("y", "Validación GC test v1");
    await prepareStudent(ids.v1, { city_id: cityId });
    await seedResponse(ids.v1, 1, answersOf(QUESTIONNAIRE_V1, low), completedAt);

    ids.draft = await createCandidate("z", "Validación GC borrador");
    await prepareStudent(ids.draft, { city_id: cityId });
    await seedResponse(ids.draft, 2, v2, null);

    ids.otherCity = await createCandidate("m", "Validación GC otra ciudad");
    await prepareStudent(ids.otherCity, { city_id: madrid.data?.id });
    await seedResponse(ids.otherCity, 2, v2, completedAt);

    // Desactivada después de guardar su test: con deleted_at, el trigger ya
    // no deja escribirlo.
    ids.deleted = await createCandidate("x", "Validación GC desactivada");
    await prepareStudent(ids.deleted, { city_id: cityId });
    await seedResponse(ids.deleted, 2, v2, completedAt);
    const deactivate = await service
      .from("profiles")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", ids.deleted);
    expectOk(deactivate.error);

    // El rol solo lo cambia service_role (PR11).
    ids.admin = await createCandidate("k", "Validación GC admin");
    await prepareStudent(ids.admin, { city_id: cityId });
    await seedResponse(ids.admin, 2, v2, completedAt);
    const promote = await service
      .from("profiles")
      .update({ role: "admin" })
      .eq("id", ids.admin);
    expectOk(promote.error);

    // Preferencias y test completos, pero sin onboarding: el trigger del test no lo exige.
    ids.noOnboarding = await createCandidate("n", "Validación GC sin onboarding");
    await prepareStudent(ids.noOnboarding, { city_id: cityId }, { onboarding: false });
    await seedResponse(ids.noOnboarding, 2, v2, completedAt);
  });

  /** Todas las páginas: lo que haya en el proyecto además de estos datos no importa. */
  async function allCandidates(): Promise<CandidateDTO[]> {
    const candidates: CandidateDTO[] = [];
    for (let page = 1; page <= 50; page++) {
      const result = await getCandidates(asDb(V().client), page, deps());
      expect(result.ok ? null : result.error).toBeNull();
      if (!result.ok) break;
      candidates.push(...result.data.candidates);
      if (page >= result.data.totalPages) break;
    }
    return candidates;
  }

  it("GC1: el candidato v2 completado y elegible de la misma ciudad aparece", async () => {
    const found = (await allCandidates()).map((c) => c.id);
    expect(found).toContain(ids.eligible);
  });

  it("GC2: no aparecen quien mira, el test v1, el borrador v2, otra ciudad, la cuenta desactivada, el admin ni el onboarding incompleto", async () => {
    const found = (await allCandidates()).map((c) => c.id);
    for (const [label, id] of excluded()) expect(found, label).not.toContain(id);
  });

  it("GC3: el DTO solo trae los campos permitidos, sin respuestas, fecha de nacimiento ni presupuesto exacto", async () => {
    const dto = (await allCandidates()).find((c) => c.id === ids.eligible);
    expect(dto, "el candidato elegible").toBeDefined();
    if (!dto) return;
    expect(Object.keys(dto).sort()).toEqual([
      "age",
      "budgetRange",
      "differences",
      "fullName",
      "id",
      "neighborhoods",
      "neighborhoodsTotal",
      "score",
      "strengths",
      "university",
    ]);
    expect(dto).toMatchObject({
      fullName: "Validación GC elegible",
      age: 26,
      university: university.name,
      neighborhoods: [],
      neighborhoodsTotal: 0,
      // 437–683 € → escalones de 50: el mínimo hacia abajo y el máximo hacia arriba.
      budgetRange: { min: 400, max: 700 },
    });
    expect(dto.score).toBeGreaterThanOrEqual(0);
    expect(dto.score).toBeLessThanOrEqual(100);
    for (const reason of [...dto.strengths, ...dto.differences]) {
      expect(typeof reason).toBe("string");
    }
    // Sin el id (un uuid puede contener cualquier cifra), nada privado en el DTO.
    const text = JSON.stringify({ ...dto, id: null });
    for (const leaked of [
      "437",
      "683",
      "2000-03-15",
      "answers",
      "categoryScores",
      "date_of_birth",
      "budget_min",
      "budget_max",
      "questionnaire_version",
      "completed_at",
      ...V2_IDS,
    ]) {
      expect(text, leaked).not.toContain(leaked);
    }
  });

  it("GC4: la consulta real de PostgREST ya filtra por sí misma (!inner, versión, test completado, ciudad, cuenta, rol y onboarding)", async () => {
    const sink: Observed[] = [];
    const result = await getCandidates(asDb(V().client), 1, deps(sink));
    expect(result.ok ? null : result.error).toBeNull();

    // La única consulta con service_role: la lectura cruzada de candidatos.
    expect(sink.length).toBe(1);
    const [query] = sink;
    expectOk(query.error);
    expect(query.method).toBe("GET");
    expect(query.path).toBe("/rest/v1/profiles");
    expect(query.params.get("select")).toBe(CANDIDATE_SELECT.replace(/\s/g, ""));
    const filters = Object.fromEntries(
      [
        "id",
        "deleted_at",
        "onboarding_completed_at",
        "role",
        "housing_preferences.city_id",
        "compatibility_responses.questionnaire_version",
        "compatibility_responses.completed_at",
      ].map((column) => [column, query.params.getAll(column)])
    );
    expect(filters).toEqual({
      id: [`neq.${V().id}`],
      deleted_at: ["is.null"],
      onboarding_completed_at: ["not.is.null"],
      role: ["neq.admin"],
      "housing_preferences.city_id": [`eq.${cityId}`],
      "compatibility_responses.questionnaire_version": [
        `eq.${CURRENT_QUESTIONNAIRE_VERSION}`,
      ],
      "compatibility_responses.completed_at": ["not.is.null"],
    });

    // La respuesta cruda, antes de isEligibleCandidate: los excluidos ya no
    // vienen de PostgREST, y el elegible trae su test v2 completado y su ciudad.
    type RawRow = {
      id: string;
      housing_preferences: unknown;
      compatibility_responses: unknown;
    };
    const rows = (query.data ?? []) as RawRow[];
    const rawIds = rows.map((row) => row.id);
    expect(rawIds).toContain(ids.eligible);
    for (const [label, id] of excluded()) expect(rawIds, label).not.toContain(id);

    const row = rows.find((r) => r.id === ids.eligible);
    const embedded = <T>(value: unknown) =>
      (Array.isArray(value) ? value[0] : value) as T | undefined;
    const response = embedded<{
      questionnaire_version: number;
      completed_at: string | null;
    }>(row?.compatibility_responses);
    const housing = embedded<{ city_id: string }>(row?.housing_preferences);
    expect(response?.questionnaire_version).toBe(CURRENT_QUESTIONNAIRE_VERSION);
    expect(response?.completed_at).not.toBeNull();
    expect(housing?.city_id).toBe(cityId);
    record(
      `GC4: PostgREST devuelve los recursos embebidos como ${Array.isArray(row?.compatibility_responses) ? "lista" : "objeto"} (compatibility_responses) y ${Array.isArray(row?.housing_preferences) ? "lista" : "objeto"} (housing_preferences)`
    );
  });
});

describe("Auth redirects (AU2)", () => {
  const redirectHostOf = async (redirectTo: string) => {
    const { data, error } = await service.auth.admin.generateLink({
      type: "magiclink",
      email: A().email,
      options: { redirectTo },
    });
    if (error) return { rejected: true as const, detail: error.message };
    const fromProps = data.properties?.redirect_to ?? "";
    const fromLink =
      new URL(data.properties?.action_link ?? "").searchParams.get("redirect_to") ?? "";
    return { rejected: false as const, fromProps, fromLink };
  };

  it("AU2a: el redirect permitido exacto se conserva", async () => {
    const result = await redirectHostOf("http://localhost:3000/callback");
    expect(result.rejected).toBe(false);
    if (!result.rejected) {
      expect(result.fromProps).toBe("http://localhost:3000/callback");
      record(`AU2a: redirect permitido conservado (action_link → ${result.fromLink})`);
    }
  });

  it.each([
    "https://evil.com/callback",
    "http://localhost:3000.evil.com/callback",
    "https://localhost:3000@evil.com/callback",
    "https://evil.com/?x=http://localhost:3000/callback",
  ])("AU2b: un redirect externo no permitido no se conserva (%s)", async (target) => {
    const result = await redirectHostOf(target);
    if (result.rejected) {
      record(`AU2b: ${target} → rechazado por Auth`);
      return;
    }
    for (const value of [result.fromProps, result.fromLink]) {
      const host = value ? new URL(value).hostname : "";
      expect(host).not.toContain("evil.com");
    }
    record(`AU2b: ${target} → sustituido por ${result.fromProps || "(vacío)"}`);
  });
});
