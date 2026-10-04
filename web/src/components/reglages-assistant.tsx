import * as React from 'react';
import { ChevronDown, ChevronRight, SlidersHorizontal } from 'lucide-react';
import {
  DEFINITIONS_NIVEAU,
  NIVEAUX_AGENT,
  REGLAGE_NIVEAU_ASSISTANT_DEFAUT,
  type Agent,
  type NiveauAgent,
  type ReglageNiveauAssistant,
} from '@beluga/shared';
import { LigneDeConfiguration } from '@/components/chat';
import { RunSelectors, resoudreRun, type RunChoix } from '@/components/run-selectors';
import { client } from '@/lib/client';
import { useApp } from '@/lib/use-app';
import { cn } from '@/lib/utils';
import { t } from '@/lib/langue';

/**
 * LES RÉGLAGES DE L'ASSISTANT, tout en haut de sa fenêtre (demande du
 * 02.10.2026) : replié sur UNE ligne de résumé — mode, niveau servi, modèle —
 * pour ne pas manger la hauteur du chat, téléphone compris ; déplié, le mode
 * (automatique ou modèle fixe), le plafond, puis moteur, modèle, réflexion et
 * compte, comme la carte de configuration d'une tâche.
 *
 * Choisir un moteur, un modèle ou une réflexion à la main FIGE le modèle (le
 * démon bascule le mode, `agent.config`) ; « Revenir en automatique » rend la
 * main au tri. Le tri et le plafond sont tenus par le démon, pas par cet écran.
 */
