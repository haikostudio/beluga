/**
 * L'ÉQUIPE D'AGENTS D'UN PROJET ET D'UN GROUPE — les règles pures (carte « Beluga piloté par des agents », 26/11/2026).
 *
 * Beluga se pense en ÉQUIPES : chaque projet (et chaque regroupement de projets, qui est lui-même un projet) a ses
 * agents, chacun avec un RÔLE, un PORTRAIT, une COULEUR et des OUTILS. Un agent d'équipe est un agent personnalisé
 * (`agents-personnalises.ts`) dont la fiche est déjà remplie à sa naissance ; il naît ÉTEINT (aucun passage
 * automatique tant qu'on ne l'allume pas) et ne coûte rien tant qu'on ne lui parle pas.
 *
 * Ce module dit, sans base ni disque :
 *  - les rôles, leurs libellés et les OUTILS (onglets du volet) de chacun ;
 *  - l'ÉQUIPE PAR DÉFAUT d'un projet (développement, communication, marketing, plus déploiement et production quand
 *    le projet a une mise en ligne) et d'un groupe, et ce qu'il reste à SEMER sans jamais doubler un rôle ;
 *  - le rôle DEVINÉ d'un agent personnalisé créé avant les équipes (reprise de l'existant) ;
 *  - le PORTRAIT attribué sans doublon dans une même équipe ;
 *  - l'ÉTAT d'un membre (« vous attend », « au travail », « au repos ») ;
 *  - les ÉCHANGES entre agents : le destinataire d'un message à « toute l'équipe », la GARDE ANTI-BOUCLE, les
 *    LIAISONS de la table ;
 *  - la GÉOMÉTRIE de la table (agents répartis à pas égal sur un rectangle arrondi).
 */
import type { FicheDAgent } from './agents-personnalises.js';
import { PORTRAITS, couleurDuPortrait } from './portraits.js';

/* ------------------------------------------------------------------ */
/* Les rôles et leurs outils                                           */
/* ------------------------------------------------------------------ */

export const ROLES_D_EQUIPIER = ['dev', 'com', 'marketing', 'deploiement', 'production', 'libre'] as const;
export type RoleDEquipier = (typeof ROLES_D_EQUIPIER)[number];

/** Le métier, en clair (traduit à l'affichage). */
export const LIBELLE_DU_ROLE: Readonly<Record<RoleDEquipier, string>> = {
  dev: 'Développement',
  com: 'Communication',
  marketing: 'Marketing',
  deploiement: 'Déploiement',
  production: 'Production',
  libre: 'Agent',
};

/**
 * CE QUE CHAQUE MÉTIER FAIT DANS L'ÉQUIPE, dit à l'agent dans son relais. Déployer et mettre en production restent au
 * clic de l'utilisateur : l'agent de déploiement prépare et contrôle, il ne publie jamais.
 */
export const CONSIGNE_DU_ROLE: Readonly<Record<RoleDEquipier, string>> = {
  dev: 'Tu es le DÉVELOPPEUR de l’équipe. Toute demande de code devient une TÂCHE du projet : crée-la avec l’outil « equipe », geste « tache » (titre clair, consigne complète) — elle part seule si tu es libre avec tes collègues, sinon elle attend le clic de l’utilisateur dans « Planifié ». Tu suis tes tâches dans l’onglet « Tâches » et tu préviens l’agent de déploiement quand une tâche est prête.',
  com: 'Tu es la COMMUNICATION de l’équipe : calendrier des publications, textes des réseaux, visuels et vidéos du Studio. Tu prépares ; rien ne se publie sans la validation de l’utilisateur.',
  marketing: 'Tu es le MARKETING de l’équipe : études de marché et de concurrents, référencement, lecture des statistiques ; tu proposes des actions chiffrées et tu les confies au bon collègue.',
  deploiement: 'Tu es le DÉPLOIEMENT de l’équipe. Tu relis les tâches prêtes à mettre en ligne, tu vérifies ce qui peut l’être (tests, version d’essai, ce qui change), tu dis clairement ce que tu as contrôlé et ce qui reste à risque, puis tu poses la question « Je déploie ? » avec ask_user. Le déploiement et la mise en production partent UNIQUEMENT par le bouton « Déployer » de l’utilisateur (onglet « Mise en ligne ») : tu ne les déclenches jamais toi-même. Un problème trouvé se demande à l’agent de développement (outil « equipe »).',
  production: 'Tu es la PRODUCTION de l’équipe : tu veilles sur le site en ligne — disponibilité, sauvegardes, sécurité. À chaque alerte, tu résumes l’état en clair, tu préviens l’utilisateur, et tu demandes la correction à l’agent de développement (outil « equipe », geste « demander »). Tu ne mets jamais rien en ligne toi-même.',
  libre: 'Tu es un agent de l’équipe : ta fiche dit ta mission.',
};

