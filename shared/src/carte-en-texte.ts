/**
 * « Le chef a dit qu'il créait la tâche, et rien n'est apparu. »
 *
 * Une carte n'existe que par l'APPEL de l'outil `board_create_card` (ou
 * `propose_task`) : c'est lui qui affiche la proposition dans la conversation,
 * avec ses boutons « Valider » / « Refuser ». Rien n'oblige pourtant le moteur
 * à s'en servir — il lui suffit d'ÉCRIRE « j'ai créé la tâche » et de rendre
 * son tour. Le tour se termine normalement (code de sortie 0), aucune
 * proposition n'est enregistrée, et l'utilisateur attend une carte qui
 * n'arrivera jamais. Le défaut se voit surtout sur les petits modèles (Haiku),
 * qui préfèrent raconter l'action plutôt que de l'exécuter ; Sonnet, lui,
 * appelle l'outil.
 *
 * On ne peut pas empêcher un modèle d'écrire ce qu'il veut. On peut le
 * RECONNAÎTRE : un tour du chef qui ANNONCE une carte sans qu'aucune
 * proposition ne soit née est un tour à refaire.
 *
 * LE PREMIER FILET NE SUFFISAIT PAS, et les messages gardés en base disent
 * pourquoi. Deux trous, mesurés sur de vraies réponses :
 *
 *   1. LA FORME LA PLUS FRÉQUENTE N'ÉTAIT PAS RECONNUE. Le modèle n'annonce
 *      pas toujours « j'ai créé la tâche » : le plus souvent, il RECOPIE la
 *      carte, en bloc, sous un intertitre — « ## Carte proposée », puis un
 *      titre en gras, un paragraphe, « Niveau : Standard ». Aucun verbe, donc
 *      aucune détection, donc aucune relance : le filet ne se déclenchait même
 *      pas. On reconnaît désormais ce BLOC autant que la phrase.
 *   2. UNE SEULE RELANCE, ET AUCUN RECOURS. Quand elle partait, elle demandait
 *      l'appel sans rappeler ce que l'outil EXIGE d'une description : le modèle
 *      rappelait l'outil, se faisait refuser sa description trop maigre, et
 *      renonçait — tour rendu, toujours aucune carte. La relance rappelle donc
 *      le gabarit, elle a droit à un SECOND essai, et surtout…
 *
 * …LE DERNIER MOT REVIENT AU DÉMON, PAS AU MODÈLE. Quand la réponse DÉCRIT une
 * carte (un titre, un texte, parfois un niveau), HaikoDev la reconstruit et
 * appelle l'outil LUI-MÊME : `carteDecriteEnTexte` lit le bloc, le démon pose
 * la proposition. Rien n'est forcé sur le tableau pour autant — une proposition
 * reste une proposition, avec ses boutons « Valider » / « Refuser » : c'est
 * toujours le clic de l'utilisateur qui fait naître la carte. Le seul cas qui
 * finit encore en avertissement est celui où la réponse ne décrit AUCUNE carte
 * exploitable ; là, mieux vaut le dire que d'inventer.
 *
 * La règle vit ici, sans base ni réseau : elle se teste seule.
 */

/** L'ÉTAPE VISIBLE dans la conversation quand le démon rattrape ce tour-là. */
export const ETAPE_CARTE = 'Carte réellement proposée';
export const ETAPE_CARTE_ID = 'carte-appel-outil';

