import * as React from 'react';
import { ChevronDown, RefreshCw } from 'lucide-react';
import {
  AccountQuota,
  EngineId,
  compteDeSecours,
  fraicheurDuReleve,
  heureDeRemiseAZero,
  historiquePourProfil,
  niveauQuota,
  previsionEpuisement,
  profilHoraire,
  tempsRestant,
  trancheLaPlusChargee,
  type AgregatHoraire,
  type PrevisionEpuisement,
  type ReleveQuota,
  type SerieQuota,
} from '@haikodev/shared';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger, Gauge, Badge, Switch, Tooltip } from '@/components/ui';
import { client } from '@/lib/client';
import { cn } from '@/lib/utils';

/**
 * Le bouton de quota : une jauge ronde qui montre le moteur ACTUELLEMENT
 * utilisé. Au clic, le détail de tous les comptes, fenêtre courte et semaine.
 */

function ring(pct: number): { color: string; dash: string } {
  const value = Math.max(0, Math.min(100, pct));
  const circumference = 2 * Math.PI * 9;
  // Même règle que les barres des comptes : vert, jaune sous 30 % restants,
  // rouge sous 15 %. L'anneau et les barres virent donc ensemble.
  const niveau = niveauQuota(value);
  const color =
    niveau === 'critique' ? 'stroke-danger' : niveau === 'attention' ? 'stroke-warning' : 'stroke-success';
  return { color, dash: `${(value / 100) * circumference} ${circumference}` };
}

function worstOf(quota: AccountQuota): number {
  return Math.max(quota.session?.usedPct ?? 0, quota.weekly?.usedPct ?? 0);
}

/**
 * Une courbe simple : la consommation du compte sur les derniers jours. Quand
 * une prévision existe, le trait de la semaine se prolonge en POINTILLÉ jusqu'à
 * la ligne du haut : on voit d'un coup d'œil où la pente conduit.
 */
function Courbe({
  points,
  prevision,
}: {
  points: { at: number; weekly: number; session: number }[];
  prevision?: PrevisionEpuisement | null;
}) {
  if (points.length < 2) {
    return <p className="mt-1 text-[11px] text-faint">Pas encore assez de relevés pour tracer la courbe.</p>;
  }

  const largeur = 250;
  const hauteur = 30;
  const debut = points[0].at;
  const dernier = points[points.length - 1];
  // Le pointillé a besoin de place : la fin du graphique recule jusqu'à lui.
  const fin = Math.max(dernier.at, prevision?.at ?? 0);
  const x = (at: number) => ((at - debut) / Math.max(1, fin - debut)) * largeur;
  const y = (pct: number) => hauteur - (Math.min(100, pct) / 100) * hauteur;
  const trace = (cle: 'weekly' | 'session') =>
    points
      .map((point, index) => `${index === 0 ? 'M' : 'L'}${x(point.at).toFixed(1)},${y(point[cle]).toFixed(1)}`)
      .join(' ');

  const jours = Math.max(1, Math.round((dernier.at - debut) / (24 * 3600 * 1000)));

  return (
    <div className="mt-1.5">
      <svg viewBox={`0 0 ${largeur} ${hauteur}`} className="h-[30px] w-full" preserveAspectRatio="none">
        <path d={trace('session')} fill="none" stroke="hsl(var(--faint))" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        <path d={trace('weekly')} fill="none" stroke="hsl(var(--muted))" strokeWidth="1.4" vectorEffect="non-scaling-stroke" />
        {prevision ? (
          <path
            /* Le pointillé suit la MÊME projection que le texte : quand les
               heures creuses sont mesurées, il s'aplatit la nuit et remonte le
               jour au lieu de filer tout droit. */
            d={[
              `M${x(dernier.at).toFixed(1)},${y(dernier.weekly).toFixed(1)}`,
              ...prevision.trajectoire
                .filter((point) => point.at >= dernier.at)
                .map((point) => `L${x(point.at).toFixed(1)},${y(point.pct).toFixed(1)}`),
              `L${x(prevision.at).toFixed(1)},${y(100).toFixed(1)}`,
            ].join(' ')}
            fill="none"
            stroke={prevision.niveau === 'manque' ? 'hsl(var(--warning))' : 'hsl(var(--faint))'}
            strokeWidth="1.4"
            strokeDasharray="3 3"
            vectorEffect="non-scaling-stroke"
          />
        ) : null}
      </svg>
      <p className="mt-0.5 text-[10.5px] text-faint">
        {jours} jour{jours > 1 ? 's' : ''} · trait épais : la semaine, trait fin : la fenêtre de 5 h
        {prevision
          ? prevision.heuresCreuses
            ? ' · pointillé : la suite, heures creuses comprises'
            : ' · pointillé : la suite au rythme observé'
          : ''}
      </p>
    </div>
  );
}

