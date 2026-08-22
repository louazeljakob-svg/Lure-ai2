/** Panneau Reference : images calees dans les plans, mises a l'echelle reelle. */

import { useRef, useState } from 'react';
import { REFERENCE_PLANES, type ReferenceImage, type ReferencePlane } from '../lib/reference';
import { Fieldset, Segmented, Slider, Switch } from './ui';

interface Props {
  references: ReferenceImage[];
  onImport: (file: File) => void;
  onUpdate: (id: string, patch: Partial<ReferenceImage>) => void;
  onRemove: (id: string) => void;
  calibratingId: string | null;
  picks: { u: number; v: number }[];
  onStartCalibration: (id: string | null) => void;
  onApplyCalibration: (millimetres: number) => void;
}

export function ReferencePanel({
  references,
  onImport,
  onUpdate,
  onRemove,
  calibratingId,
  picks,
  onStartCalibration,
  onApplyCalibration,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [distance, setDistance] = useState('108');

  return (
    <div className="panel__body">
      <Fieldset
        legend="Images de reference"
        hint="Chargez une photo ou un croquis cote, calez-le sur un plan, puis mettez-le a l echelle reelle en pointant deux reperes dont vous connaissez la distance. Les images restent en memoire du navigateur et ne partent pas dans le fichier de projet."
      >
        <button type="button" className="btn btn--block" onClick={() => fileRef.current?.click()}>
          Inserer une image
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="sr-only"
          aria-label="Inserer une image de reference"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) onImport(file);
            event.target.value = '';
          }}
        />

        {references.length === 0 ? (
          <p className="empty" style={{ marginTop: 10 }}>
            Aucune reference chargee.
          </p>
        ) : null}
      </Fieldset>

      {references.map((image) => (
        <Fieldset key={image.id} legend={image.name || 'Reference'}>
          <div className="project__actions" style={{ marginBottom: 10 }}>
            <button
              type="button"
              className="btn btn--sm"
              onClick={() => onUpdate(image.id, { visible: !image.visible })}
            >
              {image.visible ? 'Masquer' : 'Afficher'}
            </button>
            <button
              type="button"
              className="btn btn--sm"
              onClick={() => onUpdate(image.id, { flipH: !image.flipH })}
            >
              Miroir H
            </button>
            <button
              type="button"
              className="btn btn--sm"
              onClick={() => onUpdate(image.id, { flipV: !image.flipV })}
            >
              Miroir V
            </button>
            <button
              type="button"
              className="btn btn--sm btn--ghost btn--danger"
              onClick={() => onRemove(image.id)}
            >
              Retirer
            </button>
          </div>

          <Segmented
            label="Plan de projection"
            value={image.plane}
            options={REFERENCE_PLANES.map((plane) => ({
              value: plane.id as ReferencePlane,
              label: plane.label,
              title: plane.hint,
            }))}
            onChange={(plane) => onUpdate(image.id, { plane })}
          />

          <Slider
            label="Transparence"
            value={image.opacity}
            min={0.05}
            max={1}
            step={0.05}
            display={`${Math.round(image.opacity * 100)} %`}
            onChange={(opacity) => onUpdate(image.id, { opacity })}
          />
          <Slider
            label="Largeur reelle"
            value={image.widthMm}
            min={10}
            max={400}
            step={0.5}
            display={`${image.widthMm.toFixed(1)} mm`}
            onChange={(widthMm) =>
              onUpdate(image.id, {
                widthMm,
                ...(image.lockAspect ? { heightMm: widthMm * image.aspect } : {}),
              })
            }
          />
          <Slider
            label="Hauteur reelle"
            value={image.heightMm}
            min={10}
            max={400}
            step={0.5}
            display={`${image.heightMm.toFixed(1)} mm`}
            disabled={image.lockAspect}
            onChange={(heightMm) => onUpdate(image.id, { heightMm })}
          />
          <Switch
            label="Verrouiller le ratio"
            checked={image.lockAspect}
            onChange={(lockAspect) =>
              onUpdate(image.id, {
                lockAspect,
                ...(lockAspect ? { heightMm: image.widthMm * image.aspect } : {}),
              })
            }
          />

          <Slider
            label="Decalage longitudinal"
            value={image.offsetX}
            min={-150}
            max={150}
            step={0.5}
            display={`${image.offsetX.toFixed(1)} mm`}
            onChange={(offsetX) => onUpdate(image.id, { offsetX })}
          />
          <Slider
            label="Decalage vertical"
            value={image.offsetY}
            min={-150}
            max={150}
            step={0.5}
            display={`${image.offsetY.toFixed(1)} mm`}
            onChange={(offsetY) => onUpdate(image.id, { offsetY })}
          />
          <Slider
            label="Recul du plan"
            value={image.depth}
            min={-80}
            max={80}
            step={0.5}
            display={`${image.depth.toFixed(1)} mm`}
            hint="Decalage perpendiculaire au plan de projection."
            onChange={(depth) => onUpdate(image.id, { depth })}
          />
          <Slider
            label="Rotation"
            value={image.angle}
            min={-180}
            max={180}
            step={1}
            display={`${image.angle.toFixed(0)} deg`}
            onChange={(angle) => onUpdate(image.id, { angle })}
          />

          {calibratingId === image.id ? (
            <div className="notice notice--info">
              <span className="notice__icon" aria-hidden="true">
                i
              </span>
              <div>
                <h4>Calibration en cours</h4>
                <p>
                  Cliquez deux reperes sur l image dans la vue 3D ({picks.length}/2 poses), puis
                  saisissez la distance reelle qui les separe.
                </p>
                <div className="export-dock__name" style={{ marginTop: 8 }}>
                  <label className="sr-only" htmlFor={`cal-${image.id}`}>
                    Distance reelle en millimetres
                  </label>
                  <input
                    id={`cal-${image.id}`}
                    type="number"
                    min="1"
                    step="0.1"
                    value={distance}
                    onChange={(event) => setDistance(event.target.value)}
                  />
                  <button
                    type="button"
                    className="btn btn--primary"
                    disabled={picks.length < 2}
                    onClick={() => onApplyCalibration(Number(distance))}
                  >
                    Appliquer
                  </button>
                </div>
                <button
                  type="button"
                  className="btn btn--sm btn--ghost"
                  style={{ marginTop: 6 }}
                  onClick={() => onStartCalibration(null)}
                >
                  Annuler
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="btn btn--block"
              onClick={() => onStartCalibration(image.id)}
            >
              Calibrer a la distance reelle
            </button>
          )}
        </Fieldset>
      ))}
    </div>
  );
}
