# Seguridad — ROOMLY

Prioridad alta desde el día uno (sección 28 del brief). Este documento
recoge los principios; las decisiones concretas de esquema/RLS ya
corregidas están en `docs/DATABASE.md`.

## Cobertura de los requisitos de RLS pedidos

| Requisito pedido | Políticas que lo cumplen |
|---|---|
| Usuarios solo modifican sus propios datos | `profiles_update_own`, `housing_preferences_{insert,update,delete}_own` (las dos, solo con la cuenta activa desde `20260930130000`), `favorites_own`, `interests_insert_own`/`interests_delete_own`, `participants_update_own` |
| Mensajes solo accesibles por participantes | `messages_select_participant`, `messages_insert_participant`, `conversations_select_participant`, `participants_select_own_conversations`, todas vía `is_conversation_participant()` — un tercero no puede leer ni escribir aunque conozca el UUID de la conversación. **Hasta la migración `20260926120000_security_fixes.sql` esto NO era cierto** (ver "Correcciones de la auditoría inicial" abajo) |
| Habitaciones editables solo por su propietario | `rooms_{insert,update,delete}_own`, `room_addresses_{insert,update,delete}_own` y `room_images_{insert,update,delete}_own`, solo con la cuenta activa desde la Fase 4.0 (antes, `rooms_owner_write`, `room_addresses_owner_only` y `room_images_owner_write`, FOR ALL). Desde la Fase 4.1, en `rooms` solo las columnas del GRANT: sin `status` al crear, ni `deleted_at`, fechas, `approx_lat`/`approx_lng`, ni `id`/`owner_id` al editar. La dirección exacta va un paso más allá: `room_addresses_select_own`, ni siquiera visible para otros usuarios autenticados |
| Administración separada | Todas las tablas sensibles tienen una política `*_admin_all` vía `is_admin()`, y `/admin` se comprueba además en el servidor — nunca solo RLS, nunca solo ocultar el enlace en el cliente |
| Respuestas del test (Fase 3.1) | `compatibility_responses_select_own`: `authenticated` solo **lee** su fila; no tiene INSERT, UPDATE ni DELETE (GRANT). `anon`, ningún privilegio. Solo escribe el servidor (service_role, `lib/services/compatibility.ts`), y el trigger `trg_compatibility_responses_integrity` aplica S1–S6 y el bloqueo de cuentas eliminadas a todos los roles |
| Información privada protegida | `profiles`: cada usuario lee solo su perfil y un admin activo todos (desde la Fase 2.9, H4; antes bastaba con tener sesión); los datos públicos de otros, en la vista `public_profile_previews`; `room_addresses` solo el propietario; un usuario reportado no tiene ninguna política de SELECT sobre `reports`, así que no puede saber quién lo reportó |

Las políticas (38 desde `20260930130000`, 37 desde `20261004120100`) están en
`supabase/migrations/20260925120100_rls_policies.sql`, con 8 de ellas
redefinidas en `supabase/migrations/20260926120000_security_fixes.sql` y
las de `housing_preferences` y `profiles_update_own` rehechas en las
migraciones de Fase 2 —
esta tabla es el mapa de lectura rápida, no la fuente de la verdad. Los
tests de regresión de seguridad están en `tests/db/` (ver
`docs/TESTING.md`).

## Correcciones de la auditoría inicial (2026-09-26)

Auditoría en Claude Code con las migraciones aplicadas en PostgreSQL 16
real (sobre un shim mínimo de Supabase) y cada hallazgo demostrado con un
ataque, no solo leyendo el SQL. Corregido en una migración nueva
(`20260926120000_security_fixes.sql`); las dos anteriores quedan intactas.

| ID | Hallazgo demostrado | Corrección |
|---|---|---|
| C1 | La corrección de la sesión 3 cerró el `UPDATE` de `profiles.role`, pero no el `INSERT`: `profiles_insert_own` solo exigía `auth.uid() = id`, así que cualquier usuario podía crear su propio perfil con `role = 'admin'` y `is_admin()` devolvía `true`. | `GRANT INSERT` por columnas en `profiles` (sin `role` ni `deleted_at`: se aplica el default `user`) **y** `with check (role = 'user' and deleted_at is null)` en la política. `profiles_update_own` gana `with check`. `anon` pierde `INSERT`/`UPDATE` en `profiles`. |
| C2 | En `messages_select_participant`/`messages_insert_participant`, el `conversation_id` sin cualificar de la subconsulta se resolvía contra `cp` (`cp.conversation_id = cp.conversation_id`, siempre cierto): participar en una conversación daba lectura y escritura en **todas**. | Columnas siempre cualificadas y comprobación centralizada en `public.is_conversation_participant(uuid)`. |
| C3 | `participants_select_own_conversations` consultaba su propia tabla: `infinite recursion detected in policy` en cualquier lectura del chat. | La misma función: al ser `SECURITY DEFINER` la subconsulta no reevalúa RLS, así que no hay recursión. |
| H5 | El propietario podía volver a poner `active` una habitación que un admin había marcado `removed`: la moderación no tenía efecto. | Trigger `trg_rooms_moderation` (RLS no ve el valor anterior de la fila): cambiar el estado desde o hacia `removed` exige `is_admin()` o el servidor (`service_role`). El resto de la edición del propietario no cambia. |
| M2 | Quien creaba un reporte podía fijar `status = 'resolved'`, `resolved_by`, `resolution_notes`, `resolved_at`. | `GRANT INSERT` por columnas en `reports` (solo `reporter_id`, `reported_user_id`, `reported_room_id`, `reason`, `description`) y `with check` que exige `status = 'pending'` y campos de resolución nulos. |

**Por qué `is_conversation_participant()` es segura siendo `SECURITY
DEFINER`**: no recibe ningún identificador de usuario — la identidad sale
siempre de `auth.uid()`, así que solo responde "¿participo *yo* en esta
conversación?" y no sirve para sondear a terceros; `search_path` vacío y
todos los nombres cualificados con su schema; `EXECUTE` revocado a
`PUBLIC` y `anon`, concedido solo a `authenticated`; `STABLE`, sin SQL
dinámico. Se ejecuta como el dueño de la tabla (el rol de migraciones),
por eso no reevalúa RLS sobre `conversation_participants`.

**Consecuencia de diseño (a tener en cuenta en Fase 2/7)**: como `role` y
`deleted_at` no están en los `GRANT` de `authenticated`, un admin tampoco
puede cambiarlos desde el cliente — la comprobación del GRANT es por rol
de Postgres, no por `is_admin()`. Cambiar el rol de alguien o
borrar/restaurar una cuenta tiene que hacerse desde el servidor con
`service_role`, tras comprobar en el servidor que quien lo pide es admin.
Lo mismo aplica a quien quiera crear el primer admin: se hace desde el
servidor o desde el SQL editor, nunca desde la app.

**Decisión técnica en H5**: el propietario tampoco puede poner él mismo
`removed` (no podría deshacerlo); para retirar su anuncio tiene `paused`
o el soft-delete (`deleted_at`). `removed` queda como estado de
moderación. **Actualización (Fase 4.1):** `deleted_at` ya no está en el GRANT
de `authenticated`, así que el borrado lógico es del servidor; el propietario
retira su anuncio con `paused` o borrándolo (ver «Fase 4.1», abajo).

## Fase 2.0 — permisos de `housing_preferences` (2026-09-29)

Migración `20260929120000_phase2_data_hardening.sql`. Mismo patrón que
`profiles`: RLS filtra filas y el GRANT limita columnas; las dos capas
son independientes.

- `anon`: `revoke all`. Antes RLS ya lo bloqueaba (`auth.uid()` nulo);
  ahora tampoco tiene el privilegio.
- `authenticated`, **INSERT**: solo columnas de datos (`profile_id`,
  `city_id`, `university_id`, `field_of_study`, presupuesto, fechas,
  barrios, compañeros). `updated_at` la pone la base de datos.
- `authenticated`, **UPDATE**: las mismas **sin `profile_id`**. Una fila no
  se puede reasignar a otra persona, aunque RLS fallara.
- SELECT y DELETE: sin cambios, sujetos a RLS (solo la propia fila).
- Política `housing_preferences_own`: mismo alcance, ahora `to
  authenticated` y con `using` **y** `with check` explícitos (antes el
  `with check` era implícito), con columnas cualificadas. Siguen siendo 35
  políticas.
- Admin: esta tabla no tenía ni tiene política de admin. Por el GRANT, un
  admin desde el cliente tampoco puede reasignar `profile_id`; lo
  administrativo se hace desde el servidor con `service_role`.

**Triggers de integridad de barrios** (detalle en `docs/DATABASE.md`
§"Fase 2.0"):
- `enforce_housing_preferences_neighborhoods()` es `SECURITY INVOKER` (el
  default): solo lee `neighborhoods`, que es de lectura pública. Se ejecuta
  con los permisos de quien escribe, así que no sirve para saltarse RLS.
- `enforce_neighborhood_not_referenced()` es `SECURITY DEFINER` a
  propósito. `housing_preferences` solo la lee su propietario, y con los
  permisos de un admin autenticado la comprobación no vería las
  preferencias ajenas y dejaría borrar un barrio en uso (lo demuestra la
  mutación: sin `SECURITY DEFINER` falla `HP-inv4`). Es segura porque:
  - solo puede ejecutarse como trigger;
  - no recibe parámetros del usuario;
  - solo responde «¿se usa este barrio?», con un error sin datos de terceros;
  - `search_path` vacío y nombres cualificados;
  - sin SQL dinámico;
  - `EXECUTE` revocado a `PUBLIC`, `anon` y `authenticated`.
- Ninguno de los dos triggers escribe datos: solo validan y rechazan.
  Administrar barrios sigue siendo cosa de admin (RLS de referencia); un
  usuario normal no puede borrar ni editar barrios.

Tests: `tests/db/05_housing_preferences.sql` (crear y editar las propias;
no crear, ver, editar, borrar ni reasignar las ajenas; upsert rechazado;
presupuesto y compañeros no negativos con mínimo ≤ máximo (sin techos, por
decisión de producto), textos, FKs; barrios inexistentes, `NULL` o de otra
ciudad;
integridad inversa como servidor y como admin; `anon` sin acceso) y
`tests/db/06_profiles_constraints.sql` (límites de `profiles`,
`chk_min_age`, y `role`/`deleted_at` siguen protegidos).

Fuera de la Fase 2.0: Storage (avatares), borrado de cuenta (H6),
Auth/`?next=` (M6) y UI.

## Fase 2.2 — enrutamiento de autenticación (2026-09-29)

