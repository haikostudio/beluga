import * as React from 'react';
import { BulleInfo, Label, Switch } from '@/components/ui';
import { AppearancePicker } from '@/components/appearance-picker';
import { t } from '@/lib/langue';
import { TeteDeRubrique, type ContexteConfig } from './communs';

/**
 * L'APPARENCE DU PROJET suit exactement la même règle que le général :
 * ambiance indépendante du mode, et suivi du système par interrupteur.
 * L'interrupteur extérieur rend la main au réglage général.
 */
export function RubriqueApparence({ ctx }: { ctx: ContexteConfig }) {
  return (
    <div data-rubrique-contenu="apparence" data-theme-projet className="space-y-3">
      <TeteDeRubrique
        titre={t('Apparence')}
        resume={t('Une ambiance propre à ce projet, ou le réglage général.')}
      />

      <div>
        <div className="flex items-center gap-1">
          <Label>{t('Apparence de ce projet')}</Label>
          <BulleInfo cote="start">{t('Une apparence propre habille toute l’application dès que ce projet est ouvert. Désactivez-la pour reprendre le réglage général.')}</BulleInfo>
        </div>
        <div className="mt-2 flex items-center justify-between gap-3 rounded-lg border border-border bg-bloc px-3 py-2.5">
          <span className="text-[13.5px] font-medium text-text">{t('Apparence propre à ce projet')}</span>
          <Switch
            checked={ctx.themeProjet !== null}
            onCheckedChange={(actif) => ctx.setThemeProjet(actif ? { ...ctx.apparenceGenerale } : null)}
            data-theme-projet-choix="general"
            aria-label="Apparence propre au projet"
          />
        </div>
        {ctx.themeProjet ? (
          <div className="mt-2" data-theme-projet-personnalise>
            <AppearancePicker
              value={ctx.themeProjet}
              onChange={ctx.setThemeProjet}
              systemeSombre={ctx.systemeSombre}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
