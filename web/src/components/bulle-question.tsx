import * as React from 'react';
import { Check, Circle, Loader2, Paperclip, Pause, Play, RefreshCw, X } from 'lucide-react';
import { createPortal } from 'react-dom';
import { Attachment, REPONSE_GENERER_LE_LOT, REPONSE_REFUSER_LE_LOT, arrondi, genreDeMedia, mediaDeLOption, questionAMontrer, repereDuLibelle, reponseDuFormulaire, reponsePrete, texteDeReponse, type DevisDeLaQuestion, type FormulaireDeQuestions as Formulaire, type SphereDeLaQuestion } from '@beluga/shared';
import { EmplacementDeLaPagination } from '@/components/carousel-questions';
import { BarrePagination } from '@/components/ui/pagination-fleches';
import { BranchementDeService } from '@/components/branchement-de-service';
import { DevisDuLot } from '@/components/devis-du-lot';
import { ValidationAvecCout } from '@/components/validation-avec-cout';
import { CubeDeLumiere } from '@/components/scene-3d';
import { Button, Drawer, EnteteDeFeuille, Textarea, ZoneDefilement } from '@/components/ui';
import { useTelephone } from '@/lib/telephone';
import { AttachmentPreview, AttachmentThumb } from '@/components/attachment-preview';
import { ContexteCarteDuFil, MenuDuMediaDuFil } from '@/components/menu-du-media';
import { ImageDePiece, PastilleDeFichier } from '@/components/pastille-de-fichier';
import { client } from '@/lib/client';
import { useApp } from '@/lib/use-app';
import { cn } from '@/lib/utils';
import { useClasseDuCadreDeQuestion } from '@/lib/cadre-de-question';
import { t } from '@/lib/langue';
import { writePref } from '@/lib/prefs';
import { arreterLeSon, basculerSon, useLectureDeSon } from '@/lib/lecture-de-media';

/**
 * LE BROUILLON D'UNE RÉPONSE : le texte écrit dans la bulle, les choix cochés et
 * les images jointes, tant que la réponse n'est pas partie. Il vit CÔTÉ SERVEUR,
 * dans un réglage nommé d'après la question (`reponse.<question>`) : rien ne se
 * perd au rechargement, et chaque appareil ouvert le voit aussitôt — ce qu'on
 * ajoute au téléphone apparaît sur l'ordinateur, comme les autres réglages
 * partagés (demande du 09/10/2026). Il s'efface quand la réponse part ou que
 * la question se ferme (aussi côté serveur, `question.answer` / `question.cancel`).
 */
export interface BrouillonDeReponse {
  choisis: string[];
  texte: string;
  images: Attachment[];
}
const BROUILLON_VIDE: BrouillonDeReponse = { choisis: [], texte: '', images: [] };

/** Les clés des brouillons de réponse — une par question, jamais deux pour la même. */
export const cleDeBrouillonDeReponse = {
  outil: (questionId: string) => `reponse.${questionId}`,
  texte: (messageId: string) => `reponse.texte.${messageId}`,
  carte: (cardId: string, questionId: string) => `reponse.carte.${cardId}.${questionId}`,
};

function lireBrouillon(brut: unknown): BrouillonDeReponse {
  if (!brut || typeof brut !== 'object') return BROUILLON_VIDE;
  const b = brut as Partial<BrouillonDeReponse>;
  return {
    choisis: Array.isArray(b.choisis) ? b.choisis.filter((c): c is string => typeof c === 'string') : [],
    texte: typeof b.texte === 'string' ? b.texte : '',
    images: Array.isArray(b.images) ? b.images.filter((i): i is Attachment => !!i && typeof (i as Attachment).id === 'string') : [],
  };
}
const memesIds = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
const memesImages = (a: readonly Attachment[], b: readonly Attachment[]) =>
  memesIds(
    a.map((i) => i.id),
    b.map((i) => i.id),
  );
const memeBrouillon = (a: BrouillonDeReponse, b: BrouillonDeReponse) =>
  a.texte === b.texte && memesIds(a.choisis, b.choisis) && memesImages(a.images, b.images);

/**
 * Les pièces jointes d'un message : les images se voient tout de suite, les
 * autres fichiers se reconnaissent à leur nom. Un clic ouvre l'aperçu en grand.
 */
export function PiecesJointes({ ids, projectId }: { ids: string[]; projectId?: string }) {
  const state = useApp();
  /* Dans le fil d'une carte, chaque image, vidéo ou son porte son menu « … » (27/10/2026). */
  const carteDuFil = React.useContext(ContexteCarteDuFil);
  const [apercu, setApercu] = React.useState<Attachment | null>(null);
  const connues = projectId ? (state.attachments[projectId] ?? []) : [];

  // La liste du projet peut ne pas être encore chargée : on la demande.
  React.useEffect(() => {
    if (projectId && !state.attachments[projectId]) {
      client.send({ type: 'attachments.list', projectId });
    }
  }, [projectId]);

  const items = ids.map((id) => connues.find((item) => item.id === id)).filter(Boolean) as Attachment[];

  return (
    <>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {/* UNE PIÈCE ENCORE INCONNUE DU MAGASIN GARDE SON LIEN. Le repli était un
            badge MORT : on voyait « pièce jointe » sans pouvoir rien ouvrir, le
            temps que la liste du projet arrive. La pastille, elle, sait se
            rendre avec le seul identifiant — et le clic télécharge déjà. */}
        {items.length
          ? items.map((item) => (
              <AttachmentThumb
                key={item.id}
                item={item}
                onOpen={() => setApercu(item)}
                menu={carteDuFil ? <MenuDuMediaDuFil cardId={carteDuFil} attachmentId={item.id} className={item.mime.startsWith('audio/') ? 'static' : undefined} /> : undefined}
              />
            ))
          : ids.map((id) => <PastilleDeFichier key={id} id={id} />)}
      </div>
      <AttachmentPreview
        item={apercu}
        onClose={() => setApercu(null)}
        galerie={items.filter((item) => genreDeMedia(item.mime))}
        onNaviguer={setApercu}
      />
    </>
  );
}

/** Une option proposée : ce qu'il faut pour dessiner sa pastille. */
export interface OptionDeQuestion {
  id: string;
  label: string;
  description?: string;
  /** Une pièce jointe image qui illustre le choix : la zone devient un choix en images. */
  image?: string;
  /** Une pièce jointe son ou vidéo que le choix fait écouter : un bouton lecture à droite. */
  media?: string;
}

