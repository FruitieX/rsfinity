import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Grid, OrbitControls } from "@react-three/drei";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import type { DisplayMesh } from "../worker/protocol";

// Gridfinity models are Z-up.
THREE.Object3D.DEFAULT_UP.set(0, 0, 1);

export type ViewDir = "iso" | "front" | "bottom" | "top";

export interface Footprint {
  min: [number, number, number];
  max: [number, number, number];
  center: [number, number];
  unitsX: number;
  unitsY: number;
}

export type ViewerScene =
  | {
      kind: "input";
      mesh: DisplayMesh;
      footprint: Footprint;
      /** Absolute Z of the cut plane. */
      cutZ: number;
      keep: "above" | "below";
      keepColor: string;
    }
  | { kind: "result"; mesh: DisplayMesh; footprint: Footprint; bodyTriangles: number };

const DIRS: Record<ViewDir, THREE.Vector3> = {
  iso: new THREE.Vector3(0.75, -1.25, 0.5),
  front: new THREE.Vector3(0, -1, 0.12),
  bottom: new THREE.Vector3(0.55, -0.9, -0.95),
  top: new THREE.Vector3(0.001, -0.25, 1),
};

export function Viewer(props: {
  scene: ViewerScene;
  colors: { body: string; base: string; ghost: string; cap: string; grid: string; gridSection: string; plane: string };
  view: { dir: ViewDir; nonce: number };
  /** Changes when a different model is shown, to refit the camera. */
  fitKey: string;
}) {
  return (
    <Canvas
      camera={{ fov: 35, near: 0.5, far: 5000, position: [150, -250, 170] }}
      dpr={[1, 2]}
      gl={{ antialias: true }}
      onCreated={({ gl }) => {
        gl.localClippingEnabled = true;
      }}
    >
      <ambientLight intensity={0.55} />
      <hemisphereLight args={["#ffffff", "#444a55", 0.8]} />
      <directionalLight position={[120, -160, 260]} intensity={1.6} />
      <directionalLight position={[-160, 120, -120]} intensity={0.55} />
      <SceneContents {...props} />
      <OrbitControls makeDefault enableDamping dampingFactor={0.12} />
    </Canvas>
  );
}

function SceneContents({
  scene,
  colors,
  view,
  fitKey,
}: Parameters<typeof Viewer>[0]) {
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(scene.mesh.positions, 3));
    g.setAttribute("normal", new THREE.BufferAttribute(scene.mesh.normals, 3));
    if (scene.kind === "result") {
      const bodyVerts = scene.bodyTriangles * 3;
      g.addGroup(0, bodyVerts, 0);
      g.addGroup(bodyVerts, scene.mesh.triangles * 3 - bodyVerts, 1);
    }
    g.computeBoundingSphere();
    return g;
  }, [scene.mesh, scene.kind, scene.kind === "result" ? scene.bodyTriangles : 0]);
  useEffect(() => () => geometry.dispose(), [geometry]);

  const fp = scene.footprint;
  const center = useMemo(
    () => new THREE.Vector3((fp.min[0] + fp.max[0]) / 2, (fp.min[1] + fp.max[1]) / 2, (fp.min[2] + fp.max[2]) / 2),
    [fp],
  );
  const radius = Math.hypot(fp.max[0] - fp.min[0], fp.max[1] - fp.min[1], fp.max[2] - fp.min[2]) / 2;
  // The floor grid would cover the base when looking from below, so hide it then.
  const grid = useRef<THREE.Mesh>(null);
  useFrame(({ camera }) => {
    if (grid.current) grid.current.visible = camera.position.z > fp.min[2];
  });

  return (
    <>
      <CameraRig center={center} radius={radius} dir={view.dir} nonce={view.nonce} fitKey={fitKey} />
      {scene.kind === "input" ? (
        <InputModel geometry={geometry} scene={scene} colors={colors} />
      ) : (
        <ResultModel geometry={geometry} colors={colors} />
      )}
      <Grid
        ref={grid}
        // drei's grid lies in XZ; rotate it into XY and line it up with the cell boundaries.
        rotation={[Math.PI / 2, 0, 0]}
        position={[fp.center[0] + fp.unitsX * 21, fp.center[1] + fp.unitsY * 21, fp.min[2] - 0.02]}
        cellSize={21}
        sectionSize={42}
        cellThickness={0.6}
        sectionThickness={1.1}
        cellColor={colors.grid}
        sectionColor={colors.gridSection}
        infiniteGrid
        fadeDistance={Math.max(400, radius * 8)}
        fadeStrength={2.5}
      />
    </>
  );
}

