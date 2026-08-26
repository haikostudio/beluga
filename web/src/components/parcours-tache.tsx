import * as React from 'react';
import { Check, ChevronDown, Loader2, Circle } from 'lucide-react';
import type { EtapeParcours } from '@haikodev/shared';
import { chronologieContexteEnvoye } from '@haikodev/shared';
import { client } from '@/lib/client';
import { useChargementOnglet } from '@/lib/chargement-onglet';
import { useApp } from '@/lib/use-app';
import { cn, duration, money } from '@/lib/utils';
import { LecteurPrompt } from '@/components/lecteur-prompt';
import { Button } from '@/components/ui';
import { t, formatRegional } from '@/lib/langue';

/**
 * LE PARCOURS D'UNE TÂCHE, EN LIGNE DE TEMPS.
 *
 * L'onglet « Détails » empilait sept encadrés — réglages, préparation de la carte,
 * jetons par agent, « Analyse initiale », « Exécution réelle », ventilation,
 * projection — qui disaient chacun une part de la même histoire, dans le
 * désordre, et dont deux comptaient les mêmes jetons deux fois. Il fallait
 * connaître le produit pour s'y retrouver.
 *
 * À la place, une seule lecture, de haut en bas : la proposition de la carte,
 * l'autorisation, le travail, le déploiement, la mise en production. Une pastille par étape (faite, en cours, à venir), et pour
 * chacune :
 *   — CE QU'ELLE EST ALLÉE CHERCHER, en français, une ligne par source ;
 *   — CE QU'ELLE A RÉELLEMENT CONSOMMÉ, en durée et en francs — jamais un
 *     compteur de jetons.
 *
 * Sous la ligne de temps, le LECTEUR DE PROMPTS (le même que le tiroir
 * « Contexte envoyé ») montre le texte réellement envoyé, tour par
 * tour, pour tous les agents de la carte — c'est la seule façon de lire un
 * prompt dans toute l'application.
 *
 * Ce composant ne CALCULE rien : les étapes viennent de `card.parcours`, dont
 * la règle vit dans `shared/src/parcours-carte.ts`. Une étape sans mesure
 * affiche la RAISON de son absence, jamais un zéro : une estimation déguisée en
 * chiffre est pire qu'un trou avoué.
 */

interface TotalParcours {
  total: number;
  tours: number;
  cout?: number;
  etapesMesurees: number;
  etapesSansMesure: number;
}

interface QuotaParcours {
  quota5h: number;
  quotaSemaine: number;
}

/**
 * Une part de quota, en clair : « 2,4 % ». Sous un dixième de pour-cent, on ne
 * prétend pas à la décimale — « moins de 0,1 % » dit le vrai.
 */
function partQuota(part: number): string {
  if (part > 0 && part < 0.1) return t('moins de 0,1 %');
  return `${part.toLocaleString(formatRegional(), { maximumFractionDigits: 1 })} %`;
}

