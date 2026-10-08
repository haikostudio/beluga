/**
 * LES RÉCURRENCES DANS LE CODE DES PROJETS — les règles, sans base ni disque.
 *
 * LE CONSTAT (2026-10-06) : HaikoNote, ProjetA et Beluga avaient chacun le même
 * sélecteur de période (raccourcis, calendrier sur deux mois, Annuler /
 * Appliquer), et HaikoBill en a reçu un tout autre — deux champs date. Aucune
 * fiche ne décrivait ce sélecteur : le ménage de nuit, qui ne comparait que les
 * FICHES, ne pouvait pas voir une récurrence qui n'existait que dans le CODE.
 *
 * LA DÉCISION de l'utilisateur : la nuit cherche aussi dans le code. Le démon
 * relève, projet par projet, les fichiers d'INTERFACE dont le nom dit le rôle
 * (sélecteur de période, tableau paginé, fenêtre…), et ne remet à l'agent de
 * nuit que les rôles présents dans DEUX projets ou plus. Le relevé reste
 * MÉCANIQUE et BORNÉ — des chemins et un rôle supposé, jamais le contenu des
 * fichiers — ; le jugement (« est-ce vraiment le même élément ? ») est celui de
 * l'agent, qui lit les fichiers avant d'écrire la fiche commune.
 *
 * Le côté disque vit dans `server/src/recurrences-du-code.ts`.
 */

/** Un fichier d'interface relevé dans un projet. */
export interface ElementDInterface {
  /** Le nom du projet qui le porte. */
  projet: string;
  /** Son chemin ABSOLU, que l'agent ouvrira. */
  chemin: string;
  /** Le rôle supposé par son nom (`ROLES_D_INTERFACE`). */
  role: string;
  /** Modifié depuis le dernier passage (ou relevé à l'inventaire initial). */
  recent: boolean;
}

/** Un rôle d'interface présent dans au moins deux projets. */
export interface RecurrenceDuCode {
  role: string;
  /** Les projets distincts qui le portent. */
  projets: string[];
  /** Les fichiers, bornés à `EXEMPLES_PAR_ROLE_MAX`. */
  elements: ElementDInterface[];
}

/** Au plus autant de fichiers relevés par projet : un dépôt immense ne noie pas la consigne. */
export const FICHIERS_PAR_PROJET_MAX = 400;
/** Au plus autant d'exemples cités par rôle. */
export const EXEMPLES_PAR_ROLE_MAX = 6;
/** Au plus autant de rôles remis à l'agent en un passage. */
export const ROLES_PAR_PASSAGE_MAX = 8;

/** Les extensions d'un fichier d'interface. */
const EXTENSIONS = /\.(tsx|jsx|vue|svelte)$/i;
/**
 * Ce qui n'est jamais du code d'interface ÉCRIT POUR LE PROJET : essais, maquettes,
 * sorties de construction, dépendances — y compris un dossier de dépendances
 * renommé et suivi par git (`node_modules.reseau` de HaikoFormations, mesuré).
 */
const EXCLUS = /(^|\/)(node_modules[^/]*|dist|build|\.output|\.nuxt|\.next|coverage|vendor|public|ios|android)\/|\.(test|spec|stories)\.[a-z]+$/i;

/**
 * LES RÔLES QU'ON SAIT RECONNAÎTRE AU NOM. Une liste FERMÉE et courte : un rôle
 * deviné de travers coûte une lecture à l'agent, un rôle inventé pour chaque
 * fichier le noierait. L'ordre compte — le premier motif qui répond gagne.
 */
export const ROLES_D_INTERFACE: readonly { role: string; motif: RegExp }[] = [
  { role: 'sélecteur de période (plage de dates)', motif: /(periode|period|date-?range|daterange|plage|choix-?periode|range-?picker)/i },
  { role: 'sélecteur de date / calendrier', motif: /(date-?picker|datepicker|calendar|calendrier)/i },
  { role: 'tableau de données (tri, pagination)', motif: /(data-?table|datatable|table|tableau|pagination|paginat)/i },
  { role: 'recherche et filtres', motif: /(search|recherche|filtre|filter)/i },
  { role: 'fenêtre, tiroir ou feuille', motif: /(modal|dialog|drawer|tiroir|sheet|popover)/i },
  { role: 'dépôt de fichier', motif: /(upload|dropzone|depot-?de-?fichier|televers)/i },
  { role: 'notification passagère', motif: /(toast|snackbar)/i },
  { role: 'liste de choix', motif: /(combobox|select|picker|choix)/i },
  { role: 'onglets', motif: /(tabs|onglet)/i },
  { role: 'graphique', motif: /(chart|graph|graphique|sparkline)/i },
  { role: 'silhouette de chargement', motif: /(skeleton|silhouette)/i },
  { role: 'état vide', motif: /(empty-?state|etat-?vide)/i },
];

