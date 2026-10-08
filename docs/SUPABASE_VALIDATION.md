# Validación contra Supabase real

Objetivo: demostrar que las migraciones, la RLS y el flujo de alta se
comportan en **Supabase real** igual que en el PostgreSQL + shim de
`tests/db/` y en el Supabase simulado del E2E local.

Estado (2026-10-06): **validación real de la Fase 2.8 completada** en el
proyecto `roomly-validation-2b` (ref `uwxb…`, marca `roomly-validation-2`):
- **run 13:** validación estructural real;
- **run 15:** E2 real.

Detalle y diagnóstico de los runs anteriores en «Resultado de la Fase 2.8».
El checkpoint anterior contra `roomly-validation` (Fase 1) es histórico y
está al final.

**Desde la Fase 3 el destino es un proyecto nuevo, `roomly-validation-3`**
(todavía sin crear; ver «Fase 3: la próxima validación real»). Su marca,
su Environment y `confirm_project` son `roomly-validation-3`. `uwxb…` (marca
`roomly-validation-2`) es el **proyecto anterior**: no se toca y la guarda
lo rechaza.

## Resultado de la Fase 2.8 (2026-10-06)

**Resultado final**

| Run | Id | Commit | Parámetros | Resultado |
|---|---|---|---|---|
| **13** | `37533380047` | `f9f08ad` | `apply_migrations=true`, `run_e2e_real=false` | ✅ **Validación estructural real.** Guarda; las 9 migraciones y el seed en una transacción; P0–P6 (37 políticas); suite SQL 01–13 (13 archivos, cada uno revertido, sin restos); supabase-js 46/46; AU3/AU5 16/16 |
| **15** | `37543144825` | `ec7c3fc` (con el adaptador de Mailtrap) | `apply_migrations=false`, `run_e2e_real=true` | ✅ **E2 real 1/1**, con la parte estructural otra vez en verde |

**Qué recorrió el E2 del run 15:**
- formulario real de `/login` → `signInWithOtp`;
- email real recibido en Mailtrap;
- enlace `https://uwxb….supabase.co/auth/v1/verify` validado, con
  `redirect_to` exactamente `http://localhost:3000/callback`;
- `/callback?code=` con PKCE, en el mismo navegador;
- onboarding → `/perfil`, `/preferencias` y `/ajustes`, guardados y
  releídos → logout → `/perfil` sin sesión vuelve a `/login`.

Sin `generateLink` ni `token_hash`, y sin cambios en `/callback`.

**Limpieza:** «1 usuario(s) de prueba borrado(s), sin datos asociados» y
«mensajes del buzón de prueba borrados». No quedaron usuarios, filas ni
mensajes de prueba.

**Registro de Auth:** abierto a mano por el propietario solo para la ventana
del E2 (runs 14 y 15) y cerrado a mano después del run 15. La limpieza avisó
de que seguía abierto, como está previsto: el workflow no lo cierra.

**Otros proyectos:** no se tocaron ni el histórico `roomly-validation` ni el
retirado `qhwu…` (marca `roomly-retirado`).

**Historial de diagnóstico** (no es resultado; ningún run escribió nada)

| Runs | Qué pasó | Causa |
|---|---|---|
| 3–5 | apply-migrations se negó: «el esquema ya existe» | Los secrets apuntaban al proyecto antiguo, con esquema |
| 6–10 | La guarda rechazó la marca (run 10: ref `qhwu…`, marca `roomly-retirado`, 18 tablas) | Secrets **de repositorio** antiguos, que GitHub usa si el Environment no tiene los suyos |
| 11 | Igual que el 10, sobre `f9f08ad` | Los mismos secrets de repositorio |
| 12 | «faltan variables de entorno»: los cinco secrets vacíos | Borrados los de repositorio, los nuevos estaban en un Environment llamado `SUPABASE_VALIDATION_PROJECT_REF` y no en `roomly-validation-2` |
| 14 | Estructural en verde; el E2 falló antes de enviar nada: «E2E_MAILBOX_CONFIG no es un JSON válido» | Valor mal formado del secret; se creó de nuevo con un token nuevo de Mailtrap |

## Proyecto de validación P1: `roomly-validation-3`

Decisión de la Fase 3 (la misma que en la 2.8): un proyecto **nuevo y
vacío**. No se migra de forma incremental el proyecto anterior, `uwxb…`
(marca `roomly-validation-2`), que tiene el esquema de la Fase 2 y no se
toca. En la 2.8 tampoco se reparó `roomly-validation`, al que le faltaban
todas las migraciones de Fase 2.

| Parámetro | Valor |
|---|---|
| Nombre | `roomly-validation-3`: exclusivo para validación, **nunca** producción |
| Plan / región | Free / Frankfurt (`eu-central-1`), como los anteriores |
| Datos | Ninguno real. Solo usuarios de prueba, creados y borrados por las suites |
| Marca de identidad | `comment on database postgres is 'roomly-validation-3';` |
| Auth → Email | Activo, con **SMTP propio** (ver «E2 — requisitos del magic link») |
| Auth → registro público | **Desactivado** salvo durante la ventana del E2 real |
| Site URL | `http://localhost:3000` |
| Redirect URLs | Exactamente `http://localhost:3000/callback`, sin comodines |
| Google / Apple OAuth | No configurados (diferidos) |

