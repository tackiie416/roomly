# Entorno — ROOMLY

Plantilla de variables en `.env.example` (raíz del repo). Ninguna con
valor real — eso vive solo en `.env.local` (gitignored) y en las
variables de entorno de Vercel para producción/preview.

| Variable | Pública (`NEXT_PUBLIC_*`) | De dónde sale |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Sí | Supabase → Project Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Sí | Supabase → Project Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | **No — server-only** | Supabase → Project Settings → API. Nunca en un componente cliente. |
| `NEXT_PUBLIC_SITE_URL` | Sí | URL de producción/preview; afecta redirects OAuth y canonical SEO |
| `NEXT_PUBLIC_MAPBOX_TOKEN` | Sí | Cuenta Mapbox → tokens (pendiente de confirmar Mapbox vs. Google Maps) |
| `RESEND_API_KEY` | No | Dashboard de Resend |
| `NEXT_PUBLIC_POSTHOG_KEY` / `_HOST` | Sí | Proyecto PostHog (región EU) |

Variables de Stripe quedan comentadas en `.env.example` — no se usan
hasta Fase V4 (pagos), no antes.

## Entorno local

`package.json` ya existe (Fase 1). Pasos reales. Los pasos 1–4 se
verificaron en el PC del propietario (Windows, Git Bash) durante AU4/AU5,
contra el proyecto antiguo `roomly-validation` (Fase 1, histórico; ya no se
usa).

1. `npm install` (Node 22 recomendado — es lo que hay en el sandbox donde
   se desarrolló; no verificado con otras versiones de Node).
2. Copiar `.env.example` a `.env.local` y rellenar, como mínimo,
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` y
   `NEXT_PUBLIC_SITE_URL`, con un proyecto Supabase real (región EU). La
   app no necesita `SUPABASE_SERVICE_ROLE_KEY` para login, onboarding ni
   `/admin`. Hoy no hay ningún proyecto real en uso: `roomly-validation`
   ya no se usa y `roomly-validation-2` todavía no existe (ver
   `docs/SUPABASE_VALIDATION.md`). Ninguno de los dos es producción.
3. `npm run dev`: verificado en la Fase 1; levanta la app y sirve login,
   callback y `/admin`.
4. Para los proveedores de Auth: `NEXT_PUBLIC_SUPABASE_URL`/`ANON_KEY`
   bastan para magic link; Google OAuth necesita además configurar el
   proveedor Google en el dashboard de Supabase Auth (Client ID/Secret de
   Google Cloud) — **no configurado: diferido por decisión del
   usuario** (igual que Apple OAuth).
5. E2E local (E1, Fase 2.8): `npx playwright install chromium` y
   `npm run test:e2e`.
   - Instala el Chromium que corresponde a la versión instalada de
     `@playwright/test` (1.63, Chromium 1243).
   - E1 no usa `.env.local`: `playwright.config.ts` levanta el Supabase
     simulado y hace `next build` + `next start` con su propia URL y una
     clave anon ficticia.
   - Esa build deja `.next` apuntando al mock: después hay que volver a
     hacer `npm run build` antes de `npm run start` contra otro Supabase.
   - `npx playwright install` todavía no lo ha ejecutado nadie. El job
     `e2e-local` de CI lo hará en el próximo push.
6. Auto-tests de infraestructura contra PostgreSQL local (también en CI):
   `PGHOST=... PGUSER=postgres npm run test:infra`. Necesita un usuario
   que pueda crear bases de datos y roles, igual que `npm run test:db`.

### Variable opcional de Playwright

| Variable | Dónde se lee | Uso |
|---|---|---|
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE` | `playwright.config.ts`, `playwright.real.config.ts` | Ruta a un Chromium ya instalado, **solo** si el de Playwright no se puede descargar. En el entorno cloud de Claude Code: `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`. Es una combinación no soportada oficialmente, así que su resultado es orientativo. **No se define en CI.** |

## Comandos disponibles (reales, en `package.json`)

`dev` · `build` · `start` · `lint` · `typecheck` · `test` · `test:watch`
· `test:db` · `test:supabase` · `test:e2e` · `test:e2e:real` ·
`test:infra` · `format` · `format:check`.

## CI y validación remota (no son el entorno local)

- **CI (`.github/workflows/ci.yml`)**, en cada PR y en cada push a
  `master`:
  - lint, typecheck, test y build;
  - `db-security`: `test:db` y los auto-tests contra `postgres:16`;
  - `e2e-local`: E1, sin ningún secret de Supabase de validación.
- **Validación remota (`.github/workflows/supabase-validation.yml`)**:
  - solo manual, contra `roomly-validation-2`;
  - los secrets viven **solo** en el GitHub Environment
    `roomly-validation-2`;
  - no se ponen en `.env.local` ni en el repo;
  - detalle en `docs/SUPABASE_VALIDATION.md`.

| Variable | Tipo | La usa | Notas |
|---|---|---|---|
| `SUPABASE_VALIDATION_PROJECT_REF` | secret | guard, migraciones, preflight, suite SQL, api-suite, E2 | Ref del proyecto (actúa de guarda) |
| `SUPABASE_VALIDATION_URL` | secret | guard, api-suite, app (como `NEXT_PUBLIC_SUPABASE_URL`), E2 | `https://<ref>.supabase.co` |
| `SUPABASE_VALIDATION_ANON_KEY` | secret | api-suite, app (como `NEXT_PUBLIC_SUPABASE_ANON_KEY`), limpieza del E2 | Pública |
| `SUPABASE_VALIDATION_SERVICE_ROLE_KEY` | secret | guard, api-suite, preparación y limpieza del E2 | **Privilegiada**: nunca llega a la app ni a Playwright |
| `SUPABASE_VALIDATION_DB_URL` | secret | guard, migraciones, preflight, suite SQL, api-suite, preparación y limpieza del E2 | **Privilegiada**: Session pooler con contraseña |
| `E2E_EMAIL_TEMPLATE` | secret | E2 (spec, preparación, limpieza) | Dirección del buzón de prueba con `{id}` |
| `E2E_MAILBOX_CONFIG` | secret | adaptador del buzón (`tests/e2e/real/mailboxes/mailtrap.mjs`) | **Privilegiada** (acceso al buzón). JSON `{"accountId":"…","inboxId":"…","apiToken":"…"}`, `accountId` opcional |
| `E2E_MAILBOX_ADAPTER` | variable | E2 | Ruta del adaptador, dentro de `tests/e2e/`: `tests/e2e/real/mailboxes/mailtrap.mjs` |
| `E2E_RUN_ID` | la pone el workflow | E2 | `e2e-<run_id>-<intento>`; no se configura |
| `E2E_APP_URL` | la pone el workflow | E2 | `http://localhost:3000` |

## Runtime del proxy

`proxy.ts` (antes `middleware.ts`) se ejecuta en **Node.js**: es el único
runtime que Next.js 16 admite en `proxy` y no se configura. En Vercel será
una función Node, no Edge Middleware; es una consecuencia conocida del
cambio y no bloquea nada. Las variables `NEXT_PUBLIC_SUPABASE_*` se leen en
tiempo de ejecución.

