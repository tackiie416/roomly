# PROGRESS.md

Log de sesiones. Cada entrada nueva va arriba. Formato de cada entrada:
**qué se hizo · qué queda · problemas encontrados · decisiones técnicas ·
próximos pasos.**

---

## 2026-09-29 — Sesión 8: AU4/AU5 manuales, migración `middleware.ts` → `proxy.ts` y cierre de Fase 1

**Qué se hizo**
- **AU4 y AU5 manuales** contra `roomly-validation`, ejecutados por el
  propietario en su PC (`npm run dev` + `.env.local` con URL y clave
  pública). Resultado confirmado por el propietario, paso a paso:
  `/admin` sin sesión → `/login?next=…`; mensaje "Revisa tu correo";
  el enlace del email (mismo navegador, PKCE) inicia sesión; cookie
  `sb-…-auth-token` presente; `/admin` con sesión sin admin → `/`; tras
  asignar `admin` desde el SQL Editor (lo ejecutó el propietario), `/admin`
  muestra el panel. Teardown: 0 usuarios / 0 profiles.
- **Migración `middleware.ts` → `proxy.ts`** (Next.js 16.3.6, según
  `node_modules/next/dist/docs/.../upgrading/version-16.md` y `proxy.md`):
  renombrado del archivo y del export `middleware()` → `proxy()`. Sin
  codemod y sin cambios de lógica, `matcher`, imports ni Supabase.
  - Build: `ƒ Proxy (Middleware)`, sin aviso de deprecación.
    `functions-config-manifest.json` registra `/_middleware` con
    `runtime: "nodejs"` y el mismo `matcher`; `middleware-manifest.json`
    ya no tiene entradas Edge. Antes era Edge (`server/edge/…`).
  - No hay `export const runtime` (en `proxy` no se puede configurar).
  - Validación local con `next start` y un Supabase **simulado** en
    `localhost:54321` (sin tocar `roomly-validation`): `/admin` sin sesión
    → 307 `/login?next=%2Fadmin`; sesión con rol no admin → 307 `/`;
    rol admin → 200 con el panel; token caducado → el proxy llama a
    `/auth/v1/token?grant_type=refresh_token` y devuelve `Set-Cookie`
    (en `/admin` y en `/`); callback sin `code` o con `code` inválido →
    `/login?error=auth_callback_failed`; `tests/supabase/auth-redirects.sh`
    6/6 (AU3a–e, AU5a).
  - Comentarios que citaban `middleware` actualizados
    (`app/admin/layout.tsx`, `lib/supabase/server.ts`, cabecera de
    `proxy.ts`). Solo comentarios.
- **Reconciliación documental** de Fase 1: `docs/ROADMAP.md`,
  `docs/TESTING.md`, `docs/ENVIRONMENT.md`, `docs/ARCHITECTURE.md`,
  `docs/SUPABASE_VALIDATION.md`, `CLAUDE.md`, `README.md`, `HANDOFF.md`
  (aviso de documento histórico) y `ROOMLY_MASTER_SPEC.md` (nota de la
  decisión 16). Se corrigen afirmaciones obsoletas: "nunca ejecutado
  contra Supabase real", "CI nunca ejecutado en GitHub", "Foundation sin
  commitear", "7/7 tests" y la migración a `proxy` como pendiente.

