use glam::Vec3;

use crate::mesh::{Mesh, Triangle, Vertex};

/// Generate a gridfinity-compatible base mount for a single 1x1 unit
/// Based on the standard gridfinity stacking lip profile
pub fn generate_gridfinity_base(style: MountStyle) -> Mesh {
    match style {
        MountStyle::Original => generate_original_base(),
        MountStyle::Refined => generate_refined_base(),
        MountStyle::Lite => generate_lite_base(),
        MountStyle::Clickfinity => generate_clickfinity_base(),
    }
}

#[derive(Debug, Clone, Copy)]
pub enum MountStyle {
    Original,
    Refined,
    Lite,
    Clickfinity,
}

/// Standard gridfinity dimensions (mm)
const UNIT_SIZE: f32 = 42.0;
const TOLERANCE: f32 = 0.5;
const OUTER_SIZE: f32 = UNIT_SIZE - TOLERANCE; // 41.5mm
const CORNER_RADIUS: f32 = 3.75;

/// Original gridfinity stacking lip profile by Zack Freedman
/// Profile is defined as (inward_offset_from_outer_edge, height)
/// The profile creates the characteristic stacking lip:
/// - 45° chamfer from bottom edge going up 0.8mm
/// - Vertical wall section for 1.0mm  
/// - 45° chamfer going up 0.7mm
/// - Flat top continuing to bin body
fn generate_original_base() -> Mesh {
    // Profile: (inset from outer edge, z height)
    // Outer edge is at 41.5mm = 20.75mm from center
    let profile = [
        (0.0, 0.0),       // Bottom outer edge
        (0.0, 0.0),       // Start of first chamfer
        (0.8, 0.8),       // End of first 45° chamfer
        (0.8, 1.8),       // End of vertical wall
        (1.9, 2.6),       // End of second 45° chamfer (0.8 + 1.1 = 1.9 inset)
        (1.9, 5.0),       // Top surface
    ];

    generate_base_from_inset_profile(&profile, true)
}

/// Refined gridfinity - slightly modified tolerances for tighter fit
fn generate_refined_base() -> Mesh {
    let profile = [
        (0.0, 0.0),
        (0.0, 0.0),
        (0.7, 0.7),       // Slightly less aggressive chamfer
        (0.7, 1.7),
        (1.7, 2.5),
        (1.7, 4.75),
    ];

    generate_base_from_inset_profile(&profile, true)
}

/// Lite gridfinity - minimal base, just enough to stack
fn generate_lite_base() -> Mesh {
    let profile = [
        (0.0, 0.0),
        (0.0, 0.0),
        (0.6, 0.6),
        (0.6, 1.4),
        (1.4, 2.0),
        (1.4, 2.6),       // Much shorter total height
    ];

    generate_base_from_inset_profile(&profile, false)
}

/// Clickfinity - designed for click-fit baseplates
fn generate_clickfinity_base() -> Mesh {
    let profile = [
        (0.0, 0.0),
        (0.0, 0.0),
        (0.8, 0.8),
        (0.8, 2.0),       // Taller vertical section for click mechanism
        (2.0, 3.0),       // Steeper inward angle
        (2.0, 5.2),
    ];

    generate_base_from_inset_profile(&profile, true)
}

