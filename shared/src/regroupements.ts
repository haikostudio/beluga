/**
 * LES PROJETS RÉUNIS — les règles pures, sans base ni disque.
 *
 * UN REGROUPEMENT réunit plusieurs projets sous un nom commun, pour les faire
 * travailler depuis UN SEUL TABLEAU, sans rien fusionner sur le disque :
 * chaque projet membre garde son dossier, son dépôt, ses branches, ses
 * réglages et sa façon de se mettre en ligne.
 *
 *  - Le regroupement est lui-même un `Project` (`regroupement: true`) : il a
 *    son tableau, ses cartes, son cadrage — le TABLEAU COMMUN. Il n'a ni dépôt
 *    ni publication : son dossier n'est qu'un dossier de rangement.
 *  - Chaque membre porte `regroupementId`. C'est LA source de vérité : un
 *    projet ne peut donc appartenir qu'à un seul regroupement.
 *  - Une carte du tableau commun est une CARTE MÈRE. Elle se cadre comme une
 *    autre, et son cadrage dit quels projets elle touche (`projetsTouches`).
 *    À son lancement, elle ne lance AUCUN agent : elle pose une CARTE FILLE
 *    dans chaque projet touché, qui travaille dans SON dépôt, sur SA branche,
 *    et se publie avec SON projet. Il n'y a jamais de branche commune entre
 *    des dépôts séparés.
 *  - La mère suit ses filles, et se range une fois qu'aucune ne travaille plus.
 *
 * Ce mécanisme REMPLACE les « dépôts annexes » (`Project.depots`,
 * `depots-du-projet.ts`), qui ouvraient la MÊME branche dans tous les dépôts
 * d'un projet : un projet qui en porte encore est converti en regroupement
 * (`planDeConversionDesDepots`).
 */

import type { ColumnKey } from './columns.js';
import type { Agent, Card, DepotAnnexe, Project, SuiviDUneFille } from './models.js';

/** Le sous-dossier des données où vit le dossier de rangement de chaque regroupement. */
export const DOSSIER_DES_REGROUPEMENTS = 'regroupements';

/** Ce qu'une règle a besoin de savoir d'un projet. */
type ProjetLu = Pick<Project, 'id' | 'name' | 'archived' | 'isSelf'> & {
  regroupement?: boolean;
  regroupementId?: string;
};

/** Ce projet est-il un regroupement (un tableau commun) ? */
export function estUnRegroupement(projet: { regroupement?: boolean } | null | undefined): boolean {
  return projet?.regroupement === true;
}

/**
 * LES PROJETS QUI ONT UN VRAI DÉPÔT — tous, sauf les regroupements. C'est ce
 * que parcourent les tâches de fond qui touchent au disque, à git ou à la
 * publication : un regroupement n'a rien à sauvegarder, publier ni analyser.
 */
export function sansRegroupements<T extends { regroupement?: boolean }>(projets: readonly T[]): T[] {
  return projets.filter((p) => !estUnRegroupement(p));
}

/** Les membres d'un regroupement, dans l'ordre reçu. Un membre mis de côté reste membre. */
export function membresDuRegroupement<T extends { regroupementId?: string }>(
  projets: readonly T[],
  regroupementId: string,
): T[] {
  return projets.filter((p) => p.regroupementId === regroupementId);
}

/** Le plus petit nombre de projets qu'on réunit. */
export const MEMBRES_MIN = 2;

/**
 * PEUT-ON RÉUNIR CES PROJETS ? Rend la raison du refus, en phrase simple, ou
 * `null`. `regroupementId` : le regroupement qu'on complète, absent à la
 * création — ses propres membres ne comptent alors pas comme « déjà pris ».
 */