export function roleDEquipierLu(v: unknown): RoleDEquipier {
  return (ROLES_D_EQUIPIER as readonly string[]).includes(String(v)) ? (v as RoleDEquipier) : 'libre';
}

/** LES OUTILS : chacun est un onglet du volet de l'agent, monté sur un composant existant. */
export const OUTILS_D_AGENT = [
  'taches',
  'apercu',
  'calendrier',
  'reseaux',
  'studio',
  'dossier',
  'referencement',
  'statistiques',
  'mise-en-ligne',
  'etat-du-site',
  'sauvegardes',
  'securite',
  'messagerie',
] as const;
export type OutilDAgent = (typeof OUTILS_D_AGENT)[number];

/** Les outils de chaque rôle, dans l'ordre des onglets. La fiche (« Fiche ») ferme toujours la barre. */
export const OUTILS_DU_ROLE: Readonly<Record<RoleDEquipier, readonly OutilDAgent[]>> = {
  dev: ['taches', 'apercu'],
  com: ['calendrier', 'reseaux', 'studio'],
  marketing: ['dossier', 'referencement', 'statistiques'],
  deploiement: ['mise-en-ligne'],
  production: ['etat-du-site', 'sauvegardes', 'securite'],
  libre: [],
};

/** Les outils d'un agent : ceux de son rôle, ou — agent libre — ceux qu'on lui a choisis (bornés au catalogue). */
export function outilsDeLAgent(role: RoleDEquipier, choisis: readonly string[] | null | undefined): OutilDAgent[] {
  if (role !== 'libre') return [...OUTILS_DU_ROLE[role]];
  const vus = new Set<OutilDAgent>();
  for (const o of choisis ?? []) if ((OUTILS_D_AGENT as readonly string[]).includes(o)) vus.add(o as OutilDAgent);
  return [...vus];
}

/* ------------------------------------------------------------------ */
/* L'équipe par défaut                                                 */
/* ------------------------------------------------------------------ */

export interface MembreParDefaut {
  role: RoleDEquipier;
  prenom: string;
  portrait: string;
  mission: string;
}

/** L'équipe d'un projet : mêmes prénoms et mêmes visages d'un projet à l'autre (instances distinctes, renommables). */
export const EQUIPE_DU_PROJET: readonly MembreParDefaut[] = [
  {
    role: 'dev',
    prenom: 'Max',
    portrait: 'max',
    mission:
      'Développer le projet : chaque demande de code devient une tâche du projet, qu’il cadre, réalise et vérifie. Il dit ce qui change et prévient l’agent de déploiement quand une tâche est prête.',
  },
  {
    role: 'com',
    prenom: 'Eliot',
    portrait: 'eliot',
    mission:
      'Tenir la communication du projet : calendrier des publications, textes des réseaux, visuels et vidéos du Studio. Rien ne se publie sans votre validation.',
  },
  {
    role: 'marketing',
    prenom: 'Zoé',
    portrait: 'zoe',
    mission:
      'Mener le marketing du projet : études de marché et de concurrents, référencement, lecture des statistiques ; elle propose des actions chiffrées.',
  },
  {
    role: 'deploiement',
    prenom: 'Karim',
    portrait: 'karim',
    mission:
      'Veiller à ce que chaque mise en ligne soit sûre : il relit les tâches prêtes, lance les contrôles et vous demande le feu vert. Le déploiement ne part que sur votre clic.',
  },
  {
    role: 'production',
    prenom: 'Victor',
    portrait: 'victor',
    mission:
      'Veiller sur le site en ligne : disponibilité, sauvegardes, sécurité. Il résume l’état, prévient dès qu’un point se dégrade et demande la correction à l’agent de développement.',
  },
];

/** L'équipe d'un GROUPE de projets : la voix de la marque et sa stratégie, au-dessus des projets. */
export const EQUIPE_DU_GROUPE: readonly MembreParDefaut[] = [
  {
    role: 'com',
    prenom: 'Claire',
    portrait: 'a07',
    mission: 'Porter la communication de la marque pour tous les projets du groupe, et coordonner les agents de communication de chaque projet.',
  },
  {
    role: 'marketing',
    prenom: 'Hugo',
    portrait: 'd03',
    mission: 'Porter la stratégie marketing de la marque sur tous les projets du groupe : positionnement, offres, résultats réunis.',
  },
];

