import type { Question, Questionnaire } from "@/lib/matching/types";

/**
 * Cuestionario de compatibilidad (Fase 3.2), versionado en código (D15a/D15b
 * de la especificación cerrada de la Fase 3, 2026-10-07).
 *
 * Invariante: un `id` nunca cambia de significado, escala, tipo, categoría
 * ni pareja. Si una pregunta cambia en algo de eso, recibe un id nuevo y el
 * cuestionario sube de versión. Corregir una errata no cambia ni el id ni la
 * versión. `CURRENT_QUESTIONNAIRE_VERSION` nunca baja (tampoco en un
 * rollback): la base de datos rechaza bajar de versión (S3).
 *
 * Los textos y las etiquetas son el borrador aprobado como estructura; su
 * redacción final es una decisión posterior a la implementación (no cambia
 * ids ni escalas).
 */

const LIKERT = { min: 1, max: 5 } as const;
const THREE = { min: 1, max: 3 } as const;

const PARTY_FREQUENCY = {
  1: "Nunca",
  2: "Alguna vez al año",
  3: "Una vez al mes",
  4: "Cada dos semanas",
  5: "Cada semana",
} as const;

const OVERNIGHT_FREQUENCY = {
  1: "Nunca",
  2: "Alguna vez al mes",
  3: "Una vez a la semana",
  4: "Varias veces por semana",
  5: "Casi a diario",
} as const;

const CALLS_FREQUENCY = {
  1: "Nunca",
  2: "Alguna vez al mes",
  3: "Una vez a la semana",
  4: "Varias veces por semana",
  5: "A diario",
} as const;

