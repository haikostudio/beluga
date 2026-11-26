/*
 * L'ONGLET « TÂCHES » D'UN PROJET (maquette #1863, carte « Beluga piloté par des agents », 26/11/2026) : les tâches du
 * projet rangées par ÉTAT — Vous attendent, En cours, Planifiées, Prêtes à déployer, puis « Voir les n terminées »
 * replié —, chaque ligne avec le visage de l'agent qui la porte, son titre, « prénom · demandée par … » et son état en
 * formes (point « à vous », anneau au travail, coche prête). Les cartes ordinaires sont portées par l'agent de
 * développement du projet. La liste complète de TOUS les projets reste dans « Tableaux de bord » : rien ne se perd.
 */
import * as React from 'react';
import { GROUPES_DE_TACHES, groupeDeLaTache, type Card, type GroupeDeTaches } from '@beluga/shared';
import { useCartesParDate, useLignesDAgents, type Ligne } from '@/components/liste-des-agents';
import { PortraitDAgent } from '@/components/equipe/portrait-d-agent';
import type { MembreLu } from '@/components/equipe/use-equipe';
import { SilhouetteProjets } from '@/components/silhouettes';
import { Check } from '@/components/ui/icones';
import { t } from '@/lib/langue';
import { cn } from '@/lib/utils';

function titreDuGroupe(g: GroupeDeTaches): string {
  switch (g) {
    case 'vous-attendent':
      return t('Vous attendent');
    case 'en-cours':
      return t('En cours');
    case 'planifiees':
      return t('Planifiées');
    case 'pretes':
      return t('Prêtes à déployer');
    default:
      return t('Terminées');
  }
}

/** Qui a demandé la tâche : un agent de l'équipe (par sa conversation), un agent sans nom, ou vous. */
function demandeur(carte: Card, membres: readonly MembreLu[]): string {
  if (carte.origineAgentId) {
    const m = membres.find((x) => x.agentId === carte.origineAgentId);
    if (m) return m.fiche.nom;
  }
  return carte.origin === 'agent' ? t('un agent') : t('vous');
}

export function TachesDeLEquipe({
  projectId,
  membres,
  onOuvrir,
}: {
  projectId: string;
  membres: readonly MembreLu[];
  onOuvrir: (card: Card) => void;
}) {
  const source = useCartesParDate(projectId);
  const cartes = React.useMemo(() => source.cartes.filter((c) => !(c.labels ?? []).includes('agent-perso')), [source.cartes]);
  const lignes = useLignesDAgents(cartes);
  const [terminees, setTerminees] = React.useState(false);
  const dev = membres.find((m) => m.role === 'dev') ?? null;
  const groupes = React.useMemo(() => {
    const g = new Map<GroupeDeTaches, Ligne[]>();
    for (const l of lignes) {
      const cle = groupeDeLaTache(l.etat);
      g.set(cle, [...(g.get(cle) ?? []), l]);
    }
    return g;
  }, [lignes]);
  if (source.enAttente) return <SilhouetteProjets lignes={5} />;
  const nombreTerminees = groupes.get('terminees')?.length ?? 0;
  const visibles = GROUPES_DE_TACHES.filter((g) => g !== 'terminees' && (groupes.get(g)?.length ?? 0) > 0);
  return (
    <div className="flex flex-col gap-5 pb-2" data-taches-de-l-equipe={projectId}>
      {!visibles.length && !nombreTerminees ? (
        <p className="pt-2 text-[13.5px] text-muted">{t('Aucune tâche pour l’instant : écrivez à l’équipe, ou créez-en une avec le bouton du bas.')}</p>
      ) : null}
      {visibles.map((g) => (
        <GroupeDeLignes key={g} titre={titreDuGroupe(g)} cle={g} lignes={groupes.get(g) ?? []} dev={dev} membres={membres} onOuvrir={onOuvrir} />
      ))}
      {nombreTerminees ? (
        terminees ? (
          <GroupeDeLignes titre={titreDuGroupe('terminees')} cle="terminees" lignes={groupes.get('terminees') ?? []} dev={dev} membres={membres} onOuvrir={onOuvrir} />
        ) : (
          <button
            type="button"
            onClick={() => setTerminees(true)}
            className="self-start rounded-md px-1 py-1 text-[13.5px] text-muted transition-colors hover:text-text"
            data-voir-les-terminees={nombreTerminees}
          >
            {t('Voir les {v0} terminées', { v0: nombreTerminees })}
          </button>
        )
      ) : null}
      {source.reste && terminees ? (
        <button type="button" onClick={() => source.chargerLaSuite(20)} className="self-start rounded-md px-1 py-1 text-[13.5px] text-muted hover:text-text" data-voir-plus={projectId}>
          {t('Voir plus')}
        </button>
      ) : null}
    </div>
  );
}

function GroupeDeLignes({
  titre,
  cle,
  lignes,
  dev,
  membres,
  onOuvrir,
}: {
  titre: string;
  cle: GroupeDeTaches;
  lignes: Ligne[];
  dev: MembreLu | null;
  membres: readonly MembreLu[];
  onOuvrir: (card: Card) => void;
}) {
  return (
    <section data-groupe-de-taches={cle}>
      <h3 className="px-1 pb-1 text-[13px] text-faint">{titre}</h3>
      <ul className="flex flex-col">
        {lignes.map((l) => {
          const porteur = dev;
          return (
            <li key={l.carte.id}>
              <button
                type="button"
                onClick={() => onOuvrir(l.carte)}
                className="flex w-full min-w-0 items-center gap-3 rounded-xl px-1 py-2.5 text-left transition-colors hover:bg-raised/60"
                data-tache-de-l-equipe={l.carte.id}
                data-etat-tache={l.etat}
              >
                {porteur ? (
                  <PortraitDAgent portrait={porteur.portrait} couleur={porteur.couleur} nom={porteur.fiche.nom} taille={36} cerne />
                ) : (
                  <span className="h-9 w-9 shrink-0 rounded-full bg-raised" />
                )}
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-[14px] font-medium text-text">{l.carte.title}</span>
                  <span className="truncate text-[12.5px] text-faint">
                    {porteur ? `${porteur.fiche.nom} · ` : ''}
                    {t('demandée par {v0}', { v0: demandeur(l.carte, membres) })}
                  </span>
                </span>
                <FinDeLigne groupe={cle} />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** L'état en formes, au bout de la ligne : « À vous » (point), anneau au travail, coche prête. */
function FinDeLigne({ groupe }: { groupe: GroupeDeTaches }) {
  if (groupe === 'vous-attendent')
    return (
      <span className="flex shrink-0 items-center gap-1.5 text-[13px] font-medium text-important" data-fin-de-ligne="a-vous">
        <span aria-hidden className="block h-2 w-2 rounded-full bg-important" />
        {t('À vous')}
      </span>
    );
  if (groupe === 'en-cours')
    return (
      <span aria-hidden className="flex h-4 w-4 shrink-0 items-center justify-center" data-fin-de-ligne="travail">
        <span className="block h-3.5 w-3.5 animate-spin rounded-full border-[1.5px] border-muted border-r-transparent" />
      </span>
    );
  if (groupe === 'pretes') return <Check aria-hidden className={cn('h-4 w-4 shrink-0 text-muted')} data-fin-de-ligne="prete" />;
  return null;
}
