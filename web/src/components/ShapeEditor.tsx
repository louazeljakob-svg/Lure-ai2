/** Panneau gauche — parametres de forme du corps, de la bavette et de la queue. */

import type { BillMode, DetailConfig, EyeStyle, LureParams, ShapeId, TailShape } from '../types/lure';
import { LIMITS, SHAPE_PRESETS } from '../lib/presets';
import { Fieldset, Segmented, Slider, Switch } from './ui';

interface Props {
  params: LureParams;
  onChange: (patch: Partial<LureParams>) => void;
  onLoadPreset: (shape: ShapeId) => void;
}

const TAIL_OPTIONS: { value: TailShape; label: string; title: string }[] = [
  { value: 'taper', label: 'Pointe', title: 'Corps effile qui se ferme en pointe' },
  { value: 'round', label: 'Ronde', title: 'Arriere arrondi, tres flottant' },
  { value: 'forked', label: 'Fourchue', title: 'Caudale echancree, type poisson fourrage' },
  { value: 'paddle', label: 'Palette', title: 'Palette de swimbait, forte battue' },
  { value: 'fan', label: 'Eventail', title: 'Lame triangulaire, type cuiller' },
];

const mm = (value: number) => `${value.toFixed(value < 10 ? 1 : 0)} mm`;
const pct = (value: number) => `${Math.round(value * 100)} %`;

const reliefLabel = (value: number): string =>
  `${value > 0 ? '+' : ''}${value.toFixed(2)} mm`;

/**
 * Bibliotheque d'yeux : chaque style est un point de depart qui pilote le
 * relief et la maniere dont l'iris est peint. Tout reste ensuite ajustable.
 */
const EYE_STYLES: { value: EyeStyle; label: string; relief: number | null; hint: string }[] = [
  { value: 'realistic', label: 'Realiste', relief: 0.6, hint: 'Cuvette annulaire et iris legerement bombe.' },
  { value: 'globular', label: 'Globuleux', relief: -0.9, hint: 'Calotte pleine en saillie, tres visible de profil.' },
  { value: 'holographic', label: 'Holographique', relief: 0.5, hint: 'Iris en anneaux concentriques, facon pastille holo.' },
  { value: 'custom', label: 'Libre', relief: null, hint: 'Aucun reglage impose : le relief reste celui que vous fixez.' },
];

