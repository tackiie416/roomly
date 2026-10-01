// Adaptador de buzón SOLO para el ensayo local del spec real contra el
// Supabase simulado (nunca en el workflow). Implementa la misma interfaz que
// el adaptador del proveedor real (ver tests/e2e/real/e2e-real-lib.mjs).
import { MOCK_SUPABASE_URL } from "./mock-config.mjs";

export function createMailbox(env) {
  if (
    env.GITHUB_ACTIONS === "true" ||
    !String(env.SUPABASE_VALIDATION_URL ?? "").startsWith("http://127.0.0.1:")
  ) {
    throw new Error("el buzón simulado solo se usa contra el Supabase simulado");
  }
  return {
    async waitForMagicLink({ to, timeoutMs }) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const response = await fetch(
          `${MOCK_SUPABASE_URL}/__test/outbox?email=${encodeURIComponent(to)}`
        );
        if (response.ok) return (await response.json()).link;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      throw new Error("no llegó ningún email al buzón simulado");
    },
    async deleteMessages() {},
  };
}
