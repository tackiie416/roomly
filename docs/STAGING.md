# Staging aislado: preparación, despliegue, smoke tests y rollback

Sesión 87 (2026-11-28). **Preparación sin ejecutar:** nada de esto se ha
hecho contra un servicio real. Claude no ha conectado ni tocado Netlify,
Vercel ni Supabase, y no ha desplegado nada. Cada paso marcado (P) lo hace el
propietario, y los marcados (C) los puede hacer Claude solo con autorización
expresa (`CLAUDE.md`: cada run, migración remota o apertura del registro).
La lista corta de decisiones está en `docs/LAUNCH_CHECKLIST.md`.

## 1. Qué es «staging aislado»

- Un **proyecto de Supabase nuevo**, solo para staging, en región EU. Nunca
  `uwxb…` (Fase 2), el histórico de la Fase 1, `roomly-validation-3` ni
  `roomly-validation-4`: los de validación se crean y se limpian con el
  workflow manual y no deben recibir tráfico de una app desplegada.
- Un **sitio de la plataforma de alojamiento solo para staging**, con su
  dominio (por ejemplo `staging.<dominio>`), sin Auto Publishing hacia
  producción y con sus propias variables de entorno.
- **Deploy Previews:** que no compartan las variables de staging ni de
  producción. Lo más simple es que no tengan `SUPABASE_SERVICE_ROLE_KEY` y
  apunten a un proyecto sin datos reales, o que estén desactivados
  (`docs/ENVIRONMENT.md`, «Alojamiento»).
- **Sin datos reales:** solo cuentas de prueba creadas para staging. El
  registro público de Auth, cerrado salvo en las ventanas de prueba.

## 2. Variables de entorno (sin valores)

| Variable | Dónde | Regla |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | build y servidor | `https://<ref>.supabase.co` del proyecto de staging |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | build y servidor | clave anon (o `sb_publishable_…`) del **mismo** proyecto |
| `SUPABASE_SERVICE_ROLE_KEY` | **solo servidor** (variable secreta de la plataforma, nunca en el build del cliente) | service_role (o `sb_secret_…`) del mismo proyecto. Claude no la ve ni la configura |
| `NEXT_PUBLIC_SITE_URL` | build y servidor | `https://` del dominio de staging, sin ruta |
| `NEXT_PUBLIC_CHAT_REALTIME` | build | `false` salvo que `messages` esté en la publicación `supabase_realtime` |
| `DEPLOY_FORBIDDEN_SUPABASE_REFS` | solo al comprobar (opcional) | refs (o prefijos) que nunca deben usarse, separados por comas: los de validación y el histórico |
| `NODE_ENV` | la pone la plataforma | `production` |

Las de mapas, email, analítica y pagos de `.env.example` no las usa todavía
ninguna funcionalidad; no hace falta definirlas en staging.

### Comprobación sin conectarse a nada

```
DEPLOY_FORBIDDEN_SUPABASE_REFS=<refs de validación> \
  npm run check:deploy-config -- --target=staging
```

`scripts/deploy-config-check.mjs` (tests en
`tests/unit/deploy-config-check.test.ts`) lee las variables del proceso y
nunca imprime un valor. Falla (código 1) si:

- falta una variable obligatoria;
- la URL de Supabase no es https, es local, tiene ruta o es de un proyecto
  prohibido (`uwxb…` siempre, más los de `DEPLOY_FORBIDDEN_SUPABASE_REFS`);
- las claves son iguales, una tiene el rol equivocado o son de otro proyecto
  (cuando son JWT, por su `ref`), o la pública es una clave secreta;
- alguna `NEXT_PUBLIC_*` contiene la clave service_role, un JWT de
  service_role, una `sb_secret_…` o lleva `SERVICE`/`SECRET` en el nombre;
- `NEXT_PUBLIC_SITE_URL` no es https, es local, tiene ruta o es la de
  Supabase; en `--target=production`, si parece un dominio de staging.

Con claves en formato no reconocido o una URL de Supabase propia solo avisa.
Se ejecuta en el entorno de build de la plataforma (como paso previo al
build) o en una máquina con las variables cargadas, nunca pegando claves en un
chat.

## 3. Supabase de staging (P, con C autorizado para las migraciones)

