import * as React from 'react';
import { BulleInfo, Input, Label } from '@/components/ui';
import { useApp } from '@/lib/use-app';
import { t } from '@/lib/langue';
import { TeteDeRubrique, type ContexteConfig } from './communs';

/** L'ESSENTIEL : le nom du projet, et le moteur sur lequel ses cartes partent. */
export function RubriqueGeneral({ ctx }: { ctx: ContexteConfig }) {
  const state = useApp();
  return (
    <div data-rubrique-contenu="general" className="space-y-3">
      <TeteDeRubrique
        titre={t('L’essentiel')}
        resume={t('Le nom du projet et le moteur sur lequel ses cartes partent.')}
      />

      <div>
        <Label>{t('Nom')}</Label>
        <Input
          value={ctx.name}
          onChange={(event) => ctx.setName(event.target.value)}
          className="mt-1"
          data-nom-projet
        />
      </div>

      <div>
        <div className="flex items-center gap-1">
          <Label>{t('Moteur par défaut de ce projet')}</Label>
          <BulleInfo cote="start">{t('Les nouvelles cartes de ce projet partiront sur ce moteur.')}</BulleInfo>
        </div>
        <select
          value={ctx.engine}
          onChange={(event) => ctx.setEngine(event.target.value)}
          data-moteur-projet
          className="mt-1 h-8 w-full rounded-md border border-border bg-raised px-2 text-[14.5px] text-text"
        >
          {state.engines
            .filter((moteur) => moteur.installed)
            .map((moteur) => (
              <option key={moteur.id} value={moteur.id}>
                {moteur.label}
              </option>
            ))}
        </select>
      </div>
    </div>
  );
}
