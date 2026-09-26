import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-[calc(100vh-65px)] max-w-md flex-col items-center justify-center gap-3 p-8 text-center">
      <h1 className="text-2xl font-medium">Página no encontrada</h1>
      <p className="text-[var(--muted)]">No existe lo que buscas.</p>
      <Link href="/" className="text-sm underline">
        Volver al inicio
      </Link>
    </main>
  );
}
