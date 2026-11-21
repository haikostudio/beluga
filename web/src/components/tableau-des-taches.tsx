/*
 * LE TABLEAU DES TÂCHES (décision de l'utilisateur du 14/11/2026 : « en dessous, j'aimerais avoir la liste des tâches
 * dans un tableau, mais uniquement les tâches relatives au projet […] Il faudra aussi, dans le tableau de bord, créer un
 * tableau avec les tâches […] les 15 dernières, puis la pagination du tableau »).
 *
 * UN SEUL COMPOSANT, DEUX PLACES : l'accueil d'un projet (ses tâches seules) et le tableau de bord (tous les projets,
 * avec la colonne « Projet » et son filtre). La source est celle de la liste des agents (`useCartesParDate` : la lecture
 * par date, archives comprises, et les tâches actives de la colonne) ; l'état de chaque tâche se lit comme dans la
 * colonne (`useLignesDAgents`). Les quinze dernières d'abord, puis la pagination du tableau commun ; les plus anciennes
 * se demandent au serveur d'un clic.
 */
import * as React from 'react';
import { LIBELLE_ETAT_D_AGENT, type Card, type EtatDAgentEnListe } from '@beluga/shared';
import { BadgeDEtatDAgent, DateDeLAgent, IconeDEtatDAgent, useCartesParDate, useLignesDAgents, type Ligne } from '@/components/liste-des-agents';
import { PastilleProjet } from '@/components/pastille-projet';
import { Silhouette } from '@/components/silhouettes';
import { MenuCarte } from '@/components/card-menu';
import { BoutonTroisPoints } from '@/components/ui';
import { Tableau, type ColonneDuTableauCommun } from '@/components/ui/tableau';
import { t } from '@/lib/langue';
import { useApp } from '@/lib/use-app';

/** Les quinze dernières tâches, puis la pagination. */
export const TACHES_PAR_PAGE = 15;

