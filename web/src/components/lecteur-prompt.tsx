import * as React from 'react';
import { Check, ChevronDown, Copy, Search } from 'lucide-react';
import {
  SentContextSnapshot,
  TourEnvoye,
  origineDuBloc,
  partagePourLOeil,
  partsDuContexte,
  type OrigineDeBloc,
} from '@haikodev/shared';
import { Input } from '@/components/ui';
import { cn } from '@/lib/utils';
import { t, formatRegional } from '@/lib/langue';

/**
 * LE LECTEUR DE PROMPTS — la SEULE façon de lire un tour envoyé au moteur
 * dans toute l'application (tiroir « Contexte envoyé », volet
 * « Détail » d'une carte). Montre le texte réellement transmis, découpé en
 * blocs nommés, avec un repère VISUEL pour ce qui est relu au cache — jamais
 * un chiffre.
 */

function nomMoteur(engine: SentContextSnapshot['engine']): string {
  return engine === 'claude' ? 'Claude Code' : 'Codex';
}

function nomSession(session: SentContextSnapshot['session']): string {
  return session === 'new' ? t('Nouvelle session') : t('Reprise de session');
}

function contientLaRecherche(texte: string | undefined, requete: string): boolean {
  if (!requete) return true;
  return (texte ?? '').toLowerCase().includes(requete.toLowerCase());
}

function BoutonCopierBloc({ texte, titre = t('Copier') }: { texte: string; titre?: string }) {
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
      {copie ? t('Copié') : t('Copier')}
    </button>
  );
}

function texteDunTour(tour: TourEnvoye): string {
  const { contexte } = tour;
  const parties = [
    `Tour ${tour.numero} — ${new Date(contexte.sentAt).toLocaleString(formatRegional())}`,
    `${nomMoteur(contexte.engine)}${contexte.model ? ` — ${contexte.model}` : ''} · ${nomSession(contexte.session)}`,
    ...contexte.blocks
      .filter((b) => b.text)
      .map((b) => `${b.label}${b.cached ? t(' (relu au cache)') : ''}\n\n${b.text}`),
  ];
  return parties.join('\n\n---\n\n');
}

