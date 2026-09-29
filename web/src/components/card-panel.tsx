import * as React from 'react';
import {
  AlertTriangle,
  Archive,
  Check,
  ChevronDown,
  CircleDollarSign,
  GitBranch,
  Lightbulb,
  Loader2,
  MessageSquare,
  Paperclip,
  Rocket,
  RotateCcw,
  Search,
  Sparkles,
  PenLine,
  Trash2,
  X,
  Zap,
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
} from '@beluga/shared';
import {
  BulleInfo,
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  Drawer,
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
} from '@/components/ui';
import { AttachmentPreview, AttachmentThumb } from '@/components/attachment-preview';
import { Chat } from '@/components/chat';
import { MenuCarte } from '@/components/card-menu';
import { PastilleProjet } from '@/components/pastille-projet';
import { RepereAttention } from '@/components/repere-attention';
import { SilhouetteTiroirCarte } from '@/components/silhouettes';
import { client, donneesDeCarteRecues } from '@/lib/client';
import { FournisseurDeChargement, useChargementOnglet, useOngletsQuiChargent } from '@/lib/chargement-onglet';
import { useApp } from '@/lib/use-app';
import { estTelephone, useTelephone } from '@/lib/telephone';
import { cn, duration, money, relativeTime } from '@/lib/utils';
import { t, formatRegional } from '@/lib/langue';

