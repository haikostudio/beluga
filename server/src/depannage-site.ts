/**
 * LE DÉPANNAGE D'UN SITE QUI TOMBE ET RETOMBE — le travail réel.
 *
 * Après trois contrôles ratés d'affilée (`shared/src/depannage-site.ts`), la
 * surveillance ouvre elle-même une carte dans LE PROJET DU SITE et lance son
 * cadrage sur le récit de la panne. L'agent enquête, rend sa compréhension,
 * puis le plan lui est demandé — et le plan ATTEND la validation de
 * l'utilisateur, comme tous les plans.
 *
 * C'EST LA SEULE EXCEPTION À « RIEN NE PART SANS UN CLIC », ET ELLE S'ARRÊTE AU
 * PLAN : aucune correction, aucun enregistrement, aucune mise en ligne.
 *
 * LA CARTE SUIT LE CHEMIN D'UNE CARTE OUVERTE À LA MAIN : `createCard` dans
 * « Demande », puis `ouvrirLeCadrage` et un premier tour — jamais
 * `ouvrirCarteDAgent`, qui pose une carte d'agent du démon directement en
 * « En cours », sans branche et sans parcours de cadrage.
 *
 * LE PROJET DU SITE NE SE CONFOND PAS AVEC CELUI DE SON AGENT DE
 * CONFIGURATION : `SiteSurveille.projectId` désigne l'endroit où vit la
 * conversation de l'agent de surveillance (presque toujours Beluga Build),
 * `projetRattache` désigne le dépôt qui sert le site.
 */

import {
  LABEL_PANNE_SITE,
  type ProjetEtSesAdresses,
  type SiteSurveille,
  decisionDeDepannage,
  demandeDePanne,
  descriptionDeCarteDePanne,
  echecsDeSuiteDuSite,
  noteDeNouvelleChute,
  projetDevineDuSite,
  titreDeCarteDePanne,
} from '@beluga/shared';
import * as store from './store.js';
import { bus } from './bus.js';
import { log } from './logger.js';
import { jugerLUrgenceEnFond } from './juge-des-cartes.js';
import { ouvrirLeCadrage } from './cadrage.js';
import { sendPrompt } from './runtime.js';
import {
  ecrireProjetDevine,
  lireSurveillance,
  listerControles,
  marquerIncidentDuSite,
} from './surveillance.js';

/* ------------------------------------------------------------------ */
/* Le projet d'un site                                                  */
/* ------------------------------------------------------------------ */

/**
 * TOUTES LES ADRESSES QU'UN PROJET CONNAÎT : son instance de développement,
 * l'adresse publique de sa mise en production, celles de sa vitrine liée, et la
 * même chose pour chacun de ses dépôts annexes. C'est à ces adresses qu'on
 * compare celle d'un site tombé.
 */
function adressesDuProjet(projet: ReturnType<typeof store.listProjects>[number]): string[] {
  const adresses = [
    projet.devUrl,
    projet.vitrineLiee?.adresseProduction,
    projet.vitrineLiee?.adresseEssai,
    projet.vitrineLiee?.adresseConstructeur,
    ...(projet.depots ?? []).flatMap((depot) => [depot.devUrl]),
  ];
  return adresses.filter((a): a is string => typeof a === 'string' && a.trim().length > 0);
}

/** Les projets vivants et leurs adresses, tels que la règle pure les attend. */
export function projetsEtLeursAdresses(): ProjetEtSesAdresses[] {
  return store
    .listProjects()
    .map((projet) => ({ id: projet.id, nom: projet.name, adresses: adressesDuProjet(projet) }));
}

/**
 * DEVINE LE PROJET D'UN SITE ET L'ÉCRIT SUR SA FICHE, quand rien n'y est
 * rattaché. Un choix fait à la main n'est JAMAIS écrasé : il porte
 * `projet_devine = 0` et garde son projet.
 *
 * Rejouable sans effet de bord : la même adresse redonne le même projet, et un
 * projet supprimé entre-temps est simplement oublié.
 */
