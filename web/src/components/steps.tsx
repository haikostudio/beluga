import * as React from 'react';
import { Camera, Check, ChevronRight, Circle, Loader2, X, MinusCircle } from 'lucide-react';
import { EntreeJournal, RunStep } from '@beluga/shared';
import { ContenuDeLEntree } from '@/components/contenu-journal';
import { cn, duration } from '@/lib/utils';
import { t } from '@/lib/langue';

/**
 * UNE ÉTAPE EN DIRECT, RELUE COMME UNE ENTRÉE DE JOURNAL.
 *
 * Le déroulé en direct et le parcours d'une carte racontent le MÊME travail :
 * ils ne doivent pas le dessiner deux fois. L'étape porte déjà son nom d'outil
 * et ses paramètres ; on lui donne la forme d'une entrée de journal, et le même
 * aiguillage (`vueDeLEntree` → `ContenuDeLEntree`) fait le reste.
 *
 * LES CHAMPS QUI N'ONT PAS DE SENS ICI SONT NEUTRES, jamais inventés : une
 * étape en direct n'appartient à aucune carte et n'a pas encore de rang.
 */
function entreeDeLEtape(step: RunStep): EntreeJournal {
  return {
    id: step.id,
    cardId: '',
    rang: 0,
    phase: 'execution',
    nature: 'requete',
    at: step.startedAt ?? 0,
    libelle: step.label,
    ...(step.outil ? { outil: step.outil } : {}),
    ...(step.entree ? { params: step.entree } : {}),
    resultat: step.detail ?? '',
    reussie: step.state !== 'failed',
  };
}

/** Cette étape a-t-elle quelque chose à déplier ? */
function aDuDetail(step: RunStep): boolean {
  return Boolean(step.detail || step.entree);
}

/**
 * La liste d'exécution en direct (PLAN §26). Même affichage quel que soit le
 * moteur : le serveur traduit tout dans un format unique.
 * Quand l'agent a fini, elle se replie en une ligne de bilan.
 */
