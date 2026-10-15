import * as React from 'react';
import { Rocket, Settings2 } from 'lucide-react';
import { explicationDuProcessus, pourquoiCeProcessus, type ProcessusDeProduction } from '@beluga/shared';
import { BulleInfo, Button, DialogTitle, Drawer } from '@/components/ui';
import { InterrupteurMiseEnProduction } from '@/components/interrupteur-mise-en-production';
import { GestesDePage } from '@/components/entete-de-zone';
import { useApp } from '@/lib/use-app';
import { estTelephone } from '@/lib/telephone';
import { ouvrirRubriqueDeLEtape } from '@/lib/ouvrir-config-projet';
import { t } from '@/lib/langue';

/**
 * LE TIROIR DE LA MISE EN PRODUCTION — refonte du 24/09/2026, allégée le
 * 29/09/2026.
 *
 * Le bandeau du bas ouvre ce tiroir pour LANCER une mise en production et en
 * SUIVRE le déroulé. La conversation avec l'agent de configuration n'y vit
 * plus : elle est dans la rubrique « Mise en production » des réglages du
 * projet, sous le processus qu'elle a écrit — le bouton de réglages de
 * l'entête, à droite de l'interrupteur, y mène. La petite flèche qui
 * refermait le tiroir a disparu : un clic à côté, ou le tirer vers le bas, le
 * referme.
 */
export function TiroirProcedureProduction({
  projectId,
  open,
  onClose,
  titre,
  actions,
  configuration,
  deroule,
  groupe = false,
  avant,
}: {
  projectId: string;
  open: boolean;
  onClose: () => void;
  titre?: string;
  /** Les petits boutons de l'entête (« ! »), à droite du bouton de réglages. */
  actions?: React.ReactNode;
  /** Le contenu du tiroir : l'explication et le bouton, ou le déroulé. */
  configuration: React.ReactNode;
  /** Un déroulé est affiché : il prend la hauteur pleine, sans zone qui défile autour. */
  deroule?: boolean;
  /**
   * LE TIROIR D'UN REGROUPEMENT : il liste ses projets membres et ne règle
   * rien lui-même — ni interrupteur, ni réglages, qui restent ceux de chaque
   * projet.
   */
  groupe?: boolean;
  /** Ce qui remplace la fusée de l'entête (le retour vers la liste des membres). */
  avant?: React.ReactNode;
}) {
  const state = useApp();
  const projet = state.projects.find((p) => p.id === projectId);
  return (
    <Drawer adresse="procedure-production" open={open} onClose={onClose} plein={deroule || estTelephone()} hauteurFixe feuille>
      <div className="flex min-h-0 flex-1 flex-col" data-tiroir-procedure-production={projectId}>
        {/* LE TITRE EST LE DERNIER CRAN DU FIL D'ARIANE (il y monte de lui-même),
            et SES GESTES MONTENT À DROITE DE LA BARRE D'EN-TÊTE (demande du
            11/10/2026) : la fusée et l'interrupteur de mise en production, les
            réglages, le bouton « ! ». Plus de rangée de boutons en tête de la
            page ; sur téléphone, où la barre n'a pas la place, `GestesDePage`
            les garde en tête du contenu. */}
        <DialogTitle className="min-w-0 truncate px-4">{titre ?? t('Mise en production')}</DialogTitle>
        <GestesDePage className="px-4">
          <div className="flex shrink-0 items-center gap-2" data-entete-tiroir-production>
            {avant ?? <Rocket className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden />}
            {groupe ? null : (
              <>
                {/* L'INTERRUPTEUR DE MISE EN PRODUCTION : éteint par défaut, il
                    grise le bouton du pied et le serveur refuse. */}
                <InterrupteurMiseEnProduction projectId={projectId} actif={projet?.miseEnProductionActive === true} />
                {/* LES RÉGLAGES, À DROITE DE L'INTERRUPTEUR : la rubrique où l'agent
                    de configuration écrit le processus, et où il se discute. Le
                    tiroir se referme d'abord — deux fenêtres modales ne s'empilent
                    pas. */}
                <Button
                  variant="ghost"
                  size="icon"
                  className="shrink-0 text-muted"
                  onClick={() => {
                    onClose();
                    ouvrirRubriqueDeLEtape(projectId, 'production');
                  }}
                  aria-label="Réglages de la mise en production"
                  title={t('Réglages de la mise en production')}
                  data-reglages-tiroir-production
                >
                  <Settings2 className="h-4 w-4" />
                </Button>
              </>
            )}
            {actions ? <div className="flex shrink-0 items-center gap-0.5">{actions}</div> : null}
          </div>
        </GestesDePage>

        <div className="flex min-h-0 flex-1 flex-col pt-2" data-contenu-tiroir-production>
          {configuration}
        </div>
      </div>
    </Drawer>
  );
}

