#!/usr/bin/env bash
# Núcleo de la suite SQL remota (Fase 2.8). Se usa con `source` desde
# run-sql-suite.sh (después de guard.sh) y desde sql-suite-selftest.sh
# (PostgreSQL local). No se conecta a nada por sí solo.
#
# Aislamiento:
#   - Una sesión de psql POR ARCHIVO: ningún rol, `request.jwt.claims` ni
#     otro GUC pasa de un test al siguiente.
#   - Cada sesión: BEGIN → identidad (P0) → comprobación de sesión limpia →
#     helpers.sql → el test → ROLLBACK → comprobación posterior. Nada persiste.
#   - Un test con su propio BEGIN/ROLLBACK (hoy solo tests/db/11) se ejecuta
#     sin tocar el archivo: el flujo reescribe exactamente las líneas
#     `begin;` y `rollback;` a `savepoint roomly_file;` y
#     `rollback to savepoint roomly_file;`. Su ROLLBACK deshace solo su
#     bloque, nunca la transacción del runner.
#   - Cualquier otro control de transacción (COMMIT, END, ABORT, START
#     TRANSACTION, SAVEPOINT, RELEASE, PREPARE, ROLLBACK TO..., un BEGIN o
#     ROLLBACK que no esté solo en su línea, bloques sin cerrar o anidados) o
#     un meta-comando de psql hace que la suite aborte ANTES de conectar.
#   - Los WARNING se muestran y hacen fallar la suite (fallo cerrado).
#
# Requiere ROOMLY_VALIDATION_MARKER (lo define guard.sh).

ROOMLY_SQL_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOMLY_SQL_ROOT="$(cd "$ROOMLY_SQL_LIB_DIR/../.." && pwd)"

# roomly_sql_transform <archivo>
# Valida el control de transacciones y escribe en stdout el archivo con los
# bloques BEGIN/ROLLBACK convertidos en SAVEPOINT. Exit 2 (con el motivo en
# stderr) si encuentra algo no permitido. Reconoce comentarios `--`,
# cadenas '...', identificadores "..." (un ' o -- dentro de ellos no abre
# nada) y cuerpos $$...$$ (el único delimitador que usan los tests). Lo que
# no sabe analizar con seguridad se rechaza: cualquier otro $tag$, `/* */` y
# las cadenas E'...' (sus escapes \' desincronizarían el análisis).
roomly_sql_transform() {
  local file="$1"
  awk -v FILE="$(basename "$file")" -v Q="'" -v DQ='"' '
    function fail(msg) {
      printf "ERROR: %s:%d: %s\n", FILE, NR, msg > "/dev/stderr"
      failed = 1
      exit 2
    }
    function check_statement(text, line,    norm, first, second) {
      norm = tolower(text)
      gsub(/[ \t\r\n]+/, " ", norm)
      sub(/^ /, "", norm)
      sub(/ $/, "", norm)
      if (norm == "") return
      split(norm, words, " ")
      first = words[1]
      second = words[2]
      if (first ~ /^(begin|commit|end|rollback|abort|savepoint|release|start|prepare)$/)
        fail("control de transacción no permitido: \"" norm "\" (solo `begin;` y `rollback;` solos en su línea)")
      if (first == "set" && (second == "transaction" || second == "session"))
        fail("sentencia de sesión/transacción no permitida: \"" norm "\"")
      if (first == "reset" && second == "session")
        fail("sentencia de sesión no permitida: \"" norm "\"")
    }
    BEGIN { in_dollar = 0; in_quote = 0; in_ident = 0; stmt = ""; open_block = 0; failed = 0 }
    {
      line = $0
      trimmed = line
      sub(/^[ \t]+/, "", trimmed)
      sub(/[ \t\r]+$/, "", trimmed)
      at_start = (!in_dollar && !in_quote && !in_ident && stmt ~ /^[ \t\r\n]*$/)

      if (at_start && trimmed == "begin;") {
        if (open_block) fail("`begin;` anidado (ya hay un bloque abierto)")
        open_block = 1
        print "savepoint roomly_file;"
        next
      }
      if (at_start && trimmed == "rollback;") {
        if (!open_block) fail("`rollback;` sin `begin;` previo")
        open_block = 0
        print "rollback to savepoint roomly_file;"
        next
      }
      if (at_start && substr(trimmed, 1, 1) == "\\")
        fail("meta-comando de psql no permitido")

      n = length(line)
      i = 1
      while (i <= n) {
        c = substr(line, i, 1)
        two = substr(line, i, 2)
        if (in_dollar) {
          if (two == "$$") { in_dollar = 0; stmt = stmt " $$ "; i += 2; continue }
          i++
          continue
        }
        if (in_quote) {
          if (c == Q) {
            if (substr(line, i + 1, 1) == Q) { i += 2; continue }
            in_quote = 0
          }
          i++
          continue
        }
        # Identificador entre comillas dobles ("" es una comilla escapada).
        if (in_ident) {
          if (c == DQ) {
            if (substr(line, i + 1, 1) == DQ) { i += 2; continue }
            in_ident = 0
          }
          i++
          continue
        }
        if (two == "--") break
        if (two == "/*") fail("comentario de bloque no soportado por el validador")
        if (two == "$$") { in_dollar = 1; stmt = stmt " $$ "; i += 2; continue }
        if (c == "$" && match(substr(line, i), /^\$[A-Za-z_][A-Za-z_0-9]*\$/))
          fail("delimitador $tag$ no soportado por el validador")
        if (c == DQ) { in_ident = 1; stmt = stmt " ident "; i++; continue }
        # Cadena con escapes (E seguida de comilla simple): no se analiza, se rechaza.
        if ((c == "E" || c == "e") && substr(line, i + 1, 1) == Q \
            && (i == 1 || substr(line, i - 1, 1) !~ /[A-Za-z0-9_$]/))
          fail("cadena E" Q "..." Q " no soportada por el validador")
        if (c == Q) { in_quote = 1; stmt = stmt " str "; i++; continue }
        if (c == ";") { check_statement(stmt, NR); stmt = ""; i++; continue }
        stmt = stmt c
        i++
      }
      stmt = stmt "\n"
      print line
    }
    END {
      if (failed) exit 2
      if (in_dollar) fail("cuerpo $$ sin cerrar")
      if (in_quote) fail("cadena sin cerrar")
      if (in_ident) fail("identificador entre comillas dobles sin cerrar")
      if (open_block) fail("`begin;` sin `rollback;` al final del archivo")
      norm = stmt
      gsub(/[ \t\r\n]+/, "", norm)
      if (norm != "") fail("sentencia final sin `;`")
    }
  ' "$file"
}