export function QuotaBadge({ activeEngine }: { activeEngine: EngineId }) {
  const [open, setOpen] = React.useState(false);
  const state = client.getSnapshot();
  const quotas = state.quotas;
  const [histoire, setHistoire] = React.useState<Record<string, { at: number; session: number; weekly: number }[]>>({});
  /* Le résumé des semaines passées : il ne se voit pas, il ne sert qu'au profil
     des heures creuses de la prévision. */
  const [resume, setResume] = React.useState<Record<string, AgregatHoraire[]>>({});
  /* Les comptes dont on attend la réponse du serveur : leur interrupteur porte
     un voyant d'attente et n'accepte pas de second appui. */
  const [enAttente, setEnAttente] = React.useState<string[]>([]);

  React.useEffect(() => {
    if (!open) return;
    client
      .call<{ history: typeof histoire; resume?: Record<string, AgregatHoraire[]> }>({
        type: 'quota.history',
        days: 7,
      })
      .then((data) => {
        setHistoire(data.history ?? {});
        setResume(data.resume ?? {});
      })
      .catch(() => {
        setHistoire({});
        setResume({});
      });
  }, [open]);

  /** Les relevés récents précédés du résumé lointain : la matière du profil. */
  const pourProfil = React.useCallback(
    (id: string) => historiquePourProfil(resume[id], histoire[id]),
    [histoire, resume],
  );

  /*
   * Les prévisions hebdomadaires de TOUS les comptes, calculées ensemble : le
   * compte de secours d'un moteur en manque se choisit parmi ceux qui, eux,
   * tiennent jusqu'à la remise à zéro.
   */
  const previsions = React.useMemo(() => {
    const out: Record<string, PrevisionEpuisement | null> = {};
    for (const quota of quotas) out[quota.id] = previsionEpuisement(pourProfil(quota.id), quota.weekly);
    return out;
  }, [quotas, pourProfil]);

  const secoursDe = (quota: AccountQuota) =>
    compteDeSecours(
      { id: quota.id, engine: quota.engine },
      quotas.map((autre) => ({
        id: autre.id,
        label: autre.label,
        engine: autre.engine,
        disponible: autre.available !== false,
        // Un compte qui tient « de justesse » n'est pas un refuge : seuls
        // ceux sans aucune prévision de fin comptent.
        tientJusquAuBout: !previsions[autre.id],
        consommePct: autre.weekly?.usedPct ?? 0,
      })),
    );

  /*
   * Couper ou rallumer un compte se fait avec ACCUSÉ DE RÉCEPTION : un envoi
   * sans réponse laissait croire à un compte coupé qui continuait d'être
   * consommé. Le serveur répond `ok: false` quand le compte est introuvable ;
   * tout refus, comme toute panne de liaison, s'affiche en message court.
   */
  const basculerCompte = async (id: string, label: string, actif: boolean) => {
    setEnAttente((liste) => [...liste, id]);
    try {
      const reponse = await client.call<{ ok: boolean }>({ type: 'account.disable', id, disabled: !actif });
      if (!reponse?.ok) {
        client.pushToast('error', `${label} : le serveur n'a pas pu ${actif ? 'remettre en service' : 'couper'} ce compte.`);
      }
    } catch (err) {
      client.pushToast('error', `${label} : ${err instanceof Error ? err.message : 'commande refusée'}`);
    } finally {
      // Le voyant s'éteint dans TOUS les cas : réussite, refus du serveur,
      // panne de liaison. Sans ce `finally`, un refus le laisserait tourner.
      setEnAttente((liste) => liste.filter((autre) => autre !== id));
    }
  };

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
          className="flex h-7 items-center gap-1.5 rounded-md border border-border bg-transparent px-2 text-[12.5px] text-muted transition-colors hover:bg-raised hover:text-text"
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
                  quota.disabled ? 'border-border opacity-60' : quota.active ? 'border-muted' : 'border-border',
                )}
              >
                <div className="flex items-center gap-1.5">
                  <span
                    className={cn(
                      'h-1.5 w-1.5 shrink-0 rounded-full',
                      quota.disabled
                        ? 'bg-faint'
                        : !quota.available
                          ? 'bg-danger'
                          : quota.active
                            ? 'bg-success'
                            : 'bg-faint',
                    )}
                  />
                  <span className="min-w-0 flex-1 truncate text-[13.5px] text-text">{quota.label}</span>
                  {quota.disabled ? (
                    <Badge tone="neutral">désactivé</Badge>
                  ) : (
                    <>
                      {quota.active ? <Badge tone="success">actif</Badge> : null}
                      {!quota.available ? <Badge tone="danger">épuisé</Badge> : null}
                    </>
                  )}
                  {/* L'interrupteur coupe ou rallume le compte. Coupé, il n'est
                      plus choisi par l'ordonnanceur et sa fenêtre de 5 h n'est
                      plus amorcée ; il reste dans la liste, éteint. */}
                  <Tooltip label={quota.disabled ? 'Compte désactivé — le remettre en service' : 'Désactiver ce compte'}>
                    <Switch
                      data-interrupteur-compte={quota.id}
                      attente={enAttente.includes(quota.id)}
                      checked={!quota.disabled}
                      onCheckedChange={(actif) => basculerCompte(quota.id, quota.label, actif)}
                      aria-label={quota.disabled ? `Réactiver ${quota.label}` : `Désactiver ${quota.label}`}
                    />
                  </Tooltip>
                </div>

                <div className="mt-1.5 space-y-1.5">
                  {/* Les deux fenêtres portent leur prévision. Celle de cinq
                      heures ne parle que si la journée a laissé assez de
                      relevés ; sinon elle se tait, comme la semaine. */}
                  <Window
                    label="Fenêtre 5 h"
                    window={quota.session}
                    releves={histoire[quota.id]}
                    serie="session"
                  />
                  <Window
                    label="Semaine"
                    window={quota.weekly}
                    releves={pourProfil(quota.id)}
                    secours={secoursDe(quota)?.label}
                  />
                </div>

                <Courbe points={histoire[quota.id] ?? []} prevision={previsions[quota.id]} />

                {/* Même source que la prévision : le résumé des semaines
                    passées puis le détail récent, pas le seul détail. */}
                <TrancheDePointe releves={pourProfil(quota.id)} />

                <DerniereAmorce amorce={quota.derniereAmorce} />

                {quota.error ? (
                  <ReleveAncien erreur={quota.error} fetchedAt={quota.fetchedAt} />
                ) : null}
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

