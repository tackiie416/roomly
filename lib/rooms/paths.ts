/**
 * Rutas de la gestión de habitaciones (Fase 4.2: fotos y borrado). El id va
 * siempre validado como UUID antes de construir una ruta: así una ruta de
 * `revalidatePath` o de vuelta tras el login nunca sale de un texto del
 * navegador.
 */

/** Tras borrar una habitación, la página de confirmación (sin id: ya no existe). */
export const ROOM_DELETED_PATH = "/habitaciones/borrada";

/** Fotos de una habitación (`roomId`, un UUID ya validado). */
export function roomPhotosPath(roomId: string): string {
  return `/habitaciones/${roomId}/fotos`;
}

/** Confirmación del borrado de una habitación (`roomId`, un UUID ya validado). */
export function roomDeletePath(roomId: string): string {
  return `/habitaciones/${roomId}/borrar`;
}
