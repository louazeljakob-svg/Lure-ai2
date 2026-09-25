/**
 * Reglages de famille — module AO.
 *
 * Chaque famille ajoutee se pilote d'abord par ses quelques grandeurs
 * propres, sur la plage de sa fiche : l'helice du Whopper_Plopper, le
 * diametre et le lest arriere du Pencil, la grande bavette et les billes du
 * Poisson nageur, le lest ventral et l'attache du Souple. Tout le reste
 * demeure accessible plus bas, curseur par curseur.
 */

import type { LureParams, PinAnchor } from '../types/lure';
import { LIMITS, PENCIL_BODY, cloneAnatomy, roundKnots } from '../lib/presets';
import { Fieldset, Segmented, Slider } from './ui';

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
  souple: {
    length: { min: 70, max: 150, step: 1, hardMin: LIMITS.length.hardMin, hardMax: LIMITS.length.hardMax },
    ballast: { min: 5, max: 60, step: 0.5, hardMin: LIMITS.ballastMass.hardMin, hardMax: LIMITS.ballastMass.hardMax },
    ballastAt: { min: 0.25, max: 0.5, step: 0.01, hardMin: LIMITS.ballastPosition.hardMin, hardMax: LIMITS.ballastPosition.hardMax },
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
  if (shape !== 'plopper' && shape !== 'pencil' && shape !== 'nageur' && shape !== 'souple') return null;

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
  const main = params.ballasts[0] ?? null;
  const dorsal = params.assembly.anchors.some((anchor) => anchor.exit === 'back');
  const setTie = (value: 'dos' | 'nez') => {
    const tie: PinAnchor =
      value === 'dos'
        ? { id: 'dos', position: 0.2, height: 0.5, exit: 'back', depth: 0, pin: 'auto', method: 'bore' }
        : { id: 'nez', position: 0.06, height: 0, exit: 'nose', depth: 0, pin: 'auto', method: 'bore' };
    const others = params.assembly.anchors.filter((anchor) => anchor.exit !== 'back' && anchor.exit !== 'nose');
    onChange({ assembly: { ...params.assembly, anchors: [tie, ...others] } });
  };
  return (
    <Fieldset legend="Reglages de famille — Souple" hint="Corps elance en TPU, lest ventral integre vers l avant. Descend droit, s anime a la canne.">
      <Slider label="Longueur" value={params.length} {...r.length} unit="mm" display={`${params.length.toFixed(0)} mm`} hint="Hauteur et largeur suivent, a proportions constantes." onChange={(length) => onChange(scaled(params, length))} />
      {main ? (
        <>
          <Slider
            label="Masse de lest"
            value={main.mass}
            {...r.ballast}
            unit="g"
            display={`${main.mass.toFixed(1)} g`}
            hint="Plomb cylindrique loge a cheval sur le plan de joint ; refuse, avec la raison, s il ne tient plus dans la section."
            onChange={(mass) => onChange({ ballasts: params.ballasts.map((item, i) => (i === 0 ? { ...item, mass } : item)) })}
          />
          <Slider
            label="Position du lest"
            value={main.position}
            {...r.ballastAt}
            display={pct(main.position)}
            onChange={(position) => onChange({ ballasts: params.ballasts.map((item, i) => (i === 0 ? { ...item, position } : item)) })}
          />
        </>
      ) : null}
      <Segmented
        label="Position d attache"
        value={dorsal ? 'dos' : 'nez'}
        options={[
          { value: 'dos', label: 'Dorsale' },
          { value: 'nez', label: 'Nez' },
        ]}
        onChange={setTie}
      />
    </Fieldset>
  );
}