/// Generate a base mesh from an inset profile
/// Profile points are (inset_from_outer_edge, z_height)
fn generate_base_from_inset_profile(profile: &[(f32, f32)], with_bottom: bool) -> Mesh {
    let mut triangles = Vec::new();
    let segments_per_corner = 8;
    let total_segments = 4 * segments_per_corner;
    
    // Generate corner centers (pivot points for rounded corners)
    let half_size = OUTER_SIZE / 2.0;
    let inner_offset = half_size - CORNER_RADIUS;
    
    let corner_centers = [
        Vec3::new(inner_offset, inner_offset, 0.0),
        Vec3::new(-inner_offset, inner_offset, 0.0),
        Vec3::new(-inner_offset, -inner_offset, 0.0),
        Vec3::new(inner_offset, -inner_offset, 0.0),
    ];

    // Helper to get point on perimeter at given inset and angle
    let get_perimeter_point = |inset: f32, z: f32, corner_idx: usize, local_angle: f32| -> Vec3 {
        let base_angle = corner_idx as f32 * std::f32::consts::FRAC_PI_2;
        let angle = base_angle + local_angle;
        let radius = CORNER_RADIUS - inset;
        let center = corner_centers[corner_idx];
        Vec3::new(
            center.x + angle.cos() * radius,
            center.y + angle.sin() * radius,
            z,
        )
    };

    // Generate outer shell by extruding profile around perimeter
    for level in 0..profile.len() - 1 {
        let (inset1, z1) = profile[level];
        let (inset2, z2) = profile[level + 1];

        for seg in 0..total_segments {
            let corner_idx = seg / segments_per_corner;
            let local_seg = seg % segments_per_corner;
            let next_seg = (seg + 1) % total_segments;
            let next_corner_idx = next_seg / segments_per_corner;
            let next_local_seg = next_seg % segments_per_corner;

            let angle1 = (local_seg as f32 / segments_per_corner as f32) * std::f32::consts::FRAC_PI_2;
            let angle2 = (next_local_seg as f32 / segments_per_corner as f32) * std::f32::consts::FRAC_PI_2;

            let p1 = get_perimeter_point(inset1, z1, corner_idx, angle1);
            let p2 = get_perimeter_point(inset1, z1, next_corner_idx, angle2);
            let p3 = get_perimeter_point(inset2, z2, next_corner_idx, angle2);
            let p4 = get_perimeter_point(inset2, z2, corner_idx, angle1);

            // Create two triangles for this quad (outward facing)
            let edge1 = p2 - p1;
            let edge2 = p4 - p1;
            let normal = edge1.cross(edge2).normalize_or_zero();

            triangles.push(Triangle::new(
                Vertex::new(p1, normal),
                Vertex::new(p2, normal),
                Vertex::new(p3, normal),
            ));
            triangles.push(Triangle::new(
                Vertex::new(p1, normal),
                Vertex::new(p3, normal),
                Vertex::new(p4, normal),
            ));
        }
    }

    // Generate bottom face
    if with_bottom {
        let (inset, z) = profile[0];
        let center = Vec3::new(0.0, 0.0, z);
        let down = Vec3::new(0.0, 0.0, -1.0);

        // Create triangle fan from center
        for seg in 0..total_segments {
            let corner_idx = seg / segments_per_corner;
            let local_seg = seg % segments_per_corner;
            let next_seg = (seg + 1) % total_segments;
            let next_corner_idx = next_seg / segments_per_corner;
            let next_local_seg = next_seg % segments_per_corner;

            let angle1 = (local_seg as f32 / segments_per_corner as f32) * std::f32::consts::FRAC_PI_2;
            let angle2 = (next_local_seg as f32 / segments_per_corner as f32) * std::f32::consts::FRAC_PI_2;

            let p1 = get_perimeter_point(inset, z, corner_idx, angle1);
            let p2 = get_perimeter_point(inset, z, next_corner_idx, angle2);

            triangles.push(Triangle::new(
                Vertex::new(center, down),
                Vertex::new(p2, down),
                Vertex::new(p1, down),
            ));
        }
    }

    // Generate top face
    let (inset, z) = profile.last().unwrap();
    let center = Vec3::new(0.0, 0.0, *z);
    let up = Vec3::new(0.0, 0.0, 1.0);

    for seg in 0..total_segments {
        let corner_idx = seg / segments_per_corner;
        let local_seg = seg % segments_per_corner;
        let next_seg = (seg + 1) % total_segments;
        let next_corner_idx = next_seg / segments_per_corner;
        let next_local_seg = next_seg % segments_per_corner;

        let angle1 = (local_seg as f32 / segments_per_corner as f32) * std::f32::consts::FRAC_PI_2;
        let angle2 = (next_local_seg as f32 / segments_per_corner as f32) * std::f32::consts::FRAC_PI_2;

        let p1 = get_perimeter_point(*inset, *z, corner_idx, angle1);
        let p2 = get_perimeter_point(*inset, *z, next_corner_idx, angle2);

        triangles.push(Triangle::new(
            Vertex::new(center, up),
            Vertex::new(p1, up),
            Vertex::new(p2, up),
        ));
    }

    Mesh::from_triangles(triangles)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_generate_original_base() {
        let mesh = generate_gridfinity_base(MountStyle::Original);
        assert!(!mesh.triangles.is_empty());
        
        let (min, max) = mesh.bounds();
        // Should be approximately 41.5mm x 41.5mm
        let width = max.x - min.x;
        let depth = max.y - min.y;
        let height = max.z - min.z;
        
        assert!((width - 41.5).abs() < 0.5, "Width {width} should be ~41.5mm");
        assert!((depth - 41.5).abs() < 0.5, "Depth {depth} should be ~41.5mm");
        assert!(height > 4.0 && height < 6.0, "Height {height} should be 4-6mm");
    }

    #[test]
    fn test_all_mount_styles() {
        for style in [MountStyle::Original, MountStyle::Refined, MountStyle::Lite, MountStyle::Clickfinity] {
            let mesh = generate_gridfinity_base(style);
            assert!(!mesh.triangles.is_empty(), "Style {style:?} should generate triangles");
            
            let (min, max) = mesh.bounds();
            let width = max.x - min.x;
            assert!((width - 41.5).abs() < 1.0, "Style {style:?} width {width} should be ~41.5mm");
        }
    }
}
