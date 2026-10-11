/**
 * Alta de los usuarios de prueba de la api-suite
 * (tests/integration/supabase-validation.test.ts). Sin red ni secretos: recibe
 * lo que necesita de supabase-js y se prueba en
 * tests/unit/integration-test-users.test.ts.
 *
 * Regla: el id se apunta en `registry` (lo que borra el teardown del mismo
 * run) en cuanto Auth devuelve el usuario, antes de cualquier otro paso. Si
 * después falla el inicio de sesión, o lo que venga detrás, el teardown lo
 * borra igualmente; no queda esperando a la limpieza del run siguiente.
 */

type AuthError = { message: string } | null;

/** Lo mínimo de `auth.admin` (service_role) que usa el alta. */
export type TestUserAdmin = {
  createUser: (attributes: {
    email: string;
    password: string;
    email_confirm: true;
  }) => Promise<{ data: { user: { id: string } | null }; error: AuthError }>;
};

/** Inicio de sesión con el cliente propio del usuario (`signInWithPassword`). */
export type TestUserSignIn = (credentials: {
  email: string;
  password: string;
}) => Promise<{ error: AuthError }>;

/**
 * Crea un usuario de prueba ya confirmado (sin email), lo apunta en
 * `registry` y, si se pasa `signIn`, inicia sesión después de apuntarlo. Los
 * errores llevan la clave del actor y el mensaje de Auth, nunca la
 * contraseña.
 */
export async function createTestUser(options: {
  key: string;
  email: string;
  password: string;
  admin: TestUserAdmin;
  registry: Set<string>;
  signIn?: TestUserSignIn;
}): Promise<string> {
  const { key, email, password, admin, registry, signIn } = options;
  const { data, error } = await admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`createUser(${key}): ${error?.message}`);
  registry.add(data.user.id);
  if (signIn) {
    const result = await signIn({ email, password });
    if (result.error)
      throw new Error(`signInWithPassword(${key}): ${result.error.message}`);
  }
  return data.user.id;
}
