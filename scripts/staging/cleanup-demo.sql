-- Borra los datos de demostración de staging (sesión 88): solo filas con el
-- prefijo de0000de-… y emails @roomly.invalid. Las cascadas desde auth.users
-- y profiles se llevan perfiles, preferencias y habitaciones. Los datos de
-- demostración no tienen fotos, así que no queda nada en Storage.
delete from public.rooms where id::text like 'de0000de-%';
delete from auth.users
where id::text like 'de0000de-%' and email like '%@roomly.invalid';
