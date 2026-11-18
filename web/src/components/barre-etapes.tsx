import * as React from 'react';
import { Check, ChevronDown, ChevronRight, Loader2 } from '@/components/ui/icones';
import { LIBELLE_ETAPE_DE_SUIVI, libelleDeLEtapeDeSuivi, tonDuSegmentDeSuivi, type EtapeDeSuivi, type SegmentDeSuivi } from '@beluga/shared';
import { CLASSE_TRAIT_DE_BRANCHE } from '@/components/pastille-projet';
import { cn, dateHeure } from '@/lib/utils';
import { t } from '@/lib/langue';

/**
 * Sous cette largeur de barre, les cinq noms se marchent dessus : seul celui de
 * l'étape mise en avant s'écrit. Calibré sur « Compréhension » + « À déployer »
 * en 13 px, avec les ronds et les traits ; mesuré sur la barre elle-même, jamais
 * sur la fenêtre (la conversation se règle à la souris, le menu se replie).
 */
const LARGEUR_DE_LA_BARRE_POUR_CINQ_NOMS = 560;
/** Les six étapes d'une création de média (« Images clés et prix ») demandent plus de place. */
const LARGEUR_DE_LA_BARRE_POUR_SIX_NOMS = 720;

/** Ce que montre un rond d'étape : fait, ici (une roue tant qu'on y travaille, « ! » tombé), à venir. */
export type FormeDuRondDEtape = 'faite' | 'travail' | 'erreur' | 'ici' | 'avenir';

/**
 * LE VERT D'UNE ÉTAPE RÉUSSIE — une EXCEPTION au monochrome, voulue par
 * l'utilisateur (15/11/2026) et LIMITÉE au déroulé du montage d'un projet
 * (« Projets du serveur ») : chaque étape faite y passe au vert, coche blanche.
 * Une teinte FIXE et non un jeton (déclarée dans styles.css, `.rond-vert-du-montage`) : `--success` est remappé en gris dans les
 * douze palettes (une classe oubliée ne ramène pas de couleur), et ce vert-ci
 * se lit tel quel sur fond clair comme sur fond sombre. Le rendu par défaut de
 * `RondDEtape` (barres d'étapes, cahier des charges, Communication, suivi de
 * publication) reste en noir et blanc.
 */
export const CLASSE_ROND_VERT = 'rond-vert-du-montage';
/** Le trait qui relie deux étapes réussies du même déroulé, du même vert atténué. */
export const CLASSE_TRAIT_VERT = 'trait-vert-du-montage';

/**
 * LE ROND D'UNE ÉTAPE, en noir et blanc (en vert sur demande, `vert`, pour le seul déroulé du montage) : plein avec sa coche une fois fait,
 * cerclé avec un point (ou une roue, ou « ! ») là où l'on est, vide et pâle à
 * venir. Partagé par la barre d'étapes de la carte et le chemin du tournage du
 * mode Réalisation : les deux se lisent de la même façon.
 */
export function RondDEtape({ forme, vert = false }: { forme: FormeDuRondDEtape; vert?: boolean }) {
  return (
    <span
      aria-hidden
      data-rond-etape={forme}
      data-ton={vert && forme === 'faite' ? 'vert' : undefined}
      className={cn(
        'flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full transition-colors',
        forme === 'faite' ? (vert ? CLASSE_ROND_VERT : 'bg-text text-bg') : forme === 'avenir' ? 'border-[1.5px] border-faint/50 text-faint' : 'border-[1.5px] border-text text-text',
      )}
    >
      {forme === 'faite' ? (
        <Check className="h-3 w-3" strokeWidth={3} />
      ) : forme === 'travail' ? (
        <Loader2 className="h-3 w-3 animate-spin motion-reduce:animate-none" strokeWidth={2.5} />
      ) : forme === 'erreur' ? (
        <span className="text-[11px] font-bold leading-none text-danger">!</span>
      ) : forme === 'ici' ? (
        <span className="h-2 w-2 rounded-full bg-text" />
      ) : null}
    </span>
  );
}

