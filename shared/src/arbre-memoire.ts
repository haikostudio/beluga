import { DOSSIER_MEMOIRE, SUJETS_MEMOIRE, libelleSujet, nettoyer } from './memoire.js';

/**
 * L'ARBRE DE MÉMOIRE — la mémoire se NAVIGUE, elle ne se devine plus.
 *
 * Ce module ne touche ni au disque ni à la base : il décide seulement de la
 * FORME de l'arbre, du nom de chaque fichier et du texte des rappels. Il est
 * donc lisible et testable seul.
 *
 * Trois étages, et un seul principe : le nom du parent se lit dans le nom de
 * l'enfant, à chaque étage.
 *
 *   MEMOIRE.md                                  ← la RACINE : les sujets, et les
 *                                                  MOTS de chacune de leurs branches
 *   docs/memoire/quotas.md                      ← le RAPPEL du sujet : une ligne
 *                                                  par branche, avec son chemin
 *   docs/memoire/quotas/                        ← le dossier ENFANT, qui porte le
 *                                                  NOM DU PARENT
 *   docs/memoire/quotas/quotas-catalogue.md     ← le DÉTAIL, préfixé du parent
 *
 * Ce que cette forme achète, et qui est tout l'objet du changement : un humain
 * qui lit « catalogue » dans le fichier racine sait, SANS rien ouvrir d'autre,
 * que le détail vit dans `docs/memoire/quotas/quotas-catalogue.md`. Un agent
 * fait exactement le même chemin, avec l'outil `project_memory`. Personne n'a
 * besoin d'un moteur de recherche pour retrouver ce qui porte déjà son nom.
 *
 * LA BRANCHE PORTE LE NOM QUE LE FAIT S'EST DONNÉ. Les faits de ce projet sont
 * écrits « Sujet : le détail » depuis toujours — « Catalogue : 3 récents par
 * moteur… », « Cartes : naissent Planifiées… ». Ce préfixe EST le nom de la
 * branche : on ne l'invente pas, on le lit.
 */

/* ------------------------------------------------------------------ */
/* Nommer                                                              */
/* ------------------------------------------------------------------ */

/** La longueur au-delà de laquelle un préfixe n'est plus un titre mais une phrase. */
export const LONGUEUR_MAX_BRANCHE = 42;

/** La longueur en dessous de laquelle un préfixe ne nomme rien d'utile. */
const LONGUEUR_MIN_BRANCHE = 3;

/**
 * Un nom de fichier : sans accent, sans majuscule, sans ponctuation. C'est ce
 * qui rend le chemin tapable de mémoire, et identique sur tous les systèmes.
 */
export function slug(texte: string): string {
  return texte
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
}

/**
 * LE TITRE QUE LE FAIT S'EST DONNÉ : ce qui précède le premier « : ».
 *
 * On refuse un préfixe trop long (c'est une phrase, pas un titre), trop court
 * (il ne nomme rien), ou qui contient un point (deux phrases se sont
 * enchaînées). Dans ces cas-là, le fait n'a pas de branche à lui : il rejoint
 * la branche générale de son sujet.
 */
export function titreDuFait(texte: string): string | undefined {
  const propre = nettoyer(texte).replace(/^\*+|\*+$/g, '');
  const coupe = propre.indexOf(' : ');
  if (coupe < 0) return undefined;
  const titre = propre.slice(0, coupe).replace(/^\*+|\*+$/g, '').trim();
  if (titre.length < LONGUEUR_MIN_BRANCHE || titre.length > LONGUEUR_MAX_BRANCHE) return undefined;
  if (/[.;!?]/.test(titre)) return undefined;
  if (!slug(titre)) return undefined;
  return titre;
}

/** Le nom de la branche où tombe un fait sans titre à lui. */
export const BRANCHE_GENERALE = 'general';

/** Le dossier ENFANT d'un sujet — il porte le nom du parent. */
export function dossierDuSujet(sujet: string): string {
  return `${DOSSIER_MEMOIRE}/${slug(sujet)}`;
}

/**
 * Le fichier de DÉTAIL d'une branche. Le nom du parent est répété dans celui de
 * l'enfant : `quotas/quotas-catalogue.md`. C'est volontairement redondant —
 * ouvert seul, dans un onglet ou une recherche de fichiers, le fichier dit
 * encore d'où il vient.
 */
