import { PITCH, STANDARD_BASE_HEIGHT, buildPresetFoot, type BasePresetId } from "./gridfinity";
import type { Manifold, ManifoldToplevel } from "./manifold";

/** A simple open-top Gridfinity bin: feet + body with a 1.2 mm wall and 1 mm floor. Used as the demo model and in tests. */
export function makeBin(
  wasm: ManifoldToplevel,
  nx: number,
  ny: number,
  feet: BasePresetId,
  height = 3 * 7,
  offset: [number, number, number] = [0, 0, 0],
): Manifold {
  const { Manifold, CrossSection } = wasm;
  const foot = buildPresetFoot(wasm, feet);
  const parts: Manifold[] = [];
  for (let i = 0; i < nx; i++)
    for (let j = 0; j < ny; j++)
      parts.push(foot.translate([(i - (nx - 1) / 2) * PITCH, (j - (ny - 1) / 2) * PITCH, 0]));
  const outline = (w: number, d: number, r: number) =>
    CrossSection.square([w - 2 * r, d - 2 * r], true).offset(r, "Round", 2, 48);
  const W = nx * PITCH - 0.5, D = ny * PITCH - 0.5;
  const h = height - STANDARD_BASE_HEIGHT;
  const outer = outline(W, D, 3.75).extrude(h).translate([0, 0, STANDARD_BASE_HEIGHT]);
  const inner = outline(W - 2.4, D - 2.4, 2.55).extrude(h).translate([0, 0, STANDARD_BASE_HEIGHT + 1]);
  parts.push(outer.subtract(inner));
  return Manifold.union(parts).translate(offset);
}
