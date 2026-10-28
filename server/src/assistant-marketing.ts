/**
 * L'AGENT MARKETING ATTITRÉ D'UN PROJET.
 *
 * Même mécanique que l'agent de surveillance (`assistant-surveillance.ts`) :
 * l'écran envoie UNE phrase, ce module ouvre une conversation au palier
 * « standard » avec sa CARTE (`ouvrirCarteDAgent` : rien ne tourne sans se voir
 * au tableau) — mais DANS LE PROJET VISÉ, pas chez Beluga Build : l'agent lit
 * le dépôt du projet qu'il doit vendre.
 *
 * UN SEUL AGENT PAR PROJET. Il est retenu sur l'espace marketing ; la phrase
 * suivante lui est envoyée à LUI, pour qu'il garde ce qu'il a compris. Une
 * conversation disparue (retirée à la main) en fait naître une nouvelle.
 *
 * LE DIMANCHE SOIR (`lancerLesPlansDeLaSemaine`), chaque projet actif (suivi
 * marketing non coupé, `EspaceMarketing.actif`) qui a une
 * fiche reçoit un tour court sur SA PROPRE carte, rangée ensuite directement
 * en archive (comme le rendez-vous de nuit, DEC-247) : l'agent lit tout avec
 * l'outil « marketing », il n'a pas besoin de la conversation de la semaine.
 * SAUF si 10 contenus ou plus attendent déjà : produire encore n'aide pas.
 *
 * CHAQUE JOUR (`lancerLaReorganisationDuJour`), un tour du même genre replace
 * les dates des brouillons en retard selon le rythme réel de l'utilisateur —
 * seulement pour les projets qui ont quelque chose à replacer.
 */
import {
  LABEL_MARKETING,
  demandeDeReorganisation,
  demandeDuGeste,
  demandeDuPlanHebdo,
  demandeMarketing,
  ficheRemplie,
  raisonDemandeMarketingRefusee,
  reglagesDuNiveau,
  titreDeLAgentMarketing,
  estSiteAutonome,
  jourLocalDe,
  FICHES_RESEAUX,
  demandeDeCreationDeCompte,
  estReseauSocial,
} from '@beluga/shared';
import * as store from './store.js';
import { catalogueMoteurs } from './catalogue-moteurs.js';
import { sendPrompt } from './runtime.js';
import { direLaPanneSurLaCarte, ouvrirCarteDAgent, rangerCarteDAgent } from './carte-d-agent-demon.js';
import { assurerEspace, diffuser, listerEspaces, lireEspace as lireEspaceMarketing, marquerAgentMarketing, productionSuspendue, projetsAReorganiser, rythmeDuProjet } from './marketing.js';
import { adresseDeRetour, ecrireApplication, lireApplication } from './publication-sociale.js';
import { log } from './logger.js';

export interface DepartMarketing {
  agentId: string;
  projectId: string;
  cardId: string;
}

async function reglages() {
  const catalogue = await catalogueMoteurs();
  const claude = catalogue.find((moteur) => moteur.id === 'claude');
  return claude ? reglagesDuNiveau(claude, 'standard') : { model: undefined, thinking: 'none' };
}

export async function lancerAgentMarketing(entree: { projectId: string; demande: string }): Promise<DepartMarketing> {
  const demande = String(entree.demande ?? '').trim();
  const refus = raisonDemandeMarketingRefusee(demande);
  if (refus) throw new Error(refus);
  const projet = store.getProject(entree.projectId);
  if (!projet) throw new Error('projet introuvable');
  const espace = assurerEspace(projet.id);

  const existant = espace.agentId ? store.getAgent(espace.agentId) : null;
  if (existant && espace.cardId) {
    void sendPrompt(existant.id, demandeMarketing({ demande, nomProjet: projet.name, premiere: false, espace }), {
      template: 'none',
      motif: 'configuration-marketing',
    }).catch((err) => log.error('agent marketing : le tour a échoué', err));
    return { agentId: existant.id, projectId: projet.id, cardId: espace.cardId };
  }

  const r = await reglages();
  const { card, agentId } = ouvrirCarteDAgent({
    projectId: projet.id,
    titre: titreDeLAgentMarketing(projet.name),
    description: `L’agent marketing attitré de « ${projet.name} » : il comprend le produit, règle l’atelier marketing et rédige les contenus à valider. Première demande : ${demande.slice(0, 300)}`,
    labels: [LABEL_MARKETING],
    role: 'task',
    run: { engine: 'claude', model: r.model, thinking: r.thinking as any },
  });
  marquerAgentMarketing(projet.id, agentId, card.id);

  const processus = projet.miseEnProduction?.processus;
  void sendPrompt(
    agentId,
    demandeMarketing({
      demande,
      nomProjet: projet.name,
      premiere: true,
      espace,
      destination: processus?.resume ?? null,
      consignesDeMiseEnLigne: processus?.explication ?? null,
      adressePublique: projet.vitrineLiee?.adresseProduction ?? null,
    }),
    { template: 'none', silent: true, motif: 'configuration-marketing' },
  ).catch((err) => {
    log.error('agent marketing : le premier tour a échoué', err);
    direLaPanneSurLaCarte(card.id, agentId, err?.message ?? String(err));
  });

  log.info(`marketing : agent attitré ouvert pour « ${projet.name} »`);
  return { agentId, projectId: projet.id, cardId: card.id };
}

