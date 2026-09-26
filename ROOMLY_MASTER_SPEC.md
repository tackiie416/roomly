# ROOMLY — Especificación maestra

Este documento preserva **toda** la especificación de producto y las
decisiones de arquitectura desarrolladas a lo largo de la conversación
original con Claude Chat, desde el brief inicial hasta el estado actual
del proyecto. No sustituye a `CLAUDE.md` (instrucciones operativas para
trabajar en el repo), ni a `docs/ARCHITECTURE.md`/`docs/DATABASE.md`/
`docs/SECURITY.md` (detalle técnico profundo, con su propio historial de
revisiones) — es el documento que ata todo junto: por qué existe ROOMLY,
qué se decidió construir, y por qué se decidió construirlo así.

No es una reinterpretación: es la especificación original del fundador,
más las decisiones técnicas que Claude tomó explícitamente durante el
diseño (marcadas como tales), más las correcciones que salieron de
revisiones críticas posteriores.

---

## 0. Instrucción original del fundador

> Actúa como CTO, arquitecto de software, product manager, diseñador
> UX/UI y desarrollador senior de una startup tecnológica llamada
> ROOMLY. Construir progresivamente un producto real, funcional, seguro,
> mantenible y preparado para crecer — no un prototipo vacío.

Prioridades explícitas, en este orden: **producto funcional → experiencia
de usuario → seguridad → rendimiento → escalabilidad razonable → código
limpio → tests → mantenibilidad → coste bajo de infraestructura.** No
sobreingeniería: si una funcionalidad no es necesaria para validar el
modelo de negocio inicial, queda fuera y documentada para una fase
posterior.

## 1. Idea de negocio

ROOMLY es una plataforma para encontrar compañeros de piso compatibles y
formar grupos de convivencia. El problema concreto que resuelve: los
portales inmobiliarios ayudan a encontrar habitaciones y pisos, pero no
resuelven bien "¿con quién voy a vivir?".

Flujo de valor completo (visión a largo plazo, **no** todo en el MVP):

```
MATCH → GRUPO → PISO → VERIFICACIÓN → RESERVA → CONTRATO → PAGO → CONVIVENCIA
```

Flujo del MVP (lo único que se construye ahora):

```
ESTUDIANTE → PERFIL → TEST → MATCH → HABITACIÓN → CONTACTO
```

## 2. Posicionamiento

NO es "otro portal inmobiliario". NO es "una copia de Badi". Categoría
propia: **"la plataforma para encontrar compañeros de piso compatibles."**
Referencia interna de posicionamiento (no necesariamente claim de marca):
*"Dating, pero para compañeros de piso."*

Propuesta de valor: **"Encuentra piso. Encuentra compañeros. Encaja de
verdad."**

Diferencial: **COMPATIBILIDAD + CONFIANZA + FORMACIÓN DE GRUPOS.**

## 3. Mercado inicial

España. Primera ciudad: **Barcelona** — no cubrir toda España desde el
día uno. Público: estudiantes universitarios, Erasmus, máster, 18-30
años, con o sin habitación, buscando formar piso compartido.

Expansión futura (sin fecha, sin lógica específica por ciudad más allá de
lo estrictamente necesaria): Madrid, Valencia, Sevilla, Málaga, Granada,
Salamanca, Bilbao, Zaragoza. La plataforma es multiciudad desde el
principio (`cities`/`neighborhoods` en el esquema), aunque solo Barcelona
esté activa (`cities.is_active = true`) al lanzar.

## 4. Tipos de usuario

MVP: **student/roommate seeker** (busca habitación/compañero/grupo/piso)
y **room provider** (tiene habitación libre, publica un anuncio).
Técnicamente **no son roles separados en la base de datos** — cualquier
perfil puede, con el tiempo, tener 0 o más habitaciones publicadas; la
elección inicial "busco habitación" / "ya tengo habitación" solo
determina el `seeking_status` inicial, no un rol rígido (decisión de
Claude, ver §"Decisiones técnicas acumuladas").

