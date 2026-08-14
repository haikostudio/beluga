/**
 * LA RECHERCHE PAR LE SENS — LES VRAIS VECTEURS, CÔTÉ RÈGLES PURES.
 *
 * Jusqu'ici l'« empreinte » d'un passage était calculée SUR PLACE, par hachage
 * des racines de ses mots (`passages-doc.ts`). C'était rapide et gratuit, mais
 * ce n'était pas du sens : deux textes qui disent la même chose avec d'AUTRES
 * mots n'avaient rien en commun. Une demande écrite « le bouton pour tout
 * envoyer en ligne » ne retrouvait pas la règle qui parle de « publication ».
 *
 * On reprend donc le principe du chat de HaikoFormations
 * (`server/utils/rag.ts`, `server/utils/embeddings.ts` là-bas) : le texte est
 * envoyé à un modèle de VECTORISATION, qui rend un vecteur de sens ; deux textes
 * proches par le SENS ont des vecteurs proches, quels que soient leurs mots.
 *
 * Ce module ne fait AUCUN appel réseau : il ne porte que les décisions.
 *  - quel modèle, quelle taille de vecteur, par quels lots ;
 *  - quel texte on vectorise (le titre compte : il porte le sujet en clair) ;
 *  - quand on a le droit de PASSER en mode vecteurs, et quand on retombe sur
 *    l'ancienne empreinte de mots — sans clé, sans réseau, la recherche doit
 *    continuer de marcher, simplement moins finement.
 *
 * L'appel lui-même vit dans `server/src/vecteurs.ts`.
 */

/* ------------------------------------------------------------------ */
/* Le modèle et son format                                             */
/* ------------------------------------------------------------------ */

/**
 * LE MODÈLE DE VECTORISATION, le même que le chat de HaikoFormations. Il est
 * NOMMÉ dans l'index : un passage vectorisé par un autre modèle n'est pas
 * comparable, il sera donc revectorisé au lieu d'être cru sur parole.
 */
export const MODELE_VECTEURS = 'openai/text-embedding-3-small';

/** La porte d'entrée, compatible avec l'interface d'OpenAI. */
export const URL_VECTEURS = 'https://openrouter.ai/api/v1/embeddings';

/**
 * LA TAILLE DU VECTEUR. Le modèle en rend 1536 par défaut ; il sait aussi les
 * rendre plus courts sans perdre grand-chose (les premières dimensions portent
 * l'essentiel du sens). On demande 512 : trois fois moins de place en base et
 * trois fois moins de calcul à chaque recherche, pour une qualité qui tient.
 *
 * Un vecteur raccourci n'est plus de longueur 1 : il se RENORMALISE avant d'être
 * rangé, sinon le cosinus ne serait plus une proximité mais un mélange de
 * proximité et de longueur.
 */
export const DIMENSIONS_VECTEUR = 512;

/** Combien de textes par appel. Au-delà, le fournisseur refuse ou tronque. */
export const LOT_VECTEURS = 96;

/** Combien de fois on retente un appel tombé sur une panne passagère. */
export const ESSAIS_VECTEURS = 3;

/**
 * Ce qu'on envoie au plus pour UN passage. Les passages tiennent déjà sous
 * `PLAFOND_PASSAGE_SIGNES`, mais le titre et la source s'ajoutent devant : cette
 * borne est la ceinture, pas la bretelle.
 */
export const SIGNES_MAX_A_VECTORISER = 6000;

/**
 * COMBIEN DE PASSAGES ON VECTORISE AU PLUS EN UNE PASSE. L'indexation tourne
 * DANS la préparation d'un tour : la première d'un gros projet a des milliers de
 * passages à vectoriser, et faire attendre le lancement d'une carte plusieurs
 * minutes serait pire que le mal. On en fait donc une tranche par passe, et le
 * reste au lancement suivant — la recherche fonctionne pendant ce temps, en
 * repli sur les mots.
 */
export const PASSAGES_PAR_PASSE_MAX = 480;

/* ------------------------------------------------------------------ */
/* Ce qu'on vectorise                                                  */
/* ------------------------------------------------------------------ */

/**
 * LE TEXTE ENVOYÉ AU MODÈLE pour un passage. Le fil des titres part DEVANT le
 * corps : c'est lui qui dit de quoi le passage parle (« Cartes › Une carte naît
 * dans Planifié »), et un corps seul, sorti de son fichier, se comprend souvent
 * mal. Même choix que le chat de HaikoFormations, qui préfixe chaque morceau du
 * titre de la leçon et de son chemin de sections.
 */
