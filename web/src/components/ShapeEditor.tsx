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
import { LIMITS, SHAPE_PRESETS, cloneAnatomy, getPreset } from '../lib/presets';
import { AnatomyEditor } from './AnatomyEditor';
import { billSize } from '../lib/billTemplate';
import { meshBodyOf } from '../lib/meshBody';
import { Fieldset, Segmented, Slider, Switch } from './ui';

interface Props {
  params: LureParams;
  onChange: (patch: Partial<LureParams>) => void;
  /** Coupe le corps en deux segments articules, depuis le panneau de forme. */
  onAddArticulation: () => void;
  onLoadPreset: (shape: ShapeId) => void;
}

const TAIL_OPTIONS: { value: TailShape; label: string; title: string }[] = [
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
}: Props) {
  const jointBlocker = articulationBlocker(params);
  const setDetail = (key: 'gills' | 'eyes', patch: Partial<DetailConfig>) =>
    onChange({ [key]: { ...params[key], ...patch } });

  return (
    <div className="panel__body">
      <Fieldset
        legend="Famille"
        hint="Recharge un leurre complet de la bibliotheque. Les reglages en cours sont remplaces."
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

      <Fieldset
        legend="Corps"
        hint={
          params.meshBody
            ? 'Corps tire d un maillage importe : les trois cotes reglent son echelle, axe par axe.'
            : 'Encombrement general et volume du leurre.'
        }
      >
        {params.meshBody ? (
          <div className="control">
            <p className="control__hint">
              {meshBodyOf(params)
                ? `Maillage « ${params.meshBody.name} », ${params.meshBody.lengthMm.toFixed(1)} x ${params.meshBody.heightMm.toFixed(1)} x ${params.meshBody.widthMm.toFixed(1)} mm a l origine. La forme est celle du fichier ; bavette, quincaillerie et coques se reglent comme sur une famille.`
                : `Le maillage « ${params.meshBody.name} » n est plus en memoire : le corps affiche est celui de la famille. Reimportez le STL (Projets > Import) ou rouvrez le projet JSON qui l embarque.`}
            </p>
            <button
              type="button"
              className="btn btn--block"
              onClick={() =>
                onChange({
                  meshBody: null,
                  anatomy: cloneAnatomy(getPreset(params.shape === 'spoon' ? 'minnow' : params.shape).params.anatomy),
                })
              }
            >
              Revenir au corps parametrique de la famille
            </button>
          </div>
        ) : null}
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
        {params.anatomy || params.meshBody ? null : (
        <Slider
          label="Section maitresse"
          value={params.bellyPosition}
          {...LIMITS.bellyPosition}
          display={pct(params.bellyPosition)}
          hint="Point le plus large, en % de la longueur depuis le nez. C est lui qui separe un corps a epaules avant d un corps a ventre arriere."
          onChange={(bellyPosition) => onChange({ bellyPosition })}
        />
        )}
        <div className="control">
          <div className="control__row">
            <span className="control__label">Elancement</span>
            <output className="control__value">
              {(params.length / Math.max(params.thickness, 1)).toFixed(2)}
            </output>
          </div>
          <p className="control__hint">
            Longueur / hauteur, recalcule et non saisi. Un vibe tient entre 2,5 et 3,5, un
            minnow de traine entre 5 et 7, un pencil monte a 9.
          </p>
        </div>
        {params.anatomy || params.meshBody ? null : (
          <>
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
          </>
        )}
        {params.anatomy || params.meshBody ? null : (
          <>
            <button
              type="button"
              className="btn btn--block"
              onClick={() => {
                const family = getPreset(params.shape === 'spoon' ? 'minnow' : params.shape);
                onChange({ anatomy: cloneAnatomy(family.params.anatomy) });
              }}
            >
              Passer au corps anatomique
            </button>
            <p className="control__hint">
              Profil historique : un volume lisse interpole entre le nez et la queue. Le corps
              anatomique de la famille ajoute pedoncule, opercule, orbites et nageoires, en
              gardant les cotes.
            </p>
          </>
        )}

        {/*
          Raccourci vers l'articulation. Elle vit dans l'arbre de scene, mais
          on decide de couper un corps en deux en le regardant, pas en
          fouillant un menu : l'entree doit donc etre la aussi.
        */}
        {params.meshBody ? null : params.articulation.enabled ? (
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
                'Deux segments relies par un cylindre de retention et des oeillets ; chaque segment se coupe ensuite en deux demi-coques.'}
            </p>
          </>
        )}
      </Fieldset>

      {params.meshBody ? null : (
      <Fieldset legend="Modelage" hint="Reglages fins du nez, de la section et de l arriere.">
        {params.anatomy || params.meshBody ? null : (
          <>
        <Slider
          label="Finesse du nez"
          value={params.noseSharpness}
          {...LIMITS.noseSharpness}
          display={params.noseSharpness.toFixed(2)}
          hint="Bas : nez emousse. Haut : nez pointu."
          onChange={(noseSharpness) => onChange({ noseSharpness })}
        />
          </>
        )}
        <Slider
          label="Angle de nez"
          value={params.noseAngle}
          {...LIMITS.noseAngle}
          display={`${params.noseAngle > 0 ? '+' : ''}${params.noseAngle.toFixed(0)} deg`}
          hint="Inclinaison de la tete par rapport a l axe. Positif : nez releve, comme sur un popper. Le reste du corps ne bouge pas."
          onChange={(noseAngle) => onChange({ noseAngle })}
        />
        {params.anatomy || params.meshBody ? null : (
          <>
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
          </>
        )}
        <Slider
          label="Profil de section"
          value={params.crossSection}
          {...LIMITS.crossSection}
          display={params.crossSection < 1.9 ? 'Losange' : params.crossSection > 2.4 ? 'Carree' : 'Ovale'}
          hint="1,4 = section en losange · 2 = ellipse · 3,4 = section carree."
          onChange={(crossSection) => onChange({ crossSection })}
        />
      </Fieldset>
      )}

      {params.anatomy ? (
        <AnatomyEditor anatomy={params.anatomy} onChange={(anatomy) => onChange({ anatomy })} />
      ) : null}

      {params.shape === 'spoon' || params.meshBody ? null : (
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
            { value: 'printed' as BillMode, label: 'Imprimee', title: 'Piece imprimee, prise en sandwich dans la fente' },
            {
              value: 'polycarbonate' as BillMode,
              label: 'Polycarbonate',
              title: 'Decoupee a plat, inseree dans une fente',
            },
          ]}
          onChange={(billMode) => onChange({ billMode })}
        />
        <p className="control__hint">
          Les deux modes recoivent la meme fente, fendue dans le plan de joint : chaque coque en
          porte la moitie et la plaque se prend en sandwich. Elle est l empreinte exacte de la
          plaque, majoree du seul jeu d insertion, bornee a sa largeur et a son enfoncement.{' '}
          {params.billMode === 'polycarbonate'
            ? 'La plaque se decoupe dans du polycarbonate : gabarit plat en DXF ou SVG. La bavette affichee n est qu un fantome d aide au placement, jamais incluse dans les STL.'
            : 'La plaque imprimee sort en piece STL a part (« Bavette » dans l export).'}
        </p>
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
          hint="Recul du point d ancrage, mesure depuis la pointe du nez. La fente s ouvre exactement la, sans se deplacer d elle-meme : si la plaque n y tient pas, c est dit."
          onChange={(billOffset) => onChange({ billOffset })}
        />
        <Slider
          label="Enfoncement"
          value={params.billInsertion}
          {...LIMITS.billInsertion}
          display={params.billInsertion > 0 ? mm(params.billInsertion) : 'jusqu a buter'}
          disabled={!params.hasBib}
          hint="Longueur de plaque logee dans la tete, depuis la peau du menton. Au-dela de ce que la tete admet, la fente est refusee et la profondeur maximale est annoncee."
          onChange={(billInsertion) => onChange({ billInsertion })}
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

      {params.meshBody ? null : (
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
          disabled={params.tailShape === 'round'}
          hint={
            params.tailShape === 'round'
              ? 'Disponible pour les queues fourchue, palette et eventail.'
              : 'Une grande caudale amplifie la battue mais freine le leurre.'
          }
          onChange={(tailSize) => onChange({ tailSize })}
        />
      </Fieldset>
      )}
    </div>
  );
}
