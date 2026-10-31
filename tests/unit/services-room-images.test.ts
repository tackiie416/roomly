import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import sharp from "sharp";
import {
  addRoomImage,
  deleteRoomImage,
  isDefinitiveInsertRejection,
  listOwnRoomImages,
  listRoomCovers,
  listRoomImages,
  ROOM_COVERS_MAX_ROOMS,
  type RecoveryEvent,
  type RoomImagesDeps,
} from "@/lib/services/room-images";
import type { SanitizeResult } from "@/lib/images/sanitize-room-image";
import type { DbClient } from "@/lib/services/result";
import {
  ROOM_IMAGE_MAX_BYTES,
  ROOM_IMAGE_MESSAGES,
  ROOM_IMAGE_SIGNED_URL_TTL_SECONDS,
} from "@/lib/validation/room-images";
import {
  createFakeSupabase,
  dbError,
  type Call,
  type FakeResponse,
} from "./helpers/fake-supabase";

// Para las dependencias por defecto: createAdminClient devuelve el cliente
// admin simulado del test que lo pida (sin él, fallaría: no hay clave).
const defaultAdmin = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    if (!defaultAdmin.current) throw new Error("createAdminClient sin cliente simulado");
    return defaultAdmin.current;
  },
}));

// Fase 4.2 — servicio de fotos. El cliente del usuario solo LEE (sesión,
// cuenta, propiedad y estado de la habitación, fotos que puede ver y, si el
// INSERT falla, si la fila existe); el admin (service_role) ESCRIBE (Storage
// y `room_images`) y FIRMA URL, y solo firma las rutas que el usuario acaba
// de leer (D1: bucket privado). La ruta, el id y la posición los decide el
// servidor; el objeto se sube antes de la fila y solo se borra tras un
// rechazo definitivo con la fila comprobada como ausente (M2).

const USER = "11111111-2222-4333-8444-555555555555";
const OTHER = "99999999-2222-4333-8444-555555555555";
const ROOM = "22222222-3333-4444-8555-666666666666";
const OTHER_ROOM = "44444444-3333-4444-8555-666666666666";
const IMAGE_ID = "33333333-4444-4555-8666-777777777777";
const PATH = `${ROOM}/${IMAGE_ID}.webp`;
const ACTIVE_PROFILE = { id: USER, deleted_at: null };
const OWN_ROOM = { id: ROOM, owner_id: USER, status: "draft", deleted_at: null };
const CLEAN = Buffer.from("webp-limpio");
const NOW = new Date("2026-10-25T10:00:00.000Z");
/** NOW + 600 s: la URL firmada vale al menos hasta aquí. */
const EXPIRES = "2026-10-25T10:10:00.000Z";
/** URL firmada simulada (lleva un token, como las reales). */
const signed = (path: string) => `https://signed.test/${path}?token=t-${path.length}`;

const photo = (bytes = 10, type = "image/jpeg") =>
  new File([new Uint8Array(bytes).fill(7)], "IMG_0001 casa de Ana.jpg", { type });

type Images = Array<{ id: string; storage_path: string; position: number }>;
const image = (n: number, position = n, roomId = ROOM) => {
  const id = `${String(n).repeat(8)}-4444-4555-8666-777777777777`;
  return { id, storage_path: `${roomId}/${id}.webp`, position };
};

/** Cliente del usuario: perfil, habitación y fotos. */
function userClient(options: {
  userId?: string | null;
  profile?: unknown;
  room?: unknown;
  images?: Images;
  imagesError?: FakeResponse;
  image?: unknown;
  roomError?: FakeResponse;
  /** Respuesta a la comprobación posterior a un INSERT fallido (maybeSingle). */
  lookup?: FakeResponse;
  /** Registro compartido con el admin, para comprobar el orden. */
  log?: string[];
}) {
  return createFakeSupabase({
    userId: options.userId === undefined ? USER : options.userId,
    respond: (call) => {
      options.log?.push(`user:${call.table}.${call.operation}.${call.terminal}`);
      if (call.table === "profiles")
        return {
          data: options.profile === undefined ? ACTIVE_PROFILE : options.profile,
          error: null,
        };
      if (call.table === "rooms")
        return (
          options.roomError ?? {
            data: options.room === undefined ? OWN_ROOM : options.room,
            error: null,
          }
        );
      if (call.table === "room_images") {
        if (call.terminal === "maybeSingle")
          return options.lookup ?? { data: options.image ?? null, error: null };
        return options.imagesError ?? { data: options.images ?? [], error: null };
      }
      return { data: null, error: null };
    },
  });
}

type StorageCall =
  | { op: "upload"; bucket: string; path: string; body: unknown; options: unknown }
  | { op: "remove"; bucket: string; paths: string[] }
  | { op: "sign"; bucket: string; paths: string[]; expiresIn: number };

type SignItem = {
  path: string | null;
  signedUrl: string | null;
  error: string | null;
};

