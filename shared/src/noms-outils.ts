/**
 * LE NOM D'UN OUTIL SE LIT EN FRANÇAIS, JAMAIS EN NOM DE FONCTION.
 *
 * Le parcours d'une carte affichait « Outil ToolSearch », « Outil TaskUpdate »,
 * « Outil mcp__beluga__project_memory » — le nom interne de la fonction appelée,
 * suivi de ses paramètres bruts (« select:mcp__belug… »). Personne, hors du
 * code, ne sait ce que ces mots désignent : la ligne de temps d'une carte
 * devenait illisible dès qu'un agent sortait des trois ou quatre outils déjà
 * traduits.
 *
 * Chaque outil connu porte donc son libellé, ici et une seule fois. La table
 * sert aux DEUX bouts : le démon l'utilise en écrivant l'étape
 * (`server/src/engines/types.ts`), l'écran l'utilise en dessinant une entrée
 * déjà écrite (`web/src/components/journal-carte.tsx`) — ce qui rattrape aussi
 * les journaux enregistrés AVANT cette table.
 *
 * Un outil inconnu garde son nom nu, sans le mot « Outil » ni son préfixe de
 * pont : mieux vaut « ToolSearch » que « Outil mcp__beluga__ToolSearch ».
 *
 * Règle pure : ni base, ni disque.
 */

/** Le nom nu d'un outil : préfixe de pont retiré, casse d'origine gardée. */
export function nomSansPont(nom: string): string {
  return (nom ?? '').replace(/^mcp__[a-z0-9_]+__/i, '').trim();
}

/**
 * LES LIBELLÉS, PAR NOM D'OUTIL EN MINUSCULES. Le nom d'appel varie d'un
 * moteur à l'autre (`Read` / `read`, `ToolSearch` / `tool_search`) : la clé est
 * donc toujours minuscule, sans préfixe de pont.
 */
const LIBELLES: Record<string, string> = {
  /* Les outils du pont Beluga */
  ask_user: 'Question posée',
  board_list_cards: 'Lecture du tableau',
  board_create_card: 'Création d’une carte',
  board_update_card: 'Modification d’une carte',
  board_move_card: 'Déplacement d’une carte',
  deplacer_vers_projet: 'Changement de projet de la carte',
  board_delete_card: 'Suppression d’une carte',
  propose_task: 'Proposition d’une tâche',
  project_manage: 'Réglage d’un projet',
  group_manage: 'Réglage d’un groupe',
  project_memory: 'Lecture de la mémoire du projet',
  memoire: 'Base de connaissances',
  remember: 'Mise à jour de la mémoire du projet',
  write_document: 'Rédaction d’un document',
  make_archive: 'Préparation d’une archive',
  competences: 'Lecture des compétences partagées',
  coffre_fort: 'Ouverture du coffre-fort',
  compta: 'Facturation',
  attach_file: 'Fichier joint à la réponse',
  attach_screenshot: 'Fichier joint à la réponse',
  backup_recette: 'Aperçu du site',
  backup_essai: 'Aperçu d’un essai',
  relancer_publication: 'Relance de la publication',
  surveillance_essai: 'Essai d’une surveillance',
  surveillance_recette: 'Enregistrement d’une surveillance',
  deleguer: 'Consultation d’un autre modèle',
  evaluer: 'Évaluation par le juge local',
  suggerer_modele: 'Suggestion d’un autre modèle',

  /* Les outils du moteur */
  toolsearch: 'Recherche d’un outil',
  tool_search: 'Recherche d’un outil',
  taskcreate: 'Ajout d’une tâche à la liste',
  taskupdate: 'Mise à jour de la liste des tâches',
  tasklist: 'Lecture de la liste des tâches',
  taskget: 'Lecture d’une tâche',
  taskoutput: 'Lecture du travail d’une tâche',
  taskstop: 'Arrêt d’une tâche',
  todowrite: 'Mise à jour de la liste des tâches',
  exitplanmode: 'Sortie du mode plan',
  bashoutput: 'Suite d’une commande',
  killshell: 'Arrêt d’une commande',
  skill: 'Compétence appelée',
  slashcommand: 'Commande de l’assistant',
  agent: 'Délégation à un sous-agent',
  task: 'Délégation à un sous-agent',
  read: 'Lecture d’un fichier',
  write: 'Écriture d’un fichier',
  edit: 'Modification d’un fichier',
  notebookedit: 'Modification d’un carnet',
  bash: 'Commande lancée',
  grep: 'Recherche dans le projet',
  glob: 'Recherche de fichiers',
  websearch: 'Consultation du web',
  webfetch: 'Consultation du web',
  monitor: 'Surveillance d’une commande',
};

/**
 * LE LIBELLÉ D'UN OUTIL, ou `undefined` s'il n'en a pas de connu. L'appelant
 * décide alors quoi faire : le démon garde son propre repli, l'écran garde le
 * libellé déjà écrit dans le journal.
 */
export function libelleDOutil(nom: string | undefined): string | undefined {
  if (!nom) return undefined;
  return LIBELLES[nomSansPont(nom).toLowerCase()];
}

/**
 * CE QUI S'AFFICHE POUR UN OUTIL, TOUJOURS : son libellé s'il en a un, sinon
 * son nom nu — jamais le mot « Outil » collé devant un identifiant technique.
 */
export function nomAfficheDOutil(nom: string | undefined): string {
  return libelleDOutil(nom) ?? nomSansPont(nom ?? '');
}

/**
 * LE LIBELLÉ ÉCRIT DANS LE JOURNAL EST-IL UN NOM TECHNIQUE ?
 *
 * Les entrées déjà en base portent « Outil ToolSearch », « Outil ask_user »,
 * ou simplement le nom brut de l'outil. Les reconnaître permet de les
 * remplacer à l'affichage, sans réécrire une trace qui, elle, ne se réécrit
 * jamais.
 */
export function libelleTechnique(libelle: string | undefined, outil?: string): boolean {
  const texte = (libelle ?? '').trim();
  if (!texte) return true;
  if (/^outil\s+\S+$/i.test(texte)) return true;
  const nu = nomSansPont(texte).toLowerCase();
  if (outil && nu === nomSansPont(outil).toLowerCase()) return true;
  return LIBELLES[nu] !== undefined && nu !== texte.toLowerCase();
}

/**
 * LE NOM LISIBLE D'UNE ENTRÉE DE JOURNAL : son libellé si quelqu'un l'a déjà
 * écrit en clair, sinon le nom traduit de son outil.
 */
export function libelleLisible(entree: {
  libelle?: string;
  outil?: string;
}): string | undefined {
  const ecrit = (entree.libelle ?? '').trim();
  if (ecrit && !libelleTechnique(ecrit, entree.outil)) return ecrit;
  /* « Outil ToolSearch » porte le nom de l'outil dans son texte : c'est parfois
     la SEULE trace du nom, quand le champ `outil` est resté vide. */
  const dansLeTexte = /^outil\s+(\S+)$/i.exec(ecrit)?.[1];
  const libelle = libelleDOutil(entree.outil) ?? libelleDOutil(dansLeTexte);
  if (libelle) return libelle;
  const nu = nomSansPont(entree.outil ?? dansLeTexte ?? '');
  return nu || ecrit || undefined;
}