# roomly_sql_session_stream <archivo> <contenido_transformado>
# Escribe en stdout la sesión completa de un archivo.
roomly_sql_session_stream() {
  local name="$1" body="$2"
  local marker="${ROOMLY_VALIDATION_MARKER:?falta ROOMLY_VALIDATION_MARKER}"
  if ! [[ "$marker" =~ ^[a-z0-9-]+$ ]]; then
    echo "ERROR: marca de identidad con formato inesperado" >&2
    return 1
  fi
  cat <<SQL
begin;
do \$\$
begin
  if coalesce((select shobj_description(d.oid, 'pg_database')
               from pg_database d where d.datname = current_database()), '') <> '${marker}' then
    raise exception 'el destino NO está reconocido como ${marker}. Abortado.';
  end if;
end \$\$;
do \$\$
begin
  -- Sesión limpia: nada heredado de otro test.
  if current_user <> session_user then
    raise exception 'AISLAMIENTO: la sesión empieza con rol % en vez de %', current_user, session_user;
  end if;
  if coalesce(current_setting('request.jwt.claims', true), '') not in ('', '{}') then
    raise exception 'AISLAMIENTO: la sesión empieza con request.jwt.claims definido';
  end if;
  if to_regnamespace('roomly_test') is not null then
    raise exception 'AISLAMIENTO: el esquema roomly_test ya existe antes del test';
  end if;
end \$\$;
\\echo '== ${name}'
SQL
  cat "$ROOMLY_SQL_ROOT/tests/db/helpers.sql"
  printf '%s\n' "$body"
  cat <<'SQL'
rollback;
do $$
begin
  -- Tras el ROLLBACK del runner: nada del test sigue vivo en la sesión.
  if current_user <> session_user then
    raise exception 'AISLAMIENTO: el rol % sobrevive al ROLLBACK', current_user;
  end if;
  if coalesce(current_setting('request.jwt.claims', true), '') not in ('', '{}') then
    raise exception 'AISLAMIENTO: request.jwt.claims sobrevive al ROLLBACK';
  end if;
  if to_regnamespace('roomly_test') is not null then
    raise exception 'AISLAMIENTO: el esquema roomly_test sobrevive al ROLLBACK';
  end if;
  raise notice 'ok - aislamiento: ROLLBACK completo, rol y claims restaurados';
end $$;
SQL
}

