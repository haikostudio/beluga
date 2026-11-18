/**
 * LA PUBLICATION PAR CHROME (carte « Réseaux sociaux reliés par Chrome », 09/11/2026).
 *
 * Un réseau dont la voie officielle est refusée, payante ou trop longue publie par un AGENT dans le Chrome de la
 * personne qui l'a connecté (extension Beluga). `publierContenu` (publication-sociale.ts) prend l'envoi « en cours »
 * puis appelle `envoyerParChrome` : une carte d'agent marketing s'ouvre, son interlocuteur est cette personne (sinon
 * l'outil « chrome » refuse tout), et le Chrome retenu est celui de la connexion. L'agent rend l'adresse du post par
 * l'outil « marketing », action « publication » (`rendreEnvoiParChrome`) — seul ce rendu clôt l'envoi, jamais deux fois.
 *
 * Chrome fermé : un départ programmé reste « en attente » et repart à chaque passage du minuteur — donc à la
 * réouverture, avec son retard dit. Une heure avant l'heure prévue, une alerte de BLOCAGE part si aucun Chrome de la
 * personne n'est ouvert (`veillerLesEnvoisParChrome`, une alerte par envoi).
 */
import {
  alerteChromeAEnvoyer,
  demandeDePublicationParChrome,
  FICHES_RESEAUX,
  instantPrevu,
  LABEL_MARKETING,
  RETARD_TOLERE_MS,
  type CompteSocial,
  type ContenuMarketing,
  type ReseauSocial,
} from '@beluga/shared';
import { getDb, getMeta, setMeta } from './db.js';
import { log } from './logger.js';
import * as store from './store.js';
import type { MediaAEnvoyer } from './reseaux/index.js';

export type DepartParChrome = { parti: true; cardId: string } | { parti: false; raison: string };

/** Le Chrome ouvert de cette personne : celui de la connexion d'abord, sinon un autre des siens. */
async function chromeOuvert(compteBeluga: string, voulu: string | null): Promise<{ id: string } | null> {
  const { chromesDuCompte } = await import('./extension-chrome.js');
  const ouverts = chromesDuCompte(compteBeluga).filter((c) => c.enLigne);
  return ouverts.find((c) => c.id === voulu) ?? ouverts[0] ?? null;
}

export async function envoyerParChrome(e: {
  contenu: Pick<ContenuMarketing, 'id' | 'projectId' | 'titre' | 'datePrevue' | 'heurePrevue'>;
  compte: CompteSocial;
  details: Record<string, unknown>;
  medias: readonly MediaAEnvoyer[];
  texte: string;
  lien: string | null;
}): Promise<DepartParChrome> {
  const compteBeluga = typeof e.details.compteBeluga === 'string' ? e.details.compteBeluga : null;
  if (!compteBeluga) return { parti: false, raison: 'Ce compte ne sait pas quel Chrome publie : connectez-le de nouveau.' };
  const { compteParId } = await import('./comptes.js');
  const personne = compteParId(compteBeluga);
  if (!personne?.actif) return { parti: false, raison: 'La personne dont le Chrome publie n’a plus d’accès : connectez le compte de nouveau.' };
  const chrome = await chromeOuvert(compteBeluga, typeof e.details.appareilId === 'string' ? e.details.appareilId : null);
  if (!chrome) return { parti: false, raison: 'Chrome est fermé : ouvrez Chrome avec l’extension Beluga, puis relancez.' };
  const projet = store.getProject(e.contenu.projectId);
  if (!projet) return { parti: false, raison: 'Projet introuvable.' };

  const libelle = FICHES_RESEAUX[e.compte.reseau].libelle;
  const prevu = instantPrevu(e.contenu.datePrevue, e.contenu.heurePrevue);
  const retard = prevu !== null && Date.now() - prevu > RETARD_TOLERE_MS ? Math.round((Date.now() - prevu) / 60_000) : 0;
  const { ouvrirCarteDAgent, direLaPanneSurLaCarte } = await import('./carte-d-agent-demon.js');
  const { reglagesDuMoteurMarketing } = await import('./assistant-marketing.js');
  const r = await reglagesDuMoteurMarketing();
  const { card, agentId } = ouvrirCarteDAgent({
    projectId: projet.id,
    titre: `Publier sur ${libelle} — ${e.contenu.titre}`.slice(0, 80),
    description: `Un agent publie ce post validé sur ${libelle} (« ${e.compte.nom} »), dans votre Chrome, une seule fois${retard ? `, avec ${retard} min de retard (Chrome était fermé)` : ''}.`,
    labels: [LABEL_MARKETING],
    role: 'task',
    run: { engine: 'claude', model: r.model, thinking: r.thinking as never },
  });
  /* SANS INTERLOCUTEUR, L'OUTIL « CHROME » REFUSE TOUT : c'est la personne de la connexion, et son Chrome. */
  const { noterLInterlocuteur } = await import('./interlocuteur.js');
  noterLInterlocuteur({ agentId, cardId: card.id }, personne);
  const { retenirLeChrome } = await import('./extension-chrome.js');
  retenirLeChrome(agentId, card.id, chrome.id);
  const { sendPrompt } = await import('./runtime.js');
  void sendPrompt(
    agentId,
    demandeDePublicationParChrome({
      nomProjet: projet.name,
      reseau: e.compte.reseau,
      compte: e.compte.nom,
      contenuId: e.contenu.id,
      compteId: e.compte.id,
      texte: e.texte,
      lien: e.lien,
      medias: e.medias.map((m) => ({ genre: m.genre, chemin: m.chemin })),
      retardMinutes: retard,
    }),
    { template: 'none', motif: 'configuration-marketing' },
  ).catch((err) => {
    /* L'agent n'a jamais démarré : rien n'est parti, l'envoi le dit — il ne repartira que sur un geste. */
    log.error('réseaux : l’agent de publication par Chrome n’a pas démarré', err);
    getDb()
      .prepare("UPDATE marketing_publications SET etat = 'echec', raison = ? WHERE contenu_id = ? AND compte_id = ? AND etat = 'en_cours'")
      .run('L’agent de publication n’a pas démarré : rien n’est parti.', e.contenu.id, e.compte.id);
    direLaPanneSurLaCarte(card.id, agentId, err?.message ?? String(err));
  });
  log.info(`réseaux : publication par Chrome de ${e.contenu.id} sur ${e.compte.reseau} « ${e.compte.nom} »${retard ? ` (${retard} min de retard)` : ''}`);
  return { parti: true, cardId: card.id };
}

