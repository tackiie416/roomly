# HANDOFF — ROOMLY, de Claude Chat a Claude Code local

> **Documento histórico (2026-09-25).** Describe el estado en el momento
> de la transferencia. Casi todo lo que aquí figura como pendiente ya está
> hecho: Foundation commiteado (`d1089aa`), Supabase real validado, CI en
> verde en GitHub y `middleware.ts` migrado a `proxy.ts`. Estado actual:
> `docs/ROADMAP.md` (Fase 1) y `PROGRESS.md` (última entrada).

## De dónde viene este proyecto

Todo lo que hay aquí se diseñó y se construyó en una conversación con
Claude Chat, dentro de un entorno de desarrollo en sandbox (sin acceso de
red a Supabase, Vercel, ni al CDN de navegadores de Playwright — sí a
npm y GitHub). Esa limitación de red es la razón principal por la que
este proyecto necesita continuar en un entorno con red real: hay trabajo
que literalmente no se podía hacer allí.

Esta transferencia empaqueta el proyecto **tal cual está**, sin
completar nada que quedara a medias, y sin inventar resultados de
comprobaciones que no se llegaron a ejecutar.

## Qué se ha construido

**Fase 0 — Arquitectura: completa.**
- Especificación de producto completa (brief original del fundador +
  todas las decisiones técnicas tomadas) → `ROOMLY_MASTER_SPEC.md`.
- Arquitectura del sistema, separación frontend/backend, capa de
  servicios pensada para reutilizar con una futura app móvil sin
  duplicar backend → `docs/ARCHITECTURE.md`.
- Esquema de base de datos: 18 tablas, 15 índices, 35 políticas RLS,
  triggers, funciones, restricciones de columna → `docs/DATABASE.md` +
  SQL real en `supabase/migrations/` (2 migraciones) + `supabase/seed.sql`.
- Principios y hallazgos de seguridad, incluido un escalado de
  privilegios real que se encontró y se corrigió → `docs/SECURITY.md`.
- Roadmap completo por fases → `docs/ROADMAP.md`.
- 3 commits de Git reales cubren esta fase (ver `git log`).

**Fase 1 — Foundation: en progreso, sin cerrar.**
- Proyecto Next.js 16 + TypeScript + Tailwind v4 real (generado con
  `create-next-app`, no simulado).
- Dependencias reales instaladas: `@supabase/ssr`, `@supabase/supabase-js`,
  `zod`, `server-only`, `clsx`, `tailwind-merge`, `vitest`,
  `@playwright/test`, `prettier`, `eslint-config-prettier`.
- Código real: clientes Supabase (browser/server/admin), validación de
  entorno con Zod, `middleware.ts` (sesión + protección de `/admin`),
  `app/admin/layout.tsx` (segunda capa: rol real), login con magic link
  + Google, callback de OAuth, componentes UI mínimos, tests unitarios
  reales (7, todos en verde), configuración de Playwright (sin poder
  ejecutarlo), workflow de CI.
- `lint`, `typecheck`, `test` y `build` se ejecutaron de verdad y
  pasaron (`typecheck` falló primero por un bug real, se corrigió, se
  volvió a ejecutar — ver `docs/TESTING.md` para el detalle exacto).
- **Estos 36 archivos de Foundation están en el working tree pero NO
  commiteados** — decisión deliberada, no un olvido: el propio checklist
  de cierre de Fase 1 pedía no commitear hasta cerrar `playwright
  install`, la decisión sobre `middleware`→`proxy`, y la revisión final
  de `git diff`/secretos. Nada de eso se cerró antes de que llegara esta
  petición de transferencia.

## Decisiones definitivas (no las reabras sin razón nueva)

- Esquema de base de datos: 18 tablas, nombres tal como están (`profiles`
  en vez de `users`, `housing_preferences` en vez de `preferences`, sin
  tabla `verification_status`) — confirmado explícitamente por el
  usuario después de una comprobación de coherencia dedicada.
- `room_addresses` separada de `rooms`, con su propia política RLS.
- Restricción de columnas (`GRANT`/`REVOKE`) en `profiles.role` y
  `conversation_participants.conversation_id` — corrige un escalado de
  privilegios real. No lo quites ni lo "simplifiques".
