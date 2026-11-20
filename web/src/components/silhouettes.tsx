/*
 * LES SILHOUETTES DE CONTENU (skeletons) — ce qu'on montre PENDANT que les
 * données arrivent, à la place d'un écran vide.
 *
 * Au démarrage, l'application connaît sa mise en page bien avant de connaître
 * ses données : la colonne de gauche, les colonnes du tableau et la
 * conversation existent déjà, seuls leurs contenus manquent. Sans rien
 * afficher, l'écran disait « Aucun projet inscrit » puis « Aucun projet
 * sélectionné » — deux phrases FAUSSES, qui annoncent un vide alors que le
 * chargement est en cours, et qui font paraître l'attente beaucoup plus longue.
 *
 * Règle tenue ici : une silhouette dessine la FORME du contenu attendu (une
 * ligne de projet, une carte, une bulle de message), au bon endroit et à la
 * bonne taille, et ne dit JAMAIS un état vide. Un état vide ne s'affiche
 * qu'une fois les données réellement reçues.
 */
import * as React from 'react';
import { Loader2 } from '@/components/ui/icones';
import {
  COLONNES_DEMANDE,
  TITRES_COLONNES_DEMANDE,
} from '@beluga/shared';
import { cn } from '@/lib/utils';
import { t } from '@/lib/langue';
import { useTelephone } from '@/lib/telephone';
import { CLASSE_GROUPE_DE_LIGNES, DialogTitle } from '@/components/ui';

/**
 * La brique de base : un bloc gris qui respire. Elle emprunte la couleur des
 * bordures du thème — donc elle suit le mode sombre comme le mode clair sans
 * qu'aucune teinte ne soit écrite en dur.
 */
export function Silhouette({ className }: { className?: string }) {
  const enFond = React.useContext(EnFondDEtatVide);
  return <div aria-hidden className={cn(enFond ? 'rounded bg-border' : 'animate-silhouette rounded bg-border', className)} />;
}

/**
 * UNE SILHOUETTE POSÉE EN FOND D'UN ÉTAT VIDE (20/11/2026, `EtatVideDuProjet fond`) n'est PAS une attente : elle ne
 * respire pas, ne se dit pas « Chargement en cours » et ne porte pas `data-silhouette` (les contrôles y lisent un
 * chargement). Elle ne sert qu'à montrer la forme que prendra la page.
 */
const EnFondDEtatVide = React.createContext(false);
export function FondDEtatVide({ children }: { children: React.ReactNode }) {
  return <EnFondDEtatVide.Provider value>{children}</EnFondDEtatVide.Provider>;
}

/**
 * Le conteneur d'un bloc de silhouettes. Il porte le rôle d'attente pour les
 * lecteurs d'écran (`aria-busy`) et un repère d'essai commun, `data-silhouette`,
 * que les scripts de vérification interrogent.
 */
function Bloc({
  zone,
  className,
  children,
}: {
  zone: string;
  className?: string;
  children: React.ReactNode;
}) {
  if (React.useContext(EnFondDEtatVide)) return <div className={className}>{children}</div>;
  return (
    <div data-silhouette={zone} role="status" aria-busy="true" aria-label="Chargement en cours" className={className}>
      <span className="sr-only">{t('Chargement en cours…')}</span>
      {children}
    </div>
  );
}

/** Des largeurs qui varient : des barres toutes égales ne ressemblent à rien. */
const LARGEURS = ['w-[72%]', 'w-[54%]', 'w-[83%]', 'w-[61%]', 'w-[76%]', 'w-[48%]'];

/* ------------------------------------------------------------------ */
/* Les projets du service Marketing (la colonne de gauche n'en a plus)  */
/* ------------------------------------------------------------------ */

/** Au gabarit de `CLASSE_LIGNE_DE_SERVICE`. */
export function SilhouetteProjets({ lignes = 5 }: { lignes?: number }) {
  return (
    <Bloc zone="projets">
      {Array.from({ length: lignes }, (_, index) => (
        <div key={index} className="flex min-h-9 items-center gap-2.5 rounded-lg px-2.5 py-1.5">
          <Silhouette className="h-4 w-4 shrink-0 rounded-sm" />
          <Silhouette className={cn('h-3', LARGEURS[index % LARGEURS.length])} />
        </div>
      ))}
    </Bloc>
  );
}

/* ------------------------------------------------------------------ */
/* La page « En route » : la ligne de tête et la carte                 */
/* ------------------------------------------------------------------ */

/** La grille des bandes en tête de la page « En route ». */
export const GRILLE_EN_ROUTE = 'grid grid-cols-1 gap-4';

/**
 * LA PAGE ENTIÈRE EN ATTENTE, posée ICI, dans le premier morceau, et non dans
 * celui de la page : elle tient la place pendant que la page elle-même se
 * télécharge. La même colonne que la vraie page (`en-route.tsx`) : le champ de
 * recherche, puis la liste unique des agents.
 */
