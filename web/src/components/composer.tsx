import * as React from 'react';
import { createPortal } from 'react-dom';
import { ArrowRight, ArrowUp, Check, ChevronDown, ClipboardList, FileText, GripVertical, Loader2, Paperclip, Pause, Pencil, Sparkles, Trash2, Video, X } from 'lucide-react';
import {
  Agent,
  COLONNES_AVANT_LE_TRAVAIL,
  Attachment,
  EngineInfo,
  QueuedPrompt,
  RAISON_SANS_REPONSE,
  TYPE_JOINTES_COLLABLES,
  ajouterJointesCollees,
  aliasDuTag,
  aliasNonResolus,
  ancreDuTexte,
  accrocheAuMot,
  emballerJointes,
  contenuDuTagDe,
  designationDePiece,
  etiquetteDuTag,
  tagDesignePiece,
  etiquetteDePiece,
  relireJointes,
  boutonsBarreEcriture,
  commandeDuMessage,
  commandesDuMoteur,
  deplacerAncre,
  deplacerDansLaListe,
  filtrerCommandes,
  insereCommande,
  slashEnCours,
  deplacerJointe,
  coupeUnTag,
  curseurHorsDesTags,
  pasAuClavier,
  effacementDeTag,
  indexDeLAncre,
  insereAncre,
  jointesApresFrappe,
  jointesDesTags,
  jointesDuMessage,
  nomsDesTags,
  tagsRedesignes,
  masquesDuTexte,
  nomDuTag,
  retireAncre,
  retireOccurrence,
  sansMasque,
  tagsEnEspacesOrdinaires,
  tagsMasques,
  texteApresInsertion,
  brouillonApresSuspension,
  texteApresRetrait,
  carteEnPublication,
  messageOuvreUneNouvelleCarte,
  estAgentDeVolet,
  tailleLisible,
  DELAI_AVANT_MESSAGE_DU_CANAL,
  EDITION_EN_FILE_RAFRAICHIE_MS,
  nettoyerTexteColle,
  texteColleADesDebris,
} from '@beluga/shared';
import { EVENEMENT_FILE_RENDUE, type DetailFileRendue, useArretAgent, useChampMonte } from '@/components/arret-agent';
import { AttachmentPreview } from '@/components/attachment-preview';
import {
  Button,
  type ButtonProps,
  CLASSE_MARGE_DU_LIBELLE_DU_CHAMP,
  CLASSE_RANGEE_DE_BOUTONS,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Textarea,
  Tooltip,
  ZoneDefilement,
} from '@/components/ui';
import { type DragItem, type DropTarget, usePointerDrag } from '@/lib/dnd';
import { IndicateurComprehension } from '@/components/indicateur-comprehension';
import { MicButton, RecorderErrorBar, RecordingBar, useRecorder } from '@/components/recorder';
import { MenuSlash, PastilleCommande } from '@/components/menu-slash';
import { AnneauContexte } from '@/components/anneau-contexte';
import { BarreProgression } from '@/components/barre-progression';
import { nomCourtMoteur, resoudreRun } from '@/components/run-selectors';
import { indexAuPoint, montreLeMorceau, pointDeLIndex, reglagesDuChamp } from '@/lib/miroir-texte';
import { estTelephone, useTelephone } from '@/lib/telephone';
import { readPref, usePref, writePref } from '@/lib/prefs';
import { EnvoiAnnule, EnvoiInterrompu, attendreLeLien, envoyerFichier } from '@/lib/envoi-fichier';
import { client } from '@/lib/client';
import { useApp, useCanal } from '@/lib/use-app';
import type { TexteDuChamp } from '@/lib/texte-du-champ';
import { cn } from '@/lib/utils';
import { t } from '@/lib/langue';

export interface ComposerProps {
  agent: Agent | null;
  engines: EngineInfo[];
  queue: QueuedPrompt[];
  busy: boolean;
  /**
   * LE TEXTE DU CHAMP, DÉPOSÉ POUR CE QUI L'ENTOURE (`web/src/lib/texte-du-champ.ts`) :
   * les idées à cocher d'un compte rendu y lisent leur case. Rien d'autre que
   * ces lignes ne s'y abonne — la frappe ne redessine pas le fil.
   */
  champ?: TexteDuChamp;
  /**
   * UN TEXTE DÉPOSÉ DEPUIS LE FIL, jamais envoyé : le refus d'un plan et ses
   * suggestions d'optimisation (`shared/src/suggestions-de-plan.ts`). Il
   * s'ajoute à ce qui est déjà écrit, il ne l'écrase pas. Le `nonce` distingue
   * deux clics sur la MÊME pastille — sans lui, le second ne ferait rien.
   */
  /**
   * CE QU'UN BLOC DU FIL DÉPOSE DANS LE CHAMP, sans rien envoyer. `retirer`
   * inverse le geste : une suggestion décochée reprend sa ligne au lieu d'en
   * ajouter une (`texteApresRetrait`, `shared/src/suggestions-de-plan.ts`).
   */
  aEcrire?: { texte: string; nonce: number; retirer?: boolean } | null;
  projectId: string;
  /** Depuis une carte, l'envoi peut devenir une proposition de tâche (§15). */
  onProposeTask?: (text: string) => void;
  /** Dans le tiroir d'une carte : des boutons suivent en dessous, la barre ne
   *  touche donc pas le bas de l'écran et ne réserve pas le creux du téléphone. */
  dansTiroir?: boolean;
  /** Depuis le tiroir d'une carte : l'arrêt ne vaut que pour SA tâche. */
  cardId?: string;
  /** Seule une conversation hors carte vit sur fond noir
   *  (pas dans un tiroir) ; partout ailleurs (tiroir de carte, pile des
   *  agents) le fond entourant est gris cendré, la barre doit le reprendre. */
  fondNoir?: boolean;
  /**
   * Le témoin « travail en cours », rendu ICI plutôt qu'à côté : dans ce
   * même conteneur (même repli latéral que la zone de saisie), il en épouse
   * exactement la largeur, et rien ne peut plus s'intercaler entre lui et
   * elle — la file d'attente, les pièces jointes et le reste restent tous
   * au-dessus, comme le fil des messages déjà envoyés.
   */
  barreTravail?: React.ReactNode;
  /**
   * UN GESTE PLEINE LARGEUR, POSÉ AU-DESSUS DU CHAMP DE SAISIE. Aujourd'hui
   * « Lancer la tâche », qui ferme la conversation de cadrage d'une carte et
   * confie le travail à un agent complet (`shared/src/cadrage.ts`). Rendu ICI
   * plutôt que dans le fil : il épouse alors exactement la largeur de la barre
   * d'écriture, et rien ne s'intercale entre lui et elle quand le fil défile.
   */
  boutonPrincipal?: React.ReactNode;
  /**
   * LE LIBELLÉ DU CHAMP SUIT LE CHAPITRE DE LA CARTE : « Expliquez… »,
   * « Affinez le plan… », « Écrire à l'agent… » (`LIBELLES_DU_CHAMP`,
   * `shared/src/parcours-carte.ts`). Absent, le mot ordinaire.
   */
  libelleDuChamp?: string;
  /**
   * LE BOUTON DES RÉGLAGES DE L'AGENT, posé dans la rangée du bas : sur une
   * carte, juste à droite du mode Création ; sur une conversation sans carte,
   * juste à droite du trombone (ces deux interrupteurs n'y existent pas).
   * Toujours visible, jamais lié au défilement du fil.
   */
  reglages?: React.ReactNode;
  /**
   * L'ARRÊT VIT DÉJÀ DANS LA BARRE D'ACTION de la carte quand c'est le geste du
   * chapitre : le carré d'arrêt du champ le redirait juste en dessous.
   */
  sansArret?: boolean;
  /**
   * RIEN NE FIGE À L'ENVOI : L'ÉCRAN BASCULE AU CLIC, PAS À L'ALLER-RETOUR.
   *
   * Le texte part au serveur, qui l'enregistre, le diffuse, choisit un compte
   * puis lance le moteur — et l'écran, lui, attendait cet écho pour quitter le
   * bloc de configuration. Sur un serveur chargé, la seconde de silence passait
   * pour un plantage. Ce rappel est appelé À L'INSTANT DU CLIC, avant même la
   * requête : l'écran a de quoi montrer la demande tout de suite.
   *
   * Il ne DOUBLE rien : l'écho local se retire dès que la vraie demande arrive
   * dans le journal (`chat.tsx`), et l'échec le retire aussi.
   */
  onEnvoiCommence?: (texte: string) => void;
  /** L'envoi a été REFUSÉ : l'écho local se retire, le texte revient au champ. */
  onEnvoiEchoue?: () => void;
  /**
   * Un message EN ATTENTE vient d'être modifié (`queue.update` accepté). La
   * bulle « Demande » provisoire posée au clic d'envoi garde sinon l'ancien
   * texte : l'écran la corrige (`chat.tsx`) en reconnaissant l'ancien texte.
   */
  onEnvoiModifie?: (avant: string, apres: string) => void;
}

const MARQUE_FICHIER = /\[fichier:\s*([^\]\n]+)\]/g;
/** Au doigt, chaque lettre est visée dans un carré plus large qu'à la souris. */
const MARGE_DOIGT = 24;
/** Copie locale d'un brouillon, gardée jusqu'à l'accusé du serveur. */
const PREFIXE_COPIE_BROUILLON = 'beluga.brouillon.';

/**
 * L'ALLURE COMMUNE DES INTERRUPTEURS DE LA BARRE (« Plan », « Création ») :
 * l'icône et le libellé, rien d'autre — plus de mini-rail à rond. Ce sont eux
 * qui disent l'état : allumés, ils prennent le BLEU « terminé » (`--termine`,
 * déclaré par chaque palette) — jamais `--accent`, qui vaut blanc ou noir
 * selon l'ambiance et rendait l'état illisible. Éteints, ils sont gris.
 *
 * UN SEUL élément cliquable : pas de `Switch` Radix imbriqué dans un bouton.
 * Pendant l'aller-retour au serveur, l'icône pulse (un bouton qui part en
 * requête le dit dès le clic) et le bouton est bloqué. Un calque invisible
 * porte la cible au doigt à 36 px de haut sans grandir la barre.
 */
const BoutonInterrupteur = React.forwardRef<
  HTMLButtonElement,
  {
    actif: boolean;
    enVol: boolean;
    icone: React.ReactNode;
    libelle: string;
    onClick: () => void;
  } & Omit<ButtonProps, 'onClick'>
>(function BoutonInterrupteur({ actif, enVol, icone, libelle, onClick, className, ...reste }, ref) {
  /*
   * LA RÉFÉRENCE DOIT ARRIVER JUSQU'AU BOUTON. L'infobulle d'enveloppe
   * (`Tooltip`, déclencheur Radix en `asChild`) s'accroche à l'élément par elle :
   * sans `forwardRef`, React la jetait, la bulle s'ouvrait sans ancre et restait
   * dessinée hors de l'écran — les trois interrupteurs n'avaient « aucune bulle ».
   * Les gestionnaires posés par le déclencheur (survol, focus, aria) passent par
   * `reste`.
   */
  return (
    <Button
      ref={ref}
      variant="ghost"
      size="sm"
      sansAttente
      disabled={enVol}
      aria-pressed={actif}
      aria-busy={enVol || undefined}
      aria-label={libelle}
      {...reste}
      className={cn(
        // Même case que les boutons-icônes de la rangée (28 px de côté, marge
        // de 7 px autour du glyphe) : le vide jusqu'au voisin est le même.
        // ICÔNE SEULE (demande du 14/10/2026) : le nom se lit au survol, dans
        // l'infobulle — deux glyphes bien distincts suffisent à les séparer.
        'relative h-7 w-7 shrink-0 touch-manipulation px-0 after:absolute after:inset-x-0 after:-inset-y-1 after:content-[""]',
        CLASSE_MARGE_DU_LIBELLE_DU_CHAMP,
        // Le survol GARDE la couleur de l'état : le `hover:text-text` du bouton
        // fantôme le blanchissait, et au doigt le survol reste collé après le
        // toucher — « Création » allumée paraissait blanche. Allumé, il est
        // VIOLET (demande du 12/10/2026) : l'élément choisi, `aria-pressed`.
        actif ? 'text-teinte hover:text-teinte' : 'text-faint hover:text-muted',
        enVol && 'cursor-wait disabled:opacity-70',
        className,
      )}
      onClick={onClick}
    >
      <span aria-hidden className={cn('inline-flex shrink-0', enVol && 'animate-pulse')}>
        {icone}
      </span>
    </Button>
  );
});

/**
 * L'INTERRUPTEUR « PLAN », COLLÉ AU CHAMP D'ÉCRITURE.
 *
 * Le plan n'est plus un passage obligé : il est devenu une OPTION, éteinte à
 * la naissance de chaque carte. Allumé, chaque tour de cadrage rend aussi un
 * plan complet à la fin de son tour, affiché sous la compréhension du même
 * tour — sans second clic ni seconde attente.
 *
 * Son état vit SUR LA CARTE (`parcours.planSouhaite`) : il survit donc à la
 * fermeture du tiroir, au rechargement et au changement d'appareil. Il ne
 * paraît que sur une carte encore en cadrage — ailleurs, il ne veut rien dire.
 */
function InterrupteurDePlan({ cardId, agent }: { cardId?: string; agent?: Agent | null }) {
  const state = useApp();
  const carte = cardId ? state.cards[cardId] : undefined;
  const [enVol, setEnVol] = React.useState(false);
  if (!carte || agent?.role !== 'cadrage') return null;
  if (!COLONNES_AVANT_LE_TRAVAIL.includes(carte.column) && !carte.parcours?.cadrageRouvertA) return null;
  const actif = !!carte.parcours?.planSouhaite;
  const automatique = actif && !!carte.parcours?.planAutomatique;
  return (
    <Tooltip
      label={`${t('Cahier des charges')} — ${
        automatique
          ? t('Allumé tout seul : la demande est complexe. Le cadrage pose plus de questions puis rend un plan à sa taille.')
          : actif
            ? t('Le cadrage rendra aussi un plan complet à la fin de son tour.')
            : t('Demander en plus un plan complet, rendu sous la compréhension.')
      }`}
    >
      <BoutonInterrupteur
        actif={actif}
        enVol={enVol}
        data-interrupteur-plan={actif ? 'allume' : 'eteint'}
        data-plan-automatique={automatique ? 'oui' : 'non'}
        icone={<ClipboardList className="h-4 w-4" />}
        libelle={t('Cahier des charges')}
        onClick={() => {
          setEnVol(true);
          void client
            .call({ type: 'card.plan.souhaite', cardId: carte.id, actif: !actif })
            .catch((err: any) => client.pushToast('error', err?.message ?? t('Geste refusé'), carte.id))
            .finally(() => setEnVol(false));
        }}
      />
    </Tooltip>
  );
}

/**
 * L'INTERRUPTEUR « CRÉATION », VOISIN DE « PLAN » ET RANGÉ DE LA MÊME FAÇON.
 *
 * Allumé, l'agent de la carte devient chef d'orchestre : il confie le texte, le
 * code et des avis à d'autres moteurs du serveur, et fait départager les
 * propositions par le juge local (`shared/src/mode-creation.ts`). Seule la
 * BASCULE vit ici — la répartition se règle dans les réglages, jamais dans la
 * barre d'écriture (DEC-090).
 *
 * Son état vit SUR LA CARTE (`parcours.creationSouhaitee`), éteint à la
 * naissance. Il se CHOISIT avant le travail, comme le plan : l'interrupteur ne
 * paraît donc que pour l'agent de cadrage d'une carte encore en « Planifié »
 * (ou au cadrage rouvert). Le choix fait reste VALABLE à l'exécution — le
 * serveur sert les outils du mode à l'agent de tâche d'après la carte
 * (`toolsFor(role, { creation })`) : seul le bouton disparaît, pas l'effet.
 */