export function ShapeEditor({ params, onChange, onLoadPreset }: Props) {
  const setDetail = (key: 'gills' | 'eyes', patch: Partial<DetailConfig>) =>
    onChange({ [key]: { ...params[key], ...patch } });

  return (
    <div className="panel__body">
      <Fieldset
        legend="Gabarit de depart"
        hint="Recharge une forme de base. Les reglages en cours sont remplaces."
      >
        <Segmented
          label="Forme"
          value={params.shape}
          wrap
          options={SHAPE_PRESETS.map((preset) => ({
            value: preset.id,
            label: preset.label,
            title: preset.tagline,
          }))}
          onChange={onLoadPreset}
        />
      </Fieldset>

      <Fieldset legend="Corps" hint="Encombrement general et volume du leurre.">
        <Slider
          label="Longueur totale"
          value={params.length}
          {...LIMITS.length}
          display={mm(params.length)}
          onChange={(length) => onChange({ length })}
        />
        <Slider
          label="Largeur max"
          value={params.maxWidth}
          {...LIMITS.maxWidth}
          display={mm(params.maxWidth)}
          hint="Vue de dessus : largeur laterale au point le plus large."
          onChange={(maxWidth) => onChange({ maxWidth })}
        />
        <Slider
          label="Epaisseur"
          value={params.thickness}
          {...LIMITS.thickness}
          display={mm(params.thickness)}
          hint="Vue de profil : hauteur dos-ventre du corps."
          onChange={(thickness) => onChange({ thickness })}
        />
        <Slider
          label="Position du ventre"
          value={params.bellyPosition}
          {...LIMITS.bellyPosition}
          display={pct(params.bellyPosition)}
          hint="Point le plus large, en % de la longueur depuis le nez."
          onChange={(bellyPosition) => onChange({ bellyPosition })}
        />
        <Slider
          label="Courbure dorsale"
          value={params.dorsalCurve}
          {...LIMITS.dorsalCurve}
          display={params.dorsalCurve.toFixed(2)}
          hint="Negatif : dos creuse. Positif : dos bombe facon crankbait."
          onChange={(dorsalCurve) => onChange({ dorsalCurve })}
        />
        <Slider
          label="Courbure ventrale"
          value={params.ventralCurve}
          {...LIMITS.ventralCurve}
          display={params.ventralCurve.toFixed(2)}
          hint="Un ventre rebondi loge les lests bas et stabilise la nage."
          onChange={(ventralCurve) => onChange({ ventralCurve })}
        />
      </Fieldset>

      <Fieldset legend="Modelage" hint="Reglages fins du nez, de la section et de l arriere.">
        <Slider
          label="Finesse du nez"
          value={params.noseSharpness}
          {...LIMITS.noseSharpness}
          display={params.noseSharpness.toFixed(2)}
          hint="Bas : nez emousse. Haut : nez pointu."
          onChange={(noseSharpness) => onChange({ noseSharpness })}
        />
        <Slider
          label="Creux de bouche"
          value={params.mouthCup}
          {...LIMITS.mouthCup}
          display={pct(params.mouthCup)}
          hint="Cuvette frontale du popper : elle projette la gerbe d eau."
          onChange={(mouthCup) => onChange({ mouthCup })}
        />
        <Slider
          label="Effilement arriere"
          value={params.tailTaper}
          {...LIMITS.tailTaper}
          display={params.tailTaper.toFixed(2)}
          hint="Bas : arriere plein. Haut : pedoncule tres fin."
          onChange={(tailTaper) => onChange({ tailTaper })}
        />
        <Slider
          label="Profil de section"
          value={params.crossSection}
          {...LIMITS.crossSection}
          display={params.crossSection < 1.9 ? 'Losange' : params.crossSection > 2.4 ? 'Carree' : 'Ovale'}
          hint="1,4 = section en losange · 2 = ellipse · 3,4 = section carree."
          onChange={(crossSection) => onChange({ crossSection })}
        />
      </Fieldset>

      {params.shape === 'spoon' ? null : (
        <Fieldset
          legend="Details de tete"
          hint="Branchies et yeux sont graves dans le corps lui-meme : le maillage reste ferme et imprimable, sans piece rapportee."
        >
          <Switch
            label="Branchies"
            checked={params.gills.enabled}
            onChange={(enabled) => setDetail('gills', { enabled })}
          />
          <Slider
            label="Position des branchies"
            value={params.gills.position}
            {...LIMITS.gillPosition}
            display={`${Math.round(params.gills.position * 100)} %`}
            disabled={!params.gills.enabled}
            hint="Depuis le nez. L opercule se place juste derriere la tete."
            onChange={(position) => setDetail('gills', { position })}
          />
          <Slider
            label="Taille de l opercule"
            value={params.gills.size}
            {...LIMITS.gillSize}
            display={mm(params.gills.size)}
            disabled={!params.gills.enabled}
            onChange={(size) => setDetail('gills', { size })}
          />
          <Slider
            label="Relief des branchies"
            value={params.gills.relief}
            {...LIMITS.gillRelief}
            display={reliefLabel(params.gills.relief)}
            disabled={!params.gills.enabled}
            hint="Negatif : sillon grave. Positif : bourrelet saillant."
            onChange={(relief) => setDetail('gills', { relief })}
          />

          <Switch
            label="Yeux"
            checked={params.eyes.enabled}
            onChange={(enabled) => setDetail('eyes', { enabled })}
          />
          <Slider
            label="Position des yeux"
            value={params.eyes.position}
            {...LIMITS.eyePosition}
            display={`${Math.round(params.eyes.position * 100)} %`}
            disabled={!params.eyes.enabled}
            onChange={(position) => setDetail('eyes', { position })}
          />
          <Slider
            label="Diametre de l oeil"
            value={params.eyes.size}
            {...LIMITS.eyeSize}
            display={mm(params.eyes.size)}
            disabled={!params.eyes.enabled}
            onChange={(size) => setDetail('eyes', { size })}
          />
          <Segmented
            label="Style d oeil"
            value={params.eyeStyle}
            wrap
            options={EYE_STYLES.map((style) => ({
              value: style.value,
              label: style.label,
              title: style.hint,
            }))}
            onChange={(eyeStyle) => {
              const style = EYE_STYLES.find((item) => item.value === eyeStyle);
              onChange({
                eyeStyle,
                ...(style?.relief !== null && style
                  ? { eyes: { ...params.eyes, relief: style.relief } }
                  : {}),
              });
            }}
          />
          <p className="control__hint">
            {EYE_STYLES.find((style) => style.value === params.eyeStyle)?.hint}
          </p>
          <Slider
            label="Relief de l oeil"
            value={params.eyes.relief}
            {...LIMITS.eyeRelief}
            display={reliefLabel(params.eyes.relief)}
            disabled={!params.eyes.enabled}
            hint="Positif : cuvette creusee et iris bombe. Negatif : oeil entierement bombe."
            onChange={(relief) => setDetail('eyes', { relief })}
          />
        </Fieldset>
      )}

      <Fieldset legend="Bavette" hint="Elle transforme la traction en plongee et en oscillation.">
        <Switch
          label="Leurre a bavette"
          checked={params.hasBib}
          onChange={(hasBib) => onChange({ hasBib })}
        />
        <Segmented
          label="Fabrication"
          value={params.billMode}
          options={[
            { value: 'printed' as BillMode, label: 'Imprimee', title: 'Integree au corps' },
            {
              value: 'polycarbonate' as BillMode,
              label: 'Polycarbonate',
              title: 'Decoupee a plat, inseree dans une fente',
            },
          ]}
          onChange={(billMode) => onChange({ billMode })}
        />
        {params.billMode === 'polycarbonate' ? (
          <>
            <p className="control__hint">
              Le corps recoit une fente d insertion et le gabarit plat s exporte en DXF ou
              SVG depuis le bloc d export. La fente s arrete a quelques dixiemes de la peau :
              on l ouvre a la lime au montage, comme sur une bavette du commerce.
            </p>
            <Slider
              label="Epaisseur du polycarbonate"
              value={params.billThickness}
              {...LIMITS.billThickness}
              display={mm(params.billThickness)}
              disabled={!params.hasBib}
              onChange={(billThickness) => onChange({ billThickness })}
            />
          </>
        ) : null}
        <Slider
          label="Angle"
          value={params.bibAngle}
          {...LIMITS.bibAngle}
          display={`${params.bibAngle.toFixed(0)} deg`}
          disabled={!params.hasBib}
          hint="Mesure par rapport a l axe du corps. Faible = plongeante et serree, fort = nage large en sub-surface."
          onChange={(bibAngle) => onChange({ bibAngle })}
        />
        <Slider
          label="Longueur de bavette"
          value={params.bibLength}
          {...LIMITS.bibLength}
          display={mm(params.bibLength)}
          disabled={!params.hasBib}
          onChange={(bibLength) => onChange({ bibLength })}
        />
        <Slider
          label="Largeur de bavette"
          value={params.bibWidth}
          {...LIMITS.bibWidth}
          display={mm(params.bibWidth)}
          disabled={!params.hasBib}
          onChange={(bibWidth) => onChange({ bibWidth })}
        />
      </Fieldset>

      <Fieldset legend="Queue">
        <Segmented
          label="Forme de la queue"
          value={params.tailShape}
          options={TAIL_OPTIONS}
          wrap
          onChange={(tailShape) => onChange({ tailShape })}
        />
        <Slider
          label="Taille de la caudale"
          value={params.tailSize}
          {...LIMITS.tailSize}
          display={`x ${params.tailSize.toFixed(2)}`}
          disabled={params.tailShape === 'taper' || params.tailShape === 'round'}
          hint={
            params.tailShape === 'taper' || params.tailShape === 'round'
              ? 'Disponible pour les queues fourchue, palette et eventail.'
              : 'Une grande caudale amplifie la battue mais freine le leurre.'
          }
          onChange={(tailSize) => onChange({ tailSize })}
        />
      </Fieldset>
    </div>
  );
}
