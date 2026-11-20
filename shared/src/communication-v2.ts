
/**
 * COMMUNICATION 2 — l'espace « simple et limpide » (carte « Communication V2, simple et limpide », 08/11/2026).
 *
 * Un NOUVEL espace, à côté de l'actuel (`communication`), qui lit les MÊMES données : un chemin en TROIS étapes
 * numérotées dans la colonne de gauche — Canaux, Campagnes, Calendrier — puis « Réponses » sous un trait. L'outil
 * Marketing n'en fait PLUS partie (décision de l'utilisateur, carte « Parcours marketing simplifié », 08/11/2026) :
 * plus d'étape « Plan marketing », plus d'étude proposée ; une campagne part de ce que la personne écrit. Plus de chef flottant ni de conversation générale : un champ à chaque endroit, et la demande part au chef de
 * la marque EN COULISSES (`communication.coulisses`), sans personne pour lui répondre.
 *
 * Ce fichier ne porte que les règles pures : l'adresse, l'état des étapes, la pose des bandes de campagnes dans une semaine du calendrier, le rythme conseillé et la consigne des coulisses.
 */

/* ------------------------------------------------------------------ */
/* L'adresse : #communication/<marque>/<étape>/<élément…>               */
/* ------------------------------------------------------------------ */

/**
 * LES TROIS ÉTAPES (décision de l'utilisateur du 12/11/2026, carte « Communication et Studio : série de retouches ») :
 * Campagnes, Connexion, Calendrier. L'ancienne étape « Réseaux » (`canaux`) DISPARAÎT du chemin : les réseaux se
 * choisissent AU DÉBUT DE CHAQUE CAMPAGNE. La page `canaux` reste routable (anciennes adresses, réglages avancés des
 * réseaux) mais n'est plus une étape ; son adresse nue mène aux campagnes.
 */
export const ETAPES_COMMUNICATION_V2 = ['campagnes', 'connexion', 'calendrier'] as const;
export type EtapeCommunicationV2 = (typeof ETAPES_COMMUNICATION_V2)[number];
/** Les pages d'une marque : les trois étapes, « Réponses » (messages privés et commentaires réunis), et les réglages avancés des réseaux (`canaux`). */
export const PAGES_COMMUNICATION_V2 = [...ETAPES_COMMUNICATION_V2, 'reponses', 'canaux'] as const;
export type PageCommunicationV2 = (typeof PAGES_COMMUNICATION_V2)[number];

/**
 * LA PAGE OÙ S'OUVRE UNE MARQUE SANS ADRESSE PRÉCISE : TOUJOURS la liste des campagnes (décision du 12/11/2026), plus
 * jamais « la première étape à faire ». Une adresse précise, elle, est respectée.
 */
export const PAGE_D_OUVERTURE_V2: PageCommunicationV2 = 'campagnes';

export function estPageCommunicationV2(valeur: unknown): valeur is PageCommunicationV2 {
  return (PAGES_COMMUNICATION_V2 as readonly unknown[]).includes(valeur);
}

export interface EmplacementCommunicationV2 {
  marqueId?: string;
  page?: PageCommunicationV2;
  /** Ce qui suit la page : « nouvelle » (l'assistant) et son écran, l'identifiant d'une campagne… */
  element?: string[];
}

/** Le chemin écrit après « #communication/ ». Sans page, la marque s'ouvre sur ses campagnes (`PAGE_D_OUVERTURE_V2`). */
export function cheminCommunicationV2(e: EmplacementCommunicationV2): string {
  if (!e.marqueId) return '';
  const reste = e.element?.filter(Boolean) ?? [];
  if (!e.page) return e.marqueId;
  return [e.marqueId, e.page, ...reste].join('/');
}

/**
 * UNE ADRESSE DE L'ANCIEN ESPACE COMMUNICATION (« #communication/<marque>/<lieu>/… », retiré le 11/11/2026) lue en
 * chemin du nouveau : mêmes marques, et chaque lieu vers sa page — les canaux (et leurs réglages avancés, la fiche
 * d'un canal), les campagnes, les publications au calendrier, les messages et commentaires aux réponses.
 */