/** Une question à poser, quelle que soit la façon dont elle est arrivée. */
export interface QuestionAAfficher {
  /** Le texte de la question. Vide quand l'entête le dit déjà. */
  question?: string;
  /** Ce qu'il faut savoir pour répondre, lu sous la question et avant les choix. */
  description?: string;
  /** Les choix proposés, en pastilles. */
  options: OptionDeQuestion[];
  /** Un seul choix, ou plusieurs à la fois. */
  kind?: 'single' | 'multiple' | 'text';
  /** L'écriture libre est-elle ouverte à côté des choix ? */
  allowFreeText?: boolean;
  /**
   * LA RÉPONSE QUE L'AGENT CONSEILLE (questions gardées sur la carte) : le
   * libellé d'une option, marquée « Conseillé », ou une réponse libre, lue
   * sous la question.
   */
  recommandee?: string;
  /** Le bloc « Devis » d'un lot de générations payantes (outil « realiser », action « lot »). */
  devis?: DevisDeLaQuestion;
  /** L'encadré de branchement d'un service de création (outil « realiser », action « brancher »). */
  branchement?: { capacites: string[] };
  /** Le formulaire groupé du brief (outil « production », action « formulaire ») : 3 à 5 questions d'un coup. */
  formulaire?: Formulaire;
  /** La sphère de lumière (outil « realiser », action « lumiere ») : la direction se choisit à la souris ou au doigt. */
  lumiere?: SphereDeLaQuestion;
}

/**
 * LA BULLE DE QUESTION — LE SEUL ENDROIT OÙ L'ON RÉPOND À UN AGENT.
 *
 * Il y avait trois façons de poser une question à l'écran : la bulle de l'outil
 * `ask_user` (pastilles, images, « Répondre » / « Annuler »), la bulle jaune
 * d'une question écrite en texte ordinaire (un champ de saisie et rien d'autre)
 * et le tiroir de publication (des boutons d'option, la réponse écrite dans la
 * barre du tiroir). Trois rendus, trois comportements, trois endroits à
 * corriger — et surtout, pour l'utilisateur, deux manières différentes de faire
 * exactement le même geste.
 *
 * Il n'y en a plus qu'UNE. Ce composant porte la question, ses choix en
 * pastilles, l'écriture libre quand elle est ouverte, les images jointes et les
 * deux issues. Ce qui change d'un appelant à l'autre — ce que veut dire
 * « répondre », ce que veut dire « annuler » — arrive par `onRepondre` et
 * `onAnnuler` : le composant ne connaît AUCUN chemin réseau.
 *
 * UN CHAMP DE SAISIE NE PARAÎT PLUS SEUL : dès qu'un choix est lisible, il
 * s'affiche en pastille. C'est vrai même d'une question écrite en texte
 * ordinaire, dont les options sont relues dans la phrase
 * (`choixDeQuestionEnTexte`, `shared/src/question-en-texte.ts`).
 */

export function BulleQuestion(props: ProprietesDeLaBulle) {
  const telephone = useTelephone();
  /* UNE VALIDATION DE DÉPENSE (« Valider · prix ») N'EST PAS UNE QUESTION À
     RÉDIGER : titre, une ligne, deux boutons (`ValidationAvecCout`). Ni champ
     de réponse, ni Joindre, ni Annuler. */
  const devis = props.question.devis;
  if (devis?.bouton) {
    const cout = devis.sansPrix && !devis.total ? t('prix non publié') : `${arrondi(devis.total)} $${devis.sansPrix ? ` + ${t('prix non publié')}` : ''}`;
    return (
      <ValidationAvecCout
        titre={props.question.question ?? devis.titre}
        description={props.question.description}
        cout={cout}
        entete={props.entete}
        variante={props.variante}
        repere={{ ...(props.repere ?? {}), 'data-bulle-question': props.variante ?? 'neutre', 'data-validation-du-lot': devis.lotId }}
        onValider={() => props.onRepondre(REPONSE_GENERER_LE_LOT, [])}
        onRefuser={() => props.onRepondre(REPONSE_REFUSER_LE_LOT, [])}
      />
    );
  }
  const formulaire = props.question.formulaire?.questions.length ? props.question.formulaire : undefined;
  const reponsePossible = !!formulaire || props.question.options.length > 0 || !!props.question.allowFreeText;
  if (!telephone || !reponsePossible) return formulaire ? <BulleFormulaire {...props} formulaire={formulaire} /> : <BulleQuestionComplete {...props} />;
  return <BulleQuestionCompacte {...props} />;
}

/**
 * LE FORMULAIRE GROUPÉ DU BRIEF (responsable créatif) SE LIT COMME LES AUTRES
 * QUESTIONS (demande du 25/10/2026, capture #0035 : tout empilé, choix sur une
 * ligne, illisible). UNE question à la fois, dessinée par la bulle ordinaire
 * (`BulleQuestionComplete` : choix en liste, description, « Conseillé », champ
 * libre) — jamais un second dessin. Les flèches se posent dans l'entête du
 * panneau des décisions quand il en offre la place (`EmplacementDeLaPagination`),
 * sinon au-dessus de la question. Répondre à une sous-question la garde ICI et
 * passe seule à la suivante ; rien ne part avant la dernière : alors UN SEUL
 * envoi porte toutes les réponses (`reponseDuFormulaire`, format inchangé pour
 * l'agent). « Passer » laisse une question vide, qui part « (sans réponse) ».
 * Le brouillon de chaque sous-question vit côté serveur (`.<id>` ajouté à la clé).
 */
