/**
 * Catalogue de quincaillerie pesee — module Q.
 *
 * Le but de ce fichier n'est PAS d'etre exact. Les masses d'hamecons et
 * d'anneaux varient fortement d'une serie a l'autre, d'un calibre de fil a
 * l'autre (standard, 2X, 3X, 4X) et d'un revetement a l'autre : personne ne
 * peut publier une table universelle, et ce serait mentir que de pretendre
 * le contraire.
 *
 * Le but est que l'application soit utilisable TOUT DE SUITE avec des ordres
 * de grandeur honnetes, et corrigeable ensuite ligne par ligne — a la main,
 * par import CSV d'une charte fournisseur, ou en posant l'hamecon sur une
 * balance. Chaque ligne porte donc sa provenance, et le bilan de masse la
 * repete.
 */

import type { TackleFamily, TackleItem, TackleMount, TackleSource } from '../types/lure';

export const TACKLE_FAMILY_LABEL: Record<TackleFamily, string> = {
  treble: 'Triple',
  inline: 'Simple inline',
  assist: 'Simple assist',
  split: 'Anneau brise',
  solid: 'Anneau soude',
  swivel: 'Emerillon',
};

/** Vrai pour les familles qui portent le poisson, fausse pour les liaisons. */
export const isHook = (family: TackleFamily): boolean =>
  family === 'treble' || family === 'inline' || family === 'assist';

/** Conversion officielle : 1 kg = 2,20462 lb. */
export const kgToLb = (kg: number): number => kg * 2.20462;

interface Seed {
  family: TackleFamily;
  series: string;
  rows: [size: string, wireMm: number, massG: number, strengthKg: number, spanMm: number][];
}

/**
 * Valeurs de depart.
 *
 * Les sept premieres lignes de triple sont celles citees en exemple dans la
 * specification ; le reste suit la meme progression, qui est celle d'une
 * serie de force standard. TOUTES sont marquees « indicatif ».
 */
const SEEDS: Seed[] = [
  {
    family: 'treble',
    series: 'Triple force standard',
    rows: [
      ['#8', 0.66, 0.38, 3.5, 10],
      ['#6', 0.76, 0.6, 5, 12],
      ['#4', 0.89, 1.0, 7, 15],
      ['#2', 1.04, 1.6, 9, 18],
      ['#1', 1.14, 2.1, 11, 20],
      ['1/0', 1.24, 2.7, 14, 23],
      ['2/0', 1.37, 3.5, 18, 26],
      ['3/0', 1.5, 4.6, 23, 30],
      ['4/0', 1.65, 6.0, 29, 34],
      ['5/0', 1.8, 7.6, 36, 39],
    ],
  },
  {
    family: 'treble',
    series: 'Triple renforce 4X',
    rows: [
      ['#4', 1.1, 1.5, 12, 15],
      ['#2', 1.3, 2.4, 16, 18],
      ['#1', 1.45, 3.1, 20, 20],
      ['1/0', 1.6, 4.1, 26, 23],
      ['2/0', 1.75, 5.3, 33, 26],
      ['3/0', 1.95, 7.0, 42, 30],
      ['4/0', 2.15, 9.1, 52, 34],
    ],
  },
  {
    family: 'inline',
    series: 'Simple inline force standard',
    rows: [
      ['#4', 0.95, 0.5, 8, 16],
      ['#2', 1.1, 0.8, 11, 19],
      ['#1', 1.2, 1.1, 14, 22],
      ['1/0', 1.35, 1.5, 18, 25],
      ['2/0', 1.5, 2.0, 23, 29],
      ['3/0', 1.65, 2.6, 29, 33],
      ['4/0', 1.85, 3.4, 37, 38],
    ],
  },
  {
    family: 'assist',
    series: 'Simple assist monte',
    rows: [
      ['#1', 1.2, 1.4, 15, 26],
      ['1/0', 1.35, 1.8, 19, 30],
      ['2/0', 1.5, 2.4, 25, 34],
      ['3/0', 1.7, 3.2, 32, 39],
      ['4/0', 1.9, 4.2, 40, 44],
    ],
  },
  {
    family: 'split',
    series: 'Anneau brise inox',
    rows: [
      ['#1', 0.6, 0.06, 3, 3.2],
      ['#2', 0.7, 0.1, 4, 4],
      ['#3', 0.8, 0.16, 6, 4.8],
      ['#4', 0.9, 0.25, 8, 5.5],
      ['#5', 1.0, 0.35, 10, 6.2],
      ['#6', 1.1, 0.5, 13, 7],
      ['#7', 1.2, 0.72, 16, 7.8],
      ['#8', 1.3, 1.0, 20, 8.5],
      ['#10', 1.5, 1.6, 28, 10],
      ['#12', 1.7, 2.4, 38, 11.5],
    ],
  },
  {
    family: 'solid',
    series: 'Anneau soude inox',
    rows: [
      ['#4', 1.0, 0.18, 25, 4.5],
      ['#5', 1.2, 0.3, 40, 5.5],
      ['#6', 1.4, 0.48, 60, 6.5],
      ['#7', 1.6, 0.72, 85, 7.5],
      ['#8', 1.8, 1.05, 120, 8.5],
    ],
  },
  {
    family: 'swivel',
    series: 'Emerillon baril',
    rows: [
      ['#10', 0.8, 0.18, 9, 9],
      ['#8', 0.9, 0.28, 14, 11],
      ['#6', 1.1, 0.45, 22, 13],
      ['#4', 1.3, 0.8, 34, 16],
      ['#2', 1.5, 1.3, 50, 19],
    ],
  },
];

