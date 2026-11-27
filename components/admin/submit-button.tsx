"use client";

import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";

/**
 * Botón de envío con estado de carga (Fase 7). Sin JavaScript es un botón
 * normal; con JavaScript se desactiva mientras se envía para no repetir una
 * acción sensible por un doble clic.
 */
export function AdminSubmitButton({
  children,
  pendingText = "Guardando…",
  variant = "secondary",
  testId,
}: {
  children: React.ReactNode;
  pendingText?: string;
  variant?: "primary" | "secondary" | "ghost";
  testId?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant={variant}
      disabled={pending}
      data-testid={testId}
      aria-busy={pending}
    >
      {pending ? pendingText : children}
    </Button>
  );
}