La creación del proyecto, la configuración de Auth y SMTP y los secrets los
hace la persona dueña de la cuenta desde el dashboard. Claude no tiene
autorización para tocar Supabase remoto desde su entorno, y las credenciales
no se comparten por chat.

### Marca de identidad (F1): nueva y distinta de la anterior

Primer paso tras crear el proyecto, en su SQL Editor:

```sql
comment on database postgres is 'roomly-validation-3';
select shobj_description(d.oid, 'pg_database') from pg_database d where d.datname = 'postgres';
```

La segunda consulta debe devolver exactamente `roomly-validation-3`. Todo
punto de entrada comprueba esa marca **en la propia base de datos** antes de
hacer nada, y si falta o no coincide exactamente, aborta sin fallback:
- la guarda del workflow;
- la aplicación de migraciones;
- el preflight P0–P6;
- la suite SQL, dentro de cada sesión;
- la suite supabase-js;
- la preparación y la limpieza del E2.

Por qué una marca nueva en cada proyecto: la comparación es exacta, así que
unas credenciales de un proyecto anterior no pasan las guardas del nuevo:
- `roomly-validation` (Fase 1);
- `roomly-validation-2` (Fase 2.8, `uwxb…`). **Aislamiento de la Fase 3:**
  unos secrets coherentes que apunten a `uwxb…` no pasan la guarda, y la
  aplicación de migraciones, el preflight y la suite SQL abortan antes de
  hacer nada.

A la inversa, el código anterior exige su propia marca y no aceptaría el
proyecto nuevo. La seguridad no depende de quitar la marca de los proyectos
anteriores. Lo comprueban:
- `guard-selftest.sh`, con las dos marcas anteriores y con variantes
  (espacios, mayúsculas, `roomly-validation-30`);
- `preflight-selftest.sh` y `sql-suite-selftest.sh`, con
  `roomly-validation-2` en P0 y en cada sesión;
- `tests/unit/validation-infra.test.ts`, que además falla si
  `roomly-validation-2` aparece en el workflow, en `tests/supabase/` (salvo
  los auto-tests), en `tests/e2e/real/` o en la api-suite.

**Diagnóstico cuando la marca no coincide.** La guarda imprime una línea
con los 4 primeros caracteres del ref, el nombre de la base de datos
conectada, la marca encontrada (solo si es texto simple; si no, su
longitud) y el número de tablas en `public`. Sirve para saber a qué
proyecto apuntan unos secrets que GitHub no deja leer. Nunca imprime el ref
completo, la URL, la cadena de conexión, contraseñas ni claves (lo
comprueba `guard-selftest.sh`).

## Secrets: solo en el GitHub Environment `roomly-validation-3`

Todos los jobs del workflow declaran `environment: roomly-validation-3`. Los
secrets se crean en GitHub → Settings → Environments →
`roomly-validation-3`, **no** como secrets del repositorio. Se recomienda
exigir aprobación manual (*required reviewers*) en el Environment.

El Environment anterior, `roomly-validation-2`, conserva los secrets de
`uwxb…`. El workflow ya no lo usa y no se toca.

| Nombre | Tipo | De dónde sale | Clase |
|---|---|---|---|
| `SUPABASE_VALIDATION_PROJECT_REF` | secret | Project Settings → General → Project ID (20 caracteres) | Identificador (actúa de guarda) |
| `SUPABASE_VALIDATION_URL` | secret | `https://<ref>.supabase.co` | Pública |
| `SUPABASE_VALIDATION_ANON_KEY` | secret | Project Settings → API Keys → anon / publishable | Pública (RLS la limita) |
| `SUPABASE_VALIDATION_SERVICE_ROLE_KEY` | secret | Project Settings → API Keys → service_role / secret | **PRIVILEGIADA: se salta RLS** |
| `SUPABASE_VALIDATION_DB_URL` | secret | Connect → **Session pooler** (IPv4) | **PRIVILEGIADA: incluye la contraseña de la BD** |
| `E2E_EMAIL_TEMPLATE` | secret | Dirección del buzón de prueba con `{id}` en la parte local (p. ej. `buzon+{id}@dominio`) | Sensible (identifica el buzón) |
| `E2E_MAILBOX_CONFIG` | secret | Configuración opaca del buzón de prueba (la interpreta su adaptador) | **PRIVILEGIADA: acceso al buzón** |
| `E2E_MAILBOX_ADAPTER` | variable | Ruta del adaptador del buzón, dentro de `tests/e2e/` | No secreta |

Reglas:
- **Ninguna de estas va en Git, en el chat, en logs ni en archivos del repo.**
- **La clave privilegiada nunca lleva el prefijo `NEXT_PUBLIC_*`.** La app
  (jobs `auth-redirects` y `e2e-real`) solo recibe la URL y la clave pública.
- **Cada paso recibe únicamente los secrets que necesita.** En el E2 real,
  `service_role` solo llega a la preparación y a la limpieza, nunca a la app
  ni al proceso de Playwright. `tests/unit/validation-infra.test.ts` falla si
  eso cambia.
- **Los scripts no imprimen valores:** solo nombran las variables que
  faltan, y nada usa `set -x`. La dirección de prueba de cada ejecución se
  enmascara con `::add-mask::` antes de usarse.

## Cómo se ejecuta

