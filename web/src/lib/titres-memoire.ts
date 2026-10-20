import * as React from 'react';
import { client } from '@/lib/client';

/**
 * LES TITRES CLAIRS DES UNITÉS QUE LE FIL D'UN AGENT CITE.
 *
 * Le texte qu'un agent reçoit de l'outil « memoire » porte le titre TECHNIQUE
 * (il fait partie de son contexte et ne change pas). L'écran, lui, montre le
 * titre clair, puis le code entre parenthèses : il le demande au démon
 * (`memoire.titres`).
 *
 * UN SEUL APPEL PAR VAGUE D'AFFICHAGE : toutes les demandes faites dans la même
 * trentaine de millisecondes partent ensemble, et chaque réponse reste en
 * cache — un fil de vingt points ne fait pas vingt requêtes. Une unité sans
 * titre clair est notée aussi (`null`) : on ne la redemande pas.
 */

const cache = new Map<string, string | null>();
const enAttente = new Set<string>();
const abonnes = new Set<() => void>();
let minuteur: ReturnType<typeof setTimeout> | null = null;
let version = 0;

function prevenir() {
  version += 1;
  for (const f of abonnes) f();
}

function partir() {
  minuteur = null;
  const ids = [...enAttente].slice(0, 500);
  for (const id of ids) enAttente.delete(id);
  if (!ids.length) return;
  client
    .call<{ titres: Record<string, string> }>({ type: 'memoire.titres', ids })
    .then((r) => {
      for (const id of ids) cache.set(id, r.titres?.[id] ?? null);
      prevenir();
    })
    .catch(() => {
      // Un démon qui ne connaît pas encore la commande : le fil garde les titres techniques.
      for (const id of ids) cache.set(id, null);
      prevenir();
    });
  if (enAttente.size) minuteur = setTimeout(partir, 30);
}

function demander(ids: readonly string[]) {
  let nouveau = false;
  for (const id of ids) {
    if (!id || cache.has(id) || enAttente.has(id)) continue;
    enAttente.add(id);
    nouveau = true;
  }
  if (nouveau && !minuteur) minuteur = setTimeout(partir, 30);
}

function sAbonner(f: () => void) {
  abonnes.add(f);
  return () => abonnes.delete(f);
}

/** Les titres clairs connus des unités demandées (id → titre ; absent = pas de titre clair). */
export function useTitresClairs(ids: readonly string[]): Readonly<Record<string, string>> {
  const cle = ids.join('|');
  React.useEffect(() => {
    demander(cle ? cle.split('|') : []);
  }, [cle]);
  const v = React.useSyncExternalStore(sAbonner, () => version, () => 0);
  return React.useMemo(() => {
    const titres: Record<string, string> = {};
    for (const id of cle ? cle.split('|') : []) {
      const titre = cache.get(id);
      if (titre) titres[id] = titre;
    }
    return titres;
    // `v` relit le cache à chaque réponse.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cle, v]);
}
