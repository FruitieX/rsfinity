# Gridfinity Mount Swapper

A fully offline web application for swapping the base mount on gridfinity-compatible 3D models. Upload STL or 3MF files, adjust the cut plane, select a replacement mount system, and download the remounted model.

## Features

- **100% Client-Side**: All processing happens in your browser using WebAssembly. Your files never leave your device.
- **Multiple Mount Systems**: Support for Gridfinity Original, Gridfinity Refined, Gridfinity Lite, and Clickfinity bases.
- **Auto-Detection**: Automatically detects grid dimensions (e.g., 2x3 bins) and suggests optimal cut height.
- **Mount Tiling**: Automatically tiles the replacement mount to match the detected bin size.
- **3D Preview**: Real-time visualization with adjustable cut plane using Three.js.
- **Static Deployment**: Can be hosted on any static file server (GitHub Pages, Netlify, Vercel, etc.).

## Tech Stack

- **Frontend**: Next.js 16, React, TypeScript, Tailwind CSS, shadcn/ui
- **3D Rendering**: React Three Fiber, Three.js
- **Geometry Processing**: Rust compiled to WebAssembly
  - STL parsing (binary and ASCII)
  - 3MF parsing (ZIP + XML)
  - Mesh cutting at horizontal plane
  - Mesh merging and tiling

## Development

### Prerequisites

- Node.js 20+
- Rust toolchain with `wasm-pack`
- `wasm32-unknown-unknown` target: `rustup target add wasm32-unknown-unknown`

### Setup

```bash
# Install dependencies
npm install

# Build WASM module
npm run build:wasm

# Generate mount presets
npm run build:mounts

# Start development server
npm run dev
```

### Build for Production

```bash
npm run build
```

Output will be in the `out/` directory, ready for static hosting.

## Project Structure

```
/rsfinity
├── /src
│   ├── /app                 # Next.js app router pages
│   ├── /components
│   │   ├── /ui             # shadcn/ui components
│   │   ├── /viewer         # 3D mesh viewer
│   │   ├── /upload         # File upload components
│   │   └── /workflow       # Mount selector, cut plane controls
│   └── /lib
│       ├── wasm-api.ts     # TypeScript wrapper for WASM
│       ├── mount-presets.ts # Mount preset definitions
│       └── /wasm           # Compiled WASM module (generated)
├── /wasm-lib               # Rust WASM crate
│   └── /src
│       ├── lib.rs          # WASM entry points
│       ├── mesh.rs         # Mesh data structures
│       ├── operations.rs   # Cut, merge, tile algorithms
│       └── /parsers        # STL and 3MF parsers
├── /public
│   └── /mounts             # Mount preset STL files (generated)
└── /scripts
    └── generate-mounts.ts  # Script to generate placeholder mount STLs
```

## How It Works

1. **Upload**: User uploads a gridfinity-compatible STL or 3MF file
2. **Parse**: WASM parses the mesh and extracts vertices/triangles
3. **Analyze**: Detects grid dimensions from bounding box (42mm grid units) and suggests cut height
4. **Configure**: User adjusts cut plane and selects replacement mount
5. **Process**: 
   - Cuts mesh at horizontal plane, keeping upper portion (the bin)
   - Tiles the selected mount to match detected grid dimensions
   - Merges bin and tiled mount into single mesh
6. **Export**: Downloads the result as binary STL

## Mount Presets

| Mount | Cut Height | Description |
|-------|-----------|-------------|
| Gridfinity Original | 5.0mm | Standard base with magnet holes |
| Gridfinity Refined | 4.75mm | Improved tolerances by Zack Freedman |
| Gridfinity Lite | 2.8mm | Minimal base, faster to print |
| Clickfinity | 5.2mm | Click-lock mechanism for tool-free removal |

## License

MIT
