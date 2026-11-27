import { z } from "zod";
import { charLength, uuidSchema } from "@/lib/validation/common";

/**
 * Reportes (sesión 83). Los mismos motivos y el mismo límite que la base de
 * datos (`chk_reports_reason` y `chk_reports_description_length`,
 * 20261128120000).
 */
export const REPORT_REASONS = [
  "harassment",
  "inappropriate",
  "fake_profile",
  "scam",
  "spam",
  "other",
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export const REPORT_REASON_LABELS: Record<ReportReason, string> = {
  harassment: "Acoso, amenazas o insultos",
  inappropriate: "Contenido inapropiado u ofensivo",
  fake_profile: "Perfil falso o suplantación",
  scam: "Estafa o petición de dinero",
  spam: "Spam o publicidad",
  other: "Otro motivo",
};

export const REPORT_DESCRIPTION_MAX_LENGTH = 1000;

const DESCRIPTION_TOO_LONG = `La descripción no puede tener más de ${REPORT_DESCRIPTION_MAX_LENGTH} caracteres.`;

export const reportInputSchema = z
  .object({
    targetId: uuidSchema,
    reason: z.enum(REPORT_REASONS, { error: "Elige un motivo." }),
    /** Opcional: vacía o solo espacios cuenta como sin descripción. */
    description: z
      .string()
      .transform((value) => value.replace(/\r\n?/g, "\n").trim())
      .refine((value) => charLength(value) <= REPORT_DESCRIPTION_MAX_LENGTH, {
        message: DESCRIPTION_TOO_LONG,
      })
      .transform((value) => (value.length > 0 ? value : null)),
  })
  .strict();

export type ReportInput = z.infer<typeof reportInputSchema>;

/** Resolución de un reporte por un admin. */
export const REPORT_STATUSES = ["pending", "in_review", "resolved", "dismissed"] as const;
export type ReportStatusValue = (typeof REPORT_STATUSES)[number];

export const REPORT_STATUS_LABELS: Record<ReportStatusValue, string> = {
  pending: "Pendiente",
  in_review: "En revisión",
  resolved: "Resuelto",
  dismissed: "Descartado",
};

export const REPORT_NOTES_MAX_LENGTH = 2000;

export const reportResolutionSchema = z
  .object({
    reportId: uuidSchema,
    status: z.enum(REPORT_STATUSES),
    notes: z
      .string()
      .transform((value) => value.trim())
      .refine((value) => charLength(value) <= REPORT_NOTES_MAX_LENGTH, {
        message: `Las notas no pueden tener más de ${REPORT_NOTES_MAX_LENGTH} caracteres.`,
      })
      .transform((value) => (value.length > 0 ? value : null)),
  })
  .strict();
