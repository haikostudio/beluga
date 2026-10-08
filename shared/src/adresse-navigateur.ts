/**
 * L'écran courant, écrit dans l'adresse du navigateur après le « # ».
 *
 * Jusqu'ici la navigation ne vivait que dans l'état de l'application : recharger
 * la page ou copier l'adresse ne ramenait pas sur l'écran quitté. On ajoute donc
 * un fragment (« #projet/<id> », « #projet/<id>/tache/<id>-<slug> », etc.) qui
 * décrit l'écran et se relit au chargement comme aux boutons Précédent/Suivant.
 *
 * DEPUIS « ADRESSES PROPRES À CHAQUE ÉCRAN » : le fragment ne décrit plus trois
 * destinations mais les HUIT vues centrales (`vue-centrale.ts`) et, d'un cran
 * plus bas, l'ÉLÉMENT ouvert dans chacune — une fiche du coffre, une note, une
 * unité de mémoire, un site surveillé ou sauvegardé, un onglet de carte.
 *
 * Trois règles tiennent tout :
 * — l'IDENTIFIANT reste la clé qui retrouve l'élément ; le slug du titre n'est
 *   là que pour l'œil humain et se jette à la lecture ;
 * — la persistance serveur (projet actif, carte ouverte) ne bouge pas : le
 *   fragment s'ajoute par-dessus, il ne la remplace pas ;
 * — un fragment inconnu, vide ou abîmé rend l'accueil : l'adresse ne bloque
 *   JAMAIS l'ouverture de l'application.
 *
 * CONTRAINTE DURE : les fragments produits pour les courriels déjà envoyés
 * (« espace/<client> », « espace/<client>/demande/<id> »,
 * « projet/<id>/demande/<id> », « discussion ») restent identiques au signe
 * près — un lien parti ne casse pas. Le test `adresse-navigateur.test.ts` les
 * fige.
 *
 * Ces décisions vivent ici, sans réseau ni base : elles se testent seules.
 */

import { VUES_CENTRALES, type VueCentrale } from './vue-centrale.js';
import { RUBRIQUE_CONFIG_PAR_DEFAUT } from './config-projet-rubriques.js';

/**
 * L'écran décrit par l'adresse. Chaque vue porte, quand il y en a un,
 * l'ÉLÉMENT ouvert à l'intérieur : c'est lui qu'on partage, lui que vise une
 * notification.
 */
export type EcranNavigateur =
  | { vue: 'accueil' }
  | { vue: 'reglages'; page?: string }
  | { vue: 'tableau-de-bord' }
  | { vue: 'en-route' }
  /* Un projet, sa carte ouverte, et l'onglet affiché dans cette carte. */
  | { vue: 'projet'; projectId: string; cardId?: string; titreCarte?: string; onglet?: string }
  /*
   * LA CONFIGURATION D'UN PROJET, OUVERTE SUR UNE RUBRIQUE. Même nature que
   * « reglages » : une couche posée PAR-DESSUS l'écran en cours, à ceci près
   * qu'elle nomme le projet qu'elle configure — un lien collé dans un onglet
   * neuf doit ouvrir LE BON projet avant d'ouvrir sa fenêtre.
   */
  | { vue: 'config-projet'; projectId: string; rubrique?: string }
  | { vue: 'notes'; noteId?: string }
  | { vue: 'coffre'; ficheId?: string }
  /*
   * La mémoire : la PORTÉE (le classeur d'un projet, ou le global), la fiche
   * de rangement, puis l'unité consultée. La portée fait partie de l'adresse
   * parce que deux classeurs portent les mêmes noms de fiches (« 05 »,
   * « conventions ») : sans elle, un lien tomberait dans le mauvais classeur.
   */
  | { vue: 'memoire'; porteeId?: string; ficheId?: string; uniteId?: string }
  | { vue: 'backups'; siteId?: string }
  | { vue: 'surveillance'; siteId?: string }
  /* L'atelier marketing, ouvert sur UN projet : « #marketing/<projet> ». */
  | { vue: 'marketing'; projectId?: string }
  /* Le Studio, ouvert sur UNE création : « #studio/<création> ». */
  | { vue: 'studio'; creationId?: string }
  /* Le service Statistiques, ouvert sur UN site mesuré : « #statistiques/<espace> ». */
  | { vue: 'statistiques'; siteId?: string }
  /*
   * L'ESPACE CLIENT, OUVERT SUR UNE FICHE. C'est l'adresse que portent les
   * courriels envoyés à Haiko : un clic doit tomber sur le bon client ET la
   * bonne demande, prêt à répondre — pas sur un tableau à refouiller.
   */
  | { vue: 'espace'; clientId?: string; demandeId?: string };