export function SilhouetteEnRoute() {
  const telephone = useTelephone();
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-bg" data-silhouette-page-en-route>
      <div className={cn('mx-auto flex min-h-0 w-full flex-1 flex-col overflow-hidden', !telephone && 'max-w-[820px] px-6 pt-4')}>
        <div className={cn('shrink-0 pb-2', telephone ? 'px-4 pt-3' : 'pt-1')}>
          <div className="h-[38px] rounded-lg bg-surface sm:h-8" data-silhouette-recherche />
        </div>
        <div className={telephone ? 'px-2' : undefined}>
          <SilhouetteAgents lignes={8} pleinePage={telephone} avecProjet />
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* La conversation : quelques bulles alternées                         */
/* ------------------------------------------------------------------ */

/** Au gabarit du fil (`chat.tsx`, `message-view.tsx`) : l'agent en pleine largeur, sans bulle ; la demande en bulle à droite. */
export function SilhouetteConversation({ bulles = 4 }: { bulles?: number }) {
  return (
    <Bloc zone="conversation" className="flex flex-col gap-4 p-3">
      {Array.from({ length: bulles }, (_, index) =>
        index % 2 === 1 ? (
          <div key={index} className="flex justify-end">
            <div className="flex w-[min(78%,520px)] flex-col gap-1.5 rounded-lg rounded-br-sm bg-raised px-3 py-2">
              <Barre className={cn('h-3', LARGEURS[index % LARGEURS.length])} />
              <Barre className="h-3 w-[90%]" />
            </div>
          </div>
        ) : (
          <div key={index} className="flex flex-col gap-1.5">
            <Barre className={cn('h-3', LARGEURS[index % LARGEURS.length])} />
            <Barre className="h-3 w-[90%]" />
            <Barre className="h-3 w-[65%]" />
          </div>
        ),
      )}
    </Bloc>
  );
}

/* ------------------------------------------------------------------ */
/* Le parcours d'une carte : les six points, sans leur état            */
/* ------------------------------------------------------------------ */

/**
 * LE FLUX EN POINTS, PENDANT QUE SON JOURNAL ARRIVE.
 *
 * Le parcours se calcule sur le journal de la carte, demandé APRÈS le premier
 * rendu. Sur un journal encore absent, le calcul tournait quand même : la
 * carte rouverte en plein travail annonçait « Demande » et « Travail » en
 * cours à la fois, et une préparation de tour vieille d'une heure. Elle
 * inventait, faute de données.
 *
 * Tant que le journal n'est pas là, on montre donc la FORME du parcours — les
 * ronds, la ligne verticale, les titres gris — et aucun état.
 */
export function SilhouetteParcours({ points = 4 }: { points?: number }) {
  return (
    <Bloc zone="parcours" className="px-3 py-3">
      <ol className="relative flex flex-col gap-6">
        <span className="absolute bottom-6 top-6 left-[11px] w-px bg-faint/40" aria-hidden />
        {Array.from({ length: points }, (_, index) => (
          <li key={index} className="relative flex gap-2.5">
            <Silhouette className="z-10 h-[22px] w-[22px] shrink-0 rounded-full" />
            <div className="flex-1 space-y-1.5 pt-0.5">
              <Silhouette className={cn('h-3', LARGEURS[index % LARGEURS.length])} />
              <Silhouette className="h-2.5 w-[46%]" />
            </div>
          </li>
        ))}
      </ol>
    </Bloc>
  );
}

/* ------------------------------------------------------------------ */
/* La page d'une carte : le fil en attente, puis le pied de saisie       */
/* ------------------------------------------------------------------ */

/**
 * LA PAGE D'UNE CARTE, TANT QU'ELLE N'A RIEN DIT.
 *
 * Une carte arrive dans le magasin avec l'instantané de son projet ; son JOURNAL et
 * son FIL, eux, ne sont réclamés qu'à l'ouverture. Cette silhouette prend la place du
 * corps de la page, sans AUCUNE couleur d'état ni étape inventée. Le titre vit dans la
 * barre d'en-tête, déjà réelle (`card-panel.tsx`), et la page n'a plus de rangée d'onglets.
 *
 * ELLE NE DESSINE QUE CE QUI NE BOUGERA PAS : le PIED DE SAISIE, toujours là et toujours
 * à la même hauteur. Au-dessus, un seul signal : le rond qui tourne.
 */
export function SilhouetteTiroirCarte() {
  return (
    <Bloc zone="tiroir-carte" className="flex min-h-0 flex-1 flex-col">
      {/* Le tiroir reste une boîte de dialogue : elle DOIT porter son titre
          pour les lecteurs d'écran, même quand il n'y a rien à lire encore. */}
      <DialogTitle className="sr-only">{t('Chargement de la tâche')}</DialogTitle>
      {/* AU-DESSUS DU PIED, RIEN QU'UN ROND QUI TOURNE : le « chargement » que l'on
          cherche des yeux quand un écran attend. Il prend tout l'espace restant,
          donc il tombe en son centre. */}
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <Loader2 data-silhouette-rond className="h-6 w-6 animate-spin text-faint" />
      </div>

      {/* LE PIED DE SAISIE, AUX MARGES ET AUX HAUTEURS DU VRAI (`composer.tsx`,
          monté par `chat.tsx`) : le bandeau du geste principal sur toute la
          largeur, puis le champ d'écriture et sa rangée d'icônes — deux à
          gauche (joindre, contexte), deux à droite (micro, envoi). Le vrai pied
          le remplace sans rien décaler : 36 px pour le bandeau, la ligne des
          étapes décrochée au-dessus du champ, 85 px pour le champ, mesurés sur le vrai. La bande de travail (« l'agent
          attend… ») en est absente : elle ne paraît que par moments, et un
          gris qui s'ajoute vaut moins qu'un pied stable. Les briques restent
          en `bg-raised` : posées sur `--surface`, celles en `--border`
          disparaissent dans les palettes sombres. */}
      <div className="shrink-0 px-4 pt-2 pb-2" data-silhouette-pied>
        <div className="mb-2">
          <Silhouette className="h-9 w-full rounded-lg bg-raised" />
        </div>
        {/* LA LIGNE DES ÉTAPES, DÉCROCHÉE AU-DESSUS DU CHAMP ET À SA LARGEUR (13/11/2026) : un rond, le nom de l'étape,
            son rang ; elle passe sous le champ de 12 px, comme la vraie (`TravailEnCours`, `chat.tsx`). */}
        <div className="relative z-0 -mb-3 rounded-t-lg bg-decroche px-3 pb-5 pt-1" data-silhouette-etapes>
          <div className="flex h-5 items-center gap-2">
            <Silhouette className="h-3.5 w-3.5 shrink-0 rounded-full bg-raised" />
            <Silhouette className="h-3 w-28 bg-raised" />
          </div>
        </div>
        <div className="relative z-10 flex h-[85px] flex-col justify-between rounded-lg border border-border bg-bg">
          <div className="flex h-[42px] items-center px-3">
            <Silhouette className="h-3.5 w-[46%] bg-raised" />
          </div>
          <div className="flex items-center gap-1 px-1.5 pb-1.5">
            <Silhouette className="h-7 w-7 shrink-0 rounded-md bg-raised" />
            <Silhouette className="h-7 w-7 shrink-0 rounded-md bg-raised" />
            <div className="ml-auto flex items-center gap-1">
              <Silhouette className="h-7 w-7 shrink-0 rounded-md bg-raised" />
              <Silhouette className="h-7 w-7 shrink-0 rounded-md bg-raised" />
            </div>
          </div>
        </div>
      </div>
    </Bloc>
  );
}

/* ------------------------------------------------------------------ */
/* Une page de réglages, pendant que son module arrive                 */
/* ------------------------------------------------------------------ */

/**
 * LES DIX-SEPT SOUS-PAGES DES RÉGLAGES SONT CHARGÉES PARESSEUSEMENT : chacune
 * arrive à sa première ouverture. Le temps de ce chargement, la zone montre
 * cette silhouette — un titre, quelques lignes de réglage — au lieu d'un blanc.
 */
export function SilhouettePageReglages() {
  return (
    <Bloc zone="page-reglages" className="space-y-4">
      <Silhouette className="h-4 w-[38%] bg-raised" />
      {Array.from({ length: 4 }, (_, index) => (
        <div key={index} className="space-y-1.5">
          <Silhouette className={cn('h-3', LARGEURS[index % LARGEURS.length], 'bg-raised')} />
          <Silhouette className="h-8 w-full rounded-md bg-raised" />
        </div>
      ))}
    </Bloc>
  );
}

/* ------------------------------------------------------------------ */
/* Les écrans-outils : Coffre-fort, Backups, Surveillance              */
/* ------------------------------------------------------------------ */

/*
 * POURQUOI CES ÉCRANS-LÀ NE PRENNENT PAS `bg-border`.
 *
 * Les silhouettes du démarrage se posent sur le fond de page (`--bg`), où
 * `--border` se lit. Ces écrans, eux, s'affichent tantôt en TIROIR (fond
 * `--surface`), tantôt en VUE CENTRALE (fond `--bg`) — et dans les palettes
 * sombres `--border` (9 %) frôle `--surface` (8 %) : les barres y
 * disparaissaient. `--faint` à un quart d'opacité, lui, tranche sur les deux
 * fonds dans les douze palettes, et c'est déjà la teinte des traits qui portent
 * une information.
 */
const BARRE = 'bg-faint/25';

/** Une barre de silhouette lisible sur `--bg` COMME sur `--surface`. */
function Barre({ className }: { className?: string }) {
  return <Silhouette className={cn(BARRE, className)} />;
}

/** Une ligne de liste regroupée, au gabarit exact des vraies (`CLASSE_LIGNE_DE_GROUPE`) : aucun cadre. */
function LigneEnSilhouette({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn('rounded-xl px-3.5 py-3', className)}>{children}</div>;
}

/** Les deux lignes de texte d'une liste regroupée, à leur hauteur réelle (14,5 puis 12 px). */
function TitreEtDetail({ rang, pastille, detail = 'w-[240px] max-w-full' }: { rang: number; pastille?: boolean; detail?: string }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <div className="flex h-5 items-center gap-1.5">
        <div className="min-w-0 max-w-[260px] flex-1">
          <Barre className={cn('h-3.5', LARGEURS[rang % LARGEURS.length])} />
        </div>
        {pastille ? <Barre className="ml-auto h-4 w-16 shrink-0 rounded" /> : null}
      </div>
      <div className="flex h-4 items-center">
        <Barre className={cn('h-3', detail)} />
      </div>
    </div>
  );
}