/**
 * LE PLAN DE LA SEMAINE, le dimanche soir. Un projet après l'autre : jamais
 * dix agents lancés d'un coup sur le même compte.
 */
/** Les espaces qui reçoivent le plan du dimanche : suivi non coupé, fiche remplie, nature connue. */
export function espacesDuPlanDeLaSemaine() {
  // Un site autonome du service Statistiques n'a ni projet ni agent marketing.
  return listerEspaces().filter((e) => !estSiteAutonome(e.projectId) && e.actif && ficheRemplie(e.fiche) && e.configuration.nature);
}

export async function lancerLesPlansDeLaSemaine(lundi: string): Promise<number> {
  const espaces = espacesDuPlanDeLaSemaine();
  let lances = 0;
  for (const espace of espaces) {
    const projet = store.getProject(espace.projectId);
    if (!projet || projet.archived) continue;
    if (productionSuspendue(projet.id)) continue;
    const r = await reglages();
    const { card, agentId } = ouvrirCarteDAgent({
      projectId: projet.id,
      titre: `Plan des réseaux sociaux de la semaine — ${projet.name}`.slice(0, 80),
      description: `Chaque dimanche soir, l’agent marketing prépare la semaine du ${lundi} en brouillons à valider. Rien n’est programmé sans vous.`,
      labels: [LABEL_MARKETING],
      role: 'analysis',
      run: { engine: 'claude', model: r.model, thinking: r.thinking as any },
    });
    try {
      await sendPrompt(agentId, demandeDuPlanHebdo({ lundi }), { template: 'none', silent: true, motif: 'configuration-marketing' });
      rangerCarteDAgent(card.id, agentId, 'archived', `Plan de la semaine du ${lundi} déposé en brouillons.`);
      lances += 1;
    } catch (err: any) {
      log.warn(`marketing : plan de la semaine impossible pour « ${projet.name} »`, err);
      direLaPanneSurLaCarte(card.id, agentId, err?.message ?? String(err));
    }
  }
  if (lances) log.info(`marketing : plan de la semaine du ${lundi} préparé pour ${lances} projet(s)`);
  return lances;
}

/**
 * LA RÉORGANISATION DU JOUR. Un projet après l'autre, et SEULEMENT ceux qui ont
 * des brouillons ou des contenus « à valider » dont le jour prévu est passé :
 * un tour d'agent coûte, il ne part pas pour rien.
 */
