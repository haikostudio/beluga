/*
 * UNE ÉTAPE DE PUBLICATION QUI TRAÎNE EST UNE PANNE, PAS UN TRAVAIL LENT.
 *
 * La réparation des étapes (`reparation-publication.ts`) ne sait relever que ce
 * qui TOMBE : une commande qui rend un code d'erreur, une adresse qui répond
 * non. Il lui manquait le cas le plus sournois — l'étape qui ne rend jamais la
 * main. Elle reste « en cours » avec sa petite roue, indistinguable d'une étape
 * qui travaille, et elle peut rester ainsi indéfiniment. Personne n'est
 * prévenu : il faut venir constater soi-même, vingt minutes plus tard, que rien
 * n'avance.
 *
 * Deux trous distincts, et ils n'ont pas la même nature.
 *
 *  - Une COMMANDE (git, npm, systemctl) est déjà bornée par son délai
 *    d'exécution : elle finit par tomber. Mais elle tombe sur un message que
 *    personne ne reconnaît (« Command failed … SIGTERM »), donc aucune panne
 *    n'est nommée, aucun agent n'est appelé, et la publication s'arrête rouge
 *    sur du texte brut.
 *  - Un TOUR D'AGENT (la mise en production confiée, le dépanneur lui-même, la
 *    réparation des contrôles ou de la construction) n'a AUCUNE borne. Un moteur
 *    qui se tait pour toujours tient l'étape ouverte pour toujours.
 *
 * Ce fichier apporte les trois pièces qui manquaient, et rien d'autre : une
 * DURÉE ATTENDUE par étape, le CONSTAT du dépassement, et une PANNE NOMMÉE —
 * « l'étape ne rend pas la main » — qui rentre dans le mécanisme de réparation
 * déjà écrit, avec ses gestes, ses reprises bornées et son journal lisible.
 *
 * DEUX PRÉCAUTIONS tiennent la mesure honnête.
 *
 *  1. LE TEMPS D'UN DÉPANNAGE NE COMPTE PAS. L'agent appelé au secours travaille
 *     pendant que l'étape est arrêtée ; le compter reviendrait à déclarer en
 *     retard une étape dont on est justement en train de s'occuper, et à
 *     déclencher un second dépannage sur le dos du premier.
 *  2. LES DURÉES SONT LARGES, VOLONTAIREMENT. On ne cherche pas à mesurer une
 *     lenteur, on cherche à reconnaître un blocage. Une étape deux fois plus
 *     lente que d'habitude doit passer sans un mot ; c'est celle qui ne finit
 *     JAMAIS qu'on veut attraper.
 *
 * Règles PURES : ni base, ni disque, ni horloge à elles — l'instant leur est
 * toujours passé en argument, ce qui les rend rejouables à l'identique.
 *
 * DEUX LIMITES, les mêmes que la réparation d'une étape tombée : rien n'est mis
 * en ligne que l'utilisateur n'ait demandé (on rejoue SON étape), et le service
 * du démon HaikoDev n'est jamais touché — il porte la publication elle-même.
 */

import type { DeployStepKey } from './models.js';
import type { PanneDePublication } from './reparation-publication.js';
/*
 * La même façon de dire une durée que la carte restée « En cours » : « 4 min »,
 * « 1 h 20 ». Deux écritures pour la même chose se liraient comme deux mesures
 * différentes.
 */
import { dureeDite } from './travail-restant.js';

const MINUTE = 60 * 1000;

/**
 * LA DURÉE ATTENDUE DE CHAQUE ÉTAPE.
 *
 * Ce ne sont pas des moyennes : ce sont des plafonds au-delà desquels on cesse
 * de croire au travail en cours. Chacun est calé sur ce que l'étape fait
 * RÉELLEMENT, avec de la marge :
 *
 *  - `merge` : autant de fusions git que de cartes du lot, plus les conflits
 *    résolus par un agent — la plus variable des sept ;
 *  - `commit` / `push` : de la plomberie git, plus le réseau pour l'envoi ;
 *  - `verify` : la compilation du serveur puis TOUS les contrôles du projet,
 *    chacun déjà borné à dix minutes ;
 *  - `build` : `npm run build`, borné à dix minutes lui aussi, plus la pose des
 *    outils de construction quand ils manquent ;
 *  - `publish` : la plus longue, parce qu'elle porte la mise en production
 *    CONFIÉE à un agent — un tour de moteur entier, qui construit, transfère et
 *    contrôle ;
 *  - `restart` : `systemctl restart` et l'attente que le service reparte.
 */