/**
 * LA BARRE D'ÉTAPES : UNE RANGÉE DE RONDS, LEUR NOM À CÔTÉ, ET UN RACCOURCI.
 *
 * LES CINQ DE LA FRISE DE « TABLEAUX DE BORD » — Demande, Compréhension,
 * Travail, À déployer, Archivée (`barreDeSuivi`, `shared`) : une carte se lit
 * de la même façon ouverte ou dans la liste.
 *
 * LE DESSIN EST CELUI DE LA MAQUETTE, EN NOIR ET BLANC — plus aucune couleur :
 *  - une étape FAITE : un rond plein, sa coche dedans, son nom en texte plein ;
 *  - l'étape OÙ L'ON EST : un rond cerclé avec un point au centre (une roue
 *    tant que l'agent y travaille, un point d'exclamation quand elle est
 *    tombée), son nom en texte plein ;
 *  - une étape À VENIR : un rond vide et pâle, son nom en gris.
 * Un trait relie deux étapes : plein jusqu'où l'on est arrivé, pâle au-delà.
 *
 * C'est un MOYEN DE NAVIGATION : toucher une étape fait défiler la discussion
 * jusqu'au passage correspondant. L'étape mise en avant suit le passage visible
 * pendant le défilement (`active`) ; elle se dit à voix haute (`aria-current`).
 *
 * SUR TÉLÉPHONE, ET DÈS QUE LA BARRE EST TROP ÉTROITE (`compacte`, mesurée),
 * seul le nom de l'étape mise en avant s'écrit : cinq noms ne tiennent pas sur
 * 390 px, ni dans une conversation calée à côté de l'aperçu. Les ronds, eux,
 * restent tous là. Chaque étape y prend LA PLACE DE SON CONTENU, et les traits se partagent le reste : à
 * largeurs égales, le nom écrit (« Compréhension ») débordait de sa case et
 * recouvrait le rond suivant. Il est aussi un cran plus petit, et se coupe en
 * dernier recours plutôt que de chevaucher.
 */
