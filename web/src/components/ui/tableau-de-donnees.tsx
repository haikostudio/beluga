import * as React from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronRight } from 'lucide-react';
import {
  TAILLES_DE_PAGE,
  TAILLE_DE_PAGE_PAR_DEFAUT,
  pageDuTableau,
  trierLesLignes,
  triSuivantDuTableau,
  type SensDuTri,
  type TriDuTableau,
  type ValeurTriable,
} from '@beluga/shared';
import { formatRegional, t } from '@/lib/langue';
import { cn } from '@/lib/utils';
import { ZoneDefilement } from '@/components/ui';
import { FlecheDePage } from '@/components/ui/pagination-fleches';

/**
 * UN VRAI TABLEAU : UN ENTÊTE, DES COLONNES TRIABLES, UN PIED QUI PAGINE
 * (demande du 06/10/2026, page « Résumé »).
 *
 * - L'ENTÊTE : un clic trie dans le sens naturel de la colonne (décroissant
 *   pour un chiffre, croissant pour un texte), un second dans l'autre sens, un
 *   troisième rend l'ordre du serveur (`triSuivantDuTableau`). Une colonne sans
 *   `valeur` ne se trie pas. `aria-sort` dit le tri aux lecteurs d'écran.
 * - LE PIED, sous le tableau : « 21–40 sur 312 », le choix 10 · 20 · 50
 *   lignes, les deux flèches et le rang de la page. Il reste HORS du
 *   défilement horizontal : sur téléphone, le tableau glisse, pas le pied. Changer de tri, de taille ou de
 *   lignes reçues (une autre période) ramène à la première page.
 * - SUR TÉLÉPHONE, le tableau défile À L'HORIZONTALE dans son cadre
 *   (`ZoneDefilement`) au lieu d'élargir la page ; les colonnes secondaires
 *   peuvent s'y cacher (`masqueSurTelephone`).
 * - Une ligne peut se DÉPLIER (`detail`) : la flèche est le premier bouton de
 *   la ligne, le détail s'ouvre sur toute la largeur en dessous.
 *
 * Tri et découpe sont les règles pures de `shared/src/resume.ts`.
 *
 * Repères : `data-tableau` (son nom), `data-tableau-lignes` (le total),
 * `data-tableau-tri` (« colonne:sens » ou vide), `data-tri-colonne` sur chaque
 * entête triable, `data-tableau-pied`, `data-page` (« rang/pages »),
 * `data-taille-page`, `data-page-suivante`, `data-page-precedente`.
 */
export interface ColonneDuTableau<L> {
  cle: string;
  libelle: string;
  /** La valeur de tri ; sans elle, la colonne ne se trie pas. */
  valeur?: (ligne: L) => ValeurTriable;
  /** Ce que montre la cellule ; par défaut la valeur de tri, ou « — ». */
  rendu?: (ligne: L) => React.ReactNode;
  /** Les chiffres se calent à droite, et se trient d'abord du plus grand au plus petit. */
  droite?: boolean;
  sensNaturel?: SensDuTri;
  /** Classes de largeur de la colonne (« w-24 »…). */
  largeur?: string;
  /** La colonne se cache sur téléphone. */
  masqueSurTelephone?: boolean;
}

