"use client";

import { useRef, useMemo, useEffect } from "react";
import { Canvas, useThree, useFrame } from "@react-three/fiber";
import { OrbitControls, Grid, Center, Environment } from "@react-three/drei";
import type { ProcessedMesh } from "@/lib/wasm-api";
import * as THREE from "three";

interface MeshObjectProps {
  mesh: ProcessedMesh;
  color?: string;
  opacity?: number;
  wireframe?: boolean;
}

function MeshObject({
  mesh,
  color = "#3b82f6",
  opacity = 1,
  wireframe = false,
}: MeshObjectProps) {
  const geometryRef = useRef<THREE.BufferGeometry>(null);

  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();

    // Convert from Z-up (STL) to Y-up (Three.js)
    // Standard conversion: X→X, Z→Y, Y→-Z
    const convertedPositions = new Float32Array(mesh.positions.length);
    
    for (let i = 0; i < mesh.positions.length; i += 3) {
      convertedPositions[i] = mesh.positions[i];         // X stays X
      convertedPositions[i + 1] = mesh.positions[i + 2]; // Z becomes Y (up)
      convertedPositions[i + 2] = -mesh.positions[i + 1]; // Y becomes -Z (depth)
    }

    geo.setAttribute(
      "position",
      new THREE.BufferAttribute(convertedPositions, 3)
    );
    geo.setIndex(new THREE.BufferAttribute(new Uint32Array(mesh.indices), 1));
    
    // Recompute normals after coordinate transform and winding fix
    geo.computeVertexNormals();
    geo.computeBoundingBox();
    geo.computeBoundingSphere();

    return geo;
  }, [mesh]);

  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial
        color={color}
        opacity={opacity}
        transparent={opacity < 1}
        wireframe={wireframe}
        side={THREE.FrontSide}
        flatShading={false}
      />
    </mesh>
  );
}

interface CutPlaneProps {
  z: number;
  size: number;
  visible: boolean;
}

function CutPlane({ z, size, visible }: CutPlaneProps) {
  if (!visible) return null;

  // Cut plane is horizontal in Z-up space, rendered in Y-up Three.js space
  // So we position at Y=z and keep the plane flat on XZ
  return (
    <mesh position={[0, z, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[size * 1.5, size * 1.5]} />
      <meshBasicMaterial
        color="#ef4444"
        opacity={0.4}
        transparent
        side={THREE.DoubleSide}
        depthWrite={false}
      />
    </mesh>
  );
}

interface AutoFitCameraProps {
  mesh: ProcessedMesh | null;
}

function AutoFitCamera({ mesh }: AutoFitCameraProps) {
  const { camera } = useThree();
  const fitted = useRef(false);

  useEffect(() => {
    if (!mesh || fitted.current) return;

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(mesh.positions, 3)
    );
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();

    const sphere = geometry.boundingSphere;
    if (sphere) {
      const distance = sphere.radius * 3;
      camera.position.set(distance, distance, distance);
      camera.lookAt(sphere.center);
      fitted.current = true;
    }
  }, [mesh, camera]);

  return null;
}

export interface MeshViewerProps {
  originalMesh?: ProcessedMesh | null;
  previewMesh?: ProcessedMesh | null;
  cutPlaneZ?: number;
  showCutPlane?: boolean;
  showOriginal?: boolean;
  showPreview?: boolean;
  className?: string;
}

export function MeshViewer({
  originalMesh,
  previewMesh,
  cutPlaneZ = 5,
  showCutPlane = true,
  showOriginal = true,
  showPreview = false,
  className,
}: MeshViewerProps) {
  const meshSize = useMemo(() => {
    const mesh = originalMesh || previewMesh;
    if (!mesh) return 100;

    let maxDim = 0;
    for (let i = 0; i < mesh.positions.length; i += 3) {
      maxDim = Math.max(
        maxDim,
        Math.abs(mesh.positions[i]),
        Math.abs(mesh.positions[i + 1]),
        Math.abs(mesh.positions[i + 2])
      );
    }
    return maxDim * 2 || 100;
  }, [originalMesh, previewMesh]);

  return (
    <div className={`w-full h-full bg-slate-900 rounded-lg ${className || ""}`}>
      <Canvas camera={{ position: [100, 100, 100], fov: 50 }}>
        <ambientLight intensity={0.4} />
        <directionalLight position={[10, 10, 5]} intensity={1} />
        <directionalLight position={[-10, -10, -5]} intensity={0.5} />

        <Center>
          {showOriginal && originalMesh && (
            <MeshObject
              mesh={originalMesh}
              color="#3b82f6"
              opacity={showPreview ? 0.3 : 1}
            />
          )}

          {showPreview && previewMesh && (
            <MeshObject mesh={previewMesh} color="#22c55e" />
          )}
        </Center>

        <CutPlane z={cutPlaneZ} size={meshSize} visible={showCutPlane} />

        <Grid
          args={[meshSize * 2, meshSize * 2]}
          cellSize={42}
          cellColor="#6b7280"
          sectionSize={42}
          sectionColor="#9ca3af"
          fadeDistance={meshSize * 4}
          position={[0, -0.1, 0]}
          rotation={[0, 0, 0]}
        />

        <OrbitControls makeDefault />
        <AutoFitCamera mesh={originalMesh || previewMesh || null} />
      </Canvas>
    </div>
  );
}