- **Redirects y open redirect**: todo destino sale de
  `lib/auth/destination.ts`. `next` pasa siempre por `getSafeRedirectPath`
  (H1, sin cambios) y además no puede apuntar a `/login`, `/callback`,
  `/registro`, `/bienvenida/*` ni `/cuenta-desactivada` (se comprueba sin
  barra final, en minúsculas y descodificado), así que no hay bucles ni
  forma de saltarse la decisión por estado.
- **`next` en cookie (M6)**: `roomly_next` guarda solo una ruta interna ya
  saneada (1 h, `SameSite=Lax`, `Secure` en https). No es HttpOnly porque la
  escribe el formulario, pero no contiene nada sensible y se vuelve a sanear
  al leerla; el callback la borra siempre. El callback ya no acepta `next`
  por query. Sin cambios en la configuración de Supabase.
- **Errores**: `/login` y el callback solo muestran códigos propios con
  mensajes fijos (`lib/auth/login-errors.ts`). Nunca se muestra
  `error.message` de Supabase ni se reenvía `error_description`; cualquier
  otro `?error=` se ignora.
- **Cuentas eliminadas**: `deleted` tiene prioridad en todos los guards y
  lleva a `/cuenta-desactivada`, que no ofrece reactivación.
- **`/admin`**: `requireAdmin` exige `role = 'admin'` **y** `deleted_at`
  nulo (antes solo se miraba el rol: un admin eliminado veía el panel). Es
  una protección de routing/UI; `is_admin()` sigue siendo la defensa de los
  datos en la base de datos.
- **Regla nueva: el guard va en cada página, no solo en el layout.** Next.js
  renderiza layout y página en paralelo: con el guard solo en
  `app/admin/layout.tsx`, el contenido de la página viajaba en el cuerpo de
  la respuesta 307 a usuarios no admin (comprobado con `curl`; ya pasaba en
  Fase 1). Toda página protegida llama a su guard antes de cargar o
  renderizar nada; `cache()` evita repetir la consulta.
- **`proxy.ts`**: solo refresca la sesión y bloquea a anónimos en `/admin`,
  `/perfil`, `/ajustes`, `/bienvenida` y `/cuenta-desactivada` (prefijo
  exacto). No consulta la base de datos (lo comprueba
  `tests/unit/auth-proxy.test.ts`).
- **Logout**: Server Action (`app/actions/auth.ts`), con la comprobación de
  origen de Next.js; una petición con otro `Origin` se aborta. Sin
  service_role.

## Fase 2.3 — onboarding (2026-09-30)

- **Escrituras solo por Server Action** (`app/actions/onboarding.ts`): cada
  acción vuelve a comprobar el paso con `requireOnboardingStep` (no basta con
  el guard de la página) y delega en los servicios de 2.1. El usuario sale
  de la sesión; `profile_id` nunca llega del formulario.
- **Campos protegidos**: `lib/validation/form-data.ts` conserva las claves
  inesperadas para que los esquemas `strict` las rechacen, así que un
  `profile_id`, `role`, `deleted_at` u `onboarding_completed_at` inyectado
  devuelve error y no se escribe nada (lo cubren tests y una mutación). Los
  valores que se devuelven para rellenar el formulario son solo los de los
  campos conocidos.
- **`onboarding_completed_at`**: en la aplicación solo lo fija
  `completeOnboarding` (idempotente: `UPDATE ... WHERE onboarding_completed_at
  IS NULL`). `authenticated` mantiene el GRANT sobre la columna, así que por
  PostgREST también se puede escribir, pero el trigger
  `trg_profiles_onboarding_completion` impide ponerlo a no nulo sin
  preferencias con ciudad, venga de donde venga. Reescribir el timestamp o
  volver a ponerlo a nulo por PostgREST solo afectaba al propio usuario
  (riesgo aceptado en 2.3, ver `PROGRESS.md`). **Ya no: desde la Fase 2.9**
  (`20261004120000`, sección siguiente) ningún rol puede cambiarlo una vez
  fijado. La
  función es `SECURITY INVOKER`, con `search_path` vacío y `EXECUTE`
  revocado a `PUBLIC`, `anon` y `authenticated` (no se puede llamar
  directamente).
- **`seeking_status`** sin DEFAULT: ningún perfil nace con un valor que el
  usuario no haya enviado; la UI no preselecciona ninguna opción.
- **Cuentas eliminadas**: guards, acciones y servicios devuelven `deleted`
  sin escribir nada; nunca se reactivan. En 2.3 era solo una barrera de
  aplicación; desde `20260930130000` también la impone RLS (sección
  siguiente).
- **Universidad y ciudad**: `checkUniversityCity`
  (`lib/services/housing-preferences.ts`) rechaza una universidad de otra
  ciudad antes de escribir; los barrios ya los valida el trigger de 2.0.
- **Errores**: solo errores de campo y mensajes propios; ningún texto de
  Supabase llega a la UI.
- **Contenido en redirects**: los guards van en cada página de onboarding;
  comprobado con `curl` que ningún 307 lleva el formulario en el cuerpo.
- Sin `service_role`, sin `select("*")`, sin `upsert`. Los datos de
  referencia (ciudades, universidades, barrios) se leen con el cliente
  normal: son tablas de lectura pública.

## Fase 2.9 — `onboarding_completed_at` de una sola escritura (2026-10-04)

Punto A de la auditoría de 2.3, en la migración incremental
`20261004120000_onboarding_write_once.sql` (sin tocar migraciones
históricas). H4 es la otra parte de la 2.9 (sección siguiente).

- **Regla**: una vez no nulo, `profiles.onboarding_completed_at` no cambia.
  Timestamp → `NULL` y timestamp → otro timestamp se rechazan con `23514`
  `onboarding_locked:`; reescribir el mismo timestamp se permite.
- **Sin bypass**: se aplica a `authenticated`, admin, `service_role` y el
  dueño de las tablas (decisión D1). Volver a `NULL` no lo esquiva, ni tras
  borrar las preferencias.
- **Mecanismo**: se reutiliza el trigger existente
  `trg_profiles_onboarding_completion`; solo se redefine su función con
  `create or replace`. Sigue `SECURITY INVOKER` (no da privilegios), con
  `search_path` vacío y nombres cualificados, y con `EXECUTE` revocado a
  `PUBLIC`, `anon` y `authenticated`. Sin cambios de RLS ni de GRANT:
  `authenticated` conserva el GRANT de UPDATE de la columna, que necesita
  `completeOnboarding`, y este no cambia.
- **Límites**: borrar el perfil y recrearlo (solo admin o `service_role`)
  reinicia en la práctica el onboarding; desactivar el trigger como
  superusuario queda fuera del alcance; el mock de E1 no emula el bloqueo
  (la aplicación nunca reinicia un onboarding).
- Tests: `tests/db/07_onboarding_integrity.sql` (OB5b, OB11–OB14), en verde
  también en Supabase real (`roomly-validation-2b`, runs 13 y 15).

## Fase 3 — compatibilidad: escritura solo en el servidor y service_role acotado (2026-10-07)

Especificación cerrada de la Fase 3 (D17, D18 y D6 = B), integrada en
`master` con el PR #7 (`f34b2c8`). En Supabase real (`roomly-validation-3`,
detalle en `docs/SUPABASE_VALIDATION.md`):
- **Validado:**
  - la RLS, los triggers y la escritura del test (suite SQL 01–14 y
    CRA1–CRA6), en los runs 16 (`37994799026`) y 18 (`37999470912`), los
    dos del 2026-10-09;
  - los servicios `saveQuestionnaireAnswers` y `getCandidates`, llamados
    desde el runner con service_role inyectado, en el run 19
    (`38106687478`, 2026-10-11): SVC 6/6 y GC 4/4.
- **Sin validar:** el runtime de Next.js desplegado con la clave real (ver
  «Riesgo aceptado», abajo).

**Principio** (decisión 25 de la especificación):
> Las respuestas del test y su estado solo los escribe el servidor, después
> de validarlos contra la definición que vive en el código. Cada usuario solo
> puede leer su propia fila. Toda lectura de datos ajenos pasa por
> `lib/services/matching.ts`, con columnas explícitas y un DTO con lista
> blanca. Ninguna respuesta cruda ni puntuación por categoría sale del
> servidor. service_role solo se usa en los servicios autorizados.

- **`compatibility_responses`** (`20261007120000`):
  - `anon`: sin acceso;
  - `authenticated`: solo SELECT de su fila;
  - el trigger aplica S1–S6 y bloquea cuentas eliminadas para todos los
    roles, también service_role. El bloqueo RLS de cuentas eliminadas
    (`20260930130000`) no sirve aquí, porque service_role tiene BYPASSRLS.

  `completed_at` y `questionnaire_version` no se pueden falsificar desde el
  cliente: no hay privilegio de escritura y el esquema Zod estricto rechaza
  `profile_id`, `questionnaire_version` y `completed_at`. `profile_id` sale
  siempre de `getSessionUserId()` (`auth.getUser()`). Ver
  `docs/DATABASE.md` §"Fase 3.1".
- **service_role en el servidor de la app (D17)**, solo en dos servicios
  `server-only`:
  - `lib/services/matching.ts`: lectura cruzada de candidatos;
  - `lib/services/compatibility.ts`: escritura del test.

  `tests/unit/admin-client-usage.test.ts` lo comprueba: ningún otro archivo
  importa `lib/supabase/admin` ni usa `createAdminClient()`; la clave solo la
  leen `lib/env.server.ts` y `lib/supabase/admin.ts`; ningún componente de
  cliente importa servicios ni `lib/env.server`; ninguna variable
  `NEXT_PUBLIC_*` lleva service_role. El estado propio se lee siempre con el
  cliente del usuario.
- **Configuración privada aparte (`lib/env.server.ts`)**: la validación y la
  lectura de `SUPABASE_SERVICE_ROLE_KEY` (`getServiceRoleKey()`) viven en un
  módulo `server-only`, y solo lo importa `lib/supabase/admin.ts`.
  `lib/env.ts` queda solo con la configuración pública (`getPublicEnv()`).
  - Por qué: `lib/env.ts` lo importa también el cliente del navegador
    (`lib/supabase/client.ts`). Antes de la separación tenía además el
    esquema Zod de la clave, a nivel de módulo, y el build lo metía en un
    chunk público de `.next/static`: llegaba el **nombre** de la variable,
    no su valor (las variables sin `NEXT_PUBLIC_` no se incrustan en el
    cliente).
  - Ahora un import desde el cliente hace fallar el build (`server-only`).
  - **D1** (`tests/e2e/local/no-service-key-in-client.spec.ts`, dentro de
    E1) busca en el build de E1 la clave ficticia del mock y el nombre de la
    variable (ver `docs/TESTING.md`). Es un control de exposición accidental
    sobre ese build: no valida otros entornos ni la clave real.
