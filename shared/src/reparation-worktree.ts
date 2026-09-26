/**
 * UN DOSSIER DE TRAVAIL CASSÉ SE RÉPARE TOUT SEUL, IL NE BLOQUE PAS LA CARTE.
 *
 * Constat qui a produit ce fichier : sur le projet ProjetB, l'ouverture du
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
  | 'repartir-du-distant'
  /** Rendre au compte du service la propriété du dossier du projet. */
  | 'rendre-les-droits';

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
  /*
   * LES DROITS PASSENT AVANT LE VERROU, ET CE N'EST PAS UN DÉTAIL D'ORDRE.
   *
   * Constat du 22 septembre 2026 : 19 projets sur 24 refusaient de lancer la
   * moindre carte. Leurs dossiers appartenaient à un uid ORPHELIN (539936),
   * laissé par l'aller-retour des dépôts vers la Storage Box — plus aucun
   * compte ne le portait, et le service ne pouvait plus créer `.worktrees/`.
   * Git le disait de deux façons :
   *
   *   fatal: could not create leading directories of '…/.git': Permission denied
   *   fatal: cannot lock ref '…': Unable to create '….lock': Permission denied
   *
   * Le SECOND message était capté par `verrou-oublie` (« Unable to create
   * '….lock' »), qui lançait `retirer-le-verrou` : un geste sans aucun rapport,
   * qui ne pouvait rien et masquait la vraie cause derrière la phrase « un git
   * tué net a laissé un fichier de verrou derrière lui ». Cette entrée doit
   * donc rester EN PREMIER.
   *
   * Le lookahead écarte le seul « Permission denied » qui ne parle PAS de
   * propriété de fichiers : celui d'une clé SSH refusée par le dépôt distant
   * (« git@github.com: Permission denied (publickey). »), qu'aucun `chown` ne
   * réparerait.
   */
  {
    motif: /EACCES|EPERM|Operation not permitted|Permission denied(?! \(publickey)/i,
    panne: 'droits-insuffisants',
    explication:
      "les dossiers du projet n'appartenaient pas au compte du service, qui ne pouvait plus y écrire",
    gestes: ['rendre-les-droits'],
  },
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
  const texte = sansBruitDeProgression(message);
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
 * LA CAUSE, PAS LE PROCÈS-VERBAL. La raison affichée sur la carte gardait les
 * 300 DERNIERS SIGNES du message brut : sur un `git worktree add`, ce sont la
 * commande entière et ses deux chemins absolus qui tenaient la place, et la
 * carte affichait dix lignes commençant au milieu d'un mot (« mand failed: git
 * worktree add --quiet /root/… »). Git, lui, dit toujours la cause sur UNE
 * ligne, préfixée `fatal:` ou `error:` : c'est celle-là qu'on garde — la
 * dernière, qui porte l'échec final, et non le premier avertissement.
 *
 * À défaut (message sans préfixe connu), la dernière ligne non vide, bornée.
 * Un message vide n'invente rien : il le dit.
 */
export function causeDansLErreur(erreur: string): string {
  /* Le ruban d'avancement de git ne dit RIEN de la cause : il part d'abord,
     sans quoi c'est lui — et lui seul — qui remplissait la phrase. */
  const lignes = sansBruitDeProgression(erreur)
    .split('\n')
    .map((ligne) => ligne.trim())
    .filter(Boolean);
  if (!lignes.length) return 'git n’a rien dit de plus';
  const nommees = lignes.filter((ligne) => /^(?:fatal|error|warning):/i.test(ligne));
  const retenue = nommees.length ? nommees[nommees.length - 1] : lignes[lignes.length - 1];
  return retenue.length > 300 ? `${retenue.slice(0, 300)}…` : retenue;
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
  const detail = causeDansLErreur(erreur);
  const debut = 'Dossier de travail impossible à ouvrir pour cette carte (git worktree)';
  if (!panne && !gestesTentes.length) return `${debut} : ${detail}`;
  const nature = panne ? ` ${panne.explication},` : '';
  const tentes = gestesTentes.length ? ` réparations tentées : ${gestesTentes.join(', ')}` : ' aucune réparation possible';
  return `${debut} —${nature}${tentes}, sans succès. Détail : ${detail}`;
}

