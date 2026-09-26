import { z } from 'zod';
import type { ColumnKey } from './columns.js';
import type { ParcoursDeCarte } from './models.js';

/**
 * LE CARNET DE MÉMOIRE D'UNE CARTE — CE QUE L'AGENT A OUVERT, ET À QUELLE ÉTAPE.
 *
 * Chaque point du fil d'une carte dit, replié, ce que l'agent a ouvert dans la
 * base de connaissances pendant cette étape : « La compréhension a ouvert
 * DEC-078 · …, Fiche 05_decisions ».
 *
 * LE CARNET N'A PAS D'ENREGISTREMENT À LUI. La mémoire en classeurs note déjà
 * chaque ouverture (`noterUneLecture` → table `connaissance_lectures`, une
 * ligne par agent et par clé, avec l'étape du parcours) : c'est ce relevé que
 * `carnetDeLaCarte` (`server/src/store.ts`) rend en lignes (`ligneDUneLecture`),
 * à l'ouverture de la carte (`card.journal`) et en direct (`carnet.lignes`,
 * émis par l'outil `memoire`, `server/src/tools.ts`). Un second enregistrement
 * parallèle a déjà existé (table `memoire_carnet`) : son écrivain a été retiré
 * avec l'ancien arbre le 13.09.2026 sans que personne ne le voie, et le bloc a
 * disparu de l'écran pendant six jours. La table reste LUE : les cartes
 * d'avant gardent leur historique.
 *
 * CE FICHIER NE TOUCHE NI BASE NI DISQUE : la forme des lignes, l'étape où
 * l'on lit, et les phrases du récit.
 */

/**
 * LES SEPT ÉTAPES DU PARCOURS D'UNE CARTE, DANS LEUR ORDRE.
 *
 * « Préparation » se glisse entre le plan et le travail : c'est ce qui se passe
 * entre le clic sur « Lancer » et le premier mot du moteur — portes, copie de
 * travail, branche, attente du moteur. Elle ne consomme aucune mémoire non
 * plus, et n'apparaît QUE quand un lancement a vraiment eu lieu : une carte qui
 * n'est jamais partie n'en porte pas le point.
 *
 * « Configuration » ouvre la marche : avec quoi cette carte va-t-elle tourner
 * — moteur, modèle, réflexion, compte ? C'était une bande posée AU-DESSUS de
 * la barre de progression, hors du parcours, alors qu'elle en est le premier
 * geste : elle a donc son segment et son point, avant « Demande ». Aucun
 * morceau de mémoire ne s'y sert (rien n'y coûte un jeton) : elle n'apparaît
 * jamais dans les lignes du carnet, seulement dans le flux.
 */
export const ETAPES_DU_PARCOURS = [
  'configuration',
  'demande',
  'comprehension',
  'plan',
  'preparation',
  'travail',
  'rapport',
] as const;
export const EtapeDuParcours = z.enum(ETAPES_DU_PARCOURS);
export type EtapeDuParcours = z.infer<typeof EtapeDuParcours>;

/** Le mot de chaque étape, traduit à l'affichage comme le reste. */
export const LIBELLES_ETAPE: Record<EtapeDuParcours, string> = {
  configuration: 'Configuration',
  demande: 'Demande',
  comprehension: 'Compréhension',
  plan: 'Plan',
  preparation: 'Préparation',
  travail: 'Travail',
  rapport: 'Rapport',
};

/**
 * D'où vient ce qui a été ouvert. La mémoire en classeurs ne connaît que DEUX
 * portées : le projet et le global. « socle » et « centrale » ne vivent plus que
 * sur les lignes d'avant le 13.09.2026 (l'ancien arbre), qui restent lisibles.
 */
export const PORTEES_DU_CARNET = ['projet', 'global', 'socle', 'centrale'] as const;
export const PorteeDuCarnet = z.enum(PORTEES_DU_CARNET);
export type PorteeDuCarnet = z.infer<typeof PorteeDuCarnet>;