function InterrupteurDeCreation({ cardId, agent }: { cardId?: string; agent?: Agent | null }) {
  const state = useApp();
  const carte = cardId ? state.cards[cardId] : undefined;
  const [enVol, setEnVol] = React.useState(false);
  const [explication, setExplication] = React.useState(false);
  const [dejaExplique, setDejaExplique] = usePref<boolean>('creation.expliquee', false);
  if (!carte || agent?.role !== 'cadrage') return null;
  if (!COLONNES_AVANT_LE_TRAVAIL.includes(carte.column) && !carte.parcours?.cadrageRouvertA) return null;
  const actif = !!carte.parcours?.creationSouhaitee;
  const basculer = (valeur: boolean) => {
    setEnVol(true);
    void client
      .call({ type: 'card.creation.souhaitee', cardId: carte.id, actif: valeur })
      .catch((err: any) => client.pushToast('error', err?.message ?? t('Geste refusé'), carte.id))
      .finally(() => setEnVol(false));
  };
  return (
    <>
      <Tooltip
        label={`${t('Création')} — ${
          actif
            ? t('Mode Création : l’agent fait travailler plusieurs modèles et assemble le meilleur rendu.')
            : t('Faire travailler plusieurs modèles ensemble : texte, code, avis et évaluation.')
        }`}
      >
        <BoutonInterrupteur
          actif={actif}
          enVol={enVol}
          data-interrupteur-creation={actif ? 'allume' : 'eteint'}
          icone={<Sparkles className="h-4 w-4" />}
          libelle={t('Création')}
          onClick={() => {
            // LA PREMIÈRE FOIS, ON EXPLIQUE AVANT D'ALLUMER : le mode coûte
            // plusieurs moteurs, il ne s'allume pas sur un clic d'essai.
            if (!actif && !dejaExplique) setExplication(true);
            else basculer(!actif);
          }}
        />
      </Tooltip>
      <FenetreDuModeCreation
        ouverte={explication}
        onAnnuler={() => setExplication(false)}
        onActiver={() => {
          setExplication(false);
          setDejaExplique(true);
          basculer(true);
        }}
      />
    </>
  );
}

/**
 * L'INTERRUPTEUR « RÉALISATION » (caméra), TROISIÈME DE LA RANGÉE.
 *
 * Allumé, la carte devient un projet audiovisuel : le cadrage pose d'abord
 * « image ou vidéo ? » puis un questionnaire de réalisation, et l'agent de
 * tâche reçoit l'outil « realiser » qui fabrique les médias sous budget, en
 * annonçant modèle et prix avant chaque génération
 * (`shared/src/mode-realisation.ts`). L'allumer allume aussi le cahier des
 * charges. Même rangement que « Création » : sur la carte, choisi avant le
 * travail, et toujours valable à l'exécution.
 */
function InterrupteurDeRealisation({ cardId, agent }: { cardId?: string; agent?: Agent | null }) {
  const state = useApp();
  const carte = cardId ? state.cards[cardId] : undefined;
  const [enVol, setEnVol] = React.useState(false);
  if (!carte || agent?.role !== 'cadrage') return null;
  if (!COLONNES_AVANT_LE_TRAVAIL.includes(carte.column) && !carte.parcours?.cadrageRouvertA) return null;
  const actif = !!carte.parcours?.realisationSouhaitee;
  return (
    <Tooltip
      label={`${t('Réalisation')} — ${
        actif
          ? t('Mode réalisation : le cadrage bâtit le cahier de l’image ou de la vidéo, puis l’agent la fabrique sous votre budget.')
          : t('Faire réaliser une image ou une vidéo : questionnaire de réalisation, puis fabrication avec modèle et prix annoncés.')
      }`}
    >
      <BoutonInterrupteur
        actif={actif}
        enVol={enVol}
        data-interrupteur-realisation={actif ? 'allume' : 'eteint'}
        icone={<Video className="h-4 w-4" />}
        libelle={t('Réalisation')}
        onClick={() => {
          setEnVol(true);
          void client
            .call({ type: 'card.realisation.souhaitee', cardId: carte.id, actif: !actif })
            .catch((err: any) => client.pushToast('error', err?.message ?? t('Geste refusé'), carte.id))
            .finally(() => setEnVol(false));
        }}
      />
    </Tooltip>
  );
}

/**
 * LA FENÊTRE DU PREMIER ALLUMAGE DE « CRÉATION ». Elle ne paraît qu'une fois
 * par utilisateur (préférence partagée entre appareils, `creation.expliquee`) :
 * ce que fait le mode, ce qu'il coûte, et comment l'éteindre.
 */