interface EnvoiChromeEnAttente {
  contenu_id: string;
  compte_id: string;
  project_id: string;
  titre: string;
  date_prevue: string | null;
  heure_prevue: string | null;
  reseau: string;
  nom: string;
  details: string;
}

const cleDAlerte = (contenuId: string, compteId: string) => `alerte-chrome-ferme.${contenuId}.${compteId}`;

/**
 * UNE HEURE AVANT UN POST PAR CHROME, AUCUN CHROME OUVERT : une alerte de blocage à la personne dont le Chrome publie,
 * une fois par envoi. Rend le nombre d'alertes parties.
 */
export async function veillerLesEnvoisParChrome(maintenant = Date.now()): Promise<number> {
  const lignes = getDb()
    .prepare(
      `SELECT p.contenu_id, p.compte_id, c.project_id, c.titre, c.date_prevue, c.heure_prevue, k.reseau, k.nom, k.details
         FROM marketing_publications p
         JOIN marketing_contenus c ON c.id = p.contenu_id
         JOIN marketing_comptes k ON k.id = p.compte_id
        WHERE p.etat = 'en_attente' AND c.etape = 'programme' AND k.etat = 'relie' AND json_extract(k.details, '$.mode') = 'chrome'`,
    )
    .all() as EnvoiChromeEnAttente[];
  if (!lignes.length) return 0;
  const { chromesDuCompte } = await import('./extension-chrome.js');
  const { notify } = await import('./notify.js');
  let parties = 0;
  for (const l of lignes) {
    let d: Record<string, unknown> = {};
    try {
      d = JSON.parse(l.details || '{}') as Record<string, unknown>;
    } catch {
      /* détails illisibles : aucune personne à prévenir */
    }
    const compteBeluga = typeof d.compteBeluga === 'string' ? d.compteBeluga : null;
    if (!compteBeluga) continue;
    const cle = cleDAlerte(l.contenu_id, l.compte_id);
    const prevuLe = instantPrevu(l.date_prevue, l.heure_prevue);
    const ouvert = chromesDuCompte(compteBeluga).some((c) => c.enLigne);
    if (!alerteChromeAEnvoyer({ prevuLe, maintenant, chromeOuvert: ouvert, dejaAlertee: !!getMeta(cle) })) continue;
    setMeta(cle, String(maintenant));
    const libelle = FICHES_RESEAUX[l.reseau as ReseauSocial]?.libelle ?? l.reseau;
    const heure = prevuLe ? new Date(prevuLe).toLocaleTimeString('fr-CH', { hour: '2-digit', minute: '2-digit' }) : '';
    notify({
      motif: 'chrome-ferme',
      title: 'Chrome est fermé',
      body: `« ${l.titre} » doit partir sur ${libelle}${heure ? ` à ${heure}` : ''} par votre Chrome. Ouvrez-le pour qu’il parte à l’heure ; sinon il partira dès la réouverture.`,
      reference: cle,
      element: l.titre,
      projectId: l.project_id,
      pour: compteBeluga,
    });
    parties++;
  }
  return parties;
}
