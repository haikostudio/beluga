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
 * CE DONT ON VOUS PRÉVIENT, et QUAND ON SE TAIT. Les heures de silence sont
 * ici et pas ailleurs : elles ne parlent que de notifications.
 */
export function ReglagesNotifications({ settings, update }: ProprietesReglages) {
  const nombre = (valeur: string) => (valeur === '' ? undefined : Number(valeur));

  return (
    <div className="space-y-5">
      <Groupe titre={t('Ce dont on vous prévient')}>
        <div className="space-y-2">
          {(
            [
              ['notifyOnDone', t('Quand une tâche se termine')],
              ['notifyOnFailed', t('Quand une tâche échoue')],
              ['notifyOnProposal', t('Quand une tâche est proposée par un agent')],
              ['notifyOnDeploy', t('Quand une publication est finie')],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="flex items-center gap-2 text-[14px] text-muted">
              <Switch checked={settings[key] as boolean} onCheckedChange={(checked) => update({ [key]: checked })} />
              {label}
            </label>
          ))}
        </div>
      </Groupe>

      <Groupe
        titre={t('Heures de silence')}
        aide={t('Aucune notification pendant cette plage, et aucune fenêtre de quota amorcée. Laissez les deux champs vides pour ne jamais faire silence.')}
      >
        <Champ label={t('Début (heure)')} aide={t('Vide = pas de silence.')}>
          <Input
            type="number"
            min={0}
            max={23}
            defaultValue={settings.quietHoursStart ?? ''}
            onBlur={(event) => update({ quietHoursStart: nombre(event.target.value) })}
          />
        </Champ>
        <Champ label={t('Fin (heure)')} aide={t('Vide = pas de silence.')}>
          <Input
            type="number"
            min={0}
            max={23}
            defaultValue={settings.quietHoursEnd ?? ''}
            onBlur={(event) => update({ quietHoursEnd: nombre(event.target.value) })}
          />
        </Champ>
      </Groupe>
    </div>
  );
}