export function cheminDeLAncienneCommunication(chemin: string | null | undefined): string {
  const [marqueId, lieu, ...element] = String(chemin ?? '')
    .split('/')
    .filter(Boolean);
  if (!marqueId) return '';
  switch (lieu) {
    case 'canaux':
      if (element[0] === 'reglages') return cheminCommunicationV2({ marqueId, page: 'canaux', element: ['reglages'] });
      return element[0] ? cheminCommunicationV2({ marqueId, page: 'canaux', element: ['reglages', element[0]] }) : cheminCommunicationV2({ marqueId, page: 'campagnes' });
    case 'campagnes':
      return cheminCommunicationV2({ marqueId, page: 'campagnes', element: element.slice(0, 1) });
    case 'publications':
      return cheminCommunicationV2({ marqueId, page: 'calendrier' });
    case 'messages':
    case 'commentaires':
      return cheminCommunicationV2({ marqueId, page: 'reponses' });
    default:
      return marqueId;
  }
}
/**
 * LE CHEMIN LU APRÈS « #communication/ » (20/11/2026) : ce mot est redevenu celui du service, et son chemin est celui
 * d'aujourd'hui (`cheminCommunicationV2`). Seuls les lieux que l'ANCIEN espace était seul à écrire — les publications,
 * les messages, les commentaires, la fiche d'un canal (« canaux/<canal> ») — sont encore traduits : un lien parti avant
 * le 11/11/2026 tombe toujours au bon endroit, et un lien d'aujourd'hui n'est jamais réinterprété.
 */
export function cheminDeCommunicationLu(chemin: string | null | undefined): string {
  const morceaux = String(chemin ?? '')
    .split('/')
    .filter(Boolean);
  const [, lieu, premier] = morceaux;
  /* Un lieu d'aujourd'hui (une page, ou l'ancienne page « plan » que `lireCheminCommunicationV2` corrige) passe tel
     quel ; tout autre lieu (publications, messages, commentaires, médias…) est un lieu de l'ancien espace. */
  const daujourdhui = !lieu || lieu === 'plan' || (estPageCommunicationV2(lieu) && (lieu !== 'canaux' || premier === 'reglages'));
  return daujourdhui ? morceaux.join('/') : cheminDeLAncienneCommunication(morceaux.join('/'));
}

/**
 * UNE ANCIENNE ADRESSE DE LA PAGE « PLAN MARKETING » (retirée le 08/11/2026) s'ouvre sur les campagnes — jamais un
 * écran vide.
 */
const ANCIENNES_PAGES_V2: Record<string, PageCommunicationV2> = { plan: 'campagnes' };

export function lireCheminCommunicationV2(chemin: string | null | undefined): EmplacementCommunicationV2 {
  const [marqueId, brute, ...element] = String(chemin ?? '')
    .split('/')
    .filter(Boolean);
  if (!marqueId) return {};
  const ancienne = brute ? ANCIENNES_PAGES_V2[brute] : undefined;
  if (ancienne) return { marqueId, page: ancienne };
  const page = brute;
  if (!estPageCommunicationV2(page)) return { marqueId };
  /* L'ÉTAPE « RÉSEAUX » N'EXISTE PLUS (12/11/2026) : son adresse nue mène aux campagnes ; ses réglages avancés restent. */
  if (page === 'canaux' && !element.length) return { marqueId, page: 'campagnes' };
  return { marqueId, page, ...(element.length ? { element } : {}) };
}

/* ------------------------------------------------------------------ */
/* Les trois étapes, cochées une fois faites                            */
/* ------------------------------------------------------------------ */

/** Ce que la colonne lit sur une marque, tout en base, rien sur une déclaration. */
export interface EntreeDesEtapesV2 {
  /** Les réseaux sociaux choisis (le plus grand nombre parmi les projets de la marque) — plus une étape, gardé pour les écrans. */
  reseauxChoisis: number;
  /** Les comptes CONNECTÉS, par la voie officielle ou par Chrome. */
  comptesRelies: number;
  campagnes: number;
  /** Les campagnes PRÊTES : chaque date prévue de leur programme a son visuel fait (`campagnePrete`). */
  campagnesPretes?: number;
  /** Les publications validées, programmées ou parties : le calendrier a commencé à vivre. */
  publicationsPlanifiees: number;
}

export type EtatDEtapeV2 = 'fait' | 'a_faire' | 'en_cours';

export interface EtapeV2 {
  id: EtapeCommunicationV2;
  rang: number;
  etat: EtatDEtapeV2;
  /** 0 ou 100 : une étape est faite ou non. */
  pourcent: number;
}

