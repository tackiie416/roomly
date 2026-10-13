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

## Fase 3 — Compatibility — 🟡 INTEGRADA EN `master` Y VALIDADA EN SUPABASE REAL (2026-10-09), NO CERRADA

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

Subfases, implementadas primero en local e integradas después en `master`
con el PR #7 (`f34b2c8`):
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
- los pesos y las constantes están en `lib/matching/weights.ts`;
- **cobertura «casi total»: aceptada por el propietario el 2026-10-13**
  (`PROGRESS.md`, sesión 39), con la medición de
  `npm run test:coverage:matching` (PR #21, merge `9f6d67a`). El detalle por
  archivo está en `docs/TESTING.md`, «Cobertura del motor de matching».
  - Cifras: líneas 100 % (212/212), funciones 100 % (58/58), ramas 98,38 %
    (244/248) y sentencias 99,61 % (258/259), con mutaciones del motor 7/7
    detectadas y 1030/1030 tests unitarios.
  - Las cuatro ramas sin cubrir son casos defensivos de `score.ts` que los
    cuestionarios actuales no producen. No se exige el 100 % de ramas ni se
    añaden tests artificiales para cubrirlas.
  - Esta aceptación solo resuelve el criterio de cobertura. No cierra la
    Fase 3 ni cambia los otros criterios ni la lista de «Pendiente».

**Hecho después de la implementación local** (2026-10-08 a 2026-10-10):
- **Integración en `master`:** PR #7 (implementación, `f34b2c8`), PR #8
  (marca `roomly-validation-3`, `f619812`), PR #9 y PR #10 (documentación de
  los runs, `6dae75f` y `de68ef1`), PR #11 (textos editoriales, `83654eb`) y
  PR #13 (cuestionario v2, `7550d71`).
- **CI de GitHub** (`lint-typecheck-test-build`, `db-security`, `e2e-local`):
  en verde en el head de cada uno de esos PR y después de cada merge. Tras el
  PR #13, el run `38089079771` sobre `7550d71`: 1013/1013 unitarios y E1
  30/30. Las CI posteriores están en «Hecho después de la v2».
- **Validación real** en el proyecto nuevo `roomly-validation-3`; `uwxb…`
  (`roomly-validation-2`) no se toca y la guarda lo rechaza. Detalle en
  `docs/SUPABASE_VALIDATION.md`.
  - Estructural: run 16 (`37994799026`, `f619812`, `apply_migrations=true`).
  - E2: run 18 (`37999470912`, `6dae75f`), con el onboarding terminando en
    `/test`. El run 17 falló por configuración, sin enviar emails ni crear
    usuarios.
  - D6 = B: el E2 no guarda el test ni abre `/explorar`; eso lo cubren en
    real la suite SQL 14 y la api-suite CRA1–CRA6.
