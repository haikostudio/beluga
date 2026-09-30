/**
 * LE CHAT FLOTTANT DE L'AGENT MARKETING : où il se pose, quelle taille il prend.
 *
 * Sa place est retenue PAR PROJET dans le compte (préférence serveur, comme le
 * module de voix), donc commune à tous les appareils : ouvert ou fermé, distance
 * aux bords droit et bas de la fenêtre, largeur et hauteur. Rien ne dépend d'un
 * navigateur : les règles se rejouent seules et bornent toujours le résultat à
 * l'écran actuel — une place venue d'un grand écran ne perd pas la fenêtre sur
 * un petit.
 */

export const CLE_CHAT_MARKETING = 'marketing-chat';

/** La clé de préférence d'un projet. */
export function cleChatMarketing(projectId: string): string {
  return `${CLE_CHAT_MARKETING}:${projectId}`;
}

/** Ce qu'on garde du bord de l'écran, en pixels, pour rester attrapable. */
export const MARGE_CHAT = 8;
/** Le bouton rond en bas à droite : le chat ouvert se pose juste au-dessus. */
export const ROND_CHAT = 48;
export const BAS_CHAT_DEFAUT = MARGE_CHAT + ROND_CHAT + 8 + 8;
export const LARGEUR_CHAT_MIN = 300;
export const LARGEUR_CHAT_MAX = 760;
export const HAUTEUR_CHAT_MIN = 320;
/** En dessous de cette largeur d'écran, le chat occupe presque tout l'écran. */
export const LARGEUR_TELEPHONE = 640;
/** La plus grande valeur croyable : au-delà, la préférence est partie à la dérive. */
const MAX_CROYABLE = 20_000;

export interface ChatFlottant {
  ouvert: boolean;
  /** Distance du bord droit de la fenêtre, en pixels. */
  droite: number;
  /** Distance du bord bas de la fenêtre, en pixels. */
  bas: number;
  largeur: number;
  hauteur: number;
}

export interface FenetreChat {
  width: number;
  height: number;
}

export const CHAT_FLOTTANT_DEFAUT: ChatFlottant = {
  ouvert: false,
  droite: MARGE_CHAT + 8,
  bas: BAS_CHAT_DEFAUT,
  largeur: 400,
  hauteur: 560,
};

function nombre(valeur: unknown, repli: number): number {
  return typeof valeur === 'number' && Number.isFinite(valeur) && Math.abs(valeur) <= MAX_CROYABLE ? valeur : repli;
}

function borner(valeur: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(max, Math.max(min, valeur));
}

/** Ce qui a été retenu, ramené à quelque chose d'utilisable (champ absent ou abîmé : le défaut). */
export function chatRetenu(valeur: unknown): ChatFlottant {
  if (!valeur || typeof valeur !== 'object') return CHAT_FLOTTANT_DEFAUT;
  const v = valeur as Partial<ChatFlottant>;
  return {
    ouvert: v.ouvert === true,
    droite: nombre(v.droite, CHAT_FLOTTANT_DEFAUT.droite),
    bas: nombre(v.bas, CHAT_FLOTTANT_DEFAUT.bas),
    largeur: nombre(v.largeur, CHAT_FLOTTANT_DEFAUT.largeur),
    hauteur: nombre(v.hauteur, CHAT_FLOTTANT_DEFAUT.hauteur),
  };
}

export function estTelephoneChat(fenetre: FenetreChat): boolean {
  return fenetre.width < LARGEUR_TELEPHONE;
}

/** En dessous de cette hauteur, un téléphone n'a plus la place d'un chat AVEC son décor. */
export const HAUTEUR_TELEPHONE_BASSE = 560;

/**
 * UN TÉLÉPHONE À L'ÉCRAN BAS : clavier ouvert (l'application installée rétrécit
 * alors la fenêtre), champ d'écriture agrandi par un saut de ligne. Le chat,
 * avec la barre d'avancement, son pied et le champ, ne laissait plus une ligne
 * au fil de la conversation : on ne voyait que la barre du haut. Dans ce cas le
 * chat prend TOUTE la fenêtre et rend au fil la place du décor.
 */
export function estTelephoneBas(fenetre: FenetreChat): boolean {
  return estTelephoneChat(fenetre) && fenetre.height < HAUTEUR_TELEPHONE_BASSE;
}

/**
 * Le chat tel qu'il s'AFFICHE dans cette fenêtre : taille bornée, place ramenée
 * dans les bords. Sur téléphone, il prend presque tout l'écran, au-dessus du
 * bouton rond. Ce résultat n'est jamais rangé : seule une action de
 * l'utilisateur écrit la préférence.
 */
export function chatVisible(etat: ChatFlottant, fenetre: FenetreChat, marge: number = MARGE_CHAT): ChatFlottant {
  if (estTelephoneBas(fenetre)) {
    return {
      ouvert: etat.ouvert,
      droite: marge,
      bas: marge,
      largeur: Math.max(0, fenetre.width - 2 * marge),
      hauteur: Math.max(0, fenetre.height - 2 * marge),
    };
  }
  if (estTelephoneChat(fenetre)) {
    return {
      ouvert: etat.ouvert,
      droite: marge,
      bas: BAS_CHAT_DEFAUT,
      largeur: Math.max(0, fenetre.width - 2 * marge),
      hauteur: Math.max(HAUTEUR_CHAT_MIN, fenetre.height - BAS_CHAT_DEFAUT - marge - 40),
    };
  }
  const largeur = borner(etat.largeur, LARGEUR_CHAT_MIN, Math.min(LARGEUR_CHAT_MAX, fenetre.width - 2 * marge));
  const hauteur = borner(etat.hauteur, HAUTEUR_CHAT_MIN, fenetre.height - 2 * marge);
  return {
    ouvert: etat.ouvert,
    largeur,
    hauteur,
    droite: borner(etat.droite, marge, fenetre.width - marge - largeur),
    bas: borner(etat.bas, marge, fenetre.height - marge - hauteur),
  };
}

/** Déplacer le chat : la fenêtre suit le pointeur (dx, dy en pixels d'écran). */
export function chatDeplace(depart: ChatFlottant, dx: number, dy: number, fenetre: FenetreChat): ChatFlottant {
  return chatVisible({ ...depart, droite: depart.droite - dx, bas: depart.bas - dy }, fenetre);
}

/**
 * Redimensionner par la poignée du coin HAUT GAUCHE : le coin bas droit reste
 * en place, la fenêtre grandit vers la gauche et vers le haut quand on tire
 * vers eux (dx, dy négatifs).
 */
export function chatRedimensionne(depart: ChatFlottant, dx: number, dy: number, fenetre: FenetreChat): ChatFlottant {
  return chatVisible({ ...depart, largeur: depart.largeur - dx, hauteur: depart.hauteur - dy }, fenetre);
}

