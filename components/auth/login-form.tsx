"use client";

import { useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { serializeNextCookie } from "@/lib/auth/next-cookie";
import { LOGIN_ERROR_MESSAGES, otpErrorCode } from "@/lib/auth/login-errors";

type Status = "idle" | "sending" | "sent" | "error";

/**
 * Formulario de acceso por magic link. `next` y `initialError` llegan ya
 * saneados desde la página de servidor. Antes de pedir el enlace se guarda
 * `next` en una cookie de corta duración (ver lib/auth/next-cookie.ts);
 * `emailRedirectTo` sigue siendo exactamente `/callback`.
 */
export function LoginForm({
  next,
  initialError,
}: {
  next: string | null;
  initialError: string | null;
}) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>(initialError ? "error" : "idle");
  const [errorMessage, setErrorMessage] = useState(initialError ?? "");

  function rememberNext() {
    document.cookie = serializeNextCookie(next, {
      secure: window.location.protocol === "https:",
    });
  }

  async function handleMagicLink(event: FormEvent) {
    event.preventDefault();
    setStatus("sending");
    setErrorMessage("");
    rememberNext();

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/callback` },
    });

    if (error) {
      setStatus("error");
      setErrorMessage(LOGIN_ERROR_MESSAGES[otpErrorCode(error)]);
      return;
    }
    setStatus("sent");
  }

  async function handleGoogle() {
    rememberNext();
    const supabase = createClient();
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/callback` },
    });
  }

  return (
    <main className="mx-auto flex min-h-[calc(100vh-65px)] max-w-sm flex-col justify-center p-8">
      <Card className="flex flex-col gap-6">
        <div>
          <h1 className="text-xl font-medium">Entrar en Roomly</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Te enviamos un enlace de acceso — sin contraseña.
          </p>
        </div>

        {status === "sent" ? (
          <p className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4 text-sm">
            Revisa tu correo: te hemos enviado un enlace para entrar.
          </p>
        ) : (
          <form onSubmit={handleMagicLink} className="flex flex-col gap-3">
            <Input
              type="email"
              required
              placeholder="tucorreo@ejemplo.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
            />
            <Button type="submit" disabled={status === "sending"}>
              {status === "sending" ? "Enviando…" : "Enviar enlace"}
            </Button>
            {status === "error" && errorMessage && (
              <p role="alert" className="text-sm text-red-600">
                {errorMessage}
              </p>
            )}
          </form>
        )}

        <div className="flex items-center gap-3 text-xs text-[var(--muted)]">
          <div className="h-px flex-1 bg-[var(--border)]" />o
          <div className="h-px flex-1 bg-[var(--border)]" />
        </div>

        <Button variant="secondary" onClick={handleGoogle}>
          Continuar con Google
        </Button>
      </Card>
    </main>
  );
}
