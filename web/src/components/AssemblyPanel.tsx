/** Panneau Assemblage : deux coques, goujons, logement de goupille, agrafes. */

import type { AssemblyConfig, ClipId, LureParams, PinId } from '../types/lure';
import { CLIPS } from '../lib/materials';
import { PINS, autoPin } from '../lib/hardware';
import { resolvePin, tenonRadius } from '../lib/assembly';
import { LIMITS } from '../lib/presets';
import { Fieldset, Segmented, Slider, Switch } from './ui';

interface Props {
  params: LureParams;
  onChange: (patch: Partial<LureParams>) => void;
  clipMass: number;
  pinMass: number;
}

const mm = (value: number) => `${value.toFixed(value < 10 ? 2 : 1)} mm`;

export function AssemblyPanel({ params, onChange, clipMass, pinMass }: Props) {
  const { assembly } = params;
  const spec = resolvePin(params);
  const automatic = autoPin(params.length, assembly.roughWater);

  const setAssembly = (patch: Partial<AssemblyConfig>) =>
    onChange({ assembly: { ...assembly, ...patch } });

  return (
    <div className="panel__body">
      <Fieldset
        legend="Deux coques"
        hint="Le corps est genere en deux demi-coques imprimables. Le plan de joint contient toujours l axe du leurre : c est ce qui garantit que chaque section est coupee en deux et que les coques se referment."
      >
        <Switch
          label="Corps en deux parties"
          checked={assembly.enabled}
          onChange={(enabled) => setAssembly({ enabled })}
        />
        <Slider
          label="Orientation du joint"
          value={assembly.planeAngle}
          {...LIMITS.planeAngle}
          display={
            assembly.planeAngle < 5
              ? 'Vertical'
              : assembly.planeAngle > 85
                ? 'Horizontal'
                : `${assembly.planeAngle.toFixed(0)} deg`
          }
          disabled={!assembly.enabled}
          hint="0 deg : joint gauche / droite, le plus courant. 90 deg : joint dos / ventre."
          onChange={(planeAngle) => setAssembly({ planeAngle })}
        />
      </Fieldset>

      <Fieldset
        legend="Goujons d alignement"
        hint="Imprimes sur la coque male, ils entrent dans des logements creuses dans la femelle. Leur diametre suit la largeur du corps s il est laisse sur Auto."
      >
        <Slider
          label="Nombre de goujons"
          value={assembly.tenonCount}
          {...LIMITS.tenonCount}
          display={`${assembly.tenonCount}`}
          disabled={!assembly.enabled}
          onChange={(tenonCount) => setAssembly({ tenonCount })}
        />
        <Slider
          label="Diametre"
          value={assembly.tenonDiameter}
          {...LIMITS.tenonDiameter}
          display={
            assembly.tenonDiameter > 0
              ? mm(assembly.tenonDiameter)
              : `Auto · ${mm(tenonRadius(params) * 20)}`
          }
          disabled={!assembly.enabled}
          onChange={(tenonDiameter) => setAssembly({ tenonDiameter })}
        />
        <Slider
          label="Jeu d emboitement"
          value={assembly.tenonClearance}
          {...LIMITS.tenonClearance}
          display={mm(assembly.tenonClearance)}
          disabled={!assembly.enabled}
          hint="Ajoute au rayon du logement femelle. 0,15 mm convient a la plupart des imprimantes FDM."
          onChange={(tenonClearance) => setAssembly({ tenonClearance })}
        />
      </Fieldset>

      <Fieldset legend="Goupille en 8" hint="Petite boucle prise dans le corps, grande boucle sortie au nez.">
        <Segmented
          label="Taille"
          value={assembly.pin}
          wrap
          options={[
            { value: 'auto' as PinId | 'auto', label: 'Auto', title: 'Proportionnelle a la longueur' },
            ...PINS.map((pin) => ({
              value: pin.id as PinId | 'auto',
              label: pin.label,
              title: `Fil ${pin.wire} mm · ${pin.length} mm · boucle ${pin.loopWidth} mm — ${pin.hint}`,
            })),
          ]}
          onChange={(pin) => setAssembly({ pin })}
        />
        <Switch
          label="Eaux sales (robustesse)"
          checked={assembly.roughWater}
          onChange={(roughWater) => setAssembly({ roughWater })}
          hint="Force la plus grosse goupille quelle que soit la longueur : c est la traction qui dimensionne, pas la silhouette."
        />
        <div className="stat" style={{ border: '1px solid var(--line)', marginBottom: 10 }}>
          <span className="stat__label">Goupille retenue</span>
          <div className="stat__value">{spec.label}</div>
          <span className="stat__sub">
            fil {spec.wire} mm · longueur {spec.length} mm · boucle {spec.loopWidth} mm ·{' '}
            {pinMass.toFixed(3)} g
          </span>
        </div>
        {assembly.pin === 'auto' ? (
          <p className="control__hint">
            Choix automatique pour {params.length.toFixed(0)} mm : {spec.label}
            {assembly.roughWater ? ' (regle eaux sales)' : ''}.
          </p>
        ) : (
          <p className="control__hint">
            Choix force. La regle proportionnelle aurait retenu{' '}
            {PINS.find((p) => p.id === automatic)?.label}.
          </p>
        )}
      </Fieldset>

      <Fieldset
        legend="Logement de goupille"
        hint="Creuse dans le plan de joint, moitie dans chaque coque."
      >
        <Segmented
          label="Methode"
          value={assembly.socketMethod}
          options={[
            { value: 'bore' as const, label: 'Alesage', title: 'Trou cylindrique simple' },
            { value: 'channel' as const, label: 'Canal', title: 'Suit la silhouette reelle du fil' },
          ]}
          onChange={(socketMethod) => setAssembly({ socketMethod })}
        />
        {assembly.socketMethod === 'bore' ? (
          <Slider
            label="Jeu diametral"
            value={assembly.boreClearance}
            {...LIMITS.boreClearance}
            display={mm(assembly.boreClearance)}
            disabled={!assembly.enabled}
            hint={`Alesage = cercle de la goupille + ce jeu, soit ${(spec.loopWidth + assembly.boreClearance).toFixed(2)} mm.`}
            onChange={(boreClearance) => setAssembly({ boreClearance })}
          />
        ) : (
          <Slider
            label="Offset du canal"
            value={assembly.channelOffset}
            {...LIMITS.channelOffset}
            display={mm(assembly.channelOffset)}
            disabled={!assembly.enabled}
            hint="Jeu radial autour du fil. Le canal suit le trace de la boucle et laisse la matiere interieure en place : c est elle qui retient la goupille."
            onChange={(channelOffset) => setAssembly({ channelOffset })}
          />
        )}
      </Fieldset>

      <Fieldset
        legend="Clips"
        hint="Agrafe montee sur l oeillet de tete. Elle n est pas imprimee : elle s ajoute a la masse et deplace le centre de gravite vers l avant."
      >
        <Segmented
          label="Anneau brise"
          value={params.clip}
          options={[
            { value: 'none' as ClipId, label: 'Aucun' },
            ...CLIPS.map((clip) => ({
              value: clip.id as ClipId,
              label: clip.label,
              title: `Fil ${clip.wire} mm, longueur ${clip.length} mm`,
            })),
          ]}
          onChange={(clip) => onChange({ clip })}
        />
        {params.clip === 'none' ? (
          <p className="control__hint">Aucune agrafe : le leurre est noue directement.</p>
        ) : (
          <div className="stat" style={{ border: '1px solid var(--line)' }}>
            <span className="stat__label">Agrafe montee</span>
            <div className="stat__value">
              {clipMass.toFixed(2)}
              <span className="stat__unit">g</span>
            </div>
            <span className="stat__sub">
              fil {CLIPS.find((c) => c.id === params.clip)?.wire} mm · longueur{' '}
              {CLIPS.find((c) => c.id === params.clip)?.length} mm
            </span>
          </div>
        )}
      </Fieldset>
    </div>
  );
}