El workflow `.github/workflows/supabase-validation.yml` es **manual**
(`workflow_dispatch`): nunca se lanza en push ni en PR. GitHub solo permite
lanzarlo cuando el archivo existe en la rama por defecto (`master`).

Entradas:
- `confirm_project`: hay que escribir `roomly-validation-3`.
- `apply_migrations`: `true` solo la primera vez, sobre el proyecto vacío.
- `run_e2e_real`: `true` solo cuando el registro está abierto y el buzón
  configurado (ver E2).

Orden de jobs (cada uno solo corre si el anterior pasa):

1. **guard**:
   - confirmación explícita del proyecto;
   - secrets presentes;
   - URL y conexión de BD del mismo `PROJECT_REF`;
   - **marca de identidad leída del propio proyecto** (F1).
2. **migrate** (solo si `apply_migrations`): `tests/supabase/apply-migrations.sh`.
   - Aplica las 10 migraciones de `supabase/migrations/` en orden y después
     `supabase/seed.sql`, todo en **una transacción**.
   - Se niega si `public.profiles` ya existe.
   - No usa `supabase db push`: el historial de migraciones de la CLI no se
     registra, algo aceptable en un proyecto desechable.
   - Cada migración nueva obliga a recrear un proyecto vacío (P1).
3. **preflight**: `tests/supabase/preflight.sql` (P0–P6, solo lectura de
   catálogo, sin tablas temporales). **Si falla, no se ejecuta ninguna suite.**
4. **sql-suite**: `tests/supabase/run-sql-suite.sh` ejecuta los 14 archivos
   `tests/db/01`–`14` (305 aserciones) con los roles, dueños y `auth.uid()`
   reales, sin shim. El aislamiento se explica abajo.
5. **api-suite**: `npm run test:supabase`
   (`tests/integration/supabase-validation.test.ts`).
   - Prueba PR, CH, RO, RE y AU2 vía supabase-js/PostgREST con JWT reales.
   - Lo primero que hace es ejecutar `tests/supabase/guard.sh`; sin la
     marca no crea ni borra nada.
6. **auth-redirects**: build + `next start` con la clave pública, y
   `tests/supabase/auth-redirects.sh` (AU3, AU5 sin sesión).
7. **e2e-real** (solo si `run_e2e_real`): el E2 descrito abajo.

### Suite SQL: una sesión y una transacción por archivo

`tests/supabase/sql-suite-lib.sh` (lo usa `run-sql-suite.sh`) abre **una
sesión de `psql` por archivo**. Cada sesión ejecuta, en orden:
1. `BEGIN`;
2. la comprobación de identidad (P0);
3. la comprobación de sesión limpia: rol de la sesión, sin
   `request.jwt.claims` y sin `roomly_test`;
4. `helpers.sql`;
5. el test;
6. `ROLLBACK`;
7. la comprobación de que el rol, los claims y `roomly_test` han
   desaparecido.

Al final, en otra sesión y solo leyendo, comprueba que no quedan
`roomly_test`, políticas `zz_test_*` ni usuarios `@test`.

- **El test 11 no se ha modificado.** Su `begin;`/`rollback;` propio se
  reescribe en el flujo (no en el archivo) a `savepoint roomly_file;` /
  `rollback to savepoint roomly_file;`. Así su `ROLLBACK` deshace solo su
  bloque, nunca la transacción del runner.
  - Antes, con una sola transacción para toda la suite, ese `ROLLBACK`
    deshacía los tests 01–10 y el esquema de helpers, y el test fallaba.
  - El `WARNING` que lo delataba («there is already a transaction in
    progress») lo ocultaba el filtro de salida.
  - Desde la Fase 2.9 (H4), `tests/db/12` usa la misma técnica (bloques
    `begin;`/`rollback;` con una política SELECT temporal `zz_test_*`), que
    el runner reescribe igual.
- **Fallo cerrado antes de conectar.** La suite aborta sin conectar si
  aparece cualquier otro control de transacción:
  - `COMMIT`, `END`, `ABORT`, `START TRANSACTION`, `SAVEPOINT`, `RELEASE`,
    `ROLLBACK TO`, `PREPARE`;
  - un `BEGIN`/`ROLLBACK` que no esté solo en su línea, o bloques anidados
    o sin cerrar;
  - `SET SESSION`/`SET TRANSACTION`;
  - meta-comandos de `psql`;
  - lo que el validador no sabe analizar con seguridad: `$tag$`,
    comentarios `/* */`, cadenas `E'...'` (sus escapes `\'`
    desincronizarían el análisis) o una sentencia final sin `;`.
- **Qué sabe analizar el validador:** comentarios `--`, cadenas `'...'`,
  identificadores `"..."` y cuerpos `$$...$$`. Un `'`, `--` o `$$` dentro de
  un identificador entre comillas dobles no abre nada.
  - En la auditoría final de la 2.8, `select 1 as "it's";` desincronizaba el
    análisis y ocultaba un `COMMIT` posterior. Está corregido, y el autotest
    reproduce exactamente ese caso.
- **Los `WARNING` se muestran y hacen fallar la suite.** Las salidas de
  error de conexión no se imprimen, porque podrían contener el host.
