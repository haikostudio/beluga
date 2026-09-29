/**
 * LE REGISTRE DES MOTEURS — LE SEUL ENDROIT OÙ UN MOTEUR INTÉGRÉ SE DÉCLARE.
 * Les moteurs AJOUTÉS depuis les réglages (fiches en base, `ext-…`) passent
 * par `poserLesMoteursAjoutes`, et les mêmes fonctions les rendent.
 *
 * Avant lui, la liste « claude, codex, cursor » était recopiée dans une
 * vingtaine de fichiers (schémas, menus, comptes, quotas, icônes) : ajouter un
 * moteur demandait de les retrouver tous, et un oubli laissait un écran qui ne
 * le montrait pas. Chaque trait qui DIFFÉRENCIE un moteur des autres vit donc
 * ici, et le reste du code lit ce registre au lieu de nommer un moteur.
 *
 * Ajouter un moteur : une entrée ici, un adaptateur dans
 * `server/src/engines/`, et sa lecture de quota dans `server/src/accounts.ts`.
 * L'interface (menus, réglages des comptes, volet des quotas, icône) suit seule.
 *
 * Aucun import : `models.ts` en dérive `EngineId`, il ne doit rien importer
 * en retour.
 */

export interface DescriptionMoteur {
  id: string;
  /** Le libellé complet, pour les réglages et les infobulles. */
  label: string;
  /** Le nom qu'on dit à l'oral : « Claude », « GPT », « Cursor », « MiMo ». */
  nomCourt: string;
  /**
   * Comment un compte s'ouvre : par une PAGE de connexion qui remplit un coffre
   * sur le serveur (`page`), ou par une CLÉ d'accès saisie dans les réglages
   * (`cle`).
   */
  connexion: 'page' | 'cle';
  /**
   * Comment la consommation se lit : des FENÊTRES en pourcentage (cinq heures,
   * semaine) ou une DÉPENSE à l'usage, sans fenêtre.
   */
  facturation: 'fenetres' | 'depense';
  /** Le fichier d'instructions que lit l'outil sous-jacent. */
  instructions: 'CLAUDE.md' | 'AGENTS.md';
  /** La consigne système est-elle le préfixe (mis en cache) de la conversation ? */
  consigneEnTete: boolean;
  /** Un fil se reprend-il depuis un autre dossier de travail ? */
  repriseHorsDossier: boolean;
  /** Le fil est-il lié au MODÈLE (changer de modèle oblige à repartir) ? */
  filLieAuModele: boolean;
  /**
   * Peut-il être choisi SEUL, sans que personne l'ait demandé, pour une
   * publication ou une bascule automatique ? Un moteur payé à la dépense ne
   * l'est jamais : on ne dépense pas l'argent de l'utilisateur à sa place.
   */
  secoursAutomatique: boolean;
  /** L'outil en ligne de commande que l'adaptateur lance. */
  outil: string;
  /** La commande à coller dans un terminal du serveur pour installer cet outil. */
  commandeDInstallation: string;
  /** La page où l'on obtient une clé, pour un moteur `connexion: 'cle'`. */
  pageDesCles?: string;
}

export const MOTEURS = [
  {
    id: 'claude',
    label: 'Claude',
    nomCourt: 'Claude',
    connexion: 'page',
    facturation: 'fenetres',
    instructions: 'CLAUDE.md',
    consigneEnTete: true,
    repriseHorsDossier: true,
    filLieAuModele: false,
    secoursAutomatique: true,
    outil: 'claude',
    commandeDInstallation: 'curl -fsSL https://claude.ai/install.sh | bash',
  },
  {
    id: 'codex',
    label: 'Codex (GPT)',
    nomCourt: 'GPT',
    connexion: 'page',
    facturation: 'fenetres',
    instructions: 'AGENTS.md',
    consigneEnTete: false,
    repriseHorsDossier: true,
    filLieAuModele: true,
    secoursAutomatique: true,
    outil: 'codex',
    commandeDInstallation: 'npm install -g @openai/codex',
  },
  {
    id: 'cursor',
    label: 'Cursor',
    nomCourt: 'Cursor',
    connexion: 'cle',
    facturation: 'depense',
    instructions: 'AGENTS.md',
    consigneEnTete: false,
    repriseHorsDossier: false,
    filLieAuModele: false,
    secoursAutomatique: false,
    outil: 'cursor-agent',
    commandeDInstallation: 'curl https://cursor.com/install -fsS | bash',
  },
  /*
   * XIAOMI MIMO passe par l'outil de Claude, branché sur l'API compatible
   * Anthropic de Xiaomi (`server/src/engines/mimo.ts`) : mêmes fichiers
   * d'instructions, même reprise de fil, même préfixe de consigne. Seuls le
   * compte (une clé) et la facturation (à l'usage) diffèrent.
   */
  {
    id: 'mimo',
    label: 'Xiaomi MiMo',
    nomCourt: 'MiMo',
    connexion: 'cle',
    facturation: 'depense',
    instructions: 'CLAUDE.md',
    consigneEnTete: true,
    repriseHorsDossier: true,
    filLieAuModele: false,
    secoursAutomatique: false,
    outil: 'claude',
    commandeDInstallation: 'curl -fsSL https://claude.ai/install.sh | bash',
    pageDesCles: 'https://platform.xiaomimimo.com',
  },
] as const satisfies readonly DescriptionMoteur[];