function BulleFormulaire(props: ProprietesDeLaBulle & { formulaire: Formulaire }) {
  const { formulaire, onRepondre, onAnnuler, cleDeBrouillon } = props;
  const questions = formulaire.questions;
  const [reponses, setReponses] = React.useState<Record<string, { texte: string; images: string[] }>>({});
  const [traitees, setTraitees] = React.useState<Record<string, boolean>>({});
  const [choisie, setChoisie] = React.useState<number | undefined>(undefined);
  const [envoi, setEnvoi] = React.useState(false);
  const emplacement = React.useContext(EmplacementDeLaPagination);
  const index = questionAMontrer({ repondues: questions.map((q) => !!traitees[q.id]), choisie });
  const courante = questions[index];
  const cleDe = (id: string) => (cleDeBrouillon ? `${cleDeBrouillon}.${id}` : undefined);

  const trancher = async (id: string, reponse: { texte: string; images: string[] } | null) => {
    const nouvelles = { ...reponses };
    if (reponse) nouvelles[id] = reponse;
    else delete nouvelles[id];
    const faites = { ...traitees, [id]: true };
    setReponses(nouvelles);
    setTraitees(faites);
    setChoisie(undefined);
    if (!questions.every((q) => faites[q.id])) return;
    /* TOUT EST TRANCHÉ : le seul envoi, comme l'ancien bouton « Envoyer les réponses ». */
    setEnvoi(true);
    try {
      const texte = reponseDuFormulaire(
        questions,
        Object.fromEntries(Object.entries(nouvelles).map(([cle, r]) => [cle, { choix: [], texte: r.texte }])),
      );
      await onRepondre(texte, [...new Set(Object.values(nouvelles).flatMap((r) => r.images))]);
      for (const q of questions) {
        const cle = cleDe(q.id);
        if (cle) writePref(cle, null);
      }
    } catch (err) {
      /* Refusé : la dernière question redevient ouverte, rien n'est perdu. */
      setTraitees((avant) => ({ ...avant, [id]: false }));
      throw err;
    } finally {
      setEnvoi(false);
    }
  };

  const pagination =
    questions.length > 1 ? (
      <BarrePagination
        index={index}
        total={questions.length}
        aller={setChoisie}
        repere="pagination-formulaire"
        libellePrecedent="question-precedente"
        libelleSuivant="question-suivante"
      />
    ) : null;
  const derniere = questions.filter((q) => !traitees[q.id]).length <= 1 && !traitees[courante.id];

  return (
    <div data-bulle-formulaire="" data-formulaire-questions={questions.length} data-formulaire-rang={index + 1}>
      {pagination && emplacement ? createPortal(pagination, emplacement) : pagination ? <div className="mb-1">{pagination}</div> : null}
      <BulleQuestionComplete
        key={courante.id}
        {...props}
        question={{
          question: courante.question,
          description: courante.description,
          kind: courante.kind,
          allowFreeText: true,
          options: courante.options.map((o) => ({ id: o.label, label: o.label, description: o.description })),
        }}
        entete={
          index === 0 && props.question.question ? (
            <>
              {props.entete}
              <p className="text-[12.5px] leading-snug text-faint" data-intitule-formulaire>
                {props.question.question}
              </p>
            </>
          ) : (
            props.entete
          )
        }
        repere={{ ...(props.repere ?? {}), 'data-question-formulaire': courante.id, ...(courante.champ ? { 'data-champ-formulaire': courante.champ } : {}) }}
        cleDeBrouillon={cleDe(courante.id)}
        garderLeBrouillon
        sansPlusDeChoix
        libelleRepondre={derniere ? t('Envoyer les réponses') : t('Suivant')}
        onRepondre={(texte, images) => trancher(courante.id, { texte, images })}
        onAnnuler={onAnnuler}
        actionsEnPlus={
          <Button
            variant="ghost"
            size="sm"
            disabled={envoi}
            title={t('Laisser cette question sans réponse')}
            onClick={() => void trancher(courante.id, null)}
            data-passer-question-formulaire=""
          >
            {t('Passer')}
          </Button>
        }
      />
    </div>
  );
}

/**
 * SUR TÉLÉPHONE, LA QUESTION SE RÉDUIT À SON INTITULÉ ET À « RÉPONDRE »
 * (demande du 22/10/2026). Les choix, la précision, le champ libre et les
 * pièces jointes mangeaient l'écran entier au-dessus de la barre d'écriture :
 * ils vivent désormais dans une FEUILLE DU BAS, ouverte par le bouton, qui
 * porte la bulle complète et se referme dès que la réponse est partie. Le
 * brouillon vit côté serveur (`cleDeBrouillon`) : refermer la feuille ne perd
 * rien. Sur ordinateur, rien ne change.
 */
function BulleQuestionCompacte(props: ProprietesDeLaBulle) {
  const { question, entete, variante = 'neutre', repere } = props;
  const [ouverte, setOuverte] = React.useState(false);
  const cadre = useClasseDuCadreDeQuestion();
  const repondre = async (reponse: string, images: string[]) => {
    await props.onRepondre(reponse, images);
    setOuverte(false);
  };
  const annuler = props.onAnnuler
    ? async () => {
        await props.onAnnuler!();
        setOuverte(false);
      }
    : undefined;
  return (
    <div
      className={cn(cadre, 'rounded-lg px-3 py-2.5', variante === 'neutre' ? 'bg-bloc-fil' : 'bg-raised')}
      data-bulle-question={variante}
      data-question-compacte=""
      {...(repere ?? {})}
    >
      {entete}
      {/* LE TEXTE À GAUCHE, QUI PASSE À LA LIGNE, ET « RÉPONDRE » À SA DROITE
          (demande du 25/10/2026, capture #1640) : le bouton posé sous
          l'intitulé laissait un grand vide à gauche. L'intitulé reste un TEXTE
          (copiable), jamais posé dans le bouton. */}
      <div className={cn('flex items-center gap-3', entete ? 'mt-1.5' : undefined)} data-rangee-question="">
        {question.question ? (
          <p data-intitule-question className="line-clamp-3 min-w-0 flex-1 text-[15px] font-medium leading-snug text-text">
            {question.question}
          </p>
        ) : (
          <span className="flex-1" />
        )}
        <Button size="sm" className="shrink-0" onClick={() => setOuverte(true)} data-repondre-question="">
          {t('Répondre')}
        </Button>
      </div>
      <Drawer open={ouverte} onClose={() => setOuverte(false)} feuille>
        <EnteteDeFeuille titre={t('Une question vous attend')} data-entete-feuille-question="" />
        {/* AUCUNE MARGE SOUS LA BULLE (capture #c913, 28/10/2026) : la barre
            « Répondre / Joindre / Annuler » colle au bord INTÉRIEUR de la zone
            qui défile — une marge basse laissait une bande où le texte des
            choix passait SOUS la barre. Le bas de la bulle est porté par la
            barre elle-même. */}
        <ZoneDefilement classeEnveloppe="min-h-0 flex-1" className="px-3 pb-0" data-zone-feuille-question="">
          {/* Dans la feuille, les flèches d'un formulaire restent au-dessus de sa question. */}
          <EmplacementDeLaPagination.Provider value={null}>
            {props.question.formulaire?.questions.length ? (
              <BulleFormulaire {...props} formulaire={props.question.formulaire} repere={{ 'data-feuille-question': '' }} onRepondre={repondre} onAnnuler={annuler} />
            ) : (
              <BulleQuestionComplete {...props} repere={{ 'data-feuille-question': '' }} onRepondre={repondre} onAnnuler={annuler} />
            )}
          </EmplacementDeLaPagination.Provider>
        </ZoneDefilement>
      </Drawer>
    </div>
  );
}

