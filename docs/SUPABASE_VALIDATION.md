# Validación contra Supabase real

Objetivo: demostrar que las migraciones, la RLS y el flujo de alta se
comportan en **Supabase real** igual que en el PostgreSQL + shim de
`tests/db/` y en el Supabase simulado del E2E local.

Estado (2026-10-06): **validación real de la Fase 2.8 completada** en el
proyecto `roomly-validation-2b` (ref `uwxb…`, marca `roomly-validation-2`):
- **run 13:** validación estructural real;
- **run 15:** E2 real.

Detalle y diagnóstico de los runs anteriores en «Resultado de la Fase 2.8».
El checkpoint anterior contra `roomly-validation` (Fase 1) es histórico y
está al final.

**Desde la Fase 3 el destino es un proyecto nuevo, `roomly-validation-3`**,
creado por el propietario. Su marca, su Environment y `confirm_project` son
`roomly-validation-3`. `uwxb…` (marca `roomly-validation-2`) es el
**proyecto anterior**: no se toca y la guarda lo rechaza.

Estado (2026-10-09): **validación real de la Fase 3 completada** en
`roomly-validation-3`:
- **run 16:** validación estructural;
- **run 18:** E2 real, con destino `/test`.

Detalle en «Resultado de la Fase 3: validación estructural» y «Resultado de
la Fase 3: E2 real». **La Fase 3 no está cerrada**: quedan pendientes fuera
de la validación real (ver `docs/ROADMAP.md`).