export const DUREE_ATTENDUE_MS: Record<DeployStepKey, number> = {
  merge: 20 * MINUTE,
  commit: 5 * MINUTE,
  push: 10 * MINUTE,
  verify: 30 * MINUTE,
  build: 25 * MINUTE,
  publish: 45 * MINUTE,
  restart: 10 * MINUTE,
};

/**
 * LE PLAFOND D'UN TOUR D'AGENT appelé PENDANT une publication.
 *
 * Distinct de la durée d'une étape, et pour une raison de fond : l'étape mesure
 * un TRAVAIL, ce plafond mesure une ATTENTE. Un agent qui n'a rien écrit depuis
 * une demi-heure n'est pas en train de réfléchir — c'est le moteur qui s'est tu
 * ou le tour qui est pendu.
 *
 * Le conflit et le dépannage sont les plus courts : leur consigne tient en cinq
 * gestes précis, sur une panne déjà nommée. La mise en production est la plus
 * longue : elle suit le prompt du projet de bout en bout, construction comprise.
 *
 * LE CONFLIT EST LE PLUS IMPORTANT DES CINQ, et c'est le dernier arrivé.
 * `resoudreConflit` appelait `sendPrompt` NU : un agent dont la préparation
 * restait pendue (10 des 99 agents de conflit de l'audit du 18/08/2026 n'ont
 * jamais lancé leur moteur) laissait la fusion « en cours » POUR TOUJOURS —
 * refermer le tour dans la base ne dénoue pas la promesse que la fusion attend.
 * Seul un clic humain sur « Arrêter » débloquait la publication.
 */
export const PLAFOND_TOUR_D_AGENT_MS: Record<MotifDeTourDePublication, number> = {
  conflit: 15 * MINUTE,
  depannage: 20 * MINUTE,
  controles: 30 * MINUTE,
  construction: 30 * MINUTE,
  'mise-en-ligne': 40 * MINUTE,
};

/** Les cinq raisons pour lesquelles une publication appelle un agent. */
export type MotifDeTourDePublication =
  | 'conflit'
  | 'depannage'
  | 'controles'
  | 'construction'
  | 'mise-en-ligne';

/** Tous les combien on revient constater qu'une étape avance encore. */
export const PERIODE_DE_VEILLE_MS = 30 * 1000;

/** Ce qu'on sait du temps passé par une étape en cours. */
export interface ConstatDeDuree {
  /** L'étape a-t-elle dépassé sa durée attendue ? */
  depasse: boolean;
  /** Le temps réellement passé À TRAVAILLER, dépannages déduits. */
  ecouleMs: number;
  /** La durée attendue à laquelle on l'a comparé. */
  attenduMs: number;
}

/**
 * UNE ÉTAPE A-T-ELLE DÉPASSÉ SA DURÉE ATTENDUE ?
 *
 * Le calcul tient en une soustraction, et c'est cette soustraction qui fait
 * toute la valeur de la règle : `tempsDeDepannageMs` est retranché du temps
 * écoulé. Sans elle, une étape tombée à la cinquième minute puis confiée
 * vingt minutes à un agent de dépannage serait déclarée « en retard » à
 * l'instant même où elle est rejouée — et un second dépannage partirait sur le
 * dos du premier, indéfiniment.
 *
 * Une étape sans instant de départ (une étape jamais lancée, une publication
 * relue d'avant cette règle) n'a rien dépassé : on ne devine pas.
 */
