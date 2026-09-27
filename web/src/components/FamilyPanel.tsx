/**
 * Reglages de famille — module AO.
 *
 * Chaque famille ajoutee se pilote d'abord par ses quelques grandeurs
 * propres, sur la plage de sa fiche : l'helice du Whopper_Plopper, le
 * diametre et le lest arriere du Pencil, la grande bavette et les billes du
 * Poisson nageur, le lest ventral et l'attache du Souple. Tout le reste
 * demeure accessible plus bas, curseur par curseur.
 */

import type { LureParams } from '../types/lure';
import { LIMITS, PENCIL_BODY, cloneAnatomy, roundKnots } from '../lib/presets';
import { Fieldset, Segmented, Slider, Switch } from './ui';
import { tpuAt } from '../lib/materials';
import { createProfile } from '../lib/profile';
import { defaultSoftBody, softRigPlan } from '../lib/soft';

interface Props {
  params: LureParams;
  onChange: (patch: Partial<LureParams>) => void;
}

/** Plages de la fiche de chaque famille (min, max, pas). */
export const FAMILY_RANGES = {
  plopper: {
    length: { min: 90, max: 180, step: 1, hardMin: LIMITS.length.hardMin, hardMax: LIMITS.length.hardMax },
    diameter: { min: 20, max: 50, step: 0.5, hardMin: LIMITS.propDiameter.hardMin, hardMax: LIMITS.propDiameter.hardMax },
    bladeAngle: { min: 15, max: 60, step: 1, hardMin: LIMITS.propAngle.hardMin, hardMax: LIMITS.propAngle.hardMax },
    bead: { min: 6, max: 14, step: 0.5, hardMin: LIMITS.beadDiameter.hardMin, hardMax: LIMITS.beadDiameter.hardMax },
  },
  pencil: {
    length: { min: 50, max: 120, step: 1, hardMin: LIMITS.length.hardMin, hardMax: LIMITS.length.hardMax },
    diameter: { min: 15, max: 30, step: 0.5, hardMin: LIMITS.thickness.hardMin, hardMax: LIMITS.thickness.hardMax },
    maxAt: { min: 0.4, max: 0.75, step: 0.01, hardMin: 0.2, hardMax: 0.85 },
    ballastAt: { min: 0.6, max: 0.95, step: 0.01, hardMin: LIMITS.ballastPosition.hardMin, hardMax: LIMITS.ballastPosition.hardMax },
  },
  nageur: {
    length: { min: 80, max: 140, step: 1, hardMin: LIMITS.length.hardMin, hardMax: LIMITS.length.hardMax },
    bibLength: { min: 20, max: 45, step: 0.5, hardMin: LIMITS.bibLength.hardMin, hardMax: LIMITS.bibLength.hardMax },
    bibAngle: { min: 25, max: 50, step: 1, hardMin: LIMITS.bibAngle.hardMin, hardMax: LIMITS.bibAngle.hardMax },
    balls: { min: 2, max: 6, step: 1, hardMin: LIMITS.chamberBalls.hardMin, hardMax: LIMITS.chamberBalls.hardMax },
    ball: { min: 3, max: 8, step: 0.5, hardMin: LIMITS.rattleBall.hardMin, hardMax: LIMITS.rattleBall.hardMax },
  },
  // Module AU : plages de la fiche du gobie.
  souple: {
    length: { min: 50, max: 150, step: 1, hardMin: LIMITS.length.hardMin, hardMax: LIMITS.length.hardMax },
    headWidth: { min: 12, max: 30, step: 0.5, hardMin: 5, hardMax: 60 },
    pectoralSpan: { min: 20, max: 50, step: 0.5, hardMin: 5, hardMax: 120 },
    firstDorsal: { min: 5, max: 15, step: 0.5, hardMin: 1, hardMax: 40 },
    hardness: { min: 85, max: 95, step: 1, hardMin: 85, hardMax: 95 },
    infill: { min: 10, max: 100, step: 5, hardMin: 0, hardMax: 100 },
    channel: { min: 1.2, max: 4, step: 0.1, hardMin: 0.8, hardMax: 5 },
    jig: { min: 2, max: 20, step: 0.5, hardMin: 0.5, hardMax: 60 },
    ballast: { min: 0.5, max: 10, step: 0.5, hardMin: LIMITS.ballastMass.hardMin, hardMax: LIMITS.ballastMass.hardMax },
    ballastAt: { min: 0.15, max: 0.6, step: 0.01, hardMin: LIMITS.ballastPosition.hardMin, hardMax: LIMITS.ballastPosition.hardMax },
  },
  // Module AV : plages de la fiche du crankbait.
  crank: {
    length: { min: 40, max: 90, step: 1, hardMin: LIMITS.length.hardMin, hardMax: LIMITS.length.hardMax },
    height: { min: 16, max: 36, step: 0.5, hardMin: LIMITS.thickness.hardMin, hardMax: LIMITS.thickness.hardMax },
    width: { min: 12, max: 26, step: 0.5, hardMin: LIMITS.maxWidth.hardMin, hardMax: LIMITS.maxWidth.hardMax },
    bibAngle: { min: 30, max: 70, step: 1, hardMin: LIMITS.bibAngle.hardMin, hardMax: LIMITS.bibAngle.hardMax },
  },
} as const;

