-- ROOMLY — Datos de referencia iniciales
-- Ejecutar después de aplicar las migraciones (Fase 1).
-- Solo Barcelona queda `is_active = true`: controla el lanzamiento
-- ciudad a ciudad (sección 32 del brief) sin tocar código.

insert into cities (name, slug, is_active, center_lat, center_lng) values
  ('Barcelona', 'barcelona', true, 41.3874, 2.1686),
  ('Madrid', 'madrid', false, 40.4168, -3.7038),
  ('Valencia', 'valencia', false, 39.4699, -0.3763),
  ('Sevilla', 'sevilla', false, 37.3891, -5.9845),
  ('Málaga', 'malaga', false, 36.7213, -4.4214),
  ('Granada', 'granada', false, 37.1773, -3.5986),
  ('Salamanca', 'salamanca', false, 40.9701, -5.6635),
  ('Bilbao', 'bilbao', false, 43.2630, -2.9350),
  ('Zaragoza', 'zaragoza', false, 41.6488, -0.8891);

insert into universities (city_id, name, slug)
select id, u.name, u.slug from cities, (values
  ('Universitat de Barcelona (UB)', 'ub'),
  ('Universitat Autònoma de Barcelona (UAB)', 'uab'),
  ('Universitat Politècnica de Catalunya (UPC)', 'upc'),
  ('Universitat Pompeu Fabra (UPF)', 'upf'),
  ('ESADE', 'esade'),
  ('IQS', 'iqs'),
  ('Universitat Ramon Llull (URL)', 'url')
) as u(name, slug)
where cities.slug = 'barcelona';