const seedId = (family: TackleFamily, series: string, size: string): string =>
  `${family}-${series.replace(/[^a-z0-9]+/gi, '').slice(0, 10).toLowerCase()}-${size.replace(/[^a-z0-9]+/gi, '')}`;

/** Table de depart, entierement indicative et entierement modifiable. */
export const seedCatalogue = (): TackleItem[] =>
  SEEDS.flatMap((seed) =>
    seed.rows.map(([size, wireMm, massG, strengthKg, spanMm]) => ({
      id: seedId(seed.family, seed.series, size),
      family: seed.family,
      series: seed.series,
      size,
      wireMm,
      massG,
      strengthKg,
      spanMm,
      source: 'indicatif' as TackleSource,
      note: 'Ordre de grandeur. A corriger sur la charte du fournisseur ou a la balance.',
    })),
  );

export const findTackle = (catalogue: TackleItem[], id: string | null): TackleItem | null =>
  id ? (catalogue.find((item) => item.id === id) ?? null) : null;

// ---------------------------------------------------------------------------
// Q.3 — Import et export CSV
// ---------------------------------------------------------------------------

/** Colonnes reconnues, avec leurs synonymes courants. */
// Les noms sont ecrits SANS accent : l'en-tete du fichier est normalise
// avant comparaison, donc « Serie », « Série » et « SERIE » tombent tous sur
// la meme entree. Cela evite aussi tout caractere non-ASCII dans le bundle,
// qui rendrait le fichier autonome dependant d'une declaration de charset.
const COLUMNS: { key: keyof TackleItem; names: string[] }[] = [
  { key: 'family', names: ['famille', 'family', 'type'] },
  { key: 'series', names: ['serie', 'series', 'gamme', 'modele'] },
  { key: 'size', names: ['taille', 'size', 'calibre hamecon', 'no', 'n'] },
  { key: 'wireMm', names: ['fil', 'wire', 'calibre', 'calibre de fil', 'wiremm', 'fil mm'] },
  { key: 'massG', names: ['masse', 'mass', 'poids', 'weight', 'g', 'massg', 'masse g'] },
  { key: 'strengthKg', names: ['resistance', 'strength', 'kg', 'strengthkg'] },
  { key: 'spanMm', names: ['longueur', 'diametre', 'span', 'spanmm', 'mm'] },
  { key: 'note', names: ['note', 'commentaire', 'remarque'] },
];

/** Compare sur du texte deja normalise : sans accent, sans casse. */
const FAMILY_ALIASES: [RegExp, TackleFamily][] = [
  [/triple|treble/, 'treble'],
  [/inline/, 'inline'],
  [/assist/, 'assist'],
  [/bris|split/, 'split'],
  [/soud|solid/, 'solid'],
  [/emerillon|swivel/, 'swivel'],
];

/** Decoupe une ligne CSV en respectant les guillemets. */
function splitRow(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else quoted = !quoted;
    } else if (ch === sep && !quoted) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out.map((cell) => cell.trim());
}

export interface CsvPreview {
  items: TackleItem[];
  /** Colonnes reconnues, dans l'ordre du fichier. */
  matched: string[];
  /** Colonnes ignorees, listees pour que l'utilisateur sache quoi corriger. */
  ignored: string[];
  /** Lignes rejetees, avec la raison. */
  rejected: { line: number; reason: string }[];
}

