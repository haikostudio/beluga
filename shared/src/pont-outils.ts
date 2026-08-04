/**
 * LE PONT D'OUTILS DU PROJET : a-t-il vraiment servi ?
 *
 * Les outils du projet (`project_memory`, `remember`, gestes de tableau) sont
 * servis au moteur par un petit programme, le « pont ». Rien ne prouvait qu'il
 * démarrait : un tour pouvait se dérouler entier SANS aucun outil, et le
 * compte rendu affirmait quand même avoir lu la mémoire. Un silence, jamais une
 * panne visible.
 *
 * Le pont s'annonce donc au démon : une fois quand il démarre, une fois quand
 * le moteur lui demande sa liste d'outils. Les règles ci-dessous lisent cette
 * trace et disent, en français, ce qui a manqué.
 */

/** Ce que le démon a vu du pont pendant UN tour. `null` : rien du tout. */
export type PassageDuPont = {
  /** Le pont a été lancé par le moteur et a répondu à la poignée de main. */
  demarre: boolean;
  /** Nombre d'outils rendus au moteur ; `null` : la liste n'a jamais été demandée. */
  outils: number | null;
} | null;

export type EtatDuPont = { ok: true } | { ok: false; raison: string };

export const PONT_ABSENT =
  "Les outils du projet ne sont jamais arrivés au moteur : le pont d'outils n'a pas démarré. " +
  'Ce tour s\'est donc fait SANS mémoire du projet, sans écriture de mémoire et sans geste de tableau — ' +
  'ce qui est dit de la mémoire dans la réponse n\'a pas été vérifié.';

export const PONT_SANS_LISTE =
  "Le pont d'outils du projet a démarré, mais le moteur ne lui a jamais demandé sa liste d'outils : " +
  'aucun outil du projet n\'a pu être appelé pendant ce tour.';

export const PONT_LISTE_VIDE =
  "Le pont d'outils du projet a démarré mais n'a rendu AUCUN outil : " +
  'ce tour s\'est fait sans mémoire du projet, sans écriture de mémoire et sans geste de tableau.';

/** Étiquette de l'étape en échec affichée dans la conversation. */
export const ETAPE_PONT = 'Outils du projet indisponibles';
/** Identifiant de cette étape : une seule par tour, jamais empilée. */
export const ETAPE_PONT_ID = 'pont-outils';

/**
 * Le tour a-t-il eu ses outils ? On ne juge PAS que le moteur s'en soit servi —
 * c'est son affaire — mais qu'ils aient été à sa portée.
 */
export function etatDuPont(passage: PassageDuPont): EtatDuPont {
  if (!passage || !passage.demarre) return { ok: false, raison: PONT_ABSENT };
  if (passage.outils === null) return { ok: false, raison: PONT_SANS_LISTE };
  if (passage.outils <= 0) return { ok: false, raison: PONT_LISTE_VIDE };
  return { ok: true };
}

/**
 * Les serveurs d'outils ÉTRANGERS déclarés dans la configuration d'un moteur.
 *
 * Codex lit sa propre `config.toml`, où l'utilisateur peut avoir branché
 * d'autres serveurs. Quand l'un d'eux propose lui aussi une mémoire, le modèle
 * l'appelle À LA PLACE de celle du projet et croit avoir lu la mémoire : c'est
 * exactement ce qui se voyait dans les tours du 4 août (`chercher_memoire`
 * appelé, `project_memory` jamais). On les éteint le temps d'un tour d'agent.
 *
 * Les trois écritures TOML d'un même serveur sont reconnues :
 * `[mcp_servers.nom]`, `[mcp_servers.nom.tools.x]` et `mcp_servers.nom = { … }`.
 */
export function serveursTiers(configToml: string, garde = 'haikodev'): string[] {
  const noms = new Set<string>();
  for (const ligne of configToml.split('\n')) {
    const texte = ligne.trim();
    if (texte.startsWith('#')) continue; // ligne mise de côté : elle ne branche rien
    const entete = texte.match(/^\[\s*mcp_servers\s*\.\s*([A-Za-z0-9_.-]+?)\s*(?:\.[A-Za-z0-9_."-]+)*\s*\]/);
    const affectation = texte.match(/^mcp_servers\s*\.\s*([A-Za-z0-9_-]+)\s*(?:\.[A-Za-z0-9_.-]+)?\s*=/);
    const nom = (entete?.[1] ?? affectation?.[1] ?? '').split('.')[0];
    if (nom && nom !== garde) noms.add(nom);
  }
  return [...noms];
}
