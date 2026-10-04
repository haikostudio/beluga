/**
 * LES PROJETS DU TIROIR DE CHANGEMENT DE PROJET (clic sur le nom, en haut).
 *
 * Le tiroir montre les projets de la colonne de gauche, DANS SON ORDRE, mais à
 * plat : une seule liste, qu'on parcourt ou qu'on filtre. Les règles de la
 * colonne (`web/src/components/sidebar.tsx`) sont reprises telles quelles :
 *  - un projet mis de côté n'y est pas ;
 *  - les projets hors groupe et les groupes se rangent ENSEMBLE, par rang ;
 *    les membres d'un groupe suivent, par rang ;
 *  - l'espace de développement (`isSelf`) est fixé en tête de son groupe
 *    « Local » ; sans groupe, il ouvre la liste ;
 *  - les membres actifs d'un projet réuni le suivent immédiatement, au lieu de
 *    se ranger eux-mêmes.
 *
 * Règle PURE : ni base, ni disque.
 */
type ProjetDuTiroir = {
  id: string;
  archived?: boolean;
  isSelf?: boolean;
  rank?: number;
  groupId?: string;
  regroupement?: boolean;
  regroupementId?: string;
};

export function projetsDansLOrdreDeLaColonne<P extends ProjetDuTiroir>(
  projets: readonly P[],
  groupes: readonly { id: string; rank?: number }[],
): P[] {
  const rang = (x: { rank?: number }) => x.rank ?? 1000;
  const actifs = projets.filter((p) => !p.archived && !p.isSelf);
  const reunis = new Set(actifs.filter((p) => p.regroupement === true).map((p) => p.id));
  const rangeables = actifs.filter((p) => !(p.regroupementId && reunis.has(p.regroupementId)));
  const soi = projets.find((p) => p.isSelf && !p.archived);
  const aUnGroupe = (p: ProjetDuTiroir) => !!p.groupId && groupes.some((g) => g.id === p.groupId);

  /** Un projet, puis — s'il réunit d'autres projets — ses membres actifs. */
  const avecMembres = (p: P): P[] => [
    p,
    ...(reunis.has(p.id)
      ? actifs.filter((m) => m.regroupementId === p.id).sort((a, b) => rang(a) - rang(b))
      : []),
  ];

  const entrees: { rang: number; projets: P[] }[] = [];
  for (const p of rangeables) if (!aUnGroupe(p)) entrees.push({ rang: rang(p), projets: avecMembres(p) });
  for (const g of groupes) {
    const membres = rangeables
      .filter((p) => p.groupId === g.id)
      .sort((a, b) => rang(a) - rang(b))
      .flatMap(avecMembres);
    entrees.push({ rang: rang(g), projets: soi && soi.groupId === g.id ? [soi, ...membres] : membres });
  }
  entrees.sort((a, b) => a.rang - b.rang);
  const liste = entrees.flatMap((e) => e.projets);
  return soi && !aUnGroupe(soi) ? [soi, ...liste] : liste;
}
