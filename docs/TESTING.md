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

## Estado actual (2026-09-30)

| Comprobación | Resultado | Dónde |
|---|---|---|
| `format:check`, `lint`, `typecheck`, `build` | ✅ | local y CI |
| `npm run test` | ✅ 469/469 (39 de Fase 1 + 113 de Fase 2.1 + 131 de routing de Auth, Fase 2.2 + 64 de onboarding, Fase 2.3 + 69 de perfil propio, Fase 2.4 + 53 de preferencias, Fase 2.5: reglas del servicio, Server Action (también referencias inexistentes o incompatibles), página, formulario, datos de referencia y proxy) | local; en CI corrían 39/39, los nuevos correrán en el próximo push |
| `tests/supabase/auth-redirects.sh` | ✅ 16/16 (AU3a–g, AU5a–i) | local contra `next start` con Supabase simulado (Fases 2.2 y 2.3); en `roomly-validation` se ejecutaron las 6 anteriores |
| Flujo de onboarding en Chromium | ✅ con y sin JavaScript | local con `next start` y Supabase simulado con estado (Fase 2.3); no es la suite E2E |
| Flujo de `/perfil` en Chromium | ✅ 24/24 (12 con y 12 sin JavaScript, incluido el logout) |
| Flujo de `/preferencias` en Chromium | ✅ 43/43 (22 con y 21 sin JavaScript; el filtro dinámico solo aplica con JavaScript; incluye crear preferencias con el onboarding ya completado) + regresión del onboarding 2/2 | local con `next start` y Supabase simulado con estado que emula los triggers (Fase 2.5); no es la suite E2E | local con `next start` y Supabase simulado con estado (Fase 2.4); no es la suite E2E |
| `npm run test:db` (PostgreSQL local con shim) | ✅ 192/192 (incluye `05`/`06` de Fase 2.0, `07` de Fase 2.3, `08` de cuentas eliminadas, `09` de Fase 2.4 y `10` de Fase 2.5) | local; en CI (`db-security`) corrían 58/58 hasta Fase 2.0, las nuevas correrán en el próximo push |
| Suite SQL `tests/db` con roles reales | ✅ 58/58 (sin `05`–`07`) | `roomly-validation`; las migraciones de Fase 2.0 y 2.3 no están aplicadas allí |
| `npm run test:supabase` (supabase-js, JWT reales) | ✅ 46/46 | `roomly-validation` |
| AU3 / AU5 sin sesión (`auth-redirects.sh`) | ✅ 6/6 | `roomly-validation` y local tras `proxy.ts` |
| AU4 magic link / AU5 con sesión | ✅ manual | `roomly-validation`, PC del propietario |
| CI `ci.yml` en GitHub Actions | ✅ 6 runs en verde (PR + `master`) | GitHub |
| `test:e2e` (Playwright) | ⏸ diferido a Fase 2 | no ejecutado con `playwright install` real |

Las secciones siguientes son el registro histórico de cada sesión; lo que
dicen como "pendiente" puede estar ya superado por esta tabla.

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
| `07_onboarding_integrity.sql` (Fase 2.3) | perfil sin `seeking_status` (ya no hay default); `flexible` explícito aceptado; marcar `onboarding_completed_at` sin preferencias, sin ciudad o en el INSERT; completar el de otro; ejecutar la función del trigger directamente; el servidor tampoco se lo salta |
| `10_preferences_integrity.sql` (Fase 2.5) | con el onboarding completado: quitar la ciudad (cliente y servidor), crear preferencias sin ciudad, borrarlas desde el cliente; que antes del onboarding todo siga siendo opcional y borrable; que el servidor pierda el borrado o la cascada del perfil; universidad de otra ciudad (y al cambiar solo la ciudad), universidad sin ciudad aceptada, FK intacta; barrio de otra ciudad; estructura de triggers, funciones y política |
| `09_own_profile_update.sql` (Fase 2.4) | que una cuenta activa deje de poder escribir alguno de los campos de `/perfil`; que `id`, `created_at` o `updated_at` pasen a ser actualizables; editar un perfil ajeno; vaciar `seeking_status` o `email_notifications_enabled`; `bio` de más de 500 |
| `08_deleted_account_writes.sql` (decisión B) | una cuenta eliminada que actualiza su perfil o crea, actualiza o borra sus preferencias por PostgREST (con el mismo JWT de antes de eliminarse); que la lectura propia o ajena cambie; que el admin o `service_role` pierdan sus escrituras; que vuelva una política `FOR ALL` en `housing_preferences` |

`expect_error` exige un SQLSTATE concreto: un "fallo por el motivo
equivocado" (p. ej. recursión infinita en vez de rechazo por RLS) hace
fallar el test en vez de pasar por accidente.

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

**Limitación**: el shim no es Supabase. Por eso la misma suite se ha
ejecutado también en `roomly-validation` con roles reales (58/58).

## Validación contra Supabase real (checkpoint previo a Fase 1)

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
cloud trae `chromium-1194` y Playwright 1.63 espera `chromium-1243`. Los
E2E quedan **diferidos a Fase 2**: se incorporarán (en CI o en local con
red real) cuando existan flujos reales de usuario.

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
- `db-security`: `tests/db/run.sh` contra un servicio `postgres:16`.

El workflow se ha ejecutado en GitHub Actions de verdad: 6 runs, todos en
verde (PR y push a `master` de los PRs #1, #2 y #3). E2E no está en CI:
diferido a Fase 2. La validación contra Supabase real tiene su propio
workflow manual (`supabase-validation.yml`), que nunca corre en push ni en
PR.