Futuro (no MVP): propietario profesional, agencia, universidad,
residencia, administrador, moderador, administrador global.

## 5. Experiencia principal del estudiante

```
LANDING → "Encuentra tu compañero de piso ideal" → Crear cuenta →
Elegir "Busco habitación" / "Ya tengo habitación" → Crear perfil →
Test de convivencia → Indicar ciudad/universidad/presupuesto/fechas/
zona/nº de compañeros → Ver matches → Explorar perfiles → Ver
compatibilidad → Enviar interés → (si mutuo) → CHAT
```

## 6. Registro

Email, Google, Apple. Sin DNI ni documentos de identidad en el MVP.
Preparado para añadir después: email universitario, teléfono, identidad
verificada.

**Decisión de Claude**: para "email", magic link (passwordless) en vez
de contraseña — menos superficie de ataque, badge de email verificado
gratis. Reversible por configuración, no por arquitectura (ver
`docs/ARCHITECTURE.md` §Autenticación).

## 7. Perfil de usuario

Nombre, edad (→ `date_of_birth`, no edad directa — más preciso y permite
verificación de 18+), fotografía, ciudad, universidad, carrera/estudios,
descripción, presupuesto, fecha de entrada/salida, zonas preferidas,
número de compañeros, preferencias de convivencia, intereses, nivel de
verificación. Privacidad como prioridad: nunca mostrar información
sensible innecesaria.

## 8. Test de compatibilidad

25-30 preguntas, escala 1-5 donde aplique, sobre: limpieza, ruido,
fiestas, visitas, horarios (dormir/levantarse), estudio, teletrabajo,
fumar, mascotas, cocina, qué se está dispuesto a compartir, privacidad
(tiempo con compañeros), personalidad (extrovertido↔introvertido),
convivencia (conflictos, comunicación, normas). Diseñado para convivencia
real, **no** para diagnosticar personalidad ni hacer afirmaciones
psicológicas.

Riesgo identificado: cuestionario largo → abandono a mitad. Mitigación:
guardar progreso parcial (Fase 3), y la propia analítica distingue
`test_started` de `test_completed`.

## 9. Algoritmo de matching

**Determinista y explicable — nunca IA generativa.** Score 0-100.
Categorías y pesos iniciales (configurables, no definitivos):

| Categoría | Peso |
|---|---|
| Ubicación | 15% |
| Presupuesto | 15% |
| Limpieza | 12% |
| Horarios | 10% |
| Ruido | 10% |
| Fiestas | 8% |
| Visitas | 8% |
| Fumar | 7% |
| Mascotas | 5% |
| Estudio | 5% |
| Personalidad | 5% |

**Decisión de Claude**: función TypeScript pura en `lib/matching/score.ts`
(nunca SQL/triggers, nunca un LLM) — la misma función sirve para explorar
candidatos y para el score que se guarda al confirmarse un match, evitando
duplicar el algoritmo en dos lenguajes. Pesos en `lib/matching/weights.ts`,
versionados en git; mover a una tabla configurable solo si en V2/V3 alguien
no técnico necesita ajustarlos sin depender de un despliegue.

## 10. Explicación del match

Nunca solo "92% compatible". Siempre con razones: "Por qué encajáis"
(✓ presupuesto similar, ✓ mismos horarios...) y "Posibles diferencias"
(⚠ tú prefieres más tranquilidad...). Transparencia obligatoria.

## 11. Habitaciones

Título, fotos, ciudad, dirección aproximada (nunca exacta públicamente),
barrio, precio, gastos incluidos/no, depósito, fecha disponible, duración
mín/máx, nº compañeros, nº habitaciones, características, reglas,
preferencias del propietario, descripción.

**Corrección de una revisión posterior**: `pets_allowed`, `smoking_allowed`,
`students_only` como columnas booleanas propias — faltaban como campos
explícitos, solo existían como texto libre, y la sección 13 (búsqueda) los
pide como filtros.

