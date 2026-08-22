/**
 * Viewport 3D interactif.
 *
 * Le maillage est reconstruit a chaque changement de parametre : aucun
 * modele n'est charge, tout sort du generateur procedural. Le viewport
 * affiche aussi les reperes physiques (CG, centre de poussee, lests) et une
 * vue flottaison qui incline le leurre selon son assiette calculee.
 */

import { Canvas, useThree } from '@react-three/fiber';
import { ContactShadows, Grid, OrbitControls } from '@react-three/drei';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import type { LureParams } from '../types/lure';
import type { LureGeometry } from '../lib/geometry';
import { buildAssembly } from '../lib/assembly';
import { createProfile } from '../lib/profile';
import { FINISHES } from '../lib/materials';
import { createPaintTexture } from '../lib/paint';
import { useReducedMotion } from '../lib/hooks';
import type { PhysicsResult } from '../lib/physics';
import { waterlineY } from '../lib/physics';

type ViewId = 'iso' | 'side' | 'top' | 'front';

const VIEW_DIRECTIONS: Record<ViewId, [number, number, number]> = {
  iso: [0.62, 0.42, 0.86],
  side: [0.02, 0.06, 1],
  top: [0.02, 1, 0.04],
  front: [-1, 0.12, 0.05],
};

interface ControlsLike {
  target: THREE.Vector3;
  update: () => void;
}

function CameraRig({
  radius,
  view,
  fitSignal,
}: {
  radius: number;
  view: ViewId;
  fitSignal: number;
}) {
  const camera = useThree((state) => state.camera);
  const controls = useThree((state) => state.controls) as unknown as ControlsLike | null;
  const size = useThree((state) => state.size);
  const radiusRef = useRef(radius);
  radiusRef.current = radius;

  useEffect(() => {
    const perspective = camera as THREE.PerspectiveCamera;
    // Recadrage sur la sphere englobante : on tient compte du champ vertical
    // ET du champ horizontal, sinon un leurre allonge deborde des le depart
    // sur un viewport plus haut que large.
    const halfV = Math.tan(THREE.MathUtils.degToRad((perspective.fov ?? 38) / 2));
    const aspect = size.height > 0 ? size.width / size.height : 1;
    const halfH = halfV * aspect;
    const distance = Math.max((radiusRef.current * 1.18) / Math.min(halfV, halfH), 6);

    const [dx, dy, dz] = VIEW_DIRECTIONS[view];
    const direction = new THREE.Vector3(dx, dy, dz).normalize();
    camera.position.copy(direction.multiplyScalar(distance));
    camera.near = Math.max(distance / 200, 0.01);
    camera.far = distance * 40;
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    if (controls) {
      controls.target.set(0, 0, 0);
      controls.update();
    }
  }, [camera, controls, view, fitSignal, size.width, size.height]);

  return null;
}

function LureModel({
  geo,
  params,
  xray,
}: {
  geo: LureGeometry;
  params: LureParams;
  xray: boolean;
}) {
  const texture = useMemo(() => createPaintTexture(params), [params]);
  useEffect(() => () => texture.dispose(), [texture]);
  const finish = FINISHES[params.paint.finish];

  return (
    <group>
      <mesh geometry={geo.body} castShadow={false}>
        <meshPhysicalMaterial
          map={texture}
          roughness={finish.roughness}
          metalness={finish.metalness}
          // Film mince : la teinte se decale avec l'angle de vue, ce qui rend
          // la finition holographique sans texture d'environnement.
          iridescence={finish.iridescence}
          iridescenceIOR={1.35}
          iridescenceThicknessRange={[120, 520]}
          transparent={xray}
          opacity={xray ? 0.28 : 1}
          depthWrite={!xray}
          side={xray ? THREE.DoubleSide : THREE.FrontSide}
        />
      </mesh>

      {geo.tail ? (
        <mesh geometry={geo.tail}>
          <meshPhysicalMaterial
            color={params.paint.tailLength > 0.01 ? params.paint.tail : params.paint.flank}
            roughness={Math.min(finish.roughness + 0.1, 1)}
            metalness={finish.metalness}
            iridescence={finish.iridescence}
            iridescenceIOR={1.35}
            transparent={xray}
            opacity={xray ? 0.3 : 1}
            side={THREE.DoubleSide}
          />
        </mesh>
      ) : null}

      {geo.clip ? (
        <mesh geometry={geo.clip.geometry}>
          <meshStandardMaterial color="#c9b675" roughness={0.28} metalness={0.95} />
        </mesh>
      ) : null}

      {geo.bib ? (
        <mesh geometry={geo.bib}>
          <meshStandardMaterial
            color="#cfe0ec"
            roughness={0.1}
            metalness={0.05}
            transparent
            opacity={0.62}
            side={THREE.DoubleSide}
          />
        </mesh>
      ) : null}
    </group>
  );
}