/** Longueur a proportions constantes : hauteur et largeur suivent. */
const scaled = (params: LureParams, length: number): Partial<LureParams> => {
  const k = length / Math.max(params.length, 1);
  return {
    length,
    maxWidth: Math.round(params.maxWidth * k * 100) / 100,
    thickness: Math.round(params.thickness * k * 100) / 100,
  };
};

const pct = (value: number) => `${Math.round(value * 100)} %`;

export function FamilyPanel({ params, onChange }: Props) {
  const shape = params.shape;
  if (shape !== 'plopper' && shape !== 'pencil' && shape !== 'nageur' && shape !== 'souple' && shape !== 'crank') return null;

  if (shape === 'crank') {
    const r = FAMILY_RANGES.crank;
    const slender = params.length / Math.max(params.thickness, 1);
    return (
      <Fieldset
        legend="Reglages de famille — Crankbait"
        hint="Corps haut et court, bavette large et courte. Assemblage Minnow 100 : male, femelle, bavette ; la visserie se choisit a la hauteur du corps (M3 des 22 mm)."
      >
        <Slider label="Longueur du corps" value={params.length} {...r.length} unit="mm" display={`${params.length.toFixed(0)} mm`} hint={`Elancement ${slender.toFixed(2)} (famille : voisin de 2,5).`} onChange={(length) => onChange({ length })} />
        <Slider label="Hauteur" value={params.thickness} {...r.height} unit="mm" display={`${params.thickness.toFixed(1)} mm`} onChange={(thickness) => onChange({ thickness })} />
        <Slider label="Largeur" value={params.maxWidth} {...r.width} unit="mm" display={`${params.maxWidth.toFixed(1)} mm`} onChange={(maxWidth) => onChange({ maxWidth })} />
        <Slider label="Angle de bavette" value={params.bibAngle} {...r.bibAngle} unit="deg" display={`${params.bibAngle.toFixed(0)} deg`} onChange={(bibAngle) => onChange({ bibAngle })} />
      </Fieldset>
    );
  }

  if (shape === 'plopper') {
    const r = FAMILY_RANGES.plopper;
    const prop = params.propeller;
    const setProp = (patch: Partial<LureParams['propeller']>) => onChange({ propeller: { ...prop, ...patch } });
    return (
      <Fieldset legend="Reglages de famille — Whopper_Plopper" hint="Corps fusele rond et helice de queue sur perle. Les jeux de l helice sont ceux des cylindres de retention.">
        <Slider label="Longueur du corps" value={params.length} {...r.length} unit="mm" display={`${params.length.toFixed(0)} mm`} hint="Le diametre suit, a proportions constantes." onChange={(length) => onChange(scaled(params, length))} />
        <Segmented
          label="Nombre de pales"
          value={String(prop.blades)}
          options={[
            { value: '1', label: '1 pale' },
            { value: '2', label: '2 pales' },
          ]}
          onChange={(value) => setProp({ blades: value === '2' ? 2 : 1 })}
        />
        <Slider label="Diametre d helice" value={prop.diameter} {...r.diameter} unit="mm" display={`${prop.diameter.toFixed(1)} mm`} onChange={(diameter) => setProp({ diameter })} />
        <Slider label="Angle de pale" value={prop.bladeAngle} {...r.bladeAngle} unit="deg" display={`${prop.bladeAngle.toFixed(0)} deg`} onChange={(bladeAngle) => setProp({ bladeAngle })} />
        <Slider label="Diametre de perle" value={prop.beadDiameter} {...r.bead} unit="mm" display={`${prop.beadDiameter.toFixed(1)} mm`} onChange={(beadDiameter) => setProp({ beadDiameter })} />
      </Fieldset>
    );
  }

  if (shape === 'pencil') {
    const r = FAMILY_RANGES.pencil;
    const main = params.ballasts[0] ?? null;
    return (
      <Fieldset legend="Reglages de famille — Pencil" hint="Section strictement circulaire : hauteur et largeur restent egales, le profil est regenere sans ondulation.">
        <Slider label="Longueur" value={params.length} {...r.length} unit="mm" display={`${params.length.toFixed(0)} mm`} onChange={(length) => onChange({ length })} />
        <Slider
          label="Diametre max"
          value={params.thickness}
          {...r.diameter}
          unit="mm"
          display={`${params.thickness.toFixed(1)} mm`}
          onChange={(diameter) => onChange({ thickness: diameter, maxWidth: diameter })}
        />
        <Slider
          label="Position du diametre max"
          value={params.bellyPosition}
          {...r.maxAt}
          display={pct(params.bellyPosition)}
          onChange={(maxAt) => {
            if (!params.anatomy) return onChange({ bellyPosition: maxAt });
            const anatomy = cloneAnatomy(params.anatomy)!;
            onChange({
              bellyPosition: maxAt,
              anatomy: {
                ...anatomy,
                ...roundKnots({ maxAt, ...PENCIL_BODY }),
                peduncle: maxAt + PENCIL_BODY.waistAt * (1 - maxAt),
              },
            });
          }}
        />
        {main ? (
          <Slider
            label="Position du lest"
            value={main.position}
            {...r.ballastAt}
            display={pct(main.position)}
            hint={`Lest arriere de ${main.mass.toFixed(1)} g : c est lui qui fait porter le lancer.`}
            onChange={(position) =>
              onChange({ ballasts: params.ballasts.map((item, i) => (i === 0 ? { ...item, position } : item)) })
            }
          />
        ) : null}
      </Fieldset>
    );
  }

  if (shape === 'nageur') {
    const r = FAMILY_RANGES.nageur;
    const chamber = params.chamber;
    const fit = chamber.diameter - chamber.ball;
    return (
      <Fieldset legend="Reglages de famille — Poisson nageur" hint="Grande bavette et chambre de billes dans le plan de joint. Les billes s achetent : elles pesent, elles ne s impriment pas.">
        <Slider label="Longueur du corps" value={params.length} {...r.length} unit="mm" display={`${params.length.toFixed(0)} mm`} hint="Hauteur et largeur suivent, a proportions constantes." onChange={(length) => onChange(scaled(params, length))} />
        <Slider label="Longueur de bavette" value={params.bibLength} {...r.bibLength} unit="mm" display={`${params.bibLength.toFixed(1)} mm`} onChange={(bibLength) => onChange({ bibLength })} />
        <Slider label="Angle de bavette" value={params.bibAngle} {...r.bibAngle} unit="deg" display={`${params.bibAngle.toFixed(0)} deg`} onChange={(bibAngle) => onChange({ bibAngle })} />
        <Slider label="Nombre de billes" value={chamber.balls} {...r.balls} display={`${chamber.balls}`} onChange={(balls) => onChange({ chamber: { ...chamber, balls } })} />
        <Slider
          label="Diametre des billes"
          value={chamber.ball}
          {...r.ball}
          unit="mm"
          display={`${chamber.ball.toFixed(1)} mm`}
          hint={`Chambre de ${(chamber.ball + fit).toFixed(1)} mm : le jeu de ${fit.toFixed(2)} mm est conserve.`}
          onChange={(ball) => onChange({ chamber: { ...chamber, ball, diameter: ball + fit } })}
        />
      </Fieldset>
    );
  }

  const r = FAMILY_RANGES.souple;
  const soft = params.soft ?? defaultSoftBody();
  const setSoft = (patch: Partial<typeof soft>) => onChange({ soft: { ...soft, ...patch } });
  const anatomy = params.anatomy;
  const grade = tpuAt(soft.hardness);
  const plan = softRigPlan(createProfile(params), params);
  const main = params.ballasts[0] ?? null;
  const setAnatomy = (patch: Partial<NonNullable<LureParams['anatomy']>>) =>
    anatomy ? onChange({ anatomy: { ...cloneAnatomy(anatomy)!, ...patch } }) : undefined;
  return (
    <Fieldset
      legend="Reglages de famille — Souple (gobie)"
      hint="Piece unique pleine en TPU, sans vis ni ecrou : exception explicite au standard male / femelle. La matiere se deforme, un serrage n y aurait pas de sens."
    >
      <Slider
        label="Longueur"
        value={params.length}
        {...r.length}
        unit="mm"
        display={`${params.length.toFixed(0)} mm`}
        hint="Hauteur, largeur de tete et envergure suivent, a proportions constantes."
        onChange={(length) => {
          const k = length / Math.max(params.length, 1);
          onChange({
            ...scaled(params, length),
            ...(anatomy?.pectoralSpan !== undefined
              ? { anatomy: { ...cloneAnatomy(anatomy)!, pectoralSpan: Math.round(anatomy.pectoralSpan * k * 100) / 100 } }
              : {}),
          });
        }}
      />
      <Slider label="Largeur de tete" value={params.maxWidth} {...r.headWidth} unit="mm" display={`${params.maxWidth.toFixed(1)} mm`} hint="La tete est la partie la plus large du gobie, plus large que haute." onChange={(maxWidth) => onChange({ maxWidth })} />
      {anatomy ? (
        <>
          <Slider
            label="Envergure des pectorales"
            value={anatomy.pectoralSpan ?? 30}
            {...r.pectoralSpan}
            unit="mm"
            display={`${(anatomy.pectoralSpan ?? 30).toFixed(1)} mm`}
            hint="Bout a bout, eventails deployes ; mesuree sur la piece, pas estimee."
            onChange={(pectoralSpan) => setAnatomy({ pectoralSpan })}
          />
          <Slider
            label="Hauteur de premiere dorsale"
            value={anatomy.dorsalFin.size * params.thickness}
            {...r.firstDorsal}
            unit="mm"
            display={`${(anatomy.dorsalFin.size * params.thickness).toFixed(1)} mm`}
            hint="Premiere dorsale courte et haute ; la seconde, longue, suit."
            onChange={(h) => setAnatomy({ dorsalFin: { ...anatomy.dorsalFin, size: h / Math.max(params.thickness, 1) } })}
          />
        </>
      ) : null}
      <Slider
        label="Durete TPU"
        value={soft.hardness}
        {...r.hardness}
        unit="A"
        display={`${soft.hardness.toFixed(0)} A`}
        hint={`Densite ${grade.density.toFixed(2)} g/cm3 (${grade.densityRange[0].toFixed(2)} a ${grade.densityRange[1].toFixed(2)} selon la marque). ${grade.note}`}
        onChange={(hardness) => setSoft({ hardness: Math.round(hardness) })}
      />
      <Slider
        label="Remplissage"
        value={params.infill}
        {...r.infill}
        unit="%"
        display={`${params.infill.toFixed(0)} %`}
        hint="Plein par defaut. Moins rempli, le souple nage mieux mais se dechire plus vite — et flotte davantage."
        onChange={(infill) => onChange({ infill })}
      />
      <Segmented
        label="Preparation d armement"
        value={soft.rigging}
        options={[
          { value: 'slot', label: 'Fente ventrale' },
          { value: 'channel', label: 'Canal' },
          { value: 'none', label: 'Aucune' },
        ]}
        onChange={(rigging) => setSoft({ rigging: rigging as typeof soft.rigging })}
      />
      <p className="control__hint">
        {soft.rigging === 'slot'
          ? 'Fente ventrale : montage texan ou weightless, la hampe se loge dans la fente et le TPU se referme dessus.'
          : soft.rigging === 'channel'
            ? 'Canal longitudinal perce depuis le nez : tete plombee ou montage traversant.'
            : 'Corps plein : l armement est laisse au pecheur.'}
        {plan.hook
          ? ` Hamecon represente : ${plan.hook.size} (ouverture ${plan.hook.gapMm} mm pour ${plan.neededGapMm.toFixed(1)} mm necessaires, gabarit indicatif).`
          : ''}
      </p>
      {soft.rigging === 'channel' ? (
        <>
          <Slider label="Diametre du canal" value={soft.channelDiameter} {...r.channel} unit="mm" display={`${soft.channelDiameter.toFixed(1)} mm`} onChange={(channelDiameter) => setSoft({ channelDiameter })} />
          <Slider label="Tete plombee" value={soft.jigMass} {...r.jig} unit="g" display={`${soft.jigMass.toFixed(1)} g`} hint="Pesee dans le verdict de flottabilite, jamais imprimee." onChange={(jigMass) => setSoft({ jigMass })} />
        </>
      ) : null}
      <Switch
        label="Logement de lest interne"
        checked={soft.ballastSeat}
        hint={
          soft.ballastSeat && plan.pauseMm !== null
            ? `Pause d impression a ${plan.pauseMm.toFixed(1)} mm du ventre (piece posee sur le ventre) pour y glisser la bille.`
            : 'Souple coulant : une bille de plomb logee dans une cavite fermee, garnie pendant une pause d impression.'
        }
        onChange={(ballastSeat) =>
          onChange({
            soft: { ...soft, ballastSeat },
            ballasts: ballastSeat
              ? main
                ? params.ballasts
                : [{ id: `sou-${Date.now()}`, position: 0.3, height: -0.4, mass: 2, shape: 'sphere' }]
              : [],
          })
        }
      />
      {soft.ballastSeat && main ? (
        <>
          <Slider label="Masse du plomb" value={main.mass} {...r.ballast} unit="g" display={`${main.mass.toFixed(1)} g`} onChange={(mass) => onChange({ ballasts: params.ballasts.map((item, i) => (i === 0 ? { ...item, mass } : item)) })} />
          <Slider label="Position du plomb" value={main.position} {...r.ballastAt} display={pct(main.position)} onChange={(position) => onChange({ ballasts: params.ballasts.map((item, i) => (i === 0 ? { ...item, position } : item)) })} />
        </>
      ) : null}
      {plan.problems.map((problem) => (
        <p key={problem} className="control__hint control__hint--warn">
          {problem}
        </p>
      ))}
    </Fieldset>
  );
}