- **Auto-test local:** `tests/supabase/sql-suite-selftest.sh` (78
  comprobaciones, en CI).
  - Ejecuta el `run-sql-suite.sh` real, con la guarda, contra un PostgreSQL
    local con la marca, y obtiene las mismas aserciones que `run.sh` (265).
  - Comprueba el rollback de un bloque, la ausencia de fugas de rol o GUC
    entre archivos, 31 formas de control de transacción rechazadas, un
    WARNING, un fallo a mitad de test y las marcas anteriores
    (`roomly-validation` y `roomly-validation-2`).
  - Caso D2: 16 combinaciones de identificadores `"..."` y cadenas `E'...'`
    que intentan ocultar un control, entre ellas el caso exacto de la
    auditoría; todas se rechazan antes de conectar. Además, comprueba que
    los identificadores legítimos con `'`, `--` o `$$` se aceptan y se
    ejecutan.
  - También ejecuta el test 11 sin reescribir, que falla con el WARNING
    visible.

### Preflight P0–P6: listas exactas

| Check | Qué exige |
|---|---|
| P0 | Marca `roomly-validation-3` exacta |
| P1 | 18 tablas en `public`, la función y el trigger de la migración de seguridad, y el seed (Barcelona activa) |
| P2 | Mismo dueño para `is_conversation_participant` y `conversation_participants`, sin FORCE RLS, SECURITY DEFINER y `search_path` vacío |
| P3 | RLS en las 18 tablas y **exactamente estas 37 políticas**, comparadas por (tabla, política, comando) en los dos sentidos. No basta con contarlas (ver abajo) |
| P4 | Permisos de columna de `profiles`, `reports` y `conversation_participants`, y EXECUTE de `is_conversation_participant`. Además, en `housing_preferences`: `anon` sin ningún privilegio; `authenticated` sin INSERT/UPDATE de tabla completa, con INSERT en exactamente 11 columnas (sin `updated_at`), UPDATE en exactamente 10 (sin `profile_id` ni `updated_at`), y SELECT y DELETE. Desde la Fase 3.1, en `compatibility_responses`: `anon` sin ningún privilegio de tabla ni de columna; `authenticated` solo con SELECT, sin INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES ni TRIGGER ni escritura de columna |
| P5 | Equivalente SQL de los lints del Security Advisor |
| P6 | **Exactamente 13 triggers activos** en `public` (12 hasta la Fase 3.1, que añade `trg_compatibility_responses_integrity`). **Exactamente 11 funciones propias** (10 hasta la Fase 3.1, que añade `enforce_compatibility_responses_integrity()`), con su SECURITY DEFINER y `search_path`. EXECUTE revocado donde las migraciones lo revocan |

Las 37 políticas, por tabla (38 hasta la Fase 2.9: H4 eliminó
`profiles_select_authenticated`):

| Tabla | Políticas |
|---|---|
| `admin_action_logs` | `admin_action_logs_admin_only` (ALL) |
| `cities` | `cities_select_all` (SELECT), `cities_admin_write` (ALL) |
| `compatibility_responses` | `compatibility_responses_select_own` (SELECT, `to authenticated`; desde la Fase 3.1 sustituye a `compatibility_responses_own` FOR ALL) |
| `conversation_participants` | `participants_select_own_conversations` (SELECT), `participants_update_own` (UPDATE) |
| `conversations` | `conversations_select_participant` (SELECT) |
| `favorites` | `favorites_own` (ALL) |
| `housing_preferences` | `housing_preferences_select_own` (SELECT), `_insert_own` (INSERT), `_update_own` (UPDATE), `_delete_own` (DELETE) |
| `interests` | `interests_select_participant` (SELECT), `interests_insert_own` (INSERT), `interests_delete_own` (DELETE) |
| `matches` | `matches_select_participant` (SELECT) |
| `messages` | `messages_select_participant` (SELECT), `messages_insert_participant` (INSERT) |
| `neighborhoods` | `neighborhoods_select_all` (SELECT), `neighborhoods_admin_write` (ALL) |
| `notifications` | `notifications_own` (ALL) |
| `profiles` | `profiles_select_own_even_if_deleted` (SELECT), `profiles_update_own` (UPDATE), `profiles_insert_own` (INSERT), `profiles_admin_all` (ALL) |
| `reports` | `reports_insert_own` (INSERT), `reports_select_own` (SELECT), `reports_admin_all` (ALL) |
| `room_addresses` | `room_addresses_owner_only` (ALL) |
| `room_images` | `room_images_select` (SELECT), `room_images_owner_write` (ALL) |
| `rooms` | `rooms_select_active_public` (SELECT), `rooms_select_own` (SELECT), `rooms_owner_write` (ALL), `rooms_admin_all` (ALL) |
| `universities` | `universities_select_all` (SELECT), `universities_admin_write` (ALL) |

**Por qué el preflight decía 35.** Se escribió en la Fase 1:
- `20260925120100` crea 35 políticas;
- `20260926120000`, `20260929120000` y `20260930140000` solo las
  sustituyen (`drop` + `create`), así que no cambian el total;
- `20260930130000` sustituye `housing_preferences_own` por cuatro
  políticas (38);
- `20261004120100` (Fase 2.9, H4) elimina `profiles_select_authenticated`
  (37);
- `20261007120000` (Fase 3.1) sustituye `compatibility_responses_own` por
  `compatibility_responses_select_own` (siguen 37).

Nadie actualizó el preflight entonces. Además solo contaba, y no
comprobaba nada de la Fase 2.

**Verificación sin red:**
- `tests/unit/validation-infra.test.ts` deriva de las migraciones el
  conjunto final de políticas y triggers y lo compara con las listas del
  preflight.
