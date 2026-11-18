import * as React from 'react';
import type { SensDuTri, TriDuTableau, ValeurTriable } from '@beluga/shared';
import { Tableau, type ColonneDuTableauCommun } from '@/components/ui/tableau';

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
  /** Le filtre de la colonne, dans l'en-tête (tableau commun). */
  filtre?: 'texte' | 'choix';
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
  taille,
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
  /* UNE ENVELOPPE MINCE DU TABLEAU COMMUN (03/11/2026) : largeur au contenu, défilement de côté, pied toujours. */
  const communes = React.useMemo<ColonneDuTableauCommun<L>[]>(
    () =>
      colonnes.map((c) => ({
        cle: c.cle,
        libelle: c.libelle,
        ...(c.valeur ? { valeur: c.valeur } : {}),
        ...(c.rendu ? { rendu: c.rendu } : {}),
        ...(c.droite ? { droite: true } : {}),
        ...(c.sensNaturel ? { sensNaturel: c.sensNaturel } : {}),
        ...(c.largeur ? { largeur: c.largeur } : {}),
        ...(c.masqueSurTelephone ? { masqueSurTelephone: true } : {}),
        ...(c.filtre ? { filtre: c.filtre } : {}),
      })),
    [colonnes],
  );
  return (
    <Tableau
      repere={repere}
      lignes={lignes}
      colonnes={communes}
      cle={cle}
      triInitial={triInitial}
      vide={vide}
      {...(detail ? { detail } : {})}
      {...(attributsLigne ? { attributsLigne } : {})}
      {...(taille !== undefined ? { taille } : {})}
      {...(onTaille ? { onTaille } : {})}
      disposition="auto"
      pied="toujours"
    />
  );
}
