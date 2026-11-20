/**
 * L'ESPACE « COMMUNICATION » — les règles pures, sans base ni réseau.
 *
 * Il réunit ce qui était éparpillé entre quatre services (Réseaux sociaux, Studio, Médias,
 * Marketing) : les écrans et les données DÉMÉNAGENT, rien n'est refait en double. Chaque
 * LIEU d'une marque répond à UNE SEULE question ; ce qui n'y répond pas n'y entre pas.
 *
 * Une MARQUE réunit un ou plusieurs projets (ProjetA = trois projets). Elle n'existe que pour
 * regarder ensemble ce qui est déjà rangé par projet : rien ne bouge dans les projets.
 *
 * Ce fichier dit la règle ; `server/src/communication.ts` lit la base.
 */
import type { ContenuMarketing } from './marketing.js';

/* ------------------------------------------------------------------ */
/* Les lieux et les adresses                                           */
/* ------------------------------------------------------------------ */

/** L'identifiant de l'agent de service du directeur (`agent.service.id`). */
export const SERVICE_DU_DIRECTEUR = 'communication';

/* « bilan » est l'adresse du lieu affiché « Stratégie » : le mot `strategie` désigne le service réservé au propriétaire. */
/* L'ORDRE DE LA DÉMARCHE DU DIRECTEUR (03/11/2026) : la stratégie d'abord, puis les canaux, les campagnes, les médias,
   et enfin ce qui part et ce qui revient (publications, messages). */
/*
 * LA REFONTE DU 04/11/2026 garde les ADRESSES (aucun lien ne casse) mais change ce qu'elles ouvrent :
 *   - PAGES de la marque : `accueil` = le TABLEAU DE BORD (quatre chiffres + calendrier éditorial), `campagnes`,
 *     `medias` = la MÉDIATHÈQUE, `messages` (messages privés), `commentaires` ;
 *   - `bilan` = MARKETING et `canaux` = CANAUX sont des pages du menu comme les autres (deuxième passe du
 *     04/11/2026 : plus aucun panneau posé par-dessus) ;
 *   - `publications` = la PLANIFICATION : le calendrier éditorial en page, avec la bande de ce qui attend votre
 *     accord (05/11/2026). Il n'y a plus de page « publication » : `publications/contenu/<id>` ouvre la fiche du
 *     média de la publication.
 */
export const LIEUX_DE_MARQUE = ['accueil', 'bilan', 'canaux', 'campagnes', 'medias', 'publications', 'messages', 'commentaires'] as const;
export type LieuDeMarque = (typeof LIEUX_DE_MARQUE)[number];

export const LIEU_PAR_DEFAUT: LieuDeMarque = 'accueil';

/** Où l'on est dans l'espace : rien = la vue d'ensemble ; `menu` = la liste des lieux, sur téléphone. */
export interface EmplacementCommunication {
  /** `projet:<id>` tant que la marque d'un ancien lien n'est pas résolue. */
  marqueId?: string;
  lieu?: LieuDeMarque;
  /** Ce qui suit le lieu : « calendrier », « liste », « reserve », l'identifiant d'un fil, d'un média… */
  element?: string[];
}

/** Le chemin écrit dans l'adresse après « #communication/ ». */
export function cheminCommunication(e: EmplacementCommunication): string {
  if (!e.marqueId) return '';
  const lieu = e.lieu ?? LIEU_PAR_DEFAUT;
  const reste = e.element?.filter(Boolean) ?? [];
  if (lieu === LIEU_PAR_DEFAUT && !reste.length) return e.marqueId;
  return [e.marqueId, lieu, ...reste].join('/');
}

const PREFIXE_PROJET = 'projet:';

/** `projet:<id>` → l'identifiant du projet, sinon `null`. */
export function projetDuChemin(marqueId: string | undefined): string | null {
  return marqueId?.startsWith(PREFIXE_PROJET) ? marqueId.slice(PREFIXE_PROJET.length) : null;
}

