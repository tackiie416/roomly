# PROGRESS.md

Log de sesiones. Cada entrada nueva va arriba. Formato de cada entrada:
**qué se hizo · qué queda · problemas encontrados · decisiones técnicas ·
próximos pasos.**

---

## 2026-09-30 — Sesión 21: Fase 2.7 — shell y estados (CERRADA)

**Cerrada** tras la revisión del usuario. Los cambios siguen **sin commit**
(sobre `bf32252`) hasta que el usuario lo autorice; sin push ni cambios en
Supabase remoto.

**Decisiones de cierre del usuario**
- N3 se mantiene tal cual: `Nav` raíz estático, sin consulta de sesión, y
  «Entrar» solo en la página de inicio. Consecuencia aceptada: las páginas
  públicas secundarias (incluida la 404) no tienen necesariamente «Entrar»;
  no es trabajo de 2.7.
- L1 se mantiene revertido (sin `app/(app)/loading.tsx` ni
  `requireAppShell`); las protecciones de cada página no cambian.
- `error.tsx` y `global-error.tsx` se quedan como están.
- Los riesgos de abajo no bloquean 2.7: son de otras fases o trabajo
  posterior.

**Decisiones del usuario** (tras la auditoría): N3 para la navegación y L1
para la carga, condicionado a evidencia.

**Qué hay**
- `components/nav.tsx`: cabecera global estática, solo el logotipo; no lee
  la sesión (las páginas públicas siguen estáticas: `/`, `/registro`, 404).
- `app/page.tsx`: añade «Entrar» → `/login`; el resto sin cambios
  (incluido "Foundation — Fase 1 en construcción.").
- `app/(app)/layout.tsx` + `components/app-nav.tsx` +
  `components/app-nav-links.tsx`: navegación de la cuenta hacia `/perfil`,
  `/preferencias` y `/ajustes` (`aria-current` en la actual) y el
  `SignOutButton` de 2.2. Sin consultas y sin guard propio: cada página
  conserva el suyo; sin sesión redirige `proxy.ts`.
- `app/error.tsx` y `app/global-error.tsx`: mensaje genérico y
  «Reintentar»; nunca `error.message`, stack, digest ni el objeto `error`.
- Estados vacíos: ninguno nuevo; el único real es el de `/preferencias`
  (2.5) y se conserva. Las carpetas `.gitkeep` de `(app)` no tienen UI.

**L1 probado y revertido**: con `app/(app)/loading.tsx` y un guard
(`requireAppShell`) en el layout, los redirects seguían siendo 307, pero el
contenido de las tres páginas llegaba en un `<div hidden>` que solo
muestra JavaScript: sin JavaScript solo se veía «Cargando…» (regresión de
2.4–2.6). Se eliminaron los dos; `lib/auth/session.ts` queda como en
`bf32252`.

**Resultados reales**: `npm test` 532/532 (515 + 17), `npm run test:db`
218/218, `lint`, `typecheck`, `format:check` y `build` en verde. Chromium
local (Supabase simulado): shell 35/35, `/perfil` 24/24, `/preferencias`
43/43, `/ajustes` 24/24, onboarding 2/2, con y sin JavaScript. `curl`: 307
sin sesión, sin perfil y con cuenta eliminada en las tres rutas, sin nav en
el cuerpo; 200 con el shell con sesión; `/` prerenderizada. Mutaciones: 6,
todas detectadas.

**Limitación documentada**: sin JavaScript, un error de servidor devuelve
un 500 con solo la cabecera visible (Next.js pinta `error.tsx` al
hidratar). No se muestra nada técnico.

**Riesgos y puntos abiertos** (aceptados, no se resuelven en 2.7): dos botones «Cerrar sesión» en las páginas de
la cuenta (nav y página; quitar el de la página tocaría 2.4–2.6); las
páginas usan `min-h-[calc(100vh-65px)]` y, con el nav, sobresalen unos
píxeles; el `Nav` raíz ya no ofrece «Entrar» fuera de `/` (p. ej. en la
404). Siguen los de fases anteriores (logout global, H4, carrera onboarding
↔ ciudad, perfil completado sin preferencias, ciudad activa, preflight
35/38, punto A de 2.3, Supabase real, mascotas/tabaco/solo estudiantes,
push).

---

## 2026-09-30 — Sesión 20: verificación de la Fase 2.6 (`4c40595`)

Sin cambios de código productivo, RLS ni migraciones; `4c40595` no se toca.

- `tests/db/12_settings_notifications.sql` reforzado (+6 aserciones): el
  cambio legítimo de A se relee (persiste), B ve la fila de A (SELECT no la
  oculta) y aun así no puede cambiar su aviso (ni junto con otro campo), y
  la fila de A queda intacta. Antes solo se probaba A→B y se contaban filas
  afectadas.
- Mutaciones: `profiles_update_own` sin dueño → `ST6`, y `ST10` por separado
  (copia sin `ST6`); UPDATE de `updateProfile` sin `.eq("id", userId)` → 5
  tests unitarios, 2 de `/ajustes`.
- Revisión de `app/actions/settings.ts`: usuario de `auth.getUser()`, solo
  `email_notifications_enabled`, esquema estricto, UPDATE filtrado por la
  sesión, errores propios; sin `upsert`, `service_role` ni `select("*")`;
  una sola implementación de logout (`app/actions/auth.ts`).
- Navegación: no existe navegación entre pantallas autenticadas (el `nav`
  es estático y el shell es 2.7; `/perfil` y `/preferencias`, cerradas, solo
  enlazan al onboarding). No se añade ningún enlace: `/ajustes` se abre por
  su ruta y enlaza a `/perfil`.
- Resultados: `npm test` 515/515, `npm run test:db` 218/218, `lint`,
  `typecheck`, `format:check` y `build` en verde; Chromium `/perfil` 24/24 y
  `/ajustes` 24/24 (con y sin JavaScript); ningún 307 de `/ajustes` con
  contenido.

---

## 2026-09-30 — Sesión 19: Fase 2.6 — ajustes

**Alcance** (auditoría previa y decisión del usuario): el plan aprobado de
Fase 2 define 2.6 como "Ajustes — notificaciones por email y logout —
`(app)/ajustes` — sin botón ni endpoint de borrado". Contradicción
encontrada: el aviso ya se edita en `/perfil` (2.4) y el logout existe desde
2.2. Decisión del usuario: crear `/ajustes` con los dos, **mantener
temporalmente** `email_notifications_enabled` también en `/perfil` (2.4 no
se reabre), no cambiar el alcance del logout y dejar fuera el borrado (H6).

**Qué se hizo** (sin migraciones, RLS ni cambios en `/perfil`)
- `lib/validation/profile.ts`: `notificationSettingsSchema` (estricto, solo
  `email_notifications_enabled`).
- `lib/services/profile.ts`: `updateNotificationSettings` (valida con ese
  esquema y delega en `updateProfile`).
- `lib/auth/session.ts`: `SETTINGS_PATH` y `/ajustes` como `currentPath` de
  `requireOwnProfile`.
- `app/actions/settings.ts`: `submitNotificationSettings` (éxito "Ajustes
  guardados."; errores propios o genéricos; sin sesión, sin perfil o
  eliminada → redirección).
- `components/settings/notifications-form.tsx` y
  `app/(app)/ajustes/page.tsx` (guard en la página; avisos y "Cerrar sesión"
  con el `SignOutButton` de 2.2; enlace a `/perfil`). Retirado el `.gitkeep`
  de `app/(app)/ajustes`.
- Navegación: no hay navegación autenticada (el shell es 2.7), así que
  `/ajustes` no se enlaza desde el `nav` global; solo se llega por URL.
- Tests: `tests/unit/settings.test.tsx` (27), casos nuevos en
  `validation-profile` y `services-profile`,
  `tests/db/12_settings_notifications.sql` (8).

**Resultados reales**: `npm test` 515/515 (469 + 46), `npm run test:db`
212/212 (204 + 8), `lint`, `typecheck`, `format:check` y `build` en verde.
Chromium con `next start` y Supabase simulado: `/ajustes` 24/24 con y sin
JavaScript (incluye mismo valor en `/perfil`, `full_name` inyectado
rechazado, `?profile_id=` en la URL, cuenta eliminada con la página abierta y
logout) y `/perfil` 24/24 otra vez (2.4 sin cambios). Ningún 307 de
`/ajustes` lleva contenido. Mutaciones: 1 de base de datos y 3 de código,
todas detectadas.

**Documentado expresamente**
- `email_notifications_enabled` permanece temporalmente disponible tanto en
  `/perfil` como en `/ajustes` para no reabrir retrospectivamente la Fase
  2.4.
- El alcance del logout no se modifica en Fase 2.6.
- El borrado de cuenta H6 continúa fuera de alcance.

**Riesgos pendientes** (sin cambios): alcance del logout (global o por
dispositivo); H4; carrera onboarding ↔ ciudad; perfil completado sin fila de
preferencias; ciudad activa solo en la aplicación; `preflight.sql` P3 (35
frente a 38 políticas); punto A de la auditoría de 2.3; nada probado contra
Supabase real; mascotas, tabaco y "solo estudiantes"; cuándo hacer push.

**Qué queda**: 2.7 (shell autenticado y estados). No empezada.

---

## 2026-09-30 — Sesión 18: ownership aislado de `housing_preferences`

Solo tests de base de datos y documentación: sin cambios de código
productivo, políticas ni migraciones. `d9430ac` y `b3ad249` intactos.

**Limitación que se cierra**: `HP5b`/`HP5c` (`05`) no aislaban la condición
de dueño de `housing_preferences_update_own`/`_delete_own`. PostgreSQL
aplica también la política de SELECT a las filas que lee el `WHERE` de un
UPDATE o DELETE, así que la fila ajena era invisible y el resultado era 0
filas con o sin esa condición (ya visto con la mutación M1d, sesión 16).

**Qué se hizo**: `tests/db/11_housing_preferences_ownership.sql` (12
aserciones). Dentro de una transacción con `ROLLBACK`, como superusuario, se
crea una política de SELECT temporal abierta; A comprueba que **ve** la fila
de B (`OWN0`/`OWN2`) y aun así su UPDATE (`OWN1`) y su DELETE (`OWN3`)
afectan a 0 filas y la fila queda intacta. Control positivo: en la misma
situación B sí puede, así que las demás condiciones (cuenta activa,
onboarding sin completar) se cumplen y la única diferencia es el dueño. Al
final (`OWN4`) se comprueba que la política temporal no existe, que siguen 4
políticas, que la fila de B está como al principio y que A vuelve a no verla.

