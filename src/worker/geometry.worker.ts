/// <reference lib="webworker" />
import wasmUrl from "manifold-3d/manifold.wasm?url";
import { to3mf, toBinaryStl } from "../geometry/export";
import {
  GeometryError,
  STANDARD_BASE_HEIGHT,
  analyzeBin,
  buildPresetFoot,
  fromManifold,
  toManifold,
  type BasePresetId,
  type BinAnalysis,
} from "../geometry/gridfinity";
import { loadManifold, type Manifold, type ManifoldToplevel } from "../geometry/manifold";
import type { TriMesh } from "../geometry/mesh";
import { ParseError, parseModel } from "../geometry/parse";
import { makeBin } from "../geometry/sample";
import { layoutPitch, swapBase, type SwapResult } from "../geometry/swap";
import type { DisplayMesh, LoadedModel, Request, Slot, SwapOutput } from "./protocol";

const models: Partial<Record<Slot, { solid: Manifold; analysis: BinAnalysis }>> = {};
const presets = new Map<string, { solid: Manifold; analysis: BinAnalysis }>();
let result: SwapResult | null = null;

function setModel(slot: Slot, model: { solid: Manifold; analysis: BinAnalysis } | undefined) {
  models[slot]?.solid.delete();
  models[slot] = model;
  clearResult();
}

function clearResult() {
  result?.solid.delete();
  result = null;
}

function presetModel(wasm: ManifoldToplevel, preset: BasePresetId, pitch: 42 | 21) {
  const key = `${preset}@${pitch}`;
  let model = presets.get(key);
  if (!model) {
    const solid = buildPresetFoot(wasm, preset, pitch);
    const bb = solid.boundingBox();
    model = {
      solid,
      analysis: {
        min: bb.min as [number, number, number],
        max: bb.max as [number, number, number],
        unitsX: pitch / 42,
        unitsY: pitch / 42,
        footPitch: pitch,
        center: [0, 0],
        baseHeight: STANDARD_BASE_HEIGHT,
        baseDetected: true,
        warnings: [],
      },
    };
    presets.set(key, model);
  }
  return model;
}

function toDisplay(mesh: TriMesh): DisplayMesh {
  const { positions: p, indices: idx } = mesh;
  const positions = new Float32Array(idx.length * 3);
  const normals = new Float32Array(idx.length * 3);
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    for (let k = 0; k < 3; k++) {
      const src = idx[t + k] * 3, dst = (t + k) * 3;
      positions[dst] = p[src];
      positions[dst + 1] = p[src + 1];
      positions[dst + 2] = p[src + 2];
      normals[dst] = nx;
      normals[dst + 1] = ny;
      normals[dst + 2] = nz;
    }
  }
  return { positions, normals, triangles: idx.length / 3 };
}

async function handle(req: Request): Promise<unknown> {
  const wasm = await loadManifold(wasmUrl);
  switch (req.type) {
    case "load": {
      const meshes = parseModel(req.name, new Uint8Array(req.bytes));
      const solid = toManifold(wasm, meshes);
      if (solid.isEmpty()) throw new GeometryError("This model has no volume.");
      const analysis = analyzeBin(solid);
      setModel(req.slot, { solid, analysis });
      return { mesh: toDisplay(fromManifold(solid)), analysis } satisfies LoadedModel;
    }
    case "sample": {
      const solid = makeBin(wasm, 2, 1, "magnets", 3 * 7);
      const analysis = analyzeBin(solid);
      setModel("target", { solid, analysis });
      return { mesh: toDisplay(fromManifold(solid)), analysis } satisfies LoadedModel;
    }
    case "preset": {
      const model = presetModel(wasm, req.preset, 42);
      return { mesh: toDisplay(fromManifold(model.solid)), analysis: model.analysis } satisfies LoadedModel;
    }
    case "clear":
      setModel(req.slot, undefined);
      return;
    case "swap": {
      const t = models.target;
      if (!t) throw new GeometryError("Load a bin first.");
      const warnings: string[] = [];
      let donor;
      if ("preset" in req.donor) {
        const pitch = layoutPitch(t.analysis, 42);
        donor = { ...presetModel(wasm, req.donor.preset, pitch), cut: STANDARD_BASE_HEIGHT };
        if (pitch === 21 && req.donor.preset !== "plain") {
          warnings.push("Half-grid feet are too small for magnet or screw holes, so they're plain.");
        }
      } else {
        if (!models.donor) throw new GeometryError("Load a base source first.");
        donor = { ...models.donor, cut: req.donor.cut };
      }
      clearResult();
      result = swapBase(wasm, { ...t, cut: req.targetCut }, donor);
      result.warnings.unshift(...warnings);
      return {
        mesh: toDisplay(result.mesh),
        bodyTriangles: result.bodyTriangles,
        pieces: result.pieces,
        voids: result.voids,
        warnings: result.warnings,
      } satisfies SwapOutput;
    }
    case "export": {
      if (!result) throw new GeometryError("Nothing to export yet.");
      return req.format === "3mf" ? to3mf(result.mesh, req.name) : toBinaryStl(result.mesh, req.name);
    }
  }
}

self.onmessage = async (e: MessageEvent<{ id: number; req: Request }>) => {
  const { id, req } = e.data;
  try {
    const value = await handle(req);
    const transfer: Transferable[] = [];
    if (value instanceof Uint8Array) transfer.push(value.buffer);
    else if (value && typeof value === "object" && "mesh" in value) {
      const m = (value as { mesh: DisplayMesh }).mesh;
      transfer.push(m.positions.buffer, m.normals.buffer);
    }
    self.postMessage({ id, ok: true, result: value }, transfer);
  } catch (err) {
    const known = err instanceof GeometryError || err instanceof ParseError;
    if (!known) console.error(err);
    const message = known
      ? err.message
      : `Something went wrong while processing the model: ${err instanceof Error ? err.message : String(err)}`;
    self.postMessage({ id, ok: false, error: message });
  }
};