**Resultados reales**: `format` sin cambios · `lint` ✅ · `typecheck` ✅ ·
`test` 39/39 ✅ · `build` ✅. CI (`ci.yml`) en GitHub: 6 runs, todos
`success` (PR y push a `master` de los PRs #1, #2 y #3), comprobado vía API.

**Decisiones del usuario**
- Google OAuth y Apple OAuth: **diferidos**.
- E2E/Playwright en CI: **diferido a Fase 2**, cuando existan flujos
  reales de usuario.
- No se repite ninguna prueba que escriba en `roomly-validation`.
- El alta real de un usuario nuevo por magic link **no se validó**
  (signups desactivados en `roomly-validation`; el usuario de AU4 se creó
  desde el dashboard). Se **traslada a Fase 2**, junto con Registro y la
  creación de perfil tras el primer login (M6). El login sí está validado.
- Con eso, **Fase 1 (Foundation) queda completada** en `docs/ROADMAP.md`.

**Consecuencia conocida (no bloqueante)**: el proxy pasa de Edge a
Node.js. En Vercel se ejecutará como función Node y no como Edge
Middleware (latencia/región/coste por petición pueden cambiar). Se medirá
cuando haya despliegue.

**Qué queda**
- Hallazgos abiertos de la auditoría, sin cambios y fuera del checklist de
  Fase 1: H3, H4, H6, H7, M1, M3, M4, M6, L2, D14, PR8.

**Próximos pasos**: esperar confirmación del usuario antes de empezar
Fase 2. Fase 2 **no** se ha iniciado.

---

## 2026-09-28 — Sesión 7: validación contra Supabase real completada (checkpoint previo a Fase 1 cerrado)

**Qué se hizo**
- Proyecto de validación `roomly-validation` (Frankfurt, PostgreSQL 17.6),
  con la marca de identidad F1 escrita y leída desde el propio proyecto.
  Migraciones + seed aplicados por el propietario; P0–P5 en verde.
- Workflow `Supabase validation` llevado a `master` (PR #2, `9ce2b8d`). El
  run #1 terminó `success` pero con las suites **skipped** (un job omitido en
  la cadena de `needs` arrastraba a los demás); corregido con 3 condiciones
  `if` en el workflow (`241a274`, PR #3, merge `50c8d24`).
- Run #2 (`36493446123`, sobre `50c8d24`, `apply_migrations=false`): todos
  los jobs ejecutados, ninguno skipped salvo `migrate` (intencionado).

**Resultados reales**
- Guarda F1 ✅ · P0–P5 ✅.
- Suite SQL (`tests/db`, roles reales, `ROLLBACK`): **58/58**.
- Suite supabase-js (PostgREST + JWT reales de usuarios de Auth): **46/46**.
- AU3/AU5 (redirects de la app): **6/6**.
- C1, C2, C3, H5 y M2 validados contra Supabase real. Sin vulnerabilidades
  nuevas en el alcance auditado.
- Teardown: la suite terminó sin errores y la comprobación independiente
  posterior en el SQL Editor dio 0 usuarios de prueba y 0 filas en
  profiles, rooms, conversations, messages y reports.

**Hallazgos registrados (sin cambios)**
- PR8: `upsert()` de `profiles` lo rechaza Supabase (`42501`): restricción de
  diseño para Fase 2 (INSERT + UPDATE o creación desde servidor); no se
  relajan permisos.
- H3 confirmado en real: `anon` lee `public_profile_previews` con `role`.
  Sigue pendiente de decisión, igual que H6, H7, Storage y `middleware` →
  `proxy` (este último, resuelto en la sesión 8).

**Próximos pasos**: cerrar los puntos que quedan del checklist de Fase 1
(`docs/ROADMAP.md`) antes de empezar Fase 2. No se ha empezado ninguna fase.

---

## 2026-09-26 — Sesión 6: preparación de la validación contra Supabase real (checkpoint previo a Fase 1)

**Qué se hizo** (solo tests/infraestructura/docs; sin cambios de producto,
migraciones ni RLS)
- `tests/supabase/`: guarda de destino (`guard.sh`), aplicación única y
  transaccional de migraciones + seed, P1–P5 (`preflight.sql`), suite
  `tests/db` con roles reales dentro de `BEGIN … ROLLBACK`, y AU3/AU5 contra
  la app local.
- `tests/integration/supabase-validation.test.ts` +
  `vitest.integration.config.ts` (`npm run test:supabase`, fuera de
  `npm run test`): PR1–PR12, CH1–CH11, RO1–RO9, RE1–RE9, AU2 con JWT reales;
  `service_role` solo para preparar/limpiar y PR11/RO7; teardown respetando
  H6.
- Workflow manual `.github/workflows/supabase-validation.yml`.
- `docs/SUPABASE_VALIDATION.md` (configuración, secrets, matriz, pasos
  manuales AU4/AU5, D14).

**Verificado en local** (PostgreSQL 16 simulando el proyecto): migraciones
aplicadas una vez y rechazo de la segunda aplicación; P1–P5 en verde (y P2/P4
detectan un FORCE RLS y un GRANT de tabla completo reintroducidos); suite SQL
58/58 sin dejar rastro tras el ROLLBACK; la guarda rechaza URL/DB de otro
proyecto y variables ausentes; AU3/AU5 en verde contra `next start` y en rojo
sin app. La suite supabase-js **no** se ha ejecutado todavía: necesita el
proyecto real.

**Problema encontrado y corregido en la propia infraestructura**: P5
marcaba como falso positivo las funciones de la extensión `pgcrypto`;
ahora excluye las funciones que pertenecen a extensiones (como el linter de
Supabase).

**Hallazgo nuevo registrado (INFO, sin corregir)**: D14 — cookies de sesión
de `@supabase/ssr` con `httpOnly: false`; el comentario "HTTP-only" del
callback es inexacto (ver `docs/SUPABASE_VALIDATION.md`).

**Revisión de la infraestructura (F1–F5), corregido con autorización**
- F1 (MEDIUM): la guarda solo comprobaba coherencia local de los secrets.
  Ahora exige la marca `COMMENT ON DATABASE postgres IS 'roomly-validation'`
  leída del propio proyecto en todos los puntos de entrada (guard.sh, P0,
  suite SQL, migraciones, suite supabase-js), sin fallback. Auto-test
  `tests/supabase/guard-selftest.sh`: 16/16, y detecta la guarda mutada.
- F2: limpieza solo de emails `^roomly-val-[0-9a-f]{8}-[a-z]@example\.com$`.
- F3: solo conversaciones registradas por la ejecución (o, de ejecuciones
  interrumpidas, con exclusivamente participantes de prueba).
- F4: `expectOk` exige `error === null`.
- F5: RO3/RO5/RO6 exigen `42501` + mensaje `room_moderation:` del trigger.

**Pendiente**: crear `roomly-validation`, poner la marca de identidad
(confirmar que `postgres` puede hacer `comment on database`), crear los
secrets, llevar el workflow a `master` (requisito de `workflow_dispatch`) y
ejecutar. Resultados reales: se añadirán aquí.

---

## 2026-09-26 — Sesión 5: auditoría inicial en Claude Code + correcciones de seguridad y CI autorizadas

**Qué se hizo**
- Auditoría inicial completa (documentación + código + SQL). Por primera
  vez se aplicaron las migraciones en un PostgreSQL 16 real (con un shim
  mínimo de Supabase): aplican limpias, 18 tablas / 35 políticas / 15
  índices / RLS en las 18. Cada hallazgo se demostró con un ataque real.
- Correcciones autorizadas por el usuario, en una **migración nueva**
  (`supabase/migrations/20260926120000_security_fixes.sql`, las dos
  anteriores intactas):
  - **C1 (CRITICAL)**: cualquier usuario podía crear su propio perfil con
    `role = 'admin'` (la corrección de la sesión 3 solo cubría `UPDATE`).
    → `GRANT INSERT` por columnas + `with check (role = 'user')`.
  - **C2 (CRITICAL)**: `messages_*` tenía `cp.conversation_id =
    cp.conversation_id` (el `conversation_id` sin cualificar se resolvía
    contra la subconsulta): acceso a todas las conversaciones.
  - **C3 (CRITICAL)**: recursión infinita en
    `participants_select_own_conversations` — el chat entero fallaba.
    → C2+C3: función `public.is_conversation_participant(uuid)`
    (`SECURITY DEFINER`, `search_path` vacío, sin parámetro de usuario).
  - **H5 (HIGH)**: el propietario podía reactivar una habitación
    `removed` por un admin. → trigger `trg_rooms_moderation`.
  - **M2 (MEDIUM)**: se podían crear reportes ya resueltos. → `GRANT
    INSERT` por columnas + `with check`.
- **H1 (HIGH)**: open redirect en `app/(auth)/callback/route.ts`
  (`next=@evil.com` → `evil.com`). → `lib/auth/safe-redirect.ts` + 32
  tests unitarios.
- **H2 (HIGH)**: CI solo se disparaba en push a `main` (la rama es
  `master`) y `format:check` fallaba en `types/database.ts`. → trigger a
  `master`, formato corregido, nuevo job `db-security`.
- Tests de regresión de seguridad en `tests/db/` (`npm run test:db`):
  58 aserciones, validadas con pruebas de mutación (cada vulnerabilidad
  reintroducida pone rojo su test).
- Docs actualizadas solo donde las correcciones las afectan:
  `docs/SECURITY.md`, `docs/DATABASE.md`, `docs/TESTING.md`, `CLAUDE.md`.

**Resultados reales**: `format:check`, `lint`, `typecheck` ✅ · `test`
39/39 ✅ · `build` ✅ (también con env vacía) · `test:db` 58/58 ✅ ·
`test:e2e`: falla con la config del repo por la versión de Chromium del
entorno cloud (1194 instalado, 1243 requerido); con Chromium preinstalado
2/2 ✅. Detalle en `docs/TESTING.md`.

**Decisiones técnicas**
- `removed` pasa a ser estado exclusivo de moderación: el propietario
  tampoco puede fijarlo él mismo (tiene `paused` y el soft-delete).
- Consecuencia de C1 (ya existía para UPDATE, ahora también para INSERT):
  cambiar `role`/`deleted_at` solo se hace con `service_role` desde el
  servidor, nunca desde el cliente, tampoco siendo admin.
- `next dev` (Next 16.3) añade un bloque `nextjs-agent-rules` a
  `CLAUDE.md` cuando detecta un agente de IA; se revirtió manualmente, no
  se ha decidido todavía si desactivarlo (`agentRules: false`) o aceptarlo.

**Qué sigue abierto (de la auditoría, NO corregido a propósito, pendiente de decisión)**
- H3: `public_profile_previews` expone a `anon` nombre, avatar, id y
  `role` de todos los usuarios.
- H4: cualquier usuario autenticado lee `date_of_birth` de todos.
- H6: borrar una cuenta falla por FKs sin `ON DELETE` (`messages`,
  `reports`, `admin_action_logs`, `conversations.match_id`...).
- H7: no existe modelo de bloqueo entre usuarios ni baneo por admin.
- M1: el rate limit de `interests` se elude borrando y reinsertando.
- M3: Storage (buckets/políticas) solo documentado. M4: escritura directa
  vía PostgREST salta Zod; sin límites de longitud en BD. M6: login ignora
  `?next=` y no hay creación de perfil tras el primer login.
- L1 `middleware` → `proxy`; L2 bloque de `next dev` en `CLAUDE.md`.
- Contradicción documental no reconciliada: HANDOFF/ROADMAP/CLAUDE.md
  dicen que Foundation está sin commitear, pero está en `d1089aa`.

**Próximos pasos**: revisión de estas correcciones por el usuario, push
(solo con su autorización), y decisión sobre los puntos abiertos antes de
cerrar Fase 1. Fase 1 NO se ha empezado a cerrar en esta sesión.

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