function InputModel({
  geometry,
  scene,
  colors,
}: {
  geometry: THREE.BufferGeometry;
  scene: Extract<ViewerScene, { kind: "input" }>;
  colors: Parameters<typeof Viewer>[0]["colors"];
}) {
  const { cutZ, keep, footprint: fp } = scene;
  const [keepPlane, dropPlane] = useMemo(() => {
    const above = new THREE.Plane(new THREE.Vector3(0, 0, 1), -cutZ);
    const below = new THREE.Plane(new THREE.Vector3(0, 0, -1), cutZ);
    return keep === "above" ? [above, below] : [below, above];
  }, [cutZ, keep]);

  const w = fp.max[0] - fp.min[0] + 16;
  const d = fp.max[1] - fp.min[1] + 16;
  const cx = (fp.min[0] + fp.max[0]) / 2;
  const cy = (fp.min[1] + fp.max[1]) / 2;
  const outline = useMemo(() => {
    const g = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-w / 2, -d / 2, 0),
      new THREE.Vector3(w / 2, -d / 2, 0),
      new THREE.Vector3(w / 2, d / 2, 0),
      new THREE.Vector3(-w / 2, d / 2, 0),
      new THREE.Vector3(-w / 2, -d / 2, 0),
    ]);
    return g;
  }, [w, d]);
  useEffect(() => () => outline.dispose(), [outline]);

  return (
    <>
      {/* Kept part. Back faces seen through the cut are drawn flat to read as a cut surface. */}
      <mesh geometry={geometry}>
        <meshStandardMaterial
          color={scene.keepColor}
          roughness={0.55}
          metalness={0.05}
          clippingPlanes={[keepPlane]}
          side={THREE.FrontSide}
          polygonOffset
          polygonOffsetFactor={1}
          polygonOffsetUnits={1}
        />
      </mesh>
      <mesh geometry={geometry}>
        <meshBasicMaterial color={colors.cap} clippingPlanes={[keepPlane]} side={THREE.BackSide} />
      </mesh>
      {/* Removed part, as a ghost. */}
      <mesh geometry={geometry}>
        <meshStandardMaterial
          color={colors.ghost}
          transparent
          opacity={0.22}
          depthWrite={false}
          roughness={0.9}
          clippingPlanes={[dropPlane]}
          side={THREE.DoubleSide}
        />
      </mesh>
      <group position={[cx, cy, cutZ]}>
        <mesh>
          <planeGeometry args={[w, d]} />
          <meshBasicMaterial color={colors.plane} transparent opacity={0.1} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
        <lineLoop geometry={outline}>
          <lineBasicMaterial color={colors.plane} transparent opacity={0.9} />
        </lineLoop>
      </group>
    </>
  );
}

function ResultModel({
  geometry,
  colors,
}: {
  geometry: THREE.BufferGeometry;
  colors: Parameters<typeof Viewer>[0]["colors"];
}) {
  const materials = useMemo(
    () => [
      new THREE.MeshStandardMaterial({ color: colors.body, roughness: 0.55, metalness: 0.05 }),
      new THREE.MeshStandardMaterial({ color: colors.base, roughness: 0.5, metalness: 0.05 }),
    ],
    [colors.body, colors.base],
  );
  useEffect(() => () => materials.forEach((m) => m.dispose()), [materials]);
  return <mesh geometry={geometry} material={materials} />;
}

function CameraRig({
  center,
  radius,
  dir,
  nonce,
  fitKey,
}: {
  center: THREE.Vector3;
  radius: number;
  dir: ViewDir;
  nonce: number;
  fitKey: string;
}) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const controls = useThree((s) => s.controls) as OrbitControlsImpl | null;
  const size = useThree((s) => s.size);

  useLayoutEffect(() => {
    const aspect = size.width / Math.max(1, size.height);
    const fov = THREE.MathUtils.degToRad(camera.fov);
    const fitFov = aspect < 1 ? 2 * Math.atan(Math.tan(fov / 2) * aspect) : fov;
    const dist = (radius * 1.15) / Math.sin(fitFov / 2);
    const offset = DIRS[dir].clone().normalize().multiplyScalar(dist);
    camera.position.copy(center).add(offset);
    camera.near = Math.max(0.1, dist / 100);
    camera.far = dist * 20;
    camera.updateProjectionMatrix();
    camera.lookAt(center);
    if (controls) {
      controls.target.copy(center);
      controls.update();
    }
    // Only refit when the model or requested view changes, not on every resize.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey, dir, nonce, controls]);
  return null;
}
