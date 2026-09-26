import * as React from 'react';
import {
  Activity,
  Loader2,
  Play,
  Power,
  ShieldCheck,
} from 'lucide-react';
import {
  SystemProcess,
  detailDesAgents,
  etatDeLEchange,
  partMemoire,
  phraseDeLEchange,
  phraseCapacite,
  tauxOccupation,
  tonCapacite,
} from '@beluga/shared';
import {
  BulleInfo,
  Button,
  ConfirmDialog,
  Gauge,
  Tooltip,
} from '@/components/ui';
import { client } from '@/lib/client';
import { useApp } from '@/lib/use-app';
import { cn, elapsed } from '@/lib/utils';
import { t } from '@/lib/langue';
import { Mesure, Sparkline, gigas } from '@/components/reglages/communs';


export function SectionSysteme() {
  /* LA PAGE DEMANDE ELLE-MÊME CE QU'ELLE MONTRE. Ces deux relevés partaient de
     l'enveloppe des réglages, du temps où tout vivait dans un seul fichier :
     ils étaient donc demandés même pour ouvrir la page des thèmes. Une page
     qu'on n'ouvre pas ne doit rien demander. */
  const [history, setHistory] = React.useState<{ at: number; loadPct: number }[]>([]);
  React.useEffect(() => {
    client.send({ type: 'capacity.processes' });
    client
      .call<{ history: { at: number; loadPct: number }[] }>({ type: 'capacity.history' })
      .then((data) => setHistory(data.history ?? []));
    const minuteur = setInterval(() => client.send({ type: 'capacity.processes' }), 5000);
    return () => clearInterval(minuteur);
  }, []);

  const state = useApp();
  const capacity = state.capacity;
  const [busy, setBusy] = React.useState<string | null>(null);
  const [aConfirmer, setAConfirmer] = React.useState<SystemProcess | null>(null);

  const appliquer = async (cible: SystemProcess) => {
    setBusy(cible.id);
    try {
      const result = await client.call<{ ok: boolean; error?: string }>({
        type: cible.running ? 'process.stop' : 'process.start',
        id: cible.id,
      });
      if (!result.ok) client.pushToast('error', result.error ?? t('opération refusée'));
      else client.send({ type: 'capacity.processes' });
    } finally {
      setBusy(null);
    }
  };

  /*
   * La barre ne montre QUE la place restante. Elle suivait la charge
   * processeur, plafonnée à cent : sur ce serveur elle était donc rouge et
   * pleine en permanence, pendant qu'il restait quatorze places libres.
   */
  const occupation = capacity ? tauxOccupation(capacity) : 0;
  const ton = capacity ? tonCapacite(capacity) : 'libre';
  const memoire = capacity ? partMemoire(capacity.memUsedMb, capacity.memTotalMb) : 0;

  return (
    <>
      <section>
        <h3 className="mb-2 flex items-center gap-1.5 text-[13.5px] font-medium text-text">
          <Activity className="h-3.5 w-3.5 text-faint" />  {t('Capacité du système')}
  <BulleInfo cote="start">{t('La barre montre les places d\'agents occupées, rien d\'autre : elle ne devient rouge que lorsqu\'aucun agent ne peut plus démarrer, faute de mémoire ou de place sous le plafond.')}</BulleInfo>
</h3>

        {capacity ? (
          <>
            <Gauge value={occupation} height="h-2" />
            <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span className="text-[17px] font-semibold text-text">{phraseCapacite(capacity)}</span>
              <span className="text-[12.5px] text-faint">
                {t('{v0} · plafond {v1} · mémoire moyenne mesurée{v2} {v3} Mo', { v0: detailDesAgents(capacity), v1: capacity.maxAgents, v2: ' ', v3: capacity.avgAgentMemMb })}</span>
            </div>

            {/* Le manque de place et le frein processeur sont DEUX choses : on
                ne dit plus « plus aucun agent ne peut démarrer » pour une
                pointe de charge d'une minute. */}
            {ton === 'tendu' && !capacity.loadHoldReason ? (
              <p className="mt-1.5 rounded-md border border-warning/30 bg-warning/5 px-2 py-1 text-[13px] text-warning">
                {t('Il ne reste presque plus de place : les prochaines tâches attendront leur tour.')}</p>
            ) : null}
            {capacity.loadHoldReason ? (
              <p className="mt-1.5 rounded-md border border-warning/30 bg-warning/5 px-2 py-1 text-[13px] text-warning">
                {capacity.loadHoldReason}
              </p>
            ) : null}
            {capacity.paused ? (
              <p className="mt-1.5 rounded-md border border-warning/30 bg-warning/5 px-2 py-1 text-[13px] text-warning">
                {capacity.pauseReason}
              </p>
            ) : null}

            {/* Mémoire et processeur restent lisibles, mais comme des mesures,
                pas comme un remplissage : c'est la mémoire qui décide de la
                place, la charge ne fait que freiner au-delà d'une vraie file. */}
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Mesure
                titre={t('Mémoire utilisée')}
                valeur={`${memoire} %`}
                detail={`${gigas(capacity.memUsedMb)} sur ${gigas(capacity.memTotalMb)}`}
              />
              {capacity.swapPct === undefined ? null : (
                <Mesure
                  titre={t('Réserve d\'échange')}
                  valeur={`${capacity.swapPct} %`}
                  detail={
                    capacity.swapTotalMb
                      ? `${gigas(capacity.swapUsedMb ?? 0)} sur ${gigas(capacity.swapTotalMb)} — ${phraseDeLEchange(
                          etatDeLEchange(capacity.swapPct, capacity.swapDebitKoS),
                        )}`
                      : phraseDeLEchange(etatDeLEchange(capacity.swapPct, capacity.swapDebitKoS))
                  }
                />
              )}
              {/* LE PLAFOND DE TÂCHES, jusqu'ici invisible. C'est lui qui a
                  refusé le « fork » d'une publication pendant que la mémoire
                  était large : il se lit maintenant à côté d'elle. */}
              {capacity.tasksPct === undefined ? null : (
                <Mesure
                  titre={t('Plafond de tâches')}
                  valeur={`${capacity.tasksPct} %`}
                  detail={
                    capacity.tasksRefus
                      ? t('{v0} sur {v1} — {v2} lancement(s) déjà refusés par ce plafond', {
                          v0: capacity.tasksCurrent ?? 0,
                          v1: capacity.tasksMax ?? 0,
                          v2: capacity.tasksRefus,
                        })
                      : t('{v0} sur {v1} — tout ce que le serveur lance y compte', {
                          v0: capacity.tasksCurrent ?? 0,
                          v1: capacity.tasksMax ?? 0,
                        })
                  }
                />
              )}
              <Mesure
                titre={t('Charge processeur')}
                valeur={`${Math.round(capacity.cpuLoadPct ?? capacity.loadPct)} %`}
                detail={
                  capacity.cpuLoadSustainedPct === undefined
                    ? t('{v0} cœurs', { v0: capacity.cpuCount })
                    : t('{v0} cœurs — {v1} % sur un quart d\'heure, et c\'est ce chiffre-là qui freine les départs', { v0: capacity.cpuCount, v1: Math.round(
                        capacity.cpuLoadSustainedPct,
                      ) })
                }
              />
            </div>

            {history.length > 3 ? <Sparkline points={history} /> : null}
          </>
        ) : null}
      </section>

      <section className="mt-4">
        <p className="mb-1 text-[12px] uppercase tracking-wide text-faint">{t('Ce qui tourne en ce moment')}</p>
        <div className="space-y-0.5">
          {state.processes.map((process) => (
            <div
              key={process.id}
              className="flex items-center gap-1.5 rounded-md border border-border bg-bloc px-2 py-1.5"
            >
              <span
                className={cn(
                  'h-1.5 w-1.5 shrink-0 rounded-full',
                  // Un agent qui tourne suit la convention : ORANGE.
                  process.running ? (process.kind === 'agent' ? 'bg-en-cours' : 'bg-muted') : 'bg-faint',
                )}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13.5px] text-text">{process.label}</p>
                <p className="truncate text-[11.5px] text-faint">
                  {process.detail}
                  {process.since ? ` · ${elapsed(process.since)}` : ''}
                </p>
              </div>
              <span className="shrink-0 text-[12.5px] text-muted">{t('{v0} Mo', { v0: process.memMb })}</span>
              {process.canStop ? (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => setAConfirmer(process)}
                  disabled={busy === process.id}
                >
                  {busy === process.id ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : process.running ? (
                    <Power className="h-3 w-3" />
                  ) : (
                    <Play className="h-3 w-3" />
                  )}
                </Button>
              ) : (
                <Tooltip label={t('Beluga Build ne peut pas s\'éteindre depuis sa propre interface')}>
                  <span className="px-1.5 text-faint">
                    <ShieldCheck className="h-3 w-3" />
                  </span>
                </Tooltip>
              )}
            </div>
          ))}
        </div>
      </section>

      <ConfirmDialog
        open={!!aConfirmer}
        title={aConfirmer?.running ? t('Arrêter « {v0} » ?', { v0: aConfirmer.label }) : t('Démarrer « {v0} » ?', { v0: aConfirmer?.label })}
        description={
          aConfirmer?.running
            ? t('Le service s’arrête tout de suite. Ce qu’il servait devient injoignable jusqu’au redémarrage.')
            : t('Le service redémarre avec sa commande habituelle.')
        }
        confirmLabel={aConfirmer?.running ? t('Arrêter') : t('Démarrer')}
        danger={aConfirmer?.running}
        onConfirm={async () => {
          if (aConfirmer) await appliquer(aConfirmer);
        }}
        onClose={() => setAConfirmer(null)}
      />
    </>
  );
}