/** Minuscules, sans accent, espaces et apostrophes normalisés. */
function aplati(texte: string): string {
  return texte
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * CE QU'UNE ANNONCE DE CARTE RESSEMBLE, une fois le texte aplati.
 *
 * Le verbe et le nom sont exigés ENSEMBLE, avec au plus quelques mots entre
 * eux : « j'ai créé la carte », « je crée une tâche », « la tâche a été
 * ajoutée au tableau », « voici la carte proposée ». Une phrase qui parle de
 * cartes sans en annoncer une (« les cartes se valident d'un clic ») ne
 * déclenche rien.
 */
const ANNONCES: RegExp[] = [
  /\b(j ai|je viens de|nous avons) (bien )?(cree|creee|creer|ajoute|ajoutee|ajouter|pose|posee|poser|propose|proposee|proposer|enregistre|enregistree|enregistrer)( [a-z0-9]+){0,3} (carte|tache)\b/,
  /\b(je|nous) (cree|creons|propose|proposons|ajoute|ajoutons)( [a-z0-9]+){0,3} (carte|tache)\b/,
  /\b(je vais|on va) (creer|proposer|ajouter)( [a-z0-9]+){0,3} (carte|tache)\b/,
  /\b(la |une |cette |votre |ta )?(carte|tache) (a ete|est|vient d etre) (bien )?(creee|cree|ajoutee|posee|proposee|enregistree)\b/,
  /\b(carte|tache) (creee|proposee|ajoutee) (dans|au|sur|a) (la conversation|le tableau|planifie)\b/,
  /\bvoici (la |une |ta |votre )?(carte|tache) (proposee|creee|que je propose)\b/,
];

/*
 * CE QUI DÉSANNONCE une carte. « Aucune carte créée : tu cherches une
 * correction », « je ne propose pas de carte ici » parlent de cartes pour dire
 * qu'il n'y en a pas : la phrase est écartée avant d'être jugée.
 */
const NEGATIONS: RegExp[] = [
  /\b(aucune|pas de|sans|ni) (carte|tache)\b/,
  /\bje ne (cree|creerai|propose|proposerai|vais)\b/,
  /\brien a (creer|proposer)\b/,
];

/**
 * Le texte enlevé de sa mise en forme Markdown : gras, italique, intertitres,
 * puces et citations. Ce qui reste est la PHRASE, celle qu'on montre dans
 * l'étape.
 */
function nue(ligne: string): string {
  return ligne.replace(/^[\s>#*_\-•]+/, '').replace(/[*_`]/g, '').trim();
}

/*
 * LA CARTE RECOPIÉE EN BLOC — la forme la plus fréquente, et celle qui passait
 * entre les mailles. Le modèle n'annonce rien : il ÉCRIT la carte, sous un
 * intertitre (« ## Carte proposée », « **Proposition de carte**», « Carte :»),
 * suivie d'un titre et d'un paragraphe. Aucun verbe, donc aucune des ANNONCES
 * ci-dessus ne s'y retrouvait.
 *
 * On exige une ligne COURTE — un intertitre, pas une phrase perdue au milieu
 * d'un paragraphe — qui annonce la carte et rien d'autre.
 */
const ENTETES_DE_BLOC: RegExp[] = [
  /^(carte|tache) (proposee|a valider|suggeree|pour cette demande|a creer)\b/,
  /^proposition de (carte|tache)\b/,
  /^(carte|tache)\s*$/,
];

/** La ligne d'un CHAMP écrit à la main : « **Titre** : … », « Niveau : … ». */
function champEcrit(ligne: string, nom: string): string | null {
  const motif = new RegExp(`^\\**\\s*${nom}\\s*\\**\\s*:\\s*(.*)$`, 'i');
  const trouve = motif.exec(nue(ligne));
  return trouve ? trouve[1].trim() : null;
}

/** Les lignes du texte, débarrassées des blocs de code. */
function lignesUtiles(texte: string): string[] {
  return (texte ?? '').replace(/```[\s\S]*?```/g, '\n').split('\n');
}

/**
 * La réponse RECOPIE-t-elle une carte en bloc ? On rend la ligne d'entête —
 * ou `null`. Un bloc de champs nommés (« Titre : … » puis « Niveau : … »)
 * compte autant qu'un intertitre : c'est la même carte écrite au lieu d'être
 * appelée.
 */
function estUnEntete(ligne: string, maxSignes: number): boolean {
  const propre = nue(ligne);
  if (!propre || propre.length > maxSignes) return false;
  const plat = aplati(propre.replace(/[:\s]+$/, ''));
  if (NEGATIONS.some((motif) => motif.test(plat))) return false;
  return ENTETES_DE_BLOC.some((motif) => motif.test(plat));
}

/**
 * La ligne d'entête vue par la DÉTECTION : elle peut porter une queue de
 * phrase (« Carte proposée pour ce défaut d'affichage »), c'est encore une
 * annonce.
 */
const LARGEUR_ANNONCE = 80;

/**
 * Celle vue par l'EXTRACTION, bien plus étroite : pour que ce qui SUIT soit le
 * titre de la carte, l'entête doit être un intertitre NU (« Carte proposée »,
 * « Proposition de carte »), pas une phrase qui se termine sur elle-même.
 */
const LARGEUR_ENTETE = 40;

export function carteEcriteEnBloc(texte: string): string | null {
  const lignes = lignesUtiles(texte);
  for (const ligne of lignes) {
    if (estUnEntete(ligne, LARGEUR_ANNONCE)) return nue(ligne).slice(0, 300);
  }
  const titre = lignes.find((l) => champEcrit(l, 'titre') !== null);
  const autre = lignes.some((l) => champEcrit(l, 'niveau') !== null || champEcrit(l, 'description') !== null);
  return titre && autre ? nue(titre).slice(0, 300) : null;
}

/**
 * Le texte d'un tour du chef ANNONCE-t-il une carte ? On rend la phrase
 * fautive — c'est elle qu'on montre dans l'étape — ou `null`.
 *
 * On regarde phrase par phrase : une réponse longue ne doit pas voir ses mots
 * se rapprocher par hasard d'un bout à l'autre d'un paragraphe. Puis, à défaut
 * de phrase, on cherche la carte RECOPIÉE en bloc.
 */
export function carteAnnonceeEnTexte(texte: string): string | null {
  const propre = (texte ?? '').replace(/```[\s\S]*?```/g, ' ');
  for (const phrase of propre.split(/(?<=[.!?\n])/)) {
    const propre2 = nue(phrase);
    if (!propre2) continue;
    const plat = aplati(propre2);
    if (NEGATIONS.some((motif) => motif.test(plat))) continue;
    if (ANNONCES.some((motif) => motif.test(plat))) return propre2.slice(0, 300);
  }
  return carteEcriteEnBloc(texte);
}

/** L'état d'un tour, réduit à ce qui décide d'une relance. */
export interface TourDuChefAJuger {
  /** Le rôle de l'agent : seul le chef d'orchestre propose des cartes. */
  role: string;
  /** Le mode de la conversation : en « plan », aucune carte n'est attendue. */
  mode?: 'direct' | 'plan';
  /** Le tour est-il tombé (panne, quota, arrêt) ? On ne relance alors rien. */
  echec?: boolean;
  /** Des propositions déjà nées pendant ce tour : l'outil a servi. */
  propositions?: number;
  /** Le texte rendu. */
  texte: string;
}

/**
 * Ce tour doit-il être REFAIT parce que la carte n'a été qu'écrite ? On rend la
 * phrase fautive, ou `null` quand il n'y a rien à rattraper.
 *
 * Ce qui l'écarte, dans l'ordre : un agent qui n'est pas le chef, le mode plan
 * (où la carte est justement interdite), un tour tombé — le texte y est
 * tronqué, et le rattrapage viendra du nouvel essai —, et un tour qui porte
 * DÉJÀ une proposition : l'outil a servi, la phrase est vraie.
 */
export function carteAnnonceeSansOutil(tour: TourDuChefAJuger): string | null {
  if (tour.role !== 'orchestrator') return null;
  if (tour.mode === 'plan') return null;
  if (tour.echec) return null;
  if (tour.propositions) return null;
  return carteAnnonceeEnTexte(tour.texte);
}

/**
 * LA CONSIGNE DE RELANCE : un tour court, dans la même session, qui ne demande
 * qu'une chose — l'appel d'outil que le tour précédent a raconté au lieu de le
 * faire. Le chef a encore la demande et sa propre réponse sous les yeux : il ne
 * relit rien.
 */
export function consigneDeCarteReelle(phrase: string): string {
  return [
    'RATTRAPAGE — TA RÉPONSE ANNONCE UNE CARTE QUI N\'EXISTE PAS.',
    `Tu viens d'écrire : « ${phrase} » — mais tu n'as appelé AUCUN outil, donc rien ne s'est affiché et l'utilisateur attend une carte qui n'arrivera jamais.`,
    'UNE CARTE N\'EXISTE QUE PAR L\'APPEL DE L\'OUTIL. Appelle MAINTENANT « board_create_card » avec le titre, la description et le niveau de la carte que tu viens de décrire. Une seule carte, celle-là.',
    'Ne réponds RIEN d\'autre : pas d\'explication, pas de recopie de la carte en texte, aucune question. L\'appel d\'outil, puis une phrase de dix mots au plus.',
  ].join('\n');
}

/**
 * L'AVERTISSEMENT ajouté à la réponse quand même la relance n'a rien donné :
 * mieux vaut dire qu'aucune carte n'est née que laisser la phrase du moteur
 * faire croire le contraire.
 */
export const AVERTISSEMENT_SANS_CARTE =
  "\n\n> [!WARNING]\n> Aucune carte n'a réellement été proposée pour cette demande : la réponse l'annonçait sans passer par l'outil, les deux reprises n'ont rien donné et le texte ne décrivait aucune carte à reprendre. Redemandez la carte.";

/* ------------------------------------------------------------------ */
/* LE DERNIER MOT AU DÉMON : la carte RELUE dans le texte du chef       */
/* ------------------------------------------------------------------ */

/**
 * Ce qu'on arrive à relire d'une carte écrite en texte. C'est assez pour
 * appeler `board_create_card` à la place du modèle : titre, description, et le
 * niveau quand il est dit.
 */
export interface CarteRelue {
  titre: string;
  description: string;
  niveau?: string;
}

/** Au-delà, ce n'est plus un titre mais un paragraphe. */
const MAX_SIGNES_TITRE = 160;

/*
 * Les champs qu'on relit SÉPARÉMENT, et qui ne doivent donc pas se retrouver
 * une seconde fois dans la description. La liste est volontairement courte :
 * « À faire : … », « Objectif : … », « Étapes : … » PORTENT la description, ils
 * ne l'annoncent pas — les retirer viderait la carte.
 */
const CHAMPS_META = ['titre', 'description', 'niveau', 'étiquettes', 'etiquettes', 'labels'];

/** Vrai quand la ligne n'est qu'un champ déjà relu ailleurs. */
function estUnChampMeta(ligne: string): boolean {
  return CHAMPS_META.some((nom) => champEcrit(ligne, nom) !== null);
}

/*
 * Ce qui ne peut pas servir de titre : une ligne vide, un trait de séparation,
 * un encadré du démon (« > [!WARNING] … », ajouté APRÈS coup) ou une ligne de
 * citation. Sans ce garde-fou, le titre relu pouvait être l'avertissement
 * lui-même.
 */
function estUnTitrePossible(ligne: string): boolean {
  if (/^\s*>/.test(ligne)) return false;
  const propre = nue(ligne);
  if (!propre) return false;
  if (/^\[!/.test(propre)) return false;
  if (/^[-=_—\s]+$/.test(propre)) return false;
  return true;
}

/** Le titre débarrassé de sa ponctuation d'annonce et de sa longueur. */
function titrePropre(brut: string): string {
  const sansGuillemets = nue(brut)
    .replace(/^[«"']\s*/, '')
    .replace(/\s*[»"']\s*$/, '')
    .replace(/\s*[:.]$/, '')
    .trim();
  if (sansGuillemets.length <= MAX_SIGNES_TITRE) return sansGuillemets;
  // Un paragraphe en guise de titre : on garde sa première phrase, coupée net.
  const premiere = sansGuillemets.split(/(?<=[.!?])\s/)[0] ?? sansGuillemets;
  return premiere.slice(0, MAX_SIGNES_TITRE).trim();
}

/**
 * La DESCRIPTION tirée des lignes qui suivent le titre : le champ
 * « Description » s'il est écrit, puis tout le reste du bloc — les champs déjà
 * relus en moins, la carte n'ayant pas à redire son propre niveau.
 */
function descriptionDuBloc(lignes: string[]): string {
  const champ = lignes.map((l) => champEcrit(l, 'description')).find((v) => v) ?? '';
  const reste = lignes.filter((l) => !estUnChampMeta(l)).join('\n').trim();
  return [champ, reste].filter(Boolean).join('\n\n').trim();
}

/**
 * RELIRE LA CARTE QUE LE CHEF A ÉCRITE AU LIEU DE L'APPELER.
 *
 * Deux formes, dans cet ordre : les CHAMPS nommés (« Titre : … »,
 * « Description : … », « Niveau : … »), puis le BLOC posé sous un intertitre
 * (« ## Carte proposée », un titre, un paragraphe). On rend `null` quand la
 * réponse ne décrit aucune carte exploitable — le démon n'invente pas de carte
 * à partir d'une phrase en l'air.
 */
export function carteDecriteEnTexte(texte: string): CarteRelue | null {
  const lignes = lignesUtiles(texte);
  const niveau = lignes.map((l) => champEcrit(l, 'niveau')).find((v) => v) ?? undefined;

  /* 1. Les champs nommés, où qu'ils soient dans la réponse. */
  const titreChamp = lignes.map((l) => champEcrit(l, 'titre')).find((v) => v);
  if (titreChamp) {
    const iTitre = lignes.findIndex((l) => champEcrit(l, 'titre'));
    const description = descriptionDuBloc(lignes.slice(iTitre + 1));
    if (description) return { titre: titrePropre(titreChamp), description, niveau };
  }

  /* 2. Le bloc posé sous son intertitre. */
  const iEntete = lignes.findIndex((ligne) => estUnEntete(ligne, LARGEUR_ENTETE));
  if (iEntete < 0) return null;
  const bloc = lignes.slice(iEntete + 1);
  const iPremiere = bloc.findIndex((l) => estUnTitrePossible(l));
  if (iPremiere < 0) return null;
  const titre = titrePropre(bloc[iPremiere]);
  const description = descriptionDuBloc(bloc.slice(iPremiere + 1));
  if (!titre || !description) return null;
  return { titre, description, niveau };
}

/**
 * LE DERNIER RAPPEL — la seconde relance, quand la première n'a rien donné.
 *
 * Elle dit ce que la première taisait : pourquoi l'appel a pu ÉCHOUER. Neuf
 * fois sur dix, l'outil a refusé la description (trop maigre, ou renvoyant à la
 * conversation) et le modèle a renoncé au lieu de la réécrire. On lui rend donc
 * l'exigence en clair, avec le plancher, et on lui interdit de répondre autre
 * chose qu'un appel d'outil.
 */
export function consigneDeDernierRappel(minimumSignes: number): string {
  return [
    "DERNIER RAPPEL — IL N'Y A TOUJOURS AUCUNE CARTE.",
    "Ta relance précédente n'a pas fait naître de proposition : soit tu n'as pas appelé l'outil, soit il a REFUSÉ ta description et tu n'as pas réécrit.",
    `APPELLE « board_create_card » MAINTENANT, avec : « title » (une ligne), « description » (au moins ${minimumSignes} signes, la demande reformulée dans tes mots, le sujet NOMMÉ en toutes lettres — jamais « ce qui a été discuté »), « niveau » (« leger », « standard » ou « approfondi »).`,
    "Si l'outil te répond « REFUSÉE », relis ce qu'il réclame et RAPPELLE-LE aussitôt avec une description corrigée. N'abandonne pas et n'écris pas la carte en texte : le texte n'affiche rien.",
    'Aucune autre réponse : les appels d’outil, puis une phrase de dix mots au plus.',
  ].join('\n');
}
