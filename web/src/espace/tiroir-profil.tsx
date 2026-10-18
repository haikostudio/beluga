/**
 * MON PROFIL, DANS L'ESPACE CLIENT : le tiroir qui pose le formulaire partagé
 * (`formulaire-profil.tsx`) sur le canal court de l'espace.
 *
 * Les règles de la fiche — aucune commande ne nomme un compte, l'identifiant et
 * le mot de passe exigent le mot de passe actuel, sans cadre ni trait — vivent
 * avec le formulaire, que les réglages de l'application principale réutilisent.
 */
import { X } from 'lucide-react';
import { Button, DialogTitle, Drawer } from '@/components/ui';
import { t } from '@/lib/langue';
import { useTelephone } from '@/lib/telephone';
import { canalEspace } from './canal-espace';
import { FormulaireProfil } from './formulaire-profil';

const envoyerParLeCanalCourt = (cmd: any) => canalEspace.demander(cmd);

export function TiroirProfil({ onFermer }: { onFermer: () => void }) {
  const telephone = useTelephone();
  return (
    <Drawer adresse="profil" open onClose={onFermer} plein={telephone}>
      <div className="flex min-h-0 flex-1 flex-col" data-tiroir-profil>
        <header className="flex shrink-0 items-center gap-1.5 px-3 pb-2">
          <DialogTitle className="min-w-0 flex-1 truncate">{t('Mon profil')}</DialogTitle>
          <Button size="icon-sm" variant="ghost" onClick={onFermer} title={t('Fermer')} data-fermer-profil>
            <X className="h-4 w-4" />
          </Button>
        </header>
        <FormulaireProfil envoyer={envoyerParLeCanalCourt} />
      </div>
    </Drawer>
  );
}
