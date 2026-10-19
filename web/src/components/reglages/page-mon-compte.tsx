import { FormulaireProfil } from '@/espace/formulaire-profil';
import { Groupe } from '@/components/reglages/communs';
import { AccesTiers } from '@/components/reglages/acces-tiers';
import { useApp } from '@/lib/use-app';
import { client } from '@/lib/client';
import { t } from '@/lib/langue';

/**
 * MON COMPTE : le profil de la personne connectée — nom affiché, courriel,
 * identifiant et mot de passe. C'est le MÊME formulaire que celui de l'espace
 * client, posé ici sur le canal principal : les commandes `espace.moi*` agissent
 * toujours sur le compte du canal, jamais sur un autre.
 */
const envoyerParLeCanalPrincipal = (cmd: any) => client.call(cmd);

export function PageMonCompte() {
  const state = useApp();
  return (
    <>
      <Groupe titre={t('Mon compte')}>
        <div className="-mx-3" data-page-mon-compte>
          <FormulaireProfil envoyer={envoyerParLeCanalPrincipal} remplirLaHauteur={false} />
        </div>
      </Groupe>
      {/* LES ACCÈS TIERS À BELUGA (ex-« Sous-comptes ») : l'administrateur seul les ouvre. */}
      {state.monRole === 'admin' ? <AccesTiers /> : null}
    </>
  );
}