1. (P) Crear el proyecto en región EU; anotar el ref.
2. (P) Auth:
   - Site URL y Redirect URLs: solo `https://<staging>/callback` (y nada
     de `localhost`);
   - SMTP propio (Resend, EU) o el de Supabase solo para pruebas;
   - registro público cerrado salvo en las ventanas de prueba;
   - caducidad del JWT: valorar bajarla de 1 h (afecta al JWT residual tras
     eliminar una cuenta, `docs/PRIVACY_RETENTION.md`).
3. (C, autorizado) Aplicar **todas** las migraciones de `master` en una
   transacción y el seed (mismo procedimiento que `migrate` en
   `docs/SUPABASE_VALIDATION.md`, contra el proyecto de staging, nunca contra
   uno de validación). Hoy son 25, desde la Fase 0 hasta
   `20261201120000_account_deletion.sql`.
4. (C) Preflight P0–P6 (`tests/supabase/preflight.sql`: 21 tablas, 43
   políticas, 27 triggers, 51 funciones) y suite SQL. La suite usa
   transacciones con ROLLBACK, pero crea y borra usuarios de prueba: solo en
   staging vacío y con autorización.
5. (P) Bucket `room-images`: privado (lo crea la migración; comprobar en el
   panel que no se ha hecho público).
6. (P) Primer admin: cambiar el rol desde el SQL editor (service_role), nunca
   desde la app.

## 4. Checklist de despliegue

Antes:

- [ ] `master` con la CI en verde en el commit que se va a desplegar.
- [ ] `npm audit --omit=dev` sin alertas altas.
- [ ] `npm run check:deploy-config -- --target=staging` sin errores, con las
      variables del sitio de staging.
- [ ] Migraciones del commit aplicadas y preflight en verde (sección 3). Si
      el despliegue trae una migración nueva: aplicarla **antes** del código
      solo si es compatible con la versión anterior; si no, ventana de
      mantenimiento.
- [ ] Anotar el despliegue actual que funciona (id del deploy de la
      plataforma y commit): es el destino del rollback.

Durante:

- [ ] Build con `NODE_ENV=production` (`npm run build`), Node 22.
- [ ] Publicar en el sitio de staging, nunca en producción.

Después:

- [ ] Smoke tests (sección 5) contra la URL de staging.
- [ ] Pruebas manuales de la sección 6 que toquen el cambio.
- [ ] Revisar los registros del servidor: ningún `[room-images]` ni
      `[account-deletion]` inesperado, ningún error 500.

## 5. Smoke tests

```
SMOKE_BASE_URL=https://<staging> npm run test:smoke
```

`playwright.smoke.config.ts` y `tests/e2e/smoke/deploy-smoke.spec.ts`. Solo
peticiones anónimas de lectura (no inicia sesión, no envía formularios, no
crea usuarios): cabeceras de seguridad (CSP `frame-ancestors`, X-Frame-Options,
nosniff, Referrer-Policy, Permissions-Policy, HSTS si es https, sin
`x-powered-by`), home, login, registro y búsqueda pública con 200, cada ruta
privada redirige a `/login` sin sesión, `/callback` no redirige fuera del
dominio, un anuncio inexistente da 404 y ningún JS del navegador contiene la
clave service_role. Sin trace, vídeo ni capturas. No está en la CI.
Comprobado en local contra el build de E1 (sesión 87); nunca contra un
despliegue.

## 6. Pruebas manuales en staging (preparadas, sin ejecutar)

Con cuentas de prueba, en una ventana con el registro abierto. Anotar
resultado y fecha en `PROGRESS.md`.

**Auth y redirects**

- [ ] Alta por magic link: el email llega, el enlace abre
      `https://<staging>/callback?code=…` y termina en el onboarding.
- [ ] Login de una cuenta existente con `next=/explorar`: vuelve a
      `/explorar`. Con `next=https://otro.ejemplo` o `//otro.ejemplo`: se
      queda en el dominio.
- [ ] Un enlace caducado o usado dos veces: aviso sin detalles técnicos.
- [ ] Logout: las rutas privadas vuelven a pedir login.
- [ ] Cuenta desactivada: solo ve `/cuenta-desactivada`, descargar sus datos
      y eliminar la cuenta.

**RLS y privacidad (dos cuentas, A y B)**

