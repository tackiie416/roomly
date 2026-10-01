import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  LOGIN_ERROR_MESSAGES,
  callbackErrorCode,
  otpErrorCode,
  toLoginErrorCode,
} from "@/lib/auth/login-errors";

const sessionMock = vi.hoisted(() => ({ state: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getCurrentProfileState: sessionMock.state }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { url });
  },
}));

const RAW_SUPABASE = "Email rate limit exceeded <script>alert(1)</script>";

describe("toLoginErrorCode", () => {
  it("acepta solo los códigos conocidos por URL", () => {
    expect(toLoginErrorCode("auth_callback_failed")).toBe("auth_callback_failed");
    expect(toLoginErrorCode("link_expired")).toBe("link_expired");
  });

  it("ignora cualquier otro texto (no se refleja en la página)", () => {
    for (const value of [
      RAW_SUPABASE,
      "rate_limited",
      "Invalid JWT",
      "",
      null,
      undefined,
    ]) {
      expect(toLoginErrorCode(value)).toBeNull();
    }
  });
});

describe("callbackErrorCode", () => {
  it("enlace caducado o flujo PKCE perdido → link_expired", () => {
    for (const code of ["otp_expired", "flow_state_expired", "flow_state_not_found"]) {
      expect(callbackErrorCode(code)).toBe("link_expired");
    }
  });

  it("cualquier otro error → auth_callback_failed", () => {
    for (const code of ["bad_code_verifier", "access_denied", "", null, RAW_SUPABASE]) {
      expect(callbackErrorCode(code)).toBe("auth_callback_failed");
    }
  });
});

describe("otpErrorCode", () => {
  it("rate limit → rate_limited", () => {
    expect(otpErrorCode({ status: 429 })).toBe("rate_limited");
    expect(otpErrorCode({ code: "over_email_send_rate_limit" })).toBe("rate_limited");
  });

  it("email inválido → invalid_email", () => {
    expect(otpErrorCode({ code: "email_address_invalid" })).toBe("invalid_email");
  });

  it("resto (incluido signups desactivados) → send_failed", () => {
    expect(otpErrorCode({ code: "signup_disabled" })).toBe("send_failed");
    expect(otpErrorCode({})).toBe("send_failed");
  });

  it("los mensajes son propios, en español, sin texto de Supabase", () => {
    for (const message of Object.values(LOGIN_ERROR_MESSAGES)) {
      expect(message).not.toMatch(/supabase|rate limit|jwt|<|>/i);
    }
  });
});

describe("LoginPage", () => {
  beforeEach(() => {
    sessionMock.state.mockReset();
  });

  async function render(params: Record<string, string>) {
    const { default: LoginPage } = await import("@/app/(auth)/login/page");
    return LoginPage({ searchParams: Promise.resolve(params) });
  }

  it("sin sesión: pasa al formulario el mensaje propio del código de error", async () => {
    sessionMock.state.mockResolvedValue({ ok: false, error: "unauthenticated" });
    const element = await render({ error: "link_expired", next: "/perfil" });
    expect(element.props).toEqual({
      next: "/perfil",
      initialError: LOGIN_ERROR_MESSAGES.link_expired,
    });
  });

  it("un error desconocido o con texto crudo no se muestra", async () => {
    sessionMock.state.mockResolvedValue({ ok: false, error: "unauthenticated" });
    const element = await render({ error: RAW_SUPABASE });
    expect(element.props.initialError).toBeNull();
    expect(JSON.stringify(element.props)).not.toContain("script");
  });

  it("next malicioso o excluido no llega al formulario", async () => {
    sessionMock.state.mockResolvedValue({ ok: false, error: "unauthenticated" });
    for (const next of [
      "https://evil.com",
      "//evil.com",
      "/login",
      "/bienvenida/perfil",
    ]) {
      expect((await render({ next })).props.next).toBeNull();
    }
  });

  it("con sesión: redirige según el estado del perfil", async () => {
    const cases = [
      [{ status: "no_profile" }, "/perfil", "/bienvenida/perfil"],
      [{ status: "incomplete" }, "/perfil", "/bienvenida/preferencias"],
      [{ status: "complete" }, "/perfil", "/perfil"],
      [{ status: "complete" }, "https://evil.com", "/"],
      [{ status: "deleted" }, "/perfil", "/cuenta-desactivada"],
    ] as const;
    for (const [state, next, expected] of cases) {
      sessionMock.state.mockResolvedValue({ ok: true, data: state });
      await expect(render({ next })).rejects.toMatchObject({ url: expected });
    }
  });
});
