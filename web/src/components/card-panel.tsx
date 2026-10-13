import * as React from 'react';
import {
  AlertTriangle,
  Archive,
  Check,
  ChevronDown,
  GitBranch,
  Loader2,
  MessageSquare,
  MessagesSquare,
  Github,
  Play,
  CloudUpload,
  CircleDot,
  EllipsisVertical,
  Paperclip,
  Rocket,
  RotateCcw,
  Search,
  Sparkles,
  PenLine,
  Trash2,
  X,
} from 'lucide-react';
import {
  COLUMN_LABELS,
  ONGLET_DE_CARTE_PAR_DEFAUT,
  Attachment,
  Card,
  CardComment,
  DeployRun,
  EtatDeFichier,
  titreEncoreVide,
  titreEnConstruction,
  etapesAMontrer,
  libelleCibleDeploiement,
  libelleEtapeDeploiement,
  phraseDesFichiers,
  resumeDeBranche,
  resumeDesFichiers,
  totalDesLignes,
  alertesParCarte,
  iconeDuLot,
  mentionArchivage,
  mentionDeRedaction,
  mentionDeReprise,
  cadrageRouvertApresRapport,
  avisSurLUrgence,
  estUnRegroupement,
  membresActifsDuRegroupement,
  estVoletDuCahier,
  peutRedevenirNonLue,
} from '@beluga/shared';
import {
  BulleInfo,
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  Drawer,
  DropdownMenuItem,
  DropdownMenuSeparator,
  EmptyState,
  Input,
  Label,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  Tooltip,
  ZoneDefilement,
  ListeDeroulante,
} from '@/components/ui';
import { AttachmentPreview, AttachmentThumb } from '@/components/attachment-preview';
import { Chat } from '@/components/chat';
import { MenuCarte } from '@/components/card-menu';
import { MenuDesProjets } from '@/components/menu-des-projets';
import { EnteteDeZone, useLieuDeLaZone } from '@/components/entete-de-zone';
import {
  CLASSE_LIBELLE_EN_BANDE,
  CLASSE_REPERE_EN_BANDE,
  CLASSE_LIGNE_DE_SERVICE,
  CLASSE_LIGNE_EN_BANDE,
  ColonneDeService,
  useColonneDeService,
} from '@/components/colonne-de-service';
import { BoutonNouvelleTache } from '@/components/nouvelle-tache';
import { PastilleProjet, PastillesEmpilees } from '@/components/pastille-projet';
import { RepereAttention } from '@/components/repere-attention';
import { SilhouetteTiroirCarte } from '@/components/silhouettes';
import { client, donneesDeCarteRecues } from '@/lib/client';
import { FournisseurDeChargement, useChargementOnglet, useOngletsQuiChargent } from '@/lib/chargement-onglet';
import { useApp } from '@/lib/use-app';
import { estTelephone, useTelephone } from '@/lib/telephone';
import { cn, duration, money, relativeTime } from '@/lib/utils';
import { t, formatRegional } from '@/lib/langue';
import { MenuExportDuCahier } from '@/components/cahier-des-charges';

/** La colonne de lecture d'une carte : la conversation se centre, elle ne s'étale pas. */
export const CLASSE_COLONNE_DE_CARTE = 'max-w-[820px]';

export function CardPanel({
  cardId,
  onClose,
  onglet,
  onOnglet,
  onOuvrirVue,
}: {
  cardId: string | null;
  onClose: () => void;
  /** L'ONGLET DÉSIGNÉ PAR L'ADRESSE : « …/tache/<id>-<slug>/<onglet> ». */
  onglet?: string | null;
  /** …et l'onglet affiché, remonté pour que l'adresse le décrive. */
  onOnglet?: (onglet: string | null) => void;
  /** La destination choisie dans la liste des projets du fil d'Ariane. */
  onOuvrirVue?: (vue: 'en-route' | 'projet') => void;
}) {
  const state = useApp();
  const card = cardId ? state.cards[cardId] : null;

  if (!cardId) return null;

  /*
   * Une notification peut viser une carte d'un projet qu'on n'a pas encore
   * sous les yeux : `allerVersDecision` change de projet puis demande la
   * carte dans le même geste, avant que ses cartes soient revenues du
   * serveur. Rendre `null` ici faisait le tiroir disparaître aussitôt ouvert
   * — un clic qui « ne fait rien ». On garde le tiroir ouvert avec une
   * silhouette : il se remplit tout seul dès que la carte arrive.
   *
   * MAIS UNE SILHOUETTE N'EST PAS UNE RÉPONSE. Un lien direct peut viser une
   * carte EFFACÉE, ou une carte d'un projet jamais ouvert : elle n'arrivera
   * alors jamais, et le tiroir restait vide pour toujours, sans un mot.
   * `CarteReclamee` demande donc la carte au serveur, et DIT ce qu'il répond.
   */
  if (!card) return <CarteReclamee cardId={cardId} onClose={onClose} />;

  return (
    /* LA FEUILLE A SA HAUTEUR AVANT D'AVOIR SON CONTENU (`hauteurFixe`) : le
       tiroir d'une tâche s'ouvre sur une silhouette, puis se remplit — il ne
       doit pas grandir d'un bond au passage. */
    /* LA CARTE EST UNE PAGE, pleine largeur : elle pose elle-même sa barre
       d'en-tête (fil d'Ariane, gestes, options) et centre sa conversation. */
    <Drawer open onClose={onClose} plein={estTelephone()} hauteurFixe entete={<></>} className="max-w-none sm:px-0">
      <TiroirDeCarte card={card} onClose={onClose} onglet={onglet} onOnglet={onOnglet} onOuvrirVue={onOuvrirVue} />
    </Drawer>
  );
}

/**
 * LE TIROIR SE TAIT TANT QUE LA CARTE N'A PAS PARLÉ.
 *
 * La carte elle-même arrive avec l'instantané de son projet ; son JOURNAL et
 * son FIL, eux, sont réclamés à l'ouverture. Entre les deux, le tiroir se
 * dessinait sur des valeurs par défaut — et sa barre d'étapes, calculée sur un
 * journal absent, montrait « Travail » et « Rapport » EN ROUGE : une carte
 * qu'on croyait plantée. On montre donc la silhouette du tiroir ENTIER, titre
 * compris, jusqu'à l'arrivée des deux (`donneesDeCarteRecues`).
 *
 * UNE ATTENTE N'EST PAS SANS FIN : passé douze secondes, on affiche le tiroir
 * tel quel plutôt que de laisser une silhouette pour toujours — chaque zone
 * garde alors ses propres silhouettes internes.
 */
function TiroirDeCarte({
  card,
  onClose,
  onglet,
  onOnglet,
  onOuvrirVue,
}: {
  card: Card;
  onClose: () => void;
  onglet?: string | null;
  onOnglet?: (onglet: string | null) => void;
  onOuvrirVue?: (vue: 'en-route' | 'projet') => void;
}) {
  const state = useApp();
  const recues = donneesDeCarteRecues(state, card.id);
  const [tropLong, setTropLong] = React.useState(false);

  React.useEffect(() => {
    setTropLong(false);
    client.ouvrirLesDonneesDeCarte(card.id);
    const minuteur = window.setTimeout(() => setTropLong(true), 12_000);
    return () => window.clearTimeout(minuteur);
  }, [card.id]);

  if (!recues && !tropLong) {
    return (
      <>
        <EnteteDeZone onRetour={onClose} titre={card.title} />
        <div className={cn('mx-auto flex min-h-0 w-full flex-1 flex-col', CLASSE_COLONNE_DE_CARTE)}>
          <SilhouetteTiroirCarte />
        </div>
      </>
    );
  }
  return <CardPanelBody card={card} onClose={onClose} onglet={onglet} onOnglet={onOnglet} onOuvrirVue={onOuvrirVue} />;
}

