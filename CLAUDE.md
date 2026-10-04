# CLAUDE.md

Instrucciones permanentes de este repositorio. Léeme antes de cualquier
cambio importante. Si eres Claude Code arrancando este proyecto por
primera vez: lee también `ROOMLY_MASTER_SPEC.md` y `HANDOFF.md` antes de
tocar nada — `HANDOFF.md` explica de dónde viene este proyecto y qué
verificar primero.

## Qué es ROOMLY

Plataforma para encontrar compañeros de piso compatibles y formar grupos
de convivencia, empezando por estudiantes en Barcelona. El diferencial no
es "otro portal de habitaciones" — es compatibilidad de convivencia +
confianza + formación de grupos, calculado de forma determinista y
explicable, nunca con IA generativa.

Flujo del MVP: **estudiante → perfil → test → match → habitación →
contacto**. Especificación de producto completa (por qué existe cada
decisión, no solo cuál): `ROOMLY_MASTER_SPEC.md`.

## Estado actual — no asumas que esto está terminado

**Fase 0 (arquitectura): completada**, con revisión crítica aplicada
(sobreingeniería, seguridad, escalabilidad — ver `docs/DATABASE.md` y
`docs/ARCHITECTURE.md`).

**Fase 1 (Foundation): completada (2026-09-29).** Hecho y verificado:
Next.js 16 + TypeScript + Tailwind, Supabase Auth + SSR, magic link, `/admin` en dos capas, redirects seguros, correcciones de
seguridad/RLS, CI en verde en GitHub Actions, 39/39 tests, validación
contra un Supabase real (checkpoint en el proyecto antiguo
`roomly-validation`, histórico: SQL 58/58, supabase-js 46/46, AU2–AU5) y
migración a `proxy.ts` (runtime Node.js).
- **Trasladado a Fase 2**: el alta real de un usuario nuevo por magic
  link (el login sí se validó; el registro estaba desactivado). Es parte de
  la 2.8. Ver `docs/ROADMAP.md`.

**Fase 2 (User): ABIERTA.** No está cerrada: su criterio de aceptación
depende de la validación real de la 2.8, que está aparcada (ver abajo). 2.0 completada (endurecimiento de datos y
RLS/GRANT de `profiles` y `housing_preferences`, integridad de barrios con
triggers; `test:db` 119/119 en local) y 2.1 completada (validación Zod y
servicios de perfil y preferencias en `lib/validation/*` y
`lib/services/*`), 2.2 completada (routing de Auth: `lib/auth/*`, guards de
servidor, `next` en cookie, `/cuenta-desactivada`, logout) y 2.3 completada
(onboarding en `/bienvenida/{perfil,preferencias}` con Server Actions;
`seeking_status` sin DEFAULT y trigger que exige preferencias con ciudad
para completar; `test` 347/347). Después de 2.3, las escrituras de cuentas
con `deleted_at` se bloquean también en RLS (`profiles_update_own` y
`housing_preferences`; `test:db` 158/158). 2.4 completada (perfil propio en
`/perfil`: `requireOwnProfile`, `app/actions/profile.ts`; `test` 416/416,
`test:db` 168/168). 2.5 completada (preferencias en `/preferencias`;
ciudad obligatoria y sin borrado del cliente tras el onboarding, universidad
↔ ciudad en la base de datos; `test` 469/469, `test:db` 192/192). 2.6
completada (ajustes en `/ajustes`: avisos por email y cerrar sesión) y 2.7
cerrada (shell autenticado y errores sin detalles técnicos, `1e6af49`;
`test` 532/532, `test:db` 218/218).