- `tests/supabase/preflight-selftest.sh` (44 comprobaciones, en CI):
  - con el esquema actual pasan P0–P6;
  - cada una de 36 mutaciones falla en su check, y cada una se deshace
    (desde la Fase 3, también la marca `roomly-validation-2` en P0);
  - las mutaciones incluyen, entre otras, «misma cantidad, otra política
    (37 = 37)» y «vuelve `housing_preferences_own`»;
  - desde la Fase 3.1, otras 8 de `compatibility_responses`: vuelve la
    política FOR ALL, `anon` con SELECT, `authenticated` con INSERT, con
    UPDATE de `completed_at` o sin SELECT, falta el trigger, la función pasa
    a SECURITY DEFINER, y `authenticated` puede ejecutarla.

## E2E: E1 local y E2 real, separados

| | E1 — local | E2 — real |
|---|---|---|
| Qué | La app real (`next build` + `next start`) contra el Supabase **simulado** `tests/e2e/support/mock-supabase.mjs` | La app real contra `roomly-validation-3`, con **email real** |
| Specs | `tests/e2e/local/*.spec.ts` | `tests/e2e/real/student-real.spec.ts` |
| Configuración | `playwright.config.ts` | `playwright.real.config.ts` |
| Comando | `npm run test:e2e` | `npm run test:e2e:real`, **solo** desde el job `e2e-real` |
| Red y secrets | Ninguno. Clave anon ficticia que solo acepta el mock | Secrets del Environment |
| Dónde corre | Local y CI (`e2e-local` en `ci.yml`) | Workflow manual |
| Artefactos | Report HTML si falla (datos ficticios) | **Ninguno**: sin trace, vídeo, capturas, report ni instantánea de página |

### E1 — qué simula el mock y qué no

El mock cubre solo lo que usa el flujo:
- **Auth:** `otp` (PKCE obligatorio; crea el usuario como con signups
  activos), `verify` (el enlace del email; el redirect permitido es
  exactamente `/callback`), `token` (`pkce`, comprobando el `code_verifier`
  S256 y un solo uso, y `refresh_token`), `user` y `logout` (global).
- **REST:** `profiles`, `housing_preferences`, `cities`, `universities` y
  `neighborhoods`, emulando las políticas, los GRANT de columnas, los
  triggers de las migraciones. Desde la Fase 2.9 (H4), `profiles` solo
  devuelve la fila propia; `profiles_admin_all` no se emula porque el mock
  nunca crea admins. Rechaza `select=*`.

No es Supabase: la base de datos real la cubren `tests/db` y el E2. Los
endpoints `/__test/*` hacen de buzón y de «servidor» (desactivar una
cuenta). Solo escucha en `127.0.0.1`.

### E2 — requisitos del magic link real

Flujo que recorre, sin atajos:

`/login` (formulario real) → `signInWithOtp` → email real → magic link →
`/auth/v1/verify` → `/callback?code=` (PKCE, mismo navegador) → onboarding →
`/perfil` → `/preferencias` → `/ajustes` → logout

No usa `generateLink`, `verifyOtp`, `token_hash` ni contraseñas, y
`/callback` sigue aceptando solo `?code=`. `generateLink` no envía
`code_challenge` (lo comprueba `node_modules/@supabase/auth-js`), así que
su enlace no puede pasar por `/callback`.

| Requisito | Qué hay que configurar en `roomly-validation-3` |
|---|---|
| Signup | «Allow new users to sign up» **activado solo durante la ventana del E2**. La preparación falla si está desactivado. La limpieza avisa (`::warning::` y resumen del job) si sigue abierto al terminar; cerrarlo es un paso manual (ver «Pendiente de decisión»). |
| Proveedor de correo | **SMTP propio** (Authentication → Emails → SMTP Settings). No se asume que el SMTP por defecto de Supabase baste: tiene límites de envío muy bajos y, según la documentación de Supabase, solo entrega a direcciones del equipo. Esto no se ha podido verificar sin red. |
| Enlaces sin reescribir | En el proveedor SMTP hay que **desactivar el seguimiento de clics y cualquier reescritura de enlaces** (*click tracking*, *link tracking*, *link branding*). El E2 valida el enlace tal como llega al buzón: solo lo abre si apunta al `/auth/v1/verify` del proyecto y su `redirect_to` es exactamente `<app>/callback`. Un enlace reescrito por el proveedor apuntaría a otro dominio y el E2 lo rechazaría, con razón: no se puede comprobar adónde lleva. |
| Buzón de prueba | Un buzón que reciba ese correo y se pueda leer **por API**. Proveedor elegido (2026-10-06): **Mailtrap Email Sandbox**, que da a la vez el SMTP (configurado en `uwxb…`) y la API del buzón, sin dominio propio y sin entregar a nadie real. |
| `emailRedirectTo` | El código lo fija como `${window.location.origin}/callback` (`components/auth/login-form.tsx`). En el workflow la app corre en `http://localhost:3000`, así que el resultado es `http://localhost:3000/callback`. Hay que usar siempre `localhost`, nunca `127.0.0.1`. |
| Allowlist | Site URL `http://localhost:3000` y Redirect URLs exactamente `http://localhost:3000/callback`. Lo comprueba AU2 en la api-suite. |
| Plantillas | Las de Supabase. Un usuario nuevo recibe «Confirm signup» y uno existente «Magic link»: las dos usan `{{ .ConfirmationURL }}`. |
| Límites | Límite de emails por hora e intervalo mínimo entre OTP: el E2 pide **un** email por ejecución y no reintenta. |
| Recuperar el enlace | El spec espera el email en el buzón (destinatario único por ejecución, 120 s como máximo). Solo acepta un enlace a `https://<ref>.supabase.co/auth/v1/verify` con `redirect_to` exactamente `<app>/callback`, y lo abre **en el mismo contexto del navegador**, donde está la cookie del `code_verifier`. |
| Dirección única | `E2E_EMAIL_TEMPLATE` con `{id}` = `e2e-<run_id>-<intento>` del workflow. |
| Limpieza | Ver abajo. |