/**
 * Lit une charte fournisseur.
 *
 * Le separateur se devine (virgule, point-virgule ou tabulation) et les
 * colonnes se reconnaissent par leur nom, pas par leur position : une charte
 * de fournisseur ne suit jamais l'ordre qu'on imagine. Rien n'est applique
 * avant que l'utilisateur ait vu l'apercu.
 */
export function parseTackleCsv(text: string): CsvPreview {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) {
    return { items: [], matched: [], ignored: [], rejected: [{ line: 1, reason: 'Fichier vide ou sans en-tete.' }] };
  }
  const sep = [';', ',', '\t']
    .map((candidate) => ({ candidate, n: splitRow(lines[0], candidate).length }))
    .sort((a, b) => b.n - a.n)[0].candidate;

  const header = splitRow(lines[0], sep);
  /** Minuscules, sans accent, ponctuation reduite a l'espace. */
  const norm = (value: string) =>
    value
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();

  const map = new Map<keyof TackleItem, number>();
  const matched: string[] = [];
  const ignored: string[] = [];
  header.forEach((cell, index) => {
    const n = norm(cell);
    const hit = COLUMNS.find((col) => col.names.some((name) => norm(name) === n));
    if (hit && !map.has(hit.key)) {
      map.set(hit.key, index);
      matched.push(`${cell} → ${hit.key}`);
    } else ignored.push(cell);
  });

  const items: TackleItem[] = [];
  const rejected: { line: number; reason: string }[] = [];
  const number = (raw: string | undefined): number => {
    if (!raw) return NaN;
    return Number(raw.replace(/\s/g, '').replace(',', '.'));
  };

  for (let i = 1; i < lines.length; i++) {
    const cells = splitRow(lines[i], sep);
    const rawFamily = map.has('family') ? cells[map.get('family')!] : '';
    const family = FAMILY_ALIASES.find(([re]) => re.test(norm(rawFamily ?? '')))?.[1];
    const size = map.has('size') ? cells[map.get('size')!] : '';
    const massG = number(map.has('massG') ? cells[map.get('massG')!] : undefined);

    if (!family) {
      rejected.push({ line: i + 1, reason: `Famille non reconnue : « ${rawFamily ?? ''} »` });
      continue;
    }
    if (!size) {
      rejected.push({ line: i + 1, reason: 'Taille absente.' });
      continue;
    }
    if (!Number.isFinite(massG) || massG <= 0) {
      rejected.push({ line: i + 1, reason: 'Masse absente ou non numerique — c est la colonne qui compte.' });
      continue;
    }

    const series = (map.has('series') ? cells[map.get('series')!] : '') || 'Import';
    items.push({
      id: seedId(family, series, size),
      family,
      series,
      size,
      wireMm: Math.max(number(map.has('wireMm') ? cells[map.get('wireMm')!] : undefined) || 1, 0.1),
      massG,
      strengthKg: Math.max(number(map.has('strengthKg') ? cells[map.get('strengthKg')!] : undefined) || 0, 0),
      spanMm: Math.max(number(map.has('spanMm') ? cells[map.get('spanMm')!] : undefined) || 0, 0),
      // Une charte fournisseur saisie a la main est une source verifiee : c'est
      // exactement le point de l'import.
      source: 'verifie',
      note: (map.has('note') ? cells[map.get('note')!] : '') || 'Importe depuis une charte fournisseur.',
    });
  }

  return { items, matched, ignored, rejected };
}

/** Fusionne un import dans la table : une ligne importee ecrase son homonyme. */
export function mergeCatalogue(current: TackleItem[], incoming: TackleItem[]): TackleItem[] {
  const byId = new Map(current.map((item) => [item.id, item]));
  for (const item of incoming) byId.set(item.id, item);
  return [...byId.values()];
}

const CSV_HEADER = 'famille;serie;taille;fil_mm;masse_g;resistance_kg;resistance_lb;encombrement_mm;source;note';

