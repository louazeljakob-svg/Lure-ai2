/**
 * Fiche de montage — module AP.2.
 *
 * Tout ce qui ne sort PAS dans un STL mais entre dans le leurre : visserie,
 * goupilles en 8, billes, lests, fil traversant, perle achetee, hamecons,
 * anneaux, plaque de bavette. Et, en face, la liste des pieces imprimees.
 *
 * La fiche se lit sur l'assemblage reellement retenu : une vis refusee ou
 * une chambre de billes refusee n'y figure pas, puisqu'elle ne sera pas
 * montee. Les masses sont celles du bilan ; celles de catalogue gardent
 * leur provenance.
 */

import type { LureParams } from '../types/lure';
import type { AssemblyResult } from './assembly';
import { assemblyActive } from './assembly';
import { ballastMarkers, type LureGeometry } from './geometry';
import { createProfile } from './profile';
import { planThroughWire, propellerActive, throughWireBlocker, WIRE_MATERIAL_LABEL } from './throughWire';
import { findTackle } from './tackle';
import { BOUGHT_BEAD_DENSITY } from './propeller';

export interface MontageLine {
  /** Designation, telle qu'on la commande ou qu'on la cherche en boite. */
  item: string;
  qty: number;
  /** Cote utile, matiere, emplacement. */
  detail: string;
  /** Masse unitaire, en g, si elle est connue. */
  massG: number | null;
}

export interface MontageSheet {
  /** Quincaillerie a prevoir : achetee, jamais imprimee. */
  hardware: MontageLine[];
  /** Pieces imprimees, une par fichier STL. */
  printed: MontageLine[];
}

const fmt = (value: number) => value.toFixed(value < 10 ? 1 : 0);

