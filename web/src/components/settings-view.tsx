import * as React from 'react';
import { Activity, Database, Loader2, Play, Power, RefreshCw, Save, ShieldCheck } from 'lucide-react';
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  Gauge,
  Input,
  Label,
  Switch,
  Tooltip,
} from '@/components/ui';
import { client } from '@/lib/client';
import { useApp } from '@/lib/use-app';
import { bytes, cn, elapsed } from '@/lib/utils';

/** Page Réglages, avec « Capacité du système » en tête (PLAN §27). */
export function SettingsView({ open, onClose }: { open: boolean; onClose: () => void }) {
  const state = useApp();
  const [history, setHistory] = React.useState<{ at: number; loadPct: number; running: number }[]>([]);
  const [backups, setBackups] = React.useState<{ name: string; size: number; at: number }[]>([]);
  const [busy, setBusy] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    client.send({ type: 'capacity.processes' });
    client.call<{ history: typeof history }>({ type: 'capacity.history' }).then((data) => setHistory(data.history ?? []));
    client.call<{ backups: typeof backups }>({ type: 'backup.list' }).then((data) => setBackups(data.backups ?? []));
    const timer = setInterval(() => client.send({ type: 'capacity.processes' }), 5000);
    return () => clearInterval(timer);
  }, [open]);

  const capacity = state.capacity;
  const settings = state.settings;

  const update = (patch: Record<string, unknown>) => client.send({ type: 'settings.update', patch });

  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent className="w-[min(720px,calc(100vw-16px))]">
        <DialogTitle>Réglages</DialogTitle>

        {/* ---------- Capacité du système ---------- */}
        <section className="mt-4">
          <h3 className="mb-2 flex items-center gap-1.5 text-[13.5px] font-medium text-text">
            <Activity className="h-3.5 w-3.5 text-faint" /> Capacité du système
          </h3>

          {capacity ? (
            <>
              <Gauge value={capacity.loadPct} height="h-2" />
              <div className="mt-1.5 flex items-baseline gap-2">
                <span className="text-[17px] font-semibold text-text">
                  {capacity.slotsFree} agent{capacity.slotsFree > 1 ? 's' : ''} peuvent encore démarrer
                </span>
                <span className="text-[12.5px] text-faint">
                  {capacity.runningAgents} en cours · plafond {capacity.maxAgents} · mémoire moyenne mesurée{' '}
                  {capacity.avgAgentMemMb} Mo
                </span>
              </div>
              {capacity.paused ? (
                <p className="mt-1 rounded-md border border-warning/30 bg-warning/5 px-2 py-1 text-[13px] text-warning">
                  {capacity.pauseReason}
                </p>
              ) : null}

              {history.length > 3 ? <Sparkline points={history} /> : null}
            </>
          ) : null}

          <div className="mt-3">
            <p className="mb-1 text-[12px] uppercase tracking-wide text-faint">Ce qui tourne en ce moment</p>
            <div className="max-h-52 space-y-0.5 overflow-y-auto">
              {state.processes.map((process) => (
                <div
                  key={process.id}
                  className="flex items-center gap-1.5 rounded-md border border-border bg-surface px-2 py-1.5"
                >
                  <span
                    className={cn(
                      'h-1.5 w-1.5 shrink-0 rounded-full',
                      process.running ? (process.kind === 'agent' ? 'bg-success' : 'bg-muted') : 'bg-faint',
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13.5px] text-text">{process.label}</p>
                    <p className="truncate text-[11.5px] text-faint">
                      {process.detail}
                      {process.since ? ` · ${elapsed(process.since)}` : ''}
                    </p>
                  </div>
                  <span className="shrink-0 text-[12.5px] text-muted">{process.memMb} Mo</span>
                  {process.canStop ? (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={async () => {
                        if (!confirm(`Confirmer : ${process.running ? 'éteindre' : 'rallumer'} « ${process.label} » ?`))
                          return;
                        setBusy(process.id);
                        try {
                          const result = await client.call<{ ok: boolean; error?: string }>({
                            type: process.running ? 'process.stop' : 'process.start',
                            id: process.id,
                          });
                          if (!result.ok) client.pushToast('error', result.error ?? 'opération refusée');
                          else client.send({ type: 'capacity.processes' });
                        } finally {
                          setBusy(null);
                        }
                      }}
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
                    <Tooltip label="HaikoDev ne peut pas s'éteindre depuis sa propre interface">
                      <span className="px-1.5 text-faint">
                        <ShieldCheck className="h-3 w-3" />
                      </span>
                    </Tooltip>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ---------- Réglages ---------- */}
        {settings ? (
          <section className="mt-5 space-y-3">
            <h3 className="text-[13.5px] font-medium text-text">Fonctionnement</h3>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Field label="Plafond d'agents">
                <Input
                  type="number"
                  min={1}
                  max={40}
                  defaultValue={settings.maxAgents}
                  onBlur={(event) => update({ maxAgents: Number(event.target.value) })}
                />
              </Field>
              <Field label="Heures creuses (début)">
                <Input
                  type="number"
                  min={0}
                  max={23}
                  defaultValue={settings.offPeakStart}
                  onBlur={(event) => update({ offPeakStart: Number(event.target.value) })}
                />
              </Field>
              <Field label="Heures creuses (fin)">
                <Input
                  type="number"
                  min={0}
                  max={23}
                  defaultValue={settings.offPeakEnd}
                  onBlur={(event) => update({ offPeakEnd: Number(event.target.value) })}
                />
              </Field>
              <Field label="Tâche lourde (minutes)">
                <Input
                  type="number"
                  min={1}
                  defaultValue={Math.round(settings.heavyTaskSeconds / 60)}
                  onBlur={(event) => update({ heavyTaskSeconds: Number(event.target.value) * 60 })}
                />
              </Field>
              <Field label="Alerte au-delà de (%)">
                <Input
                  type="number"
                  min={50}
                  max={100}
                  defaultValue={settings.alertThresholdPct}
                  onBlur={(event) => update({ alertThresholdPct: Number(event.target.value) })}
                />
              </Field>
              <Field label="Pendant (minutes)">
                <Input
                  type="number"
                  min={1}
                  defaultValue={settings.alertMinutes}
                  onBlur={(event) => update({ alertMinutes: Number(event.target.value) })}
                />
              </Field>
              <Field label="Silence — début (h)">
                <Input
                  type="number"
                  min={0}
                  max={23}
                  defaultValue={settings.quietHoursStart ?? ''}
                  onBlur={(event) =>
                    update({ quietHoursStart: event.target.value === '' ? undefined : Number(event.target.value) })
                  }
                />
              </Field>
              <Field label="Silence — fin (h)">
                <Input
                  type="number"
                  min={0}
                  max={23}
                  defaultValue={settings.quietHoursEnd ?? ''}
                  onBlur={(event) =>
                    update({ quietHoursEnd: event.target.value === '' ? undefined : Number(event.target.value) })
                  }
                />
              </Field>
              <Field label="Sauvegarde (heure)">
                <Input
                  type="number"
                  min={0}
                  max={23}
                  defaultValue={settings.backupHour}
                  onBlur={(event) => update({ backupHour: Number(event.target.value) })}
                />
              </Field>
            </div>

            <div className="space-y-1.5">
              {(
                [
                  ['notifyOnDone', 'Prévenir quand une tâche se termine'],
                  ['notifyOnFailed', 'Prévenir en cas d\'échec'],
                  ['notifyOnProposal', 'Prévenir pour une tâche proposée'],
                  ['notifyOnDeploy', 'Prévenir quand une publication est finie'],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="flex items-center gap-2 text-[14px] text-muted">
                  <Switch
                    checked={settings[key] as boolean}
                    onCheckedChange={(checked) => update({ [key]: checked })}
                  />
                  {label}
                </label>
              ))}
            </div>
          </section>
        ) : null}

        {/* ---------- Comptes ---------- */}
        <section className="mt-5">
          <h3 className="mb-2 text-[13.5px] font-medium text-text">Comptes et quotas</h3>
          <div className="space-y-1">
            {state.quotas.map((quota) => (
              <div key={quota.id} className="flex items-center gap-2 rounded-md border border-border bg-surface px-2 py-1.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13.5px] text-text">
                    {quota.label} {quota.plan ? <span className="text-faint">· {quota.plan}</span> : null}
                  </p>
                  <p className="text-[11.5px] text-faint">
                    fenêtre {Math.round(quota.session?.usedPct ?? 0)} % · semaine {Math.round(quota.weekly?.usedPct ?? 0)} %
                    {quota.weekly?.resetsAt
                      ? ` · remise à zéro ${new Date(quota.weekly.resetsAt).toLocaleDateString('fr-CH')}`
                      : ''}
                  </p>
                </div>
                {quota.active ? <Badge tone="success">actif</Badge> : null}
                {!quota.available ? <Badge tone="danger">épuisé</Badge> : null}
              </div>
            ))}
          </div>
          <p className="mt-1.5 text-[12.5px] text-faint">
            L'ordre de priorité suit la valeur déclarée pour chaque compte : le compte prioritaire passe toujours en
            premier, la relève ne sert qu'en cas d'épuisement.
          </p>
        </section>

        {/* ---------- Suivi : consommation et facturation ---------- */}
        <UsageSection open={open} />

        {/* ---------- Sauvegardes ---------- */}
        <section className="mt-5">
          <h3 className="mb-2 flex items-center gap-1.5 text-[13.5px] font-medium text-text">
            <Database className="h-3.5 w-3.5 text-faint" /> Sauvegardes
          </h3>
          <Button
            variant="outline"
            size="sm"
            disabled={busy === 'backup'}
            onClick={async () => {
              setBusy('backup');
              try {
                const result = await client.call<{ ok: boolean; verification?: { ok: boolean; detail: string } }>({
                  type: 'backup.now',
                });
                if (result.verification) {
                  client.pushToast(result.verification.ok ? 'success' : 'error', result.verification.detail);
                }
                const data = await client.call<{ backups: typeof backups }>({ type: 'backup.list' });
                setBackups(data.backups ?? []);
              } finally {
                setBusy(null);
              }
            }}
          >
            {busy === 'backup' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
            Sauvegarder maintenant (et vérifier la restauration)
          </Button>

          <div className="mt-2 max-h-32 space-y-0.5 overflow-y-auto">
            {backups.map((backup) => (
              <div key={backup.name} className="flex items-center gap-2 text-[12.5px] text-faint">
                <span className="min-w-0 flex-1 truncate">{backup.name}</span>
                <span>{bytes(backup.size)}</span>
              </div>
            ))}
            {!backups.length ? <p className="text-[12.5px] text-faint">Aucune sauvegarde pour l'instant.</p> : null}
          </div>
        </section>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Cumuls de consommation (PLAN §24) et synthèse de facturation (PLAN §7).
 * Ces chiffres éclairent ; ils ne modifient jamais tout seuls une facture.
 */
function UsageSection({ open }: { open: boolean }) {
  const state = useApp();
  const [usage, setUsage] = React.useState<{
    byProject: { projectId: string; tokens: number; seconds: number; tasks: number }[];
    byMonth: { month: string; tokens: number; seconds: number }[];
  } | null>(null);
  const [summary, setSummary] = React.useState<any>(null);

  React.useEffect(() => {
    if (!open) return;
    client.call({ type: 'stats.usage' }).then(setUsage).catch(() => setUsage(null));
    client
      .call({ type: 'billing.summary' }, 120000)
      .then((data) => setSummary(data?.summary))
      .catch(() => setSummary(null));
  }, [open]);

  const projectName = (id: string) => state.projects.find((p) => p.id === id)?.name ?? 'projet retiré';

  return (
    <section className="mt-5">
      <h3 className="mb-2 flex items-center gap-1.5 text-[13.5px] font-medium text-text">
        <Activity className="h-3.5 w-3.5 text-faint" /> Ce qui a été consommé
      </h3>

      {usage?.byProject?.length ? (
        <div className="space-y-0.5">
          {usage.byProject.map((row) => (
            <div key={row.projectId} className="flex items-center gap-2 rounded-md border border-border bg-surface px-2 py-1.5">
              <span className="min-w-0 flex-1 truncate text-[13.5px] text-text">{projectName(row.projectId)}</span>
              <span className="text-[12.5px] text-faint">{row.tasks} tâche(s)</span>
              <span className="text-[12.5px] text-muted">{Math.round(row.seconds / 60)} min</span>
              <span className="text-[12.5px] text-muted">{(row.tokens ?? 0).toLocaleString('fr-CH')} jetons</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-[13px] text-faint">Aucune consommation relevée pour l'instant.</p>
      )}

      {usage?.byMonth?.length ? (
        <div className="mt-2">
          <p className="mb-1 text-[12px] uppercase tracking-wide text-faint">Par mois</p>
          <div className="flex flex-wrap gap-1">
            {usage.byMonth.map((row) => (
              <span key={row.month} className="rounded border border-border px-1.5 py-0.5 text-[12px] text-muted">
                {row.month} · {Math.round(row.seconds / 60)} min
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {summary && !summary.error ? (
        <div className="mt-3">
          <p className="mb-1 text-[12px] uppercase tracking-wide text-faint">Facturation du mois</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              ['Facturé', summary.invoiced ?? summary.total_invoiced],
              ['Encaissé', summary.paid ?? summary.total_paid],
              ['En attente', summary.outstanding ?? summary.total_outstanding],
              ['En retard', summary.overdue ?? summary.total_overdue],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-md border border-border bg-surface px-2 py-1.5">
                <p className="text-[11.5px] uppercase tracking-wide text-faint">{label}</p>
                <p className="mt-0.5 text-[14.5px] font-medium text-text">
                  {typeof value === 'number' ? `${value.toLocaleString('fr-CH')} CHF` : '—'}
                </p>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label>{label}</Label>
      <div className="mt-1">{children}</div>
    </div>
  );
}

/** Courbe fine sur 24 heures, pour comprendre pourquoi une tâche a patienté. */
function Sparkline({ points }: { points: { at: number; loadPct: number }[] }) {
  const width = 640;
  const height = 40;
  const recent = points.slice(-240);
  const min = recent[0]?.at ?? 0;
  const max = recent[recent.length - 1]?.at ?? min + 1;
  const path = recent
    .map((point, index) => {
      const x = ((point.at - min) / Math.max(1, max - min)) * width;
      const y = height - (Math.min(100, point.loadPct) / 100) * height;
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="mt-2 h-10 w-full" preserveAspectRatio="none">
      <path d={path} fill="none" stroke="hsl(var(--muted))" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
