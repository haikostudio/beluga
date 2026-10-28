/**
 * LES MÉDIAS EN FABRICATION, CÔTÉ DÉMON : la liste tenue EN MÉMOIRE et
 * diffusée entière à chaque changement (`medias.fabrication`). Les règles —
 * forme, ménage, fermeture en fin de tour — vivent dans
 * `shared/src/media-en-fabrication.ts`.
 *
 * Deux sources l'alimentent : le mode réalisation (`realisation.ts`, suivi par
 * le démon) et l'outil
 * « media_en_cours » de n'importe quel agent (suivi par l'agent, refermé en
 * échec si son tour finit avant). Le média fini reste une pièce jointe
 * ordinaire, rangée par `joindreUnFichier` : ce module ne range aucun fichier.
 */

import {
  MediaEnFabrication,
  fermerLesBlocsDuTour,
  rangerLesMedias,
  type GenreDeMediaEnFabrication,
} from '@beluga/shared';
import * as store from './store.js';
import { bus } from './bus.js';
import { enregistrerUnMediaLivre } from './medias-livres.js';

let liste: MediaEnFabrication[] = [];

function diffuser(): void {
  bus.emit({ type: 'medias.fabrication', items: liste });
}

function ecrire(suivante: MediaEnFabrication[]): void {
  liste = rangerLesMedias(suivante, Date.now());
  diffuser();
}

/** La liste entière, pour le premier envoi d'un écran. */
export function mediasEnFabrication(): MediaEnFabrication[] {
  liste = rangerLesMedias(liste, Date.now());
  return liste;
}

export interface AnnonceDeMedia {
  id?: string;
  projectId: string;
  cardId?: string | null;
  agentId?: string | null;
  sujet: string;
  outil: string;
  prix?: number | null;
  format?: string;
  genre: GenreDeMediaEnFabrication;
  suivi?: 'agent' | 'service';
}

/** Un média part en fabrication : son bloc paraît dans le fil. */
export function annoncerUnMedia(a: AnnonceDeMedia): MediaEnFabrication {
  const m = MediaEnFabrication.parse({
    id: a.id ?? store.newId(),
    projectId: a.projectId,
    cardId: a.cardId ?? undefined,
    agentId: a.agentId ?? undefined,
    sujet: a.sujet.trim().slice(0, 160) || 'Média',
    outil: a.outil.trim().slice(0, 120) || 'Outil non précisé',
    ...(a.prix !== undefined ? { prix: a.prix } : {}),
    ...(a.format ? { format: a.format.slice(0, 12) } : {}),
    genre: a.genre,
    debut: Date.now(),
    etat: 'en-cours',
    suivi: a.suivi ?? 'agent',
  });
  ecrire([...liste.filter((x) => x.id !== m.id), m]);
  return m;
}

/** Le média est prêt (avec sa pièce jointe) ou a échoué : le bloc montre l'aperçu, ou l'échec. */
export function terminerUnMedia(
  id: string,
  fin: { attachmentId?: string | null; echec?: string | null; prix?: number | null; legende?: string | null },
): MediaEnFabrication | null {
  const avant = liste.find((m) => m.id === id);
  if (!avant) return null;
  const apres: MediaEnFabrication = {
    ...avant,
    fin: Date.now(),
    etat: fin.echec ? 'echec' : 'fini',
    ...(fin.attachmentId ? { attachmentId: fin.attachmentId } : {}),
    ...(fin.echec ? { echec: fin.echec.slice(0, 300) } : {}),
    ...(fin.prix !== undefined ? { prix: fin.prix } : {}),
    ...(fin.legende?.trim() ? { legende: fin.legende.trim().slice(0, 400) } : {}),
  };
  /* Fini avec sa pièce : il entre aussi, pour de bon, dans les médias livrés de
     sa discussion — rendus sous la réponse finale (`medias-livres.ts`). */
  if (apres.etat === 'fini') enregistrerUnMediaLivre(apres);
  ecrire(liste.map((m) => (m.id === id ? apres : m)));
  return apres;
}

/** Les blocs encore ouverts d'un agent, pour l'outil (fermer celui qu'on vient d'ouvrir). */
export function blocOuvertDeLAgent(agentId: string, id?: string): MediaEnFabrication | null {
  const ouverts = liste.filter((m) => m.agentId === agentId && m.etat === 'en-cours' && m.suivi !== 'service');
  return (id ? ouverts.find((m) => m.id === id) : ouverts[ouverts.length - 1]) ?? null;
}

/** La fin d'un tour referme en échec ce que son agent avait annoncé sans le finir. */
export function fermerLesBlocsDeLAgent(agentId: string): void {
  if (!liste.some((m) => m.agentId === agentId && m.etat === 'en-cours' && m.suivi !== 'service')) return;
  ecrire(fermerLesBlocsDuTour(liste, agentId, Date.now()));
}
