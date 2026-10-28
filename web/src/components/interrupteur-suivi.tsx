import * as React from 'react';
import { Activity } from 'lucide-react';
import { DropdownMenuItem, Switch } from '@/components/ui';
import { useTenueDesOptions } from '@/components/entete-de-zone';
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
 *
 * Posé dans les options d'une page (`OptionsDePage`), il devient sur téléphone
 * une LIGNE du menu à trois points : son nom en toutes lettres, l'interrupteur
 * à droite. La toucher bascule le réglage sans refermer le menu — on voit
 * l'interrupteur changer.
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
  const tenue = useTenueDesOptions();
  if (tenue === 'ligne') {
    return (
      <DropdownMenuItem
        onSelect={(e) => {
          e.preventDefault();
          if (!attente) void basculer(!coche);
        }}
        data-marketing-suivi-actif={coche ? 'oui' : 'non'}
      >
        <span className="flex h-4 w-4 shrink-0 items-center justify-center text-muted">
          <Activity className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1 truncate">{libelle ?? t('Réseaux sociaux suivis')}</span>
        {/* La ligne entière est le geste : l'interrupteur n'en est que le dessin. */}
        <span className="pointer-events-none flex shrink-0" aria-hidden>
          <Switch checked={coche} attente={attente} tabIndex={-1} data-marketing-interrupteur-suivi />
        </span>
      </DropdownMenuItem>
    );
  }
  return (
    <label
      className="flex shrink-0 cursor-pointer items-center gap-1.5 text-[12px] text-muted"
      title={coche ? t('Couper le suivi des réseaux sociaux de ce projet') : t('Rallumer le suivi des réseaux sociaux de ce projet')}
      data-marketing-suivi-actif={coche ? 'oui' : 'non'}
    >
      <span className="hidden sm:inline">{libelle ?? t('Réseaux sociaux suivis')}</span>
      <Switch checked={coche} attente={attente} onCheckedChange={(v) => void basculer(v)} aria-label={repere ?? 'Réseaux sociaux suivis'} data-marketing-interrupteur-suivi />
    </label>
  );
}