export function tackleToCsv(catalogue: TackleItem[]): string {
  const cell = (value: string) => (/[;"\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
  const rows = catalogue.map((item) =>
    [
      TACKLE_FAMILY_LABEL[item.family],
      cell(item.series),
      cell(item.size),
      item.wireMm.toFixed(2),
      item.massG.toFixed(3),
      item.strengthKg.toFixed(1),
      kgToLb(item.strengthKg).toFixed(1),
      item.spanMm.toFixed(1),
      item.source,
      cell(item.note),
    ].join(';'),
  );
  return [CSV_HEADER, ...rows].join('\n');
}

// ---------------------------------------------------------------------------
// Q.4 — Affectation sur le leurre
// ---------------------------------------------------------------------------

export interface MountResolved {
  mount: TackleMount;
  ring: TackleItem | null;
  hook: TackleItem | null;
  /** Masse totale du montage, en g. */
  massG: number;
  /**
   * Longueur pendante sous le point d'accrochage, en mm : anneau puis
   * hamecon. C'est elle qui donne le bras de levier et qui decide si le
   * triple touche le corps.
   */
  reachMm: number;
}

export function resolveMount(catalogue: TackleItem[], mount: TackleMount): MountResolved {
  const ring = findTackle(catalogue, mount.ringId);
  const hook = findTackle(catalogue, mount.hookId);
  return {
    mount,
    ring,
    hook,
    massG: (ring?.massG ?? 0) + (hook?.massG ?? 0),
    // L'anneau ne compte que par son diametre interieur utile, soit environ
    // les deux tiers de son diametre exterieur.
    reachMm: (ring ? ring.spanMm * 0.66 : 0) + (hook?.spanMm ?? 0),
  };
}

/**
 * Un support de queue TRAINE derriere le leurre, il ne pend pas dessous.
 *
 * La distinction n'est pas cosmetique : elle change le bras de levier. Un
 * triple accroche a la pointe de la queue recule le centre de masse ; le
 * meme triple sous le ventre l'abaisse. Deux effets opposes sur l'action.
 */
export const mountTrails = (position: number): boolean => position >= 0.88;

export interface MountWarning {
  mountId: string;
  level: 'warn' | 'error';
  message: string;
}

/**
 * Controle de dimension.
 *
 * Trois choses tournent mal en pratique et une seule se voit sur un dessin :
 * le triple qui bat contre le corps, celui qui depasse la queue, et deux
 * triples qui se croisent. On les verifie toutes les trois sur les cotes
 * reelles du catalogue.
 */
export function checkMounts(
  mounts: MountResolved[],
  bodyLengthMm: number,
  bodyHeightMm: number,
): MountWarning[] {
  const out: MountWarning[] = [];
  for (const m of mounts) {
    if (!m.hook && !m.ring) continue;
    const label = m.mount.label;

    // 1 — Le montage bat-il contre le corps ? On compare sa portee a la
    // demi-hauteur locale : au-dela, le triple ne pend plus, il frotte.
    if (m.reachMm > 0 && m.reachMm < bodyHeightMm * 0.35) {
      out.push({
        mountId: m.mount.id,
        level: 'warn',
        message: `${label} : le montage (${m.reachMm.toFixed(0)} mm) est court devant la hauteur du corps (${bodyHeightMm.toFixed(0)} mm). Le triple viendra battre contre le flanc.`,
      });
    }

    // 2 — Depassement de la queue.
    const tailGapMm = (1 - m.mount.position) * bodyLengthMm;
    if (m.hook && m.reachMm > tailGapMm + bodyLengthMm * 0.22) {
      out.push({
        mountId: m.mount.id,
        level: 'warn',
        message: `${label} : le montage depasse la queue de ${(m.reachMm - tailGapMm).toFixed(0)} mm. Sur un leurre traine, c est la source classique d emmelage.`,
      });
    }
  }

  // 3 — Collision entre deux montages voisins.
  const hooks = mounts.filter((m) => m.hook);
  for (let i = 0; i < hooks.length; i++) {
    for (let j = i + 1; j < hooks.length; j++) {
      const a = hooks[i];
      const b = hooks[j];
      const gapMm = Math.abs(a.mount.position - b.mount.position) * bodyLengthMm;
      const need = (a.reachMm + b.reachMm) * 0.5;
      if (gapMm < need) {
        out.push({
          mountId: b.mount.id,
          level: 'error',
          message: `${a.mount.label} et ${b.mount.label} se chevauchent : ${gapMm.toFixed(0)} mm entre les supports pour ${need.toFixed(0)} mm necessaires. Les deux hamecons vont s accrocher entre eux.`,
        });
      }
    }
  }
  return out;
}

/** Supports par defaut d'un leurre a bavette : ventre avant et queue. */
export const defaultMounts = (): TackleMount[] => [
  {
    id: 'mount-ventre',
    label: 'Support ventral',
    anchorId: null,
    position: 0.42,
    height: -1,
    ringId: null,
    hookId: null,
    visible: true,
  },
  {
    id: 'mount-queue',
    label: 'Support de queue',
    anchorId: null,
    position: 0.94,
    height: 0,
    ringId: null,
    hookId: null,
    visible: true,
  },
];
