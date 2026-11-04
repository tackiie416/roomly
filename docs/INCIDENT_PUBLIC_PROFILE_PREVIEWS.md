# Incidente: escritura en `profiles` a través de `public_profile_previews`

Runbook para el propietario. Claude **no se conecta a Supabase** ni ejecuta
SQL remoto: las consultas se validaron en local contra bases efímeras con el
shim de Supabase (`tests/supabase/incident-runbook-selftest.sh`, en
`npm run test:infra` y en la CI). El **2026-11-04 el propietario ejecutó a
mano**, desde los paneles de Supabase, la captura de solo lectura y la
contención en los dos proyectos de validación activos (ver «Resultado de la
contención», más abajo).

Vulnerabilidad, explotación y corrección: `docs/SECURITY.md`, «Hotfix:
escritura en `profiles` a través de `public_profile_previews`». Migración de
la corrección: `supabase/migrations/20261014120000_public_profile_previews_write_lockdown.sql`
(commit `d76220c`, rama local `hotfix/public-profile-previews-write-lockdown`).

## 1. Qué se sabe y qué no (2026-10-31, sesión 73)

| Categoría | Estado |
|---|---|
| **Vulnerabilidad reproducida** | Solo en local: base temporal con las migraciones de `master` y el shim de Supabase. Un usuario autenticado se ponía `role = 'admin'`; anon y authenticated cambiaban nombres y roles ajenos y borraban perfiles (con su cascada). |
| **Proyectos potencialmente afectados** | Los tres proyectos de Supabase que recibieron `20260925120100` (sección 9). Se consideran afectados porque tienen la vista y, según la documentación, los privilegios por defecto de Supabase. |
| **Proyectos inspeccionados de verdad** | **Ninguno.** No se ha consultado ni el estado de la vista ni los privilegios reales de ningún proyecto. |
| **Evidencia de explotación real** | **Ninguna, ni a favor ni en contra.** No se ha mirado ningún registro. Que no haya evidencia no significa que no hubo explotación. |
| **Qué no se puede demostrar sin registros históricos** | Quién usó la vista y cuándo, qué valores había antes de un cambio de nombre o de rol, qué perfiles se borraron por ella (no quedan en ninguna tabla) y si un admin es legítimo cuando su fila se editó por la vista. Ver la sección 11. |

**No afirmes que un proyecto está a salvo** hasta haber hecho, en ese
proyecto, las fases A a D y haber guardado la evidencia. Incluso entonces,
«a salvo» solo vale para el estado actual de los privilegios, no para el
pasado.

## Resultado de la contención (2026-11-04)

Ejecutado por el propietario desde los paneles de Supabase; Claude no se
conectó. La evidencia completa (salidas de las consultas y sus SHA-256) y la
correspondencia con cada proyecto quedan **fuera del repositorio**, en poder
del propietario. Aquí se describe por estado, sin identificar proyectos.

**Estado de contención, en tres categorías:**

1. **Corregido y verificado — dos proyectos de validación activos.** La
   captura de solo lectura confirmó la vista `public_profile_previews`
   (`security_invoker = false`, sin el hotfix) con `anon` y `authenticated`
   pudiendo escribir por ella → **vulnerabilidad confirmada en real**. Se
   aplicó `20261014120000` en ambos y la verificación posterior (V1 y V2 de
   este runbook) dio **correcto**: ya no hay privilegios de cliente sobre la
   vista ni sobre ninguna otra vista de `public`.
2. **Pausado y no inspeccionado — un proyecto histórico de la Fase 1.**
   Pausado por el límite del plan; **sin hotfix aplicado y sin inspeccionar.**
3. **Pendiente de investigar — integraciones y entornos.** En el Deploy
   Preview revisado no había variables de Supabase, y el repositorio público no
   contiene claves; **otras plataformas de despliegue o integración siguen sin
   revisar.** La rotación de claves es higiene (no urgente).

**Indicios de explotación:** ninguno identificado (los proyectos estaban sin
datos y sin historial útil de `pg_stat_statements`). **No puede descartarse
una explotación anterior:** que no haya indicios no prueba que no ocurriera.

