/*
 * UN MESSAGE STRUCTURÉ D'UN CHEF DE COMMUNICATION, EN BLOC LISIBLE (carte « Chefs invisibles et fausse carte »,
 * 24/11/2026). Les chefs écrivent leurs points en blocs « directeur » (étiquette, titre, texte, chiffres, réponses
 * proposées) : l'écran qui les rendait a disparu avec l'ancien Communication le 11/11/2026, et leur conversation se lit
 * désormais dans l'onglet « Agents » du projet. Sans ce rendu, on y lirait du JSON brut.
 *
 * Version resserrée de l'ancien `bloc-du-directeur.tsx` : une réponse proposée « dire » s'envoie au chef comme si on
 * l'écrivait ; un geste de l'utilisateur (« contenu.valider »…) part à son clic, avec ses droits ; un lien « ouvrir »
 * de l'ancien espace n'a plus d'écran et ne se montre pas.
 */
import * as React from 'react';
import { LANGAGE_BLOC_DIRECTEUR, lireBlocDuDirecteur, type ActionDuBloc } from '@beluga/shared';
import { ChevronRight, Loader2 } from '@/components/ui/icones';
import { client } from '@/lib/client';
import { t } from '@/lib/langue';
import { Markdown } from '@/lib/markdown';
import { cn } from '@/lib/utils';

function BlocDuChef({ json, agentId }: { json: string; agentId: string }) {
  const bloc = React.useMemo(() => lireBlocDuDirecteur(json), [json]);
  /* Il s'écrit encore : jamais de JSON à l'écran. */
  if (!bloc) return <div className="h-16 animate-pulse rounded-xl bg-raised motion-reduce:animate-none" data-bloc-du-chef-attente="" />;
  const actions = bloc.actions.filter((a) => a.dire || a.geste);
  return (
    <div className="overflow-hidden rounded-xl bg-raised/70" data-bloc-du-chef="">
      <div className="px-3 py-2.5">
        {bloc.etiquette ? <div className="text-[10.5px] font-semibold tracking-wide text-muted">{bloc.etiquette}</div> : null}
        <div className="text-[14px] font-semibold leading-snug text-text">{bloc.titre}</div>
        {bloc.texte ? (
          <div className="mt-1 min-w-0 text-[13px] leading-relaxed text-text/90 [&_li]:!text-[13px] [&_p]:!text-[13px]">
            <Markdown className="texte-du-fil" content={bloc.texte} />
          </div>
        ) : null}
        {bloc.chiffres.length ? (
          <div className="mt-2 max-w-full overflow-x-auto rounded-lg bg-surface px-2.5 py-1" data-bloc-du-chef-chiffres={bloc.chiffres.length}>
            <table className="w-full border-collapse text-[12.5px]">
              <tbody>
                {bloc.chiffres.map((c) => (
                  <tr key={c.libelle + c.valeur}>
                    <td className="py-1 pr-3 align-top text-muted">{c.libelle}</td>
                    <td className="whitespace-nowrap py-1 text-right align-top font-semibold tabular-nums text-text">{c.valeur}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {actions.length ? (
          <div className="mt-2.5 flex min-w-0 flex-col gap-1" role="group" data-bloc-du-chef-actions={actions.length}>
            {[...actions]
              .sort((a, b) => Number(!!b.principal) - Number(!!a.principal))
              .map((a) => (
                <ActionDuBloc key={a.libelle} action={a} agentId={agentId} />
              ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ActionDuBloc({ action, agentId }: { action: ActionDuBloc; agentId: string }) {
  const [enCours, setEnCours] = React.useState(false);
  const [fait, setFait] = React.useState(false);
  const cliquer = async () => {
    if (enCours || fait) return;
    setEnCours(true);
    try {
      if (action.dire) await client.call({ type: 'agent.prompt', agentId, text: action.dire });
      else if (action.geste) {
        await client.call({ type: 'communication.geste', geste: action.geste, ...(action.id ? { id: action.id } : {}) } as never);
        client.pushToast('success', t('C’est fait.'));
      }
      setFait(true);
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('Geste refusé'));
    } finally {
      setEnCours(false);
    }
  };
  return (
    <button
      type="button"
      disabled={enCours || fait}
      aria-busy={enCours || undefined}
      onClick={() => void cliquer()}
      data-bloc-du-chef-action={action.geste ?? 'dire'}
      data-en-route={enCours ? '' : undefined}
      className={cn(
        'flex w-full min-w-0 items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] leading-snug transition-colors disabled:opacity-60',
        action.principal ? 'bg-accent font-medium text-accent-fg hover:opacity-90' : 'bg-surface text-text hover:bg-fond-survol',
      )}
    >
      <span className="min-w-0 flex-1">{action.libelle}</span>
      {enCours ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" /> : <ChevronRight className={cn('h-3.5 w-3.5 shrink-0', action.principal ? 'text-accent-fg/70' : 'text-faint')} />}
    </button>
  );
}

/** Le rendu des blocs « directeur » d'UN chef, à poser dans `ContexteBlocsDeCode`. */
export function rendreLesBlocsDuChef(agentId: string): (langage: string, texte: string) => React.ReactNode {
  return (langage, texte) => (langage === LANGAGE_BLOC_DIRECTEUR ? <BlocDuChef json={texte} agentId={agentId} /> : null);
}