**Adaptador del buzón.** `E2E_MAILBOX_ADAPTER` es la ruta de un módulo
**dentro de `tests/e2e/`** que exporta `createMailbox(env)`, con:
- `waitForMagicLink({ to, since, timeoutMs })`, que devuelve el enlace;
- `deleteMessages(to)`.

El adaptador lee su configuración de `E2E_MAILBOX_CONFIG`. El de Mailtrap es
`tests/e2e/real/mailboxes/mailtrap.mjs` (`E2E_MAILBOX_ADAPTER` =
`tests/e2e/real/mailboxes/mailtrap.mjs`), con `E2E_MAILBOX_CONFIG` como JSON
de una línea `{"accountId":"…","inboxId":"…","apiToken":"…"}`:
- `accountId` es opcional: si falta, el adaptador busca entre las cuentas
  del token la que tiene el sandbox;
- el token necesita permiso **Admin** solo sobre ese sandbox (leer y borrar);
- usa la API que usa el SDK oficial `mailtrap-nodejs`
  (`https://mailtrap.io/api/accounts/{a}/inboxes/{i}/messages…`, cabecera
  `Authorization: Bearer`), espera el email del destinatario de la
  ejecución, saca el primer enlace a `/auth/v1/verify` del HTML (o del
  texto) y nunca registra el token, el email ni el enlace;
- tests sin red en `tests/unit/mailtrap-mailbox.test.ts`.

Sin adaptador, el E2 falla al empezar con «E2E_MAILBOX_ADAPTER no está
definida». El adaptador simulado
(`tests/e2e/support/mock-mailbox.mjs`) solo sirve para ensayar el spec
contra el mock, y se niega a funcionar en GitHub Actions o contra una URL
que no sea `127.0.0.1`.

**Preparación y limpieza** (`tests/e2e/real/cleanup.mjs`, paso propio, con
`service_role`):
- **`before`:**
  1. pasa la guarda F1;
  2. comprueba en `/auth/v1/settings` que el email y el registro están
     activos;
  3. borra los restos de ejecuciones anteriores.
- **`after`** (`if: always()`, también si el E2 falla o se cancela):
  1. pasa la guarda F1;
  2. borra los usuarios de prueba; su perfil y sus preferencias caen en
     cascada (`profiles` → `auth.users` y `housing_preferences` →
     `profiles`, `ON DELETE CASCADE`);
  3. comprueba que no quedan usuarios, perfiles ni preferencias suyos;
  4. vacía los mensajes del buzón;
  5. **después, pase lo que pase en 2–4**, comprueba si el registro sigue
     abierto y lo avisa (`withSignupCheck` en `e2e-real-lib.mjs`). Si el
     borrado o el buzón fallan, el aviso sale igual y el paso termina con
     ese error original. Si no se pueden leer los ajustes, avisa de que hay
     que revisarlo a mano.
- **Qué usuarios puede borrar.** Solo direcciones que encajan **entera** en
  la plantilla, con `{id}` = `e2e-<n>-<n>`, y como mucho 10 de una vez. Si
  encuentra más, no borra nada.
- **Qué imprime.** Solo recuentos: nunca emails, ids, enlaces ni objetos de
  error de supabase-js.

**Qué hace el spec con los datos.** Los errores se reescriben sin email ni
URLs, y las comprobaciones de URL comparan solo la ruta.
`PLAYWRIGHT_NO_COPY_PROMPT` evita que `error-context.md` guarde el árbol
de la página, donde estaría el email escrito. `outputDir` no se conserva.

## Matriz de pruebas

