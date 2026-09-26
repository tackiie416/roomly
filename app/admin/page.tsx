export default function AdminPage() {
  return (
    <main className="mx-auto max-w-3xl p-8">
      <h1 className="text-2xl font-medium">Panel de administración</h1>
      <p className="mt-2 text-[var(--muted)]">
        Foundation lista: si ves esto, la protección de ruta (sesión + rol de
        administrador) funciona. Usuarios, habitaciones, reportes y métricas llegan en la
        Fase 7.
      </p>
    </main>
  );
}
