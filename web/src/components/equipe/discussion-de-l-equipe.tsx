/*
 * LA DISCUSSION DE L'ÉQUIPE (maquette #1ff2, carte « Beluga piloté par des agents », 26/11/2026) : un FLUX où l'on voit
 * qui parle à qui — « Eliot à Zoé · 07:02 », chaque prénom dans la couleur de son agent —, vos messages en bulle à
 * droite, et le champ d'écriture en bas avec sa CIBLE : « Toute l'équipe » (le message va au métier qui correspond, à
 * défaut au développement) ou un seul agent. Un message au développement ouvre une tâche, qu'on retrouve d'un clic.
 *
 * Tout se lit dans le journal des échanges (`agents_echanges`), relu à chaque événement de l'équipe.
 */
import * as React from 'react';
import { TOUTE_L_EQUIPE, VOUS, type EchangeDAgents } from '@beluga/shared';
import { ListeDeroulante, ZoneDefilement } from '@/components/ui';
import { ArrowUp, ChevronDown, Loader2 } from '@/components/ui/icones';
import { PileDePortraits, PortraitDAgent } from '@/components/equipe/portrait-d-agent';
import type { MembreLu } from '@/components/equipe/use-equipe';
import { client } from '@/lib/client';
import { formatRegional, t } from '@/lib/langue';
import { cn } from '@/lib/utils';

/** L'heure d'un échange : « 07:02 » le jour même, sinon « 24 nov. 07:02 ». */
export function heureDeLEchange(date: number): string {
  const d = new Date(date);
  const memeJour = new Date().toDateString() === d.toDateString();
  const heure = d.toLocaleTimeString(formatRegional(), { hour: '2-digit', minute: '2-digit' });
  return memeJour ? heure : `${d.toLocaleDateString(formatRegional(), { day: 'numeric', month: 'short' })} ${heure}`;
}

function NomColore({ membre }: { membre: MembreLu | undefined }) {
  if (!membre) return <span className="font-semibold text-muted">{t('Un ancien agent')}</span>;
  return (
    <span className="font-semibold" style={{ color: membre.couleur }}>
      {membre.fiche.nom}
    </span>
  );
}

function Destinataire({ a, parId }: { a: string; parId: Map<string, MembreLu> }) {
  if (a === VOUS) return <span className="text-text">{t('vous')}</span>;
  if (a === TOUTE_L_EQUIPE) return <span className="text-text">{t('toute l’équipe')}</span>;
  return <NomColore membre={parId.get(a)} />;
}

