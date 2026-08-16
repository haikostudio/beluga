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
 * DEUX MOTEURS POSSIBLES, ET LE LOCAL EST LE DÉFAUT.
 *
 * `local` — BAAI/bge-m3 tourne SUR LE SERVEUR (`server/src/vecteurs-local.ts`,
 * installé par `scripts/installer-vectoriseur.mjs`). Aucun octet de
 * documentation ne sort de la machine, aucun centime n'est dépensé par appel.
 * C'est plus lent (deux passages par seconde contre cent), d'où le rendez-vous
 * de nuit — mais c'est le seul moteur qu'on peut laisser tourner sans compter.
 *
 * `openrouter` — le chemin d'origine, EXTERNE et facturé. Il ne sert plus que si
 * on le demande en toutes lettres (`HAIKODEV_EMBED_MOTEUR=openrouter`).
 */
export type MoteurDeVecteurs = 'local' | 'openrouter';
export const MOTEUR_PAR_DEFAUT: MoteurDeVecteurs = 'local';

/**
 * LE MODÈLE DE CHAQUE MOTEUR. Il est NOMMÉ dans l'index : un passage vectorisé
 * par un autre modèle n'est pas comparable, il sera donc revectorisé au lieu
 * d'être cru sur parole. Changer de moteur, c'est donc refaire l'index — pas le
 * corrompre.
 */
export const MODELE_LOCAL = 'Xenova/bge-m3';
export const MODELE_OPENROUTER = 'openai/text-embedding-3-small';
export const MODELE_VECTEURS = MODELE_LOCAL;

/** La porte d'entrée du moteur externe, compatible avec l'interface d'OpenAI. */
export const URL_VECTEURS = 'https://openrouter.ai/api/v1/embeddings';

/**
 * LA TAILLE DU VECTEUR DÉPEND DU MOTEUR : bge-m3 en rend 1024, toujours ; le
 * modèle d'OpenAI en rend 1536 mais sait les raccourcir, et on lui en demandait
 * 512. Rien dans le reste du code ne suppose une taille : le cosinus rend 0 pour
 * deux vecteurs de longueurs différentes, et le NOM du modèle rangé à côté de
 * chaque vecteur suffit à ne jamais comparer deux échelles.
 */
export const DIMENSIONS_LOCAL = 1024;
export const DIMENSIONS_OPENROUTER = 512;

export function dimensionsDuMoteur(moteur: MoteurDeVecteurs): number {
  return moteur === 'local' ? DIMENSIONS_LOCAL : DIMENSIONS_OPENROUTER;
}

/**
 * COMBIEN DE TEXTES PAR APPEL. Le moteur externe accepte de gros paquets ; le
 * local, lui, tient tout le lot en mémoire d'un coup — huit passages de 1 800
 * signes suffisent à occuper les quatre cœurs sans faire enfler le démon.
 */
export const LOT_VECTEURS = 96;
export const LOT_VECTEURS_LOCAL = 8;

export function lotDuMoteur(moteur: MoteurDeVecteurs): number {
  return moteur === 'local' ? LOT_VECTEURS_LOCAL : LOT_VECTEURS;
}

/** Combien de fois on retente un appel tombé sur une panne passagère. */
export const ESSAIS_VECTEURS = 3;

/**
 * CE QU'ON ENVOIE AU PLUS POUR UN PASSAGE — et ce n'est PAS le passage entier.
 *
 * Le temps que met un modèle de sens croît avec la longueur du texte, et vite.
 * Mesuré sur ce serveur, avec de vrais passages (`/tmp`, banc d'essai reproduit
 * dans `scripts/installer-vectoriseur.mjs`) :
 *
 *   1 800 signes → 0,8 passage/seconde
 *   1 000 signes → 1,6 passage/seconde
 *     600 signes → 2,3 passages/seconde
 *
 * On coupe donc à 1 000 signes. Ce n'est pas une perte : le DÉBUT d'un passage
 * porte son sujet — le fil des titres, la première phrase d'une règle, la
 * déclaration qui ouvre un morceau de code —, la suite en est la mécanique. Les
 * documents, dont le passage moyen fait 578 signes, ne sont pas touchés du tout ;
 * seul le CODE, à 1 592 signes de moyenne, est raccourci, et c'est lui qui
 * coûtait quatre cinquièmes du travail.
 *
 * Le texte ENVOYÉ À L'AGENT, lui, reste entier : on ne raccourcit que ce qui
 * sert à MESURER la proximité.
 */
export const SIGNES_MAX_A_VECTORISER = 1000;

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

