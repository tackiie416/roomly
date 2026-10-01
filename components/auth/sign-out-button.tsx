import { signOut } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";

/** Botón de cerrar sesión: un formulario que llama a la Server Action. */
export function SignOutButton({
  variant = "secondary",
}: {
  variant?: "primary" | "secondary";
}) {
  return (
    <form action={signOut}>
      <Button type="submit" variant={variant}>
        Cerrar sesión
      </Button>
    </form>
  );
}
