# Validación contra Supabase real (checkpoint previo a Fase 1)

Objetivo: demostrar que las migraciones y las correcciones de seguridad
(C1, C2, C3, H5, M2, H1) se comportan en **Supabase real** igual que en el
PostgreSQL + shim de `tests/db/`. Este checkpoint **no** inicia Fase 1 ni
cambia producto.

## Proyecto de validación

| Parámetro | Valor |
|---|---|
| Nombre | `roomly-validation` — exclusivo para validación, **nunca** producción |
| Plan | Free |
| Región | Frankfurt (`eu-central-1`) |
| Datos | Ninguno real. Solo usuarios de prueba creados y borrados por la suite |
| Auth → Email | Activo. Los usuarios de prueba se crean con la Admin API (`email_confirm: true`) y entran con contraseña |
| Auth → registro público | **Desactivado** ("Allow new users to sign up" = off) |
| Site URL | `http://localhost:3000` |
| Redirect URLs | Exactamente `http://localhost:3000/callback` — sin comodines |
| Google OAuth | No configurado en este checkpoint |

La creación del proyecto y la configuración de Auth se hacen desde el
dashboard de Supabase por la persona dueña de la cuenta (no hay conector de
Supabase en las sesiones de Claude Code y las credenciales de cuenta no se
comparten por chat).

### Marca de identidad (F1) — primer paso tras crear el proyecto

Antes de configurar nada más, en el SQL Editor de `roomly-validation`:

```sql
comment on database postgres is 'roomly-validation';
select shobj_description(d.oid, 'pg_database') from pg_database d where d.datname = 'postgres';
```

La segunda consulta debe devolver exactamente `roomly-validation`. Todo
punto de entrada (guarda del workflow, aplicación de migraciones, P0–P5,
suite SQL y suite supabase-js) comprueba esa marca **en la propia base de
datos** antes de hacer nada; si falta o no coincide exactamente, aborta sin
fallback. Unos secrets coherentes que apunten a otro proyecto no pasan,
porque ese proyecto no tiene la marca. Nunca se pone esta marca en otro
proyecto.

Verificado en local: el comentario lo lee cualquier rol (también uno sin
privilegios) y solo el dueño de la base de datos puede cambiarlo. **Pendiente
de confirmar en Supabase**: que el rol `postgres` del proyecto pueda
ejecutar el `comment on database` (requiere ser dueño de la BD). Si falla con
`must be owner of database postgres`, se detiene el checkpoint y se decide
otra marca; no hay mecanismo alternativo automático.

## Secrets (GitHub → Settings → Secrets and variables → Actions)

| Secret | De dónde sale | Clase |
|---|---|---|
| `SUPABASE_VALIDATION_PROJECT_REF` | Project Settings → General → Project ID (20 letras) | Identificador (actúa de guarda) |
| `SUPABASE_VALIDATION_URL` | `https://<ref>.supabase.co` | Pública |
| `SUPABASE_VALIDATION_ANON_KEY` | Project Settings → API Keys → anon / publishable | Pública (RLS la limita) |
| `SUPABASE_VALIDATION_SERVICE_ROLE_KEY` | Project Settings → API Keys → service_role / secret | **PRIVILEGIADA — se salta RLS** |
| `SUPABASE_VALIDATION_DB_URL` | Connect → **Session pooler** (IPv4; la conexión directa es solo IPv6 y los runners de GitHub no la alcanzan) | **PRIVILEGIADA — incluye la contraseña de la BD** |

Reglas:
- Ninguna de estas va en Git, en el chat, en logs ni en archivos del repo.
  `.env.local` / `.env.*.local` ya están en `.gitignore` si alguna vez se
  usan en local.
- La clave privilegiada **nunca** con prefijo `NEXT_PUBLIC_*`. En el
  workflow, la app (job `auth-redirects`) solo recibe URL + clave pública.
- Cada job recibe únicamente los secrets que necesita.
- Los scripts no imprimen valores: la guarda (`tests/supabase/guard.sh`)
  solo nombra las variables que faltan. Nada usa `set -x`.

## Cómo se ejecuta

Workflow **manual** `.github/workflows/supabase-validation.yml`
(`workflow_dispatch`; nunca en push ni en PR). GitHub solo permite
lanzar un `workflow_dispatch` cuando el archivo del workflow existe en la
rama por defecto (`master`).

