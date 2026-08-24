/** Panneau Assemblage : deux coques, goujons, logement de goupille, agrafes. */

import type {
  AssemblyConfig,
  ClipId,
  FabricationConfig,
  LureParams,
  PinAnchor,
  PinExit,
  PinId,
} from '../types/lure';
import { CLIPS } from '../lib/materials';
import { PINS, autoPin } from '../lib/hardware';
import { EXIT_LABEL, anchorPin, resolvePin, type SocketPlan } from '../lib/assembly';
import { LIMITS } from '../lib/presets';
import { Fieldset, Segmented, Slider, Switch } from './ui';

interface Props {
  params: LureParams;
  onChange: (patch: Partial<LureParams>) => void;
  clipMass: number;
  pinMass: number;
  /** Portees calculees, pour signaler les ancrages invalides. */
  sockets: SocketPlan[];
  placing: boolean;
  onPlacingChange: (placing: boolean) => void;
  selectedAnchor: string | null;
  onSelectAnchor: (id: string | null) => void;
  onAddAnchor: () => void;
  onUpdateAnchor: (id: string, patch: Partial<PinAnchor>) => void;
  onRemoveAnchor: (id: string) => void;
}

const mm = (value: number) => `${value.toFixed(value < 10 ? 2 : 1)} mm`;

/** Les quatre sorties possibles : le passage doit deboucher a la surface. */
const EXITS: PinExit[] = ['nose', 'belly', 'tail', 'back'];

/** Une sortie longitudinale fixe a elle seule la position de l'ancrage. */
const longitudinal = (exit: PinExit) => exit === 'nose' || exit === 'tail';

