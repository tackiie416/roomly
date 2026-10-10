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

**Implementado en la Fase 3** (especificación cerrada del 2026-10-07,
decisiones D1–D18):
- **29 preguntas**, en `lib/matching/questionnaire.ts`. Desde S1–S4
  (2026-10-10) la vigente es la **versión 2**; la **versión 1** se conserva
  como histórica, sin cambios.
- **Todas obligatorias** para completar el test; no hay «prefiero no
  responder» y no se pregunta nada de salud (alergias incluidas).
- **Escalas**: 1–5, salvo fumar y mascotas, que van de 1 a 3. Hay tres tipos
  de pregunta: similitud, conducta y tolerancia; cada tolerancia tiene la
  misma escala que su conducta.
- **Temas sin peso propio en §9**: van dentro de una categoría existente.
  Cocina, qué se comparte y turnos de limpieza, en Limpieza. Horas de
  silencio, en Ruido. Teletrabajo y videollamadas en las zonas comunes, en
  Estudio. Privacidad, comunicación, conflictos y normas, en Personalidad.
- **Ubicación y presupuesto** no se preguntan: salen de
  `housing_preferences`.
- **Guardado parcial**: `completed_at` es NULL mientras el test es un
  borrador.
- **Ids estables (D15a)**: un id nunca cambia de significado, escala, tipo,
  categoría ni pareja. Al subir de versión se reutilizan las respuestas
  cuyos ids siguen existiendo (D15b).
