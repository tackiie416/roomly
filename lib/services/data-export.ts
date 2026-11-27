import "server-only";

import {
  type DbClient,
  type ServiceResult,
  fail,
  mapDbError,
  ok,
} from "@/lib/services/result";

/**
 * «Descargar mis datos» (sesión 85, derecho de acceso y portabilidad):
 * todo lo que la persona puede leer de sí misma con **su propio cliente**
 * (RLS y GRANT de siempre; sin service_role), en un JSON.
 *
 * Minimización: no incluye identificadores ni datos de otras personas
 * (a quién envió un interés, con quién tiene un match, a quién bloqueó o
 * reportó, o lo que escribieron otros en un chat), ni las notas internas de
 * moderación. De esas relaciones solo salen la fecha, el tipo y, si es suya,
 * la habitación. Tampoco incluye los mensajes de chats cerrados: hoy nadie los
 * puede leer desde la app (decisión del 2026-11-26) y su acceso es una
 * decisión pendiente (docs/PRIVACY_RETENTION.md).
 *
 * Una consulta por tabla, en paralelo (sin N+1). Las fotos se piden con la
 * lista de sus habitaciones. Sin dirección exacta: la app no la recoge ni la
 * lee (R2, `tests/unit/rooms-crud-static.test.ts`), así que no hay ninguna
 * que exportar.
 */

export const DATA_EXPORT_FORMAT_VERSION = 1;

const PROFILE_COLUMNS =
  "id, full_name, date_of_birth, bio, seeking_status, email_notifications_enabled, onboarding_completed_at, created_at, updated_at, deleted_at";
const PREFERENCES_COLUMNS =
  "city_id, university_id, field_of_study, budget_min, budget_max, move_in_date, move_out_date, preferred_neighborhood_ids, roommates_wanted_min, roommates_wanted_max, updated_at";
const COMPATIBILITY_COLUMNS = "questionnaire_version, answers, completed_at, updated_at";
const ROOM_COLUMNS =
  "id, title, description, city_id, neighborhood_id, price_month, expenses_included, deposit_amount, available_from, min_stay_months, max_stay_months, total_roommates, total_rooms, features, pets_allowed, smoking_allowed, students_only, house_rules, roommate_preferences, status, created_at, updated_at, published_at";

export type DataExport = {
  format: "roomly-data-export";
  version: typeof DATA_EXPORT_FORMAT_VERSION;
  generatedAt: string;
  account: { id: string; email: string | null; createdAt: string | null };
  profile: Record<string, unknown> | null;
  housingPreferences: Record<string, unknown> | null;
  compatibilityTest: Record<string, unknown> | null;
  rooms: Array<
    Record<string, unknown> & {
      photos: { position: number; createdAt: string }[];
    }
  >;
  interestsSent: { createdAt: string; roomId: string | null }[];
  interestsReceivedCount: number;
  matches: { createdAt: string; compatibilityScore: number }[];
  messagesSent: { createdAt: string; content: string }[];
  blocksMade: { createdAt: string }[];
  reportsMade: {
    createdAt: string;
    target: "person" | "room";
    reason: string;
    description: string | null;
    status: string;
    resolvedAt: string | null;
  }[];
  notes: string[];
};

type Rows<T> = { data: T[] | null; error: { code?: string; message?: string } | null };