# Comprobación final, en otra sesión y solo de lectura.
ROOMLY_SQL_FINAL_CHECK=$(
  cat <<'SQL'
do $$
declare
  leftovers text[] := '{}';
begin
  if to_regnamespace('roomly_test') is not null then
    leftovers := leftovers || 'esquema roomly_test'::text;
  end if;
  if exists (select 1 from pg_policies where policyname like 'zz_test%') then
    leftovers := leftovers || 'política temporal zz_test_*'::text;
  end if;
  if exists (select 1 from auth.users where email like '%@test') then
    leftovers := leftovers || 'usuarios de test (@test) en auth.users'::text;
  end if;
  if array_length(leftovers, 1) > 0 then
    raise exception 'FALLO: la suite dejó restos: %', array_to_string(leftovers, ', ');
  end if;
  raise notice 'ok - tras la suite: sin roomly_test, sin políticas temporales, sin usuarios de test';
end $$;
SQL
)

# Imprime solo líneas de NOTICE/WARNING/ERROR y las de sección (nunca la
# conexión). Devuelve 1 si hay algún WARNING.
roomly_sql_filter_output() {
  local out_file="$1" warnings=0
  while IFS= read -r line; do
    line="${line#psql:<stdin>:}"
    line="$(printf '%s' "$line" | sed -E 's/^[0-9]+: //')"
    case "$line" in
      "== "*) echo "$line" ;;
      "NOTICE:  "*) echo "   ${line#NOTICE:  }" ;;
      "WARNING:  "*) echo "   WARNING: ${line#WARNING:  }"; warnings=1 ;;
      "ERROR:  "*) echo "   ERROR: ${line#ERROR:  }" ;;
    esac
  done <"$out_file"
  return "$warnings"
}

# roomly_sql_run_suite <db_url> <archivo...>
roomly_sql_run_suite() {
  local db_url="$1"
  shift
  local psql_cmd=(psql -X -q -v ON_ERROR_STOP=1 --no-psqlrc -d "$db_url")
  local tmp file name
  tmp="$(mktemp -d)"
  # shellcheck disable=SC2064
  trap "rm -rf '$tmp'" RETURN

  # 1. Validación de TODOS los archivos antes de conectar a nada.
  local index=0
  for file in "$@"; do
    index=$((index + 1))
    if ! roomly_sql_transform "$file" >"$tmp/$index.sql"; then
      echo "RESULTADO: $(basename "$file") no supera la validación de transacciones; no se ha ejecutado nada" >&2
      return 1
    fi
  done
  # helpers.sql no puede controlar transacciones en absoluto.
  if ! roomly_sql_transform "$ROOMLY_SQL_ROOT/tests/db/helpers.sql" >"$tmp/helpers.sql" \
    || grep -q "roomly_file" "$tmp/helpers.sql"; then
    echo "RESULTADO: helpers.sql no supera la validación de transacciones; no se ha ejecutado nada" >&2
    return 1
  fi

  # 2. Una sesión por archivo.
  index=0
  for file in "$@"; do
    index=$((index + 1))
    name="$(basename "$file")"
    local status=0
    roomly_sql_session_stream "$name" "$(cat "$tmp/$index.sql")" \
      | "${psql_cmd[@]}" >"$tmp/out" 2>&1 || status=$?
    local warn=0
    roomly_sql_filter_output "$tmp/out" || warn=1
    if [ "$status" -ne 0 ]; then
      if ! grep -qE '^(psql:<stdin>:[0-9]+: )?(ERROR|NOTICE|WARNING):' "$tmp/out"; then
        echo "   ERROR: psql terminó sin ejecutar el test (conexión u otro fallo; detalle omitido)"
      fi
      echo "RESULTADO: ${name} FALLÓ (su transacción se ha revertido)"
      return 1
    fi
    if [ "$warn" -ne 0 ]; then
      echo "RESULTADO: ${name} emitió WARNING; la suite falla (fallo cerrado)"
      return 1
    fi
  done

  # 3. Comprobación final en otra sesión.
  local status=0
  printf '%s\n' "$ROOMLY_SQL_FINAL_CHECK" | "${psql_cmd[@]}" >"$tmp/out" 2>&1 || status=$?
  roomly_sql_filter_output "$tmp/out" || status=1
  if [ "$status" -ne 0 ]; then
    echo "RESULTADO: la comprobación final de restos FALLÓ"
    return 1
  fi
  return 0
}
