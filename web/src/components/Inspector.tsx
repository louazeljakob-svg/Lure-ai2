/**
 * Inspecteur : le panneau qui detaille la piece selectionnee dans l'arbre.
 *
 * Chaque type de noeud a son bloc. Les valeurs restent celles du modele
 * parametrique — l'inspecteur ne fait que les exposer avec les bornes, les
 * unites et l'aide qui vont avec.
 */

import type {
  ArticulationConfig,
  Decal,
  DowelConfig,
  Inlay,
  LureParams,
  PrintConfig,
  ScalesConfig,
} from '../types/lure';
import { LIMITS, type Range } from '../lib/presets';
import { getMaterial, materialsFor } from '../lib/materials';
import { autoDowels, type DowelPlacement } from '../lib/dowels';
import { Fieldset, Segmented, Slider, Switch } from './ui';

/**
 * Slider pilote par une borne du catalogue.
 *
 * Les bornes vivent dans LIMITS, partagees avec la validation des projets
 * importes : un curseur ne peut donc pas proposer une valeur que le modele
 * refuserait ensuite.
 */
function RangeSlider({
  label,
  value,
  range,
  format,
  hint,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  range: Range;
  format: (value: number) => string;
  hint?: string;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <Slider
      label={label}
      value={value}
      min={range.min}
      max={range.max}
      step={range.step}
      display={format(value)}
      hint={hint}
      disabled={disabled}
      onChange={onChange}
    />
  );
}

// ---------------------------------------------------------------------------
// Decal
// ---------------------------------------------------------------------------

export function DecalInspector({
  decal,
  onChange,
  onEditOutline,
}: {
  decal: Decal;
  onChange: (patch: Partial<Decal>) => void;
  onEditOutline: () => void;
}) {
  const empty = decal.outline.nodes.length < 2;
  return (
    <Fieldset
      legend="Decal de surface"
      hint="Une forme deposee sur le corps, projetee sur la surface puis mise en relief ou gravee."
    >
      <button type="button" className="btn btn--primary btn--block" onClick={onEditOutline}>
        {empty ? 'Dessiner le contour' : 'Modifier le contour'}
      </button>
      {empty ? (
        <p className="control__hint" style={{ color: 'var(--amber)' }}>
          Ce decal n a pas encore de contour : il ne marque donc pas le corps. Ouvrez
          l editeur et posez au moins deux points.
        </p>
      ) : null}

      <Segmented
        label="Style"
        value={decal.style}
        options={[
          { value: 'raised', label: 'Relief' },
          { value: 'engraved', label: 'Grave' },
        ]}
        hint="En relief la forme ressort de la peau ; en grave elle s y enfonce."
        onChange={(style) => onChange({ style })}
      />
      <RangeSlider
        label={decal.style === 'raised' ? 'Hauteur' : 'Profondeur'}
        value={decal.depth}
        range={LIMITS.decalDepth}
        format={(v) => `${v.toFixed(2)} mm`}
        onChange={(depth) => onChange({ depth })}
      />
      <RangeSlider
        label="Adoucissement des bords"
        value={decal.softness}
        range={LIMITS.decalSoftness}
        format={(v) => `${v.toFixed(0)} %`}
        hint="A zero le bord est net ; plus haut, le relief se fond dans la peau."
        onChange={(softness) => onChange({ softness })}
      />
      <Switch
        label="Miroir babord / tribord"
        checked={decal.mirror}
        hint="Reprend le decal a l identique sur l autre flanc."
        onChange={(mirror) => onChange({ mirror })}
      />
      <RangeSlider
        label="Opacite de l apercu"
        value={decal.previewOpacity}
        range={LIMITS.decalOpacity}
        format={(v) => `${v.toFixed(0)} %`}
        onChange={(previewOpacity) => onChange({ previewOpacity })}
      />

      <p className="control__hint">
        Placement — les gizmos du viewport agissent sur ces trois valeurs.
      </p>
      <RangeSlider
        label="Deplacer sur l axe"
        value={decal.position}
        range={LIMITS.decalPosition}
        format={(v) => `${(v * 100).toFixed(0)} %`}
        onChange={(position) => onChange({ position })}
      />
      <RangeSlider
        label="Deplacer en hauteur"
        value={decal.height}
        range={LIMITS.decalHeight}
        format={(v) => (v === 0 ? 'axe' : v > 0 ? `${(v * 100).toFixed(0)} % dos` : `${(-v * 100).toFixed(0)} % ventre`)}
        onChange={(height) => onChange({ height })}
      />
      <RangeSlider
        label="Pivoter"
        value={decal.rotation}
        range={LIMITS.decalRotation}
        format={(v) => `${v.toFixed(0)} deg`}
        onChange={(rotation) => onChange({ rotation })}
      />
      <RangeSlider
        label="Redimensionner"
        value={decal.size}
        range={LIMITS.decalSize}
        format={(v) => `${v.toFixed(1)} mm`}
        hint="Largeur du decal ; la hauteur suit les proportions du trace."
        onChange={(size) => onChange({ size })}
      />
    </Fieldset>
  );
}

