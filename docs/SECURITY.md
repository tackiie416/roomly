# Seguridad — ROOMLY

Prioridad alta desde el día uno (sección 28 del brief). Este documento
recoge los principios; las decisiones concretas de esquema/RLS ya
corregidas están en `docs/DATABASE.md`.

## Cobertura de los requisitos de RLS pedidos

| Requisito pedido | Políticas que lo cumplen |
|---|---|
| Usuarios solo modifican sus propios datos | `profiles_update_own`, `housing_preferences_own`, `compatibility_responses_own`, `favorites_own`, `interests_insert_own`/`interests_delete_own`, `participants_update_own` |
| Mensajes solo accesibles por participantes | `messages_select_participant`, `messages_insert_participant`, `conversations_select_participant`, `participants_select_own_conversations`, todas vía `is_conversation_participant()` — un tercero no puede leer ni escribir aunque conozca el UUID de la conversación. **Hasta la migración `20260926120000_security_fixes.sql` esto NO era cierto** (ver "Correcciones de la auditoría inicial" abajo) |
| Habitaciones editables solo por su propietario | `rooms_owner_write`. La dirección exacta va un paso más allá: `room_addresses_owner_only`, ni siquiera visible para otros usuarios autenticados |
| Administración separada | Todas las tablas sensibles tienen una política `*_admin_all` vía `is_admin()`, y `/admin` se comprueba además en el servidor — nunca solo RLS, nunca solo ocultar el enlace en el cliente |
| Información privada protegida | `profiles` completo exige sesión (vista `public_profile_previews` para lo estrictamente público de SEO); `room_addresses` solo el propietario; un usuario reportado no tiene ninguna política de SELECT sobre `reports`, así que no puede saber quién lo reportó |

Las 35 políticas están en
`supabase/migrations/20260925120100_rls_policies.sql`, con 8 de ellas
redefinidas en `supabase/migrations/20260926120000_security_fixes.sql` —
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
moderación.

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
  público sin más comprobaciones.
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

- Bucket de **lectura pública** para fotos de habitación y avatares
  (nada sensible en una foto).
- **Escritura** restringida por política de Storage: solo a rutas
  prefijadas con el `auth.uid()` de quien sube.
- Límite de tamaño y whitelist de tipo MIME (solo imágenes), validado
  tanto en la configuración del bucket como en Zod antes de iniciar la
  subida.

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
pero confirmar transferencias con legal antes de producción).
