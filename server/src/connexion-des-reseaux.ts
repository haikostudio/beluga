/**
 * LA CONNEXION DES RÉSEAUX D'UNE MARQUE PAR CHROME (carte « Réseaux sociaux reliés par Chrome », 09/11/2026).
 *
 * L'étape 3 de Communication 2 : « Connecter » ouvre UN agent par projet (la boîte e-mail de la marque ne se crée
 * qu'une fois), qui traite les réseaux choisis l'un après l'autre dans le Chrome de la PERSONNE QUI A CLIQUÉ —
 * l'interlocuteur de l'agent est posé ici, sinon l'outil « chrome » refuse tout. L'état de chaque réseau (en cours,
 * connecté, bloqué) s'écrit au fur et à mesure par l'outil « marketing », action « connexion », et se garde en une
 * ligne JSON par projet (`meta`) ; un compte « connecté » n'est cru que s'il est relié EN BASE (officiel ou Chrome).
 */
import {
  demandeDeConnexionDesReseaux,
  estReseauSocial,
  FICHES_RESEAUX,
  raisonReliureImpossible,
  lireLesConnexions,
  LABEL_MARKETING,
  type CompteUtilisateur,
  type ConnexionDUnReseau,
  type EtatDeConnexion,
  type ModeDePublication,
  type ReseauSocial,
} from '@beluga/shared';
import { getMeta, setMeta } from './db.js';
import { log } from './logger.js';
import * as store from './store.js';
import { assurerEspace, diffuser, lireEspace } from './marketing.js';
import { adresseDeRetour, lireApplication } from './publication-sociale.js';

const cleConnexions = (projectId: string) => `connexion-reseaux.${projectId}`;
const cleCarte = (projectId: string) => `connexion-reseaux.carte.${projectId}`;

export function lireConnexionsDuProjet(projectId: string): Partial<Record<ReseauSocial, ConnexionDUnReseau>> {
  return lireLesConnexions(getMeta(cleConnexions(projectId)));
}

/** Écrit l'état d'UN réseau, sans toucher aux autres ; l'écran relit aussitôt. */
export function ecrireConnexion(
  projectId: string,
  reseau: ReseauSocial,
  e: { etat: EtatDeConnexion; mode?: ModeDePublication; compte?: string; note?: string },
  maintenant = Date.now(),
): ConnexionDUnReseau {
  const toutes = lireConnexionsDuProjet(projectId);
  const ligne: ConnexionDUnReseau = {
    etat: e.etat,
    ...(e.mode ? { mode: e.mode } : {}),
    ...(e.compte?.trim() ? { compte: e.compte.trim().slice(0, 120) } : {}),
    ...(e.note?.trim() ? { note: e.note.trim().slice(0, 400) } : {}),
    majLe: maintenant,
  };
  toutes[reseau] = ligne;
  setMeta(cleConnexions(projectId), JSON.stringify(toutes));
  diffuser(projectId);
  return ligne;
}

/** La carte de l'agent de connexion de ce projet, tant qu'elle travaille encore. */
export function carteDeConnexionEnCours(projectId: string): { cardId: string; agentId: string } | null {
  const cardId = getMeta(cleCarte(projectId));
  if (!cardId) return null;
  const carte = store.getCard(cardId);
  if (!carte || (carte.column !== 'planned' && carte.column !== 'running')) return null;
  const agent = store.listAgents().find((a) => a.cardId === carte.id && a.role !== 'cadrage');
  return agent ? { cardId: carte.id, agentId: agent.id } : null;
}

/** Le domaine du site du projet, quand il est connu : la boîte de la marque s'y crée. */
function domaineDuSite(adresse: string | null | undefined): string | null {
  try {
    return adresse ? new URL(adresse).hostname.replace(/^www\./, '') : null;
  } catch {
    return null;
  }
}

/**
 * « CONNECTER » : ouvre l'agent de connexion du projet sur ces réseaux (ou rend celui qui travaille déjà). Refusé tant
 * qu'aucun Chrome de la personne n'est ouvert : tout son travail se fait dans ce Chrome.
 */