function FenetreDuModeCreation({
  ouverte,
  onAnnuler,
  onActiver,
}: {
  ouverte: boolean;
  onAnnuler: () => void;
  onActiver: () => void;
}) {
  return (
    <Dialog open={ouverte} onOpenChange={(next) => !next && onAnnuler()}>
      <DialogContent className="sm:w-[min(520px,100%)]" data-fenetre-mode-creation="">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-teinte" />
            {t('Le mode Création')}
          </DialogTitle>
          <DialogDescription>
            {t('L’agent de la carte devient chef d’orchestre : au lieu de tout faire seul, il fait travailler plusieurs modèles ensemble.')}
          </DialogDescription>
        </DialogHeader>
        <ul className="mt-3 list-disc space-y-1.5 pl-5 text-[14px] text-muted">
          <li>{t('Il confie le texte, le code et les avis à d’autres moteurs du serveur.')}</li>
          <li>{t('Leurs propositions sont départagées par un juge, puis il assemble le meilleur rendu.')}</li>
          <li>{t('Utile pour un travail créatif ou délicat ; plus lent et plus coûteux qu’un agent seul.')}</li>
          <li>{t('Le choix vaut pour cette carte seulement, et un nouveau clic l’éteint.')}</li>
        </ul>
        <DialogFooter>
          <Button variant="ghost" onClick={onAnnuler}>
            {t('Annuler')}
          </Button>
          <Button onClick={onActiver} data-activer-mode-creation="">
            {t('Activer le mode Création')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * UN MESSAGE EN ATTENTE OUVERT DANS LE CHAMP, et ce qui est mis de côté le
 * temps de le modifier. Il garde SES pièces jointes à lui : le brouillon mis de
 * côté a les siennes, et les deux ne se mélangent jamais.
 */
interface EditionDeMessage {
  id: string;
  /** Le texte du message à l'ouverture : il sert à retrouver sa bulle provisoire. */
  texteAvant: string;
  /** Ce qui était en train d'être écrit : il revient à la fin, validée ou annulée. */
  texteMisDeCote: string;
  /** Les pièces du message, telles que le champ les montre et les retouche. */
  jointes: Attachment[];
  /** Celles qu'il portait à l'ouverture : ce que le serveur lui garde quand il ne dit rien de plus. */
  dOrigine: string[];
  /** Celles que la page ne sait pas encore nommer : elles restent au message, quoi qu'il arrive ici. */
  inconnues: string[];
}

export function Composer({
  agent,
  engines,
  queue,
  busy,
  champ,
  aEcrire,
  projectId,
  onProposeTask,
  dansTiroir,
  cardId,
  fondNoir,
  barreTravail,
  boutonPrincipal,
  libelleDuChamp,
  reglages,
  sansArret,
  onEnvoiCommence,
  onEnvoiEchoue,
  onEnvoiModifie,
}: ComposerProps) {
  const state = useApp();
  /* L'état du lien, lu à UN seul endroit (`useCanal`) : ce qui éteint le bouton
     d'envoi est exactement ce qui refuse l'envoi, sans seconde déduction. */
  const canal = useCanal();
  const lienGeleRef = React.useRef(canal.gele);
  lienGeleRef.current = canal.gele;
  /* LE CHAMP SE VERROUILLE QUAND LA COUPURE S'INSTALLE (le même délai que le
     message du lien), pas à la première seconde : une reconnexion invisible ne
     doit pas avaler une frappe. Le texte, lui, est protégé dès la première
     seconde (`brouillonNonConfirme`) et repart seul au retour du lien. */
  const [coupureInstallee, setCoupureInstallee] = React.useState(false);
  React.useEffect(() => {
    if (!canal.gele) {
      setCoupureInstallee(false);
      return;
    }
    const minuterie = window.setTimeout(() => setCoupureInstallee(true), DELAI_AVANT_MESSAGE_DU_CANAL);
    return () => window.clearTimeout(minuterie);
  }, [canal.gele]);
  const ecritureGelee = canal.gele && coupureInstallee;
  const ecritureGeleeRef = React.useRef(ecritureGelee);
  ecritureGeleeRef.current = ecritureGelee;
  /* UNE CARTE EN COURS DE PUBLICATION NE REÇOIT PLUS DE MESSAGE : le serveur
     le refuse (`shared/src/verrou-publication.ts`), et le champ le dit avant
     même qu'on écrive. Le fil du conducteur de publication reste ouvert. */
  const enPublication =
    !!agent &&
    agent.role !== 'deploy' &&
    carteEnPublication(state.deploys[agent.projectId], agent.cardId ?? cardId);
  /* UNE CARTE DÉJÀ EN LIGNE NE SE MODIFIE PAS SUR PLACE : un message qu'on y
     écrit ouvre une NOUVELLE carte (`messageOuvreUneNouvelleCarte`) — mais
     seulement sur ACCORD : l'envoi garde le texte et demande « Ouvrir une
     nouvelle carte » (`accordNouvelleCarte`). Le champ le dit, et l'envoi
     n'affiche pas d'écho « Demande envoyée » ici. JAMAIS dans le volet d'un
     agent de volet (Studio, Marketing, surveillance, sauvegardes) : on lui
     écrit, il répond (`estAgentDeVolet`). */
  const carteDuChamp = state.cards[agent?.cardId ?? cardId ?? ''];
  const ouvreUneNouvelleCarte =
    !!agent &&
    agent.role !== 'deploy' &&
    !!carteDuChamp &&
    messageOuvreUneNouvelleCarte(carteDuChamp) &&
    !estAgentDeVolet(agent, carteDuChamp);
  /** L'utilisateur a tenté d'envoyer sous une carte en ligne : on attend son accord. */
  const [accordNouvelleCarte, setAccordNouvelleCarte] = React.useState(false);
  React.useEffect(() => setAccordNouvelleCarte(false), [agent?.id, ouvreUneNouvelleCarte]);
  const [text, setText] = React.useState('');
  /** Message en attente en cours de modification, et le texte mis de côté. */
  const [edition, setEdition] = React.useState<EditionDeMessage | null>(null);
  const editionCourante = React.useRef(edition);
  editionCourante.current = edition;
  /*
   * DEUX LISTES DE PIÈCES, UNE SEULE À L'ÉCRAN. Le champ ne tenait qu'une liste,
   * celle du brouillon : ouvrir un message en attente y écrivait SON texte sous
   * les pièces d'un AUTRE — ses propres images n'étaient plus que des pastilles
   * sans vignette, la croix d'une vignette retirait une pièce du brouillon mis
   * de côté, et une image ajoutée partait dans ce brouillon au lieu du message.
   * Le temps d'une modification, le champ montre et retouche donc les pièces
   * DU MESSAGE (`edition.jointes`) ; celles du brouillon ne bougent pas, et
   * reviennent avec lui.
   */
  const [jointesDuBrouillon, setJointesDuBrouillon] = React.useState<Attachment[]>([]);
  const attachments = edition ? edition.jointes : jointesDuBrouillon;
  /** Retoucher la liste que le champ MONTRE : celle du message modifié, sinon celle du brouillon. */
  const setAttachments = React.useCallback((maj: React.SetStateAction<Attachment[]>) => {
    const suite = (liste: Attachment[]) => (typeof maj === 'function' ? maj(liste) : maj);
    if (editionCourante.current) setEdition((courante) => (courante ? { ...courante, jointes: suite(courante.jointes) } : courante));
    else setJointesDuBrouillon(suite);
  }, []);
  /*
   * CE QUE LE CHAMP AFFICHE : le même texte, tags MASQUÉS (`tagsMasques`,
   * shared/src/ancres.ts). L'enrobage « [fichier: » et « ] » y est remplacé,
   * caractère pour caractère, par des signes invisibles qui réservent juste la
   * place du dessin : le tag occupe alors la LARGEUR DE SA PASTILLE, plus celle
   * de sa syntaxe. LA PLACE RÉSERVÉE EST CELLE DE L'ÉTIQUETTE COURTE
   * affichée (« #1a0c »), plus les trois cadratins du dessin : c'est pourquoi
   * les pièces jointes lui sont passées. Un texte collé, un brouillon rechargé ou une phrase dictée
   * passent tous par ici. La longueur ne change pas d'un caractère, donc rien
   * ne bouge : ni le curseur, ni les index des ancres, ni les positions de
   * sélection — l'état du composeur (`text`) et ce que le champ montre se
   * lisent aux mêmes numéros. Le CALQUE lit la MÊME chaîne que le champ — deux
   * chaînes différentes, et les tags dessinés tomberaient à côté.
   */
  const texteDuChamp = React.useMemo(() => tagsMasques(text, attachments), [text, attachments]);
  /** La pièce jointe regardée en grand, avant même l'envoi du message. */
  const [apercu, setApercu] = React.useState<Attachment | null>(null);
  const envois = useEnvois(agent?.id ?? 'aucun');
  const agentIdCourant = React.useRef(agent?.id);
  agentIdCourant.current = agent?.id;
  const attachmentsCourantes = React.useRef(attachments);
  attachmentsCourantes.current = attachments;
  const [scrollTexte, setScrollTexte] = React.useState(0);
  /*
   * LES VIGNETTES SE RÉORDONNENT PAR LE GLISSER COMMUN (`usePointerDrag`) : au
   * doigt comme à la souris, sans le glisser natif du navigateur, qui ne marche
   * pas sur téléphone. La rangée est horizontale : la cible se lit en x — avant
   * ou après la vignette survolée.
   */
  const resoudreVignette = React.useCallback((element: Element, _y: number, x: number): DropTarget | null => {
    const vignette = element.closest('[data-piece-vignette]');
    const id = vignette?.getAttribute('data-piece-vignette');
    if (!vignette || !id) return null;
    const r = vignette.getBoundingClientRect();
    return { id, kind: 'piece', position: x < r.left + r.width / 2 ? 'before' : 'after' };
  }, []);
  /** Un glissement qui vient de finir n'ouvre pas l'aperçu de la vignette lâchée. */
  const finDeGlissement = React.useRef(0);
  const deposerVignette = React.useCallback((item: DragItem, cible: DropTarget | null) => {
    finDeGlissement.current = Date.now();
    if (!cible || cible.position === 'inside') return;
    setAttachments((liste) => {
      const depuis = liste.findIndex((piece) => piece.id === item.id);
      const sur = liste.findIndex((piece) => piece.id === cible.id);
      if (depuis < 0 || sur < 0) return liste;
      const vers = cible.position === 'before' ? (depuis < sur ? sur - 1 : sur) : depuis < sur ? sur : sur + 1;
      return deplacerJointe(liste, depuis, vers);
    });
  }, []);
  const glisserVignette = usePointerDrag({ resolve: resoudreVignette, onDrop: deposerVignette, holdMs: 250 });
  /** Le drapeau du texte qu'on est en train de glisser, pour le suivre du doigt. */
  const [drapeauGlisse, setDrapeauGlisse] = React.useState<{
    nom: string;
    x: number;
    y: number;
    /** Au doigt, l'étiquette monte AU-DESSUS du doigt : dessous, elle cachait le trait d'insertion. */
    doigt: boolean;
    trait: { x: number; y: number; hauteur: number } | null;
  } | null>(null);
  const origineDrapeau = React.useRef<{
    nom: string;
    occurrence: number;
    x: number;
    y: number;
  } | null>(null);
  const drapeauABouge = React.useRef(false);
  const viseDrapeau = React.useRef<number | null>(null);
  const glisseRaf = React.useRef(0);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);
  /**
   * Où l'ancre du prochain fichier doit s'écrire : le curseur posé dans le
   * texte, ou l'endroit visé par un fichier lâché sur les mots. Rien de posé
   * (collage, dépôt à côté du texte) → l'ancre va à la fin.
   */
  const curseur = React.useRef<number | null>(null);
  /**
   * LA POSITION CALCULÉE NE SUFFIT PAS : IL FAUT LA REPOSER SUR LE VRAI CHAMP.
   * Écrire un tag au milieu du texte allonge la phrase, mais le champ garde le
   * curseur au même NUMÉRO de caractère — donc plusieurs lettres trop tôt, et
   * la frappe suivante s'insérait au milieu des mots déjà écrits. Ce repère
   * porte l'endroit voulu jusqu'après le rendu, où il est appliqué.
   */
  const curseurAPoser = React.useRef<number | null>(null);
  /** La sélection à reposer après une réécriture venue d'ailleurs (`retenirLaSelection`). */
  const selectionAGarder = React.useRef<{ debut: number; fin: number } | null>(null);

  /**
   * Reposer le curseur APRÈS que le nouveau texte est peint : le faire avant
   * viserait encore l'ancienne phrase. Aucun effet tant que rien n'est demandé
   * — survoler une vignette ou taper au clavier ne vole jamais le curseur.
   */
  React.useLayoutEffect(() => {
    const vise = curseurAPoser.current;
    const garde = selectionAGarder.current;
    curseurAPoser.current = null;
    selectionAGarder.current = null;
    const zone = textareaRef.current;
    if (!zone) return;
    if (vise !== null) {
      const position = Math.max(0, Math.min(vise, zone.value.length));
      zone.focus();
      zone.setSelectionRange(position, position);
      return;
    }
    // Une réécriture venue d'ailleurs : la sélection revient où elle était,
    // sans jamais PRENDRE le curseur à un champ qui ne l'avait pas.
    if (!garde || document.activeElement !== zone) return;
    const debut = Math.min(garde.debut, zone.value.length);
    const fin = Math.min(garde.fin, zone.value.length);
    if (zone.selectionStart !== debut || zone.selectionEnd !== fin) zone.setSelectionRange(debut, fin);
  }, [text, texteDuChamp]);

  /**
   * LE CURSEUR ARRIVE DANS LE CHAMP QUAND UN AGENT S'OUVRE (nouvel agent, carte
   * existante, changement d'agent dans le même composant). Un court délai le
   * laisse passer après le focus que le tiroir ou la fenêtre reprend en se
   * fermant. Grand écran seulement : sur téléphone, le clavier cacherait le fil.
   * Jamais volé à un champ déjà actif, ni posé sur un champ gelé ; le texte et
   * la sélection du brouillon ne sont pas touchés.
   */
  const agentOuvert = agent?.id;
  React.useEffect(() => {
    if (!agentOuvert || !window.matchMedia('(min-width: 640px)').matches) return;
    const minuterie = window.setTimeout(() => {
      const zone = textareaRef.current;
      if (!zone || zone.readOnly || zone.disabled || ecritureGeleeRef.current) return;
      const actif = document.activeElement;
      if (
        actif &&
        actif !== zone &&
        (actif instanceof HTMLInputElement ||
          actif instanceof HTMLTextAreaElement ||
          actif instanceof HTMLSelectElement ||
          (actif as HTMLElement).isContentEditable)
      ) {
        return;
      }
      zone.focus({ preventScroll: true });
    }, 60);
    return () => window.clearTimeout(minuterie);
  }, [agentOuvert]);

  /**
   * UNE RÉÉCRITURE VENUE D'AILLEURS NE DÉPLACE PAS LE CURSEUR. Quand un autre
   * écran change le brouillon ou ses pièces jointes, le navigateur réécrit la
   * valeur du champ et renvoie le curseur À LA FIN. On relève donc la sélection
   * juste avant, et l'effet ci-dessus la repose (bornée au nouveau texte).
   * Appelé dans la fonction de mise à jour de l'état, donc seulement quand la
   * réécriture a vraiment lieu ; tout geste de la personne l'annule.
   */
  const retenirLaSelection = () => {
    const zone = textareaRef.current;
    if (!zone || document.activeElement !== zone) return;
    selectionAGarder.current = { debut: zone.selectionStart, fin: zone.selectionEnd };
  };

  const retientCurseur = () => {
    const node = textareaRef.current;
    if (!node) return;
    selectionAGarder.current = null;
    /* LE CURSEUR N'ENTRE PAS DANS UN TAG. Un clic, un double-clic, une flèche
       ou un glissement de sélection pouvaient le poser AU MILIEU de
       « [fichier: … ] » — la frappe suivante y écrivait, et la pièce jointe
       partait sans bruit. La règle pure le repousse au bord le plus proche, et
       étend une sélection qui n'entamait un tag qu'à moitié. Les positions du
       champ et du texte réel sont les mêmes : le masque a la même longueur que
       le tag qu'il remplace. */
    const hors = curseurHorsDesTags(text, node.selectionStart, node.selectionEnd);
    // Le SENS de la sélection est gardé : sans lui, Maj+flèche repartait du
    // mauvais bout une fois la sélection élargie au tag entier.
    if (hors) node.setSelectionRange(hors.debut, hors.fin, node.selectionDirection);
    const simple = node.selectionStart === node.selectionEnd ? node.selectionStart : null;
    curseur.current = simple;
    // Le menu des commandes « / » suit la place du curseur : elle doit donc
    // vivre en ÉTAT, pas seulement en référence, sinon rien ne se réaffiche.
    setPointeur(simple);
  };

  /**
   * Toute frappe passe par ici : une ancre effacée à la main retire aussitôt
   * sa pièce jointe, sinon le texte et la liste se contrediraient.
   */
  const majTexte = (suite: string) => {
    if (attachments.length) setAttachments((liste) => jointesApresFrappe(liste, text, suite));
    setText(suite);
  };

  /** Écrire l'ancre d'un fichier là où le curseur était posé. */
  const poseAncre = (nom: string) => {
    setText((avant) => {
      const suite = insereAncre(avant, nom, curseur.current);
      curseur.current = suite.curseur;
      curseurAPoser.current = suite.curseur;
      return suite.texte;
    });
  };

  /**
   * Survoler une vignette montre le passage auquel le fichier se rapporte :
   * le texte défile jusqu'à son ancre. Rien n'est modifié, et le curseur
   * n'est pas volé — on ne fait que regarder.
   */
  const montreAncre = (item: Attachment) => {
    const zone = textareaRef.current;
    if (!zone) return;
    // Par le MOTIF du tag, jamais par son texte exact : un brouillon d'avant
    // l'espace insécable porte des espaces ordinaires et désigne le même
    // fichier.
    const tag = ancreDuTexte(text, contenuDuTagDe(text, item), 0);
    if (!tag) return;
    montreLeMorceau(zone, tag.debut, tag.fin);
  };

  /** Retirer un fichier retire aussi son ancre du texte. */
  const retirerJointe = (item: Attachment) => {
    setAttachments((liste) => liste.filter((a) => a.id !== item.id));
    setText((avant) => retireAncre(avant, contenuDuTagDe(avant, item)));
    curseur.current = null;
  };

  /** Retirer le drapeau précis qui a été cliqué, sans toucher aux autres mots. */
  const retirerDrapeau = (nom: string, occurrence: number) => {
    setText((avant) => {
      const suite = retireOccurrence(avant, nom, occurrence);
      setAttachments((liste) => jointesApresFrappe(liste, avant, suite));
      // Le tag retiré laisse un trou : le curseur se pose LÀ, jamais plus loin
      // dans la phrase — sinon la frappe repartait au milieu des mots.
      const place = indexDeLAncre(avant, nom, occurrence);
      curseur.current = place === -1 ? null : place;
      curseurAPoser.current = curseur.current;
      return suite;
    });
    textareaRef.current?.focus();
  };

  /**
   * LE CORPS DE LA PASTILLE EST EN LECTURE SEULE. Un clic dessus ne retire
   * plus rien — il retirait le tag, ce qui rendait le geste dangereux à côté
   * du glisser — et il ne pose pas non plus le curseur dans le texte masqué :
   * l'événement est arrêté ici. Seule la CROIX supprime la pièce jointe.
   *
   * Un glissement, lui, repose le tag ailleurs dans la phrase, sans toucher
   * aux aperçus au-dessus. Le seuil évite qu'un tremblement du doigt soit pris
   * pour un déplacement.
   */
  const poserDrapeau = (event: React.PointerEvent<HTMLElement>, nom: string, occurrence: number) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    origineDrapeau.current = { nom, occurrence, x: event.clientX, y: event.clientY };
    drapeauABouge.current = false;
    viseDrapeau.current = null;
  };

  const viserDrapeau = (zone: HTMLTextAreaElement, x: number, y: number, pointerType: string) => {
    const brut = indexAuPoint(zone, x, y, pointerType === 'touch' ? MARGE_DOIGT : 0);
    if (brut === null) return null;
    // Sur le texte RÉEL, jamais sur ce que le champ affiche : les tags y sont
    // masqués et ne se reconnaîtraient plus. Les deux se lisent aux mêmes
    // index, la position visée reste donc la bonne.
    return accrocheAuMot(text, brut);
  };

  const suivreDrapeau = (event: React.PointerEvent<HTMLElement>) => {
    const origine = origineDrapeau.current;
    if (!origine) return;
    const dx = event.clientX - origine.x;
    const dy = event.clientY - origine.y;
    if (!drapeauABouge.current) {
      if (dx * dx + dy * dy < 36) return;
      drapeauABouge.current = true;
    }
    const x = event.clientX;
    const y = event.clientY;
    const pointerType = event.pointerType;
    if (glisseRaf.current) cancelAnimationFrame(glisseRaf.current);
    glisseRaf.current = requestAnimationFrame(() => {
      const zone = textareaRef.current;
      const vise = zone ? viserDrapeau(zone, x, y, pointerType) : null;
      viseDrapeau.current = vise;
      const trait = zone && vise !== null ? pointDeLIndex(zone, vise) : null;
      setDrapeauGlisse({ nom: origine.nom, x, y, doigt: pointerType === 'touch', trait });
    });
  };

  const lacherDrapeau = (event: React.PointerEvent<HTMLElement>) => {
    if (glisseRaf.current) cancelAnimationFrame(glisseRaf.current);
    glisseRaf.current = 0;
    const origine = origineDrapeau.current;
    origineDrapeau.current = null;
    const aBouge = drapeauABouge.current;
    drapeauABouge.current = false;
    setDrapeauGlisse(null);
    if (!origine) return;
    if (!aBouge) {
      /* UN SIMPLE CLIC NE FAIT RIEN : le tag est en lecture seule, et sa croix
         est la seule zone qui le retire. */
      viseDrapeau.current = null;
      return;
    }
    const zone = textareaRef.current;
    if (!zone) return;
    const vise = viseDrapeau.current ?? viserDrapeau(zone, event.clientX, event.clientY, event.pointerType);
    viseDrapeau.current = null;
    if (vise === null) return;
    setText((avant) => {
      const suite = deplacerAncre(avant, origine.nom, origine.occurrence, vise);
      curseur.current = suite.curseur;
      curseurAPoser.current = suite.curseur;
      return suite.texte;
    });
    zone.focus();
  };

  const annulerDrapeau = () => {
    if (glisseRaf.current) cancelAnimationFrame(glisseRaf.current);
    glisseRaf.current = 0;
    origineDrapeau.current = null;
    drapeauABouge.current = false;
    viseDrapeau.current = null;
    setDrapeauGlisse(null);
  };

  const gestesDrapeau = React.useRef({ poserDrapeau, suivreDrapeau, lacherDrapeau, annulerDrapeau, retirerDrapeau });
  gestesDrapeau.current = { poserDrapeau, suivreDrapeau, lacherDrapeau, annulerDrapeau, retirerDrapeau };

  /*
   * L'overlay (drapeaux fichier) ne se pose QUE s'il y a vraiment un tag :
   * sinon il se posait sur tout texte non vide, rendant le vrai champ
   * transparent et sa sélection à la souris invisible — noyée sous le calque.
   */
  const aDesDrapeaux = React.useMemo(() => {
    MARQUE_FICHIER.lastIndex = 0;
    return MARQUE_FICHIER.test(text);
  }, [text]);

  /*
   * LE CALQUE SE CALE SUR LE CHAMP, IL NE LE DEVINE PAS. Ses styles sont
   * RECOPIÉS du champ (police, hauteur de ligne, marges intérieures) au lieu
   * d'être redits en classes : un seul réglage qui diffère — la hauteur de
   * ligne, par exemple — et les lignes du calque tombent à côté des vraies,
   * d'où le texte décalé, la ligne vide en trop et le curseur ailleurs qu'où
   * il paraît. La FENÊTRE, elle, dit la part visible du champ : le calque ne
   * couvre que celle-là, jamais la rangée de boutons qui suit le champ.
   */
  const [calage, setCalage] = React.useState<{
    style: React.CSSProperties;
    fenetre: { top: number; left: number; width: number; height: number };
  }>({ style: {}, fenetre: { top: 0, left: 0, width: 0, height: 0 } });
  React.useLayoutEffect(() => {
    const zone = textareaRef.current;
    if (!zone || !aDesDrapeaux) return;
    const mesurer = () => {
      const releve = reglagesDuChamp(zone);
      setCalage((avant) => {
        const memeFenetre = (Object.keys(releve.fenetre) as (keyof typeof releve.fenetre)[]).every(
          (cle) => avant.fenetre[cle] === releve.fenetre[cle],
        );
        const memeStyle = Object.keys(releve.style).every(
          (cle) => (avant.style as Record<string, string>)[cle] === releve.style[cle],
        );
        return memeFenetre && memeStyle ? avant : { style: releve.style as React.CSSProperties, fenetre: releve.fenetre };
      });
    };
    mesurer();
    const observateur = new ResizeObserver(mesurer);
    observateur.observe(zone);
    return () => observateur.disconnect();
  }, [aDesDrapeaux, text]);

  const texteAvecDrapeaux = React.useMemo(() => {
    if (!aDesDrapeaux) return [];
    const morceaux: React.ReactNode[] = [];
    const vus: Record<string, number> = {};
    let fin = 0;
    for (const tag of masquesDuTexte(texteDuChamp, attachments)) {
      if (tag.debut > fin)
        morceaux.push(<React.Fragment key={`texte-${fin}`}>{texteDuChamp.slice(fin, tag.debut)}</React.Fragment>);
      const nom = tag.nom;
      const position = vus[nom] ?? 0;
      vus[nom] = position + 1;
      const brut = tag.brut;
      morceaux.push(
        <span
          key={`fichier-${tag.debut}`}
          role="button"
          data-prompt-file-flag
          title={t('Glisser pour déplacer, croix pour retirer')}
          aria-readonly="true"
          data-prompt-file-lecture-seule="oui"
          onPointerDown={(event) => gestesDrapeau.current.poserDrapeau(event, nom, position)}
          onPointerMove={(event) => gestesDrapeau.current.suivreDrapeau(event)}
          onPointerUp={(event) => gestesDrapeau.current.lacherDrapeau(event)}
          onPointerCancel={() => gestesDrapeau.current.annulerDrapeau()}
          className="group pointer-events-auto relative cursor-grab touch-none align-baseline text-accent active:cursor-grabbing"
        >
          {/* LE TEXTE MASQUÉ GARDE SA PLACE, IL NE SE VOIT PLUS. La largeur du
              tag reste EXACTEMENT celle des caractères réellement écrits dans
              le champ — c'est elle qui décide des retours à la ligne et de
              l'endroit du curseur, qu'aucun habillage ne doit déplacer. Ces
              caractères-là sont désormais ceux du MASQUE (`tagsMasques`) : le
              nom du fichier, plus la place du trombone et de la croix. Le tag
              fait donc la largeur d'un mot, et non celle de sa syntaxe. Ils
              sont seulement rendus invisibles ; la pastille est dessinée
              par-dessus, HORS FLUX, donc elle ne prend aucune place. Le texte
              masqué réapparaît si le tag venait à être coupé en fin de ligne
              (`data-tag="coupe"`), cas où un dessin posé par-dessus tomberait
              à côté — le nom du fichier y reste lisible. */}
          <span className="invisible rounded-[3px] group-data-[tag=coupe]:visible group-data-[tag=coupe]:bg-accent/20 group-data-[tag=coupe]:ring-1 group-data-[tag=coupe]:ring-inset group-data-[tag=coupe]:ring-accent/40 [box-decoration-break:clone] [-webkit-box-decoration-break:clone]">
            {brut}
          </span>
          {/* LA PASTILLE DESSINÉE : trombone, nom, croix. Elle est CENTRÉE
              dans la largeur du texte masqué, calculé pour rester un peu plus
              large qu'elle : le nom occupe une pleine largeur de caractère
              dans le champ contre 0,82 em dans la pastille, et trois cadratins
              couvrent le trombone, la croix et les marges. La croix ne touche
              donc jamais le mot qui suit, même quand aucun espace ne sépare le
              tag du texte. Sa hauteur ne DÉPASSE PAS celle des caractères
              recouverts : plus haute, elle mordrait sur la ligne voisine et
              volerait le clic qui vise le champ.

              SON TEXTE EST PLUS PETIT QUE CELUI DU CHAMP (0,82 em) : à taille
              égale, le nom remplissait la pastille bord à bord, sans un pixel
              d'air, et pesait autant qu'une phrase écrite. Le reste des
              mesures est donné en em DE LA PASTILLE, donc réduit d'autant :
              c'est ce qui dégage la marge intérieure et l'écart avec le texte
              voisin, sans jamais élargir le dessin au-delà des caractères
              recouverts. La hauteur, elle, reste sous celle des caractères
              recouverts (1,35 × 0,82 ≈ 1,1 em du champ).

              LE DÉCALAGE VERTICAL DE 0,24 em (`translate-y-[calc(-50%+0.24em)]`,
              au lieu d'un simple -50 %) N'EST PAS COSMÉTIQUE : le texte masqué
              qui sert de repère de centrage occupe seulement sa propre boîte de
              caractères (~1,1 em), collée au HAUT de la ligne, alors que la
              ligne elle-même est plus haute (interligne 1,5 hérité de la page).
              Centrer la pastille sur -50 % pur la collait donc au ras du haut de
              la ligne, avec tout l'espace en trop RENVOYÉ EN DESSOUS. Ce
              correctif la recentre sur la ligne réelle plutôt que sur le texte
              masqué. */}
          {/* L'ÉTIQUETTE EST L'IDENTIFIANT COURT (« #1a0c »), celui que cite le
              plan — et c'est le SEUL nom affiché : le nom d'origine ne paraît
              plus nulle part, pas même au survol.

              LA PASTILLE N'EST PLUS ÉTIRÉE. Elle portait un `min-w` égal à la
              largeur du texte masqué — celle du NOM D'ORIGINE — et son
              `justify-between` poussait alors la croix tout à droite : d'où la
              zone vide entre l'étiquette et la croix, sur chaque tag. Le masque
              réserve désormais la place de l'étiquette COURTE
              (`contenuDuMasque`, shared/src/ancres.ts) : la pastille reprend sa
              largeur naturelle, et les trois éléments se touchent. */}
          <span
            data-prompt-file-pastille
            data-prompt-file-etiquette={etiquetteDuTag(nom, attachments)}
            className="absolute left-1/2 top-1/2 inline-flex h-[1.35em] max-w-full -translate-x-1/2 translate-y-[calc(-50%+0.24em)] items-center gap-[0.35em] overflow-hidden whitespace-nowrap rounded-[0.5em] bg-accent/20 px-[0.55em] text-[0.82em] font-medium leading-none ring-1 ring-inset ring-accent/40 group-hover:bg-accent/30 group-data-[tag=coupe]:hidden"
          >
            <Paperclip aria-hidden="true" className="h-[0.95em] w-[0.95em] shrink-0" />
            <span className="min-w-0 truncate">{etiquetteDuTag(nom, attachments)}</span>
            <span
              role="button"
              data-prompt-file-close
              title={t('Retirer ce fichier')}
              onPointerDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                gestesDrapeau.current.retirerDrapeau(nom, position);
              }}
              className="shrink-0 cursor-pointer opacity-70 transition-opacity hover:text-danger hover:opacity-100"
            >
              <X aria-hidden="true" className="h-[0.95em] w-[0.95em]" />
            </span>
          </span>
        </span>,
      );
      fin = tag.fin;
    }
    if (fin < texteDuChamp.length)
      morceaux.push(<React.Fragment key={`texte-${fin}`}>{texteDuChamp.slice(fin)}</React.Fragment>);
    return morceaux;
  }, [texteDuChamp, attachments]);

  /*
   * UN TAG COUPÉ EN FIN DE LIGNE REVIENT AU TEXTE BRUT. La pastille est
   * dessinée par-dessus le tag, hors flux : elle suppose donc que le tag tient
   * sur UNE seule ligne. Quand le champ est étroit, le texte peut se couper à
   * l'espace de « [fichier: nom] » — le tag occupe alors deux rectangles et un
   * dessin posé par-dessus tomberait à cheval entre les deux. On le repère
   * après le rendu (`getClientRects`) et on rend la main au texte brut, coloré
   * comme avant. La mise en page du champ, elle, n'est jamais touchée : rien
   * ici ne change la largeur d'un caractère.
   */
  const calqueRef = React.useRef<HTMLDivElement | null>(null);
  const texteCalqueRef = React.useRef<HTMLDivElement | null>(null);
  React.useLayoutEffect(() => {
    const calque = texteCalqueRef.current;
    if (!calque || !aDesDrapeaux) return;
    const marquer = () => {
      for (const drapeau of Array.from(calque.querySelectorAll<HTMLElement>('[data-prompt-file-flag]'))) {
        if (drapeau.getClientRects().length > 1) drapeau.dataset.tag = 'coupe';
        else delete drapeau.dataset.tag;
      }
    };
    marquer();
    const observateur = new ResizeObserver(marquer);
    observateur.observe(calque);
    return () => observateur.disconnect();
  }, [aDesDrapeaux, texteAvecDrapeaux, calage]);

  // La dictée dépose son texte à la suite de ce qui est déjà écrit.
  const recorder = useRecorder((dicte) => setText((current) => (current ? `${current} ${dicte}` : dicte)));

  /*
   * UN TEXTE DÉPOSÉ DEPUIS LE FIL (refus d'un plan, suggestion d'optimisation)
   * s'écrit ICI et s'arrête là : aucun envoi, aucun tour lancé. Il s'AJOUTE à
   * ce qui était en train d'être écrit — on ne perd pas une phrase en cours
   * pour un clic — et le champ prend le curseur, à la fin du texte, pour que la
   * frappe reprenne au bon endroit.
   */
  const dernierDepot = React.useRef<number>(0);
  React.useEffect(() => {
    if (!aEcrire || aEcrire.nonce === dernierDepot.current) return;
    dernierDepot.current = aEcrire.nonce;
    /* Un dépôt peut porter PLUSIEURS lignes d'un coup (« tout cocher ») :
       chacune s'ajoute — ou se reprend — séparément, sinon le bloc entier
       compterait pour une seule ligne et ne se retrouverait jamais. */
    const lignes = aEcrire.texte.split('\n').filter((ligne) => ligne.trim());
    const retirer = aEcrire.retirer === true;
    setText((avant) =>
      lignes.reduce(
        (texte, ligne) => (retirer ? texteApresRetrait(texte, ligne) : texteApresInsertion(texte, ligne)),
        avant,
      ),
    );
    if (retirer) return;
    const zone = textareaRef.current;
    if (!zone) return;
    window.requestAnimationFrame(() => {
      zone.focus();
      zone.setSelectionRange(zone.value.length, zone.value.length);
      zone.scrollTop = zone.scrollHeight;
    });
  }, [aEcrire]);

  /*
   * Brouillon conservé par conversation, côté serveur : on le retrouve depuis
   * n'importe quel écran. Ce qui est écrit ne s'efface QUE sur un geste de
   * l'utilisateur (envoi ou effacement) : ni un agent qui disparaît un instant,
   * ni une reconnexion, ni un changement d'onglet n'y touchent.
   */
  const agentId = agent?.id;
  const cleBrouillon = agentId ? `draft.${agentId}` : 'draft.aucun';

  /*
   * LA FILE RENDUE PAR « SUSPENDRE » revient ICI, à la suite de ce qui est
   * déjà écrit (`brouillonApresSuspension`) — rien n'est envoyé. Le champ se
   * déclare monté : le geste sait alors qu'il ne doit PAS passer par le
   * brouillon retenu, qui ignore encore la frappe des 600 dernières ms.
   */
  useChampMonte(agentId);
  React.useEffect(() => {
    if (!agentId) return;
    const recevoir = (event: Event) => {
      const detail = (event as CustomEvent<DetailFileRendue>).detail;
      if (!detail || detail.agentId !== agentId) return;
      setText((avant) => brouillonApresSuspension(avant, detail.textes));
      const zone = textareaRef.current;
      if (!zone) return;
      window.requestAnimationFrame(() => {
        zone.focus();
        zone.setSelectionRange(zone.value.length, zone.value.length);
        zone.scrollTop = zone.scrollHeight;
      });
    };
    window.addEventListener(EVENEMENT_FILE_RENDUE, recevoir);
    return () => window.removeEventListener(EVENEMENT_FILE_RENDUE, recevoir);
  }, [agentId]);
  const [draft] = usePref<string>(cleBrouillon, '');
  const chargePour = React.useRef<string | undefined>(undefined);
  const premierPassage = React.useRef(true);
  /** Le dernier texte parti : il ne doit JAMAIS revenir tout seul dans le champ. */
  const dejaEnvoye = React.useRef<string | null>(null);
  /**
   * Le dernier brouillon reçu du serveur (ce que CE champ reflète tant que
   * la personne n'a rien tapé de différent). Sert à distinguer, quand le
   * brouillon change à distance, « je n'ai pas touché au champ, je peux le
   * suivre » de « j'ai écrit autre chose, on ne touche à rien » — y compris
   * quand il redevient vide parce qu'un AUTRE écran vient d'envoyer.
   */
  const dernierBrouillonDistant = React.useRef<string>('');
  /**
   * LE TEXTE ÉCRIT ICI ET PAS ENCORE CONFIRMÉ PAR LE SERVEUR. Tant qu'il existe,
   * un brouillon venu du serveur ne le remplace JAMAIS : au retour du lien, le
   * serveur renvoie son ANCIEN brouillon (la coupure a empêché le nouveau
   * d'arriver), et le champ — qui ne reflétait plus que le texte posé en local —
   * se vidait ou reculait. Le texte reste, et repart seul au retour du lien.
   */
  const brouillonNonConfirme = React.useRef<{ key: string; value: string } | null>(null);

  React.useEffect(() => {
    // Agent absent l'espace d'un instant : on ne touche surtout à rien.
    if (!agentId) return;

    if (chargePour.current !== agentId) {
      // Vraie ouverture d'une autre conversation : on affiche SON brouillon.
      chargePour.current = agentId;
      premierPassage.current = true;
      dernierBrouillonDistant.current = draft;
      dejaEnvoye.current = null;
      // Le message qu'on modifiait appartenait à la conversation d'avant : son
      // brouillon mis de côté y est resté intact, rien n'en est écrit ici.
      setEdition(null);
      /* LA COPIE LOCALE SE RETIRE À L'ACCUSÉ DU SERVEUR : si elle existe encore,
         c'est un texte que le serveur n'a jamais reçu, donc plus récent que son
         brouillon. Elle passe devant ; la sauvegarde ci-dessous la renvoie. */
      let copie = '';
      try {
        copie = window.localStorage.getItem(PREFIXE_COPIE_BROUILLON + cleBrouillon) ?? '';
      } catch {
        /* pas de copie locale */
      }
      setText(copie || draft);
      // Dit tout de suite à ce qui entoure le champ : si ce brouillon est mot
      // pour mot le texte déjà en place, aucun nouveau rendu ne le redirait.
      champ?.ecrire(copie || draft);
      return;
    }

    if (draft === dernierBrouillonDistant.current) return;
    const brouillonPrecedent = dernierBrouillonDistant.current;
    dernierBrouillonDistant.current = draft;
    // L'écho tardif de notre propre envoi : déjà traité localement.
    if (draft === dejaEnvoye.current) return;
    // Le champ ne suit QUE s'il reflétait encore l'ancien brouillon : une
    // personne qui a déjà écrit autre chose n'est jamais recouverte — mais un
    // envoi fait ailleurs (le brouillon redevient vide) vide bien SON champ.
    setText((current) => {
      if (current !== brouillonPrecedent || current === draft) return current;
      // Un texte pas encore confirmé ne cède devant aucun brouillon du serveur.
      if (brouillonNonConfirme.current) return current;
      retenirLaSelection();
      return draft;
    });
  }, [agentId, draft]);

  /**
   * L'ENVOI DU BROUILLON EST CONFIRMÉ, JAMAIS PRÉSUMÉ. Le serveur accuse
   * réception (`client.call`), l'envoi est retenté deux fois, et un échec
   * définitif se dit à l'écran — le texte reste dans le champ et dans la copie
   * locale. Le même envoi part à la fermeture du volet et au démontage, sans
   * attendre la temporisation de 600 ms.
   */
  const brouillonEnAttente = React.useRef<{ key: string; value: string } | null>(null);
  const envoyerLeBrouillon = React.useCallback(async () => {
    const attente = brouillonEnAttente.current;
    if (!attente) return;
    brouillonEnAttente.current = null;
    brouillonNonConfirme.current = attente;
    client.setPrefLocally(attente.key, attente.value);
    for (let essai = 0; essai < 3; essai += 1) {
      try {
        await client.call({ type: 'prefs.set', key: attente.key, value: attente.value });
        if (brouillonNonConfirme.current === attente) brouillonNonConfirme.current = null;
        try {
          if (window.localStorage.getItem(PREFIXE_COPIE_BROUILLON + attente.key) === attente.value) {
            window.localStorage.removeItem(PREFIXE_COPIE_BROUILLON + attente.key);
          }
        } catch {
          /* rien à nettoyer */
        }
        return;
      } catch {
        await new Promise((r) => window.setTimeout(r, 800 * (essai + 1)));
        // Un texte plus récent est parti (ou le message est envoyé) : ne jamais
        // rejouer celui-ci par-dessus.
        if (brouillonNonConfirme.current !== attente) return;
      }
    }
    // Le lien est coupé : le message de coupure le dit déjà, et le texte repart
    // seul à son retour (effet ci-dessous). Une vraie panne de sauvegarde se dit.
    if (!lienGeleRef.current) {
      client.pushToast('error', t("Le brouillon n'a pas pu être sauvegardé. Votre texte reste dans le champ."));
    }
  }, []);
  /* AU RETOUR DU LIEN, CE QUI N'A PAS PU PARTIR PART TOUT SEUL. */
  React.useEffect(() => {
    if (canal.gele) return;
    const reste = brouillonNonConfirme.current;
    if (!reste || brouillonEnAttente.current) return;
    brouillonEnAttente.current = reste;
    void envoyerLeBrouillon();
  }, [canal.gele, envoyerLeBrouillon]);
  React.useEffect(() => {
    const vider = () => void envoyerLeBrouillon();
    window.addEventListener('beluga:vider-brouillon', vider);
    window.addEventListener('pagehide', vider);
    return () => {
      window.removeEventListener('beluga:vider-brouillon', vider);
      window.removeEventListener('pagehide', vider);
      void envoyerLeBrouillon();
    };
  }, [envoyerLeBrouillon]);

  React.useEffect(() => {
    if (!agentId || chargePour.current !== agentId) return;
    // Le premier passage est l'affichage du brouillon, pas une saisie.
    if (premierPassage.current) {
      premierPassage.current = false;
      return;
    }
    // Pendant la modification d'un message en attente, le brouillon garde ce
    // qui a été mis de côté : il ne prend pas la place du texte modifié.
    if (edition) return;
    // Dès que la personne écrit à nouveau, l'ancien envoi cesse d'être une
    // référence : c'est un texte neuf.
    if (text) dejaEnvoye.current = null;
    /*
     * UN TEXTE SEULEMENT LU NE SE RÉÉCRIT PAS — la même règle que pour les
     * pièces jointes, plus bas. Le drapeau `premierPassage` est consommé au
     * montage, avant que le brouillon chargé n'entre dans l'état : ouvrir une
     * conversation renvoyait donc son brouillon au serveur 600 ms plus tard,
     * tel que lu, et un écran à la copie périmée pouvait reposer un texte déjà
     * parti. Le serveur a déjà ce texte : rien ne part, et rien d'ancien ne
     * reste à vider plus tard (au démontage, à la fermeture de la page).
     */
    if (text === dernierBrouillonDistant.current) {
      brouillonEnAttente.current = null;
      try {
        window.localStorage.removeItem(PREFIXE_COPIE_BROUILLON + cleBrouillon);
      } catch {
        /* rien à nettoyer */
      }
      return;
    }
    /*
     * LA FRAPPE NE TRAVERSE PLUS LE MAGASIN GÉNÉRAL À CHAQUE TOUCHE.
     *
     * `setPrefLocally` écrit dans l'état PARTAGÉ de l'application : chaque
     * lettre tapée refaisait donc l'affichage de TOUTE l'application — le
     * tableau et ses cartes, la colonne de gauche, la conversation. C'est ce qui
     * faisait apparaître la frappe au ralenti. Le champ, lui, n'a jamais eu
     * besoin de ce détour : il tient déjà son propre texte.
     *
     * Le brouillon reste retenu — c'est la même temporisation de 600 ms qui
     * pose la copie locale ET l'envoi au serveur, une fois la frappe reposée.
     */
    brouillonEnAttente.current = { key: cleBrouillon, value: text };
    // Copie locale immédiate : elle ne s'efface qu'à l'accusé du serveur.
    try {
      window.localStorage.setItem(PREFIXE_COPIE_BROUILLON + cleBrouillon, text);
    } catch {
      /* stockage plein ou refusé : le serveur reste la référence */
    }
    const timer = window.setTimeout(() => void envoyerLeBrouillon(), 600);
    return () => window.clearTimeout(timer);
  }, [text, agentId, cleBrouillon]);

  /*
   * CE QUE LE CHAMP CONTIENT SE LIT AUSSI AUTOUR DE LUI : les idées à cocher
   * d'un compte rendu y trouvent leur case (`champ`). Le texte y est déposé
   * AVANT la peinture, pour que la case bascule dans la même image que la
   * ligne écrite ou effacée. Tant que le brouillon de CETTE conversation n'est
   * pas chargé, rien n'est déposé : le texte en place est encore celui d'avant.
   */
  React.useLayoutEffect(() => {
    if (!champ || !agentId || chargePour.current !== agentId) return;
    champ.ecrire(text);
  }, [champ, text, agentId]);
  // Le champ disparaît, ou passe à une autre conversation : plus rien n'y est écrit.
  React.useEffect(() => () => champ?.ecrire(''), [champ, agentId]);

  /*
   * LES FICHIERS JOINTS SUIVENT LA MÊME CONVERSATION QUE LE BROUILLON, PAS
   * L'APPLICATION. Sans ceci, `attachments` restait un état local de ce
   * composant : changer de projet ou d'agent gardait les pièces jointes
   * préparées pour l'agent précédent, avec le risque de les envoyer au
   * mauvais destinataire. Même mécanique que le brouillon — retenu côté
   * serveur, par conversation — pour qu'on les retrouve depuis n'importe
   * quel écran, et jamais depuis une autre.
   */
  const cleJointes = agentId ? `draftAttachments.${agentId}` : 'draftAttachments.aucun';
  const [jointesEnregistrees, setJointesEnregistrees] = usePref<Attachment[]>(cleJointes, []);
  const jointesChargeesPour = React.useRef<string | undefined>(undefined);
  const jointesIgnorerProchaineSauvegarde = React.useRef(true);
  /**
   * Les dernières pièces jointes reçues du serveur — même logique que
   * `dernierBrouillonDistant` : on ne suit un changement à distance que si
   * rien n'a divergé localement depuis, et ça vaut AUSSI quand la liste
   * redevient vide parce qu'un autre écran vient d'envoyer.
   */
  const dernieresJointesDistantes = React.useRef<Attachment[]>([]);
  const memeJointes = (a: Attachment[], b: Attachment[]) =>
    a.length === b.length && a.every((jointe, index) => jointe.id === b[index]?.id);

  React.useEffect(() => {
    if (!agentId) return;

    if (jointesChargeesPour.current !== agentId) {
      // Vraie ouverture d'une autre conversation : on affiche SES pièces jointes.
      jointesChargeesPour.current = agentId;
      dernieresJointesDistantes.current = jointesEnregistrees;
      jointesIgnorerProchaineSauvegarde.current = true;
      setJointesDuBrouillon(jointesEnregistrees);
      return;
    }

    if (memeJointes(jointesEnregistrees, dernieresJointesDistantes.current)) return;
    const jointesPrecedentes = dernieresJointesDistantes.current;
    dernieresJointesDistantes.current = jointesEnregistrees;
    setJointesDuBrouillon((current) => {
      /* Le champ a divergé (une pièce ajoutée ici n'est pas encore partie) : on
         garde la sienne, ET sa sauvegarde n'est pas sautée — sinon la pièce
         ajoutée ici n'atteignait jamais le serveur, ni l'autre appareil. */
      if (!memeJointes(current, jointesPrecedentes)) return current;
      // Seule une liste réellement reprise d'ailleurs n'est pas renvoyée au serveur.
      jointesIgnorerProchaineSauvegarde.current = !memeJointes(current, jointesEnregistrees);
      // L'étiquette d'un tag dépend des pièces connues : le champ peut être réécrit
      // — sauf pendant une modification, où il montre les pièces du message.
      if (!editionCourante.current) retenirLaSelection();
      return jointesEnregistrees;
    });
  }, [agentId, jointesEnregistrees]);

  /* Seules les pièces DU BROUILLON sont retenues : celles d'un message en
     attente qu'on modifie vivent dans la file, et n'y entrent jamais. */
  React.useEffect(() => {
    if (!agentId || jointesChargeesPour.current !== agentId) return;
    // Le premier passage est l'affichage des pièces déjà retenues, pas un ajout.
    if (jointesIgnorerProchaineSauvegarde.current) {
      jointesIgnorerProchaineSauvegarde.current = false;
      return;
    }
    /*
     * UNE LISTE SEULEMENT LUE NE SE RÉÉCRIT PAS. Le drapeau ci-dessus est
     * consommé dès le montage, AVANT que la liste reprise du serveur n'arrive
     * dans l'état : ouvrir une conversation réécrivait donc son brouillon
     * 600 ms plus tard, tel que lu. Sans effet quand rien n'a bougé — mais un
     * écran qui se réveille avec une vieille copie des réglages (un second
     * onglet, le téléphone) reposait ainsi des pièces DÉJÀ PARTIES avec un
     * message envoyé d'ailleurs, et tous les écrans les reprenaient : on les
     * voyait « toujours là » au-dessus du champ, et elles repartaient avec le
     * message suivant. Seule une liste que CE champ a changée (ajout, retrait,
     * ordre) part donc au serveur.
     */
    if (memeJointes(jointesDuBrouillon, dernieresJointesDistantes.current)) return;
    const timer = window.setTimeout(() => setJointesEnregistrees(jointesDuBrouillon), 600);
    return () => window.clearTimeout(timer);
  }, [jointesDuBrouillon, agentId]);

  /*
   * SUR TÉLÉPHONE, UN CHAMP REMPLI QU'ON NE TOUCHE PAS SE REPLIE sur une ligne
   * (demande du 14/10/2026) : un long brouillon prenait le tiers de l'écran
   * pendant qu'on lisait la conversation. Il se rouvre à sa hauteur dès qu'on
   * appuie dedans. Sur ordinateur, rien ne change.
   */
  const telephone = useTelephone();
  const [champFocalise, setChampFocalise] = React.useState(false);
  const champReplie = telephone && !champFocalise && text.trim().length > 0;
  React.useEffect(() => {
    const node = textareaRef.current;
    if (!node) return;
    if (champReplie) {
      /* UNE ligne exactement. La marge du bas tombe : le texte suivant s'y
         dessinait, et le haut de la deuxième ligne dépassait sous la première. */
      node.style.paddingBottom = '0px';
      node.style.minHeight = '0px';
      const style = window.getComputedStyle(node);
      const ligne = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.5 || 22;
      node.style.height = `${Math.ceil(ligne + parseFloat(style.paddingTop || '0'))}px`;
      node.scrollTop = 0;
      return;
    }
    node.style.paddingBottom = '';
    node.style.minHeight = '';
    node.style.height = 'auto';
    node.style.height = `${Math.min(node.scrollHeight, 180)}px`;
  }, [text, champReplie]);

  /* ------------------------------------------------------------------ */
  /* LES COMMANDES « / » DU MOTEUR SÉLECTIONNÉ                            */
  /* ------------------------------------------------------------------ */

  /*
   * Le menu s'ouvre sur ce que la personne TAPE : il faut donc suivre la place
   * du curseur en état, pas seulement en référence — une référence ne fait
   * rien réafficher. `null` = pas de curseur simple (sélection, champ quitté),
   * et le menu reste alors fermé.
   */
  const [pointeur, setPointeur] = React.useState<number | null>(null);
  const [slashVise, setSlashVise] = React.useState(0);
  /* Échappement : le menu se ferme pour CE mot-là, et rouvre au suivant. */
  const [slashFerme, setSlashFerme] = React.useState<string | null>(null);

  const moteurChoisi = resoudreRun(engines, agent?.run).engine;
  const zoneSlash = pointeur === null ? null : slashEnCours(text, pointeur);
  const relevees = moteurChoisi ? state.slash[projectId]?.[moteurChoisi.id] : undefined;
  const commandesDuChamp = React.useMemo(
    () => commandesDuMoteur(moteurChoisi?.id, relevees),
    [moteurChoisi?.id, relevees],
  );
  const commandesVisibles = React.useMemo(
    () => (zoneSlash ? filtrerCommandes(commandesDuChamp, zoneSlash.mot) : []),
    [commandesDuChamp, zoneSlash?.mot],
  );
  const slashOuvert = !!zoneSlash && slashFerme !== zoneSlash.mot;

  /* Le relevé du disque ne se demande qu'à la première ouverture du menu :
     tant que personne ne tape « / », rien ne voyage. */
  React.useEffect(() => {
    if (!slashOuvert || !projectId) return;
    if (state.slash[projectId]) return;
    client.send({ type: 'slash.list', projectId });
  }, [slashOuvert, projectId, state.slash]);

  /* La ligne visée repart du haut dès que la liste change. */
  React.useEffect(() => setSlashVise(0), [zoneSlash?.mot, moteurChoisi?.id]);

  /** Écrire la commande choisie à la place du « /mot » en train d'être tapé. */
  const choisirCommande = (nom: string) => {
    if (!zoneSlash) return;
    const suite = insereCommande(text, zoneSlash, nom);
    majTexte(suite.texte);
    curseur.current = suite.curseur;
    curseurAPoser.current = suite.curseur;
    setPointeur(suite.curseur);
    setSlashFerme(null);
  };

  /** La commande que le message porte déjà, telle qu'elle partira au moteur. */
  const commandeEcrite = commandeDuMessage(text);

  /**
   * Joindre des fichiers. Chaque nouveau fichier écrit son ancre dans le
   * texte : à l'endroit du curseur s'il y en avait un, à la fin sinon.
   */
  const upload = async (files: FileList | File[], aLaFin = false) => {
    // Pendant une coupure le champ est verrouillé, fichiers compris : un dépôt ou
    // un collage n'enverrait rien de sûr, et le message de coupure le dit déjà.
    if (ecritureGeleeRef.current) return;
    if (aLaFin) curseur.current = null;
    const cleAgent = agentId ?? 'aucun';
    const url = `/api/upload?project=${encodeURIComponent(projectId)}${agent ? `&agent=${agent.id}` : ''}${
      agent?.cardId ? `&card=${agent.cardId}` : ''
    }`;
    // Tous les fichiers partent ensemble, chacun avec sa barre et sa croix.
    await Promise.all(
      Array.from(files).map(async (file) => {
        const cle = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        let envoi = envoyerFichier(url, file, (part, octets) => majEnvoi(cleAgent, cle, { part, octets }));
        ajouterEnvoi(cleAgent, {
          cle,
          nom: file.name,
          taille: file.size,
          part: 0,
          octets: 0,
          // La croix vise l'essai EN COURS, pas le premier.
          annuler: () => envoi.annuler(),
        });
        try {
          /* UN ENVOI COUPÉ, OU RESTÉ SANS RÉPONSE, REPREND AU RETOUR DU LIEN
             (jusqu'à trois essais). Un fichier ne reste plus bloqué sur
             « Enregistrement… » parce que le serveur s'est figé un instant. */
          let jointe: Attachment | undefined;
          for (let essai = 0; !jointe; essai += 1) {
            try {
              jointe = await envoi.promesse;
            } catch (err) {
              if (!(err instanceof EnvoiInterrompu) || essai >= 2) throw err;
              await attendreLeLien(() => lienGeleRef.current);
              majEnvoi(cleAgent, cle, { part: 0, octets: 0 });
              envoi = envoyerFichier(url, file, (part, octets) => majEnvoi(cleAgent, cle, { part, octets }));
            }
          }
          /*
           * LA PIÈCE REJOINT LA CONVERSATION D'OÙ ELLE EST PARTIE. Si l'écran
           * a changé de conversation entre-temps, elle s'ajoute au brouillon
           * enregistré de la première, sans ancre dans un texte qui n'est pas
           * affiché.
           */
          if (agentIdCourant.current !== agentId) {
            const cleBrouillon = `draftAttachments.${cleAgent}`;
            const liste = readPref<Attachment[]>(cleBrouillon, []);
            if (!liste.some((a) => a.id === jointe.id)) writePref(cleBrouillon, [...liste, jointe]);
            return;
          }
          // Le même fichier renvoyé deux fois ne s'ajoute — et ne s'ancre — qu'une fois.
          if (attachmentsCourantes.current.some((a) => a.id === jointe.id)) return;
          attachmentsCourantes.current = [...attachmentsCourantes.current, jointe];
          setAttachments((current) => (current.some((a) => a.id === jointe.id) ? current : [...current, jointe]));
          /* LE TAG PORTE LA DÉSIGNATION (« image.png #f0da »), jamais le nom
             seul : deux images collées s'appellent souvent toutes deux
             « image.png », et un tag qui ne porte que le nom visait la
             première pour les deux. */
          poseAncre(designationDePiece(jointe));
        } catch (err) {
          if (!(err instanceof EnvoiAnnule)) {
            client.pushToast('error', err instanceof Error && err.message ? err.message : t('Envoi du fichier impossible'));
          }
        } finally {
          retirerEnvoi(cleAgent, cle);
        }
      }),
    );
  };

  /**
   * LES TAGS COLLÉS QUE LA PAGE NE CONNAÎT PAS RAMÈNENT LEUR FICHIER.
   *
   * La liste chargée dans la page ne porte que les pièces du projet affiché :
   * un texte copié dans une carte d'un AUTRE projet gardait ses tags, sans un
   * seul fichier au-dessus du champ. Les alias restés sans pièce sont demandés
   * au serveur, qui les rattache à ce projet (recopiés s'ils vivent ailleurs) ;
   * un tag dont la pièce a changé d'alias en chemin est réécrit pour la viser.
   * Rend `true` si au moins une pièce a été retrouvée. Un alias inconnu
   * (fichier retiré) ou un canal coupé laisse le texte tel quel, sans bruit.
   */
  const rattacherLesTagsColles = async (texteColle: string, dejaResolues: Attachment[]): Promise<boolean> => {
    if (!projectId) return false;
    const alias = aliasNonResolus(texteColle, dejaResolues);
    if (!alias.length) return false;
    const agentVise = agentId;
    let pieces: Array<{ alias: string; attachment: Attachment }> = [];
    try {
      ({ pieces } = await client.call<{ pieces: Array<{ alias: string; attachment: Attachment }> }>({
        type: 'attachments.rattacher',
        projectId,
        agentId: agent?.id,
        cardId: agent?.cardId,
        alias,
      }));
    } catch {
      return false;
    }
    if (!pieces.length) return false;
    // L'écran a changé de conversation entre-temps : le texte collé n'y est plus.
    if (agentIdCourant.current !== agentVise) return true;
    const parAlias = new Map(pieces.map((piece) => [piece.alias, piece.attachment]));
    const remplacements = new Map<string, string>();
    for (const nom of nomsDesTags(texteColle)) {
      const ancien = aliasDuTag(nom);
      const piece = ancien ? parAlias.get(ancien) : undefined;
      if (piece && designationDePiece(piece) !== nom) remplacements.set(nom, designationDePiece(piece));
    }
    if (remplacements.size) setText((avant) => tagsRedesignes(avant, remplacements));
    setAttachments((current) => ajouterJointesCollees(current, pieces.map((piece) => piece.attachment)));
    return true;
  };

  /*
   * Modifier un message en attente : il s'ouvre ICI, dans la barre d'écriture,
   * AVEC SES PIÈCES JOINTES — vignettes au-dessus du champ, pastilles dans le
   * texte, comme un brouillon ordinaire. Ce qui était déjà écrit (le texte ET
   * ses pièces) est mis de côté et revient intact une fois la modification
   * enregistrée ou annulée : on ne perd jamais un début de phrase.
   */
  const piecesDuProjet = state.attachments[projectId];
  const ouvrirEnEdition = (item: QueuedPrompt) => {
    const connues = jointesDuMessage(item.attachments, piecesDuProjet ?? []);
    setEdition((courante) => ({
      id: item.id,
      texteAvant: item.text,
      texteMisDeCote: courante?.texteMisDeCote ?? text,
      jointes: connues,
      dOrigine: item.attachments,
      inconnues: item.attachments.filter((id) => !connues.some((piece) => piece.id === id)),
    }));
    setText(item.text);
    // Le curseur retenu visait l'ancien texte : un fichier joint tout de suite irait à la fin.
    curseur.current = null;
    window.setTimeout(() => textareaRef.current?.focus(), 0);
  };

  /*
   * UNE DEMANDE QU'ON MODIFIE NE PART PAS (demande du 12/10/2026). Tant qu'elle
   * est ouverte ici, le serveur la retient en tête de file (et les suivantes
   * derrière elle) ; le repère se redit toutes les deux minutes, et se lève dès
   * que la modification se referme — enregistrée, annulée, ou la conversation
   * quittée —, ce qui relance la file.
   */
  const idEnEdition = edition?.id;
  React.useEffect(() => {
    if (!idEnEdition) return;
    /* Un échec ne se tait plus : le repère est redit dès que possible, et à chaque retour de l'onglet. */
    let relance: number | undefined;
    const signaler = (actif: boolean): Promise<unknown> =>
      client.call({ type: 'queue.edition', id: idEnEdition, actif }).catch(() => {
        if (actif) {
          window.clearTimeout(relance);
          relance = window.setTimeout(() => void signaler(true), 5_000);
        }
      });
    void signaler(true);
    const rafraichir = window.setInterval(() => void signaler(true), EDITION_EN_FILE_RAFRAICHIE_MS);
    const auRetour = () => {
      if (document.visibilityState === 'visible') void signaler(true);
    };
    document.addEventListener('visibilitychange', auRetour);
    // Le canal revient après une coupure : le serveur l'a perdu de vue, on redit le repère.
    let etaitConnecte = client.lireEtat().connected;
    const unsub = client.subscribe(() => {
      const connecte = client.lireEtat().connected;
      if (connecte && !etaitConnecte) void signaler(true);
      etaitConnecte = connecte;
    });
    return () => {
      unsub();
      document.removeEventListener('visibilitychange', auRetour);
      window.clearTimeout(relance);
      window.clearInterval(rafraichir);
      void signaler(false);
    };
  }, [idEnEdition]);

  /*
   * UNE PIÈCE QUE LA PAGE NE SAVAIT PAS NOMMER (liste du projet pas encore
   * arrivée) reste au message quoi qu'il arrive, et prend sa vignette dès que
   * la liste est là. On la demande ; le magasin la diffuse.
   */
  React.useEffect(() => {
    if (!edition?.inconnues.length) return;
    if (!piecesDuProjet) {
      if (projectId) client.send({ type: 'attachments.list', projectId });
      return;
    }
    const retrouvees = jointesDuMessage(edition.inconnues, piecesDuProjet);
    if (!retrouvees.length) return;
    setEdition((courante) => {
      if (!courante || courante.id !== edition.id) return courante;
      // L'étiquette d'un tag dépend des pièces connues : le champ est réécrit,
      // et le curseur de qui tapait déjà ne doit pas filer à la fin.
      retenirLaSelection();
      return {
        ...courante,
        jointes: [...courante.jointes, ...retrouvees.filter((piece) => !courante.jointes.some((a) => a.id === piece.id))],
        inconnues: courante.inconnues.filter((id) => !retrouvees.some((piece) => piece.id === id)),
      };
    });
  }, [edition?.id, edition?.inconnues.length, piecesDuProjet, projectId]);

  /**
   * LA MODIFICATION N'EST ENREGISTRÉE QUE QUAND LE SERVEUR LE DIT. Elle partait
   * sans attendre de réponse, et le champ reprenait le brouillon aussitôt : un
   * canal coupé, ou un message parti chez l'agent entre-temps, effaçait la
   * modification sans un mot. Le champ la garde désormais jusqu'à l'accusé.
   *
   * LE MESSAGE EMPORTE SES PIÈCES TELLES QU'ON LES VOIT : celle dont la pastille
   * a été retirée n'y est plus, celle jointe pendant la modification y entre.
   * Les pièces encore inconnues de la page repartent telles quelles. Le serveur
   * répond par la liste qu'il a RÉELLEMENT gardée ; un serveur d'avant cette
   * règle ne touche pas aux pièces et ne répond rien — le message garde alors
   * celles d'origine, et une pièce jointe ici revient au brouillon au lieu de
   * disparaître. Rend vrai quand la modification est refermée.
   */
  const validationEnVol = React.useRef(false);
  const terminerEdition = async (envoyer: boolean): Promise<boolean> => {
    if (!edition) return true;
    if (envoyer && text.trim()) {
      if (validationEnVol.current) return false;
      validationEnVol.current = true;
      const voulues = [...new Set([...edition.jointes.map((piece) => piece.id), ...edition.inconnues])];
      const texteApres = tagsEnEspacesOrdinaires(text.trim());
      const rendu = await client.geste<{ ok?: boolean; attachments?: string[] }>(
        { type: 'queue.update', id: edition.id, text: texteApres, attachments: voulues },
        t('Modifier'),
      );
      validationEnVol.current = false;
      // Pas d'accusé : `geste` l'a déjà dit, et la modification reste dans le champ.
      if (!rendu) return false;
      if (rendu.ok === false) {
        client.pushToast('warning', t('Ce message est déjà parti : la modification n’a pas pu s’appliquer.'));
        return false;
      }
      onEnvoiModifie?.(edition.texteAvant, texteApres);
      const gardees = rendu.attachments ?? edition.dOrigine;
      const nonPrises = edition.jointes.filter((piece) => !gardees.includes(piece.id));
      if (nonPrises.length) {
        setJointesDuBrouillon((liste) => [...liste, ...nonPrises.filter((piece) => !liste.some((a) => a.id === piece.id))]);
      }
      if (gardees.length !== voulues.length || voulues.some((id) => !gardees.includes(id))) {
        client.pushToast(
          'warning',
          t('Message modifié, mais pas ses fichiers : un fichier retiré part encore avec lui, un fichier ajouté reste joint à ce que vous écrivez.'),
        );
      }
    }
    // Une autre modification a pu s'ouvrir entre-temps : on ne referme que celle-ci.
    if (editionCourante.current?.id !== edition.id) return true;
    setText(edition.texteMisDeCote);
    setEdition(null);
    curseur.current = null;
    return true;
  };

  const submit = async (asProposal = false, accord = false) => {
    /* En cours de modification, le bouton d'envoi enregistre la modification.
       `ok` dit l'issue au bouton : une modification restée dans le champ n'y
       pose pas de coche. */
    if (edition) return { ok: await terminerEdition(true) };

    /*
     * CANAL COUPÉ : ON N'ENVOIE PAS, ET SURTOUT ON NE VIDE PAS LE CHAMP.
     *
     * L'envoi vide le brouillon AVANT la requête (§ plus bas) — c'est juste
     * quand le message part vraiment, et catastrophique quand il ne peut pas
     * partir : le texte disparaissait, et une absence de réponse ne le rendait
     * même pas. Tant que le lien n'est pas rétabli, le geste est refusé net,
     * le brouillon reste intact, et la raison se dit.
     */
    if (canal.gele) {
      client.pushToast('warning', canal.raison ?? t('Le serveur ne répond pas.'));
      return;
    }
    if (enPublication && !edition) {
      client.pushToast('warning', t('Publication en cours — vous pourrez écrire ici dès la fin de la mise en ligne.'));
      return;
    }
    /* AUCUNE CARTE SANS CLIC (MEM-0354) : sous une carte déjà en ligne, l'envoi
       ne part pas, le texte reste dans le champ, et la barre demande l'accord. */
    if (ouvreUneNouvelleCarte && !asProposal && !accord) {
      if (text.trim()) setAccordNouvelleCarte(true);
      return;
    }
    setAccordNouvelleCarte(false);

    /*
     * L'ESPACE INSÉCABLE DES TAGS NE SORT PAS DU CHAMP DE SAISIE. Il n'est là
     * que pour empêcher « [fichier: nom] » de se couper en fin de ligne : le
     * message enregistré, relu et recopié garde des espaces ordinaires.
     */
    /* LES SUGGESTIONS RETENUES SONT DÉJÀ DANS LE CHAMP : un clic les y écrit
       (`aEcrire`), l'utilisateur les complète, et c'est ce texte-là qui part.
       Rien n'est plus recollé au moment de l'envoi — sinon la même phrase
       partirait deux fois. */
    const body = tagsEnEspacesOrdinaires(text.trim());
    if (!body || !agent) return;

    /*
     * Un message parti est parti. On efface le brouillon TOUT DE SUITE, en
     * mémoire et sur le serveur, et on retient le texte envoyé : un écho tardif
     * du serveur ne peut plus le remettre dans le champ. Seule la modification
     * d'un message en attente remet du texte, et c'est un geste volontaire.
     */
    const oublierBrouillon = () => {
      dejaEnvoye.current = text;
      dernierBrouillonDistant.current = '';
      // Ce qui attendait d'être confirmé est parti avec le message : rien à rejouer.
      brouillonNonConfirme.current = null;
      brouillonEnAttente.current = null;
      try {
        window.localStorage.removeItem(PREFIXE_COPIE_BROUILLON + cleBrouillon);
      } catch {
        /* rien à nettoyer */
      }
      client.setPrefLocally(cleBrouillon, '');
      client.send({ type: 'prefs.set', key: cleBrouillon, value: '' });
    };

    if (asProposal && onProposeTask) {
      onProposeTask(body);
      oublierBrouillon();
      setText('');
      return;
    }

    // Gardées pour un éventuel échec : l'envoi les vide tout de suite, mais
    // elles ne doivent pas se perdre pour autant.
    const jointesEnvoyees = jointesDuBrouillon;

    /* L'ÉCRAN BASCULE ICI, AVANT LA REQUÊTE : le parcours s'ouvre au clic,
       avec la bulle de la demande, sans attendre l'écho du serveur. */
    if (!ouvreUneNouvelleCarte) onEnvoiCommence?.(body);
    oublierBrouillon();
    setText('');
    setJointesDuBrouillon([]);
    dernieresJointesDistantes.current = [];
    jointesIgnorerProchaineSauvegarde.current = true;
    setJointesEnregistrees([]);
    curseur.current = null;
    try {
      const reponse = await client.call<{ nouvelleCarteId?: string } | undefined>({
        type: 'agent.prompt',
        agentId: agent.id,
        text: body,
        attachments: jointesEnvoyees.map((a) => a.id),
        ...(ouvreUneNouvelleCarte && accord ? { ouvrirNouvelleCarte: true } : {}),
      });
      if (reponse?.nouvelleCarteId) {
        client.pushToast('success', t('Nouvelle carte créée : votre demande y suit son parcours.'));
        client.openCard(reponse.nouvelleCarteId);
      }
    } catch (err: any) {
      const raison = err?.message ?? t('envoi impossible');
      /*
       * UNE ABSENCE DE RÉPONSE NE DIT PAS QUE L'ENVOI A ÉCHOUÉ. Sur un canal
       * zombie (veille, changement de réseau), le message part bien au
       * serveur — il est enregistré, l'agent se met au travail, et il
       * réapparaît dans le fil dès la reconnexion — mais son accusé de
       * réception s'est perdu en route, et `client.call` finit par expirer
       * (`RAISON_SANS_REPONSE`) largement après coup. Remettre le texte ici
       * réintroduirait dans le champ un message déjà parti et déjà visible
       * dans la conversation. Seule une VRAIE erreur (agent introuvable,
       * refus du serveur) rend le texte et les pièces jointes.
       */
      if (raison === RAISON_SANS_REPONSE) {
        client.signalerRefus(raison);
        return;
      }
      // L'envoi a échoué : là, on rend le texte ET les pièces jointes, sinon
      // elles seraient perdues. L'écho local se retire du même geste, sans
      // quoi le parcours garderait une demande qui n'est jamais partie.
      onEnvoiEchoue?.();
      client.pushToast('error', raison);
      dejaEnvoye.current = null;
      setText(body);
      if (jointesEnvoyees.length) {
        setJointesDuBrouillon(jointesEnvoyees);
        dernieresJointesDistantes.current = jointesEnvoyees;
        jointesIgnorerProchaineSauvegarde.current = true;
        setJointesEnregistrees(jointesEnvoyees);
      }
    }
  };

  /*
   * SUSPENDRE SANS REMONTER EN HAUT DU FIL. Tant que l'agent travaille, la
   * flèche d'envoi devient le bouton « Suspendre » (icône pause), au même
   * endroit et à la même taille. C'est le MÊME geste partout
   * (`useArretAgent`) : même contrôle, même commande `agent.suspend`.
   */
  const arret = useArretAgent({ agent, cardId });
  const boutons = boutonsBarreEcriture({
    occupe: busy,
    arretPossible: arret.possible && !sansArret,
    aDuTexte: !!text.trim(),
    enEdition: !!edition,
  });

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    /*
     * LE MENU DES COMMANDES PREND LE CLAVIER TANT QU'IL EST OUVERT. Les flèches
     * se déplacent dans la liste, Entrée et Tabulation insèrent la commande
     * visée, Échappement referme le menu sans rien écrire — et rend aussitôt
     * les mêmes touches au champ, qui garde donc son comportement habituel.
     */
    if (slashOuvert && !event.nativeEvent.isComposing) {
      if (event.key === 'Escape') {
        event.preventDefault();
        setSlashFerme(zoneSlash!.mot);
        return;
      }
      if (commandesVisibles.length) {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          setSlashVise((rang) => deplacerDansLaListe(rang, commandesVisibles.length, event.key === 'ArrowDown' ? 1 : -1));
          return;
        }
        if ((event.key === 'Enter' && !event.shiftKey) || event.key === 'Tab') {
          event.preventDefault();
          const vise = commandesVisibles[Math.min(slashVise, commandesVisibles.length - 1)];
          if (vise) choisirCommande(vise.nom);
          return;
        }
      }
    }

    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      /*
       * SUR TÉLÉPHONE, LA TOUCHE RETOUR FAIT UN RETOUR À LA LIGNE — L'ENVOI
       * PASSE PAR LE BOUTON, ET PAR LUI SEUL. Le clavier d'un téléphone n'a
       * pas de « Maj+Entrée » : la seule touche disponible envoyait le
       * message, donc écrire un message en plusieurs lignes y était
       * impossible. Au-dessus du seuil téléphone rien ne change : Entrée
       * envoie, Maj+Entrée passe à la ligne.
       */
      if (estTelephone()) return;
      event.preventDefault();
      void submit();
      return;
    }

    /*
     * UN TAG S'EFFACE D'UN BLOC. Sans cela, le retour arrière grignotait
     * « [fichier: capture.png] » lettre par lettre : le tag restait à l'écran,
     * amputé, et sa pièce jointe accrochée à un texte devenu faux. La règle
     * pure (`effacementDeTag`) dit ce qui part ; elle rend `null` quand aucun
     * tag n'est touché, et la touche suit alors son chemin normal — le champ
     * garde ainsi son historique d'annulation partout ailleurs.
     */
    /*
     * LES FLÈCHES FRANCHISSENT UN TAG D'UN SEUL PAS, avec ou sans Maj. Laissé
     * au navigateur, le pas d'un caractère entrait dans le tag, et la garde
     * qui en repousse le curseur le renvoyait au bord de départ : la flèche
     * droite ne faisait plus rien, Maj+flèche revenait en arrière. La règle
     * pure (`pasAuClavier`) rend `null` quand aucun tag n'est touché.
     */
    if (
      (event.key === 'ArrowLeft' || event.key === 'ArrowRight') &&
      !event.nativeEvent.isComposing &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey
    ) {
      const zone = event.currentTarget;
      const pas = pasAuClavier(
        text,
        zone.selectionStart,
        zone.selectionEnd,
        zone.selectionDirection,
        event.key === 'ArrowRight' ? 'droite' : 'gauche',
        event.shiftKey,
      );
      if (!pas) return;
      event.preventDefault();
      zone.setSelectionRange(pas.debut, pas.fin, pas.sens);
      retientCurseur();
      return;
    }

    if (event.key !== 'Backspace' && event.key !== 'Delete') return;
    if (event.nativeEvent.isComposing || event.metaKey || event.ctrlKey || event.altKey) return;
    const zone = event.currentTarget;
    const coupe = effacementDeTag(
      // Le texte RÉEL, pas celui du champ : les tags y sont masqués. Les deux
      // se lisent aux mêmes index, la sélection reste donc valable.
      text,
      zone.selectionStart,
      zone.selectionEnd,
      event.key === 'Backspace' ? 'arriere' : 'avant',
    );
    if (!coupe) return;
    event.preventDefault();
    majTexte(coupe.texte);
    curseur.current = coupe.curseur;
    curseurAPoser.current = coupe.curseur;
  };

  return (
    <div
      // Repère pour les contrôles : plusieurs barres d'écriture coexistent
      // (conversation, tiroir de carte), il faut viser CELLE qu'on voit.
      data-composer
      data-contexte-agent
      data-agent-contexte={agent?.id}
      className={cn(
        'px-4 pt-2',
        fondNoir ? 'bg-bg' : 'bg-surface',
      )}
      /*
       * Le creux du téléphone (barre de gestes) n'est réservé QUE si la barre
       * d'écriture touche vraiment le bas de l'écran. Dans le tiroir d'une
       * carte, des boutons de décision viennent en dessous et réservent déjà
       * cette place : la réserver deux fois creusait un vide sous le composeur.
       */
      style={{ paddingBottom: dansTiroir ? '8px' : 'max(10px, env(safe-area-inset-bottom))' }}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes('Files')) event.preventDefault();
      }}
      onDrop={(event) => {
        const files = Array.from(event.dataTransfer.files);
        if (!files.length) return;
        event.preventDefault();
        // Lâché sur les mots, le fichier s'ancre À CET ENDROIT ; lâché à côté
        // du texte (réglages, pastilles, bord de la barre), il va à la fin.
        const zone = textareaRef.current;
        const surLeTexte = zone && event.target instanceof Node && zone.contains(event.target);
        const vise = surLeTexte ? indexAuPoint(zone, event.clientX, event.clientY) : null;
        if (vise === null) {
          void upload(files, true);
          return;
        }
        curseur.current = vise;
        void upload(files);
      }}
    >
      {/* Le geste principal, en tête de la barre d'écriture et sur toute sa
          largeur : impossible à manquer, et jamais emporté par le fil qui
          défile au-dessus. */}
      {boutonPrincipal ? <div className="mb-2">{boutonPrincipal}</div> : null}

      {/* L'ACCORD AVANT UNE NOUVELLE CARTE : le message attend dans le champ. */}
      {accordNouvelleCarte && ouvreUneNouvelleCarte ? (
        <div data-accord-nouvelle-carte className="mb-1.5 rounded-lg bg-raised px-3 py-2 text-[13px]">
          <p className="text-muted">
            {t('Cette carte est déjà en ligne : votre message ouvrira une nouvelle carte, qui suivra tout le parcours.')}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button variant="default" size="sm" onClick={() => submit(false, true)}>
              {t('Ouvrir une nouvelle carte')}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setAccordNouvelleCarte(false)}>
              {t('Annuler')}
            </Button>
          </div>
        </div>
      ) : null}

      {/* La file d'attente s'empile juste au-dessus de la barre d'écriture */}
      {queue.length ? (
        <div className="mb-1.5 space-y-1">
          {queue.map((item, index) => (
            <QueuedItem
              key={item.id}
              item={item}
              index={index}
              actif={edition?.id === item.id}
              onEdit={() => ouvrirEnEdition(item)}
            />
          ))}
          <p className="px-1 text-[12px] text-faint">
            {queue.length === 1
              ? t('Votre message part dès que l\'agent a fini, ou tout de suite avec la flèche.')
              : t('{v0} messages en attente : ils partiront l\'un après l\'autre, ou tout de suite avec la flèche.', { v0: queue.length })}
          </p>
        </div>
      ) : null}

      {/* LA COUPURE SE DIT AU CHAMP LUI-MÊME : verrouillé, il explique pourquoi,
          et rassure — rien de ce qui est écrit ou joint n'est perdu. */}
      {ecritureGelee ? (
        <p data-ecriture-gelee className="mb-1.5 px-1 text-[12.5px] text-muted">
          {t('Écriture suspendue : le serveur ne répond pas. Votre texte et vos fichiers sont conservés, le champ se rouvre dès le retour du lien.')}
        </p>
      ) : null}

      {/* LES ENVOIS EN COURS : une ligne par fichier, sa vraie progression, sa croix. */}
      {envois.length ? (
        <div className="mb-1.5 space-y-1" data-envois-en-cours>
          {envois.map((envoi) => (
            <LigneEnvoi key={envoi.cle} envoi={envoi} />
          ))}
        </div>
      ) : null}

      {/* PLUS AUCUNE PASTILLE D'ÉVOLUTION AU-DESSUS DU CHAMP. Une suggestion
          cochée s'écrivait dans un objet détaché, impossible à compléter : on
          pouvait la retirer, pas la retoucher. Elle s'écrit désormais DANS le
          champ de saisie, où elle se lit, se copie et se complète comme le
          reste du message. */}

      {/* LE BANDEAU DE MODIFICATION VIENT AVANT LES PIÈCES : ce qui le suit — les
          fichiers, puis le champ — est le message en attente qu'on modifie, pas
          le brouillon. Celui-ci (texte et pièces) est mis de côté et revient à
          la fin, enregistrée ou annulée. */}
      {edition ? (
        <div
          data-modification-en-attente={edition.id}
          className="mb-1.5 flex items-center gap-2 rounded-md border border-transparent bg-surface px-2.5 py-1.5"
        >
          <Pencil className="h-3 w-3 shrink-0 text-accent" />
          <span className="min-w-0 flex-1 truncate text-[13px] text-muted">
            {t('Modification d\'un message en attente {v0}', {
              v0: edition.texteMisDeCote || jointesDuBrouillon.length ? ' — ce que vous écriviez revient juste après' : '',
            })}
          </span>
          <button
            type="button"
            onClick={() => void terminerEdition(false)}
            className="shrink-0 text-[12.5px] text-faint hover:text-text"
          >
            {t('Annuler')}
          </button>
        </div>
      ) : null}

      <AttachmentPreview item={apercu} onClose={() => setApercu(null)} galerie={attachments.filter((p) => p.mime.startsWith('image/'))} />

      {recorder.recording ? (
        <RecordingBar
          levels={recorder.levels}
          seconds={recorder.seconds}
          onValidate={() => recorder.finish(true)}
          onDiscard={() => recorder.finish(false)}
        />
      ) : null}

      {recorder.error ? (
        <RecorderErrorBar message={recorder.error} onRetry={recorder.retry} onDiscard={recorder.discardError} />
      ) : null}

      {/* La commande reconnue en tête du message, dite avant l'envoi. Elle ne
          transforme rien : le texte part tel quel, « /nom » compris. */}
      {commandeEcrite && !slashOuvert ? (
        <PastilleCommande
          nom={commandeEcrite}
          onRetirer={() => {
            const suite = text.replace(/^\/[a-zA-Z0-9][a-zA-Z0-9:_-]*[ ]?/, '');
            majTexte(suite);
            curseur.current = 0;
            curseurAPoser.current = 0;
            setPointeur(0);
          }}
        />
      ) : null}

      {/* Le menu des commandes « / » prend la place du repère des tâches : même
          habillage, même endroit, collé au champ — deux bandeaux empilés là se
          disputeraient le recouvrement de 8px. */}
      {slashOuvert ? (
        <MenuSlash
          commandes={commandesVisibles}
          index={Math.min(slashVise, Math.max(0, commandesVisibles.length - 1))}
          nomDuMoteur={nomCourtMoteur(moteurChoisi)}
          onChoisir={(commande) => choisirCommande(commande.nom)}
          onSurvol={setSlashVise}
        />
      ) : (
        /* Collée à la zone de saisie, rien entre les deux : la file d'attente,
           les pièces jointes et l'édition en cours restent au-dessus. */
        barreTravail
      )}

      <div className={cn('flex items-end gap-1.5', recorder.recording && 'hidden')}>
        {/* LE CHAMP D'ÉCRITURE : une boîte sur un fond gris pâle, aux coins
            de l'échelle commune (`rounded-lg`, 12 px, comme les boutons et le
            bloc de configuration de l'agent) — le texte en haut, ses boutons
            sur la rangée du bas, l'envoi en rond plein tout à droite. La barre
            posée dessous (chat.tsx, `data-temoin-reflexion`) épouse ce rayon. */}
        <div className="relative min-w-0 flex-1 rounded-lg bg-raised" data-champ-d-ecriture>
        {/* LE CALQUE NE COUVRE QUE LA PART VISIBLE DU CHAMP, ET SA DÉCOUPE NE
            BOUGE PAS. Deux blocs, et non un seul : une FENÊTRE posée exactement
            sur le champ, qui coupe ce qui dépasse, et DEDANS le texte, qui seul
            se déplace au rythme de l'ascenseur. Un unique bloc portant à la fois
            la découpe et le déplacement emmenait sa propre fenêtre avec le
            texte : les lignes de trop s'écrivaient alors par-dessus la rangée
            de boutons, sous le champ. */}
        {aDesDrapeaux ? (
          <div
            aria-hidden="true"
            ref={calqueRef}
            data-prompt-calque
            className="pointer-events-none absolute z-20 overflow-hidden"
            style={{
              top: calage.fenetre.top,
              left: calage.fenetre.left,
              width: calage.fenetre.width,
              height: calage.fenetre.height,
            }}
          >
            <div
              ref={texteCalqueRef}
              data-prompt-calque-texte
              className="w-full whitespace-pre-wrap break-words text-text"
              style={{ ...calage.style, boxSizing: 'border-box', transform: `translateY(${-scrollTexte}px)` }}
            >
              {texteAvecDrapeaux}
            </div>
          </div>
        ) : null}
        {drapeauGlisse
          ? createPortal(
              <>
                <div
                  className="pointer-events-none fixed z-[80] inline-flex max-w-[220px] items-center gap-1 rounded border border-transparent bg-accent/15 px-1.5 py-0.5 text-[13px] text-accent shadow-md"
                  style={{
                    left: drapeauGlisse.x,
                    top: drapeauGlisse.y,
                    transform: drapeauGlisse.doigt ? 'translate(-50%, calc(-100% - 28px))' : 'translate(-50%, -50%)',
                  }}
                >
                  <Paperclip className="h-3 w-3 shrink-0" />
                  {/* Le tag qu'on déplace porte la même étiquette que sa
                      pastille : un seul nom visible, partout. */}
                  <span className="truncate">{etiquetteDuTag(drapeauGlisse.nom, attachments)}</span>
                </div>
                {drapeauGlisse.trait ? (
                  <div
                    data-prompt-file-caret
                    className="pointer-events-none fixed z-[81] w-0.5 rounded-full bg-accent"
                    style={{
                      left: drapeauGlisse.trait.x,
                      top: drapeauGlisse.trait.y,
                      height: drapeauGlisse.trait.hauteur,
                    }}
                  />
                ) : null}
              </>,
              document.body,
            )
          : null}
        <Textarea
          ref={textareaRef}
          value={texteDuChamp}
          data-champ-replie={champReplie ? '' : undefined}
          onFocus={() => setChampFocalise(true)}
          /* Le repli attend la fin du geste : sans ce délai, le champ se
             rétrécissait sous le doigt et le bouton d'envoi remontait avant le
             clic, qui tombait à côté. */
          onBlur={() => window.setTimeout(() => setChampFocalise(document.activeElement === textareaRef.current), 250)}
          onChange={(event) => {
            // CE QUI SORT DU CHAMP REDEVIENT UN VRAI TEXTE : les tags
            // retrouvent leur « [fichier: …] », et rien d'invisible ne reste
            // dans l'état du composeur — pas même la moitié d'un masque
            // qu'une frappe aurait coupé.
            selectionAGarder.current = null;
            majTexte(sansMasque(event.target.value, attachments));
            curseur.current = event.target.selectionStart;
            setPointeur(event.target.selectionStart);
          }}
          onBeforeInput={(event) => {
            /* LE DERNIER FILET. Ce qui a échappé au placement du curseur — un
               texte lâché à la souris, un clavier virtuel, l'annulation du
               navigateur — ne peut pas amputer un tag : la frappe est refusée
               et le curseur repoussé hors du tag. Un tag couvert EN ENTIER,
               lui, se remplace comme n'importe quel mot. */
            const zone = event.currentTarget;
            if (!coupeUnTag(text, zone.selectionStart, zone.selectionEnd)) return;
            event.preventDefault();
            const hors = curseurHorsDesTags(text, zone.selectionStart, zone.selectionEnd);
            if (hors) zone.setSelectionRange(hors.debut, hors.fin);
          }}
          onKeyDown={onKeyDown}
          onKeyUp={retientCurseur}
          onClick={retientCurseur}
          onSelect={retientCurseur}
          onScroll={(event) => setScrollTexte(event.currentTarget.scrollTop)}
          onCopy={(event) => {
            const zone = textareaRef.current;
            if (!zone) return;
            const debut = zone.selectionStart;
            const fin = zone.selectionEnd;
            if (debut === fin) return;
            // Ce qui SORT du champ retrouve des espaces ordinaires : l'insécable
            // n'est là que pour empêcher un tag de se couper en fin de ligne.
            const selection = tagsEnEspacesOrdinaires(sansMasque(texteDuChamp.slice(debut, fin), attachments));
            MARQUE_FICHIER.lastIndex = 0;
            const noms = new Set<string>();
            let trouve: RegExpExecArray | null;
            while ((trouve = MARQUE_FICHIER.exec(selection))) noms.add(nomDuTag(trouve[1]!));
            if (!noms.size) return;
            const jointes = attachments.filter((a) => [...noms].some((nom) => tagDesignePiece(nom, a)));
            if (!jointes.length) return;
            // La sélection contient un tag [fichier: …] dont la pièce jointe est
            // connue ici : on l'emporte avec le texte pour la recréer au collage.
            event.preventDefault();
            event.clipboardData.setData('text/plain', selection);
            event.clipboardData.setData(TYPE_JOINTES_COLLABLES, emballerJointes(jointes));
          }}
          onPaste={(event) => {
            const files = Array.from(event.clipboardData.files);
            /*
             * LES FICHIERS D'ORIGINE PASSENT DEVANT TOUT LE RESTE. Le texte
             * collé nomme ses fichiers par ses tags « [fichier: …] » : s'ils
             * sont connus du projet, ce sont EUX qu'on repose — jamais des
             * copies téléversées à nouveau, et même quand le presse-papiers
             * n'a porté que du texte (téléphone, presse-papiers du système,
             * où notre type maison ne survit pas).
             */
            const texteDuPressePapiers = event.clipboardData.getData('text/plain');
            const jointesParTag = projectId
              ? jointesDesTags(
                  texteDuPressePapiers,
                  client.lireEtat().attachments[projectId] ?? [],
                )
              : [];
            if (files.length) {
              event.preventDefault();
              /*
               * Coller un message copié avec ses images (BoutonCopier) doit
               * réinjecter le TEXTE en plus des fichiers, sinon seules les
               * images arrivaient et la phrase copiée disparaissait.
               */
              const texteColle = nettoyerTexteColle(event.clipboardData.getData('text/plain'));
              if (texteColle) {
                const zone = textareaRef.current;
                const debut = zone ? zone.selectionStart : text.length;
                const fin = zone ? zone.selectionEnd : text.length;
                setText((avant) => `${avant.slice(0, debut)}${texteColle}${avant.slice(fin)}`);
                const position = debut + texteColle.length;
                curseur.current = position;
                curseurAPoser.current = position;
              }
              // Le message copié désigne des fichiers DÉJÀ là : on les repose
              // tels quels au lieu de téléverser les images du presse-papiers,
              // qui feraient doublon sous un nouvel identifiant.
              if (jointesParTag.length) {
                setAttachments((current) => ajouterJointesCollees(current, jointesParTag));
                void rattacherLesTagsColles(texteColle, jointesParTag);
                return;
              }
              /* Des tags que la page ne connaît pas (autre projet) : leurs
                 fichiers d'origine passent avant les images du presse-papiers,
                 qui ne sont téléversées que si aucun n'est retrouvé. */
              void rattacherLesTagsColles(texteColle, []).then((retrouves) => {
                // Les fichiers, eux, ne visent aucun endroit précis : à la fin.
                if (!retrouves) void upload(files, true);
              });
              return;
            }

            const emballees = relireJointes(event.clipboardData.getData(TYPE_JOINTES_COLLABLES));
            const jointes = emballees.length ? emballees : jointesParTag;
            /* Ce que la liste du projet n'a pas retrouvé se demande au serveur,
               une fois le texte collé (ici ou par le collage du navigateur). */
            void rattacherLesTagsColles(texteDuPressePapiers, jointes);
            /* UN TEXTE COPIÉ D'UN ASSISTANT (ChatGPT…) ARRIVE AVEC SES DÉBRIS :
               entités HTML, vignettes de sources, marqueurs `utm_`. On colle sa
               version nettoyée (`nettoyerTexteColle`), jamais les débris. */
            const debris = texteColleADesDebris(texteDuPressePapiers);
            if (!jointes.length && !debris) return;

            /* Un tag [fichier: …] copié, ou un message historique copié avec
               son bouton, recrée ses pièces jointes : les fichiers D'ORIGINE
               reparaissent au-dessus du champ, comme s'ils venaient d'être
               ajoutés à la main. */
            event.preventDefault();
            const texteColle = nettoyerTexteColle(event.clipboardData.getData('text/plain'));
            const zone = textareaRef.current;
            const debut = zone ? zone.selectionStart : text.length;
            const fin = zone ? zone.selectionEnd : text.length;
            setText((avant) => `${avant.slice(0, debut)}${texteColle}${avant.slice(fin)}`);
            const position = debut + texteColle.length;
            // Le curseur se repose APRÈS la peinture, par le mécanisme commun
            // du composeur (effet sur `text`) plutôt qu'à la main.
            curseur.current = position;
            curseurAPoser.current = position;
            if (jointes.length) setAttachments((current) => ajouterJointesCollees(current, jointes));
          }}
          disabled={enPublication && !edition}
          /* PENDANT UNE COUPURE LE CHAMP SE VERROUILLE, sans rien effacer : en
             lecture seule (et non désactivé), le texte, la sélection et le
             curseur restent, et il se rouvre seul au retour du lien. */
          readOnly={ecritureGelee}
          data-ecriture-bloquee={enPublication && !edition ? 'publication' : ecritureGelee ? 'lien' : undefined}
          placeholder={
            edition
              ? t('Modifiez le message en attente…')
              : enPublication
                ? t('Publication en cours — vous pourrez écrire ici dès la fin de la mise en ligne.')
              : ouvreUneNouvelleCarte
                ? t('Cette carte est en ligne — un message vous proposera d’ouvrir une nouvelle carte…')
              : /*
                 * UN AGENT ARRÊTÉ SUR SA QUESTION N'EST PAS « EN TRAIN DE
                 * TRAVAILLER » : il attend la réponse, qui se donne DANS la
                 * question. La barre ne répond jamais : ce qu'on y écrit
                 * attend son tour, et le champ le dit.
                 */
                agent?.attendReponse
                ? t('L’agent attend votre réponse à sa question — votre message attendra son tour…')
                : busy
                  ? /* Le cadrage comprend, il ne travaille pas : le champ ne
                       l'annonce plus au travail (relance après rapport comprise). */
                    agent?.role === 'cadrage'
                    ? t('L\'agent réfléchit…')
                    : t('L\'agent travaille — votre message attendra son tour…')
                  : (libelleDuChamp ?? t('Écrivez votre demande…'))
          }
          rows={1}
          className={cn(
            'relative z-10 min-h-[38px] border-0 bg-transparent focus-visible:ring-0',
            aDesDrapeaux && 'texte-sous-calque caret-text',
          )}
        />

        <input
          ref={fileRef}
          type="file"
          multiple
          // Repère pour les contrôles : d'autres écrans ont aussi un champ
          // de fichier, viser « le dernier » attrapait celui du tableau.
          data-composer-file
          className="hidden"
          onChange={(event) => event.target.files && upload(event.target.files)}
        />

        {/* LES PIÈCES JOINTES EN ATTENTE, DANS LE CHAMP (demande du 22/10/2026) :
            des VIGNETTES ENCADRÉES sous le texte, au-dessus de la rangée de
            boutons — le même rendu dans toutes les conversations, qu'on
            démarre une carte ou qu'on soit en plein échange. Plus d'accordéon
            « n pièces jointes » posé au-dessus du champ : la rangée défile de
            côté et ne prend jamais qu'une ligne. Un toucher ouvre l'aperçu en
            grand, la croix retire la pièce (et son ancre du texte), un
            glissement change l'ordre d'envoi. Pendant une modification, ce
            sont les pièces du message modifié (`attachments` suit ce que le
            champ montre). */}
        {attachments.length ? (
          <ZoneDefilement
            axe="horizontal"
            classeEnveloppe="relative z-30"
            className="flex gap-2 px-3 pb-1 pt-1"
            data-pieces-jointes={attachments.length}
            data-pieces-de={edition ? 'message-en-attente' : 'brouillon'}
          >
            {attachments.map((file) => {
              const etiquette = etiquetteDePiece(file);
              const visee = glisserVignette.target?.id === file.id ? glisserVignette.target.position : null;
              return (
                <div
                  key={file.id}
                  data-piece-vignette={file.id}
                  onPointerDown={(event) => glisserVignette.start(event, { id: file.id, kind: 'piece', label: etiquette })}
                  onMouseEnter={() => montreAncre(file)}
                  onFocus={() => montreAncre(file)}
                  className={cn(
                    'relative h-14 w-14 shrink-0 touch-pan-x select-none overflow-hidden rounded-md bg-surface ring-1 ring-inset ring-faint/40',
                    glisserVignette.dragging?.id === file.id && 'opacity-40',
                    visee === 'before' && 'shadow-[-3px_0_0_0_hsl(var(--accent))]',
                    visee === 'after' && 'shadow-[3px_0_0_0_hsl(var(--accent))]',
                  )}
                >
                  {/* UN SEUL NOM VISIBLE : L'IDENTIFIANT GÉNÉRÉ, le même que le
                      tag du texte (`etiquetteDePiece`) — c'est lui qui relie la
                      vignette à son ancre. Le fichier garde son nom sur le
                      disque et au téléchargement. */}
                  <button
                    type="button"
                    title={etiquette}
                    data-piece-etiquette={etiquette}
                    onClick={() => {
                      if (Date.now() - finDeGlissement.current < 400) return;
                      setApercu(file);
                    }}
                    className="flex h-full w-full flex-col items-center justify-center text-faint"
                  >
                    {file.mime.startsWith('image/') ? (
                      <img
                        src={`/api/attachment?id=${file.id}`}
                        alt={etiquette}
                        draggable={false}
                        className="absolute inset-0 h-full w-full object-cover"
                      />
                    ) : file.mime === 'application/pdf' ? (
                      <FileText className="h-5 w-5" />
                    ) : (
                      <Paperclip className="h-5 w-5" />
                    )}
                    <span className="absolute inset-x-0 bottom-0 truncate bg-surface/85 px-1 text-center text-[10px] leading-4 text-muted">
                      {etiquette}
                    </span>
                  </button>
                  <button
                    type="button"
                    title={t('Retirer ce fichier')}
                    aria-label={t('Retirer ce fichier')}
                    onClick={() => retirerJointe(file)}
                    data-piece-retirer
                    className="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-surface/90 text-muted hover:text-danger"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              );
            })}
          </ZoneDefilement>
        ) : null}

        {/* TOUS LES BOUTONS VIVENT DANS LE CHAMP, SUR SA RANGÉE DU BAS. À
            GAUCHE, CE QUI PRÉPARE LE MESSAGE : joindre un
            fichier, puis les interrupteurs de la carte et le bouton des RÉGLAGES
            de l'agent — plus aucune colonne posée dehors, à gauche du champ.
            À DROITE, ce qui l'envoie ou l'arrête : l'envoi tout au bord, le
            MICRO juste à sa gauche, le CONTEXTE avant lui, le carré d'arrêt
            avant le contexte, et la NOTE DE COMPRÉHENSION en tête du groupe,
            tout à gauche. */}
        <div className={cn('relative z-30 min-w-0 px-2 pb-2', CLASSE_RANGEE_DE_BOUTONS)} data-rangee-de-boutons="champ-gauche">
          <Tooltip label={t('Joindre un fichier')}>
            <Button
              variant="ghost"
              size="icon"
              data-composer-joindre
              className="shrink-0"
              disabled={ecritureGelee}
              onClick={() => fileRef.current?.click()}
            >
              {envois.length ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Paperclip className="h-3.5 w-3.5" />}
            </Button>
          </Tooltip>

          {/* LES INTERRUPTEURS « PLAN », « CRÉATION » ET « RÉALISATION » : ils ne paraissent
              que sur une carte en cadrage, avant le travail, où ils se
              choisissent. */}
          <InterrupteurDePlan cardId={cardId} agent={agent} />
          <InterrupteurDeCreation cardId={cardId} agent={agent} />
          <InterrupteurDeRealisation cardId={cardId} agent={agent} />

          {/* LES RÉGLAGES DE L'AGENT, juste à leur droite — ou à droite du
              trombone quand ni le plan ni la création ne sont proposés. */}
          {reglages}

          {onProposeTask && !edition && text.trim() ? (
            <Button variant="ghost" size="sm" className={cn('h-7 min-w-0 shrink', CLASSE_MARGE_DU_LIBELLE_DU_CHAMP)} onClick={() => submit(true)}>
              {t('En faire une tâche')}</Button>
          ) : null}

          <div className={cn('ml-auto shrink-0', CLASSE_RANGEE_DE_BOUTONS)} data-rangee-de-boutons="champ-droite">
            {/* LA NOTE DE COMPRÉHENSION, EN TROIS BARRES, EN TÊTE DU GROUPE DE
                DROITE — avant le carré d'arrêt, donc à une place FIXE : les
                boutons qui la suivent apparaissent et disparaissent au fil du
                tour (arrêt pendant qu'un moteur tourne, envoi quand le champ
                porte un texte), et une jauge posée au milieu d'eux se
                déplaçait sous l'oeil. C'est le seul reste visible du relecteur
                automatique : plus un message écrit nulle part. Il ne bloque
                jamais le lancement, et sans Laya installé il n'existe pas. */}
            <IndicateurComprehension carte={cardId ? state.cards[cardId] : undefined} />

            {/* Puis le bouton « Suspendre », le CONTEXTE DU MODÈLE en anneau, le
                micro, et l'envoi tout au bord. L'anneau ne montre rien tant que
                le moteur n'a rendu aucune mesure (voir anneau-contexte.tsx) : la
                rangée ne bouge donc pas à son arrivée. */}
            {boutons.arret ? (
              <Tooltip label={t('Suspendre l\'agent')}>
                <Button
                  variant="arret"
                  size="icon"
                  aria-label="Suspendre l'agent"
                  data-suspendre-agent
                  className="shrink-0"
                  onClick={arret.demander}
                >
                  <Pause className="h-3 w-3 fill-current" />
                </Button>
              </Tooltip>
            ) : null}

            <AnneauContexte agent={agent ?? undefined} />

            <MicButton onStart={recorder.start} working={recorder.working} disabled={!agent || ecritureGelee} />

            {boutons.envoi ? (
              <Button
                variant="default"
                size="icon"
                data-composer-envoi
                /* Un carré arrondi de la taille du micro (28 px, `rounded-md`),
                   plein foncé : l'envoi reste le seul bouton marqué. */
                className="shrink-0 rounded-md"
                title={
                  /* Le bouton éteint DIT pourquoi : un envoi refusé sans un mot
                     se lit comme une panne de l'application. */
                  canal.gele && !edition ? canal.raison : edition ? t('Enregistrer la modification') : t('Envoyer')
                }
                data-envoi-gele={canal.gele && !edition ? 'oui' : undefined}
                disabled={edition ? !text.trim() : canal.gele || enPublication || !agent || !text.trim()}
                onClick={() => submit()}
              >
                {edition ? <Check className="h-3.5 w-3.5" /> : <ArrowRight className="h-3.5 w-3.5" />}
              </Button>
            ) : null}
          </div>
        </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Un message en attente tient sur UNE seule ligne : le numéro, le début du
 * texte coupé proprement, le crayon et la corbeille. Le texte entier reste
 * accessible en le modifiant — il s'ouvre alors dans la BARRE D'ÉCRITURE, en
 * bas, avec toute la place.
 */