/**
 * LES ACCÈS CLIENTS : des cartes de compte, avec leur nom, leur état, leurs
 * boutons, l'adresse de courriel et les pastilles de projets. Mêmes cadre et
 * mêmes hauteurs que `LigneCompteClient`, pour que la liste ne saute pas quand
 * les comptes arrivent — et pour qu'elle ne passe jamais pour une liste vide.
 */
export function SilhouetteAccesClients({ lignes = 3 }: { lignes?: number }) {
  return (
    <Bloc zone="acces-clients" className="flex flex-col gap-2">
      {Array.from({ length: lignes }, (_, index) => (
        <div key={index} className="rounded-md border border-transparent bg-surface p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <Barre className={cn('h-4', LARGEURS[index % LARGEURS.length])} />
              <Barre className="mt-1.5 h-3 w-[40%]" />
            </div>
            <Barre className="h-5 w-9 rounded-full" />
          </div>
          <div className="mt-2 flex items-center gap-2">
            <Barre className="h-7 w-32 rounded" />
            <Barre className="h-7 w-32 rounded" />
            <Barre className="h-7 w-20 rounded" />
          </div>
          <Barre className="mt-2 h-7 w-full rounded-md" />
          <div className="mt-2 flex items-center gap-1.5">
            <Barre className="h-6 w-20 rounded-full" />
            {index % 2 === 0 ? <Barre className="h-6 w-24 rounded-full" /> : null}
          </div>
        </div>
      ))}
    </Bloc>
  );
}