| Grupo | Dónde | Qué demuestra |
|---|---|---|
| P0–P6 | `tests/supabase/preflight.sql` | Ver la tabla de arriba |
| SQL 01–14 | `tests/db/*` vía `run-sql-suite.sh` | Las 305 aserciones de `tests/db` con los roles de Supabase: C1, C2, C3, H5, M2 (01–04), Fase 2.0 (05–06), onboarding y su escritura única de la 2.9 (07), cuentas eliminadas (08), perfil propio (09), preferencias (10), ownership aislado (11), ajustes (12), privacidad de `profiles`, H4 (13) y, desde la Fase 3.1, `compatibility_responses` (14: CR1–CR20, 40 aserciones). **El 14 todavía no se ha ejecutado en Supabase real** |
| PR1–PR12 | api-suite | Perfiles: no `role=admin` (insert/update/upsert), no `deleted_at`, campos permitidos sí, `anon` sin acceso, asignación de admin solo con `service_role`, `is_admin()` por JWT. **PR8 registra el comportamiento real de `upsert()`** sin relajar permisos |
| CH1–CH11 | api-suite | A y B en conversación 1, C en conversación 2: aislamiento total de lectura/escritura, participantes visibles solo en las propias conversaciones, sin `42P17`, sin suplantar `sender_id`, `last_read_at` sí / `conversation_id` no, RPC de la función, sin INSERT de cliente en conversaciones/participantes/matches |
| RO1–RO9 | api-suite | Propietario edita y pausa; no pone ni saca de `removed` (también vía upsert); admin y `service_role` sí; `anon` no ve `removed`; dirección exacta solo para el propietario |
| RE1–RE9 | api-suite | Reporte válido nace `pending`; ningún campo administrativo en el INSERT; no en nombre de otro; no autocierre; el denunciado no lo ve; el admin resuelve |
| CRA1–CRA6 | api-suite (Fase 3.1) | `compatibility_responses` por PostgREST: B lee su fila y C no; ningún JWT escribe (INSERT, UPDATE de `completed_at` o de versión, DELETE → `42501`); `anon` no lee; service_role completa una vez y después no cambia la fecha (S4), no baja de versión (S3) y sube completando (S5); con la cuenta eliminada ni service_role escribe. **Todavía no se ha ejecutado en Supabase real** |
| AU2 | api-suite | La lista de redirects de Supabase Auth conserva `http://localhost:3000/callback` y no conserva destinos externos |
| AU3, AU5 (sin sesión) | `auth-redirects.sh` | El callback con código inválido y `next` malicioso redirige siempre dentro del origen; `/admin` sin sesión → `/login?next=%2Fadmin` |
| E2 (alta real) | job `e2e-real` | Registro por magic link con email real, `/callback` PKCE, onboarding (desde la Fase 3 termina en `/test`, que se abre sin service_role), `/perfil`, `/preferencias`, `/ajustes` y logout |
| AU6 (Google) | Fuera de alcance (diferido) | — |

Actores de la api-suite: A, B, C (chat), O (propietario), R (denunciante),
T (denunciado), D (admin, rol asignado con `service_role` en PR11). Cada uno
con su propio cliente y su JWT real; `service_role` solo prepara y limpia
datos y ejecuta PR11 y la parte de servidor de RO7.

**Limpieza de la api-suite (respeta H6).** Primero borra mensajes,
participantes y conversaciones; después reportes, logs, intereses, matches,
rooms y perfiles; solo al final `auth.admin.deleteUser`. Reglas:
- Solo toca usuarios cuyo email encaja **entero** en
  `^roomly-val-[0-9a-f]{8}-[a-z]@example\.com$` (F2).
- **Conversaciones:**
  - de la ejecución actual, solo las que la propia suite registró al
    crearlas (F3);
  - de ejecuciones anteriores interrumpidas, solo las que tienen
    **exclusivamente** participantes de prueba;
  - una conversación con cualquier participante ajeno nunca se toca.
- Solo toca filas creadas por usuarios de prueba (reportes por su
  `reporter_id`, intereses por `from_user_id`, matches con ambos usuarios
  de prueba...). Si algo de un usuario de prueba está enlazado a datos
  ajenos, no se borra: `deleteUser` falla y el teardown lo reporta.
- El teardown corre en `afterAll`, que Vitest ejecuta aunque fallen
  `beforeAll` o los tests. Si la guarda F1 no pasó, no toca nada.

**Aserciones.**
- **Éxito** es exactamente `error === null` (F4).
- **Rechazos del trigger de moderación** (RO3, RO5, RO6): exigen SQLSTATE
  `42501` **y** el mensaje propio del trigger, `room_moderation: …` (F5).
  PostgREST devuelve el mensaje de Postgres tal cual en `message`. Si en
  Supabase llegara distinto, el test falla de forma visible; nunca pasa en
  falso.
- **El resto de rechazos** se comprueban por SQLSTATE y número de filas, no
  por código HTTP.

**Auto-tests locales** (PostgreSQL local, nunca Supabase, también en CI,
`db-security`). Se ejecutan todos con
`PGHOST=... PGUSER=postgres npm run test:infra`.
- **`guard-selftest.sh` (28):** rechaza un proyecto ficticio, la URL de
  otro proyecto, secrets coherentes de otro proyecto, las marcas anteriores,
  marcas parecidas o una marca ausente, y comprueba que migraciones, P0 y
  suite SQL abortan antes de hacer nada. Desde la Fase 3 añade el
  aislamiento: unos secrets coherentes de un proyecto con la marca
  `roomly-validation-2` no pasan la guarda, y migraciones, P0 y suite SQL
  abortan sin crear nada.
- **`sql-suite-selftest.sh` (78) y `preflight-selftest.sh` (44):** ver
  arriba. Desde la Fase 3.1, el primero cuenta los archivos de `tests/db` en
  vez de fijar el número.
- **`migration-upgrade-selftest.sh` (Fase 3.1):** aplica las migraciones de
  la Fase 2, inserta datos (incluidas filas de `compatibility_responses` con
  los DEFAULT antiguos), aplica después las migraciones nuevas y comprueba
  que los datos se conservan y quedan sujetos al trigger. Es la actualización
  incremental, solo en local.

## Pendiente de decisión o de ejecución (no lo hace Claude)