**Mutaciones** (copias locales con una migración extra; nada persistente):
UPDATE sin dueño en `USING` y `WITH CHECK` → falla `OWN1`; UPDATE sin dueño
solo en `USING` → el `WITH CHECK` sigue rechazando con `42501` (la fila no
cambia) y `OWN1` falla por el cambio de comportamiento; DELETE sin dueño →
falla `OWN3`. En las tres, `HP5b`/`HP5c` siguen en verde: por eso hacía
falta este archivo.

**Resultados reales**: `npm run test:db` 204/204 (192 + 12), `npm test`
469/469, `lint`, `typecheck`, `format:check` y `build` en verde.

**Riesgos pendientes** (sin cambios, no se tocan aquí): carrera onboarding
↔ ciudad; perfil completado sin fila de preferencias; ciudad activa solo en
la aplicación; `preflight.sql` P3 con 35 políticas (hay 38); punto A de la
auditoría de 2.3; nada probado contra Supabase real; decisión sobre
mascotas, tabaco y "solo estudiantes"; alcance del logout; cuándo hacer push.

**Qué queda**: 2.6 (ajustes). No empezada.

---

## 2026-09-30 — Sesión 17: cierre formal de la Fase 2.5 y auditoría de transición

Sin cambios de código productivo, tests ni base de datos: solo comprobación
y correcciones de documentación. Commits de 2.5: `d9430ac` (implementación)
y `b3ad249` (verificación reforzada), ninguno modificado.

**Reproducido**: `npm test` 469/469, `npm run test:db` 192/192 (ejecutado
como `postgres` con `PGHOST=/var/run/postgresql`), `lint`, `typecheck`,
`format:check` y `build` en verde. Estructura en una base temporal con todas
las migraciones: 18 tablas, 0 sin RLS, 38 políticas; en
`housing_preferences`, 4 políticas (select/insert/update/delete) y los
triggers `city_required`, `neighborhoods`, `university` y `updated_at`
activos; FKs de `city_id`, `university_id` y `profile_id`. Las 36 funciones
de `public` sin `search_path` son todas de `pgcrypto`; ninguna propia.

**Auditoría** (sin fallos de seguridad; nada que reabrir):
- Código productivo sin `upsert`, `select("*")` ni `service_role`
  (`createAdminClient` no se importa en ningún sitio); `profile_id` solo
  sale de `auth.getUser()`.
- Observación sin cambio: `createHousingPreferences` hace
  `insert({ profile_id: userId, ...fields })`; si `fields` trajera
  `profile_id` lo sobrescribiría. No es explotable: el esquema `strict` lo
  rechaza (mutación M2 detectada) y `WITH CHECK auth.uid() = profile_id`
  lo bloquea en la base de datos (`HP3`). Invertir el orden sería una
  defensa extra si se decide tocar el servicio.
- Tests que no aíslan lo que su nombre sugiere: `HP5b`/`HP5c` pasan
  también con la política de UPDATE/DELETE abierta, porque la de SELECT
  oculta la fila ajena. Documentado en `docs/SECURITY.md` y
  `docs/TESTING.md`; no es un hueco de protección hoy.

**Documentación corregida**: en `docs/TESTING.md`, la fila de Chromium de
`/perfil` había perdido su columna "Dónde" (quedó pegada a la de
`/preferencias` al editar en `d9430ac`); la fila de `roomly-validation` decía
"sin `05`–`07`" y "Fase 2.0 y 2.3"; se añade qué demuestra cada capa (mock,
PostgreSQL local, Chromium en el scratchpad). En `docs/SECURITY.md`, las
limitaciones de 2.5. En `docs/ROADMAP.md`, los commits de 2.5.

**Riesgos pendientes** (sin cambios): carrera onboarding ↔ ciudad; perfil
completado sin fila de preferencias por el servidor; ciudad activa solo en
la aplicación; `preflight.sql` P3 con 35 políticas; punto A de la auditoría
de 2.3; nada de Fase 2 probado contra Supabase real. Pendiente de decisión:
mascotas, tabaco y "solo estudiantes" como preferencias (hoy solo son
columnas de `rooms`).

**Qué queda**: 2.6 (ajustes). No empezada.

---

## 2026-09-30 — Sesión 16: refuerzo de las verificaciones de 2.5

Sin cambios de código productivo, de base de datos ni de documentación de
diseño: solo verificación. `d9430ac` no se toca (commit nuevo, sin amend).

**Mutaciones pendientes, ejecutadas de verdad** (cada archivo restaurado y
comprobado con hash; las de base de datos, en copias locales con una
migración extra):
- Sin filtro por usuario en el servicio: en la lectura
  (`getHousingPreferences`) fallan 2 tests (página y servicio); en el UPDATE,
  2 (acción y servicio). En la base de datos, con la política de SELECT
  abierta falla `HP5a` (y `08`); con la de UPDATE abierta falla `08` (`DD2`),
  mientras `HP5b` sigue en verde porque el UPDATE también aplica la política
  de SELECT a las filas que lee: dos capas, no un test vacío (la fila ajena
  existe).
- `profile_id` aceptado en el esquema de entrada: fallan 6 tests (acción de
  preferencias, acción del onboarding, servicio y validación).
- Sin el trigger de barrios (2.0): fallan `05` (`HP11`, primero) y `10`
  (`PN1`). La regla de barrios solo vive en la base de datos (la aplicación
  traduce su error); por eso no la detecta la suite unitaria, que la emula.

**Tests nuevos de la Server Action** (`tests/unit/preferences-actions.test.ts`,
+5): `city_id` inexistente (al actualizar y al crear), `university_id`
inexistente, barrio inexistente, y ciudad/universidad/barrio incompatibles
entre sí. Todos comprueban error de campo propio, sin éxito, sin cambios
guardados, sin `revalidatePath` y sin texto de Supabase. El mock en memoria
emula ahora también las FKs de ciudad y universidad.

**Chromium**: escenario nuevo en el flujo de `/preferencias` (perfil con el
onboarding completado y sin fila de preferencias → estado vacío con ciudad
obligatoria → crear → `city_id` guardado y onboarding intacto → recargar →
quitar la ciudad sigue rechazado), con y sin JavaScript. El script vive en el
scratchpad de la sesión (Supabase simulado con estado), no en el repositorio:
no es la suite E2E de 2.8.

**Resultados reales**: `test` 469/469 (464 + 5), `test:db` 192/192 (sin
cambios), `lint`, `typecheck`, `format:check` y `build` en verde; Chromium
43/43 (35 + 4 comprobaciones nuevas en cada modo) y regresión del onboarding
2/2.

**Qué queda**: 2.6 (ajustes). No empezada.

---

## 2026-09-30 — Sesión 15: Fase 2.5 — preferencias de vivienda

**Alcance pedido**: `/preferencias` para consultar y editar las
preferencias propias con los servicios existentes; resolver el riesgo C de
la auditoría de 2.3 en la aplicación y en la base de datos; validar en el
servidor universidad, barrios y ciudad. Sin 2.6, sin cambios remotos.

**Comprobaciones previas**
- `housing_preferences` tiene: `city_id`, `university_id`,
  `field_of_study`, `budget_min/max`, `move_in_date/move_out_date`,
  `preferred_neighborhood_ids`, `roommates_wanted_min/max`. **Mascotas,
  tabaco y "solo estudiantes" no existen ahí**: son columnas de `rooms`
  (`pets_allowed`, `smoking_allowed`, `students_only`). No se han inventado
  ni añadido (ver "Pendiente de decisión").
- Solo `cities` tiene `is_active`.
- Privacidad (H4): la lectura de `housing_preferences` sigue siendo solo del
  dueño; no hay consultas de preferencias ajenas.

**Qué se hizo**
- Migración `20260930140000_phase2_preferences_integrity.sql`:
  `trg_housing_preferences_city_required` (ciudad obligatoria con el
  onboarding completado, todos los roles), `housing_preferences_delete_own`
  recreada (el cliente no borra tras completar; la cascada y el servidor
  sí) y `trg_housing_preferences_university` (universidad de la ciudad). 38
  políticas, sin cambios de GRANT. Razonamiento en `docs/DATABASE.md`.
- `lib/services/housing-preferences.ts`: `checkPreferenceRules` sustituye a
  `checkUniversityCity` (ciudad obligatoria tras el onboarding, ciudad nueva
  activa, universidad de la ciudad); `requireActiveProfile` devuelve si el
  onboarding está completado; errores de los triggers nuevos → errores de
  campo.
- `lib/services/reference-data.ts`: `listCitiesByIds` (mostrar la ciudad
  guardada aunque ya no esté activa).
- `lib/auth/session.ts`: `requireOwnProfile(currentPath)` y
  `OWN_PREFERENCES_PATH`; `lib/auth/protected-routes.ts` y `proxy.ts`:
  `/preferencias` exige sesión.
- `app/(app)/preferencias/page.tsx`, `app/actions/housing-preferences.ts`
  (`submitOwnPreferences`: UPDATE o, si no existen, INSERT; éxito
  "Preferencias guardadas."; nunca escribe en `profiles`) y
  `lib/validation/preferences-form.ts`.
- `components/onboarding/preferences-form.tsx`: props opcionales
  `submitAction`, `submitLabel`, `cityRequired` y mensaje de éxito; por
  defecto, el comportamiento de 2.3 sin cambios.
- Tests: `tests/db/10_preferences_integrity.sql` (24),
  `tests/unit/preferences-actions.test.ts`,
  `tests/unit/preferences-page.test.tsx`, casos nuevos en
  `services-housing-preferences`, `services-reference-data`,
  `onboarding-forms` y `auth-proxy`.

**Resultados reales**: `test` 464/464 (416 + 48), `test:db` 192/192
(168 + 24), `lint`, `typecheck`, `format:check` y `build` en verde. Chromium
local con Supabase simulado que emula los triggers: 35/35 con y sin
JavaScript (sin sesión, sin perfil, eliminada, incompleto sin preferencias,
filtro ciudad → barrios/universidades, guardar sin ciudad antes del
onboarding, completo con datos, edición, error de rango, quitar la ciudad
tras el onboarding, `profile_id`/universidad/barrio/ciudad inactiva
inyectados, `?profile_id=` en la URL, eliminada con la página abierta,
logout) y regresión del onboarding 2/2. Ningún 307 de `/preferencias` lleva
contenido. Mutaciones: 5 de base de datos y 9 de código, todas detectadas.

