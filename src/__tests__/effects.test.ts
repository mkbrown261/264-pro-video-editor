/**
 * FIX 7: Effects (Blur / Sharpen) — unit tests
 * Verifies that computeCssFilterFromEffects produces visible, non-trivial
 * CSS filter strings for every enabled effect type.
 */
import { describe, it, expect } from "vitest";
import { computeCssFilterFromEffects } from "../renderer/components/EffectsPanel";
import type { ClipEffect } from "../shared/models";

function makeEffect(type: ClipEffect["type"], params: Record<string, number | string | boolean> = {}, enabled = true): ClipEffect {
  return {
    id: `test-${type}`,
    type,
    enabled,
    order: 0,
    params,
  };
}

describe("computeCssFilterFromEffects", () => {
  it("returns 'none' for empty effects array", () => {
    expect(computeCssFilterFromEffects([])).toBe("none");
  });

  it("returns 'none' for all-disabled effects", () => {
    const effects = [makeEffect("blur", {}, false), makeEffect("sharpen", {}, false)];
    expect(computeCssFilterFromEffects(effects)).toBe("none");
  });

  it("FIX 7: blur produces a clearly visible filter (≥5px)", () => {
    const result = computeCssFilterFromEffects([makeEffect("blur", { radius: 5 })]);
    // Should produce blur(5px) or larger — not the old 2.5px
    const match = result.match(/blur\((\d+(?:\.\d+)?)px\)/);
    expect(match).not.toBeNull();
    const px = parseFloat(match![1]);
    expect(px).toBeGreaterThanOrEqual(5);
  });

  it("FIX 7: sharpen produces visible contrast change (≥2.0)", () => {
    const result = computeCssFilterFromEffects([makeEffect("sharpen", { amount: 0.5 })]);
    const match = result.match(/contrast\((\d+(?:\.\d+)?)\)/);
    expect(match).not.toBeNull();
    const val = parseFloat(match![1]);
    expect(val).toBeGreaterThanOrEqual(2.0);
  });

  it("stacks multiple effects in order", () => {
    const effects = [
      makeEffect("blur",    { radius: 4 }, true),
      makeEffect("sharpen", { amount: 1 }, true),
    ];
    effects[0].order = 0;
    effects[1].order = 1;
    const result = computeCssFilterFromEffects(effects);
    // Both effects should appear in the string
    expect(result).toMatch(/blur/);
    expect(result).toMatch(/contrast/);
    // blur should come before contrast
    expect(result.indexOf("blur")).toBeLessThan(result.indexOf("contrast"));
  });

  it("disabled effect is not included in output", () => {
    const effects = [
      makeEffect("blur", { radius: 10 }, false),
      makeEffect("brightness", { brightness: 0.5 }, true),
    ];
    const result = computeCssFilterFromEffects(effects);
    expect(result).not.toMatch(/blur/);
    expect(result).toMatch(/brightness/);
  });

  it("brightness effect produces a valid filter string", () => {
    const result = computeCssFilterFromEffects([makeEffect("brightness", { brightness: 0.3, contrast: 0.2 })]);
    expect(result).toMatch(/brightness/);
    expect(result).toMatch(/contrast/);
  });

  it("hueShift effect produces hue-rotate", () => {
    const result = computeCssFilterFromEffects([makeEffect("hueShift", { hue: 90, saturation: 1.2, lightness: 0 })]);
    expect(result).toMatch(/hue-rotate\(90deg\)/);
  });

  it("vignette is excluded from CSS filter output", () => {
    // Vignette is rendered as a DOM overlay, not via CSS filter
    const result = computeCssFilterFromEffects([makeEffect("vignette", { intensity: 0.8, radius: 0.7, feather: 0.5 })]);
    expect(result).toBe("none");
  });
});
