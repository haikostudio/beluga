import * as React from 'react';
import { BookOpen, Check, ChevronRight, CircleDot, Loader2, X } from 'lucide-react';
import { RunStep, TodoItem, mentionTachesNonFaites } from '@haikodev/shared';
import { client } from '@/lib/client';
import { useApp } from '@/lib/use-app';
import { ZoneDefilement } from '@/components/ui';
import { estTelephone } from '@/lib/telephone';
import { cn, duration } from '@/lib/utils';
import { t } from '@/lib/langue';

/**
 * Le premier repère de chaque réponse (PLAN §26) : l'agent a relu la mémoire du
 * projet AVANT de répondre. Un clic déplie ce qu'il avait sous les yeux — le
 * texte vient du projet, il n'est pas recopié sous chaque message.
 */
export function MemoryNote({ step, projectId }: { step: RunStep; projectId?: string }) {
  const [open, setOpen] = React.useState(false);
  const state = useApp();
  const texte = projectId ? state.memory[projectId] : undefined;
  const vide = step.state === 'skipped';

  React.useEffect(() => {
    if (open && projectId && texte === undefined) client.send({ type: 'memory.get', projectId });
  }, [open, projectId, texte]);

  const ouvrable = !vide && !!projectId;

  return (
    <div className="mb-2 overflow-hidden rounded-md border border-border bg-surface/60">
      <button
        type="button"
        disabled={!ouvrable}
        onClick={() => setOpen((value) => !value)}
        className={cn('flex w-full items-center gap-2 px-2.5 py-1.5 text-left', ouvrable && 'hover:bg-raised')}
      >
        <BookOpen className={cn('h-3 w-3 shrink-0', vide ? 'text-faint' : 'text-accent')} />
        <span className="flex-1 truncate text-[13.5px] text-muted">{step.label}</span>
        {ouvrable ? (
          <ChevronRight className={cn('h-3 w-3 shrink-0 text-faint transition-transform', open && 'rotate-90')} />
        ) : null}
      </button>
      {open ? (
        <div className="mx-2 mb-2">
          <p className="px-1 pb-1 text-[12px] text-faint">{t('La mémoire du projet, telle qu\'elle est aujourd\'hui :')}</p>
          <ZoneDefilement
            fond="hsl(var(--raised))"
            classeEnveloppe="max-h-64 flex-none rounded bg-raised"
            className="p-2"
          >
            <pre className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-muted">
              {texte ?? t('Lecture…')}
            </pre>
          </ZoneDefilement>
        </div>
      ) : null}
    </div>
  );
}

/** Où l'on retient le choix « replié / déplié » d'une personne. */
const CLE_VOLET = 'haikodev.volet-taches.ouvert';

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
                d'une croix quand le tour s'est fini sans elle. */}
            <span
              className={cn(
                'mt-[2px] flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded-[4px] border',
                todo.state === 'done'
                  ? 'border-termine bg-termine/15'
                  : todo.state === 'running'
                    ? 'border-en-cours'
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
                Une ligne en cours affiche son temps qui court. Une ligne que
                le tour a laissée en plan le DIT, à la place de son temps. */}
            {todo.state === 'unfinished' ? (
              <span data-tache="non-faite" className="mt-[1px] shrink-0 text-[12px] text-faint">
                {t('non faite')}
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
export function resumeDesTaches(todos: readonly TodoItem[]): string {
  const faites = todos.filter((t) => t.state === 'done').length;
  const nonFaites = mentionTachesNonFaites(todos);
  const compte = t('Liste des tâches — {faites}/{v0} faite{v1}', { faites, v0: todos.length, v1: faites > 1 ? 's' : '' });
  return nonFaites ? `${compte} · ${nonFaites}` : compte;
}