**Cambios en fases cerradas (necesarios, con motivo)**
- `tests/db/05` (`HP-barrios`): el fixture que dejaba `city_id = null` con
  una universidad de Barcelona ahora vacía también `university_id`. Ese
  estado ya lo rechazaba la aplicación desde 2.3 y ahora también la base de
  datos; lo que prueba el test no cambia.
- El trigger de universidad deja pasar las ciudades inexistentes para que
  sea la FK quien las rechace (`23503`): sin eso fallaba `HP9` de 2.0.
- `checkUniversityCity` (2.3) se integra en `checkPreferenceRules`; el
  formulario de 2.3 gana props opcionales (sin cambiar su comportamiento,
  comprobado con sus tests y en Chromium).

**Decisiones propias**
- DELETE bloqueado con RLS y no con trigger ni `REVOKE` (cascada del perfil
  y borrado antes del onboarding). Ciudad obligatoria con trigger (depende
  de `profiles`, cubre el INSERT y da un error propio).
- `/preferencias` no completa el onboarding (nunca toca
  `onboarding_completed_at`): con el onboarding sin terminar todo es
  opcional y se enlaza a `/bienvenida/preferencias`.
- Ciudad inactiva: se rechaza al elegirla; la ya guardada se conserva y se
  muestra.
- Un campo que no llega en el formulario no se toca (misma semántica que
  2.3 y 2.4); el navegador siempre los envía todos.

**Riesgos pendientes**
- Carrera entre completar el onboarding y quitar la ciudad en dos
  peticiones simultáneas (cada trigger lee el estado de la otra tabla sin
  bloqueo): muy improbable y solo afecta al propio usuario.
- La regla de ciudad activa es solo de la aplicación: por PostgREST se
  puede guardar una ciudad inactiva (solo afecta al propio usuario).
- El servidor puede dejar un perfil completado sin fila de preferencias
  (borrado de cuenta futuro); aceptado y documentado.
- Nada de 2.5 se ha probado contra Supabase real (2.8). `preflight.sql` P3
  sigue esperando 35 políticas (se actualiza al aplicar las migraciones de
  Fase 2 en `roomly-validation`). El punto A de la auditoría de 2.3 sigue
  pendiente.

**Pendiente de decisión**: si mascotas, tabaco y "solo estudiantes" deben
ser preferencias de búsqueda (nuevas columnas en `housing_preferences`) o
solo filtros de habitaciones (Fase 4).

**Qué queda**: 2.6 (ajustes). No empezada.

---

## 2026-09-30 — Sesión 14: Fase 2.4 — perfil propio

**Alcance pedido**: `/perfil` para consultar y editar solo el perfil de la
sesión, reutilizando servicios y validaciones. Campos editables:
`full_name`, `date_of_birth`, `bio`, `seeking_status` y
`email_notifications_enabled`. Sin 2.5, sin ajustes de 2.6, sin perfiles de
terceros (H3/H4), sin migraciones y sin tocar Supabase remoto.

**Qué se hizo**
- `lib/auth/session.ts`: `requireOwnProfile()` (+ `OWN_PROFILE_PATH`,
  `EditableProfileState`). Sin sesión → `/login?next=/perfil`; sin perfil →
  `/bienvenida/perfil`; cuenta eliminada → `/cuenta-desactivada`;
  incompleto y completo → se puede editar.
- `app/(app)/perfil/page.tsx`: guard en la propia página (no hay layout de
  `(app)`), formulario con los datos guardados y, si el onboarding no está
  terminado, aviso con enlace a `/bienvenida/preferencias`. La ruta no tiene
  ningún parámetro de perfil; `perfil/[id]` sigue vacía.
- `app/actions/profile.ts`: `submitOwnProfile` (guard → `FormData` →
  `updateProfile` de 2.1 → estado). Éxito: "Cambios guardados." y los
  valores guardados; `revalidatePath("/perfil")`. Errores: de campo,
  generales ("Campo no permitido: …") o genérico, nunca texto de Supabase;
  sin sesión, sin perfil o eliminada → redirección.
- `components/profile/own-profile-form.tsx`: formulario HTML + Server Action
  (funciona sin JavaScript), etiquetas asociadas, `aria-invalid` /
  `aria-describedby`, estado de guardado (`useFormStatus`), éxito con
  `role="status"`, vuelve a rellenarse con lo enviado si hay errores.
  Reutiliza los controles y las opciones de `seeking_status` de
  `components/onboarding/*`.
- `lib/validation/own-profile-form.ts`: campos del formulario y
  `ownProfileFormValues` (perfil → valores), sin E/S.
- `lib/validation/profile.ts`: `profileUpdateSchema` acepta
  `email_notifications_enabled` (booleano; ver desviaciones).
- `lib/validation/form-data.ts`: tipo de campo `checkbox` (marcada `on` →
  `true`; ausente → `false`; cualquier otro valor se deja para que la
  validación lo rechace).
- `lib/services/profile.ts`: solo un comentario que quedó obsoleto con la
  sesión 13 (RLS ya bloquea la edición de cuentas eliminadas).
- Tests: `tests/unit/profile-actions.test.ts`,
  `tests/unit/own-profile-form.test.tsx`, casos nuevos en
  `auth-session`, `services-profile`, `validation-profile` y
  `validation-form-data`; `tests/db/09_own_profile_update.sql` (10
  aserciones, sin migración).

**Resultados reales**: `test` 416/416 (347 + 69), `test:db` 168/168
(158 + 10), `lint`, `typecheck`, `format:check` y `build` en verde. Flujo en
Chromium con `next start` y Supabase simulado con estado, con y sin
JavaScript (24/24): sin sesión, sin perfil y eliminada redirigen; incompleto
muestra el aviso; completo carga los datos; guardar muestra el éxito y
persiste; menor de 18 da error de campo sin guardar y conserva lo escrito;
un `role` inyectado se rechaza; la cuenta eliminada con la página abierta
acaba en `/cuenta-desactivada` sin cambios; el logout desde `/perfil` borra
la sesión y `/perfil` vuelve a pedir login. Con `curl`, ningún 307 de
`/perfil` lleva el formulario en el cuerpo, y `/perfil?profile_id=<otro>`
carga el perfil propio (la única consulta a `profiles` filtra por el id de
la sesión).

**Revisión de cierre** (antes del commit): `email_notifications_enabled`
está en el esquema, el `FormData`, la acción y la UI, con tests de los
tres; `seeking_status` ausente no se toca (test de validación y de
acción); `requireOwnProfile` y `/perfil` solo leen por el id de
`auth.getUser()`, con test de un `profile_id`/`id` ajeno en la URL; cuenta
eliminada bloqueada en página, acción, servicio y RLS (`08` sigue en
verde); `id`, `role`, `deleted_at`, `created_at`, `updated_at` y
`onboarding_completed_at` rechazados desde el formulario (tests de acción) y
por GRANT/RLS (`01`, `06`, `09`). Sin `upsert`, `select("*")`,
`service_role`, cambios de RLS ni de `public_profile_previews`. Mutaciones: 8 de código y 1 de
base de datos, todas detectadas (detalle en `docs/TESTING.md`).

**Desviaciones y decisiones propias**
- `email_notifications_enabled` no estaba en `profileUpdateSchema` (2.1),
  aunque el GRANT de UPDATE ya lo incluía. Como el alcance de 2.4 lo lista
  como editable, se añade al esquema (booleano, sin `null`). No es un ajuste
  completo de 2.6: es la columna ya existente.
- Campos ausentes = sin cambios (el esquema de edición es parcial): si
  alguien quita a mano el radio de `seeking_status`, no se toca la columna;
  nunca se envía `null`. El formulario siempre llega con el valor actual.
- `toFormState` se duplica en `app/actions/profile.ts` en vez de extraerlo
  de `app/actions/onboarding.ts`, para no modificar 2.3.
- Controles de formulario y opciones de `seeking_status` importados de
  `components/onboarding/*`; moverlos a un sitio común queda para el shell
  (2.7).
- Sin `loading.tsx`: crearía un límite de Suspense y los guards dejarían de
  responder con un 307 limpio.
- La navegación no enlaza todavía a `/perfil` (shell autenticado: 2.7).

**Riesgos pendientes**
- Si la cuenta se elimina entre la lectura del servicio y el UPDATE, RLS no
  actualiza ninguna fila y se muestra el error genérico (no la redirección);
  la siguiente navegación lleva a `/cuenta-desactivada`.
- `date_of_birth` es editable por el usuario (lo pide el alcance); solo lo
  limita `chk_min_age`. H4 (cualquier usuario autenticado lee
  `date_of_birth` de todos) sigue abierto, igual que antes: 2.4 no lo empeora
  ni lo resuelve.
- Nada de 2.4 se ha probado contra Supabase real (2.8).
- Siguen igual: puntos A y C de la auditoría de 2.3, y P3 de
  `tests/supabase/preflight.sql` (35 políticas).

**Qué queda**: 2.5 (preferencias). No empezada.

---

## 2026-09-30 — Sesión 13: bloquear escrituras de cuentas eliminadas (decisión B)

**Decisión del usuario** (tras la auditoría de cierre de 2.3): `deleted_at
IS NOT NULL` = cuenta completamente desactivada. No puede modificar su
perfil ni crear, modificar o borrar `housing_preferences`, y la protección
tiene que estar en la base de datos, sin depender de que el JWT caduque. Sin
borrado de cuenta, RGPD ni cambios en el logout. Los puntos A y C de la
auditoría no se tocan.

**Qué se hizo** (sin tocar código de la aplicación, tipos ni migraciones
anteriores)
- Migración `20260930130000_block_deleted_account_writes.sql`:
  - `profiles_update_own`: `USING`/`WITH CHECK` con `profiles.deleted_at is
    null`.
  - `housing_preferences_own` (`FOR ALL`) → `housing_preferences_select_own`
    (condición idéntica a la anterior) + `insert_own`/`update_own`/
    `delete_own`, que exigen el perfil de la sesión con `deleted_at` nulo
    (subconsulta con RLS: falla cerrada; sin recursión).
  - Sin cambios en GRANT, funciones, triggers, `profiles_insert_own` ni
    `profiles_admin_all`. 18 tablas, 38 políticas (antes 35), RLS en todas.
- `tests/db/08_deleted_account_writes.sql` (22 aserciones): cuenta activa
  escribe perfil y preferencias; cuenta eliminada (con el mismo JWT de
  antes de eliminarse) no actualiza su perfil ni actualiza, borra o crea
  preferencias; la lectura propia y ajena no cambia; un admin sigue
  editando perfiles y `service_role` actualiza, borra y crea; estructura
  de políticas.