const ROLES_DE_MISE_EN_LIGNE: readonly RoleDEquipier[] = ['deploiement', 'production'];

/**
 * CE QU'IL RESTE À SEMER : les membres par défaut dont le RÔLE manque encore dans l'équipe. Rejoué deux fois, il ne
 * sème rien de plus (idempotent) ; un agent déjà présent dans un rôle (Eliot, créé à la main) tient la place du membre
 * par défaut de ce rôle. Un rôle retiré par l'utilisateur ne revient pas : `retires` le garde hors du semis.
 */
export function membresASemer(
  existants: readonly { role: RoleDEquipier }[],
  contexte: { groupe: boolean; aUneMiseEnLigne: boolean; retires?: readonly RoleDEquipier[] },
): MembreParDefaut[] {
  const base = contexte.groupe ? EQUIPE_DU_GROUPE : EQUIPE_DU_PROJET.filter((m) => contexte.aUneMiseEnLigne || !ROLES_DE_MISE_EN_LIGNE.includes(m.role));
  const presents = new Set(existants.map((e) => e.role));
  const retires = new Set(contexte.retires ?? []);
  return base.filter((m) => !presents.has(m.role) && !retires.has(m.role));
}

/** LA FICHE D'UN MEMBRE SEMÉ : complète d'emblée (il n'a pas de création à mener), éteint, limite de 20 passages par jour. */
export function ficheDUnMembre(membre: MembreParDefaut): FicheDAgent {
  return {
    nom: membre.prenom,
    mission: membre.mission,
    declencheurs:
      membre.role === 'production'
        ? [
            { genre: 'evenement', source: 'surveillance.panne' },
            { genre: 'evenement', source: 'publication.terminee' },
            { genre: 'evenement', source: 'backup.echec' },
            { genre: 'evenement', source: 'securite.alerte' },
          ]
        : [{ genre: 'manuel' }],
    faitSeul: [],
    demandeAccord: [],
    jamais: [],
    emporte: { competences: [], acces: [], memoire: true },
    limite: { passages: 20, periode: 'jour' },
  };
}

/** LE RÔLE D'UN AGENT CRÉÉ AVANT LES ÉQUIPES, deviné de son nom et de sa mission (« Eliot - Comm Haiko » → com). */
export function roleDevine(fiche: Pick<FicheDAgent, 'nom' | 'mission'>): RoleDEquipier {
  const texte = `${fiche.nom} ${fiche.mission}`.toLowerCase();
  if (/\b(comm?\b|communication|r[ée]seaux|publications?|posts?\b|linkedin|instagram)/.test(texte)) return 'com';
  if (/\b(marketing|r[ée]f[ée]rencement|seo|concurren|[ée]tude de march)/.test(texte)) return 'marketing';
  if (/\b(d[ée]ploi|mise en ligne|mettre en ligne)/.test(texte)) return 'deploiement';
  if (/\b(production|surveill|sauvegarde|disponibilit)/.test(texte)) return 'production';
  if (/\b(d[ée]velopp|code|programm)/.test(texte)) return 'dev';
  return 'libre';
}

/* ------------------------------------------------------------------ */
/* Le portrait et la couleur                                           */
/* ------------------------------------------------------------------ */

/**
 * UN PORTRAIT SANS DOUBLON DANS L'ÉQUIPE : le portrait voulu s'il est libre, sinon le premier libre de la réserve à
 * partir d'un rang tiré de la graine (deux équipes ne prennent pas toutes le même ordre). La réserve épuisée (plus de
 * cinquante agents dans une équipe), le portrait voulu revient.
 */
export function portraitLibre(pris: Iterable<string>, voulu: string | null, graine = 0): string {
  const occupes = new Set(pris);
  if (voulu && PORTRAITS.some((p) => p.id === voulu) && !occupes.has(voulu)) return voulu;
  const n = PORTRAITS.length;
  if (!n) return voulu ?? '';
  const depart = Math.abs(Math.floor(graine)) % n;
  for (let i = 0; i < n; i++) {
    const p = PORTRAITS[(depart + i) % n]!;
    if (!occupes.has(p.id)) return p.id;
  }
  return voulu ?? PORTRAITS[depart]!.id;
}