export async function lancerLaReorganisationDuJour(maintenant = Date.now()): Promise<number> {
  const aReplacer = new Set(projetsAReorganiser(maintenant));
  const aujourdhui = jourLocalDe(maintenant);
  let lances = 0;
  for (const espace of espacesDuPlanDeLaSemaine()) {
    if (!aReplacer.has(espace.projectId)) continue;
    const projet = store.getProject(espace.projectId);
    if (!projet || projet.archived) continue;
    const r = await reglages();
    const { card, agentId } = ouvrirCarteDAgent({
      projectId: projet.id,
      titre: `Dates des réseaux sociaux réorganisées — ${projet.name}`.slice(0, 80),
      description: `Chaque jour, l’agent marketing replace les contenus en retard selon votre rythme réel. Rien n’est programmé sans vous.`,
      labels: [LABEL_MARKETING],
      role: 'analysis',
      run: { engine: 'claude', model: r.model, thinking: r.thinking as any },
    });
    try {
      await sendPrompt(agentId, demandeDeReorganisation({ aujourdhui, rythme: rythmeDuProjet(projet.id, maintenant) }), {
        template: 'none',
        silent: true,
        motif: 'configuration-marketing',
      });
      rangerCarteDAgent(card.id, agentId, 'archived', `Dates des contenus en retard replacées le ${aujourdhui}.`);
      lances += 1;
    } catch (err: any) {
      log.warn(`marketing : réorganisation impossible pour « ${projet.name} »`, err);
      direLaPanneSurLaCarte(card.id, agentId, err?.message ?? String(err));
    }
  }
  if (lances) log.info(`marketing : dates réorganisées pour ${lances} projet(s)`);
  return lances;
}

/** La phrase du geste « suite », avec le rythme réel du projet. */
export function demandeDeLaSuite(projectId: string): string {
  return demandeDuGeste('suite', rythmeDuProjet(projectId));
}

/**
 * « CRÉER » UN COMPTE SUR UN RÉSEAU (onglet Comptes) : un agent à part, sur sa
 * propre carte marketing, ouvre le compte du projet, crée l'application
 * développeur si elle manque, remplit les dossiers de validation et rend ses
 * identifiants à l'atelier (outil « marketing », action « application »). Il
 * demande à l'utilisateur, par ses questions, ce que lui seul peut fournir.
 * Une seconde demande sur le même réseau, pendant qu'un agent y travaille,
 * rouvre sa carte au lieu d'en ouvrir une autre.
 */
export async function lancerCreationDeCompte(entree: { projectId: string; reseau: unknown }): Promise<DepartMarketing> {
  const projet = store.getProject(entree.projectId);
  if (!projet) throw new Error('projet introuvable');
  if (!estReseauSocial(entree.reseau)) throw new Error('réseau inconnu');
  const reseau = entree.reseau;
  const fiche = FICHES_RESEAUX[reseau];
  const app = lireApplication(fiche.application);
  if (app.etat === 'en_creation' && app.cardId) {
    const carte = store.getCard(app.cardId);
    const agent = carte ? store.listAgents().find((a) => a.cardId === carte.id && a.role !== 'cadrage') : undefined;
    if (carte && agent && carte.column !== 'archived') return { agentId: agent.id, projectId: carte.projectId, cardId: carte.id };
  }
  assurerEspace(projet.id);
  const r = await reglages();
  const { card, agentId } = ouvrirCarteDAgent({
    projectId: projet.id,
    titre: `Ouvrir ${fiche.libelle} — ${projet.name}`.slice(0, 80),
    description: `Un agent ouvre le compte ${fiche.libelle} du projet, crée l’application développeur si elle manque et remplit les dossiers de validation. Il vous demandera les codes reçus par SMS et ce que vous seul pouvez fournir. Rien n’est publié sans vous.`,
    labels: [LABEL_MARKETING],
    role: 'task',
    run: { engine: 'claude', model: r.model, thinking: r.thinking as any },
  });
  if (app.etat === 'absente' || app.etat === 'en_creation') ecrireApplication({ application: fiche.application, etat: 'en_creation', cardId: card.id });
  /* L'écran relit l'atelier : la carte et l'application qui la porte y arrivent
     tout de suite — statut à la place de « Créer », témoin sur « Canaux ». */
  diffuser(projet.id);
  void sendPrompt(
    agentId,
    demandeDeCreationDeCompte({
      reseau,
      nomProjet: projet.name,
      adresseRetour: adresseDeRetour(),
      adresseProduit: lireEspaceMarketing(projet.id)?.configuration.adresse ?? projet.vitrineLiee?.adresseProduction ?? null,
      application: app,
    }),
    { template: 'none', motif: 'configuration-marketing' },
  ).catch((err) => {
    log.error('marketing : l’agent de création de compte n’a pas démarré', err);
    direLaPanneSurLaCarte(card.id, agentId, err?.message ?? String(err));
  });
  log.info(`marketing : agent de création ${reseau} ouvert pour « ${projet.name} »`);
  return { agentId, projectId: projet.id, cardId: card.id };
}
