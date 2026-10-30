# rsfinity

Swap the base of any Gridfinity bin. Drop in a bin (STL or 3MF), then pick a
built-in base (plain, magnet holes, magnets + screws) or take the base from
another bin, and download one clean, watertight model. Everything runs in the
browser; files never leave the device.

## How it works

All geometry runs in a web worker using [manifold-3d](https://github.com/elalish/manifold)
(robust mesh booleans compiled to WASM).

1. **Parse.** STL (binary/ASCII) and 3MF (including Bambu/Orca/Prusa projects
   whose objects are components in `3D/Objects/*.model`) are welded into
   manifold solids (`src/geometry/parse.ts`).
2. **Analyse** (`analyzeBin` in `src/geometry/gridfinity.ts`):
   - The grid size comes from the footprint of the lowest 4 mm, in 0.5-unit steps.
   - Half-grid (21 mm) feet are recognised by counting feet near the bottom.
   - The base height is the lowest Z where the cross-section reaches the full
     body width (feet are chamfered narrower below it). It is snapped to the
     vertex layer where that happens, normally 4.75 mm.
3. **Swap** (`swapBase` in `src/geometry/swap.ts`):
   - The bin is trimmed above its cut plane.
   - The donor is trimmed below its own cut plane and split into grid cells.
   - Each bin cell gets the matching donor cell, aligned so the two cut planes
     meet. Corner and edge cells map to corner and edge cells, so edge-only
     features such as corner magnets survive.
   - Everything is unioned into one solid. Zero-volume slivers from the
     coplanar seam and tiny loose fragments are dropped.

A donor can be any size (a 1×1 bin is enough). A bin with half-unit
dimensions needs half-grid feet: a half-grid donor, or a built-in base, which
is then generated at 21 mm.

## Development

```bash
nix develop        # node 26 (+ openscad for test models)
npm install
npm run dev        # http://localhost:5173
npm test           # geometry tests against generated bins
npm run test:e2e   # browser smoke test against dist/ (after npm run build)
npm run build      # static site in dist/ (relative paths, host anywhere)
```

### Testing against real models

`src/geometry/__tests__/real-models.test.ts` swaps every pair of models in a
directory when `RSFINITY_MODELS` is set. Real bins can be generated with
[gridfinity-rebuilt-openscad](https://github.com/kennetek/gridfinity-rebuilt-openscad), for example:

```bash
openscad --backend=manifold -o bin-3x2.stl -D gridx=3 -D gridy=2 gridfinity-rebuilt-bins.scad
RSFINITY_MODELS=/path/to/models npm test
```

## Deployment

Served at https://rsfinity.fruitiex.org from `~/homelab/apps/rsfinity`. Every
push to `main` that passes CI publishes `ghcr.io/fruitiex/rsfinity` and
dispatches `image-update` to `FruitieX/homelab`, which pins the new digest.
