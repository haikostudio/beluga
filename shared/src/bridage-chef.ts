/**
 * LE BRIDAGE DU CHEF D'ORCHESTRE, LE MÊME QUEL QUE SOIT LE MOTEUR.
 *
 * Hors de HaikoDev lui-même, le chef a TOUS LES DROITS SAUF UN : modifier le
 * code du projet. Il lit, il cherche, il propose une carte, il tient sa liste
 * de tâches — et il peut lancer des commandes (sondages, études, analyses) et
 * écrire ses brouillons dans un DOSSIER DE TRAVAIL à part. La seule chose qui
 * lui reste fermée : toucher aux fichiers du projet, qui restent en LECTURE
 * SEULE ; une modification du code s'ouvre en carte confiée à un agent de tâche.
 *
 * La frontière est la MÊME sous les deux moteurs, et posée au niveau du système
 * (bac à sable `bwrap`), jamais au seul bon vouloir du modèle :
 *   - le chef travaille dans un DOSSIER DE TRAVAIL séparé (son `cwd`), le seul
 *     où l'écriture est permise ;
 *   - le PROJET est monté en lecture seule : on le lit, jamais on n'y écrit —
 *     même une commande shell qui tente d'y écrire échoue (« Read-only file
 *     system ») ;
 *   - les travaux de fond (agents lancés par le moteur) restent éteints ;
 *     la publication reste un geste de l'utilisateur.
 *
 * Ce que chaque moteur sait faire de cette frontière :
 *   1. les outils du projet sont énumérés serveur par serveur pour Codex
 *      (`mcp_servers.haikodev.enabled_tools` / `disabled_tools`) ; Claude prend
 *      les deux listes telles quelles (`--allowedTools` / `--disallowedTools`) ;
 *   2. Codex passe son bac à sable en « écriture dans l'espace de travail »
 *      (`workspace-write`) : le `cwd` est écrivable, le reste — dont le projet —
 *      en lecture seule. Claude allume son bac à sable `bwrap` sur le même
 *      principe (`sandbox.enabled`), le projet ajouté en lecture par `--add-dir` ;
 *   3. les outils d'ÉDITION de fichiers (« Edit », « Write », « NotebookEdit »)
 *      restent interdits au chef — la ceinture par-dessus le bac à sable ;
 *   4. les travaux de fond sont éteints par leurs interrupteurs de fonctionnalité.
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
  // La frontière du chef : il ÉCRIT dans son dossier de travail (le `cwd` passé
  // au moteur), le reste — dont le projet — reste en LECTURE SEULE. C'est le bac
  // à sable qui la tient, pas le bon vouloir du modèle : une commande shell qui
  // tente d'écrire dans le projet échoue (« Read-only file system »). Le mode
  // `workspace-write` n'ouvre à l'écriture QUE l'espace de travail ; le dossier
  // du projet, lui, est ailleurs, donc intouchable.
  surcharges.push('sandbox_mode="workspace-write"');
  // Sondages, études, recherches : le chef a le droit au réseau depuis son bac
  // à sable. Ce qui reste fermé, c'est l'écriture du projet, pas Internet.
  surcharges.push('sandbox_workspace_write.network_access=true');
  // Une écriture refusée doit ÉCHOUER tout de suite. En attente d'approbation,
  // personne ne répond et le tour se fige.
  surcharges.push('approval_policy="never"');
  for (const nom of FONCTIONNALITES_DE_FOND) surcharges.push(`features.${nom}=false`);
  return surcharges;
}

/**
 * Les réglages du bac à sable de Claude Code pour un chef bridé, à passer à
 * `--settings`. Absent (null) quand le chef n'est pas bridé — un agent de tâche
 * garde son accès complet. C'est le PENDANT du `workspace-write` de Codex : le
 * bac à sable `bwrap` est allumé, le `cwd` (dossier de travail) reste écrivable,
 * le projet — ajouté en lecture par `--add-dir` côté ligne de commande — n'y est
 * pas, donc reste en lecture seule. `allowUnsandboxedCommands: false` interdit le
 * repli hors bac à sable : si le bac ne peut pas démarrer, la commande ÉCHOUE au
 * lieu de s'exécuter à nu et d'écrire le projet. `autoAllowBashIfSandboxed` fait
 * tourner les commandes sans quémander d'approbation, personne ne répondant à un
 * tour non interactif.
 */
export function reglagesClaudeDuChef(
  listes: ListesDuChef,
  /** La racine du projet, à garder en lecture seule même une fois montée. */
  projectRoot?: string,
): Record<string, unknown> | null {
  if (!chefBride(listes)) return null;
  const sandbox: Record<string, unknown> = {
    enabled: true,
    autoAllowBashIfSandboxed: true,
    allowUnsandboxedCommands: false,
    network: { allowedDomains: ['*'] },
  };
  // Le projet est monté en LECTURE (`--add-dir`) pour que le chef le parcoure —
  // mais `--add-dir` ouvrirait aussi l'écriture. On la referme explicitement :
  // `denyWrite` l'emporte, une commande shell qui tente d'y écrire échoue.
  if (projectRoot) sandbox.filesystem = { denyWrite: [projectRoot] };
  return { sandbox };
}