/**
 * L'ÉTAT DES TROIS ÉTAPES : chacune est FAITE sur un fait mesuré — campagnes = au moins une campagne PRÊTE (tous ses
 * visuels faits pour toutes ses dates, décision du 12/11/2026 : une campagne seulement commencée ne coche plus
 * l'étape), connexion = au moins un compte connecté, calendrier = au moins une publication validée. La PREMIÈRE non
 * faite est « en cours ».
 */
export function etapesDeLaMarqueV2(e: EntreeDesEtapesV2): { etapes: EtapeV2[]; suivante: EtapeCommunicationV2 | null } {
  const pourcents: Record<EtapeCommunicationV2, number> = {
    campagnes: (e.campagnesPretes ?? 0) > 0 ? 100 : 0,
    connexion: e.comptesRelies > 0 ? 100 : 0,
    calendrier: e.publicationsPlanifiees > 0 ? 100 : 0,
  };
  const suivante = ETAPES_COMMUNICATION_V2.find((id) => pourcents[id] < 100) ?? null;
  return {
    etapes: ETAPES_COMMUNICATION_V2.map((id, i) => ({ id, rang: i + 1, pourcent: pourcents[id], etat: pourcents[id] >= 100 ? 'fait' : id === suivante ? 'en_cours' : 'a_faire' })),
    suivante,
  };
}

/* ------------------------------------------------------------------ */
/* Une campagne PRÊTE : chaque date prévue a son visuel                 */
/* ------------------------------------------------------------------ */

/** Une publication de la campagne, vue pour son visuel. */
export interface PublicationPourLesVisuels {
  datePrevue?: string | null;
  /** Le visuel (image ou vidéo) est-il fait — une pièce rattachée ou un rendu du Studio ? */
  aUnVisuel: boolean;
}

export interface VisuelsDeCampagne {
  /** Les visuels attendus : une publication datée chacun, et au moins le nombre de médias prévu par la campagne. */
  prevus: number;
  faits: number;
}

/**
 * LES VISUELS D'UNE CAMPAGNE : une publication DATÉE attend son visuel ; une publication sans date n'est pas encore au
 * programme. Le nombre de médias prévu (`quantiteMedias`) relève le compte tant que le programme n'est pas posé.
 */
export function visuelsDeLaCampagne(quantiteMedias: number | null | undefined, publications: readonly PublicationPourLesVisuels[]): VisuelsDeCampagne {
  const datees = publications.filter((p) => !!p.datePrevue);
  return { prevus: Math.max(datees.length, quantiteMedias ?? 0), faits: datees.filter((p) => p.aUnVisuel).length };
}

/** PRÊTE : au moins un visuel attendu, et tous faits (décision du 12/11/2026 : « créée » seulement à ce moment). */
export function campagnePrete(v: VisuelsDeCampagne): boolean {
  return v.prevus > 0 && v.faits >= v.prevus;
}

export type StatutAfficheDeCampagne = 'preparation' | 'prete' | 'en_cours' | 'terminee';

/**
 * L'ÉTAT AFFICHÉ D'UNE CAMPAGNE : « Prête » s'intercale entre « En préparation » et « En cours » — une campagne en
 * préparation dont tous les visuels sont faits. Calculé à la lecture (jamais stocké) : un visuel retiré la fait
 * revenir en préparation sans geste.
 */
export function statutAfficheDeCampagne(statut: string, v: VisuelsDeCampagne): StatutAfficheDeCampagne {
  if (statut === 'en_cours' || statut === 'terminee') return statut;
  return campagnePrete(v) ? 'prete' : 'preparation';
}

/**
 * LA BARRE « PRÉCÉDENT / ÉTAPES / SUIVANT » DU BAS D'UNE ÉTAPE (carte « Communication 2 : finitions et chats »,
 * décision de l'utilisateur) : pas de « Précédent » sur la première étape, pas de « Suivant » sur la dernière, et
 * « Suivant » BLOQUÉ tant que l'étape ouverte n'est pas faite — avec ce qui manque, en clair. La colonne de gauche et
 * les ronds de la barre restent libres : seul « Suivant » guide.
 */
