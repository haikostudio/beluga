/**
 * L'AGENT D'ANALYSE DES BACKUPS — le travail réel.
 *
 * L'écran n'envoie pas quinze champs : il envoie UNE phrase. Ce module ouvre
 * alors une conversation dédiée, confiée à un agent au palier « standard »
 * (traduit en modèle réel par `reglagesDuNiveau` — on ne nomme jamais un modèle
 * ici, il vieillirait), et lui donne la demande fabriquée par la règle pure
 * (`shared/src/backups-agent.ts`).
 *
 * L'agent lit le site, POSE SES QUESTIONS avec `ask_user` — qui arrête le
 * moteur jusqu'à la réponse, exactement comme partout ailleurs —, essaie sa
 * recette avec `backup_essai`, puis enregistre la fiche et la recette avec
 * `backup_recette`. La conversation reste ouverte : c'est là que les questions
 * s'affichent et que le compte rendu se lit.
 *
 * CHAQUE AGENT A SA CARTE (`ouvrirCarteDAgent`). Une analyse, une réparation ou
 * une configuration tournait autrefois sans rien montrer au tableau : on voyait
 * un agent occupé sans pouvoir ouvrir sa fenêtre. La carte naît dans « En
 * cours » sur le projet du site (Beluga Build pour un site extérieur), suit la
 * fin de tour ordinaire — rapport rendu, carte fermée ; panne, carte qui le
 * dit — et la fiche du site en garde l'identifiant.
 *
 * LE TOUR EST LANCÉ SANS RETENIR L'ÉCRAN : un tour de moteur dure des minutes,
 * la commande rend la main tout de suite avec l'identifiant de la conversation,
 * comme le lancement d'un backup.
 */

import {
  demandeDAnalyse,
  demandeDeConfiguration,
  demandeDeRelecture,
  descriptionDeCarteDeBackup,
  echecsDeSuite,
  LABEL_BACKUP,
  raisonDemandeRefusee,
  reglagesDuNiveau,
  titreDeCarteDeBackup,
  titreDeLAnalyse,
  titreDeLAssistantBackup,
  titreDeLaRelecture,
} from '@beluga/shared';
import * as store from './store.js';
import { catalogueMoteurs } from './catalogue-moteurs.js';
import { sendPrompt } from './runtime.js';
import { echecsDuSite, listerPoints, lireSite, marquerRelecture } from './backups.js';
import { direLaPanneSurLaCarte, ouvrirCarteDAgent } from './carte-d-agent-demon.js';
import { bus } from './bus.js';
import { log } from './logger.js';

export interface DepartDAssistant {
  agentId: string;
  projectId: string;
  /** La carte de cet agent, posée dans « En cours » avant son premier mot. */
  cardId: string;
}

/**
 * Où la conversation s'ouvre. Un site rattaché à un projet appartient à ce
 * projet ; un site extérieur va chez Beluga Build lui-même — le tableau du serveur,
 * seul endroit qui ne dépend d'aucun client. À défaut, le premier projet ouvert :
 * une conversation doit bien vivre quelque part.
 */
function projetDAccueil(projectId?: string | null): { id: string; name: string; path: string } | null {
  const projets = store.listProjects();
  const vise = projectId ? projets.find((p) => p.id === projectId) : undefined;
  const retenu = vise ?? projets.find((p) => p.isSelf) ?? projets[0];
  return retenu ? { id: retenu.id, name: retenu.name, path: retenu.path } : null;
}

/**
 * LE MOTEUR ET LE MODÈLE DE L'AGENT. Claude au palier « standard » : écrire une
 * recette, c'est lire un site ET écrire les commandes qui le remettront en
 * place un jour de panne — une remise fausse ne se découvre qu'au pire moment,
 * le palier léger n'y suffit pas. Le catalogue est celui du serveur, pas une
 * liste écrite en dur : un modèle renommé ne casse rien.
 */
async function reglagesDeLAgent(): Promise<{ engine: 'claude'; model?: string; thinking: string }> {
  const catalogue = await catalogueMoteurs();
  const claude = catalogue.find((moteur) => moteur.id === 'claude');
  if (!claude) return { engine: 'claude', model: undefined, thinking: 'none' };
  const reglages = reglagesDuNiveau(claude, 'standard');
  return { engine: 'claude', model: reglages.model, thinking: reglages.thinking };
}

/**
 * Ouvre l'agent sur un nouveau site. Rend l'identifiant de la conversation :
 * c'est elle que l'écran propose d'ouvrir pour suivre les questions.
 */