export function fichierDeBranche(sujet: string, branche: string): string {
  const parent = slug(sujet);
  const enfant = slug(branche) || BRANCHE_GENERALE;
  return `${DOSSIER_MEMOIRE}/${parent}/${parent}-${enfant}.md`;
}

/* ------------------------------------------------------------------ */
/* Répartir                                                            */
/* ------------------------------------------------------------------ */

/** Une branche : son titre lisible, son nom de fichier, ses faits. */
export interface BrancheMemoire {
  /** Le titre tel qu'un humain le lit — « Catalogue ». */
  titre: string;
  /** Le nom de fichier — « catalogue ». */
  nom: string;
  /** Le chemin du fichier de détail, relatif à la racine du projet. */
  fichier: string;
  faits: string[];
}

/** Un sujet et ses branches, tel que l'arbre le range. */
export interface SujetEnArbre {
  id: string;
  libelle: string;
  /** Le fichier de RAPPEL du sujet — `docs/memoire/quotas.md`. */
  rappel: string;
  /** Le dossier ENFANT — `docs/memoire/quotas`. Absent quand le sujet reste à plat. */
  dossier?: string;
  /**
   * Les branches, TOUJOURS nommées — même quand le sujet reste à plat. C'est ce
   * qui rend leur mot visible dans la carte : cacher « poignee-tiroir » parce
   * qu'il est seul, ce serait rendre introuvable exactement ce qu'on cherche.
   */
  branches: BrancheMemoire[];
  /** Vrai quand le sujet a son dossier enfant et ses fichiers de détail. */
  eclate: boolean;
  faits: number;
}

/**
 * EN DESSOUS DE DEUX BRANCHES, PAS DE DOSSIER. Un dossier enfant qui ne
 * contient qu'un fichier n'aide personne à naviguer : il ajoute un clic pour
 * rien. Le sujet garde alors ses faits dans son propre fichier de rappel — mais
 * sa branche reste NOMMÉE, et son mot reste dans la carte.
 */
export const BRANCHES_MINIMUM = 2;

/**
 * Les branches d'un sujet, dans l'ordre où ses faits ont été écrits. Deux faits
 * qui portent le même titre tombent dans la même branche — c'est ce qui
 * regroupe « Cartes : … » écrit à trois mois d'intervalle.
 */
export function repartirEnBranches(sujet: string, faits: string[]): BrancheMemoire[] {
  const parNom = new Map<string, BrancheMemoire>();
  for (const brut of faits) {
    const fait = nettoyer(brut);
    if (!fait) continue;
    const titre = titreDuFait(fait);
    const nom = titre ? slug(titre) : BRANCHE_GENERALE;
    const branche = parNom.get(nom) ?? {
      titre: titre ?? 'Divers',
      nom,
      fichier: fichierDeBranche(sujet, nom),
      faits: [],
    };
    branche.faits.push(fait);
    parNom.set(nom, branche);
  }
  return [...parNom.values()];
}

/**
 * L'ARBRE ENTIER, à partir des faits rangés par sujet. C'est la seule fonction
 * qui décide si un sujet mérite un dossier enfant : lecture, écriture, carte
 * envoyée au moteur et migration en dépendent toutes, et doivent voir la même
 * chose.
 */
export function construireLArbre(parSujet: Map<string, string[]>): SujetEnArbre[] {
  const arbre: SujetEnArbre[] = [];
  for (const sujet of SUJETS_MEMOIRE) {
    const faits = parSujet.get(sujet.id) ?? [];
    if (!faits.length) continue;
    const branches = repartirEnBranches(sujet.id, faits);
    const eclate = branches.length >= BRANCHES_MINIMUM;
    const rappel = `${DOSSIER_MEMOIRE}/${slug(sujet.id)}.md`;
    arbre.push({
      id: sujet.id,
      libelle: libelleSujet(sujet.id),
      rappel,
      dossier: eclate ? dossierDuSujet(sujet.id) : undefined,
      // Un sujet resté à plat n'a pas de fichier de détail : sa branche renvoie
      // au rappel, qui porte ses faits. Le chemin annoncé existe toujours.
      branches: eclate ? branches : branches.map((b) => ({ ...b, fichier: rappel })),
      eclate,
      faits: faits.length,
    });
  }
  return arbre;
}