export interface PasDeLaBarreV2 {
  precedente: EtapeCommunicationV2 | null;
  suivante: EtapeCommunicationV2 | null;
  /** La raison du blocage de « Suivant », ou `null` quand on peut avancer. */
  bloque: string | null;
}

export const RAISONS_DU_SUIVANT_BLOQUE: Record<EtapeCommunicationV2, string> = {
  campagnes: 'Terminez une campagne — tous ses visuels faits — pour passer à la connexion.',
  connexion: 'Connectez au moins un réseau pour passer au calendrier.',
  calendrier: '',
};

export function pasDeLaBarreV2(page: EtapeCommunicationV2, e: EntreeDesEtapesV2): PasDeLaBarreV2 {
  const i = ETAPES_COMMUNICATION_V2.indexOf(page);
  const precedente = i > 0 ? ETAPES_COMMUNICATION_V2[i - 1]! : null;
  const suivante = i >= 0 && i < ETAPES_COMMUNICATION_V2.length - 1 ? ETAPES_COMMUNICATION_V2[i + 1]! : null;
  const faite = etapesDeLaMarqueV2(e).etapes.find((x) => x.id === page)?.etat === 'fait';
  return { precedente, suivante, bloque: suivante && !faite ? RAISONS_DU_SUIVANT_BLOQUE[page] : null };
}

/**
 * LES ÉTAPES S'OUVRENT DANS L'ORDRE (décision de l'utilisateur, 08/11/2026) : une étape n'est accessible qu'une fois
 * TOUTES les précédentes faites — dans la colonne, à l'adresse et au menu du téléphone. Une étape DÉJÀ FAITE reste
 * ouverte même si une précédente ne l'est pas (une marque qui a déjà des campagnes sans réseau relié garde l'accès à
 * ses campagnes) — on ne verrouille jamais ce qui existe.
 *
 * Rend l'étape à terminer d'abord pour ouvrir celle-ci, ou `null` quand elle est ouverte.
 */
export function etapeQuiBloqueV2(id: EtapeCommunicationV2, e: EntreeDesEtapesV2): EtapeCommunicationV2 | null {
  const { etapes } = etapesDeLaMarqueV2(e);
  if (etapes.find((x) => x.id === id)?.etat === 'fait') return null;
  const i = ETAPES_COMMUNICATION_V2.indexOf(id);
  return etapes.slice(0, Math.max(0, i)).find((x) => x.etat !== 'fait')?.id ?? null;
}

/** La page à ouvrir à la place d'une page verrouillée : l'étape qui bloque ; une page ouverte reste elle-même. */
export function pageAccessibleV2(page: PageCommunicationV2, e: EntreeDesEtapesV2): PageCommunicationV2 {
  if (page === 'reponses' || page === 'canaux') return page;
  return etapeQuiBloqueV2(page, e) ?? page;
}

/* ------------------------------------------------------------------ */
/* Le chef de la marque, en coulisses                                   */
/* ------------------------------------------------------------------ */

/** Ce qu'une demande en coulisses demande au chef. */
/* « campagne » (carte « Communication 2 : finitions et chats ») : le champ du bas d'une campagne agit sur TOUTE la
   campagne d'un coup — visuels, textes, dates —, plus à l'unité ; « calendrier » : le champ du calendrier déplace ou
   change les dates. */
/*
 * « campagnes » et « reponses » (08/11/2026, le chat sur toutes les pages) : la demande libre de la LISTE des campagnes
 * (et de l'assistant de création, qui y joint son brouillon) et celle de la page « Réponses », sans message visé.
 */
export const GENRES_DE_COULISSES = ['canaux', 'programme', 'programme-changer', 'visuels', 'retouche', 'reponse', 'campagne', 'calendrier', 'campagnes', 'reponses'] as const;
export type GenreDeCoulisses = (typeof GENRES_DE_COULISSES)[number];

export function estGenreDeCoulisses(v: unknown): v is GenreDeCoulisses {
  return (GENRES_DE_COULISSES as readonly unknown[]).includes(v);
}

/** Un drapeau de coulisses plus vieux que ça ne tient plus : la question redevient permise. */
export const DUREE_DES_COULISSES = 45 * 60_000;

export interface CoulissesEnCours {
  genre: GenreDeCoulisses;
  marqueId: string;
  campagneId?: string;
  contenuId?: string;
  messageId?: string;
  depuis: number;
}

