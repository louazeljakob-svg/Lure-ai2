/**
 * Editeur de contour : la brique partagee par la silhouette et les decals.
 *
 * Un panneau plein largeur qui s'ouvre par le bas du viewport, sur lequel on
 * trace a la plume par-dessus une photo de reference. Le meme composant sert
 * aux deux usages : seuls le titre, l'aide et le contour edite changent.
 *
 * Le trace vit en coordonnees normalisees sans unite (voir `OutlineNode`) ;
 * c'est le consommateur qui decide de l'echelle reelle. La vue applique donc
 * un simple zoom / decalage entre ce repere et les pixels du SVG.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Outline, OutlineNode, OutlineReference } from '../types/lure';
import { flattenOutline, outlineNode } from '../lib/outline';

type Mode = 'pen' | 'select';

interface Props {
  title: string;
  hint: string;
  outline: Outline;
  reference: OutlineReference;
  onChange: (outline: Outline) => void;
  onReference: (reference: OutlineReference) => void;
  onClose: () => void;
  /** Annuler / retablir de la pile globale. */
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

/** Chemin SVG du trace, poignees comprises ou non. */
function outlinePath(outline: Outline): string {
  const nodes = outline.nodes;
  if (nodes.length < 2) return '';
  const parts: string[] = [`M ${nodes[0].x} ${nodes[0].y}`];
  const last = outline.closed ? nodes.length : nodes.length - 1;
  for (let i = 0; i < last; i++) {
    const a = nodes[i];
    const b = nodes[(i + 1) % nodes.length];
    parts.push(
      `C ${a.x + a.outX} ${a.y + a.outY} ${b.x + b.inX} ${b.y + b.inY} ${b.x} ${b.y}`,
    );
  }
  if (outline.closed) parts.push('Z');
  return parts.join(' ');
}

/** Le meme trace, reflete sous l'axe. */
function mirrorPath(outline: Outline): string {
  const flipped: Outline = {
    ...outline,
    nodes: outline.nodes.map((n) => ({
      ...n,
      y: -n.y,
      inY: -n.inY,
      outY: -n.outY,
    })),
  };
  return outlinePath(flipped);
}

