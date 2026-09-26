import * as React from 'react';
import {
  Database,
} from 'lucide-react';
import {
  BulleInfo,
  Button,
} from '@/components/ui';
import { PanneauALaDemande } from '@/lib/panneau-a-la-demande';
import { t } from '@/lib/langue';

/** Le tiroir d'export/import : un écran qu'on ouvre deux fois par an, donc un
 *  morceau à part, réclamé au premier clic et jamais au démarrage. */
const TiroirDonnees = React.lazy(() =>
  import('@/components/export-donnees').then((m) => ({ default: m.TiroirDonnees })),
);


/**
 * L'EXPORT ET L'IMPORT INTÉGRAL. Une sauvegarde répond à « la machine a brûlé,
 * on remonte la même » ; celui-ci répond à « j'installe Beluga Build ailleurs et je
 * veux y retrouver mes accès, mes projets et mes cartes ». Le tiroir se charge
 * À LA DEMANDE : c'est un écran qu'on ouvre deux fois par an.
 */
export function SectionExportDonnees() {
  const [ouvert, setOuvert] = React.useState(false);
  return (
    <section className="rounded-lg border border-border bg-bloc p-3">
      <h3 className="flex items-center gap-1.5 text-[13px] uppercase tracking-wide text-muted mb-2">
        <Database className="h-3.5 w-3.5 text-faint" />  {t('Export et import des données')}<BulleInfo cote="start">{t('Emporter le coffre-fort, les backups, les projets, les cartes, les conversations et les branches dans une seule archive — puis les remonter sur une autre installation.')}</BulleInfo></h3>
      <Button variant="subtle" size="sm" data-ouvrir-export-donnees onClick={() => setOuvert(true)}>
        <Database className="h-3 w-3" />
        {t('Ouvrir')}
      </Button>
      <PanneauALaDemande monte={ouvert}>
        <TiroirDonnees open={ouvert} onClose={() => setOuvert(false)} />
      </PanneauALaDemande>
    </section>
  );
}
