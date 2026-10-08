import * as React from 'react';
import { Check, CircleDot, Loader2, X } from 'lucide-react';
import { TodoItem, mentionTachesNonFaites } from '@beluga/shared';
import { ZoneDefilement } from '@/components/ui';
import { estTelephone } from '@/lib/telephone';
import { cn, duration } from '@/lib/utils';
import { t } from '@/lib/langue';

/** Où l'on retient le choix « replié / déplié » d'une personne. */
const CLE_VOLET = 'beluga.volet-taches.ouvert';

/** Le téléphone commence replié, l'ordinateur déplié — sauf choix contraire. */
function choixInitial(): boolean {
  if (typeof window === 'undefined') return true;
  const retenu = window.localStorage.getItem(CLE_VOLET);
  if (retenu === '1') return true;
  if (retenu === '0') return false;
  return !estTelephone();
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
 * Le CORPS de la liste — les lignes cochables, avec leur temps. Partagé entre
 * le volet fixe ci-dessous (une fois le tour refermé) et la barre « Réflexion
 * en cours », qui se déplie sur ces mêmes lignes PENDANT le tour : deux
 * endroits, un seul rendu de la liste, pour ne jamais l'écrire deux fois.
 */
export function CorpsListeTaches({
  todos,
  streaming,
  maintenant,
}: {
  todos: TodoItem[];
  streaming: boolean;
  maintenant: number;
}) {
  return (
    /* Hauteur BORNÉE : au-delà, la liste défile sur elle-même. Elle ne mange
       jamais la conversation ni la barre d'écriture. */
    <ZoneDefilement classeEnveloppe="max-h-[min(35vh,260px)] flex-none" className="px-2 py-1.5">
      <ul className="space-y-0.5">
        {todos.map((todo, index) => (
          <li
            key={`${index}-${todo.label}`}
            className="flex items-start gap-2 px-1 py-1"
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
                qu'avant, juste vivante plutôt que figée. */}
            <span
              className={cn(
                'mt-[2px] flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded-[4px] border',
                todo.state === 'done'
                  ? 'border-termine bg-termine/15'
                  : todo.state === 'running'
                    ? cn('border-en-cours', streaming && 'animate-pulse-soft')
                    : 'border-border',
              )}
            >
              {todo.state === 'done' ? (
                <Check className="h-2.5 w-2.5 text-termine" />
              ) : todo.state === 'running' ? (
                streaming ? (
                  <Loader2 className="h-2.5 w-2.5 animate-spin text-en-cours" />
                ) : (
                  <CircleDot className="h-2.5 w-2.5 text-en-cours" />
                )
              ) : todo.state === 'unfinished' ? (
                <X className="h-2.5 w-2.5 text-faint" />
              ) : null}
            </span>
            <span
              className={cn(
                'flex-1 text-[13.5px] leading-snug',
                todo.state === 'done'
                  ? 'text-faint line-through'
                  : todo.state === 'running'
                    ? 'font-medium text-text'
                    : 'text-muted',
              )}
            >
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
