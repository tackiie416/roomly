import { expect, test, type Browser } from "@playwright/test";
import {
  completeOnboarding,
  loginWithMagicLink,
  uniqueEmail,
  userState,
} from "./helpers";

// Aislamiento entre usuarios desde la UI: un id ajeno en la URL o inyectado
// en un formulario nunca llega a leer ni a escribir datos de otro.

async function student(browser: Browser, label: string, name: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const email = uniqueEmail(label);
  await loginWithMagicLink(page, email);
  await completeOnboarding(page, name);
  return { context, page, email, id: (await userState(email)).id };
}

test("B no puede leer ni cambiar datos de A", async ({ browser }) => {
  const a = await student(browser, "dueno-a", "Dueña A");
  const b = await student(browser, "dueno-b", "Dueño B");
  const aBefore = await userState(a.email);

  // Ids ajenos en la URL: las páginas solo muestran lo de la sesión.
  for (const path of ["/perfil", "/preferencias", "/ajustes"]) {
    await b.page.goto(`${path}?profile_id=${a.id}&id=${a.id}`);
    await expect(b.page.locator("body")).not.toContainText("Dueña A");
  }
  await b.page.goto(`/perfil?profile_id=${a.id}`);
  await expect(b.page.locator("#full_name")).toHaveValue("Dueño B");

  // profile_id / id inyectados en los formularios → rechazados sin escribir.
  const forms = [
    ["/ajustes", "Guardar ajustes"],
    ["/perfil", "Guardar cambios"],
    ["/preferencias", "Guardar preferencias"],
  ] as const;
  for (const [path, button] of forms) {
    for (const field of ["profile_id", "id"]) {
      await b.page.goto(path);
      await b.page.evaluate(
        ([name, value]) => {
          const input = document.createElement("input");
          input.type = "hidden";
          input.name = name;
          input.value = value;
          document.querySelector("main form")!.appendChild(input);
        },
        [field, a.id]
      );
      await b.page.getByRole("button", { name: button }).click();
      await expect(b.page.getByText(/Campo no permitido/)).toBeVisible();
    }
  }

  expect(await userState(a.email)).toEqual(aBefore);
  const bAfter = await userState(b.email);
  expect(bAfter.profile?.full_name).toBe("Dueño B");
  await a.context.close();
  await b.context.close();
});
