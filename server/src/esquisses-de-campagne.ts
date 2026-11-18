/**
 * L'ESQUISSE D'UNE CAMPAGNE (carte « Visuel vivant pendant la création de campagne », 10/11/2026).
 *
 * Après chaque grande étape de la conception (idée ; message et ton ; stratégie complète) et à chaque changement de
 * direction, l'agent de la campagne DESSINE l'idée : une vraie image, GRATUITE (Codex du serveur, jamais le service
 * externe payant — l'agent n'a pas de carte, DEC-447), posée dans SA discussion.
 *
 *  - LA DISCUSSION NE S'ARRÊTE PAS : l'outil rend la main aussitôt ; l'image se fabrique en arrière-plan (1 à 4 min,
 *    file Codex unique du serveur), sous un bloc d'attente tenu par le DÉMON (`suivi: 'service'`) qui survit à la fin
 *    du tour et devient la ligne du fil avec son aperçu.
 *  - Elle reste dans la discussion, JAMAIS dans Médias (`pieceDeConception`, nom « esquisse-campagne-… » et outil
 *    `OUTIL_D_ESQUISSE`).
 *  - La DERNIÈRE devient l'image de la campagne tant qu'aucun vrai visuel ne la remplace (`retenirLEsquisse`), et
 *    sert de RÉFÉRENCE aux vrais visuels fabriqués ensuite dans le Studio.
 *  - Un échec (quota Codex, délai) se dit dans le bloc, en une raison courte ; la conception continue en mots.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { OUTIL_D_ESQUISSE, nomDEsquisse } from '@beluga/shared';
import * as store from './store.js';
import { getMeta, setMeta } from './db.js';
import { joindreUnFichier } from './joindre-fichier.js';
import { annoncerUnMedia, terminerUnMedia } from './medias-en-fabrication.js';
import { log } from './logger.js';
import { fabriquerUneImageGratuite } from './exemples-de-choix.js';
import { retenirLEsquisse } from './communication.js';

const cleDuRang = (campagneId: string) => `communication.esquisse.rang.${campagneId}`;

/** Les esquisses en cours de dessin, par campagne : une seule à la fois, la suivante attend la fin de la précédente. */
const enCours = new Map<string, Promise<unknown>>();

export interface DemandeDEsquisse {
  agentId: string;
  campagneId: string;
  titreDeCampagne: string;
  consigne: string;
}

/** Ce que l'outil rend à l'agent : jamais d'attente, toujours de quoi continuer. */
export function dessinerUneEsquisse(d: DemandeDEsquisse): { ok: boolean; text: string } {
  const consigne = d.consigne.trim().slice(0, 2000);
  if (!consigne) return { ok: false, text: 'Décris l’image à dessiner (« consigne ») : le sujet, la scène, le cadrage, l’ambiance, les couleurs de la marque, la phrase clé s’il en faut une.' };
  const agent = store.getAgent(d.agentId);
  if (!agent) return { ok: false, text: 'Agent introuvable.' };
  const rang = Number(getMeta(cleDuRang(d.campagneId)) ?? 0) + 1;
  setMeta(cleDuRang(d.campagneId), String(rang));
  const legende = `Esquisse ${rang} — ${d.titreDeCampagne}`;
  const bloc = annoncerUnMedia({
    agentId: agent.id,
    projectId: agent.projectId,
    genre: 'image',
    sujet: legende,
    outil: OUTIL_D_ESQUISSE,
    prix: 0,
    format: '1:1',
    /* LE DÉMON TIENT LE BLOC : la fin du tour (une question posée, une réponse rendue) ne le ferme pas en échec. */
    suivi: 'service',
  });
  const avant = enCours.get(d.campagneId) ?? Promise.resolve();
  const travail = avant
    .catch(() => undefined)
    .then(async () => {
      const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'beluga-esquisse-'));
      try {
        const rendu = await fabriquerUneImageGratuite(consigne, dossier);
        if (typeof rendu !== 'string') {
          terminerUnMedia(bloc.id, { echec: rendu.refus });
          return;
        }
        const j = await joindreUnFichier({ projectId: agent.projectId, agentId: agent.id, fichier: rendu, nom: nomDEsquisse(rang), deLAgent: true });
        if (!j.ok) {
          terminerUnMedia(bloc.id, { echec: 'esquisse non jointe' });
          return;
        }
        terminerUnMedia(bloc.id, { attachmentId: j.attachment.id, legende });
        retenirLEsquisse(d.campagneId, j.attachment.id);
      } catch (err: any) {
        log.warn('esquisse de campagne : dessin tombé', err?.message ?? err);
        terminerUnMedia(bloc.id, { echec: 'esquisse interrompue' });
      } finally {
        fs.rmSync(dossier, { recursive: true, force: true });
      }
    });
  enCours.set(d.campagneId, travail);
  void travail.finally(() => {
    if (enCours.get(d.campagneId) === travail) enCours.delete(d.campagneId);
  });
  return {
    ok: true,
    text: `L’esquisse ${rang} se dessine (une à quatre minutes) : elle paraîtra d’elle-même dans la discussion, puis servira d’image à la campagne. N’attends pas : continue tout de suite (dis en une phrase ce qu’elle va montrer, puis pose ta question suivante). Si elle échoue, le bloc dit pourquoi et la conception continue en mots.`,
  };
}