/* ------------------------------------------------------------------ */
/* Retrouver — par le NOM, jamais par une note de ressemblance         */
/* ------------------------------------------------------------------ */

/** Une branche retrouvée, avec le sujet d'où elle vient. */
export interface BrancheTrouvee {
  sujet: SujetEnArbre;
  branche: BrancheMemoire;
}

/**
 * LE MOT LU DANS LE FICHIER RACINE OUVRE SON FICHIER DE DÉTAIL.
 *
 * C'est le geste que le système entier existe pour rendre possible, et il ne
 * repose sur AUCUNE note de ressemblance : on compare des noms. Un mot qui ne
 * nomme aucune branche ne rend rien — et ce silence est une réponse juste, là
 * où une recherche par le sens rendait cinq passages au hasard.
 *
 * Trois façons de nommer une branche, de la plus précise à la plus commode :
 *  — son chemin ou son nom de fichier (`quotas/quotas-catalogue`, `quotas-catalogue`) ;
 *  — « sujet/branche » ou « sujet branche » ;
 *  — le seul mot de la branche (`catalogue`), quand il ne désigne qu'elle.
 */
export function brancheDemandee(arbre: SujetEnArbre[], requete: string): BrancheTrouvee[] {
  const demande = slug(requete);
  if (!demande) return [];

  const toutes: BrancheTrouvee[] = arbre.flatMap((sujet) =>
    sujet.branches.map((branche) => ({ sujet, branche })),
  );

  // Le nom de fichier complet, avec ou sans son dossier et son extension.
  const parFichier = toutes.filter(({ sujet, branche }) => {
    const complet = `${slug(sujet.id)}-${branche.nom}`;
    return demande === complet || demande === `${slug(sujet.id)}-${complet}` || demande.endsWith(`-${complet}`);
  });
  if (parFichier.length) return parFichier;

  // Le mot de la branche, seul. On rend TOUTES celles qui le portent : deux
  // sujets peuvent avoir chacun leur « tiroir », et cacher l'un des deux serait
  // exactement le défaut qu'on corrige.
  const parNom = toutes.filter(({ branche }) => branche.nom === demande);
  if (parNom.length) return parNom;

  // Enfin, le mot CONTENU dans le nom d'une branche — « tiroir » pour
  // « tiroir-de-publication ». Jamais l'inverse : un nom de branche contenu
  // dans une longue demande ferait remonter n'importe quoi.
  return toutes.filter(({ branche }) => branche.nom.includes(demande) && demande.length >= 4);
}

/* ------------------------------------------------------------------ */
/* Écrire                                                              */
/* ------------------------------------------------------------------ */

/** La marque du fichier racine : ce qui distingue un sommaire d'une vieille mémoire à plat. */
export const MARQUE_ARBRE = '<!-- haikodev:arbre-memoire -->';

const ENTETE_AUTO = '_Tenu automatiquement par HaikoDev._';

