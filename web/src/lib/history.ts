/**
 * Pile d'annulation partagee.
 *
 * Un editeur parametrique a ceci de commode qu'un etat tient tout entier
 * dans un objet : annuler revient a reprendre l'objet precedent, sans avoir
 * a decrire l'inverse de chaque geste.
 *
 * Les modifications rapprochees sont FUSIONNEES. Sans cela, glisser un
 * curseur de deux millimetres empilerait cinquante entrees, et annuler ne
 * reculerait que d'un cheveu — l'utilisateur ne veut pas defaire un
 * echantillon de glisser, il veut defaire le glisser.
 */

import { useCallback, useRef, useState } from 'react';

/** Deux modifications separees de moins que cela ne font qu'une entree. */
const MERGE_MS = 600;

/** Profondeur de la pile : au-dela, les vieux etats ne servent plus. */
const DEPTH = 80;

export interface History<T> {
  state: T;
  /** Modifie l'etat en empilant une entree (fusionnee si trop rapprochee). */
  set: (next: T | ((current: T) => T)) => void;
  /** Remplace l'etat SANS toucher a la pile : chargement de projet, reset. */
  reset: (next: T) => void;
  /** Ouvre une nouvelle entree meme si la precedente est toute fraiche. */
  mark: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

export function useHistory<T>(initial: T | (() => T)): History<T> {
  // Pile et curseur dans UN seul etat : les garder separes obligerait a les
  // mettre a jour l'un dans le rendu de l'autre, ce qui se desynchronise des
  // que deux modifications arrivent dans le meme lot React.
  const [stack, setStack] = useState<{ entries: T[]; cursor: number }>(() => ({
    entries: [typeof initial === 'function' ? (initial as () => T)() : initial],
    cursor: 0,
  }));
  const lastTouch = useRef(0);
  const forceSplit = useRef(false);

  const set = useCallback((next: T | ((current: T) => T)) => {
    const now = Date.now();
    const merge = !forceSplit.current && now - lastTouch.current < MERGE_MS;
    lastTouch.current = now;
    forceSplit.current = false;
    setStack(({ entries, cursor }) => {
      const current = entries[cursor];
      const value = typeof next === 'function' ? (next as (c: T) => T)(current) : next;
      if (Object.is(value, current)) return { entries, cursor };
      // On coupe tout ce qui suit : repartir d'un etat annule ouvre une
      // nouvelle branche, et l'ancienne n'a plus de sens.
      const head = entries.slice(0, merge ? cursor : cursor + 1);
      const grown = [...head, value].slice(-DEPTH);
      return { entries: grown, cursor: grown.length - 1 };
    });
  }, []);

  const reset = useCallback((next: T) => {
    lastTouch.current = 0;
    forceSplit.current = false;
    setStack({ entries: [next], cursor: 0 });
  }, []);

  const mark = useCallback(() => {
    forceSplit.current = true;
  }, []);

  const undo = useCallback(() => {
    forceSplit.current = true;
    setStack(({ entries, cursor }) => ({ entries, cursor: Math.max(cursor - 1, 0) }));
  }, []);

  const redo = useCallback(() => {
    forceSplit.current = true;
    setStack(({ entries, cursor }) => ({
      entries,
      cursor: Math.min(cursor + 1, entries.length - 1),
    }));
  }, []);

  return {
    state: stack.entries[stack.cursor],
    set,
    reset,
    mark,
    undo,
    redo,
    canUndo: stack.cursor > 0,
    canRedo: stack.cursor < stack.entries.length - 1,
  };
}