const QUESTIONS_V1: readonly Question[] = [
  // Limpieza (6)
  {
    id: "clean_common_standard",
    text: "¿Qué nivel de orden y limpieza esperas en las zonas comunes?",
    category: "cleanliness",
    comparison: "similarity",
    scale: LIKERT,
    labels: { 1: "Me basta lo básico", 5: "Todo impecable" },
  },
  {
    id: "clean_frequency",
    text: "¿Cada cuánto crees que deberían limpiarse las zonas comunes?",
    category: "cleanliness",
    comparison: "similarity",
    scale: LIKERT,
    labels: { 1: "Cuando haga falta", 5: "Varias veces por semana" },
  },
  {
    id: "clean_dishes",
    text: "¿Cuánto te molesta encontrar platos sin fregar?",
    category: "cleanliness",
    comparison: "similarity",
    scale: LIKERT,
    labels: { 1: "Nada", 5: "Mucho" },
  },
  {
    id: "kitchen_after_cooking",
    text: "Cuando cocinas, ¿cuándo recoges la cocina?",
    category: "cleanliness",
    comparison: "similarity",
    scale: LIKERT,
    labels: { 1: "Más tarde o al día siguiente", 5: "Justo al terminar" },
  },
  {
    id: "share_basics",
    text: "¿Compartirías productos básicos del piso (aceite, sal, productos de limpieza)?",
    category: "cleanliness",
    comparison: "similarity",
    scale: LIKERT,
    labels: { 1: "Prefiero no compartir", 5: "Todo en común" },
  },
  {
    id: "rules_cleaning_rota",
    text: "¿Prefieres turnos de limpieza fijos u organizarlo sobre la marcha?",
    category: "cleanliness",
    comparison: "similarity",
    scale: LIKERT,
    labels: { 1: "Sobre la marcha", 5: "Turnos fijos" },
  },
  // Horarios (2)
  {
    id: "schedule_bedtime",
    text: "Entre semana, ¿a qué hora sueles acostarte?",
    category: "schedules",
    comparison: "similarity",
    scale: LIKERT,
    labels: {
      1: "Antes de las 23 h",
      2: "Entre las 23 h y las 00 h",
      3: "Entre las 00 h y la 01 h",
      4: "Entre la 01 h y las 02 h",
      5: "Después de las 02 h",
    },
  },
  {
    id: "schedule_wakeup",
    text: "Entre semana, ¿a qué hora sueles levantarte?",
    category: "schedules",
    comparison: "similarity",
    scale: LIKERT,
    labels: {
      1: "Antes de las 7 h",
      2: "Entre las 7 h y las 8 h",
      3: "Entre las 8 h y las 9 h",
      4: "Entre las 9 h y las 10 h",
      5: "Después de las 10 h",
    },
  },
  // Ruido (3)
  {
    id: "noise_own",
    text: "¿Cuánto ruido sueles hacer en casa (música, llamadas, tele)?",
    category: "noise",
    comparison: "behavior",
    scale: LIKERT,
    labels: { 1: "Muy poco", 5: "Bastante" },
    pairedWith: "noise_tolerance",
  },
  {
    id: "noise_tolerance",
    text: "Cuando estás en casa, ¿cuánto ruido de tus compañeros te parece bien?",
    category: "noise",
    comparison: "tolerance",
    scale: LIKERT,
    labels: { 1: "Muy poco", 5: "Bastante" },
    toleranceOf: "noise_own",
  },
  {
    id: "rules_quiet_hours",
    text: "¿Quieres acordar horas de silencio por la noche?",
    category: "noise",
    comparison: "similarity",
    scale: LIKERT,
    labels: { 1: "No hace falta", 5: "Imprescindible" },
  },
  // Fiestas (2)
  {
    id: "party_own",
    text: "¿Cada cuánto te gustaría organizar reuniones o fiestas en casa?",
    category: "parties",
    comparison: "behavior",
    scale: LIKERT,
    labels: PARTY_FREQUENCY,
    pairedWith: "party_tolerance",
  },
  {
    id: "party_tolerance",
    text: "¿Cada cuánto te parece bien que haya reuniones o fiestas en casa?",
    category: "parties",
    comparison: "tolerance",
    scale: LIKERT,
    labels: PARTY_FREQUENCY,
    toleranceOf: "party_own",
  },
  // Visitas (4)
  {
    id: "guests_own",
    text: "¿Cada cuánto sueles traer visitas a casa?",
    category: "guests",
    comparison: "behavior",
    scale: LIKERT,
    labels: { 1: "Casi nunca", 5: "Muy a menudo" },
    pairedWith: "guests_tolerance",
  },
  {
    id: "guests_tolerance",
    text: "¿Cada cuánto te parece bien que tus compañeros traigan visitas?",
    category: "guests",
    comparison: "tolerance",
    scale: LIKERT,
    labels: { 1: "Casi nunca", 5: "Muy a menudo" },
    toleranceOf: "guests_own",
  },
  {
    id: "guests_overnight_own",
    text: "¿Cada cuánto se quedaría alguien a dormir contigo?",
    category: "guests",
    comparison: "behavior",
    scale: LIKERT,
    labels: OVERNIGHT_FREQUENCY,
    pairedWith: "guests_overnight_tolerance",
  },
  {
    id: "guests_overnight_tolerance",
    text: "¿Cada cuánto te parece bien que se quede alguien a dormir con tus compañeros?",
    category: "guests",
    comparison: "tolerance",
    scale: LIKERT,
    labels: OVERNIGHT_FREQUENCY,
    toleranceOf: "guests_overnight_own",
  },
  // Fumar (2)
  {
    id: "smoke_own",
    text: "¿Fumas o vapeas?",
    category: "smoking",
    comparison: "behavior",
    scale: THREE,
    labels: { 1: "No", 2: "Sí, solo fuera de casa", 3: "Sí, también dentro" },
    pairedWith: "smoke_tolerance",
  },
  {
    id: "smoke_tolerance",
    text: "¿Aceptarías que un compañero fume o vapee?",
    category: "smoking",
    comparison: "tolerance",
    scale: THREE,
    labels: { 1: "No", 2: "Solo fuera de casa", 3: "También dentro" },
    toleranceOf: "smoke_own",
  },
  // Mascotas (2)
  {
    id: "pets_own",
    text: "¿Tienes o piensas traer una mascota?",
    category: "pets",
    comparison: "behavior",
    scale: THREE,
    labels: { 1: "No", 2: "Pequeña (pez, roedor…)", 3: "Gato o perro" },
    pairedWith: "pets_tolerance",
  },
  {
    id: "pets_tolerance",
    text: "¿Qué mascotas aceptarías en el piso?",
    category: "pets",
    comparison: "tolerance",
    scale: THREE,
    labels: { 1: "Ninguna", 2: "Solo pequeñas", 3: "También gatos o perros" },
    toleranceOf: "pets_own",
  },
  // Estudio (3)
  {
    id: "study_at_home",
    text: "¿Cuánto estudias en casa?",
    category: "study",
    comparison: "similarity",
    scale: LIKERT,
    labels: { 1: "Casi nada", 5: "Casi todo" },
  },
  {
    id: "remote_calls_common_own",
    text: "¿Cada cuánto tienes videollamadas, clases online o teletrabajo en las zonas comunes (salón, cocina)?",
    category: "study",
    comparison: "behavior",
    scale: LIKERT,
    labels: CALLS_FREQUENCY,
    pairedWith: "remote_calls_common_tolerance",
  },
  {
    id: "remote_calls_common_tolerance",
    text: "¿Cada cuánto te parece bien que un compañero tenga videollamadas o teletrabajo en las zonas comunes?",
    category: "study",
    comparison: "tolerance",
    scale: LIKERT,
    labels: CALLS_FREQUENCY,
    toleranceOf: "remote_calls_common_own",
  },
  // Personalidad (5)
  {
    id: "social_with_flatmates",
    text: "¿Cuánto te apetece hacer vida en común con tus compañeros (cenar juntos, hacer planes)?",
    category: "personality",
    comparison: "similarity",
    scale: LIKERT,
    labels: { 1: "Poco", 5: "Mucho" },
  },
  {
    id: "privacy_time_alone",
    text: "¿Cuánto tiempo a solas necesitas en casa?",
    category: "personality",
    comparison: "similarity",
    scale: LIKERT,
    labels: { 1: "Poco", 5: "Mucho" },
  },
  {
    id: "communication_style",
    text: "Para los temas del piso, ¿prefieres hablarlo en persona o por mensaje?",
    category: "personality",
    comparison: "similarity",
    scale: LIKERT,
    labels: { 1: "Prefiero en persona", 5: "Prefiero por mensaje" },
  },
  {
    id: "conflict_approach",
    text: "Si algo te molesta, ¿lo comentas pronto o esperas a ver si se arregla solo?",
    category: "personality",
    comparison: "similarity",
    scale: LIKERT,
    labels: { 1: "Espero", 5: "Lo digo enseguida" },
  },
  {
    id: "rules_explicit",
    text: "¿Prefieres acordar normas de convivencia desde el principio o ir viendo?",
    category: "personality",
    comparison: "similarity",
    scale: LIKERT,
    labels: { 1: "Ir viendo", 5: "Normas claras desde el principio" },
  },
];

export const QUESTIONNAIRE_V1: Questionnaire = { version: 1, questions: QUESTIONS_V1 };

/** Versión vigente. Nunca baja. */
export const CURRENT_QUESTIONNAIRE_VERSION = 1;

/** Todas las versiones conocidas por el código. */
const QUESTIONNAIRES: Readonly<Record<number, Questionnaire>> = { 1: QUESTIONNAIRE_V1 };

export function getQuestionnaire(version: number): Questionnaire | null {
  return QUESTIONNAIRES[version] ?? null;
}

export function getCurrentQuestionnaire(): Questionnaire {
  return QUESTIONNAIRES[CURRENT_QUESTIONNAIRE_VERSION];
}

/** ¿`value` es una respuesta válida para `question`? (entero dentro de su escala) */
export function isValidAnswer(question: Question, value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= question.scale.min &&
    value <= question.scale.max
  );
}
