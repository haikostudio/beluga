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
} from 'lucide-react';
import { PointDuFil, type TonDuPoint } from '@/components/point-du-fil';
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
  avancementDuLancement,
  blocDeFinAViser,
  decouperAvantLePlan,
  reflexionRepliee,
  retirerLaStructureDeCadrage,
  genreDAction,
  nomDeLaLigne,
  poidsLisible,
  SousPointDuTravail,
  phraseDuBloc,
  rangerLaComprehension,
  recitDuPoint,
  tempsDuPassage,
  resumeDeLEntree,
  travailEnSousPoints,
  VersionDuPassage,
  versionDuPassageDePlan,
  versionEnPreparation,
  vueDeLEntree,
} from '@beluga/shared';
import { Button, Dialog, DialogContentLibre, DialogHeader, DialogTitle, ZoneDefilement } from '@/components/ui';
import { ContenuDeLEntree, EncadreQuestion } from '@/components/contenu-journal';
import { BlocDuPlan } from '@/components/parcours-carte';
import { PlanRapport } from '@/components/plan-rapport';
import { RapportEnFlux } from '@/components/rapport-flux';
import { SilhouetteParcours } from '@/components/silhouettes';
import { EnTeteDePanneau, Panneau } from '@/components/panneau';
import { Markdown } from '@/lib/markdown';
import { client } from '@/lib/client';
import { ouvrirLesDecisions } from '@/lib/ouvrir-decisions';
import { copierLaDemande } from '@/lib/copie-riche';
import { useApp } from '@/lib/use-app';
import { useTelephone } from '@/lib/telephone';
import { MESURES_DU_FLUX, TON_DE_L_ETAT, type MesuresDuFlux } from '@/components/mesures-du-flux';
import { cn, dateHeure, dureeFine, heureEtDuree } from '@/lib/utils';
import { t } from '@/lib/langue';
import { dernierVoletOuvert, retenirLeVolet } from '@/lib/volet-comprehension';

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

/** Le retrait d'une ligne sans rond posée parmi des sous-points : alignée sur leur texte. */
function useRetraitDuTexte() {
  const mesures = useMesures();
  return React.useContext(NiveauDuSousPoint) === 0 ? mesures.texteDuSousPoint : 'pl-7';
}