export function BarreDEtapes({
  segments,
  active,
  courante,
  onAller,
  enLigne = false,
  taches,
  moteurDuTravail,
  deployeeA,
}: {
  /** EN LIGNE SEULEMENT : la liste des tâches du tour, rangée sous l'étape « Travail » (13/11/2026). */
  taches?: TachesDeLaLigne | null;
  /** EN LIGNE : le moteur, le modèle, la réflexion et le compte qui ont traité la carte, à droite de « Travail ». */
  moteurDuTravail?: string | null;
  /** EN LIGNE : la date de mise en ligne, à droite de l'étape « Déployé » (ex-« À déployer »). */
  deployeeA?: number;
  /**
   * EN LIGNE, DANS LE REPÈRE COLLÉ AU CHAMP D'ÉCRITURE (refonte du 13/11/2026, maquettes #d250 et #168a) : une rangée
   * compacte — étape faite cochée, étape en cours en violet, étapes à venir en petit rond pâle. Même clic, mêmes
   * repères (`data-segment*`).
   */
  enLigne?: boolean;
  segments: SegmentDeSuivi[];
  /** L'étape mise en avant : le point visible, ou l'étape courante. */
  active: EtapeDeSuivi;
  /** L'étape où se trouve la carte (`segmentActifDeSuivi`). */
  courante: EtapeDeSuivi;
  onAller: (etape: EtapeDeSuivi) => void;
}) {
  const [liste, setListe] = React.useState<HTMLOListElement | null>(null);
  const [compacte, setCompacte] = React.useState(false);
  React.useEffect(() => {
    if (!liste) return;
    const seuil = segments.length > 5 ? LARGEUR_DE_LA_BARRE_POUR_SIX_NOMS : LARGEUR_DE_LA_BARRE_POUR_CINQ_NOMS;
    const mesurer = () => setCompacte(liste.clientWidth < seuil);
    mesurer();
    const observateur = new ResizeObserver(mesurer);
    observateur.observe(liste);
    return () => observateur.disconnect();
  }, [liste, segments.length]);

  if (enLigne) {
    return (
      <LigneDEtapes
        segments={segments}
        active={active}
        courante={courante}
        onAller={onAller}
        taches={taches ?? null}
        moteurDuTravail={moteurDuTravail ?? null}
        deployeeA={deployeeA}
      />
    );
  }

  return (
    <ol
      ref={setListe}
      className="flex items-center gap-2 sm:gap-3"
      aria-label="Étapes du parcours"
      data-barre-etapes={active}
      data-barre-compacte={compacte ? '' : undefined}
    >
      {segments.map((segment, i) => {
        const estActive = segment.etape === active;
        const ton = tonDuSegmentDeSuivi(segment, courante);
        const dernier = i === segments.length - 1;
        const faite = segment.etat === 'fait' && segment.etape !== courante;
        const ici = segment.etape === courante || segment.etat === 'encours' || segment.etat === 'question' || segment.etat === 'erreur';
        const atteinte = segment.etat !== 'avenir';
        return (
          <li
            key={segment.etape}
            className={cn(
              'flex min-w-0 items-center gap-2 sm:gap-3',
              dernier ? 'shrink-0' : compacte ? 'flex-auto' : 'flex-auto sm:flex-1',
            )}
          >
            <button
              type="button"
              data-segment={segment.etape}
              data-segment-etat={segment.etat}
              data-segment-ton={ton}
              /* UNE ÉTAPE NON ATTEINTE LE DIT, au lieu de compter sur le seul
                 gris : son infobulle l'écrit, et le repère suit. La discussion,
                 elle, ne montre plus ce qui n'est pas encore arrivé. */
              data-point-avenir={atteinte ? undefined : ''}
              aria-current={estActive ? 'step' : undefined}
              onClick={() => onAller(segment.etape)}
              title={
                atteinte
                  ? t(LIBELLE_ETAPE_DE_SUIVI[segment.etape])
                  : `${t(LIBELLE_ETAPE_DE_SUIVI[segment.etape])} · ${t('à venir')}`
              }
              className={cn('group flex min-w-0 items-center gap-2 py-1.5 sm:py-1', !compacte && 'sm:shrink-0')}
            >
              <RondDEtape
                forme={faite ? 'faite' : segment.etat === 'encours' ? 'travail' : segment.etat === 'erreur' ? 'erreur' : ici && atteinte ? 'ici' : 'avenir'}
              />
              <span
                className={cn(
                  'min-w-0 truncate text-[12px] leading-normal transition-colors group-hover:text-text sm:text-[13px] sm:leading-none',
                  !compacte && 'sm:overflow-visible',
                  atteinte ? 'font-medium text-text' : 'text-faint',
                  !estActive && (compacte ? 'hidden' : 'max-sm:hidden'),
                )}
              >
                {t(LIBELLE_ETAPE_DE_SUIVI[segment.etape])}
              </span>
            </button>
            {/* Un trait qui porte une information : plein jusqu'où l'on est
                arrivé (`--text`), pâle au-delà — en `--faint`, jamais `--border`. */}
            {dernier ? null : (
              <span aria-hidden className={cn('h-px min-w-2 flex-1', faite ? 'bg-text/60' : 'bg-faint/60')} />
            )}
          </li>
        );
      })}
    </ol>
  );
}

/** Une étape d'une rangée générique : sa clé, son nom, son rond, et si on peut y aller. */
export interface EtapeDeRangee {
  cle: string;
  libelle: string;
  forme: FormeDuRondDEtape;
  /** Atteinte : son nom s'écrit en plein et on peut y aller ; sinon pâle, « à venir ». */
  atteinte: boolean;
}

/**
 * LA MÊME BARRE, POUR UN AUTRE PARCOURS que celui d'une carte : les ronds de
 * `RondDEtape`, le nom écrit à côté, un trait plein jusqu'où l'on est arrivé,
 * la version compacte sous `LARGEUR_DE_LA_BARRE_POUR_CINQ_NOMS` (seul le nom
 * de l'étape affichée s'écrit). Le service qui l'emploie donne ses étapes et
 * ses repères (`donnees`), sans rien savoir de la frise des cartes.
 */