/**
 * LE TIROIR D'UNE CARTE QUE L'ÉTAT LOCAL N'A PAS. Il la réclame au serveur par
 * son seul identifiant et n'a que trois issues, jamais l'attente sans fin :
 * la carte arrive (l'état la reçoit, ce composant disparaît au rendu suivant),
 * le serveur dit qu'elle n'existe plus, ou la demande échoue. Dans les deux
 * derniers cas l'écran l'écrit en toutes lettres, avec un bouton pour fermer.
 */
function CarteReclamee({ cardId, onClose }: { cardId: string; onClose: () => void }) {
  const [issue, setIssue] = React.useState<'attente' | 'introuvable' | 'illisible' | 'erreur'>(
    'attente',
  );

  React.useEffect(() => {
    let vivant = true;
    setIssue('attente');
    void client.chargerCarte(cardId).then((resultat) => {
      if (!vivant || resultat === 'ok') return;
      // La carte n'existe plus : les annonces gardées dans ce navigateur qui la
      // désignent ne mènent nulle part non plus, elles quittent la cloche.
      if (resultat === 'introuvable') client.oublierAnnoncesDeCarte(cardId);
      setIssue(resultat);
    });
    return () => {
      vivant = false;
    };
  }, [cardId]);

  return (
    /* MÊME HAUTEUR QUE LE TIROIR ORDINAIRE : un lien direct vers une carte ne
       doit pas ouvrir une feuille d'une autre taille, puis en changer quand la
       carte arrive. */
    <Drawer open onClose={onClose} plein={estTelephone()} hauteurFixe className="max-w-[920px] sm:px-0">
      {issue === 'attente' ? (
        <SilhouetteTiroirCarte />
      ) : (
        /* Le message tient le milieu de la feuille, qui a désormais sa hauteur
           entière. */
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 py-6">
          <EmptyState
            title={
              issue === 'introuvable'
                ? t('Cette tâche n’existe plus')
                : issue === 'illisible'
                  ? t('Cette tâche est abîmée')
                  : t('Cette tâche n’a pas pu être chargée')
            }
            hint={
              issue === 'introuvable'
                ? t('Elle a été supprimée, ou le lien ne correspond à aucune tâche.')
                : issue === 'illisible'
                  ? t('Le serveur la trouve mais ne parvient pas à la relire.')
                  : t('Le serveur n’a pas répondu. Réessayez dans un instant.')
            }
          />
          <Button variant="outline" onClick={onClose}>
            {t('Fermer')}
          </Button>
        </div>
      )}
    </Drawer>
  );
}

