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
//           Fase 4.2: rooms (la propietaria lee las suyas y las públicas se
//           leen; desde 20261030120000 ningún cliente borra: solo
//           service_role con rpc/delete_own_room) y room_images (lectura por
//           RLS; solo service_role escribe, con las reglas del trigger), y la
//           API de Storage del bucket privado room-images, solo con
//           service_role: subir, firmar (URL de 10 minutos), borrar y listar.
//           Las URL firmadas se sirven sin apikey, como en Supabase.
//           Sesión 68 (CRUD): INSERT y UPDATE de rooms por authenticated, con
//           el GRANT por columnas de 20261015120000, la RLS de la 4.0
//           (propietaria con la cuenta activa, o rooms_admin_all), los CHECK,
//           las FK (también la compuesta barrio ↔ ciudad) y el trigger de
//           moderación H5. Un admin solo existe si un test lo crea con
//           /__test/make-admin.
//   Test  — /__test/*: el "buzón" (último enlace enviado a un email), reset,
//           desactivar una cuenta (operación de servidor), leer el estado y,
//           desde la Fase 4.2, sembrar una habitación y leer sus fotos y
//           objetos; desde la sesión 68, convertir una cuenta en admin.
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

// WebP de 1×1 px para las fotos sembradas (las subidas pasan por sharp).
const TINY_WEBP = Buffer.from(
  "UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAwA0JaQAA3AA/vuUAAA=",
  "base64"
);

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
// GRANT de columnas de authenticated sobre rooms (20261015120000):
// tests/unit/rooms-crud-static.test.ts comprueba que coinciden con la migración.
const ROOM_DATA_COLUMNS = [
  "title",
  "description",
  "city_id",
  "neighborhood_id",
  "price_month",
  "expenses_included",
  "deposit_amount",
  "available_from",
  "min_stay_months",
  "max_stay_months",
  "total_roommates",
  "total_rooms",
  "features",
  "pets_allowed",
  "smoking_allowed",
  "students_only",
  "house_rules",
  "roommate_preferences",
];
const ROOMS_INSERT = ["id", "owner_id", ...ROOM_DATA_COLUMNS];
const ROOMS_UPDATE = [...ROOM_DATA_COLUMNS, "status"];
// Catálogo cerrado de características (R6, chk_rooms_features_catalog).
const ROOM_FEATURE_KEYS = [
  "wifi",
  "heating",
  "air_conditioning",
  "elevator",
  "washing_machine",
  "dishwasher",
  "balcony",
  "furnished",
  "private_bathroom",
  "double_bed",
  "desk",
  "exterior",
];
// Valores por defecto de las columnas de rooms (20260925120000).
const ROOM_DEFAULTS = {
  description: null,
  neighborhood_id: null,
  approx_lat: null,
  approx_lng: null,
  expenses_included: false,
  deposit_amount: null,
  min_stay_months: null,
  max_stay_months: null,
  total_roommates: null,
  total_rooms: null,
  features: [],
  pets_allowed: false,
  smoking_allowed: false,
  students_only: false,
  house_rules: null,
  roommate_preferences: null,
  status: "draft",
  deleted_at: null,
  // 20261031120000: la pone el trigger trg_rooms_published_at.
  published_at: null,
};
// GRANT de anon sobre rooms (20261031120100): solo las columnas públicas.
// tests/unit/room-search-static.test.ts comprueba que coinciden con la migración.
const ANON_ROOM_COLUMNS = [
  "id",
  "title",
  "description",
  "city_id",
  "neighborhood_id",
  "price_month",
  "expenses_included",
  "deposit_amount",
  "available_from",
  "min_stay_months",
  "max_stay_months",
  "total_roommates",
  "total_rooms",
  "features",
  "pets_allowed",
  "smoking_allowed",
  "students_only",
  "house_rules",
  "roommate_preferences",
  "published_at",
];

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
    rooms: new Map(), // id → rooms (columnas que usa la app)
    images: new Map(), // id → room_images
    objects: new Map(), // ruta en room-images → { body, contentType }
    signTokens: new Map(), // token → { path, expiresAt }
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
/**
 * Compara como PostgreSQL un valor de la fila con el texto de un filtro: los
 * números como números y el resto como texto (fechas ISO, marcas de tiempo
 * del mismo formato y UUID en minúsculas ordenan igual como texto). `null` si
 * el valor es nulo: en SQL, cualquier comparación con NULL no se cumple.
 */
