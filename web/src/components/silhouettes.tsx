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
import { Loader2 } from 'lucide-react';
import {
  COLONNES_DEMANDE,
  COLONNES_AFFICHEES,
  COLUMN_LABELS,
  COULEURS_COLONNES_DEMANDE,
  TITRES_COLONNES_DEMANDE,
} from '@beluga/shared';
import { cn } from '@/lib/utils';
import { t } from '@/lib/langue';
import { useTelephone } from '@/lib/telephone';
import { useDispositionTableau } from '@/lib/disposition-tableau';
import {
  CLASSES_ALERTE_RANGEE,
  CLASSES_PIED_RANGEE,
  CLASSES_TETE_RANGEE,
  CLASSE_HAUTEUR_CARTE,
  CLASSE_HAUTEUR_CARTE_EN_ROUTE,
  CLASSE_HAUTEUR_CORPS_EN_ROUTE,
  CLASSE_LARGEUR_CARTE,
  classesBande,
  classesEmpilement,
  classesRail,
  classesRangee,
  classesColonneEnRoute,
  classesRailEnRoute,
  CLASSES_LISTE_COLONNE_EN_ROUTE,
  CLASSES_TETE_COLONNE_EN_ROUTE,
} from '@/lib/gabarit-tableau';
import { CLASSES_LISTE_ONGLETS, DialogTitle } from '@/components/ui';

/**
 * La brique de base : un bloc gris qui respire. Elle emprunte la couleur des
 * bordures du thème — donc elle suit le mode sombre comme le mode clair sans
 * qu'aucune teinte ne soit écrite en dur.
 */
export function Silhouette({ className }: { className?: string }) {
  return <div aria-hidden className={cn('animate-silhouette rounded bg-border', className)} />;
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
  return (
    <div data-silhouette={zone} role="status" aria-busy="true" aria-label="Chargement en cours" className={className}>
      <span className="sr-only">{t('Chargement en cours…')}</span>
      {children}
    </div>
  );
}

/** Des largeurs qui varient : des barres toutes égales ne ressemblent à rien. */
const LARGEURS = ['w-[72%]', 'w-[54%]', 'w-[83%]', 'w-[61%]', 'w-[76%]', 'w-[48%]'];

/**
 * La largeur de chaque onglet de colonne en silhouette, à peu près celle de son
 * libellé suivi de son compte. Rien ne dépend de ces valeurs : seule la HAUTEUR
 * de la rangée compte pour que les colonnes ne bougent pas.
 */
const ONGLETS_LARGEURS = ['w-[96px]', 'w-[84px]', 'w-[88px]', 'w-[92px]', 'w-[80px]'];

/* ------------------------------------------------------------------ */
/* La colonne de gauche : des lignes de projet                        */
/* ------------------------------------------------------------------ */

export function SilhouetteProjets({ lignes = 5 }: { lignes?: number }) {
  return (
    <Bloc zone="projets" className="px-1 py-1">
      {Array.from({ length: lignes }, (_, index) => (
        <div key={index} className="mb-0.5 flex items-center gap-1.5 rounded-md px-2 py-1.5">
          <Silhouette className="h-3.5 w-3.5 shrink-0 rounded-sm" />
          <Silhouette className={cn('h-3', LARGEURS[index % LARGEURS.length])} />
        </div>
      ))}
    </Bloc>
  );
}

/* ------------------------------------------------------------------ */
/* Le tableau : ses colonnes, quelques cartes dans chacune             */
/* ------------------------------------------------------------------ */

/**
 * UNE CARTE EN SILHOUETTE, AU GABARIT DE LA VRAIE. Elle reprend trait pour
 * trait le cadre d'une carte du tableau (`CardTile`) : même arrondi, même
 * bordure, même fond, mêmes marges intérieures. Sans cela, les cartes réelles
 * arrivaient à une autre taille que leur silhouette et toute la colonne
 * sursautait au moment du remplacement.
 */
