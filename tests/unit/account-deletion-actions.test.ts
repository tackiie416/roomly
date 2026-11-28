import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAccountForDeletion: vi.fn(),
  deleteOwnAccount: vi.fn(),
  signOut: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({
  ACCOUNT_DELETION_PATH: "/ajustes/eliminar-cuenta",
  requireAccountForDeletion: mocks.requireAccountForDeletion,
}));
vi.mock("@/lib/services/account-deletion", () => ({
  deleteOwnAccount: mocks.deleteOwnAccount,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { signOut: mocks.signOut } }),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { url });
  },
}));

import { deleteAccountAction } from "@/app/actions/account-deletion";

// Sesión 87 — Server Action de /ajustes/eliminar-cuenta: guard, campos del
// formulario tal cual (el servicio decide), cierre de sesión local y destino.

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
};
const redirectsTo = (url: string) => expect.objectContaining({ url });

beforeEach(() => {
  mocks.requireAccountForDeletion.mockReset().mockResolvedValue({ status: "active" });
  mocks.deleteOwnAccount.mockReset();
  mocks.signOut.mockReset().mockResolvedValue({ error: null });
});

describe("deleteAccountAction", () => {
  it("éxito: cierra la sesión local y lleva a /cuenta-eliminada", async () => {
    mocks.deleteOwnAccount.mockResolvedValue({ ok: true, data: { deleted: true } });
    await expect(
      deleteAccountAction(form({ confirmation: "ELIMINAR", acknowledge: "on" }))
    ).rejects.toEqual(redirectsTo("/cuenta-eliminada"));
    expect(mocks.deleteOwnAccount.mock.calls[0][1]).toEqual({
      confirmation: "ELIMINAR",
      acknowledge: true,
    });
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("un campo de más llega al servicio (que lo rechaza): nunca se usa como id", async () => {
    mocks.deleteOwnAccount.mockResolvedValue({ ok: false, error: "validation" });
    await expect(
      deleteAccountAction(
        form({ confirmation: "ELIMINAR", acknowledge: "on", userId: "otro" })
      )
    ).rejects.toEqual(redirectsTo("/ajustes/eliminar-cuenta?aviso=confirmacion"));
    expect(mocks.deleteOwnAccount.mock.calls[0][1]).toMatchObject({ userId: "otro" });
    expect(mocks.signOut).not.toHaveBeenCalled();
  });

  it("sin la casilla: acknowledge false", async () => {
    mocks.deleteOwnAccount.mockResolvedValue({ ok: false, error: "validation" });
    await expect(deleteAccountAction(form({ confirmation: "ELIMINAR" }))).rejects.toEqual(
      redirectsTo("/ajustes/eliminar-cuenta?aviso=confirmacion")
    );
    expect(mocks.deleteOwnAccount.mock.calls[0][1]).toEqual({
      confirmation: "ELIMINAR",
      acknowledge: false,
    });
  });

  it("pendiente: vuelve con el aviso y no cierra la sesión", async () => {
    mocks.deleteOwnAccount.mockResolvedValue({ ok: false, error: "conflict" });
    await expect(
      deleteAccountAction(form({ confirmation: "ELIMINAR", acknowledge: "on" }))
    ).rejects.toEqual(redirectsTo("/ajustes/eliminar-cuenta?aviso=pendiente"));
    expect(mocks.signOut).not.toHaveBeenCalled();
  });

  it("sin sesión: al login con next", async () => {
    mocks.deleteOwnAccount.mockResolvedValue({ ok: false, error: "unauthenticated" });
    await expect(
      deleteAccountAction(form({ confirmation: "ELIMINAR", acknowledge: "on" }))
    ).rejects.toEqual(
      expect.objectContaining({ url: expect.stringMatching(/^\/login/) })
    );
  });

  it("si el guard redirige, no llama al servicio", async () => {
    mocks.requireAccountForDeletion.mockRejectedValue(
      Object.assign(new Error("NEXT_REDIRECT"), { url: "/login" })
    );
    await expect(
      deleteAccountAction(form({ confirmation: "ELIMINAR", acknowledge: "on" }))
    ).rejects.toEqual(redirectsTo("/login"));
    expect(mocks.deleteOwnAccount).not.toHaveBeenCalled();
  });

  it("un fallo al cerrar la sesión local no impide el destino", async () => {
    mocks.deleteOwnAccount.mockResolvedValue({ ok: true, data: { deleted: true } });
    mocks.signOut.mockRejectedValue(new Error("red"));
    await expect(
      deleteAccountAction(form({ confirmation: "ELIMINAR", acknowledge: "on" }))
    ).rejects.toEqual(redirectsTo("/cuenta-eliminada"));
  });
});
