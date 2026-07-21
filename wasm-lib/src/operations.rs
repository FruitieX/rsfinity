use glam::Vec3;

use crate::mesh::{Mesh, Triangle, Vertex};

/// Standard gridfinity unit size in mm (42mm including tolerances)
const GRID_UNIT_SIZE: f32 = 42.0;

/// Standard gridfinity base height (approximate, varies by system)
const DEFAULT_BASE_HEIGHT: f32 = 5.0;

/// Detect the optimal cut height for separating mount from bin
///
/// Heuristic: Look for a horizontal "waist" in the model near the expected base height.
/// Gridfinity bases are typically 5-7mm tall.
pub fn detect_cut_height(mesh: &Mesh) -> f32 {
    let (min, max) = mesh.bounds();
    let total_height = max.z - min.z;

    // If model is very short, just cut at 1/4 height
    if total_height < 10.0 {
        return min.z + total_height * 0.25;
    }

    // Create a histogram of Z values to find transitions
    let bucket_count = 100;
    let bucket_size = total_height / bucket_count as f32;
    let mut histogram = vec![0usize; bucket_count];

    for tri in &mesh.triangles {
        for v in &tri.vertices {
            let bucket = ((v.position[2] - min.z) / bucket_size).min(bucket_count as f32 - 1.0) as usize;
            histogram[bucket] += 1;
        }
    }

    // Look for a local minimum (waist) in the expected base region (4-8mm from bottom)
    let search_start = ((4.0 / total_height) * bucket_count as f32) as usize;
    let search_end = ((8.0 / total_height) * bucket_count as f32).min(bucket_count as f32 - 1.0) as usize;

    let mut min_density = usize::MAX;
    let mut best_bucket = search_start;

    for i in search_start.max(1)..=search_end.min(bucket_count - 1) {
        // Use a smoothed density (average of neighbors)
        let density = histogram[i - 1] + histogram[i] + histogram.get(i + 1).unwrap_or(&0);
        if density < min_density {
            min_density = density;
            best_bucket = i;
        }
    }

    // If we didn't find a clear waist, use default base height
    if min_density > histogram.iter().sum::<usize>() / bucket_count {
        return min.z + DEFAULT_BASE_HEIGHT;
    }

    min.z + (best_bucket as f32 + 0.5) * bucket_size
}

/// Detect grid dimensions (X x Y units) based on model bounding box
///
/// Uses standard gridfinity 42mm grid unit size
pub fn detect_grid_dimensions(mesh: &Mesh) -> (u32, u32) {
    let (min, max) = mesh.bounds();
    let width = max.x - min.x;
    let depth = max.y - min.y;

    // Round to nearest grid unit, minimum 1
    let grid_x = ((width / GRID_UNIT_SIZE).round() as u32).max(1);
    let grid_y = ((depth / GRID_UNIT_SIZE).round() as u32).max(1);

    (grid_x, grid_y)
}

/// Cut mesh at a horizontal plane (Z = cut_z)
///
/// Returns (above, below) - the bin portion (above) and mount portion (below)
pub fn cut_mesh_at_plane(mesh: &Mesh, cut_z: f32) -> (Mesh, Mesh) {
    let mut above_triangles = Vec::new();
    let mut below_triangles = Vec::new();

    for tri in &mesh.triangles {
        let positions: [Vec3; 3] = [
            tri.vertices[0].pos(),
            tri.vertices[1].pos(),
            tri.vertices[2].pos(),
        ];

        let sides: [i8; 3] = positions.map(|p| {
            if p.z > cut_z + 0.001 {
                1
            } else if p.z < cut_z - 0.001 {
                -1
            } else {
                0
            }
        });

        let above_count = sides.iter().filter(|&&s| s > 0).count();
        let below_count = sides.iter().filter(|&&s| s < 0).count();

        match (above_count, below_count) {
            // All vertices above or on plane
            (3, 0) | (2, 0) | (1, 0) | (0, 0) => {
                above_triangles.push(tri.clone());
            }
            // All vertices below plane
            (0, 3) | (0, 2) | (0, 1) => {
                below_triangles.push(tri.clone());
            }
            // Triangle crosses the plane - need to split
            _ => {
                let (above_tris, below_tris) = split_triangle_at_plane(tri, cut_z);
                above_triangles.extend(above_tris);
                below_triangles.extend(below_tris);
            }
        }
    }

    // Generate cap faces to close the cut surfaces
    let above_cap = generate_cap_triangles(&above_triangles, cut_z, false);
    let below_cap = generate_cap_triangles(&below_triangles, cut_z, true);

    above_triangles.extend(above_cap);
    below_triangles.extend(below_cap);

    (
        Mesh::from_triangles(above_triangles),
        Mesh::from_triangles(below_triangles),
    )
}