/* ------------------------------------------------------------------ */
/* LE BRUIT DE PROGRESSION DE GIT N'EST PAS UNE CAUSE                  */
/*                                                                     */
/* Constat qui a produit ce bloc : sur un dépôt de 41 706 fichiers,    */
/* l'ouverture de la copie de travail tombait sur son délai. Git avait */
/* alors déjà écrit des MILLIERS de lignes « Updating files:  27% », et */
/* c'est ce ruban — jamais la cause — qui remplissait la raison rendue  */
/* à la carte : « … (git worktree) : :  27% (11594/41706)Updating … ». */
/* On l'ôte donc AVANT de reconnaître la panne et avant de couper la   */
/* fin du message, pour que la vraie phrase de git reste lisible.      */
/* ------------------------------------------------------------------ */

/** Les rubans d'avancement que git écrit pendant qu'il travaille. */
const BRUITS_DE_PROGRESSION: RegExp[] = [
  /Updating files:\s*\d+%[^\n\r]*/gi,
  /Checking out files:\s*\d+%[^\n\r]*/gi,
  /(?:Receiving|Counting|Compressing|Writing) objects:\s*\d+%[^\n\r]*/gi,
  /Resolving deltas:\s*\d+%[^\n\r]*/gi,
  /remote: (?:Counting|Compressing|Enumerating) objects:\s*\d+%[^\n\r]*/gi,
];

/**
 * Le message de git débarrassé de son avancement. Ce qui reste est ce que git
 * avait vraiment à dire — souvent une seule ligne « fatal: … ».
 */
export function sansBruitDeProgression(message: string): string {
  let texte = (message ?? '').replace(/\r/g, '\n');
  for (const bruit of BRUITS_DE_PROGRESSION) texte = texte.replace(bruit, '');
  return texte
    .split('\n')
    .map((ligne) => ligne.trim())
    .filter((ligne) => ligne.length > 0)
    .join('\n')
    .trim();
}

/**
 * LE DÉLAI DÉPASSÉ EST UNE PANNE, PAS UN TRAVAIL LENT — et il se dit avec ce
 * mot-là. `execFile` tue le processus au bout du temps imparti : le message
 * qu'il rend (« Command failed », un signal, `ETIMEDOUT`) ne parle de rien pour
 * qui lit sa carte : cette phrase le remplace.
 */
export function motDeDelaiDepasse(secondes: number): string {
  const minutes = Math.max(1, Math.round(secondes / 60));
  return `délai dépassé après ${minutes} min — la copie de travail n'a pas fini de se créer (dépôt volumineux ou disque distant lent)`;
}

/* ------------------------------------------------------------------ */
/* LE TEMPS QU'ON LAISSE À UNE COPIE DE TRAVAIL POUR S'OUVRIR          */
/* ------------------------------------------------------------------ */

/**
 * `git worktree add` recopie TOUT le dépôt. Sur 41 706 fichiers posés sur un
 * disque distant, il en avait sorti 28 % au bout des trois minutes du délai
 * commun : il était tué là, et la carte refusait de partir.
 *
 * Mesures sur ces montages réseau (Storage Box, sshfs) : 58 s pour un dépôt de
 * 2 319 fichiers, 668 s — plus de onze minutes — pour celui de 41 706. Trois
 * minutes ne pouvaient donc pas suffire, et vingt ne laissaient presque aucune
 * marge quand le disque distant ralentit. Trois quarts d'heure la donnent,
 * sans jamais rien coûter quand la copie est rapide : ce délai est un plafond,
 * pas une attente.
 */
export const DELAI_OUVERTURE_DE_COPIE_MS = 45 * 60_000;

/**
 * Combien de temps un lancement DÉJÀ EN ROUTE interdit d'en relancer un second
 * sur la même carte. Ce garde-fou reprenait jusqu'ici le plafond d'un tour de
 * boucle (cinq minutes) : une ouverture de copie plus longue que cela laissait
 * l'ordonnanceur relancer la même carte toutes les cinq minutes, et les
 * lancements se disputaient le même dossier. Il suit donc l'ouverture, avec de
 * quoi la voir finir.
 */
export const PLAFOND_LANCEMENT_EN_ROUTE_MS = DELAI_OUVERTURE_DE_COPIE_MS + 5 * 60_000;
