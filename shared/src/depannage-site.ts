/**
 * LE DÉPANNAGE D'UN SITE QUI TOMBE ET RETOMBE — les règles pures.
 *
 * La surveillance alerte dès la PREMIÈRE chute (`texteAlerte`) et n'en dit rien
 * de plus : un site qui reste à terre attendait qu'un humain ouvre une carte.
 * Après TROIS contrôles ratés d'affilée, le démon ouvre donc lui-même une carte
 * dans le projet du site et lance son cadrage sur le récit de la panne.
 *
 * C'EST LA SEULE EXCEPTION À « RIEN NE PART SANS UN CLIC », ET ELLE S'ARRÊTE AU
 * PLAN. L'agent enquête et rend un plan ; le plan attend la validation de
 * l'utilisateur, comme tous les plans. Rien n'est corrigé, enregistré ni mis en
 * ligne sans lui.
 *
 * TROIS GARDE-FOUS, tous ici :
 *  1. TROIS ÉCHECS DE SUITE (`ECHECS_AVANT_DEPANNAGE`) — un échec isolé arrive,
 *     et ne mérite pas un tour de moteur.
 *  2. UNE SEULE CARTE PAR PANNE — l'incident ouvert est noté sur la fiche, et
 *     seul un contrôle réussi le referme.
 *  3. AU PLUS UNE CARTE TOUTES LES SIX HEURES PAR SITE
 *     (`ECART_MINIMAL_DEPANNAGE_MS`) — un site qui tombe et revient sans cesse
 *     ne fabrique pas une carte par chute.
 *
 * Le SERVEUR (`server/src/depannage-site.ts`) ouvre la carte, lance le cadrage
 * et demande le plan ; `server/src/surveillance.ts` compte et déclenche.
 */

import type { ControleSurveillance, RecetteSurveillance, SiteSurveille } from './surveillance.js';
import { LIBELLE_RAISON, phraseDePeriode, bornerPeriode, phraseDeRecetteSurveillance } from './surveillance.js';

/** Combien de contrôles ratés d'affilée avant d'ouvrir une carte. */
export const ECHECS_AVANT_DEPANNAGE = 3;

/**
 * L'écart minimal entre deux cartes de panne d'un MÊME site. Un site qui
 * clignote — il tombe, revient, retombe — ouvrirait sinon une carte par cycle.
 */
export const ECART_MINIMAL_DEPANNAGE_MS = 6 * 3_600_000;

/** L'étiquette posée sur une carte ouverte par la surveillance. */
export const LABEL_PANNE_SITE = 'panne détectée';

/* ------------------------------------------------------------------ */
/* Le compteur d'échecs                                                 */
/* ------------------------------------------------------------------ */

/**
 * Le nombre de contrôles EN PANNE depuis le plus récent, sans un seul succès
 * entre eux. Un seul contrôle réussi remet le compte à zéro : c'est la fin de
 * la panne.
 */
export function echecsDeSuiteDuSite(controles: readonly ControleSurveillance[]): number {
  const ordonnes = [...controles].sort((a, b) => b.instant - a.instant);
  let compte = 0;
  for (const controle of ordonnes) {
    if (controle.etat !== 'panne') break;
    compte += 1;
  }
  return compte;
}

/** Ce que la fiche d'un site garde de son dépannage automatique. */
export interface IncidentDuSite {
  /** Le projet rattaché à la main, ou deviné d'après l'adresse. */
  projetRattache?: string;
  /** Vrai quand le rattachement vient de l'adresse et non d'un choix humain. */
  projetDevine?: boolean;
  /** La carte ouverte pour la panne EN COURS, tant que le site n'est pas revenu. */
  incidentCardId?: string;
  /** Depuis quand cette panne est ouverte. */
  incidentDepuis?: number;
  /** Quand le dernier dépannage a été LANCÉ — posé avant le tour, jamais après. */
  incidentLanceLe?: number;
}