/** La vue d'adresse qui correspond à chaque destination de la colonne. */
const VUE_DE_LA_DESTINATION: Record<VueCentrale, EcranNavigateur['vue']> = {
  projet: 'projet',
  'tableau-de-bord': 'tableau-de-bord',
  'en-route': 'en-route',
  notes: 'notes',
  coffre: 'coffre',
  memoire: 'memoire',
  /* « espace-client » s'écrit « espace » dans l'adresse : c'est le mot que
     portent les courriels déjà partis, il ne bouge pas. */
  'espace-client': 'espace',
  backups: 'backups',
  surveillance: 'surveillance',
  marketing: 'marketing',
  studio: 'studio',
  statistiques: 'statistiques',
};

/** Et le chemin inverse, calculé une fois plutôt que réécrit à la main. */
const DESTINATION_DE_LA_VUE = Object.fromEntries(
  (VUES_CENTRALES as readonly VueCentrale[]).map((vue) => [VUE_DE_LA_DESTINATION[vue], vue]),
) as Record<string, VueCentrale | undefined>;

/**
 * LA DESTINATION DE LA COLONNE DE GAUCHE qu'un écran occupe. « accueil » et
 * « reglages » n'en désignent aucune : le premier laisse le choix au dernier
 * projet consulté, le second est une couche posée PAR-DESSUS l'écran courant.
 */
export function destinationDeLEcran(ecran: EcranNavigateur): VueCentrale | null {
  /* La configuration d'un projet se pose PAR-DESSUS le tableau de ce projet :
     sa destination est donc bien « projet », et non « rien ». C'est ce qui
     fait qu'un lien collé ouvre le bon tableau sous la fenêtre. */
  if (ecran.vue === 'config-projet') return 'projet';
  return DESTINATION_DE_LA_VUE[ecran.vue] ?? null;
}

/** L'onglet sur lequel une carte s'ouvre : la conversation, toujours. */
export const ONGLET_DE_CARTE_PAR_DEFAUT = 'chat';

