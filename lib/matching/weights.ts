import type { Category, MatchWeights } from "@/lib/matching/types";

/**
 * Pesos y constantes del motor (Fase 3.2). Para cambiarlos basta con editar
 * este archivo (criterio de aceptación de la Fase 3 en docs/ROADMAP.md).
 *
 * Pesos: los de §9 de ROOMLY_MASTER_SPEC.md, sin cambios (D16: los temas de
 * convivencia —teletrabajo, cocina, qué se comparte, privacidad,
 * comunicación, conflictos y normas— van dentro de las categorías existentes,
 * sobre todo en Personalidad, 5 %). Cualquier cambio sube `version`.
 */

/**
 * Orden fijo de las categorías: el de la tabla de §9. Es el orden de cálculo
 * y el desempate de las explicaciones (después del peso).
 */
export const CATEGORY_ORDER: readonly Category[] = [
  "location",
  "budget",
  "cleanliness",
  "schedules",
  "noise",
  "parties",
  "guests",
  "smoking",
  "pets",
  "study",
  "personality",
];

export const MATCH_WEIGHTS: MatchWeights = {
  version: 1,
  byCategory: {
    location: 15,
    budget: 15,
    cleanliness: 12,
    schedules: 10,
    noise: 10,
    parties: 8,
    guests: 8,
    smoking: 7,
    pets: 5,
    study: 5,
    personality: 5,
  },
  // D8: hueco de presupuesto (€/mes) en el que la categoría llega a 0; por
  // encima, el filtro duro excluye al candidato.
  budgetGapRef: 150,
  strengthMin: 0.8,
  differenceMax: 0.5,
};

/** Como mucho, 3 fortalezas y 3 diferencias (§14 y la especificación cerrada). */
export const MAX_REASONS_PER_KIND = 3;
