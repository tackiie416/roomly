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
//   Test  — /__test/*: el "buzón" (último enlace enviado a un email), reset,
//           desactivar una cuenta (operación de servidor) y leer el estado.
//
// Uso: node tests/e2e/support/mock-supabase.mjs   (puerto y origen en mock-config.mjs)
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { APP_ORIGIN, MOCK_ANON_KEY, MOCK_SUPABASE_PORT as PORT } from "./mock-config.mjs";

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
function applyFilters(rows, url) {
  let out = rows;
  for (const [column, raw] of url.searchParams) {
    if (["select", "order", "limit", "columns"].includes(column)) continue;
    if (raw.startsWith("eq."))
      out = out.filter((row) => String(row[column]) === raw.slice(3));
    else if (raw === "is.null") out = out.filter((row) => row[column] === null);
    else if (raw.startsWith("in.(")) {
      const values = raw
        .slice(4, -1)
        .split(",")
        .map((v) => v.replace(/"/g, ""));
      out = out.filter((row) => values.includes(String(row[column])));
    } else
      throw Object.assign(new Error(`filtro no soportado: ${column}=${raw}`), {
        status: 400,
        code: "E1FLT",
      });
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

function handleRest(req, res, url, body, uid) {
  const table = url.pathname.replace("/rest/v1/", "");
  const columns = parseSelect(url);

  if (table in REFERENCE) {
    if (req.method !== "GET") throw denied(table);
    return respondRows(req, res, applyFilters(REFERENCE[table], url), columns);
  }
  if (!uid) throw denied(table); // anon: sin privilegios útiles en estas tablas

  if (table === "profiles") {
    // profiles_select_own_even_if_deleted + profiles_select_authenticated (H4).
    const visible = () =>
      [...state.profiles.values()].filter((p) => p.id === uid || p.deleted_at === null);
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
      });
    }
    case "/__test/log":
      return send(res, 200, state.log);
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
      bearerRole: bearer === MOCK_ANON_KEY ? "anon" : (verifyJwt(bearer)?.role ?? "none"),
    });
    // El enlace del email lo abre el navegador sin apikey, como en Supabase.
    const isVerifyLink = url.pathname === "/auth/v1/verify";
    if (!isVerifyLink && apikey !== MOCK_ANON_KEY)
      return authError(res, 401, "no_api_key", "Invalid API key");

    let body = {};
    try {
      body = raw ? JSON.parse(raw) : {};
    } catch {
      return pgError(res, 400, "PGRST102", "Invalid JSON");
    }
    try {
      if (url.pathname.startsWith("/auth/v1/")) return handleAuth(req, res, url, body);
      if (url.pathname.startsWith("/rest/v1/")) {
        const claims = bearer && bearer !== MOCK_ANON_KEY ? verifyJwt(bearer) : null;
        if (bearer && bearer !== MOCK_ANON_KEY && !claims)
          return pgError(res, 401, "PGRST301", "JWT expired");
        return handleRest(
          req,
          res,
          url,
          Array.isArray(body) ? body[0] : body,
          claims?.sub ?? null
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
