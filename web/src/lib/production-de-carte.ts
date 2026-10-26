import * as React from 'react';
import { carteDeMedia, etapeCouranteDuMedia, etapesDuMedia, type Card, type EtapeDuMedia, type EtatDeProduction } from '@beluga/shared';
import { client } from '@/lib/client';
import { useApp } from '@/lib/use-app';

/*
 * L'ÉTAT D'UNE PRODUCTION, lu au démon (`production.lire`) et relu à chaque
 * changement annoncé (`production.maj`) ou à chaque fabrication de la carte
 * qui commence ou finit — jamais à chaque tic de progression.
 *
 * UNE SEULE LECTURE PAR ÉTAT : le volet de suivi et CHAQUE média du fil (son
 * menu « … », sa ligne d'informations) lisent la même production ; la
 * demande en vol est partagée, et le dernier état connu sert d'emblée.
 */
const enVol = new Map<string, Promise<EtatDeProduction>>();
const derniers = new Map<string, EtatDeProduction>();

function lire(cardId: string, cle: string): Promise<EtatDeProduction> {
  const deja = enVol.get(cle);
  if (deja) return deja;
  const promesse = client.call<EtatDeProduction>({ type: 'production.lire', cardId }).then((r) => {
    derniers.set(cardId, r);
    return r;
  });
  enVol.set(cle, promesse);
  /* La clé change à chaque nouvel état : l'ancienne se libère vite. */
  const liberer = () => setTimeout(() => enVol.delete(cle), 2000);
  promesse.then(liberer, liberer);
  return promesse;
}

export function useProduction(cardId: string | null | undefined): EtatDeProduction | null {
  const [etat, setEtat] = React.useState<EtatDeProduction | null>(() => (cardId ? derniers.get(cardId) ?? null : null));
  const maj = useApp().productionsMaj?.[cardId ?? ''] ?? 0;
  const fabrications = useApp().mediasEnFabrication ?? [];
  const signature = cardId
    ? fabrications
        .filter((m) => m.cardId === cardId)
        .map((m) => `${m.id}:${m.etat}`)
        .join(',')
    : '';
  React.useEffect(() => {
    if (!cardId) {
      setEtat(null);
      return;
    }
    let vivant = true;
    lire(cardId, `${cardId}|${maj}|${signature}`)
      .then((r) => {
        if (vivant) setEtat(r);
      })
      .catch(() => {});
    return () => {
      vivant = false;
    };
  }, [cardId, maj, signature]);
  return cardId ? etat : null;
}

/**
 * LES SIX ÉTAPES D'UNE CRÉATION DE MÉDIA (`etapesDuMedia`), lues sur la carte
 * et sur sa production — `null` pour une carte qui n'est pas un média. La
 * barre d'étapes, le volet de suivi et le bouton d'étape les lisent toutes les
 * trois ici : ils allument la même étape au même moment.
 */
export function useEtapesDuMedia(carte: Card | null | undefined): { segments: SegmentDuMedia[]; courante: EtapeDuMedia } | null {
  const media = carteDeMedia(carte);
  const production = useProduction(media ? carte?.id : null);
  return React.useMemo(() => {
    if (!media || !carte) return null;
    const segments = etapesDuMedia({ carte, elements: production?.elements ?? [], lots: production?.lots ?? [] });
    return { segments, courante: etapeCouranteDuMedia(segments) };
  }, [media, carte, production]);
}

export type SegmentDuMedia = ReturnType<typeof etapesDuMedia>[number];
