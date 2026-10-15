import * as React from 'react';
import {
  Palette,
} from 'lucide-react';
import { AppearancePicker } from '@/components/appearance-picker';
import { useSystemeSombre, useThemeEnVigueur, useThemeGeneral } from '@/lib/theme';
import { t } from '@/lib/langue';
import { BulleInfo } from '@/components/ui';


/**
 * UNE SEULE APPARENCE, NOIR ET BLANC : il ne reste qu'à choisir sa clarté. Le
 * suivi du système est le premier interrupteur, puis deux cartes — clair,
 * sombre — la fixent à la main.
 */
export function SectionApparence() {
  const [apparence, setApparence] = useThemeGeneral();
  /* POUR L'APERÇU SEULEMENT : cet écran décrit le choix, il ne le pose pas. */
  const systemeSombre = useSystemeSombre(true);
  const enVigueur = useThemeEnVigueur();

  return (
    <section>
      <h3 className="flex items-center gap-1.5 text-[13.5px] font-medium text-text mb-3">
        <Palette className="h-3.5 w-3.5 text-faint" />  {t('Thème général')}
  <BulleInfo cote="start">{t('Choisissez le mode clair ou sombre, ou laissez l’ordinateur décider. Le réglage vaut sur l’ordinateur comme sur le téléphone, et pour tous les projets.')}</BulleInfo>
</h3>

      {enVigueur.parLeSysteme ? (
        <p data-theme-par-le-systeme className="mb-3 text-[12.5px] leading-relaxed text-muted">
          {t('Votre ordinateur est réglé en mode {v0} : l’application le suit.', {
            v0: enVigueur.clarteAppliquee === 'clair' ? t('Clair') : t('Sombre'),
          })}</p>
      ) : null}
      <AppearancePicker value={apparence} onChange={setApparence} systemeSombre={systemeSombre} />
    </section>
  );
}
