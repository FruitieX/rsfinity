use bytemuck::{Pod, Zeroable};
use glam::Vec3;
use wasm_bindgen::prelude::*;

#[derive(Clone, Copy, Debug, Pod, Zeroable)]
#[repr(C)]
pub struct Vertex {
    pub position: [f32; 3],
    pub normal: [f32; 3],
}

impl Vertex {
    pub fn new(position: Vec3, normal: Vec3) -> Self {
        Self {
            position: position.to_array(),
            normal: normal.to_array(),
        }
    }

    pub fn pos(&self) -> Vec3 {
        Vec3::from_array(self.position)
    }

    pub fn norm(&self) -> Vec3 {
        Vec3::from_array(self.normal)
    }
}

#[derive(Clone, Debug)]
pub struct Triangle {
    pub vertices: [Vertex; 3],
}

impl Triangle {
    pub fn new(v0: Vertex, v1: Vertex, v2: Vertex) -> Self {
        Self {
            vertices: [v0, v1, v2],
        }
    }

    pub fn compute_normal(&self) -> Vec3 {
        let v0 = self.vertices[0].pos();
        let v1 = self.vertices[1].pos();
        let v2 = self.vertices[2].pos();
        (v1 - v0).cross(v2 - v0).normalize()
    }

    pub fn with_normal(mut self, normal: Vec3) -> Self {
        for v in &mut self.vertices {
            v.normal = normal.to_array();
        }
        self
    }
}

#[derive(Clone, Debug, Default)]
pub struct Mesh {
    pub triangles: Vec<Triangle>,
}

impl Mesh {
    pub fn new() -> Self {
        Self {
            triangles: Vec::new(),
        }
    }

    pub fn from_triangles(triangles: Vec<Triangle>) -> Self {
        Self { triangles }
    }

    pub fn bounds(&self) -> (Vec3, Vec3) {
        if self.triangles.is_empty() {
            return (Vec3::ZERO, Vec3::ZERO);
        }

        let mut min = Vec3::splat(f32::INFINITY);
        let mut max = Vec3::splat(f32::NEG_INFINITY);

        for tri in &self.triangles {
            for v in &tri.vertices {
                let pos = v.pos();
                min = min.min(pos);
                max = max.max(pos);
            }
        }

        (min, max)
    }

    pub fn center(&self) -> Vec3 {
        let (min, max) = self.bounds();
        (min + max) / 2.0
    }

    pub fn translate(&mut self, offset: Vec3) {
        for tri in &mut self.triangles {
            for v in &mut tri.vertices {
                let pos = Vec3::from_array(v.position) + offset;
                v.position = pos.to_array();
            }
        }
    }

    pub fn translated(&self, offset: Vec3) -> Self {
        let mut mesh = self.clone();
        mesh.translate(offset);
        mesh
    }

    /// Convert to flat arrays for JS interop
    pub fn to_mesh_data(&self) -> MeshData {
        let vertex_count = self.triangles.len() * 3;
        let mut positions = Vec::with_capacity(vertex_count * 3);
        let mut normals = Vec::with_capacity(vertex_count * 3);
        let mut indices = Vec::with_capacity(vertex_count);

        for (tri_idx, tri) in self.triangles.iter().enumerate() {
            for (v_idx, v) in tri.vertices.iter().enumerate() {
                positions.extend_from_slice(&v.position);
                normals.extend_from_slice(&v.normal);
                indices.push((tri_idx * 3 + v_idx) as u32);
            }
        }

        MeshData {
            positions,
            normals,
            indices,
        }
    }

    /// Reconstruct mesh from MeshData
    pub fn from_mesh_data(data: &MeshData) -> Self {
        let mut triangles = Vec::new();
        let tri_count = data.indices.len() / 3;

        for i in 0..tri_count {
            let idx0 = data.indices[i * 3] as usize;
            let idx1 = data.indices[i * 3 + 1] as usize;
            let idx2 = data.indices[i * 3 + 2] as usize;

            let v0 = Vertex {
                position: [
                    data.positions[idx0 * 3],
                    data.positions[idx0 * 3 + 1],
                    data.positions[idx0 * 3 + 2],
                ],
                normal: [
                    data.normals[idx0 * 3],
                    data.normals[idx0 * 3 + 1],
                    data.normals[idx0 * 3 + 2],
                ],
            };
            let v1 = Vertex {
                position: [
                    data.positions[idx1 * 3],
                    data.positions[idx1 * 3 + 1],
                    data.positions[idx1 * 3 + 2],
                ],
                normal: [
                    data.normals[idx1 * 3],
                    data.normals[idx1 * 3 + 1],
                    data.normals[idx1 * 3 + 2],
                ],
            };
            let v2 = Vertex {
                position: [
                    data.positions[idx2 * 3],
                    data.positions[idx2 * 3 + 1],
                    data.positions[idx2 * 3 + 2],
                ],
                normal: [
                    data.normals[idx2 * 3],
                    data.normals[idx2 * 3 + 1],
                    data.normals[idx2 * 3 + 2],
                ],
            };

            triangles.push(Triangle::new(v0, v1, v2));
        }

        Self { triangles }
    }

    /// Export as binary STL format
    pub fn to_binary_stl(&self) -> Vec<u8> {
        let mut data = Vec::new();

        // 80-byte header
        data.extend_from_slice(&[0u8; 80]);

        // Number of triangles (u32 little-endian)
        let tri_count = self.triangles.len() as u32;
        data.extend_from_slice(&tri_count.to_le_bytes());

        // Each triangle: normal (3xf32) + 3 vertices (3x3xf32) + attribute (u16)
        for tri in &self.triangles {
            let normal = tri.compute_normal();

            // Normal vector
            data.extend_from_slice(&normal.x.to_le_bytes());
            data.extend_from_slice(&normal.y.to_le_bytes());
            data.extend_from_slice(&normal.z.to_le_bytes());

            // Vertices
            for v in &tri.vertices {
                data.extend_from_slice(&v.position[0].to_le_bytes());
                data.extend_from_slice(&v.position[1].to_le_bytes());
                data.extend_from_slice(&v.position[2].to_le_bytes());
            }

            // Attribute byte count (usually 0)
            data.extend_from_slice(&0u16.to_le_bytes());
        }

        data
    }
}

/// Mesh data for JS interop - flat arrays that can be directly used with Three.js
#[wasm_bindgen]
pub struct MeshData {
    positions: Vec<f32>,
    normals: Vec<f32>,
    indices: Vec<u32>,
}

#[wasm_bindgen]
impl MeshData {
    #[wasm_bindgen(getter)]
    pub fn positions(&self) -> Vec<f32> {
        self.positions.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn normals(&self) -> Vec<f32> {
        self.normals.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn indices(&self) -> Vec<u32> {
        self.indices.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn vertex_count(&self) -> usize {
        self.positions.len() / 3
    }

    #[wasm_bindgen(getter)]
    pub fn triangle_count(&self) -> usize {
        self.indices.len() / 3
    }
}

impl MeshData {
    pub fn new(positions: Vec<f32>, normals: Vec<f32>, indices: Vec<u32>) -> Self {
        Self {
            positions,
            normals,
            indices,
        }
    }
}
