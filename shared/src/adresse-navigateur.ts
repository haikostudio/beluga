/**
 * L'écran courant, écrit dans l'adresse du navigateur après le « # ».
 *
 * Jusqu'ici la navigation ne vivait que dans l'état de l'application : recharger
 * la page ou copier l'adresse ne ramenait pas sur l'écran quitté. On ajoute donc
 * un fragment (« #projet/<id> », « #projet/<id>/tache/<id>-<slug> », etc.) qui
 * décrit l'écran et se relit au chargement comme aux boutons Précédent/Suivant.
 *
 * Deux règles tiennent tout :
 * — l'IDENTIFIANT reste la clé qui retrouve l'élément ; le slug du titre n'est
 *   là que pour l'œil humain et se jette à la lecture ;
 * — la persistance serveur (projet actif, carte ouverte) ne bouge pas : le
 *   fragment s'ajoute par-dessus, il ne la remplace pas.
 *
 * Ces décisions vivent ici, sans réseau ni base : elles se testent seules.
 */

/** L'écran décrit par l'adresse. Le projet peut porter une carte ouverte. */
export type EcranNavigateur =
  | { vue: 'accueil' }
  | { vue: 'reglages' }
  | { vue: 'tableau-de-bord' }
  | { vue: 'projet'; projectId: string; cardId?: string; titreCarte?: string };

/** Longueur maximale du slug décoratif : au-delà, l'adresse devient illisible. */
const SLUG_MAX = 60;

/** Un UUID en tête de segment : l'identifiant d'une carte, le reste est le slug. */
const UUID_EN_TETE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:-(.*))?$/i;

/**
 * Un slug lisible tiré d'un titre : minuscules, accents retirés, tout ce qui
 * n'est ni lettre ni chiffre remplacé par un tiret, longueur bornée. Purement
 * décoratif — jamais utilisé pour retrouver quoi que ce soit.
 */
export function slugTitre(titre: string): string {
  return titre
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX)
    .replace(/-+$/g, '');
}

/**
 * Le fragment (sans le « # ») qui décrit un écran. L'appelant y met le « # »
 * lui-même. Un écran d'accueil rend une chaîne vide.
 */
export function construireFragment(ecran: EcranNavigateur): string {
  switch (ecran.vue) {
    case 'reglages':
      return 'reglages';
    case 'tableau-de-bord':
      return 'tableau-de-bord';
    case 'projet': {
      if (!ecran.projectId) return '';
      const base = `projet/${encodeURIComponent(ecran.projectId)}`;
      if (!ecran.cardId) return base;
      const slug = ecran.titreCarte ? slugTitre(ecran.titreCarte) : '';
      const suffixe = slug ? `-${slug}` : '';
      return `${base}/tache/${encodeURIComponent(ecran.cardId)}${suffixe}`;
    }
    default:
      return '';
  }
}

/**
 * L'écran décrit par un fragment. On accepte le « # » de tête comme son absence.
 * Un fragment inconnu, vide ou abîmé rend l'accueil : l'adresse ne doit jamais
 * bloquer l'ouverture.
 */
export function lireFragment(hash: string): EcranNavigateur {
  const brut = (hash || '').replace(/^#/, '').replace(/^\/+/, '').trim();
  if (!brut) return { vue: 'accueil' };
  if (brut === 'reglages') return { vue: 'reglages' };
  if (brut === 'tableau-de-bord') return { vue: 'tableau-de-bord' };

  const morceaux = brut.split('/');
  if (morceaux[0] === 'projet' && morceaux[1]) {
    const projectId = decodeSegment(morceaux[1]);
    if (!projectId) return { vue: 'accueil' };
    if (morceaux[2] === 'tache' && morceaux[3]) {
      const cardId = idDeCarte(decodeSegment(morceaux[3]));
      if (cardId) return { vue: 'projet', projectId, cardId };
    }
    return { vue: 'projet', projectId };
  }

  return { vue: 'accueil' };
}

/**
 * Deux écrans mènent-ils au MÊME endroit ? On compare la vue et les
 * identifiants, jamais le slug : « #projet/42/tache/7-vieux-titre » et
 * « #projet/42/tache/7-nouveau-titre » sont le même écran.
 */
export function memeEcran(a: EcranNavigateur, b: EcranNavigateur): boolean {
  if (a.vue !== b.vue) return false;
  if (a.vue === 'projet' && b.vue === 'projet') {
    return a.projectId === b.projectId && (a.cardId ?? '') === (b.cardId ?? '');
  }
  return true;
}

/** Décode un segment d'adresse, en laissant l'original si le décodage échoue. */
function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/**
 * L'identifiant caché dans « <id>-<slug> ». Quand le segment commence par un
 * UUID, c'est lui la clé et le reste est décor ; sinon on prend le segment
 * entier (un identifiant d'une autre forme reste utilisable).
 */
function idDeCarte(segment: string): string {
  const trouve = UUID_EN_TETE.exec(segment);
  return trouve ? trouve[1] : segment;
}