/*
 * LES ENVOIS EN COURS SUIVENT L'AGENT, PAS LE COMPOSANT — comme le brouillon et
 * ses pièces jointes. Changer de conversation pendant qu'une vidéo de 2 Go
 * part ne la perd pas : en revenant, sa barre est toujours là, et sa croix
 * l'annule encore.
 */
interface Envoi {
  cle: string;
  nom: string;
  taille: number;
  part: number;
  octets: number;
  annuler: () => void;
}
const envoisParAgent = new Map<string, Envoi[]>();
const abonnesEnvois = new Set<() => void>();
const VIDE: Envoi[] = [];
function publierEnvois(cleAgent: string, liste: Envoi[]) {
  if (liste.length) envoisParAgent.set(cleAgent, liste);
  else envoisParAgent.delete(cleAgent);
  abonnesEnvois.forEach((f) => f());
}
function ajouterEnvoi(cleAgent: string, envoi: Envoi) {
  publierEnvois(cleAgent, [...(envoisParAgent.get(cleAgent) ?? []), envoi]);
}
function majEnvoi(cleAgent: string, cle: string, maj: Partial<Envoi>) {
  const liste = envoisParAgent.get(cleAgent);
  if (!liste?.some((e) => e.cle === cle)) return;
  publierEnvois(cleAgent, liste.map((e) => (e.cle === cle ? { ...e, ...maj } : e)));
}
function retirerEnvoi(cleAgent: string, cle: string) {
  publierEnvois(cleAgent, (envoisParAgent.get(cleAgent) ?? []).filter((e) => e.cle !== cle));
}
function useEnvois(cleAgent: string): Envoi[] {
  return React.useSyncExternalStore(
    (f) => {
      abonnesEnvois.add(f);
      return () => abonnesEnvois.delete(f);
    },
    () => envoisParAgent.get(cleAgent) ?? VIDE,
  );
}

