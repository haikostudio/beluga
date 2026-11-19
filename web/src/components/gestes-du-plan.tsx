import { nomDuPlanExporte, planAEmporter, type Card, type PlanDeCarte } from '@beluga/shared';
import { Download, FileText, FileType, Loader2 } from '@/components/ui/icones';
import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui';
import { BoutonCopierDocument } from '@/components/bouton-copier-document';
import { useTelechargement } from '@/lib/telechargement';
import { t } from '@/lib/langue';

/**
 * COPIER ET TÉLÉCHARGER LE PLAN, en haut à droite de son volet (18/11/2026) :
 * les deux mêmes gestes que le cahier des charges. La copie emporte le
 * markdown que l'écran affiche ; le téléchargement est fabriqué par le démon
 * (`/api/cartes/plan`), en PDF ou en texte.
 */
export function GestesDuPlan({ carte, plan }: { carte: Card; plan: PlanDeCarte }) {
  const adresse = (format: 'pdf' | 'md') =>
    `/api/cartes/plan?carte=${encodeURIComponent(carte.id)}&version=${plan.numero}&format=${format}`;
  const pdf = useTelechargement([{ adresse: adresse('pdf'), nom: nomDuPlanExporte(plan.numero, carte.title, 'pdf') }]);
  const md = useTelechargement([{ adresse: adresse('md'), nom: nomDuPlanExporte(plan.numero, carte.title, 'md') }]);
  const enRoute = pdf.etat === 'reception' || md.etat === 'reception';
  return (
    <>
      <BoutonCopierDocument texte={planAEmporter(plan.texte)} repere="data-plan-copier" />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="icon"
            variant="ghost"
            className="shrink-0"
            title={t('Télécharger le plan')}
            aria-label="Télécharger le plan"
            data-plan-exporter
          >
            {enRoute ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => pdf.lancer()} data-plan-export="pdf">
            <FileType className="h-4 w-4" />
            {t('PDF')}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => md.lancer()} data-plan-export="md">
            <FileText className="h-4 w-4" />
            {t('Texte (Markdown)')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
