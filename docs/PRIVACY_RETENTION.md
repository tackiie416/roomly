# Privacidad: borrado de cuenta y conservación de datos (sesiones 83 y 87)

**Estado:** la eliminación de la cuenta desde la app está **implementada en
local** (sesión 87, migración `20261201120000`, sección 3), **sin aplicar en
ningún Supabase real**, con los criterios provisionales que dio el propietario
el 2026-11-28. Las purgas y los plazos de conservación siguen sin decidir y
sin implementar. Ningún plazo de
este documento es una política legal: los marcados **REQUIERE REVISIÓN
LEGAL** los decide el propietario con asesoría jurídica (y, si procede, el
DPO). Nada de lo que hay aquí borra datos: las dos funciones de purga que
existen (`20261128120000`) solo las puede ejecutar service_role, la app no
las llama y no hay ningún trabajo programado que las use.

## 1. Qué datos personales guarda ROOMLY y dónde

| Tabla u objeto | Qué contiene | Cómo se borra hoy |
|---|---|---|
| `auth.users` | email y metadatos de Auth | «Eliminar mi cuenta» (sesión 87, `auth.admin.deleteUser`) o desde Supabase |
| `profiles` | nombre, fecha de nacimiento, bio, rol, `deleted_at` | Soft-delete (`deleted_at`); el borrado real cae en cascada desde `auth.users` |
| `housing_preferences` | ciudad, universidad, presupuesto, fechas | Cascada desde `profiles` |
| `compatibility_responses` | respuestas del test (incluidas tabaco y vapeo) | Cascada desde `profiles` |
| `rooms`, `room_addresses` | anuncios y dirección exacta | `delete_own_room` (la habitación) o cascada |
| `room_images` + Storage `room-images` | fotos | `removeDeletedRoomObjects`; la cascada **no** limpia Storage (riesgo aceptado, ver `docs/SECURITY.md`) |
| `interests`, `matches` | quién se interesa por quién, score | Retirar, deshacer el match, bloquear o cascada |
| `interest_log` (sesión 83) | registro de envíos de intereses (para los límites) | Cascada; `purge_interest_log()` borraría lo de más de 30 días |
| `conversations`, `conversation_participants`, `messages` | chat entre matches | Al deshacer un match o bloquear, el chat se cierra y los mensajes **se conservan sin acceso de clientes** |
| `user_blocks` (sesión 83) | quién ha bloqueado a quién | Desbloquear o cascada |
| `reports` (sesión 83) | quién reporta a quién, motivo y descripción | Sin borrado desde la app. Desde la sesión 87 (`20261201120000`) **ninguna de sus columnas de persona o habitación es FK**: al eliminar una cuenta, los reportes que hizo o recibió se conservan y su UUID queda como seudónimo. Que el destino exista al crear el reporte lo sigue exigiendo `trg_reports_integrity` (23503, mismo nombre de restricción). `delete_own_room` rechaza borrar una habitación reportada (23503), como antes con la FK |
| `admin_action_logs` | auditoría de moderación | Inmutable para todos los roles (Fase 7). Desde la sesión 85 `admin_id` no es FK: borrar al admin no lo impide y su UUID queda como seudónimo |
| `notifications` | avisos | Cascada; «Eliminar mi cuenta» |
| `account_deletion_requests` (sesión 87) | id de la cuenta, cuándo pidió la eliminación y cuándo terminó | Se conserva (sin datos de contacto) como prueba de que se atendió la solicitud; ningún cliente la lee. Plazo: **REQUIERE REVISIÓN LEGAL** |

## 2. Comportamiento actual que se mantiene

- **Deshacer un match o bloquear:** el chat se cierra para las dos personas.
  Ninguna puede leerlo ni escribir (RLS e `is_conversation_participant`).
  Los mensajes siguen en la base de datos. Lo decidió el propietario el
  2026-11-26: no se reabre el acceso.