export function OutlineEditor({
  title,
  hint,
  outline,
  reference,
  onChange,
  onReference,
  onClose,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [mode, setMode] = useState<Mode>(outline.nodes.length === 0 ? 'pen' : 'select');
  const [selected, setSelected] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [full, setFull] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [drag, setDrag] = useState<
    | { kind: 'node' | 'in' | 'out'; id: string }
    | { kind: 'image' }
    | { kind: 'pan'; fromX: number; fromY: number; panX: number; panY: number }
    | null
  >(null);

  // Vue : 2 unites de contour de haut, recadrees par le zoom. Le repere SVG a
  // son y vers le bas, celui du contour vers le haut : d'ou l'inversion.
  const VIEW = 2.4;
  const toLocal = useCallback(
    (event: { clientX: number; clientY: number }) => {
      const svg = svgRef.current;
      if (!svg) return { x: 0, y: 0 };
      const rect = svg.getBoundingClientRect();
      const ratio = rect.width / rect.height;
      const spanY = VIEW / zoom;
      const spanX = spanY * ratio;
      const nx = (event.clientX - rect.left) / rect.width - 0.5;
      const ny = (event.clientY - rect.top) / rect.height - 0.5;
      return { x: nx * spanX + pan.x, y: -(ny * spanY) + pan.y };
    },
    [zoom, pan],
  );

  const viewBox = useMemo(() => {
    const spanY = VIEW / zoom;
    const spanX = spanY * 2.6;
    return `${pan.x - spanX / 2} ${-pan.y - spanY / 2} ${spanX} ${spanY}`;
  }, [zoom, pan]);

  const update = useCallback(
    (nodes: OutlineNode[]) => onChange({ ...outline, nodes }),
    [outline, onChange],
  );

  const addNode = useCallback(
    (x: number, y: number) => {
      const node = outlineNode(x, y, 0.001);
      update([...outline.nodes, node]);
      setSelected(node.id);
    },
    [outline.nodes, update],
  );

  /**
   * Insere un point sur le segment le plus proche.
   *
   * On cherche par echantillonnage du trace aplati : c'est la geometrie que
   * l'utilisateur voit, donc celle sur laquelle il vise.
   */
  const insertOnSegment = useCallback(
    (x: number, y: number) => {
      const nodes = outline.nodes;
      if (nodes.length < 2) return addNode(x, y);
      let bestIndex = 0;
      let bestDist = Infinity;
      const last = outline.closed ? nodes.length : nodes.length - 1;
      for (let i = 0; i < last; i++) {
        const a = nodes[i];
        const b = nodes[(i + 1) % nodes.length];
        for (let s = 0; s <= 12; s++) {
          const t = s / 12;
          const u = 1 - t;
          const px =
            a.x * u * u * u +
            (a.x + a.outX) * 3 * u * u * t +
            (b.x + b.inX) * 3 * u * t * t +
            b.x * t * t * t;
          const py =
            a.y * u * u * u +
            (a.y + a.outY) * 3 * u * u * t +
            (b.y + b.inY) * 3 * u * t * t +
            b.y * t * t * t;
          const d = Math.hypot(px - x, py - y);
          if (d < bestDist) {
            bestDist = d;
            bestIndex = i;
          }
        }
      }
      const node = outlineNode(x, y, 0.08);
      const next = [...nodes];
      next.splice(bestIndex + 1, 0, node);
      update(next);
      setSelected(node.id);
    },
    [outline.nodes, outline.closed, addNode, update],
  );

  const removeSelected = useCallback(() => {
    if (!selected) return;
    update(outline.nodes.filter((n) => n.id !== selected));
    setSelected(null);
  }, [selected, outline.nodes, update]);

  // Suppr efface le point selectionne, Echap ferme le panneau.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA)$/.test(target.tagName)) return;
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        removeSelected();
      } else if (event.key === 'Escape') {
        onClose();
      } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) onRedo();
        else onUndo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [removeSelected, onClose, onUndo, onRedo]);

  const onPointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    if (event.button === 1 || event.shiftKey) {
      setDrag({ kind: 'pan', fromX: event.clientX, fromY: event.clientY, panX: pan.x, panY: pan.y });
      return;
    }
    if (event.target !== event.currentTarget && event.target instanceof SVGElement) {
      // Un clic sur une poignee : c'est elle qui gere.
      if (event.target.dataset.handle) return;
    }
    const point = toLocal(event);
    if (mode === 'pen') addNode(point.x, point.y);
    else setSelected(null);
  };

  const onPointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    if (!drag) return;
    if (drag.kind === 'pan') {
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const spanY = VIEW / zoom;
      const spanX = spanY * (rect.width / rect.height);
      setPan({
        x: drag.panX - ((event.clientX - drag.fromX) / rect.width) * spanX,
        y: drag.panY + ((event.clientY - drag.fromY) / rect.height) * spanY,
      });
      return;
    }
    const point = toLocal(event);
    if (drag.kind === 'image') {
      if (reference.locked) return;
      onReference({ ...reference, x: point.x, y: point.y });
      return;
    }
    update(
      outline.nodes.map((node) => {
        if (node.id !== drag.id) return node;
        if (drag.kind === 'node') {
          return { ...node, x: point.x, y: point.y };
        }
        const dx = point.x - node.x;
        const dy = point.y - node.y;
        // Les deux poignees restent alignees : c'est ce qui donne une courbe
        // lisse. Un point anguleux se fait en tirant puis en raccourcissant.
        if (drag.kind === 'out') return { ...node, outX: dx, outY: dy, inX: -dx, inY: -dy };
        return { ...node, inX: dx, inY: dy, outX: -dx, outY: -dy };
      }),
    );
  };

  const endDrag = () => setDrag(null);

  const loadImage = (file: File | null | undefined) => {
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        onReference({ ...reference, src: reader.result, visible: true });
      }
    };
    reader.readAsDataURL(file);
  };

  const fit = () => {
    const flat = flattenOutline(outline);
    if (flat.length === 0) {
      setZoom(1);
      setPan({ x: 0, y: 0 });
      return;
    }
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of flat) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
    const spanY = Math.max(maxY - minY, 0.2) * 1.3;
    setZoom(Math.min(Math.max(VIEW / spanY, 0.15), 12));
    setPan({ x: (minX + maxX) / 2, y: (minY + maxY) / 2 });
  };

  const handleSize = 0.02 / zoom;
  const strokeWidth = 0.006 / zoom;

  return (
    <div className={full ? 'contour contour--full' : 'contour'}>
      <div className="contour__head">
        <div>
          <h3 className="contour__title">{title}</h3>
          <p className="contour__hint">{hint}</p>
        </div>
        <div className="contour__headActions">
          <button type="button" className="btn btn--sm" onClick={() => setShowHelp((v) => !v)}>
            Comment ca marche
          </button>
          <button type="button" className="btn btn--sm btn--primary" onClick={onClose}>
            Termine
          </button>
          <button
            type="button"
            className="contour__close"
            aria-label="Fermer l editeur de contour"
            onClick={onClose}
          >
            ✕
          </button>
        </div>
      </div>

      {showHelp ? (
        <div className="contour__help">
          <p>
            <strong>Plume</strong> : chaque clic pose un point d ancrage, et le glisser qui
            suit tire ses poignees tangentes. <strong>Selection</strong> : deplacez un point
            ou ses poignees, double-cliquez pour le supprimer, cliquez sur le trace pour
            inserer un point entre deux autres.
          </p>
          <p>
            Deposez une photo pour la mettre en fond, puis calez le trace dessus. Avec la
            <strong> symetrie</strong>, vous ne dessinez que la moitie haute : le reflet suit
            en direct. La maquette 3D au-dessus se met a jour a chaque geste.
          </p>
        </div>
      ) : null}

      <div className="contour__bar">
        <div className="contour__group">
          <button
            type="button"
            className={mode === 'pen' ? 'toolbtn toolbtn--on' : 'toolbtn'}
            aria-pressed={mode === 'pen'}
            onClick={() => setMode('pen')}
          >
            Plume
          </button>
          <button
            type="button"
            className={mode === 'select' ? 'toolbtn toolbtn--on' : 'toolbtn'}
            aria-pressed={mode === 'select'}
            onClick={() => setMode('select')}
          >
            Selection
          </button>
        </div>

        <div className="contour__group">
          <button type="button" className="toolbtn" onClick={onUndo} disabled={!canUndo}>
            ↶ Annuler
          </button>
          <button type="button" className="toolbtn" onClick={onRedo} disabled={!canRedo}>
            ↷ Retablir
          </button>
        </div>

        <div className="contour__group">
          <button type="button" className="toolbtn" onClick={() => setZoom((z) => Math.max(z / 1.35, 0.15))}>
            Zoom −
          </button>
          <button type="button" className="toolbtn" onClick={() => setZoom((z) => Math.min(z * 1.35, 12))}>
            Zoom +
          </button>
          <button type="button" className="toolbtn" onClick={fit}>
            Ajuster
          </button>
          <button
            type="button"
            className={full ? 'toolbtn toolbtn--on' : 'toolbtn'}
            aria-pressed={full}
            onClick={() => setFull((v) => !v)}
          >
            Plein ecran
          </button>
        </div>

        <div className="contour__group">
          <button
            type="button"
            className={reference.visible ? 'toolbtn toolbtn--on' : 'toolbtn'}
            aria-pressed={reference.visible}
            disabled={!reference.src}
            onClick={() => onReference({ ...reference, visible: !reference.visible })}
          >
            Image
          </button>
          <button
            type="button"
            className={reference.locked ? 'toolbtn toolbtn--on' : 'toolbtn'}
            aria-pressed={reference.locked}
            disabled={!reference.src}
            onClick={() => onReference({ ...reference, locked: !reference.locked })}
          >
            {reference.locked ? 'Verrouillee' : 'Libre'}
          </button>
          <label className="toolbtn toolbtn--file">
            Importer
            <input
              type="file"
              accept="image/*"
              onChange={(event) => loadImage(event.target.files?.[0])}
            />
          </label>
        </div>

        <div className="contour__group contour__group--grow">
          <label className="contour__slider">
            Opacite
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={reference.opacity}
              disabled={!reference.src}
              onChange={(event) =>
                onReference({ ...reference, opacity: Number(event.target.value) })
              }
            />
          </label>
          <label className="contour__slider">
            Echelle
            <input
              type="range"
              min={0.1}
              max={6}
              step={0.01}
              value={reference.scale}
              disabled={!reference.src}
              onChange={(event) =>
                onReference({ ...reference, scale: Number(event.target.value) })
              }
            />
          </label>
        </div>

        <div className="contour__group">
          <button
            type="button"
            className={outline.mirror ? 'toolbtn toolbtn--on' : 'toolbtn'}
            aria-pressed={outline.mirror}
            onClick={() => onChange({ ...outline, mirror: !outline.mirror })}
          >
            Symetrie
          </button>
          <button
            type="button"
            className={outline.closed ? 'toolbtn toolbtn--on' : 'toolbtn'}
            aria-pressed={outline.closed}
            onClick={() => onChange({ ...outline, closed: !outline.closed })}
          >
            Ferme
          </button>
          <button
            type="button"
            className="toolbtn toolbtn--danger"
            onClick={() => onChange({ ...outline, nodes: [] })}
            disabled={outline.nodes.length === 0}
          >
            Effacer
          </button>
        </div>
      </div>

      <div
        className="contour__stage"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          loadImage(event.dataTransfer.files?.[0]);
        }}
      >
        <svg
          ref={svgRef}
          className="contour__svg"
          viewBox={viewBox}
          preserveAspectRatio="xMidYMid meet"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerLeave={endDrag}
        >
          <g transform="scale(1,-1)">
            {reference.src && reference.visible ? (
              <image
                href={reference.src}
                x={reference.x - reference.scale}
                y={-reference.y - reference.scale / 2}
                width={reference.scale * 2}
                height={reference.scale}
                opacity={reference.opacity / 100}
                preserveAspectRatio="xMidYMid meet"
                data-handle={reference.locked ? undefined : 'image'}
                style={{ cursor: reference.locked ? 'default' : 'move' }}
                onPointerDown={(event) => {
                  if (reference.locked) return;
                  event.stopPropagation();
                  setDrag({ kind: 'image' });
                }}
              />
            ) : null}

            {/* Axe miroir : la ligne autour de laquelle le trace se reflete. */}
            <line
              x1={-1000}
              y1={0}
              x2={1000}
              y2={0}
              stroke="#e30613"
              strokeOpacity={0.55}
              strokeWidth={strokeWidth}
              strokeDasharray={`${strokeWidth * 6} ${strokeWidth * 5}`}
            />

            {outline.mirror ? (
              <path
                d={mirrorPath(outline)}
                fill="rgba(227,6,19,0.10)"
                stroke="#e30613"
                strokeOpacity={0.45}
                strokeWidth={strokeWidth}
                strokeDasharray={`${strokeWidth * 4} ${strokeWidth * 4}`}
              />
            ) : null}

            <path
              d={outlinePath(outline)}
              fill={outline.closed ? 'rgba(227,6,19,0.16)' : 'none'}
              stroke="#e30613"
              strokeWidth={strokeWidth * 1.6}
              style={{ cursor: mode === 'select' ? 'copy' : 'crosshair' }}
              onPointerDown={(event) => {
                if (mode !== 'select') return;
                event.stopPropagation();
                const point = toLocal(event);
                insertOnSegment(point.x, point.y);
              }}
            />

            {outline.nodes.map((node) => (
              <g key={node.id}>
                <line
                  x1={node.x}
                  y1={node.y}
                  x2={node.x + node.outX}
                  y2={node.y + node.outY}
                  stroke="#ffffff"
                  strokeWidth={strokeWidth}
                />
                <line
                  x1={node.x}
                  y1={node.y}
                  x2={node.x + node.inX}
                  y2={node.y + node.inY}
                  stroke="#ffffff"
                  strokeWidth={strokeWidth}
                />
                <circle
                  data-handle="out"
                  cx={node.x + node.outX}
                  cy={node.y + node.outY}
                  r={handleSize * 0.8}
                  fill="#ffffff"
                  stroke="#101114"
                  strokeWidth={strokeWidth * 0.6}
                  style={{ cursor: 'grab' }}
                  onPointerDown={(event) => {
                    event.stopPropagation();
                    setSelected(node.id);
                    setDrag({ kind: 'out', id: node.id });
                  }}
                />
                <circle
                  data-handle="in"
                  cx={node.x + node.inX}
                  cy={node.y + node.inY}
                  r={handleSize * 0.8}
                  fill="#ffffff"
                  stroke="#101114"
                  strokeWidth={strokeWidth * 0.6}
                  style={{ cursor: 'grab' }}
                  onPointerDown={(event) => {
                    event.stopPropagation();
                    setSelected(node.id);
                    setDrag({ kind: 'in', id: node.id });
                  }}
                />
                <circle
                  data-handle="node"
                  cx={node.x}
                  cy={node.y}
                  r={handleSize * (node.id === selected ? 1.35 : 1)}
                  fill="#e30613"
                  stroke={node.id === selected ? '#101114' : '#ffffff'}
                  strokeWidth={strokeWidth}
                  style={{ cursor: 'grab' }}
                  onPointerDown={(event) => {
                    event.stopPropagation();
                    setSelected(node.id);
                    setMode('select');
                    setDrag({ kind: 'node', id: node.id });
                  }}
                  onDoubleClick={(event) => {
                    event.stopPropagation();
                    update(outline.nodes.filter((n) => n.id !== node.id));
                    setSelected(null);
                  }}
                />
              </g>
            ))}
          </g>
        </svg>

        {outline.nodes.length === 0 ? (
          <p className="contour__empty">
            Deposez une photo ici, puis cliquez pour poser le premier point.
          </p>
        ) : null}
      </div>

      <div className="contour__foot">
        <span>{outline.nodes.length} point{outline.nodes.length > 1 ? 's' : ''}</span>
        <span>·</span>
        <span>{mode === 'pen' ? 'Clic : poser un point' : 'Clic sur le trace : inserer'}</span>
        <span>·</span>
        <span>Suppr : effacer le point · Maj + glisser : deplacer la vue</span>
        {selected ? (
          <button type="button" className="btn btn--sm btn--ghost btn--danger" onClick={removeSelected}>
            Supprimer le point
          </button>
        ) : null}
      </div>
    </div>
  );
}
