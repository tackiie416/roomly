# CLAUDE.md

Léeme antes de hacer cambios importantes en este repo.

## Objetivo del proyecto

ROOMLY: plataforma para encontrar compañeros de piso compatibles y formar
grupos de convivencia, empezando por estudiantes en Barcelona. El
diferencial no es "otro portal de habitaciones" — es compatibilidad de
convivencia + confianza + formación de grupos, calculado de forma
determinista y explicable, no con IA generativa.

Flujo del MVP: **estudiante → perfil → test → match → habitación → contacto**.
Todo lo demás (pagos, contratos, verificación KYC, grupos completos, apps
móviles) es roadmap posterior — ver `docs/ROADMAP.md`.

## Estado actual

**Fase 0 (arquitectura) completada.** Diseño ya revisado críticamente
(sobreingeniería, seguridad, escalabilidad — ver `docs/DATABASE.md` y
`docs/ARCHITECTURE.md`, sección "Revisión crítica"). Cero código de
aplicación escrito todavía. Esperando confirmación para empezar Fase 1.

## Stack

- **Frontend/Backend**: Next.js + TypeScript (App Router), Server Actions
  como capa de transporte, nunca de lógica de negocio.
- **UI**: Tailwind CSS.
- **DB/Auth/Storage/Realtime**: Supabase (PostgreSQL + RLS).
- **Validación**: Zod en todo input de Server Action/Route Handler —
  nunca confiar solo en validación de cliente.
- **Mapas**: Mapbox (recomendado sobre Google Maps por coste — solo
  necesitamos pines aproximados, no búsqueda de negocios; confirmar).
- **Email**: Resend.
- **Analítica**: PostHog (región EU).
- **Pagos**: Stripe — no se integra hasta que exista demanda real.
- **Testing**: Vitest (unit/integración) + Playwright (E2E).
- **Hosting**: Vercel.
- **Mobile (futuro, no MVP)**: React Native + Expo, reutilizando
  `lib/services/*` vía una API REST fina que se añade cuando haga falta.

## Estructura

Ver árbol completo en `docs/ARCHITECTURE.md`. Regla de oro: **Server Actions
delgadas → `lib/services/*` con la lógica real → `lib/supabase/*` para
acceso a datos.** Nunca lógica de negocio dentro de un archivo de
`app/actions/`.

Rutas de usuario (`app/(marketing)`, `app/(app)`...) en español, para que
coincidan con las URLs de SEO. Código interno (`lib/`, `components/`) en
inglés.

## Comandos

Todavía no existen (no hay `package.json` — eso es Fase 1). Se documentan
aquí en cuanto se creen: `dev`, `build`, `lint`, `typecheck`, `test`,
`test:e2e`.

## Reglas

1. **Nunca** lógica de negocio en un Server Action — solo orquestación
   fina que llama a `lib/services/*`.
2. **Nunca** `SELECT *` donde pueda haber una columna sensible (sobre todo
   `room_addresses.address_exact`) — proyectar columnas explícitamente.
3. **Nunca** confiar solo en RLS ni solo en validación de cliente — las
   dos capas, siempre.
4. **Nunca** N+1: listados con relaciones usan `select` anidado de
   Supabase o un join explícito, nunca un fetch dentro de un bucle.
5. **Nunca** commitear `.env*` (ya está en `.gitignore` desde el primer
   commit) ni exponer `SUPABASE_SERVICE_ROLE_KEY` al cliente.
6. El algoritmo de matching vive en `lib/matching/score.ts` como función
   pura — nunca en SQL/triggers, nunca llamando a un LLM.
7. Antes de tocar el esquema de base de datos, leer `docs/DATABASE.md`
   completo, no solo el SQL.
8. No pasar a la siguiente fase del roadmap si la anterior tiene tests
   rotos.
9. Nada de microservicios, colas, Kubernetes, ni bases de datos
   adicionales sin que aparezca una razón de negocio concreta — no
   "por si acaso".

## Seguridad (resumen — detalle en `docs/SECURITY.md`)

- RLS activada en **todas** las tablas de `public`, incluidas las de
  referencia (con política de lectura abierta explícita, no por omisión).
- `profiles` completo requiere sesión; las páginas públicas usan la vista
  `public_profile_previews` (solo nombre/avatar/rol).
- Dirección exacta de habitación aislada en `room_addresses`, solo
  legible por el propietario.
- `matches`/`conversations`/`conversation_participants` no aceptan INSERT
  de cliente — se crean solo desde el servidor.
- Rate limit a nivel de base de datos (trigger) sobre `interests`, además
  del check en la app.
- `/admin` se protege en RLS **y** en el servidor (nunca solo ocultando
  el enlace en el cliente).

## Testing

Ver `docs/TESTING.md`. Prioridad: algoritmo de matching (casi cobertura
total, es el diferencial del producto), RLS por rol, y los 3 flujos E2E
obligatorios (estudiante, room provider, admin). El sandbox de desarrollo
actual no puede descargar navegadores de Playwright (dominio no permitido)
— esos tests corren en GitHub Actions o en local, no aquí.

## Alcance del MVP — qué NO se construye todavía

Pagos, contratos, seguros, KYC de terceros, videollamadas, IA generativa
para matching o recomendaciones, sistema de reputación avanzado,
multi-idioma, grupos de piso completos, app móvil. Todo esto tiene hueco
en el esquema/arquitectura para añadirse después sin reescritura — ver
`docs/ROADMAP.md`.

## Funcionalidades terminadas

Ninguna todavía. Solo arquitectura, esquema de base de datos (sin
aplicar) y documentación.

## Funcionalidades pendientes

Todo el roadmap de Fase 1 a Fase 9 — ver `docs/ROADMAP.md`.

## Pendiente de confirmación del usuario (no técnico, no lo decido yo)

- Datos legales de la empresa (razón social, NIF, dirección, DPO) para
  Términos y Privacidad — marcado como REQUIERE REVISIÓN LEGAL.
- Dominio de producción.
- Si ya existen cuentas de Supabase/Vercel o hay que crearlas guiadas en
  Fase 1.
- Confirmar o corregir las recomendaciones de este documento (magic link,
  Mapbox) — son decisiones tomadas con criterio técnico, no bloqueantes,
  pero reversibles si no encajan con el negocio.
