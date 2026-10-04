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

## Fase 2 — User ✅ CERRADA por decisión del propietario (2.0–2.7 completadas; 2.8 cerrada con la validación real diferida)

Registro, login, recuperación de acceso, perfil (la foto queda fuera de
Fase 2, ver abajo), preferencias de vivienda, onboarding completo.

**Recibido de Fase 1**: validar contra Supabase real el alta de un
usuario nuevo por magic link (con signups activos) junto con la creación
de perfil tras el primer login (M6), y los E2E con Playwright.

**Subfases** (plan aprobado el 2026-09-29, PROGRESS.md sesión 9):
- 2.0 Endurecimiento de datos y RLS/GRANT de `profiles` y
  `housing_preferences`, integridad de barrios con triggers, + tests de base
  de datos — ✅ completada (`feb08e4`, `test:db` 119/119 en local). Queda
  pendiente, para 2.8, aplicarla en `roomly-validation`, lo que requiere
  antes una estrategia de migración incremental (ver PROGRESS.md sesión 9).
- 2.1 Validación (Zod) y servicios de perfil/preferencias — ✅ completada
  (`dae21e5`, PROGRESS.md sesión 10): `lib/validation/{profile,housing-preferences}.ts`,
  `lib/services/{profile,housing-preferences}.ts`, sin UI ni Server Actions.
  **Onboarding completo** (decisión de producto): perfil con `full_name`,
  `date_of_birth` y `seeking_status` elegido, y fila de
  `housing_preferences` con `city_id`; el resto de preferencias es opcional.
- 2.2 Enrutamiento de Auth — ✅ completada (`bd1cef7`, PROGRESS.md sesión 11):
  destino único (`lib/auth/destination.ts`), guards de servidor
  (`lib/auth/session.ts`), `next` en cookie de corta duración sin cambios en
  Supabase (M6), callback con errores propios, logout, `/cuenta-desactivada`,
  páginas mínimas de `/bienvenida/{perfil,preferencias}` (solo el destino y
  su guard), `/admin` con rol admin **y** cuenta no eliminada, y `proxy.ts`
  protegiendo `/admin`, `/perfil`, `/ajustes`, `/bienvenida` y
  `/cuenta-desactivada` sin consultar la base de datos.
- 2.3 Onboarding en `/bienvenida/...` — ✅ completada (PROGRESS.md sesión 12):
  `/bienvenida/perfil` (nombre, fecha de nacimiento y `seeking_status` sin
  preselección) → `/bienvenida/preferencias` (ciudad obligatoria, resto
  opcional y sin techos) → `completeOnboarding` → `/`. Server Actions en
  `app/actions/onboarding.ts`, formularios HTML que funcionan sin
  JavaScript, datos de referencia en `lib/services/reference-data.ts`.
  Migración `20260930120000`: `seeking_status` sin DEFAULT y trigger que
  exige preferencias con ciudad para marcar el onboarding completo.
- Endurecimiento entre 2.3 y 2.4 — ✅ (PROGRESS.md sesión 13): decisión B
  de la auditoría de 2.3. Migración `20260930130000`: una cuenta con
  `deleted_at` no puede actualizar su perfil ni crear, actualizar o borrar
  sus preferencias, también por PostgREST (RLS). El punto A
  (`onboarding_completed_at` de una sola escritura) sigue pendiente, para
  2.8; el C se resolvió en 2.5.
- 2.4 Perfil propio en `/perfil` (sin perfiles de terceros: H3/H4) — ✅
  completada (PROGRESS.md sesión 14): consultar y editar `full_name`,
  `date_of_birth`, `seeking_status`, `bio` y `email_notifications_enabled`
  del perfil de la sesión, con `updateProfile` (2.1) y una Server Action.
  Sin perfil → onboarding; cuenta eliminada → `/cuenta-desactivada`;
  incompleto → editable, con aviso para terminar las preferencias. Sin
  migración.
