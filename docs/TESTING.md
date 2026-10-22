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

## Estado actual (2026-10-11, Fase 3 integrada en `master` con la v2 del cuestionario; validada en Supabase real antes de la v2 y, en el run 19, los servicios SVC/GC; cerrada el 2026-10-13)

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
- **api-suite** (`npm run test:supabase`, `tests/integration/`): supabase-js
  con JWT reales contra el proyecto real de validación, solo desde el
  workflow manual (job `api-suite`).
  - SVC1–SVC5 y GC1–GC4 llaman además a los dos servicios del servidor,
    `saveQuestionnaireAnswers` y `getCandidates`, con el JWT real del
    usuario y service_role inyectado en el runner, nunca en la app (D6 = B).
    **En verde por primera vez en el run 19** (2026-10-11,
    `roomly-validation-3`): SVC 6/6 y GC 4/4, dentro de una api-suite 62/62.
    Valida esos servicios, no el runtime completo de Next.js.
  - La CI no ejecuta esta suite: solo la compila (`typecheck`) y la analiza
    (`lint`). Un CI en verde no dice nada de su resultado.
- Chromium con scripts del scratchpad (2.3–2.7): `next start` contra un
  Supabase simulado con estado; no están en el repositorio. E1 los sustituye
  como suite reproducible.
- Supabase real: el checkpoint de Fase 1 en `roomly-validation` (histórico),
  la validación de la Fase 2 en `roomly-validation-2b`, con la parte
  estructural en el run 13 y el E2 en el run 15, y la validación de la Fase 3
  en `roomly-validation-3`: estructural en el run 16 y E2 en el run 18
  (2026-10-09; ver `docs/SUPABASE_VALIDATION.md`). La Fase 4, en el mismo
  proyecto: el `dry_run` de R8 en el run 20 (2026-10-18, sin efectos) y el
  `apply` en el run 21 (2026-10-21), seguido del preflight, la suite SQL, la
  api-suite y AU3/AU5. El E2 no se ha ejecutado con la Fase 4.


