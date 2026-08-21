/**
 * Silhouette SVG generee a partir du MEME profil parametrique que le modele
 * 3D : les vignettes de la galerie et des projets sont donc toujours
 * fideles a la piece qui sera imprimee, sans aucun visuel prefabrique.
 */

import { useId, useMemo } from 'react';
import type { LureParams } from '../types/lure';
import { clamp, createProfile } from '../lib/profile';

interface Props {
  params: LureParams;
  /** Hauteur de rendu en pixels. */
  height?: number;
  title?: string;
  decorative?: boolean;
}

interface Point {
  x: number;
  y: number;
}

const SAMPLES = 96;
const fmt = (n: number) => Math.round(n * 1000) / 1000;
const toPath = (points: Point[]): string =>
  points.map((p, i) => `${i === 0 ? 'M' : 'L'}${fmt(p.x)} ${fmt(p.y)}`).join(' ');

export function LureSilhouette({ params, height = 116, title, decorative }: Props) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const art = useMemo(() => {
    const profile = createProfile(params);
    // Repere SVG : y vers le bas, d'ou l'inversion des ordonnees.
    const top: Point[] = [];
    const bottom: Point[] = [];
    for (let i = 0; i <= SAMPLES; i++) {
      const p = (i / SAMPLES) * profile.bodyEnd;
      const section = profile.section(p);
      const x = profile.xAt(p);
      top.push({ x, y: -section.top });
      bottom.push({ x, y: -section.bottom });
    }
    const bodyPath = `${toPath(top)} ${toPath([...bottom].reverse()).replace(/^M/, 'L')} Z`;

    // --- Nageoire caudale (mêmes formules que lib/geometry) ---------------
    let tailPath: string | null = null;
    if (profile.hasFin) {
      const overlap = profile.lengthCm * 0.02;
      const len = (1 - profile.bodyEnd) * profile.lengthCm + overlap;
      const thicknessCm = params.thickness * 0.1;
      const factor =
        params.tailShape === 'paddle' ? 0.82 : params.tailShape === 'fan' ? 1.05 : 0.95;
      const h = Math.max(thicknessCm * 0.5 * factor * clamp(params.tailSize, 0.4, 1.8), 0.2);
      const anchor = profile.section(Math.max(profile.bodyEnd - 0.045, 0.05));
      const stalk = Math.max((anchor.top - anchor.bottom) / 2, 0.08);
      const ox = profile.xAt(profile.bodyEnd) - overlap;
      const oy = -(anchor.top + anchor.bottom) / 2;
      const at = (x: number, y: number) => `${fmt(ox + x)} ${fmt(oy - y)}`;

      if (params.tailShape === 'forked') {
        tailPath =
          `M${at(0, stalk)} Q${at(len * 0.4, h * 0.5)} ${at(len, h)}` +
          ` Q${at(len * 0.6, h * 0.34)} ${at(len * 0.44, 0)}` +
          ` Q${at(len * 0.6, -h * 0.34)} ${at(len, -h)}` +
          ` Q${at(len * 0.4, -h * 0.5)} ${at(0, -stalk)} Z`;
      } else if (params.tailShape === 'paddle') {
        tailPath =
          `M${at(0, stalk)} Q${at(len * 0.3, h * 0.85)} ${at(len * 0.6, h)}` +
          ` Q${at(len * 1.02, h * 0.7)} ${at(len, 0)}` +
          ` Q${at(len * 1.02, -h * 0.7)} ${at(len * 0.6, -h)}` +
          ` Q${at(len * 0.3, -h * 0.85)} ${at(0, -stalk)} Z`;
      } else {
        tailPath =
          `M${at(0, stalk)} L${at(len * 0.88, h)}` +
          ` Q${at(len * 1.12, 0)} ${at(len * 0.88, -h)}` +
          ` L${at(0, -stalk)} Z`;
      }
    }

    // --- Bavette ----------------------------------------------------------
    let bibPath: string | null = null;
    if (params.hasBib) {
      const bl = Math.max(params.bibLength * 0.1, 0.2);
      const th = clamp(params.thickness * 0.1 * 0.1, 0.1, 0.28);
      const angle = (clamp(params.bibAngle, 5, 89) * Math.PI) / 180;
      const root = profile.section(0.07);
      const ox = profile.xAt(0.045);
      const oy = -root.bottom * 0.75;
      // La bavette projette VERS L'AVANT (le nez est en x minimal) et vers le
      // bas : meme convention que la geometrie 3D.
      const corner = (u: number, v: number): Point => ({
        x: ox - u * Math.cos(angle) + v * Math.sin(angle),
        y: oy + u * Math.sin(angle) + v * Math.cos(angle),
      });
      bibPath = `${toPath([
        corner(0, th / 2),
        corner(bl, th / 2),
        corner(bl, -th / 2),
        corner(0, -th / 2),
      ])} Z`;
    }

    // --- Details de tete ---------------------------------------------------
    const details = params.shape === 'spoon' ? null : params;
    let gillPath: string | null = null;
    if (details?.gills.enabled) {
      const at = details.gills.position;
      const section = profile.section(at);
      const bow = details.gills.size * 0.1 * 0.55;
      const x = profile.xAt(at);
      gillPath =
        `M${fmt(x)} ${fmt(-section.top)}` +
        ` Q${fmt(x + bow)} ${fmt(-(section.top + section.bottom) / 2)} ${fmt(x)} ${fmt(
          -section.bottom,
        )}`;
    }

    let eye: { cx: number; cy: number; r: number } | null = null;
    if (details?.eyes.enabled) {
      const at = details.eyes.position;
      const section = profile.section(at);
      // L'oeil est sur le haut du flanc : en vue de profil il remonte d'autant.
      eye = {
        cx: profile.xAt(at),
        cy: -section.top * Math.cos(1.15),
        r: Math.max((details.eyes.size * 0.1) / 2, 0.05),
      };
    }

    const all = [...top, ...bottom];
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const point of all) {
      minX = Math.min(minX, point.x);
      maxX = Math.max(maxX, point.x);
      minY = Math.min(minY, point.y);
      maxY = Math.max(maxY, point.y);
    }
    // La bavette et la caudale debordent : on elargit la boite grossierement.
    const margin = profile.lengthCm * 0.12;
    minX -= margin;
    maxX += margin;
    minY -= margin * 0.6;
    maxY += margin * 0.9;

    return {
      bodyPath,
      tailPath,
      bibPath,
      gillPath,
      eye,
      bodyStart: profile.xAt(0),
      bodyLength: profile.lengthCm,
      viewBox: `${fmt(minX)} ${fmt(minY)} ${fmt(maxX - minX)} ${fmt(maxY - minY)}`,
      box: { minX, minY, width: maxX - minX, height: maxY - minY },
    };
  }, [params]);

  const { paint } = params;
  const gradientId = `grad-${uid}`;
  const patternId = `pat-${uid}`;
  const clipId = `clip-${uid}`;
  const headId = `head-${uid}`;
  const zoneHeadId = `zhead-${uid}`;
  const zoneTailId = `ztail-${uid}`;
  const patternStep = art.box.width / clamp(paint.patternScale, 3, 26);

  return (
    <svg
      viewBox={art.viewBox}
      height={height}
      width="100%"
      role={decorative ? 'presentation' : 'img'}
      aria-hidden={decorative || undefined}
      aria-label={decorative ? undefined : title}
      style={{ display: 'block', overflow: 'visible' }}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={paint.dorsal} />
          <stop offset="42%" stopColor={paint.flank} />
          <stop offset="100%" stopColor={paint.belly} />
        </linearGradient>
        <linearGradient id={headId} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor={paint.patternColor} stopOpacity="0.95" />
          <stop offset="100%" stopColor={paint.patternColor} stopOpacity="0" />
        </linearGradient>
        {/* Zones longitudinales : meme fondu que la texture 3D. */}
        <linearGradient id={zoneHeadId} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor={paint.head} stopOpacity="1" />
          <stop offset={`${(1 - (0.1 + paint.blend * 0.55)) * 100}%`} stopColor={paint.head} stopOpacity="1" />
          <stop offset="100%" stopColor={paint.head} stopOpacity="0" />
        </linearGradient>
        <linearGradient id={zoneTailId} x1="1" y1="0" x2="0" y2="0">
          <stop offset="0%" stopColor={paint.tail} stopOpacity="1" />
          <stop offset={`${(1 - (0.1 + paint.blend * 0.55)) * 100}%`} stopColor={paint.tail} stopOpacity="1" />
          <stop offset="100%" stopColor={paint.tail} stopOpacity="0" />
        </linearGradient>
        {paint.pattern === 'stripes' ? (
          <pattern
            id={patternId}
            patternUnits="userSpaceOnUse"
            width={patternStep}
            height={art.box.height}
            patternTransform={`skewX(-12)`}
          >
            <rect
              x="0"
              y="0"
              width={patternStep * 0.34}
              height={art.box.height}
              fill={paint.patternColor}
              opacity="0.85"
            />
          </pattern>
        ) : null}
        {paint.pattern === 'dots' ? (
          <pattern
            id={patternId}
            patternUnits="userSpaceOnUse"
            width={patternStep}
            height={patternStep}
          >
            <circle
              cx={patternStep / 2}
              cy={patternStep / 2}
              r={patternStep * 0.22}
              fill={paint.patternColor}
              opacity="0.8"
            />
          </pattern>
        ) : null}
        <clipPath id={clipId}>
          <path d={art.bodyPath} />
        </clipPath>
      </defs>

      {art.bibPath ? (
        <path
          d={art.bibPath}
          fill="#8fa3b4"
          fillOpacity="0.9"
          stroke="#101114"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
      ) : null}
      {art.tailPath ? (
        <path
          d={art.tailPath}
          fill={paint.tailLength > 0.01 ? paint.tail : paint.flank}
          stroke="#101114"
          strokeWidth={1.2}
          vectorEffect="non-scaling-stroke"
        />
      ) : null}

      <path d={art.bodyPath} fill={`url(#${gradientId})`} />
      {paint.headLength > 0.01 ? (
        <rect
          x={art.bodyStart}
          y={art.box.minY}
          width={art.bodyLength * paint.headLength}
          height={art.box.height}
          fill={`url(#${zoneHeadId})`}
          clipPath={`url(#${clipId})`}
        />
      ) : null}
      {paint.tailLength > 0.01 ? (
        <rect
          x={art.bodyStart + art.bodyLength * (1 - paint.tailLength)}
          y={art.box.minY}
          width={art.bodyLength * paint.tailLength}
          height={art.box.height}
          fill={`url(#${zoneTailId})`}
          clipPath={`url(#${clipId})`}
        />
      ) : null}
      {paint.pattern === 'stripes' || paint.pattern === 'dots' ? (
        <rect
          x={art.box.minX}
          y={art.box.minY}
          width={art.box.width}
          height={art.box.height}
          fill={`url(#${patternId})`}
          clipPath={`url(#${clipId})`}
        />
      ) : null}
      {paint.pattern === 'gradient' ? (
        <rect
          x={art.box.minX}
          y={art.box.minY}
          width={art.box.width * (0.2 + (paint.patternScale / 26) * 0.4)}
          height={art.box.height}
          fill={`url(#${headId})`}
          clipPath={`url(#${clipId})`}
        />
      ) : null}
      {art.gillPath ? (
        <path
          d={art.gillPath}
          fill="none"
          stroke="#101114"
          strokeOpacity="0.55"
          strokeWidth={1.2}
          vectorEffect="non-scaling-stroke"
        />
      ) : null}
      <path
        d={art.bodyPath}
        fill="none"
        stroke="#101114"
        strokeWidth={1.4}
        vectorEffect="non-scaling-stroke"
      />
      {art.eye ? (
        <g>
          <circle cx={art.eye.cx} cy={art.eye.cy} r={art.eye.r} fill="#f7f4ee" />
          <circle cx={art.eye.cx} cy={art.eye.cy} r={art.eye.r * 0.72} fill={paint.eyeColor} />
          <circle cx={art.eye.cx} cy={art.eye.cy} r={art.eye.r * 0.34} fill="#101114" />
        </g>
      ) : null}
    </svg>
  );
}
