// Supabase SIMULADO para el E2E local (E1, Fase 2.8). Nunca habla con
// Supabase real ni necesita red: escucha solo en 127.0.0.1.
//
// Cubre únicamente lo que usa el flujo probado:
//   Auth  — /auth/v1/otp (magic link con PKCE; crea el usuario si no existe,
//           como con signups activos), /auth/v1/verify (el enlace del email),
//           /auth/v1/token (pkce y refresh_token), /auth/v1/user,
//           /auth/v1/logout. Redirect permitido: exactamente APP_ORIGIN/callback.
//   REST  — profiles, housing_preferences, cities, universities y
//           neighborhoods, con la RLS, los GRANT de columnas y los triggers
//           de las migraciones emulados (ver comentarios). No es Supabase:
//           tests/db y la validación real (E2) cubren la base de datos real.
//           Fase 3: compatibility_responses (authenticated solo lee su fila;
//           solo service_role escribe, con las reglas del trigger S1–S6) y,
//           con la clave service_role ficticia, la lectura cruzada de
//           candidatos: GET /profiles con housing_preferences!inner y
//           compatibility_responses!inner embebidos.
//   Test  — /__test/*: el "buzón" (último enlace enviado a un email), reset,
//           desactivar una cuenta (operación de servidor) y leer el estado.
//
// Uso: node tests/e2e/support/mock-supabase.mjs   (puerto y origen en mock-config.mjs)
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import {
  APP_ORIGIN,
  MOCK_ANON_KEY,
  MOCK_SERVICE_ROLE_KEY,
  MOCK_SUPABASE_PORT as PORT,
} from "./mock-config.mjs";

const ALLOWED_REDIRECT = `${APP_ORIGIN}/callback`;
// Secreto de firma aleatorio por arranque: solo lo conoce este proceso.
const JWT_SECRET = randomBytes(32);
const SELF = `http://127.0.0.1:${PORT}`;

// ---------------------------------------------------------------- datos
const BCN = "11111111-1111-4111-8111-111111111111";
const MAD = "33333333-3333-4333-8333-333333333333";
const REFERENCE = {
  cities: [
    { id: BCN, name: "Barcelona", slug: "barcelona", is_active: true },
    { id: MAD, name: "Madrid", slug: "madrid", is_active: false },
  ],
  universities: [
    {
      id: "22222222-2222-4222-8222-222222222222",
      name: "Universitat Politècnica de Catalunya (UPC)",
      slug: "upc",
      city_id: BCN,
    },
    {
      id: "44444444-4444-4444-8444-444444444444",
      name: "Universidad Complutense (UCM)",
      slug: "ucm",
      city_id: MAD,
    },
  ],
  neighborhoods: [
    {
      id: "55555555-5555-4555-8555-555555555555",
      name: "Gràcia",
      slug: "gracia",
      city_id: BCN,
    },
    {
      id: "66666666-6666-4666-8666-666666666666",
      name: "Sants",
      slug: "sants",
      city_id: BCN,
    },
    {
      id: "77777777-7777-4777-8777-777777777777",
      name: "Lavapiés",
      slug: "lavapies",
      city_id: MAD,
    },
  ],
};

// GRANT de columnas (20260926120000, 20260925120100, 20260929120000).
const PROFILE_INSERT = [
  "id",
  "full_name",
  "date_of_birth",
  "avatar_url",
  "bio",
  "seeking_status",
  "email_notifications_enabled",
  "onboarding_completed_at",
];
const PROFILE_UPDATE = PROFILE_INSERT.filter((c) => c !== "id");
const PREFS_UPDATE = [
  "city_id",
  "university_id",
  "field_of_study",
  "budget_min",
  "budget_max",
  "move_in_date",
  "move_out_date",
  "preferred_neighborhood_ids",
  "roommates_wanted_min",
  "roommates_wanted_max",
];
const PREFS_INSERT = ["profile_id", ...PREFS_UPDATE];

let state;
function reset() {
  state = {
    users: new Map(), // id → { id, email }
    otps: new Map(), // token → { userId, challenge, redirect, used }
    codes: new Map(), // auth code → { userId, challenge, used }
    sessions: new Map(), // refresh token → { userId, revoked }
    outbox: [], // { to, link }
    profiles: new Map(),
    preferences: new Map(),
    responses: new Map(), // profile_id → compatibility_responses
    log: [],
  };
}
reset();

