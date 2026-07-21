use glam::Vec3;
use nom::{
    IResult, Parser,
    branch::alt,
    bytes::complete::{tag, tag_no_case, take_until, take_while},
    character::complete::{line_ending, multispace0, space0, space1},
    combinator::{opt, recognize},
    multi::many0,
};

use crate::mesh::{Mesh, Triangle, Vertex};


#[derive(Debug)]
pub struct StlParseError(String);

impl std::fmt::Display for StlParseError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "STL parse error: {}", self.0)
    }
}

impl std::error::Error for StlParseError {}

/// Parse STL file (auto-detects binary vs ASCII)
pub fn parse_stl(data: &[u8]) -> Result<Mesh, StlParseError> {
    if is_binary_stl(data) {
        parse_binary_stl(data)
    } else {
        parse_ascii_stl(data)
    }
}

/// Check if STL is binary format
fn is_binary_stl(data: &[u8]) -> bool {
    if data.len() < 84 {
        return false;
    }

    // Check if it starts with "solid" (ASCII indicator)
    // But some binary files also start with "solid" in header, so we verify
    let starts_with_solid = data.len() >= 5
        && (data[..5] == *b"solid" || data[..5] == *b"SOLID");

    if !starts_with_solid {
        return true; // Binary
    }

    // Check if the claimed triangle count matches file size
    // Binary STL: 80 header + 4 count + (50 bytes per triangle)
    let claimed_count = u32::from_le_bytes([data[80], data[81], data[82], data[83]]);
    let expected_size = 84 + (claimed_count as usize * 50);

    // If size matches binary format, it's binary
    if data.len() == expected_size {
        return true;
    }

    // Otherwise, likely ASCII
    false
}

/// Parse binary STL format
fn parse_binary_stl(data: &[u8]) -> Result<Mesh, StlParseError> {
    if data.len() < 84 {
        return Err(StlParseError("File too small for binary STL".to_string()));
    }

    let triangle_count = u32::from_le_bytes([data[80], data[81], data[82], data[83]]) as usize;
    let expected_size = 84 + triangle_count * 50;

    if data.len() < expected_size {
        return Err(StlParseError(format!(
            "File truncated: expected {expected_size} bytes, got {}",
            data.len()
        )));
    }

    let mut triangles = Vec::with_capacity(triangle_count);
    let mut offset = 84;

    for _ in 0..triangle_count {
        // Read normal (3 floats)
        let nx = f32::from_le_bytes([data[offset], data[offset + 1], data[offset + 2], data[offset + 3]]);
        let ny = f32::from_le_bytes([data[offset + 4], data[offset + 5], data[offset + 6], data[offset + 7]]);
        let nz = f32::from_le_bytes([data[offset + 8], data[offset + 9], data[offset + 10], data[offset + 11]]);
        let normal = Vec3::new(nx, ny, nz);
        offset += 12;

        // Read 3 vertices
        let mut vertices = [Vertex::new(Vec3::ZERO, normal); 3];
        for v in &mut vertices {
            let x = f32::from_le_bytes([data[offset], data[offset + 1], data[offset + 2], data[offset + 3]]);
            let y = f32::from_le_bytes([data[offset + 4], data[offset + 5], data[offset + 6], data[offset + 7]]);
            let z = f32::from_le_bytes([data[offset + 8], data[offset + 9], data[offset + 10], data[offset + 11]]);
            *v = Vertex::new(Vec3::new(x, y, z), normal);
            offset += 12;
        }

        // Skip attribute byte count
        offset += 2;

        triangles.push(Triangle::new(vertices[0], vertices[1], vertices[2]));
    }

    Ok(Mesh::from_triangles(triangles))
}

/// Parse ASCII STL format
fn parse_ascii_stl(data: &[u8]) -> Result<Mesh, StlParseError> {
    let text = std::str::from_utf8(data)
        .map_err(|e| StlParseError(format!("Invalid UTF-8 in ASCII STL: {e}")))?;

    match parse_ascii_stl_content(text) {
        Ok((_, mesh)) => Ok(mesh),
        Err(e) => Err(StlParseError(format!("Parse error: {e}"))),
    }
}

fn parse_ascii_stl_content(input: &str) -> IResult<&str, Mesh> {
    let (input, _) = multispace0(input)?;
    let (input, _) = tag_no_case("solid")(input)?;
    let (input, _) = take_until("\n")(input)?; // Skip name
    let (input, _) = line_ending(input)?;
    let (input, triangles) = many0(parse_facet).parse(input)?;
    let (input, _) = multispace0(input)?;
    let (input, _) = tag_no_case("endsolid")(input)?;
    let (input, _) = opt(take_while(|c: char| c != '\0')).parse(input)?; // Skip trailing content

    Ok((input, Mesh::from_triangles(triangles)))
}