/**
 * LE COFFRE-FORT : des lignes d'accès, chacune avec son nom, sa pastille de
 * type à droite, puis le projet et l'aperçu en dessous.
 */
export function SilhouetteCoffre({ lignes = 6 }: { lignes?: number }) {
  return (
    <Bloc zone="coffre" className={CLASSE_GROUPE_DE_LIGNES}>
      {Array.from({ length: lignes }, (_, index) => (
        <LigneEnSilhouette key={index}>
          <TitreEtDetail rang={index} pastille detail="w-[210px] max-w-full" />
        </LigneEnSilhouette>
      ))}
    </Bloc>
  );
}

/**
 * LES BACKUPS : un tableau — la rangée d'entêtes, puis quelques lignes à
 * colonnes. Les colonnes cachées sur petit écran (`sm:table-cell`) le sont
 * aussi ici, pour que rien ne se déplace à l'arrivée des vraies lignes.
 *
 * SUR TÉLÉPHONE, LA VRAIE LISTE N'EST PLUS UN TABLEAU MAIS DES FICHES : la
 * silhouette suit (`fiches`), sinon l'écran d'attente montrait une mise en page
 * que l'arrivée des données faisait sauter.
 */
export function SilhouetteBackups({ lignes = 6, fiches }: { lignes?: number; fiches?: boolean }) {
  /* Sans consigne, la silhouette pose elle-même la question de la largeur : la
     vue pleine page (`app.tsx`) n'a pas à la porter pour elle. */
  const telephone = useTelephone();
  if (fiches ?? telephone) {
    return (
      <Bloc zone="backups" className="flex flex-col gap-1.5">
        {Array.from({ length: lignes }, (_, index) => (
          <LigneEnSilhouette key={index} className="flex flex-col gap-1.5">
            <span className="flex items-center gap-2">
              <Barre className={cn('h-3.5', LARGEURS[index % LARGEURS.length])} />
              <Barre className="ml-auto h-4 w-14 rounded" />
            </span>
            <Barre className="h-3 w-32" />
            <Barre className="h-3 w-40" />
            <Barre className="ml-auto h-6 w-24 rounded" />
          </LigneEnSilhouette>
        ))}
      </Bloc>
    );
  }
  return (
    <Bloc zone="backups">
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-border">
            <th className="py-1.5 pl-1">
              <Barre className="h-3 w-16" />
            </th>
            <th className="hidden px-2 py-1.5 sm:table-cell">
              <Barre className="h-3 w-20" />
            </th>
            <th className="px-2 py-1.5">
              <Barre className="h-3 w-24" />
            </th>
            <th className="hidden px-2 py-1.5 sm:table-cell">
              <Barre className="h-3 w-14" />
            </th>
            <th className="px-2 py-1.5">
              <Barre className="h-3 w-16" />
            </th>
            <th className="px-2 py-1.5" aria-hidden />
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: lignes }, (_, index) => (
            <tr key={index} className="border-b border-border/60">
              <td className="py-2 pl-1">
                <Barre className={cn('h-3.5', LARGEURS[index % LARGEURS.length])} />
              </td>
              <td className="hidden px-2 py-2 sm:table-cell">
                <Barre className="h-3 w-16" />
              </td>
              <td className="px-2 py-2">
                <Barre className="h-3 w-20" />
              </td>
              <td className="hidden px-2 py-2 sm:table-cell">
                <Barre className="h-3 w-12" />
              </td>
              <td className="px-2 py-2">
                <Barre className="h-4 w-16 rounded" />
              </td>
              <td className="px-2 py-2">
                <Barre className="ml-auto h-4 w-4 rounded" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Bloc>
  );
}