function SilhouetteCarte({ variante }: { variante: number }) {
  return (
    <div className="h-full rounded-md border border-border bg-raised px-2.5 py-2">
      {/* La ligne du titre : l'icône du moteur, puis le titre lui-même — sur
          deux lignes une fois sur trois, comme les vrais titres. */}
      <div className="flex items-start gap-1.5">
        <Silhouette className="mt-[2px] h-3 w-3 shrink-0 rounded-sm" />
        <div className="min-w-0 flex-1">
          <Silhouette className={cn('h-3', LARGEURS[variante % LARGEURS.length])} />
          {variante % 3 !== 2 ? <Silhouette className="mt-1.5 h-3 w-[42%]" /> : null}
        </div>
      </div>
      {/* Le pied de carte : ses deux ou trois repères en pastilles. */}
      <div className="mt-2 flex gap-1.5">
        <Silhouette className="h-2.5 w-10 rounded-full" />
        <Silhouette className="h-2.5 w-14 rounded-full" />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* La page « En route » : la ligne de tête et la carte                 */
/* ------------------------------------------------------------------ */

/**
 * LA LISTE D'UNE COLONNE DE LA PAGE « EN ROUTE », partagée avec sa silhouette :
 * rien ne saute à l'arrivée. Une liste, tous projets mélangés, dans chacune des
 * trois colonnes (« Actifs », « Terminer », « Archiver »). Le `pt-3` laisse la place à la
 * pastille bleue « rendu non consulté », qui déborde de 12 px au-dessus du coin
 * haut droit de la carte : sans lui, la zone qui défile la coupait sur la
 * première carte de la liste.
 */
export const GRILLE_EN_ROUTE = 'grid grid-cols-1 gap-4 pt-3';

/**
 * LES CARTES D'UNE COLONNE EN ATTENTE. Chaque carte a la hauteur FIXE de la
 * carte en route (`CLASSE_HAUTEUR_CARTE_EN_ROUTE`), exactement comme la vraie,
 * et la même forme : le projet et l'état DANS la carte, en haut, le titre, le
 * début de la description, la frise des étapes, puis l'ancienneté en bas à
 * gauche. Posée par la page dans une colonne dont la liste n'est pas arrivée.
 */
export function SilhouetteListeEnRoute({ nombre = 6 }: { nombre?: number }) {
  return (
    <Bloc zone="en-route" className={GRILLE_EN_ROUTE}>
      {Array.from({ length: nombre }, (_, index) => (
        <div key={index} className={cn('flex flex-col', CLASSE_HAUTEUR_CARTE_EN_ROUTE)}>
          <div className="flex h-full flex-col rounded-md border border-border bg-raised px-2.5 py-2">
            <div className="mb-1 flex h-[18px] items-center gap-1.5">
              <Silhouette className="h-2.5 w-24" />
              <Silhouette className="ml-auto h-2.5 w-16" />
            </div>
            <div className={cn('shrink-0 overflow-hidden', CLASSE_HAUTEUR_CORPS_EN_ROUTE)}>
              <div className="flex items-start gap-1.5">
                <Silhouette className="mt-[2px] h-3 w-3 shrink-0 rounded-sm" />
                <div className="min-w-0 flex-1">
                  <Silhouette className={cn('h-3', LARGEURS[index % LARGEURS.length])} />
                  {index % 3 !== 2 ? <Silhouette className="mt-1.5 h-3 w-[42%]" /> : null}
                </div>
              </div>
              <Silhouette className="mt-2 h-2.5 w-[88%]" />
              <Silhouette className="mt-1.5 h-2.5 w-[60%]" />
            </div>
            {/* La frise des étapes, au même endroit que sur la vraie carte. */}
            <div className="mt-3 flex h-3.5 shrink-0 items-center">
              <Silhouette className="h-1.5 w-full" />
            </div>
            <Silhouette className="mb-1.5 mt-auto h-2.5 w-10" />
          </div>
        </div>
      ))}
    </Bloc>
  );
}

/**
 * LA PAGE ENTIÈRE EN ATTENTE, posée ICI, dans le premier morceau, et non dans
 * celui de la page : elle tient la place pendant que la page elle-même se
 * télécharge. Le MÊME rail et les MÊMES trois colonnes que la vraie page
 * (`lib/gabarit-tableau.ts`), leurs vrais titres à leur vraie place.
 */
export function SilhouetteEnRoute() {
  const telephone = useTelephone();
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-bg" data-silhouette-page-en-route>
      <div className={cn(classesRailEnRoute(telephone), 'min-h-0 flex-1 overflow-hidden')}>
        {([t('Actifs'), t('Terminer'), t('Archiver')] as const).map((titre, rang) => (
          <div key={titre} className={classesColonneEnRoute(telephone)}>
            <div className={CLASSES_TETE_COLONNE_EN_ROUTE}>
              <h2 className="text-[13px] font-medium uppercase tracking-wide text-faint">{titre}</h2>
              <Silhouette className="h-2.5 w-6 rounded-sm" />
            </div>
            <div className={cn(CLASSES_LISTE_COLONNE_EN_ROUTE, 'min-h-0 flex-1 overflow-hidden')}>
              <SilhouetteListeEnRoute nombre={rang === 0 ? 6 : 4} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Combien de cartes montrer par rangée. Les rangées de travail en portent
 * quelques-unes, celles de fin moins : on ne promet pas un tableau plein là
 * où il est presque toujours vide.
 */
const CARTES_PAR_COLONNE: Record<string, number> = {
  planned: 4,
  running: 3,
  done: 2,
  to_deploy: 2,
  archived: 2,
};

/*
 * LES RANGÉES SONT DÉJÀ À LEUR PLACE FINALE. La silhouette pose le MÊME rail,
 * le MÊME empilement, les MÊMES rangées, bandeaux, bandes et pied que le vrai
 * tableau (`board.tsx`) : toutes ces mesures viennent du gabarit partagé
 * (`lib/gabarit-tableau.ts`), jamais d'une copie. Et elle suit la MÊME
 * disposition, par le même crochet : en colonnes sur téléphone (le défaut), en
 * rangées sur ordinateur, ou ce que l'appareil a choisi. Conséquence voulue :
 * au remplacement, AUCUNE rangée ne se déplace, ni de côté ni en hauteur.
 *
 * En rangées, toutes les rangées prennent la hauteur de la plus haute — « À
 * déployer », avec l'emplacement de son message et son pied : ce sont donc eux
 * qu'il faut dessiner à leur vraie taille (le bouton de réglage du bandeau,
 * `h-6`, et celui de mise en ligne du pied, `h-7`).
 */
export function SilhouetteTableau() {
  const { disposition } = useDispositionTableau();
  const telephone = useTelephone();
  const enColonnes = disposition === 'colonnes';
  return (
    <Bloc zone="tableau" className="flex h-full min-h-0 flex-1 flex-col">
      <div className={cn(classesRail(enColonnes), 'min-h-0 flex-1 overflow-hidden')}>
        <div className={classesEmpilement(enColonnes)}>
          {COLONNES_AFFICHEES.map((column, rang) => (
            <div key={column} data-silhouette-colonne={column} className={classesRangee(enColonnes, telephone)}>
              <div className="flex h-full w-full flex-col">
                {/* Le bandeau garde son VRAI libellé, à sa vraie place : la mise
                    en page est connue d'avance, seul le compte des cartes
                    manque. */}
                <div className={CLASSES_TETE_RANGEE}>
                  <h2 className="shrink-0 whitespace-nowrap text-[13px] font-medium uppercase tracking-wide text-faint">
                    {t(COLUMN_LABELS[column])}
                  </h2>
                  <Silhouette className="h-2.5 w-3 rounded-sm" />
                  {column === 'planned' ? <Silhouette className="ml-auto h-7 w-[120px] rounded-md" /> : null}
                  {column === 'to_deploy' ? <Silhouette className="ml-auto h-6 w-16 rounded-md" /> : null}
                </div>
                {column === 'to_deploy' || column === 'archived' ? <div className={CLASSES_ALERTE_RANGEE} /> : null}
                <div className={cn(classesBande(enColonnes), 'overflow-hidden')}>
                  {Array.from({ length: CARTES_PAR_COLONNE[column] ?? 2 }, (_, index) => (
                    <div
                      key={index}
                      className={cn(enColonnes ? 'w-full' : cn(CLASSE_LARGEUR_CARTE, CLASSE_HAUTEUR_CARTE), 'shrink-0')}
                    >
                      <SilhouetteCarte variante={rang + index} />
                    </div>
                  ))}
                </div>
                {column === 'to_deploy' ? (
                  <div className={CLASSES_PIED_RANGEE}>
                    <Silhouette className="h-7 w-full rounded-md" />
                  </div>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </div>
    </Bloc>
  );
}

/* ------------------------------------------------------------------ */
/* La conversation : quelques bulles alternées                         */
/* ------------------------------------------------------------------ */

export function SilhouetteConversation({ bulles = 4 }: { bulles?: number }) {
  return (
    <Bloc zone="conversation" className="flex flex-col gap-3 p-3">
      {Array.from({ length: bulles }, (_, index) => {
        const aDroite = index % 2 === 1;
        return (
          <div key={index} className={cn('flex', aDroite ? 'justify-end' : 'justify-start')}>
            <div
              className={cn(
                'flex w-[78%] flex-col gap-1.5 rounded-lg p-2.5',
                aDroite ? 'items-end bg-surface' : 'bg-transparent',
              )}
            >
              <Silhouette className={cn('h-3', LARGEURS[index % LARGEURS.length])} />
              <Silhouette className="h-3 w-[90%]" />
              {aDroite ? null : <Silhouette className="h-3 w-[65%]" />}
            </div>
          </div>
        );
      })}
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
      <ol className="relative">
        <span className="absolute bottom-6 top-6 left-[11px] w-px bg-faint/40" aria-hidden />
        {Array.from({ length: points }, (_, index) => (
          <li key={index} className="relative flex gap-2.5 pb-4">
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
/* Le tiroir d'une carte : titre, onglets, barre d'étapes et fil       */
/* ------------------------------------------------------------------ */

/**
 * LE TIROIR ENTIER, TANT QUE LA CARTE N'A RIEN DIT.
 *
 * Une carte arrive dans le magasin avec l'instantané de son projet ; son
 * JOURNAL et son FIL, eux, ne sont réclamés qu'à l'ouverture du tiroir. Entre
 * les deux, le tiroir se dessinait quand même : titre, onglets, et surtout la
 * BARRE D'ÉTAPES calculée sur un journal absent — d'où « Travail » et
 * « Rapport » en ROUGE sur une carte qui n'a encore rien reçu, et l'impression
 * très nette d'une carte plantée.
 *
 * Cette silhouette prend donc la place du tiroir entier, TITRE COMPRIS, et ne
 * porte AUCUNE couleur d'état : ni rouge, ni orange, ni bleu.
 *
 * ELLE DESSINE LES TROIS ZONES FIXES, ET RIEN ENTRE ELLES. Une silhouette
 * n'est pas un décor : elle ne vaut que pour ce qui ne BOUGERA PAS de place
 * quand le vrai contenu arrivera — l'entête (titre, pastilles, bouton), la
 * rangée d'onglets, et le PIED DE SAISIE, qui est toujours là, toujours à la
 * même hauteur. Entre les deux, ni frise d'étapes ni bulles grises : leur
 * nombre et leur taille sont inventés, et cinq étages de gris font une attente
 * plus lourde qu'un écran calme. Au milieu, un seul signal : le rond qui
 * tourne, au centre de l'espace laissé libre.
 *
 * La barre de parcours en POINTS reste dehors, pour la même raison que la
 * frise : son nombre de points dépend de la carte, on ne l'invente pas.
 */
export function SilhouetteTiroirCarte() {
  return (
    <Bloc zone="tiroir-carte" className="flex min-h-0 flex-1 flex-col">
      {/* Le tiroir reste une boîte de dialogue : elle DOIT porter son titre
          pour les lecteurs d'écran, même quand il n'y a rien à lire encore. */}
      <DialogTitle className="sr-only">{t('Chargement de la tâche')}</DialogTitle>
      {/* Le titre, aux marges exactes de l'en-tête réel (`card-panel.tsx`) :
          rien ne saute quand le vrai titre le remplace. */}
      <div className="shrink-0 px-4 pb-[13px]">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            {/* Chaque brique tient dans la HAUTEUR DE SA LIGNE réelle — celle du
                titre, celle de la rangée d'étiquettes : l'entête fait alors les
                mêmes 57 px que le vrai, et les onglets ne remontent pas. */}
            <div className="flex h-[22px] items-center">
              <Silhouette className="h-4 w-[62%] bg-raised" />
            </div>
            <div className="mt-1 flex h-[19px] items-center gap-1.5">
              <Silhouette className="h-3.5 w-16 rounded-full bg-raised" />
              <Silhouette className="h-3.5 w-20 rounded-full bg-raised" />
            </div>
          </div>
          <Silhouette className="h-6 w-6 shrink-0 rounded-md bg-raised" />
        </div>
      </div>

      {/* La rangée d'onglets, dans le MÊME cadre de verre que la vraie
          (`card-panel.tsx`) : sans ce cadre, ses marges et sa bordure, les
          onglets en silhouette se posaient une quinzaine de pixels trop haut,
          et toute la rangée sautait à l'arrivée du contenu. */}
      <div
        className="mx-4 mt-1 shrink-0 overflow-hidden rounded-md border border-border/40 bg-raised/35 px-1.5 py-1"
        data-silhouette-onglets
      >
        <div className={cn(CLASSES_LISTE_ONGLETS, 'flex w-full justify-start overflow-hidden bg-transparent')}>
          {ONGLETS_LARGEURS.slice(0, 4).map((largeur, rang) => (
            <Silhouette key={rang} className={cn('h-7 shrink-0 rounded bg-raised', largeur)} />
          ))}
        </div>
      </div>

      {/* ENTRE LES ONGLETS ET LE PIED, RIEN QU'UN ROND QUI TOURNE : le
          « chargement » que l'on cherche des yeux quand un écran attend. Il
          prend tout l'espace restant, donc il tombe en son centre. */}
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <Loader2 data-silhouette-rond className="h-6 w-6 animate-spin text-faint" />
      </div>

      {/* LE PIED DE SAISIE, AUX MARGES ET AUX HAUTEURS DU VRAI (`composer.tsx`,
          monté par `chat.tsx`) : le bandeau du geste principal sur toute la
          largeur, puis le champ d'écriture et sa rangée d'icônes — deux à
          gauche (joindre, contexte), deux à droite (micro, envoi). Le vrai pied
          le remplace sans rien décaler : 36 px pour le bandeau, 85 px pour le
          champ, mesurés sur le vrai. La bande de travail (« l'agent
          attend… ») en est absente : elle ne paraît que par moments, et un
          gris qui s'ajoute vaut moins qu'un pied stable. Les briques restent
          en `bg-raised` : posées sur `--surface`, celles en `--border`
          disparaissent dans les palettes sombres. */}
      <div className="shrink-0 px-2.5 pt-2 pb-2" data-silhouette-pied>
        <div className="mb-2">
          <Silhouette className="h-9 w-full rounded-lg bg-raised" />
        </div>
        <div className="flex h-[85px] flex-col justify-between rounded-lg border border-border">
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
/* Les quatre écrans-outils : Notes, Coffre-fort, Backups, Surveillance */
/* ------------------------------------------------------------------ */

/*
 * POURQUOI CES QUATRE-LÀ NE PRENNENT PAS `bg-border`.
 *
 * Les silhouettes du démarrage se posent sur le fond de page (`--bg`), où
 * `--border` se lit. Ces quatre écrans, eux, s'affichent tantôt en TIROIR (fond
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

/** Le cadre d'une ligne de liste, au gabarit exact des vraies lignes. */
function LigneEnSilhouette({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={cn('rounded-md border border-border bg-bloc px-2.5 py-2', className)}>{children}</div>
  );
}

/**
 * LES NOTES : une pile de lignes — titre court, extrait long, puis la rangée
 * des repères (projet, importance, échéance). Les vraies lignes n'ont ni
 * bordure ni fond tant qu'elles ne sont pas ouvertes : la silhouette non plus,
 * sinon la liste se remplirait de cadres au remplacement.
 */
export function SilhouetteNotes({ lignes = 7 }: { lignes?: number }) {
  return (
    <Bloc zone="notes" className="flex flex-col gap-1">
      {Array.from({ length: lignes }, (_, index) => (
        <div key={index} className="rounded-md px-2.5 py-2">
          <Barre className={cn('h-3.5', LARGEURS[index % LARGEURS.length])} />
          <Barre className="mt-1.5 h-3 w-[86%]" />
          <div className="mt-2 flex items-center gap-1.5">
            <Barre className="h-4 w-24 rounded" />
            {index % 3 === 0 ? <Barre className="h-4 w-16 rounded" /> : null}
            <Barre className="h-3 w-14 rounded" />
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
    <Bloc zone="coffre" className="flex flex-col gap-1">
      {Array.from({ length: lignes }, (_, index) => (
        <LigneEnSilhouette key={index}>
          <div className="flex items-center gap-1.5">
            {/* Le nom garde une largeur de NOM, pas toute la ligne : une barre
                étirée d'un bord à l'autre ne ressemble à aucun accès réel. */}
            <div className="min-w-0 max-w-[260px] flex-1">
              <Barre className={cn('h-3.5', LARGEURS[index % LARGEURS.length])} />
            </div>
            <Barre className="h-4 w-16 shrink-0 rounded" />
          </div>
          <Barre className="mt-1.5 h-3 w-[210px] max-w-full" />
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
    <Bloc zone="surveillance" className="flex flex-col gap-1">
      {Array.from({ length: lignes }, (_, index) => (
        <LigneEnSilhouette key={index} className="flex items-center gap-2">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <div className="flex items-center gap-1.5">
              <div className="min-w-0 max-w-[260px] flex-1">
                <Barre className={cn('h-3.5', LARGEURS[index % LARGEURS.length])} />
              </div>
              <Barre className="h-4 w-16 shrink-0 rounded" />
            </div>
            <Barre className="mt-0.5 h-3 w-[240px] max-w-full" />
          </div>
          <Barre className="h-4 w-4 shrink-0 rounded" />
        </LigneEnSilhouette>
      ))}
    </Bloc>
  );
}

/**
 * L'ATELIER MARKETING : la liste des projets — le nom, la nature à droite, puis
 * la barre d'avancement et la prochaine action. Mêmes hauteurs que les vraies
 * lignes (`marketing.tsx`, `LigneProjet`).
 */
export function SilhouetteMarketing({ lignes = 4 }: { lignes?: number }) {
  return (
    <Bloc zone="marketing" className="flex flex-col gap-1">
      {Array.from({ length: lignes }, (_, index) => (
        <LigneEnSilhouette key={index} className="flex items-center gap-2">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <div className="flex items-center gap-1.5">
              <div className="min-w-0 max-w-[260px] flex-1">
                <Barre className={cn('h-3.5', LARGEURS[index % LARGEURS.length])} />
              </div>
              <Barre className="h-4 w-16 shrink-0 rounded" />
            </div>
            <Barre className="mt-0.5 h-3 w-[240px] max-w-full" />
          </div>
        </LigneEnSilhouette>
      ))}
    </Bloc>
  );
}

/**
 * LE STUDIO : une grille de vignettes — l'affiche de chaque création, son
 * titre, ses formats —, en attendant `studio.lister` ou l'ouverture d'une création.
 */
export function SilhouetteStudio({ vignettes = 6 }: { vignettes?: number }) {
  return (
    <Bloc zone="studio" className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
      {Array.from({ length: vignettes }, (_, index) => (
        <div key={index} className="flex flex-col overflow-hidden rounded-md bg-bloc">
          <Barre className="aspect-[4/5] w-full rounded-none" />
          <div className="flex flex-col gap-1 px-2.5 py-2">
            <Barre className={cn('h-3.5', LARGEURS[index % LARGEURS.length])} />
            <Barre className="h-3 w-[60%]" />
          </div>
        </div>
      ))}
    </Bloc>
  );
}

/**
 * LE SERVICE STATISTIQUES : la liste des sites mesurés — un nom, son adresse,
 * sa petite courbe de tendance —, en attendant `statistiques.lister`.
 */
export function SilhouetteStatistiques({ lignes = 5 }: { lignes?: number }) {
  return (
    <Bloc zone="statistiques" className="flex flex-col gap-1">
      {Array.from({ length: lignes }, (_, index) => (
        <LigneEnSilhouette key={index} className="flex items-center gap-2">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <div className="min-w-0 max-w-[260px]">
              <Barre className={cn('h-3.5', LARGEURS[index % LARGEURS.length])} />
            </div>
            <Barre className="mt-0.5 h-3 w-[200px] max-w-full" />
          </div>
          <Barre className="h-5 w-16 shrink-0 rounded" />
        </LigneEnSilhouette>
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
const TON_COLONNE_DEMANDE: Record<'neutre' | 'orange' | 'bleu', string> = {
  neutre: 'text-muted',
  orange: 'text-warning',
  bleu: 'text-info',
};

/** Combien de demandes montrer par colonne : quelques-unes à faire, moins ensuite. */
const DEMANDES_PAR_COLONNE: Record<string, number> = {
  'a-faire': 3,
  'en-cours': 2,
  termine: 2,
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
 * LE CORPS DE LA MESSAGERIE : l'entête, les onglets du téléphone, les trois
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
        <div className="grid gap-3 md:grid-cols-3">
          {COLONNES_DEMANDE.map((colonne, rang) => (
            <div
              key={colonne}
              data-silhouette-colonne-demande={colonne}
              /* Sur téléphone, une seule colonne est visible : la première,
                 comme l'onglet retenu par défaut dans le vrai écran. */
              className={cn('flex flex-col gap-2', rang === 0 ? '' : 'hidden md:flex')}
            >
              <div className="hidden items-center justify-between px-0.5 md:flex">
                <span
                  className={cn(
                    'text-[12px] font-medium uppercase tracking-wide',
                    TON_COLONNE_DEMANDE[COULEURS_COLONNES_DEMANDE[colonne]],
                  )}
                >
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
 * LA PAGE « RÉSUMÉ » PENDANT LE TÉLÉCHARGEMENT DE SON MORCEAU : l'entête (titre
 * à gauche, période à droite), la colonne des rubriques dès `md`, puis une
 * rubrique en attente.
 */
export function SilhouetteResume() {
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-bg" data-silhouette="resume-page">
      <div className="flex h-[45px] shrink-0 items-center gap-2 border-b border-border px-3">
        <Barre className="h-4 w-20" />
        <Barre className="ml-auto h-7 w-[220px] rounded-md" />
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="hidden w-56 shrink-0 flex-col gap-1.5 px-2 py-3 md:flex">
          {Array.from({ length: 11 }, (_, index) => (
            <Barre key={index} className={cn('h-5', LARGEURS[index % LARGEURS.length])} />
          ))}
        </div>
        <div className="min-w-0 flex-1 px-3 py-3">
          <div className="mx-auto w-full max-w-[1100px]">
            <SilhouetteRubrique />
          </div>
        </div>
      </div>
    </div>
  );
}