/** Le texte du fichier RACINE — `MEMOIRE.md`. */
export function rendreRacine(arbre: SujetEnArbre[]): string {
  const total = arbre.reduce((n, s) => n + s.faits, 0);
  const lignes = [
    '# Mémoire du projet',
    '',
    MARQUE_ARBRE,
    '',
    `${ENTETE_AUTO} Les faits vivent dans \`${DOSSIER_MEMOIRE}/\`, en ARBRE : un fichier de rappel ` +
      "par sujet, puis un dossier du même nom qui porte le détail, un fichier par branche.",
    '',
    "**Comment retrouver un détail :** repérez le mot ci-dessous, le fichier porte ce mot " +
      'précédé du nom de son sujet. « catalogue » sous « quotas » se lit dans ' +
      `\`${DOSSIER_MEMOIRE}/quotas/quotas-catalogue.md\`.`,
    '',
  ];

  if (!arbre.length) {
    lignes.push('_Aucun fait retenu pour le moment._');
    return `${lignes.join('\n')}\n`;
  }

  lignes.push(`_${total} fait${total > 1 ? 's' : ''} en tout._`, '');
  for (const sujet of arbre) {
    const compte = sujet.faits > 1 ? `${sujet.faits} faits` : '1 fait';
    lignes.push(`## ${sujet.libelle}`, '', `Rappel : \`${sujet.rappel}\` (${compte})`, '');
    if (!sujet.eclate) continue;
    lignes.push(`Détail : \`${sujet.dossier}/\``, '');
    for (const branche of sujet.branches) {
      lignes.push(`- **${branche.titre}** — \`${branche.fichier}\``);
    }
    lignes.push('');
  }
  return `${lignes.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
}

/**
 * Le texte du fichier de RAPPEL d'un sujet — le « souvenir flou » : de quoi
 * SAVOIR qu'un détail existe et où il est, jamais de quoi s'en servir. C'est ce
 * niveau-là qui part au moteur ; le détail se demande.
 */
export function rendreRappelDuSujet(sujet: SujetEnArbre): string {
  const lignes = [
    `# Mémoire — ${sujet.libelle}`,
    '',
    `${ENTETE_AUTO} Ce fichier se demande avec l'outil \`project_memory\` (sujet « ${sujet.id} »).`,
    '',
  ];

  if (!sujet.eclate) {
    // Sujet resté à plat : ses faits sont ici, il n'y a rien de plus bas.
    lignes.push(...sujet.branches.flatMap((b) => b.faits).map((f) => `- ${f}`));
    return `${lignes.join('\n')}\n`;
  }

  lignes.push(
    `Le détail vit dans \`${sujet.dossier}/\`, un fichier par branche. ` +
      "Demande une branche par son mot pour en lire le texte entier.",
    '',
  );
  for (const branche of sujet.branches) {
    lignes.push(`- **${branche.titre}** (${branche.faits.length}) — \`${branche.fichier}\``);
  }
  return `${lignes.join('\n')}\n`;
}

/** Le texte d'un fichier de DÉTAIL — une branche, ses faits en entier. */
export function rendreBranche(sujet: SujetEnArbre, branche: BrancheMemoire): string {
  return (
    `# ${sujet.libelle} › ${branche.titre}\n\n` +
    `${ENTETE_AUTO} Branche de \`${sujet.rappel}\`. Faits durables uniquement, un par ligne.\n\n` +
    `${branche.faits.map((f) => `- ${f}`).join('\n')}\n`
  );
}

/* ------------------------------------------------------------------ */
/* La CARTE de l'arbre — ce qui part au moteur                         */
/* ------------------------------------------------------------------ */

/**
 * LA CARTE, PAS LE TERRITOIRE.
 *
 * C'est le seul texte de mémoire envoyé d'office au moteur, et il remplace à la
 * fois l'index des faits et les passages qu'une recherche remontait. Il ne
 * porte AUCUN fait : rien que les sujets, leurs branches, et la façon d'en
 * ouvrir une. Un sujet coûte une ligne, une branche trois mots — là où un
 * passage en coûtait deux cents.
 *
 * Le pari est explicite : un agent qui SAIT qu'une branche « catalogue »
 * existe ira la chercher au bon moment, et ne paiera rien pour les vingt
 * autres. Un agent noyé sous cinq passages tirés au sort n'apprenait ni l'un ni
 * l'autre.
 */
export function carteDeLArbre(arbre: SujetEnArbre[]): string {
  if (!arbre.length) {
    return "La mémoire du projet est vide : tu la rempliras en fin de tâche avec ce que tu auras appris.";
  }
  const total = arbre.reduce((n, s) => n + s.faits, 0);
  const lignes = [
    `MÉMOIRE DU PROJET — la CARTE de l'arbre (${total} fait${total > 1 ? 's' : ''}). ` +
      "Aucun fait n'est écrit ici : ce sont les CHEMINS pour les ouvrir. " +
      "Appelle « project_memory » avec le mot d'une branche dès qu'elle touche ce que tu vas modifier — " +
      'tu recevras ses faits en entier, ses règles et ses contrôles. Une seule fois par session : ' +
      'ce qui a été servi reste dans ton contexte.',
    '',
  ];
  for (const sujet of arbre) {
    const mots = sujet.branches.map((b) => b.nom).join(', ');
    lignes.push(`- « ${sujet.id} » (${sujet.libelle}) → ${mots}`);
  }
  return lignes.join('\n');
}