export type RaisonDeNePasDepanner =
  | 'pas-assez-d-echecs'
  | 'carte-deja-ouverte'
  | 'trop-recent';

export type DecisionDeDepannage =
  | { depanner: true }
  | { depanner: false; raison: RaisonDeNePasDepanner };

/**
 * CE SITE DOIT-IL OUVRIR UNE CARTE DE PANNE ? Trois refus possibles, et chacun
 * se dit : le compte n'y est pas encore, une carte est déjà ouverte pour cette
 * panne, ou la précédente est trop récente.
 *
 * Le refus « trop récent » se juge sur `incidentLanceLe`, POSÉ AVANT le tour :
 * un lancement qui échoue ne rejoue donc pas au contrôle suivant.
 */
export function decisionDeDepannage(
  site: Pick<SiteSurveille, 'etat'> & IncidentDuSite,
  echecsDeSuite: number,
  maintenant = Date.now(),
): DecisionDeDepannage {
  if (echecsDeSuite < ECHECS_AVANT_DEPANNAGE) return { depanner: false, raison: 'pas-assez-d-echecs' };
  if (site.incidentCardId) return { depanner: false, raison: 'carte-deja-ouverte' };
  const lance = Number(site.incidentLanceLe ?? 0);
  if (lance && maintenant - lance < ECART_MINIMAL_DEPANNAGE_MS) return { depanner: false, raison: 'trop-recent' };
  return { depanner: true };
}

/* ------------------------------------------------------------------ */
/* Le projet d'un site, deviné d'après son adresse                      */
/* ------------------------------------------------------------------ */

/** Le nom d'hôte d'une adresse, en minuscules, ou `null` si elle est illisible. */
export function hoteDeLAdresse(adresse: string | undefined | null): string | null {
  const brut = String(adresse ?? '').trim();
  if (!brut) return null;
  const complete = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(brut) ? brut : `https://${brut}`;
  try {
    const hote = new URL(complete).hostname.toLowerCase().replace(/\.$/, '');
    return hote || null;
  } catch {
    return null;
  }
}

/**
 * DEUX ADRESSES PARLENT-ELLES DU MÊME SITE ? Seuls le nom de domaine et ses
 * sous-domaines comptent — jamais le chemin de la page. « boutique.example.com »
 * appartient à « example.com », l'inverse n'est pas vrai, et
 * « faux-example.com » n'appartient à personne.
 *
 * Rend le degré de correspondance : 2 pour le même hôte, 1 pour un
 * sous-domaine, 0 pour rien. Un projet qui colle EXACTEMENT l'emporte sur un
 * projet qui ne colle que par son domaine parent.
 */
export function degreDeCorrespondance(hoteSite: string | null, hoteProjet: string | null): 0 | 1 | 2 {
  if (!hoteSite || !hoteProjet) return 0;
  if (hoteSite === hoteProjet) return 2;
  if (hoteSite.endsWith(`.${hoteProjet}`)) return 1;
  return 0;
}

/** Un projet et les adresses qu'il connaît, tel que le serveur les rassemble. */
export interface ProjetEtSesAdresses {
  id: string;
  nom: string;
  adresses: readonly (string | undefined)[];
}

/**
 * LE PROJET D'UN SITE, DEVINÉ D'APRÈS SON ADRESSE. Le meilleur degré l'emporte ;
 * une AMBIGUÏTÉ — deux projets au même degré — ne tranche rien, et aucune
 * correspondance non plus. Dans les deux cas : `null`, et rien n'est imposé.
 */