export function CardPanel({
  cardId,
  onClose,
  onglet,
  onOnglet,
}: {
  cardId: string | null;
  onClose: () => void;
  /** L'ONGLET DÉSIGNÉ PAR L'ADRESSE : « …/tache/<id>-<slug>/<onglet> ». */
  onglet?: string | null;
  /** …et l'onglet affiché, remonté pour que l'adresse le décrive. */
  onOnglet?: (onglet: string | null) => void;
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
    <Drawer open onClose={onClose} plein={estTelephone()} hauteurFixe>
      <TiroirDeCarte card={card} onClose={onClose} onglet={onglet} onOnglet={onOnglet} />
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
}: {
  card: Card;
  onClose: () => void;
  onglet?: string | null;
  onOnglet?: (onglet: string | null) => void;
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

  if (!recues && !tropLong) return <SilhouetteTiroirCarte />;
  return <CardPanelBody card={card} onClose={onClose} onglet={onglet} onOnglet={onOnglet} />;
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
    <Drawer open onClose={onClose} plein={estTelephone()} hauteurFixe>
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
}: {
  card: Card;
  onClose: () => void;
  onglet?: string | null;
  onOnglet?: (onglet: string | null) => void;
}) {
  const state = useApp();
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
  const ongletActif = onglet;
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

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Aucun filet sous le titre : c'est l'ESPACE qui sépare le titre de la
          barre d'onglets. Le trait de 1 px se lisait comme un défaut
          d'affichage, juste au-dessus des onglets et de la bande « en cours ».
          Le retrait de la bordure remonte le contenu d'un pixel : on rend ce
          pixel au bas de l'en-tête pour que rien ne bouge à l'écran. */}
      <header className={cn('shrink-0 px-4', telephone ? 'pb-1.5' : 'pb-[13px]')}>
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            {/* LE TITRE GÉNÉRÉ SE VOIT DÈS LE PREMIER ÉCHANGE. L'agent de
                cadrage l'écrit sur le prompt brut, avant même d'ouvrir la
                mémoire : l'ampoule dit d'où il vient. Une carte encore
                appelée « Nouvelle tâche » n'en porte pas — il n'y aurait rien
                à signaler. La taille du titre ne bouge pas, seul le gras et
                l'icône changent. */}
            {/* SUR TÉLÉPHONE, LE TITRE TIENT SUR UNE LIGNE et c'est lui qu'on
                touche pour déplier ce qui se replie dessous : les étiquettes
                de la carte. L'écran reste au flux. */}
            <DialogTitle
              className={cn('flex min-w-0 items-start gap-1.5 leading-snug', telephone && 'cursor-pointer')}
              data-titre-carte={telephone ? (tagsOuverts ? 'deplie' : 'replie') : 'ouvert'}
              onClick={telephone ? () => setTagsOuverts((v) => !v) : undefined}
            >
              {/* Le visage du projet devant le titre : on sait de quel projet
                  parle la tâche sans lire les étiquettes. */}
              {project ? (
                /* …ET IL MÈNE AU TABLEAU DE CE PROJET : la carte se referme,
                   le projet s'ouvre sur son tableau — même depuis « Tableaux
                   de bord ». Le clic ne remonte pas au titre, qui déplie les
                   étiquettes sur téléphone. */
                <button
                  type="button"
                  data-favicon-titre
                  data-ouvrir-tableau-projet={project.id}
                  aria-label="Ouvrir le tableau du projet"
                  title={t('Ouvrir le tableau du projet')}
                  className="mt-[3px] flex shrink-0 cursor-pointer rounded-sm transition-opacity hover:opacity-80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                  onClick={(event) => {
                    event.stopPropagation();
                    client.demanderTableau(project.id);
                  }}
                >
                  <PastilleProjet project={project} />
                </button>
              ) : null}
              {titreGenere ? (
                <Lightbulb data-titre-genere className="mt-[3px] h-4 w-4 shrink-0 text-en-cours" />
              ) : null}
              <span className={cn('min-w-0', titreGenere && 'font-semibold', telephone && !tagsOuverts && 'truncate')}>{card.title}</span>
            </DialogTitle>
            {tagsVisibles ? (
            <div data-tags-carte className="mt-1 flex flex-wrap items-center gap-1.5 text-[12.5px] text-faint">
              <Badge>{t(COLUMN_LABELS[card.column])}</Badge>
              {card.deployedAt ? (
                <Badge tone="success">
                  <Rocket className="h-2.5 w-2.5" /> {t('en ligne')}
                </Badge>
              ) : null}
              {/* Une carte ressortie garde sa trace : on doit voir qu'elle
                  était passée par « Archivé », et quand. */}
              {mentionArchivage(card) ? (
                <Tooltip label={t('Archivée le {v0}', { v0: new Date(card.archivedAt!).toLocaleString(formatRegional()) })}>
                  <Badge>
                    <Archive className="h-2.5 w-2.5" /> {mentionArchivage(card)}
                  </Badge>
                </Tooltip>
              ) : null}
              {/* Une carte qui se reprend le dit là où on lit son état : le
                  travail déjà fait est gardé, on ne repart pas de zéro. */}
              {mentionDeReprise(card) ? (
                <Tooltip label={mentionDeReprise(card)!}>
                  <Badge tone="warning">
                    <RotateCcw className="h-2.5 w-2.5" /> {t('reprise')}
                  </Badge>
                </Tooltip>
              ) : null}
              {/* LE SEUL AVIS QUI SE LIT ENCORE AVEC L'ÉTAT DE LA CARTE :
                  « demande pressante », sur une carte arrivée sans vous. Il ne
                  rouvre rien et ne change aucune colonne
                  (`shared/src/jugement-rapide.ts`). */}
              {[avisSurLUrgence(card)].map((avis) =>
                avis ? (
                  <Tooltip key={avis.cle} label={t(avis.phrase)}>
                    <Badge tone={avis.ton === 'attention' ? 'warning' : undefined} data-avis-etiquette={avis.cle}>
                      <AlertTriangle className="h-2.5 w-2.5" /> {t(avis.titre)}
                    </Badge>
                  </Tooltip>
                ) : null,
              )}
              {card.labels.map((label) => (
                <Badge key={label}>{label}</Badge>
              ))}
              <span>{t('modifiée {v0}', { v0: relativeTime(card.updatedAt) })}</span>
            </div>
            ) : null}
          </div>

          {/* Sur téléphone, un chevron déplie les tags repliés — placé juste
              avant le menu, à droite du titre. Absent sur ordinateur, où les
              tags sont toujours visibles. */}
          {telephone ? (
            <Button
              size="sm"
              variant="ghost"
              className="shrink-0 px-2"
              aria-label={tagsOuverts ? 'Masquer les étiquettes' : 'Afficher les étiquettes'}
              aria-expanded={tagsOuverts}
              onClick={() => setTagsOuverts((v) => !v)}
            >
              <ChevronDown className={cn('h-4 w-4 transition-transform', tagsOuverts && 'rotate-180')} />
            </Button>
          ) : null}

          {/* Les gestes rares vivent ici : ils prenaient une ligne entière en
              bas du tiroir. Menu déroulant sur ordinateur, tiroir pleine
              largeur sur téléphone — le composant s'en charge tout seul. */}
          {/* À gauche des trois points : le raccourci vers la configuration de
              l'agent, posé par la conversation quand son bloc a quitté l'écran. */}
          <div ref={setEmplacementReglages} data-emplacement-reglages className="flex shrink-0 empty:hidden" />
          <MenuCarte card={card} apresSuppression={onClose} />
        </div>
        {/* SUR TÉLÉPHONE, LA BARRE D'ÉTAPES EST COLLÉE SOUS LE TITRE, avant
            les onglets : la conversation la pose ici par un portail
            (`emplacementBarre`, `chat.tsx`). Sur ordinateur, elle vit en tête
            de la conversation. */}
        {telephone ? <div ref={emplacementBarre} data-emplacement-barre className="mt-1.5" /> : null}
      </header>

      <MentionDeRedaction card={card} />

      {/* La conversation a son propre onglet : les détails de l'agent ne la
          compriment plus en haut de l'écran. Elle s'ouvre dès qu'il y a quelque
          chose à y lire — une analyse en cours ou finie compte autant qu'un
          agent d'exécution. */}
      <Tabs
        key={card.id}
        value={ongletActif}
        onValueChange={setOnglet}
        onScrollCapture={surDefilement}
        /* LES BLOCS DU FIL PRENNENT LE FOND DE L'ONGLET OUVERT. La classe
           `blocs-au-fond-de-l-onglet` (`styles.css`) pose `--fond-bloc-fil` sur
           tout le volet : cadrage, analyse et questions s'y accordent au lieu
           de poser leur propre teinte. La couleur y est refaite à partir des
           trois fonds employés juste dessous — `--surface`, `--raised` à 35 %,
           `--bg` à 55 % — donc juste dans les douze palettes. */
        className="blocs-au-fond-de-l-onglet flex min-h-0 flex-1 flex-col"
      >
        {/* Les onglets collent au bord : la marge de la barre s'ajoutait à
            celle de la liste, et deux respirations superposées mangeaient une
            bonne part de la largeur sur téléphone.

            Sur téléphone, cette barre se replie quand on descend dans le
            contenu et revient quand on remonte — l'enveloppe se ferme en
            hauteur, l'onglet actif reste choisi. Sur ordinateur, rien ne bouge.

            Style verre (glassmorphism) : un SEUL conteneur porte un fond et
            un flou — plus l'ancien empilement piste (`bg-surface` sur
            `TabsList`) + onglet actif (`bg-raised`), qui doublait le cadre.
            La pilule de piste est neutralisée plus bas ; seul l'onglet actif
            garde un fond LÉGÈREMENT plus sombre, sans aucune ombre : un creux
            dessiné contredisait le parti pris plat de l'interface. */}
        <div
          data-barre-onglets
          data-cachee={telephone && !barreVisible ? '' : undefined}
          className={cn(
            'mx-4 flex-none overflow-hidden rounded-md border border-border/40 bg-raised/35 backdrop-blur-md transition-all duration-200',
            telephone ? 'mt-0.5' : 'mt-1',
            telephone && !barreVisible && 'max-h-0 opacity-0',
          )}
        >
        <ZoneDefilement axe="horizontal" classeEnveloppe="flex-none" className={telephone ? 'px-1 py-0.5' : 'px-1.5 py-1'}>
          <TabsList className="w-full border-0 bg-transparent">
            {/* La décision se prend DANS ce fil : l'onglet porte le même
                triangle que la carte du tableau, sinon le tiroir ouvert
                n'apprendrait plus rien. */}
            <TabsTrigger
              value="chat"
              className="flex-1 gap-1 data-[state=active]:bg-bg/55"
            >

