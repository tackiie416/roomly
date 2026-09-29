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

`package.json` ya existe (Fase 1). Pasos reales; los pasos 1–4 se
verificaron en el PC del propietario (Windows, Git Bash) durante AU4/AU5
contra el proyecto `roomly-validation`:

1. `npm install` (Node 22 recomendado — es lo que hay en el sandbox donde
   se desarrolló; no verificado con otras versiones de Node).
2. Copiar `.env.example` a `.env.local` y rellenar, como mínimo,
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` y
   `SUPABASE_SERVICE_ROLE_KEY` con los valores de un proyecto Supabase
   real (región EU). Para la app local solo hacen falta la URL, la clave
   pública y `NEXT_PUBLIC_SITE_URL`; la `service_role` no la necesita la
   app para login ni `/admin`. El único proyecto real existente es
   `roomly-validation`, desechable y **no** es producción (ver
   `docs/SUPABASE_VALIDATION.md`).
3. `npm run dev` — verificado: levanta la app y sirve login, callback y
   `/admin` contra `roomly-validation`.
4. Para los proveedores de Auth: `NEXT_PUBLIC_SUPABASE_URL`/`ANON_KEY`
   bastan para magic link; Google OAuth necesita además configurar el
   proveedor Google en el dashboard de Supabase Auth (Client ID/Secret de
   Google Cloud) — **no configurado: diferido por decisión del
   usuario** (igual que Apple OAuth).
5. `npx playwright install` — necesario antes de `npm run test:e2e`.
   No ejecutado todavía con red real; los E2E están **diferidos a
   Fase 2** (ver `docs/TESTING.md`).

## Comandos disponibles (reales, en `package.json`)

`dev` · `build` · `start` · `lint` · `typecheck` · `test` · `test:watch`
· `test:db` · `test:supabase` · `test:e2e` · `format` · `format:check`.

## Runtime del proxy

`proxy.ts` (antes `middleware.ts`) se ejecuta en **Node.js**: es el único
runtime que Next.js 16 admite en `proxy` y no se configura. En Vercel será
una función Node, no Edge Middleware; es una consecuencia conocida del
cambio y no bloquea nada. Las variables `NEXT_PUBLIC_SUPABASE_*` se leen en
tiempo de ejecución.

