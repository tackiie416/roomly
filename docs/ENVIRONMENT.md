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

## Entorno local (se rellena en Fase 1)

Cuando exista `package.json`: instrucciones de `npm install`,
`npm run dev`, y cómo obtener credenciales de un proyecto Supabase de
desarrollo (región EU recomendada por RGPD, ver `docs/SECURITY.md`).
