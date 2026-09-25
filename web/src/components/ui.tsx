/** Controles reutilisables : sliders, segments, interrupteurs, pastilles. */

import { createContext, useContext, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

/**
 * Coupe la pile d'annulation (module AJ.5) : une saisie validee au clavier
 * compte pour un seul geste, jamais fusionnee avec le glisser d'un curseur
 * qui la precede ou la suit.
 */
export const EditGesture = createContext<() => void>(() => undefined);

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  /** Valeur affichee a droite du libelle ; l'unite et l'echelle du champ s'en deduisent. */
  display?: string;
  hint?: string;
  disabled?: boolean;
  /** Unite affichee a cote du champ (jamais saisissable). Deduite de `display` si absente. */
  unit?: string;
  /**
   * Nombre affiche par unite de valeur : 100 pour une fraction affichee en %.
   * Deduit de `display` si absent.
   */
  scale?: number;
  /**
   * Bornes PHYSIQUES, en unites de la valeur. La plage du curseur n'est
   * qu'un confort : une saisie au-dela est acceptee tant qu'elle reste entre
   * ces bornes. Par defaut, la plage du curseur.
   */
  hardMin?: number;
  hardMax?: number;
  /** Pourquoi une valeur hors des bornes physiques est impossible. */
  limitReason?: string;
  /** Controle contextuel : un refus motive, borne admissible comprise, ou null. */
  validate?: (value: number) => string | null;
}

const UNIT_WORDS = ['g/cm3', 'km/h', 'cm3', 'mm', 'deg', 'kg', 'Hz', 'g', 'm', 's', '%'];
const NUMBER = String.raw`[-+]?\d+(?:[.,]\d+)?`;

/** Lit « 12.0 mm (liee) » en nombre, unite et complement. */
function readDisplay(display: string | undefined): { number: number | null; unit: string | null; note: string | null } {
  if (display === undefined) return { number: null, unit: null, note: null };
  const text = display.trim();
  const times = new RegExp(`^x\\s*(${NUMBER})\\s*(.*)$`).exec(text);
  if (times) return { number: Number(times[1].replace(',', '.')), unit: 'x', note: times[2] || null };
  const match = new RegExp(`^(${NUMBER})\\s*(.*)$`).exec(text);
  if (!match) return { number: null, unit: null, note: text || null };
  const rest = match[2].trim();
  const unit = UNIT_WORDS.find((word) => rest === word || rest.startsWith(`${word} `) || rest.startsWith(`${word}(`)) ?? null;
  const note = (unit ? rest.slice(unit.length) : rest).trim();
  return { number: Number(match[1].replace(',', '.')), unit, note: note || null };
}

const SCALES = [1, 10, 100, 1000, 0.1, 0.01, 0.001];

/** Echelle deduite du rapport entre le nombre affiche et la valeur. */
function inferScale(value: number, shown: number | null): number | null {
  if (shown === null || Math.abs(value) < 1e-9 || Math.abs(shown) < 1e-9 || shown / value <= 0) return null;
  const ratio = shown / value;
  let best = 1;
  for (const candidate of SCALES) {
    if (Math.abs(Math.log(ratio / candidate)) < Math.abs(Math.log(ratio / best))) best = candidate;
  }
  return Math.abs(Math.log(ratio / best)) < Math.log(1.6) ? best : null;
}

/** Nombre de decimales d'un pas, deux au plus. */
const decimalsOf = (step: number) => {
  for (let d = 0; d < 2; d++) if (Math.abs(Math.round(step * 10 ** d) - step * 10 ** d) < 1e-9) return d;
  return 2;
};

/** Deux decimales au plus, sans zeros inutiles au-dela de celles du pas. */
function formatNumber(shown: number, stepDecimals: number): string {
  const rounded = Math.round(shown * 100) / 100;
  let decimals = stepDecimals;
  while (decimals < 2 && Math.abs(Math.round(rounded * 10 ** decimals) - rounded * 10 ** decimals) > 1e-9) decimals++;
  return rounded.toFixed(decimals);
}

