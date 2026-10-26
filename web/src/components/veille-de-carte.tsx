import * as React from 'react';
import { Eye, ListChecks, Loader2, RefreshCw, X } from 'lucide-react';
import { construireFragment, type Card, type ResumeDeVeille } from '@beluga/shared';
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

/** Les deux gestes d'une veille, partagés par le bandeau et le tiroir du service. */
export function useGestesDeVeille(cardId: string) {
  const [occupe, setOccupe] = React.useState<'verifier' | 'arreter' | null>(null);
  const agir = React.useCallback(
    async (geste: 'verifier' | 'arreter') => {
      setOccupe(geste);
      try {
        await client.call({ type: geste === 'verifier' ? 'card.veille.verifier' : 'card.veille.arreter', cardId });
      } catch (err) {
        client.pushToast('error', String((err as Error)?.message ?? err));
      } finally {
        setOccupe(null);
      }
    },
    [cardId],
  );
  return { occupe, agir };
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
  const { occupe, agir } = useGestesDeVeille(carte.id);
  if (!veille || (veille.etat !== 'en_cours' && veille.etat !== 'expiree')) return null;
  const texte = (
    <div className="flex min-w-0 grow basis-64 items-start gap-2" data-bandeau-veille-texte>
      <Eye className="mt-[3px] h-3.5 w-3.5 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1 select-text">
        <p className="break-words text-[13px] leading-snug text-text">
          {veille.etat === 'expiree' ? t('Veille échue : {raison}', { raison: veille.raison }) : veille.raison}
        </p>
        <p className="mt-0.5 break-words leading-snug text-faint">{horairesDeLaVeille(veille)}</p>
      </div>
    </div>
  );
  if (rangee) {
    const classeBouton = cn(CLASSES_BOUTON_DU_FIL, 'flex-1 gap-1.5 px-2 bg-raised text-text hover:bg-border');
    return (
      <>
        <div className="mb-2 rounded-lg bg-raised px-3 py-2 text-xs text-muted" data-veille={veille.etat} data-bandeau-veille>
          {texte}
        </div>
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
            className="h-[43px] sm:h-9 w-[43px] sm:w-9 shrink-0 rounded-lg bg-raised p-0 text-text hover:bg-border"
            onClick={() => ouvrirLaVeilleDansLeService(carte.projectId, veille.id)}
            title={t('Voir dans Tâches récurrentes')}
            aria-label="Voir dans Tâches récurrentes"
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
          title={t('Voir dans Tâches récurrentes')}
          aria-label="Voir dans Tâches récurrentes"
          data-veille-service
        >
          <ListChecks className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
