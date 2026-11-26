import { EXPLORE_PATH } from "@/lib/auth/destination";

/** «Ver perfil» (Fase 5.2): `/explorar/<id>`, con el id ya validado. */
export function personPath(id: string): string {
  return `${EXPLORE_PATH}/${id}`;
}