- Documentación: `docs/DATABASE.md`, `docs/SECURITY.md`, `docs/TESTING.md`,
  `docs/ROADMAP.md` y la línea de estado de `CLAUDE.md`.

**Resultados reales**: `test:db` 158/158 (136 + 22), `test` 347/347,
`lint`, `typecheck`, `format:check` y `build` en verde. Mutaciones en copias
locales (6, todas detectadas): sin `deleted_at is null` en
`profiles_update_own` → `DD1`; sin la comprobación en INSERT → `DE1`, en
UPDATE → `DD2`, en DELETE → `DD3`; sin la migración → `DD1`; lectura
restringida también → `DD4`.

**Pendiente**
- `tests/supabase/preflight.sql` (P3) espera 35 políticas: es lo correcto
  para `roomly-validation` hoy (solo migraciones de Fase 1). Al aplicar allí
  las migraciones de Fase 2 (2.8) hay que actualizarlo a 38 en el mismo
  paso. No se ha tocado Supabase remoto.
- La misma regla para el resto de tablas que escribe un usuario
  (`compatibility_responses`, `favorites`, `interests`, `messages`,
  `rooms`...) cuando tengan flujo (Fase 3+).
- Revocar sesiones al eliminar una cuenta: fuera de alcance (borrado de
  cuenta, H6).
- Puntos A (`onboarding_completed_at` de una sola escritura, 2.8) y C
  (preferencias tras completar, 2.5): sin cambios.

**Qué queda**: 2.4 (perfil propio). No empezada.

---

## 2026-09-30 — Sesión 12: Fase 2.3 — onboarding

**Decisiones del usuario** (tras la revisión de solo lectura de 2.2):
- `seeking_status`: opción A — sin DEFAULT, sigue NOT NULL, siempre enviado
  explícitamente; radios sin preselección.
- `onboarding_completed_at`: opción 1 — trigger de integridad; la lógica
  sigue en `completeOnboarding`.
- Onboarding completo = perfil válido (nombre, fecha, `seeking_status`
  elegido) + fila de `housing_preferences` con `city_id`; el resto es
  opcional. Al terminar se va a `/` (no se conserva `next`).

**Qué se hizo**
- Migración `20260930120000_phase2_onboarding_integrity.sql`:
  - `profiles.seeking_status`: `drop default`.
  - `trg_profiles_onboarding_completion`
    (`BEFORE INSERT OR UPDATE OF onboarding_completed_at`): si pasa a no
    nulo, exige `housing_preferences` del mismo perfil con `city_id`; si no,
    `23514` (`onboarding_incomplete:`). `SECURITY INVOKER` (solo lee la fila
    propia, que RLS permite; sin recursión), `search_path` vacío, `EXECUTE`
    revocado a `PUBLIC`, `anon` y `authenticated`. Sin cambios en RLS ni
    GRANT; siguen 18 tablas y 35 políticas.
- `lib/validation/form-data.ts`: `FormData` → objeto (vacío → omitido o
  `null`, números solo si el texto es numérico, listas, campos repetidos o
  archivos se dejan para que la validación los rechace; claves inesperadas
  se conservan para que el esquema `strict` las rechace, salvo las internas
  de Next.js `$ACTION_*`) y `formDataValues` (solo campos conocidos, para
  volver a rellenar el formulario).
- `lib/validation/housing-preferences.ts`:
  `housingPreferencesOnboardingSchema` (el de crear, con `city_id`
  obligatorio).
- `lib/services/reference-data.ts`: ciudades activas, universidades y
  barrios de esas ciudades (una consulta cada uno, sin N+1, proyección
  explícita, sin service_role).
- `lib/services/profile.ts`: `completeOnboarding` traduce el error del
  trigger a un error de campo.
- `lib/services/housing-preferences.ts`: `checkUniversityCity` rechaza
  (antes de escribir, en crear y en actualizar) una universidad que no es
  de la ciudad elegida, comparando con el valor guardado si el input solo
  trae uno de los dos campos. Una universidad sin ciudad vale con cualquier
  ciudad. La base de datos no lo impone (a diferencia de los barrios, que ya
  tienen trigger desde 2.0), y el filtro del formulario no bastaba.
- `app/actions/onboarding.ts`: `submitOnboardingProfile` (guard del paso →
  `createProfile` → `/bienvenida/preferencias`) y
  `submitOnboardingPreferences` (guard → esquema de onboarding →
  `createHousingPreferences` → `completeOnboarding` → `/`). Errores de
  servicio → redirección (sin sesión, eliminado, sin perfil) o errores de
  campo / mensaje genérico; nunca texto de Supabase.
- `components/onboarding/{profile-form,preferences-form,form-controls}.tsx`
  (`useActionState` + `useFormStatus`; formularios HTML que funcionan sin
  JavaScript; radios de `seeking_status` sin preselección; universidad y
  barrios filtrados por la ciudad elegida) y las páginas de
  `/bienvenida/{perfil,preferencias}` (la segunda rellena el formulario con
  lo ya guardado).
- Carpetas vacías antiguas `app/(onboarding)/{perfil,preferencias}`
  retiradas; `test` movida a `app/(onboarding)/bienvenida/test` (Fase 3).
- Tipos: `profiles.Insert.seeking_status` obligatorio. Fixtures: los 17
  INSERT de perfiles de `tests/db/01`–`06` y los de la suite de integración
  envían `seeking_status` (dependían del default).

**Resultados reales**: `test` 347/347 (283 anteriores + 64 nuevos);
`test:db` 136/136 (119 anteriores + 17 de `07_onboarding_integrity.sql`);
`format`, `lint`, `typecheck`, `build` en verde; `auth-redirects.sh` 16/16.
Prueba local con `next start`, Supabase simulado con estado y Chromium,
**con y sin JavaScript**: `no_profile → /bienvenida/perfil →
/bienvenida/preferencias → /`, sin radio preseleccionado, errores del
servidor que conservan lo escrito, sin ciudad no se guarda ni se completa,
reanudar tras abandonar rellena lo guardado, volver al paso 1 con perfil
lleva al paso 2, perfil completo o cuenta eliminada no entran al onboarding;
ningún redirect lleva contenido protegido en el cuerpo. Mutaciones que
hacen fallar sus tests: volver a poner el default, quitar o deshabilitar el
trigger, ciudad no obligatoria, `onboarding_completed_at` aceptado desde el
formulario, sin guard de paso, sin `completeOnboarding`, radio
preseleccionado, sin la comprobación de universidad y ciudad (4 tests).
Los fixtures de `tests/db` solo añaden `seeking_status` a los INSERT: los
tests negativos exigen un SQLSTATE concreto (p. ej. `42501`), así que
siguen fallando por la razón que prueban y no por el NOT NULL.

**Desviaciones respecto al prompt**
- Los campos se llaman como las columnas reales (`move_in_date`,
  `move_out_date`, `roommates_wanted_min/max`), no `available_from/until`
  ni `roommates_min/max`: no se renombra el esquema.
- Las páginas de servidor leen datos de referencia y preferencias guardadas
  a través de los servicios (lecturas, igual que los guards); toda escritura
  va por Server Action.
- `components/onboarding/form-controls.tsx` (errores de campo, error
  general, botón con estado pendiente) compartido por los dos formularios.

**Riesgos pendientes**
- El trigger protege la escritura de `onboarding_completed_at`, no lo
  contrario: un usuario puede, vía PostgREST, borrar sus preferencias o
  vaciar `city_id` después de completar (solo le afecta a él). No se ha
  añadido protección inversa (fuera de la decisión tomada).
- La lista de ciudades es la de `is_active`, pero el servidor no rechaza
  una ciudad inactiva enviada a mano (no es una regla decidida).
- El seed no tiene barrios: el selector sale vacío en local/validación.
- `authenticated` conserva el GRANT de INSERT/UPDATE sobre
  `onboarding_completed_at` (necesario para completar sin service_role ni
  `SECURITY DEFINER`, que se descartaron). Por PostgREST un usuario puede
  completar directamente (siempre con preferencias con ciudad, lo impone el
  trigger), reescribir su timestamp o volver a ponerlo a nulo. La
  idempotencia la da `completeOnboarding` (`.is(null)`), no la base de
  datos. Solo le afecta a él.
- Cuentas eliminadas: la política `profiles_update_own` (anterior a 2.3) no
  mira `deleted_at`, ni la de `housing_preferences`; el bloqueo es de la
  aplicación (guards, acciones y servicios). Por PostgREST una cuenta
  eliminada con sesión válida aún podría escribir sus filas. Decidir si se
  cierra en base de datos (p. ej. en 2.6, junto al borrado de cuenta).
- La comprobación de universidad y ciudad es de la aplicación
  (lectura previa + escritura, sin transacción): no protege de PostgREST
  directo ni de una carrera entre pestañas.
- Nada de 2.3 se ha probado contra Supabase real (pendiente para 2.8,
  junto con la migración incremental a `roomly-validation`).

**Qué queda**: 2.4 (perfil propio). No empezada.

---

## 2026-09-29 — Sesión 11: Fase 2.2 — enrutamiento de autenticación

**Decisiones del usuario**: `next` viaja en una cookie de corta duración
(opción B, sin cambios remotos en Supabase); `emailRedirectTo` sigue siendo
exactamente `/callback`.

**Qué se hizo** (sin formularios de onboarding, perfil, preferencias ni
ajustes; sin migraciones, RLS ni CI; sin tocar Supabase remoto)
- `lib/auth/destination.ts` (función pura, fuente única de destinos):
  `resolveDestination(state, next)` — `no_profile` → `/bienvenida/perfil`,
  `incomplete` → `/bienvenida/preferencias`, `complete` → `next` saneado o
  `/`, `deleted` → `/cuenta-desactivada`. `sanitizeNext` reutiliza
  `getSafeRedirectPath` (sin modificarlo) y excluye `/login`, `/callback`,
  `/registro`, `/bienvenida/*` y `/cuenta-desactivada`, también con barra
  final, mayúsculas o codificación (`/%6cogin`). `loginPath()`.
- `lib/auth/next-cookie.ts`: cookie `roomly_next` (1 h, `SameSite=Lax`,
  `Path=/`, `Secure` en https), solo con la ruta ya saneada; se vuelve a
  sanear al leerla y el callback la borra siempre.
- `lib/auth/login-errors.ts`: códigos propios (`auth_callback_failed`,
  `link_expired`, `rate_limited`, `invalid_email`, `send_failed`) con
  mensajes fijos en español. Nunca se muestra `error.message` ni se reenvía
  `error_description`.