export function texteAVectoriser(passage: { source: string; titre: string; texte: string }): string {
  const entete = [passage.source, passage.titre].filter(Boolean).join(' — ');
  const brut = entete ? `${entete}\n\n${passage.texte}` : passage.texte;
  return brut.slice(0, SIGNES_MAX_A_VECTORISER);
}

/** Un vecteur ramené à la longueur 1, pour que le cosinus soit un simple produit. */
export function normaliserLeVecteur(vecteur: number[]): number[] {
  let carre = 0;
  for (const v of vecteur) carre += v * v;
  const norme = Math.sqrt(carre);
  if (!norme) return vecteur;
  return vecteur.map((v) => v / norme);
}

/** Un vecteur est utilisable s'il a la bonne taille et n'est pas vide. */
export function vecteurUtilisable(vecteur: ArrayLike<number> | undefined | null): boolean {
  if (!vecteur || vecteur.length !== DIMENSIONS_VECTEUR) return false;
  for (let i = 0; i < vecteur.length; i++) if (vecteur[i] !== 0) return true;
  return false;
}

/* ------------------------------------------------------------------ */
/* Quand on cherche par le sens, et quand on retombe sur les mots      */
/* ------------------------------------------------------------------ */

/**
 * LA PART DE PASSAGES VECTORISÉS EN DEÇÀ DE LAQUELLE ON NE BASCULE PAS. Mélanger
 * dans un même classement des passages notés au sens réel et des passages notés
 * à zéro faute de vecteur ferait gagner les premiers par construction, pas par
 * pertinence. Tant que l'index n'est pas assez vectorisé — première passe,
 * réindexation en cours —, tout le monde reste jugé à l'ancienne.
 */
export const COUVERTURE_VECTEURS_MIN = 0.75;

/** Ce que la recherche a décidé, et pourquoi — c'est ce que le contrôle affiche. */
export interface ModeDeRecherche {
  /** Vrai quand le classement se fait sur de vrais vecteurs de sens. */
  vecteurs: boolean;
  /** La part de l'index réellement vectorisée, entre 0 et 1. */
  couverture: number;
  /** Dit en clair quand on reste sur les mots. */
  raison?: string;
}

/**
 * LE MODE RETENU POUR UNE RECHERCHE. Trois conditions, toutes nécessaires : la
 * question a son vecteur (donc la clé répond), l'index en a assez, et il y a
 * quelque chose à classer.
 */
export function modeDeRecherche(args: {
  vecteurQuestion?: ArrayLike<number> | null;
  total: number;
  vectorises: number;
}): ModeDeRecherche {
  const couverture = args.total > 0 ? args.vectorises / args.total : 0;
  if (!vecteurUtilisable(args.vecteurQuestion ?? undefined)) {
    return { vecteurs: false, couverture, raison: 'la question n’a pas pu être vectorisée' };
  }
  if (couverture < COUVERTURE_VECTEURS_MIN) {
    return {
      vecteurs: false,
      couverture,
      raison: `index vectorisé à ${Math.round(couverture * 100)} % seulement`,
    };
  }
  return { vecteurs: true, couverture };
}

/* ------------------------------------------------------------------ */
/* Ce que pèse le sens quand il est réel                               */
/* ------------------------------------------------------------------ */

/**
 * LE SENS PÈSE PLUS LOURD QUAND IL EST VRAI. Avec l'empreinte de mots, le sens
 * était une approximation qu'il fallait rattraper par la présence littérale des
 * termes rares (0,55 / 0,45). Un vrai vecteur, lui, reconnaît une reformulation
 * : on lui laisse la majorité. Les mots exacts ne disparaissent pas pour autant
 * — un nom de fichier, un nom de colonne, un identifiant restent ce qu'un agent
 * cherche le plus souvent, et aucun modèle de sens ne les distingue d'un
 * synonyme.
 */
export const POIDS_SENS_VECTEUR = 0.7;
export const POIDS_MOTS_VECTEUR = 0.3;

/**
 * LE SEUIL, EN MODE VECTEURS. Les cosinus d'un vrai modèle se tiennent plus haut
 * et plus serrés que ceux d'une empreinte de mots : un passage sans rapport est
 * rarement à zéro, il est vers 0,1. Le seuil monte donc avec eux, sinon la
 * recherche remonterait sept passages pour n'importe quelle question.
 */
export const SCORE_MINIMUM_VECTEUR = 0.24;

/* ------------------------------------------------------------------ */
/* Les pannes                                                          */
/* ------------------------------------------------------------------ */

/** Une réponse qu'il vaut la peine de retenter : surcharge ou panne du serveur. */
export function reponseRejouable(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

/** L'attente avant le nouvel essai, doublée à chaque fois. */
export function attenteAvantEssai(essai: number): number {
  return 500 * Math.pow(2, Math.max(0, essai - 1));
}
