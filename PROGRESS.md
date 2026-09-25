# PROGRESS.md

Log de sesiones. Cada entrada nueva va arriba. Formato de cada entrada:
**qué se hizo · qué queda · problemas encontrados · decisiones técnicas ·
próximos pasos.**

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