/** Une ligne du carnet : un morceau de mémoire servi à cette carte. */
export const LigneDuCarnet = z.object({
  id: z.string(),
  cardId: z.string(),
  /** L'agent qui l'a reçu : c'est SON contexte qui le porte encore, ou plus. */
  agentId: z.string().optional(),
  etape: EtapeDuParcours,
  tourId: z.string().optional(),
  /**
   * La clé de ce qui a été ouvert. Mémoire en classeurs : l'identifiant d'une
   * unité (`MEM-0042`, `DEC-007`), `fiche:<portée>:<fiche>` ou
   * `changelog:<projet>`. Lignes de l'ancien arbre : `genre:id:empreinte`,
   * préfixée de la portée hors projet.
   */
  cle: z.string(),
  /** `unite`, `fiche` ou `changelog` ; sur une ligne de l'ancien arbre : faits, règles, contrôles, branche… */
  genre: z.string().default(''),
  /** L'identifiant de l'unité ou de la fiche ; sur une ligne de l'ancien arbre, son sujet. */
  sujet: z.string().default(''),
  /** Le titre de l'unité ouverte, tel que la base le portait à la lecture. */
  titre: z.string().optional(),
  /** Ancien arbre seulement. */
  branche: z.string().optional(),
  portee: PorteeDuCarnet.default('projet'),
  /** Ancien arbre seulement : ce que le morceau a pesé, en signes. La mémoire en classeurs ne pèse pas ses lectures. */
  poids: z.number().nonnegative().default(0),
  at: z.number(),
  /**
   * LE MORCEAU EST-IL ENCORE SOUS LES YEUX DE L'AGENT ? Vrai tant que la
   * session qui l'a reçu vit ; faux dès qu'elle repart de zéro ou qu'un autre
   * agent prend la carte. Le rappel d'une ligne ne vaut que pour ce qui est
   * encore là ; le récit du point, lui, garde tout.
   */
  enContexte: z.boolean().default(true),
});
export type LigneDuCarnet = z.infer<typeof LigneDuCarnet>;

/**
 * UNE LECTURE DU RELEVÉ VIVANT, RENDUE EN LIGNE DU CARNET.
 *
 * Le carnet n'a plus d'enregistrement à lui : la mémoire en classeurs note déjà
 * chaque ouverture dans `connaissance_lectures` (`noterUneLecture`,
 * `server/src/connaissances.ts`) — une ligne par agent et par clé. Cette
 * fonction en fait la ligne que le fil affiche. L'identifiant est STABLE
 * (`lecture:<agent>:<clé>`) : une unité rouverte après une session neuve
 * remplace sa ligne à l'écran, elle ne s'y ajoute pas.
 *
 * `etape` manque sur les lectures notées entre le 13 et le 19.09.2026 (la
 * colonne n'existait pas) : le rôle de l'agent tranche alors, comme
 * `etapeDeLaMemoire` sans parcours.
 */
export function ligneDUneLecture(lecture: {
  agentId: string;
  cle: string;
  cardId: string;
  at: number;
  enContexte: boolean;
  etape?: string | null;
  roleAgent?: string;
  /** Pour une unité : son titre et sa portée, lus dans la base. */
  titre?: string;
  globale?: boolean;
}): LigneDuCarnet {
  const etape = EtapeDuParcours.safeParse(lecture.etape);
  const parts = lecture.cle.split(':');
  const genre = parts[0] === 'fiche' ? 'fiche' : parts[0] === 'changelog' ? 'changelog' : 'unite';
  const sujet = genre === 'fiche' ? (parts[2] ?? '') : genre === 'changelog' ? 'changelog' : lecture.cle;
  const globale = genre === 'fiche' ? parts[1] === 'global' : !!lecture.globale;
  return LigneDuCarnet.parse({
    id: `lecture:${lecture.agentId}:${lecture.cle}`,
    cardId: lecture.cardId,
    agentId: lecture.agentId,
    etape: etape.success ? etape.data : etapeDeLaMemoire({ roleAgent: lecture.roleAgent }),
    cle: lecture.cle,
    genre,
    sujet,
    ...(lecture.titre ? { titre: lecture.titre } : {}),
    portee: globale ? 'global' : 'projet',
    at: lecture.at,
    enContexte: lecture.enContexte,
  });
}