/**
 * LA SURVEILLANCE : les cartes d'adresse — le nom, la pastille d'état à
 * droite, l'adresse et l'heure du dernier passage en dessous, et le bouton de
 * retrait tout au bout.
 */
export function SilhouetteSurveillance({ lignes = 4 }: { lignes?: number }) {
  return (
    <Bloc zone="surveillance" className={CLASSE_GROUPE_DE_LIGNES}>
      {Array.from({ length: lignes }, (_, index) => (
        <LigneEnSilhouette key={index}>
          <TitreEtDetail rang={index} pastille />
        </LigneEnSilhouette>
      ))}
    </Bloc>
  );
}

/**
 * LE SERVICE MARKETING : le tableau des projets, chaque ligne séparée d'un trait, le nom
 * à gauche et ses repères à droite (`marketing.tsx`, `LigneProjet`).
 */
export function SilhouetteMarketing({ lignes = 4 }: { lignes?: number }) {
  return (
    <Bloc zone="marketing" className="flex flex-col">
      {Array.from({ length: lignes }, (_, index) => (
        <div key={index} className="flex items-center gap-1.5 border-t border-border/60 px-3 py-2.5">
          <Barre className="h-4 w-4 shrink-0 rounded-sm" />
          <div className="min-w-0 max-w-[260px] flex-1">
            <Barre className={cn('h-3.5', LARGEURS[index % LARGEURS.length])} />
          </div>
          <Barre className="ml-auto h-3 w-12 shrink-0" />
          <Barre className="h-3 w-16 shrink-0 max-sm:hidden" />
        </div>
      ))}
    </Bloc>
  );
}

/** UN ATELIER PRIVÉ tant que son morceau arrive : une liste regroupée. */
export function SilhouetteAtelier({ lignes = 6 }: { lignes?: number }) {
  return (
    <Bloc zone="atelier" className={CLASSE_GROUPE_DE_LIGNES}>
      {Array.from({ length: lignes }, (_, index) => (
        <LigneEnSilhouette key={index}>
          <TitreEtDetail rang={index} />
        </LigneEnSilhouette>
      ))}
    </Bloc>
  );
}

/**
 * LE SERVICE STATISTIQUES : le tableau des sites mesurés — le nom et l'adresse, la
 * petite courbe dès `sm`, puis les chiffres (`statistiques.tsx`).
 */
export function SilhouetteStatistiques({ lignes = 5 }: { lignes?: number }) {
  return (
    <Bloc zone="statistiques" className="flex flex-col">
      {Array.from({ length: lignes }, (_, index) => (
        <div key={index} className="flex items-center gap-3 border-t border-border/60 px-2 py-2">
          <div className="min-w-0 flex-1">
            <div className="flex h-5 items-center">
              <Barre className={cn('h-3.5 max-w-[260px]', LARGEURS[index % LARGEURS.length])} />
            </div>
            <div className="flex h-4 items-center">
              <Barre className="h-3 w-[200px] max-w-full" />
            </div>
          </div>
          <Barre className="hidden h-6 w-20 shrink-0 rounded sm:block" />
          <Barre className="h-3 w-8 shrink-0" />
          <Barre className="hidden h-3 w-8 shrink-0 sm:block" />
        </div>
      ))}
    </Bloc>
  );
}

/* ------------------------------------------------------------------ */
/* La messagerie : le kanban des demandes, ses deux visages             */
/* ------------------------------------------------------------------ */

/*
 * LE MÊME ÉCRAN SERT DEUX PERSONNES, DONC DEUX SILHOUETTES BÂTIES SUR UN SEUL
 * CORPS. Le client voit le kanban seul ; Haiko le voit précédé de la colonne
 * de ses clients et de l'entête du client regardé. Le corps — l'entête « Mes
 * demandes », la rangée d'onglets du téléphone, les trois colonnes — est écrit
 * UNE FOIS (`CorpsDesDemandes`) et repris par les deux.
 *
 * Ces blocs prennent `Barre` (`--faint` à un quart) et non `--border` : les
 * cartes de demande posent un fond `--surface`, où `--border` disparaît dans
 * les palettes sombres.
 */

