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
import type { LureParams, PreviewEnv } from '../types/lure';
import type { LureGeometry } from '../lib/geometry';
import {
  assemblyActive,
  buildAssembly,
  worldToAnchor,
  type AssemblyResult,
} from '../lib/assembly';
import { createSurfaceSampler } from '../lib/geometry';
import { createProfile } from '../lib/profile';
import { buildInsert, insertBlocker, measureCavity } from '../lib/insert';
import { mountTrails, resolveMount } from '../lib/tackle';
import type { ThreeEvent } from '@react-three/fiber';
import { FINISHES } from '../lib/materials';
import { createLiveryNormalMap, createPaintTexture, createScaleNormalMap } from '../lib/paint';
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


/**
 * Environnements d'apercu — module L.
 *
 * Purement visuel : ils changent la lumiere et le fond, jamais la geometrie.
 * L'atelier est la vue de travail historique, avec sa grille et ses reperes ;
 * le studio est la vue de presentation, fond blanc et ombre douce ; la vue
 * subaquatique montre le leurre comme le poisson le voit.
 */
const ENVIRONMENTS: Record<
  PreviewEnv,
  {
    label: string;
    background: string;
    /** Brouillard : couleur, debut et fin, ou null. */
    fog: [string, number, number] | null;
    ambient: number;
    hemisphere: [string, string, number];
    key: { position: [number, number, number]; intensity: number; color: string };
    fill: { position: [number, number, number]; intensity: number; color: string };
    rim: { position: [number, number, number]; intensity: number; color: string };
    /** Grille et plan d'eau : la presentation les efface. */
    chrome: boolean;
    shadowOpacity: number;
    /** Etendue de l'ombre portee, en rayons de scene. */
    shadowSpread: number;
  }
> = {
  atelier: {
    label: 'Atelier',
    background: '#eef0f3',
    fog: null,
    ambient: 0.85,
    hemisphere: ['#ffffff', '#b9c0c9', 0.75],
    key: { position: [6, 9, 7], intensity: 2.2, color: '#ffffff' },
    fill: { position: [-7, 4, -6], intensity: 0.8, color: '#dce6f2' },
    rim: { position: [0, -5, 6], intensity: 0.5, color: '#ffffff' },
    chrome: true,
    shadowOpacity: 0.3,
    shadowSpread: 7,
  },
  studio: {
    label: 'Studio',
    background: '#ffffff',
    fog: null,
    // Fond blanc, lumiere large et douce : c'est ce qui donne la photo de
    // catalogue. La cle reste marquee pour que le vernis accroche un reflet
    // net — sans lui, un leurre verni parait mat.
    ambient: 1.05,
    hemisphere: ['#ffffff', '#f0f0f0', 1],
    key: { position: [5, 8, 9], intensity: 2.9, color: '#ffffff' },
    fill: { position: [-8, 3, -4], intensity: 1.1, color: '#ffffff' },
    rim: { position: [-2, 6, -9], intensity: 1.6, color: '#eaf1ff' },
    chrome: false,
    shadowOpacity: 0.26,
    /** Ombre serree sous la piece : une photo de catalogue n'a pas de sol. */
    shadowSpread: 2.4,
  },
  subaquatique: {
    label: 'Sous l eau',
    background: '#0e3b52',
    fog: ['#0e3b52', 8, 42],
    ambient: 0.42,
    hemisphere: ['#7fd0e8', '#062a3c', 0.85],
    // Lumiere du jour filtree : elle vient du dessus, verticale et froide.
    key: { position: [1.5, 12, 2], intensity: 2.6, color: '#bfeaff' },
    fill: { position: [-6, 2, -5], intensity: 0.35, color: '#1d6c8e' },
    rim: { position: [0, -6, 4], intensity: 0.28, color: '#0a5a78' },
    chrome: false,
    shadowOpacity: 0.12,
    shadowSpread: 3,
  },
};

