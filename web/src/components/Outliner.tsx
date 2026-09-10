/**
 * Arbre de scene.
 *
 * L'editeur reste parametrique : il n'y a pas de vrai graphe de scene sous
 * le capot, seulement un jeu de nombres. L'outliner en donne la LECTURE que
 * l'on attend d'un modeleur — un arbre ou chaque piece se selectionne, se
 * renomme, se masque et se supprime — sans introduire de hierarchie qui
 * n'existe pas dans le modele.
 */

import { useState } from 'react';
import type { LureParams } from '../types/lure';

/** Ce qu'un noeud designe. La selection pilote l'inspecteur de droite. */
export type NodeKind =
  | 'project'
  | 'environment'
  | 'body'
  | 'lineTie'
  | 'anchor'
  | 'eyes'
  | 'gills'
  | 'outline'
  | 'decal'
  | 'scales'
  | 'ribs'
  | 'shell'
  | 'popperFace'
  | 'inlay'
  | 'dowels'
  | 'articulation'
  | 'jointEye'
  | 'jointPin'
  | 'jointSlot'
  | 'bib'
  | 'tail'
  | 'ballast';

export interface SceneNode {
  id: string;
  kind: NodeKind;
  label: string;
  /** Icone de type, en une graphie. */
  icon: string;
  children?: SceneNode[];
  /** Avertissement contextuel affiche a droite de la ligne. */
  warning?: string;
  visible?: boolean;
  onToggleVisible?: () => void;
  onDuplicate?: () => void;
  onRemove?: () => void;
  onRename?: (name: string) => void;
  /** Reordonnancement par glisser-deposer, dans une meme fratrie. */
  dragGroup?: string;
  onDropBefore?: (draggedId: string) => void;
}

interface Props {
  nodes: SceneNode[];
  selected: string | null;
  onSelect: (id: string, kind: NodeKind) => void;
  onAdd: (what: AddKind) => void;
  params: LureParams;
}

export type AddKind =
  | 'template'
  | 'inlay'
  | 'dowels'
  | 'decal'
  | 'scales'
  | 'ribs'
  | 'shell'
  | 'popperFace'
  | 'articulation'
  | 'eyes'
  | 'anchor'
  | 'ballast'
  | 'bib';

const ADD_MENU: { kind: AddKind; label: string; hint: string }[] = [
  { kind: 'articulation', label: 'Articulation', hint: 'Coupe le corps en deux segments articules' },
  { kind: 'template', label: 'Modele guide 2 parties', hint: 'Un articule complet, deja regle et flottant' },
  { kind: 'decal', label: 'Decal', hint: 'Forme deposee sur le corps, en relief ou gravee' },
  { kind: 'scales', label: 'Ecailles', hint: 'Trame carrelee sur tout le corps' },
  { kind: 'ribs', label: 'Nervures', hint: 'Anneaux en relief perpendiculaires a l axe' },
  { kind: 'shell', label: 'Coque et insert', hint: 'Paroi mince et piece reflechissante interne' },
  { kind: 'popperFace', label: 'Face de popper', hint: 'Cuvette avant : diametre, profondeur, angle' },
  { kind: 'inlay', label: 'Rainure de collant', hint: 'Creux plat pour un collant reflechissant' },
  { kind: 'dowels', label: 'Goupilles d assemblage', hint: 'Barreaux imprimes qui alignent les deux coques' },
  { kind: 'eyes', label: 'Oeil', hint: 'Cuvette et iris graves dans la tete' },
  { kind: 'anchor', label: 'Support d hamecon', hint: 'Ancrage de goupille en 8' },
  { kind: 'ballast', label: 'Lest', hint: 'Masse interne de reglage' },
  { kind: 'bib', label: 'Bavette', hint: 'Levre de plongee, imprimee ou polycarbonate' },
];