{t('Conversation')}
<RepereAttention compte={decisions} icone={iconeDecision} data-attention-carte={card.id} />
            </TabsTrigger>
            {/* Cet onglet va CHERCHER ses données : tant qu'elles ne sont pas
                là, une petite roue le dit — sinon on ne sait pas si l'onglet
                est vide ou s'il arrive. */}
            <TabsTrigger
              value="comments"
              className="flex-1 gap-1 data-[state=active]:bg-bg/55"
            >

{t('Commentaires')}
<RoueDOnglet visible={!!chargement.comments} />
            </TabsTrigger>
            <TabsTrigger
              value="billing"
              className="flex-1 data-[state=active]:bg-bg/55"
            >
              {t('Facturation')}
            </TabsTrigger>
            <TabsTrigger
              value="github"
              className="flex-1 gap-1 data-[state=active]:bg-bg/55"
            >

{t('GitHub')}
<RoueDOnglet visible={!!chargement.github} />
            </TabsTrigger>
          </TabsList>
        </ZoneDefilement>
        </div>

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

        <TabsContent value="billing" className="flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden">
          <ZoneDefilement><BillingTab card={card} rate={project?.billing?.hourlyRate ?? 130} project={project} /></ZoneDefilement>
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

function RoueDOnglet({ visible }: { visible: boolean }) {
  return (
    <span data-onglet-charge={visible ? '' : undefined} className="inline-flex h-3 w-3 items-center justify-center">
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
  return (
    <div>
      <div className="flex min-h-[20px] items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1">
          <Label className="block">{label}</Label>
          {aide ? <BulleInfo cote="start">{aide}</BulleInfo> : null}
        </span>
        {action ?? null}
      </div>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Onglet Facturation                                                  */
/* ------------------------------------------------------------------ */

/**
 * LE BOUTON « IA » D'UN CHAMP DE TEXTE. Posé en haut à droite de son étiquette,
 * il ne réécrit QUE son champ : le serveur reçoit le nom du champ et le texte
 * actuel, et rend un texte nu qui remplace le contenu. Pendant la demande, le
 * bouton tourne — un bouton qui part en requête le dit dès le clic.
 */
function BoutonIA({
  cardId,
  field,
  valeur,
  onTexte,
}: {
  cardId: string;
  field: 'title' | 'description' | 'clientExplanation';
  valeur: string;
  onTexte: (texte: string) => void;
}) {
  const [encours, setEncours] = React.useState(false);

  const regenerer = async () => {
    if (encours) return;
    setEncours(true);
    try {
      const data = await client.call({ type: 'billing.regenerate', cardId, field, hint: valeur });
      if (data?.text) onTexte(String(data.text));
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('Régénération impossible'));
    } finally {
      setEncours(false);
    }
  };

  return (
    <button
      type="button"
      data-repere="bouton-ia"
      onClick={regenerer}
      disabled={encours}
      title={t('Régénérer ce texte')}
      aria-label="Régénérer ce texte"
      className={cn(
        'flex shrink-0 items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-[11.5px] font-medium',
        'text-muted transition-colors hover:bg-raised hover:text-text disabled:opacity-60',
      )}
    >
      {encours ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
      {t('IA')}
    </button>
  );
}

/**
 * LE TIROIR DE CHOIX DU DOCUMENT. Le menu déroulant d'avant n'affichait qu'une
 * suite de numéros : impossible de retrouver la facture d'un client sans les
 * ouvrir une à une. Ici, un champ de recherche en haut, le NOM DU CLIENT à
 * gauche, le titre du document et son numéro à droite ; la recherche filtre sur
 * l'un OU l'autre, et choisir referme le tiroir.
 *
 * Il s'empile par-dessus le tiroir de la carte, déjà ouvert (`empile`).
 */
function SelecteurDeDocument({
  open,
  onClose,
  documents,
  documentId,
  onChoisir,
}: {
  open: boolean;
  onClose: () => void;
  documents: any[];
  documentId: string;
  onChoisir: (id: string) => void;
}) {
  const [recherche, setRecherche] = React.useState('');

  // Le champ repart vide à chaque ouverture : un filtre oublié donnerait
  // l'impression que la liste s'est vidée toute seule.
  React.useEffect(() => {
    if (open) setRecherche('');
  }, [open]);

  const filtres = React.useMemo(() => {
    const mots = recherche.trim().toLowerCase();
    if (!mots) return documents;
    return documents.filter((doc) =>
      [doc.clientName, doc.number, doc.title].some((champ) => String(champ ?? '').toLowerCase().includes(mots)),
    );
  }, [documents, recherche]);

  const choisir = (id: string) => {
    onChoisir(id);
    onClose();
  };

  return (
    <Drawer open={open} onClose={onClose} empile className="max-h-[80dvh]">
      <header className="flex shrink-0 items-center gap-2 px-3 pb-2">
        <DialogTitle className="min-w-0 flex-1 truncate">{t('Choisir le document')}</DialogTitle>
      </header>

      <div className="shrink-0 px-3 pb-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" />
          <Input
            autoFocus
            value={recherche}
            onChange={(event) => setRecherche(event.target.value)}
            placeholder={t('Nom du client ou numéro…')}
            aria-label="Rechercher un document"
            className="pl-7"
          />
        </div>
      </div>

      <ZoneDefilement role="menu" aria-label="Documents" className="flex flex-col gap-1 px-2 pb-3">
        {/* Toujours en tête : repartir d'un document neuf. */}
        <LigneDeDocument actif={documentId === ''} onSelect={() => choisir('')}>
          <span className="min-w-0 flex-1 truncate text-text">{t('Nouveau document')}</span>
        </LigneDeDocument>

        {filtres.map((doc) => (
          <LigneDeDocument key={doc.id} actif={doc.id === documentId} onSelect={() => choisir(doc.id)}>
            <span className="w-[38%] shrink-0 truncate text-text">
              {doc.clientName || t('client inconnu')}
            </span>
            <span className="min-w-0 flex-1 truncate">{doc.title || t('sans titre')}</span>
            <span className="shrink-0 text-[11.5px] text-faint">{doc.number ?? ''}</span>
          </LigneDeDocument>
        ))}

        {filtres.length === 0 ? (
          <p className="px-2 py-6 text-center text-[13px] text-faint">{t('Aucun document ne correspond.')}</p>
        ) : null}
      </ZoneDefilement>
    </Drawer>
  );
}

function LigneDeDocument({
  actif,
  onSelect,
  children,
}: {
  actif: boolean;
  onSelect: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      role="menuitem"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect();
        }
      }}
      className={cn(
        'flex cursor-pointer items-center gap-2 rounded-md border px-2 py-1.5 text-[13px] outline-none',
        actif ? 'border-accent/60 bg-accent/10 text-text' : 'border-border text-muted hover:bg-raised',
      )}
    >
      {children}
    </div>
  );
}

