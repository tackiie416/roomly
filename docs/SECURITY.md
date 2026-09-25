# Seguridad — ROOMLY

Prioridad alta desde el día uno (sección 28 del brief). Este documento
recoge los principios; las decisiones concretas de esquema/RLS ya
corregidas están en `docs/DATABASE.md`.

## Cobertura de los requisitos de RLS pedidos

| Requisito pedido | Políticas que lo cumplen |
|---|---|
| Usuarios solo modifican sus propios datos | `profiles_update_own`, `housing_preferences_own`, `compatibility_responses_own`, `favorites_own`, `interests_insert_own`/`interests_delete_own`, `participants_update_own` |
| Mensajes solo accesibles por participantes | `messages_select_participant`, `messages_insert_participant`, `conversations_select_participant`, `participants_select_own_conversations` — un tercero no puede leer aunque conozca el UUID de la conversación |
| Habitaciones editables solo por su propietario | `rooms_owner_write`. La dirección exacta va un paso más allá: `room_addresses_owner_only`, ni siquiera visible para otros usuarios autenticados |
| Administración separada | Todas las tablas sensibles tienen una política `*_admin_all` vía `is_admin()`, y `/admin` se comprueba además en el servidor — nunca solo RLS, nunca solo ocultar el enlace en el cliente |
| Información privada protegida | `profiles` completo exige sesión (vista `public_profile_previews` para lo estrictamente público de SEO); `room_addresses` solo el propietario; un usuario reportado no tiene ninguna política de SELECT sobre `reports`, así que no puede saber quién lo reportó |

Las 35 políticas completas están en
`supabase/migrations/20260925120100_rls_policies.sql` — esta tabla es el
mapa de lectura rápida, no la fuente de la verdad.

## Comprobación de coherencia final (antes de Fase 1)

Auditoría de RLS pedida explícitamente antes de confirmar el esquema.
Encontró un problema real de escalado de privilegios, ya corregido:

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
