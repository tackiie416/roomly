# Roadmap — ROOMLY

Se trabaja fase a fase. No se empieza la siguiente si la anterior tiene
tests rotos. Cada fase: objetivo → criterios de aceptación → implementar →
testear → documentar → commit.

## Fase 0 — Arquitectura ✅ (esta entrega)

Diseño de arquitectura, esquema de base de datos, estructura de carpetas,
documentación. Sin código de aplicación.

## Fase 1 — Foundation ✅ COMPLETADA (2026-09-29)

**Objetivo**: proyecto Next.js real, conectado a un Supabase real, con
auth funcionando de extremo a extremo y CI básica.

**Estado real, punto por punto** (reconciliado el 2026-09-29, PROGRESS.md sesión 8):
- [x] Proyecto Next.js 16.3.6 + TypeScript + Tailwind v4 real (scaffold con `create-next-app`).
- [x] `lib/supabase/{client,server,admin}.ts`, `lib/env.ts`, `proxy.ts`, `types/database.ts`.
- [x] Login por magic link, callback con redirect seguro (`lib/auth/safe-redirect.ts`, H1), protección de `/admin` en 2 capas (`proxy.ts` + `app/admin/layout.tsx`).
- [x] Correcciones de seguridad/RLS (C1, C2, C3, H5, M2) en `20260926120000_security_fixes.sql`, con regresión en `tests/db` (58/58).
- [x] `npm run format:check`, `lint`, `typecheck`, `build` — pasan.
- [x] `npm run test` — pasa, 39/39.
- [x] Migración `middleware.ts` → `proxy.ts` (Next.js 16.3.6 la reconoce: `ƒ Proxy (Middleware)`, runtime Node.js).
- [x] Proyecto Supabase real (`roomly-validation`, Frankfurt) con migraciones aplicadas y RLS validada por rol: suite SQL 58/58, suite supabase-js 46/46 (`profiles`, `rooms`, `messages`/chat, `reports`), P0–P5 (ver `docs/SUPABASE_VALIDATION.md`).
- [x] Auth verificada contra Supabase real: AU2 (JWT reales), AU3 (callback/redirects seguros), AU4 (magic link de extremo a extremo, manual), AU5 (`/admin` sin sesión / sin admin / con admin).
- [x] CI verificado en GitHub Actions de verdad: `ci.yml` en verde en PR y en push a `master` (PRs #1, #2, #3).
- [x] Commit de Foundation (`d1089aa`).

**Diferido por decisión del usuario (no bloquea el cierre)**
- Google OAuth: el botón existe en `/login`, pero el proveedor no está configurado en Supabase ni se ha verificado.
- Apple OAuth: no existe.
- E2E con Playwright en CI → Fase 2, cuando existan flujos reales de usuario. `npx playwright install` no se ha ejecutado con red real; el smoke test solo ha pasado con el Chromium preinstalado del entorno cloud y una config temporal (ver `docs/TESTING.md`).

**Trasladado a Fase 2 por decisión del usuario**
- El criterio dice "Registro/login por magic link". El **login** por magic link está validado contra Supabase real (AU4). El **alta real de un usuario nuevo** no se validó: `roomly-validation` tiene los signups desactivados a propósito y el usuario de AU4 se creó desde el dashboard. Esa validación pasa a Fase 2, junto con el flujo de Registro y la creación de perfil tras el primer login (M6). Esto no significa que Fase 2 esté iniciada.

**Criterios de aceptación** (texto original, estado entre corchetes)
- `npm run dev` levanta la app sin errores. [✅ en el PC del usuario, durante AU4]
- Registro/login por magic link y por Google funcionan contra un proyecto
  Supabase real (región EU). [login magic link ✅ · alta de usuario nuevo: trasladada a Fase 2 · Google: diferido]
- Migraciones aplicadas, RLS activada y validada con al menos un test de
  integración por tabla sensible (`profiles`, `rooms`, `messages`). [✅]
- CI en GitHub Actions corriendo lint + typecheck + tests unitarios en
  cada PR. [✅]
- Layout base y navegación (sin diseño final todavía). [✅]

## Fase 2 — User (no iniciada)

Registro, login, recuperación de acceso, perfil (con foto), preferencias
de vivienda, onboarding completo.

**Recibido de Fase 1**: validar contra Supabase real el alta de un
usuario nuevo por magic link (con signups activos) junto con la creación
de perfil tras el primer login (M6), y los E2E con Playwright.

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