export async function lancerConnexionDesReseaux(entree: {
  projectId: string;
  reseaux: readonly unknown[];
  compte: Pick<CompteUtilisateur, 'id' | 'role'>;
}): Promise<{ agentId: string; projectId: string; cardId: string; deja: boolean }> {
  const projet = store.getProject(entree.projectId);
  if (!projet) throw new Error('projet introuvable');
  const reseaux = [...new Set(entree.reseaux.filter(estReseauSocial))];
  if (!reseaux.length) throw new Error('Choisissez d’abord un réseau à connecter.');
  const enCours = carteDeConnexionEnCours(projet.id);
  if (enCours) return { ...enCours, projectId: projet.id, deja: true };

  const { chromesDuCompte } = await import('./extension-chrome.js');
  const ouverts = chromesDuCompte(entree.compte.id).filter((c) => c.enLigne);
  if (!ouverts.length) throw new Error('Ouvrez Chrome avec l’extension Beluga : l’agent connecte les réseaux dans votre Chrome.');

  assurerEspace(projet.id);
  const espace = lireEspace(projet.id);
  const adresseProduit = espace?.configuration.adresse ?? projet.vitrineLiee?.adresseProduction ?? null;
  const { ouvrirCarteDAgent, direLaPanneSurLaCarte } = await import('./carte-d-agent-demon.js');
  const { reglagesDuMoteurMarketing } = await import('./assistant-marketing.js');
  const r = await reglagesDuMoteurMarketing();
  const libelles = reseaux.map((x) => FICHES_RESEAUX[x].libelle).join(', ');
  const { card, agentId } = ouvrirCarteDAgent({
    projectId: projet.id,
    titre: `Connecter les réseaux — ${projet.name}`.slice(0, 80),
    description: `Un agent connecte ${libelles} pour « ${projet.name} » dans votre Chrome : il reprend les accès du coffre, sinon crée la boîte e-mail de la marque puis le compte, et tente la voie officielle de chaque réseau avant de passer par Chrome. Rien n’est payé ni publié.`,
    labels: [LABEL_MARKETING],
    role: 'task',
    run: { engine: 'claude', model: r.model, thinking: r.thinking as never },
  });
  setMeta(cleCarte(projet.id), card.id);
  /* SANS INTERLOCUTEUR, L'OUTIL « CHROME » REFUSE TOUT (« Je ne sais pas quelle personne te parle ») : c'est la
     personne qui a cliqué, et son Chrome ouvert est retenu pour toute la carte. */
  const { noterLInterlocuteur } = await import('./interlocuteur.js');
  noterLInterlocuteur({ agentId, cardId: card.id }, entree.compte);
  if (ouverts.length === 1) {
    const { retenirLeChrome } = await import('./extension-chrome.js');
    retenirLeChrome(agentId, card.id, ouverts[0]!.id);
  }
  for (const reseau of reseaux) ecrireConnexion(projet.id, reseau, { etat: 'en_cours' });
  const { sendPrompt } = await import('./runtime.js');
  void sendPrompt(
    agentId,
    demandeDeConnexionDesReseaux({
      nomProjet: projet.name,
      dossierCoffre: projet.name,
      reseaux: reseaux.map((reseau) => ({ reseau, applicationPrete: !raisonReliureImpossible(lireApplication(FICHES_RESEAUX[reseau].application)) })),
      adresseRetour: adresseDeRetour(),
      adresseProduit,
      domaine: domaineDuSite(adresseProduit),
    }),
    { template: 'none', motif: 'configuration-marketing' },
  ).catch((err) => {
    log.error('réseaux : l’agent de connexion n’a pas démarré', err);
    for (const reseau of reseaux) ecrireConnexion(projet.id, reseau, { etat: 'bloque', note: 'L’agent n’a pas démarré : relancez la connexion.' });
    direLaPanneSurLaCarte(card.id, agentId, err?.message ?? String(err));
  });
  log.info(`réseaux : agent de connexion ouvert pour « ${projet.name} » (${reseaux.join(', ')})`);
  return { agentId, projectId: projet.id, cardId: card.id, deja: false };
}
