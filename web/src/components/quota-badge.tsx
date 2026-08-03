import * as React from 'react';
import { ChevronDown, RefreshCw } from 'lucide-react';
import { AccountQuota, EngineId, heureDeRemiseAZero, tempsRestant } from '@haikodev/shared';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger, Gauge, Badge, Tooltip } from '@/components/ui';
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
            <span className="relative text-[8.5px] font-medium leading-none text-text">{Math.round(pct)}</span>
          </span>
          <span className="hidden max-w-[86px] truncate sm:inline">{current?.label ?? 'quotas'}</span>
          <ChevronDown className="h-2.5 w-2.5 shrink-0" />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="p-2 sm:w-[310px]">
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
                // Chaque compte est une carte à part entière : bordure et fond
                // pour tous. Le compte qui sert est marqué par sa bordure, pas
                // par l'absence de carte chez les autres.
                className={cn(
                  'rounded-md border bg-raised px-2 py-1.5',
                  quota.active ? 'border-muted' : 'border-border',
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

                <DerniereAmorce amorce={quota.derniereAmorce} />

                {quota.error ? <p className="mt-1 text-[11.5px] text-warning">{quota.error}</p> : null}
              </div>
            ))}
          </div>
        ) : (
          <p className="px-1 py-2 text-[13px] text-faint">Aucun compte connecté.</p>
        )}

        <JournalDesAmorces ouvertMenu={open} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** L'heure du jour, sans la date : le journal ne remonte que de quelques jours. */
function heureCourte(at: number): string {
  const date = new Date(at);
  const aujourdhui = date.toDateString() === new Date().toDateString();
  const heure = date.toLocaleTimeString('fr-CH', { hour: '2-digit', minute: '2-digit' });
  return aujourdhui ? heure : `${date.toLocaleDateString('fr-CH', { day: '2-digit', month: '2-digit' })} ${heure}`;
}

/**
 * La preuve, sur le compte lui-même, que le serveur a lancé la fenêtre tout
 * seul : l'heure à laquelle il a posé son amorce.
 */
function DerniereAmorce({ amorce }: { amorce?: AccountQuota['derniereAmorce'] }) {
  if (!amorce) return null;
  return (
    <p className={cn('mt-1 text-[11px]', amorce.ok ? 'text-faint' : 'text-warning')}>
      {amorce.ok
        ? `fenêtre amorcée par le serveur à ${heureCourte(amorce.at)}`
        : `amorce refusée à ${heureCourte(amorce.at)}${amorce.error ? ` (${amorce.error})` : ''}`}
    </p>
  );
}

/**
 * Le journal complet, replié par défaut : il raconte le travail de fond, il ne
 * doit pas prendre la place des chiffres qu'on vient lire.
 */
function JournalDesAmorces({ ouvertMenu }: { ouvertMenu: boolean }) {
  const [ouvert, setOuvert] = React.useState(false);
  const [entrees, setEntrees] = React.useState<
    { account: string; at: number; ok: boolean; model?: string; tokens?: number; error?: string }[]
  >([]);

  React.useEffect(() => {
    if (!ouvertMenu || !ouvert) return;
    client
      .call<{ entries: typeof entrees }>({ type: 'amorce.history', limit: 30 })
      .then((data) => setEntrees(data.entries ?? []))
      .catch(() => setEntrees([]));
  }, [ouvertMenu, ouvert]);

  const nom = (id: string) => client.getSnapshot().quotas.find((q) => q.id === id)?.label ?? id;

  return (
    <div className="mt-2 border-t border-border pt-1.5">
      <button
        type="button"
        onClick={() => setOuvert((valeur) => !valeur)}
        className="flex w-full items-center gap-1.5 text-left text-[12px] text-faint hover:text-text"
      >
        <ChevronDown className={cn('h-2.5 w-2.5 shrink-0 transition-transform', !ouvert && '-rotate-90')} />
        <span>Journal des amorces</span>
      </button>

      {ouvert ? (
        entrees.length ? (
          <ul className="mt-1 space-y-0.5">
            {entrees.map((entree) => (
              <li key={`${entree.account}-${entree.at}`} className="flex items-baseline gap-1.5 text-[11px]">
                <span className="shrink-0 text-faint">{heureCourte(entree.at)}</span>
                <span className="min-w-0 flex-1 truncate text-muted">{nom(entree.account)}</span>
                <span className={cn('shrink-0', entree.ok ? 'text-faint' : 'text-warning')}>
                  {entree.ok ? `${entree.tokens ?? 0} jetons` : (entree.error ?? 'refus')}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-[11px] text-faint">Aucune amorce enregistrée pour l’instant.</p>
        )
      ) : null}
    </div>
  );
}

function Window({ label, window: win }: { label: string; window?: { usedPct?: number; resetsAt?: number } }) {
  const pct = win?.usedPct ?? 0;
  /*
   * Le temps restant vieillit tout seul : sans ce battement d'une minute, il
   * resterait figé sur la valeur du moment où le menu s'est ouvert.
   */
  const [, battre] = React.useReducer((valeur: number) => valeur + 1, 0);
  React.useEffect(() => {
    const timer = window.setInterval(battre, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const restant = tempsRestant(win?.resetsAt);
  const exact = heureDeRemiseAZero(win?.resetsAt);
  return (
    <div>
      <div className="flex items-baseline gap-1.5">
        <span className="text-[12px] text-faint">{label}</span>
        <span className="ml-auto text-[12px] text-muted">{Math.round(pct)} %</span>
      </div>
      <Gauge value={pct} height="h-1" />
      {restant ? (
        <Tooltip label={exact ?? ''}>
          <p className="mt-0.5 w-fit text-[11px] text-faint">{restant}</p>
        </Tooltip>
      ) : null}
    </div>
  );
}
