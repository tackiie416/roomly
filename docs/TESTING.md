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

GitHub Actions: lint + typecheck + tests unitarios/integración en cada
PR. E2E en merge a `main` o de forma programada (no en cada PR, para no
ralentizar el ciclo de desarrollo).