/** Une graine stable tirée d'un texte (l'identifiant du projet). */
export function graineDe(texte: string): number {
  let h = 0;
  for (let i = 0; i < texte.length; i++) h = (h * 31 + texte.charCodeAt(i)) | 0;
  return Math.abs(h);
}

const COULEUR = /^#[0-9a-f]{6}$/i;
/** La couleur d'un agent : la sienne si elle est lisible, sinon celle de son portrait. */
export function couleurDeLAgent(couleur: string | null | undefined, portrait: string | null | undefined): string {
  if (couleur && COULEUR.test(couleur)) return couleur.toLowerCase();
  return couleurDuPortrait(portrait);
}

export function couleurLue(v: unknown): string | null {
  return typeof v === 'string' && COULEUR.test(v.trim()) ? v.trim().toLowerCase() : null;
}

/* ------------------------------------------------------------------ */
/* L'état d'un membre                                                  */
/* ------------------------------------------------------------------ */

export type EtatDuMembre = 'vous-attend' | 'au-travail' | 'repos';

/**
 * L'ÉTAT D'UN MEMBRE, en FORMES à l'écran (point = vous attend, anneau = au travail, rien = au repos). Ce qui attend
 * l'utilisateur passe avant tout : un agent qui travaille ET attend une réponse « vous attend ».
 */
export function etatDuMembre(m: { attentes: number; enPassage: boolean; tachesQuiAttendent?: number; tachesAuTravail?: number }): EtatDuMembre {
  if (m.attentes > 0 || (m.tachesQuiAttendent ?? 0) > 0) return 'vous-attend';
  if (m.enPassage || (m.tachesAuTravail ?? 0) > 0) return 'au-travail';
  return 'repos';
}

/** L'ordre d'affichage : qui attend, puis qui travaille, puis le repos ; à égalité, l'ordre de l'équipe. */
export function rangDeLEtat(e: EtatDuMembre): number {
  return e === 'vous-attend' ? 0 : e === 'au-travail' ? 1 : 2;
}

/* ------------------------------------------------------------------ */
/* Les échanges entre agents                                           */
/* ------------------------------------------------------------------ */

/** « vous » : l'utilisateur ; « equipe » : toute l'équipe ; sinon l'identifiant d'un agent d'équipe. */
export type PartieDEchange = string;
export const VOUS = 'vous';
export const TOUTE_L_EQUIPE = 'equipe';

export interface EchangeDAgents {
  id: string;
  projectId: string;
  de: PartieDEchange;
  a: PartieDEchange;
  texte: string;
  date: number;
  /** La tâche née de l'échange (une demande au développement), s'il y en a une. */
  cardId?: string | null;
  /** L'échange auquel celui-ci répond. */
  enReponseA?: string | null;
  /** La profondeur de la chaîne : 0 pour une demande de l'utilisateur, +1 à chaque relais entre agents. */
  profondeur: number;
}

/** UN MESSAGE À TOUTE L'ÉQUIPE va à l'agent dont le métier correspond, à défaut au développement. */
const MOTS_DU_ROLE: ReadonlyArray<readonly [RoleDEquipier, RegExp]> = [
  ['deploiement', /\b(d[ée]plo[iy]\w*|mettre en ligne|mise en ligne|livr\w*)\b/i],
  ['production', /\b(production|panne|en ligne\s+tomb|sauvegarde\w*|s[ée]curit[ée]|disponibilit[ée]|surveill\w*)\b/i],
  ['com', /\b(post\w*|publication\w*|r[ée]seaux?|linkedin|instagram|facebook|tiktok|calendrier|newsletter|communication|vid[ée]o\w*|visuel\w*)\b/i],
  ['marketing', /\b(marketing|r[ée]f[ée]rencement|seo|geo|concurren\w*|march[ée]|statistiques?|visites?|offre\w*|prix|cible\w*)\b/i],
];

export function destinataireDuMessage<M extends { id: string; role: RoleDEquipier }>(texte: string, membres: readonly M[]): M | null {
  for (const [role, motif] of MOTS_DU_ROLE) {
    if (!motif.test(texte)) continue;
    const m = membres.find((x) => x.role === role);
    if (m) return m;
  }
  return membres.find((x) => x.role === 'dev') ?? membres[0] ?? null;
}

/** LES BORNES DE LA GARDE ANTI-BOUCLE (dépense et ping-pong). */
export const PROFONDEUR_MAX_D_ECHANGE = 3;
export const ECHANGES_PAR_HEURE_ENTRE_DEUX = 6;
export const ECHANGES_PAR_HEURE_DANS_L_EQUIPE = 40;