/**
 * Le RAPPEL de premier niveau tel qu'il part au moteur quand un sujet est
 * demandé : ses branches, sans leurs faits. C'est le cran intermédiaire —
 * l'agent voit ce qui existe sous le sujet avant de payer un détail.
 */
export function rappelDuSujet(sujet: SujetEnArbre): string {
  if (!sujet.eclate) return '';
  return (
    `SUJET « ${sujet.id} » (${sujet.libelle}) — ses branches, dans \`${sujet.dossier}/\` :\n` +
    sujet.branches.map((b) => `- ${b.nom} (${b.faits.length}) — ${b.titre}`).join('\n') +
    `\nDemande l'une d'elles par son mot pour en lire les faits.`
  );
}

/* ------------------------------------------------------------------ */
/* L'ÉTAGE AU-DESSUS : ce que le projet hérite de HaikoDev             */
/* ------------------------------------------------------------------ */

/**
 * L'HÉRITAGE NE VIENT PLUS FORCÉMENT DE LA PLATEFORME.
 *
 * Un projet désigne SA source dans ses réglages (`Project.heriteDe`). Trois cas,
 * et un seul est un réglage explicite :
 *  — clé ABSENTE : la source est HaikoDev. C'est le comportement d'origine, et
 *    il reste celui de tous les projets qui n'ont rien réglé ;
 *  — `HERITAGE_AUCUN` : ce projet n'hérite de RIEN. Utile pour un projet dont
 *    les règles n'ont aucun rapport avec celles de la plateforme — recevoir
 *    « ne jamais publier de sa propre initiative » n'y apprend rien ;
 *  — un IDENTIFIANT de projet : c'est ce projet-là qui fait foi. Une agence peut
 *    ainsi poser ses règles dans un projet « socle » dont tous les autres
 *    héritent, sans les recopier huit fois.
 */

/** La valeur qui dit « ce projet n'hérite de rien ». */
export const HERITAGE_AUCUN = 'aucun';

/** Ce que le réglage d'un projet désigne, une fois lu. */
export type CibleDHeritage =
  | { genre: 'plateforme' }
  | { genre: 'projet'; id: string }
  | { genre: 'aucun' };

/**
 * Le réglage LU, jamais deviné. Une chaîne vide vaut une clé absente : c'est ce
 * que rend un champ de formulaire qu'on n'a pas touché, et cela ne doit pas
 * couper l'héritage par accident.
 */
export function cibleDHeritage(heriteDe?: string): CibleDHeritage {
  const regle = (heriteDe ?? '').trim();
  if (!regle) return { genre: 'plateforme' };
  if (regle === HERITAGE_AUCUN) return { genre: 'aucun' };
  return { genre: 'projet', id: regle };
}

/**
 * LA COUCHE AMONT S'APPLIQUE-T-ELLE ?
 *
 * L'arbre ne s'arrête pas au projet : quand celui-ci n'a rien écrit sur un
 * sujet, la règle de sa SOURCE fait foi. C'est le dernier cran de l'arbre, et il
 * se demande comme les autres — par un nom.
 *
 * Deux refus, et un seul oui :
 *  — sur SA PROPRE SOURCE, jamais : un projet qui s'hériterait lui-même servirait
 *    deux fois le même fichier, sous deux noms. C'est aussi ce qui protège du
 *    réglage « je m'hérite moi-même », posé à la main ou par mégarde ;
 *  — sans dépôt amont lisible, jamais non plus : la mémoire du projet se
 *    comporte exactement comme si l'étage n'existait pas — ce qui couvre le cas
 *    d'une source SUPPRIMÉE depuis qu'elle a été réglée.
 */
export function amontApplicable(options: {
  /** Le chemin du projet visé. */
  projet: string;
  /** Le chemin du dépôt HaikoDev, quand il est connu. */
  amont?: string;
}): boolean {
  const projet = normaliserChemin(options.projet);
  const amont = normaliserChemin(options.amont ?? '');
  if (!projet || !amont) return false;
  return projet !== amont;
}

/** Un chemin comparable : sans barre finale, sans espaces autour. */
function normaliserChemin(chemin: string): string {
  return chemin.trim().replace(/\/+$/, '');
}