/** LES ANCIENNES RUBRIQUES DES RÉSEAUX SOCIAUX, et le lieu où elles ont déménagé. */
const RUBRIQUE_VERS_LIEU: Readonly<Record<string, [LieuDeMarque, ...string[]]>> = {
  'vue-d-ensemble': ['accueil'],
  calendrier: ['publications', 'calendrier'],
  contenus: ['publications', 'liste'],
  messages: ['messages'],
  canaux: ['canaux'],
  comptes: ['canaux'],
  positionnement: ['bilan', 'fiche'],
};

/**
 * OÙ MÈNE UNE ANCIENNE ADRESSE. Les anciens liens continuent de fonctionner : ils ouvrent le
 * bon lieu de la bonne marque. Rend `null` quand l'écran reste lui-même : le Studio et l'outil
 * Marketing, services indépendants que Communication pilote.
 */
export function redirectionVersCommunication(ecran: {
  vue: string;
  /** L'élément désigné : « <projet>/<rubrique>/<canal> », le projet des médias. */
  element?: string | null;
}): { chemin: string } | null {
  /* L'ancien atelier Réseaux sociaux et l'ancienne page des médias mènent à COMMUNICATION (vue `communication2`,
     l'ancien espace est retiré le 11/11/2026). Leur élément est un PROJET, pas une marque : on ouvre la liste. */
  return ecran.vue === 'marketing' || ecran.vue === 'medias' ? { chemin: '' } : null;
}

/* ------------------------------------------------------------------ */
/* Les marques                                                          */
/* ------------------------------------------------------------------ */

export const ORIGINES_DE_MARQUE = ['projets', 'entreprise', 'idee'] as const;
export type OrigineDeMarque = (typeof ORIGINES_DE_MARQUE)[number];

export interface MarqueCommunication {
  id: string;
  nom: string;
  origine: OrigineDeMarque;
  adresse?: string;
  description?: string;
  /** Tous ses projets, le principal d'abord. */
  projets: string[];
  /** Celui qui reçoit ce qui s'écrit : son espace est actif, son rapport présent. */
  projetPrincipal: string | null;
  niveau: number;
  /** Les quêtes déjà accomplies : une quête faite le reste. */
  quetes: string[];
  creeLe: number;
  majLe: number;
}

/** La racine d'un nom de projet : son premier mot, sans casse ni accents. */
export function racineDeNom(nom: string): string {
  return nom
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[\s\-_.:()]+/)
    .filter(Boolean)[0] ?? '';
}

export interface RegroupementPropose {
  /** Le nom proposé : le plus court des noms réunis. */
  nom: string;
  projets: { id: string; nom: string }[];
}

/**
 * LES REGROUPEMENTS À PROPOSER : les projets dont le nom commence par le même mot. « ProjetA »,
 * « ProjetA vitrine » et « ProjetA app » font une marque ; « HaikoBill » et « Haiko Studio » non.
 * Rien n'est appliqué d'office : la proposition se valide d'un clic. Un projet déjà réuni à
 * d'autres, ou une proposition refusée, n'est plus reproposé.
 */
export function regroupementsAProposer(
  projets: readonly { id: string; name: string }[],
  deja: { projetsReunis: ReadonlySet<string>; refuses: ReadonlySet<string> },
): RegroupementPropose[] {
  const parRacine = new Map<string, { id: string; name: string }[]>();
  for (const projet of projets) {
    if (deja.projetsReunis.has(projet.id)) continue;
    const racine = racineDeNom(projet.name);
    if (racine.length < 3) continue;
    parRacine.set(racine, [...(parRacine.get(racine) ?? []), projet]);
  }
  const propositions: RegroupementPropose[] = [];
  for (const [racine, liste] of parRacine) {
    if (liste.length < 2 || deja.refuses.has(racine)) continue;
    const tries = [...liste].sort((a, b) => a.name.length - b.name.length || a.name.localeCompare(b.name));
    propositions.push({ nom: tries[0]!.name, projets: tries.map((p) => ({ id: p.id, nom: p.name })) });
  }
  return propositions.sort((a, b) => a.nom.localeCompare(b.nom));
}

