"use client";

import "./globals.css";

/**
 * Error del layout raíz (Fase 2.7): sustituye al layout entero, así que
 * incluye su propio `<html>` y `<body>`. Mismo criterio que `app/error.tsx`:
 * sin `error.message`, stack ni `digest`; solo un mensaje genérico y
 * «Reintentar».
 */
export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="es">
      <body className="antialiased">
        <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-3 p-8 text-center">
          <h1 className="text-2xl font-medium">Algo ha fallado</h1>
          <p className="text-sm text-[var(--muted)]">
            No hemos podido cargar Roomly. Vuelve a intentarlo en un momento.
          </p>
          <button type="button" onClick={reset} className="text-sm underline">
            Reintentar
          </button>
        </main>
      </body>
    </html>
  );
}
