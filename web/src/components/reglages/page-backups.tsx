import * as React from 'react';
import { Input, Switch } from '@/components/ui';
import { Champ } from '@/components/card-panel';
import { Groupe } from '@/components/reglages/communs';
import { t } from '@/lib/langue';

/** Les réglages du démon voyagent tous par le même couple : l'objet des
 *  réglages et la fonction qui envoie la retouche au serveur. */
export interface ProprietesReglages {
  settings: Record<string, any>;
  update: (patch: Record<string, unknown>) => void;
}

/**
 * LES BACKUPS DES SITES EN PRODUCTION : où ils sont rangés, à quelle heure
 * ils partent, et s'ils partent tout seuls.
 */
export function ReglagesBackups({ settings, update }: ProprietesReglages) {
  return (
    <div className="space-y-5">
      <Groupe titre={t('Backups des sites en production')}>
        <Champ
          label={t('Dossier du disque de stockage')}
          aide={t('Le point de montage du disque, chemin absolu. Vide, aucun backup ne part.')}
        >
          <Input
            defaultValue={settings.backupDossier ?? ''}
            placeholder="/mnt/stockage/backups"
            onBlur={(event) => update({ backupDossier: event.target.value.trim() })}
          />
        </Champ>
        <Champ label={t('Heure du passage')} aide={t('De 0 à 23. Après la sauvegarde du démon, pas en même temps.')}>
          <Input
            type="number"
            min={0}
            max={23}
            defaultValue={settings.backupHeure}
            onBlur={(event) => update({ backupHeure: Number(event.target.value) })}
          />
        </Champ>
        <label className="flex items-center gap-2 text-[14px] text-muted">
          <Switch
            checked={settings.backupAuto}
            onCheckedChange={(checked) => update({ backupAuto: checked })}
          />
          {t('Sauvegarder les sites automatiquement chaque nuit')}
        </label>
      </Groupe>
    </div>
  );
}
