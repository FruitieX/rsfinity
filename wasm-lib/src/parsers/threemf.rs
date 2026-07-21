use std::io::{Cursor, Read};

use glam::{Mat4, Vec3};
use quick_xml::{Reader, events::Event};
use zip::ZipArchive;

use crate::mesh::{Mesh, Triangle, Vertex};

#[derive(Debug)]
pub struct ThreeMfParseError(pub String);

impl std::fmt::Display for ThreeMfParseError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "3MF parse error: {}", self.0)
    }
}

impl std::error::Error for ThreeMfParseError {}

/// Component reference in 3MF
#[derive(Debug, Clone)]
struct ComponentRef {
    path: String,
    object_id: Option<u32>,
    transform: Mat4,
}

/// Parse 3MF file and extract mesh data
pub fn parse_3mf(data: &[u8]) -> Result<Mesh, ThreeMfParseError> {
    let cursor = Cursor::new(data);
    let mut archive = ZipArchive::new(cursor)
        .map_err(|e| ThreeMfParseError(format!("Invalid ZIP archive: {e}")))?;

    let mut all_triangles: Vec<Triangle> = Vec::new();

    // First try main model file
    let main_model_paths = ["3D/3dmodel.model", "3d/3dmodel.model"];
    let mut main_model_content = None;

    for path in &main_model_paths {
        if let Ok(mut file) = archive.by_name(path) {
            let mut content = String::new();
            if file.read_to_string(&mut content).is_ok() {
                main_model_content = Some(content);
                break;
            }
        }
    }

    if let Some(main_content) = main_model_content {
        // Parse main model for component references
        let components = extract_component_refs(&main_content);

        // Also try to parse mesh directly from main model
        if let Ok(mesh) = parse_model_xml(&main_content) {
            all_triangles.extend(mesh.triangles);
        }

        // Parse referenced component files
        for component in &components {
            let normalized_path = normalize_path(&component.path);

            let paths_to_try = [
                normalized_path.clone(),
                format!("3D/Objects/{}", normalized_path.split('/').last().unwrap_or("")),
                normalized_path.trim_start_matches('/').to_string(),
            ];

            for try_path in &paths_to_try {
                if let Ok(mut file) = archive.by_name(try_path) {
                    let mut content = String::new();
                    if file.read_to_string(&mut content).is_ok() {
                        if let Ok(mesh) = parse_model_xml(&content) {
                            let transformed = if component.transform != Mat4::IDENTITY {
                                transform_mesh(&mesh, &component.transform)
                            } else {
                                mesh
                            };
                            all_triangles.extend(transformed.triangles);
                        }
                        break;
                    }
                }
            }
        }
    }

    // If still no triangles, scan all .model files
    if all_triangles.is_empty() {
        let model_files: Vec<String> = (0..archive.len())
            .filter_map(|i| {
                archive.by_index(i).ok().and_then(|f| {
                    let name = f.name().to_string();
                    if name.ends_with(".model") { Some(name) } else { None }
                })
            })
            .collect();

        for path in model_files {
            if let Ok(mut file) = archive.by_name(&path) {
                let mut content = String::new();
                if file.read_to_string(&mut content).is_ok() {
                    if let Ok(mesh) = parse_model_xml(&content) {
                        all_triangles.extend(mesh.triangles);
                    }
                }
            }
        }
    }

    // Try embedded STL files as last resort
    if all_triangles.is_empty() {
        let stl_files: Vec<String> = (0..archive.len())
            .filter_map(|i| {
                archive.by_index(i).ok().and_then(|f| {
                    let name = f.name().to_string();
                    if name.to_lowercase().ends_with(".stl") { Some(name) } else { None }
                })
            })
            .collect();

        for path in stl_files {
            if let Ok(mut file) = archive.by_name(&path) {
                let mut data = Vec::new();
                if file.read_to_end(&mut data).is_ok() {
                    if let Ok(mesh) = crate::parsers::stl::parse_stl(&data) {
                        all_triangles.extend(mesh.triangles);
                    }
                }
            }
        }
    }

    if all_triangles.is_empty() {
        return Err(ThreeMfParseError(
            "No mesh data found in 3MF file. The file may use an unsupported structure.".to_string(),
        ));
    }

    Ok(Mesh::from_triangles(all_triangles))
}

fn extract_component_refs(xml: &str) -> Vec<ComponentRef> {
    let mut components = Vec::new();
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(true);

    loop {
        match reader.read_event() {
            Ok(Event::Empty(ref e)) | Ok(Event::Start(ref e)) => {
                let local_name = e.local_name();
                if local_name.as_ref() == b"component" {
                    let mut path = String::new();
                    let mut object_id = None;
                    let mut transform = Mat4::IDENTITY;

                    for attr in e.attributes().flatten() {
                        let key = attr.key.local_name();
                        let value = std::str::from_utf8(&attr.value).unwrap_or("");

                        match key.as_ref() {
                            b"path" => path = value.to_string(),
                            b"objectid" => object_id = value.parse().ok(),
                            b"transform" => transform = parse_transform(value),
                            _ => {}
                        }
                    }

                    if !path.is_empty() {
                        components.push(ComponentRef { path, object_id, transform });
                    }
                }
            }
            Ok(Event::Eof) => break,
            Err(_) => break,
            _ => {}
        }
    }

    components
}

