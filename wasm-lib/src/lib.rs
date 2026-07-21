mod mesh;
mod mount_generator;
mod operations;
mod parsers;

use wasm_bindgen::prelude::*;

pub use mesh::{Mesh, MeshData, Triangle, Vertex};
pub use mount_generator::{MountStyle, generate_gridfinity_base};
pub use operations::{
    cut_mesh_at_plane, detect_cut_height, detect_grid_dimensions, merge_meshes, tile_mesh,
};
pub use parsers::{parse_3mf, parse_stl};

/// Debug function to inspect 3MF file structure
#[wasm_bindgen]
pub fn debug_3mf(data: &[u8]) -> Result<String, JsError> {
    use std::io::{Cursor, Read};
    use zip::ZipArchive;

    let cursor = Cursor::new(data);
    let mut archive =
        ZipArchive::new(cursor).map_err(|e| JsError::new(&format!("Invalid ZIP: {e}")))?;

    let mut info = String::new();
    info.push_str(&format!("Archive contains {} files:\n", archive.len()));

    for i in 0..archive.len() {
        let file = archive
            .by_index(i)
            .map_err(|e| JsError::new(&e.to_string()))?;
        info.push_str(&format!("  - {} ({} bytes)\n", file.name(), file.size()));
    }

    // Try to find and read model file
    let model_paths = ["3D/3dmodel.model", "3d/3dmodel.model"];
    for path in model_paths {
        if let Ok(mut file) = archive.by_name(path) {
            let mut content = String::new();
            if file.read_to_string(&mut content).is_ok() {
                info.push_str(&format!("\nModel file found at: {}\n", path));
                info.push_str(&format!(
                    "First 2000 chars:\n{}\n",
                    &content[..content.len().min(2000)]
                ));
            }
        }
    }

    Ok(info)
}

#[wasm_bindgen(start)]
pub fn init() {
    #[cfg(feature = "console_error_panic_hook")]
    console_error_panic_hook::set_once();
}

/// Process an uploaded file (STL or 3MF) and return mesh data for visualization
#[wasm_bindgen]
pub fn process_file(data: &[u8], filename: &str) -> Result<MeshData, JsError> {
    let mesh = if filename.to_lowercase().ends_with(".stl") {
        parse_stl(data).map_err(|e| JsError::new(&e.to_string()))?
    } else if filename.to_lowercase().ends_with(".3mf") {
        parse_3mf(data).map_err(|e| JsError::new(&e.to_string()))?
    } else {
        return Err(JsError::new(
            "Unsupported file format. Please use STL or 3MF files.",
        ));
    };

    Ok(mesh.to_mesh_data())
}

/// Analyze mesh and return suggested cut height and detected grid dimensions
#[wasm_bindgen]
pub fn analyze_mesh(data: &[u8], filename: &str) -> Result<AnalysisResult, JsError> {
    let mesh = if filename.to_lowercase().ends_with(".stl") {
        parse_stl(data).map_err(|e| JsError::new(&e.to_string()))?
    } else if filename.to_lowercase().ends_with(".3mf") {
        parse_3mf(data).map_err(|e| JsError::new(&e.to_string()))?
    } else {
        return Err(JsError::new("Unsupported file format"));
    };

    let suggested_cut_height = detect_cut_height(&mesh);
    let (grid_x, grid_y) = detect_grid_dimensions(&mesh);
    let bounds = mesh.bounds();

    Ok(AnalysisResult {
        suggested_cut_height,
        grid_x,
        grid_y,
        min_z: bounds.0.z,
        max_z: bounds.1.z,
        width: bounds.1.x - bounds.0.x,
        depth: bounds.1.y - bounds.0.y,
        height: bounds.1.z - bounds.0.z,
    })
}

/// Cut mesh at specified Z height and return the upper portion (bin)
#[wasm_bindgen]
pub fn cut_and_get_bin(data: &[u8], filename: &str, cut_z: f32) -> Result<MeshData, JsError> {
    let mesh = if filename.to_lowercase().ends_with(".stl") {
        parse_stl(data).map_err(|e| JsError::new(&e.to_string()))?
    } else if filename.to_lowercase().ends_with(".3mf") {
        parse_3mf(data).map_err(|e| JsError::new(&e.to_string()))?
    } else {
        return Err(JsError::new("Unsupported file format"));
    };

    let (bin, _mount) = cut_mesh_at_plane(&mesh, cut_z);
    Ok(bin.to_mesh_data())
}

/// Generate a gridfinity base mount
#[wasm_bindgen]
pub fn generate_mount(style: &str) -> Result<MeshData, JsError> {
    let mount_style = match style {
        "original" => MountStyle::Original,
        "refined" => MountStyle::Refined,
        "lite" => MountStyle::Lite,
        "clickfinity" => MountStyle::Clickfinity,
        _ => return Err(JsError::new(&format!("Unknown mount style: {style}"))),
    };

    let mesh = generate_gridfinity_base(mount_style);
    Ok(mesh.to_mesh_data())
}

