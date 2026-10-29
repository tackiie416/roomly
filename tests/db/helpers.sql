-- Helpers de aserción para los tests de tests/db. Sin dependencias externas
-- (no pgTAP): cada fallo es un RAISE EXCEPTION y, con ON_ERROR_STOP, psql
-- termina con exit != 0 y el runner marca el test como fallido.

create schema roomly_test;
grant usage on schema roomly_test to anon, authenticated, service_role;

-- Simula el JWT de un usuario (o ninguno, con null) para auth.uid().
create function roomly_test.login(p_user uuid) returns void
language sql as $$
  select set_config('request.jwt.claims',
    case when p_user is null then '{}' else json_build_object('sub', p_user, 'role', 'authenticated')::text end,
    false);
$$;

create function roomly_test.ok(p_cond boolean, p_msg text) returns void
language plpgsql as $$
begin
  if p_cond is distinct from true then
    raise exception 'FALLO: %', p_msg;
  end if;
  raise notice 'ok - %', p_msg;
end $$;

-- Ejecuta p_sql (como el rol actual) y exige exactamente p_expected filas.
create function roomly_test.expect_rows(p_sql text, p_expected bigint, p_msg text) returns void
language plpgsql as $$
declare
  n bigint;
begin
  execute format('select count(*) from (%s) t', p_sql) into n;
  if n <> p_expected then
    raise exception 'FALLO: % (esperadas % filas, obtenidas %)', p_msg, p_expected, n;
  end if;
  raise notice 'ok - %', p_msg;
end $$;

-- Ejecuta una sentencia que modifica datos y exige que afecte a p_expected filas.
create function roomly_test.expect_affected(p_sql text, p_expected bigint, p_msg text) returns void
language plpgsql as $$
declare
  n bigint;
begin
  execute p_sql;
  get diagnostics n = row_count;
  if n <> p_expected then
    raise exception 'FALLO: % (esperadas % filas afectadas, obtenidas %)', p_msg, p_expected, n;
  end if;
  raise notice 'ok - %', p_msg;
end $$;

-- Exige que p_sql falle con el SQLSTATE indicado (42501 = insufficient_privilege,
-- que es también el código de "new row violates row-level security policy").
-- Si falla con OTRO error (p. ej. recursión infinita, 42P17), el test falla
-- mostrando ese error: no se aceptan "fallos por el motivo equivocado".
create function roomly_test.expect_error(p_sql text, p_sqlstate text, p_msg text) returns void
language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlstate = p_sqlstate then
      raise notice 'ok - % (rechazado: %)', p_msg, sqlerrm;
      return;
    end if;
    raise exception 'FALLO: % (esperado SQLSTATE %, obtenido %: %)', p_msg, p_sqlstate, sqlstate, sqlerrm;
  end;
  raise exception 'FALLO: % (la sentencia se ejecutó sin error)', p_msg;
end $$;

-- Como expect_error, y además exige que el mensaje empiece por p_prefix: los
-- triggers usan el mismo SQLSTATE (23514) para reglas distintas, y lo que las
-- distingue es su prefijo estable (account_deleted:, room_images_limit:…).
create function roomly_test.expect_error_prefix(p_sql text, p_sqlstate text, p_prefix text, p_msg text)
returns void
language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlstate = p_sqlstate and starts_with(sqlerrm, p_prefix) then
      raise notice 'ok - % (rechazado: %)', p_msg, sqlerrm;
      return;
    end if;
    raise exception 'FALLO: % (esperado SQLSTATE % con «%», obtenido %: %)',
      p_msg, p_sqlstate, p_prefix, sqlstate, sqlerrm;
  end;
  raise exception 'FALLO: % (la sentencia se ejecutó sin error)', p_msg;
end $$;

-- Exige que p_sql incumpla exactamente el CHECK p_constraint (23514). Se mira
-- el nombre de la restricción, no el texto del mensaje (que depende del
-- idioma del servidor), y un 23514 de un trigger (sin restricción) no vale.
create function roomly_test.expect_check_violation(p_sql text, p_constraint text, p_msg text)
returns void
language plpgsql as $$
declare
  violated text;
begin
  begin
    execute p_sql;
  exception
    when check_violation then
      get stacked diagnostics violated = constraint_name;
      if violated = p_constraint then
        raise notice 'ok - % (rechazado por %)', p_msg, violated;
        return;
      end if;
      raise exception 'FALLO: % (esperado %, rechazado por «%»: %)', p_msg, p_constraint, violated, sqlerrm;
    when others then
      raise exception 'FALLO: % (esperado 23514 de %, obtenido %: %)', p_msg, p_constraint, sqlstate, sqlerrm;
  end;
  raise exception 'FALLO: % (la sentencia se ejecutó sin error)', p_msg;
end $$;

grant execute on all functions in schema roomly_test to anon, authenticated, service_role;