/**
 * L'EXPLICATION DE LA CONFIGURATION, en tête de la page de mise en production :
 * POURQUOI ce processus, en deux phrases au plus (`pourquoiCeProcessus`, la
 * même règle que la rubrique des réglages), puis CE QUI SE PASSERA AU CLIC —
 * les étapes, en clair —, et le détail technique (les commandes), replié.
 *
 * Elle montrait le récit ENTIER de l'agent : sur un téléphone, plusieurs écrans
 * d'un journal de travail (« je vérifie maintenant… ») avant d'arriver au
 * bouton — relevé à la revue téléphone du 11/10/2026.
 */
export function ExplicationDeConfiguration({ processus }: { processus?: ProcessusDeProduction }) {
  const { repli } = explicationDuProcessus(processus);
  const pourquoi = pourquoiCeProcessus(processus);
  if (!processus?.etapes?.length) {
    return (
      <div className="flex flex-col gap-1.5 text-[13px] leading-snug" data-explication-configuration="absente">
        <p className="text-muted" data-procedure-absente="archived">
          {t('Ce projet n’a pas encore de processus de mise en production : rien ne peut partir tant qu’il n’est pas configuré.')}{' '}
          <span className="inline-flex align-middle" data-portee-etape="archived">
            <BulleInfo cote="start">
              {t('L’agent de configuration, dans les réglages du projet, étudie le projet, vous pose ses questions sur l’endroit qui accueille la production, puis écrit le processus que ce bouton suivra.')}
            </BulleInfo>
          </span>
        </p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3" data-explication-configuration={repli ? 'repli' : 'agent'}>
      {pourquoi ? (
        <p className="text-[13.5px] leading-relaxed text-muted" data-pourquoi-ce-processus>
          {pourquoi}
        </p>
      ) : null}
      <div>
        <p className="mb-1.5 text-[13.5px] font-medium text-text">{t('Ce qui se passera au clic')}</p>
        <ol className="flex flex-col gap-1 text-[13.5px] leading-snug text-text" data-etapes-en-clair>
          {processus.etapes.map((etape, rang) => (
            <li key={rang} className="flex gap-2">
              <span className="shrink-0 tabular-nums text-faint">{rang + 1}.</span>
              <span className="min-w-0">{etape.libelle}</span>
            </li>
          ))}
        </ol>
      </div>
      <details className="group rounded-md bg-raised/35 px-2.5 py-1.5" data-etapes-configuration={processus.etapes.length}>
        <summary className="cursor-pointer select-none text-[12.5px] text-muted">{t('Détail technique')}</summary>
        <ol className="mt-1.5 flex flex-col gap-1.5">
          {processus.etapes.map((etape, rang) => (
            <li key={rang} className="text-[12.5px] leading-snug">
              <span className="text-text">
                {rang + 1}. {etape.libelle}
              </span>
              <code className="mt-0.5 block whitespace-pre-wrap break-all font-mono text-[11.5px] text-faint">
                {etape.commande}
              </code>
            </li>
          ))}
        </ol>
      </details>
    </div>
  );
}
