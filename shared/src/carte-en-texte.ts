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
 * proposition ne soit née est un tour à refaire. Le démon relance alors le chef
 * une fois, dans la même session, en lui demandant l'appel d'outil et rien
 * d'autre — et si la relance ne donne toujours rien, la réponse le DIT au lieu
 * de laisser croire à une carte posée.
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

/**
 * Le texte d'un tour du chef ANNONCE-t-il une carte ? On rend la phrase
 * fautive — c'est elle qu'on montre dans l'étape — ou `null`.
 *
 * On regarde phrase par phrase : une réponse longue ne doit pas voir ses mots
 * se rapprocher par hasard d'un bout à l'autre d'un paragraphe.
 */
export function carteAnnonceeEnTexte(texte: string): string | null {
  const propre = (texte ?? '').replace(/```[\s\S]*?```/g, ' ');
  for (const phrase of propre.split(/(?<=[.!?\n])/)) {
    const nue = phrase.replace(/[*_`>#]/g, '').trim();
    if (!nue) continue;
    const plat = aplati(nue);
    if (ANNONCES.some((motif) => motif.test(plat))) return nue.slice(0, 300);
  }
  return null;
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
  "\n\n> [!WARNING]\n> Aucune carte n'a réellement été proposée pour cette demande : la réponse l'annonçait sans passer par l'outil, et la reprise n'a pas abouti. Redemandez la carte.";
