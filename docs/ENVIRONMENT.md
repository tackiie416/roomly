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

`package.json` ya existe (Fase 1). Pasos reales, verificados en este
sandbox salvo donde se indica lo contrario:

1. `npm install` (Node 22 recomendado — es lo que hay en el sandbox donde
   se desarrolló; no verificado con otras versiones de Node).
2. Copiar `.env.example` a `.env.local` y rellenar, como mínimo,
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` y
   `SUPABASE_SERVICE_ROLE_KEY` con los valores de un proyecto Supabase
   real (región EU) — **no existe ningún proyecto Supabase real
   todavía**, hay que crearlo (ver `HANDOFF.md`).
3. `npm run dev` — **no verificado en este sandbox** (sin red hacia
   Supabase no tiene mucho sentido probarlo a fondo aquí; sí se verificó
   `npm run build`, que es una comprobación distinta y más débil).
4. Para los proveedores de Auth: `NEXT_PUBLIC_SUPABASE_URL`/`ANON_KEY`
   bastan para magic link; Google OAuth necesita además configurar el
   proveedor Google en el dashboard de Supabase Auth (Client ID/Secret de
   Google Cloud) — **no configurado todavía, pendiente**.
5. `npx playwright install` — necesario antes de `npm run test:e2e`.
   **No ejecutado en ningún sandbox de esta conversación** (se sabía
   bloqueado por red; nunca confirmado con un intento real — ver
   `docs/TESTING.md`).

## Comandos disponibles (reales, en `package.json`)

`dev` · `build` · `start` · `lint` · `typecheck` · `test` · `test:watch`
· `test:e2e` · `format` · `format:check`.

