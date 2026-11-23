import * as React from 'react';
import { cheminsLibresLus, type Project } from '@beluga/shared';
import { Input, LigneFormulaire, Switch } from '@/components/ui';
import { client } from '@/lib/client';
import { t } from '@/lib/langue';

interface EtatDeLaGarde {
  hotes: string[];
  protege: boolean;
  gardePosee: boolean;
  coupeePartout: boolean;
}

/**
 * LA VERSION DE TRAVAIL RÉSERVÉE AUX PERSONNES CONNECTÉES (carte « Accès des IA : prod ou dev », 23/11/2026).
 *
 * Allumée par défaut sur tous les projets : l'adresse de travail ne s'ouvre qu'à l'équipe connectée à Beluga et aux
 * clients du projet (avec l'accès de leur espace client). L'interrupteur agit TOUT DE SUITE (le relais du serveur est
 * réécrit), sans attendre « Enregistrer ». Les chemins libres (notifications de paiement…) s'enregistrent en quittant
 * le champ. Règles : shared/src/garde-acces.ts.
 */
export function GardeDeLaVersionDeTravail({ project }: { project: Project }) {
  const [etat, setEtat] = React.useState<EtatDeLaGarde | null>(null);
  const [enVol, setEnVol] = React.useState(false);
  const [erreur, setErreur] = React.useState<string | null>(null);
  const [chemins, setChemins] = React.useState((project.cheminsLibresTravail ?? []).join(', '));
  const protege = project.protectionTravail !== false;

  const relire = React.useCallback(() => {
    client
      .call<EtatDeLaGarde>({ type: 'projet.gardeTravail', projectId: project.id }, 20000)
      .then(setEtat)
      .catch(() => setEtat(null));
  }, [project.id]);
  React.useEffect(relire, [relire, project.protectionTravail]);
  React.useEffect(() => setChemins((project.cheminsLibresTravail ?? []).join(', ')), [project.id, project.cheminsLibresTravail]);

  const basculer = async (valeur: boolean) => {
    setEnVol(true);
    setErreur(null);
    try {
      await client.call({ type: 'project.update', id: project.id, patch: { protectionTravail: valeur } }, 90000);
      relire();
    } catch (err: any) {
      setErreur(err?.message ?? t('La commande a échoué.'));
    } finally {
      setEnVol(false);
    }
  };

  const enregistrerLesChemins = async () => {
    const lus = cheminsLibresLus(chemins);
    if (lus.join(',') === (project.cheminsLibresTravail ?? []).join(',')) {
      setChemins(lus.join(', '));
      return;
    }
    try {
      await client.call({ type: 'project.update', id: project.id, patch: { cheminsLibresTravail: lus } }, 90000);
      setChemins(lus.join(', '));
    } catch (err: any) {
      setErreur(err?.message ?? t('La commande a échoué.'));
    }
  };

  const hotes = etat?.hotes ?? [];
  return (
    <section className="space-y-3 rounded-xl bg-raised px-3.5 py-3" data-garde-travail={protege ? 'oui' : 'non'}>
      <label className="flex cursor-pointer items-start justify-between gap-3">
        <span className="min-w-0">
          <span className="block text-[13.5px] font-medium text-text">{t('Version de travail réservée aux personnes connectées')}</span>
          <span className="block text-[12.5px] leading-snug text-muted">
            {t('Seuls l’équipe connectée à Beluga et les clients de ce projet, avec l’accès de leur espace client, l’ouvrent. Les robots et les IA n’y entrent pas.')}
          </span>
        </span>
        <Switch
          checked={protege}
          attente={enVol}
          onCheckedChange={(v) => void basculer(v)}
          aria-label="Version de travail réservée aux personnes connectées"
          data-interrupteur-garde-travail={protege ? 'oui' : 'non'}
        />
      </label>

      <div className="space-y-1 text-[12.5px] leading-snug" data-garde-adresses>
        {etat === null ? (
          <div className="h-4 w-2/3 animate-pulse rounded bg-surface" aria-hidden />
        ) : hotes.length ? (
          <p className="text-muted">
            <span className="text-faint">{t('Version de travail')} · </span>
            <span className="break-all text-text">{hotes.join(', ')}</span>
          </p>
        ) : (
          <p className="text-faint" data-garde-sans-adresse>
            {t('Aucune adresse de travail de ce projet n’est servie par ce serveur : rien à protéger pour l’instant.')}
          </p>
        )}
        <p className="text-muted" data-garde-en-ligne>
          <span className="text-faint">{t('Version en ligne')} · </span>
          {project.adresseProduction ? (
            <span className="break-all text-text">{project.adresseProduction}</span>
          ) : (
            <span className="text-faint">{t('pas encore réglée (rubrique « Mise en production »)')}</span>
          )}
          {project.adresseProduction ? <span className="text-faint"> — {t('toujours ouverte à tous')}</span> : null}
        </p>
        {etat?.coupeePartout ? (
          <p className="text-danger" data-garde-coupee>
            {t('La protection est coupée pour tout le serveur : aucune version de travail n’est fermée.')}
          </p>
        ) : protege && hotes.length && etat && !etat.gardePosee ? (
          <p className="text-danger" data-garde-non-posee>
            {t('Une des adresses de ce site n’importe pas la garde commune du serveur : elle reste ouverte. Le contrôle Sécurité le signale.')}
          </p>
        ) : null}
      </div>

      {protege ? (
        <LigneFormulaire
          libelle={t('Chemins laissés libres')}
          aide={t('Les adresses que des services extérieurs appellent sans compte, par exemple les notifications de paiement. Séparées par une virgule ; « /api/webhooks/* » couvre tout le dossier.')}
          data-garde-chemins
        >
          <Input
            value={chemins}
            onChange={(event) => setChemins(event.target.value)}
            onBlur={() => void enregistrerLesChemins()}
            className="font-mono text-[13px]"
            placeholder="/api/webhooks/*"
            data-garde-chemins-champ
          />
        </LigneFormulaire>
      ) : null}

      {erreur ? (
        <p className="rounded-md bg-danger/10 px-2.5 py-1.5 text-[12.5px] text-danger" data-garde-erreur>
          {erreur}
        </p>
      ) : null}
    </section>
  );
}
