# Estrategia de testing — ROOMLY

## Pirámide

- **Unit (Vitest)**: lógica pura — sobre todo `lib/matching/score.ts`
  (casi cobertura total: es determinista y es el diferencial del
  producto), esquemas Zod, utilidades.
- **Integración (Vitest + Supabase)**: `lib/services/*` contra una base
  de datos real de test — incluye verificar políticas RLS actuando como
  distintos usuarios (JWT simulados por rol), no solo la lógica de
  negocio.
- **E2E (Playwright)**: los 3 flujos completos que pide el brief
  (sección 39).

## Estado actual (2026-10-11, Fase 3 integrada en `master` con la v2 del cuestionario; validada en Supabase real antes de la v2; no cerrada)

**Qué demuestra cada capa** (no confundirlas):
- `npm run test` (Vitest): lógica de la aplicación con un cliente Supabase
  **simulado**. Cuando un test depende de una regla de la base de datos
  (FKs, triggers de barrios, universidad o ciudad), el mock la **emula**:
  prueba que la aplicación traduce bien el error, no que la regla exista.
- `npm run test:db`: PostgreSQL 16 local de verdad, con todas las
  migraciones y un shim de Supabase (roles, `auth.uid()`). Es la única capa
  que demuestra RLS, GRANT, FKs y triggers. No es Supabase real.
- **E1** (`npm run test:e2e`, Fase 2.8): Playwright con la app real
  (`next build` + `next start`) contra el Supabase **simulado** del repo
  (`tests/e2e/support/mock-supabase.mjs`, que emula Auth con PKCE, RLS,
  GRANT y triggers de las tablas del flujo; desde la Fase 3 también
  `compatibility_responses` y, con una clave service_role ficticia, la
  lectura cruzada de candidatos). Sin red ni secrets; en CI (`e2e-local`).
  Prueba el flujo y el routing de la app, no la base de datos.
- **E2** (`npm run test:e2e:real`, Fase 2.8): el mismo flujo contra el
  proyecto real de validación con email real, solo desde el workflow manual.
  - **En verde en el run 15** (2026-10-06), en `roomly-validation-2b`
    (`uwxb…`).
  - Desde la Fase 3, el recorrido pasa por `/test`. **En verde en el run
    18** (2026-10-09), en `roomly-validation-3`.
- Chromium con scripts del scratchpad (2.3–2.7): `next start` contra un
  Supabase simulado con estado; no están en el repositorio. E1 los sustituye
  como suite reproducible.
- Supabase real: el checkpoint de Fase 1 en `roomly-validation` (histórico),
  la validación de la Fase 2 en `roomly-validation-2b`, con la parte
  estructural en el run 13 y el E2 en el run 15, y la validación de la Fase 3
  en `roomly-validation-3`: estructural en el run 16 y E2 en el run 18
  (2026-10-09; ver `docs/SUPABASE_VALIDATION.md`).


