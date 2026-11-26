import { expressInterest, retractInterest } from "@/app/actions/interests";
import type { InterestState } from "@/lib/services/interests";
import { Button } from "@/components/ui/button";

/**
 * Botones de «Me interesa» (Fase 5.1). Formularios normales (sin JavaScript)
 * con las Server Actions de app/actions/interests.ts; solo envían el id de la
 * otra persona y a qué página volver.
 */
export function InterestActions({
  targetId,
  name,
  state,
  back,
  page,
}: {
  targetId: string;
  name: string;
  state: InterestState | undefined;
  back: "explorar" | "matches";
  page?: number;
}) {
  const hidden = (
    <>
      <input type="hidden" name="targetId" value={targetId} />
      <input type="hidden" name="volver" value={back} />
      {page && page > 1 ? (
        <input type="hidden" name="pagina" value={String(page)} />
      ) : null}
    </>
  );

  if (state === "matched") {
    return (
      <p className="text-sm font-medium" data-testid="interest-state">
        ✓ Tenéis un match
      </p>
    );
  }
  if (state === "sent") {
    return (
      <form action={retractInterest} className="flex flex-wrap items-center gap-3">
        {hidden}
        <span className="text-sm" data-testid="interest-state">
          Le has enviado «Me interesa»
        </span>
        <Button type="submit" variant="secondary">
          Retirar<span className="sr-only"> el interés en {name}</span>
        </Button>
      </form>
    );
  }
  return (
    <form action={expressInterest} className="flex flex-wrap items-center gap-3">
      {hidden}
      {state === "received" ? (
        <span className="text-sm" data-testid="interest-state">
          Te ha mostrado interés
        </span>
      ) : null}
      <Button type="submit">
        {state === "received" ? "Hacer match" : "Me interesa"}
        <span className="sr-only"> ({name})</span>
      </Button>
    </form>
  );
}
