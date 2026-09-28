#!/usr/bin/env bash
# AU3 (rama de error del callback) y AU5 (/admin sin sesión) contra la app
# levantada localmente (`next start`) y conectada al Supabase de VALIDACIÓN.
#
# Comprueba que ningún redirect sale del origen de la app, incluso con
# `next` malicioso. La rama de ÉXITO del callback con `next` no se puede
# probar aquí: el login todavía no propaga `next` (M6, Fase 2); la cubren
# los tests unitarios de lib/auth/safe-redirect.ts.
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

echo "== AU5 (sin sesión): /admin redirige a login dentro del mismo origen"
check "AU5a /admin sin sesión" "/admin" 307 "${BASE}/login?next=%2Fadmin"

if [ "$failed" -ne 0 ]; then
  echo "RESULTADO: AU3/AU5 con fallos"
  exit 1
fi
echo "RESULTADO: AU3/AU5 (sin sesión) superados"