/** Le ton d'une colonne de demandes — recopié de `espace-client.tsx`, qui est
 *  chargé à la demande : l'importer ici tirerait tout son morceau dans le
 *  paquet principal. Toute retouche là-bas se recopie ici. */
const TON_COLONNE_DEMANDE: Record<string, { fond: string; texte: string }> = {
  'a-faire': { fond: 'bg-colonne-gris-fond', texte: 'text-muted' },
  'en-cours': { fond: 'bg-colonne-bleu-fond', texte: 'text-colonne-bleu' },
  termine: { fond: 'bg-colonne-vert-fond', texte: 'text-colonne-vert' },
  valide: { fond: 'bg-colonne-vert-fond', texte: 'text-colonne-vert' },
};

/** Combien de demandes montrer par colonne : quelques-unes à faire, moins ensuite. */
const DEMANDES_PAR_COLONNE: Record<string, number> = {
  'a-faire': 3,
  'en-cours': 2,
  termine: 2,
  valide: 1,
};

/**
 * UNE DEMANDE EN SILHOUETTE, AU GABARIT DE LA VRAIE (`CarteDemande`) : même
 * arrondi, mêmes marges — sinon la colonne sursaute au moment du remplacement.
 * AUCUN TRAIT dans les silhouettes de la Messagerie : la forme se lit par les
 * fonds, comme la fiche réelle, qui n'a ni cadre ni trait.
 */
function SilhouetteDemande({ variante }: { variante: number }) {
  return (
    <div className="rounded-md bg-surface p-2.5">
      {/* Le titre, puis la pastille d'importance à droite. */}
      <div className="flex items-start justify-between gap-2">
        <Barre className={cn('h-[18px]', LARGEURS[variante % LARGEURS.length])} />
        <Barre className="h-[19px] w-14 shrink-0 rounded-full" />
      </div>
      {/* L'extrait de la description : une ligne, parfois deux. */}
      <Barre className="mt-1 h-[19px] w-[88%]" />
      {variante % 3 === 0 ? <Barre className="h-[19px] w-[57%]" /> : null}
      {/* Le pied : l'auteur, la date, parfois le nombre de pièces. */}
      <div className="mt-2 flex items-center gap-3">
        <Barre className="h-[17px] w-16" />
        <Barre className="h-[17px] w-24" />
      </div>
    </div>
  );
}

/**
 * LE CORPS DE LA MESSAGERIE : l'entête, les onglets du téléphone, les quatre
 * colonnes. Les TITRES DE COLONNES sont les vrais, à leur vraie couleur — ils
 * ne dépendent d'aucune donnée du serveur, seulement de la colonne, et les
 * poser d'emblée évite qu'ils apparaissent d'un coup à la fin du chargement.
 */
