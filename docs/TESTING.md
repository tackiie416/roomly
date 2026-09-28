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
  convención `middleware.ts` en favor de `proxy.ts` — confirmado leyendo
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
  ejecutados — no hay proyecto Supabase real disponible desde este
  entorno. Sigue pendiente para cuando exista.

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

`expect_error` exige un SQLSTATE concreto: un "fallo por el motivo
equivocado" (p. ej. recursión infinita en vez de rechazo por RLS) hace
fallar el test en vez de pasar por accidente.

**Resultado real (2026-09-26)**: 58/58 aserciones en verde en PostgreSQL
16.13, por socket local y por TCP (como el servicio `postgres:16` de CI).
**Validación de que los tests saben fallar** (pruebas de mutación en una
copia fuera del repo): sin la migración de correcciones fallan los 4
archivos, y reintroducir por separado cada vulnerabilidad (INSERT de role,
tautología en `messages`, política recursiva, INSERT de mensajes sin
comprobar participante, borrar el trigger de `rooms`, INSERT de reportes
sin restringir) pone rojo su test correspondiente.

**Limitación**: el shim no es Supabase. Cuando exista un proyecto real o
`supabase start`, estos mismos tests deben correr también allí.

## Validación contra Supabase real (checkpoint previo a Fase 1)

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
  sin secrets). Sigue el aviso de `middleware` → `proxy`.
- `test:db` → 58/58 (ver arriba).
- `test:e2e` → **con la configuración del repo falla en el entorno de
  Claude Code en la nube**: Playwright 1.63 busca `chromium-1243` y ese
  entorno trae preinstalado `chromium-1194` (no se permite `playwright
  install`). No es un fallo del proyecto y no se ha cambiado la config
  para ocultarlo. Con una config temporal fuera del repo que apunta al
  Chromium preinstalado, el smoke test pasa 2/2. Necesita
  `NEXT_PUBLIC_SUPABASE_URL`/`ANON_KEY` definidas (aunque sean ficticias):
  el middleware las valida en cada petición.

## Limitación conocida de este entorno

El sandbox de desarrollo actual no tiene salida de red hacia el CDN de
Playwright, así que no puede descargar navegadores aquí. Los tests
unitarios y de integración (Vitest) sí corren sin problema en este
entorno. Los E2E se diseñan para correr en GitHub Actions (que sí tiene
acceso) o en local — no bloquean el desarrollo diario, solo no se
ejecutan dentro de este sandbox concreto.

De forma similar, validar RLS de verdad requiere Postgres real (Supabase
local con Docker — no disponible aquí — o un proyecto Supabase de test).
Las políticas del borrador de Fase 0 se tratan como eso, un borrador,
hasta que Fase 1 las valide con tests de integración reales.

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

E2E todavía no está en CI (necesita un proyecto Supabase de test). El
workflow no se ha ejecutado aún en GitHub Actions de verdad: sus pasos se
han reproducido localmente, uno a uno, con resultado verde.
