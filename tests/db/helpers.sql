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

grant execute on all functions in schema roomly_test to anon, authenticated, service_role;
