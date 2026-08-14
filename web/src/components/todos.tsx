import * as React from 'react';
import { BookOpen, Check, ChevronDown, ChevronRight, ChevronUp, CircleDot, Loader2, X } from 'lucide-react';
import { RunStep, TodoItem, mentionTachesNonFaites } from '@haikodev/shared';
import { client } from '@/lib/client';
import { useApp } from '@/lib/use-app';
import { ZoneDefilement } from '@/components/ui';
import { estTelephone } from '@/lib/telephone';
import { cn, duration } from '@/lib/utils';

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
          <p className="px-1 pb-1 text-[12px] text-faint">La mémoire du projet, telle qu'elle est aujourd'hui :</p>
          <ZoneDefilement
            fond="hsl(var(--raised))"
            classeEnveloppe="max-h-64 flex-none rounded bg-raised"
            className="p-2"
          >
            <pre className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-muted">
              {texte ?? 'Lecture…'}
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
 * La liste de tâches annoncée par l'agent, cochée en direct. Elle dit ce qu'il
 * VA faire ; les étapes, elles, racontent ce qu'il a fait.
 *
 * Ce n'est PAS un bloc du fil : c'est un volet FIXE, posé entre la conversation
 * et la barre d'écriture. Dans le fil, la liste remontait avec les messages et
 * disparaissait de l'écran dès que l'agent répondait — précisément ce qu'on
 * voulait garder sous les yeux.
 */
export function VoletTaches({
  todos,
  streaming,
}: {
  todos?: TodoItem[];
  streaming: boolean;
}) {
  const [open, setOpen] = React.useState(choixInitial);

  const basculer = () =>
    setOpen((value) => {
      const suivant = !value;
      try {
        window.localStorage.setItem(CLE_VOLET, suivant ? '1' : '0');
      } catch {
        /* navigation privée : le choix vaut pour la session, c'est tout. */
      }
      return suivant;
    });

  // Une horloge, seulement pendant le travail : la ligne en cours voit son
  // temps avancer, comme un chronomètre.
  const [maintenant, setMaintenant] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (!streaming) return;
    const timer = window.setInterval(() => setMaintenant(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [streaming]);

  // Aucune liste en cours : le volet n'existe pas du tout.
  if (!todos?.length) return null;

  const faites = todos.filter((t) => t.state === 'done').length;
  const encours = todos.find((t) => t.state === 'running');
  const tout = faites === todos.length;
  // Ce que le tour a laissé en plan. L'en-tête le dit à la place de la ligne
  // en cours — il n'y en a plus une seule fois le tour refermé.
  const nonFaites = mentionTachesNonFaites(todos);

  return (
    <div data-volet="taches" className="shrink-0 border-t border-border bg-surface">
      <button
        type="button"
        aria-expanded={open}
        onClick={basculer}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-raised"
      >
        {tout ? (
          <Check className="h-3 w-3 shrink-0 text-termine" />
        ) : streaming ? (
          <Loader2 className="h-3 w-3 shrink-0 animate-spin text-en-cours" />
        ) : (
          <CircleDot className="h-3 w-3 shrink-0 text-faint" />
        )}
        {/* L'en-tête est TOUJOURS lisible, replié comme déplié : le compte, puis
            la tâche en cours, tronquée proprement s'il le faut. */}
        <span className="min-w-0 flex-1 truncate text-[13.5px] text-muted">
          <span className="text-text">
            Liste des tâches — {faites}/{todos.length} faite{faites > 1 ? 's' : ''}
          </span>
          {encours ? ` · ${encours.label}` : nonFaites ? ` · ${nonFaites}` : ''}
        </span>
        {/* La flèche pointe vers le HAUT quand le volet est fermé : c'est par
            là qu'il s'ouvre, au-dessus de la ligne. */}
        {open ? (
          <ChevronDown className="h-3 w-3 shrink-0 text-faint" />
        ) : (
          <ChevronUp className="h-3 w-3 shrink-0 text-faint" />
        )}
      </button>

      {open ? (
        /* Hauteur BORNÉE : au-delà, le volet défile sur lui-même. Il ne mange
           jamais la conversation ni la barre d'écriture. */
        <ZoneDefilement classeEnveloppe="max-h-[min(35vh,260px)] flex-none" className="px-2 py-1.5">
        <ul className="space-y-0.5">
          {todos.map((todo, index) => (
            <li
              key={`${index}-${todo.label}`}
              className="flex items-start gap-2 px-1 py-1"
              title={
                todo.closedByTurnEnd
                  ? "Cochée à la fin du tour : l'agent ne l'a pas marquée lui-même."
                  : todo.state === 'unfinished'
                    ? "Le tour s'est terminé sans que cette étape soit menée à bout."
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
                  non faite
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
      ) : null}
    </div>
  );
}