- **Fallo cerrado**: si falta `SUPABASE_SERVICE_ROLE_KEY`, `getServiceRoleKey()`
  lanza y `/explorar` o el guardado del test muestran el error genérico de
  la 2.7 (`app/error.tsx`), sin datos ni mensaje técnico. `/test` se abre
  igual, porque solo lee con el cliente del usuario.
- **DTO de `/explorar`** (`CandidateDTO`, construido campo a campo):
  - incluye id, `full_name`, edad, universidad, hasta 3 barrios y el total,
    presupuesto en escalones de 50 €, score y textos;
  - **nunca** incluye respuestas, `categoryScores`, `date_of_birth`,
    presupuestos exactos, fechas, `seeking_status`, `bio`, email, `role`,
    `deleted_at`, avatar ni ids de preferencias.

  La consulta cruzada proyecta columnas explícitas, sin `bio`, email, avatar
  ni `seeking_status`.
- **Explicaciones**: por categoría, sin cifras. La dirección solo aparece en
  Horarios y Ruido, con signos concordantes. Riesgo residual aceptado (D11).
- **Navegación**: `/test` y `/explorar` están en `PROTECTED_PREFIXES`, con su
  guard en cada página. `/test` nunca redirige según el estado del test, así
  que no hay bucle con `/explorar`. El onboarding termina siempre en `/test`
  y no usa `next` para saltárselo (D5).
- **Validación real (D6 = B)**: la app del workflow de validación sigue sin
  service_role (`docs/ENVIRONMENT.md`). La escritura del test se valida con
  la suite SQL (`tests/db/14`), la api-suite (CRA1–CRA6, service_role desde
  el runner, nunca desde la app ni Playwright) y E1.
  - En E1 la app recibe la clave service_role **ficticia** del mock
    (`MOCK_SERVICE_ROLE_KEY`); el test estático lo limita a ese valor.
  - **Riesgo aceptado**: la combinación «Next en ejecución + cliente admin»
    contra un Supabase real se verá por primera vez al desplegar.
- **Pendiente antes de usar el producto con personas reales** (decisión del
  propietario del 2026-10-13). No son condiciones del cierre técnico de la
  Fase 3 (`docs/ROADMAP.md`, «Alcance del cierre») y siguen sin resolver:
  - **Datos de tabaco y vapeo: REQUIERE REVISIÓN LEGAL.**
    - `smoke_own` («¿Fumas o vapeas?») y `smoke_tolerance` son obligatorias
      y se guardan en `compatibility_responses.answers`.
    - Las frases de Fumar de `/explorar` pueden dejar intuir la respuesta
      del otro (D11).
    - Falta el criterio legal sobre el tipo de dato, la base jurídica, la
      información o el consentimiento, la conservación y si la pregunta debe
      seguir siendo obligatoria. Ningún test técnico lo resuelve.
  - **Acceso operativo a las respuestas, antes del lanzamiento.**
    - Dentro de la app, el acceso está acotado y probado: CR5–CR9 de
      `tests/db/14`, `admin-client-usage` y el DTO con lista blanca.
    - Fuera de ella, quien tenga acceso al proyecto de Supabase o a la clave
      service_role puede leer las respuestas en claro.
    - Falta revisar quién tiene ese acceso y con qué procedimientos. No se
      ha hecho ninguna auditoría operativa.

## Fase 4.0 — habitaciones: escrituras bloqueadas para cuentas desactivadas (2026-10-13)

Migración `20261013120000_rooms_deleted_account_writes.sql`. Aplica a
`rooms`, `room_addresses` y `room_images` la regla de las cuentas
eliminadas («Cuentas eliminadas: escrituras bloqueadas en RLS», abajo):
`deleted_at IS NOT NULL` es una cuenta desactivada, y la base de datos le
impide escribir, no solo la aplicación.

- **Qué cambia:** cada política FOR ALL del propietario
  (`rooms_owner_write`, `room_addresses_owner_only` y
  `room_images_owner_write`) se divide por comando, `to authenticated`.
  - Las de INSERT, UPDATE y DELETE exigen la misma propiedad que antes y,
    además, que el perfil del propietario exista y no tenga `deleted_at`.
    El UPDATE lo exige en USING y en WITH CHECK.
  - El INSERT de una cuenta desactivada se rechaza con `42501` («new row
    violates row-level security policy»). Su UPDATE y su DELETE afectan a 0
    filas.
- **No depende del JWT:** la RLS lee `deleted_at` en cada consulta. Un token
  emitido antes de desactivar la cuenta ya no escribe (RD2–RD4, sin volver a
  hacer login).
- **Sin cambios:**
  - la lectura: `rooms_select_active_public`, `rooms_select_own`,
    `room_images_select`, y `room_addresses_select_own` con la condición de
    antes. El propietario desactivado sigue viendo sus filas;
  - `rooms_admin_all` (un admin activo sigue moderando) y el trigger de
    moderación;
  - GRANT, funciones y triggers;
  - `service_role` (BYPASSRLS), que conserva sus escrituras. Esta tarea no
    añade ningún uso del cliente admin (D17 sigue en dos servicios).
- **Pendiente, a propósito:** las habitaciones activas de una cuenta
  desactivada siguen siendo públicas. Ocultarlas es la decisión R7.
- **Sin recursión:** las políticas leen `profiles` (el usuario lee su propia
  fila aunque esté eliminada) y `rooms`. Ninguna política de `profiles`
  consulta tablas de habitaciones, ni las de `rooms` consultan
  `room_addresses` o `room_images`. Si la lectura del propio perfil se
  quitara, la condición fallaría cerrada. Todas las columnas van
  cualificadas.
- **Tests:**
  - `tests/db/15_rooms_integrity.sql`, con estructura, comportamiento y un
    control negativo que reintroduce la condición antigua de forma temporal;
  - P3 del preflight;
  - el camino incremental, en `migration-upgrade-selftest.sh`.

  Detalle en `docs/TESTING.md`. **Sin validar en Supabase real** (R8,
  pendiente).

  **Actualización (2026-10-21): validada en Supabase real en el run 21.** R8
  aplicó la migración en `roomly-validation-3`. Después pasaron el preflight
  (P3: 44 políticas, con las escrituras de habitaciones exigiendo cuenta
  activa), la suite SQL (con `15`) y la api-suite. El E2 no se ejecutó
  (`docs/SUPABASE_VALIDATION.md`, «Resultado: run 21»).

## Fase 4.1 — habitaciones: columnas reservadas al servidor e invariantes (2026-10-15)

Migración `20261015120000_rooms_integrity_publication.sql` (detalle de cada
regla en `docs/DATABASE.md`, «Fase 4.1»). RLS filtra filas y el GRANT limita
columnas; las dos capas son independientes, como en `profiles` y
`housing_preferences`.

- **GRANT por columnas en `rooms`:**
  - `authenticated` ya no tiene INSERT ni UPDATE de tabla completa;
  - al crear no fija `status` (toda habitación nace `draft`), `deleted_at`,
    `created_at`, `updated_at`, `approx_lat` ni `approx_lng`;
  - al editar tampoco `id` ni `owner_id`;
  - `anon` pierde INSERT, UPDATE y DELETE, que la RLS ya le impedía, y
    conserva SELECT;
  - comprobado de forma exacta en P4 y en `tests/db/16` (RS4 y RS5).
- **`status` sigue en el UPDATE de `authenticated`: excepción aprobada (R7,
  opción A, decisión expresa del propietario del 2026-10-15).** Es la única
  columna del ciclo de vida de la habitación que escribe el cliente, y solo
  al editar. No hay RPC, función `SECURITY DEFINER` ni operación privilegiada
  nueva, ni usos nuevos de service_role: D17 no cambia.
  - **Propiedad:** la habitación es de su `owner_id`, que el cliente no puede
    cambiar (fuera del UPDATE). Solo la propietaria con la cuenta activa, o
    un admin activo, cambian su estado (RLS de la 4.0). Una cuenta
    desactivada no lo cambia: 0 filas.
  - **Lo que puede la propietaria:** al crear, nada (nace `draft`); después,
    moverla entre `draft`, `active`, `paused` y `rented`. Para `active`,
    `chk_rooms_publishable` exige barrio y ocupación, para todos los roles.
  - **Límite de la moderación:** solo un admin activo o el servidor entran o
    salen de `removed` (trigger H5, `42501` `room_moderation:`). La
    propietaria no lo pone ni con un UPDATE directo, y no recupera una
    habitación retirada.
  - Matriz completa: `docs/DATABASE.md` («Estado de la habitación») y
    `tests/db/17`.
- **Invariantes para todos los roles**, también admin y service_role: barrio
  de la ciudad de la habitación (FK compuesta), características del catálogo
  sin repetir, ocupación válida y requisitos de publicación (CHECK).
- **Sin cambios:**
  - la RLS de la 4.0 (cuentas desactivadas) y la lectura pública;
  - `room_addresses` y `room_images`;
  - el trigger de moderación;
  - `service_role`: tabla completa, BYPASSRLS. D17 sigue en dos servicios;
  - políticas, triggers y funciones (44, 13 y 11).
- **Consecuencias:**
  - el GRANT es por rol de Postgres: un admin desde el cliente sigue
    moderando (`status`), pero no escribe `deleted_at` ni las coordenadas,
    que serán del servidor (Fase 7 y R2);
  - el propietario ya no hace el borrado lógico (ver H5, arriba);
  - `upsert()` no sirve en esta tabla;
  - la moderación efectiva es solo `removed`: si un admin «oculta» con
    `paused`, como describe `docs/ARCHITECTURE.md`, la propietaria puede
    reactivarla. Y H5 solo vigila `status`: con la habitación en `removed`,
    la propietaria aún edita sus demás columnas o la borra. Ninguna de las dos
    cosas cambia en la 4.1; quedan para la Fase 7 (admin real).
- **Catálogo de barrios oficiales (R1, `20261016120000`):** solo datos; 73
  barrios de Barcelona del Ajuntament de Barcelona (Open Data BCN, CC BY 4.0;
  detalle y atribución en `docs/DATABASE.md`).
  - Sin cambios de permisos: `neighborhoods` se lee en abierto y solo la
    escribe un admin activo (`neighborhoods_admin_write`, Fase 0). Un usuario
    autenticado o `anon` no añade, renombra ni borra barrios (`tests/db/18`).
  - La migración no borra ni transforma datos: ante barrios de Barcelona que
    no coinciden con los oficiales, se detiene (`neighborhoods_r1_precheck:`).
  - P1 del preflight exige exactamente los 73 (número y huella): si el
    catálogo del proyecto de validación cambia, el run se detiene antes de
    las suites.
