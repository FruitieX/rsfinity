import type { AnalysisResult, MeshData } from "./wasm/rsfinity_wasm";

type WasmModule = typeof import("./wasm/rsfinity_wasm");

let wasmModule: WasmModule | null = null;
let initPromise: Promise<WasmModule> | null = null;

export async function initWasm(): Promise<WasmModule> {
  if (wasmModule) return wasmModule;

  if (!initPromise) {
    initPromise = (async () => {
      const wasm = await import("./wasm/rsfinity_wasm");
      await wasm.default();
      wasmModule = wasm;
      return wasm;
    })();
  }

  return initPromise;
}

export interface MeshAnalysis {
  suggestedCutHeight: number;
  gridX: number;
  gridY: number;
  minZ: number;
  maxZ: number;
  width: number;
  depth: number;
  height: number;
}

export interface ProcessedMesh {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  vertexCount: number;
  triangleCount: number;
}

export async function processFile(
  data: Uint8Array,
  filename: string
): Promise<ProcessedMesh> {
  const wasm = await initWasm();
  const meshData = wasm.process_file(data, filename) as MeshData;

  return {
    positions: new Float32Array(meshData.positions),
    normals: new Float32Array(meshData.normals),
    indices: new Uint32Array(meshData.indices),
    vertexCount: meshData.vertex_count,
    triangleCount: meshData.triangle_count,
  };
}

export async function analyzeMesh(
  data: Uint8Array,
  filename: string
): Promise<MeshAnalysis> {
  const wasm = await initWasm();
  const result = wasm.analyze_mesh(data, filename) as AnalysisResult;

  return {
    suggestedCutHeight: result.suggested_cut_height,
    gridX: result.grid_x,
    gridY: result.grid_y,
    minZ: result.min_z,
    maxZ: result.max_z,
    width: result.width,
    depth: result.depth,
    height: result.height,
  };
}

export async function cutAndGetBin(
  data: Uint8Array,
  filename: string,
  cutZ: number
): Promise<ProcessedMesh> {
  const wasm = await initWasm();
  const meshData = wasm.cut_and_get_bin(data, filename, cutZ) as MeshData;

  return {
    positions: new Float32Array(meshData.positions),
    normals: new Float32Array(meshData.normals),
    indices: new Uint32Array(meshData.indices),
    vertexCount: meshData.vertex_count,
    triangleCount: meshData.triangle_count,
  };
}

export async function swapMount(
  binData: Uint8Array,
  binFilename: string,
  mountData: Uint8Array,
  mountFilename: string,
  cutZ: number,
  gridX: number,
  gridY: number
): Promise<ProcessedMesh> {
  const wasm = await initWasm();
  const meshData = wasm.swap_mount(
    binData,
    binFilename,
    mountData,
    mountFilename,
    cutZ,
    gridX,
    gridY
  ) as MeshData;

  return {
    positions: new Float32Array(meshData.positions),
    normals: new Float32Array(meshData.normals),
    indices: new Uint32Array(meshData.indices),
    vertexCount: meshData.vertex_count,
    triangleCount: meshData.triangle_count,
  };
}

export async function exportStl(mesh: ProcessedMesh): Promise<Uint8Array> {
  const wasm = await initWasm();

  return new Uint8Array(
    wasm.export_stl_from_arrays(
      mesh.positions,
      mesh.normals,
      mesh.indices
    )
  );
}

export async function debug3mf(data: Uint8Array): Promise<string> {
  const wasm = await initWasm();
  return wasm.debug_3mf(data);
}

export async function generateMount(style: string): Promise<ProcessedMesh> {
  const wasm = await initWasm();
  const meshData = wasm.generate_mount(style) as MeshData;

  return {
    positions: new Float32Array(meshData.positions),
    normals: new Float32Array(meshData.normals),
    indices: new Uint32Array(meshData.indices),
    vertexCount: meshData.vertex_count,
    triangleCount: meshData.triangle_count,
  };
}

export async function swapMountGenerated(
  binData: Uint8Array,
  binFilename: string,
  mountStyle: string,
  cutZ: number,
  gridX: number,
  gridY: number
): Promise<ProcessedMesh> {
  const wasm = await initWasm();
  const meshData = wasm.swap_mount_generated(
    binData,
    binFilename,
    mountStyle,
    cutZ,
    gridX,
    gridY
  ) as MeshData;

  return {
    positions: new Float32Array(meshData.positions),
    normals: new Float32Array(meshData.normals),
    indices: new Uint32Array(meshData.indices),
    vertexCount: meshData.vertex_count,
    triangleCount: meshData.triangle_count,
  };
}

export async function swapMountFromTriangles(
  binData: Uint8Array,
  binFilename: string,
  mountTriangles: Float32Array,
  cutZ: number,
  gridX: number,
  gridY: number
): Promise<ProcessedMesh> {
  const wasm = await initWasm();
  const meshData = wasm.swap_mount_from_triangles(
    binData,
    binFilename,
    mountTriangles,
    cutZ,
    gridX,
    gridY
  ) as MeshData;

  return {
    positions: new Float32Array(meshData.positions),
    normals: new Float32Array(meshData.normals),
    indices: new Uint32Array(meshData.indices),
    vertexCount: meshData.vertex_count,
    triangleCount: meshData.triangle_count,
  };
}

export function parseStl(data: Uint8Array): Float32Array {
  if (!wasmModule) {
    throw new Error("WASM not initialized");
  }
  const meshData = wasmModule.process_file(data, "model.stl") as MeshData;
  return meshToTriangles(meshData);
}

export function parseThreeMf(data: Uint8Array): Float32Array {
  if (!wasmModule) {
    throw new Error("WASM not initialized");
  }
  const meshData = wasmModule.process_file(data, "model.3mf") as MeshData;
  return meshToTriangles(meshData);
}

function meshToTriangles(meshData: MeshData): Float32Array {
  const positions = new Float32Array(meshData.positions);
  const indices = new Uint32Array(meshData.indices);

  const triangles = new Float32Array(indices.length * 3);
  for (let i = 0; i < indices.length; i++) {
    const idx = indices[i] * 3;
    triangles[i * 3] = positions[idx];
    triangles[i * 3 + 1] = positions[idx + 1];
    triangles[i * 3 + 2] = positions[idx + 2];
  }
  return triangles;
}
