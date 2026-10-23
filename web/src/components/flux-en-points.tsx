import * as React from 'react';
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  AlertTriangle,
  Copy,
  Info,
  Cpu,
  FileText,
  Flag,
  Lightbulb,
  Loader2,
  MessageSquare,
  Rocket,
  RotateCcw,
  Terminal,
  Wrench,
  X,
  type LucideIcon,
  LayoutGrid,
} from 'lucide-react';
import { PointDuFil, type TonDuPoint } from '@/components/point-du-fil';
import { ICONE_DE_LA_LIGNE, ICONE_DU_GENRE, RondDeLaLigne } from '@/components/icone-du-point';
import {
  AttenteDeLaDemande,
  BlocRaconte,
  Card,
  ElementDuFlux,
  EntreeJournal,
  ETAPES_DE_LANCEMENT,
  ErreurDuPoint,
  EtapeDeLancement,
  EtapeDuParcours,
  type EtatDuDeploiement,
  type EtatDuPoint,
  LIBELLES_ETAPE,
  LigneDuCarnet,
  MomentDuPoint,
  PHRASES_DE_L_ATTENTE,
  PHRASE_PLAN_A_DECIDER,
  PointDuParcours,
  type SuiviDUneFille,
  LIBELLES_DE_LA_FILLE,
  estCarteDuRendezVousDeNuit,
  avancementDuLancement,
  blocDeFinAViser,
  blocDeFinDuPassage,
  repartirLesMediasLivres,
  type MediaLivre,
  sujetsDuCadrage,
  decouperAvantLePlan,
  reflexionRepliee,
  retirerLaStructureDeCadrage,
  retirerLeBlocDeProcessus,
  genreDAction,
  nomClairDeLaLigne,
  nomDeLaLigne,
  poidsLisible,
  SousPointDuTravail,
  phraseDuBloc,
  rangerLaComprehension,
  recitDuPoint,
  segmenterLeRecit,
  entreesDeLaSorte,
  tempsDuPassage,
  toursSansBulleParPoint,
  travailEnSousPoints,
  VersionDuPassage,
  versionDuPassageDePlan,
  versionEnPreparation,
  vueDeLEntree,
  type TourDuParcours,
  type CompetenceProposee,
  planCourant,
  travailDeLaCarteDejaLance,
  rangerLesSuggestions,
  type GroupeDeSuggestions,
} from '@beluga/shared';
import { createPortal } from 'react-dom';
import { ContexteEmplacementDuDocument, fermerLeDocument, ouvrirLeDocument, useDocumentDeCarte } from '@/lib/document-de-carte';
import { Button, Dialog, DialogContentLibre, DialogHeader, DialogTitle, ZoneDefilement } from '@/components/ui';
import { ContenuDeLEntree, EncadreQuestion } from '@/components/contenu-journal';
import { BlocDuPlan } from '@/components/parcours-carte';
import { PlanRapport } from '@/components/plan-rapport';
import { PointsDuCadrage } from '@/components/points-du-cadrage';
import { MediasLivres, useMediasLivres } from '@/components/medias-livres';
import { BULLE_DE_L_AGENT, RapportEnFlux } from '@/components/rapport-flux';
import { SilhouetteParcours } from '@/components/silhouettes';
import { LienPromptDeLaDemande, LiensDesPromptsDuPoint } from '@/components/prompt-envoye-complet';
import { Markdown, SuitesProposees, suitesDuJalon } from '@/lib/markdown';
import { client } from '@/lib/client';
import { voirLesSuggestions } from '@/lib/suggestions-de-carte';
import { useTitresClairs } from '@/lib/titres-memoire';
import { ouvrirLesDecisions } from '@/lib/ouvrir-decisions';
import { copierLaDemande } from '@/lib/copie-riche';
import { useApp } from '@/lib/use-app';
import { CompetenceDuFlux } from '@/components/encadre-competence';
import { ApercuDesCaptures, OuvrirUneCapture, type GalerieDesCaptures } from '@/components/captures-du-flux';
import { useTelephone } from '@/lib/telephone';
import { MESURES_DU_FLUX, TON_DE_L_ETAT, type MesuresDuFlux } from '@/components/mesures-du-flux';
import { cn, dateHeure, dureeFine, heureEtDuree } from '@/lib/utils';
import { t } from '@/lib/langue';

/**
 * LE FLUX D'UNE CARTE EN GRANDS POINTS.
 *
 * Le parcours se lisait ligne par action, imbriqué à tant de niveaux qu'on ne
 * savait plus ce qui était quoi. Il se lit maintenant en CINQ POINTS — la
 * demande, ce que l'agent a compris, le plan, le travail, le compte rendu —,
 * chacun sous un GRAND ROND à icône lisible, avec une PHRASE simple qui dit
 * où il en est. Un point se touche pour s'ouvrir ; ouvert, il montre ce qu'il
 * porte (le texte de la demande, la compréhension, les versions du plan, le
 * compte rendu), puis, repliés derrière un geste de plus, la MÉMOIRE que le
 * carnet dit de son étape, ses TRACES techniques exactes et ses boutons
 * secondaires (Copier, Exporter). Rien de technique ne s'affiche tant qu'on
 * ne l'a pas demandé.
 *
 * Une QUESTION encore ouverte est un point JAUNE à part, inséré juste après
 * le point qui l'a posée : c'est là qu'elle arrête l'agent. Une ERREUR se lit
 * en ROUGE dans le point de son étape, avec une phrase limpide et le geste
 * qui la règle.
 *
 * COULEURS : orange pour ce qui est EN COURS, bleu pour ce qui est FAIT, jaune
 * pour une question, rouge pour une erreur — jamais une couleur en dur, toujours
 * un jeton de thème.
 *
 * Tout ce qui se DÉCIDE ici vient de la règle pure
 * `shared/src/parcours-en-points.ts` ; ce fichier ne fait que dessiner.
 */

/** L'icône de chaque étape : la même sur le point et sur la barre. */
export const ICONE_DE_L_ETAPE: Record<EtapeDuParcours, React.ComponentType<{ className?: string }>> = {
  configuration: Cpu,
  demande: MessageSquare,
  comprehension: Lightbulb,
  plan: FileText,
  preparation: Rocket,
  travail: Wrench,
  rapport: Flag,
};

/**
 * LE FIL D'UNE CARTE SE LIT COMME UNE DISCUSSION (refonte du 11/10/2026).
 *
 * Plus de grande ligne verticale ni de rond par étape : la demande est une
 * bulle à droite, ce que l'agent rend se lit à gauche, et les étapes ne sont
 * plus qu'un petit intitulé discret — la barre d'étapes, en haut de la page,
 * dit déjà où l'on en est. Les mesures du premier niveau sont donc remises à
 * plat ; celles du journal replié (les sous-points d'un travail) ne bougent
 * pas. Le suivi d'une publication (`volet-publication.tsx`) garde, lui, le
 * dessin à ronds de `MESURES_DU_FLUX`.
 */
const enDiscussion = (mesures: MesuresDuFlux): MesuresDuFlux => ({
  ...mesures,
  decalage: '',
  ligne: 'hidden',
  retraitDuContenu: '',
  texteDuSousPoint: '',
  rondDuSousPoint: 'hidden',
});

/**
 * LA MARQUE D'ÉTAPE, ENTRE DEUX MESSAGES — comme la date dans une messagerie.
 *
 * Une petite pastille centrée : l'icône de l'étape et son nom. Elle dit où en
 * est le fil (« Demande », « Compréhension », « Travail », « Rapport »…) sans
 * rien encadrer. Une roue remplace l'icône tant que l'agent y travaille ; un
 * triangle, quand l'étape est tombée.
 */
function MarqueDEtape({
  icone: Icone,
  titre,
  etat,
  repere,
  discrete = false,
}: {
  icone: React.ComponentType<{ className?: string }>;
  titre: string;
  etat: EtatDuPoint;
  repere: string;
  /** Lue par les lecteurs d'écran, invisible à l'écran. */
  discrete?: boolean;
}) {
  return (
    <div className={cn('flex justify-center', discrete && 'sr-only')} data-marque-d-etape={repere} data-marque-etat={etat}>
      <span className="inline-flex items-center gap-1.5 rounded-full bg-raised px-3 py-1 text-[12.5px] font-medium text-muted">
        {etat === 'encours' ? (
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin motion-reduce:animate-none" />
        ) : etat === 'erreur' ? (
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-danger" />
        ) : (
          <Icone className="h-3.5 w-3.5 shrink-0" />
        )}
        {titre}
      </span>
    </div>
  );
}

/** Les mesures partagées par tout le flux, sans les repasser de main en main. */
const MesuresContexte = React.createContext<MesuresDuFlux>(MESURES_DU_FLUX.ordinateur);
const useMesures = () => React.useContext(MesuresContexte);

/**
 * LA VUE TECHNIQUE, RETENUE LE TEMPS DE LA SESSION.
 *
 * Le fil RACONTE : une phrase par geste, à la première personne, sans nom de
 * fichier ni ligne de commande. Qui veut l'inventaire d'origine — les
 * catégories en petites capitales et ce que chaque action a touché — bascule
 * le point ENTIER d'un bouton posé en haut à droite de son entête.
 *
 * Ce choix se garde ici, HORS de React : un point qu'on referme et qu'on
 * rouvre, une carte qu'on quitte et qu'on reprend, retrouvent la vue qu'on
 * avait choisie. Il ne survit pas au rechargement de la page — c'est un
 * confort de lecture, pas un réglage.
 */
const VUE_TECHNIQUE: Record<string, boolean> = {};

/** La vue du point qu'on est en train de dessiner : racontée, ou technique. */
const ModeTechniqueContexte = React.createContext(false);
const useModeTechnique = () => React.useContext(ModeTechniqueContexte);

/**
 * UN SOUS-POINT DU FLUX : LE SECOND NIVEAU, POUR TOUTES LES ÉTAPES.
 *
 * Seul le point « Travail » avait ses sous-points sur une ligne ; partout
 * ailleurs, le passage ouvert empilait des cartons gris posés à côté du fil,
 * sans rond ni trait — et « Dépôt » était un encadré à bascule qui flottait
 * hors de la ligne. Le regard perdait le fil dès qu'il descendait d'un cran.
 *
 * Tout ce qu'un passage porte est donc un SOUS-POINT : petit rond, ligne
 * verticale continue en `--faint`, et son contenu à droite du rond. Les
 * enclos gris ne disparaissent pas — ils se posent à droite de leur rond.
 *
 * LA LIGNE S'ARRÊTE TOUTE SEULE au dernier sous-point
 * (`[li:last-child>&]:hidden`) : aucun appelant n'a à compter ses éléments, et
 * une liste qui s'allonge en cours de tour reste juste sans qu'on y pense.
 * LA RÈGLE NE REGARDE QUE LE `li` PARENT DIRECT. `group-last:hidden` compile en
 * `.group:last-child .x`, qui vise N'IMPORTE QUEL ancêtre dernier de sa liste —
 * les actions sous la dernière ligne de tâche perdaient donc toutes leur trait ;
 * un groupe NOMMÉ ne sauve rien, la ligne de tâche portant le même nom.
 * Le trait va du centre du rond au centre du rond suivant (14 px sous le haut
 * de chaque `li`), posé AVANT le rond pour passer dessous.
 *
 * LE DEUXIÈME NIVEAU SE POSE SUR L'AXE DU GRAND ROND. Rond et texte décalés
 * de 28 px de plus à chaque point ouvert poussaient tout le flux à droite :
 * un sous-point DIRECT d'un point (niveau 0) pose donc son rond de 24 px sur
 * la grande ligne du flux — qui les relie, d'où l'absence de trait à lui — et
 * son texte sous le titre du point. Un sous-point imbriqué dans un autre
 * garde sa petite mise en page dans la colonne du texte de son parent : sur
 * l'axe principal, il se confondrait avec le deuxième niveau.
 */
const NiveauDuSousPoint = React.createContext(0);

/**
 * LA CARTE D'UN PASSAGE OUVERTE EST UN POINT, ET SON DÉTAIL DES POINTS DESSOUS
 * (demande du 11/10/2026 : « développe le point "agent au travail" avec des
 * points en dessous »).
 *
 * La discussion a remis le premier niveau à plat (`enDiscussion`) : une bulle
 * ou une réponse n'ont ni rond ni trait. Mais le DÉTAIL d'un passage — le
 * dépôt, la réflexion, chaque tâche — se lisait alors comme une pile de lignes
 * sans lien entre elles. Dans la carte ouverte, la ligne de tête porte donc
 * son point, et chaque ligne du détail le sien, sur le même axe, reliés par un
 * trait fin. Hors de la carte, rien ne change.
 */
const PointsDeLaCarte = React.createContext(false);
/** La gouttière des points : 24 px, le point centré à 12 px, le texte juste après. */
const TEXTE_APRES_LE_POINT = 'pl-6';

/** Le retrait d'une ligne sans rond posée parmi des sous-points : alignée sur leur texte. */
function useRetraitDuTexte() {
  const mesures = useMesures();
  const enCarte = React.useContext(PointsDeLaCarte);
  if (React.useContext(NiveauDuSousPoint) !== 0) return 'pl-7';
  return enCarte ? TEXTE_APRES_LE_POINT : mesures.texteDuSousPoint;
}