/** Saisie : virgule ou point, unite tapee par habitude toleree. */
export function parseEntry(text: string): number | null {
  const cleaned = text.trim().replace(/\s+/g, '').replace(',', '.').replace(/(mm|deg|\u00b0|%|g\/cm3|km\/h|kg|g|m|x)$/i, '');
  if (!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(cleaned)) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

interface NumberFieldProps {
  value: number;
  onChange: (value: number) => void;
  /** Unite affichee a cote (jamais saisissable) : mm, deg, %, g... */
  unit?: string;
  /** Nombre affiche par unite de valeur (100 pour une fraction en %). */
  scale?: number;
  /** Pas de reference, en unites de la valeur : fixe les decimales montrees. */
  step: number;
  /** Entier seulement (nombres de pieces). */
  integer?: boolean;
  hardMin?: number;
  hardMax?: number;
  limitReason?: string;
  validate?: (value: number) => string | null;
  disabled?: boolean;
  id?: string;
  label?: string;
  describedBy?: string;
  /** Le parent affiche lui-meme le refus ; sinon il s'affiche sous le champ. */
  onRefusal?: (message: string | null) => void;
}

/**
 * Champ numerique (module AJ.2) : clic ou tabulation selectionnent tout,
 * rien ne se recalcule pendant la frappe, Entree ou la perte de focus
 * valident, Echap restaure, fleches pour 0,1 (Maj : 1), molette inerte,
 * deux decimales au plus, virgule ou point.
 */
export function NumberField({
  value,
  onChange,
  unit = '',
  scale = 1,
  step,
  integer = false,
  hardMin = -Infinity,
  hardMax = Infinity,
  limitReason,
  validate,
  disabled,
  id,
  label,
  describedBy,
  onRefusal,
}: NumberFieldProps) {
  const ownId = useId();
  const gesture = useContext(EditGesture);
  const [draft, setDraft] = useState<string | null>(null);
  const [refusal, setRefusalState] = useState<string | null>(null);
  const fresh = useRef(false);
  const angular = unit === 'deg';
  const metric = unit === 'mm' || angular;
  const stepShown = step * scale;
  const stepDecimals = integer ? 0 : decimalsOf(stepShown);
  // Deux decimales au plus : un pas plus fin que 0,01 ne se verrait pas.
  const fine = metric ? 0.1 : integer ? 1 : Math.max(stepShown, 0.01);
  const coarse = metric ? 1 : integer ? 5 : Math.max(stepShown, 0.01) * 10;
  const unitLabel = angular ? '°' : unit === 'x' ? '×' : unit;
  const format = (raw: number) => formatNumber(raw * scale, stepDecimals);
  const said = (shown: number) => `${formatNumber(shown, stepDecimals)}${unitLabel ? ` ${unitLabel}` : ''}`;
  const setRefusal = (message: string | null) => {
    setRefusalState(message);
    onRefusal?.(message);
  };
  // Une valeur changee ailleurs (curseur, annulation) efface un refus perime.
  const shownValue = useRef(value);
  if (shownValue.current !== value) {
    shownValue.current = value;
    if (refusal !== null) setRefusalState(null);
  }

  /** Valide une saisie ; les refus sont motives, jamais un ecrasement silencieux. */
  const commit = (text: string, split: boolean) => {
    const entered = parseEntry(text);
    setDraft(null);
    if (entered === null) {
      // Saisie non numerique : retour a la valeur precedente, sans reproche.
      setRefusal(null);
      return;
    }
    const shown = integer ? Math.round(entered) : Math.round(entered * 100) / 100;
    const next = shown / scale;
    const tolerance = 1e-9 * Math.max(1, Math.abs(next));
    let why: string | null = null;
    if (next < hardMin - tolerance) {
      why = `${said(shown)} refuse : minimum admissible ${said(hardMin * scale)}. ${limitReason ?? 'En dessous, la geometrie devient impossible.'}`;
    } else if (next > hardMax + tolerance) {
      why = `${said(shown)} refuse : maximum admissible ${said(hardMax * scale)}. ${limitReason ?? 'Au-dela, la geometrie devient impossible.'}`;
    } else {
      why = validate?.(next) ?? null;
    }
    setRefusal(why);
    if (why || Math.abs(next - value) <= tolerance) return;
    if (split) gesture();
    onChange(next);
    if (split) gesture();
  };

  const onKey = (event: KeyboardEvent<HTMLInputElement>) => {
    const field = event.currentTarget;
    // Champ « pret a etre remplace » : la premiere touche remplace tout le
    // nombre, meme si la page, occupee a recalculer, n'a pas encore repeint
    // la selection.
    if (fresh.current && !event.ctrlKey && !event.metaKey && !event.altKey) {
      if (event.key.length === 1) {
        event.preventDefault();
        fresh.current = false;
        setDraft(event.key);
        return;
      }
      if (event.key === 'Backspace' || event.key === 'Delete') {
        event.preventDefault();
        fresh.current = false;
        setDraft('');
        return;
      }
      if (/^(ArrowLeft|ArrowRight|Home|End)$/.test(event.key)) fresh.current = false;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      commit(field.value, true);
      fresh.current = true;
      window.requestAnimationFrame(() => field.select());
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setDraft(null);
      setRefusal(null);
      fresh.current = true;
      window.requestAnimationFrame(() => field.select());
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      const base = parseEntry(field.value) ?? value * scale;
      const delta = (event.key === 'ArrowUp' ? 1 : -1) * (event.shiftKey ? coarse : fine);
      const target = Math.min(Math.max(base + delta, hardMin * scale), hardMax * scale);
      // Pressions rapprochees : fusionnees dans l'annulation, comme un glisser.
      commit(String(Math.round(target * 100) / 100), false);
      fresh.current = true;
      window.requestAnimationFrame(() => field.select());
    }
  };

  return (
    <span className="control__entry">
      <input
        id={id}
        className="control__field"
        type="text"
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        disabled={disabled}
        value={draft ?? format(value)}
        aria-label={label}
        aria-describedby={[refusal && !onRefusal ? `${ownId}-refusal` : null, describedBy].filter(Boolean).join(' ') || undefined}
        aria-invalid={refusal ? true : undefined}
        onFocus={(event) => {
          fresh.current = true;
          event.currentTarget.select();
        }}
        onMouseDown={(event) => {
          // Champ deja actif : le clic resselectionne tout, tout de suite, au
          // lieu de poser le curseur au milieu du nombre.
          const field = event.currentTarget;
          if (document.activeElement === field && event.detail === 1) {
            event.preventDefault();
            fresh.current = true;
            field.select();
          }
        }}
        onSelect={(event) => {
          // Une portion choisie a la souris : la frappe ne remplace qu'elle.
          const field = event.currentTarget;
          const partial = field.selectionStart !== field.selectionEnd && (field.selectionStart !== 0 || field.selectionEnd !== field.value.length);
          if (partial) fresh.current = false;
        }}
        onClick={(event) => {
          // Un clic selectionne tout, pret a etre remplace ; un glisser
          // garde la portion choisie a la souris.
          // Apres le traitement du clic : un clic dans une selection ne la
          // replie qu'une fois l'evenement passe.
          const field = event.currentTarget;
          window.setTimeout(() => {
            if (document.activeElement === field && field.selectionStart === field.selectionEnd) field.select();
          }, 0);
        }}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={(event) => {
          if (draft !== null) commit(event.target.value, true);
        }}
        onKeyDown={onKey}
      />
      {unitLabel ? (
        <span className="control__unit" aria-hidden="true">
          {unitLabel}
        </span>
      ) : null}
      {refusal && !onRefusal ? (
        <span className="control__refusal control__refusal--inline" id={`${ownId}-refusal`} role="alert">
          {refusal}
        </span>
      ) : null}
    </span>
  );
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
  unit: unitProp,
  scale: scaleProp,
  hardMin,
  hardMax,
  limitReason,
  validate,
}: SliderProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const fieldId = `${id}-field`;
  const parsed = readDisplay(display);
  // Un affichage en toutes lettres (« Aucune », « Vif ») ne dit pas l'unite :
  // on garde la derniere lue, pour que le champ ne change pas de nature.
  const lastUnit = useRef<string | null>(null);
  if (parsed.unit !== null) lastUnit.current = parsed.unit;
  const unit = unitProp ?? parsed.unit ?? lastUnit.current ?? '';
  // L'echelle ne se lit que si la valeur n'est pas nulle : on garde la
  // derniere lue, pour qu'un « 0 % » ne fasse pas basculer le champ.
  const lastScale = useRef<number | null>(null);
  const inferred = scaleProp ?? inferScale(value, parsed.number);
  if (inferred !== null) lastScale.current = inferred;
  const scale = scaleProp ?? lastScale.current ?? (unit === '%' && max <= 1.0001 ? 100 : 1);
  const integer = unit === '' && step >= 1 && Number.isInteger(step) && scale === 1;
  const [refusal, setRefusal] = useState<string | null>(null);

  // La plage du curseur s'etend pour montrer une valeur saisie au-dela.
  const sliderMin = Math.min(min, value);
  const sliderMax = Math.max(max, value);
  return (
    <div className="control">
      <div className="control__row">
        <label className="control__label" htmlFor={fieldId}>
          {label}
        </label>
        <span className="control__entry">
          {parsed.number === null && parsed.note ? <span className="control__note">{parsed.note}</span> : null}
          <NumberField
            id={fieldId}
            value={value}
            onChange={onChange}
            unit={unit}
            scale={scale}
            step={step}
            integer={integer}
            hardMin={hardMin ?? min}
            hardMax={hardMax ?? max}
            limitReason={limitReason}
            validate={validate}
            disabled={disabled}
            describedBy={refusal ? `${id}-refusal` : hint ? hintId : undefined}
            onRefusal={setRefusal}
          />
        </span>
      </div>
      {parsed.number !== null && parsed.note ? <p className="control__note control__note--below">{parsed.note}</p> : null}
      <input
        type="range"
        min={sliderMin}
        max={sliderMax}
        step={step}
        value={value}
        disabled={disabled}
        aria-label={`${label} (curseur)`}
        aria-describedby={hint ? hintId : undefined}
        onChange={(event) => {
          setRefusal(null);
          onChange(Number(event.target.value));
        }}
      />
      {refusal ? (
        <p className="control__refusal" id={`${id}-refusal`} role="alert">
          {refusal}
        </p>
      ) : null}
      {hint ? (
        <p className="control__hint" id={hintId}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Valeur calculee (module AJ.4) : lecture seule, visuellement distincte des
 * champs, avec son mode de calcul.
 */
export function Derived({ label, value, how }: { label: string; value: ReactNode; how: string }) {
  return (
    <div className="control control--derived">
      <div className="control__row">
        <span className="control__label">{label}</span>
        <output className="derived__value">{value}</output>
      </div>
      <p className="control__hint derived__how">
        <span className="derived__badge">calcule</span> {how}
      </p>
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
  disabled?: boolean;
}

export function Switch({ label, checked, onChange, hint, disabled }: SwitchProps) {
  return (
    <div className="control">
      <button
        type="button"
        className="switch"
        aria-pressed={checked}
        disabled={disabled}
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
