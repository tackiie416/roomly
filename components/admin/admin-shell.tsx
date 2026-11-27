import { AdminNav, type AdminSection } from "@/components/admin/admin-nav";
import { adminNotice } from "@/lib/admin/format";

/** Contenedor común de las páginas del panel: título, navegación y aviso. */
export function AdminShell({
  section,
  title,
  description,
  notice,
  children,
}: {
  section: AdminSection;
  title: string;
  description?: string;
  notice?: string | string[];
  children: React.ReactNode;
}) {
  const message = adminNotice(notice);
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 py-6 sm:px-8">
      <AdminNav current={section} />
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-medium">{title}</h1>
        {description ? (
          <p className="text-sm text-[var(--muted)]">{description}</p>
        ) : null}
      </header>
      {message ? (
        <p
          role={message.tone === "error" ? "alert" : "status"}
          data-testid="admin-notice"
          className={
            message.tone === "error"
              ? "rounded-[var(--radius)] border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-100"
              : "rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-3 text-sm"
          }
        >
          {message.text}
        </p>
      ) : null}
      {children}
    </main>
  );
}

/** Estado vacío de un listado. */
export function AdminEmpty({
  children,
  testId,
}: {
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <p
      data-testid={testId}
      className="rounded-[var(--radius)] border border-dashed border-[var(--border)] p-6 text-center text-sm text-[var(--muted)]"
    >
      {children}
    </p>
  );
}

/** Etiqueta pequeña de estado. */
export function AdminBadge({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "warning" | "danger" | "ok";
}) {
  const tones = {
    neutral: "border-[var(--border)] text-[var(--muted)]",
    ok: "border-emerald-300 text-emerald-800 dark:border-emerald-800 dark:text-emerald-200",
    warning: "border-amber-300 text-amber-900 dark:border-amber-800 dark:text-amber-200",
    danger: "border-red-300 text-red-800 dark:border-red-900 dark:text-red-200",
  } as const;
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${tones[tone]}`}
    >
      {children}
    </span>
  );
}