function ReleveAncien({ erreur, fetchedAt }: { erreur: string; fetchedAt?: number }) {
  const [, battre] = React.useReducer((valeur: number) => valeur + 1, 0);
  React.useEffect(() => {
    const timer = window.setInterval(battre, 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const fraicheur = fraicheurDuReleve(fetchedAt);
  return (
    <div className="mt-1 text-[11.5px] text-warning">
      <p>{erreur}</p>
      {fraicheur ? <p>Chiffres anciens — {fraicheur}</p> : null}
    </div>
  );
}

/**
 * Le profil des heures creuses sert déjà à repousser l'heure d'épuisement, mais
 * il ne se voyait nulle part. Cette ligne le rend lisible en une phrase : quand
 * la consommation grimpe, et de combien. Elle se TAIT quand le profil n'existe
 * pas encore, et quand aucune tranche ne se détache vraiment de la moyenne.
 */
function TrancheDePointe({ releves }: { releves?: ReleveQuota[] }) {
  const pointe = React.useMemo(() => trancheLaPlusChargee(profilHoraire(releves ?? [])), [releves]);
  if (!pointe) return null;
  return <p className="mt-0.5 text-[10.5px] text-faint">{pointe.texte}</p>;
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
    { account: string; at: number; ok: boolean; model?: string; error?: string }[]
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
                  {entree.ok ? 'ok' : (entree.error ?? 'refus')}
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

function Window({
  label,
  window: win,
  releves,
  serie = 'weekly',
  secours,
}: {
  label: string;
  window?: { usedPct?: number; resetsAt?: number };
  /** Les relevés du compte, d'où se tire la prévision d'épuisement. */
  releves?: ReleveQuota[];
  /** Laquelle des deux fenêtres ces relevés doivent servir. */
  serie?: SerieQuota;
  /** Le compte sur lequel basculer, s'il en existe un qui tienne. */
  secours?: string;
}) {
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
  // Rien à annoncer tant que le calcul n'a pas de sens : la fonction se tait
  // toute seule (trop peu de relevés, rythme nul, quota qui tient jusqu'au bout).
  const prevision = releves ? previsionEpuisement(releves, win, Date.now(), serie) : null;

  return (
    <div>
      <div className="flex items-baseline gap-1.5">
        <span className="text-[12px] text-faint">{label}</span>
        <span className="ml-auto text-[12px] text-muted">{Math.round(pct)} %</span>
      </div>
      <Gauge value={pct} tone="quota" height="h-1" />
      {restant ? (
        <Tooltip label={exact ?? ''}>
          <p className="mt-0.5 w-fit text-[11px] text-faint">{restant}</p>
        </Tooltip>
      ) : null}
      {prevision ? (
        // Orange quand le quota tombe nettement avant la fin de la semaine,
        // discret quand il tient presque jusqu'au bout. L'heure exacte et le
        // rythme observé restent en infobulle, comme pour le temps restant.
        <Tooltip label={prevision.detail}>
          <p
            className={cn(
              'mt-0.5 w-fit text-[11px]',
              prevision.niveau === 'manque' ? 'font-medium text-warning' : 'text-faint',
            )}
          >
            {prevision.texte}
          </p>
        </Tooltip>
      ) : null}
      {prevision?.niveau === 'manque' && secours ? (
        // La question qui suit « ça va manquer » est toujours « on bascule sur
        // quoi ? » : la réponse est posée juste dessous, du même moteur et
        // choisie parmi les comptes qui, eux, tiennent jusqu'au bout.
        <p className="mt-0.5 text-[11px] text-faint">bascule possible sur {secours}</p>
      ) : null}
    </div>
  );
}