- **Pendiente:**
  - la visibilidad de las habitaciones de cuentas desactivadas (R7);
  - mostrar la atribución del Ajuntament (CC BY 4.0) en la interfaz donde se
    vean los barrios: es una decisión de producto, sin hacer. **Hecha en
    local en la sesión 69**, con la procedencia verificada en datos.gob.es
    (`docs/DATABASE.md`), salvo en `/explorar`, que queda para decidir;
  - los privilegios `TRUNCATE`, `REFERENCES` y `TRIGGER` de los privilegios
    por defecto de Supabase en `rooms`, que no se han tocado y no son
    alcanzables desde PostgREST.
- **Tests:**
  - `tests/db/16_rooms_publication.sql`, con un control negativo que retira
    cada restricción de forma temporal;
  - `tests/db/17_rooms_status_transitions.sql`: la matriz de transiciones de
    `status` por actor (R7, opción A), con el motivo exacto de cada rechazo y
    controles que prueban que los fixtures son válidos;
  - `tests/db/18_neighborhoods_catalog.sql`: los 73 barrios oficiales,
    Barcelona y el seed, la escritura del catálogo y su uso con las reglas de
    la 4.1;
  - P1 y P4 del preflight y sus mutaciones;
  - `migration-upgrade-selftest.sh`, también la instalación limpia y la carga
    rechazada de R1.

  **Sin validar en Supabase real** (R8).

  **Actualización (2026-10-21): validada en Supabase real en el run 21.** R8
  aplicó `20261015120000` y `20261016120000` en `roomly-validation-3`.
  Después pasaron el preflight (P1 con los 73 barrios y las restricciones de
  `rooms`, P4 con su GRANT), la suite SQL (con `16`–`18`) y RO1–RO9 de la
  api-suite. El E2 no se ejecutó (`docs/SUPABASE_VALIDATION.md`, «Resultado:
  run 21»).

## Fase 4.2 — fotos de habitaciones: Storage, limpieza, URL firmadas y R7 (2026-10-24 y 2026-10-25; reconstruida el 2026-10-29)

Migraciones `20261024120000_room_images_storage_visibility.sql` y
`20261025120000_room_images_private_bucket.sql`, servicio
`lib/services/room-images.ts` y sanitizador
`lib/images/sanitize-room-image.ts`. La implementación original se perdió
sin publicarse; esta es una reconstrucción desde su diseño documentado
(`PROGRESS.md`, sesión 63). **Probada solo en local: sin validar en Supabase
real ni con la API de Storage real.**

**Principio** (D17 ampliada y D1):
> Ningún cliente escribe fotos: ni en `room_images` (sin políticas de
> escritura ni GRANT) ni en `storage.objects` (sin ninguna política). Solo el
> servidor, con service_role, después de comprobar con el cliente del usuario
> la sesión, la cuenta activa, la propiedad y el estado de la habitación, y
> de limpiar la imagen. Las fotos se sirven con URL firmadas de 10 minutos,
> que el servidor solo emite para las filas que el cliente de quien pregunta
> acaba de leer: la autorización es la de la RLS.

**service_role, en cuatro servicios** (D17, `tests/unit/admin-client-usage.test.ts`):
`matching.ts`, `compatibility.ts`, desde la 4.2 `room-images.ts` y, desde la
sesión 65 (D17 ampliada el 2026-10-30), `rooms.ts`.
- `room-images.ts` es el único que usa la API de Storage, el único que emite
  URL de fotos (nunca públicas) y el único que importa el sanitizador; sharp
  solo lo importa el sanitizador.
- `rooms.ts` usa el cliente admin una sola vez, para
  `rpc("delete_own_room")`, después de comprobar con el cliente del usuario
  la sesión, la cuenta activa y la propiedad. Ni tablas ni Storage con ese
  cliente (ver «Borrado de habitaciones»).

**Base de datos** (detalle en `docs/DATABASE.md`, «Fase 4.2»):
- `room_images`: anon y authenticated solo leen. Ruta canónica
  `room_id/id.webp` (CHECK), posición ≥ 0 y un trigger para todos los roles,
  también service_role: solo cambia la posición; ni habitación retirada o
  eliminada ni cuenta desactivada; 8 fotos como mucho, también con subidas
  simultáneas (bloqueo de la fila de la habitación).
- Bucket `room-images`: privado, solo `image/webp` y 5 MiB, sin ninguna
  política en `storage.objects` y ninguna de escritura en `storage.buckets`,
  con la RLS activa en las dos. Ni anon, ni la propietaria, ni un admin lo
  vuelven público (`tests/db/19`, ST1).
- Las migraciones se detienen sin cambiar nada si el estado no es el
  esperado, y distinguen «no se puede comprobar» (falta Storage, sin permiso
  o una RLS que podría ocultar filas al rol) de una comprobación negativa
  (L6_N2). No borran ni cambian políticas preexistentes: dicen cuáles hay.

**Limpieza de la imagen** (EXIF con GPS, marca y modelo, XMP, IPTC, ICC y
comentarios). Se vuelve a codificar desde los píxeles a WebP de calidad 80,
con la orientación aplicada y a 2048 px de lado mayor como mucho, sin pedir
ningún metadato, y la salida se vuelve a leer y se rechaza si le quedara
alguno. Se decide por el contenido, no por el tipo declarado:
- **N1:** antes de llamar a sharp, el formato se reconoce por la firma de los
  primeros bytes (JPEG, PNG con `IHDR` o WebP con su bloque); lo demás (SVG,
  GIF, HEIC/AVIF, TIFF, BMP…) no llega a ningún decodificador de libvips. El
  tipo declarado tiene que coincidir con la firma (`type_mismatch`), y sharp
  tiene que leer el mismo formato que la firma;
- también rechaza imágenes animadas, archivos vacíos, dañados o truncados
  (`failOn: "warning"`), más de 4 MiB a la entrada o a la salida y más de
  40 MP;
- **L3:** no cambia la configuración global de sharp (caché, concurrencia ni
  cargadores), que es del proceso entero;
- no guarda el original ni su nombre, que puede tener datos personales, y no
  registra nada.

Lo prueban `room-image-sanitize` (imágenes generadas con GPS, XMP e ICC),
`room-image-signature` (sharp espiado: no se llama sin firma aceptada) y
`room-image-sharp-globals`, con controles que los hacen fallar.

**URL firmadas** (D1). TTL de 600 s (`ROOM_IMAGE_SIGNED_URL_TTL_SECONDS`) y
`Cache-Control` de 600 s en los objetos, para que ninguna caché guarde una
foto más de lo que vale su URL. `expiresAt` se calcula antes de pedir la
firma. Solo se firman rutas canónicas de esa habitación y solo se aceptan las
URL de rutas pedidas. Sin caché de URL en el servidor: cada lectura vuelve a
leer y a firmar. Si la firma falla (también con una excepción), la lista da
`unknown` y una subida ya guardada sigue siendo un éxito, sin URL. Nunca se
devuelve ni se registra una URL pública o firmada.

**Objetos huérfanos y logs** (M2). El objeto se sube antes de la fila, y
solo se borra tras un rechazo definitivo de la base de datos (SQLSTATE de las
clases 22, 23, 42 y P0) con la fila comprobada como ausente (con el cliente
del usuario, por id, habitación y ruta exactos). Un resultado ambiguo (sin
código, `PGRST…`, conexión, cancelación…) conserva el objeto y avisa. Hay
cinco avisos (`room_image_upload_unconfirmed`,
`room_image_orphan_after_insert`, `room_image_insert_unconfirmed`,
`room_image_insert_unverified` y `room_image_orphan_after_delete`), con solo
el evento y la ruta: nunca el usuario, el nombre del archivo, el contenido,
una URL ni el mensaje de Storage. Al borrar una foto, primero la fila y
después el objeto, y solo el de la ruta canónica de esa fila.

**Conciliación de solo lectura** (D3 de la 4.2; no confundir con la
congelación de D3 de R8): `tests/supabase/room-images-reconcile.sh` compara
los metadatos del bucket con `room_images` y clasifica las diferencias, sin
ningún modo de aplicación y en solo lectura en tres niveles. No comprueba
que el archivo exista físicamente en Storage. Ejecutarlo contra un proyecto
remoto necesita autorización: lee todas las rutas de las fotos.

**R7: visibilidad.** Las habitaciones activas de una cuenta desactivada y sus
fotos dejan de ser públicas (`is_room_publicly_visible`, SECURITY DEFINER con
`search_path` vacío, EXECUTE solo para anon y authenticated). Se oculta al
leer, sin cambiar datos. La propietaria sigue viendo lo suyo, y el admin
activo lee las fotos ocultas con `room_images_admin_select`, que no las hace
públicas ni se aplica a usuarios normales o a un admin desactivado
(`tests/db/20`).

**Server Actions, interfaz y borrado de habitaciones** (sesión 64, en
local). Detalle en «Borrado de habitaciones», abajo.
- `app/actions/room-images.ts` (`uploadRoomPhoto` y `deleteRoomPhoto`) y
  `app/actions/rooms.ts` (`deleteRoom`) son orquestación fina. Del navegador
  solo llegan `roomId` y la foto, o `roomId` e `imageId`: ninguna ruta,
  posición, propietario ni nombre de archivo (el esquema `strict` y la
  propia acción rechazan cualquier otra clave).
- Antes de cualquier operación privilegiada, en este orden: el guard
  (`requireActiveProfile`: sesión y cuenta activa) y el servicio, con el
  cliente del usuario (sesión, cuenta, propiedad, estado de la habitación y 8
  fotos). Una foto de más de 4 MiB se rechaza por su tamaño en la acción y en
  el servicio, sin leer sus bytes; la firma y la limpieza van después. Los
  tests comprueban que en esos rechazos no se crea el cliente admin ni se
  toca Storage.
- `next.config.ts`: `experimental.serverActions.bodySizeLimit = "5mb"` (por
  defecto, 1 MB). Next.js lo aplica al cuerpo crudo mientras lo lee y vale
  para **todas** las Server Actions: no se puede fijar por acción. Por
  encima, Next.js 16.4.3 no ejecuta la acción y responde 500, no 413
  (medido en la sesión 65; ver «Tamaño real de la subida», abajo). Las demás validan sus campos con esquemas `strict` y longitudes
  máximas, así que el riesgo añadido es solo que un cuerpo de hasta 5 MB se
  lea antes de rechazarse. `proxy.ts` copia el cuerpo hasta
  `proxyClientMaxBodySize` (10 MB por defecto, sin cambiar).