- `admin_action_logs` como tabla de auditoría — se mantuvo a propósito
  tras una revisión de sobreingeniería que sí quitó otras dos tablas.
- Capa `lib/services/*` separada de los Server Actions — es la pieza que
  permite añadir la app móvil sin reescribir backend. No la saltes al
  implementar Fase 2 en adelante aunque parezca más rápido escribir la
  lógica directamente en el Server Action.

## Qué debe verificarse en local (nunca se verificó en el sandbox)

1. `npm install` completo, sin conflictos de peer dependencies (en el
   sandbox se encontró y corrigió uno entre `vitest` y `@types/node` —
   podría no ser el único en un entorno distinto).
2. `npx playwright install` — nunca se intentó con red real.
3. Un proyecto Supabase real (región EU recomendada): aplicar las 2
   migraciones + `seed.sql`, y entonces sí, con datos reales:
   - Auth por magic link y por Google, de extremo a extremo.
   - Las 35 políticas RLS, con tests de integración actuando como
     distintos usuarios/roles — nunca se han ejecutado contra Postgres
     real.
4. `npm run dev` — nunca se levantó el servidor de desarrollo de verdad
   (no tenía mucho sentido sin Supabase real).
5. El workflow de `.github/workflows/ci.yml` — existe el archivo, nunca
   se ha ejecutado en GitHub Actions de verdad.
6. La migración `middleware.ts` → `proxy.ts` que Next.js 16 recomienda
   (deprecado, no roto) — decidir si se hace ahora o se documenta como
   deuda técnica a propósito.

## Qué debe hacer Claude Code al recibir esto

1. Leer, en este orden: `CLAUDE.md`, `ROOMLY_MASTER_SPEC.md`, este
   archivo, `PROGRESS.md`, `docs/ARCHITECTURE.md`, `docs/DATABASE.md`,
   `docs/SECURITY.md`, `docs/ROADMAP.md`.
2. Inspeccionar el repositorio real: `git status`, `git log`,
   `package.json`, estructura de carpetas, migraciones, tests. Comparar
   contra lo que dice esta documentación.
3. Señalar cualquier diferencia entre lo que documenta este handoff y lo
   que encuentra realmente en disco — el traslado de sandbox a máquina
   local puede introducir diferencias (finales de línea, permisos,
   node_modules ausente porque no se transfirió a propósito...).
4. Presentar una auditoría corta del estado real antes de tocar nada.
5. Esperar confirmación explícita del usuario sobre cuál es el siguiente
   paso — lo más probable es cerrar el checklist de Fase 1 (puntos de la
   sección anterior), pero no darlo por sentado sin preguntar.

## Qué NO debe hacer Claude Code

- No interpretar esto como "crear ROOMLY desde cero". El código, las
  migraciones, la documentación y los 3 commits existentes se conservan.
- No commitear los 36 archivos de Foundation automáticamente sin cerrar
  antes el checklist pendiente (arriba) o sin que el usuario lo pida.
- No hacer `git push`, ni reescribir historial, ni borrar nada en bloque.
- No empezar Fase 2 (o cualquier funcionalidad de producto) sin
  confirmación explícita, aunque Fase 1 se cierre en la misma sesión.
- No inventar que algo "debería funcionar" — Supabase real, Playwright,
  y el propio `npm run dev` nunca se verificaron en el entorno anterior;
  hay que comprobarlo de verdad, no asumir por analogía.
- No cambiar el naming del esquema de base de datos (`profiles`,
  `housing_preferences`, sin `verification_status`...) sin una razón
  nueva y explícita del usuario — ya se revisó esta decisión una vez.

## Cuál es el siguiente paso

Cerrar el checklist de Fase 1 que quedó abierto (ver arriba: playwright
install, decisión proxy, Supabase real, verificación de auth/RLS de
extremo a extremo, revisión final de `git diff`/secretos, commit de
Foundation) — pero **solo tras la auditoría inicial y con confirmación
del usuario**, no automáticamente.
