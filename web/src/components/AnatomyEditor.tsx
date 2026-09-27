/**
 * Editeur du corps anatomique — module AB.
 *
 * Trois profils independants (dos, ventre, largeur) et la forme de section
 * au-dessus et au-dessous de l'axe, puis l'armature (commissure, pedoncule,
 * calotte de nez), les reliefs de tete et les nageoires. Chaque reglage agit
 * sur le vrai corps : la vue 3D, les coques et le STL suivent.
 */

import type { Anatomy, FinConfig, FinMode, ProfileKnot } from '../types/lure';
import { LIMITS } from '../lib/presets';
import { caudalModeOf, finModeOf, pchip, type FinKind } from '../lib/anatomy';
import { Fieldset, Segmented, Slider, Switch } from './ui';

interface Props {
  anatomy: Anatomy;
  onChange: (anatomy: Anatomy) => void;
  /** Corps de revolution (Pencil, Whopper_Plopper) : ses profils sont lies. */
  revolution?: boolean;
}

const pct = (value: number) => `${Math.round(value * 100)} %`;

type CurveKey = 'dorsal' | 'ventral' | 'width' | 'upper' | 'lower';

const CURVES: { key: CurveKey; label: string; hint: string; min: number; max: number; step: number }[] = [
  { key: 'dorsal', label: 'Dos', hint: 'Hauteur du dos au-dessus de l axe, relative.', min: 0, max: 1, step: 0.005 },
  { key: 'ventral', label: 'Ventre', hint: 'Profondeur du ventre sous l axe, relative.', min: 0, max: 1, step: 0.005 },
  { key: 'width', label: 'Largeur', hint: 'Demi-largeur, relative a la largeur maximale.', min: 0, max: 1.2, step: 0.005 },
  { key: 'upper', label: 'Section du dessus', hint: '2 = ellipse · moins = arete dorsale vive · plus = epaule pleine.', min: 1.15, max: 4, step: 0.01 },
  { key: 'lower', label: 'Section du dessous', hint: '2 = ventre rond · moins = carene · plus = ventre plat.', min: 1.15, max: 4, step: 0.01 },
];

type FinKey = 'dorsalFin' | 'dorsalFin2' | 'adiposeFin' | 'analFin' | 'pectoralFin' | 'pelvicFin';

const FINS: { key: FinKey; kind: FinKind; label: string; hint: string }[] = [
  { key: 'dorsalFin', kind: 'dorsal', label: 'Dorsale', hint: 'Dans le plan de symetrie : hauteur relative a l epaisseur du corps.' },
  { key: 'dorsalFin2', kind: 'dorsal2', label: 'Seconde dorsale', hint: 'Seconde dorsale, derriere la premiere (gobie : longue et basse).' },
  { key: 'adiposeFin', kind: 'adipose', label: 'Adipeuse', hint: 'Petite nageoire charnue sans rayons, sur le dos entre la dorsale et la caudale (integree ou en relief).' },
  { key: 'analFin', kind: 'anal', label: 'Anale', hint: 'Sous le ventre, en avant du pedoncule.' },
  { key: 'pectoralFin', kind: 'pectoral', label: 'Pectorales', hint: 'Par paire, derriere l opercule : envergure relative a l epaisseur.' },
  { key: 'pelvicFin', kind: 'pelvic', label: 'Ventrales', hint: 'Par paire, sous le ventre.' },
];

/** Realisation d'une nageoire sur un leurre imprime (module AW). */
const MODE_OPTIONS: { value: FinMode; label: string }[] = [
  { value: 'integrated', label: 'Integree' },
  { value: 'relief', label: 'En relief' },
  { value: 'attached', label: 'Rapportee' },
];

const MODE_HINT: Record<FinMode, string> = {
  integrated: 'Sort du corps, epaissie a 1,2 mm minimum a la base et 0,6 mm au bord libre.',
  relief: 'Dessinee sur le flanc — rayons, bord festonne, epaisseur degressive — sans depasser du corps.',
  attached: 'Piece separee imprimee a plat, languette ou tenon dans un logement du corps, jeu de collage 0,10 mm par face.',
};

