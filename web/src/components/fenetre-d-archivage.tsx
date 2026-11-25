import * as React from 'react';
import { ETAPES_D_ARCHIVAGE, avancementDuTransfert, tailleLisible, type SensDArchivage } from '@beluga/shared';
import { Archive, ArchiveRestore, Check, Circle, Loader2 } from '@/components/ui/icones';
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui';
import { client } from '@/lib/client';
import { t } from '@/lib/langue';
import { useApp } from '@/lib/use-app';
import { EVENEMENT_ARCHIVAGE, derniereDemandeDArchivage, type DemandeDArchivage } from '@/lib/archivage-projet';
import { cn } from '@/lib/utils';

/**
 * LA FENÊTRE D'ARCHIVAGE D'UN PROJET (`server/src/archivage-projet.ts`).
 *
 * Une seule fenêtre, montée à la première demande, ouverte de partout par `ouvrirLArchivage` (`lib/archivage-projet.ts`)
 * (menu de la ligne, clic droit, badge, bandeau du tableau, réglages) :
 *  1. CONFIRMATION — la place à libérer, ou la raison du refus, lues au démon
 *     sans rien toucher (`project.archivage.estimer`) ;
 *  2. PROGRESSION — barre, volume copié, temps restant, étapes cochées, poussés
 *     par le démon (`project.archivage`) ;
 *  3. FIN — le bilan, ou l'erreur en clair (rien n'a été effacé).
 * Elle se ferme à tout moment sans rien interrompre : le badge de la ligne
 * prend le relais, et un clic dessus la rouvre.
 */

interface Estimation {
  octets: number | null;
  refus: string | null;
  versionsDeTravail: string[];
  rienARamener?: boolean;
}

/** Les titres des étapes, écrits en toutes lettres pour le dictionnaire (`ETAPES_D_ARCHIVAGE` en donne l'ordre). */
function titreDEtape(sens: SensDArchivage, cle: string): string {
  switch (`${sens}:${cle}`) {
    case 'archiver:controles':
    case 'desarchiver:controles':
      return t('Contrôles avant de partir');
    case 'archiver:services':
      return t('Arrêt du site en développement');
    case 'archiver:copie':
      return t('Copie vers le disque externe');
    case 'archiver:verification':
      return t('Vérification de la copie');
    case 'archiver:liberation':
      return t('Place libérée sur le serveur');
    case 'desarchiver:copie':
      return t('Retour des fichiers sur le serveur');
    case 'desarchiver:verification':
      return t('Vérification des fichiers');
    case 'desarchiver:remise':
      return t('Remise en place du dossier');
    case 'desarchiver:services':
      return t('Relance du site en développement');
    case 'desarchiver:nettoyage':
      return t('Copie externe supprimée');
    default:
      return cle;
  }
}

function dureeLisible(secondes: number): string {
  if (secondes < 60) return t('moins d’une minute');
  const minutes = Math.round(secondes / 60);
  if (minutes < 60) return t('{n} min', { n: minutes });
  return t('{h} h {m} min', { h: Math.floor(minutes / 60), m: minutes % 60 });
}

