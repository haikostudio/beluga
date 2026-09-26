import * as React from 'react';
import {
  Palette,
} from 'lucide-react';
import {
  ambianceParId,
} from '@beluga/shared';
import { AppearancePicker } from '@/components/appearance-picker';
import { useSystemeSombre, useThemeEnVigueur, useThemeGeneral } from '@/lib/theme';
import { useApp } from '@/lib/use-app';
import { t } from '@/lib/langue';
import { BulleInfo } from '@/components/ui';


/**
 * L'ambiance ne décide plus de la clarté. Le suivi du système est le premier
 * interrupteur, puis chaque ambiance montre et commande ses deux variantes.
 */
export function SectionApparence() {
  const state = useApp();
  const [apparence, setApparence] = useThemeGeneral();
  /* POUR L'APERÇU SEULEMENT, comme dans les réglages d'un projet : cet écran
     décrit le choix, il ne le pose pas. */
  const systemeSombre = useSystemeSombre(true);
  const enVigueur = useThemeEnVigueur();
  const projetOuvert = state.projects.find((projet) => projet.id === state.activeProjectId);

  return (
    <section>
      <h3 className="flex items-center gap-1.5 text-[13.5px] font-medium text-text mb-3">
        <Palette className="h-3.5 w-3.5 text-faint" />  {t('Thème général')}
  <BulleInfo cote="start">{t('Choisissez séparément une ambiance de couleur et un mode clair ou sombre. Le réglage vaut sur l’ordinateur comme sur le téléphone, et chaque projet peut garder sa propre apparence.')}</BulleInfo>
</h3>

      {/* UN PROJET QUI IMPOSE SON THÈME PASSE DEVANT, ET ON LE DIT ICI. Sans
          cette phrase, choisir un thème dans cet onglet ne changeait rien à
          l'écran et l'on croyait le réglage cassé. */}
      {enVigueur.source === 'projet' ? (
        <p
          data-theme-recouvert
          className="mb-3 rounded-md border border-termine/30 bg-termine/5 px-2.5 py-1.5 text-[12.5px] leading-relaxed text-muted"
        >
          {t('« {v0} » impose sa propre apparence ({v1}, mode {v2}) : c’est celle que vous voyez. Le choix ci-dessous vaut pour les autres projets.', {
            v0: projetOuvert?.name,
            v1: t(ambianceParId(enVigueur.ambiance).libelle),
            v2: enVigueur.automatique
              ? t('Automatique')
              : enVigueur.clarteChoisie === 'clair'
                ? t('Clair')
                : t('Sombre'),
          })}</p>
      ) : null}
      {enVigueur.parLeSysteme && enVigueur.source === 'general' ? (
        <p data-theme-par-le-systeme className="mb-3 text-[12.5px] leading-relaxed text-muted">
          {t('Votre ordinateur est réglé en mode {v0}. L’ambiance « {v1} » garde ses couleurs et passera automatiquement d’une variante à l’autre.', {
            v0: enVigueur.clarteAppliquee === 'clair' ? t('Clair') : t('Sombre'),
            v1: t(ambianceParId(enVigueur.ambiance).libelle),
          })}</p>
      ) : null}
      <AppearancePicker value={apparence} onChange={setApparence} systemeSombre={systemeSombre} />
    </section>
  );
}