function Ballasts({
  geo,
  visible,
  overlay,
}: {
  geo: LureGeometry;
  visible: boolean;
  /** Hors vue rayons X, les lests sont dessines par-dessus le corps opaque. */
  overlay: boolean;
}) {
  if (!visible) return null;
  return (
    <group renderOrder={overlay ? 10 : 0}>
      {geo.ballasts.map((marker) => (
        <mesh key={marker.id} position={marker.position} renderOrder={overlay ? 10 : 0}>
          <sphereGeometry args={[Math.max(marker.radius, 0.05), 20, 14]} />
          <meshStandardMaterial
            color={marker.fits ? '#31363f' : '#e30613'}
            roughness={0.32}
            metalness={0.85}
            depthTest={!overlay}
          />
        </mesh>
      ))}
    </group>
  );
}

function BalanceMarkers({
  physics,
  radius,
  visible,
}: {
  physics: PhysicsResult;
  radius: number;
  visible: boolean;
}) {
  if (!visible) return null;
  const size = Math.max(radius * 0.055, 0.1);
  // Annotations : toujours visibles, meme a l'interieur d'un corps opaque.
  return (
    <group renderOrder={20}>
      <mesh position={[physics.cg.x, physics.cg.y, 0]} renderOrder={20}>
        <sphereGeometry args={[size, 20, 14]} />
        <meshBasicMaterial color="#e30613" depthTest={false} />
      </mesh>
      <mesh position={[physics.cb.x, physics.cb.y, 0]} renderOrder={20}>
        <sphereGeometry args={[size * 0.85, 20, 14]} />
        <meshBasicMaterial color="#1b5e9c" depthTest={false} />
      </mesh>
      {/* Bras de levier entre centre de gravite et centre de poussee. */}
      <line>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            args={[
              new Float32Array([
                physics.cg.x,
                physics.cg.y,
                0,
                physics.cb.x,
                physics.cb.y,
                0,
              ]),
              3,
            ]}
          />
        </bufferGeometry>
        <lineBasicMaterial color="#101114" depthTest={false} />
      </line>
    </group>
  );
}

function WaterPlane({ y, radius }: { y: number | null; radius: number }) {
  if (y === null) return null;
  const size = Math.max(radius * 9, 24);
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, y, 0]}>
      <planeGeometry args={[size, size]} />
      <meshStandardMaterial
        color="#3b8fd4"
        transparent
        opacity={0.24}
        roughness={0.2}
        metalness={0.1}
        depthWrite={false}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

/**
 * Vue eclatee : les deux coques s'ecartent de part et d'autre du plan de
 * joint, ce qui rend visibles les goujons, le logement et la goupille.
 */
function ExplodedAssembly({ params, spread }: { params: LureParams; spread: number }) {
  const assembly = useMemo(() => buildAssembly(createProfile(params), params), [params]);
  useEffect(
    () => () => {
      assembly.male.dispose();
      assembly.female.dispose();
      assembly.tenons?.dispose();
      assembly.pin.geometry.dispose();
    },
    [assembly],
  );

  const offset = assembly.splitNormal.clone().multiplyScalar(spread);
  const finish = FINISHES[params.paint.finish];

  return (
    <group>
      <group position={offset}>
        <mesh geometry={assembly.male}>
          <meshStandardMaterial
            color={params.paint.flank}
            roughness={finish.roughness}
            metalness={finish.metalness}
            side={THREE.DoubleSide}
          />
        </mesh>
        {assembly.tenons ? (
          <mesh geometry={assembly.tenons}>
            <meshStandardMaterial color="#e30613" roughness={0.5} />
          </mesh>
        ) : null}
      </group>

      <group position={offset.clone().negate()}>
        <mesh geometry={assembly.female}>
          <meshStandardMaterial
            color={params.paint.dorsal}
            roughness={finish.roughness}
            metalness={finish.metalness}
            side={THREE.DoubleSide}
          />
        </mesh>
      </group>

      <mesh geometry={assembly.pin.geometry}>
        <meshStandardMaterial color="#c9ccd1" roughness={0.25} metalness={0.95} />
      </mesh>
    </group>
  );
}

export interface Viewport3DProps {
  geo: LureGeometry;
  params: LureParams;
  physics: PhysicsResult;
  /** Incremente a chaque chargement de gabarit ou de projet : recadre la vue. */
  fitKey: number;
}

