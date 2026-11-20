import * as React from 'react';
import { Archive, ArchiveRestore, Loader2 } from '@/components/ui/icones';
import { DOSSIER_DES_ARCHIVES_DE_PROJETS, tailleLisible, type MouvementDArchivage } from '@beluga/shared';
import { Button, CLASSE_GROUPE_DE_LIGNES, Switch } from '@/components/ui';
import { client } from '@/lib/client';
import { EVENEMENT_MOUVEMENT_D_ARCHIVAGE } from '@/lib/archivage-projet';
import { useApp } from '@/lib/use-app';
import { t } from '@/lib/langue';
import { cn, dateHeure } from '@/lib/utils';
import { TeteDeRubrique, type ContexteConfig } from './communs';

/**
 * LA RUBRIQUE « ARCHIVAGE » DE LA CONFIGURATION D'UN PROJET (carte « Archivage des projets : page, historique,
 * automatique », 20/11/2026). L'archivage était caché sous le bouton rouge « Supprimer » : il a sa rubrique, sous
 * « Client et tarif ».
 *
 * Elle dit où en est le projet (sur le serveur, archivé, en transfert, en échec), depuis quand il n'a pas eu de
 * tâche et dans combien de jours la nuit l'archivera seule, ce qu'il pèse, où vit son archive sur le disque de
 * stockage, et l'HISTORIQUE de ses mouvements. Le bouton ouvre la fenêtre d'archivage existante
 * (`ouvrirLArchivage`) ; l'interrupteur « Ne jamais archiver automatiquement » s'applique AU CLIC, comme les
 * gestes d'archivage — il ne passe pas par « Enregistrer ».
 */

interface EtatDeLaRubrique {
  mouvements: MouvementDArchivage[];
  jours: number;
  derniereActivite: number;
  joursRestants: number | null;
  horsAuto: string | null;
}

const JOUR_MS = 24 * 60 * 60 * 1000;

function ilYA(quand: number): string {
  const jours = Math.floor((Date.now() - quand) / JOUR_MS);
  if (jours <= 0) return t('aujourd’hui');
  if (jours === 1) return t('hier');
  return t('il y a {n} jours', { n: jours });
}

function libelleDuMouvement(m: MouvementDArchivage): string {
  const auto = m.origine === 'auto';
  if (m.sens === 'archiver') {
    if (m.issue === 'reussi') return auto ? t('Archivé automatiquement') : t('Archivé');
    if (m.issue === 'refus') return auto ? t('Archivage automatique refusé') : t('Archivage refusé');
    return auto ? t('Archivage automatique échoué') : t('Archivage échoué');
  }
  if (m.issue === 'reussi') return t('Désarchivé');
  if (m.issue === 'refus') return t('Désarchivage refusé');
  return t('Désarchivage échoué');
}

function Chiffre({ titre, valeur, repere }: { titre: string; valeur: string; repere: string }) {
  return (
    <div className="min-w-0 rounded-xl bg-raised px-3 py-2.5" data-archivage-chiffre={repere}>
      <p className="truncate text-[12px] text-faint">{titre}</p>
      <p className="truncate text-[15px] font-medium text-text">{valeur}</p>
    </div>
  );
}

