/**
 * UN DOSSIER DE TRAVAIL CASSÉ SE RÉPARE TOUT SEUL, IL NE BLOQUE PAS LA CARTE.
 *
 * Constat qui a produit ce fichier : sur le projet Rezideo, l'ouverture du
 * dossier de travail d'une carte (`git worktree add`) tombait sur un dépôt
 * abîmé. La carte s'arrêtait sur le message brut de git, et il fallait qu'un
 * humain le repère à l'écran puis demande la réparation à la main. Ces pannes
 * sont pourtant peu nombreuses, reconnaissables à leur message, et chacune a un
 * geste de réparation connu.
 *
 * Ici vivent les RÈGLES PURES : quel message désigne quelle panne, et quels
 * gestes tenter, dans quel ordre. Aucun appel à git, aucun disque — donc
 * rejouable sans dépôt. Le démon, lui, exécute ces gestes
 * (`server/src/dossier-de-carte.ts`).
 *
 * Deux principes qu'on n'enfreint pas :
 *   - on ne DÉTRUIT jamais du travail pour réparer : aucun geste n'efface une
 *     branche, ni un dossier de carte qui porte du travail non enregistré ;
 *   - une panne NON reconnue n'est pas bricolée : elle est rendue telle quelle,
 *     avec son message, plutôt que réparée au hasard.
 */

/** Les gestes que le démon sait faire pour remettre un dépôt d'aplomb. */
export type GesteDeReparation =
  /** `git worktree prune` : oublier les copies dont le dossier a disparu. */
  | 'ranger-les-copies'
  /** `git worktree repair` : recoller les liens entre le dépôt et ses copies. */
  | 'reparer-les-copies'
  /** `git worktree unlock` : lever le verrou posé sur une copie. */
  | 'deverrouiller-la-copie'
  /** Retirer le dossier de la carte, resté là sans son enregistrement. */
  | 'retirer-le-dossier'
  /** Rendre la branche de la carte, encore sortie dans une autre copie. */
  | 'liberer-la-branche'
  /** Effacer un fichier de verrou oublié par un git tué net (`index.lock`). */
  | 'retirer-le-verrou'
  /** Effacer les objets vides et redemander au dépôt distant ce qui manque. */
  | 'recuperer-les-objets'
  /** Reprendre la branche existante au lieu d'essayer de la créer. */
  | 'attacher-la-branche'
  /** Repartir de la branche du dépôt distant, la locale étant inutilisable. */
  | 'repartir-du-distant';

export interface PanneDeDossier {
  /** Le nom court de la panne, écrit dans le journal et dans la raison rendue. */
  panne: string;
  /** Ce qui s'est passé, en français simple, pour la carte et pour le journal. */
  explication: string;
  /** Les gestes à tenter, dans l'ordre. */
  gestes: GesteDeReparation[];
}

/**
 * Les pannes connues, de la plus PRÉCISE à la plus générale : « une branche
 * nommée … existe déjà » et « '<chemin>' existe déjà » se ressemblent au mot
 * près, seul l'ordre les sépare.
 */
