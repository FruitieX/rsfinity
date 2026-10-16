import type { CrossSection, Manifold, ManifoldToplevel } from "./manifold";
import type { TriMesh } from "./mesh";

/** Gridfinity grid pitch (mm). */
export const PITCH = 42;
/** Height of the standard base profile: 0.8 + 1.8 + 2.15 mm. */
export const STANDARD_BASE_HEIGHT = 4.75;

export class GeometryError extends Error {}

/** Build a manifold solid from parsed meshes, unioning multiple objects. */
export function toManifold(wasm: ManifoldToplevel, meshes: TriMesh[]): Manifold {
  const solids: Manifold[] = [];
  for (const m of meshes) {
    const mesh = new wasm.Mesh({ numProp: 3, vertProperties: m.positions, triVerts: m.indices });
    mesh.merge();
    try {
      solids.push(new wasm.Manifold(mesh));
    } catch {
      solids.forEach((s) => s.delete());
      throw new GeometryError(
        "This model isn't a closed (watertight) solid, so it can't be cut cleanly. " +
          "Try repairing it first, e.g. with your slicer's \"Fix model\" option, and re-export.",
      );
    }
  }
  if (solids.length === 1) return solids[0];
  const all = wasm.Manifold.union(solids);
  solids.forEach((s) => s.delete());
  return all;
}

export function fromManifold(m: Manifold): TriMesh {
  const mesh = m.getMesh();
  const np = mesh.numProp;
  let positions = mesh.vertProperties;
  if (np !== 3) {
    positions = new Float32Array((mesh.vertProperties.length / np) * 3);
    for (let i = 0, j = 0; i < mesh.vertProperties.length; i += np, j += 3) {
      positions[j] = mesh.vertProperties[i];
      positions[j + 1] = mesh.vertProperties[i + 1];
      positions[j + 2] = mesh.vertProperties[i + 2];
    }
  }
  return { positions: new Float32Array(positions), indices: new Uint32Array(mesh.triVerts) };
}

// ---------------------------------------------------------------- analysis

export interface BinAnalysis {
  min: [number, number, number];
  max: [number, number, number];
  /** Footprint size in Gridfinity units (multiples of 0.5) along X and Y. */
  unitsX: number;
  unitsY: number;
  /** Spacing of the model's own feet: 42 mm, or 21 mm for half-grid bases. */
  footPitch: 42 | 21;
  /** XY centre of the grid footprint. */
  center: [number, number];
  /** Detected height of the base (feet) above the bottom of the model, in mm. */
  baseHeight: number;
  baseDetected: boolean;
  warnings: string[];
}

export function analyzeBin(m: Manifold): BinAnalysis {
  const bb = m.boundingBox();
  const min = bb.min as [number, number, number];
  const max = bb.max as [number, number, number];
  const z0 = min[2];
  const height = max[2] - z0;
  const warnings: string[] = [];

  // Footprint from the lowest few millimetres, so lips/tabs that stick out
  // above the base don't skew the grid size.
  const probe = Math.min(4, height * 0.5);
  const low = m.trimByPlane([0, 0, -1], -(z0 + probe));
  const lb = low.boundingBox();
  low.delete();
  const lowW = lb.max[0] - lb.min[0];
  const lowD = lb.max[1] - lb.min[1];
  const center: [number, number] = [(lb.min[0] + lb.max[0]) / 2, (lb.min[1] + lb.max[1]) / 2];
  // A standard foot is 41.5 mm at the top and narrower lower down.
  const rawX = (lowW + 2) / PITCH;
  const rawY = (lowD + 2) / PITCH;
  const unitsX = Math.max(0.5, Math.round(rawX * 2) / 2);
  const unitsY = Math.max(0.5, Math.round(rawY * 2) / 2);
  if (Math.abs(rawX - unitsX) > 0.12 || Math.abs(rawY - unitsY) > 0.12) {
    warnings.push(
      `The footprint (${lowW.toFixed(1)} × ${lowD.toFixed(1)} mm) doesn't line up with the 42 mm Gridfinity grid. ` +
        "Check the model's scale and orientation (base should face down).",
    );
  }

  // Count feet just above the bottom to tell full-grid from half-grid bases.
  const bottom = m.slice(z0 + Math.min(0.5, height * 0.1));
  const feetPieces = bottom.decompose();
  const feet = feetPieces.filter((p) => p.area() > 1).length;
  feetPieces.forEach((p) => p.delete());
  bottom.delete();
  const halfFeet = unitsX * 2 * unitsY * 2;
  const footPitch: 42 | 21 =
    !Number.isInteger(unitsX) || !Number.isInteger(unitsY) || (feet === halfFeet && feet !== unitsX * unitsY)
      ? 21
      : 42;

  const detected = detectBaseHeight(m, z0, height);
  if (detected === null) {
    warnings.push(
      `Couldn't find where the base ends, so the standard ${STANDARD_BASE_HEIGHT} mm is used. Adjust it if needed.`,
    );
  }
  return {
    min,
    max,
    unitsX,
    unitsY,
    footPitch,
    center,
    baseHeight: Math.min(detected ?? STANDARD_BASE_HEIGHT, height),
    baseDetected: detected !== null,
    warnings,
  };
}