/** Le drapeau lu en base : valable seulement s'il est bien formé et assez récent. */
export function coulissesValables(brut: string | null | undefined, maintenant: number): CoulissesEnCours | null {
  if (!brut) return null;
  try {
    const c = JSON.parse(brut) as Partial<CoulissesEnCours>;
    if (!estGenreDeCoulisses(c.genre) || typeof c.marqueId !== 'string' || typeof c.depuis !== 'number') return null;
    if (maintenant - c.depuis > DUREE_DES_COULISSES || c.depuis > maintenant + 60_000) return null;
    return { genre: c.genre, marqueId: c.marqueId, depuis: c.depuis, ...(typeof c.campagneId === 'string' ? { campagneId: c.campagneId } : {}), ...(typeof c.contenuId === 'string' ? { contenuId: c.contenuId } : {}), ...(typeof c.messageId === 'string' ? { messageId: c.messageId } : {}) };
  } catch {
    return null;
  }
}

/** Ce que l'outil « ask_user » répond au chef pendant un tour en coulisses : la règle tenue par le refus. */
export const REFUS_DE_QUESTION_EN_COULISSES =
  'Refusé : cette demande vient de Communication 2, sans conversation — personne ne lit ton fil et personne ne répondra à une question. Tranche toi-même ce qui manque avec ta meilleure recommandation, enregistre-le, et continue jusqu’au bout.';

/**
 * Ce que l'outil « communication » répond au chef en coulisses qui tente l'outil Marketing (actions « analyse » et
 * « preparer_analyse ») : l'outil Marketing est sorti de Communication 2 (décision du 08/11/2026) — la règle est tenue
 * par ce refus, pas seulement écrite dans la consigne.
 */
export const REFUS_D_ETUDE_EN_COULISSES =
  'Refusé : cette demande vient de Communication 2, dont l’outil Marketing ne fait plus partie. Pas d’étude ni de plan marketing ici : pars de ce que la personne a écrit et continue jusqu’au bout.';

const REGLES_DES_COULISSES = [
  'DEMANDE EN COULISSES, VENUE DE COMMUNICATION 2 (l’espace sans conversation). Personne ne lit ton fil et personne ne répondra à une question : tu n’appelles JAMAIS « ask_user » (l’outil le refuse d’ailleurs).',
  'Tout ce qu’il te faut est dans cette demande ; ce qui manque, tu le tranches toi-même avec ta réponse conseillée, celle que tu aurais marquée « (recommandé) », et tu l’enregistres aussitôt.',
  'Rien ne se publie, ne se paie ni ne part à quelqu’un : la personne valide d’un clic dans Communication 2. Aucune génération payante sans le clic de la personne sur son prix.',
  'L’outil Marketing (étude de marché, SEO, concurrence) ne fait PAS partie de Communication 2 : tu n’utilises jamais les actions « analyse » ni « preparer_analyse », tu ne proposes aucune étude et tu ne t’appuies sur aucun plan marketing — tu pars de ce que la personne écrit.',
  'Pour finir, un seul message très court (deux phrases au plus) : ce qui est prêt. Pas de bloc, pas de bouton, pas de question.',
].join(' ');

export interface DemandeDeCoulisses {
  genre: GenreDeCoulisses;
  marque: string;
  /** Le texte libre tapé par la personne (idée, correction, retouche). */
  texte?: string;
  campagne?: { id: string; titre: string; debut?: string | null; fin?: string | null; reseaux?: readonly string[]; quantite?: number | null; objectif?: string | null; projet?: string | null };
  contenu?: { id: string; titre: string };
  message?: { id: string; auteur: string; texte: string; reseau: string; projet: string };
}

/**
 * LA CONSIGNE D'UNE DEMANDE EN COULISSES. Le chef de marque, en temps normal, construit une campagne PAR QUESTIONS
 * (DEC-478) ; ici, l'écran lui donne D'UN COUP la description, la période et les canaux, et lui demande de trancher
 * seul les points qui restent — une question bloquerait son tour sans personne pour répondre (DEC-026).
 */