export function TableauDeDonnees<L>({
  repere,
  lignes,
  colonnes,
  cle,
  triInitial = null,
  vide,
  detail,
  attributsLigne,
  taille: tailleImposee,
  onTaille,
}: {
  repere: string;
  lignes: readonly L[];
  colonnes: ColonneDuTableau<L>[];
  cle: (ligne: L) => string;
  triInitial?: TriDuTableau | null;
  /** La phrase d'un tableau sans ligne. */
  vide: string;
  /** Le détail d'une ligne dépliée. */
  detail?: (ligne: L) => React.ReactNode;
  /** Des attributs posés sur la ligne (repères de contrôle). */
  attributsLigne?: (ligne: L) => Record<string, string | number | undefined>;
  /** La taille de page retenue ailleurs (préférence) ; sinon le tableau la garde lui-même. */
  taille?: number;
  onTaille?: (taille: number) => void;
}) {
  const [tri, setTri] = React.useState<TriDuTableau | null>(triInitial);
  const [page, setPage] = React.useState(0);
  const [tailleLocale, setTailleLocale] = React.useState(TAILLE_DE_PAGE_PAR_DEFAUT);
  const [ouvertes, setOuvertes] = React.useState<ReadonlySet<string>>(() => new Set());
  const taille = tailleImposee ?? tailleLocale;

  /* D'autres lignes (une autre période) : on repart de la première page. La
     SIGNATURE, et non l'identité du tableau reçu : l'écran parent se redessine
     à chaque événement du démon, et une page ne doit pas sauter pour autant. */
  const signature = lignes.length ? `${lignes.length}:${cle(lignes[0]!)}:${cle(lignes[lignes.length - 1]!)}` : '0';
  React.useEffect(() => setPage(0), [signature]);

  const colonneTriee = tri ? colonnes.find((c) => c.cle === tri.colonne && c.valeur) : undefined;
  const triees = colonneTriee && tri ? trierLesLignes(lignes, colonneTriee.valeur!, tri.sens) : lignes;
  const morceau = pageDuTableau(triees, page, taille);
  const nbColonnes = colonnes.length;
  const format = formatRegional();

  const trier = (colonne: ColonneDuTableau<L>) => {
    setTri((actuel) => triSuivantDuTableau(actuel, colonne.cle, colonne.sensNaturel ?? (colonne.droite ? 'desc' : 'asc')));
    setPage(0);
  };
  const changerTaille = (n: number) => {
    if (onTaille) onTaille(n);
    else setTailleLocale(n);
    setPage(0);
  };
  const basculer = (id: string) =>
    setOuvertes((avant) => {
      const apres = new Set(avant);
      if (apres.has(id)) apres.delete(id);
      else apres.add(id);
      return apres;
    });

  return (
    <div className="min-w-0" data-tableau={repere} data-tableau-lignes={lignes.length} data-tableau-tri={tri ? `${tri.colonne}:${tri.sens}` : ''}>
      <ZoneDefilement axe="horizontal" barre={false} classeEnveloppe="min-w-0">
        <table className="w-full min-w-full border-separate border-spacing-y-0.5 text-left">
          <thead>
            <tr className="text-[11.5px] text-faint">
              {colonnes.map((colonne, rang) => {
                const actif = tri?.colonne === colonne.cle;
                const classes = cn(
                  'whitespace-nowrap px-2 py-1.5 font-normal',
                  colonne.droite && 'text-right',
                  rang === 0 && 'pl-3',
                  colonne.largeur,
                  colonne.masqueSurTelephone && 'hidden sm:table-cell',
                );
                if (!colonne.valeur) {
                  return (
                    <th key={colonne.cle} scope="col" className={classes}>
                      {colonne.libelle}
                    </th>
                  );
                }
                return (
                  <th
                    key={colonne.cle}
                    scope="col"
                    className={classes}
                    aria-sort={actif ? (tri!.sens === 'asc' ? 'ascending' : 'descending') : 'none'}
                  >
                    <button
                      type="button"
                      onClick={() => trier(colonne)}
                      className={cn(
                        'inline-flex max-w-full items-center gap-1 hover:text-text',
                        colonne.droite && 'flex-row-reverse',
                        actif && 'text-text',
                      )}
                      data-tri-colonne={colonne.cle}
                    >
                      <span className="truncate">{colonne.libelle}</span>
                      {actif ? (
                        tri!.sens === 'asc' ? (
                          <ArrowUp className="h-3 w-3 shrink-0" />
                        ) : (
                          <ArrowDown className="h-3 w-3 shrink-0" />
                        )
                      ) : (
                        <ArrowUpDown className="h-3 w-3 shrink-0 opacity-40" />
                      )}
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>

          <tbody>
            {morceau.lignes.length ? (
              morceau.lignes.map((ligne) => {
                const id = cle(ligne);
                const ouverte = ouvertes.has(id);
                return (
                  <React.Fragment key={id}>
                    <tr className="bg-bloc text-[12.5px] text-text" {...(attributsLigne?.(ligne) ?? {})}>
                      {colonnes.map((colonne, rang) => {
                        const brut = colonne.valeur?.(ligne);
                        const contenu = colonne.rendu
                          ? colonne.rendu(ligne)
                          : brut === null || brut === undefined
                            ? '—'
                            : typeof brut === 'number'
                              ? brut.toLocaleString(format)
                              : brut;
                        return (
                          <td
                            key={colonne.cle}
                            className={cn(
                              'max-w-[220px] px-2 py-1.5 align-middle sm:max-w-[320px]',
                              colonne.droite ? 'whitespace-nowrap text-right tabular-nums' : 'truncate',
                              rang === 0 && 'rounded-l-md pl-3',
                              rang === nbColonnes - 1 && 'rounded-r-md pr-3',
                              colonne.masqueSurTelephone && 'hidden sm:table-cell',
                            )}
                          >
                            {rang === 0 && detail ? (
                              <span className="flex min-w-0 items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => basculer(id)}
                                  aria-expanded={ouverte}
                                  aria-label={ouverte ? 'Replier le detail' : 'Deplier le detail'}
                                  title={ouverte ? t('Replier le détail') : t('Déplier le détail')}
                                  className="-ml-1 shrink-0 rounded p-0.5 text-faint hover:bg-raised hover:text-text"
                                  data-deplier-ligne
                                >
                                  <ChevronRight className={cn('h-3.5 w-3.5 transition-transform', ouverte && 'rotate-90')} />
                                </button>
                                <span className="min-w-0 truncate">{contenu}</span>
                              </span>
                            ) : (
                              contenu
                            )}
                          </td>
                        );
                      })}
                    </tr>
                    {detail && ouverte ? (
                      <tr>
                        <td colSpan={nbColonnes} className="rounded-md bg-bloc/60 px-3 py-2">
                          {detail(ligne)}
                        </td>
                      </tr>
                    ) : null}
                  </React.Fragment>
                );
              })
            ) : (
              <tr>
                <td colSpan={nbColonnes} className="px-3 py-3 text-[12.5px] text-faint">
                  {vide}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </ZoneDefilement>
      {lignes.length ? (
        <div className="flex flex-wrap items-center justify-between gap-2 px-1 pt-2 text-[12px] text-faint" data-tableau-pied>
          <span className="tabular-nums">
            {t('{v0}–{v1} sur {v2}', {
              v0: morceau.premier.toLocaleString(format),
              v1: morceau.dernier.toLocaleString(format),
              v2: morceau.total.toLocaleString(format),
            })}
          </span>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1">
              <span>{t('Lignes')}</span>
              <div className="inline-flex items-center gap-0.5 rounded-md bg-bloc p-0.5" role="group">
                {TAILLES_DE_PAGE.map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => changerTaille(n)}
                    aria-pressed={taille === n}
                    className={cn(
                      'h-5 rounded-[4px] px-1.5 font-mono text-[11px] tabular-nums transition-colors',
                      taille === n ? 'bg-raised text-text shadow-sm' : 'text-muted hover:text-text',
                    )}
                    data-taille-page={n}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-0.5" data-page={`${morceau.page + 1}/${morceau.pages}`}>
              <span data-page-precedente>
                <FlecheDePage sens="precedent" actif={morceau.page > 0} onClick={() => setPage(morceau.page - 1)} libelle={t('Page précédente')} />
              </span>
              <span className="tabular-nums">
                {morceau.page + 1} / {morceau.pages}
              </span>
              <span data-page-suivante>
                <FlecheDePage
                  sens="suivant"
                  actif={morceau.page < morceau.pages - 1}
                  onClick={() => setPage(morceau.page + 1)}
                  libelle={t('Page suivante')}
                />
              </span>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