/**
 * Rendu de presentation.
 *
 * On rend la scene a la demande dans un tampon plus grand, on lit le pixel
 * tout de suite (sans `preserveDrawingBuffer`, qui couterait de la memoire a
 * chaque image), puis on rend la taille d'origine. Le fichier produit est un
 * PNG, telecharge tel quel.
 */
function PresentationShot({ signal, name }: { signal: number; name: string }) {
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera);
  const done = useRef(0);

  useEffect(() => {
    if (signal === done.current) return;
    done.current = signal;
    if (signal === 0) return;

    const size = new THREE.Vector2();
    gl.getSize(size);
    const ratio = gl.getPixelRatio();
    const target = 2400;
    const scale = Math.min(Math.max(target / Math.max(size.x, 1), 1), 4);

    gl.setPixelRatio(ratio * scale);
    gl.setSize(size.x, size.y, false);
    gl.render(scene, camera);
    const data = gl.domElement.toDataURL('image/png');
    gl.setPixelRatio(ratio);
    gl.setSize(size.x, size.y, false);
    gl.render(scene, camera);

    const link = document.createElement('a');
    link.href = data;
    link.download = `${name.replace(/[^\w-]+/g, '-').toLowerCase() || 'sakuma'}-rendu.png`;
    link.click();
  }, [signal, gl, scene, camera, name]);

  return null;
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

/** Force de la normal map d'ecailles : au-dela, le relief peint sonne faux. */
const NORMAL_SCALE = new THREE.Vector2(1, 1);

