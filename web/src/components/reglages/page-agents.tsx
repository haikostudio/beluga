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

/**
 * COMBIEN D'AGENTS À LA FOIS, ET QUAND LES LOURDS PARTENT. Les deux vont
 * ensemble : le plafond dit ce qui tient en parallèle, les heures creuses
 * disent quand ce qui est long attend la nuit.
 */
export function ReglagesAgents({ settings, update }: ProprietesReglages) {
  return (
    <div className="space-y-5">
      <Groupe titre={t('Combien d\'agents en même temps')}>
        <Champ
          label={t('Plafond d\'agents')}
          aide={t("Nombre maximum d'agents qui peuvent travailler en parallèle. La mémoire disponible peut abaisser ce chiffre, jamais l'augmenter.")}
        >
          <Input
            type="number"
            min={1}
            max={40}
            defaultValue={settings.maxAgents}
            onBlur={(event) => update({ maxAgents: Number(event.target.value) })}
          />
        </Champ>
        <Champ
          label={t('Une tâche est dite « lourde » au-delà de (minutes)')}
          aide={t('Au-delà de cette durée prévue, une tâche est repoussée aux heures creuses plutôt que lancée tout de suite.')}
        >
          <Input
            type="number"
            min={1}
            defaultValue={Math.round(settings.heavyTaskSeconds / 60)}
            onBlur={(event) => update({ heavyTaskSeconds: Number(event.target.value) * 60 })}
          />
        </Champ>
      </Groupe>

      <Groupe
        titre={t('Heures creuses')}
        aide={t('La plage où les tâches lourdes sont lancées. Elle peut passer minuit : 22 puis 7 signifie « de 22 h à 7 h ».')}
      >
        <Champ label={t('Début (heure)')} aide={t('De 0 à 23.')}>
          <Input
            type="number"
            min={0}
            max={23}
            defaultValue={settings.offPeakStart}
            onBlur={(event) => update({ offPeakStart: Number(event.target.value) })}
          />
        </Champ>
        <Champ label={t('Fin (heure)')} aide={t('De 0 à 23.')}>
          <Input
            type="number"
            min={0}
            max={23}
            defaultValue={settings.offPeakEnd}
            onBlur={(event) => update({ offPeakEnd: Number(event.target.value) })}
          />
        </Champ>
      </Groupe>
    </div>
  );
}