function Row({
  node,
  depth,
  selected,
  onSelect,
}: {
  node: SceneNode;
  depth: number;
  selected: string | null;
  onSelect: (id: string, kind: NodeKind) => void;
}) {
  const [open, setOpen] = useState(true);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(node.label);
  const isSelected = node.id === selected;
  const hasChildren = !!node.children && node.children.length > 0;

  const commit = () => {
    setEditing(false);
    const name = draft.trim();
    if (name && name !== node.label) node.onRename?.(name);
    else setDraft(node.label);
  };

  return (
    <>
      <div
        className={isSelected ? 'tree__row tree__row--on' : 'tree__row'}
        style={{ paddingLeft: 6 + depth * 14 }}
        draggable={!!node.dragGroup}
        onDragStart={(event) => {
          if (!node.dragGroup) return;
          event.dataTransfer.setData('text/plain', `${node.dragGroup}:${node.id}`);
          event.dataTransfer.effectAllowed = 'move';
        }}
        onDragOver={(event) => {
          if (!node.onDropBefore) return;
          const raw = event.dataTransfer.getData('text/plain');
          if (raw && !raw.startsWith(`${node.dragGroup}:`)) return;
          event.preventDefault();
        }}
        onDrop={(event) => {
          if (!node.onDropBefore) return;
          const raw = event.dataTransfer.getData('text/plain');
          const [group, id] = raw.split(':');
          if (group !== node.dragGroup || !id || id === node.id) return;
          event.preventDefault();
          node.onDropBefore(id);
        }}
        onClick={() => onSelect(node.id, node.kind)}
      >
        {node.dragGroup ? <span className="tree__grip" aria-hidden="true">⠿</span> : null}

        {hasChildren ? (
          <button
            type="button"
            className="tree__twist"
            aria-label={open ? 'Replier' : 'Deplier'}
            aria-expanded={open}
            onClick={(event) => {
              event.stopPropagation();
              setOpen((v) => !v);
            }}
          >
            {open ? '▾' : '▸'}
          </button>
        ) : (
          <span className="tree__twist" aria-hidden="true" />
        )}

        <span className="tree__icon" aria-hidden="true">
          {node.icon}
        </span>

        {editing ? (
          <input
            className="tree__rename"
            value={draft}
            autoFocus
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commit();
              if (event.key === 'Escape') {
                setDraft(node.label);
                setEditing(false);
              }
            }}
            onClick={(event) => event.stopPropagation()}
          />
        ) : (
          <span
            className="tree__label"
            onDoubleClick={(event) => {
              if (!node.onRename) return;
              event.stopPropagation();
              setDraft(node.label);
              setEditing(true);
            }}
          >
            {node.label}
          </span>
        )}

        <span className="tree__actions">
          {node.warning ? (
            <span className="tree__warn" title={node.warning}>
              ⚠️
            </span>
          ) : null}
          {node.onDuplicate ? (
            <button
              type="button"
              className="tree__act"
              title="Dupliquer"
              aria-label={`Dupliquer ${node.label}`}
              onClick={(event) => {
                event.stopPropagation();
                node.onDuplicate?.();
              }}
            >
              ⧉
            </button>
          ) : null}
          {node.onToggleVisible ? (
            <button
              type="button"
              className={node.visible ? 'tree__act' : 'tree__act tree__act--off'}
              title={node.visible ? 'Masquer' : 'Afficher'}
              aria-label={`${node.visible ? 'Masquer' : 'Afficher'} ${node.label}`}
              aria-pressed={node.visible}
              onClick={(event) => {
                event.stopPropagation();
                node.onToggleVisible?.();
              }}
            >
              {node.visible ? '👁' : '🚫'}
            </button>
          ) : null}
          {node.onRemove ? (
            <button
              type="button"
              className="tree__act tree__act--danger"
              title="Supprimer"
              aria-label={`Supprimer ${node.label}`}
              onClick={(event) => {
                event.stopPropagation();
                node.onRemove?.();
              }}
            >
              🗑
            </button>
          ) : null}
        </span>
      </div>

      {hasChildren && open
        ? node.children!.map((child) => (
            <Row
              key={child.id}
              node={child}
              depth={depth + 1}
              selected={selected}
              onSelect={onSelect}
            />
          ))
        : null}
    </>
  );
}

export function Outliner({ nodes, selected, onSelect, onAdd }: Props) {
  const [menu, setMenu] = useState(false);

  return (
    <section className="tree" aria-label="Arbre de scene">
      <header className="tree__head">
        <h3>Contour</h3>
        <div className="tree__addWrap">
          <button
            type="button"
            className="btn btn--sm btn--primary"
            aria-expanded={menu}
            aria-haspopup="menu"
            onClick={() => setMenu((v) => !v)}
          >
            + Ajouter
          </button>
          {menu ? (
            <div className="tree__menu" role="menu">
              {ADD_MENU.map((item) => (
                <button
                  key={item.kind}
                  type="button"
                  role="menuitem"
                  className="tree__menuItem"
                  onClick={() => {
                    setMenu(false);
                    onAdd(item.kind);
                  }}
                >
                  <strong>{item.label}</strong>
                  <span>{item.hint}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </header>

      <div className="tree__body">
        {nodes.map((node) => (
          <Row key={node.id} node={node} depth={0} selected={selected} onSelect={onSelect} />
        ))}
      </div>
    </section>
  );
}
