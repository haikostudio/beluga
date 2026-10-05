/**
 * UNE LISTE DE PROJETS, RANGÉE EN ARBRE : chaque projet réuni est suivi de ses
 * membres, et chaque ligne sait si elle est un membre, le premier ou le dernier
 * de son bloc — de quoi dessiner le retrait et la branche.
 *
 * La règle se pose PAR-DESSUS un ordre déjà choisi (par activité, dans l'ordre
 * de la colonne, dans l'ordre de la base) et APRÈS la recherche : elle ne trie
 * rien, elle ne fait que rapprocher. Toutes les listes où l'on choisit un
 * projet la partagent (« Dans quel projet ? », « Changer de projet », « Déplacer
 * vers un autre projet », et les menus déroulants du coffre-fort, des notes et
 * des sauvegardes).
 *
 *  - Un BLOC (le projet réuni puis ses membres présents) prend la place de sa
 *    PREMIÈRE ligne dans la liste reçue : en tri par activité, celle du plus
 *    récemment actif d'entre eux. Les membres gardent leur ordre relatif.
 *  - Un membre dont le projet réuni n'est PAS dans la liste — mis de côté, ou
 *    écarté par la recherche — reste une ligne ordinaire, sans branche. C'est la
 *    règle de la colonne de gauche (`web/src/components/sidebar.tsx`), et c'est
 *    ce qui garde « Entrée choisit la seule ligne restante » dans les tiroirs.
 *  - L'espace de développement (`isSelf`) ne se range jamais sous un autre.
 *
 * Règle PURE : ni base, ni disque.
 */
type ProjetDArbre = {
  id: string;
  archived?: boolean;
  isSelf?: boolean;
  regroupement?: boolean;
  regroupementId?: string;
};

export interface LigneDArbre<P> {
  projet: P;
  /** Le projet réuni sous lequel cette ligne est rangée — absent pour une ligne ordinaire. */
  parentId?: string;
  /** Premier membre affiché sous son projet réuni (faux pour une ligne ordinaire). */
  premier: boolean;
  /** Dernier membre affiché sous son projet réuni (faux pour une ligne ordinaire). */
  dernier: boolean;
}

export function projetsEnArbre<P extends ProjetDArbre>(liste: readonly P[]): LigneDArbre<P>[] {
  const reunis = new Set(liste.filter((p) => p.regroupement === true && !p.archived).map((p) => p.id));
  // Un seul étage : un projet réuni ne se range pas lui-même sous un autre.
  const parentDe = (p: P) =>
    !p.isSelf && p.regroupement !== true && p.regroupementId && reunis.has(p.regroupementId)
      ? p.regroupementId
      : undefined;

  const membres = new Map<string, P[]>();
  for (const p of liste) {
    const parent = parentDe(p);
    if (parent) membres.set(parent, [...(membres.get(parent) ?? []), p]);
  }

  const parId = new Map(liste.map((p) => [p.id, p]));
  const poses = new Set<string>();
  const lignes: LigneDArbre<P>[] = [];
  for (const p of liste) {
    // Le bloc entier se pose à la première de ses lignes rencontrée.
    const tete = parId.get(parentDe(p) ?? p.id)!;
    if (poses.has(tete.id)) continue;
    poses.add(tete.id);
    lignes.push({ projet: tete, premier: false, dernier: false });
    const suite = membres.get(tete.id) ?? [];
    suite.forEach((membre, i) =>
      lignes.push({ projet: membre, parentId: tete.id, premier: i === 0, dernier: i === suite.length - 1 }),
    );
  }
  return lignes;
}

/**
 * LE LIBELLÉ D'UNE LIGNE DANS UN MENU DÉROULANT NATIF (`<select>`), qui n'a ni
 * icône ni trait : un membre porte un retrait et le signe « └ ». Les espaces
 * sont INSÉCABLES — un `<option>` avale les espaces ordinaires en tête.
 */
export function libelleDansUnMenu(nom: string, ligne: { parentId?: string }): string {
  return ligne.parentId ? `  └ ${nom}` : nom;
}
