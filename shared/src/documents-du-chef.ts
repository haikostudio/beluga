/**
 * CE QUE LE CHEF D'ORCHESTRE A LE DROIT D'ÉCRIRE DANS LE PROJET.
 *
 * La frontière du chef ne tient plus à un DOSSIER, elle tient à la NATURE du
 * fichier : il crée, modifie et supprime librement les DOCUMENTS — texte,
 * Markdown, traitement de texte — n'importe où dans le projet. Ce qui lui reste
 * fermé, c'est le CODE : le créer, le modifier ou l'effacer se délègue toujours
 * à un agent de tâche, par une carte.
 *
 * Pourquoi ce déplacement de la frontière :
 *
 *  1. UN CHEF QUI RÉDIGE DOIT POUVOIR TENIR SES PAGES — la documentation, la
 *     mémoire, un compte rendu, un fichier d'instructions : tout cela est du
 *     texte, et le renvoyer à un agent de tâche coûtait une carte pour une
 *     phrase.
 *  2. LE CODE NE BOUGE PAS D'UN CHEVEU — la liste des extensions acceptées ne
 *     contient aucun langage : `.ts`, `.tsx`, `.json`, `.sh`, `.py` sont refusés
 *     par construction, pas par bonne volonté du modèle.
 *  3. LE DOSSIER DES PLANS RESTE LE DÉFAUT — un nom NU (« refonte-accueil »)
 *     tombe toujours dans `docs/plans/`, qui est INDEXÉ en priorité haute par la
 *     recherche de passages (`server/src/passages.ts`) : un plan écrit
 *     aujourd'hui remonte tout seul au lancement de la carte qui le réalise.
 *
 * Le bac à sable, lui, ne bouge pas non plus : le projet reste monté en LECTURE
 * SEULE pour les commandes du chef (`bridage-chef.ts`). Cet outil est le seul
 * geste d'écriture qui lui soit ouvert, et c'est le DÉMON qui écrit à sa place —
 * d'où l'intérêt d'un contrôle de chemin qui se lit et se rejoue seul.
 *
 * Rien ici ne touche à la base ni au disque : l'existence d'un fichier est
 * DEMANDÉE à l'appelant (`existe`), jamais lue directement.
 */

/** Le dossier par défaut des plans du chef, relatif à la racine du projet. */
export const DOSSIER_PLANS = 'docs/plans';

/**
 * Ce qu'on accepte d'écrire par cet outil : des DOCUMENTS, jamais du code.
 * Aucun langage de programmation, aucun fichier de configuration exécuté —
 * c'est cette liste, et elle seule, qui tient la frontière.
 */
export const EXTENSIONS_DOCUMENT = [
  '.md',
  '.markdown',
  '.txt',
  '.rtf',
  '.doc',
  '.docx',
  '.odt',
  '.csv',
];

/** L'extension posée d'office quand la demande n'en porte aucune. */
export const EXTENSION_DOCUMENT_PAR_DEFAUT = '.md';

/**
 * Les dossiers de MACHINE : rien de ce qui s'y trouve n'est un document écrit
 * par quelqu'un, et y écrire n'aurait aucun effet durable (ils se régénèrent ou
 * ne sont pas versionnés).
 */
export const DOSSIERS_DE_MACHINE = ['node_modules', 'dist', 'build', 'coverage', 'data', 'out'];

/** Ce que rend l'examen d'un chemin demandé. */
export type CheminDeDocument =
  | {
      ok: true;
      chemin: string;
      /** Vrai quand le dossier des plans a été posé d'office (nom nu, fichier inconnu). */
      parDefaut: boolean;
    }
  | { ok: false; raison: string };

/**
 * Un nom de fichier lisible et sans piège : minuscules, sans accent, les espaces
 * et la ponctuation ramenés au tiret. « Plan : refonte de l'accueil » devient
 * « plan-refonte-de-l-accueil ». Un nom vide rend une chaîne vide — c'est
 * l'appelant qui décide quoi en faire.
 */
export function nomDeFichierPropre(brut: string): string {
  return brut
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 80);
}

/**
 * Un nom DÉJÀ utilisable tel quel se garde tel quel — majuscules comprises.
 * Sans cela, « CLAUDE.md » deviendrait « claude.md » et le chef ne pourrait
 * jamais rouvrir le fichier qu'il vient de lire.
 */
function nomDejaPropre(nom: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(nom);
}

