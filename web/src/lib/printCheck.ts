/**
 * Controle d'impression.
 *
 * Les verifications portent sur ce qui se voit REELLEMENT dans le maillage
 * livre — etancheite mesuree arete par arete, epaisseur de paroi lue sur la
 * section la plus fine, surplombs deduits de la pente de la surface — plutot
 * que sur des regles decoratives. Une coche verte doit valoir quelque chose.
 */

import * as THREE from 'three';
import type { LureParams } from '../types/lure';
import { printedBodies, type LureGeometry } from './geometry';
import { createProfile, MM_TO_CM } from './profile';

export interface PrintCheck {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
}

/**
 * Aretes dirigees non appariees.
 *
 * Le critere est plus severe qu'un simple comptage d'aretes : chaque arete
 * orientee doit apparaitre exactement une fois, ce qui attrape aussi les
 * faces retournees, invisibles a l'oeil et fatales a la trancheuse.
 */
function openEdges(geometry: THREE.BufferGeometry): number {
  const position = geometry.getAttribute('position');
  const index = geometry.getIndex();
  const count = index ? index.count : position.count;
  const key = (i: number) =>
    `${Math.round(position.getX(i) * 1e4)},${Math.round(position.getY(i) * 1e4)},${Math.round(
      position.getZ(i) * 1e4,
    )}`;
  const seen = new Map<string, number>();
  for (let i = 0; i < count; i += 3) {
    const v = [0, 1, 2].map((t) => key(index ? index.getX(i + t) : i + t));
    if (v[0] === v[1] || v[1] === v[2] || v[0] === v[2]) continue;
    for (let t = 0; t < 3; t++) {
      const edge = `${v[t]}|${v[(t + 1) % 3]}`;
      seen.set(edge, (seen.get(edge) ?? 0) + 1);
    }
  }
  let open = 0;
  for (const [edge, n] of seen) {
    const [a, b] = edge.split('|');
    if ((seen.get(`${b}|${a}`) ?? 0) !== n) open++;
  }
  return open;
}

/**
 * Part de la surface reellement en surplomb.
 *
 * Relever la pente MAXIMALE ne dit rien : tout corps arrondi pose a plat a
 * forcement une tangente verticale a son equateur, et le controle
 * echouerait sur chaque leurre. Ce qui compte est la PROPORTION de surface
 * trop inclinee pour se deposer sur la couche precedente — au-dela de 45
 * degres depuis l'horizontale, dans la convention des trancheuses.
 */
function overhangShare(geometry: THREE.BufferGeometry): number {
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  const index = geometry.getIndex();
  if (!normal) return 0;
  const count = index ? index.count : position.count;
  let total = 0;
  let steep = 0;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (let i = 0; i < count; i += 3) {
    const k = [0, 1, 2].map((t) => (index ? index.getX(i + t) : i + t));
    a.fromBufferAttribute(position, k[0]);
    b.fromBufferAttribute(position, k[1]);
    c.fromBufferAttribute(position, k[2]);
    const area = b.clone().sub(a).cross(c.clone().sub(a)).length() / 2;
    if (area < 1e-9) continue;
    total += area;
    // Moyenne des normales du triangle : -Y regarde le plateau.
    const ny =
      (normal.getY(k[0]) + normal.getY(k[1]) + normal.getY(k[2])) / 3;
    if (ny < -Math.SQRT1_2) steep += area;
  }
  return total > 0 ? steep / total : 0;
}

export function runPrintChecks(params: LureParams, geo: LureGeometry): PrintCheck[] {
  const parts = printedBodies(geo);
  const open = parts.reduce((sum, part) => sum + openEdges(part), 0);

  // Paroi la plus mince : la section la plus etroite du corps, moins ce que
  // les logements internes viennent y prendre.
  const profile = createProfile(params);
  let thinnest = Infinity;
  for (let i = 1; i < 60; i++) {
    const p = (i / 60) * profile.bodyEnd;
    const section = profile.section(p);
    const girth = Math.min(section.halfWidth * 2, section.top - section.bottom);
    if (girth > 0.02) thinnest = Math.min(thinnest, girth);
  }
  const thinnestMm = thinnest === Infinity ? 0 : thinnest / MM_TO_CM;
  const nozzleWall = params.print.perimeters * 0.4;
  const wallOk = thinnestMm >= nozzleWall * 2;

  // Imprime en deux moities, chaque coque repose sur son plan de joint :
  // il n'y a alors plus de surplomb du tout.
  const share = params.assembly.enabled
    ? 0
    : parts.reduce((worst, part) => Math.max(worst, overhangShare(part)), 0);
  const supportFree = share <= 0.12;

  const layers = Math.round(
    (params.thickness * (params.print.process === 'fdm' ? 1 : 1)) /
      Math.max(params.print.layerHeight, 0.01),
  );

  return [
    {
      id: 'watertight',
      label: 'Etancheite du maillage',
      ok: open === 0,
      detail:
        open === 0
          ? 'Toutes les aretes sont appariees : le solide est ferme.'
          : `${open} aretes ouvertes. La trancheuse risque de boucher les trous a sa facon.`,
    },
    {
      id: 'wall',
      label: 'Epaisseur de paroi minimale',
      ok: wallOk,
      detail: wallOk
        ? `Section la plus fine ${thinnestMm.toFixed(1)} mm, pour ${nozzleWall.toFixed(1)} mm de parois de chaque cote.`
        : `Section la plus fine ${thinnestMm.toFixed(1)} mm : ${params.print.perimeters} parois en demandent ${(nozzleWall * 2).toFixed(1)} mm. Epaississez le corps ou reduisez les parois.`,
    },
    {
      id: 'overhang',
      label: 'Parties en surplomb',
      ok: supportFree,
      detail: params.assembly.enabled
        ? 'Chaque coque repose sur son plan de joint : aucun surplomb a soutenir.'
        : share <= 0.12
          ? `${(share * 100).toFixed(0)} % de la surface depasse 45 deg : impression sans support.`
          : `${(share * 100).toFixed(0)} % de la surface depasse 45 deg. Prevoyez des supports, ou imprimez le corps en deux moities posees sur leur plan de joint.`,
    },
    {
      id: 'manifold',
      label: 'Geometrie non manifold',
      ok: open === 0,
      detail:
        open === 0
          ? 'Chaque arete dirigee apparait une seule fois : aucune face retournee.'
          : 'Des aretes se comptent deux fois dans le meme sens : une face est retournee.',
    },
    {
      id: 'layers',
      label: 'Nombre de couches',
      ok: layers >= 20,
      detail:
        layers >= 20
          ? `${layers} couches a ${params.print.layerHeight.toFixed(2)} mm.`
          : `${layers} couches seulement : baissez la hauteur de couche pour arrondir la forme.`,
    },
  ];
}