// ---------------------------------------------------------------------------
// Ecailles
// ---------------------------------------------------------------------------

export function ScalesInspector({
  scales,
  onChange,
}: {
  scales: ScalesConfig;
  onChange: (patch: Partial<ScalesConfig>) => void;
}) {
  return (
    <Fieldset
      legend="Ecailles"
      hint="Texture d ecailles carrelee sur le corps. Affichee en direct comme normal map ; le relief reel est cuit dans la surface a l export."
    >
      <Switch
        label="Trame d ecailles"
        checked={scales.enabled}
        onChange={(enabled) => onChange({ enabled })}
      />

      {scales.enabled ? (
        <>
          <button
            type="button"
            className={scales.baked ? 'btn btn--block btn--primary' : 'btn btn--block'}
            onClick={() => onChange({ baked: !scales.baked })}
          >
            {scales.baked ? 'Masquer les ecailles cuites' : 'Afficher les ecailles cuites'}
          </button>
          <p className="control__hint">
            {scales.baked
              ? 'Relief reellement present dans le maillage : le corps est recalcule bien plus dense, l affichage ralentit d autant.'
              : 'Apercu en normal map : rapide, mais le relief n existe pas encore dans la matiere.'}
          </p>

          <Segmented
            label="Ajustement"
            value={scales.fit}
            options={[
              { value: 'wrapped', label: 'Enveloppe' },
              { value: 'lateral', label: 'Lateral' },
            ]}
            hint="En lateral, les ecailles gardent une taille uniforme, projetees de cote comme un tampon. Le dos et le ventre s etirent la ou la surface s echappe — masquez-les avec les marges haut / bas."
            onChange={(fit) => onChange({ fit })}
          />
          <Segmented
            label="Forme"
            value={scales.shape}
            options={[
              { value: 'diamond', label: 'Losange' },
              { value: 'hex', label: 'Hexagone' },
              { value: 'scallop', label: 'Feston' },
            ]}
            onChange={(shape) => onChange({ shape })}
          />

          <RangeSlider
            label="Largeur d ecaille"
            value={scales.width}
            range={LIMITS.scaleWidth}
            format={(v) => `${v.toFixed(1)} mm`}
            onChange={(width) => onChange({ width })}
          />
          <RangeSlider
            label="Hauteur d ecaille"
            value={scales.height}
            range={LIMITS.scaleHeight}
            format={(v) => `${v.toFixed(1)} mm`}
            onChange={(height) => onChange({ height })}
          />
          <RangeSlider
            label="Espacement"
            value={scales.spacing}
            range={LIMITS.scaleSpacing}
            format={(v) => `${v.toFixed(2)} mm`}
            onChange={(spacing) => onChange({ spacing })}
          />
          <RangeSlider
            label="Profondeur"
            value={scales.depth}
            range={LIMITS.scaleDepth}
            format={(v) => `${v.toFixed(2)} mm`}
            onChange={(depth) => onChange({ depth })}
          />
          <RangeSlider
            label="Arrondi"
            value={scales.rounding}
            range={LIMITS.scaleRounding}
            format={(v) => `${v.toFixed(0)} %`}
            onChange={(rounding) => onChange({ rounding })}
          />

          <Segmented
            label="Style"
            value={scales.style}
            options={[
              { value: 'raised', label: 'En relief' },
              { value: 'engraved', label: 'Grave' },
            ]}
            hint="En relief, les ecailles restent sur la surface du corps ; en grave, ce sont les interstices qui sont creuses."
            onChange={(style) => onChange({ style })}
          />

          <RangeSlider
            label="Marge du dos"
            value={scales.marginTop}
            range={LIMITS.scaleMargin}
            format={(v) => `${v.toFixed(0)} %`}
            onChange={(marginTop) => onChange({ marginTop })}
          />
          <RangeSlider
            label="Marge du ventre"
            value={scales.marginBottom}
            range={LIMITS.scaleMargin}
            format={(v) => `${v.toFixed(0)} %`}
            onChange={(marginBottom) => onChange({ marginBottom })}
          />
        </>
      ) : null}
    </Fieldset>
  );
}