- La interfaz (`/habitaciones/[id]/fotos`, `/habitaciones/[id]/borrar` y
  `/habitaciones/borrada`) muestra las fotos solo con las URL firmadas del
  servicio, con `<img>` y `referrerPolicy="no-referrer"`. No usa
  `next/image`: pasaría las URL firmadas por `/_next/image`, que las guardaría
  en caché más de lo que valen y exigiría `images.remotePatterns`. Solo la
  propietaria con la cuenta activa ve los controles de escritura; un admin
  activo solo mira; cualquier otra persona recibe 404, aunque la habitación
  sea pública. Una cuenta desactivada va a `/cuenta-desactivada` antes de
  leer nada. `/habitaciones` está en las rutas protegidas del proxy.

**Riesgos residuales:**
- Una URL firmada filtrada sirve hasta que caduca (como mucho 10 minutos), y
  no se puede revocar antes.
- Por RPC, anon puede preguntar si una habitación es pública, igual que con
  un SELECT. El Security Advisor de Supabase puede avisar de una función
  SECURITY DEFINER ejecutable por anon: está aceptado, sin comprobar.
- La firma de los bytes es un filtro previo, no valida el archivo entero:
  libvips elige su cargador por el contenido (por eso se exige que coincida
  con la firma).
- Desde la sesión 65 una habitación solo se borra por el servidor, que limpia
  Storage. **Riesgo residual aceptado por el propietario (2026-10-30):** la
  cascada desde `profiles` (borrar la cuenta en Auth, o un perfil como admin)
  se lleva las filas de `room_images`, y los objetos quedan huérfanos,
  inaccesibles porque el bucket es privado y no hay filas que firmar. La
  conciliación los detecta, comprobado con la cascada real
  (`room-images-reconcile-selftest.sh`), pero no los borra. Es una
  limitación conocida, no una protección implementada. Ver «Cascadas desde
  profiles y Auth», abajo.
- Tras un resultado ambiguo del INSERT puede quedar un objeto sin fila: lo
  detecta la conciliación, y borrarlo es otra decisión.
- `sharp` es una dependencia directa y exacta (decisión del propietario).
  Desde la sesión 64 está en 0.35.5, que corrige GHSA-wq5f-xc86-pv6w
  (librsvg 2.63.2). Ver «Dependencias», abajo.

**Sin validar:**
- en Supabase real: `roomly-validation-3` sigue en la 4.1. Aplicar la 4.2
  necesita su propia herramienta y su autorización, o un proyecto aislado
  nuevo (D2, `docs/SUPABASE_VALIDATION.md`);
- la API de Storage real (subida con service_role, URL firmadas, listado y
  escritura denegados con el JWT de un usuario), con el CDN de Supabase: en
  local solo hay las tablas del shim;
- si el rol `postgres` de Supabase puede ver todas las filas de
  `storage.buckets` y `storage.objects` (dueño o BYPASSRLS). Si no, las
  migraciones y el preflight se detienen con «no se puede comprobar»;
- si los triggers propios de Storage en Supabase (por ejemplo, contra el
  borrado directo de objetos) cambian lo que espera `tests/db/19`;
- el límite del cuerpo de las peticiones del alojamiento en un despliegue de
  ROOMLY: la subida de 4 MiB se ha medido en local (4 195 232 bytes), no en
  Vercel ni en Netlify (ver «Subida de archivos»);
- las Server Actions y la interfaz con el runtime de Next.js desplegado y la
  API de Storage real: en local, solo los tests unitarios y E1, contra el
  Storage simulado del mock.

## Fase 2.9 — H4: privacidad de `profiles` (2026-10-04)

Migración incremental `20261004120100_profiles_privacy.sql` (decisión D2,
H4-1): elimina `profiles_select_authenticated`, que dejaba a cualquier
usuario autenticado leer la fila completa de cualquier perfil activo,
incluida `date_of_birth`. Pasan de 38 a 37 políticas.

- **Pierde un usuario autenticado**: toda lectura de perfiles ajenos por
  `profiles`, aunque conozca su id: fecha de nacimiento, bio, estado de
  búsqueda, avisos y onboarding.
- **Conserva el propio usuario**: su fila completa, también con la cuenta
  eliminada (`profiles_select_own_even_if_deleted`).
- **Conserva un admin activo**: todos los perfiles (`profiles_admin_all`,
  vía `is_admin()`); un admin con la cuenta eliminada no.
- **anon**: sigue sin leer `profiles`.
- **Datos públicos de otros**: solo `public_profile_previews` (id, nombre,
  avatar, rol), sin `date_of_birth`. Que exponga `role` a anon es H3, sin
  cambios.
- **Contradice la regla de la Fase 0** «`profiles` completo requiere
  sesión»: prevalece esta decisión específica de privacidad.
- Sin cambios en INSERT, UPDATE, DELETE, GRANT, servicios, Server Actions
  ni `types/database.ts`. No hay `service_role` ni `select("*")` nuevos, ni
  `profile_id` que llegue del cliente.
- **Infraestructura de la 2.8 ajustada**, sin cambiar sus guardas:
  - P3 de `tests/supabase/preflight.sql` y sus auto-tests pasan a 37;
  - el runner SQL y su auto-test cuentan 13 archivos;
  - el mock de E1 solo devuelve la fila propia.
- Tests: `tests/db/13_profiles_privacy.sql` (PV1–PV10). `tests/db/12` ya no
  depende de ver la fila ajena: aísla la condición de dueño de
  `profiles_update_own` con una política SELECT temporal dentro de un
  bloque que se deshace, como `11`.
- Validado también en Supabase real (`roomly-validation-2b`) en los runs 13
  y 15 de la 2.8: P3 con 37 políticas y `tests/db/13` en verde.

## Fase 2.8 — infraestructura de validación (2026-09-30; completada el 2026-10-06)

Solo infraestructura de test: sin cambios en la app, RLS, migraciones ni
`/callback`. Se implementó en local el 2026-09-30. La validación real se
completó el 2026-10-06 en `roomly-validation-2b` (`uwxb…`): parte
estructural en el run 13 y E2 real en el run 15 (ver
`docs/SUPABASE_VALIDATION.md`, «Resultado de la Fase 2.8»).
- **Registro de Auth:** se abrió solo para la ventana del E2 y el
  propietario lo cerró después.
- **Sin residuos:** no quedaron usuarios, filas ni mensajes de prueba.
- **Sin atajos:** sin `generateLink` y sin aceptar `token_hash` en
  `/callback`.

- **Identidad del proyecto.** El proyecto de validación nuevo (Fase 3) debe
  llevar `comment on database postgres is 'roomly-validation-3'`. Lo comprueban,
  con comparación exacta y sin fallback:
  - `tests/supabase/guard.sh`;
  - P0 de `preflight.sql`;
  - cada sesión del runner SQL;
  - la api-suite y la preparación y limpieza del E2 (las tres vía
    `guard.sh`);
  - la confirmación del workflow.

  Las marcas de los proyectos anteriores (`roomly-validation`, Fase 1, y
  `roomly-validation-2`, Fase 2.8, `uwxb…`) no pasan, así que sus
  credenciales no sirven contra las guardas nuevas aunque queden secrets
  antiguos en el repositorio o en el Environment anterior.
  `guard-selftest.sh` lo prueba con esas marcas y con variantes, y
  comprueba que migraciones, P0 y suite SQL abortan contra
  `roomly-validation-2`.
- **Secrets.** Viven solo en el GitHub Environment `roomly-validation-3`, y
  todos los jobs del workflow manual lo declaran. Cada paso recibe solo los
  que necesita.
  - `SUPABASE_VALIDATION_SERVICE_ROLE_KEY` llega únicamente a la guarda, a
    la api-suite y a los pasos de preparación y limpieza del E2
    (`tests/e2e/real/cleanup.mjs`).
  - La app (`auth-redirects`, `e2e-real`) se construye y arranca solo con
    `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` y
    `NEXT_PUBLIC_SITE_URL`.
  - El proceso de Playwright no recibe ni `service_role` ni la conexión de
    base de datos.
  - `tests/unit/validation-infra.test.ts` falla si alguno de estos repartos
    cambia.
- **Runner SQL remoto.** Una sesión y una transacción por archivo, siempre
  con `ROLLBACK`; nada persiste en el proyecto.
  - **Antes de conectar, rechaza** cualquier control de transacción no
    previsto, los meta-comandos de `psql` y lo que el validador no sabe
    analizar con seguridad: `$tag$`, `/* */` y cadenas `E'...'`.
  - **Reconoce** comentarios, cadenas `'...'`, identificadores `"..."` y
    cuerpos `$$...$$`. En la auditoría final, un identificador con `'`
    ocultaba un `COMMIT` posterior; se corrigió y tiene test de regresión.
  - Los WARNING hacen fallar la suite. Las salidas de error de conexión no
    se imprimen, porque podrían contener el host.
- **E2 real (alta con email real).**
  - Recorre el formulario, `signInWithOtp`, el email, el magic link y
    `/callback?code=` (PKCE en el mismo navegador). No usa `generateLink`,
    `verifyOtp`, `token_hash` ni contraseñas.
  - Solo abre un enlace que apunte al `/auth/v1/verify` del proyecto
    esperado y vuelva exactamente a `<app>/callback`.
  - No guarda trace, vídeo, capturas, report HTML ni instantánea de página
    (`PLAYWRIGHT_NO_COPY_PROMPT`); no conserva `outputDir` y el job no sube
    artefactos.
  - Los errores se reescriben sin email ni URLs, y la dirección de prueba
    se enmascara en el log.
  - **Limpieza (`if: always()`):**
    - borra solo los usuarios cuyo email encaja entero con la plantilla de
      prueba, como mucho 10 (si hay más, no borra ninguno);
    - comprueba que no quedan perfiles ni preferencias suyos;
    - imprime solo recuentos;
    - el aviso de registro abierto se emite aunque falle el borrado o el
      buzón (`withSignupCheck`), sin ocultar el error original.
- **Registro público.** Solo se abre durante la ventana del E2 real, y lo
  hace el propietario. La preparación falla si está cerrado, y la limpieza
  avisa si sigue abierto. Cerrarlo es manual: automatizarlo exigiría un
  token de la Management API con acceso a toda la cuenta, que no se ha
  añadido.
- **Supabase simulado (E1).** Solo escucha en 127.0.0.1 y su clave anon es
  ficticia. Los endpoints `/__test/*` existen únicamente en el mock, no en
  la app.

## Fase 2.7 — shell y errores (2026-09-30)

- **Errores**: `app/error.tsx` y `app/global-error.tsx` muestran solo un
  mensaje genérico en español y «Reintentar» (`reset`). No leen
  `error.message`, `stack`, `digest` ni `cause`, ni interpolan el objeto
  `error`. Los tests renderizan un error con texto técnico deliberado y
  comprueban el código fuente; las mutaciones que reintroducen
  `error.message`, el digest o el stack fallan.
  - Qué ve el usuario, qué no: con JavaScript, el mensaje genérico. Sin
    JavaScript, un error de servidor da un 500 cuyo único texto visible es
    la cabecera («Roomly»): `error.tsx` es un componente de cliente y
    Next.js solo lo pinta al hidratar. En ningún caso se ve texto técnico.
    El payload RSC de Next.js incluye un `digest` (hash opaco, no el
    mensaje) y el detalle queda en el log del servidor.
