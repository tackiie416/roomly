import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  moderateUser: vi.fn(),
  moderateRoom: vi.fn(),
  requireAdmin: vi.fn(),
  revalidatePath: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ client: true }),
}));
vi.mock("@/lib/auth/session", () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock("@/lib/services/admin", () => ({
  moderateUser: mocks.moderateUser,
  moderateRoom: mocks.moderateRoom,
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { url });
  },
}));

import { moderateRoomAction, moderateUserAction } from "@/app/actions/admin";

// Fase 7 — Server Actions del panel: guard de admin primero, solo los campos
// del formulario y avisos sin detalles. La autorización final es de la base
// de datos (tests/db/29).

const USER = "d0000000-0000-4000-8000-000000000001";
const ROOM = "f0000000-0000-4000-8000-000000000001";
const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
};
const redirectOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return (error as { url?: string }).url;
  }
  throw new Error("sin redirect");
};
const valid = { reason: "spam reiterado", confirm: "on" };

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.requireAdmin.mockResolvedValue(undefined);
});

describe("moderateUserAction", () => {
  it.each([
    ["suspend", "suspendida"],
    ["reactivate", "reactivada"],
  ])("%s → aviso %s en la ficha", async (action, notice) => {
    mocks.moderateUser.mockResolvedValue({ ok: true, data: { result: "x" } });
    expect(
      await redirectOf(moderateUserAction(form({ targetId: USER, action, ...valid })))
    ).toBe(`/admin/usuarios/${USER}?aviso=${notice}`);
    expect(mocks.moderateUser).toHaveBeenCalledWith({ client: true }, action, {
      targetId: USER,
      reason: "spam reiterado",
      confirm: "on",
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/usuarios");
  });

  it("sin admin, el guard redirige antes de llamar al servicio", async () => {
    mocks.requireAdmin.mockRejectedValue(
      Object.assign(new Error("NEXT_REDIRECT"), { url: "/" })
    );
    expect(
      await redirectOf(
        moderateUserAction(form({ targetId: USER, action: "suspend", ...valid }))
      )
    ).toBe("/");
    expect(mocks.moderateUser).not.toHaveBeenCalled();
  });

  it.each([
    ["una acción inventada", { targetId: USER, action: "promote", ...valid }],
    [
      "un campo de más (role)",
      { targetId: USER, action: "suspend", role: "admin", ...valid },
    ],
    [
      "un admin_id inyectado",
      { targetId: USER, action: "suspend", adminId: USER, ...valid },
    ],
  ])("%s: error sin llamar al servicio", async (_n, fields) => {
    expect(await redirectOf(moderateUserAction(form(fields)))).toBe(
      `/admin/usuarios/${USER}?aviso=error`
    );
    expect(mocks.moderateUser).not.toHaveBeenCalled();
  });

  it("un id que no es UUID vuelve al listado, no a una ruta construida con él", async () => {
    mocks.moderateUser.mockResolvedValue({ ok: false, error: "not_found" });
    expect(
      await redirectOf(
        moderateUserAction(form({ targetId: "../../x", action: "suspend", ...valid }))
      )
    ).toBe("/admin/usuarios?aviso=no-encontrado");
  });

  it.each([
    ["validation", "invalido"],
    ["conflict", "conflicto"],
    ["not_found", "no-encontrado"],
    ["unknown", "error"],
  ])("%s → aviso %s", async (error, notice) => {
    mocks.moderateUser.mockResolvedValue({ ok: false, error });
    expect(
      await redirectOf(
        moderateUserAction(form({ targetId: USER, action: "suspend", ...valid }))
      )
    ).toBe(`/admin/usuarios/${USER}?aviso=${notice}`);
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("si la base de datos dice forbidden, fuera del panel", async () => {
    mocks.moderateUser.mockResolvedValue({ ok: false, error: "forbidden" });
    expect(
      await redirectOf(
        moderateUserAction(form({ targetId: USER, action: "suspend", ...valid }))
      )
    ).toBe("/");
  });
});

describe("moderateRoomAction", () => {
  it.each([
    ["remove", "retirada"],
    ["restore", "restaurada"],
  ])("%s → aviso %s", async (action, notice) => {
    mocks.moderateRoom.mockResolvedValue({ ok: true, data: { result: "x" } });
    expect(
      await redirectOf(moderateRoomAction(form({ targetId: ROOM, action, ...valid })))
    ).toBe(`/admin/habitaciones/${ROOM}?aviso=${notice}`);
  });

  it("una acción de usuario no vale para habitaciones", async () => {
    expect(
      await redirectOf(
        moderateRoomAction(form({ targetId: ROOM, action: "suspend", ...valid }))
      )
    ).toBe(`/admin/habitaciones/${ROOM}?aviso=error`);
    expect(mocks.moderateRoom).not.toHaveBeenCalled();
  });
});
