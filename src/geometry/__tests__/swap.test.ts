import { beforeAll, describe, expect, it } from "vitest";
import { loadManifold, type ManifoldToplevel } from "../manifold";
import { analyzeBin, buildPresetFoot, toManifold, fromManifold } from "../gridfinity";
import { mapCell, swapBase } from "../swap";
import { parseModel } from "../parse";
import { to3mf, toBinaryStl } from "../export";
import { makeBin } from "../sample";

let wasm: ManifoldToplevel;
beforeAll(async () => {
  wasm = await loadManifold();
});

describe("analyzeBin", () => {
  it("detects grid size, centre and base height", () => {
    const bin = makeBin(wasm, 3, 2, "magnets", 42, [100, 50, 7]);
    const a = analyzeBin(bin);
    expect([a.unitsX, a.unitsY, a.footPitch]).toEqual([3, 2, 42]);
    expect(a.center[0]).toBeCloseTo(100, 1);
    expect(a.center[1]).toBeCloseTo(50, 1);
    expect(a.baseDetected).toBe(true);
    expect(a.baseHeight).toBeCloseTo(4.75, 2);
    expect(a.warnings).toEqual([]);
  });

  it("detects the base height of a 1x1 bin", () => {
    const a = analyzeBin(makeBin(wasm, 1, 1, "plain"));
    expect([a.unitsX, a.unitsY]).toEqual([1, 1]);
    expect(a.baseHeight).toBeCloseTo(4.75, 2);
  });
});

describe("swapBase", () => {
  it("replaces magnet feet with plain feet from a 1x1 donor", () => {
    const target = makeBin(wasm, 3, 2, "magnets", 42, [10, -20, 3]);
    const donor = makeBin(wasm, 1, 1, "plain", 14, [-200, 0, 0]);
    const expected = makeBin(wasm, 3, 2, "plain", 42, [10, -20, 3]);
    const ta = analyzeBin(target);
    const da = analyzeBin(donor);
    const r = swapBase(
      wasm,
      { solid: target, analysis: ta, cut: ta.baseHeight },
      { solid: donor, analysis: da, cut: da.baseHeight },
    );
    expect(r.pieces).toBe(1);
    expect(r.voids).toBe(0);
    expect(r.warnings).toEqual([]);
    expect(r.solid.genus()).toBe(expected.genus());
    expect(r.solid.volume()).toBeCloseTo(expected.volume(), 0);
    const bb = r.solid.boundingBox();
    expect(bb.min[2]).toBeCloseTo(3, 3);
    expect(r.bodyTriangles).toBeGreaterThan(0);
    expect(r.bodyTriangles).toBeLessThan(r.mesh.indices.length / 3);
  });

  it("adds magnet holes using the built-in foot", () => {
    const target = makeBin(wasm, 2, 2, "plain");
    const expected = makeBin(wasm, 2, 2, "magnets");
    const ta = analyzeBin(target);
    const foot = buildPresetFoot(wasm, "magnets");
    const r = swapBase(
      wasm,
      { solid: target, analysis: ta, cut: ta.baseHeight },
      { solid: foot, analysis: { min: [0, 0, 0], unitsX: 1, unitsY: 1, footPitch: 42, center: [0, 0] }, cut: 4.75 },
    );
    expect(r.pieces).toBe(1);
    expect(r.solid.volume()).toBeCloseTo(expected.volume(), 0);
  });

  it("maps edge cells to edge cells", () => {
    expect([0, 1, 2, 3, 4].map((i) => mapCell(i, 5, 3))).toEqual([0, 1, 1, 1, 2]);
    expect([0, 1, 2].map((i) => mapCell(i, 3, 1))).toEqual([0, 0, 0]);
    expect([0, 1, 2, 3].map((i) => mapCell(i, 4, 4))).toEqual([0, 1, 2, 3]);
  });
});

describe("file round-trip", () => {
  it("survives STL and 3MF export/import as a manifold", () => {
    const bin = makeBin(wasm, 2, 1, "magnets");
    const mesh = fromManifold(bin);
    for (const [name, bytes] of [
      ["a.stl", toBinaryStl(mesh)],
      ["a.3mf", to3mf(mesh)],
    ] as const) {
      const parsed = parseModel(name, bytes);
      const back = toManifold(wasm, parsed);
      expect(back.volume()).toBeCloseTo(bin.volume(), 1);
      expect(back.genus()).toBe(bin.genus());
    }
  });
});