function SousPointDuFlux({
  ton = 'neutre',
  icone,
  attrs,
  children,
}: {
  /** Gris par défaut ; la couleur ne revient que pour une erreur ou un travail en cours. */
  ton?: TonDuPoint;
  /**
   * L'icône de la sorte de ligne (`icone-du-point.tsx`). Sans elle — sorte
   * inconnue, ligne interne d'un encadré — la ligne garde son point gris.
   */
  icone?: LucideIcon;
  attrs?: Record<string, string | number | undefined>;
  children: React.ReactNode;
}) {
  const mesures = useMesures();
  const niveau = React.useContext(NiveauDuSousPoint);
  const surLAxe = niveau === 0;
  /* Dans la carte ouverte d'un passage, le premier niveau porte son point. */
  const pointe = surLAxe && React.useContext(PointsDeLaCarte);
  return (
    <li
      className={cn('group relative', pointe ? TEXTE_APRES_LE_POINT : surLAxe ? mesures.texteDuSousPoint : 'pl-7')}
      data-sous-point-niveau={niveau}
      data-sous-point-pointe={pointe ? '' : undefined}
      {...attrs}
    >
      {pointe ? (
        /* D'un point au suivant : les lignes de la carte sont séparées de 12 px
           (`gap-3`), et chaque point ou icône est centré à 12 px du haut de sa
           ligne. LE TRAIT NE PASSE PLUS SOUS LES POINTS (demande du 12/10/2026) :
           il part 4 px sous ce point (18,5 px) ou cette icône de 14 px (23 px)
           et s'arrête 4 px avant l'icône suivante (12 px d'écart + 5 px dans la
           ligne suivante). */
        <span
          className={cn(
            'absolute -bottom-[13px] left-[11.5px] w-px bg-faint/40 [li:last-child>&]:hidden',
            icone ? 'top-[23px]' : 'top-[18.5px]',
          )}
          aria-hidden
          data-sous-point-trait
        />
      ) : surLAxe ? null : (
        /* Imbriqué : point ou icône centré à 14 px ; le trait laisse 4 px de part
           et d'autre (icône de 14 px : de 25 px à 3 px avant la suivante). */
        <span
          className={cn(
            'absolute -bottom-[3px] left-[10px] w-px bg-faint/40 [li:last-child>&]:hidden',
            icone ? 'top-[25px]' : 'top-[20.5px]',
          )}
          aria-hidden
          data-sous-point-trait
        />
      )}
      {/* L'EMPLACEMENT DE L'ANCIEN ROND RESTE, TRANSPARENT : 24 px sur l'axe
          (20 px en imbriqué), et l'icône de la sorte (14 px), ou à défaut le
          point gris de 5 px, se centre dedans. Le texte ne bouge donc pas d'un
          pixel. */}
      <span
        className={cn(
          'absolute flex items-center justify-center',
          pointe ? 'left-0 top-0 h-6 w-6' : surLAxe ? cn('top-0 h-6 w-6', mesures.rondDuSousPoint) : 'left-0 top-1 h-5 w-5',
        )}
        aria-hidden
        data-sous-point-rond
      >
        <RondDeLaLigne icone={icone} ton={ton} />
      </span>
      <div className={cn('min-w-0', surLAxe ? null : 'pb-2')}>
        <NiveauDuSousPoint.Provider value={niveau + 1}>{children}</NiveauDuSousPoint.Provider>
      </div>
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* Le flux                                                              */
/* ------------------------------------------------------------------ */

/**
 * LES DEUX LARGEURS DU FIL (demande du 12/10/2026, élargie le 13/10/2026).
 * La bulle de l'utilisateur tient à 85 % de la colonne, alignée à droite : ses
 * messages sont courts. Tout ce que l'agent montre — le résumé de la demande, le
 * bloc de travail, sa compréhension, sa réponse, le lien « Voir le prompt
 * envoyé » — occupe 95 % de la colonne, collé à gauche : le texte long a besoin
 * de place, surtout sur téléphone. Deux valeurs VOLONTAIREMENT distinctes ; le
 * contrôle `verif-comprehension-en-points.mjs` mesure les deux.
 */
const LARGEUR_DU_FIL = 'max-w-[85%]';
const LARGEUR_DE_L_AGENT = 'max-w-[95%]';

export interface OuvertureDemandee {
  /** L'ANCRE du passage à ouvrir — le DERNIER de son étape quand la barre l'appelle. */
  ancre: string;
  /** L'étape du flux, ou le point « Déploiement » posé en bas (`PointDeDeploiement`). */
  etape: EtapeDuParcours | 'deploiement';
  nonce: number;
}

/** L'ancre du point « Déploiement » : il n'existe qu'une fois par carte. */
export const ANCRE_DU_DEPLOIEMENT = 'point-deploiement';

export function FluxEnPoints({
  carte,
  projectId,
  flux,
  ouvertsDOffice,
  ouverture,
  onEtapeVisible,
  onBlocRendu,
  attente,
  lancement,
  onToggleEvolution,
  onToggleAll,
  configuration,
  deploiement,
  resumeDeLAgent,
  journalCharge = true,
  galerieDesCaptures,
  suggestions = [],
}: {
  carte: Card;
  /**
   * LES CARTES SUGGÉRÉES DANS CETTE CONVERSATION, groupées par message
   * (`groupesDeSuggestions`) : chaque passage où des cartes sont nées porte la
   * ligne « N cartes suggérées ici », qui rouvre la rangée du pied sur elles.
   */
  suggestions?: GroupeDeSuggestions[];
  /**
   * LES IMAGES DE L'AGENT, tenues par la page de la carte (`chat.tsx`) : la
   * bande « Ce que l'agent a vu » est collée au-dessus de la barre d'écriture,
   * hors de ce flux qui défile. Le flux garde l'aperçu en grand et le lien de
   * ses vignettes (`OuvrirUneCapture`) vers cette même galerie.
   */
  galerieDesCaptures: GalerieDesCaptures;
  /**
   * OÙ EN EST LA MISE EN LIGNE DE LA CARTE (`etatDuDeploiement`). Dès qu'elle
   * est dans « À déployer » ou rangée, un dernier point le dit en bas du flux —
   * sauf sur une carte mère, qui ne se déploie pas elle-même (DEC-258).
   */
  deploiement?: { etat: EtatDuDeploiement; deployeeA?: number };
  /**
   * LE RÉSUMÉ DE L'AGENT QUI A TRAITÉ LA DEMANDE, posé sous le point
   * « Déploiement » une fois la carte en ligne ou rangée : la rangée d'action
   * n'a alors plus de bouton, ni d'icône des réglages.
   */
  resumeDeLAgent?: React.ReactNode;
  projectId?: string;
  /** Les points et les questions ouvertes, dans l'ordre (`fluxDuParcours`). */
  flux: ElementDuFlux[];
  /**
   * LE JOURNAL DE LA CARTE EST-IL ARRIVÉ ? Il est demandé après le premier
   * rendu : tant qu'il manque, le flux montre sa SILHOUETTE au lieu d'un état
   * calculé sur du vide (`SilhouetteParcours`).
   */
  journalCharge?: boolean;
  /** Les ANCRES des passages ouverts sans clic (`pointsOuvertsDOffice`). */
  ouvertsDOffice: string[];
  /** La barre d'étapes demande d'ouvrir et de montrer ce point. */
  ouverture?: OuvertureDemandee | null;
  /** Le point le plus visible pendant le défilement, pour la barre. */
  onEtapeVisible?: (etape: EtapeDuParcours | 'deploiement') => void;
  /**
   * UN BLOC DE FIN VIENT D'ÊTRE RENDU : la conversation dit si elle suivait
   * le bas du fil (vrai), et coupe alors son suivi pour que le défilement vers
   * le début du bloc ne soit pas aussitôt ramené en bas.
   */
  onBlocRendu?: () => boolean;
  /**
   * CE QUI SE PASSE PENDANT L'ATTENTE, écrit sous le DERNIER point
   * « Demande » : préparation du tour, file, ou manque de quota
   * (`attenteDeLaDemande`, `shared/src/parcours-en-points.ts`). Sans cette
   * ligne, une demande bloquée faute de quota tournait exactement comme un
   * tour au travail.
   */
  attente?: AttenteDeLaDemande | null;
  /**
   * L'ÉTAPE DE PRÉPARATION QUE LE DÉMON DIFFUSE (`card.lancement`) : elle donne
   * sa largeur à la barre d'avancement du point « Préparation ». Absente sur
   * une page ouverte en cours de route — la barre s'affiche alors au départ de
   * son parcours, jamais vide.
   */
  lancement?: EtapeDeLancement;
  onToggleEvolution?: (text: string) => void;
  onToggleAll?: (items: string[]) => void;
  /**
   * CE QUI SE LIT DANS LE POINT « CONFIGURATION » : le bloc des réglages de
   * l'agent (`ReglagesAgent`, `chat.tsx`). Il vivait en bande fixe au-dessus
   * de la barre d'étapes ; il est devenu le PREMIER point du parcours.
   */
  configuration?: React.ReactNode;
}) {
  const telephone = useTelephone();
  const mesures = enDiscussion(telephone ? MESURES_DU_FLUX.telephone : MESURES_DU_FLUX.ordinateur);
  /*
   * L'OUVERTURE EST UN CHOIX DE LECTURE, POINT PAR POINT : ouvrir un passage ne
   * referme pas son voisin. `choisis` ne retient que les gestes faits À LA
   * MAIN : un passage refermé le reste tant que la carte est à l'écran, même
   * s'il tourne encore.
   */
  const [choisis, setChoisis] = React.useState<Record<string, boolean>>({});
  React.useEffect(() => setChoisis({}), [carte.id]);

  /* LA VUE TECHNIQUE, ÉTAPE PAR ÉTAPE : basculer « Travail » ne change pas la
     façon dont « Demande » se lit. Le choix est repris du magasin de session
     à chaque montage, et y retourne à chaque bascule. */
  const [techniques, setTechniques] = React.useState<Record<string, boolean>>(() => ({ ...VUE_TECHNIQUE }));
  const basculerTechnique = (etape: EtapeDuParcours) =>
    setTechniques((avant) => {
      const suite = !avant[etape];
      VUE_TECHNIQUE[etape] = suite;
      return { ...avant, [etape]: suite };
    });

  /*
   * UNE CARTE S'OUVRE D'OFFICE SI ELLE EST CE QU'ON VIENT LIRE OU CE QUI SE
   * FAIT : le passage EN COURS (ses points s'ajoutent sous lui au fur et à
   * mesure), le DERNIER rendu de l'agent, un plan qui attend sa décision, une
   * étape tombée. Les passages d'avant tiennent en une ligne. La règle est
   * pure : `pointsOuvertsDOffice` (`shared/src/parcours-en-points.ts`).
   */
  const ouvertes = React.useMemo(() => new Set(ouvertsDOffice), [ouvertsDOffice]);
  const estOuvert = (point: PointDuParcours) => choisis[point.ancre] ?? ouvertes.has(point.ancre);
  const basculer = (point: PointDuParcours) => {
    const ouvrir = !estOuvert(point);
    setChoisis((avant) => ({ ...avant, [point.ancre]: ouvrir }));
  };

  /* LA BARRE D'ÉTAPES EST UN RACCOURCI : toucher un segment ouvre le DERNIER
     passage de son étape et fait défiler jusqu'à lui. */
  const racine = React.useRef<HTMLOListElement>(null);
  React.useEffect(() => {
    if (!ouverture) return;
    /* Le point visé se rouvre s'il avait été refermé à la main ; les autres
       passages de son étape restent comme on les a laissés. */
    setChoisis((avant) => ({ ...avant, [ouverture.ancre]: true }));
    /* ON DÉFILE APRÈS QUE LE POINT S'EST ROUVERT, pas pendant : la page doit
       s'être recalée avant qu'on vise, sinon la cible n'est pas à sa place. */
    const viser = () => {
      const point =
        racine.current?.querySelector<HTMLElement>(`[data-point-ancre="${ouverture.ancre}"]`) ??
        racine.current?.querySelector<HTMLElement>(`[data-point="${ouverture.etape}"]`);
      /* LE PASSAGE « PLAN » SE VISE PAR SON CADRE, PLUS PAR SA TÊTE. Le cadre
         du plan se lit désormais SOUS le récit : viser le haut du passage
         laisserait la décision hors de l'écran, tout en bas. On vise donc le
         cadre lui-même quand il est là — c'est ce qu'on vient décider. */
      const cible =
        (ouverture.etape === 'plan' ? point?.querySelector<HTMLElement>('[data-bloc-du-plan]') : null) ?? point;
      cible?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    const image = requestAnimationFrame(() => requestAnimationFrame(viser));
    return () => cancelAnimationFrame(image);
  }, [ouverture?.nonce]);

  /* LE SEGMENT ACTIF SUIT LE POINT VISIBLE : un observateur dit lequel est le plus présent à l'écran. */
  React.useEffect(() => {
    const liste = racine.current;
    if (!liste || !onEtapeVisible || typeof IntersectionObserver === 'undefined') return;
    const conteneur = liste.closest<HTMLElement>('[data-fil]');
    const visibles = new Map<EtapeDuParcours | 'deploiement', number>();
    const observateur = new IntersectionObserver(
      (entrees) => {
        for (const entree of entrees) {
          const etape = (entree.target as HTMLElement).dataset.point as EtapeDuParcours | 'deploiement' | undefined;
          if (!etape) continue;
          if (entree.isIntersecting) visibles.set(etape, entree.intersectionRatio);
          else visibles.delete(etape);
        }
        let meilleure: EtapeDuParcours | 'deploiement' | undefined;
        let ratio = -1;
        for (const [etape, r] of visibles) if (r > ratio) [meilleure, ratio] = [etape, r];
        if (meilleure) onEtapeVisible(meilleure);
      },
      { root: conteneur, threshold: [0.1, 0.5, 0.9] },
    );
    for (const point of liste.querySelectorAll('[data-point]')) observateur.observe(point);
    return () => observateur.disconnect();
  }, [flux.length, onEtapeVisible]);

  /* L'ATTENTE SE LIT SOUS LA DERNIÈRE DEMANDE : c'est elle qui attend. */
  const ancreDeLAttente = React.useMemo(() => {
    let derniere: string | undefined;
    for (const element of flux) if (element.sorte === 'point' && element.point.etape === 'demande') derniere = element.point.ancre;
    return derniere;
  }, [flux]);

  /* LES PASSAGES SEULS : c'est sur eux que chaque point « Plan » lit sa version. */
  const passages = React.useMemo(
    () => flux.flatMap((element) => (element.sorte === 'point' ? [element.point] : [])),
    [flux],
  );
  /*
   * LES MÉDIAS LIVRÉS, CHACUN SOUS LA RÉPONSE QUI CLÔT SON TOUR : la réponse, la
   * compréhension, le plan ou le compte rendu rendu juste après lui.
   */
  const tousLesMediasLivres = useMediasLivres({ cardId: carte.id });
  const mediasParPassage = React.useMemo(() => {
    const reponses: { cle: string; at: number }[] = [];
    for (const passage of passages) {
      const bloc = blocDeFinDuPassage(passage);
      const entree = bloc
        ? passage.reponse?.id === bloc.cle
          ? passage.reponse
          : passage.moments.find((m) => m.entree.id === bloc.cle)?.entree
        : passage.moments.find((m) => m.sorte === 'rapport' && m.dernier)?.entree;
      if (entree) reponses.push({ cle: passage.ancre, at: entree.at });
    }
    return repartirLesMediasLivres(tousLesMediasLivres, reponses);
  }, [passages, tousLesMediasLivres]);
  /* LES VERSIONS QUE LA CARTE CONNAÎT : un plan connu ne se cache jamais, même
     quand son jalon manque au journal affiché. */
  const versionsConnues = (carte.parcours?.plans ?? []).map((plan) => plan.numero);

  /*
   * CE QUE LE TOUR A RENDU SE LIT PAR SON DÉBUT. Une réponse, une compréhension
   * ou un plan qui arrive fait défiler le fil jusqu'au HAUT de son cadre — plus
   * jusqu'au bas du fil, où l'on tombait sur la dernière ligne d'un long texte.
   * Une seule fois par bloc (sa clé), et seulement si la conversation suivait
   * ce qui s'écrit (`onBlocRendu`) : on ne tire pas la page sous les yeux de
   * quelqu'un qui relit plus haut.
   */
  const aViser = React.useMemo(() => blocDeFinAViser(passages), [passages]);
  const blocsVises = React.useRef<Set<string>>(new Set());
  /*
   * …MAIS PAS À L'OUVERTURE DE LA TÂCHE (demande du 14/10/2026) : en entrant
   * dans une tâche, le fil se pose TOUT EN BAS, et l'en-tête se replie comme
   * après un défilement (`repliALOuverture`). Le bloc déjà rendu au premier
   * chargement du journal est donc compté comme vu, sans défiler ; seuls ceux
   * qui arrivent ensuite, en direct, tirent le fil jusqu'à leur début.
   */
  const journalVuALOuverture = React.useRef(false);
  React.useEffect(() => {
    blocsVises.current = new Set();
    journalVuALOuverture.current = false;
  }, [carte.id]);
  React.useEffect(() => {
    if (!journalCharge) return;
    if (!journalVuALOuverture.current) {
      journalVuALOuverture.current = true;
      if (aViser) blocsVises.current.add(aViser.cle);
      return;
    }
    if (!aViser || blocsVises.current.has(aViser.cle)) return;
    blocsVises.current.add(aViser.cle);
    if (onBlocRendu && !onBlocRendu()) return;
    const viser = () => {
      const point = racine.current?.querySelector<HTMLElement>(`[data-point-ancre="${aViser.ancre}"]`);
      const selecteur =
        aViser.sorte === 'reponse'
          ? '[data-bloc-reponse]'
          : aViser.sorte === 'comprehension'
            ? '[data-moment="comprehension"]'
            : '[data-bloc-du-plan]';
      const cadres = point?.querySelectorAll<HTMLElement>(selecteur);
      const cible = (cadres?.length ? cadres[cadres.length - 1] : null) ?? point;
      cible?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    const image = requestAnimationFrame(() => requestAnimationFrame(viser));
    return () => cancelAnimationFrame(image);
  }, [aViser?.cle, journalCharge]);

  /* LES TOURS LANCÉS PAR UN BOUTON n'ont pas de bulle de demande : leur texte
     envoyé se lit par un lien posé dans le point où ils laissent leur première
     trace (`toursSansBulleParPoint`). Ceux d'une demande écrite ont leur lien
     sous leur bulle (`LienPromptDeLaDemande`). */
  const toursDuPrompt = React.useMemo(
    () =>
      toursSansBulleParPoint(
        flux.flatMap((element) =>
          element.sorte === 'point'
            ? [
                {
                  ancre: element.point.ancre,
                  etape: element.point.etape,
                  entrees: [...element.point.traces, ...element.point.moments.map((moment) => moment.entree)],
                },
              ]
            : [],
        ),
      ),
    [flux],
  );

  /* TANT QUE LE JOURNAL N'EST PAS LÀ, LE FLUX MONTRE SA FORME, PAS UN ÉTAT.
     Il est demandé après le premier rendu : calculer sur un journal vide
     faisait tourner « Demande » et « Travail » en même temps. */
  if (!journalCharge) return <SilhouetteParcours />;

  const suggestionsParPassage = rangerLesSuggestions(
    flux.map((element) => ({ ancre: element.point.ancre, debut: element.point.debut })),
    suggestions,
  );

  return (
    <MesuresContexte.Provider value={mesures}>
      <OuvrirUneCapture.Provider value={galerieDesCaptures.ouvrirLeChemin}>
      <div className="px-4 pb-6 pt-4" data-flux-points={carte.id}>
        {/* UNE COLONNE DE DISCUSSION : les passages se suivent, séparés par de
            l'air. Plus de ligne verticale (`mesures.ligne` vaut `hidden`). */}
        <ol ref={racine} className="relative flex flex-col gap-6" data-flux-liste={flux.length}>
          <span className={cn('absolute bottom-6 top-6 w-px bg-faint/40', mesures.ligne)} aria-hidden />
          {flux.map((element) => (
            <PointDuFlux
              key={element.cle}
              point={element.point}
              versionDuPlan={versionDuPassageDePlan(element.point, passages, versionsConnues)}
              passages={passages}
              mediasLivres={mediasParPassage.get(element.point.ancre)}
              suggestions={suggestionsParPassage.get(element.point.ancre)}
              carte={carte}
              projectId={projectId}
              configuration={configuration}
              attente={element.point.ancre === ancreDeLAttente ? attente : null}
              toursDuPrompt={toursDuPrompt.get(element.point.ancre)}
              lancement={lancement}
              ouvert={estOuvert(element.point)}
              onBasculer={() => basculer(element.point)}
              technique={!!techniques[element.point.etape]}
              onBasculerTechnique={() => basculerTechnique(element.point.etape)}
              onToggleEvolution={onToggleEvolution}
              onToggleAll={onToggleAll}
            />
          ))}
          {/* La carte de nuit n'a rien à déployer : elle s'arrête à ses propositions. */}
          {deploiement && deploiement.etat !== 'aucun' && !carte.suiviDesFilles?.length && !estCarteDuRendezVousDeNuit(carte) ? (
            <PointDeDeploiement etat={deploiement.etat} deployeeA={deploiement.deployeeA} resume={resumeDeLAgent} />
          ) : null}
        </ol>
        {projectId ? <ApercuDesCaptures galerie={galerieDesCaptures} /> : null}
      </div>
      </OuvrirUneCapture.Provider>
    </MesuresContexte.Provider>
  );
}

/* ------------------------------------------------------------------ */
/* Le point « Déploiement »                                              */
/* ------------------------------------------------------------------ */

/** Le rond du point, dans le ton des autres (`TON_DE_L_ETAT`). */
const ETAT_DU_POINT_DE_DEPLOIEMENT: Record<Exclude<EtatDuDeploiement, 'aucun'>, EtatDuPoint> = {
  attend: 'avenir',
  en_cours: 'encours',
  echec: 'erreur',
  en_ligne: 'fait',
  archivee: 'fait',
};

/**
 * LE DERNIER POINT DU FLUX : OÙ EN EST LA MISE EN LIGNE. Il ne raconte rien
 * d'autre qu'un état — elle attend, elle part, elle est tombée, elle est en
 * ligne depuis telle date — et c'est lui que visent les segments
 * « À déployer » et « Archivée » de la barre. Il ne s'ouvre pas : il n'a rien
 * à déplier.
 */
function PointDeDeploiement({
  etat,
  deployeeA,
  resume,
}: {
  etat: Exclude<EtatDuDeploiement, 'aucun'>;
  deployeeA?: number;
  /** Le résumé de l'agent, une fois la mise en ligne faite (`ResumeDeLAgent`). */
  resume?: React.ReactNode;
}) {
  const mesures = useMesures();
  const etatDuPoint = ETAT_DU_POINT_DE_DEPLOIEMENT[etat];
  const ton = TON_DE_L_ETAT[etatDuPoint];
  const phrase =
    etat === 'attend'
      ? t('La carte attend la prochaine mise en ligne.')
      : etat === 'en_cours'
        ? t('La mise en ligne est en cours.')
        : etat === 'echec'
          ? t('La dernière mise en ligne est tombée : la carte attend la suivante.')
          : etat === 'en_ligne'
            ? t('En ligne depuis le {v0}', { v0: dateHeure(deployeeA ?? 0) })
            : t('Rangée sans mise en ligne.');
  void mesures;
  void ton;
  return (
    <li
      id={ANCRE_DU_DEPLOIEMENT}
      data-point="deploiement"
      data-point-ancre={ANCRE_DU_DEPLOIEMENT}
      data-point-etat={etatDuPoint}
      data-point-deploiement={etat}
      className="relative flex flex-col items-center gap-2"
    >
      <span aria-hidden data-point-rond className="hidden" />
      <MarqueDEtape icone={Rocket} titre={t('Déploiement')} etat={etatDuPoint} repere="deploiement" />
      <span className="text-center text-[13.5px] leading-relaxed text-muted" data-point-phrase>
        {phrase}
      </span>
      {(etat === 'en_ligne' || etat === 'archivee') && resume ? resume : null}
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* Un point                                                             */
/* ------------------------------------------------------------------ */

/**
 * LA LARGEUR DE LA BARRE DE PRÉPARATION, EN POUR CENT. L'étape diffusée donne
 * la mesure ; sans elle, on montre le départ du parcours — le geste est bel et
 * bien parti, et la barre ne doit jamais rester vide.
 */
function avancementDeLaPreparation(etape?: EtapeDeLancement): number {
  return Math.round(avancementDuLancement(etape ?? ETAPES_DE_LANCEMENT[0]) * 100);
}

function PointDuFlux({
  point,
  versionDuPlan,
  carte,
  projectId,
  configuration,
  ouvert,
  onBasculer,
  technique,
  onBasculerTechnique,
  attente,
  toursDuPrompt,
  lancement,
  onToggleEvolution,
  onToggleAll,
  passages,
  mediasLivres,
  suggestions,
}: {
  point: PointDuParcours;
  carte: Card;
  /** Les cartes suggérées pendant ce passage : le repère qui rouvre leur rangée. */
  suggestions?: GroupeDeSuggestions[];
  /** Les médias livrés pendant le tour que ce passage clôt : rendus sous sa réponse. */
  mediasLivres?: readonly MediaLivre[];
  projectId?: string;
  /** Tous les passages du flux : le point « Plan » y lit s'il s'écrit encore. */
  passages: readonly PointDuParcours[];
  /** Le contenu du point « Configuration » : les réglages de l'agent. */
  configuration?: React.ReactNode;
  ouvert: boolean;
  /** Ce point se lit-il en VUE TECHNIQUE plutôt qu'en récit ? */
  technique: boolean;
  /** Bascule ce point — et lui seul — entre le récit et la vue technique. */
  onBasculerTechnique: () => void;
  /** L'attente à écrire sous la phrase, quand ce point est celui qui attend. */
  attente?: AttenteDeLaDemande | null;
  /** Les tours lancés par un bouton dont le texte envoyé se lit dans ce point. */
  toursDuPrompt?: TourDuParcours[];
  /** L'étape de préparation diffusée, pour la barre du point « Préparation ». */
  lancement?: EtapeDeLancement;
  onBasculer: () => void;
  onToggleEvolution?: (text: string) => void;
  onToggleAll?: (items: string[]) => void;
  /** La version de plan que ce passage montre (`versionDuPassageDePlan`). */
  versionDuPlan: VersionDuPassage;
}) {
  const Icone = ICONE_DE_L_ETAPE[point.etape];
  const ton = TON_DE_L_ETAT[point.etat];
  const mesures = useMesures();
  /* LE TEMPS DE TRAVAIL DE CETTE ÉTAPE, lisible SANS l'ouvrir : « combien de
     temps l'agent a-t-il mis ici ? » se répondait en dépliant le passage puis
     en additionnant ses cartons de tête. Le calcul est la règle pure
     `tempsDuPassage` — le même que celui du pied de la liste des gestes, pour
     que les deux ne puissent pas diverger. */
  const temps = React.useMemo(
    () => tempsDuPassage([...point.traces, ...point.questions.map((q) => q.entree)]),
    [point.traces, point.questions],
  );
  /* LE POINT « CONFIGURATION » NE PORTE AUCUNE ENTRÉE DE JOURNAL : son contenu
     est le bloc des réglages, donné par la conversation. */
  const reglages = point.etape === 'configuration' ? configuration : null;
  /* UNE VERSION QUI SE PRÉPARE SE MONTRE DÈS LE CLIC : une silhouette « Plan
     proposé · version N+1 », jamais un passage vide sous l'ancien plan. */
  const preparation =
    point.etape === 'plan' && versionDuPlan === null
      ? versionEnPreparation(point, carte.parcours?.plans ?? [], !!carte.parcours?.planDemandeA)
      : null;
  /* LA COMPRÉHENSION SORT DU BLOC : ses moments se lisent sous la carte du
     passage (`momentsDeComprehension`), le bloc à points ne porte plus que le
     reste. */
  const momentsDeComprehension = point.moments.filter((moment) => moment.sorte === 'comprehension');
  const momentsDuCarton = point.moments.filter((moment) => moment.sorte !== 'comprehension');
  const aDuContenu =
    !!reglages ||
    !!preparation ||
    point.moments.length > 0 ||
    point.traces.length > 0 ||
    !!point.reponse ||
    point.questions.length > 0 ||
    point.memoire.length > 0 ||
    !!point.competences?.length ||
    point.erreurs.length > 0;

  /* CE QUE L'AGENT A FAIT (le récit) et CE QU'IL A RENDU (le carton) : deux
     blocs, dont l'ORDRE change au point « Plan » seulement. */
  const recit = (
    <ModeTechniqueContexte.Provider value={technique}>
      {/* LA RÉFLEXION SE REPLIE DEVANT CE QUE LE TOUR A RENDU (`reflexionRepliee`) :
          une réponse ou une compréhension se lit en tête, les actions restent
          à un clic. Rouverte à la main, elle le reste tant que le passage vit. */}
      <BlocsRacontes point={point} projectId={projectId} repliable={reflexionRepliee(point)} porteSesReglages={!!reglages} />
    </ModeTechniqueContexte.Provider>
  );
  /* LE PASSAGE « PLAN » COUPE SON CARTON EN DEUX. Ce qui a DEMANDÉ la version
     (le clic « Générer le plan », la précision qui l'a fait refaire) reste en
     tête : c'est le point de départ du passage. Le CADRE du plan et ses
     boutons de décision, eux, se lisent en bas, après le récit du travail qui
     les a produits — comme le carton de tous les autres passages. */
  const planEnDeux = point.etape === 'plan' && (carte.parcours?.plans?.length ?? 0) > 0;
  const aUneEnteteDePlan =
    planEnDeux && point.moments.some((m) => m.sorte === 'plan-demande' || m.sorte === 'demande');
  /* LE PLAN SE LIT COMME UNE RÉPONSE, HORS DE LA CARTE (demande du 12/10/2026) :
     tant que sa version n'est pas rendue, le passage montre sa silhouette
     dans la carte ; une fois rendue, le texte se pose sous la compréhension. */
  const planDetache = planEnDeux && versionDuPlan !== null;
  const cartonDe = (part: PartDuCarton, marque: string) =>
    /* LE COMPTE RENDU COURANT N'A NI SOUS-POINT NI SECOND TITRE : la barre de la
       carte le nomme, et sa liste de points se pose directement sur l'axe,
       alignée à gauche. Les précédents gardent leur sous-point et leur barre
       grise repliée. */
    point.etape === 'rapport' && part === 'cadre' ? (
      <>
        {momentsDuCarton.map((moment) => {
          const contenu = (
            <Moment
              moment={moment}
              projectId={projectId}
              onToggleEvolution={onToggleEvolution}
              onToggleAll={onToggleAll}
              carte={carte}
            />
          );
          return moment.sorte === 'rapport' && moment.dernier ? (
            <li key={moment.entree.id} data-sous-point-flux={marque} className="min-w-0">
              {contenu}
            </li>
          ) : (
            <SousPointDuFlux key={moment.entree.id} icone={ICONE_DE_LA_LIGNE.rapport} attrs={{ 'data-sous-point-flux': marque }}>
              {contenu}
            </SousPointDuFlux>
          );
        })}
      </>
    ) : (
    <SousPointDuFlux
      attrs={{ 'data-sous-point-flux': marque }}
    >
      <MomentsDuPoint
        point={point}
        carte={carte}
        part={part}
        projectId={projectId}
        onToggleEvolution={onToggleEvolution}
        onToggleAll={onToggleAll}
      />
    </SousPointDuFlux>
    );
  const entete = aUneEnteteDePlan ? cartonDe('entete', 'demande-du-plan') : null;
  /* UN PASSAGE « PLAN » QUI ATTEND SA VERSION N'A PAS DE CADRE : il garde sa
     demande en tête et son récit, et la SILHOUETTE de la version qui arrive. */
  const sansCadre = planEnDeux && versionDuPlan === null;
  const carton =
    planDetache ? null : momentsDuCarton.length && !sansCadre ? (
      cartonDe('cadre', 'rendu')
    ) : preparation ? (
      <SousPointDuFlux
        icone={ICONE_DE_LA_LIGNE.plan}
        attrs={{ 'data-sous-point-flux': 'plan-en-preparation' }}
      >
        <SilhouetteDuPlan version={preparation} />
      </SousPointDuFlux>
    ) : null;

  /* CE QUI N'EST PAS ENCORE ARRIVÉ NE S'ÉCRIT PAS DANS LA DISCUSSION : la barre
     d'étapes le montre déjà. Le passage reste dans le document, caché, pour que
     la barre puisse toujours le viser. Le passage « Configuration » se cache de
     même : les réglages de l'agent s'ouvrent depuis l'en-tête de la page — mais
     son contenu reste monté, il porte la page de ces réglages. */
  const cache = (point.etat === 'avenir' && !aDuContenu) || point.etape === 'configuration';
  /* La demande parle d'elle-même : sa bulle se passe d'intitulé. */
  const sansIntitule = point.etape === 'demande' && point.moments.length > 0;
  /* La phrase fixe d'un passage ne se lit que tant qu'il VIT (en cours, en
     erreur, en attente d'une décision) : sous un passage terminé, elle ne
     redirait que ce que son contenu montre. */
  const phraseUtile =
    (!point.resume || point.phrase === PHRASE_PLAN_A_DECIDER) && (point.etat !== 'fait' || point.phrase === PHRASE_PLAN_A_DECIDER);

  /* CE QUE L'AGENT A FAIT, COMPTÉ : la ligne repliée d'un passage terminé le
     dit comme Claude Desktop (« L'agent a fait 4 actions ») au lieu de la
     phrase fixe de l'étape, qui ne disait rien de ce qui se cache dessous. */
  const nombreDActions = React.useMemo(
    () => recitDuPoint(entreesDeLaSorte([...point.traces].sort((a, b) => a.rang - b.rang), 'actions')).blocs.length,
    [point.traces],
  );

  /* Les sujets du cadrage jusqu'à celui de ce tour, posés au-dessus de sa réponse. */
  const sujets = React.useMemo(
    () => (point.etape === 'comprehension' ? sujetsDuCadrage(passages, point) : []),
    [passages, point],
  );

  if (cache) {
    return (
      <li
        id={point.ancre}
        hidden
        data-point={point.etape}
        data-point-ancre={point.ancre}
        data-point-rang={point.rang}
        data-point-total={point.total}
        data-point-etat={point.etat}
        data-point-ouvert="non"
      >
        <span aria-hidden data-point-rond />
        {reglages}
      </li>
    );
  }

  /* CE QUE LA CARTE PORTE, une fois ouverte : le dépôt, la mémoire, le récit du
     travail, et ce qu'il a rendu. Un passage « Demande » n'y range que le
     travail de l'agent — sa bulle, elle, est toujours à l'écran. */
  const aDansLaCarte =
    point.traces.length > 0 ||
    point.memoire.length > 0 ||
    !!point.competences?.length ||
    !!preparation ||
    (!sansIntitule && !planEnDeux && momentsDuCarton.length > 0) ||
    (point.etape === 'travail' && point.total === 1);
  /* La ligne de la carte : ce que l'agent en dit lui-même, sinon la phrase de
     l'étape. C'est tout ce qu'on lit tant qu'on ne l'ouvre pas. */
  const ligneDeLaCarte =
    point.resume?.trim() ||
    (point.etat === 'fait' && nombreDActions > 0
      ? nombreDActions > 1
        ? t('L’agent a fait {v0} actions', { v0: nombreDActions })
        : t('L’agent a fait 1 action')
      : t(point.phrase));
  /* LE COMPTE RENDU RENDU N'A QU'UN TITRE (demande du 12/10/2026) : « Compte
     rendu » et sa date, sur la barre de la carte. La phrase « Le compte rendu
     est rendu. » redisait ce que ce titre dit déjà, et le même titre se
     répétait dans la carte ouverte. La phrase reste pour les autres états
     (en cours, question, interruption). */
  const rapportRendu =
    point.etape === 'rapport' && point.etat === 'fait'
      ? point.moments.find((moment) => moment.sorte === 'rapport' && moment.dernier)
      : undefined;

  return (
    <li
      id={point.ancre}
      data-point={point.etape}
      data-point-ancre={point.ancre}
      data-point-rang={point.rang}
      data-point-total={point.total}
      data-point-etat={point.etat}
      data-point-ouvert={ouvert ? 'oui' : 'non'}
      className="relative flex flex-col gap-3"
    >
      {/* Le rond d'étape n'est plus dessiné ; son repère reste pour les contrôles. */}
      <span aria-hidden data-point-rond className="hidden" />

      {/* 1. LA MARQUE D'ÉTAPE, entre les messages. UNE DISCUSSION N'A PAS DE
          SÉPARATEURS (carte du 23/10/2026, « comme Claude Desktop ») : la
          marque d'un passage de cadrage TERMINÉ se tait à l'écran — la barre
          d'étapes du haut dit déjà où l'on en est — et ne reste lue que par
          les lecteurs d'écran et les contrôles. Elle reparaît tant que le
          passage tourne ou tombe, et pour ce qui suit le travail.
          LE TRAVAIL EST UN SEUL FLUX (carte du 23/10/2026, capture #5675) :
          chaque tour de l'agent ouvre un passage « Travail » neuf, et chacun
          posait sa pastille — quatre pour une seule carte. Sa marque se tait
          donc dans TOUS ses états ; les tours s'enchaînent sans séparateur et
          la barre du haut dit seule où l'on en est. Seul un passage au titre
          propre (« Examen » de la carte de nuit) garde la sienne. */}
      <MarqueDEtape
        icone={Icone}
        titre={t(point.titre ?? LIBELLES_ETAPE[point.etape])}
        etat={point.etat}
        repere={point.etape}
        discrete={
          (point.etape === 'travail' && !point.titre) ||
          (point.etat === 'fait' && (point.etape === 'demande' || point.etape === 'comprehension' || point.etape === 'plan'))
        }
      />

      {/* 2. CE QUE VOUS AVEZ ÉCRIT : la bulle de la demande (ou la précision
          qui a fait refaire un plan), toujours à l'écran. */}
      {sansIntitule ? (
        <ol className="flex flex-col gap-3" data-point-demande>
          {cartonDe('cadre', 'rendu')}
        </ol>
      ) : entete ? (
        <ol className="flex flex-col gap-3" data-point-demande>
          {entete}
        </ol>
      ) : null}

      {/* LA SYNTHÈSE DE LA DEMANDE, sous sa bulle : ce que l'agent a compris
          qu'on lui demandait, en mots courants, dès le début du tour. Elle ne
          s'écrivait plus que sur la ligne de la carte du passage — or un
          passage « Demande » n'a de carte que s'il a laissé une trace : la
          synthèse ne paraissait donc plus nulle part. */}
      {sansIntitule && point.resume?.trim() && !aDansLaCarte ? (
        <p className={cn('whitespace-pre-line text-[13.5px] leading-relaxed text-muted', LARGEUR_DE_L_AGENT)} data-point-resume>
          {point.resume.trim()}
        </p>
      ) : null}

      {/* 3. CE QUI EST TOMBÉ SE VOIT TOUJOURS, hors de la carte. */}
      {point.erreurs.length ? (
        <ol className={cn('flex flex-col gap-3', LARGEUR_DE_L_AGENT)}>
          {point.erreurs.map((erreur) => (
            <ErreurDansLePoint key={erreur.cle} erreur={erreur} carte={carte} />
          ))}
        </ol>
      ) : null}

      {/* LE TEXTE ENVOYÉ AU MOTEUR par un tour lancé par un bouton : il n'a pas
          de bulle de demande, son lien se pose donc ici, avant le détail. */}
      {toursDuPrompt?.length ? <LiensDesPromptsDuPoint cardId={carte.id} tours={toursDuPrompt} className={cn('w-full', LARGEUR_DE_L_AGENT)} /> : null}

      {/* 4 bis. LES SUJETS DU CADRAGE, au-dessus de la réponse de cette itération
          (20/10/2026, en texte depuis le 21/10/2026) : ceux d'avant avec leur
          résumé, puis celui du tour en gras ; un clic sur un titre d'avant
          remonte à sa réponse. */}
      {sujets.length ? <PointsDuCadrage points={sujets} className={LARGEUR_DE_L_AGENT} /> : null}

      {/* 5. LA RÉPONSE DE L'AGENT : un message, à gauche, toujours à l'écran —
          AU-DESSUS DU SUIVI du passage (demande du 22/10/2026, capture #40a5) :
          on lit d'abord ce que l'agent répond, puis, dessous, la carte qui
          raconte comment il y est arrivé. */}
      {point.reponse ? (
        <ol className="flex flex-col gap-3">
          <SousPointDuFlux icone={ICONE_DE_LA_LIGNE.reponse} attrs={{ 'data-sous-point-flux': 'reponse' }}>
            <MomentDeReponse entree={point.reponse} onToggleEvolution={onToggleEvolution} />
          </SousPointDuFlux>
        </ol>
      ) : null}

      {/* 4. LA CARTE DU PASSAGE : une ligne, qu'on ouvre pour le détail. */}
      {aDansLaCarte || attente || point.mention || (point.etape === 'preparation' && point.etat === 'encours') ? (
        <div className={cn('relative rounded-2xl bg-surface', LARGEUR_DE_L_AGENT)} data-carte-du-passage={point.etape}>
          <button
            type="button"
            onClick={onBasculer}
            aria-expanded={ouvert}
            aria-disabled={!aDansLaCarte}
            data-point-bascule={point.etape}
            className={cn('group/p flex w-full items-start gap-3 py-3 pr-4 text-left', aDansLaCarte ? 'pl-0' : 'pl-4')}
          >
            {/* LE POINT DU PASSAGE : celui de la ligne de tête, sur le même axe
                que les points de son détail. Violet tant que l'agent y
                travaille, rouge s'il est tombé, gris sinon. Ouvert, un trait
                le relie au premier point du dessous. */}
            {aDansLaCarte ? (
              <span className="relative -mr-3 flex w-6 shrink-0 self-stretch justify-center" aria-hidden data-point-de-la-carte={point.etat}>
                {/* Point de tête de 7 px centré à 12 px ; la première icône du dessous a son haut à
                    17 px sous ce bloc (12 px de marge + 5 px). 4 px d'air de chaque côté. */}
                {ouvert ? <span className="absolute -bottom-[13px] left-[11.5px] top-[19.5px] w-px bg-faint/40" data-point-de-la-carte-trait /> : null}
                <span className="relative flex h-6 w-6 items-center justify-center">
                  <PointDuFil
                    ton={point.etat === 'encours' ? 'en-cours' : point.etat === 'erreur' ? 'erreur' : 'neutre'}
                    /* Le violet est la couleur du travail de l'agent : le même
                       que la ligne de tâche en cours, au-dessus du champ. */
                    className={cn(
                      'h-[7px] w-[7px]',
                      point.etat === 'encours' && 'animate-pulse-soft bg-teinte motion-reduce:animate-none',
                    )}
                  />
                </span>
              </span>
            ) : null}
            <span className="min-w-0 flex-1">
              {rapportRendu ? (
                <span className="flex flex-wrap items-baseline gap-x-2 text-[14.5px] leading-relaxed" data-point-phrase data-rapport-titre>
                  <span className="font-medium text-text">{t('Compte rendu')}</span>
                  <span className="text-[12.5px] text-faint">{dateHeure(rapportRendu.entree.at)}</span>
                </span>
              ) : (
                <span
                  className={cn(
                    'block text-[14.5px] leading-relaxed text-text',
                    /* Fermée : deux lignes. Ouverte : le texte entier, avec ses
                       paragraphes (un résumé les sépare d'une ligne vide). */
                    ouvert ? 'whitespace-pre-line' : 'line-clamp-2',
                  )}
                  data-point-phrase
                >
                  {ligneDeLaCarte}
                </span>
              )}
              {/* LA BARRE DE LA PRÉPARATION : entre le clic et le premier mot du
                  moteur, l'avancement vient de l'étape franchie
                  (`avancementDuLancement`), jamais d'une animation dans le vide. */}
              {point.etape === 'preparation' && point.etat === 'encours' ? (
                <span
                  className="mt-2 block h-1 w-full max-w-[320px] overflow-hidden rounded-full bg-raised"
                  data-lancement-barre={lancement ?? 'sans-signal'}
                  aria-hidden
                >
                  <span
                    className="block h-full rounded-full bg-en-cours transition-[width] duration-500"
                    style={{ width: `${avancementDeLaPreparation(lancement)}%` }}
                    data-lancement-avancement={avancementDeLaPreparation(lancement)}
                  />
                </span>
              ) : null}
              {/* LA PHRASE DE LA CARTE, LA MÊME QUE SUR SA VIGNETTE : ce qui a
                  été sauvé, ce qui attend, ce qui s'est passé. */}
              {point.mention ? (
                <span
                  data-mention-point={point.mention.nature}
                  className="mt-1.5 flex items-start gap-1.5 text-[13px] leading-snug text-muted"
                >
                  {point.mention.nature === 'travail' ? (
                    <Check className="mt-[2px] h-3.5 w-3.5 shrink-0" aria-hidden />
                  ) : point.mention.nature === 'information' ? (
                    <Info className="mt-[2px] h-3.5 w-3.5 shrink-0" aria-hidden />
                  ) : (
                    <AlertTriangle className="mt-[2px] h-3.5 w-3.5 shrink-0" aria-hidden />
                  )}
                  <span className="min-w-0">{point.mention.texte}</span>
                </span>
              ) : null}
              {/* L'ATTENTE, EN TOUTES LETTRES : l'agent prépare son tour, ou la
                  demande dort en file faute de quota. */}
              {attente ? (
                <span
                  className="mt-1 flex items-center gap-1.5 text-[13px] leading-snug text-faint"
                  data-point-attente={attente.sorte}
                >
                  <Loader2 className="h-3 w-3 shrink-0 animate-spin" aria-hidden />
                  <span className="min-w-0">
                    {t(PHRASES_DE_L_ATTENTE[attente.sorte])}
                    {attente.position && attente.position > 1 ? ` ${t('({v0}e en file)', { v0: attente.position })}` : ''}
                  </span>
                </span>
              ) : null}
              {/* Le temps de l'étape reste dans le document, pour les contrôles. */}
              {temps?.dureeMs !== undefined ? (
                <span className="sr-only" data-duree-totale-etape={point.etape}>
                  {dureeFine(temps.dureeMs / 1000)}
                </span>
              ) : null}
            </span>
            {aDansLaCarte ? (
              <ChevronRight
                className={cn('mt-1 h-4 w-4 shrink-0 text-faint transition-transform', ouvert && 'rotate-90')}
                aria-hidden
              />
            ) : null}
          </button>

          {/* LE BOUTON « VUE TECHNIQUE », dans le coin de la carte ouverte. */}
          {ouvert && aDansLaCarte ? (
            <button
              type="button"
              onClick={onBasculerTechnique}
              aria-pressed={technique}
              data-point-technique={point.etape}
              data-point-technique-etat={technique ? 'oui' : 'non'}
              title={technique ? t('Revenir au récit') : t('Voir le détail technique')}
              aria-label={technique ? t('Revenir au récit') : t('Voir le détail technique')}
              className={cn(
                'absolute right-10 top-2.5 z-10 rounded-md p-1.5 transition-colors',
                technique ? 'bg-raised text-text' : 'text-faint hover:text-muted',
              )}
            >
              <Terminal className="h-3.5 w-3.5" aria-hidden />
            </button>
          ) : null}

          {ouvert && aDansLaCarte ? (
            /* L'ORDRE DU DÉTAIL : le dépôt, la mémoire, le récit du travail,
               puis ce que ce travail a rendu — la compréhension, le plan, le
               compte rendu. */
            <PointsDeLaCarte.Provider value>
              <ol className="flex flex-col gap-3 pb-4 pl-0 pr-4" data-point-contenu={point.etape}>
                {point.etape === 'travail' && (point.traces.length > 0 || point.total === 1) ? (
                  <DepotDuTravail carte={carte} traces={point.traces} />
                ) : null}
                <MemoireDuPoint lignes={point.memoire} etape={point.etape} />
                <CompetencesDuPoint competences={point.competences} carteId={carte.id} />
                {recit}
                {sansIntitule ? null : carton}
              </ol>
            </PointsDeLaCarte.Provider>
          ) : null}
        </div>
      ) : null}

      {/* 6. LA COMPRÉHENSION, DÉTACHÉE DU BLOC : un texte posé sous le bloc de
          travail (et sous la réponse qui la précède dans le tour), sur le fond
          de la page, sans cadre ni en-tête — comme un message. Le bloc à points
          ne garde que le travail de fond ; ce qu'on lisait dans sa ligne
          « Compréhension n° N » se lit ICI, en entier. Chaque version s'ajoute
          à la suite. */}
      {momentsDeComprehension.length ? (
        <ol className="flex flex-col gap-3" data-point-comprehension-detachee>
          {momentsDeComprehension.map((moment) => (
            <SousPointDuFlux key={moment.entree.id} icone={ICONE_DE_LA_LIGNE.comprehension} attrs={{ 'data-sous-point-flux': 'comprehension' }}>
              <MomentDeComprehension entree={moment.entree} numero={moment.numero} />
            </SousPointDuFlux>
          ))}
        </ol>
      ) : null}

      {/* 7. LE PLAN, DÉTACHÉ DU BLOC COMME LA COMPRÉHENSION (demande du
          12/10/2026 : « un plan doit être rendu sous forme de texte avec des
          titres distincts, pas dans un bloc gris et en dehors du flux de la
          réflexion, comme une réponse »). Du texte, sur le fond de la page, dans
          la largeur d'un message, sous la compréhension du même tour. Chaque
          version se lit en entier, à la suite : rien n'est replié. */}
      {planDetache ? (
        <ol className="flex flex-col gap-3" data-point-plan-detache>
          <SousPointDuFlux icone={ICONE_DE_LA_LIGNE.plan} attrs={{ 'data-sous-point-flux': 'plan' }}>
            <MomentDePlan
              point={point}
              carte={carte}
              passages={passages}
              versionDuPlan={versionDuPlan}
              onToggleEvolution={onToggleEvolution}
              onToggleAll={onToggleAll}
            />
          </SousPointDuFlux>
        </ol>
      ) : null}

      {/* LES FILLES D'UNE CARTE MÈRE et LES CARTES NÉES DE LA NUIT : chaque
          ligne porte son propre lien. */}
      {point.filles?.length ? <FillesDuPoint point={point} /> : null}
      {point.propositions?.length ? <PropositionsDuPoint point={point} /> : null}
      {suggestions?.map((groupe) => (
        <RepereDeSuggestions key={groupe.messageId} carteId={carte.id} groupe={groupe} />
      ))}

      {/* 8. LES MÉDIAS LIVRÉS PAR CE TOUR, TOUS, sous sa réponse finale
          (décision du 20/10/2026) : chacun téléchargeable, et tous d'un coup. */}
      {mediasLivres?.length ? <MediasLivres medias={mediasLivres} className={LARGEUR_DE_L_AGENT} /> : null}
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* Ce qui se lit dans un point ouvert                                    */
/* ------------------------------------------------------------------ */

/**
 * LES DEUX MOITIÉS DU CARTON D'UN PASSAGE « PLAN » : ce qui a DEMANDÉ la
 * version (`entete`, en tête du passage) et le CADRE du plan avec ses boutons
 * de décision (`cadre`, tout en bas). Les autres passages n'ont que le second.
 */
/** Orange pour ce qui est en cours, bleu pour ce qui est terminé. */
const TON_DE_LA_FILLE: Record<SuiviDUneFille['etat'], string> = {
  attente: 'bg-faint',
  travail: 'bg-en-cours',
  question: 'bg-warning',
  panne: 'bg-danger',
  fait: 'bg-termine',
};

/**
 * LES FILLES D'UNE CARTE MÈRE, UNE LIGNE PAR PROJET TOUCHÉ
 * (`avecLeSuiviDesFilles`, `shared/src/parcours-en-points.ts`). Sous
 * « Travail » : où en est chacune, et sur quoi elle travaille. Sous
 * « Rapport » : le compte rendu de chaque fille terminée. Le lien ouvre la
 * carte de la fille, dans son projet — c'est de là qu'elle se met en ligne.
 */
function FillesDuPoint({ point }: { point: PointDuParcours }) {
  const rapport = point.etape === 'rapport';
  return (
    <ul className="mt-1.5 space-y-1 pr-6" data-point-filles={point.etape}>
      {(point.filles ?? []).map((fille) => {
        const texte = rapport ? fille.compteRendu : fille.etat === 'fait' ? undefined : fille.geste;
        return (
          <li
            key={fille.cardId}
            data-fille={fille.cardId}
            data-fille-etat={fille.etat}
            className="rounded-lg bg-raised px-2.5 py-1.5 text-[13.5px] leading-snug"
          >
            <div className="flex items-center gap-2">
              <span className={cn('h-2 w-2 shrink-0 rounded-full', TON_DE_LA_FILLE[fille.etat])} aria-hidden />
              <span className="min-w-0 truncate font-medium text-text">{fille.projet}</span>
              <span className="shrink-0 text-faint">
                {rapport && fille.sansCode ? t('terminé sans modification') : t(LIBELLES_DE_LA_FILLE[fille.etat])}
                {!rapport && fille.etat !== 'fait' && fille.total ? ` · ${fille.faites ?? 0}/${fille.total}` : ''}
              </span>
              <span className="flex-1" />
              <button
                type="button"
                data-ouvrir-fille={fille.cardId}
                onClick={() => client.allerVersDecision({ projectId: fille.projectId, cardId: fille.cardId })}
                className="inline-flex shrink-0 items-center gap-0.5 rounded px-1 text-[12.5px] text-muted hover:text-text"
              >
                {t('Ouvrir')}
                <ArrowUpRight className="h-3 w-3" aria-hidden />
              </button>
            </div>
            {texte ? (
              <p className="mt-0.5 whitespace-pre-line break-words pl-4 text-muted select-text" data-fille-texte>
                {texte}
              </p>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * LES CARTES NÉES DE LA NUIT, sous le point « Propositions » de la carte du
 * rendez-vous (`avecLeParcoursDeLaNuit`) : une ligne par carte, qui l'ouvre
 * d'un clic. Le titre est celui de la carte réelle quand elle est connue (il a
 * pu changer depuis la proposition), sinon celui de la proposition. Une carte
 * absente de l'écran (rangée, déchargée, supprimée) s'ouvre quand même : le
 * tiroir la réclame au serveur et DIT s'il n'y a plus rien (`CarteReclamee`).
 * Seule une proposition sans carte n'a pas de lien.
 */
function PropositionsDuPoint({ point }: { point: PointDuParcours }) {
  const cartes = useApp().cards;
  return (
    <ul className="mt-1.5 space-y-1 pr-6" data-point-propositions={point.propositions?.length ?? 0}>
      {(point.propositions ?? []).map((proposition, index) => {
        const carte = proposition.cardId ? cartes[proposition.cardId] : undefined;
        const titre = carte?.title || proposition.titre;
        const cardId = proposition.cardId;
        return (
          <li key={proposition.cardId ?? index} data-proposition-de-la-nuit={proposition.cardId ?? ''}>
            {cardId ? (
              <button
                type="button"
                data-ouvrir-proposition={cardId}
                onClick={() => client.openCard(cardId)}
                className="flex w-full items-center gap-2 rounded-lg bg-raised px-2.5 py-1.5 text-left text-[13.5px] leading-snug hover:bg-surface"
              >
                <span className="min-w-0 flex-1 truncate font-medium text-text">{titre}</span>
                <span className="inline-flex shrink-0 items-center gap-0.5 text-[12.5px] text-muted">
                  {t('Ouvrir')}
                  <ArrowUpRight className="h-3 w-3" aria-hidden />
                </span>
              </button>
            ) : (
              <div className="flex items-center gap-2 rounded-lg bg-raised px-2.5 py-1.5 text-[13.5px] leading-snug">
                <span className="min-w-0 flex-1 truncate text-muted">{titre}</span>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * « N CARTES SUGGÉRÉES ICI » (demande du 23/10/2026) : la trace, dans le fil,
 * de l'endroit où l'agent a proposé des cartes. Elles vivent dans la rangée du
 * pied, qu'une croix peut fermer ; « Voir » la rouvre et la fait défiler
 * jusqu'à elles (`voirLesSuggestions`).
 */
function RepereDeSuggestions({ carteId, groupe }: { carteId: string; groupe: GroupeDeSuggestions }) {
  const n = groupe.ids.length;
  return (
    <div
      className={cn('flex items-center gap-2 text-[13px] leading-snug text-muted', LARGEUR_DE_L_AGENT)}
      data-repere-suggestions={groupe.messageId}
    >
      <LayoutGrid className="h-3.5 w-3.5 shrink-0 text-faint" aria-hidden />
      <span className="min-w-0">{n > 1 ? t('{v0} cartes suggérées ici', { v0: n }) : t('1 carte suggérée ici')}</span>
      <button
        type="button"
        onClick={() => voirLesSuggestions(carteId, groupe.ids)}
        className="shrink-0 rounded-md px-1.5 py-0.5 font-medium text-text hover:bg-raised"
        data-repere-suggestions-voir=""
      >
        {t('Voir')}
      </button>
    </div>
  );
}

type PartDuCarton = 'entete' | 'cadre';

/**
 * LA SILHOUETTE D'UNE VERSION DE PLAN QUI SE PRÉPARE (`versionEnPreparation`).
 * Une zone qui n'a pas encore ses données montre sa forme, jamais un vide : le
 * vrai cadre la remplace à l'instant où le plan est rendu.
 */
function SilhouetteDuPlan({ version }: { version: number }) {
  return (
    <div
      className="rounded-[20px] bg-raised px-4 py-3.5"
      data-plan-en-preparation={version}
      aria-busy="true"
    >
      <div className="flex items-center gap-1.5 text-[12.5px] font-medium uppercase tracking-wide text-muted">
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
        <span className="truncate">{t('Plan proposé')}</span>
        <span className="shrink-0 whitespace-nowrap normal-case tracking-normal text-faint">
          {t('· version {numero}', { numero: version })}
        </span>
      </div>
      <p className="mt-1.5 text-[12.5px] text-muted">{t('Nouvelle version en préparation…')}</p>
      <div className="mt-2.5 space-y-1.5" aria-hidden>
        <span className="block h-2.5 w-3/4 animate-pulse rounded bg-faint/25" />
        <span className="block h-2.5 w-full animate-pulse rounded bg-faint/25" />
        <span className="block h-2.5 w-2/3 animate-pulse rounded bg-faint/25" />
      </div>
    </div>
  );
}

/**
 * LE PLAN D'UN PASSAGE, LU COMME DANS CLAUDE DESKTOP (carte du 23/10/2026) :
 * dans le fil, un ENCART — sa version, son titre, son résumé, et ce qui en est
 * de son lancement (« rien n'est lancé » tant que la carte n'est pas partie).
 * Un clic ouvre le plan ENTIER dans un panneau à droite sur ordinateur, en
 * page sur téléphone (`document-de-carte.tsx`). Le texte du plan ne se déroule
 * plus au milieu de la discussion : on la lit d'un trait, et le document
 * s'ouvre à côté quand on le veut.
 */
function MomentDePlan({
  point,
  carte,
  passages,
  versionDuPlan,
  onToggleEvolution,
  onToggleAll,
}: {
  point: PointDuParcours;
  carte: Card;
  passages: readonly PointDuParcours[];
  versionDuPlan: VersionDuPassage;
  onToggleEvolution?: (text: string) => void;
  onToggleAll?: (items: string[]) => void;
}) {
  const plans = carte.parcours?.plans ?? [];
  const moment = point.moments.find((m) => m.sorte === 'plan');
  const emplacement = React.useContext(ContexteEmplacementDuDocument);
  const documentOuvert = useDocumentDeCarte(carte.id);
  if (!plans.length || versionDuPlan === null) return null;
  const courant = planCourant(plans);
  const vue = (versionDuPlan === 'courante' ? courant : plans.find((p) => p.numero === versionDuPlan)) ?? courant;
  if (!vue) return null;
  const agentDuPlan = moment?.entree.agentId ?? carte.agentId;
  const etatCarte = {
    colonne: carte.column,
    agentDeLaCarte: carte.agentId,
    codeDejaEnregistre: carte.codeDejaEnregistre,
    /* …sauf le plan d'une RELANCE après rapport (`planDeLaRelance`). */
    cadrageRouvertA: carte.parcours?.cadrageRouvertA,
  };
  const lance = travailDeLaCarteDejaLance({ ...etatCarte, agentDuPlan, planRenduA: vue.at });
  const estCourant = vue.numero === courant?.numero;
  const ouvert = documentOuvert?.genre === 'plan' && documentOuvert.numero === vue.numero;
  const basculer = () => (ouvert ? fermerLeDocument() : ouvrirLeDocument({ cardId: carte.id, genre: 'plan', numero: vue.numero }));
  const etat = !estCourant
    ? t('Version remplacée par la v{v0}', { v0: courant?.numero ?? vue.numero })
    : lance
      ? t('Plan suivi par l’agent')
      : t('Plan prêt — rien n’est lancé');

  const bloc = (
    <BlocDuPlan
      plans={plans}
      version={vue.numero}
      /* L'AGENT DU PLAN EST CELUI QUI L'A ÉCRIT : c'est à lui que
         « Valider » parle, pas à celui qui travaille aujourd'hui. */
      agentId={agentDuPlan}
      planValide={carte.parcours?.planValide ?? null}
      /* ET LE PLAN D'UNE CARTE DÉJÀ LANCÉE NE SE DÉCIDE PLUS : la carte
         le dit elle-même (colonne, agent qui la tient, code enregistré). */
      etatCarte={etatCarte}
      /* LE LOADER NE VISE QUE LE TOUR QUI ÉCRIT CE PLAN (`planEnCoursDEcriture`). */
      passage={point}
      passages={passages}
      onToggleEvolution={onToggleEvolution ?? (() => undefined)}
      onToggleAll={onToggleAll ?? (() => undefined)}
      carte={carte}
    />
  );

  return (
    <div className="flex scroll-mt-12 flex-col items-start" data-moment="plan-rendu">
      {/* UN BLOC ORDINAIRE AU RÔLE DE BOUTON : le résumé est replié
          (`line-clamp`), et un texte replié ne se pose jamais dans un
          `button` (WebKit réserve alors la hauteur du texte entier). */}
      <div
        role="button"
        tabIndex={0}
        aria-expanded={ouvert}
        data-encart-du-plan={vue.numero}
        data-encart-ouvert={ouvert ? '' : undefined}
        onClick={basculer}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          basculer();
        }}
        className={cn(
          /* Le fond du FIL est déjà `surface` : l'encart prend le gris des
             bulles de l'agent, et le violet de l'élément choisi quand il est ouvert. */
          'group flex w-full max-w-[460px] cursor-pointer items-start gap-3 rounded-xl bg-raised px-3.5 py-3 text-left transition-colors hover:bg-raised/70',
          ouvert && 'ring-1 ring-accent/60',
        )}
      >
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-base/60 text-muted group-hover:text-text">
          <FileText className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[12.5px] text-muted">
            {t('Plan v{v0}', { v0: vue.numero })} · {etat}
          </span>
          <span className="block truncate text-[14.5px] font-medium leading-snug text-text">{vue.titre}</span>
          {vue.resume ? <span className="mt-0.5 line-clamp-2 block text-[13.5px] leading-relaxed text-muted">{vue.resume}</span> : null}
        </span>
        <span className="mt-0.5 shrink-0 text-[12.5px] text-faint group-hover:text-text">
          {ouvert ? t('Fermer') : t('Ouvrir')}
        </span>
      </div>
      {ouvert && emplacement
        ? createPortal(
            <PanneauDuPlan titre={t('Plan v{v0}', { v0: vue.numero })}>{bloc}</PanneauDuPlan>,
            emplacement,
          )
        : null}
      {/* SANS EMPLACEMENT (une conversation montée hors de la page d'une
          carte), le plan se déroule dans le fil, comme avant. */}
      {ouvert && !emplacement ? <div data-bulle="agent" className={cn('mt-2', LARGEUR_DE_L_AGENT)}>{bloc}</div> : null}
    </div>
  );
}

/**
 * LE PANNEAU DU PLAN, rendu dans l'emplacement de droite de la page de la
 * carte : son titre, sa croix, et le plan qui défile sur lui-même.
 */
function PanneauDuPlan({ titre, children }: { titre: string; children: React.ReactNode }) {
  return (
    <div className="flex h-full min-h-0 flex-col" data-panneau-du-plan>
      <div className="flex shrink-0 items-center gap-2 px-5 pb-2 pt-3">
        <FileText className="h-4 w-4 text-muted" />
        <span className="min-w-0 flex-1 truncate text-[14.5px] font-medium text-text">{titre}</span>
        <button
          type="button"
          onClick={fermerLeDocument}
          title={t('Fermer le plan')}
          data-fermer-le-plan
          className="flex h-8 w-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-raised hover:text-text"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <ZoneDefilement className="px-5 pb-6">{children}</ZoneDefilement>
    </div>
  );
}

function MomentsDuPoint({
  point,
  carte,
  part,
  projectId,
  onToggleEvolution,
  onToggleAll,
}: {
  point: PointDuParcours;
  carte: Card;
  /** Quelle moitié dessiner. Hors du passage « Plan », seul `cadre` porte quelque chose. */
  part: PartDuCarton;
  projectId?: string;
  onToggleEvolution?: (text: string) => void;
  onToggleAll?: (items: string[]) => void;
}) {
  /*
   * LE POINT « PLAN » PORTE SA VERSION, PAS TOUTES. Chaque version rendue a
   * son propre passage : le sélecteur « n versions » n'a plus lieu d'être, on
   * remonte le flux pour relire la précédente. La version du passage est celle
   * que son jalon a écrite (`versionDuPassageDePlan`) ; un passage qui attend
   * encore la sienne n'en montre AUCUNE — la précédente vit dans son point.
   */
  if (point.etape === 'plan') {
    const plans = carte.parcours?.plans ?? [];
    if (plans.length) {
      /* CE QUI A DEMANDÉ CETTE VERSION se lit EN TÊTE du passage : le clic
         « Générer le plan », ou la précision qui l'a fait refaire. Le cadre du
         plan, lui, attend la fin du récit. */
      if (part === 'entete') {
        return (
          <>
            {point.moments
              .filter((m) => m.sorte === 'plan-demande' || m.sorte === 'demande')
              .map((m) => (
                <Moment key={m.entree.id} moment={m} projectId={projectId} />
              ))}
          </>
        );
      }
      /* LE PLAN NE SE LIT PLUS DANS LA CARTE DU PASSAGE : il est posé sous la
         compréhension, comme une réponse (`MomentDePlan`). */
      return null;
    }
  }
  if (part === 'entete') return null;
  return (
    <>
      {point.moments
        .filter((moment) => moment.sorte !== 'comprehension')
        .map((moment) => (
        <Moment
          key={moment.entree.id}
          moment={moment}
          projectId={projectId}
          onToggleEvolution={onToggleEvolution}
          onToggleAll={onToggleAll}
          carte={carte}
        />
      ))}
    </>
  );
}

/**
 * COPIER LA DEMANDE, IMAGES COMPRISES.
 *
 * Le texte d'une demande se relit souvent ailleurs — dans un éditeur, un
 * courriel, une page de notes — et il fallait jusqu'ici le sélectionner à la
 * souris, en laissant ses captures derrière. Ce bouton écrit les DEUX formes
 * d'un coup (`copierLaDemande`) : le texte brut et une version mise en forme
 * qui embarque les images.
 *
 * Il vaut pour TOUS les blocs de demande du fil, pas seulement le premier, et
 * dit ce qu'il a fait : une coche quand c'est copié, un message quand le
 * navigateur a refusé.
 */
function BoutonCopierLaDemande({ entree, projectId }: { entree: EntreeJournal; projectId?: string }) {
  const state = useApp();
  const [etat, setEtat] = React.useState<'repos' | 'encours' | 'fait'>('repos');
  const minuteur = React.useRef(0);
  React.useEffect(() => () => window.clearTimeout(minuteur.current), []);

  const copier = async () => {
    if (etat === 'encours') return;
    const vue = vueDeLEntree(entree);
    const texte = vue.sorte === 'demande' || vue.sorte === 'texte' ? vue.texte : (entree.resultat ?? '');
    const ids = vue.sorte === 'demande' ? vue.pieces : [];
    const connues = projectId ? (state.attachments[projectId] ?? []) : [];
    const pieces = ids.map((id) => {
      const item = connues.find((piece) => piece.id === id);
      return { id, nom: item?.name, mime: item?.mime };
    });
    setEtat('encours');
    const issue = await copierLaDemande(texte, pieces);
    if (issue === 'echec') {
      setEtat('repos');
      client.afficherMessage('error', t('La copie n’a pas pu se faire.'));
      return;
    }
    setEtat('fait');
    minuteur.current = window.setTimeout(() => setEtat('repos'), 2000);
  };

  return (
    <button
      type="button"
      data-copier-demande={etat}
      onClick={copier}
      title={t('Copier la demande')}
      aria-label="Copier la demande"
      className="shrink-0 rounded-md p-1 text-faint transition-colors hover:bg-raised hover:text-text"
    >
      {etat === 'fait' ? (
        <Check className="h-3.5 w-3.5 text-termine" />
      ) : (
        <Copy className={cn('h-3.5 w-3.5', etat === 'encours' && 'opacity-50')} />
      )}
    </button>
  );
}

function Moment({
  moment,
  projectId,
  onToggleEvolution,
  onToggleAll,
  carte,
}: {
  moment: MomentDuPoint;
  projectId?: string;
  onToggleEvolution?: (text: string) => void;
  onToggleAll?: (items: string[]) => void;
  /** La carte : ses suppositions validées se lisent sur sa compréhension en cours. */
  carte?: Card;
}) {
  const { entree } = moment;
  switch (moment.sorte) {
    case 'demande':
      return (
        /* VOTRE MESSAGE : une bulle à DROITE, comme dans toute messagerie —
           noire en clair, GRISE en sombre (`--encre`), jamais blanche. L'heure
           se lit dessous, en petit ; le bouton de copie ne paraît qu'au survol. */
        <div className="group/bulle flex flex-col items-end" data-moment={moment.sorte}>
          <div
            data-bulle="utilisateur"
            className={cn('bulle-utilisateur rounded-[20px] bg-encre px-4 py-2.5 text-encre-fg', LARGEUR_DU_FIL)}
          >
            <ContenuDeLEntree entree={entree} projectId={projectId} />
          </div>
          <div className="mt-1 flex items-center gap-1 pr-1">
            <span className="transition-opacity survol:opacity-0 group-hover/bulle:survol:opacity-100">
              <BoutonCopierLaDemande entree={entree} projectId={projectId} />
            </span>
            <span className="text-[12px] text-faint" title={moment.premiere ? t('Votre demande') : t('Précision')}>
              {dateHeure(entree.at)}
            </span>
          </div>
          {/* CE QUE L'AGENT A VRAIMENT REÇU, à un clic sous votre message. */}
          <LienPromptDeLaDemande entree={entree} className={cn('w-full self-start', LARGEUR_DE_L_AGENT)} />
        </div>
      );
    case 'comprehension':
      return <MomentDeComprehension entree={entree} numero={moment.numero} />;
    case 'plan-demande':
      return (
        <p className="text-[12.5px] text-faint" data-moment="plan-demande">
          {t('Plan demandé')} · {dateHeure(entree.at)} · {(entree.resultat ?? '').trim()}
        </p>
      );
    case 'plan': {
      /* UN PLAN D'AVANT L'OUTIL : le jalon porte le tour entier, on n'en montre que la part de plan. */
      const texte = decouperAvantLePlan(entree.resultat ?? '').plan.trim() || (entree.resultat ?? '');
      return (
        <div data-moment="plan">
          <p className="mb-1 text-[12.5px] font-medium uppercase tracking-wide text-faint">
            {moment.version ? t('Plan rendu · version {numero}', { numero: moment.version }) : t('Plan proposé')}
            <span className="ml-2 normal-case tracking-normal">{dateHeure(entree.at)}</span>
          </p>
          <PlanRapport contenu={texte} courant={false} onToggleEvolution={onToggleEvolution} onToggleAll={onToggleAll} />
        </div>
      );
    }
    case 'rapport':
      return (
        <MomentDeRapport
          entree={entree}
          dernier={moment.dernier}
          onToggleEvolution={onToggleEvolution}
          onToggleAll={onToggleAll}
        />
      );
    default:
      return null;
  }
}

/**
 * CE QUE L'AGENT A COMPRIS — le point que le vibe codeur vient lire. Rendu par
 * l'outil `rendre_comprehension` : le texte, ce qui reste flou, les sujets de
 * mémoire ouverts.
 *
 * UN TEXTE DÉTACHÉ, PAS UN BLOC (demande du 12/10/2026). Elle vivait dans la
 * carte du passage, derrière une ligne grise « Compréhension n° N » et un
 * panneau au fond contrasté ; or le bloc à points ne doit montrer que le travail
 * de fond du modèle. Elle se lit maintenant SOUS ce bloc, sur le fond de la page,
 * dans la largeur d'un message, avec son heure en petit dessous — comme une
 * réponse. Plus d'en-tête, plus de panneau, plus de volet replié : le texte
 * entier est là, et chaque nouvelle version s'ajoute à la suite.
 *
 * Elle porte le texte seul (en points « Comment » / « Résultat » pour une
 * compréhension d'avant les textes libres). PLUS AUCUN DÉTAIL À L'ÉCRAN
 * (décision du 17/10/2026) : ni sujets de mémoire, ni « Détails techniques »
 * repliés — la compréhension est un message de messagerie, et sa part
 * technique ne sert plus qu'à l'agent d'exécution, qui la reçoit au lancement.
 * Le cahier des charges vivant ne s'y colle pas non plus : il ne paraît que
 * dans le plan (`CahierDesChargesDuPlan`, demande du 17/10/2026).
 */
function MomentDeComprehension({ entree, numero }: { entree: EntreeJournal; numero: number }) {
  /*
   * PLUS AUCUNE SUPPOSITION À L'ÉCRAN (décision du 06/10/2026) : ce qu'un
   * cadrage sans témoin ne peut trancher devient une QUESTION gardée sur la
   * carte, posée au-dessus du champ (`QuestionsDeLaCarte`, `parcours-carte.tsx`).
   */
  const range = React.useMemo(() => rangerLaComprehension(entree.resultat ?? ''), [entree.resultat]);

  return (
    /* LE MÊME DESSIN QUE LA RÉPONSE : à gauche, SANS AUCUN FOND, dans la largeur
       d'un message. `scroll-mt-12` : visée par son début, elle s'arrête sous le
       fondu du haut du fil. */
    <div
      className="flex scroll-mt-12 flex-col items-start"
      data-moment="comprehension"
      data-comprehension-numero={numero}
      data-bloc-comprehension={entree.id}
    >
      <div data-bulle="agent" className={LARGEUR_DE_L_AGENT}>
        <div
          className="comprehension-unie comprehension-detachee space-y-3"
          data-comprehension-contenu
          data-comprehension-forme={range.conforme ? 'points' : 'texte'}
        >
          {range.conforme ? (
            <>
              {range.ouverture ? <Markdown content={range.ouverture} /> : null}
              {/* LE SOMMAIRE ET LES POINTS SONT LA MÊME LISTE. Le sommaire reste
                  entier quand il porte des lignes sans point correspondant
                  (compréhension ancienne, numérotation décalée) : rien ne doit
                  disparaître de l'écran. */}
              {range.sommaire.length && range.points.length < range.sommaire.length ? (
                <ol className="list-decimal space-y-1 pl-5" data-comprehension-sommaire>
                  {range.sommaire.map((ligne, index) => (
                    <li key={index}>{ligne}</li>
                  ))}
                </ol>
              ) : null}
              <div className="space-y-3" data-comprehension-sommaire data-comprehension-volets={range.points.length}>
                {range.points.map((point, index) => (
                  <section key={index} data-point-comprehension={point.intitule} data-point-reference={point.reference}>
                    <p className="font-semibold">
                      {point.reference ? <span className="mr-1.5 font-normal">{point.reference}.</span> : null}
                      {point.intitule}
                    </p>
                    {point.explication ? <Markdown content={point.explication} /> : null}
                    {point.comment ? <PartDuPointCompris libelle={t('Comment')} texte={point.comment} /> : null}
                    {point.resultat ? <PartDuPointCompris libelle={t('Résultat')} texte={point.resultat} /> : null}
                  </section>
                ))}
              </div>
            </>
          ) : (
            /* LE TEXTE LIBRE — devenu le cas ORDINAIRE depuis que le cadrage
               n'impose plus de gabarit, et toujours celui des compréhensions
               écrites avant les volets. Rendu en paragraphes aérés (`mb-2.5`),
               dans un `div` et jamais dans un `button` : tout se lit et se
               copie d'un trait. */
            <Markdown content={entree.resultat ?? ''} className="texte-du-fil [&_p]:mb-2.5" />
          )}
        </div>
      </div>
      <span className="mt-1 pl-1 text-[12px] text-faint">{dateHeure(entree.at)}</span>
    </div>
  );
}

/**
 * LA MANIÈRE ET LE RÉSULTAT ATTENDU D'UN POINT COMPRIS : une ligne de texte
 * sous l'intitulé, son libellé en gras — plus de panneau ni d'en-tête au fond
 * contrasté, puisque la compréhension se lit sur le fond de la page. Le texte
 * garde ses retours à la ligne et se copie à la souris.
 */
function PartDuPointCompris({ libelle, texte }: { libelle: string; texte: string }) {
  return (
    <p className="mt-1 whitespace-pre-line" data-point-part={libelle}>
      <span className="font-semibold">{libelle}</span>
      {' — '}
      {texte}
    </p>
  );
}

/**
 * LA RÉPONSE D'UN TOUR QUI A RÉPONDU AU LIEU DE CADRER (`reponseDuPassage`).
 * Même dessin que la compréhension : un EN-TÊTE au fond contrasté (titre et
 * heure), puis le texte dans un PANNEAU dessous (`panneau.tsx`), sans aucun
 * trait. Le texte se lit ENTIER, jamais tronqué ni replié — donc pas de flèche :
 * c'est ce que la question attendait.
 */
function MomentDeReponse({
  entree,
  onToggleEvolution,
}: {
  entree: EntreeJournal;
  onToggleEvolution?: (text: string) => void;
}) {
  const texte = retirerLeBlocDeProcessus(retirerLaStructureDeCadrage(entree.resultat ?? ''));
  const suites = React.useMemo(() => suitesDuJalon(entree.donnees), [entree.donnees]);
  return (
    /* LA RÉPONSE DE L'AGENT : une BULLE GRISE à GAUCHE, face à la vôtre à
       droite (demande du 22/10/2026). Seule la réponse en porte une : la
       compréhension et le compte rendu restent à plat. `scroll-mt-12` : visée
       par son début, elle s'arrête sous le fondu du haut du fil et se lit nette. */
    <div className="flex scroll-mt-12 flex-col items-start" data-moment="reponse" data-bloc-reponse={entree.id}>
      <div data-bulle="agent" className={cn(BULLE_DE_L_AGENT, LARGEUR_DE_L_AGENT)}>
        <Markdown content={texte} className="texte-du-fil [&_p]:mb-2.5 [&_p]:text-text [&>*:last-child]:mb-0" />
        <SuitesProposees suites={suites} onBasculer={onToggleEvolution} cible={{ entreeId: entree.id }} />
      </div>
      <span className="mt-1 pl-1 text-[12px] text-faint">{dateHeure(entree.at)}</span>
    </div>
  );
}

/**
 * LE COMPTE RENDU D'UN TOUR DE TRAVAIL, sur son gabarit : les six sections en
 * flux vertical, et l'écran dit celles qui manquent.
 *
 * UN SEUL TITRE (demande du 12/10/2026). Le compte rendu courant n'a plus de
 * barre à lui : la barre grise de la carte du passage porte « Compte rendu » et
 * sa date, et c'est elle qui déplie la liste — celle-ci se pose juste dessous,
 * alignée à gauche (`dansLaCarte`). Seuls les comptes rendus PRÉCÉDENTS (une
 * relance en a écrit un nouveau) gardent leur propre barre grise, repliée,
 * « Compte rendu précédent » et sa date.
 */
function MomentDeRapport({
  entree,
  dernier,
  onToggleEvolution,
  onToggleAll,
}: {
  entree: EntreeJournal;
  dernier: boolean;
  onToggleEvolution?: (text: string) => void;
  onToggleAll?: (items: string[]) => void;
}) {
  /* Le choix « replié / déplié » d'un compte rendu précédent ne vaut que pour
     CE compte rendu à CE rang. */
  const cle = `${entree.id}:${dernier ? 'dernier' : 'precedent'}`;
  const [choix, setChoix] = React.useState<{ cle: string; ouvert: boolean } | undefined>(undefined);
  const ouvert = dernier ? true : choix?.cle === cle ? choix.ouvert : false;
  const texte = entree.resultat ?? '';
  const suites = React.useMemo(() => suitesDuJalon(entree.donnees), [entree.donnees]);
  const liste = texte.trim() ? (
    <>
    <RapportEnFlux
      contenu={texte}
      /* ALIGNÉE À GAUCHE, sur l'axe des points de la carte ; le chat garde son
         alignement. */
      dansLaCarte
      onToggleEvolution={onToggleEvolution}
      onToggleAll={onToggleAll}
    />
    {/* LES SUITES POSSIBLES du message de fin (`proposer_suites`) ; figées sur un compte rendu dépassé. */}
    <SuitesProposees suites={suites} onBasculer={onToggleEvolution} figee={!dernier} cible={{ entreeId: entree.id }} />
    </>
  ) : (
    <p className={cn('text-[14.5px] leading-relaxed text-faint', dernier && 'pl-6')}>{t('texte non conservé')}</p>
  );
  return (
    <div data-moment="rapport" data-rapport-dernier={dernier ? 'oui' : 'non'} data-rapport-ouvert={ouvert ? 'oui' : 'non'}>
      {dernier ? null : (
        <button
          type="button"
          onClick={() => setChoix({ cle, ouvert: !ouvert })}
          aria-expanded={ouvert}
          className="flex w-full items-center gap-2 rounded-lg bg-raised px-3 py-2 text-left"
          data-rapport-bascule
        >
          <span className="text-[12.5px] font-semibold text-text">{t('Compte rendu précédent')}</span>
          <span className="text-[12.5px] text-faint">{dateHeure(entree.at)}</span>
          <span className="flex-1" />
          <ChevronRight className={cn('h-3.5 w-3.5 text-faint transition-transform', ouvert && 'rotate-90')} aria-hidden />
        </button>
      )}
      {ouvert ? <div className={dernier ? undefined : 'mt-2'}>{liste}</div> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Les erreurs, avec leur geste                                          */
/* ------------------------------------------------------------------ */

/**
 * UNE ERREUR SE LIT EN ROUGE DANS LE POINT DE SON ÉTAPE, avec une phrase
 * limpide et le geste qui la règle : reprendre le travail, redemander le
 * plan, ou répondre là où la décision attend. La mécanique du démon ne change
 * pas ; seule sa lecture change.
 */
function ErreurDansLePoint({ erreur, carte }: { erreur: ErreurDuPoint; carte: Card }) {
  const [busy, setBusy] = React.useState(false);
  const agir = async () => {
    setBusy(true);
    try {
      /* Une décision attend sur la carte : « Reprendre » MÈNE à elle au lieu
         d'essuyer le refus du démon (`ouvrirLesDecisions`). */
      if (erreur.action === 'reprendre') {
        if (!ouvrirLesDecisions()) await client.demanderLeLancement(carte.id).catch(() => {});
      }
      else if (erreur.action === 'redemander-plan') await client.call({ type: 'plan.generer', cardId: carte.id });
      else if (erreur.action === 'redemander-comprehension') {
        await client.call({ type: 'comprehension.redemander', cardId: carte.id });
      }
      else document.querySelector('[data-panneau-decision], [data-composer]')?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    } catch (err: any) {
      client.signalerRefus(err?.message ?? t('Geste refusé'), carte.id);
    } finally {
      setBusy(false);
    }
  };
  const libelle =
    erreur.action === 'reprendre'
      ? t('Reprendre')
      : erreur.action === 'redemander-plan'
        ? t('Redemander le plan')
        : erreur.action === 'redemander-comprehension'
          ? t('Redemander la compréhension')
          : erreur.action === 'repondre'
          ? t('Répondre')
          : t('Relancer');
  return (
    <SousPointDuFlux
      ton="erreur"
      icone={ICONE_DE_LA_LIGNE.erreur}
      attrs={{ 'data-sous-point-flux': 'erreur' }}
    >
    <div className="rounded-2xl bg-danger/10 px-4 py-3" data-point-erreur={erreur.action ?? 'aucune'}>
      <p className="text-[14.5px] leading-relaxed text-text">
        <span className="min-w-0 whitespace-pre-line break-words">{t(erreur.texte)}</span>
      </p>
      {erreur.action ? (
        <div className="mt-1.5 flex justify-end">
          <Button variant="outline" size="sm" disabled={busy} onClick={() => void agir()} data-point-erreur-geste={erreur.action}>
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
            {libelle}
          </Button>
        </div>
      ) : null}
    </div>
    </SousPointDuFlux>
  );
}

/* ------------------------------------------------------------------ */
/* Le dépôt, dans le point Travail                                       */
/* ------------------------------------------------------------------ */

/** Une commande du journal parle-t-elle de ce geste git ? */
function commandesGit(traces: readonly EntreeJournal[], motif: RegExp): number {
  let compte = 0;
  for (const entree of traces) {
    if (genreDAction(entree) !== 'commande') continue;
    const vue = vueDeLEntree(entree);
    if (vue.sorte === 'commande' && motif.test(vue.commande)) compte += 1;
  }
  return compte;
}

/**
 * LE DÉPÔT SE SUIT DE LA BRANCHE À LA PUBLICATION, en sous-points repliés du
 * point Travail : la branche « tache/… », la copie de travail, les commandes
 * lancées, les enregistrements, les poussées, la fusion, la mise en ligne.
 * Tout est lu sur la carte et dans ses traces — rien n'est deviné.
 */
function DepotDuTravail({ carte, traces }: { carte: Card; traces: EntreeJournal[] }) {
  const [ouvert, setOuvert] = React.useState(false);
  const branche = carte.github?.branch;
  const commandes = traces.filter((entree) => genreDAction(entree) === 'commande').length;
  const enregistrements = React.useMemo(() => commandesGit(traces, /\bgit\s+commit\b/), [traces]);
  const poussees = React.useMemo(() => commandesGit(traces, /\bgit\s+push\b/), [traces]);
  if (!branche && !commandes) return null;
  const lignes: { cle: string; texte: string; fait: boolean }[] = [
    { cle: 'branche', texte: branche ? t('Branche « {v0} » créée', { v0: branche }) : t('Aucune branche encore'), fait: !!branche },
    { cle: 'copie', texte: carte.github?.creeLe ? t('Copie de travail ouverte le {v0}', { v0: dateHeure(Date.parse(carte.github.creeLe)) }) : t('Copie de travail à part'), fait: !!branche },
    { cle: 'commandes', texte: t('{v0} commandes lancées', { v0: commandes }), fait: commandes > 0 },
    { cle: 'enregistrements', texte: t('{v0} enregistrements', { v0: enregistrements }), fait: enregistrements > 0 },
    { cle: 'poussees', texte: t('{v0} poussées vers GitHub', { v0: poussees }), fait: poussees > 0 },
    { cle: 'fusion', texte: carte.github?.fusionnee ? t('Branche fusionnée dans la principale') : t('Branche pas encore fusionnée'), fait: !!carte.github?.fusionnee },
    { cle: 'publication', texte: carte.deployedAt ? t('Mise en ligne le {v0}', { v0: dateHeure(carte.deployedAt) }) : t('Pas encore en ligne'), fait: !!carte.deployedAt },
  ];
  return (
    <SousPointDuFlux
      icone={ICONE_DE_LA_LIGNE.depot}
      attrs={{ 'data-sous-point-flux': 'depot', 'data-point-depot': 'oui' }}
    >
      <button
        type="button"
        onClick={() => setOuvert((o) => !o)}
        aria-expanded={ouvert}
        className="flex w-full items-center gap-2 text-left"
        data-point-depot-bascule
      >
        {/* « DÉPÔT » EST UN TITRE DE POINT, AU GABARIT DE « RÉFLEXIONS » (MEM-3261) :
            14,5 px `font-semibold` `--text`, la branche au second plan à sa
            droite. En 12,5 px, il se lisait comme une étiquette sous le titre
            « Travail », plus petit que ses voisins de même rang. */}
        <span className="shrink-0 text-[14.5px] font-semibold leading-relaxed text-text" data-point-depot-titre>
          {t('Dépôt')}
        </span>
        <span className="min-w-0 flex-1 truncate text-[12.5px] text-faint">
          {branche ?? t('{v0} commandes lancées', { v0: commandes })}
        </span>
        <ChevronRight
          className={cn('h-3.5 w-3.5 shrink-0 text-faint transition-transform', ouvert && 'rotate-90')}
          aria-hidden
        />
      </button>
      {/* LES ÉLÉMENTS DU DÉPÔT SONT DES SOUS-POINTS, sur leur propre ligne :
          la branche, la copie de travail, les commandes, les enregistrements,
          les poussées, la fusion, la mise en ligne. Rien ne se perd de ce que
          l'encadré disait — seule la mise en page change. */}
      {ouvert ? (
        <ol className="mt-1" data-point-depot-contenu>
          {lignes.map((ligne) => (
            <SousPointDuFlux
              key={ligne.cle}
              attrs={{ 'data-point-depot-ligne': ligne.cle }}
            >
              {/* Un nom de branche est un seul MOT, parfois très long : sans
                  point de coupure, il sortait du tiroir sur téléphone. */}
              <span
                className={cn(
                  'block min-w-0 break-words text-[14.5px] leading-relaxed [overflow-wrap:anywhere]',
                  ligne.fait ? 'text-text' : 'text-faint',
                )}
              >
                {ligne.texte}
              </span>
            </SousPointDuFlux>
          ))}
        </ol>
      ) : null}
    </SousPointDuFlux>
  );
}

/* ------------------------------------------------------------------ */
/* La mémoire que le point a consommée                                   */
/* ------------------------------------------------------------------ */

/**
 * LE FLUX RACONTE LA MÉMOIRE : chaque point dit, replié, ce que l'agent a
 * ouvert dans la base de connaissances pendant son étape — unités (identifiant
 * et titre), fiches, changelog, et leur portée — en phrases simples. Les lignes
 * d'avant le 13.09.2026 (ancien arbre) disent encore sujet, branche et poids. Une ligne sortie du contexte se lit quand même :
 * c'est l'histoire de la carte, pas seulement ce que l'agent a encore.
 */
/**
 * LES COMPÉTENCES RETENUES, UNE LIGNE CHACUNE, à l'heure où l'agent les a
 * récupérées (`rangerLesCompetences`). Elles n'ont plus de panneau collé au
 * champ d'écriture : elles vivent dans la carte ouverte de leur passage.
 */
function CompetencesDuPoint({
  competences,
  carteId,
}: {
  competences?: readonly CompetenceProposee[];
  carteId: string;
}) {
  const messages = useApp().cardMessages[carteId]?.messages ?? [];
  if (!competences?.length) return null;
  return (
    <>
      {competences.map((competence) => (
        <SousPointDuFlux
          key={competence.nom}
          icone={ICONE_DE_LA_LIGNE.competence}
          attrs={{ 'data-sous-point-flux': 'competence', 'data-competence-ligne': competence.nom }}
        >
          <CompetenceDuFlux competence={competence} messages={messages} />
        </SousPointDuFlux>
      ))}
    </>
  );
}

function MemoireDuPoint({ lignes, etape }: { lignes: LigneDuCarnet[]; etape: EtapeDuParcours }) {
  const [ouvert, setOuvert] = React.useState(false);
  // Le titre clair de chaque unité ouverte, puis son code : un seul appel pour tout le point.
  const titresClairs = useTitresClairs(lignes.filter((l) => l.genre === 'unite').map((l) => l.sujet));
  if (!lignes.length) return null;
  const nom = (ligne: LigneDuCarnet) => nomClairDeLaLigne(ligne, titresClairs[ligne.sujet]);
  const noms = lignes.map(nom);
  const phrase =
    etape === 'demande'
      ? t('La demande a ouvert d’office {v0}', { v0: noms.join(', ') })
      : etape === 'comprehension'
        ? t('La compréhension a ouvert {v0}', { v0: noms.join(', ') })
        : etape === 'plan'
          ? t('Le plan a ouvert {v0}', { v0: noms.join(', ') })
          : etape === 'travail'
            ? t('Le travail a ouvert {v0}', { v0: noms.join(', ') })
            : t('Le rapport a ouvert {v0}', { v0: noms.join(', ') });
  const portee = (ligne: LigneDuCarnet) =>
    ligne.portee === 'global'
      ? t('mémoire globale')
      : ligne.portee === 'socle'
        ? t('héritée du socle')
        : ligne.portee === 'centrale'
          ? t('mémoire centrale')
          : t('mémoire du projet');
  return (
    <SousPointDuFlux
      icone={ICONE_DE_LA_LIGNE['memoire-ouverte']}
      attrs={{ 'data-sous-point-flux': 'memoire' }}
    >
    <div className="rounded-xl bg-raised/40" data-point-memoire={lignes.length}>
      <button type="button" onClick={() => setOuvert((o) => !o)} aria-expanded={ouvert} className="flex w-full items-center gap-2 px-3 py-1.5 text-left" data-point-memoire-bascule>
        <span className="min-w-0 flex-1 truncate text-[14.5px] text-muted" data-point-memoire-phrase>
          {phrase}
        </span>
        <ChevronRight className={cn('h-3.5 w-3.5 shrink-0 text-faint transition-transform', ouvert && 'rotate-90')} aria-hidden />
      </button>
      {ouvert ? (
        <ul className="space-y-1 px-3 pb-2.5" data-point-memoire-contenu>
          {lignes.map((ligne) => (
            <li key={ligne.id} className="flex flex-wrap items-baseline gap-x-2 text-[12.5px]" data-point-memoire-ligne={ligne.cle}>
              <span className="min-w-0 break-words [overflow-wrap:anywhere] text-text">{nom(ligne)}</span>
              <span className="text-[12.5px] text-faint">
                {[portee(ligne), poidsLisible(ligne.poids), ligne.enContexte ? '' : t('plus dans le contexte')].filter(Boolean).join(' · ')}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
    </SousPointDuFlux>
  );
}

/* ------------------------------------------------------------------ */
/* Le récit du passage, en blocs racontés                                */
/* ------------------------------------------------------------------ */

/**
 * CE QUE L'AGENT A FAIT, EN BLOCS QUI SE LISENT.
 *
 * Ici vivait « Détails techniques » : un bandeau replié qui annonçait
 * « 34 actions · claude · opus · réflexion haute », et, dessous, une ligne par
 * appel d'outil. Il fallait deux gestes et un vocabulaire de développeur pour
 * savoir ce que l'agent avait regardé.
 *
 * Le passage RACONTE maintenant, dépliés d'office : UN CARTON PAR ACTION
 * (`recitDuPoint`, règle pure), titre court et phrase simple. Une capture
 * d'écran regardée montre sa VIGNETTE, qu'un clic agrandit. Le détail exact —
 * la commande, sa sortie brute — reste atteignable d'un cran de plus, jamais
 * au premier niveau.
 *
 * UN TOUR CHARGÉ NE DEVIENT PAS UN MUR : la règle dit combien de cartons se
 * montrent d'office, et le reste attend derrière « voir les N de plus »,
 * qui déplie SUR PLACE sans refermer le passage.
 */
function BlocsRacontes({
  point,
  projectId,
  repliable = false,
  porteSesReglages = false,
}: {
  point: PointDuParcours;
  projectId?: string;
  /** Le passage a rendu son bloc de fin : les actions passent derrière « Réflexion ». */
  repliable?: boolean;
  /** Le point montre déjà le bloc des réglages (« Configuration ») : il n'est pas vide. */
  porteSesReglages?: boolean;
}) {
  const entrees = React.useMemo(
    () => [...point.traces, ...point.questions.map((q) => q.entree)].sort((a, b) => a.rang - b.rang),
    [point.traces, point.questions],
  );
  const [reflexionOuverte, setReflexionOuverte] = React.useState(false);
  const retrait = useRetraitDuTexte();
  /* LA DISCUSSION SE LIT DANS LE FIL, JAMAIS DERRIÈRE « RÉFLEXIONS » : les
     questions répondues et les notes de l'agent se posent comme des mots d'une
     conversation, dans l'ordre où ils sont arrivés. Seules les actions
     (lectures, commandes, outils) se replient et se plafonnent. Le point
     « Travail » garde sa propre lecture, par liste de tâches. */
  const decoupe = point.etape !== 'travail';
  const segments = React.useMemo(() => (decoupe ? segmenterLeRecit(entrees) : []), [decoupe, entrees]);
  const entreesDActions = React.useMemo(() => (decoupe ? entreesDeLaSorte(entrees, 'actions') : entrees), [decoupe, entrees]);
  const aDeLaDiscussion = segments.some((segment) => segment.sorte === 'discussion');
  const actions = React.useMemo(() => (repliable ? recitDuPoint(entreesDActions).blocs.length : 0), [repliable, entreesDActions]);
  const dernierSegmentDActions = segments.map((segment) => segment.sorte).lastIndexOf('actions');

  /* « RÉFLEXIONS » EST UN TITRE DE POINT, PAS UN LIEN GRIS. Le repli s'écrivait
     en 12,5 px `--faint`, chevron en tête : posé juste au-dessus du titre de la
     compréhension, il se lisait comme une note de bas de page alors qu'il ouvre
     tout ce que l'agent a fait. Il reprend donc le gabarit du titre d'une
     compréhension — 14,5 px `font-semibold` `--text` (MEM-3218 : le fil tient
     dans UNE taille), le compte d'actions au second plan à sa droite comme
     l'heure d'une compréhension, chevron à DROITE — et son contenu descend dans
     sa propre liste, en sous-points, au lieu de flotter à côté de lui.
     IL RESTE REPLIÉ D'OFFICE : `data-reflexion-bascule`, `aria-expanded` et
     `data-reflexion-repliee` sont le point d'appui des contrôles (MEM-0582). */
  if (repliable && (actions > 0 || aDeLaDiscussion)) {
    return (
      <>
        {actions > 0 ? (
          <SousPointDuFlux icone={ICONE_DE_LA_LIGNE.reflexion} attrs={{ 'data-reflexion-repliee': reflexionOuverte ? 'ouverte' : 'repliee' }}>
            <button
              type="button"
              onClick={() => setReflexionOuverte((avant) => !avant)}
              aria-expanded={reflexionOuverte}
              data-reflexion-bascule
              className="flex w-full items-center gap-2 text-left"
            >
              <span className="text-[14.5px] font-semibold leading-relaxed text-text">{t('Réflexions')}</span>
              <span className="text-[12.5px] text-faint" data-reflexion-actions={actions}>
                {actions > 1 ? t('{v0} actions', { v0: actions }) : t('1 action')}
              </span>
              <span className="flex-1" />
              <ChevronRight
                className={cn('h-3.5 w-3.5 shrink-0 text-faint transition-transform', reflexionOuverte && 'rotate-90')}
                aria-hidden
              />
            </button>
            {reflexionOuverte ? (
              <ol className="mt-1" data-reflexion-contenu>
                <RecitDuPassage entrees={entreesDActions} projectId={projectId} total />
              </ol>
            ) : null}
          </SousPointDuFlux>
        ) : null}
        {segments
          .filter((segment) => segment.sorte === 'discussion')
          .map((segment) => (
            <MotsDeLaDiscussion key={segment.entrees[0]?.id} entrees={segment.entrees} projectId={projectId} />
          ))}
      </>
    );
  }

  /* RIEN N'EST ARRIVÉ ICI : on le DIT, sauf quand le passage porte déjà son
     carton — un plan seul n'a pas besoin qu'on lui annonce un vide. */
  if (!entrees.length) {
    if (point.moments.length || point.erreurs.length || porteSesReglages) return null;
    return (
      <li className={cn('text-[12.5px] text-faint', retrait)} data-blocs-racontes="0">
        {t('Rien à raconter pour ce passage.')}
      </li>
    );
  }

  /* LE POINT « TRAVAIL » SE LIT À TROIS NIVEAUX : la Réflexion, puis chaque
     point de la liste de tâches, puis les actions sous chacun. Les autres
     passages gardent leurs deux niveaux. */
  if (point.etape === 'travail') {
    return <TravailEnSousPoints entrees={entrees} projectId={projectId} />;
  }

  /* PENDANT LE TRAVAIL, LE FIL SE LIT DANS L'ORDRE : une suite d'actions, puis
     le mot de la discussion qui l'a suivie. Le temps total se rappelle une
     seule fois, sous la dernière suite d'actions, et compte tout le passage. */
  if (aDeLaDiscussion) {
    return (
      <>
        {segments.map((segment, rang) =>
          segment.sorte === 'discussion' ? (
            <MotsDeLaDiscussion key={segment.entrees[0]?.id} entrees={segment.entrees} projectId={projectId} />
          ) : (
            <RecitDuPassage
              key={segment.entrees[0]?.id}
              entrees={segment.entrees}
              projectId={projectId}
              total={rang === dernierSegmentDActions}
              dureeSur={entrees}
            />
          ),
        )}
      </>
    );
  }

  return <RecitDuPassage entrees={entrees} projectId={projectId} total />;
}

/**
 * LE TRAVAIL D'UN TOUR D'AGENT SANS CARTE, DESSINÉ COMME CELUI D'UNE CARTE
 * (demande du 19/10/2026 : « tous les agents, partout, comme les agents de
 * tâche »). Les étapes et la liste de tâches du message sont relues comme un
 * journal (`entreesDuTourSansCarte`, `shared/src/fil-sans-carte.ts`), puis
 * dessinées par les MÊMES pièces que le point « Travail » d'une carte : la
 * liste de tâches en sous-points quand l'agent en a annoncé une, sinon le récit
 * des actions entrecoupé des mots de la discussion (questions et réponses),
 * avec le temps total dessous. Les points portent leurs icônes et leur trait,
 * comme dans la carte ouverte d'un passage.
 */
export function TravailDUnTourSansCarte({ entrees, projectId }: { entrees: EntreeJournal[]; projectId?: string }) {
  const aDesPoints = entrees.some((entree) => entree.nature === 'point');
  const segments = React.useMemo(() => (aDesPoints ? [] : segmenterLeRecit(entrees)), [aDesPoints, entrees]);
  const dernierSegmentDActions = segments.map((segment) => segment.sorte).lastIndexOf('actions');
  if (!entrees.length) return null;
  return (
    <PointsDeLaCarte.Provider value>
      <ol className="flex flex-col gap-3 pb-2" data-fil-sans-carte={entrees.length}>
        {aDesPoints ? (
          <TravailEnSousPoints entrees={entrees} projectId={projectId} />
        ) : (
          segments.map((segment, rang) =>
            segment.sorte === 'discussion' ? (
              <MotsDeLaDiscussion key={segment.entrees[0]?.id} entrees={segment.entrees} projectId={projectId} />
            ) : (
              <RecitDuPassage
                key={segment.entrees[0]?.id}
                entrees={segment.entrees}
                projectId={projectId}
                total={rang === dernierSegmentDActions}
                dureeSur={entrees}
              />
            ),
          )
        )}
      </ol>
    </PointsDeLaCarte.Provider>
  );
}

/**
 * LES MOTS D'UNE DISCUSSION : une question avec sa réponse, une note de
 * l'agent. Chacun se pose dans le fil comme un point à part entière, jamais
 * derrière « Réflexions » ni sous « voir les N précédentes » : c'est ce qu'on
 * vient lire. Une question sans réponse n'est pas ici, elle attend dans le
 * panneau de décision.
 */
function MotsDeLaDiscussion({ entrees, projectId }: { entrees: EntreeJournal[]; projectId?: string }) {
  const recit = React.useMemo(() => recitDuPoint(entrees, { montres: Number.MAX_SAFE_INTEGER }), [entrees]);
  return (
    <>
      {recit.blocs.map((bloc) => (
        <SousPointDuFlux key={bloc.cle} icone={ICONE_DU_GENRE[bloc.genre]} attrs={{ 'data-discussion-bloc': bloc.genre }}>
          <UnBlocRaconte bloc={bloc} projectId={projectId} />
        </SousPointDuFlux>
      ))}
    </>
  );
}

/**
 * LES ACTIONS D'UN PASSAGE, UN CARTON CHACUNE, ET LE REPLI QUI LES TIENT.
 *
 * Au-delà de ce que la règle montre d'office, ce sont les DERNIERS cartons qui
 * se lisent : pendant qu'un agent travaille, on vient voir sa dernière action.
 * Les plus anciens se replient AU-DESSUS, derrière « voir les N précédentes »,
 * dont le compte grossit à chaque action qui arrive. Le bouton déplie SUR
 * PLACE — le passage ne se referme pas — et se replie du même geste.
 */
function RecitDuPassage({
  entrees,
  projectId,
  total = false,
  dureeSur,
}: {
  entrees: EntreeJournal[];
  projectId?: string;
  /**
   * RAPPELER LE TEMPS TOTAL SOUS LE DERNIER GESTE. Vrai pour la liste d'un
   * PASSAGE, faux sous chaque ligne de la liste de tâches du point « Travail » :
   * un total par sous-point se lirait comme dix totaux différents.
   */
  total?: boolean;
  /** Le total se compte sur ces entrées-là (tout le passage) quand la suite n'en montre qu'une part. */
  dureeSur?: EntreeJournal[];
}) {
  const [tout, setTout] = React.useState(false);
  const retrait = useRetraitDuTexte();
  const enCarte = React.useContext(PointsDeLaCarte);
  const niveau = React.useContext(NiveauDuSousPoint);
  const recit = React.useMemo(() => recitDuPoint(entrees), [entrees]);
  const caches = recit.blocs.length - recit.montresDOffice;
  /* Les DERNIERS : `bloc.cle` reste la clé, donc un carton déplié ne se
     referme pas quand la fenêtre glisse d'une action. */
  const montres = tout || caches <= 0 ? recit.blocs : recit.blocs.slice(caches);
  const dureeTotale = dureeSur ? tempsDuPassage(dureeSur)?.dureeMs : recit.dureeMs;
  if (!recit.blocs.length) return null;

  return (
    <>
      {/* LE REPLI EST AU-DESSUS : il ne tient que les actions ANCIENNES, et la
          dernière action reste toujours à l'écran, juste au-dessus du total. */}
      {caches > 0 ? (
        <li className={cn(retrait, 'relative')} data-blocs-repli-ligne>
          {/* LE TRAIT NE S'INTERROMPT PAS ICI : cette ligne n'a pas de point, elle
              porte donc le trait de l'axe jusqu'au point suivant (celui du
              premier bloc montré), comme `SousPointDuFlux`. */}
          {enCarte && niveau === 0 ? (
            <span
              className="absolute -bottom-[13px] left-[11.5px] top-[5.5px] w-px bg-faint/40 [li:first-child>&]:top-0"
              aria-hidden
              data-sous-point-trait
            />
          ) : null}
          <button
            type="button"
            onClick={() => setTout((t) => !t)}
            aria-expanded={tout}
            data-blocs-repli={tout ? 'ouvert' : 'ferme'}
            className="flex items-center gap-1 pb-2 text-[12.5px] text-faint transition-colors hover:text-muted"
          >
            <ChevronRight className={cn('h-3 w-3 transition-transform', tout && 'rotate-90')} aria-hidden />
            {tout ? t('Replier') : t('voir les {v0} précédentes', { v0: caches })}
          </button>
        </li>
      ) : null}
      {montres.map((bloc, rang) => {
        return (
          <SousPointDuFlux
            key={bloc.cle}
            ton={bloc.enEchec ? 'erreur' : 'neutre'}
            icone={ICONE_DU_GENRE[bloc.genre]}
            /* LE REPÈRE DU RÉCIT SE POSE SUR SON PREMIER SOUS-POINT : c'est
               lui qui situe le récit dans l'ordre du passage, et c'est ce que
               les contrôles lisent. */
            attrs={
              rang === 0
                ? { 'data-blocs-racontes': recit.blocs.length, 'data-blocs-montres': montres.length }
                : undefined
            }
          >
            <UnBlocRaconte bloc={bloc} projectId={projectId} />
          </SousPointDuFlux>
        );
      })}
      {/* LE TEMPS TOTAL, RAPPELÉ SOUS LE DERNIER GESTE — et HORS du repli :
          caché derrière un repli, il n'aurait servi qu'à ceux qui
          n'en avaient plus besoin. Il compte tous les gestes du passage, y
          compris ceux qui attendent derrière ce repli. */}
      {total && dureeTotale !== undefined ? (
        <li className={cn(retrait, 'pb-1')}>
          <span
            className="text-[12.5px] leading-snug text-faint tabular-nums"
            data-duree-totale-pied={dureeTotale}
          >
            {t('Total : {v0}', { v0: dureeFine(dureeTotale / 1000) })}
          </span>
        </li>
      ) : null}
    </>
  );
}

/**
 * LE POINT « TRAVAIL » À TROIS NIVEAUX.
 *
 * Sous « Travail » se lisait un empilement plat d'actions : quarante cartons
 * à la file, sans savoir lequel appartenait à quoi. Le journal porte pourtant
 * la LISTE DE TÂCHES de l'agent — c'est elle qui devient le deuxième niveau.
 *
 * Un sous-fil, donc : un petit rond par sous-point, son icône selon son état
 * (réflexion, en cours, faite, échec), son libellé, sa durée à droite. Sous
 * chacun se lisent ses actions, racontées comme partout ailleurs et repliées
 * de la même façon. Le sous-point COURANT s'ouvre d'office ; les autres se
 * déplient au clic.
 *
 * Le découpage vient de la règle pure `travailEnSousPoints`
 * (`shared/src/travail-en-sous-points.ts`) : cet écran ne fait que dessiner.
 */
function TravailEnSousPoints({ entrees, projectId }: { entrees: EntreeJournal[]; projectId?: string }) {
  const sousPoints = React.useMemo(() => travailEnSousPoints(entrees), [entrees]);
  /* LE TOTAL DU PASSAGE se rappelle ici aussi : la « liste des gestes » du
     point « Travail », c'est cette liste de tâches — pas les cartons qu'elle
     contient. */
  const temps = React.useMemo(() => tempsDuPassage(entrees), [entrees]);
  /* LE TOTAL SE RANGE DANS LA COLONNE DU TEXTE DES SOUS-POINTS. Sans retrait,
     il partait du bord gauche du contenu et passait EN PLEIN sur la grande
     ligne du flux, sous les ronds de l'axe. */
  const retrait = useRetraitDuTexte();
  /* LE SOUS-POINT COURANT : celui que le moteur dit « en cours », sinon le
     dernier — c'est là que le regard va d'abord. */
  const courant = React.useMemo(() => {
    const enCours = sousPoints.find((sp) => sp.etat === 'running');
    return (enCours ?? sousPoints[sousPoints.length - 1])?.cle;
  }, [sousPoints]);

  if (!sousPoints.length) return null;

  return (
    <li className="pl-0" data-travail-sous-points={sousPoints.length}>
      {/* LES TÂCHES RESPIRENT (demande du 12/10/2026) : le même écart de 12 px
          que les autres lignes de la carte, sur lequel le trait est réglé. */}
      <ol className="flex flex-col gap-3">
        {sousPoints.map((sousPoint) => (
          <UnSousPointDuTravail
            key={sousPoint.cle}
            sousPoint={sousPoint}
            ouvertDOffice={sousPoint.cle === courant}
            projectId={projectId}
          />
        ))}
      </ol>
      {temps?.dureeMs !== undefined ? (
        <p
          className={cn('pt-1 text-[12.5px] leading-snug text-faint tabular-nums', retrait)}
          data-duree-totale-pied={temps.dureeMs}
        >
          {t('Total : {v0}', { v0: dureeFine(temps.dureeMs / 1000) })}
        </p>
      ) : null}
    </li>
  );
}

/** Le ton du point d'un sous-point : rouge en échec, orange en cours, gris sinon. */
function tonDuSousPoint(sousPoint: SousPointDuTravail): TonDuPoint {
  if (sousPoint.enEchec) return 'erreur';
  if (sousPoint.sorte !== 'reflexion' && sousPoint.etat === 'running') return 'en-cours';
  return 'neutre';
}

/**
 * UN SOUS-POINT DU TRAVAIL : son rond, son libellé, sa durée, et ses actions.
 * La ligne verticale du sous-fil suit `--faint` : elle porte l'enchaînement,
 * elle ne borde pas une zone.
 */
function UnSousPointDuTravail({
  sousPoint,
  ouvertDOffice,
  projectId,
}: {
  sousPoint: SousPointDuTravail;
  ouvertDOffice: boolean;
  projectId?: string;
}) {
  const [choisi, setChoisi] = React.useState<boolean | undefined>(undefined);
  const ouvert = choisi ?? ouvertDOffice;
  const aDesActions = sousPoint.entrees.length > 0;

  return (
    <SousPointDuFlux
      ton={tonDuSousPoint(sousPoint)}
      icone={sousPoint.sorte === 'reflexion' ? ICONE_DE_LA_LIGNE.reflexion : ICONE_DU_GENRE.tache}
      attrs={{
        'data-sous-point': sousPoint.cle,
        'data-sous-point-sorte': sousPoint.sorte,
        'data-sous-point-etat': sousPoint.etat ?? 'reflexion',
        'data-sous-point-echec': sousPoint.enEchec ? 'oui' : undefined,
        'data-sous-point-ouvert': ouvert ? 'oui' : 'non',
      }}
    >
      <button
        type="button"
        onClick={() => setChoisi(!ouvert)}
        aria-expanded={ouvert}
        data-sous-point-bascule={sousPoint.cle}
        className="flex w-full items-baseline gap-2 text-left"
      >
        <span className={cn('min-w-0 flex-1 text-[14.5px] leading-relaxed', sousPoint.enEchec ? 'text-danger' : 'text-text')}>
          {sousPoint.traduire ? t(sousPoint.libelle) : sousPoint.libelle}
        </span>
        {/* LE NOMBRE D'ACTIONS PUIS LA DURÉE : c'est ce couple qui montre où un
            tour a passé son temps, sans rien déplier. */}
        {aDesActions ? (
          <span className="shrink-0 text-[12.5px] text-faint" data-sous-point-actions={sousPoint.entrees.length}>
            {sousPoint.entrees.length}
          </span>
        ) : null}
        {sousPoint.dureeMs !== undefined ? (
          <span className="shrink-0 font-mono text-[12.5px] text-faint" data-sous-point-duree={sousPoint.dureeMs}>
            {dureeFine(sousPoint.dureeMs / 1000)}
          </span>
        ) : null}
        {aDesActions ? (
          <ChevronRight
            className={cn('h-3.5 w-3.5 shrink-0 self-center text-faint transition-transform', ouvert && 'rotate-90')}
            aria-hidden
          />
        ) : null}
      </button>

      {/* LES ACTIONS D'UN SOUS-POINT SONT SES PROPRES SOUS-POINTS, sur leur
          ligne à elles : « Réflexion » reste un point PARENT dépliable. */}
      {ouvert && aDesActions ? (
        <ol className="mt-1" data-sous-point-contenu={sousPoint.cle}>
          <RecitDuPassage entrees={sousPoint.entrees} projectId={projectId} />
        </ol>
      ) : null}
    </SousPointDuFlux>
  );
}

/**
 * QUAND UN GESTE A COMMENCÉ, ET COMBIEN DE TEMPS IL A PRIS : « 16:34 (1 min 32 s) ».
 *
 * LA MÊME ÉCRITURE QUE LES ÉTAPES D'UNE MISE EN LIGNE (`heureEtDuree`), pour
 * qu'une durée se lise pareil d'un bout à l'autre de l'application. Elle reste
 * au SECOND PLAN — 12,5 px, `--faint` — parce qu'on vient lire la phrase, pas
 * l'horloge ; les chiffres sont en `tabular-nums` pour que la colonne s'aligne
 * d'un geste à l'autre.
 *
 * SUR TÉLÉPHONE, ELLE PASSE SOUS LA PHRASE. À droite, sur une colonne de
 * 360 px, elle volait la moitié de la largeur du texte. Un SEUL nœud le fait :
 * c'est le conteneur qui passe de la colonne à la ligne au point de rupture
 * `sm:` (640 px, le seuil « téléphone » du projet) — rendre la mention deux
 * fois la donnerait deux fois aux contrôles et aux lecteurs d'écran.
 *
 * Rien quand la durée n'a pas été mesurée : l'heure seule, jamais « 0 s ».
 */
function MentionDeTemps({
  debutAt,
  dureeMs,
  marque,
  className,
}: {
  debutAt?: number;
  dureeMs?: number;
  /** Ce que le repère porte : la clé du bloc, ou l'étape pour un total. */
  marque?: string;
  className?: string;
}) {
  const quand = heureEtDuree(debutAt, dureeMs);
  if (!quand) return null;
  return (
    <span
      data-duree-bloc={marque}
      title={quand.infobulle}
      className={cn('mt-0.5 text-[12.5px] leading-snug text-faint tabular-nums sm:mt-0 sm:shrink-0', className)}
    >
      {quand.libelle}
    </span>
  );
}

/** Combien de lignes à tiret un bloc montre avant de proposer le reste. */
const LIGNES_DU_BLOC = 12;

/**
 * UN BLOC RACONTÉ : SON TITRE, ET RIEN D'AUTRE TANT QU'ON NE L'OUVRE PAS.
 *
 * Le bloc affichait sa phrase de détail EN PERMANENCE, fabriquée en une seule
 * ligne à rallonge : « a.ts, b.ts, c.ts, et 69 de plus ». Dans une colonne
 * étroite, ce pavé de virgules se cassait en une lettre par ligne, et le récit
 * d'un tour chargé devenait illisible avant même d'avoir été ouvert.
 *
 * Replié — et il l'est par défaut —, on ne lit que le titre (« 70 commandes
 * lancées ») et son chevron. Ouvert, chaque information tient sur SA ligne,
 * précédée d'un tiret, et une liste longue garde son « voir les N de plus ».
 * Le détail exact d'une action reste un cran plus loin, dans sa trace.
 *
 * Son trait suit `--faint` — il porte une information, il ne borde pas une
 * zone.
 */
function UnBlocRaconte({ bloc, projectId }: { bloc: BlocRaconte; projectId?: string }) {
  const technique = useModeTechnique();
  const [ouvert, setOuvert] = React.useState(false);
  const [toutesLesLignes, setToutesLesLignes] = React.useState(false);
  const [enFenetre, setEnFenetre] = React.useState(false);
  const [imagePerdue, setImagePerdue] = React.useState(false);
  const vignette = bloc.vignette && projectId && !imagePerdue ? bloc.vignette : null;
  /* LA CAPTURE EN GRAND S'OUVRE DANS LA GALERIE DE LA CARTE, feuilletable avec
     les autres images de la bande ; la fenêtre seule ne sert plus que si la
     bande ne connaît pas cette image. */
  const ouvrirDansLaGalerie = React.useContext(OuvrirUneCapture);
  const agrandir = () => {
    if (vignette && ouvrirDansLaGalerie?.(vignette)) return;
    setEnFenetre(true);
  };
  const titre = t(bloc.titre.motif, bloc.titre.valeurs);
  const phrase = React.useMemo(() => phraseDuBloc(bloc), [bloc]);
  const dite = phrase.dit === 'agent' ? phrase.texte : t(phrase.motif, phrase.valeurs);
  /* LA QUESTION DÉJÀ DESSINÉE SOUS LA PHRASE NE SE REDESSINE PAS DANS LE
     DÉTAIL : ouvrir le bloc montrerait sinon le même encadré deux fois. */
  const entrees = React.useMemo(
    () =>
      bloc.question
        ? bloc.entrees.filter((entree) => {
            const vue = vueDeLEntree(entree);
            return !(vue.sorte === 'question' && vue.question === bloc.question?.intitule);
          })
        : bloc.entrees,
    [bloc],
  );
  /* UN BLOC SANS AUCUNE ACTION N'A RIEN À DÉPLIER : pas de chevron, pas de
     phrase cliquable — le clic promettrait un vide. */
  const aDuDetail = entrees.length > 0;
  /* SÉLECTIONNER UN BOUT DE PHRASE NE LA DÉPLIE PAS. Le clic qui termine un
     surlignage arrive ici comme n'importe quel autre : on le laisse passer
     seulement quand rien n'est sélectionné dans ce bloc. */
  const auClicSurLaPhrase = (event: React.MouseEvent<HTMLElement>) => {
    const choix = typeof window !== 'undefined' ? window.getSelection() : null;
    if (choix && !choix.isCollapsed && choix.toString().trim() && event.currentTarget.contains(choix.anchorNode)) return;
    setOuvert((o) => !o);
  };
  const cachees = entrees.length - LIGNES_DU_BLOC;
  const lignes = toutesLesLignes ? entrees : entrees.slice(0, LIGNES_DU_BLOC);
  const source = vignette ? `/api/capture?project=${encodeURIComponent(projectId!)}&path=${encodeURIComponent(vignette)}` : null;

  /* CE QUE LA QUESTION A DEMANDÉ, PROPOSÉ, OBTENU — le seul contenu qui ne se
     replie jamais : une question posée est ce qu'on vient lire.

     C'EST LE MÊME ENCADRÉ QUE LA TRACE DÉPLIÉE (`EncadreQuestion`,
     `contenu-journal.tsx`) : un bandeau de tête, la question, ce qui
     l'éclairait, les réponses proposées en LISTE, celle qui a été retenue
     bordée et bleuie, puis le complément écrit à la main. Un second dessin
     écrit ici aurait dérivé du premier dès la retouche suivante — et c'est
     exactement ce qui était arrivé : les pastilles de ce bloc cherchaient le
     libellé « quelque part dans » la réponse, là où la trace le découpait par
     une règle pure. */
  const question = bloc.question ? (
    <div className="mt-1" data-bloc-question={bloc.cle}>
      <EncadreQuestion
        question={bloc.question.intitule}
        description={bloc.question.description}
        choix={bloc.question.choix}
        options={bloc.question.options.map((label, rang) => ({ id: `o${rang}`, label }))}
        reponse={bloc.question.reponse}
      />
    </div>
  ) : null;

  /* LE DÉTAIL EXACT : L'ENCADRÉ DE CHAQUE GESTE, DIRECTEMENT.

     Ouvrir la phrase montrait une sous-ligne par geste (« Lire le module de
     TVA »), qu'il fallait rouvrir pour voir l'encadré — un clic de plus, et
     une ligne qui redisait la phrase au-dessus ET le texte de l'encadré. Les
     encadrés s'empilent maintenant sous la phrase ; le temps pris, l'état et
     l'échec que portait la sous-ligne sont dans leur bandeau
     (`ContexteTeteDEtape`). Une longue série garde son « voir les N de
     plus ». Il ne se dessine que déplié — et il l'est sur GESTE, jamais
     d'office. */
  const detail = ouvert ? (
    <>
      <ol className="mt-1.5 space-y-1.5" data-bloc-raconte-texte data-bloc-raconte-detail={bloc.cle}>
        {lignes.map((entree) => (
          <li key={entree.id} className="min-w-0" data-trace={entree.id} data-trace-genre={genreDAction(entree)}>
            <ContenuDeLEntree entree={entree} projectId={projectId} dejaDit={technique ? undefined : dite} />
          </li>
        ))}
      </ol>
      {cachees > 0 ? (
        <button
          type="button"
          onClick={() => setToutesLesLignes((v) => !v)}
          aria-expanded={toutesLesLignes}
          data-bloc-raconte-lignes-repli={toutesLesLignes ? 'ouvert' : 'ferme'}
          className="mt-1 flex items-center gap-1 text-[12.5px] text-faint transition-colors hover:text-muted"
        >
          <ChevronRight className={cn('h-3 w-3 transition-transform', toutesLesLignes && 'rotate-90')} aria-hidden />
          {toutesLesLignes ? t('Replier') : t('voir les {v0} de plus', { v0: cachees })}
        </button>
      ) : null}
    </>
  ) : null;

  /* LA CAPTURE EN GRAND : une fenêtre, fermée au clic dehors et à Échap, qui
     ne peut plus déformer la mise en page du carton. */
  const fenetre =
    source && enFenetre ? (
      <Dialog open onOpenChange={(o) => !o && setEnFenetre(false)}>
        <DialogContentLibre adresse="capture" className="sm:w-[min(900px,100%)]" data-fenetre-capture={bloc.cle}>
          <DialogHeader className="pb-3">
            <DialogTitle className="min-w-0 truncate text-[14.5px]">{bloc.sujets[0] ?? dite}</DialogTitle>
          </DialogHeader>
          <ZoneDefilement
            fond="hsl(var(--raised))"
            classeEnveloppe="mx-4 mb-4 rounded-md border border-border bg-raised"
            data-fenetre-corps
            className="overflow-x-auto p-2"
          >
            <img src={source} alt={bloc.sujets[0] ?? dite} className="mx-auto max-w-full" />
          </ZoneDefilement>
        </DialogContentLibre>
      </Dialog>
    ) : null;

  /* ---------------- LA VUE TECHNIQUE : l'inventaire d'avant ---------------- */
  if (technique) {
    return (
      <div
        className={cn('rounded-xl border bg-raised/40 px-3 py-2', bloc.enEchec ? 'border-danger/40' : 'border-transparent')}
        data-bloc-raconte={bloc.cle}
        data-bloc-raconte-genre={bloc.genre}
        data-bloc-raconte-vue="technique"
        data-bloc-raconte-echec={bloc.enEchec ? 'oui' : undefined}
      >
        <div className={cn('flex gap-3', ouvert || bloc.question ? 'items-start' : 'items-center')}>
          <div className="min-w-0 flex-1">
            <div className="flex flex-col sm:flex-row sm:items-baseline sm:gap-2">
              <p
                className={cn(
                  'flex min-w-0 flex-1 items-center gap-1.5 text-[12.5px] font-medium uppercase tracking-wide',
                  bloc.enEchec ? 'text-danger' : 'text-faint',
                )}
                data-bloc-raconte-titre
                title={bloc.sujets.slice(0, 8).join(' · ') || undefined}
              >
                {bloc.enEchec ? <CircleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden /> : null}
                {titre}
              </p>
              <MentionDeTemps debutAt={bloc.debutAt} dureeMs={bloc.dureeMs} marque={bloc.cle} />
            </div>
            {question}
          </div>
          <button
            type="button"
            onClick={() => setOuvert((o) => !o)}
            aria-expanded={ouvert}
            aria-label={ouvert ? t('Masquer le détail') : t('Voir le détail')}
            title={ouvert ? t('Masquer le détail') : t('Voir le détail')}
            data-bloc-raconte-bascule={bloc.cle}
            className="-my-2 -mr-2 shrink-0 rounded p-2 text-faint transition-colors hover:text-muted"
          >
            <ChevronRight className={cn('h-4 w-4 transition-transform', ouvert && 'rotate-90')} aria-hidden />
          </button>
          {source ? (
            <button
              type="button"
              data-bloc-raconte-vignette={bloc.cle}
              onClick={agrandir}
              title={t('Voir la capture en grand')}
              className="shrink-0 overflow-hidden rounded border border-transparent bg-raised p-0.5"
            >
              <img
                src={source}
                alt={titre}
                loading="lazy"
                onError={() => setImagePerdue(true)}
                className="h-16 w-16 rounded object-cover object-left-top"
              />
            </button>
          ) : null}
        </div>
        {detail}
        {fenetre}
      </div>
    );
  }

  /* ---------------- LE RÉCIT : une phrase, et rien d'autre ---------------- */
  return (
    <div
      className="min-w-0"
      data-bloc-raconte={bloc.cle}
      data-bloc-raconte-genre={bloc.genre}
      data-bloc-raconte-vue="recit"
      data-bloc-raconte-echec={bloc.enEchec ? 'oui' : undefined}
    >
      {/* LA PHRASE EST ELLE-MÊME LE BOUTON. Une ligne de plus — « voir les
          commandes exécutées (15) » — se posait sous chaque phrase pour ouvrir
          le détail : le fil comptait donc DEUX lignes par geste, dont une qui
          ne racontait rien. Le clic se fait maintenant sur la phrase, et un
          chevron à droite dit si le détail est ouvert.

          ELLE N'EST PAS ENFERMÉE DANS UN `button` : le texte d'un récit se
          sélectionne à la souris, ce qu'un bouton interdit. Le conteneur porte
          donc le rôle et l'`aria-expanded`, et le chevron garde un vrai bouton
          pour le clavier. Un clic qui SUIT une sélection ne bascule rien —
          sinon on ne pourrait plus surligner une phrase sans la déplier. */}
      <div
        role={aDuDetail ? 'button' : undefined}
        aria-expanded={aDuDetail ? ouvert : undefined}
        data-bloc-raconte-bascule={aDuDetail ? bloc.cle : undefined}
        onClick={aDuDetail ? auClicSurLaPhrase : undefined}
        className={cn('flex items-start gap-1.5', aDuDetail && 'cursor-pointer')}
      >
        {/* LA PHRASE ET SON TEMPS : côte à côte sur grand écran, l'un sous
            l'autre sur téléphone. Le chevron reste dehors, donc toujours à
            droite de la phrase, dans les deux mises en page. */}
        <div className="flex min-w-0 flex-1 flex-col sm:flex-row sm:items-start sm:gap-2">
          <p
            className={cn(
              'flex min-w-0 flex-1 items-start gap-1.5 break-words text-[14.5px] leading-relaxed texte-copiable',
              bloc.enEchec ? 'text-danger' : 'text-text',
            )}
            data-bloc-raconte-phrase={phrase.dit}
          >
            {bloc.enEchec ? <CircleAlert className="mt-1 h-3.5 w-3.5 shrink-0" aria-hidden /> : null}
            <span className="min-w-0">{dite}</span>
          </p>
          <MentionDeTemps debutAt={bloc.debutAt} dureeMs={bloc.dureeMs} marque={bloc.cle} className="sm:mt-[3px]" />
        </div>
        {aDuDetail ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              setOuvert((o) => !o);
            }}
            aria-expanded={ouvert}
            aria-label={ouvert ? t('Masquer le détail') : t('Voir le détail')}
            title={ouvert ? t('Masquer le détail') : t('Voir le détail')}
            data-bloc-raconte-chevron={bloc.cle}
            className="-my-1 shrink-0 rounded p-1 text-faint transition-colors hover:text-muted"
          >
            <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', ouvert && 'rotate-180')} aria-hidden />
          </button>
        ) : null}
      </div>

      {question}

      {/* CE QUE L'AGENT A REGARDÉ SE POSE SOUS SA PHRASE, comme une pièce
          jointe dans une conversation — plus une pastille collée au titre. Sa
          taille reste BORNÉE : une capture en pleine largeur écraserait le
          fil, et le clic l'ouvre en grand de toute façon. */}
      {source ? (
        <button
          type="button"
          data-bloc-raconte-vignette={bloc.cle}
          onClick={agrandir}
          title={t('Voir la capture en grand')}
          className="mt-1 block overflow-hidden rounded-md border border-transparent bg-raised p-0.5"
        >
          <img
            src={source}
            alt={dite}
            loading="lazy"
            onError={() => setImagePerdue(true)}
            className="max-h-40 max-w-[min(320px,100%)] rounded object-contain object-left-top"
          />
        </button>
      ) : null}

      {detail}
      {fenetre}
    </div>
  );
}

