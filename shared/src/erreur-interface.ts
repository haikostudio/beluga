/**
 * Ce qu'une erreur de la page devient en arrivant au serveur.
 *
 * Quand l'application blanchit sur un téléphone, il ne reste rien : la console
 * du navigateur ne s'ouvre pas, et le journal du démon ne sait rien de ce qui
 * s'est passé côté écran. La page remonte donc ses erreurs ; encore faut-il
 * qu'un envoi mal formé — ou un envoi qui n'a rien à voir — soit REFUSÉ, et
 * qu'une erreur bavarde ne remplisse pas le disque.
 *
 * Règles pures : ni base, ni disque, ni réseau. Le « quand » est injecté, car
 * c'est le SERVEUR qui date l'erreur : l'horloge d'un téléphone peut être
 * fausse de plusieurs heures, et un journal mal daté ne sert à rien.
 */

/**
 * D'où vient l'erreur. Trois chemins de panne, et `canal` : un geste qui n'est
 * jamais parti faute de lien. Ce n'est pas une exception, mais c'est la seule
 * trace qui dise POURQUOI le lien était coupé chez quelqu'un qu'on ne voit pas.
 */
export const SOURCES_ERREUR = ['affichage', 'fenetre', 'promesse', 'canal'] as const;
export type SourceErreur = (typeof SOURCES_ERREUR)[number];

/** Ce que la page envoie. Rien du projet : ni message, ni pièce jointe. */
export interface RapportErreur {
  source: SourceErreur;
  /** Le message de l'erreur — le seul champ obligatoire. */
  message: string;
  /** La pile d'appels, quand le navigateur la donne. */
  pile?: string;
  /** L'adresse de la page au moment de la panne. */
  url?: string;
  /** Ce que le navigateur déclare de lui-même (`navigator.userAgent`). */
  appareil?: string;
  /** Le panneau concerné, quand c'est le filet de sécurité qui parle. */
  zone?: string;
}

/** Une erreur rangée dans le journal : le rapport, daté par le serveur. */
export interface ErreurInterface extends RapportErreur {
  /** Quand le serveur l'a reçue. */
  at: number;
}

/** Au-delà, ce n'est plus un message d'erreur mais un fichier entier. */
export const ERREUR_LIMITES = {
  message: 500,
  pile: 4000,
  url: 500,
  appareil: 300,
  zone: 120,
} as const;

/** Ce que le journal garde : au-delà, les plus vieilles tombent. */
export const ERREURS_JOURNAL_MAX = 200;

/** Ce que le bloc des réglages montre par défaut. */
export const ERREURS_MONTREES_REGLAGES = 20;

/**
 * Combien d'erreurs une page remonte au plus, quoi qu'il arrive. Une erreur
 * qui se répète à chaque image de l'animation en produirait des milliers : le
 * compteur s'arrête là, et plus rien ne part avant le prochain chargement.
 */
export const ERREURS_MAX_PAR_PAGE = 12;

function borner(valeur: unknown, max: number): string | undefined {
  if (typeof valeur !== 'string') return undefined;
  const propre = valeur.replace(/\s+$/, '').trim();
  if (!propre) return undefined;
  return propre.length > max ? `${propre.slice(0, max)}…` : propre;
}

/**
 * Le portier du point d'entrée : un envoi qui n'a pas la forme attendue est
 * refusé EN LE DISANT, jamais rangé à moitié. Tout ce qui dépasse est coupé
 * plutôt que rejeté — une pile d'appels à rallonge reste une trace utile.
 */
export function jugerRapportErreur(
  brut: unknown,
  maintenant: number,
): { ok: true; erreur: ErreurInterface } | { ok: false; raison: string } {
  if (!brut || typeof brut !== 'object' || Array.isArray(brut)) {
    return { ok: false, raison: "L'envoi n'est pas un rapport d'erreur." };
  }
  const objet = brut as Record<string, unknown>;

  const source = objet.source;
  if (typeof source !== 'string' || !(SOURCES_ERREUR as readonly string[]).includes(source)) {
    return { ok: false, raison: `Origine inconnue : « ${String(source ?? '')} ».` };
  }

  const message = borner(objet.message, ERREUR_LIMITES.message);
  if (!message) return { ok: false, raison: "L'erreur n'a aucun message." };

  return {
    ok: true,
    erreur: {
      source: source as SourceErreur,
      message,
      pile: borner(objet.pile, ERREUR_LIMITES.pile),
      url: borner(objet.url, ERREUR_LIMITES.url),
      appareil: borner(objet.appareil, ERREUR_LIMITES.appareil),
      zone: borner(objet.zone, ERREUR_LIMITES.zone),
      at: maintenant,
    },
  };
}

/**
 * De quoi reconnaître deux fois la MÊME erreur. La page s'en sert pour ne pas
 * renvoyer dix fois la panne qui revient à chaque affichage.
 */
export function empreinteErreur(erreur: RapportErreur): string {
  const premiereLigne = (erreur.pile ?? '').split('\n')[0]?.trim() ?? '';
  return `${erreur.source}|${erreur.message}|${premiereLigne}`;
}

/** Une ligne du journal : du JSON, une erreur par ligne, relisible telle quelle. */
export function ligneDeJournal(erreur: ErreurInterface): string {
  return JSON.stringify(erreur);
}