function CorpsDesDemandes() {
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      {/* L'entête : « Mes demandes », le bouton d'ajout, l'icône de discussion. */}
      <div className="flex shrink-0 items-center justify-between gap-2 px-3 py-2">
        <Barre className="h-[18px] w-32" />
        <div className="flex items-center gap-1.5">
          <Barre className="h-7 w-40 rounded-md" />
          <Barre className="h-7 w-9 rounded-md" />
        </div>
      </div>

      {/* Sur téléphone, les trois colonnes deviennent trois onglets. */}
      <div className="flex shrink-0 gap-1 px-3 py-1.5 md:hidden">
        {COLONNES_DEMANDE.map((colonne) => (
          <Barre key={colonne} className="h-7 w-[88px] rounded-md" />
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-hidden p-3">
        <div className="flex flex-col gap-3 md:flex-row">
          {COLONNES_DEMANDE.map((colonne, rang) => (
            <div
              key={colonne}
              data-silhouette-colonne-demande={colonne}
              /* Sur téléphone, une seule colonne est visible : la première,
                 comme l'onglet retenu par défaut dans le vrai écran. */
              className={cn('flex min-w-[220px] flex-1 basis-0 flex-col gap-2', rang === 0 ? '' : 'hidden md:flex')}
            >
              <div className={cn('mt-1 hidden items-center gap-2 rounded-lg py-1.5 pl-2.5 pr-1 md:flex', TON_COLONNE_DEMANDE[colonne]?.fond)}>
                <Barre className="h-4 w-4 rounded-sm" />
                <span className={cn('min-w-0 truncate text-[13.5px] font-medium', TON_COLONNE_DEMANDE[colonne]?.texte)}>
                  {t(TITRES_COLONNES_DEMANDE[colonne])}
                </span>
                <Barre className="h-2.5 w-3 rounded-sm" />
              </div>
              {Array.from({ length: DEMANDES_PAR_COLONNE[colonne] ?? 2 }, (_, index) => (
                <SilhouetteDemande key={index} variante={rang + index} />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** LA MESSAGERIE VUE PAR LE CLIENT : le kanban de ses demandes, seul. */
export function SilhouetteDemandes() {
  return (
    <Bloc zone="kanban" className="flex h-full min-h-0">
      <CorpsDesDemandes />
    </Bloc>
  );
}

/**
 * LA MESSAGERIE VUE PAR HAIKO : l'entête du client regardé — son sélecteur et
 * ses projets —, puis le même kanban. Plus de colonne de clients à gauche : la
 * silhouette ne promet que ce qui va vraiment paraître.
 */
export function SilhouetteEspaceHaiko() {
  return (
    <Bloc zone="espace-haiko" className="flex h-full min-h-0 flex-col">
      {/* L'entête : le sélecteur du client, puis ses projets. */}
      <div className="flex shrink-0 items-center gap-2 px-3 py-2">
        <Barre className="h-4 w-4 shrink-0 rounded-sm" />
        <Barre className="h-[18px] w-36" />
        <Barre className="h-[18px] w-28" />
      </div>
      <div className="flex min-h-0 min-w-0 flex-1">
        <CorpsDesDemandes />
      </div>
    </Bloc>
  );
}

/**
 * LA FICHE D'UNE DEMANDE, tant que le serveur n'a rien rendu : la ligne des
 * repères, la description, quelques commentaires alternés, puis la barre
 * d'écriture. La galerie n'y figure pas — elle n'existe que si la demande
 * porte des pièces, et la dessiner d'office ferait descendre tout le reste.
 */
/** La discussion de l'espace client, tant que son fil n'est pas arrivé : des bulles alternées. */
export function SilhouetteDiscussion({ bulles = 4 }: { bulles?: number }) {
  return (
    <Bloc zone="discussion" className="flex flex-col gap-2">
      {Array.from({ length: bulles }, (_, index) => (
        <div key={index} className={cn('flex', index % 2 ? 'justify-end' : 'justify-start')}>
          <Barre className={cn('h-[52px] rounded-lg', index % 2 ? 'w-[55%]' : 'w-[68%]')} />
        </div>
      ))}
    </Bloc>
  );
}

export function SilhouetteFicheDemande({ commentaires = 3 }: { commentaires?: number }) {
  return (
    <Bloc zone="fiche" className="flex flex-col gap-4">
      {/* Le même ordre que l'en-tête chargé : titre, description, auteur · date. */}
      <div>
        <Barre className="h-[20px] w-[70%]" />
        <Barre className="mt-2 h-[20px] w-full" />
        <Barre className="mt-1 h-[20px] w-[82%]" />
        <Barre className="mt-2 h-[12px] w-32" />
      </div>

      <div className="flex flex-col gap-2">
        {Array.from({ length: commentaires }, (_, index) => (
          <div key={index} className={cn('flex', index % 2 ? 'justify-end' : 'justify-start')}>
            <Barre className={cn('h-[62px] rounded-lg', index % 2 ? 'w-[58%]' : 'w-[66%]')} />
          </div>
        ))}
      </div>

      <div className="flex items-end gap-2 pt-3">
        <Barre className="h-[58px] flex-1 rounded-md" />
        <Barre className="h-8 w-8 shrink-0 rounded-md" />
        <Barre className="h-8 w-12 shrink-0 rounded-md" />
      </div>
    </Bloc>
  );
}

/* ------------------------------------------------------------------ */
/* Le Résumé : des tuiles, une courbe, un tableau                        */
/* ------------------------------------------------------------------ */

/**
 * UNE RUBRIQUE DU RÉSUMÉ EN ATTENTE : quatre tuiles, le cadre de la courbe,
 * puis les lignes d'un tableau — le gabarit des vraies rubriques
 * (`components/resume/commun.tsx`), sur leurs fonds `--surface`.
 */
export function SilhouetteRubrique() {
  return (
    <Bloc zone="resume" className="space-y-4">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((index) => (
          <div key={index} className="rounded-lg bg-surface px-3 py-3">
            <Barre className="h-3 w-24" />
            <Barre className="mt-2 h-6 w-20" />
            <Barre className="mt-1.5 h-3 w-28 max-w-full" />
          </div>
        ))}
      </div>
      <div className="rounded-lg bg-surface px-3 py-3">
        <Barre className="h-3.5 w-40" />
        <div className="mt-3 flex h-[120px] items-end gap-1">
          {Array.from({ length: 30 }, (_, index) => (
            <Barre key={index} className="min-w-0 flex-1 rounded-t" />
          ))}
        </div>
      </div>
      <div className="space-y-1 rounded-lg bg-surface px-3 py-3">
        <Barre className="mb-2 h-3.5 w-48" />
        {Array.from({ length: 6 }, (_, index) => (
          <Barre key={index} className={cn('h-7 rounded-md', index % 2 ? 'w-full' : 'w-[98%]')} />
        ))}
      </div>
    </Bloc>
  );
}

/**
 * LA PAGE « RÉSUMÉ » PENDANT LE TÉLÉCHARGEMENT DE SON MORCEAU. La période vit dans la
 * barre d'en-tête et les rubriques dans la colonne de gauche : seule la rubrique attend ici.
 */
export function SilhouetteResume() {
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-bg" data-silhouette="resume-page">
      <div className="min-w-0 flex-1 overflow-hidden px-3 py-3">
        <div className="mx-auto w-full max-w-[1100px]">
          <SilhouetteRubrique />
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Les médias : des groupes de vignettes, une carte par groupe          */
/* ------------------------------------------------------------------ */

/**
 * LES TÂCHES RÉCURRENTES : la liste des veilles — la raison, puis la carte et
 * les horaires. Mêmes hauteurs que les vraies lignes (`taches-recurrentes.tsx`).
 */
export function SilhouetteTachesRecurrentes({ lignes = 4 }: { lignes?: number }) {
  return (
    <Bloc zone="taches-recurrentes" className={CLASSE_GROUPE_DE_LIGNES}>
      {Array.from({ length: lignes }, (_, index) => (
        <LigneEnSilhouette key={index}>
          <TitreEtDetail rang={index} detail="w-[260px] max-w-full" />
        </LigneEnSilhouette>
      ))}
    </Bloc>
  );
}

/* ------------------------------------------------------------------ */
/* La liste des agents d'un projet (ou de tous, sur « Tableaux de bord ») */
/* ------------------------------------------------------------------ */

/** Des lignes d'agent, au gabarit de `LigneAgent` : l'icône, le titre, la branche dessous, un badge à droite. */
export function SilhouetteAgents({
  lignes = 6,
  pleinePage = false,
  avecProjet = false,
}: {
  lignes?: number;
  pleinePage?: boolean;
  /** La liste de tous les projets : le rond d'état porte la pastille du projet. */
  avecProjet?: boolean;
}) {
  return (
    <Bloc zone="agents" className="flex flex-col gap-0.5">
      {Array.from({ length: lignes }, (_, index) => (
        <div key={index} className={cn('flex items-center gap-2.5 rounded-lg', pleinePage ? 'px-3 py-3' : 'px-2.5 py-2')}>
          <Silhouette className={cn('shrink-0 rounded-full', avecProjet ? 'h-6 w-6' : 'h-3.5 w-3.5')} />
          <div className="min-w-0 flex-1">
            <div className="flex h-[18px] items-center">
              <Silhouette className={cn('h-3', LARGEURS[index % LARGEURS.length])} />
            </div>
            <div className="mt-0.5 flex h-[13px] items-center">
              <Silhouette className={cn('h-2', LARGEURS[(index + 2) % LARGEURS.length], 'opacity-60')} />
            </div>
          </div>
          {/* Le badge et, dessous, la date de la dernière activité. */}
          <div className="flex shrink-0 flex-col items-end gap-1">
            <Silhouette className="h-3.5 w-12 rounded-[4px]" />
            <Silhouette className="h-2 w-10 opacity-60" />
          </div>
        </div>
      ))}
    </Bloc>
  );
}

/** LE STUDIO : la grille de vignettes de ses créations, en attendant `studio.lister` ou l'ouverture d'une création. */
export function SilhouetteStudio({ vignettes = 6 }: { vignettes?: number }) {
  return <SilhouetteAtelier lignes={vignettes} />;
}

/**
 * LA LISTE D'UN SERVICE, TELLE QU'ELLE S'AFFICHE DANS SA PAGE (15/11/2026, « toutes les silhouettes doivent correspondre à
 * leur page ») : la tête grise du tableau commun (`ui/tableau.tsx`, fond `--tableau-entete`), puis des lignes aérées —
 * l'icône et le nom à gauche, le projet, l'état, la date au bout. Sur téléphone, des lignes seules, comme le tableau.
 */
export function SilhouetteTableauDeService({ lignes = 6, zone = 'tableau-de-service' }: { lignes?: number; zone?: string }) {
  const telephone = useTelephone();
  return (
    <Bloc zone={zone} className="flex flex-col">
      <div className="flex h-11 items-center gap-6 rounded-lg bg-tableau-entete px-3">
        <Silhouette className="h-2.5 w-20" />
        {telephone ? null : (
          <>
            <Silhouette className="ml-auto h-2.5 w-16" />
            <Silhouette className="h-2.5 w-20" />
            <Silhouette className="h-2.5 w-16" />
          </>
        )}
      </div>
      {Array.from({ length: lignes }, (_, index) => (
        <div key={index} className="flex h-[57px] items-center gap-3 border-b border-faint/15 px-3">
          <Silhouette className="h-6 w-6 shrink-0 rounded-md" />
          <div className="min-w-0 flex-1">
            <Silhouette className={cn('h-3', LARGEURS[index % LARGEURS.length], 'max-w-[320px]')} />
          </div>
          {telephone ? (
            <Silhouette className="h-2.5 w-10 shrink-0 opacity-60" />
          ) : (
            <>
              <Silhouette className="h-3 w-24 shrink-0" />
              <Silhouette className="h-3 w-28 shrink-0" />
              <Silhouette className="h-2.5 w-10 shrink-0 opacity-60" />
            </>
          )}
        </div>
      ))}
    </Bloc>
  );
}