## 12. Privacidad de ubicación

Nunca mostrar públicamente: dirección exacta, teléfono, email,
documentación, información privada. Antes del contacto mutuo, solo zona,
mapa aproximado, distancia aproximada a la universidad.

**Decisión de Claude, reforzada en revisión de seguridad**: la dirección
exacta vive en `room_addresses`, tabla separada con su propia política
RLS (solo el propietario) — es el único campo de todo el esquema cuya
fuga tiene consecuencia física real (localizar dónde vive alguien), así
que es el único protegido a nivel de base de datos y no solo "recordando"
qué columnas proyectar en el código.

## 13. Búsqueda

Filtros: ciudad, barrio, precio máximo, fecha, duración, nº habitaciones,
estudiantes, características, mascotas, fumadores. Orden: relevancia,
compatibilidad, precio, distancia, fecha.

## 14. Pantalla de matches

"Mis matches": tarjetas con foto, nombre, edad, universidad, zona,
presupuesto, compatibilidad, 3 razones de compatibilidad, posibles
conflictos, botón "Ver perfil", botón "Me interesa". **Explícitamente NO
un swipe tipo Tinder** — UX orientada a decisiones racionales.

## 15. Interés mutuo

"Me interesa" unidireccional; si ambos → MATCH → chat. Antes del match,
sin comunicación directa ilimitada (protege privacidad, reduce spam).

**Decisión de Claude**: un único modelo `interests` sirve tanto para
"me interesa esta persona" como para "me interesa esta habitación"
(`room_id` es solo contexto) — unifica MATCH↔HABITACIÓN sin duplicar la
lógica de interés mutuo.

## 16. Grupos (no MVP)

Funcionalidad estratégica para fases posteriores: crear "grupo de piso",
invitar personas, buscar habitaciones/pisos en grupo, comparar, votar. La
arquitectura debe permitirlo sin rediseño — de ahí que `conversations` use
`conversation_participants` como tabla de unión en vez de columnas fijas
`user_a`/`user_b`.

## 17. Chat

1 a 1 en el MVP: mensajes, timestamp, leído/no leído, bloquear, reportar.
Sin videollamadas. Preparado para grupo (ver §16) y moderación futura.

**Decisión de Claude**: Supabase Realtime en vez de infraestructura de
websockets propia. `conversation_participants.last_read_at` en vez de
estado de lectura por mensaje — generaliza a grupo sin cambios.

## 18. Verificación

MVP: solo email verificado (vía magic link/OAuth) + Google/Apple. Badges
mostrados: email verificado, universidad verificada, identidad verificada,
vivienda verificada — pero **solo el primero es funcional en el MVP**. Sin
KYC complejo.

**Corrección de una revisión posterior**: se eliminó una tabla
`verifications` completa del esquema — sobreingeniería, ya que 3 de los 4
badges no tienen ningún flujo real detrás todavía. `email_confirmed_at` de
`auth.users` (Supabase) ya cubre el único caso funcional. Se añade una
tabla de verificación real en V2/V3, cuando exista un proveedor de KYC de
verdad.

## 19. Sistema de reportes

Bloquear, reportar, denunciar anuncio/comportamiento. Motivos: fraude,
spam, contenido inapropiado, información falsa, acoso, comportamiento
sospechoso, anuncio inexistente. Panel de admin para revisar.

**Protección de diseño**: la persona reportada no tiene ninguna política
de lectura sobre `reports` — no puede saber quién la reportó.

## 20. Panel de administración

`/admin`, protegido en dos capas (sesión + rol real, nunca solo ocultar
el enlace). Usuarios (buscar/filtrar/bloquear/verificar/revisar),
habitaciones (revisar/ocultar/eliminar/marcar sospechosa), reportes
(listar/revisar/resolver), matches (estadísticas), métricas (usuarios,
habitaciones, matches, conversaciones, reportes, conversión).

