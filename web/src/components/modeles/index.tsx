/**
 * LES MODÈLES DE PAGES DE BELUGA — le point de départ de TOUT écran neuf
 * (charte « Application Beluga », règle 1 : `docs/chartes/application.md`).
 *
 * Constat du 05/11/2026 : les écrans écrits « à la main » par les agents
 * mélangeaient tiroirs, barres à eux, listes natives et largeurs inventées. Un
 * modèle fixe ce qui NE VARIE PAS (la page, sa largeur, son titre, ses gestes,
 * son défilement, ses états de chargement et de vide) et nomme ce qui PEUT
 * varier. Chaque modèle n'assemble QUE des composants existants : on n'en
 * réécrit jamais un.
 *
 * Les cinq modèles :
 *  - `PageListe`         — un service qui liste des éléments (sites, notes, accès…)
 *  - `PageFiche`         — un élément ouvert dans son service (fil d'Ariane, sections)
 *  - `Formulaire` + `ChampDeFormulaire` — saisir ou modifier (dans une page ou une fenêtre)
 *  - `RubriqueDeReglages` + `LigneDeReglage` — une rubrique de réglages
 *  - `PageTableauDeBord` + `Chiffre` — des chiffres en tête, puis des listes
 *
 * ADAPTER UNE STRUCTURE PARTICULIÈRE : ce qui peut varier est écrit en tête de
 * chaque modèle. Un besoin qui n'y entre pas (un espace de travail pleine
 * largeur, un éditeur, une frise) se PROPOSE à l'utilisateur avec des captures
 * (`ask_user`) avant d'être construit — jamais une variante inventée en silence.
 */
import * as React from 'react';
import { useTitreRedit } from '@/components/reglages/communs';
import {
  CLASSE_GROUPE_DE_LIGNES,
  CLASSE_LIGNE_DE_GROUPE,
  Drawer,
  Label,
  TitreDePage,
  ZoneDefilement,
} from '@/components/ui';
import {
  BoutonPrincipal,
  CranDuFil,
  GestePrincipal,
  OptionsDePage,
  SuiteDuFil,
} from '@/components/entete-de-zone';
import { Silhouette } from '@/components/silhouettes';
import { cn } from '@/lib/utils';

/* ------------------------------------------------------------------ */
/* Ce que partagent les pages                                           */
/* ------------------------------------------------------------------ */

export interface GesteDeLaPage {
  libelle: string;
  icone?: React.ReactNode;
  onClick: () => void;
  /** Le repère `data-*` du bouton, pour les contrôles. */
  repere?: string;
}

/** Le bouton principal d'une page : dernier de la barre sur ordinateur, en bas et pleine largeur sur téléphone. */
function LeGestePrincipal({ geste }: { geste?: GesteDeLaPage }) {
  if (!geste) return null;
  return (
    <GestePrincipal>
      <BoutonPrincipal onClick={geste.onClick} {...(geste.repere ? { [`data-${geste.repere}`]: true } : {})}>
        {geste.icone}
        {geste.libelle}
      </BoutonPrincipal>
    </GestePrincipal>
  );
}

/** La silhouette d'une liste qui charge : jamais un état vide avant les données. */
export function SilhouetteDeListe({ lignes = 5 }: { lignes?: number }) {
  return (
    <div className={CLASSE_GROUPE_DE_LIGNES} aria-busy="true" data-silhouette-liste>
      {Array.from({ length: lignes }, (_, i) => (
        <div key={i} className="flex flex-col gap-1.5 px-3.5 py-3">
          <Silhouette className="h-3.5 w-2/5" />
          <Silhouette className="h-3 w-3/5" />
        </div>
      ))}
    </div>
  );
}

