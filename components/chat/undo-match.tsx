import { undoMatchAction } from "@/app/actions/interests";
import { Button } from "@/components/ui/button";

/**
 * «Deshacer match» (Fase 6), sin JavaScript: un `<details>` que explica qué
 * pasa y un formulario con la Server Action. Solo envía el id de la otra
 * persona; el servidor comprueba que el match es propio.
 */
export function UndoMatch({ targetId, name }: { targetId: string; name: string }) {
  return (
    <details className="text-sm" data-testid="undo-match">
      <summary className="cursor-pointer text-[var(--muted)] underline">
        Deshacer match<span className="sr-only"> con {name}</span>
      </summary>
      <form action={undoMatchAction} className="mt-2 flex flex-col items-start gap-2">
        <input type="hidden" name="targetId" value={targetId} />
        <p>
          Si deshaces el match, el chat se cierra para las dos personas: ninguna podrá
          leerlo ni escribir. Los intereses se retiran y podréis volver a enviarlos.
        </p>
        <Button type="submit" variant="secondary">
          Sí, deshacer el match<span className="sr-only"> con {name}</span>
        </Button>
      </form>
    </details>
  );
}