/**
 * LA GARDE ANTI-BOUCLE : rend la raison d'un refus, ou `null`. Un agent ne se demande rien à lui-même ; une chaîne de
 * relais ne dépasse pas trois maillons ; deux agents n'échangent pas plus de six fois par heure (dans les deux sens) ;
 * une équipe pas plus de quarante. Les demandes de l'utilisateur ne sont jamais refusées ici.
 */
export function refusDEchange(
  demande: { de: PartieDEchange; a: PartieDEchange; profondeur: number },
  recents: readonly Pick<EchangeDAgents, 'de' | 'a' | 'date'>[],
  maintenant: number,
): string | null {
  if (demande.de === VOUS) return null;
  if (demande.de === demande.a) return 'Un agent ne se demande rien à lui-même.';
  if (demande.profondeur > PROFONDEUR_MAX_D_ECHANGE)
    return `Chaîne trop longue : ${PROFONDEUR_MAX_D_ECHANGE} relais au plus entre agents pour une même demande. Réponds toi-même ou demande à l’utilisateur.`;
  const heure = recents.filter((e) => e.date > maintenant - 3_600_000 && e.de !== VOUS && e.a !== VOUS);
  const entreEux = heure.filter((e) => (e.de === demande.de && e.a === demande.a) || (e.de === demande.a && e.a === demande.de)).length;
  if (entreEux >= ECHANGES_PAR_HEURE_ENTRE_DEUX)
    return `Trop d’échanges entre ces deux agents cette heure-ci (${ECHANGES_PAR_HEURE_ENTRE_DEUX} au plus) : vous tournez en rond. Tranche toi-même, ou pose la question à l’utilisateur.`;
  if (heure.length >= ECHANGES_PAR_HEURE_DANS_L_EQUIPE) return `L’équipe a atteint ${ECHANGES_PAR_HEURE_DANS_L_EQUIPE} échanges cette heure-ci : attends la suivante.`;
  return null;
}

/**
 * LES LIAISONS DE LA TABLE : une par paire d'agents qui ont échangé dans la fenêtre (24 h par défaut), la plus récente
 * en premier. L'utilisateur n'est jamais une liaison : il est au centre, relié en pointillé à qui l'attend.
 */
export function liaisonsDeLEquipe(
  echanges: readonly Pick<EchangeDAgents, 'de' | 'a' | 'date'>[],
  membres: ReadonlySet<string>,
  maintenant: number,
  fenetreMs = 86_400_000,
): [string, string][] {
  const vues = new Map<string, { paire: [string, string]; date: number }>();
  for (const e of echanges) {
    if (e.date < maintenant - fenetreMs) continue;
    if (!membres.has(e.de) || !membres.has(e.a) || e.de === e.a) continue;
    const paire: [string, string] = e.de < e.a ? [e.de, e.a] : [e.a, e.de];
    const cle = paire.join('|');
    const deja = vues.get(cle);
    if (!deja || deja.date < e.date) vues.set(cle, { paire, date: e.date });
  }
  return [...vues.values()].sort((a, b) => b.date - a.date).map((v) => v.paire);
}

/* ------------------------------------------------------------------ */
/* La géométrie de la table                                            */
/* ------------------------------------------------------------------ */

export interface CadreDeLaTable {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  rayon: number;
}

/**
 * LES PLACES AUTOUR DE LA TABLE : `n` points répartis à PAS ÉGAL sur le contour d'un rectangle arrondi, le premier en
 * haut au centre, dans le sens des aiguilles d'une montre (maquette « la table », #1ff2).
 */
