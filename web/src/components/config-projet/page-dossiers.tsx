import * as React from 'react';
import { HardDrive, Loader2, Trash2 } from 'lucide-react';
import { tailleDesCopies, type CopieMorte } from '@beluga/shared';
import { BulleInfo, Button, ZoneDefilement } from '@/components/ui';
import { client } from '@/lib/client';
import { bytes } from '@/lib/utils';
import { t } from '@/lib/langue';
import { TeteDeRubrique, type ContexteConfig } from './communs';

/**
 * LES COPIES DE TRAVAIL MORTES, ET LE GESTE QUI LES EFFACE.
 *
 * Constat : 1,3 Go de dossiers sous `.worktrees/` qu'aucun `git worktree list`
 * ne nommait plus, donc qu'aucun `git worktree prune` ne rangerait jamais —
 * invisibles, et jamais effacés. Le démon les liste (`projet.copiesMortes`,
 * règle pure `shared/src/copies-mortes.ts`) ; rien ne part sans un clic sur
 * « Nettoyer », et le démon refuse tout chemin qui n'est pas posé sous le
 * dossier des copies du projet.
 */
function CopiesDeTravail({ projectId, open }: { projectId: string; open: boolean }) {
  const [copies, setCopies] = React.useState<CopieMorte[]>([]);
  const [cochees, setCochees] = React.useState<Set<string>>(new Set());
  const [lecture, setLecture] = React.useState(false);
  const [lectureRaison, setLectureRaison] = React.useState('');
  const [nettoyage, setNettoyage] = React.useState(false);

  const lire = React.useCallback(() => {
    setLecture(true);
    setLectureRaison('');
    client
      .call<{ racine: string; copies: CopieMorte[] }>({ type: 'projet.copiesMortes', projectId }, 120000)
      .then((data) => {
        const liste = data.copies ?? [];
        setCopies(liste);
        // Tout est coché d'emblée : une copie morte n'a plus de raison d'être.
        // Décocher, c'est garder — le clic « Nettoyer » reste le seul geste.
        setCochees(new Set(liste.map((copie) => copie.chemin)));
      })
      .catch(() => {
        setCopies([]);
        setLectureRaison(t('Lecture des copies impossible.'));
      })
      .finally(() => setLecture(false));
  }, [projectId]);

  React.useEffect(() => {
    if (!open) return;
    lire();
  }, [open, lire]);

  const nettoyer = async () => {
    const chemins = copies.map((copie) => copie.chemin).filter((chemin) => cochees.has(chemin));
    if (!chemins.length) return;
    setNettoyage(true);
    try {
      const bilan = await client.call<{ effacees: string[]; refusees: { chemin: string; raison: string }[] }>(
        { type: 'projet.nettoyerCopies', projectId, chemins },
        600000,
      );
      client.pushToast('success', t('{n} copie(s) effacée(s)', { n: bilan.effacees.length }));
      if (bilan.refusees.length) {
        client.pushToast(
          'error',
          t('{n} chemin(s) refusé(s) : {raison}', { n: bilan.refusees.length, raison: bilan.refusees[0].raison }),
        );
      }
      lire();
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('Nettoyage impossible.'));
    } finally {
      setNettoyage(false);
    }
  };

  const total = tailleDesCopies(copies);
  const resume =
    copies.length === 1
      ? t('1 copie morte, {taille}', { taille: bytes(total) })
      : t('{n} copies mortes, {taille} en tout', { n: copies.length, taille: bytes(total) });

  return (
    <div data-copies-de-travail>
      <h3 className="flex items-center gap-1.5 text-[13.5px] font-medium text-text mb-2">
        <HardDrive className="h-3.5 w-3.5 text-faint" /> {t('Copies de travail')}
        <BulleInfo cote="start">{t('Les copies que git ne liste plus restent sur le disque sans que « git worktree prune » les voie. Elles sont listées ici, et rien n’est effacé sans votre clic.')}</BulleInfo>
      </h3>
      {lecture ? (
        <p className="flex items-center gap-1.5 text-[13px] text-faint">
          <Loader2 className="h-3 w-3 animate-spin" /> {t('Lecture des copies…')}
        </p>
      ) : lectureRaison ? (
        <p className="text-[13px] text-faint" data-copies-raison>{lectureRaison}</p>
      ) : copies.length === 0 ? (
        <p className="text-[13px] text-faint" data-copies-aucune>
          {t('Aucune copie morte : git connaît toutes les copies de travail de ce projet.')}
        </p>
      ) : (
        <div className="rounded-md border border-border bg-bloc" data-copies-liste>
          <p className="border-b border-faint px-2.5 py-1.5 text-[12.5px] text-muted" data-copies-resume>{resume}</p>
          <ZoneDefilement voile={false} classeEnveloppe="max-h-[220px]">
          <ul>
            {copies.map((copie) => (
              <li key={copie.chemin} className="flex items-start gap-2 px-2.5 py-1.5 text-[12.5px]" data-copie-morte={copie.chemin}>
                <input
                  type="checkbox"
                  checked={cochees.has(copie.chemin)}
                  disabled={nettoyage}
                  onChange={(event) => {
                    const suite = new Set(cochees);
                    if (event.target.checked) suite.add(copie.chemin);
                    else suite.delete(copie.chemin);
                    setCochees(suite);
                  }}
                  className="mt-0.5 h-3.5 w-3.5 shrink-0"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-mono text-[12px] text-text" title={copie.chemin}>{copie.nom}</span>
                  <span className="block truncate text-[11.5px] text-faint">
                    {copie.branche ?? t('branche inconnue')}
                    {' · '}
                    {copie.tailleOctets !== undefined ? bytes(copie.tailleOctets) : t('taille inconnue')}
                    {copie.modifieA ? ` · ${new Date(copie.modifieA).toLocaleDateString()}` : ''}
                  </span>
                </span>
              </li>
            ))}
          </ul>
          </ZoneDefilement>
          <div className="flex justify-end border-t border-faint px-2.5 py-1.5">
            <Button
              variant="subtle"
              size="sm"
              data-nettoyer-copies
              onClick={nettoyer}
              disabled={nettoyage || cochees.size === 0}
              className="gap-1.5"
            >
              {nettoyage ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
              {nettoyage ? t('Nettoyage…') : t('Nettoyer ({n})', { n: cochees.size })}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/** OÙ LE PROJET VIT : son dossier sur le serveur, ses dépôts, ses copies. */
export function RubriqueDossiers({ ctx }: { ctx: ContexteConfig }) {
  /* Les « dépôts annexes » ne se règlent plus ici : plusieurs dépôts
     travaillés ensemble se RÉUNISSENT depuis la rubrique « Projets » des
     réglages (`shared/src/regroupements.ts`), chacun gardant son projet. */
  return (
    <div data-rubrique-contenu="dossiers" className="space-y-3">
      <TeteDeRubrique
        titre={t('Dossiers et dépôts')}
        resume={t('Où le projet vit sur le serveur, ses dépôts, ses copies de travail.')}
      />

      <div className="rounded-md border border-border bg-bloc px-2.5 py-2 text-[13px] text-faint" data-dossier-projet>
        {t('Dossier sur le serveur :')} <span className="text-muted">{ctx.project.path}</span>
        {ctx.project.gitRemote ? (
          <>
            <br />
            {t('Dépôt :')} <span className="text-muted">{ctx.project.gitRemote}</span>
          </>
        ) : null}
      </div>

      <CopiesDeTravail projectId={ctx.project.id} open={ctx.open} />
    </div>
  );
}
