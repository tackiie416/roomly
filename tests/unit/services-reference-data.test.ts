import { describe, expect, it } from "vitest";
import {
  listActiveCities,
  listNeighborhoods,
  listUniversities,
} from "@/lib/services/reference-data";
import { createFakeSupabase, dbError } from "./helpers/fake-supabase";

const CITY = "3f1c6a4e-8b2d-4c1a-9e7f-2a6b5c4d3e21";

describe("reference-data", () => {
  it("ciudades activas, con proyección explícita y ordenadas", async () => {
    const rows = [{ id: CITY, name: "Barcelona" }];
    const { client, calls } = createFakeSupabase({
      userId: null,
      respond: () => ({ data: rows, error: null }),
    });
    expect(await listActiveCities(client)).toEqual({ ok: true, data: rows });
    expect(calls).toEqual([
      expect.objectContaining({
        table: "cities",
        operation: "select",
        columns: "id, name",
        filters: [{ kind: "eq", column: "is_active", value: true }],
        order: "name",
      }),
    ]);
  });

  it("universidades y barrios: una sola consulta por las ciudades (sin N+1)", async () => {
    const { client, calls } = createFakeSupabase({
      userId: null,
      respond: () => ({ data: [], error: null }),
    });
    await listUniversities(client, [CITY, "otra"]);
    await listNeighborhoods(client, [CITY]);
    expect(calls).toEqual([
      expect.objectContaining({
        table: "universities",
        columns: "id, name, city_id",
        filters: [{ kind: "in", column: "city_id", value: [CITY, "otra"] }],
      }),
      expect.objectContaining({
        table: "neighborhoods",
        columns: "id, name, city_id",
        filters: [{ kind: "in", column: "city_id", value: [CITY] }],
      }),
    ]);
  });

  it("sin ciudades no consulta nada", async () => {
    const { client, calls } = createFakeSupabase({ userId: null });
    expect(await listUniversities(client, [])).toEqual({ ok: true, data: [] });
    expect(await listNeighborhoods(client, [])).toEqual({ ok: true, data: [] });
    expect(calls).toHaveLength(0);
  });

  it("nunca select('*') ni columnas de más", async () => {
    const { client, calls } = createFakeSupabase({
      userId: null,
      respond: () => ({ data: [], error: null }),
    });
    await listActiveCities(client);
    await listUniversities(client, [CITY]);
    await listNeighborhoods(client, [CITY]);
    for (const call of calls) expect(call.columns).not.toContain("*");
  });

  it("error de base de datos → unknown, sin mensaje crudo", async () => {
    const { client } = createFakeSupabase({
      userId: null,
      respond: () => dbError("XX000", "detalle interno"),
    });
    expect(await listActiveCities(client)).toEqual({ ok: false, error: "unknown" });
  });
});
