import * as React from 'react';
import { Switch } from '@/components/ui';
import { client } from '@/lib/client';
import { t } from '@/lib/langue';

/**
 * COUPER LE SUIVI MARKETING D'UN PROJET qui n'en a pas besoin (demande du
 * 27/09/2026) : éteint, le projet passe dans « Projets inactifs » au tableau
 * de bord, sort de ses chiffres et ne reçoit plus de plan du dimanche. Le
 * rond tourne dès le clic, jusqu'à la réponse du démon.
 *
 * Le même interrupteur vit dans l'entête du détail d'un projet du service
 * Statistiques (« Suivi actif », demande du 28/09/2026) : un seul réglage,
 * `marketing.activer`, que les deux écrans lisent — ils ne se contredisent pas.
 */
/** `libelle` : le texte affiché (déjà traduit) ; `repere` : l'étiquette technique, fixe dans toutes les langues. */
export function InterrupteurDeSuivi({ projectId, actif, libelle, repere }: { projectId: string; actif: boolean; libelle?: string; repere?: string }) {
  /* LE CHOIX TIENT JUSQU'À CE QUE L'ESPACE RELU LE CONFIRME : relâché à la
     réponse du démon, l'interrupteur revenait un instant sur l'ancienne
     position, le temps que `marketing.espace` soit relu — on croyait le geste
     refusé. */
  const [voulu, setVoulu] = React.useState<boolean | null>(null);
  const [attente, setAttente] = React.useState(false);
  React.useEffect(() => {
    if (voulu !== null && actif === voulu && !attente) setVoulu(null);
  }, [actif, voulu, attente]);
  const coche = voulu ?? actif;
  const basculer = async (v: boolean) => {
    setVoulu(v);
    setAttente(true);
    try {
      await client.call({ type: 'marketing.activer', projectId, actif: v });
    } catch (err: any) {
      setVoulu(null);
      client.pushToast('error', err?.message ?? t('Réglage impossible'));
    } finally {
      setAttente(false);
    }
  };
  return (
    <label
      className="flex shrink-0 cursor-pointer items-center gap-1.5 text-[12px] text-muted"
      title={coche ? t('Couper le suivi marketing de ce projet') : t('Rallumer le suivi marketing de ce projet')}
      data-marketing-suivi-actif={coche ? 'oui' : 'non'}
    >
      <span className="hidden sm:inline">{libelle ?? t('Marketing suivi')}</span>
      <Switch checked={coche} attente={attente} onCheckedChange={(v) => void basculer(v)} aria-label={repere ?? 'Marketing suivi'} data-marketing-interrupteur-suivi />
    </label>
  );
}