/// Split a triangle that crosses the cutting plane into sub-triangles
fn split_triangle_at_plane(tri: &Triangle, cut_z: f32) -> (Vec<Triangle>, Vec<Triangle>) {
    let positions: [Vec3; 3] = [
        tri.vertices[0].pos(),
        tri.vertices[1].pos(),
        tri.vertices[2].pos(),
    ];
    let normals: [Vec3; 3] = [
        tri.vertices[0].norm(),
        tri.vertices[1].norm(),
        tri.vertices[2].norm(),
    ];

    let mut above = Vec::new();
    let mut below = Vec::new();

    // Classify vertices with a small epsilon
    const EPS: f32 = 0.0001;
    let mut above_verts: Vec<usize> = Vec::new();
    let mut below_verts: Vec<usize> = Vec::new();
    let mut on_plane: Vec<usize> = Vec::new();

    for i in 0..3 {
        if positions[i].z > cut_z + EPS {
            above_verts.push(i);
        } else if positions[i].z < cut_z - EPS {
            below_verts.push(i);
        } else {
            on_plane.push(i);
        }
    }

    // Helper to interpolate a vertex along an edge to the cut plane
    let interpolate_edge = |from: usize, to: usize| -> Vertex {
        let dz = positions[to].z - positions[from].z;
        if dz.abs() < EPS {
            // Edge is horizontal at cut plane
            Vertex::new(positions[from], normals[from])
        } else {
            let t = (cut_z - positions[from].z) / dz;
            let pos = positions[from].lerp(positions[to], t);
            let norm = normals[from].lerp(normals[to], t).normalize_or_zero();
            Vertex::new(pos, norm)
        }
    };

    match (above_verts.len(), below_verts.len(), on_plane.len()) {
        // All above or all below - shouldn't reach here but handle anyway
        (3, 0, 0) => above.push(tri.clone()),
        (0, 3, 0) => below.push(tri.clone()),
        
        // All on plane - add to above by convention
        (0, 0, 3) => above.push(tri.clone()),
        
        // One vertex above, two below
        (1, 2, 0) => {
            let a = above_verts[0];
            let b1 = below_verts[0];
            let b2 = below_verts[1];

            let i1 = interpolate_edge(a, b1);
            let i2 = interpolate_edge(a, b2);

            // Above: single triangle (a, i1, i2) - maintain winding
            above.push(Triangle::new(tri.vertices[a], i1.clone(), i2.clone()));

            // Below: quad split into two triangles
            // Need to maintain proper winding order
            below.push(Triangle::new(i1.clone(), tri.vertices[b1].clone(), tri.vertices[b2].clone()));
            below.push(Triangle::new(i1.clone(), tri.vertices[b2].clone(), i2));
        }
        
        // Two vertices above, one below
        (2, 1, 0) => {
            let a1 = above_verts[0];
            let a2 = above_verts[1];
            let b = below_verts[0];

            let i1 = interpolate_edge(a1, b);
            let i2 = interpolate_edge(a2, b);

            // Above: quad split into two triangles
            above.push(Triangle::new(tri.vertices[a1].clone(), tri.vertices[a2].clone(), i2.clone()));
            above.push(Triangle::new(tri.vertices[a1].clone(), i2.clone(), i1.clone()));

            // Below: single triangle
            below.push(Triangle::new(i1, i2, tri.vertices[b].clone()));
        }
        
        // One above, one below, one on plane
        (1, 1, 1) => {
            let a = above_verts[0];
            let b = below_verts[0];
            let o = on_plane[0];

            let i = interpolate_edge(a, b);

            above.push(Triangle::new(tri.vertices[a].clone(), i.clone(), tri.vertices[o].clone()));
            below.push(Triangle::new(i, tri.vertices[b].clone(), tri.vertices[o].clone()));
        }
        
        // Two on plane, one above
        (1, 0, 2) => {
            above.push(tri.clone());
        }
        
        // Two on plane, one below
        (0, 1, 2) => {
            below.push(tri.clone());
        }
        
        // One on plane, two above
        (2, 0, 1) => {
            above.push(tri.clone());
        }
        
        // One on plane, two below
        (0, 2, 1) => {
            below.push(tri.clone());
        }
        
        // Shouldn't happen, but handle gracefully
        _ => {
            // If more vertices are above, add to above; otherwise below
            if above_verts.len() >= below_verts.len() {
                above.push(tri.clone());
            } else {
                below.push(tri.clone());
            }
        }
    }

    (above, below)
}

/// Generate cap triangles to close a cut mesh
/// This is a simplified approach that may not produce perfect caps for complex shapes
fn generate_cap_triangles(triangles: &[Triangle], cut_z: f32, normal_down: bool) -> Vec<Triangle> {
    // Collect edges that lie on the cut plane
    let mut boundary_edges: Vec<(Vec3, Vec3)> = Vec::new();

    for tri in triangles {
        let positions: [Vec3; 3] = [
            tri.vertices[0].pos(),
            tri.vertices[1].pos(),
            tri.vertices[2].pos(),
        ];

        for i in 0..3 {
            let j = (i + 1) % 3;
            let on_plane_i = (positions[i].z - cut_z).abs() < 0.01;
            let on_plane_j = (positions[j].z - cut_z).abs() < 0.01;

            if on_plane_i && on_plane_j {
                boundary_edges.push((positions[i], positions[j]));
            }
        }
    }

    // For now, skip cap generation - this would require proper polygon triangulation
    // The mesh will have a hole at the cut plane, but this is acceptable for preview
    // A proper implementation would trace the boundary loop and triangulate it
    let _ = (boundary_edges, normal_down);
    Vec::new()
}