- **Desbloquear** no devuelve nada de lo borrado (match, intereses, chat).
- **Cuenta desactivada** (`deleted_at`): no escribe en ninguna tabla ni
  aparece en `/explorar`, matches o chats; sus datos siguen guardados.

- **Descargar mis datos** (sesión 86, `GET /ajustes/mis-datos`, enlace en
  `/ajustes`): un JSON con lo que la persona puede leer de sí misma con su
  propio cliente (RLS de siempre, sin service_role,
  `lib/services/data-export.ts`). Incluye la cuenta (id y email), el perfil,
  las preferencias, el test, sus habitaciones con el número y la fecha de sus
  fotos, los intereses que envió (fecha y, si la hay, la habitación), cuántos
  recibió, sus matches (fecha y puntuación), los mensajes que escribió,
  sus bloqueos (solo la fecha) y sus reportes (motivo, descripción, estado y
  fechas). Funciona también con la cuenta desactivada.
  - **Mensajes (sesión 87, versión 2 del formato):** todos los que escribió,
    **también los de chats cerrados**, con `export_own_messages()`
    (SECURITY DEFINER, solo filas con `sender_id = auth.uid()`, EXECUTE solo
    de authenticated). Cada conversación sale con un número correlativo y si
    está cerrada; nunca su id, el de la otra persona ni sus mensajes. La
    lectura del chat en la app no cambia: un chat cerrado sigue sin poder
    abrirse.
  - **Limitaciones (se dicen en el propio JSON, en `notes`):** no incluye
    datos ni identificadores de otras personas (a quién envió intereses, con
    quién tiene match, a quién bloqueó o reportó, ni lo que le escribieron),
    las notas de moderación, los secretos (tokens, claves) ni datos internos
    como las rutas de Storage. Las fotos salen como número y fecha, no como
    archivo. Tampoco hay dirección exacta: la app no la recoge (R2). No
    incluye lo que guardan fuera de las tablas Supabase Auth (registros de
    acceso), la plataforma de alojamiento o las copias de seguridad.
  - Si el formato basta para el derecho de acceso y la portabilidad (art. 15
    y 20 RGPD) **REQUIERE REVISIÓN LEGAL**.

## 3. Eliminación de la cuenta (sesión 87, implementada en local)

Criterios provisionales del propietario (2026-11-28): la persona puede pedir
la eliminación; se borran o anonimizan sus datos personales; se conservan los
registros de seguridad y auditoría solo cuando hace falta, con el actor
seudónimo; no quedan cuentas ni sesiones válidas; se revoca el acceso a chats
y datos privados; el proceso es idempotente; no se hace ningún borrado
irreversible en entornos reales; y no se inventan obligaciones legales (los
puntos legales están en la sección 5).

**Dónde:** `/ajustes/eliminar-cuenta` (también desde `/cuenta-desactivada`).
Sin JavaScript: hay que escribir «ELIMINAR» y marcar una casilla, y lo
comprueba el servidor (`lib/services/account-deletion.ts`, esquema estricto:
un campo de más, como un id, se rechaza). El id es siempre el de la sesión.

**Orden** (`deleteOwnAccount`; cada paso se puede repetir y, si uno falla, la
cuenta queda desactivada y la solicitud pendiente: volver a pedirlo continúa
donde se quedó):

1. `request_account_deletion(uid)`: pone `deleted_at` (la cuenta deja de
   escribir y de ser visible en el acto) y anota la solicitud en
   `account_deletion_requests`. Devuelve sus habitaciones.
2. **Storage primero:** `removeAccountRoomObjects` vacía la carpeta de cada
   habitación, solo si es suya, la cuenta está desactivada y hay una
   solicitud pendiente, y solo informa de una limpieza completa si el listado
   final está vacío.
