import * as React from 'react';
import { Check, CircleDot, Loader2, X } from 'lucide-react';
import { TodoItem, mentionTachesNonFaites } from '@beluga/shared';
import { ZoneDefilement } from '@/components/ui';
import { CLASSE_TRAIT_DE_BRANCHE } from '@/components/pastille-projet';
import { cn, duration } from '@/lib/utils';
import { t } from '@/lib/langue';

/** Où l'on retient le choix « replié / déplié » d'une personne. */
const CLE_VOLET = 'beluga.volet-taches.deplie';

/**
 * REPLIÉE D'OFFICE, PARTOUT — sauf choix contraire. La liste est un détail du
 * travail : une ligne dit où en est l'agent, et l'on déplie pour en lire plus.
 */
function choixInitial(): boolean {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem(CLE_VOLET) === '1';
}

/**
 * LE PLI DE LA LISTE DES TÂCHES, RETENU D'UNE FOIS SUR L'AUTRE.
 *
 * Il n'y a plus qu'UN seul endroit où la liste s'ouvre — le repère compact
 * posé juste au-dessus de la barre d'écriture (`TravailEnCours`, `chat.tsx`),
 * qui reste là que l'agent travaille ou non. Le choix « replié / déplié » vit
 * donc ici, à côté de la liste elle-même, et pas dans le composant qui
 * l'affiche.
 */
export function usePliDesTaches(): [boolean, () => void] {
  const [open, setOpen] = React.useState(choixInitial);
  const basculer = React.useCallback(
    () =>
      setOpen((value) => {
        const suivant = !value;
        try {
          window.localStorage.setItem(CLE_VOLET, suivant ? '1' : '0');
        } catch {
          /* navigation privée : le choix vaut pour la session, c'est tout. */
        }
        return suivant;
      }),
    [],
  );
  return [open, basculer];
}

/**
 * LA CASE D'UNE TÂCHE : vide, en cours, cochée — ou barrée d'une croix quand le
 * tour s'est fini sans elle. Partagée par la liste de tâches et les étapes du
 * tournage du mode Réalisation (`chemin-de-realisation.tsx`), qui se valident
 * EXACTEMENT comme elle (décision de l'utilisateur du 23/10/2026).
 */
export function CaseDeTache({ etat, streaming }: { etat: TodoItem['state']; streaming: boolean }) {
  return (
    <span
      data-case-de-tache={etat}
      className={cn(
        'mt-[2px] flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded-[4px] border',
        etat === 'done'
          ? 'border-termine bg-termine/15'
          : etat === 'running'
            ? cn('border-en-cours', streaming && 'animate-pulse-soft')
            : 'border-[1.5px] border-muted',
      )}
    >
      {etat === 'done' ? (
        <Check className="h-2.5 w-2.5 text-termine" />
      ) : etat === 'running' ? (
        streaming ? (
          <Loader2 className="h-2.5 w-2.5 animate-spin text-en-cours" />
        ) : (
          <CircleDot className="h-2.5 w-2.5 text-en-cours" />
        )
      ) : etat === 'unfinished' ? (
        <X className="h-2.5 w-2.5 text-faint" />
      ) : null}
    </span>
  );
}

/** Le texte d'une ligne de tâche, selon son état : barrée une fois faite, appuyée en cours. */
export function classeDuLibelleDeTache(etat: TodoItem['state']): string {
  return cn(
    'text-[13.5px] leading-snug',
    etat === 'done' ? 'text-faint line-through' : etat === 'running' ? 'font-medium text-text' : 'text-muted',
  );
}

/**
 * OÙ TOMBE L'AXE DES BRANCHES, en px depuis le bord gauche d'une ligne de
 * tâche : sous le milieu de la case de l'étape du tournage. La liste est posée
 * 27 px à gauche du nom de l'étape (`chat.tsx`), sa zone a 23 px de marge et
 * la ligne 4 px : la case de la tâche tombe sous le nom de l'étape, et le
 * milieu de la case de l'étape (15 px + 8 px d'écart avant le nom) à
 * -15,5 px du nom, soit -11,5 px de la ligne. Le trait de 1 px part de -12.
 */
