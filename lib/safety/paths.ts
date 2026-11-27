/** Página para reportar a una persona (sesión 83). */
export function reportPath(personId: string): string {
  return `/reportar/${personId}`;
}

/** Página para reportar un anuncio de habitación (Fase 7). */
export function roomReportPath(roomId: string): string {
  return `/reportar/habitacion/${roomId}`;
}
