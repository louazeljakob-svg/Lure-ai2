/** Controles reutilisables : sliders, segments, interrupteurs, pastilles. */

import { useId, type ReactNode } from 'react';

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  /** Valeur affichee a droite du libelle. */
  display?: string;
  hint?: string;
  disabled?: boolean;
}

export function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  display,
  hint,
  disabled,
}: SliderProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  return (
    <div className="control">
      <div className="control__row">
        <label className="control__label" htmlFor={id}>
          {label}
        </label>
        <output className="control__value" htmlFor={id}>
          {display ?? value}
        </output>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-describedby={hint ? hintId : undefined}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      {hint ? (
        <p className="control__hint" id={hintId}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export interface Option<T extends string> {
  value: T;
  label: string;
  title?: string;
}

interface SegmentedProps<T extends string> {
  label: string;
  value: T;
  options: Option<T>[];
  onChange: (value: T) => void;
  wrap?: boolean;
  hint?: string;
}

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  wrap,
  hint,
}: SegmentedProps<T>) {
  const id = useId();
  return (
    <div className="control">
      <div className="control__row">
        <span className="control__label" id={id}>
          {label}
        </span>
      </div>
      <div className={wrap ? 'segmented segmented--wrap' : 'segmented'} role="group" aria-labelledby={id}>
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            title={option.title}
            aria-pressed={option.value === value}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
      {hint ? <p className="control__hint">{hint}</p> : null}
    </div>
  );
}

interface SwitchProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  hint?: string;
}

export function Switch({ label, checked, onChange, hint }: SwitchProps) {
  return (
    <div className="control">
      <button
        type="button"
        className="switch"
        aria-pressed={checked}
        onClick={() => onChange(!checked)}
      >
        <span className="switch__label">{label}</span>
        <span className="switch__track" aria-hidden="true" />
      </button>
      {hint ? <p className="control__hint">{hint}</p> : null}
    </div>
  );
}

interface ColorFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
}

export function ColorField({ label, value, onChange }: ColorFieldProps) {
  const id = useId();
  return (
    <div className="swatch">
      <input
        id={id}
        type="color"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      <label htmlFor={id}>
        <span>{label}</span>
      </label>
    </div>
  );
}

interface FieldsetProps {
  legend: string;
  hint?: string;
  children: ReactNode;
}

export function Fieldset({ legend, hint, children }: FieldsetProps) {
  return (
    <fieldset className="fieldset">
      <legend>{legend}</legend>
      {hint ? <p className="fieldset__hint">{hint}</p> : null}
      {children}
    </fieldset>
  );
}