export function constatDeDuree(input: {
  etape: DeployStepKey;
  debutMs?: number;
  maintenantMs: number;
  tempsDeDepannageMs?: number;
  attenduMs?: number;
}): ConstatDeDuree {
  const attenduMs = input.attenduMs ?? DUREE_ATTENDUE_MS[input.etape] ?? 0;
  if (!input.debutMs || !Number.isFinite(input.debutMs)) {
    return { depasse: false, ecouleMs: 0, attenduMs };
  }
  const brut = input.maintenantMs - input.debutMs;
  const ecouleMs = Math.max(0, brut - Math.max(0, input.tempsDeDepannageMs ?? 0));
  return { depasse: attenduMs > 0 && ecouleMs > attenduMs, ecouleMs, attenduMs };
}

/**
 * LA LIGNE DE PROGRESSION D'UNE ÉTAPE QUI TRAÎNE.
 *
 * Elle dit les deux chiffres qui permettent de juger sans rien ouvrir : depuis
 * combien de temps ça dure, et combien de temps c'était censé durer. C'est
 * précisément ce que l'utilisateur venait constater lui-même.
 */
export function mentionEtapeQuiTraine(libelleEtape: string, constat: ConstatDeDuree): string {
  return (
    `« ${libelleEtape} » dure depuis ${dureeDite(constat.ecouleMs)}, ` +
    `au-delà des ${dureeDite(constat.attenduMs)} attendues : la publication surveille et interviendra si rien n’avance.`
  );
}

/**
 * L'ALERTE D'UNE ÉTAPE EN RETARD — envoyée AU CONSTAT, pas au dépannage.
 *
 * La ligne orange du déroulé ne se voit que par qui regarde déjà l'écran, et le
 * dépanneur ne part qu'une fois l'étape RETOMBÉE — pour une étape pendue, cela
 * peut vouloir dire jamais. Prévenir au constat est donc le seul moment qui
 * tienne la promesse : ne plus avoir à venir surveiller une publication.
 *
 * Elle dit ce qu'on veut savoir sans ouvrir l'écran : quel projet, quelle
 * étape, depuis combien de temps, et ce qui va se passer tout seul. Elle ne
 * part qu'UNE FOIS par étape (`reference`) — un retard qui dure ne se répète
 * pas toutes les trente secondes.
 */
export function alerteDeRetard(input: {
  projet?: string;
  libelleEtape: string;
  constat: ConstatDeDuree;
}): { titre: string; corps: string; element: string } {
  const ou = input.projet?.trim() ? ` de « ${input.projet.trim()} »` : '';
  return {
    titre: `Publication en retard${ou}`,
    corps:
      `L’étape « ${input.libelleEtape} » dure depuis ${dureeDite(input.constat.ecouleMs)}, ` +
      `pour ${dureeDite(input.constat.attenduMs)} attendues. ` +
      'Rien à faire : la publication tente de se débloquer seule, et dira ce qu’elle a essayé.',
    element: `« ${input.libelleEtape} » en retard (${dureeDite(input.constat.ecouleMs)})`,
  };
}

/**
 * LA PANNE D'UNE ÉTAPE QUI NE REND PAS LA MAIN.
 *
 * Comme l'adresse muette (`panneDAdresseMuette`), elle ne se reconnaît à aucun
 * message : c'est le TEMPS qui la nomme, et c'est toujours la même panne quelle
 * que soit l'étape. Elle est donc forcée par l'appelant plutôt que devinée dans
 * une sortie — et toujours réparable, puisque c'est exactement le cas où un
 * agent a quelque chose à aller regarder.
 *
 * Les gestes lui disent de CHERCHER CE QUI BLOQUE avant de réparer : une étape
 * pendue ne dit rien d'elle-même, contrairement à une commande qui tombe avec
 * sa sortie. Et les deux interdits habituels y sont écrits en toutes lettres,
 * parce que c'est ici qu'on est le plus tenté de les franchir : un agent qui
 * cherche à « débloquer » redémarre volontiers le premier service venu.
 */