| Comprobación | Resultado | Dónde |
|---|---|---|
| `format:check`, `lint`, `typecheck`, `build` | ✅ | local y CI |
| `npm run test` | ✅ 1013/1013 con la v2 del cuestionario (S1–S4, integrada con el PR #13), 149 nuevos: motor 86 → 172 (los casos de la especificación con la v1 y con la v2, la lista exacta de cada versión, y v1 frente a v2 en el motor: `version_mismatch`, respuestas de la v1 sin puntuar en la v2), versiones del cuestionario 22 (`questionnaire-versions`, nuevo), dirección de Ruido por versión y cuestionarios rotos 19 (`matching-score-direction`, nuevo), cambio de versión 5 → 16 (paso real v1 → v2, sin `vi.mock`), estado del test y Zod 22 → 26, guards y Server Action 25 → 29, candidatos 25 → 27, filtros 33 → 34. Antes: ✅ 864/864 (2 de aislamiento de la marca `roomly-validation-3` en `validation-infra.test.ts`, PR #8; antes 862, Fase 3, 245 nuevos: motor 86 (`matching-score`: cuestionario exacto, pesos, similitud, conducta/tolerancia con `min`, presupuesto 0/75/150/151, barrios, renormalización, r6, umbrales, dirección, 500 pares de simetría, determinismo, entradas inválidas sin excepción, textos sin cifras), filtros 33, estado del test y Zod 22, servicio del test 36 + 5 de cambio de versión, servicio de candidatos 25 (consulta única, filtros SQL, defensa en profundidad, orden, paginación, lista blanca del DTO), guards y Server Action 25, test estático de service_role 6, proxy +3, infraestructura +2, shell +2; antes 617: 20 del adaptador de Mailtrap del E2 real, Fase 2.8; 65 de infraestructura de validación, Fase 2.8: identidad `roomly-validation-2`, preflight derivado de las migraciones, separación E1/E2, secrets por paso del workflow, lógica del E2 real y aviso de registro abierto aunque falle el buzón; 17 de shell y errores, Fase 2.7; 46 de ajustes, Fase 2.6: esquema y servicio de avisos, Server Action, página y logout; 39 de Fase 1 + 113 de Fase 2.1 + 131 de routing de Auth, Fase 2.2 + 64 de onboarding, Fase 2.3 + 69 de perfil propio, Fase 2.4 + 53 de preferencias, Fase 2.5: reglas del servicio, Server Action (también referencias inexistentes o incompatibles), página, formulario, datos de referencia y proxy) | local (1013/1013 con la v2 antes de su commit, 2026-10-10; 864/864 sobre `83654eb`, 2026-10-09); en CI (`lint-typecheck-test-build`), 1013/1013 con la v2: en el head del PR #13 (run `38088753365`), después de su merge (run `38089079771`, `7550d71`) y después del merge del PR #14 (run `38100362367`, `83d9687`). Antes de la v2, 864/864 sobre `83654eb` (run `38003093188`, después del merge del PR #11) y, en el PR #6, CI #11 (`f9f08ad`, 597) y CI #12 (`ec7c3fc`, 617) |
| `tests/supabase/auth-redirects.sh` | ✅ 16/16 (AU3a–g, AU5a–i) | local contra `next start` con Supabase simulado (Fases 2.2 y 2.3); en `roomly-validation` se ejecutaron las 6 anteriores |
| Flujo de onboarding en Chromium | ✅ con y sin JavaScript | local con `next start` y Supabase simulado con estado (Fase 2.3); no es la suite E2E |
| Flujo de `/perfil` en Chromium | ✅ 24/24 (12 con y 12 sin JavaScript, incluido el logout) | local con `next start` y Supabase simulado con estado (Fase 2.4); no es la suite E2E |
| Shell de Fase 2.7 en Chromium | ✅ 35/35 (20 con JavaScript y 15 sin él; sin JavaScript no aplican `aria-current` ni «Reintentar»): `/` con su contenido y «Entrar», sin sesión/sin perfil/eliminada en las tres rutas, nav con los tres enlaces y navegación entre ellas, perfil incompleto, error de servidor sin texto técnico, logout desde el nav; y regresión con el shell: `/perfil` 24/24, `/preferencias` 43/43, `/ajustes` 24/24, onboarding 2/2 | local con `next start` y Supabase simulado; scripts en el scratchpad de la sesión (no en el repositorio) |
| Flujo de `/ajustes` en Chromium | ✅ 24/24 (12 con y 12 sin JavaScript: sin sesión, sin perfil, eliminada, estado actual, desactivar/activar y recargar, mismo valor en `/perfil`, `full_name` inyectado, `?profile_id=` en la URL, eliminada con la página abierta, logout) + `/perfil` otra vez 24/24 | local con `next start` y Supabase simulado con estado (Fase 2.6); no es la suite E2E |
| Flujo de `/preferencias` en Chromium | ✅ 43/43 (22 con y 21 sin JavaScript; el filtro dinámico solo aplica con JavaScript; incluye crear preferencias con el onboarding ya completado) + regresión del onboarding 2/2 | local con `next start` y Supabase simulado con estado que emula los triggers (Fase 2.5); no es la suite E2E |
| `npm run test:db` (PostgreSQL local con shim) | ✅ 305/305, también con la v2 del cuestionario (2026-10-10, sin cambios en la base de datos) (Fase 3.1: `14_compatibility_responses`, 40 aserciones CR1–CR20; antes 265, incluye `05`/`06` de Fase 2.0, `07` de Fase 2.3 y del punto A de la 2.9, `08` de cuentas eliminadas, `09` de Fase 2.4, `10` de Fase 2.5, `11` de ownership aislado, `12` de Fase 2.6 y `13` de H4, Fase 2.9) | local; en CI (`db-security`, paso `tests/db/run.sh`) en verde sobre `83654eb` (run `38003093188`) y en los PR #7–#11; antes, sobre `f9f08ad` (PR #6, run `37231766834`) |
| `npm run test:e2e` (E1, Playwright) | ✅ 30/30 con la v2 del cuestionario (S1–S4, integrada con el PR #13), en local y en CI: candidatos sembrados con la versión vigente, una candidata solo con el test v1 que no aparece, un escenario nuevo (test v1 completado → aviso en `/test`, las 21 respuestas comunes marcadas y las 8 nuevas sin responder, borrador de la v2 con una pendiente y completado en la v2) y la regresión de la versión de las siembras del mock (`mock-seed-version`, 2 tests: 13 versiones no válidas → 400 sin sembrar ni cambiar nada; 1, 2 y 2147483647 se siembran). Antes: ✅ 27/27 en local (Fase 3: `compatibility-flow`: onboarding → `/test`, guardar a medias y retomar, `/explorar` → `/test` sin test, completar → `/explorar` con candidatos solo del DTO (sin admin, eliminada ni presupuesto lejano, sin fecha de nacimiento ni presupuesto exacto), paginación, editar sin cambiar la fecha, service_role solo para candidatos y escritura del test; y el test sin JavaScript; los demás specs, con el destino `/test`). Antes: ✅ 25/25 (también tras H4 de la 2.9, con el mock devolviendo solo la fila propia de `profiles`): rutas protegidas sin sesión (con y sin JavaScript, y 307 sin contenido), alta de estudiante por magic link → `/callback` PKCE → onboarding → `/perfil` → `/preferencias` → `/ajustes` → logout (sesión anterior inservible), enlace en otro navegador o reutilizado, `/callback` con código inventado o error, `next` tras el login, cuenta eliminada (rutas, formulario abierto, nuevo login), `profile_id`/`id` ajenos en URL y formularios, formularios sin JavaScript, smoke | local con el Chromium preinstalado **1194** vía `PLAYWRIGHT_CHROMIUM_EXECUTABLE` (Playwright 1.63 espera 1243: combinación no soportada oficialmente); en CI (`e2e-local`), con el Chromium que instala el workflow, 30/30 con la v2: en el head del PR #13 (run `38088753365`), después de su merge (run `38089079771`) y después del merge del PR #14 (run `38100362367`). Antes de la v2, 27/27 sobre `83654eb` (run `38003093188`) y 25/25 sobre `f9f08ad` con el Chromium oficial v1243 (PR #6, run `37231766834`) |
| Mutaciones de la app contra E1 | ✅ 4/4 detectadas (cuenta eliminada → home, ajustes sin esquema estricto, logout sin `signOut`, `/preferencias` sin ciudad obligatoria) | local, restauradas por hash |
| `tests/supabase/guard-selftest.sh` | ✅ 28/28 (marca `roomly-validation-3`; las anteriores y variantes no pasan; aislamiento: con la marca `roomly-validation-2` la guarda, migraciones, P0 y suite SQL abortan) | local; en CI (`db-security`) desde 2.8 |
| `tests/supabase/sql-suite-selftest.sh` | ✅ 78/78: `run-sql-suite.sh` real 01–14 con las mismas aserciones que `run.sh` (305 desde la Fase 3.1; 265 tras H4 de la 2.9; 240 tras el punto A; eran 218), una sesión aislada por archivo (14; el número se cuenta), sin restos, rollback de bloque, sin fugas de rol/GUC, 31 formas de control de transacción rechazadas antes de conectar, 16 identificadores `"..."`/cadenas `E'...'` que intentan ocultar un control (incluido el caso de la auditoría final) rechazados y los legítimos aceptados, WARNING → fallo, fallo a mitad sin restos, 11 sin reescribir falla, marcas anteriores (`roomly-validation` y `roomly-validation-2`) rechazadas | local; en CI (`db-security`) desde 2.8 |
| Mutaciones del runner | ✅ 4/4 detectadas (sin reescritura a SAVEPOINT, WARNING no falla, COMMIT permitido, COMMIT en vez de ROLLBACK) + validador tras la auditoría final: 2/2 con efecto detectadas (sin estado de identificador `"..."`, sin rechazo de `E'...'`); 2 sin efecto observable (quitar la `""` escapada es equivalente; quitar el error de identificador sin cerrar lo cubre «sentencia final sin `;`») | local, restaurado por hash |
| Mutaciones de la limpieza del E2 | ✅ 2/2 detectadas (aviso de registro abierto sin captura del fallo del buzón; error de los ajustes que tapa el original) | local, restaurado por hash |
| Mutaciones del punto A de la 2.9 contra `test:db` | ✅ 3/3 detectadas (sin la migración, bloqueo solo del paso a `NULL`, función `SECURITY DEFINER`) | local, migración restaurada y comprobada con `cmp` |
| Mutaciones de H4 (2.9) contra `test:db` | ✅ 5/5 detectadas: sin la migración; `profiles_select_authenticated` recreada; otra política SELECT `using (true)`; la política propia, con su nombre, pero `using (auth.uid() is not null)`; `public_profile_previews` con `date_of_birth` | local, con migraciones temporales borradas y la de H4 comprobada por hash |
| `tests/supabase/preflight-selftest.sh` | ✅ 44/44: P0–P6 pasan con el esquema actual y 36 mutaciones (8 de `compatibility_responses`, Fase 3.1; la marca `roomly-validation-2` en P0, Fase 3) fallan cada una en su check | local; en CI (`db-security`) desde 2.8 |
| `tests/supabase/migration-upgrade-selftest.sh` (Fase 3.1) | ✅ 6/6: migraciones de la Fase 2 con datos y después las nuevas; filas conservadas y sujetas a S4/S5 y al bloqueo de cuentas eliminadas | local; en CI (`db-security`) en verde desde el PR #7; el último, sobre `83654eb` (run `38003093188`) |
| Mutaciones de la Fase 3.1 contra `test:db` | ✅ 5/5 detectadas (sin S4, UPDATE devuelto a `authenticated`, sin bloqueo de cuentas eliminadas, SELECT para `anon`, bajar de versión permitido) | local, sobre una copia de la migración en el scratchpad |
| Mutaciones del motor (Fase 3.2) | ✅ 7/7 detectadas (media en vez de `min`, Jaccard, dato ausente como neutro, sin r6, dirección por suma en vez de signos concordantes, sin tope de diferencias, umbral de fortaleza exclusivo) | local, `score.ts` restaurado y comprobado con `diff` |
| Migraciones + seed en Supabase real | ✅ las 9 migraciones y el seed, en una transacción (run 13) · ✅ las 10 migraciones y el seed, en una transacción (run 16, Fase 3) | `roomly-validation-2b` (`uwxb…`) · `roomly-validation-3` |
| Preflight P0–P6 en Supabase real | ✅ 37 políticas, 12 triggers, 10 funciones (runs 13 y 15) · ✅ marca `roomly-validation-3`, 18 tablas, 37 políticas, 13 triggers, 11 funciones (run 16; en verde en los runs 17 y 18) | `roomly-validation-2b` · `roomly-validation-3` |
| Suite SQL `tests/db` con roles reales | ✅ 58/58 (`01`–`04`, **histórico**) · ✅ `01`–`13` (los 13 archivos, cada uno revertido, sin restos; runs 13 y 15) · ✅ 305/305 en `01`–`14` (los 14 archivos, cada uno revertido; las 15 comprobaciones del runner, sin restos; runs 16 y 18) | `roomly-validation` (Fase 1) · `roomly-validation-2b` · `roomly-validation-3` |
| `npm run test:supabase` (supabase-js, JWT reales) | ✅ 46/46 (histórico) · ✅ 46/46 (run 13; en verde en el 15) · ✅ 52/52, con CRA1–CRA6 (runs 16 y 18) | `roomly-validation` · `roomly-validation-2b` · `roomly-validation-3` |
| AU3 / AU5 sin sesión (`auth-redirects.sh`) | ✅ 6/6 (histórico) · ✅ 16/16 (run 13; en verde en el 15) · ✅ 16/16 (runs 16 y 18) | `roomly-validation` y local tras `proxy.ts` · `roomly-validation-2b` · `roomly-validation-3` |
| AU4 magic link / AU5 con sesión | ✅ manual (histórico; login de un usuario creado en el dashboard) | `roomly-validation`, PC del propietario |
| E2 real (alta por magic link con email real) | ✅ 1/1, run 15 (`37543144825`, `ec7c3fc`): `signInWithOtp` → email en Mailtrap → `/auth/v1/verify` → `/callback?code=` con PKCE → onboarding → `/perfil` → `/preferencias` → `/ajustes` → logout; limpieza sin residuos (1 usuario borrado, buzón vacío). Run 14: falló antes de enviar nada por `E2E_MAILBOX_CONFIG` mal formado · ✅ 1/1, run 18 (`37999470912`, `6dae75f`, Fase 3): el mismo recorrido, con el onboarding terminando en `/test` («Test de convivencia»); limpieza: 1 usuario borrado, sin datos asociados, y mensajes del buzón borrados. Run 17 (`37998858090`): falló a los 267 ms, antes de abrir `/login`, por `E2E_MAILBOX_CONFIG` no válido; sin emails ni usuarios | workflow manual, job `e2e-real`, `roomly-validation-2b` · `roomly-validation-3` |
| Adaptador de Mailtrap (`tests/unit/mailtrap-mailbox.test.ts`) | ✅ 20/20 sin red; mutaciones 3/3 detectadas (sin decodificar `&amp;`, sin filtrar el destinatario, otra cabecera de autenticación) | local y CI |
| Ensayo del spec de E2 contra el mock | ✅ 1/1, y 5 fallos esperados (sin adaptador, buzón simulado en Actions, adaptador fuera de `tests/e2e`, id de ejecución inválido, enlace de otro origen) sin email ni enlace en la salida | local, adaptador `tests/e2e/support/mock-mailbox.mjs`; no es la validación real |
| CI `ci.yml` en GitHub Actions | ✅ `lint-typecheck-test-build`, `db-security` y `e2e-local` en verde en los PR #4, #5 y #6 (`e2e-local` 25/25; CI #11 sobre `f9f08ad` y CI #12 sobre `ec7c3fc`). Fase 3: en verde en el head de los PR #7–#14 (CI #16, #18, #20, #22, #24, #26, #28 y #30) y después de cada merge en `master` (CI #17, #19, #21, #23, #25, #27, #29 y #31). Con la v2 del cuestionario (PR #13): CI #28 y #29, y la última, CI #31 (run `38100362367`, `83d9687`, tras el PR #14): 1013/1013 unitarios y E1 30/30. Antes de la v2, CI #25 (run `38003093188`, `83654eb`): 864/864 unitarios y E1 27/27 | GitHub |

**Fase 3 en Supabase real: validación estructural y E2 en verde**, en
`roomly-validation-3`, el 2026-10-09:
- **run 16** (`37994799026`, `f619812`): estructural, con la suite SQL 14 y
  la api-suite CRA1–CRA6 por primera vez en real;
- **run 18** (`37999470912`, `6dae75f`): E2 1/1 con destino `/test`, y la
  parte estructural otra vez en verde;
- **run 17:** falló por configuración del buzón, sin efectos.

Ninguno tuvo reintentos. La limpieza del run 18 avisó de que el registro
público seguía abierto: su cierre manual es del propietario y el workflow no
lo verifica. El propietario declaró el 2026-10-09 que lo cerró; no está
verificado de forma independiente.

Los textos editoriales del PR #11 (`83654eb`) son posteriores a estos runs y
no han pasado por un run real; la CI de `83654eb` está en verde.

La **v2 del cuestionario** (S1–S4) está integrada en `master` con el PR #13
(merge `7550d71`, 2026-10-10).
- **CI de GitHub:** en verde en el head del PR #13, después de su merge y
  después del merge del PR #14 (`83d9687`). Corre contra PostgreSQL local y
  el Supabase simulado (filas de `npm run test`, E1 y CI).
- **Validación real contra Supabase:** la v2 no ha pasado por ningún run
  real. Los runs 16–18 son anteriores, y si hace falta uno nuevo lo decide el
  propietario.

**La Fase 3 sigue abierta** por pendientes ajenos a la validación real (ver
`docs/ROADMAP.md`). En las filas de Supabase real de esta tabla, lo marcado
con los runs 16–18 es de la Fase 3 y el resto, de las Fases 1 y 2.

Las secciones siguientes son el registro histórico de cada sesión; lo que
dicen como "pendiente" puede estar ya superado por esta tabla.

## Fase 3 — versión 2 del cuestionario (S1–S4, 2026-10-10, en local)

- **Versiones** (`tests/unit/questionnaire-versions.test.ts`, nuevo):
  - registro de la 1 a la vigente (2), sin huecos, y cada versión con sus
    preguntas de dirección;
  - un id que está en dos versiones es la misma pregunta: enunciado, ayuda,
    escala, etiquetas, tipo, categoría y pareja;
  - la v2 sustituye exactamente ocho ids, en su posición, por su `_v2`. Los
    nuevos no chocan con ningún id histórico y los sustituidos no vuelven;
  - las cuatro parejas de la v2 son recíprocas y ninguna pregunta apunta a un
    id sustituido;
  - la v1 conserva el enunciado, las etiquetas y la pareja de sus ocho
    preguntas sustituidas, y la v2 tiene los textos de S1–S4.
- **Motor** (`matching-score.test.ts`):
  - los casos de la especificación corren con la v1 y con la v2. En la v2,
    los ids sustituidos se escriben con su `_v2`;
  - cada versión tiene su lista exacta (29 preguntas, pares y unidades);
  - la versión vigente es la 2 y la v1 sigue registrada;
  - v1 frente a v2 da `version_mismatch`, y unas respuestas de la v1 con la
    versión 2 dan `incomplete_answers`;
  - en la v2, las claves de la v1 que guarde una fila no intervienen.
- **Dirección de Ruido** (`matching-score-direction.test.ts`, nuevo):
  - `directionQuestionIds` da `noise_tolerance` en la v1 y
    `noise_tolerance_v2` en la v2;
  - diez cuestionarios rotos dan `null` (sin tolerancia, dos tolerancias,
    pareja no recíproca, sin horas de silencio…);
  - con versiones rotas en el registro simulado, `calculateCompatibility`
    devuelve `invalid_questionnaire` y nunca un resultado `ok`.
  - **Mutación:** volver al id fijo `noise_tolerance` hace fallar 3 tests.
- **Paso de la v1 a la v2** (`services-compatibility-versions.test.ts`, ya sin
  `vi.mock`):
  - un test v1 completado o en borrador es `outdated` y trae solo las 21
    respuestas comunes;
  - con los ocho ids nuevos se completa en la misma escritura (versión 2);
    sin ellos, o con siete, queda como borrador;
  - las respuestas a los ocho ids de la v1 se rechazan;
  - de una fila de una versión posterior no se usan las respuestas ni se
    escribe nada.
- **Rutas y Server Action** (`questionnaire-routes.test.ts`):
  - un test v1 completado no redirige en `/test`, que lo trae como
    `outdated`, y en `/explorar` lleva a `/test`;
  - un formulario antiguo con los ids de la v1 se rechaza sin escribir;
  - solo respuestas comunes → borrador con «Te faltan 8 preguntas».
- **Estado, filtros y candidatos:**
  - con la versión vigente real, el test v1 es `outdated` y no es elegible;
  - el esquema rechaza los ocho ids de la v1;
  - una fila marcada como v2 con respuestas de la v1 no se puntúa.
- **E1** (`compatibility-flow.spec.ts`):
  - las siembras del mock exigen una versión válida y, si falta o no lo es,
    responden 400 sin sembrar nada (`mock-seed-version.spec.ts`):
    - valor: el rango de la columna (`integer`, `CHECK >= 1`), de 1 a
      2147483647;
    - formato: decimal canónico, una convención del mock (PostgreSQL
      convertiría `02`, ` 2 ` o `+2` en 2; el mock los rechaza);
  - un endpoint de test nuevo, `/__test/seed-own-response`, deja el test
    propio en la v1;
  - el escenario del test v1 completado recorre el aviso, las respuestas
    reutilizadas, el borrador y el completado en la v2.
- Sin cambios en `tests/db`, `tests/supabase` ni la api-suite: usan versiones
  literales en la base de datos y no dependen del cuestionario.

## Fase 3 — compatibilidad (2026-10-07, implementación local)

- **Motor** (`tests/unit/matching-score.test.ts`):
  - la lista exacta de las 29 preguntas (id, tipo, escala, categoría y
    pareja) es la de la especificación cerrada;
  - casos de la especificación: tabla de conducta/tolerancia, presupuesto
    0/75/150/151, barrios, renormalización, umbrales, dirección;
  - propiedades con un generador determinista: simetría en 500 pares,
    determinismo con claves reordenadas, 100 consigo mismo si la persona es
    coherente;
  - 7 mutaciones detectadas.
- **Servicios** con clientes simulados:
  - el cliente del usuario solo lee y el admin solo escribe (test) o solo
    hace la lectura cruzada (candidatos);
  - el cambio de versión se prueba con una v2 simulada (`vi.mock`).
- **Base de datos**: `tests/db/14` y la actualización incremental
  (`migration-upgrade-selftest.sh`).
- **E1**: el mock emula `compatibility_responses` (lectura propia; escritura
  solo con la clave service_role ficticia, con S1–S6 y cuentas eliminadas) y
  la consulta embebida de candidatos.
  - El registro de peticiones del mock es común a todos los specs: los specs
    que lo inspeccionan solo miran lo de su propio test.
- **E2**: solo se adaptó el código (onboarding → `/test`); no se ha
  ejecutado.

## Fase 2.8 — infraestructura de validación (2026-09-30)

- **Runner SQL remoto**: una sesión y una transacción por archivo; el
  `begin;`/`rollback;` de `tests/db/11` (y de `12` desde la 2.9) se reescribe en el flujo a
  SAVEPOINT (el archivo no cambia); control de transacción inesperado →
  aborta antes de conectar; WARNING → fallo. Ver
  `docs/SUPABASE_VALIDATION.md`.
- **Preflight P0–P6**: 38 políticas exactas (37 desde H4, Fase 2.9) por (tabla, política, comando),
  12 triggers, 10 funciones propias con su seguridad, GRANT de
  `housing_preferences`; marca `roomly-validation-3`.
- **E1**: `playwright.config.ts` + `tests/e2e/local/` + mock en
  `tests/e2e/support/`. **E2**: `playwright.real.config.ts` +
  `tests/e2e/real/` + job `e2e-real`; sin trace, vídeo, capturas ni report.
- **Playwright**: la versión instalada (1.63) no se toca. CI y desarrollo
  local usan su navegador (`npx playwright install chromium`, 1243). Solo
  en un entorno que no pueda descargarlo (el cloud de Claude Code) se usa
  `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium-1194/chrome-linux/chrome`;
  ese resultado es orientativo y el de referencia es el de CI.
- La build de E1 deja en `.next` una app apuntando al mock: tras
  `npm run test:e2e`, volver a hacer `npm run build` antes de `npm run start`
  contra otro Supabase.
- Hallazgo menor al escribir E1: `@supabase/ssr` no borra la cookie
  `…-code-verifier` tras el canje en `/callback`. No es un riesgo propio (el
  código ya no se puede canjear dos veces y sin el verifier no hay sesión;
  E1 lo prueba), y no se ha cambiado nada.

## Migración `middleware.ts` → `proxy.ts` (2026-09-29)

- `npm run build` con Next.js 16.3.6: `ƒ Proxy (Middleware)`, sin aviso
  de deprecación. `.next/server/functions-config-manifest.json` registra el
  proxy con `runtime: "nodejs"` y el mismo `matcher`; antes se compilaba
  para Edge (`server/edge/…`).
- Validación local (`next start` + Supabase **simulado** en
  `localhost:54321`, nunca `roomly-validation`):
  - `/admin` y `/admin/...` sin sesión → 307 a `/login?next=…`.
  - Sesión con rol no admin → 307 a `/`; con rol admin → 200 y panel.
  - Token caducado → el proxy pide `refresh_token` y responde con
    `Set-Cookie` (también en rutas públicas): el refresco de sesión sigue
    funcionando en Node.js.
  - Callback sin `code` o con `code` inválido → `/login?error=auth_callback_failed`.
  - `tests/supabase/auth-redirects.sh` → 6/6.
- No verificado tras el cambio contra Supabase real (el propietario decidió
  no repetir pruebas que escriben en `roomly-validation`). La lógica es la
  misma que se validó allí como `middleware.ts`.

## Resultados reales — Fase 1, sesión de Foundation (2026-09-25)

Nada de esto es teórico: son comandos ejecutados de verdad en el sandbox.

- **`npm run lint`** → pasa.
- **`npm run typecheck`** → falló primero, con un error real y concreto:
  `types/database.ts` no incluía el campo `Relationships` que exige
  `GenericTable`/`GenericView` de `@supabase/postgrest-js` — sin él, la
  inferencia de tipos de Supabase colapsa a `never` en cualquier
  `.from(tabla).select()`, y el error solo se ve donde de verdad se usa
  (apareció en `app/admin/layout.tsx`, al leer `profile.role`). Corregido
  añadiendo `Relationships: []` a las 18 tablas y a la vista. Confirmado
  leyendo el código fuente instalado en
  `node_modules/@supabase/postgrest-js/src/types/common/common.ts`, no
  adivinado. Reejecutado → pasa.
- **`npm run test`** → pasa, 7/7 (`env.test.ts`, `cn.test.ts`).
- **`npm run build`** → pasa, genera las 6 rutas esperadas. Aviso real
  encontrado (no cosmético del todo): Next.js 16.0.0 deprecó la
  convención `middleware.ts` en favor de `proxy.ts` (**migrado el
  2026-09-29**, ver arriba) — confirmado leyendo
  `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md`,
  incluido en el propio paquete instalado. `middleware.ts` sigue
  funcionando (deprecado, no eliminado), pero la migración a `proxy.ts`
  queda pendiente — ver `docs/ROADMAP.md`, Fase 1.
- **`npx playwright install`** → **no ejecutado todavía en ninguna
  sesión con acceso de red real.** En el sandbox de desarrollo se sabe
  que fallará (el CDN de navegadores de Playwright no está en la lista
  de dominios permitidos), pero eso es una inferencia de la
  configuración de red documentada, no una ejecución confirmada esta
  vez. Quien continúe el proyecto (Claude Code local, con red real) debe
  ejecutarlo de verdad y sustituir esta nota por el resultado real.
- **Tests de integración / RLS contra una base de datos real**: no
  ejecutados en esa sesión. Superado: ver "Validación contra Supabase
  real" más abajo.

## Tests de seguridad/RLS — `tests/db/` (desde 2026-09-26)

Tests de regresión de los hallazgos de la auditoría inicial (C1, C2, C3,
H5, M2 — ver `docs/SECURITY.md`). Corren contra **PostgreSQL real**, sin
Supabase: `tests/db/run.sh` crea una base de datos temporal, aplica
`tests/db/supabase_shim.sql` (roles `anon`/`authenticated`/`service_role`,
`auth.users`, `auth.uid()` leyendo `request.jwt.claims` y los privilegios
por defecto de Supabase), **todas** las migraciones en orden y el seed, y
ejecuta cada `tests/db/NN_*.sql`. Sin dependencias nuevas (ni pgTAP): los
helpers de `tests/db/helpers.sql` lanzan una excepción al fallar una
aserción y el runner sale con exit 1.

```
PGHOST=... PGPORT=... PGUSER=postgres npm run test:db
```

| Archivo | Protege contra |
|---|---|
| `01_profiles_role.sql` | crear o convertir el propio perfil en admin (INSERT, UPDATE, upsert) |
| `02_chat_rls.sql` | fuga de mensajes entre conversaciones, escritura en conversaciones ajenas, recursión RLS (y una guarda estática que detecta la tautología `x.conversation_id = x.conversation_id` en `pg_policies`) |
| `03_rooms_moderation.sql` | reactivar una habitación que un admin marcó `removed` |
| `04_reports_insert.sql` | crear reportes con campos de resolución |
| `05_housing_preferences.sql` (Fase 2.0) | escribir, ver o reasignar preferencias ajenas; upsert; presupuesto y compañeros negativos o con mínimo > máximo (y que valores altos se aceptan: no hay techos); textos; FKs de ciudad/universidad; barrios inexistentes, `NULL`, de otra ciudad o sin ciudad (también en listas largas); array vacío aceptado; borrar/mover/cambiar el id de un barrio en uso (como servidor y como admin); `anon` sin acceso |
| `06_profiles_constraints.sql` (Fase 2.0) | límites de `full_name`/`bio`/`avatar_url`, `chk_min_age`, y `role`/`deleted_at` siguen protegidos |
| `07_onboarding_integrity.sql` (Fase 2.3 y punto A de la 2.9) | perfil sin `seeking_status` (ya no hay default); `flexible` explícito aceptado; marcar `onboarding_completed_at` sin preferencias, sin ciudad o en el INSERT; completar el de otro; ejecutar la función del trigger directamente; el servidor tampoco se lo salta. Desde la 2.9 (OB5b, OB11–OB14): que, ya completado, alguien pueda volver a `NULL` o cambiar la fecha (posterior, anterior, un microsegundo, junto con otro campo) siendo el propio usuario, un admin, `service_role` (también tras borrar las preferencias) o el dueño de las tablas; que se rechace reescribir la misma fecha o editar otros campos; que la fecha original no se conserve; que la función deje de ser `SECURITY INVOKER`, pierda el `search_path` vacío o recupere `EXECUTE` para `anon`/`authenticated` |
| `12_settings_notifications.sql` (Fase 2.6) | que una cuenta activa deje de poder activar o desactivar su aviso por email, o que el cambio no persista (se relee el valor); que pueda cambiar el de otra **en las dos direcciones** (A→B y B→A, también junto con otro campo), comprobando antes que la fila ajena es **visible** —desde la 2.9 (H4) gracias a una política SELECT temporal dentro de un bloque `begin;`/`rollback;`, como en `11`—, así que el 0 solo lo explica la condición de dueño de `profiles_update_own`; que la fila atacada quede intacta; que el aviso quede nulo; que cambiarlo complete el onboarding; que tras los bloques quede la política temporal o B vea la fila de A con la lectura normal (ST12) |
| `13_profiles_privacy.sql` (Fase 2.9, H4) | que un usuario autenticado lea el perfil de otro (por id, por `date_of_birth` u otras columnas); que pierda la lectura de su propio perfil, también eliminado; que un admin activo deje de leer todos, incluida la fecha de nacimiento, o que uno eliminado los lea; que anon lea alguno; que `public_profile_previews` deje de devolver el nombre de otros, muestre cuentas eliminadas o exponga `date_of_birth` (columnas exactas); que `profiles` no tenga exactamente sus 4 políticas o haya otra que dé lectura; que no sean 37 políticas |
| `11_housing_preferences_ownership.sql` | UPDATE o DELETE de la fila de otro usuario **con esa fila visible**: dentro de una transacción con `ROLLBACK` se añade una política de SELECT temporal abierta, así que el resultado ya no lo explica la lectura, solo la condición de dueño de `housing_preferences_update_own`/`_delete_own`; control positivo (el dueño sí puede en la misma situación) y comprobación final de que la política temporal no queda |
| `10_preferences_integrity.sql` (Fase 2.5) | con el onboarding completado: quitar la ciudad (cliente y servidor), crear preferencias sin ciudad, borrarlas desde el cliente; que antes del onboarding todo siga siendo opcional y borrable; que el servidor pierda el borrado o la cascada del perfil; universidad de otra ciudad (y al cambiar solo la ciudad), universidad sin ciudad aceptada, FK intacta; barrio de otra ciudad; estructura de triggers, funciones y política |
| `09_own_profile_update.sql` (Fase 2.4) | que una cuenta activa deje de poder escribir alguno de los campos de `/perfil`; que `id`, `created_at` o `updated_at` pasen a ser actualizables; editar un perfil ajeno; vaciar `seeking_status` o `email_notifications_enabled`; `bio` de más de 500 |
| `08_deleted_account_writes.sql` (decisión B) | una cuenta eliminada que actualiza su perfil o crea, actualiza o borra sus preferencias por PostgREST (con el mismo JWT de antes de eliminarse); que la lectura propia o ajena cambie; que el admin o `service_role` pierdan sus escrituras; que vuelva una política `FOR ALL` en `housing_preferences` |

`expect_error` exige un SQLSTATE concreto: un "fallo por el motivo
equivocado" (p. ej. recursión infinita en vez de rechazo por RLS) hace
fallar el test en vez de pasar por accidente.

**Fase 2.7 (2026-09-30, cerrada)**: sin tests DB nuevos (no
cambia nada de base de datos; `test:db` sigue 218/218). `tests/unit/shell.test.tsx`
(17): `Nav` raíz estático y sin imports de sesión/Supabase, contenido de `/`
y «Entrar», enlaces exactos del shell, `aria-current`, logout con el
`SignOutButton`, layout sin consultas, ausencia de `loading.tsx`, y
`error.tsx`/`global-error.tsx` con un error de texto técnico deliberado
(render y código fuente). Mutaciones (6, todas detectadas): `error.message`
en `error.tsx`, digest en `global-error.tsx`, stack en un atributo, «Entrar»
en el `Nav` raíz, import de Supabase en el `Nav` raíz y un enlace a
`/matches` en el shell.

**L1 (`app/(app)/loading.tsx` + guard en el layout), probado y revertido**:
los redirects seguían siendo 307 (comprobado con `curl`), pero el contenido
de `/perfil`, `/preferencias` y `/ajustes` llegaba por streaming dentro de
un `<div hidden>` que solo muestra JavaScript: sin JavaScript solo se veía
«Cargando…». Por eso no hay `loading.tsx` en `(app)`.

Los scripts de Chromium de 2.4–2.6 se adaptaron al shell sin rebajar
ninguna comprobación: el botón «Cerrar sesión» de cada página se busca
dentro de `<main>` (ahora también hay uno en el nav) y los campos inyectados
van al formulario de la página (`main form`), no al primer `<form>`.

**Resultado real (2026-09-30, Fase 2.6)**: 218/218 aserciones (204 + 14 de
`12`; 8 en `4c40595` y 6 más en la verificación posterior: persistencia
releída y dirección B→A). Mutación en una copia local: `profiles_update_own`
sin la condición de dueño → fallan `ST6` (`12`), `OP5` (`09`) y `07`; en otra
copia sin `ST6`, falla `ST10` (B→A) mientras `ST9` confirma que la fila es
visible. Mutación de código: sin `.eq("id", userId)` en el UPDATE de
`updateProfile` → fallan 5 tests (2 de `/ajustes`). Mutaciones de código (3,
todas detectadas por `npm test`): esquema de ajustes no estricto; la acción
llamando a `updateProfile` (aceptaría `full_name`/`bio` desde `/ajustes`);
sin guard en la acción (lo detecta "eliminada entre el guard y la
escritura").

**Resultado real (2026-09-30, ownership aislado)**: 204/204 aserciones
(192 + 12 de `11`). Por qué hacía falta: `HP5b`/`HP5c` (`05`) pasan aunque
la política de UPDATE/DELETE no compruebe el dueño, porque la de SELECT ya
oculta la fila ajena. Mutaciones en copias locales (con una migración
extra), todas detectadas por `11` mientras `HP5b`/`HP5c` siguen en verde:
- UPDATE sin la condición de dueño (en `USING` y `WITH CHECK`) → `OWN1`
  (1 fila afectada en vez de 0);
- UPDATE sin la condición solo en `USING` → el `WITH CHECK` sigue
  exigiendo el dueño y la escritura se rechaza con `42501`; `OWN1` falla
  porque cambia el comportamiento (error en vez de 0 filas), no porque se
  cuele una escritura;
- DELETE sin la condición de dueño → `OWN3` (1 fila borrada en vez de 0).

**Resultado real (2026-09-30, Fase 2.5)**: 192/192 aserciones (168 + 24 de
`10`). Mutación en copias locales (5, todas detectadas): sin el trigger de
ciudad → `PC1`; política de DELETE sin la condición de onboarding → `PC3`;
sin el trigger de universidad → `PU1`; trigger de ciudad solo en UPDATE →
`PC5`; trigger de universidad sin dejar paso a la FK de ciudad → `HP9` (de
2.0). Mutaciones de código (9, todas detectadas por `npm run test`): sin la
regla de ciudad tras el onboarding, sin la de ciudad activa, sin la de
universidad en el servicio, onboarding siempre "sin completar", acción sin
INSERT cuando no existen, ciudad siempre obligatoria en la página, esquema
de edición no estricto, sin guard en la acción (lo detecta "eliminada entre
el guard y la escritura") y cuenta eliminada no bloqueada en el servicio.
Refuerzo posterior (sesión 16), todas detectadas: sin filtro por usuario en
la lectura (`getHousingPreferences`) y en el UPDATE; `profile_id` aceptado
en el esquema de entrada; y, en copias de la base de datos, sin el trigger de
barrios (`HP11`, `PN1`), con la política de SELECT abierta (`HP5a`) y con la
de UPDATE abierta (la detecta `08`; `HP5b` sigue protegido porque el UPDATE
también aplica la política de SELECT a las filas que lee).

**Resultado real (2026-09-30, Fase 2.4)**: 168/168 aserciones (158 + 10 de
`09`). Mutación en una copia local: con una migración extra que concede
UPDATE sobre `id`, `created_at` y `updated_at` falla `OP3`. `OP2` (`id`)
sigue pasando en esa mutación porque el `WITH CHECK` de
`profiles_update_own` (`auth.uid() = id`) también lo rechaza con `42501`:
son dos barreras independientes.

Mutaciones de código de Fase 2.4 (8, todas detectadas por `npm run test`):
sin guard en la Server Action; sin la comprobación de `deleted_at` en
`updateProfile`; `profileUpdateSchema` no estricto; el guard dejando pasar
cuentas eliminadas; casilla sin marcar tratada como marcada; vacío omitido
en vez de `null` (la descripción no se borraría); un campo `role` en el
formulario; el UPDATE sin filtrar por el usuario de la sesión. La del guard
de la acción solo la detecta el caso "cuenta eliminada entre el guard y la
escritura": el resto lo sigue parando el servicio (defensa en profundidad).

**Resultado real (2026-09-30, cuentas eliminadas)**: 158/158 aserciones
(136 + 22 de `08`). Mutación en copias locales (6, todas detectadas): sin
`deleted_at is null` en `profiles_update_own` falla `DD1`; sin la
comprobación de perfil activo en la política de INSERT falla `DE1`, en la
de UPDATE `DD2` y en la de DELETE `DD3`; sin la migración falla `DD1`; y si
la lectura de preferencias también exigiera cuenta activa falla `DD4`.

**Resultado real (2026-09-30, Fase 2.3)**: 136/136 aserciones (119 + 17 de
`07`). Mutación en copias locales: con el default de `seeking_status` de
vuelta falla `OB0`; sin el trigger de completitud, o deshabilitado, falla
`OB3`.

**Resultado real (2026-09-29, Fase 2.0)**: 119/119 aserciones (58 + 50 de
`05` + 11 de `06`) en PostgreSQL 16 local. Mutación en copias locales:
- sin la migración de Fase 2.0 fallan `05` y `06`;
- sin el trigger de `housing_preferences` falla `HP11`;
- sin el trigger de `neighborhoods` falla `HP-inv1`;
- con la función inversa como `SECURITY INVOKER` falla `HP-inv4`.

**Resultado real (2026-09-26)**: 58/58 aserciones en verde en PostgreSQL
16.13, por socket local y por TCP (como el servicio `postgres:16` de CI).
**Validación de que los tests saben fallar** (pruebas de mutación en una
copia fuera del repo): sin la migración de correcciones fallan los 4
archivos, y reintroducir por separado cada vulnerabilidad (INSERT de role,
tautología en `messages`, política recursiva, INSERT de mensajes sin
comprobar participante, borrar el trigger de `rooms`, INSERT de reportes
sin restringir) pone rojo su test correspondiente.

**Limitación**: el shim no es Supabase. Por eso la misma suite se ejecutó
también en `roomly-validation` con roles reales (58/58, `01`–`04`, Fase 1).
La suite `01`–`13` pasó en Supabase real, en `roomly-validation-2b`, en los
runs 13 y 15 (Fase 2.8), y la `01`–`14` (305/305), en `roomly-validation-3`,
en el run 16 (Fase 3).

## Validación contra Supabase real (checkpoint previo a Fase 1, histórico)

Desde la Fase 2.8 la validación real usa un proyecto nuevo,
`roomly-validation-2b` (marca `roomly-validation-2`, P0–P6, suite 01–13 y
E2), completada en los runs 13 y 15. Lo que sigue es el checkpoint de Fase 1.

**Ejecutada** (2026-09-28, run `36493446123`): guarda F1 y P0–P5 ✅, suite
SQL 58/58, supabase-js 46/46, AU3/AU5 6/6. AU4/AU5 con sesión, manual,
2026-09-29 ✅. Teardown verificado (0 usuarios / 0 filas).

Lo que el shim no puede demostrar (roles y `auth.uid()` reales, dueño de
tablas, privilegios por defecto de Supabase, PostgREST/supabase-js, Auth)
se valida contra un proyecto desechable `roomly-validation` con el
workflow manual `.github/workflows/supabase-validation.yml`: P1–P5
(`tests/supabase/preflight.sql`), la misma suite `tests/db` con roles reales
y `ROLLBACK`, `npm run test:supabase` (supabase-js con JWT reales) y
`tests/supabase/auth-redirects.sh`. Nunca corre en push ni en PR. Detalle,
matriz y secrets: `docs/SUPABASE_VALIDATION.md`.

## Resultados reales — auditoría inicial en Claude Code (2026-09-26)

- `npm ci` → ok (418 paquetes). `format:check` → **fallaba** en
  `types/database.ts` (el CI habría salido rojo en su primer run);
  corregido con Prettier (solo formato), ahora pasa.
- `lint`, `typecheck` → pasan. `test` → 39/39 (7 anteriores + 32 de
  `tests/unit/safe-redirect.test.ts`, el validador del parámetro `next`
  del callback; con la lógica anterior fallan 24 de esos 32).
- `build` → pasa también con `NEXT_PUBLIC_SUPABASE_*` vacías (como en CI
  sin secrets). Seguía el aviso de `middleware` → `proxy` (resuelto el
  2026-09-29).
- `test:db` → 58/58 (ver arriba).
- `test:e2e` → **con la configuración del repo falla en el entorno de
  Claude Code en la nube**: Playwright 1.63 busca `chromium-1243` y ese
  entorno trae preinstalado `chromium-1194` (no se permite `playwright
  install`). No es un fallo del proyecto y no se ha cambiado la config
  para ocultarlo. Con una config temporal fuera del repo que apunta al
  Chromium preinstalado, el smoke test pasa 2/2. Necesita
  `NEXT_PUBLIC_SUPABASE_URL`/`ANON_KEY` definidas (aunque sean ficticias):
  el proxy (entonces `middleware.ts`) las valida en cada petición.

## Limitación conocida de los entornos

Ni el sandbox original ni el entorno cloud de Claude Code pueden
descargar navegadores de Playwright (`playwright install`); el entorno
cloud trae `chromium-1194` y Playwright 1.63 espera `chromium-1243`. Desde
la Fase 2.8, E1 se ejecuta en ese entorno con
`PLAYWRIGHT_CHROMIUM_EXECUTABLE` (resultado orientativo) y en CI con el
navegador que corresponde (resultado de referencia). El entorno de Claude
tampoco alcanza Supabase: la validación real y el E2 real se ejecutan desde
el workflow manual.

RLS ya no depende solo del shim: se validó en `roomly-validation` con
roles, `auth.uid()` y PostgREST reales (ver arriba).

## Los 3 flujos E2E obligatorios

1. **Estudiante**: registro → onboarding → test → ver matches → contactar.
2. **Room provider**: registro → publicar habitación → recibir interés →
   match → conversar.
3. **Admin**: login → revisar un reporte → bloquear un usuario → verificar
   que queda registrado en `admin_action_logs`.

## Qué se testea explícitamente por RLS (no solo por lógica de negocio)

- Un usuario no puede leer `room_addresses.address_exact` de una
  habitación que no es suya.
- Un usuario no puede leer una conversación de la que no es participante,
  aunque conozca el UUID.
- Un usuario reportado no puede ver quién lo reportó.
- Un INSERT directo a `matches` desde un cliente autenticado (sin pasar
  por el servicio) falla.
- `/admin` es inaccesible para un rol `user`, verificado dos veces:
  a nivel de RLS y a nivel de comprobación de servidor.

## Filosofía de cobertura

Sin objetivo de porcentaje fijo. Prioridad a rutas críticas (auth,
matching, permisos, más adelante pagos) sobre cobertura vanidosa. El
motor de matching es la excepción: ahí sí se busca cobertura casi total,
porque es el diferencial del producto y es 100% determinista, así que no
hay excusa para no testearlo a fondo.

## Datos de test

Fixtures explícitos, nunca datos inventados fuera de tests/fixtures. Si
un test falla, se investiga la causa real — nunca se borra o se
deshabilita para que pase (regla explícita del brief, sección 39).

## CI

GitHub Actions (`.github/workflows/ci.yml`), en cada PR y en cada push
a `master` (antes el trigger de push apuntaba a `main`, rama que no
existe en este repositorio):
- `lint-typecheck-test-build`: `npm ci`, `format:check`, `lint`,
  `typecheck`, `test`, `build`.
- `db-security`: `tests/db/run.sh` contra un servicio `postgres:16` y,
  desde 2.8, los auto-tests `guard-selftest.sh`, `sql-suite-selftest.sh` y
  `preflight-selftest.sh`.
- `e2e-local` (desde 2.8): `npx playwright install --with-deps chromium` y
  `npm run test:e2e` (E1, sin secrets); sube el report solo si falla.

El workflow se ha ejecutado en GitHub Actions de verdad: 6 runs, todos en
verde (PR y push a `master` de los PRs #1, #2 y #3), antes de la Fase 2; los
jobs de 2.8 aún no han corrido en GitHub. La validación contra Supabase real
tiene su propio workflow manual (`supabase-validation.yml`, Environment
`roomly-validation-3`, con el job `e2e-real`), que nunca corre en push ni en
PR.
