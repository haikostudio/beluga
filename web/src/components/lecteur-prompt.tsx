import * as React from 'react';
import { Check, ChevronDown, Copy, Search } from 'lucide-react';
import { SentContextSnapshot, TourEnvoye } from '@haikodev/shared';
import { Input } from '@/components/ui';
import { cn } from '@/lib/utils';

/**
 * LE LECTEUR DE PROMPTS — la SEULE façon de lire un tour envoyé au moteur
 * dans toute l'application (tiroir « Contexte envoyé » du chef, volet
 * « Détail » d'une carte). Montre le texte réellement transmis, découpé en
 * blocs nommés, avec un repère VISUEL pour ce qui est relu au cache — jamais
 * un chiffre.
 */

function nomMoteur(engine: SentContextSnapshot['engine']): string {
  return engine === 'claude' ? 'Claude Code' : 'Codex';
}

function nomSession(session: SentContextSnapshot['session']): string {
  return session === 'new' ? 'Nouvelle session' : 'Reprise de session';
}

function contientLaRecherche(texte: string | undefined, requete: string): boolean {
  if (!requete) return true;
  return (texte ?? '').toLowerCase().includes(requete.toLowerCase());
}

function BoutonCopierBloc({ texte, titre = 'Copier' }: { texte: string; titre?: string }) {
  const [copie, setCopie] = React.useState(false);
  if (!texte?.trim()) return null;
  const copier = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(texte);
    } catch {
      const zone = document.createElement('textarea');
      zone.value = texte;
      zone.style.position = 'fixed';
      zone.style.opacity = '0';
      document.body.appendChild(zone);
      zone.select();
      document.execCommand('copy');
      zone.remove();
    }
    setCopie(true);
    window.setTimeout(() => setCopie(false), 1800);
  };
  return (
    <button
      type="button"
      onClick={copier}
      title={titre}
      className="inline-flex shrink-0 items-center gap-1 rounded px-1 py-0.5 text-[11.5px] text-faint transition-colors hover:bg-surface hover:text-text"
    >
      {copie ? <Check className="h-2.5 w-2.5 text-success" /> : <Copy className="h-2.5 w-2.5" />}
      {copie ? 'Copié' : 'Copier'}
    </button>
  );
}

function texteDunTour(tour: TourEnvoye): string {
  const { contexte } = tour;
  const parties = [
    `Tour ${tour.numero} — ${new Date(contexte.sentAt).toLocaleString('fr-CH')}`,
    `${nomMoteur(contexte.engine)}${contexte.model ? ` — ${contexte.model}` : ''} · ${nomSession(contexte.session)}`,
    ...contexte.blocks
      .filter((b) => b.text)
      .map((b) => `${b.label}${b.cached ? ' (relu au cache)' : ''}\n\n${b.text}`),
  ];
  return parties.join('\n\n---\n\n');
}

/** Un bloc nommé du prompt, replié par défaut. */
function BlocDePrompt({
  label,
  texte,
  cached,
  ouvertParDefaut,
}: {
  label: string;
  texte: string | undefined;
  cached: boolean;
  ouvertParDefaut: boolean;
}) {
  const [ouvert, setOuvert] = React.useState(ouvertParDefaut);
  React.useEffect(() => {
    if (ouvertParDefaut) setOuvert(true);
  }, [ouvertParDefaut]);

  return (
    <div
      data-bloc-prompt
      data-cache={cached ? 'relu' : 'neuf'}
      className={cn(
        'rounded-md border px-2.5 py-1.5',
        cached ? 'border-border/60 bg-raised/50 opacity-70' : 'border-border bg-surface',
      )}
    >
      <button
        type="button"
        className="flex w-full items-center gap-2 text-left"
        aria-expanded={ouvert}
        onClick={() => setOuvert((v) => !v)}
      >
        <ChevronDown
          className={cn('h-3 w-3 shrink-0 text-faint transition-transform', ouvert && 'rotate-180')}
          aria-hidden="true"
        />
        <span className="min-w-0 flex-1 truncate text-[13px] text-text">{label}</span>
        {cached ? (
          <span className="shrink-0 rounded-full border border-border px-1.5 py-0.5 text-[10.5px] text-faint">
            relu au cache
          </span>
        ) : null}
        {texte ? <BoutonCopierBloc texte={texte} titre={`Copier « ${label} »`} /> : null}
      </button>
      {ouvert ? (
        texte ? (
          <pre className="mt-1.5 whitespace-pre-wrap break-words rounded bg-raised px-2 py-1.5 font-sans text-[12.5px] leading-relaxed text-muted [overflow-wrap:anywhere]">
            {texte}
          </pre>
        ) : (
          <p className="mt-1.5 text-[12px] text-faint">
            Texte non conservé (tour ancien, retiré pour borner le disque).
          </p>
        )
      ) : null}
    </div>
  );
}