// ---------------------------------------------------------------------------
// Articulation
// ---------------------------------------------------------------------------

export function ArticulationInspector({
  config,
  lengthMm,
  effectiveSwing,
  onChange,
  onFit,
}: {
  config: ArticulationConfig;
  lengthMm: number;
  /** Debattement reellement obtenu par la geometrie, en degres. */
  effectiveSwing: number | null;
  onChange: (patch: Partial<ArticulationConfig>) => void;
  onFit: () => void;
}) {
  return (
    <Fieldset
      legend="Articulation"
      hint="Le corps est coupe en deux segments relies par une quincaillerie reelle, imprimable et assemblable."
    >
      <Switch
        label="Corps articule"
        checked={config.enabled}
        onChange={(enabled) => onChange({ enabled })}
      />

      {config.enabled ? (
        <>
          <Segmented
            label="Quincaillerie"
            value={config.hardware}
            options={[
              { value: 'pin', label: 'Goupille & oeillets' },
              { value: 'twisted', label: 'Fils torsades' },
            ]}
            hint="Comment les pieces se lient : une goupille acier traversant des boucles d oeillets, ou des paires de fils torsades entrelaces colles dans des logements sur les faces de joint."
            onChange={(hardware) => onChange({ hardware })}
          />
          <RangeSlider
            label="Nombre d oeillets"
            value={config.eyeCount}
            range={LIMITS.eyeCount}
            format={(v) => `${v.toFixed(0)}`}
            hint="Combien de points tiennent le joint. En changer redistribue l espacement le long du corps."
            onChange={(eyeCount) => onChange({ eyeCount })}
          />
          <button type="button" className="btn btn--block" onClick={onFit}>
            Ajuster au corps
          </button>
          <p className="control__hint">
            Redistribue les oeillets et fait passer la goupille sur toute la hauteur du
            corps a cette station.
          </p>

          <RangeSlider
            label="Position X"
            value={config.positionMm > 0 ? config.positionMm : lengthMm * 0.55}
            range={{ min: 5, max: Math.max(lengthMm - 5, 10), step: 0.1 }}
            format={(v) => `${v.toFixed(1)} mm`}
            onChange={(positionMm) => onChange({ positionMm })}
          />
          <RangeSlider
            label="Debattement"
            value={config.swing}
            range={LIMITS.jointSwing}
            format={(v) => `${v.toFixed(1)} deg`}
            hint={
              effectiveSwing === null
                ? 'Le debattement se lit une fois le joint genere.'
                : `Debat d environ ${(effectiveSwing / 2).toFixed(0)} deg de chaque cote avant que le joint ou la quincaillerie bloque — le jeu de joint et la profondeur de fente influent aussi.`
            }
            onChange={(swing) => onChange({ swing })}
          />
          <RangeSlider
            label="Angle de face"
            value={config.faceAngle}
            range={LIMITS.jointFaceAngle}
            format={(v) => `${v.toFixed(1)} deg`}
            hint="Le biseau que tu scierais de chaque cote — 45 deg donne une encoche a angle droit. Ouverture en V totale de 90 deg."
            onChange={(faceAngle) => onChange({ faceAngle })}
          />
          <RangeSlider
            label="Jeu de joint"
            value={config.clearance}
            range={LIMITS.jointClearance}
            format={(v) => `${v.toFixed(2)} mm`}
            onChange={(clearance) => onChange({ clearance })}
          />

          <RangeSlider
            label="Poids par oeillet"
            value={config.eyeMass}
            range={LIMITS.jointMass}
            format={(v) => `${v.toFixed(2)} g`}
            onChange={(eyeMass) => onChange({ eyeMass })}
          />
          <RangeSlider
            label="Poids de la goupille"
            value={config.pinMass}
            range={LIMITS.jointMass}
            format={(v) => `${v.toFixed(2)} g`}
            onChange={(pinMass) => onChange({ pinMass })}
          />
          {config.eyeMass <= 0 || (config.hardware === 'pin' && config.pinMass <= 0) ? (
            <p className="control__hint" style={{ color: 'var(--amber)' }}>
              Poids de la quincaillerie non renseigne — le verdict de flottabilite l ignore.
            </p>
          ) : null}

          <Switch
            label="Afficher goupille et oeillets"
            checked={config.showHardware}
            onChange={(showHardware) => onChange({ showHardware })}
          />
        </>
      ) : null}
    </Fieldset>
  );
}

