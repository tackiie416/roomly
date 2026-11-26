import Link from "next/link";
import { blockUserAction } from "@/app/actions/safety";
import { reportPath } from "@/lib/safety/paths";
import { Button } from "@/components/ui/button";

/**
 * «Bloquear» y «Reportar» (sesión 83), sin JavaScript: un `<details>` que
 * explica qué pasa al bloquear, con su formulario, y un enlace a la página de
 * reporte. Solo envía el id de la otra persona; quién bloquea sale de la
 * sesión, y el servidor y la base de datos aplican el resto.
 */
export function SafetyActions({ targetId, name }: { targetId: string; name: string }) {
  return (
    <div className="flex flex-col gap-2 text-sm" data-testid="safety-actions">
      <details data-testid="block-user">
        <summary className="cursor-pointer text-[var(--muted)] underline">
          Bloquear<span className="sr-only"> a {name}</span>
        </summary>
        <form action={blockUserAction} className="mt-2 flex flex-col items-start gap-2">
          <input type="hidden" name="targetId" value={targetId} />
          <p>
            Si bloqueas a esta persona, dejaréis de veros en Explorar, se deshace el match
            si lo hay, se retiran los intereses y el chat se cierra para las dos. No podrá
            enviarte intereses ni mensajes. No se le avisa. Puedes desbloquearla en
            Ajustes, pero lo que se borra no vuelve.
          </p>
          <Button type="submit" variant="secondary">
            Sí, bloquear<span className="sr-only"> a {name}</span>
          </Button>
        </form>
      </details>
      <p>
        <Link
          href={reportPath(targetId)}
          className="text-[var(--muted)] underline"
          data-testid="report-link"
        >
          Reportar<span className="sr-only"> a {name}</span>
        </Link>
      </p>
    </div>
  );
}
