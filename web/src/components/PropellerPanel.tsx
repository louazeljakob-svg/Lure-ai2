/**
 * Helice de queue — module AP.1.
 *
 * Reglages de la piece rotative, jeux repris des cylindres de retention, et
 * resultat du balayage de rotation au pas de 5 degres : jeu minimal releve
 * contre chaque obstacle sur le tour complet, et premiere interference s'il
 * y en a une.
 */

import type { LureParams, PropellerConfig } from '../types/lure';
import type { PhysicsResult } from '../lib/physics';
import type { PropellerPlan } from '../lib/propeller';
import { propellerBlocker } from '../lib/propeller';
import { LIMITS } from '../lib/presets';
import { Derived, Fieldset, Segmented, Slider, Switch } from './ui';

interface Props {
  params: LureParams;
  onChange: (patch: Partial<LureParams>) => void;
  result: PhysicsResult['propeller'];
  plan: PropellerPlan | null;
}

export function PropellerPanel({ params, onChange, result, plan }: Props) {
  const config = params.propeller;
  const set = (patch: Partial<PropellerConfig>) => onChange({ propeller: { ...config, ...patch } });
  const blocker = propellerBlocker(params);
  const off = !config.enabled;
  const fit = params.articulation.retentionLoopFit;
  return (
    <Fieldset
      legend="Helice de queue"
      hint="Piece imprimee a part, enfilee sur le fil traversant qui lui sert d axe, ecartee du corps par une perle. Elle tourne librement : rien n est colle."
    >
      <Switch label="Helice rotative" checked={config.enabled} onChange={(enabled) => set({ enabled })} />
      {config.enabled && blocker ? (
        <div className="notice notice--warn">
          <span className="notice__icon" aria-hidden="true">
            !
          </span>
          <div>
            <h4>Helice sans axe</h4>
            <p>{blocker}</p>
          </div>
        </div>
      ) : null}
      <Segmented
        label="Nombre de pales"
        value={String(config.blades)}
        options={[
          { value: '1', label: '1 pale' },
          { value: '2', label: '2 pales' },
        ]}
        onChange={(value) => set({ blades: value === '2' ? 2 : 1 })}
      />
      <Slider
        label="Diametre d helice"
        value={config.diameter}
        {...LIMITS.propDiameter}
        unit="mm"
        display={`${config.diameter.toFixed(1)} mm`}
        disabled={off}
        onChange={(diameter) => set({ diameter })}
      />
      <Slider
        label="Angle de pale"
        value={config.bladeAngle}
        {...LIMITS.propAngle}
        unit="deg"
        display={`${config.bladeAngle.toFixed(0)} deg`}
        disabled={off}
        hint="Mesure a 70 % du rayon depuis le plan de rotation. Plus il est faible, plus la pale s enroule autour du moyeu."
        onChange={(bladeAngle) => set({ bladeAngle })}
      />
      <Slider
        label="Epaisseur de pale"
        value={config.bladeThickness}
        {...LIMITS.propBlade}
        unit="mm"
        display={`${config.bladeThickness.toFixed(1)} mm`}
        disabled={off}
        onChange={(bladeThickness) => set({ bladeThickness })}
      />
      <Slider
        label="Longueur du moyeu"
        value={config.hubLength}
        {...LIMITS.propHub}
        unit="mm"
        display={`${config.hubLength.toFixed(1)} mm`}
        disabled={off}
        hint="La pale se loge dans cette longueur : un moyeu plus long laisse la pale s enrouler davantage."
        onChange={(hubLength) => set({ hubLength })}
      />
      <Slider
        label="Diametre de perle"
        value={config.beadDiameter}
        {...LIMITS.beadDiameter}
        unit="mm"
        display={`${config.beadDiameter.toFixed(1)} mm`}
        disabled={off}
        onChange={(beadDiameter) => set({ beadDiameter })}
      />
      <Switch
        label="Perle imprimee"
        checked={config.beadPrinted}
        onChange={(beadPrinted) => set({ beadPrinted })}
        hint="Decochee : perle achetee (verre ou laiton), pesee et listee dans la fiche de montage, sans STL."
      />
      {plan ? (
        <Derived
          label="Pale"
          value={`pas ${(plan.pitch * 10).toFixed(1)} mm, ouverture ${((plan.span * 180) / Math.PI).toFixed(0)} deg`}
          how={`helicoide de pas ${(plan.pitch * 10).toFixed(1)} mm par tour, ${(plan.advance * 10).toFixed(1)} mm d avance dans le moyeu.`}
        />
      ) : null}
      <Derived
        label="Jeux de fonctionnement"
        value={`${fit.toFixed(2)} mm`}
        how={
          `alesage / axe, helice / perle et perle / corps : le jeu de boucle des cylindres de retention, une seule table de tolerances.` +
          (plan ? ` Alesage de ${(plan.boreRadius * 20).toFixed(2)} mm pour un fil de ${params.throughWire.wireMm.toFixed(1)} mm.` : '')
        }
      />
      {result ? (
        <>
          <Derived
            label="Masse et inertie"
            value={`${result.massG.toFixed(2)} g + perle ${result.beadMassG.toFixed(2)} g`}
            how={`inertie autour de l axe ${result.axialInertia.toFixed(0)} g.mm2 ; l arriere tournant ajoute ${(result.pitchInertia / 1000).toFixed(1)} g.cm2 au tangage. Masses comptees dans le bilan et le centre de gravite.`}
          />
          <Derived
            label="Rotation sur 360 deg"
            value={
              result.sweep.hits.length === 0
                ? `libre, ${result.sweep.steps} positions`
                : `${result.sweep.hits.length} interference(s)`
            }
            how={
              `balayage au pas de ${result.sweep.stepDeg} deg contre le corps, la perle, l axe et les hamecons. Jeu minimal : ` +
              Object.entries(result.sweep.minGapMm)
                .map(([label, gap]) => `${label} ${Number.isFinite(gap) ? gap.toFixed(2) : '—'} mm`)
                .join(' ; ') +
              '.'
            }
          />
          {result.sweep.hits.map((hit) => (
            <p key={hit.against} className="control__hint" style={{ color: 'var(--amber)' }}>
              A {hit.angleDeg} deg, l helice penetre de {hit.depthMm.toFixed(2)} mm dans {hit.against}. {hit.remedy}
            </p>
          ))}
        </>
      ) : null}
    </Fieldset>
  );
}
