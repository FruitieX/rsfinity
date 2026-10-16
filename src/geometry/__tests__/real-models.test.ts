// Swaps every pair of models in $RSFINITY_MODELS (STL/3MF files). Skipped when unset.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { analyzeBin, toManifold } from "../gridfinity";
import { loadManifold, type ManifoldToplevel } from "../manifold";
import { parseModel } from "../parse";
import { layoutPitch, swapBase } from "../swap";

const dir = process.env.RSFINITY_MODELS;
const files = dir ? readdirSync(dir).filter((f) => /\.(stl|3mf)$/i.test(f)) : [];

describe.skipIf(!dir)("real models", () => {
  let wasm: ManifoldToplevel;
  beforeAll(async () => {
    wasm = await loadManifold();
  });
  const load = (f: string) => {
    const solid = toManifold(wasm, parseModel(f, readFileSync(join(dir!, f))));
    return { solid, analysis: analyzeBin(solid) };
  };
  for (const f of files) {
    it(`analyses ${f}`, () => {
      const { analysis: a } = load(f);
      process.stdout.write(`${f}: ${a.unitsX}x${a.unitsY} pitch=${a.footPitch} base=${a.baseHeight} ${a.warnings}\n`);
    });
  }
  for (const t of files) {
    for (const d of files) {
      if (t === d) continue;
      it(`${t} <- base of ${d}`, () => {
        const tt = load(t), dd = load(d);
        if (layoutPitch(tt.analysis, dd.analysis.footPitch) !== dd.analysis.footPitch) return;
        const r = swapBase(
          wasm,
          { ...tt, cut: tt.analysis.baseHeight },
          { ...dd, cut: dd.analysis.baseHeight },
        );
        process.stdout.write(`${t} <- ${d}: pieces=${r.pieces} voids=${r.voids} genus=${r.solid.genus()} vol=${r.solid.volume().toFixed(0)} ${r.warnings}\n`);
        expect(r.pieces).toBe(1);
      });
    }
  }
});
