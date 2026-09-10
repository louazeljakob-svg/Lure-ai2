/**
 * Primitives de graphique.
 *
 * Un graphique de simulation n'a pas le droit d'etre joli et faux. Les regles
 * tenues ici : une seule echelle par graphique (jamais deux axes), la teinte
 * suit la serie et jamais son rang, chaque courbe porte son etiquette en bout
 * de trait ET dans la legende, et un tableau de valeurs reste accessible sous
 * chaque figure — parce que la teinte aqua ne tient pas le contraste 3:1 sur
 * fond clair et qu'une identite portee par la seule couleur n'est pas lisible
 * pour tout le monde.
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

/** Trois emplacements categoriels, valides en clair et en sombre. */
export const VIZ = {
  s1: 'var(--viz-1)',
  s2: 'var(--viz-2)',
  s3: 'var(--viz-3)',
} as const;

export interface VizPoint {
  x: number;
  y: number;
  /** Bornes de la fourchette d'incertitude, si le modele en fournit une. */
  low?: number;
  high?: number;
}

export interface VizSeries {
  id: string;
  label: string;
  color: string;
  points: VizPoint[];
  dashed?: boolean;
}

export interface VizMarker {
  /** Seuil horizontal (valeur en y) ou vertical (valeur en x). */
  x?: number;
  y?: number;
  label: string;
}

// ---------------------------------------------------------------------------
// Echelles
// ---------------------------------------------------------------------------

/** Graduations rondes : 1, 2, 5 x 10^n. Un axe ne s'invente pas au pixel. */
function niceTicks(min: number, max: number, count = 4): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return [min];
  const raw = (max - min) / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm >= 5 ? 10 : norm >= 2 ? 5 : norm >= 1 ? 2 : 1) * mag;
  const ticks: number[] = [];
  for (let t = Math.ceil(min / step - 1e-9) * step; t <= max + step * 1e-6; t += step) {
    ticks.push(Math.abs(t) < step * 1e-6 ? 0 : t);
  }
  return ticks.length > 1 ? ticks : [min, max];
}

/** Largeur reelle du conteneur : les polices ne doivent pas etre etirees. */
function useWidth(fallback = 316): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const node = ref.current;
    if (!node || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width ?? fallback;
      if (next > 0) setWidth(next);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [fallback]);
  return [ref, width];
}

