import * as React from 'react';
import { Eye, ListChecks, Loader2, RefreshCw, Wrench, X } from '@/components/ui/icones';
import { construireFragment, resultatDeVerification, veilleAReparer, type Card, type IssueDeControle, type ResultatDeVerification, type ResumeDeVeille } from '@beluga/shared';
import { Button } from '@/components/ui';
import { CLASSES_BOUTON_DU_FIL } from '@/components/parcours-carte';
import { cn } from '@/lib/utils';
import { client } from '@/lib/client';
import { t, formatRegional } from '@/lib/langue';

/*
 * LA VEILLE D'UNE CARTE, À L'ÉCRAN (`shared/src/veille-de-carte.ts`).
 *
 * Une carte en veille attend un tiers : elle ne travaille pas, elle n'attend
 * pas non plus quelqu'un d'ici. Elle le DIT — ce qu'on attend, jusqu'à quand,
 * le dernier contrôle et le prochain — dans la bulle « i » du tableau
 * (`phraseDeLaVeille`, repère `data-veille`) et au-dessus du champ d'écriture
 * de sa conversation, avec deux gestes : vérifier maintenant, arrêter.
 * Aucun témoin orange : une veille n'est pas un travail en cours.
 *
 * Toutes les veilles de tous les projets se retrouvent dans le service
 * « Tâches récurrentes » (`taches-recurrentes.tsx`), qui reprend ces phrases.
 */

