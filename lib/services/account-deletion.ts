import "server-only";

import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  removeAccountRoomObjects,
  type RoomObjectsCleanup,
} from "@/lib/services/room-images";
import {
  type DbClient,
  type ServiceResult,
  fail,
  getSessionUserId,
  ok,
} from "@/lib/services/result";
import { toFieldErrors, uuidSchema } from "@/lib/validation/common";

/**
 * Eliminación de la cuenta propia (sesión 87, 20261201120000).
 *
 * service_role (D17, sexto servicio, con los criterios provisionales del
 * propietario del 2026-11-28): borrar un usuario de Auth y revocar sus
 * sesiones solo se puede con la API de administración de Auth, y las funciones
 * de eliminación solo las ejecuta service_role. El cliente admin se usa solo
 * para las tres `rpc` de la migración y `auth.admin.deleteUser`;
 * tests/unit/admin-client-usage.test.ts lo fija. Storage lo hace
 * lib/services/room-images.ts (`removeAccountRoomObjects`).
 *
 * El id es siempre el de la sesión (`auth.getUser()`), nunca uno del
 * navegador. Orden (cada paso se puede repetir; si uno falla, la cuenta queda
 * desactivada y la solicitud pendiente, y volver a pedirlo continúa):
 *   1. `request_account_deletion`: desactiva la cuenta y anota la solicitud;
 *   2. vaciar en Storage las carpetas de sus habitaciones, y comprobarlo;
 *   3. `delete_account_data`: borra y anonimiza en una transacción (vuelve a
 *      comprobar Storage);
 *   4. `auth.admin.deleteUser`: borra el usuario de Auth, sus sesiones y sus
 *      tokens de refresco, y el perfil anonimizado en cascada;
 *   5. `complete_account_deletion`: marca la solicitud.
 * Después, la Server Action cierra la sesión en el navegador (cookies).
 *
 * Qué se conserva, con el UUID como seudónimo, y por qué: docs/PRIVACY_RETENTION.md.
 */

/** Lo que hay que escribir para confirmar (en mayúsculas o minúsculas). */
export const ACCOUNT_DELETION_CONFIRMATION = "ELIMINAR";

const accountDeletionSchema = z
  .object({
    confirmation: z
      .string({ message: `Escribe ${ACCOUNT_DELETION_CONFIRMATION} para confirmar.` })
      .max(50, `Escribe ${ACCOUNT_DELETION_CONFIRMATION} para confirmar.`)
      .transform((value) => value.trim().toUpperCase())
      .refine((value) => value === ACCOUNT_DELETION_CONFIRMATION, {
        message: `Escribe ${ACCOUNT_DELETION_CONFIRMATION} para confirmar.`,
      }),
    acknowledge: z.literal(true, {
      message: "Marca la casilla para confirmar que lo entiendes.",
    }),
  })
  .strict();

export type AccountDeletionInput = z.input<typeof accountDeletionSchema>;

/**
 * Avisos de recuperación (solo el evento y el id de la cuenta; nunca datos
 * personales): la eliminación quedó a medias y la solicitud sigue pendiente.
 */
export type AccountDeletionEvent =
  | "account_deletion_request_failed"
  | "account_deletion_storage_pending"
  | "account_deletion_data_failed"
  | "account_deletion_auth_failed"
  | "account_deletion_complete_failed";

export type AccountDeletionDeps = {
  /** Cliente con service_role. Se inyecta en los tests. */
  deletionAdminClient: () => DbClient;
  removeRoomObjects: (roomId: string, ownerId: string) => Promise<RoomObjectsCleanup>;
  report: (event: AccountDeletionEvent, userId: string) => void;
};

const DEFAULT_DEPS: AccountDeletionDeps = {
  deletionAdminClient: () => createAdminClient(),
  removeRoomObjects: (roomId, ownerId) => removeAccountRoomObjects(roomId, ownerId),
  report: (event, userId) => {
    console.warn(`[account-deletion] ${event}: ${userId}`);
  },
};

const requestResultSchema = z.object({
  status: z.enum(["pending", "profile_absent"]),
  rooms: z.array(uuidSchema).max(1000),
});

/**
 * `ok` solo cuando la cuenta ya no existe en Auth. `conflict`: la eliminación
 * quedó pendiente (la cuenta está desactivada) y se puede repetir.
 */
export async function deleteOwnAccount(
  supabase: DbClient,
  input: unknown,
  deps: AccountDeletionDeps = DEFAULT_DEPS
): Promise<ServiceResult<{ deleted: true }>> {
  const parsed = accountDeletionSchema.safeParse(input);
  if (!parsed.success) return fail("validation", toFieldErrors(parsed.error));

  const userId = await getSessionUserId(supabase);
  if (!userId) return fail("unauthenticated");

  const admin = deps.deletionAdminClient();
  try {
    // 1. Desactivar y anotar.
    const requested = await admin.rpc("request_account_deletion", { p_user_id: userId });
    const request = requestResultSchema.safeParse(requested.data);
    if (requested.error || !request.success) {
      deps.report("account_deletion_request_failed", userId);
      return fail("unknown");
    }

    if (request.data.status === "pending") {
      // 2. Storage antes que las filas.
      for (const roomId of request.data.rooms) {
        const cleanup = await deps.removeRoomObjects(roomId, userId);
        if (!cleanup.complete) {
          deps.report("account_deletion_storage_pending", userId);
          return fail("conflict");
        }
      }

      // 3. Borrar y anonimizar.
      const deleted = await admin.rpc("delete_account_data", { p_user_id: userId });
      if (deleted.error) {
        deps.report(
          deleted.error.code === "55000"
            ? "account_deletion_storage_pending"
            : "account_deletion_data_failed",
          userId
        );
        return fail("conflict");
      }
    }

    // 4. Auth: el usuario, sus sesiones y, en cascada, el perfil.
    const removed = await admin.auth.admin.deleteUser(userId);
    if (removed.error && removed.error.status !== 404) {
      deps.report("account_deletion_auth_failed", userId);
      return fail("conflict");
    }

    // 5. Marcar la solicitud. Si falla, la cuenta ya no existe: solo se avisa.
    const completed = await admin.rpc("complete_account_deletion", { p_user_id: userId });
    if (completed.error || completed.data !== true)
      deps.report("account_deletion_complete_failed", userId);

    return ok({ deleted: true });
  } catch {
    deps.report("account_deletion_data_failed", userId);
    return fail("conflict");
  }
}