export function Steps({
  steps,
  streaming,
  projectId,
  agentAuTravail = false,
}: {
  steps: RunStep[];
  streaming: boolean;
  /** Le projet dont vient l'étape : sans lui, aucune capture ne peut être servie. */
  projectId?: string;
  /** L'agent travaille-t-il encore ? Une étape « en cours » sur un message déjà
   *  figé ne compte que si c'est vrai — sinon elle tournerait pour toujours sur
   *  le reliquat d'un tour coupé. */
  agentAuTravail?: boolean;
}) {
  /*
   * Le déroulé reste REPLIÉ : il raconte le détail du travail, pas la réponse.
   * Sa ligne de titre montre la dernière action en date — on sait où on en est
   * sans avoir trente lignes sous les yeux. Un clic déplie tout.
   */
  const [open, setOpen] = React.useState(false);
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());
  /* Une capture s'affiche en vignette ; un clic la met en grand, un second la
     remet en vignette. Celles que le serveur ne sait plus servir (fichier de
     /tmp effacé depuis) se retirent d'elles-mêmes plutôt que de laisser un
     cadre cassé. */
  const [enGrand, setEnGrand] = React.useState<Set<string>>(new Set());
  const [perdues, setPerdues] = React.useState<Set<string>>(new Set());
  const basculer = (setter: React.Dispatch<React.SetStateAction<Set<string>>>, id: string) =>
    setter((current) => {
      const next = new Set(current);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  if (!steps.length) return null;

  const done = steps.filter((s) => s.state === 'done').length;
  const failed = steps.filter((s) => s.state === 'failed').length;
  const skipped = steps.filter((s) => s.state === 'skipped').length;
  const running = steps.find((s) => s.state === 'running');
  const derniere = running ?? [...steps].reverse().find((s) => s.state !== 'skipped') ?? steps[steps.length - 1];

  const bilan = t('{done} étape{v0} terminée{v1}{v2}{v3}', { done, v0: done > 1 ? 's' : '', v1: done > 1 ? 's' : '', v2: failed ? `, ${failed} en échec` : '', v3: skipped ? `, ${skipped} ignorée${skipped > 1 ? 's' : ''}` : '' });

  /*
   * Pendant le travail : la dernière action. À la fin : le bilan.
   *
   * « À la fin » se juge sur les ÉTAPES, pas seulement sur le message. Une
   * réponse peut être figée alors qu'une étape tourne encore : le bilan disait
   * alors « 2 étapes terminées » avec sa coche bleue pendant qu'un tour de
   * moteur tournait — le déroulé démentait ce qui se passait.
   */
  const enCours = streaming || (agentAuTravail && !!running);
  const summary = enCours ? (derniere?.label ?? t('préparation…')) : bilan;

  return (
    <div className="mb-2 overflow-hidden rounded-md border border-border bg-surface/60">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left"
      >
        {enCours ? (
          <Loader2 className="h-3 w-3 shrink-0 animate-spin text-en-cours" />
        ) : failed ? (
          <X className="h-3 w-3 shrink-0 text-danger" />
        ) : (
          <Check className="h-3 w-3 shrink-0 text-termine" />
        )}
        <span className="min-w-0 flex-1 truncate text-[13.5px] text-muted">{summary}</span>
        {/* Le compte des étapes reste visible même repliée. */}
        {enCours && steps.length > 1 ? (
          <span className="shrink-0 text-[12px] tabular-nums text-faint">{done}/{steps.length}</span>
        ) : null}
        <ChevronRight className={cn('h-3 w-3 shrink-0 text-faint transition-transform', open && 'rotate-90')} />
      </button>

      {open ? (
        <ul className="space-y-0.5 border-t border-border px-2 py-1.5">
          {steps.map((step) => {
            const isOpen = expanded.has(step.id);
            return (
              <li key={step.id}>
                <button
                  type="button"
                  disabled={!aDuDetail(step)}
                  onClick={() =>
                    setExpanded((current) => {
                      const next = new Set(current);
                      next.has(step.id) ? next.delete(step.id) : next.add(step.id);
                      return next;
                    })
                  }
                  className={cn(
                    'flex w-full items-start gap-2 rounded px-1 py-1 text-left',
                    aDuDetail(step) && 'hover:bg-raised',
                  )}
                >
                  <span className="mt-[3px] shrink-0">
                    {step.state === 'running' ? (
                      <Loader2 className="h-3 w-3 animate-spin text-en-cours" />
                    ) : step.state === 'done' ? (
                      <Check className="h-3 w-3 text-termine" />
                    ) : step.state === 'failed' ? (
                      <X className="h-3 w-3 text-danger" />
                    ) : step.state === 'skipped' ? (
                      <MinusCircle className="h-3 w-3 text-faint" />
                    ) : (
                      <Circle className="h-3 w-3 text-faint" />
                    )}
                  </span>
                  <span
                    className={cn(
                      'flex-1 text-[13.5px] leading-snug',
                      step.state === 'done' ? 'text-muted' : step.state === 'failed' ? 'text-danger' : 'text-text',
                    )}
                  >
                    {step.label}
                  </span>
                  {/* Un point qui porte une image le dit d'un coup d'œil, même
                      quand la vignette n'a pas encore fini de charger. */}
                  {step.capture ? <Camera className="mt-0.5 h-3 w-3 shrink-0 text-faint" /> : null}
                  {step.startedAt && step.endedAt ? (
                    <span className="mt-0.5 shrink-0 text-[12px] text-faint">
                      {duration((step.endedAt - step.startedAt) / 1000)}
                    </span>
                  ) : null}
                </button>
                {/* CE QUE LE SYSTÈME A VU, SOUS SON POINT. Une capture prise
                    pendant un essai s'affiche en vignette à même le déroulé :
                    on ne lit plus le nom d'un fichier, on regarde l'écran que
                    l'agent avait sous les yeux. Un clic la met en grand. */}
                {step.capture && projectId && !perdues.has(step.id) ? (
                  <button
                    type="button"
                    data-capture-etape={step.id}
                    onClick={() => basculer(setEnGrand, step.id)}
                    className="mx-1 mb-1 block overflow-hidden rounded border border-border bg-raised p-1"
                    title={enGrand.has(step.id) ? t('Réduire la capture') : t('Voir la capture en grand')}
                  >
                    <img
                      src={`/api/capture?project=${encodeURIComponent(projectId)}&path=${encodeURIComponent(step.capture)}`}
                      alt={step.label}
                      onError={() => setPerdues((current) => new Set(current).add(step.id))}
                      className={cn(
                        'rounded object-contain object-left-top',
                        enGrand.has(step.id) ? 'max-h-[60dvh] w-full' : 'max-h-32',
                      )}
                    />
                  </button>
                ) : null}
                {/* CE QUE L'ÉTAPE A FAIT, DANS SON ENCADRÉ — plus un pavé.
                    Le détail s'affichait tel quel dans un `<pre>` : pour un
                    outil du démon, c'était ses paramètres en JSON, tronqués en
                    pleine chaîne. L'étape porte maintenant le nom d'appel et
                    ses paramètres (`RunStep.outil`, `RunStep.entree`), relus
                    par la MÊME règle pure que le parcours d'une carte — le
                    déroulé en direct et l'historique montrent donc le même
                    encadré, jamais deux dessins qui dérivent. */}
                {isOpen && aDuDetail(step) ? (
                  <div className="mx-1 mb-1" data-etape-detail={step.id}>
                    <ContenuDeLEntree entree={entreeDeLEtape(step)} projectId={projectId} />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