/** Cliente admin: tablas (fake) + Storage, con un registro común del orden. */
function adminClient(
  options: {
    respond?: (call: Call) => FakeResponse;
    uploadError?: { message: string };
    removeError?: { message: string };
    /** La petición de firma entera falla. */
    signError?: { message: string };
    /** La firma lanza una excepción (storage-js relanza los errores inesperados). */
    signThrows?: boolean;
    /** Respuesta de la firma por ruta (por defecto, una URL firmada por ruta). */
    signItems?: (paths: string[]) => SignItem[];
    /** Registro compartido con el cliente del usuario. */
    log?: string[];
  } = {}
) {
  const events: string[] = options.log ?? [];
  const storageCalls: StorageCall[] = [];
  const fake = createFakeSupabase({
    userId: null,
    respond: (call) => {
      events.push(`${call.table}.${call.operation}`);
      if (options.respond) return options.respond(call);
      if (call.operation === "insert")
        return {
          data: {
            id: call.payload?.id,
            storage_path: call.payload?.storage_path,
            position: call.payload?.position,
          },
          error: null,
        };
      if (call.operation === "delete") return { data: { id: IMAGE_ID }, error: null };
      return { data: null, error: null };
    },
  });
  const storage = {
    from: (bucket: string) => ({
      upload: async (path: string, body: unknown, uploadOptions: unknown) => {
        events.push("storage.upload");
        storageCalls.push({ op: "upload", bucket, path, body, options: uploadOptions });
        return options.uploadError
          ? { data: null, error: options.uploadError }
          : { data: { path }, error: null };
      },
      remove: async (paths: string[]) => {
        events.push("storage.remove");
        storageCalls.push({ op: "remove", bucket, paths });
        return options.removeError
          ? { data: null, error: options.removeError }
          : { data: [], error: null };
      },
      createSignedUrls: async (paths: string[], expiresIn: number) => {
        events.push("storage.sign");
        storageCalls.push({ op: "sign", bucket, paths: [...paths], expiresIn });
        if (options.signThrows) throw new TypeError("data.map is not a function");
        if (options.signError) return { data: null, error: options.signError };
        const items =
          options.signItems?.(paths) ??
          paths.map((path) => ({ path, signedUrl: signed(path), error: null }));
        return { data: items, error: null };
      },
    }),
  };
  const client = {
    ...(fake.client as unknown as object),
    storage,
  } as unknown as DbClient;
  return { client, calls: fake.calls, storageCalls, events };
}

function deps(
  admin: ReturnType<typeof adminClient>,
  overrides: Partial<RoomImagesDeps> = {}
) {
  const recoveries: Array<{ event: RecoveryEvent; path: string }> = [];
  const sanitized: Uint8Array[] = [];
  const declaredTypes: string[] = [];
  let adminCreated = 0;
  const value: RoomImagesDeps = {
    adminClient: () => {
      adminCreated += 1;
      return admin.client;
    },
    sanitize: async (input, declaredType): Promise<SanitizeResult> => {
      sanitized.push(input);
      declaredTypes.push(declaredType);
      return {
        ok: true,
        image: { data: CLEAN, width: 800, height: 600, contentType: "image/webp" },
      };
    },
    newId: () => IMAGE_ID,
    now: () => NOW,
    signedUrlTtlSeconds: 600,
    reportRecovery: (event, path) => recoveries.push({ event, path }),
    ...overrides,
  };
  return {
    value,
    recoveries,
    sanitized,
    declaredTypes,
    adminCreated: () => adminCreated,
  };
}

const ops = (admin: ReturnType<typeof adminClient>) =>
  admin.storageCalls.map((c) => c.op);

describe("isDefinitiveInsertRejection (M2): decide por el código SQLSTATE, nunca por el texto", () => {
  it("rechazos definitivos: clases 22, 23, 42 y P0", () => {
    for (const code of [
      "22P02",
      "22001",
      "23514",
      "23505",
      "23503",
      "42501",
      "42P17",
      "P0001",
    ]) {
      expect(isDefinitiveInsertRejection({ code, message: "x" }), code).toBe(true);
    }
  });

  it("ambiguos: sin código, vacío, PGRST, conexión, transacción, recursos, operador, sistema e internos", () => {
    for (const code of [
      undefined,
      "",
      "PGRST116",
      "PGRST301",
      "08006",
      "40001",
      "40003",
      "53300",
      "57014",
      "57P01",
      "58000",
      "XX000",
      "23514 ",
      "2351",
      "23514x",
    ]) {
      expect(isDefinitiveInsertRejection({ code, message: "23514" }), String(code)).toBe(
        false
      );
    }
    expect(isDefinitiveInsertRejection(null)).toBe(false);
    expect(isDefinitiveInsertRejection(undefined)).toBe(false);
  });

  it("un código que no es una cadena es ambiguo y no lanza (no es un TypeError)", () => {
    for (const code of [23514, 42501, { valor: "23514" }, ["23514"], true]) {
      expect(
        isDefinitiveInsertRejection({ code: code as unknown as string, message: "x" })
      ).toBe(false);
    }
  });
});

