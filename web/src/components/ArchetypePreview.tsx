/**
 * Apercu 3D d'un archetype — module N.
 *
 * C'est le VRAI corps genere qui est rendu, pas une icone : la carte montre
 * exactement ce que le generateur produira au chargement.
 *
 * Un contexte WebGL par carte serait le reflexe, et c'est une erreur : dix
 * contextes coutent des secondes a l'ouverture et le navigateur en plafonne
 * le nombre, si bien que la vue 3D de l'editeur pourrait ne plus s'ouvrir.
 * On rend donc chaque archetype UNE FOIS dans un rendu hors-ecran partage,
 * on garde l'image, et la grille n'affiche que des images.
 */

import { useEffect, useState } from 'react';
import * as THREE from 'three';
import type { LureParams } from '../types/lure';
import { buildLure, PREVIEW_RESOLUTION } from '../lib/geometry';
import { createPaintTexture } from '../lib/paint';

const WIDTH = 560;
const HEIGHT = 320;

let renderer: THREE.WebGLRenderer | null = null;
const cache = new Map<string, string>();

/** Rendu partage, cree a la premiere demande et jamais duplique. */
function getRenderer(): THREE.WebGLRenderer | null {
  if (renderer) return renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true,
    });
    renderer.setSize(WIDTH, HEIGHT, false);
    renderer.setPixelRatio(1);
    return renderer;
  } catch {
    // Pas de WebGL disponible : la carte retombe sur son fond, sans casser.
    return null;
  }
}

function renderThumb(params: LureParams): string | null {
  const gl = getRenderer();
  if (!gl) return null;

  const geo = buildLure(params, PREVIEW_RESOLUTION.low);
  const scene = new THREE.Scene();

  const group = new THREE.Group();
  group.rotation.set(0, -0.5, 0.1);

  // La livree du preset est peinte pour de bon : la carte montre la forme ET
  // la finition que le chargement produira. Le cout tient dans les quelques
  // millisecondes d'un seul rendu, puisque l'image est ensuite gardee.
  const texture = createPaintTexture(params);
  const bodyMat = new THREE.MeshPhysicalMaterial({
    map: texture,
    roughness: 0.3,
    metalness: 0.12,
    clearcoat: 0.7,
    clearcoatRoughness: 0.14,
  });
  group.add(new THREE.Mesh(geo.body, bodyMat));

  const finMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(params.paint.dorsal),
    roughness: 0.45,
    side: THREE.DoubleSide,
  });
  if (geo.tail) group.add(new THREE.Mesh(geo.tail, finMat));
  if (geo.bib) {
    group.add(
      new THREE.Mesh(
        geo.bib,
        new THREE.MeshStandardMaterial({
          color: '#8fbcd8',
          roughness: 0.1,
          transparent: true,
          opacity: 0.6,
          side: THREE.DoubleSide,
        }),
      ),
    );
  }
  scene.add(group);

  scene.add(new THREE.AmbientLight(0xffffff, 1));
  scene.add(new THREE.HemisphereLight(0xffffff, 0xc8ced6, 0.85));
  const key = new THREE.DirectionalLight(0xffffff, 2.4);
  key.position.set(3, 5, 4);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xe6eefa, 0.7);
  fill.position.set(-4, 2, -3);
  scene.add(fill);

  // Cadrage calcule sur la boite reelle du groupe, pas devine : chaque
  // archetype remplit la meme fraction de l'image quelle que soit sa taille,
  // de sorte qu'on les compare sur leur SILHOUETTE et non sur leur echelle.
  const box = new THREE.Box3().setFromObject(group);
  const size = new THREE.Vector3();
  const centre = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(centre);
  group.position.sub(centre);

  const camera = new THREE.PerspectiveCamera(26, WIDTH / HEIGHT, 0.01, 1000);
  const fovRad = (camera.fov * Math.PI) / 180;
  // Distance minimale qui contient la boite en hauteur ET en largeur.
  const distH = size.y / 2 / Math.tan(fovRad / 2);
  const distW = size.x / 2 / Math.tan(fovRad / 2) / camera.aspect;
  const distance = Math.max(distH, distW, 0.1) * 1.16 + size.z;
  camera.position.set(distance * 0.08, distance * 0.16, distance);
  camera.lookAt(0, 0, 0);

  gl.render(scene, camera);
  const url = gl.domElement.toDataURL('image/png');

  geo.dispose();
  texture.dispose();
  bodyMat.dispose();
  finMat.dispose();
  return url;
}

export function ArchetypePreview({ params, label }: { params: LureParams; label: string }) {
  const [url, setUrl] = useState<string | null>(() => cache.get(params.shape) ?? null);

  useEffect(() => {
    if (cache.has(params.shape)) {
      setUrl(cache.get(params.shape) ?? null);
      return;
    }
    // Rendu differe d'une image : la grille s'affiche tout de suite et se
    // remplit ensuite, au lieu de bloquer l'ouverture de la page.
    const id = window.requestAnimationFrame(() => {
      const next = renderThumb(params);
      if (next) {
        cache.set(params.shape, next);
        setUrl(next);
      }
    });
    return () => window.cancelAnimationFrame(id);
  }, [params]);

  return (
    <div className="archetype__canvas">
      {url ? <img src={url} alt={`Apercu 3D : ${label}`} loading="lazy" /> : null}
    </div>
  );
}