export function ReglagesAssistant({ agent, niveau: niveauInitial }: { agent: Agent; niveau?: ReglageNiveauAssistant }) {
  const state = useApp();
  const [ouvert, setOuvert] = React.useState(false);
  const [niveau, setNiveau] = React.useState<ReglageNiveauAssistant>(niveauInitial ?? REGLAGE_NIVEAU_ASSISTANT_DEFAUT);
  const [ouvrirSur, setOuvrirSur] = React.useState<'moteur' | 'modele' | 'reflexion' | 'compte' | undefined>(undefined);
  React.useEffect(() => {
    if (niveauInitial) setNiveau(niveauInitial);
  }, [niveauInitial]);

  const retenu = resoudreRun(state.engines, agent.run);
  const comptes = (state.quotas ?? []).filter((c) => c.engine === retenu.engine?.id && !c.disabled);
  const compte = agent.run.account ? comptes.find((c) => c.id === agent.run.account) : undefined;
  const fige = niveau.mode === 'fige';

  const regler = (patch: { mode?: 'auto' | 'fige'; plafond?: NiveauAgent }) => {
    const avant = niveau;
    setNiveau({ ...niveau, ...patch });
    void client
      .call<{ niveau: ReglageNiveauAssistant }>({ type: 'assistant.niveau', ...patch })
      .then((r) => setNiveau(r.niveau))
      .catch((err: any) => {
        setNiveau(avant);
        client.pushToast('error', err?.message ?? t('Réglage refusé'));
      });
  };

  /* Un seul champ part à la fois : le démon tranche la cascade (changer de
     moteur redonne le modèle par défaut de ce moteur). */
  const choisir = async (patch: RunChoix) => {
    const run: RunChoix = patch.engine
      ? { engine: patch.engine }
      : { model: patch.model, thinking: patch.thinking, account: patch.account };
    try {
      await client.call({ type: 'agent.config', agentId: agent.id, run });
      if (!(run.account !== undefined && !run.model && !run.thinking)) setNiveau((n) => ({ ...n, mode: 'fige' }));
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('réglage impossible'));
    }
  };

  const servi = agent.niveauServi ? t(DEFINITIONS_NIVEAU[agent.niveauServi].label) : null;
  const resume = [
    fige ? t('Modèle fixe') : t('Automatique'),
    !fige ? (servi ?? t(DEFINITIONS_NIVEAU[niveau.plafond].label)) : null,
    retenu.model?.label ?? agent.run.model ?? null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="shrink-0 bg-surface px-3 pb-1.5 pt-1" data-assistant-reglages={ouvert ? 'ouvert' : 'replie'}>
      <button
        type="button"
        onClick={() => setOuvert((o) => !o)}
        aria-expanded={ouvert}
        data-assistant-reglages-resume={resume}
        className="flex w-full items-center gap-2 rounded-md px-1 py-1 text-left text-[12.5px] text-muted transition-colors hover:text-text"
      >
        <SlidersHorizontal className="h-3 w-3 shrink-0" />
        <span className="min-w-0 flex-1 truncate">{resume}</span>
        <ChevronDown className={cn('h-3 w-3 shrink-0 transition-transform', ouvert && 'rotate-180')} />
      </button>

      {ouvert ? (
        <div className="mt-1 flex max-h-[40vh] flex-col gap-1.5 overflow-y-auto pb-1" data-carte-configuration>
          <div className="flex flex-col gap-1">
            <span className="text-[12.5px] text-faint">{t('Mode')}</span>
            <Choix
              nom="mode"
              valeur={niveau.mode}
              options={[
                { id: 'auto', label: t('Automatique') },
                { id: 'fige', label: t('Modèle fixe') },
              ]}
              onChoisir={(id) => regler({ mode: id as 'auto' | 'fige' })}
            />
            <p className="text-[12px] leading-snug text-faint">
              {fige
                ? t('Le modèle choisi ne change plus tout seul.')
                : t('Un modèle est choisi à chaque message, jamais au-dessus du plafond.')}
            </p>
          </div>

          {!fige ? (
            <div className="flex flex-col gap-1">
              <span className="text-[12.5px] text-faint">{t('Plafond')}</span>
              <Choix
                nom="plafond"
                valeur={niveau.plafond}
                options={NIVEAUX_AGENT.map((id) => ({ id, label: t(DEFINITIONS_NIVEAU[id].label) }))}
                onChoisir={(id) => regler({ plafond: id as NiveauAgent })}
              />
            </div>
          ) : (
            <button
              type="button"
              onClick={() => regler({ mode: 'auto' })}
              data-assistant-revenir-auto
              className="self-start rounded-md border border-border bg-surface px-2.5 py-1 text-[12.5px] text-text transition-colors hover:border-accent/50"
            >
              {t('Revenir en automatique')}
            </button>
          )}

          <LigneDeConfiguration nom={t('Moteur')} valeur={retenu.engine?.label ?? '—'} onClick={() => setOuvrirSur('moteur')} />
          <LigneDeConfiguration nom={t('Modèle')} valeur={retenu.model?.label ?? '—'} onClick={() => setOuvrirSur('modele')} />
          <LigneDeConfiguration nom={t('Réflexion')} valeur={retenu.thinking?.label ?? '—'} onClick={() => setOuvrirSur('reflexion')} />
          {comptes.length > 1 ? (
            <LigneDeConfiguration nom={t('Compte')} valeur={compte?.label ?? t('Automatique')} onClick={() => setOuvrirSur('compte')} />
          ) : null}

          <RunSelectors
            engines={state.engines}
            choix={agent.run}
            onSelect={choisir}
            pleineLargeur
            comptes={state.quotas}
            masquerDeclencheur
            ouvertControle={ouvrirSur !== undefined}
            onOuvertControleChange={(o) => setOuvrirSur(o ? (ouvrirSur ?? 'moteur') : undefined)}
            ouvrirSur={ouvrirSur}
          />
        </div>
      ) : null}
    </div>
  );
}

/** Un choix à boutons côte à côte : une ligne, même sur téléphone. */
function Choix({
  nom,
  valeur,
  options,
  onChoisir,
}: {
  nom: string;
  valeur: string;
  options: { id: string; label: string }[];
  onChoisir: (id: string) => void;
}) {
  return (
    <div className="flex gap-1" role="radiogroup" data-assistant-choix={nom}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={o.id === valeur}
          data-choix={o.id}
          onClick={() => o.id !== valeur && onChoisir(o.id)}
          className={cn(
            'min-w-0 flex-1 truncate rounded-md border px-2 py-1 text-[13px] transition-colors',
            o.id === valeur ? 'border-accent bg-raised font-medium text-text' : 'border-border bg-surface text-muted hover:border-accent/50',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
