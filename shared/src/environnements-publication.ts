/**
 * Un projet a PLUSIEURS endroits où être mis en ligne.
 *
 * Jusqu'ici un projet ne portait qu'un seul jeu de réglages de publication :
 * une commande, une adresse. Décrire à la fois un environnement de dev chez le
 * client et une production — chacun avec sa commande, son adresse et sa branche
 * installée — était impossible : le second écrasait le premier.
 *
 * Le projet porte donc une LISTE ORDONNÉE d'environnements. Le premier est
 * l'environnement par défaut, celui que le bouton de publication vise quand on
 * n'en choisit aucun. Un projet réglé à l'ancienne (`deployCommand` /
 * `deployUrl`) n'est pas laissé de côté : il se relit comme un environnement
 * unique « interne » portant ses valeurs — aucune migration de base, aucune
 * perte, et le même comportement qu'avant.
 *
 * Règles PURES : ni base, ni disque, ni date. Ce qui touche à la machine
 * (service système, dossier servi) reste dans le démon.
 */

/** Ce qu'un environnement représente. Trois rôles, pas un de plus. */
export const ROLES_ENVIRONNEMENT = ['interne', 'dev-client', 'production'] as const;
export type RoleEnvironnement = (typeof ROLES_ENVIRONNEMENT)[number];

/** L'identifiant de l'environnement fabriqué pour un projet à l'ancien format. */
export const ENV_HERITE = 'interne';

/** Le nom montré pour un rôle, en français simple. */
export function libelleRole(role: RoleEnvironnement): string {
  switch (role) {
    case 'production':
      return 'production';
    case 'dev-client':
      return 'dev chez le client';
    default:
      return 'interne';
  }
}

/** Un endroit où ce projet peut être mis en ligne. */
export type EnvironnementPublication = {
  /** Stable : c'est lui qui relie un environnement à ses publications passées. */
  id: string;
  /** Le nom montré, choisi par l'utilisateur. */
  nom: string;
  role: RoleEnvironnement;
  /** Commande de publication propre à cet environnement. */
  commande?: string;
  /** Adresse à contrôler une fois la mise en ligne faite. */
  url?: string;
  /** Branche installée par cet environnement. Vide = la branche principale. */
  branche?: string;
};

/** Ce qu'un projet porte, vu d'ici : la liste neuve et les deux champs d'avant. */
export type ProjetPublie = {
  environments?: EnvironnementPublication[];
  deployCommand?: string;
  deployUrl?: string;
};

function propre(valeur?: string): string | undefined {
  const texte = valeur?.trim();
  return texte ? texte : undefined;
}

/**
 * Les environnements de ce projet, TOUJOURS au moins un.
 *
 * C'est le seul point de lecture : le démon comme l'interface passent par lui,
 * si bien qu'un projet à l'ancien format et un projet à plusieurs environnements
 * se traitent exactement pareil. La liste vide n'existe pas — un projet sans
 * réglage rend un environnement « interne » vide, qui refusera la mise en ligne
 * en le disant, comme avant.
 */
export function environnementsDuProjet(projet: ProjetPublie): EnvironnementPublication[] {
  const liste = (projet.environments ?? []).filter((env) => env && typeof env.id === 'string' && env.id.trim());
  if (liste.length) return liste.map(normaliserUn);
  return [
    {
      id: ENV_HERITE,
      nom: 'Interne',
      role: 'interne',
      commande: propre(projet.deployCommand),
      url: propre(projet.deployUrl),
    },
  ];
}

function normaliserUn(env: EnvironnementPublication): EnvironnementPublication {
  const role = ROLES_ENVIRONNEMENT.includes(env.role) ? env.role : 'interne';
  return {
    id: env.id.trim(),
    nom: propre(env.nom) ?? 'Sans nom',
    role,
    commande: propre(env.commande),
    url: propre(env.url),
    branche: propre(env.branche),
  };
}

/**
 * L'environnement visé par une publication.
 *
 * Sans identifiant — le bouton « Tout déployer » ordinaire — c'est le PREMIER
 * de la liste : l'ordre choisi dans les réglages fait donc foi. Un identifiant
 * inconnu (environnement supprimé entre-temps, ancien lien) retombe sur ce même
 * premier plutôt que de ne rien publier du tout.
 */
export function environnementVise(
  projet: ProjetPublie,
  environmentId?: string,
): EnvironnementPublication {
  const liste = environnementsDuProjet(projet);
  const vise = environmentId ? liste.find((env) => env.id === environmentId) : undefined;
  return vise ?? liste[0];
}

/* ------------------------------------------------------------------ */
/* Modifier la liste : ajouter, renommer, ranger, retirer              */
/* ------------------------------------------------------------------ */