export function JointEyeInspector({
  config,
  onChange,
}: {
  config: ArticulationConfig;
  onChange: (patch: Partial<ArticulationConfig>) => void;
}) {
  return (
    <Fieldset legend="Oeillet a vis" hint="S applique a tous les oeillets.">
      <RangeSlider
        label="Diametre de boucle"
        value={config.eyeLoop}
        range={LIMITS.eyeLoop}
        format={(v) => `${v.toFixed(1)} mm`}
        onChange={(eyeLoop) => onChange({ eyeLoop })}
      />
      <RangeSlider
        label="Diametre de fil"
        value={config.eyeWire}
        range={LIMITS.eyeWire}
        format={(v) => `${v.toFixed(2)} mm`}
        onChange={(eyeWire) => onChange({ eyeWire })}
      />
      <RangeSlider
        label="Longueur"
        value={config.eyeLength}
        range={LIMITS.eyeLength}
        format={(v) => `${v.toFixed(1)} mm`}
        onChange={(eyeLength) => onChange({ eyeLength })}
      />
    </Fieldset>
  );
}

export function JointSlotInspector({
  config,
  onChange,
}: {
  config: ArticulationConfig;
  onChange: (patch: Partial<ArticulationConfig>) => void;
}) {
  return (
    <Fieldset legend="Fente" hint="S applique a toutes les fentes.">
      <RangeSlider
        label="Hauteur"
        value={config.slotHeight}
        range={LIMITS.slotHeight}
        format={(v) => `${v.toFixed(1)} mm`}
        hint="Epaisseur de la fente, mesuree en travers du corps."
        onChange={(slotHeight) => onChange({ slotHeight })}
      />
      <RangeSlider
        label="Profondeur"
        value={config.slotDepth}
        range={LIMITS.slotDepth}
        format={(v) => `${v.toFixed(1)} mm`}
        onChange={(slotDepth) => onChange({ slotDepth })}
      />
      <RangeSlider
        label="Largeur"
        value={config.slotWidth}
        range={LIMITS.slotWidth}
        format={(v) => `${v.toFixed(1)} mm`}
        hint="Etendue verticale de la fente ; elle se cale sur les colonnes du maillage."
        onChange={(slotWidth) => onChange({ slotWidth })}
      />
    </Fieldset>
  );
}

// ---------------------------------------------------------------------------
// Rainure de collant
// ---------------------------------------------------------------------------