/** L'état vide : ce qu'il n'y a pas, et le geste qui y remédie, en mots courants. */
export function EtatVide({ titre, detail, geste }: { titre: string; detail?: string; geste?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-2xl bg-surface px-6 py-10 text-center" data-etat-vide>
      <p className="text-[14.5px] font-medium text-text">{titre}</p>
      {detail ? <p className="max-w-[46ch] text-[13.5px] text-muted">{detail}</p> : null}
      {geste}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* PageListe                                                            */
/* ------------------------------------------------------------------ */

/**
 * UNE PAGE DE SERVICE QUI LISTE.
 *
 * NE VARIE PAS : `Drawer enPage` à la largeur commune, `TitreDePage`, le geste
 * principal par `GestePrincipal`, les gestes secondaires par `OptionsDePage`
 * (menu à trois points sur téléphone), la liste dans `ZoneDefilement`, une
 * silhouette tant que `chargement`, un `EtatVide` quand il n'y a rien.
 *
 * PEUT VARIER : le contenu d'une ligne (`LigneDeListe` : titre, détail, fin),
 * une recherche ou des filtres au-dessus (`entete`, par `ListeDeroulante` ou
 * `RechercheDePage`), plusieurs groupes de lignes avec un intertitre, un menu
 * de rubriques dans la colonne de gauche (`ColonneDeService`).
 */
export function PageListe({
  open,
  onClose,
  enPage = true,
  titre,
  geste,
  options,
  entete,
  chargement,
  vide,
  children,
}: {
  open: boolean;
  onClose: () => void;
  enPage?: boolean;
  titre: string;
  geste?: GesteDeLaPage;
  /** Des `OptionDePage`. */
  options?: React.ReactNode;
  /** Recherche, filtres : au-dessus de la liste, dans la page. */
  entete?: React.ReactNode;
  chargement?: boolean;
  /** Rendu quand la liste est vide (un `EtatVide`). */
  vide?: React.ReactNode;
  /** Des `LigneDeListe`. */
  children?: React.ReactNode;
}) {
  const lignes = React.Children.toArray(children);
  return (
    <Drawer open={open} onClose={onClose} enPage={enPage}>
      <TitreDePage>{titre}</TitreDePage>
      {options ? <OptionsDePage>{options}</OptionsDePage> : null}
      <LeGestePrincipal geste={geste} />
      <ZoneDefilement fond="hsl(var(--bg))" className="pb-6" data-modele="liste">
        <div className="flex flex-col gap-3 pt-1">
          {entete}
          {chargement ? <SilhouetteDeListe /> : lignes.length ? <div className={CLASSE_GROUPE_DE_LIGNES}>{lignes}</div> : vide}
        </div>
      </ZoneDefilement>
    </Drawer>
  );
}

/** Une ligne de liste : aucun trait, le survol la dessine ; un seul texte se replie. */
export function LigneDeListe({
  titre,
  detail,
  fin,
  onClick,
  actif,
  ...reperes
}: {
  titre: React.ReactNode;
  detail?: React.ReactNode;
  /** Ce qui se pose au bout de la ligne : un état, une date (ne se replie jamais). */
  fin?: React.ReactNode;
  onClick?: () => void;
  actif?: boolean;
} & Record<`data-${string}`, string | number | boolean | undefined>) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={actif || undefined}
      className={cn(CLASSE_LIGNE_DE_GROUPE, 'flex w-full min-w-0 items-center gap-3', actif && 'bg-ligne-active')}
      {...reperes}
    >
      <span className="flex min-w-0 flex-1 flex-col">
        <span className={cn('truncate text-[14px] font-medium', actif ? 'text-teinte' : 'text-text')}>{titre}</span>
        {detail ? <span className="truncate text-[12.5px] text-muted">{detail}</span> : null}
      </span>
      {fin ? <span className="max-w-[45%] shrink-0 truncate text-[12.5px] text-muted">{fin}</span> : null}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* PageFiche                                                            */
/* ------------------------------------------------------------------ */

/**
 * UN ÉLÉMENT OUVERT DANS SON SERVICE (un site, un client, une note).
 *
 * NE VARIE PAS : JAMAIS de barre à soi ni de croix — l'élément s'écrit dans le
 * fil d'Ariane (`SuiteDuFil` + `CranDuFil`), la flèche du téléphone remonte d'un
 * cran (`retour`) ; ses gestes par `OptionsDePage` ; des SECTIONS empilées
 * (`SectionDeFiche`) distinguées par leur fond, sans trait.
 *
 * PEUT VARIER : le nombre et l'ordre des sections, des onglets en tête
 * (`barre-d-onglets.tsx`) quand la fiche a plusieurs vues, un geste principal.
 * Rendue À L'INTÉRIEUR de la page du service (sa `PageListe`), à la place de la liste.
 */
export function PageFiche({
  nom,
  onRacine,
  options,
  geste,
  children,
}: {
  nom: string;
  /** Revenir à la liste du service. */
  onRacine: () => void;
  options?: React.ReactNode;
  geste?: GesteDeLaPage;
  /** Des `SectionDeFiche`. */
  children: React.ReactNode;
}) {
  return (
    <>
      <SuiteDuFil onRacine={onRacine} retour={{ action: onRacine }}>
        <CranDuFil>{nom}</CranDuFil>
      </SuiteDuFil>
      {options ? <OptionsDePage>{options}</OptionsDePage> : null}
      <LeGestePrincipal geste={geste} />
      <ZoneDefilement fond="hsl(var(--bg))" className="pb-6" data-modele="fiche">
        <div className="flex flex-col gap-3 pt-1">{children}</div>
      </ZoneDefilement>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Formulaire                                                           */
/* ------------------------------------------------------------------ */

/**
 * UN FORMULAIRE — dans une page, une section de fiche ou une fenêtre
 * (`DialogContent` + `DialogHeader`).
 *
 * NE VARIE PAS : libellé AU-DESSUS de chaque champ (`ChampDeFormulaire`),
 * jamais en colonne à gauche ; AUCUN élément natif — `Input`, `Textarea`,
 * `ListeDeroulante`, `CaseACocher`, `BoutonsRadio`, `ChoixDeDate`,
 * `ChoixDHeure`, `Curseur`, `CurseurDouble`, `ChoixDeCouleur`,
 * `ChampMotDePasse` ; l'enregistrement en PIED, un seul bouton principal,
 * qui dit « en cours » dès le clic.
 *
 * PEUT VARIER : deux champs côte à côte sur ordinateur (`grid sm:grid-cols-2`),
 * une aide sous un champ, des groupes avec intertitre.
 */
export function Formulaire({
  onSubmit,
  pied,
  children,
  className,
}: {
  onSubmit: () => void;
  /** Les boutons du pied (Annuler, Enregistrer). */
  pied?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <form
      className={cn('flex flex-col gap-4', className)}
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
      data-modele="formulaire"
    >
      {children}
      {pied ? <div className="flex flex-wrap items-center justify-end gap-2 pt-1">{pied}</div> : null}
    </form>
  );
}

/** Un champ : libellé au-dessus, le contrôle, puis l'aide ou l'erreur. */
export function ChampDeFormulaire({
  libelle,
  pour,
  aide,
  erreur,
  children,
}: {
  libelle: string;
  /** L'`id` du contrôle, pour relier le libellé. */
  pour?: string;
  aide?: string;
  erreur?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5" data-champ-de-formulaire>
      <Label htmlFor={pour}>{libelle}</Label>
      {children}
      {erreur ? <p className="text-[12.5px] text-danger">{erreur}</p> : aide ? <p className="text-[12.5px] text-muted">{aide}</p> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Réglages                                                             */
/* ------------------------------------------------------------------ */

/**
 * UNE RUBRIQUE DE RÉGLAGES (fenêtre des réglages généraux, ou configuration
 * d'un projet). Un réglage GÉNÉRAL vit dans la fenêtre des réglages, jamais
 * dans un menu de page.
 *
 * NE VARIE PAS : un intertitre, une phrase qui dit à quoi sert la rubrique, des
 * lignes `LigneDeReglage` (libellé et explication à gauche, contrôle maison à
 * droite ; empilés sur téléphone).
 *
 * PEUT VARIER : plusieurs groupes de lignes, un tableau sous les lignes, LE geste de la rubrique (`action`) sur la
 * ligne de l'intertitre (à droite sur ordinateur, pleine largeur dessous sur téléphone) ; un contenu posé entre
 * l'intertitre et les lignes (`avant`, un parcours en direct par exemple).
 */
export function RubriqueDeReglages({
  titre,
  description,
  action,
  avant,
  children,
}: {
  titre: string;
  description?: string;
  action?: React.ReactNode;
  avant?: React.ReactNode;
  children: React.ReactNode;
}) {
  /* Dans les réglages, un titre qui redit celui de sa section ne se répète pas (colonne fixe, 24/11/2026). */
  const titreRedit = useTitreRedit(titre);
  return (
    <section className="flex flex-col gap-2" data-modele="reglages">
      {titreRedit && !description && !action ? null : (
      <div className="flex flex-col gap-3 px-1 sm:flex-row sm:items-center sm:gap-4">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          {titreRedit ? null : <h3 className="text-[14px] font-semibold text-text">{titre}</h3>}
          {description ? <p className="text-[13px] text-muted">{description}</p> : null}
        </div>
        {action ? <div className="shrink-0 max-sm:[&>*]:w-full">{action}</div> : null}
      </div>
      )}
      {avant}
      <div className={CLASSE_GROUPE_DE_LIGNES}>{children}</div>
    </section>
  );
}

export function LigneDeReglage({ libelle, detail, controle }: { libelle: string; detail?: string; controle: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2 rounded-xl px-3.5 py-3 sm:flex-row sm:items-center sm:gap-4" data-ligne-de-reglage>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-[14px] text-text">{libelle}</span>
        {detail ? <span className="text-[12.5px] text-muted">{detail}</span> : null}
      </div>
      <div className="shrink-0">{controle}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Tableau de bord                                                      */
/* ------------------------------------------------------------------ */

/**
 * UNE PAGE DE TABLEAU DE BORD : des chiffres en tête, puis des listes ou un
 * tableau (`Tableau`, `ui/tableau.tsx`).
 *
 * NE VARIE PAS : la page et ses gestes comme `PageListe` ; les chiffres en
 * `Chiffre` (valeur en grand, légende en petit, monochrome) ; un graphique
 * passe par le graphique maison en SVG, jamais une bibliothèque de plus.
 *
 * PEUT VARIER : le nombre de chiffres (2 à 4 par rangée), les blocs sous les
 * chiffres (`SectionDeFiche`), une période choisie par `ListeDeroulante`.
 */
export function PageTableauDeBord({
  open,
  onClose,
  enPage = true,
  titre,
  options,
  geste,
  chiffres,
  children,
}: {
  open: boolean;
  onClose: () => void;
  enPage?: boolean;
  titre: string;
  options?: React.ReactNode;
  geste?: GesteDeLaPage;
  /** Des `Chiffre`. */
  chiffres: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <Drawer open={open} onClose={onClose} enPage={enPage}>
      <TitreDePage>{titre}</TitreDePage>
      {options ? <OptionsDePage>{options}</OptionsDePage> : null}
      <LeGestePrincipal geste={geste} />
      <ZoneDefilement fond="hsl(var(--bg))" className="pb-6" data-modele="tableau-de-bord">
        <div className="flex flex-col gap-3 pt-1">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{chiffres}</div>
          {children}
        </div>
      </ZoneDefilement>
    </Drawer>
  );
}

export function Chiffre({ libelle, valeur, detail }: { libelle: string; valeur: React.ReactNode; detail?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-2xl bg-surface p-4" data-chiffre>
      <span className="truncate text-[12.5px] text-muted">{libelle}</span>
      <span className="truncate text-[22px] font-semibold tabular-nums text-text">{valeur}</span>
      {detail ? <span className="truncate text-[12px] text-faint">{detail}</span> : null}
    </div>
  );
}