export function AssemblyPanel({
  params,
  onChange,
  clipMass,
  pinMass,
  sockets,
  placing,
  onPlacingChange,
  selectedAnchor,
  onSelectAnchor,
  onAddAnchor,
  onUpdateAnchor,
  onRemoveAnchor,
}: Props) {
  const { assembly, fabrication } = params;
  const anchors = assembly.anchors;
  const spec = resolvePin(params);
  const automatic = autoPin(params.length, assembly.roughWater);

  const setAssembly = (patch: Partial<AssemblyConfig>) =>
    onChange({ assembly: { ...assembly, ...patch } });

  const setFabrication = (patch: Partial<FabricationConfig>) =>
    onChange({ fabrication: { ...fabrication, ...patch } });

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
        legend="Points d ancrage"
        hint="Activez le placement puis cliquez sur le corps dans la vue 3D. Le clic choisit le cote de sortie ; la position exacte se deduit ensuite de la taille de goupille, pour qu aucun point ne puisse etre mal place."
      >
        <Switch
          label="Placement de goupille"
          checked={placing}
          onChange={onPlacingChange}
          hint="Cliquez sur la surface pour poser un point, glissez une poignee pour la deplacer."
        />

        {anchors.length === 0 ? (
          <p className="empty">Aucun ancrage : le corps se referme sans quincaillerie.</p>
        ) : null}

        {anchors.map((anchor, index) => {
          const plan = sockets.find((socket) => socket.anchorId === anchor.id);
          // La cote retenue prime sur la cote demandee : la taille automatique
          // descend d un cran quand le corps est trop mince a cet endroit.
          const spec = plan?.spec ?? anchorPin(params, anchor);
          const selected = anchor.id === selectedAnchor;
          return (
            <div
              className={plan && !plan.valid ? 'ballast ballast--invalid' : 'ballast'}
              key={anchor.id}
              style={selected ? { borderLeftColor: 'var(--red)' } : undefined}
            >
              <div className="ballast__head">
                <button
                  type="button"
                  className="ballast__name"
                  style={{ background: 'none', border: 0, cursor: 'pointer', padding: 0 }}
                  onClick={() => onSelectAnchor(selected ? null : anchor.id)}
                >
                  Ancrage {index + 1}
                </button>
                <span className="ballast__spec">
                  {spec.label}
                  {plan ? ` · canal ${(plan.channelHalf * 20).toFixed(1)} mm` : ''}
                </span>
                <button
                  type="button"
                  className="btn btn--sm btn--ghost btn--danger"
                  onClick={() => onRemoveAnchor(anchor.id)}
                >
                  Retirer
                </button>
              </div>

              {plan && !plan.valid ? (
                <p className="control__hint" style={{ color: 'var(--red)' }}>
                  {plan.problem}
                </p>
              ) : null}

              {plan?.downsized ? (
                <p className="control__hint">
                  Taille ramenee a {spec.label} : la section ne laisse pas la place a une
                  {' '}{anchorPin(params, anchor).label}.
                </p>
              ) : null}

              {selected ? (
                <>
                  <Segmented
                    label="Sortie de la boucle"
                    value={anchor.exit}
                    options={EXITS.map((exit) => ({ value: exit, label: EXIT_LABEL[exit] }))}
                    hint="Le passage est creuse jusqu a la peau : la grande boucle ressort du corps de ce cote."
                    onChange={(exit) => onUpdateAnchor(anchor.id, { exit })}
                  />
                  {longitudinal(anchor.exit) ? (
                    <p className="control__hint">
                      Position automatique : en retrait de la pointe d une demi-longueur de
                      goupille ({(spec.length / 2).toFixed(1)} mm), centree
                      entre le dos et le ventre. Elle se recalcule si vous changez de taille.
                    </p>
                  ) : (
                    <>
                      <Slider
                        label="Position sur l axe"
                        value={anchor.position}
                        {...LIMITS.anchorPosition}
                        display={`${Math.round(anchor.position * 100)} %`}
                        onChange={(position) => onUpdateAnchor(anchor.id, { position })}
                      />
                      <p className="control__hint">
                        Hauteur automatique : en retrait de la face{' '}
                        {anchor.exit === 'belly' ? 'du ventre' : 'du dos'} d une demi-longueur de
                        goupille ({(spec.length / 2).toFixed(1)} mm).
                      </p>
                    </>
                  )}
                  <Slider
                    label="Profondeur du puits"
                    value={anchor.depth}
                    {...LIMITS.anchorDepth}
                    display={
                      anchor.depth > 0
                        ? mm(anchor.depth)
                        : plan
                          ? `${(plan.seatDepth * 10).toFixed(1)} mm (auto)`
                          : 'Auto'
                    }
                    hint="Auto : largeur locale du corps moins 0,5 mm de peau. Reglez pour forcer une valeur."
                    onChange={(depth) => onUpdateAnchor(anchor.id, { depth })}
                  />
                  <Segmented
                    label="Goupille"
                    value={anchor.pin}
                    wrap
                    options={[
                      { value: 'auto' as PinId | 'auto', label: 'Auto' },
                      ...PINS.map((pin) => ({ value: pin.id as PinId | 'auto', label: pin.label })),
                    ]}
                    onChange={(pin) => onUpdateAnchor(anchor.id, { pin })}
                  />
                  <Segmented
                    label="Logement"
                    value={anchor.method}
                    options={[
                      { value: 'bore' as const, label: 'Alesage' },
                      { value: 'channel' as const, label: 'Canal' },
                    ]}
                    onChange={(method) => onUpdateAnchor(anchor.id, { method })}
                  />
                </>
              ) : (
                <p className="control__hint">
                  Sortie {EXIT_LABEL[anchor.exit].toLowerCase()} ·{' '}
                  {anchor.method === 'bore' ? 'alesage' : 'canal'}
                  {plan ? ` · puits ${(plan.seatDepth * 10).toFixed(1)} mm` : ''}
                  {' — '}
                  <button
                    type="button"
                    className="palette-chip__apply"
                    onClick={() => onSelectAnchor(anchor.id)}
                  >
                    regler
                  </button>
                </p>
              )}
            </div>
          );
        })}

        <button type="button" className="btn btn--block" onClick={onAddAnchor}>
          + Ajouter un ancrage
        </button>
      </Fieldset>

      <Fieldset
        legend="Parametres de fabrication"
        hint="Les jeux se mesurent sur votre imprimante. Ajustez-les ici une fois vos valeurs validees."
      >
        <Slider
          label="Jeu goupille / alesage"
          value={fabrication.boreClearance}
          {...LIMITS.boreClearance}
          display={mm(fabrication.boreClearance)}
          hint="Methode A : alesage = cercle de la goupille + ce jeu."
          onChange={(boreClearance) => setFabrication({ boreClearance })}
        />
        <Slider
          label="Offset de silhouette"
          value={fabrication.channelOffset}
          {...LIMITS.channelOffset}
          display={mm(fabrication.channelOffset)}
          hint="Methode B : decalage du trace du fil avant balayage."
          onChange={(channelOffset) => setFabrication({ channelOffset })}
        />
        <Slider
          label="Supplement de profil balaye"
          value={fabrication.sweepExtra}
          {...LIMITS.sweepExtra}
          display={mm(fabrication.sweepExtra)}
          hint="Methode B : diametre du profil = cable de la goupille + ce supplement."
          onChange={(sweepExtra) => setFabrication({ sweepExtra })}
        />
        <Slider
          label="Jeu goujon / alesage femelle"
          value={fabrication.tenonFit}
          {...LIMITS.tenonFit}
          display={mm(fabrication.tenonFit)}
          hint="Emboitement des deux coques. Valeur de depart provisoire, a mesurer."
          onChange={(tenonFit) => setFabrication({ tenonFit })}
        />
        <Slider
          label="Jeu d insertion de bavette"
          value={fabrication.billFit}
          {...LIMITS.billFit}
          display={mm(fabrication.billFit)}
          hint="S ajoute a l epaisseur du polycarbonate pour dimensionner la fente."
          onChange={(billFit) => setFabrication({ billFit })}
        />
        <Slider
          label="Jeu des billes mobiles"
          value={fabrication.rattleFit}
          {...LIMITS.rattleFit}
          display={mm(fabrication.rattleFit)}
          hint="Volontairement large, a l inverse des precedents : c est ce jeu qui laisse la bille claquer dans son logement."
          onChange={(rattleFit) => setFabrication({ rattleFit })}
        />
      </Fieldset>

      <Fieldset
        legend="Goupille par defaut"
        hint="Appliquee aux ancrages laisses sur Auto."
      >
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
            {pinMass.toFixed(3)} g au total
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