/** Un tour, dans la liste : en-tête toujours visible, blocs à déplier. */
function TourDuLecteur({
  tour,
  actuel,
  ouvert,
  onBasculer,
  requete,
}: {
  tour: TourEnvoye;
  actuel: boolean;
  ouvert: boolean;
  onBasculer: () => void;
  requete: string;
}) {
  const { contexte } = tour;
  const blocsFiltres = requete
    ? contexte.blocks.filter((b) => contientLaRecherche(b.text, requete) || contientLaRecherche(b.label, requete))
    : contexte.blocks;
  if (requete && !blocsFiltres.length) return null;

  return (
    <li className="relative" data-tour-envoye data-numero={tour.numero}>
      <span className="absolute left-[-22px] top-1.5 flex h-[18px] w-[18px] items-center justify-center rounded-full border border-border bg-raised text-[10px] font-medium tabular-nums text-faint">
        {tour.numero}
      </span>
      <div className="rounded-lg border border-border bg-surface px-2.5 py-2">
        <button
          type="button"
          className="flex w-full items-start gap-2 text-left"
          aria-expanded={ouvert}
          onClick={onBasculer}
        >
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span className="text-[13px] font-medium text-text">
                Tour {tour.numero}
                {actuel ? ' · ce tour' : ''}
              </span>
              <span className="text-[12px] text-faint">{new Date(contexte.sentAt).toLocaleString('fr-CH')}</span>
            </div>
            <p className="mt-0.5 text-[12px] text-faint">
              {nomMoteur(contexte.engine)}
              {contexte.model ? ` · ${contexte.model}` : ''} · {nomSession(contexte.session)} ·{' '}
              {contexte.history === 'retained_by_engine'
                ? 'historique conservé par le moteur'
                : "pas d'historique (nouvelle session)"}
            </p>
          </div>
          <ChevronDown
            className={cn('mt-0.5 h-3.5 w-3.5 shrink-0 text-faint transition-transform', ouvert && 'rotate-180')}
            aria-hidden="true"
          />
        </button>

        {ouvert ? (
          <div className="mt-2 space-y-1.5 border-t border-border pt-2">
            {contexte.passages.length ? (
              <div className="mb-1.5 text-[12px] text-faint">
                Passages retrouvés dans la documentation ({contexte.passages.length}) :{' '}
                {contexte.passages.map((p) => p.source).join(', ')}
              </div>
            ) : contexte.passagesRaison ? (
              <p className="mb-1.5 text-[12px] text-faint">{contexte.passagesRaison}</p>
            ) : null}
            {blocsFiltres.map((bloc, index) => (
              <BlocDePrompt
                key={`${bloc.kind}-${index}`}
                label={bloc.label}
                texte={bloc.text}
                cached={Boolean(bloc.cached)}
                ouvertParDefaut={Boolean(requete)}
              />
            ))}
            {contexte.passages.length ? (
              <div className="space-y-1.5">
                {contexte.passages.map((passage, index) =>
                  contientLaRecherche(passage.texte, requete) || contientLaRecherche(passage.source, requete) ? (
                    <BlocDePrompt
                      key={`passage-${index}`}
                      label={`Passage retrouvé — ${passage.source}${passage.titre ? ` › ${passage.titre}` : ''}`}
                      texte={passage.texte}
                      cached={false}
                      ouvertParDefaut={Boolean(requete)}
                    />
                  ) : null,
                )}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </li>
  );
}

export { texteDunTour as texteDunTourEnvoye };

/**
 * `tours` : la chronologie complète (`chronologieContexteEnvoye`). `tourInitial`
 * (optionnel) : le numéro à déplier en entrant — sinon le dernier tour.
 */
export function LecteurPrompt({
  tours,
  tourInitial,
}: {
  tours: TourEnvoye[];
  tourInitial?: number;
}) {
  const [depliés, setDepliés] = React.useState<Set<number>>(
    () => new Set(tourInitial !== undefined ? [tourInitial] : tours.at(-1) ? [tours.at(-1)!.numero] : []),
  );
  const [requete, setRequete] = React.useState('');

  if (!tours.length) {
    return <p className="text-[12.5px] text-faint">Aucun tour envoyé pour l'instant.</p>;
  }

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" />
        <Input
          value={requete}
          onChange={(e) => setRequete(e.target.value)}
          placeholder="Rechercher dans les prompts envoyés…"
          className="pl-7 text-[13px]"
          data-recherche-prompt
        />
      </div>

      <ol
        data-chronologie-tours
        className="relative space-y-1.5 pl-[22px] before:absolute before:bottom-3 before:left-[9px] before:top-3 before:w-px before:bg-border"
      >
        {tours.map((tour) => (
          <TourDuLecteur
            key={tour.messageId}
            tour={tour}
            actuel={tourInitial === tour.numero}
            requete={requete}
            ouvert={depliés.has(tour.numero) || Boolean(requete)}
            onBasculer={() =>
              setDepliés((current) => {
                const suivant = new Set(current);
                if (suivant.has(tour.numero)) suivant.delete(tour.numero);
                else suivant.add(tour.numero);
                return suivant;
              })
            }
          />
        ))}
      </ol>
    </div>
  );
}