/** Le classeur sur lequel la mémoire s'ouvre : le global, toujours. */
export const PORTEE_DE_MEMOIRE_PAR_DEFAUT = 'global';

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
      // La SOUS-PAGE des réglages est dans l'adresse : les réglages sont un
      // menu de pages, un lien doit pouvoir en désigner une.
      return ecran.page ? `reglages/${encodeURIComponent(ecran.page)}` : 'reglages';
    case 'tableau-de-bord':
      return 'tableau-de-bord';
    case 'en-route':
      return 'en-route';
    case 'notes':
      return ecran.noteId ? `notes/${encodeURIComponent(ecran.noteId)}` : 'notes';
    case 'coffre':
      return ecran.ficheId ? `coffre/${encodeURIComponent(ecran.ficheId)}` : 'coffre';
    case 'memoire': {
      /* Du plus large au plus précis — classeur, fiche, unité — et chaque cran
         est facultatif : « #memoire » seul ouvre la mémoire telle quelle. */
      const morceaux = ['memoire'];
      if (ecran.porteeId) morceaux.push('portee', encodeURIComponent(ecran.porteeId));
      if (ecran.ficheId) morceaux.push('fiche', encodeURIComponent(ecran.ficheId));
      if (ecran.uniteId) morceaux.push('unite', encodeURIComponent(ecran.uniteId));
      return morceaux.join('/');
    }
    case 'backups':
      return ecran.siteId ? `backups/${encodeURIComponent(ecran.siteId)}` : 'backups';
    case 'surveillance':
      return ecran.siteId ? `surveillance/${encodeURIComponent(ecran.siteId)}` : 'surveillance';
    case 'marketing':
      return ecran.projectId ? `marketing/${encodeURIComponent(ecran.projectId)}` : 'marketing';
    case 'studio':
      return ecran.creationId ? `studio/${encodeURIComponent(ecran.creationId)}` : 'studio';
    case 'statistiques':
      return ecran.siteId ? `statistiques/${encodeURIComponent(ecran.siteId)}` : 'statistiques';
    case 'espace': {
      if (!ecran.clientId) return 'espace';
      const base = `espace/${encodeURIComponent(ecran.clientId)}`;
      return ecran.demandeId ? `${base}/demande/${encodeURIComponent(ecran.demandeId)}` : base;
    }
    case 'config-projet': {
      if (!ecran.projectId) return '';
      const base = `projet/${encodeURIComponent(ecran.projectId)}/config`;
      /* LA RUBRIQUE PAR DÉFAUT NE S'ÉCRIT PAS : l'écrire allongerait l'adresse
         sans rien apprendre, et poserait DEUX entrées d'historique à
         l'ouverture — « …/config », puis « …/config/general » juste après. */
      return ecran.rubrique && ecran.rubrique !== RUBRIQUE_CONFIG_PAR_DEFAUT
        ? `${base}/${encodeURIComponent(ecran.rubrique)}`
        : base;
    }
    case 'projet': {
      if (!ecran.projectId) return '';
      const base = `projet/${encodeURIComponent(ecran.projectId)}`;
      if (!ecran.cardId) return base;
      const slug = ecran.titreCarte ? slugTitre(ecran.titreCarte) : '';
      const suffixe = slug ? `-${slug}` : '';
      const carte = `${base}/tache/${encodeURIComponent(ecran.cardId)}${suffixe}`;
      // L'ONGLET N'EST DANS L'ADRESSE QUE S'IL N'EST PAS LE PREMIER : « chat »
      // est le point d'entrée par défaut, l'écrire n'apprendrait rien et
      // allongerait toutes les adresses de carte déjà partagées.
      return ecran.onglet && ecran.onglet !== ONGLET_DE_CARTE_PAR_DEFAUT
        ? `${carte}/${encodeURIComponent(ecran.onglet)}`
        : carte;
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

  const morceaux = brut.split('/');
  const tete = morceaux[0];
  if (tete === 'reglages') {
    // Une page inconnue n'est pas une panne : la modale retombera sur sa
    // première page plutôt que d'afficher un vide.
    const page = decodeSegment(morceaux[1] ?? '');
    return page ? { vue: 'reglages', page } : { vue: 'reglages' };
  }
  if (tete === 'tableau-de-bord') return { vue: 'tableau-de-bord' };
  if (tete === 'en-route') return { vue: 'en-route' };
  if (tete === 'notes') {
    const noteId = decodeSegment(morceaux[1] ?? '');
    return noteId ? { vue: 'notes', noteId } : { vue: 'notes' };
  }
  if (tete === 'coffre') {
    const ficheId = decodeSegment(morceaux[1] ?? '');
    return ficheId ? { vue: 'coffre', ficheId } : { vue: 'coffre' };
  }
  if (tete === 'memoire') {
    /*
     * Des paires « mot/valeur » lues dans l'ordre où elles viennent : un cran
     * absent ne décale pas les suivants, et un mot inconnu est simplement
     * ignoré. « memoire/unite/DEC-024 » reste donc lisible sans sa fiche.
     */
    const lu: { porteeId?: string; ficheId?: string; uniteId?: string } = {};
    for (let i = 1; i < morceaux.length; i += 2) {
      const valeur = decodeSegment(morceaux[i + 1] ?? '');
      if (!valeur) continue;
      if (morceaux[i] === 'portee') lu.porteeId = valeur;
      if (morceaux[i] === 'fiche') lu.ficheId = valeur;
      if (morceaux[i] === 'unite') lu.uniteId = valeur;
    }
    return { vue: 'memoire', ...lu };
  }
  if (tete === 'backups') {
    const siteId = decodeSegment(morceaux[1] ?? '');
    return siteId ? { vue: 'backups', siteId } : { vue: 'backups' };
  }
  if (tete === 'surveillance') {
    const siteId = decodeSegment(morceaux[1] ?? '');
    return siteId ? { vue: 'surveillance', siteId } : { vue: 'surveillance' };
  }
  if (tete === 'marketing') {
    const projectId = decodeSegment(morceaux[1] ?? '');
    return projectId ? { vue: 'marketing', projectId } : { vue: 'marketing' };
  }
  if (tete === 'studio') {
    const creationId = decodeSegment(morceaux[1] ?? '');
    return creationId ? { vue: 'studio', creationId } : { vue: 'studio' };
  }
  if (tete === 'statistiques') {
    const siteId = decodeSegment(morceaux[1] ?? '');
    return siteId ? { vue: 'statistiques', siteId } : { vue: 'statistiques' };
  }
  if (tete === 'espace') {
    const clientId = decodeSegment(morceaux[1] ?? '');
    const demandeId = morceaux[2] === 'demande' ? decodeSegment(morceaux[3] ?? '') : '';
    return {
      vue: 'espace',
      ...(clientId ? { clientId } : {}),
      ...(demandeId ? { demandeId } : {}),
    };
  }
  if (tete === 'projet' && morceaux[1]) {
    const projectId = decodeSegment(morceaux[1]);
    if (!projectId) return { vue: 'accueil' };
    if (morceaux[2] === 'config') {
      /* Une rubrique INCONNUE n'est pas une panne : la fenêtre retombera sur
         sa première rubrique et le dira, plutôt que d'afficher un vide. */
      const rubrique = decodeSegment(morceaux[3] ?? '');
      return rubrique
        ? { vue: 'config-projet', projectId, rubrique }
        : { vue: 'config-projet', projectId };
    }
    if (morceaux[2] === 'tache' && morceaux[3]) {
      const cardId = idDeCarte(decodeSegment(morceaux[3]));
      const onglet = decodeSegment(morceaux[4] ?? '');
      if (cardId) return { vue: 'projet', projectId, cardId, ...(onglet ? { onglet } : {}) };
    }
    return { vue: 'projet', projectId };
  }

  return { vue: 'accueil' };
}