- **Textos de la v1** (PR #11, `83654eb`, 2026-10-09): integrada la
  redacción editorial aprobada.
  - Enunciados y etiquetas más claros (E1–E19), textos generales de `/test`
    (G1–G4) y una ayuda bajo las preguntas de visitas (S5), que no se guarda
    ni puntúa.
  - Sin cambiar ids, orden, escalas, categorías, parejas, pesos ni la
    versión (`CURRENT_QUESTIONNAIRE_VERSION = 1`).
- **S1–S4, en la versión 2** (decisión del propietario del 2026-10-10: la
  opción A de la auditoría de impacto, con la lectura estricta de D15a).
  Cuatro cambios semánticos:
  - S1: el extremo superior de la escala de ruido pasa de «Bastante» a
    «Mucho», con la misma escala y la misma orientación;
  - S2: la tolerancia se refiere a las fiestas que organiza un compañero;
  - S3: quien se queda a dormir es alguien invitado por ti o por un
    compañero;
  - S4: las mascotas que habrá en el piso, con los mismos ejemplos de
    mascotas pequeñas en la conducta y en la tolerancia.
- **Ocho ids nuevos, con sufijo `_v2`**: `noise_own_v2`,
  `noise_tolerance_v2`, `party_own_v2`, `party_tolerance_v2`,
  `guests_overnight_own_v2`, `guests_overnight_tolerance_v2`, `pets_own_v2` y
  `pets_tolerance_v2`.
  - D15a también fija la pareja. Por eso se renuevan los dos miembros de cada
    pareja, aunque `party_own_v2` y `pets_tolerance_v2` pregunten lo mismo
    que en la v1.
  - Las otras 21 preguntas son las mismas en las dos versiones: mismo id,
    enunciado, ayuda, escala, etiquetas, tipo, categoría y pareja.
  - Los pesos, las categorías, las escalas y el orden no cambian.
- **Paso de la v1 a la v2** (D15b y D7):
  - un test de la v1 queda desactualizado: `/explorar` lleva a `/test`, que
    avisa del cambio;
  - se reutilizan las 21 respuestas cuyos ids siguen en la v2, si son
    válidas;
  - las de los ocho ids sustituidos no se copian ni se reinterpretan bajo los
    ids nuevos;
  - la primera escritura de la v2 sigue las reglas de siempre: queda
    completada solo si están las 29 respuestas y, si no, es un borrador.
  - Sin migración: la base de datos ya admite subir de versión, y nunca
    bajar.

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

**Implementado en la Fase 3** (los pesos de la tabla, sin cambios; D16):
- **Unidades de una categoría del test**:
  - similitud: `1 − |a − b| / (máx − mín)`;
  - parejas conducta–tolerancia: `min(d(A→B), d(B→A))` (D1), donde
    `d(X→Y) = 1` si la conducta de X cabe en la tolerancia de Y y, si no,
    `1 − exceso / (máx − mín)`.

  La categoría vale la media de sus unidades.
- **Ubicación**: coeficiente de solapamiento entre barrios,
  `|∩| / min(|A|, |B|)`.
- **Presupuesto**: 1 si los rangos se solapan; si no,
  `max(0, 1 − hueco / 150)` (D8).
- **Dato ausente** (sin barrios o sin ningún extremo de presupuesto en
  cualquiera de los dos): la categoría se excluye y los pesos se renormalizan
  (D3).
- **Total**: categorías redondeadas a 6 decimales (r6) y total
  `round_half_up(r6(100·Σ peso·cat / Σ pesos presentes))`, entre 0 y 100.
  Es simétrico, determinista y nunca lanza: una entrada inválida o de otra
  versión del cuestionario devuelve `not_comparable`. Solo se comparan dos
  tests de la misma versión; un test de la v1 nunca se puntúa como si fuera
  de la v2.
- **Filtros duros** (antes del score), no puntúan:
  - misma ciudad;
  - fechas que se solapan (NULL = abierto);
  - hueco de presupuesto ≤ 150 €;
  - rangos de número de compañeros que se solapan, `[max(1, mín ?? 1), máx ?? ∞]`;
    con `máx = 0` («sin compañeros», D2) la persona no es candidata.
- **Se excluye** a la propia persona, las cuentas eliminadas, el onboarding o
  el test sin completar, el test de otra versión y los admins (D10).
- **No filtran**: `seeking_status`, fumar ni mascotas.

## 10. Explicación del match

Nunca solo "92% compatible". Siempre con razones: "Por qué encajáis"
(✓ presupuesto similar, ✓ mismos horarios...) y "Posibles diferencias"
(⚠ tú prefieres más tranquilidad...). Transparencia obligatoria.

**Implementado en la Fase 3**:
- **Umbrales**: fortaleza si la categoría vale ≥ 0,80; diferencia si vale
  ≤ 0,50. Como mucho 3 de cada tipo, ordenadas por peso y luego por el orden
  fijo de las categorías.
- **Sin datos de las respuestas**: las explicaciones son por categoría, sin
  cifras ni puntuaciones.
- **Dirección** («tú prefieres más tranquilidad», «X tiene un horario más
  tardío»): solo en las diferencias de Horarios y Ruido, y solo si los dos
  componentes van en el mismo sentido; si no, frase neutra. El resto de
  categorías va siempre en neutro.
  - Las preguntas que dan la dirección salen de la definición de la versión
    que se compara: en Ruido, la tolerancia es `noise_tolerance` en la v1 y
    `noise_tolerance_v2` en la v2.
  - Si a un cuestionario le falta alguna, el motor no da resultado
    (`invalid_questionnaire`), nunca una dirección calculada con un hueco.
- **Riesgo residual aceptado (D11)**: una explicación neutra puede dejar
  intuir algo de las respuestas del otro.

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

**Implementado en la Fase 3** (D12–D14): la lista de candidatos («Mis
matches» en este texto) está en **`/explorar`**; `/matches` queda para los
matches mutuos de la Fase 5.
- **Tarjeta**:
  - nombre completo (`full_name`);
  - edad en años;
  - universidad;
  - hasta 3 barrios y cuántos más tiene;
  - presupuesto en escalones de 50 €;
  - compatibilidad;
  - hasta 3 razones y 3 diferencias;
  - inicial en lugar de foto (M3 sigue fuera de alcance).
- **Sin «Ver perfil» ni «Me interesa»** en la Fase 3: llegan en la Fase 5.
  Esto contradice a sabiendas esta sección; lo decidió el propietario.
- **Lista**: 20 por página (`?pagina=N`), por score descendente y, si hay
  empate, por id ascendente. Sin tope total.

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
16. Next.js 16 deprecó `middleware.ts` en favor de `proxy.ts` —
    descubierto durante Foundation (no una decisión de producto, una
    realidad del framework). Migrado el 2026-09-29; el proxy corre en
    Node.js.
17. Fase 3: el servidor es el único que escribe en `compatibility_responses`
    (D18). `authenticated` solo lee su fila, y un trigger aplica las reglas
    S1–S6 a todos los roles.
18. Fase 3: service_role solo en dos servicios `server-only` (D17):
    candidatos (`lib/services/matching.ts`) y escritura del test
    (`lib/services/compatibility.ts`).

## Lo que sigue explícitamente pendiente de decisión humana

- Datos legales de la empresa (razón social, NIF, dirección, DPO) para
  Términos y Privacidad.
- Dominio de producción.
- Confirmación de Mapbox vs. Google Maps, y magic link vs. contraseña
  (recomendaciones técnicas, no bloqueantes, reversibles).
- Todo lo marcado **REQUIERE REVISIÓN LEGAL** en `docs/DATABASE.md` y
  `docs/SECURITY.md` (edad mínima, plazos de borrado RGPD,
  transferencias internacionales de datos).
- Fase 3, decisiones posteriores (no bloquean la implementación local):
  - textos y etiquetas finales del cuestionario;
  - el proyecto Supabase nuevo para validar desde cero;
  - `SUPABASE_SERVICE_ROLE_KEY` en el servidor de producción.