export function RubriqueArchivage({ ctx }: { ctx: ContexteConfig }) {
  const { project } = ctx;
  const transfert = useApp().archivages[project.id];
  const enTransfert = !!transfert && !transfert.fini;
  const [etat, setEtat] = React.useState<EtatDeLaRubrique | null>(null);
  const [place, setPlace] = React.useState<{ octets: number | null; refus: string | null } | null>(null);
  const [erreur, setErreur] = React.useState<string | null>(null);
  const [exemptionEnVol, setExemptionEnVol] = React.useState(false);

  const relire = React.useCallback(() => {
    client
      .call({ type: 'project.archivage.historique', id: project.id })
      .then((r: any) => setEtat(r as EtatDeLaRubrique))
      .catch((err: any) => setErreur(err?.message ?? t('La lecture a échoué.')));
  }, [project.id]);

  React.useEffect(() => {
    if (!ctx.open) return;
    relire();
    const surMouvement = (e: Event) => {
      if ((e as CustomEvent<string>).detail === project.id) relire();
    };
    window.addEventListener(EVENEMENT_MOUVEMENT_D_ARCHIVAGE, surMouvement);
    return () => window.removeEventListener(EVENEMENT_MOUVEMENT_D_ARCHIVAGE, surMouvement);
  }, [ctx.open, project.id, relire]);

  /* LA PLACE SUR LE SERVEUR : lue à l'ouverture (et après chaque transfert) — un projet archivé n'en occupe plus. */
  React.useEffect(() => {
    if (!ctx.open || enTransfert) return;
    if (project.archived) {
      setPlace({ octets: null, refus: null });
      return;
    }
    let vivant = true;
    setPlace(null);
    client
      .call({ type: 'project.archivage.estimer', id: project.id, sens: 'archiver' }, 10 * 60_000)
      .then((r: any) => vivant && setPlace({ octets: r?.octets ?? null, refus: r?.refus ?? null }))
      .catch(() => vivant && setPlace({ octets: null, refus: null }));
    return () => {
      vivant = false;
    };
  }, [ctx.open, project.id, project.archived, enTransfert]);

  const basculerLExemption = async (exempte: boolean) => {
    setExemptionEnVol(true);
    setErreur(null);
    try {
      await client.call({ type: 'project.archivage.exempter', id: project.id, exempte });
      relire();
    } catch (err: any) {
      setErreur(err?.message ?? t('La commande a échoué.'));
    } finally {
      setExemptionEnVol(false);
    }
  };

  const derniereArchive = etat?.mouvements.find((m) => m.sens === 'archiver' && m.issue === 'reussi' && m.octetsArchive);
  const archive = project.archive;
  const enEchec = archive?.etat === 'echec';

  /* L'ÉTAT, en une ligne : la forme dit l'état (rond plein, carré, rond qui tourne), jamais la couleur seule. */
  const titreEtat = enTransfert
    ? transfert!.sens === 'archiver'
      ? t('Archivage en cours…')
      : t('Désarchivage en cours…')
    : project.archived
      ? t('Archivé sur le disque de stockage')
      : t('Sur le serveur');

  const echeance = (() => {
    if (!etat) return null;
    const derniere = t('Dernière tâche {quand}', { quand: ilYA(etat.derniereActivite) });
    if (project.archived) return derniere;
    if (project.isSelf) return `${derniere} · ${t('ne s’archive jamais')}`;
    if (etat.horsAuto || etat.joursRestants === null) {
      return `${derniere} · ${etat.jours ? t('archivage automatique coupé pour ce projet') : t('archivage automatique coupé pour tous les projets')}`;
    }
    return `${derniere} · ${
      etat.joursRestants === 0
        ? t('archivage automatique cette nuit')
        : t('archivage automatique dans {n} jours', { n: etat.joursRestants })
    }`;
  })();

  const exemptionPossible = !project.isSelf && !project.regroupement && !project.marqueSansDepot;

  return (
    <div data-rubrique-contenu="archivage" data-rubrique-archivage className="space-y-4">
      <TeteDeRubrique
        titre={t('Archivage')}
        resume={t('Où en est le projet, ce qu’il pèse, où vit son archive, et l’historique de ses mouvements.')}
        aide={t('Archiver envoie tous les fichiers du projet sur le disque de stockage pour libérer la place sur le serveur. Le projet reste dans la colonne avec un badge, son tableau et ses conversations restent lisibles, et il revient d’un clic. Chaque nuit, un projet sans tâche depuis le délai réglé part tout seul, sauf s’il sert un site en ligne ou qu’un agent y travaille.')}
      />

      {/* --------------------------- L'ÉTAT --------------------------- */}
      <section className="space-y-1" data-archivage-etat={enTransfert ? 'transfert' : project.archived ? 'archive' : enEchec ? 'echec' : 'serveur'}>
        <p className="flex items-center gap-2 text-[14px] font-medium text-text">
          {enTransfert ? (
            <Loader2 className="h-3 w-3 shrink-0 animate-spin text-muted" />
          ) : project.archived ? (
            <span className="h-2 w-2 shrink-0 rounded-[2px] bg-muted" aria-hidden />
          ) : (
            <span className="h-2 w-2 shrink-0 rounded-full bg-text" aria-hidden />
          )}
          <span className="min-w-0 truncate">{titreEtat}</span>
        </p>
        {echeance ? (
          <p className="text-[13px] text-muted" data-archivage-echeance>
            {echeance}
          </p>
        ) : (
          <div className="h-4 w-64 max-w-full animate-pulse rounded bg-raised" aria-hidden />
        )}
        {enEchec && !enTransfert && archive?.erreur ? (
          <p className="rounded-md bg-danger/10 px-2.5 py-1.5 text-[12.5px] text-danger" data-archivage-dernier-echec>
            {t('Dernier transfert interrompu : {raison}', { raison: archive.erreur })}
          </p>
        ) : null}
      </section>

      {/* -------------------------- LES CHIFFRES -------------------------- */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3" data-archivage-chiffres>
        <Chiffre
          repere="place"
          titre={t('Place sur le serveur')}
          valeur={project.archived ? t('Libérée') : place ? (place.octets ? tailleLisible(place.octets) : '—') : '…'}
        />
        <Chiffre
          repere="archive"
          titre={project.archived ? t('Taille de l’archive') : t('Dernière archive')}
          valeur={
            project.archived && archive?.octetsArchive
              ? tailleLisible(archive.octetsArchive)
              : derniereArchive?.octetsArchive
                ? tailleLisible(derniereArchive.octetsArchive)
                : '—'
          }
        />
        <Chiffre
          repere="fichiers"
          titre={project.archived ? t('Fichiers archivés') : t('Dernier archivage')}
          valeur={
            project.archived
              ? archive?.entrees
                ? archive.entrees.toLocaleString()
                : '—'
              : derniereArchive
                ? dateHeure(derniereArchive.quand)
                : t('Jamais')
          }
        />
      </div>

      {/* ------------------- LE DOSSIER SUR LE DISQUE ------------------- */}
      <section className="space-y-1" data-archivage-dossier>
        <p className="text-[12.5px] text-faint">
          {project.archived && archive?.chemin ? t('Archive sur le disque de stockage') : t('Dossier des archives sur le disque de stockage')}
        </p>
        <p className="select-text break-all rounded-md bg-raised px-2.5 py-1.5 font-mono text-[12.5px] text-text">
          {project.archived && archive?.chemin ? archive.chemin : `${DOSSIER_DES_ARCHIVES_DE_PROJETS}/`}
        </p>
      </section>

      {/* ------------------------ L'INTERRUPTEUR ------------------------ */}
      {exemptionPossible ? (
        <label className="flex cursor-pointer items-start justify-between gap-3" data-archivage-exemption>
          <span className="min-w-0">
            <span className="block text-[13.5px] font-medium text-text">{t('Ne jamais archiver automatiquement')}</span>
            <span className="block text-[12.5px] text-muted">
              {t('Ce projet reste sur le serveur même sans tâche pendant {n} jours. Il reste archivable à la main.', {
                n: etat?.jours || 30,
              })}
            </span>
          </span>
          <Switch
            checked={!!project.archivageAutoDesactive}
            attente={exemptionEnVol}
            onCheckedChange={(v) => void basculerLExemption(v)}
            data-interrupteur-exemption={project.archivageAutoDesactive ? 'oui' : 'non'}
          />
        </label>
      ) : null}

      {erreur ? (
        <p className="rounded-md bg-danger/10 px-2.5 py-1.5 text-[12.5px] text-danger" data-archivage-erreur>
          {erreur}
        </p>
      ) : null}

      {/* -------------------------- L'HISTORIQUE -------------------------- */}
      <section className="space-y-2" data-archivage-historique>
        <h3 className="text-[13.5px] font-medium text-text">{t('Historique des mouvements')}</h3>
        {!etat ? (
          <div className={CLASSE_GROUPE_DE_LIGNES} aria-hidden>
            {[0, 1].map((i) => (
              <div key={i} className="h-11 animate-pulse rounded-xl bg-raised" />
            ))}
          </div>
        ) : etat.mouvements.length ? (
          <ul className={CLASSE_GROUPE_DE_LIGNES}>
            {etat.mouvements.map((m) => (
              <li key={m.id} className="rounded-xl px-3.5 py-2.5" data-mouvement={`${m.sens}:${m.issue}:${m.origine}`}>
                <div className="flex items-baseline gap-3">
                  <span className="min-w-0 flex-1 truncate text-[13.5px] text-text">
                    {libelleDuMouvement(m)}
                    {m.issue === 'reussi' && m.octets ? (
                      <span className="text-muted">
                        {' — '}
                        {m.sens === 'archiver' ? t('{taille} libérés', { taille: tailleLisible(m.octets) }) : t('{taille} ramenés', { taille: tailleLisible(m.octets) })}
                      </span>
                    ) : null}
                  </span>
                  <span className="shrink-0 text-[12px] text-faint">{dateHeure(m.quand)}</span>
                </div>
                {m.issue !== 'reussi' && m.detail ? (
                  <p className={cn('mt-0.5 text-[12.5px]', m.issue === 'echec' ? 'text-danger' : 'text-muted')}>{m.detail}</p>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[13px] text-muted" data-archivage-historique-vide>
            {t('Ce projet n’a encore jamais été archivé.')}
          </p>
        )}
      </section>

      {/* ---------------------------- LE GESTE ---------------------------- */}
      {!project.isSelf ? (
        <div className="space-y-1.5 pt-1">
          {!project.archived && place?.refus && !enTransfert ? (
            <p className="text-[12.5px] text-muted" data-archivage-refus-annonce>
              {place.refus}
            </p>
          ) : null}
          <Button variant="subtle" size="sm" data-archiver-projet onClick={ctx.archiver}>
            {project.archived ? <ArchiveRestore className="h-3 w-3" /> : <Archive className="h-3 w-3" />}
            {enTransfert ? t('Voir le transfert…') : project.archived ? t('Désarchiver…') : t('Archiver maintenant…')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
