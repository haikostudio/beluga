import { descriptionMoteur } from './registre-moteurs.js';
/**
 * Quel fichier d'instructions fait FOI pour un projet.
 *
 * Beluga Build désigne à chaque moteur son fichier natif : Codex lit `AGENTS.md`,
 * Claude lit `CLAUDE.md`. Mais un projet n'écrit presque jamais deux fois les
 * mêmes règles : à sa création, Beluga Build pose un `AGENTS.md` qui ne fait que
 * RENVOYER à `CLAUDE.md`. Nommer ce renvoi dans le briefing, c'est envoyer
 * l'agent Codex lire deux lignes vides de sens là où Claude reçoit tout — et
 * pire, lui faire écrire ses règles durables dans un fichier que personne ne lit.
 *
 * La règle ici SUIT le renvoi : un fichier d'instructions qui ne fait que
 * pointer vers un autre est résolu, et c'est le fichier POINTÉ qui est nommé.
 * Aucun fichier n'est supprimé ni réécrit ; on lit seulement, et on nomme juste.
 */

/** Les deux noms de fichier d'instructions que Beluga Build connaît. */
export const FICHIERS_INSTRUCTIONS = ['CLAUDE.md', 'AGENTS.md'] as const;

/**
 * Le fichier d'instructions NATIF du moteur, avant toute résolution. Cursor
 * suit la même convention que Codex (`AGENTS.md`) ; seul Claude lit `CLAUDE.md`.
 */
export function fichierNatif(engine?: string): string {
  return descriptionMoteur(engine)?.instructions ?? 'CLAUDE.md';
}

/** Un corps de 600 signes ou plus porte du vrai contenu, pas un renvoi. */
const RENVOI_SIGNES_MAX = 600;
/** Au-delà de trois phrases utiles, ce n'est plus un renvoi mais un document. */
const RENVOI_LIGNES_MAX = 3;

/** Le corps d'un fichier : ni titres, ni lignes vides. */
function corps(contenu: string): string[] {
  return contenu
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'));
}

/**
 * Le fichier vers lequel ce contenu RENVOIE, ou `null` s'il porte ses propres
 * instructions. Un renvoi tient en trois lignes courtes et nomme un autre
 * fichier d'instructions : rien d'autre.
 */
export function renvoiVers(contenu: string, depuis: string): string | null {
  const lignes = corps(contenu);
  if (!lignes.length) return null;
  if (lignes.length > RENVOI_LIGNES_MAX) return null;
  const texte = lignes.join(' ');
  if (texte.length >= RENVOI_SIGNES_MAX) return null;

  const cites = FICHIERS_INSTRUCTIONS.filter(
    (f) => f.toLowerCase() !== depuis.toLowerCase() && texte.toLowerCase().includes(f.toLowerCase()),
  );
  // Un seul fichier cité : le renvoi est sans ambiguïté. Deux, on ne tranche pas.
  return cites.length === 1 ? cites[0] : null;
}

/** Ce que le briefing doit annoncer à l'agent. */
export interface InstructionsDuProjet {
  /** Le fichier qui porte VRAIMENT les instructions, celui à lire et à tenir à jour. */
  fichier: string;
  /** Le fichier natif du moteur, quand il ne fait que renvoyer au précédent. */
  renvoiDepuis: string | null;
}

/**
 * Résout le fichier d'instructions à nommer, en suivant les renvois.
 *
 * `lire` rend le contenu d'un fichier du projet, ou `null` s'il n'existe pas —
 * c'est la seule porte vers le disque, pour que la règle reste testable seule.
 * Une chaîne de renvois est suivie jusqu'au bout, sans jamais boucler ; un
 * renvoi vers un fichier absent n'est pas suivi (mieux vaut le fichier natif,
 * même pauvre, qu'un nom qui n'existe pas).
 */
export function instructionsQuiFontFoi(
  engine: string | undefined,
  lire: (nom: string) => string | null,
): InstructionsDuProjet {
  const natif = fichierNatif(engine);
  let courant = natif;
  const vus = new Set<string>([courant]);

  for (;;) {
    const contenu = lire(courant);
    if (contenu === null) break;
    const suivant = renvoiVers(contenu, courant);
    if (!suivant || vus.has(suivant) || lire(suivant) === null) break;
    vus.add(suivant);
    courant = suivant;
  }

  return { fichier: courant, renvoiDepuis: courant === natif ? null : natif };
}