/** Un moteur écrit dans ce fichier. */
export type IdDeMoteurIntegre = (typeof MOTEURS)[number]['id'];

/**
 * UN MOTEUR : intégré, ou AJOUTÉ par l'agent « Ajouter un moteur » (une fiche
 * en base, identifiant préfixé `ext-`). Le préfixe rend les deux impossibles à
 * confondre, et garde au type sa précision sur les moteurs intégrés.
 */
export type IdDeMoteur = IdDeMoteurIntegre | `ext-${string}`;

/** Les identifiants INTÉGRÉS, dans l'ordre du registre — celui des menus. */
export const IDS_MOTEURS = MOTEURS.map((m) => m.id) as unknown as readonly [IdDeMoteurIntegre, ...IdDeMoteurIntegre[]];

/** La forme d'un identifiant de moteur ajouté : `ext-` puis un nom court. */
export const FORME_ID_MOTEUR_AJOUTE = /^ext-[a-z0-9][a-z0-9-]{0,39}$/;

/** L'identifiant a-t-il la FORME d'un moteur (intégré ou ajouté) ? Ne dit pas s'il est actif. */
export function aLaFormeDUnMoteur(id: unknown): id is IdDeMoteur {
  return typeof id === 'string' && ((IDS_MOTEURS as readonly string[]).includes(id) || FORME_ID_MOTEUR_AJOUTE.test(id));
}

/* ------------------------------------------------------------------ */
/* Les moteurs AJOUTÉS                                                 */
/* ------------------------------------------------------------------ */

/**
 * LA FICHE D'UN MOTEUR AJOUTÉ. Elle ne décrit que ce qui change d'un
 * fournisseur à l'autre ; tout le reste est IMPOSÉ par sa famille
 * (`descriptionDeFiche`) — l'outil sous-jacent, le fichier d'instructions, la
 * reprise de fil. Un fournisseur qui n'imite ni l'API d'Anthropic ni celle
 * d'OpenAI n'a pas de fiche : il demande du développement.
 */
export interface FicheMoteur {
  id: `ext-${string}`;
  label: string;
  nomCourt: string;
  /** L'API imitée : `anthropic` passe par l'outil de Claude, `openai` par celui de Codex. */
  famille: 'anthropic' | 'openai';
  /**
   * L'adresse de base, telle que l'outil la reçoit : pour `anthropic`, celle
   * qui précède `/v1/messages` ; pour `openai`, celle qui précède `/responses`
   * (souvent terminée par `/v1`).
   */
  urlDeBase: string;
  /**
   * Famille `openai` : le format parlé par le fournisseur. `responses` (défaut)
   * est donné tel quel à l'outil de Codex ; `chat` (seulement
   * `/chat/completions`, comme Gemini) passe par le relais local du démon, qui
   * traduit — Codex ne parle plus que « responses ».
   */
  api?: 'responses' | 'chat';
  /** L'adresse complète de la liste des modèles (réponse au format OpenAI `{ data: [{ id }] }`). */
  urlDesModeles?: string;
  pageDesCles?: string;
  modeleParDefaut: string;
  /** Le modèle léger, servi aux appels de fond de l'outil de Claude. */
  modeleLeger?: string;
  /**
   * `essai` : déclarée, pas encore éprouvée ou épreuve ratée — invisible hors
   * de l'agent qui l'a créée. `actif` : l'épreuve est passée, le moteur sert.
   * `retire` : retiré depuis les comptes, il ne sert plus.
   */
  statut: 'essai' | 'actif' | 'retire';
  /** Le compte rendu de la dernière épreuve, en clair. */
  epreuve?: {
    ok: boolean;
    at: number;
    resume: string;
    /** Ce que l'épreuve a VU, pour dire si le moteur peut faire tourner des agents. */
    constat?: { cleAcceptee: boolean; cleRefusee?: boolean; formatReconnu: boolean; outilUtilise: boolean; reponseJuste: boolean };
  };
  /** La carte du tableau qui suit l'ajout de ce moteur (sa conversation, son état). */
  carteId?: string;
  creeLe: number;
}