export function placesAutourDeLaTable(n: number, c: CadreDeLaTable): { x: number; y: number }[] {
  if (n <= 0) return [];
  const r = Math.max(0, Math.min(c.rayon, (c.x1 - c.x0) / 2, (c.y1 - c.y0) / 2));
  const quart = (Math.PI * r) / 2;
  // Les morceaux du contour, depuis le haut au centre, sens horaire.
  const morceaux: { longueur: number; point: (t: number) => { x: number; y: number } }[] = [];
  const mid = (c.x0 + c.x1) / 2;
  const droit = (ax: number, ay: number, bx: number, by: number) => ({
    longueur: Math.hypot(bx - ax, by - ay),
    point: (t: number) => ({ x: ax + (bx - ax) * t, y: ay + (by - ay) * t }),
  });
  const arc = (cx: number, cy: number, a0: number, a1: number) => ({
    longueur: quart,
    point: (t: number) => {
      const a = ((a0 + (a1 - a0) * t) * Math.PI) / 180;
      return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
    },
  });
  morceaux.push(droit(mid, c.y0, c.x1 - r, c.y0));
  morceaux.push(arc(c.x1 - r, c.y0 + r, -90, 0));
  morceaux.push(droit(c.x1, c.y0 + r, c.x1, c.y1 - r));
  morceaux.push(arc(c.x1 - r, c.y1 - r, 0, 90));
  morceaux.push(droit(c.x1 - r, c.y1, c.x0 + r, c.y1));
  morceaux.push(arc(c.x0 + r, c.y1 - r, 90, 180));
  morceaux.push(droit(c.x0, c.y1 - r, c.x0, c.y0 + r));
  morceaux.push(arc(c.x0 + r, c.y0 + r, 180, 270));
  morceaux.push(droit(c.x0 + r, c.y0, mid, c.y0));
  const total = morceaux.reduce((s, m) => s + m.longueur, 0) || 1;
  const places: { x: number; y: number }[] = [];
  for (let k = 0; k < n; k++) {
    let cible = (total * k) / n;
    for (const m of morceaux) {
      if (cible <= m.longueur || m === morceaux[morceaux.length - 1]) {
        const p = m.point(m.longueur ? Math.min(1, cible / m.longueur) : 0);
        places.push({ x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 });
        break;
      }
      cible -= m.longueur;
    }
  }
  return places;
}

/** LE POINT DE CONTRÔLE d'une liaison : le milieu des deux agents, tiré à moitié vers le centre de la table. */
export function controleDeLaLiaison(a: { x: number; y: number }, b: { x: number; y: number }, centre: { x: number; y: number }): { x: number; y: number } {
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  return { x: mx + (centre.x - mx) * 0.5, y: my + (centre.y - my) * 0.5 };
}

/**
 * LA TAILLE DES PORTRAITS SELON LE NOMBRE D'AGENTS AUTOUR DE LA TABLE : 54 px jusqu'à dix, puis plus petits ; au-delà de
 * vingt, la table défile (les places restent lisibles).
 */
export function tailleDesPortraits(n: number): number {
  if (n <= 10) return 54;
  if (n <= 14) return 46;
  if (n <= 20) return 40;
  return 36;
}

export function portraitConnu(id: string | null | undefined): boolean {
  return !!id && PORTRAITS.some((p) => p.id === id);
}

/* ------------------------------------------------------------------ */
/* Qui s'assied à la table                                             */
/* ------------------------------------------------------------------ */

/**
 * QUI S'ASSIED À LA TABLE, QUI RESTE SUR LE BANC (maquette #1ff2) : à la table, ceux qui attendent l'utilisateur puis
 * ceux qui travaillent ; au repos, les autres, en petit. Une équipe calme ne laisse pas la table vide : tant que moins
 * de trois agents agissent, les agents au repos complètent la table jusqu'à `pleine` places (l'équipe par défaut s'y
 * voit entière).
 */
export function repartirLaTable<M extends { id: string; etat: EtatDuMembre }>(membres: readonly M[], pleine = 8): { aTable: M[]; auRepos: M[] } {
  const actifs = membres.filter((m) => m.etat !== 'repos').sort((a, b) => rangDeLEtat(a.etat) - rangDeLEtat(b.etat));
  const repos = membres.filter((m) => m.etat === 'repos');
  if (actifs.length >= 3) return { aTable: actifs, auRepos: repos };
  const places = Math.max(0, Math.min(pleine, membres.length) - actifs.length);
  return { aTable: [...actifs, ...repos.slice(0, places)], auRepos: repos.slice(places) };
}

/* ------------------------------------------------------------------ */
/* L'onglet « Tâches » d'un projet                                     */
/* ------------------------------------------------------------------ */

export const GROUPES_DE_TACHES = ['vous-attendent', 'en-cours', 'planifiees', 'pretes', 'terminees'] as const;
export type GroupeDeTaches = (typeof GROUPES_DE_TACHES)[number];

/** Le groupe d'une tâche, depuis l'état de sa ligne (`etat-d-agent-en-liste.ts`). */
export function groupeDeLaTache(etat: string): GroupeDeTaches {
  switch (etat) {
    case 'a-vous':
    case 'echec':
      return 'vous-attendent';
    case 'travail':
    case 'cadrage':
    case 'lance':
    case 'en-pause':
      return 'en-cours';
    case 'brouillon':
      return 'planifiees';
    case 'a-deployer':
      return 'pretes';
    default:
      return 'terminees';
  }
}