function LureModel({
  geo,
  params,
  xray,
  jointFocus = false,
  swingAngle = 0,
  interactive,
  onPointerDown,
  onPointerMove,
}: {
  geo: LureGeometry;
  params: LureParams;
  xray: boolean;
  /** Vrai quand l'articulation est selectionnee : le corps devient translucide. */
  jointFocus?: boolean;
  /** Angle d'oscillation du segment arriere, en radians. */
  swingAngle?: number;
  interactive?: boolean;
  onPointerDown?: (event: ThreeEvent<PointerEvent>) => void;
  onPointerMove?: (event: ThreeEvent<PointerEvent>) => void;
}) {
  const texture = useMemo(() => createPaintTexture(params), [params]);
  useEffect(() => () => texture.dispose(), [texture]);
  // Ecailles : normal map tant que le relief n'est pas cuit dans le maillage.
  // Les deux ensemble donneraient un relief compte deux fois.
  // Deux reliefs possibles, jamais les deux a la fois : les ecailles reelles
  // (qui partiront a l'export) priment sur le grain purement optique de la
  // livree, sinon le relief serait compte deux fois.
  const scaleMap = useMemo(
    () =>
      params.scales.enabled && !params.scales.baked
        ? createScaleNormalMap(params)
        : createLiveryNormalMap(params),
    [params],
  );
  useEffect(() => () => scaleMap?.dispose(), [scaleMap]);
  const finish = FINISHES[params.paint.finish];
  const livery = params.paint.livery;

  // Corps translucide bleute quand l'articulation est a l'etude : la
  // quincaillerie doit se lire A TRAVERS la matiere, sinon regler un joint
  // revient a travailler a l'aveugle.
  // Coque a paroi mince : le corps devient translucide pour laisser voir
  // l'insert, exactement comme le leurre fini. C'est du rendu, pas de la
  // geometrie — aucune masse, aucun volume, aucun verdict n'en depend.
  const shellView = params.shell.enabled && params.shell.transparency > 0.02;
  const seeThrough = xray || jointFocus || shellView;
  const bodySurface = {
    map: texture,
    normalMap: scaleMap,
    normalScale: scaleMap ? NORMAL_SCALE : undefined,
    flatShading: params.print.finish === 'faceted',
    roughness: finish.roughness,
    metalness: finish.metalness,
    // Film mince : la teinte se decale avec l'angle de vue, ce qui rend la
    // finition holographique sans texture d'environnement.
    // Irisation : la finition donne le socle, la livree l'amplifie. Ce sont
    // deux reglages distincts parce qu'ils repondent a deux questions
    // differentes — quel type de peinture, et combien d'irisation dessus.
    iridescence: Math.min(finish.iridescence + livery.iris.strength * 0.55, 1),
    iridescenceIOR: 1.3 + livery.iris.strength * 0.2,
    iridescenceThicknessRange: [120, 520] as [number, number],
    // Vernis : une vraie couche transparente par-dessus la peinture, avec sa
    // propre rugosite. C'est elle qui renvoie le reflet net de la source, et
    // c'est elle qui place les ecailles peintes SOUS le vernis.
    clearcoat: 0.25 + livery.varnish.thickness * 0.75,
    clearcoatRoughness: Math.max(0.02, (1 - livery.varnish.gloss) * 0.4),
    // La nacre du ventre : un lustre doux qui ne depend pas du metal.
    sheen: livery.pearl * 0.6,
    sheenRoughness: 0.5,
    sheenColor: new THREE.Color('#ffdada'),
    color: jointFocus ? '#a8c4e8' : '#ffffff',
    transparent: seeThrough,
    opacity: xray || jointFocus
      ? (jointFocus ? 0.34 : 0.28)
      : shellView
        ? 1 - livery.varnish.thickness * 0 - params.shell.transparency * 0.72
        : 1,
    depthWrite: !seeThrough,
    side: seeThrough ? THREE.DoubleSide : THREE.FrontSide,
  };

  return (
    <group>
      {/*
        Corps articule : le segment arriere pivote autour de l'axe de
        charniere pour montrer le debattement. La rotation est un simple
        affichage — la geometrie exportee reste au repos.
      */}
      {geo.segments && geo.jointPlan ? (
        <>
          <mesh geometry={geo.segments.front} castShadow={false}>
            <meshPhysicalMaterial {...bodySurface} />
          </mesh>
          <group position={[geo.jointPlan.xJoint, 0, 0]} rotation={[0, swingAngle, 0]}>
            <group position={[-geo.jointPlan.xJoint, 0, 0]}>
              <mesh geometry={geo.segments.rear} castShadow={false}>
                <meshPhysicalMaterial {...bodySurface} />
              </mesh>
            </group>
          </group>
        </>
      ) : (
        <mesh
          geometry={geo.body}
          castShadow={false}
          onPointerDown={interactive ? onPointerDown : undefined}
          onPointerMove={interactive ? onPointerMove : undefined}
        >
          <meshPhysicalMaterial {...bodySurface} />
        </mesh>
      )}

      <InsertPart params={params} />

      {geo.joint ? (
        <mesh geometry={geo.joint} renderOrder={6}>
          <meshStandardMaterial color="#b9bec7" roughness={0.3} metalness={0.92} />
        </mesh>
      ) : null}

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
    </group>
  );
}


/**
 * Hamecons et anneaux a l'echelle — module Q.4.
 *
 * Representation SIMPLIFIEE mais dimensionnee : hampe, courbure et pointes
 * suivent la longueur hors-tout de la ligne de catalogue. Le but n'est pas de
 * dessiner un hamecon, c'est de voir tout de suite si le triple touche le
 * corps, depasse la queue ou croise son voisin — les trois choses que le
 * controle de dimension signale par ecrit.
 */