export async function exportOwnData(
  supabase: DbClient,
  now: () => Date = () => new Date()
): Promise<ServiceResult<DataExport>> {
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth?.user) return fail("unauthenticated");
  const user = auth.user;
  const me = user.id;

  const [
    profile,
    preferences,
    compatibility,
    rooms,
    sent,
    received,
    matches,
    messages,
    blocks,
    reports,
  ] = await Promise.all([
    supabase.from("profiles").select(PROFILE_COLUMNS).eq("id", me).maybeSingle(),
    supabase
      .from("housing_preferences")
      .select(PREFERENCES_COLUMNS)
      .eq("profile_id", me)
      .maybeSingle(),
    supabase
      .from("compatibility_responses")
      .select(COMPATIBILITY_COLUMNS)
      .eq("profile_id", me)
      .maybeSingle(),
    supabase.from("rooms").select(ROOM_COLUMNS).eq("owner_id", me).order("created_at"),
    supabase
      .from("interests")
      .select("created_at, room_id")
      .eq("from_user_id", me)
      .order("created_at"),
    supabase
      .from("interests")
      .select("id", { count: "exact", head: true })
      .eq("to_user_id", me),
    supabase
      .from("matches")
      .select("created_at, compatibility_score")
      .or(`user_a_id.eq.${me},user_b_id.eq.${me}`)
      .order("created_at"),
    supabase
      .from("messages")
      .select("created_at, content")
      .eq("sender_id", me)
      .order("created_at"),
    supabase
      .from("user_blocks")
      .select("created_at")
      .eq("blocker_id", me)
      .order("created_at"),
    supabase
      .from("reports")
      .select(
        "created_at, reported_user_id, reported_room_id, reason, description, status, resolved_at"
      )
      .eq("reporter_id", me)
      .order("created_at"),
  ]);

  for (const result of [
    profile,
    preferences,
    compatibility,
    rooms,
    sent,
    received,
    matches,
    messages,
    blocks,
    reports,
  ])
    if (result.error) return mapDbError(result.error);
  if (!profile.data) return fail("no_profile");

  const roomRows = (rooms.data ?? []) as Array<Record<string, unknown> & { id: string }>;
  const roomIds = roomRows.map((r) => r.id);
  let photos: { room_id: string; position: number; created_at: string }[] = [];
  if (roomIds.length > 0) {
    const img = await supabase
      .from("room_images")
      .select("room_id, position, created_at")
      .in("room_id", roomIds)
      .order("position");
    if (img.error) return mapDbError(img.error);
    photos = (img.data ?? []) as typeof photos;
  }

  const rows = <T>(r: Rows<T> | { data: unknown; error: unknown }) =>
    (r.data ?? []) as T[];

  return ok({
    format: "roomly-data-export",
    version: DATA_EXPORT_FORMAT_VERSION,
    generatedAt: now().toISOString(),
    account: { id: me, email: user.email ?? null, createdAt: user.created_at ?? null },
    profile: profile.data as Record<string, unknown>,
    housingPreferences: (preferences.data as Record<string, unknown> | null) ?? null,
    compatibilityTest: (compatibility.data as Record<string, unknown> | null) ?? null,
    rooms: roomRows.map((room) => ({
      ...room,
      photos: photos
        .filter((p) => p.room_id === room.id)
        .map((p) => ({ position: p.position, createdAt: p.created_at })),
    })),
    interestsSent: rows<{ created_at: string; room_id: string | null }>(sent).map(
      (i) => ({
        createdAt: i.created_at,
        roomId: i.room_id,
      })
    ),
    interestsReceivedCount: received.count ?? 0,
    matches: rows<{ created_at: string; compatibility_score: number }>(matches).map(
      (m) => ({
        createdAt: m.created_at,
        compatibilityScore: m.compatibility_score,
      })
    ),
    messagesSent: rows<{ created_at: string; content: string }>(messages).map((m) => ({
      createdAt: m.created_at,
      content: m.content,
    })),
    blocksMade: rows<{ created_at: string }>(blocks).map((b) => ({
      createdAt: b.created_at,
    })),
    reportsMade: rows<{
      created_at: string;
      reported_room_id: string | null;
      reason: string;
      description: string | null;
      status: string;
      resolved_at: string | null;
    }>(reports).map((r) => ({
      createdAt: r.created_at,
      target: r.reported_room_id ? "room" : "person",
      reason: r.reason,
      description: r.description,
      status: r.status,
      resolvedAt: r.resolved_at,
    })),
    notes: [
      "Incluye los datos que puedes ver de ti en Roomly. No incluye datos de otras personas (a quién enviaste intereses, con quién tienes match, a quién bloqueaste o reportaste, ni lo que escribieron otras personas).",
      "No incluye los mensajes de conversaciones cerradas: ya no se pueden leer desde la app.",
      "Los identificadores de ciudad, universidad y barrio corresponden a los catálogos públicos de Roomly.",
    ],
  });
}
