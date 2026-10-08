#!/usr/bin/env node
// Preparación y limpieza del E2E real (E2, Fase 2.8). Paso PROPIO del
// workflow, con service_role: nunca se ejecuta dentro de la app ni del spec.
//
//   node tests/e2e/real/cleanup.mjs before   → comprueba Auth (email y
//       registro activos) y borra restos de ejecuciones anteriores.
//   node tests/e2e/real/cleanup.mjs after    → borra el usuario de esta
//       ejecución (y sus datos, en cascada), comprueba que no queda nada y
//       vacía el buzón de esa dirección. Después, aunque algo de eso falle,
//       avisa si el registro sigue abierto (withSignupCheck).
//
// Antes de tocar nada ejecuta tests/supabase/guard.sh (marca
// roomly-validation-3). Nunca imprime emails, ids, claves ni enlaces: solo
// recuentos.
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import {
  checkAuthSettings,
  loadMailbox,
  selectUsersToDelete,
  testEmail,
  withSignupCheck,
} from "./e2e-real-lib.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const phase = process.argv[2];
if (phase !== "before" && phase !== "after") {
  console.error("uso: cleanup.mjs before|after");
  process.exit(2);
}

function summary(line) {
  console.log(line);
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${line}\n`);
}

function guard() {
  try {
    execFileSync(
      "bash",
      [
        path.join(ROOT, "tests/supabase/guard.sh"),
        "SUPABASE_VALIDATION_SERVICE_ROLE_KEY",
      ],
      {
        stdio: ["ignore", "pipe", "pipe"],
        env: process.env,
      }
    );
  } catch (error) {
    const stderr = error.stderr?.toString().trim() ?? "";
    throw new Error(`guarda F1 no superada; no se toca nada.\n${stderr}`);
  }
}

async function authSettings(url, anonKey) {
  const response = await fetch(`${url}/auth/v1/settings`, {
    headers: { apikey: anonKey },
  });
  if (!response.ok)
    throw new Error(`no se pudieron leer los ajustes de Auth (HTTP ${response.status})`);
  return response.json();
}

async function listAllUsers(admin) {
  const users = [];
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`listUsers falló (${error.status ?? "?"})`);
    users.push(...data.users);
    if (data.users.length < 200) return users;
  }
  throw new Error(
    "demasiados usuarios en el proyecto de validación; no se limpia a ciegas"
  );
}

async function main() {
  guard();
  const env = process.env;
  const url = env.SUPABASE_VALIDATION_URL;
  const email = testEmail(env.E2E_EMAIL_TEMPLATE, env.E2E_RUN_ID);
  const admin = createClient(url, env.SUPABASE_VALIDATION_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  if (phase === "before") {
    const problems = checkAuthSettings(
      await authSettings(url, env.SUPABASE_VALIDATION_ANON_KEY),
      "before"
    );
    if (problems.length > 0)
      throw new Error(`Auth no está listo para el E2E real: ${problems.join("; ")}`);
    summary("E2 preparación: Auth con email y registro activos");
    await deleteTestUsers(admin, env.E2E_EMAIL_TEMPLATE, "preparación");
    return;
  }

  await withSignupCheck(
    async () => {
      await deleteTestUsers(admin, env.E2E_EMAIL_TEMPLATE, "limpieza");
      const mailbox = await loadMailbox(env, ROOT);
      await mailbox.deleteMessages(email);
      summary("E2 limpieza: mensajes del buzón de prueba borrados");
    },
    () => authSettings(url, env.SUPABASE_VALIDATION_ANON_KEY),
    {
      warning(text) {
        console.log(`::warning::${text}`);
        summary(`⚠️ ${text}`);
      },
      info: summary,
    }
  );
}

/**
 * Usuarios de prueba (de esta ejecución o restos de otras): se borran; el
 * perfil y las preferencias caen en cascada (profiles → auth.users,
 * housing_preferences → profiles, ON DELETE CASCADE).
 */
async function deleteTestUsers(admin, template, label) {
  const toDelete = selectUsersToDelete(await listAllUsers(admin), template);
  for (const user of toDelete) {
    const { error } = await admin.auth.admin.deleteUser(user.id);
    if (error) throw new Error(`deleteUser falló (${error.status ?? "?"})`);
  }
  const ids = toDelete.map((user) => user.id);
  const remaining = selectUsersToDelete(await listAllUsers(admin), template);
  if (remaining.length > 0)
    throw new Error(`quedan ${remaining.length} usuarios de prueba tras borrar`);
  if (ids.length > 0) {
    for (const table of ["profiles", "housing_preferences"]) {
      const column = table === "profiles" ? "id" : "profile_id";
      const { count, error } = await admin
        .from(table)
        .select(column, { count: "exact", head: true })
        .in(column, ids);
      if (error) throw new Error(`comprobación de ${table} falló (${error.code ?? "?"})`);
      if (count !== 0)
        throw new Error(`quedan ${count} filas de ${table} de los usuarios borrados`);
    }
  }
  summary(
    `E2 ${label}: ${toDelete.length} usuario(s) de prueba borrado(s), sin datos asociados`
  );
}

main().catch((error) => {
  // Solo el mensaje propio: nunca el objeto de error de supabase-js (podría
  // llevar la URL de la petición o cabeceras).
  console.error(`ERROR: ${error.message}`);
  process.exit(1);
});