- `lib/auth/session.ts` (`server-only`): `getCurrentProfileState()` con
  `cache()` de React sobre `getProfileState` (2.1); guards
  `requireCompleteProfile`, `requireOnboardingStep`,
  `requireDeletedAccount` y `requireAdmin`. Si el estado no se puede leer
  (error de base de datos) lanzan un error genérico en vez de redirigir.
- `lib/services/profile.ts`: `isActiveAdmin()` (lectura mínima de `role` y
  `deleted_at`; `OwnProfile` sigue sin `role`).
- `app/(auth)/login/page.tsx` pasa a componente de servidor (`searchParams`
  asíncrono, `next` y `error` saneados, redirección por estado si ya hay
  sesión) + `components/auth/login-form.tsx` (cliente; escribe la cookie).
- `app/(auth)/callback/route.ts`: `error`/`error_code` → código propio;
  sin `code` o canje fallido → `auth_callback_failed` (`link_expired` si el
  enlace caducó); tras el canje, `getProfileState` + cookie +
  `resolveDestination`. Ya no acepta `next` por query. Comentario de D14
  corregido (las cookies de sesión NO son HttpOnly).
- `app/actions/auth.ts` (`signOut`, Server Action) y
  `components/auth/sign-out-button.tsx`.
- `app/cuenta-desactivada/page.tsx` (sin reactivación) y páginas mínimas
  `app/(onboarding)/bienvenida/{perfil,preferencias}/page.tsx` (solo el
  destino y su guard; el formulario es de 2.3). Las carpetas vacías antiguas
  `app/(onboarding)/{perfil,preferencias,test}` siguen sin tocar.
- `/admin`: `requireAdmin` en el layout **y** en la página.
- `proxy.ts`: bloquea a anónimos en `/admin`, `/perfil`, `/ajustes`,
  `/bienvenida` y `/cuenta-desactivada` (`lib/auth/protected-routes.ts`,
  por prefijo exacto: `/administracion` ya no cuenta como `/admin`). Sigue
  sin consultar la base de datos.
- `tests/supabase/auth-redirects.sh`: AU3f–g (errores de Supabase) y
  AU5b–i (rutas protegidas nuevas, `/login` sin bucle).

**Problema encontrado y corregido en esta fase**: con el guard solo en
`app/admin/layout.tsx`, Next.js renderiza la página en paralelo y el
contenido de `/admin/page.tsx` viajaba en el cuerpo del 307 a cualquier
usuario autenticado no admin (comprobado con `curl`). Sin datos expuestos
hoy (el panel es estático), pero lo habría expuesto en Fase 7. Ya existía
con el guard de Fase 1. Corregido llamando a `requireAdmin()` también en la
página; regla registrada en `docs/SECURITY.md`.

**Resultados reales**: `test` 283/283 (152 anteriores + 131 nuevos);
`format`, `lint`, `typecheck`, `build` y `test:db` 119/119 en verde;
`auth-redirects.sh` 16/16 en local. Prueba local con `next start` y un
Supabase simulado (nunca `roomly-validation`): cada estado (sin perfil,
incompleto, completo, eliminado, admin activo, admin incompleto, admin
eliminado) llega a su destino en `/bienvenida/*`, `/cuenta-desactivada`,
`/admin` y `/login?next=`; ningún redirect lleva contenido protegido en el
cuerpo; como mucho una llamada a Auth en el servidor por petición. Con
Chromium: el login guarda la cookie solo con `next` válido, muestra
mensajes propios (también ante un 429 real con texto crudo) y la petición
OTP sale con `redirect_to` = `/callback`; el logout cierra la sesión y borra
las cookies. Nueve mutaciones del código de Auth hacen fallar sus tests.

**Decisiones técnicas**
- Un admin con el onboarding sin completar sí entra a `/admin`:
  `requireAdmin` exige rol y cuenta no eliminada, no onboarding (los admins
  se crean desde el servidor).
- `signOut()` usa el alcance por defecto de supabase-js (`global`: cierra
  las sesiones de todos los dispositivos).
- Si el estado del perfil no se puede leer tras el canje, el callback manda
  a `/login?error=auth_callback_failed`; `/login` no redirige en ese caso,
  así que no hay bucle.

**Qué queda**: 2.3 (onboarding). No empezada.

---

## 2026-09-29 — Sesión 10: Fase 2.1 — validación y servicios de perfil y preferencias

**Decisión de producto (usuario)**: el onboarding está completo cuando hay
perfil con `full_name`, `date_of_birth` y `seeking_status` elegido, y una
fila de `housing_preferences` con `city_id`. Universidad, estudios,
presupuesto, fechas, barrios y compañeros son opcionales en el MVP.

**Qué se hizo** (sin UI, sin Server Actions, sin tocar Auth, `proxy.ts`,
migraciones ni Supabase remoto)
- `lib/validation/common.ts`, `profile.ts` y `housing-preferences.ts` (Zod
  4, esquemas `strict`):
  - perfil: `full_name` (trim + espacios colapsados, 1–100), `date_of_birth`
    (ISO real, no futura, ≥ 18 años calculado en UTC como `current_date`,
    incluido el 29 de febrero), `bio` (≤ 500, vacío → `null`),
    `seeking_status` (enum exacto, **sin valor por defecto**). Rechaza `id`,
    `role`, `deleted_at`, timestamps, `onboarding_completed_at` y
    `avatar_url`. `profileUpdateSchema` exige al menos un campo.
  - preferencias: UUIDs normalizados, `field_of_study` ≤ 120, presupuesto y
    compañeros enteros ≥ 0 con mínimo ≤ máximo **sin techo**, fechas con
    entrada ≤ salida, barrios deduplicados **sin límite de cantidad** y que
    exigen ciudad. Rechaza `profile_id`. La existencia de ciudad,
    universidad y barrios la sigue comprobando PostgreSQL.
  - Longitudes contadas como `char_length` (code points), no como UTF-16.
  - Los enteros se limitan al rango de `integer` de PostgreSQL: es el tipo de
    la columna, no un límite de producto.
- `lib/services/result.ts`, `profile.ts` y `housing-preferences.ts` (con
  `import "server-only"`):
  - `getProfileState` (`no_profile` / `deleted` / `incomplete` con
    `hasPreferences` / `complete`), `createProfile`, `updateProfile`,
    `completeOnboarding`, `getHousingPreferences`,
    `createHousingPreferences` y `updateHousingPreferences`.
  - Usuario siempre de `auth.getUser()`; sin service_role; proyecciones
    explícitas (sin `role`, nunca `*`); sin upsert (INSERT y, con `23505`,
    UPDATE de campos permitidos; con perfil eliminado, `deleted` sin tocar
    nada).
  - Errores de base de datos traducidos a `fieldErrors` en español
    (constraints, FKs y trigger de barrios), `42501` → `forbidden`, resto →
    `unknown`. Nunca se devuelve el mensaje de Supabase.
  - `completeOnboarding` fija `onboarding_completed_at` solo si sigue nulo
    (dos peticiones simultáneas no pisan el timestamp) y es idempotente.
- `vitest.config.ts`: alias de `server-only` a su propio `empty.js` (el que
  Next.js usa en servidor). Sin dependencias nuevas.
- Correcciones documentales de la auditoría (A.4): cabecera de
  `types/database.ts` (tipos manuales, todas las migraciones),
  `docs/ARCHITECTURE.md` (`/bienvenida/...`, `/perfil` propio),
  `docs/SUPABASE_VALIDATION.md` (119 aserciones, `05`/`06` sin ejecutar en
  remoto), `docs/ROADMAP.md` (2.0 cerrada en `feb08e4`) y
  `docs/DATABASE.md` (ciudad y universidad en `housing_preferences`;
  comentarios de migraciones inexactos).

**Decisiones técnicas registradas**
- `seeking_status`: la base de datos no distingue el default `flexible` de
  una elección real. La elección explícita se garantiza en la entrada
  (`profileCreateSchema` lo exige sin default); la UI de 2.3 no debe
  preseleccionarlo. No hay migración para marcarlo.
- Nuevo código de error `not_found` en `ServiceResult`:
  `updateHousingPreferences` sin fila que actualizar (las preferencias no
  existen todavía). No cambia la semántica de los demás.
- Coherencia universidad–ciudad (`universities.city_id` frente a
  `housing_preferences.city_id`): **no se comprueba en 2.1**. La base de
  datos no la exige, un UPDATE parcial necesitaría leer la ciudad guardada,
  y no es una regla de producto decidida. Se valora en 2.5 junto al
  selector de universidad.
- Los servicios reciben el cliente Supabase como parámetro (el de
  `lib/supabase/server.ts`, comprobado con `tsc`), lo que permite testearlos
  con un cliente simulado.

**Resultados reales**: `test` 152/152 (39 anteriores + 61 de esquemas + 52
de servicios); `format`, `lint`, `typecheck`, `build` y `test:db` 119/119
en verde. Pruebas de mutación en los servicios (reactivar una cuenta
eliminada, no exigir ciudad, INSERT sin `profile_id` de la sesión, editar
un perfil eliminado, completar sin condición `is null`): cada una hace
fallar su test.

**Qué queda**: 2.2 (enrutamiento de Auth, `?next=`, logout, pantalla de
cuenta desactivada). No empezada.

---

## 2026-09-29 — Sesión 9: Fase 2.0 — endurecimiento de datos y RLS de preferencias

**Decisiones del usuario para Fase 2** (tras la auditoría): ciudad y
universidad siguen en `housing_preferences`; foto/Storage y borrado de cuenta
fuera de Fase 2; nada de perfiles de terceros (H3/H4); `?next=` (M6) en 2.2;
PKCE sin cambios; onboarding en `/bienvenida/...` y `/perfil` para el perfil
propio; cuenta con `deleted_at` → pantalla de cuenta desactivada; tipos
manuales; alta real y E2E en 2.8; no tocar `roomly-validation`.

