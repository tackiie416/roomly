import { describe, expect, it } from "vitest";
import {
  ROOM_FEATURE_KEYS,
  ROOM_FEATURES,
  ROOM_PUBLICATION_REQUIRED_FIELDS,
  roomFeatureLabel,
  roomFeaturesSchema,
  totalRoommatesSchema,
  totalRoomsSchema,
} from "@/lib/validation/rooms";

describe("ROOM_FEATURES — catálogo cerrado (R6)", () => {
  it("es exactamente la lista aprobada, con sus claves y etiquetas, en ese orden", () => {
    expect(ROOM_FEATURES).toEqual([
      { key: "wifi", label: "Wi-Fi" },
      { key: "heating", label: "Calefacción" },
      { key: "air_conditioning", label: "Aire acondicionado" },
      { key: "elevator", label: "Ascensor" },
      { key: "washing_machine", label: "Lavadora" },
      { key: "dishwasher", label: "Lavavajillas" },
      { key: "balcony", label: "Terraza o balcón" },
      { key: "furnished", label: "Amueblada" },
      { key: "private_bathroom", label: "Baño privado" },
      { key: "double_bed", label: "Cama doble" },
      { key: "desk", label: "Escritorio" },
      { key: "exterior", label: "Exterior" },
    ]);
  });

  it("no repite claves ni incluye los campos booleanos propios", () => {
    expect(new Set(ROOM_FEATURE_KEYS).size).toBe(ROOM_FEATURE_KEYS.length);
    for (const key of ["pets_allowed", "smoking_allowed", "students_only"]) {
      expect(ROOM_FEATURE_KEYS).not.toContain(key);
    }
  });

  it("da la etiqueta de cada clave", () => {
    for (const { key, label } of ROOM_FEATURES) expect(roomFeatureLabel(key)).toBe(label);
  });
});

describe("roomFeaturesSchema", () => {
  it("acepta cada clave del catálogo, todas a la vez y la lista vacía", () => {
    for (const key of ROOM_FEATURE_KEYS) {
      expect(roomFeaturesSchema.parse([key])).toEqual([key]);
    }
    expect(roomFeaturesSchema.parse([...ROOM_FEATURE_KEYS])).toEqual(ROOM_FEATURE_KEYS);
    expect(roomFeaturesSchema.parse([])).toEqual([]);
  });

  it("rechaza claves desconocidas, con otras mayúsculas o que no son texto", () => {
    for (const value of [["pool"], ["WiFi"], ["wifi", "pets_allowed"], [null], [1]]) {
      expect(roomFeaturesSchema.safeParse(value).success).toBe(false);
    }
  });

  it("rechaza lo que no es una lista", () => {
    for (const value of ["wifi", null, undefined, { wifi: true }]) {
      expect(roomFeaturesSchema.safeParse(value).success).toBe(false);
    }
  });

  it("quita las repetidas y conserva el orden de llegada", () => {
    expect(roomFeaturesSchema.parse(["desk", "wifi", "desk", "wifi"])).toEqual([
      "desk",
      "wifi",
    ]);
  });
});

describe("ocupación (R9)", () => {
  it("total_roommates: entero ≥ 0", () => {
    expect(totalRoommatesSchema.parse(0)).toBe(0);
    expect(totalRoommatesSchema.parse(3)).toBe(3);
    for (const value of [-1, 1.5, "2", 2 ** 31, null]) {
      expect(totalRoommatesSchema.safeParse(value).success).toBe(false);
    }
  });

  it("total_rooms: entero ≥ 1", () => {
    expect(totalRoomsSchema.parse(1)).toBe(1);
    expect(totalRoomsSchema.parse(4)).toBe(4);
    for (const value of [0, -2, 2.5, "3", 2 ** 31, null]) {
      expect(totalRoomsSchema.safeParse(value).success).toBe(false);
    }
  });
});

describe("requisitos de publicación (R7)", () => {
  it("son el barrio y la ocupación", () => {
    expect(ROOM_PUBLICATION_REQUIRED_FIELDS).toEqual([
      "neighborhood_id",
      "total_roommates",
      "total_rooms",
    ]);
  });
});