export function projetDevineDuSite(
  urlDuSite: string,
  projets: readonly ProjetEtSesAdresses[],
): { id: string; nom: string } | null {
  const hoteSite = hoteDeLAdresse(urlDuSite);
  if (!hoteSite) return null;
  let meilleur: 0 | 1 | 2 = 0;
  let retenus: { id: string; nom: string }[] = [];
  for (const projet of projets) {
    let degre: 0 | 1 | 2 = 0;
    for (const adresse of projet.adresses) {
      const d = degreDeCorrespondance(hoteSite, hoteDeLAdresse(adresse));
      if (d > degre) degre = d;
    }
    if (!degre) continue;
    if (degre > meilleur) {
      meilleur = degre;
      retenus = [{ id: projet.id, nom: projet.nom }];
    } else if (degre === meilleur) {
      retenus.push({ id: projet.id, nom: projet.nom });
    }
  }
  return retenus.length === 1 ? retenus[0] : null;
}

/* ------------------------------------------------------------------ */
/* La carte et sa demande                                               */
/* ------------------------------------------------------------------ */

/** Le titre de la carte ouverte pour une panne. */
export function titreDeCarteDePanne(nomDuSite: string): string {
  const nom = String(nomDuSite ?? '').replace(/\s+/g, ' ').trim() || 'un site surveillé';
  const court = nom.length > 48 ? `${nom.slice(0, 47)}…` : nom;
  return `Panne de ${court}`;
}

/** La description de la carte, lue par quelqu'un qui ne programme pas. */
export function descriptionDeCarteDePanne(site: Pick<SiteSurveille, 'nom' | 'url'>): string {
  return (
    `La surveillance a raté ${ECHECS_AVANT_DEPANNAGE} contrôles d’affilée sur ${site.nom} (${site.url}). ` +
    'Un agent enquête sur la panne et propose un plan de correction, qui attend votre accord : ' +
    'rien n’est corrigé ni mis en ligne sans vous.'
  );
}

/** L'heure d'un instant, telle qu'elle se lit dans le récit de la panne. */
function heure(instant: number): string {
  if (!instant) return 'heure inconnue';
  return new Date(instant).toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
}

/** Une ligne de contrôle, telle qu'elle se lit dans le récit de la panne. */
function ligneDeControle(controle: ControleSurveillance): string {
  const etat = controle.etat === 'ok' ? 'en ligne' : `en panne — ${controle.raison ? LIBELLE_RAISON[controle.raison] : 'injoignable'}`;
  const code = controle.code ? `, code ${controle.code}` : '';
  const etape = controle.etape ? `, étape « ${controle.etape} »` : '';
  const detail = controle.detail ? `, ${controle.detail}` : '';
  return `- ${heure(controle.instant)} : ${etat}${code}${etape}${detail} (${controle.dureeMs} ms)`;
}

/**
 * LA DEMANDE ENVOYÉE À L'AGENT DE CADRAGE. Elle dit tout ce que la surveillance
 * sait de la panne — l'adresse, l'heure de la chute, les derniers contrôles,
 * l'étape qui échoue, le code et le message renvoyés, et la recette de contrôle
 * SANS aucun secret (elle ne porte que des références au coffre-fort).
 *
 * Elle exige l'ENQUÊTE puis le PLAN, et interdit `ask_user` : personne n'attend
 * devant l'écran au moment où un site tombe.
 */
