import type { BasePresetId, BinAnalysis } from "../geometry/gridfinity";

export type Slot = "target" | "donor";

/** Non-indexed, flat-shaded triangles ready for three.js. */
export interface DisplayMesh {
  positions: Float32Array;
  normals: Float32Array;
  triangles: number;
}

export interface LoadedModel {
  mesh: DisplayMesh;
  analysis: BinAnalysis;
}

export interface SwapOutput {
  mesh: DisplayMesh;
  bodyTriangles: number;
  pieces: number;
  voids: number;
  warnings: string[];
}

/** Base source for a swap: a built-in foot, or the loaded donor file cut at `cut` mm. */
export type DonorChoice = { preset: BasePresetId } | { cut: number };

export type Request =
  | { type: "load"; slot: Slot; name: string; bytes: ArrayBuffer }
  | { type: "sample" }
  | { type: "preset"; preset: BasePresetId }
  | { type: "clear"; slot: Slot }
  | { type: "swap"; targetCut: number; donor: DonorChoice }
  | { type: "export"; format: "stl" | "3mf"; name: string };

export type Response<R extends Request> = R extends { type: "load" | "preset" | "sample" }
  ? LoadedModel
  : R extends { type: "swap" }
    ? SwapOutput
    : R extends { type: "export" }
      ? Uint8Array
      : void;

export type WorkerMessage =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: string };
