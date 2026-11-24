import { FormulaireProfil } from '@/espace/formulaire-profil';
import { Groupe } from '@/components/reglages/communs';
import { client } from '@/lib/client';
import { t } from '@/lib/langue';
import { Button } from '@/components/ui';
import { relancerLaVisite } from '@/components/visite-guidee';

/**
 * MON COMPTE : le profil de la personne connectée — nom affiché, courriel,
 * identifiant et mot de passe. C'est le MÊME formulaire que celui de l'espace
 * client, posé ici sur le canal principal : les commandes `espace.moi*` agissent
 * toujours sur le compte du canal, jamais sur un autre.
 *
 * Chaque partie est une section titrée à bloc gris (`enSections`), comme toutes
 * les pages des réglages. Les accès des AUTRES personnes (clients, équipe) ne
 * vivent plus ici : ils ont leur rubrique, « Accès » (24/11/2026).
 */
const envoyerParLeCanalPrincipal = (cmd: any) => client.call(cmd);

export function PageMonCompte() {
  return (
    <div className="flex flex-col gap-6">
      <div data-page-mon-compte>
        <FormulaireProfil envoyer={envoyerParLeCanalPrincipal} remplirLaHauteur={false} enSections />
      </div>
      {/* LA VISITE GUIDÉE (venue de l'ancienne page « Installation », 21/11/2026). */}
      <Groupe titre={t('La visite guidée')} description={t('Des bulles montrent où créer un projet, confier une demande, suivre le travail et publier.')}>
        <div className="flex" data-relancer-visite>
          <Button variant="subtle" size="sm" onClick={relancerLaVisite}>
            {t('Revoir la visite guidée')}
          </Button>
        </div>
      </Groupe>
    </div>
  );
}