export function InlayInspector({
  inlay,
  onChange,
  onEditOutline,
}: {
  inlay: Inlay;
  onChange: (patch: Partial<Inlay>) => void;
  onEditOutline: () => void;
}) {
  return (
    <Fieldset
      legend="Rainure de collant"
      hint="Un creux plat sur le flanc, pour qu un collant reflechissant decoupe affleure la surface au lieu de depasser."
    >
      <Segmented
        label="Forme"
        value={inlay.shape}
        options={[
          { value: 'oval', label: 'Ovale' },
          { value: 'teardrop', label: 'Goutte' },
          { value: 'band', label: 'Bande' },
          { value: 'flank', label: 'Flanc' },
          { value: 'custom', label: 'Tracee' },
        ]}
        wrap
        onChange={(shape) => onChange({ shape })}
      />

      {inlay.shape === 'custom' ? (
        <>
          <button type="button" className="btn btn--primary btn--block" onClick={onEditOutline}>
            {inlay.outline.nodes.length >= 2 ? 'Modifier le contour' : 'Dessiner le contour'}
          </button>
          {inlay.outline.nodes.length < 2 ? (
            <p className="control__hint" style={{ color: 'var(--amber)' }}>
              Aucun contour trace : la rainure ne creuse rien. Ouvrez l editeur et posez au
              moins deux points, ou choisissez une forme prete.
            </p>
          ) : null}
        </>
      ) : null}

      <RangeSlider
        label="Profondeur"
        value={inlay.depth}
        range={LIMITS.inlayDepth}
        format={(v) => `${v.toFixed(2)} mm`}
        hint="0,25 mm est la reference : environ cinq epaisseurs de feuille de papier, soit un collant reflechissant courant plus sa colle."
        onChange={(depth) => onChange({ depth })}
      />
      <RangeSlider
        label="Marge peripherique"
        value={inlay.margin}
        range={LIMITS.inlayMargin}
        format={(v) => `${v.toFixed(2)} mm`}
        hint="Elargit le creux autour du collant, pour rattraper la decoupe."
        onChange={(margin) => onChange({ margin })}
      />
      <RangeSlider
        label="Rayon des angles"
        value={inlay.cornerRadius}
        range={LIMITS.inlayCorner}
        format={(v) => `${v.toFixed(1)} mm`}
        onChange={(cornerRadius) => onChange({ cornerRadius })}
      />
      <Switch
        label="Miroir babord / tribord"
        checked={inlay.mirror}
        onChange={(mirror) => onChange({ mirror })}
      />

      <p className="control__hint">
        Le fond est lisse : ecailles et decals sont effaces a l interieur, avec une
        transition nette sur le bord. C est une surface de collage.
      </p>

      <RangeSlider
        label="Position sur l axe"
        value={inlay.position}
        range={LIMITS.decalPosition}
        format={(v) => `${(v * 100).toFixed(0)} %`}
        onChange={(position) => onChange({ position })}
      />
      <RangeSlider
        label="Hauteur"
        value={inlay.height}
        range={LIMITS.decalHeight}
        format={(v) => (v === 0 ? 'axe' : v > 0 ? `${(v * 100).toFixed(0)} % dos` : `${(-v * 100).toFixed(0)} % ventre`)}
        onChange={(height) => onChange({ height })}
      />
      <RangeSlider
        label="Rotation"
        value={inlay.rotation}
        range={LIMITS.decalRotation}
        format={(v) => `${v.toFixed(0)} deg`}
        onChange={(rotation) => onChange({ rotation })}
      />
      <RangeSlider
        label="Largeur"
        value={inlay.size}
        range={LIMITS.decalSize}
        format={(v) => `${v.toFixed(1)} mm`}
        onChange={(size) => onChange({ size })}
      />
    </Fieldset>
  );
}

// ---------------------------------------------------------------------------
// Goupilles cylindriques d'assemblage
// ---------------------------------------------------------------------------

