import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  COMMANDE_DU_CONTROLE,
  commandeCollee,
  doitProposer,
  fichierACompter,
  genresSensibles,
  lireGenresProposes,
  suiteDuControle,
  suitesAvecLeControle,
  type Agent,
  type FichierDuTour,
  type GenreSensible,
  type SuiteProposee,
} from '@beluga/shared';
import { git } from './git.js';
import * as store from './store.js';
import { bus } from './bus.js';
import { log } from './logger.js';

/**
 * LE CONTRÔLE DE SÉCURITÉ PROPOSÉ EN FIN DE TOUR, PAR LE DÉMON (règles : `shared/src/proposition-securite.ts`).
 *
 * Aucune consigne n'est ajoutée à l'agent : on lit la demande de l'utilisateur et le diff de la copie de la
 * carte depuis le repère pris AVANT le tour, puis on pose la suite « /securite … » sur le message de réponse,
 * en dernière position. Seulement pour les tours d'une CARTE (cadrage, tâche) ; ni l'assistant global, ni
 * l'analyse de nuit, ni la publication. Tout est borné, et un échec ne coûte qu'une suite absente.
 */

const PLAFOND_LIGNES_PAR_FICHIER = 400;
const PLAFOND_LIGNES = 4000;
const PLAFOND_NOUVEAUX_FICHIERS = 40;
const PLAFOND_OCTETS_NOUVEAU_FICHIER = 200_000;
const DELAI_GIT_MS = 10_000;

/** Les fichiers touchés depuis `tete` (commits du tour ET copie non enregistrée), avec leurs lignes ajoutées, bornés. */
export async function fichiersDuTour(dossier: string, tete: string): Promise<FichierDuTour[]> {
  const fichiers = new Map<string, string[]>();
  let total = 0;
  const diff = await git(
    dossier,
    ['diff', '-U0', '--no-color', '--no-ext-diff', tete, '--', '.', ':!**/dist/**', ':!**/node_modules/**', ':!data/**', ':!**/*.lock', ':!**/package-lock.json'],
    DELAI_GIT_MS,
  );
  if (diff.ok) {
    let courant: string[] | null = null;
    for (const ligne of diff.out.split('\n')) {
      if (ligne.startsWith('+++ ')) {
        const chemin = ligne.slice(4).replace(/^b\//, '');
        courant = chemin === '/dev/null' || !fichierACompter(chemin) ? null : (fichiers.get(chemin) ?? []);
        if (courant) fichiers.set(chemin, courant);
      } else if (courant && ligne.startsWith('+') && courant.length < PLAFOND_LIGNES_PAR_FICHIER && total < PLAFOND_LIGNES) {
        courant.push(ligne.slice(1));
        total++;
      }
    }
  }
  const nouveaux = await git(dossier, ['ls-files', '--others', '--exclude-standard'], DELAI_GIT_MS);
  if (nouveaux.ok) {
    const chemins = nouveaux.out.split('\n').map((c) => c.trim()).filter((c) => c && fichierACompter(c));
    for (const chemin of chemins.slice(0, PLAFOND_NOUVEAUX_FICHIERS)) {
      if (total >= PLAFOND_LIGNES) {
        fichiers.set(chemin, []);
        continue;
      }
      try {
        const complet = path.join(dossier, chemin);
        const info = await fs.stat(complet);
        const lignes =
          info.size <= PLAFOND_OCTETS_NOUVEAU_FICHIER
            ? (await fs.readFile(complet, 'utf8')).split('\n').slice(0, PLAFOND_LIGNES_PAR_FICHIER)
            : [];
        total += lignes.length;
        fichiers.set(chemin, lignes);
      } catch {
        /* disparu entre-temps : rien à compter */
      }
    }
  }
  return [...fichiers].map(([chemin, ajouts]) => ({ chemin, ajouts }));
}

/** La demande ÉCRITE par l'utilisateur pour ce tour (sa bulle), jamais le gabarit ni les consignes injectées. */
function demandeDuTour(messageIdDeLaDemande: string | undefined): string {
  if (!messageIdDeLaDemande) return '';
  const message = store.getMessage(messageIdDeLaDemande);
  return message?.role === 'user' ? message.content : '';
}

/**
 * Pose la suite du contrôle de sécurité sur le message de réponse quand il y a lieu, et retient les genres
 * proposés sur la carte. Rend les suites du message après coup (inchangées s'il n'y avait rien à proposer).
 */
export async function proposerLeControleEnFinDeTour(input: {
  agent: Agent;
  messageId: string;
  messageIdDeLaDemande?: string;
  dossier: string;
  tete?: string | null;
}): Promise<SuiteProposee[] | undefined> {
  const { agent, messageId } = input;
  const actuelles = store.getMessage(messageId)?.suites;
  if (!agent.cardId || (agent.role !== 'task' && agent.role !== 'cadrage')) return actuelles;
  const carte = store.getCard(agent.cardId);
  if (!carte) return actuelles;
  try {
    const demande = demandeDuTour(input.messageIdDeLaDemande);
    // L'utilisateur lance déjà le contrôle : le lui reproposer serait du bruit.
    if (demande.trim().toLowerCase().startsWith(COMMANDE_DU_CONTROLE)) return actuelles;
    const trouves = new Set<GenreSensible>();
    if (commandeCollee(demande)) trouves.add('commande-collee');
    if (input.tete) for (const g of genresSensibles(await fichiersDuTour(input.dossier, input.tete))) trouves.add(g);
    const deja = lireGenresProposes(carte.securiteProposee);
    const nouveaux = doitProposer(deja, trouves);
    if (!nouveaux.length) return actuelles;

    const message = store.getMessage(messageId);
    if (!message) return actuelles;
    const suites = suitesAvecLeControle(message.suites, suiteDuControle(nouveaux));
    const ecrit = store.saveMessage({ ...message, suites });
    bus.emit({ type: 'message.upsert', message: ecrit });
    // Relue juste avant d'écrire : le tour a pu la déplacer entre-temps.
    const fraiche = store.getCard(agent.cardId);
    if (fraiche) store.saveCard({ ...fraiche, securiteProposee: [...deja, ...nouveaux] });
    return suites;
  } catch (err) {
    log.warn(`contrôle de sécurité proposé : ${(err as Error).message}`);
    return actuelles;
  }
}
