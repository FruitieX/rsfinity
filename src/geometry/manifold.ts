import Module, { type ManifoldToplevel } from "manifold-3d";

let instance: Promise<ManifoldToplevel> | null = null;

/** Load the manifold WASM module once. `wasmUrl` is needed in the browser bundle. */
export function loadManifold(wasmUrl?: string): Promise<ManifoldToplevel> {
  instance ??= Module(wasmUrl ? { locateFile: () => wasmUrl } : undefined).then((m) => {
    m.setup();
    return m;
  });
  return instance;
}

export type { ManifoldToplevel };
export type Manifold = InstanceType<ManifoldToplevel["Manifold"]>;
export type CrossSection = InstanceType<ManifoldToplevel["CrossSection"]>;