/** La date d'une étape, courte : « 10 août, 14:05 ». */
function quandEnClair(instant?: number): string | null {
  if (!instant) return null;
  return new Date(instant).toLocaleString(formatRegional(), {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Où en est la carte dans le pool de compétences, et pourquoi. */
interface Capitalisation {
  etat: 'sans-preuve' | 'candidate' | 'mure' | 'publiee';
  raison: string;
}

export function ParcoursTache({ cardId }: { cardId: string }) {
  const [etapes, setEtapes] = React.useState<EtapeParcours[] | null>(null);
  const [total, setTotal] = React.useState<TotalParcours | null>(null);
  const [quota, setQuota] = React.useState<QuotaParcours | null>(null);
  const [capitalisation, setCapitalisation] = React.useState<Capitalisation | null>(null);
  const state = useApp();

  /* Tant que le parcours n'est pas arrivé, l'onglet « Détails » le DIT : sans
     ce mot, on ne sait pas si la carte n'a rien à montrer ou si ça charge. */
  const [charge, setCharge] = React.useState(true);
  useChargementOnglet('details', charge);

  React.useEffect(() => {
    let vivant = true;
    setEtapes(null);
    setTotal(null);
    setQuota(null);
    setCapitalisation(null);
    setCharge(true);
    client
      .call({ type: 'card.parcours', cardId })
      .then((data) => {
        if (!vivant) return;
        setEtapes(data.etapes ?? []);
        setTotal(data.total ?? null);
        setQuota(data.quota ?? null);
        setCapitalisation(data.capitalisation ?? null);
      })
      .catch(() => {})
      .finally(() => {
        if (vivant) setCharge(false);
      });
    return () => {
      vivant = false;
    };
  }, [cardId]);

  // Le lecteur de prompts a besoin des messages de TOUS les agents de la
  // carte : la même requête que l'onglet « Conversation », rejouée ici pour
  // que le volet « Détails » se lise seul, sans dépendre d'un autre onglet.
  React.useEffect(() => {
    client.send({ type: 'card.conversation', cardId });
  }, [cardId]);
  const messagesDeLaCarte = state.cardMessages[cardId]?.messages ?? [];
  const tours = React.useMemo(() => chronologieContexteEnvoye(messagesDeLaCarte), [messagesDeLaCarte]);

  // Rien à zéro : une carte sans relevé n'affiche pas deux zéros trompeurs.
  const quotaVu = quota && (quota.quota5h > 0 || quota.quotaSemaine > 0) ? quota : null;

  if (!etapes || !etapes.length) return null;

  return (
    <section data-parcours-tache className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="text-[14px] font-semibold text-text">{t('Le parcours de cette tâche')}</h3>
        {total ? (
          <p className="text-[12.5px] text-faint">
            {total.cout !== undefined ? <span className="font-medium text-text">{money(total.cout)}</span> : null}
            {total.cout !== undefined ? ' · ' : null}
            {total.tours} {total.tours === 1 ? 'tour' : 'tours'}  {t('de moteur réellement mesurés')}
</p>
        ) : null}
      </div>

      {/* Le trait vertical relie les étapes : c'est lui qui fait lire l'ensemble
          comme un chemin, et non comme une pile d'encadrés indépendants. */}
      <ol className="relative space-y-1.5 pl-[26px] before:absolute before:bottom-3 before:left-[9px] before:top-3 before:w-px before:bg-border">
        {etapes.map((etape, rang) => (
          <Etape key={`${etape.cle}-${rang}`} etape={etape} />
        ))}
      </ol>

      {total && total.etapesSansMesure ? (
        <p className="text-[12.5px] text-faint">
          {t('{v0}{v1} Le total ci-dessus ne les compte donc pas.', { v0: total.etapesSansMesure === 1
            ? 'Une étape n’a pas de mesure rattachée : elle le dit sur sa ligne.'
            : `${total.etapesSansMesure} étapes n’ont pas de mesure rattachée : chacune le dit sur sa ligne.`, v1: ' ' })}</p>
      ) : null}

      {/* La part de quota RÉELLEMENT consommée par cette carte — jamais une
          projection : ce sont les mêmes relevés que la fenêtre des quotas,
          additionnés sur les tours de cette carte. Bloc à part, sous le
          parcours, pour ne jamais se lire comme une des étapes ci-dessus. */}
      {quotaVu ? (
        <div
          className="rounded-lg border border-border bg-raised px-3 py-2"
          data-quota-reel-parcours
        >
          <p className="text-[12px] font-medium uppercase tracking-wide text-faint">
            {t('Part de quota réellement consommée')}</p>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
            <Part nom={t('Fenêtre de 5 h')} valeur={partQuota(quotaVu.quota5h)} />
            <Part nom={t('Fenêtre de la semaine')} valeur={partQuota(quotaVu.quotaSemaine)} />
          </div>
        </div>
      ) : null}

      {/* CE QUE CETTE CARTE A APPRIS AU POOL — et, si elle n'a rien appris,
          POURQUOI. Trois états : candidate (les contrôles sont passés),
          mûre (elle a tenu sept jours en production), publiée (une compétence
          en est née). Le bouton saute l'ATTENTE, jamais les contrôles. */}
      {capitalisation ? <BlocDeCapitalisation cardId={cardId} etat={capitalisation} /> : null}

      {/* LE LECTEUR DE PROMPTS : le texte réellement envoyé, tour par tour,
          pour tous les agents de la carte — la même lecture que le tiroir
          « Contexte envoyé ». */}
      {tours.length ? (
        <div data-prompts-de-la-carte>
          <h3 className="mb-1.5 text-[14px] font-semibold text-text">{t('Prompts envoyés')}</h3>
          <LecteurPrompt tours={tours} />
        </div>
      ) : null}
    </section>
  );
}

/**
 * LA LEÇON DE CETTE CARTE, ET SON ÉTAT. Une carte qui n'a rien donné au pool
 * partagé DIT pourquoi : contrôles jamais rejoués, jamais mise en production,
 * contredite par une carte plus récente, ou simplement pas encore mûre.
 *
 * Le bouton ne force que l'ATTENTE de sept jours : les contrôles du projet
 * doivent avoir été rejoués, et la fiche écrite passe le même contrôle de
 * qualité que celles de la nuit. Il ne s'affiche donc que sur une carte mûre.
 */
function BlocDeCapitalisation({ cardId, etat }: { cardId: string; etat: Capitalisation }) {
  const libelles: Record<Capitalisation['etat'], string> = {
    'sans-preuve': t('Rien n’est capitalisé'),
    candidate: 'Candidate',
    mure: t('Mûre'),
    publiee: t('Publiée dans le pool'),
  };
  return (
    <div className="rounded-lg border border-border bg-raised px-3 py-2" data-capitalisation={etat.etat}>
      <p className="text-[12px] font-medium uppercase tracking-wide text-faint">{t('Compétences partagées')}</p>
      <p className="mt-1 text-[13px] text-text">{libelles[etat.etat]}</p>
      <p className="mt-0.5 text-[12.5px] leading-relaxed text-faint">{etat.raison}</p>
      {etat.etat === 'candidate' || etat.etat === 'mure' ? (
        <Button
          className="mt-1.5"
          variant="secondary"
          size="sm"
          onClick={() =>
            client
              .call({ type: 'card.capitaliser', cardId })
              .then(() => client.pushToast('success', t('Capitalisation lancée : un agent relit cette carte.')))
              .catch((err: any) => {
                client.pushToast('error', err?.message ?? 'capitalisation impossible');
                // L'erreur est RELANCÉE : sans cela le bouton croirait avoir réussi.
                throw err;
              })
          }
        >
          {t('Capitaliser maintenant')}</Button>
      ) : null}
    </div>
  );
}

/**
 * Une étape : sa pastille, son titre, sa mesure sur la même ligne. Le détail —
 * ce qu'elle est allée chercher — se déplie, replié par défaut : c'est ce qui
 * rend la ligne de temps lisible d'un coup d'œil.
 */
function Etape({ etape }: { etape: EtapeParcours }) {
  const [ouvert, setOuvert] = React.useState(false);
  const quand = quandEnClair(etape.quand);
  const aDuDetail = etape.cherche.length > 0;

  return (
    <li className="relative" data-etape={etape.cle} data-etat={etape.etat}>
      <Pastille etat={etape.etat} />

      <div
        className={cn(
          'rounded-lg border px-3 py-2 transition-colors',
          etape.etat === 'a-venir' ? 'border-border/60 bg-raised/50' : 'border-border bg-raised',
        )}
      >
        <button
          type="button"
          className="flex w-full items-start gap-2 text-left"
          aria-expanded={ouvert}
          onClick={() => aDuDetail && setOuvert((v) => !v)}
        >
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span
                className={cn(
                  'text-[13.5px] font-semibold',
                  etape.etat === 'a-venir' ? 'text-faint' : 'text-text',
                )}
              >
                {etape.titre}
              </span>
              {quand ? <span className="text-[12px] text-faint">{quand}</span> : null}
            </div>

            {/* La mesure sur la LIGNE, en durée et en francs — jamais un
                compteur de jetons : c'est le repère utile sans se mériter par
                un clic. */}
            <div className="mt-0.5 text-[12.5px]">
              {etape.mesure ? (
                <span className="text-text">
                  {etape.mesure.cout !== undefined ? (
                    <span className="font-medium">{money(etape.mesure.cout)}</span>
                  ) : (
                    <span className="text-faint">{t('coût en francs indisponible')}</span>
                  )}
                  <span className="text-faint">
                    {' '}
                    · {etape.mesure.tours} {etape.mesure.tours === 1 ? 'tour' : 'tours'}
                    {etape.mesure.secondes ? ` · ${duration(etape.mesure.secondes)}` : ''}
                  </span>
                </span>
              ) : (
                <span className="text-faint">{etape.sansMesure}</span>
              )}
            </div>
          </div>

          {aDuDetail ? (
            <ChevronDown
              className={cn('mt-0.5 h-3.5 w-3.5 shrink-0 text-faint transition-transform', ouvert && 'rotate-180')}
              aria-hidden="true"
            />
          ) : null}
        </button>

        {ouvert ? (
          <div className="mt-2 space-y-2 border-t border-border pt-2" data-detail-etape>
            <p className="text-[12.5px] leading-relaxed text-faint">{etape.quoi}</p>

            {etape.cherche.length ? (
              <div>
                <p className="text-[11.5px] uppercase tracking-wide text-faint">{t('Ce qu’elle est allée chercher')}</p>
                <ul className="mt-1 space-y-0.5 text-[12.5px] text-text">
                  {etape.cherche.map((ligne) => (
                    <li key={ligne} className="flex gap-1.5">
                      <span className="text-faint" aria-hidden="true">
                        ·
                      </span>
                      <span>{ligne}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </li>
  );
}

/** La pastille d'état, posée sur le trait : faite, en cours, à venir. */
function Pastille({ etat }: { etat: EtapeParcours['etat'] }) {
  const commun = 'absolute -left-[26px] top-3 flex h-[19px] w-[19px] items-center justify-center rounded-full';
  if (etat === 'faite') {
    return (
      <span className={cn(commun, 'bg-termine/20 text-termine')} aria-label="étape terminée">
        <Check className="h-3 w-3" />
      </span>
    );
  }
  if (etat === 'en-cours') {
    return (
      <span className={cn(commun, 'bg-en-cours/20 text-en-cours')} aria-label="étape en cours">
        <Loader2 className="h-3 w-3 animate-spin" />
      </span>
    );
  }
  return (
    <span className={cn(commun, 'bg-raised text-faint')} aria-label="étape à venir">
      <Circle className="h-2 w-2" />
    </span>
  );
}

function Part({ nom, valeur }: { nom: string; valeur: string }) {
  return (
    <span className="flex items-baseline gap-1">
      <span className="text-faint">{nom}</span>
      <span className="font-medium text-text">{valeur}</span>
    </span>
  );
}
