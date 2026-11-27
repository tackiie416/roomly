import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth/session";
import { listRoomsForAdmin } from "@/lib/services/admin";
import { ADMIN_ROOMS_PATH, adminRoomPath } from "@/lib/admin/paths";
import { adminDayText, labelOr } from "@/lib/admin/format";
import { ROOM_STATUS_LABELS } from "@/lib/validation/rooms";
import {
  ADMIN_SEARCH_MAX_LENGTH,
  ROOM_STATUS_FILTERS,
  type SearchParams,
  parseRoomFilters,
} from "@/lib/validation/admin";
import { AdminBadge, AdminEmpty, AdminShell } from "@/components/admin/admin-shell";
import { AdminPagination } from "@/components/admin/admin-pagination";
import { Button } from "@/components/ui/button";

/**
 * `/admin/habitaciones` (Fase 7): todas las habitaciones, en cualquier
 * estado, con búsqueda por título y filtros GET. `requireAdmin()` aquí y
 * `admin_list_rooms` (is_admin()) en la base de datos. Sin dirección exacta
 * ni coordenadas.
 */

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Habitaciones | Administración | Roomly",
  robots: { index: false, follow: false },
};

class AdminUnavailableError extends Error {
  constructor() {
    super("No hemos podido cargar las habitaciones. Vuelve a intentarlo en un momento.");
    this.name = "AdminUnavailableError";
  }
}

const inputClass =
  "rounded-[var(--radius)] border border-[var(--border)] bg-[var(--background)] p-2 text-sm";
const priceText = (value: number) =>
  new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(value);

export default async function AdminRoomsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireAdmin();
  const query = await searchParams;
  const filters = parseRoomFilters(query);
  const result = await listRoomsForAdmin(await createClient(), filters);
  if (!result.ok) throw new AdminUnavailableError();
  const { items, total, page, pageCount } = result.data;

  const params: Record<string, string> = {};
  if (filters.search) params.q = filters.search;
  if (filters.status !== "all") params.estado = filters.status;
  if (filters.reported) params.reportados = "1";
  const filtered = Object.keys(params).length > 0;

  return (
    <AdminShell
      section="habitaciones"
      title="Habitaciones"
      description="Todas las habitaciones, también borradores y retiradas."
      notice={query.aviso}
    >
      <form
        method="get"
        action={ADMIN_ROOMS_PATH}
        role="search"
        className="grid gap-3 rounded-[var(--radius-lg)] border border-[var(--border)] p-4 sm:grid-cols-2 lg:grid-cols-4"
        data-testid="admin-rooms-filters"
      >
        <label className="flex flex-col gap-1 text-sm sm:col-span-2">
          <span className="font-medium">Título</span>
          <input
            type="search"
            name="q"
            defaultValue={filters.search}
            maxLength={ADMIN_SEARCH_MAX_LENGTH}
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Estado</span>
          <select name="estado" defaultValue={filters.status} className={inputClass}>
            {ROOM_STATUS_FILTERS.map((status) => (
              <option key={status} value={status}>
                {status === "all" ? "Todos" : labelOr(ROOM_STATUS_LABELS, status)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 self-end pb-2 text-sm">
          <input
            type="checkbox"
            name="reportados"
            value="1"
            defaultChecked={filters.reported}
          />
          Con reportes abiertos
        </label>
        <div className="flex items-center gap-3 sm:col-span-2 lg:col-span-4">
          <Button type="submit" variant="secondary">
            Filtrar
          </Button>
          {filtered ? (
            <Link href={ADMIN_ROOMS_PATH} className="text-sm underline">
              Quitar filtros
            </Link>
          ) : null}
        </div>
      </form>

      {items.length === 0 ? (
        <AdminEmpty testId="admin-rooms-empty">
          {filtered
            ? "Ninguna habitación coincide con los filtros."
            : "Todavía no hay habitaciones."}
        </AdminEmpty>
      ) : (
        <ul
          className="flex flex-col divide-y divide-[var(--border)] rounded-[var(--radius-lg)] border border-[var(--border)]"
          data-testid="admin-rooms-list"
        >
          {items.map((room) => (
            <li key={room.id} data-testid="admin-room-row">
              <Link
                href={adminRoomPath(room.id)}
                className="flex flex-col gap-1 p-4 hover:bg-[var(--surface)] sm:flex-row sm:items-center sm:justify-between"
              >
                <span className="flex flex-col">
                  <span className="font-medium">{room.title}</span>
                  <span className="text-xs text-[var(--muted)]">
                    {[room.neighborhoodName, room.cityName].filter(Boolean).join(", ") ||
                      "Sin zona"}{" "}
                    · {priceText(room.priceMonth)} · de {room.ownerName}
                    {room.ownerDeactivated ? " (cuenta desactivada)" : ""} · creada{" "}
                    {adminDayText(room.createdAt)}
                  </span>
                </span>
                <span className="flex flex-wrap gap-1">
                  <AdminBadge
                    tone={
                      room.status === "removed"
                        ? "danger"
                        : room.status === "active"
                          ? "ok"
                          : "neutral"
                    }
                  >
                    {labelOr(ROOM_STATUS_LABELS, room.status)}
                  </AdminBadge>
                  {room.openReports > 0 ? (
                    <AdminBadge tone="warning">
                      {room.openReports}{" "}
                      {room.openReports === 1 ? "reporte abierto" : "reportes abiertos"}
                    </AdminBadge>
                  ) : null}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <AdminPagination
        basePath={ADMIN_ROOMS_PATH}
        params={params}
        page={page}
        pageCount={pageCount}
        total={total}
      />
    </AdminShell>
  );
}