No se da ningún proyecto por «seguro»: la contención corrige el estado actual
de los privilegios, no el pasado.

## 2. Reglas

- **Autorización:** cada fase, en cada proyecto, necesita la autorización
  expresa del propietario. Las fases A, B y D solo leen. La fase C es la
  **única** que cambia permisos. Las acciones de la fase E (restaurar,
  pausar, rotar claves, borrar un proyecto) son decisiones aparte.
- **Orden:** A (captura) → B (usos indebidos) → decisión → C (cambio de
  permisos) → D (comprobación de contención) → E (después). No cambies nada
  antes de terminar y guardar A y B: la fase C no borra rastros, pero sí
  cambia lo que verá una captura posterior.
- **Conexión:** como `postgres` (dueño de las tablas y con BYPASSRLS), con
  psql y la cadena del *session pooler* del panel, o desde el editor SQL del
  panel. Para no dejar la contraseña en el historial de la shell:
  `read -rs ROOMLY_DB_URL && export ROOMLY_DB_URL` y pega la cadena (no se
  muestra). No la guardes en archivos del repositorio ni en la evidencia.
- **Proyecto correcto:** antes de nada, Q0 (marca e identidad). Si no es el
  proyecto que esperas, para.
- **Nada de esto lo ejecuta el workflow** `Supabase validation`, salvo el run
  de comprobación de la fase D en `roomly-validation-3`, que necesita su
  propia autorización.

## 3. Evidencias: dónde y cómo guardarlas

- **Lugar privado**, accesible solo al propietario (por ejemplo, una carpeta
  cifrada fuera del repositorio). **Nunca** en el repositorio, en issues, PR,
  comentarios, chats, registros o artefactos de la CI, ni en una página
  compartida.
- **Una carpeta por proyecto y captura**, con la fecha y hora UTC, y un
  archivo por bloque:

  ```
  psql "$ROOMLY_DB_URL" -X -v ON_ERROR_STOP=1 -f tests/supabase/incident-capture.sql -o "$EVID/capture.txt"
  sha256sum "$EVID"/*.txt > "$EVID/SHA256SUMS"
  ```

  La huella (`sha256sum`) se calcula en el momento de la captura y permite
  comprobar después que la evidencia no ha cambiado.
- **Las salidas tienen datos personales o sensibles:** ids de cuentas, fechas
  de alta y de último acceso (Q9, Q11) y, en Q8, textos de consultas. Se
  quedan en la evidencia privada.
- **El informe compartido** (PROGRESS, un PR, un mensaje) lleva solo:
  - recuentos, booleanos, nombres de privilegios y de roles del sistema;
  - fechas con precisión de día;
  - ids de migraciones y commits.
  - **Nunca:** nombres, emails, ids de usuario, IP, tokens, claves (tampoco
    la anon), cadenas de conexión, URL con claves ni textos de consultas con
    valores. Si hace falta referirse a una cuenta, usa «cuenta 1, cuenta 2» y
    guarda la correspondencia solo en la evidencia privada.
- **No pegues la evidencia sin redactar** en herramientas de terceros
  (tampoco asistentes de IA).
- **Conservación:** decide y anota cuánto tiempo se guarda y bórrala cuando
  deje de hacer falta.
- **REQUIERE REVISIÓN LEGAL:** si aparecen indicios de que se leyeron,
  cambiaron o borraron datos de **personas reales** (no de prueba), si hay
  que notificarlo y a quién, y en qué plazo, no lo decide este documento.

## 4. Fase A — captura (solo lectura)

Archivo: `tests/supabase/incident-capture.sql`. Es una única transacción
`READ ONLY` que termina en `ROLLBACK`; no usa comandos de psql, así que
también se puede pegar en el editor SQL. No falla si la vista no existe ni si
faltan tablas posteriores a la Fase 1.

