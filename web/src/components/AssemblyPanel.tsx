/** Panneau Assemblage : deux coques, goujons, logement de goupille, agrafes. */

import type {
  ScrewConfig,
  ScrewHead,
  ScrewPlacement,
  ScrewSize,
  AssemblyConfig,
  ClipId,
  FabricationConfig,
  LureParams,
  PinAnchor,
  PinExit,
  PinId,
  ThroughWireConfig,
} from '../types/lure';
import { CLIPS } from '../lib/materials';
import { PINS, autoPin } from '../lib/hardware';
import {
  EXIT_LABEL,
  anchorPin,
  assemblyBlocker,
  resolvePin,
  type SocketPlan,
} from '../lib/assembly';
import { LIMITS } from '../lib/presets';
import {
  THROUGH_WIRE_LIMITS,
  WIRE_MATERIAL_LABEL,
  throughWireBlocker,
} from '../lib/throughWire';
import { Fieldset, Segmented, Slider, Switch } from './ui';
import { HEAD_LABEL, SCREWS, SCREW_LENGTHS, SCREW_SIZES, headOf, suggestSize, usefulLength } from '../lib/screws';
import { createProfile, MM_TO_CM } from '../lib/profile';

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

  const wire = params.throughWire;
  const setWire = (patch: Partial<ThroughWireConfig>) =>
    onChange({ throughWire: { ...wire, ...patch } });
  const blocker = throughWireBlocker(params);
  const assemblyBlock = assemblyBlocker(params);

  const screws = params.screws;
  const setScrews = (patch: Partial<ScrewConfig>) =>
    onChange({ screws: { ...screws, ...patch } });
  const setScrew = (id: string, patch: Partial<ScrewPlacement>) =>
    setScrews({
      screws: screws.screws.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    });
  const screwProfile = createProfile(params);

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

        {assemblyBlock ? (
          <div className="notice notice--error">
            <span className="notice__icon" aria-hidden="true">
              !
            </span>
            <div>
              <h4>Deux coques impossibles avec cette combinaison</h4>
              <p>{assemblyBlock}</p>
              <p>
                Le corps reste exporte en UNE piece tant que la combinaison dure : mieux vaut
                une piece entiere que deux coques qui ne se refermeraient pas.
              </p>
            </div>
          </div>
        ) : null}
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
        legend="Montage traversant"
        hint="Un fil unique traverse le corps de bout en bout et forme lui-meme ses boucles de nez et de queue. C est ce qui change le mode de rupture."
      >
        <Switch
          label="Fil traversant"
          checked={wire.enabled}
          onChange={(enabled) => setWire({ enabled })}
          hint="S ajoute aux modes existants : les goupilles en 8 et les goujons d assemblage restent disponibles."
        />

        {blocker ? (
          <div className="notice notice--warn">
            <span className="notice__icon" aria-hidden="true">
              !
            </span>
            <div>
              <h4>Montage traversant impossible ici</h4>
              <p>{blocker}</p>
            </div>
          </div>
        ) : null}

        <Slider
          label="Diametre du fil"
          value={wire.wireMm}
          {...THROUGH_WIRE_LIMITS.wireMm}
          display={`${wire.wireMm.toFixed(1)} mm`}
          disabled={!wire.enabled}
          onChange={(wireMm) => setWire({ wireMm })}
        />
        <div className="control">
          <label className="control__label" htmlFor="wire-material">
            Materiau du fil
          </label>
          <select
            id="wire-material"
            value={wire.material}
            disabled={!wire.enabled}
            onChange={(event) =>
              setWire({ material: event.target.value as ThroughWireConfig['material'] })
            }
          >
            {(Object.keys(WIRE_MATERIAL_LABEL) as ThroughWireConfig['material'][]).map((id) => (
              <option key={id} value={id}>
                {WIRE_MATERIAL_LABEL[id]}
              </option>
            ))}
          </select>
        </div>
        <Slider
          label="Diametre des boucles"
          value={wire.loopMm}
          {...THROUGH_WIRE_LIMITS.loopMm}
          display={`${wire.loopMm.toFixed(1)} mm`}
          disabled={!wire.enabled}
          onChange={(loopMm) => setWire({ loopMm })}
        />
        <Slider
          label="Jeu du canal"
          value={wire.clearanceMm}
          {...THROUGH_WIRE_LIMITS.clearanceMm}
          display={`${wire.clearanceMm.toFixed(2)} mm`}
          disabled={!wire.enabled}
          hint={`Canal de ${(wire.wireMm + wire.clearanceMm).toFixed(2)} mm de diametre, creuse pour moitie dans chaque coque.`}
          onChange={(clearanceMm) => setWire({ clearanceMm })}
        />
        <Slider
          label="Sorties ventrales"
          value={wire.bellyExits}
          {...THROUGH_WIRE_LIMITS.bellyExits}
          display={`${wire.bellyExits}`}
          disabled={!wire.enabled}
          onChange={(bellyExits) => setWire({ bellyExits })}
        />
        {wire.bellyExits > 0 && wire.enabled ? (
          <>
            {wire.bellyPositions.slice(0, wire.bellyExits).map((position, index) => (
              <Slider
                key={index}
                label={`Position de la sortie ${index + 1}`}
                value={position}
                min={0.12}
                max={0.9}
                step={0.01}
                display={`${Math.round(position * 100)} %`}
                onChange={(value) =>
                  setWire({
                    bellyPositions: wire.bellyPositions.map((p, i) =>
                      i === index ? value : p,
                    ),
                  })
                }
              />
            ))}
            <p className="control__hint">
              Une boucle ventrale <strong>n est pas formee sur le fil</strong> : sortie du plan de
              joint, elle fendrait l assemblage sur toute sa hauteur. Chaque sortie pose donc un
              oeillet ventral a part entiere, a la cote du fil. Son mode de rupture reste
              l arrachement, et le simulateur le nomme ancrage par ancrage plutot que de promettre
              un montage uniformement traversant.
            </p>
          </>
        ) : null}
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

              {/*
                Cotes reelles du format retenu : de quoi verifier une
                goupille du catalogue fournisseur sans quitter l ecran.
              */}
              <p className="control__hint">
                Fil {spec.wire.toFixed(2)} mm · boucle {spec.loopWidth.toFixed(2)} mm ·
                longueur {spec.length.toFixed(2)} mm
                {anchor.pin === 'auto' ? ` · ${spec.hint}` : ' · taille forcee'}
              </p>

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
        legend="Vis d assemblage"
        hint="La vis entre par le VENTRE, monte dans le plan de symetrie et se serre dans un ecrou hexagonal captif, a cheval sur les deux coques. Tete et ecrou portent chacun pour moitie sur chaque moitie : c est le serrage qui plaque les deux coques ensemble, et le passage, a cheval lui aussi, qui les aligne."
      >
        <Switch
          label="Assemblage visse"
          checked={screws.enabled}
          onChange={(enabled) => setScrews({ enabled })}
        />
        <Slider
          label="Jeu du logement d ecrou"
          value={screws.nutFit}
          {...LIMITS.nutFit}
          display={`${screws.nutFit.toFixed(2)} mm`}
          disabled={!screws.enabled}
          hint="Applique a l entre-plats ET a l epaisseur, sur les trois diametres."
          onChange={(nutFit) => setScrews({ nutFit })}
        />
        {screws.screws.map((screw, index) => {
          const p = Math.min(Math.max(screw.position, 0.04), screwProfile.bodyEnd - 0.04);
          const section = screwProfile.section(p);
          const heightMm = (section.top - section.bottom) / MM_TO_CM;
          const size = screw.size === 'auto' ? suggestSize(heightMm) : screw.size;
          const spec = SCREWS[size];
          const cap = headOf(spec, screw.head);
          const useful = usefulLength(spec, screw.head, screw.length);
          return (
            <div className="row-actions" key={screw.id} style={{ display: 'block' }}>
              <Slider
                label={`Vis ${index + 1} — position`}
                value={screw.position * 100}
                min={5}
                max={95}
                step={1}
                display={`${((screwProfile.xAt(p) - screwProfile.xAt(0)) / MM_TO_CM).toFixed(0)} mm du nez`}
                disabled={!screws.enabled}
                onChange={(value) => setScrew(screw.id, { position: value / 100 })}
              />
              <Segmented
                label="Diametre"
                value={screw.size}
                options={[
                  { value: 'auto', label: `Auto (${suggestSize(heightMm)})` },
                  ...SCREW_SIZES.map((id) => ({ value: id, label: id })),
                ]}
                onChange={(value) => setScrew(screw.id, { size: value as ScrewSize | 'auto' })}
              />
              <Segmented
                label="Tete"
                value={screw.head}
                options={(['countersunk', 'socket'] as ScrewHead[]).map((id) => ({
                  value: id,
                  label: id === 'countersunk' ? 'Fraisee' : 'Cylindrique',
                }))}
                onChange={(value) => setScrew(screw.id, { head: value as ScrewHead })}
              />
              <Segmented
                label="Longueur"
                value={String(screw.length)}
                options={SCREW_LENGTHS.map((value) => ({
                  value: String(value),
                  label: `${value}`,
                }))}
                onChange={(value) => setScrew(screw.id, { length: Number(value) })}
              />
              <p className="hint">
                {HEAD_LABEL[screw.head]}, tete {cap.diameter.toFixed(1)} mm. Longueur utile{' '}
                <b>{useful.toFixed(2)} mm</b> — c est elle qui place la portee d ecrou. Ecrou{' '}
                {(spec.nut.across + screws.nutFit).toFixed(2)} mm entre plats sur{' '}
                {(spec.nut.thickness + screws.nutFit).toFixed(2)} mm d epaisseur.
              </p>
              {screws.screws.length > 1 ? (
                <button
                  type="button"
                  className="toolbtn"
                  disabled={!screws.enabled}
                  onClick={() =>
                    setScrews({ screws: screws.screws.filter((item) => item.id !== screw.id) })
                  }
                >
                  Retirer cette vis
                </button>
              ) : null}
            </div>
          );
        })}
        {screws.screws.length < 3 ? (
          <button
            type="button"
            className="toolbtn"
            disabled={!screws.enabled}
            onClick={() =>
              setScrews({
                screws: [
                  ...screws.screws,
                  {
                    id: `vis-${Date.now()}`,
                    position: Math.min(0.3 + screws.screws.length * 0.25, 0.9),
                    size: 'auto',
                    head: 'countersunk',
                    length: 20,
                  },
                ],
              })
            }
          >
            Ajouter une vis
          </button>
        ) : null}
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
