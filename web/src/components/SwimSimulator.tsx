/**
 * Simulateur de nage — module K.
 *
 * Il vit dans le MEME onglet que la flottaison, et ce n'est pas un choix de
 * mise en page : c'est le meme corps soumis aux memes forces, a vitesse nulle
 * puis a vitesse non nulle. Tout ce qui est affiche ici est une estimation
 * d'ingenierie ; on montre donc des fourchettes, on expose les hypotheses, et
 * on laisse l'utilisateur recaler le modele sur ses propres essais.
 */

import { useMemo, useState } from 'react';
import type { LureParams } from '../types/lure';
import type { PhysicsResult } from '../lib/physics';
import type { SocketPlan } from '../lib/assembly';
import {
  CURRENT_PRESETS,
  DEFAULT_ASSUMPTIONS,
  NEUTRAL_CALIBRATION,
  SEALANTS,
  WIRE_MATERIALS,
  anchorStrength,
  applyCurrent,
  criticalSpeed,
  depthCurve,
  diveDepth,
  snagScenario,
  soakCurve,
  wobbleProfile,
  type Sealant,
  type SwimAssumptions,
  type SwimCalibration,
  type SwimInput,
  type WireMaterial,
} from '../lib/swim';
import { throughWireBlocker } from '../lib/throughWire';
import { resolveMount } from '../lib/tackle';
import { EstimateStat, LineChart, RankBars, VIZ, type VizPoint } from './charts';
import { Fieldset, Segmented, Slider, Switch } from './ui';

interface Props {
  params: LureParams;
  physics: PhysicsResult;
  sockets: SocketPlan[];
}