Entradas:
- `confirm_project`: hay que escribir `roomly-validation`.
- `apply_migrations`: `true` solo la primera vez, sobre el proyecto vacío.

Orden de jobs (cada uno solo corre si el anterior pasa):

1. **guard** — confirmación + secrets presentes + URL y DB del mismo
   `PROJECT_REF` + **marca de identidad leída del propio proyecto** (F1).
   Barrera contra ejecutar nada en otro proyecto.
2. **migrate** (si `apply_migrations`) — `tests/supabase/apply-migrations.sh`:
   las 3 migraciones existentes + seed en **una transacción**; se niega si el
   esquema ya existe. (No usa `supabase db push`: el historial de migraciones
   de la CLI no se registra, aceptable en un proyecto desechable.)
3. **preflight** — `tests/supabase/preflight.sql` (P0 identidad + P1–P5,
   solo lectura de catálogo). **Si falla, no se ejecuta ninguna suite.**
4. **sql-suite** — `tests/supabase/run-sql-suite.sh`: la suite
   `tests/db/0*.sql` (58 aserciones) con los roles, dueños y `auth.uid()`
   REALES, sin shim, dentro de `BEGIN … ROLLBACK` (no deja datos).
5. **api-suite** — `npm run test:supabase`
   (`tests/integration/supabase-validation.test.ts`): PR, CH, RO, RE, AU2
   vía supabase-js/PostgREST con JWT reales. Lo primero que hace es ejecutar
   `tests/supabase/guard.sh` (marca de identidad); sin ella no crea ni borra
   nada, también si se lanza fuera del workflow.
6. **auth-redirects** — build + `next start` con la clave pública y
   `tests/supabase/auth-redirects.sh` (AU3, AU5 sin sesión). Estas
   comprobaciones prueban el comportamiento de la app (redirects dentro del
   origen); no llegan a contactar con Supabase: con un código inválido el
   intercambio falla en local por falta del verificador PKCE, y `/admin`
   sin cookie no hace ninguna llamada.

## Matriz de pruebas

| Grupo | Dónde | Qué demuestra |
|---|---|---|
| P1–P5 | `tests/supabase/preflight.sql` | Versión real, migraciones y seed aplicados, mismo dueño función/tabla y sin FORCE RLS (base de `is_conversation_participant`), RLS en 18/18 y 35 políticas, permisos de columna/función reales, equivalente SQL de los lints del Security Advisor |
| C1, C2, C3, H5, M2 (SQL) | `tests/db/0*.sql` vía `run-sql-suite.sh` | Las mismas 58 aserciones del CI, ahora con los roles de Supabase |
| PR1–PR12 | api-suite | Perfiles: no `role=admin` (insert/update/upsert), no `deleted_at`, campos permitidos sí, `anon` sin acceso, asignación de admin solo con `service_role`, `is_admin()` por JWT. **PR8 registra el comportamiento real de `upsert()`** sin relajar permisos |
| CH1–CH11 | api-suite | A y B en conversación 1, C en conversación 2: aislamiento total de lectura/escritura, participantes visibles solo en las propias conversaciones, sin `42P17`, sin suplantar `sender_id`, `last_read_at` sí / `conversation_id` no, RPC de la función, sin INSERT de cliente en conversaciones/participantes/matches |
| RO1–RO9 | api-suite | Propietario edita y pausa; no pone ni saca de `removed` (también vía upsert); admin y `service_role` sí; `anon` no ve `removed`; dirección exacta solo para el propietario |
| RE1–RE9 | api-suite | Reporte válido nace `pending`; ningún campo administrativo en el INSERT; no en nombre de otro; no autocierre; el denunciado no lo ve; el admin resuelve |
| AU2 | api-suite | La lista de redirects de Supabase Auth conserva `http://localhost:3000/callback` y no conserva destinos externos |
| AU3, AU5 (sin sesión) | `auth-redirects.sh` | El callback con código inválido y `next` malicioso redirige siempre dentro del origen; `/admin` sin sesión → `/login?next=%2Fadmin` |
| AU4, AU5 (con sesión) | Manual (abajo) | Requieren email real / navegador |
| AU6 (Google) | Fuera de este checkpoint | — |