/** L'extension d'un nom de fichier, en minuscules ; chaîne vide s'il n'en a pas. */
export function extensionDe(nom: string): string {
  const point = nom.lastIndexOf('.');
  return point > 0 ? nom.slice(point).toLowerCase() : '';
}

/** Ce chemin désigne-t-il un document (par opposition à du code) ? */
export function estUnDocument(chemin: string): boolean {
  return EXTENSIONS_DOCUMENT.includes(extensionDe(chemin));
}

/**
 * LE CHEMIN D'UN DOCUMENT DU CHEF, tel qu'on l'écrira vraiment.
 *
 * On accepte les trois façons de le demander — « refonte », « refonte.md »,
 * « docs/regles/cartes.md » — et on rend le chemin RÉEL, relatif à la racine du
 * projet. Un nom NU sans fichier connu à la racine part dans `docs/plans/` : le
 * dossier des plans reste le rangement par défaut.
 *
 * Ce qui est refusé, avec la raison dite en toutes lettres : sortir du projet,
 * viser un dossier de machine, un fichier caché, et surtout tout ce qui n'est
 * PAS un document — c'est-à-dire le code.
 *
 * @param existe Dit si un chemin relatif existe déjà dans le projet. Fourni par
 *   l'appelant (le démon a le disque, pas ce module) : sans lui, un nom nu part
 *   toujours dans le dossier des plans.
 */
export function cheminDuDocumentDuChef(
  demande: string,
  existe?: (relatif: string) => boolean,
): CheminDeDocument {
  const brut = String(demande ?? '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.\//, '');
  if (!brut) return { ok: false, raison: 'Le chemin du document est vide.' };
  if (brut.startsWith('/')) {
    return {
      ok: false,
      raison: 'Chemin refusé : un document s’écrit DANS le projet, jamais par un chemin absolu.',
    };
  }

  const segments = brut.split('/').filter((part) => part !== '');
  if (!segments.length) return { ok: false, raison: 'Le nom du document est vide.' };
  for (const segment of segments) {
    if (segment === '..') {
      return { ok: false, raison: 'Chemin refusé : on ne sort jamais du dossier du projet.' };
    }
    if (segment.startsWith('.')) {
      return { ok: false, raison: `Chemin refusé : « ${segment} » est un fichier ou un dossier caché.` };
    }
  }
  const dossiers = segments.slice(0, -1);
  const dossierDeMachine = dossiers.find((d) => DOSSIERS_DE_MACHINE.includes(d.toLowerCase()));
  if (dossierDeMachine) {
    return {
      ok: false,
      raison: `Chemin refusé : « ${dossierDeMachine}/ » est un dossier de machine, rien de ce qu'on y écrit ne dure.`,
    };
  }

  const nomDemande = segments[segments.length - 1];
  const extension = extensionDe(nomDemande);
  if (extension && !EXTENSIONS_DOCUMENT.includes(extension)) {
    return {
      ok: false,
      raison:
        `Refusé : « ${extension} » n'est pas un document. Cet outil écrit du TEXTE ` +
        `(${EXTENSIONS_DOCUMENT.join(', ')}) n'importe où dans le projet ; le CODE, lui, ` +
        `se modifie par une carte confiée à un agent de tâche.`,
    };
  }

  const base = extension ? nomDemande.slice(0, -extension.length) : nomDemande;
  if (!base) return { ok: false, raison: 'Le nom du document est vide.' };
  const nom = nomDejaPropre(base) ? base : nomDeFichierPropre(base);
  if (!nom) return { ok: false, raison: 'Le nom du document ne garde aucun caractère utilisable.' };
  const fichier = `${nom}${extension || EXTENSION_DOCUMENT_PAR_DEFAUT}`;

  // Un chemin qui NOMME son dossier est pris tel quel : c'est le geste d'un chef
  // qui sait où il écrit.
  if (dossiers.length) return { ok: true, chemin: [...dossiers, fichier].join('/'), parDefaut: false };

  // Un nom NU désigne un fichier de la racine s'il y existe déjà (« CLAUDE.md »,
  // « README.md ») ; sinon c'est un plan, et il tombe dans le dossier des plans.
  if (existe?.(fichier)) return { ok: true, chemin: fichier, parDefaut: false };
  return { ok: true, chemin: `${DOSSIER_PLANS}/${fichier}`, parDefaut: true };
}
