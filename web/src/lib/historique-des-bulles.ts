/*
 * L'HISTORIQUE DES BULLES DE JARVIS (carte « Jarvis : parler dans ses bulles », décision de l'utilisateur du
 * 23/11/2026 : « quand je remonte, ça va charger les précédentes bulles qui ont été envoyées par Jarvis et par moi »).
 *
 * Les appels précédents se chargent depuis le démon (`voix.historique`), par pages, du plus récent au plus ancien :
 * la première à l'ouverture de la pile, les suivantes quand on remonte près du haut. Les tours rendus ont la forme du
 * fil du direct (`TourDuDirect`), marqués `ancien` avec leur discussion : la pile pose une ligne de date entre deux
 * appels. Rien ne se garde ici d'une ouverture à l'autre : la base des discussions fait foi.
 */
import * as React from 'react';
import { TOURS_MAX_D_HISTORIQUE_A_L_ECRAN, TOURS_PAR_PAGE_D_HISTORIQUE } from '@beluga/shared';
import { client } from './client';
import type { TourDuDirect } from './direct-codex';

interface TourBrut {
  id: number;
  discussion: number;
  debut: number;
  quand: number;
  role: string;
  texte: string;
}

/** Un tour de la base, dans la forme du fil du direct (identifiant négatif : jamais confondu avec un tour vivant). */
export function tourAncien(brut: TourBrut): TourDuDirect {
  const ancien = { discussion: brut.discussion, debut: brut.debut };
  if (brut.role === 'information') {
    const [tete, ...reste] = brut.texte.split('\n\n');
    const titre = /^\*\*(.+)\*\*$/.exec(tete?.trim() ?? '')?.[1];
    return {
      id: -brut.id,
      le: brut.quand,
      role: 'assistant',
      texte: '',
      final: true,
      projets: [],
      information: { id: `h${brut.id}`, titre: titre ?? '', contenu: titre ? reste.join('\n\n') : brut.texte },
      ancien,
    };
  }
  return { id: -brut.id, le: brut.quand, role: brut.role === 'user' ? 'user' : 'assistant', texte: brut.texte, final: true, projets: [], ancien };
}

export interface HistoriqueDesBulles {
  tours: TourDuDirect[];
  /** Plus rien au-dessus (ou le plafond de l'écran est atteint). */
  fin: boolean;
  charge: boolean;
  chargerPlus: () => void;
}

/** L'historique de l'agent `agentId`, chargé tant que `actif` est vrai ; vidé quand la pile se ferme. */
export function useHistoriqueDesBulles(actif: boolean, agentId: string | null | undefined): HistoriqueDesBulles {
  const [tours, setTours] = React.useState<TourDuDirect[]>([]);
  const [fin, setFin] = React.useState(false);
  const [charge, setCharge] = React.useState(false);
  const enVol = React.useRef(false);
  const toursRef = React.useRef<TourDuDirect[]>([]);
  toursRef.current = tours;
  const generation = React.useRef(0);

  const charger = React.useCallback(
    async (premiere: boolean) => {
      if (enVol.current) return;
      enVol.current = true;
      setCharge(true);
      const gen = generation.current;
      try {
        const avant = premiere ? undefined : -(toursRef.current[0]?.id ?? 0) || undefined;
        const r = await client.call<{ tours: TourBrut[]; fin: boolean }>({
          type: 'voix.historique',
          ...(agentId ? { agentId } : {}),
          ...(avant ? { avant } : {}),
          limite: TOURS_PAR_PAGE_D_HISTORIQUE,
        });
        if (gen !== generation.current) return;
        const nouveaux = (r?.tours ?? []).map(tourAncien);
        const suite = premiere ? nouveaux : [...nouveaux, ...toursRef.current];
        setTours(suite);
        setFin(!!r?.fin || suite.length >= TOURS_MAX_D_HISTORIQUE_A_L_ECRAN || !nouveaux.length);
      } catch {
        if (gen === generation.current) setFin(true);
      } finally {
        if (gen === generation.current) setCharge(false);
        enVol.current = false;
      }
    },
    [agentId],
  );

  React.useEffect(() => {
    generation.current += 1;
    enVol.current = false;
    setTours([]);
    setFin(false);
    setCharge(false);
    if (actif) void charger(true);
  }, [actif, charger]);

  const chargerPlus = React.useCallback(() => {
    if (!fin && !enVol.current && toursRef.current.length) void charger(false);
  }, [fin, charger]);

  return { tours, fin, charge, chargerPlus };
}