const AXE_DES_BRANCHES_DE_TACHE = -12;
/** Le milieu de la case d'une tâche : `py-1` (4) + `mt-[2px]` + 7,5. */
const MILIEU_DE_LA_CASE = 13.5;

/**
 * LA BRANCHE D'UNE TÂCHE RANGÉE SOUS UNE ÉTAPE — le pendant de `BrancheDeListe`
 * (`pastille-projet.tsx`) pour des lignes de hauteur libre (un libellé peut
 * passer à la ligne). Le trait vertical descend le long de la ligne, un trait
 * horizontal s'arrête à 2 px de la case ; chez la dernière, le vertical tourne
 * en coude arrondi. Le tronc qui relie la case de l'étape au haut de la liste
 * est posé par l'étape elle-même (`chemin-de-realisation.tsx`) : la zone qui
 * défile rognerait tout trait qui remonterait au-dessus d'elle.
 *
 * Absolue et sans pointeur : elle ne change ni la hauteur de la ligne ni ce
 * qu'on y clique. Elle suit le défilement avec sa ligne.
 */
function BrancheDeTache({ premier, dernier }: { premier: boolean; dernier: boolean }) {
  const axe = AXE_DES_BRANCHES_DE_TACHE;
  // Les suivantes couvrent aussi l'écart de 2 px (`space-y-0.5`) au-dessus d'elles.
  const haut = premier ? 0 : -2;
  // Jusqu'à 2 px de la case, qui commence à 4 px du bord (`px-1`).
  const largeur = 4 - 2 - axe;
  const trait = CLASSE_TRAIT_DE_BRANCHE;
  return (
    <span aria-hidden data-branche-de-tache={dernier ? 'dernier' : 'milieu'} className="pointer-events-none absolute inset-0">
      {dernier ? (
        <span
          className={`${trait} rounded-bl-[5px] border-b border-l`}
          style={{ left: axe, top: haut, height: MILIEU_DE_LA_CASE + 0.5 - haut, width: largeur }}
        />
      ) : (
        <>
          <span className={`${trait} bottom-0 border-l`} style={{ left: axe, top: haut }} />
          <span className={`${trait} border-t`} style={{ left: axe, top: MILIEU_DE_LA_CASE - 0.5, width: largeur }} />
        </>
      )}
    </span>
  );
}

/**
 * Le CORPS de la liste — les lignes cochables, avec leur temps. Partagé entre
 * le volet fixe ci-dessous (une fois le tour refermé) et la barre « Réflexion
 * en cours », qui se déplie sur ces mêmes lignes PENDANT le tour : deux
 * endroits, un seul rendu de la liste, pour ne jamais l'écrire deux fois.
 */