| Consulta | Qué mira | Privilegios que necesita | Qué indica |
|---|---|---|---|
| Q0 | Rol, base de datos, marca (comentario de la base de datos), versión, hora | Ninguno especial | Que es el proyecto correcto |
| Q1 | Dueño y opciones de la vista, si admite escritura (28 = INSERT, UPDATE y DELETE), si tiene el comentario del hotfix | Catálogo (cualquier rol) | Sin filas: la vista no existe. `hotfix_aplicado = false`: falta la fase C |
| Q2, Q2b | ACL de la vista con **quién concedió** cada privilegio, y ACL por columnas | Catálogo | Un concedente distinto de `postgres`: **para**. El hotfix no puede quitarlo y su comprobación final abortará (probado en local) |
| Q3 | Privilegios **efectivos** de `public` (PUBLIC), anon, authenticated, authenticator y service_role, por tabla y por columnas | Catálogo. `has_table_privilege('public', …)` y `has_any_column_privilege` funcionan con cualquier rol (probado con un rol sin privilegios especiales) | Vulnerable si INSERT, UPDATE o DELETE da `true` para PUBLIC, anon o authenticated |
| Q4 | Atributos de los roles de Supabase y sus pertenencias | Catálogo | Si alguien más puede actuar como anon o authenticated |
| Q5 | Todas las vistas y vistas materializadas de public, con lo que permiten a PUBLIC, anon y authenticated | Catálogo | Otras vistas expuestas (la misma regla que P5 del preflight) |
| Q6 | Todas las entradas de `pg_default_acl` (de cualquier creador) y quién puede crear en public | Catálogo | El estado real que necesita la propuesta de privilegios por defecto (sección 10.3) |
| Q7 | `log_statement`, `log_min_duration_statement`, `shared_preload_libraries`; extensiones de registro; qué puede ver el rol actual | `pg_settings`: sin ser superusuario ni miembro de `pg_read_all_settings`, `shared_preload_libraries` sale **oculta** (columna `oculta_para_este_rol`), sin error | Qué fuentes de registro existen. Se lee `pg_settings` y no `current_setting()`, que daría un error a ese mismo rol (probado) |
| Q9a | Si el rol actual ve **todas** las filas de `profiles` | Catálogo | Si dice `false`, Q9 y Q10 **no valen**: la RLS filtra en silencio. Conéctate como `postgres` |
| Q9 | Cuentas por rol y desactivadas; ids de admins | SELECT en `profiles` + BYPASSRLS, superusuario o ser el dueño | Compara los admins con la lista de admins legítimos |
| Q10 | Última edición por día | Igual que Q9 | Picos de ediciones (solo la última por perfil) |
| Q12 | Filas insertadas, actualizadas y borradas desde el último reinicio de estadísticas | `pg_stat_user_tables` (cualquier rol) | Volumen, sin quién ni cuándo |

Además, **en el panel de Supabase**, antes de cambiar nada:
- anota qué registros hay (API y Postgres) y su retención según el plan, y
  exporta los que cubran el periodo de exposición, filtrando por la ruta
  `/rest/v1/public_profile_previews` con los métodos `PATCH`, `DELETE` y
  `POST` (solo lo que el panel ofrezca; no se ha comprobado qué conserva cada
  plan);
- anota si hay copias de seguridad o PITR y desde cuándo.

**Paradas:** Q0 no es el proyecto esperado; Q1 sin filas; Q2 con otro
concedente; Q9a = `false`. En cualquiera de esos casos, no sigas sin decidir
qué hacer.

## 5. Fase B — comprobar posibles usos indebidos (solo lectura)

- **Q8, opcional:** `tests/supabase/incident-optional-pg-stat-statements.sql`
  (archivo de psql). Q8a comprueba si la extensión está instalada, en qué
  esquema y si el rol ve las consultas de otros; Q8b busca consultas sobre la
  vista por rol. Si la extensión no está, lo dice y no hace nada: **no es un
  fallo** y no bloquea el resto. Requisitos para que el resultado sirva:
  - instalada (en Supabase se cree que vive en el esquema `extensions`; no se
    ha comprobado y Q8a lo muestra, así que no hay que suponerlo);
  - precargada en `shared_preload_libraries`; si no, Q8b da un error y Q8 no
    aplica (probado: el archivo termina bien);
  - el rol debe ser superusuario o miembro de `pg_read_all_stats`. Si no, las
    consultas de otros roles salen como `<insufficient privilege>`, el filtro
    las descarta y el resultado sale **vacío sin avisar**; por eso Q8a
    muestra `lee_todas_las_consultas` (probado en un clúster local con la
    extensión precargada: un UPDATE de anon por la vista aparece con
    `pg_read_all_stats` y desaparece sin él).
  - En el editor SQL: ejecuta Q8a y, solo si dice `instalada = true`, Q8b
    cambiando `extensions` por el esquema que muestre Q8a.
  - Un INSERT, UPDATE o DELETE de anon o authenticated sobre la vista es
    sospechoso: los tests reales solo la leían. Que no aparezca nada no
    demuestra nada (reinicios de estadísticas, límite de entradas).