/** La clé d'une proposition refusée. */
export function cleDeRegroupement(nom: string): string {
  return racineDeNom(nom);
}

/* ------------------------------------------------------------------ */
/* La réserve d'idées                                                   */
/* ------------------------------------------------------------------ */

export const PREFIXE_ANNONCE_AUTOMATIQUE = 'changelog:';

/**
 * UNE ANNONCE ÉCRITE TOUTE SEULE À CHAQUE LIVRAISON RESTE EN RÉSERVE : ni tableau, ni calendrier,
 * ni compte de ce qui attend. Le directeur y puise au plus une ou deux nouveautés par semaine, qui
 * entrent alors dans le circuit normal (`sortiDeReserveLe`). Rien n'y est effacé.
 */
export function estDansLaReserve(contenu: { sourceRef?: string | null; sortiDeReserveLe?: number | null; etape: string }): boolean {
  if (!contenu.sourceRef?.startsWith(PREFIXE_ANNONCE_AUTOMATIQUE)) return false;
  if (contenu.sortiDeReserveLe) return false;
  /* Une annonce déjà partie, ou en route, a sa place dans les tableaux. */
  return contenu.etape === 'brouillon' || contenu.etape === 'a_valider';
}

/** Une annonce abandonnée n'encombre aucune liste, pas même la réserve. */
export function contenusDuCircuit<T extends Pick<ContenuMarketing, 'etape'> & { sourceRef?: string | null; sortiDeReserveLe?: number | null }>(
  contenus: readonly T[],
): { circuit: T[]; reserve: T[] } {
  const circuit: T[] = [];
  const reserve: T[] = [];
  for (const c of contenus) {
    if (c.etape === 'abandonne') continue;
    (estDansLaReserve(c) ? reserve : circuit).push(c);
  }
  return { circuit, reserve };
}

/* ------------------------------------------------------------------ */
/* Le calendrier                                                        */
/* ------------------------------------------------------------------ */

/** Les canaux où rien ne part tout seul : ils vivent sur la ligne « À faire vous-même ». */
export const CANAUX_SANS_PUBLICATION = ['courriel', 'communautes', 'site', 'bouche-a-oreille', 'partenariats', 'annuaires', 'presse', 'evenements', 'publicite-recherche', 'publicite-reseaux', 'reddit', 'autre'] as const;

/* ------------------------------------------------------------------ */
/* Les médias : une ligne par média, avec ses versions                  */
/* ------------------------------------------------------------------ */

export type GenreMediaDeMarque = 'image' | 'video' | 'son';
export type OrigineDeMedia = 'studio' | 'importe' | 'genere';
export type EtatDeMedia = 'a_valider' | 'valide' | 'brouillon';

export interface LigneDeMedia {
  /** La clé stable de la ligne de base : `export:<id>`, `livre:<id>`, `piece:<id>`. */
  cle: string;
  projectId: string;
  nom: string;
  genre: GenreMediaDeMarque;
  origine: OrigineDeMedia;
  attachmentId: string | null;
  afficheId?: string | null;
  format?: string | null;
  duree?: number | null;
  outil?: string | null;
  cout?: number | null;
  /** Le numéro connu de la version ; sinon l'ordre de création la donne. */
  version?: number | null;
  /** Un regroupement déjà connu : la création du Studio, le plan d'une carte. */
  groupe?: string | null;
  /** Le jeton de la création du Studio, pour rouvrir son montage. */
  creationId?: string | null;
  cardId?: string | null;
  retenu?: boolean;
  /** Une création du Studio encore en montage : rien de prêt à valider. */
  enMontage?: boolean;
  creeLe: number;
}

export interface MediaRegroupe extends LigneDeMedia {
  /** Toutes les versions, la plus récente d'abord ; la tête de ligne est la première. */
  versions: LigneDeMedia[];
  numeroDeVersion: number;
}