export function DowelInspector({
  config,
  placements,
  onChange,
}: {
  config: DowelConfig;
  placements: DowelPlacement[];
  onChange: (patch: Partial<DowelConfig>) => void;
}) {
  const refused = placements.filter((item) => !item.valid);
  const source = config.pins.length > 0 ? config.pins : autoDowels(config.count);

  return (
    <Fieldset
      legend="Goupilles d assemblage"
      hint="Des barreaux cylindriques imprimes a part, qui alignent les deux demi-coques pendant le collage et reprennent l effort. Ils ne remplacent pas le logement en 8 de la quincaillerie : les deux cohabitent."
    >
      <Switch
        label="Goupilles cylindriques"
        checked={config.enabled}
        onChange={(enabled) => onChange({ enabled })}
      />

      {config.enabled ? (
        <>
          <RangeSlider
            label="Nombre de goupilles"
            value={config.count}
            range={LIMITS.dowelCount}
            format={(v) => `${v.toFixed(0)}`}
            hint="Reparties automatiquement le long du corps. Deplacez-en une pour figer la liste."
            onChange={(count) => onChange({ count, pins: [] })}
          />
          <RangeSlider
            label="Diametre de goupille"
            value={config.diameter}
            range={LIMITS.dowelDiameter}
            format={(v) => `${v.toFixed(1)} mm`}
            onChange={(diameter) => onChange({ diameter })}
          />
          <RangeSlider
            label="Longueur d engagement"
            value={config.engagement}
            range={LIMITS.dowelEngagement}
            format={(v) => `${v.toFixed(1)} mm`}
            hint="Par cote. Le barreau imprime fait donc environ le double."
            onChange={(engagement) => onChange({ engagement })}
          />
          <RangeSlider
            label="Jeu logement / goupille"
            value={config.clearance}
            range={LIMITS.dowelClearance}
            format={(v) => `${v.toFixed(2)} mm`}
            hint="Jeu diametral. Une valeur absolue, elle ne suit pas la taille de la goupille."
            onChange={(clearance) => onChange({ clearance })}
          />
          <RangeSlider
            label="Chanfrein d entree"
            value={config.chamfer}
            range={LIMITS.dowelChamfer}
            format={(v) => `${v.toFixed(2)} mm`}
            hint="Il evite d avoir a forcer a l engagement, et rattrape le bourrelet de premiere couche."
            onChange={(chamfer) => onChange({ chamfer })}
          />

          <p className="control__hint">
            Barreau imprime : {config.diameter.toFixed(1)} mm de diametre sur{' '}
            {(config.engagement * 2 - config.chamfer * 0.5).toFixed(1)} mm de long,
            couche a plat a cote des coques.
          </p>

          {source.map((pin, index) => {
            const placement = placements[index];
            return (
              <div
                className={placement && !placement.valid ? 'ballast ballast--invalid' : 'ballast'}
                key={pin.id}
              >
                <div className="ballast__head">
                  <span className="ballast__name">Goupille {index + 1}</span>
                  <span className="ballast__spec">
                    {(pin.position * 100).toFixed(0)} % · {pin.height === 0 ? 'axe' : pin.height.toFixed(2)}
                  </span>
                </div>
                <RangeSlider
                  label="Position sur l axe"
                  value={pin.position}
                  range={LIMITS.anchorPosition}
                  format={(v) => `${(v * 100).toFixed(0)} %`}
                  onChange={(position) =>
                    onChange({
                      pins: source.map((item, k) =>
                        k === index ? { ...item, position } : { ...item },
                      ),
                    })
                  }
                />
                <RangeSlider
                  label="Hauteur"
                  value={pin.height}
                  range={LIMITS.anchorHeight}
                  format={(v) => (v === 0 ? 'axe' : v > 0 ? `${(v * 100).toFixed(0)} % dos` : `${(-v * 100).toFixed(0)} % ventre`)}
                  onChange={(height) =>
                    onChange({
                      pins: source.map((item, k) =>
                        k === index ? { ...item, height } : { ...item },
                      ),
                    })
                  }
                />
                {placement && !placement.valid ? (
                  <p className="control__hint" style={{ color: 'var(--red)' }}>
                    {placement.problem}
                  </p>
                ) : null}
              </div>
            );
          })}

          {refused.length > 0 ? (
            <p className="control__hint" style={{ color: 'var(--amber)' }}>
              {refused.length} logement(s) non creuse(s) : mieux vaut une coque pleine qu un
              percage qui sort de la piece.
            </p>
          ) : null}
        </>
      ) : null}
    </Fieldset>
  );
}

// ---------------------------------------------------------------------------
// Fabrication
// ---------------------------------------------------------------------------