export function devinerLeProjetDuSite(site: SiteSurveille): { id: string; nom: string } | null {
  if (site.projetRattache && !site.projetDevine && store.getProject(site.projetRattache)) return null;
  const devine = projetDevineDuSite(site.url, projetsEtLeursAdresses());
  const actuel = site.projetRattache ?? null;
  if ((devine?.id ?? null) === actuel) return devine;
  ecrireProjetDevine(site.id, devine?.id ?? null);
  if (devine) log.info(`surveillance : « ${site.nom} » rattaché à ${devine.nom} d’après son adresse`);
  return devine;
}

/**
 * LES SITES DÉJÀ SURVEILLÉS REÇOIVENT LEUR PROJET, UNE FOIS, AU DÉMARRAGE.
 * Sans cela, une panne survenue avant le premier passage de rattachement
 * ouvrirait sa carte chez Beluga Build faute de mieux.
 */
export function rattraperLesProjetsDesSites(sites: readonly SiteSurveille[]): number {
  let rattaches = 0;
  for (const site of sites) {
    try {
      if (devinerLeProjetDuSite(site)) rattaches += 1;
    } catch (err: any) {
      log.warn(`surveillance : rattachement de « ${site.nom} » impossible`, err?.message ?? err);
    }
  }
  return rattaches;
}

/* ------------------------------------------------------------------ */
/* La carte de la panne                                                 */
/* ------------------------------------------------------------------ */

/** Les colonnes d'où une carte de panne se REPREND au lieu d'en ouvrir une autre. */
const COLONNES_NON_RANGEES = ['planned', 'running'] as const;

/**
 * Où la carte s'ouvre : le projet RATTACHÉ au site, sinon Beluga Build
 * lui-même — le seul tableau qui ne dépend d'aucun client —, sinon le premier
 * projet ouvert. Dit aussi COMMENT le projet a été choisi, pour que l'agent le
 * sache et que le journal le note.
 */
function projetDAccueil(site: SiteSurveille): {
  projet: { id: string; name: string; path: string };
  rattache: boolean;
  devine: boolean;
} | null {
  const projets = store.listProjects();
  const vise = site.projetRattache ? projets.find((p) => p.id === site.projetRattache) : undefined;
  const retenu = vise ?? projets.find((p) => p.isSelf) ?? projets[0];
  if (!retenu) return null;
  return {
    projet: { id: retenu.id, name: retenu.name, path: retenu.path },
    rattache: Boolean(vise),
    devine: Boolean(vise && site.projetDevine),
  };
}

/** Pose une note dans le fil d'une carte, sans consommer le moindre jeton. */
function noterDansLeFil(agentId: string, texte: string): void {
  const message = store.saveMessage({
    id: store.newId(),
    agentId,
    role: 'system',
    content: texte,
    createdAt: store.now(),
  } as any);
  bus.emit({ type: 'message.upsert', message });
}

export interface DepannageLance {
  cardId: string;
  agentId: string;
  projectId: string;
  /** Vrai quand la carte de la panne précédente a été reprise. */
  reprise: boolean;
}

/**
 * OUVRE LE DÉPANNAGE D'UN SITE. Appelé par la tournée de surveillance, HORS de
 * sa boucle parallèle, exactement comme l'alerte de chute.
 *
 * Rend `null` quand rien n'est à faire — pas assez d'échecs, carte déjà
 * ouverte, dépannage trop récent — et dit pourquoi dans le journal.
 *
 * DEUX TOURS, ET LE SECOND N'EST PAS UNE OPTION : le premier fait l'enquête et
 * rend la compréhension, le second demande le plan par le chemin ordinaire
 * (`demanderLePlan`). Et TOUT S'ARRÊTE LÀ : ce chemin n'appelle JAMAIS
 * `validerLaComprehension`, le seul geste qui lance un travail. Une panne
 * ouvre une enquête et un plan à lire, jamais une dépense d'exécution — c'est
 * l'utilisateur qui valide et lance, d'un clic, au réveil.
 */