export function RangeeDEtapes({
  etapes,
  active,
  onAller,
  repere,
  donnees,
  classeActive = 'text-text',
  travail,
  fin,
  ...reste
}: {
  /**
   * L'ÉTAPE QUI TRAVAILLE ET SON AVANCEMENT RÉEL (0 à 100) : une icône qui tourne à côté de son nom, son pourcentage,
   * et le trait qui la suit devient une barre qui se remplit et scintille (demande du 03/11/2026, capture #c8a71).
   */
  travail?: { cle: string; pourcentage: number } | null;
  /** Ce qui se lit à droite de la rangée (la dépense d'une mission en cours). */
  fin?: React.ReactNode;
  etapes: EtapeDeRangee[];
  active: string;
  onAller: (cle: string) => void;
  /** Le nom de la rangée, lu à voix haute : un REPÈRE fixe, le même dans les cinq langues (jamais `t()`). */
  repere: string;
  /** Les repères posés sur le bouton de chaque étape. */
  donnees?: (e: EtapeDeRangee) => Record<string, string | undefined>;
  /** La teinte du nom de l'étape AFFICHÉE : le service qui l'emploie la choisit (sa couleur d'élément choisi). */
  classeActive?: string;
} & Omit<React.HTMLAttributes<HTMLOListElement>, 'onChange'>) {
  const [liste, setListe] = React.useState<HTMLOListElement | null>(null);
  const [compacte, setCompacte] = React.useState(false);
  React.useEffect(() => {
    if (!liste) return;
    const seuil = etapes.length > 5 ? LARGEUR_DE_LA_BARRE_POUR_SIX_NOMS : LARGEUR_DE_LA_BARRE_POUR_CINQ_NOMS;
    const mesurer = () => setCompacte(liste.clientWidth < seuil);
    mesurer();
    const observateur = new ResizeObserver(mesurer);
    observateur.observe(liste);
    return () => observateur.disconnect();
  }, [liste, etapes.length]);
  const rangee = (
    <ol ref={setListe} className={cn('flex items-center gap-2 sm:gap-3', fin ? 'min-w-0 flex-1' : null)} aria-label={repere} data-barre-compacte={compacte ? '' : undefined} {...reste}>
      {etapes.map((e, i) => {
        const estActive = e.cle === active;
        const dernier = i === etapes.length - 1;
        const travaille = travail?.cle === e.cle;
        const pourcentage = travaille ? Math.max(0, Math.min(100, Math.round(travail!.pourcentage))) : 0;
        return (
          <li key={e.cle} className={cn('flex min-w-0 items-center gap-2 sm:gap-3', dernier ? 'shrink-0' : compacte ? 'flex-auto' : 'flex-auto sm:flex-1')}>
            <button
              type="button"
              aria-current={estActive ? 'step' : undefined}
              aria-disabled={!e.atteinte || undefined}
              onClick={() => e.atteinte && onAller(e.cle)}
              title={e.atteinte ? e.libelle : `${e.libelle} · ${t('à venir')}`}
              className={cn('group flex min-w-0 items-center gap-2 py-1.5 sm:py-1', !compacte && 'sm:shrink-0', !e.atteinte && 'cursor-default')}
              {...(donnees?.(e) ?? {})}
            >
              {travaille ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-teinte motion-reduce:animate-none" aria-hidden data-rangee-travail /> : <RondDEtape forme={e.forme} />}
              <span
                className={cn(
                  'min-w-0 truncate text-[12px] leading-normal transition-colors sm:text-[13px] sm:leading-none',
                  /* Le survol n'éteint jamais la teinte de l'étape affichée (la souris y reste après le clic). */
                  e.atteinte && !estActive && 'group-hover:text-text',
                  !compacte && 'sm:overflow-visible',
                  /* L'étape AFFICHÉE porte la teinte que le service choisit ; toutes les autres se lisent en noir et blanc. */
                  estActive ? cn('font-medium', classeActive) : e.atteinte ? 'font-medium text-text' : 'text-faint',
                  !estActive && (compacte ? 'hidden' : 'max-sm:hidden'),
                )}
                data-rangee-libelle
              >
                {e.libelle}
              </span>
              {travaille ? (
                <span className="shrink-0 text-[12px] font-medium tabular-nums text-teinte sm:text-[13px] sm:leading-none" data-rangee-pourcentage={pourcentage}>
                  {pourcentage} %
                </span>
              ) : null}
            </button>
            {/* Un trait qui porte une information suit `--faint`, jamais `--border`. Celui de l'étape qui travaille est
                une barre qui se remplit à son avancement, et scintille. */}
            {dernier ? null : travaille ? (
              <span aria-hidden className="barre-qui-travaille h-1 min-w-6 flex-1 rounded-full bg-faint/25" data-rangee-barre-travail>
                <span className="block h-full rounded-full bg-teinte transition-[width] duration-500" style={{ width: `${pourcentage}%` }} />
              </span>
            ) : (
              <span aria-hidden className={cn('h-px min-w-2 flex-1', e.forme === 'faite' ? 'bg-text/60' : 'bg-faint/60')} />
            )}
          </li>
        );
      })}
    </ol>
  );
  if (!fin) return rangee;
  return (
    <div className="flex min-w-0 items-center gap-3" data-rangee-avec-fin>
      {rangee}
      <span className="shrink-0 text-[12px] tabular-nums text-muted max-sm:hidden" data-rangee-fin>
        {fin}
      </span>
    </div>
  );
}

/** Ancienne clé du pli retenu de la ligne des étapes : retirée au montage (13/11/2026, la ligne s'ouvre repliée). */
const ANCIENNE_CLE_LIGNE_DEPLIEE = 'beluga.ligne-etapes.deplie';

/**
 * LA LISTE DES TÂCHES QUE LE TÉMOIN DU CHAMP CONFIE À LA LIGNE DES ÉTAPES (décision du 13/11/2026 : « fusionne les deux
 * listes […] passe la to-do qui se complète à l'intérieur de travail »). Le témoin (`TravailEnCours`, chat.tsx) garde
 * le calcul — liste du tour, procédures passées, temps, replis — et la ligne ne fait que la poser.
 */
export interface TachesDeLaLigne {
  /** Le corps de la liste (`CorpsListeTaches enBranches`), ou rien quand aucune liste n'est annoncée. */
  corps: React.ReactNode | null;
  faites: number;
  total: number;
  /** Les flèches ‹ n/N › des procédures passées, posées sur la ligne « Travail ». */
  fleches?: React.ReactNode;
  /** L'agent travaille : la ligne d'en-tête dit ce qu'il fait (`resume`), et sous-liste dépliée d'office. */
  enTravail: boolean;
  /** Ce que fait l'agent, son compte et son temps (`InfoTravail`) — sur la ligne d'en-tête, pendant le travail. */
  resume?: React.ReactNode;
  /** Une procédure passée est affichée (flèches) : la sous-liste s'ouvre pour la lire. */
  enPasse?: boolean;
  /** Repli passager du bloc entier (champ focalisé sur téléphone) : un appui le lève (`onLeverLeRepli`). */
  replie?: boolean;
  onLeverLeRepli?: () => void;
  /** La fin du tour replie la sous-liste pour la session ; le tour suivant la rouvre. */
  replieParLeTour?: boolean;
}

/**
 * LA LIGNE DES ÉTAPES, COLLÉE AU CHAMP D'ÉCRITURE (décision du 13/11/2026 : « elle doit afficher le statut en cours et
 * quand on clique dessus elle doit afficher la liste comme le système de todo »).
 *
 * Repliée : UNE ligne — l'étape où se trouve la carte, en violet (une roue tant que l'agent y travaille, « ! » si elle
 * est tombée), son rang « 2 sur 5 », et, pendant le travail, ce que fait l'agent avec son compte et son temps ; un
 * chevron. Un appui déroule les cinq étapes l'une sous l'autre, au dessin de la liste des tâches : cochée une fois
 * faite, violette là où l'on est, pâle à venir ; toucher une étape fait défiler la conversation jusqu'à elle.
 *
 * LES TÂCHES DE L'AGENT SONT RANGÉES SOUS « TRAVAIL » (même décision) : reliées à son rond par des branches, dépliées
 * pendant le travail, repliées une fois la carte au-delà (« 8/8 tâches » et une flèche) — un appui les déplie TOUTES.
 * Plus de seconde ligne « Liste des tâches » sous les étapes. LE BLOC S'OUVRE TOUJOURS REPLIÉ (décision du 13/11/2026,
 * capture #05fc : « il faut que tu fermes d'office la liste des étapes ») : un appui le déplie pour l'affichage, rien
 * n'est retenu, et il retombe replié quand la carte change (le parent le remonte sur `key={cardId}`). Le pli de la
 * sous-liste vaut aussi pour l'affichage. Même rendu sur ordinateur et sur téléphone.
 *
 * À DROITE DE « TRAVAIL », le moteur qui a traité la carte (moteur · modèle · réflexion · compte) ; à droite de
 * l'étape de mise en ligne, sa date, et l'étape s'appelle « Déployé » une fois faite (`libelleDeLEtapeDeSuivi`) —
 * ils remplacent le point « Déploiement » et la ligne « Traité par » du fil (même décision, capture #b6079).
 *
 * Les lignes restent dans la page, repliées (hauteur nulle) : les repères `data-segment*` se lisent toujours.
 */
function LigneDEtapes({
  segments,
  active,
  courante,
  onAller,
  taches,
  moteurDuTravail,
  deployeeA,
}: {
  segments: SegmentDeSuivi[];
  active: EtapeDeSuivi;
  courante: EtapeDeSuivi;
  onAller: (etape: EtapeDeSuivi) => void;
  taches: TachesDeLaLigne | null;
  moteurDuTravail: string | null;
  deployeeA?: number;
}) {
  const [ouverteRetenue, setOuverte] = React.useState(false);
  React.useEffect(() => {
    try {
      window.localStorage.removeItem(ANCIENNE_CLE_LIGNE_DEPLIEE);
    } catch {
      /* navigation privée : rien à retirer */
    }
  }, []);
  const replie = !!taches?.replie;
  const ouverte = ouverteRetenue && !replie;
  const basculer = () => {
    if (replie) {
      /* Replié par le champ : l'appui DÉPLIE toujours, sans deux bascules pour un appui. */
      taches?.onLeverLeRepli?.();
      if (ouverteRetenue) return;
    }
    setOuverte((avant) => !avant);
  };
  /* LA SOUS-LISTE DE « TRAVAIL » : dépliée pendant le travail, repliée ensuite ; un appui la renverse pour l'affichage.
     Le choix de la main tombe quand la carte change d'étape ou qu'un nouveau tour part. */
  const [sousListe, setSousListe] = React.useState<boolean | null>(null);
  const enTravail = !!taches?.enTravail;
  React.useEffect(() => setSousListe(null), [courante, enTravail]);
  const sousListeParDefaut = !!taches?.enPasse || (courante === 'travail' && !taches?.replieParLeTour) || enTravail;
  const sousListeOuverte = sousListe ?? sousListeParDefaut;
  const aDesTaches = !!taches?.corps;

  const rang = Math.max(0, segments.findIndex((s) => s.etape === courante));
  const segmentCourant = segments[rang];
  const formeDe = (segment: SegmentDeSuivi): FormeDuRondDEtape => {
    const ici = segment.etape === courante;
    if (segment.etat === 'fait' && !ici) return 'faite';
    if (ici && segment.etat === 'encours') return 'travail';
    if (ici && segment.etat === 'erreur') return 'erreur';
    if (ici) return 'ici';
    return segment.etat === 'avenir' ? 'avenir' : 'faite';
  };
  const compteDesTaches = taches && taches.total > 0 ? t('{v0}/{v1} tâches', { v0: taches.faites, v1: taches.total }) : null;
  const libelle = (etape: EtapeDeSuivi) => t(libelleDeLEtapeDeSuivi(etape, { deployeeA }));
  return (
    <div
      className="flex w-full min-w-0 flex-col"
      data-ligne-etapes
      data-ligne-ouverte={ouverte ? '' : undefined}
      data-ligne-repliee-par-le-champ={replie ? '' : undefined}
    >
      <button
        type="button"
        onClick={basculer}
        aria-expanded={ouverte}
        className="relative flex w-full min-w-0 items-center gap-2.5 rounded py-0.5 text-left text-[13px]"
        data-barre-etapes={active}
        data-barre-en-ligne
        data-etape-courante={courante}
      >
        {/* PLUS DE TÉMOIN D'ACTIVITÉ À GAUCHE NI DE ROUE APRÈS LE TIRET (15/11/2026, capture #e5085) : le rond qui
            tourne, devant le nom de l'étape, est le seul signe que l'agent travaille — le même que la tâche en cours
            dessous. Le point clignotant, déplacé hors du rang le matin même, devait disparaître. */}
        <PetitRond forme={segmentCourant ? formeDe(segmentCourant) : 'ici'} />
        <span className="shrink-0 font-medium text-teinte">{libelle(courante)}</span>
        {/* SUR TÉLÉPHONE PENDANT LE TRAVAIL, « · 2 sur 5 » S'EFFACE : la ligne garde sa place au résumé, sans déborder. */}
        <span className={cn('shrink-0 text-faint', taches?.enTravail && taches.resume && 'max-sm:hidden')}>· {t('{v0} sur {v1}', { v0: rang + 1, v1: segments.length })}</span>
        {taches?.enTravail && taches.resume ? (
          /* LE RÉSUMÉ RESTE DANS SON CADRE (14/11/2026, capture #9dd1b) : il se coupe, il ne pousse jamais le chevron. */
          <span className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden text-muted" data-resume-du-travail>
            <span aria-hidden className="shrink-0 text-faint">—</span>
            {taches.resume}
          </span>
        ) : (
          <span className="flex-1" />
        )}
        <ChevronDown className={cn('h-3.5 w-3.5 shrink-0 text-muted transition-transform', ouverte && 'rotate-180')} aria-hidden />
      </button>
      <div
        className={cn('grid transition-[grid-template-rows] duration-200 ease-out', ouverte ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]')}
        aria-hidden={!ouverte}
        {...(ouverte ? {} : { inert: '' })}
      >
        {/* ROND SOUS ROND (15/11/2026, capture #589d) : la liste déborde de 4 px de chaque côté (`-mx-1`) et chaque
            ligne reprend 4 px (`px-1`) — le rond, le nom et le chevron tombent exactement sous ceux du titre, et le
            fond de la ligne choisie garde un peu d'air autour d'eux. Le tronc des tâches (11 px) se mesure depuis ce
            bord : il reste au centre du rond. */}
        <ol className="-mx-1 min-h-0 overflow-hidden" aria-label="Étapes du parcours">
          {segments.map((segment) => {
            const forme = formeDe(segment);
            const ici = segment.etape === courante;
            const atteinte = segment.etat !== 'avenir';
            const avecTaches = segment.etape === 'travail' && !!taches && (aDesTaches || !!taches.fleches);
            return (
              <li key={segment.etape} className="relative">
                <div
                  className={cn(
                    'flex w-full items-center rounded-md transition-colors hover:bg-raised',
                    ici ? 'bg-teinte/10 font-medium text-teinte' : atteinte ? 'text-text' : 'text-faint',
                  )}
                >
                  <button
                    type="button"
                    data-segment={segment.etape}
                    data-segment-etat={segment.etat}
                    data-segment-ton={tonDuSegmentDeSuivi(segment, courante)}
                    data-point-avenir={atteinte ? undefined : ''}
                    data-etape-ici={ici ? '' : undefined}
                    aria-current={segment.etape === active ? 'step' : undefined}
                    onClick={() => onAller(segment.etape)}
                    title={atteinte ? libelle(segment.etape) : `${libelle(segment.etape)} · ${t('à venir')}`}
                    className="flex min-w-0 flex-1 items-center gap-2.5 px-1 py-1 text-left text-[13px]"
                  >
                    <PetitRond forme={forme} />
                    <span className="shrink-0">{libelle(segment.etape)}</span>
                    {avecTaches && compteDesTaches ? (
                      <span className="shrink-0 text-[12px] font-normal tabular-nums text-faint" data-compte-des-taches>
                        · {compteDesTaches}
                      </span>
                    ) : null}
                    {segment.etape === 'travail' && atteinte && moteurDuTravail ? (
                      <span className="min-w-0 truncate text-[12px] font-normal text-muted" data-moteur-du-travail title={moteurDuTravail}>
                        · {moteurDuTravail}
                      </span>
                    ) : null}
                    {segment.etape === 'a_deployer' && deployeeA ? (
                      <span className="min-w-0 truncate text-[12px] font-normal tabular-nums text-muted" data-date-de-mise-en-ligne>
                        · {dateHeure(deployeeA)}
                      </span>
                    ) : null}
                  </button>
                  {avecTaches ? taches!.fleches : null}
                  {avecTaches && aDesTaches ? (
                    <button
                      type="button"
                      aria-expanded={sousListeOuverte}
                      aria-label={sousListeOuverte ? t('Replier la liste') : t('Déplier la liste')}
                      onClick={() => setSousListe(!sousListeOuverte)}
                      className="mr-0.5 shrink-0 rounded p-1 text-faint hover:text-text sm:p-0.5"
                      data-chevron-des-taches
                    >
                      <ChevronRight className={cn('h-3.5 w-3.5 transition-transform', sousListeOuverte && 'rotate-90')} />
                    </button>
                  ) : null}
                </div>
                {avecTaches && aDesTaches ? (
                  sousListeOuverte ? (
                    <div className="relative" data-taches-sous-travail>
                      {/* Le tronc qui relie le rond de « Travail » au haut de la liste (la zone qui défile rognerait
                          tout trait qui remonterait au-dessus d'elle). Axe : le centre du rond, 11 px. */}
                      <span aria-hidden className={`${CLASSE_TRAIT_DE_BRANCHE} top-0 h-[8px] border-l`} style={{ left: 11 }} />
                      {taches!.corps}
                    </div>
                  ) : (
                    <span hidden data-taches-sous-travail data-taches-repliees />
                  )
                ) : null}
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}

/** Le rond d'une ligne d'étape, au dessin de la liste des tâches : 14 px, violet là où l'on est. */
function PetitRond({ forme }: { forme: FormeDuRondDEtape }) {
  return (
    <span
      aria-hidden
      data-rond-etape={forme}
      className={cn(
        'flex h-[14px] w-[14px] shrink-0 items-center justify-center rounded-full',
        forme === 'faite'
          ? 'bg-text text-bg'
          : forme === 'avenir'
            ? 'border-[1.5px] border-faint/50'
            : forme === 'erreur'
              ? 'border-[1.5px] border-danger text-danger'
              : 'border-[1.5px] border-teinte text-teinte',
      )}
    >
      {forme === 'faite' ? (
        <Check className="h-2.5 w-2.5" strokeWidth={3.5} />
      ) : forme === 'travail' ? (
        <Loader2 className="h-2.5 w-2.5 animate-spin motion-reduce:animate-none" strokeWidth={3} />
      ) : forme === 'erreur' ? (
        <span className="text-[9px] font-bold leading-none">!</span>
      ) : forme === 'ici' ? (
        <span className="h-1.5 w-1.5 rounded-full bg-teinte" />
      ) : null}
    </span>
  );
}