// ---------------------------------------------------------------- JWT
const b64 = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
function signJwt(payload) {
  const body = `${b64({ alg: "HS256", typ: "JWT" })}.${b64(payload)}`;
  return `${body}.${createHmac("sha256", JWT_SECRET).update(body).digest("base64url")}`;
}
function verifyJwt(token) {
  const [header, payload, signature] = (token ?? "").split(".");
  if (!signature) return null;
  const expected = createHmac("sha256", JWT_SECRET)
    .update(`${header}.${payload}`)
    .digest("base64url");
  if (expected !== signature) return null;
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
  if (claims.exp < Date.now() / 1000) return null;
  const session = state.sessions.get(claims.session_id);
  if (!session || session.revoked) return null;
  return claims;
}
function issueSession(userId) {
  const refresh = randomBytes(24).toString("base64url");
  state.sessions.set(refresh, { userId, revoked: false });
  const expiresIn = 3600;
  const expiresAt = Math.floor(Date.now() / 1000) + expiresIn;
  const user = publicUser(userId);
  return {
    access_token: signJwt({
      sub: userId,
      role: "authenticated",
      aud: "authenticated",
      exp: expiresAt,
      email: user.email,
      session_id: refresh,
    }),
    token_type: "bearer",
    expires_in: expiresIn,
    expires_at: expiresAt,
    refresh_token: refresh,
    user,
  };
}
function publicUser(userId) {
  const user = state.users.get(userId);
  return {
    id: user.id,
    aud: "authenticated",
    role: "authenticated",
    email: user.email,
    app_metadata: { provider: "email" },
    user_metadata: {},
    created_at: user.created_at,
  };
}
const s256 = (verifier) => createHash("sha256").update(verifier).digest("base64url");

// ---------------------------------------------------------------- HTTP
function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    "content-type": "application/json",
    "access-control-allow-origin": APP_ORIGIN,
    "access-control-allow-credentials": "true",
    ...headers,
  });
  res.end(body === undefined ? "" : JSON.stringify(body));
}
const pgError = (res, status, code, message) =>
  send(res, status, { code, message, details: null, hint: null });

function authError(res, status, errorCode, msg) {
  send(res, status, { code: status, error_code: errorCode, msg });
}