function CardPanelBody({
  card,
  onClose,
  onglet: ongletVise,
  onOnglet,
  onOuvrirVue,
}: {
  card: Card;
  onClose: () => void;
  onglet?: string | null;
  onOnglet?: (onglet: string | null) => void;
  onOuvrirVue?: (vue: 'en-route' | 'projet') => void;
}) {
  const state = useApp();
  /* Le bouton des services ouvre aussi le fil d'Ariane d'une carte. */
  const lieu = useLieuDeLaZone();
  /*
   * L'agent de la conversation n'est PAS seulement celui de l'exécution : une
   * carte n'en reçoit un qu'au lancement, alors que son analyse a déjà parlé
   * bien avant. On prend donc le dernier agent connu de la carte — analyse
   * comprise — sinon son compte rendu ne s'affichait qu'au démarrage du travail.
   */
  const conversation = state.cardMessages[card.id];
  const dernierAgent = React.useMemo(
    () =>
      Object.values(state.agents)
        .filter((item) => item.cardId === card.id)
        .sort((a, b) => b.createdAt - a.createdAt)[0] ?? null,
    [state.agents, card.id],
  );
  /*
   * UN MESSAGE SOUS LE RAPPORT A ROUVERT LE CADRAGE (carte relancée, en
   * « Demande » ou en « Plan ») : c'est son agent qui tient le fil — son tour, sa réflexion, ses questions —, pas l'agent de tâche que
   * la carte garde pour le travail livré (`shared/src/relance-apres-rapport.ts`).
   */
  const cadrageRouvert = React.useMemo(
    () =>
      cadrageRouvertApresRapport(card)
        ? (Object.values(state.agents)
            .filter((item) => item.cardId === card.id && item.role === 'cadrage')
            .sort((a, b) => b.createdAt - a.createdAt)[0] ?? null)
        : null,
    [state.agents, card],
  );
  const agent =
    cadrageRouvert ??
    (card.agentId ? state.agents[card.agentId] : null) ??
    (conversation?.activeAgentId ? state.agents[conversation.activeAgentId] : null) ??
    dernierAgent;
  const project = state.projects.find((p) => p.id === card.projectId);
  /* Un projet réuni montre la pile des favicons de ses projets, comme la colonne
     de gauche et la page « En route » ; sans membre actif, la pastille simple. */
  const membresDuGroupe = project && estUnRegroupement(project) ? membresActifsDuRegroupement(state.projects, project.id) : [];

  /* Ce que cette carte attend de vous — le même compte que son triangle sur le
     tableau, posé ici sur l'onglet où la décision se prend. */
  const decisions = alertesParCarte(state.decisions)[card.id] ?? 0;
  /* Le même dessin que sur la carte du tableau : la nature de l'attente,
     lue par la table partagée (`iconeDuLot`). */
  const iconeDecision = iconeDuLot(state.decisions.filter((d) => d.cardId === card.id && !d.reglee));
  /*
   * DEUX ONGLETS ONT DISPARU DANS LA CONVERSATION : « Détails » (les réglages
   * de l'agent) puis « Parcours » (le journal entier de la carte). Ils
   * racontaient la même vie que le fil, à côté de lui ; la conversation les
   * porte maintenant elle-même, dans l'ordre du temps (`chat.tsx`). Elle est
   * donc le seul point d'entrée d'une carte, et le seul onglet qui vaille au
   * premier affichage.
   */
  /* L'ADRESSE PEUT POSER L'ONGLET D'ENTRÉE : un lien partagé ouvre la carte
     directement sur l'onglet voulu, pas systématiquement sur la conversation. */
  const [onglet, setOnglet] = React.useState(ongletVise || ONGLET_DE_CARTE_PAR_DEFAUT);
  const remonterOnglet = React.useRef(onOnglet);
  remonterOnglet.current = onOnglet;
  React.useEffect(() => {
    if (!ongletVise || ongletVise === onglet) return;
    setOnglet(ongletVise);
  }, [ongletVise]);
  /*
   * UNE DÉCISION ATTENDUE RAMÈNE TOUJOURS SUR LA CONVERSATION. Le tiroir reste
   * monté d'une carte à l'autre : l'onglet ouvert sur la carte précédente —
   * « Facturation », « GitHub » — s'affichait encore devant une carte dont
   * l'agent attend une réponse. On revient donc au fil à chaque changement de
   * carte, et dès qu'une question se pose sur la carte affichée.
   */
  /* LE RETOUR AU FIL NE VAUT QUE D'UNE CARTE À L'AUTRE : au premier
     affichage, l'onglet posé par l'adresse doit tenir. */
  const carteAffichee = React.useRef(card.id);
  React.useEffect(() => {
    if (carteAffichee.current === card.id) return;
    carteAffichee.current = card.id;
    setOnglet(ONGLET_DE_CARTE_PAR_DEFAUT);
  }, [card.id]);
  React.useEffect(() => {
    if (decisions > 0) setOnglet(ONGLET_DE_CARTE_PAR_DEFAUT);
  }, [decisions]);
  /* LE VOLET DU CAHIER DES CHARGES N'A PAS D'ONGLETS : seule la conversation,
     où se posent les questions (`estVoletDuCahier`). */
  const voletDuCahier = estVoletDuCahier(card);
  const ongletActif = voletDuCahier ? ONGLET_DE_CARTE_PAR_DEFAUT : onglet;
  /* LA FIN DU CAHIER REFERME SON VOLET : la carte part dans « Archivé » et une
     carte de construction prend la suite. Seul ce PASSAGE referme — une
     carte du cahier rouverte depuis l'archive reste ouverte. */
  const colonneVue = React.useRef(card.column);
  React.useEffect(() => {
    const avant = colonneVue.current;
    colonneVue.current = card.column;
    if (voletDuCahier && avant !== 'archived' && card.column === 'archived') onClose();
  }, [card.column, voletDuCahier, onClose]);
  /* L'onglet affiché remonte à l'adresse. */
  React.useEffect(() => {
    remonterOnglet.current?.(ongletActif);
  }, [ongletActif]);

  /*
   * PLUS AUCUN PIED DE TIROIR.
   *
   * Les gestes du bas — « Lancer maintenant », « Sortir de l'archive »,
   * « Passer à … », le document de clôture — vivaient SOUS la barre d'écriture,
   * pendant que les gestes de l'étape en cours se tenaient JUSTE AU-DESSUS
   * d'elle. Deux endroits pour la même famille de décisions, et le plus rare
   * des deux occupait une bande permanente en bas de l'écran.
   *
   * Tout est remonté dans la rangée collée au champ de saisie (`BarreDAction`,
   * `parcours-carte.tsx`), qui porte désormais AUSSI les gestes de rangement :
   * un geste d'action se présente toujours au même endroit. Le document de
   * clôture, lui, n'existe plus du tout (`server/src/archive.ts`).
   */

  /* Ce que les onglets vont chercher : « GitHub » le déroulé de ses
     déploiements. Chacun l'annonce depuis son contenu. */
  const [chargement, signalerChargement] = useOngletsQuiChargent();

  /*
   * Sur téléphone, le haut du tiroir s'épure. Les tags (état, étiquettes,
   * « modifiée à l'instant », mention d'archivage) sont repliés derrière un
   * chevron : ils tiennent souvent deux lignes et poussent la lecture vers le
   * bas. Sur ordinateur, ce même bloc reste toujours ouvert et le chevron
   * n'existe pas.
   */
  const telephone = useTelephone();
  /*
   * LE TITRE A-T-IL ÉTÉ GÉNÉRÉ ? Une carte qui porte encore le mot par défaut
   * n'a rien à signaler ; dès qu'un titre est écrit — par l'agent de cadrage
   * au premier tour, ou par la main de l'utilisateur —, l'ampoule le montre.
   */
  const titreGenere = !titreEncoreVide(card.title);
  /* L'ampoule ci-dessus ne change pas ; le TEXTE de l'en-tête, lui, attend le
     vrai titre de l'agent tant que le titre est vide ou provisoire. */
  const titreEnCours = titreEnConstruction(card);
  const [tagsOuverts, setTagsOuverts] = React.useState(false);
  const tagsVisibles = !telephone || tagsOuverts;

  /*
   * La barre d'onglets se retire quand on descend dans le contenu et revient
   * quand on remonte, pour libérer de la hauteur de lecture — téléphone
   * seulement. `onScrollCapture` sur le conteneur des onglets attrape le
   * défilement de n'importe quel onglet (le chat a son propre défilement, les
   * autres passent par ZoneDefilement) : scroll ne remonte pas en bulle, mais
   * il descend bien en phase de capture. On change de sens à partir d'un petit
   * seuil pour ne pas battre sur un micro-tremblement.
   */
  const emplacementBarre = React.useRef<HTMLDivElement>(null);
  /* L'icône qui rouvre la configuration de l'agent s'y pose par un portail
     (`Chat`) : un état, pas une référence, pour que la conversation la voie. */
  const [emplacementReglages, setEmplacementReglages] = React.useState<HTMLDivElement | null>(null);
  const [barreVisible, setBarreVisible] = React.useState(true);
  const dernierScroll = React.useRef(0);
  // Un changement d'onglet remet tout à plat : chaque onglet a son propre
  // défilement, comparer leurs positions n'aurait aucun sens.
  React.useEffect(() => {
    dernierScroll.current = 0;
    setBarreVisible(true);
  }, [onglet]);
  const surDefilement = (event: React.UIEvent) => {
    if (!telephone) return;
    const y = (event.target as HTMLElement).scrollTop;
    const precedent = dernierScroll.current;
    if (y > precedent + 6 && y > 48) setBarreVisible(false);
    else if (y < precedent - 6) setBarreVisible(true);
    dernierScroll.current = y;
  };

  /* CE QUE LA CARTE A DE PLUS À DIRE — son état, ses étiquettes, sa date — ne
     s'étale plus sous le titre : c'est rangé derrière le « i ». */
  const etiquettes = (
    <div data-tags-carte className="flex flex-wrap items-center gap-1.5 text-[12.5px] text-muted">
      <Badge>{t(COLUMN_LABELS[card.column])}</Badge>
      {card.deployedAt ? (
        <Badge>
          <Rocket className="h-2.5 w-2.5" /> {t('en ligne')}
        </Badge>
      ) : null}
      {/* Une carte ressortie garde sa trace : on doit voir qu'elle était
          passée par « Archivé », et quand. */}
      {mentionArchivage(card) ? (
        <Badge title={t('Archivée le {v0}', { v0: new Date(card.archivedAt!).toLocaleString(formatRegional()) })}>
          <Archive className="h-2.5 w-2.5" /> {mentionArchivage(card)}
        </Badge>
      ) : null}
      {/* Une carte qui se reprend le dit : le travail déjà fait est gardé. */}
      {mentionDeReprise(card) ? (
        <Badge title={mentionDeReprise(card)!}>
          <RotateCcw className="h-2.5 w-2.5" /> {t('reprise')}
        </Badge>
      ) : null}
      {[avisSurLUrgence(card)].map((avis) =>
        avis ? (
          <Badge key={avis.cle} title={t(avis.phrase)} data-avis-etiquette={avis.cle}>
            <AlertTriangle className="h-2.5 w-2.5" /> {t(avis.titre)}
          </Badge>
        ) : null,
      )}
      {card.labels.map((label) => (
        <Badge key={label}>{label}</Badge>
      ))}
      <span>{t('modifiée {v0}', { v0: relativeTime(card.updatedAt) })}</span>
    </div>
  );
  void tagsVisibles;
  void setTagsOuverts;
  void barreVisible;
  void membresDuGroupe;
  void titreGenere;

  /* LES OPTIONS DE LA TÂCHE VIVENT DANS LA COLONNE DE GAUCHE (demande du
     11/10/2026) : dans une tâche, la colonne laisse la place à ses options —
     conversation, commentaires, facturation, GitHub, « marquer comme non lu » —
     sous une flèche qui ramène au projet. Le menu à trois points ne garde que
     les déplacements et la suppression. SUR TÉLÉPHONE, où la colonne vit dans
     un panneau fermé, tout reste dans ce menu, comme avant. */
  const dansLaColonne = useColonneDeService();
  const nonLuPossible = peutRedevenirNonLue({ colonne: card.column, renduA: card.renduA, luA: card.lastReadAt });
  const ONGLETS: { cle: string; cleLibelle: string; Icone: React.ComponentType<{ className?: string }> }[] = [
    { cle: 'chat', cleLibelle: 'Conversation', Icone: MessageSquare },
    { cle: 'comments', cleLibelle: 'Commentaires', Icone: MessagesSquare },
    { cle: 'github', cleLibelle: 'GitHub', Icone: Github },
  ];
  const entreesDOnglets = voletDuCahier || dansLaColonne ? null : (
    <>
      {ONGLETS.map(({ cle, cleLibelle, Icone }) => (
        <DropdownMenuItem key={cle} data-onglet-carte={cle} onSelect={() => setOnglet(cle)}>
          <Icone className="h-3.5 w-3.5" />
          <span className="flex-1">{t(cleLibelle)}</span>
          {cle === 'comments' ? <RoueDOnglet visible={!!chargement.comments} /> : null}
          {cle === 'github' ? <RoueDOnglet visible={!!chargement.github} /> : null}
          {ongletActif === cle ? <Check className="h-3.5 w-3.5" /> : null}
        </DropdownMenuItem>
      ))}
      <DropdownMenuSeparator />
    </>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-page-carte={card.id}>
      {/* LA BARRE D'EN-TÊTE DE LA CARTE : la flèche de retour, le fil d'Ariane
          (le projet, puis le titre), les deux gestes de mise en ligne, et les
          options derrière trois points. Rien d'autre. */}
      <EnteteDeZone
        avant={lieu?.avant}
        onRetour={onClose}
        /* Sur ordinateur, le retour est porté par la colonne de gauche. */
        retourDansLaColonne={dansLaColonne}
        chemin={
          project
            ? [
                {
                  libelle: project.name,
                  /* Le nom du projet OUVRE LA LISTE DES PROJETS, comme sur les
                     autres pages : « Tableaux de bord » en tête, le projet
                     courant coché. Choisir referme la carte (`onOuvrirVue`). */
                  menu: (declencheur: React.ReactElement) => (
                    <MenuDesProjets
                      declencheur={declencheur}
                      projetCourantId={project.id}
                      onOuvrirVue={(vue) => {
                        if (onOuvrirVue) onOuvrirVue(vue);
                        else client.demanderTableau(project.id);
                      }}
                    />
                  ),
                  /* Son icône le précède, et reste là sur téléphone où le nom
                     est masqué. Un appui dessus referme la carte et montre le
                     tableau du projet : `onClick` ne sert qu'à l'icône, le nom
                     garde la liste des projets (la branche `menu` passe avant). */
                  onClick: () => client.demanderTableau(project.id),
                  icone: membresDuGroupe.length ? (
                    <PastillesEmpilees projects={membresDuGroupe} />
                  ) : (
                    <PastilleProjet project={project} />
                  ),
                },
              ]
            : []
        }
        titre={
          titreEnCours ? (
            <span data-titre-en-construction className="animate-pulse font-normal italic text-muted">
              {t('Titre en cours de création…')}
            </span>
          ) : (
            <span data-titre-carte="ouvert">{card.title}</span>
          )
        }
        menu={
          <MenuCarte
            card={card}
            apresSuppression={onClose}
            enTete={entreesDOnglets}
            sansNonLu={dansLaColonne}
            declencheur={
              <Button
                variant="ghost"
                size="icon"
                className="relative h-8 w-8 shrink-0 text-muted"
                aria-label="Autres actions"
                data-menu-de-carte
              >
                <EllipsisVertical className="h-4 w-4" />
                {decisions > 0 && ongletActif !== 'chat' && !dansLaColonne ? (
                  <span className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-text" aria-hidden />
                ) : null}
              </Button>
            }
          />
        }
      >
        {/* Le « i » : l'état, les étiquettes, la date. */}
        <BulleInfo label={t('Détails de la carte')}>{etiquettes}</BulleInfo>
        {/* À gauche des gestes : le raccourci vers la configuration de l'agent,
            posé par la conversation. */}
        <div ref={setEmplacementReglages} data-emplacement-reglages className="flex shrink-0 empty:hidden" />
        {/* LE CAHIER DES CHARGES S'EXPORTE D'ICI, en PDF ou en texte. */}
        {voletDuCahier ? <MenuExportDuCahier projectId={card.projectId} /> : null}
        {/* LES DEUX GESTES DE MISE EN LIGNE DU PROJET, comme sur la maquette :
            le déploiement (sur ce serveur) en contour, la mise en production en
            aplat. Ils ouvrent les MÊMES pages que le tableau. */}
        {voletDuCahier || telephone ? null : (
          <>
            <Button
              variant="outline"
              size="md"
              className="h-9 gap-2 rounded-lg px-3.5"
              data-geste-deploiement
              onClick={() => client.demanderDeploiement({ projectId: card.projectId })}
            >
              <Play className="h-3.5 w-3.5" />
              {t('Déploiement')}
            </Button>
            <Button
              variant="default"
              size="md"
              className="h-9 gap-2 rounded-lg px-3.5"
              data-geste-production
              onClick={() => client.demanderProduction({ projectId: card.projectId })}
            >
              <CloudUpload className="h-3.5 w-3.5" />
              {t('Mise en production')}
            </Button>
          </>
        )}
      </EnteteDeZone>
      {/* Le titre, pour les lecteurs d'écran : la page est une fenêtre Radix. */}
      <DialogTitle className="sr-only">{card.title}</DialogTitle>

      {/* LES OPTIONS DE LA TÂCHE, DANS LA COLONNE DE GAUCHE (`plan="page"` : la
          page est ouverte par-dessus, le menu du projet attend dessous). La
          ligne ouverte s'écrit en violet et se dit à voix haute. Colonne
          réduite, il n'en reste que les icônes. */}
      {dansLaColonne ? (
        <ColonneDeService plan="page">
          <nav aria-label="Options de la tâche" data-options-de-carte={card.id} className="flex flex-col gap-0.5 pt-1">
            {/* « NOUVELLE TÂCHE », TOUT EN HAUT, au-dessus de « Conversation » :
                le même bouton que dans la colonne du projet, pour une carte
                créée depuis le projet de cette tâche. */}
            <BoutonNouvelleTache projectId={card.projectId} />
            {voletDuCahier
              ? null
              : ONGLETS.map(({ cle, cleLibelle, Icone }) => {
                  const ouverte = ongletActif === cle;
                  return (
                    <button
                      key={cle}
                      type="button"
                      data-onglet-carte={cle}
                      aria-current={ouverte ? 'page' : undefined}
                      title={t(cleLibelle)}
                      onClick={() => setOnglet(cle)}
                      className={cn(
                        CLASSE_LIGNE_DE_SERVICE,
                        CLASSE_LIGNE_EN_BANDE,
                        'relative',
                        ouverte ? 'bg-ligne-active text-teinte' : 'hover:bg-raised',
                      )}
                    >
                      <Icone className={cn('h-4 w-4 shrink-0', !ouverte && 'text-muted')} />
                      <span className={cn('min-w-0 flex-1 truncate', CLASSE_LIBELLE_EN_BANDE)}>{t(cleLibelle)}</span>
                      {/* Colonne réduite, la roue et le point quittent le flux
                          de la ligne (`CLASSE_REPERE_EN_BANDE`) : en y restant,
                          ils décalaient l'icône de « Commentaires » et de
                          « GitHub » par rapport aux autres. */}
                      {cle === 'comments' ? (
                        <RoueDOnglet visible={!!chargement.comments} className={CLASSE_REPERE_EN_BANDE} />
                      ) : null}
                      {cle === 'github' ? (
                        <RoueDOnglet visible={!!chargement.github} className={CLASSE_REPERE_EN_BANDE} />
                      ) : null}
                      {/* Une décision attend dans la conversation, qu'on a quittée. */}
                      {cle === 'chat' && decisions > 0 && !ouverte ? (
                        <span
                          data-decision-attendue
                          className={cn('h-1.5 w-1.5 shrink-0 rounded-full bg-text', CLASSE_REPERE_EN_BANDE)}
                          aria-hidden
                        />
                      ) : null}
                    </button>
                  );
                })}
            {nonLuPossible ? (
              <button
                type="button"
                data-menu-non-lu={card.id}
                title={t('Marquer comme non lu')}
                onClick={() => client.send({ type: 'card.unread', cardId: card.id })}
                className={cn(CLASSE_LIGNE_DE_SERVICE, CLASSE_LIGNE_EN_BANDE, 'mt-3 hover:bg-raised')}
              >
                <CircleDot className="h-4 w-4 shrink-0 text-muted" />
                <span className={cn('min-w-0 flex-1 truncate', CLASSE_LIBELLE_EN_BANDE)}>{t('Marquer comme non lu')}</span>
              </button>
            ) : null}
          </nav>
        </ColonneDeService>
      ) : null}

      <MentionDeRedaction card={card} />

      <Tabs
        key={card.id}
        value={ongletActif}
        onValueChange={setOnglet}
        onScrollCapture={surDefilement}
        className={cn('mx-auto flex min-h-0 w-full flex-1 flex-col', CLASSE_COLONNE_DE_CARTE)}
      >
        {/* SUR TÉLÉPHONE, LA BARRE D'ÉTAPES EST COLLÉE SOUS L'EN-TÊTE : la
            conversation la pose ici par un portail (`emplacementBarre`,
            `chat.tsx`). Sur ordinateur, elle vit en tête de la conversation. */}
        {telephone ? <div ref={emplacementBarre} data-emplacement-barre className="px-4 pb-1" /> : null}
        {/* Hors de la conversation, un mot dit où l'on est et y ramène — sur
            téléphone seulement : sur ordinateur, la colonne de gauche le dit. */}
        {ongletActif !== 'chat' && !dansLaColonne ? (
          <div className="flex shrink-0 items-center gap-2 px-4 pb-2 pt-1" data-barre-onglets>
            <Button variant="ghost" size="sm" className="-ml-2 gap-1.5 text-muted" onClick={() => setOnglet('chat')}>
              <MessageSquare className="h-3.5 w-3.5" />
              {t('Conversation')}
            </Button>
            <span className="text-[14.5px] font-medium text-text">
              {t(ONGLETS.find((item) => item.cle === ongletActif)?.cleLibelle ?? 'Conversation')}
            </span>
          </div>
        ) : null}

        <TabsContent value="chat" className="flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden">
          <Chat
            agent={agent}
            projectId={card.projectId}
            cardId={card.id}
            emplacementBarre={telephone ? emplacementBarre : undefined}
            emplacementReglages={ongletActif === 'chat' ? emplacementReglages : null}
          />
        </TabsContent>

        <TabsContent value="comments" className="flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden">
          <FournisseurDeChargement signaler={signalerChargement}>
            <CommentsTab card={card} />
          </FournisseurDeChargement>
        </TabsContent>


        <TabsContent value="github" className="flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden">
          <ZoneDefilement>
            <FournisseurDeChargement signaler={signalerChargement}>
              <GithubTab card={card} />
            </FournisseurDeChargement>
          </ZoneDefilement>
        </TabsContent>
      </Tabs>

    </div>
  );
}

