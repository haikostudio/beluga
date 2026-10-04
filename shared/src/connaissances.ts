/**
 * LA BASE DE CONNAISSANCES — les règles pures, sans base ni disque.
 *
 * Trois niveaux :
 *   - GLOBAL : ce qui vaut pour tous les projets ;
 *   - PROJETS : ce que sait chaque projet ;
 *   - WORKING : le brouillon d'une carte, jamais servi comme mémoire longue,
 *     purgé à la fermeture de la carte.
 *
 * La mémoire n'est plus un texte que chaque agent réécrit : c'est une suite
 * d'UNITÉS TYPÉES (une décision, une convention, un composant…), chacune avec
 * son identifiant stable (MEM-0042, DEC-007), son importance, sa confiance, sa
 * source et ses liens. Une unité ne s'efface jamais : elle se DÉPRÉCIE, et
 * celle qui la remplace le dit (`supersedes` / `supersededBy`).
 *
 * La base fait foi. Les FICHES MARKDOWN NUMÉROTÉES (00_project … 12_lessons)
 * sont RENDUES depuis elle, au gabarit strict de leur type, pour être lues par
 * un humain ou listées par un agent. Le CHANGELOG de chaque projet est une suite
 * d'entrées datées, rendue de la même façon.
 *
 * On trouve ici : la taxonomie, la table type → fiche, le jugement d'une
 * proposition (dont le test des quatre questions et les contenus interdits),
 * le dédoublonnage par titre, les gabarits et le rendu des fiches, le
 * changelog (lecture de git et de l'historique, catégories, rendu), la
 * pondération de la recherche et le texte d'accueil des agents. Le travail réel
 * vit dans `server/src/connaissances.ts`.
 */

/* ------------------------------------------------------------------ */
/* Taxonomie                                                            */
/* ------------------------------------------------------------------ */

/** La taxonomie FERMÉE : quatorze types, pas un de plus. */
export const TYPES_UNITE = [
  'project',
  'requirement',
  'decision',
  'architecture',
  'domain',
  'convention',
  'constraint',
  'component',
  'integration',
  'issue',
  'lesson',
  'environment',
  'operation',
  'security',
] as const;
export type TypeUnite = (typeof TYPES_UNITE)[number];

export const LIBELLE_TYPE: Readonly<Record<TypeUnite, string>> = {
  project: 'Projet',
  requirement: 'Exigence',
  decision: 'Décision',
  architecture: 'Architecture',
  domain: 'Domaine',
  convention: 'Convention',
  constraint: 'Contrainte',
  component: 'Composant',
  integration: 'Intégration',
  issue: 'Problème connu',
  lesson: 'Leçon',
  environment: 'Environnement',
  operation: 'Exploitation',
  security: 'Sécurité',
};

/**
 * CE QUI ENTRE DANS CHAQUE TYPE, ET CE QUI N'Y ENTRE PAS. Une phrase valable
 * pour tous les genres de projets (SaaS, site client, VPS, outil interne) :
 * elle est lue par le modèle de génération, par l'outil « memoire », par le
 * reclassement et, traduite, sous le titre de la fiche à l'écran.
 */
export const DEFINITION_TYPE: Readonly<Record<TypeUnite, string>> = {
  project: 'Ce qu’est le projet : sa raison d’être, pour qui, sa pile, où il tourne ; pas une règle ni le détail d’un fonctionnement.',
  requirement: 'Ce que le produit doit faire ou garantir, tel que l’utilisateur ou le client le demande ; pas la manière de le construire.',
  decision: 'Un choix tranché entre plusieurs options, avec son pourquoi ; pas une règle sans alternative ni un simple constat.',
  architecture: 'L’organisation d’ensemble : les grandes pièces, leurs liens, le chemin des données ; pas le détail d’un seul écran ou module.',
  domain: 'Les règles et le vocabulaire du métier servi : entités, états, cycles de vie ; pas un stockage technique ni un comportement lié à un service tiers.',
  convention: 'Une manière de faire propre au code ou à l’équipe : nommage, style, rangement, procédure de travail ; pas un interdit dont l’oubli casse quelque chose.',
  constraint: 'Une limite ou un interdit à respecter sous peine de casse : plafond, geste interdit, ordre imposé ; pas une simple préférence.',
  component: 'Une pièce précise du produit (écran, module, service interne) : ce qu’elle fait et où elle vit ; pas l’organisation d’ensemble.',
  integration: 'Un service extérieur et la façon de s’y relier : API, courriel, paiement, webhook ; pas un service interne au projet.',
  issue: 'Un défaut connu et encore présent, avec son symptôme et son contournement ; pas un défaut déjà corrigé, qui devient une leçon.',
  lesson: 'Un piège déjà rencontré et ce qu’il a appris, pour ne pas le refaire ; pas un défaut encore ouvert.',
  environment: 'Là où le projet tourne : serveur, versions, ports, dossiers, variables ; pas la marche à suivre pour l’exploiter.',
  operation: 'Comment exploiter le projet : déployer, sauvegarder, redémarrer, se connecter, lancer un script ; pas la description de la machine.',
  security: 'Ce qui protège les accès et les données : authentification, droits, chiffrement, secrets, données sensibles ; pas une limite sans enjeu de protection.',
};

/** Les définitions, une ligne par type : ce que lisent le modèle de génération et le reclassement. */
export function texteDesDefinitions(): string {
  return TYPES_UNITE.map((t) => `- ${t} (${LIBELLE_TYPE[t]}) : ${DEFINITION_TYPE[t]}`).join('\n');
}

export const IMPORTANCES_UNITE = ['P0', 'P1', 'P2', 'P3'] as const;
export type Importance = (typeof IMPORTANCES_UNITE)[number];

export const STATUTS_UNITE = ['active', 'deprecated'] as const;
export type StatutUnite = (typeof STATUTS_UNITE)[number];

/**
 * D'où vient une unité : une carte, un commit, une ancienne note reprise, le dépôt, l'écran, le rangement de nuit —
 * ou une COMPÉTENCE du pool partagé (`ref` = le nom de sa fiche), synchronisée par `server/src/competences-memoire.ts`.
 */
export const GENRES_SOURCE = ['carte', 'commit', 'note', 'depot', 'ecran', 'nuit', 'generation', 'competence'] as const;
export type GenreSource = (typeof GENRES_SOURCE)[number];

export interface SourceUnite {
  genre: GenreSource;
  /** La branche, le commit, le code de l'ancienne note, le fichier… */
  ref: string;
}

/** La portée d'une unité : « global », ou l'identifiant d'un projet. */
export const PORTEE_GLOBALE = 'global';

export interface Unite {
  /** MEM-0042, ou DEC-007 pour une décision. */
  id: string;
  portee: string;
  type: TypeUnite;
  sujets: string[];
  titre: string;
  resume: string;
  detail: string;
  raisonnement: string;
  statut: StatutUnite;
  importance: Importance;
  /** De 0 à 1. */
  confiance: number;
  source: SourceUnite;
  liens: string[];
  supersedes: string | null;
  supersededBy: string | null;
  /** L'unité rejoint le bloc « À ne jamais supposer » de 00_project. */
  jamaisSupposer: boolean;
  /** Confirmée par un humain à l'écran. */
  relue: boolean;
  version: number;
  auteur: string;
  creeLe: number;
  modifieLe: number;
}

/** Le préfixe d'identifiant d'un type : les décisions ont le leur. */
export function prefixeDuType(type: TypeUnite): 'DEC' | 'MEM' {
  return type === 'decision' ? 'DEC' : 'MEM';
}

export function formaterIdentifiant(type: TypeUnite, numero: number): string {
  const prefixe = prefixeDuType(type);
  return `${prefixe}-${String(numero).padStart(prefixe === 'DEC' ? 3 : 4, '0')}`;
}

/**
 * LE TYPE QU'UN MODÈLE A VOULU DIRE. La génération reçoit parfois « règle »,
 * « piège » ou « infrastructure » au lieu d'un type de la taxonomie : ces mots
 * courants se ramènent à leur type. La taxonomie reste FERMÉE pour les agents —
 * seule la génération passe par ici avant la porte.
 */
const SYNONYMES_DE_TYPE: Readonly<Record<string, TypeUnite>> = {
  regle: 'convention',
  rule: 'convention',
  pratique: 'convention',
  interdit: 'constraint',
  limite: 'constraint',
  piege: 'lesson',
  pitfall: 'lesson',
  gotcha: 'lesson',
  lecon: 'lesson',
  fait: 'project',
  fact: 'project',
  infrastructure: 'environment',
  infra: 'environment',
  serveur: 'environment',
  acces: 'operation',
  access: 'operation',
  deploiement: 'operation',
  deployment: 'operation',
  credential: 'security',
  secret: 'security',
  bug: 'issue',
  probleme: 'issue',
  fonctionnalite: 'component',
  feature: 'component',
  ecran: 'component',
  service: 'integration',
  api: 'integration',
  besoin: 'requirement',
  exigence: 'requirement',
  metier: 'domain',
  choix: 'decision',
};

export function typeReconnu(brut: unknown): TypeUnite | null {
  const cle = sansAccentsLocal(String(brut ?? '')).trim().toLowerCase().replace(/[^a-z]/g, '');
  if ((TYPES_UNITE as readonly string[]).includes(cle)) return cle as TypeUnite;
  return SYNONYMES_DE_TYPE[cle] ?? SYNONYMES_DE_TYPE[cle.replace(/s$/, '')] ?? null;
}

export function estIdentifiantDUnite(texte: string): boolean {
  return /^(MEM-\d{4,}|DEC-\d{3,})$/.test(String(texte ?? '').trim().toUpperCase());
}

/* ------------------------------------------------------------------ */
/* Les fiches numérotées                                                */
/* ------------------------------------------------------------------ */

export interface FicheNumerotee {
  id: string;
  titre: string;
  types: readonly TypeUnite[];
  /** Fiche des compétences : elle réunit les unités par leur SOURCE, jamais par leur type. */
  competences?: boolean;
}

/** Ce que la fiche « Compétences » réunit, dit à l'écran Mémoire. */
export const DEFINITION_COMPETENCES =
  'Les modes d’emploi déjà écrits que les agents suivent : ceux du Global valent pour tous les projets, ceux d’un projet ne valent que pour lui.';

/** Le genre de SOURCE qui marque l'unité d'une compétence ; `ref` porte le nom de la fiche. */
export const GENRE_SOURCE_COMPETENCE = 'competence' as const;

/** L'unité est-elle celle d'une compétence ? Reconnu à sa source, jamais à son titre. */
export function estUniteDeCompetence(u: Pick<Unite, 'source'>): boolean {
  return u.source?.genre === GENRE_SOURCE_COMPETENCE && Boolean(u.source.ref);
}

const PREFIXE_SUJET_PROJET = 'projet-';