3. `delete_account_data(uid)`, en una transacción: vuelve a comprobar Storage
   (si queda una foto, 55000 y no borra nada) y borra sus mensajes, su
   participación en chats, sus matches (los triggers cierran esos chats),
   intereses enviados y recibidos, `interest_log`, bloqueos en los dos
   sentidos, favoritos, avisos, test, preferencias y habitaciones (con sus
   fotos y direcciones en cascada). Anonimiza el perfil (nombre «Cuenta
   eliminada», sin bio ni avatar, fecha de nacimiento ficticia, sin avisos)
   hasta el paso 4.
4. `auth.admin.deleteUser(uid)`: borra el usuario de Auth, sus sesiones y sus
   tokens de refresco; el perfil anonimizado cae en cascada.
5. `complete_account_deletion(uid)`: marca la solicitud como completada (solo
   si el perfil ya no existe).
6. La Server Action borra las cookies de este navegador y lleva a
   `/cuenta-eliminada` (pública).

**Qué se conserva, y por qué:**

- **Reportes** que hizo o recibió (moderación y seguridad), con su UUID como
  seudónimo: ya no son FK (`20261201120000`).
- **Auditoría de admin** (`admin_action_logs`), íntegra e inmutable, con el
  UUID del admin como seudónimo (sesión 85, `20261130120000`).
- **Los mensajes que le escribieron otras personas**, en el chat ya cerrado:
  son también datos de esa otra persona y siguen el régimen de los chats
  cerrados (sección 4). Sus propios mensajes sí se borran.
- **La solicitud** (`account_deletion_requests`): id y fechas.

**Privilegios:** las tres funciones son SECURITY DEFINER con `search_path`
vacío y EXECUTE solo de service_role; la tabla de solicitudes no la lee ni
escribe ningún cliente (RLS con una política de denegación). service_role se
usa en `account-deletion.ts` solo para esas tres rpc y `deleteUser`, y lo fija
`tests/unit/admin-client-usage.test.ts`.

**Pruebas:** `tests/db/31_account_deletion.sql` (AD0–AD8: privilegios,
clientes rechazados, idempotencia, Storage antes que las filas, qué se borra y
qué se conserva, completar después de borrar en Auth, exportación de
mensajes, reportes sin FK), `tests/unit/services-account-deletion.test.ts`,
`tests/unit/account-deletion-actions.test.ts` y E1
(`tests/e2e/local/account-deletion.spec.ts`, contra el mock).

**Limitaciones conocidas:**

- El JWT de acceso que ya tuviera el navegador sigue siendo válido hasta que
  caduca (1 h por defecto en Supabase). No sirve de nada en la app (cada guard
  pregunta a Auth con `getUser()`, que ya no conoce al usuario) ni contra la
  API: no quedan filas suyas y cualquier escritura falla. Acortar la
  caducidad es una opción de configuración de Auth.
- **Cuentas suspendidas (sesión 88, `20261202120000`, `tests/db/32`):**
  por decisión del propietario (2026-11-28), la suspensión **no** impide
  pedir ni completar la eliminación: el enlace está en `/cuenta-desactivada`
  y el proceso es el mismo. Con una eliminación pedida y sin terminar, un
  admin no puede reactivar la cuenta (dejaría activa una cuenta a medio
  borrar) y el panel la marca como «Eliminación pendiente». Al eliminarla se
  borran también sus propios mensajes, como en cualquier cuenta.
  - Se conserva, con el UUID como seudónimo: el registro de la suspensión y
    su motivo (`admin_action_logs`) y los reportes que hizo o recibió. La
    justificación propuesta es la seguridad de la plataforma y la defensa
    ante reclamaciones (interés legítimo); **REQUIERE REVISIÓN LEGAL**,
    igual que su plazo. No se ha fijado ningún plazo ni se ha cambiado
    ninguna retención real.
  - No se conserva el email ni ningún otro identificador que permita
    impedir que la persona se vuelva a registrar. Hacerlo (por ejemplo, un
    hash del email) sería una retención nueva: **REQUIERE REVISIÓN LEGAL**
    y decisión del propietario.
  - Si una cuenta con un reporte abierto debería esperar a que se resuelva
    antes de borrarse: **REQUIERE REVISIÓN LEGAL**. Hoy no espera.
