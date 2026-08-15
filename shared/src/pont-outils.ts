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
 * Ce qui s'ajoute à la RÉPONSE elle-même quand le pont a manqué. L'étape rouge
 * (`ETAPE_PONT`) se replie dans un tiroir qu'on peut ne jamais ouvrir ; sans ce
 * bloc dans le texte, un moteur privé d'outils pouvait écrire « la proposition
 * a été refusée » ou « aucune carte n'a été créée » et cette phrase inventée
 * restait la seule chose lue — jamais corrigée par le fait réel : aucun outil
 * n'était disponible, rien n'a été tenté ni refusé.
 */
export function noteDePontEnEchec(raison: string): string {
  return (
    `\n\n> [!WARNING]\n> ${raison} ` +
    "Une phrase ci-dessus qui parle d'un refus ou d'un choix n'en est pas un : " +
    "l'agent n'a rien pu appeler, faute d'outils."
  );
}

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
 * UN APPEL D'OUTIL APPARTIENT AU TOUR QUI L'A LANCÉ, ET À LUI SEUL.
 *
 * Le pont dit au démon quel AGENT il sert, en recopiant ce que sa configuration
 * porte. Cette configuration est un FICHIER sur le disque : s'il est resté là
 * après un tour, ou si le moteur en a lu un autre que le sien
 * (`shared/src/racine-cursor.ts`), l'appel arrive au nom d'un agent qui ne
 * travaille pas — et ce qu'il écrit part dans la conversation de quelqu'un
 * d'autre. C'est ainsi qu'une carte proposée s'est retrouvée dans le fil d'un
 * agent terminé deux heures plus tôt, dans un autre projet.
 *
 * Chaque tour porte donc un identifiant à lui, posé dans la configuration au
 * lancement. Le démon n'accepte l'appel que si cet identifiant est celui du tour
 * qui tourne VRAIMENT pour cet agent. Le refus se dit au moteur en toutes
 * lettres : mieux vaut un outil qui répond « ce n'est pas ton tour » qu'une
 * carte écrite chez le voisin.
 *
 * Une configuration ÉCRITE AVANT cette règle ne porte aucun identifiant : tant
 * que l'agent a bien un tour en cours, l'appel passe — un déploiement ne doit
 * pas couper les tours déjà partis.
 */
export const TOUR_TERMINE =
  "Refusé : ce tour est terminé. L'appel vient d'une configuration d'outils périmée — " +
  "rien n'a été écrit, et rien ne doit l'être au nom d'un autre agent.";

export const TOUR_ETRANGER =
  "Refusé : cet outil appartient à un autre tour que le tien. L'appel vient d'une configuration " +
  "d'outils qui n'est pas celle de ce tour — rien n'a été écrit.";

/** Ce que le démon sait au moment d'un appel d'outil. */
export interface AppelDuPont {
  /** L'identifiant de tour recopié par le pont ; absent d'une vieille configuration. */
  tourAnnonce?: string;
  /** L'identifiant du tour qui tourne pour cet agent ; absent : aucun tour. */
  tourEnCours?: string;
}

/** L'appel vient-il bien du tour qui tourne ? */
export function appelDuPontRecevable(appel: AppelDuPont): EtatDuPont {
  if (!appel.tourEnCours) return { ok: false, raison: TOUR_TERMINE };
  if (appel.tourAnnonce && appel.tourAnnonce !== appel.tourEnCours) {
    return { ok: false, raison: TOUR_ETRANGER };
  }
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
