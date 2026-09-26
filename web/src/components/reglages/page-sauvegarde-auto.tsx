import * as React from 'react';
import { Input } from '@/components/ui';
import { Champ } from '@/components/card-panel';
import { Groupe } from '@/components/reglages/communs';
import { t } from '@/lib/langue';

/** Les réglages du démon voyagent tous par le même couple : l'objet des
 *  réglages et la fonction qui envoie la retouche au serveur. */
export interface ProprietesReglages {
  settings: Record<string, any>;
  update: (patch: Record<string, unknown>) => void;
}

/** L'HEURE DE LA SAUVEGARDE DE NUIT. Le reste — la lancer à la main, voir la
 *  dernière — vit juste en dessous, dans la même page. */
export function ReglagesSauvegardeAuto({ settings, update }: ProprietesReglages) {
  return (
    <div className="space-y-5">
      <Groupe titre={t('Sauvegarde automatique')}>
        <Champ label={t('Heure de la sauvegarde de nuit')} aide={t('De 0 à 23. La sauvegarde est vérifiée juste après.')}>
          <Input
            type="number"
            min={0}
            max={23}
            defaultValue={settings.backupHour}
            onBlur={(event) => update({ backupHour: Number(event.target.value) })}
          />
        </Champ>
      </Groupe>
    </div>
  );
}
