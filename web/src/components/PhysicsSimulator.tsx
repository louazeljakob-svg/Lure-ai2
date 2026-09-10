/** Module de simulation : flottabilite, assiette, action de nage, alertes. */

import type { LureParams, WaterId } from '../types/lure';
import { WATER_LABEL } from '../lib/materials';
import type { PhysicsResult } from '../lib/physics';
import type { SocketPlan } from '../lib/assembly';
import { LureSilhouette } from './LureSilhouette';
import { SwimSimulator } from './SwimSimulator';
import { Fieldset, Segmented } from './ui';

interface Props {
  params: LureParams;
  physics: PhysicsResult;
  water: WaterId;
  onWaterChange: (water: WaterId) => void;
  /** Ancrages reellement generes : la tenue mecanique se calcule dessus. */
  sockets: SocketPlan[];
}

const BUOYANCY = {
  float: {
    label: 'Flotte',
    className: 'badge badge--float',
    description:
      'La poussee d Archimede l emporte : le leurre remonte des l arret de la traction.',
  },
  suspend: {
    label: 'Suspend',
    className: 'badge badge--suspend',
    description:
      'Masse et poussee s equilibrent a moins de 3 % : le leurre reste fige entre deux animations.',
  },
  sink: {
    label: 'Coule',
    className: 'badge badge--sink',
    description: 'Le leurre est plus lourd que l eau qu il deplace : il descend a l arret.',
  },
} as const;

const ACTION = {
  tight: {
    label: 'Nage serree',
    description:
      'Oscillation courte et rapide, faible amplitude laterale. Efficace en eau claire et sur poissons eduques.',
  },
  wide: {
    label: 'Nage large',
    description:
      'Grande amplitude laterale : le leurre balaie une bande importante et se voit de loin en eau teintee.',
  },
  rolling: {
    label: 'Nage roulante',
    description:
      'Le leurre pivote autour de son axe et lance des eclats de flanc. Recherche sur une cuiller, a corriger sur un poisson nageur.',
  },
} as const;

const attitudeText = (trim: number): string => {
  const value = Math.abs(trim).toFixed(0);
  if (trim > 5) return `Nez releve de ${value} deg — travail de surface, tete hors de l eau.`;
  if (trim < -5) return `Nez pique de ${value} deg — plongee rapide, mais l action s appauvrit au-dela de 25 deg.`;
  return 'Assiette horizontale — la reference pour un poisson nageur.';
};

const NOTICE_ICON = { error: '!', warn: '!', ok: 'OK', info: 'i' } as const;

