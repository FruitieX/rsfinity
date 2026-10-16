import { GeometryError, PITCH, fromManifold, type BinAnalysis } from "./gridfinity";
import type { Manifold, ManifoldToplevel } from "./manifold";
import type { TriMesh } from "./mesh";

export interface BinSource {
  solid: Manifold;
  analysis: Pick<BinAnalysis, "min" | "unitsX" | "unitsY" | "footPitch" | "center">;
  /** Cut height above the model's bottom, in mm. */
  cut: number;
}

export interface SwapResult {
  solid: Manifold;
  mesh: TriMesh;
  /** Number of leading triangles in `mesh` that came from the bin body; the rest are the new base. */
  bodyTriangles: number;
  /** Separate solid parts in the result (1 when everything is connected). */
  pieces: number;
  /** Enclosed cavities, e.g. old screw holes sealed by the new base. */
  voids: number;
  warnings: string[];
}

/** Cell pitch the swap needs: half-grid when either the bin's size or the donor's feet demand it. */
export function layoutPitch(
  target: Pick<BinAnalysis, "unitsX" | "unitsY">,
  donorFootPitch: 42 | 21,
): 42 | 21 {
  const whole = Number.isInteger(target.unitsX) && Number.isInteger(target.unitsY);
  return whole && donorFootPitch === PITCH ? PITCH : 21;
}

/**
 * Replace the base of `target` with the base of `donor`.
 *
 * The target is cut at its base height and only the body above is kept. The
 * donor is cut the same way and only the feet below are kept, split into grid
 * cells. Each target cell gets the matching donor cell (corners, edges and
 * interior cells map to their counterparts so edge-only features such as
 * corner magnets survive), aligned so the cut planes meet, and everything is
 * unioned into one solid.
 */
export function swapBase(wasm: ManifoldToplevel, target: BinSource, donor: BinSource): SwapResult {
  const { Manifold } = wasm;
  const warnings: string[] = [];
  const owned: Manifold[] = [];
  const own = <T extends Manifold>(m: T) => (owned.push(m), m);
  const ta = target.analysis, da = donor.analysis;

  const pitch = layoutPitch(ta, da.footPitch);
  if (pitch !== da.footPitch) {
    throw new GeometryError(
      `This bin is ${ta.unitsX} × ${ta.unitsY} units, so it needs half-grid (21 mm) feet, but the base source has ` +
        "full 42 mm feet. Use a half-grid bin or the built-in base instead.",
    );
  }

  try {
    const tCutZ = ta.min[2] + target.cut;
    const dCutZ = da.min[2] + donor.cut;

    const bodyRaw = own(target.solid.trimByPlane([0, 0, 1], tCutZ));
    if (bodyRaw.isEmpty()) throw new GeometryError("Nothing of the bin is left above the cut height.");
    const body = own(bodyRaw.asOriginal());

    const feet = own(donor.solid.trimByPlane([0, 0, -1], -dCutZ));
    if (feet.isEmpty()) throw new GeometryError("The base source has nothing below its cut height.");

    const dnx = Math.round((da.unitsX * PITCH) / pitch);
    const dny = Math.round((da.unitsY * PITCH) / pitch);
    const cells = new Map<string, Manifold>();
    const donorCell = (ci: number, cj: number) => {
      const key = `${ci},${cj}`;
      let cell = cells.get(key);
      if (!cell) {
        const cx = da.center[0] + (ci - (dnx - 1) / 2) * pitch;
        const cy = da.center[1] + (cj - (dny - 1) / 2) * pitch;
        const depth = dCutZ - da.min[2] + 2;
        const box = own(Manifold.cube([pitch, pitch, depth], true).translate([cx, cy, dCutZ - depth / 2]));
        // Normalise: cell centred on the origin with its cut plane at z = 0.
        cell = own(own(feet.intersect(box)).translate([-cx, -cy, -dCutZ]));
        cells.set(key, cell);
      }
      return cell;
    };

    const nx = Math.round((ta.unitsX * PITCH) / pitch);
    const ny = Math.round((ta.unitsY * PITCH) / pitch);
    const tiles: Manifold[] = [];
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < ny; j++) {
        const cell = donorCell(mapCell(i, nx, dnx), mapCell(j, ny, dny));
        if (cell.isEmpty()) continue;
        const x = ta.center[0] + (i - (nx - 1) / 2) * pitch;
        const y = ta.center[1] + (j - (ny - 1) / 2) * pitch;
        tiles.push(own(cell.translate([x, y, tCutZ])));
      }
    }
    if (tiles.length === 0) throw new GeometryError("The base source has no feet inside its grid cells.");
    const base = own(Manifold.union(tiles));
    const baseTagged = own(base.asOriginal());
    const bodyId = body.originalID();

    const merged = Manifold.union(body, baseTagged);
    const { solid, pieces, voids, dropped } = cleanUp(wasm, merged);
    if (dropped > 0) {
      warnings.push(
        `Removed ${dropped} small loose fragment${dropped > 1 ? "s" : ""} of the old base that no longer attached to anything.`,
      );
    }
    if (pieces > 1) {
      warnings.push(
        `The result has ${pieces} separate parts, so the new base doesn't fully connect to the bin. ` +
          "Check that both cut heights sit where the feet meet the body.",
      );
    }

    const mesh = solid.getMesh();
    let bodyTriangles = 0;
    // Runs are sorted by original ID and the body was tagged first, so its
    // triangles come first.
    for (let r = 0; r < mesh.runOriginalID.length; r++) {
      if (mesh.runOriginalID[r] === bodyId) bodyTriangles += (mesh.runIndex[r + 1] - mesh.runIndex[r]) / 3;
    }
    return { solid, mesh: fromManifold(solid), bodyTriangles, pieces, voids, warnings };
  } finally {
    owned.forEach((m) => m.delete());
  }
}

/**
 * Drop degenerate shells (zero-volume slivers left where coplanar faces meet)
 * and small loose fragments, keeping the main part, other substantial parts
 * and enclosed voids. Takes ownership of `m`.
 */
function cleanUp(wasm: ManifoldToplevel, m: Manifold) {
  const shells = m.decompose();
  const largest = Math.max(...shells.map((s) => s.volume()));
  const keep: Manifold[] = [];
  let pieces = 0, voids = 0, dropped = 0;
  for (const s of shells) {
    const v = s.volume();
    if (Math.abs(v) < 1e-3) continue; // sliver
    if (v > 0 && v < largest * 0.02) {
      dropped++;
      continue;
    }
    if (v > 0) pieces++;
    else voids++;
    keep.push(s);
  }
  let solid = m;
  if (keep.length !== shells.length) {
    solid = wasm.Manifold.compose(keep);
    m.delete();
  }
  shells.forEach((s) => s.delete());
  return { solid, pieces, voids, dropped };
}

/**
 * Map a target cell index to a donor cell index, keeping first/last cells on
 * the edges and spreading the interior over the donor's interior cells.
 */
export function mapCell(i: number, n: number, dn: number): number {
  if (dn <= 1) return 0;
  if (i === 0) return 0;
  if (i === n - 1) return dn - 1;
  if (dn === 2) return 0;
  return Math.min(Math.max(i, 1), dn - 2);
}
