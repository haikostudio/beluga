/**
 * LE BRIDAGE DU CHEF D'ORCHESTRE, LE MÊME QUEL QUE SOIT LE MOTEUR.
 *
 * Hors de HaikoDev lui-même, le chef a TOUS LES DROITS SAUF UN : modifier le
 * CODE du projet. Une seule chose lui est fermée, et c'est bien une seule :
 * écrire lui-même dans un fichier de programme. Tout le reste lui est OUVERT —
 * lancer des commandes, construire, installer des dépendances, lancer un script
 * de déploiement, redémarrer un service, administrer la machine, écrire où il
 * veut sur le disque.
 *
 * POURQUOI PLUS DE BAC À SABLE (11/08/2026). La frontière était posée au niveau
 * du système : projet monté en lecture seule, écriture limitée à un dossier de
 * travail, élévation de privilèges coupée. Deux constats l'ont condamnée :
 *   - CONSTRUIRE ÉCRIT DANS LE PROJET (`node_modules`, `dist`, fichiers
 *     temporaires). « Projet en lecture seule » et « le chef peut construire »
 *     ne peuvent pas être vrais en même temps ;
 *   - `bwrap` pose `no_new_privs` sans échappatoire : sous bac à sable, `sudo`
 *     est impossible, donc aucune commande d'administration ne passe.
 * Un bac à sable qui bloque tout SAUF ce qu'il devait bloquer coûtait plus qu'il
 * ne protégeait : le chef se heurtait à des refus à chaque geste utile.
 *
 * LA FRONTIÈRE TIENT DONC SUR LES OUTILS, là où elle porte vraiment :
 *   1. les outils d'ÉDITION de fichiers (« Edit », « Write », « NotebookEdit »)
 *      restent INTERDITS au chef — c'est là que se modifie du code ;
 *   2. `write_document` n'accepte que des extensions de TEXTE : un fichier de
 *      programme est refusé par la liste (`shared/src/documents-du-chef.ts`) ;
 *   3. les outils du projet réservés aux agents de tâche restent hors de sa
 *      portée (`mcp_servers.haikodev.enabled_tools` / `disabled_tools` pour
 *      Codex ; `--allowedTools` / `--disallowedTools` pour Claude) ;
 *   4. les travaux de fond sont éteints par leurs interrupteurs de fonctionnalité.
 * Modifier le code reste donc un geste de carte, confié à un agent de tâche.
 *
 * Rien ici ne touche à la base ni au disque : la règle se lit et se rejoue
 * seule.
 */

/** Préfixe des outils du démon vus par un moteur. */
export const PREFIXE_OUTIL_PROJET = 'mcp__haikodev__';

/** Ce que le démon passe à un moteur pour brider un chef d'orchestre. */
export type ListesDuChef = {
  allowedTools?: string[];
  disallowedTools?: string[];
};

/** Le chef est-il bridé sur ce tour ? Une seule question, un seul endroit. */
export function chefBride(listes: ListesDuChef): boolean {
  return Boolean(listes.allowedTools?.length || listes.disallowedTools?.length);
}

/** Les outils DU PROJET d'une liste, sans leur préfixe de moteur. */
export function outilsDuProjet(liste?: string[]): string[] {
  return (liste ?? [])
    .filter((nom) => nom.startsWith(PREFIXE_OUTIL_PROJET))
    .map((nom) => nom.slice(PREFIXE_OUTIL_PROJET.length))
    .filter(Boolean);
}

/** Les outils NATIFS du moteur d'une liste (tout ce qui n'est pas au projet). */
export function outilsNatifs(liste?: string[]): string[] {
  return (liste ?? []).filter((nom) => !nom.startsWith(PREFIXE_OUTIL_PROJET));
}

/**
 * Les interrupteurs de fonctionnalité de Codex qui correspondent aux outils de
 * travail de fond interdits au chef (« Task », « Agent », « Workflow » sous
 * Claude). Un nom inconnu d'une version du moteur est sans effet : ces clés
 * sont libres, `--disable <nom>` vaut `-c features.<nom>=false`.
 */
export const FONCTIONNALITES_DE_FOND = ['multi_agent', 'multi_agent_v2', 'enable_fanout'];

/**
 * La traduction des deux listes en surcharges de configuration Codex, sous la
 * forme `clé=valeur` attendue derrière `-c`. Liste vide quand le chef n'est pas
 * bridé — un agent de tâche garde son accès complet, dans les deux moteurs.
 */
export function surchargesCodexDuChef(listes: ListesDuChef): string[] {
  if (!chefBride(listes)) return [];
  const surcharges: string[] = [];
  const permis = outilsDuProjet(listes.allowedTools);
  const interdits = outilsDuProjet(listes.disallowedTools);
  if (permis.length) surcharges.push(`mcp_servers.haikodev.enabled_tools=${JSON.stringify(permis)}`);
  if (interdits.length) surcharges.push(`mcp_servers.haikodev.disabled_tools=${JSON.stringify(interdits)}`);
  // ACCÈS COMPLET AUX COMMANDES. Le chef construit, installe, déploie,
  // redémarre, administre la machine : aucun de ces gestes ne tient sous un bac
  // à sable — construire écrit dans le projet, administrer exige l'élévation de
  // privilèges que `no_new_privs` interdit. Ce qui reste fermé au chef, ce sont
  // les outils d'ÉDITION (listés plus haut) : c'est là que se modifie du code.
  surcharges.push('sandbox_mode="danger-full-access"');
  // Une commande doit partir tout de suite : en attente d'approbation, personne
  // ne répond dans un tour non interactif et le tour se fige.
  surcharges.push('approval_policy="never"');
  for (const nom of FONCTIONNALITES_DE_FOND) surcharges.push(`features.${nom}=false`);
  return surcharges;
}

/**
 * Les réglages de Claude Code pour un chef bridé, à passer à `--settings`.
 * Absent (null) quand le chef n'est pas bridé — un agent de tâche a toujours eu
 * son accès complet. C'est le PENDANT du `danger-full-access` de Codex : le bac
 * à sable est ÉTEINT, les commandes partent sans approbation, et le projet est
 * ajouté par `--add-dir` côté ligne de commande pour que le chef l'ouvre.
 *
 * Le bac à sable a été retiré le 11/08/2026 : il rendait impossibles les gestes
 * mêmes qu'on veut ouvrir au chef (construire écrit dans le projet, administrer
 * exige l'élévation de privilèges), et ne protégeait le code que par ricochet.
 * La frontière du CODE tient maintenant sur les outils d'édition, interdits au
 * chef par `orchestratorDenyList` — voir l'entête de ce fichier.
 */
export function reglagesClaudeDuChef(
  listes: ListesDuChef,
  /** La racine du projet, ouverte au chef pour qu'il la lise et y travaille. */
  projectRoot?: string,
): Record<string, unknown> | null {
  if (!chefBride(listes)) return null;
  void projectRoot;
  return {
    sandbox: { enabled: false },
    // Sans approbation possible dans un tour non interactif, une commande qui
    // attend un accord fige le tour : on les laisse partir.
    permissions: { defaultMode: 'bypassPermissions' },
  };
}
