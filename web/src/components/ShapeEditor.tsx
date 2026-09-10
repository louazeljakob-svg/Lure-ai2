/** Panneau gauche — parametres de forme du corps, de la bavette et de la queue. */

import type {
  BillMode,
  BillProfile,
  DetailConfig,
  EyeStyle,
  LureParams,
  ShapeId,
  TailShape,
} from '../types/lure';
import { articulationBlocker } from '../lib/articulation';
import { LIMITS, SHAPE_PRESETS } from '../lib/presets';
import { billSize } from '../lib/billTemplate';
import { Fieldset, Segmented, Slider, Switch } from './ui';

interface Props {
  params: LureParams;
  onChange: (patch: Partial<LureParams>) => void;
  /** Coupe le corps en deux segments articules, depuis le panneau de forme. */
  onAddArticulation: () => void;
  onLoadPreset: (shape: ShapeId) => void;
  sculpting: boolean;
  onSculptingChange: (active: boolean) => void;
  selectedSculpt: string | null;
  onBuildCage: () => void;
  onClearCage: () => void;
  onUpdateSculpt: (id: string, patch: { amount?: number; radius?: number }) => void;
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

export function ShapeEditor({
  params,
  onChange,
  onAddArticulation,
  onLoadPreset,
  sculpting,
  onSculptingChange,
  selectedSculpt,
  onBuildCage,
  onClearCage,
  onUpdateSculpt,
}: Props) {
  const active = params.sculpt.find((point) => point.id === selectedSculpt) ?? null;
  const jointBlocker = articulationBlocker(params);
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

        {/*
          Raccourci vers l'articulation. Elle vit dans l'arbre de scene, mais
          on decide de couper un corps en deux en le regardant, pas en
          fouillant un menu : l'entree doit donc etre la aussi.
        */}
        {params.articulation.enabled ? (
          <p className="control__hint">
            Corps articule en deux segments — le joint se regle dans l onglet Scene.
          </p>
        ) : (
          <>
            <button
              type="button"
              className="btn btn--block"
              disabled={!!jointBlocker}
              onClick={onAddArticulation}
            >
              Couper en deux segments articules
            </button>
            <p className="control__hint" style={jointBlocker ? { color: 'var(--amber)' } : undefined}>
              {jointBlocker ??
                'Deux segments relies par une goupille et des oeillets. Le corps passe en une piece : l articulation coupe en travers.'}
            </p>
          </>
        )}
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
          <p className="control__hint">
            Les deux coques recoivent la meme fente, taillee comme l empreinte exacte de la
            plaque majoree du seul jeu d insertion, et debouchante par l avant de la tete.
            Le gabarit plat s exporte en DXF ou SVG. La bavette affichee ici n est qu un
            fantome d aide au placement — jamais incluse dans les STL ni les STEP.
          </p>
        ) : null}
        <Switch
          label="Echelle liee"
          checked={params.billUniform}
          onChange={(billUniform) => onChange({ billUniform })}
          hint="Largeur et epaisseur suivent la longueur, aux proportions de la bavette de reference (37,1 x 18,2 x 3,0 mm). Decochez pour les regler separement."
        />
        <Slider
          label="Epaisseur"
          value={params.billThickness}
          {...LIMITS.billThickness}
          display={params.billUniform ? `${billSize(params).thickness.toFixed(1)} mm (liee)` : mm(params.billThickness)}
          disabled={!params.hasBib || params.billUniform}
          hint="Independante de la longueur et de la largeur, sauf en echelle liee."
          onChange={(billThickness) => onChange({ billThickness })}
        />
        <Slider
          label="Position depuis le nez"
          value={params.billOffset}
          {...LIMITS.billOffset}
          display={mm(params.billOffset)}
          disabled={!params.hasBib}
          hint="Recul du point d ancrage. La fente d insertion suit."
          onChange={(billOffset) => onChange({ billOffset })}
        />
        <Segmented
          label="Profil de coupe"
          hint="« Arrondi » est la bavette universelle de reference, relevee sur le modele fourni. Les deux autres sont des profils simples."
          value={params.billProfile}
          options={[
            { value: 'rounded' as BillProfile, label: 'Arrondi' },
            { value: 'rect' as BillProfile, label: 'Droit' },
            { value: 'diamond' as BillProfile, label: 'Losange' },
          ]}
          onChange={(billProfile) => onChange({ billProfile })}
        />
        <Slider
          label="Conge des aretes"
          value={params.billFillet}
          {...LIMITS.billFillet}
          display={params.billFillet < 0.05 ? 'Vif' : mm(params.billFillet)}
          disabled={!params.hasBib || params.billProfile === 'rounded'}
          hint={
            params.billProfile === 'rounded'
              ? 'Le profil arrondi est deja continu : le conge ne s applique qu aux profils a angles.'
              : 'Adoucit les angles du contour, gabarit de decoupe compris.'
          }
          onChange={(billFillet) => onChange({ billFillet })}
        />
        <Slider
          label="Vrille"
          value={params.billTwist}
          {...LIMITS.billTwist}
          display={`${params.billTwist > 0 ? '+' : ''}${params.billTwist.toFixed(0)} deg`}
          disabled={!params.hasBib}
          hint="Torsion sur l axe propre de la bavette, en plus de son inclinaison."
          onChange={(billTwist) => onChange({ billTwist })}
        />
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
          display={
            params.billUniform ? `${billSize(params).width.toFixed(1)} mm (liee)` : mm(params.bibWidth)
          }
          disabled={!params.hasBib || params.billUniform}
          onChange={(bibWidth) => onChange({ bibWidth })}
        />
      </Fieldset>

      <Fieldset
        legend="Cage de sculpture"
        hint="Une grille de points superposee au corps. Glissez une poignee vers le haut ou vers le bas dans la vue 3D pour tirer ou creuser la peau localement, par-dessus la forme des sliders."
      >
        <Switch
          label="Afficher la cage"
          checked={sculpting}
          onChange={onSculptingChange}
        />
        <div className="export-dock__actions">
          <button type="button" className="btn btn--sm" onClick={onBuildCage}>
            {params.sculpt.length > 0 ? 'Regenerer' : 'Creer la cage'}
          </button>
          <button
            type="button"
            className="btn btn--sm btn--ghost btn--danger"
            onClick={onClearCage}
            disabled={params.sculpt.length === 0}
          >
            Effacer
          </button>
        </div>
        {params.sculpt.length === 0 ? (
          <p className="control__hint">
            Aucune cage : la forme suit uniquement les parametres.
          </p>
        ) : (
          <p className="control__hint">
            {params.sculpt.length} points ·{' '}
            {params.sculpt.filter((point) => Math.abs(point.amount) > 0.05).length} deplaces.
          </p>
        )}
        {active ? (
          <>
            <Slider
              label="Deplacement"
              value={active.amount}
              {...LIMITS.sculptAmount}
              display={`${active.amount > 0 ? '+' : ''}${active.amount.toFixed(2)} mm`}
              onChange={(amount) => onUpdateSculpt(active.id, { amount })}
            />
            <Slider
              label="Rayon d influence"
              value={active.radius}
              {...LIMITS.sculptRadius}
              display={`${Math.round(active.radius * 100)} % de la longueur`}
              onChange={(radius) => onUpdateSculpt(active.id, { radius })}
            />
          </>
        ) : null}
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