/**
 * La roue d'un onglet qui va chercher ses données. Elle prend la place d'un
 * caractère à côté du nom : l'onglet ne change donc pas de largeur en la
 * posant, et la barre ne se réorganise pas sous le doigt.
 */
/**
 * « LA RÉDACTION AUTOMATIQUE N'A PAS ABOUTI » — dit sur la carte, avec de quoi
 * la refaire.
 *
 * Une tâche née de la messagerie porte d'abord le titre et le texte ÉCRITS PAR
 * LE CLIENT, le temps qu'un agent les réécrive. Quand cette réécriture tombait,
 * la carte restait ainsi sans que rien ne l'explique : elle avait l'air
 * négligée. La règle d'affichage est dans `shared` (`mentionDeRedaction`) — un
 * nouvel essai en cours ne se dit pas de la même façon qu'un abandon, et une
 * promesse d'essai que le démon ne tiendra plus bascule toute seule en échec.
 *
 * ELLE NE SORT PAS D'ICI : l'espace client n'a pas ce bandeau, et le client
 * continue de voir sa demande prise en charge.
 *
 * LA MENTION DISPARAÎT TOUTE SEULE dès que la rédaction aboutit : l'état arrive
 * par `card.upsert`, comme le titre définitif, sans rechargement.
 */
