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
  5: "Cada semana o más",
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

/** S5: distingue las visitas de quien se queda a dormir (preguntas 14 y 15). */
const GUESTS_HELP = "Sin contar quien se queda a dormir: eso va en otra pregunta.";

const QUESTIONS_V1: readonly Question[] = [
  // Limpieza (6)
  {
    id: "clean_common_standard",
    text: "¿Qué nivel de orden y limpieza esperas en las zonas comunes?",
    category: "cleanliness",
    comparison: "similarity",
    scale: LIKERT,
    labels: { 1: "Me basta con lo básico", 5: "Todo impecable" },
  },
  {
    id: "clean_frequency",
    text: "¿Con qué frecuencia crees que habría que limpiar las zonas comunes?",
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
    text: "Después de cocinar, ¿cuándo sueles recoger la cocina?",
    category: "cleanliness",
    comparison: "similarity",
    scale: LIKERT,
    labels: { 1: "Más tarde o al día siguiente", 5: "Nada más terminar" },
  },
  {
    id: "share_basics",
    text: "¿Hasta qué punto te gustaría compartir productos básicos (aceite, sal, productos de limpieza…)?",
    category: "cleanliness",
    comparison: "similarity",
    scale: LIKERT,
    labels: { 1: "Cada uno los suyos", 5: "Todo en común" },
  },
  {
    id: "rules_cleaning_rota",
    text: "Para la limpieza, ¿prefieres organizaros sobre la marcha o tener turnos fijos?",
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
      1: "Antes de las 23:00",
      2: "Entre las 23:00 y medianoche",
      3: "Entre medianoche y la 1:00",
      4: "Entre la 1:00 y las 2:00",
      5: "Después de las 2:00",
    },
  },
  {
    id: "schedule_wakeup",
    text: "Entre semana, ¿a qué hora sueles levantarte?",
    category: "schedules",
    comparison: "similarity",
    scale: LIKERT,
    labels: {
      1: "Antes de las 7:00",
      2: "Entre las 7:00 y las 8:00",
      3: "Entre las 8:00 y las 9:00",
      4: "Entre las 9:00 y las 10:00",
      5: "Después de las 10:00",
    },
  },
  // Ruido (3)
  {
    id: "noise_own",
    text: "¿Cuánto ruido sueles hacer en casa (música, llamadas, televisión…)?",
    category: "noise",
    comparison: "behavior",
    scale: LIKERT,
    labels: { 1: "Muy poco", 5: "Bastante" },
    pairedWith: "noise_tolerance",
  },
  {
    id: "noise_tolerance",
    text: "Cuando estás en casa, ¿cuánto ruido de tus compañeros te parece aceptable?",
    category: "noise",
    comparison: "tolerance",
    scale: LIKERT,
    labels: { 1: "Muy poco", 5: "Bastante" },
    toleranceOf: "noise_own",
  },
  {
    id: "rules_quiet_hours",
    text: "¿Qué importancia tiene para ti acordar horas de silencio por la noche?",
    category: "noise",
    comparison: "similarity",
    scale: LIKERT,
    labels: { 1: "No hace falta", 5: "Es imprescindible" },
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
    help: GUESTS_HELP,
    pairedWith: "guests_tolerance",
  },
  {
    id: "guests_tolerance",
    text: "¿Cada cuánto te parece bien que tus compañeros traigan visitas?",
    category: "guests",
    comparison: "tolerance",
    scale: LIKERT,
    labels: { 1: "Casi nunca", 5: "Muy a menudo" },
    help: GUESTS_HELP,
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
    labels: { 1: "No", 2: "Sí, solo fuera de casa", 3: "Sí, también dentro de casa" },
    pairedWith: "smoke_tolerance",
  },
  {
    id: "smoke_tolerance",
    text: "¿Aceptarías vivir con alguien que fuma o vapea?",
    category: "smoking",
    comparison: "tolerance",
    scale: THREE,
    labels: {
      1: "No",
      2: "Sí, si lo hace fuera de casa",
      3: "Sí, también si lo hace dentro",
    },
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
    text: "¿Qué mascotas de tus compañeros aceptarías en el piso?",
    category: "pets",
    comparison: "tolerance",
    scale: THREE,
    labels: {
      1: "Ninguna",
      2: "Solo pequeñas (pez, roedor, pájaro…)",
      3: "También gatos o perros",
    },
    toleranceOf: "pets_own",
  },
  // Estudio (3)
  {
    id: "study_at_home",
    text: "¿Qué parte de tu estudio haces en casa?",
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
    text: "¿Cada cuánto te parece bien que un compañero tenga videollamadas, clases online o teletrabajo en las zonas comunes (salón, cocina)?",
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
    text: "Para los temas del piso, ¿prefieres hablarlos en persona o por mensaje?",
    category: "personality",
    comparison: "similarity",
    scale: LIKERT,
    labels: { 1: "En persona", 5: "Por mensaje" },
  },
  {
    id: "conflict_approach",
    text: "Si algo te molesta, ¿esperas a ver si se arregla solo o lo comentas pronto?",
    category: "personality",
    comparison: "similarity",
    scale: LIKERT,
    labels: { 1: "Espero a ver si se arregla", 5: "Lo comento enseguida" },
  },
  {
    id: "rules_explicit",
    text: "¿Prefieres ir viendo sobre la marcha o acordar normas de convivencia desde el principio?",
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
