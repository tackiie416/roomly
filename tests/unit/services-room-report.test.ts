import { describe, expect, it } from "vitest";
import { reportRoom, reportableRoom } from "@/lib/services/reports";
import { createFakeSupabase, dbError, type FakeResponse } from "./helpers/fake-supabase";

// Fase 7 — reportar un anuncio: solo uno público (leído como visitante) y
// ajeno; quién reporta sale de la sesión; uno abierto por persona y anuncio.

const VIEWER = "00000000-0000-4000-8000-0000000000aa";
const ROOM = "f0000000-0000-4000-8000-000000000001";
const BCN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function clients(
  opts: {
    public?: boolean;
    own?: boolean;
    insert?: FakeResponse;
    userId?: string | null;
  } = {}
) {
  const visitor = createFakeSupabase({
    userId: null,
    respond: (call) => {
      if (call.table === "rooms")
        return {
          data: opts.public === false ? null : { id: ROOM, title: "Ático", city_id: BCN },
          error: null,
        };
      if (call.table === "cities") return { data: { slug: "barcelona" }, error: null };
      return { data: null, error: null };
    },
  });
  const user = createFakeSupabase({
    userId: opts.userId === undefined ? VIEWER : opts.userId,
    respond: (call) => {
      if (call.table === "rooms")
        return { data: opts.own ? { id: ROOM } : null, error: null };
      if (call.table === "reports" && call.operation === "insert")
        return opts.insert ?? { data: null, error: null };
      return { data: null, error: null };
    },
  });
  return { visitor, user };
}

const input = { roomId: ROOM, reason: "scam", description: "  pide fianza por Bizum " };

describe("reportableRoom", () => {
  it("un anuncio público y ajeno: título y ciudad para volver", async () => {
    const { visitor, user } = clients();
    expect(await reportableRoom(user.client, visitor.client, ROOM)).toEqual({
      ok: true,
      data: { roomId: ROOM, title: "Ático", citySlug: "barcelona", userId: VIEWER },
    });
    // La visibilidad se decide como visitante, con las columnas de anon.
    expect(visitor.calls[0]).toMatchObject({
      table: "rooms",
      columns: "id, title, city_id",
    });
    // La propiedad, con la sesión y filtrando por su owner_id.
    expect(user.calls[0].filters).toContainEqual({
      kind: "eq",
      column: "owner_id",
      value: VIEWER,
    });
  });

  it.each([
    ["no es público (borrador, pausado, retirado…)", { public: false }],
    ["es propio", { own: true }],
  ])("%s: not_found indistinguible", async (_n, opts) => {
    const { visitor, user } = clients(opts);
    expect(await reportableRoom(user.client, visitor.client, ROOM)).toEqual({
      ok: false,
      error: "not_found",
    });
  });

  it("un id que no es UUID: not_found sin consultar nada", async () => {
    const { visitor, user } = clients();
    expect(await reportableRoom(user.client, visitor.client, "1 or 1=1")).toEqual({
      ok: false,
      error: "not_found",
    });
    expect([...visitor.calls, ...user.calls]).toEqual([]);
  });

  it("sin sesión: unauthenticated", async () => {
    const { visitor, user } = clients({ userId: null });
    expect(await reportableRoom(user.client, visitor.client, ROOM)).toEqual({
      ok: false,
      error: "unauthenticated",
    });
  });
});

describe("reportRoom", () => {
  it("inserta con la cuenta de la sesión y solo los campos del GRANT", async () => {
    const { visitor, user } = clients();
    expect(await reportRoom(user.client, visitor.client, input)).toEqual({
      ok: true,
      data: { status: "created" },
    });
    const insert = user.calls.find((c) => c.operation === "insert");
    expect(insert?.payload).toEqual({
      reporter_id: VIEWER,
      reported_room_id: ROOM,
      reason: "scam",
      description: "pide fianza por Bizum",
    });
  });

  it("uno abierto ya: duplicate, sin error", async () => {
    const { visitor, user } = clients({
      insert: dbError(
        "23505",
        'duplicate key value violates unique constraint "uq_reports_open_room"'
      ),
    });
    expect(await reportRoom(user.client, visitor.client, input)).toEqual({
      ok: true,
      data: { status: "duplicate" },
    });
  });

  it("límite de 24 h: rate_limited", async () => {
    const { visitor, user } = clients({
      insert: dbError("P0001", "rate_limit_exceeded: demasiados reportes en 24h"),
    });
    expect(await reportRoom(user.client, visitor.client, input)).toEqual({
      ok: false,
      error: "rate_limited",
    });
  });

  it.each([
    ["harassment", "un motivo de personas"],
    ["borrado", "un motivo inventado"],
  ])("%s (%s): validation sin insertar", async (reason) => {
    const { visitor, user } = clients();
    const result = await reportRoom(user.client, visitor.client, { ...input, reason });
    expect(result).toMatchObject({ ok: false, error: "validation" });
    expect(user.calls.filter((c) => c.operation === "insert")).toEqual([]);
  });

  it("un anuncio propio no se inserta", async () => {
    const { visitor, user } = clients({ own: true });
    expect(await reportRoom(user.client, visitor.client, input)).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(user.calls.filter((c) => c.operation === "insert")).toEqual([]);
  });
});