describe("addRoomImage: comprobaciones previas con el cliente del usuario", () => {
  it("sin sesión: unauthenticated, sin limpiar ni crear el cliente admin", async () => {
    const admin = adminClient();
    const d = deps(admin);
    const { client } = userClient({ userId: null });
    expect(await addRoomImage(client, { roomId: ROOM, photo: photo() }, d.value)).toEqual(
      {
        ok: false,
        error: "unauthenticated",
      }
    );
    expect(d.sanitized).toHaveLength(0);
    expect(d.adminCreated()).toBe(0);
  });

  it("entrada no válida (campos de más, id, sin foto o más de 4 MiB): validation, sin admin", async () => {
    const admin = adminClient();
    const d = deps(admin);
    const { client, calls } = userClient({});
    for (const input of [
      { roomId: ROOM, photo: photo(), storagePath: PATH },
      { roomId: ROOM, photo: photo(), position: 0 },
      { roomId: "no-es-un-uuid", photo: photo() },
      { roomId: ROOM },
      { roomId: ROOM, photo: photo(ROOM_IMAGE_MAX_BYTES + 1) },
      { roomId: ROOM, photo: photo(10, "image/svg+xml") },
      null,
    ]) {
      const result = await addRoomImage(client, input, d.value);
      expect(result.ok, JSON.stringify(input)).toBe(false);
      expect(!result.ok && result.error).toBe("validation");
    }
    expect(calls).toHaveLength(0);
    expect(d.sanitized).toHaveLength(0);
    expect(d.adminCreated()).toBe(0);
  });

  it("más de 4 MiB: el mensaje del límite, sin leer el archivo", async () => {
    const d = deps(adminClient());
    const { client } = userClient({});
    expect(
      await addRoomImage(
        client,
        { roomId: ROOM, photo: photo(ROOM_IMAGE_MAX_BYTES + 1) },
        d.value
      )
    ).toEqual({
      ok: false,
      error: "validation",
      fieldErrors: { photo: [ROOM_IMAGE_MESSAGES.tooLarge] },
    });
  });

  it("cuenta desactivada: deleted; sin perfil: no_profile. Ni limpieza ni admin", async () => {
    for (const [profile, error] of [
      [{ id: USER, deleted_at: "2026-10-20T00:00:00Z" }, "deleted"],
      [null, "no_profile"],
    ] as const) {
      const d = deps(adminClient());
      const { client } = userClient({ profile });
      expect(
        await addRoomImage(client, { roomId: ROOM, photo: photo() }, d.value)
      ).toEqual({
        ok: false,
        error,
      });
      expect(d.sanitized).toHaveLength(0);
      expect(d.adminCreated()).toBe(0);
    }
  });

  it("la habitación se busca como propia (filtro owner_id): si no lo es, not_found", async () => {
    const d = deps(adminClient());
    const { client, calls } = userClient({ room: null });
    expect(await addRoomImage(client, { roomId: ROOM, photo: photo() }, d.value)).toEqual(
      {
        ok: false,
        error: "not_found",
      }
    );
    const roomCall = calls.find((call) => call.table === "rooms");
    expect(roomCall?.filters).toEqual([
      { kind: "eq", column: "id", value: ROOM },
      { kind: "eq", column: "owner_id", value: USER },
    ]);
    expect(d.adminCreated()).toBe(0);
  });

  it("una habitación visible de otra persona tampoco es suya: not_found", async () => {
    const d = deps(adminClient());
    const { client } = userClient({ room: { ...OWN_ROOM, owner_id: OTHER } });
    expect(await addRoomImage(client, { roomId: ROOM, photo: photo() }, d.value)).toEqual(
      {
        ok: false,
        error: "not_found",
      }
    );
    expect(d.adminCreated()).toBe(0);
  });

  it("habitación retirada o eliminada: forbidden, como el trigger, sin limpiar ni subir", async () => {
    for (const room of [
      { ...OWN_ROOM, status: "removed" },
      { ...OWN_ROOM, deleted_at: "2026-10-20T00:00:00Z" },
    ]) {
      const d = deps(adminClient());
      const { client } = userClient({ room });
      expect(
        await addRoomImage(client, { roomId: ROOM, photo: photo() }, d.value)
      ).toEqual({
        ok: false,
        error: "forbidden",
      });
      expect(d.sanitized).toHaveLength(0);
      expect(d.adminCreated()).toBe(0);
    }
  });

  it("pausada o alquilada sí admite fotos", async () => {
    for (const status of ["active", "paused", "rented"]) {
      const d = deps(adminClient());
      const { client } = userClient({ room: { ...OWN_ROOM, status } });
      const result = await addRoomImage(
        client,
        { roomId: ROOM, photo: photo() },
        d.value
      );
      expect(result.ok, status).toBe(true);
    }
  });

  it("con 8 fotos: el mensaje del límite, sin limpiar ni subir", async () => {
    const d = deps(adminClient());
    const images = Array.from({ length: 8 }, (_, n) => image(n + 1));
    const { client } = userClient({ images });
    expect(await addRoomImage(client, { roomId: ROOM, photo: photo() }, d.value)).toEqual(
      {
        ok: false,
        error: "validation",
        fieldErrors: { photo: [ROOM_IMAGE_MESSAGES.limit] },
      }
    );
    expect(d.sanitized).toHaveLength(0);
    expect(d.adminCreated()).toBe(0);
  });

  it("un error al leer la habitación o las fotos no sigue adelante", async () => {
    for (const options of [
      { roomError: dbError("42501") },
      { imagesError: dbError("08006") },
    ]) {
      const d = deps(adminClient());
      const { client } = userClient(options);
      const result = await addRoomImage(
        client,
        { roomId: ROOM, photo: photo() },
        d.value
      );
      expect(result.ok).toBe(false);
      expect(d.adminCreated()).toBe(0);
    }
  });

  it("la limpieza recibe los bytes del archivo y su tipo declarado", async () => {
    const d = deps(adminClient());
    const { client } = userClient({});
    await addRoomImage(client, { roomId: ROOM, photo: photo(12, "image/png") }, d.value);
    expect(d.sanitized).toEqual([new Uint8Array(12).fill(7)]);
    expect(d.declaredTypes).toEqual(["image/png"]);
  });

  it("una foto que la limpieza rechaza: su mensaje, sin detalles técnicos y sin admin", async () => {
    for (const [reason, message] of [
      ["type_mismatch", ROOM_IMAGE_MESSAGES.mismatch],
      ["unsupported_format", ROOM_IMAGE_MESSAGES.type],
      ["animated", "No se admiten imágenes animadas"],
      ["too_many_pixels", "La foto tiene demasiada resolución"],
      ["invalid_image", "No hemos podido leer la foto. Prueba con otra"],
      ["output_too_large", ROOM_IMAGE_MESSAGES.tooLarge],
      ["metadata_remaining", "No hemos podido procesar la foto. Prueba con otra"],
    ] as const) {
      const d = deps(adminClient(), {
        sanitize: async () => ({ ok: false, reason }),
      });
      const { client } = userClient({});
      expect(
        await addRoomImage(client, { roomId: ROOM, photo: photo() }, d.value)
      ).toEqual({
        ok: false,
        error: "validation",
        fieldErrors: { photo: [message] },
      });
      expect(d.adminCreated(), reason).toBe(0);
    }
  });
});