function SousPointDuFlux({
  ton = 'neutre',
  attrs,
  children,
}: {
  /** Gris par défaut ; la couleur ne revient que pour une erreur ou un travail en cours. */
  ton?: TonDuPoint;
  attrs?: Record<string, string | number | undefined>;
  children: React.ReactNode;
}) {
  const mesures = useMesures();
  const niveau = React.useContext(NiveauDuSousPoint);
  const surLAxe = niveau === 0;
  return (
    <li
      className={cn('group relative', surLAxe ? mesures.texteDuSousPoint : 'pl-7')}
      data-sous-point-niveau={niveau}
      {...attrs}
    >
      {surLAxe ? null : (
        <span
          className="absolute -bottom-[14px] left-[10px] top-[14px] w-px bg-faint/40 [li:last-child>&]:hidden"
          aria-hidden
          data-sous-point-trait
        />
      )}
      {/* L'EMPLACEMENT DE L'ANCIEN ROND RESTE, TRANSPARENT : 24 px sur l'axe
          (20 px en imbriqué), et le point gris de 5 px se centre dedans. Le
          texte et le trait ne bougent donc pas d'un pixel. */}
      <span
        className={cn(
          'absolute flex items-center justify-center',
          surLAxe ? cn('top-0 h-6 w-6', mesures.rondDuSousPoint) : 'left-0 top-1 h-5 w-5',
        )}
        aria-hidden
        data-sous-point-rond
      >
        <PointDuFil ton={ton} />
      </span>
      <div className="min-w-0 pb-2">
        <NiveauDuSousPoint.Provider value={niveau + 1}>{children}</NiveauDuSousPoint.Provider>
      </div>
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* Le flux                                                              */
/* ------------------------------------------------------------------ */

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
  pickedEvolutions,
  onToggleEvolution,
  onToggleAll,
  onEcrireDansLeChamp,
  configuration,
  deploiement,
  journalCharge = true,
}: {
  carte: Card;
  /**
   * OÙ EN EST LA MISE EN LIGNE DE LA CARTE (`etatDuDeploiement`). Dès qu'elle
   * est dans « À déployer » ou rangée, un dernier point le dit en bas du flux —
   * sauf sur une carte mère, qui ne se déploie pas elle-même (DEC-258).
   */
  deploiement?: { etat: EtatDuDeploiement; deployeeA?: number };
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
  pickedEvolutions?: string[];
  onToggleEvolution?: (text: string) => void;
  onToggleAll?: (items: string[]) => void;
  /** « Refuser », sur le bandeau d'un plan, écrit dans la barre d'écriture. */
  onEcrireDansLeChamp?: (texte: string) => void;
  /**
   * CE QUI SE LIT DANS LE POINT « CONFIGURATION » : le bloc des réglages de
   * l'agent (`ReglagesAgent`, `chat.tsx`). Il vivait en bande fixe au-dessus
   * de la barre d'étapes ; il est devenu le PREMIER point du parcours.
   */
  configuration?: React.ReactNode;
}) {
  const telephone = useTelephone();
  const mesures = telephone ? MESURES_DU_FLUX.telephone : MESURES_DU_FLUX.ordinateur;
  /*
   * L'OUVERTURE EST UN CHOIX DE LECTURE, ET ELLE JOUE EN ACCORDÉON : un seul
   * passage ouvert par ÉTAPE. Ouvrir le deuxième plan referme le premier ;
   * rouvrir le premier referme le deuxième. C'est ce qui garde le flux lisible
   * une fois qu'une carte a beaucoup itéré. Entre étapes, rien ne se ferme :
   * on peut lire le plan et la compréhension ensemble.
   *
   * Les passages ouverts d'office le restent tant qu'on ne les referme pas, et
   * un passage fermé à la main ne se rouvre pas tout seul au tour suivant. Un
   * passage qui DEVIENT ouvert d'office (le plan qui arrive) s'ouvre, lui.
   */
  const [choisis, setChoisis] = React.useState<Record<string, boolean>>({});
  const dOffice = React.useRef<Set<string>>(new Set());
  React.useEffect(() => {
    const neufs = ouvertsDOffice.filter((ancre) => !dOffice.current.has(ancre));
    dOffice.current = new Set(ouvertsDOffice);
    if (!neufs.length) return;
    /* Un passage neuf ouvert d'office RÉTRACTE celui de son étape. */
    const parEtape = new Map<EtapeDuParcours, string>();
    for (const element of flux) if (element.sorte === 'point') parEtape.set(element.point.etape, element.point.ancre);
    setChoisis((avant) => {
      const suite = { ...avant };
      for (const ancre of neufs) {
        const point = flux.find((e) => e.sorte === 'point' && e.point.ancre === ancre);
        if (point?.sorte === 'point') {
          for (const autre of flux) {
            if (autre.sorte === 'point' && autre.point.etape === point.point.etape && autre.point.ancre !== ancre) {
              suite[autre.point.ancre] = false;
            }
          }
        }
        suite[ancre] = true;
      }
      return suite;
    });
  }, [ouvertsDOffice.join('|')]);
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

  const estOuvert = (point: PointDuParcours) => choisis[point.ancre] ?? ouvertsDOffice.includes(point.ancre);
  const basculer = (point: PointDuParcours) => {
    const ouvrir = !estOuvert(point);
    setChoisis((avant) => {
      const suite = { ...avant };
      if (ouvrir) {
        for (const autre of flux) {
          if (autre.sorte === 'point' && autre.point.etape === point.etape && autre.point.ancre !== point.ancre) {
            suite[autre.point.ancre] = false;
          }
        }
      }
      suite[point.ancre] = ouvrir;
      return suite;
    });
  };

  /* LA BARRE D'ÉTAPES EST UN RACCOURCI : toucher un segment ouvre le DERNIER
     passage de son étape et fait défiler jusqu'à lui. */
  const racine = React.useRef<HTMLOListElement>(null);
  React.useEffect(() => {
    if (!ouverture) return;
    setChoisis((avant) => {
      const suite = { ...avant };
      for (const autre of flux) {
        if (autre.sorte === 'point' && autre.point.etape === ouverture.etape) {
          suite[autre.point.ancre] = autre.point.ancre === ouverture.ancre;
        }
      }
      return suite;
    });
    /* ON DÉFILE APRÈS QUE L'ACCORDÉON A JOUÉ, pas pendant : refermer le passage
       précédent de la même étape raccourcit ce qui est au-dessus, et la cible
       serait sortie par le haut si on visait avant que la page se recale. */
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
  React.useEffect(() => {
    blocsVises.current = new Set();
  }, [carte.id]);
  React.useEffect(() => {
    if (!journalCharge || !aViser || blocsVises.current.has(aViser.cle)) return;
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

  /* TANT QUE LE JOURNAL N'EST PAS LÀ, LE FLUX MONTRE SA FORME, PAS UN ÉTAT.
     Il est demandé après le premier rendu : calculer sur un journal vide
     faisait tourner « Demande » et « Travail » en même temps. */
  if (!journalCharge) return <SilhouetteParcours />;

  return (
    <MesuresContexte.Provider value={mesures}>
      <div className="px-3 py-3" data-flux-points={carte.id}>
        {/* LA LIGNE VERTICALE EST POSÉE UNE FOIS, SUR LE FLUX ENTIER : elle
            court du premier rond au dernier, et les ronds opaques la percent. */}
        <ol ref={racine} className="relative" data-flux-liste={flux.length}>
          <span className={cn('absolute bottom-6 top-6 w-px bg-faint/40', mesures.ligne)} aria-hidden />
          {flux.map((element) =>
            element.sorte === 'point' ? (
              <PointDuFlux
                key={element.cle}
                point={element.point}
                versionDuPlan={versionDuPassageDePlan(element.point, passages, versionsConnues)}
                passages={passages}
                carte={carte}
                projectId={projectId}
                configuration={configuration}
                attente={element.point.ancre === ancreDeLAttente ? attente : null}
                lancement={lancement}
                ouvert={estOuvert(element.point)}
                onBasculer={() => basculer(element.point)}
                technique={!!techniques[element.point.etape]}
                onBasculerTechnique={() => basculerTechnique(element.point.etape)}
                pickedEvolutions={pickedEvolutions}
                onToggleEvolution={onToggleEvolution}
                onToggleAll={onToggleAll}
                onEcrireDansLeChamp={onEcrireDansLeChamp}
              />
            ) : (
              <PointDeQuestion key={element.cle} etape={element.etape} entree={element.entree} />
            ),
          )}
          {deploiement && deploiement.etat !== 'aucun' && !carte.suiviDesFilles?.length ? (
            <PointDeDeploiement etat={deploiement.etat} deployeeA={deploiement.deployeeA} />
          ) : null}
        </ol>
      </div>
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
function PointDeDeploiement({ etat, deployeeA }: { etat: Exclude<EtatDuDeploiement, 'aucun'>; deployeeA?: number }) {
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
  return (
    <li
      id={ANCRE_DU_DEPLOIEMENT}
      data-point="deploiement"
      data-point-ancre={ANCRE_DU_DEPLOIEMENT}
      data-point-etat={etatDuPoint}
      data-point-deploiement={etat}
      className={cn('relative py-3', mesures.decalage)}
    >
      <span
        className={cn(
          'fond-de-zone absolute left-0 top-3 flex items-center justify-center rounded-full border-2 transition-colors',
          mesures.rond,
          ton.rond,
        )}
        aria-hidden
        data-point-rond
      >
        {etat === 'en_cours' ? (
          <Loader2 className={cn('animate-spin', mesures.icone, ton.icone)} />
        ) : (
          <Rocket className={cn(mesures.icone, ton.icone)} />
        )}
        {etatDuPoint === 'fait' ? (
          <span className="fond-de-zone absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full">
            <Check className="h-3 w-3 text-termine" />
          </span>
        ) : null}
      </span>
      <span className="block min-w-0">
        <span className={cn('block text-[14.5px] font-semibold', ton.titre)}>{t('Déploiement')}</span>
        <span className="block text-[14.5px] leading-relaxed text-muted" data-point-phrase>
          {phrase}
        </span>
      </span>
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
  lancement,
  pickedEvolutions,
  onToggleEvolution,
  onToggleAll,
  onEcrireDansLeChamp,
  passages,
}: {
  point: PointDuParcours;
  carte: Card;
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
  /** L'étape de préparation diffusée, pour la barre du point « Préparation ». */
  lancement?: EtapeDeLancement;
  onBasculer: () => void;
  pickedEvolutions?: string[];
  onToggleEvolution?: (text: string) => void;
  onToggleAll?: (items: string[]) => void;
  onEcrireDansLeChamp?: (texte: string) => void;
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
  const aDuContenu =
    !!reglages ||
    !!preparation ||
    point.moments.length > 0 ||
    point.traces.length > 0 ||
    !!point.reponse ||
    point.questions.length > 0 ||
    point.memoire.length > 0 ||
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
  const cartonDe = (part: PartDuCarton, marque: string) => (
    <SousPointDuFlux
      attrs={{ 'data-sous-point-flux': marque }}
    >
      <MomentsDuPoint
        point={point}
        carte={carte}
        part={part}
        projectId={projectId}
        pickedEvolutions={pickedEvolutions}
        onToggleEvolution={onToggleEvolution}
        onToggleAll={onToggleAll}
        onEcrireDansLeChamp={onEcrireDansLeChamp}
        versionDuPlan={versionDuPlan}
        passages={passages}
      />
    </SousPointDuFlux>
  );
  const entete = aUneEnteteDePlan ? cartonDe('entete', 'demande-du-plan') : null;
  /* UN PASSAGE « PLAN » QUI ATTEND SA VERSION N'A PAS DE CADRE : il garde sa
     demande en tête et son récit, et la SILHOUETTE de la version qui arrive. */
  const sansCadre = planEnDeux && versionDuPlan === null;
  const carton =
    point.moments.length && !sansCadre ? (
      cartonDe('cadre', 'rendu')
    ) : preparation ? (
      <SousPointDuFlux
        attrs={{ 'data-sous-point-flux': 'plan-en-preparation' }}
      >
        <SilhouetteDuPlan version={preparation} />
      </SousPointDuFlux>
    ) : null;

  return (
    <li
      id={point.ancre}
      data-point={point.etape}
      data-point-ancre={point.ancre}
      data-point-rang={point.rang}
      data-point-total={point.total}
      data-point-etat={point.etat}
      data-point-ouvert={ouvert ? 'oui' : 'non'}
      className={cn('relative py-3', mesures.decalage)}
    >
      {/* LE GRAND ROND : l'icône lisible, le fond de la zone pour percer la ligne. */}
      <span
        className={cn(
          'fond-de-zone absolute left-0 top-3 flex items-center justify-center rounded-full border-2 transition-colors',
          mesures.rond,
          ton.rond,
        )}
        aria-hidden
        data-point-rond
      >
        {point.etat === 'encours' ? (
          <Loader2 className={cn('animate-spin', mesures.icone, ton.icone)} />
        ) : (
          <Icone className={cn(mesures.icone, ton.icone)} />
        )}
        {point.etat === 'fait' ? (
          <span className="fond-de-zone absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full">
            <Check className="h-3 w-3 text-termine" />
          </span>
        ) : null}
      </span>

      <button
        type="button"
        onClick={onBasculer}
        aria-expanded={ouvert}
        aria-disabled={!aDuContenu}
        data-point-bascule={point.etape}
        className="flex w-full items-start gap-2 text-left"
      >
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className={cn('text-[14.5px] font-semibold', ton.titre)}>{t(LIBELLES_ETAPE[point.etape])}</span>
            {/* CE QUI N'EST PAS ENCORE ARRIVÉ LE DIT. Le gris et l'absence de
                coche portaient seuls l'information : au lancement, « Travail »
                et « Rapport » se lisaient comme des étapes déjà passées. */}
            {point.etat === 'avenir' ? (
              <span
                className="shrink-0 rounded-lg bg-raised px-1.5 text-[12.5px] text-faint"
                data-point-avenir={point.sautee ? 'sautee' : ''}
              >
                {/* PASSÉE SANS RIEN LAISSER n'est pas « à venir » : on le dit. */}
                {point.sautee ? t('sautée') : t('à venir')}
              </span>
            ) : null}
            {point.at ? <span className="shrink-0 text-[12.5px] text-faint">{dateHeure(point.at)}</span> : null}
            {/* LE TEMPS TOTAL DE L'ÉTAPE, tout à droite de son titre : la
                colonne se lit alors de haut en bas comme une chronologie, sans
                ouvrir un seul passage. */}
            {temps?.dureeMs !== undefined ? (
              <>
                <span className="flex-1" />
                <span
                  className="shrink-0 pr-6 text-[12.5px] text-faint tabular-nums"
                  data-duree-totale-etape={point.etape}
                  title={t('Temps de travail de cette étape')}
                >
                  {dureeFine(temps.dureeMs / 1000)}
                </span>
              </>
            ) : null}
          </span>
          {/* UN RÉSUMÉ ÉCRIT PAR L'AGENT REMPLACE LA PHRASE FIXE ; il se lit sous
              le bouton, où il se sélectionne. Seule la consigne d'un plan qui
              attend sa décision reste ici, en plus du résumé. */}
          {!point.resume || point.phrase === PHRASE_PLAN_A_DECIDER ? (
            <span className="block text-[14.5px] leading-relaxed text-muted" data-point-phrase>
              {t(point.phrase)}
            </span>
          ) : null}
          {/* LA BARRE DE LA PRÉPARATION, LA MÊME QUE SUR LA CARTE EN COLONNE.
              Entre le clic et le premier mot du moteur, un rond qui tourne ne
              dit pas où on en est : l'avancement vient de l'étape franchie
              (`avancementDuLancement`), jamais d'une animation dans le vide.
              Sans signal reçu — page ouverte en cours de route — la barre
              part au minimum de son parcours : une barre à zéro se lirait
              comme un geste tombé à côté. */}
          {point.etape === 'preparation' && point.etat === 'encours' ? (
            <span
              className="mt-1.5 block h-1 w-full overflow-hidden rounded-full bg-faint/30"
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
          {/* LA PHRASE DE LA CARTE, LA MÊME QUE SUR SA VIGNETTE. Elle ne se
              lisait que sur le tableau : on ouvrait la carte, et le tiroir
              racontait l'autre moitié de l'histoire — l'erreur du tour — sans
              jamais dire ce qui avait été sauvé. Les trois tons sont ceux de la
              vignette : un travail acquis en bleu, une attente en jaune, un
              constat en gris. */}
          {point.mention ? (
            <span
              data-mention-point={point.mention.nature}
              className={cn(
                'mt-1.5 flex items-start gap-1.5 rounded border px-1.5 py-1 text-[12.5px] leading-snug',
                point.mention.nature === 'travail'
                  ? 'border-termine/30 bg-termine/10 text-termine'
                  : point.mention.nature === 'information'
                    ? 'border-border bg-surface text-faint'
                    : 'border-warning/30 bg-warning/10 text-warning',
              )}
            >
              {point.mention.nature === 'travail' ? (
                <Check className="mt-[2px] h-3 w-3 shrink-0" aria-hidden />
              ) : point.mention.nature === 'information' ? (
                <Info className="mt-[2px] h-3 w-3 shrink-0" aria-hidden />
              ) : (
                <AlertTriangle className="mt-[2px] h-3 w-3 shrink-0" aria-hidden />
              )}
              <span className="min-w-0">{point.mention.texte}</span>
            </span>
          ) : null}
          {/* L'ATTENTE, EN TOUTES LETTRES. Un rond qui tourne ne dit pas si
              l'agent prépare son tour ou si la demande dort en file faute de
              quota — et les deux se ressemblaient exactement à l'écran. */}
          {attente ? (
            <span
              className="mt-0.5 flex items-center gap-1.5 text-[12.5px] leading-snug text-faint"
              data-point-attente={attente.sorte}
            >
              <Loader2 className="h-3 w-3 shrink-0 animate-spin" aria-hidden />
              <span className="min-w-0">
                {t(PHRASES_DE_L_ATTENTE[attente.sorte])}
                {attente.position && attente.position > 1
                  ? ` ${t('({v0}e en file)', { v0: attente.position })}`
                  : ''}
              </span>
            </span>
          ) : null}
        </span>
        {aDuContenu ? (
          <ChevronRight
            className={cn('mt-1.5 h-4 w-4 shrink-0 text-faint transition-transform', ouvert && 'rotate-90')}
            aria-hidden
          />
        ) : null}
      </button>

      {/* LE RÉSUMÉ DU POINT, HORS DU BOUTON : un texte posé dans un bouton ne se
          sélectionne pas à la souris. Il s'écrit dans la langue de
          l'utilisateur, donc il ne passe pas au dictionnaire. */}
      {point.resume ? (
        <p
          className="mt-0.5 whitespace-pre-line break-words pr-6 text-[14.5px] leading-relaxed text-muted select-text"
          data-point-resume={point.etape}
        >
          {point.resume}
        </p>
      ) : null}

      {/* LES FILLES D'UNE CARTE MÈRE, HORS DU BOUTON : chaque ligne porte son
          propre lien, et un bouton ne se pose pas dans un bouton. */}
      {point.filles?.length ? <FillesDuPoint point={point} /> : null}

      {/* LE BOUTON TECHNIQUE, EN HAUT À DROITE DE L'ÉTAPE. Il ne peut pas
          vivre DANS la ligne d'entête : celle-ci est déjà un bouton, et un
          bouton dans un bouton n'est pas cliquable. Il se pose donc par-dessus,
          au même niveau que le titre, et ne paraît que sur un point OUVERT —
          sinon il inviterait à un geste qui ne montre rien. */}
      {ouvert && aDuContenu ? (
        <button
          type="button"
          onClick={onBasculerTechnique}
          aria-pressed={technique}
          data-point-technique={point.etape}
          data-point-technique-etat={technique ? 'oui' : 'non'}
          title={technique ? t('Revenir au récit') : t('Voir le détail technique')}
          aria-label={technique ? t('Revenir au récit') : t('Voir le détail technique')}
          className={cn(
            'absolute right-0 top-3 z-10 rounded p-1.5 transition-colors',
            technique ? 'bg-raised text-muted' : 'text-faint hover:text-muted',
          )}
        >
          <Terminal className="h-3.5 w-3.5" aria-hidden />
        </button>
      ) : null}

      {ouvert && aDuContenu ? (
        /*
         * L'ORDRE D'UN PASSAGE OUVERT : L'ERREUR, PUIS LE TRAVAIL, PUIS LE
         * RÉSULTAT. Le carton produit par l'agent — la compréhension, le plan,
         * le compte rendu — se lisait AVANT la mémoire et les traces : chaque
         * trace qui s'ajoutait en cours de tour le repoussait vers le bas, et
         * on ne le voyait jamais arriver. Il se pose donc SOUS le travail qui
         * l'a produit, en bas du passage. Les erreurs, elles, restent en tête.
         */
        /* TOUT CE QUE PORTE UN PASSAGE EST UN SOUS-POINT, sur une seule ligne
           verticale : les réglages, les erreurs, le dépôt, la mémoire, le
           récit et le carton rendu. Plus aucun encadré posé à côté du fil.
           Les questions, elles, ont leur propre point (`PointDeQuestion`) :
           un récapitulatif en tête de passage les redisait mot pour mot. */
        <ol className={cn('mt-2', mesures.retraitDuContenu)} data-point-contenu={point.etape}>
          {/* TOUT CE QUE CE POINT PORTE SUIT SA VUE : le récit par défaut, les
              cartons techniques d'origine quand on l'a demandé. */}
          {reglages ? (
            <SousPointDuFlux
              attrs={{ 'data-sous-point-flux': 'reglages' }}
            >
              {reglages}
            </SousPointDuFlux>
          ) : null}
          {point.erreurs.map((erreur) => (
            <ErreurDansLePoint key={erreur.cle} erreur={erreur} carte={carte} />
          ))}
          {/* LE RÉCAPITULATIF DU DÉPÔT NE SE RÉPÈTE PAS D'UNE ITÉRATION À
              L'AUTRE : depuis qu'une nouvelle demande ouvre son propre point
              « Travail », il ne se lit que sur un passage qui a VRAIMENT
              travaillé — ou sur le seul qui existe. */}
          {point.etape === 'travail' && (point.traces.length > 0 || point.total === 1) ? (
            <DepotDuTravail carte={carte} traces={point.traces} />
          ) : null}
          <MemoireDuPoint lignes={point.memoire} etape={point.etape} />
          {/* L'ORDRE EST LE MÊME PARTOUT, PLAN COMPRIS : ce qui a demandé,
              puis le récit du travail, puis ce que ce travail a rendu. Le
              cadre du plan était la seule exception — il se lisait avant le
              récit — et cassait la lecture chronologique du fil. */}
          {entete}
          {recit}
          {carton}
          {/* LA RÉPONSE D'UN TOUR-QUESTION, dans le cadre contrasté du plan :
              elle ne se cache plus parmi les actions du récit. */}
          {point.reponse ? (
            <SousPointDuFlux
              attrs={{ 'data-sous-point-flux': 'reponse' }}
            >
              <MomentDeReponse entree={point.reponse} />
            </SousPointDuFlux>
          ) : null}
        </ol>
      ) : null}
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

type PartDuCarton = 'entete' | 'cadre';

/**
 * LA SILHOUETTE D'UNE VERSION DE PLAN QUI SE PRÉPARE (`versionEnPreparation`).
 * Une zone qui n'a pas encore ses données montre sa forme, jamais un vide : le
 * vrai cadre la remplace à l'instant où le plan est rendu.
 */
function SilhouetteDuPlan({ version }: { version: number }) {
  return (
    <div
      className="rounded-lg border-2 border-border bg-fond-plan px-3 py-3"
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

function MomentsDuPoint({
  point,
  carte,
  part,
  projectId,
  pickedEvolutions,
  onToggleEvolution,
  onToggleAll,
  onEcrireDansLeChamp,
  versionDuPlan,
  passages,
}: {
  point: PointDuParcours;
  carte: Card;
  passages: readonly PointDuParcours[];
  /** Quelle moitié dessiner. Hors du passage « Plan », seul `cadre` porte quelque chose. */
  part: PartDuCarton;
  projectId?: string;
  pickedEvolutions?: string[];
  onToggleEvolution?: (text: string) => void;
  onToggleAll?: (items: string[]) => void;
  onEcrireDansLeChamp?: (texte: string) => void;
  /** La version que ce passage montre ; `null` : aucune, elle s'écrit encore. */
  versionDuPlan: VersionDuPassage;
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
    const moment = point.moments.find((m) => m.sorte === 'plan');
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
      if (versionDuPlan === null) return null;
      return (
        <>
          <BlocDuPlan
            nu
            plans={plans}
            version={versionDuPlan === 'courante' ? undefined : versionDuPlan}
            /* L'AGENT DU PLAN EST CELUI QUI L'A ÉCRIT : c'est à lui que
               « Valider » parle, pas à celui qui travaille aujourd'hui. */
            agentId={moment?.entree.agentId ?? carte.agentId}
            /* « VALIDER » ÉCRIT SUR LA CARTE, et la carte dit ce qui est validé. */
            cardId={carte.id}
            planValide={carte.parcours?.planValide ?? null}
            /* ET LE PLAN D'UNE CARTE DÉJÀ LANCÉE NE SE DÉCIDE PLUS : la carte
               le dit elle-même (colonne, agent qui la tient, code enregistré). */
            etatCarte={{
              colonne: carte.column,
              agentDeLaCarte: carte.agentId,
              codeDejaEnregistre: carte.codeDejaEnregistre,
              /* …sauf le plan d'une RELANCE après rapport (`planDeLaRelance`). */
              cadrageRouvertA: carte.parcours?.cadrageRouvertA,
            }}
            ancre={point.ancre}
            /* LE LOADER NE VISE QUE LE TOUR QUI ÉCRIT CE PLAN (`planEnCoursDEcriture`). */
            passage={point}
            passages={passages}
            pickedEvolutions={pickedEvolutions ?? []}
            onToggleEvolution={onToggleEvolution ?? (() => undefined)}
            onToggleAll={onToggleAll ?? (() => undefined)}
            /* SUR TÉLÉPHONE, LE PLAN S'OUVRE EN VOLET : il s'y LIT, il ne s'y
               décide plus — la validation est unique, sous le champ. */
            carte={carte}
          />
        </>
      );
    }
  }
  if (part === 'entete') return null;
  return (
    <>
      {point.moments.map((moment) => (
        <Moment
          key={moment.entree.id}
          moment={moment}
          projectId={projectId}
          pickedEvolutions={pickedEvolutions}
          onToggleEvolution={onToggleEvolution}
          onToggleAll={onToggleAll}
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
  pickedEvolutions,
  onToggleEvolution,
  onToggleAll,
}: {
  moment: MomentDuPoint;
  projectId?: string;
  pickedEvolutions?: string[];
  onToggleEvolution?: (text: string) => void;
  onToggleAll?: (items: string[]) => void;
}) {
  const { entree } = moment;
  switch (moment.sorte) {
    case 'demande':
      return (
        <div className="rounded-lg border border-accent/30 bg-raised/40 px-3 py-2" data-moment={moment.sorte}>
          {/* L'ENTÊTE PORTE SON BOUTON DE COPIE, À DROITE. Le libellé et la
              date gardent leur ligne ; le bouton se pose au bout, à hauteur du
              texte, et emporte la demande AVEC ses images. */}
          <div className="mb-1 flex items-start gap-2">
            <p className="min-w-0 flex-1 text-[12.5px] font-medium uppercase tracking-wide text-faint">
              {moment.premiere ? t('Votre demande') : t('Précision')}
              <span className="ml-2 normal-case tracking-normal">{dateHeure(entree.at)}</span>
            </p>
            <BoutonCopierLaDemande entree={entree} projectId={projectId} />
          </div>
          <ContenuDeLEntree entree={entree} projectId={projectId} />
        </div>
      );
    case 'comprehension':
      return <MomentDeComprehension entree={entree} numero={moment.numero} derniere={moment.derniere} />;
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
          <PlanRapport contenu={texte} courant={false} pickedEvolutions={pickedEvolutions ?? []} onToggleEvolution={onToggleEvolution} onToggleAll={onToggleAll} />
        </div>
      );
    }
    case 'rapport':
      return (
        <MomentDeRapport
          entree={entree}
          dernier={moment.dernier}
          pickedEvolutions={pickedEvolutions}
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
 * mémoire ouverts. La dernière version se lit d'office, les précédentes se
 * déplient.
 */
function MomentDeComprehension({ entree, numero, derniere }: { entree: EntreeJournal; numero: number; derniere: boolean }) {
  const [choisi, setChoisi] = React.useState<boolean | undefined>(undefined);
  const ouvert = choisi ?? derniere;
  const donnees = React.useMemo(() => {
    const vide = { hypotheses: [] as string[], sujets: [] as string[], technique: null as PartieTechniqueLue | null };
    if (!entree.donnees) return vide;
    try {
      const lu = JSON.parse(entree.donnees) as {
        hypotheses?: unknown;
        questionsOuvertes?: unknown;
        sujets?: unknown;
        partieTechnique?: unknown;
      };
      const liste = (valeur: unknown) => (Array.isArray(valeur) ? valeur.map(String) : []);
      /* Les cartes déjà écrites portent l'ancien champ « ce qui reste flou » :
         on le relit sous la nouvelle rubrique plutôt que de le perdre. */
      const hypotheses = liste(lu.hypotheses).length ? liste(lu.hypotheses) : liste(lu.questionsOuvertes);
      return { hypotheses, sujets: liste(lu.sujets), technique: lirePartieTechnique(lu.partieTechnique) };
    } catch {
      return vide;
    }
  }, [entree.donnees]);
  const range = React.useMemo(() => rangerLaComprehension(entree.resultat ?? ''), [entree.resultat]);

  /* QUELS VOLETS SONT OUVERTS — le premier d'office, ou celui qu'on lisait la
     dernière fois. PLUSIEURS peuvent l'être à la fois : comparer deux points
     d'une même compréhension est exactement ce qu'on vient faire. */
  const [volets, setVolets] = React.useState<Set<string>>(() => new Set());
  const marques = React.useMemo(
    () => range.points.map((point, index) => point.reference ?? String(index + 1)),
    [range.points],
  );
  const premierVolet = marques[0];
  React.useEffect(() => {
    if (!premierVolet) return;
    const retenu = dernierVoletOuvert(entree.cardId, numero);
    /* Un souvenir qui ne correspond plus à aucun point (compréhension réécrite)
       retombe sur le premier volet, jamais sur un bloc tout fermé. */
    const choix = retenu && marques.includes(retenu) ? retenu : premierVolet;
    setVolets(new Set([choix]));
  }, [entree.cardId, numero, premierVolet, marques]);

  const basculerLeVolet = (marque: string) => {
    setVolets((avant) => {
      const apres = new Set(avant);
      if (apres.has(marque)) apres.delete(marque);
      else {
        apres.add(marque);
        /* ON NE RETIENT QUE L'OUVERTURE : refermer un volet ne dit pas lequel on
           veut retrouver, et effacerait le souvenir sans rien mettre à la place. */
        retenirLeVolet(entree.cardId, numero, marque);
      }
      return apres;
    });
  };

  return (
    /* LE MÊME DESSIN QUE LA RÉPONSE : un EN-TÊTE au fond contrasté, qui est
       aussi la bascule, puis le contenu dans un PANNEAU (`panneau.tsx`), sans
       aucun trait. Replié, l'en-tête reste seul : il s'arrondit en bas aussi.
       L'en-tête reste HORS de `.comprehension-unie`, qui n'admet qu'une taille.
       `scroll-mt-12` : visé par son début, l'en-tête s'arrête sous le fondu. */
    <div className="scroll-mt-12" data-moment="comprehension" data-comprehension-numero={numero}>
      <button
        type="button"
        onClick={() => setChoisi(!ouvert)}
        aria-expanded={ouvert}
        className={cn('en-tete-de-panneau flex w-full items-center gap-2 px-3 py-1.5 text-left', ouvert ? 'rounded-t-md' : 'rounded-md')}
        data-en-tete-de-panneau=""
        data-comprehension-bascule
      >
        {/* LE TITRE SE LIT À LA TAILLE DE CE QU'IL OUVRE. À 12,5 px, il passait
            sous le texte de la compréhension (14,5 px) et sous les intitulés
            d'étape du fil, qui sont à la même taille : l'entrée du bloc était
            plus petite que le bloc. L'heure, elle, reste un second plan. */}
        <span className="text-[14.5px] font-semibold leading-relaxed text-text">
          {t('Compréhension n° {v0}', { v0: numero })}
        </span>
        <span className="whitespace-nowrap text-[12.5px] text-faint">{dateHeure(entree.at)}</span>
        <span className="flex-1" />
        <ChevronRight className={cn('h-3.5 w-3.5 shrink-0 text-faint transition-transform', ouvert && 'rotate-90')} aria-hidden />
      </button>
      {ouvert ? (
        <Panneau className="py-3">
          <div className="comprehension-unie space-y-3" data-comprehension-contenu data-comprehension-forme={range.conforme ? 'points' : 'texte'}>
            {range.conforme ? (
              <>
                {range.ouverture ? <Markdown content={range.ouverture} /> : null}
                {/* LE SOMMAIRE ET LES POINTS SONT LA MÊME LISTE.
                    Le sommaire numéroté s'affichait en tête, puis chaque point le
                    reprenait numéro pour numéro : on lisait DEUX FOIS la même
                    liste, la seconde noyée dans les explications. Les deux n'en
                    font plus qu'une, en VOLETS : l'entête est la ligne de
                    sommaire, et son contenu est le point développé.
                    LE REPLI GARDE LE SOMMAIRE ENTIER quand il porte des lignes
                    sans point correspondant (compréhension ancienne, numérotation
                    décalée) : rien ne doit disparaître de l'écran. */}
                {range.sommaire.length && range.points.length < range.sommaire.length ? (
                  <ol className="list-decimal space-y-1 pl-5" data-comprehension-sommaire>
                    {range.sommaire.map((ligne, index) => (
                      <li key={index}>{ligne}</li>
                    ))}
                  </ol>
                ) : null}
                {/* LA COMPRÉHENSION SE LIT COMME LE COMPTE RENDU : un point gris,
                    l'intitulé en titre, le texte dessous, reliés par le trait. */}
                <ol className="space-y-0" data-comprehension-sommaire data-comprehension-volets={range.points.length}>
                  {range.points.map((point, index) => {
                    const marque = point.reference ?? String(index + 1);
                    return (
                      <PointDeLaComprehension
                        key={index}
                        intitule={point.intitule}
                        reference={point.reference}
                        derniere={index === range.points.length - 1 && !donnees.hypotheses.length}
                        volet={marque}
                        ouvert={volets.has(marque)}
                        onBasculer={() => basculerLeVolet(marque)}
                      >
                        {point.explication ? <Markdown content={point.explication} /> : null}
                        {point.comment ? <PartDuPointCompris libelle={t('Comment')} texte={point.comment} /> : null}
                        {point.resultat ? <PartDuPointCompris libelle={t('Résultat')} texte={point.resultat} /> : null}
                      </PointDeLaComprehension>
                    );
                  })}
                  {/* CE QUE L'AGENT SUPPOSE RESTE HORS DES VOLETS : c'est ce qu'on
                      vient vérifier avant de lancer, il ne se cache pas. */}
                  {donnees.hypotheses.length ? (
                    <PointDeLaComprehension intitule={t('Ce que l’agent suppose')} derniere attrs={{ 'data-hypotheses': '' }}>
                      <ul className="list-disc space-y-1 pl-5">
                        {donnees.hypotheses.map((hypothese, index) => (
                          <li key={index}>{hypothese}</li>
                        ))}
                      </ul>
                    </PointDeLaComprehension>
                  ) : null}
                </ol>
              </>
            ) : (
              /* LE TEXTE LIBRE — devenu le cas ORDINAIRE depuis que le cadrage
                 n'impose plus de gabarit, et toujours celui des compréhensions
                 écrites avant les volets. Rendu en paragraphes aérés (`mb-2.5`),
                 dans un `div` et jamais dans un `button` : rien n'est replié
                 ici, tout se lit et se copie d'un trait. */
              <Markdown content={entree.resultat ?? ''} className="texte-du-fil [&_p]:mb-2.5" />
            )}
            {!range.conforme && donnees.hypotheses.length ? (
              <div data-hypotheses>
                <p className="font-semibold">{t('Ce que l’agent suppose')}</p>
                <ul className="mt-1 list-disc space-y-1 pl-5">
                  {donnees.hypotheses.map((hypothese, index) => (
                    <li key={index}>{hypothese}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {donnees.sujets.length ? (
              <p>{t('Sujets de mémoire ouverts : {v0}', { v0: donnees.sujets.join(', ') })}</p>
            ) : null}
            {donnees.technique ? <DetailsTechniques technique={donnees.technique} /> : null}
          </div>
        </Panneau>
      ) : null}
    </div>
  );
}

/** Le second registre d'une compréhension, tel que son jalon le porte. */
type PartieTechniqueLue = {
  taches: { titre: string; description: string }[];
  faits: string[];
  risques: string;
};

/** Relit le second registre d'un jalon. Absent sur les compréhensions d'avant. */
function lirePartieTechnique(brut: unknown): PartieTechniqueLue | null {
  if (!brut || typeof brut !== 'object') return null;
  const source = brut as Record<string, unknown>;
  const taches = Array.isArray(source.taches)
    ? (source.taches as unknown[])
        .map((tache) => {
          const lue = (tache ?? {}) as Record<string, unknown>;
          return { titre: String(lue.titre ?? ''), description: String(lue.description ?? '') };
        })
        .filter((tache) => tache.titre)
    : [];
  const faits = Array.isArray(source.faits) ? (source.faits as unknown[]).map(String).filter(Boolean) : [];
  const risques = typeof source.risques === 'string' ? source.risques.trim() : '';
  if (!taches.length && !faits.length && !risques) return null;
  return { taches, faits, risques };
}

/**
 * LE SECOND REGISTRE DE LA COMPRÉHENSION, REPLIÉ PAR DÉFAUT.
 *
 * Le texte clair du point « Compréhension » s'adresse à qui ne programme pas ;
 * cette part-là s'adresse à l'agent qui EXÉCUTERA la carte — découpe du
 * travail, faits du projet à respecter, ce qui risque de casser. On ne la
 * cache pas, on la RANGE : la flèche dit d'un coup d'œil combien d'étapes et
 * combien de règles elle porte, sans qu'on ait à l'ouvrir. Une compréhension
 * d'avant ce changement n'en a pas : la flèche ne s'affiche alors pas du tout.
 */
function DetailsTechniques({ technique }: { technique: PartieTechniqueLue }) {
  const [ouvert, setOuvert] = React.useState(false);
  return (
    <div data-comprehension-technique={ouvert ? 'ouvert' : 'replie'}>
      <button
        type="button"
        onClick={() => setOuvert(!ouvert)}
        aria-expanded={ouvert}
        className="flex w-full items-center gap-2 text-left"
        data-comprehension-technique-bascule
      >
        <ChevronRight className={cn('h-3.5 w-3.5 shrink-0 text-faint transition-transform', ouvert && 'rotate-90')} aria-hidden />
        <span className="font-semibold">{t('Détails techniques')}</span>
        <span>
          {t('{v0} étapes · {v1} règles', { v0: technique.taches.length, v1: technique.faits.length })}
        </span>
      </button>
      {ouvert ? (
        <div className="mt-1.5 space-y-2 border-l border-faint/30 pl-3" data-comprehension-technique-contenu>
          {technique.taches.length ? (
            <ol className="space-y-1.5" data-technique-taches>
              {technique.taches.map((tache, index) => (
                <li key={index}>
                  <span className="font-medium">{tache.titre}</span>
                  {tache.description ? <span> — {tache.description}</span> : null}
                </li>
              ))}
            </ol>
          ) : null}
          {technique.faits.length ? (
            <div data-technique-faits>
              <p className="font-semibold">{t('Ce que le projet sait déjà')}</p>
              <ul className="mt-1 list-disc space-y-1 pl-5">
                {technique.faits.map((fait, index) => (
                  <li key={index}>{fait}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {technique.risques ? (
            <div data-technique-risques>
              <p className="font-semibold">{t('Ce qui peut casser')}</p>
              <p className="mt-0.5">{technique.risques}</p>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * UN POINT DE LA COMPRÉHENSION — UN VOLET, entête cliquable et contenu replié.
 *
 * Même dessin qu'une section du compte rendu (`rapport-flux.tsx`) : le point
 * gris de 5 px, le trait vertical, l'intitulé en gras. Ce qui change, c'est que
 * l'intitulé est aussi la LIGNE DE SOMMAIRE — numéro compris — et qu'un clic
 * dessus ouvre ou referme son développement. Un volet fermé ne laisse donc voir
 * que le sommaire ; la liste entière se lit d'un coup d'œil, et on descend dans
 * ce qu'on veut lire.
 *
 * Sans `volet`, le bloc reste un simple point toujours ouvert : c'est le cas de
 * « Ce que l'agent suppose », qui ne se cache pas.
 */
function PointDeLaComprehension({
  intitule,
  reference,
  derniere,
  attrs,
  volet,
  ouvert = true,
  onBasculer,
  children,
}: {
  intitule: string;
  /** Le numéro de la ligne du sommaire à laquelle ce point répond. */
  reference?: string;
  derniere: boolean;
  attrs?: Record<string, string>;
  /** La marque du volet : présente, l'entête devient une bascule. */
  volet?: string;
  ouvert?: boolean;
  onBasculer?: () => void;
  children?: React.ReactNode;
}) {
  const repliable = !!volet && !!onBasculer && !!children;
  const entete = (
    <>
      {/* LA RÉFÉRENCE RENVOIE À LA LIGNE DU SOMMAIRE : elle se détache de
          l'intitulé sans le concurrencer. */}
      {reference ? <span className="mr-1.5 font-normal">{reference}.</span> : null}
      {intitule}
    </>
  );
  return (
    <li
      className="flex gap-3"
      data-point-comprehension={intitule}
      data-point-reference={reference}
      data-volet-comprehension={volet}
      data-volet-ouvert={repliable ? (ouvert ? 'oui' : 'non') : undefined}
      {...attrs}
    >
      <div className="flex w-6 shrink-0 flex-col items-center">
        <span className="flex h-[26px] w-6 items-center justify-center">
          <PointDuFil />
        </span>
        {!derniere ? <span className="w-px flex-1 bg-faint/30" aria-hidden /> : null}
      </div>
      <div className={cn('min-w-0 flex-1', derniere && (!repliable || !ouvert) ? 'pb-0' : 'pb-4')}>
        {repliable ? (
          <button
            type="button"
            onClick={onBasculer}
            aria-expanded={ouvert}
            data-volet-bascule={volet}
            className="flex w-full items-start gap-2 text-left font-medium"
          >
            <span className="min-w-0 flex-1">{entete}</span>
            <ChevronRight
              className={cn('mt-[3px] h-3.5 w-3.5 shrink-0 text-faint transition-transform', ouvert && 'rotate-90')}
              aria-hidden
            />
          </button>
        ) : (
          <p className="font-medium">{entete}</p>
        )}
        {children && (!repliable || ouvert) ? (
          <div className="mt-1" data-volet-contenu={volet}>
            {children}
          </div>
        ) : null}
      </div>
    </li>
  );
}

/**
 * LA MANIÈRE ET LE RÉSULTAT ATTENDU D'UN POINT COMPRIS.
 *
 * Un bloc à deux étages, sans aucun trait : le libellé dans un EN-TÊTE au fond
 * contrasté, le texte dans un PANNEAU dessous (`panneau.tsx`). La hiérarchie
 * passe par les fonds, comme sur la fiche d'une demande — jamais par une
 * bordure. Le texte garde ses retours à la ligne et se copie à la souris.
 */
function PartDuPointCompris({ libelle, texte }: { libelle: string; texte: string }) {
  return (
    <div className="mt-2" data-point-part={libelle}>
      <EnTeteDePanneau>{libelle}</EnTeteDePanneau>
      <Panneau className="whitespace-pre-line">{texte}</Panneau>
    </div>
  );
}

/**
 * LA RÉPONSE D'UN TOUR QUI A RÉPONDU AU LIEU DE CADRER (`reponseDuPassage`).
 * Même dessin que la compréhension : un EN-TÊTE au fond contrasté (titre et
 * heure), puis le texte dans un PANNEAU dessous (`panneau.tsx`), sans aucun
 * trait. Le texte se lit ENTIER, jamais tronqué ni replié — donc pas de flèche :
 * c'est ce que la question attendait.
 */
function MomentDeReponse({ entree }: { entree: EntreeJournal }) {
  const texte = retirerLaStructureDeCadrage(entree.resultat ?? '').trim();
  return (
    /* `scroll-mt-12` (48 px) : visé par son début, l'EN-TÊTE s'arrête sous le
       fondu flouté du haut du fil (44 px, `ZoneDefilement`) et se lit net. */
    <div className="scroll-mt-12" data-moment="reponse" data-bloc-reponse={entree.id}>
      <EnTeteDePanneau className="flex items-baseline gap-2">
        <span className="text-[14.5px] leading-relaxed">{t('Réponse')}</span>
        <span className="whitespace-nowrap text-[12.5px] font-normal text-faint">{dateHeure(entree.at)}</span>
      </EnTeteDePanneau>
      <Panneau className="py-3">
        <Markdown content={texte} className="texte-du-fil [&_p]:mb-2.5" />
      </Panneau>
    </div>
  );
}

/**
 * LE COMPTE RENDU D'UN TOUR DE TRAVAIL, sur son gabarit : les six sections en
 * flux vertical, et l'écran dit celles qui manquent. Le dernier est ouvert,
 * les précédents repliés.
 */
function MomentDeRapport({
  entree,
  dernier,
  pickedEvolutions,
  onToggleEvolution,
  onToggleAll,
}: {
  entree: EntreeJournal;
  dernier: boolean;
  pickedEvolutions?: string[];
  onToggleEvolution?: (text: string) => void;
  onToggleAll?: (items: string[]) => void;
}) {
  /*
   * LE DERNIER COMPTE RENDU SE LIT DÉPLIÉ, MÊME APRÈS UNE RELANCE. Le choix
   * « replié / déplié » était gardé tel quel d'un rendu à l'autre : un bloc
   * refermé une fois restait fermé quand il redevenait le dernier, et la
   * relance du 13/09/2026 n'affichait qu'une ligne « Compte rendu » repliée
   * sous « Rapport ». Le choix ne vaut donc que pour CE compte rendu à CE rang.
   */
  const cle = `${entree.id}:${dernier ? 'dernier' : 'precedent'}`;
  const [choix, setChoix] = React.useState<{ cle: string; ouvert: boolean } | undefined>(undefined);
  const ouvert = choix?.cle === cle ? choix.ouvert : dernier;
  const texte = entree.resultat ?? '';
  return (
    <div data-moment="rapport" data-rapport-dernier={dernier ? 'oui' : 'non'} data-rapport-ouvert={ouvert ? 'oui' : 'non'}>
      <button type="button" onClick={() => setChoix({ cle, ouvert: !ouvert })} aria-expanded={ouvert} className="flex w-full items-center gap-2 text-left" data-rapport-bascule>
        <span className="text-[12.5px] font-semibold text-text">
          {dernier ? t('Compte rendu') : t('Compte rendu précédent')}
        </span>
        <span className="text-[12.5px] text-faint">{dateHeure(entree.at)}</span>
        <span className="flex-1" />
        <ChevronRight className={cn('h-3.5 w-3.5 text-faint transition-transform', ouvert && 'rotate-90')} aria-hidden />
      </button>
      {ouvert ? (
        <div className="mt-1.5 space-y-2">
          {texte.trim() ? (
            <RapportEnFlux
              contenu={texte}
              /* DANS LE FIL D'UNE CARTE, L'ENTÊTE SE CALE AU BORD GAUCHE : le fil
                 pose déjà son propre décalage, un second retrait décrochait le
                 descriptif de tout ce qui l'entoure. Le chat, lui, garde le sien. */
              enteteSansRetrait
              pickedEvolutions={pickedEvolutions}
              onToggleEvolution={onToggleEvolution}
              onToggleAll={onToggleAll}
            />
          ) : (
            <p className="text-[14.5px] leading-relaxed text-faint">{t('texte non conservé')}</p>
          )}
        </div>
      ) : null}
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
      attrs={{ 'data-sous-point-flux': 'erreur' }}
    >
    <div className="rounded-lg border border-danger/50 bg-danger/5 px-3 py-2" data-point-erreur={erreur.action ?? 'aucune'}>
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
/* La question ouverte : un point jaune                                  */
/* ------------------------------------------------------------------ */

/**
 * UNE QUESTION OUVERTE ARRÊTE L'AGENT : elle a son propre rond jaune, juste
 * après le point qui l'a posée. On y répond dans le panneau de décision, collé
 * au-dessus du champ ; le bouton y mène.
 */
function PointDeQuestion({ etape, entree }: { etape: EtapeDuParcours; entree: EntreeJournal }) {
  const mesures = useMesures();
  const vue = React.useMemo(() => vueDeLEntree(entree), [entree]);
  const question = vue.sorte === 'question' ? vue.question : resumeDeLEntree(entree) ?? t('Question posée');
  const description = vue.sorte === 'question' ? vue.description : undefined;
  return (
    <li className={cn('relative py-3', mesures.decalage)} data-point-question={entree.id} data-point-question-etape={etape}>
      <span
        className={cn(
          'fond-de-zone absolute left-0 top-3 flex items-center justify-center rounded-full border-2 border-warning bg-warning/10',
          mesures.rond,
        )}
        aria-hidden
      >
        <MessageSquare className={cn('text-warning', mesures.icone)} />
      </span>
      <div className="rounded-lg border border-warning/50 bg-warning/5 px-3 py-2">
        <p className="text-[12.5px] font-medium uppercase tracking-wide text-warning">{t('L’agent a une question')}</p>
        <p className="mt-0.5 text-[14.5px] leading-relaxed text-text">{question}</p>
        {description ? <p className="mt-0.5 text-[14.5px] leading-relaxed text-muted">{description}</p> : null}
        <div className="mt-1.5 flex justify-end">
          <Button
            variant="outline"
            size="sm"
            data-point-question-repondre
            onClick={() => document.querySelector('[data-panneau-decision]')?.scrollIntoView({ behavior: 'smooth', block: 'end' })}
          >
            <MessageSquare className="h-3 w-3" />
            {t('Répondre')}
          </Button>
        </div>
      </div>
    </li>
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
function MemoireDuPoint({ lignes, etape }: { lignes: LigneDuCarnet[]; etape: EtapeDuParcours }) {
  const [ouvert, setOuvert] = React.useState(false);
  if (!lignes.length) return null;
  const noms = lignes.map(nomDeLaLigne);
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
      attrs={{ 'data-sous-point-flux': 'memoire' }}
    >
    <div className="rounded-lg border border-border bg-raised/30" data-point-memoire={lignes.length}>
      <button type="button" onClick={() => setOuvert((o) => !o)} aria-expanded={ouvert} className="flex w-full items-center gap-2 px-3 py-1.5 text-left" data-point-memoire-bascule>
        <span className="min-w-0 flex-1 truncate text-[14.5px] text-muted" data-point-memoire-phrase>
          {phrase}
        </span>
        <ChevronRight className={cn('h-3.5 w-3.5 shrink-0 text-faint transition-transform', ouvert && 'rotate-90')} aria-hidden />
      </button>
      {ouvert ? (
        <ul className="space-y-1 border-t border-border px-3 py-2" data-point-memoire-contenu>
          {lignes.map((ligne) => (
            <li key={ligne.id} className="flex flex-wrap items-baseline gap-x-2 text-[12.5px]" data-point-memoire-ligne={ligne.cle}>
              <span className="min-w-0 break-words [overflow-wrap:anywhere] text-text">{nomDeLaLigne(ligne)}</span>
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
  const actions = React.useMemo(() => (repliable ? recitDuPoint(entrees).blocs.length : 0), [repliable, entrees]);

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
  if (repliable && actions > 0) {
    return (
      <SousPointDuFlux attrs={{ 'data-reflexion-repliee': reflexionOuverte ? 'ouverte' : 'repliee' }}>
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
            <RecitDuPassage entrees={entrees} projectId={projectId} total />
          </ol>
        ) : null}
      </SousPointDuFlux>
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

  return <RecitDuPassage entrees={entrees} projectId={projectId} total />;
}

/**
 * LES ACTIONS D'UN PASSAGE, UN CARTON CHACUNE, ET LE REPLI QUI LES TIENT.
 *
 * Au-delà du plafond rendu par la règle, seuls les premiers cartons se lisent
 * et un bouton propose « voir les N de plus ». Il déplie SUR PLACE — le
 * passage ne se referme pas — et se replie du même geste.
 */
function RecitDuPassage({
  entrees,
  projectId,
  total = false,
}: {
  entrees: EntreeJournal[];
  projectId?: string;
  /**
   * RAPPELER LE TEMPS TOTAL SOUS LE DERNIER GESTE. Vrai pour la liste d'un
   * PASSAGE, faux sous chaque ligne de la liste de tâches du point « Travail » :
   * un total par sous-point se lirait comme dix totaux différents.
   */
  total?: boolean;
}) {
  const [tout, setTout] = React.useState(false);
  const retrait = useRetraitDuTexte();
  const recit = React.useMemo(() => recitDuPoint(entrees), [entrees]);
  const caches = recit.blocs.length - recit.montresDOffice;
  const montres = tout ? recit.blocs : recit.blocs.slice(0, recit.montresDOffice);
  if (!recit.blocs.length) return null;

  return (
    <>
      {montres.map((bloc, rang) => {
        return (
          <SousPointDuFlux
            key={bloc.cle}
            ton={bloc.enEchec ? 'erreur' : 'neutre'}
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
      {caches > 0 ? (
        <li className={retrait}>
          <button
            type="button"
            onClick={() => setTout((t) => !t)}
            aria-expanded={tout}
            data-blocs-repli={tout ? 'ouvert' : 'ferme'}
            className="flex items-center gap-1 pb-2 text-[12.5px] text-faint transition-colors hover:text-muted"
          >
            <ChevronRight className={cn('h-3 w-3 transition-transform', tout && 'rotate-90')} aria-hidden />
            {tout ? t('Replier') : t('voir les {v0} de plus', { v0: caches })}
          </button>
        </li>
      ) : null}
      {/* LE TEMPS TOTAL, RAPPELÉ SOUS LE DERNIER GESTE — et HORS du repli :
          caché derrière « voir les N de plus », il n'aurait servi qu'à ceux qui
          n'en avaient plus besoin. Il compte tous les gestes du passage, y
          compris ceux qui attendent derrière ce repli. */}
      {total && recit.dureeMs !== undefined ? (
        <li className={cn(retrait, 'pb-1')}>
          <span
            className="text-[12.5px] leading-snug text-faint tabular-nums"
            data-duree-totale-pied={recit.dureeMs}
          >
            {t('Total : {v0}', { v0: dureeFine(recit.dureeMs / 1000) })}
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
      <ol>
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
        <DialogContentLibre className="sm:w-[min(900px,100%)]" data-fenetre-capture={bloc.cle}>
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
        className={cn('rounded-lg border bg-raised/40 px-3 py-2', bloc.enEchec ? 'border-danger/50' : 'border-faint/30')}
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
              onClick={() => setEnFenetre(true)}
              title={t('Voir la capture en grand')}
              className="shrink-0 overflow-hidden rounded border border-faint/40 bg-raised p-0.5"
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
          onClick={() => setEnFenetre(true)}
          title={t('Voir la capture en grand')}
          className="mt-1 block overflow-hidden rounded-md border border-faint/40 bg-raised p-0.5"
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

