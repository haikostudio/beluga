import * as React from 'react';
import { Laptop, Smartphone, X } from 'lucide-react';
import { APPAREIL_INCONNU, type AppareilNotifie } from '@beluga/shared';
import { Button, Input, Switch } from '@/components/ui';
import { Champ } from '@/components/card-panel';
import { Groupe } from '@/components/reglages/communs';
import { abonnerAuxNotifications, couperCetAppareil, etatDeCetAppareil, type EtatDeCetAppareil } from '@/lib/abonnement-push';
import { client } from '@/lib/client';
import { formatRegional, t } from '@/lib/langue';

/** Les réglages du démon voyagent tous par le même couple : l'objet des
 *  réglages et la fonction qui envoie la retouche au serveur. */
export interface ProprietesReglages {
  settings: Record<string, any>;
  update: (patch: Record<string, unknown>) => void;
}

/** L'explication d'un appareil qui ne peut pas (ou plus) recevoir de notifications. */
function explicationDe(etat: EtatDeCetAppareil['etat'] | undefined): string | null {
  switch (etat) {
    case 'iphone-a-installer':
      return t('Sur iPhone, les notifications n’existent que dans l’application installée : ajoutez Beluga à l’écran d’accueil depuis Safari (Partager, puis « Sur l’écran d’accueil »), puis ouvrez-la d’ici.');
    case 'indisponible':
      return t('Ce navigateur ne gère pas les notifications.');
    case 'refusee':
      return t('Les notifications sont refusées pour ce site : autorisez-les dans les réglages de l’appareil, puis revenez ici.');
    default:
      return null;
  }
}

/**
 * CET APPAREIL, ET TOUS LES AUTRES. L'interrupteur active ou coupe les
 * notifications de l'appareil qui regarde ; la liste montre les appareils du
 * compte et laisse retirer n'importe lequel (un téléphone perdu, un vieil
 * ordinateur). Les types de notifications, eux, sont les mêmes partout.
 */
function AppareilsConnectes() {
  const [cet, setCet] = React.useState<EtatDeCetAppareil | null>(null);
  const [appareils, setAppareils] = React.useState<AppareilNotifie[] | null>(null);
  const [courantId, setCourantId] = React.useState<string | null>(null);
  const [attente, setAttente] = React.useState(false);

  const recharger = React.useCallback(async () => {
    const etat = await etatDeCetAppareil();
    setCet(etat);
    try {
      const reponse = await fetch('/api/push/appareils', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(etat.etat === 'active' ? { endpoint: etat.endpoint } : {}),
      });
      const donnees = (await reponse.json()) as { appareils: AppareilNotifie[]; courantId: string | null };
      setAppareils(donnees.appareils);
      setCourantId(donnees.courantId);
    } catch {
      setAppareils([]);
    }
  }, []);

  React.useEffect(() => {
    void recharger();
  }, [recharger]);

  const basculer = async (voulu: boolean) => {
    setAttente(true);
    try {
      const reussi = voulu ? await abonnerAuxNotifications(0, true) : await couperCetAppareil();
      if (!reussi) client.pushToast('error', t('Impossible de changer les notifications de cet appareil.'));
    } finally {
      await recharger();
      setAttente(false);
    }
  };

  const retirer = async (appareil: AppareilNotifie) => {
    await fetch('/api/push/appareils/retirer', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: appareil.id }),
    });
    /* Retirer l'appareil qui regarde le coupe aussi côté navigateur. */
    if (appareil.id === courantId) await couperCetAppareil();
    await recharger();
  };

  const explication = explicationDe(cet?.etat);

  return (
    <>
      <Groupe titre={t('Cet appareil')}>
        <label className="flex items-center gap-2 text-[14px] text-muted">
          <Switch
            checked={cet?.etat === 'active'}
            attente={attente || cet === null}
            disabled={!!explication}
            onCheckedChange={(coche) => void basculer(coche)}
          />
          {t('Notifications sur cet appareil')}
        </label>
        {explication ? <p className="text-[12.5px] leading-relaxed text-faint">{explication}</p> : null}
      </Groupe>

      <Groupe
        titre={t('Vos appareils connectés')}
        aide={t('Les appareils qui reçoivent vos notifications. Retirer un appareil l’arrête tout de suite.')}
      >
        {appareils === null ? null : appareils.length === 0 ? (
          <p className="text-[13px] text-faint">{t('Aucun appareil connecté')}</p>
        ) : (
          <ul className="space-y-1" data-liste-appareils>
            {appareils.map((appareil) => {
              const Icone = /iPhone|iPad|Android/.test(appareil.nom) ? Smartphone : Laptop;
              return (
                <li key={appareil.id} className="flex items-center gap-2 text-[14px] text-text" data-appareil={appareil.id}>
                  <Icone className="h-4 w-4 shrink-0 text-muted" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">
                      {appareil.nom === APPAREIL_INCONNU ? t('Appareil inconnu') : appareil.nom}
                      {appareil.id === courantId ? <span className="text-teinte"> · {t('Cet appareil')}</span> : null}
                    </span>
                    <span className="block text-[12px] text-faint">
                      {t('Ajouté le {date}', { date: new Date(appareil.ajouteLe).toLocaleDateString(formatRegional()) })}
                    </span>
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Retirer cet appareil"
                    onClick={() => retirer(appareil)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </Groupe>
    </>
  );
}

/**
 * LES NOTIFICATIONS : cet appareil, les appareils connectés, CE DONT ON VOUS
 * PRÉVIENT, et QUAND ON SE TAIT. Les heures de silence sont ici et pas
 * ailleurs : elles ne parlent que de notifications.
 */
export function ReglagesNotifications({ settings, update }: ProprietesReglages) {
  const nombre = (valeur: string) => (valeur === '' ? undefined : Number(valeur));

  return (
    <div className="space-y-5">
      <AppareilsConnectes />

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