/**
 * Find the lowest height at which the cross-section becomes the full bin
 * footprint: below it are the separate, chamfered feet; above it the body.
 */
function detectBaseHeight(m: Manifold, z0: number, height: number): number | null {
  const width = (z: number) => {
    const cs: CrossSection = m.slice(z);
    const b = cs.bounds();
    cs.delete();
    return [b.max[0] - b.min[0], b.max[1] - b.min[1]];
  };

  // Below the body the feet are narrower than the footprint (their top edge
  // is chamfered), so look for where the section reaches the body's width.
  const [refW, refD] = width(z0 + Math.min(height * 0.5, 10));
  const isBody = (h: number, tol = 0.12) => {
    const [w, d] = width(z0 + h);
    return w >= refW - tol && d >= refD - tol;
  };

  const maxH = Math.min(12, height * 0.6);
  let lo = 0.5;
  if (isBody(lo)) return null; // flat-bottomed, no feet
  let hi = -1;
  for (let h = 1; h <= maxH; h += 0.25) {
    if (isBody(h)) {
      hi = h;
      break;
    }
    lo = h;
  }
  if (hi < 0) return null;
  while (hi - lo > 0.005) {
    const mid = (lo + hi) / 2;
    if (isBody(mid)) hi = mid;
    else lo = mid;
  }
  // Snap onto the vertex layer where the outline actually reaches full width,
  // which is the exact plane where the feet meet the body (e.g. 4.75 mm).
  for (const z of vertexLayers(m, z0 + hi - 0.01, z0 + hi + 0.25)) {
    if (isBody(z - z0, 0.01)) return Math.round((z - z0) * 1000) / 1000;
  }
  return Math.round(hi * 100) / 100;
}

/** Distinct vertex heights within [from, to], ascending. */
function vertexLayers(m: Manifold, from: number, to: number): number[] {
  const mesh = m.getMesh();
  const p = mesh.vertProperties;
  const np = mesh.numProp;
  const layers = new Set<number>();
  for (let i = 2; i < p.length; i += np) {
    if (p[i] >= from && p[i] <= to) layers.add(p[i]);
  }
  return [...layers].sort((a, b) => a - b);
}

// ---------------------------------------------------------------- built-in bases

export type BasePresetId = "plain" | "magnets" | "magnets-screws";

export const BASE_PRESETS: { id: BasePresetId; name: string; description: string }[] = [
  { id: "plain", name: "Plain", description: "Standard profile, solid bottom" },
  { id: "magnets", name: "Magnet holes", description: "6.5 × 2.4 mm holes for 6×2 mm magnets" },
  { id: "magnets-screws", name: "Magnets + screws", description: "Magnet holes with 3 mm screw holes" },
];

/**
 * One Gridfinity foot, centred on the origin, from z = 0 to 4.75 mm. With
 * `pitch` 21 a half-grid foot is built; those are too small for magnet holes.
 */
export function buildPresetFoot(wasm: ManifoldToplevel, id: BasePresetId, pitch: 42 | 21 = 42): Manifold {
  const { Manifold } = wasm;
  // [inset from the 41.5 mm top outline, z]
  const profile: [number, number][] = [
    [2.95, 0],
    [2.15, 0.8],
    [2.15, 2.6],
    [0, STANDARD_BASE_HEIGHT],
  ];
  const ring = (inset: number, z: number): [number, number, number][] => {
    const half = (pitch - 0.5) / 2 - inset;
    const r = 3.75 - inset;
    const pts: [number, number, number][] = [];
    const seg = 12;
    for (const [cx, cy, a0] of [
      [half - r, half - r, 0],
      [-(half - r), half - r, 90],
      [-(half - r), -(half - r), 180],
      [half - r, -(half - r), 270],
    ]) {
      for (let i = 0; i <= seg; i++) {
        const a = ((a0 + (90 * i) / seg) * Math.PI) / 180;
        pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a), z]);
      }
    }
    return pts;
  };
  const segments: Manifold[] = [];
  for (let i = 0; i < profile.length - 1; i++) {
    segments.push(Manifold.hull([...ring(...profile[i]), ...ring(...profile[i + 1])]));
  }
  let foot = Manifold.union(segments);
  segments.forEach((s) => s.delete());

  if (id !== "plain" && pitch === PITCH) {
    const holes: Manifold[] = [];
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        holes.push(Manifold.cylinder(2.4, 3.25, 3.25, 40).translate([sx * 13, sy * 13, -0.01]));
        if (id === "magnets-screws") {
          holes.push(Manifold.cylinder(10, 1.5, 1.5, 24).translate([sx * 13, sy * 13, -0.01]));
        }
      }
    }
    const cut = Manifold.union(holes);
    const next = foot.subtract(cut);
    holes.forEach((h) => h.delete());
    cut.delete();
    foot.delete();
    foot = next;
  }
  return foot;
}