/** L'inverse : une ligne abîmée est ignorée, jamais une exception. */
export function lireLigneDeJournal(ligne: string): ErreurInterface | null {
  const texte = ligne.trim();
  if (!texte) return null;
  try {
    const objet = JSON.parse(texte);
    const juge = jugerRapportErreur(objet, Number(objet?.at) || 0);
    if (!juge.ok) return null;
    return { ...juge.erreur, at: Number(objet.at) || juge.erreur.at };
  } catch {
    return null;
  }
}

/**
 * L'appareil, dit en français. `navigator.userAgent` est illisible ; ce qui
 * compte pour retrouver une panne, c'est « un iPhone sous Safari ».
 */
export function appareilEnClair(appareil?: string): string {
  const ua = appareil ?? '';
  if (!ua) return 'appareil inconnu';

  const machine = /iPhone/i.test(ua)
    ? 'iPhone'
    : /iPad/i.test(ua)
      ? 'iPad'
      : /Android/i.test(ua)
        ? 'Android'
        : /Windows/i.test(ua)
          ? 'Windows'
          : /Macintosh|Mac OS X/i.test(ua)
            ? 'Mac'
            : /Linux/i.test(ua)
              ? 'Linux'
              : 'appareil inconnu';

  // L'ordre compte : Chrome et Edge se déclarent aussi « Safari », et Edge se
  // déclare aussi « Chrome ». On va du plus précis au plus vague.
  const navigateur = /Edg\//i.test(ua)
    ? 'Edge'
    : /OPR\//i.test(ua)
      ? 'Opera'
      : /Firefox\//i.test(ua)
        ? 'Firefox'
        : /Chrome\//i.test(ua)
          ? 'Chrome'
          : /Safari\//i.test(ua)
            ? 'Safari'
            : '';

  return navigateur ? `${machine} · ${navigateur}` : machine;
}

/** D'où vient l'erreur, dit en français pour le bloc des réglages. */
export function origineEnClair(source: SourceErreur): string {
  if (source === 'affichage') return "Affichage interrompu";
  if (source === 'promesse') return 'Traitement en arrière-plan';
  if (source === 'canal') return 'Geste parti sans lien';
  return 'Erreur de la page';
}

/** Ce que le client sait de son lien au moment où un geste n'a pas pu partir. */
export interface EtatDuLienAuGeste {
  /** La commande refusée (son seul type : jamais son contenu). */
  commande: string;
  /** `readyState` du socket, ou null s'il n'y en a aucun (veille, avant la première ouverture). */
  etatDuSocket: number | null;
  coupeDepuis?: number | null;
  derniereFermeture?: { motif: string; code?: number; raison?: string; a: number } | null;
  derniereCommande?: { type: string; a: number } | null;
  dernierEvenementA?: number | null;
  enVeille: boolean;
  pageCachee: boolean;
  enLigne?: boolean;
  /**
   * Le geste a ATTENDU l'ouverture du canal tant de millisecondes avant de
   * renoncer (`client.call`, canal « en ouverture »). Présent, il dit que ce
   * n'est plus un simple chargement de page : la règle d'enquête le compte.
   */
  attenteMs?: number | null;
}

const ETATS_DU_SOCKET = ['en ouverture', 'ouvert', 'en fermeture', 'fermé'];

function ilYA(a: number | null | undefined, maintenant: number): string {
  return a ? `il y a ${Math.max(0, Math.round((maintenant - a) / 100) / 10)} s` : 'jamais';
}

/**
 * LE RAPPORT D'UN GESTE NON PARTI : de quoi conclure, après coup, ce qui avait
 * fermé le lien (code de fermeture, abandon par le battement, veille, réseau)
 * et depuis quand. Rien du projet : le TYPE de la commande, jamais son contenu.
 * Le message porte le type, pour qu'un même geste raté ne parte qu'une fois.
 */
export function rapportDuGesteNonParti(etat: EtatDuLienAuGeste, maintenant: number): RapportErreur {
  const fermeture = etat.derniereFermeture;
  const lignes = [
    `canal : ${etat.etatDuSocket == null ? 'aucun' : (ETATS_DU_SOCKET[etat.etatDuSocket] ?? String(etat.etatDuSocket))}`,
    `coupé depuis : ${ilYA(etat.coupeDepuis, maintenant)}`,
    `dernière fermeture : ${
      fermeture
        ? `${fermeture.motif}${fermeture.code != null ? ` (code ${fermeture.code}${fermeture.raison ? `, ${fermeture.raison}` : ''})` : ''} ${ilYA(fermeture.a, maintenant)}`
        : 'aucune'
    }`,
    `dernière commande envoyée : ${etat.derniereCommande ? `${etat.derniereCommande.type} ${ilYA(etat.derniereCommande.a, maintenant)}` : 'aucune'}`,
    `dernier message reçu : ${ilYA(etat.dernierEvenementA, maintenant)}`,
    `veille : ${etat.enVeille ? 'oui' : 'non'} · page cachée : ${etat.pageCachee ? 'oui' : 'non'} · réseau : ${etat.enLigne === false ? 'hors ligne' : 'en ligne'}`,
  ];
  if (etat.attenteMs != null) lignes.push(`attente de l’ouverture : ${Math.round(etat.attenteMs / 100) / 10} s`);
  return { source: 'canal', message: `geste non parti : ${etat.commande}`, pile: lignes.join('\n') };
}
