import * as React from 'react';
import {
  Palette,
} from 'lucide-react';
import { AppearancePicker } from '@/components/appearance-picker';
import { useSystemeSombre, useThemeEnVigueur, useThemeGeneral } from '@/lib/theme';
import { useApp } from '@/lib/use-app';
import { t } from '@/lib/langue';
import { BulleInfo } from '@/components/ui';


/**
 * UNE SEULE APPARENCE, NOIR ET BLANC : il ne reste qu'à choisir sa clarté. Le
 * suivi du système est le premier interrupteur, puis deux cartes — clair,
 * sombre — la fixent à la main.
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
  <BulleInfo cote="start">{t('Choisissez le mode clair ou sombre, ou laissez l’ordinateur décider. Le réglage vaut sur l’ordinateur comme sur le téléphone, et chaque projet peut garder sa propre apparence.')}</BulleInfo>
</h3>

      {/* UN PROJET QUI IMPOSE SON THÈME PASSE DEVANT, ET ON LE DIT ICI. Sans
          cette phrase, choisir un thème dans cet onglet ne changeait rien à
          l'écran et l'on croyait le réglage cassé. */}
      {enVigueur.source === 'projet' ? (
        <p
          data-theme-recouvert
          className="mb-3 rounded-md border border-border bg-bloc px-2.5 py-1.5 text-[12.5px] leading-relaxed text-muted"
        >
          {t('« {v0} » impose sa propre apparence (mode {v1}) : c’est celle que vous voyez. Le choix ci-dessous vaut pour les autres projets.', {
            v0: projetOuvert?.name,
            v1: enVigueur.automatique
              ? t('Automatique')
              : enVigueur.clarteChoisie === 'clair'
                ? t('Clair')
                : t('Sombre'),
          })}</p>
      ) : null}
      {enVigueur.parLeSysteme && enVigueur.source === 'general' ? (
        <p data-theme-par-le-systeme className="mb-3 text-[12.5px] leading-relaxed text-muted">
          {t('Votre ordinateur est réglé en mode {v0} : l’application le suit.', {
            v0: enVigueur.clarteAppliquee === 'clair' ? t('Clair') : t('Sombre'),
          })}</p>
      ) : null}
      <AppearancePicker value={apparence} onChange={setApparence} systemeSombre={systemeSombre} />
    </section>
  );
}
