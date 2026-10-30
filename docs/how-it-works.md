# How rsfinity swaps a base

All geometry runs in a web worker using [manifold-3d](https://github.com/elalish/manifold),
which does robust mesh booleans compiled to WASM.

## Parsing

STL (binary and ASCII) and 3MF files are welded into manifold solids in
`src/geometry/parse.ts`. That includes Bambu, Orca and Prusa project files,
whose objects are stored as components in `3D/Objects/*.model`.

## Analysing a bin

`analyzeBin` in `src/geometry/gridfinity.ts` works out:

- the grid size, from the footprint of the lowest 4 mm, in 0.5-unit steps;
- whether the feet are half-grid (21 mm), by counting feet near the bottom;
- the base height, which is the lowest Z where the cross-section reaches the
  full body width (the feet are chamfered narrower below it). It is snapped to
  the vertex layer where that happens, normally 4.75 mm.

## Swapping

`swapBase` in `src/geometry/swap.ts` trims the bin above its cut plane, trims
the donor below its own cut plane and splits the donor into grid cells. Each
bin cell gets the matching donor cell, aligned so the two cut planes meet.
Corner and edge cells map to corner and edge cells, so edge-only features
such as corner magnets survive.

Everything is then unioned into one solid. Zero-volume slivers from the
coplanar seam and tiny loose fragments are dropped.

A donor can be any size; a 1×1 bin is enough. A bin with half-unit dimensions
needs half-grid feet: either a half-grid donor or a built-in base, which is
then generated at 21 mm.