export function CorpsListeTaches({
  todos,
  streaming,
  maintenant,
  enBranches = false,
}: {
  todos: TodoItem[];
  streaming: boolean;
  maintenant: number;
  /**
   * RANGÉE SOUS UNE ÉTAPE DU TOURNAGE (mode Réalisation) : chaque ligne est
   * reliée à la case de l'étape par une branche pointillée, comme les membres
   * d'un projet réuni dans la colonne de gauche. Voir `BrancheDeTache`.
   */
  enBranches?: boolean;
}) {
  return (
    /* Hauteur BORNÉE : au-delà, la liste défile sur elle-même. Elle ne mange
       jamais la conversation ni la barre d'écriture. En branches, la marge
       gauche loge l'axe des traits DANS la zone : elle rogne ce qui la dépasse. */
    <ZoneDefilement
      classeEnveloppe="max-h-[min(35vh,260px)] flex-none"
      className={enBranches ? 'py-1.5 pl-[23px] pr-1' : 'px-2 py-1.5'}
    >
      <ul className="space-y-0.5" data-taches-en-branches={enBranches ? '' : undefined}>
        {todos.map((todo, index) => (
          <li
            key={`${index}-${todo.label}`}
            className={cn('flex items-start gap-2 px-1 py-1', enBranches && 'relative')}
            title={
              todo.closedByTurnEnd
                ? t('Cochée à la fin du tour : l\'agent ne l\'a pas marquée lui-même.')
                : todo.state === 'unfinished'
                  ? t('Le tour s\'est terminé sans que cette étape soit menée à bout.')
                  : undefined
            }
          >
            {/* Une vraie case à cocher : vide, en cours, cochée — ou barrée
                d'une croix quand le tour s'est fini sans elle. La case de
                l'étape EN COURS respire (`animate-pulse-soft`) tant que le
                tour tourne vraiment (`streaming`) — même couleur orange
                qu'avant, juste vivante plutôt que figée.
                LA CASE VIDE se dessine en `--muted`, d'un trait franc, comme
                celle des « évolutions possibles » : en `--border`, tout près
                du fond, on ne la voyait ni en clair ni en sombre. */}
            {enBranches ? <BrancheDeTache premier={index === 0} dernier={index === todos.length - 1} /> : null}
            <CaseDeTache etat={todo.state} streaming={streaming} />
            {/* `min-w-0` + coupure partout : un libellé sans espace (un chemin, une
                adresse) ne pousse plus la durée hors du cadre. */}
            <span className={cn('min-w-0 flex-1 [overflow-wrap:anywhere]', classeDuLibelleDeTache(todo.state))}>
              {todo.label}
            </span>
            {/* Le temps passé sur la ligne, exactement comme pour les étapes.
                Une ligne en cours affiche son temps qui court, ET la mention
                « EN COURS » — qui respire au même rythme que la case, tant
                que le tour tourne vraiment (`streaming`). Une ligne que le
                tour a laissée en plan le DIT, à la place de son temps. */}
            {todo.state === 'unfinished' ? (
              <span data-tache="non-faite" className="mt-[1px] shrink-0 text-[12px] text-faint">
                {t('non faite')}
              </span>
            ) : todo.state === 'running' ? (
              <span className="mt-[1px] flex shrink-0 items-center gap-1.5">
                {streaming ? (
                  <span
                    data-tache="en-cours"
                    className="animate-pulse-soft rounded border border-en-cours/50 px-1 text-[10px] font-semibold uppercase tracking-wide text-en-cours"
                  >
                    {t('En cours')}
                  </span>
                ) : null}
                {todo.startedAt ? (
                  <span className="text-[12px] tabular-nums text-faint">
                    {duration(((todo.endedAt ?? maintenant) - todo.startedAt) / 1000)}
                  </span>
                ) : null}
              </span>
            ) : todo.startedAt ? (
              <span className="mt-[1px] shrink-0 text-[12px] text-faint">
                {duration(((todo.endedAt ?? maintenant) - todo.startedAt) / 1000)}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </ZoneDefilement>
  );
}

/**
 * LA PHRASE DU REPÈRE UNE FOIS LE TOUR REFERMÉ.
 *
 * Le même texte que portait l'ancienne barre pleine largeur — le compte des
 * tâches faites, et ce que le tour a laissé en plan — mais servi désormais au
 * repère compact posé au-dessus de la barre d'écriture.
 */
export function resumeDesTaches(todos: readonly TodoItem[], options: { examen?: boolean } = {}): string {
  const faites = todos.filter((t) => t.state === 'done').length;
  const nonFaites = mentionTachesNonFaites(todos);
  /* LA CARTE DE NUIT N'A PAS DE TÂCHES À FAIRE : sa liste est celle des points
     que l'agent a examinés. « 3/3 faites » se lisait comme trois choses à faire. */
  const compte = options.examen
    ? t('Points examinés — {faites}/{v0}', { faites, v0: todos.length })
    : t('Liste des tâches — {faites}/{v0} faite{v1}', { faites, v0: todos.length, v1: faites > 1 ? 's' : '' });
  return nonFaites ? `${compte} · ${nonFaites}` : compte;
}