export async function ouvrirLeDepannage(siteId: string, maintenant = Date.now()): Promise<DepannageLance | null> {
  const site = lireSurveillance(siteId);
  if (!site) return null;

  const controles = listerControles(site.id, maintenant);
  const echecs = echecsDeSuiteDuSite(controles);
  const decision = decisionDeDepannage(site, echecs, maintenant);
  if (!decision.depanner) {
    if (decision.raison !== 'pas-assez-d-echecs')
      log.info(`dépannage : « ${site.nom} » laissé de côté (${decision.raison})`);
    return null;
  }

  const accueil = projetDAccueil(site);
  if (!accueil) {
    log.warn('dépannage : aucun projet ouvert, la carte de panne n’a nulle part où vivre');
    return null;
  }

  /*
   * LA CARTE DE LA PANNE PRÉCÉDENTE N'EST PEUT-ÊTRE PAS RANGÉE. On ne double
   * pas les cartes : on reprend celle-là et on lui dit que le site est retombé.
   */
  const ancienne = site.incidentCardId ? store.getCard(site.incidentCardId) : null;
  if (ancienne && (COLONNES_NON_RANGEES as readonly string[]).includes(ancienne.column)) {
    const agent = store.getLastAgentByCard(ancienne.id);
    marquerIncidentDuSite(site.id, ancienne.id, maintenant);
    if (agent) noterDansLeFil(agent.id, noteDeNouvelleChute(site, maintenant));
    log.info(`dépannage : « ${site.nom} » est retombé, la carte « ${ancienne.title} » est reprise`);
    return { cardId: ancienne.id, agentId: agent?.id ?? '', projectId: ancienne.projectId, reprise: true };
  }

  const { createCard } = await import('./tools.js');
  const card = createCard(accueil.projet.id, {
    title: titreDeCarteDePanne(site.nom),
    description: descriptionDeCarteDePanne(site),
    labels: [LABEL_PANNE_SITE],
    origin: 'agent',
    // La carte naît avec sa demande, qui nomme la surveillance (MEM-3555).
    auteur: 'depannage',
    // Une carte qui ouvre un cadrage n'annonce AUCUN départ (`createCard`).
    cadrage: true,
  });
  bus.emit({ type: 'card.upsert', card });
  /*
   * CETTE PANNE PRESSE-T-ELLE ? Un avis pour ORDONNER ce qui attend : l'enquête
   * s'ouvre exactement comme avant, avec ou sans lui
   * (`server/src/juge-des-cartes.ts`). Sans Laya installé : rien.
   */
  jugerLUrgenceEnFond(card.id, 'panne-de-site');
  // LA DATE DE LANCEMENT EST POSÉE AVANT LE TOUR : un tour qui tombe ne relance
  // pas un agent à chaque contrôle.
  marquerIncidentDuSite(site.id, card.id, maintenant);
  log.warn(
    `dépannage : ${echecs} contrôles ratés sur « ${site.nom} » — carte ouverte dans ${accueil.projet.name}` +
      ` (${accueil.devine ? 'projet deviné d’après l’adresse' : accueil.rattache ? 'projet rattaché à la main' : 'aucun projet rattaché'})`,
  );

  const cadrage = await ouvrirLeCadrage(card.id);
  if (!cadrage) {
    log.error(`dépannage : aucun agent de cadrage pour « ${card.title} »`);
    return null;
  }

  const demande = demandeDePanne({
    site,
    projet: { nom: accueil.projet.name, chemin: accueil.projet.path, rattache: accueil.rattache, devine: accueil.devine },
    controles,
    echecsDeSuite: echecs,
  });

  // L'OUVERTURE DE LA CARTE EST UNE DÉCISION À PRENDRE : la cloche et le
  // triangle du projet s'allument, comme pour toute carte qui attend quelqu'un.
  bus.emit({ type: 'attention', ...store.signalAttention() });

  /*
   * LE TOUR PART SANS RETENIR LA TOURNÉE : il dure des minutes. La demande du
   * plan suit le tour d'enquête, par le chemin ordinaire — celui du bouton.
   * `silent` : le récit de la panne se lit dans le tiroir du prompt envoyé,
   * comme tout appel interne ; `template: 'none'` : un cadrage ne rend pas un
   * compte rendu à titres.
   */
  void sendPrompt(cadrage.id, demande, { template: 'none', silent: true })
    .then(async () => {
      const { demanderLePlan } = await import('./ws.js');
      await demanderLePlan(card.id);
    })
    .catch((err) => {
      log.error(`dépannage : l’enquête sur « ${site.nom} » a échoué`, err);
    });

  return { cardId: card.id, agentId: cadrage.id, projectId: accueil.projet.id, reprise: false };
}