**Decisión de Claude**: `admin_action_logs`, tabla append-only —
trazabilidad de toda acción de moderación. Sobrevivió la revisión de
sobreingeniería porque, sin ella, un abuso del propio panel sería
invisible.

## 21. Notificaciones

Email, push, in-app. Eventos: nuevo match, nuevo mensaje, nuevo interés,
nueva habitación compatible, recordatorio de perfil incompleto. Sin spam;
con preferencias.

**Corrección de una revisión posterior**: se eliminó una tabla
`notification_preferences` con JSONB granular — sobreingeniería para 5
tipos de notificación en el MVP. Una columna
`profiles.email_notifications_enabled boolean` basta. Push no existe
hasta la app móvil (V2); su columna de preferencia se añade con el canal,
no antes.

## 22-26. Diseño, mobile-first, PWA, apps nativas

Diseño moderno, juvenil, confiable, limpio, premium, mobile-first —
explícitamente **no** genérico de SaaS (sin exceso de gradientes,
tarjetas idénticas, colores aleatorios). PWA cuando sea razonable. App
móvil futura: React Native + Expo, **reutilizando la misma API/lógica de
negocio, sin duplicar backend**.

**Decisión de Claude, la más estructural de toda la arquitectura**: capa
`lib/services/*` separada de los Server Actions. Hoy, Server Actions
(delgadas) llaman a esa capa. Cuando exista la app Expo, se añade
`app/api/v1/*` como wrapper HTTP fino sobre la **misma** capa de
servicios — cero lógica de negocio reescrita. Ver `docs/ARCHITECTURE.md`.

## 27. Base de datos — lista de entidades pedida originalmente

`users, profiles, preferences, universities, cities, neighborhoods,
rooms, room_images, roommates, matches, interests, conversations,
messages, reports, notifications, verification_status, favorites`.

**Mapeo final (decisiones de Claude, confirmadas por el usuario)**:

| Pedido | Esquema real | Por qué |
|---|---|---|
| `users` | `auth.users` (Supabase) + `profiles` | Evita duplicar lo que Supabase Auth ya gestiona |
| `preferences` | `housing_preferences` | Mismo concepto, nombre más específico |
| `roommates` | Fusionado en `profiles` + `housing_preferences` | Sin tabla separada — sería redundante |
| `verification_status` | No existe. `auth.users.email_confirmed_at` | Sin flujo real detrás en el MVP salvo email |

18 tablas finales, confirmadas explícitamente por el usuario:
`cities, neighborhoods, universities, profiles, housing_preferences,
compatibility_responses, rooms, room_images, room_addresses, favorites,
interests, matches, conversations, conversation_participants, messages,
reports, admin_action_logs, notifications`.

Esquema completo, columnas, tipos, constraints, índices, triggers: ver
`docs/DATABASE.md` y el SQL real en `supabase/migrations/`.

## 28-29. Seguridad y RGPD

RLS en Supabase, autorización por roles, validación de inputs,
sanitización, rate limiting, gestión segura de secrets, nunca `.env` en
el repo. RGPD desde el diseño: minimización de datos, eliminación de
cuenta, exportación cuando corresponda. Dudas legales marcadas como
**REQUIERE REVISIÓN LEGAL**, nunca decididas por Claude.

**Hallazgo crítico de una revisión de seguridad posterior** (el más
importante de todo el proyecto hasta la fecha): las políticas RLS
`profiles_update_own` y `participants_update_own` usaban `using` sin
`with check`. RLS filtra *filas*, no *columnas* — cualquier usuario podía
ejecutar `update profiles set role = 'admin' where id = auth.uid()` y la
política lo permitía. Corregido con restricción de columnas actualizables
a nivel de `GRANT`/`REVOKE` (independiente de RLS): `authenticated` ya no
tiene privilegio de `UPDATE` sobre `profiles.role` ni sobre
`conversation_participants.conversation_id`. Detalle completo en
`docs/SECURITY.md` §"Comprobación de coherencia final".

