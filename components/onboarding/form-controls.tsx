"use client";

import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";

/** Mensajes de error de un campo, enlazables con `aria-describedby`. */
export function FieldError({ id, messages }: { id: string; messages?: string[] }) {
  if (!messages || messages.length === 0) return null;
  return (
    <p id={id} className="mt-1 text-sm text-red-600">
      {messages.join(" ")}
    </p>
  );
}

/** Error general del formulario (nunca texto de Supabase: viene de la Server Action). */
export function FormError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="text-sm text-red-600">
      {message}
    </p>
  );
}

/** Botón de envío deshabilitado mientras la Server Action está en curso. */
export function SubmitButton({
  label,
  pendingLabel,
}: {
  label: string;
  pendingLabel: string;
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} aria-disabled={pending}>
      {pending ? pendingLabel : label}
    </Button>
  );
}

export const labelClass = "text-sm font-medium";
export const hintClass = "text-xs text-[var(--muted)]";
