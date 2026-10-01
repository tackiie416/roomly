# ROOMLY

> Encuentra piso. Encuentra compañeros. Encaja de verdad.

Plataforma para encontrar compañeros de piso compatibles y formar grupos
de convivencia. Lanzamiento inicial: estudiantes en Barcelona.

🚧 **Estado: Fase 0 (arquitectura) y Fase 1 (Foundation) completadas ·
Fase 2 (User) en progreso (2.0 base de datos y 2.1 validación/servicios completadas).**
Ver `docs/ROADMAP.md` y `PROGRESS.md` para el detalle exacto. `HANDOFF.md`
es el registro histórico de la transferencia desde otro entorno.

## Documentación

- [`CLAUDE.md`](./CLAUDE.md) — instrucciones permanentes del proyecto (léelo primero)
- [`ROOMLY_MASTER_SPEC.md`](./ROOMLY_MASTER_SPEC.md) — especificación completa de producto y arquitectura
- [`HANDOFF.md`](./HANDOFF.md) — si este proyecto te llega transferido, empieza aquí
- [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) — arquitectura del sistema
- [`docs/DATABASE.md`](./docs/DATABASE.md) — esquema de base de datos y su revisión crítica
- [`docs/ROADMAP.md`](./docs/ROADMAP.md) — fases de desarrollo
- [`docs/TESTING.md`](./docs/TESTING.md) — estrategia de testing y resultados reales
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
