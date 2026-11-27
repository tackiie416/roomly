"use client";

import Link from "next/link";

/**
 * Error de una página de /admin (Fase 7). Como `app/error.tsx`: nunca muestra
 * `error.message`, el stack ni el `digest`.
 */
export default function AdminError({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="mx-auto flex max-w-md flex-col items-center gap-3 px-4 py-16 text-center">
      <h1 className="text-2xl font-medium">Algo ha fallado</h1>
      <p className="text-sm text-[var(--muted)]">
        No hemos podido cargar esta sección del panel. Vuelve a intentarlo en un momento.
      </p>
      <p className="flex gap-4 text-sm">
        <button type="button" onClick={reset} className="underline">
          Reintentar
        </button>
        <Link href="/admin" className="underline">
          Volver al panel
        </Link>
      </p>
    </main>
  );
}
