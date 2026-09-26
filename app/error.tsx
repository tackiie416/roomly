"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="mx-auto flex min-h-[calc(100vh-65px)] max-w-md flex-col items-center justify-center gap-3 p-8 text-center">
      <h1 className="text-2xl font-medium">Algo ha fallado</h1>
      <p className="text-sm text-[var(--muted)]">{error.message}</p>
      <button onClick={reset} className="text-sm underline">
        Reintentar
      </button>
    </main>
  );
}