export function Viewport3D({ geo, params, physics, fitKey }: Viewport3DProps) {
  const reducedMotion = useReducedMotion();
  const [view, setView] = useState<ViewId>('iso');
  const [fitSignal, setFitSignal] = useState(0);
  const [showMarkers, setShowMarkers] = useState(true);
  const [xray, setXray] = useState(false);
  const [floatView, setFloatView] = useState(false);
  const [exploded, setExploded] = useState(false);

  const radius =
    Math.hypot(geo.bounds.length, geo.bounds.height, geo.bounds.width) / 20 || 5;
  const groundY = -geo.bounds.height / 20 - 0.9;
  const waterY = useMemo(
    () => (floatView ? waterlineY(params, physics.ratio) : null),
    [floatView, params, physics.ratio],
  );
  const tilt = floatView ? -THREE.MathUtils.degToRad(physics.trimDeg) : 0;

  return (
    <section className="viewport panel--viewport" aria-label="Vue 3D du leurre">
      <div className="viewport__canvas">
        <Canvas
          dpr={[1, 2]}
          frameloop="demand"
          gl={{ antialias: true, alpha: false }}
          camera={{ fov: 38, position: [6, 4, 9] }}
        >
          <color attach="background" args={['#eef0f3']} />
          <CameraRig radius={radius} view={view} fitSignal={fitSignal + fitKey} />

          <ambientLight intensity={0.85} />
          <hemisphereLight args={['#ffffff', '#b9c0c9', 0.75]} />
          <directionalLight position={[6, 9, 7]} intensity={2.2} />
          <directionalLight position={[-7, 4, -6]} intensity={0.8} color="#dce6f2" />
          <pointLight position={[0, -5, 6]} intensity={0.5} />

          <group rotation={[0, 0, tilt]}>
            {exploded && params.assembly.enabled ? (
              <ExplodedAssembly params={params} spread={radius * 0.55} />
            ) : (
              <LureModel geo={geo} params={params} xray={xray} />
            )}
            <Ballasts geo={geo} visible={showMarkers || xray} overlay={showMarkers && !xray} />
            <BalanceMarkers physics={physics} radius={radius} visible={showMarkers} />
          </group>

          <WaterPlane y={waterY} radius={radius} />

          <Grid
            position={[0, groundY, 0]}
            args={[40, 40]}
            cellSize={1}
            cellThickness={0.6}
            cellColor="#c2c8d0"
            sectionSize={5}
            sectionThickness={1.1}
            sectionColor="#e30613"
            fadeDistance={Math.max(radius * 12, 40)}
            fadeStrength={1.2}
            infiniteGrid
          />
          <ContactShadows
            position={[0, groundY + 0.02, 0]}
            opacity={0.3}
            scale={Math.max(radius * 7, 20)}
            blur={2.6}
            far={Math.max(radius * 3, 8)}
          />

          <OrbitControls
            makeDefault
            enableDamping={!reducedMotion}
            dampingFactor={0.09}
            minDistance={radius * 0.8}
            maxDistance={radius * 18}
            zoomSpeed={0.8}
          />
        </Canvas>
      </div>

      <div className="viewport__toolbar">
        <div className="segmented" role="group" aria-label="Point de vue">
          {(
            [
              ['iso', '3/4'],
              ['side', 'Profil'],
              ['top', 'Dessus'],
              ['front', 'Face'],
            ] as [ViewId, string][]
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              aria-pressed={view === id}
              onClick={() => {
                setView(id);
                setFitSignal((n) => n + 1);
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="toolbtn"
          onClick={() => setFitSignal((n) => n + 1)}
        >
          Recadrer
        </button>
        <button
          type="button"
          className="toolbtn"
          aria-pressed={showMarkers}
          onClick={() => setShowMarkers((value) => !value)}
        >
          Reperes CG / CP
        </button>
        <button
          type="button"
          className="toolbtn"
          aria-pressed={xray}
          onClick={() => setXray((value) => !value)}
        >
          Vue rayons X
        </button>
        <button
          type="button"
          className="toolbtn"
          aria-pressed={floatView}
          onClick={() => setFloatView((value) => !value)}
        >
          Flottaison
        </button>
        <button
          type="button"
          className="toolbtn"
          aria-pressed={exploded}
          disabled={!params.assembly.enabled}
          onClick={() => setExploded((value) => !value)}
        >
          Eclate
        </button>
      </div>

      <div className="viewport__footer">
        <div className="dims">
          <span>
            Long. <b>{geo.bounds.length.toFixed(0)}</b> mm
          </span>
          <span>
            Haut. <b>{geo.bounds.height.toFixed(0)}</b> mm
          </span>
          <span>
            Larg. <b>{geo.bounds.width.toFixed(0)}</b> mm
          </span>
          <span>
            Vol. <b>{physics.volumeCm3.toFixed(1)}</b> cm3
          </span>
        </div>
        <p className="viewport__hint">
          Glisser : orbite · Molette : zoom · Clic droit : deplacer
        </p>
      </div>
    </section>
  );
}
