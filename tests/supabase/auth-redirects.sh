#!/usr/bin/env bash
# AU3 (rama de error del callback) y AU5 (rutas protegidas sin sesión) contra
# la app levantada localmente (`next start`), conectada al Supabase de
# VALIDACIÓN o a uno simulado. Solo peticiones sin sesión: no escribe nada.
#
# Comprueba que ningún redirect sale del origen de la app, incluso con
# `next` malicioso, y que los errores del callback se reducen a códigos
# propios. Desde la Fase 2.2 `next` viaja en una cookie (lib/auth/next-cookie.ts)
# y el callback ignora `next` en la query. La rama de ÉXITO del callback
# necesita un código PKCE real: la cubren los tests unitarios
# (tests/unit/auth-callback.test.ts).
set -euo pipefail

BASE="${BASE_URL:-http://localhost:3000}"
failed=0

# check <descripción> <ruta> <código esperado> <Location esperada>
check() {
  local label="$1" path="$2" want_code="$3" want_location="$4"
  local out code location
  # Si la app no responde, curl devuelve "000" y la comprobación falla con mensaje.
  out="$(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' "${BASE}${path}" || true)"
  code="${out%% *}"
  location="${out#* }"
  if [ "$code" = "$want_code" ] && [ "$location" = "$want_location" ]; then
    echo "   ok - ${label}"
  else
    echo "   FALLO: ${label} (esperado ${want_code} → ${want_location}; obtenido ${code} → ${location})"
    failed=1
  fi
}

LOGIN_ERROR="${BASE}/login?error=auth_callback_failed"

echo "== AU3: callback con código inválido y next malicioso"
check "AU3a next=@evil.com" "/callback?code=invalido&next=@evil.com" 307 "$LOGIN_ERROR"
check "AU3b next=//evil.com" "/callback?code=invalido&next=//evil.com" 307 "$LOGIN_ERROR"
check "AU3c next=https://evil.com" "/callback?code=invalido&next=https%3A%2F%2Fevil.com" 307 "$LOGIN_ERROR"
check "AU3d next=/\\evil.com" "/callback?code=invalido&next=%2F%5Cevil.com" 307 "$LOGIN_ERROR"
check "AU3e sin code, next=.evil.com" "/callback?next=.evil.com" 307 "$LOGIN_ERROR"
check "AU3f error de Supabase sin error_description reenviado" \
  "/callback?error=access_denied&error_description=Texto%20de%20Supabase" 307 "$LOGIN_ERROR"
check "AU3g enlace caducado (error_code=otp_expired)" \
  "/callback?error=access_denied&error_code=otp_expired&error_description=Email%20link%20expired" \
  307 "${BASE}/login?error=link_expired"

echo "== AU5 (sin sesión): rutas protegidas redirigen a login dentro del mismo origen"
check "AU5a /admin sin sesión" "/admin" 307 "${BASE}/login?next=%2Fadmin"
check "AU5b /admin/usuarios sin sesión" "/admin/usuarios" 307 "${BASE}/login?next=%2Fadmin%2Fusuarios"
check "AU5c /perfil sin sesión" "/perfil" 307 "${BASE}/login?next=%2Fperfil"
check "AU5d /ajustes sin sesión" "/ajustes" 307 "${BASE}/login?next=%2Fajustes"
check "AU5e /bienvenida/perfil sin sesión (next excluido)" "/bienvenida/perfil" 307 "${BASE}/login"
check "AU5f /bienvenida/preferencias sin sesión" "/bienvenida/preferencias" 307 "${BASE}/login"
check "AU5g /cuenta-desactivada sin sesión" "/cuenta-desactivada" 307 "${BASE}/login"
check "AU5h /login sin sesión se sirve (sin bucle)" "/login" 200 ""
check "AU5i /login con next malicioso se sirve (sin redirigir fuera)" "/login?next=https%3A%2F%2Fevil.com" 200 ""

if [ "$failed" -ne 0 ]; then
  echo "RESULTADO: AU3/AU5 con fallos"
  exit 1
fi
echo "RESULTADO: AU3/AU5 (sin sesión) superados"