export async function lancerAssistantDeBackup(entree: {
  description: string;
  projectId?: string | null;
}): Promise<DepartDAssistant> {
  const description = String(entree.description ?? '').trim();
  const refus = raisonDemandeRefusee(description);
  if (refus) throw new Error(refus);

  const projet = projetDAccueil(entree.projectId);
  if (!projet) throw new Error('Aucun projet ouvert : la conversation de l’agent n’a nulle part où vivre.');

  // Le projet RATTACHÉ au site n'est nommé à l'agent que si l'utilisateur l'a
  // choisi : un site extérieur accueilli chez Beluga Build ne doit pas se retrouver
  // avec « projectId: Beluga Build » dans sa fiche.
  const rattache = entree.projectId ? store.getProject(entree.projectId) : null;

  const reglages = await reglagesDeLAgent();
  const nom = rattache?.name ?? description;
  const { card, agentId } = ouvrirCarteDAgent({
    projectId: projet.id,
    titre: titreDeCarteDeBackup('configuration', nom),
    description: descriptionDeCarteDeBackup('configuration', nom),
    labels: [LABEL_BACKUP],
    role: 'task',
    titreAgent: titreDeLAssistantBackup(description),
    run: { engine: reglages.engine, model: reglages.model, thinking: reglages.thinking as any },
  });

  const demande = demandeDeConfiguration({
    description,
    projet: rattache ? { id: rattache.id, nom: rattache.name, chemin: rattache.path } : null,
  });

  // Le tour part SANS retenir l'écran : il dure des minutes, et l'agent
  // s'arrêtera de lui-même sur sa première question.
  void sendPrompt(agentId, demande, {
    template: 'none',
    silent: true,
    motif: 'configuration-backup',
  }).catch((err) => {
    log.error('agent d’analyse des backups : le tour a échoué', err);
    direLaPanneSurLaCarte(card.id, agentId, err?.message ?? String(err));
  });

  return { agentId, projectId: projet.id, cardId: card.id };
}

/**
 * REPRENDRE UN SITE DÉJÀ ENREGISTRÉ. Deux cas, un seul geste :
 *
 * - le site ÉCHOUE de suite : l'agent reçoit la fiche (sans ses mots de passe)
 *   et les MESSAGES DE LA MACHINE, mot pour mot, et répare. Le passage
 *   automatique appelle ceci tout seul après trois échecs de suite — au plus une
 *   fois par jour par site (`ECART_MINIMAL_RELECTURE_MS`), donc au plus une
 *   carte par jour.
 * - le site n'échoue pas : c'est une ANALYSE — il tourne peut-être encore sur
 *   la recette déduite de sa fiche, et l'agent lui en écrit une vraie. Seul un
 *   clic la demande : aucune analyse ne se lance d'elle-même sur un site qui
 *   marche.
 *
 * LA DATE DE RELECTURE EST POSÉE AVANT DE PARTIR : si le tour échoue, on ne
 * relance pas un agent toutes les cinq minutes sur la même fiche.
 */
export async function lancerRelectureDeBackup(siteId: string): Promise<DepartDAssistant> {
  const site = lireSite(siteId);
  if (!site) throw new Error('site introuvable');

  const projet = projetDAccueil(site.projectId);
  if (!projet) throw new Error('Aucun projet ouvert : la conversation de l’agent n’a nulle part où vivre.');

  const reparer = echecsDeSuite(listerPoints(site.id)) > 0;
  const travail = reparer ? 'reparation' : 'analyse';
  const reglages = await reglagesDeLAgent();
  const { card, agentId } = ouvrirCarteDAgent({
    projectId: projet.id,
    titre: titreDeCarteDeBackup(travail, site.nom),
    description: descriptionDeCarteDeBackup(travail, site.nom),
    labels: [LABEL_BACKUP],
    role: 'task',
    titreAgent: reparer ? titreDeLaRelecture(site.nom) : titreDeLAnalyse(site.nom),
    run: { engine: reglages.engine, model: reglages.model, thinking: reglages.thinking as any },
  });

  // La conversation ET SA CARTE sont retenues SUR LA FICHE : la fenêtre les
  // ouvre d'un clic, et son bouton suit l'agent tant qu'il travaille.
  marquerRelecture(site.id, { agentId, projectId: projet.id, cardId: card.id });

  const demande = reparer
    ? demandeDeRelecture({ site, echecs: echecsDuSite(site.id).slice(0, 3) })
    : demandeDAnalyse(site);
  void sendPrompt(agentId, demande, {
    template: 'none',
    silent: true,
    motif: 'configuration-backup',
  }).catch((err) => {
    log.error('reprise d’un site à sauvegarder : le tour a échoué', err);
    direLaPanneSurLaCarte(card.id, agentId, err?.message ?? String(err));
  });

  log.info(`backups : l’agent ${reparer ? 'répare' : 'analyse'} « ${site.nom} »`);
  bus.toast(
    'info',
    reparer
      ? `La sauvegarde de « ${site.nom} » échoue : l’agent reprend sa recette.`
      : `L’agent analyse « ${site.nom} » et écrit sa recette.`,
    card.id,
    'backup',
  );

  return { agentId, projectId: projet.id, cardId: card.id };
}