// ---------------------------------------------------------------- Auth
function handleAuth(req, res, url, body) {
  const path = url.pathname.replace("/auth/v1", "");
  if (path === "/otp" && req.method === "POST") {
    const email = String(body.email ?? "")
      .trim()
      .toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
      return authError(res, 400, "validation_failed", "invalid email");
    if (!body.code_challenge || body.code_challenge_method?.toLowerCase() !== "s256") {
      return authError(res, 400, "validation_failed", "PKCE requerido en E1");
    }
    let user = [...state.users.values()].find((u) => u.email === email);
    if (!user) {
      if (body.create_user === false)
        return authError(res, 422, "otp_disabled", "Signups not allowed for otp");
      user = { id: randomUUID(), email, created_at: new Date().toISOString() };
      state.users.set(user.id, user);
    }
    // Como Supabase: un redirect fuera de la lista vuelve a la Site URL.
    const requested = url.searchParams.get("redirect_to");
    const redirect = requested === ALLOWED_REDIRECT ? ALLOWED_REDIRECT : APP_ORIGIN;
    const token = randomBytes(16).toString("hex");
    state.otps.set(token, {
      userId: user.id,
      challenge: body.code_challenge,
      redirect,
      used: false,
    });
    state.outbox.push({
      to: email,
      link: `${SELF}/auth/v1/verify?token=${token}&type=magiclink&redirect_to=${encodeURIComponent(redirect)}`,
    });
    return send(res, 200, {});
  }
  if (path === "/verify" && req.method === "GET") {
    const otp = state.otps.get(url.searchParams.get("token"));
    const fallback =
      url.searchParams.get("redirect_to") === ALLOWED_REDIRECT
        ? ALLOWED_REDIRECT
        : APP_ORIGIN;
    if (!otp || otp.used) {
      const target = new URL(fallback);
      target.searchParams.set("error", "access_denied");
      target.searchParams.set("error_code", "otp_expired");
      target.searchParams.set(
        "error_description",
        "Email link is invalid or has expired"
      );
      return send(res, 303, undefined, { location: target.toString() });
    }
    otp.used = true;
    const code = randomUUID();
    state.codes.set(code, { userId: otp.userId, challenge: otp.challenge, used: false });
    const target = new URL(otp.redirect);
    target.searchParams.set("code", code);
    return send(res, 303, undefined, { location: target.toString() });
  }
  if (path === "/token" && req.method === "POST") {
    const grant = url.searchParams.get("grant_type");
    if (grant === "pkce") {
      const entry = state.codes.get(body.auth_code);
      if (!entry || entry.used)
        return authError(
          res,
          404,
          "flow_state_not_found",
          "invalid flow state, no valid flow state found"
        );
      entry.used = true;
      if (!body.code_verifier || s256(body.code_verifier) !== entry.challenge) {
        return authError(
          res,
          400,
          "bad_code_verifier",
          "code challenge does not match previously saved code verifier"
        );
      }
      return send(res, 200, issueSession(entry.userId));
    }
    if (grant === "refresh_token") {
      const session = state.sessions.get(body.refresh_token);
      if (!session || session.revoked)
        return authError(res, 400, "refresh_token_not_found", "Invalid Refresh Token");
      session.revoked = true;
      return send(res, 200, issueSession(session.userId));
    }
    return authError(res, 400, "unsupported_grant_type", "unsupported grant type");
  }
  if (path === "/user" && req.method === "GET") {
    const claims = verifyJwt((req.headers.authorization ?? "").replace(/^Bearer /, ""));
    if (!claims) return authError(res, 403, "bad_jwt", "invalid JWT");
    return send(res, 200, publicUser(claims.sub));
  }
  if (path === "/logout" && req.method === "POST") {
    const claims = verifyJwt((req.headers.authorization ?? "").replace(/^Bearer /, ""));
    if (claims) {
      // scope=global (el default de signOut): todas las sesiones del usuario.
      for (const session of state.sessions.values())
        if (session.userId === claims.sub) session.revoked = true;
    }
    return send(res, 204);
  }
  return authError(res, 404, "not_found", "not found");
}

