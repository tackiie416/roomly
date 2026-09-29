import "server-only";

import { type DbClient, type ServiceResult, mapDbError, ok } from "@/lib/services/result";

/**
 * Datos de referencia para los formularios (Fase 2.3): ciudades activas,
 * universidades y barrios. Son tablas de lectura pública (RLS con política
 * `select using (true)`), así que se leen con el cliente de servidor normal:
 * sin service_role, con proyecciones explícitas y sin `select("*")`.
 */

export type CityOption = { id: string; name: string };
export type UniversityOption = { id: string; name: string; city_id: string | null };
export type NeighborhoodOption = { id: string; name: string; city_id: string };

/** Ciudades con `is_active`: el rollout ciudad a ciudad (docs/DATABASE.md). */
export async function listActiveCities(
  supabase: DbClient
): Promise<ServiceResult<CityOption[]>> {
  const { data, error } = await supabase
    .from("cities")
    .select("id, name")
    .eq("is_active", true)
    .order("name");
  if (error) return mapDbError(error);
  return ok(data ?? []);
}

/** Universidades de las ciudades indicadas (una sola consulta, sin N+1). */
export async function listUniversities(
  supabase: DbClient,
  cityIds: string[]
): Promise<ServiceResult<UniversityOption[]>> {
  if (cityIds.length === 0) return ok([]);
  const { data, error } = await supabase
    .from("universities")
    .select("id, name, city_id")
    .in("city_id", cityIds)
    .order("name");
  if (error) return mapDbError(error);
  return ok(data ?? []);
}

/** Barrios de las ciudades indicadas (una sola consulta, sin N+1). */
export async function listNeighborhoods(
  supabase: DbClient,
  cityIds: string[]
): Promise<ServiceResult<NeighborhoodOption[]>> {
  if (cityIds.length === 0) return ok([]);
  const { data, error } = await supabase
    .from("neighborhoods")
    .select("id, name, city_id")
    .in("city_id", cityIds)
    .order("name");
  if (error) return mapDbError(error);
  return ok(data ?? []);
}
