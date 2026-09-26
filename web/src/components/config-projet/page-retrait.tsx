import { Archive } from 'lucide-react';
import { BulleInfo, Button } from '@/components/ui';
import { t } from '@/lib/langue';
import { TeteDeRubrique, type ContexteConfig } from './communs';

/**
 * LE SEUL GESTE QUI RETIRE UN PROJET : LE METTRE DE CÔTÉ.
 *
 * Il a sa rubrique à lui, en bas du menu et derrière un trait, loin de
 * « Enregistrer ». Il n'y a plus de bouton « Effacer » : le 22/09/2026, il a
 * détruit d'un clic un projet entier (cartes, conversations, historique des
 * mises en ligne), reconstruit ensuite depuis la sauvegarde de nuit. Mettre de
 * côté ne perd rien, et se défait d'un clic.
 */
export function RubriqueRetrait({ ctx }: { ctx: ContexteConfig }) {
  return (
    <div data-rubrique-contenu="retrait" className="space-y-3">
      <TeteDeRubrique titre={t('Mettre de côté')} resume={t('Retirer ce projet de la colonne de gauche, sans rien perdre.')} />

      <div className="rounded-md border border-border bg-bloc px-3 py-2.5">
        <p className="flex items-center gap-1 text-[13.5px] font-medium text-text">
          {ctx.project.archived ? t('Remettre en service') : t('Mettre de côté')}
          <BulleInfo cote="start">{ctx.project.archived
            ? t('Le projet revient dans la colonne de gauche, avec son tableau et ses conversations.')
            : t('Le projet quitte la colonne de gauche sans rien perdre : son tableau, ses cartes et ses conversations restent, et il se remet en service quand vous voulez.')}</BulleInfo>
        </p>
        <Button variant="subtle" size="sm" className="mt-2" data-archiver-projet onClick={ctx.archiver}>
          <Archive className="h-3 w-3" />
          {ctx.project.archived ? t('Remettre en service') : t('Mettre de côté')}
        </Button>
      </div>
    </div>
  );
}