- [ ] A no ve el perfil, las preferencias ni el test de B por ninguna URL;
      `/explorar/<id de B>` da 404 si B no le saldría en `/explorar`.
- [ ] Borrador de B: 404 para A y para anónimos en la búsqueda y el detalle.
- [ ] Chat: A no abre `/mensajes/<id>` de una conversación ajena (404).
- [ ] Tras bloquear o deshacer el match, el chat queda cerrado para los dos.
- [ ] `/admin` con una cuenta normal: fuera. Con el admin: lectura y
      moderación, y cada acción en `admin_action_logs`.
- [ ] «Descargar mis datos» de A: sin ids ni mensajes de B; con sus mensajes
      de chats cerrados.

**Storage y subida de 4 MiB**

- [ ] `node scripts/make-upload-fixtures.mjs` genera `limite-4MiB.jpg`
      (4 194 304 bytes), `limite-4MiB-mas-1.jpg` y `normal-1MiB.jpg`.
- [ ] Subir `normal-1MiB.jpg` y `limite-4MiB.jpg` a una habitación de
      prueba: las dos se guardan. En local el cuerpo de la de 4 MiB son
      4 195 232 bytes (`upload-size.spec.ts`). Si la plataforma corta la
      petición (413 u otro error antes de llegar a la app), bajar
      `ROOM_IMAGE_MAX_BYTES` o cambiar el modelo de subida
      (`docs/SECURITY.md`, «Tamaño real de la subida»).
- [ ] `limite-4MiB-mas-1.jpg`: la app la rechaza con su aviso.
- [ ] Las URL de las fotos son firmadas y caducan (600 s); la ruta pública
      del bucket da error.
- [ ] Borrar la habitación: sus objetos desaparecen del bucket.
- [ ] Conciliación de Storage antes y después
      (`tests/supabase/room-images-reconcile.sql`, solo lectura).

**Eliminación de cuenta**

- [ ] Con una cuenta de prueba con una habitación con fotos y un chat:
      eliminarla, comprobar que no puede entrar, que sus fotos ya no están en
      el bucket, que la otra persona ve el chat cerrado y que
      `account_deletion_requests` tiene `completed_at`.

## 7. Rollback

**Código** (lo más común; sin tocar la base de datos):

1. En la plataforma, volver a publicar el despliegue anotado antes (Vercel:
   «Promote»/«Instant Rollback»; Netlify: «Publish deploy» del anterior).
   No hace falta rebuild.
2. Smoke tests (sección 5) contra staging.
3. Revertir en Git con un commit de reversión (`git revert`), nunca
   reescribiendo `master`.

**Migraciones:** las migraciones de este repositorio no tienen «down». Por
eso:

- el código anterior debe seguir funcionando con el esquema nuevo (añadir
  antes que quitar). Si una migración no lo cumple, se despliega en una
  ventana con el código ya preparado;
- una migración que falla dentro de su transacción no deja nada aplicado;
- deshacer una ya aplicada es una **migración nueva** que la compense,
  revisada y probada en local (`test:db`, `test:infra`) y aplicada con
  autorización; nunca editar a mano el esquema remoto;
- antes de una migración en staging, una copia (Supabase: backup o PITR) y
  anotar su hora. Restaurarla es la última opción y la decide el
  propietario: es irreversible para todo lo escrito después.

**Configuración:** si el fallo es una variable, corregirla, volver a pasar
`check:deploy-config` y redeplegar. Si una clave pudo filtrarse: rotarla en
Supabase (P) antes que nada.

## 8. Comprobación de la configuración de seguridad

- [ ] `check:deploy-config` sin errores.
- [ ] Smoke tests en verde (cabeceras, rutas privadas, sin service_role en
      el JS).
- [ ] En Supabase: RLS activada en todas las tablas de `public` (lo comprueba
      el preflight P2–P5), bucket privado, registro cerrado fuera de las
      ventanas de prueba.
- [ ] La plataforma no expone `SUPABASE_SERVICE_ROLE_KEY` a los Deploy
      Previews ni a builds de ramas.
- [ ] HSTS presente por https (sin `preload` hasta el dominio definitivo).
- [ ] Ningún log del servidor imprime emails, tokens ni cuerpos de
      peticiones.