const PANNES: Array<PanneDeDossier & { motif: RegExp }> = [
  {
    motif: /(?:index|HEAD|config|shallow|packed-refs)\.lock'?:? File exists|Unable to create '[^']*\.lock'/i,
    panne: 'verrou-oublie',
    explication: "un git tué net a laissé un fichier de verrou derrière lui",
    gestes: ['retirer-le-verrou'],
  },
  {
    motif: /missing but locked working tree|working tree is locked|cannot (?:remove|move) a locked working tree|is locked(?:,| by)/i,
    panne: 'copie-verrouillee',
    explication: "la copie de travail de la carte était marquée verrouillée",
    gestes: ['deverrouiller-la-copie', 'ranger-les-copies', 'retirer-le-dossier'],
  },
  {
    motif: /already (?:checked out|used by worktree)/i,
    panne: 'branche-prise-ailleurs',
    explication: "la branche de la carte était encore sortie dans une autre copie de travail",
    gestes: ['ranger-les-copies', 'liberer-la-branche'],
  },
  {
    motif: /a branch named '[^']*' already exists|branch '[^']*' already exists/i,
    panne: 'branche-deja-la',
    explication: "la branche de la carte existait déjà : on la reprend au lieu de la recréer",
    gestes: ['attacher-la-branche'],
  },
  {
    motif:
      /object file [^\s]+ is empty|loose object [^\s]+ is corrupt|unable to read (?:sha1 file|tree|object)|(?:bad|corrupt) (?:object|tree object|commit)|did not send all necessary objects|object [0-9a-f]{7,40} is corrupt|missing (?:blob|tree|commit) object|unable to (?:read|parse) commit/i,
    panne: 'objets-abimes',
    explication: "des objets du dépôt étaient vides ou abîmés : ils sont redemandés au dépôt distant",
    gestes: ['recuperer-les-objets', 'repartir-du-distant'],
  },
  {
    motif: /not a valid (?:object name|reference)|unknown revision or path not in the working tree|invalid reference/i,
    panne: 'point-de-depart-introuvable',
    explication: "le point de départ de la branche était introuvable dans le dépôt",
    gestes: ['recuperer-les-objets', 'repartir-du-distant'],
  },
  {
    motif: /'[^']*' already exists|destination path '[^']*' already exists|is not an empty directory|File exists/i,
    panne: 'dossier-encombre',
    explication: "un reste de tour précédent occupait le dossier de la carte",
    gestes: ['retirer-le-dossier', 'ranger-les-copies'],
  },
  {
    motif: /validation failed|not a working tree|\.git file .* invalid|is not a git repository|gitdir file .* (?:points to|is) /i,
    panne: 'copie-abimee',
    explication: "les fichiers de service de la copie de travail ne se tenaient plus",
    gestes: ['reparer-les-copies', 'ranger-les-copies', 'retirer-le-dossier'],
  },
];

/**
 * Quelle panne ce message de git désigne-t-il ? Rend `null` quand rien n'est
 * reconnu : on préfère dire l'erreur telle quelle plutôt que d'essayer des
 * gestes au hasard sur un dépôt dont on ne comprend pas l'état.
 */
export function reconnaitrePanneDeDossier(message: string): PanneDeDossier | null {
  const texte = (message ?? '').trim();
  if (!texte) return null;
  for (const { motif, panne, explication, gestes } of PANNES) {
    if (motif.test(texte)) return { panne, explication, gestes: [...gestes] };
  }
  return null;
}

/**
 * Combien de fois on retente l'ouverture après réparation. Trois : de quoi
 * enchaîner deux pannes qui se cachent l'une l'autre (un verrou oublié, puis
 * un dossier encombré), sans jamais tourner en rond.
 */
export const REPARATIONS_MAX = 3;

/**
 * Les chemins d'objets git cités dans un message d'erreur. Un objet VIDE se
 * répare en l'effaçant puis en le redemandant au dépôt distant ; encore
 * faut-il savoir lequel — git le nomme, on le lit plutôt que de fouiller tout
 * le dépôt.
 */
export function objetsCitesDansLErreur(message: string): string[] {
  const trouves = new Set<string>();
  const motif = /((?:[\w./-]*\.git\/)?objects\/[0-9a-f]{2}\/[0-9a-f]{6,40})/gi;
  for (const m of (message ?? '').matchAll(motif)) trouves.add(m[1]);
  return [...trouves];
}

/**
 * La phrase rendue à la carte quand tout a été tenté et que rien n'y a fait.
 * Elle dit CE QUI a été reconnu et CE QUI a été essayé : sans cela, l'erreur
 * brute de git revenait à l'écran comme avant, et l'utilisateur ne savait pas
 * que le système avait déjà cherché à se réparer.
 */
export function raisonApresReparations(
  erreur: string,
  panne: PanneDeDossier | null,
  gestesTentes: string[],
): string {
  const detail = (erreur ?? '').trim().slice(-300);
  const debut = 'Dossier de travail impossible à ouvrir pour cette carte (git worktree)';
  if (!panne && !gestesTentes.length) return `${debut} : ${detail}`;
  const nature = panne ? ` ${panne.explication},` : '';
  const tentes = gestesTentes.length ? ` réparations tentées : ${gestesTentes.join(', ')}` : ' aucune réparation possible';
  return `${debut} —${nature}${tentes}, sans succès. Détail : ${detail}`;
}
