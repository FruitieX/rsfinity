import { unzipSync, strFromU8 } from "fflate";
import {
  IDENTITY,
  multiply,
  transformMesh,
  weldSoup,
  type Mat4,
  type TriMesh,
} from "./mesh";

export class ParseError extends Error {}

/** Parse an STL or 3MF file into one mesh per printable object. */
export function parseModel(name: string, bytes: Uint8Array): TriMesh[] {
  const lower = name.toLowerCase();
  if (lower.endsWith(".3mf") || isZip(bytes)) return parse3mf(bytes);
  if (lower.endsWith(".stl") || !lower.includes(".")) return [parseStl(bytes)];
  throw new ParseError(`Unsupported file type: ${name}. Use .stl or .3mf.`);
}

function isZip(b: Uint8Array) {
  return b.length > 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;
}

// ---------------------------------------------------------------- STL

export function parseStl(bytes: Uint8Array): TriMesh {
  if (bytes.length >= 84) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const count = dv.getUint32(80, true);
    // Binary STLs may also start with "solid", so trust the size check first.
    if (84 + count * 50 === bytes.length) return parseBinaryStl(dv, count);
  }
  const head = strFromU8(bytes.subarray(0, Math.min(bytes.length, 512)));
  if (/^\s*solid/.test(head)) return parseAsciiStl(strFromU8(bytes));
  throw new ParseError("This doesn't look like a valid STL file.");
}

function parseBinaryStl(dv: DataView, count: number): TriMesh {
  const soup = new Float32Array(count * 9);
  for (let t = 0; t < count; t++) {
    const o = 84 + t * 50 + 12; // skip the facet normal
    for (let i = 0; i < 9; i++) soup[t * 9 + i] = dv.getFloat32(o + i * 4, true);
  }
  return weldSoup(soup);
}

function parseAsciiStl(text: string): TriMesh {
  const re = /vertex\s+(\S+)\s+(\S+)\s+(\S+)/g;
  const values: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) values.push(+m[1], +m[2], +m[3]);
  if (values.length === 0 || values.length % 9 !== 0) {
    throw new ParseError("Couldn't read triangles from this ASCII STL.");
  }
  return weldSoup(new Float32Array(values));
}

// ---------------------------------------------------------------- 3MF

interface Object3mf {
  mesh?: TriMesh;
  components: { path: string; id: string; transform: Mat4 }[];
}

/**
 * Minimal 3MF reader: core spec meshes plus production-extension components
 * that reference other model parts (as written by Bambu Studio / OrcaSlicer /
 * PrusaSlicer). Build items and component transforms are applied.
 */
export function parse3mf(bytes: Uint8Array): TriMesh[] {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, { filter: (f) => f.name.toLowerCase().endsWith(".model") });
  } catch {
    throw new ParseError("Couldn't unzip this 3MF file.");
  }
  const norm = (p: string) => p.replace(/^\/+/, "");
  const objects = new Map<string, Object3mf>(); // key: "path#id"
  const docs = new Map<string, string>();
  for (const [path, data] of Object.entries(files)) docs.set(norm(path), strFromU8(data));

  const rootPath =
    [...docs.keys()].find((p) => p.toLowerCase() === "3d/3dmodel.model") ?? [...docs.keys()][0];
  if (!rootPath) throw new ParseError("This 3MF file contains no 3D model.");

  for (const [path, xml] of docs) parseObjects(xml, path, objects);

  const resolve = (path: string, id: string, m: Mat4, depth: number, out: TriMesh[]) => {
    const obj = objects.get(`${path}#${id}`);
    if (!obj || depth > 16) return;
    if (obj.mesh) out.push(transformMesh(obj.mesh, m));
    for (const c of obj.components) {
      resolve(c.path ? norm(c.path) : path, c.id, multiply(m, c.transform), depth + 1, out);
    }
  };

  const result: TriMesh[] = [];
  const rootXml = docs.get(rootPath)!;
  const build = rootXml.match(/<(?:\w+:)?build\b[^>]*>([\s\S]*?)<\/(?:\w+:)?build>/);
  const items = build ? [...build[1].matchAll(/<(?:\w+:)?item\b([^>]*)\/?>/g)] : [];
  if (items.length > 0) {
    for (const item of items) {
      const a = attrs(item[1]);
      if (a.printable === "0") continue;
      const parts: TriMesh[] = [];
      resolve(a["p:path"] ? norm(a["p:path"]) : rootPath, a.objectid, parseTransform(a.transform), 0, parts);
      result.push(...parts);
    }
  } else {
    for (const [key, obj] of objects) if (obj.mesh && key.startsWith(rootPath)) result.push(obj.mesh);
  }
  const nonEmpty = result.filter((m) => m.indices.length > 0);
  if (nonEmpty.length === 0) throw new ParseError("This 3MF file contains no printable mesh.");
  return nonEmpty;
}

function parseObjects(xml: string, path: string, out: Map<string, Object3mf>) {
  const objRe = /<(?:\w+:)?object\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?object>/g;
  let m: RegExpExecArray | null;
  while ((m = objRe.exec(xml))) {
    const a = attrs(m[1]);
    const body = m[2];
    const obj: Object3mf = { components: [] };
    const meshMatch = body.match(/<(?:\w+:)?mesh\b[\s\S]*?<\/(?:\w+:)?mesh>/);
    if (meshMatch) obj.mesh = parseMeshXml(meshMatch[0]);
    for (const c of body.matchAll(/<(?:\w+:)?component\b([^>]*)\/?>/g)) {
      const ca = attrs(c[1]);
      obj.components.push({
        path: ca["p:path"] ?? "",
        id: ca.objectid,
        transform: parseTransform(ca.transform),
      });
    }
    out.set(`${path}#${a.id}`, obj);
  }
}

function parseMeshXml(xml: string): TriMesh {
  const verts: number[] = [];
  for (const v of xml.matchAll(/<(?:\w+:)?vertex\b([^>]*)\/?>/g)) {
    const a = attrs(v[1]);
    verts.push(+a.x, +a.y, +a.z);
  }
  const tris: number[] = [];
  for (const t of xml.matchAll(/<(?:\w+:)?triangle\b([^>]*)\/?>/g)) {
    const a = attrs(t[1]);
    tris.push(+a.v1, +a.v2, +a.v3);
  }
  return { positions: new Float32Array(verts), indices: new Uint32Array(tris) };
}

function attrs(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of s.matchAll(/([\w:-]+)\s*=\s*"([^"]*)"/g)) out[m[1]] = m[2];
  return out;
}

/** 3MF transforms are 12 numbers: a 3x3 (row-vector convention) followed by translation. */
function parseTransform(s: string | undefined): Mat4 {
  if (!s) return IDENTITY;
  const v = s.trim().split(/\s+/).map(Number);
  if (v.length !== 12 || v.some((x) => !Number.isFinite(x))) return IDENTITY;
  return [v[0], v[1], v[2], 0, v[3], v[4], v[5], 0, v[6], v[7], v[8], 0, v[9], v[10], v[11], 1];
}
