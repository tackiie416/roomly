# ROOMLY

> Encuentra piso. Encuentra compañeros. Encaja de verdad.

Plataforma para encontrar compañeros de piso compatibles y formar grupos
de convivencia. Lanzamiento inicial: estudiantes en Barcelona.

🚧 **Estado: Fase 0 (arquitectura) completada.** Sin código de aplicación
todavía — ver `PROGRESS.md` para el detalle de la sesión actual.

## Documentación

- [`CLAUDE.md`](./CLAUDE.md) — referencia rápida del proyecto (léelo primero)
- [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) — arquitectura del sistema
- [`docs/DATABASE.md`](./docs/DATABASE.md) — esquema de base de datos y su revisión crítica
- [`docs/ROADMAP.md`](./docs/ROADMAP.md) — fases de desarrollo
- [`docs/TESTING.md`](./docs/TESTING.md) — estrategia de testing
- [`docs/SECURITY.md`](./docs/SECURITY.md) — principios de seguridad
- [`docs/ENVIRONMENT.md`](./docs/ENVIRONMENT.md) — variables de entorno
- [`PROGRESS.md`](./PROGRESS.md) — log de sesiones

## Stack

Next.js + TypeScript · Tailwind · Supabase (Postgres + Auth + Storage +
Realtime) · Vitest + Playwright · Vercel.

## Alcance del MVP

Estudiante → perfil → test de compatibilidad → match → habitación →
contacto. Sin pagos, sin contratos, sin KYC de terceros — ver
`CLAUDE.md` para la lista completa de lo que queda fuera a propósito.
