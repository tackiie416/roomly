/**
 * Tipos de la base de datos, escritos a mano a partir de
 * supabase/migrations/20260925120000_initial_schema.sql.
 *
 * IMPORTANTE: en cuanto exista un proyecto Supabase real, regenerar con
 *   npx supabase gen types typescript --project-id <id> > types/database.ts
 * y sustituir este archivo entero, para evitar que diverja del esquema
 * real. Mientras tanto, cualquier cambio al SQL debe reflejarse aquí a mano.
 *
 * NOTA sobre `Relationships: []`: postgrest-js (ver
 * node_modules/@supabase/postgrest-js/src/types/common/common.ts,
 * GenericTable/GenericView) exige este campo en cada tabla/vista para que
 * la inferencia de tipos funcione — sin él, cualquier `.from(x).select()`
 * resuelve a `never` en vez de dar un error claro (así se detectó, en
 * `npm run typecheck`, al construir app/admin/layout.tsx). Al no generar
 * los tipos desde un proyecto real, no tenemos metadata real de FKs para
 * `Relationships`, así que queda vacío: los `select` con recursos
 * embebidos (`.select("*, rooms(*)")`) no tendrán inferencia de tipos
 * hasta que este archivo se regenere de verdad.
 */

export type Json =
  string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type UserRole = "user" | "admin";
export type SeekingStatus =
  "looking_for_room" | "has_room_looking_for_roommate" | "flexible";
export type RoomStatus = "draft" | "active" | "paused" | "rented" | "removed";
export type ReportStatus = "pending" | "in_review" | "resolved" | "dismissed";