function TackleMarkers({ params, visible }: { params: LureParams; visible: boolean }) {
  const profile = useMemo(() => createProfile(params), [params]);
  const mounts = useMemo(
    () =>
      params.mounts
        .filter((mount) => mount.visible)
        .map((mount) => resolveMount(params.catalogue, mount)),
    [params.mounts, params.catalogue],
  );
  if (!visible) return null;

  const MM = 0.1; // mm -> cm, l'unite de la scene

  return (
    <group>
      {mounts.map((entry) => {
        const { mount, ring, hook } = entry;
        if (!ring && !hook) return null;
        const p = Math.min(Math.max(mount.position, 0.02), profile.bodyEnd - 0.01);
        const x = profile.xAt(p);
        const section = profile.section(p);
        const surfaceY =
          mount.height < 0 ? section.bottom * -mount.height : section.top * mount.height;
        // Support de queue : la chaine part vers l'arriere (+x), pas vers le
        // bas. Le groupe bascule alors d'un quart de tour, et « vers le bas »
        // devient « vers l'arriere » dans son repere local.
        const trails = mountTrails(mount.position);
        const down = trails ? 1 : mount.height <= 0 ? -1 : 1;

        const ringR = ring ? (ring.spanMm * MM) / 2 : 0;
        const ringWire = ring ? (ring.wireMm * MM) / 2 : 0;
        // L'hamecon pend au bout de l'anneau.
        const hookTop = surfaceY + down * ringR * 2;
        const shank = hook ? hook.spanMm * MM * 0.6 : 0;
        const bendR = hook ? hook.spanMm * MM * 0.22 : 0;
        const wire = hook ? (hook.wireMm * MM) / 2 : 0;
        const points = hook?.family === 'treble' ? 3 : 1;

        // Le groupe entier bascule d'un quart de tour pour un support de queue :
        // la meme construction sert alors a l'horizontale.
        return (
          <group
            key={mount.id}
            position={[x, trails ? surfaceY : 0, 0]}
            rotation={trails ? [0, 0, -Math.PI / 2] : [0, 0, 0]}
          >
            {ring ? (
              <mesh
                position={trails ? [0, ringR, 0] : [0, surfaceY + down * ringR, 0]}
                rotation={[0, Math.PI / 2, 0]}
              >
                <torusGeometry args={[ringR, Math.max(ringWire, 0.005), 8, 24]} />
                <meshStandardMaterial color="#c2c8d0" roughness={0.28} metalness={0.95} />
              </mesh>
            ) : null}

            {hook ? (
              <group position={[0, trails ? ringR * 2 : hookTop, 0]}>
                {/* Hampe */}
                <mesh position={[0, (down * shank) / 2, 0]}>
                  <cylinderGeometry args={[Math.max(wire, 0.004), Math.max(wire, 0.004), shank, 8]} />
                  <meshStandardMaterial color="#b9bec7" roughness={0.3} metalness={0.94} />
                </mesh>
                {Array.from({ length: points }, (_, i) => {
                  // Rotation autour de la hampe : trois pointes a 120 degres.
                  const angle = (i / points) * Math.PI * 2;
                  return (
                    <group
                      key={i}
                      position={[0, down * shank, 0]}
                      rotation={[0, angle, 0]}
                    >
                      {/* Courbure : un demi-tore ouvert vers la pointe. */}
                      <mesh position={[bendR, 0, 0]} rotation={[Math.PI / 2, 0, 0]}>
                        <torusGeometry
                          args={[bendR, Math.max(wire, 0.004), 6, 14, Math.PI * 1.1]}
                        />
                        <meshStandardMaterial color="#b9bec7" roughness={0.3} metalness={0.94} />
                      </mesh>
                      {/* Pointe */}
                      <mesh
                        position={[bendR * 2, -down * bendR * 0.5, 0]}
                        rotation={[0, 0, down > 0 ? Math.PI : 0]}
                      >
                        <coneGeometry args={[Math.max(wire, 0.004) * 1.6, bendR * 0.9, 8]} />
                        <meshStandardMaterial color="#d8dce2" roughness={0.24} metalness={0.96} />
                      </mesh>
                    </group>
                  );
                })}
              </group>
            ) : null}
          </group>
        );
      })}
    </group>
  );
}


/**
 * Insert interne — module O.2.
 *
 * Il se voit A TRAVERS la coque translucide : c'est tout le point de cette
 * famille de leurres, et c'est aussi le seul moyen de verifier d'un coup
 * d'oeil qu'il tient dans la cavite.
 */
