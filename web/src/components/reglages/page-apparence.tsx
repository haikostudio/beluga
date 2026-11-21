import * as React from 'react';
import { AppearancePicker } from '@/components/appearance-picker';
import { useSystemeSombre, useThemeEnVigueur, useThemeGeneral } from '@/lib/theme';
import { t } from '@/lib/langue';
import { Groupe } from '@/components/reglages/communs';
import { SectionLangue } from '@/components/reglages/page-langue';


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
    <Groupe
      titre={t('Thème général')}
      aide={t('Choisissez le mode clair ou sombre, ou laissez l’ordinateur décider. Le réglage vaut sur l’ordinateur comme sur le téléphone, et pour tous les projets.')}
      nu
    >
      {enVigueur.parLeSysteme ? (
        <p data-theme-par-le-systeme className="px-1 text-[12.5px] leading-relaxed text-muted">
          {t('Votre ordinateur est réglé en mode {v0} : l’application le suit.', {
            v0: enVigueur.clarteAppliquee === 'clair' ? t('Clair') : t('Sombre'),
          })}</p>
      ) : null}
      <AppearancePicker value={apparence} onChange={setApparence} systemeSombre={systemeSombre} />
    </Groupe>
  );
}

/** « Apparence et langue » (refonte des réglages, 21/11/2026) : le thème et la langue réunis ; l'ancienne clé `langue` y mène. */
export function PageApparenceEtLangue() {
  return (
    <div className="flex flex-col gap-7">
      <SectionApparence />
      <SectionLangue />
    </div>
  );
}