export function TableauDesTaches({
  projectId,
  onOuvrir,
  titre,
}: {
  projectId?: string;
  onOuvrir: (card: Card) => void;
  /** Le petit titre au-dessus du tableau ; `null` : aucun (la page porte déjà son grand titre, `PageAGrandTitre`). */
  titre?: string | null;
}) {
  const state = useApp();
  const source = useCartesParDate(projectId);
  const lignes = useLignesDAgents(source.cartes);
  const [taille, setTaille] = React.useState(TACHES_PAR_PAGE);
  const projets = React.useMemo(() => new Map(state.projects.map((p) => [p.id, p])), [state.projects]);
  /* LA LIGNE DONT LE MENU EST OUVERT : par ses trois points (au survol) ou par le clic droit, le même menu, au même
     endroit — celui de la carte dans la colonne de gauche (`MenuCarte`). */
  const [menuDe, setMenuDe] = React.useState<string | null>(null);
  const colonnes = React.useMemo<ColonneDuTableauCommun<Ligne>[]>(
    () => [
      {
        cle: 'titre',
        libelle: t('Tâche'),
        valeur: (l) => l.carte.title,
        rendu: (l) => (
          <span className="flex min-w-0 items-center gap-2.5">
            <IconeDEtatDAgent etat={l.etat} />
            <span className={l.nonLue ? 'min-w-0 truncate font-semibold text-text' : 'min-w-0 truncate text-text'} title={l.carte.title}>
              {l.carte.title || t('Sans titre')}
            </span>
          </span>
        ),
      },
      ...(projectId
        ? []
        : [
            {
              cle: 'projet',
              libelle: t('Projet'),
              largeur: 200,
              filtre: 'choix' as const,
              lireFiltre: (l: Ligne) => projets.get(l.carte.projectId)?.name ?? '',
              valeur: (l: Ligne) => projets.get(l.carte.projectId)?.name ?? '',
              masqueSurTelephone: true,
              rendu: (l: Ligne) => {
                const projet = projets.get(l.carte.projectId);
                return projet ? (
                  <span className="flex min-w-0 items-center gap-2">
                    <PastilleProjet project={projet} taille={16} />
                    <span className="min-w-0 truncate text-muted">{projet.name}</span>
                  </span>
                ) : null;
              },
            },
          ]),
      {
        cle: 'etat',
        libelle: t('État'),
        largeur: 150,
        filtre: 'choix',
        lireFiltre: (l) => l.etat,
        libelleDuChoix: (v) => t(LIBELLE_ETAT_D_AGENT[v as EtatDAgentEnListe] ?? v),
        valeur: (l) => l.etat,
        rendu: (l) => <BadgeDEtatDAgent etat={l.etat} famille={l.famille} />,
      },
      {
        cle: 'activite',
        libelle: t('Dernière activité'),
        largeur: 150,
        droite: true,
        sensNaturel: 'desc',
        valeur: (l) => l.activite,
        rendu: (l) => <DateDeLAgent at={l.activite} courte />,
      },
      {
        cle: 'menu',
        libelle: '',
        largeur: 44,
        droite: true,
        rendu: (l) => <MenuDeLaTache ligne={l} ouvert={menuDe === l.carte.id} changer={(o) => setMenuDe(o ? l.carte.id : null)} />,
      },
    ],
    [projectId, projets, menuDe],
  );
  /* LA SUITE AVANT LE PIED (16/11/2026, capture #39779) : « Charger les tâches plus anciennes » et l'erreur se posent
     entre les lignes et la barre de pagination, qui reste ainsi collée au bas de l'écran même en bout de liste. */
  const suite =
    source.reste || source.erreur ? (
      <div className="flex flex-col items-start gap-1 pt-2">
        {source.reste ? (
          <button
            type="button"
            className="rounded-lg px-2 py-1 text-[13px] text-muted transition-colors hover:bg-raised hover:text-text"
            onClick={() => source.chargerLaSuite()}
            data-taches-plus-anciennes
          >
            {t('Charger les tâches plus anciennes')}
          </button>
        ) : null}
        {source.erreur ? <p className="text-[13px] text-faint">{source.erreur}</p> : null}
      </div>
    ) : null;
  return (
    <section className="flex min-w-0 flex-col gap-3" data-tableau-des-taches={projectId ?? 'tous'} data-liste-des-agents="tableau">
      {titre === null ? null : <h2 className="text-[15px] font-semibold text-text">{titre ?? t('Tâches')}</h2>}
      {source.enAttente ? (
        <div className="flex flex-col gap-2" data-silhouette-des-taches>
          {Array.from({ length: 6 }, (_, i) => (
            <Silhouette key={i} className="h-11 w-full rounded-lg" />
          ))}
        </div>
      ) : (
        <Tableau
          repere={projectId ? 'taches-du-projet' : 'taches-de-tous-les-projets'}
          lignes={lignes}
          colonnes={colonnes}
          cle={(l) => l.carte.id}
          onLigne={(l) => onOuvrir(l.carte)}
          onClicDroit={(l) => setMenuDe(l.carte.id)}
          triInitial={{ colonne: 'activite', sens: 'desc' }}
          taille={taille}
          onTaille={setTaille}
          aere
          vide={projectId ? t('Aucune tâche dans ce projet pour l’instant.') : t('Aucune tâche pour l’instant.')}
          apresLesLignes={suite}
        />
      )}
      {source.enAttente && source.erreur ? <p className="text-[13px] text-faint">{source.erreur}</p> : null}
    </section>
  );
}

/**
 * LES TROIS POINTS D'UNE LIGNE DE TÂCHE : un simple bouton tant que le menu n'a jamais été ouvert (rien de lourd par
 * ligne), puis le menu de la carte, gardé monté — ses fenêtres (renommer, supprimer, confirmer un déplacement qui
 * dépense) vivent dans le même composant et partiraient avec lui.
 */
function MenuDeLaTache({ ligne, ouvert, changer }: { ligne: Ligne; ouvert: boolean; changer: (ouvert: boolean) => void }) {
  const [monte, setMonte] = React.useState(false);
  if (ouvert && !monte) setMonte(true);
  const bouton = <BoutonTroisPoints ouvert={ouvert} className="-my-1 ml-auto" data-menu-de-tache={ligne.carte.id} />;
  if (!monte) return React.cloneElement(bouton, { onClick: (event: React.MouseEvent) => { event.stopPropagation(); changer(true); } });
  return (
    <span className="flex justify-end" onClick={(event) => event.stopPropagation()}>
      <MenuCarte card={ligne.carte} open={ouvert} onOpenChange={changer} agentActif={ligne.auTravail} declencheur={bouton} />
    </span>
  );
}