function LigneEnvoi({ envoi }: { envoi: Envoi }) {
  const pourcent = Math.round(envoi.part * 100);
  return (
    <div
      data-envoi={envoi.nom}
      data-envoi-part={pourcent}
      className="flex min-w-0 items-center gap-2 rounded-lg bg-raised px-2.5 py-1.5 text-[12px]"
    >
      <FileText className="h-3.5 w-3.5 shrink-0 text-muted" />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate text-text">{envoi.nom}</span>
          <span className="shrink-0 tabular-nums text-muted">
            {pourcent >= 100 ? t('Enregistrement…') : `${pourcent} % · ${tailleLisible(envoi.octets)} / ${tailleLisible(envoi.taille)}`}
          </span>
        </div>
        <BarreProgression
          className="mt-2 rounded-full"
          teinte="en-cours"
          pourcent={pourcent}
          indeterminee={pourcent >= 100}
        />
      </div>
      <Tooltip label={t("Annuler l'envoi")}>
        <button
          type="button"
          data-envoi-annuler
          aria-label="Annuler l'envoi"
          className="shrink-0 rounded p-1 text-muted hover:bg-surface hover:text-danger"
          onClick={envoi.annuler}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </Tooltip>
    </div>
  );
}

function QueuedItem({
  item,
  index,
  actif,
  onEdit,
}: {
  item: QueuedPrompt;
  index: number;
  actif: boolean;
  onEdit: () => void;
}) {
  // Les retours à la ligne deviennent des espaces : sinon la ligne unique
  // afficherait un texte coupé au premier saut plutôt qu'à sa largeur.
  const apercu = item.text.replace(/\s+/g, ' ').trim();
  /* Le clic se lit tout de suite : la roue tourne jusqu'à la réponse du serveur. */
  const [envoiEnCours, setEnvoiEnCours] = React.useState(false);
  const envoyerMaintenant = async () => {
    if (envoiEnCours) return;
    setEnvoiEnCours(true);
    try {
      await client.geste({ type: 'queue.send-now', id: item.id }, t('Envoyer maintenant'));
    } finally {
      setEnvoiEnCours(false);
    }
  };
  return (
    <div
      className={cn(
        'flex h-8 items-center gap-1.5 rounded-md border bg-surface px-2',
        actif ? 'border-accent/50' : 'border-border',
      )}
    >
      <GripVertical className="h-3 w-3 shrink-0 text-faint" />
      <span className="shrink-0 text-[12px] text-faint">{index + 1}</span>
      <button
        type="button"
        onClick={onEdit}
        title={apercu}
        className="min-w-0 flex-1 truncate text-left text-[13.5px] text-muted hover:text-text"
      >
        {apercu}
      </button>
      <button type="button" title={t('Modifier')} onClick={onEdit} className="shrink-0 text-faint hover:text-text">
        <Pencil className="h-3 w-3" />
      </button>
      <button
        type="button"
        title={t('Envoyer maintenant')}
        aria-label="Envoyer maintenant"
        aria-busy={envoiEnCours}
        disabled={envoiEnCours}
        onClick={() => void envoyerMaintenant()}
        className="shrink-0 text-faint hover:text-accent disabled:cursor-wait"
      >
        {envoiEnCours ? <Loader2 className="h-3 w-3 animate-spin" /> : <ArrowUp className="h-3 w-3" />}
      </button>
      <button
        type="button"
        title={t('Retirer de la file')}
        onClick={() => void client.geste({ type: 'queue.remove', id: item.id }, t('Retirer de la file'))}
        className="shrink-0 text-faint hover:text-danger"
      >
        <Trash2 className="h-3 w-3" />
      </button>
    </div>
  );
}