/**
 * Deux écrans mènent-ils au MÊME endroit ? On compare la vue et les
 * identifiants, jamais le slug : « #projet/42/tache/7-vieux-titre » et
 * « #projet/42/tache/7-nouveau-titre » sont le même écran.
 *
 * C'est CETTE réponse qui décide d'empiler une entrée d'historique ou de
 * simplement rafraîchir l'adresse. Ce qui est une DESTINATION (un service, un
 * élément ouvert) empile ; ce qui n'est qu'un détail d'affichage à l'intérieur
 * d'un écran (l'onglet d'une carte, la fiche de l'espace client) ne doit pas
 * coûter un appui de plus sur le bouton Précédent.
 */
export function memeEcran(a: EcranNavigateur, b: EcranNavigateur): boolean {
  if (a.vue !== b.vue) return false;
  if (a.vue === 'projet' && b.vue === 'projet') {
    /* L'ONGLET EST UN DÉTAIL D'AFFICHAGE : passer de la conversation à
       « GitHub » ne change pas d'écran, sinon six onglets feraient six retours
       en arrière avant de sortir de la carte. */
    return a.projectId === b.projectId && (a.cardId ?? '') === (b.cardId ?? '');
  }
  if (a.vue === 'config-projet' && b.vue === 'config-projet') {
    /* LA RUBRIQUE EST UNE DESTINATION, pas un détail d'affichage : passer du
       déploiement à la mise en production empile une entrée, pour que la
       flèche Précédent revienne à la rubrique d'avant. */
    return (
      a.projectId === b.projectId &&
      (a.rubrique ?? RUBRIQUE_CONFIG_PAR_DEFAUT) === (b.rubrique ?? RUBRIQUE_CONFIG_PAR_DEFAUT)
    );
  }
  if (a.vue === 'reglages' && b.vue === 'reglages') return (a.page ?? '') === (b.page ?? '');
  if (a.vue === 'notes' && b.vue === 'notes') return (a.noteId ?? '') === (b.noteId ?? '');
  if (a.vue === 'coffre' && b.vue === 'coffre') return (a.ficheId ?? '') === (b.ficheId ?? '');
  if (a.vue === 'memoire' && b.vue === 'memoire') {
    return (
      (a.porteeId ?? '') === (b.porteeId ?? '') &&
      (a.ficheId ?? '') === (b.ficheId ?? '') &&
      (a.uniteId ?? '') === (b.uniteId ?? '')
    );
  }
  if (a.vue === 'backups' && b.vue === 'backups') return (a.siteId ?? '') === (b.siteId ?? '');
  if (a.vue === 'surveillance' && b.vue === 'surveillance') return (a.siteId ?? '') === (b.siteId ?? '');
  if (a.vue === 'marketing' && b.vue === 'marketing') return (a.projectId ?? '') === (b.projectId ?? '');
  if (a.vue === 'studio' && b.vue === 'studio') return (a.creationId ?? '') === (b.creationId ?? '');
  if (a.vue === 'statistiques' && b.vue === 'statistiques') return (a.siteId ?? '') === (b.siteId ?? '');
  /*
   * DEUX ADRESSES D'ESPACE MÈNENT AU MÊME ÉCRAN. La fiche ouverte est un
   * détail d'affichage à l'intérieur de cet écran, pas une destination à part :
   * la refermer ne doit pas empiler une entrée d'historique.
   */
  return true;
}