/**
 * À QUELLE ÉTAPE ON SERT LA MÉMOIRE, lue sur la carte et l'agent au moment de
 * l'appel — jamais devinée dans le texte. Un agent de cadrage comprend tant
 * qu'aucun plan n'est en cours d'écriture, et le plan le temps de l'écrire ; un
 * agent de tâche travaille ; l'accueil d'office (ce que la carte ouvre au lancement, par le
 * mot de ses branches) appartient à la demande pour le cadrage, au travail
 * pour l'exécution. Le rapport ne consomme rien de neuf.
 */
export function etapeDeLaMemoire(ctx: {
  roleAgent?: string;
  colonne?: ColumnKey;
  parcours?: Pick<ParcoursDeCarte, 'plans' | 'planDemandeA'> | null;
  /** L'ouverture d'office du lancement, pas une demande de l'agent. */
  accueil?: boolean;
}): EtapeDuParcours {
  if (ctx.roleAgent === 'cadrage') {
    if (ctx.accueil) return 'demande';
    /*
     * LA MÉMOIRE LUE PENDANT L'ÉCRITURE DU PLAN, ET ELLE SEULE, APPARTIENT AU
     * PLAN. Un plan DÉJÀ RENDU n'y suffit pas : depuis que l'affinage ne part
     * plus tout seul, le tour suivant est une compréhension ordinaire, et ce
     * qu'il ouvre se range sous la compréhension.
     */
    return ctx.parcours?.planDemandeA ? 'plan' : 'comprehension';
  }
  return 'travail';
}

/** Un mot en majuscule initiale, pour les libellés du récit. */
function capitale(mot: string): string {
  return mot ? mot.charAt(0).toUpperCase() + mot.slice(1) : mot;
}

/**
 * Le nom lisible d'une ligne. Mémoire en classeurs : « DEC-078 · Le fil en cinq
 * points », « Fiche 05_decisions », « Changelog ». Ancien arbre :
 * « Interface › Parcours », « Cartes ».
 */
export function nomDeLaLigne(ligne: Pick<LigneDuCarnet, 'sujet' | 'branche' | 'genre'> & { titre?: string }): string {
  if (ligne.genre === 'unite') return ligne.titre ? `${ligne.sujet} · ${ligne.titre}` : ligne.sujet;
  if (ligne.genre === 'fiche') return `Fiche ${ligne.sujet}`;
  if (ligne.genre === 'changelog') return 'Changelog';
  const sujet = capitale(ligne.sujet || ligne.genre || 'mémoire');
  return ligne.branche ? `${sujet} › ${capitale(ligne.branche)}` : sujet;
}

/**
 * LE RÉCIT D'UNE ÉTAPE : les lignes du carnet qui lui appartiennent, sans
 * doublon, dans l'ordre où elles sont arrivées. C'est ce que le point du
 * flux montre replié — « La compréhension a ouvert Interface › Parcours et
 * Méthode › Mémoire ».
 */
export function lignesDeLEtape(lignes: readonly LigneDuCarnet[], etape: EtapeDuParcours): LigneDuCarnet[] {
  const vues = new Set<string>();
  const retenues: LigneDuCarnet[] = [];
  for (const ligne of [...lignes].sort((a, b) => a.at - b.at)) {
    if (ligne.etape !== etape) continue;
    const nom = `${ligne.portee}:${nomDeLaLigne(ligne)}`;
    if (vues.has(nom)) continue;
    vues.add(nom);
    retenues.push(ligne);
  }
  return retenues;
}

/**
 * LE POIDS D'UNE LIGNE, EN CLAIR : « 1 200 signes », ou rien quand on ne l'a
 * pas mesuré (l'ouverture d'office n'est pas pesée morceau par morceau).
 */
export function poidsLisible(poids: number): string {
  if (!poids) return '';
  return `${poids.toLocaleString('fr-CH').replace(/ /g, ' ')} signes`;
}
