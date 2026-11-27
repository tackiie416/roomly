import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth/session";
import { listUsersForAdmin } from "@/lib/services/admin";
import { ADMIN_USERS_PATH, adminUserPath } from "@/lib/admin/paths";
import { SEEKING_STATUS_LABELS, adminDayText, labelOr } from "@/lib/admin/format";
import {
  ADMIN_SEARCH_MAX_LENGTH,
  type SearchParams,
  parseUserFilters,
} from "@/lib/validation/admin";
import { AdminBadge, AdminEmpty, AdminShell } from "@/components/admin/admin-shell";
import { AdminPagination } from "@/components/admin/admin-pagination";
import { Button } from "@/components/ui/button";

/**
 * `/admin/usuarios` (Fase 7): búsqueda y filtros por GET, sin JavaScript.
 * `requireAdmin()` aquí (no basta el layout) y, en la base de datos,
 * `admin_list_users` comprueba `is_admin()`. Solo nombre, rol, estado,
 * onboarding, alta y recuentos: nunca email ni fecha de nacimiento.
 */

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Usuarios | Administración | Roomly",
  robots: { index: false, follow: false },
};

class AdminUnavailableError extends Error {
  constructor() {
    super("No hemos podido cargar los usuarios. Vuelve a intentarlo en un momento.");
    this.name = "AdminUnavailableError";
  }
}

const selectClass =
  "rounded-[var(--radius)] border border-[var(--border)] bg-[var(--background)] p-2 text-sm";

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireAdmin();
  const query = await searchParams;
  const filters = parseUserFilters(query);
  const result = await listUsersForAdmin(await createClient(), filters);
  if (!result.ok) throw new AdminUnavailableError();
  const { items, total, page, pageCount } = result.data;

  const params: Record<string, string> = {};
  if (filters.search) params.q = filters.search;
  if (filters.status !== "all") params.estado = filters.status;
  if (filters.role !== "all") params.rol = filters.role;
  if (filters.onboarding !== "all") params.onboarding = filters.onboarding;
  if (filters.reported) params.reportados = "1";
  const filtered = Object.keys(params).length > 0;

  return (
    <AdminShell
      section="usuarios"
      title="Usuarios"
      description="Busca cuentas por nombre y filtra por estado. Sin datos de contacto."
      notice={query.aviso}
    >
      <form
        method="get"
        action={ADMIN_USERS_PATH}
        role="search"
        className="grid gap-3 rounded-[var(--radius-lg)] border border-[var(--border)] p-4 sm:grid-cols-2 lg:grid-cols-5"
        data-testid="admin-users-filters"
      >
        <label className="flex flex-col gap-1 text-sm lg:col-span-2">
          <span className="font-medium">Nombre</span>
          <input
            type="search"
            name="q"
            defaultValue={filters.search}
            maxLength={ADMIN_SEARCH_MAX_LENGTH}
            className={selectClass}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Estado</span>
          <select name="estado" defaultValue={filters.status} className={selectClass}>
            <option value="all">Todas</option>
            <option value="active">Activas</option>
            <option value="suspended">Suspendidas o desactivadas</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Rol</span>
          <select name="rol" defaultValue={filters.role} className={selectClass}>
            <option value="all">Todos</option>
            <option value="user">Usuarios</option>
            <option value="admin">Administración</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Perfil</span>
          <select
            name="onboarding"
            defaultValue={filters.onboarding}
            className={selectClass}
          >
            <option value="all">Todos</option>
            <option value="complete">Completo</option>
            <option value="incomplete">Sin completar</option>
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm sm:col-span-2 lg:col-span-3">
          <input
            type="checkbox"
            name="reportados"
            value="1"
            defaultChecked={filters.reported}
          />
          Solo con reportes abiertos
        </label>
        <div className="flex items-center gap-3 sm:col-span-2 lg:col-span-2 lg:justify-end">
          <Button type="submit" variant="secondary">
            Filtrar
          </Button>
          {filtered ? (
            <Link href={ADMIN_USERS_PATH} className="text-sm underline">
              Quitar filtros
            </Link>
          ) : null}
        </div>
      </form>

      {items.length === 0 ? (
        <AdminEmpty testId="admin-users-empty">
          {filtered
            ? "Ninguna cuenta coincide con los filtros."
            : "Todavía no hay cuentas."}
        </AdminEmpty>
      ) : (
        <ul
          className="flex flex-col divide-y divide-[var(--border)] rounded-[var(--radius-lg)] border border-[var(--border)]"
          data-testid="admin-users-list"
        >
          {items.map((user) => (
            <li key={user.id} data-testid="admin-user-row">
              <Link
                href={adminUserPath(user.id)}
                className="flex flex-col gap-1 p-4 hover:bg-[var(--surface)] sm:flex-row sm:items-center sm:justify-between"
              >
                <span className="flex flex-col">
                  <span className="font-medium">{user.fullName}</span>
                  <span className="text-xs text-[var(--muted)]">
                    {labelOr(SEEKING_STATUS_LABELS, user.seekingStatus)} · alta{" "}
                    {adminDayText(user.createdAt)}
                    {user.roomsCount > 0
                      ? ` · ${user.roomsCount} ${user.roomsCount === 1 ? "habitación" : "habitaciones"}`
                      : ""}
                  </span>
                </span>
                <span className="flex flex-wrap gap-1">
                  {user.role === "admin" ? <AdminBadge>Administración</AdminBadge> : null}
                  {user.suspended ? (
                    <AdminBadge tone="danger">Suspendida o desactivada</AdminBadge>
                  ) : (
                    <AdminBadge tone="ok">Activa</AdminBadge>
                  )}
                  {!user.onboardingCompleted ? (
                    <AdminBadge>Perfil sin completar</AdminBadge>
                  ) : null}
                  {user.openReports > 0 ? (
                    <AdminBadge tone="warning">
                      {user.openReports}{" "}
                      {user.openReports === 1 ? "reporte abierto" : "reportes abiertos"}
                    </AdminBadge>
                  ) : null}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <AdminPagination
        basePath={ADMIN_USERS_PATH}
        params={params}
        page={page}
        pageCount={pageCount}
        total={total}
      />
    </AdminShell>
  );
}
