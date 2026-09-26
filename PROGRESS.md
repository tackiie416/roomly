# PROGRESS.md

Log de sesiones. Cada entrada nueva va arriba. Formato de cada entrada:
**qué se hizo · qué queda · problemas encontrados · decisiones técnicas ·
próximos pasos.**

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