export function PrintInspector({
  print,
  params,
  onChange,
  onParams,
}: {
  print: PrintConfig;
  params: LureParams;
  onChange: (patch: Partial<PrintConfig>) => void;
  onParams: (patch: Partial<LureParams>) => void;
}) {
  return (
    <>
      <Segmented
        label="Procede"
        value={print.process}
        options={[
          { value: 'fdm', label: 'FDM' },
          { value: 'resin', label: 'Resine' },
          { value: 'wood', label: 'Bois' },
        ]}
        hint="Il filtre la liste des matieres : on ne remplit pas un bloc de tilleul a 25 %."
        onChange={(process) => {
          // Changer de procede sans changer de matiere ne changerait rien au
          // verdict : on bascule sur la premiere matiere du procede choisi,
          // sauf si celle en cours lui appartient deja.
          const list = materialsFor(process);
          const keep = list.some((item) => item.id === params.material);
          onChange({ process });
          if (!keep && list.length > 0) onParams({ material: list[0].id, infill: list[0].defaultInfill });
        }}
      />

      <div className="control">
        <label className="control__label" htmlFor="material-select">
          Materiau
        </label>
        <select
          id="material-select"
          className="control__select"
          value={params.material}
          onChange={(event) => {
            const next = materialsFor(print.process).find(
              (item) => item.id === event.target.value,
            );
            if (next) onParams({ material: next.id, infill: next.defaultInfill });
          }}
        >
          {materialsFor(print.process).map((item) => (
            <option key={item.id} value={item.id}>
              {item.label} — {item.density.toFixed(2)} g/cm3
            </option>
          ))}
        </select>
        <p className="control__hint">{getMaterial(params.material).summary}</p>
      </div>
      <RangeSlider
        label="Parois de perimetre"
        value={print.perimeters}
        range={LIMITS.perimeters}
        format={(v) => `${v.toFixed(0)}`}
        hint="Elles comptent dans la masse : la coque existe meme a remplissage nul."
        onChange={(perimeters) => onChange({ perimeters })}
      />
      <RangeSlider
        label="Remplissage"
        value={params.infill}
        range={LIMITS.infill}
        format={(v) => `${v.toFixed(0)} %`}
        onChange={(infill) => onParams({ infill })}
      />
      <Switch
        label="Imprimer en deux moities"
        checked={params.assembly.enabled}
        hint="Genere le plan de separation, les goujons d alignement et les logements de goupille."
        onChange={(enabled) =>
          onParams({ assembly: { ...params.assembly, enabled } })
        }
      />

      <details className="advanced">
        <summary>Parametres avances</summary>
        <RangeSlider
          label="Hauteur de couche"
          value={print.layerHeight}
          range={LIMITS.layerHeight}
          format={(v) => `${v.toFixed(2)} mm`}
          onChange={(layerHeight) => onChange({ layerHeight })}
        />
        <RangeSlider
          label="Tolerance des logements"
          value={print.socketTolerance}
          range={LIMITS.socketTolerance}
          format={(v) => `${v.toFixed(2)} mm`}
          onChange={(socketTolerance) => onChange({ socketTolerance })}
        />
        <RangeSlider
          label="Compensation de retrait"
          value={print.shrinkage}
          range={LIMITS.shrinkage}
          format={(v) => `${v.toFixed(2)} %`}
          onChange={(shrinkage) => onChange({ shrinkage })}
        />
      </details>

      <Segmented
        label="Finition"
        value={print.finish}
        options={[
          { value: 'smooth', label: 'Lisse' },
          { value: 'faceted', label: 'Facette' },
        ]}
        onChange={(finish) => onChange({ finish })}
      />
      <Segmented
        label="Resolution d apercu"
        value={print.preview}
        options={[
          { value: 'low', label: 'Basse' },
          { value: 'medium', label: 'Moyenne' },
          { value: 'high', label: 'Haute' },
        ]}
        hint="Compromis fluidite / precision. Les exports partent toujours de la resolution pleine."
        onChange={(preview) => onChange({ preview })}
      />
    </>
  );
}
