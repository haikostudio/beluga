/**
 * LA FRISE D'UNE DEMANDE — OÙ EN EST LE TRAVAIL, D'UN COUP D'ŒIL.
 *
 * Décision de l'utilisateur (cadrage du 24/11/2026, maquette #93cf) : l'état de la tâche bien visible, en tête de sa
 * fiche. Quatre étapes — Reçue, En cours, À vérifier (ou Validée), En ligne — puis une phrase datée en mots courants.
 * L'étape se calcule par une règle pure (`suiviDeLaDemande`, `shared/src/suivi-de-demande.ts`) à partir de la colonne
 * et de l'avancement de la carte liée : rien de neuf n'est stocké.
 *
 * MONOCHROME (charte, règle 14) : les étapes passées sont cochées en gris, l'étape actuelle se pose sur un fond
 * `raised`, celles à venir restent pâles. Les traits de liaison suivent `--faint` (règle 16), en pointillé vers ce
 * qui n'est pas encore atteint. Sur téléphone, seules les icônes des autres étapes restent : l'étape actuelle garde
 * son nom, et rien ne déborde.
 */
import * as React from 'react';
import { Circle, CircleCheck, CircleDot } from '@/components/ui/icones';
import { cn } from '@/lib/utils';
import { t } from '@/lib/langue';
import { ETAPES_DE_DEMANDE, suiviDeLaDemande, type ActiviteDemande, type Demande, type SuiviDeDemande } from '@beluga/shared';
import { jourDe } from './formats';

function phraseDuSuivi(suivi: SuiviDeDemande, aUneVersionDeTravail: boolean): string {
  const date = jourDe(suivi.depuis);
  switch (suivi.etape) {
    case 'recue':
      return t('Reçue le {date}.', { date });
    case 'en-cours':
      return t('En cours depuis le {date}.', { date });
    case 'a-verifier':
      if (suivi.validee) return t('Validée le {date}.', { date });
      return aUneVersionDeTravail
        ? t('Travail terminé le {date} · à vérifier sur la version de travail avant la mise en ligne.', { date })
        : t('Travail terminé le {date}.', { date });
    case 'en-ligne':
      return t('En ligne depuis le {date}.', { date });
  }
}

export function FriseDeDemande({
  demande,
  activite,
  aUneVersionDeTravail,
}: {
  demande: Pick<Demande, 'colonne' | 'creeeLe'>;
  activite: readonly ActiviteDemande[];
  /** Le projet a une version de travail : la phrase dit où vérifier. */
  aUneVersionDeTravail: boolean;
}) {
  const suivi = suiviDeLaDemande(demande, activite);
  const rangActuel = ETAPES_DE_DEMANDE.indexOf(suivi.etape);
  const libelles: Record<(typeof ETAPES_DE_DEMANDE)[number], string> = {
    recue: t('Reçue'),
    'en-cours': t('En cours'),
    'a-verifier': suivi.validee ? t('Validée') : t('À vérifier'),
    'en-ligne': t('En ligne'),
  };

  return (
    <div className="min-w-0" data-frise-demande data-etape={suivi.etape} data-validee={suivi.validee ? '' : undefined}>
      <ol className="flex min-w-0 items-center" aria-label="Avancement de la demande">
        {ETAPES_DE_DEMANDE.map((etape, rang) => {
          const passee = rang < rangActuel;
          const actuelle = rang === rangActuel;
          /* L'étape actuelle est COCHÉE quand elle est un aboutissement : validée, ou en ligne. */
          const aboutie = actuelle && (etape === 'en-ligne' || (etape === 'a-verifier' && suivi.validee));
          const Icone = passee || aboutie ? CircleCheck : actuelle ? CircleDot : Circle;
          return (
            <React.Fragment key={etape}>
              {rang > 0 ? (
                <li
                  aria-hidden
                  className={cn(
                    'mx-1.5 h-0 min-w-3 flex-1 border-t sm:mx-2',
                    rang <= rangActuel ? 'border-solid border-faint' : 'border-dashed border-faint/70',
                  )}
                  data-trait-frise={rang <= rangActuel ? 'atteint' : 'a-venir'}
                />
              ) : null}
              <li
                className={cn(
                  'flex shrink-0 items-center gap-1.5 whitespace-nowrap text-[13px]',
                  actuelle ? 'rounded-full bg-raised px-2.5 py-1 font-medium text-text' : passee ? 'text-muted' : 'text-faint',
                )}
                aria-current={actuelle ? 'step' : undefined}
                title={libelles[etape]}
                data-etape-frise={etape}
                data-etape-etat={actuelle ? 'actuelle' : passee ? 'passee' : 'a-venir'}
              >
                <Icone className="h-4 w-4 shrink-0" aria-hidden />
                <span className={cn(actuelle ? null : 'max-sm:sr-only')}>{libelles[etape]}</span>
              </li>
            </React.Fragment>
          );
        })}
      </ol>
      <p className="mt-2 text-[12.5px] leading-relaxed text-muted" data-phrase-frise>
        {phraseDuSuivi(suivi, aUneVersionDeTravail)}
      </p>
    </div>
  );
}