/**
 * Un identifiant neuf, déduit du nom et rendu unique dans la liste. On ne tire
 * rien au hasard et on ne lit aucune horloge : la même liste et le même nom
 * donnent toujours le même identifiant, donc un contrôle est rejouable.
 */
export function identifiantEnvironnement(nom: string, deja: EnvironnementPublication[]): string {
  const base =
    nom
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 30) || 'env';
  const pris = new Set(deja.map((env) => env.id));
  if (!pris.has(base)) return base;
  for (let n = 2; n < 1000; n++) {
    if (!pris.has(`${base}-${n}`)) return `${base}-${n}`;
  }
  return `${base}-${deja.length + 1}`;
}

/** Ajoute un environnement à la fin de la liste. */
export function ajouterEnvironnement(
  liste: EnvironnementPublication[],
  input: { nom: string; role?: RoleEnvironnement },
): EnvironnementPublication[] {
  const nom = propre(input.nom) ?? 'Nouvel environnement';
  return [
    ...liste,
    { id: identifiantEnvironnement(nom, liste), nom, role: input.role ?? 'interne' },
  ];
}

/** Écrit un ou plusieurs champs d'un environnement, sans toucher aux autres. */
export function modifierEnvironnement(
  liste: EnvironnementPublication[],
  id: string,
  champs: Partial<Omit<EnvironnementPublication, 'id'>>,
): EnvironnementPublication[] {
  return liste.map((env) => (env.id === id ? { ...env, ...champs } : env));
}

/**
 * Monte ou descend un environnement d'un cran. Aux deux bouts, rien ne bouge :
 * une liste qui « saute » quand on pousse le premier vers le haut se lit comme
 * un bug, jamais comme une limite.
 */
export function deplacerEnvironnement(
  liste: EnvironnementPublication[],
  id: string,
  sens: 'haut' | 'bas',
): EnvironnementPublication[] {
  const index = liste.findIndex((env) => env.id === id);
  if (index < 0) return liste;
  const cible = sens === 'haut' ? index - 1 : index + 1;
  if (cible < 0 || cible >= liste.length) return liste;
  const copie = [...liste];
  [copie[index], copie[cible]] = [copie[cible], copie[index]];
  return copie;
}

/**
 * Retire un environnement. Le DERNIER ne se retire pas : un projet sans aucun
 * environnement n'aurait plus rien à viser, et la lecture en refabriquerait un
 * aussitôt — autant le dire clairement en refusant.
 */
export function retirerEnvironnement(
  liste: EnvironnementPublication[],
  id: string,
): EnvironnementPublication[] {
  if (liste.length <= 1) return liste;
  const reste = liste.filter((env) => env.id !== id);
  return reste.length ? reste : liste;
}

/* ------------------------------------------------------------------ */
/* Ce que chaque environnement a donné la dernière fois                 */
/* ------------------------------------------------------------------ */

/** Ce que le bloc de publication a besoin de savoir d'un run passé. */
export type ResultatDeRun = {
  environmentId?: string;
  /* « awaiting » : la publication s'est arrêtée avant l'envoi et attend l'accord
     de l'utilisateur (`shared/src/envoi-surveille.ts`). */
  state: 'running' | 'awaiting' | 'success' | 'failed' | 'stopped';
  startedAt: number;
  endedAt?: number;
  error?: string;
};

/**
 * Le DERNIER résultat de chaque environnement, du plus récent au plus ancien.
 *
 * Les publications d'avant cette règle ne portent aucun environnement : elles
 * comptent pour le PREMIER de la liste, celui qui reprend les anciens réglages
 * du projet — sinon un projet déjà réglé perdrait tout son passé d'un coup.
 */
export function derniersResultats(
  environnements: EnvironnementPublication[],
  runs: ResultatDeRun[],
): Map<string, ResultatDeRun> {
  const premier = environnements[0]?.id;
  const connus = new Set(environnements.map((env) => env.id));
  const derniers = new Map<string, ResultatDeRun>();
  for (const run of [...runs].sort((a, b) => b.startedAt - a.startedAt)) {
    const id = run.environmentId && connus.has(run.environmentId) ? run.environmentId : premier;
    if (!id) continue;
    if (!derniers.has(id)) derniers.set(id, run);
  }
  return derniers;
}

/** Le résultat d'un environnement, dit en une ligne pour le bloc de publication. */
export function mentionResultat(resultat: ResultatDeRun | undefined): string {
  if (!resultat) return 'jamais publié';
  switch (resultat.state) {
    case 'running':
      return 'publication en cours';
    case 'awaiting':
      return 'votre accord est attendu avant tout envoi';
    case 'success':
      return 'dernière publication réussie';
    case 'stopped':
      return 'dernière publication arrêtée';
    default:
      return `dernière publication en échec${resultat.error ? ` : ${resultat.error}` : ''}`;
  }
}
