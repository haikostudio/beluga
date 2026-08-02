import * as React from 'react';
import { ChevronDown, RefreshCw } from 'lucide-react';
import { AccountQuota, EngineId } from '@haikodev/shared';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger, Gauge, Badge } from '@/components/ui';
import { client } from '@/lib/client';
import { cn } from '@/lib/utils';

/**
 * Le bouton de quota : une jauge ronde qui montre le moteur ACTUELLEMENT
 * utilisé. Au clic, le détail de tous les comptes, fenêtre courte et semaine.
 */

function ring(pct: number): { color: string; dash: string } {
  const value = Math.max(0, Math.min(100, pct));
  const circumference = 2 * Math.PI * 9;
  const color = value >= 90 ? 'stroke-danger' : value >= 70 ? 'stroke-warning' : 'stroke-muted';
  return { color, dash: `${(value / 100) * circumference} ${circumference}` };
}

function worstOf(quota: AccountQuota): number {
  return Math.max(quota.session?.usedPct ?? 0, quota.weekly?.usedPct ?? 0);
}

function resetLabel(at?: number): string | null {
  if (!at) return null;
  const date = new Date(at);
  const sameDay = date.toDateString() === new Date().toDateString();
  return sameDay
    ? `remise à zéro à ${date.toLocaleTimeString('fr-CH', { hour: '2-digit', minute: '2-digit' })}`
    : `remise à zéro le ${date.toLocaleDateString('fr-CH', { day: '2-digit', month: '2-digit' })} à ${date.toLocaleTimeString('fr-CH', { hour: '2-digit', minute: '2-digit' })}`;
}

/** Une courbe simple : la consommation du compte sur les derniers jours. */
function Courbe({ points }: { points: { at: number; weekly: number; session: number }[] }) {
  if (points.length < 2) {
    return <p className="mt-1 text-[11px] text-faint">Pas encore assez de relevés pour tracer la courbe.</p>;
  }

  const largeur = 250;
  const hauteur = 30;
  const debut = points[0].at;
  const fin = points[points.length - 1].at;
  const trace = (cle: 'weekly' | 'session') =>
    points
      .map((point, index) => {
        const x = ((point.at - debut) / Math.max(1, fin - debut)) * largeur;
        const y = hauteur - (Math.min(100, point[cle]) / 100) * hauteur;
        return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');

  const jours = Math.max(1, Math.round((fin - debut) / (24 * 3600 * 1000)));

  return (
    <div className="mt-1.5">
      <svg viewBox={`0 0 ${largeur} ${hauteur}`} className="h-[30px] w-full" preserveAspectRatio="none">
        <path d={trace('session')} fill="none" stroke="hsl(var(--faint))" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        <path d={trace('weekly')} fill="none" stroke="hsl(var(--muted))" strokeWidth="1.4" vectorEffect="non-scaling-stroke" />
      </svg>
      <p className="mt-0.5 text-[10.5px] text-faint">
        {jours} jour{jours > 1 ? 's' : ''} · trait épais : la semaine, trait fin : la fenêtre de 5 h
      </p>
    </div>
  );
}

export function QuotaBadge({ activeEngine }: { activeEngine: EngineId }) {
  const [open, setOpen] = React.useState(false);
  const state = client.getSnapshot();
  const quotas = state.quotas;
  const [histoire, setHistoire] = React.useState<Record<string, { at: number; session: number; weekly: number }[]>>({});

  React.useEffect(() => {
    if (!open) return;
    client
      .call<{ history: typeof histoire }>({ type: 'quota.history', days: 7 })
      .then((data) => setHistoire(data.history ?? {}))
      .catch(() => setHistoire({}));
  }, [open]);

  // La jauge du bouton suit le moteur sur lequel on travaille.
  const current =
    quotas.find((q) => q.engine === activeEngine && q.active) ??
    quotas.find((q) => q.engine === activeEngine) ??
    quotas[0];
  const pct = current ? worstOf(current) : 0;
  const { color, dash } = ring(pct);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          className="flex items-center gap-1.5 rounded-md border border-border bg-surface px-1.5 py-1 text-[12.5px] text-muted transition-colors hover:text-text"
          title="Quotas des moteurs"
        >
          <span className="relative flex h-[22px] w-[22px] items-center justify-center">
            <svg viewBox="0 0 24 24" className="absolute inset-0 -rotate-90">
              <circle cx="12" cy="12" r="9" className="fill-none stroke-border" strokeWidth="2.5" />
              <circle
                cx="12"
                cy="12"
                r="9"
                className={cn('fill-none transition-all duration-500', color)}
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeDasharray={dash}
              />
            </svg>
            <span className="relative text-[10px] font-semibold text-text">{Math.round(pct)}</span>
          </span>
          <span className="hidden max-w-[86px] truncate sm:inline">{current?.label ?? 'quotas'}</span>
          <ChevronDown className="h-2.5 w-2.5 shrink-0" />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-[310px] p-2">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-[12px] uppercase tracking-wide text-faint">Quotas</span>
          <button
            onClick={() => client.send({ type: 'quota.refresh' })}
            className="rounded p-1 text-faint hover:bg-raised hover:text-text"
            title="Actualiser"
          >
            <RefreshCw className="h-3 w-3" />
          </button>
        </div>

        {quotas.length ? (
          <div className="space-y-2">
            {quotas.map((quota) => (
              <div
                key={quota.id}
                className={cn(
                  'rounded-md border px-2 py-1.5',
                  quota.active ? 'border-border bg-raised' : 'border-transparent',
                )}
              >
                <div className="flex items-center gap-1.5">
                  <span
                    className={cn(
                      'h-1.5 w-1.5 shrink-0 rounded-full',
                      !quota.available ? 'bg-danger' : quota.active ? 'bg-success' : 'bg-faint',
                    )}
                  />
                  <span className="min-w-0 flex-1 truncate text-[13.5px] text-text">{quota.label}</span>
                  {quota.active ? <Badge tone="success">actif</Badge> : null}
                  {!quota.available ? <Badge tone="danger">épuisé</Badge> : null}
                </div>

                <div className="mt-1.5 space-y-1.5">
                  <Window label="Fenêtre 5 h" window={quota.session} />
                  <Window label="Semaine" window={quota.weekly} />
                </div>

                <Courbe points={histoire[quota.id] ?? []} />

                {quota.error ? <p className="mt-1 text-[11.5px] text-warning">{quota.error}</p> : null}
              </div>
            ))}
          </div>
        ) : (
          <p className="px-1 py-2 text-[13px] text-faint">Aucun compte connecté.</p>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Window({ label, window: win }: { label: string; window?: { usedPct?: number; resetsAt?: number } }) {
  const pct = win?.usedPct ?? 0;
  const reset = resetLabel(win?.resetsAt);
  return (
    <div>
      <div className="flex items-baseline gap-1.5">
        <span className="text-[12px] text-faint">{label}</span>
        <span className="ml-auto text-[12px] text-muted">{Math.round(pct)} %</span>
      </div>
      <Gauge value={pct} height="h-1" />
      {reset ? <p className="mt-0.5 text-[11px] text-faint">{reset}</p> : null}
    </div>
  );
}