export function panneDeLenteur(libelleEtape: string, constat: ConstatDeDuree): PanneDePublication {
  return {
    nom:
      `l’étape « ${libelleEtape} » ne rend pas la main — ${dureeDite(constat.ecouleMs)} passées ` +
      `pour ${dureeDite(constat.attenduMs)} attendues`,
    reparable: true,
    gestes: [
      'CHERCHE D’ABORD CE QUI BLOQUE : une étape pendue ne dit rien d’elle-même, contrairement à une commande qui tombe.',
      'Regarde ce qui tourne encore sur la machine pour ce projet (processus de construction, commande git, service en cours de démarrage) et depuis quand.',
      'Regarde les causes d’attente sans fin : un verrou git oublié (`.git/index.lock`), un dépôt distant qui ne répond pas, un disque plein, une commande qui attend une saisie qu’aucun humain ne fera.',
      'Répare la cause que tu as NOMMÉE, et elle seule. Ne relance pas l’étape toi-même : la publication la rejouera dès que tu auras fini.',
      'N’ARRÊTE AUCUN AGENT ET NE REDÉMARRE JAMAIS le service du démon HaikoDev : il porte cette publication et tous les agents au travail — le couper interromprait précisément ce que tu es en train de débloquer.',
      'Ne mets RIEN en ligne toi-même et n’efface aucune branche : la décision de publier appartient à l’utilisateur, et le travail des cartes vit sur ces branches.',
    ],
  };
}

/**
 * LA SORTIE ÉCRITE À LA PLACE DE CELLE QU'ON N'AURA JAMAIS.
 *
 * Une étape coupée pour dépassement n'a rien rendu : ni code d'erreur, ni
 * message. Le mécanisme de réparation, lui, attend une sortie — c'est ce qu'il
 * montre à l'agent et ce qu'il écrit dans le déroulé. On lui donne donc le seul
 * fait dont on dispose, et il vaut mieux qu'un texte vide : ce qui a été
 * attendu, combien de temps, et ce qui a été fait de l'attente.
 */
export function sortieDuDepassement(libelleEtape: string, constat: ConstatDeDuree, coupe: boolean): string {
  const arret = coupe
    ? 'Le tour d’agent qui la tenait a été arrêté proprement pour qu’elle puisse être reprise.'
    : 'Aucun tour d’agent n’était en cause : c’est la commande de l’étape qui n’a pas rendu la main.';
  return [
    `L’étape « ${libelleEtape} » a dépassé sa durée attendue.`,
    `Temps passé : ${dureeDite(constat.ecouleMs)} — attendu : ${dureeDite(constat.attenduMs)}.`,
    arret,
    'Aucune sortie n’est disponible : une étape qui ne rend pas la main n’en produit pas.',
  ].join('\n');
}

/** Ce qu'on écrit dans le déroulé quand un tour d'agent est coupé pour dépassement. */
export function recitTourCoupe(motif: MotifDeTourDePublication, ecouleMs: number): string {
  const quoi =
    motif === 'mise-en-ligne'
      ? 'l’agent de mise en production'
      : motif === 'depannage'
        ? 'l’agent de dépannage'
        : motif === 'conflit'
          ? 'l’agent de résolution du conflit'
          : 'l’agent de réparation';
  return `${quoi} ne rendait plus la main après ${dureeDite(ecouleMs)} : son tour a été arrêté, rien n’a été perdu`;
}

/**
 * Ce qu'on écrit quand une étape est ABANDONNÉE faute d'avoir jamais fini.
 *
 * Le pendant du refus de `reparation-publication.ts` : au bout des reprises, on
 * s'arrête et on le DIT, plutôt que de rejouer sans fin une étape qui ne finit
 * pas. Le nombre de reprises reste borné — c'est la garantie qu'un blocage ne
 * devient jamais une boucle.
 */
export function recitDepassementNonResolu(constat: ConstatDeDuree, reprises: number): string {
  const combien = reprises > 1 ? `${reprises} reprises` : `${reprises} reprise`;
  return (
    `l’étape n’a toujours pas rendu la main après ${combien} (${dureeDite(constat.ecouleMs)} en tout, ` +
    `pour ${dureeDite(constat.attenduMs)} attendues) : elle est rendue telle quelle, rien n’a été forcé`
  );
}
