import type { AdminHistoryEntry } from "@/lib/services/admin";
import { adminDateText, labelOr } from "@/lib/admin/format";
import { ADMIN_ACTION_LABELS } from "@/lib/validation/admin";
import { AdminEmpty } from "@/components/admin/admin-shell";

/** Historial de administración de una cuenta o una habitación (solo lectura). */
export function AdminHistory({ entries }: { entries: AdminHistoryEntry[] }) {
  return (
    <section aria-labelledby="admin-history-title" className="flex flex-col gap-2">
      <h2 id="admin-history-title" className="font-medium">
        Historial de administración
      </h2>
      {entries.length === 0 ? (
        <AdminEmpty testId="admin-history-empty">Sin acciones registradas.</AdminEmpty>
      ) : (
        <ol className="flex flex-col gap-2" data-testid="admin-history">
          {entries.map((entry, index) => (
            <li
              key={`${entry.createdAt}-${index}`}
              className="rounded-[var(--radius)] border border-[var(--border)] p-3 text-sm"
            >
              <div className="flex flex-wrap justify-between gap-2">
                <strong className="font-medium">
                  {labelOr(ADMIN_ACTION_LABELS, entry.action)}
                </strong>
                <span className="text-xs text-[var(--muted)]">
                  {adminDateText(entry.createdAt)} · {entry.adminName ?? "Administración"}
                </span>
              </div>
              {entry.notes ? (
                <p className="mt-1 whitespace-pre-line break-words">{entry.notes}</p>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