**Qué se hizo** (solo base de datos, tests, tipos y docs)
- Migración nueva `20260929120000_phase2_data_hardening.sql`:
  - `profiles`: `chk_profiles_full_name` (1–100 tras `btrim`),
    `chk_profiles_bio_length` (≤ 500), `chk_profiles_avatar_url` (`https://`,
    ≤ 2048).
  - `housing_preferences`: `field_of_study` (1–120); `budget_max` ≥ 0 (con
    los ya existentes `budget_min` ≥ 0 y mínimo ≤ máximo); compañeros ≥ 0
    con mínimo ≤ máximo.
  - **Sin techos, por decisión del usuario**: se propusieron topes de
    presupuesto, de compañeros y de número de barrios, y se eliminaron
    porque la especificación no los define. Cualquier límite futuro será
    una decisión explícita de producto.
  - GRANT por columnas en `housing_preferences`: `anon` sin privilegios;
    `authenticated` inserta columnas de datos y actualiza las mismas sin
    `profile_id`. Política `housing_preferences_own` recreada `to
    authenticated` con `using` y `with check` explícitos (siguen 35).
  - Integridad de `preferred_neighborhood_ids` con triggers (decisión del
    usuario, sin tabla intermedia): `trg_housing_preferences_neighborhoods`
    rechaza barrios inexistentes, `NULL`, de otra ciudad o sin ciudad;
    `trg_neighborhoods_not_referenced` (`SECURITY DEFINER`) impide borrar,
    cambiar de `id` o mover de ciudad un barrio en uso, sin cascadas. Un
    CHECK no puede expresarlo (sin subconsultas) y no hay FKs sobre arrays
    (comprobado en PostgreSQL 16).
- Tests nuevos: `tests/db/05_housing_preferences.sql` (50 aserciones,
  incluidas las que comprueban que valores altos de presupuesto,
  compañeros y número de barrios se aceptan) y
  `tests/db/06_profiles_constraints.sql` (11).
- Pruebas de mutación (copias locales, nunca en remoto): sin la migración
  fallan `05` y `06`; sin `trg_housing_preferences_neighborhoods` falla
  `HP11`; sin `trg_neighborhoods_not_referenced` falla `HP-inv1`; con la
  función inversa como `SECURITY INVOKER` falla `HP-inv4` (el admin no ve
  las preferencias ajenas y el borrado pasaría).
- `types/database.ts`: `profiles.Insert` ya no admite `role`, `deleted_at`,
  `created_at` ni `updated_at` (reflejo del GRANT de INSERT);
  `housing_preferences.Insert` sin `updated_at` y `Update` sin `profile_id`.
- Docs: `docs/DATABASE.md` y `docs/SECURITY.md` (§"Fase 2.0"),
  `docs/ROADMAP.md`, `docs/TESTING.md`, `CLAUDE.md`, `README.md`.

**Resultados reales**: `test:db` 119/119 en PostgreSQL 16 local (58
anteriores + 61 nuevas). 18 tablas, 35 políticas, RLS en todas, ninguna
función de `public` sin `search_path` fijo. `format`, `lint`, `typecheck`,
`test` 39/39 y `build` en verde. No se ha ejecutado nada contra
`roomly-validation`.

**Validación remota: pendiente, sin resolver en esta sesión**
- La migración `20260929120000` **no está aplicada** en `roomly-validation`.
- `tests/supabase/apply-migrations.sh` aplica todo el esquema desde cero y
  se niega si ya existe: **no debe usarse** (ni forzarse) sobre un esquema
  existente.
- Con el workflow actual, la suite SQL remota fallaría en `05`/`06`, y
  `preflight.sql` (P1–P5) no conoce los objetos nuevos. Antes de 2.8 hace
  falta una estrategia de migración incremental.

**Fuera de 2.0**: Storage, borrado, Auth, callback, UI, servicios, CI.

---

## 2026-09-29 — Sesión 8: AU4/AU5 manuales, migración `middleware.ts` → `proxy.ts` y cierre de Fase 1

**Qué se hizo**
- **AU4 y AU5 manuales** contra `roomly-validation`, ejecutados por el
  propietario en su PC (`npm run dev` + `.env.local` con URL y clave
  pública). Resultado confirmado por el propietario, paso a paso:
  `/admin` sin sesión → `/login?next=…`; mensaje "Revisa tu correo";
  el enlace del email (mismo navegador, PKCE) inicia sesión; cookie
  `sb-…-auth-token` presente; `/admin` con sesión sin admin → `/`; tras
  asignar `admin` desde el SQL Editor (lo ejecutó el propietario), `/admin`
  muestra el panel. Teardown: 0 usuarios / 0 profiles.
- **Migración `middleware.ts` → `proxy.ts`** (Next.js 16.3.6, según
  `node_modules/next/dist/docs/.../upgrading/version-16.md` y `proxy.md`):
  renombrado del archivo y del export `middleware()` → `proxy()`. Sin
  codemod y sin cambios de lógica, `matcher`, imports ni Supabase.
  - Build: `ƒ Proxy (Middleware)`, sin aviso de deprecación.
    `functions-config-manifest.json` registra `/_middleware` con
    `runtime: "nodejs"` y el mismo `matcher`; `middleware-manifest.json`
    ya no tiene entradas Edge. Antes era Edge (`server/edge/…`).
  - No hay `export const runtime` (en `proxy` no se puede configurar).
  - Validación local con `next start` y un Supabase **simulado** en
    `localhost:54321` (sin tocar `roomly-validation`): `/admin` sin sesión
    → 307 `/login?next=%2Fadmin`; sesión con rol no admin → 307 `/`;
    rol admin → 200 con el panel; token caducado → el proxy llama a
    `/auth/v1/token?grant_type=refresh_token` y devuelve `Set-Cookie`
    (en `/admin` y en `/`); callback sin `code` o con `code` inválido →
    `/login?error=auth_callback_failed`; `tests/supabase/auth-redirects.sh`
    6/6 (AU3a–e, AU5a).
  - Comentarios que citaban `middleware` actualizados
    (`app/admin/layout.tsx`, `lib/supabase/server.ts`, cabecera de
    `proxy.ts`). Solo comentarios.
- **Reconciliación documental** de Fase 1: `docs/ROADMAP.md`,
  `docs/TESTING.md`, `docs/ENVIRONMENT.md`, `docs/ARCHITECTURE.md`,
  `docs/SUPABASE_VALIDATION.md`, `CLAUDE.md`, `README.md`, `HANDOFF.md`
  (aviso de documento histórico) y `ROOMLY_MASTER_SPEC.md` (nota de la
  decisión 16). Se corrigen afirmaciones obsoletas: "nunca ejecutado
  contra Supabase real", "CI nunca ejecutado en GitHub", "Foundation sin
  commitear", "7/7 tests" y la migración a `proxy` como pendiente.

