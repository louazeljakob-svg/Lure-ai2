/**
 * Editeur du corps anatomique — module AB.
 *
 * Trois profils independants (dos, ventre, largeur) et la forme de section
 * au-dessus et au-dessous de l'axe, puis l'armature (commissure, pedoncule,
 * calotte de nez), les reliefs de tete et les nageoires. Chaque reglage agit
 * sur le vrai corps : la vue 3D, les coques et le STL suivent.
 */

import type { Anatomy, FinConfig, ProfileKnot } from '../types/lure';
import { LIMITS } from '../lib/presets';
import { pchip } from '../lib/anatomy';
import { Fieldset, Slider, Switch } from './ui';

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

const FINS: { key: 'dorsalFin' | 'analFin' | 'pectoralFin' | 'pelvicFin'; label: string; hint: string }[] = [
  { key: 'dorsalFin', label: 'Dorsale', hint: 'Crete dans le plan de symetrie : hauteur relative a l epaisseur du corps.' },
  { key: 'analFin', label: 'Anale', hint: 'Crete sous le ventre, en avant du pedoncule.' },
  { key: 'pectoralFin', label: 'Pectorales', hint: 'Couchees sur le flanc derriere l opercule : envergure relative a l epaisseur.' },
  { key: 'pelvicFin', label: 'Ventrales', hint: 'Couchees sous le ventre, par paire.' },
];

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
  const setFin = (key: (typeof FINS)[number]['key'], patch: Partial<FinConfig>) =>
    set({ [key]: { ...anatomy[key], ...patch } } as Partial<Anatomy>);

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
          const config = anatomy[fin.key];
          return (
            <details key={fin.key} className="advanced">
              <summary>{fin.label}</summary>
              <Switch
                label="Presente"
                checked={config.enabled}
                hint={fin.hint}
                onChange={(enabled) => setFin(fin.key, { enabled })}
              />
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