const n = (value: number, digits = 1): string =>
  value.toLocaleString('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits });

/** Duree lisible : au-dela de 72 h on parle en jours, pas en heures. */
const hoursText = (hours: number | null): string => {
  if (hours == null) return 'jamais';
  if (hours < 1) return `${Math.round(hours * 60)} min`;
  if (hours < 72) return `${n(hours, 0)} h`;
  return `${n(hours / 24, 0)} j`;
};

const ACTION_HINT = {
  roll: 'Le leurre pivote autour de son axe : eclats de flanc larges, cadence lente. Recherche en eau teintee.',
  yaw: 'Le leurre lace sans rouler : signature serree et rapide, la reference sur poissons eduques.',
  mixed: 'Roulis et lacet a parts comparables : le compromis le plus courant sur un poisson nageur.',
} as const;

interface AssumptionRow {
  key: keyof SwimAssumptions;
  label: string;
  step: number;
  /** Vrai pour un coefficient ajuste sur des observations, pas derive. */
  fitted?: boolean;
}

const ASSUMPTION_ROWS: AssumptionRow[] = [
  { key: 'bibLiftSlope', label: 'Portance de bavette, par radian (plaque mince ≈ 6,3)', step: 0.1 },
  { key: 'bibDragBase', label: 'Trainee de bavette a incidence nulle', step: 0.02 },
  { key: 'bodyDrag', label: 'Trainee du corps, sur section frontale', step: 0.02 },
  { key: 'lineDrag', label: 'Trainee de la ligne, sur surface projetee', step: 0.05 },
  { key: 'rollCoupling', label: 'Couplage roulis de la bavette', step: 0.005, fitted: true },
  { key: 'wobbleGain', label: 'Rendement de mise en oscillation', step: 0.02, fitted: true },
  { key: 'rollDamping', label: 'Amortissement en roulis', step: 0.05 },
  { key: 'uncertainty', label: 'Largeur de la fourchette affichee', step: 0.05 },
];

export function SwimSimulator({ params, physics, sockets }: Props) {
  const [assumptions, setAssumptions] = useState<SwimAssumptions>(DEFAULT_ASSUMPTIONS);
  const [calibration, setCalibration] = useState<SwimCalibration>(NEUTRAL_CALIBRATION);
  const [lineM, setLineM] = useState(25);
  const [troll, setTroll] = useState(3.5);
  const [presetId, setPresetId] = useState('lac');
  const [currentSpeed, setCurrentSpeed] = useState(0);
  const [heading, setHeading] = useState(0);
  const [sealant, setSealant] = useState<Sealant>('none');
  const [wire, setWire] = useState<WireMaterial>('inox304');
  const [lineKg, setLineKg] = useState(6);
  const [compare, setCompare] = useState(false);
  const [cgOffsetMm, setCgOffsetMm] = useState(0);
  const [massOffsetG, setMassOffsetG] = useState(0);

  // Recalage : trois mesures suffisent, une par famille de resultat.
  const [obsDepth, setObsDepth] = useState('');
  const [obsCritical, setObsCritical] = useState('');
  const [obsStrength, setObsStrength] = useState('');

  const base: SwimInput = useMemo(
    () => ({
      params,
      massG: physics.totalMass,
      volumeCm3: physics.volumeCm3,
      cg: physics.cg,
      cb: physics.cb,
      bounds: {
        length: params.length,
        width: params.maxWidth,
        height: params.thickness,
      },
      assumptions,
      calibration,
    }),
    [params, physics, assumptions, calibration],
  );

  // Variante de comparaison : deux entrees que le modele consomme vraiment —
  // la hauteur du centre de masse (bras de rappel) et la masse en service
  // (flottabilite residuelle). On ne compare pas sur un parametre invente.
  const variant: SwimInput = useMemo(
    () => ({
      ...base,
      massG: Math.max(base.massG + massOffsetG, 0.5),
      cg: { ...base.cg, y: base.cg.y + cgOffsetMm * 0.1 },
    }),
    [base, cgOffsetMm, massOffsetG],
  );

  const crit = useMemo(() => criticalSpeed(base), [base]);
  const critVar = useMemo(() => criticalSpeed(variant), [variant]);
  const wobble = useMemo(() => wobbleProfile(base, crit), [base, crit]);
  const wobbleVar = useMemo(() => wobbleProfile(variant, critVar), [variant, critVar]);

  const speeds = useMemo(
    () => [crit.recommended.from, crit.sweet, crit.recommended.to],
    [crit],
  );

  const withBand = (points: { line: number; depth: number }[]): VizPoint[] =>
    points.map((p) => ({
      x: p.line,
      y: p.depth,
      low: p.depth * (1 - assumptions.uncertainty),
      high: p.depth * (1 + assumptions.uncertainty),
    }));

  const depthSeries = useMemo(
    () =>
      speeds.map((speed, index) => ({
        id: `v${index}`,
        label: `${n(speed, 1)} km/h`,
        color: [VIZ.s1, VIZ.s2, VIZ.s3][index],
        points: withBand(depthCurve(base, speed, 60)),
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [base, speeds, assumptions.uncertainty],
  );

  const hasBib = params.hasBib;
  const current = { speed: currentSpeed, heading };
  const currentResult = useMemo(
    () => applyCurrent(base, crit, troll, current, lineM),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [base, crit, troll, currentSpeed, heading, lineM],
  );

  const floatMargin = Math.max(physics.displacedMass - physics.totalMass, 0);
  const soak = useMemo(
    () =>
      soakCurve(
        {
          params,
          sealant,
          voidCm3: Math.max(physics.volumeCm3 * (1 - physics.solidFraction), 0.3),
          holes: sockets.length,
          depthM: Math.max(currentResult.depth, 0.5),
        },
        Math.max(floatMargin, 0.05),
      ),
    [params, sealant, physics, sockets.length, currentResult.depth, floatMargin],
  );

  // Un fil traversant capture ses boucles de nez et de queue d'un bout a
  // l'autre du corps : il n'y a plus d'ancrage a arracher. Les oeillets
  // ventraux, eux, restent des ancrages ordinaires — et le classement le dit
  // ancrage par ancrage plutot que de promettre un montage uniforme.
  const wireMounted = params.throughWire.enabled && !throughWireBlocker(params);

  const anchors = useMemo(
    () =>
      sockets.map((socket) =>
        anchorStrength(
          socket.spec.label,
          socket.spec.wire,
          socket.spec.loopWidth,
          socket.seatDepth * 10,
          wire,
          params,
          assumptions,
          calibration,
          wireMounted && (socket.exit === 'nose' || socket.exit === 'tail'),
        ),
      ),
    [sockets, wire, params, assumptions, calibration, wireMounted],
  );

  /** Le fil traversant lui-meme est un maillon : on le classe comme tel. */
  const wireLink = useMemo(() => {
    if (!wireMounted) return null;
    const spec = WIRE_MATERIALS.find((m) => m.id === params.throughWire.material)
      ?? WIRE_MATERIALS[0];
    const r = params.throughWire.wireMm * 1e-3 / 2;
    const newtons = spec.tensile * 1e6 * Math.PI * r * r;
    return { label: `Fil traversant ${spec.label}`, kgf: newtons / 9.81 };
  }, [wireMounted, params.throughWire.material, params.throughWire.wireMm]);

  /** Anneaux et hamecons affectes : ils font partie de la chaine de rupture. */
  const tackleLinks = useMemo(
    () =>
      params.mounts.flatMap((mount) => {
        const resolved = resolveMount(params.catalogue, mount);
        const out: { label: string; kgf: number }[] = [];
        if (resolved.ring && resolved.ring.strengthKg > 0) {
          out.push({
            label: `${mount.label} — anneau ${resolved.ring.size}`,
            kgf: resolved.ring.strengthKg,
          });
        }
        if (resolved.hook && resolved.hook.strengthKg > 0) {
          out.push({
            label: `${mount.label} — hamecon ${resolved.hook.size}`,
            kgf: resolved.hook.strengthKg,
          });
        }
        return out;
      }),
    [params.mounts, params.catalogue],
  );

  const snag = useMemo(
    () => snagScenario(anchors, lineKg, [...tackleLinks, ...(wireLink ? [wireLink] : [])]),
    [anchors, lineKg, tackleLinks, wireLink],
  );

  const setAssumption = (key: keyof SwimAssumptions, value: number) =>
    setAssumptions((prev) => ({ ...prev, [key]: value }));

  /** Recalage : le rapport mesure / predit, borne pour rester credible. */
  const fit = (measured: string, predicted: number): number | null => {
    const value = Number(measured.replace(',', '.'));
    if (!Number.isFinite(value) || value <= 0 || predicted <= 0) return null;
    return Math.min(Math.max(value / predicted, 0.3), 3);
  };

  const predictedDepth = diveDepth({ ...base, calibration: NEUTRAL_CALIBRATION }, troll, lineM);
  const predictedCritical = criticalSpeed({ ...base, calibration: NEUTRAL_CALIBRATION }).speed.value;
  const predictedStrength = anchors.length
    ? anchors[0].kgf.value / Math.max(calibration.strength, 1e-6)
    : 0;

  return (
    <>
      <div className="swim__section">
        <Fieldset
          legend="Vitesse et profondeur"
          hint="K.1 et K.2 — la bavette tire vers le bas, la ligne tire vers le haut. C'est elle qui domine des la trentaine de metres."
        >
          <div className="stat-grid">
            <EstimateStat
              label="Vitesse de decrochage"
              value={crit.speed.value}
              low={crit.speed.low}
              high={crit.speed.high}
              unit="km/h"
              sub={`soit ${n(crit.knots.value, 1)} noeuds`}
            />
            <EstimateStat
              label="Trainee a cette vitesse"
              value={crit.dragGf.value}
              low={crit.dragGf.low}
              high={crit.dragGf.high}
              unit="gf"
              digits={0}
              sub={`${n(crit.dragN.value, 2)} N sur la canne`}
            />
          </div>
          <p className="swim__lead">
            Plage de traine conseillee : <strong>{n(crit.recommended.from, 1)}</strong> a{' '}
            <strong>{n(crit.recommended.to, 1)}</strong> km/h. En dessous la nage est molle, au-dela
            on frole le decrochage. Amplitude maximale vers {n(crit.sweet, 1)} km/h.
          </p>

          {hasBib ? (
            <LineChart
              series={depthSeries}
              xLabel="m de ligne"
              yLabel="Profondeur (m)"
              invertY
              fmtX={(v) => n(v, 0)}
              fmtY={(v) => n(v, 1)}
              height={190}
              tableLabel="Profondeur par longueur de ligne"
              caption={
                <>
                  La courbe sature : au-dela d'une cinquantaine de metres, la trainee de la ligne
                  reprend ce que la bavette a gagne. Zone ombree = fourchette a ±
                  {Math.round(assumptions.uncertainty * 100)} %.
                </>
              }
            />
          ) : (
            <div className="notice notice--info">
              <span className="notice__icon" aria-hidden="true">
                i
              </span>
              <div>
                <h4>Pas de courbe de plongee sans bavette</h4>
                <p>
                  Le modele de profondeur repose entierement sur la portance d'une bavette. Sur un
                  corps sans bavette, la profondeur depend de la vitesse de recuperation et du
                  lestage — deux choses que ce modele ne sait pas estimer honnetement. On prefere ne
                  rien afficher plutot qu'un chiffre invente.
                </p>
              </div>
            </div>
          )}

          <Slider
            label="Ligne larguee"
            value={lineM}
            min={5}
            max={60}
            step={1}
            display={`${lineM} m`}
            onChange={setLineM}
            hint={
              hasBib
                ? `A ${n(troll, 1)} km/h, profondeur estimee ${n(diveDepth(base, troll, lineM), 2)} m.`
                : undefined
            }
          />
          <Slider
            label="Vitesse de traine"
            value={troll}
            min={0.5}
            max={12}
            step={0.1}
            display={`${n(troll, 1)} km/h`}
            onChange={setTroll}
            hint={
              troll > crit.speed.value
                ? 'Au-dela de la vitesse de decrochage : le leurre part sur le flanc.'
                : `${Math.round((troll / Math.max(crit.speed.value, 0.1)) * 100)} % de la vitesse critique.`
            }
          />
        </Fieldset>
      </div>

      <div className="swim__section">
        <Fieldset
          legend="Action de nage"
          hint="K.3 — la frequence croit avec la vitesse, l'amplitude passe par un maximum puis s'effondre au decrochage."
        >
          <span className="swim__badge">{wobble.label}</span>
          <p className="swim__lead">{ACTION_HINT[wobble.action]}</p>

          <LineChart
            series={[
              {
                id: 'yaw',
                label: 'Lacet',
                color: VIZ.s1,
                points: wobble.points.map((p) => ({ x: p.speed, y: p.yaw })),
              },
              {
                id: 'roll',
                label: 'Roulis',
                color: VIZ.s2,
                points: wobble.points.map((p) => ({ x: p.speed, y: p.roll })),
              },
              ...(compare
                ? [
                    {
                      id: 'yaw-var',
                      label: 'Lacet (variante)',
                      color: VIZ.s1,
                      dashed: true,
                      points: wobbleVar.points.map((p) => ({ x: p.speed, y: p.yaw })),
                    },
                    {
                      id: 'roll-var',
                      label: 'Roulis (variante)',
                      color: VIZ.s2,
                      dashed: true,
                      points: wobbleVar.points.map((p) => ({ x: p.speed, y: p.roll })),
                    },
                  ]
                : []),
            ]}
            xLabel="km/h"
            yLabel="Amplitude (deg)"
            fmtX={(v) => n(v, 1)}
            fmtY={(v) => n(v, 0)}
            markers={[{ x: crit.sweet, label: 'optimum' }]}
            tableLabel="Amplitudes par vitesse"
          />

          <LineChart
            series={[
              {
                id: 'freq',
                label: 'Frequence',
                color: VIZ.s1,
                points: wobble.points.map((p) => ({ x: p.speed, y: p.frequency })),
              },
            ]}
            xLabel="km/h"
            yLabel="Frequence (Hz)"
            fmtX={(v) => n(v, 1)}
            fmtY={(v) => n(v, 1)}
            height={140}
            tableLabel="Frequence par vitesse"
            caption="Deux grandeurs d'unites differentes ne partagent jamais un axe : la frequence a son propre graphique."
          />
        </Fieldset>
      </div>

      <div className="swim__section">
        <Fieldset
          legend="Influence du centre de masse"
          hint="K.4 — le couple de rappel vient de l'ecart vertical entre centre de masse et centre de carene."
        >
          <Switch
            label="Mode comparaison"
            checked={compare}
            onChange={setCompare}
            hint="Superpose la variante en trait tirete sur les courbes d'action."
          />
          <Slider
            label="Hauteur du centre de masse"
            value={cgOffsetMm}
            min={-6}
            max={6}
            step={0.5}
            display={`${cgOffsetMm > 0 ? '+' : ''}${n(cgOffsetMm, 1)} mm`}
            onChange={setCgOffsetMm}
            hint="Negatif = lest descendu vers le ventre, donc plus stable."
          />
          <Slider
            label="Masse en service"
            value={massOffsetG}
            min={-8}
            max={8}
            step={0.5}
            display={`${massOffsetG > 0 ? '+' : ''}${n(massOffsetG, 1)} g`}
            onChange={setMassOffsetG}
            hint="Agit sur la flottabilite residuelle, donc sur la profondeur atteinte."
          />
          <div className="stat-grid">
            <div className="stat">
              <span className="stat__label">Bras de rappel</span>
              <div className="stat__value">
                {n((base.cb.y - base.cg.y) * 10, 2)}
                <span className="stat__unit">mm</span>
              </div>
              <span className="stat__sub">
                variante {n((variant.cb.y - variant.cg.y) * 10, 2)} mm
              </span>
            </div>
            <div className="stat">
              <span className="stat__label">Decrochage variante</span>
              <div className="stat__value">
                {n(critVar.speed.value, 1)}
                <span className="stat__unit">km/h</span>
              </div>
              <span className="stat__sub">
                {critVar.speed.value >= crit.speed.value ? '+' : ''}
                {n(critVar.speed.value - crit.speed.value, 1)} km/h vs configuration actuelle
              </span>
            </div>
          </div>
          <p className="swim__lead">
            La position longitudinale du centre de masse est traitee par l'assiette au repos plus
            haut : le modele de nage, lui, ne la consomme pas. On ne l'expose donc pas ici comme un
            levier, ce serait un curseur sans effet reel.
          </p>
        </Fieldset>
      </div>

      <div className="swim__section">
        <Fieldset
          legend="Courant"
          hint="K.5 — on traine a 3 km/h en remontant un courant de 4, et le leurre en voit 7."
        >
          <div className="control">
            <label className="control__label" htmlFor="current-preset">
              Situation
            </label>
            <select
              id="current-preset"
              value={presetId}
              onChange={(event) => {
                const value = event.target.value;
                setPresetId(value);
                const preset = CURRENT_PRESETS.find((item) => item.id === value);
                if (preset) {
                  setCurrentSpeed(preset.current.speed);
                  setHeading(preset.current.heading);
                }
              }}
            >
              {CURRENT_PRESETS.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.label}
                </option>
              ))}
              <option value="custom">Reglage libre</option>
            </select>
          </div>
          <Slider
            label="Vitesse du courant"
            value={currentSpeed}
            min={0}
            max={10}
            step={0.1}
            display={`${n(currentSpeed, 1)} km/h`}
            onChange={(value) => {
              setCurrentSpeed(value);
              setPresetId('custom');
            }}
          />
          <Slider
            label="Direction relative"
            value={heading}
            min={0}
            max={180}
            step={5}
            display={`${heading} deg`}
            onChange={(value) => {
              setHeading(value);
              setPresetId('custom');
            }}
            hint="0 deg = courant de face, 90 deg = de travers, 180 deg = de dos."
          />
          <div className="stat-grid">
            <div className={currentResult.overSpeed ? 'stat stat--bad' : 'stat'}>
              <span className="stat__label">Vitesse vue par le leurre</span>
              <div className="stat__value">
                {n(currentResult.relative, 1)}
                <span className="stat__unit">km/h</span>
              </div>
              <span className="stat__sub">
                {currentResult.overSpeed
                  ? 'Au-dela du decrochage : le compteur du bateau ne le dit pas.'
                  : `traine ${n(troll, 1)} km/h + courant ${n(currentSpeed, 1)} km/h`}
              </span>
            </div>
            <div className="stat">
              <span className="stat__label">Derive laterale</span>
              <div className="stat__value">
                {n(currentResult.drift, 0)}
                <span className="stat__unit">deg</span>
              </div>
              <span className="stat__sub">
                profondeur corrigee {n(currentResult.depth, 2)} m
              </span>
            </div>
          </div>
        </Fieldset>
      </div>

      <div className="swim__section">
        <Fieldset
          legend="Infiltration d'eau"
          hint="K.6 — ce n'est pas le materiau qui boit, c'est la porosite entre couches."
        >
          <Segmented
            label="Etancheite"
            value={sealant}
            options={SEALANTS.map((item) => ({ value: item.id, label: item.label }))}
            onChange={setSealant}
          />
          <LineChart
            series={[
              {
                id: 'water',
                label: 'Eau absorbee',
                color: VIZ.s1,
                points: soak.points.map((p) => ({ x: p.hours, y: p.water })),
              },
            ]}
            xLabel="heures"
            yLabel="Eau absorbee (g)"
            fmtX={(v) => n(v, 0)}
            fmtY={(v) => n(v, 2)}
            markers={[
              ...(soak.waterToSuspend != null
                ? [{ y: soak.waterToSuspend, label: 'suspend' }]
                : []),
              ...(soak.waterToSink != null ? [{ y: soak.waterToSink, label: 'coule' }] : []),
            ]}
            tableLabel="Absorption dans le temps"
          />
          <dl className="guide__list">
            <div>
              <dt>Nage degradee</dt>
              <dd>
                {hoursText(soak.toUnusable)} — l'assiette se casse bien avant que le leurre ne
                coule, et un leurre qui nage de travers ne prend plus.
              </dd>
            </div>
            <div>
              <dt>Bascule en suspending</dt>
              <dd>
                {hoursText(soak.toSuspend)}
                {soak.waterToSuspend != null
                  ? ` (${n(soak.waterToSuspend, 2)} g d'eau)`
                  : ' — la marge de flottaison depasse ce que le corps peut absorber'}
              </dd>
            </div>
            <div>
              <dt>Bascule en coulant</dt>
              <dd>{hoursText(soak.toSink)}</dd>
            </div>
            <div>
              <dt>Saturation</dt>
              <dd>{n(soak.saturation, 2)} g au maximum, atteints asymptotiquement.</dd>
            </div>
          </dl>
          <details className="viz__table">
            <summary>Comparatif des etancheites</summary>
            <div className="viz__table-scroll">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Traitement</th>
                    <th scope="col">Avant suspending</th>
                  </tr>
                </thead>
                <tbody>
                  {soak.advice.map((item) => (
                    <tr key={item.id}>
                      <th scope="row">{item.label}</th>
                      <td>{hoursText(item.hoursToSuspend)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </Fieldset>
      </div>

      <div className="swim__section">
        <Fieldset
          legend="Tenue mecanique"
          hint="K.7 — le classement compte autant que le chiffre : savoir CE QUI cede change tout."
        >
          {anchors.length === 0 ? (
            <div className="notice notice--info">
              <span className="notice__icon" aria-hidden="true">
                i
              </span>
              <div>
                <h4>Aucun ancrage a evaluer</h4>
                <p>
                  Activez l'assemblage et posez au moins une goupille dans l'onglet Atelier : la
                  charge de rupture se calcule sur une geometrie d'ancrage reelle, pas sur une
                  valeur par defaut.
                </p>
              </div>
            </div>
          ) : (
            <>
              <Segmented
                label="Materiau du fil"
                value={wire}
                options={WIRE_MATERIALS.map((item) => ({ value: item.id, label: item.label }))}
                onChange={setWire}
              />
              <div className="stat-grid">
                {anchors.map((anchor, index) => (
                  <EstimateStat
                    key={`${anchor.label}-${index}`}
                    label={anchor.label}
                    value={anchor.kgf.value}
                    low={anchor.kgf.low}
                    high={anchor.kgf.high}
                    unit="kgf"
                    sub={`cede par ${anchor.modeLabel}`}
                    tone={anchor.mode === 'pullout' ? 'warn' : 'neutral'}
                  />
                ))}
              </div>
              <Slider
                label="Resistance du corps de ligne"
                value={lineKg}
                min={1}
                max={40}
                step={0.5}
                display={`${n(lineKg, 1)} kg`}
                onChange={setLineKg}
              />
              {wireMounted ? (
                <p className="swim__lead">
                  <strong>Montage traversant</strong> : le fil est capture d un bout a l autre du
                  corps, il n y a plus d ancrage a arracher au nez ni a la queue. Le maillon faible
                  y devient le fil lui-meme ou l anneau brise. Les oeillets ventraux, eux, restent
                  des ancrages ordinaires et gardent leur mode d arrachement — c est la raison pour
                  laquelle le classement les nomme separement.
                </p>
              ) : null}
              <p className="swim__lead">
                Accroche au fond : on tire jusqu'a ce que quelque chose lache. Ici c'est{' '}
                <strong>{snag.first}</strong> a {n(snag.kgf, 1)} kgf.
                {snag.first === 'Corps de ligne' || snag.first === 'Noeud'
                  ? ' On repart avec le leurre.'
                  : ' On ramene une piece dechiree : mieux vaut descendre la resistance de ligne.'}
              </p>
              <RankBars
                items={snag.ranking.map((item) => ({ label: item.label, value: item.kgf }))}
                unit="kgf"
                weakestLabel={snag.first}
              />
            </>
          )}
        </Fieldset>
      </div>

      <div className="swim__section">
        <Fieldset
          legend="Hypotheses et etalonnage"
          hint="K.8 — aucun de ces coefficients n'a ete mesure sur CE leurre. Ils sont modifiables, et c'est volontaire."
        >
          <details className="viz__table" open={false}>
            <summary>Coefficients du modele</summary>
            <div style={{ marginTop: 8 }}>
              {ASSUMPTION_ROWS.map((row) => (
                <div
                  className={row.fitted ? 'assumption assumption--fitted' : 'assumption'}
                  key={row.key}
                >
                  <label htmlFor={`asm-${row.key}`}>{row.label}</label>
                  <input
                    id={`asm-${row.key}`}
                    type="number"
                    step={row.step}
                    value={assumptions[row.key]}
                    onChange={(event) => setAssumption(row.key, Number(event.target.value))}
                  />
                </div>
              ))}
              <p className="control__hint">
                Les lignes marquees « ajuste » ne sont pas derivees d'une theorie : elles sont
                calees pour que des leurres connus decrochent la ou on les voit decrocher. Ce sont
                les premieres a corriger.
              </p>
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => setAssumptions(DEFAULT_ASSUMPTIONS)}
              >
                Revenir aux valeurs par defaut
              </button>
            </div>
          </details>

          <details className="viz__table">
            <summary>Carnet d'etalonnage</summary>
            <div style={{ marginTop: 8 }}>
              <p className="control__hint">
                Notez une mesure reelle et le modele se recale dessus. Le facteur applique est le
                rapport mesure / predit, borne entre 0,3 et 3.
              </p>
              <div className="assumption">
                <label htmlFor="obs-depth">
                  Profondeur mesuree a {lineM} m de ligne et {n(troll, 1)} km/h (m) — predit{' '}
                  {n(predictedDepth, 2)}
                </label>
                <input
                  id="obs-depth"
                  type="number"
                  step={0.1}
                  value={obsDepth}
                  onChange={(event) => setObsDepth(event.target.value)}
                />
              </div>
              <div className="assumption">
                <label htmlFor="obs-crit">
                  Vitesse de decrochage observee (km/h) — predit {n(predictedCritical, 1)}
                </label>
                <input
                  id="obs-crit"
                  type="number"
                  step={0.1}
                  value={obsCritical}
                  onChange={(event) => setObsCritical(event.target.value)}
                />
              </div>
              <div className="assumption">
                <label htmlFor="obs-str">
                  Charge de rupture mesuree sur le premier ancrage (kgf) — predit{' '}
                  {n(predictedStrength, 1)}
                </label>
                <input
                  id="obs-str"
                  type="number"
                  step={0.5}
                  value={obsStrength}
                  onChange={(event) => setObsStrength(event.target.value)}
                />
              </div>
              <div className="row-actions">
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={() =>
                    setCalibration({
                      depth: fit(obsDepth, predictedDepth) ?? calibration.depth,
                      critical: fit(obsCritical, predictedCritical) ?? calibration.critical,
                      strength: fit(obsStrength, predictedStrength) ?? calibration.strength,
                    })
                  }
                >
                  Recaler le modele
                </button>
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={() => {
                    setCalibration(NEUTRAL_CALIBRATION);
                    setObsDepth('');
                    setObsCritical('');
                    setObsStrength('');
                  }}
                >
                  Neutraliser
                </button>
              </div>
              <p className="control__hint">
                Facteurs en vigueur — profondeur {n(calibration.depth, 2)}, decrochage{' '}
                {n(calibration.critical, 2)}, tenue {n(calibration.strength, 2)}.
              </p>
            </div>
          </details>

          <p className="swim__lead">
            Tout ce panneau affiche des estimations d'ingenierie. Les coefficients hydrodynamiques
            d'un corps aussi court et aussi peu profile qu'un leurre ne se calculent pas, ils se
            mesurent — et personne ne les a mesures pour celui-la. C'est pourquoi chaque resultat
            porte une fourchette plutot qu'un chiffre a trois decimales.
          </p>
        </Fieldset>
      </div>
    </>
  );
}
