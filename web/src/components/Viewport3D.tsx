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
import type { ReferenceImage } from '../lib/reference';
import { ReferencePlanes } from './ReferencePlanes';
import * as THREE from 'three';
import type { LureParams } from '../types/lure';
import type { LureGeometry } from '../lib/geometry';
import { buildAssembly, worldToAnchor, type AssemblyResult } from '../lib/assembly';
import { createSurfaceSampler } from '../lib/geometry';
import { markOnMaleSide } from '../lib/mark';
import { createProfile } from '../lib/profile';
import type { ThreeEvent } from '@react-three/fiber';
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
  interactive,
  onPointerDown,
  onPointerMove,
}: {
  geo: LureGeometry;
  params: LureParams;
  xray: boolean;
  interactive?: boolean;
  onPointerDown?: (event: ThreeEvent<PointerEvent>) => void;
  onPointerMove?: (event: ThreeEvent<PointerEvent>) => void;
}) {
  const texture = useMemo(() => createPaintTexture(params), [params]);
  useEffect(() => () => texture.dispose(), [texture]);
  const finish = FINISHES[params.paint.finish];

  return (
    <group>
      <mesh
        geometry={geo.body}
        castShadow={false}
        onPointerDown={interactive ? onPointerDown : undefined}
        onPointerMove={interactive ? onPointerMove : undefined}
      >
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
        // Bavette rapportee : modele fantome, jamais exporte. Il ne sert qu a
        // voir ou la plaque decoupee viendra se placer.
        <mesh geometry={geo.bib} userData={{ excludeFromExport: geo.bibIsGhost }}>
          <meshStandardMaterial
            color={geo.bibIsGhost ? '#7fb4dd' : '#cfe0ec'}
            roughness={0.1}
            metalness={0.05}
            transparent
            opacity={geo.bibIsGhost ? 0.3 : 0.62}
            depthWrite={!geo.bibIsGhost}
            side={THREE.DoubleSide}
          />
        </mesh>
      ) : null}

      {geo.mark ? (
        <mesh geometry={geo.mark}>
          <meshStandardMaterial
            color={params.paint.belly}
            roughness={FINISHES[params.paint.finish].roughness}
            metalness={FINISHES[params.paint.finish].metalness}
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

/** Billes mobiles, dessinees dans leur logement comme les lests. */
function Rattles({
  assembly,
  visible,
}: {
  assembly: AssemblyResult | null;
  visible: boolean;
}) {
  if (!assembly || !visible || assembly.rattles.length === 0) return null;
  return (
    <group renderOrder={12}>
      {assembly.rattles.map((ball, index) => (
        <mesh key={index} position={ball.position} renderOrder={12}>
          <sphereGeometry args={[ball.radius, 20, 14]} />
          <meshStandardMaterial
            color="#b9bdc4"
            roughness={0.18}
            metalness={0.95}
            depthTest={false}
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
function ExplodedAssembly({
  assembly,
  geo,
  params,
  spread,
}: {
  assembly: AssemblyResult;
  geo: LureGeometry;
  params: LureParams;
  spread: number;
}) {
  const offset = assembly.splitNormal.clone().multiplyScalar(spread);
  const finish = FINISHES[params.paint.finish];
  // Le marquage part avec la coque qui le porte, comme a l'export.
  const markOnMale = useMemo(
    () => markOnMaleSide(createProfile(params), params),
    [params],
  );
  const mark = geo.mark ? (
    <mesh geometry={geo.mark}>
      <meshStandardMaterial color="#101114" roughness={0.6} />
    </mesh>
  ) : null;

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
        {markOnMale ? mark : null}
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
        {markOnMale ? null : mark}
      </group>

      {assembly.pins.map((pin, index) => (
        <mesh key={index} geometry={pin.geometry}>
          <meshStandardMaterial color="#c9ccd1" roughness={0.25} metalness={0.95} />
        </mesh>
      ))}
    </group>
  );
}

/**
 * Portees de goupille en surbrillance : sans cet apercu, le logement reste
 * invisible puisqu'il est creuse dans le plan de joint, face cachee.
 */
function SocketPreview({ assembly }: { assembly: AssemblyResult }) {
  if (!assembly.socketPreview) return null;
  return (
    <mesh geometry={assembly.socketPreview} renderOrder={15}>
      <meshBasicMaterial
        color="#e30613"
        transparent
        opacity={0.42}
        depthTest={false}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

/** Poignees d'ancrage : selection, deplacement, signalement des invalides. */
function AnchorHandles({
  assembly,
  radius,
  selected,
  onSelect,
  onDragStart,
}: {
  assembly: AssemblyResult;
  radius: number;
  selected: string | null;
  onSelect: (id: string) => void;
  onDragStart: (id: string) => void;
}) {
  const size = Math.max(radius * 0.07, 0.1);
  return (
    <group renderOrder={25}>
      {assembly.sockets.map((socket) => (
        <mesh
          key={socket.anchorId}
          position={socket.world}
          renderOrder={25}
          onPointerDown={(event: ThreeEvent<PointerEvent>) => {
            event.stopPropagation();
            onSelect(socket.anchorId);
            onDragStart(socket.anchorId);
          }}
        >
          <sphereGeometry args={[socket.anchorId === selected ? size * 1.4 : size, 20, 14]} />
          <meshBasicMaterial
            color={!socket.valid ? '#e30613' : socket.anchorId === selected ? '#111315' : '#1b5e9c'}
            depthTest={false}
          />
        </mesh>
      ))}
    </group>
  );
}

/**
 * Poignees de la cage de sculpture : un glisser vertical tire ou repousse
 * localement la peau, par-dessus la forme pilotee par les sliders.
 */
function CageHandles({
  params,
  radius,
  selected,
  onSelect,
  onDrag,
}: {
  params: LureParams;
  radius: number;
  selected: string | null;
  onSelect: (id: string | null) => void;
  onDrag: (id: string, deltaMm: number) => void;
}) {
  const dragging = useRef<string | null>(null);
  const points = useMemo(() => {
    const surface = createSurfaceSampler(createProfile(params), params);
    return params.sculpt.map((point) => ({
      point,
      world: surface(point.position, THREE.MathUtils.degToRad(point.angle)),
    }));
  }, [params]);

  useEffect(() => {
    const move = (event: PointerEvent) => {
      const id = dragging.current;
      // Vers le haut = matiere qui ressort : 0,04 mm par pixel.
      if (id) onDrag(id, -event.movementY * 0.04);
    };
    const up = () => {
      dragging.current = null;
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [onDrag]);

  const size = Math.max(radius * 0.045, 0.07);
  return (
    <group renderOrder={30}>
      {points.map(({ point, world }) => (
        <mesh
          key={point.id}
          position={world}
          renderOrder={30}
          onPointerDown={(event: ThreeEvent<PointerEvent>) => {
            event.stopPropagation();
            dragging.current = point.id;
            onSelect(point.id);
          }}
        >
          <sphereGeometry args={[point.id === selected ? size * 1.5 : size, 16, 12]} />
          <meshBasicMaterial
            color={
              point.id === selected
                ? '#e30613'
                : Math.abs(point.amount) > 0.05
                  ? '#17794a'
                  : '#101114'
            }
            depthTest={false}
          />
        </mesh>
      ))}
    </group>
  );
}

export interface Viewport3DProps {
  geo: LureGeometry;
  params: LureParams;
  physics: PhysicsResult;
  /** Incremente a chaque chargement de gabarit ou de projet : recadre la vue. */
  fitKey: number;
  /** Mode « placement de goupille » : un clic sur le corps pose un ancrage. */
  placing: boolean;
  selectedAnchor: string | null;
  onPlaceAnchor: (position: number, height: number) => void;
  onMoveAnchor: (id: string, position: number, height: number) => void;
  onSelectAnchor: (id: string | null) => void;
  /** Images de reference calees dans les plans du modele. */
  references: ReferenceImage[];
  /** Reference en cours de calibration : son plan devient cliquable. */
  calibratingId: string | null;
  onPickCalibration: (id: string, u: number, v: number) => void;
  /** Cage de sculpture : poignees affichees et deplacables. */
  sculpting: boolean;
  selectedSculpt: string | null;
  onSelectSculpt: (id: string | null) => void;
  onDragSculpt: (id: string, deltaMm: number) => void;
}

export function Viewport3D({
  geo,
  params,
  physics,
  fitKey,
  placing,
  selectedAnchor,
  onPlaceAnchor,
  onMoveAnchor,
  onSelectAnchor,
  references,
  calibratingId,
  onPickCalibration,
  sculpting,
  selectedSculpt,
  onSelectSculpt,
  onDragSculpt,
}: Viewport3DProps) {
  const reducedMotion = useReducedMotion();
  const [view, setView] = useState<ViewId>('iso');
  const [fitSignal, setFitSignal] = useState(0);
  const [showMarkers, setShowMarkers] = useState(true);
  const [xray, setXray] = useState(false);
  const [floatView, setFloatView] = useState(false);
  const [exploded, setExploded] = useState(false);
  const [showSockets, setShowSockets] = useState(true);
  const dragging = useRef<string | null>(null);

  const radius =
    Math.hypot(geo.bounds.length, geo.bounds.height, geo.bounds.width) / 20 || 5;
  const groundY = -geo.bounds.height / 20 - 0.9;
  // L'assemblage n'est calcule que lorsqu'il sert : vue eclatee, apercu des
  // portees ou placement d'ancrages.
  const hasCavity = params.rattles.length > 0 || params.chamber.enabled;
  const needsAssembly =
    params.assembly.enabled && (exploded || showSockets || placing || hasCavity);
  const assembly = useMemo(
    () => (needsAssembly ? buildAssembly(createProfile(params), params) : null),
    [needsAssembly, params],
  );
  useEffect(
    () => () => {
      if (!assembly) return;
      assembly.male.dispose();
      assembly.female.dispose();
      assembly.tenons?.dispose();
      assembly.socketPreview?.dispose();
      for (const pin of assembly.pins) pin.geometry.dispose();
    },
    [assembly],
  );

  const handleSurfacePointer = (event: ThreeEvent<PointerEvent>, place: boolean) => {
    if (!placing) return;
    const id = dragging.current;
    if (!place && !id) return;
    event.stopPropagation();
    const { position, height } = worldToAnchor(createProfile(params), params, event.point);
    if (id) onMoveAnchor(id, position, height);
    else if (place) onPlaceAnchor(position, height);
  };

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

          <ReferencePlanes
            references={references}
            radius={radius}
            calibratingId={calibratingId}
            onPick={onPickCalibration}
          />

          <group
            rotation={[0, 0, tilt]}
            onPointerUp={() => {
              dragging.current = null;
            }}
          >
            {exploded && assembly ? (
              <ExplodedAssembly
                assembly={assembly}
                geo={geo}
                params={params}
                spread={radius * 0.55}
              />
            ) : (
              <LureModel
                geo={geo}
                params={params}
                xray={xray}
                interactive={placing}
                onPointerDown={(event) => handleSurfacePointer(event, true)}
                onPointerMove={(event) => handleSurfacePointer(event, false)}
              />
            )}
            {assembly && showSockets ? <SocketPreview assembly={assembly} /> : null}
            <Rattles assembly={assembly} visible={showMarkers || xray} />
            {sculpting ? (
              <CageHandles
                params={params}
                radius={radius}
                selected={selectedSculpt}
                onSelect={onSelectSculpt}
                onDrag={onDragSculpt}
              />
            ) : null}
            {assembly && placing ? (
              <AnchorHandles
                assembly={assembly}
                radius={radius}
                selected={selectedAnchor}
                onSelect={onSelectAnchor}
                onDragStart={(id) => {
                  dragging.current = id;
                }}
              />
            ) : null}
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
        <button
          type="button"
          className="toolbtn"
          aria-pressed={showSockets}
          disabled={!params.assembly.enabled}
          onClick={() => setShowSockets((value) => !value)}
        >
          Portees
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