**2.8 (validación real del alta y E2E): APARCADA/BLOQUEADA — validación
real pendiente. NO está cerrada ni completada.** La infraestructura está en
`master` (PR #4 y #5, `cb88647`) y CI está en verde: runner SQL remoto
aislado por archivo, preflight P0–P6 exacto (38 políticas), E1 (Playwright
contra Supabase simulado, también en CI), E2 (alta real con email real,
solo desde el workflow manual) y diagnóstico de la guarda. La validación
real **nunca se ha ejecutado**: los runs 3–10 del workflow manual se
detuvieron antes de cualquier escritura (sin cambios remotos en Supabase),
porque el Environment `roomly-validation-2` sigue resolviendo al proyecto
retirado (run 10: marca `roomly-retirado`, 18 tablas) en vez de al
proyecto vacío `roomly-validation-2b`. Bloqueada hasta que el propietario
corrija los secrets; entonces: workflow (migraciones, P0–P6, SQL,
supabase-js, AU3/AU5) y, con SMTP y buzón, el E2 real. No hacer más runs,
ni E2, signup o SMTP, sin autorización. Hasta entonces el alta real por
magic link y la RLS de Fase 2 en Supabase real **no están verificadas** —
no lo des por hecho. No borrar ni alterar la infraestructura de la 2.8.

**2.9 (endurecimiento de integridad y privacidad): subfase NUEVA, definida
por el propietario el 2026-10-04 (no formaba parte del roadmap original).
Definida, no implementada.** No sustituye ni cierra la 2.8. Alcance: punto
A de 2.3 (`onboarding_completed_at` de una sola escritura, para todos los
roles) y H4 (eliminar `profiles_select_authenticated`). Decisiones en
`docs/ROADMAP.md`. Claude no toca Supabase remoto, ni hace commit, push o
PR, sin autorización explícita. La Fase 3 no ha empezado.
- **Diferido por decisión del usuario**: Google OAuth y Apple OAuth.
- Antes de hacer nada, ejecuta `git status` y compáralo con `PROGRESS.md`
  — no asumas que un commit existe porque el código existe en disco.

Detalle exacto, sin adornar: `PROGRESS.md` (última entrada) y
`docs/ROADMAP.md`. `HANDOFF.md` es histórico.

## Cómo verificar antes de afirmar que algo funciona

Esto no es una formalidad — ya pasó una vez en este proyecto:
`types/database.ts` compilaba sin quejarse hasta que se usaba de verdad,
y entonces `tsc` señaló un error real (faltaba el campo `Relationships`
que exige `@supabase/postgrest-js`, y sin él las queries resolvían a
`never` en vez de fallar donde debían). La lección: **"no da error" no es
lo mismo que "funciona".**

Antes de decir que algo está listo:

1. Ejecuta el comando de verdad (`lint`, `typecheck`, `test`, `build`,
   `test:e2e`) — no lo des por hecho por analogía con código parecido.
2. Si algo falla, lee el error completo antes de suponer la causa. Si el
   error viene de una librería (Supabase, Next.js...), busca primero en
   `node_modules/<paquete>` el código o la documentación real instalada
   — es más fiable que la memoria de entrenamiento, sobre todo para
   versiones recientes (ej.: Next.js 16 renombró `middleware` a `proxy`,
   un cambio posterior a muchos conocimientos previos).
3. No se puede verificar contra Supabase/Playwright real sin red — dilo
   explícitamente en vez de asumir que "debería funcionar".
4. Nunca digas "todo funciona" sin haber ejecutado la comprobación. Si no
   se pudo ejecutar, di exactamente por qué.

## Stack

- **Frontend/Backend**: Next.js 16 + TypeScript (App Router), Server
  Actions como capa de transporte, nunca de lógica de negocio.
- **UI**: Tailwind CSS v4 (config vía `@theme` en `app/globals.css`, sin
  `tailwind.config.js`).
- **DB/Auth/Storage/Realtime**: Supabase (PostgreSQL + RLS), vía
  `@supabase/ssr` (browser/server) y `@supabase/supabase-js` (admin).
- **Validación**: Zod en todo input de Server Action/Route Handler —
  nunca confiar solo en validación de cliente. Ver `lib/env.ts` para el
  patrón de validación perezosa de variables de entorno.
- **Mapas**: Mapbox (recomendado sobre Google Maps por coste — solo
  necesitamos pines aproximados, no búsqueda de negocios; confirmar con
  el usuario, no bloqueante).
- **Email**: Resend.
- **Analítica**: PostHog (región EU), captura cliente + servidor.
- **Pagos**: Stripe — no se integra hasta que exista demanda real.
- **Testing**: Vitest (unit/integración) + Playwright (E2E).
- **Calidad de código**: ESLint (`eslint-config-next` + `eslint-config-prettier`)
  + Prettier (`.prettierrc.json`).
- **Hosting**: Vercel.
- **Mobile (futuro, no MVP)**: React Native + Expo, reutilizando
  `lib/services/*` vía una API REST fina (`app/api/v1/*`) que se añade
  cuando haga falta — nunca antes.

## Estructura

Árbol completo y razonamiento en `docs/ARCHITECTURE.md`. Regla de oro:
**Server Actions delgadas → `lib/services/*` con la lógica real →
`lib/supabase/*` para acceso a datos.** Nunca lógica de negocio dentro de
un archivo de `app/actions/` (esa carpeta existe en el esqueleto; los
primeros servicios reales son `lib/services/{profile,housing-preferences}.ts`,
de la Fase 2.1).

Rutas de usuario (`app/(marketing)`, `app/(auth)`, `app/(app)`...) en
español, para que coincidan con las URLs de SEO. Código interno (`lib/`,
`components/`, nombres de archivo) en inglés.

## Comandos (reales, en `package.json`)

```
npm run dev          # servidor de desarrollo
npm run build         # build de producción
npm run start          # servir el build
npm run lint            # ESLint
npm run typecheck        # tsc --noEmit
npm run test               # Vitest, una vez
npm run test:watch          # Vitest, modo watch
npm run test:db              # tests de seguridad/RLS contra PostgreSQL local (ver docs/TESTING.md)
npm run test:supabase         # validación contra el Supabase de validación (solo vía workflow manual, ver docs/SUPABASE_VALIDATION.md)
npm run test:e2e              # E1: Playwright contra el Supabase simulado (necesita `npx playwright install chromium`)
npm run test:e2e:real         # E2: alta real contra roomly-validation-2 (solo desde el workflow manual)
npm run test:infra            # auto-tests de guarda, runner SQL y preflight contra PostgreSQL local
npm run format                  # Prettier --write
npm run format:check             # Prettier --check
```

## Reglas de desarrollo

1. **Nunca** lógica de negocio en un Server Action — solo orquestación
   fina que llama a `lib/services/*`.
2. **Nunca** `SELECT *` donde pueda haber una columna sensible (sobre todo
   `room_addresses.address_exact`) — proyectar columnas explícitamente.
3. **Nunca** confiar solo en RLS ni solo en validación de cliente — las
   dos capas, siempre. Para columnas especialmente sensibles
   (`profiles.role`, `conversation_participants.conversation_id`), RLS
   tampoco basta sola — ver la corrección de escalado de privilegios en
   `docs/SECURITY.md` antes de tocar cualquier política `UPDATE`.
4. **Nunca** N+1: listados con relaciones usan `select` anidado de
   Supabase o un join explícito, nunca un fetch dentro de un bucle.
5. **Nunca** commitear `.env*` (ya está en `.gitignore`) ni exponer
   `SUPABASE_SERVICE_ROLE_KEY` al cliente — `lib/supabase/admin.ts` usa
   `import "server-only"` precisamente para que esto falle en build si
   alguien se equivoca.
6. El algoritmo de matching vive en `lib/matching/score.ts` como función
   pura — nunca en SQL/triggers, nunca llamando a un LLM.
7. Antes de tocar el esquema de base de datos, leer `docs/DATABASE.md`
   completo, no solo el SQL — el razonamiento importa tanto como el
   resultado.
8. No pasar a la siguiente fase del roadmap si la anterior tiene tests
   rotos o pasos de su checklist sin cerrar.
9. Nada de microservicios, colas, Kubernetes, ni bases de datos
   adicionales sin que aparezca una razón de negocio concreta — no
   "por si acaso".
10. Si algo escrito por una sesión anterior parece incompleto o
    inconsistente con la documentación, investígalo — no lo des por
    bueno ni lo "arregles" silenciosamente sin dejar rastro en
    `PROGRESS.md`.

## Git — reglas explícitas

- Historial real, no lo reescribas: nunca `git push --force`, nunca
  `git reset --hard` sobre commits ya hechos, nunca borrar ramas.
- Antes de cualquier commit: `git status`, `git diff` completo, y
  comprobación explícita de que no hay secretos (`.env*`, claves,
  tokens) en lo que se va a commitear.
- Commits pequeños y descriptivos, en español, seleccionando este
  proyecto ya lo ha hecho así (ver `git log`) — sigue el mismo estilo.
- No hagas `git push` salvo que el usuario lo pida explícitamente.
- Antes de cualquier acción destructiva (borrar archivos en bloque,
  reescribir migraciones ya commiteadas, etc.), pide confirmación
  explícita en vez de asumir.

## Cómo trabajar por fases

Cada fase de `docs/ROADMAP.md`: objetivo → criterios de aceptación →
implementar → testear de verdad (no solo escribir el test) → documentar
(`PROGRESS.md`, y `ROADMAP.md`/`TESTING.md`/`SECURITY.md`/`ENVIRONMENT.md`
si algo relevante cambió) → revisar `git diff` → commit. No avances
automáticamente a la siguiente fase — para y espera confirmación,
incluso si técnicamente "podrías" seguir.

## Prioridades ante conflicto

Seguridad y bugs críticos → flujo principal del producto → experiencia de
usuario → funcionalidad nueva. Ante la duda entre "más simple" y "más
preparado para el futuro", elige más simple — el propio historial de este
proyecto tiene varios ejemplos de tablas/columnas que se quitaron por
sobreingeniería (`docs/DATABASE.md`, "Revisión crítica").

## Seguridad (resumen — detalle en `docs/SECURITY.md`)

- RLS activada en **todas** las tablas de `public`, incluidas las de
  referencia (con política de lectura abierta explícita, no por omisión).
- `profiles` completo requiere sesión; las páginas públicas usan la vista
  `public_profile_previews` (solo nombre/avatar/rol).
- Dirección exacta de habitación aislada en `room_addresses`, solo
  legible por el propietario.
- `matches`/`conversations`/`conversation_participants` no aceptan INSERT
  de cliente — se crean solo desde el servidor.
- `profiles.role` y `conversation_participants.conversation_id` están
  fuera del privilegio `UPDATE` del rol `authenticated` a nivel de
  `GRANT`/`REVOKE` (no solo RLS) — corrección de un escalado de
  privilegios real encontrado en revisión. No lo reviertas sin entender
  por qué existe. Desde `20260926120000_security_fixes.sql`, `role` y
  `deleted_at` también están fuera del `INSERT` (antes cualquiera podía
  crearse su perfil como admin), y cambiar un rol solo se hace desde el
  servidor con `service_role`, ni siquiera un admin desde el cliente.
- Las políticas del chat usan `public.is_conversation_participant()`
  (`SECURITY DEFINER`, sin parámetro de usuario). Nunca escribas una
  subconsulta de RLS con columnas sin cualificar: Postgres resuelve el
  nombre contra la tabla más interna y la condición puede volverse una
  tautología (pasó aquí con `messages`).
- `tests/db/` contiene tests de regresión de seguridad que deben pasar
  siempre (`npm run test:db`, también en CI).
- Rate limit a nivel de base de datos (trigger) sobre `interests`, además
  del check en la app.
- `/admin` se protege en RLS **y** en el servidor (`requireAdmin()` de
  `lib/auth/session.ts`: rol admin y cuenta no eliminada) — nunca solo
  ocultando el enlace en el cliente. Los guards van en **cada página**, no
  solo en el layout: Next.js renderiza la página en paralelo y su contenido
  viajaría en el cuerpo del redirect (ver `docs/SECURITY.md`, Fase 2.2).

## Testing

Ver `docs/TESTING.md` para resultados reales de la última sesión.
Prioridad: algoritmo de matching (casi cobertura total cuando exista, es
el diferencial del producto), RLS por rol, y los 3 flujos E2E
obligatorios (estudiante, room provider, admin). La conexión con
Supabase real se verificó en la Fase 1 (`roomly-validation`, histórico); la
de Fase 2 en `roomly-validation-2` está pendiente
(`docs/SUPABASE_VALIDATION.md`). E2E: E1 (`npm run test:e2e`, Supabase
simulado) corre en local y en CI; el entorno cloud de Claude Code no puede
descargar el navegador de Playwright 1.63 y usa el Chromium preinstalado
con `PLAYWRIGHT_CHROMIUM_EXECUTABLE` (resultado orientativo; el de CI es el
de referencia). E2 (real) solo se ejecuta desde el workflow manual y aún no
se ha ejecutado — no lo des por hecho.

## Alcance del MVP — qué NO construir todavía

Pagos, contratos, seguros, KYC de terceros, videollamadas, IA generativa
para matching o recomendaciones, sistema de reputación avanzado,
multi-idioma completo, grupos de piso completos, app móvil, panel
empresarial complejo. Todo esto tiene hueco en el esquema/arquitectura
para añadirse después sin reescritura — ver `docs/ROADMAP.md` y
`ROOMLY_MASTER_SPEC.md` §"Explícitamente fuera del MVP".

## Funcionalidades terminadas

Ninguna funcionalidad de producto todavía (matching, habitaciones,
intereses, chat, admin real son Fase 3 en adelante). Fase 0 completa.
Fase 1 completada — ver arriba.

## Funcionalidades pendientes

2.8 aparcada/bloqueada (validación real en `roomly-validation-2b` con los
secrets corregidos y E2 real, ejecutados por el propietario), 2.9 (definida,
sin implementar) y Fases 3 a 9 — ver `docs/ROADMAP.md`.

## Pendiente de decisión humana (no lo decide Claude)

- Datos legales de la empresa (razón social, NIF, dirección, DPO) para
  Términos y Privacidad — marcado como REQUIERE REVISIÓN LEGAL en
  `docs/DATABASE.md`/`docs/SECURITY.md`.
- Dominio de producción.
- Si ya existen cuentas de Supabase/Vercel/Google Cloud (para OAuth) o
  hay que crearlas guiadas.
- Confirmar o corregir las recomendaciones técnicas reversibles: magic
  link vs. contraseña, Mapbox vs. Google Maps.
- Cuándo retomar Google OAuth y Apple OAuth (diferidos).
- La migración `middleware.ts` → `proxy.ts` ya está hecha; el proxy corre
  en Node.js (no Edge). Su impacto en Vercel se medirá al desplegar.