Evaluación (2026-10-11): la v2 del cuestionario (PR #13) **no tiene
validación real propia**, y se decidió no hacer un run solo por ella. Ver
«Evaluación posterior a la v2 del cuestionario».

Estado (2026-10-11, run 19): **primer run real de SVC1–SVC5 y GC1–GC4**, en
verde en `roomly-validation-3`. Valida en real los servicios
`saveQuestionnaireAnswers` y `getCandidates`, llamados desde el runner; **no
valida el runtime completo de Next.js**. Ver «Resultado: run 19, servicios
del servidor (SVC/GC)».

Estado (2026-10-16): **la Fase 4 no tiene validación real.** Las tres
migraciones de la Fase 4 (4.0, 4.1 y la carga de barrios de R1) solo han
corrido en local y en la CI. `roomly-validation-3` sigue con el esquema del
run 16, y un run actual fallaría ya en P1 (ver «Aviso (Fase 4)»). Cómo
validarlas en real lo decide el propietario (R8).

Estado (2026-10-21, run 21): **las tres migraciones de la Fase 4 están
aplicadas en `roomly-validation-3`** con R8 (`phase4_upgrade=apply`), que
terminó en «apply correcto». Después pasaron en real el preflight con la
Fase 4, la suite SQL `01`–`18`, la api-suite (62/62, RO1–RO9 por primera vez
con la 4.1) y AU3/AU5. El E2 se omitió: **no está validado con la Fase 4**.
Esto supera el estado del 2026-10-16. Quedan abiertos la anomalía de las
aprobaciones del Environment (no hubo ninguna) y una comprobación
independiente de la limpieza. Ver «Resultado: run 21, `apply` de R8 (Fase
4)».

Los resultados de los runs 13–21, más abajo, describen el esquema y las
suites **de cada momento**. La configuración vigente está en «Cómo se
ejecuta», «Preflight P0–P6» y «Matriz de pruebas».

## Resultado: run 21, `apply` de R8 (Fase 4) (2026-10-21)

| Run | Id | Commit | Parámetros | Resultado |
|---|---|---|---|---|
| **21** | `39521485133` | `a8e5028` (rama `claude/phase4-r8-upgrade-tool`, head del PR #27) | `confirm_project=roomly-validation-3`, `apply_migrations=false`, `run_e2e_real=false`, `phase4_upgrade=apply`, `confirm_phase4_upgrade=aplicar-fase4-en-roomly-validation-3` | ✅ Los seis jobs previstos, en verde en el primer intento; `migrate` y `e2e-real` omitidos por diseño |

- URL: https://github.com/tackiie416/roomly/actions/runs/39521485133
- Commit completo: `a8e50289991b508fcdc121918b96ad13ae4e557d`, el que se
  revisó para el `apply` (D8).
- **Lo lanzó el propietario** (`tackiie416`) a mano desde la interfaz de
  Actions (`workflow_dispatch`), con su autorización expresa del `apply`.
  Claude no lo lanzó: no podía comprobar que habría pausas de aprobación (la
  API del Environment devuelve HTTP 403), y la autorización pedía, en ese
  caso, que lo lanzara el propietario.
- Según la API de GitHub, empezó el 2026-10-21 a las 00:28:02 UTC y terminó a
  las 00:32:40 UTC, en un solo intento. La API da ese `head_sha` en los ocho
  jobs, y en los logs leídos (R8, `preflight`, `api-suite` y
  `auth-redirects`) el checkout termina en ese commit.
- **Entradas:** el log del paso de R8 muestra `PHASE4_UPGRADE: apply`,
  `APPLY_MIGRATIONS: false`, `RUN_E2E_REAL: false` y
  `PHASE4_UPGRADE_CONFIRM: aplicar-fase4-en-roomly-validation-3`. El paso
  «Confirmación explícita del proyecto» de la guarda terminó en `success`, y
  solo lo hace con `confirm_project=roomly-validation-3`.

**Migraciones aplicadas** (con `COMMIT`, en este orden, en una sola
transacción):
- `20261013120000_rooms_deleted_account_writes.sql` (4.0);
- `20261015120000_rooms_integrity_publication.sql` (4.1);
- `20261016120000_barcelona_neighborhoods.sql` (R1, los 73 barrios
  oficiales).

**Resultado de cada job** (estado según la API y líneas del log; logs leídos
el 2026-10-21 con el conector de GitHub, `get_job_logs`):

| Job | Estado | Evidencia en el log |
|---|---|---|
| `guard` | ✅ `success` | «guard: destino verificado como roomly-validation-3 (coherencia local + marca del proyecto)» |
| `phase4-upgrade` (R8) | ✅ `success` | Dos pasadas: `== R8 · rollback hecho`, «ensayo limpio; se repite el mismo cuerpo con COMMIT», `== R8 · commit hecho` y «RESULTADO: apply correcto: las 3 migraciones de la Fase 4 aplicadas y P0–P6 superadas antes del COMMIT». Detalle en «Run 21: `apply` real», más abajo |
| `preflight` (P0–P6, ya sobre la Fase 4) | ✅ `success` | P1 «18 tablas … Barcelona con sus 73 barrios oficiales, restricciones de rooms de la Fase 4.1 presentes»; P3 «exactamente las 44 políticas esperadas y las escrituras de habitaciones exigen cuenta activa»; P4 «incluidos housing_preferences, compatibility_responses y rooms»; P6 «13 triggers activos, 11 funciones propias»; «RESULTADO: P0–P6 superadas». PostgreSQL 17.11 |
| `sql-suite` (`tests/db`) | ✅ `success` | Los 18 archivos, `01_profiles_role.sql` a `18_neighborhoods_catalog.sql`, cada uno con «ok - aislamiento: ROLLBACK completo, rol y claims restaurados». 651 líneas `ok -` de aserciones, el mismo número que `test:db` en local (651/651); ninguna `not ok` ni `WARNING`. Al final, «tras la suite: sin roomly_test, sin políticas temporales, sin usuarios de test» y «RESULTADO: suite SQL completa en Supabase real (cada archivo revertido con ROLLBACK)» |
| `api-suite` (supabase-js, JWT reales) | ✅ `success` | «Test Files 1 passed (1)» y «Tests 62 passed (62)»: PR1–PR12, CH1–CH11, RO1–RO9, RE1–RE9, CRA1–CRA6, SVC (6), GC1–GC4 y AU2 (5). **RO1–RO9 corren por primera vez contra el esquema de la 4.1** |
| `auth-redirects` (AU3/AU5 sin sesión) | ✅ `success` | AU3a–AU3g y AU5a–AU5i, 16 líneas `ok`, y «RESULTADO: AU3/AU5 (sin sesión) superados» |
| `migrate` | ⏭️ `skipped` | Por diseño: con `phase4_upgrade=apply` no se aplican migraciones por esa vía |
| `e2e-real` (E2) | ⏭️ `skipped` | `run_e2e_real=false`. **El E2 no se ha ejecutado con la Fase 4** |

Otras líneas del log, sin efecto en el resultado:
- en la api-suite, las líneas informativas de PR8, PR10/H3 (la vista
  `public_profile_previews`, H3, ya aceptada; el preflight la marca como
  `P5 info`), CH10, RO6, GC4 y AU2;
- en `npm ci` (api-suite y AU3/AU5): «9 high severity vulnerabilities». No
  tiene relación con R8; queda para otra tarea;
- en los logs leídos, el aviso genérico de GitHub sobre Node.js 20.

**Confirmado por el propietario antes del run** (2026-10-21, entre las 00:21
y las 00:22 UTC, en respuestas a preguntas cerradas; Claude no lo observó):
- D4: el Environment `roomly-validation-3` quedó con una sola regla de
  ramas, `claude/phase4-r8-upgrade-tool` (sin `master`), el propietario como
  *required reviewer* y «Prevent self-review» desactivado;
- D7: las dos claves, copiadas de nuevo del proyecto `roomly-validation-3`,
  cada una en su secret y del mismo tipo;
- Supabase: el proyecto activo, el registro público cerrado, 0 usuarios,
  nada que conservar y la URL Configuration sin cambios;
- aislamiento (Netlify, Vercel, Lovable, previews y entornos locales)
  revisado, y su disponibilidad durante todo el proceso.

**⚠️ Anomalía: no hubo ninguna aprobación del Environment.**
- **Verificado directamente por la API:**
  - el registro de aprobaciones del run (`/actions/runs/39521485133/approvals`)
    responde `[]`, una lista vacía, no un error de acceso;
  - los seis jobs empezaron entre 2 y 3 s después de crearse. Por ejemplo,
    `guard` terminó a las 00:28:11 y R8 se creó a las 00:28:11 y empezó a las
    00:28:14. Es el mismo patrón del run 20, anterior a la opción B de D4;
  - los seis deployments del Environment `roomly-validation-3` pasan de
    `in_progress` a `success` sin ningún estado de espera.
- **Lo previsto:** con D4 (opción B), una aprobación del propietario antes de
  cada job protegido y, en particular, una parada antes de `phase4-upgrade`
  para comprobar el SHA, la última antes del `COMMIT`. El procedimiento
  acordado era que el propietario comprobara que el run se quedaba esperando
  y lo cancelara si `guard` empezaba sin pedir aprobación.
- **Lo que pasó:** el run avanzó sin ninguna pausa hasta el final. Claude no
  lo siguió en curso: lo supo cuando ya había terminado.
- **Inferencia:** a estos jobs no se les aplicó ninguna regla de *required
  reviewers*. **D4 no fue efectiva en el run 21**, aunque antes del run se
  había confirmado aplicada.
- **Causa: sin determinar.** La configuración del Environment no se puede
  leer por la API (HTTP 403), y nadie la ha vuelto a inspeccionar después del
  run. De la regla de ramas no se puede deducir nada: el run se lanzó desde
  la rama permitida.
- **Impacto, comprobado después:** el run ejecutó `a8e5028` y un cuerpo SQL
  con el mismo SHA-256 que el del `dry_run` (`0c9cadd0597a…`). Lo que se
  aplicó es lo revisado. Pero el control previsto no funcionó, y hay que
  revisarlo antes de cualquier otro run contra `roomly-validation-3`.

**Limpieza: pendiente de una comprobación independiente.**
- **Lo que comprueba el propio workflow:**
  - la suite SQL termina con «sin roomly_test, sin políticas temporales, sin
    usuarios de test». Es anterior a la api-suite;
  - la api-suite pasó 62/62 y su único archivo de tests, también. Su teardown
    (`afterAll`) borra los usuarios de prueba y sus datos, y al final cuenta
    las filas de `profiles`, `housing_preferences` y
    `compatibility_responses` de esos usuarios. El teardown no imprime nada
    cuando termina bien.
- **Inferencia:** Vitest informa de un error en `afterAll` como fallo del
  archivo, y el resumen da «1 passed», así que el teardown no falló.
- **Sin verificar:** no hay una inspección posterior al run de
  `auth.users` ni de las demás tablas. Claude no tiene acceso a Supabase ni
  autorización para SQL. Queda pendiente para el propietario, solo mirando
  en el panel:
  - Authentication → Users: 0 usuarios;
  - 0 filas en `rooms`, `room_addresses`, `room_images`, `profiles`,
    `housing_preferences`, `compatibility_responses`, `reports`,
    `interests`, `matches`, `conversations`, `conversation_participants`,
    `messages`, `favorites` y `admin_action_logs`;
  - las filas fijas: 73 en `neighborhoods`, 9 en `cities` y 7 en
    `universities`.

**Estado del proyecto tras el run:**
- `roomly-validation-3` tiene ya el esquema de la Fase 4: lo muestran el
  `COMMIT` de R8 y el preflight posterior, que es un job aparte.
- Va por delante de `master` hasta que se fusione el PR #26. La referencia
  remota de `master` es `7818a15` (merge del PR #25, solo con la 4.0), según
  `git ls-remote` en modo lectura el 2026-10-21. No se ha comprobado qué
  haría un run lanzado desde `master`: su preflight y su suite SQL
  corresponden a un esquema anterior al del proyecto. No conviene lanzar
  ninguno sin revisarlo.
- **No hizo falta ninguna recuperación.** Por diseño, un segundo `apply` no
  aplicaría nada: el preflight congelado y R8-BASE lo rechazan antes de las
  migraciones (probado en local, caso D del selftest; no en real).

**Lo que este run NO valida:**
- el E2 con la Fase 4 (omitido);
- el runtime completo de Next.js con la clave real. La app de AU3/AU5 se
  construye en el runner sin service_role (D6 = B);
- la limpieza, sin una comprobación independiente (arriba);
- una pérdida de red real durante el `COMMIT` y las señales de GitHub
  Actions al cancelar un job: no hicieron falta y siguen sin probarse en
  real;
- la anomalía de las aprobaciones queda abierta.

## Resultado: run 19, servicios del servidor (SVC/GC) (2026-10-11)

| Run | Id | Commit | Parámetros | Resultado |
|---|---|---|---|---|
| **19** | `38106687478` | `92fb757` (`master`, merge del PR #17) | `confirm_project=roomly-validation-3`, `apply_migrations=false`, `run_e2e_real=false` | ✅ Todos los jobs ejecutados en verde, en el primer intento y sin reintentos |

- URL: https://github.com/tackiie416/roomly/actions/runs/38106687478
- Commit completo: `92fb757948e1cf9cc53321da1cc6efb5a596c59a`.
- Lanzado a mano (`workflow_dispatch`) sobre `master`, una sola vez, con
  autorización expresa del propietario para esta ejecución. Según la API de
  GitHub, empezó el 2026-10-11 a las 02:54:57 UTC y terminó a las 02:58:05
  UTC.
- Es el **primer run real de SVC y GC**. Los runs 16 y 18 son anteriores a
  la v2 y a estos tests: no cubren SVC ni GC.

**Qué comprobó cada job:**
- **guard:** confirmación `roomly-validation-3` y «destino verificado como
  roomly-validation-3 (coherencia local + marca del proyecto)».
- **migrate:** omitido, como debía (`apply_migrations=false`).
- **preflight:** P0–P6 superadas:
  - P0: marca `roomly-validation-3`;
  - P1: PostgreSQL 17.11, 18 tablas y seed;
  - P3: RLS en las 18 tablas y exactamente 37 políticas;
  - P4: permisos de columna, incluidos `housing_preferences` y
    `compatibility_responses`;
  - P5: sin lints inesperados;
  - P6: 13 triggers y 11 funciones.
- **sql-suite:** los 14 archivos `tests/db/01`–`14` completados en Supabase
  real, con el mensaje «RESULTADO: suite SQL completa en Supabase real» y la
  comprobación final sin restos (sin `roomly_test`, políticas temporales ni
  usuarios de test). Sobre el recuento:
  - el runner aborta ante cualquier aserción fallida: cada fallo es un
    `RAISE EXCEPTION`, con `ON_ERROR_STOP`;
  - las 305 aserciones son las de la suite documentada y del código
    revisado (`tests/db`, sin cambios desde el run 18);
  - **no** salen de contar las líneas del log de este run, que no se pudo
    descargar entero.
- **api-suite:** **62/62**:
  - las 52 anteriores (PR1–PR12, CH1–CH11, RO1–RO9, RE1–RE9, CRA1–CRA6 y
    AU2);
  - las **10 nuevas**: SVC1–SVC4, los dos casos de SVC5 y GC1–GC4.
- **auth-redirects:** AU3/AU5 **16/16** (AU3a–g y AU5a–i).
- **e2e-real:** omitido, como debía (`run_e2e_real=false`). No se abrió el
  registro ni se enviaron emails.

**Casos nuevos, en verde en Supabase real** (llamados con el JWT real del
usuario y service_role inyectado en el runner):
- **SVC1:** un borrador parcial de la v2 se guarda como versión 2 y se relee
  con el JWT del usuario.
- **SVC2:** el cuestionario completo se guarda como completado y se fija
  `completed_at`.
- **SVC3:** volver a guardar un test completado no cambia `completed_at`.
- **SVC4:** paso de la v1 a la v2 en una sola escritura. Se conservan las 21
  respuestas comunes, se descartan los ocho ids sustituidos y el trigger
  rechaza volver a la v1.
- **SVC5** (dos casos): un id de la v1 y una respuesta fuera de escala se
  rechazan sin escribir.
- **GC1:** aparece el candidato elegible.
- **GC2:** no aparecen los candidatos que incumplen los criterios (test v1,
  borrador v2, otra ciudad, cuenta desactivada, admin y onboarding
  incompleto), ni quien mira.
- **GC3:** el DTO solo trae los campos permitidos.
- **GC4:** los filtros reales de PostgREST (`!inner`, versión y test
  completado) se verificaron en la respuesta cruda, antes del filtrado
  posterior del servicio (`isEligibleCandidate`). El test registró que
  PostgREST devuelve `compatibility_responses` y `housing_preferences` como
  **objeto**.

**Limpieza:**
- El teardown de la api-suite terminó sin errores, sin «Teardown
  incompleto».
- Sus comprobaciones finales no encontraron filas de los usuarios de prueba
  del run en `profiles`, `housing_preferences` ni `compatibility_responses`.
- Esa evidencia sale **del propio workflow**: no se hizo una inspección
  remota independiente del proyecto.

**Qué no cubre este run:**
- Es una validación real de los servicios `saveQuestionnaireAnswers` y
  `getCandidates`, **no del runtime completo de Next.js**.
- **E2 se omitió**: el recorrido de autenticación y del cuestionario en el
  navegador no se volvió a comprobar.
- **Sigue sin resolverse el riesgo de la combinación «Next.js en ejecución +
  cliente admin»** (`docs/SECURITY.md`).
- La CI ordinaria (`ci.yml`) sigue siendo distinta de esta validación: no
  ejecuta la api-suite contra Supabase real.
- **La Fase 3 sigue abierta.**

**Otros proyectos:** no se tocaron `uwxb…` (`roomly-validation-2`), su
Environment ni sus secrets.

## Evaluación posterior a la v2 del cuestionario (2026-10-11)

Evaluación documental, **no un run**: no se lanzó ningún workflow ni se
contactó con Supabase, Auth ni Mailtrap, y no se tocó ningún proyecto,
Environment ni secret. Responde a si la v2 del cuestionario (PR #13, merge
`7550d71`) necesita un run real propio.

**Decisión (2026-10-11): no se ejecuta un run real solo por los cambios de
la v2.**

Por qué:
- Desde la base de la v2 (`21df385`) hasta `master` (`fed61a8`) no cambian
  `supabase/migrations/`, `lib/services/`, `.github/workflows/` ni los tests
  reales (`tests/db`, `tests/integration`, `tests/supabase`,
  `tests/e2e/real`). La v2 cambia el código de `lib/matching/`
  (`questionnaire.ts`, `score.ts` y `types.ts`), sus tests y la
  documentación.
- La base de datos no conoce los ids de las preguntas: solo exige que
  `answers` sea un objeto JSON y que `questionnaire_version` sea >= 1. Unas
  respuestas con ids `_v2` no cambian nada para Postgres.
- Lo propio de la v2 es código: la definición, la transición de la v1 a la
  v2, la dirección de Ruido, `invalid_questionnaire`, `version_mismatch` y el
  filtro de versión. Lo cubren los tests unitarios y E1, contra el Supabase
  simulado.
- La mecánica de versión en la base de datos ya se comprobó en real en los
  runs 16 y 18, antes de que existiera la v2. En esas pruebas, la «versión
  2» es solo un número:
  - CRA5 (api-suite): sube la fila a la versión 2 completando en la misma
    escritura y después rechaza bajar a la versión 1;
  - CR14–CR16 (suite SQL): suben a la versión 2 completando o dejando un
    borrador, y rechazan bajar de versión.

  Son pruebas del trigger y de las restricciones de la base de datos, no del
  significado del cuestionario. Algunas usan ids concretos en `answers`
  (`clean_frequency` en la suite SQL; CRA5 parte de `{}`), pero el
  resultado no depende de lo que signifiquen. La base de datos valida que
  `answers` sea un objeto JSON y las reglas de versión, pero no los ids ni
  los valores que define el cuestionario.
- Un run con los tests actuales apenas comprobaría nada específico de la
  v2. Los jobs estructurales ejecutan los mismos tests que en el run 18, y
  el E2 solo comprueba el título de `/test`.

Qué **no** significa esta decisión:
- **No es una validación real de la v2.** Los runs 16 (`f619812`) y 18
  (`6dae75f`) son anteriores a la v2 y a los textos del PR #11. El run 18
  llegó a `/test` con el cuestionario v1 y no es una validación real de la
  v2.
- **La CI en verde no es una prueba contra Supabase real.** Los unitarios,
  E1 y `db-security` corren contra el Supabase simulado y contra PostgreSQL
  local.
- **No afirma que la aplicación esté validada en producción** ni en un
  entorno real completo. Según la documentación revisada (`CLAUDE.md`),
  todavía no hay despliegue.
- **La Fase 3 sigue abierta.**

**Pendiente antes del primer despliegue** (no depende de la v2). Dos
recorridos no se han ejecutado nunca contra Supabase real, con ninguna
versión del cuestionario, porque la app del workflow no recibe service_role
(D6 = B):
- guardar el test por el servicio del servidor: `saveQuestionnaireAnswers`
  en `lib/services/compatibility.ts`, con service_role;
- la consulta real de candidatos de `/explorar`: `getCandidates` en
  `lib/services/matching.ts`, con el select anidado (`!inner`) y el filtro
  de versión.

El workflow actual no los cubre. Cómo cubrirlos (por ejemplo, un entorno de
staging con la clave solo en el servidor, o un test nuevo en la api-suite)
está por evaluar y decidir. Lo decide el propietario, y cualquier opción
necesita autorización expresa.

Estado posterior a esta evaluación (2026-10-11): el test nuevo en la
api-suite está implementado (SVC1–SVC5 y GC1–GC4, ver «Matriz de pruebas»),
pero **pendiente de su primer run real**. Hasta entonces, estos dos
recorridos siguen sin cobertura real confirmada. Aunque pase, no cubre la
combinación «Next en ejecución + cliente admin», que sigue siendo un riesgo
aceptado hasta el despliegue (`docs/SECURITY.md`).

Actualización (run 19, 2026-10-11): SVC1–SVC5 y GC1–GC4 pasaron en Supabase
real (ver «Resultado: run 19, servicios del servidor (SVC/GC)»). Los dos
recorridos tienen ya cobertura real **a nivel de servicio**. La combinación
«Next en ejecución + cliente admin» sigue sin cubrir.

**Si se decide un run futuro.** Las instrucciones generales están en «Cómo
se ejecuta», en «E2 — requisitos del magic link real» (incluida su
«Preparación y limpieza») y en «Limpieza de la api-suite» (dentro de
«Matriz de pruebas»). Este apartado no cambia sus parámetros ni sus reglas.

Precondiciones:
- autorización expresa del propietario;
- un único destino, `roomly-validation-3`, con
  `confirm_project=roomly-validation-3` y `apply_migrations=false`;
- credenciales y configuración vigentes en el Environment, sin consultar
  ni revelar ningún secret;
- si se activa el E2: registro abierto por el propietario y buzón de prueba
  configurado.

Efectos esperados:
- la suite SQL ejecuta cada archivo en una transacción que termina en
  `ROLLBACK`;
- la api-suite crea usuarios temporales ya confirmados (`email_confirm`,
  sin depender del envío de correo) y su teardown los borra;
- si se activa el E2: envía un email real al buzón de prueba y crea un
  usuario que la limpieza del job intenta borrar.

Riesgos operativos:
- la limpieza no cierra el registro: solo avisa si sigue abierto. El
  propietario debe cerrarlo después de cualquier run que lo haya abierto;
- si el runner se interrumpe y no llega a la limpieza, pueden quedar
  usuarios de prueba hasta una limpieza posterior (la preparación del E2 y
  el inicio de la api-suite borran los restos de runs anteriores);
- las salvaguardas limitan lo que se borra, así que la limpieza no garantiza
  eliminar todos los restos en cualquier escenario:
  - solo borra emails que encajan exactamente con el patrón de prueba;
  - la del E2 no borra nada si encuentra más de 10 usuarios de prueba;
  - la api-suite no borra datos enlazados a datos ajenos: su teardown
    falla y lo reporta;
- alcance real de las comprobaciones:
  - la limpieza del E2 comprueba que no queden usuarios de la plantilla ni
    filas suyas en `profiles` y `housing_preferences`; no comprueba
    `compatibility_responses`, que cae en cascada desde `profiles`;
  - el teardown de la api-suite reporta los errores de cada borrado, pero
    después no vuelve a contar las filas.

## Resultado de la Fase 3: validación estructural (2026-10-09)

| Run | Id | Commit | Parámetros | Resultado |
|---|---|---|---|---|
| **16** | `37994799026` | `f619812` (`master`, merge del PR #8) | `confirm_project=roomly-validation-3`, `apply_migrations=true`, `run_e2e_real=false` | ✅ **Validación estructural real**, primer intento, sin fallos ni reintentos |

Lanzado a mano (`workflow_dispatch`) sobre `master`. Según la API de
GitHub, empezó el 2026-10-09 a las 21:39:57 UTC y terminó a las 21:43:41
UTC.

**Qué comprobó cada job:**
- **guard:** confirmación `roomly-validation-3`; los cinco secrets
  presentes, URL y conexión de BD del mismo ref, y la marca leída del propio
  proyecto («destino verificado como roomly-validation-3»).
- **migrate:** las **10 migraciones** de `supabase/migrations/`, de
  `20260925120000_initial_schema.sql` a
  `20261007120000_compatibility_responses_hardening.sql`, y después
  `supabase/seed.sql`, todo en **una transacción** («migraciones y seed
  aplicados en una sola transacción»).
- **preflight:** P0–P6 superadas:
  - P0: marca `roomly-validation-3`;
  - P1: 18 tablas y seed;
  - P3: RLS en las 18 tablas y exactamente 37 políticas;
  - P4: permisos de columna y de función, con `housing_preferences` y
    `compatibility_responses`;
  - P5: sin lints inesperados;
  - P6: 13 triggers y 11 funciones.
  - PostgreSQL 17.11.
- **sql-suite:** **305/305** aserciones en los 14 archivos `tests/db/01`–`14`
  (40 del archivo 14, `compatibility_responses`), cada uno revertido con
  ROLLBACK. Las **15 comprobaciones del runner** también pasaron: 14 de
  aislamiento tras cada ROLLBACK y una final sin `roomly_test`, sin
  políticas temporales y sin usuarios de prueba.
- **api-suite:** **52/52**: PR1–PR12, CH1–CH11, RO1–RO9, RE1–RE9, **CRA1–CRA6**
  (por primera vez en Supabase real) y AU2.
- **auth-redirects:** AU3/AU5 **16/16** (AU3a–g y AU5a–i), con la app
  arrancada solo con la URL y la clave pública.
- **e2e-real:** omitido, como estaba previsto (`run_e2e_real=false`).

**Otros proyectos:** el workflow solo apunta al Environment
`roomly-validation-3`. No se tocaron `uwxb…` (`roomly-validation-2`) ni su
Environment, ni el histórico `roomly-validation`.

## Resultado de la Fase 3: E2 real (2026-10-09)

| Run | Id | Commit | Parámetros | Resultado |
|---|---|---|---|---|
| 17 | `37998858090` | `6dae75f` (`master`, merge del PR #9) | `confirm_project=roomly-validation-3`, `apply_migrations=false`, `run_e2e_real=true` | ❌ El E2 falló al cargar el adaptador del buzón, antes de abrir `/login`: «E2E_MAILBOX_CONFIG no es un JSON válido». **No se pidió ningún magic link, no se envió ningún email y no se creó ningún usuario.** El resto de jobs, en verde |
| **18** | `37999470912` | `6dae75f` (`master`, merge del PR #9) | `confirm_project=roomly-validation-3`, `apply_migrations=false`, `run_e2e_real=true` | ✅ **E2 real 1/1** y todos los jobs en verde, en el primer intento |

Ambos se lanzaron a mano (`workflow_dispatch`) sobre `master`, en el primer
intento cada uno, con el registro de Auth abierto por el propietario para la
ventana del E2. Según la API de GitHub:
- **run 17:** de las 22:22:29 a las 22:25:49 UTC del 2026-10-09;
- **run 18:** de las 22:29:12 a las 22:33:02 UTC del 2026-10-09.

**Run 17: fallo de configuración, sin efectos.**
- La preparación pasó: guarda F1, Auth con email y registro activos, sin
  restos anteriores.
- El spec falló a los 267 ms al leer `E2E_MAILBOX_CONFIG`, antes del
  formulario de `/login`.
- La limpieza informó «0 usuario(s) de prueba borrado(s), sin datos
  asociados» y avisó de que el registro seguía abierto. Después falló al
  vaciar el buzón por el mismo motivo; no había mensajes que vaciar.
- El propietario corrigió el secret (es el mismo fallo que el run 14 de la
  2.8) y autorizó el reintento.

**Run 18: qué comprobó cada job.**
- **guard:** destino verificado como `roomly-validation-3`.
- **migrate:** omitido, como debía (`apply_migrations=false`).
- **preflight:** P0–P6 superadas.
- **sql-suite:** 305/305 en los 14 archivos `tests/db/01`–`14`, más las 15
  comprobaciones del runner, sin restos.
- **api-suite:** 52/52, con CRA1–CRA6.
- **auth-redirects:** AU3/AU5 16/16.
- **e2e-real:** preparación con «Auth con email y registro activos» y 0
  restos de ejecuciones anteriores; spec **1/1** (20,8 s). Recorrido:
  1. formulario real de `/login` → `signInWithOtp`;
  2. email real en el sandbox de Mailtrap;
  3. enlace a `/auth/v1/verify` validado (origen del proyecto y `redirect_to`
     exactamente `http://localhost:3000/callback`), abierto en el mismo
     navegador;
  4. `/callback?code=` con PKCE;
  5. onboarding (perfil y preferencias con ciudad) → **`/test`**, con el
     título «Test de convivencia»;
  6. `/perfil`, `/preferencias` y `/ajustes`, guardados y releídos;
  7. logout, y `/perfil` sin sesión vuelve a `/login`.

El E2 no responde ni guarda el test y no visita `/explorar`. La app corrió
solo con la URL y la clave pública, sin service_role (D6 = B). Sin
`generateLink` ni `token_hash`.

**Limpieza del run 18:**
- «1 usuario(s) de prueba borrado(s), sin datos asociados»: el usuario de
  la ejecución, con su perfil y sus preferencias en cascada; comprobado que
  quedan 0 usuarios de la plantilla y 0 filas suyas en `profiles` y
  `housing_preferences`.
- «mensajes del buzón de prueba borrados».
- Avisó de que **el registro público seguía abierto** al terminar, como
  está previsto: el workflow no lo cierra. **El cierre manual posterior
  corresponde al propietario y no queda verificado por el workflow.**

**Otros proyectos:** no se tocaron `uwxb…` (`roomly-validation-2`), su
Environment ni sus secrets.

## Resultado de la Fase 2.8 (2026-10-06)

**Resultado final**

| Run | Id | Commit | Parámetros | Resultado |
|---|---|---|---|---|
| **13** | `37533380047` | `f9f08ad` | `apply_migrations=true`, `run_e2e_real=false` | ✅ **Validación estructural real.** Guarda; las 9 migraciones y el seed en una transacción; P0–P6 (37 políticas); suite SQL 01–13 (13 archivos, cada uno revertido, sin restos); supabase-js 46/46; AU3/AU5 16/16 |
| **15** | `37543144825` | `ec7c3fc` (con el adaptador de Mailtrap) | `apply_migrations=false`, `run_e2e_real=true` | ✅ **E2 real 1/1**, con la parte estructural otra vez en verde |

**Qué recorrió el E2 del run 15:**
- formulario real de `/login` → `signInWithOtp`;
- email real recibido en Mailtrap;
- enlace `https://uwxb….supabase.co/auth/v1/verify` validado, con
  `redirect_to` exactamente `http://localhost:3000/callback`;
- `/callback?code=` con PKCE, en el mismo navegador;
- onboarding → `/perfil`, `/preferencias` y `/ajustes`, guardados y
  releídos → logout → `/perfil` sin sesión vuelve a `/login`.

Sin `generateLink` ni `token_hash`, y sin cambios en `/callback`.

**Limpieza:** «1 usuario(s) de prueba borrado(s), sin datos asociados» y
«mensajes del buzón de prueba borrados». No quedaron usuarios, filas ni
mensajes de prueba.

**Registro de Auth:** abierto a mano por el propietario solo para la ventana
del E2 (runs 14 y 15) y cerrado a mano después del run 15. La limpieza avisó
de que seguía abierto, como está previsto: el workflow no lo cierra.

**Otros proyectos:** no se tocaron ni el histórico `roomly-validation` ni el
retirado `qhwu…` (marca `roomly-retirado`).

**Historial de diagnóstico** (no es resultado; ningún run escribió nada)

| Runs | Qué pasó | Causa |
|---|---|---|
| 3–5 | apply-migrations se negó: «el esquema ya existe» | Los secrets apuntaban al proyecto antiguo, con esquema |
| 6–10 | La guarda rechazó la marca (run 10: ref `qhwu…`, marca `roomly-retirado`, 18 tablas) | Secrets **de repositorio** antiguos, que GitHub usa si el Environment no tiene los suyos |
| 11 | Igual que el 10, sobre `f9f08ad` | Los mismos secrets de repositorio |
| 12 | «faltan variables de entorno»: los cinco secrets vacíos | Borrados los de repositorio, los nuevos estaban en un Environment llamado `SUPABASE_VALIDATION_PROJECT_REF` y no en `roomly-validation-2` |
| 14 | Estructural en verde; el E2 falló antes de enviar nada: «E2E_MAILBOX_CONFIG no es un JSON válido» | Valor mal formado del secret; se creó de nuevo con un token nuevo de Mailtrap |

## Proyecto de validación P1: `roomly-validation-3`

Decisión de la Fase 3 (la misma que en la 2.8): un proyecto **nuevo y
vacío**. No se migra de forma incremental el proyecto anterior, `uwxb…`
(marca `roomly-validation-2`), que tiene el esquema de la Fase 2 y no se
toca. En la 2.8 tampoco se reparó `roomly-validation`, al que le faltaban
todas las migraciones de Fase 2.

| Parámetro | Valor |
|---|---|
| Nombre | `roomly-validation-3`: exclusivo para validación, **nunca** producción |
| Plan / región | Free / Frankfurt (`eu-central-1`), como los anteriores |
| Datos | Ninguno real. Solo usuarios de prueba, creados y borrados por las suites |
| Marca de identidad | `comment on database postgres is 'roomly-validation-3';` |
| Auth → Email | Activo, con **SMTP propio** (ver «E2 — requisitos del magic link») |
| Auth → registro público | **Desactivado** salvo durante la ventana del E2 real |
| Site URL | `http://localhost:3000` |
| Redirect URLs | Exactamente `http://localhost:3000/callback`, sin comodines |
| Google / Apple OAuth | No configurados (diferidos) |

La creación del proyecto, la configuración de Auth y SMTP y los secrets los
hace la persona dueña de la cuenta desde el dashboard. Claude no tiene
autorización para tocar Supabase remoto desde su entorno, y las credenciales
no se comparten por chat.

### Marca de identidad (F1): nueva y distinta de la anterior

Primer paso tras crear el proyecto, en su SQL Editor:

```sql
comment on database postgres is 'roomly-validation-3';
select shobj_description(d.oid, 'pg_database') from pg_database d where d.datname = 'postgres';
```

La segunda consulta debe devolver exactamente `roomly-validation-3`. Todo
punto de entrada comprueba esa marca **en la propia base de datos** antes de
hacer nada, y si falta o no coincide exactamente, aborta sin fallback:
- la guarda del workflow;
- la aplicación de migraciones;
- el preflight P0–P6;
- la suite SQL, dentro de cada sesión;
- la suite supabase-js;
- la preparación y la limpieza del E2.

Por qué una marca nueva en cada proyecto: la comparación es exacta, así que
unas credenciales de un proyecto anterior no pasan las guardas del nuevo:
- `roomly-validation` (Fase 1);
- `roomly-validation-2` (Fase 2.8, `uwxb…`). **Aislamiento de la Fase 3:**
  unos secrets coherentes que apunten a `uwxb…` no pasan la guarda, y la
  aplicación de migraciones, el preflight y la suite SQL abortan antes de
  hacer nada.

A la inversa, el código anterior exige su propia marca y no aceptaría el
proyecto nuevo. La seguridad no depende de quitar la marca de los proyectos
anteriores. Lo comprueban:
- `guard-selftest.sh`, con las dos marcas anteriores y con variantes
  (espacios, mayúsculas, `roomly-validation-30`);
- `preflight-selftest.sh` y `sql-suite-selftest.sh`, con
  `roomly-validation-2` en P0 y en cada sesión;
- `tests/unit/validation-infra.test.ts`, que además falla si
  `roomly-validation-2` aparece en el workflow, en `tests/supabase/` (salvo
  los auto-tests), en `tests/e2e/real/` o en la api-suite.

**Diagnóstico cuando la marca no coincide.** La guarda imprime una línea
con los 4 primeros caracteres del ref, el nombre de la base de datos
conectada, la marca encontrada (solo si es texto simple; si no, su
longitud) y el número de tablas en `public`. Sirve para saber a qué
proyecto apuntan unos secrets que GitHub no deja leer. Nunca imprime el ref
completo, la URL, la cadena de conexión, contraseñas ni claves (lo
comprueba `guard-selftest.sh`).

## Secrets: solo en el GitHub Environment `roomly-validation-3`

Todos los jobs del workflow declaran `environment: roomly-validation-3`. Los
secrets se crean en GitHub → Settings → Environments →
`roomly-validation-3`, **no** como secrets del repositorio. Se recomienda
exigir aprobación manual (*required reviewers*) en el Environment.

El Environment anterior, `roomly-validation-2`, conserva los secrets de
`uwxb…`. El workflow ya no lo usa y no se toca.

| Nombre | Tipo | De dónde sale | Clase |
|---|---|---|---|
| `SUPABASE_VALIDATION_PROJECT_REF` | secret | Project Settings → General → Project ID (20 caracteres) | Identificador (actúa de guarda) |
| `SUPABASE_VALIDATION_URL` | secret | `https://<ref>.supabase.co` | Pública |
| `SUPABASE_VALIDATION_ANON_KEY` | secret | Project Settings → API Keys → anon / publishable | Pública (RLS la limita) |
| `SUPABASE_VALIDATION_SERVICE_ROLE_KEY` | secret | Project Settings → API Keys → service_role / secret | **PRIVILEGIADA: se salta RLS** |
| `SUPABASE_VALIDATION_DB_URL` | secret | Connect → **Session pooler** (IPv4) | **PRIVILEGIADA: incluye la contraseña de la BD** |
| `E2E_EMAIL_TEMPLATE` | secret | Dirección del buzón de prueba con `{id}` en la parte local (p. ej. `buzon+{id}@dominio`) | Sensible (identifica el buzón) |
| `E2E_MAILBOX_CONFIG` | secret | Configuración opaca del buzón de prueba (la interpreta su adaptador) | **PRIVILEGIADA: acceso al buzón** |
| `E2E_MAILBOX_ADAPTER` | variable | Ruta del adaptador del buzón, dentro de `tests/e2e/` | No secreta |

Reglas:
- **Ninguna de estas va en Git, en el chat, en logs ni en archivos del repo.**
- **La clave privilegiada nunca lleva el prefijo `NEXT_PUBLIC_*`.** La app
  (jobs `auth-redirects` y `e2e-real`) solo recibe la URL y la clave pública.
- **Cada paso recibe únicamente los secrets que necesita.** En el E2 real,
  `service_role` solo llega a la preparación y a la limpieza, nunca a la app
  ni al proceso de Playwright. `tests/unit/validation-infra.test.ts` falla si
  eso cambia.
- **Los scripts no imprimen valores:** solo nombran las variables que
  faltan, y nada usa `set -x`. La dirección de prueba de cada ejecución se
  enmascara con `::add-mask::` antes de usarse.

## Cómo se ejecuta

El workflow `.github/workflows/supabase-validation.yml` es **manual**
(`workflow_dispatch`): nunca se lanza en push ni en PR. GitHub solo permite
lanzarlo cuando el archivo existe en la rama por defecto (`master`).

Entradas:
- `confirm_project`: hay que escribir `roomly-validation-3`.
- `apply_migrations`: `true` solo la primera vez, sobre el proyecto vacío.
- `run_e2e_real`: `true` solo cuando el registro está abierto y el buzón
  configurado (ver E2).
- `phase4_upgrade` (R8, desde la herramienta de la Fase 4): `none` por
  defecto; `dry_run` o `apply`, con `confirm_phase4_upgrade`. Ver «Fase 4:
  herramienta de actualización (R8)». No se combina con `apply_migrations` ni
  con `run_e2e_real`.

Orden de jobs (cada uno solo corre si el anterior pasa):

1. **guard**:
   - las entradas compatibles entre sí (`phase4-upgrade.sh --check-inputs`,
     sin conectar ni leer secrets);
   - confirmación explícita del proyecto;
   - secrets presentes;
   - URL y conexión de BD del mismo `PROJECT_REF`;
   - **marca de identidad leída del propio proyecto** (F1).
2. **migrate** (solo si `apply_migrations`): `tests/supabase/apply-migrations.sh`.
   - Aplica las migraciones de `supabase/migrations/` en orden (13 desde la
     Fase 4.1; 10 en el run 16) y después `supabase/seed.sql`, todo en **una
     transacción**.
   - Desde la Fase 4.1 (R1), la migración `20261016120000` crea Barcelona
     (con los valores del seed) y sus barrios oficiales, y el seed ya no
     falla al encontrarla (`on conflict (slug) do nothing`).
   - Se niega si `public.profiles` ya existe.
   - No se ejecuta con `phase4_upgrade` en `dry_run` ni en `apply`.
   - No usa `supabase db push`: el historial de migraciones de la CLI no se
     registra, algo aceptable en un proyecto desechable.
   - Cada migración nueva obliga a recrear un proyecto vacío (P1).
3. **preflight**: `tests/supabase/preflight.sql` (P0–P6, solo lectura de
   catálogo, sin tablas temporales). **Si falla, no se ejecuta ninguna suite.**
4. **sql-suite**: `tests/supabase/run-sql-suite.sh` ejecuta los archivos de
   `tests/db/` con los roles, dueños y `auth.uid()` reales, sin shim. Hoy son
   18 (`01`–`18`, 651 aserciones); en los runs 16, 18 y 19 eran 14 (305). El
   aislamiento se explica abajo.
5. **api-suite**: `npm run test:supabase`
   (`tests/integration/supabase-validation.test.ts`).
   - Prueba PR, CH, RO, RE, CRA, SVC, GC y AU2 vía supabase-js/PostgREST con
     JWT reales.
   - Desde la Fase 4.1, RO necesita los barrios oficiales de Barcelona (R1)
     en el proyecto: sin ellos, falla al empezar con un mensaje que nombra la
     migración `20261016120000`.
   - Lo primero que hace es ejecutar `tests/supabase/guard.sh`; sin la
     marca no crea ni borra nada.
6. **auth-redirects**: build + `next start` con la clave pública, y
   `tests/supabase/auth-redirects.sh` (AU3, AU5 sin sesión).
7. **e2e-real** (solo si `run_e2e_real`): el E2 descrito abajo.

### Suite SQL: una sesión y una transacción por archivo

`tests/supabase/sql-suite-lib.sh` (lo usa `run-sql-suite.sh`) abre **una
sesión de `psql` por archivo**. Cada sesión ejecuta, en orden:
1. `BEGIN`;
2. la comprobación de identidad (P0);
3. la comprobación de sesión limpia: rol de la sesión, sin
   `request.jwt.claims` y sin `roomly_test`;
4. `helpers.sql`;
5. el test;
6. `ROLLBACK`;
7. la comprobación de que el rol, los claims y `roomly_test` han
   desaparecido.

Al final, en otra sesión y solo leyendo, comprueba que no quedan
`roomly_test`, políticas `zz_test_*` ni usuarios `@test`.

- **El test 11 no se ha modificado.** Su `begin;`/`rollback;` propio se
  reescribe en el flujo (no en el archivo) a `savepoint roomly_file;` /
  `rollback to savepoint roomly_file;`. Así su `ROLLBACK` deshace solo su
  bloque, nunca la transacción del runner.
  - Antes, con una sola transacción para toda la suite, ese `ROLLBACK`
    deshacía los tests 01–10 y el esquema de helpers, y el test fallaba.
  - El `WARNING` que lo delataba («there is already a transaction in
    progress») lo ocultaba el filtro de salida.
  - Desde la Fase 2.9 (H4), `tests/db/12` usa la misma técnica (bloques
    `begin;`/`rollback;` con una política SELECT temporal `zz_test_*`), que
    el runner reescribe igual.
- **Fallo cerrado antes de conectar.** La suite aborta sin conectar si
  aparece cualquier otro control de transacción:
  - `COMMIT`, `END`, `ABORT`, `START TRANSACTION`, `SAVEPOINT`, `RELEASE`,
    `ROLLBACK TO`, `PREPARE`;
  - un `BEGIN`/`ROLLBACK` que no esté solo en su línea, o bloques anidados
    o sin cerrar;
  - `SET SESSION`/`SET TRANSACTION`;
  - meta-comandos de `psql`, **en cualquier posición de la línea**: psql
    reconoce una barra invertida como meta-comando también a mitad de línea
    (`select 1; \connect postgres`). Desde la tercera revisión de R8 se
    rechaza toda barra invertida fuera de cadenas, identificadores `"..."`,
    comentarios `--` y cuerpos `$$`, donde psql sí la trata como texto;
  - lo que el validador no sabe analizar con seguridad: `$tag$`,
    comentarios `/* */`, cadenas `E'...'` (sus escapes `\'`
    desincronizarían el análisis) o una sentencia final sin `;`;
  - lo que psql podría leer de otra manera que el validador: `\'` dentro de
    una cadena (con `standard_conforming_strings` desactivado no la
    cerraría) y `$$` pegado a un nombre (`x$$` es, para psql, parte del
    identificador, no el principio de un cuerpo `$$`, así que podía ocultar un
    `COMMIT` o un meta-comando).
  - Límite: no analiza la interpolación de variables de psql (`:nombre`).
    Sin meta-comandos no se pueden definir variables nuevas, y los seis
    archivos del flujo de R8 no contienen ninguna.
- **Qué sabe analizar el validador:** comentarios `--`, cadenas `'...'`,
  identificadores `"..."` y cuerpos `$$...$$`. Un `'`, `--` o `$$` dentro de
  un identificador entre comillas dobles no abre nada.
  - En la auditoría final de la 2.8, `select 1 as "it's";` desincronizaba el
    análisis y ocultaba un `COMMIT` posterior. Está corregido, y el autotest
    reproduce exactamente ese caso.
- **Los `WARNING` se muestran y hacen fallar la suite.** Las salidas de
  error de conexión no se imprimen, porque podrían contener el host.
- **Auto-test local:** `tests/supabase/sql-suite-selftest.sh` (89
  comprobaciones desde la tercera revisión de R8, antes 78; en CI).
  - Ejecuta el `run-sql-suite.sh` real, con la guarda, contra un PostgreSQL
    local con la marca, y obtiene las mismas aserciones que `run.sh` (651
    desde la carga de barrios de R1; 265 cuando se escribió).
  - Comprueba el rollback de un bloque, la ausencia de fugas de rol o GUC
    entre archivos, 31 formas de control de transacción rechazadas, un
    WARNING, un fallo a mitad de test y las marcas anteriores
    (`roomly-validation` y `roomly-validation-2`).
  - Caso D2: 16 combinaciones de identificadores `"..."` y cadenas `E'...'`
    que intentan ocultar un control, entre ellas el caso exacto de la
    auditoría; todas se rechazan antes de conectar. Además, comprueba que
    los identificadores legítimos con `'`, `--` o `$$` se aceptan y se
    ejecutan.
  - También ejecuta el test 11 sin reescribir, que falla con el WARNING
    visible.

### Preflight P0–P6: listas exactas

| Check | Qué exige |
|---|---|
| P0 | Marca `roomly-validation-3` exacta |
| P1 | 18 tablas en `public`, la función y el trigger de la migración de seguridad, y Barcelona activa. Desde la Fase 4.1, además: las restricciones de `rooms` de `20261015120000`, validadas (`chk_rooms_features_catalog`, `chk_rooms_features_unique`, `chk_rooms_total_roommates`, `chk_rooms_total_rooms`, `chk_rooms_publishable` y `fk_rooms_neighborhood_city`); la FK compuesta comparada por columnas; el catálogo exacto de las 12 características (R6), y, con R1 (`20261016120000`), exactamente los 73 barrios oficiales de Barcelona, comprobados por número y por una huella md5 de «slug\|nombre» |
| P2 | Mismo dueño para `is_conversation_participant` y `conversation_participants`, sin FORCE RLS, SECURITY DEFINER y `search_path` vacío |
| P3 | RLS en las 18 tablas y **exactamente estas 44 políticas** (37 hasta la Fase 4.0), comparadas por (tabla, política, comando) en los dos sentidos. No basta con contarlas (ver abajo). Desde la 4.0, además, cada política de escritura de `rooms`, `room_addresses` y `room_images` exige la cuenta activa (`deleted_at IS NULL`) |
| P4 | Permisos de columna de `profiles`, `reports` y `conversation_participants`, y EXECUTE de `is_conversation_participant`. Además, en `housing_preferences`: `anon` sin ningún privilegio; `authenticated` sin INSERT/UPDATE de tabla completa, con INSERT en exactamente 11 columnas (sin `updated_at`), UPDATE en exactamente 10 (sin `profile_id` ni `updated_at`), y SELECT y DELETE. Desde la Fase 3.1, en `compatibility_responses`: `anon` sin ningún privilegio de tabla ni de columna; `authenticated` solo con SELECT, sin INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES ni TRIGGER ni escritura de columna. Desde la Fase 4.1, en `rooms`: `authenticated` sin INSERT ni UPDATE de tabla completa, con exactamente las columnas del GRANT (INSERT sin `status`, `deleted_at`, fechas ni `approx_*`; UPDATE además sin `id` ni `owner_id`), y con SELECT y DELETE; `anon` sin escrituras y con SELECT; `service_role`, tabla completa |
| P5 | Equivalente SQL de los lints del Security Advisor |
| P6 | **Exactamente 13 triggers activos** en `public` (12 hasta la Fase 3.1, que añade `trg_compatibility_responses_integrity`). **Exactamente 11 funciones propias** (10 hasta la Fase 3.1, que añade `enforce_compatibility_responses_integrity()`), con su SECURITY DEFINER y `search_path`. EXECUTE revocado donde las migraciones lo revocan |

Las 44 políticas, por tabla (38 hasta la Fase 2.9, cuando H4 eliminó
`profiles_select_authenticated`; 37 hasta la Fase 4.0):

| Tabla | Políticas |
|---|---|
| `admin_action_logs` | `admin_action_logs_admin_only` (ALL) |
| `cities` | `cities_select_all` (SELECT), `cities_admin_write` (ALL) |
| `compatibility_responses` | `compatibility_responses_select_own` (SELECT, `to authenticated`; desde la Fase 3.1 sustituye a `compatibility_responses_own` FOR ALL) |
| `conversation_participants` | `participants_select_own_conversations` (SELECT), `participants_update_own` (UPDATE) |
| `conversations` | `conversations_select_participant` (SELECT) |
| `favorites` | `favorites_own` (ALL) |
| `housing_preferences` | `housing_preferences_select_own` (SELECT), `_insert_own` (INSERT), `_update_own` (UPDATE), `_delete_own` (DELETE) |
| `interests` | `interests_select_participant` (SELECT), `interests_insert_own` (INSERT), `interests_delete_own` (DELETE) |
| `matches` | `matches_select_participant` (SELECT) |
| `messages` | `messages_select_participant` (SELECT), `messages_insert_participant` (INSERT) |
| `neighborhoods` | `neighborhoods_select_all` (SELECT), `neighborhoods_admin_write` (ALL) |
| `notifications` | `notifications_own` (ALL) |
| `profiles` | `profiles_select_own_even_if_deleted` (SELECT), `profiles_update_own` (UPDATE), `profiles_insert_own` (INSERT), `profiles_admin_all` (ALL) |
| `reports` | `reports_insert_own` (INSERT), `reports_select_own` (SELECT), `reports_admin_all` (ALL) |
| `room_addresses` | `room_addresses_select_own` (SELECT), `_insert_own` (INSERT), `_update_own` (UPDATE), `_delete_own` (DELETE); desde la Fase 4.0 sustituyen a `room_addresses_owner_only` FOR ALL |
| `room_images` | `room_images_select` (SELECT), `room_images_insert_own` (INSERT), `_update_own` (UPDATE), `_delete_own` (DELETE); desde la Fase 4.0 sustituyen a `room_images_owner_write` FOR ALL |
| `rooms` | `rooms_select_active_public` (SELECT), `rooms_select_own` (SELECT), `rooms_insert_own` (INSERT), `rooms_update_own` (UPDATE), `rooms_delete_own` (DELETE), `rooms_admin_all` (ALL); desde la Fase 4.0 las tres de escritura sustituyen a `rooms_owner_write` FOR ALL |
| `universities` | `universities_select_all` (SELECT), `universities_admin_write` (ALL) |

**Por qué el preflight decía 35.** Se escribió en la Fase 1:
- `20260925120100` crea 35 políticas;
- `20260926120000`, `20260929120000` y `20260930140000` solo las
  sustituyen (`drop` + `create`), así que no cambian el total;
- `20260930130000` sustituye `housing_preferences_own` por cuatro
  políticas (38);
- `20261004120100` (Fase 2.9, H4) elimina `profiles_select_authenticated`
  (37);
- `20261007120000` (Fase 3.1) sustituye `compatibility_responses_own` por
  `compatibility_responses_select_own` (siguen 37);
- `20261013120000` (Fase 4.0) divide por comando las tres políticas FOR ALL
  de habitaciones: −3 +10 (44).

Nadie actualizó el preflight entonces. Además solo contaba, y no
comprobaba nada de la Fase 2.

**Aviso (Fase 4):**
- Desde la Fase 4.0 (`20261013120000`), el esquema esperado tiene 44
  políticas, y P3 exige exactamente esas.
- Desde la Fase 4.1, P1 exige además las restricciones de `rooms` de
  `20261015120000` y los 73 barrios oficiales de `20261016120000`, y P4 el
  GRANT por columnas de `rooms`.
- `roomly-validation-3` sigue con el esquema del run 16 (37 políticas, sin
  las migraciones de la Fase 4 ni barrios): el workflow no aplica
  migraciones a un esquema que ya existe.
- Un run actual con `apply_migrations=false` fallaría ya en P1 (P3 y P4
  también fallarían) y se omitirían los jobs posteriores: `sql-suite`, que
  depende del preflight, y `api-suite`, `auth-redirects` y `e2e-real`, que
  dependen de `sql-suite`.
- El preflight es de solo lectura (solo consulta el catálogo y los datos de
  referencia): no modifica el esquema ni los datos.
- Cómo validar en real las migraciones de la Fase 4 lo decide el
  propietario (R8). No se ha lanzado ningún run desde el 19.
- **Actualización (2026-10-21):** lo anterior describe el estado previo a
  R8. El `dry_run` (run 20) no cambió nada; el `apply` (run 21) aplicó las
  tres migraciones, y después el preflight vigente pasó como job propio, con
  44 políticas y los 73 barrios. Ver «Resultado: run 21».

**Verificación sin red:**
- `tests/unit/validation-infra.test.ts` deriva de las migraciones el
  conjunto final de políticas y triggers y lo compara con las listas del
  preflight.
- `tests/supabase/preflight-selftest.sh` (69 comprobaciones, en CI; 65 con
  la 4.1 antes de R1, 50 con la 4.0, 44 antes):
  - con el esquema actual pasan P0–P6;
  - cada una de 61 mutaciones falla en su check, y cada una se deshace
    (desde la Fase 3, también la marca `roomly-validation-2` en P0);
  - las mutaciones incluyen, entre otras, «misma cantidad, otra política
    (44 = 44)» y «vuelve `housing_preferences_own`»;
  - desde la Fase 3.1, otras 8 de `compatibility_responses`: vuelve la
    política FOR ALL, `anon` con SELECT, `authenticated` con INSERT, con
    UPDATE de `completed_at` o sin SELECT, falta el trigger, la función pasa
    a SECURITY DEFINER, y `authenticated` puede ejecutarla;
  - desde la Fase 4.0, otras 6 de habitaciones: vuelve `rooms_owner_write`,
    falta `room_addresses_select_own` y cuatro políticas de escritura sin la
    comprobación de cuenta activa (o con ella solo en WITH CHECK);
  - desde la Fase 4.1, otras 15: en P1, restricciones de `rooms` que faltan
    o están sin validar, la FK sobre otras columnas y otro catálogo de
    características; en P4, columnas de más o de menos en el GRANT de
    `rooms`, el GRANT de tabla completa, `anon` con escrituras y
    `service_role` sin la tabla completa;
  - con R1, otras 4 en P1: falta un barrio oficial, uno renombrado, su slug
    cambiado y un barrio de más en Barcelona.

## E2E: E1 local y E2 real, separados

| | E1 — local | E2 — real |
|---|---|---|
| Qué | La app real (`next build` + `next start`) contra el Supabase **simulado** `tests/e2e/support/mock-supabase.mjs` | La app real contra `roomly-validation-3`, con **email real** |
| Specs | `tests/e2e/local/*.spec.ts` | `tests/e2e/real/student-real.spec.ts` |
| Configuración | `playwright.config.ts` | `playwright.real.config.ts` |
| Comando | `npm run test:e2e` | `npm run test:e2e:real`, **solo** desde el job `e2e-real` |
| Red y secrets | Ninguno. Clave anon ficticia que solo acepta el mock | Secrets del Environment |
| Dónde corre | Local y CI (`e2e-local` en `ci.yml`) | Workflow manual |
| Artefactos | Report HTML si falla (datos ficticios) | **Ninguno**: sin trace, vídeo, capturas, report ni instantánea de página |

### E1 — qué simula el mock y qué no

El mock cubre solo lo que usa el flujo:
- **Auth:** `otp` (PKCE obligatorio; crea el usuario como con signups
  activos), `verify` (el enlace del email; el redirect permitido es
  exactamente `/callback`), `token` (`pkce`, comprobando el `code_verifier`
  S256 y un solo uso, y `refresh_token`), `user` y `logout` (global).
- **REST:** `profiles`, `housing_preferences`, `cities`, `universities` y
  `neighborhoods`, emulando las políticas, los GRANT de columnas, los
  triggers de las migraciones. Desde la Fase 2.9 (H4), `profiles` solo
  devuelve la fila propia; `profiles_admin_all` no se emula porque el mock
  nunca crea admins. Rechaza `select=*`.

No es Supabase: la base de datos real la cubren `tests/db` y el E2. Los
endpoints `/__test/*` hacen de buzón y de «servidor» (desactivar una
cuenta). Solo escucha en `127.0.0.1`.

### E2 — requisitos del magic link real

Flujo que recorre, sin atajos:

`/login` (formulario real) → `signInWithOtp` → email real → magic link →
`/auth/v1/verify` → `/callback?code=` (PKCE, mismo navegador) → onboarding →
`/perfil` → `/preferencias` → `/ajustes` → logout

No usa `generateLink`, `verifyOtp`, `token_hash` ni contraseñas, y
`/callback` sigue aceptando solo `?code=`. `generateLink` no envía
`code_challenge` (lo comprueba `node_modules/@supabase/auth-js`), así que
su enlace no puede pasar por `/callback`.

| Requisito | Qué hay que configurar en `roomly-validation-3` |
|---|---|
| Signup | «Allow new users to sign up» **activado solo durante la ventana del E2**. La preparación falla si está desactivado. La limpieza avisa (`::warning::` y resumen del job) si sigue abierto al terminar; cerrarlo es un paso manual (ver «Pendiente de decisión»). |
| Proveedor de correo | **SMTP propio** (Authentication → Emails → SMTP Settings). No se asume que el SMTP por defecto de Supabase baste: tiene límites de envío muy bajos y, según la documentación de Supabase, solo entrega a direcciones del equipo. Esto no se ha podido verificar sin red. |
| Enlaces sin reescribir | En el proveedor SMTP hay que **desactivar el seguimiento de clics y cualquier reescritura de enlaces** (*click tracking*, *link tracking*, *link branding*). El E2 valida el enlace tal como llega al buzón: solo lo abre si apunta al `/auth/v1/verify` del proyecto y su `redirect_to` es exactamente `<app>/callback`. Un enlace reescrito por el proveedor apuntaría a otro dominio y el E2 lo rechazaría, con razón: no se puede comprobar adónde lleva. |
| Buzón de prueba | Un buzón que reciba ese correo y se pueda leer **por API**. Proveedor elegido (2026-10-06): **Mailtrap Email Sandbox**, que da a la vez el SMTP (configurado en `uwxb…`) y la API del buzón, sin dominio propio y sin entregar a nadie real. |
| `emailRedirectTo` | El código lo fija como `${window.location.origin}/callback` (`components/auth/login-form.tsx`). En el workflow la app corre en `http://localhost:3000`, así que el resultado es `http://localhost:3000/callback`. Hay que usar siempre `localhost`, nunca `127.0.0.1`. |
| Allowlist | Site URL `http://localhost:3000` y Redirect URLs exactamente `http://localhost:3000/callback`. Lo comprueba AU2 en la api-suite. |
| Plantillas | Las de Supabase. Un usuario nuevo recibe «Confirm signup» y uno existente «Magic link»: las dos usan `{{ .ConfirmationURL }}`. |
| Límites | Límite de emails por hora e intervalo mínimo entre OTP: el E2 pide **un** email por ejecución y no reintenta. |
| Recuperar el enlace | El spec espera el email en el buzón (destinatario único por ejecución, 120 s como máximo). Solo acepta un enlace a `https://<ref>.supabase.co/auth/v1/verify` con `redirect_to` exactamente `<app>/callback`, y lo abre **en el mismo contexto del navegador**, donde está la cookie del `code_verifier`. |
| Dirección única | `E2E_EMAIL_TEMPLATE` con `{id}` = `e2e-<run_id>-<intento>` del workflow. |
| Limpieza | Ver abajo. |

**Adaptador del buzón.** `E2E_MAILBOX_ADAPTER` es la ruta de un módulo
**dentro de `tests/e2e/`** que exporta `createMailbox(env)`, con:
- `waitForMagicLink({ to, since, timeoutMs })`, que devuelve el enlace;
- `deleteMessages(to)`.

El adaptador lee su configuración de `E2E_MAILBOX_CONFIG`. El de Mailtrap es
`tests/e2e/real/mailboxes/mailtrap.mjs` (`E2E_MAILBOX_ADAPTER` =
`tests/e2e/real/mailboxes/mailtrap.mjs`), con `E2E_MAILBOX_CONFIG` como JSON
de una línea `{"accountId":"…","inboxId":"…","apiToken":"…"}`:
- `accountId` es opcional: si falta, el adaptador busca entre las cuentas
  del token la que tiene el sandbox;
- el token necesita permiso **Admin** solo sobre ese sandbox (leer y borrar);
- usa la API que usa el SDK oficial `mailtrap-nodejs`
  (`https://mailtrap.io/api/accounts/{a}/inboxes/{i}/messages…`, cabecera
  `Authorization: Bearer`), espera el email del destinatario de la
  ejecución, saca el primer enlace a `/auth/v1/verify` del HTML (o del
  texto) y nunca registra el token, el email ni el enlace;
- tests sin red en `tests/unit/mailtrap-mailbox.test.ts`.

Sin adaptador, el E2 falla al empezar con «E2E_MAILBOX_ADAPTER no está
definida». El adaptador simulado
(`tests/e2e/support/mock-mailbox.mjs`) solo sirve para ensayar el spec
contra el mock, y se niega a funcionar en GitHub Actions o contra una URL
que no sea `127.0.0.1`.

**Preparación y limpieza** (`tests/e2e/real/cleanup.mjs`, paso propio, con
`service_role`):
- **`before`:**
  1. pasa la guarda F1;
  2. comprueba en `/auth/v1/settings` que el email y el registro están
     activos;
  3. borra los restos de ejecuciones anteriores.
- **`after`** (`if: always()`, también si el E2 falla o se cancela):
  1. pasa la guarda F1;
  2. borra los usuarios de prueba; su perfil y sus preferencias caen en
     cascada (`profiles` → `auth.users` y `housing_preferences` →
     `profiles`, `ON DELETE CASCADE`);
  3. comprueba que no quedan usuarios, perfiles ni preferencias suyos;
  4. vacía los mensajes del buzón;
  5. **después, pase lo que pase en 2–4**, comprueba si el registro sigue
     abierto y lo avisa (`withSignupCheck` en `e2e-real-lib.mjs`). Si el
     borrado o el buzón fallan, el aviso sale igual y el paso termina con
     ese error original. Si no se pueden leer los ajustes, avisa de que hay
     que revisarlo a mano.
- **Qué usuarios puede borrar.** Solo direcciones que encajan **entera** en
  la plantilla, con `{id}` = `e2e-<n>-<n>`, y como mucho 10 de una vez. Si
  encuentra más, no borra nada.
- **Qué imprime.** Solo recuentos: nunca emails, ids, enlaces ni objetos de
  error de supabase-js.

**Qué hace el spec con los datos.** Los errores se reescriben sin email ni
URLs, y las comprobaciones de URL comparan solo la ruta.
`PLAYWRIGHT_NO_COPY_PROMPT` evita que `error-context.md` guarde el árbol
de la página, donde estaría el email escrito. `outputDir` no se conserva.

## Matriz de pruebas

| Grupo | Dónde | Qué demuestra |
|---|---|---|
| P0–P6 | `tests/supabase/preflight.sql` | Ver la tabla de arriba |
| SQL 01–18 | `tests/db/*` vía `run-sql-suite.sh` | Las 651 aserciones actuales de `tests/db` con los roles de Supabase: C1, C2, C3, H5, M2 (01–04), Fase 2.0 (05–06), onboarding y su escritura única de la 2.9 (07), cuentas eliminadas (08), perfil propio (09), preferencias (10), ownership aislado (11), ajustes (12), privacidad de `profiles`, H4 (13) y, desde la Fase 3.1, `compatibility_responses` (14: CR1–CR20, 40 aserciones). **Ejecutada en Supabase real hasta `14`: 305/305 en el run 16 (Fase 3), y en verde en los runs 18 y 19.** La Fase 4 añade `15` (habitaciones y cuentas desactivadas, 4.0, 75 aserciones), `16` (integridad y publicación, 4.1, 88), `17` (transiciones de `status`, R7, 160) y `18` (barrios oficiales, R1, 22). **Los 18 archivos, en real por primera vez en el run 21, después del `apply` de R8:** cada uno revertido, 651 líneas `ok -` en el log y la comprobación final sin restos. Hasta el run 21, `15`–`18` no se habían ejecutado en real |
| PR1–PR12 | api-suite | Perfiles: no `role=admin` (insert/update/upsert), no `deleted_at`, campos permitidos sí, `anon` sin acceso, asignación de admin solo con `service_role`, `is_admin()` por JWT. **PR8 registra el comportamiento real de `upsert()`** sin relajar permisos |
| CH1–CH11 | api-suite | A y B en conversación 1, C en conversación 2: aislamiento total de lectura/escritura, participantes visibles solo en las propias conversaciones, sin `42P17`, sin suplantar `sender_id`, `last_read_at` sí / `conversation_id` no, RPC de la función, sin INSERT de cliente en conversaciones/participantes/matches |
| RO1–RO9 | api-suite | Propietario crea un borrador, lo publica, lo edita y lo pausa; no pone ni saca de `removed` (desde la 4.1, el upsert de RO6 lo frena antes el GRANT); admin y `service_role` sí; `anon` no ve `removed`; dirección exacta solo para el propietario. Desde la 4.1, RO1 publica con un barrio oficial de Barcelona (R1) y la ocupación. **Con la 4.1, en real por primera vez en el run 21: RO1–RO9 en verde** (antes, sin ejecutar en real con la 4.1) |
| RE1–RE9 | api-suite | Reporte válido nace `pending`; ningún campo administrativo en el INSERT; no en nombre de otro; no autocierre; el denunciado no lo ve; el admin resuelve |
| CRA1–CRA6 | api-suite (Fase 3.1) | `compatibility_responses` por PostgREST: B lee su fila y C no; ningún JWT escribe (INSERT, UPDATE de `completed_at` o de versión, DELETE → `42501`); `anon` no lee; service_role completa una vez y después no cambia la fecha (S4), no baja de versión (S3) y sube completando (S5); con la cuenta eliminada ni service_role escribe. **Ejecutada en Supabase real en el run 16 (Fase 3): 6/6** |
| SVC1–SVC5 | api-suite (servicios del servidor) | `saveQuestionnaireAnswers` (`lib/services/compatibility.ts`) con el JWT real del usuario y service_role inyectado en `deps.adminClient`. SVC1: unas respuestas parciales de la v2 quedan como borrador de la versión 2, que se relee con la sesión del usuario. SVC2: con las 29 queda completado y se fija `completed_at`. SVC3: volver a guardarlo no cambia `completed_at`. SVC4: una fila v1 completada sube a la v2 en una sola escritura, con el UPDATE condicionado a la versión 1 (petición observada); se reutilizan las 21 respuestas comunes, desaparecen los ocho ids sustituidos y el trigger rechaza volver a la v1. SVC5: un id de la v1 o una respuesta fuera de escala → `validation`, sin pedir service_role ni escribir. **Ejecutada en Supabase real en el run 19: 6/6** (SVC1–SVC4 y los dos casos de SVC5) |
| GC1–GC4 | api-suite (servicios del servidor) | `getCandidates` (`lib/services/matching.ts`) con el JWT real de quien mira y service_role inyectado. GC1: aparece el candidato elegible. GC2: no aparecen quien mira, un test v1, un borrador v2, otra ciudad, una cuenta desactivada, un admin ni un onboarding incompleto; cada candidato falla un solo criterio. GC3: el DTO solo trae su lista blanca: la edad con una fecha fija, el presupuesto en escalones y la universidad leída con el JWT. GC4: la respuesta cruda de PostgREST, observada sin cambiarla, ya excluye esos casos con los filtros `!inner`, de versión y de test completado, antes de `isEligibleCandidate`. Solo se comprueban los ids propios, nunca totales. **Ejecutada en Supabase real en el run 19: 4/4** |
| AU2 | api-suite | La lista de redirects de Supabase Auth conserva `http://localhost:3000/callback` y no conserva destinos externos |
| AU3, AU5 (sin sesión) | `auth-redirects.sh` | El callback con código inválido y `next` malicioso redirige siempre dentro del origen; `/admin` sin sesión → `/login?next=%2Fadmin` |
| E2 (alta real) | job `e2e-real` | Registro por magic link con email real, `/callback` PKCE, onboarding (desde la Fase 3 termina en `/test`, que se abre sin service_role), `/perfil`, `/preferencias`, `/ajustes` y logout. **En verde en el run 18 (Fase 3), con el paso por `/test`** |
| AU6 (Google) | Fuera de alcance (diferido) | — |

Actores de la api-suite: A, B, C (chat), O (propietario), R (denunciante),
T (denunciado), D (admin, rol asignado con `service_role` en PR11) y, desde
SVC/GC, S (SVC1–SVC3 y SVC5), U (SVC4) y V (quien mira en GC). Cada uno con
su propio cliente y su JWT real.

`service_role`:
- prepara y limpia datos y ejecuta PR11 y la parte de servidor de RO7;
- en SVC/GC se inyecta en los dos servicios que lo usan en el servidor.

D6 = B no cambia: ese proceso es el runner, nunca la app ni el navegador.

Los siete candidatos de GC (E, Y, Z, M, X, K, N) son usuarios de prueba sin
sesión, con el mismo formato de email y la misma limpieza; nadie inicia
sesión con ellos.

**Limpieza de la api-suite (respeta H6).** Primero borra mensajes,
participantes y conversaciones; después reportes, logs, intereses, matches,
rooms y perfiles; solo al final `auth.admin.deleteUser`. Reglas:
- Solo toca usuarios cuyo email encaja **entero** en
  `^roomly-val-[0-9a-f]{8}-[a-z]@example\.com$` (F2).
- **Conversaciones:**
  - de la ejecución actual, solo las que la propia suite registró al
    crearlas (F3);
  - de ejecuciones anteriores interrumpidas, solo las que tienen
    **exclusivamente** participantes de prueba;
  - una conversación con cualquier participante ajeno nunca se toca.
- Solo toca filas creadas por usuarios de prueba (reportes por su
  `reporter_id`, intereses por `from_user_id`, matches con ambos usuarios
  de prueba...). Si algo de un usuario de prueba está enlazado a datos
  ajenos, no se borra: `deleteUser` falla y el teardown lo reporta.
- El teardown corre en `afterAll`, que Vitest ejecuta aunque fallen
  `beforeAll` o los tests. Si la guarda F1 no pasó, no toca nada.
- Desde SVC/GC:
  - todos los usuarios de prueba, actores y candidatos de GC, se apuntan para
    la limpieza nada más crearse y antes de iniciar sesión
    (`createTestUser`, en `tests/integration/test-users.ts`);
  - al final, el teardown cuenta las filas de `profiles`,
    `housing_preferences` y `compatibility_responses` de esos usuarios de
    prueba (las dos últimas caen en cascada desde `profiles`). Si queda
    alguna, falla de forma visible.

**Aserciones.**
- **Éxito** es exactamente `error === null` (F4).
- **Rechazos del trigger de moderación** (RO3 y RO5; también RO6 hasta la
  Fase 4.1, que ahora espera el `42501` del GRANT): exigen SQLSTATE `42501`
  **y** el mensaje propio del trigger, `room_moderation: …` (F5).
  PostgREST devuelve el mensaje de Postgres tal cual en `message`. Si en
  Supabase llegara distinto, el test falla de forma visible; nunca pasa en
  falso.
- **El resto de rechazos** se comprueban por SQLSTATE y número de filas, no
  por código HTTP.

**Auto-tests locales** (PostgreSQL local, nunca Supabase, también en CI,
`db-security`). Se ejecutan todos con
`PGHOST=... PGUSER=postgres npm run test:infra`.
- **`guard-selftest.sh` (28):** rechaza un proyecto ficticio, la URL de
  otro proyecto, secrets coherentes de otro proyecto, las marcas anteriores,
  marcas parecidas o una marca ausente, y comprueba que migraciones, P0 y
  suite SQL abortan antes de hacer nada. Desde la Fase 3 añade el
  aislamiento: unos secrets coherentes de un proyecto con la marca
  `roomly-validation-2` no pasan la guarda, y migraciones, P0 y suite SQL
  abortan sin crear nada.
- **`sql-suite-selftest.sh` (89 desde la tercera revisión de R8, antes 78) y `preflight-selftest.sh` (69 desde R1; 65
  con la 4.1, 50 con la 4.0, antes 44):** ver arriba. Desde la Fase 3.1, el
  primero cuenta los archivos de `tests/db` en vez de fijar el número.
- **`migration-upgrade-selftest.sh` (Fase 3.1):** aplica las migraciones de
  la Fase 2, inserta datos (incluidas filas de `compatibility_responses` con
  los DEFAULT antiguos), aplica después las migraciones nuevas y comprueba
  que los datos se conservan y quedan sujetos al trigger. Es la actualización
  incremental, solo en local. Desde la Fase 4, además:
  - 4.0 y 4.1: las habitaciones anteriores se conservan, y la 4.1 se detiene
    sin cambiar nada si alguna incumple sus reglas;
  - R1: un barrio oficial que ya existía conserva su id; con barrios
    incompatibles, la carga se detiene sin cambiar nada; aplicarla otra vez
    no cambia nada;
  - R1, instalación limpia: en otra base de datos, las migraciones solas
    crean Barcelona y sus 73 barrios, el seed se aplica después sin duplicar
    nada, y la carga repetida tampoco cambia nada.
- **`phase4-upgrade-selftest.sh` (R8, 76 comprobaciones):** la herramienta de
  la Fase 4 contra bases de datos locales temporales que clonan el esquema de
  la Fase 3. Ver «Fase 4: herramienta de actualización (R8)».

## Pendiente de decisión o de ejecución (no lo hace Claude)

Hechos (2026-10-06):
1. ✅ **Proveedor de SMTP y de buzón:** Mailtrap Email Sandbox, con su
   adaptador en `tests/e2e/real/mailboxes/mailtrap.mjs` (`ec7c3fc`).
2. ✅ **Proyecto y secrets:** `roomly-validation-2b` (`uwxb…`), con sus
   secrets en el Environment `roomly-validation-2`.
3. ✅ **Workflow:** run 13 (`apply_migrations=true`, `run_e2e_real=false`)
   y run 15 (`apply_migrations=false`, `run_e2e_real=true`).
4. ✅ **Registro cerrado** a mano después del E2. Automatizarlo exigiría un
   token de la Management API, que da acceso a toda la cuenta: no se ha
   añadido.

Pendiente operativo, aparte del cierre de la 2.8:

5. **Rotar las claves y pausar o borrar** `roomly-validation-2b` cuando no
   se use. Sigue activo, con el esquema, el seed y el SMTP de Mailtrap; el
   propietario lo tratará en una acción específica de seguridad y
   limpieza.

Desde la Fase 3 el workflow ya no puede ejecutarse contra este proyecto:
usa el Environment `roomly-validation-3` y la guarda exige esa marca, así
que `uwxb…` (`roomly-validation-2`) se rechaza antes de hacer nada.

### Fase 3: la próxima validación real (estructural en el run 16 y E2 en el run 18)

`uwxb…` tiene el esquema de la Fase 2 y **no se toca**. El código de la
Fase 3 ya no encaja con ese esquema:
- la suite SQL 14 y la api-suite CRA1–CRA6 necesitan
  `20261007120000_compatibility_responses_hardening.sql`;
- el preflight espera 13 triggers y 11 funciones.

Un run del workflow contra `uwxb…` no llega a ejecutarse: la guarda lo
rechaza por su marca. La estrategia aprobada es un **proyecto Supabase
nuevo y vacío**:
1. ✅ Proyecto `roomly-validation-3`, su marca, el GitHub Environment
   `roomly-validation-3` y sus secrets, creados por el propietario después
   del merge del PR #8.
2. ✅ Marca adaptada a `roomly-validation-3` (antes fijada a
   `roomly-validation-2`) en `tests/supabase/guard.sh`, `preflight.sql` P0,
   los selftests (con los casos de aislamiento de `roomly-validation-2`) y
   `supabase-validation.yml` (Environment de los 7 jobs y
   `confirm_project`).
3. ✅ Run 16 con `apply_migrations=true` desde cero: guarda, migraciones,
   P0–P6, SQL 01–14, api-suite y AU, todo en verde (ver «Resultado de la
   Fase 3»).
4. ✅ E2 en el proyecto nuevo: SMTP de Mailtrap, los secrets del E2 y una
   ventana de registro, con su propia autorización.
   - Run 17: fallo de configuración de `E2E_MAILBOX_CONFIG`, sin efectos.
   - Run 18: en verde (ver «Resultado de la Fase 3: E2 real»).
   - Los próximos runs contra `roomly-validation-3`, siempre con
     `apply_migrations=false`: el esquema ya existe y apply-migrations se
     negaría.
   - Después de cada ventana del E2, el propietario cierra el registro a mano.

Mientras tanto, en local: `test:db` (14 archivos entonces; 18 desde la
Fase 4.1), `test:infra` (incluida la actualización incremental), unitarios y
E1.

D6 = B: la app del workflow sigue sin service_role.

### Fase 4: validación real (R8)

**Actualización (2026-10-21): hecha en el run 21, salvo el E2.** R8 aplicó
las tres migraciones (`apply`, «apply correcto»), y después pasaron el
preflight vigente, la suite SQL `01`–`18` y la api-suite, con RO1–RO9 contra
la 4.1. El E2 se omitió y no está validado con la Fase 4. Ver «Resultado: run
21, `apply` de R8 (Fase 4)».

Texto anterior al run 21 (2026-10-16), sin cambios:

Lo decide el propietario; no se ha lanzado ningún run. Lo que tendría que
cubrir un run real de la Fase 4:
- las tres migraciones de la Fase 4: `20261013120000` (4.0),
  `20261015120000` (4.1) y `20261016120000` (R1, barrios oficiales);
- el preflight vigente (P1 con las restricciones de `rooms` y los 73 barrios,
  P3 con 44 políticas y P4 con el GRANT de `rooms`);
- la suite SQL `01`–`18` y la api-suite RO con la 4.1.

`roomly-validation-3` no tiene esas migraciones, y `apply_migrations` se
niega si `public.profiles` ya existe. En local, la actualización de un
esquema existente la prueba `migration-upgrade-selftest.sh`, y la instalación
limpia, `tests/db/run.sh` y ese mismo selftest.

### Fase 4: herramienta de actualización (R8)

**Probada en local (2026-10-17), ejecutada en `dry_run` real contra
`roomly-validation-3` el 2026-10-18 (run 20, sin efectos: la transacción
termina en ROLLBACK; su log se leyó el 2026-10-19) y en `apply` real el
2026-10-21 (run 21: «apply correcto», con las tres migraciones aplicadas;
ver «Run 21: `apply` real», abajo).** Cada ejecución, `dry_run` o `apply`,
necesita la autorización expresa del propietario. Por diseño, un segundo
`apply` contra `roomly-validation-3` no aplicaría nada: el preflight
congelado y R8-BASE rechazarían su estado de partida, que ya no es el de la
Fase 3.

#### Run 20: `dry_run` real (2026-10-18)

- GitHub Actions run #20, id `39176175018`, workflow_dispatch sobre
  `claude/phase4-r8-upgrade-tool` (head_sha `1543718`), entradas
  `confirm_project=roomly-validation-3`, `apply_migrations=false`,
  `run_e2e_real=false`, `phase4_upgrade=dry_run`, `confirm_phase4_upgrade`
  vacío. `completed/success`, ~23 s.
  URL: https://github.com/tackiie416/roomly/actions/runs/39176175018

Distinguiendo niveles de evidencia:

- **Demostrado por el estado del workflow y de sus jobs** (observado vía
  API de GitHub):
  - `guard` (Guarda de destino): `success`, con sus pasos «entradas
    compatibles (sin conectar)», «confirmación explícita del proyecto» y
    «secrets + marca de identidad roomly-validation-3» en `success`. Es
    decir, la guarda **sí conectó** al proyecto reactivado y **aceptó su
    marca** como `roomly-validation-3` (F1).
  - `phase4-upgrade` (R8): `success`, con su paso único —el flujo en una
    transacción que termina en ROLLBACK— en `success`.
  - `migrate`, `preflight`, `sql-suite`, `api-suite`, `auth-redirects` y
    `e2e-real`: `skipped`, como debe ser en `dry_run`.
- **Respaldado por líneas concretas del log** (leído el 2026-10-19 con el
  conector de GitHub, `get_job_logs`, jobs `117819202723` y `117819232941`;
  el 2026-10-18, `gh api` no seguía la redirección al almacenamiento de
  logs):
  - guarda: `phase4_upgrade=dry_run: combinación de entradas válida` y
    `guard: destino verificado como roomly-validation-3 (coherencia local +
    marca del proyecto)`;
  - paso de R8, en este orden:
    - los SHA-256 de los archivos fijados, verificados, y el flujo
      construido antes de conectar, con el SHA-256 del cuerpo común
      `0c9cadd0597a…`;
    - la guarda F1 otra vez, dentro del paso;
    - `ok - R8-MSG` al empezar;
    - el preflight congelado: P0–P6 en `ok`, con P3 «exactamente las 37
      políticas esperadas»;
    - `ok - R8-BASE`;
    - las tres secciones de migración, en orden y sin ningún aviso;
    - el preflight vigente: P0–P6 en `ok`, con P1 «Barcelona con sus 73
      barrios oficiales, restricciones de rooms de la Fase 4.1 presentes» y
      P3 «exactamente las 44 políticas esperadas y las escrituras de
      habitaciones exigen cuenta activa»;
    - `ok - R8-MSG` antes del ROLLBACK;
    - `== R8 · rollback hecho` y «RESULTADO: dry_run correcto»;
  - PostgreSQL 17.11 (línea `P1 info`). Ninguna línea `WARNING:`, `ERROR:`
    ni `FALLO` en el paso; el único `##[warning]` es el aviso genérico de
    GitHub sobre Node.js 20, en la limpieza del job;
  - también aparecen, en los dos preflights, las líneas informativas
    `P1 info`, `P2 info` (dueño `postgres`, `rolbypassrls=t`) y `P5 info`
    (vista `public_profile_previews`, H3, aceptada);
  - seis líneas `tail: … Broken pipe` al construir el flujo. Salen de
    `concat_verified`: `head -c` deja de leer cuando tiene sus bytes y `tail`
    recibe EPIPE. `cmp` compara la salida de `head`, así que la comprobación
    no se ve afectada: es ruido en el log (explicación por el código; no se
    ha reproducido aparte).
- **Lo que antes era una inferencia:** por la lógica de fallo cerrado, el
  éxito del paso ya implicaba que esas comprobaciones pasaron; ahora, además,
  el log las muestra.

**Lo que este run NO valida:**
- **`dry_run` no equivale a haber aplicado las migraciones.** La transacción
  se revierte; el proyecto sigue en el estado de la Fase 3 y no se escribió
  nada.
- **El `apply` no se ha autorizado ni ejecutado.** Requiere su propia
  autorización. (Actualización, 2026-10-21: se autorizó y se ejecutó
  después, en el run 21; ver «Run 21: `apply` real», abajo.)
- **Las suites que se omitieron no están validadas por este run:** el job
  `preflight` (P0–P6 como job propio), la suite SQL, la api-suite, AU3/AU5 y
  el E2 quedaron `skipped`. (El preflight vigente P0–P6 sí corre **dentro**
  de la transacción del `dry_run`, pero los jobs posteriores no se
  ejecutaron.)
- El runtime completo de Next.js con la clave real sigue sin validar.

Lo que el run 20 sí respalda en real (frente a lo solo probado en local),
con el estado de los jobs y con el log: la herramienta conecta al proyecto y
lee su marca; el estado de partida era el de la Fase 3; las tres migraciones
se aplican dentro de la transacción sin ningún WARNING; el resultado pasa el
preflight vigente, y todo se revierte.

#### Run 21: `apply` real (2026-10-21)

- GitHub Actions run #21, id `39521485133`, `workflow_dispatch` lanzado por
  el propietario sobre `claude/phase4-r8-upgrade-tool`, con head_sha
  `a8e50289991b508fcdc121918b96ad13ae4e557d` (el revisado, D8), entradas
  `phase4_upgrade=apply` y la frase de confirmación.
  URL: https://github.com/tackiie416/roomly/actions/runs/39521485133
- Job de R8 `118966158177`: `success`, de las 00:28:14 a las 00:28:35 UTC.
- Los demás jobs, la anomalía de las aprobaciones y la limpieza están en
  «Resultado: run 21, `apply` de R8 (Fase 4)», al principio.

**Respaldado por líneas del log** (leído el 2026-10-21 con el conector de
GitHub, `get_job_logs`), en este orden:
- `phase4-upgrade: modo apply; SHA-256 de las 3 migraciones, del estado de
  partida y del preflight vigente verificados`;
- `phase4-upgrade: flujo construido y comprobado antes de conectar (cuerpo
  común, SHA-256 0c9cadd0597a…)`: el mismo SHA-256 que en el run 20, como
  preveía el paso 2 del Procedimiento;
- la guarda F1 dentro del paso: `guard: destino verificado como
  roomly-validation-3 (coherencia local + marca del proyecto)`;
- **primera pasada** (`== R8 · transacción abierta (termina en rollback)`):
  - `ok - R8-MSG` al empezar;
  - el preflight congelado: P0–P6 en `ok`, con P1 «seed aplicado» y P3
    «exactamente las 37 políticas esperadas»;
  - `ok - R8-BASE`;
  - las tres secciones de migración, en orden y sin ningún aviso;
  - el preflight vigente: P0–P6 en `ok`, con P1 «Barcelona con sus 73
    barrios oficiales, restricciones de rooms de la Fase 4.1 presentes» y P3
    «exactamente las 44 políticas esperadas y las escrituras de habitaciones
    exigen cuenta activa»;
  - `ok - R8-MSG` antes del rollback y `== R8 · rollback hecho`;
- `phase4-upgrade: ensayo limpio; se repite el mismo cuerpo con COMMIT`;
- **segunda pasada** (`== R8 · transacción abierta (termina en commit)`): las
  mismas líneas en el mismo orden, con `ok - R8-MSG: … antes de commit` y
  `== R8 · commit hecho`;
- `RESULTADO: apply correcto: las 3 migraciones de la Fase 4 aplicadas y
  P0–P6 superadas antes del COMMIT`, la única línea `RESULTADO:`;
- PostgreSQL 17.11 (`P1 info`). Ninguna línea `WARNING:`, `ERROR:` ni `FALLO`
  en el paso. Aparecen las mismas líneas informativas `P1 info`, `P2 info` y
  `P5 info` que en el run 20, y cuatro líneas `tail: … Broken pipe` al
  construir el flujo (seis en el run 20): el mismo ruido de `concat_verified`
  descrito en el run 20.

**Clasificación** (paso 8, tabla de resultados): «apply correcto», es decir,
«las dos pasadas valen: la Fase 4 está aplicada». La segunda pasada llegó a
su última línea, sin ERROR ni WARNING y con los cinco avisos de éxito en
orden. No hizo falta «Recuperación».

**Lo que el run 21 añade al run 20:**
- la pasada con `COMMIT`, en real, completa hasta `== R8 · commit hecho`;
- el preflight vigente como job aparte, después del `COMMIT` y en otra
  sesión: P0–P6 superadas sobre el esquema ya confirmado, no solo dentro de
  la transacción;
- las suites posteriores, contra el esquema de la Fase 4.

**Sigue sin probarse en real:** una pérdida de red durante el `COMMIT` y las
señales de GitHub Actions al cancelar el job o agotar `timeout-minutes`. No
hicieron falta.

#### Funcionamiento, pruebas y precondiciones

`tests/supabase/phase4-upgrade.sh` aplica a `roomly-validation-3` solo las
tres migraciones de la Fase 4 sobre el esquema que dejaron los runs 16–19:
- `20261013120000_rooms_deleted_account_writes.sql` (4.0);
- `20261015120000_rooms_integrity_publication.sql` (4.1);
- `20261016120000_barcelona_neighborhoods.sql` (R1).

Pasos, con fallo cerrado en cada uno:
1. **Entradas** (sin conectar): `phase4_upgrade` es `dry_run` o `apply`;
   `apply_migrations` y `run_e2e_real` son `false`; `apply` exige
   `confirm_phase4_upgrade` igual a `aplicar-fase4-en-roomly-validation-3`.
   La guarda del workflow hace la misma comprobación antes de leer secrets.
2. **SHA-256** (sin conectar), fijados en el script, de seis archivos: las
   tres migraciones, los dos de estado de partida y el preflight vigente
   (`tests/supabase/preflight.sql`, `PHASE4_FINAL_PREFLIGHT`). Un archivo
   distinto aborta. El preflight congelado describe el estado de partida y el
   vigente, el de llegada: son dos entradas distintas. Para cambiar el del
   vigente, ver «Cambiar el SHA-256 del preflight vigente», más abajo.
3. **El flujo SQL, entero y antes de conectar:**
   - una copia de cada archivo fijado en un directorio temporal, con el
     SHA-256 comprobado otra vez sobre la copia. Un archivo que desaparece o
     cambia después de su comprobación aborta;
   - `roomly_sql_transform` sobre cada copia: sin control de transacciones
     (`COMMIT`, `ROLLBACK`, `BEGIN`, `SAVEPOINT`…), sin bloques
     `begin;`/`rollback;` y sin meta-comandos de psql en ninguna posición
     de la línea (también se rechazan `\'` dentro de una cadena y `$$`
     pegado a un nombre, que psql podría leer de otra manera);
   - un cuerpo común y, para cada pasada, un archivo con ese mismo cuerpo
     entre su cabecera y su final. Cada archivo se comprueba byte a byte
     (cada parte en su posición, y nada más). Su único `ROLLBACK` o `COMMIT`
     es la penúltima línea, seguida de `\echo '== R8 · <final> hecho'`;
   - en `dry_run` no se construye el archivo con `COMMIT`.

   Mientras hay conexión no se lee ningún archivo del repositorio. psql lee
   el archivo de la pasada en orden, así que el `ROLLBACK` o el `COMMIT` solo
   llegan si ha leído todo lo anterior. El log muestra el SHA-256 del cuerpo
   común.
4. **Guarda F1** (`guard.sh`): la URL y la conexión del mismo `PROJECT_REF`, y
   la marca `roomly-validation-3` leída en la propia base de datos.
5. **Una sola sesión y una sola transacción por pasada** (`lock_timeout` de
   10 s y `statement_timeout` de 5 min):
   - `set local client_min_messages = notice` y `R8-MSG`, que lo comprueba. Un
     valor más alto en el rol o en la base de datos (`warning` o `error`)
     ocultaría los WARNING;
   - el preflight congelado de la Fase 3
     (`tests/supabase/phase3-baseline-preflight.sql`, copia exacta del que
     pasó en el run 19: blob `7155e796…`);
   - `R8-BASE` (`tests/supabase/phase4-upgrade-baseline.sql`): ningún objeto
     de la 4.1, 0 habitaciones, direcciones, imágenes y barrios, 9 ciudades y
     7 universidades, sin usuarios de prueba ni `roomly_test`, y las tablas
     del rol que conecta;
   - las tres migraciones, en orden;
   - el preflight vigente (P0–P6);
   - `R8-MSG` otra vez: ninguna migración ha cambiado `client_min_messages`;
   - `ROLLBACK` en `dry_run`, `COMMIT` en `apply`.
   Un error corta psql (`ON_ERROR_STOP`) antes del final de la transacción.
6. **Una pasada solo vale** si cumple todo esto:
   - psql termina bien;
   - **llega a la última línea del flujo** (`== R8 · rollback hecho` o
     `== R8 · commit hecho`). psql solo la imprime si el `ROLLBACK` o el
     `COMMIT` terminaron bien;
   - no hay ninguna línea `ERROR:` del servidor, aunque psql termine con 0.
     Con `ON_ERROR_STOP`, un error corta psql: si algo lo desactivara, un
     `COMMIT` sobre la transacción abortada sería en realidad un `ROLLBACK`, y
     la línea final no probaría nada;
   - no hay WARNING;
   - aparecen los avisos de éxito esperados, en orden: `ok - R8-MSG`, el
     `ok - P6:` del preflight congelado, `ok - R8-BASE`, el `ok - P6:` del
     vigente y `ok - R8-MSG`. Solo cuentan las líneas NOTICE del servidor.

   Si falta cualquiera de esas cosas, la pasada falla aunque psql haya
   terminado bien.
7. **`apply` hace dos pasadas:** primero la de `dry_run`, que tiene que valer.
   Un WARNING (por ejemplo, «no privileges were granted») no es un error de
   Postgres y solo se ve al leer la salida, así que con una sola pasada
   llegaría al `COMMIT`. Solo después repite el mismo cuerpo con `COMMIT`.
8. **Resultados.** Qué hacer en cada caso está en «Recuperación», más abajo.

   | Final del log | Qué significa |
   |---|---|
   | «actualización de la Fase 4 NO ejecutada (nada aplicado)» | Se detuvo antes de conectar: entradas, SHA-256 o construcción del flujo |
   | Las líneas `ERROR:` de la guarda, sin ninguna `== R8 ·` ni `RESULTADO:` | La guarda rechazó el destino. Solo lee: nada aplicado |
   | «dry_run correcto» | Todo pasó dentro de la transacción y se revirtió |
   | «ensayo FALLIDO; nada confirmado» | Falló la primera pasada, que no contiene `COMMIT` |
   | «INTERRUMPIDO (señal …) durante …: nada confirmado» | Una señal antes de la pasada con `COMMIT` |
   | «apply correcto» | Las dos pasadas valen: la Fase 4 está aplicada |
   | «apply NO VÁLIDO» | El `COMMIT` se ejecutó (psql llegó a `== R8 · commit hecho`), pero la segunda pasada tuvo WARNING o le faltan avisos |
   | «apply NO CONFIRMADO… incierto» | La pasada con `COMMIT` falló, mostró una línea `ERROR:` aunque psql terminara con 0, o no llegó a su última línea. La actualización pudo quedar aplicada o no |
   | «apply INTERRUMPIDO (señal …) durante la pasada con COMMIT… incierto» | Una señal (cancelación o timeout del job) durante esa pasada |
   | Ninguna línea `RESULTADO:` en un `apply` (salvo el caso de la guarda) | El proceso murió sin poder escribirla, o el log se cortó: **incierto** |

   Es una sola transacción: o está entera o no está, nunca a medias.

**En el workflow** (job `phase4-upgrade`, entre la guarda y el preflight):
- recibe solo `SUPABASE_VALIDATION_PROJECT_REF` y `SUPABASE_VALIDATION_DB_URL`;
- `timeout-minutes: 20` (además de `statement_timeout` de 5 min y
  `lock_timeout` de 10 s dentro de la transacción). Un job cancelado o que
  agota ese tiempo: ver «Recuperación»;
- con `dry_run` no se ejecutan el preflight ni las suites: el ensayo ya pasó
  P0–P6 dentro de su transacción y la revirtió;
- con `apply`, después siguen el preflight, la suite SQL, la api-suite y
  AU3/AU5. El E2 y `migrate` quedan excluidos.
- No usa la CLI de Supabase (`db push`, `link`) ni variables de Netlify o
  Vercel. No imprime la cadena de conexión: solo NOTICE, WARNING y ERROR
  filtrados.

**Probado en local** (`phase4-upgrade-selftest.sh`, 76 comprobaciones, contra
PostgreSQL 16 local; el mismo selftest está en `test:infra`):
- entradas incompatibles, `dry_run` sin efectos, `apply` y el preflight
  vigente después, la segunda aplicación rechazada, otra marca o ninguna, y
  seis estados de partida inesperados;
- archivos con otro SHA-256: una migración, el preflight congelado y el
  vigente. Un psql falso en el `PATH` demuestra que no se llega a llamar a
  psql; su control comprueba que sí se le llama cuando las entradas y los
  archivos son correctos;
- el flujo, antes de conectar:
  - un archivo que desaparece o al que se le añade `commit;` justo después
    de su comprobación;
  - `commit;`, un bloque `begin;`/`rollback;` o `\connect` con el SHA-256 al
    día;
  - meta-comandos a mitad de línea (`\connect`, `\set ON_ERROR_STOP 0`, `\!`)
    y `$$` pegado a un nombre, con el SHA-256 al día. Como control, las barras
    invertidas de un comentario, una cadena, un identificador y un cuerpo
    `$$` se aceptan;
  - un `cat` que omite una parte sin dar error;
  - una línea `commit;` dentro de un cuerpo `$$`.

  Todos se rechazan sin llamar a psql;
- archivos retirados entre las dos pasadas: la segunda usa el mismo flujo
  completo. Una entrada cortada justo antes del `COMMIT` da «NO
  CONFIRMADO… incierto», y una cortada antes del `ROLLBACK`, «ensayo
  FALLIDO»;
- un error a mitad, y un preflight vigente que falla;
- un WARNING, también con `client_min_messages = error` en la base de datos,
  y una migración que sube `client_min_messages` (`FALLO R8-MSG`);
- un aviso de éxito que falta (el P6 del vigente);
- fallos solo en la pasada con `COMMIT`: un error, y la conexión perdida
  durante el propio `COMMIT` (un trigger diferido que termina su backend).
  Los dos dan «NO CONFIRMADO… incierto», nunca «nada aplicado»;
- una línea `ERROR:` con psql terminado en 0 (un psql envoltorio desactiva
  `ON_ERROR_STOP` e inserta un error justo antes del final): en la pasada con
  `COMMIT` da «NO CONFIRMADO… incierto», y en la de ensayo, «ensayo
  FALLIDO». Como control, el texto «ERROR:» dentro de un aviso o de un
  resultado no hace fallar la pasada;
- «apply NO VÁLIDO», con un WARNING o un aviso que falta solo en la segunda
  pasada: el `COMMIT` se ejecutó (73 barrios) y el script sale con error;
- señales al grupo de procesos, como al cancelar un job: SIGINT durante la
  pasada con `COMMIT` da «INTERRUMPIDO… incierto», y SIGTERM durante el
  ensayo, «nada confirmado»;
- cada resultado tiene una sola línea `RESULTADO:`, la suya;
- ninguna salida contiene la contraseña ni la cadena de conexión.

Mutaciones: 14/14 de la versión inicial, 5/5 de la primera ronda de
correcciones, 12/12 de la segunda y 6/6 de la tercera (M1 y L1;
`docs/TESTING.md`). Además, cada selftest se ejecutó contra el código
anterior: el de 67 contra el script de `2278cf7` falla en 16 comprobaciones,
y el de 76 contra el validador y el script de `3e4cdee`, en 9.
`sql-suite-selftest` (89), contra el validador de `3e4cdee`, falla en 10.

**En la CI:** el selftest corre en el job `db-security` de la CI del PR.
- CI #64, sobre `2278cf7` (la versión con 45 comprobaciones en local),
  terminó en verde, con el paso del selftest en verde.
- El log de ese job no se ha podido leer desde el entorno de Claude: el
  cliente de GitHub no sigue la redirección al almacenamiento de logs. Por
  eso el número de comprobaciones que se ejecutaron en la CI **no está
  verificado directamente**. Solo consta que el paso terminó bien, y el
  selftest sale con error si falla cualquiera de ellas.
- La versión con 67 (`3e4cdee`): CI #65 en verde, con el mismo límite.
- Para las versiones posteriores, ver la CI de su commit, con el mismo
  límite.

**Lo que no se había podido probar en local** (y cómo lo tocó el run 20, con
su log leído el 2026-10-19):
- Supabase real con PostgreSQL 17: el selftest usa PostgreSQL 16 y un rol
  **superusuario**, así que no reproduce los avisos de privilegios de un rol
  no superusuario como el de Supabase. En el run 20 el paso de R8 corrió
  contra el Supabase real (el log muestra PostgreSQL 17.11) sin ninguna línea
  `WARNING:`: en real, las tres migraciones no dieron avisos de privilegios.
- Que el estado real de `roomly-validation-3` sea el esperado: lo comprueba
  la herramienta al ejecutarse (R8-BASE + preflight congelado de la Fase 3).
  En el run 20, el log muestra el preflight congelado en `ok` (37 políticas)
  y `ok - R8-BASE`: el estado de partida era el de la Fase 3.
- El Session pooler de Supabase, que debe mantener la sesión durante toda la
  transacción (modo sesión): en el run 20 la transacción completa corrió en
  una sola sesión de psql, del primer `ok - R8-MSG` a `== R8 · rollback
  hecho`. El modo del pooler no aparece en el log; lo respalda que el flujo
  llegara entero a su final.
- Una pérdida de red real durante el `COMMIT`: en local se simula con un
  trigger diferido que termina su propio backend, que no es lo mismo que un
  corte del pooler o de la red.
- `client_min_messages` en Supabase: el log del run 20 muestra los dos
  `ok - R8-MSG` y los cinco avisos de éxito esperados, en orden: llegan a
  psql a través del pooler.
- Las señales de GitHub Actions al cancelar un job o agotar
  `timeout-minutes`: qué señales envía y con qué margen no se ha comprobado.
  En local se envían SIGINT y SIGTERM al grupo de procesos. Un SIGKILL no se
  puede capturar y no deja línea `RESULTADO:`.

El run 21 (`apply`, 2026-10-21) repitió en real esas observaciones en sus dos
pasadas: PostgreSQL 17.11, ningún WARNING, los avisos de éxito en orden y las
dos pasadas completas hasta su última línea, la segunda con `COMMIT`. La
pérdida de red durante el `COMMIT` y las señales de GitHub Actions siguen sin
probarse en real.

**Incertidumbres antes de ejecutar** (las resuelve el propietario):

Registro de antes del run 21, con notas de actualización donde algo cambió.
Las decisiones D1–D8 del propietario (2026-10-19, 23:59 UTC; el 20 en hora
peninsular) están en `PROGRESS.md`, sesión 58. Lo que sigue abierto está en
«Pendientes después del run 21», abajo.

- **Reglas del Environment `roomly-validation-3`:** comprobadas por el
  propietario el 2026-10-18 (la API de Environments sigue sin ser accesible
  desde el entorno de Claude; esto lo verificó él en la UI): «Deployment
  branches and tags» = **No restriction** (cualquier rama puede desplegar),
  **sin required reviewers**, y los cinco secretos presentes en el Environment
  (`SUPABASE_VALIDATION_PROJECT_REF`, `_DB_URL`, `_URL`, `_ANON_KEY`,
  `_SERVICE_ROLE_KEY`).
  - **Después (D4, opción B, 2026-10-19, 23:59 UTC):** limitar las ramas a
    `claude/phase4-r8-upgrade-tool`, sin `master`, y exigir la aprobación del
    propietario, con «Prevent self-review» desactivado. El propietario
    confirmó el 2026-10-21, antes del run 21, que lo había aplicado.
  - **En el run 21 no hubo ninguna aprobación** (ver «Resultado: run 21»):
    D4 no fue efectiva, y la causa está sin determinar.
- **`workflow_dispatch` desde una rama distinta de `master` con entradas
  nuevas:** resuelto. El 2026-10-18 el propietario confirmó en el formulario
  (rama `claude/phase4-r8-upgrade-tool`) que aparecen las cinco entradas,
  incluida `phase4_upgrade` con `dry_run`, y el run 20 se lanzó desde la rama
  con esas entradas. El workflow existe en `master` (requisito para que
  `workflow_dispatch` aparezca), pero las entradas de R8 solo están en la
  rama; aun así GitHub las ofreció al elegirla.
- **Deploy Previews de Netlify (sitio `lovely-tulumba-009360`): no
  bloqueante según la comprobación actual (2026-10-19).** No es una garantía
  permanente ni dice nada de Vercel. El run 20 se lanzó antes de esta
  comprobación (el `dry_run` termina en ROLLBACK y no escribe nada).
  - **Observado por el propietario en el panel de Netlify** y comunicado a
    Claude, que no tiene acceso a Netlify (ni conector, ni CLI, ni
    credenciales):
    - las variables de entorno del proyecto están vacías, en todos los
      contextos;
    - no hay extensiones instaladas ni asociadas;
    - las variables compartidas del equipo no están disponibles en el plan
      actual (información comunicada, no una inspección independiente);
    - rama de producción `master`; Branch deploys, solo `master`; Deploy
      Previews, para los PR contra `master`.
  - **Comprobado por Claude:**
    - en el repositorio: no hay URLs de Supabase en el código, ni
      `netlify.toml`, ni archivos `.env` que Next.js cargue en el build
      (`.env.example` no se carga automáticamente). `lib/env.ts` exige
      `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_ANON_KEY`, sin
      valores por defecto;
    - en la API de GitHub: estados `deploy-preview` de ese sitio en los PR
      #20–#26.
  - **Inferencia:** con la configuración observada, los previews no tienen un
    destino de Supabase configurado. Las peticiones que necesitan esas
    variables fallan en la validación del entorno (`getPublicEnv()`, que
    también llama `proxy.ts`) antes de llegar a ningún proyecto. El build no
    las necesita, así que un preview puede salir «ready» igualmente.
  - **Antes del `apply`:** volver a comprobar que las variables siguen
    ausentes. Se siguen construyendo previews para cada PR contra `master`.
- **Vercel: no bloqueante según la comprobación actual (2026-10-19).** **No
  está verificado:** Claude no tiene acceso al panel de Vercel (ni conector,
  ni CLI, ni credenciales) y nadie lo ha inspeccionado. Hay que revisar esta
  clasificación antes de cualquier `apply` si aparece una integración o un
  despliegue nuevos.
  - **Comunicado por el propietario:** Vercel no aparece en *Installed GitHub
    Apps* ni en *Authorized OAuth Apps* de su cuenta de GitHub, y no recuerda
    haber creado una cuenta de Vercel.
  - **Comprobado por Claude:**
    - en el repositorio: no hay configuración de Vercel (`vercel.json`,
      `.vercel`, dependencias `@vercel/*` ni menciones en los workflows) ni
      URLs de Supabase en el código. `lib/env.ts` exige
      `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_ANON_KEY`, sin
      valores por defecto. La documentación presenta Vercel como hosting
      previsto, no como algo configurado;
    - en la API de GitHub: ningún deployment, estado, check ni comentario de
      Vercel. Los deployments son solo de los Environments
      `roomly-validation-2` y `roomly-validation-3`, y el único bot que
      comenta es `netlify[bot]`. Las rutas de GitHub Apps instaladas y de
      webhooks del repositorio no son accesibles desde el entorno de Claude.
  - **Inferencia:** no hay evidencia actual de que el repositorio esté
    conectado a Vercel mediante la cuenta de GitHub examinada.
  - **Sin poder verificar:** no se ha accedido al panel de Vercel. No se
    descartan una cuenta independiente, un despliegue manual con la CLI ni un
    tercero que despliegue el repositorio (público) desde su propia cuenta.
    Que la app de GitHub no aparezca no demuestra que no haya despliegues de
    esos tipos.
- **Auth y usuarios de `roomly-validation-3`: verificado por el propietario
  (2026-10-19).** Claude no lo ha observado: no tiene acceso a Supabase. Es
  el estado de esa fecha.
  - **Observado por el propietario en el panel de Supabase:**
    - identidad y estado: hay un único proyecto de validación llamado
      `roomly-validation-3`, activo, en el plan Free y en la región de
      Frankfurt; su referencia coincide con la del registro privado del
      propietario;
    - Auth: el registro público de usuarios nuevos está desactivado y los
      accesos anónimos también. El único proveedor habilitado es Email
      (permite iniciar sesión por email; no reabre el registro, que es otro
      ajuste). No hay hooks, proveedores de terceros ni SSO. El correo sale
      por el SMTP sandbox de Mailtrap;
    - usuarios: **0**, así que no hay ninguno que clasificar ni limpiar;
    - URL Configuration: Site URL `http://localhost:3000` y una única Redirect
      URL permitida, `http://localhost:3000/callback`;
    - integraciones: ninguna configurada en el proyecto. No dice nada de
      servicios externos que no se han inspeccionado.
  - **Contrastado por Claude:** en el log del run 20, la guarda aceptó la
    marca `roomly-validation-3` en la base de datos a la que apuntan los
    secrets (ver «Run 20», arriba). Esa línea prueba la marca, no por sí sola
    que sea el proyecto que el propietario vio en el panel; la coincidencia
    de la referencia la ha comprobado él.
  - **Inferencia, no ejecutada:** esta configuración es compatible con las
    suites que corren después del `apply`. La api-suite crea sus usuarios con
    service_role y no necesita el registro abierto, y AU2 comprueba esa lista
    de redirecciones. Desde el run 19 no se ha ejecutado ninguna suite, y el
    `apply` no se ha autorizado.
  - **Actualización (2026-10-21):** el propietario confirmó otra vez, antes
    del run 21, el proyecto activo, el registro cerrado, 0 usuarios y la URL
    Configuration sin cambios. En el run 21, la api-suite (con AU2) y AU3/AU5
    pasaron en verde con esa configuración. Los usuarios después del run no
    se han comprobado de forma independiente.
- **GitHub (secrets, accesos y protecciones): verificado por el propietario
  (2026-10-19).** Claude no ha visto esos paneles: desde su entorno, las rutas
  de la API de Environments, secrets y variables devuelven HTTP 403 a través
  del proxy.
  - **Observado por el propietario:**
    - los cinco secrets requeridos (`SUPABASE_VALIDATION_PROJECT_REF`,
      `_DB_URL`, `_URL`, `_ANON_KEY` y `_SERVICE_ROLE_KEY`) están en el
      Environment `roomly-validation-3`, junto con `E2E_EMAIL_TEMPLATE` y
      `E2E_MAILBOX_CONFIG`; todos aparecen actualizados «last week» (fecha
      relativa de GitHub);
    - no hay secrets ni variables a nivel de repositorio, así que no hay
      duplicados, y no hay secrets de organización aplicables;
    - el Environment no tiene reglas de ramas («No restriction») ni required
      reviewers. Es la configuración observada, no una prueba de que esos
      controles sobren. (Después: D4, opción B, no efectiva en el run 21;
      ver la primera entrada de esta lista.)
    - el único colaborador es el propietario; no hay invitaciones pendientes
      ni deploy keys;
    - no hay protecciones de rama ni rulesets;
    - apps con acceso al repositorio: Claude (con escritura; la usa esta
      sesión, que solo publica con autorización expresa), Netlify y
      `lovable.dev` (ver «Lovable», abajo).
  - **Comprobado por Claude:**
    - los cinco nombres coinciden con los que usan el workflow y
      `docs/ENVIRONMENT.md`;
    - en el log del run 20 (2026-10-18 23:21 UTC), los cinco aparecen como
      `***` en la guarda. La guarda comprobó el formato del ref, que la URL y
      la conexión de BD corresponden a ese ref y que la BD lleva la marca
      `roomly-validation-3`. De `_ANON_KEY` y `_SERVICE_ROLE_KEY` solo
      comprueba que no estén vacías. El log no indica de qué ámbito sale cada
      valor;
    - en el CI #67 (`pull_request`, 2026-10-19), el paso `npm run build`
      recibe `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_ANON_KEY`
      vacías: no hay secrets de repositorio con esos nombres;
    - en la API de GitHub: el repositorio es de una cuenta personal
      (`owner.type = User`), y ni `master` ni las ramas de los PR #26 y #27
      tienen protección ni rulesets.
  - **Inferencia:** ningún secret se ha actualizado después del run 20 (GitHub
    mostraría «yesterday» o «hours ago»), así que los valores actuales son los
    que usó ese run. (Superada: por D7, el propietario volvió a copiar
    `_ANON_KEY` y `_SERVICE_ROLE_KEY` del proyecto antes del run 21.)
  - **Sin poder verificar con metadatos:** que `_ANON_KEY` y
    `_SERVICE_ROLE_KEY` correspondan al proyecto. Solo lo prueba la
    api-suite, que corre después del COMMIT del `apply`.
    - **Run 21:** la api-suite pasó 62/62. Usa la clave anon para los
      clientes con JWT y service_role para preparar y limpiar datos y en
      SVC/GC. Inferencia: las dos claves corresponden al proyecto.
- **Lovable (`lovable.dev`): sin acceso a `roomly` según la comprobación del
  propietario; no bloqueante según el estado comunicado (2026-10-19).**
  - **Observado por el propietario:** la app de GitHub `lovable.dev` tenía
    acceso a todos los repositorios, con *Contents: read and write*, y había
    un proyecto de Lovable conectado a `roomly`, sin Supabase conectado y sin
    publicar. El propietario desinstaló o suspendió la app en GitHub. Lovable
    no aparece autorizado en la organización de Supabase.
  - **Comprobado por Claude:** en el repositorio no hay ramas, commits ni
    autores de Lovable; todas las ramas remotas son `claude/*` o `master`.
  - **Limitación:** Claude no ha visto la acción ni esos paneles. Una app
    suspendida se puede reactivar. Si Lovable recupera el acceso a `roomly` o
    se autoriza en Supabase, hay que repetir la comprobación antes de
    cualquier `apply`.
- **Permisos de la app de Netlify en GitHub (2026-10-19): no bloqueante según
  los permisos declarados y la comprobación actual; alcance y configuración
  efectivos de la instalación no verificados directamente.** No es una
  garantía permanente.
  - **Observado directamente por la API:** los *check runs* que publica
    Netlify llevan adjunto un objeto `app` (app `Netlify`, de la
    organización `netlify`, actualizada el 2025-07-17) con estos permisos
    declarados. Se leyeron en los del head del PR #26:
    - `contents: read` y `metadata: read`;
    - `checks: write`, `statuses: write`, `pull_requests: write` e
      `issues: write`;
    - `emails: read`.

    No declara permisos de workflows, administración, secrets, Environments
    ni Actions, ni un permiso explícito de deployments. La app ha publicado
    checks, estados y comentarios en `roomly`; lo más reciente, en el PR #26,
    el 2026-10-16 a las 19:58 UTC.
  - **Comunicado por el propietario:** Netlify aparece entre las apps con
    acceso al repositorio (revisión de accesos del 2026-10-19, arriba).
  - **Inferencia:** como la app no declara `contents: write` ni permiso de
    workflows, ese conjunto declarado no le da las capacidades necesarias para
    modificar el código ni los workflows del repositorio. Los permisos de
    escritura que sí declara (checks, estados, issues y pull requests) sirven
    para publicar resultados, comentar y editar PR; no son escritura de
    código.
  - **Sin verificar en la instalación:** la página *Configure* no se ha podido
    inspeccionar (las rutas de instalaciones de la API no son accesibles desde
    el entorno de Claude, y eso no demuestra que falten permisos). Quedan sin
    verificar:
    - si la instalación cubre todos los repositorios o solo algunos;
    - quién instaló o autorizó la app;
    - si hay solicitudes de permisos nuevos pendientes;
    - la lista exacta de permisos concedidos a esa instalación.
- **Sin comprobar todavía** (ninguna se da por resuelta por analogía con las
  demás):
  - opcional y de bajo riesgo: revisar la página *Configure* de la
    instalación de Netlify (arriba). Sería la verificación directa de la
    instalación, que hoy no existe;
  - justo antes de cualquier ejecución futura:
    - que no haya ejecuciones activas ni en cola (solo se ha comprobado en
      un momento puntual);
    - que la cabeza de la rama sea el commit revisado, porque no hay
      protección de rama;
    - que el proyecto siga activo, el registro siga cerrado y siga habiendo
      0 usuarios;
    - que ningún despliegue conectado use `roomly-validation-3`: volver a
      revisar Netlify, Vercel, las previews, Lovable y los entornos locales.
      Netlify y Vercel son no bloqueantes según la comprobación actual, y los
      entornos locales no se han revisado;
  - las decisiones del propietario:
    - mantener el Environment sin reglas de ramas ni required reviewers, o
      añadir controles;
    - la licencia y la atribución del conjunto oficial de barrios;
    - el reconocimiento expreso de que no hay una vía de reversión sencilla
      para las migraciones;
    - congelar las migraciones del PR #26 para R8;
    - quién revisará el log del `apply` y documentará su resultado.
  - **Cómo quedó antes del run 21** (sin cambiar la lista de arriba):
    - las decisiones las tomó el propietario el 2026-10-19, a las 23:59 UTC
      (D1–D8, en `PROGRESS.md`, sesión 58). D6: la revisión de *Configure*
      de Netlify no es necesaria ahora, así que no se ha hecho;
    - el 2026-10-21, justo antes del run, Claude comprobó directamente la
      cabeza remota (`a8e5028`), la CI en verde, que no había ejecuciones
      activas ni en cola, los archivos fijados y la frase de confirmación;
    - el propietario confirmó el proyecto activo, el registro cerrado, 0
      usuarios, la URL Configuration sin cambios, el aislamiento (Netlify,
      Vercel, Lovable, previews y entornos locales) y su disponibilidad.
      Claude no lo observó.

**Pendientes después del run 21** (2026-10-21; ninguno lo hace Claude sin
autorización):
1. **Aprobaciones del Environment:** revisar, solo mirando, por qué no hubo
   ninguna en el run 21, y decidir si se corrige la opción B de D4 o se
   vuelve a la configuración anterior. Hay que resolverlo antes de cualquier
   otro run contra `roomly-validation-3`.
2. **Limpieza:** la comprobación independiente en el panel de Supabase (ver
   «Resultado: run 21»).
3. **E2 con la Fase 4:** sin ejecutar. Necesita su propia autorización y
   abrir el registro durante la ventana del E2.
4. **Runtime completo de Next.js con la clave real:** sigue pendiente de
   staging; el run 21 no lo cubre.
5. **PR #26 y #27:** su revisión y su merge, por este orden. La congelación
   de D3 sigue vigente hasta esa decisión.
6. **Runs nuevos:** ninguno desde `master` contra este proyecto sin revisar
   antes qué preflight y qué suite le corresponden. Antes de cualquier run,
   repetir las comprobaciones previas.
7. Aparte, sin relación con R8: el aviso de `npm audit` (9 vulnerabilidades
   altas) en `npm ci`.

**Procedimiento (el `dry_run` se ejecutó en el run 20 y el `apply`, en el
run 21):**
1. Revisar las incertidumbres de arriba.
2. `dry_run`: `confirm_project=roomly-validation-3`, `apply_migrations=false`,
   `run_e2e_real=false`, `phase4_upgrade=dry_run`. **Ejecutado en el run 20
   (2026-10-18), `completed/success`, y su log leído el 2026-10-19:** las dos
   líneas `ok - R8-MSG`, `ok - R8-BASE`, los dos `ok - P6:`, ningún WARNING y
   «dry_run correcto» (ver «Run 20», arriba). El cuerpo común no depende del
   modo: si el head no cambia, el `apply` debería mostrar el mismo SHA-256
   (`0c9cadd0597a…`).
3. Con otra autorización (concedida por el propietario el 2026-10-21),
   `apply`, con `confirm_phase4_upgrade`. Después corren el preflight y las
   suites; el E2 no. Si no termina en «apply correcto», no se repite:
   «Recuperación». **Ejecutado en el run 21 (2026-10-21), lanzado por el
   propietario:** «apply correcto», con el mismo SHA-256 del cuerpo común
   (`0c9cadd0597a…`), y el preflight y las suites en verde (ver «Run 21»,
   arriba). Sin las pausas de aprobación previstas: ver la anomalía en
   «Resultado: run 21».
4. Comprobar la limpieza y documentar el run. **Documentado el 2026-10-21
   (`PROGRESS.md`, sesión 58). La limpieza, pendiente de una comprobación
   independiente.**

#### Recuperación

Si un `apply` no termina en «apply correcto», **no se repite `apply`**, ni
automáticamente ni a mano, hasta conocer el estado. Cada ejecución de las de
abajo necesita su propia autorización.

**Interrupciones.** Si el job se cancela o agota `timeout-minutes: 20`, GitHub
Actions detiene el proceso.
- Si el script recibe la señal (SIGINT, SIGTERM o SIGHUP), escribe su línea
  `RESULTADO:` según la etapa: «nada confirmado» si la pasada con `COMMIT` no
  había empezado, «incierto» si sí.
- Si muere sin poder escribirla (SIGKILL, pérdida del runner), el log termina
  sin `RESULTADO:`. **Que falte esa línea no demuestra que la transacción se
  haya revertido.**
  - En un `apply`, el resultado es incierto aunque el log se corte antes de
    «ensayo limpio», porque el final del log también puede perderse.
  - En un `dry_run` no se construye ningún flujo con `COMMIT`, así que no se
    pudo confirmar nada.
- Un timeout o una cancelación no garantizan un `ROLLBACK`. Si el servidor ya
  había recibido el `COMMIT`, puede completarlo aunque el cliente desaparezca.
- Al cortarse el cliente, su sesión en el servidor puede seguir viva un rato,
  con la transacción abierta y sus bloqueos. En local, con SIGTERM, siguió
  dentro de `pg_sleep` hasta que se terminó a mano. Si una comprobación
  posterior falla por `lock_timeout`, se espera y se repite esa comprobación,
  nunca `apply`.

**Tres operaciones distintas, que no se sustituyen entre sí:**

| | Qué ejecuta | Qué deja escrito | Qué dice del estado |
|---|---|---|---|
| `dry_run` (`phase4_upgrade=dry_run`) | La guarda, y en una transacción que termina en `ROLLBACK`: el preflight congelado, R8-BASE, las 3 migraciones y el preflight vigente. No lanza suites | Nada | Si pasa, el proyecto sigue en el estado de partida (la Fase 4 **no** se aplicó). Si falla en el estado de partida (`FALLO P3` del congelado, o `FALLO R8-BASE` por objetos de la 4.1 o barrios), ya no está en la Fase 3 |
| Validación normal (`phase4_upgrade=none`, `apply_migrations=false`, `run_e2e_real=false`) | La guarda y el preflight vigente (P0–P6). **Si el preflight pasa, siguen la suite SQL, la api-suite y AU3/AU5**: no es una comprobación aislada | La suite SQL revierte cada archivo. La api-suite crea usuarios de prueba y los borra al terminar | Si el preflight pasa, la Fase 4 está aplicada, y entera. Si falla, no se ejecuta nada más |
| `apply` | — | — | **No se usa para investigar** |

**Cómo investigar un resultado incierto o un log sin `RESULTADO:`**, en este
orden:
1. **Leer el log:** la última sección `== R8 ·`, la línea `RESULTADO:` si la
   hay y el código de salida de psql.
2. **Sesiones abiertas:** si se puede sin escribir nada, comprobar que no
   queda ninguna sesión de la ejecución anterior.
3. **Un `dry_run`:**
   - «dry_run correcto»: la Fase 4 no se aplicó. Un `apply` nuevo necesita
     otra autorización;
   - falla en el estado de partida: probablemente se aplicó. Seguir con el
     paso 4;
   - falla por otra causa (conexión, `lock_timeout`, WARNING, P0): no es
     concluyente. Se resuelve la causa y se repite el `dry_run`, no el
     `apply`.
4. **La validación normal** (`phase4_upgrade=none`), sabiendo que lanza las
   suites si el preflight pasa:
   - pasa: la Fase 4 está aplicada, y las suites validan el resultado;
   - falla: el estado no es ni el de partida ni el de llegada. Se detiene todo
     y se investiga sin escribir.
5. **Documentar** los runs.

**«apply NO VÁLIDO»:** el `COMMIT` se ejecutó, así que el `dry_run` no aporta
nada. Primero hay que entender el WARNING o el aviso que falta. Después, con su
autorización, la validación normal confirma el estado de llegada.

Repetir `apply` sobre un proyecto ya actualizado no aplica nada dos veces: el
preflight congelado (37 políticas frente a 44) y R8-BASE lo rechazan antes de
la primera migración. Lo prueba el caso D del selftest, en local. Aun así,
`apply` no se usa como comprobación.

#### Cambiar el SHA-256 del preflight vigente

`PHASE4_FINAL_PREFLIGHT` fija el `tests/supabase/preflight.sql` revisado.
`validation-infra` exige que coincida con el archivo, así que cualquier cambio
de `preflight.sql` obliga a cambiar también esa línea en el mismo PR, a la
vista. El pin protege frente a un archivo distinto del revisado. Que el
contenido sea seguro lo garantiza la revisión.

Si `preflight.sql` cambia de forma legítima:
1. **Revisar el diff del SQL** (`git diff <base> -- tests/supabase/preflight.sql`):
   - sin control de transacciones ni meta-comandos de psql, y sin
     `client_min_messages`;
   - el aviso de P6 sigue empezando por `ok - P6:`, que `EXPECTED_NOTICES`
     exige;
   - sigue describiendo exactamente el estado después de las tres migraciones
     de R8. Si describe objetos de fases posteriores, la herramienta fallará
     (de forma segura), y no hay que actualizar el pin.
2. **Pasar el validador**, el mismo que la herramienta aplica a la copia:

   ```
   bash -c 'source tests/supabase/sql-suite-lib.sh && out="$(roomly_sql_transform tests/supabase/preflight.sql)" && ! grep -q roomly_file <<<"$out" && echo "validador: OK"'
   ```

   Tiene que imprimir `validador: OK`.
3. **Actualizar solo el hash previsto:**
   - calcularlo con `sha256sum tests/supabase/preflight.sql` y sustituir el
     hash de la línea `PHASE4_FINAL_PREFLIGHT=`;
   - no tocar `PHASE3_BASELINE` (el preflight congelado no cambia nunca:
     `validation-infra` fija su blob de git) ni las demás;
   - `git diff tests/supabase/phase4-upgrade.sh` tiene que mostrar una sola
     línea cambiada, la de `PHASE4_FINAL_PREFLIGHT`.
4. **Ejecutar las pruebas:**
   - `bash tests/supabase/phase4-upgrade-selftest.sh`;
   - `npm run test:infra`, que incluye `preflight-selftest`;
   - `npm run test`: en `validation-infra`, los pines coinciden con los
     archivos y el congelado es distinto del vigente;
   - y `npm run test:db`, si el cambio acompaña a una migración.
5. **Revisar otra vez el diff completo** antes de aceptar el cambio, en un PR
   revisado.

Nunca se rebaja la comprobación para que pase una prueba: quitar el pin,
aceptar varios hashes o saltarse el validador.

---

## Histórico: checkpoint contra `roomly-validation` (Fase 1)

Proyecto `roomly-validation` (Frankfurt), marca `'roomly-validation'`,
registro público desactivado. Ejecutado por el propietario entre el
2026-09-28 y el 2026-09-29, antes de todas las migraciones de Fase 2:
- **Suite SQL 58/58**: `tests/db/01`–`04`. Se ejecutó en una sola
  transacción, cuando todavía no existían `05`–`12`.
- **supabase-js 46/46**.
- **AU3/AU5 6/6**.
- **AU4/AU5 manual ✅**. El usuario se creó desde el dashboard, así que el
  registro por magic link **no** se probó: queda para el E2 de la Fase 2.8.

`roomly-validation` no tiene ninguna migración de Fase 2 (`20260929120000`
y posteriores) y **no se usa en la Fase 2.8**. Sus credenciales no pasan
las guardas nuevas porque su marca es distinta. Queda pendiente rotar sus
claves, borrar sus secrets de GitHub si siguen como secrets del
repositorio, y pausarlo o borrarlo.

**AU4 manual** (cómo se hizo entonces):
1. Se añadió un email real como usuario desde el dashboard.
2. Se levantó `npm run dev` en local, con `.env.local` apuntando al
   proyecto (solo la URL y la clave pública).
3. En `/login` se pulsó «Enviar enlace» y se abrió el enlace en el mismo
   navegador: acabó en `/` con sesión.
4. Se borró el usuario.

**AU5 con sesión** (cómo se hizo entonces):
- como usuario normal, `/admin` redirigía a `/`;
- con `role = 'admin'` asignado desde el SQL Editor, se veía el panel;
- después se devolvió a `user` y se borró el usuario.

Nota: el SQL Editor corre como `postgres`. Cualquier prueba de permisos
escrita allí a mano solo vale si hace `set role authenticated` y fija
`request.jwt.claims`; si no, no demuestra nada.

### Hallazgos registrados en ese checkpoint

- **D14 (INFO, sin corregir):** `@supabase/ssr` 0.12.7 usa
  `httpOnly: false` por defecto para las cookies de sesión, porque el
  cliente de navegador necesita leerlas.
  - El comentario de `app/(auth)/callback/route.ts` que habla de «cookies
    HTTP-only» es inexacto.
  - Implicación: un XSS podría leer la sesión, lo que refuerza la
    prioridad de la CSP y de no usar `dangerouslySetInnerHTML`.
  - No se cambió `@supabase/ssr` ni el callback.
