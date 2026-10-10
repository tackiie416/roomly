import { expect, test } from "@playwright/test";
import { MOCK_SUPABASE_URL } from "../support/mock-config.mjs";
import { uniqueEmail } from "./helpers";

// Regresión del mock de E1: las siembras `/__test/seed-candidate` y
// `/__test/seed-own-response` exigen una `version` válida. Antes se convertía
// con `Number()`, y una versión ausente o vacía se sembraba como 0.
//   - Valor: el rango de la columna `questionnaire_version` (`integer NOT
//     NULL`, `CHECK >= 1`), de 1 a 2147483647.
//   - Formato: decimal canónico, el que emiten los helpers de siembra. Es una
//     convención del mock, no de PostgreSQL: PostgreSQL convertiría en 2
//     textos como `02`, ` 2 ` o `+2`, y el mock los rechaza a propósito.
// Se prueba contra el mock en marcha: una versión no válida → 400 y nada
// sembrado ni cambiado.

/** Una ciudad que no existe: lo sembrado aquí nunca es candidato de nadie. */
const NOWHERE = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

/** `version` tal como llega en la URL; `undefined`: sin el parámetro. */
const INVALID: Array<[string, string | undefined]> = [
  // Sin versión, o con un texto que no es un entero.
  ["ausente", undefined],
  ["null (así llega en la URL)", String(null)],
  ["cadena vacía", ""],
  ["solo espacios", "   "],
  ["no entera", "1.5"],
  ["malformada", "2abc"],
  ["con exponente", "1e0"],
  // Fuera del rango de la columna.
  ["0 (CHECK >= 1)", "0"],
  ["negativa (CHECK >= 1)", "-1"],
  ["mayor que el máximo de integer", "2147483648"],
  // Formato no canónico: PostgreSQL lo convertiría en 2; el mock lo rechaza.
  ["con espacios alrededor (formato del mock)", " 2 "],
  ["con ceros a la izquierda (formato del mock)", "02"],
  ["con signo (formato del mock)", "+2"],
];

/** Versiones aceptadas: las del cuestionario de hoy y el máximo de `integer`. */
const VALID = ["1", "2", "2147483647"];

async function seed(
  path: "/__test/seed-candidate" | "/__test/seed-own-response",
  params: Record<string, string>,
  version: string | undefined
): Promise<Response> {
  const query = new URLSearchParams(params);
  if (version !== undefined) query.set("version", version);
  return fetch(`${MOCK_SUPABASE_URL}${path}?${query}`);
}

/** Estado del mock para `email`; null si no existe el usuario. */
async function stateOf(email: string): Promise<Record<string, unknown> | null> {
  const response = await fetch(
    `${MOCK_SUPABASE_URL}/__test/user?email=${encodeURIComponent(email)}`
  );
  if (response.status === 404) return null;
  expect(response.status).toBe(200);
  return (await response.json()) as Record<string, unknown>;
}

const candidate = (email: string) => ({
  email,
  name: "Semilla E1",
  city: NOWHERE,
  ids: "clean_frequency,smoke_own",
  answer: "2",
});

test("seed-candidate: una versión no válida se rechaza sin crear nada; las válidas se siembran", async () => {
  for (const [label, version] of INVALID) {
    const email = uniqueEmail("semilla-invalida");
    const response = await seed("/__test/seed-candidate", candidate(email), version);
    expect(response.status, label).toBe(400);
    expect(await stateOf(email), label).toBeNull();
  }
  for (const version of VALID) {
    const email = uniqueEmail("semilla-valida");
    const response = await seed("/__test/seed-candidate", candidate(email), version);
    expect(response.status, version).toBe(200);
    const state = await stateOf(email);
    expect(state?.compatibility, version).toMatchObject({
      questionnaire_version: Number(version),
      answers: { clean_frequency: 2, smoke_own: 2 },
    });
  }
});

test("seed-own-response: una versión no válida se rechaza sin cambiar el test guardado; las válidas lo sustituyen", async () => {
  // Una persona con perfil y su test en la v2 (sembrada con una versión válida).
  const email = uniqueEmail("semilla-propia");
  expect((await seed("/__test/seed-candidate", candidate(email), "2")).status).toBe(200);
  const before = (await stateOf(email))?.compatibility;
  expect(before).toMatchObject({ questionnaire_version: 2 });

  const own = { email, ids: "clean_dishes", answer: "3", completed: "0" };
  for (const [label, version] of INVALID) {
    const response = await seed("/__test/seed-own-response", own, version);
    expect(response.status, label).toBe(400);
    expect((await stateOf(email))?.compatibility, label).toEqual(before);
  }
  for (const version of VALID) {
    const response = await seed("/__test/seed-own-response", own, version);
    expect(response.status, version).toBe(200);
    expect((await stateOf(email))?.compatibility, version).toMatchObject({
      questionnaire_version: Number(version),
      answers: { clean_dishes: 3 },
      completed_at: null,
    });
  }
});
