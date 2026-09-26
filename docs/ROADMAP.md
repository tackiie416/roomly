# Roadmap — ROOMLY

Se trabaja fase a fase. No se empieza la siguiente si la anterior tiene
tests rotos. Cada fase: objetivo → criterios de aceptación → implementar →
testear → documentar → commit.

## Fase 0 — Arquitectura ✅ (esta entrega)

Diseño de arquitectura, esquema de base de datos, estructura de carpetas,
documentación. Sin código de aplicación.

## Fase 1 — Foundation 🚧 EN PROGRESO (interrumpida antes de cerrar el checklist — ver PROGRESS.md sesión 4)

**Objetivo**: proyecto Next.js real, conectado a un Supabase real, con
auth funcionando de extremo a extremo y CI básica.

**Estado real, punto por punto**:
- [x] Proyecto Next.js 16 + TypeScript + Tailwind v4 real (scaffold con `create-next-app`, no inventado).
- [x] `lib/supabase/{client,server,admin}.ts`, `lib/env.ts`, `middleware.ts`, `types/database.ts`.
- [x] Login (magic link + Google), callback, protección de `/admin` (2 capas).
- [x] `npm run lint` — pasa.
- [x] `npm run typecheck` — pasa (tras corregir un fallo real: faltaba `Relationships` en `types/database.ts`).
- [x] `npm run test` — pasa, 7/7.
- [x] `npm run build` — pasa, con aviso pendiente de resolver (`middleware.ts` deprecado en Next 16 → `proxy.ts`).
- [ ] `npx playwright install` — no ejecutado todavía en ninguna sesión con red real.
- [ ] Decisión y migración `middleware.ts` → `proxy.ts`.
- [ ] Proyecto Supabase real creado, migraciones aplicadas, RLS validada con tests de integración por rol.
- [ ] Auth (magic link + Google) verificada de extremo a extremo contra Supabase real.
- [ ] CI verificado corriendo en GitHub Actions de verdad (el workflow existe, `.github/workflows/ci.yml`, pero nunca se ha ejecutado en GitHub).
- [ ] Commit de Foundation (los 36 archivos siguen sin commitear a propósito, ver PROGRESS.md).

**Criterios de aceptación** (sin cambios — es lo que falta para dar la fase por cerrada)
- `npm run dev` levanta la app sin errores.
- Registro/login por magic link y por Google funcionan contra un proyecto
  Supabase real (región EU).
- Migraciones aplicadas, RLS activada y validada con al menos un test de
  integración por tabla sensible (`profiles`, `rooms`, `messages`).
- CI en GitHub Actions corriendo lint + typecheck + tests unitarios en
  cada PR.
- Layout base y navegación (sin diseño final todavía).

## Fase 2 — User

Registro, login, recuperación de acceso, perfil (con foto), preferencias
de vivienda, onboarding completo.

**Criterios de aceptación**: un usuario real puede completar
registro → perfil → preferencias sin errores, con validación Zod en
servidor, y los datos persisten correctamente separados entre `profiles`
y `housing_preferences`.

## Fase 3 — Compatibility

Cuestionario de 25-30 preguntas (con guardado de progreso parcial —
mitiga el abandono a mitad, ver riesgos), almacenamiento en
`compatibility_responses`, motor de matching (`lib/matching/score.ts`),
pantalla de matches con explicación ("por qué encajáis" / "posibles
diferencias").

**Criterios de aceptación**: el motor de matching tiene cobertura de
tests casi total (es el diferencial del producto), es determinista
(mismos inputs → mismo score siempre), y los pesos son modificables
editando un único archivo.

## Fase 4 — Rooms

CRUD de habitaciones, subida de fotos a Storage, búsqueda con filtros,
página de detalle (con dirección aproximada, nunca exacta, hasta match).

**Criterios de aceptación**: búsqueda paginada, sin N+1 verificado con
tests, `room_addresses` nunca se serializa en ninguna respuesta pública.

## Fase 5 — Interest

Favoritos, "me interesa", detección de interés mutuo → creación de match
desde el servidor (nunca desde el cliente).

**Criterios de aceptación**: test que verifica que un intento de INSERT
directo a `matches` desde un cliente autenticado (sin pasar por el
servicio) falla por RLS.

## Fase 6 — Chat

Conversaciones vía Supabase Realtime, mensajes, contador de no leídos,
bloquear, reportar.

**Criterios de aceptación**: dos usuarios en un match pueden chatear en
tiempo real; un tercer usuario no puede leer esa conversación ni aunque
conozca el UUID (verificado con test de RLS).

## Fase 7 — Admin

Dashboard, gestión de usuarios, habitaciones, reportes, métricas básicas.

**Criterios de aceptación**: `/admin` inaccesible para un usuario no-admin
tanto por RLS como por el chequeo de servidor (dos tests independientes);
toda acción de moderación queda en `admin_action_logs`.

## Fase 8 — Polish

Responsive, accesibilidad, SEO técnico (metadata, sitemap, robots,
Open Graph), rendimiento, estados de error/carga/vacío, revisión de
seguridad completa.

## Fase 9 — Beta

Producción, analítica (PostHog), monitoring, backups, política de
privacidad y términos (con el DPO/legal — no los redacta Claude),
feedback. Lanzamiento a un grupo pequeño de usuarios en Barcelona.

---

## Roadmap post-MVP (referencia, sin fecha)

**V2**: grupos de piso, verificación telefónica y universitaria real,
favoritos avanzados, notificaciones push, app móvil (Expo).

**V3**: grupos para buscar piso, propietarios profesionales, verificación
de viviendas, premium, anuncios destacados.

**V4**: reservas, pagos (Stripe), contratos, seguros.

**V5**: universidades/residencias como clientes, empresas, expansión
internacional.

Nada de esto se construye antes de que el paso anterior tenga demanda
demostrada (sección 31 del brief).
