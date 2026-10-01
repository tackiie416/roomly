import { redirect } from "next/navigation";
import { LoginForm } from "@/components/auth/login-form";
import { getCurrentProfileState } from "@/lib/auth/session";
import { resolveDestination, sanitizeNext } from "@/lib/auth/destination";
import { LOGIN_ERROR_MESSAGES, toLoginErrorCode } from "@/lib/auth/login-errors";

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * `/login` (Fase 2.2). En el servidor: sanea `next`, traduce `error` a un
 * mensaje propio (cualquier otro texto se ignora) y, si ya hay sesión,
 * redirige según el estado del perfil. El formulario es un componente cliente.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const next = sanitizeNext(first(params.next));
  const errorCode = toLoginErrorCode(first(params.error));

  const session = await getCurrentProfileState();
  if (session.ok) redirect(resolveDestination(session.data, next));

  return (
    <LoginForm
      next={next}
      initialError={errorCode ? LOGIN_ERROR_MESSAGES[errorCode] : null}
    />
  );
}