interface ProprietesDeLaBulle {
  question: QuestionAAfficher;
  /** Le projet : c'est lui qui porte les pièces jointes. */
  projectId?: string;
  /** L'agent qui a posé la question : les images lui sont rattachées. */
  agentId?: string;
  /** Une ligne posée au-dessus de la question (« L'agent attend votre réponse »). */
  entete?: React.ReactNode;
  /**
   * `attention` pose le liseré orange d'une question restée en travers du fil.
   * `contraste` garde le seul étage de fond, sans liseré : le bloc qui porte la
   * question dessine DÉJÀ son propre cadre jaune (panneau « Une décision
   * attend »), et deux cadres imbriqués se répondaient pour rien.
   */
  variante?: 'neutre' | 'attention' | 'contraste';
  /** Répondre : le texte assemblé, et les images retenues. */
  onRepondre: (reponse: string, images: string[]) => Promise<void>;
  /** Fermer la question sans répondre. Absent : pas de sortie proposée. */
  onAnnuler?: () => Promise<void>;
  /** Le repère de test posé sur le bloc. */
  repere?: Record<string, string>;
  /**
   * Le réglage où vit le brouillon de cette réponse (`cleDeBrouillonDeReponse`).
   * Absent : la réponse n'est gardée que dans cette page.
   */
  cleDeBrouillon?: string;
  /**
   * Les pièces jointes du message qui porte la question : c'est là qu'on
   * cherche d'abord le son ou la vidéo d'un choix (`mediaDeLOption`).
   */
  piecesDuMessage?: string[];
  /** Le libellé du bouton qui valide (« Répondre » par défaut ; « Suivant » dans un formulaire). */
  libelleRepondre?: string;
  /** Sans « Plus de choix » : une sous-question du formulaire ne relance pas l'agent. */
  sansPlusDeChoix?: boolean;
  /** Le brouillon reste après la réponse : on peut revenir sur une sous-question du formulaire. */
  garderLeBrouillon?: boolean;
  /** Un geste de plus dans la rangée des issues (« Passer » d'un formulaire). */
  actionsEnPlus?: React.ReactNode;
}

/**
 * LE CHAMP DE RÉPONSE RESTE AU-DESSUS DE LA BARRE COLLÉE EN BAS (capture
 * iPhone du 25/10/2026). Au focus, iOS ramène le champ juste au-dessus du
 * clavier, sans rien savoir de la barre « Répondre / Joindre / Annuler »
 * collée au bas de la zone qui défile (`sticky bottom-0`) : le champ finissait
 * dessous. La place du clavier est déjà réservée par la racine (`--clavier`,
 * app.tsx) ; ici, une fois le clavier monté (~350 ms, puis à chaque
 * `visualViewport` resize tant que le champ a le curseur), on ne fait défiler
 * la zone QUE si le bas du champ passe sous la barre ou sous la zone visible —
 * jamais de second saut quand iOS a déjà bien placé le champ. `scroll-mb-20`
 * sur le champ donne la même marge au défilement natif.
 */
function zoneQuiDefile(element: HTMLElement): HTMLElement | null {
  for (let noeud = element.parentElement; noeud; noeud = noeud.parentElement) {
    const { overflowY } = getComputedStyle(noeud);
    if ((overflowY === 'auto' || overflowY === 'scroll') && noeud.scrollHeight > noeud.clientHeight) return noeud;
  }
  return null;
}

function useChampAuDessusDeLaBarre(barreRef: React.RefObject<HTMLDivElement | null>) {
  return React.useCallback(
    (event: React.FocusEvent<HTMLTextAreaElement>) => {
      const champ = event.currentTarget;
      const vue = window.visualViewport;
      const recaler = () => {
        const barre = barreRef.current;
        if (!barre || document.activeElement !== champ) return;
        const boite = champ.getBoundingClientRect();
        const hautBarre = barre.getBoundingClientRect().top;
        const basVisible = vue ? vue.offsetTop + vue.height : window.innerHeight;
        // La barre vient APRÈS le champ dans le flux : à sa place, son haut est
        // déjà 8 px sous lui (mt-2) ; collée par-dessus, il remonte sur lui.
        const limite = Math.min(hautBarre, basVisible) - 8;
        const ecart = boite.bottom - limite;
        if (ecart <= 1) return;
        const zone = zoneQuiDefile(champ);
        if (zone) zone.scrollTop += ecart;
        else window.scrollBy(0, ecart);
      };
      const minuteurs = [120, 380].map((delai) => window.setTimeout(recaler, delai));
      const surRedimension = () => window.requestAnimationFrame(recaler);
      vue?.addEventListener('resize', surRedimension);
      champ.addEventListener(
        'blur',
        () => {
          minuteurs.forEach((m) => window.clearTimeout(m));
          vue?.removeEventListener('resize', surRedimension);
        },
        { once: true },
      );
    },
    [barreRef],
  );
}