- **Textos del cuestionario:** los cambios editoriales (E1–E19), los textos
  generales de `/test` (G1–G4) y la ayuda S5 de las visitas, dentro de la v1
  (PR #11). Son posteriores a los runs 16–18 y no han pasado por un run real.
- **Versión 2 del cuestionario (S1–S4)**, integrada en `master` el
  2026-10-10 con el PR #13 (`ef11777`, merge `7550d71`). Detalle en
  `PROGRESS.md`, sesión 37.
  - CI en verde en el head del PR (run `38088753365`) y después del merge
    (run `38089079771`): 1013/1013 unitarios, build, E1 30/30 y
    `db-security`.
  - Sin validación real contra Supabase: los runs 16–18 son anteriores a la
    v2.
  - El propietario eligió la opción A de la auditoría de impacto, con la
    lectura estricta de D15a.
  - La v1 queda como histórica, sin cambios; la v2 es la vigente
    (`CURRENT_QUESTIONNAIRE_VERSION = 2`).
  - Ocho ids nuevos con sufijo `_v2` (las cuatro parejas de S1–S4); las
    otras 21 preguntas son las mismas.
  - Un test de la v1 queda desactualizado. Se reutilizan sus 21 respuestas
    comunes; las de los ocho ids sustituidos no se copian.
  - Sin migración, y sin cambios en los pesos ni en las fórmulas del score.
  - La dirección de las diferencias de Ruido ya no usa el id fijo
    `noise_tolerance`: sale del cuestionario de cada versión, y sin esa
    pregunta el motor devuelve `invalid_questionnaire`.

**Hecho después de la v2** (2026-10-11 y 2026-10-12, PR #14–#19; detalle en
`PROGRESS.md`, sesión 38):
- **Documentación** (PR #14–#16): el estado de la v2, `docs/TESTING.md` y la
  evaluación de un run real de la v2.
  - Decisión del 2026-10-11, anterior al run 19: no se lanza un run real
    solo por los cambios de la v2, que no tocan migraciones, servicios,
    workflows ni tests reales.
  - La v2 no tuvo un run real dedicado solo a ella. Después, el run 19
    validó sus servicios (SVC 6/6 y GC 4/4, ver abajo).
  - Sigue pendiente validar en staging el runtime completo de Next.js y el
    hosting con la clave real.
- **Implementado e integrado:**
  - PR #17 (`92fb757`): SVC1–SVC5 y GC1–GC4 en la api-suite, y el registro
    de cada usuario de prueba para la limpieza antes del login.
  - PR #19 (`d4618cf`): `SUPABASE_SERVICE_ROLE_KEY` se valida y se lee en
    `lib/env.server.ts` (`server-only`), y `lib/env.ts` queda solo con la
    configuración pública. Antes, el nombre de la variable llegaba a un
    chunk público del build de E1.
    - D1 lo comprueba dentro de E1, también en la CI.
- **Validado en real, solo los servicios:** el run 19 (`38106687478`,
  `92fb757`, `apply_migrations=false`, `run_e2e_real=false`), documentado en
  el PR #18 (`5b9f2f8`).
  - Guarda, P0–P6, SQL 01–14 y AU3/AU5 16/16 en verde.
  - api-suite 62/62, con SVC 6/6 y GC 4/4.
  - `migrate` y E2 omitidos, como debían.
  - Valida `saveQuestionnaireAnswers` y `getCandidates`, llamados desde el
    runner. Son los casos de servicio de la v2:
    - SVC1–SVC4 guardan respuestas de la v2, incluido el paso de la v1 a la
      v2;
    - SVC5 rechaza un id de la v1 y una respuesta fuera de escala;
    - GC1–GC4 prueban candidatos de la v2 y los filtros reales de versión.
  - No valida el runtime completo de Next.js ni una aplicación desplegada
    con la clave real.
  - La limpieza la verificó el propio workflow, sin inspección remota
    independiente.
- **Integrado, sin una validación propia:**
  - D1 comprueba el build de E1 con la clave ficticia del mock. No valida el
    runtime desplegado, otros entornos ni la clave real.
  - No se ha validado un entorno de staging con la clave real, y el runtime
    completo de Next.js con la clave real tampoco.
    - El 2026-10-12, GitHub mostró en el PR #20 un Deploy Preview de Netlify
      (`lovely-tulumba-009360`), con un comentario y tres checks de
      Netlify. El repositorio no contiene configuración de Netlify.
    - Sin verificar: qué publica ese preview, qué variables usa y cómo se
      conectó la integración. No se puede afirmar que equivalga a un
      entorno de staging validado.
  - La combinación «Next.js en ejecución + cliente admin» sigue siendo un
    riesgo aceptado (`docs/SECURITY.md`).
- **CI:** en verde en el head de cada PR y después de cada merge. La última,
  el run `38204349293` sobre `d4618cf`: 1030/1030 unitarios, build, E1 32/32
  (con los 2 de D1) y `db-security`.

**Hecho después del PR #19** (2026-10-12 y 2026-10-13; detalle en
`PROGRESS.md`, sesión 39):
- PR #20 (`c90f9f1`): la sincronización de `PROGRESS.md`, `CLAUDE.md` y este
  archivo tras los PR #14–#19 (sesión 38).
- PR #21 (`9f6d67a`): `npm run test:coverage:matching`, la cobertura V8 de
  `lib/matching/` con los tests unitarios, sin umbral y fuera de la CI. Los
  resultados están en `docs/TESTING.md`.
- **CI:** en verde en el head y después del merge de los dos. La última, el
  run `38338233233` sobre `9f6d67a`: 1030/1030 unitarios, build, E1 32/32 y
  `db-security`.
- Decisión del 2026-10-13: el criterio de cobertura queda aceptado (ver
  «Cumplimiento de los criterios de aceptación»). La Fase 3 sigue NO
  CERRADA.

**Alcance del cierre** (decisión del propietario, 2026-10-13; detalle en
`PROGRESS.md`, sesión 40):
- **Condiciones de cierre:**
  - los tres criterios escritos (ver «Cumplimiento de los criterios de
    aceptación»);
  - las subfases 3.1–3.7;
  - y la documentación de cierre preparada.

  Los criterios y las subfases constan como cumplidos y los criterios no
  cambian. Falta la documentación de cierre: la Fase 3 sigue NO CERRADA.
- **Regla 8 de `CLAUDE.md` y la lista «Pendiente»:** un punto de esta lista
  que el propietario clasifique como no bloqueante no impide el cierre por
  aparecer en ella.
- **No bloquean el cierre** y pasan a la Fase 8 o al backlog (sin asignar
  todavía):
  - la paginación del cuestionario;
  - señalar las preguntas sin responder;
  - una confirmación antes de finalizar. Si se implementa, debe seguir
    funcionando sin JavaScript y respetar las decisiones D7.
- **Texto «Por qué encajáis»:** el actual se acepta para el alcance de la
  Fase 3, mientras siga cumpliendo la especificación de las explicaciones
  (`ROOMLY_MASTER_SPEC.md` §10).
- **Antes de usar el producto con personas reales o de lanzarlo.** No son
  condiciones del cierre técnico y siguen sin resolver (`docs/SECURITY.md`,
  Fase 3):
  - datos de tabaco y vapeo: **REQUIERE REVISIÓN LEGAL**;
  - acceso operativo a las respuestas: revisar quién puede acceder al
    proyecto de Supabase y a la clave service_role, y con qué
    procedimientos;
  - Deploy Previews de Netlify: comprobar a qué proyecto de Supabase se
    conectan y si permiten registros reales.
    - Lo que se sabe, según el propietario: Auto Publishing está bloqueado
      y el proyecto de Netlify no muestra variables de entorno.
    - No se han revisado las variables compartidas del equipo, ni está
      verificado que las previews estén aisladas de Supabase.

**Pendiente** (cada punto con su decisión o autorización; qué bloquea el
cierre lo decide el propietario):
- Mejoras del test que necesitan código (paginación, señalar las preguntas
  sin responder y una confirmación al terminar): no bloquean el cierre; Fase
  8 o backlog.
- Datos de tabaco y vapeo: **REQUIERE REVISIÓN LEGAL**, antes de usar el
  producto con personas reales.
- Acceso operativo a las respuestas: revisar quién accede al proyecto de
  Supabase y a la clave service_role, y con qué procedimientos, antes del
  lanzamiento.
- Deploy Previews de Netlify: a qué proyecto de Supabase se conectan y si
  permiten registros reales, antes de usarlas con personas reales.
- Si se añade a `cleanup.mjs` la comprobación de `compatibility_responses`.
- Validar el runtime completo de Next.js con la clave real en staging antes
  del primer despliegue. Cómo y cuándo, lo decide el propietario, con
  autorización.
- Sin E2 real desde el run 18 (v1, hasta `/test`): cualquier E2 nuevo, con
  autorización expresa.
- Las observaciones menores de la revisión de D1 (`PROGRESS.md`, sesión 38).
- `SUPABASE_SERVICE_ROLE_KEY` en el servidor de producción, antes de
  desplegar.
- Registro de Auth de `roomly-validation-3`: el propietario declaró el
  2026-10-09 que está cerrado; no está verificado de forma independiente.
- Cualquier run nuevo contra `roomly-validation-3`, siempre con
  `apply_migrations=false` y con autorización expresa.

Fuera de la Fase 3, pendiente operativo: rotar las claves de `uwxb…` y
pausarlo.

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