- **Q11:** `tests/supabase/incident-optional-auth-users.sql`. Cuentas de
  Auth sin perfil. Solo existe en Supabase (en el shim local se omite sola).
  Es un indicio **ambiguo**: también lo produce quien no terminó el alta. En
  el informe, solo el recuento.
- **Q9, Q10 y Q12** (de la captura): admins que no están en la lista
  legítima, picos de ediciones, borrados. Recuerda que un borrado por la
  vista elimina el perfil y su cascada (preferencias, respuestas del test,
  habitaciones, intereses, conversaciones, notificaciones) sin dejar rastro
  en las tablas, y que un cambio de nombre no guarda el valor anterior.
- **Registros del panel** exportados en la fase A.

## 6. Fase C — cambio de permisos (la única escritura)

**Precondiciones:** A y B hechas y guardadas; Q0 es el proyecto correcto;
Q1 dice `hotfix_aplicado = false`; Q2 solo tiene a `postgres` como
concedente.

1. Comprueba que aplicas el archivo revisado:
   ```
   sha256sum supabase/migrations/20261014120000_public_profile_previews_write_lockdown.sql
   # eb53f35011ad63603129cf191536683a6015b40da79037545f47e8c224efdbb8 (commit d76220c)
   ```
2. Aplícalo **una vez**, en una sola transacción:
   ```
   psql "$ROOMLY_DB_URL" -X -v ON_ERROR_STOP=1 --single-transaction \
     -f supabase/migrations/20261014120000_public_profile_previews_write_lockdown.sql
   ```
   O pega el archivo completo en el editor SQL, que lo ejecuta como una sola
   petición.
3. **Si falla**, no ha cambiado nada (la transacción se deshace). La causa
   más probable es un privilegio concedido por otro rol: vuelve a Q2 y
   decide. No lo «arregles» con más REVOKE sin revisar quién y por qué lo
   concedió.
4. Repetirlo no cambia nada (probado en local).

Qué **no** se hace en esta fase: cambiar privilegios por defecto, tocar
otras vistas o tablas, ni aplicar otras migraciones.

## 7. Fase D — comprobar la contención (solo lectura)

1. `tests/supabase/incident-verify-after.sql` (psql o editor SQL). Debe
   devolver dos líneas `OK: V1 …` y `OK: V2 …`. Cualquier `FALLO:` significa
   que la contención **no** está hecha.
2. Repite la captura (fase A) y guárdala junto a la anterior: en Q3, PUBLIC,
   anon y authenticated deben dar `false` en todo; service_role, sin cambios.
3. **Por la API, con un id inexistente** (no cambia nada aunque la corrección
   no estuviera aplicada):
   ```
   curl -sS -X PATCH "$SUPABASE_URL/rest/v1/public_profile_previews?id=eq.00000000-0000-0000-0000-000000000000" \
     -H "apikey: $SUPABASE_ANON_KEY" -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
     -H "Content-Type: application/json" -d '{"full_name":"x"}'
   ```
   Lo esperado es un error con `code` `42501`. Un `2xx` significa que la
   vista sigue aceptando escrituras de anon. El código HTTP y el cuerpo
   exactos no se han comprobado en local (no hay PostgREST): cualquier error
   que no sea `2xx` impide la escritura, pero anota la respuesta exacta en la
   evidencia. Las claves van en variables de entorno, no en la línea de
   órdenes guardada ni en el informe.