fn parse_facet(input: &str) -> IResult<&str, Triangle> {
    let (input, _) = multispace0(input)?;
    let (input, _) = tag_no_case("facet")(input)?;
    let (input, _) = space1(input)?;
    let (input, _) = tag_no_case("normal")(input)?;
    let (input, normal) = parse_vec3(input)?;
    let (input, _) = multispace0(input)?;
    let (input, _) = tag_no_case("outer")(input)?;
    let (input, _) = space1(input)?;
    let (input, _) = tag_no_case("loop")(input)?;
    let (input, v0) = parse_vertex(input)?;
    let (input, v1) = parse_vertex(input)?;
    let (input, v2) = parse_vertex(input)?;
    let (input, _) = multispace0(input)?;
    let (input, _) = tag_no_case("endloop")(input)?;
    let (input, _) = multispace0(input)?;
    let (input, _) = tag_no_case("endfacet")(input)?;

    Ok((
        input,
        Triangle::new(
            Vertex::new(v0, normal),
            Vertex::new(v1, normal),
            Vertex::new(v2, normal),
        ),
    ))
}

fn parse_vertex(input: &str) -> IResult<&str, Vec3> {
    let (input, _) = multispace0(input)?;
    let (input, _) = tag_no_case("vertex")(input)?;
    parse_vec3(input)
}

fn parse_vec3(input: &str) -> IResult<&str, Vec3> {
    let (input, _) = space0(input)?;
    let (input, x) = parse_float(input)?;
    let (input, _) = space1(input)?;
    let (input, y) = parse_float(input)?;
    let (input, _) = space1(input)?;
    let (input, z) = parse_float(input)?;

    Ok((input, Vec3::new(x, y, z)))
}

fn parse_float(input: &str) -> IResult<&str, f32> {
    let (input, _) = space0(input)?;
    // Handle scientific notation and negative numbers
    let (input, num_str) = recognize((
        opt(tag("-")),
        alt((
            // Scientific notation: 1.23e-4 or 1e10
            recognize((
                take_while(|c: char| c.is_ascii_digit()),
                opt((tag("."), take_while(|c: char| c.is_ascii_digit()))),
                alt((tag("e"), tag("E"))),
                opt(alt((tag("+"), tag("-")))),
                take_while(|c: char| c.is_ascii_digit()),
            )),
            // Regular decimal: 1.23 or .23 or 1.
            recognize((
                take_while(|c: char| c.is_ascii_digit()),
                opt((tag("."), take_while(|c: char| c.is_ascii_digit()))),
            )),
        )),
    ))
    .parse(input)?;

    let value: f32 = num_str.parse().unwrap_or(0.0);
    Ok((input, value))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_binary_stl() {
        // Minimal binary STL with 1 triangle
        let mut data = vec![0u8; 80]; // Header
        data.extend_from_slice(&1u32.to_le_bytes()); // 1 triangle

        // Normal
        data.extend_from_slice(&0.0f32.to_le_bytes());
        data.extend_from_slice(&0.0f32.to_le_bytes());
        data.extend_from_slice(&1.0f32.to_le_bytes());

        // Vertex 1
        data.extend_from_slice(&0.0f32.to_le_bytes());
        data.extend_from_slice(&0.0f32.to_le_bytes());
        data.extend_from_slice(&0.0f32.to_le_bytes());

        // Vertex 2
        data.extend_from_slice(&1.0f32.to_le_bytes());
        data.extend_from_slice(&0.0f32.to_le_bytes());
        data.extend_from_slice(&0.0f32.to_le_bytes());

        // Vertex 3
        data.extend_from_slice(&0.0f32.to_le_bytes());
        data.extend_from_slice(&1.0f32.to_le_bytes());
        data.extend_from_slice(&0.0f32.to_le_bytes());

        // Attribute
        data.extend_from_slice(&0u16.to_le_bytes());

        let mesh = parse_stl(&data).unwrap();
        assert_eq!(mesh.triangles.len(), 1);
    }

    #[test]
    fn test_parse_ascii_stl() {
        let stl = r#"solid test
facet normal 0 0 1
  outer loop
    vertex 0 0 0
    vertex 1 0 0
    vertex 0 1 0
  endloop
endfacet
endsolid test"#;

        let mesh = parse_stl(stl.as_bytes()).unwrap();
        assert_eq!(mesh.triangles.len(), 1);
    }
}