// ---------------------------------------------------------------- REST
function parseSelect(url) {
  const select = url.searchParams.get("select");
  if (!select) return null;
  const columns = select.split(",").map((c) => c.trim());
  // Regla del proyecto: nunca select("*"). El mock la hace cumplir.
  if (columns.includes("*"))
    throw Object.assign(new Error("select=* no permitido en ROOMLY"), {
      status: 400,
      code: "E1SEL",
    });
  return columns;
}
/** ¿Cumple `value` el filtro PostgREST `raw` (eq., neq., is.null, not.is.null, in.())? */
function matches(value, raw, column) {
  if (raw.startsWith("eq."))
    return value !== null && value !== undefined && String(value) === raw.slice(3);
  if (raw.startsWith("neq."))
    return value !== null && value !== undefined && String(value) !== raw.slice(4);
  if (raw === "is.null") return value === null || value === undefined;
  if (raw === "not.is.null") return value !== null && value !== undefined;
  if (raw.startsWith("in.(")) {
    const values = raw
      .slice(4, -1)
      .split(",")
      .map((v) => v.replace(/"/g, ""));
    return values.includes(String(value));
  }
  throw Object.assign(new Error(`filtro no soportado: ${column}=${raw}`), {
    status: 400,
    code: "E1FLT",
  });
}
function applyFilters(rows, url) {
  let out = rows;
  for (const [column, raw] of url.searchParams) {
    if (["select", "order", "limit", "columns"].includes(column)) continue;
    // Filtros sobre recursos embebidos: los aplica quien hace el embed.
    if (column.includes(".")) continue;
    out = out.filter((row) => matches(row[column], raw, column));
  }
  const order = url.searchParams.get("order");
  if (order) {
    const [column] = order.split(".");
    out = [...out].sort((a, b) => String(a[column]).localeCompare(String(b[column])));
  }
  return out;
}
const project = (row, columns) =>
  columns ? Object.fromEntries(columns.map((c) => [c, row[c] ?? null])) : row;

function respondRows(req, res, rows, columns) {
  const projected = rows.map((row) => project(row, columns));
  if ((req.headers.accept ?? "").includes("vnd.pgrst.object")) {
    if (projected.length !== 1)
      return pgError(
        res,
        406,
        "PGRST116",
        "JSON object requested, multiple (or no) rows returned"
      );
    return send(res, 200, projected[0]);
  }
  return send(res, 200, projected);
}

class DbError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
const denied = (table) =>
  new DbError(403, "42501", `permission denied for table ${table}`);
const rlsDenied = (table) =>
  new DbError(
    403,
    "42501",
    `new row violates row-level security policy for table "${table}"`
  );

function checkColumns(table, payload, allowed) {
  for (const column of Object.keys(payload))
    if (!allowed.includes(column)) throw denied(table);
}

// trg_profiles_onboarding_completion (20260930120000).
function onboardingTrigger(profile) {
  if (profile.onboarding_completed_at === null) return;
  const prefs = state.preferences.get(profile.id);
  if (!prefs || prefs.city_id === null) {
    throw new DbError(
      400,
      "23514",
      "onboarding_incomplete: faltan las preferencias de vivienda con ciudad"
    );
  }
}
// Triggers de housing_preferences: ciudad (20260930140000), barrios (20260929120000), universidad (20260930140000).
function preferencesTriggers(next) {
  const profile = state.profiles.get(next.profile_id);
  if (next.city_id === null && profile?.onboarding_completed_at) {
    throw new DbError(
      400,
      "23514",
      "housing_city_required: con el onboarding completado la ciudad es obligatoria"
    );
  }
  if (next.city_id !== null && !REFERENCE.cities.some((c) => c.id === next.city_id)) {
    throw new DbError(
      409,
      "23503",
      'insert or update on table "housing_preferences" violates foreign key constraint "housing_preferences_city_id_fkey"'
    );
  }
  const ids = next.preferred_neighborhood_ids ?? [];
  if (ids.length > 0) {
    if (next.city_id === null)
      throw new DbError(
        400,
        "23514",
        "housing_neighborhoods: no se pueden elegir barrios sin ciudad"
      );
    for (const id of ids) {
      const neighborhood = REFERENCE.neighborhoods.find((n) => n.id === id);
      if (!neighborhood)
        throw new DbError(409, "23503", "housing_neighborhoods: algún barrio no existe");
      if (neighborhood.city_id !== next.city_id)
        throw new DbError(
          400,
          "23514",
          "housing_neighborhoods: algún barrio no pertenece a la ciudad elegida"
        );
    }
  }
  if (next.university_id !== null) {
    const university = REFERENCE.universities.find((u) => u.id === next.university_id);
    if (!university)
      throw new DbError(
        409,
        "23503",
        'insert or update on table "housing_preferences" violates foreign key constraint "housing_preferences_university_id_fkey"'
      );
    if (university.city_id && next.city_id !== university.city_id) {
      throw new DbError(
        400,
        "23514",
        "housing_university: la universidad no pertenece a la ciudad elegida"
      );
    }
  }
}

// trg_compatibility_responses_integrity (20261007120000), para todos los
// roles (también service_role), y las restricciones S1/S2 de la tabla.
function compatibilityTrigger(old, next) {
  if (!Number.isInteger(next.questionnaire_version))
    throw new DbError(
      400,
      "23502",
      'null value in column "questionnaire_version" of relation "compatibility_responses" violates not-null constraint'
    );
  if (next.questionnaire_version < 1)
    throw new DbError(
      400,
      "23514",
      'violates check constraint "chk_compatibility_responses_version"'
    );
  if (
    typeof next.answers !== "object" ||
    next.answers === null ||
    Array.isArray(next.answers)
  )
    throw new DbError(400, "23514", 'violates check constraint "chk_answers_is_object"');
  if (old && next.profile_id !== old.profile_id)
    throw new DbError(
      400,
      "23514",
      "compatibility_profile_locked: el perfil no se puede cambiar"
    );
  const profile = state.profiles.get(next.profile_id);
  if (!profile || profile.deleted_at !== null)
    throw new DbError(
      400,
      "23514",
      "account_deleted: la cuenta no existe o está desactivada"
    );
  if (old) {
    if (next.questionnaire_version < old.questionnaire_version)
      throw new DbError(
        400,
        "23514",
        "questionnaire_version_downgrade: la versión no puede bajar"
      );
    if (
      next.questionnaire_version === old.questionnaire_version &&
      old.completed_at !== null &&
      next.completed_at !== old.completed_at
    )
      throw new DbError(
        400,
        "23514",
        "questionnaire_completed_locked: ya completado en esta versión"
      );
  }
}

/** `select` con recursos embebidos: separa por comas de primer nivel. */
function parseEmbeddedSelect(select) {
  const parts = [];
  let depth = 0;
  let current = "";
  for (const char of select) {
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (char === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
    } else current += char;
  }
  if (current.trim()) parts.push(current.trim());
  const columns = [];
  const embeds = [];
  for (const part of parts) {
    const match = /^([a-z_]+)(!inner)?\((.*)\)$/.exec(part);
    if (match)
      embeds.push({
        table: match[1],
        inner: Boolean(match[2]),
        columns: match[3].split(",").map((c) => c.trim()),
      });
    else columns.push(part);
  }
  if ([...columns, ...embeds.flatMap((e) => e.columns)].includes("*"))
    throw Object.assign(new Error("select=* no permitido en ROOMLY"), {
      status: 400,
      code: "E1SEL",
    });
  return { columns, embeds };
}

// Lectura cruzada de candidatos (solo service_role): profiles con
// housing_preferences y compatibility_responses embebidos (uno a uno, como
// objeto). `!inner` + filtro sobre el embebido = la fila solo sale si cumple.
const EMBED_SOURCES = {
  housing_preferences: (id) => state.preferences.get(id) ?? null,
  compatibility_responses: (id) => state.responses.get(id) ?? null,
};
function candidateRows(url) {
  const { columns, embeds } = parseEmbeddedSelect(url.searchParams.get("select") ?? "");
  const embeddedFilters = [...url.searchParams].filter(([key]) => key.includes("."));
  const rows = [];
  for (const profile of applyFilters([...state.profiles.values()], url)) {
    const row = project(profile, columns);
    let keep = true;
    for (const embed of embeds) {
      if (!(embed.table in EMBED_SOURCES))
        throw new DbError(400, "PGRST200", `no hay relación con ${embed.table}`);
      const source = EMBED_SOURCES[embed.table](profile.id);
      const passes =
        source !== null &&
        embeddedFilters
          .filter(([key]) => key.startsWith(`${embed.table}.`))
          .every(([key, raw]) =>
            matches(source[key.slice(embed.table.length + 1)], raw, key)
          );
      if (!passes && embed.inner) keep = false;
      row[embed.table] = passes ? project(source, embed.columns) : null;
    }
    if (keep) rows.push(row);
  }
  return rows;
}

const EMPTY_PREFS = {
  city_id: null,
  university_id: null,
  field_of_study: null,
  budget_min: null,
  budget_max: null,
  move_in_date: null,
  move_out_date: null,
  preferred_neighborhood_ids: [],
  roommates_wanted_min: null,
  roommates_wanted_max: null,
};

function handleService(req, res, url, body, table) {
  // service_role (BYPASSRLS): solo lo que usa la app en el servidor.
  if (table === "profiles" && req.method === "GET") {
    return respondRows(req, res, candidateRows(url), null);
  }
  if (table === "compatibility_responses") {
    const columns = parseSelect(url);
    if (req.method === "GET")
      return respondRows(
        req,
        res,
        applyFilters([...state.responses.values()], url),
        columns
      );
    if (req.method === "POST") {
      if (state.responses.has(body.profile_id))
        throw new DbError(
          409,
          "23505",
          'duplicate key value violates unique constraint "compatibility_responses_pkey"'
        );
      const row = { completed_at: null, ...body, updated_at: new Date().toISOString() };
      compatibilityTrigger(null, row);
      state.responses.set(row.profile_id, row);
      return respondRows(req, res, [row], columns);
    }
    if (req.method === "PATCH") {
      const targets = applyFilters([...state.responses.values()], url);
      const updated = targets.map((old) => {
        const next = { ...old, ...body, updated_at: new Date().toISOString() };
        compatibilityTrigger(old, next);
        return next;
      });
      updated.forEach((row) => state.responses.set(row.profile_id, row));
      return respondRows(req, res, updated, columns);
    }
  }
  throw new DbError(400, "E1SRV", `service_role no emulado para ${req.method} ${table}`);
}

function handleRest(req, res, url, body, uid, isService) {
  const table = url.pathname.replace("/rest/v1/", "");
  if (isService && !(table in REFERENCE))
    return handleService(req, res, url, body, table);
  const columns = parseSelect(url);

  if (table in REFERENCE) {
    if (req.method !== "GET") throw denied(table);
    return respondRows(req, res, applyFilters(REFERENCE[table], url), columns);
  }
  if (!uid) throw denied(table); // anon: sin privilegios útiles en estas tablas

  if (table === "compatibility_responses") {
    // compatibility_responses_select_own; sin INSERT/UPDATE/DELETE (GRANT,
    // 20261007120000): authenticated nunca escribe aquí.
    if (req.method !== "GET") throw denied(table);
    const own = [...state.responses.values()].filter((r) => r.profile_id === uid);
    return respondRows(req, res, applyFilters(own, url), columns);
  }

  if (table === "profiles") {
    // profiles_select_own_even_if_deleted: solo la fila propia, también
    // eliminada (Fase 2.9, H4: ya no existe profiles_select_authenticated).
    // profiles_admin_all no se emula: el mock nunca crea admins (role "user").
    const visible = () => [...state.profiles.values()].filter((p) => p.id === uid);
    if (req.method === "GET")
      return respondRows(req, res, applyFilters(visible(), url), columns);
    if (req.method === "POST") {
      checkColumns(table, body, PROFILE_INSERT);
      // profiles_insert_own: id = auth.uid(), role user, sin deleted_at.
      if (body.id !== uid) throw rlsDenied(table);
      if (state.profiles.has(body.id))
        throw new DbError(
          409,
          "23505",
          'duplicate key value violates unique constraint "profiles_pkey"'
        );
      if (!body.seeking_status)
        throw new DbError(
          400,
          "23502",
          'null value in column "seeking_status" of relation "profiles" violates not-null constraint'
        );
      const row = {
        bio: null,
        avatar_url: null,
        email_notifications_enabled: true,
        onboarding_completed_at: null,
        ...body,
        role: "user",
        deleted_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      onboardingTrigger(row);
      state.profiles.set(row.id, row);
      return respondRows(req, res, [row], columns);
    }
    if (req.method === "PATCH") {
      checkColumns(table, body, PROFILE_UPDATE);
      if (typeof body.bio === "string" && [...body.bio].length > 500) {
        throw new DbError(
          400,
          "23514",
          'new row violates check constraint "chk_profiles_bio_length"'
        );
      }
      // profiles_update_own: dueño y cuenta activa (20260930130000).
      const targets = applyFilters(visible(), url).filter(
        (p) => p.id === uid && p.deleted_at === null
      );
      const updated = targets.map((p) => ({
        ...p,
        ...body,
        updated_at: new Date().toISOString(),
      }));
      updated.forEach(onboardingTrigger);
      updated.forEach((p) => state.profiles.set(p.id, p));
      return respondRows(req, res, updated, columns);
    }
  }

  if (table === "housing_preferences") {
    // housing_preferences_select_own.
    const own = () => [...state.preferences.values()].filter((p) => p.profile_id === uid);
    const activeOwner = () => state.profiles.get(uid)?.deleted_at === null;
    if (req.method === "GET")
      return respondRows(req, res, applyFilters(own(), url), columns);
    if (req.method === "POST") {
      checkColumns(table, body, PREFS_INSERT);
      if (!state.profiles.has(body.profile_id)) {
        throw new DbError(
          409,
          "23503",
          'insert or update on table "housing_preferences" violates foreign key constraint "housing_preferences_profile_id_fkey"'
        );
      }
      // housing_preferences_insert_own: dueño con cuenta activa.
      if (body.profile_id !== uid || !activeOwner()) throw rlsDenied(table);
      if (state.preferences.has(uid))
        throw new DbError(
          409,
          "23505",
          'duplicate key value violates unique constraint "housing_preferences_pkey"'
        );
      const row = {
        profile_id: uid,
        ...EMPTY_PREFS,
        ...body,
        updated_at: new Date().toISOString(),
      };
      preferencesTriggers(row);
      state.preferences.set(uid, row);
      return respondRows(req, res, [row], columns);
    }
    if (req.method === "PATCH") {
      checkColumns(table, body, PREFS_UPDATE);
      // housing_preferences_update_own: dueño con cuenta activa.
      const targets = activeOwner() ? applyFilters(own(), url) : [];
      const updated = targets.map((p) => ({
        ...p,
        ...body,
        updated_at: new Date().toISOString(),
      }));
      updated.forEach(preferencesTriggers);
      updated.forEach((p) => state.preferences.set(p.profile_id, p));
      return respondRows(req, res, updated, columns);
    }
  }
  throw new DbError(404, "42P01", `relation "public.${table}" does not exist`);
}

// ---------------------------------------------------------------- test hooks
/** Respuestas sembradas: `answer` (1 por defecto) en cada id de `ids`. */
function seededAnswers(params) {
  const answer = Number(params.get("answer") ?? "1");
  return Object.fromEntries(
    (params.get("ids") ?? "")
      .split(",")
      .filter(Boolean)
      .map((k) => [k, answer])
  );
}
/** Máximo de una columna `integer` de PostgreSQL. */
const PG_INTEGER_MAX = 2147483647;
/**
 * `version` de una siembra, que llega como texto de la URL. Dos reglas
 * distintas:
 *   - Valor: el rango de la columna `questionnaire_version` (`integer NOT
 *     NULL`, `CHECK >= 1`), de 1 a 2147483647.
 *   - Formato: una convención de este mock, no de PostgreSQL. Solo se acepta
 *     la forma decimal canónica, la que emiten los helpers de siembra
 *     (`String(version)`): sin signo, espacios ni ceros a la izquierda.
 *     PostgreSQL convertiría en 2 textos como '02', ' 2 ' o '+2'; el mock los
 *     rechaza a propósito.
 * Si falta o no cumple las dos reglas (vacía, "null", "0", "1.5"…), null: la
 * siembra responde 400 sin guardar nada. No se usa `Number()` sin más:
 * `Number(null)` y `Number("")` dan 0.
 */
function seedVersion(params) {
  const raw = params.get("version");
  if (raw === null || !/^[1-9][0-9]*$/.test(raw)) return null;
  const version = Number(raw);
  return version <= PG_INTEGER_MAX ? version : null;
}
function findUser(email) {
  return [...state.users.values()].find(
    (u) => u.email === String(email ?? "").toLowerCase()
  );
}
function handleTest(req, res, url) {
  const email = url.searchParams.get("email");
  switch (url.pathname) {
    case "/__test/reset":
      reset();
      return send(res, 200, { ok: true });
    case "/__test/outbox": {
      const mail = state.outbox
        .filter((m) => m.to === String(email).toLowerCase())
        .at(-1);
      return mail ? send(res, 200, mail) : send(res, 404, { error: "sin correo" });
    }
    case "/__test/deactivate": {
      // Operación de servidor (borrado de cuenta), fuera del alcance del cliente.
      const user = findUser(email);
      const profile = user && state.profiles.get(user.id);
      if (!profile) return send(res, 404, { error: "sin perfil" });
      profile.deleted_at = new Date().toISOString();
      return send(res, 200, { ok: true });
    }
    case "/__test/user": {
      const user = findUser(email);
      if (!user) return send(res, 404, { error: "sin usuario" });
      return send(res, 200, {
        id: user.id,
        profile: state.profiles.get(user.id) ?? null,
        preferences: state.preferences.get(user.id) ?? null,
        compatibility: state.responses.get(user.id) ?? null,
      });
    }
    case "/__test/log":
      return send(res, 200, state.log);
    case "/__test/seed-own-response": {
      // Test propio ya guardado (datos de servidor), p. ej. en una versión
      // anterior del cuestionario. Parámetros: email, version (obligatoria),
      // ids (separados por comas), answer (valor para todas), completed ("1").
      const user = findUser(email);
      if (!user || !state.profiles.get(user.id))
        return send(res, 404, { error: "sin perfil" });
      const q = url.searchParams;
      const version = seedVersion(q);
      if (version === null) return send(res, 400, { error: "version no válida" });
      const now = new Date().toISOString();
      state.responses.set(user.id, {
        profile_id: user.id,
        questionnaire_version: version,
        answers: seededAnswers(q),
        completed_at: q.get("completed") === "1" ? now : null,
        updated_at: now,
      });
      return send(res, 200, { ok: true });
    }
    case "/__test/seed-candidate": {
      // Otra persona que ya terminó onboarding y test (datos de servidor).
      // Parámetros: email, name, birth, role, deleted, budget_min, budget_max,
      // neighborhoods (ids separados por comas), version (obligatoria: la del
      // test guardado), ids y answer (valor para todas).
      const q = url.searchParams;
      const version = seedVersion(q);
      if (version === null) return send(res, 400, { error: "version no válida" });
      const id = randomUUID();
      const now = new Date().toISOString();
      state.users.set(id, { id, email: String(email).toLowerCase(), created_at: now });
      state.profiles.set(id, {
        id,
        full_name: q.get("name") ?? "Candidata",
        date_of_birth: q.get("birth") ?? "2001-03-15",
        avatar_url: null,
        bio: null,
        seeking_status: "looking_for_room",
        role: q.get("role") ?? "user",
        email_notifications_enabled: true,
        onboarding_completed_at: now,
        created_at: now,
        updated_at: now,
        deleted_at: q.get("deleted") === "1" ? now : null,
      });
      const number = (key) => (q.get(key) === null ? null : Number(q.get(key)));
      state.preferences.set(id, {
        profile_id: id,
        ...EMPTY_PREFS,
        city_id: q.get("city") ?? BCN,
        budget_min: number("budget_min"),
        budget_max: number("budget_max"),
        preferred_neighborhood_ids: q.get("neighborhoods")
          ? q.get("neighborhoods").split(",")
          : [],
        university_id: q.get("university"),
        updated_at: now,
      });
      state.responses.set(id, {
        profile_id: id,
        questionnaire_version: version,
        answers: seededAnswers(q),
        completed_at: now,
        updated_at: now,
      });
      return send(res, 200, { id });
    }
    default:
      return send(res, 404, {});
  }
}

// ---------------------------------------------------------------- servidor
const server = createServer((req, res) => {
  let raw = "";
  req.on("data", (chunk) => (raw += chunk));
  req.on("end", () => {
    const url = new URL(req.url, SELF);
    if (req.method === "OPTIONS") {
      return send(res, 204, undefined, {
        "access-control-allow-headers": "*",
        "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
      });
    }
    if (url.pathname.startsWith("/__test/")) return handleTest(req, res, url);

    const apikey = req.headers.apikey;
    const bearer = (req.headers.authorization ?? "").replace(/^Bearer /, "");
    state.log.push({
      method: req.method,
      path: url.pathname,
      apikeyIsAnon: apikey === MOCK_ANON_KEY,
      apikeyIsService: apikey === MOCK_SERVICE_ROLE_KEY,
      bearerRole:
        bearer === MOCK_ANON_KEY
          ? "anon"
          : bearer === MOCK_SERVICE_ROLE_KEY
            ? "service_role"
            : (verifyJwt(bearer)?.role ?? "none"),
    });
    // El enlace del email lo abre el navegador sin apikey, como en Supabase.
    const isVerifyLink = url.pathname === "/auth/v1/verify";
    const isService =
      apikey === MOCK_SERVICE_ROLE_KEY && bearer === MOCK_SERVICE_ROLE_KEY;
    if (!isVerifyLink && apikey !== MOCK_ANON_KEY && !isService)
      return authError(res, 401, "no_api_key", "Invalid API key");
    // La clave service_role solo vale para REST (lo que usa la app).
    if (isService && !url.pathname.startsWith("/rest/v1/"))
      return authError(res, 401, "no_api_key", "service_role solo en REST");

    let body = {};
    try {
      body = raw ? JSON.parse(raw) : {};
    } catch {
      return pgError(res, 400, "PGRST102", "Invalid JSON");
    }
    try {
      if (url.pathname.startsWith("/auth/v1/")) return handleAuth(req, res, url, body);
      if (url.pathname.startsWith("/rest/v1/")) {
        const claims =
          bearer && bearer !== MOCK_ANON_KEY && !isService ? verifyJwt(bearer) : null;
        if (bearer && bearer !== MOCK_ANON_KEY && !isService && !claims)
          return pgError(res, 401, "PGRST301", "JWT expired");
        return handleRest(
          req,
          res,
          url,
          Array.isArray(body) ? body[0] : body,
          claims?.sub ?? null,
          isService
        );
      }
      return send(res, 404, {});
    } catch (error) {
      if (error instanceof DbError || error.status)
        return pgError(res, error.status, error.code, error.message);
      console.error(error);
      return pgError(res, 500, "XX000", "internal mock error");
    }
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`mock-supabase listo en ${SELF} (app ${APP_ORIGIN})`);
});