4. **El caso autenticado** lo cubren PR10 y PR10b de la api-suite, en un run
   del workflow `Supabase validation`. Solo es posible en
   `roomly-validation-3` (la guarda rechaza los demás), con
   `apply_migrations=false` y autorización expresa. Hasta que el hotfix esté
   aplicado en ese proyecto, P4 del preflight y PR10/PR10b fallarán en
   cualquier run.

## 8. Fase E — después (decisiones separadas)

- Repite Q9 y compárala con la captura de la fase A. Si aparece un admin no
  legítimo: devuélvelo a `user` desde el servidor (service_role), cierra sus
  sesiones y revisa `admin_action_logs` (es de la aplicación, no una
  auditoría de la base de datos).
- Si hay indicios de cambios o borrados: valora restaurar desde una copia o
  PITR, si existe. En los proyectos de validación lo normal es limpiar y
  recrear los datos de prueba.
- `roomly-validation-2b` y `roomly-validation`: pausarlos o borrarlos, rotar
  sus claves y quitar sus secrets donde estén (sección 9).
- Deploy Preview de Netlify: comprobar a qué proyecto apunta y con qué clave
  (sección 9).
- Registra el resultado en `PROGRESS.md` con las reglas de la sección 3.

## 9. Inventario de proyectos y entornos (resumen des-identificado)

Resumen por **estado de contención**, sin nombres ni referencias de proyecto:
la correspondencia concreta, las marcas y la evidencia quedan **fuera del
repositorio**, en poder del propietario, para no señalar en un repo público
qué proyecto sigue sin corregir.

| Estado | Alcance | Qué queda |
|---|---|---|
| **Corregido y verificado** | Los dos proyectos de validación **activos**: hotfix `20261014120000` aplicado y V1/V2 correctos; sin privilegios de cliente sobre la vista | Rotación de claves (higiene) y la validación real por el workflow autorizado |
| **Pausado y no inspeccionado** | Un proyecto **histórico de la Fase 1**, con solo las migraciones de esa fase y la vista; pausado, sin hotfix | Inspeccionar (fases A–D) o retirar y rotar su clave, con autorización |
| **Pendiente de investigar** | Integraciones y entornos de despliegue que podrían apuntar a esos proyectos | Revisar a qué proyecto apunta cada despliegue, sin exponer valores; en el Deploy Preview revisado no había variables de Supabase |

**No puede descartarse una explotación anterior:** los proyectos estaban sin
datos y sin historial útil. La ausencia de indicios no prueba la ausencia de
explotación.

> La correspondencia proyecto ↔ estado (incluidas marcas, referencias y el
> despliegue concreto) la conserva el propietario fuera del repositorio. No se
> publica aquí para no identificar, en un repo público, qué proyecto histórico
> sigue sin parchear.

## 10. Revisión del runbook (sesión 73)

La primera versión de Q0–Q12 se entregó en el chat de la auditoría (sesión
72), sin ejecutar. Esta revisión la ha comprobado en local.

### 10.1 Cambios respecto a la primera versión

- **Separación:** captura obligatoria (`incident-capture.sql`), opcionales en archivos
  aparte (`incident-optional-pg-stat-statements.sql`, `incident-optional-auth-users.sql`),
  cambio de permisos (el archivo de la migración, sin copiarlo) y
  verificación (`incident-verify-after.sql`).
- **Q1–Q3 y Q5** usan `to_regclass` y no fallan si la vista no existe (la
  primera versión abortaba con `::regclass`). Q1 añade `hotfix_aplicado`;
  Q2b, las ACL por columnas; Q3, TRUNCATE, REFERENCES, TRIGGER y los
  privilegios por columnas; Q5, las columnas y las vistas materializadas.
- **Q6** convierte `defaclobjtype` a texto (`"char"`).
- **Q7** lee `pg_settings` y marca lo oculto; la primera versión no decía
  que, sin privilegios, `shared_preload_libraries` no aparece. Añade qué
  puede ver el rol actual.
- **Q8** ya no supone el esquema `extensions`: lo descubre, comprueba los
  requisitos y no bloquea nada si no aplica. Avisa de `pg_read_all_stats`.
