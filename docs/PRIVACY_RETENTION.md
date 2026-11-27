# Privacidad: borrado de cuenta y conservación de datos (diseño, sesión 83)

**Estado: diseño técnico, sin implementar y sin aplicar.** Ningún plazo de
este documento es una política legal: los marcados **REQUIERE REVISIÓN
LEGAL** los decide el propietario con asesoría jurídica (y, si procede, el
DPO). Nada de lo que hay aquí borra datos: las dos funciones de purga que
existen (`20261128120000`) solo las puede ejecutar service_role, la app no
las llama y no hay ningún trabajo programado que las use.

## 1. Qué datos personales guarda ROOMLY y dónde

| Tabla u objeto | Qué contiene | Cómo se borra hoy |
|---|---|---|
| `auth.users` | email y metadatos de Auth | Solo desde Supabase (no hay borrado de cuenta, H6) |
| `profiles` | nombre, fecha de nacimiento, bio, rol, `deleted_at` | Soft-delete (`deleted_at`); el borrado real cae en cascada desde `auth.users` |
| `housing_preferences` | ciudad, universidad, presupuesto, fechas | Cascada desde `profiles` |
| `compatibility_responses` | respuestas del test (incluidas tabaco y vapeo) | Cascada desde `profiles` |
| `rooms`, `room_addresses` | anuncios y dirección exacta | `delete_own_room` (la habitación) o cascada |
| `room_images` + Storage `room-images` | fotos | `removeDeletedRoomObjects`; la cascada **no** limpia Storage (riesgo aceptado, ver `docs/SECURITY.md`) |
| `interests`, `matches` | quién se interesa por quién, score | Retirar, deshacer el match, bloquear o cascada |
| `interest_log` (sesión 83) | registro de envíos de intereses (para los límites) | Cascada; `purge_interest_log()` borraría lo de más de 30 días |
| `conversations`, `conversation_participants`, `messages` | chat entre matches | Al deshacer un match o bloquear, el chat se cierra y los mensajes **se conservan sin acceso de clientes** |
| `user_blocks` (sesión 83) | quién ha bloqueado a quién | Desbloquear o cascada |
| `reports` (sesión 83) | quién reporta a quién, motivo y descripción | Sin borrado desde la app. Sus FK `reporter_id`, `reported_user_id` y `reported_room_id` **no tienen cascada**: mientras exista un reporte, no se puede borrar ese perfil (ni su usuario de Auth) ni esa habitación (23503). `resolved_by` ya no es FK (sesión 85): cerrar reportes no bloquea el borrado del admin |
| `admin_action_logs` | auditoría de moderación | Inmutable para todos los roles (Fase 7). Desde la sesión 85 `admin_id` no es FK: borrar al admin no lo impide y su UUID queda como seudónimo |
| `notifications` | avisos | Cascada |

## 2. Comportamiento actual que se mantiene

- **Deshacer un match o bloquear:** el chat se cierra para las dos personas.
  Ninguna puede leerlo ni escribir (RLS e `is_conversation_participant`).
  Los mensajes siguen en la base de datos. Lo decidió el propietario el
  2026-11-26: no se reabre el acceso.
- **Desbloquear** no devuelve nada de lo borrado (match, intereses, chat).
- **Cuenta desactivada** (`deleted_at`): no escribe en ninguna tabla ni
  aparece en `/explorar`, matches o chats; sus datos siguen guardados.

## 3. Diseño del borrado de cuenta (H6, sin implementar)

H6 sigue fuera del alcance y necesita su propia decisión. Este es el orden
que tendría que seguir, porque las cascadas no limpian Storage y algunos
datos de terceros no deberían desaparecer con la cuenta:

1. **Desactivar** (`deleted_at = now()`), como hoy: la cuenta deja de
   escribir y de ser visible en el mismo instante.
2. **Fotos:** borrar y verificar los objetos de Storage de sus habitaciones
   **antes** de borrar filas (requisito ya documentado en
   `docs/SECURITY.md`, «Cascadas desde profiles y Auth»).