/** Ce qui ne se montre jamais : copies internes, essais, étapes intermédiaires. */
export function mediaInterne(entree: { nom?: string | null; provenance?: string | null; usage?: string | null; genre?: string | null }): boolean {
  const nom = (entree.nom ?? '').toLowerCase();
  if (nom.startsWith('copie d’aperçu') || nom.startsWith('copie d\'aperçu')) return true;
  if (/détour[ée]/.test(nom)) return true;
  const provenance = entree.provenance ?? '';
  if (provenance === 'voix-essai' || provenance === 'dessin') return true;
  if (entree.genre === 'dessin') return true;
  return false;
}

/** Le nom d'un média sans ses marques de version, de durée ni son extension : la clé de ses versions. */
export function nomSansVersion(nom: string): string {
  return nom
    .replace(/\.[a-z0-9]{2,5}$/i, '')
    .replace(/\((version\s*\d+|v\d+|[\d,. ]+\s*s)\)/gi, '')
    .replace(/[-_ ]v\d+\b/gi, '')
    .replace(/\bv\d+\b/gi, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * UNE LIGNE PAR MÉDIA, ses versions dessous. Les versions d'un même média partagent leur groupe
 * connu (une création, un plan de carte) ou, à défaut, leur nom sans marque de version. Le plus
 * récent fait la tête de ligne : on revient à une ancienne version sans rien effacer.
 */
/** LA CLÉ DES VERSIONS d'une ligne : deux lignes de même clé sont deux versions d'un même média. */
export function cleDesVersions(ligne: Pick<LigneDeMedia, 'projectId' | 'genre' | 'groupe' | 'nom'>): string {
  return `${ligne.projectId}\n${ligne.genre}\n${ligne.groupe || nomSansVersion(ligne.nom)}`;
}

export function regrouperLesMedias(lignes: readonly LigneDeMedia[]): MediaRegroupe[] {
  const groupes = new Map<string, LigneDeMedia[]>();
  for (const ligne of lignes) {
    const cle = cleDesVersions(ligne);
    groupes.set(cle, [...(groupes.get(cle) ?? []), ligne]);
  }
  const medias: MediaRegroupe[] = [];
  for (const versions of groupes.values()) {
    const tries = [...versions].sort((a, b) => (b.version ?? 0) - (a.version ?? 0) || b.creeLe - a.creeLe);
    const tete = tries[0]!;
    medias.push({ ...tete, versions: tries, numeroDeVersion: tete.version ?? tries.length });
  }
  return medias.sort((a, b) => b.creeLe - a.creeLe);
}

/**
 * LES MÉDIAS FINIS, ET CE DONT ILS SONT FAITS (décision de l'utilisateur du 03/11/2026 : « seulement les
 * médias générés par les agents ou l'agent de production artistique, pas de rushs »). Une ligne est :
 *  - FINIE : un export du Studio, une génération d'un agent, ou toute pièce déjà utilisée dans une
 *    publication (on ne perd jamais un visuel qui est parti) ;
 *  - SOURCE d'un média fini : une pièce importée ou générée qui sert une création du Studio exportée —
 *    elle se lit dans la fiche de ce média, plus dans la liste ;
 *  - écartée : une création encore en montage (rien de fini), un import qui ne sert à rien de fini.
 */
export function trierLesMedias<L extends LigneDeMedia>(
  lignes: readonly L[],
  contexte: { utilisees: ReadonlySet<string>; creationDeLaPiece: ReadonlyMap<string, string>; creationsFinies: ReadonlySet<string> },
): { finis: L[]; sources: Map<string, L[]> } {
  const finis: L[] = [];
  const sources = new Map<string, L[]>();
  for (const l of lignes) {
    if (l.origine === 'studio') {
      if (!l.enMontage) finis.push(l);
      continue;
    }
    if (l.attachmentId && contexte.utilisees.has(l.attachmentId)) {
      finis.push(l);
      continue;
    }
    const creation = l.creationId ?? (l.attachmentId ? contexte.creationDeLaPiece.get(l.attachmentId) : undefined);
    if (creation && contexte.creationsFinies.has(creation)) {
      sources.set(creation, [...(sources.get(creation) ?? []), l]);
      continue;
    }
    if (l.origine === 'genere') finis.push(l);
  }
  return { finis, sources };
}

/** L'état affiché d'un média : ce que l'utilisateur a décidé, sinon ce que sa provenance dit. */
export function etatDeMedia(media: Pick<LigneDeMedia, 'origine' | 'retenu' | 'enMontage'>, decide?: string | null): EtatDeMedia {
  if (media.enMontage) return 'brouillon';
  if (decide === 'valide' || decide === 'a_valider' || decide === 'brouillon') return decide;
  if (media.origine === 'importe' || media.retenu) return 'valide';
  return 'a_valider';
}

/* ------------------------------------------------------------------ */
/* Le rapport résumé                                                    */
/* ------------------------------------------------------------------ */

export interface RapportResume {
  phrase: string | null;
  priorites: { titre: string; detail?: string }[];
  rubriques: { titre: string; texte: string }[];
}

const nettoyer = (ligne: string) => ligne.replace(/\*\*/g, '').replace(/^[-*•]\s+/, '').replace(/^#+\s*/, '').trim();

/**
 * LE RAPPORT MARKETING EN BLOCS : sa phrase-clé (la promesse ou le positionnement) et ses trois
 * premières priorités (le plan, les canaux retenus). Tiré du texte déjà écrit, jamais réinventé :
 * ce qui manque reste vide et aucune note n'est fabriquée.
 */
export function resumerLeRapport(markdown: string | null | undefined, fiche?: { promesse?: string | null } | null): RapportResume {
  const lignes = String(markdown ?? '').split('\n');
  const rubriques: { titre: string; texte: string }[] = [];
  let courante: { titre: string; lignes: string[] } | null = null;
  for (const ligne of lignes) {
    const titre = /^#{2,3}\s+(.+)$/.exec(ligne);
    if (titre) {
      if (courante) rubriques.push({ titre: courante.titre, texte: courante.lignes.join('\n').trim() });
      courante = { titre: nettoyer(titre[1]!), lignes: [] };
    } else if (courante) courante.lignes.push(ligne);
  }
  if (courante) rubriques.push({ titre: courante.titre, texte: courante.lignes.join('\n').trim() });

  const trouver = (motif: RegExp) => rubriques.find((r) => motif.test(r.titre.toLowerCase()));
  const premierePhrase = (texte: string) => {
    const seul = texte
      .split('\n')
      .map(nettoyer)
      .find((l) => l.length > 20);
    if (!seul) return null;
    const fin = seul.search(/[.!?](\s|$)/);
    return fin > 30 ? seul.slice(0, fin + 1) : seul;
  };
  const promesse = fiche?.promesse?.trim();
  const positionnement = trouver(/positionnement|promesse/);
  const phrase = promesse || (positionnement ? premierePhrase(positionnement.texte) : rubriques[0] ? premierePhrase(rubriques[0].texte) : null);

  const source = trouver(/prochaines? choses?|priorit/) ?? trouver(/plan|semaines|prochaine/) ?? trouver(/canaux/);
  const priorites = (source?.texte ?? '')
    .split('\n')
    .filter((l) => /^\s*[-*•]\s+/.test(l) || /^\s*\d+[.)]\s+/.test(l))
    .map((l) => nettoyer(l.replace(/^\s*\d+[.)]\s+/, '- ')))
    .filter(Boolean)
    .slice(0, 3)
    .map((l) => {
      const coupe = l.search(/\s[:—–]\s|: /);
      return coupe > 3 && coupe < 70 ? { titre: l.slice(0, coupe).trim(), detail: l.slice(coupe).replace(/^[\s:—–]+/, '').trim() } : { titre: l };
    });
  return { phrase, priorites, rubriques };
}

/* ------------------------------------------------------------------ */
/* Les messages du directeur : des blocs, pas du texte libre            */
/* ------------------------------------------------------------------ */

/** Le langage du bloc de code qui porte un message structuré du directeur. */
export const LANGAGE_BLOC_DIRECTEUR = 'directeur';

/** Les gestes qu'un bouton peut jouer : ceux de l'utilisateur, à son clic et avec ses droits. */
export const GESTES_DU_BLOC = [
  'contenu.valider',
  'contenu.publier',
  'media.valider',
  'compte.relier',
  /* LE DIRECTEUR AGIT (03/11/2026) : au clic, un agent ouvre le compte lui-même, avec le navigateur du serveur. */
  'compte.creer',
  'reserve.sortir',
  'regroupement.valider',
  /* LA DÉMARCHE (03/11/2026) : le directeur propose un objectif, l'utilisateur le retient d'un clic. */
  'objectif.valider',
] as const;
export type GesteDuBloc = (typeof GESTES_DU_BLOC)[number];

export interface ActionDuBloc {
  libelle: string;
  /** Ouvre ce chemin de l'espace au centre (« <marque>/publications/calendrier »). */
  ouvrir?: string;
  /** Envoie cette phrase au directeur, comme si on l'écrivait. */
  dire?: string;
  /** Joue un geste de l'utilisateur : jamais un geste de l'agent. */
  geste?: GesteDuBloc;
  id?: string;
  /** Le bouton principal du bloc, en clair. */
  principal?: boolean;
}

export interface BlocDuDirecteur {
  etiquette?: string;
  titre: string;
  texte?: string;
  /** Des identifiants de pièces : les VRAIS médias de la marque. */
  images: string[];
  chiffres: { valeur: string; libelle: string }[];
  courbe: number[];
  /** Ce que montre la courbe (« Visites du site, 14 derniers jours ») : sans lui, la courbe ne s'affiche pas. */
  courbeTitre?: string;
  actions: ActionDuBloc[];
}

const texte = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/**
 * UNE ÉNUMÉRATION ÉCRITE EN PAVÉ DEVIENT UNE LISTE (capture de l'utilisateur du 03/11/2026 : « 1. … 2. … 3. … »
 * dans une seule phrase). Une ligne qui porte au moins deux numéros qui se suivent depuis 1 est coupée avant
 * chacun : l'introduction reste un paragraphe, chaque point devient une ligne « N. … », que le rendu
 * Markdown lit comme une liste. Le reste du texte est rendu tel quel.
 */
export function texteDuBlocLisible(brut: string): string {
  return brut
    .split('\n')
    .map((ligne) => {
      const marques = [...ligne.matchAll(/(^|[\s:;,—–])(\d{1,2})[.)]\s+/g)];
      if (marques.length < 2 || Number(marques[0]![2]) !== 1) return ligne;
      const coupes: number[] = [];
      let attendu = 1;
      for (const m of marques) {
        if (Number(m[2]) !== attendu) continue;
        coupes.push(m.index! + m[1]!.length);
        attendu += 1;
      }
      if (coupes.length < 2) return ligne;
      const intro = ligne.slice(0, coupes[0]).trim();
      const points = coupes.map((debut, i) => ligne.slice(debut, coupes[i + 1]).trim().replace(/^(\d{1,2})[.)]\s+/, '$1. ').replace(/\s*[;,]$/, ''));
      return [...(intro ? [intro, ''] : []), ...points, ''].join('\n');
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Lit un bloc écrit par l'agent. Tout ce qui est mal formé est écarté ; `null` s'il ne reste pas de titre. */
export function lireBlocDuDirecteur(json: string): BlocDuDirecteur | null {
  let brut: Record<string, unknown>;
  try {
    brut = JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!brut || typeof brut !== 'object') return null;
  const titre = texte(brut.titre, 120);
  if (!titre) return null;
  const images = (Array.isArray(brut.images) ? brut.images : typeof brut.image === 'string' ? [brut.image] : [])
    .filter((v): v is string => typeof v === 'string' && /^[\w-]{4,64}$/.test(v))
    .slice(0, 3);
  const chiffres = (Array.isArray(brut.chiffres) ? brut.chiffres : [])
    .map((c: any) => ({ valeur: texte(String(c?.valeur ?? ''), 24), libelle: texte(c?.libelle, 40) }))
    .filter((c) => c.valeur)
    .slice(0, 6);
  const courbe = (Array.isArray(brut.courbe) ? brut.courbe : []).filter((n): n is number => typeof n === 'number' && Number.isFinite(n)).slice(0, 60);
  const actions = (Array.isArray(brut.actions) ? brut.actions : [])
    .map((a: any): ActionDuBloc | null => {
      const libelle = texte(a?.libelle, 60);
      if (!libelle) return null;
      /* AUCUN « TOUT ACCEPTER » : les publications se valident une par une, quoi que l'agent écrive. */
      if (/^tout\s+(accepter|valider|publier)/i.test(libelle)) return null;
      const geste = (GESTES_DU_BLOC as readonly unknown[]).includes(a?.geste) ? (a.geste as GesteDuBloc) : undefined;
      const ouvrir = texte(a?.ouvrir, 200);
      const dire = texte(a?.dire, 2000);
      if (!geste && !ouvrir && !dire) return null;
      return { libelle, ...(geste ? { geste, id: texte(a?.id, 120) } : ouvrir ? { ouvrir } : { dire }), ...(a?.principal ? { principal: true } : {}) };
    })
    .filter((a): a is ActionDuBloc => !!a)
    .slice(0, 4);
  const courbeTitre = texte(brut.courbeTitre, 80);
  return { ...(texte(brut.etiquette, 40) ? { etiquette: texte(brut.etiquette, 40) } : {}), titre, ...(texte(brut.texte, 2400) ? { texte: texteDuBlocLisible(texte(brut.texte, 2400)) } : {}), images, chiffres, courbe, ...(courbeTitre ? { courbeTitre } : {}), actions };
}

/* ------------------------------------------------------------------ */
/* Les notifications du directeur                                       */
/* ------------------------------------------------------------------ */

export const HEURE_DEBUT_NUIT = 22;
export const HEURE_FIN_NUIT = 8;

export function estLaNuit(heure: number): boolean {
  return heure >= HEURE_DEBUT_NUIT || heure < HEURE_FIN_NUIT;
}

export type DecisionDeNotification = 'envoyer' | 'reporter' | 'rien';

/**
 * CHAQUE MESSAGE DU DIRECTEUR FAIT SONNER LE TÉLÉPHONE (décision de l'utilisateur du 02/11/2026, seule
 * exception aux « trois genres qui alertent ») — sauf en sourdine, et jamais la nuit : ce qui arrive
 * entre 22 h et 8 h attend le réveil, regroupé. Une question posée a déjà sa propre alerte : pas de doublon.
 */
export function decisionDeNotification(entree: { sourdine: boolean; heure: number; questionPosee?: boolean; messageVide?: boolean }): DecisionDeNotification {
  if (entree.sourdine || entree.questionPosee || entree.messageVide) return 'rien';
  return estLaNuit(entree.heure) ? 'reporter' : 'envoyer';
}

/** Le début d'un message, sans ses blocs, lisible dans une notification. */
export function apercuDuMessage(contenu: string): { titre: string; corps: string } {
  const bloc = new RegExp('```' + LANGAGE_BLOC_DIRECTEUR + '\\s*([\\s\\S]*?)```').exec(contenu);
  if (bloc) {
    const lu = lireBlocDuDirecteur(bloc[1] ?? '');
    if (lu) return { titre: lu.titre, corps: (lu.texte ?? '').slice(0, 180) };
  }
  const brut = contenu.replace(/```[\s\S]*?```/g, '').replace(/[*#`]/g, '').replace(/\s+/g, ' ').trim();
  return { titre: 'Votre directeur général', corps: brut.slice(0, 180) };
}

/* ------------------------------------------------------------------ */
/* Les chiffres                                                         */
/* ------------------------------------------------------------------ */

/** Le temps de réponse médian : l'écart entre un message reçu et la réponse qui le suit dans son fil. */
export function tempsDeReponseMedian(messages: readonly { fil: string; instant: number; sortant: boolean }[]): number | null {
  const parFil = new Map<string, { instant: number; sortant: boolean }[]>();
  for (const m of messages) parFil.set(m.fil, [...(parFil.get(m.fil) ?? []), m]);
  const ecarts: number[] = [];
  for (const fil of parFil.values()) {
    const tries = [...fil].sort((a, b) => a.instant - b.instant);
    let recuA: number | null = null;
    for (const m of tries) {
      if (!m.sortant) recuA ??= m.instant;
      else if (recuA !== null) {
        ecarts.push(m.instant - recuA);
        recuA = null;
      }
    }
  }
  if (!ecarts.length) return null;
  const tries = ecarts.sort((a, b) => a - b);
  return tries[Math.floor(tries.length / 2)]!;
}

/** Le jour de la semaine (0 = lundi) où l'on regarde le plus, d'après une série par jour. */
export function jourLePlusRegarde(serie: readonly { jour: string; valeur: number }[]): number | null {
  const totaux = Array.from({ length: 7 }, () => 0);
  let total = 0;
  for (const { jour, valeur } of serie) {
    totaux[(new Date(`${jour}T12:00:00Z`).getUTCDay() + 6) % 7]! += valeur;
    total += valeur;
  }
  if (!total) return null;
  return totaux.indexOf(Math.max(...totaux));
}

/**
 * TOUT MÉDIA DE COMMUNICATION APPARTIENT À SA CAMPAGNE (décision de l'utilisateur du 05/11/2026 : « les médias dans
 * l'outil de communication sont générés par une campagne, donc d'office ils doivent y être assimilés »). La campagne
 * d'un média, dans cet ordre — seulement une campagne QUI EXISTE dans la marque :
 *   1. le rattachement ENREGISTRÉ sur l'une de ses versions (un choix fait l'emporte toujours, même partagé) ;
 *   2. celui de sa création du Studio (`creation:<id>`, posé au lancement par `rattacherCreationACampagne`) ;
 *   3. la campagne de ses publications (la plus fréquente, puis la première) — relue à chaque fois, elle suit le post ;
 *   4. la SEULE campagne de la marque, quand elle n'en a qu'une (médias hérités de l'ancienne interface) : c'est la
 *      seule déduction que la lecture ENREGISTRE (`source === 'seule'`), une fois ;
 * sinon `null` — un repli qui ne doit plus arriver.
 */
/**
 * LE MÉDIA RETIRÉ DE SA CAMPAGNE (carte du 06/11/2026, « Retirer de cette campagne ») : la valeur enregistrée à la place
 * d'une campagne. Sans elle, un `campagne_id` vide se faisait recoller d'office (publications, campagne seule) et le
 * média revenait tout seul. Avec elle, il reste dans la médiathèque, sans campagne, tant qu'on ne le range pas ailleurs.
 */
export const SANS_CAMPAGNE = '-';

export function campagneDuMedia(entree: {
  versions: readonly string[];
  creationId?: string | null;
  rattachements: ReadonlyMap<string, string | null | undefined>;
  campagnesDesPublications: readonly (string | null | undefined)[];
  campagnesDeLaMarque: readonly string[];
}): { campagneId: string | null; source: 'enregistree' | 'creation' | 'publications' | 'seule' | 'retiree' | null } {
  const existe = (c: string | null | undefined): c is string => !!c && entree.campagnesDeLaMarque.includes(c);
  for (const cle of entree.versions) {
    const c = entree.rattachements.get(cle);
    if (c === SANS_CAMPAGNE) return { campagneId: null, source: 'retiree' };
    if (existe(c)) return { campagneId: c, source: 'enregistree' };
  }
  const deLaCreation = entree.creationId ? entree.rattachements.get(`creation:${entree.creationId}`) : null;
  if (existe(deLaCreation)) return { campagneId: deLaCreation, source: 'creation' };
  const comptes = new Map<string, number>();
  for (const c of entree.campagnesDesPublications) if (existe(c)) comptes.set(c, (comptes.get(c) ?? 0) + 1);
  const deSesPublications = [...comptes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (deSesPublications) return { campagneId: deSesPublications, source: 'publications' };
  if (entree.campagnesDeLaMarque.length === 1) return { campagneId: entree.campagnesDeLaMarque[0]!, source: 'seule' };
  return { campagneId: null, source: null };
}
