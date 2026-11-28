#!/usr/bin/env node
/**
 * Comprobación de la configuración de un despliegue (staging o producción),
 * sesión 87. No se conecta a ningún servicio: solo mira las variables de
 * entorno del proceso. Nunca imprime un valor; cada problema nombra la
 * variable y la regla (docs/STAGING.md).
 *
 *   node scripts/deploy-config-check.mjs --target=staging
 *   node scripts/deploy-config-check.mjs --target=production
 *
 * Sale con 1 si hay algún error. Las advertencias no hacen fallar.
 *
 * Reglas (las comprueba tests/unit/deploy-config-check.test.ts):
 *   - Supabase: URL https de un proyecto (`<ref>.supabase.co`), nunca local
 *     ni un proyecto de validación prohibido (`uwxb…`, y los de
 *     DEPLOY_FORBIDDEN_SUPABASE_REFS); la clave anon y la service_role son del
 *     mismo proyecto que la URL cuando son JWT, cada una con su rol, y
 *     distintas;
 *   - ninguna NEXT_PUBLIC_* lleva la clave service_role ni una clave secreta;
 *   - NEXT_PUBLIC_SITE_URL https, sin ruta, y no localhost;
 *   - NEXT_PUBLIC_CHAT_REALTIME, "true" o "false".
 */

/** Prefijos de refs que nunca pueden ser staging ni producción (CLAUDE.md). */
const BUILTIN_FORBIDDEN_REF_PREFIXES = ["uwxb"];

const REQUIRED = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "NEXT_PUBLIC_SITE_URL",
];

/** Payload de un JWT, sin verificar la firma; `null` si no es un JWT. */
function jwtPayload(value) {
  const parts = String(value).split(".");
  if (parts.length !== 3) return null;
  try {
    const json = Buffer.from(parts[1], "base64url").toString("utf8");
    const payload = JSON.parse(json);
    return payload && typeof payload === "object" ? payload : null;
  } catch {
    return null;
  }
}

function isLocalHost(hostname) {
  return (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    /^127\./.test(hostname) ||
    hostname === "0.0.0.0" ||
    hostname === "[::1]" ||
    /^10\./.test(hostname) ||
    /^192\.168\./.test(hostname)
  );
}

function parseUrl(value) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

/**
 * @param {Record<string, string | undefined>} env
 * @param {{ target: "staging" | "production" }} options
 * @returns {{ errors: string[], warnings: string[] }}
 */