export interface Database {
  public: {
    Tables: {
      cities: {
        Row: {
          id: string;
          name: string;
          slug: string;
          is_active: boolean;
          center_lat: number | null;
          center_lng: number | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          slug: string;
          is_active?: boolean;
          center_lat?: number | null;
          center_lng?: number | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["cities"]["Insert"]>;
        Relationships: [];
      };
      neighborhoods: {
        Row: {
          id: string;
          city_id: string;
          name: string;
          slug: string;
          center_lat: number | null;
          center_lng: number | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          city_id: string;
          name: string;
          slug: string;
          center_lat?: number | null;
          center_lng?: number | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["neighborhoods"]["Insert"]>;
        Relationships: [];
      };
      universities: {
        Row: {
          id: string;
          city_id: string | null;
          name: string;
          slug: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          city_id?: string | null;
          name: string;
          slug: string;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["universities"]["Insert"]>;
        Relationships: [];
      };
      profiles: {
        Row: {
          id: string;
          full_name: string;
          date_of_birth: string;
          avatar_url: string | null;
          bio: string | null;
          seeking_status: SeekingStatus;
          role: UserRole;
          email_notifications_enabled: boolean;
          onboarding_completed_at: string | null;
          created_at: string;
          updated_at: string;
          deleted_at: string | null;
        };
        Insert: {
          id: string; // FK a auth.users.id, no autogenerado
          full_name: string;
          date_of_birth: string;
          avatar_url?: string | null;
          bio?: string | null;
          seeking_status?: SeekingStatus;
          email_notifications_enabled?: boolean;
          onboarding_completed_at?: string | null;
        };
        // Insert refleja el GRANT de INSERT del rol authenticated
        // (20260926120000_security_fixes.sql): `role`, `deleted_at`,
        // `created_at` y `updated_at` no se pueden enviar; los pone la base de
        // datos. Cambiar `role`/`deleted_at` es cosa del servidor con
        // service_role, nunca del flujo normal — ver SECURITY.md.
        // Update, además, excluye `id` (GRANT de UPDATE).
        Update: Partial<
          Pick<
            Database["public"]["Tables"]["profiles"]["Insert"],
            | "full_name"
            | "date_of_birth"
            | "avatar_url"
            | "bio"
            | "seeking_status"
            | "email_notifications_enabled"
            | "onboarding_completed_at"
          >
        >;
        Relationships: [];
      };
      housing_preferences: {
        Row: {
          profile_id: string;
          city_id: string | null;
          university_id: string | null;
          field_of_study: string | null;
          budget_min: number | null;
          budget_max: number | null;
          move_in_date: string | null;
          move_out_date: string | null;
          preferred_neighborhood_ids: string[];
          roommates_wanted_min: number | null;
          roommates_wanted_max: number | null;
          updated_at: string;
        };
        Insert: {
          profile_id: string;
          city_id?: string | null;
          university_id?: string | null;
          field_of_study?: string | null;
          budget_min?: number | null;
          budget_max?: number | null;
          move_in_date?: string | null;
          move_out_date?: string | null;
          preferred_neighborhood_ids?: string[];
          roommates_wanted_min?: number | null;
          roommates_wanted_max?: number | null;
        };
        // Insert/Update reflejan el GRANT por columnas de
        // 20260929120000_phase2_data_hardening.sql: `updated_at` la pone la
        // base de datos y `profile_id` no se puede cambiar con UPDATE.
        Update: Partial<
          Omit<
            Database["public"]["Tables"]["housing_preferences"]["Insert"],
            "profile_id"
          >
        >;
        Relationships: [];
      };
      compatibility_responses: {
        Row: {
          profile_id: string;
          questionnaire_version: number;
          answers: Json;
          completed_at: string;
          updated_at: string;
        };
        Insert: {
          profile_id: string;
          questionnaire_version?: number;
          answers: Json;
          completed_at?: string;
          updated_at?: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["compatibility_responses"]["Insert"]
        >;
        Relationships: [];
      };
      rooms: {
        Row: {
          id: string;
          owner_id: string;
          title: string;
          description: string | null;
          city_id: string;
          neighborhood_id: string | null;
          approx_lat: number | null;
          approx_lng: number | null;
          price_month: number;
          expenses_included: boolean;
          deposit_amount: number | null;
          available_from: string;
          min_stay_months: number | null;
          max_stay_months: number | null;
          total_roommates: number | null;
          total_rooms: number | null;
          features: string[];
          pets_allowed: boolean;
          smoking_allowed: boolean;
          students_only: boolean;
          house_rules: string | null;
          roommate_preferences: string | null;
          status: RoomStatus;
          created_at: string;
          updated_at: string;
          deleted_at: string | null;
        };
        Insert: {
          id?: string;
          owner_id: string;
          title: string;
          description?: string | null;
          city_id: string;
          neighborhood_id?: string | null;
          approx_lat?: number | null;
          approx_lng?: number | null;
          price_month: number;
          expenses_included?: boolean;
          deposit_amount?: number | null;
          available_from: string;
          min_stay_months?: number | null;
          max_stay_months?: number | null;
          total_roommates?: number | null;
          total_rooms?: number | null;
          features?: string[];
          pets_allowed?: boolean;
          smoking_allowed?: boolean;
          students_only?: boolean;
          house_rules?: string | null;
          roommate_preferences?: string | null;
          status?: RoomStatus;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["rooms"]["Insert"]>;
        Relationships: [];
      };
      room_addresses: {
        Row: {
          room_id: string;
          address_exact: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          room_id: string;
          address_exact: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["room_addresses"]["Insert"]>;
        Relationships: [];
      };
      room_images: {
        Row: {
          id: string;
          room_id: string;
          storage_path: string;
          position: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          room_id: string;
          storage_path: string;
          position?: number;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["room_images"]["Insert"]>;
        Relationships: [];
      };
      favorites: {
        Row: { user_id: string; room_id: string; created_at: string };
        Insert: { user_id: string; room_id: string; created_at?: string };
        Update: Partial<Database["public"]["Tables"]["favorites"]["Insert"]>;
        Relationships: [];
      };
      interests: {
        Row: {
          id: string;
          from_user_id: string;
          to_user_id: string;
          room_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          from_user_id: string;
          to_user_id: string;
          room_id?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["interests"]["Insert"]>;
        Relationships: [];
      };
      matches: {
        // Solo lectura desde el cliente: no hay política de INSERT para
        // `authenticated`. Se crea desde el servidor con la service_role key.
        Row: {
          id: string;
          user_a_id: string;
          user_b_id: string;
          room_id: string | null;
          compatibility_score: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_a_id: string;
          user_b_id: string;
          room_id?: string | null;
          compatibility_score: number;
          created_at?: string;
        };
        Update: never;
        Relationships: [];
      };
      conversations: {
        Row: {
          id: string;
          match_id: string | null;
          created_at: string;
          last_message_at: string | null;
        };
        Insert: {
          id?: string;
          match_id?: string | null;
          created_at?: string;
          last_message_at?: string | null;
        };
        Update: never; // igual que matches: solo el servidor
        Relationships: [];
      };
      conversation_participants: {
        Row: {
          conversation_id: string;
          user_id: string;
          last_read_at: string | null;
          joined_at: string;
        };
        Insert: {
          conversation_id: string;
          user_id: string;
          last_read_at?: string | null;
          joined_at?: string;
        };
        // Solo last_read_at es actualizable por el cliente — ver SECURITY.md.
        Update: Partial<
          Pick<
            Database["public"]["Tables"]["conversation_participants"]["Insert"],
            "last_read_at"
          >
        >;
        Relationships: [];
      };
      messages: {
        Row: {
          id: string;
          conversation_id: string;
          sender_id: string;
          content: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          conversation_id: string;
          sender_id: string;
          content: string;
          created_at?: string;
        };
        Update: never; // sin edición de mensajes en el MVP
        Relationships: [];
      };
      reports: {
        Row: {
          id: string;
          reporter_id: string;
          reported_user_id: string | null;
          reported_room_id: string | null;
          reason: string;
          description: string | null;
          status: ReportStatus;
          resolved_by: string | null;
          resolution_notes: string | null;
          created_at: string;
          resolved_at: string | null;
        };
        Insert: {
          id?: string;
          reporter_id: string;
          reported_user_id?: string | null;
          reported_room_id?: string | null;
          reason: string;
          description?: string | null;
          status?: ReportStatus;
          resolved_by?: string | null;
          resolution_notes?: string | null;
          created_at?: string;
          resolved_at?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["reports"]["Insert"]>;
        Relationships: [];
      };
      admin_action_logs: {
        Row: {
          id: string;
          admin_id: string;
          action: string;
          target_type: string;
          target_id: string | null;
          notes: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          admin_id: string;
          action: string;
          target_type: string;
          target_id?: string | null;
          notes?: string | null;
          created_at?: string;
        };
        Update: never; // append-only
        Relationships: [];
      };
      notifications: {
        Row: {
          id: string;
          user_id: string;
          type: string;
          payload: Json;
          read_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          type: string;
          payload?: Json;
          read_at?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["notifications"]["Insert"]>;
        Relationships: [];
      };
    };
    Views: {
      public_profile_previews: {
        Row: {
          id: string;
          full_name: string;
          avatar_url: string | null;
          role: UserRole;
        };
        Relationships: [];
      };
    };
    Functions: {
      is_admin: {
        Args: Record<string, never>;
        Returns: boolean;
      };
    };
    Enums: {
      user_role: UserRole;
      seeking_status: SeekingStatus;
      room_status: RoomStatus;
      report_status: ReportStatus;
    };
    CompositeTypes: Record<string, never>;
  };
}

export type Tables<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Row"];
export type TablesInsert<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Insert"];
export type TablesUpdate<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Update"];