fn parse_transform(s: &str) -> Mat4 {
    let values: Vec<f32> = s.split_whitespace().filter_map(|v| v.parse().ok()).collect();

    if values.len() == 12 {
        Mat4::from_cols_array(&[
            values[0], values[3], values[6], 0.0,
            values[1], values[4], values[7], 0.0,
            values[2], values[5], values[8], 0.0,
            values[9], values[10], values[11], 1.0,
        ])
    } else {
        Mat4::IDENTITY
    }
}

fn normalize_path(path: &str) -> String {
    path.trim_start_matches('/').replace('\\', "/")
}

fn transform_mesh(mesh: &Mesh, transform: &Mat4) -> Mesh {
    let normal_matrix = transform.inverse().transpose();

    let triangles: Vec<Triangle> = mesh.triangles.iter().map(|tri| {
        let v0 = transform.transform_point3(tri.vertices[0].pos());
        let v1 = transform.transform_point3(tri.vertices[1].pos());
        let v2 = transform.transform_point3(tri.vertices[2].pos());

        let n0 = normal_matrix.transform_vector3(tri.vertices[0].norm()).normalize();
        let n1 = normal_matrix.transform_vector3(tri.vertices[1].norm()).normalize();
        let n2 = normal_matrix.transform_vector3(tri.vertices[2].norm()).normalize();

        Triangle::new(Vertex::new(v0, n0), Vertex::new(v1, n1), Vertex::new(v2, n2))
    }).collect();

    Mesh::from_triangles(triangles)
}

fn parse_model_xml(xml: &str) -> Result<Mesh, ThreeMfParseError> {
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(true);

    let mut vertices: Vec<Vec3> = Vec::new();
    let mut triangles: Vec<Triangle> = Vec::new();

    let mut in_mesh = false;
    let mut in_vertices = false;
    let mut in_triangles = false;

    loop {
        match reader.read_event() {
            Ok(Event::Start(ref e)) | Ok(Event::Empty(ref e)) => {
                let local_name = e.local_name();
                let name = local_name.as_ref();

                if name == b"mesh" {
                    in_mesh = true;
                    vertices.clear();
                } else if name == b"vertices" && in_mesh {
                    in_vertices = true;
                } else if name == b"triangles" && in_mesh {
                    in_triangles = true;
                } else if name == b"vertex" && in_vertices {
                    if let Ok(v) = parse_vertex_element(e) {
                        vertices.push(v);
                    }
                } else if name == b"triangle" && in_triangles {
                    if let Ok((v1, v2, v3)) = parse_triangle_element(e) {
                        if v1 < vertices.len() && v2 < vertices.len() && v3 < vertices.len() {
                            let p0 = vertices[v1];
                            let p1 = vertices[v2];
                            let p2 = vertices[v3];
                            let normal = (p1 - p0).cross(p2 - p0).normalize_or_zero();
                            triangles.push(Triangle::new(
                                Vertex::new(p0, normal),
                                Vertex::new(p1, normal),
                                Vertex::new(p2, normal),
                            ));
                        }
                    }
                }
            }
            Ok(Event::End(ref e)) => {
                let local_name = e.local_name();
                let name = local_name.as_ref();
                if name == b"mesh" { in_mesh = false; }
                else if name == b"vertices" { in_vertices = false; }
                else if name == b"triangles" { in_triangles = false; }
            }
            Ok(Event::Eof) => break,
            Err(e) => {
                return Err(ThreeMfParseError(format!("XML parse error: {e}")));
            }
            _ => {}
        }
    }

    if triangles.is_empty() {
        return Err(ThreeMfParseError("No mesh data in this model file".to_string()));
    }

    Ok(Mesh::from_triangles(triangles))
}

fn parse_vertex_element(e: &quick_xml::events::BytesStart<'_>) -> Result<Vec3, ThreeMfParseError> {
    let mut x = 0.0f32;
    let mut y = 0.0f32;
    let mut z = 0.0f32;

    for attr in e.attributes().flatten() {
        let value = std::str::from_utf8(&attr.value).unwrap_or("0");
        match attr.key.local_name().as_ref() {
            b"x" => x = value.parse().unwrap_or(0.0),
            b"y" => y = value.parse().unwrap_or(0.0),
            b"z" => z = value.parse().unwrap_or(0.0),
            _ => {}
        }
    }

    Ok(Vec3::new(x, y, z))
}

fn parse_triangle_element(e: &quick_xml::events::BytesStart<'_>) -> Result<(usize, usize, usize), ThreeMfParseError> {
    let mut v1 = 0usize;
    let mut v2 = 0usize;
    let mut v3 = 0usize;

    for attr in e.attributes().flatten() {
        let value = std::str::from_utf8(&attr.value).unwrap_or("0");
        match attr.key.local_name().as_ref() {
            b"v1" => v1 = value.parse().unwrap_or(0),
            b"v2" => v2 = value.parse().unwrap_or(0),
            b"v3" => v3 = value.parse().unwrap_or(0),
            _ => {}
        }
    }

    Ok((v1, v2, v3))
}