export function demandeDePanne(entree: {
  site: SiteSurveille;
  /** Le projet où la carte s'est ouverte, et comment il a été choisi. */
  projet: { nom: string; chemin: string; rattache: boolean; devine: boolean } | null;
  /** Les derniers contrôles, du plus récent au plus ancien. */
  controles: readonly ControleSurveillance[];
  echecsDeSuite: number;
}): string {
  const { site, projet } = entree;
  const recette: RecetteSurveillance = site.recette ?? { type: 'appel' };
  const derniers = [...entree.controles].sort((a, b) => b.instant - a.instant).slice(0, ECHECS_AVANT_DEPANNAGE + 1);
  const lignes: string[] = [
    `CETTE CARTE A ÉTÉ OUVERTE PAR LA SURVEILLANCE, pas par une personne au clavier : ${site.nom} a raté ${entree.echecsDeSuite} contrôles d’affilée.`,
    '',
    'CE QUE LA SURVEILLANCE SAIT DE LA PANNE',
    `- site : ${site.nom}`,
    `- adresse : ${site.url}`,
    `- tombé depuis : ${heure(site.depuis)}`,
    `- dernier contrôle : ${heure(site.verifieLe)}`,
    `- verdict : ${site.raison ? LIBELLE_RAISON[site.raison] : 'injoignable'}${site.code ? ` (code ${site.code})` : ''}`,
    ...(site.etapeEchouee ? [`- étape qui échoue : ${site.etapeEchouee}`] : []),
    `- rythme des contrôles : ${phraseDePeriode(bornerPeriode(site.periodeMs))}`,
    '',
    `RECETTE DE CONTRÔLE REJOUÉE À CHAQUE PASSAGE (${recette.type}, aucun secret : les accès sont des références au coffre-fort)`,
    phraseDeRecetteSurveillance(recette),
    '',
    'LES DERNIERS CONTRÔLES, DU PLUS RÉCENT AU PLUS ANCIEN',
    ...derniers.map(ligneDeControle),
    '',
  ];
  if (projet) {
    lignes.push(
      `LE PROJET DE CE SITE : ${projet.nom} (${projet.chemin})`,
      projet.devine
        ? 'Il a été DEVINÉ d’après l’adresse du site : vérifie que c’est bien le bon dépôt avant de conclure, et dis-le si ce n’en est pas un.'
        : projet.rattache
          ? 'Il a été rattaché à la main sur la fiche du site : c’est le bon dépôt.'
          : 'Aucun projet n’est rattaché à ce site et aucun n’a pu être deviné d’après son adresse : cette carte s’est ouverte sur le tableau de Beluga Build, faute de mieux. Dis-le en toutes lettres, et cherche d’abord OÙ vit ce site.',
      '',
    );
  }
  lignes.push(
    'CE QUE TU FAIS MAINTENANT',
    '1. ENQUÊTE POUR DE VRAI. Rappelle le site toi-même, lis les journaux du service et du reverse-proxy, regarde ce qui a été mis en ligne juste avant la chute, cherche la dernière cause plausible. Ce que tu n’as pas vu se dit comme une hypothèse, en toutes lettres.',
    '2. RENDS CE QUE TU AS COMPRIS avec « rendre_comprehension » : la panne constatée, sa cause probable, et ce qui reste incertain.',
    '3. LE PLAN DE CORRECTION TE SERA DEMANDÉ JUSTE APRÈS, dans un second tour : garde ton enquête pour l’écrire. Le plan attend ensuite la validation de l’utilisateur — tu ne corriges rien, tu n’enregistres rien et tu ne mets rien en ligne.',
    '',
    'NE POSE AUCUNE QUESTION AVEC « ask_user » : un site tombe sans prévenir, et personne n’est devant l’écran. Ce qui manque se tranche, et tu annonces ton choix en disant « je suppose » là où tu supposes.',
    '',
    'NE TOUCHE À AUCUN FICHIER pendant ce tour : ton travail est de comprendre puis de proposer. La correction, si elle est validée, sera lancée comme n’importe quelle autre tâche.',
  );
  return lignes.join('\n');
}

/**
 * LA NOTE POSÉE SUR UNE CARTE RÉUTILISÉE. La carte de la panne précédente n'est
 * pas encore rangée : on ne double pas les cartes, on lui dit que le site est
 * retombé.
 */
export function noteDeNouvelleChute(site: Pick<SiteSurveille, 'nom'>, maintenant = Date.now()): string {
  return (
    `${site.nom} est retombé (${heure(maintenant)}) après ${ECHECS_AVANT_DEPANNAGE} contrôles ratés d’affilée. ` +
    'Cette carte n’étant pas encore rangée, la surveillance n’en a pas ouvert une seconde : reprends l’enquête ici.'
  );
}