/** Le sujet qui rattache une compétence à un projet (par son nom, dans le champ « projets » de la fiche). */
export function sujetDeProjetDeCompetence(nomDuProjet: string): string {
  return idDeSujetDUnite(`${PREFIXE_SUJET_PROJET}${nomDuProjet}`);
}

function estCompetenceDeProjet(u: Pick<Unite, 'sujets'>): boolean {
  return u.sujets.some((s) => s.startsWith(PREFIXE_SUJET_PROJET));
}

/**
 * LA COMPÉTENCE PROPRE À UN AUTRE PROJET NE REMONTE PAS DANS LA RECHERCHE D'UN
 * PROJET. Toutes les compétences vivent dans le classeur Global ; depuis que
 * chaque projet écrit les siennes à la fin de chaque carte (2026-10-02), une
 * recherche sur « barre de sélection » depuis ProjetA remonterait celle de
 * ProjetB. Une compétence COMMUNE (sans sujet `projet-…`) et celle de CE projet
 * passent ; une unité qui n'est pas une compétence n'est jamais concernée.
 */
export function competenceDUnAutreProjet(u: Pick<Unite, 'source' | 'sujets'>, nomDuProjet: string): boolean {
  if (!estUniteDeCompetence(u) || !estCompetenceDeProjet(u)) return false;
  return !u.sujets.includes(sujetDeProjetDeCompetence(nomDuProjet));
}

/**
 * L'unité range-t-elle dans cette fiche ? Une compétence n'est JAMAIS dans une fiche de type :
 * elle est dans « Compétences » — celle du Global si elle vaut pour tous, celle du projet
 * (`projetNom`) si sa fiche le nomme.
 */
export function uniteDansLaFiche(fiche: FicheNumerotee, u: Pick<Unite, 'type' | 'source' | 'sujets'>, projetNom?: string): boolean {
  if (fiche.competences) {
    if (!estUniteDeCompetence(u)) return false;
    return projetNom ? u.sujets.includes(sujetDeProjetDeCompetence(projetNom)) : !estCompetenceDeProjet(u);
  }
  return !estUniteDeCompetence(u) && fiche.types.includes(u.type);
}

/** Les fiches d'un projet, dans l'ordre. Chaque type n'a qu'une fiche d'arrivée. */
export const FICHES_PROJET: readonly FicheNumerotee[] = [
  { id: '00_project', titre: 'Projet', types: ['project'] },
  { id: '01_requirements', titre: 'Exigences', types: ['requirement'] },
  { id: '02_architecture', titre: 'Architecture', types: ['architecture'] },
  { id: '03_domain', titre: 'Domaine', types: ['domain'] },
  { id: '04_conventions', titre: 'Conventions', types: ['convention'] },
  { id: '05_decisions', titre: 'Décisions', types: ['decision'] },
  { id: '06_components', titre: 'Composants', types: ['component'] },
  { id: '07_integrations', titre: 'Intégrations', types: ['integration'] },
  { id: '08_constraints', titre: 'Contraintes et sécurité', types: ['constraint', 'security'] },
  { id: '09_environment', titre: 'Environnement', types: ['environment'] },
  { id: '10_operations', titre: 'Exploitation et accès', types: ['operation'] },
  { id: '11_issues', titre: 'Problèmes connus', types: ['issue'] },
  { id: '12_lessons', titre: 'Leçons', types: ['lesson'] },
  { id: '13_skills', titre: 'Compétences', types: [], competences: true },
];

/** Les fiches du Global : moins nombreuses, les mêmes types regroupés. */
export const FICHES_GLOBAL: readonly FicheNumerotee[] = [
  { id: '00_principles', titre: 'Principes', types: ['project', 'requirement', 'constraint'] },
  { id: '01_conventions', titre: 'Conventions', types: ['convention'] },
  { id: '02_architecture', titre: 'Architecture et composants', types: ['architecture', 'component', 'domain'] },
  { id: '03_decisions', titre: 'Décisions', types: ['decision'] },
  { id: '04_integrations', titre: 'Intégrations', types: ['integration'] },
  { id: '05_operations', titre: 'Environnement, exploitation et sécurité', types: ['environment', 'operation', 'security'] },
  { id: '06_lessons', titre: 'Leçons et problèmes', types: ['lesson', 'issue'] },
  { id: '07_skills', titre: 'Compétences', types: [], competences: true },
];

export function fichesDeLaPortee(portee: string): readonly FicheNumerotee[] {
  return portee === PORTEE_GLOBALE ? FICHES_GLOBAL : FICHES_PROJET;
}

/** La fiche d'arrivée d'un type, dans une portée. */
export function ficheDuType(portee: string, type: TypeUnite): FicheNumerotee {
  return fichesDeLaPortee(portee).find((f) => f.types.includes(type))!;
}

/** La fiche d'arrivée d'une unité : celle des compétences pour une compétence, sinon celle de son type. */
export function ficheDeLUnite(u: Pick<Unite, 'portee' | 'type' | 'source'>): FicheNumerotee {
  if (estUniteDeCompetence(u)) return fichesDeLaPortee(u.portee).find((f) => f.competences)!;
  return ficheDuType(u.portee, u.type);
}

/** Une fiche désignée par son numéro, son identifiant ou son titre (« 05 », « decisions », « Décisions »). */
export function ficheParNom(portee: string, nom: string): FicheNumerotee | null {
  const cle = cleNormale(nom).replace(/\s+/g, '_');
  if (!cle) return null;
  const fiches = fichesDeLaPortee(portee);
  return (
    fiches.find((f) => f.id === cle || f.id.slice(0, 2) === cle.padStart(2, '0') || f.id.slice(3) === cle) ??
    fiches.find((f) => cleNormale(f.titre).replace(/\s+/g, '_') === cle || f.id.slice(3).startsWith(cle)) ??
    fiches.find((f) => f.types.some((t) => t === cle || cleNormale(LIBELLE_TYPE[t]) === cle.replace(/_/g, ' '))) ??
    null
  );
}

/* ------------------------------------------------------------------ */
/* Texte normalisé                                                      */
/* ------------------------------------------------------------------ */