/** Ce que la famille impose à une fiche : l'outil, les instructions, la reprise. */
export function descriptionDeFiche(fiche: FicheMoteur): DescriptionMoteur {
  const anthropic = fiche.famille === 'anthropic';
  return {
    id: fiche.id,
    label: fiche.label,
    nomCourt: fiche.nomCourt,
    connexion: 'cle',
    // Une clé tierce se paie à l'usage : jamais de jauge inventée.
    facturation: 'depense',
    instructions: anthropic ? 'CLAUDE.md' : 'AGENTS.md',
    consigneEnTete: anthropic,
    repriseHorsDossier: true,
    filLieAuModele: !anthropic,
    // On ne dépense jamais l'argent de l'utilisateur à sa place.
    secoursAutomatique: false,
    outil: anthropic ? 'claude' : 'codex',
    commandeDInstallation: anthropic ? 'curl -fsSL https://claude.ai/install.sh | bash' : 'npm install -g @openai/codex',
    ...(fiche.pageDesCles ? { pageDesCles: fiche.pageDesCles } : {}),
  };
}

/**
 * LES FICHES CONNUES DE CE PROCESSUS. Le démon les pose depuis la base au
 * démarrage et à chaque changement ; le navigateur, depuis l'événement qui les
 * diffuse. Rien d'autre n'écrit ici.
 */
let fichesConnues: readonly FicheMoteur[] = [];

export function poserLesMoteursAjoutes(fiches: readonly FicheMoteur[]): void {
  fichesConnues = fiches.filter((f) => FORME_ID_MOTEUR_AJOUTE.test(f.id));
}

/** Les fiches ACTIVES : les seules qui existent pour le reste de l'application. */
export function moteursAjoutesActifs(): FicheMoteur[] {
  return fichesConnues.filter((f) => f.statut === 'actif');
}

/** La fiche d'un moteur ajouté, quel que soit son statut. */
export function ficheDuMoteur(id: string | null | undefined): FicheMoteur | undefined {
  return fichesConnues.find((f) => f.id === id);
}

/** Tous les moteurs utilisables : intégrés, puis ajoutés actifs. */
export function tousLesMoteurs(): DescriptionMoteur[] {
  return [...(MOTEURS as readonly DescriptionMoteur[]), ...moteursAjoutesActifs().map(descriptionDeFiche)];
}

/** Les identifiants utilisables, dans l'ordre des menus. */
export function idsDesMoteurs(): IdDeMoteur[] {
  return tousLesMoteurs().map((m) => m.id as IdDeMoteur);
}

/**
 * La description d'un moteur ; `undefined` pour un identifiant inconnu
 * (ancienne base, faute de frappe) ou un moteur ajouté qui n'est pas actif.
 */
export function descriptionMoteur(id: string | null | undefined): DescriptionMoteur | undefined {
  return tousLesMoteurs().find((m) => m.id === id);
}

/** Cet identifiant est-il un moteur utilisable ? */
export function estUnMoteur(id: unknown): id is IdDeMoteur {
  return typeof id === 'string' && descriptionMoteur(id) !== undefined;
}

/** Le nom court, avec un repli lisible pour un moteur inconnu. */
export function nomCourtDuMoteur(id: string | null | undefined, repli?: string): string {
  return descriptionMoteur(id)?.nomCourt ?? ficheDuMoteur(id)?.nomCourt ?? repli ?? (id || 'moteur');
}

/** Les moteurs dont un compte s'ouvre par une page de connexion. */
export function moteursParPage(): IdDeMoteur[] {
  return tousLesMoteurs().filter((m) => m.connexion === 'page').map((m) => m.id as IdDeMoteur);
}

/** Les moteurs dont un compte se déclare par une clé d'accès. */
export function moteursParCle(): IdDeMoteur[] {
  return tousLesMoteurs().filter((m) => m.connexion === 'cle').map((m) => m.id as IdDeMoteur);
}

/** Les moteurs qu'une bascule automatique a le droit de choisir seule. */
export function moteursDeSecours(): IdDeMoteur[] {
  return tousLesMoteurs().filter((m) => m.secoursAutomatique).map((m) => m.id as IdDeMoteur);
}
