/**
 * LE BRIDAGE DU CHEF D'ORCHESTRE, LE MÊME QUEL QUE SOIT LE MOTEUR.
 *
 * Hors de HaikoDev lui-même, le chef ne fait pas le travail : il lit, il
 * cherche, il propose une carte, il tient sa liste de tâches. Les deux listes
 * — ce qui est permis, ce qui est interdit — sont calculées une seule fois par
 * le démon (`orchestratorAllowList` / `orchestratorDenyList`), pour tout moteur.
 *
 * Encore faut-il qu'elles ARRIVENT au moteur. Claude Code les prend telles
 * quelles (`--allowedTools` / `--disallowedTools`). Codex n'a pas de liste
 * d'outils en ligne de commande : il ignorait donc les deux listes, et le même
 * chef y disposait de l'écriture de fichiers. Les règles ci-dessous traduisent
 * les deux listes dans ce que Codex, lui, sait faire :
 *
 *   1. les outils du projet sont énumérés serveur par serveur
 *      (`mcp_servers.haikodev.enabled_tools` / `disabled_tools`) ;
 *   2. l'écriture de fichiers et les commandes sont coupées par le bac à sable
 *      en LECTURE SEULE, jamais par le seul bon vouloir du modèle ;
 *   3. les travaux de fond (agents lancés par le moteur) sont éteints par
 *      leurs interrupteurs de fonctionnalité.
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
  // Le bac à sable est ce qui remplace, chez Codex, l'interdiction nominative
  // de « Write », « Edit » et « Bash » : sans lui, l'interdiction ne serait
  // qu'une phrase dans la consigne.
  surcharges.push('sandbox_mode="read-only"');
  // Une écriture refusée doit ÉCHOUER tout de suite. En attente d'approbation,
  // personne ne répond et le tour se fige.
  surcharges.push('approval_policy="never"');
  for (const nom of FONCTIONNALITES_DE_FOND) surcharges.push(`features.${nom}=false`);
  return surcharges;
}
