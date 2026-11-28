import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { exportOwnData } from "@/lib/services/data-export";
import { loginPath, ONBOARDING_PROFILE_PATH } from "@/lib/auth/destination";

/**
 * `GET /ajustes/mis-datos`: descarga de los datos propios en JSON (sesión 85).
 * Con la sesión y el cliente del usuario (RLS); nunca acepta un id por la URL.
 * También funciona con la cuenta desactivada: el derecho de acceso no depende
 * de poder usar la app. Sin caché y como adjunto.
 */
export const dynamic = "force-dynamic";
const DATA_EXPORT_PATH = "/ajustes/mis-datos";

export async function GET(request: Request) {
  const origin = new URL(request.url).origin;
  const result = await exportOwnData(await createClient());
  if (!result.ok) {
    if (result.error === "unauthenticated")
      return NextResponse.redirect(
        new URL(loginPath({ next: DATA_EXPORT_PATH }), origin),
        303
      );
    if (result.error === "no_profile")
      return NextResponse.redirect(new URL(ONBOARDING_PROFILE_PATH, origin), 303);
    return new NextResponse("No hemos podido preparar tus datos. Vuelve a intentarlo.", {
      status: 500,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  }
  const day = result.data.generatedAt.slice(0, 10);
  return new NextResponse(JSON.stringify(result.data, null, 2), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="roomly-mis-datos-${day}.json"`,
      "cache-control": "no-store, private",
      "x-content-type-options": "nosniff",
    },
  });
}