function compareValue(value, text) {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return value - Number(text);
  const a = String(value);
  return a < text ? -1 : a > text ? 1 : 0;
}
const unquote = (text) =>
  text.startsWith('"') && text.endsWith('"') ? text.slice(1, -1) : text;

/** ¿Cumple `value` el filtro PostgREST `raw` (eq., neq., lt/lte/gt/gte., is.null, not.is.null, in.(), cs.{})? */
function matches(value, raw, column) {
  for (const [op, test] of [
    ["lt.", (c) => c < 0],
    ["lte.", (c) => c <= 0],
    ["gt.", (c) => c > 0],
    ["gte.", (c) => c >= 0],
  ]) {
    if (raw.startsWith(op)) {
      const cmp = compareValue(value, unquote(raw.slice(op.length)));
      return cmp !== null && test(cmp);
    }
  }
  if (raw.startsWith("cs.{") && raw.endsWith("}")) {
    // `features @> {a,b}`: el array tiene todos los valores pedidos.
    const wanted = raw.slice(4, -1).split(",").filter(Boolean).map(unquote);
    return Array.isArray(value) && wanted.every((item) => value.includes(item));
  }
  if (raw.startsWith("eq.")) {
    if (value === null || value === undefined) return false;
    if (typeof value === "number") return value === Number(unquote(raw.slice(3)));
    return String(value) === unquote(raw.slice(3));
  }
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
/** Separa por comas de primer nivel (respeta paréntesis y comillas dobles). */
function splitTopLevel(text) {
  const parts = [];
  let depth = 0;
  let quoted = false;
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '"') quoted = !quoted;
    else if (!quoted && char === "(") depth += 1;
    else if (!quoted && char === ")") depth -= 1;
    else if (!quoted && depth === 0 && char === ",") {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}
/**
 * Árbol lógico de PostgREST (`or=(...)`, `and=(...)`): `and(...)`, `or(...)`
 * o una condición `columna.op.valor`. Devuelve la función que lo evalúa y
 * anota en `columns` las columnas que usa (para el GRANT de anon).
 */
function parseLogic(kind, inner, columns) {
  const children = splitTopLevel(inner).map((part) => {
    const nested = /^(and|or)\((.*)\)$/s.exec(part);
    if (nested) return parseLogic(nested[1], nested[2], columns);
    const dot = part.indexOf(".");
    if (dot <= 0)
      throw Object.assign(new Error(`condición no soportada: ${part}`), {
        status: 400,
        code: "E1FLT",
      });
    const column = part.slice(0, dot);
    const raw = part.slice(dot + 1);
    columns.push(column);
    return (row) => matches(row[column], raw, column);
  });
  return kind === "and"
    ? (row) => children.every((test) => test(row))
    : (row) => children.some((test) => test(row));
}
/** Columnas que lee, filtra u ordena una petición (para el GRANT por columnas de anon). */
function requestColumns(url) {
  const columns = [...(parseSelect(url) ?? ["*"])];
  for (const [key, raw] of url.searchParams) {
    if (key === "select" || key === "limit") continue;
    if (key === "order") {
      for (const entry of raw.split(",")) columns.push(entry.split(".")[0]);
    } else if (key === "or" || key === "and") {
      parseLogic(key, raw.slice(1, -1), columns);
    } else {
      columns.push(key);
    }
  }
  return columns;
}
function applyFilters(rows, url) {
  let out = rows;
  for (const [column, raw] of url.searchParams) {
    if (["select", "order", "limit", "columns"].includes(column)) continue;
    // Filtros sobre recursos embebidos: los aplica quien hace el embed.
    if (column.includes(".")) continue;
    if (column === "or" || column === "and") {
      const test = parseLogic(column, raw.slice(1, -1), []);
      out = out.filter(test);
      continue;
    }
    out = out.filter((row) => matches(row[column], raw, column));
  }
  // order=col[.asc|.desc][,col2...]: cada columna, en orden, como texto.
  const order = url.searchParams.get("order");
  if (order) {
    const keys = order.split(",").map((entry) => {
      const [column, direction] = entry.split(".");
      return { column, sign: direction === "desc" ? -1 : 1 };
    });
    out = [...out].sort((a, b) => {
      for (const { column, sign } of keys) {
        const cmp =
          typeof a[column] === "number" && typeof b[column] === "number"
            ? a[column] - b[column]
            : String(a[column]).localeCompare(String(b[column]));
        if (cmp !== 0) return sign * cmp;
      }
      return 0;
    });
  }
  const limit = url.searchParams.get("limit");
  if (limit !== null) out = out.slice(0, Number(limit));
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
  if (table === "rpc/delete_own_room" && req.method === "POST") {
    return send(res, 200, deleteOwnRoom(body));
  }
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
  if (table === "rooms" && req.method === "GET") {
    return respondRows(
      req,
      res,
      applyFilters([...state.rooms.values()], url),
      parseSelect(url)
    );
  }
  if (table === "room_images") {
    const columns = parseSelect(url);
    if (req.method === "POST") {
      const row = { ...body, created_at: new Date().toISOString() };
      roomImagesTrigger(row);
      state.images.set(row.id, row);
      return respondRows(req, res, [row], columns);
    }
    if (req.method === "DELETE") {
      const targets = applyFilters([...state.images.values()], url);
      targets.forEach((image) => state.images.delete(image.id));
      return respondRows(req, res, targets, columns);
    }
  }
  throw new DbError(400, "E1SRV", `service_role no emulado para ${req.method} ${table}`);
}

// ---------------------------------------------------------------- Fase 4.2
const ownerActive = (ownerId) => state.profiles.get(ownerId)?.deleted_at === null;
/** public.is_admin(): rol admin y cuenta activa (solo si un test lo crea). */
const isActiveAdmin = (uid) => {
  const profile = state.profiles.get(uid);
  return profile?.role === "admin" && profile.deleted_at === null;
};
/** rooms_select_own, rooms_select_active_public con R7 y rooms_admin_all. */
const roomVisibleTo = (room, uid) =>
  room.owner_id === uid ||
  isActiveAdmin(uid) ||
  (room.status === "active" && room.deleted_at === null && ownerActive(room.owner_id));
const sortImages = (rows) =>
  [...rows].sort(
    (a, b) =>
      a.position - b.position ||
      a.created_at.localeCompare(b.created_at) ||
      a.id.localeCompare(b.id)
  );

/**
 * Restricciones de una fila de rooms, en el orden de PostgreSQL: NOT NULL y
 * CHECK al escribir la fila, y las FK al final de la sentencia. El mensaje
 * lleva el nombre de la restricción, como el de PostgreSQL.
 */
function roomConstraints(row) {
  for (const column of ["title", "city_id", "price_month", "available_from"])
    if (row[column] === null || row[column] === undefined)
      throw new DbError(
        400,
        "23502",
        `null value in column "${column}" of relation "rooms" violates not-null constraint`
      );
  const check = (name) =>
    new DbError(
      400,
      "23514",
      `new row for relation "rooms" violates check constraint "${name}"`
    );
  if (!(row.price_month > 0)) throw check("chk_price_positive");
  if (row.deposit_amount !== null && row.deposit_amount < 0)
    throw check("chk_deposit_nonneg");
  if (
    row.min_stay_months !== null &&
    row.max_stay_months !== null &&
    row.min_stay_months > row.max_stay_months
  )
    throw check("chk_stay_range");
  if (row.total_roommates !== null && row.total_roommates < 0)
    throw check("chk_rooms_total_roommates");
  if (row.total_rooms !== null && row.total_rooms < 1)
    throw check("chk_rooms_total_rooms");
  if (!row.features.every((key) => ROOM_FEATURE_KEYS.includes(key)))
    throw check("chk_rooms_features_catalog");
  if (new Set(row.features).size !== row.features.length)
    throw check("chk_rooms_features_unique");
  if (
    row.status === "active" &&
    (row.neighborhood_id === null ||
      row.total_roommates === null ||
      row.total_rooms === null)
  )
    throw check("chk_rooms_publishable");
  if (row.status === "active" && !row.published_at) throw check("chk_rooms_published_at");
  const fk = (name) =>
    new DbError(
      409,
      "23503",
      `insert or update on table "rooms" violates foreign key constraint "${name}"`
    );
  if (!REFERENCE.cities.some((city) => city.id === row.city_id))
    throw fk("rooms_city_id_fkey");
  if (row.neighborhood_id !== null) {
    const neighborhood = REFERENCE.neighborhoods.find(
      (n) => n.id === row.neighborhood_id
    );
    if (!neighborhood) throw fk("rooms_neighborhood_id_fkey");
    if (neighborhood.city_id !== row.city_id) throw fk("fk_rooms_neighborhood_city");
  }
}

// trg_rooms_moderation (H5, 20260926120000): solo un admin activo pone o
// quita `removed`.
function roomModeration(old, next, uid) {
  if (
    next.status !== old.status &&
    (old.status === "removed" || next.status === "removed") &&
    !isActiveAdmin(uid)
  )
    throw new DbError(
      403,
      "42501",
      "room_moderation: solo un admin puede cambiar el estado desde o hacia removed"
    );
}

/** La propietaria con la cuenta activa (rooms_*_own, 4.0) o un admin activo (rooms_admin_all). */
const canWriteRoom = (room, uid) =>
  (room.owner_id === uid && ownerActive(uid)) || isActiveAdmin(uid);

function handleUserRooms(req, res, url, body, uid, columns) {
  if (req.method === "GET") {
    const visible = [...state.rooms.values()].filter((room) => roomVisibleTo(room, uid));
    return respondRows(req, res, applyFilters(visible, url), columns);
  }
  if (req.method === "POST") {
    // GRANT por columnas: sin status (nace draft), deleted_at, approx_* ni fechas.
    checkColumns("rooms", body, ROOMS_INSERT);
    if (!canWriteRoom({ owner_id: body.owner_id }, uid)) throw rlsDenied("rooms");
    const now = new Date().toISOString();
    const row = {
      ...ROOM_DEFAULTS,
      ...body,
      id: body.id ?? randomUUID(),
      created_at: now,
      updated_at: now,
    };
    if (state.rooms.has(row.id))
      throw new DbError(
        409,
        "23505",
        'duplicate key value violates unique constraint "rooms_pkey"'
      );
    roomConstraints(row);
    state.rooms.set(row.id, row);
    return respondRows(req, res, [row], columns);
  }
  if (req.method === "PATCH") {
    // GRANT por columnas: sin id, owner_id, deleted_at, approx_* ni fechas.
    checkColumns("rooms", body, ROOMS_UPDATE);
    // USING de la RLS: las filas que no puede escribir no se tocan (0 filas).
    const targets = applyFilters(
      [...state.rooms.values()].filter((room) => canWriteRoom(room, uid)),
      url
    );
    const now = new Date().toISOString();
    const updated = targets.map((room) => {
      const next = { ...room, ...body, updated_at: now };
      roomModeration(room, next, uid);
      // trg_rooms_published_at (20261031120000): fecha nueva al pasar a
      // active; en cualquier otra escritura, la que tenía.
      next.published_at =
        next.status === "active" && room.status !== "active"
          ? new Date().toISOString()
          : room.published_at;
      roomConstraints(next);
      return next;
    });
    updated.forEach((room) => state.rooms.set(room.id, room));
    return respondRows(req, res, updated, columns);
  }
  // Desde 20261030120000 ningún cliente tiene DELETE: el borrado es
  // delete_own_room, solo con service_role.
  throw denied("rooms");
}

// delete_own_room (20261030120000), solo service_role: cuenta activa,
// propietaria, rutas canónicas; borra la habitación y la cascada se lleva
// sus filas de room_images (no los objetos). Devuelve las rutas.
const CANONICAL_PATH =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$/;
function deleteOwnRoom(body) {
  const roomId = body.p_room_id;
  const userId = body.p_user_id;
  if (!roomId || !userId)
    throw new DbError(
      400,
      "22004",
      "room_delete_invalid: faltan la habitación o el usuario"
    );
  if (!ownerActive(userId))
    throw new DbError(
      403,
      "42501",
      "account_deleted: la cuenta no existe o está desactivada"
    );
  const room = state.rooms.get(roomId);
  if (!room || room.owner_id !== userId)
    throw new DbError(
      404,
      "P0002",
      "room_not_found: la habitación no existe o no es de esta cuenta"
    );
  const images = sortImages(
    [...state.images.values()].filter((i) => i.room_id === roomId)
  );
  if (
    images.some(
      (i) =>
        i.storage_path !== `${i.room_id}/${i.id}.webp` ||
        !CANONICAL_PATH.test(i.storage_path)
    )
  )
    throw new DbError(400, "23514", "room_delete_path_invalid: rutas no canónicas");
  state.rooms.delete(roomId);
  for (const image of images) state.images.delete(image.id);
  return images.map((i) => i.storage_path);
}

// trg_room_images_integrity (20261024120000), también para service_role.
function roomImagesTrigger(row) {
  const room = state.rooms.get(row.room_id);
  if (!room)
    throw new DbError(
      409,
      "23503",
      'insert or update on table "room_images" violates foreign key constraint "room_images_room_id_fkey"'
    );
  if (room.deleted_at !== null || room.status === "removed")
    throw new DbError(400, "23514", "room_not_writable: habitación retirada o eliminada");
  if (!ownerActive(room.owner_id))
    throw new DbError(400, "23514", "account_deleted: la cuenta está desactivada");
  if ([...state.images.values()].filter((i) => i.room_id === room.id).length >= 8)
    throw new DbError(400, "23514", "room_images_limit: como mucho 8 fotos");
  if (row.storage_path !== `${row.room_id}/${row.id}.webp`)
    throw new DbError(
      400,
      "23514",
      'violates check constraint "chk_room_images_storage_path"'
    );
}

const BUCKET = "room-images";
const BUCKET_MAX_BYTES = 5 * 1024 * 1024;
const storageError = (res, status, statusCode, error, message) =>
  send(res, status, { statusCode, error, message });

/**
 * Storage del bucket privado room-images. Escribir, firmar, borrar y listar
 * exigen service_role (sin políticas en storage.objects: ningún cliente
 * escribe ni lista). Las URL firmadas se sirven sin apikey hasta que caducan.
 */
function handleStorage(req, res, url, raw, isService) {
  const path = url.pathname.replace("/storage/v1", "");
  const signedPrefix = `/object/sign/${BUCKET}/`;
  if (req.method === "GET" && path.startsWith(signedPrefix)) {
    const objectPath = decodeURIComponent(path.slice(signedPrefix.length));
    const grant = state.signTokens.get(url.searchParams.get("token") ?? "");
    const object = state.objects.get(objectPath);
    if (!grant || grant.path !== objectPath || grant.expiresAt < Date.now() || !object)
      return storageError(res, 400, "403", "InvalidJWT", "invalid signature");
    res.writeHead(200, {
      "content-type": object.contentType,
      "cache-control": `max-age=${object.cacheControl}`,
    });
    return res.end(object.body);
  }
  if (!isService)
    return storageError(
      res,
      400,
      "403",
      "Unauthorized",
      "new row violates row-level security policy"
    );

  const json = () => (raw.length ? JSON.parse(raw.toString("utf8")) : {});
  if (req.method === "POST" && path === `/object/sign/${BUCKET}`) {
    const { expiresIn, paths } = json();
    return send(
      res,
      200,
      paths.map((objectPath) => {
        if (!state.objects.has(objectPath))
          return {
            path: objectPath,
            signedURL: null,
            error: "Either the object does not exist or you do not have access to it",
          };
        const token = randomBytes(16).toString("hex");
        state.signTokens.set(token, {
          path: objectPath,
          expiresAt: Date.now() + expiresIn * 1000,
        });
        return {
          path: objectPath,
          signedURL: `/object/sign/${BUCKET}/${objectPath}?token=${token}`,
          error: null,
        };
      })
    );
  }
  if (req.method === "POST" && path === `/object/list/${BUCKET}`) {
    const { prefix = "", limit = 100, offset = 0 } = json();
    const folder = prefix ? `${prefix.replace(/\/$/, "")}/` : "";
    const names = [...state.objects.keys()]
      .filter((objectPath) => objectPath.startsWith(folder))
      .map((objectPath) => objectPath.slice(folder.length))
      .sort()
      .slice(offset, offset + limit);
    return send(
      res,
      200,
      names.map((name) => ({ name, id: randomUUID(), metadata: {} }))
    );
  }
  if (req.method === "DELETE" && path === `/object/${BUCKET}`) {
    const { prefixes = [] } = json();
    const removed = prefixes.filter((objectPath) => state.objects.delete(objectPath));
    return send(
      res,
      200,
      removed.map((name) => ({ name, bucket_id: BUCKET }))
    );
  }
  const objectPrefix = `/object/${BUCKET}/`;
  if (req.method === "POST" && path.startsWith(objectPrefix)) {
    const objectPath = decodeURIComponent(path.slice(objectPrefix.length));
    const contentType = req.headers["content-type"];
    if (contentType !== "image/webp")
      return storageError(
        res,
        400,
        "415",
        "invalid_mime_type",
        `mime type ${contentType} is not supported`
      );
    if (raw.length > BUCKET_MAX_BYTES)
      return storageError(
        res,
        400,
        "413",
        "Payload too large",
        "The object exceeded the maximum allowed size"
      );
    if (state.objects.has(objectPath) && req.headers["x-upsert"] !== "true")
      return storageError(res, 400, "409", "Duplicate", "The resource already exists");
    const cacheControl =
      /max-age=(\d+)/.exec(req.headers["cache-control"] ?? "")?.[1] ?? "3600";
    state.objects.set(objectPath, { body: raw, contentType, cacheControl });
    return send(res, 200, { Key: `${BUCKET}/${objectPath}`, Id: randomUUID() });
  }
  return storageError(res, 404, "404", "not_found", "not found");
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
  if (table.startsWith("rpc/"))
    // Solo service_role tiene EXECUTE de las funciones que usa la app.
    throw new DbError(403, "42501", `permission denied for function ${table.slice(4)}`);
  if (!uid && table === "rooms") {
    // anon (20261031120100): SELECT solo de las 20 columnas públicas; leer,
    // filtrar u ordenar por cualquier otra (o `select=*`) es 42501. Filas:
    // rooms_select_active_public (R7). Ninguna escritura.
    if (req.method !== "GET") throw denied(table);
    if (requestColumns(url).some((column) => !ANON_ROOM_COLUMNS.includes(column)))
      throw denied(table);
    const visible = [...state.rooms.values()].filter((room) => roomVisibleTo(room, null));
    return respondRows(req, res, applyFilters(visible, url), columns);
  }
  if (!uid && table === "room_images") {
    // room_images_select_public: fotos de habitaciones públicas (R7).
    if (req.method !== "GET") throw denied(table);
    const visible = [...state.images.values()].filter((image) => {
      const room = state.rooms.get(image.room_id);
      return room && roomVisibleTo(room, null);
    });
    return respondRows(req, res, sortImages(applyFilters(visible, url)), columns);
  }
  if (!uid) throw denied(table); // anon: sin privilegios útiles en estas tablas

  if (table === "compatibility_responses") {
    // compatibility_responses_select_own; sin INSERT/UPDATE/DELETE (GRANT,
    // 20261007120000): authenticated nunca escribe aquí.
    if (req.method !== "GET") throw denied(table);
    const own = [...state.responses.values()].filter((r) => r.profile_id === uid);
    return respondRows(req, res, applyFilters(own, url), columns);
  }

  if (table === "rooms") return handleUserRooms(req, res, url, body, uid, columns);
  if (table === "room_images") {
    // room_images_select (R7): las fotos de las habitaciones que puede ver.
    // Sin INSERT, UPDATE ni DELETE para authenticated (20261024120000).
    if (req.method !== "GET") throw denied(table);
    const visible = [...state.images.values()].filter((image) => {
      const room = state.rooms.get(image.room_id);
      return room && roomVisibleTo(room, uid);
    });
    return respondRows(req, res, sortImages(applyFilters(visible, url)), columns);
  }

  if (table === "profiles") {
    // profiles_select_own_even_if_deleted: solo la fila propia, también
    // eliminada (Fase 2.9, H4: ya no existe profiles_select_authenticated).
    // profiles_admin_all no se emula: un admin creado con /__test/make-admin
    // solo lee su propia fila (lo único que usa la app para saber su rol).
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
    case "/__test/make-admin": {
      // Solo para E1: en Supabase el rol lo cambia el servidor con
      // service_role (nunca un cliente). Convierte la cuenta en admin activo.
      const user = findUser(email);
      const profile = user && state.profiles.get(user.id);
      if (!profile) return send(res, 404, { error: "sin perfil" });
      profile.role = "admin";
      return send(res, 200, { id: user.id });
    }
    case "/__test/seed-room": {
      // Habitación de una usuaria con perfil (datos de servidor). Parámetros:
      // email, title, status (draft por defecto), photos (número de fotos ya
      // subidas, con su objeto) y complete=1 (barrio, compañeros y
      // dormitorios: lo que exige la publicación). Para la búsqueda pública
      // (sesión 71), opcionales: price, available_from, neighborhood (slug),
      // features (lista con comas), pets, smoking y students (1 o 0),
      // min_stay, max_stay, roommates, bedrooms, description, house_rules,
      // roommate_preferences y published_at (si es active y no se indica,
      // ahora, como el trigger).
      const user = findUser(email);
      if (!user || !state.profiles.get(user.id))
        return send(res, 404, { error: "sin perfil" });
      const q = url.searchParams;
      const id = randomUUID();
      const complete = q.get("complete") === "1";
      const now = new Date().toISOString();
      const status = q.get("status") ?? "draft";
      const int = (key, fallback) => (q.has(key) ? Number(q.get(key)) : fallback);
      const flag = (key, column) => (q.has(key) ? { [column]: q.get(key) === "1" } : {});
      const hood = q.has("neighborhood")
        ? REFERENCE.neighborhoods.find((n) => n.slug === q.get("neighborhood"))
        : REFERENCE.neighborhoods[0];
      const text = (key) => (q.has(key) ? { [key]: q.get(key) } : {});
      state.rooms.set(id, {
        ...ROOM_DEFAULTS,
        id,
        owner_id: user.id,
        title: q.get("title") ?? "Habitación E1",
        status,
        city_id: BCN,
        price_month: int("price", 450),
        available_from: q.get("available_from") ?? "2026-11-01",
        ...(complete
          ? {
              neighborhood_id: hood.id,
              total_roommates: int("roommates", 2),
              total_rooms: int("bedrooms", 3),
            }
          : {}),
        features: q.get("features") ? q.get("features").split(",") : [],
        min_stay_months: int("min_stay", null),
        max_stay_months: int("max_stay", null),
        ...flag("pets", "pets_allowed"),
        ...flag("smoking", "smoking_allowed"),
        ...flag("students", "students_only"),
        ...text("description"),
        ...text("house_rules"),
        ...text("roommate_preferences"),
        published_at: status === "active" ? (q.get("published_at") ?? now) : null,
        created_at: now,
        updated_at: now,
      });
      const photos = Number(q.get("photos") ?? "0");
      for (let n = 0; n < photos; n += 1) {
        const imageId = randomUUID();
        const storagePath = `${id}/${imageId}.webp`;
        state.images.set(imageId, {
          id: imageId,
          room_id: id,
          storage_path: storagePath,
          position: n,
          created_at: new Date(Date.now() + n).toISOString(),
        });
        state.objects.set(storagePath, {
          body: TINY_WEBP,
          contentType: "image/webp",
          cacheControl: "600",
        });
      }
      return send(res, 200, { id });
    }
    case "/__test/room": {
      // Estado de una habitación: su fila, sus fotos y los objetos de su carpeta.
      const id = url.searchParams.get("id") ?? "";
      return send(res, 200, {
        room: state.rooms.get(id) ?? null,
        images: [...state.images.values()].filter((image) => image.room_id === id),
        objects: [...state.objects.keys()].filter((objectPath) =>
          objectPath.startsWith(`${id}/`)
        ),
      });
    }
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
  const chunks = [];
  req.on("data", (chunk) => chunks.push(chunk));
  req.on("end", () => {
    const rawBuffer = Buffer.concat(chunks);
    const raw = rawBuffer.toString("utf8");
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
    // El enlace del email y las URL firmadas de Storage los abre el
    // navegador sin apikey, como en Supabase.
    const isVerifyLink = url.pathname === "/auth/v1/verify";
    const isSignedObject =
      req.method === "GET" &&
      url.pathname.startsWith(`/storage/v1/object/sign/${BUCKET}/`);
    const isService =
      apikey === MOCK_SERVICE_ROLE_KEY && bearer === MOCK_SERVICE_ROLE_KEY;
    if (!isVerifyLink && !isSignedObject && apikey !== MOCK_ANON_KEY && !isService)
      return authError(res, 401, "no_api_key", "Invalid API key");
    // La clave service_role solo vale para REST y Storage (lo que usa la app).
    if (
      isService &&
      !url.pathname.startsWith("/rest/v1/") &&
      !url.pathname.startsWith("/storage/v1/")
    )
      return authError(res, 401, "no_api_key", "service_role solo en REST y Storage");
    if (url.pathname.startsWith("/storage/v1/")) {
      try {
        return handleStorage(req, res, url, rawBuffer, isService);
      } catch (error) {
        console.error(error);
        return storageError(res, 500, "500", "internal", "internal mock error");
      }
    }

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