/// Tile a 1x1 mount mesh to fill a grid_x by grid_y area, centered on the bin
///
/// The mount is assumed to be a single unit (approximately 42mm x 42mm)
/// and will be replicated across the grid, aligned so the top is at cut_z
/// The bin_bounds parameter is used to center the tiled mounts on the bin
pub fn tile_mesh(mount: &Mesh, grid_x: u32, grid_y: u32, cut_z: f32, bin_bounds: Option<(Vec3, Vec3)>) -> Mesh {
    let mut result = Mesh::new();

    let (mount_min, mount_max) = mount.bounds();
    let mount_top_z = mount_max.z;
    let mount_width = mount_max.x - mount_min.x;
    let mount_depth = mount_max.y - mount_min.y;

    // Calculate offset to align mount top with cut plane
    let z_offset = cut_z - mount_top_z;

    // Calculate total tiled size
    let total_width = grid_x as f32 * GRID_UNIT_SIZE;
    let total_depth = grid_y as f32 * GRID_UNIT_SIZE;

    // Calculate base offset to center on bin (or origin if no bin provided)
    let (base_x, base_y) = if let Some((bin_min, bin_max)) = bin_bounds {
        let bin_center_x = (bin_min.x + bin_max.x) / 2.0;
        let bin_center_y = (bin_min.y + bin_max.y) / 2.0;
        (bin_center_x - total_width / 2.0, bin_center_y - total_depth / 2.0)
    } else {
        (-total_width / 2.0, -total_depth / 2.0)
    };

    // Mount's own offset from its origin
    let mount_offset_x = -mount_min.x;
    let mount_offset_y = -mount_min.y;

    for gy in 0..grid_y {
        for gx in 0..grid_x {
            let offset = Vec3::new(
                base_x + gx as f32 * GRID_UNIT_SIZE + mount_offset_x,
                base_y + gy as f32 * GRID_UNIT_SIZE + mount_offset_y,
                z_offset,
            );

            for tri in &mount.triangles {
                let v0 = Vertex::new(
                    tri.vertices[0].pos() + offset,
                    tri.vertices[0].norm(),
                );
                let v1 = Vertex::new(
                    tri.vertices[1].pos() + offset,
                    tri.vertices[1].norm(),
                );
                let v2 = Vertex::new(
                    tri.vertices[2].pos() + offset,
                    tri.vertices[2].norm(),
                );
                result.triangles.push(Triangle::new(v0, v1, v2));
            }
        }
    }

    result
}

/// Merge two meshes into one
pub fn merge_meshes(a: &Mesh, b: &Mesh) -> Mesh {
    let mut triangles = a.triangles.clone();
    triangles.extend(b.triangles.iter().cloned());
    Mesh::from_triangles(triangles)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_grid_detection() {
        // Create a simple box mesh roughly 84mm x 42mm (2x1 grid)
        let mesh = create_test_box(84.0, 42.0, 50.0);
        let (gx, gy) = detect_grid_dimensions(&mesh);
        assert_eq!(gx, 2);
        assert_eq!(gy, 1);
    }

    fn create_test_box(width: f32, depth: f32, height: f32) -> Mesh {
        let mut triangles = Vec::new();
        let half_w = width / 2.0;
        let half_d = depth / 2.0;

        // Just create a simple representation
        let corners = [
            Vec3::new(-half_w, -half_d, 0.0),
            Vec3::new(half_w, -half_d, 0.0),
            Vec3::new(half_w, half_d, 0.0),
            Vec3::new(-half_w, half_d, 0.0),
            Vec3::new(-half_w, -half_d, height),
            Vec3::new(half_w, -half_d, height),
            Vec3::new(half_w, half_d, height),
            Vec3::new(-half_w, half_d, height),
        ];

        let faces: [[usize; 4]; 6] = [
            [0, 1, 2, 3], // bottom
            [4, 7, 6, 5], // top
            [0, 4, 5, 1], // front
            [2, 6, 7, 3], // back
            [0, 3, 7, 4], // left
            [1, 5, 6, 2], // right
        ];

        for face in &faces {
            let normal = Vec3::Y; // Simplified
            let v0 = Vertex::new(corners[face[0]], normal);
            let v1 = Vertex::new(corners[face[1]], normal);
            let v2 = Vertex::new(corners[face[2]], normal);
            let v3 = Vertex::new(corners[face[3]], normal);

            triangles.push(Triangle::new(v0, v1, v2));
            triangles.push(Triangle::new(v0, v2, v3));
        }

        Mesh::from_triangles(triangles)
    }
}