Hechos (2026-10-06):
1. ✅ **Proveedor de SMTP y de buzón:** Mailtrap Email Sandbox, con su
   adaptador en `tests/e2e/real/mailboxes/mailtrap.mjs` (`ec7c3fc`).
2. ✅ **Proyecto y secrets:** `roomly-validation-2b` (`uwxb…`), con sus
   secrets en el Environment `roomly-validation-2`.
3. ✅ **Workflow:** run 13 (`apply_migrations=true`, `run_e2e_real=false`)
   y run 15 (`apply_migrations=false`, `run_e2e_real=true`).
4. ✅ **Registro cerrado** a mano después del E2. Automatizarlo exigiría un
   token de la Management API, que da acceso a toda la cuenta: no se ha
   añadido.

Pendiente operativo, aparte del cierre de la 2.8:

5. **Rotar las claves y pausar o borrar** `roomly-validation-2b` cuando no
   se use. Sigue activo, con el esquema, el seed y el SMTP de Mailtrap; el
   propietario lo tratará en una acción específica de seguridad y
   limpieza.

Desde la Fase 3 el workflow ya no puede ejecutarse contra este proyecto:
usa el Environment `roomly-validation-3` y la guarda exige esa marca, así
que `uwxb…` (`roomly-validation-2`) se rechaza antes de hacer nada.

### Fase 3: la próxima validación real (pendiente, con autorización)

`uwxb…` tiene el esquema de la Fase 2 y **no se toca**. El código de la
Fase 3 ya no encaja con ese esquema:
- la suite SQL 14 y la api-suite CRA1–CRA6 necesitan
  `20261007120000_compatibility_responses_hardening.sql`;
- el preflight espera 13 triggers y 11 funciones.

Un run del workflow contra `uwxb…` no llega a ejecutarse: la guarda lo
rechaza por su marca. La estrategia aprobada es un **proyecto Supabase
nuevo y vacío**:
1. Crear el proyecto `roomly-validation-3`, su marca, el GitHub Environment
   `roomly-validation-3` y sus secrets (autorización aparte; lo hace el
   propietario, después del merge de este cambio).
2. ✅ Marca adaptada a `roomly-validation-3` (antes fijada a
   `roomly-validation-2`) en `tests/supabase/guard.sh`, `preflight.sql` P0,
   los selftests (con los casos de aislamiento de `roomly-validation-2`) y
   `supabase-validation.yml` (Environment de los 7 jobs y
   `confirm_project`).
3. Run con `apply_migrations=true` desde cero: guarda, migraciones, P0–P6,
   SQL 01–14, api-suite y AU.
4. E2 en el proyecto nuevo (SMTP de Mailtrap y una ventana de registro), con
   su propia autorización.

Mientras tanto, en local: `test:db` (14 archivos), `test:infra` (incluida la
actualización incremental), unitarios y E1.

D6 = B: la app del workflow sigue sin service_role.

---

## Histórico: checkpoint contra `roomly-validation` (Fase 1)

Proyecto `roomly-validation` (Frankfurt), marca `'roomly-validation'`,
registro público desactivado. Ejecutado por el propietario entre el
2026-09-28 y el 2026-09-29, antes de todas las migraciones de Fase 2:
- **Suite SQL 58/58**: `tests/db/01`–`04`. Se ejecutó en una sola
  transacción, cuando todavía no existían `05`–`12`.
- **supabase-js 46/46**.
- **AU3/AU5 6/6**.
- **AU4/AU5 manual ✅**. El usuario se creó desde el dashboard, así que el
  registro por magic link **no** se probó: queda para el E2 de la Fase 2.8.

`roomly-validation` no tiene ninguna migración de Fase 2 (`20260929120000`
y posteriores) y **no se usa en la Fase 2.8**. Sus credenciales no pasan
las guardas nuevas porque su marca es distinta. Queda pendiente rotar sus
claves, borrar sus secrets de GitHub si siguen como secrets del
repositorio, y pausarlo o borrarlo.

**AU4 manual** (cómo se hizo entonces):
1. Se añadió un email real como usuario desde el dashboard.
2. Se levantó `npm run dev` en local, con `.env.local` apuntando al
   proyecto (solo la URL y la clave pública).
3. En `/login` se pulsó «Enviar enlace» y se abrió el enlace en el mismo
   navegador: acabó en `/` con sesión.
4. Se borró el usuario.

**AU5 con sesión** (cómo se hizo entonces):
- como usuario normal, `/admin` redirigía a `/`;
- con `role = 'admin'` asignado desde el SQL Editor, se veía el panel;
- después se devolvió a `user` y se borró el usuario.

Nota: el SQL Editor corre como `postgres`. Cualquier prueba de permisos
escrita allí a mano solo vale si hace `set role authenticated` y fija
`request.jwt.claims`; si no, no demuestra nada.

### Hallazgos registrados en ese checkpoint

- **D14 (INFO, sin corregir):** `@supabase/ssr` 0.12.7 usa
  `httpOnly: false` por defecto para las cookies de sesión, porque el
  cliente de navegador necesita leerlas.
  - El comentario de `app/(auth)/callback/route.ts` que habla de «cookies
    HTTP-only» es inexacto.
  - Implicación: un XSS podría leer la sesión, lo que refuerza la
    prioridad de la CSP y de no usar `dangerouslySetInnerHTML`.
  - No se cambió `@supabase/ssr` ni el callback.