/**
 * La plus petite taille qu'on accepte : en deçà, ce n'est pas un vecteur de
 * sens mais une réponse tronquée. On ne fixe PAS de taille exacte — elle dépend
 * du moteur, et c'est le NOM du modèle rangé à côté qui évite les mélanges.
 */
export const DIMENSIONS_MINIMALES = 128;

/** Un vecteur est utilisable s'il a une taille plausible et n'est pas vide. */
export function vecteurUtilisable(vecteur: ArrayLike<number> | undefined | null): boolean {
  if (!vecteur || vecteur.length < DIMENSIONS_MINIMALES) return false;
  for (let i = 0; i < vecteur.length; i++) if (vecteur[i] !== 0) return true;
  return false;
}

/* ------------------------------------------------------------------ */
/* Ce qu'une réindexation a le droit de JETER                          */
/* ------------------------------------------------------------------ */

/**
 * UN PASSAGE QUI N'A PAS CHANGÉ GARDE SON VECTEUR.
 *
 * L'indexation est incrémentale par FICHIER, pas par passage : un fichier dont
 * l'empreinte a bougé voit TOUS ses passages effacés puis réécrits, donc tous
 * ses vecteurs perdus. Sur un projet dont la documentation se réécrit chaque
 * jour, c'est fatal — constaté le 16/08/2026 sur HaikoDev : les 122 passages de
 * `CLAUDE.md`, les 75 de `docs/regles/cartes.md`, les 60 de
 * `docs/regles/interface.md` et tout `docs/memoire/` étaient sans vecteur, soit
 * 390 passages sur 824. L'index retombait donc sous `COUVERTURE_VECTEURS_MIN`,
 * et TOUTE la recherche repassait sur les mots — sur les fichiers qui comptent
 * le plus, et sur le seul projet dont la documentation bouge tous les jours. La
 * nuit rattrapait, la journée redéfaisait.
 *
 * Or une modification touche une SECTION, pas le fichier : la quasi-totalité des
 * passages réécrits sont mot pour mot les mêmes. On les reconnaît à leur TITRE et
 * à leur TEXTE — jamais à leur rang, qui glisse dès qu'une section est insérée —
 * et on leur rend leur vecteur. Rien n'est cru sur parole : un texte modifié
 * d'un signe n'est plus la même clé, donc il repart sans vecteur.
 */
export function cleDeVecteur(titre: string, texte: string): string {
  return `${titre.trim()} ${texte.trim()}`;
}

/** Un passage tel qu'il est rangé, avec ce qu'on cherche à lui reprendre. */
export interface PassageAVecteur<V> {
  titre: string;
  texte: string;
  vecteur: V | null | undefined;
  modele: string | null | undefined;
}

/**
 * Les vecteurs à REPRENDRE, dans l'ordre des nouveaux passages : `undefined` là
 * où il faudra revectoriser. Un même texte présent deux fois dans un fichier ne
 * sert qu'une fois — deux passages identiques auront chacun le leur à la passe
 * suivante, et rien n'est jamais dupliqué par erreur.
 */