function InsertPart({ params }: { params: LureParams }) {
  const part = useMemo(() => {
    if (!params.shell.enabled || !params.insert.enabled) return null;
    const profile = createProfile(params);
    const cavity = measureCavity(profile, params, { lengthSegments: 96, radialSegments: 48 });
    if (insertBlocker(params, cavity)) return null;
    return buildInsert(profile, params, cavity);
  }, [params]);
  useEffect(() => () => part?.geometry.dispose(), [part]);
  if (!part) return null;

  return (
    <mesh geometry={part.geometry} renderOrder={4}>
      <meshPhysicalMaterial
        color="#d7dee6"
        roughness={0.12}
        metalness={0.94}
        clearcoat={0.6}
        side={THREE.DoubleSide}
      />
    </mesh>
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
  params,
  spread,
}: {
  assembly: AssemblyResult;
  params: LureParams;
  spread: number;
}) {
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
  /** Vrai quand l'articulation est selectionnee dans l'arbre de scene. */
  jointFocus?: boolean;
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
  jointFocus = false,
}: Viewport3DProps) {
  const reducedMotion = useReducedMotion();
  const [view, setView] = useState<ViewId>('iso');
  const [fitSignal, setFitSignal] = useState(0);
  const [showMarkers, setShowMarkers] = useState(true);
  const [xray, setXray] = useState(false);
  const [floatView, setFloatView] = useState(false);
  const [exploded, setExploded] = useState(false);
  const [showSockets, setShowSockets] = useState(true);
  // Environnement d'apercu : purement visuel, il ne touche a aucune geometrie.
  const [env, setEnv] = useState<PreviewEnv>('atelier');
  const [shotSignal, setShotSignal] = useState(0);
  const [showTackle, setShowTackle] = useState(true);
  // Previsualisation du debattement : le segment arriere oscille dans les
  // limites calculees, ce qui rend le reglage lisible d'un coup d'oeil.
  const [animateSwing, setAnimateSwing] = useState(false);
  const [swingAngle, setSwingAngle] = useState(0);
  const dragging = useRef<string | null>(null);

  const swingLimit = geo.jointPlan ? THREE.MathUtils.degToRad(geo.jointPlan.swing) / 2 : 0;
  useEffect(() => {
    if (!animateSwing || swingLimit <= 0 || reducedMotion) {
      setSwingAngle(0);
      return;
    }
    let frame = 0;
    const start = performance.now();
    const tick = () => {
      const t = (performance.now() - start) / 1000;
      setSwingAngle(Math.sin(t * 1.8) * swingLimit);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [animateSwing, swingLimit, reducedMotion]);

  const radius =
    Math.hypot(geo.bounds.length, geo.bounds.height, geo.bounds.width) / 20 || 5;
  const groundY = -geo.bounds.height / 20 - 0.9;
  const scenery = ENVIRONMENTS[env];
  // Les reperes CG/CP, les portees et les lests sont des aides de travail :
  // ils disparaissent des vues de presentation sans que l'utilisateur ait a
  // decocher quoi que ce soit, et reviennent des le retour a l'atelier.
  const workAids = env === 'atelier';
  const shotName = `sakuma-${params.shape}`;
  // L'assemblage n'est calcule que lorsqu'il sert : vue eclatee, apercu des
  // portees ou placement d'ancrages.
  const hasCavity = params.rattles.length > 0 || params.chamber.enabled;
  const needsAssembly =
    assemblyActive(params) && (exploded || showSockets || placing || hasCavity);
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
          <color attach="background" args={[scenery.background]} />
          {scenery.fog ? <fog attach="fog" args={scenery.fog} /> : null}
          <CameraRig radius={radius} view={view} fitSignal={fitSignal + fitKey} />

          <ambientLight intensity={scenery.ambient} />
          <hemisphereLight args={scenery.hemisphere} />
          <directionalLight
            position={scenery.key.position}
            intensity={scenery.key.intensity}
            color={scenery.key.color}
          />
          <directionalLight
            position={scenery.fill.position}
            intensity={scenery.fill.intensity}
            color={scenery.fill.color}
          />
          <pointLight
            position={scenery.rim.position}
            intensity={scenery.rim.intensity}
            color={scenery.rim.color}
          />
          <PresentationShot signal={shotSignal} name={shotName} />

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
              <ExplodedAssembly assembly={assembly} params={params} spread={radius * 0.55} />
            ) : (
              <LureModel
                geo={geo}
                params={params}
                xray={xray}
                jointFocus={jointFocus}
                swingAngle={swingAngle}
                interactive={placing}
                onPointerDown={(event) => handleSurfacePointer(event, true)}
                onPointerMove={(event) => handleSurfacePointer(event, false)}
              />
            )}
            {assembly && showSockets && workAids ? <SocketPreview assembly={assembly} /> : null}
            <Rattles assembly={assembly} visible={workAids && (showMarkers || xray)} />
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
            <Ballasts
              geo={geo}
              visible={workAids && (showMarkers || xray)}
              overlay={workAids && showMarkers && !xray}
            />
            <BalanceMarkers physics={physics} radius={radius} visible={workAids && showMarkers} />
            {/* Les hamecons restent visibles en presentation : ils font partie
                du leurre fini, contrairement aux reperes de travail. */}
            <TackleMarkers params={params} visible={showTackle} />
          </group>

          {/* Sous l'eau il n'y a pas de surface a montrer sous le nez du
              leurre, et en studio la grille tuerait le fond blanc. */}
          {scenery.chrome ? <WaterPlane y={waterY} radius={radius} /> : null}

          {scenery.chrome ? (
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
          ) : null}
          {/* L'ombre de contact est posee sur un plan opaque : elle a du sens
              au-dessus de la grille d'atelier, elle ferait une carte grise sur
              un fond de studio. Les photos de catalogue n'en ont pas — on
              n'en met pas. */}
          {scenery.chrome ? (
            <ContactShadows
              position={[0, groundY + 0.02, 0]}
              opacity={scenery.shadowOpacity}
              scale={Math.max(radius * scenery.shadowSpread, 8)}
              blur={2.6}
              far={Math.max(radius * 3, 8)}
            />
          ) : null}

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
        <div className="segmented" role="group" aria-label="Environnement d apercu">
          {(Object.keys(ENVIRONMENTS) as PreviewEnv[]).map((id) => (
            <button
              key={id}
              type="button"
              aria-pressed={env === id}
              title={`Environnement ${ENVIRONMENTS[id].label}`}
              onClick={() => setEnv(id)}
            >
              {ENVIRONMENTS[id].label}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="toolbtn"
          title="Enregistre une image haute resolution de la vue courante"
          onClick={() => {
            // Le rendu de presentation suppose la vue studio : on y bascule
            // plutot que de livrer une image avec la grille de travail.
            setEnv('studio');
            setShotSignal((n) => n + 1);
          }}
        >
          Rendu
        </button>
        <button
          type="button"
          className="toolbtn"
          aria-pressed={showTackle}
          title="Affiche hamecons et anneaux a l echelle du catalogue"
          onClick={() => setShowTackle((value) => !value)}
        >
          Hamecons
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
        <button
          type="button"
          className="toolbtn"
          aria-pressed={animateSwing}
          disabled={!geo.jointPlan || geo.jointPlan.swing <= 0}
          title={
            geo.jointPlan
              ? `Debat d environ ${(geo.jointPlan.swing / 2).toFixed(0)} deg de chaque cote`
              : 'Ajoutez une articulation pour animer le debattement'
          }
          onClick={() => setAnimateSwing((value) => !value)}
        >
          Animer le joint
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
