/*
 * LA LIGNE DE PARCOURS EN BAS D'UN SERVICE (décision de l'utilisateur du 14/11/2026, maquettes #07c5 et #2e02) : la
 * campagne et l'étude Marketing montrent leur avancement comme un agent — dans le décroché collé au-dessus du champ
 * d'écriture, à la place de « Procédures précédentes ». L'étape en cours en violet avec son rang (« · 3 sur 6 ») et
 * son compte ; un clic déplie la liste des étapes, et une étape qui mène quelque part (Connexion, Réponses) s'ouvre.
 */
import * as React from 'react';
import { Check, ChevronUp } from '@/components/ui/icones';
import { t } from '@/lib/langue';
import { cn } from '@/lib/utils';

export interface EtapeDeLaLigne {
  cle: string;
  libelle: string;
  etat: 'fait' | 'ici' | 'a_faire';
  /** Ce qui se lit à côté (« 2 visuels sur 9 »). */
  detail?: string;
  /** L'étape mène à une page : un clic l'ouvre. */
  onAller?: () => void;
}

function Rond({ etat }: { etat: EtapeDeLaLigne['etat'] }) {
  if (etat === 'fait')
    return (
      <span className="flex h-[14px] w-[14px] shrink-0 items-center justify-center rounded-full bg-text text-bg">
        <Check className="h-2.5 w-2.5" strokeWidth={3} aria-hidden />
      </span>
    );
  if (etat === 'ici')
    return (
      <span className="flex h-[14px] w-[14px] shrink-0 items-center justify-center rounded-full border-[1.5px] border-teinte">
        <span className="h-1.5 w-1.5 rounded-full bg-teinte" />
      </span>
    );
  return <span className="h-[14px] w-[14px] shrink-0 rounded-full border-[1.5px] border-faint/50" />;
}

export function LigneDeParcours({ etapes, repere, extra }: { etapes: readonly EtapeDeLaLigne[]; repere: string; extra?: React.ReactNode }) {
  const [ouverte, setOuverte] = React.useState(false);
  const rangIci = etapes.findIndex((e) => e.etat === 'ici');
  const ici = rangIci >= 0 ? etapes[rangIci] : etapes[etapes.length - 1];
  const rang = rangIci >= 0 ? rangIci + 1 : etapes.length;
  if (!ici) return null;
  return (
    <div className="flex w-full min-w-0 flex-col" data-ligne-de-parcours={repere} data-etape-ici={ici.cle}>
      <button
        type="button"
        onClick={() => setOuverte((o) => !o)}
        aria-expanded={ouverte}
        className="flex w-full min-w-0 items-center gap-2 rounded py-0.5 text-left text-[13px]"
        data-ligne-de-parcours-bascule
      >
        <Rond etat={rangIci >= 0 ? 'ici' : 'fait'} />
        <span className={cn('shrink-0 font-medium', rangIci >= 0 ? 'text-teinte' : 'text-text')}>{ici.libelle}</span>
        <span className="shrink-0 text-faint">{t('· {v0} sur {v1}', { v0: rang, v1: etapes.length })}</span>
        {ici.detail ? <span className="min-w-0 truncate text-faint">— {ici.detail}</span> : null}
        <span className="flex-1" />
        <ChevronUp className={cn('h-3.5 w-3.5 shrink-0 text-muted transition-transform', !ouverte && 'rotate-180')} aria-hidden />
      </button>
      {ouverte ? (
        <ol className="pt-1" data-ligne-de-parcours-liste>
          {etapes.map((e) => {
            const contenu = (
              <>
                <Rond etat={e.etat} />
                <span className="min-w-0 truncate">{e.libelle}</span>
                {e.detail ? <span className="ml-auto shrink-0 pr-1 text-[12px] text-faint">{e.detail}</span> : null}
              </>
            );
            const classe = cn(
              'flex w-full min-w-0 items-center gap-2.5 rounded-md px-1 py-1 text-left text-[13px]',
              e.etat === 'fait' ? 'text-text' : e.etat === 'ici' ? 'bg-teinte/10 font-medium text-teinte' : 'text-faint',
              e.onAller && 'transition-colors hover:bg-raised',
            );
            return (
              <li key={e.cle} data-etape-de-parcours={e.cle} data-etat={e.etat}>
                {e.onAller ? (
                  <button type="button" className={classe} onClick={e.onAller}>
                    {contenu}
                  </button>
                ) : (
                  <div className={classe}>{contenu}</div>
                )}
              </li>
            );
          })}
          {extra}
        </ol>
      ) : null}
    </div>
  );
}