function sansAccentsLocal(texte: string): string {
  return String(texte ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

export function cleNormale(texte: string): string {
  return sansAccentsLocal(texte)
    .toLowerCase()
    .replace(/[`*_"«»“”'’.,;:!?()[\]{}<>|/\\#-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const MOTS_VIDES = new Set(
  'le la les un une des de du d l et ou a au aux en dans sur pour par avec sans ne pas plus que qui quoi est sont se sa son ses ce cet cette ces il elle on the of to and or in on for with is are be it its'.split(
    ' ',
  ),
);

/** Le titre tel qu'il sert au dédoublonnage : sans accents, ponctuation ni mots vides. */
export function titreNormalise(titre: string): string {
  return cleNormale(titre)
    .split(' ')
    .filter((m) => m && !MOTS_VIDES.has(m))
    .join(' ');
}

function motsSignificatifs(texte: string): Set<string> {
  return new Set(
    cleNormale(texte)
      .split(' ')
      .filter((m) => m.length > 2 && !MOTS_VIDES.has(m))
      .map((m) => m.slice(0, 7)),
  );
}

/** La ressemblanceDeTextes de deux textes, de 0 à 1 (recouvrement des mots significatifs). */
export function ressemblanceDeTextes(a: string, b: string): number {
  const ma = motsSignificatifs(a);
  const mb = motsSignificatifs(b);
  if (!ma.size || !mb.size) return 0;
  let communs = 0;
  for (const m of ma) if (mb.has(m)) communs++;
  return (2 * communs) / (ma.size + mb.size);
}

/** Au-dessus de ce seuil (titre et résumé), une proposition est un doublon d'une unité du même type. */
export const SEUIL_DOUBLON_TEXTE = 0.8;
/** Au-dessus de ce cosinus, une proposition est un doublon par le sens. */
export const SEUIL_DOUBLON_SENS = 0.93;

/* ------------------------------------------------------------------ */
/* Le jugement d'une proposition                                         */
/* ------------------------------------------------------------------ */

export const ACTIONS_PROPOSITION = ['create', 'update', 'deprecate'] as const;
export type ActionProposition = (typeof ACTIONS_PROPOSITION)[number];

/** Ce qu'un agent (ou la génération, ou l'écran) propose. Le moteur garde la main sur le reste. */
export interface PropositionUnite {
  action?: ActionProposition;
  /** L'unité visée par « update » ou « deprecate ». */
  id?: string;
  type?: string;
  importance?: string;
  titre?: string;
  resume?: string;
  detail?: string;
  raisonnement?: string;
  sujets?: string[] | string;
  confiance?: number;
  source?: Partial<SourceUnite>;
  liens?: string[] | string;
  /** L'unité active que celle-ci remplace : elle sera dépréciée et reliée. */
  remplace?: string;
  jamaisSupposer?: boolean;
  /** Pourquoi cette unité mérite d'être retenue (le test des quatre questions). */
  raison?: string;
}

export interface PropositionPropre {
  action: ActionProposition;
  id?: string;
  type: TypeUnite;
  importance: Importance;
  titre: string;
  resume: string;
  detail: string;
  raisonnement: string;
  sujets: string[];
  confiance: number;
  source: SourceUnite;
  liens: string[];
  remplace?: string;
  jamaisSupposer: boolean;
}

export type JugementProposition = { ok: true; propre: PropositionPropre } | { ok: false; raisons: string[] };

export const TITRE_UNITE_MIN = 6;
export const TITRE_UNITE_MAX = 140;
export const RESUME_UNITE_MIN = 20;
export const RESUME_UNITE_MAX = 700;
export const DETAIL_UNITE_MAX = 12_000;

function liste(valeur: unknown, max = 12): string[] {
  const brut = Array.isArray(valeur) ? valeur : typeof valeur === 'string' ? valeur.split(/[,;\n]/) : [];
  return [...new Set(brut.map((v) => String(v ?? '').trim()).filter(Boolean))].slice(0, max);
}

/** Un sujet lisible : minuscules, sans accents, traits d'union. */
export function idDeSujetDUnite(texte: string): string {
  return sansAccentsLocal(String(texte ?? ''))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

/**
 * CE QUI NE SE MÉMORISE JAMAIS — la liste donnée aux agents, et vérifiée par le
 * moteur à chaque proposition.
 */
export const CE_QUI_NE_SE_MEMORISE_JAMAIS = [
  'un journal ou une sortie de commande (horodatages, traces d’erreur, lignes de log)',
  'un raisonnement en cours (« je pense », « d’abord j’ai… »)',
  'une commande triviale (ls, cd, git status, npm install…)',
  'une hypothèse non vérifiée (« peut-être », « probablement », « à vérifier »)',
  'le résumé d’une tâche ou d’une livraison (« la carte a ajouté… ») — il va au changelog',
] as const;

/**
 * LE TEST DES QUATRE QUESTIONS, tel que le moteur peut le trancher sans modèle :
 * 1. Est-ce DURABLE (pas le récit d'une tâche) ?
 * 2. Est-ce VÉRIFIÉ (pas une hypothèse) ?
 * 3. Est-ce UTILE à un autre agent (pas un journal ni un raisonnement) ?
 * 4. Est-ce NON TRIVIAL (pas une commande banale, pas vide de sens) ?
 */
export function testDesQuatreQuestions(p: { titre: string; resume: string; detail: string; confiance: number }): string[] {
  const raisons: string[] = [];
  const tete = `${p.titre}\n${p.resume}`;
  const tout = `${tete}\n${p.detail}`;

  if (
    /^\s*(j['’]ai|nous avons|on a|cette (carte|t[âa]che)|la (carte|t[âa]che) (a|est)|t[âa]che termin[ée]e|carte livr[ée]e|livr[ée]e? le)\b/i.test(p.resume) ||
    /\b(carte|t[âa]che) (livr[ée]e|termin[ée]e) le\b/i.test(tete) ||
    /\b(aujourd['’]hui|hier|ce matin|tout à l['’]heure)\b/i.test(tete)
  ) {
    raisons.push('Durable ? Non : c’est le récit d’une tâche ou d’une livraison, qui va au changelog (geste « changelog »), pas en mémoire.');
  }

  if (/\b(peut[- ][êe]tre|probablement|il (me )?semble|je suppose|hypoth[èe]se|[àa] v[ée]rifier|sans doute|pas s[ûu]r)\b/i.test(tete) || p.confiance < 0.4) {
    raisons.push('Vérifié ? Non : une hypothèse ne se mémorise pas. Vérifie-la d’abord, ou garde-la en brouillon (geste « brouillon »).');
  }

  const lignes = tout.split('\n');
  const lignesDeLog = lignes.filter(
    (l) => /\b\d{2}:\d{2}:\d{2}\b/.test(l) || /^\s*at .+\(.+:\d+:\d+\)\s*$/.test(l) || /^\s*(\[(info|warn|error|debug)\]|(INFO|WARN|ERROR|DEBUG)\b)/.test(l),
  ).length;
  if (lignesDeLog >= 3) {
    raisons.push('Utile ? Non : c’est un journal ou une sortie de commande. Retiens la leçon qu’on en tire, pas la trace.');
  }
  if (/^\s*(je (pense|crois|vais|regarde)|d['’]abord,? j|ensuite,? je|mon raisonnement|laisse[- ]moi)\b/i.test(p.resume)) {
    raisons.push('Utile ? Non : c’est un raisonnement en cours. Retiens le fait établi, pas le chemin pour y arriver.');
  }

  const commandeSeule = /^\s*`?\s*(ls|cd|pwd|cat|echo|git (status|log|diff|add|pull)|npm (install|i|run build|test)|node --version)(?=[\s`.]|$)[^\n`]*`?\s*\.?\s*$/i;
  if (commandeSeule.test(p.resume) || commandeSeule.test(p.titre)) {
    raisons.push('Non trivial ? Non : une commande banale ne s’apprend pas. Dis ce qu’elle permet d’éviter ou de vérifier.');
  }
  if (motsSignificatifs(p.resume).size < 3) {
    raisons.push('Non trivial ? Le résumé ne dit rien de précis : écris le fait en une phrase complète.');
  }
  return raisons;
}

/**
 * JUGER UNE PROPOSITION : champs, taxonomie, bornes, puis les quatre questions.
 * Un refus rend TOUTES ses raisons, pour que l'agent corrige en une fois.
 */
export function jugerProposition(p: PropositionUnite, options: { quatreQuestions?: boolean } = {}): JugementProposition {
  const raisons: string[] = [];
  const action = (p.action ?? 'create') as ActionProposition;
  if (!ACTIONS_PROPOSITION.includes(action)) raisons.push(`Action inconnue « ${p.action} » : create, update ou deprecate.`);
  const id = p.id ? String(p.id).trim().toUpperCase() : undefined;
  if (action !== 'create' && !id) raisons.push(`L’action « ${action} » vise une unité existante : donne son « id » (MEM-0042, DEC-007).`);

  if (action === 'deprecate') {
    return raisons.length
      ? { ok: false, raisons }
      : {
          ok: true,
          propre: {
            action,
            id,
            type: 'lesson',
            importance: 'P3',
            titre: '',
            resume: '',
            detail: '',
            raisonnement: String(p.raisonnement ?? p.raison ?? '').trim(),
            sujets: [],
            confiance: 1,
            source: sourcePropre(p.source),
            liens: [],
            jamaisSupposer: false,
          },
        };
  }

  const type = String(p.type ?? '').trim().toLowerCase() as TypeUnite;
  if (!TYPES_UNITE.includes(type)) raisons.push(`Type « ${p.type ?? ''} » hors taxonomie : ${TYPES_UNITE.join(', ')}.`);
  const importanceBrute = String(p.importance ?? 'P2').trim().toUpperCase();
  const importance = (IMPORTANCES_UNITE as readonly string[]).includes(importanceBrute) ? (importanceBrute as Importance) : null;
  if (!importance) raisons.push(`Importance « ${p.importance} » inconnue : P0 (vital), P1, P2 ou P3 (anecdotique).`);

  const titre = String(p.titre ?? '').replace(/\s+/g, ' ').trim();
  const resume = String(p.resume ?? '').replace(/\s+/g, ' ').trim();
  const detail = String(p.detail ?? '').trim();
  const raisonnement = String(p.raisonnement ?? '').trim();
  if (titre.length < TITRE_UNITE_MIN) raisons.push('Le titre manque ou est trop court.');
  if (titre.length > TITRE_UNITE_MAX) raisons.push(`Le titre dépasse ${TITRE_UNITE_MAX} signes.`);
  if (resume.length < RESUME_UNITE_MIN) raisons.push('Le résumé manque : une phrase complète qui dit le fait.');
  if (resume.length > RESUME_UNITE_MAX) raisons.push(`Le résumé dépasse ${RESUME_UNITE_MAX} signes : le reste va dans « detail ».`);
  if (detail.length > DETAIL_UNITE_MAX) raisons.push(`Le détail dépasse ${DETAIL_UNITE_MAX} signes : découpe en plusieurs unités.`);
  if (type === 'decision' && !raisonnement && !/###\s*(Contexte|Raisonnement)/i.test(detail)) {
    raisons.push('Une décision dit POURQUOI : donne « raisonnement » (ou une section « ### Contexte » dans le détail).');
  }

  const confianceBrute = Number(p.confiance ?? 0.8);
  const confiance = Number.isFinite(confianceBrute) ? Math.max(0, Math.min(1, confianceBrute)) : 0.8;
  if (raisons.length) return { ok: false, raisons };

  // Une règle DÉCLARÉE par un humain (rangement de nuit) a déjà passé son propre jugement.
  const quatre = options.quatreQuestions === false ? [] : testDesQuatreQuestions({ titre, resume, detail, confiance });
  if (quatre.length) return { ok: false, raisons: quatre };

  return {
    ok: true,
    propre: {
      action,
      id,
      type,
      importance: importance!,
      titre,
      resume,
      detail: type === 'decision' || type === 'domain' || type === 'component' ? detailAuGabarit(type, detail, resume) : detail,
      raisonnement,
      sujets: liste(p.sujets).map(idDeSujetDUnite).filter(Boolean),
      confiance: Math.round(confiance * 100) / 100,
      source: sourcePropre(p.source),
      liens: liste(p.liens, 20).map((l) => l.toUpperCase()).filter(estIdentifiantDUnite),
      remplace: p.remplace ? String(p.remplace).trim().toUpperCase() : undefined,
      jamaisSupposer: Boolean(p.jamaisSupposer),
    },
  };
}

function sourcePropre(source: Partial<SourceUnite> | undefined): SourceUnite {
  const genre = (GENRES_SOURCE as readonly string[]).includes(String(source?.genre)) ? (source!.genre as GenreSource) : 'carte';
  return { genre, ref: String(source?.ref ?? '').trim().slice(0, 200) };
}

/* ------------------------------------------------------------------ */
/* Les gabarits                                                          */
/* ------------------------------------------------------------------ */

/** Les sections imposées au détail des types à gabarit. La première est obligatoire. */
export const SECTIONS_DU_GABARIT: Partial<Record<TypeUnite, readonly string[]>> = {
  decision: ['Contexte', 'Décision', 'Conséquences'],
  domain: ['Entités', 'États', 'Transitions', 'Glossaire'],
  component: ['Rôle', 'Comportement', 'Fichiers', 'Contrôles'],
};

/** Les sections « ## » ou « ### » d'un détail, dans l'ordre du texte. */
export function sectionsDuDetail(detail: string): { titre: string | null; texte: string }[] {
  const blocs: { titre: string | null; lignes: string[] }[] = [{ titre: null, lignes: [] }];
  let dansCode = false;
  for (const ligne of String(detail ?? '').split('\n')) {
    if (/^```/.test(ligne.trim())) dansCode = !dansCode;
    if (!dansCode && /^##{1,2}\s+/.test(ligne)) {
      blocs.push({ titre: ligne.replace(/^##{1,2}\s+/, '').trim(), lignes: [] });
      continue;
    }
    blocs.at(-1)!.lignes.push(ligne);
  }
  return blocs.map((b) => ({ titre: b.titre, texte: b.lignes.join('\n').trim() })).filter((b) => b.titre !== null || b.texte);
}

/**
 * LES GABARITS SOUPLES n'imposent aucune section : une section vide, ou qui ne
 * fait que redire le résumé, n'est pas écrite, et un fait d'une phrase garde son
 * texte libre sans titres artificiels (« Entités », « États »… sur un détail de
 * deux lignes).
 */
const GABARITS_SOUPLES: ReadonlySet<TypeUnite> = new Set(['domain']);

/** Un détail sans ses sections restées « Non renseigné » : ce qui reste d'un gabarit quand l'unité change de type. */
export function detailSansSectionsVides(detail: string): string {
  return sectionsDuDetail(detail)
    .map((s) => ({ ...s, texte: s.texte.split('\n').filter((ligne) => ligne.trim() !== NON_RENSEIGNE).join('\n').trim() }))
    .filter((s) => s.texte)
    .map((s) => (s.titre === null ? s.texte : `### ${s.titre}\n\n${s.texte}`))
    .join('\n\n');
}

/**
 * REMET UN DÉTAIL AU GABARIT DE SON TYPE : les sections connues dans l'ordre,
 * celles qui manquent posées vides, le texte libre rangé dans la première. Rien
 * n'est perdu : une section inconnue suit les autres. Un gabarit SOUPLE n'écrit
 * que les sections utiles (voir `GABARITS_SOUPLES`).
 */
export function detailAuGabarit(type: TypeUnite, detail: string, resume = ''): string {
  const gabarit = SECTIONS_DU_GABARIT[type];
  if (!gabarit) return detail.trim();
  if (GABARITS_SOUPLES.has(type)) return detailSouple(gabarit, detail, resume);
  const sections = sectionsDuDetail(detail);
  const parTitre = new Map<string, string>();
  const libre: string[] = [];
  const autres: { titre: string; texte: string }[] = [];
  for (const s of sections) {
    if (s.titre === null) {
      libre.push(s.texte);
      continue;
    }
    const connu = gabarit.find((g) => cleNormale(g) === cleNormale(s.titre!));
    if (connu) parTitre.set(connu, [parTitre.get(connu), s.texte].filter(Boolean).join('\n\n'));
    else autres.push({ titre: s.titre, texte: s.texte });
  }
  if (libre.length) {
    const cible = type === 'decision' ? 'Décision' : gabarit[0];
    parTitre.set(cible, [libre.join('\n\n'), parTitre.get(cible)].filter(Boolean).join('\n\n'));
  }
  return [...gabarit.map((g) => `### ${g}\n\n${parTitre.get(g)?.trim() || NON_RENSEIGNE}`), ...autres.map((a) => `### ${a.titre}\n\n${a.texte}`)].join('\n\n');
}

export const NON_RENSEIGNE = '_Non renseigné._';

function detailSouple(gabarit: readonly string[], detail: string, resume: string): string {
  const utile = (texte: string) => {
    const net = texte.trim();
    if (!net || net === NON_RENSEIGNE) return '';
    return resume && ressemblanceDeTextes(net, resume) >= 0.85 ? '' : net;
  };
  const sections = sectionsDuDetail(detail);
  const libre = utile(sections.filter((s) => s.titre === null).map((s) => s.texte).join('\n\n'));
  const titrees = sections.filter((s): s is { titre: string; texte: string } => s.titre !== null);
  const parTitre = new Map<string, string>();
  const autres: { titre: string; texte: string }[] = [];
  for (const s of titrees) {
    const texte = utile(s.texte);
    if (!texte) continue;
    const connu = gabarit.find((g) => cleNormale(g) === cleNormale(s.titre));
    if (connu) parTitre.set(connu, [parTitre.get(connu), texte].filter(Boolean).join('\n\n'));
    else autres.push({ titre: s.titre, texte });
  }
  if (!parTitre.size && !autres.length) return libre;
  return [
    libre,
    ...gabarit.filter((g) => parTitre.has(g)).map((g) => `### ${g}\n\n${parTitre.get(g)}`),
    ...autres.map((a) => `### ${a.titre}\n\n${a.texte}`),
  ]
    .filter(Boolean)
    .join('\n\n');
}

function dateCourte(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function ligneDeMeta(u: Unite): string {
  const morceaux = [
    `\`${u.type}\``,
    `**${u.importance}**`,
    u.statut === 'active' ? 'active' : 'dépréciée',
    `confiance ${String(u.confiance).replace('.', ',')}`,
    `source : ${u.source.genre}${u.source.ref ? ` ${u.source.ref}` : ''}`,
    u.sujets.length ? `sujets : ${u.sujets.join(', ')}` : '',
    `v${u.version} · ${dateCourte(u.modifieLe)}`,
  ].filter(Boolean);
  return morceaux.join(' · ');
}

/** Une unité rendue en Markdown, au gabarit de son type. */
export function rendreUnite(u: Unite, niveauTitre = 2): string {
  const h = '#'.repeat(niveauTitre);
  const lignes = [`${h} ${u.id} — ${u.titre}`, '', ligneDeMeta(u)];
  const relations = [
    u.supersedes ? `Remplace : ${u.supersedes}` : '',
    u.supersededBy ? `Remplacée par : ${u.supersededBy}` : '',
    u.liens.length ? `Liens : ${u.liens.join(', ')}` : '',
  ].filter(Boolean);
  if (relations.length) lignes.push(relations.join(' · '));
  lignes.push('', u.resume);
  const sous = '#'.repeat(niveauTitre + 1);
  const detail = detailSansSectionsVides(u.detail);
  if (detail) lignes.push('', detail.replace(/^### /gm, `${sous} `));
  if (u.raisonnement.trim()) lignes.push('', `${sous} Raisonnement`, '', u.raisonnement.trim());
  return lignes.join('\n');
}

export interface RenduDeFiche {
  portee: string;
  nomDeLaPortee: string;
  fiche: FicheNumerotee;
  unites: readonly Unite[];
  /** Pour la fiche des compétences d'un projet : le nom du projet dont on garde les compétences. */
  competencesDe?: string;
  maintenant?: number;
}

const ORDRE_IMPORTANCE: Record<Importance, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };

export function trierUnites<T extends Pick<Unite, 'importance' | 'id' | 'modifieLe'>>(unites: readonly T[]): T[] {
  return [...unites].sort((a, b) => ORDRE_IMPORTANCE[a.importance] - ORDRE_IMPORTANCE[b.importance] || a.id.localeCompare(b.id));
}

/**
 * UNE FICHE NUMÉROTÉE, RENDUE. Les unités actives de ses types, triées par
 * importance ; la fiche 00 d'un projet porte en plus le bloc « À ne jamais
 * supposer » (toutes les unités qui le demandent, quel que soit leur type) et le
 * sommaire des unités P0 du projet.
 */
export function rendreFicheNumerotee(r: RenduDeFiche, toutesLesUnites: readonly Unite[] = r.unites): string {
  const actives = trierUnites(r.unites.filter((u) => u.statut === 'active' && uniteDansLaFiche(r.fiche, u, r.competencesDe)));
  const numero = r.fiche.id.slice(0, 2);
  const derniere = actives.reduce((m, u) => Math.max(m, u.modifieLe), 0);
  const sortie = [
    `# ${numero} — ${r.fiche.titre} — ${r.nomDeLaPortee}`,
    '',
    `_${actives.length} unité(s) active(s)${derniere ? ` · mise à jour le ${dateCourte(derniere)}` : ''} · rendu depuis la base de connaissances, ne pas modifier à la main._`,
  ];
  const estTete = r.fiche.id === '00_project' || r.fiche.id === '00_principles';
  if (estTete) {
    const jamais = trierUnites(toutesLesUnites.filter((u) => u.statut === 'active' && u.jamaisSupposer));
    sortie.push('', '## À ne jamais supposer', '');
    sortie.push(jamais.length ? jamais.map((u) => `- **${u.id}** — ${u.titre} : ${u.resume}`).join('\n') : NON_RENSEIGNE);
    const vitales = trierUnites(toutesLesUnites.filter((u) => u.statut === 'active' && u.importance === 'P0' && !uniteDansLaFiche(r.fiche, u)));
    if (vitales.length) {
      sortie.push('', '## Unités vitales (P0) ailleurs dans la base', '');
      sortie.push(vitales.map((u) => `- **${u.id}** (${ficheDeLUnite(u).id}) — ${u.titre}`).join('\n'));
    }
  }
  if (!actives.length) sortie.push('', NON_RENSEIGNE);
  for (const u of actives) sortie.push('', rendreUnite(u));
  return `${sortie.join('\n')}\n`;
}

/** L'archive d'une fiche : ses unités dépréciées, chacune avec ce qui l'a remplacée. */
export function rendreArchive(r: RenduDeFiche): string {
  const depreciees = trierUnites(r.unites.filter((u) => u.statut === 'deprecated' && uniteDansLaFiche(r.fiche, u, r.competencesDe)));
  const sortie = [`# Archive — ${r.fiche.id.slice(0, 2)} — ${r.fiche.titre} — ${r.nomDeLaPortee}`, '', `_${depreciees.length} unité(s) dépréciée(s)._`];
  for (const u of depreciees) sortie.push('', rendreUnite(u));
  return `${sortie.join('\n')}\n`;
}

/** Le nom de dossier d'un projet sous MEMORY/PROJECTS : lisible, stable. */
export function dossierDuProjet(nom: string, id: string): string {
  const net = idDeSujetDUnite(nom) || 'projet';
  return `${net}-${id.replace(/[^a-zA-Z0-9]/g, '').slice(0, 6)}`;
}

/* ------------------------------------------------------------------ */
/* Le changelog                                                          */
/* ------------------------------------------------------------------ */

export const CATEGORIES_CHANGELOG = ['Ajouté', 'Modifié', 'Corrigé', 'Retiré'] as const;
export type CategorieChangelog = (typeof CATEGORIES_CHANGELOG)[number];

export const GENRES_ENTREE_CHANGELOG = ['git', 'historique', 'carte', 'agent'] as const;
export type GenreEntreeChangelog = (typeof GENRES_ENTREE_CHANGELOG)[number];

export interface EntreeDuChangelog {
  id?: number;
  projectId: string;
  /** AAAA-MM-JJ. */
  jour: string;
  categorie: CategorieChangelog;
  texte: string;
  branche: string | null;
  commits: string[];
  cartes: string[];
  unites: string[];
  /** L'étiquette de la publication qui l'a mise en ligne, sinon null. */
  publication: string | null;
  source: GenreEntreeChangelog;
  at: number;
  /** Le titre écrit pour un lecteur qui ne programme pas. Null : l'entrée n'a que sa ligne d'origine (`texte`). */
  titre?: string | null;
  /** Deux à quatre phrases : ce qui a changé, et à quoi ça sert. */
  explication?: string | null;
  /** L'ampleur réelle du changement, jugée sur le travail fait — jamais devinée des mots. */
  poids?: PoidsChangelog | null;
  /** Corrigée à la main depuis l'écran : plus aucune rédaction automatique ne la réécrit. */
  corrigee?: boolean;
  /** La carte d'où vient l'entrée (par ses cartes, sinon par sa branche), quand elle existe encore. */
  carte?: { id: string; titre: string } | null;
}

export const TEXTE_CHANGELOG_MAX = 300;

/* ------------------------------------------------------------------ */
/* Le poids d'une entrée : ce qui ressort, ce qui se replie              */
/* ------------------------------------------------------------------ */

/**
 * LE POIDS D'UNE ENTRÉE DIT SON AMPLEUR, PAS SA CATÉGORIE. « Génération PDF
 * internalisée » rangée en « Modifié » par une recherche de mots était le
 * symptôme : une grosse fonctionnalité ne ressortait pas. Le poids est jugé par
 * l'agent qui a fait le travail (ou par la reprise du passé) ; la catégorie
 * reste pour la compatibilité, et se déduit du poids.
 */
export const POIDS_CHANGELOG = ['grande-nouveaute', 'amelioration', 'correction', 'retrait', 'detail'] as const;
export type PoidsChangelog = (typeof POIDS_CHANGELOG)[number];

export const LIBELLE_POIDS: Record<PoidsChangelog, string> = {
  'grande-nouveaute': 'Grande nouveauté',
  amelioration: 'Amélioration',
  correction: 'Correction',
  retrait: 'Retrait',
  detail: 'Détail',
};

export const TITRE_CHANGELOG_MAX = 120;
export const EXPLICATION_CHANGELOG_MAX = 900;

export function poidsValide(poids: unknown): poids is PoidsChangelog {
  return typeof poids === 'string' && (POIDS_CHANGELOG as readonly string[]).includes(poids);
}

/** « grande nouveauté », « Grande-Nouveauté », « amélioration »… : le poids écrit à la main se relit. */
export function poidsDuMot(mot: unknown): PoidsChangelog | null {
  const cle = cleNormale(String(mot ?? '')).replace(/\s+/g, '-');
  if (poidsValide(cle)) return cle;
  if (/^(nouveaute|grande|majeur|feature)/.test(cle)) return 'grande-nouveaute';
  if (/^(amelior|modif|evolution)/.test(cle)) return 'amelioration';
  if (/^(correct|fix|repar)/.test(cle)) return 'correction';
  if (/^(retrait|retir|supprim)/.test(cle)) return 'retrait';
  if (/^(detail|mineur|bruit)/.test(cle)) return 'detail';
  return null;
}

export function categorieDuPoids(poids: PoidsChangelog): CategorieChangelog {
  return poids === 'grande-nouveaute' ? 'Ajouté' : poids === 'correction' ? 'Corrigé' : poids === 'retrait' ? 'Retiré' : 'Modifié';
}

/** Le bruit d'un journal : redémarrages, résolutions de fusion, documentation, rangements. Il se replie en « détail ». */
export function estDuBruitDeChangelog(texte: string): boolean {
  if (/^\s*(docs|chore|style|test|tests|build|ci)(\([^)]*\))?!?\s*:/i.test(texte)) return true;
  const t = cleNormale(texte);
  return /\b(redemarrage|redemarrer|resolution (de|d un)? ?(conflit|fusion)|fusion de (main|dev)|merge|travaux en cours|rangement de nuit|changelog|bump|sauvegarde automatique)\b/.test(t);
}

/** Le poids affiché : celui qui a été jugé, sinon un repli sur la catégorie (et « détail » pour le bruit). */
export function poidsDeLEntree(e: Pick<EntreeDuChangelog, 'poids' | 'categorie' | 'texte'>): PoidsChangelog {
  if (poidsValide(e.poids)) return e.poids;
  if (estDuBruitDeChangelog(e.texte)) return 'detail';
  return e.categorie === 'Corrigé' ? 'correction' : e.categorie === 'Retiré' ? 'retrait' : 'amelioration';
}

/** Le titre affiché : le titre rédigé, sinon la ligne d'origine sans préfixe de commit. */
export function titreDeLEntree(e: Pick<EntreeDuChangelog, 'titre' | 'texte'>): string {
  return e.titre?.trim() || texteSansPrefixeDeCommit(e.texte);
}

function nombreDePhrases(texte: string): number {
  return texte.split(/(?<=[.!?…])\s+/).filter((p) => p.replace(/[^\p{L}\p{N}]/gu, '').length >= 12).length;
}

/**
 * UNE ENTRÉE RÉDIGÉE SE JUGE AVANT D'ENTRER. Un titre de trois mots, un nom de
 * branche ou un sujet de commit, une explication d'une ligne qui redit le titre :
 * refusés, avec la raison, pour que l'agent la réécrive. `souple` sert à la
 * reprise du passé, où l'on ne retrouve parfois qu'un titre : une phrase suffit,
 * et un « détail » peut rester sans explication.
 */
export function jugerRedactionChangelog(
  r: { titre?: unknown; explication?: unknown; poids?: unknown },
  options: { souple?: boolean } = {},
): { ok: true; titre: string; explication: string | null; poids: PoidsChangelog } | { ok: false; raison: string } {
  const titre = texteSansPrefixeDeCommit(String(r.titre ?? '').replace(/\s+/g, ' ').trim());
  const explication = String(r.explication ?? '').replace(/[ \t]+/g, ' ').trim();
  const poids = poidsDuMot(r.poids);
  if (!poids) return { ok: false, raison: `Il manque le poids : ${POIDS_CHANGELOG.join(', ')}.` };
  if (!titre) return { ok: false, raison: 'Il manque le titre : ce qui a changé, en quelques mots clairs pour quelqu’un qui ne programme pas.' };
  if (titre.length > TITRE_CHANGELOG_MAX) return { ok: false, raison: `Le titre dépasse ${TITRE_CHANGELOG_MAX} signes : raccourcis-le, l’explication porte le reste.` };
  if (/^(tache|task|feature|fix|archive)\//i.test(titre) || /^[a-z0-9]+(-[a-z0-9]+){2,}$/.test(titre)) return { ok: false, raison: 'Le titre est un nom de branche : écris ce qui a changé, en mots courants.' };
  if (titre.split(/\s+/).length < 3) return { ok: false, raison: 'Le titre est trop court : trois mots au moins, qui disent ce qui a changé.' };
  if (!explication) {
    if (options.souple && poids === 'detail') return { ok: true, titre, explication: null, poids };
    return { ok: false, raison: 'Il manque l’explication : deux à quatre phrases qui disent ce qui a changé et à quoi ça sert, pour l’utilisateur.' };
  }
  if (explication.length > EXPLICATION_CHANGELOG_MAX) return { ok: false, raison: `L’explication dépasse ${EXPLICATION_CHANGELOG_MAX} signes : quatre phrases au plus.` };
  if (titreNormalise(explication) === titreNormalise(titre)) return { ok: false, raison: 'L’explication redit le titre : dis ce qui a changé et à quoi ça sert.' };
  const phrases = nombreDePhrases(explication);
  if (phrases < (options.souple ? 1 : 2)) return { ok: false, raison: 'L’explication est trop pauvre : deux phrases au moins, ce qui a changé puis à quoi ça sert.' };
  return { ok: true, titre, explication, poids };
}

/** Les consignes de rédaction, communes à l'agent, à la rédaction de repli et à la reprise du passé. */
export const CONSIGNES_REDACTION_CHANGELOG = [
  'Le TITRE dit ce qui a changé pour la personne qui se sert du produit, en mots courants (3 à 12 mots) : jamais un nom de branche, de fichier ou de fonction, jamais un sujet de commit.',
  'L’EXPLICATION tient en deux à quatre phrases : ce qui a changé, puis à quoi ça sert ou ce que ça évite. Elle parle de l’effet, pas du code.',
  'Le POIDS juge l’ampleur réelle : « grande-nouveaute » pour une fonctionnalité entière qu’on annoncerait à un client (une génération de PDF, un nouvel écran, une nouvelle intégration) ; « amelioration » pour un changement visible d’un existant ; « correction » pour une panne réparée ; « retrait » pour ce qui disparaît ; « detail » pour le bruit (redémarrage, résolution de fusion, documentation interne, rangement).',
] as const;

/**
 * LA DEMANDE DE RÉDACTION envoyée à un modèle : des entrées avec ce qu'on
 * retrouve de leur travail, et une réponse attendue en JSON. Les entrées d'un
 * même jour qui disent la même chose se FUSIONNENT : la première garde le texte,
 * les autres sont nommées dans « fusionneAvec ».
 */
export function demandeDeRedactionChangelog(options: {
  nomDuProjet: string;
  entrees: readonly { cle: string; jour: string; texte: string; contexte?: string }[];
}): string {
  return [
    `Tu rédiges le journal des changements du projet « ${options.nomDuProjet} », lu par quelqu’un qui ne programme pas. Écris en français.`,
    ...CONSIGNES_REDACTION_CHANGELOG.map((c) => `- ${c}`),
    '- Si plusieurs entrées du MÊME jour disent la même chose, garde la plus parlante et nomme les autres dans « fusionneAvec » (leurs clés).',
    '- N’invente rien : si le contexte est pauvre, l’explication est plus courte (une phrase suffit), jamais imaginée.',
    '',
    'Réponds UNIQUEMENT par un tableau JSON, un objet par entrée gardée : [{"cle": "…", "titre": "…", "explication": "…", "poids": "grande-nouveaute|amelioration|correction|retrait|detail", "fusionneAvec": ["…"]}]',
    '',
    'LES ENTRÉES :',
    ...options.entrees.map((e) => [`### ${e.cle} — ${e.jour}`, `Ligne d’origine : ${e.texte}`, e.contexte ? `Contexte retrouvé :\n${e.contexte}` : 'Contexte retrouvé : aucun.'].join('\n')),
  ].join('\n');
}

export interface RedactionDuModele {
  cle: string;
  titre: string;
  explication: string;
  poids: string;
  fusionneAvec: string[];
}

/** La réponse d'un modèle, relue même entourée de texte ou d'une clôture de code. */
export function lireRedactionsDuModele(texte: string): RedactionDuModele[] {
  const brut = String(texte ?? '');
  const debut = brut.indexOf('[');
  const fin = brut.lastIndexOf(']');
  if (debut < 0 || fin <= debut) return [];
  try {
    const liste = JSON.parse(brut.slice(debut, fin + 1));
    if (!Array.isArray(liste)) return [];
    return liste
      .filter((x) => x && typeof x === 'object' && typeof x.cle === 'string')
      .map((x) => ({
        cle: String(x.cle),
        titre: String(x.titre ?? ''),
        explication: String(x.explication ?? ''),
        poids: String(x.poids ?? ''),
        fusionneAvec: Array.isArray(x.fusionneAvec) ? x.fusionneAvec.map(String).filter((c: string) => c && c !== x.cle) : [],
      }));
  } catch {
    return [];
  }
}

/** La catégorie d'une entrée, lue dans ses mots. Dans le doute : « Modifié ». */
export function categorieDuTexte(texte: string): CategorieChangelog {
  const conventionnel = /^\s*(feat|fix|revert|refactor|perf|style|docs|chore|test|build|ci)(\([^)]*\))?!?\s*:/i.exec(texte);
  if (conventionnel) {
    const genre = conventionnel[1].toLowerCase();
    return genre === 'feat' ? 'Ajouté' : genre === 'fix' ? 'Corrigé' : genre === 'revert' ? 'Retiré' : 'Modifié';
  }
  const t = cleNormale(texte);
  if (/\b(corrig|repar|fix|bug|panne|regression|plantage|erreur|crash|ne (se )?\w+ plus|n \w+ plus|casse)/.test(t)) return 'Corrigé';
  if (/^(retir|supprim|enlev|remove|drop)|\b(retire|supprime|suppression|retrait|enleve)\b/.test(t)) return 'Retiré';
  if (/^(ajout|nouve|cree|creation|add|premier|mise en place|installe)|\b(ajoute|ajout|nouvelle?|nouveau|creation)\b/.test(t)) return 'Ajouté';
  return 'Modifié';
}

/** L'empreinte qui interdit le doublon d'une entrée : le jour et le texte normalisé. */
export function empreinteDEntree(e: Pick<EntreeDuChangelog, 'jour' | 'texte'>): string {
  return `${e.jour}|${titreNormalise(e.texte).slice(0, 160)}`;
}

export function jugerEntreeChangelog(e: { texte?: string }): { ok: true; texte: string } | { ok: false; raison: string } {
  const texte = String(e.texte ?? '').replace(/\s+/g, ' ').trim();
  if (!texte) return { ok: false, raison: 'Il manque le texte de l’entrée, en une ligne.' };
  if (texte.length > TEXTE_CHANGELOG_MAX) return { ok: false, raison: `L’entrée dépasse ${TEXTE_CHANGELOG_MAX} signes : une ligne suffit.` };
  return { ok: true, texte };
}

export interface CommitLu {
  hash: string;
  parents: string[];
  /** Date ISO. */
  date: string;
  sujet: string;
}

/** Une ligne de `git log --format=%H%x1f%P%x1f%cI%x1f%s`. */
export function lireLigneDeGitLog(ligne: string): CommitLu | null {
  const [hash, parents, date, ...reste] = ligne.split('\x1f');
  if (!hash || !date) return null;
  return { hash, parents: (parents ?? '').split(' ').filter(Boolean), date, sujet: reste.join('\x1f').trim() };
}

const COMMITS_SANS_INTERET = [
  /^travaux en cours enregistr/i,
  /^merge (remote-tracking )?branch '(main|master|dev|develop|origin\/.*)'/i,
  /^merge branch '[^']+' of /i,
  /^wip\b/i,
  /^(chore|bump)\b.*version/i,
  /^initial commit$/i,
  /^rangement de nuit/i,
  /^sauvegarde automatique/i,
];

/**
 * LE CHANGELOG TIRÉ DE GIT, SANS RIEN INVENTER. Une fusion de branche
 * « tache/… » devient UNE entrée, dont le texte est le sujet du dernier commit
 * de la branche ; un commit posé directement sur la branche principale devient
 * aussi une entrée. Les commits d'une branche fusionnée ne se redisent pas un
 * par un, et le bruit (travaux en cours, fusions de synchronisation) est écarté.
 */
export function entreesDepuisGit(projectId: string, commits: readonly CommitLu[]): EntreeDuChangelog[] {
  const parHash = new Map(commits.map((c) => [c.hash, c]));
  const dansUneBranche = new Set<string>();
  for (const c of commits) {
    if (c.parents.length < 2) continue;
    // Les commits atteignables par le second parent, jusqu'à retomber sur la ligne principale.
    const pile = [c.parents[1]];
    let garde = 0;
    while (pile.length && garde++ < 400) {
      const h = pile.pop()!;
      if (dansUneBranche.has(h)) continue;
      const commit = parHash.get(h);
      if (!commit) continue;
      if (commit.parents.length > 1 && /^merge (branch '(main|master|dev)'|pull request #\d+ from \S+\/(main|master|dev|release-dev-to-main)$)/i.test(commit.sujet)) continue;
      dansUneBranche.add(h);
      if (commit.parents[0]) pile.push(commit.parents[0]);
    }
  }
  const sortie: EntreeDuChangelog[] = [];
  const vues = new Set<string>();
  for (const c of commits) {
    const jour = c.date.slice(0, 10);
    const at = Date.parse(c.date) || 0;
    let texte = '';
    let branche: string | null = null;
    let lies = [c.hash.slice(0, 8)];
    if (c.parents.length >= 2) {
      const fusion = /^merge (?:remote-tracking )?branch '([^']+)'/i.exec(c.sujet) ?? /^merge pull request #\d+ from [^/\s]+\/(\S+)/i.exec(c.sujet);
      if (!fusion) {
        // Une fusion au sujet libre (« Release prod : … ») dit elle-même ce qu'elle livre ; une fusion de synchronisation, rien.
        if (/^merge\b/i.test(c.sujet) || COMMITS_SANS_INTERET.some((r) => r.test(c.sujet))) continue;
        const texteLibre = c.sujet.replace(/\s+/g, ' ').trim().slice(0, TEXTE_CHANGELOG_MAX);
        const libre: EntreeDuChangelog = { projectId, jour, categorie: categorieDuTexte(texteLibre), texte: texteLibre, branche: null, commits: [c.hash.slice(0, 8)], cartes: [], unites: [], publication: null, source: 'git', at };
        const cleLibre = empreinteDEntree(libre);
        if (!vues.has(cleLibre)) {
          vues.add(cleLibre);
          sortie.push(libre);
        }
        continue;
      }
      if (/^(main|master|dev|develop|origin\/|release-dev-to-main$)/.test(fusion[1])) continue;
      branche = fusion[1];
      const bout = parHash.get(c.parents[1]);
      texte = bout && !COMMITS_SANS_INTERET.some((r) => r.test(bout.sujet)) ? bout.sujet : '';
      if (!texte && bout?.parents[0]) {
        const avant = parHash.get(bout.parents[0]);
        if (avant && !COMMITS_SANS_INTERET.some((r) => r.test(avant.sujet)) && avant.parents.length < 2) texte = avant.sujet;
      }
      if (!texte) texte = libelleDeBranche(branche);
      if (bout) lies = [c.hash.slice(0, 8), bout.hash.slice(0, 8)];
    } else {
      if (dansUneBranche.has(c.hash) || COMMITS_SANS_INTERET.some((r) => r.test(c.sujet))) continue;
      texte = c.sujet;
    }
    texte = texte.replace(/\s+/g, ' ').trim().slice(0, TEXTE_CHANGELOG_MAX);
    if (!texte) continue;
    const entree: EntreeDuChangelog = {
      projectId,
      jour,
      categorie: categorieDuTexte(texte),
      texte,
      branche,
      commits: lies,
      cartes: [],
      unites: [],
      publication: null,
      source: 'git',
      at,
    };
    const cle = empreinteDEntree(entree);
    if (vues.has(cle)) continue;
    vues.add(cle);
    sortie.push(entree);
  }
  return sortie;
}

/** « tache/memoire-un-fichier-par-projet-1fa02d » → « Memoire un fichier par projet ». */
/**
 * LE TEXTE D'UNE ENTRÉE TEL QU'IL S'AFFICHE : sans le préfixe de commit
 * (« feat(x): », « fix: », « docs(regles)!: »), première lettre en capitale. Le
 * changelog stocké reste intact ; seuls les types conventionnels sont retirés,
 * jamais un « Note: » écrit par quelqu'un.
 */
export function texteSansPrefixeDeCommit(texte: string): string {
  const nu = String(texte ?? '').replace(/^(feat|fix|docs|chore|refactor|perf|test|tests|style|build|ci|revert)(\([^)]*\))?!?:\s+/i, '');
  return nu === texte ? nu : nu.charAt(0).toUpperCase() + nu.slice(1);
}

export function libelleDeBranche(branche: string): string {
  const nu = branche.replace(/^(archive\/)?(tache|task|feature|fix)\//, '').replace(/-[0-9a-f]{6}$/, '').replace(/[-_]+/g, ' ').trim();
  return nu ? nu[0].toUpperCase() + nu.slice(1) : branche;
}

/**
 * UNE LIGNE D'HISTORIQUE.md : « - 08.09.2026 : « Titre » livrée et publiée. »,
 * ou une ligne libre après la date. Rend null sur tout le reste.
 */
export function lireLigneDHistorique(projectId: string, ligne: string): EntreeDuChangelog | null {
  const m = /^\s*-\s*(\d{1,2})[./](\d{1,2})[./](\d{4})\s*:\s*(.+)$/.exec(ligne);
  if (!m) return null;
  const jour = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  let corps = m[4].trim();
  const cite = /^«\s*(.+?)\s*»\s*(livr[ée]e|r[ée]par[ée]e)?(\s+et publi[ée]e)?\.?\s*(.*)$/.exec(corps);
  const publiee = /et publi[ée]e/.test(corps);
  if (cite) corps = cite[1];
  corps = corps.replace(/\s+/g, ' ').trim();
  if (corps.length > TEXTE_CHANGELOG_MAX) corps = `${corps.slice(0, TEXTE_CHANGELOG_MAX - 1).trim()}…`;
  if (!corps) return null;
  return {
    projectId,
    jour,
    categorie: categorieDuTexte(`${corps} ${cite?.[2] ?? ''}`.replace(/livr[ée]e/, '')),
    texte: corps,
    branche: null,
    commits: [],
    cartes: [],
    unites: [],
    publication: publiee ? `publiée le ${jour}` : null,
    source: 'historique',
    at: Date.parse(`${jour}T12:00:00Z`) || 0,
  };
}

/**
 * RÉUNIR GIT, L'HISTORIQUE ET LES CARTES. Une carte livrée dont la branche est
 * fusionnée prête son TITRE à l'entrée de git (plus lisible qu'un sujet de
 * commit) ; une ligne d'historique qui redit une entrée du même jour (ou du
 * lendemain) n'est pas redite ; le reste s'ajoute, du plus récent au plus ancien.
 */
export function reunirLeChangelog(options: {
  git: readonly EntreeDuChangelog[];
  historique: readonly EntreeDuChangelog[];
  cartes: readonly { id: string; titre: string; branche: string | null; livreeLe: number; publieeLe?: number | null }[];
}): EntreeDuChangelog[] {
  const sortie = options.git.map((e) => ({ ...e }));
  const parBranche = new Map(sortie.filter((e) => e.branche).map((e) => [e.branche!, e]));
  for (const carte of options.cartes) {
    const deGit = carte.branche ? parBranche.get(carte.branche) ?? parBranche.get(carte.branche.replace(/^archive\//, '')) : undefined;
    if (deGit) {
      deGit.texte = carte.titre.slice(0, TEXTE_CHANGELOG_MAX);
      deGit.categorie = categorieDuTexte(carte.titre);
      deGit.cartes = [...new Set([...deGit.cartes, carte.id])];
      deGit.source = 'carte';
      if (carte.publieeLe) deGit.publication = `publiée le ${dateCourte(carte.publieeLe)}`;
    }
  }
  const proches = (a: string, b: string) => Math.abs((Date.parse(a) || 0) - (Date.parse(b) || 0)) <= 2 * 86_400_000;
  for (const h of options.historique) {
    const redit = sortie.some((e) => proches(e.jour, h.jour) && (ressemblanceDeTextes(e.texte, h.texte) >= 0.6 || titreNormalise(e.texte) === titreNormalise(h.texte)));
    if (redit) continue;
    sortie.push({ ...h });
  }
  const vues = new Set<string>();
  return sortie
    .sort((a, b) => b.jour.localeCompare(a.jour) || b.at - a.at)
    .filter((e) => {
      const cle = empreinteDEntree(e);
      if (vues.has(cle)) return false;
      vues.add(cle);
      return true;
    });
}

/** Les rubriques d'une journée, dans l'ordre où elles se lisent : ce qui compte d'abord, le bruit à la fin. */
export const RUBRIQUES_CHANGELOG: readonly { poids: PoidsChangelog; titre: string }[] = [
  { poids: 'grande-nouveaute', titre: 'Grandes nouveautés' },
  { poids: 'amelioration', titre: 'Améliorations' },
  { poids: 'correction', titre: 'Corrections' },
  { poids: 'retrait', titre: 'Retraits' },
  { poids: 'detail', titre: 'Détails' },
];

/**
 * LE CHANGELOG RENDU : par jour (le plus récent en haut), puis par poids — les
 * grandes nouveautés d'abord, avec leur explication ; les détails à la fin, en
 * une ligne. Les références (branche, commits, cartes) restent en fin de ligne
 * pour les agents.
 */
export function rendreChangelog(nomDuProjet: string, entrees: readonly EntreeDuChangelog[]): string {
  const parJour = new Map<string, EntreeDuChangelog[]>();
  for (const e of [...entrees].sort((a, b) => b.jour.localeCompare(a.jour) || b.at - a.at)) {
    parJour.set(e.jour, [...(parJour.get(e.jour) ?? []), e]);
  }
  const sortie = [`# Changelog — ${nomDuProjet}`, '', `_${entrees.length} entrée(s), tirées de git, de l’historique et des cartes livrées. Rendu depuis la base : ne pas modifier à la main._`];
  for (const [jour, liste] of parJour) {
    const publications = [...new Set(liste.map((e) => e.publication).filter(Boolean))];
    sortie.push('', `## ${jour}${publications.length ? ` — ${publications.join(', ')}` : ''}`);
    for (const rubrique of RUBRIQUES_CHANGELOG) {
      const dans = liste.filter((e) => poidsDeLEntree(e) === rubrique.poids);
      if (!dans.length) continue;
      sortie.push('', `### ${rubrique.titre}`, '');
      for (const e of dans) {
        const explication = rubrique.poids !== 'detail' && e.explication ? ` — ${e.explication.replace(/\s+/g, ' ')}` : '';
        sortie.push(`- **${titreDeLEntree(e)}**${explication}${referencesDEntree(e)}`);
      }
    }
  }
  return `${sortie.join('\n')}\n`;
}

export function referencesDEntree(e: Pick<EntreeDuChangelog, 'branche' | 'commits' | 'cartes' | 'unites'>): string {
  const refs = [e.branche ?? '', e.commits.slice(0, 2).join(' '), e.cartes.length ? `carte ${e.cartes.map((c) => c.slice(0, 8)).join(', ')}` : '', e.unites.join(', ')].filter(Boolean);
  return refs.length ? ` _(${refs.join(' · ')})_` : '';
}

/* ------------------------------------------------------------------ */
/* La recherche pondérée                                                */
/* ------------------------------------------------------------------ */

export const POIDS_RECHERCHE = { similarite: 0.45, importance: 0.2, type: 0.15, fraicheur: 0.1, liens: 0.1 } as const;

const VALEUR_IMPORTANCE: Record<Importance, number> = { P0: 1, P1: 0.75, P2: 0.5, P3: 0.25 };

/** Les mots qui font pencher une demande vers un type. */
const INDICES_DE_TYPE: readonly [TypeUnite, RegExp][] = [
  ['decision', /\b(decid|decision|choix|choisi|pourquoi|arbitr|adr|trancher)/],
  ['architecture', /\b(architect|module|couche|structure|flux|schema|base de donnees|table|migration|dossier)/],
  ['component', /\b(composant|ecran|fonction|bouton|tiroir|page|outil|service|script|fichier|api|route)/],
  ['convention', /\b(convention|nommage|style|format|gabarit|regle|toujours|jamais|ecrire)/],
  ['constraint', /\b(contrainte|interdit|limite|plafond|ne jamais|obligatoire|quota)/],
  ['security', /\b(secur|jeton|token|mot de passe|cle|droits|sudo|chiffr|authent)/],
  ['environment', /\b(serveur|vps|node|version|environnement|systemd|caddy|port|domaine|dns|docker)/],
  ['operation', /\b(deploi|publi|mise en ligne|mise en production|redemarr|sauvegard|backup|acces|ssh|exploit)/],
  ['integration', /\b(github|openrouter|stripe|webhook|integration|externe|smtp|courriel|fournisseur)/],
  ['issue', /\b(bug|panne|erreur|probleme|plante|casse|echoue|bloque|lent|regression)/],
  ['lesson', /\b(lecon|piege|appris|attention|eviter|symptome)/],
  ['domain', /\b(metier|domaine|entite|etat|transition|glossaire|colonne|carte|facture|client)/],
  ['requirement', /\b(exigence|besoin|doit|demande|fonctionnalite|attendu)/],
  ['project', /\b(projet|objectif|stack|vue d ensemble|a quoi sert)/],
];

/** Les types probables d'une demande, du plus au moins probable. Vide : aucun indice. */
export function typesProbables(demande: string): TypeUnite[] {
  const t = cleNormale(demande);
  return INDICES_DE_TYPE.filter(([, r]) => r.test(t)).map(([type]) => type);
}

export interface FacteursDeScore {
  /** De 0 à 1. */
  similarite: number;
  importance: Importance;
  type: TypeUnite;
  typesVises: readonly TypeUnite[];
  modifieLe: number;
  liens: number;
  maintenant?: number;
}

/** similarité 45 %, importance 20 %, pertinence du type 15 %, fraîcheur 10 %, liens 10 %. */
export function scoreDUnite(f: FacteursDeScore): number {
  const maintenant = f.maintenant ?? Date.now();
  const jours = Math.max(0, (maintenant - f.modifieLe) / 86_400_000);
  const rangType = f.typesVises.indexOf(f.type);
  const pertinence = !f.typesVises.length ? 0.5 : rangType < 0 ? 0.2 : 1 - rangType * 0.1;
  const s =
    POIDS_RECHERCHE.similarite * Math.max(0, Math.min(1, f.similarite)) +
    POIDS_RECHERCHE.importance * VALEUR_IMPORTANCE[f.importance] +
    POIDS_RECHERCHE.type * Math.max(0.2, pertinence) +
    POIDS_RECHERCHE.fraicheur * Math.exp(-jours / 180) +
    POIDS_RECHERCHE.liens * Math.min(1, f.liens / 4);
  return Math.round(s * 1000) / 1000;
}

/** Un classement BM25 (rangs) devient une similarité de 0 à 1 : le premier vaut 1. */
export function similariteDuRang(rang: number, total: number): number {
  if (total <= 1) return 1;
  return Math.max(0.05, 1 - rang / Math.max(total, 8));
}

/* ------------------------------------------------------------------ */
/* L'accueil des agents                                                  */
/* ------------------------------------------------------------------ */

/** Le plafond, en signes, de l'accueil de la base de connaissances (≈ 4 000 jetons à 2,2 signes par jeton). */
export const ACCUEIL_CONNAISSANCES_MAX = 9_000;
export const ENTREES_CHANGELOG_A_L_ACCUEIL = 12;

export function ligneDUnite(u: Pick<Unite, 'id' | 'type' | 'importance' | 'titre' | 'resume' | 'portee'>, resumeMax = 220): string {
  const resume = u.resume.length > resumeMax ? `${u.resume.slice(0, resumeMax - 1).trim()}…` : u.resume;
  return `- [${u.importance}] ${u.id} (${u.type}${u.portee === PORTEE_GLOBALE ? ', global' : ''}) ${u.titre} — ${resume}`;
}

/**
 * CE QUE CHAQUE COMPRÉHENSION LIT D'OFFICE : la tête du projet (00_project,
 * sans les unités P0 recopiées deux fois), les unités P0 et P1, et les
 * dernières entrées du changelog. Le tout sous un plafond : ce qui déborde est
 * COMPTÉ, et se demande à l'outil « memoire ».
 */
export function texteDAccueilConnaissances(options: {
  nomDuProjet: string;
  tete: readonly Unite[];
  jamaisSupposer: readonly Unite[];
  vitales: readonly Unite[];
  changelog: readonly EntreeDuChangelog[];
  totalUnites: number;
  plafond?: number;
}): string {
  const plafond = options.plafond ?? ACCUEIL_CONNAISSANCES_MAX;
  const entete = `BASE DE CONNAISSANCES — ${options.nomDuProjet} (${options.totalUnites} unité(s) actives, projet et global). Lue d'office à chaque compréhension : la tête du projet, ce qu'il ne faut jamais supposer, les unités P0 et P1, et le changelog récent. Le reste se demande avec l’outil « memoire » (« chercher », puis « lire » un identifiant ou une fiche numérotée).`;
  // Le compte suit le texte rendu à la lettre : « \n\n » entre les blocs, « \n » entre les lignes, et la place de la note finale réservée.
  const NOTE_HORS_PLAFOND = 90;
  let horsPlafond = 0;
  // Remplit un bloc DANS SON PROPRE BUDGET, sans jamais empiéter sur celui des autres blocs.
  const remplirDansBudget = (titre: string, lignes: string[], budget: number): { texte: string | null; taille: number } => {
    if (!lignes.length) return { texte: null, taille: 0 };
    const gardees: string[] = [];
    let bloc = 2 + titre.length;
    for (const l of lignes) {
      if (bloc + 1 + l.length > budget) {
        horsPlafond++;
        continue;
      }
      gardees.push(l);
      bloc += 1 + l.length;
    }
    if (!gardees.length) return { texte: null, taille: 0 };
    return { texte: `${titre}\n${gardees.join('\n')}`, taille: bloc };
  };
  const lignesTete = options.tete.map((u) => ligneDUnite(u, 500));
  const lignesJamaisSupposer = trierUnites(options.jamaisSupposer).map((u) => ligneDUnite(u, 300));
  const lignesVitales = trierUnites(options.vitales).map((u) => ligneDUnite(u));
  const lignesChangelog = options.changelog
    .filter((e) => poidsDeLEntree(e) !== 'detail')
    .slice(0, ENTREES_CHANGELOG_A_L_ACCUEIL)
    .map((e) => {
      const poids = poidsDeLEntree(e);
      const explication = poids === 'grande-nouveaute' && e.explication ? ` — ${e.explication.length > 200 ? `${e.explication.slice(0, 199).trim()}…` : e.explication}` : '';
      return `- ${e.jour} · ${LIBELLE_POIDS[poids]} · ${titreDeLEntree(e)}${explication}`;
    });
  // Les deux blocs courts et bornés (tête, changelog) sont servis d'abord ; le reste du plafond se partage entre
  // les deux blocs potentiellement volumineux (jamais supposer, P0/P1), pour que chacun des quatre ait sa chance.
  const disponible = plafond - NOTE_HORS_PLAFOND - entete.length;
  const tete = remplirDansBudget('00 — PROJET', lignesTete, disponible);
  const changelog = remplirDansBudget('CHANGELOG RÉCENT (ce qui a déjà été fait)', lignesChangelog, disponible - tete.taille);
  const restant = Math.max(0, disponible - tete.taille - changelog.taille);
  const budgetJamaisSupposer = Math.ceil(restant / 2);
  const jamaisSupposer = remplirDansBudget('À NE JAMAIS SUPPOSER', lignesJamaisSupposer, budgetJamaisSupposer);
  const budgetVitales = restant - jamaisSupposer.taille;
  const vitales = remplirDansBudget('UNITÉS P0 ET P1', lignesVitales, budgetVitales);
  const blocs = [entete, tete.texte, jamaisSupposer.texte, vitales.texte, changelog.texte].filter((b): b is string => b != null);
  if (horsPlafond) blocs.push(`(${horsPlafond} ligne(s) de plus hors plafond : cherche-les avec « memoire ».)`);
  return blocs.join('\n\n');
}

/* ------------------------------------------------------------------ */
/* Deviner le type d'un fait écrit d'une ligne                          */
/* ------------------------------------------------------------------ */

/** « remember » écrit une ligne : le type se devine, et la convention l'emporte dans le doute. */
export function typeDuFait(ligne: string): TypeUnite {
  const t = cleNormale(ligne);
  if (/\b(piege|attention|symptome|lecon|appris)/.test(t)) return 'lesson';
  if (/\b(decid|decision|on a choisi|choix retenu)/.test(t)) return 'decision';
  if (/\b(bug connu|probleme connu|panne connue|limitation connue)/.test(t)) return 'issue';
  if (/\b(ssh|mot de passe|jeton|token|cle d api|sudo|droits)/.test(t)) return 'security';
  if (/\b(serveur|vps|port|domaine|systemd|caddy|node \d|version de)/.test(t)) return 'environment';
  if (/\b(deploi|publi|mise en ligne|sauvegard|redemarr|script de)/.test(t)) return 'operation';
  if (/\b(ne jamais|interdit|toujours|obligatoire|plafond)/.test(t)) return 'constraint';
  if (/\b(github|openrouter|webhook|api externe|smtp)/.test(t)) return 'integration';
  return 'convention';
}

/** « Titre : le fait » → titre et résumé. Sans deux-points, le début de la phrase fait le titre. */
export function titreEtResumeDuFait(ligne: string): { titre: string; resume: string } {
  const net = ligne.replace(/\s+/g, ' ').trim();
  const m = /^(.{6,120}?)\s*:\s+(.{10,})$/.exec(net);
  if (m) return { titre: m[1].trim(), resume: m[2].trim().length >= RESUME_UNITE_MIN ? m[2].trim() : net };
  const mots = net.split(' ');
  return { titre: mots.slice(0, 10).join(' ').slice(0, TITRE_UNITE_MAX), resume: net };
}

/* ------------------------------------------------------------------ */
/* La génération par un modèle                                          */
/* ------------------------------------------------------------------ */

/**
 * LA CONSIGNE DE GÉNÉRATION : le modèle ne produit QUE des propositions
 * structurées, qui passeront par la même porte que les agents. Il RÉÉCRIT, il
 * ne recopie pas.
 */
export function consigneDeGeneration(options: { nomDeLaPortee: string; global: boolean; matiere: string; dejaConnus: readonly string[] }): string {
  return [
    `Tu construis la BASE DE CONNAISSANCES ${options.global ? 'GLOBALE (valable pour tous les projets)' : `du projet « ${options.nomDeLaPortee} »`} à partir d'anciennes notes.`,
    '',
    'Rends UNIQUEMENT un tableau JSON (aucun texte autour) de propositions. Chaque proposition :',
    '{"type": "...", "importance": "P0|P1|P2|P3", "titre": "...", "resume": "...", "detail": "...", "raisonnement": "...", "sujets": ["..."], "confiance": 0.0-1.0, "jamaisSupposer": false, "source": {"genre": "note", "ref": "code ou titre de la note"}}',
    '',
    `Types (taxonomie fermée) : ${TYPES_UNITE.join(', ')}. Ce qui entre dans chacun, et ce qui n’y entre pas :`,
    texteDesDefinitions(),
    'Choisis le type d’après ces définitions, jamais d’après un mot du titre : une valeur stockée chiffrée est « security », un comportement lié à un service tiers est « integration », même s’ils décrivent un état.',
    'P0 = une erreur ici casse la production ou perd des données ; P1 = règle importante du quotidien ; P2 = utile ; P3 = anecdotique.',
    'Gabarits du détail (sections « ### ») : decision → Contexte, Décision, Conséquences (et « raisonnement » obligatoire) ; component → Rôle, Comportement, Fichiers, Contrôles ; domain → Entités, États, Transitions, Glossaire, SEULEMENT celles qui apportent quelque chose (un fait d’une phrase n’a pas de détail).',
    '« jamaisSupposer » : vrai pour ce qu’un nouvel agent supposerait à tort (un nom, un chemin, un port, un comportement contre-intuitif).',
    '',
    'RÈGLES :',
    '- RÉÉCRIS en phrases neuves, courtes et factuelles : ne recopie aucun paragraphe tel quel.',
    '- FUSIONNE ce qui dit la même chose en une seule unité ; une note qui en contredit une plus ancienne l’emporte (garde la plus récente).',
    '- Les accès (hôte, port, chemin, nom de service, entrée du coffre-fort) se gardent en « operation » ou « environment », sans rien perdre.',
    `- ÉCARTE : ${CE_QUI_NE_SE_MEMORISE_JAMAIS.join(' ; ')}.`,
    '- Le résumé tient en une ou deux phrases (20 à 600 signes) ; le reste va dans « detail ».',
    options.dejaConnus.length ? `- Titres déjà présents dans la base (ne les recrée pas, complète-les seulement si la note apporte du neuf, avec le MÊME titre) : ${options.dejaConnus.slice(0, 200).join(' | ')}` : '',
    '',
    'ANCIENNES NOTES :',
    '',
    options.matiere,
  ]
    .filter((l) => l !== '')
    .join('\n');
}

/** La seconde passe d'un projet : la tête (00_project) et « À ne jamais supposer ». */
export function consigneDeSynthese(options: { nomDuProjet: string; depot: string; unites: readonly Pick<Unite, 'id' | 'type' | 'importance' | 'titre' | 'resume'>[] }): string {
  return [
    `Tu rédiges la TÊTE de la base de connaissances du projet « ${options.nomDuProjet} » : ses unités de type « project », et les unités « À ne jamais supposer ».`,
    '',
    'Rends UNIQUEMENT un tableau JSON de propositions, au même format : {"type","importance","titre","resume","detail","raisonnement","sujets","confiance","jamaisSupposer","source":{"genre":"depot","ref":"..."}}.',
    '- 2 à 5 unités « project » : à quoi sert le projet et pour qui, sa stack, son organisation, où il tourne et comment il se publie. Importance P0 ou P1.',
    '- 3 à 10 unités « jamaisSupposer: true » (de n’importe quel type) : ce qu’un nouvel agent supposerait à tort. Réutilise les faits des unités ci-dessous ; si une unité existante le dit déjà, reprends son titre exact.',
    '- Rien d’inventé : seulement ce que disent le dépôt et les unités.',
    '',
    'LE DÉPÔT :',
    options.depot,
    '',
    'LES UNITÉS DÉJÀ PRODUITES :',
    options.unites.map((u) => `${u.id} [${u.importance}] (${u.type}) ${u.titre} — ${u.resume}`).join('\n'),
  ].join('\n');
}

/** Le tableau JSON rendu par un modèle, même entouré de texte ou d'une clôture de code. */
export function lirePropositionsDuModele(texte: string): PropositionUnite[] {
  const brut = String(texte ?? '');
  const debut = brut.indexOf('[');
  const fin = brut.lastIndexOf(']');
  if (debut < 0 || fin <= debut) return [];
  try {
    const valeur = JSON.parse(brut.slice(debut, fin + 1));
    return Array.isArray(valeur) ? valeur.filter((v) => v && typeof v === 'object') : [];
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------------ */
/* Le reclassement                                                      */
/* ------------------------------------------------------------------ */

export interface Reclassement {
  id: string;
  avant: TypeUnite;
  apres: TypeUnite;
  raison: string;
}

/**
 * LA CONSIGNE DE RECLASSEMENT : un lot d'unités d'une même portée, jugées sur
 * leur titre et leur résumé d'après les définitions. Le modèle ne rend QUE les
 * unités à déplacer ; dans le doute, le type actuel reste.
 */
export function consigneDeReclassement(options: {
  nomDeLaPortee: string;
  unites: readonly Pick<Unite, 'id' | 'type' | 'titre' | 'resume'>[];
}): string {
  return [
    `Tu vérifies le CLASSEMENT des unités de la base de connaissances « ${options.nomDeLaPortee} ». Chaque unité a un type, et chaque type une définition :`,
    texteDesDefinitions(),
    '',
    'RÈGLES :',
    '- Juge d’après la définition ce que DIT l’unité, jamais un mot de son titre : une valeur stockée chiffrée est « security », un comportement lié à un service tiers est « integration », même s’ils parlent d’un état.',
    '- Ne déplace que ce qui est CLAIREMENT mal rangé. Dans le doute, ou si deux types conviennent, garde le type actuel.',
    '- « decision » exige un choix entre plusieurs options avec son pourquoi ; une unité n’y entre ni n’en sort sans raison nette (elle change alors d’identifiant).',
    '',
    'Rends UNIQUEMENT un tableau JSON, sans texte autour, des SEULES unités à déplacer (tableau vide si aucune) :',
    '[{"id": "MEM-0042", "type": "<nouveau type>", "raison": "<une phrase courte>"}]',
    '',
    'LES UNITÉS (id [type actuel] titre — résumé) :',
    options.unites.map((u) => `${u.id} [${u.type}] ${u.titre} — ${u.resume}`).join('\n'),
  ].join('\n');
}

/** Les déplacements rendus par le modèle : seulement des unités du lot, vers un type de la taxonomie différent de l'actuel. */
export function lireReclassementsDuModele(texte: string, unites: readonly Pick<Unite, 'id' | 'type'>[]): Reclassement[] {
  const parId = new Map(unites.map((u) => [u.id, u]));
  const vus = new Set<string>();
  const sortie: Reclassement[] = [];
  for (const brut of lirePropositionsDuModele(texte) as Record<string, unknown>[]) {
    const id = String(brut.id ?? '').trim().toUpperCase();
    const unite = parId.get(id);
    const apres = String(brut.type ?? '').trim().toLowerCase() as TypeUnite;
    if (!unite || vus.has(id) || !TYPES_UNITE.includes(apres) || apres === unite.type) continue;
    vus.add(id);
    sortie.push({ id, avant: unite.type, apres, raison: String(brut.raison ?? '').replace(/\s+/g, ' ').trim().slice(0, 200) });
  }
  return sortie;
}

/** Aucune unité ne reprend mot pour mot un long passage de la matière : la plus longue suite commune de mots. */
export function recopieMotPourMot(unite: string, matiere: string, mots = 25): boolean {
  const a = cleNormale(unite).split(' ');
  if (a.length < mots) return false;
  const m = ` ${cleNormale(matiere)} `;
  for (let i = 0; i + mots <= a.length; i += Math.max(1, Math.floor(mots / 3))) {
    if (m.includes(` ${a.slice(i, i + mots).join(' ')} `)) return true;
  }
  return false;
}