export function consigneDeCoulisses(d: DemandeDeCoulisses): string {
  const texte = (d.texte ?? '').trim().slice(0, 1500);
  const c = d.campagne;
  const laCampagne = c
    ? `la campagne « ${c.titre} » (id « ${c.id} »${c.debut ? `, du ${c.debut}` : ''}${c.fin ? ` au ${c.fin}` : ''}${c.reseaux?.length ? `, sur ${c.reseaux.join(', ')}` : ''}${c.objectif ? `, objectif servi : ${c.objectif}` : ''})`
    : 'la campagne';
  const projet = c?.projet ? ` Les publications se créent sur le projet « ${c.projet} ».` : '';
  const travail = (() => {
    switch (d.genre) {
      case 'canaux':
        return `Règle les canaux de la marque « ${d.marque} » selon cette demande : ${texte || '(aucun texte)'}`;
      case 'programme':
        return `PRÉPARE LE PROGRAMME de ${laCampagne}. L’idée de la personne : ${texte || '(rien de plus que le titre)'}. 1) Complète tout de suite ses HUIT POINTS en un seul appel (outil « communication », action « campagne » avec son « id ») : typesMedias, quantiteMedias (${c?.quantite ? `environ ${c.quantite}` : 'trois par semaine'}), rythme, public, reseaux, debut, fin, objectifChiffre et mesure, message, ton, appelAction — garde les dates et les réseaux donnés. 2) Puis crée chaque publication en BROUILLON (outil « marketing », action « contenu », etape « brouillon », avec titre, texte, canal, datePrevue dans la période) et rattache-la aussitôt (outil « communication », action « contenu_campagne »). Une même publication déclinée sur plusieurs réseaux : une par réseau, liées par « declinaisonDe ». Ne fabrique AUCUN visuel à ce stade : la personne valide d’abord le programme.${projet}`;
      case 'programme-changer':
        return `CHANGE LE PROGRAMME de ${laCampagne} selon cette demande : ${texte || '(aucun texte)'}. Modifie, ajoute ou archive (« abandonne ») ses publications en brouillon ; ne fabrique aucun visuel.${projet}`;
      case 'visuels':
        return `LE PROGRAMME DE ${laCampagne} EST VALIDÉ par la personne. Fabrique le visuel de chaque publication dans le Studio (outil « services », service studio, avec « campagne » = son id), en VERSION GRATUITE d’abord ; toute génération payante se propose avec son prix et ne part qu’au clic de la personne. Lie chaque visuel à sa publication (action « lier_media »), puis passe la publication à l’étape « a_valider » (outil « marketing », action « contenu »).${projet}`;
      case 'reponse': {
        const m = d.message;
        return `PRÉPARE UNE RÉPONSE au message de ${m?.auteur ?? 'quelqu’un'} sur ${m?.reseau ?? 'un réseau'} (id « ${m?.id ?? ''} ») : « ${(m?.texte ?? '').slice(0, 600)} ». Écris-la avec l’outil « marketing », action « reponse » (projet « ${m?.projet ?? ''} », messageId, texte), au ton de la marque : elle attend sous le message que la personne l’envoie — tu ne l’envoies jamais.${texte ? ` Ce que la personne demande : ${texte}` : ''}`;
      }
      case 'campagne':
        return `CHANGE TOUTE ${laCampagne} D’UN COUP selon cette demande de la personne : ${texte || '(aucun texte)'}. La demande vise l’ENSEMBLE de ses publications, pas une seule : liste-les d’abord (outil « communication », action « campagne » avec son « id »), puis applique le changement à CHACUNE qu’il concerne — visuels (par le Studio, version gratuite d’abord), textes et légendes, dates et heures, ajout ou retrait (« abandonne ») de publications (outil « marketing », action « contenu »). TOUTE PUBLICATION QUE TU MODIFIES REPASSE À L’ÉTAPE « a_valider », même si elle était validée ou programmée : la personne revalide d’un clic. Ne programme rien et ne publie rien.${projet}`;
      case 'calendrier':
        return `CHANGE LE CALENDRIER de la marque « ${d.marque} » selon cette demande de la personne : ${texte || '(aucun texte)'}. Déplace ou change les dates et heures des publications concernées (outil « marketing », action « contenu », datePrevue / heurePrevue). Toute publication modifiée qui était validée ou programmée REPASSE À L’ÉTAPE « a_valider » : la personne revalide d’un clic. Ne programme rien et ne publie rien.`;
      case 'campagnes':
        return `DEMANDE SUR LES CAMPAGNES de la marque « ${d.marque} », venue de la liste des campagnes ou de l’assistant de création : ${texte || '(aucun texte)'}. Lis d’abord ses campagnes (outil « communication ») ; pour une NOUVELLE campagne, crée-la (outil « communication », action « campagne » sans « id ») avec titre, période, réseaux et objectif tirés de la demande, sans fabriquer de visuel ni préparer son programme — la personne le lance d’un clic. Pour une campagne existante, applique le changement demandé. Ne programme rien et ne publie rien.`;
      case 'reponses':
        return `DEMANDE SUR LES RÉPONSES de la marque « ${d.marque} » (messages privés et commentaires reçus) : ${texte || '(aucun texte)'}. Lis les messages concernés (outil « marketing ») et prépare les réponses demandées avec l’outil « marketing », action « reponse », au ton de la marque : chacune attend sous son message que la personne l’envoie — tu n’envoies jamais rien.`;
      case 'retouche':
        return `RETOUCHE la publication « ${d.contenu?.titre ?? ''} » (id « ${d.contenu?.id ?? ''} »)${c ? ` de ${laCampagne}` : ''} selon cette demande : ${texte || '(aucun texte)'}. Garde-la à l’étape « a_valider » ; un nouveau visuel passe par le Studio, en version gratuite d’abord.${projet}`;
    }
  })();
  return `${REGLES_DES_COULISSES}\n\n${travail}`;
}