- Copias de seguridad y registros de Auth o de la plataforma: fuera del
  alcance de la app (sección 5).
- Nada de esto se ha ejecutado contra un Supabase real.

## 4. Conservación de mensajes (opciones, sin decidir)

| Opción | Qué pasa | A favor | En contra |
|---|---|---|---|
| A. Conservar indefinidamente (hoy) | Los mensajes de chats cerrados se quedan | Sirve para revisar un reporte | Contra la minimización (RGPD); plazo sin justificar |
| B. Purga a los N días del cierre | `purge_closed_conversation_messages(now() - N días)` con un trabajo programado | Simple; la función ya existe y rechaza menos de 30 días | Hay que elegir N; un reporte abierto podría necesitar los mensajes |
| C. B, salvo con un reporte abierto entre las dos personas | Como B, pero sin purgar mientras haya un reporte `pending` o `in_review` | Equilibra moderación y minimización | Algo más de lógica; hay que definir qué ve un admin |

Recomendación técnica: **C**, con N decidido por el propietario y legal.
Hoy un admin **no** puede leer mensajes desde la app (ninguna política de
`messages` para admins); dar ese acceso para revisar reportes sería otra
decisión de seguridad.

`purge_interest_log()` borra el registro de intereses de más de 30 días,
que ya no cuenta para ningún límite. Es la parte menos discutible, pero
tampoco está programada.

## 5. Puntos que requieren revisión legal (borrado de cuenta y auditoría)

- Si un UUID sin cuenta asociada es un dato seudonimizado o anónimo: depende
  de lo que se conserve fuera de las tablas (copias de seguridad, logs de
  Auth y de la plataforma) y de durante cuánto tiempo.
- Base jurídica y plazo para conservar la auditoría de moderación y los
  reportes después de borrar la cuenta (interés legítimo, defensa ante
  reclamaciones, obligaciones de cooperación con autoridades).
- Los reportes que hizo o recibió una cuenta eliminada: hoy (sesión 87,
  provisional) se conservan con el UUID como seudónimo; falta el plazo.
- Los mensajes de chats cerrados (sección 4), incluidos los que otras
  personas escribieron a una cuenta eliminada.
- El texto que se enseña al eliminar la cuenta sobre lo que se conserva
  (`/ajustes/eliminar-cuenta`): es un borrador técnico.
- Si una cuenta suspendida o con un reporte abierto puede eliminarse sin
  esperar (sección 3).
- Plazo de conservación de `account_deletion_requests`.
- Plazo para atender la solicitud: hoy es inmediata; si falla a medias,
  queda pendiente hasta que la persona lo reintente (no hay reintento
  automático ni aviso al equipo, más allá del registro del servidor).

## 6. Decisiones pendientes (del propietario, con legal)

1. Plazo de conservación de los mensajes de chats cerrados y si se aplica
   la opción C (**REQUIERE REVISIÓN LEGAL**).
2. Plazo de conservación de los reportes y de la auditoría de admin, y si
   se anonimizan al borrar una cuenta (**REQUIERE REVISIÓN LEGAL**).
3. Borrado de cuenta (H6): implementado desde la app en local (sesión 87)
   con los criterios provisionales. Falta confirmarlo con legal y decidir
   el plazo de conservación de lo que queda (punto 2) antes de aplicarlo en
   un proyecto real.
4. Si un admin puede leer los mensajes de un chat reportado, y con qué
   registro.
5. Cuándo se programan las purgas (Supabase cron o un trabajo externo) y en
   qué entorno; ninguna se ejecuta hasta que se decida.
6. Si la descarga de datos basta para el acceso y la portabilidad (desde la
   sesión 87 incluye los mensajes propios de chats cerrados; **REQUIERE
   REVISIÓN LEGAL**).
