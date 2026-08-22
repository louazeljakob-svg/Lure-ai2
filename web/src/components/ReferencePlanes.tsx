/** Rendu des images de reference dans la scene 3D. */

import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import type { ReferenceImage } from '../lib/reference';

interface Props {
  references: ReferenceImage[];
  radius: number;
  /** En calibration, le plan devient cliquable pour pointer les reperes. */
  calibratingId?: string | null;
  onPick?: (id: string, u: number, v: number) => void;
}

function useTexture(src: string): THREE.Texture | null {
  const texture = useMemo(() => {
    const loaded = new THREE.TextureLoader().load(src);
    loaded.colorSpace = THREE.SRGBColorSpace;
    return loaded;
  }, [src]);
  useEffect(() => () => texture.dispose(), [texture]);
  return texture;
}

function ReferencePlane({
  image,
  calibrating,
  onPick,
}: {
  image: ReferenceImage;
  calibrating: boolean;
  onPick?: (id: string, u: number, v: number) => void;
}) {
  const texture = useTexture(image.src);
  if (!image.visible || !texture) return null;

  const width = image.widthMm * 0.1;
  const height = image.heightMm * 0.1;
  const depth = image.depth * 0.1;
  const offsetX = image.offsetX * 0.1;
  const offsetY = image.offsetY * 0.1;
  const spin = THREE.MathUtils.degToRad(image.angle);

  // Le plan par defaut de Three est dans XY, normale +Z.
  const rotation: [number, number, number] =
    image.plane === 'profile'
      ? [0, 0, spin]
      : image.plane === 'top'
        ? [-Math.PI / 2, 0, spin]
        : [0, Math.PI / 2, spin];
  const position: [number, number, number] =
    image.plane === 'profile'
      ? [offsetX, offsetY, depth]
      : image.plane === 'top'
        ? [offsetX, depth, offsetY]
        : [depth, offsetY, offsetX];

  return (
    <mesh
      position={position}
      rotation={rotation}
      scale={[image.flipH ? -1 : 1, image.flipV ? -1 : 1, 1]}
      // Hors calibration, la reference est ignoree par le lancer de rayon :
      // le placement d'ancrage doit viser le leurre, pas l'image.
      raycast={calibrating ? undefined : () => null}
      onPointerDown={(event) => {
        if (!calibrating || !onPick || !event.uv) return;
        event.stopPropagation();
        onPick(image.id, event.uv.x, 1 - event.uv.y);
      }}
    >
      <planeGeometry args={[width, height]} />
      <meshBasicMaterial
        map={texture}
        transparent
        opacity={image.opacity}
        side={THREE.DoubleSide}
        depthWrite={false}
        toneMapped={false}
      />
    </mesh>
  );
}

export function ReferencePlanes({ references, calibratingId, onPick }: Props) {
  return (
    <group>
      {references.map((image) => (
        <ReferencePlane
          key={image.id}
          image={image}
          calibrating={calibratingId === image.id}
          onPick={onPick}
        />
      ))}
    </group>
  );
}