- **Q9a** (nueva): sin ella, una conexión sin BYPASSRLS daba recuentos
  falsos (o ninguna fila) sin avisar. Q9 ya no mezcla ids con los
  recuentos.
- **Q11** pasa a su archivo: solo existe en Supabase y lleva datos
  personales.
- **Verificación** con resultados explícitos `OK`/`FALLO` (V1 y V2).
- **Evidencias** (sección 3): dónde guardarlas, huellas y qué puede ir en un
  informe compartido.

### 10.2 Comprobado en local (`tests/supabase/incident-runbook-selftest.sh`, 36 comprobaciones)

- La captura y la verificación no fallan, también con
  `default_transaction_read_only = on`, en tres esquemas: Fase 1 (como
  `roomly-validation`), el estado más avanzado de un proyecto real sin el
  hotfix (`roomly-validation-3`: hasta `20261016120000`) y todas las
  migraciones con el hotfix. Los archivos de lectura no contienen DML ni DDL
  (una escritura plantada se detecta).
- También pasa con las migraciones de la Fase 4.4 (copia temporal), donde
  `20261031120100` ya retira la escritura pero deja SELECT a authenticated:
  ahí V1 dice FALLO por esa lectura.
- Detectan la vulnerabilidad antes del hotfix (Q1, Q3, V1, V2) y nada
  después; service_role conserva sus privilegios.
- El paso de la fase C con `--single-transaction` deja V1 y V2 en OK
  (también en el esquema de la Fase 1, y después de la 4.1, fuera del orden
  de nombres, como se aplicaría en `roomly-validation-3`), y repetirlo no
  cambia nada.
- Con un privilegio concedido por otro rol, Q2 lo muestra y el hotfix
  aborta sin cambiar la ACL.
- Con un rol **no** superusuario con BYPASSRLS (como `postgres` en
  Supabase): todo funciona, `shared_preload_libraries` sale oculta y
  `current_setting()` daría error. Sin BYPASSRLS: Q9a avisa y la RLS vacía
  Q9. Q3 y Q5 dan lo mismo con cualquier rol.
- Q8: se omite sin la extensión; instalada sin precargar, falla sola y el
  archivo termina bien; en un clúster temporal que la precarga, encuentra el
  UPDATE de anon por la vista, y un rol sin `pg_read_all_stats` no lo ve.
- Q11: se omite sin las columnas de Supabase; con ellas, encuentra solo la
  cuenta sin perfil.

### 10.3 Lo que no se puede comprobar en local

- En qué esquema está `pg_stat_statements` en cada proyecto y si está
  precargada.
- Si `postgres` es miembro de `pg_read_all_stats` o `pg_read_all_settings`
  en Supabase, y si puede leer `auth.users` (se cree que sí, sin comprobar).
- El comportamiento del editor SQL del panel con `BEGIN TRANSACTION READ
  ONLY` y varias sentencias.
- La respuesta exacta de PostgREST (código HTTP y cuerpo) a la petición de
  la fase D.
- Qué registros conserva cada plan y durante cuánto tiempo.
- El estado real de `pg_default_acl` (Q6), que necesita la propuesta de
  `tests/supabase/default-privileges-proposal.sql` antes de
  convertirse en migración (`docs/SECURITY.md`, «Privilegios por defecto:
  propuesta sin aplicar»).

## 11. Límites de la investigación histórica

- ROOMLY no tiene auditoría por filas. `admin_action_logs` es de la
  aplicación, no de la base de datos.
- `updated_at` guarda solo la última modificación; una edición legítima
  posterior la tapa.
- Los registros de API (método, ruta y estado, sin el cuerpo) y los de
  Postgres dependen del plan y de su retención. Las sentencias DML solo
  constan si se activó un registro adicional (`log_statement`, pgaudit), y
  no consta que se activara.
- `pg_stat_statements`, si existe, guarda consultas agregadas por rol, sin
  fechas por llamada, y se pierde con un reinicio de estadísticas o al salir
  del límite de entradas.
- Los proyectos de validación crean y borran datos de prueba a propósito:
  que falten filas es lo esperado.
- **Que no haya registros no demuestra que no hubo explotación.**