/* ------------------------------------------------------------------ */
/* Le parcours d'une campagne, en bas comme celui d'un agent            */
/* ------------------------------------------------------------------ */

/** Les six étapes d'une campagne (décision de l'utilisateur du 14/11/2026). */
export const ETAPES_DU_PARCOURS_DE_CAMPAGNE = ['brief', 'plan', 'visuels', 'connexion', 'programmation', 'en_ligne'] as const;
export type EtapeDuParcoursDeCampagne = (typeof ETAPES_DU_PARCOURS_DE_CAMPAGNE)[number];

export interface EntreeDuParcoursDeCampagne {
  /** La fiche de la campagne n'attend plus rien (`fiche.manquants` vide). */
  briefComplet: boolean;
  visuels: VisuelsDeCampagne;
  comptesRelies: number;
  /** Les publications datées déjà programmées ou parties. */
  programmees: number;
  /** Les publications déjà parties. */
  publiees: number;
  statut: string;
}

export interface EtapeDuParcoursDeCampagneLue {
  id: EtapeDuParcoursDeCampagne;
  etat: 'fait' | 'ici' | 'a_faire';
  /** Un compte à montrer à côté de l'étape (« 2 visuels sur 9 »). */
  compte?: { faits: number; total: number };
}

/**
 * LE PARCOURS D'UNE CAMPAGNE, posé en bas au-dessus du champ comme celui d'un agent (14/11/2026) : Brief, Plan,
 * Visuels, Connexion, Programmation, En ligne. Chaque étape se lit dans l'état existant, rien n'est stocké ; l'étape
 * « ici » est la première pas encore faite. Une campagne terminée a tout fait.
 */
export function parcoursDeLaCampagne(e: EntreeDuParcoursDeCampagne): EtapeDuParcoursDeCampagneLue[] {
  const total = e.visuels.prevus;
  const fait: Record<EtapeDuParcoursDeCampagne, boolean> = {
    brief: e.briefComplet,
    plan: total > 0,
    visuels: campagnePrete(e.visuels),
    connexion: e.comptesRelies > 0,
    programmation: total > 0 && e.programmees >= total,
    en_ligne: e.statut === 'terminee' || (total > 0 && e.publiees >= total),
  };
  const ici = e.statut === 'terminee' ? null : (ETAPES_DU_PARCOURS_DE_CAMPAGNE.find((id) => !fait[id]) ?? null);
  return ETAPES_DU_PARCOURS_DE_CAMPAGNE.map((id) => ({
    id,
    etat: fait[id] || e.statut === 'terminee' ? 'fait' : id === ici ? 'ici' : 'a_faire',
    ...(id === 'visuels' && total > 0 ? { compte: { faits: e.visuels.faits, total } } : {}),
    ...(id === 'programmation' && total > 0 ? { compte: { faits: Math.min(e.programmees, total), total } } : {}),
    ...(id === 'en_ligne' && total > 0 ? { compte: { faits: Math.min(e.publiees, total), total } } : {}),
  }));
}
