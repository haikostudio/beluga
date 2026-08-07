/**
 * Les accès à la machine (le VPS) se règlent dans la fenêtre des réglages de
 * l'interface — c'est HaikoDev lui-même qu'ils concernent, pas un projet. Ces
 * règles sont PURES : elles disent seulement comment fabriquer un appel `ssh`
 * à partir des accès réglés, et si ces accès tiennent debout. Le serveur
 * (`server/src/acces-vps.ts`) les exécute ; l'interface les affiche.
 *
 * Laissés vides, rien ne passe par la machine distante : la création d'une
 * adresse publique (`server/src/dns.ts`) garde son fonctionnement LOCAL, mot
 * pour mot.
 */

export const MOYENS_VPS = ['agent', 'cle', 'mot-de-passe'] as const;
export type MoyenVps = (typeof MOYENS_VPS)[number];

/** Ce dont on a besoin pour joindre la machine. */
export interface AccesVps {
  /** Adresse de la machine : une IP ou un nom. */
  hote: string;
  /** Port SSH (22 par défaut). */
  port: number;
  /** Nom d'utilisateur pour la connexion. */
  utilisateur: string;
  /** Moyen de connexion : clés déjà en place, fichier de clé, ou mot de passe. */
  moyen: MoyenVps;
  /** Chemin du fichier de clé privée, quand le moyen est « cle ». */
  cle: string;
  /** Mot de passe, quand le moyen est « mot-de-passe ». */
  motDePasse: string;
}

/** Les réglages rangent ces accès à plat, comme le reste des préférences. */
export interface ReglagesAvecVps {
  vpsHote: string;
  vpsPort: number;
  vpsUtilisateur: string;
  vpsMoyen: MoyenVps;
  vpsCle: string;
  vpsMotDePasse: string;
}

export function accesDepuisReglages(r: ReglagesAvecVps): AccesVps {
  return {
    hote: r.vpsHote ?? '',
    port: r.vpsPort ?? 22,
    utilisateur: r.vpsUtilisateur ?? '',
    moyen: r.vpsMoyen ?? 'agent',
    cle: r.vpsCle ?? '',
    motDePasse: r.vpsMotDePasse ?? '',
  };
}

/**
 * Les accès sont renseignés dès qu'on a de quoi joindre une machine : une
 * adresse ET un utilisateur. Le reste a un défaut sensé (port 22, clés en
 * place). Tant que c'est faux, on reste sur le chemin LOCAL.
 */
export function accesRenseignes(a: AccesVps): boolean {
  return a.hote.trim().length > 0 && a.utilisateur.trim().length > 0;
}

/** Entoure un mot de guillemets simples pour un shell POSIX distant. */
export function citerShell(mot: string): string {
  return `'` + mot.replace(/'/g, `'\\''`) + `'`;
}

/**
 * Recompose une ligne de commande (programme + arguments) en UNE chaîne sûre,
 * telle qu'on la passe à `ssh` pour l'exécuter sur la machine distante. Chaque
 * morceau est entre guillemets : un heredoc ou une espace ne casse rien.
 */
export function commandeDistante(argv: string[]): string {
  return argv.map(citerShell).join(' ');
}

export interface AppelSsh {
  programme: string;
  args: string[];
}

/**
 * Construit l'appel `ssh` (ou `sshpass ssh`) qui lance `commande` sur la
 * machine réglée. Les options coupent court à toute question interactive :
 * délai de connexion borné, hôte inconnu accepté une fois, et — hors mot de
 * passe — `BatchMode` pour ÉCHOUER plutôt qu'attendre une saisie que personne
 * ne fera.
 */
export function argumentsSsh(a: AccesVps, commande: string): AppelSsh {
  const cible = `${a.utilisateur}@${a.hote}`;
  const communs = ['-o', 'ConnectTimeout=10', '-o', 'StrictHostKeyChecking=accept-new', '-p', String(a.port)];

  if (a.moyen === 'mot-de-passe') {
    // `sshpass` fournit le mot de passe ; BatchMode l'empêcherait de l'injecter.
    return { programme: 'sshpass', args: ['-p', a.motDePasse, 'ssh', ...communs, cible, commande] };
  }

  const args = ['-o', 'BatchMode=yes', ...communs];
  if (a.moyen === 'cle' && a.cle.trim()) args.push('-i', a.cle.trim());
  args.push(cible, commande);
  return { programme: 'ssh', args };
}

/**
 * Traduit en français la panne d'un `ssh` raté, à partir de sa sortie d'erreur.
 * Un test de connexion doit dire POURQUOI la machine refuse, jamais un jargon
 * brut. Ordre du plus précis au plus vague.
 */
export function messageErreurSsh(sortie: string): string {
  const s = (sortie ?? '').toLowerCase();
  if (s.includes('sshpass') && (s.includes('not found') || s.includes('command not found')))
    return "l'outil « sshpass » n'est pas installé sur ce serveur : choisissez un autre moyen de connexion";
  if (s.includes('permission denied') || s.includes('authentication failed'))
    return 'connexion refusée : le nom d’utilisateur, la clé ou le mot de passe ne conviennent pas';
  if (s.includes('could not resolve hostname') || s.includes('name or service not known'))
    return 'adresse introuvable : vérifiez l’adresse de la machine';
  if (s.includes('connection refused')) return 'connexion refusée sur ce port : vérifiez le port SSH';
  if (s.includes('timed out') || s.includes('timeout')) return 'la machine n’a pas répondu à temps';
  if (s.includes('no route to host')) return 'machine injoignable depuis ce serveur';
  const ligne = (sortie ?? '').split('\n').map((l) => l.trim()).filter(Boolean).pop();
  return ligne || 'la connexion a échoué';
}