/**
 * L'ADRESSE D'UNE FICHE DANS L'ESPACE DU CLIENT — l'autre visage, servi sur
 * `my.haikostudio.cloud`. Le projet voyage avec la demande : un client peut en
 * avoir plusieurs, et l'espace doit savoir lequel afficher avant d'ouvrir la
 * fiche. C'est l'adresse que porte le courriel du lundi matin.
 */
export function construireFragmentDeDemande(projectId: string, demandeId: string): string {
  return `projet/${encodeURIComponent(projectId)}/demande/${encodeURIComponent(demandeId)}`;
}

/**
 * L'ADRESSE DE LA DISCUSSION DIRECTE — le fil qui ne tient à aucune demande.
 * C'est le même mot que celui déjà reconnu par `adresseDeDiscussion` et par le
 * service worker : il n'y en a qu'un, écrit une seule fois.
 */
export const FRAGMENT_DE_DISCUSSION = 'discussion';

/**
 * Ce qu'un tel fragment désigne. Un fragment vide, inconnu ou abîmé ne rend
 * rien du tout : l'espace s'ouvre alors normalement, sur son tableau.
 */
export function lireFragmentDeDemande(hash: string): { projectId?: string; demandeId?: string } {
  const brut = (hash || '').replace(/^#/, '').replace(/^\/+/, '').trim();
  const morceaux = brut.split('/');
  if (morceaux[0] !== 'projet' || !morceaux[1] || morceaux[2] !== 'demande' || !morceaux[3]) return {};
  return { projectId: decodeSegment(morceaux[1]), demandeId: decodeSegment(morceaux[3]) };
}

/**
 * LES ÉCRANS DE L'ESPACE CLIENT. L'espace n'a pas de colonne de gauche : il a
 * un tableau de demandes, des volets et des tiroirs. Chacun de ceux qui DURENT
 * — pas un menu, pas une confirmation — porte son mot dans l'adresse.
 */
export type EcranEspaceClient =
  /*
   * Le tableau des demandes. Le filtre et le tri des colonnes n'y figurent
   * pas : ce sont des réglages de LECTURE, déjà gardés par projet et par
   * colonne, pas un endroit qu'on partage — et les mettre dans l'adresse
   * empilerait une entrée d'historique à chaque clic de tri.
   */
  | { ecran: 'demandes' }
  | { ecran: 'demande'; projectId: string; demandeId: string }
  | { ecran: 'discussion' }
  | { ecran: 'profil' }
  | { ecran: 'acces' }
  | { ecran: 'backups' }
  | { ecran: 'nouvelle-demande' };

/**
 * L'ADRESSE DE L'ÉLÉMENT OUVERT DANS L'ESPACE CLIENT. L'espace LISAIT son
 * fragment — le lien d'un courriel, une notification touchée — mais ne
 * l'ÉCRIVAIT que pour la discussion et une fiche : le reste (profil, accès,
 * sauvegardes, nouvelle demande, tableau filtré) se perdait au rechargement.
 *
 * Les deux premières formes sont FIGÉES : ce sont celles des courriels déjà
 * envoyés. Les suivantes sont neuves et ne croisent aucun mot existant.
 */
export function fragmentDeLEspaceClient(ecran: {
  projectId?: string;
  demandeId?: string;
  discussion?: boolean;
  ecran?: EcranEspaceClient['ecran'];
}): string {
  if (ecran.discussion || ecran.ecran === 'discussion') return FRAGMENT_DE_DISCUSSION;
  if (ecran.projectId && ecran.demandeId) return construireFragmentDeDemande(ecran.projectId, ecran.demandeId);
  if (ecran.ecran === 'profil') return 'profil';
  if (ecran.ecran === 'acces') return 'acces';
  if (ecran.ecran === 'backups') return 'backups';
  if (ecran.ecran === 'nouvelle-demande') return 'nouvelle-demande';
  return '';
}

/**
 * Ce que désigne un fragment de l'espace client. Un fragment vide, inconnu ou
 * abîmé rend le tableau des demandes : jamais un écran vide.
 */
export function lireFragmentDeLEspaceClient(hash: string): EcranEspaceClient {
  const brut = (hash || '').replace(/^#/, '').replace(/^\/+/, '').trim();
  if (!brut) return { ecran: 'demandes' };
  const morceaux = brut.split('/');
  const tete = morceaux[0];
  if (tete === FRAGMENT_DE_DISCUSSION) return { ecran: 'discussion' };
  if (tete === 'profil') return { ecran: 'profil' };
  if (tete === 'acces') return { ecran: 'acces' };
  if (tete === 'backups') return { ecran: 'backups' };
  if (tete === 'nouvelle-demande') return { ecran: 'nouvelle-demande' };
  if (tete === 'demandes') return { ecran: 'demandes' };
  const { projectId, demandeId } = lireFragmentDeDemande(brut);
  if (projectId && demandeId) return { ecran: 'demande', projectId, demandeId };
  return { ecran: 'demandes' };
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

/**
 * L'ÉLÉMENT OUVERT DANS CHAQUE SERVICE, tel que l'interface le tient.
 *
 * Un seul objet pour les six services, et c'est lui qui voyage dans les deux
 * sens : l'adresse le pose au chargement, l'écran le remonte quand on ouvre
 * autre chose. Le tenir ICI — sans réseau, sans React — permet de vérifier
 * l'aller-retour « écran → adresse → écran » sans ouvrir un navigateur.
 */
export type ElementVise = {
  notes?: string | null;
  coffre?: string | null;
  memoirePortee?: string | null;
  memoireFiche?: string | null;
  memoireUnite?: string | null;
  backups?: string | null;
  surveillance?: string | null;
  marketing?: string | null;
  studio?: string | null;
  statistiques?: string | null;
};

/**
 * Ce qu'une adresse désigne dans chaque service. Seul le service de l'écran
 * demandé reçoit son élément : les cinq autres sont remis à zéro, sinon une
 * fiche visée autrefois se rouvrirait en revenant par les flèches du navigateur.
 */
export function elementViseDeLEcran(ecran: EcranNavigateur): ElementVise {
  return {
    notes: ecran.vue === 'notes' ? ecran.noteId ?? null : null,
    coffre: ecran.vue === 'coffre' ? ecran.ficheId ?? null : null,
    memoirePortee: ecran.vue === 'memoire' ? ecran.porteeId ?? null : null,
    memoireFiche: ecran.vue === 'memoire' ? ecran.ficheId ?? null : null,
    memoireUnite: ecran.vue === 'memoire' ? ecran.uniteId ?? null : null,
    backups: ecran.vue === 'backups' ? ecran.siteId ?? null : null,
    surveillance: ecran.vue === 'surveillance' ? ecran.siteId ?? null : null,
    marketing: ecran.vue === 'marketing' ? ecran.projectId ?? null : null,
    studio: ecran.vue === 'studio' ? ecran.creationId ?? null : null,
    statistiques: ecran.vue === 'statistiques' ? ecran.siteId ?? null : null,
  };
}

/**
 * L'ÉCRAN COURANT, DÉDUIT DE L'ÉTAT DE L'INTERFACE. C'est l'unique endroit qui
 * traduit « quelle destination + quel élément ouvert » en écran adressable :
 * l'application n'écrit donc jamais un fragment de sa propre main.
 *
 * Sans projet actif et sans destination, on rend l'accueil : une adresse nue,
 * qui laisse le dernier projet consulté reprendre la main.
 */
export function ecranDeLaVue(etat: {
  vue: VueCentrale;
  element?: ElementVise;
  espace?: { clientId?: string; demandeId?: string };
  projectId?: string | null;
  cardId?: string | null;
  titreCarte?: string | null;
  onglet?: string | null;
}): EcranNavigateur {
  const element = etat.element ?? {};
  switch (etat.vue) {
    case 'tableau-de-bord':
      return { vue: 'tableau-de-bord' };
    case 'en-route':
      return { vue: 'en-route' };
    case 'notes':
      return { vue: 'notes', ...(element.notes ? { noteId: element.notes } : {}) };
    case 'coffre':
      return { vue: 'coffre', ...(element.coffre ? { ficheId: element.coffre } : {}) };
    case 'memoire':
      return {
        vue: 'memoire',
        /* LE CLASSEUR PAR DÉFAUT NE S'ÉCRIT PAS. L'écrire allongeait toutes les
           adresses de mémoire pour rien, et surtout : ouvrir la mémoire posait
           alors DEUX entrées d'historique — « #memoire », puis
           « #memoire/portee/global » une image plus tard. */
        ...(element.memoirePortee && element.memoirePortee !== PORTEE_DE_MEMOIRE_PAR_DEFAUT
          ? { porteeId: element.memoirePortee }
          : {}),
        ...(element.memoireFiche ? { ficheId: element.memoireFiche } : {}),
        ...(element.memoireUnite ? { uniteId: element.memoireUnite } : {}),
      };
    case 'backups':
      return { vue: 'backups', ...(element.backups ? { siteId: element.backups } : {}) };
    case 'surveillance':
      return { vue: 'surveillance', ...(element.surveillance ? { siteId: element.surveillance } : {}) };
    case 'marketing':
      return { vue: 'marketing', ...(element.marketing ? { projectId: element.marketing } : {}) };
    case 'studio':
      return { vue: 'studio', ...(element.studio ? { creationId: element.studio } : {}) };
    case 'statistiques':
      return { vue: 'statistiques', ...(element.statistiques ? { siteId: element.statistiques } : {}) };
    case 'espace-client':
      return {
        vue: 'espace',
        ...(etat.espace?.clientId ? { clientId: etat.espace.clientId } : {}),
        ...(etat.espace?.demandeId ? { demandeId: etat.espace.demandeId } : {}),
      };
    default:
      if (!etat.projectId) return { vue: 'accueil' };
      return {
        vue: 'projet',
        projectId: etat.projectId,
        ...(etat.cardId ? { cardId: etat.cardId } : {}),
        ...(etat.cardId && etat.titreCarte ? { titreCarte: etat.titreCarte } : {}),
        ...(etat.cardId && etat.onglet ? { onglet: etat.onglet } : {}),
      };
  }
}
