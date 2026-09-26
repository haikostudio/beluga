/**
 * LES BACKUPS DU PROJET, DANS L'ESPACE CLIENT.
 *
 * Un client récupère à tout moment l'une des archives réussies de SON projet :
 * la liste vient du démon, bornée à sa portée (`espace.backups.lister`), et le
 * téléchargement passe par un jeton lié à un seul fichier
 * (`espace.backups.telecharger`, puis `/api/download`). Aucune restauration
 * ici : remettre une archive en place écrase ce que le site porte, c'est un
 * geste de Haiko.
 *
 * Le même volet sert la face Haiko : c'est le même écran, vu par l'admin.
 */
import * as React from 'react';
import { Download, Loader2, X } from 'lucide-react';
import { formaterOctets, type BackupsDuSiteVisibles } from '@beluga/shared';
import { BulleInfo, Button, ZoneDefilement } from '@/components/ui';
import { t } from '@/lib/langue';
import { canalEspace } from './canal-espace';
import { heureCourte, jourDe } from './formats';

export function VoletBackups({ projectId, onFermer }: { projectId: string; onFermer?: () => void }) {
  const [sites, setSites] = React.useState<BackupsDuSiteVisibles[] | null>(null);
  const [erreur, setErreur] = React.useState<string | null>(null);
  const [enCours, setEnCours] = React.useState<string | null>(null);

  const recharger = React.useCallback(() => {
    void canalEspace
      .demander({ type: 'espace.backups.lister', projectId: projectId || undefined })
      .then((reponse: { sites: BackupsDuSiteVisibles[] }) => {
        setSites(reponse.sites);
        setErreur(null);
      })
      .catch((err) => {
        setSites([]);
        setErreur(err?.message ?? t('Les backups n’ont pas pu être lus.'));
      });
  }, [projectId]);

  React.useEffect(recharger, [recharger]);
  React.useEffect(() => canalEspace.surChangementDEtat((etat) => etat === 'en-ligne' && recharger()), [recharger]);

  const telecharger = async (pointId: string) => {
    setEnCours(pointId);
    try {
      const reponse = await canalEspace.demander<{ token: string }>({ type: 'espace.backups.telecharger', pointId });
      window.location.href = `/api/download?token=${encodeURIComponent(reponse.token)}`;
    } catch (err: any) {
      setErreur(err?.message ?? t('Le téléchargement n’a pas pu démarrer.'));
    } finally {
      setEnCours(null);
    }
  };

  const avecArchives = (sites ?? []).filter((site) => site.archives.length > 0);
  const total = avecArchives.reduce((n, site) => n + site.archives.length, 0);

  return (
    <div className="flex h-full min-h-0 flex-col" data-volet-backups data-archives={sites === null ? undefined : total}>
      <div className="flex items-center justify-between border-b border-faint/40 px-3 py-2">
        <span className="flex items-center gap-1 text-[13px] font-medium text-text">
          {t('Backups du projet')}
          <BulleInfo cote="start">{t('Chaque archive est une copie de votre projet prise sur le serveur. Téléchargez celle dont vous avez besoin : rien n’est remis en place depuis ici.')}</BulleInfo>
        </span>
        {onFermer ? (
          <Button size="icon-sm" variant="ghost" onClick={onFermer} title={t('Fermer')}>
            <X className="h-4 w-4" />
          </Button>
        ) : null}
      </div>
      <ZoneDefilement className="flex min-h-0 flex-1 flex-col gap-3 p-3">
        {erreur ? <p className="text-[12.5px] text-danger">{erreur}</p> : null}
        {sites === null ? (
          /* UNE ZONE QUI N'A PAS ENCORE SES DONNÉES MONTRE UNE SILHOUETTE. */
          <div className="flex flex-col gap-1.5" aria-hidden data-silhouette-backups>
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-12 animate-pulse rounded-md bg-raised" />
            ))}
          </div>
        ) : !total ? (
          <p className="text-[13px] text-muted" data-backups-vide>
            {t('Aucune archive disponible pour ce projet pour l’instant.')}
          </p>
        ) : (
          avecArchives.map((site) => (
            <section key={site.siteId} className="flex flex-col gap-1.5" data-backups-site-client={site.siteId}>
              <h3 className="text-[12px] font-medium uppercase tracking-wide text-faint">{site.nom}</h3>
              <ul className="flex flex-col gap-1">
                {site.archives.map((archive) => (
                  <li
                    key={archive.pointId}
                    className="flex min-w-0 items-center gap-2 rounded-md bg-raised px-2.5 py-2"
                    data-archive-client={archive.pointId}
                  >
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-[13px] text-text">
                        {jourDe(archive.debut)} · {heureCourte(archive.debut)}
                      </span>
                      <span className="truncate text-[11.5px] text-faint">
                        {formaterOctets(archive.taille)} ·{' '}
                        {archive.origine === 'automatique' ? t('prise automatique') : t('prise à la demande')}
                      </span>
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void telecharger(archive.pointId)}
                      disabled={enCours === archive.pointId}
                      data-telecharger-archive={archive.pointId}
                    >
                      {enCours === archive.pointId ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Download className="h-3.5 w-3.5" />
                      )}
                      {t('Télécharger')}
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </ZoneDefilement>
    </div>
  );
}