const fmtNum = (value: number, digits = 1): string =>
  value.toLocaleString('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits });

// ---------------------------------------------------------------------------
// Courbes
// ---------------------------------------------------------------------------

interface LineChartProps {
  series: VizSeries[];
  xLabel: string;
  yLabel: string;
  /** Formatage des valeurs de l'infobulle et du tableau. */
  fmtX?: (v: number) => string;
  fmtY?: (v: number) => string;
  height?: number;
  /** Vrai pour une profondeur : l'axe descend au lieu de monter. */
  invertY?: boolean;
  markers?: VizMarker[];
  /** Force le haut d'echelle, pour comparer deux figures entre elles. */
  yMax?: number;
  caption?: ReactNode;
  /** Titre du tableau depliable. */
  tableLabel?: string;
}

export function LineChart({
  series,
  xLabel,
  yLabel,
  fmtX = (v) => fmtNum(v, 0),
  fmtY = (v) => fmtNum(v, 1),
  height = 176,
  invertY = false,
  markers = [],
  yMax,
  caption,
  tableLabel = 'Valeurs',
}: LineChartProps) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState<number | null>(null);

  const live = series.filter((s) => s.points.length > 1);
  // Etiquettes directes : seulement les series pleines. Une variante en
  // tirete se lit deja par son motif et sa legende, et son libelle mangerait
  // un quart de la largeur utile.
  const labelled = live.length <= 4 ? live.filter((s) => !s.dashed) : [];
  // Largeur approchee d'un caractere a 10 px : la marge droite s'adapte au
  // plus long libelle plutot que de laisser un mot deborder du panneau.
  const CHAR = 5.6;
  const labelW = (text: string) => text.length * CHAR + 6;
  const widest = labelled.reduce((max, s) => Math.max(max, labelW(s.label)), 0);
  const pad = { top: 10, right: Math.min(Math.max(widest + 6, 16), 86), bottom: 24, left: 38 };
  const plotW = Math.max(width - pad.left - pad.right, 40);
  const plotH = Math.max(height - pad.top - pad.bottom, 40);

  const domain = useMemo(() => {
    let x0 = Infinity;
    let x1 = -Infinity;
    let y1 = 0;
    for (const s of live) {
      for (const p of s.points) {
        x0 = Math.min(x0, p.x);
        x1 = Math.max(x1, p.x);
        y1 = Math.max(y1, p.high ?? p.y);
      }
    }
    for (const m of markers) if (m.y != null) y1 = Math.max(y1, m.y);
    if (!Number.isFinite(x0)) return { x0: 0, x1: 1, y1: 1 };
    return { x0, x1: x1 > x0 ? x1 : x0 + 1, y1: yMax ?? (y1 > 0 ? y1 * 1.08 : 1) };
  }, [live, markers, yMax]);

  const sx = (v: number) => pad.left + ((v - domain.x0) / (domain.x1 - domain.x0)) * plotW;
  const sy = (v: number) => {
    const t = Math.min(Math.max(v / domain.y1, 0), 1.02);
    return invertY ? pad.top + t * plotH : pad.top + (1 - t) * plotH;
  };

  const xTicks = niceTicks(domain.x0, domain.x1, width < 280 ? 3 : 4);
  const yTicks = niceTicks(0, domain.y1, 4);

  const linePath = (points: VizPoint[]) =>
    points.map((p, i) => `${i === 0 ? 'M' : 'L'}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(' ');

  const bandPath = (points: VizPoint[]) => {
    if (!points.some((p) => p.low != null && p.high != null)) return null;
    const up = points.map((p) => `${sx(p.x).toFixed(1)},${sy(p.high ?? p.y).toFixed(1)}`);
    const down = [...points]
      .reverse()
      .map((p) => `${sx(p.x).toFixed(1)},${sy(p.low ?? p.y).toFixed(1)}`);
    return `M${up.join(' L')} L${down.join(' L')} Z`;
  };

  // Index survole : on cherche l'abscisse la plus proche sur la serie la plus
  // dense, et toutes les series sont lues a cet index.
  const guide = live[0];
  const hoverX = hover != null && guide ? guide.points[hover]?.x : null;

  const onMove = (event: React.MouseEvent<SVGSVGElement>) => {
    if (!guide) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const px = event.clientX - rect.left;
    let best = 0;
    let bestD = Infinity;
    guide.points.forEach((p, i) => {
      const d = Math.abs(sx(p.x) - px);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    setHover(best);
  };

  const readAt = (s: VizSeries, index: number): VizPoint | undefined =>
    s.points[Math.min(index, s.points.length - 1)];

  const directLabels = (() => {
    const rows = labelled
      .map((s) => {
        const last = s.points[s.points.length - 1];
        const w = labelW(s.label);
        const x = Math.min(sx(last.x) + 5, width - w);
        // Si l'etiquette devait reculer sur la courbe elle-meme, on y renonce :
        // la legende et le tableau portent deja l'identite.
        return x < sx(last.x) - 1
          ? null
          : { id: s.id, text: s.label, color: s.color, x, y: sy(last.y) + 3 };
      })
      .filter(Boolean) as { id: string; text: string; color: string; x: number; y: number }[];
    rows.sort((a, b) => a.y - b.y);
    const MIN_GAP = 11;
    for (let i = 1; i < rows.length; i++) {
      if (rows[i].y - rows[i - 1].y < MIN_GAP) rows[i].y = rows[i - 1].y + MIN_GAP;
    }
    // Le paquet recale peut sortir par le bas : on le remonte d'un bloc.
    const overflow = rows.length ? rows[rows.length - 1].y - (height - 4) : 0;
    if (overflow > 0) for (const row of rows) row.y -= overflow;
    for (const row of rows) row.y = Math.max(row.y, pad.top + 4);
    return rows;
  })();

  return (
    <div className="viz" ref={ref}>
      <div className="viz__plot">
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={`${yLabel} en fonction de ${xLabel}`}
          onMouseMove={onMove}
          onMouseLeave={() => setHover(null)}
        >
          {yTicks.map((t) => (
            <g key={`y${t}`}>
              <line
                className="viz__grid"
                x1={pad.left}
                x2={pad.left + plotW}
                y1={sy(t)}
                y2={sy(t)}
              />
              <text className="viz__tick viz__tick--y" x={pad.left - 6} y={sy(t) + 3}>
                {fmtY(t)}
              </text>
            </g>
          ))}
          {xTicks.map((t) => (
            <text key={`x${t}`} className="viz__tick" x={sx(t)} y={height - 8}>
              {fmtX(t)}
            </text>
          ))}
          <line
            className="viz__axis"
            x1={pad.left}
            x2={pad.left + plotW}
            y1={invertY ? pad.top : pad.top + plotH}
            y2={invertY ? pad.top : pad.top + plotH}
          />

          {markers.map((m) =>
            m.y != null ? (
              <g key={m.label}>
                <line
                  className="viz__marker"
                  x1={pad.left}
                  x2={pad.left + plotW}
                  y1={sy(m.y)}
                  y2={sy(m.y)}
                />
                <text className="viz__marker-label" x={pad.left + 3} y={sy(m.y) - 3}>
                  {m.label}
                </text>
              </g>
            ) : m.x != null ? (
              <g key={m.label}>
                <line
                  className="viz__marker"
                  x1={sx(m.x)}
                  x2={sx(m.x)}
                  y1={pad.top}
                  y2={pad.top + plotH}
                />
                <text
                  className="viz__marker-label"
                  x={sx(m.x) - 3}
                  y={pad.top + 9}
                  textAnchor="end"
                >
                  {m.label}
                </text>
              </g>
            ) : null,
          )}

          {live.map((s) => {
            const band = bandPath(s.points);
            return band ? (
              <path key={`b-${s.id}`} d={band} fill={s.color} fillOpacity={0.13} stroke="none" />
            ) : null;
          })}

          {live.map((s) => (
            <path
              key={s.id}
              d={linePath(s.points)}
              fill="none"
              stroke={s.color}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray={s.dashed ? '5 4' : undefined}
            />
          ))}

          {/* Etiquette directe en bout de trait : l'identite ne repose jamais
              sur la seule couleur. Deux courbes qui finissent au meme endroit
              ecriraient l'une sur l'autre, alors on les ecarte. */}
          {directLabels.map((label) => (
            <text
              key={`l-${label.id}`}
              className="viz__direct"
              x={label.x}
              y={label.y}
              fill={label.color}
            >
              {label.text}
            </text>
          ))}

          {hover != null && hoverX != null ? (
            <>
              <line
                className="viz__crosshair"
                x1={sx(hoverX)}
                x2={sx(hoverX)}
                y1={pad.top}
                y2={pad.top + plotH}
              />
              {live.map((s) => {
                const p = readAt(s, hover);
                if (!p) return null;
                return (
                  <circle
                    key={`h-${s.id}`}
                    cx={sx(p.x)}
                    cy={sy(p.y)}
                    r={4}
                    fill={s.color}
                    stroke="var(--surface)"
                    strokeWidth={2}
                  />
                );
              })}
            </>
          ) : null}
        </svg>

        {hover != null && hoverX != null ? (
          <div
            className="viz__tip"
            style={{
              left: `${Math.min(Math.max(sx(hoverX), 8), Math.max(width - 120, 8))}px`,
            }}
          >
            <strong>
              {fmtX(hoverX)} {xLabel}
            </strong>
            {live.map((s) => {
              const p = readAt(s, hover);
              if (!p) return null;
              return (
                <span key={`t-${s.id}`}>
                  <i style={{ background: s.color }} aria-hidden="true" />
                  {s.label} : {fmtY(p.y)}
                  {p.low != null && p.high != null
                    ? ` (${fmtY(p.low)} – ${fmtY(p.high)})`
                    : ''}
                </span>
              );
            })}
          </div>
        ) : null}
      </div>

      {live.length >= 2 ? (
        <ul className="viz__legend">
          {live.map((s) => (
            <li key={`g-${s.id}`}>
              <i style={{ background: s.color }} aria-hidden="true" />
              {s.label}
            </li>
          ))}
        </ul>
      ) : null}

      <p className="viz__axis-label">
        {xLabel} → · {yLabel}
        {invertY ? ' (vers le bas)' : ''}
      </p>
      {caption ? <p className="viz__caption">{caption}</p> : null}

      <details className="viz__table">
        <summary>{tableLabel}</summary>
        <div className="viz__table-scroll">
          <table>
            <thead>
              <tr>
                <th scope="col">{xLabel}</th>
                {live.map((s) => (
                  <th scope="col" key={`th-${s.id}`}>
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(guide?.points ?? [])
                .filter((_, i) => i % Math.ceil((guide?.points.length ?? 1) / 9) === 0)
                .map((p, i, arr) => {
                  const index = (guide?.points ?? []).indexOf(p);
                  return (
                    <tr key={`tr-${i}-${arr.length}`}>
                      <th scope="row">{fmtX(p.x)}</th>
                      {live.map((s) => (
                        <td key={`td-${s.id}`}>{fmtY(readAt(s, index)?.y ?? 0)}</td>
                      ))}
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Fourchettes
// ---------------------------------------------------------------------------

interface EstimateStatProps {
  label: string;
  value: number;
  low: number;
  high: number;
  unit: string;
  digits?: number;
  sub?: ReactNode;
  tone?: 'neutral' | 'warn' | 'bad';
}

/**
 * Une valeur estimee ne s'affiche jamais seule : la fourchette est la valeur.
 */
export function EstimateStat({
  label,
  value,
  low,
  high,
  unit,
  digits = 1,
  sub,
  tone = 'neutral',
}: EstimateStatProps) {
  return (
    <div className={`stat stat--est stat--${tone}`}>
      <span className="stat__label">{label}</span>
      <div className="stat__value">
        {fmtNum(value, digits)}
        <span className="stat__unit">{unit}</span>
      </div>
      <span className="stat__range">
        fourchette {fmtNum(low, digits)} – {fmtNum(high, digits)} {unit}
      </span>
      {sub ? <span className="stat__sub">{sub}</span> : null}
    </div>
  );
}

interface RankBarsProps {
  items: { label: string; value: number; detail?: string }[];
  unit: string;
  digits?: number;
  /** Le maillon faible est mis en avant : c'est lui qui decide. */
  weakestLabel?: string;
}

export function RankBars({ items, unit, digits = 1, weakestLabel }: RankBarsProps) {
  const max = Math.max(...items.map((i) => i.value), 1e-6);
  return (
    <ul className="rank">
      {items.map((item) => {
        const weak = item.label === weakestLabel;
        return (
          <li key={item.label} className={weak ? 'rank__row rank__row--weak' : 'rank__row'}>
            <div className="rank__head">
              <span className="rank__label">
                {weak ? '⚠ ' : ''}
                {item.label}
              </span>
              <span className="rank__value">
                {fmtNum(item.value, digits)} {unit}
              </span>
            </div>
            <div className="rank__track">
              <div className="rank__fill" style={{ width: `${(item.value / max) * 100}%` }} />
            </div>
            {item.detail ? <span className="rank__detail">{item.detail}</span> : null}
          </li>
        );
      })}
    </ul>
  );
}