export function DiscussionDeLEquipe({
  projectId,
  membres,
  echanges,
  onOuvrirTache,
  cibleParDefaut = TOUTE_L_EQUIPE,
  placeholder,
}: {
  projectId: string;
  membres: readonly MembreLu[];
  echanges: readonly EchangeDAgents[];
  onOuvrirTache: (cardId: string) => void;
  cibleParDefaut?: string;
  placeholder?: string;
}) {
  const parId = React.useMemo(() => new Map(membres.map((m) => [m.id, m])), [membres]);
  const fin = React.useRef<HTMLDivElement | null>(null);
  const dernier = echanges[echanges.length - 1]?.id;
  React.useEffect(() => {
    fin.current?.scrollIntoView({ block: 'end' });
  }, [dernier]);
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-discussion-de-l-equipe={projectId}>
      <ZoneDefilement classeEnveloppe="min-h-0 flex-1" className="px-4 pb-4 sm:px-7" data-fil-de-l-equipe={echanges.length}>
        <div className="flex min-h-full flex-col justify-end gap-5 pt-6">
          {!echanges.length ? (
            <p className="pb-4 text-center text-[13.5px] text-faint" data-discussion-vide="">
              {t('La discussion de l’équipe commence ici. Écrivez à toute l’équipe, ou choisissez un agent en bas.')}
            </p>
          ) : null}
          {echanges.map((e) =>
            e.de === VOUS ? (
              <div key={e.id} className="flex flex-col items-end gap-1" data-echange={e.id} data-echange-de="vous">
                <span className="text-[12px] text-faint">
                  {t('Vous à')} <Destinataire a={e.a} parId={parId} /> · {heureDeLEchange(e.date)}
                </span>
                <div className="max-w-[80%] whitespace-pre-wrap break-words rounded-2xl bg-raised px-4 py-2.5 text-[14.5px] text-text">{e.texte}</div>
              </div>
            ) : (
              <div key={e.id} className="flex gap-3" data-echange={e.id} data-echange-de={e.de}>
                {parId.get(e.de) ? (
                  <PortraitDAgent portrait={parId.get(e.de)!.portrait} couleur={parId.get(e.de)!.couleur} nom={parId.get(e.de)!.fiche.nom} taille={34} cerne />
                ) : (
                  <span className="h-[34px] w-[34px] shrink-0 rounded-full bg-raised" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-[13.5px] leading-tight">
                    <NomColore membre={parId.get(e.de)} /> <span className="text-faint">{t('à')}</span> <Destinataire a={e.a} parId={parId} />{' '}
                    <span className="text-faint">· {heureDeLEchange(e.date)}</span>
                  </p>
                  <p className="mt-1 whitespace-pre-wrap break-words text-[14.5px] leading-relaxed text-text">{e.texte}</p>
                  {e.cardId ? (
                    <button
                      type="button"
                      onClick={() => onOuvrirTache(e.cardId!)}
                      className="mt-2 inline-flex h-8 items-center rounded-lg bg-raised px-3 text-[13px] font-medium text-text transition-colors hover:bg-controle-doux-survol"
                      data-ouvrir-la-tache={e.cardId}
                    >
                      {t('Ouvrir la tâche')}
                    </button>
                  ) : null}
                </div>
              </div>
            ),
          )}
          <div ref={fin} />
        </div>
      </ZoneDefilement>
      <ChampDeLEquipe projectId={projectId} membres={membres} cibleParDefaut={cibleParDefaut} placeholder={placeholder} />
    </div>
  );
}

/** LE CHAMP D'ÉCRITURE DE L'ÉQUIPE : le texte, la cible (« Toute l'équipe » ou un agent), l'envoi. */
function ChampDeLEquipe({ projectId, membres, cibleParDefaut, placeholder }: { projectId: string; membres: readonly MembreLu[]; cibleParDefaut: string; placeholder?: string }) {
  const [texte, setTexte] = React.useState('');
  const [cible, setCible] = React.useState(cibleParDefaut);
  const [envoi, setEnvoi] = React.useState(false);
  const zone = React.useRef<HTMLTextAreaElement | null>(null);
  React.useEffect(() => setCible(cibleParDefaut), [cibleParDefaut]);
  React.useLayoutEffect(() => {
    const el = zone.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(200, el.scrollHeight)}px`;
  }, [texte]);
  const choisi = membres.find((m) => m.id === cible) ?? null;
  const envoyer = async () => {
    const propre = texte.trim();
    if (!propre || envoi) return;
    setEnvoi(true);
    try {
      await client.call({ type: 'equipe.ecrire', projectId, texte: propre, cible }, 60000);
      setTexte('');
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('Le message n’a pas pu partir'));
    } finally {
      setEnvoi(false);
    }
  };
  const options = [
    { valeur: TOUTE_L_EQUIPE, libelle: t('Toute l’équipe'), icone: <PileDePortraits membres={membres.map((m) => ({ id: m.id, portrait: m.portrait, couleur: m.couleur, nom: m.fiche.nom }))} taille={18} max={3} fond="hsl(var(--surface))" /> },
    ...membres.map((m) => ({
      valeur: m.id,
      libelle: m.fiche.nom,
      detail: m.activite ?? undefined,
      icone: <PortraitDAgent portrait={m.portrait} couleur={m.couleur} nom={m.fiche.nom} taille={18} />,
    })),
  ];
  return (
    <div className="shrink-0 px-4 pb-4 pt-1 sm:px-7" data-champ-de-l-equipe={projectId}>
      <div className="rounded-2xl bg-surface px-4 pb-2.5 pt-3 shadow-sm ring-1 ring-faint/15">
        <textarea
          ref={zone}
          value={texte}
          rows={1}
          onChange={(e) => setTexte(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void envoyer();
            }
          }}
          placeholder={placeholder ?? (choisi ? t('Écrire à {v0}…', { v0: choisi.fiche.nom }) : t('Écrire à l’équipe…'))}
          className="block max-h-[200px] w-full resize-none bg-transparent text-[15px] leading-relaxed text-text outline-none placeholder:text-faint"
          data-texte-de-l-equipe=""
        />
        <div className="mt-2 flex items-center gap-2">
          <ListeDeroulante
            valeur={cible}
            options={options}
            onChoisir={setCible}
            titre={t('À qui écrire')}
            variante="discret"
            repere="cible-de-l-equipe"
            declencheur={(ouvrir) => (
              <button
                type="button"
                onClick={(e) => ouvrir(e)}
                className="inline-flex h-8 min-w-0 items-center gap-2 rounded-lg px-2 text-[13.5px] text-text transition-colors hover:bg-raised"
                data-cible-choisie={cible}
              >
                {choisi ? (
                  <PortraitDAgent portrait={choisi.portrait} couleur={choisi.couleur} nom={choisi.fiche.nom} taille={20} />
                ) : (
                  <PileDePortraits membres={membres.map((m) => ({ id: m.id, portrait: m.portrait, couleur: m.couleur, nom: m.fiche.nom }))} taille={20} max={3} fond="hsl(var(--surface))" />
                )}
                <span className="truncate">{choisi ? choisi.fiche.nom : t('Toute l’équipe')}</span>
                <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted" />
              </button>
            )}
          />
          <span className="flex-1" />
          <button
            type="button"
            onClick={() => void envoyer()}
            disabled={!texte.trim() || envoi}
            className={cn(
              'flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors disabled:opacity-40',
              texte.trim() ? 'bg-text text-bg' : 'bg-raised text-muted',
            )}
            aria-label="Envoyer"
            data-envoyer-a-l-equipe=""
          >
            {envoi ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}