function MentionDeRedaction({ card }: { card: Card }) {
  const [enCours, setEnCours] = React.useState(false);
  const mention = mentionDeRedaction(card.redaction, Date.now());

  // Le tour reparti, la carte repasse « en-cours » : la mention s'efface et le
  // bouton doit redevenir cliquable pour la prochaine fois.
  React.useEffect(() => {
    if (!mention) setEnCours(false);
  }, [mention]);

  if (!mention) return null;
  const attente = mention.etat === 'en-attente';
  return (
    <div
      className={cn(
        'mx-4 mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md px-3 py-2 text-[12.5px]',
        attente ? 'bg-en-cours/10 text-en-cours' : 'bg-warning/10 text-warning',
      )}
      data-mention-redaction={mention.etat}
    >
      <PenLine className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span className="min-w-0">
        {attente
          ? t('La rédaction automatique de cette tâche est en attente d’un nouvel essai.')
          : t(
              'La rédaction automatique n’a pas abouti : le titre et le texte affichés sont ceux écrits par le client.',
            )}
        {mention.raison ? ` ${t('Raison : {v0}.', { v0: mention.raison })}` : null}
      </span>
      {mention.relancable ? (
        <Button
          size="sm"
          variant="outline"
          className="ml-auto shrink-0"
          disabled={enCours}
          data-relancer-redaction={card.id}
          onClick={() => {
            // Le bouton DIT qu'il travaille dès le clic : le tour dure
            // plusieurs secondes, et rien d'autre ne bouge entre-temps.
            setEnCours(true);
            client.send({ type: 'card.redaction.relancer', cardId: card.id });
          }}
        >
          {enCours ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
          {enCours ? t('Rédaction en cours…') : t('Refaire la rédaction')}
        </Button>
      ) : null}
    </div>
  );
}

function RoueDOnglet({ visible, className }: { visible: boolean; className?: string }) {
  return (
    <span
      data-onglet-charge={visible ? '' : undefined}
      className={cn('inline-flex h-3 w-3 shrink-0 items-center justify-center', className)}
    >
      {visible ? <Loader2 className="h-3 w-3 animate-spin text-en-cours" /> : null}
    </span>
  );
}

/* Les réglages de l'agent de la carte, le parcours et « ce qui était prévu »
   vivaient ici, dans l'onglet « Détails » — retiré, avec cet onglet. Le seul
   bloc repris (`ReglagesAgent`) vit maintenant dans le fil de conversation
   (`web/src/components/chat.tsx`), affiché une fois la configuration figée. */

/**
 * Un champ de formulaire : l'étiquette au-dessus, le champ en dessous sur
 * toute la largeur, et l'explication en dessous. Jamais côte à côte : sur
 * téléphone, deux champs sur une ligne deviennent illisibles.
 */
export function Champ({
  label,
  aide,
  action,
  children,
}: {
  label: string;
  aide?: string;
  /** Un bouton posé EN HAUT À DROITE, sur la ligne de l'étiquette (le bouton « IA »). */
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  /* LE LIBELLÉ AU-DESSUS DE SA VALEUR, à toutes les largeurs (règle de toute
     l'application, comme `LigneFormulaire`) ; le bouton « IA » reste à droite,
     sur la ligne du libellé. */
  return (
    <div className="flex flex-col gap-1.5" data-champ>
      <div className="flex min-h-[20px] items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1">
          <Label className="block">{label}</Label>
          {aide ? <BulleInfo cote="start">{aide}</BulleInfo> : null}
        </span>
        {action ?? null}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}


/* ------------------------------------------------------------------ */
/* Onglet Commentaires                                                 */
/* ------------------------------------------------------------------ */

/** Un commentaire tel que le serveur le rend : ses pièces jointes déjà résolues. */
type CommentaireAvecPieces = CardComment & { attachments: Attachment[] };

/**
 * DES NOTES LIBRES SUR LA CARTE, pièces jointes comprises — pour documenter
 * une étape utile, garder un repère personnel, ou expliquer un choix qu'une
 * conversation d'agent ne garderait pas au même endroit. Chaque ouverture de
 * l'onglet relit la liste (comme « GitHub » relit son déroulé) : pas de canal
 * temps réel dédié, un commentaire est écrit par une seule personne à la fois.
 */
function CommentsTab({ card }: { card: Card }) {
  const [comments, setComments] = React.useState<CommentaireAvecPieces[]>([]);
  const [charge, setCharge] = React.useState(true);
  useChargementOnglet('comments', charge);

  const [text, setText] = React.useState('');
  const [attachments, setAttachments] = React.useState<Attachment[]>([]);
  const [uploading, setUploading] = React.useState(false);
  const [envoi, setEnvoi] = React.useState(false);
  const [zoom, setZoom] = React.useState<Attachment | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);

  const recharger = React.useCallback(() => {
    setCharge(true);
    client
      .call({ type: 'comment.list', cardId: card.id })
      .then((res: any) => setComments(res?.comments ?? []))
      .catch(() => undefined)
      .finally(() => setCharge(false));
  }, [card.id]);

  React.useEffect(() => {
    recharger();
  }, [recharger]);

  const upload = async (files: FileList | File[]) => {
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const response = await fetch(`/api/upload?project=${encodeURIComponent(card.projectId)}&card=${card.id}`, {
          method: 'POST',
          headers: { 'content-type': file.type || 'application/octet-stream', 'x-file-name': encodeURIComponent(file.name) },
          body: file,
        });
        const data = await response.json();
        const jointe: Attachment | undefined = data.attachment;
        if (!jointe) continue;
        setAttachments((current) => (current.some((a) => a.id === jointe.id) ? current : [...current, jointe]));
      }
    } catch {
      client.pushToast('error', t('Envoi du fichier impossible'));
    } finally {
      setUploading(false);
    }
  };

  /**
   * COLLER UNE IMAGE L'ATTACHE À LA NOTE : une capture prise au clavier
   * (`Ctrl+V`) arrive dans le presse-papiers comme un fichier sans nom. On lui
   * en donne un, daté, et on la fait passer par le MÊME envoi que le bouton
   * « Joindre un fichier » — aucun second stockage. Un collage de texte suit
   * son chemin normal : on ne l'intercepte pas.
   */
  const collerDepuisPressePapier = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const fichiers = Array.from(event.clipboardData?.files ?? []).filter((f) => f.type.startsWith('image/'));
    if (!fichiers.length) return;
    event.preventDefault();
    const horodate = new Date().toISOString().replace(/[:.]/g, '-');
    upload(
      fichiers.map((fichier, index) =>
        fichier.name
          ? fichier
          : new File([fichier], `collage-${horodate}${index ? `-${index + 1}` : ''}.${(fichier.type.split('/')[1] || 'png')}`, {
              type: fichier.type,
            }),
      ),
    );
  };

  const envoyer = async () => {
    const texte = text.trim();
    if (!texte) return;
    setEnvoi(true);
    try {
      await client.call({
        type: 'comment.add',
        cardId: card.id,
        text: texte,
        attachmentIds: attachments.map((a) => a.id),
      });
      setText('');
      setAttachments([]);
      recharger();
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('Ajout impossible'));
    } finally {
      setEnvoi(false);
    }
  };

  const supprimer = async (id: string) => {
    // Retrait optimiste : une note qu'on vient de retirer ne doit pas rester
    // affichée le temps que le serveur réponde.
    setComments((current) => current.filter((c) => c.id !== id));
    try {
      await client.call({ type: 'comment.delete', id, cardId: card.id });
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('Suppression impossible'));
      recharger();
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ZoneDefilement classeEnveloppe="min-h-0 flex-1" className="px-4 py-3">
        {!charge && !comments.length ? (
          <EmptyState
            icon={<MessageSquare className="h-5 w-5" />}
            title={t('Aucun commentaire')}
            hint={t('Notez ici tout ce qui aide à documenter, comprendre ou exécuter cette carte.')}
          />
        ) : (
          /* UNE SUITE DE BULLES, TOUTES À GAUCHE : les notes se lisent comme
             une conversation avec soi-même. Aucune bulle à droite — il n'y a
             qu'un seul auteur, aligner en face n'opposerait personne à
             personne. La bulle ne prend au plus que 85 % de la largeur pour
             qu'on voie d'un coup d'œil où elle s'arrête. */
          <ul className="space-y-2.5" data-bulles-commentaires>
            {comments.map((comment) => (
              <li key={comment.id} className="flex justify-start" data-bulle-commentaire>
                <div className="group max-w-[85%] rounded-2xl rounded-bl-sm bg-raised px-3 py-2">
                  <div className="flex items-start gap-2">
                    <p className="min-w-0 flex-1 whitespace-pre-wrap text-[13.5px] text-text texte-copiable">
                      {comment.text}
                    </p>
                    {/* Le geste de retrait s'efface tant qu'on ne survole pas
                        la bulle : il ne doit pas peser dans la lecture. Sur
                        téléphone, où rien ne survole, il reste visible. */}
                    <Tooltip label={t('Retirer')}>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="shrink-0 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
                        onClick={() => supprimer(comment.id)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </Tooltip>
                  </div>
                  {comment.attachments.length ? (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {comment.attachments.map((item) => (
                        <AttachmentThumb key={item.id} item={item} onOpen={() => setZoom(item)} compact />
                      ))}
                    </div>
                  ) : null}
                  <p className="mt-1.5 text-[12px] text-faint">
                    {dateHeure(new Date(comment.createdAt).toISOString())}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </ZoneDefilement>

      <div className="shrink-0 space-y-2 border-t border-border px-4 py-3">
        {/* Une pièce jointe en attente se RETIRE avant l'envoi : une capture
            collée par erreur se dégageait autrement en rechargeant l'onglet. */}
        {attachments.length ? (
          <div className="flex flex-wrap gap-1.5" data-pieces-en-attente>
            {attachments.map((item) => (
              <div key={item.id} className="group relative">
                <AttachmentThumb item={item} onOpen={() => setZoom(item)} compact />
                <button
                  type="button"
                  aria-label="Retirer"
                  className="absolute -right-1 -top-1 rounded-full bg-surface p-0.5 text-faint opacity-100 transition-opacity hover:text-text md:opacity-0 md:group-hover:opacity-100"
                  onClick={() => setAttachments((current) => current.filter((a) => a.id !== item.id))}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        ) : null}
        <Textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          onPaste={collerDepuisPressePapier}
          placeholder={t('Écrire un commentaire, ou coller une image…')}
          rows={2}
          className="resize-none"
        />
        <div className="flex items-center justify-between gap-2">
          <input
            ref={fileRef}
            type="file"
            multiple
            className="hidden"
            onChange={(event) => {
              if (event.target.files?.length) upload(event.target.files);
              event.target.value = '';
            }}
          />
          <Button variant="outline" size="sm" disabled={uploading} onClick={() => fileRef.current?.click()}>
            <Paperclip className="h-3 w-3" />
            {t('Joindre un fichier')}
          </Button>
          <Button size="sm" disabled={envoi || !text.trim()} onClick={envoyer}>
            {t('Ajouter')}
          </Button>
        </div>
      </div>

      <AttachmentPreview
        item={zoom}
        onClose={() => setZoom(null)}
        galerie={[...comments.flatMap((c) => c.attachments), ...attachments].filter((p) => p.mime.startsWith('image/'))}
        nomDuLot={card.title}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Onglet GitHub                                                       */
/* ------------------------------------------------------------------ */

/** Une date de dépôt s'affiche avec son heure : « 02.08 à 09:14 ». */
function dateHeure(valeur?: string): string {
  if (!valeur) return '—';
  const date = new Date(valeur);
  if (Number.isNaN(date.getTime())) return valeur;
  return `${date.toLocaleDateString(formatRegional(), { day: '2-digit', month: '2-digit' })} à ${date.toLocaleTimeString(formatRegional(), { hour: '2-digit', minute: '2-digit' })}`;
}

/** Une durée d'étape de publication : « 12 s », « 3 min ». */
function dureeEtape(debut?: number, fin?: number): string {
  if (!debut || !fin || fin < debut) return '';
  const secondes = Math.round((fin - debut) / 1000);
  if (secondes < 60) return `${secondes} s`;
  return `${Math.round(secondes / 60)} min`;
}

/** « +12 −3 », comme git. Un binaire n'a pas de compte : il rend rien. */
function lignesDuFichier(fichier: { ajoutees?: number; supprimees?: number }): React.ReactNode {
  if (fichier.ajoutees === undefined && fichier.supprimees === undefined) return null;
  return (
    <span className="shrink-0 font-mono text-[12.5px]" data-github-lignes>
      {fichier.ajoutees ? <span className="text-success">+{fichier.ajoutees}</span> : null}
      {fichier.ajoutees && fichier.supprimees ? ' ' : null}
      {fichier.supprimees ? <span className="text-danger">−{fichier.supprimees}</span> : null}
    </span>
  );
}

/**
 * UN NŒUD DE LA LIGNE DE TEMPS : sa pastille, son trait, puis son contenu.
 *
 * Le trait vertical est porté par le NŒUD lui-même (une bordure à gauche du
 * contenu), pas par un trait posé derrière toute la colonne : il s'arrête donc
 * tout seul sur le dernier nœud, quelle que soit sa hauteur.
 */
function NoeudDeTemps({
  ton,
  dernier,
  repere,
  children,
}: {
  ton: string;
  dernier?: boolean;
  repere?: string;
  children: React.ReactNode;
}) {
  return (
    <li className="relative pb-4 pl-5 last:pb-0" data-github-noeud={repere ?? 'branche'}>
      {!dernier ? <span className="absolute bottom-0 left-[3px] top-3 w-px bg-border" aria-hidden /> : null}
      <span className={cn('absolute left-0 top-[5px] h-[7px] w-[7px] rounded-full', ton)} aria-hidden />
      {children}
    </li>
  );
}

/** La couleur d'un fichier touché suit son sort : ajouté, modifié, supprimé. */
const TON_DU_FICHIER: Record<EtatDeFichier, string> = {
  ajoute: 'text-success',
  modifie: 'text-en-cours',
  supprime: 'text-danger',
  renomme: 'text-en-cours',
};

const LETTRE_DU_FICHIER: Record<EtatDeFichier, string> = {
  ajoute: 'A',
  modifie: 'M',
  supprime: 'S',
  renomme: 'R',
};


/**
 * L'ONGLET « GITHUB » : LA VIE DE LA BRANCHE, DE HAUT EN BAS.
 *
 * Il portait tout ce que GitHub sait dire — enregistrements, demande de fusion,
 * contrôles d'intégration, commentaires de revue — et l'essentiel s'y perdait.
 * Il ne garde donc que DEUX choses, dans l'ordre où elles arrivent : les
 * fichiers que la branche a changés, avec leurs lignes ajoutées et supprimées
 * comme le dit git, puis le déroulé de son déploiement.
 *
 * Tout se charge À L'OUVERTURE : le bouton « Actualiser » est retiré, on ne
 * demande plus à l'utilisateur de réclamer ce qu'il vient d'ouvrir.
 */
/** Ce qu'est devenu un dépôt annexe dans une publication, en mots courts. */
function libelleEtatDeDepot(etat: NonNullable<DeployRun['depots']>[number]['etat']): string {
  switch (etat) {
    case 'reussi':
      return t('en ligne');
    case 'echec':
      return t('en échec');
    case 'en-cours':
      return t('en cours');
    case 'rien':
      return t('rien à publier');
    default:
      return t('en attente');
  }
}

function GithubTab({ card }: { card: Card }) {
  const [deploiements, setDeploiements] = React.useState<DeployRun[]>([]);
  const tracking = card.github;

  const [charge, setCharge] = React.useState(true);
  useChargementOnglet('github', charge);

  /*
   * LE RELEVÉ DE LA BRANCHE SE FAIT À L'OUVERTURE, UNE FOIS PAR CARTE. Il lit
   * git et GitHub, donc on ne le rejoue pas à chaque rendu : la marque `releve`
   * garde la trace de la carte déjà relevée (elle protège aussi du double
   * montage du mode développement). Quand il rend, `fetchedAt` change et
   * l'effet ci-dessous recharge le déroulé.
   */
  const releve = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (releve.current === card.id) return;
    releve.current = card.id;
    setCharge(true);
    client.call({ type: 'github.refresh', cardId: card.id }).catch(() => undefined);
  }, [card.id]);

  React.useEffect(() => {
    let vivant = true;
    client
      .call({ type: 'github.deploiements', cardId: card.id })
      .then((res: any) => {
        if (vivant) setDeploiements(res?.deploiements ?? []);
      })
      .catch(() => undefined)
      .finally(() => {
        if (vivant) setCharge(false);
      });
    return () => {
      vivant = false;
    };
  }, [card.id, card.column, card.github?.fetchedAt]);

  const fichiers = tracking?.fichiers ?? [];
  const resume = resumeDesFichiers(fichiers);
  const lignes = totalDesLignes(fichiers);
  const etatBranche = resumeDeBranche(tracking ?? {});
  /* Les dépôts ANNEXES où la branche a changé quelque chose : un bloc chacun. */
  const annexesTouches = (tracking?.depots ?? []).filter((depot) => depot.fichiers.length || depot.commits.length);

  if (!tracking?.branch) {
    return (
      <div className="px-4 py-3">
        <p className="text-[13.5px] text-faint">{t('Cette carte n\'a pas encore de branche : elle n\'a jamais été lancée.')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3 px-4 py-3">
      <div className="flex items-center gap-2" data-github-branche>
        <GitBranch className="h-3.5 w-3.5 shrink-0 text-faint" />
        <span className="min-w-0 flex-1 truncate text-[14px] text-text texte-copiable">{tracking.branch}</span>
        <Badge tone={etatBranche.etat === 'fusionnee' ? 'success' : 'neutral'}>{etatBranche.phrase}</Badge>
      </div>

      <ul data-github-timeline>
        {/* 1. CE QUE LA BRANCHE A CHANGÉ : les fichiers, avec leurs lignes. */}
        <NoeudDeTemps ton={fichiers.length ? 'bg-termine' : 'bg-border'} dernier={!deploiements.length && !annexesTouches.length}>
          <p className="text-[13.5px] text-text" data-github-fichiers>
            {resume.total
              ? t('{v0} fichier{v1} — {v2}', { v0: resume.total, v1: resume.total > 1 ? 's' : '', v2: phraseDesFichiers(resume) })
              : tracking.fetchedAt
                ? t('Aucun fichier touché par cette branche pour l\'instant.')
                : t('Fichiers en cours de lecture…')}
            {lignes.ajoutees || lignes.supprimees ? (
              <span className="ml-1.5 font-mono text-[12.5px]">
                <span className="text-success">+{lignes.ajoutees}</span>{' '}
                <span className="text-danger">−{lignes.supprimees}</span>
              </span>
            ) : null}
          </p>

          {tracking.creeLe ? (
            <p className="mt-0.5 text-[12.5px] text-faint">{t('branche créée le {v0}', { v0: dateHeure(tracking.creeLe) })}</p>
          ) : null}

          {fichiers.length ? (
            <ul className="mt-1.5 space-y-0.5">
              {fichiers.map((fichier) => (
                <li key={fichier.chemin} className="flex items-baseline gap-2 text-[13px]">
                  <span className={cn('w-3 shrink-0 font-mono', TON_DU_FICHIER[fichier.etat])}>
                    {LETTRE_DU_FICHIER[fichier.etat]}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-muted texte-copiable">{fichier.chemin}</span>
                  {lignesDuFichier(fichier)}
                </li>
              ))}
            </ul>
          ) : null}
        </NoeudDeTemps>

        {/* 1 bis. LES DÉPÔTS ANNEXES touchés par la même branche, un bloc par dépôt. */}
        {annexesTouches.map((depot, rangDepot) => {
            const fichiersDuDepot = depot.fichiers;
            const resumeDuDepot = resumeDesFichiers(fichiersDuDepot);
            return (
              <NoeudDeTemps
                key={depot.nom}
                repere="depot-annexe"
                ton="bg-termine"
                dernier={!deploiements.length && rangDepot === annexesTouches.length - 1}
              >
                <p className="text-[13.5px] text-text" data-github-depot={depot.nom}>
                  {t('Dépôt « {v0} »', { v0: depot.nom })}
                  <span className="ml-1.5 text-muted">
                    {resumeDuDepot.total
                      ? t('{v0} fichier{v1} — {v2}', {
                          v0: resumeDuDepot.total,
                          v1: resumeDuDepot.total > 1 ? 's' : '',
                          v2: phraseDesFichiers(resumeDuDepot),
                        })
                      : t('{v0} enregistrement(s)', { v0: depot.commits.length })}
                  </span>
                  {depot.fusionnee ? (
                    <span className="ml-1.5 text-[12.5px] text-faint">{t('fusionnée')}</span>
                  ) : null}
                </p>
                {fichiersDuDepot.length ? (
                  <ul className="mt-1.5 space-y-0.5">
                    {fichiersDuDepot.map((fichier) => (
                      <li key={fichier.chemin} className="flex items-baseline gap-2 text-[13px]">
                        <span className={cn('w-3 shrink-0 font-mono', TON_DU_FICHIER[fichier.etat])}>
                          {LETTRE_DU_FICHIER[fichier.etat]}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-muted texte-copiable">{fichier.chemin}</span>
                        {lignesDuFichier(fichier)}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </NoeudDeTemps>
            );
          })}

        {/* 2. LE DÉROULÉ DU DÉPLOIEMENT, étape par étape. */}
        {deploiements.length
          ? deploiements.map((run, rang) => (
              <NoeudDeTemps
                key={run.id}
                repere="deploiement"
                dernier={rang === deploiements.length - 1}
                ton={
                  run.state === 'success'
                    ? 'bg-termine'
                    : run.state === 'failed'
                      ? 'bg-danger'
                      : run.state === 'running'
                        ? 'bg-en-cours'
                        : 'bg-border'
                }
              >
                <p className="text-[13.5px] text-text">
                  {libelleCibleDeploiement(run.cible)}
                  <span className="ml-1.5 text-[12.5px] text-faint">
                    {dateHeure(new Date(run.startedAt).toISOString())}
                  </span>
                </p>

                <ul className="mt-1 space-y-0.5">
                  {etapesAMontrer(run).map((etape) => (
                    <li key={etape.key} className="flex items-center gap-1.5 text-[13px]">
                      <span
                        className={cn(
                          'h-1.5 w-1.5 shrink-0 rounded-full',
                          etape.state === 'done'
                            ? 'bg-termine'
                            : etape.state === 'failed'
                              ? 'bg-danger'
                              : etape.state === 'running'
                                ? 'bg-en-cours'
                                : 'bg-border',
                        )}
                      />
                      <span className="min-w-0 flex-1 truncate text-muted">{libelleEtapeDeploiement(etape.key)}</span>
                      <span className="shrink-0 text-faint">
                        {etape.state === 'skipped'
                          ? t('ignorée')
                          : etape.progress || dureeEtape(etape.startedAt, etape.endedAt)}
                      </span>
                    </li>
                  ))}
                </ul>

                {run.depots?.length ? (
                  <ul className="mt-1 space-y-0.5" data-deploiement-depots>
                    {run.depots.map((depot) => (
                      <li key={depot.nom} className="flex items-center gap-1.5 text-[13px]">
                        <span
                          className={cn(
                            'h-1.5 w-1.5 shrink-0 rounded-full',
                            depot.etat === 'reussi'
                              ? 'bg-termine'
                              : depot.etat === 'echec'
                                ? 'bg-danger'
                                : depot.etat === 'en-cours'
                                  ? 'bg-en-cours'
                                  : 'bg-border',
                          )}
                        />
                        <span className="min-w-0 flex-1 truncate text-muted">{t('Dépôt « {v0} »', { v0: depot.nom })}</span>
                        <span className="shrink-0 text-faint">{libelleEtatDeDepot(depot.etat)}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}

                {run.error ? <p className="mt-1 text-[13px] text-danger texte-copiable">{run.error}</p> : null}
              </NoeudDeTemps>
            ))
          : null}
      </ul>

      {!deploiements.length ? (
        <p className="text-[13.5px] text-faint">{t('Cette carte n\'a encore été emportée par aucun déploiement.')}</p>
      ) : null}
    </div>
  );
}