/** Plages des reglages de detail du module AT (saisie numerique comprise). */
const AT_RANGES = {
  lips: { min: 0, max: 0.03, step: 0.001, hardMin: 0, hardMax: 0.08 },
  jawProtrusion: { min: -1, max: 1.5, step: 0.05, hardMin: -1, hardMax: 1.5 },
  nostrils: { min: 0, max: 0.6, step: 0.05, hardMin: 0, hardMax: 1 },
  ventralLine: { min: 0, max: 0.4, step: 0.01, hardMin: 0, hardMax: 1 },
  eyeTheta: { min: 0.4, max: 1.5, step: 0.01, hardMin: 0.35, hardMax: 1.5 },
};

/** Apercu des trois profils : dos et ventre en coupe de profil, largeur en pointille. */
function ProfilePreview({ anatomy }: { anatomy: Anatomy }) {
  const W = 300;
  const H = 90;
  const D = pchip(anatomy.dorsal);
  const V = pchip(anatomy.ventral);
  const L = pchip(anatomy.width);
  let top = '';
  let bottom = '';
  let width = '';
  for (let i = 0; i <= 80; i++) {
    const u = i / 80;
    const x = 6 + u * (W - 12);
    top += `${i ? 'L' : 'M'}${x.toFixed(1)} ${(H / 2 - D(u) * 70).toFixed(1)} `;
    bottom += `${i ? 'L' : 'M'}${x.toFixed(1)} ${(H / 2 + V(u) * 70).toFixed(1)} `;
    width += `${i ? 'L' : 'M'}${x.toFixed(1)} ${(H - 4 - L(u) * 30).toFixed(1)} `;
  }
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      height={H}
      role="img"
      aria-label="Apercu des profils de dos, de ventre et de largeur"
    >
      <line x1="6" x2={W - 6} y1={H / 2} y2={H / 2} stroke="var(--line-strong)" strokeDasharray="3 3" />
      <path d={top} fill="none" stroke="var(--ink)" strokeWidth="1.6" />
      <path d={bottom} fill="none" stroke="var(--ink)" strokeWidth="1.6" />
      <path d={width} fill="none" stroke="var(--red)" strokeWidth="1.2" strokeDasharray="4 3" />
    </svg>
  );
}