Actores de la api-suite: A, B, C (chat), O (propietario), R (denunciante),
T (denunciado), D (admin, rol asignado con `service_role` en PR11). Cada uno
con su propio cliente y su JWT real; `service_role` solo prepara y limpia
datos y ejecuta PR11 y la parte de servidor de RO7.

**Limpieza (respeta H6)**: primero mensajes, participantes y
conversaciones; después reportes, logs, intereses, matches, rooms y
perfiles; solo al final `auth.admin.deleteUser`. Reglas:
- Solo usuarios cuyo email encaja **entero** en
  `^roomly-val-[0-9a-f]{8}-[a-z]@example\.com$` (F2).
- De la ejecución actual, solo las conversaciones cuyos IDs registró la
  propia suite al crearlas (F3). De ejecuciones anteriores interrumpidas,
  solo conversaciones con **exclusivamente** participantes de prueba; una
  conversación con cualquier participante ajeno nunca se toca.
- Solo filas creadas por usuarios de prueba (reportes por su `reporter_id`,
  intereses por `from_user_id`, matches con ambos usuarios de prueba...).
  Si algo de un usuario de prueba estuviera enlazado a datos ajenos, no se
  borra: `deleteUser` falla y el teardown lo reporta.
- El teardown corre en `afterAll`, que Vitest ejecuta aunque fallen
  `beforeAll` o los tests; si la guarda F1 no pasó, no se toca nada.

**Aserciones**: éxito es exactamente `error === null` (F4). Los rechazos
del trigger de moderación (RO3, RO5, RO6) exigen SQLSTATE `42501` **y** el
mensaje propio del trigger `room_moderation: …` (F5). PostgREST devuelve el
mensaje de Postgres tal cual en `message`; si en Supabase llegara distinto,
el test falla de forma visible, nunca pasa en falso. El resto de rechazos
se comprueban por SQLSTATE y número de filas; no se comprueban códigos
HTTP.

**Auto-test de la guarda F1** (PostgreSQL local, nunca Supabase):
`PGHOST=... PGUSER=postgres bash tests/supabase/guard-selftest.sh` —
proyecto ficticio, URL de otro proyecto, secrets coherentes de otro
proyecto, marca incorrecta o ausente, y que migraciones/P0/suite SQL
abortan antes de hacer nada.

## Comprobaciones manuales

**AU4 — magic link de extremo a extremo** (requiere un email real):
1. Añadir temporalmente ese email como usuario desde el dashboard
   (el registro público está desactivado).
2. `npm run dev` en local con `.env.local` apuntando al proyecto de
   validación (solo URL + clave pública).
3. `/login` → "Enviar enlace" → abrir el enlace del email en el mismo
   navegador (PKCE) → debe acabar en `/` con sesión.
4. Borrar ese usuario al terminar.

**AU5 — `/admin` con sesión**:
1. Con la sesión de AU4 (usuario normal): `/admin` → redirige a `/`.
2. Asignar `role = 'admin'` a ese usuario desde el SQL Editor
   (operación de servidor) y recargar `/admin` → se ve el panel.
3. Devolver `role = 'user'` y borrar el usuario.

Nota: el SQL Editor corre como `postgres`. Cualquier prueba de permisos
escrita allí a mano solo vale si hace `set role authenticated` y fija
`request.jwt.claims`; si no, no demuestra nada.

## Hallazgos registrados en este checkpoint

- **D14 (INFO, sin corregir)**: `@supabase/ssr` 0.12.7 usa
  `httpOnly: false` por defecto para las cookies de sesión (el cliente de
  navegador necesita leerlas). El comentario de
  `app/(auth)/callback/route.ts` que habla de "cookies HTTP-only" es
  inexacto. Implicación: un XSS podría leer la sesión, lo que refuerza la
  prioridad de la CSP y de no usar `dangerouslySetInnerHTML`. No se cambia
  `@supabase/ssr` ni el callback en este checkpoint.

## Después del checkpoint

Rotar las claves del proyecto, borrar los secrets `SUPABASE_VALIDATION_*`
de GitHub si no se van a reutilizar, y pausar o borrar `roomly-validation`.
No se reutiliza como producción.
