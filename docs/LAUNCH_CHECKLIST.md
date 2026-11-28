# Checklist de staging, beta cerrada y lanzamiento

Sesión 86 (2026-11-28). Reúne en un solo sitio los pendientes que ya están
documentados en `CLAUDE.md`, `docs/SECURITY.md`, `docs/PRIVACY_RETENTION.md`,
`docs/SUPABASE_VALIDATION.md` y `docs/ROADMAP.md`. **No cierra ninguno ni
añade criterios de fase.** Cada punto dice quién lo decide o lo hace: el
propietario (P), legal (L) o Claude con autorización (C).

Ninguna fase autoriza el despliegue ni el uso con personas reales. Esta lista
tampoco: es una guía para decidirlo.

## 1. Antes de crear staging

- [ ] (P) Elegir el proyecto de Supabase de staging, **nuevo y aislado**
      (no `uwxb…`, ni el histórico de la Fase 1, ni los de validación).
- [ ] (P) B1: demostrar que la aprobación del Environment de GitHub detiene un
      job, antes de cualquier run nuevo (runs 21, 22, 25 y 26 sin aclarar).
- [ ] (P) «C-8»: confirmar qué significa, e inspeccionar o retirar el proyecto
      histórico de la Fase 1 y rotar su clave.
- [ ] (P) `uwxb…`: rotar sus claves y pausarlo.
- [ ] (P) Dominio de staging y de producción.

## 2. Montar staging (con autorización explícita)

- [ ] (C) Aplicar las migraciones de `master` en una transacción, incluidas
      las que aún no están en ningún proyecto real:
      `20261126120000` (intereses y matches), `20261127120000` (chat),
      `20261128120000` (bloqueos y reportes), `20261129120000` (admin) y, si
      se integra el PR #44, `20261130120000` (auditoría seudónima).
- [ ] (C) Preflight P0–P6, suite SQL completa, api-suite y AU3/AU5 en verde
      contra staging.
- [ ] (P) `SUPABASE_SERVICE_ROLE_KEY` solo en el servidor de staging, nunca en
      `NEXT_PUBLIC_*` (Claude no la configura ni la ve).
- [ ] (P) Auth: registro abierto solo si se va a probar el alta; URL de
      redirección del magic link con el dominio de staging; SMTP (Resend) en
      región EU.
- [ ] (P) Deploy Previews de Netlify o Vercel: comprobar a qué proyecto de
      Supabase se conectan y que no permiten registros reales; revisar las
      variables compartidas del equipo.

## 3. Validar en staging (antes de la beta)

- [ ] (C) El runtime completo de Next.js con la clave real (nunca validado):
      `/test`, `/explorar`, «Me interesa», `/matches`, chat, fotos, CRUD de
      habitaciones, búsqueda pública, bloqueos, reportes y panel de admin.
- [ ] (C) E2 real con las Fases 4–7 (hoy solo llega a `/test`).
- [ ] (C) Medir la subida de una foto de 4 MiB en la plataforma real (en local:
      4 195 232 bytes). Si el límite es menor, bajar `ROOM_IMAGE_MAX_BYTES`
      o cambiar el modelo de subida.
- [ ] (C) Comprobar las cabeceras de `next.config.ts` en el dominio real
      (HSTS solo aplica por HTTPS) y probar una CSP de scripts con nonces.
- [ ] (C) Conciliación de fotos de Storage antes y después de las pruebas.
- [ ] (C) `npm audit` justo antes del despliegue.
- [ ] (P) Crear el primer admin desde el servidor (service_role), nunca desde
      la app; comprobar que puede moderar y que todo queda en
      `admin_action_logs`.

## 4. Antes de personas reales (beta cerrada)

- [ ] (L) Política de privacidad y términos, con los datos de la empresa
      (razón social, NIF, dirección, DPO).
- [ ] (L) Datos de tabaco y vapeo del test.
- [ ] (L) Edad mínima (hoy 18 como restricción técnica).
- [ ] (L) Transferencias internacionales (Supabase, Vercel, Resend, PostHog).
- [ ] (P/L) Acceso operativo: quién entra al proyecto de Supabase y a la clave
      service_role, y con qué procedimiento (las respuestas del test, los
      mensajes y los reportes son legibles para quien opera la base de datos).
- [ ] (P/L) Conservación de mensajes de chats cerrados, reportes y auditoría
      (`docs/PRIVACY_RETENTION.md`, puntos 4–6). Ninguna purga se ejecuta ni
      se programa hasta decidirlo.
- [ ] (P/L) Borrado de cuenta (H6): desde la app o por soporte. Mientras no
      exista, un procedimiento manual documentado para atender solicitudes,
      que limpie Storage antes de borrar el perfil.
- [ ] (L) Si «Descargar mis datos» basta para el derecho de acceso y la
      portabilidad, y si debe incluir los mensajes de chats cerrados.
- [ ] (P) Canal de soporte y de avisos de seguridad, y quién atiende los
      reportes y en qué plazo.

## 5. Antes del lanzamiento público

- [ ] (P) Todo lo anterior, más la decisión explícita del propietario.
- [ ] (P) Proyecto de Supabase de producción en región EU, con copias de
      seguridad y PITR revisados.
- [ ] (P) PostHog en región EU y su aviso de cookies, si se activa la
      analítica en el cliente (REQUIERE REVISIÓN LEGAL).
- [ ] (P) HSTS `preload`, solo con el dominio definitivo.