export function quandLisible(ms: number): string {
  return new Date(ms).toLocaleString(formatRegional(), { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function heureLisible(ms: number): string {
  return new Date(ms).toLocaleTimeString(formatRegional(), { hour: '2-digit', minute: '2-digit' });
}

export function issueLisible(issue: NonNullable<ResumeDeVeille['dernierControle']>['issue']): string {
  return issue === 'levee' ? t('blocage levé') : issue === 'pas-encore' ? t('pas encore') : t('contrôle en panne');
}

/**
 * LES HORAIRES DE LA VEILLE, sans sa raison : l'échéance, puis le dernier et
 * le prochain contrôle. C'est la seconde ligne du bandeau.
 */
export function horairesDeLaVeille(veille: ResumeDeVeille): string {
  if (veille.etat === 'attend_deploiement') return t('Démarrera après le déploiement de la carte');
  const morceaux = [
    veille.etat === 'expiree'
      ? t('échue le {date}', { date: quandLisible(veille.echeance) })
      : t('jusqu’au {date}', { date: quandLisible(veille.echeance) }),
  ];
  if (veille.dernierControle)
    morceaux.push(t('dernier contrôle {heure}, {issue}', { heure: heureLisible(veille.dernierControle.a), issue: issueLisible(veille.dernierControle.issue) }));
  if (veille.etat === 'en_cours' && veille.prochainControleA) morceaux.push(t('prochain {heure}', { heure: heureLisible(veille.prochainControleA) }));
  return morceaux.join(' · ');
}

/** La phrase de la veille, en une ligne : ce qu'on attend, l'échéance, les deux contrôles. */
export function phraseDeLaVeille(veille: ResumeDeVeille): string {
  if (veille.etat === 'attend_deploiement') return t('Veille après le déploiement : {raison}', { raison: veille.raison });
  const morceaux = [
    veille.etat === 'expiree'
      ? t('Veille échue : {raison}', { raison: veille.raison })
      : t('En veille jusqu’au {date} : {raison}', { date: quandLisible(veille.echeance), raison: veille.raison }),
  ];
  if (veille.dernierControle)
    morceaux.push(t('dernier contrôle {heure}, {issue}', { heure: heureLisible(veille.dernierControle.a), issue: issueLisible(veille.dernierControle.issue) }));
  if (veille.etat === 'en_cours' && veille.prochainControleA) morceaux.push(t('prochain {heure}', { heure: heureLisible(veille.prochainControleA) }));
  return morceaux.join(' · ');
}

/** Ouvre le service « Tâches récurrentes » sur le projet et le tiroir de cette veille. */
export function ouvrirLaVeilleDansLeService(projectId: string, veilleId: string): void {
  window.history.pushState(null, '', `#${construireFragment({ vue: 'taches-recurrentes', projectId, veilleId })}`);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

/**
 * LES GESTES D'UNE VEILLE, partagés par le bandeau et le tiroir du service.
 *
 * « Vérifier maintenant » LIT la réponse et la DIT (décision du 11/11/2026 :
 * les deux boutons grisaient puis revenaient sans rien montrer, et l'on croyait
 * le bouton cassé) : rien de nouveau, c'est arrivé, ou contrôle en panne avec
 * son détail. « Réparer » relance l'agent d'une veille en panne — seul ce clic
 * le fait travailler.
 */
export function useGestesDeVeille(cardId: string) {
  const [occupe, setOccupe] = React.useState<'verifier' | 'arreter' | 'reparer' | null>(null);
  const [resultat, setResultat] = React.useState<ResultatDeVerification | null>(null);
  const agir = React.useCallback(
    async (geste: 'verifier' | 'arreter' | 'reparer') => {
      setOccupe(geste);
      setResultat(null);
      try {
        if (geste === 'verifier') {
          const r = (await client.call({ type: 'card.veille.verifier', cardId })) as { issue?: IssueDeControle; detail?: string } | undefined;
          const lu = resultatDeVerification(r?.issue, r?.detail);
          /* Le résultat s'écrit SOUS la phrase de la veille (`ResultatDeVeille`), sans notification qui le redirait. */
          setResultat(lu);
        } else if (geste === 'reparer') {
          await client.call({ type: 'card.veille.reparer', cardId });
          client.pushToast('success', t('Demande envoyée : l’agent répare sa veille.'));
        } else {
          await client.call({ type: 'card.veille.arreter', cardId });
        }
      } catch (err) {
        client.pushToast('error', String((err as Error)?.message ?? err));
      } finally {
        setOccupe(null);
      }
    },
    [cardId],
  );
  return { occupe, agir, resultat };
}

/** Le résultat du dernier « Vérifier maintenant », sous la phrase de la veille. */
export function ResultatDeVeille({ resultat }: { resultat: ResultatDeVerification | null }) {
  if (!resultat) return null;
  return (
    <p className={cn('mt-1 break-words leading-snug', resultat.genre === 'error' ? 'text-danger' : 'text-text')} data-veille-resultat={resultat.genre} role="status">
      {t(resultat.texte)}
      {resultat.detail ? ` ${t('Détail : {detail}', { detail: resultat.detail })}` : null}
    </p>
  );
}

/** « Demander à l'agent de réparer » : seulement quand le DERNIER contrôle est en panne. */
export function BoutonDeReparation({
  veille,
  occupe,
  agir,
  className,
}: {
  veille: Pick<ResumeDeVeille, 'etat' | 'dernierControle'>;
  occupe: string | null;
  agir: (geste: 'reparer') => void;
  className?: string;
}) {
  if (!veilleAReparer(veille)) return null;
  return (
    <Button variant="ghost" size="sm" className={className} disabled={occupe !== null} onClick={() => agir('reparer')} data-veille-reparer>
      {occupe === 'reparer' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wrench className="h-3.5 w-3.5" />}
      <span className="min-w-0 truncate">{t('Demander à l’agent de réparer')}</span>
    </Button>
  );
}

/**
 * LE BANDEAU DE LA CONVERSATION. Il s'adapte à la LARGEUR QU'IL A, pas à celle
 * de l'écran : la conversation d'une carte peut être étroite sur un grand
 * écran. Le texte réserve au moins 16 rem avant de laisser une place aux
 * boutons ; en dessous, les boutons passent à la ligne et le texte garde toute
 * la largeur (capture du 22/10/2026 : le texte écrasé en colonne d'un mot,
 * quand les deux boutons prenaient tout).
 *
 * EN RANGÉE (`rangee`, demande du 24/10/2026) : la veille TIENT la rangée
 * d'action du pied (`veilleTientLaRangee`). Le bandeau ne garde que sa phrase,
 * et ses gestes descendent dans une rangée de la hauteur des boutons du fil —
 * à la place de « Reprendre / Terminer la tâche », jamais en plus.
 */
export function BandeauDeVeille({ carte, rangee = false }: { carte: Card; rangee?: boolean }) {
  const veille = carte.veille;
  const { occupe, agir, resultat } = useGestesDeVeille(carte.id);
  if (!veille || (veille.etat !== 'en_cours' && veille.etat !== 'expiree' && veille.etat !== 'attend_deploiement')) return null;
  const texte = (
    <div className="flex min-w-0 grow basis-64 items-start gap-2" data-bandeau-veille-texte>
      <Eye className="mt-[3px] h-3.5 w-3.5 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1 select-text">
        <p className="break-words text-[13px] leading-snug text-text">
          {veille.etat === 'expiree' ? t('Veille échue : {raison}', { raison: veille.raison }) : veille.raison}
        </p>
        <p className={cn('mt-0.5 break-words leading-snug', veilleAReparer(veille) ? 'text-danger' : 'text-faint')} data-veille-horaires>
          {horairesDeLaVeille(veille)}
        </p>
        <ResultatDeVeille resultat={resultat} />
      </div>
    </div>
  );
  if (rangee) {
    const classeBouton = cn(CLASSES_BOUTON_DU_FIL, 'flex-1 gap-1.5 px-2 bg-raised text-text hover:bg-fond-survol');
    return (
      <>
        <div className="mb-2 rounded-lg bg-raised px-3 py-2 text-xs text-muted" data-veille={veille.etat} data-bandeau-veille>
          {texte}
        </div>
        {veilleAReparer(veille) ? (
          <div className="mb-1.5 flex">
            <BoutonDeReparation veille={veille} occupe={occupe} agir={(g) => void agir(g)} className={classeBouton} />
          </div>
        ) : null}
        <div className="flex items-stretch gap-1.5" data-rangee-veille data-bandeau-veille-gestes>
          {veille.etat === 'en_cours' ? (
            <Button variant="ghost" size="sm" className={classeBouton} disabled={occupe !== null} onClick={() => void agir('verifier')} data-veille-verifier>
              {occupe === 'verifier' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              <span className="min-w-0 truncate">{t('Vérifier maintenant')}</span>
            </Button>
          ) : null}
          <Button variant="ghost" size="sm" className={classeBouton} disabled={occupe !== null} onClick={() => void agir('arreter')} data-veille-arreter>
            {occupe === 'arreter' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
            <span className="min-w-0 truncate">{t('Arrêter la veille')}</span>
          </Button>
          {/* À LA PLACE DE L'HORLOGE : le service où vit cette veille. */}
          <Button
            variant="ghost"
            size="sm"
            className="h-[43px] sm:h-9 w-[43px] sm:w-9 shrink-0 rounded-lg bg-raised p-0 text-text hover:bg-fond-survol"
            onClick={() => ouvrirLaVeilleDansLeService(carte.projectId, veille.id)}
            title={t('Voir dans Tâches planifiées')}
            aria-label="Voir dans Tâches planifiées"
            data-veille-service
          >
            <ListChecks className="h-3.5 w-3.5" />
          </Button>
        </div>
      </>
    );
  }
  return (
    <div
      className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg bg-raised px-3 py-2 text-xs text-muted"
      data-veille={veille.etat}
      data-bandeau-veille
    >
      {texte}
      <div className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-1" data-bandeau-veille-gestes>
        <BoutonDeReparation veille={veille} occupe={occupe} agir={(g) => void agir(g)} />
        {veille.etat === 'en_cours' ? (
          <Button variant="ghost" size="sm" disabled={occupe !== null} onClick={() => void agir('verifier')} data-veille-verifier>
            {occupe === 'verifier' ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
            {t('Vérifier maintenant')}
          </Button>
        ) : null}
        <Button variant="ghost" size="sm" disabled={occupe !== null} onClick={() => void agir('arreter')} data-veille-arreter>
          {occupe === 'arreter' ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
          {t('Arrêter la veille')}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="px-2"
          onClick={() => ouvrirLaVeilleDansLeService(carte.projectId, veille.id)}
          title={t('Voir dans Tâches planifiées')}
          aria-label="Voir dans Tâches planifiées"
          data-veille-service
        >
          <ListChecks className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