- 2.5 Preferencias en `/preferencias` — ✅ completada (`d9430ac`, verificación
  reforzada en `b3ad249`; PROGRESS.md sesiones 15–17):
  consultar y editar las preferencias propias (ciudad, universidad,
  estudios, presupuesto, fechas, barrios y compañeros) con los servicios de
  2.1 y una Server Action; reutiliza el formulario del onboarding. Migración
  `20260930140000`: riesgo C resuelto (ciudad obligatoria y sin borrado del
  cliente tras el onboarding) y universidad ↔ ciudad en la base de datos.
- 2.6 Ajustes en `/ajustes` (sin borrado de cuenta: H6) — ✅ completada
  (PROGRESS.md sesión 19): avisos por email (`email_notifications_enabled`)
  y cerrar sesión (el `signOut` de 2.2, sin cambiar su alcance). El aviso
  sigue también en `/perfil` (2.4 no se reabre). Sin migración y sin botón
  ni endpoint de borrado.
- 2.7 Shell autenticado y estados de carga/error/vacío — ✅ **cerrada**
  (PROGRESS.md sesión 21; commit `1e6af49`).
  N3: `Nav` raíz estático (solo el logotipo; «Entrar» pasa a la página de
  inicio) y navegación de la cuenta en `app/(app)/layout.tsx` hacia
  `/perfil`, `/preferencias` y `/ajustes`, con el logout de 2.2. `error.tsx`
  y `global-error.tsx` sin detalles técnicos. `loading.tsx` (L1) se probó y
  se revirtió: rompía las páginas sin JavaScript; cada página conserva su
  guard. Sin estados vacíos nuevos. Consecuencia aceptada de N3: fuera de
  `/`, las páginas públicas (p. ej. la 404) no muestran «Entrar». Resultados:
  `npm test` 532/532, `test:db` 218/218, lint, typecheck, format y build en
  verde; Chromium con y sin JavaScript (shell 35/35 y regresión de 2.4–2.6).
- 2.8 Validación real del alta (entorno con signups) y E2E — ⏸️ **cerrada
  por decisión del propietario el 2026-10-04 con la validación real
  DIFERIDA, no superada**: infraestructura en `master` (`cb88647`); la
  validación real no se ha ejecutado nunca (runs 3–10 detenidos antes de
  escribir, los secrets apuntan al proyecto retirado; PROGRESS.md sesiones
  22–24). Decisiones del usuario:
  - **A + P1**: la validación real se hace en un proyecto **nuevo y vacío**,
    `roomly-validation-2`, que crea y configura el propietario. No se repara
    ni se migra `roomly-validation` (esto sustituye la «estrategia de
    migración incremental» pendiente desde 2.0).
  - **D2(a)**: marca de identidad nueva `roomly-validation-2`, comparación
    exacta en todas las guardas (las credenciales del proyecto antiguo no
    pasan).
  - **E3**: E1 (Playwright contra Supabase simulado, en el repo y en CI) y
    E2 (flujo real con email real, solo en el workflow manual), separados.
  - **D1(a)**: E2 con SMTP propio y buzón de prueba accesible por API
    (proveedor sin decidir, parametrizado); sin `generateLink`, sin tocar
    `/callback`.
  - **Runner**: aislamiento por archivo en `run-sql-suite.sh`, sin cambiar
    `tests/db/11`.

  Hecho en local: runner aislado, preflight P0–P6 exacto (38 políticas, 12
  triggers, 10 funciones, GRANT de `housing_preferences`), E1 25/25, E2 y
  job `e2e-real` preparados, auto-tests en CI. **Diferido** (del
  propietario; el proyecto es `roomly-validation-2b`, con la marca
  `roomly-validation-2`, y antes hay que corregir los secrets del
  Environment): elegir SMTP/buzón y su adaptador, crear y configurar
  `roomly-validation-2`, ejecutar el workflow (migraciones, P0–P6, SQL
  01–12, supabase-js, AU3/AU5 y E2 real) y ver CI en verde tras el push.
  Siguen abiertos el punto A de 2.3 y H4.

Fuera de Fase 2 por decisión del usuario: foto de perfil/Storage (M3) y
borrado de cuenta (H6). Una cuenta con `deleted_at` verá una pantalla de
cuenta desactivada (decisión de producto, se implementa en 2.2).

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