export function FenetreDArchivage() {
  const state = useApp();
  const [demande, setDemande] = React.useState<DemandeDArchivage | null>(() => derniereDemandeDArchivage());
  const [ouverte, setOuverte] = React.useState(() => !!derniereDemandeDArchivage());
  const [estimation, setEstimation] = React.useState<Estimation | null>(null);
  const [panne, setPanne] = React.useState('');
  const [depart, setDepart] = React.useState(false);
  const [lance, setLance] = React.useState(false);

  React.useEffect(() => {
    const ecouter = (event: Event) => {
      const detail = (event as CustomEvent<DemandeDArchivage>).detail;
      setDemande(detail);
      setOuverte(true);
      setEstimation(null);
      setPanne('');
      setDepart(false);
      setLance(false);
    };
    window.addEventListener(EVENEMENT_ARCHIVAGE, ecouter);
    return () => window.removeEventListener(EVENEMENT_ARCHIVAGE, ecouter);
  }, []);

  const projet = demande ? state.projects.find((p) => p.id === demande.projectId) : undefined;
  const transfert = demande ? state.archivages[demande.projectId] : undefined;
  /* Un transfert de CE sens, en cours ou lancé d'ici : la fenêtre montre son avancement plutôt que la confirmation. */
  const suivi = transfert && demande && transfert.sens === demande.sens && (lance || !transfert.fini) ? transfert : undefined;

  React.useEffect(() => {
    if (!ouverte || !demande || suivi) return;
    let actif = true;
    client
      .call<Estimation>({ type: 'project.archivage.estimer', id: demande.projectId, sens: demande.sens }, 15 * 60 * 1000)
      .then((lu) => actif && setEstimation(lu))
      .catch((err: any) => actif && setPanne(err?.message ?? t('Impossible de mesurer le projet.')));
    return () => {
      actif = false;
    };
  }, [ouverte, demande?.n, !!suivi]);

  if (!demande) return null;
  const sens = demande.sens;
  const nom = projet?.name ?? '';
  const etapes = ETAPES_D_ARCHIVAGE[sens];

  const partir = async () => {
    if (depart) return;
    setDepart(true);
    setPanne('');
    try {
      await client.call({ type: sens === 'archiver' ? 'project.archiver' : 'project.desarchiver', id: demande.projectId }, 15 * 60 * 1000);
      setLance(true);
    } catch (err: any) {
      setPanne(err?.message ?? t('Le transfert a été refusé.'));
    } finally {
      setDepart(false);
    }
  };

  const titre =
    sens === 'archiver' ? t('Archiver « {nom} »', { nom }) : t('Désarchiver « {nom} »', { nom });
  const fini = suivi?.fini;
  const avancement = suivi ? avancementDuTransfert({ octets: suivi.octets, total: suivi.total, depuisMs: Date.now() - suivi.debutA }) : null;
  const pourcent = fini && !suivi?.erreur ? 100 : (avancement?.pourcent ?? 0);

  return (
    <Dialog open={ouverte} onOpenChange={setOuverte}>
      <DialogContent className="sm:w-[min(480px,100%)]" data-fenetre-archivage={sens} data-projet={demande.projectId}>
        <DialogHeader>
          <DialogTitle>{titre}</DialogTitle>
          {/* Rien à ramener : la phrase du corps le dit, l'entête ne promet pas un retour de fichiers. */}
          {sens === 'desarchiver' && estimation?.rienARamener ? null : (
            <DialogDescription>
              {sens === 'archiver'
                ? t('Les fichiers du projet partent sur le disque externe et libèrent la place sur le serveur. Le tableau et les conversations restent lisibles.')
                : t('Les fichiers du projet reviennent à leur place sur le serveur, puis la copie du disque externe est supprimée.')}
            </DialogDescription>
          )}
        </DialogHeader>

        {!suivi ? (
          <div className="space-y-2 text-[13.5px]" data-archivage-confirmation>
            {panne ? (
              <p className="text-danger" data-archivage-refus>
                {panne}
              </p>
            ) : !estimation ? (
              <p className="flex items-center gap-2 text-muted">
                <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />
                {sens === 'archiver' ? t('Mesure de la place à libérer…') : t('Vérification de l’archive…')}
              </p>
            ) : estimation.refus ? (
              <p className="text-danger" data-archivage-refus>
                {estimation.refus}
              </p>
            ) : (
              <>
                {sens === 'archiver' ? (
                  <p className="text-text" data-archivage-place>
                    {estimation.octets
                      ? t('{taille} seront libérés sur le disque du serveur.', { taille: tailleLisible(estimation.octets) })
                      : t('Aucun fichier à déplacer : le projet sera simplement marqué archivé.')}
                  </p>
                ) : (
                  <p className="text-text" data-archivage-place>
                    {estimation.rienARamener
                      ? t('Aucune archive sur le disque externe : seul le badge sera retiré.')
                      : t('{taille} reviendront sur le disque du serveur.', { taille: tailleLisible(estimation.octets ?? 0) })}
                  </p>
                )}
                {estimation.versionsDeTravail.length ? (
                  <p className="text-muted">
                    {sens === 'archiver'
                      ? t('Le site en développement sera arrêté, puis relancé au désarchivage.')
                      : t('Le site en développement sera relancé.')}
                  </p>
                ) : null}
                {sens === 'archiver' ? (
                  <p className="text-muted">{t('Tant qu’il est archivé, rien ne se lance sur ce projet.')}</p>
                ) : null}
              </>
            )}
          </div>
        ) : (
          <div className="space-y-3 text-[13.5px]" data-archivage-progression>
            <div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-raised" data-archivage-barre={pourcent}>
                <div
                  className={cn('h-full rounded-full transition-[width] duration-300', suivi.erreur ? 'bg-danger' : 'bg-text')}
                  style={{ width: `${pourcent}%` }}
                />
              </div>
              <div className="mt-1.5 flex items-center justify-between gap-2 text-[12.5px] text-muted">
                <span className="truncate">
                  {suivi.total
                    ? t('{fait} sur {total}', { fait: tailleLisible(Math.min(suivi.octets, suivi.total)), total: tailleLisible(suivi.total) })
                    : null}
                </span>
                <span className="shrink-0">
                  {fini ? `${pourcent} %` : avancement?.resteSecondes != null ? t('encore {duree}', { duree: dureeLisible(avancement.resteSecondes) }) : `${pourcent} %`}
                </span>
              </div>
            </div>
            <ul className="space-y-1" data-archivage-etapes>
              {etapes.map((etape) => {
                const faite = suivi.faites.includes(etape.cle);
                const enCours = suivi.enCours === etape.cle;
                return (
                  <li key={etape.cle} className={cn('flex items-center gap-2', faite || enCours ? 'text-text' : 'text-faint')} data-etape={etape.cle} data-faite={faite || undefined}>
                    {faite ? (
                      <Check className="h-3.5 w-3.5 shrink-0" />
                    ) : enCours ? (
                      <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin motion-reduce:animate-none" />
                    ) : (
                      <Circle className="h-3.5 w-3.5 shrink-0" />
                    )}
                    <span className="min-w-0 truncate">{titreDEtape(sens, etape.cle)}</span>
                  </li>
                );
              })}
            </ul>
            {suivi.erreur ? (
              <p className="text-danger" data-archivage-erreur>
                {suivi.erreur}
              </p>
            ) : fini && suivi.bilan ? (
              <p className="text-text" data-archivage-bilan>
                {suivi.bilan}
              </p>
            ) : !fini ? (
              <p className="text-muted">{t('Vous pouvez fermer cette fenêtre : le transfert continue, et le badge du projet suit son avancement.')}</p>
            ) : null}
          </div>
        )}

        <DialogFooter>
          {suivi ? (
            <Button variant="default" onClick={() => setOuverte(false)} data-archivage-fermer>
              {fini ? t('Fermer') : t('Continuer en arrière-plan')}
            </Button>
          ) : (
            <>
              <Button variant="ghost" onClick={() => setOuverte(false)}>
                {t('Annuler')}
              </Button>
              <Button
                variant="default"
                disabled={!estimation || !!estimation.refus || depart}
                onClick={partir}
                data-archivage-partir={sens}
                title={estimation?.refus ?? undefined}
              >
                {depart ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />
                ) : sens === 'archiver' ? (
                  <Archive className="h-3.5 w-3.5" />
                ) : (
                  <ArchiveRestore className="h-3.5 w-3.5" />
                )}
                {sens === 'archiver' ? t('Archiver') : t('Désarchiver')}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