export function checkDeployConfig(env, { target }) {
  const errors = [];
  const warnings = [];
  if (target !== "staging" && target !== "production")
    return { errors: [`--target debe ser staging o production`], warnings };

  for (const name of REQUIRED)
    if (!env[name] || !String(env[name]).trim()) errors.push(`${name}: falta`);

  // Supabase URL y ref.
  let ref = null;
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL
    ? parseUrl(env.NEXT_PUBLIC_SUPABASE_URL)
    : null;
  if (env.NEXT_PUBLIC_SUPABASE_URL && !supabaseUrl)
    errors.push("NEXT_PUBLIC_SUPABASE_URL: no es una URL");
  if (supabaseUrl) {
    if (supabaseUrl.protocol !== "https:")
      errors.push("NEXT_PUBLIC_SUPABASE_URL: debe ser https");
    if (isLocalHost(supabaseUrl.hostname))
      errors.push("NEXT_PUBLIC_SUPABASE_URL: apunta a una máquina local");
    if (supabaseUrl.pathname !== "/" || supabaseUrl.search)
      errors.push("NEXT_PUBLIC_SUPABASE_URL: debe ser solo el origen, sin ruta");
    const match = supabaseUrl.hostname.match(/^([a-z0-9]{20})\.supabase\.co$/);
    if (match) ref = match[1];
    else
      warnings.push(
        "NEXT_PUBLIC_SUPABASE_URL: no es <ref>.supabase.co; no se puede comprobar el proyecto"
      );
  }
  const forbidden = [
    ...BUILTIN_FORBIDDEN_REF_PREFIXES,
    ...String(env.DEPLOY_FORBIDDEN_SUPABASE_REFS ?? "")
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean),
  ];
  if (ref && forbidden.some((prefix) => ref.startsWith(prefix)))
    errors.push(
      "NEXT_PUBLIC_SUPABASE_URL: es un proyecto prohibido para despliegues (validación o histórico)"
    );

  // Claves.
  const anon = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const service = env.SUPABASE_SERVICE_ROLE_KEY;
  if (anon && service && anon === service)
    errors.push("NEXT_PUBLIC_SUPABASE_ANON_KEY: es igual a la clave service_role");
  if (anon) {
    if (/^sb_secret_/.test(anon))
      errors.push("NEXT_PUBLIC_SUPABASE_ANON_KEY: es una clave secreta, no la pública");
    const payload = jwtPayload(anon);
    if (payload) {
      if (payload.role !== "anon")
        errors.push("NEXT_PUBLIC_SUPABASE_ANON_KEY: el JWT no tiene el rol anon");
      if (ref && payload.ref && payload.ref !== ref)
        errors.push("NEXT_PUBLIC_SUPABASE_ANON_KEY: es de otro proyecto de Supabase");
    } else if (!/^sb_publishable_/.test(anon))
      warnings.push(
        "NEXT_PUBLIC_SUPABASE_ANON_KEY: formato no reconocido (ni JWT ni sb_publishable_)"
      );
  }
  if (service) {
    if (/^sb_publishable_/.test(service))
      errors.push("SUPABASE_SERVICE_ROLE_KEY: es la clave pública, no la de servidor");
    const payload = jwtPayload(service);
    if (payload) {
      if (payload.role !== "service_role")
        errors.push("SUPABASE_SERVICE_ROLE_KEY: el JWT no tiene el rol service_role");
      if (ref && payload.ref && payload.ref !== ref)
        errors.push("SUPABASE_SERVICE_ROLE_KEY: es de otro proyecto de Supabase");
    } else if (!/^sb_secret_/.test(service))
      warnings.push(
        "SUPABASE_SERVICE_ROLE_KEY: formato no reconocido (ni JWT ni sb_secret_)"
      );
  }

  // Ninguna variable pública con un secreto.
  for (const [name, value] of Object.entries(env)) {
    if (!name.startsWith("NEXT_PUBLIC_") || !value) continue;
    if (name.includes("SERVICE") || name.includes("SECRET"))
      errors.push(`${name}: una variable NEXT_PUBLIC_* no puede llevar un secreto`);
    if (service && value === service)
      errors.push(`${name}: contiene la clave service_role`);
    if (/^sb_secret_/.test(value)) errors.push(`${name}: contiene una clave secreta`);
    const payload = jwtPayload(value);
    if (payload?.role === "service_role")
      errors.push(`${name}: contiene un JWT con el rol service_role`);
  }

  // Sitio.
  const site = env.NEXT_PUBLIC_SITE_URL ? parseUrl(env.NEXT_PUBLIC_SITE_URL) : null;
  if (env.NEXT_PUBLIC_SITE_URL && !site)
    errors.push("NEXT_PUBLIC_SITE_URL: no es una URL");
  if (site) {
    if (site.protocol !== "https:") errors.push("NEXT_PUBLIC_SITE_URL: debe ser https");
    if (isLocalHost(site.hostname))
      errors.push("NEXT_PUBLIC_SITE_URL: apunta a una máquina local");
    if (site.pathname !== "/" || site.search || site.hash)
      errors.push("NEXT_PUBLIC_SITE_URL: debe ser solo el origen, sin ruta");
    if (supabaseUrl && site.hostname === supabaseUrl.hostname)
      errors.push("NEXT_PUBLIC_SITE_URL: es la URL de Supabase, no la de la app");
    if (
      target === "production" &&
      /(^|[.-])(staging|preview|test)([.-]|$)/.test(site.hostname)
    )
      errors.push("NEXT_PUBLIC_SITE_URL: parece un dominio de staging en producción");
  }

  const realtime = env.NEXT_PUBLIC_CHAT_REALTIME;
  if (
    realtime !== undefined &&
    realtime !== "" &&
    realtime !== "true" &&
    realtime !== "false"
  )
    errors.push('NEXT_PUBLIC_CHAT_REALTIME: debe ser "true" o "false"');

  if (env.NODE_ENV && env.NODE_ENV !== "production")
    warnings.push("NODE_ENV: un despliegue debe construirse con NODE_ENV=production");

  return { errors, warnings };
}

function main() {
  const arg = process.argv.find((value) => value.startsWith("--target="));
  const target = arg ? arg.slice("--target=".length) : "";
  const { errors, warnings } = checkDeployConfig(process.env, { target });
  for (const warning of warnings) console.warn(`aviso: ${warning}`);
  for (const error of errors) console.error(`error: ${error}`);
  if (errors.length) {
    console.error(
      `\n${errors.length} error(es): la configuración de ${target || "?"} no es válida.`
    );
    process.exit(1);
  }
  console.log(
    `Configuración de ${target} correcta (${warnings.length} aviso(s)). No se ha conectado a ningún servicio.`
  );
}

if (import.meta.url === `file://${process.argv[1]}`) main();