export function AnatomyEditor({ anatomy, onChange, revolution = false }: Props) {
  const set = (patch: Partial<Anatomy>) => onChange({ ...anatomy, ...patch });
  const setKnot = (key: CurveKey, index: number, v: number) => {
    const knots: ProfileKnot[] = anatomy[key].map((knot, i) => (i === index ? { ...knot, v } : knot));
    set({ [key]: knots } as Partial<Anatomy>);
  };
  const setFin = (key: FinKey, patch: Partial<FinConfig>) => {
    const current: FinConfig = anatomy[key] ?? { enabled: false, from: 0.5, to: 0.75, size: 0.12, rays: 10, mode: 'relief' };
    set({ [key]: { ...current, ...patch } } as Partial<Anatomy>);
  };

  return (
    <>
      <Fieldset
        legend="Armature anatomique"
        hint="Les reperes qui distinguent un poisson d un fuseau : ils pilotent la repartition des sections et la pose des details."
      >
        <ProfilePreview anatomy={anatomy} />
        <Slider
          label="Commissure de la machoire"
          value={anatomy.jaw}
          {...LIMITS.anatomyJaw}
          display={pct(anatomy.jaw)}
          hint="Fin du sillon de machoire, en % de la longueur depuis le nez."
          onChange={(jaw) => set({ jaw })}
        />
        <Slider
          label="Pedoncule caudal"
          value={anatomy.peduncle}
          {...LIMITS.anatomyPeduncle}
          display={pct(anatomy.peduncle)}
          hint="Resserrement avant la caudale : les sections y sont resserrees et la carene s y affirme."
          onChange={(peduncle) => set({ peduncle })}
        />
        <Slider
          label="Calotte de nez"
          value={anatomy.noseCap}
          {...LIMITS.anatomyNoseCap}
          display={pct(anatomy.noseCap)}
          hint="Longueur de l arrondi de fermeture du museau. Zero : face pleine (popper)."
          onChange={(noseCap) => set({ noseCap })}
        />
        <Slider
          label="Forme du museau"
          value={anatomy.noseShape}
          {...LIMITS.anatomyNoseShape}
          display={anatomy.noseShape.toFixed(2)}
          hint="0,5 = arrondi · 1 = pointu. La tangente reste perpendiculaire a l axe a la pointe."
          onChange={(noseShape) => set({ noseShape })}
        />
      </Fieldset>

      <Fieldset
        legend="Profils et sections"
        hint="Trois courbes independantes — dos, ventre, largeur — et la forme de section au-dessus et au-dessous de l axe. Chaque point de controle se regle a part ; la courbe passe exactement par lui, sans depassement."
      >
        {revolution ? (
          <p className="control__hint" style={{ color: 'var(--amber)' }}>
            Corps de revolution : dos, ventre et largeur sont lies pour garder une section circulaire, et
            regeneres par les reglages de famille. Deplacer un point ici rompt cette circularite.
          </p>
        ) : null}
        {CURVES.map((curve) => (
          <details key={curve.key} className="advanced">
            <summary>{curve.label}</summary>
            <p className="control__hint">{curve.hint}</p>
            {anatomy[curve.key].map((knot, index) => (
              <Slider
                key={`${curve.key}-${index}`}
                label={`A ${Math.round(knot.u * 100)} % du corps`}
                value={knot.v}
                min={curve.min}
                max={curve.max}
                step={curve.step}
                display={knot.v.toFixed(curve.key === 'upper' || curve.key === 'lower' ? 2 : 3)}
                onChange={(v) => setKnot(curve.key, index, v)}
              />
            ))}
          </details>
        ))}
      </Fieldset>

      <Fieldset
        legend="Reliefs de tete"
        hint="Modeles dans la peau : ils existent dans les coques et dans le STL, pas seulement a l ecran."
      >
        <Slider
          label="Sillon de machoire"
          value={anatomy.jawDepth}
          {...LIMITS.anatomyJawDepth}
          display={pct(anatomy.jawDepth)}
          hint="Profondeur relative a l epaisseur du corps, levre inferieure comprise."
          onChange={(jawDepth) => set({ jawDepth })}
        />
        <Slider
          label="Opercule en relief"
          value={anatomy.opercleRelief}
          {...LIMITS.anatomyOpercle}
          display={pct(anatomy.opercleRelief)}
          hint="Saillie de la plaque d opercule et de son bord ; la fente d ouie se regle avec les ouies."
          onChange={(opercleRelief) => set({ opercleRelief })}
        />
        <Slider
          label="Orbite creusee"
          value={anatomy.orbitDepth}
          {...LIMITS.anatomyOrbit}
          display={`${anatomy.orbitDepth.toFixed(2)} mm`}
          hint="Logement de l oeil, bourrelet de bord compris. Le relief positif de l oeil y bombe une cornee."
          onChange={(orbitDepth) => set({ orbitDepth })}
        />
        <Slider
          label="Levres"
          value={anatomy.lips ?? 0.4 * anatomy.jawDepth}
          {...AT_RANGES.lips}
          display={pct(anatomy.lips ?? 0.4 * anatomy.jawDepth)}
          hint="Levre superieure et levre inferieure, de part et d autre du sillon, jusqu a la commissure."
          onChange={(lips) => set({ lips })}
        />
        <Slider
          label="Machoire inferieure"
          value={anatomy.jawProtrusion ?? 0}
          {...AT_RANGES.jawProtrusion}
          unit="mm"
          display={`${(anatomy.jawProtrusion ?? 0).toFixed(2)} mm`}
          hint="Positive : proeminente ; negative : en retrait. Son rebord suit la levre jusqu a la commissure."
          onChange={(jawProtrusion) => set({ jawProtrusion })}
        />
        <Slider
          label="Narines"
          value={anatomy.nostrils ?? 0}
          {...AT_RANGES.nostrils}
          unit="mm"
          display={`${(anatomy.nostrils ?? 0).toFixed(2)} mm`}
          hint="Deux fossettes ourlees devant l oeil. Zero pour les omettre."
          onChange={(nostrils) => set({ nostrils })}
        />
        <Slider
          label="Hauteur de l oeil"
          value={anatomy.eyeTheta ?? 1.15}
          {...AT_RANGES.eyeTheta}
          display={`${Math.round(((anatomy.eyeTheta ?? 1.15) * 180) / Math.PI)} deg`}
          unit="deg"
          scale={180 / Math.PI}
          hint="Angle depuis le dos : bas sur le flanc chez un poisson fourrage, haut sur la tete chez un gobie."
          onChange={(eyeTheta) => set({ eyeTheta })}
        />
        <Slider
          label="Carene ventrale"
          value={anatomy.ventralLine ?? 0}
          {...AT_RANGES.ventralLine}
          unit="mm"
          display={`${(anatomy.ventralLine ?? 0).toFixed(2)} mm`}
          hint="Ligne mediane du ventre, en leger bourrelet, de la gorge a l anale. Zero pour l omettre."
          onChange={(ventralLine) => set({ ventralLine })}
        />
        <Slider
          label="Ligne laterale"
          value={anatomy.lateralLine}
          {...LIMITS.anatomyLateral}
          display={`${anatomy.lateralLine.toFixed(2)} mm`}
          hint="Sillon fin de l opercule au pedoncule. Zero pour l omettre."
          onChange={(lateralLine) => set({ lateralLine })}
        />
      </Fieldset>

      <Fieldset
        legend="Nageoires"
        hint="Rayons et epaisseur decroissante de la base vers le bord, raccord en conge sur le corps."
      >
        {FINS.map((fin) => {
          const config: FinConfig = anatomy[fin.key] ?? { enabled: false, from: 0.5, to: 0.75, size: 0.12, rays: 10, mode: 'relief' };
          const mode = finModeOf(config, fin.kind);
          return (
            <details key={fin.key} className="advanced">
              <summary>
                {fin.label} — {config.enabled ? MODE_OPTIONS.find((o) => o.value === mode)!.label.toLowerCase() : 'absente'}
              </summary>
              <Switch
                label="Presente"
                checked={config.enabled}
                hint={fin.hint}
                onChange={(enabled) => setFin(fin.key, { enabled })}
              />
              <Segmented
                label="Realisation"
                value={mode}
                options={fin.kind === 'adipose' ? MODE_OPTIONS.filter((o) => o.value !== 'attached') : MODE_OPTIONS}
                onChange={(value) => setFin(fin.key, { mode: value as FinMode })}
              />
              <p className="control__hint">{MODE_HINT[mode]}</p>
              <Slider
                label="Debut"
                value={config.from}
                {...LIMITS.finPosition}
                display={pct(config.from)}
                disabled={!config.enabled}
                onChange={(from) => setFin(fin.key, { from: Math.min(from, config.to - 0.01) })}
              />
              <Slider
                label="Fin"
                value={config.to}
                {...LIMITS.finPosition}
                display={pct(config.to)}
                disabled={!config.enabled}
                onChange={(to) => setFin(fin.key, { to: Math.max(to, config.from + 0.01) })}
              />
              <Slider
                label="Taille"
                value={config.size}
                {...LIMITS.finSize}
                display={pct(config.size)}
                disabled={!config.enabled}
                onChange={(size) => setFin(fin.key, { size })}
              />
              <Slider
                label="Rayons"
                value={config.rays}
                {...LIMITS.finRays}
                display={`${config.rays}`}
                disabled={!config.enabled}
                onChange={(rays) => setFin(fin.key, { rays: Math.round(rays) })}
              />
            </details>
          );
        })}
        <Segmented
          label="Caudale"
          value={caudalModeOf(anatomy)}
          options={MODE_OPTIONS}
          onChange={(value) => set({ caudalMode: value as FinMode })}
        />
        <p className="control__hint">
          {MODE_HINT[caudalModeOf(anatomy)]} Par defaut, dorsales et pelviennes en relief, caudale integree.
        </p>
        <Slider
          label="Rayons de la caudale"
          value={anatomy.caudalRays}
          {...LIMITS.caudalRays}
          display={`${anatomy.caudalRays}`}
          hint="Caudale en volume : fourchue, palette ou eventail selon la forme de queue."
          onChange={(caudalRays) => set({ caudalRays: Math.round(caudalRays) })}
        />
      </Fieldset>
    </>
  );
}