describe("addRoomImage: escritura con service_role", () => {
  it("limpia, sube el objeto y DESPUÉS registra la fila; devuelve una URL firmada", async () => {
    const log: string[] = [];
    const admin = adminClient({ log });
    const d = deps(admin);
    const { client } = userClient({ log });
    const result = await addRoomImage(client, { roomId: ROOM, photo: photo() }, d.value);
    expect(result).toEqual({
      ok: true,
      data: { id: IMAGE_ID, position: 0, url: signed(PATH), expiresAt: EXPIRES },
    });
    expect(log.filter((e) => !e.startsWith("user:"))).toEqual([
      "storage.upload",
      "room_images.insert",
      "storage.sign",
    ]);
    // Todas las lecturas del usuario van antes de la primera escritura.
    expect(log.indexOf("storage.upload")).toBeGreaterThan(
      log.lastIndexOf("user:room_images.select.await")
    );
    expect(admin.storageCalls[0]).toEqual({
      op: "upload",
      bucket: "room-images",
      path: PATH,
      body: CLEAN,
      options: { contentType: "image/webp", upsert: false, cacheControl: "600" },
    });
    expect(admin.calls[0]).toMatchObject({
      table: "room_images",
      operation: "insert",
      payload: { id: IMAGE_ID, room_id: ROOM, storage_path: PATH, position: 0 },
      columns: "id, storage_path, position",
      terminal: "single",
    });
    expect(admin.storageCalls[1]).toEqual({
      op: "sign",
      bucket: "room-images",
      paths: [PATH],
      expiresIn: 600,
    });
  });

  it("la posición es la siguiente a la mayor (no el número de fotos)", async () => {
    const admin = adminClient();
    const d = deps(admin);
    const { client } = userClient({ images: [image(1, 0), image(2, 4), image(3, 2)] });
    const result = await addRoomImage(client, { roomId: ROOM, photo: photo() }, d.value);
    expect(result.ok && result.data.position).toBe(5);
    expect(admin.calls[0].payload?.position).toBe(5);
  });

  it("el nombre del archivo original no llega a ninguna parte", async () => {
    const admin = adminClient();
    const d = deps(admin);
    const { client } = userClient({});
    const result = await addRoomImage(client, { roomId: ROOM, photo: photo() }, d.value);
    const everything = JSON.stringify([
      result,
      admin.calls,
      admin.storageCalls,
      d.recoveries,
    ]);
    expect(everything).not.toContain("IMG_0001");
    expect(everything).not.toContain("casa de Ana");
  });

  it("nunca una URL pública, ni de respaldo", async () => {
    const admin = adminClient({ signError: { message: "caído" } });
    const d = deps(admin);
    const { client } = userClient({});
    const result = await addRoomImage(client, { roomId: ROOM, photo: photo() }, d.value);
    expect(JSON.stringify(result)).not.toMatch(/object\/public|https?:\/\//);
  });

  it("si la firma falla después de guardar, la subida sigue siendo un éxito, sin URL", async () => {
    for (const options of [{ signError: { message: "caído" } }, { signThrows: true }]) {
      const admin = adminClient(options);
      const d = deps(admin);
      const { client } = userClient({});
      expect(
        await addRoomImage(client, { roomId: ROOM, photo: photo() }, d.value)
      ).toEqual({
        ok: true,
        data: { id: IMAGE_ID, position: 0, url: null, expiresAt: null },
      });
      expect(ops(admin)).toEqual(["upload", "sign"]);
      expect(d.recoveries).toEqual([]);
    }
  });

  it("si falla la subida: unknown y aviso de objeto sin confirmar, sin registrar fila ni borrar", async () => {
    const admin = adminClient({ uploadError: { message: "fallo de red" } });
    const d = deps(admin);
    const { client } = userClient({});
    expect(await addRoomImage(client, { roomId: ROOM, photo: photo() }, d.value)).toEqual(
      {
        ok: false,
        error: "unknown",
      }
    );
    expect(admin.calls).toHaveLength(0);
    expect(ops(admin)).toEqual(["upload"]);
    expect(d.recoveries).toEqual([
      { event: "room_image_upload_unconfirmed", path: PATH },
    ]);
  });

  it("INSERT rechazado de forma definitiva y fila ausente: se borra el objeto y se traduce el error", async () => {
    for (const [message, expected] of [
      [
        "room_images_limit: una habitación puede tener como máximo 8 fotos",
        {
          ok: false,
          error: "validation",
          fieldErrors: { photo: [ROOM_IMAGE_MESSAGES.limit] },
        },
      ],
      [
        "account_deleted: la cuenta no existe o está desactivada",
        { ok: false, error: "deleted" },
      ],
      ["room_not_writable: la habitación no existe", { ok: false, error: "forbidden" }],
    ] as const) {
      const admin = adminClient({ respond: () => dbError("23514", message) });
      const d = deps(admin);
      const { client } = userClient({ lookup: { data: null, error: null } });
      expect(
        await addRoomImage(client, { roomId: ROOM, photo: photo() }, d.value)
      ).toEqual(expected);
      expect(admin.storageCalls.at(-1)).toEqual({
        op: "remove",
        bucket: "room-images",
        paths: [PATH],
      });
      expect(d.recoveries).toEqual([]);
    }
  });

  it("antes de borrar, comprueba la fila con el cliente del usuario: id, habitación y ruta exactos", async () => {
    const admin = adminClient({ respond: () => dbError("23514", "room_images_limit:") });
    const d = deps(admin);
    const { client, calls } = userClient({ lookup: { data: null, error: null } });
    await addRoomImage(client, { roomId: ROOM, photo: photo() }, d.value);
    const lookup = calls.find(
      (call) => call.table === "room_images" && call.terminal === "maybeSingle"
    );
    expect(lookup?.filters).toEqual([
      { kind: "eq", column: "id", value: IMAGE_ID },
      { kind: "eq", column: "room_id", value: ROOM },
      { kind: "eq", column: "storage_path", value: PATH },
    ]);
    expect(admin.calls.filter((call) => call.operation === "select")).toHaveLength(0);
  });

  it("rechazo definitivo, pero el objeto no se puede borrar: aviso de huérfano", async () => {
    const admin = adminClient({
      respond: () => dbError("23514", "room_images_limit:"),
      removeError: { message: "caído" },
    });
    const d = deps(admin);
    const { client } = userClient({ lookup: { data: null, error: null } });
    const result = await addRoomImage(client, { roomId: ROOM, photo: photo() }, d.value);
    expect(result.ok).toBe(false);
    expect(d.recoveries).toEqual([
      { event: "room_image_orphan_after_insert", path: PATH },
    ]);
  });

  it("rechazo definitivo con la fila presente: éxito, sin borrar el objeto", async () => {
    const admin = adminClient({ respond: () => dbError("23505", "duplicate key") });
    const d = deps(admin);
    const row = { id: IMAGE_ID, storage_path: PATH, position: 0 };
    const { client } = userClient({ lookup: { data: row, error: null } });
    expect(await addRoomImage(client, { roomId: ROOM, photo: photo() }, d.value)).toEqual(
      {
        ok: true,
        data: { id: IMAGE_ID, position: 0, url: signed(PATH), expiresAt: EXPIRES },
      }
    );
    expect(ops(admin)).not.toContain("remove");
  });

  it("resultado ambiguo y fila ausente: se conserva el objeto y se avisa (el INSERT pudo seguir)", async () => {
    for (const error of [
      { code: "", message: "TypeError: fetch failed" },
      { message: "sin código" },
      { code: "PGRST000", message: "x" },
      { code: "57014", message: "canceling statement" },
      { code: "40003", message: "statement completion unknown" },
    ]) {
      const admin = adminClient({ respond: () => ({ data: null, error }) });
      const d = deps(admin);
      const { client } = userClient({ lookup: { data: null, error: null } });
      expect(
        await addRoomImage(client, { roomId: ROOM, photo: photo() }, d.value)
      ).toEqual({
        ok: false,
        error: "unknown",
      });
      expect(ops(admin), JSON.stringify(error)).not.toContain("remove");
      expect(d.recoveries).toEqual([
        { event: "room_image_insert_unconfirmed", path: PATH },
      ]);
    }
  });

  it("sin error, pero sin la fila en la respuesta: ambiguo, se comprueba igual", async () => {
    const admin = adminClient({ respond: () => ({ data: null, error: null }) });
    const d = deps(admin);
    const { client } = userClient({ lookup: { data: null, error: null } });
    expect(await addRoomImage(client, { roomId: ROOM, photo: photo() }, d.value)).toEqual(
      {
        ok: false,
        error: "unknown",
      }
    );
    expect(ops(admin)).not.toContain("remove");
    expect(d.recoveries).toEqual([
      { event: "room_image_insert_unconfirmed", path: PATH },
    ]);
  });

  it("resultado ambiguo y fila presente: la subida se completó", async () => {
    const admin = adminClient({ respond: () => dbError("", "fetch failed") });
    const d = deps(admin);
    const row = { id: IMAGE_ID, storage_path: PATH, position: 0 };
    const { client } = userClient({ lookup: { data: row, error: null } });
    const result = await addRoomImage(client, { roomId: ROOM, photo: photo() }, d.value);
    expect(result.ok).toBe(true);
    expect(ops(admin)).not.toContain("remove");
    expect(d.recoveries).toEqual([]);
  });

  it("si no se puede comprobar la fila, se conserva el objeto y se avisa", async () => {
    for (const [error, expected] of [
      [dbError("23514", "room_images_limit:"), "validation"],
      [dbError("", "fetch failed"), "unknown"],
    ] as const) {
      const admin = adminClient({ respond: () => error });
      const d = deps(admin);
      const { client } = userClient({ lookup: dbError("08006", "conexión") });
      const result = await addRoomImage(
        client,
        { roomId: ROOM, photo: photo() },
        d.value
      );
      expect(!result.ok && result.error).toBe(expected);
      expect(ops(admin)).not.toContain("remove");
      expect(d.recoveries).toEqual([
        { event: "room_image_insert_unverified", path: PATH },
      ]);
    }
  });

  it("un código o un mensaje que no son cadenas no lanzan: ambiguo, sin borrar", async () => {
    for (const error of [
      { code: 23514, message: "room_images_limit:" },
      { code: "23514", message: 42 },
    ]) {
      const admin = adminClient({
        respond: () => ({ data: null, error: error as unknown as { code: string } }),
      });
      const d = deps(admin);
      const { client } = userClient({ lookup: { data: null, error: null } });
      const result = await addRoomImage(
        client,
        { roomId: ROOM, photo: photo() },
        d.value
      );
      expect(result.ok).toBe(false);
    }
  });
});

describe("listOwnRoomImages: fotos propias con URL firmadas", () => {
  it("sin sesión o con un id no válido, no lee ni firma", async () => {
    const admin = adminClient();
    const d = deps(admin);
    expect(
      await listOwnRoomImages(userClient({ userId: null }).client, ROOM, d.value)
    ).toEqual({
      ok: false,
      error: "unauthenticated",
    });
    const result = await listOwnRoomImages(userClient({}).client, "x", d.value);
    expect(!result.ok && result.error).toBe("validation");
    expect(d.adminCreated()).toBe(0);
  });

  it("una habitación que no es suya: not_found, sin firmar", async () => {
    const admin = adminClient();
    const d = deps(admin);
    const { client } = userClient({ room: null, images: [image(1)] });
    expect(await listOwnRoomImages(client, ROOM, d.value)).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(admin.storageCalls).toHaveLength(0);
  });

  it("devuelve las fotos por orden con URL firmadas; el admin solo firma lo leído", async () => {
    const admin = adminClient();
    const d = deps(admin);
    const rows = [image(1, 0), image(2, 1)];
    const { client } = userClient({ images: rows });
    expect(await listOwnRoomImages(client, ROOM, d.value)).toEqual({
      ok: true,
      data: rows.map((row) => ({
        id: row.id,
        position: row.position,
        url: signed(row.storage_path),
        expiresAt: EXPIRES,
      })),
    });
    expect(admin.calls).toHaveLength(0);
    expect(admin.storageCalls).toEqual([
      {
        op: "sign",
        bucket: "room-images",
        paths: rows.map((r) => r.storage_path),
        expiresIn: 600,
      },
    ]);
  });

  it("orden determinista: position, después created_at y, por último, id (L2)", async () => {
    const { client, calls } = userClient({ images: [image(1)] });
    await listOwnRoomImages(client, ROOM, deps(adminClient()).value);
    const list = calls.find((call) => call.table === "room_images");
    expect(list?.order).toEqual(["position", "created_at", "id"]);
    expect(list?.columns).toBe("id, storage_path, position");
    expect(list?.filters).toEqual([{ kind: "eq", column: "room_id", value: ROOM }]);
  });

  it("la caducidad es la configurada: 600 s por defecto, o la que se inyecte", async () => {
    expect(ROOM_IMAGE_SIGNED_URL_TTL_SECONDS).toBe(600);
    const admin = adminClient();
    const d = deps(admin, { signedUrlTtlSeconds: 120 });
    const { client } = userClient({ images: [image(1)] });
    const result = await listOwnRoomImages(client, ROOM, d.value);
    expect(result.ok && result.data[0].expiresAt).toBe("2026-10-25T10:02:00.000Z");
    expect(admin.storageCalls[0]).toMatchObject({ op: "sign", expiresIn: 120 });
  });

  it("la caducidad se calcula ANTES de pedir la firma (la URL vale al menos hasta ahí)", async () => {
    let clock = NOW.getTime();
    const admin = adminClient({
      signItems: (paths) => {
        clock += 5 * 60 * 1000; // la firma tarda (o el reloj avanza) 5 minutos
        return paths.map((path) => ({ path, signedUrl: signed(path), error: null }));
      },
    });
    const d = deps(admin, { now: () => new Date(clock) });
    const { client } = userClient({ images: [image(1)] });
    const result = await listOwnRoomImages(client, ROOM, d.value);
    expect(result.ok && result.data[0].expiresAt).toBe(EXPIRES);
  });

  it("sin fotos no se firma nada", async () => {
    const admin = adminClient();
    const d = deps(admin);
    expect(
      await listOwnRoomImages(userClient({ images: [] }).client, ROOM, d.value)
    ).toEqual({
      ok: true,
      data: [],
    });
    expect(admin.storageCalls).toHaveLength(0);
  });

  it("si la firma falla entera (error o excepción), unknown: se puede reintentar", async () => {
    for (const options of [{ signError: { message: "caído" } }, { signThrows: true }]) {
      const d = deps(adminClient(options));
      const { client } = userClient({ images: [image(1)] });
      expect(await listOwnRoomImages(client, ROOM, d.value)).toEqual({
        ok: false,
        error: "unknown",
      });
    }
  });

  it("si falla una foto, esa queda sin URL y las demás la tienen", async () => {
    const rows = [image(1, 0), image(2, 1)];
    const admin = adminClient({
      signItems: (paths) => [
        { path: paths[0], signedUrl: null, error: "Object not found" },
        { path: paths[1], signedUrl: signed(paths[1]), error: null },
      ],
    });
    const { client } = userClient({ images: rows });
    const result = await listOwnRoomImages(client, ROOM, deps(admin).value);
    expect(result.ok && result.data.map((i) => [i.url, i.expiresAt])).toEqual([
      [null, null],
      [signed(rows[1].storage_path), EXPIRES],
    ]);
  });

  it("solo firma rutas canónicas de esa habitación (defensa en profundidad)", async () => {
    const good = image(1, 0);
    const otherRoom = {
      ...image(2, 1),
      storage_path: `${OTHER_ROOM}/${image(2).id}.webp`,
    };
    const free = { ...image(3, 2), storage_path: "rooms/a/libre.jpg" };
    const admin = adminClient();
    const { client } = userClient({ images: [good, otherRoom, free] });
    const result = await listOwnRoomImages(client, ROOM, deps(admin).value);
    expect(admin.storageCalls).toEqual([
      { op: "sign", bucket: "room-images", paths: [good.storage_path], expiresIn: 600 },
    ]);
    expect(result.ok && result.data.map((i) => i.url)).toEqual([
      signed(good.storage_path),
      null,
      null,
    ]);
  });

  it("solo acepta URL de rutas pedidas", async () => {
    const row = image(1);
    const admin = adminClient({
      signItems: () => [
        {
          path: `${OTHER_ROOM}/x.webp`,
          signedUrl: "https://signed.test/ajena",
          error: null,
        },
        { path: null, signedUrl: "https://signed.test/sin-ruta", error: null },
        { path: row.storage_path, signedUrl: "", error: null },
      ],
    });
    const { client } = userClient({ images: [row] });
    const result = await listOwnRoomImages(client, ROOM, deps(admin).value);
    expect(result).toEqual({
      ok: true,
      data: [{ id: row.id, position: row.position, url: null, expiresAt: null }],
    });
  });

  it("una URL para la ruta no canónica de una fila leída, que no se pidió, tampoco se acepta", async () => {
    const good = image(1, 0);
    const free = { ...image(2, 1), storage_path: "rooms/a/libre.jpg" };
    const admin = adminClient({
      signItems: (paths) => [
        ...paths.map((path) => ({ path, signedUrl: signed(path), error: null })),
        { path: free.storage_path, signedUrl: signed(free.storage_path), error: null },
      ],
    });
    const { client } = userClient({ images: [good, free] });
    const result = await listOwnRoomImages(client, ROOM, deps(admin).value);
    expect(result.ok && result.data.map((i) => i.url)).toEqual([
      signed(good.storage_path),
      null,
    ]);
  });

  it("cada lectura vuelve a leer y a firmar: sin caché de URL en el servidor", async () => {
    const admin = adminClient();
    const d = deps(admin);
    const { client, calls } = userClient({ images: [image(1)] });
    await listOwnRoomImages(client, ROOM, d.value);
    await listOwnRoomImages(client, ROOM, d.value);
    expect(admin.storageCalls.filter((c) => c.op === "sign")).toHaveLength(2);
    expect(calls.filter((c) => c.table === "room_images")).toHaveLength(2);
  });
});

describe("listRoomImages: fotos de una habitación para quien la mira", () => {
  it("un id no válido: validation, sin leer ni firmar", async () => {
    const d = deps(adminClient());
    const { client, calls } = userClient({});
    const result = await listRoomImages(client, "../otra", d.value);
    expect(!result.ok && result.error).toBe("validation");
    expect(calls).toHaveLength(0);
    expect(d.adminCreated()).toBe(0);
  });

  it("una habitación que la RLS no deja ver (R7, borrador, ajena): not_found sin firmar", async () => {
    const admin = adminClient();
    const d = deps(admin);
    const { client, calls } = userClient({
      userId: null,
      room: null,
      images: [image(1)],
    });
    expect(await listRoomImages(client, ROOM, d.value)).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(calls.map((c) => c.table)).toEqual(["rooms"]);
    expect(admin.storageCalls).toHaveLength(0);
    expect(d.adminCreated()).toBe(0);
  });

  it("anónimo y habitación pública: las fotos leídas, firmadas", async () => {
    const admin = adminClient();
    const rows = [image(1, 0)];
    const { client, calls } = userClient({
      userId: null,
      room: { id: ROOM },
      images: rows,
    });
    expect(await listRoomImages(client, ROOM, deps(admin).value)).toEqual({
      ok: true,
      data: [
        {
          id: rows[0].id,
          position: 0,
          url: signed(rows[0].storage_path),
          expiresAt: EXPIRES,
        },
      ],
    });
    // La habitación se lee sin filtrar por propietario: lo decide la RLS.
    expect(calls[0]).toMatchObject({
      table: "rooms",
      columns: "id",
      filters: [{ kind: "eq", column: "id", value: ROOM }],
    });
  });

  it("la propietaria o el admin de una habitación oculta: la RLS se la deja ver, y se firma", async () => {
    const admin = adminClient();
    const { client } = userClient({ room: { id: ROOM }, images: [image(1)] });
    const result = await listRoomImages(client, ROOM, deps(admin).value);
    expect(result.ok && result.data[0].url).toBe(signed(image(1).storage_path));
  });

  it("un error al leer la habitación: el de la base de datos, sin firmar", async () => {
    const admin = adminClient();
    const { client } = userClient({ roomError: dbError("42501") });
    expect(await listRoomImages(client, ROOM, deps(admin).value)).toEqual({
      ok: false,
      error: "forbidden",
    });
    expect(admin.storageCalls).toHaveLength(0);
  });
});

describe("listRoomCovers: portadas de una página de la búsqueda pública (sesión 71)", () => {
  const cover = (n: number, roomId = ROOM) => ({
    ...image(n, 0, roomId),
    room_id: roomId,
  });

  it("ids no válidos o demasiados: validation, sin leer ni firmar", async () => {
    const tooMany = Array.from(
      { length: ROOM_COVERS_MAX_ROOMS + 1 },
      (_, i) => `${String(i).padStart(8, "0")}-3333-4444-8555-666666666666`
    );
    for (const ids of ["x", [ROOM, "../otra"], tooMany, null]) {
      const d = deps(adminClient());
      const { client, calls } = userClient({});
      const result = await listRoomCovers(client, ids, d.value);
      expect(!result.ok && result.error).toBe("validation");
      expect(calls).toHaveLength(0);
      expect(d.adminCreated()).toBe(0);
    }
  });

  it("lista vacía: sin leer ni firmar", async () => {
    const d = deps(adminClient());
    const { client, calls } = userClient({});
    const result = await listRoomCovers(client, [], d.value);
    expect(result.ok && result.data.covers.size).toBe(0);
    expect(calls).toHaveLength(0);
    expect(d.adminCreated()).toBe(0);
  });

  it("una lectura con el cliente de quien pregunta (ids sin repetir, en minúsculas) y una firma", async () => {
    const admin = adminClient();
    const { client, calls } = userClient({
      userId: null,
      images: [cover(1), cover(2), cover(3, OTHER_ROOM)] as unknown as Images,
    });
    const result = await listRoomCovers(
      client,
      [ROOM, ROOM.toUpperCase(), OTHER_ROOM],
      deps(admin).value
    );
    expect(calls).toEqual([
      expect.objectContaining({
        table: "room_images",
        columns: "id, room_id, storage_path, position",
        filters: [{ kind: "in", column: "room_id", value: [ROOM, OTHER_ROOM] }],
        order: ["position", "created_at", "id"],
      }),
    ]);
    expect(admin.storageCalls).toEqual([
      {
        op: "sign",
        bucket: "room-images",
        paths: [cover(1).storage_path, cover(3, OTHER_ROOM).storage_path],
        expiresIn: 600,
      },
    ]);
    expect(result.ok && Object.fromEntries(result.data.covers)).toEqual({
      [ROOM]: { url: signed(cover(1).storage_path), expiresAt: EXPIRES },
      [OTHER_ROOM]: {
        url: signed(cover(3, OTHER_ROOM).storage_path),
        expiresAt: EXPIRES,
      },
    });
    // service_role solo firma: ninguna lectura de tablas.
    expect(admin.calls).toHaveLength(0);
  });

  it("un error de lectura: el de la base de datos, sin firmar", async () => {
    const admin = adminClient();
    const { client } = userClient({ imagesError: dbError("42501") });
    expect(await listRoomCovers(client, [ROOM], deps(admin).value)).toEqual({
      ok: false,
      error: "forbidden",
    });
    expect(admin.storageCalls).toHaveLength(0);
  });

  it("la firma falla entera: sin portadas y signed: false", async () => {
    const admin = adminClient({ signError: { message: "caído" } });
    const { client } = userClient({ images: [cover(1)] as unknown as Images });
    const result = await listRoomCovers(client, [ROOM], deps(admin).value);
    expect(result.ok && result.data.signed).toBe(false);
    expect(result.ok && result.data.covers.size).toBe(0);
  });
});

describe("deleteRoomImage: primero la fila, después el objeto", () => {
  const visible = { id: IMAGE_ID, room_id: ROOM, storage_path: PATH };

  it("sin sesión, con un id no válido o con la cuenta desactivada: no borra nada", async () => {
    const admin = adminClient();
    const d = deps(admin);
    expect(
      await deleteRoomImage(userClient({ userId: null }).client, IMAGE_ID, d.value)
    ).toEqual({
      ok: false,
      error: "unauthenticated",
    });
    const invalid = await deleteRoomImage(userClient({}).client, "x", d.value);
    expect(!invalid.ok && invalid.error).toBe("validation");
    expect(
      await deleteRoomImage(
        userClient({
          profile: { id: USER, deleted_at: "2026-10-20T00:00:00Z" },
          image: visible,
        }).client,
        IMAGE_ID,
        d.value
      )
    ).toEqual({ ok: false, error: "deleted" });
    expect(d.adminCreated()).toBe(0);
  });

  it("una foto que no ve, o de una habitación pública ajena: not_found sin admin", async () => {
    for (const options of [{ image: null }, { image: visible, room: null }]) {
      const d = deps(adminClient());
      const result = await deleteRoomImage(userClient(options).client, IMAGE_ID, d.value);
      expect(result).toEqual({ ok: false, error: "not_found" });
      expect(d.adminCreated()).toBe(0);
    }
  });

  it("borra la fila (id y habitación) y después el objeto de su ruta", async () => {
    const admin = adminClient();
    const d = deps(admin);
    const { client } = userClient({ image: visible });
    expect(await deleteRoomImage(client, IMAGE_ID, d.value)).toEqual({
      ok: true,
      data: true,
    });
    expect(admin.events).toEqual(["room_images.delete", "storage.remove"]);
    expect(admin.calls[0]).toMatchObject({
      table: "room_images",
      operation: "delete",
      filters: [
        { kind: "eq", column: "id", value: IMAGE_ID },
        { kind: "eq", column: "room_id", value: ROOM },
      ],
    });
    expect(admin.storageCalls).toEqual([
      { op: "remove", bucket: "room-images", paths: [PATH] },
    ]);
  });

  it("también en una habitación retirada (quitar fotos es limpieza)", async () => {
    const admin = adminClient();
    const { client } = userClient({
      image: visible,
      room: { ...OWN_ROOM, status: "removed" },
    });
    expect(await deleteRoomImage(client, IMAGE_ID, deps(admin).value)).toEqual({
      ok: true,
      data: true,
    });
  });

  it("si la fila ya no estaba: not_found, sin tocar Storage", async () => {
    const admin = adminClient({ respond: () => ({ data: null, error: null }) });
    const { client } = userClient({ image: visible });
    expect(await deleteRoomImage(client, IMAGE_ID, deps(admin).value)).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(admin.storageCalls).toHaveLength(0);
  });

  it("si el objeto no se puede borrar: éxito (ya no se ve) y aviso de huérfano", async () => {
    const admin = adminClient({ removeError: { message: "caído" } });
    const d = deps(admin);
    const { client } = userClient({ image: visible });
    expect(await deleteRoomImage(client, IMAGE_ID, d.value)).toEqual({
      ok: true,
      data: true,
    });
    expect(d.recoveries).toEqual([
      { event: "room_image_orphan_after_delete", path: PATH },
    ]);
  });

  it("una ruta que no es la canónica de la fila nunca se borra de Storage", async () => {
    const admin = adminClient();
    const d = deps(admin);
    const { client } = userClient({
      image: { ...visible, storage_path: `${OTHER_ROOM}/x.webp` },
    });
    expect(await deleteRoomImage(client, IMAGE_ID, d.value)).toEqual({
      ok: true,
      data: true,
    });
    expect(admin.storageCalls).toHaveLength(0);
    expect(d.recoveries).toEqual([
      { event: "room_image_orphan_after_delete", path: `${OTHER_ROOM}/x.webp` },
    ]);
  });

  it("un error al borrar la fila: el traducido, sin tocar Storage", async () => {
    const admin = adminClient({ respond: () => dbError("23514", "account_deleted:") });
    const { client } = userClient({ image: visible });
    expect(await deleteRoomImage(client, IMAGE_ID, deps(admin).value)).toEqual({
      ok: false,
      error: "deleted",
    });
    expect(admin.storageCalls).toHaveLength(0);
  });
});

describe("avisos y URL: sin datos sensibles", () => {
  const source = readFileSync("lib/services/room-images.ts", "utf8");
  const code = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");

  it("el único registro es el aviso por defecto: evento y ruta, nada más", () => {
    expect(code.match(/console\.\w+\(/g)).toEqual(["console.warn("]);
    expect(code).toContain("console.warn(`[room-images] ${event}: ${storagePath}`)");
  });

  it("no construye URL públicas ni guarda las firmadas", () => {
    expect(code).not.toMatch(/getPublicUrl|object\/public/);
    expect(code).not.toMatch(/new Map<[^>]*>\(\)[^;]*cache/i);
    expect(code).toContain(".createSignedUrls(paths, ttl)");
  });

  it("con las dependencias por defecto, el aviso es una línea con el evento y la ruta canónica", async () => {
    const admin = adminClient({ uploadError: { message: "fallo de red" } });
    defaultAdmin.current = admin.client;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const jpeg = await sharp({
        create: { width: 16, height: 16, channels: 3, background: "#456" },
      })
        .jpeg()
        .toBuffer();
      const file = new File([new Uint8Array(jpeg)], "IMG_0001 casa de Ana.jpg", {
        type: "image/jpeg",
      });
      const { client } = userClient({});
      expect(await addRoomImage(client, { roomId: ROOM, photo: file })).toEqual({
        ok: false,
        error: "unknown",
      });
      expect(warn).toHaveBeenCalledTimes(1);
      const [line] = warn.mock.calls[0];
      expect(line).toMatch(
        new RegExp(
          `^\\[room-images\\] room_image_upload_unconfirmed: ${ROOM}/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\.webp$`
        )
      );
      // La subida usa la imagen limpia (WebP), no el archivo original.
      const upload = admin.storageCalls[0];
      expect(
        upload.op === "upload" &&
          Buffer.from(upload.body as Buffer)
            .subarray(8, 12)
            .toString("latin1")
      ).toBe("WEBP");
    } finally {
      warn.mockRestore();
      defaultAdmin.current = null;
    }
  });
});
