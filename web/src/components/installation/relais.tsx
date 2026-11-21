import * as React from 'react';
import { ChoixEnLignes, useIdentite } from '@/components/installation/sections';
import { t } from '@/lib/langue';

/**
 * L'ÉQUIPE BELUGA, VUE D'UNE INSTALLATION (`server/src/relais-installations.ts`).
 *
 * Deux choses, décidées par l'utilisateur le 20/10/2026 :
 *  - L'ACCORD : chaque installation se signale une fois par jour (numéro,
 *    version, pays) ; l'adresse de l'administrateur n'y part QUE s'il dit oui.
 *  - LES TICKETS ont disparu avec la version gratuite (21/11/2026) : le support
 *    passe par l'espace client de l'offre hébergée.
 * Rien de cela n'existe sur la machine de l'auteur ni sur un démon d'essai sans
 * relais : l'état du relais (`/api/relais/etat`) le dit.
 */

export interface EtatDuRelais {
  joint: boolean;
  recepteur: boolean;
  hebergee: boolean;
  dernierSigne?: number;
  erreur?: string;
}

/** L'état du relais sur cette installation ; `null` tant qu'il n'est pas lu. */
export function useEtatDuRelais(): EtatDuRelais | null {
  const [etat, setEtat] = React.useState<EtatDuRelais | null>(null);
  React.useEffect(() => {
    let vivant = true;
    fetch('/api/relais/etat')
      .then((r) => (r.ok ? r.json() : null))
      .then((corps) => vivant && setEtat(corps))
      .catch(() => vivant && setEtat(null));
    return () => {
      vivant = false;
    };
  }, []);
  return etat;
}

/** Oui ou non : l'adresse de l'administrateur part-elle avec le signe de vie ? */
export function SectionPartage() {
  const { identite, enregistrer } = useIdentite();
  return (
    <div className="space-y-3" data-section-installation="partage">
      <p className="text-[13.5px] leading-relaxed text-muted">
        {t('Une fois par jour, cette installation dit à l’équipe Beluga qu’elle fonctionne : un numéro tiré au hasard, sa version et son pays. Rien de votre travail ne part, jamais.')}
      </p>
      <ChoixEnLignes<'oui' | 'non'>
        repere="partage-du-courriel"
        valeur={identite.partageDuCourriel}
        choix={[
          {
            id: 'oui',
            nom: t('Partager aussi mon adresse de courriel'),
            detail: t('L’équipe Beluga sait qui utilise son outil et peut vous prévenir d’une nouveauté importante.'),
          },
          {
            id: 'non',
            nom: t('Rester anonyme'),
            detail: t('Votre adresse ne part pas.'),
          },
        ]}
        onChoisir={(id) => enregistrer({ partageDuCourriel: id })}
      />
    </div>
  );
}