export function vecteursRepris<V>(
  anciens: PassageAVecteur<V>[],
  nouveaux: { titre: string; texte: string }[],
): ({ vecteur: V; modele: string } | undefined)[] {
  const dispo = new Map<string, { vecteur: V; modele: string }[]>();
  for (const ancien of anciens) {
    if (!ancien.vecteur || !ancien.modele) continue;
    const cle = cleDeVecteur(ancien.titre, ancien.texte);
    const liste = dispo.get(cle) ?? [];
    liste.push({ vecteur: ancien.vecteur, modele: ancien.modele });
    dispo.set(cle, liste);
  }
  return nouveaux.map((passage) => dispo.get(cleDeVecteur(passage.titre, passage.texte))?.shift());
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
 * LE SEUIL, EN MODE VECTEURS — RÉGLÉ SUR UNE MESURE, PAS À L'ESTIME.
 *
 * Les cosinus d'un vrai modèle se tiennent plus haut et plus serrés que ceux
 * d'une empreinte de mots : un passage sans rapport est rarement à zéro, il est
 * vers 0,1. Le seuil monte donc avec eux — mais de combien ?
 *
 * À 0,24, il ne filtrait RIEN : 87 % du corpus de HaikoDev le franchissait sur
 * une vraie demande (4 486 passages sur 5 170), et une question étrangère au
 * projet — la recette d'une tarte, la durée d'un vol — recevait cinq à six
 * passages de règles au prix fort. `rechercherPourLaTache` ne retombant sur
 * l'index que si AUCUN passage ne passe le seuil, le repli était devenu du code
 * mort en mode sens.
 *
 * LA VALEUR VIENT DU BALAYAGE de `scripts/audit-memoire-rag.mjs` (section 5 bis),
 * qui rejoue 120 cartes RÉELLEMENT exécutées et juge chaque seuil candidat sur
 * les mêmes classements, avec pour vérité de terrain les fichiers que chaque
 * carte a modifiés. Relevé du 16/08/2026 :
 *
 *   seuil   bonne page retrouvée   passages servis   corpus au-dessus   hors sujet
 *   0,24        67 % (80/120)           5,2               87 %           6 passages
 *   0,34        67 % (80/120)           5,1               23 %           0
 *   0,38        67 % (80/120)           4,8               10 %           0
 *   0,40        66 % (79/120)           4,8                7 %           0
 *   0,55        58 % (70/120)           2,1                0 %           0
 *
 * De 0,24 à 0,38, la pertinence ne bouge pas d'une carte ; à 0,40, la première
 * tombe. Dans cette plage à coût nul, on prend la valeur la PLUS HAUTE : elle
 * laisse 0,05 de marge au-dessus du meilleur score qu'atteint une question hors
 * sujet (0,33), là où 0,34 collerait à cette limite. Le repli sur l'index
 * redevient donc ce qu'il devait être — ce qui se déclenche quand la question ne
 * parle pas du projet, et jamais sur une vraie demande (0 repli sur 120).
 *
 * Refaire la mesure avant de retoucher ce nombre :
 *   node scripts/audit-memoire-rag.mjs --cartes=120
 */
export const SCORE_MINIMUM_VECTEUR = 0.38;

/* ------------------------------------------------------------------ */
/* LE RENDEZ-VOUS DE LA NUIT                                           */
/* ------------------------------------------------------------------ */

/**
 * VECTORISER EST UN TRAVAIL DE FOND, PAS UN PÉAGE AU LANCEMENT D'UNE CARTE.
 *
 * La première version vectorisait une tranche à chaque lancement : la carte
 * payait quelques secondes d'attente, et il fallait neuf lancements pour que la
 * recherche par le sens prenne enfin la main. On sort donc ce travail du chemin
 * de l'utilisateur — une fois par nuit, TOUS les projets d'un coup, à l'heure où
 * personne n'attend le serveur. Ce qui reste au lancement d'une carte, c'est le
 * vecteur de la QUESTION : un seul appel, quelques dizaines de millisecondes.
 *
 * 1 h du matin, avant le rendez-vous d'auto-amélioration de 3 h : l'agent de la
 * nuit trouve ainsi un index déjà à jour.
 */
export const HEURE_VECTORISATION = 1;

/** La fenêtre de rattrapage, en heures pleines : 1 h, 2 h. */
export const FENETRE_VECTORISATION_HEURES = 2;

/**
 * TOUTES LES SIX HEURES, PLUS UNE FOIS PAR NUIT.
 *
 * Une seule passe par nuit laissait la journée entière défaire ce que la nuit
 * venait de faire : sur HaikoDev, dont presque chaque carte réécrit `CLAUDE.md`
 * ou `docs/`, la couverture retombait sous le seuil dès les premières cartes du
 * matin, et toute la recherche repassait par les MOTS jusqu'au lendemain. La
 * conservation des vecteurs (`vecteursRepris`) réduit énormément ce que chaque
 * carte détruit — mais elle ne le supprime pas : une section réellement modifiée
 * repart bien sans vecteur, et il faut alors quelqu'un pour la reprendre AVANT
 * la nuit.
 *
 * Le rendez-vous revient donc toutes les six heures. Ce n'est pas la même passe
 * selon l'heure : voir `AmpleurDeVectorisation`.
 */
export const PERIODE_VECTORISATION_MS = 6 * 60 * 60 * 1000;

/**
 * COMBIEN DE TRANCHES AU PLUS EN UNE NUIT, tous projets confondus. Une borne,
 * pas un objectif : elle empêche qu'un dossier inattendu — des milliers de pages
 * apparues d'un coup — occupe le serveur jusqu'au matin. Ce qui déborde attend
 * la nuit suivante.
 */
export const TRANCHES_MAX_PAR_NUIT = 120;

/**
 * ET SURTOUT UNE BORNE DE TEMPS. Le moteur local vectorise environ DEUX passages
 * par seconde : les 62 000 passages des dix-huit projets demandent près de neuf
 * heures la première fois. On s'arrête donc au bout de trois heures et on
 * reprend la nuit suivante, là où on s'était arrêté — l'index se complète en
 * trois nuits, et aucune ne déborde sur la journée. Les nuits d'après ne
 * revectorisent que ce qui a changé, donc quelques minutes.
 */
export const DUREE_MAX_PAR_NUIT_MS = 3 * 60 * 60 * 1000;

/**
 * DEUX PASSES, ET ELLES N'ONT PAS LE MÊME DROIT SUR LA MACHINE.
 *
 * `nuit` — dans la fenêtre de 1 h à 3 h : le grand rattrapage. Trois heures,
 * 120 tranches ; c'est elle qui absorbe un index neuf de dizaines de milliers de
 * passages, en autant de nuits qu'il faut.
 *
 * `jour` — les trois autres rendez-vous de la journée : le RATTRAPAGE COURT de
 * ce que les cartes viennent de modifier. Dix minutes, 15 tranches. Sur un
 * projet ordinaire, il n'a rien à faire et se termine en une seconde ; sur
 * HaikoDev après une matinée de cartes, quelques dizaines de passages, soit
 * moins d'une minute. Elle est volontairement COURTE : vectoriser ne prend la
 * place d'aucun agent, mais cela occupe les cœurs, et une passe de trois heures
 * en plein après-midi freinerait la machine pour un gain que la nuit obtiendra
 * de toute façon.
 */
export type AmpleurDeVectorisation = 'nuit' | 'jour';

/** Ce qu'une passe a le droit de consommer, selon son ampleur. */
export const BORNES_DE_VECTORISATION: Record<AmpleurDeVectorisation, { tranches: number; dureeMs: number }> = {
  nuit: { tranches: TRANCHES_MAX_PAR_NUIT, dureeMs: DUREE_MAX_PAR_NUIT_MS },
  jour: { tranches: 15, dureeMs: 10 * 60 * 1000 },
};

/** Pourquoi la vectorisation ne part pas cette fois-ci. */
export type RaisonSansVectorisation = 'deja-passe' | 'aucune-cle';

/** Le verdict du rendez-vous : partir — et avec quelle ampleur —, ou dire pourquoi non. */
export type DecisionDeVectorisation =
  | { lancer: true; ampleur: AmpleurDeVectorisation }
  | { lancer: false; raison: RaisonSansVectorisation };

/** Cette heure tombe-t-elle dans la fenêtre du rendez-vous ? */
export function heureDeVectorisation(heure: number): boolean {
  for (let pas = 0; pas < FENETRE_VECTORISATION_HEURES; pas += 1) {
    if ((HEURE_VECTORISATION + pas) % 24 === heure) return true;
  }
  return false;
}

/**
 * LE RENDEZ-VOUS A-T-IL LIEU MAINTENANT ?
 *
 * Deux refus seulement, et surtout PAS « un travail est en cours » : à la
 * différence de l'auto-amélioration, vectoriser n'appelle aucun moteur, ne prend
 * la place d'aucun agent et n'entame aucune réserve. Reporter la passe entière
 * parce qu'une carte tourne laisserait l'index à moitié fait, donc la recherche
 * en repli sur les mots — exactement ce qu'on cherche à quitter.
 *
 * « Ce n'est pas l'heure » a DISPARU des refus : le rendez-vous ne dépend plus
 * d'une heure mais d'un DÉLAI (six heures depuis la précédente). L'heure ne
 * décide plus que de l'AMPLEUR — grand rattrapage la nuit, passe courte le jour.
 */
export function decisionDeVectorisation(input: {
  clePosee: boolean;
  dernierPassage?: number;
  maintenant: number;
  heureCourante: number;
}): DecisionDeVectorisation {
  if (!input.clePosee) return { lancer: false, raison: 'aucune-cle' };
  if (input.dernierPassage !== undefined && input.maintenant - input.dernierPassage < PERIODE_VECTORISATION_MS) {
    return { lancer: false, raison: 'deja-passe' };
  }
  return { lancer: true, ampleur: heureDeVectorisation(input.heureCourante) ? 'nuit' : 'jour' };
}

/** La raison, écrite pour le journal du démon. */
export function raisonSansVectorisationDite(raison: RaisonSansVectorisation): string {
  switch (raison) {
    case 'deja-passe':
      return `la vectorisation est déjà passée il y a moins de ${PERIODE_VECTORISATION_MS / 3_600_000} heures`;
    case 'aucune-cle':
      return 'aucune clé de vectorisation posée : la recherche reste sur les mots';
  }
}

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
