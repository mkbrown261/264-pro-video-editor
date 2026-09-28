import { describe, it, expect } from "vitest";
import { createDefaultColorGrade, type ColorGrade } from "../shared/models";
import {
  applyGrade,
  applyGradeChain,
  bakeChainToLut,
  compileGrade,
  getClipGradeNodes,
  isIdentityChain,
  parseCubeLut,
  resolveGradeAtFrame,
  sampleLut3D,
  serializeCubeLut,
  type RGB,
} from "../shared/colorMath";

const grade = (p: Partial<ColorGrade>): ColorGrade => ({ ...createDefaultColorGrade(), ...p });
const close = (a: RGB, b: RGB, eps = 1e-3) =>
  a.forEach((v, i) => expect(Math.abs(v - b[i])).toBeLessThan(eps));

/** Reference: the original GLSL main() for the primary stages, line for line. */
function shaderReference(c: RGB, g: ColorGrade): RGB {
  const cl = (v: number) => Math.min(1, Math.max(0, v));
  let col = c.map((v) => cl(v * Math.pow(2, g.exposure))) as RGB;
  const lgg = (v: number, l: number, gm: number, gn: number, o: number) => {
    let r = cl((gn + 1) * (v + l * (1 - v)));
    r = cl(Math.pow(Math.max(r, 0), 1 / Math.min(10, Math.max(0.1, 1 + gm))));
    return cl(r + o);
  };
  col = [
    lgg(col[0], g.lift.r, g.gamma.r, g.gain.r, g.offset.r),
    lgg(col[1], g.lift.g, g.gamma.g, g.gain.g, g.offset.g),
    lgg(col[2], g.lift.b, g.gamma.b, g.gain.b, g.offset.b),
  ];
  col = col.map((v) => cl((v - 0.5) * (1 + g.contrast) + 0.5)) as RGB;
  const t = g.temperature / 100;
  col = [cl(col[0] + t * 0.12), col[1], cl(col[2] - t * 0.12)];
  const ti = g.tint / 100;
  col = [cl(col[0] + ti * 0.04), cl(col[1] - ti * 0.1), cl(col[2] + ti * 0.04)];
  const luma = 0.2126 * col[0] + 0.7152 * col[1] + 0.0722 * col[2];
  return col.map((v) => cl(luma + (v - luma) * g.saturation)) as RGB;
}

describe("colorMath", () => {
  it("default grade is a pass-through", () => {
    close(applyGrade([0.2, 0.5, 0.8], createDefaultColorGrade()), [0.2, 0.5, 0.8], 1e-6);
    expect(isIdentityChain([compileGrade(createDefaultColorGrade())])).toBe(true);
  });

  it("matches the viewer shader math for primaries", () => {
    const g = grade({
      exposure: 0.4, contrast: 0.2, saturation: 1.3, temperature: 25, tint: -10,
      lift: { r: 0.05, g: 0, b: -0.03 }, gamma: { r: 0.1, g: 0.1, b: -0.2 },
      gain: { r: 0.1, g: -0.05, b: 0 }, offset: { r: 0, g: 0.02, b: 0 },
    });
    for (const px of [[0.1, 0.2, 0.3], [0.5, 0.5, 0.5], [0.9, 0.4, 0.1]] as RGB[]) {
      close(applyGrade(px, g), shaderReference(px, g), 1e-6);
    }
  });

  it("applies nodes in series, not summed", () => {
    const a = grade({ exposure: 1 });
    const b = grade({ contrast: 0.5 });
    const chain = [compileGrade(a), compileGrade(b)];
    const px: RGB = [0.2, 0.2, 0.2];
    close(applyGradeChain(px, chain), applyGrade(applyGrade(px, a), b), 1e-9);
  });

  it("baked LUT reproduces the chain", () => {
    const chain = [compileGrade(grade({ exposure: 0.3, saturation: 1.4, contrast: 0.15 }))];
    const lut = bakeChainToLut(chain, 33);
    for (const px of [[0.13, 0.57, 0.71], [0.33, 0.33, 0.9]] as RGB[]) {
      close(sampleLut3D(lut, px), applyGradeChain(px, chain), 0.02);
    }
  });

  it("round-trips .cube serialization", () => {
    const lut = bakeChainToLut([compileGrade(grade({ temperature: 40 }))], 5);
    const parsed = parseCubeLut(serializeCubeLut(lut));
    expect(parsed?.size).toBe(5);
    close(sampleLut3D(parsed!, [0.5, 0.5, 0.5]), sampleLut3D(lut, [0.5, 0.5, 0.5]), 1e-5);
  });

  it("file LUT is mixed by intensity", () => {
    const invert = bakeChainToLut([], 2);
    invert.data = invert.data.map((v) => 1 - v);
    const half = compileGrade(grade({ lutIntensity: 0.5 }), invert);
    close(applyGradeChain([0.2, 0.2, 0.2], [half]), [0.5, 0.5, 0.5], 1e-6);
  });

  it("ColorSlice shifts only the targeted hue", () => {
    const g = grade({});
    g.colorSlice!.vectors.red = { hue: 0, saturation: -1, luminance: 0, softness: 0.5 };
    const red = applyGrade([0.9, 0.1, 0.1], g);
    const blue = applyGrade([0.1, 0.1, 0.9], g);
    expect(Math.abs(red[0] - red[1])).toBeLessThan(0.05); // desaturated
    close(blue, [0.1, 0.1, 0.9], 1e-6);                     // untouched
  });

  it("resolves grade keyframes", () => {
    const g = grade({ keyframes: { exposure: [{ frame: 0, value: 0 }, { frame: 10, value: 2 }] } });
    expect(resolveGradeAtFrame(g, 5).exposure).toBeCloseTo(1);
  });

  it("clip chain = colorGrade then enabled extra nodes", () => {
    const n1 = grade({ exposure: 1 });
    const n2 = grade({ contrast: 1 });
    const off = grade({ saturation: 0 });
    const chain = getClipGradeNodes({
      colorGrade: n1,
      gradeNodes: [
        { id: "a", label: "2", enabled: true, grade: n2 },
        { id: "b", label: "3", enabled: false, grade: off },
      ],
    });
    expect(chain).toEqual([n1, n2]);
  });
});
