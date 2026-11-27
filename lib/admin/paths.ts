/** Rutas del panel de administración (sesión 83 y Fase 7). */
export const ADMIN_PATH = "/admin";
export const ADMIN_REPORTS_PATH = "/admin/reportes";
export const ADMIN_USERS_PATH = "/admin/usuarios";
export const ADMIN_ROOMS_PATH = "/admin/habitaciones";
export const ADMIN_METRICS_PATH = "/admin/metricas";

export const adminUserPath = (id: string) => `${ADMIN_USERS_PATH}/${id}`;
export const adminRoomPath = (id: string) => `${ADMIN_ROOMS_PATH}/${id}`;
