"use client";

/**
 * Error de cualquier página (Fase 2.7). Nunca muestra `error.message`, el
 * stack ni el `digest`: pueden contener detalles internos (Supabase, SQL…).
 * Solo un mensaje genérico y «Reintentar» (`reset`, que vuelve a renderizar el
 * segmento). El detalle de los errores de servidor queda en los logs del
 * servidor de Next.js.
 */
export const GENERIC_ERROR_TITLE = "Algo ha fallado";
export const GENERIC_ERROR_MESSAGE =
  "No hemos podido cargar esta página. Vuelve a intentarlo en un momento.";

export default function RouteError({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="mx-auto flex min-h-[calc(100vh-65px)] max-w-md flex-col items-center justify-center gap-3 p-8 text-center">
      <h1 className="text-2xl font-medium">{GENERIC_ERROR_TITLE}</h1>
      <p className="text-sm text-[var(--muted)]">{GENERIC_ERROR_MESSAGE}</p>
      <button type="button" onClick={reset} className="text-sm underline">
        Reintentar
      </button>
    </main>
  );
}