| Comprobación | Resultado | Dónde |
|---|---|---|
| `format:check`, `lint`, `typecheck`, `build` | ✅ | local y CI |
| `npm run test` | ✅ 1069/1069 en local con la tercera ronda de correcciones de R8 (M1 y L1; 1 nuevo en `validation-infra`: la comprobación de líneas `ERROR:` de `run_pass` va entre el código de salida y la línea final, y su rama devuelve 1, incierto, nunca 2). Antes: ✅ 1068/1068 en local con la segunda ronda de correcciones de R8 (B1–B5; 4 nuevos en `validation-infra`: el flujo construido antes de conectar desde copias verificadas y leído de un archivo, la última línea del flujo como condición del COMMIT y de «NO VÁLIDO», las señales con su etapa, y las secciones «Recuperación» y «Cambiar el SHA-256 del preflight vigente» que cita el script; dos existentes adaptadas a la nueva estructura, con aserciones equivalentes o más estrictas: sin ningún `cat "$ROOT/…"` y el orden cabecera, cuerpo y final). Antes: ✅ 1064/1064 en local con las correcciones de la revisión de R8 (4 nuevos en `validation-infra`: el preflight vigente fijado con su SHA-256 real y comprobado antes de conectar; `client_min_messages = notice`, los dos `R8-MSG`, los avisos de éxito obligatorios y ningún archivo del flujo que cambie `client_min_messages`; los mensajes de la pasada con `COMMIT` sin «nada aplicado»; `timeout-minutes: 20` en el job `phase4-upgrade`). Antes: ✅ 1060/1060 en local con la herramienta de R8 (8 nuevos en `validation-infra`: las tres migraciones fijadas y su SHA-256 real, el preflight congelado del run 19 y los archivos de estado de partida, ROLLBACK y confirmación de `apply`, sin CLI de Supabase ni Netlify o Vercel, la entrada `phase4_upgrade`, la guarda y los secrets del job, `dry_run` sin suites ni `migrate` ni E2, y el selftest en `test:infra` y en la CI; ver «R8: herramienta» abajo). Antes: ✅ 1052/1052 en local con la carga de barrios de R1 (5 nuevos en `validation-infra`: la lista de la migración, Barcelona igual que en el seed, la carga idempotente y sin borrados, la lista de `tests/db/18` y la huella de P1, `tests/db/18` y el selftest; ver «Fase 4.1 — R1» abajo). Antes: ✅ 1047/1047 en local con la 4.1 (15 nuevos: 10 de `validation-rooms`, el catálogo de características, sus esquemas Zod y la ocupación, y 5 de `validation-infra`, la coherencia de catálogo, GRANT y restricciones de `rooms` entre código, migración, preflight y `tests/db/16`). Antes: ✅ 1032/1032 en local con la 4.0 (2 nuevos en `validation-infra`: las políticas por comando de habitaciones y la comprobación de cuenta activa de P3). Antes: ✅ 1030/1030 en local con la configuración privada en `lib/env.server.ts` y D1 (5 nuevos sobre los 1025 de `master`; ver «D1» abajo; CI, en el PR). Antes: ✅ 1013/1013 con la v2 del cuestionario (S1–S4, integrada con el PR #13), 149 nuevos: motor 86 → 172 (los casos de la especificación con la v1 y con la v2, la lista exacta de cada versión, y v1 frente a v2 en el motor: `version_mismatch`, respuestas de la v1 sin puntuar en la v2), versiones del cuestionario 22 (`questionnaire-versions`, nuevo), dirección de Ruido por versión y cuestionarios rotos 19 (`matching-score-direction`, nuevo), cambio de versión 5 → 16 (paso real v1 → v2, sin `vi.mock`), estado del test y Zod 22 → 26, guards y Server Action 25 → 29, candidatos 25 → 27, filtros 33 → 34. Antes: ✅ 864/864 (2 de aislamiento de la marca `roomly-validation-3` en `validation-infra.test.ts`, PR #8; antes 862, Fase 3, 245 nuevos: motor 86 (`matching-score`: cuestionario exacto, pesos, similitud, conducta/tolerancia con `min`, presupuesto 0/75/150/151, barrios, renormalización, r6, umbrales, dirección, 500 pares de simetría, determinismo, entradas inválidas sin excepción, textos sin cifras), filtros 33, estado del test y Zod 22, servicio del test 36 + 5 de cambio de versión, servicio de candidatos 25 (consulta única, filtros SQL, defensa en profundidad, orden, paginación, lista blanca del DTO), guards y Server Action 25, test estático de service_role 6, proxy +3, infraestructura +2, shell +2; antes 617: 20 del adaptador de Mailtrap del E2 real, Fase 2.8; 65 de infraestructura de validación, Fase 2.8: identidad `roomly-validation-2`, preflight derivado de las migraciones, separación E1/E2, secrets por paso del workflow, lógica del E2 real y aviso de registro abierto aunque falle el buzón; 17 de shell y errores, Fase 2.7; 46 de ajustes, Fase 2.6: esquema y servicio de avisos, Server Action, página y logout; 39 de Fase 1 + 113 de Fase 2.1 + 131 de routing de Auth, Fase 2.2 + 64 de onboarding, Fase 2.3 + 69 de perfil propio, Fase 2.4 + 53 de preferencias, Fase 2.5: reglas del servicio, Server Action (también referencias inexistentes o incompatibles), página, formulario, datos de referencia y proxy) | local (1013/1013 con la v2 antes de su commit, 2026-10-10; 864/864 sobre `83654eb`, 2026-10-09); en CI (`lint-typecheck-test-build`), 1013/1013 con la v2: en el head del PR #13 (run `38088753365`), después de su merge (run `38089079771`, `7550d71`) y después del merge del PR #14 (run `38100362367`, `83d9687`). Antes de la v2, 864/864 sobre `83654eb` (run `38003093188`, después del merge del PR #11) y, en el PR #6, CI #11 (`f9f08ad`, 597) y CI #12 (`ec7c3fc`, 617) |
| `tests/supabase/auth-redirects.sh` | ✅ 16/16 (AU3a–g, AU5a–i) | local contra `next start` con Supabase simulado (Fases 2.2 y 2.3); en `roomly-validation` se ejecutaron las 6 anteriores |
| Flujo de onboarding en Chromium | ✅ con y sin JavaScript | local con `next start` y Supabase simulado con estado (Fase 2.3); no es la suite E2E |
| Flujo de `/perfil` en Chromium | ✅ 24/24 (12 con y 12 sin JavaScript, incluido el logout) | local con `next start` y Supabase simulado con estado (Fase 2.4); no es la suite E2E |
| Shell de Fase 2.7 en Chromium | ✅ 35/35 (20 con JavaScript y 15 sin él; sin JavaScript no aplican `aria-current` ni «Reintentar»): `/` con su contenido y «Entrar», sin sesión/sin perfil/eliminada en las tres rutas, nav con los tres enlaces y navegación entre ellas, perfil incompleto, error de servidor sin texto técnico, logout desde el nav; y regresión con el shell: `/perfil` 24/24, `/preferencias` 43/43, `/ajustes` 24/24, onboarding 2/2 | local con `next start` y Supabase simulado; scripts en el scratchpad de la sesión (no en el repositorio) |
| Flujo de `/ajustes` en Chromium | ✅ 24/24 (12 con y 12 sin JavaScript: sin sesión, sin perfil, eliminada, estado actual, desactivar/activar y recargar, mismo valor en `/perfil`, `full_name` inyectado, `?profile_id=` en la URL, eliminada con la página abierta, logout) + `/perfil` otra vez 24/24 | local con `next start` y Supabase simulado con estado (Fase 2.6); no es la suite E2E |
| Flujo de `/preferencias` en Chromium | ✅ 43/43 (22 con y 21 sin JavaScript; el filtro dinámico solo aplica con JavaScript; incluye crear preferencias con el onboarding ya completado) + regresión del onboarding 2/2 | local con `next start` y Supabase simulado con estado que emula los triggers (Fase 2.5); no es la suite E2E |
| `npm run test:db` (PostgreSQL local con shim) | ✅ 651/651 con la carga de barrios de R1 (`18_neighborhoods_catalog`, 22 aserciones; ver «Fase 4.1 — R1» abajo). Antes: ✅ 629/629 con la decisión R7 (opción A) sobre `status` (`17_rooms_status_transitions`, 160 aserciones; ver «Fase 4.1 — R7» abajo). Antes: ✅ 469/469 con la 4.1 (`16_rooms_publication`, 88 aserciones; `03` pasa de 13 a 14 y `15` de 73 a 75, porque crean borradores completos y los publican con un UPDATE; ver «Fase 4.1» abajo). Antes: ✅ 378/378 con la 4.0 (`15_rooms_integrity`, 73 aserciones, 71 hasta las correcciones de la auditoría del PR #25; PX4, PV10 y CR9 pasan de 37 a 44 políticas; ver «Fase 4.0» abajo). Antes: ✅ 305/305, también con la v2 del cuestionario (2026-10-10, sin cambios en la base de datos) (Fase 3.1: `14_compatibility_responses`, 40 aserciones CR1–CR20; antes 265, incluye `05`/`06` de Fase 2.0, `07` de Fase 2.3 y del punto A de la 2.9, `08` de cuentas eliminadas, `09` de Fase 2.4, `10` de Fase 2.5, `11` de ownership aislado, `12` de Fase 2.6 y `13` de H4, Fase 2.9) | local; en CI (`db-security`, paso `tests/db/run.sh`) en verde sobre `83654eb` (run `38003093188`) y en los PR #7–#11; antes, sobre `f9f08ad` (PR #6, run `37231766834`) |
| `npm run test:e2e` (E1, Playwright) | ✅ 32/32 en local con D1 (`no-service-key-in-client`, 2 tests; ver «D1» abajo; CI, en el PR). Antes: ✅ 30/30 con la v2 del cuestionario (S1–S4, integrada con el PR #13), en local y en CI: candidatos sembrados con la versión vigente, una candidata solo con el test v1 que no aparece, un escenario nuevo (test v1 completado → aviso en `/test`, las 21 respuestas comunes marcadas y las 8 nuevas sin responder, borrador de la v2 con una pendiente y completado en la v2) y la regresión de la versión de las siembras del mock (`mock-seed-version`, 2 tests: 13 versiones no válidas → 400 sin sembrar ni cambiar nada; 1, 2 y 2147483647 se siembran). Antes: ✅ 27/27 en local (Fase 3: `compatibility-flow`: onboarding → `/test`, guardar a medias y retomar, `/explorar` → `/test` sin test, completar → `/explorar` con candidatos solo del DTO (sin admin, eliminada ni presupuesto lejano, sin fecha de nacimiento ni presupuesto exacto), paginación, editar sin cambiar la fecha, service_role solo para candidatos y escritura del test; y el test sin JavaScript; los demás specs, con el destino `/test`). Antes: ✅ 25/25 (también tras H4 de la 2.9, con el mock devolviendo solo la fila propia de `profiles`): rutas protegidas sin sesión (con y sin JavaScript, y 307 sin contenido), alta de estudiante por magic link → `/callback` PKCE → onboarding → `/perfil` → `/preferencias` → `/ajustes` → logout (sesión anterior inservible), enlace en otro navegador o reutilizado, `/callback` con código inventado o error, `next` tras el login, cuenta eliminada (rutas, formulario abierto, nuevo login), `profile_id`/`id` ajenos en URL y formularios, formularios sin JavaScript, smoke | local con el Chromium preinstalado **1194** vía `PLAYWRIGHT_CHROMIUM_EXECUTABLE` (Playwright 1.63 espera 1243: combinación no soportada oficialmente); en CI (`e2e-local`), con el Chromium que instala el workflow, 30/30 con la v2: en el head del PR #13 (run `38088753365`), después de su merge (run `38089079771`) y después del merge del PR #14 (run `38100362367`). Antes de la v2, 27/27 sobre `83654eb` (run `38003093188`) y 25/25 sobre `f9f08ad` con el Chromium oficial v1243 (PR #6, run `37231766834`) |
| Mutaciones de la app contra E1 | ✅ 4/4 detectadas (cuenta eliminada → home, ajustes sin esquema estricto, logout sin `signOut`, `/preferencias` sin ciudad obligatoria) | local, restauradas por hash |
| `tests/supabase/guard-selftest.sh` | ✅ 28/28 (marca `roomly-validation-3`; las anteriores y variantes no pasan; aislamiento: con la marca `roomly-validation-2` la guarda, migraciones, P0 y suite SQL abortan) | local; en CI (`db-security`) desde 2.8 |
| `tests/supabase/sql-suite-selftest.sh` | ✅ 89/89 desde la tercera revisión de R8 (antes 78/78). D3, nuevo: 9 entradas con meta-comandos a mitad de línea (`\connect`, `\set ON_ERROR_STOP 0`, `\!`, `\gset`, y tras una cadena, un identificador o un cuerpo `$$`) o con `$$` pegado a un nombre (ocultaría un `COMMIT` o un meta-comando), rechazadas antes de conectar; `\'` dentro de una cadena, rechazado por su motivo propio; y un control: las barras invertidas de comentarios, cadenas, identificadores y cuerpos `$$` se aceptan, se ejecutan y ninguna como meta-comando. Contra el validador de `3e4cdee`, D3 falla en 10. Antes: `run-sql-suite.sh` real 01–18 con las mismas aserciones que `run.sh` (651 desde R1; 629 desde la decisión R7; 469 desde la 4.1; 378 desde la 4.0; 305 desde la Fase 3.1; 265 tras H4 de la 2.9; 240 tras el punto A; eran 218), una sesión aislada por archivo (18; el número se cuenta), 44 políticas al terminar (37 hasta la 4.0), sin restos, rollback de bloque, sin fugas de rol/GUC, 31 formas de control de transacción rechazadas antes de conectar, 16 identificadores `"..."`/cadenas `E'...'` que intentan ocultar un control (incluido el caso de la auditoría final) rechazados y los legítimos aceptados, WARNING → fallo, fallo a mitad sin restos, 11 sin reescribir falla, marcas anteriores (`roomly-validation` y `roomly-validation-2`) rechazadas | local; en CI (`db-security`) desde 2.8 |
| Mutaciones del runner | ✅ 4/4 detectadas (sin reescritura a SAVEPOINT, WARNING no falla, COMMIT permitido, COMMIT en vez de ROLLBACK) + validador tras la auditoría final: 2/2 con efecto detectadas (sin estado de identificador `"..."`, sin rechazo de `E'...'`); 2 sin efecto observable (quitar la `""` escapada es equivalente; quitar el error de identificador sin cerrar lo cubre «sentencia final sin `;`») | local, restaurado por hash |
| Mutaciones de la limpieza del E2 | ✅ 2/2 detectadas (aviso de registro abierto sin captura del fallo del buzón; error de los ajustes que tapa el original) | local, restaurado por hash |
| Mutaciones del punto A de la 2.9 contra `test:db` | ✅ 3/3 detectadas (sin la migración, bloqueo solo del paso a `NULL`, función `SECURITY DEFINER`) | local, migración restaurada y comprobada con `cmp` |
| Mutaciones de H4 (2.9) contra `test:db` | ✅ 5/5 detectadas: sin la migración; `profiles_select_authenticated` recreada; otra política SELECT `using (true)`; la política propia, con su nombre, pero `using (auth.uid() is not null)`; `public_profile_previews` con `date_of_birth` | local, con migraciones temporales borradas y la de H4 comprobada por hash |
| `tests/supabase/preflight-selftest.sh` | ✅ 69/69 desde R1 (65/65 con la 4.1, antes 50/50): P0–P6 pasan con el esquema actual y 61 mutaciones (4 de R1, en P1: falta un barrio oficial, uno renombrado, su slug cambiado y un barrio de más en Barcelona; 15 de la 4.1: en P1, faltan restricciones de `rooms`, una sin validar, la FK barrio ↔ ciudad sobre otras columnas y el catálogo con una clave de más; en P4, `status` en el INSERT, `deleted_at`, `approx_lat` u `owner_id` en el UPDATE, UPDATE de tabla completa, sin UPDATE de `status`, `anon` con INSERT o sin SELECT y `service_role` sin UPDATE; 6 de habitaciones, Fase 4.0: vuelve `rooms_owner_write`, falta `room_addresses_select_own` y cuatro escrituras sin la comprobación de cuenta activa; 8 de `compatibility_responses`, Fase 3.1; la marca `roomly-validation-2` en P0, Fase 3) fallan cada una en su check | local; en CI (`db-security`) desde 2.8 |
| `tests/supabase/migration-upgrade-selftest.sh` (Fase 3.1; 4.0; 4.1; R1) | ✅ 26 líneas `ok` desde R1: 15 aserciones (UP1–UP10), los datos de partida, las 4 migraciones nuevas aplicadas, el rechazo de la 4.1, el de R1, la carga repetida y 3 de la instalación limpia. **R1:** el barrio oficial de los datos anteriores conserva su id y Barcelona queda con exactamente los 73 (UP10); con un barrio inventado, un slug oficial con otro nombre y un nombre oficial con otro slug, la carga se detiene en `neighborhoods_r1_precheck` sin dejar nada; aplicarla otra vez no cambia ningún barrio; en otra base de datos, las migraciones solas crean Barcelona y sus 73 barrios, el seed después no duplica nada, y la carga repetida tampoco. Antes, con la 4.1, 13 aserciones (UP1–UP9) y el rechazo de la 4.1 (antes 10/10): con una habitación activa sin barrio y otra con características fuera del catálogo, la 4.1 se detiene en `rooms_4_1_precheck` sin dejar nada; con datos válidos, conserva la habitación activa completa y el borrador incompleto (UP8) e impone sus reglas a la habitación anterior (UP9). Antes: migraciones de la Fase 2 con datos y después las nuevas; filas conservadas y sujetas a S4/S5 y al bloqueo de cuentas eliminadas; desde la 4.0, habitaciones anteriores conservadas: la de una cuenta activa se sigue editando y la de una desactivada ya no (UP6–UP7) | local; en CI (`db-security`) en verde desde el PR #7; el último, sobre `83654eb` (run `38003093188`) |
| `tests/supabase/phase4-upgrade-selftest.sh` (R8) | ✅ 76/76 desde la tercera ronda (antes 67/67, 45/45 y 31/31). Nuevos en la tercera: meta-comandos a mitad de línea y `$$` pegado a un nombre en archivos fijados, rechazados sin llamar a psql, con un control de barras invertidas legítimas; una línea `ERROR:` con psql terminado en 0 («NO CONFIRMADO… incierto» con COMMIT, «ensayo FALLIDO» en el ensayo) y un control de falsos positivos (el texto «ERROR:» en un aviso o un resultado). Contra el código de `3e4cdee` falla en 9. Nuevos en la segunda: el flujo se construye entero antes de conectar (un archivo que desaparece o cambia después de su SHA-256, control de transacciones o meta-comandos con el SHA-256 al día, un `cat` que omite una parte, un `commit;` dentro de `$$`: todos rechazados sin llamar a psql); archivos retirados entre las dos pasadas sin efecto en la segunda; entradas cortadas antes del `COMMIT` o del `ROLLBACK`; «apply NO VÁLIDO» con el `COMMIT` ejecutado; SIGINT y SIGTERM al grupo de procesos en cada pasada; una sola línea `RESULTADO:` por caso, la suya. Antes: entradas incompatibles rechazadas sin conectar; `dry_run` sin efectos (misma huella de esquema y datos); `apply` en dos pasadas y el preflight vigente después; segunda aplicación rechazada; otra marca o ninguna; seis estados de partida inesperados; SHA-256 distinto (una migración, el preflight congelado o el vigente) antes de conectar, con un psql falso que demuestra que no se le llama; error a mitad, preflight vigente que falla y WARNING, todos sin dejar nada; el WARNING llega también con `client_min_messages = error` en la base de datos, y una migración que lo sube se rechaza (`R8-MSG`); un aviso de éxito que falta hace fallar la pasada; un error o la conexión perdida solo en la pasada con `COMMIT` dan «NO CONFIRMADO… incierto»; ninguna salida con la contraseña ni la cadena de conexión | local, con bases de datos temporales. En CI (`db-security`) del PR #27: el paso pasó en el run #63 (versión de 31) y en el #64 (versión de 45, sobre `2278cf7`), sin poder leer sus logs: el número de comprobaciones ejecutadas en CI no está verificado directamente |
| Mutaciones de la herramienta de R8 contra su selftest | ✅ 14/14 detectadas: `dry_run` que confirma, sin SHA-256, sin el preflight congelado, sin R8-BASE, `apply` en una sola pasada, sin comprobar entradas, sin el preflight vigente, sin la guarda, que imprime la conexión, sin `ON_ERROR_STOP`, WARNING que no falla, confirmación laxa, E2 permitido y migraciones que confirman a mitad. Todas comprobadas con `bash -n` y detectadas por la comprobación que corresponde. **Correcciones de la revisión: 5/5 detectadas** (cada una revierte una corrección): sin `set local client_min_messages`, sin comprobar los avisos de éxito, el mensaje antiguo «nada aplicado» en la pasada con `COMMIT`, el preflight vigente sin SHA-256 y sin el `R8-MSG` final. **Segunda ronda (B1–B3): 12/12 detectadas**: la copia sin volver a comprobar su SHA-256, sin `roomly_sql_transform`, sin rechazar bloques `begin;`/`rollback;`, `concat_verified` sin comprobar, sin exigir un único `ROLLBACK`/`COMMIT`, sin la última línea del flujo, sin el trap de SIGINT, la etapa con COMMIT sin marcar, el trap sin salir, el flujo releído entre pasadas, «NO VÁLIDO» comunicado como incierto y el mensaje antiguo. Además, el selftest de 67 contra el script de `2278cf7` falla en 16 comprobaciones, las de los casos nuevos. **Tercera ronda (M1 y L1): 6/6 detectadas**: sin rechazar la barra invertida fuera de literales, sin rechazar `\'` en una cadena, sin rechazar `$$` pegado a un nombre (las tres por `sql-suite-selftest`, y la primera y la tercera también por el de R8), sin comprobar las líneas `ERROR:`, comunicándolas como NO VÁLIDO y sin anclar la búsqueda (el control de falsos positivos falla) | local, sobre copias en el scratchpad (el repositorio no se toca) |
| Mutaciones de R1 contra `test:db` y el selftest de actualización | ✅ 10/10 detectadas: sin la comprobación previa, comprobación previa solo por slug, falta un barrio, un nombre cambiado, un barrio de más, Barcelona con otros valores que el seed, la carga sin `on conflict`, el seed sin `on conflict`, barrios con coordenadas y sin la migración. `validation-infra` detecta además las que cambian la lista, Barcelona o el seed | local, sobre copias en el scratchpad (el repositorio no se toca) |
| Mutaciones de R7 (opción A) contra `tests/db/17` | ✅ 14/14 detectadas solo con `17`: sin el trigger de moderación, deshabilitado, que solo bloquee entrar en `removed`, que solo bloquee salir, que bloquee también a un admin, que bloquee a `service_role`; sin `chk_rooms_publishable`, publicar solo con barrio; `status` en el INSERT, sin UPDATE de `status`; sin el bloqueo de cuentas desactivadas, o solo en el `WITH CHECK`; `anon` con UPDATE de `status`; `service_role` sin UPDATE. Las 7 que detecta primero la estructura (ST0) las detecta también el comportamiento (ST1 o ST4) si se quita ST0 | local, sobre copias de la migración y del test en el scratchpad (el repositorio no se toca) |
| Mutaciones de la Fase 4.1 contra `test:db` | ✅ 16/16 detectadas: sin el CHECK de catálogo, con una clave de más, sin el de duplicados, sin el de `total_roommates`, `total_rooms` ≥ 0, publicar solo con barrio, publicación neutralizada (`or true`, sin quitar el texto), sin la FK barrio ↔ ciudad, `status` en el INSERT, `deleted_at`/`approx_*` en el UPDATE, `owner_id` en el UPDATE, `anon` vuelve a escribir, UPDATE de tabla completa, sin UPDATE de `status`, sin la migración; y sin la comprobación previa, que detecta `migration-upgrade-selftest`. Las neutralizaciones que conservan el texto las detecta el comportamiento (RT4, RP2, RP3), no la estructura. Las 11 de la 4.0 siguen detectándose con los tests de la 4.1 | local, sobre copias de la migración en el scratchpad (el repositorio no se toca) |
| Mutaciones de la Fase 4.0 contra `test:db` | ✅ 11/11 detectadas: la comprobación de cuenta activa neutralizada (`or true`, sin quitar el texto) en el UPDATE y el INSERT de `rooms`, el INSERT de `room_addresses` y el DELETE de `room_images`; vuelve `rooms_owner_write`; UPDATE de `rooms` sin propiedad; dirección legible por todos; UPDATE de `room_images` sin la comprobación; sin la migración; y, tras la auditoría del PR #25, un rechazo 42501 que no viene de la RLS (trigger de INSERT) en la fila de `anon` de RI3 o en la de D de RD2, que solo detectan las repeticiones RI3-control y RX2 (con el test anterior pasaban). `15_rooms_integrity` falla en las once | local, sobre copias de la migración en el scratchpad (el repositorio no se toca) |
| Mutaciones de la Fase 3.1 contra `test:db` | ✅ 5/5 detectadas (sin S4, UPDATE devuelto a `authenticated`, sin bloqueo de cuentas eliminadas, SELECT para `anon`, bajar de versión permitido) | local, sobre una copia de la migración en el scratchpad |
| Mutaciones del motor (Fase 3.2) | ✅ 7/7 detectadas (media en vez de `min`, Jaccard, dato ausente como neutro, sin r6, dirección por suma en vez de signos concordantes, sin tope de diferencias, umbral de fortaleza exclusivo) | local, `score.ts` restaurado y comprobado con `diff` |
| `npm run test:coverage:matching` (cobertura V8 de `lib/matching/`) | ✅ medida, sin umbral: líneas 100 % (212/212), funciones 100 % (58/58), ramas 98,38 % (244/248) y sentencias 99,61 % (258/259), con los 1030 unitarios (ver «Cobertura del motor de matching» abajo) | local (2026-10-13), también desde un `npm ci` limpio; la CI no lo ejecuta |
| Migraciones + seed en Supabase real | ✅ las 9 migraciones y el seed, en una transacción (run 13) · ✅ las 10 migraciones y el seed, en una transacción (run 16, Fase 3) · ✅ las 3 migraciones de la Fase 4 (`20261013120000`, `20261015120000` y `20261016120000`) sobre el esquema de la Fase 3, con R8: un ensayo con ROLLBACK y después el mismo cuerpo con COMMIT, «RESULTADO: apply correcto» (run 21, `39521485133`, `a8e5028`). Antes, el `dry_run` del run 20 (`39176175018`, `1543718`) terminó en ROLLBACK, sin efectos | `roomly-validation-2b` (`uwxb…`) · `roomly-validation-3` |
| Preflight P0–P6 en Supabase real | ✅ 37 políticas, 12 triggers, 10 funciones (runs 13 y 15) · ✅ marca `roomly-validation-3`, 18 tablas, 37 políticas, 13 triggers, 11 funciones (run 16; en verde en los runs 17, 18 y 19) · ✅ con la Fase 4: 18 tablas, los 73 barrios oficiales y las restricciones de `rooms` de la 4.1 (P1), 44 políticas (P3), el GRANT de `rooms` (P4), 13 triggers y 11 funciones (P6); job `preflight` del run 21, después del COMMIT. También dentro de la transacción de R8, en los runs 20 y 21 | `roomly-validation-2b` · `roomly-validation-3` |
| Suite SQL `tests/db` con roles reales | ✅ 58/58 (`01`–`04`, **histórico**) · ✅ `01`–`13` (los 13 archivos, cada uno revertido, sin restos; runs 13 y 15) · ✅ 305/305 en `01`–`14` (los 14 archivos, cada uno revertido; las 15 comprobaciones del runner, sin restos; runs 16 y 18) · ✅ los 14 archivos completados con el mensaje de éxito y la comprobación final sin restos (run 19; el runner aborta ante cualquier aserción fallida, y las 305 son las de la suite, no un recuento sacado del log) · ✅ `01`–`18`, con la Fase 4: los 18 archivos, cada uno revertido; 651 líneas `ok -` en el log, el mismo número que `test:db` en local, ninguna `not ok` ni WARNING, y la comprobación final sin restos (run 21; `15`–`18`, por primera vez en real) | `roomly-validation` (Fase 1) · `roomly-validation-2b` · `roomly-validation-3` |
| `npm run test:supabase` (supabase-js, JWT reales) | ✅ 46/46 (histórico) · ✅ 46/46 (run 13; en verde en el 15) · ✅ 52/52, con CRA1–CRA6 (runs 16 y 18) · ✅ **62/62**, con las 10 nuevas de los servicios del servidor: SVC1–SVC4, los dos casos de SVC5 y GC1–GC4 (run 19, `38106687478`, `92fb757`; su primer run real). Antes del run, en local, sin red y con un `fetch` falso, se comprobó que la config de integración resuelve `server-only` y que la observación de GC4/SVC4 captura la petición y la respuesta cruda con postgrest-js sin cambiarlas; eso no fue una validación real · ✅ **62/62** con la Fase 4 (run 21, `39521485133`, `a8e5028`): «Tests 62 passed (62)»; RO1–RO9, por primera vez contra el esquema de la 4.1 | `roomly-validation` · `roomly-validation-2b` · `roomly-validation-3` |
| AU3 / AU5 sin sesión (`auth-redirects.sh`) | ✅ 6/6 (histórico) · ✅ 16/16 (run 13; en verde en el 15) · ✅ 16/16 (runs 16 y 18) · ✅ 16/16 (run 19) · ✅ 16/16 con la Fase 4 (run 21) | `roomly-validation` y local tras `proxy.ts` · `roomly-validation-2b` · `roomly-validation-3` |
| AU4 magic link / AU5 con sesión | ✅ manual (histórico; login de un usuario creado en el dashboard) | `roomly-validation`, PC del propietario |
| E2 real (alta por magic link con email real) | ✅ 1/1, run 15 (`37543144825`, `ec7c3fc`): `signInWithOtp` → email en Mailtrap → `/auth/v1/verify` → `/callback?code=` con PKCE → onboarding → `/perfil` → `/preferencias` → `/ajustes` → logout; limpieza sin residuos (1 usuario borrado, buzón vacío). Run 14: falló antes de enviar nada por `E2E_MAILBOX_CONFIG` mal formado · ✅ 1/1, run 18 (`37999470912`, `6dae75f`, Fase 3): el mismo recorrido, con el onboarding terminando en `/test` («Test de convivencia»); limpieza: 1 usuario borrado, sin datos asociados, y mensajes del buzón borrados. Run 17 (`37998858090`): falló a los 267 ms, antes de abrir `/login`, por `E2E_MAILBOX_CONFIG` no válido; sin emails ni usuarios · ⏭️ **sin ejecutar con la Fase 4**: en el run 21, `e2e-real` se omitió (`run_e2e_real=false`) | workflow manual, job `e2e-real`, `roomly-validation-2b` · `roomly-validation-3` |
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
- **Validación real contra Supabase:** los runs 16–18 son anteriores a la
  v2. Desde el run 19, los servicios del servidor la ejecutan en real (SVC y
  GC, ver abajo). El recorrido en el navegador (E2) y el runtime de Next.js
  con el cliente admin no han pasado por ningún run real con la v2.

**Servicios del servidor (SVC/GC) en Supabase real: run 19** (`38106687478`,
`92fb757`, 2026-10-11), con `apply_migrations=false` y `run_e2e_real=false`:
- guarda, P0–P6, suite SQL 01–14, api-suite 62/62 (incluidos SVC 6/6 y
  GC 4/4, por primera vez en real) y AU3/AU5 16/16, todo en verde;
  migraciones y E2 omitidos por los parámetros;
- el teardown terminó sin errores y sus comprobaciones finales no
  encontraron filas de prueba en `profiles`, `housing_preferences` ni
  `compatibility_responses`. Es evidencia del propio workflow, sin una
  inspección remota independiente;
- valida los servicios `saveQuestionnaireAnswers` y `getCandidates`, no el
  runtime completo de Next.js. Sigue pendiente la combinación «Next.js en
  ejecución + cliente admin».

Detalle en `docs/SUPABASE_VALIDATION.md` («Resultado: run 19, servicios del
servidor (SVC/GC)»). Los tests unitarios y E1 siguen corriendo contra el
Supabase simulado en la CI; la api-suite real solo corre en el workflow
manual.

**La Fase 3 se cerró el 2026-10-13** (`docs/ROADMAP.md`, «Cierre de la
Fase 3»). Es un cierre técnico: el runtime de Next.js desplegado con la
clave real sigue sin validar, y quedan pendientes otros requisitos antes de
usar el producto con personas reales. En las filas de Supabase real de esta tabla, lo marcado
con los runs 16–19 es de la Fase 3, lo del run 21 (y el `dry_run` del run 20),
de la Fase 4, y el resto, de las Fases 1 y 2.

**Fase 4 en Supabase real: run 21** (`39521485133`, `a8e5028`, 2026-10-21),
el `apply` de R8 en `roomly-validation-3`, lanzado por el propietario:
- R8 aplicó las tres migraciones de la Fase 4 («apply correcto»);
- después, en verde: el preflight P0–P6 con la Fase 4, la suite SQL
  `01`–`18`, la api-suite 62/62 (RO1–RO9 contra la 4.1) y AU3/AU5 16/16;
- `migrate` y `e2e-real` se omitieron por los parámetros: **el E2 no está
  validado con la Fase 4**;
- la limpieza solo la comprueba el propio workflow (la suite SQL y el
  teardown de la api-suite): no hay una inspección independiente;
- no hubo ninguna aprobación del Environment, aunque estaban previstas. Las
  pruebas corrieron igual, pero el control previsto no funcionó;
- no valida el runtime completo de Next.js con la clave real.

Detalle, con los niveles de evidencia, en `docs/SUPABASE_VALIDATION.md`
(«Resultado: run 21, `apply` de R8 (Fase 4)»). Los bloques «Fase 4.0» y
«Fase 4.1» de abajo describen el estado anterior al run 21.

**Fase 4.0 (2026-10-13): sin validación real** hasta el run 21 (ver arriba).
- La migración `20261013120000` y `15_rooms_integrity` solo han corrido en
  local y en la CI.
- Desde ella, el preflight espera 44 políticas y la suite SQL tiene 15
  archivos. `roomly-validation-3` tiene las 37 anteriores, así que un run
  nuevo contra ese proyecto fallaría en P3.
- Su workflow no aplica migraciones a un esquema que ya existe. Cómo validar
  en real las migraciones de la Fase 4 lo decide el propietario (R8).

**Fase 4.1 (2026-10-15): sin validación real** hasta el run 21 (ver arriba).
- La migración `20261015120000` y `16_rooms_publication` solo han corrido en
  local y en la CI. La suite SQL pasa a 16 archivos, y P1 y P4 del preflight
  exigen las restricciones y el GRANT de la 4.1, que `roomly-validation-3`
  tampoco tiene.
- `17_rooms_status_transitions` (la decisión R7 sobre `status`), igual: solo
  en local y en la CI. Con él, la suite SQL tiene 17 archivos.
- La carga de barrios oficiales (R1, `20261016120000`) y
  `18_neighborhoods_catalog`, igual: solo en local y en la CI. La suite SQL
  tiene 18 archivos, y P1 exige los 73 barrios, que `roomly-validation-3` no
  tiene.
- La api-suite (RO1–RO9) crea borradores completos y los publica con un
  UPDATE, con un barrio oficial de Barcelona. Ni RO ni la api-suite se han
  ejecutado con la 4.1.

Las secciones siguientes son el registro histórico de cada sesión; lo que
dicen como "pendiente" puede estar ya superado por esta tabla.

## R8 — herramienta de actualización de la Fase 4 (2026-10-17, solo en local)

`tests/supabase/phase4-upgrade.sh` aplica a `roomly-validation-3` las tres
migraciones de la Fase 4 sobre el esquema de la Fase 3. **En la fecha de esta
sección no se había ejecutado contra ningún proyecto.** Después corrió contra
`roomly-validation-3` en `dry_run` (run 20, 2026-10-18, sin efectos) y en
`apply` (run 21, 2026-10-21, «apply correcto»; ver «Fase 4 en Supabase real:
run 21», arriba). El procedimiento y sus límites están en
`docs/SUPABASE_VALIDATION.md` («Fase 4: herramienta de actualización»).
- **Qué se prueba** (`tests/supabase/phase4-upgrade-selftest.sh`, 76
  comprobaciones, en `test:infra`):
  - simula el proyecto con el rol de pooler `postgres.<ref>` y la marca,
    como los demás selftests, y clona para cada caso una base de datos local
    con el esquema de la Fase 3 (migraciones hasta `20261007120000` y seed);
  - A: combinaciones de entradas, rechazadas antes de la guarda. Un psql falso
    en el `PATH` deja constancia de cada llamada; su control comprueba que sí
    se le llama con entradas y archivos correctos;
  - B–D: `dry_run` sin efectos (con los dos `R8-MSG`), `apply` (con el
    preflight vigente después) y una segunda aplicación rechazada;
  - E–F: otra marca o ninguna, y seis estados de partida inesperados;
  - G: una migración, el preflight congelado o el vigente con otro SHA-256,
    rechazados antes de conectar (el psql falso no recibe ninguna llamada).
    Tampoco conecta, desde la segunda ronda de correcciones:
    - si un archivo desaparece o recibe un `commit;` justo después de su
      comprobación (un `sha256sum` envoltorio lo cambia);
    - si un archivo fijado, con el SHA-256 al día, contiene `commit;`, un
      bloque `begin;`/`rollback;` o `\connect`;
    - si un `cat` omite una parte sin dar error;
    - si una línea `commit;` va dentro de un cuerpo `$$`;
    - desde la tercera ronda, si un archivo fijado lleva un meta-comando a
      mitad de línea (`\connect`, `\set ON_ERROR_STOP 0`, `\!`) o `$$`
      pegado a un nombre. Control: las barras invertidas de un comentario,
      una cadena, un identificador y un cuerpo `$$` se aceptan;
  - N: el flujo se construye antes de conectar. Un psql envoltorio retira el
    preflight vigente y la tercera migración después de la pasada de ensayo, y
    la segunda pasada sigue completa («apply correcto»). Otro corta la entrada
    justo antes del `COMMIT` («NO CONFIRMADO… incierto», nunca «NO VÁLIDO») o
    del `ROLLBACK` («ensayo FALLIDO»);
  - H–J: un error en la segunda migración, un preflight vigente que falla y un
    WARNING; en los tres, la huella del esquema no cambia. El WARNING se
    detecta también con `client_min_messages = error` en la base de datos, y
    una migración que sube `client_min_messages` se rechaza (`FALLO R8-MSG`);
  - L: sin el `ok - P6:` del preflight vigente, la pasada falla aunque psql
    termine bien;
  - M: fallos solo en la pasada con `COMMIT`. Una secuencia (no se revierte)
    distingue las dos pasadas para provocar un error en la segunda, y un
    trigger diferido termina su propio backend al ejecutarse el `COMMIT`. Los
    dos dan «apply NO CONFIRMADO… incierto» y piden el preflight, nunca «nada
    aplicado»;
  - V: un WARNING o un aviso que falta solo en la segunda pasada da «apply NO
    VÁLIDO», con el `COMMIT` ejecutado (73 barrios) y salida con error;
  - O: una línea `ERROR:` con psql terminado en 0. El psql envoltorio
    antepone `\set ON_ERROR_STOP 0` en una pasada e inserta `select 1 / 0;`
    justo antes de su `ROLLBACK` o `COMMIT`: psql sigue, imprime la línea
    final y termina con 0. En la pasada con `COMMIT` da «NO CONFIRMADO…
    incierto» (y en local la huella no cambia: ese `COMMIT` fue un
    `ROLLBACK`), y en la de ensayo, «ensayo FALLIDO». Control: «ERROR:» dentro
    de un aviso y de un resultado no hace fallar la pasada;
  - S: SIGINT al grupo de procesos durante la pasada con `COMMIT` da
    «INTERRUMPIDO… incierto», y SIGTERM durante el ensayo, «nada confirmado».
    El selftest lanza la herramienta con `setsid` y `env --default-signal=INT`:
    un proceso en segundo plano de un script arranca con SIGINT ignorado, y
    bash no deja capturarlo;
  - R: cada resultado tiene una sola línea `RESULTADO:`, la de su clase;
  - K: ninguna salida contiene la contraseña ni la cadena de conexión.
- **Cómo se compara:** una huella md5 de políticas, restricciones, triggers,
  GRANT de tabla y de columnas de `rooms`, ciudades, barrios y dueños de las
  tablas, antes y después.
- **Mutaciones:** 14/14 de la versión inicial, 5/5 de la primera ronda de
  correcciones, 12/12 de la segunda y 6/6 de la tercera (ver la tabla).
- **Límites:** PostgreSQL 16 y un rol superusuario. No reproduce los avisos
  de privilegios de un rol no superusuario como el de Supabase, ni el Session
  pooler. La conexión perdida durante el `COMMIT` se simula terminando el
  propio backend, no con un corte de red o del pooler. Las señales se
  envían en local al grupo de procesos; qué envía GitHub Actions al cancelar
  un job no se ha comprobado, y un SIGKILL no se puede capturar.

## Fase 4.1 — R1: barrios oficiales de Barcelona (2026-10-16, en local)

Migración de datos `20261016120000_barcelona_neighborhoods.sql`, con los 73
barrios del archivo oficial (© Ajuntament de Barcelona, Open Data BCN, CC BY
4.0; detalle en `docs/DATABASE.md`).
- **Verificación del archivo** (en el scratchpad, sin versionar el JSON):
  - JSON válido, 73 objetos con 6 campos;
  - 73 `codi_barri` (`01`–`73`) en los 10 districtes;
  - geometrías cerradas, que suman 101,70 km², dentro del término municipal;
  - las 73 filas de la migración coinciden exactamente con el archivo
    (código, nombre y slug derivado).
- **Qué se prueba:**
  - `tests/db/18_neighborhoods_catalog.sql` (22 aserciones):
    - NB0–NB1: la lista del test, Barcelona y el seed después de las
      migraciones;
    - NB2–NB4: los 73 exactos, sin coordenadas, sin duplicados por nombre y
      con la huella de P1;
    - NB5: lectura abierta, sin escrituras de usuarios ni de `anon`, con un
      control del admin;
    - NB6: un barrio oficial con las reglas de la 4.1 (publicar, barrio ↔
      ciudad) y con las preferencias.
  - P1 del preflight: los 73 por número y huella, con 4 mutaciones nuevas en
    `preflight-selftest`.
  - `migration-upgrade-selftest`: instalación existente, carga rechazada,
    carga repetida e instalación limpia, con y sin seed.
  - `validation-infra`: la lista de la migración, Barcelona igual que en el
    seed, la carga sin borrados, la lista de `tests/db/18` y la huella.
- **Por qué no se exige «solo 73» en `tests/db/18`:** en local, `run.sh`
  ejecuta los archivos sobre la misma base de datos, y otras pruebas dejan
  barrios sintéticos en Barcelona. Lo exigen P1, contra el proyecto de
  validación, y el selftest, sobre bases de datos sin esos barrios.
- **Mutaciones locales:** 10/10 detectadas (ver la tabla).

## Fase 4.1 — R7: transiciones de `status` (2026-10-15, en local)

Decisión expresa del propietario (opción A, 2026-10-15): la propietaria
actualiza `status`, dentro de los límites de la base de datos. Sin cambios en
la migración: el test fija la matriz efectiva que ya resultaba de la 4.0, H5
y la 4.1 (`docs/DATABASE.md`, «Estado de la habitación»).
- **Qué se prueba** (`tests/db/17_rooms_status_transitions.sql`, 160
  aserciones):
  - **ST0, permisos y fixtures:**
    - `status`: `authenticated`, solo en el UPDATE; `anon` no escribe;
      `service_role`, tabla completa;
    - el trigger de moderación, activo, y `chk_rooms_publishable`;
    - `room_status` con exactamente los 5 estados de la matriz: un estado
      nuevo obliga a revisarla;
    - las habitaciones C y DR completas e I incompleta, en `draft`, con un
      barrio sintético propio del test (no es un barrio real; R1);
    - la propietaria desactivada ve su habitación, y el admin la de O.
  - **ST1, matriz:** 6 casos × 20 transiciones entre `draft`, `active`,
    `paused`, `rented` y `removed`:
    - propietaria activa, con su habitación completa y con la incompleta;
    - admin activo;
    - propietaria desactivada;
    - `service_role`, con la completa y con la incompleta.
    Cada celda parte de un estado que fija el dueño de las tablas y se
    intenta en una subtransacción que se deshace. Las 4 celdas `active → …`
    de la incompleta no pueden ni prepararse (`chk_rooms_publishable`), en
    los dos casos.
  - **ST2, flujo persistido de la propietaria:** publica, pausa, reactiva,
    edita otro campo y marca como alquilada. Activa, no puede dejarla sin
    `total_rooms`, `total_roommates` ni barrio, ni marcarla `removed` con un
    UPDATE directo, y los rechazos no cambian la fila.
  - **ST3, moderación persistida:** el admin la retira; la propietaria no la
    reactiva ni la pasa a `draft`; el admin la devuelve a `paused` y la
    propietaria la reactiva.
  - **ST4, GRANT:** el cliente no fija `status` al crear (ni `draft` ni
    `active`); la misma fila sin `status` entra y nace `draft`. `anon` ve la
    habitación activa, pero no cambia su estado ni crea habitaciones.
  - **ST5, controles:**
    - sin el trigger (dentro de `begin;`/`rollback;`), la propietaria
      pondría `removed`; después vuelve a estar activo;
    - reactivada, D publicaría su habitación;
    - completada, I se publica, y pausada puede volver a quedar incompleta.
- **Por qué las negativas fallan por la regla, sin depender del idioma de
  los mensajes:**
  - H5: `42501` con el mensaje propio `room_moderation:`;
  - publicación: `23514` con `constraint_name = chk_rooms_publishable`
    (`get stacked diagnostics`);
  - GRANT: `42501` sin ese prefijo, y la misma fila sin `status` entra;
  - cuenta desactivada: 0 filas sobre una fila que ve, y 1 fila al
    reactivarla;
  - cada rechazo se acepta en otra celda, con otro actor o en los controles.
- **Mutaciones locales:** 14/14 detectadas solo con `17` (ver la tabla).
- **Comportamiento actual que el test no fija** (no forma parte de la
  decisión; Fase 7): con la habitación en `removed`, la propietaria puede
  editar las demás columnas y borrarla. Comprobado en una base de datos de
  prueba del scratchpad, sin cambios en el repositorio.

## Fase 4.1 — integridad, catálogo, ocupación y publicación de habitaciones (2026-10-15, en local)

- **Qué se prueba** (`tests/db/16_rooms_publication.sql`, 88 aserciones):
  - **RS1–RS5, estructura:**
    - las 8 CHECK de `rooms`, validadas;
    - la FK compuesta y su clave única, comparadas por catálogo, sin depender
      del texto de `pg_get_constraintdef`;
    - el catálogo exacto de la base de datos;
    - las columnas exactas de INSERT y UPDATE de `authenticated`;
    - `anon` solo con SELECT y `service_role` con la tabla completa.
  - **RC1–RC9, catálogo (R6):**
    - acepta las 12 claves a la vez, el array vacío y un subconjunto;
    - rechaza (`23514`) una clave desconocida, otras mayúsculas, una
      repetida, `NULL` y los nombres de las columnas booleanas;
    - también como `service_role`.
  - **RT1–RT6, ocupación (R9):** un borrador sin ocupación se guarda; 0
    compañeros y 1 dormitorio son válidos; negativos y `total_rooms = 0`, no,
    tampoco como servidor.
  - **RN1–RN9, barrio ↔ ciudad (R1):** rechaza (`23503`) el barrio de otra
    ciudad al crear, al cambiar el barrio y al cambiar solo la ciudad, también
    como servidor. Acepta un cambio coherente de los dos y un borrador sin
    barrio. Un admin renombra un barrio en uso, pero no lo mueve de ciudad ni
    lo borra.
  - **RP1–RP13, publicación (R7):**
    - un borrador incompleto se guarda y nace `draft`;
    - no se publica sin barrio, sin `total_roommates` o sin `total_rooms`, y
      una habitación activa no los pierde;
    - pausada puede quedar incompleta, pero no se reactiva sin completarla;
    - el cliente no fija `status` al crear;
    - ni un admin ni el servidor publican una habitación incompleta;
    - una cuenta desactivada no publica su borrador completo.
  - **RG1–RG7, columnas reservadas:**
    - `deleted_at`, `approx_*`, las fechas, `owner_id` e `id`, rechazados
      (`42501`), y también el upsert que reescribe `owner_id`;
    - los datos del anuncio y el estado, sí;
    - un admin modera, pero no hace el borrado lógico;
    - `anon` no edita.
  - **RK1–RK7, control negativo:** dentro de `begin;`/`rollback;` se retiran
    las restricciones y se concede `deleted_at`. Las escrituras rechazadas
    entran, y después todo vuelve a estar como antes.
- **Por qué las negativas fallan por la regla:**
  - cada rechazo exige su SQLSTATE, y el log muestra la restricción concreta
    (`chk_rooms_*`, `fk_rooms_neighborhood_city` o el GRANT);
  - cada negativa va precedida de una escritura válida sobre la misma fila,
    y las de CHECK y FK se repiten como `service_role`.
- **Ajustes:**
  - `03` y `15` crean borradores completos y los publican con un UPDATE;
  - la aserción H5 de `03` que combinaba `status` con `deleted_at` usa ahora
    columnas permitidas, para que su `42501` siga siendo del trigger;
  - el borrado lógico de RD2 (`15`) espera el `42501` del GRANT.
- **Infraestructura:** P1 (restricciones y catálogo) y P4 (GRANT de `rooms`)
  del preflight, con 15 mutaciones nuevas; `migration-upgrade-selftest`
  (UP8–UP9 y el rechazo con datos inválidos); `validation-infra`; y la
  api-suite (RO1 y RO6), sin ejecutar entonces. (Después, en real en el run
  21: RO1–RO9 en verde.)
- **Mutaciones locales:** 16/16 de la 4.1 y 11/11 de la 4.0 detectadas (ver
  la tabla).

## Fase 4.0 — escrituras de habitaciones con la cuenta desactivada (2026-10-13, en local)

- **Qué se prueba** (`tests/db/15_rooms_integrity.sql`, 73 aserciones):
  - RI0, estructura:
    - `authenticated` conserva INSERT, UPDATE y DELETE en las tres tablas;
    - las 14 políticas de habitaciones por nombre y comando;
    - cada política de escritura es de `authenticated` y exige propiedad y
      `deleted_at IS NULL` en todas sus expresiones;
    - `room_id` cualificado;
    - ninguna política de lectura consulta `profiles`.
  - RI1: un propietario activo crea, edita y borra habitaciones, direcciones
    e imágenes.
  - RI2–RI4: otro usuario no escribe en las filas ajenas, y ni él ni `anon`
    leen la dirección exacta conociendo el `room_id`.
  - RD0–RD5: una cuenta que se desactiva a mitad del test, con el mismo JWT,
    no escribe en ninguna de las tres tablas, pero sigue leyendo sus filas.
  - RE1: una cuenta desactivada desde el principio no crea habitaciones.
  - RX1–RX3: el admin y `service_role` conservan lo que podían hacer.
  - RL1–RL2: la lectura no cambia. Una habitación activa de una cuenta
    desactivada sigue siendo pública: ocultarla es R7, pendiente.
- **Por qué las negativas fallan por permisos:**
  - `authenticated` conserva el GRANT (RI0), así que su 42501 al insertar es
    de la RLS: el mensaje es «new row violates row-level security policy».
    El GRANT de `anon` no se comprueba: su 42501 (RI3) puede venir del GRANT
    o de la RLS, y en los dos casos no escribe;
  - cada INSERT rechazado se repite con los mismos datos y entra: lo repite
    la dueña si su cuenta está activa (RI2-control y RI3-control) y, si no,
    `service_role` (RX2). Un 42501 que no viniera de la RLS (por ejemplo, de
    un trigger) haría fallar la repetición;
  - antes de cada UPDATE o DELETE con 0 filas se comprueba que la fila es
    visible para quien lo intenta. Para la dirección ajena se abre la
    lectura con una política temporal en `begin;`/`rollback;`, como en
    `tests/db/11`.
- **Control negativo dentro del test (RI9):** se añaden, también temporales,
  políticas con la condición de antes de la 4.0 (solo propiedad), y la
  cuenta desactivada vuelve a escribir en las tres tablas. Al terminar se
  comprueba que no queda ninguna política `zz_test` y que las tablas siguen
  con sus 14 políticas.
- **Mutaciones locales:** 11/11 detectadas, sobre copias de la migración en
  el scratchpad (ver la tabla). Cuatro neutralizan la comprobación con
  `or true` sin quitar su texto, así que las detecta el comportamiento (RD2,
  RD3 y RD4) y no la guarda estática. Las dos últimas, añadidas tras la
  auditoría del PR #25, rechazan con 42501 desde un trigger la fila de
  `anon` (RI3) o la de D (RD2): solo las detectan las repeticiones
  (RI3-control y RX2), y con el test anterior pasaban.
- **Infraestructura:**
  - el preflight P3 espera 44 políticas y comprueba la cuenta activa en las
    escrituras de habitaciones, con 6 mutaciones nuevas en su selftest;
  - `sql-suite-selftest` y `migration-upgrade-selftest` (UP5–UP7) usan los
    nuevos recuentos;
  - `validation-infra` deriva las 44 de las migraciones.
- **Límites:**
  - PostgreSQL 16 local con el shim, no Supabase real (ver arriba);
  - no cubre Storage, que no existe todavía;
  - el mock de E1 no tiene habitaciones: no hace falta, porque la
    aplicación todavía no las usa.

## Cobertura del motor de matching (2026-10-13, en local)

- **Comando:** `npm run test:coverage:matching` (`vitest.coverage.config.ts`).
  - Ejecuta los mismos tests que `npm run test`: los 37 archivos de
    `tests/unit/`, 1030 tests.
  - Mide con V8 (`@vitest/coverage-v8` 5.0.2, la misma versión que
    `vitest`) solo `lib/matching/`, con todos sus archivos, también los que
    ningún test carga.
  - Saca una tabla en la consola y `coverage/matching/coverage-summary.json`,
    que no se versiona.
- **Sin umbrales:** solo mide. La CI no lo ejecuta ni falla por un
  porcentaje. El propietario aceptó el 2026-10-13 la cobertura medida (abajo),
  junto con las mutaciones del motor 7/7, como suficiente para el criterio
  «cobertura de tests casi total» de la Fase 3, sin exigir el 100 % de ramas.
  Solo resuelve ese criterio: la Fase 3 sigue NO CERRADA (`PROGRESS.md`,
  sesión 39, y `docs/ROADMAP.md`).
- **Resultado** (2026-10-13, sobre `c90f9f1` más este comando; igual desde
  un `npm ci` limpio):

  | Archivo | Líneas | Funciones | Ramas | Sentencias |
  |---|---|---|---|---|
  | **`lib/matching/` (total)** | **100 % (212/212)** | **100 % (58/58)** | **98,38 % (244/248)** | **99,61 % (258/259)** |
  | `explanations.ts` | 100 % (10/10) | 100 % (3/3) | 100 % (12/12) | 100 % (12/12) |
  | `filters.ts` | 100 % (20/20) | 100 % (10/10) | 100 % (44/44) | 100 % (30/30) |
  | `questionnaire-status.ts` | 100 % (14/14) | 100 % (4/4) | 100 % (15/15) | 100 % (18/18) |
  | `questionnaire.ts` | 100 % (17/17) | 100 % (4/4) | 100 % (8/8) | 100 % (17/17) |
  | `score.ts` | 100 % (148/148) | 100 % (37/37) | 97,63 % (165/169) | 99,44 % (178/179) |
  | `types.ts` | 0/0 | 0/0 | 0/0 | 0/0 |
  | `weights.ts` | 100 % (3/3) | 0/0 | 0/0 | 100 % (3/3) |

- **Lo que queda sin cubrir** (`score.ts`): cuatro ramas defensivas que los
  cuestionarios registrados no alcanzan (lo comprueba
  `questionnaire-versions`).
  - `:141-142`: una pregunta de conducta sin su pareja y su `continue`, la
    única sentencia sin cubrir.
  - `:252`: una tolerancia sin `toleranceOf`.
  - `:348`: peso total 0.

  No se han añadido tests para cubrirlas.
- **Límites de la medición:**
  - Solo cuenta los tests unitarios. No instrumenta E1 (la app compilada
    contra el mock), `test:db` ni la api-suite real.
  - V8 mide lo que se ejecuta, no lo que se comprueba: una línea cubierta
    puede no tener ninguna aserción. La otra evidencia son las mutaciones
    del motor (7/7, arriba).
  - Los tests de servicios y de rutas también ejecutan el motor y suman a
    la cobertura. La medición no separa qué parte viene de los tests propios
    del motor.
  - `types.ts` solo tiene tipos (0/0): la tabla de la consola lo muestra
    como 0 y el JSON como 100 %.
  - Medido en la nube de Claude Code (Node 22.22.2), no en la CI.

## D1 — la clave service_role fuera de los bundles públicos (2026-10-12, en local)

- **Por qué**: `lib/env.ts` lo importa también el cliente del navegador
  (`lib/supabase/client.ts`) y tenía, a nivel de módulo, el esquema Zod de
  `SUPABASE_SERVICE_ROLE_KEY`. El build de E1 lo metía en un chunk de
  `.next/static`: el **nombre** de la variable, no su valor.
- **Separación**: la validación y `getServiceRoleKey()` pasan a
  `lib/env.server.ts` (`import "server-only"`). Solo lo importa
  `lib/supabase/admin.ts`, y `lib/env.ts` queda solo con la configuración
  pública. El comportamiento del cliente admin y los mensajes de error no
  cambian.
- **Tests estáticos**:
  - `admin-client-usage`: la clave solo la leen `lib/env.server.ts` y
    `lib/supabase/admin.ts`; `lib/env.ts` no la menciona; solo el cliente
    admin importa `lib/env.server`, de cualquier forma; ningún componente de
    cliente lo importa; `lib/env.server.ts` empieza por `server-only`.
  - `env`: `lib/env.ts` solo exporta `getPublicEnv` y `formatEnvIssues`.
  - `validation-infra`: la regla que prohíbe la clave en los specs de E1
    sigue igual para todos menos D1. D1, la única excepción, tiene la suya,
    más estricta:
    - solo puede mencionar service_role en la importación de la clave
      ficticia, su uso como aguja y el nombre de la variable;
    - importaciones fijas: `fs` de solo lectura, `path`, Playwright y, de
      `mock-config.mjs`, solo esa clave;
    - sin `process`, red, fixtures de navegador, escritura en disco ni
      consola.
- **D1** (`tests/e2e/local/no-service-key-in-client.spec.ts`, 2 tests): corre
  dentro de E1, sobre el build que hace el `webServer` con las variables
  ficticias. Comprueba la estructura del build:
  - `.next/BUILD_ID` válido y citado por `build-manifest.json`
    (`static/<BUILD_ID>/_buildManifest.js`);
  - `.next/static` con archivos y chunks de JavaScript, y todo lo que lista
    el manifiesto entre lo inspeccionado;
  - HTML prerenderizado;
  - nada comprimido ni enlaces simbólicos.

  Después lee byte a byte, sin decodificar, todo `.next/static` y el HTML y
  los RSC prerenderizados de `.next/server/{app,pages}`. Busca el valor
  ficticio de la clave y el nombre de la variable, en UTF-8 y en UTF-16 (LE y
  BE), y solo informa del tipo de coincidencia y de la ruta relativa.
- **Qué no es**: un control estático de exposición accidental sobre el build
  de E1. No mira el HTML que se genera en cada petición, ni otros entornos,
  ni la clave real, ni Supabase. La validación con la clave real en un
  entorno desplegado (staging) sigue pendiente.
- **Resultados en local** (cloud de Claude Code, Chromium 1194; orientativo):
  - `format:check`, `lint` y `typecheck` limpios; `npm run test` 1030/1030;
  - E1 32/32, con los 2 de D1;
  - en el build de E1, ni el valor ni el nombre aparecen en los 24 archivos
    de `.next/static` ni en los 22 HTML y RSC prerenderizados. El nombre sí
    está en el código de servidor (`.next/server/chunks`), como debe.
- **Controles negativos** (temporales y restaurados):
  - D1 sobre una copia del build: falla con el valor o el nombre en un chunk,
    en el HTML, en un RSC anidado, en UTF-16 en un binario de media o en un
    manifiesto, y con un archivo nuevo. También falla con `.next/static`
    vacío, sin `BUILD_ID` o con el de otro build, sin un chunk del
    manifiesto, con un archivo comprimido o con un enlace simbólico. En
    ninguno de esos casos la salida ni `test-results` contienen el valor.
  - D1 sobre el build real: con el esquema de la clave de vuelta en
    `lib/env.ts`, falla y señala el chunk.
  - Build: importar `lib/env.server` desde `lib/supabase/client.ts` lo hace
    fallar (`server-only`).
  - `validation-infra` falla en 17 casos: el spec de D1 con `process.env`,
    `fetch`, las fixtures `page` o `request`, la URL del mock importada,
    `import()`, `require`, `node:net`, la clave en `Authorization: Bearer`,
    `auth.admin`, `@supabase/supabase-js`, la clave escrita en el spec, una
    mención más, `writeFileSync` o `console`; otro spec de E1 con la clave; y
    D1 con otro nombre de archivo.
  - `admin-client-usage` y `env` fallan en 8 casos: el esquema de vuelta en
    `lib/env.ts`, `lib/env.ts` reexportando la configuración privada, el
    cliente del navegador importándola (con `from`, solo por efecto o con
    `import()`), `lib/env.server.ts` sin `server-only`, el cliente admin
    leyendo `process.env` y otro módulo leyendo la clave.

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
| `13_profiles_privacy.sql` (Fase 2.9, H4) | que un usuario autenticado lea el perfil de otro (por id, por `date_of_birth` u otras columnas); que pierda la lectura de su propio perfil, también eliminado; que un admin activo deje de leer todos, incluida la fecha de nacimiento, o que uno eliminado los lea; que anon lea alguno; que `public_profile_previews` deje de devolver el nombre de otros, muestre cuentas eliminadas o exponga `date_of_birth` (columnas exactas); que `profiles` no tenga exactamente sus 4 políticas o haya otra que dé lectura; que no sean 44 políticas en `public` (37 hasta la 4.0) |
| `15_rooms_integrity.sql` (Fase 4.0) | que una cuenta desactivada, también a mitad de sesión con el mismo JWT, cree, modifique o borre habitaciones, direcciones exactas o imágenes; que otro usuario escriba en filas ajenas aunque las vea; que otro usuario o `anon` lean la dirección exacta, o que la propietaria desactivada deje de leer las suyas; que `anon` cree habitaciones; que un propietario activo, un admin activo o `service_role` pierdan lo que podían hacer; que cambie la lectura pública (una habitación activa de una cuenta desactivada sigue siendo pública, R7); que las tres tablas no tengan exactamente sus 14 políticas, o que una de escritura no sea de `authenticated`, no exija propiedad y cuenta activa en todas sus expresiones o no cualifique `room_id`; que una de lectura consulte `profiles`. Cada rechazo exige 42501 y cada INSERT rechazado se repite con los mismos datos y entra; RI9 comprueba que, con la condición anterior a la 4.0, la cuenta desactivada volvería a escribir |
| `18_neighborhoods_catalog.sql` (Fase 4.1, R1) | que falte, sobre o cambie (slug o nombre) alguno de los 73 barrios oficiales de Barcelona, o que tengan coordenadas; que Barcelona no exista una sola vez con los valores del seed o que el seed no termine después de la migración; que otro barrio de Barcelona repita el nombre de uno oficial con otro slug; que la huella no sea la de P1; que un usuario sin rol admin o `anon` añada, renombre o borre barrios; que un barrio oficial no sirva para publicar una habitación de Barcelona, o sirva para una de Madrid; que las preferencias no lo acepten con su ciudad, o lo acepten con otra; que se borre uno en uso. No exige que Barcelona tenga solo 73: en local, las demás pruebas dejan barrios sintéticos (eso lo exigen P1 y el selftest) |
| `17_rooms_status_transitions.sql` (Fase 4.1, R7) | que la propietaria activa deje de poder mover su habitación entre `draft`, `active`, `paused` y `rented`, o que pueda entrar o salir de `removed`, también con un UPDATE directo; que publique o reactive una habitación incompleta, o que una activa quede incompleta; que el cliente fije `status` al crear; que una cuenta desactivada cambie el estado; que un admin activo o `service_role` pierdan alguna transición; que `anon` escriba. Cada celda distingue el trigger, el CHECK, el GRANT y la RLS, y los controles prueban que los fixtures aceptan lo que se rechaza |
| `16_rooms_publication.sql` (Fase 4.1) | que una habitación tenga un barrio de otra ciudad (al crear, al cambiar el barrio o solo la ciudad) o que un barrio en uso cambie de ciudad o se borre; que `features` acepte claves fuera del catálogo, repetidas, con otras mayúsculas o `NULL`, o deje de aceptar alguna de las 12 o el array vacío; que la ocupación admita negativos o `total_rooms = 0`; que se publique o quede `active` una habitación sin barrio u ocupación, o que un borrador deje de poder estar incompleto; que el cliente fije `status` al crear, o escriba `deleted_at`, las fechas, `approx_lat`/`approx_lng`, `id` u `owner_id`; que `anon` escriba o `service_role` pierda la tabla completa; que una cuenta desactivada publique. Las reglas valen también para un admin y `service_role`. RK comprueba que, sin cada restricción, la escritura rechazada entraría |
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

La CI tampoco ejecuta `npm run test:supabase` (la api-suite real, SVC/GC
incluidos). `lint` y `typecheck` cubren `tests/integration/` y
`vitest.integration.config.ts`, pero esas pruebas solo corren en el
workflow manual.