export function montageSheet(params: LureParams, geo: LureGeometry, assembly: AssemblyResult | null): MontageSheet {
  const hardware: MontageLine[] = [];
  const printed: MontageLine[] = [];
  const profile = createProfile(params);
  const split = assemblyActive(params) && assembly !== null;

  // --- Visserie ------------------------------------------------------------
  if (split) {
    const screws = new Map<string, { qty: number; mass: number; where: string[] }>();
    for (const screw of assembly.screws) {
      if (!screw.valid) continue;
      const head = screw.head === 'countersunk' ? 'tete fraisee' : 'tete cylindrique';
      const key = `Vis ${screw.spec.size} x ${screw.lengthMm} mm ${head} + ecrou hexagonal ${screw.spec.size}`;
      const entry = screws.get(key) ?? { qty: 0, mass: screw.massG, where: [] };
      entry.qty += 1;
      entry.where.push(`${fmt((screw.x - profile.xAt(0)) * 10)} mm`);
      screws.set(key, entry);
    }
    for (const [item, entry] of screws) {
      hardware.push({
        item,
        qty: entry.qty,
        detail: `inox, entree par le ventre, ecrou captif ; a ${entry.where.join(', ')} du nez`,
        massG: entry.mass,
      });
    }

    // --- Goupilles en 8 ------------------------------------------------------
    const pins = new Map<string, { qty: number; where: string[] }>();
    for (const socket of assembly.sockets) {
      if (!socket.valid) continue;
      const key = `Goupille en 8 ${socket.spec.label}`;
      const entry = pins.get(key) ?? { qty: 0, where: [] };
      entry.qty += 1;
      entry.where.push(socket.anchorId);
      pins.set(key, entry);
    }
    for (const [item, entry] of pins) {
      const spec = assembly.sockets.find((s) => `Goupille en 8 ${s.spec.label}` === item)!.spec;
      hardware.push({
        item,
        qty: entry.qty,
        detail: `fil ${spec.wire.toFixed(2)} mm, ${spec.length.toFixed(1)} mm hors-tout ; ancrages ${entry.where.join(', ')}`,
        massG: null,
      });
    }

    // --- Billes de la chambre ----------------------------------------------
    const chamber = assembly.chamber;
    if (chamber && chamber.valid) {
      hardware.push({
        item: `Bille acier inox ${(chamber.ballRadius * 20).toFixed(1)} mm`,
        qty: chamber.count,
        detail: `chambre de ${(chamber.radius * 20).toFixed(1)} mm, jeu ${chamber.fitMm.toFixed(2)} mm, course ${chamber.travelMm.toFixed(1)} mm ; jamais imprimees`,
        massG: chamber.massEach,
      });
    }
  }

  // --- Lests ----------------------------------------------------------------
  const markers = ballastMarkers(profile, params.ballasts, params.ballastDensity);
  for (const marker of markers) {
    const seat = assembly?.ballastSeats.find((s) => s.id === marker.id);
    if (seat && !seat.valid) continue;
    const size =
      marker.shape === 'cylinder'
        ? `cylindre ${(marker.radius * 20).toFixed(1)} x ${(marker.length * 10).toFixed(1)} mm`
        : `bille ${(marker.radius * 20).toFixed(1)} mm`;
    hardware.push({
      item: `Lest ${params.ballastDensity >= 11 ? 'plomb' : 'metal'} ${marker.mass.toFixed(1)} g`,
      qty: 1,
      detail: `${size}, a ${fmt((marker.position[0] - profile.xAt(0)) * 10)} mm du nez`,
      massG: marker.mass,
    });
  }

  // --- Fil traversant, axe d'helice et perle ---------------------------------
  if (params.throughWire.enabled && !throughWireBlocker(params)) {
    const wire = planThroughWire(params, profile.lengthCm);
    hardware.push({
      item: `Fil ${WIRE_MATERIAL_LABEL[params.throughWire.material]} ${params.throughWire.wireMm.toFixed(1)} mm`,
      qty: 1,
      detail:
        `${fmt(wire.wireLengthCm * 10)} mm developpes, boucles de ${params.throughWire.loopMm.toFixed(1)} mm` +
        (wire.extensionCm > 0 ? ` ; dont ${fmt(wire.extensionCm * 10)} mm d axe d helice derriere la queue` : ''),
      massG: wire.massG,
    });
  }
  if (propellerActive(params) && geo.propeller) {
    const plan = geo.propeller.plan;
    if (!params.propeller.beadPrinted) {
      hardware.push({
        item: `Perle d espacement ${params.propeller.beadDiameter.toFixed(1)} mm`,
        qty: 1,
        detail: `alesage ${(plan.boreRadius * 20).toFixed(2)} mm mini ; verre ou laiton (masse estimee a ${BOUGHT_BEAD_DENSITY} g/cm3)`,
        massG: geo.propeller.beadMass.massG,
      });
    }
    printed.push({
      item: `Helice ${params.propeller.blades} pale${params.propeller.blades > 1 ? 's' : ''}`,
      qty: 1,
      detail: `${params.propeller.diameter.toFixed(1)} mm, pale a ${params.propeller.bladeAngle.toFixed(0)} deg, alesage ${(plan.boreRadius * 20).toFixed(2)} mm, imprimee pleine`,
      massG: geo.propeller.propellerMass.massG,
    });
    if (params.propeller.beadPrinted) {
      printed.push({
        item: `Perle d espacement ${params.propeller.beadDiameter.toFixed(1)} mm`,
        qty: 1,
        detail: `alesage ${(plan.boreRadius * 20).toFixed(2)} mm, imprimee pleine`,
        massG: geo.propeller.beadMass.massG,
      });
    }
  }

  // --- Hamecons et anneaux -------------------------------------------------
  const tackle = new Map<string, { qty: number; mass: number; note: string }>();
  for (const mount of params.mounts) {
    for (const id of [mount.hookId, mount.ringId]) {
      const item = findTackle(params.catalogue, id);
      if (!item) continue;
      const key = `${item.series} ${item.size}`;
      const entry = tackle.get(key) ?? { qty: 0, mass: item.massG, note: item.source === 'verifie' ? 'masse verifiee' : 'masse de catalogue' };
      entry.qty += 1;
      tackle.set(key, entry);
    }
  }
  for (const [item, entry] of tackle) hardware.push({ item, qty: entry.qty, detail: entry.note, massG: entry.mass });

  // --- Bavette ---------------------------------------------------------------
  if (params.hasBib) {
    if (params.billMode === 'polycarbonate') {
      hardware.push({
        item: `Plaque polycarbonate ${params.billThickness.toFixed(1)} mm`,
        qty: 1,
        detail: `bavette ${params.bibLength.toFixed(1)} x ${params.bibWidth.toFixed(1)} mm, decoupee d apres le gabarit DXF / SVG`,
        massG: null,
      });
    } else {
      printed.push({ item: 'Bavette', qty: 1, detail: `imprimee, ${params.billThickness.toFixed(1)} mm`, massG: null });
    }
  }

  // --- Pieces imprimees --------------------------------------------------------
  if (split) {
    printed.unshift(
      {
        item: 'Coque male',
        qty: 1,
        detail: `ergots et goujons de retention en relief (${params.assembly.pegs.height.toFixed(1)} mm)`,
        massG: null,
      },
      { item: 'Coque femelle', qty: 1, detail: 'face de joint plane, logements correspondants', massG: null },
    );
  } else {
    printed.unshift({ item: 'Corps', qty: 1, detail: 'd un seul tenant', massG: null });
  }

  return { hardware, printed };
}