- **Navegación**: el `Nav` raíz no lee la sesión; el shell de `(app)` no
  hace consultas, no muestra datos del perfil y solo enlaza a rutas
  existentes. Protección de rutas sin cambios (proxy + guard en cada
  página); en los 307 no aparece el nav.
- Sin cambios en RLS, migraciones, servicios, acciones ni en las páginas de
  2.4–2.6; logout sin cambios (`SignOutButton` → `signOut`).

## Fase 2.6 — ajustes (2026-09-30)

- **`/ajustes`**: guard `requireOwnProfile("/ajustes")` en la propia página;
  solo lee el perfil de la sesión. Escritura por `submitNotificationSettings`
  → `updateNotificationSettings` (`lib/services/profile.ts`), que valida con
  `notificationSettingsSchema` (estricto: **solo**
  `email_notifications_enabled`) y delega en `updateProfile` (usuario de la
  sesión, cuenta eliminada bloqueada, `.eq("id", userId)`). Desde `/ajustes`
  no se puede cambiar ningún otro campo del perfil, tampoco enviándolo a
  mano; `profile_id`/`id` se rechazan igual.
- **Logout**: el mismo `signOut` de 2.2 (`SignOutButton`); **su alcance no
  cambia en 2.6** (sigue el valor por defecto de supabase-js, pendiente de
  decisión).
- **Sin borrado de cuenta** (H6 sigue fuera): ni botón, ni acción, ni
  endpoint.
- Sin migraciones ni cambios de RLS/GRANT. `profiles_select_authenticated`
  (H4) no se toca; `12_settings_notifications.sql` aprovecha que la fila
  ajena es visible para probar la condición de dueño de `profiles_update_own`.
- `email_notifications_enabled` se puede cambiar temporalmente desde
  `/perfil` y desde `/ajustes` (misma columna y mismas protecciones), para
  no reabrir la Fase 2.4.

## Cuentas eliminadas: escrituras bloqueadas en RLS (2026-09-30)

Decisión B de la auditoría de 2.3. Semántica: `profiles.deleted_at IS NOT
NULL` = cuenta completamente desactivada. Migración
`20260930130000_block_deleted_account_writes.sql`:

- **`profiles_update_own`**: `USING` y `WITH CHECK` exigen además
  `profiles.deleted_at is null`. Una cuenta eliminada no actualiza su perfil
  (0 filas afectadas).
- **`housing_preferences`**: la política `FOR ALL` se divide en cuatro. La
  de SELECT conserva exactamente la condición anterior. INSERT, UPDATE y
  DELETE exigen que el perfil de la sesión exista con `deleted_at` nulo
  (INSERT rechazado con `42501`; UPDATE y DELETE afectan a 0 filas).
- **No depende del JWT**: RLS lee `deleted_at` en cada consulta. Un token
  emitido antes de eliminar la cuenta sigue autenticando, pero ya no
  escribe (test `DD1`–`DD3`, que no vuelve a hacer login).
- **Sin cambios**: lectura (el propietario sigue viendo sus filas aunque
  esté eliminado; privacidad H3/H4 intacta), `profiles_insert_own`,
  `profiles_admin_all` (un admin activo sigue editando perfiles, también de
  cuentas eliminadas; un admin eliminado ya no es admin por `is_admin()`),
  GRANTs, funciones y triggers. `service_role` (BYPASSRLS) conserva todas
  sus escrituras; la aplicación no lo usa.
- **Por qué una subconsulta y no una función `SECURITY DEFINER`**: se
  evalúa con el RLS de `profiles`, que deja al propietario leer su fila
  aunque esté eliminada. Si esa lectura se quitara, la condición fallaría
  cerrada (nadie escribe), no abierta. Sin recursión: ninguna política de
  `profiles` consulta `housing_preferences`.
- **Fuera de alcance**: borrado de cuenta completo, RGPD, revocación de
  sesiones y alcance del logout. El resto de tablas que escribe un usuario
  (`compatibility_responses`, `favorites`, `interests`, mensajes, rooms...)
  no se ha tocado: cuando tengan flujo (Fase 3 en adelante) habrá que
  aplicarles la misma regla.
  - **Actualización:** `compatibility_responses` la aplica con un trigger
    desde la Fase 3.1, y `rooms`, `room_addresses` y `room_images` con RLS
    desde la Fase 4.0 (ver «Fase 4.0», arriba). Quedan `favorites`,
    `interests` y los mensajes, que todavía no tienen flujo.

## Fase 2.5 — preferencias de vivienda (2026-09-30)

- **`/preferencias`**: guard `requireOwnProfile("/preferencias")` en la
  propia página; solo lee las preferencias de la sesión
  (`getHousingPreferences`, RLS de lectura sin cambios). Ningún id de la URL
  se usa. Escritura por `submitOwnPreferences` → `updateHousingPreferences`
  o, si no existen, `createHousingPreferences`; nunca upsert. `profile_id`
  sale de la sesión; los esquemas `strict` rechazan `profile_id`, `role`,
  `deleted_at`, `onboarding_completed_at` o cualquier otra clave. La acción
  nunca escribe en `profiles`.
- **Riesgo C (auditoría de 2.3) resuelto**: con el onboarding completado no
  se puede quitar la ciudad (servicio + trigger para todos los roles) ni
  borrar las preferencias desde el cliente (servicio sin función de borrado
  + política de DELETE). Detalle y razonamiento en `docs/DATABASE.md`.
- **Referencias**: universidad de la ciudad elegida (servicio + trigger),
  barrios de la ciudad (trigger de 2.0), ciudad nueva activa (servicio;
  la ya guardada se conserva). IDs mal formados los rechaza Zod; inexistentes,
  las FKs.
- **Privacidad (H4)**: no hay ninguna consulta nueva de datos ajenos; las
  preferencias siguen siendo legibles solo por su dueño. No se ha cambiado
  `public_profile_previews`.
- **Limitaciones que siguen abiertas** (detalle en `PROGRESS.md`, sesiones 15
  y 17):
  - la regla de ciudad **activa** es solo de la aplicación: por PostgREST
    se puede guardar una ciudad inactiva (afecta solo al propio usuario);
  - carrera teórica entre completar el onboarding y quitar la ciudad en dos
    peticiones simultáneas (cada trigger lee la otra tabla sin bloqueo);
  - el servidor (`service_role`) puede dejar un perfil completado sin fila
    de preferencias (borrado de cuenta futuro); si el cliente la recrea, el
    trigger exige ciudad;
  - ~~las condiciones de dueño de UPDATE y DELETE no tenían un test que las
    aislara~~ (la política de SELECT también impide tocar filas ajenas,
    porque PostgreSQL la aplica a las filas que lee el `WHERE`, y
    `HP5b`/`HP5c` no distinguían las dos barreras). **Cubierto desde la
    sesión 18** por `tests/db/11_housing_preferences_ownership.sql`: con la
    fila ajena visible (política de SELECT temporal, deshecha con
    `ROLLBACK`), el UPDATE y el DELETE siguen afectando a 0 filas. Así, si en
    el futuro se abre la lectura a terceros, la condición de dueño ya está
    probada por sí sola;
  - nada de esto se ha validado contra Supabase real.
- Sin `service_role`, sin `select("*")`, sin `upsert`.

## Comprobación de coherencia final (antes de Fase 1)

Auditoría de RLS pedida explícitamente antes de confirmar el esquema.
Encontró un problema real de escalado de privilegios, ya corregido
(**incompleto**: cubrió `UPDATE` pero no `INSERT` — ver C1 en
"Correcciones de la auditoría inicial" arriba):

**`profiles_update_own` y `participants_update_own` no tenían
`with check`.** RLS restringe qué *filas* se pueden tocar, no qué
*columnas* dentro de esa fila. Con solo `using (auth.uid() = id)`, un
usuario autenticado podía incluir `role` en su propio `UPDATE` y
auto-promocionarse a admin — la condición seguía siendo cierta para la
fila nueva. El mismo patrón dejaba que un usuario cambiara
`conversation_id` en su propia fila de `conversation_participants` para
entrar en cualquier conversación ajena.

**Corrección**: restricción de columnas actualizables a nivel de
`GRANT`/`REVOKE`, independiente de RLS — `authenticated` ya no tiene
privilegio de `UPDATE` sobre `profiles.role`/`id`/`created_at`/
`deleted_at`, ni sobre `conversation_participants.conversation_id`/
`user_id`/`joined_at`. Solo las columnas realmente autoeditables quedan
con privilegio de escritura. De paso se reforzó el `INSERT` de
`admin_action_logs` con `admin_id = auth.uid()`, para que un admin no
pueda atribuir una acción a otro.

El resto de hallazgos de esta comprobación (columnas e índices que
faltaban en `rooms`/`favorites`/`conversation_participants`) están en
`docs/DATABASE.md`.

## Defensa en profundidad, no una sola capa

Ninguna capa se usa sola:

1. **RLS en Postgres** — la autoridad final. Activada en todas las
   tablas de `public`, incluidas las de referencia.
2. **Validación Zod en servidor** — en cada Server Action / Route
   Handler, siempre, aunque el formulario ya valide en cliente. La
   validación de cliente es solo UX, nunca seguridad.
3. **Comprobación de rol en servidor** — `/admin` se protege en el
   servidor además de en RLS; nunca basta con ocultar un enlace en el
   cliente.

## Gestión de secretos

- `.env*` en `.gitignore` desde el primer commit (ya hecho).
- Variables `NEXT_PUBLIC_*` son las únicas que llegan al navegador — todo
  lo demás (`SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`...) es
  server-only, nunca importado en un componente cliente.
- El rol de servicio de Supabase (`service_role`) se usa exclusivamente
  en código server-only, para las pocas operaciones que necesitan
  saltarse RLS de forma controlada (p. ej. el propio servidor creando un
  `match` tras verificar interés mutuo) — nunca expuesto a un endpoint
  público sin más comprobaciones. Desde la Fase 3, solo
  `lib/services/matching.ts` y `lib/services/compatibility.ts` lo usan (test
  estático en `tests/unit/admin-client-usage.test.ts`). La clave la valida y
  la lee `lib/env.server.ts` (`server-only`), nunca `lib/env.ts`, que también
  llega al cliente.
- Variables de entorno de producción gestionadas en Vercel, no en
  archivos.

## Rate limiting

Enfoque en dos capas, deliberadamente simple para el MVP (sin añadir
Redis todavía — eso sería sobreingeniería sin abuso real que lo
justifique):

