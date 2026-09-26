import { describe, it, expect } from "vitest";
import { cn } from "@/lib/utils/cn";

describe("cn", () => {
  it("combina clases y resuelve conflictos de Tailwind (gana la última)", () => {
    expect(cn("px-2 py-1", "px-4")).toBe("py-1 px-4");
  });

  it("ignora valores falsy", () => {
    expect(cn("a", false, undefined, null, "b")).toBe("a b");
  });
});
