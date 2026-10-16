/** An indexed triangle mesh. Positions are flat xyz triples in millimetres. */
export interface TriMesh {
  positions: Float32Array;
  indices: Uint32Array;
}

export type Mat4 = number[]; // column-major, 16 entries

export const IDENTITY: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

export function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Array<number>(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      out[c * 4 + r] = s;
    }
  }
  return out;
}

export function transformMesh(mesh: TriMesh, m: Mat4): TriMesh {
  if (m.every((v, i) => v === IDENTITY[i])) return mesh;
  const p = mesh.positions;
  const out = new Float32Array(p.length);
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i], y = p[i + 1], z = p[i + 2];
    out[i] = m[0] * x + m[4] * y + m[8] * z + m[12];
    out[i + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
    out[i + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
  }
  // A mirroring transform flips winding; restore outward-facing triangles.
  const det =
    m[0] * (m[5] * m[10] - m[9] * m[6]) -
    m[4] * (m[1] * m[10] - m[9] * m[2]) +
    m[8] * (m[1] * m[6] - m[5] * m[2]);
  let indices = mesh.indices;
  if (det < 0) {
    indices = indices.slice();
    for (let i = 0; i < indices.length; i += 3) {
      const t = indices[i + 1];
      indices[i + 1] = indices[i + 2];
      indices[i + 2] = t;
    }
  }
  return { positions: out, indices };
}

export function concatMeshes(meshes: TriMesh[]): TriMesh {
  if (meshes.length === 1) return meshes[0];
  let nv = 0, ni = 0;
  for (const m of meshes) {
    nv += m.positions.length;
    ni += m.indices.length;
  }
  const positions = new Float32Array(nv);
  const indices = new Uint32Array(ni);
  let vo = 0, io = 0;
  for (const m of meshes) {
    positions.set(m.positions, vo);
    const base = vo / 3;
    for (let i = 0; i < m.indices.length; i++) indices[io + i] = m.indices[i] + base;
    vo += m.positions.length;
    io += m.indices.length;
  }
  return { positions, indices };
}

/**
 * Turn a triangle soup (three unshared vertices per triangle, as in STL) into an
 * indexed mesh by merging bit-identical vertex positions, and drop degenerate
 * triangles that reference the same vertex twice.
 */
export function weldSoup(soup: Float32Array): TriMesh {
  const triCount = soup.length / 9;
  const map = new Map<string, number>();
  const positions: number[] = [];
  const indices = new Uint32Array(triCount * 3);
  let n = 0;
  const key = (i: number) => `${soup[i]},${soup[i + 1]},${soup[i + 2]}`;
  for (let t = 0; t < triCount; t++) {
    const tri = [0, 0, 0];
    for (let v = 0; v < 3; v++) {
      const o = t * 9 + v * 3;
      const k = key(o);
      let idx = map.get(k);
      if (idx === undefined) {
        idx = positions.length / 3;
        positions.push(soup[o], soup[o + 1], soup[o + 2]);
        map.set(k, idx);
      }
      tri[v] = idx;
    }
    if (tri[0] === tri[1] || tri[1] === tri[2] || tri[0] === tri[2]) continue;
    indices[n++] = tri[0];
    indices[n++] = tri[1];
    indices[n++] = tri[2];
  }
  return { positions: new Float32Array(positions), indices: indices.slice(0, n) };
}

export function meshBounds(mesh: TriMesh) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const p = mesh.positions;
  for (let i = 0; i < p.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      if (p[i + a] < min[a]) min[a] = p[i + a];
      if (p[i + a] > max[a]) max[a] = p[i + a];
    }
  }
  return { min, max };
}