/** Un fichier d'interface, au sens du relevé ? (extension d'écran, hors essais et dépendances) */
export function estFichierDInterface(chemin: string): boolean {
  return EXTENSIONS.test(chemin) && !EXCLUS.test(chemin);
}

/** Le rôle supposé par le NOM du fichier (pas son dossier), ou `undefined`. */
export function roleSupposeDuFichier(chemin: string): string | undefined {
  const nom = chemin.split('/').pop()?.replace(EXTENSIONS, '') ?? '';
  // « SelecteurPeriode » et « selecteur-periode » se lisent pareil.
  const lisible = nom.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
  return ROLES_D_INTERFACE.find(({ motif }) => motif.test(lisible))?.role;
}

/**
 * LES RÔLES PRÉSENTS DANS DEUX PROJETS OU PLUS, dont au moins un fichier est
 * RÉCENT. Sans fichier récent, la récurrence a déjà été vue une nuit
 * précédente : on ne la repaie pas. Les plus partagés d'abord, bornés.
 */
export function rolesRecurrents(elements: readonly ElementDInterface[]): RecurrenceDuCode[] {
  const parRole = new Map<string, ElementDInterface[]>();
  for (const element of elements) parRole.set(element.role, [...(parRole.get(element.role) ?? []), element]);
  const recurrences: RecurrenceDuCode[] = [];
  for (const [role, tous] of parRole) {
    /*
     * Le récent en tête : c'est lui qui fait revenir le rôle cette nuit. Puis ce
     * que le projet a ÉCRIT avant les briques génériques d'une bibliothèque
     * d'interface (`components/ui/…`), identiques partout par construction.
     */
    const generique = (e: ElementDInterface) => Number(/\/ui\//.test(e.chemin));
    const tries = [...tous].sort((a, b) => Number(b.recent) - Number(a.recent) || generique(a) - generique(b));
    const projets = [...new Set(tries.map((e) => e.projet))];
    if (projets.length < 2 || !tous.some((e) => e.recent)) continue;
    // Un exemple par projet d'abord, puis les autres, jusqu'au plafond.
    const premiers = projets.map((p) => tries.find((e) => e.projet === p)!);
    const suite = tries.filter((e) => !premiers.includes(e));
    recurrences.push({ role, projets, elements: [...premiers, ...suite].slice(0, EXEMPLES_PAR_ROLE_MAX) });
  }
  return recurrences.sort((a, b) => b.projets.length - a.projets.length).slice(0, ROLES_PAR_PASSAGE_MAX);
}

/** Le bloc de la consigne de nuit qui nomme les récurrences relevées. */
export function texteDesRecurrencesDuCode(recurrences: readonly RecurrenceDuCode[], inventaire: boolean): string {
  if (!recurrences.length) return '';
  const entete = inventaire
    ? `ÉLÉMENTS D'INTERFACE DU MÊME GENRE DANS PLUSIEURS PROJETS — INVENTAIRE INITIAL (${recurrences.length} rôle(s), relevés au nom des fichiers) :`
    : `ÉLÉMENTS D'INTERFACE DU MÊME GENRE DANS PLUSIEURS PROJETS, dont un fichier a changé depuis le dernier passage (${recurrences.length} rôle(s), relevés au nom des fichiers) :`;
  const blocs = recurrences.map(
    (r) =>
      `- ${r.role} — ${r.projets.length} projets (${r.projets.join(', ')}) :\n` +
      r.elements.map((e) => `    · ${e.projet} : ${e.chemin}${e.recent && !inventaire ? ' (modifié)' : ''}`).join('\n'),
  );
  return `${entete}\n${blocs.join('\n')}`;
}
