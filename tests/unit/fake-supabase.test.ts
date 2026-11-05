import { describe, expect, it } from "vitest";
import { createFakeSupabase } from "./helpers/fake-supabase";

// El cliente simulado es la base de los tests de lib/services/*: si perdiera
// parte de una consulta, esos tests podrían pasar con un servicio mal escrito.
describe("createFakeSupabase", () => {
  it("order() conserva todas las llamadas, en orden y con su dirección", async () => {
    const { client, calls } = createFakeSupabase({ userId: null });
    await client
      .from("room_images")
      .select("id")
      .order("position")
      .order("created_at", { ascending: false })
      .order("id", { ascending: true });
    expect(calls).toHaveLength(1);
    expect(calls[0].order).toEqual(["position", "created_at.desc", "id"]);
  });

  it("cada consulta registra su propio orden, sin compartirlo con las demás", async () => {
    const { client, calls } = createFakeSupabase({ userId: null });
    await client.from("cities").select("id").order("name");
    await client.from("cities").select("id");
    await client.from("universities").select("id").order("name").order("id");
    expect(calls.map((call) => call.order)).toEqual([
      ["name"],
      undefined,
      ["name", "id"],
    ]);
  });
});