**Resultados reales**: `format` sin cambios · `lint` ✅ · `typecheck` ✅ ·
`test` 39/39 ✅ · `build` ✅. CI (`ci.yml`) en GitHub: 6 runs, todos
`success` (PR y push a `master` de los PRs #1, #2 y #3), comprobado vía API.

**Decisiones del usuario**
- Google OAuth y Apple OAuth: **diferidos**.
- E2E/Playwright en CI: **diferido a Fase 2**, cuando existan flujos
  reales de usuario.
- No se repite ninguna prueba que escriba en `roomly-validation`.
- El alta real de un usuario nuevo por magic link **no se validó**
  (signups desactivados en `roomly-validation`; el usuario de AU4 se creó
  desde el dashboard). Se **traslada a Fase 2**, junto con Registro y la
  creación de perfil tras el primer login (M6). El login sí está validado.
- Con eso, **Fase 1 (Foundation) queda completada** en `docs/ROADMAP.md`.

**Consecuencia conocida (no bloqueante)**: el proxy pasa de Edge a
Node.js. En Vercel se ejecutará como función Node y no como Edge
Middleware (latencia/región/coste por petición pueden cambiar). Se medirá
cuando haya despliegue.

**Qué queda**
- Hallazgos abiertos de la auditoría, sin cambios y fuera del checklist de
  Fase 1: H3, H4, H6, H7, M1, M3, M4, M6, L2, D14, PR8.

**Próximos pasos**: esperar confirmación del usuario antes de empezar
Fase 2. Fase 2 **no** se ha iniciado.

---

## 2026-09-28 — Sesión 7: validación contra Supabase real completada (checkpoint previo a Fase 1 cerrado)

**Qué se hizo**
- Proyecto de validación `roomly-validation` (Frankfurt, PostgreSQL 17.6),
  con la marca de identidad F1 escrita y leída desde el propio proyecto.
  Migraciones + seed aplicados por el propietario; P0–P5 en verde.
- Workflow `Supabase validation` llevado a `master` (PR #2, `9ce2b8d`). El
  run #1 terminó `success` pero con las suites **skipped** (un job omitido en
  la cadena de `needs` arrastraba a los demás); corregido con 3 condiciones
  `if` en el workflow (`241a274`, PR #3, merge `50c8d24`).
- Run #2 (`36493446123`, sobre `50c8d24`, `apply_migrations=false`): todos
  los jobs ejecutados, ninguno skipped salvo `migrate` (intencionado).

**Resultados reales**
- Guarda F1 ✅ · P0–P5 ✅.
- Suite SQL (`tests/db`, roles reales, `ROLLBACK`): **58/58**.
- Suite supabase-js (PostgREST + JWT reales de usuarios de Auth): **46/46**.
- AU3/AU5 (redirects de la app): **6/6**.
- C1, C2, C3, H5 y M2 validados contra Supabase real. Sin vulnerabilidades
  nuevas en el alcance auditado.
- Teardown: la suite terminó sin errores y la comprobación independiente
  posterior en el SQL Editor dio 0 usuarios de prueba y 0 filas en
  profiles, rooms, conversations, messages y reports.

**Hallazgos registrados (sin cambios)**
- PR8: `upsert()` de `profiles` lo rechaza Supabase (`42501`): restricción de
  diseño para Fase 2 (INSERT + UPDATE o creación desde servidor); no se
  relajan permisos.
- H3 confirmado en real: `anon` lee `public_profile_previews` con `role`.
  Sigue pendiente de decisión, igual que H6, H7, Storage y `middleware` →
  `proxy` (este último, resuelto en la sesión 8).

**Próximos pasos**: cerrar los puntos que quedan del checklist de Fase 1
(`docs/ROADMAP.md`) antes de empezar Fase 2. No se ha empezado ninguna fase.

---

## 2026-09-26 — Sesión 6: preparación de la validación contra Supabase real (checkpoint previo a Fase 1)

**Qué se hizo** (solo tests/infraestructura/docs; sin cambios de producto,
migraciones ni RLS)
- `tests/supabase/`: guarda de destino (`guard.sh`), aplicación única y
  transaccional de migraciones + seed, P1–P5 (`preflight.sql`), suite
  `tests/db` con roles reales dentro de `BEGIN … ROLLBACK`, y AU3/AU5 contra
  la app local.
- `tests/integration/supabase-validation.test.ts` +
  `vitest.integration.config.ts` (`npm run test:supabase`, fuera de
  `npm run test`): PR1–PR12, CH1–CH11, RO1–RO9, RE1–RE9, AU2 con JWT reales;
  `service_role` solo para preparar/limpiar y PR11/RO7; teardown respetando
  H6.
- Workflow manual `.github/workflows/supabase-validation.yml`.
- `docs/SUPABASE_VALIDATION.md` (configuración, secrets, matriz, pasos
  manuales AU4/AU5, D14).

**Verificado en local** (PostgreSQL 16 simulando el proyecto): migraciones
aplicadas una vez y rechazo de la segunda aplicación; P1–P5 en verde (y P2/P4
detectan un FORCE RLS y un GRANT de tabla completo reintroducidos); suite SQL
58/58 sin dejar rastro tras el ROLLBACK; la guarda rechaza URL/DB de otro
proyecto y variables ausentes; AU3/AU5 en verde contra `next start` y en rojo
sin app. La suite supabase-js **no** se ha ejecutado todavía: necesita el
proyecto real.

**Problema encontrado y corregido en la propia infraestructura**: P5
marcaba como falso positivo las funciones de la extensión `pgcrypto`;
ahora excluye las funciones que pertenecen a extensiones (como el linter de
Supabase).

**Hallazgo nuevo registrado (INFO, sin corregir)**: D14 — cookies de sesión
de `@supabase/ssr` con `httpOnly: false`; el comentario "HTTP-only" del
callback es inexacto (ver `docs/SUPABASE_VALIDATION.md`).

**Revisión de la infraestructura (F1–F5), corregido con autorización**
- F1 (MEDIUM): la guarda solo comprobaba coherencia local de los secrets.
  Ahora exige la marca `COMMENT ON DATABASE postgres IS 'roomly-validation'`
  leída del propio proyecto en todos los puntos de entrada (guard.sh, P0,
  suite SQL, migraciones, suite supabase-js), sin fallback. Auto-test
  `tests/supabase/guard-selftest.sh`: 16/16, y detecta la guarda mutada.
- F2: limpieza solo de emails `^roomly-val-[0-9a-f]{8}-[a-z]@example\.com$`.
- F3: solo conversaciones registradas por la ejecución (o, de ejecuciones
  interrumpidas, con exclusivamente participantes de prueba).
- F4: `expectOk` exige `error === null`.
- F5: RO3/RO5/RO6 exigen `42501` + mensaje `room_moderation:` del trigger.

**Pendiente**: crear `roomly-validation`, poner la marca de identidad
(confirmar que `postgres` puede hacer `comment on database`), crear los
secrets, llevar el workflow a `master` (requisito de `workflow_dispatch`) y
ejecutar. Resultados reales: se añadirán aquí.

---

## 2026-09-26 — Sesión 5: auditoría inicial en Claude Code + correcciones de seguridad y CI autorizadas

**Qué se hizo**
- Auditoría inicial completa (documentación + código + SQL). Por primera
  vez se aplicaron las migraciones en un PostgreSQL 16 real (con un shim
  mínimo de Supabase): aplican limpias, 18 tablas / 35 políticas / 15
  índices / RLS en las 18. Cada hallazgo se demostró con un ataque real.
- Correcciones autorizadas por el usuario, en una **migración nueva**
  (`supabase/migrations/20260926120000_security_fixes.sql`, las dos
  anteriores intactas):
  - **C1 (CRITICAL)**: cualquier usuario podía crear su propio perfil con
    `role = 'admin'` (la corrección de la sesión 3 solo cubría `UPDATE`).
    → `GRANT INSERT` por columnas + `with check (role = 'user')`.
  - **C2 (CRITICAL)**: `messages_*` tenía `cp.conversation_id =
    cp.conversation_id` (el `conversation_id` sin cualificar se resolvía
    contra la subconsulta): acceso a todas las conversaciones.
  - **C3 (CRITICAL)**: recursión infinita en
    `participants_select_own_conversations` — el chat entero fallaba.
    → C2+C3: función `public.is_conversation_participant(uuid)`
    (`SECURITY DEFINER`, `search_path` vacío, sin parámetro de usuario).
  - **H5 (HIGH)**: el propietario podía reactivar una habitación
    `removed` por un admin. → trigger `trg_rooms_moderation`.
  - **M2 (MEDIUM)**: se podían crear reportes ya resueltos. → `GRANT
    INSERT` por columnas + `with check`.
- **H1 (HIGH)**: open redirect en `app/(auth)/callback/route.ts`
  (`next=@evil.com` → `evil.com`). → `lib/auth/safe-redirect.ts` + 32
  tests unitarios.
- **H2 (HIGH)**: CI solo se disparaba en push a `main` (la rama es
  `master`) y `format:check` fallaba en `types/database.ts`. → trigger a
  `master`, formato corregido, nuevo job `db-security`.
- Tests de regresión de seguridad en `tests/db/` (`npm run test:db`):
  58 aserciones, validadas con pruebas de mutación (cada vulnerabilidad
  reintroducida pone rojo su test).
- Docs actualizadas solo donde las correcciones las afectan:
  `docs/SECURITY.md`, `docs/DATABASE.md`, `docs/TESTING.md`, `CLAUDE.md`.

**Resultados reales**: `format:check`, `lint`, `typecheck` ✅ · `test`
39/39 ✅ · `build` ✅ (también con env vacía) · `test:db` 58/58 ✅ ·
`test:e2e`: falla con la config del repo por la versión de Chromium del
entorno cloud (1194 instalado, 1243 requerido); con Chromium preinstalado
2/2 ✅. Detalle en `docs/TESTING.md`.

**Decisiones técnicas**
- `removed` pasa a ser estado exclusivo de moderación: el propietario
  tampoco puede fijarlo él mismo (tiene `paused` y el soft-delete).
- Consecuencia de C1 (ya existía para UPDATE, ahora también para INSERT):
  cambiar `role`/`deleted_at` solo se hace con `service_role` desde el
  servidor, nunca desde el cliente, tampoco siendo admin.
- `next dev` (Next 16.3) añade un bloque `nextjs-agent-rules` a
  `CLAUDE.md` cuando detecta un agente de IA; se revirtió manualmente, no
  se ha decidido todavía si desactivarlo (`agentRules: false`) o aceptarlo.

**Qué sigue abierto (de la auditoría, NO corregido a propósito, pendiente de decisión)**
- H3: `public_profile_previews` expone a `anon` nombre, avatar, id y
  `role` de todos los usuarios.
- H4: cualquier usuario autenticado lee `date_of_birth` de todos.
- H6: borrar una cuenta falla por FKs sin `ON DELETE` (`messages`,
  `reports`, `admin_action_logs`, `conversations.match_id`...).
- H7: no existe modelo de bloqueo entre usuarios ni baneo por admin.
- M1: el rate limit de `interests` se elude borrando y reinsertando.
- M3: Storage (buckets/políticas) solo documentado. M4: escritura directa
  vía PostgREST salta Zod; sin límites de longitud en BD. M6: login ignora
  `?next=` y no hay creación de perfil tras el primer login.
- L1 `middleware` → `proxy`; L2 bloque de `next dev` en `CLAUDE.md`.
- Contradicción documental no reconciliada: HANDOFF/ROADMAP/CLAUDE.md
  dicen que Foundation está sin commitear, pero está en `d1089aa`.

**Próximos pasos**: revisión de estas correcciones por el usuario, push
(solo con su autorización), y decisión sobre los puntos abiertos antes de
cerrar Fase 1. Fase 1 NO se ha empezado a cerrar en esta sesión.

---

## 2026-09-25 — Sesión 4: Fase 1 (Foundation) en progreso — interrumpida antes de terminar la verificación, transferencia a Claude Code local

**Qué se hizo**
- Leídos `CLAUDE.md`, `ARCHITECTURE.md`, `DATABASE.md`, `SECURITY.md`, `ROADMAP.md`, `PROGRESS.md` antes de tocar nada (tal como pedía el Prompt 02).
- Scaffold real de Next.js 16.3.6 + React 19.2.8 + TypeScript + Tailwind v4 generado con `create-next-app` (no inventado), fusionado con la estructura de carpetas de Fase 0 sin perder `CLAUDE.md`/`docs/`/`supabase/`.
- Dependencias instaladas de verdad: `@supabase/ssr`, `@supabase/supabase-js`, `zod`, `server-only`, `clsx`, `tailwind-merge`, `vitest`, `@vitejs/plugin-react`, `@playwright/test`, `prettier`, `eslint-config-prettier`. Conflicto real de peer dependency entre `vitest@5` y `@types/node@20` encontrado y corregido subiendo a `^22`.
- Implementado: `lib/env.ts` (validación Zod perezosa), `lib/supabase/{client,server,admin}.ts`, `middleware.ts` (sesión + primera capa de protección de `/admin`), `app/admin/layout.tsx` (segunda capa: rol real), `types/database.ts` (escrito a mano desde el SQL), login con magic link + Google, callback route, `app/(auth)/registro` como alias, layout/home/404/error, componentes UI mínimos (`Button`/`Input`/`Card`), nav base, `vitest.config.ts` + 2 tests reales, `playwright.config.ts` + 1 spec de humo, ESLint+Prettier integrados, workflow de CI en `.github/workflows/ci.yml`.
- Verificación ejecutada, en orden, con resultados **reales**:
  1. `npm run lint` → **paso** (exit 0).
  2. `npm run typecheck` → **falló primero**: `types/database.ts` no incluía el campo `Relationships` que exige `GenericTable`/`GenericView` de `@supabase/postgrest-js` (confirmado leyendo el código fuente real instalado en `node_modules/@supabase/postgrest-js/src/types/common/common.ts`, no adivinado) — sin él, cualquier `.from(tabla).select()` resuelve a `never` en vez de dar un error claro donde se usa. Corregido añadiendo `Relationships: []` a las 18 tablas y a la vista. Reejecutado → **paso** (exit 0).
  3. `npm run test` → **paso**, 7/7 tests (`tests/unit/env.test.ts`, `tests/unit/cn.test.ts`).
  4. `npm run build` → **paso** (exit 0), generó las 6 rutas esperadas (`/`, `/_not-found`, `/admin`, `/callback`, `/login`, `/registro`). Con un aviso relevante: **Next.js 16 ha deprecado la convención `middleware.ts` en favor de `proxy.ts`** (confirmado leyendo `node_modules/next/dist/docs/.../proxy.md`, la documentación real incluida en el paquete instalado — no memoria de entrenamiento, que no cubre Next.js 16). Se estaba evaluando si renombrar cuando la conversación se desvió a preparar esta transferencia.

**Qué queda pendiente — exactamente, sin adornar**
- **`npx playwright install` nunca se llegó a ejecutar en esta sesión.** Se sabe por sesiones anteriores que el CDN de navegadores de Playwright no está en la lista de dominios permitidos de este sandbox, pero esta sesión concreta no lo confirmó empíricamente.
- **Decisión sobre `middleware.ts` → `proxy.ts` sin tomar.** Next.js 16.0.0 lo deprecó (no lo eliminó); el build sigue funcionando con `middleware.ts` tal cual, pero es deuda técnica desde el primer commit de Foundation si no se migra pronto.
- **Esta actualización de PROGRESS.md/ROADMAP.md/ENVIRONMENT.md/TESTING.md se hace ahora, pero no se completó el resto del checklist de cierre de Fase 1**: no se ha hecho `git diff` de revisión final, no se ha hecho comprobación formal de secretos previa a commit (sí se hizo una búsqueda de secretos amplia como parte de la propia tarea de transferencia, ver `HANDOFF.md`), y **no se ha creado el commit de Foundation**.
- Los 36 archivos de Foundation (todo lo implementado arriba) **siguen sin commitear** — aparecen como `Untracked files` en `git status`. Esto es intencional: el propio Prompt 02 pedía crear el commit "únicamente si las comprobaciones relevantes han pasado", y el checklist no se cerró del todo (playwright, decisión proxy, revisión final).
- Auth/RLS: todo el código compila y pasa build, pero **nunca se ha ejecutado contra un proyecto Supabase real** — cero garantía de que funcione hasta que exista un proyecto real y credenciales.

**Decisión de esta sesión**: en vez de continuar cerrando Fase 1 en este sandbox, el usuario pidió preparar una transferencia completa y fiel del proyecto a Claude Code local (ver `HANDOFF.md`) para continuar allí, con acceso real a red/Supabase/Playwright que este sandbox no tiene. No se ha inventado ningún resultado no ejecutado para "cerrar" Fase 1 artificialmente.

**Próximos pasos (para quien continúe, aquí o en Claude Code)**
1. Ejecutar `npx playwright install` de verdad y documentar el resultado real.
2. Decidir y, si procede, migrar `middleware.ts` → `proxy.ts` (Next.js 16).
3. Cerrar el checklist de Fase 1: `git diff`, comprobación de secretos, commit de Foundation.
4. Crear un proyecto Supabase real (región EU), aplicar las migraciones, y validar auth/RLS de extremo a extremo — el primer punto verdaderamente bloqueante para dar Fase 1 por completada según sus propios criterios de aceptación (`docs/ROADMAP.md`).

---

## 2026-09-25 — Sesión 3: comprobación final de coherencia, arquitectura confirmada

**Qué se hizo**
- Usuario confirma la arquitectura tal cual (incluido el mapeo de
  nombres de la sesión 2). Auditoría de coherencia entre
  `ARCHITECTURE.md`, `DATABASE.md`, `SECURITY.md`, `ROADMAP.md` y el SQL,
  releyendo ambas migraciones y `seed.sql` desde el sandbox antes de
  tocar nada.
- 5 problemas reales encontrados y corregidos directamente en el SQL:
  3 columnas de filtro que faltaban en `rooms` (`pets_allowed`,
  `smoking_allowed`, `students_only` — sección 13 del brief), 3 índices
  que faltaban (`idx_rooms_features`, `idx_favorites_room`,
  `idx_conversation_participants_user`), y un escalado de privilegios
  real en dos políticas RLS (`profiles_update_own`,
  `participants_update_own` sin `with check` — cualquier usuario podía
  auto-promocionarse a admin). Corregido con restricciones de columna
  (`GRANT`/`REVOKE`), independientes de RLS. Reforzado también el
  `INSERT` de `admin_action_logs`.
- Documentado cada hallazgo en `docs/DATABASE.md` y `docs/SECURITY.md`
  (sección "Comprobación de coherencia final" en ambos).
- Sin cambios de naming, sin tablas nuevas, sin funcionalidad añadida —
  tal como se pidió explícitamente.

**Qué queda**
- Confirmación final del usuario para ejecutar el "Prompt 02" (Fase 1).

**Problemas encontrados**: los 5 de arriba — el de escalado de
privilegios era el único con severidad real; el resto son índices y
columnas de filtro que faltaban, sin riesgo de seguridad.

**Decisiones técnicas**: ninguna decisión de arquitectura cambiada;
correcciones puntuales de schema/RLS.

**Próximos pasos**
1. Ejecutar Prompt 02 / Fase 1: `create-next-app`, proyecto Supabase
   real, aplicar migraciones (ya con las 5 correcciones), autenticación,
   CI.

---

## 2026-09-25 — Sesión 2: arquitectura contra el stack/esquema pedidos explícitamente

**Qué se hizo**
- Releído el repo completo (`CLAUDE.md`, `ROADMAP.md`, `PROGRESS.md`,
  `README.md`, y también `ARCHITECTURE.md`/`DATABASE.md`/`SECURITY.md`
  antes de editarlos) — confirmado que el estado de la sesión 1 persiste
  íntegro en el sandbox.
- `ARCHITECTURE.md`: añadidas secciones explícitas que faltaban —
  Separación frontend/backend, Autorización (separada de
  Autenticación), Administración, Notificaciones, Analytics (PostHog,
  captura cliente+servidor, funnel). Corregida una referencia obsoleta
  al árbol de carpetas. Añadida nota sobre ESLint/Prettier.
- `DATABASE.md`: añadido mapeo explícito entre los nombres de tabla
  pedidos ahora (`users`, `preferences`, `verification_status`) y las
  decisiones ya tomadas en la sesión 1 (`auth.users`+`profiles`,
  `housing_preferences`, sin tabla de verificación) — con opción
  explícita de revertir si se prefiere.
- `SECURITY.md`: añadida tabla que mapea cada uno de los 5 requisitos de
  RLS pedidos explícitamente a las políticas concretas que lo cumplen.
- `CLAUDE.md`: añadidos ESLint/Prettier al stack documentado.
- El esquema SQL no se ha tocado — ya cubría todo lo pedido; solo hacía
  falta documentarlo de forma más explícita y reconciliar el naming.

**Qué queda**
- Confirmación del usuario sobre el mapeo de nombres de tabla (mantener
  `auth.users`+`profiles`/`housing_preferences`/sin `verification_status`,
  o forzar los nombres literales).
- Confirmación para empezar Fase 1.

**Problemas encontrados**
- Ninguno nuevo.

**Decisiones técnicas**
- Ninguna decisión de esquema cambiada; se documentaron con más detalle
  las ya tomadas en la sesión 1.

**Próximos pasos**
1. Usuario confirma la arquitectura final (incluido el mapeo de
   nombres) o pide ajustes puntuales.
2. Si confirma: Fase 1.

---

## 2026-09-25 — Sesión 1: Fase 0 (arquitectura)

**Qué se hizo**
- Inspección del entorno: Node v22.22.2, npm 10.9.7, Python 3.12.3,
  git 2.43.0, Ubuntu 24.04. Sin pnpm/yarn/Docker instalados.
- Verificación de conectividad: registro npm accesible (confirmado con
  `npm view next` → 16.3.6), git funciona contra GitHub real
  (`git ls-remote` correcto). Supabase, Vercel y el CDN de navegadores de
  Playwright están bloqueados por la configuración de red de este sandbox.
- Diseño completo de arquitectura, esquema de base de datos (2 migraciones
  + seed) y estructura de carpetas.
- **Revisión crítica de CTO aplicada antes de entregar** (no después): se
  eliminaron 2 tablas por sobreingeniería (`verifications`,
  `notification_preferences`), se corrigieron 3 riesgos de seguridad
  (RLS de `profiles` demasiado abierta, falta de rate limit en
  `interests`, ausencia de una tabla separada para direcciones exactas),
  y se hizo explícito el mecanismo de escalabilidad del matching. Detalle
  completo en `docs/DATABASE.md` y `docs/ARCHITECTURE.md`.
- Documentación creada: `README.md`, `CLAUDE.md`, este archivo,
  `docs/ARCHITECTURE.md`, `docs/DATABASE.md`, `docs/ROADMAP.md`,
  `docs/TESTING.md`, `docs/SECURITY.md`, `docs/ENVIRONMENT.md`.
- `.gitignore` y `.env.example` creados desde el primer commit.
- Repositorio git inicializado con el primer commit.

**Qué queda**
- Confirmación del usuario para empezar Fase 1.
- Fase 1 en sí: `create-next-app`, proyecto Supabase real, aplicar las
  migraciones, autenticación funcionando, CI básica.

**Problemas encontrados**
- Este sandbox no tiene salida de red hacia `supabase.com`, `vercel.com`
  ni el CDN de Playwright. Se puede escribir/testear código (unit,
  integración con mocks) aquí, pero aprovisionar Supabase real, hacer
  deploy a Vercel, y correr tests E2E con Playwright necesitará
  credenciales del usuario, o ejecutarse desde su máquina/GitHub Actions.
- Probar políticas RLS de verdad requiere una base de datos Postgres real
  (Supabase local con Docker, no disponible aquí, o un proyecto de test) —
  las políticas del borrador son eso, un borrador, hasta que se validen
  con tests de integración por rol en Fase 1.

**Decisiones técnicas** (detalle y justificación en los docs correspondientes)
- `auth.users` + `profiles` en vez de una tabla `users` propia.
- Capa de servicios (`lib/services/*`) separada de Server Actions, para
  reutilizar lógica de negocio cuando exista la app móvil sin duplicar
  backend.
- Motor de matching como función TypeScript pura, pesos en config
  versionada en git (no en tabla, no todavía).
- Chat vía Supabase Realtime, sin infraestructura de websockets propia.
- Magic link recomendado como método "email" (menos superficie de
  ataque); Mapbox recomendado sobre Google Maps (coste).
- Edad mínima 18 como constraint técnico por defecto — REQUIERE REVISIÓN LEGAL.
- Soft-delete es una herramienta de producto, no de cumplimiento RGPD —
  el borrado real/anonimización requiere un job aparte, REQUIERE REVISIÓN LEGAL
  para el plazo exacto.

**Próximos pasos**
1. Usuario confirma (o pide cambios sobre) esta arquitectura.
2. Si confirma: Fase 1 — `create-next-app`, guiar al usuario en la
   creación del proyecto Supabase (región EU), aplicar migraciones,
   autenticación, CI en GitHub Actions.