/// Cut mesh, generate and tile replacement mount, and merge
#[wasm_bindgen]
pub fn swap_mount_generated(
    bin_data: &[u8],
    bin_filename: &str,
    mount_style: &str,
    cut_z: f32,
    grid_x: u32,
    grid_y: u32,
) -> Result<MeshData, JsError> {
    let bin_mesh = if bin_filename.to_lowercase().ends_with(".stl") {
        parse_stl(bin_data).map_err(|e| JsError::new(&e.to_string()))?
    } else if bin_filename.to_lowercase().ends_with(".3mf") {
        parse_3mf(bin_data).map_err(|e| JsError::new(&e.to_string()))?
    } else {
        return Err(JsError::new("Unsupported bin file format"));
    };

    let style = match mount_style {
        "original" => MountStyle::Original,
        "refined" => MountStyle::Refined,
        "lite" => MountStyle::Lite,
        "clickfinity" => MountStyle::Clickfinity,
        _ => return Err(JsError::new(&format!("Unknown mount style: {mount_style}"))),
    };

    let mount_mesh = generate_gridfinity_base(style);

    // Get bin bounds before cutting for centering the mount
    let bin_bounds = bin_mesh.bounds();

    // Cut the bin mesh to get only the upper portion
    let (bin_upper, _) = cut_mesh_at_plane(&bin_mesh, cut_z);

    // Tile the mount to match grid dimensions, centered on the bin
    let tiled_mount = tile_mesh(&mount_mesh, grid_x, grid_y, cut_z, Some(bin_bounds));

    // Merge bin and tiled mount
    let result = merge_meshes(&bin_upper, &tiled_mount);

    Ok(result.to_mesh_data())
}

/// Cut mesh, tile replacement mount to match grid dimensions, and merge
#[wasm_bindgen]
pub fn swap_mount(
    bin_data: &[u8],
    bin_filename: &str,
    mount_data: &[u8],
    mount_filename: &str,
    cut_z: f32,
    grid_x: u32,
    grid_y: u32,
) -> Result<MeshData, JsError> {
    let bin_mesh = if bin_filename.to_lowercase().ends_with(".stl") {
        parse_stl(bin_data).map_err(|e| JsError::new(&e.to_string()))?
    } else if bin_filename.to_lowercase().ends_with(".3mf") {
        parse_3mf(bin_data).map_err(|e| JsError::new(&e.to_string()))?
    } else {
        return Err(JsError::new("Unsupported bin file format"));
    };

    let mount_mesh = if mount_filename.to_lowercase().ends_with(".stl") {
        parse_stl(mount_data).map_err(|e| JsError::new(&e.to_string()))?
    } else if mount_filename.to_lowercase().ends_with(".3mf") {
        parse_3mf(mount_data).map_err(|e| JsError::new(&e.to_string()))?
    } else {
        return Err(JsError::new("Unsupported mount file format"));
    };

    // Get bin bounds before cutting for centering the mount
    let bin_bounds = bin_mesh.bounds();

    // Cut the bin mesh to get only the upper portion
    let (bin_upper, _) = cut_mesh_at_plane(&bin_mesh, cut_z);

    // Tile the mount to match grid dimensions, centered on the bin
    let tiled_mount = tile_mesh(&mount_mesh, grid_x, grid_y, cut_z, Some(bin_bounds));

    // Merge bin and tiled mount
    let result = merge_meshes(&bin_upper, &tiled_mount);

    Ok(result.to_mesh_data())
}

/// Swap mount using raw triangle data (9 floats per triangle: v0xyz, v1xyz, v2xyz)
#[wasm_bindgen]
pub fn swap_mount_from_triangles(
    bin_data: &[u8],
    bin_filename: &str,
    mount_triangles: &[f32],
    cut_z: f32,
    grid_x: u32,
    grid_y: u32,
) -> Result<MeshData, JsError> {
    use glam::Vec3;
    
    let bin_mesh = if bin_filename.to_lowercase().ends_with(".stl") {
        parse_stl(bin_data).map_err(|e| JsError::new(&e.to_string()))?
    } else if bin_filename.to_lowercase().ends_with(".3mf") {
        parse_3mf(bin_data).map_err(|e| JsError::new(&e.to_string()))?
    } else {
        return Err(JsError::new("Unsupported bin file format"));
    };

    // Build mount mesh from raw triangle data
    let mut triangles = Vec::new();
    for chunk in mount_triangles.chunks_exact(9) {
        let p0 = Vec3::new(chunk[0], chunk[1], chunk[2]);
        let p1 = Vec3::new(chunk[3], chunk[4], chunk[5]);
        let p2 = Vec3::new(chunk[6], chunk[7], chunk[8]);
        
        // Compute face normal
        let edge1 = p1 - p0;
        let edge2 = p2 - p0;
        let normal = edge1.cross(edge2).normalize_or_zero();
        
        let v0 = Vertex::new(p0, normal);
        let v1 = Vertex::new(p1, normal);
        let v2 = Vertex::new(p2, normal);
        triangles.push(Triangle::new(v0, v1, v2));
    }
    let mount_mesh = Mesh::from_triangles(triangles);

    let bin_bounds = bin_mesh.bounds();
    let (bin_upper, _) = cut_mesh_at_plane(&bin_mesh, cut_z);
    let tiled_mount = tile_mesh(&mount_mesh, grid_x, grid_y, cut_z, Some(bin_bounds));
    let result = merge_meshes(&bin_upper, &tiled_mount);

    Ok(result.to_mesh_data())
}

/// Export mesh as binary STL from raw arrays
#[wasm_bindgen]
pub fn export_stl_from_arrays(
    positions: &[f32],
    normals: &[f32],
    indices: &[u32],
) -> Result<Vec<u8>, JsError> {
    let mesh_data = MeshData::new(positions.to_vec(), normals.to_vec(), indices.to_vec());
    let mesh = Mesh::from_mesh_data(&mesh_data);
    Ok(mesh.to_binary_stl())
}

#[wasm_bindgen]
pub struct AnalysisResult {
    pub suggested_cut_height: f32,
    pub grid_x: u32,
    pub grid_y: u32,
    pub min_z: f32,
    pub max_z: f32,
    pub width: f32,
    pub depth: f32,
    pub height: f32,
}
