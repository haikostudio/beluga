import * as React from 'react';
import { FormulaireEnColonnes, Input, LigneFormulaire, ListeDeroulante } from '@/components/ui';
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

      <FormulaireEnColonnes>
        <LigneFormulaire libelle={t('Nom')}>
          <Input value={ctx.name} onChange={(event) => ctx.setName(event.target.value)} data-nom-projet />
        </LigneFormulaire>

        <LigneFormulaire libelle={t('Moteur par défaut de ce projet')} aide={t('Les nouvelles cartes de ce projet partiront sur ce moteur.')}>
          <ListeDeroulante
            valeur={ctx.engine}
            titre={t('Moteur par défaut de ce projet')}
            repere="moteur-projet"
            data-moteur-projet
            onChoisir={ctx.setEngine}
            options={state.engines.filter((moteur) => moteur.installed).map((moteur) => ({ valeur: moteur.id, libelle: moteur.label }))}
          />
        </LigneFormulaire>
      </FormulaireEnColonnes>
    </div>
  );
}