- **App**: checks con mensajes de UX claros ("has alcanzado tu límite
  diario").
- **Base de datos (backstop)**: trigger `enforce_interest_rate_limit` en
  `interests` (30/día) — no se puede saltar aunque haya un bug en la app.

Si se observa abuso real que este mecanismo no cubre (por ejemplo,
scraping de páginas públicas), el siguiente paso es un limitador de
verdad (Upstash Redis, barato) — se añade cuando haga falta, no antes.

## Subida de archivos (Supabase Storage)

Desde la Fase 4.2 (fotos de habitaciones; ver la sección de la 4.2, arriba),
el diseño inicial cambia:
- el bucket `room-images` es **privado**: las fotos se sirven con URL
  firmadas de 10 minutos que emite el servidor tras comprobar la RLS (D1).
  Una foto puede revelar datos de una persona (su casa, su barrio, y antes de
  limpiarla, la ubicación GPS), y ocultar una habitación (R7) tiene que
  ocultar también sus fotos;
- **ningún cliente escribe** en Storage: ni rutas prefijadas con su
  `auth.uid()` ni ninguna otra. Sube el servidor, con service_role, después de
  limpiar la imagen (sin EXIF ni GPS) y con la ruta `room_id/id.webp`;
- límites en las dos capas: 4 MiB y JPEG, PNG o WebP en la aplicación (Zod y
  el sanitizador, que decide por el contenido), y 5 MiB e `image/webp` en el
  bucket, que se aplican también a service_role;
- el cuerpo de la Server Action, hasta 5 MB (`serverActions.bodySizeLimit`,
  sesión 64).

**Tamaño real de la subida (sesión 65, medido en local).** El alojamiento
aplica su propio límite al cuerpo de las peticiones, y puede ser menor que el
de Next.js. `tests/e2e/local/upload-size.spec.ts` lo mide con la Server
Action real (build de producción) y un navegador real. Un proxy HTTP local,
entre los dos, cuenta los bytes del cuerpo tal como llegan por la red.
- Con un JPEG válido de 4 194 304 bytes exactos (4 MiB), el cuerpo es:
  - con JavaScript, 4 195 232 bytes (928 de boundary, cabeceras de las partes
    y campos de la Server Action);
  - sin JavaScript, 4 195 116 bytes;
  - en los dos casos, el `Content-Length` coincide con los bytes contados.
- Frente al umbral de comparación de 4 500 000 bytes (4,5 MB decimales), el
  margen con JavaScript es de 304 768 bytes, un 6,77 % (sin JavaScript, 304
  884). El nombre del archivo de la prueba tiene 12 bytes: uno largo, de
  hasta 255, lo reduciría como mucho en unos 243 bytes más.
- La referencia de 4,5 MB es la que indicó el propietario para Vercel
  Functions y para Netlify Functions (6 MB de cuerpo, que en binario van en
  base64: unos 4,5 MB efectivos). **No se ha comprobado aquí**: el entorno no
  tiene acceso de red a vercel.com ni a docs.netlify.com, no hay
  configuración de ninguna de las dos en el repositorio, y no se ha
  desplegado nada.
- **Conclusión:** la subida por Server Action cabe con margen en esa
  referencia, así que se conserva el diseño. No hace falta la subida directa
  a un bucket temporal con URL firmada.
- Antes del primer despliegue hay que repetir la medición contra el
  despliegue (staging), con el límite vigente de la plataforma.
- Por encima de los límites:
  - más de 4 MiB, hasta 5 MB: la acción lo rechaza con el mensaje de 4 MB
    antes de leer la habitación y sin service_role ni Storage. Next.js ya ha
    leído el cuerpo para construir el `FormData`, pero la acción no lee los
    bytes de la foto (`room-images-actions`, `TrackedFile`);
  - más de 5 MB: Next.js 16.4.3 corta el cuerpo al pasar de
    `bodySizeLimit` y no ejecuta la acción, pero en las acciones con `fetch`
    responde **500, no 413** (un TODO de su `action-handler.js`). La interfaz
    muestra el error genérico, sin detalles, y no se guarda nada;
  - un 413 **simulado**: lo genera el proxy local de la prueba a partir de
    4 500 000 bytes, no Next.js ni una plataforma desplegada. Solo prueba la
    interfaz si algo delante de la app corta la petición: la acción no se
    ejecuta, se muestra el error genérico y no se guarda nada. Qué responde
    de verdad Vercel o Netlify, y con qué límite, no se ha comprobado;
  - con JavaScript, el formulario avisa antes de enviar una foto de más de
    4 MB: el 413 y el 500 solo los ve un cliente manipulado o una subida sin
    JavaScript. Sin JavaScript, el navegador mostraría la respuesta de lo que
    haya delante de la app, que la app no controla.
- Los cinco casos de `upload-size.spec.ts` pasan en local (E1, con el
  Chromium preinstalado: orientativo).

## Borrado de habitaciones (Fase 4.2, sesiones 64 y 65)

**Rutas que pueden borrar una habitación** (inventario del 2026-10-30):
- la app: solo `deleteRoom` → `deleteOwnRoom` (`lib/services/rooms.ts`) →
  `delete_own_room` (`20261030120000`). Ningún archivo de `app/` ni `lib/`
  borra `rooms` con DELETE, y `tests/unit/admin-client-usage.test.ts` lo fija;
- el DELETE directo por PostgREST: **cerrado desde la sesión 65**.
  - `anon`, `authenticated` y PUBLIC no tienen DELETE ni TRUNCATE sobre
    `rooms`. Tampoco un admin desde el cliente: el GRANT es por rol de
    Postgres, y `rooms_admin_all` sigue sirviendo para leer y moderar con
    UPDATE.
  - Se eliminó `rooms_delete_own` (41 políticas).
  - Lo prueban `tests/db/21` (DS0–DS2), el preflight (P3 y P4) y sus
    mutaciones;
- service_role directamente: `service_role` conserva DELETE sobre `rooms`,
  pero ningún código de la app lo usa. Solo lo hace la limpieza de la
  api-suite (`tests/integration/`), con sus propios usuarios de prueba;
- la cascada desde `profiles` (ver «Cascadas desde profiles y Auth», abajo):
  no limpia Storage.

**La operación privilegiada: `public.delete_own_room(p_room_id, p_user_id)`**
(`20261030120000`).
- SECURITY INVOKER, `search_path` vacío, VOLATILE.
  - EXECUTE solo para service_role. Se revoca expresamente a PUBLIC, anon y
    authenticated, porque los privilegios por defecto de Supabase se lo
    darían.
  - Se ejecuta con los privilegios de service_role (DELETE y BYPASSRLS). Si
    authenticated la pudiera llamar, el DELETE fallaría igual por falta de
    privilegio.
  - No hace falta SECURITY DEFINER.
- En una sola transacción, y abortando sin borrar nada si algo falla:
  1. los dos parámetros, no nulos (`room_delete_invalid:`, 22004);
  2. READ COMMITTED (`room_delete_isolation:`, P0001). En REPEATABLE READ,
     la lectura de las fotos usaría la instantánea del principio y podría no
     ver una foto confirmada mientras se esperaba el bloqueo;
  3. la cuenta activa, con el criterio vigente: el perfil existe y no tiene
     `deleted_at` (decisión B, 4.0). Se bloquea con FOR SHARE: una
     desactivación simultánea espera, o el borrado la ve
     (`account_deleted:`, 42501);
  4. la habitación es de ese usuario, y se bloquea con FOR UPDATE hasta el
     final (`room_not_found:`, P0002). El bloqueo choca con el FOR NO KEY
     UPDATE del trigger de las fotos y con el FOR KEY SHARE de su FK;
  5. las rutas, de las filas reales de `room_images`, ordenadas como el
     listado. Todas tienen que ser `room_id/id.webp` con dos UUID en
     minúsculas (`room_delete_path_invalid:`, 23514). El CHECK de la 4.2 ya lo
     impide; esto es una defensa más;
  6. el DELETE, filtrando por `id` y `owner_id`, y exactamente una fila. La
     cascada se lleva `room_images`, `room_addresses` y `favorites`.
     `interests`, `matches` y `reports` la referencian sin cascada: con
     alguna, falla por FK (23503) y no se borra nada;
  7. devuelve las rutas (un array vacío si no tenía fotos).
- Concurrencia, probada con dos sesiones de verdad
  (`tests/db/concurrency_room_delete.sh`):
  - si una subida está abierta, el borrado espera y devuelve también su ruta;
  - si el borrado está abierto, la subida espera y después se rechaza
    (`room_not_writable`), y M2 borra su objeto;
  - el control, sin el FOR UPDATE, pierde la ruta de la foto nueva aunque su
    fila se borre en cascada.

**Flujo del servidor** (`deleteOwnRoom`):
1. el usuario, de la sesión (`auth.getUser()`), nunca del navegador. Antes de
   crear el cliente privilegiado, la cuenta activa y la propiedad, con el
   cliente del usuario;
2. `rpc("delete_own_room")` con service_role;
3. `removeDeletedRoomObjects` (`room-images.ts`):
   - comprueba con service_role que la habitación ya no existe; si existe, o
     no se puede comprobar, no borra nada;
   - borra **solo** las rutas devueltas que son canónicas de su carpeta. Ya
     no borra lo que encuentra al listar;
   - lista la carpeta: solo si está vacía la limpieza es completa.

**Fallos parciales.**
- Rechazo definitivo de la función (SQLSTATE 22, 23, 42 o P0): no se ha
  borrado nada. Se traduce por SQLSTATE y prefijo:
  - `not_found`, `deleted` y `conflict` (FK sin cascada, con mensaje propio);
  - cualquier otro, error genérico;
  - una ruta no canónica avisa además `room_delete_path_invalid`.
- Resultado ambiguo (red, tiempo agotado, sin SQLSTATE): no se toca Storage.
  - Si la habitación sigue, error.
  - Si no se puede comprobar, error y aviso `room_delete_unconfirmed`.
  - Si ya no está, quedó borrada, pero sus rutas se perdieron con la
    respuesta: `photosRemoved: false` y aviso `room_delete_paths_unknown`.
    Los objetos los detecta la conciliación.
- Respuesta mal formada (no es una lista de textos): igual,
  `room_delete_paths_unknown`, sin tocar Storage.
- Después de confirmar el borrado, un fallo de Storage, una limpieza
  parcial, un listado fallido o un objeto que no estaba en la lista (un
  huérfano anterior) dan `photosRemoved: false`.
  - La confirmación (`/habitaciones/borrada?fotos=pendientes`) dice que
    quedan fotos pendientes de limpieza: nunca se informa de un borrado
    completo que no lo ha sido.
  - Cada objeto que queda se avisa (`room_image_orphan_after_room_delete`,
    o `room_objects_unverified` para la carpeta), y lo detecta la
    conciliación.
- Una ruta devuelta que no es canónica no se borra: se avisa
  (`room_objects_invalid_path`) y no es completa.

**Carrera residual.** `id` está en el GRANT de INSERT de `rooms`. Alguien
podría crear una habitación nueva con el mismo id justo después del borrado
y subirle una foto antes de la limpieza. La limpieza solo borra las rutas
devueltas, que eran de las fotos de la habitación borrada. Un objeto nuevo
con otro nombre no se toca: queda en la carpeta, y la limpieza, que lista la
carpeta al final, no es completa (se avisa).

**Cascadas desde profiles y Auth** (auditoría de la sesión 65; riesgo
residual aceptado por el propietario el 2026-10-30).
- `profiles.id` → `auth.users(id)` ON DELETE CASCADE, y `rooms.owner_id` →
  `profiles(id)` ON DELETE CASCADE. Borrar una cuenta borra en cascada sus
  habitaciones y las filas de sus fotos, sin pasar por la aplicación ni
  limpiar Storage. Puede pasar:
  - en Auth: el panel de Supabase, la API de administración
    (`auth.admin.deleteUser`, que solo usa la limpieza de la api-suite) o SQL
    de un operador;
  - en `profiles`: un admin activo desde el cliente (`profiles_admin_all`,
    FOR ALL; `authenticated` conserva DELETE sobre `profiles`, como
    documenta `docs/DATABASE.md`) o service_role. Ninguna de las dos la usa
    el código de la app.
- **ROOMLY no tiene flujo de borrado de cuenta** (H6, fuera de alcance), así
  que no hay ninguno que adaptar para borrar antes las habitaciones con
  `delete_own_room`.
- No se ha añadido nada en el esquema de Auth ni triggers que llamen a
  Storage por HTTP desde la base de datos: un borrado en Auth no se puede
  interceptar con seguridad desde la aplicación.
- La conciliación detecta lo que deja. `room-images-reconcile-selftest.sh`
  borra un usuario de `auth.users`, comprueba que la cascada se ha llevado su
  perfil, su habitación y la fila de su foto y que el objeto sigue, y el
  informe lo clasifica como `objeto_sin_fila`. La conciliación es
  estrictamente de solo lectura: detecta esos objetos, pero no los borra.
- **Decisión del propietario (2026-10-30), cerrada: riesgo residual
  aceptado.**
  - Se acepta que una eliminación externa en `auth.users` o en `profiles`
    borre en cascada habitaciones y filas de `room_images` sin borrar sus
    objetos de Storage. El DELETE de `profiles` de un admin activo
    (`profiles_admin_all`) es una de esas vías y queda dentro del riesgo
    aceptado: no se cambia.
  - No se añaden triggers que llamen a Storage desde PostgreSQL. Tampoco se
    implementa ahora el borrado de cuenta ni se amplía `service_role` para
    este caso.
  - **Requisito para H6:** el futuro borrado de cuenta tendrá que limpiar y
    verificar los objetos de Storage de las habitaciones de la cuenta (por
    ejemplo, con `delete_own_room` y la limpieza verificada de
    `removeDeletedRoomObjects`) **antes** de eliminar el perfil o de dejar
    que se produzca la cascada.
  - Mientras H6 no exista, es una limitación conocida y visible, no una
    protección implementada.
- Las referencias sin cascada (`messages`, `reports`, `admin_action_logs` a
  `profiles`, y `interests`, `matches` y `reports` a `rooms`) hacen que el
  borrado de una cuenta con esas filas falle por FK.

Los avatares (M3) siguen fuera de alcance; cuando se hagan, se revisa si
siguen este mismo modelo.

## CRUD de habitaciones propias (Fase 4.3, sesión 68; solo en local)

- **Sin service_role.** Crear, listar, leer para editar, editar y cambiar el
  estado usan el cliente del usuario (`lib/services/rooms.ts`). D17 no
  cambia: el cliente admin de ese archivo sigue siendo solo para
  `delete_own_room`.
- **Lo que llega del navegador.** Los campos del formulario y, al editar o
  cambiar el estado, `roomId`. Los esquemas estrictos rechazan `id`,
  `owner_id`, `status` en el alta y la edición, `deleted_at`, `approx_*`,
  las fechas y cualquier otra clave. `owner_id` sale de la sesión.
- **Dos capas.** Antes de escribir, el servicio comprueba la sesión, la
  cuenta activa, la propiedad (`id`, `owner_id` y `deleted_at is null`) y lo
  que exige la publicación. Después, la base de datos vuelve a exigirlo: el
  GRANT por columnas, la RLS de la 4.0, los CHECK, la FK barrio ↔ ciudad y
  H5. INSERT y UPDATE por separado, nunca `upsert`.
- **Admins.** A un admin, una habitación ajena le da 404 en el CRUD (no es la
  moderación). La base de datos le seguiría dejando escribirla por PostgREST
  (`rooms_admin_all`, Fase 0): la moderación es de la Fase 7.
- **R2.** No se pide ni se guarda la dirección exacta. Ningún archivo de la
  aplicación nombra `room_addresses` (`rooms-crud-static.test.ts`).
- **Errores.** Se traducen por SQLSTATE y nombre de restricción a mensajes
  propios; nunca se devuelve el texto de PostgreSQL.
- **Limitaciones conocidas:**
  - los límites de longitud de los textos solo los aplica la aplicación: la
    base de datos no tiene CHECK de longitud en `rooms`;
  - la base de datos deja editar las demás columnas de una habitación
    retirada; la aplicación lo bloquea (Fase 7);
  - una edición manipulada que omite un campo conserva su valor (UPDATE
    parcial de columnas permitidas y validadas).

## Privacidad de ubicación

`room_addresses.address_exact` en tabla separada, RLS restringida al
propietario (ver `docs/DATABASE.md` para el razonamiento completo). Los
pines públicos usan coordenadas difuminadas (~150-300m), nunca la
dirección real, hasta que exista una lógica de "compañero con match
confirmado" que amplíe el acceso sin tocar la tabla `rooms`.

## Auditoría

`admin_action_logs` registra toda acción de moderación (bloquear
usuario, resolver reporte). Sin esto, un abuso del propio panel de admin
sería invisible.

## Dependencias

`npm audit` en CI, Dependabot activado en el repositorio de GitHub en
cuanto exista.

- `sharp` es una dependencia directa y exacta desde la Fase 4.2
  (`tests/unit/sharp-dependency.test.ts`).
- **Revisión del 2026-10-29 (sesión 64).** Antes, `npm audit` daba 8
  paquetes vulnerables: 1 crítico, 4 altos y 3 moderados. Después, 0.
  - Se actualizaron solo los paquetes afectados, sin `npm audit fix --force`
    ni `overrides`.
  - `npm ci` en un directorio temporal reproduce la instalación sin cambiar
    el lockfile.
  - `tests/unit/sharp-dependency.test.ts` falla si alguno vuelve por debajo
    de su versión corregida.

| Paquete (ruta) | Antes → después | Alertas | Aplicabilidad en ROOMLY |
| --- | --- | --- | --- |
| `next` (directa) | 16.3.6 → 16.4.3 | **Crítica**: GHSA-2464-fhr4-w9xw (RCE en Image Optimization con SVG y sharp vulnerable, Linux glibc) y GHSA-673q-mjm6-r5xr (RCE en `use cache` con typed arrays), ≤ 16.4.0, corregidas en 16.4.1. **Alta**: GHSA-p3m5-59mp-jv5r (DoS con Server Actions, ≤ 16.4.0) y GHSA-cjq9-62q9-8jv4 (SSRF en Image Optimization, < 16.3.8). Además, 6 moderadas y 1 baja, < 16.3.8 | La de Server Actions aplica: la app las usa. La de Image Optimization: el endpoint existe por defecto, aunque la app no usa `next/image`. `use cache` no se usa, y sin `images.remotePatterns` no aplica la SSRF. Se corrigen todas igualmente |
| `sharp` (directa) | 0.35.4 → 0.35.5 | **Alta**: GHSA-wq5f-xc86-pv6w (librsvg, < 0.35.5) | Por N1, un SVG no llega al sanitizador. Lo usaba Image Optimization de `next` (la crítica de arriba) |
| `zod` (directa; también de `eslint-plugin-react-hooks`) | 4.6.5 → 4.6.7 | **Alta**: GHSA-mrhx-c7xc-m3w5 (memoria con arrays sin límite, < 4.6.6) | `lib/` y `app/` no usan `z.array`. Se corrige igualmente |
| `source-map-js` (transitiva: `postcss` de `next` y de Tailwind, `magicast`) | 1.2.1 → 1.2.2 | **Alta**: GHSA-68fv-2mgg-jv7q (DoS con source maps indexados) | Solo en el build, sin source maps de terceros |
| `vite` (transitiva de desarrollo: `vitest`, `@vitejs/plugin-react`) | 8.3.1 → 8.3.5 | **Alta**: GHSA-587h-7wmj-h5pm (launch-editor, Windows), 4 moderadas y 1 baja | Solo en el servidor de desarrollo de Vite; la app no lo usa |
| `vitest`, `@vitest/mocker`, `@vitest/coverage-v8` (desarrollo) | 5.0.2 → 5.0.5 | Moderadas: GHSA-qxg6-89mg-rqv8 y GHSA-xp26-3454-mjgp | Solo en los tests |

  - `react` y `react-dom` siguen en 19.2.8, que `next` 16.4.3 acepta
    (`^19.0.0`) y que no tiene alertas. `eslint-config-next` sube con `next`
    (16.4.3).
  - No queda ninguna alerta pendiente. Esto describe la base de datos de
    avisos del 2026-10-29: vuelve a comprobarse con `npm audit` antes de cada
    despliegue.

## RGPD — lo que es responsabilidad técnica y lo que no

Diseño pensado desde el principio para RGPD (minimización de datos,
soft-delete como paso previo a un borrado/anonimización real — ver
`docs/DATABASE.md`), pero **no se redacta aquí ningún texto legal**
(política de privacidad, términos, plazos de retención exactos, umbral
de DPO). Todo lo que requiere una decisión legal se marca explícitamente
como **REQUIERE REVISIÓN LEGAL** en el documento correspondiente, en vez
de inventarse.

Puntos ya marcados así: plazo de borrado/anonimización tras soft-delete,
edad mínima de 18 años, ubicación/transferencia internacional de datos
(Supabase, Vercel, Resend, PostHog — todos ofrecen opción de región EU,
pero confirmar transferencias con legal antes de producción), y los datos
de tabaco y vapeo del test de compatibilidad (Fase 3, arriba; desde el
2026-10-13).
