import { strToU8, zipSync } from "fflate";
import type { TriMesh } from "./mesh";

export function toBinaryStl(mesh: TriMesh, header = "rsfinity"): Uint8Array {
  const { positions: p, indices: idx } = mesh;
  const count = idx.length / 3;
  const buf = new ArrayBuffer(84 + count * 50);
  const dv = new DataView(buf);
  const h = strToU8(header.slice(0, 80));
  new Uint8Array(buf).set(h, 0);
  dv.setUint32(80, count, true);
  for (let t = 0; t < count; t++) {
    const a = idx[t * 3] * 3, b = idx[t * 3 + 1] * 3, c = idx[t * 3 + 2] * 3;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    let o = 84 + t * 50;
    for (const v of [nx, ny, nz]) { dv.setFloat32(o, v, true); o += 4; }
    for (const i of [a, b, c]) {
      dv.setFloat32(o, p[i], true);
      dv.setFloat32(o + 4, p[i + 1], true);
      dv.setFloat32(o + 8, p[i + 2], true);
      o += 12;
    }
  }
  return new Uint8Array(buf);
}

export function to3mf(mesh: TriMesh, name = "rsfinity"): Uint8Array {
  const { positions: p, indices: idx } = mesh;
  const parts: string[] = [];
  parts.push(
    `<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">\n` +
      ` <metadata name="Application">rsfinity</metadata>\n <resources>\n  <object id="1" name="${escapeXml(name)}" type="model">\n   <mesh>\n    <vertices>\n`,
  );
  const fmt = (v: number) => String(Math.round(v * 1e5) / 1e5);
  for (let i = 0; i < p.length; i += 3) {
    parts.push(`     <vertex x="${fmt(p[i])}" y="${fmt(p[i + 1])}" z="${fmt(p[i + 2])}"/>\n`);
  }
  parts.push("    </vertices>\n    <triangles>\n");
  for (let i = 0; i < idx.length; i += 3) {
    parts.push(`     <triangle v1="${idx[i]}" v2="${idx[i + 1]}" v3="${idx[i + 2]}"/>\n`);
  }
  parts.push(`    </triangles>\n   </mesh>\n  </object>\n </resources>\n <build>\n  <item objectid="1"/>\n </build>\n</model>\n`);

  return zipSync({
    "[Content_Types].xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>\n`,
    ),
    "_rels/.rels": strToU8(
      `<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>\n`,
    ),
    "3D/3dmodel.model": strToU8(parts.join("")),
  });
}

function escapeXml(s: string) {
  return s.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