function BulleQuestionComplete({
  question,
  projectId,
  agentId,
  entete,
  variante = 'neutre',
  onRepondre,
  onAnnuler,
  repere,
  cleDeBrouillon,
  piecesDuMessage,
  libelleRepondre,
  sansPlusDeChoix,
  garderLeBrouillon,
  actionsEnPlus,
}: ProprietesDeLaBulle) {
  /* Le brouillon tel que le serveur le tient : la bulle en part, et le suit. */
  const brut = React.useSyncExternalStore(
    client.subscribe,
    () => (cleDeBrouillon ? client.lireEtat().prefs[cleDeBrouillon] : undefined),
    () => undefined,
  );
  const empreinte = JSON.stringify(brut ?? null);
  const distant = React.useMemo(() => lireBrouillon(brut), [empreinte]);
  const [choisis, setChoisis] = React.useState<string[]>(distant.choisis);
  /** Le texte libre de la réponse, écrit directement dans la bulle. */
  const [texteLibre, setTexteLibre] = React.useState(distant.texte);
  /** Les images jointes à la réponse, avant l'envoi. */
  const [images, setImages] = React.useState<Attachment[]>(distant.images);
  /*
   * CE QUE LA BULLE REFLÉTAIT DU SERVEUR. Un changement venu d'ailleurs (l'autre
   * appareil) n'est suivi, champ par champ, que si la bulle montrait encore
   * l'ancienne valeur : une frappe en cours ici n'est jamais écrasée.
   */
  const dernierDistant = React.useRef<BrouillonDeReponse>(distant);
  React.useEffect(() => {
    const avant = dernierDistant.current;
    if (memeBrouillon(avant, distant)) return;
    dernierDistant.current = distant;
    setChoisis((actuel) => (memesIds(actuel, avant.choisis) ? distant.choisis : actuel));
    setTexteLibre((actuel) => (actuel === avant.texte ? distant.texte : actuel));
    setImages((actuel) => (memesImages(actuel, avant.images) ? distant.images : actuel));
  }, [distant]);
  const ecrireLeBrouillon = React.useCallback(
    (brouillon: BrouillonDeReponse) => {
      if (!cleDeBrouillon) return;
      dernierDistant.current = brouillon;
      const vide = !brouillon.choisis.length && !brouillon.texte && !brouillon.images.length;
      writePref(cleDeBrouillon, vide ? null : brouillon);
    },
    [cleDeBrouillon],
  );
  /* Chaque geste part au serveur : une case ou une image tout de suite, la
     frappe après 600 ms de calme (une écriture par pause, pas par lettre). */
  React.useEffect(() => {
    if (!cleDeBrouillon) return;
    const local: BrouillonDeReponse = { choisis, texte: texteLibre, images };
    const reflet = dernierDistant.current;
    if (memeBrouillon(local, reflet)) return;
    const seulLeTexte = memesIds(choisis, reflet.choisis) && memesImages(images, reflet.images);
    const minuteur = window.setTimeout(() => ecrireLeBrouillon(local), seulLeTexte ? 600 : 0);
    return () => window.clearTimeout(minuteur);
  }, [cleDeBrouillon, choisis, texteLibre, images, ecrireLeBrouillon]);
  const [apercu, setApercu] = React.useState<Attachment | null>(null);
  const mediaDe = useMediasDesChoix(question.options, projectId, agentId, piecesDuMessage);
  /** La vidéo d'un choix, ouverte en grand par-dessus l'écran. */
  const [video, setVideo] = React.useState<Attachment | null>(null);
  const [envoiFichier, setEnvoiFichier] = React.useState(false);
  const [envoi, setEnvoi] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const barreRef = React.useRef<HTMLDivElement>(null);
  const suivreLeClavier = useChampAuDessusDeLaBarre(barreRef);
  // Une question sans choix ni réponse libre n'offre aucune façon de répondre.
  // Elle doit alors donner une sortie nette, plutôt que laisser une zone vide
  // qui ressemble à un blocage.
  const reponsePossible = question.options.length > 0 || !!question.allowFreeText;

  /**
   * Joindre des pièces à la réponse : images ET fichiers (une maquette, une
   * charte, un PDF). On réutilise le dépôt de fichiers de la barre d'écriture,
   * à l'identique ; l'agent reçoit chaque pièce par son chemin.
   */
  const joindre = async (fichiers: FileList | File[]) => {
    const gardees = Array.from(fichiers).map((file) => ({ file }));
    if (!gardees.length) return;
    setEnvoiFichier(true);
    try {
      for (const { file } of gardees) {
        const response = await fetch(
          `/api/upload?project=${encodeURIComponent(projectId ?? '')}${agentId ? `&agent=${agentId}` : ''}`,
          {
            method: 'POST',
            headers: {
              'content-type': file.type || 'application/octet-stream',
              'x-file-name': encodeURIComponent(file.name),
            },
            body: file,
          },
        );
        const data = await response.json();
        const jointe: Attachment | undefined = data.attachment;
        if (!jointe) continue;
        // La même image envoyée deux fois ne s'ajoute qu'une fois.
        setImages((current) => (current.some((a) => a.id === jointe.id) ? current : [...current, jointe]));
      }
    } catch {
      client.pushToast('error', t('Envoi du fichier impossible'));
    } finally {
      setEnvoiFichier(false);
    }
  };

  /*
   * Ces deux gestes RENDENT leur requête : c'est le bouton qui pose sa roue,
   * sa coche et son retour à l'état initial. Le refus est dit en rouge PUIS
   * relancé — sans quoi le bouton croirait avoir réussi.
   */
  const envoyer = async () => {
    const libelles = question.options.filter((o) => choisis.includes(o.id)).map((o) => o.label);
    const reponse = texteDeReponse(libelles, texteLibre, images.length);
    if (!reponse) return;
    setEnvoi(true);
    try {
      await onRepondre(reponse, images.map((a) => a.id));
      // La réponse est partie : son brouillon n'a plus lieu d'être, nulle part.
      if (garderLeBrouillon) ecrireLeBrouillon({ choisis, texte: texteLibre, images });
      else ecrireLeBrouillon(BROUILLON_VIDE);
    } finally {
      setEnvoi(false);
    }
  };

  /*
   * « PLUS DE CHOIX » : aucun choix proposé ne convient. Le geste RÉPOND à la
   * question (l'agent arrêté sur `ask_user` reprend la main) par une consigne
   * qui lui demande d'autres possibilités et de reposer la question.
   */
  const [autresChoix, setAutresChoix] = React.useState(false);
  const demanderPlusDeChoix = async () => {
    const deja = question.options.map((o) => `« ${o.label} »`).join(', ');
    setAutresChoix(true);
    try {
      await onRepondre(
        `Aucun de ces choix ne me convient (${deja}). Propose-moi d'autres possibilités, différentes de celles-ci, et repose la question avec ask_user.`,
        [],
      );
      ecrireLeBrouillon(BROUILLON_VIDE);
    } finally {
      setAutresChoix(false);
    }
  };

  const basculer = (id: string) =>
    setChoisis((current) =>
      question.kind === 'multiple'
        ? current.includes(id)
          ? current.filter((c) => c !== id)
          : [...current, id]
        : current.includes(id)
          ? []
          : [id],
    );

  const libellesChoisis = question.options.filter((o) => choisis.includes(o.id)).map((o) => o.label);

  const pret = reponsePrete(libellesChoisis, texteLibre, images.length) && !envoi;
  /*
   * LA BULLE PORTE TOUT : options, texte libre et images. C'est le SEUL endroit
   * où répondre — le bouton « Répondre » valide ce qui s'y trouve.
   */
  const aValiderIci = question.options.length > 0 || images.length > 0 || !!question.allowFreeText;

  /* Les deux variantes non neutres posent le MÊME étage de fond (`--raised`) :
     ce qui se dessine par-dessus (zone de choix, pastille retenue, barre des
     issues) suit ce fond, pas le liseré. */
  const surFondRaised = variante !== 'neutre';
  /* …SAUF DANS LE PANNEAU « UNE DÉCISION ATTEND », qui porte le trait jaune
     autour de lui (`CadreDuPanneau`, demande du 27/10/2026). */
  const cadre = useClasseDuCadreDeQuestion();

  return (
    <div
      /* UN CADRE JAUNE AUTOUR DE CHAQUE QUESTION, PARTOUT (demande du
         25/10/2026) : panneau « Une décision attend », fil, feuille du bas,
         question en texte, questions préparées de la carte. La question doit
         se distinguer d'un coup d'œil du reste — c'est le seul trait jaune de
         l'interface avec le badge « Compréhension » (`.cadre-de-question`,
         styles.css). Le fond reste celui des autres blocs du fil. */
      /* Les variantes « attention » et « contraste » se détachent du bloc qui
         les porte par un ÉTAGE de fond différent (`--raised`). */
      className={cn(
        cadre,
        'rounded-lg px-3 py-2.5',
        variante === 'neutre' ? 'bg-bloc-fil' : 'bg-raised',
      )}
      /* UN REPÈRE STABLE POUR LES CONTRÔLES : la bulle se retrouvait par sa
         classe de liseré, qui n'existe plus dans le panneau de décision. Un
         contrôle ne vise plus une décoration, mais ce repère. */
      data-bulle-question={variante}
      {...(repere ?? {})}
      /* Une image lâchée n'importe où sur le bloc de la question se joint à la
         réponse : viser le champ au pixel près serait une contrainte inutile. */
      onPaste={reponsePossible ? (event) => {
        const fichiers = Array.from(event.clipboardData?.files ?? []);
        if (!fichiers.length) return;
        event.preventDefault();
        void joindre(fichiers);
      } : undefined}
      onDragOver={reponsePossible ? (event) => {
        if (event.dataTransfer.types.includes('Files')) event.preventDefault();
      } : undefined}
      onDrop={reponsePossible ? (event) => {
        const fichiers = Array.from(event.dataTransfer.files);
        if (!fichiers.length) return;
        event.preventDefault();
        void joindre(fichiers);
      } : undefined}
    >
      {entete}

      {/* 1. LA QUESTION, EN HAUT ET SEULE DANS SA ZONE.
          PAS D'ICÔNE ICI : l'étape « Questions de cadrage » de la timeline en
          porte déjà une. Deux points d'interrogation pour une seule question,
          c'était exactement le doublon reproché. */}
      {question.question ? (
        <p
          data-intitule-question
          className={cn('text-[15px] font-medium leading-snug text-text', entete ? 'mt-1.5' : undefined)}
        >
          {question.question}
        </p>
      ) : null}

      {/* 1 bis. CE QU'IL FAUT SAVOIR POUR RÉPONDRE, sous la question et AVANT
          les choix. L'agent noyait ce contexte dans l'intitulé — un paragraphe
          entier en gras, la vraie question perdue dedans — ou le laissait
          dehors, et l'on répondait à l'aveugle. Il se lit ici, en texte
          ordinaire : la question garde son poids, l'explication le sien. */}
      {question.description ? (
        <p
          data-description-question
          className={cn(
            'whitespace-pre-line text-[13.5px] leading-relaxed text-muted',
            question.question ? 'mt-1.5' : entete ? 'mt-1.5' : undefined,
          )}
        >
          {question.description}
        </p>
      ) : null}

      {/* 1 bis bis. CE QUE LA QUESTION AUTORISE OU DEMANDE DE BRANCHER (studio
          créatif) : le détail d'un devis, ou l'encadré où coller une clé. */}
      {question.devis ? <DevisDuLot devis={question.devis} /> : null}
      {question.branchement ? (
        <BranchementDeService capacites={question.branchement.capacites} onBranche={(reponse) => onRepondre(reponse, [])} />
      ) : null}
      {question.lumiere ? <CubeDeLumiere sphere={question.lumiere} onRepondre={onRepondre} /> : null}

      {/* 1 ter. LA RÉPONSE CONSEILLÉE QUI N'EST PAS UN CHOIX DE LA LISTE. */}
      {question.recommandee && !question.options.some((option) => option.label === question.recommandee) ? (
        <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted" data-reponse-conseillee>
          {t('Réponse conseillée : {v0}', { v0: question.recommandee })}
        </p>
      ) : null}

      {/* 2. LES RÉPONSES POSSIBLES, DANS LEUR PROPRE ZONE ET ANNONCÉES.
          Les pastilles suivaient la question sans rien qui les sépare : on ne
          savait pas si l'on regardait la fin de la phrase ou le début des
          choix, ni combien on avait le droit d'en prendre. La zone porte donc
          son intitulé — « Un seul choix » ou « Plusieurs réponses possibles » —
          et son propre fond, distinct de celui de la bulle. */}
      {question.options.length ? (
        <div
          className={cn(
            'mt-2 rounded-md px-2 py-1.5',
            surFondRaised ? 'bg-text/5' : 'bg-raised/40',
          )}
          data-zone-choix-question
        >
          <p className="mb-1 text-[12px] uppercase tracking-wide text-faint">
            {question.kind === 'multiple' ? t('Plusieurs réponses possibles') : t('Un seul choix')}
          </p>
          {question.options.some((option) => option.image) ? (
            <ChoixEnImages
              options={question.options}
              choisis={choisis}
              recommandee={question.recommandee}
              onBasculer={basculer}
            />
          ) : (
          <div className="space-y-1" data-choix-question>
          {question.options.map((option) => {
            const actif = choisis.includes(option.id);
            const media = mediaDe(option);
            return (
              /* LE BOUTON LECTURE EST VOISIN DU CHOIX, jamais dedans : un bouton
                 ne s'imbrique pas dans un autre, et écouter ne coche rien. */
              <div key={option.id} className="flex items-start gap-1">
              <button
                type="button"
                onClick={() => basculer(option.id)}
                data-option-question={option.id}
                data-option-retenue={actif ? '' : undefined}
                className={cn(
                  'flex min-w-0 flex-1 items-start gap-2 rounded-md px-2.5 sm:px-2 py-2 sm:py-1.5 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[hsl(var(--cadre-question))]',
                  /* LE CHOIX RETENU, ENCADRÉ DE JAUNE SUR UN FOND LÉGÈREMENT JAUNE
                     (demande du 28/10/2026, capture #4088) : le jaune des questions
                     (`--cadre-question`, `--comprehension-fond`), déclaré dans chaque
                     palette. Plus de violet ni d'anneau bleu de focus sur le choix. */
                  actif
                    ? 'bg-comprehension-fond text-text ring-1 ring-inset ring-[hsl(var(--cadre-question))]'
                    : surFondRaised
                      ? 'text-muted hover:bg-text/5'
                      : 'text-muted hover:bg-raised/60',
                )}
              >
                <span className="mt-0.5 shrink-0">
                  {actif ? <Check className="h-3 w-3 text-text" /> : <Circle className="h-3 w-3 text-faint" />}
                </span>
                <span className="min-w-0">
                  <span className="block text-[14px] leading-snug">
                    {option.label}
                    {question.recommandee && option.label === question.recommandee ? (
                      <span
                        className="ml-2 rounded bg-accent/15 px-1.5 py-0.5 text-[11.5px] font-medium text-accent"
                        data-option-conseillee
                      >
                        {t('Conseillé')}
                      </span>
                    ) : null}
                  </span>
                  {option.description ? (
                    <span className="block text-[12.5px] text-faint">{option.description}</span>
                  ) : null}
                </span>
              </button>
              {media ? <BoutonLecture piece={media} onVideo={setVideo} /> : null}
              </div>
            );
          })}
          </div>
          )}
          {reponsePossible && !sansPlusDeChoix ? (
            <button
              type="button"
              onClick={() => void demanderPlusDeChoix()}
              disabled={autresChoix || envoi}
              data-plus-de-choix
              title={t('Aucun choix ne convient : demander d’autres possibilités à l’agent')}
              className="mt-1 flex items-center gap-1.5 rounded-md px-2.5 sm:px-2 py-1.5 sm:py-1 text-[13px] text-muted transition-colors hover:bg-text/5 hover:text-text disabled:opacity-60"
            >
              {autresChoix ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
              {t('Plus de choix')}
            </button>
          ) : null}
        </div>
      ) : null}

      {/* 3. LA RÉPONSE LIBRE, DANS SA ZONE À ELLE — le SEUL endroit qui compte.
          La barre de la conversation reste libre pour autre chose. */}
      {question.allowFreeText ? (
        <div className="mt-2" data-zone-reponse-libre>
          <p className="mb-1 text-[12px] uppercase tracking-wide text-faint">
            {question.options.length ? t('Ou votre propre réponse') : t('Votre réponse')}
          </p>
        <Textarea
          value={texteLibre}
          data-question-texte
          onChange={(event) => setTexteLibre(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
            event.preventDefault();
            if (pret) void envoyer();
          }}
          placeholder={
            question.options.length
              ? t('Écrivez une précision, ou choisissez ci-dessus…')
              : t('Écrivez votre réponse…')
          }
          rows={2}
          onFocus={suivreLeClavier}
          className="scroll-mb-20 text-[13.5px]"
          data-champ-reponse-question
        />
        </div>
      ) : null}

      {/* Les images jointes en attente : la croix retire celle qu'on ne veut
          plus, et rien ne part avant le clic sur « Répondre ». */}
      {images.length ? (
        <div className="mt-1.5 flex flex-wrap gap-1.5" data-images-reponse>
          {images.map((image) => (
            <div key={image.id} className="relative" data-image-reponse={image.id}>
              <AttachmentThumb item={image} compact onOpen={() => setApercu(image)} />
              <button
                type="button"
                title={t('Retirer cette pièce jointe')}
                aria-label={`Retirer la pièce ${image.name}`}
                onClick={() => setImages((liste) => liste.filter((a) => a.id !== image.id))}
                className="absolute -right-1 -top-1 rounded-full bg-raised p-1 sm:p-0.5 text-faint shadow-sm transition-colors hover:bg-danger hover:text-sur-etat"
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <AttachmentPreview item={apercu} onClose={() => setApercu(null)} galerie={images} />
      <AttachmentPreview item={video} onClose={() => setVideo(null)} adresse="video-du-choix" />

      {/* Une question peut porter assez d'options pour dépasser l'écran. Les
          deux issues restent donc collées au bas du fil pendant sa lecture :
          répondre ou quitter ne doit jamais demander de deviner qu'un bouton
          se cache plus bas. */}
      <div
        className={cn(
          'sticky bottom-0 z-10 -mx-3 -mb-2.5 mt-2 flex flex-wrap items-center gap-1.5 border-t border-faint/15 px-3 py-2 backdrop-blur-sm',
          surFondRaised ? 'bg-raised/95' : 'bg-bloc-fil-voile',
        )}
        ref={barreRef}
        data-actions-question
        data-pied-colle
        data-question-sans-reponse={reponsePossible ? undefined : ''}
      >
        {reponsePossible ? (
          <>
            {aValiderIci ? (
              <Button
                variant="default"
                size="sm"
                disabled={!pret}
                onClick={envoyer}
                data-repondre-question
              >
                {envoi ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                {libelleRepondre ?? t('Répondre')}</Button>
            ) : null}
            <input
              ref={fileRef}
              type="file"
              multiple
              className="hidden"
              data-champ-image
              onChange={(event) => {
                if (event.target.files?.length) void joindre(event.target.files);
                event.target.value = '';
              }}
            />
            <Button
              variant="ghost"
              size="sm"
              title={t('Joindre une image ou un fichier')}
              aria-label="Joindre une pièce à la réponse"
              disabled={envoiFichier}
              onClick={() => fileRef.current?.click()}
            >
              {envoiFichier ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Paperclip className="h-3 w-3" />
              )}
{t('Joindre')}
</Button>
          </>
        ) : null}
        {actionsEnPlus}
        {/* Sans aucune façon de répondre, « Annuler » est la SEULE issue : il
            prend toute la largeur de la bulle, en bouton PLEIN (rouge au
            survol), au lieu de se faire passer pour un lien discret posé dans
            un coin. */}
        {onAnnuler ? (
          <Button
            variant={reponsePossible ? 'ghost' : 'arret'}
            size="sm"
            title={t('Fermer la question sans répondre')}
            onClick={async () => {
              await onAnnuler();
              ecrireLeBrouillon(BROUILLON_VIDE);
            }}
            data-annuler-question
            className={cn(
              reponsePossible
                ? 'text-faint hover:text-danger'
                : 'w-full justify-center',
            )}
          >
            <X className="h-3 w-3" />

{t('Annuler')}
</Button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * LE CHOIX EN IMAGES (mode Réalisation, 22/10/2026) : quand une option porte
 * une image (un aperçu fabriqué par le cadrage), la zone devient une grille de
 * vignettes cliquables, deux par ligne sur téléphone, trois au-delà. Le clic
 * bascule le choix comme une pastille ; le retenu porte le violet et sa coche.
 * Une option sans image garde sa vignette vide, son libellé dessous : rien ne
 * se perd d'une question mixte.
 */
function ChoixEnImages({
  options,
  choisis,
  recommandee,
  onBasculer,
}: {
  options: OptionDeQuestion[];
  choisis: string[];
  recommandee?: string;
  onBasculer: (id: string) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" data-choix-question data-choix-en-images>
      {options.map((option) => {
        const actif = choisis.includes(option.id);
        return (
          <button
            key={option.id}
            type="button"
            onClick={() => onBasculer(option.id)}
            data-option-question={option.id}
            data-option-retenue={actif ? '' : undefined}
            data-option-image={option.image ?? undefined}
            title={option.description ?? option.label}
            className={cn(
              'group flex min-w-0 flex-col overflow-hidden rounded-lg text-left transition-colors',
              actif ? 'bg-teinte-fond text-teinte' : 'bg-surface text-muted hover:bg-text/5',
            )}
          >
            <span className={cn('relative block aspect-square w-full overflow-hidden bg-raised', actif && 'ring-2 ring-inset ring-teinte')}>
              {option.image ? <ImageDePiece id={option.image} alt={option.label} className="h-full w-full object-cover" /> : null}
              {actif ? (
                <span className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-teinte text-bg">
                  <Check className="h-3 w-3" />
                </span>
              ) : null}
            </span>
            <span className="block min-w-0 px-2 py-1.5">
              <span className="block truncate text-[13px] font-medium leading-snug">{option.label}</span>
              {recommandee && option.label === recommandee ? (
                <span className="text-[11.5px] font-medium text-accent" data-option-conseillee>
                  {t('Conseillé')}
                </span>
              ) : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * LE SON OU LA VIDÉO DE CHAQUE CHOIX — lien posé par l'agent, sinon repère du
 * nom (`mediaDeLOption`, règle pure) : d'abord parmi les pièces du message de
 * la question, puis parmi toutes celles du même agent.
 */
function useMediasDesChoix(
  options: OptionDeQuestion[],
  projectId: string | undefined,
  agentId: string | undefined,
  piecesDuMessage: string[] | undefined,
): (option: OptionDeQuestion) => Attachment | undefined {
  const state = useApp();
  const peutEnAvoir = options.some((o) => o.media || repereDuLibelle(o.label));
  const connues = projectId ? state.attachments[projectId] : undefined;
  React.useEffect(() => {
    if (peutEnAvoir && projectId && !connues) client.send({ type: 'attachments.list', projectId });
  }, [peutEnAvoir, projectId, !connues]);
  const groupes = React.useMemo(() => {
    const liste = connues ?? [];
    const duMessage = (piecesDuMessage ?? [])
      .map((id) => liste.find((p) => p.id === id))
      .filter((p): p is Attachment => !!p);
    const deLAgent = agentId ? liste.filter((p) => p.agentId === agentId) : [];
    return [duMessage, deLAgent];
  }, [connues, piecesDuMessage, agentId]);
  return React.useCallback(
    (option: OptionDeQuestion) => {
      if (!peutEnAvoir) return undefined;
      const trouvee = mediaDeLOption(option, groupes);
      return trouvee ? (trouvee as Attachment) : undefined;
    },
    [groupes, peutEnAvoir],
  );
}

/**
 * LE BOUTON LECTURE D'UN CHOIX : un son se lit SUR PLACE (lecture / pause, un
 * seul à la fois), une vidéo s'ouvre EN GRAND par-dessus l'écran (décision du
 * 23/10/2026). Sans bordure ; violet tant que le son joue.
 */
function BoutonLecture({ piece, onVideo }: { piece: Attachment; onVideo: (piece: Attachment) => void }) {
  const etat = useLectureDeSon(piece.id);
  const estVideo = piece.mime.startsWith('video/');
  const libelle = estVideo ? t('Regarder') : etat === 'arret' ? t('Écouter') : t('Pause');
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        if (estVideo) {
          arreterLeSon();
          onVideo(piece);
        } else basculerSon(piece.id);
      }}
      aria-label={libelle}
      title={libelle}
      data-lecture-option={piece.id}
      data-lecture-etat={estVideo ? 'video' : etat}
      className={cn(
        'mt-0.5 shrink-0 rounded-md p-2 sm:p-1.5 transition-colors hover:bg-raised/60',
        etat === 'arret' ? 'text-muted hover:text-text' : 'text-teinte',
      )}
    >
      {etat === 'chargement' ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : etat === 'lecture' ? (
        <Pause className="h-4 w-4" />
      ) : (
        <Play className="h-4 w-4" />
      )}
    </button>
  );
}