/** Un bloc nommé du prompt, replié par défaut. */
function BlocDePrompt({
  label,
  texte,
  cached,
  ouvertParDefaut,
  kind,
  origine,
}: {
  label: string;
  texte: string | undefined;
  cached: boolean;
  ouvertParDefaut: boolean;
  kind?: string;
  origine?: OrigineDeBloc;
}) {
  const [ouvert, setOuvert] = React.useState(ouvertParDefaut);
  React.useEffect(() => {
    if (ouvertParDefaut) setOuvert(true);
  }, [ouvertParDefaut]);

  const styleClasse =
    kind === 'memory' ? 'border-info bg-info/10' :
    kind === 'request' ? 'border-record bg-record/10' :
    kind === 'briefing' ? 'border-warning bg-warning/10' :
    kind === 'card' ? 'border-success bg-success/10' :
    kind === 'system' ? 'border-danger bg-danger/10' :
    'border-border bg-surface';

  return (
    <div
      data-bloc-prompt
      data-bloc-kind={kind}
      data-cache={cached ? 'relu' : 'neuf'}
      className={cn(
        'rounded-md border px-2.5 py-1.5',
        cached ? `${styleClasse} opacity-70` : styleClasse,
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
        {origine ? <PastilleOrigine origine={origine} /> : null}
        {cached ? (
          <span className="shrink-0 rounded-full border border-border px-1.5 py-0.5 text-[10.5px] text-faint">
            {t('relu au cache')}
          </span>
        ) : null}
        {texte ? <BoutonCopierBloc texte={texte} titre={t('Copier « {label} »', { label })} /> : null}
      </button>
      {ouvert ? (
        texte ? (
          <pre className="mt-1.5 whitespace-pre-wrap break-words rounded bg-raised px-2 py-1.5 font-sans text-[12.5px] leading-relaxed text-muted [overflow-wrap:anywhere]">
            {texte}
          </pre>
        ) : (
          <p className="mt-1.5 text-[12px] text-faint">
            {t('Texte non conservé (tour ancien, retiré pour borner le disque).')}</p>
        )
      ) : null}
    </div>
  );
}

/**
 * LA PASTILLE D'ORIGINE — d'où vient ce bloc, en un mot.
 *
 * Trois couleurs, et le choix suit la règle de la maison : le BLEU pour ce qui
 * est déjà acquis (la plateforme, identique partout), l'ORANGE pour ce qui
 * bouge (le projet, qu'on écrit et qu'on paie), le gris pour la demande, qui
 * n'est le contexte de personne.
 */
const NOM_ORIGINE: Record<OrigineDeBloc, string> = {
  plateforme: 'plateforme',
  projet: 'projet',
  demande: 'demande',
};

function PastilleOrigine({ origine }: { origine: OrigineDeBloc }) {
  return (
    <span
      data-origine={origine}
      className={cn(
        'shrink-0 rounded-full px-1.5 py-0.5 text-[10.5px]',
        origine === 'plateforme'
          ? 'bg-info/15 text-info'
          : origine === 'projet'
            ? 'bg-warning/15 text-warning'
            : 'bg-raised text-faint',
      )}
    >
      {t(NOM_ORIGINE[origine])}
    </span>
  );
}

/**
 * LE PARTAGE D'UN TOUR — ce qui vient de la plateforme, ce qui vient du projet.
 *
 * C'est la question que ce tiroir doit savoir répondre : sur tout ce qu'on
 * paie, quelle part décrit VRAIMENT ce projet, et quelle part est un socle
 * identique sur les dix-huit autres ? La barre le montre d'un coup d'œil, et
 * chaque bloc porte ensuite sa pastille pour dire lequel est lequel.
 */
function PartageDuTour({ contexte }: { contexte: SentContextSnapshot }) {
  const parts = partsDuContexte(contexte.blocks);
  const lignes = partagePourLOeil(parts);
  if (!lignes.length) return null;
  return (
    <div data-partage-contexte className="mb-2">
      <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-raised">
        {lignes.map((ligne) => (
          <div
            key={ligne.cle}
            data-partage-barre={ligne.cle}
            style={{ width: `${ligne.part}%` }}
            className={cn(
              ligne.cle === 'plateforme' ? 'bg-info' : ligne.cle === 'projet' ? 'bg-warning' : 'bg-faint',
            )}
          />
        ))}
      </div>
      <p className="mt-1 text-[11.5px] text-faint">
        {lignes
          .map((ligne) => `${t(NOM_ORIGINE[ligne.cle])} ${ligne.part} %`)
          .join(' · ')}
      </p>
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
                {t('Tour {v0} {v1}', { v0: tour.numero, v1: actuel ? ' · ce tour' : '' })}</span>
              <span className="text-[12px] text-faint">{new Date(contexte.sentAt).toLocaleString(formatRegional())}</span>
            </div>
            <p className="mt-0.5 text-[12px] text-faint">
              {nomMoteur(contexte.engine)}
              {contexte.model ? ` · ${contexte.model}` : ''} · {nomSession(contexte.session)} ·{' '}
              {contexte.history === 'retained_by_engine'
                ? t('historique conservé par le moteur')
                : t('pas d\'historique (nouvelle session)')}
            </p>
          </div>
          <ChevronDown
            className={cn('mt-0.5 h-3.5 w-3.5 shrink-0 text-faint transition-transform', ouvert && 'rotate-180')}
            aria-hidden="true"
          />
        </button>

        {ouvert ? (
          <div className="mt-2 space-y-1.5 border-t border-border pt-2">
            <PartageDuTour contexte={contexte} />
            {contexte.passages.length ? (
              <div className="mb-1.5 text-[12px] text-faint">
                {t('Passages retrouvés dans la documentation ({v0}) :{v1} {v2}', { v0: contexte.passages.length, v1: ' ', v2: contexte.passages.map((p) => p.source).join(', ') })}</div>
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
                kind={bloc.kind}
                origine={origineDuBloc(bloc)}
              />
            ))}
            {contexte.passages.length ? (
              <div className="space-y-1.5">
                {contexte.passages.map((passage, index) =>
                  contientLaRecherche(passage.texte, requete) || contientLaRecherche(passage.source, requete) ? (
                    <BlocDePrompt
                      key={`passage-${index}`}
                      label={t('Passage retrouvé — {v0}{v1}', { v0: passage.source, v1: passage.titre ? ` › ${passage.titre}` : '' })}
                      texte={passage.texte}
                      cached={false}
                      ouvertParDefaut={Boolean(requete)}
                      kind="extra"
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
    return <p className="text-[12.5px] text-faint">{t('Aucun tour envoyé pour l\'instant.')}</p>;
  }

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" />
        <Input
          value={requete}
          onChange={(e) => setRequete(e.target.value)}
          placeholder={t('Rechercher dans les prompts envoyés…')}
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
