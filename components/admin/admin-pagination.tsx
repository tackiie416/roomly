import Link from "next/link";

/** Paginación GET (Fase 7): conserva los filtros y cambia solo `pagina`. */
export function AdminPagination({
  basePath,
  params,
  page,
  pageCount,
  total,
}: {
  basePath: string;
  params: Record<string, string>;
  page: number;
  pageCount: number;
  total: number;
}) {
  const href = (target: number) => {
    const query = new URLSearchParams({ ...params });
    if (target > 1) query.set("pagina", String(target));
    else query.delete("pagina");
    const text = query.toString();
    return text ? `${basePath}?${text}` : basePath;
  };
  return (
    <nav
      aria-label="Paginación"
      className="flex flex-wrap items-center justify-between gap-3 text-sm"
      data-testid="admin-pagination"
    >
      <span className="text-[var(--muted)]">
        {total === 1 ? "1 resultado" : `${total} resultados`} · página {page} de{" "}
        {pageCount}
      </span>
      <span className="flex gap-3">
        {page > 1 ? (
          <Link href={href(page - 1)} className="underline" rel="prev">
            ← Anterior
          </Link>
        ) : null}
        {page < pageCount ? (
          <Link href={href(page + 1)} className="underline" rel="next">
            Siguiente →
          </Link>
        ) : null}
      </span>
    </nav>
  );
}