function BillingTab({ card, rate, project }: { card: Card; rate: number; project?: { billing?: any; name?: string } }) {
  const [title, setTitle] = React.useState(card.billing?.title ?? card.estimate?.billingTitle ?? card.title);
  const [description, setDescription] = React.useState(card.estimate?.billingDescription ?? card.description);
  const [clientExplanation, setClientExplanation] = React.useState(
    card.billing?.clientExplanation ?? card.estimate?.clientExplanation ?? '',
  );
  const [hours, setHours] = React.useState(String(card.billing?.hours ?? card.estimate?.seniorHours ?? ''));
  const [documents, setDocuments] = React.useState<any[]>([]);
  const defaut = project?.billing?.defaultDocumentId as string | undefined;
  const [documentId, setDocumentId] = React.useState<string>(defaut ?? '');
  const [type, setType] = React.useState<'offer' | 'invoice'>(
    (project?.billing?.defaultDocumentType as 'offer' | 'invoice') ?? 'invoice',
  );
  const [available, setAvailable] = React.useState(true);
  const [confirmeNouveau, setConfirmeNouveau] = React.useState(false);
  /* Le tiroir de choix du document, empilé par-dessus celui de la carte. */
  const [selecteurOuvert, setSelecteurOuvert] = React.useState(false);

  React.useEffect(() => {
    client
      .call({ type: 'billing.documents' })
      .then((data) => setDocuments(data.documents ?? []))
      .catch(() => setAvailable(false));
  }, []);

  const amount = Number(hours) * rate;
  /* Le tiroir ne montre que les documents du TYPE choisi juste au-dessus :
     une facture ne se propose pas quand on remplit une offre. */
  const documentsDuType = React.useMemo(
    () => documents.filter((doc) => doc.type === type),
    [documents, type],
  );
  const choisi = documentsDuType.find((doc) => doc.id === documentId);

  const push = async () => {
    /* Un refus de saisie est un ÉCHEC, pas un geste réussi : on le RELANCE
       après l'avoir dit, sinon le bouton afficherait sa coche sans rien avoir
       envoyé. */
    if (!hours || Number.isNaN(Number(hours))) {
      const raison = t('Indiquez un nombre d\'heures');
      client.pushToast('warning', raison);
      throw new Error(raison);
    }
    // Sans document par défaut sur le projet, on ne devine pas : il faut dire
    // dans quelle facture ou quelle offre la ligne doit atterrir.
    if (!defaut && !documentId && !confirmeNouveau) {
      const raison = t('Choisissez le document, ou cochez « créer un nouveau document ».');
      client.pushToast('warning', raison);
      throw new Error(raison);
    }
    /* Le bouton pose lui-même sa roue : `push` lui REND sa requête, et une
       erreur dite en rouge doit être RELANCÉE pour qu'il n'affiche pas de
       coche sur un ajout raté. */
    try {
      await client.call({
        type: 'billing.push',
        cardId: card.id,
        documentType: type,
        documentId: documentId || undefined,
        title,
        description,
        clientExplanation,
        hours: Number(hours),
      });
    } catch (err: any) {
      client.pushToast('error', err?.message ?? 'ajout impossible');
      throw err;
    }
  };

  return (
    <div className="space-y-4 px-4 py-3">
      {card.billing ? (
        <div className="flex items-center gap-2 rounded-md border border-success/30 bg-success/5 px-2.5 py-2 text-[13.5px] text-success">
          <Check className="h-3.5 w-3.5" />
          
{t('Déjà facturée —')} {card.billing.documentType === 'offer' ? 'offre' : 'facture'}{' '}
          {card.billing.documentNumber ?? card.billing.documentId} · {money(card.billing.amount)}
        </div>
      ) : null}

      <Champ
        label={t('Titre de la ligne')}
        action={<BoutonIA cardId={card.id} field="title" valeur={title} onTexte={setTitle} />}
      >
        <Input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={80} />
      </Champ>

      <Champ
        label={t('Description')}
        action={<BoutonIA cardId={card.id} field="description" valeur={description} onTexte={setDescription} />}
      >
        <Textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={4} />
      </Champ>

      <Champ
        label={t('Explication client')}
        aide={t('Ce que le client lira sur son devis ou sa facture — simple et ludique, sans jargon ni nom de fichier.')}
        action={
          <BoutonIA
            cardId={card.id}
            field="clientExplanation"
            valeur={clientExplanation}
            onTexte={setClientExplanation}
          />
        }
      >
        <Textarea
          value={clientExplanation}
          onChange={(event) => setClientExplanation(event.target.value)}
          rows={3}
        />
      </Champ>

      <Champ
        label={t('Heures (développeur senior)')}
        aide={t('Les heures qu\'un développeur senior mettrait à la main — jamais la durée machine de l\'agent ({v0}).', { v0: duration(
          card.consumption?.machineSeconds,
        ) })}
      >
        <Input
          value={hours}
          onChange={(event) => setHours(event.target.value.replace(',', '.'))}
          inputMode="decimal"
          placeholder="ex. 2.5"
        />
      </Champ>

      {/* Le calcul est fait par l'outil de facturation : ici on ne fait que le montrer. */}
      <div className="flex items-center justify-between rounded-md border border-border bg-raised px-3 py-2">
        <span className="text-[13.5px] text-muted">
          {t('{v0} h × {rate} CHF', { v0: hours || '—', rate })}</span>
        <span className="text-[15.5px] font-semibold text-text">{hours ? money(amount) : '—'}</span>
      </div>

      {available ? (
        <>
          <Champ label={t('Type de document')}>
            <select
              value={type}
              onChange={(event) => setType(event.target.value as 'offer' | 'invoice')}
              className="h-9 w-full rounded-md border border-border bg-raised px-2 text-[14.5px] text-text"
            >
              <option value="invoice">{t('Facture')}</option>
              <option value="offer">{t('Offre')}</option>
            </select>
          </Champ>

          <Champ label={t('Document')}>
            {/* Le choix ne se fait plus dans un menu déroulant de numéros :
                ce bouton ouvre un tiroir cherchable, par client ou par numéro. */}
            <button
              type="button"
              data-repere="choisir-document"
              onClick={() => setSelecteurOuvert(true)}
              className="flex h-9 w-full items-center gap-2 rounded-md border border-border bg-raised px-2 text-left text-[14.5px] text-text"
            >
              <span className="min-w-0 flex-1 truncate">
                {choisi
                  ? [choisi.clientName, choisi.title || choisi.number].filter(Boolean).join(' — ')
                  : t('Nouveau document')}
              </span>
              <ChevronDown className="h-3 w-3 shrink-0 text-faint" />
            </button>
          </Champ>

          <SelecteurDeDocument
            open={selecteurOuvert}
            onClose={() => setSelecteurOuvert(false)}
            documents={documentsDuType}
            documentId={documentId}
            onChoisir={setDocumentId}
          />

          {!defaut && !documentId ? (
            <label className="flex items-start gap-2 rounded-md border border-border bg-raised px-2.5 py-2 text-[13px] text-muted">
              <input
                type="checkbox"
                checked={confirmeNouveau}
                onChange={(event) => setConfirmeNouveau(event.target.checked)}
                className="mt-0.5 h-3.5 w-3.5 shrink-0"
              />
              <span>
                {t('Ce projet n\'a pas de document attitré : cochez pour créer une nouvelle{v0} {v1} pour {v2}, ou choisissez un document existant ci-dessus.', { v0: ' ', v1: type === 'offer' ? 'offre' : 'facture', v2: project?.billing?.clientName ?? 'ce client' })}</span>
            </label>
          ) : null}

          <Button variant="default" size="sm" className="w-full" onClick={push}>
            <CircleDollarSign className="h-3 w-3" />
            
{t('Ajouter la ligne')}
</Button>
        </>
      ) : (
        <p className="text-[13.5px] text-faint">{t('L\'outil de facturation n\'est pas joignable depuis ce serveur.')}</p>
      )}
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

      <AttachmentPreview item={zoom} onClose={() => setZoom(null)} />
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
