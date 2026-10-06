# Auditoría de transición tras la Fase 2 (2026-10-04, actualizada el 2026-10-06)

Informe de solo lectura, escrito el 2026-10-04 tras cerrar la 2.9 y
**actualizado el 2026-10-06 tras cerrar la 2.8 y la Fase 2** (commit
`docs: cerrar fase 2.8 y fase 2`). Lo que en la primera versión dependía de
la 2.8 bloqueada está corregido. Se conservan el análisis de la Fase 3 y las
discrepancias que siguen vigentes.

## 1. Estado de Git (2026-10-06)

- Rama `claude/gifted-noether-y98vc6`, con base en `ec7c3fc` (adaptador de
  Mailtrap) y el commit de cierre documental encima.
- Commits de la 2.8 y la 2.9 posteriores a `master`: `d79c35d`, `f4f0f7f`,
  `73d6028` (punto A), `f9f08ad` (H4), `f1c7135` (cierre de la 2.9),
  `ec7c3fc` (adaptador) y el commit de cierre.
- **PR #6** abierto (borrador), con CI en verde en `f9f08ad` (CI #11) y
  `ec7c3fc` (CI #12). Pendiente de fusionar: `origin/master` sigue en
  `cb88647`, sin la 2.9, el adaptador ni el cierre documental.
- La rama local `master` está desactualizada (no se usa).

## 2. Estado funcional

### Implementado (con tests)

| Funcionalidad | Dónde | Unit | `test:db` | E1 |
|---|---|---|---|---|
| Login por magic link (PKCE), `/callback`, redirect seguro, `next` en cookie | `app/(auth)`, `lib/auth/*`, `app/actions/auth.ts` | ✅ `auth-*`, `safe-redirect` | — | ✅ `callback-pkce`, `student-flow` |
| Rutas protegidas y guards por página (`proxy.ts` + `requireX`) | `proxy.ts`, `lib/auth/{session,protected-routes,destination}.ts` | ✅ `auth-proxy`, `auth-session`, `auth-destination` | — | ✅ `protected-routes` |
| Logout (global) | `components/auth/sign-out-button.tsx`, `app/actions/auth.ts` | ✅ | — | ✅ |
| Onboarding `/bienvenida/{perfil,preferencias}` | `app/(onboarding)`, `app/actions/onboarding.ts`, `lib/services/profile.ts` | ✅ `onboarding-*` | ✅ `07` | ✅ `student-flow`, `no-javascript` |
| Perfil propio `/perfil` | `app/(app)/perfil/page.tsx`, `app/actions/profile.ts` | ✅ `profile-actions`, `own-profile-form` | ✅ `06`, `09` | ✅ |
| Preferencias `/preferencias` | `app/(app)/preferencias`, `lib/services/housing-preferences.ts` | ✅ `preferences-*`, `services-housing-preferences` | ✅ `05`, `10`, `11` | ✅ |
| Ajustes `/ajustes` (avisos por email, logout) | `app/(app)/ajustes`, `app/actions/settings.ts` | ✅ `settings` | ✅ `12` | ✅ |
| Cuenta eliminada → `/cuenta-desactivada`, escrituras bloqueadas | `app/cuenta-desactivada`, RLS `20260930130000` | ✅ | ✅ `08` | ✅ `deleted-account` |
| Shell autenticado, errores sin detalles técnicos | `app/(app)/layout.tsx`, `app/error.tsx`, `app/global-error.tsx` | ✅ `shell` | — | — |
| Onboarding de una sola escritura (2.9, punto A) | `20261004120000` | — | ✅ `07` OB5b, OB11–OB14 | — (el mock no lo emula) |
| Privacidad de `profiles` (2.9, H4) | `20261004120100` | ✅ `validation-infra` (37) | ✅ `13`, `12` | ✅ (el mock solo da la fila propia) |
| Ownership entre usuarios (ids ajenos en URL y formularios) | servicios + RLS | ✅ | ✅ `11`, `12`, `13` | ✅ `ownership` |
| RLS/seguridad de tablas futuras (rol, chat, rooms, reports) | migraciones de Fase 0–1 | — | ✅ `01`–`04` | — |

### Parcialmente implementado

| Funcionalidad | Estado real |
|---|---|
| `/admin` | Solo la protección (rol admin y cuenta activa, en RLS y en el servidor) y una página de texto. Usuarios, habitaciones, reportes y métricas: Fase 7. |
| `/registro` | Redirige a `/login`: el alta usa el mismo magic link. Su comentario dice «llega en Fase 2» (ya existe). |
| Google OAuth | El botón existe en `/login`, pero el proveedor no está configurado (diferido por decisión del usuario). Apple: no existe. |
| Esquema de Fases 3–7 | Tablas, RLS y triggers existen (`compatibility_responses`, `rooms`, `room_*`, `favorites`, `interests`, `matches`, `conversations`, `messages`, `reports`, `admin_action_logs`, `notifications`), pero **sin servicios, UI ni flujos**. |

### Documentado pero inexistente

- Test de convivencia (`app/(onboarding)/bienvenida/test/` solo tiene `.gitkeep`) y motor de matching (`lib/matching/` vacío): Fase 3.
- Matches, explorar, habitaciones, mensajes, perfiles de terceros (`app/(app)/{matches,explorar,habitaciones,mensajes,perfil/[id]}` vacíos): Fases 3–6.
- Páginas SEO por ciudad (`app/(marketing)/[city]/*` vacías), webhooks (`app/api/webhooks/` vacío): Fases 4/8.
- Email (Resend), mapas (Mapbox), analítica (PostHog), pagos: en el stack y en `.env.example`, **sin dependencias instaladas** ni código.
- E2E de room provider y de admin (dos de los «3 flujos obligatorios»): no existen porque esas funcionalidades no existen.

### Validado en Supabase real (Fase 2.8, completada el 2026-10-06)

En `roomly-validation-2b` (ref `uwxb…`, marca `roomly-validation-2`):
- **Run 13** (`37533380047`, `f9f08ad`), validación estructural: las 9
  migraciones y el seed, P0–P6 (37 políticas), SQL 01–13 con roles reales,
  supabase-js 46/46 y AU3/AU5 16/16. Incluye la 2.9 (punto A y H4).
- **Run 15** (`37543144825`, `ec7c3fc`), E2 real 1/1: `signInWithOtp` →
  email real en Mailtrap → `/auth/v1/verify` → `/callback?code=` con PKCE →
  onboarding → `/perfil` → `/preferencias` → `/ajustes` → logout. Sin
  `generateLink` ni `token_hash`. Sin residuos de usuarios, filas ni
  mensajes de prueba.
- El registro de Auth se abrió solo para el E2 y se cerró después.
- Los runs 3–12 y 14 fallaron sin escribir nada (diagnóstico en
  `docs/SUPABASE_VALIDATION.md`).

No depende de Supabase real todavía nada más de lo que existe hoy. Lo de
la Fase 3 en adelante, cuando exista, tendrá que validarse aparte (ver
riesgos de la Fase 3).

### Problemas conocidos que permanecen

- Pendiente operativo: el proyecto `roomly-validation-2b` sigue activo, con
  el esquema, el seed y el SMTP de Mailtrap. Rotar claves y pausarlo o
  borrarlo se tratará en una acción de seguridad específica.
- Límites aceptados de la 2.9: borrar y recrear un perfil reinicia el
  onboarding; un superusuario puede desactivar el trigger; el mock de E1 no
  emula el bloqueo del punto A ni `profiles_admin_all`.
- H3: `public_profile_previews` expone `role` a anon.
- `npm audit`: 5 vulnerabilidades altas, **todas en dependencias de
  desarrollo** (`eslint-config-next` → `@next/eslint-plugin-next` →
  `fast-glob` → `micromatch` → `braces`); `npm audit --omit=dev`: 0.
- CI: `actions/checkout@v4` y `actions/setup-node@v4` con Node.js 20
  obsoleto (aviso).
- E1 en el entorno cloud usa el Chromium preinstalado 1194 (orientativo); el
  de CI (v1243) es el de referencia y está en verde.

## 3. Consistencia: documentación ↔ código ↔ base de datos ↔ tests

No se ha encontrado ninguna discrepancia **CRÍTICA** (ningún fallo de
seguridad abierto ni test roto).

| # | Severidad | Discrepancia | Dónde |
|---|---|---|---|
| 1 | ✅ RESUELTA (2026-10-06) | Era ALTA: la Fase 2 seguía abierta por la 2.8 bloqueada y la regla 8 impedía empezar la Fase 3. La 2.8 se completó (runs 13 y 15) y la Fase 2 está cerrada; la regla 8 ya no bloquea la Fase 3, que solo espera la confirmación del propietario. | `CLAUDE.md`, `ROADMAP.md` |
| 2 | **ALTA** | La Fase 3 necesita comparar datos de **otros** usuarios (respuestas del test y `housing_preferences`: ubicación y presupuesto suman el 30% del score), pero la RLS solo deja leer lo propio (`compatibility_responses_own`, `housing_preferences_select_own`) y, desde H4, tampoco `profiles` ajenos. No hay ningún diseño documentado de cómo se calcula el score de un candidato (¿servidor con `service_role`?, ¿función `SECURITY DEFINER` que devuelva solo score y razones?). `createAdminClient()` existe pero no se usa en ningún sitio. | `20260925120100`, `20261004120100`, `ARCHITECTURE.md` §Motor de matching, `lib/supabase/admin.ts` |
| 3 | **MEDIA** | «Guardado de progreso parcial» del cuestionario (`ROADMAP.md` Fase 3, spec §8) frente al esquema: `compatibility_responses.completed_at` es `NOT NULL DEFAULT now()`, así que una fila siempre parece completada. Para guardar progreso hace falta una decisión de esquema (migración nueva) o guardarlo en otro sitio. | `20260925120000`, `ROADMAP.md`, `ROOMLY_MASTER_SPEC.md` §8 |
| 4 | **MEDIA** | «Pantalla de matches» en la Fase 3 frente a la tabla `matches`, que según `DATABASE.md` y la Fase 5 solo se crea desde el servidor **tras interés mutuo**. En la Fase 3 «matches» solo puede ser una lista de candidatos calculada al vuelo; no está escrito en ningún sitio. | `ROADMAP.md` Fases 3 y 5, `DATABASE.md` |
| 5 | **MEDIA** | `compatibility_responses` no tiene el endurecimiento que sí tienen `profiles`/`housing_preferences`: ni bloqueo de escrituras de cuentas eliminadas (pendiente desde `20260930130000`: «la misma regla para el resto de tablas… cuando tengan flujo, Fase 3+»), ni GRANT por columnas (el cliente puede escribir `questionnaire_version`, `completed_at` y `updated_at`), ni tests en `tests/db`. | `20260925120100`, `PROGRESS.md` sesión 13, `tests/db` |
| 6 | **MEDIA** | El destino tras el onboarding es `/` (decisión de 2.3) y la guarda de destino no conoce ningún paso de test. La spec pone el test dentro del flujo principal (perfil → test → match). Integrarlo toca `lib/auth/destination.ts` (Fase 2.2, cerrada): hace falta decidir si el test es obligatorio u opcional. | `lib/auth/destination.ts`, `ROOMLY_MASTER_SPEC.md` §5 |
| 7 | ✅ RESUELTA (2026-10-06, commit de cierre: corregidas las filas de `npm run test` y de CI) | `TESTING.md` sigue con frases anteriores a los CI de los PR #4–#6: la fila de CI («6 runs… los jobs nuevos no se han ejecutado todavía») y la de `npm run test` («en CI corrían 39/39, los nuevos correrán en el próximo push»). | `docs/TESTING.md` (filas de `npm run test` y CI) |
| 8 | ✅ RESUELTA (2026-10-06, commit de cierre: el título de la 2.8 en `SECURITY.md` dice «completada el 2026-10-06») | `SECURITY.md` titula la sección «Fase 2.8 — infraestructura de validación (2026-09-30, **en progreso**)»; el estado real era entonces «aparcada/bloqueada». | `docs/SECURITY.md` |
| 9 | ✅ RESUELTA (2026-10-06, commit de cierre: las cabeceras de las sesiones 22 y 23 se anotan con el commit posterior, sin reescribir su contenido) | `PROGRESS.md`: las sesiones 22 y 23 siguen tituladas «EN PROGRESO, sin commit», aunque ese trabajo está en `03c4349`/`4ff8489` y en `master`. | `PROGRESS.md` |
| 10 | ✅ RESUELTA (2026-10-06, commit de cierre: «Funcionalidades terminadas» recoge la Fase 2) | `CLAUDE.md` §«Funcionalidades terminadas» dice «Ninguna funcionalidad de producto todavía» y solo menciona Fases 0–1; no recoge lo hecho en la Fase 2 (auth, onboarding, perfil, preferencias, ajustes). | `CLAUDE.md` |
| 11 | **BAJA** | `types/database.ts` no declara `is_conversation_participant` en `Functions` (solo `is_admin`). Hoy no importa (solo se usa dentro de RLS); importará en la Fase 6 si se llama por RPC. | `types/database.ts` |
| 12 | **BAJA** | El mock de E1 no emula el bloqueo del punto A ni `profiles_admin_all` (documentado). E1 no detectaría una regresión del mock. | `tests/e2e/support/mock-supabase.mjs` |
| 13 | **BAJA** | H3: la vista pública expone `role` a anon (conocido, sin decisión). | `20260925120100` |
| 14 | **BAJA** | `npm audit` (solo dev) y Node.js 20 en las acciones de CI. | `package.json`, `.github/workflows/ci.yml` |
| 15 | INFORMATIVA | `d79c35d` dice «cerrar la 2.8»; lo corrige `f4f0f7f` (no se reescribe el historial). | git |
| 16 | INFORMATIVA | `/registro` dice «la distinción real llega en Fase 2» (ya llegó, con el onboarding). | `app/(auth)/registro/page.tsx` |
| 17 | INFORMATIVA | Rama local `master` desactualizada; PR #6 abierto, con CI en verde y pendiente de fusionar; la 2.9, el adaptador y el cierre no están todavía en `origin/master`. | git |
| 18 | INFORMATIVA | No hay `supabase/config.toml`: sin Supabase CLI local, por diseño (`tests/db` usa PostgreSQL + shim). | `supabase/` |
| 19 | INFORMATIVA | El proyecto antiguo `roomly-retirado` (18 tablas) sigue existiendo en Supabase. | — |

## 4. Siguiente fase real

**La Fase 2 está completada (2026-10-06)**: 2.0–2.9 cerradas y su criterio
de aceptación demostrado en Supabase real (run 15). Según `ROADMAP.md`, la
siguiente fase es la **Fase 3 — Compatibility**.
- No hay ninguna fase anterior con pasos sin cerrar, así que la regla 8 ya
  no la bloquea.
- Se empieza solo cuando el propietario lo confirme (`CLAUDE.md`, «Cómo
  trabajar por fases»), y antes conviene fusionar el PR #6 para que
  `master` refleje la Fase 2 cerrada.

### Fase 3 — Compatibility (según `ROADMAP.md` y `ROOMLY_MASTER_SPEC.md` §8–10)

**Objetivo**: test de convivencia de 25–30 preguntas, guardado en
`compatibility_responses`, motor de matching determinista
(`lib/matching/score.ts`) y pantalla de matches con explicación («por qué
encajáis» / «posibles diferencias»).

**Alcance**
- Cuestionario de 25–30 preguntas (escala 1–5 donde aplique): limpieza,
  ruido, fiestas, visitas, horarios, estudio, teletrabajo, fumar, mascotas,
  cocina, qué se comparte, privacidad, personalidad, convivencia. Para
  convivencia real, sin afirmaciones psicológicas.
- Guardado de progreso parcial.
- `lib/matching/{score,weights,types}.ts`: función pura
  `calculateCompatibility(a, b, weights) → { overallScore, categoryScores,
  strengths, differences }`, score 0–100. Pesos iniciales: ubicación 15,
  presupuesto 15, limpieza 12, horarios 10, ruido 10, fiestas 8, visitas 8,
  fumar 7, mascotas 5, estudio 5, personalidad 5 (= 100).
- Pantalla de matches (candidatos) con razones. Nunca IA generativa, nunca
  SQL/triggers para el cálculo.

**Fuera de alcance**: interés y creación de filas de `matches` (Fase 5),
chat (Fase 6), habitaciones (Fase 4), perfiles de terceros completos
(H3/H4), analítica (Fase 9).

**Dependencias y decisiones previas** (del propietario, antes de
implementar):
1. ~~Excepción a la regla 8, o cerrar antes la 2.8~~: ya no aplica, la
   Fase 2 está cerrada.
2. **Modelo de lectura entre usuarios** (discrepancia 2): calcular los
   candidatos en el servidor con `service_role` (server-only, devolviendo
   solo score, razones y la vista pública) o con una función
   `SECURITY DEFINER` acotada. Nunca reabrir la RLS de lectura de datos
   ajenos.
3. **Progreso parcial** (discrepancia 3): `completed_at` nullable en una
   migración nueva, u otra opción.
4. **Qué es «matches» en la Fase 3** (discrepancia 4): lista de candidatos
   calculada al vuelo, sin escribir en `matches`.
5. **El test en el flujo** (discrepancia 6): obligatorio u opcional, y si
   cambia el destino tras el onboarding.
6. **Contenido exacto de las preguntas** y su versionado
   (`questionnaire_version`): lo propone Claude, lo aprueba el propietario.
7. Filtro duro de candidatos (`DATABASE.md`): misma ciudad, fechas
   solapadas y presupuesto compatible; ¿cuenta `seeking_status`
   (busca habitación ↔ tiene habitación)?

**Archivos que probablemente habrá que crear o modificar**
- Nuevos: `lib/matching/{score,weights,types}.ts`;
  `lib/questionnaire/*` (definición versionada de preguntas);
  `lib/validation/compatibility.ts`; `lib/services/compatibility.ts`
  (respuestas propias); `lib/services/matching.ts` (candidatos, server-only
  si usa `service_role`); `app/actions/compatibility.ts`;
  `app/(onboarding)/bienvenida/test/page.tsx` o una ruta propia;
  `app/(app)/matches/page.tsx`; `components/matches/*`,
  `components/questionnaire/*`.
- Modificados probablemente: `lib/auth/protected-routes.ts` (añadir
  `/matches`), `lib/auth/destination.ts` (si el test entra en el flujo),
  `components/app-nav-links.tsx` (enlace a matches), `types/database.ts`
  (si cambia el esquema), `tests/e2e/support/mock-supabase.mjs` (emular
  `compatibility_responses` y la lectura de candidatos).
- Migración nueva (sin tocar las históricas): endurecer
  `compatibility_responses` (cuenta activa, GRANT por columnas, validación
  de `answers` si se decide) y, si se aprueba, el progreso parcial o una
  función `SECURITY DEFINER`. Cualquier política, trigger o función nueva
  obliga a actualizar P3/P6 de `tests/supabase/preflight.sql`, sus
  auto-tests y `validation-infra.test.ts`, como en la 2.9.
- Docs: `DATABASE.md`, `SECURITY.md`, `TESTING.md`, `ARCHITECTURE.md`,
  `ROADMAP.md`, `PROGRESS.md`, `CLAUDE.md`.

**Tablas implicadas**: `compatibility_responses` (escritura propia);
`housing_preferences` (ciudad, presupuesto, fechas, barrios y compañeros de
los candidatos); `profiles` (filtrado de cuentas activas con el onboarding
completo); `public_profile_previews` (lo que se muestra del candidato);
`cities`/`neighborhoods`/`universities` (referencia). `matches` **no** se
escribe en la Fase 3.

**Tests necesarios**
- Unit: cobertura casi total de `lib/matching` (criterio de aceptación):
  determinismo, simetría si se define, límites 0–100, pesos que suman 100,
  cada categoría, respuestas incompletas, razones y diferencias; validación
  Zod del cuestionario; servicios y Server Actions (esquema estricto, sin
  `profile_id` del cliente).
- `test:db`: archivo nuevo para `compatibility_responses` (solo el dueño
  lee y escribe; cuenta eliminada no escribe; columnas protegidas; nadie lee
  respuestas ajenas, tampoco tras la 2.9) y, si existe, la función
  `SECURITY DEFINER` (sin fugas de respuestas crudas, `search_path` vacío,
  EXECUTE acotado). Mutaciones como en la 2.9.
- E1: completar el test (con y sin JavaScript), progreso parcial, ver
  matches con razones, sin acceso a respuestas ajenas.
- Infra: preflight y `validation-infra` actualizados si cambia el número de
  políticas, triggers o funciones.

**Riesgos**
- **Privacidad**: filtrar respuestas crudas o datos de `housing_preferences`
  de otros a través de las razones o de una función privilegiada. Las
  razones deben ser comparativas («horarios parecidos»), no revelar
  valores.
- **`service_role`**: usarlo para los candidatos amplía la superficie; debe
  quedar server-only (`import "server-only"`), con columnas explícitas y sin
  `select("*")`.
- Rendimiento y N+1: el filtro duro va en SQL indexado; el score, en
  TypeScript sobre el conjunto ya acotado; nunca un fetch por candidato.
- Abandono del cuestionario (mitigado con el progreso parcial).
- Tocar fases cerradas (destino de 2.2/2.3) sin decisión explícita.
- **Validación real de migraciones nuevas.** `apply-migrations.sh` se niega
  si el esquema ya existe, y `roomly-validation-2b` ya lo tiene. Una
  migración de la Fase 3 no se puede validar en real ahí sin un proyecto
  vacío nuevo (P1, como hasta ahora) o sin una decisión nueva de aplicación
  incremental.

**Criterios de aceptación** (`ROADMAP.md`, literal)
- El motor de matching tiene cobertura de tests casi total.
- Es determinista: mismos inputs → mismo score siempre.
- Los pesos se modifican editando un único archivo.

Además, por las reglas permanentes: validación Zod en servidor, RLS y
servidor como dos capas, sin N+1, sin IA generativa, y CI en verde.

## 5. Recomendación (actualizada el 2026-10-06)

1. Fusionar el PR #6, con autorización aparte, para que `master` refleje
   la Fase 2 cerrada.
2. Tratar el pendiente operativo de `roomly-validation-2b` (rotar claves y
   pausarlo o borrarlo) en una acción de seguridad aparte.
3. Antes de escribir código de la Fase 3, una ronda de decisiones sobre los
   puntos 2–7 de «Dependencias y decisiones previas» y sobre cómo validar
   en real sus migraciones (riesgos).
