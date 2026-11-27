import { AdminSubmitButton } from "@/components/admin/submit-button";
import { ADMIN_REASON_MAX_LENGTH } from "@/lib/validation/admin";

/**
 * Formulario de una acción sensible (suspender, reactivar, retirar,
 * restaurar). Funciona sin JavaScript: el motivo y la casilla de confirmación
 * son obligatorios en el navegador (`required`) y, de verdad, en el servidor
 * (`adminActionSchema`) y en la base de datos (`admin_clean_reason`).
 */
export function ConfirmActionForm({
  action,
  targetId,
  actionName,
  title,
  explanation,
  confirmLabel,
  submitLabel,
  danger = false,
  testId,
}: {
  action: (formData: FormData) => Promise<void>;
  targetId: string;
  actionName: string;
  title: string;
  explanation: string;
  confirmLabel: string;
  submitLabel: string;
  danger?: boolean;
  testId: string;
}) {
  const reasonId = `${testId}-reason`;
  const confirmId = `${testId}-confirm`;
  return (
    <form
      action={action}
      data-testid={testId}
      className={`flex flex-col gap-3 rounded-[var(--radius-lg)] border p-4 ${
        danger ? "border-red-300 dark:border-red-900" : "border-[var(--border)]"
      }`}
    >
      <h2 className="font-medium">{title}</h2>
      <p className="text-sm text-[var(--muted)]">{explanation}</p>
      <input type="hidden" name="targetId" value={targetId} />
      <input type="hidden" name="action" value={actionName} />
      <label htmlFor={reasonId} className="text-sm font-medium">
        Motivo (queda en el registro de administración)
      </label>
      <textarea
        id={reasonId}
        name="reason"
        required
        minLength={3}
        maxLength={ADMIN_REASON_MAX_LENGTH}
        rows={3}
        className="w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--background)] p-2 text-sm"
      />
      <label htmlFor={confirmId} className="flex items-start gap-2 text-sm">
        <input id={confirmId} type="checkbox" name="confirm" required className="mt-1" />
        <span>{confirmLabel}</span>
      </label>
      <div>
        <AdminSubmitButton
          variant={danger ? "primary" : "secondary"}
          testId={`${testId}-submit`}
        >
          {submitLabel}
        </AdminSubmitButton>
      </div>
    </form>
  );
}
