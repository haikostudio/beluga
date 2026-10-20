import * as React from 'react';
import { IDENTITE_VIERGE, type IdentiteDInstallation } from '@beluga/shared';
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui';
import { client } from '@/lib/client';
import { t } from '@/lib/langue';
import { useApp } from '@/lib/use-app';

/**
 * LA QUESTION DU PARTAGE, POSÉE UNE FOIS AUX INSTALLATIONS DÉJÀ EN PLACE.
 *
 * Une installation neuve répond dans l'assistant de démarrage ; celles qui
 * existaient avant le relais (20/10/2026) n'y repasseront pas. Tant que
 * personne n'a répondu, l'adresse ne part pas — et la question s'affiche à
 * l'administrateur, une fois la réponse donnée, plus jamais (elle se change
 * ensuite dans Réglages → Installation).
 */
export function QuestionDuPartage() {
  const state = useApp();
  const identite = (state.settings?.installation ?? IDENTITE_VIERGE) as IdentiteDInstallation;
  const aRepondre = state.monRole === 'admin' && !!state.settings && identite.partageDuCourriel === '';
  const [joint, setJoint] = React.useState(false);
  const [ecartee, setEcartee] = React.useState(false);

  React.useEffect(() => {
    if (!aRepondre) return;
    let vivant = true;
    fetch('/api/relais/etat')
      .then((r) => (r.ok ? r.json() : null))
      .then((etat: { joint?: boolean } | null) => vivant && setJoint(Boolean(etat?.joint)))
      .catch(() => undefined);
    return () => {
      vivant = false;
    };
  }, [aRepondre]);

  const repondre = (reponse: 'oui' | 'non') => {
    const courante = (client.lireEtat().settings?.installation ?? IDENTITE_VIERGE) as IdentiteDInstallation;
    void client
      .call({ type: 'settings.update', patch: { installation: { ...courante, partageDuCourriel: reponse } } })
      .catch(() => client.pushToast('error', t('réglage non enregistré')));
    setEcartee(true);
  };

  return (
    <Dialog open={aRepondre && joint && !ecartee} onOpenChange={(ouvert) => !ouvert && setEcartee(true)}>
      <DialogContent adresse="saisie" className="sm:w-[min(460px,100%)]" data-question-partage>
        <DialogHeader>
          <DialogTitle>{t('Ce que l’équipe Beluga reçoit')}</DialogTitle>
        </DialogHeader>
        <DialogDescription className="mt-0">
          {t('Une fois par jour, cette installation dit à l’équipe Beluga qu’elle fonctionne : un numéro tiré au hasard, sa version et son pays. Rien de votre travail ne part, jamais.')}{' '}
          {t('Voulez-vous partager aussi votre adresse de courriel ?')}
        </DialogDescription>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => repondre('non')} data-partage-reponse="non">
            {t('Rester anonyme')}
          </Button>
          <Button size="sm" onClick={() => repondre('oui')} data-partage-reponse="oui">
            {t('Partager mon adresse')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
