# Roadmap — ROOMLY

Se trabaja fase a fase. No se empieza la siguiente si la anterior tiene
tests rotos. Cada fase: objetivo → criterios de aceptación → implementar →
testear → documentar → commit.

## Fase 0 — Arquitectura ✅ (esta entrega)

Diseño de arquitectura, esquema de base de datos, estructura de carpetas,
documentación. Sin código de aplicación.

## Fase 1 — Foundation ✅ COMPLETADA (2026-09-29)

**Objetivo**: proyecto Next.js real, conectado a un Supabase real, con
auth funcionando de extremo a extremo y CI básica.

**Estado real, punto por punto** (reconciliado el 2026-09-29, PROGRESS.md sesión 8):
- [x] Proyecto Next.js 16.3.6 + TypeScript + Tailwind v4 real (scaffold con `create-next-app`).
- [x] `lib/supabase/{client,server,admin}.ts`, `lib/env.ts`, `proxy.ts`, `types/database.ts`.
- [x] Login por magic link, callback con redirect seguro (`lib/auth/safe-redirect.ts`, H1), protección de `/admin` en 2 capas (`proxy.ts` + `app/admin/layout.tsx`).
- [x] Correcciones de seguridad/RLS (C1, C2, C3, H5, M2) en `20260926120000_security_fixes.sql`, con regresión en `tests/db` (58/58).
- [x] `npm run format:check`, `lint`, `typecheck`, `build` — pasan.
- [x] `npm run test` — pasa, 39/39.
- [x] Migración `middleware.ts` → `proxy.ts` (Next.js 16.3.6 la reconoce: `ƒ Proxy (Middleware)`, runtime Node.js).
- [x] Proyecto Supabase real (`roomly-validation`, Frankfurt) con migraciones aplicadas y RLS validada por rol: suite SQL 58/58, suite supabase-js 46/46 (`profiles`, `rooms`, `messages`/chat, `reports`), P0–P5 (ver `docs/SUPABASE_VALIDATION.md`).
- [x] Auth verificada contra Supabase real: AU2 (JWT reales), AU3 (callback/redirects seguros), AU4 (magic link de extremo a extremo, manual), AU5 (`/admin` sin sesión / sin admin / con admin).
- [x] CI verificado en GitHub Actions de verdad: `ci.yml` en verde en PR y en push a `master` (PRs #1, #2, #3).
- [x] Commit de Foundation (`d1089aa`).

**Diferido por decisión del usuario (no bloquea el cierre)**
- Google OAuth: el botón existe en `/login`, pero el proveedor no está configurado en Supabase ni se ha verificado.
- Apple OAuth: no existe.
- E2E con Playwright en CI → Fase 2, cuando existan flujos reales de usuario. `npx playwright install` no se ha ejecutado con red real; el smoke test solo ha pasado con el Chromium preinstalado del entorno cloud y una config temporal (ver `docs/TESTING.md`).

**Trasladado a Fase 2 por decisión del usuario**
- El criterio dice "Registro/login por magic link". El **login** por magic link está validado contra Supabase real (AU4). El **alta real de un usuario nuevo** no se validó: `roomly-validation` tiene los signups desactivados a propósito y el usuario de AU4 se creó desde el dashboard. Esa validación pasa a Fase 2, junto con el flujo de Registro y la creación de perfil tras el primer login (M6). Esto no significa que Fase 2 esté iniciada.

**Criterios de aceptación** (texto original, estado entre corchetes)
- `npm run dev` levanta la app sin errores. [✅ en el PC del usuario, durante AU4]
- Registro/login por magic link y por Google funcionan contra un proyecto
  Supabase real (región EU). [login magic link ✅ · alta de usuario nuevo: trasladada a Fase 2 · Google: diferido]
- Migraciones aplicadas, RLS activada y validada con al menos un test de
  integración por tabla sensible (`profiles`, `rooms`, `messages`). [✅]
- CI en GitHub Actions corriendo lint + typecheck + tests unitarios en
  cada PR. [✅]
- Layout base y navegación (sin diseño final todavía). [✅]

## Fase 2 — User ✅ COMPLETADA (2026-10-06)

Registro, login, recuperación de acceso, perfil (la foto queda fuera de
Fase 2, ver abajo), preferencias de vivienda, onboarding completo.

**Recibido de Fase 1**: validar contra Supabase real el alta de un
usuario nuevo por magic link (con signups activos) junto con la creación
de perfil tras el primer login (M6), y los E2E con Playwright. [✅ alta real
y perfil tras el primer login en el E2 real, run 15; E1 con Playwright en CI
(`e2e-local`)]

**Subfases** (plan aprobado el 2026-09-29, PROGRESS.md sesión 9):
- 2.0 Endurecimiento de datos y RLS/GRANT de `profiles` y
  `housing_preferences`, integridad de barrios con triggers, + tests de base
  de datos — ✅ completada (`feb08e4`, `test:db` 119/119 en local). Queda
  pendiente, para 2.8, aplicarla en `roomly-validation`, lo que requiere
  antes una estrategia de migración incremental (ver PROGRESS.md sesión 9).
- 2.1 Validación (Zod) y servicios de perfil/preferencias — ✅ completada
  (`dae21e5`, PROGRESS.md sesión 10): `lib/validation/{profile,housing-preferences}.ts`,
  `lib/services/{profile,housing-preferences}.ts`, sin UI ni Server Actions.
  **Onboarding completo** (decisión de producto): perfil con `full_name`,
  `date_of_birth` y `seeking_status` elegido, y fila de
  `housing_preferences` con `city_id`; el resto de preferencias es opcional.
- 2.2 Enrutamiento de Auth — ✅ completada (`bd1cef7`, PROGRESS.md sesión 11):
  destino único (`lib/auth/destination.ts`), guards de servidor
  (`lib/auth/session.ts`), `next` en cookie de corta duración sin cambios en
  Supabase (M6), callback con errores propios, logout, `/cuenta-desactivada`,
  páginas mínimas de `/bienvenida/{perfil,preferencias}` (solo el destino y
  su guard), `/admin` con rol admin **y** cuenta no eliminada, y `proxy.ts`
  protegiendo `/admin`, `/perfil`, `/ajustes`, `/bienvenida` y
  `/cuenta-desactivada` sin consultar la base de datos.
- 2.3 Onboarding en `/bienvenida/...` — ✅ completada (PROGRESS.md sesión 12):
  `/bienvenida/perfil` (nombre, fecha de nacimiento y `seeking_status` sin
  preselección) → `/bienvenida/preferencias` (ciudad obligatoria, resto
  opcional y sin techos) → `completeOnboarding` → `/`. Server Actions en
  `app/actions/onboarding.ts`, formularios HTML que funcionan sin
  JavaScript, datos de referencia en `lib/services/reference-data.ts`.
  Migración `20260930120000`: `seeking_status` sin DEFAULT y trigger que
  exige preferencias con ciudad para marcar el onboarding completo.
- Endurecimiento entre 2.3 y 2.4 — ✅ (PROGRESS.md sesión 13): decisión B
  de la auditoría de 2.3. Migración `20260930130000`: una cuenta con
  `deleted_at` no puede actualizar su perfil ni crear, actualizar o borrar
  sus preferencias, también por PostgREST (RLS). El punto A
  (`onboarding_completed_at` de una sola escritura) sigue pendiente, para
  2.8; el C se resolvió en 2.5.
- 2.4 Perfil propio en `/perfil` (sin perfiles de terceros: H3/H4) — ✅
  completada (PROGRESS.md sesión 14): consultar y editar `full_name`,
  `date_of_birth`, `seeking_status`, `bio` y `email_notifications_enabled`
  del perfil de la sesión, con `updateProfile` (2.1) y una Server Action.
  Sin perfil → onboarding; cuenta eliminada → `/cuenta-desactivada`;
  incompleto → editable, con aviso para terminar las preferencias. Sin
  migración.
- 2.5 Preferencias en `/preferencias` — ✅ completada (`d9430ac`, verificación
  reforzada en `b3ad249`; PROGRESS.md sesiones 15–17):
  consultar y editar las preferencias propias (ciudad, universidad,
  estudios, presupuesto, fechas, barrios y compañeros) con los servicios de
  2.1 y una Server Action; reutiliza el formulario del onboarding. Migración
  `20260930140000`: riesgo C resuelto (ciudad obligatoria y sin borrado del
  cliente tras el onboarding) y universidad ↔ ciudad en la base de datos.
- 2.6 Ajustes en `/ajustes` (sin borrado de cuenta: H6) — ✅ completada
  (PROGRESS.md sesión 19): avisos por email (`email_notifications_enabled`)
  y cerrar sesión (el `signOut` de 2.2, sin cambiar su alcance). El aviso
  sigue también en `/perfil` (2.4 no se reabre). Sin migración y sin botón
  ni endpoint de borrado.
- 2.7 Shell autenticado y estados de carga/error/vacío — ✅ **cerrada**
  (PROGRESS.md sesión 21; commit `1e6af49`).
  N3: `Nav` raíz estático (solo el logotipo; «Entrar» pasa a la página de
  inicio) y navegación de la cuenta en `app/(app)/layout.tsx` hacia
  `/perfil`, `/preferencias` y `/ajustes`, con el logout de 2.2. `error.tsx`
  y `global-error.tsx` sin detalles técnicos. `loading.tsx` (L1) se probó y
  se revirtió: rompía las páginas sin JavaScript; cada página conserva su
  guard. Sin estados vacíos nuevos. Consecuencia aceptada de N3: fuera de
  `/`, las páginas públicas (p. ej. la 404) no muestran «Entrar». Resultados:
  `npm test` 532/532, `test:db` 218/218, lint, typecheck, format y build en
  verde; Chromium con y sin JavaScript (shell 35/35 y regresión de 2.4–2.6).
- 2.8 Validación real del alta (entorno con signups) y E2E — ✅
  **COMPLETADA el 2026-10-06** (PROGRESS.md sesiones 22–30) en el proyecto
  Supabase `roomly-validation-2b` (ref `uwxb…`, marca `roomly-validation-2`),
  con el workflow manual `Supabase validation`. Decisiones del usuario:
  - **A + P1**: la validación real se hace en un proyecto **nuevo y vacío**,
    `roomly-validation-2`, que crea y configura el propietario. No se repara
    ni se migra `roomly-validation` (esto sustituye la «estrategia de
    migración incremental» pendiente desde 2.0).
  - **D2(a)**: marca de identidad nueva `roomly-validation-2`, comparación
    exacta en todas las guardas (las credenciales del proyecto antiguo no
    pasan).
  - **E3**: E1 (Playwright contra Supabase simulado, en el repo y en CI) y
    E2 (flujo real con email real, solo en el workflow manual), separados.
  - **D1(a)**: E2 con SMTP propio y buzón de prueba accesible por API
    (proveedor sin decidir, parametrizado); sin `generateLink`, sin tocar
    `/callback`.
  - **Runner**: aislamiento por archivo en `run-sql-suite.sh`, sin cambiar
    `tests/db/11`.

  Infraestructura: runner aislado, preflight P0–P6 exacto (38 políticas, 37
  desde H4 de la 2.9; 12 triggers, 10 funciones, GRANT de
  `housing_preferences`), E1 25/25, job `e2e-real` y adaptador del buzón
  de Mailtrap (`tests/e2e/real/mailboxes/mailtrap.mjs`, commit `ec7c3fc`).
  El punto A de 2.3 y H4 pasaron a la 2.9.

  **Evidencia estructural — run 13** (`37533380047`, sobre `f9f08ad`,
  `apply_migrations=true`, `run_e2e_real=false`):
  - guarda en verde;
  - las 9 migraciones y el seed, aplicados en una sola transacción;
  - P0–P6 en verde (37 políticas);
  - suite SQL 01–13 con roles reales: los 13 archivos en verde, cada uno
    revertido con ROLLBACK y sin restos;
  - supabase-js 46/46 y AU3/AU5 16/16.

  **E2 real — run 15** (`37543144825`, sobre `ec7c3fc`,
  `apply_migrations=false`, `run_e2e_real=true`):
  - la parte estructural, otra vez en verde, sin migraciones;
  - E2 1/1: formulario real → `signInWithOtp` → email real recibido en
    Mailtrap → enlace `/auth/v1/verify` validado → `/callback?code=` con
    PKCE → onboarding → `/perfil`, `/preferencias` y `/ajustes` guardados y
    releídos → logout → `/perfil` sin sesión vuelve a `/login`;
  - sin `generateLink` ni `token_hash`, y sin cambios en `/callback`;
  - limpieza: 1 usuario de prueba borrado, sin filas asociadas, y el buzón
    de Mailtrap vacío. No quedaron residuos.

  El registro público de Auth se abrió solo para la ventana del E2 y el
  propietario lo cerró después. El proyecto histórico `roomly-validation` y
  el retirado `qhwu…` (marca `roomly-retirado`) no se tocaron.

  **Historial de diagnóstico** (ningún run escribió nada en ningún
  proyecto; detalle en `docs/SUPABASE_VALIDATION.md`):
  - runs 3–5: apply-migrations se negó porque el esquema ya existía;
  - runs 6–11: la guarda rechazó el proyecto retirado `qhwu…`, al que
    apuntaban unos secrets antiguos de repositorio;
  - run 12: los secrets llegaron vacíos (estaban en otro Environment);
  - run 14: `E2E_MAILBOX_CONFIG` no era un JSON válido.

  Fuera de la 2.8: la cuenta desactivada no forma parte del E2. La cubren
  E1 (`deleted-account.spec.ts`, contra el Supabase simulado) y
  `tests/db/08`, en verde también en Supabase real.
- 2.9 Endurecimiento de integridad y privacidad — 📝 **subfase NUEVA,
  definida por el propietario el 2026-10-04; no formaba parte del plan
  original de la Fase 2** (que terminaba en 2.8). ✅ **COMPLETADA el
  2026-10-04** (PROGRESS.md sesiones 26–28): punto A en `20261004120000`
  (commit `73d6028`) y H4 en `20261004120100` (commit `f9f08ad`), validados
  después también en Supabase real (runs 13 y 15 de la 2.8). Alcance:
  1. **Punto A de 2.3**: `onboarding_completed_at`, una vez no nulo, no
     puede volver a `NULL` ni cambiar a otro timestamp. Decisión D1: para
     todos los roles (`authenticated`, admin y `service_role`), sin bypass;
     reiniciar un onboarding sería una decisión explícita nueva.
  2. **H4**: un usuario autenticado no puede leer `date_of_birth` (ni el
     resto de la fila) de otros perfiles. Decisión D2 (H4-1): eliminar
     `profiles_select_authenticated`; cada usuario lee solo su perfil, el
     admin todos (`profiles_admin_all`) y los datos públicos de otros salen
     de `public_profile_previews`. Contradice la regla genérica de Fase 0
     («`profiles` completo requiere sesión»): prevalece esta decisión
     específica de privacidad. Pasa de 38 a 37 políticas, y se actualiza la
     infraestructura de la 2.8 afectada (P3 de `preflight.sql`, sus
     expectativas, el mock de E1 y la documentación).

  **Objetivo cumplido**: los dos puntos del alcance están implementados
  con migraciones incrementales, sin tocar migraciones históricas, código
  de producto ni Supabase remoto. Una auditoría final comparó el catálogo
  antes y después de la 2.9: las únicas diferencias son la política
  eliminada y el cuerpo de `enforce_onboarding_completion`; GRANT, EXECUTE,
  triggers, columnas y la vista quedan idénticos.

  **Validaciones ejecutadas**:
  - En local: `test:db` 265/265, `npm test` 597/597, `test:infra` en verde
    y E1 25/25 (con el Chromium preinstalado, orientativo); lint,
    typecheck, `format:check` y build en verde.
  - Mutaciones detectadas: 3/3 del punto A y 5/5 de H4.
  - Casos límite (upsert `ON CONFLICT`, `MERGE`, joins): rechazados.
  - CI del PR #6 (run `37231766834`, sobre `f9f08ad`), en verde:
    `lint-typecheck-test-build` (597/597), `db-security` y `e2e-local`
    (25/25 con el Chromium oficial v1243 de Playwright).

  **Riesgos no bloqueantes** (documentados en `DATABASE.md` y
  `SECURITY.md`):
  - borrar y recrear un perfil (admin o `service_role`) reinicia en la
    práctica el onboarding;
  - un superusuario puede desactivar el trigger;
  - el mock de E1 no emula el bloqueo del punto A ni `profiles_admin_all`;
  - H3 sin cambios: la vista pública expone `role` a anon;
  - avisos de CI anteriores a la 2.9: acciones con Node.js 20 obsoleto y
    `npm audit` con 5 vulnerabilidades altas.

  **Pendiente en fases posteriores**:
  - H3;
  - cualquier reinicio administrativo de un onboarding (decisión nueva).

  La validación en Supabase real del punto A y H4, antes pendiente, se hizo
  en los runs 13 y 15 de la 2.8.

Fuera de Fase 2 por decisión del usuario: foto de perfil/Storage (M3) y
borrado de cuenta (H6). Una cuenta con `deleted_at` verá una pantalla de
cuenta desactivada (decisión de producto, se implementa en 2.2).

**Criterios de aceptación**: un usuario real puede completar
registro → perfil → preferencias sin errores, con validación Zod en
servidor, y los datos persisten correctamente separados entre `profiles`
y `housing_preferences`. [✅ E2 real, run 15 de la 2.8, en
`roomly-validation-2b`, con la RLS de las dos tablas validada en el mismo
proyecto (suite SQL 01–13 y supabase-js)]

**Cierre de la Fase 2 (2026-10-06)**: 2.0–2.9 completadas, con los tests en
verde en local, en CI y en Supabase real. Siguen fuera de alcance por
decisión del usuario: Google y Apple OAuth (diferidos), foto de perfil y
Storage (M3) y borrado de cuenta (H6).

## Fase 3 — Compatibility — 🟡 IMPLEMENTACIÓN LOCAL HECHA (2026-10-07), NO CERRADA

Cuestionario de 25-30 preguntas (con guardado de progreso parcial —
mitiga el abandono a mitad, ver riesgos), almacenamiento en
`compatibility_responses`, motor de matching (`lib/matching/score.ts`),
pantalla de matches con explicación ("por qué encajáis" / "posibles
diferencias").

**Criterios de aceptación**: el motor de matching tiene cobertura de
tests casi total (es el diferencial del producto), es determinista
(mismos inputs → mismo score siempre), y los pesos son modificables
editando un único archivo.

**Especificación cerrada (2026-10-07)**: el propietario eligió las 18
decisiones bloqueantes (D1–D18, todas con la opción recomendada) y D6 = B.
El resumen está en `ROOMLY_MASTER_SPEC.md` §8–10 y §14, y el detalle en
`PROGRESS.md` (sesión 31).

Subfases implementadas en local, sin tocar Supabase remoto:
- **3.1 Base de datos y seguridad**:
  - migración `20261007120000_compatibility_responses_hardening.sql`: S1–S6,
    solo el servidor escribe, `authenticated` solo SELECT de su fila, `anon`
    sin acceso, trigger de cuentas eliminadas para todos los roles;
  - `lib/services/compatibility.ts`;
  - test estático de `createAdminClient`.
- **3.2 Cuestionario v1 (29 preguntas) y motor**: `lib/matching/*`.
- **3.3 Filtros duros**: `passesHardFilters`, sin índices nuevos.
- **3.4 Candidatos**: `lib/services/matching.ts`, una sola consulta cruzada
  con service_role, `CandidateDTO` con lista blanca, 20 por página.
- **3.5 Estados y navegación**: `questionnaireStatus`; onboarding → `/test`;
  `/explorar` sin test completado → 307 `/test`.
- **3.6 Tests**: unitarios, `tests/db/14`, preflight P3/P4/P6 y selftests,
  actualización incremental local, E1 (mock con service_role ficticio) y E2
  adaptado sin ejecutar.
- **3.7 Documentación.**

Cumplimiento de los criterios de aceptación:
- el motor tiene tests de casos, de propiedades (simetría, determinismo) y de
  mutaciones;
- los pesos y las constantes están en `lib/matching/weights.ts`.

Qué falta para **cerrar** la Fase 3 (cada punto con su autorización):
- Validación real desde cero en un **proyecto Supabase nuevo**. `uwxb…` no se
  toca y su esquema es de la Fase 2. La suite SQL 14 y la api-suite CRA1–CRA6
  necesitan la migración nueva. También hay que adaptar la marca en la guarda,
  el preflight, los selftests y el workflow.
- E2 real con el destino `/test`, en el proyecto nuevo.
- CI en verde en un PR.
- Textos y etiquetas finales del cuestionario.
- `SUPABASE_SERVICE_ROLE_KEY` en el servidor de producción, antes de
  desplegar.

## Fase 4 — Rooms

CRUD de habitaciones, subida de fotos a Storage, búsqueda con filtros,
página de detalle (con dirección aproximada, nunca exacta, hasta match).

**Criterios de aceptación**: búsqueda paginada, sin N+1 verificado con
tests, `room_addresses` nunca se serializa en ninguna respuesta pública.

## Fase 5 — Interest

Favoritos, "me interesa", detección de interés mutuo → creación de match
desde el servidor (nunca desde el cliente).

Desde la Fase 3 (D14 y la especificación cerrada): «Ver perfil» de terceros y el botón
«Me interesa» de la tarjeta de `/explorar` llegan aquí; `/matches` queda para
los matches mutuos. Cuando exista «Ver perfil», el acceso solo debe permitirse
si quien mira pasa los filtros duros con esa persona o ya hay match, para
impedir enumerar perfiles por id.

**Criterios de aceptación**: test que verifica que un intento de INSERT
directo a `matches` desde un cliente autenticado (sin pasar por el
servicio) falla por RLS.

## Fase 6 — Chat

Conversaciones vía Supabase Realtime, mensajes, contador de no leídos,
bloquear, reportar.

**Criterios de aceptación**: dos usuarios en un match pueden chatear en
tiempo real; un tercer usuario no puede leer esa conversación ni aunque
conozca el UUID (verificado con test de RLS).

## Fase 7 — Admin

Dashboard, gestión de usuarios, habitaciones, reportes, métricas básicas.

**Criterios de aceptación**: `/admin` inaccesible para un usuario no-admin
tanto por RLS como por el chequeo de servidor (dos tests independientes);
toda acción de moderación queda en `admin_action_logs`.

## Fase 8 — Polish

Responsive, accesibilidad, SEO técnico (metadata, sitemap, robots,
Open Graph), rendimiento, estados de error/carga/vacío, revisión de
seguridad completa.

## Fase 9 — Beta

Producción, analítica (PostHog), monitoring, backups, política de
privacidad y términos (con el DPO/legal — no los redacta Claude),
feedback. Lanzamiento a un grupo pequeño de usuarios en Barcelona.

---

## Roadmap post-MVP (referencia, sin fecha)

**V2**: grupos de piso, verificación telefónica y universitaria real,
favoritos avanzados, notificaciones push, app móvil (Expo).

**V3**: grupos para buscar piso, propietarios profesionales, verificación
de viviendas, premium, anuncios destacados.

**V4**: reservas, pagos (Stripe), contratos, seguros.

**V5**: universidades/residencias como clientes, empresas, expansión
internacional.

Nada de esto se construye antes de que el paso anterior tenga demanda
demostrada (sección 31 del brief).