export function PhysicsSimulator({ params, physics, water, onWaterChange, sockets }: Props) {
  const verdict = BUOYANCY[physics.buoyancy];
  const action = ACTION[physics.action];
  const cgClamped = Math.min(Math.max(physics.cgPct, 0), 100);
  const cbClamped = Math.min(Math.max(physics.cbPct, 0), 100);

  return (
    <div className="panel__body">
      <div className="verdict" aria-live="polite">
        <div className="verdict__top">
          <span className={verdict.className}>
            {verdict.label}
            <span className="badge__ratio">{physics.ratio.toFixed(2)} x eau</span>
          </span>
          <div>
            <span className="stat__label">Masse totale</span>
            <div className="stat__value">
              {physics.totalMass.toFixed(1)}
              <span className="stat__unit">g</span>
            </div>
          </div>
        </div>
        <p className="verdict__desc">{verdict.description}</p>
      </div>

      <Segmented
        label="Milieu"
        value={water}
        options={[
          { value: 'fresh', label: WATER_LABEL.fresh },
          { value: 'salt', label: WATER_LABEL.salt },
        ]}
        onChange={onWaterChange}
      />

      <div className="stat-grid">
        <div className="stat">
          <span className="stat__label">Volume deplace</span>
          <div className="stat__value">
            {physics.volumeCm3.toFixed(1)}
            <span className="stat__unit">cm3</span>
          </div>
          <span className="stat__sub">soit {physics.displacedMass.toFixed(1)} g de poussee</span>
        </div>
        <div className="stat">
          <span className="stat__label">Densite moyenne</span>
          <div className="stat__value">
            {physics.density.toFixed(2)}
            <span className="stat__unit">g/cm3</span>
          </div>
          <span className="stat__sub">eau : {water === 'salt' ? '1,025' : '1,000'} g/cm3</span>
        </div>
        <div className="stat">
          <span className="stat__label">Corps imprime</span>
          <div className="stat__value">
            {physics.bodyMass.toFixed(1)}
            <span className="stat__unit">g</span>
          </div>
          <span className="stat__sub">
            matiere deposee {Math.round(physics.solidFraction * 100)} %
          </span>
        </div>
        <div className="stat">
          <span className="stat__label">Lest + quincaillerie</span>
          <div className="stat__value">
            {(physics.ballastMass + physics.hardwareMass).toFixed(1)}
            <span className="stat__unit">g</span>
          </div>
          <span className="stat__sub">
            dont {physics.ballastMass.toFixed(1)} g de plomb interne
          </span>
        </div>
        {physics.rattleMass > 0 ? (
          <div className="stat">
            <span className="stat__label">Billes mobiles</span>
            <div className="stat__value">
              {physics.rattleMass.toFixed(2)}
              <span className="stat__unit">g</span>
            </div>
            <span className="stat__sub">
              inox libre dans ses logements : masse ajoutee, matiere retiree
            </span>
          </div>
        ) : null}
      </div>

      <div className="attitude">
        <div className="attitude__head">
          <span className="attitude__title">Assiette au repos</span>
          <span className="attitude__value">
            {physics.trimDeg > 0 ? '+' : ''}
            {physics.trimDeg.toFixed(1)} deg
          </span>
        </div>
        <div className="attitude__diagram">
          <div
            style={{
              position: 'relative',
              padding: '14px 10px',
              overflow: 'hidden',
            }}
          >
            <div
              aria-hidden="true"
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                top: '50%',
                borderTop: '2px dashed #3b8fd4',
                opacity: 0.7,
              }}
            />
            <div
              style={{
                transform: `rotate(${physics.trimDeg.toFixed(1)}deg)`,
                transformOrigin: '50% 50%',
              }}
            >
              <LureSilhouette params={params} height={72} decorative />
            </div>
          </div>
        </div>
        <p className="control__hint">{attitudeText(physics.trimDeg)}</p>

        <div className="balance" role="img" aria-label={`Centre de gravite a ${physics.cgPct.toFixed(0)} % et centre de poussee a ${physics.cbPct.toFixed(0)} % de la longueur depuis le nez`}>
          <div className="balance__scale" aria-hidden="true">
            <span>Nez</span>
            <span>Queue</span>
          </div>
          <div
            className="balance__marker balance__marker--cb"
            style={{ left: `${cbClamped}%` }}
            aria-hidden="true"
          >
            <span>CP {physics.cbPct.toFixed(0)}%</span>
          </div>
          <div
            className="balance__marker balance__marker--cg"
            style={{ left: `${cgClamped}%` }}
            aria-hidden="true"
          >
            <span>CG {physics.cgPct.toFixed(0)}%</span>
          </div>
        </div>
        <p className="control__hint">
          Bras de levier vertical CG / CP : {physics.rollMarginMm.toFixed(1)} mm.{' '}
          {physics.rollMarginMm > 0.2
            ? 'Le leurre se redresse seul.'
            : 'Insuffisant : le leurre se couche.'}
        </p>
      </div>

      <Fieldset legend="Action de nage estimee">
        <div className="stat" style={{ border: '1px solid var(--line)', marginBottom: 10 }}>
          <span className="stat__label">Comportement</span>
          <div className="stat__value">{action.label}</div>
          <span className="stat__sub">indice d amplitude {(physics.actionScore * 100).toFixed(0)} / 100</span>
        </div>
        <p className="control__hint">{action.description}</p>
        {physics.diveDepth ? (
          <p className="control__hint">
            Profondeur de nage indicative : {physics.diveDepth[0].toFixed(1)} a{' '}
            {physics.diveDepth[1].toFixed(1)} m en lancer-ramener regulier.
          </p>
        ) : (
          <p className="control__hint">
            Sans bavette, la profondeur depend de la vitesse de recuperation et du lestage.
          </p>
        )}
      </Fieldset>

      <SwimSimulator params={params} physics={physics} sockets={sockets} />

      <Fieldset legend="Coherence physique" hint="Verifications automatiques de la configuration.">
        {physics.warnings.length === 0 ? (
          <p className="empty">Aucune incoherence detectee sur cette configuration.</p>
        ) : (
          physics.warnings.map((warning) => (
            <div className={`notice notice--${warning.level}`} key={warning.id}>
              <span className="notice__icon" aria-hidden="true">
                {NOTICE_ICON[warning.level]}
              </span>
              <div>
                <h4>{warning.title}</h4>
                <p>{warning.detail}</p>
              </div>
            </div>
          ))
        )}
      </Fieldset>
    </div>
  );
}