Edad mínima 18 como constraint técnico (`chk_min_age` en `profiles`) —
**REQUIERE REVISIÓN LEGAL** para confirmar el umbral y los requisitos
exactos. Soft-delete es herramienta de producto, no RGPD — el
borrado/anonimización real **REQUIERE REVISIÓN LEGAL** para el plazo
exacto.

## 30-31. Monetización y modelo de negocio

MVP gratuito para estudiantes. Futuro: premium (filtros avanzados,
alertas), propietarios (destacados, candidatos recomendados,
verificación), y más adelante comisión, reservas, seguros, servicios
relacionados con vivienda compartida. **No implementar pagos hasta que
exista demanda real.** El objetivo a largo plazo no es vivir de
suscripciones de 5€/mes — es convertirse en infraestructura para
vivienda compartida.

## 32-34. Lanzamiento, marketing viral, SEO

Barcelona primero, universidades objetivo UB/UAB/UPC/UPF y otras.
Crecimiento vía TikTok/Instagram, embajadores estudiantiles, Erasmus,
residencias. Contenido compartible ("¿qué compañero de piso eres?", "el
test definitivo..."). SEO técnico con páginas indexables
`/[ciudad]/habitaciones` y `/[ciudad]/companeros-de-piso`, limitadas a
`cities.is_active = true`, sin generar miles de páginas vacías.

**Decisión de Claude**: para que estas páginas sean rastreables sin
sesión sin reabrir `profiles` completo al público, existe la vista
`public_profile_previews` (solo nombre/avatar/rol).

## 35-36. Analytics y métrica principal

PostHog, región EU. Eventos: `signup_started/completed`,
`profile_started/completed`, `test_started/completed`, `match_viewed`,
`interest_sent/received`, `match_created`, `conversation_started`,
`message_sent`, `room_viewed/saved/contacted/created`, `report_created`.
Funnel: visita → registro → perfil → test → match → contacto →
conversación → vivienda.

**Métrica principal, explícita**: "porcentaje de usuarios que encuentran
al menos un match relevante" (y después, "...que consiguen una
convivencia/vivienda"). **No** descargas, seguidores, visitas o registros
sin actividad.

**Decisión de Claude**: captura en dos vías — cliente (`posthog-js`, para
interacción) y servidor (`posthog-node`, para conversiones de negocio,
para que un bloqueador de anuncios no falsee el funnel).

## 37. Fases de desarrollo — roadmap completo

Ver `docs/ROADMAP.md` para el estado real y actualizado de cada fase.
Resumen de las fases y sus objetivos, tal como se diseñaron:

- **Fase 0 — Architecture**: completada. Arquitectura, esquema de BD,
  estructura de carpetas, documentación. Sin código de aplicación.
- **Fase 1 — Foundation**: en progreso — ver `docs/ROADMAP.md` y
  `HANDOFF.md` para el estado exacto, checklist pendiente.
- **Fase 2 — User**: registro, login, perfil, preferencias, onboarding.
- **Fase 3 — Compatibility**: cuestionario, algoritmo, matches.
- **Fase 4 — Rooms**: CRUD de habitaciones, búsqueda, filtros.
- **Fase 5 — Interest**: favoritos, interés, match mutuo.
- **Fase 6 — Chat**: conversaciones, mensajes, bloquear, reportar.
- **Fase 7 — Admin**: dashboard, usuarios, habitaciones, reportes.
- **Fase 8 — Polish**: responsive, accesibilidad, SEO, rendimiento,
  seguridad completa.
- **Fase 9 — Beta**: producción, analítica, backups, legal, feedback.

Roadmap post-MVP: V2 (grupos, verificación real, push, app móvil), V3
(propietarios profesionales, premium), V4 (pagos, contratos, seguros),
V5 (universidades, residencias, expansión internacional). Nada de esto
se construye antes de demanda demostrada.

## 38-53. Reglas fundamentales de desarrollo (condensado)

Trabajar fase a fase, nunca varias a la vez. Cada fase: objetivo →
criterios de aceptación → implementar → testear → documentar → commit.
No pasar de fase con tests rotos. Testing con Vitest + Playwright,
prioridad al algoritmo de matching y a RLS. Git desde el principio,
commits pequeños, nunca force-push/reset destructivo sin confirmación.
Documentación viva (`CLAUDE.md`, `PROGRESS.md` actualizado cada sesión).
Comportamiento esperado de Claude: inspeccionar antes de modificar, no
especular sobre archivos no leídos, no inventar APIs, verificar
dependencias reales antes de usarlas. Evitar sobreingeniería
explícitamente: nada de microservicios, Kubernetes, IA para lo que puede
resolverse determinísticamente, múltiples bases de datos. IA solo para
lo que no es el producto (moderación, búsqueda semántica futura) — nunca
para matching. Escalar de 100 a 100.000 usuarios sin reescritura, sin
optimizar prematuramente. Rendimiento: la app debe sentirse rápida en
móvil. Prioridad ante conflicto: seguridad y bugs críticos → flujo
principal → UX → nueva funcionalidad.

**Criterio de éxito del MVP**: un usuario real puede entrar, registrarse,
crear perfil, completar el test, ver compañeros compatibles, ver una
habitación, mostrar interés, hacer match, iniciar conversación — y
alguien con habitación puede publicarla y recibir interés — y un admin
puede ver usuarios/habitaciones, revisar reportes, bloquear usuarios.
Todo en producción.

**Explícitamente fuera del MVP**: pagos, contratos, seguros, blockchain,
IA generativa compleja, videollamadas, recomendaciones vía LLM,
reputación avanzada, marketplace de servicios, publicidad, afiliados
complejos, multi-idioma completo, panel empresarial complejo.

---

## Decisiones técnicas acumuladas (índice — detalle en cada documento)

Esta lista es un índice rápido; el razonamiento completo de cada una
vive en `docs/ARCHITECTURE.md`, `docs/DATABASE.md` o `docs/SECURITY.md`.

1. `auth.users` + `profiles`, no una tabla `users` propia.
2. `housing_preferences`, no `preferences` — mismo concepto.
3. Sin tabla `verifications` en el MVP.
4. Sin tabla `notification_preferences` granular en el MVP.
5. `room_addresses` separada, RLS propia y más estricta.
6. `interests` unifica interés en persona e interés vía habitación.
7. `conversation_participants` como tabla de unión, no columnas fijas.
8. `admin_action_logs` — trazabilidad de moderación.
9. Capa `lib/services/*` desacoplada de Server Actions — clave para
   reutilizar backend con la futura app móvil sin duplicarlo.
10. Motor de matching como función TypeScript pura, no SQL/IA.
11. Magic link recomendado sobre contraseña (reversible).
12. Mapbox recomendado sobre Google Maps (reversible, por coste).
13. Chat vía Supabase Realtime, sin infraestructura propia.
14. Restricción de columnas actualizables (`GRANT`/`REVOKE`) en
    `profiles.role` y `conversation_participants.conversation_id` —
    corrección de un hallazgo real de escalado de privilegios.
15. `pets_allowed`/`smoking_allowed`/`students_only` como columnas
    booleanas propias en `rooms` — faltaban para los filtros de
    búsqueda pedidos explícitamente.
16. Next.js 16 deprecó `middleware.ts` en favor de `proxy.ts` — migración
    pendiente, descubierta durante Foundation (no una decisión de
    producto, una realidad del framework).

## Lo que sigue explícitamente pendiente de decisión humana

- Datos legales de la empresa (razón social, NIF, dirección, DPO) para
  Términos y Privacidad.
- Dominio de producción.
- Confirmación de Mapbox vs. Google Maps, y magic link vs. contraseña
  (recomendaciones técnicas, no bloqueantes, reversibles).
- Todo lo marcado **REQUIERE REVISIÓN LEGAL** en `docs/DATABASE.md` y
  `docs/SECURITY.md` (edad mínima, plazos de borrado RGPD,
  transferencias internacionales de datos).
