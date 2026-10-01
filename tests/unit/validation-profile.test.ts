import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  notificationSettingsSchema,
  profileCreateSchema,
  profileUpdateSchema,
} from "@/lib/validation/profile";
import { latestBirthDateForAge, todayUtc } from "@/lib/validation/common";

// Día fijo en UTC: los cálculos de edad no dependen del reloj real.
const NOW = new Date("2026-09-29T12:00:00Z");

const valid = {
  full_name: "Ana García",
  date_of_birth: "2000-05-10",
  seeking_status: "looking_for_room",
};

function errorsOf(result: {
  success: boolean;
  error?: { issues: { path: PropertyKey[] }[] };
}) {
  return (result.error?.issues ?? []).map((issue) => issue.path.join("."));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

describe("profileCreateSchema — full_name", () => {
  it("acepta un nombre válido", () => {
    expect(profileCreateSchema.parse(valid).full_name).toBe("Ana García");
  });

  it("acepta exactamente 100 caracteres y rechaza 101", () => {
    expect(
      profileCreateSchema.safeParse({ ...valid, full_name: "a".repeat(100) }).success
    ).toBe(true);
    const tooLong = profileCreateSchema.safeParse({
      ...valid,
      full_name: "a".repeat(101),
    });
    expect(tooLong.success).toBe(false);
    expect(errorsOf(tooLong)).toContain("full_name");
  });

  it("cuenta caracteres como PostgreSQL (code points), no unidades UTF-16", () => {
    // 100 emojis = 200 unidades UTF-16 pero 100 caracteres para char_length.
    expect(
      profileCreateSchema.safeParse({ ...valid, full_name: "😀".repeat(100) }).success
    ).toBe(true);
  });

  it("recorta y colapsa espacios internos", () => {
    const parsed = profileCreateSchema.parse({
      ...valid,
      full_name: "  Ana \t  María\n García ",
    });
    expect(parsed.full_name).toBe("Ana María García");
  });

  it("rechaza un nombre vacío o solo espacios", () => {
    expect(profileCreateSchema.safeParse({ ...valid, full_name: "" }).success).toBe(
      false
    );
    expect(profileCreateSchema.safeParse({ ...valid, full_name: "   " }).success).toBe(
      false
    );
  });
});

describe("profileCreateSchema — bio", () => {
  it("es opcional", () => {
    expect(profileCreateSchema.parse(valid)).not.toHaveProperty("bio");
  });

  it("acepta 500 caracteres y rechaza 501", () => {
    expect(
      profileCreateSchema.safeParse({ ...valid, bio: "b".repeat(500) }).success
    ).toBe(true);
    const tooLong = profileCreateSchema.safeParse({ ...valid, bio: "b".repeat(501) });
    expect(tooLong.success).toBe(false);
    expect(errorsOf(tooLong)).toContain("bio");
  });

  it("convierte la cadena vacía (o solo espacios) en null y recorta", () => {
    expect(profileCreateSchema.parse({ ...valid, bio: "" }).bio).toBeNull();
    expect(profileCreateSchema.parse({ ...valid, bio: "   " }).bio).toBeNull();
    expect(profileCreateSchema.parse({ ...valid, bio: "  hola  " }).bio).toBe("hola");
  });
});

describe("profileCreateSchema — date_of_birth", () => {
  it("usa el día actual en UTC (current_date de PostgreSQL)", () => {
    expect(todayUtc()).toBe("2026-09-29");
    expect(latestBirthDateForAge(18)).toBe("2008-09-29");
  });

  it("acepta exactamente 18 años", () => {
    expect(
      profileCreateSchema.safeParse({ ...valid, date_of_birth: "2008-09-29" }).success
    ).toBe(true);
  });

  it("rechaza un día menos de 18 años", () => {
    const young = profileCreateSchema.safeParse({
      ...valid,
      date_of_birth: "2008-09-30",
    });
    expect(young.success).toBe(false);
    expect(errorsOf(young)).toContain("date_of_birth");
  });

  it("rechaza una fecha futura", () => {
    expect(
      profileCreateSchema.safeParse({ ...valid, date_of_birth: "2030-01-01" }).success
    ).toBe(false);
  });

  it("rechaza fechas inexistentes o con otro formato", () => {
    for (const date_of_birth of [
      "2000-02-30",
      "2000-13-01",
      "10/05/2000",
      "2000-5-10",
      "",
    ]) {
      expect(profileCreateSchema.safeParse({ ...valid, date_of_birth }).success).toBe(
        false
      );
    }
  });

  it("29 de febrero: se ajusta al 28 como `current_date - interval '18 years'`", () => {
    const leapDay = new Date("2024-02-29T08:00:00Z");
    expect(latestBirthDateForAge(18, leapDay)).toBe("2006-02-28");
  });

  it("cerca de medianoche manda UTC, no la hora local", () => {
    // 23:30 del 28 en UTC-2 ya es el 29 en UTC.
    vi.setSystemTime(new Date("2026-09-29T01:30:00Z"));
    expect(todayUtc()).toBe("2026-09-29");
  });
});

describe("profileCreateSchema — seeking_status", () => {
  it("acepta los tres valores del enum de la base de datos", () => {
    for (const seeking_status of [
      "looking_for_room",
      "has_room_looking_for_roommate",
      "flexible",
    ]) {
      expect(profileCreateSchema.safeParse({ ...valid, seeking_status }).success).toBe(
        true
      );
    }
  });

  it("rechaza un valor inválido", () => {
    expect(
      profileCreateSchema.safeParse({ ...valid, seeking_status: "otro" }).success
    ).toBe(false);
  });

  it("es obligatorio al crear: el default de la base de datos no cuenta como elección", () => {
    const result = profileCreateSchema.safeParse({
      full_name: valid.full_name,
      date_of_birth: valid.date_of_birth,
    });
    expect(result.success).toBe(false);
    expect(errorsOf(result)).toContain("seeking_status");
  });
});

describe("profileCreateSchema — claves no permitidas", () => {
  it.each([
    "id",
    "role",
    "deleted_at",
    "created_at",
    "updated_at",
    "onboarding_completed_at",
    "avatar_url",
    "email",
  ])("rechaza %s", (key) => {
    expect(profileCreateSchema.safeParse({ ...valid, [key]: "x" }).success).toBe(false);
  });
});

describe("profileUpdateSchema", () => {
  it("acepta un solo campo", () => {
    expect(profileUpdateSchema.parse({ bio: "nueva" })).toEqual({ bio: "nueva" });
  });

  it("exige al menos un campo", () => {
    expect(profileUpdateSchema.safeParse({}).success).toBe(false);
  });

  it("aplica las mismas reglas que al crear", () => {
    expect(profileUpdateSchema.safeParse({ full_name: "a".repeat(101) }).success).toBe(
      false
    );
    expect(profileUpdateSchema.safeParse({ date_of_birth: "2008-09-30" }).success).toBe(
      false
    );
    expect(profileUpdateSchema.parse({ full_name: "  Ana   López " })).toEqual({
      full_name: "Ana López",
    });
  });

  it("rechaza role, deleted_at, onboarding_completed_at e id", () => {
    for (const key of ["role", "deleted_at", "onboarding_completed_at", "id"]) {
      expect(profileUpdateSchema.safeParse({ bio: "x", [key]: "y" }).success).toBe(false);
    }
  });
});

describe("profileUpdateSchema — edición en /perfil (Fase 2.4)", () => {
  it("acepta email_notifications_enabled booleano", () => {
    expect(profileUpdateSchema.parse({ email_notifications_enabled: false })).toEqual({
      email_notifications_enabled: false,
    });
  });

  it.each([null, "on", "true", 1])(
    "rechaza email_notifications_enabled no booleano (%s)",
    (value) => {
      expect(
        profileUpdateSchema.safeParse({ email_notifications_enabled: value }).success
      ).toBe(false);
    }
  );

  it("edición parcial sin seeking_status: la salida no incluye la clave (no se toca)", () => {
    const parsed = profileUpdateSchema.parse({ full_name: "Ana", bio: "x" });
    expect(parsed).toEqual({ full_name: "Ana", bio: "x" });
    expect(parsed).not.toHaveProperty("seeking_status");
  });

  it("seeking_status no admite null (columna NOT NULL)", () => {
    expect(profileUpdateSchema.safeParse({ seeking_status: null }).success).toBe(false);
  });

  it("bio vacía → null (se borra)", () => {
    expect(profileUpdateSchema.parse({ bio: "   " })).toEqual({ bio: null });
  });

  it.each([
    "id",
    "profile_id",
    "role",
    "deleted_at",
    "created_at",
    "updated_at",
    "onboarding_completed_at",
    "avatar_url",
  ])("rechaza %s junto a un cambio válido", (key) => {
    expect(profileUpdateSchema.safeParse({ full_name: "Ana", [key]: "x" }).success).toBe(
      false
    );
  });
});

describe("notificationSettingsSchema (/ajustes, Fase 2.6)", () => {
  it("acepta solo el booleano de avisos", () => {
    expect(
      notificationSettingsSchema.parse({ email_notifications_enabled: true })
    ).toEqual({
      email_notifications_enabled: true,
    });
    expect(
      notificationSettingsSchema.parse({ email_notifications_enabled: false })
    ).toEqual({
      email_notifications_enabled: false,
    });
  });

  it.each([null, "on", "false", 0, undefined])("rechaza %s", (value) => {
    expect(
      notificationSettingsSchema.safeParse({ email_notifications_enabled: value }).success
    ).toBe(false);
  });

  it.each([
    "full_name",
    "bio",
    "seeking_status",
    "date_of_birth",
    "profile_id",
    "id",
    "role",
    "deleted_at",
    "onboarding_completed_at",
  ])("rechaza %s aunque venga con un aviso válido", (key) => {
    expect(
      notificationSettingsSchema.safeParse({
        email_notifications_enabled: true,
        [key]: "x",
      }).success
    ).toBe(false);
  });
});
