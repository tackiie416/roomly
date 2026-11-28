import { describe, expect, it } from "vitest";
import { exportOwnData } from "@/lib/services/data-export";
import { createFakeSupabase, dbError, type Call } from "./helpers/fake-supabase";

// Sesión 85 — «Descargar mis datos»: solo el cliente del usuario, cada consulta
// acotada a su propio id, columnas explícitas (nunca `*`), sin datos de
// terceros ni notas de moderación, y en paralelo (sin N+1).

const ME = "d0000000-0000-4000-8000-000000000001";
const OTHER = "d0000000-0000-4000-8000-000000000002";
const ROOM = "f0000000-0000-4000-8000-000000000001";
const NOW = () => new Date("2026-11-27T10:00:00Z");

function respondWith(overrides: Partial<Record<string, (call: Call) => unknown>> = {}) {
  return (call: Call) => {
    const custom = overrides[call.table];
    if (custom) return custom(call) as { data: unknown; error: null };
    switch (call.table) {
      case "profiles":
        return { data: { id: ME, full_name: "Ana", deleted_at: null }, error: null };
      case "rooms":
        return { data: [{ id: ROOM, title: "Luminosa" }], error: null };
      case "room_images":
        return {
          data: [{ room_id: ROOM, position: 0, created_at: "2026-11-01T00:00:00Z" }],
          error: null,
        };
      case "interests":
        return call.columns === "id"
          ? { data: null, error: null, count: 3 }
          : {
              data: [{ created_at: "2026-11-02T00:00:00Z", room_id: null }],
              error: null,
            };
      case "matches":
        return {
          data: [{ created_at: "2026-11-03T00:00:00Z", compatibility_score: 82 }],
          error: null,
        };
      case "rpc:export_own_messages":
        return {
          data: [
            {
              conversation_number: 1,
              conversation_closed: false,
              created_at: "2026-11-04T00:00:00Z",
              content: "Hola",
            },
            {
              conversation_number: 2,
              conversation_closed: true,
              created_at: "2026-11-05T00:00:00Z",
              content: "Adiós",
            },
          ],
          error: null,
        };
      case "user_blocks":
        return { data: [{ created_at: "2026-11-05T00:00:00Z" }], error: null };
      case "reports":
        return {
          data: [
            {
              created_at: "2026-11-06T00:00:00Z",
              reported_user_id: OTHER,
              reported_room_id: null,
              reason: "spam",
              description: "insiste",
              status: "resolved",
              resolved_at: "2026-11-07T00:00:00Z",
            },
          ],
          error: null,
        };
      default:
        return { data: null, error: null };
    }
  };
}

describe("exportOwnData", () => {
  it("sin sesión: unauthenticated sin consultas", async () => {
    const fake = createFakeSupabase({ userId: null });
    expect(await exportOwnData(fake.client, NOW)).toEqual({
      ok: false,
      error: "unauthenticated",
    });
    expect(fake.calls).toEqual([]);
  });

  it("sin perfil: no_profile", async () => {
    const fake = createFakeSupabase({
      userId: ME,
      respond: respondWith({ profiles: () => ({ data: null, error: null }) }),
    });
    expect(await exportOwnData(fake.client, NOW)).toEqual({
      ok: false,
      error: "no_profile",
    });
  });

  it("un error de la base de datos no se propaga con detalles", async () => {
    const fake = createFakeSupabase({
      userId: ME,
      respond: respondWith({
        "rpc:export_own_messages": () => dbError("XX000", "detalle interno"),
      }),
    });
    const result = await exportOwnData(fake.client, NOW);
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain("detalle interno");
  });

  it("exporta lo propio, sin ids ni datos de otras personas", async () => {
    const fake = createFakeSupabase({ userId: ME, respond: respondWith() });
    const result = await exportOwnData(fake.client, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data;
    expect(data).toMatchObject({
      format: "roomly-data-export",
      version: 2,
      generatedAt: "2026-11-27T10:00:00.000Z",
      account: { id: ME },
      interestsReceivedCount: 3,
      matches: [{ compatibilityScore: 82 }],
      messagesSent: [
        { conversationNumber: 1, conversationClosed: false, content: "Hola" },
        { conversationNumber: 2, conversationClosed: true, content: "Adiós" },
      ],
      blocksMade: [{ createdAt: "2026-11-05T00:00:00Z" }],
      reportsMade: [{ target: "person", reason: "spam", status: "resolved" }],
    });
    expect(data.rooms[0]).toMatchObject({
      id: ROOM,
      photos: [{ position: 0 }],
    });
    const text = JSON.stringify(data);
    expect(text).not.toContain(OTHER);
    expect(text).not.toMatch(/resolution_notes|resolved_by|storage_path/);
  });

  it("cada consulta, con columnas explícitas y acotada a quien pide", async () => {
    const fake = createFakeSupabase({ userId: ME, respond: respondWith() });
    await exportOwnData(fake.client, NOW);
    // Los mensajes, con la función de 20261201120000 (solo los de quien
    // pregunta, por auth.uid(); sin argumentos que el navegador pueda cambiar).
    const rpc = fake.calls.filter((c) => c.operation === "rpc");
    expect(rpc).toEqual([
      {
        table: "rpc:export_own_messages",
        operation: "rpc",
        filters: [],
        terminal: "await",
      },
    ]);
    for (const call of fake.calls.filter((c) => c.operation !== "rpc")) {
      expect(call.operation, call.table).toBe("select");
      expect(call.columns, call.table).toBeTruthy();
      expect(call.columns, call.table).not.toContain("*");
      const scoped = call.filters.some(
        (f) =>
          (f.kind === "eq" && f.value === ME) ||
          (f.kind === "or" && String(f.value).includes(ME)) ||
          (f.kind === "in" && Array.isArray(f.value) && f.value.includes(ROOM))
      );
      expect(scoped, call.table).toBe(true);
    }
    const reports = fake.calls.find((c) => c.table === "reports");
    expect(reports?.columns).not.toMatch(/resolution_notes|resolved_by/);
    // Ninguna lectura directa de messages: la tabla solo da los chats abiertos.
    expect(fake.calls.map((c) => c.table)).not.toContain("messages");
  });

  it("sin N+1: el número de consultas no crece con las habitaciones", async () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      id: `f0000000-0000-4000-8000-0000000000${String(i).padStart(2, "0")}`,
    }));
    const fake = createFakeSupabase({
      userId: ME,
      respond: respondWith({ rooms: () => ({ data: many, error: null }) }),
    });
    await exportOwnData(fake.client, NOW);
    expect(fake.calls).toHaveLength(11);
  });

  it("sin habitaciones no consulta fotos; nunca la dirección exacta", async () => {
    const fake = createFakeSupabase({
      userId: ME,
      respond: respondWith({ rooms: () => ({ data: [], error: null }) }),
    });
    await exportOwnData(fake.client, NOW);
    expect(fake.calls.map((c) => c.table)).not.toContain("room_images");
    expect(fake.calls).toHaveLength(10);
  });
});
