import type { Category, CompatibilityReason } from "@/lib/matching/types";

/**
 * Texto de las explicaciones (Fase 3.2): plantillas fijas por categoría y
 * por perspectiva. Nunca llevan cifras, valores de la escala, respuestas ni
 * puntuaciones por categoría; las razones son por categoría, nunca por
 * pregunta. La dirección solo existe en diferencias de Horarios y Ruido; el
 * resto de categorías va siempre en neutro (D11: riesgo residual aceptado).
 */

const STRENGTH_TEXT: Readonly<Record<Category, string>> = {
  location: "Buscáis piso en zonas en común.",
  budget: "Vuestros presupuestos encajan.",
  cleanliness: "Tenéis expectativas parecidas sobre limpieza y espacios comunes.",
  schedules: "Tenéis horarios parecidos entre semana.",
  noise: "Esperáis un nivel de ruido parecido en casa.",
  parties: "Coincidís en las reuniones o fiestas que os parecen bien en casa.",
  guests: "Coincidís en las visitas que os parecen bien.",
  smoking: "Os parece bien lo mismo sobre fumar en casa.",
  pets: "Coincidís en las mascotas que aceptáis en el piso.",
  study: "Usáis la casa para estudiar o trabajar de forma compatible.",
  personality: "Tenéis una forma parecida de convivir y de hablar las cosas.",
};

/** Diferencias sin dirección (y todas las de las categorías sin dirección). */
const DIFFERENCE_TEXT: Readonly<Record<Category, string>> = {
  location: "Buscáis piso en zonas distintas.",
  budget: "Vuestros presupuestos no coinciden del todo.",
  cleanliness: "Tenéis expectativas distintas sobre limpieza y espacios comunes.",
  schedules: "Tenéis horarios distintos entre semana; conviene hablarlo.",
  noise: "Tenéis expectativas distintas sobre el ruido en casa.",
  parties: "Conviene que habléis de las reuniones o fiestas en casa.",
  guests: "Puede que tengáis expectativas distintas sobre las visitas.",
  smoking: "Conviene que habléis de si se puede fumar en casa.",
  pets: "Conviene que habléis de las mascotas en el piso.",
  study: "Conviene que habléis de cómo usáis la casa para estudiar o trabajar.",
  personality: "Tenéis formas distintas de convivir o de hablar las cosas.",
};

/** Diferencias con dirección: [quien mira es el «más», el otro es el «más»]. */
const DIRECTED_TEXT: Partial<
  Record<Category, { self: string; other: (name: string) => string }>
> = {
  schedules: {
    self: "Tú tienes un horario más tardío entre semana.",
    other: (name) => `${name} tiene un horario más tardío entre semana.`,
  },
  noise: {
    self: "Tú prefieres más tranquilidad en casa.",
    other: (name) => `${name} prefiere más tranquilidad en casa.`,
  },
};

/**
 * Frase de una explicación para quien mira. `viewer` dice si quien mira es
 * la persona `a` o la `b` de `calculateCompatibility(a, b)`; `otherName` es
 * el nombre que ya muestra la tarjeta.
 */
export function renderReason(
  reason: CompatibilityReason,
  viewer: "a" | "b",
  otherName: string
): string {
  if (reason.kind === "strength") return STRENGTH_TEXT[reason.category];
  const directed = DIRECTED_TEXT[reason.category];
  if (!directed || reason.direction === null) return DIFFERENCE_TEXT[reason.category];
  const viewerIsMore =
    (reason.direction === "a_more" && viewer === "a") ||
    (reason.direction === "b_more" && viewer === "b");
  return viewerIsMore ? directed.self : directed.other(otherName);
}
