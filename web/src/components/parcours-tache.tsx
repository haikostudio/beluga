import * as React from 'react';
import { Check, ChevronDown, Loader2, Circle } from 'lucide-react';
import type { EtapeParcours } from '@haikodev/shared';
import { client } from '@/lib/client';
import { cn, duration, money } from '@/lib/utils';

/**
 * LE PARCOURS D'UNE TÂCHE, EN LIGNE DE TEMPS.
 *
 * L'onglet « Détails » empilait sept encadrés — réglages, préparation du chef,
 * jetons par agent, « Analyse initiale », « Exécution réelle », ventilation,
 * projection — qui disaient chacun une part de la même histoire, dans le
 * désordre, et dont deux comptaient les mêmes jetons deux fois. Il fallait
 * connaître le produit pour s'y retrouver.
 *
 * À la place, une seule lecture, de haut en bas : le tri par le chef
 * d'orchestre, l'autorisation, le travail, le déploiement, la mise en
 * production. Une pastille par étape (faite, en cours, à venir), et pour
 * chacune :
 *   — CE QU'ELLE EST ALLÉE CHERCHER, en français, une ligne par source ;
 *   — CE QU'ELLE A RÉELLEMENT CONSOMMÉ, pris dans la mesure du moteur.
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

/** Un nombre de jetons, lisible : « 12 400 ». */
function jetons(valeur: number): string {
  return valeur.toLocaleString('fr-CH');
}

/**
 * Une part de quota, en clair : « 2,4 % ». Sous un dixième de pour-cent, on ne
 * prétend pas à la décimale — « moins de 0,1 % » dit le vrai.
 */
function partQuota(part: number): string {
  if (part > 0 && part < 0.1) return 'moins de 0,1 %';
  return `${part.toLocaleString('fr-CH', { maximumFractionDigits: 1 })} %`;
}

/** La date d'une étape, courte : « 10 août, 14:05 ». */
function quandEnClair(instant?: number): string | null {
  if (!instant) return null;
  return new Date(instant).toLocaleString('fr-CH', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function ParcoursTache({ cardId }: { cardId: string }) {
  const [etapes, setEtapes] = React.useState<EtapeParcours[] | null>(null);
  const [total, setTotal] = React.useState<TotalParcours | null>(null);
  const [quota, setQuota] = React.useState<QuotaParcours | null>(null);

  React.useEffect(() => {
    let vivant = true;
    setEtapes(null);
    setTotal(null);
    setQuota(null);
    client
      .call({ type: 'card.parcours', cardId })
      .then((data) => {
        if (!vivant) return;
        setEtapes(data.etapes ?? []);
        setTotal(data.total ?? null);
        setQuota(data.quota ?? null);
      })
      .catch(() => {});
    return () => {
      vivant = false;
    };
  }, [cardId]);
  // Rien à zéro : une carte sans relevé n'affiche pas deux zéros trompeurs.
  const quotaVu = quota && (quota.quota5h > 0 || quota.quotaSemaine > 0) ? quota : null;

  if (!etapes || !etapes.length) return null;

  return (
    <section data-parcours-tache className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="text-[14px] font-semibold text-text">Le parcours de cette tâche</h3>
        {total ? (
          <p className="text-[12.5px] text-faint">
            <span className="font-medium text-text">{jetons(total.total)} jetons</span> réellement mesurés
            {total.cout !== undefined ? <> · {money(total.cout)}</> : null} · {total.tours}{' '}
            {total.tours === 1 ? 'tour' : 'tours'} de moteur
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
          {total.etapesSansMesure === 1
            ? 'Une étape n’a pas de mesure rattachée : elle le dit sur sa ligne.'
            : `${total.etapesSansMesure} étapes n’ont pas de mesure rattachée : chacune le dit sur sa ligne.`}{' '}
          Le total ci-dessus ne les compte donc pas.
        </p>
      ) : null}

      {/* La part de quota RÉELLEMENT consommée par cette carte — jamais une
          projection : ce sont les mêmes relevés que la fenêtre des quotas,
          additionnés sur les tours de cette carte. Bloc à part, sous le
          parcours, pour ne jamais se lire comme une des étapes ci-dessus. */}
      {quotaVu ? (
        <div
          className="rounded-lg border border-border bg-surface px-3 py-2"
          data-quota-reel-parcours
        >
          <p className="text-[12px] font-medium uppercase tracking-wide text-faint">
            Part de quota réellement consommée
          </p>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
            <Part nom="Fenêtre de 5 h" valeur={partQuota(quotaVu.quota5h)} />
            <Part nom="Fenêtre de la semaine" valeur={partQuota(quotaVu.quotaSemaine)} />
          </div>
        </div>
      ) : null}
    </section>
  );
}

/**
 * Une étape : sa pastille, son titre, sa mesure sur la même ligne. Le détail —
 * ce qu'elle est allée chercher, le découpage des jetons — se déplie, replié par
 * défaut : c'est ce qui rend la ligne de temps lisible d'un coup d'œil.
 */
function Etape({ etape }: { etape: EtapeParcours }) {
  const [ouvert, setOuvert] = React.useState(false);
  const quand = quandEnClair(etape.quand);
  const aDuDetail = etape.cherche.length > 0 || !!etape.mesure || !!etape.sansMesure;

  return (
    <li className="relative" data-etape={etape.cle} data-etat={etape.etat}>
      <Pastille etat={etape.etat} />

      <div
        className={cn(
          'rounded-lg border px-3 py-2 transition-colors',
          etape.etat === 'a-venir' ? 'border-border/60 bg-surface/50' : 'border-border bg-surface',
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

            {/* La mesure sur la LIGNE : c'est le chiffre qu'on vient chercher,
                il ne doit pas se mériter par un clic. */}
            <div className="mt-0.5 text-[12.5px]">
              {etape.mesure ? (
                <span className="text-text">
                  <span className="font-medium">{jetons(etape.mesure.total ?? 0)} jetons</span>
                  {etape.mesure.cout !== undefined ? (
                    <span className="text-faint"> · {money(etape.mesure.cout)}</span>
                  ) : null}
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
                <p className="text-[11.5px] uppercase tracking-wide text-faint">Ce qu’elle est allée chercher</p>
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

            {etape.mesure ? (
              <div>
                <p className="text-[11.5px] uppercase tracking-wide text-faint">Jetons réellement mesurés</p>
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[12.5px]">
                  <Part nom="Entrée hors cache" valeur={jetons(etape.mesure.entree)} />
                  <Part
                    nom="Relu du cache"
                    valeur={etape.mesure.cache === undefined ? 'non communiqué' : jetons(etape.mesure.cache)}
                  />
                  <Part nom="Sortie" valeur={jetons(etape.mesure.sortie)} />
                </div>
                {etape.mesure.cout === undefined ? (
                  <p className="mt-1 text-[12px] text-faint">
                    Coût en francs indisponible : le tarif d’un des modèles employés n’est pas connu.
                  </p>
                ) : null}
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
      <span className={cn(commun, 'bg-success/20 text-success')} aria-label="étape terminée">
        <Check className="h-3 w-3" />
      </span>
    );
  }
  if (etat === 'en-cours') {
    return (
      <span className={cn(commun, 'bg-info/20 text-info')} aria-label="étape en cours">
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