export function refusDeRegroupement(
  demande: { nom?: string; membres: readonly string[]; regroupementId?: string },
  projets: readonly ProjetLu[],
): string | null {
  if (demande.nom !== undefined && !demande.nom.trim()) return 'Donnez un nom au projet réuni.';
  const ids = [...new Set(demande.membres)];
  if (ids.length !== demande.membres.length) return 'Un même projet est coché deux fois.';
  for (const id of ids) {
    const projet = projets.find((p) => p.id === id);
    if (!projet) return 'Un des projets cochés n’existe plus.';
    if (estUnRegroupement(projet)) return `« ${projet.name} » réunit déjà des projets : il ne peut pas entrer dans un autre.`;
    if (projet.isSelf) return 'L’espace de développement de l’application ne se réunit pas à d’autres projets.';
    if (projet.archived) return `« ${projet.name} » est mis de côté : remettez-le en service d’abord.`;
    if (projet.regroupementId && projet.regroupementId !== demande.regroupementId) {
      const autre = projets.find((p) => p.id === projet.regroupementId);
      return `« ${projet.name} » fait déjà partie de « ${autre?.name ?? 'un autre regroupement'} ».`;
    }
  }
  const deja = demande.regroupementId ? membresDuRegroupement(projets, demande.regroupementId).length : 0;
  if (deja + ids.filter((id) => !projets.find((p) => p.id === id)?.regroupementId).length < MEMBRES_MIN) {
    return 'Cochez au moins deux projets à réunir.';
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Les projets touchés par une carte mère                              */
/* ------------------------------------------------------------------ */

const normal = (texte: string) =>
  texte
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

/**
 * LES PROJETS QU'UNE CARTE MÈRE TOUCHE, retrouvés parmi les membres.
 *
 * Le cadrage les nomme — par identifiant ou par nom, peu importe la casse et
 * les accents. Ce qui ne désigne aucun membre est rendu à part, pour que le
 * refus le dise en toutes lettres plutôt que de lancer à moitié.
 */
export function projetsTouchesParLaCarte<T extends { id: string; name: string }>(
  touches: readonly string[] | undefined,
  membres: readonly T[],
): { projets: T[]; inconnus: string[] } {
  const projets: T[] = [];
  const inconnus: string[] = [];
  for (const brut of touches ?? []) {
    const cle = normal(brut);
    if (!cle) continue;
    const trouve = membres.find((m) => m.id === brut || normal(m.name) === cle);
    if (!trouve) inconnus.push(brut);
    else if (!projets.includes(trouve)) projets.push(trouve);
  }
  return { projets, inconnus };
}

/** Pourquoi une carte mère ne peut pas partir, ou `null`. */
export function refusDeLancementDeLaMere(
  touches: readonly string[] | undefined,
  membres: readonly { id: string; name: string; archived?: boolean }[],
): string | null {
  if (!membres.length) return 'Ce projet réuni n’a plus aucun projet membre.';
  const { projets, inconnus } = projetsTouchesParLaCarte(touches, membres);
  if (inconnus.length) {
    return `La compréhension nomme des projets qui ne font pas partie du regroupement : ${inconnus.join(', ')}.`;
  }
  if (!projets.length) {
    return 'La compréhension ne dit pas quels projets sont touchés : redemandez-la avant de lancer.';
  }
  const archive = projets.find((p) => p.archived);
  if (archive) return `« ${archive.name} » est mis de côté : remettez-le en service avant de lancer.`;
  return null;
}

/* ------------------------------------------------------------------ */
/* Le suivi d'une carte mère                                            */
/* ------------------------------------------------------------------ */

/** Une fille, telle que la mère la suit. */
export interface EtatDUneFille {
  column: ColumnKey | string;
}

/** Les colonnes d'une fille qui travaille encore, ou attend de travailler. */
const COLONNES_EN_ROUTE: readonly string[] = ['planned', 'running'];

/**
 * OÙ RANGER LA MÈRE, D'APRÈS SES FILLES.
 *
 * Tant qu'une fille est en route (« Demande » ou « Travail »), la mère reste en
 * « Travail ». Quand toutes ont rendu (« À déployer » ou « Archivé »), elle
 * est RANGÉE dans « Archivé » : elle n'a aucun code à elle, donc rien à
 * publier — chaque fille se publie avec son propre projet. `null` : rien à
 * changer (aucune fille connue).
 */
export function colonneDeLaMere(filles: readonly EtatDUneFille[]): ColumnKey | null {
  if (!filles.length) return null;
  return filles.some((f) => COLONNES_EN_ROUTE.includes(f.column)) ? 'running' : 'archived';
}

/** « A », « A et B », « A, B et C ». */
function enumeration(noms: readonly string[]): string {
  if (noms.length < 2) return noms.join('');
  return `${noms.slice(0, -1).join(', ')} et ${noms[noms.length - 1]}`;
}

/**
 * LA PHRASE POSÉE SUR UNE MÈRE RANGÉE : ce qui a été fait, projet par projet.
 *
 * Elle ne parle JAMAIS de déploiement : la mère n'a aucun code à elle, et c'est
 * depuis chaque fille, dans son propre projet, que le travail se met en ligne.
 * « Prêt à déployer dans … » faisait lire, sur un tableau commun où il n'y a
 * rien à publier, un geste qui restait à faire.
 */
export function phraseDeLaMere(filles: readonly { projet: string; sansCode?: boolean }[]): string {
  const faites = filles.filter((f) => !f.sansCode).map((f) => f.projet);
  const sansCode = filles.filter((f) => f.sansCode).map((f) => f.projet);
  const morceaux: string[] = [];
  if (faites.length) morceaux.push(`${PHRASES_DE_LA_MERE[0]}${enumeration(faites)}`);
  if (sansCode.length) {
    morceaux.push(faites.length ? `terminé sans modification dans ${enumeration(sansCode)}` : `${PHRASES_DE_LA_MERE[1]}${enumeration(sansCode)}`);
  }
  return `${morceaux.join(' ; ')}.`;
}

/**
 * LE DÉBUT DE CHAQUE PHRASE DE MÈRE — le dernier est celui des mères rangées
 * avant la réécriture, gardé pour que leur mention reste un travail acquis
 * (`natureDeLaMention`, `shared/src/suivi-colonne.ts`) si le rafraîchissement
 * du démarrage ne l'a pas encore remplacée.
 */
const PHRASES_DE_LA_MERE = ['Travail fait dans ', 'Terminé sans modification dans ', 'Travail réparti sur '] as const;

/** Cette phrase de carte est-elle celle d'une mère rangée ? Alors c'est un travail acquis, pas une alerte. */
export function estUnePhraseDeMere(phrase: string): boolean {
  return PHRASES_DE_LA_MERE.some((debut) => phrase.startsWith(debut));
}

/* ------------------------------------------------------------------ */
/* Le suivi des filles depuis la mère                                   */
/* ------------------------------------------------------------------ */

/** Ce que la mère lit d'une fille : sa carte, et l'agent de tâche qui la tient. */
export interface FilleLue {
  carte: Pick<Card, 'id' | 'projectId' | 'column' | 'sansModification' | 'doneAt' | 'codeDejaEnregistre'> & {
    estimate?: { clientExplanation?: string; summary?: string } | null;
    scheduling?: { waitingReason?: string } | null;
  };
  agent?: Pick<Agent, 'status' | 'attendReponse' | 'etapeEnCours' | 'todos'> | null;
  projet: string;
}

/** Les colonnes d'une fille qui a rendu son travail. */
const COLONNES_RENDUES: readonly string[] = ['done', 'to_deploy', 'archived'];

/** Un texte court : le résumé est réécrit sur la mère à chaque mouvement. */
function court(texte: string | undefined, max = 280): string | undefined {
  const net = texte?.trim().replace(/\s+/g, ' ');
  if (!net) return undefined;
  return net.length > max ? `${net.slice(0, max - 1).trimEnd()}…` : net;
}

/**
 * OÙ EN EST UNE FILLE, vu depuis sa mère.
 *
 *  - rendue (« Terminé », « À déployer », « Archivé ») : FAIT, avec son compte
 *    rendu court — l'explication simple du chiffrage, sinon la phrase de sa carte ;
 *  - un agent arrêté sur sa question : QUESTION — il n'est en travail pour
 *    personne, et la mère ne doit pas le dire « au travail » ;
 *  - « En cours » avec un agent tombé : PANNE, à reprendre depuis la fille ;
 *  - « En cours » sinon : TRAVAIL, avec la ligne de tâche en cours ;
 *  - « Planifié » : ATTENTE, avec la raison écrite sur la fille (quota, file).
 */
export function etatDeLaFille({ carte, agent, projet }: FilleLue): SuiviDUneFille {
  const base = { projectId: carte.projectId, cardId: carte.id, projet, colonne: carte.column };
  const avancement = agent?.todos?.total ? { faites: agent.todos.done, total: agent.todos.total } : {};
  if (COLONNES_RENDUES.includes(carte.column)) {
    const sansCode = !carte.codeDejaEnregistre && !!carte.sansModification;
    return {
      ...base,
      etat: 'fait',
      ...avancement,
      compteRendu: court(carte.estimate?.clientExplanation || carte.estimate?.summary || carte.sansModification),
      ...(sansCode ? { sansCode } : {}),
      ...(carte.doneAt ? { doneAt: carte.doneAt } : {}),
    };
  }
  if (agent?.attendReponse) return { ...base, etat: 'question', ...avancement };
  if (carte.column === 'running') {
    if (agent?.status === 'failed') return { ...base, etat: 'panne', ...avancement, geste: court(carte.sansModification) };
    return { ...base, etat: 'travail', ...avancement, geste: court(agent?.etapeEnCours) };
  }
  return { ...base, etat: 'attente', geste: court(carte.scheduling?.waitingReason) };
}

/** Deux relevés disent-ils la même chose ? La mère ne se réécrit que s'ils diffèrent. */
export function memeSuiviDesFilles(
  a: readonly SuiviDUneFille[] | undefined,
  b: readonly SuiviDUneFille[] | undefined,
): boolean {
  return JSON.stringify(a ?? []) === JSON.stringify(b ?? []);
}

/** L'état des points « Travail » et « Rapport » d'une mère, lu sur ses filles. */
export function etatsDesPointsDeLaMere(suivi: readonly SuiviDUneFille[]): {
  travail: 'encours' | 'fait' | 'question' | 'erreur';
  rapport: 'avenir' | 'fait';
} {
  const travail = suivi.some((f) => f.etat === 'panne')
    ? 'erreur'
    : suivi.some((f) => f.etat === 'question')
      ? 'question'
      : suivi.some((f) => f.etat === 'travail' || f.etat === 'attente')
        ? 'encours'
        : 'fait';
  /* Le rapport ne se coche qu'une fois TOUTES les filles rendues : les comptes
     rendus déjà arrivés se lisent dessous, sans annoncer la fin trop tôt. */
  return { travail, rapport: travail === 'fait' ? 'fait' : 'avenir' };
}

/**
 * CE QUI TOURNE SOUS UNE MÈRE, lu sur son SEUL relevé (`card.suiviDesFilles`).
 *
 * La mère ne lance aucun agent : sans cette lecture, sa carte au tableau disait
 * « Aucun agent ne travaille » pendant que ses filles travaillaient dans leurs
 * projets. Le relevé porté par la mère fait foi — la fille vit souvent dans un
 * projet déchargé de l'écran, ses agents et sa carte n'y sont pas.
 *
 * Les étapes additionnent les listes de tâches de TOUTES les filles qui en
 * annoncent une, terminées comprises : c'est l'avancement du travail commun.
 */
export interface ActiviteDeLaMere {
  enTravail: number;
  enQuestion: number;
  enPanne: number;
  enAttente: number;
  faites: number;
  total: number;
}

export function activiteDeLaMere(suivi: readonly SuiviDUneFille[] | null | undefined): ActiviteDeLaMere {
  const activite: ActiviteDeLaMere = { enTravail: 0, enQuestion: 0, enPanne: 0, enAttente: 0, faites: 0, total: 0 };
  for (const fille of suivi ?? []) {
    if (fille.etat === 'travail') activite.enTravail += 1;
    else if (fille.etat === 'question') activite.enQuestion += 1;
    else if (fille.etat === 'panne') activite.enPanne += 1;
    else if (fille.etat === 'attente') activite.enAttente += 1;
    if (fille.total && fille.total > 0) {
      activite.total += fille.total;
      activite.faites += Math.min(fille.faites ?? 0, fille.total);
    }
  }
  return activite;
}

/** Le nom de l'état d'une fille, tel que sa mère le montre — traduit à l'affichage. */
export const LIBELLES_DE_LA_FILLE: Record<SuiviDUneFille['etat'], string> = {
  attente: 'en attente',
  travail: 'au travail',
  question: 'question en attente',
  panne: 'arrêtée',
  fait: 'terminé',
};

/** Les phrases des points d'une mère — traduites comme les autres (`shared/src/traductions.ts`). */
export const PHRASES_DU_SUIVI = {
  travail: {
    encours: 'Chaque projet touché travaille sur sa propre tâche.',
    fait: 'Chaque projet touché a fini sa tâche.',
    question: 'Une tâche d’un projet touché attend votre réponse.',
    erreur: 'Une tâche d’un projet touché s’est arrêtée : ouvrez-la pour la reprendre.',
  },
  rapport: {
    avenir: 'Chaque tâche rendra son compte rendu en finissant.',
    fait: 'Le compte rendu de chaque tâche terminée.',
  },
} as const;

/**
 * LA CONSIGNE POSÉE EN TÊTE DE CHAQUE FILLE : elle ne travaille QUE sur son
 * projet. La compréhension recopiée parle de tout le regroupement — la fille
 * doit savoir que les autres projets ont chacun leur propre carte.
 */
export function consigneDeLaFille(
  projet: { name: string; path: string },
  mere: { title: string },
  autres: readonly string[],
): string {
  return [
    `CETTE CARTE EST LA PART DU PROJET « ${projet.name} » d’une demande faite sur un projet réuni (carte « ${mere.title} »).`,
    `Tu ne travailles QUE dans le dépôt de ce projet (${projet.path}), sur ta propre branche.`,
    autres.length
      ? `Les autres projets touchés (${autres.join(', ')}) reçoivent chacun leur propre carte : n’y touche pas.`
      : 'Aucun autre projet n’est touché par cette demande.',
    'La compréhension qui suit porte sur l’ensemble : n’en fais que ce qui concerne ce projet.',
  ].join(' ');
}

/* ------------------------------------------------------------------ */
/* La conversion des anciens dépôts annexes                             */
/* ------------------------------------------------------------------ */

/** Ce que la conversion d'un projet à dépôts annexes va faire, sans rien écrire. */
export interface PlanDeConversion {
  /** Le projet à dépôts annexes, qui devient le premier membre. */
  principal: string;
  /** Le nom du regroupement créé. */
  nomDuRegroupement: string;
  /** Un membre par dépôt annexe : un projet existant remis en service, ou un projet à créer. */
  annexes: {
    depot: DepotAnnexe;
    /** Le projet qui a déjà ce dossier (souvent mis de côté par une réunion antérieure). */
    existant?: string;
    /** Le nom du projet membre. */
    nom: string;
  }[];
}

/**
 * CE QUE DEVIENT UN PROJET QUI PORTE ENCORE DES DÉPÔTS ANNEXES.
 *
 * Chaque dépôt annexe devient (ou redevient) un projet à part entière, avec
 * ses réglages de publication recopiés. Un projet qui a déjà ce dossier est
 * REPRIS, jamais doublé. `null` : rien à convertir.
 */
export function planDeConversionDesDepots(
  projet: Pick<Project, 'id' | 'name'> & { depots?: DepotAnnexe[]; regroupementId?: string },
  tous: readonly (Pick<Project, 'id' | 'name' | 'path'> & { regroupement?: boolean })[],
): PlanDeConversion | null {
  if (!projet.depots?.length || projet.regroupementId) return null;
  return {
    principal: projet.id,
    nomDuRegroupement: `${projet.name} (ensemble)`,
    annexes: projet.depots.map((depot) => {
      const existant = tous.find((p) => p.id !== projet.id && !estUnRegroupement(p) && p.path === depot.path);
      return { depot, existant: existant?.id, nom: existant?.name ?? `${projet.name} ${depot.nom}` };
    }),
  };
}

/**
 * LA SYNTHÈSE DU BESOIN D'UNE FILLE : sa consigne, puis la compréhension
 * validée sur la mère, ENTIÈRE — texte, hypothèses et part technique. Elle
 * ouvre la conversation de la fille et part dans son prompt de lancement
 * (`blocDeSyntheseDuBesoin`) : une fille n'a pas de cadrage à elle.
 */
export function briefingDeLaFille(
  consigne: string,
  comprise: {
    texte: string;
    hypotheses?: readonly string[];
    partieTechnique?: {
      taches?: readonly { titre: string; description?: string }[];
      faits?: readonly string[];
      risques?: string;
    };
  },
): string {
  const technique = comprise.partieTechnique;
  const blocs = [consigne, '', 'CE QUI A ÉTÉ COMPRIS ET VALIDÉ SUR LE PROJET RÉUNI :', comprise.texte.trim()];
  if (comprise.hypotheses?.length) blocs.push('', 'HYPOTHÈSES ASSUMÉES :', ...comprise.hypotheses.map((h) => `- ${h}`));
  if (technique?.taches?.length) {
    blocs.push(
      '',
      'DÉCOUPE DU TRAVAIL (pour l’ensemble — ne fais que la part de ce projet) :',
      ...technique.taches.map((t, i) => `${i + 1}. ${t.titre}${t.description ? ` — ${t.description}` : ''}`),
    );
  }
  if (technique?.faits?.length) blocs.push('', 'FAITS À RESPECTER :', ...technique.faits.map((f) => `- ${f}`));
  if (technique?.risques?.trim()) blocs.push('', 'CE QUI RISQUE DE CASSER :', technique.risques.trim());
  return blocs.join('\n');
}