3. **Relaciones:** borrar sus intereses y matches (como bloquear), lo que
   cierra sus chats con los triggers actuales.
4. **Mensajes de chats cerrados:** decidir entre las opciones de la sección
   4 (lo que la otra persona escribió también es dato personal de esa otra
   persona).
5. **Reportes:**
   - los que **hizo** la cuenta: anonimizar quien reporta en vez de borrar
     el reporte, si el equipo necesita conservar el historial de un caso.
     Hoy `reporter_id` es `not null` y sin cascada, así que **impide** borrar
     el perfil; anonimizar exigiría una cuenta técnica «eliminada» o hacer
     la columna opcional (migración con decisión);
   - los que **recibió**: se conservan para la moderación durante el plazo
     que se decida (**REQUIERE REVISIÓN LEGAL**); hoy `reported_user_id`
     tampoco tiene cascada y también impide el borrado.
   - Consecuencia actual: borrar en Auth a una persona que ha reportado o ha
     sido reportada falla con 23503 hasta que se decida qué hacer con sus
     reportes. La app solo reporta personas (nunca habitaciones), así que
     `delete_own_room` no se ve afectado.
6. **Auditoría de admin (decisión del propietario, 2026-11-27):** se
   mantiene íntegra e inmutable, y haber actuado como admin **no** bloquea el
   borrado de la cuenta. Implementado en local en la sesión 85
   (`20261130120000`, `tests/db/30`):
   - `admin_action_logs.admin_id` y `reports.resolved_by` dejan de ser FK y
     guardan el UUID tal cual. Al borrar la cuenta, ninguna fila cambia y el
     UUID queda como identificador seudónimo: ninguna tabla de la app lo
     relaciona ya con una persona. El panel muestra esas acciones como de
     una «cuenta de administración eliminada»;
   - se descartaron `on delete set null` y `cascade`: reescribirían o
     borrarían filas de la auditoría (los triggers lo rechazan) y
     `set null` perdería qué acciones hizo una misma persona;
   - sin la FK, la integridad la dan los privilegios: solo las funciones
     `admin_*` añaden filas (ni clientes ni service_role tienen INSERT o
     UPDATE) y `admin_log` solo recibe el uid de un admin activo;
   - minimización: las notas las escribe el admin y pueden contener datos
     personales de terceros. El panel pide no incluir más de lo necesario;
     su plazo de conservación está sin decidir (**REQUIERE REVISIÓN LEGAL**);
   - no se borra ni se reescribe ningún registro existente sin una política
     definida y autorización.
7. **Auth:** borrar el usuario de `auth.users` al final, desde el servidor
   (service_role), cuando lo anterior esté verificado.

Todo esto tendría que ir en una función o un servicio con verificación
paso a paso, idempotente, y con tests de que no queda nada de la cuenta
(incluida la conciliación de Storage).

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
- Qué hacer con los reportes que hizo o recibió una cuenta que se borra:
  anonimizar quien reporta (la columna es `not null` y FK: necesita una
  migración con decisión), conservarlos un plazo o borrarlos.
- Qué hacer con los mensajes de chats cerrados (sección 4).
- Qué se le dice a la persona al borrar su cuenta sobre lo que se conserva.

## 6. Decisiones pendientes (del propietario, con legal)

1. Plazo de conservación de los mensajes de chats cerrados y si se aplica
   la opción C (**REQUIERE REVISIÓN LEGAL**).
2. Plazo de conservación de los reportes y de la auditoría de admin, y si
   se anonimizan al borrar una cuenta (**REQUIERE REVISIÓN LEGAL**).
3. Cuándo se implementa el borrado de cuenta (H6) y si se hace desde la app
   o a petición (soporte).
4. Si un admin puede leer los mensajes de un chat reportado, y con qué
   registro.
5. Cuándo se programan las purgas (Supabase cron o un trabajo externo) y en
   qué entorno; ninguna se ejecuta hasta que se decida.
