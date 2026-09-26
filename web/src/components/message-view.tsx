import * as React from 'react';
import {
  AlertCircle,
  BatteryLow,
  Check,
  ChevronRight,
  Circle,
  Copy,
  CornerDownRight,
  Download,
  FileText,
  GitMerge,
  History,
  LayoutGrid,
  Loader2,
  Paperclip,
  Play,
  RotateCcw,
  Route,
  Square,
  Volume2,
  X,
} from 'lucide-react';
import {
  Attachment,
  DEFINITIONS_NIVEAU,
  MEMORY_STEP_ID,
  Message,
  NIVEAUX_AGENT,
  NIVEAU_PAR_DEFAUT,
  NiveauAgent,
  TYPE_JOINTES_COLLABLES,
  reconnaitreErreur,
  choixDeQuestionEnTexte,
  choixPossible,
  comptesDeReprise,
  planDeCadrageRendu,
  heureExacte,
  propositionsDuFil,
  reponsePrete,
  emballerJointes,
  jointesDuMessage,
  texteAvecTagsDesJointes,
  texteAvecEtiquettes,
  tagsDuTexte,
  texteAEcouter,
  tempsRestant,
  texteDeReponse,
  triImages,
  TITRE_SYNTHESE,
  estLeMessageDeSynthese,
  retirerLaStructureDeCadrage,
  phraseDeLErreurDeTour,
} from '@beluga/shared';
import { direVoix, taireVoix, useVoix } from '@/lib/voix';
import { Badge, Button, DialogTitle, Drawer, Textarea, ZoneDefilement } from '@/components/ui';
import { Markdown } from '@/lib/markdown';
import { PlanRapport } from '@/components/plan-rapport';
import { RapportEnFlux } from '@/components/rapport-flux';
import { CarouselQuestions } from '@/components/carousel-questions';
import { BulleQuestion, PiecesJointes } from '@/components/bulle-question';
import { Steps } from '@/components/steps';
import { MemoryNote } from '@/components/todos';
import { AttachmentPreview, AttachmentThumb } from '@/components/attachment-preview';
import { BullesDuPromptEnvoye } from '@/components/prompt-envoye';
import { RunChoix, RunSelectors, nomCourtMoteur, resoudreRun } from '@/components/run-selectors';
import { client } from '@/lib/client';
import { useApp } from '@/lib/use-app';
import { cn, duration, heureDuMessage, jetons } from '@/lib/utils';
import { t } from '@/lib/langue';

/**
 * La ligne de repères sous un message : l'heure d'envoi, les jetons, ce qui est
 * propre à ce message (durée de travail), puis les boutons « Écouter » et
 * « Copier ».
 *
 * Une SEULE règle pour les deux côtés du fil : toujours visible, mise au second
 * plan par la couleur et la taille, jamais par la transparence. L'heure COURTE
 * est ce qu'on lit (`heureDuMessage`) ; l'heure exacte se donne en infobulle,
 * au survol. Elle est là sous CHAQUE bulle : le regroupement à la minute la
 * faisait disparaître dès qu'une réponse suivait dans la même minute.
 */
function LigneReperes({
  at,
  tokens,
  complements = [],
  texte,
  cle,
  aDroite = false,
  jointes = [],
}: {
  at: number;
  /** Les jetons de ce message : poids estimé de la demande sous une demande, total du tour sous une réponse. */
  tokens?: number;
  complements?: (string | null)[];
  texte: string;
  /** L'identifiant du message : sert au bouton d'écoute à savoir si c'est LUI qui parle. */
  cle: string;
  aDroite?: boolean;
  /** Les fichiers joints à ce message : la copie les emporte avec le texte. */
  jointes?: Attachment[];
}) {
  const visibles = complements.filter(Boolean) as string[];
  const compteJetons = jetons(tokens);
  return (
    <div
      className={cn(
        'mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12.5px] text-faint',
        aDroite && 'justify-end',
      )}
      data-ligne-reperes=""
    >
      <span data-heure-message="" title={heureExacte(at)}>
        {heureDuMessage(at)}
      </span>
      {/* LES JETONS DE CE MESSAGE, remis à la demande de l'utilisateur : ce que
          la demande a coûté en entrée, ce que le tour a coûté en tout. Absents
          d'un message qui n'a rien mesuré (un tour d'avant cette règle, une
          bulle de service) : on n'écrit jamais un faux « 0 ». */}
      {compteJetons ? <span data-jetons-message="">{compteJetons}</span> : null}
      {visibles.map((item, index) => (
        <span key={index}>{item}</span>
      ))}
      <BoutonEcoute texte={texte} cle={cle} />
      <BoutonCopier texte={texte} jointes={jointes} />
    </div>
  );
}

/**
 * L'ERREUR SOUS UNE RÉPONSE, telle quelle : c'est ce dont on a besoin pour
 * comprendre une panne.
 */
function ErreurDeMessage({ texte }: { texte: string }) {
  return (
    <div
      data-erreur-message
      className="mt-2 rounded-md border border-danger/30 bg-danger/5 px-2.5 py-2 text-[14.5px] leading-relaxed text-danger"
    >
      <div className="flex gap-2">
        <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span className="leading-relaxed">{texte}</span>
      </div>
      <ExplicationDeLErreur texte={texte} />
    </div>
  );
}

/**
 * CE QUE L'ERREUR VEUT DIRE, ET CE QU'ON EN FAIT.
 *
 * Le texte de la machine reste au-dessus, intact. Dessous, trois lignes en
 * français ordinaire : POURQUOI ce message est là, S'IL partira tout seul, et
 * QUOI FAIRE. Le genre est reconnu par une règle pure et partagée
 * (`shared/src/explication-erreur.ts`) ; les phrases vivent ici, parce qu'elles
 * seules passent par le dictionnaire des cinq langues.
 *
 * Une erreur qu'on ne sait pas nommer n'invente aucune explication : le texte
 * d'origine se suffit, et rien ne s'ajoute.
 */
function ExplicationDeLErreur({ texte }: { texte: string }) {
  const reconnue = reconnaitreErreur(texte);
  if (!reconnue) return null;

  const cause = {
    dossier: t('Un dossier attendu n’était pas là où le travail le cherchait.'),
    droits: t('Le compte qui exécute le travail n’a pas le droit d’écrire à cet endroit.'),
    disque: t('Le disque du serveur est plein : plus rien ne peut s’y écrire.'),
    reseau: t('Le service distant n’a pas répondu à temps, ou la liaison a été coupée.'),
    identifiant: t('L’accès a été refusé : l’identifiant utilisé n’est plus accepté.'),
    quota: t('Le compte du moteur a atteint sa limite d’utilisation.'),
    moteur: t('Le programme du moteur n’a pas pu être lancé sur ce serveur.'),
    construction: t('La construction du projet s’est arrêtée sur une erreur de code.'),
  }[reconnue.genre];

  const action = {
    dossier: t('Relancez la tâche : son dossier de travail est refait au lancement.'),
    droits: t('Cette erreur demande une intervention sur le serveur : elle ne partira pas d’elle-même.'),
    disque: t('Cette erreur demande de libérer de la place sur le serveur avant tout nouvel essai.'),
    reseau: t('Relancez dans un moment : ce genre de coupure se répare le plus souvent tout seul.'),
    identifiant: t('Reconnectez le compte concerné dans les réglages, puis relancez.'),
    quota: t('Attendez le renouvellement du quota, ou relancez sur un autre compte.'),
    moteur: t('Vérifiez que le moteur choisi est installé, ou choisissez-en un autre, puis relancez.'),
    construction: t('Relancez la tâche en demandant la correction : le détail ci-dessus dit où ça casse.'),
  }[reconnue.genre];

  return (
    <div className="mt-2 border-t border-danger/20 pt-1.5 text-[14.5px] leading-relaxed text-muted" data-explication-erreur={reconnue.genre}>
      <p>{cause}</p>
      <p className="mt-0.5">
        {reconnue.passagere ? t('C’est passager : un nouvel essai a de bonnes chances d’aboutir.') : t('Cela ne se réglera pas tout seul.')}
      </p>
      <p className="mt-0.5 font-medium text-text">{action}</p>
    </div>
  );
}

export function MessageView({
  message,
  allMessages,
  projectId,
  pickedEvolutions,
  onToggleEvolution,
  onToggleAll,
  onEcrireDansLeChamp,
  agentAuTravail = false,
  questionEnTexte = false,
  filAgentMasque = false,
}: {
  message: Message;
  /** La conversation entière : sert au cadre du plan à numéroter ses versions. */
  allMessages: Message[];
  /** Pour déplier la mémoire du projet sous l'étape de lecture. */
  projectId?: string;
  pickedEvolutions: string[];
  onToggleEvolution: (text: string) => void;
  onToggleAll: (items: string[]) => void;
  /** L'agent est-il encore au travail sur CE message ? Une étape « en cours »
   *  ne s'anime que là : partout ailleurs, c'est le reliquat d'un tour coupé. */
  agentAuTravail?: boolean;
  /** Déposer un texte dans la barre d'écriture, SANS rien envoyer : c'est ainsi
   *  qu'un refus et une suggestion d'optimisation reviennent à l'utilisateur,
   *  qui les complète puis décide d'envoyer (`shared/src/suggestions-de-plan.ts`). */
  onEcrireDansLeChamp?: (texte: string) => void;
  /** Ce message finit sur une question écrite en TEXTE ORDINAIRE, encore
   *  ouverte (`questionEnTexteLibre`, jugé par le fil qui connaît la carte). */
  questionEnTexte?: boolean;
  /** Le fil des recherches de l'agent ne se pose PAS ici. Sur une carte, il
   *  n'a qu'un seul endroit : le parcours, replié sous « Travail de l'agent »
   *  (`filDesRecherchesAffiche`, `shared/src/cadrage.ts`). */
  filAgentMasque?: boolean;
}) {
  const isUser = message.role === 'user';
  const state = useApp();

  /* LE BLOC DE DONNÉES D'UN ANCIEN CADRAGE NE SE LIT PAS COMME DU TEXTE : il
     est retiré partout où le message s'affiche (`structure-cadrage.ts`, le
     lecteur de l'histoire).
     Remonté avant les retours anticipés qui suivent : un hook appelé après un
     retour conditionnel change de nombre d'un rendu à l'autre selon le
     message affiché, ce que React interdit (erreur #300). */
  const contenuSansStructure = React.useMemo(
    () => retirerLaStructureDeCadrage(message.content),
    [message.content],
  );

  /*
   * LA SYNTHÈSE DU BESOIN OUVRE LE FIL, ET ELLE NE SE LIT PAS COMME UNE
   * DEMANDE. C'est un texte long, écrit avant même que
   * la carte existe : le serrer dans une bulle étroite à droite, en texte brut,
   * le rendrait illisible (`shared/src/synthese-du-besoin.ts`). Il prend donc
   * toute la largeur, sous son titre, et se lit en Markdown comme une réponse.
   */
  if (isUser && estLeMessageDeSynthese(message.id)) {
    return (
      <div className="w-[min(92%,860px)] min-w-0 max-w-full">
        <div className="rounded-lg border border-faint bg-raised px-3 py-2">
          <div className="mb-1.5 flex items-center gap-1.5 text-[12.5px] font-medium text-muted">
            <FileText className="h-3.5 w-3.5" />
            <span>{t(TITRE_SYNTHESE)}</span>
          </div>
          <Markdown className="texte-du-fil" content={message.content} />
        </div>
        <LigneReperes at={message.createdAt} complements={[]} texte={message.content} cle={message.id} />
      </div>
    );
  }

  if (isUser) {
    /* TOUS les fichiers joints voyagent avec la copie du message
       (`BoutonCopier`), pas seulement les images : coller la demande dans la
       barre d'écriture repose les mêmes pièces jointes au-dessus du champ. */
    const connues = projectId ? (state.attachments[projectId] ?? []) : [];
    const jointes = jointesDuMessage(message.attachments, connues);

    /*
     * Vos demandes : à droite, sur une largeur réduite — suivies, dès que le
     * prompt est réellement parti, du FIL qui résume les recherches de l'agent
     * (`BullesDuPromptEnvoye`). Il est rendu à gauche, sous cette demande.
     */
    return (
      <>
        <div className="flex justify-end">
          <div className="w-[min(78%,520px)] min-w-0 max-w-full">
            <div className="overflow-hidden rounded-lg rounded-br-sm border border-border bg-raised px-3 py-2">
              {/*
               * Une adresse ou un chemin sans espace ne doit JAMAIS élargir la
               * bulle : elle pousserait la conversation vers la droite, et la
               * moindre sélection ferait glisser tout le fil de côté.
               */}
              {/* LES TAGS SE LISENT PAR LEUR IDENTIFIANT COURT, comme dans la
                  barre d'écriture ; le texte enregistré (et copié) ne change pas. */}
              <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-[14.5px] leading-relaxed text-text">
                {texteAvecEtiquettes(message.content, jointes, tagsDuTexte(message.content))}
              </p>
              {message.attachments.length ? (
                <PiecesJointes ids={message.attachments} projectId={projectId} />
              ) : null}
            </div>
            <LigneReperes
              at={message.createdAt}
              tokens={message.tokens}
              complements={[]}
              texte={message.content}
              cle={message.id}
              aDroite
              jointes={jointes}
            />
          </div>
        </div>
        {message.sentContext && !filAgentMasque ? (
          <BullesDuPromptEnvoye contexte={message.sentContext} demandeDejaAffichee />
        ) : null}
      </>
    );
  }

  /*
   * L'ordre de lecture est toujours le même (PLAN §26) : d'abord la mémoire du
   * projet relue, puis le déroulé réel qui se coche au fur et à mesure. La
   * liste des tâches, elle, ne défile PLUS avec les messages : elle vit dans
   * son volet fixe, au bas de la conversation.
   */
  const memoire = message.steps.find((step) => step.id === MEMORY_STEP_ID);
  const etapes = message.steps.filter((step) => step.id !== MEMORY_STEP_ID);

  /* Les cartes proposées ENCORE EN ATTENTE ne vivent plus ici : elles sont
     dans le bandeau fixe, au-dessus de la barre d'écriture. Le fil garde
     celles qui ont déjà été validées ou refusées. */
  const decidees = propositionsDuFil(message.proposals);

  // Les réponses de l'agent occupent l'essentiel de la largeur.
  return (
    <>
      {/* UN TOUR LANCÉ PAR UN BOUTON N'A PAS DE BULLE DE DEMANDE : son contexte
          est porté par cette réponse. Son fil de recherche se pose donc ici,
          au-dessus de la réponse et du déroulé. */}
      {message.sentContext && !filAgentMasque ? <BullesDuPromptEnvoye contexte={message.sentContext} /> : null}
      <div className="group w-[min(92%,860px)] min-w-0 max-w-full">
        {memoire ? <MemoryNote step={memoire} projectId={projectId} /> : null}
        <Steps steps={etapes} streaming={message.streaming} projectId={projectId} agentAuTravail={agentAuTravail} />

        {contenuSansStructure ? (
          /* UN PLAN ÉCRIT EN CLAIR SE LIT COMME UN RAPPORT : le gabarit à
             quatre parties, sans cadre ni bouton — un plan ancien, rendu avant
             l'outil `rendre_plan`, s'affiche donc comme les autres. C'est la
             barre d'action de la carte qui lance, et elle seule. */
          planDeCadrageRendu(message) ? (
            <PlanRapport
              contenu={contenuSansStructure}
              courant
              pickedEvolutions={pickedEvolutions}
              onToggleEvolution={onToggleEvolution}
              onToggleAll={onToggleAll}
              streaming={message.streaming}
            />
          ) : (
            /* LA RÉPONSE FINALE SE LIT EN FLUX VERTICAL : une section du
               gabarit = un point du fil, avec son icône et son trait. Un texte
               sans assez de sections retombe tout seul sur le Markdown
               ordinaire (`RapportEnFlux`). */
            <RapportEnFlux
              contenu={contenuSansStructure}
              pickedEvolutions={pickedEvolutions}
              onToggleEvolution={onToggleEvolution}
              onToggleAll={onToggleAll}
              streaming={message.streaming}
            />
          )
        ) : message.streaming && !etapes.length ? (
          <p className="text-[14.5px] text-faint">{t('L\'agent réfléchit…')}</p>
        ) : null}

        {/* Seules les propositions DÉCIDÉES restent ici : celles qui attendent
            encore un clic sont sorties du fil et se posent dans le bandeau fixe
            au-dessus de la barre d'écriture (`propositionsDuFil`). */}
        {decidees.length ? (
          <div className="mt-2 space-y-1.5">
            {decidees.map((proposal) => (
              <ProposalChip key={proposal.id} proposal={proposal} />
            ))}
          </div>
        ) : null}

        {message.repriseCompte ? <RepriseDeCompteCard message={message} /> : null}

        {message.erreurDeTour ? <ErreurDeTourCard message={message} /> : null}

        {/* La question écrite en TOUTES LETTRES, pas par l'outil : elle n'avait
            aucune trace dans la bulle, et sa seule sortie vivait dans une bande
            posée au-dessus du champ d'écriture. Toute bulle qui attend un geste
            porte désormais sa sortie CHEZ ELLE. */}
        {questionEnTexte ? (
          <QuestionEnTexteCard
            messageId={message.id}
            agentId={message.agentId}
            projectId={projectId}
            contenu={message.content}
          />
        ) : null}

        {/* PLUSIEURS QUESTIONS SE FEUILLETTENT, elles ne s'empilent plus :
            une seule à l'écran, sa pagination en haut à droite, et le passage
            à la suivante dès qu'on a répondu. Une seule question s'affiche
            comme avant, sans cadre ajouté. */}
        {message.questions.length ? (
          <div className="mt-2">
            <CarouselQuestions
              questions={message.questions}
              cle={(question) => question.id}
              repondue={(question) => !!question.answer || !!question.cancelled}
              rendu={(question) => (
                <QuestionCard
                  messageId={message.id}
                  agentId={message.agentId}
                  projectId={projectId}
                  question={question}
                />
              )}
            />
          </div>
        ) : null}

        {message.downloads.length ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {message.downloads.map((offer) => (
              <a
                key={offer.id}
                href={`/api/download?token=${encodeURIComponent(offer.id)}`}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-raised px-2 py-1 text-[14.5px] text-text hover:bg-border"
              >
                <Download className="h-3 w-3" />
                {offer.label}
              </a>
            ))}
          </div>
        ) : null}

        {message.error ? <ErreurDeMessage texte={message.error} /> : null}

        {/* L'heure se montre TOUJOURS, ordinateur comme téléphone, et des deux
            côtés du fil : la mettre au second plan se fait par la COULEUR et la
            taille, jamais par la transparence — effacée, elle disparaît.
            La durée du tour ne se dit que sous les RÉPONSES : une demande ne
            « dure » pas. C'est du temps machine, sans rapport avec les heures
            facturées, d'où la formulation « de travail ». */}
        <LigneReperes
          at={message.createdAt}
          tokens={message.tokens}
          complements={[
            message.durationMs && message.durationMs >= 1000
              ? `${duration(message.durationMs / 1000)} de travail`
              : null,
            /* LE RANGEMENT D'APRÈS-RÉPONSE, quand il a duré. La réponse est là,
               mais l'agent tient encore son tour : constat du dépôt, dossier de
               la carte refermé, branche fusionnée. Ce temps n'était visible
               nulle part, et c'est lui qui explique un agent « occupé » sur une
               conversation qui paraît finie (`Message.rangementMs`). */
            message.rangementMs && message.rangementMs >= 1000
              ? `puis ${duration(message.rangementMs / 1000)} de rangement`
              : null,
          ]}
          texte={message.content}
          cle={message.id}
        />
      </div>
    </>
  );
}

/**
 * Écouter un message à voix haute, avec la voix de l'assistant. Un appui lit,
 * un second appui arrête ; écouter un autre message coupe celui-ci — une parole
 * chasse l'autre (la voix est partagée avec le module d'annonces). La lecture
 * passe outre le bouton « Muet », comme la réécoute d'une annonce.
 *
 * Un message long est ramené à ses premières phrases complètes (`texteAEcouter`),
 * jamais coupé au milieu d'un mot ; sans rien à lire, aucun bouton.
 */
function BoutonEcoute({ texte, cle }: { texte: string; cle: string }) {
  const { parle, cle: actif } = useVoix();
  const aLire = texteAEcouter(texte);
  if (!aLire) return null;

  const enCours = parle && actif === cle;
  return (
    <button
      type="button"
      onClick={() => (enCours ? taireVoix() : direVoix(aLire, cle))}
      title={enCours ? t('Arrêter la lecture') : t('Écouter le message')}
      aria-label={enCours ? 'Arrêter la lecture' : 'Écouter le message'}
      className="inline-flex shrink-0 items-center gap-1 rounded px-1 py-0.5 text-[12.5px] text-faint transition-colors hover:bg-surface hover:text-text"
    >
      {enCours ? (
        <Square className="h-2.5 w-2.5 text-success" />
      ) : (
        <Volume2 className="h-2.5 w-2.5" />
      )}
      {enCours ? t('Arrêter') : t('Écouter')}
    </button>
  );
}

/** Au-delà de ce poids, les images ne sont plus recopiées en clair dans le
 *  presse-papiers : le collage HORS de l'application perdra l'aperçu, jamais
 *  les fichiers eux-mêmes (qui voyagent par leur identifiant, sans poids). */
const POIDS_IMAGES_COPIEES = 4 * 1024 * 1024;

/** Le texte d'un message, échappé pour tenir dans la version HTML de la copie. */
function echapperHtml(texte: string): string {
  return texte
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * La version HTML de la copie : le texte, puis les images en clair. Elle ne
 * sert QU'AU DEHORS (un courriel, un traitement de texte) ; dans Beluga Build, ce
 * sont les pièces jointes d'origine qui sont recréées. Trop lourde, elle est
 * abandonnée : le texte et les fichiers, eux, passent toujours.
 */
async function htmlDeLaCopie(texte: string, images: Attachment[]): Promise<string | null> {
  if (!images.length) return null;
  const poids = images.reduce((total, item) => total + (item.size || 0), 0);
  if (poids > POIDS_IMAGES_COPIEES) return null;
  try {
    const morceaux = await Promise.all(
      images.map(async (item) => {
        const reponse = await fetch(`/api/attachment?id=${item.id}`);
        if (!reponse.ok) return null;
        const blob = await reponse.blob();
        if (!blob.type.startsWith('image/')) return null;
        const donnee = await new Promise<string | null>((resoudre) => {
          const lecteur = new FileReader();
          lecteur.onload = () => resoudre(typeof lecteur.result === 'string' ? lecteur.result : null);
          lecteur.onerror = () => resoudre(null);
          lecteur.readAsDataURL(blob);
        });
        return donnee ? `<img src="${donnee}" alt="${echapperHtml(item.name)}">` : null;
      }),
    );
    const balises = morceaux.filter(Boolean).join('');
    if (!balises) return null;
    return `${texte?.trim() ? `<pre>${echapperHtml(texte)}</pre>` : ''}${balises}`;
  } catch {
    return null;
  }
}

/**
 * Copier un message en entier. Le bouton reste discret et confirme d'un mot :
 * sans retour visible, on ne sait pas si le clic a pris.
 *
 * LES PIÈCES JOINTES VOYAGENT AVEC LE TEXTE, toutes, images comprises mais pas
 * seulement (`TYPE_JOINTES_COLLABLES`, `shared/src/presse-papiers-jointes.ts`) :
 * coller dans la barre d'écriture repose les fichiers D'ORIGINE au-dessus du
 * champ, comme si on venait de les ajouter. Elles partent par leur identifiant,
 * pas par leur contenu — rien n'est renvoyé au serveur.
 */
function BoutonCopier({
  texte: texteBrut,
  libelle = 'Copier',
  titre = t('Copier le message'),
  jointes = [],
}: {
  texte: string;
  libelle?: string;
  titre?: string;
  /** Copiées EN PLUS du texte : coller le message ré-attache ses fichiers. */
  jointes?: Attachment[];
}) {
  const [copie, setCopie] = React.useState(false);
  /* LE TEXTE COPIÉ NOMME SES FICHIERS. Un type de presse-papiers à nous ne
     survit pas au presse-papiers du SYSTÈME (téléphone) : les tags
     « [fichier: …] » sont alors le seul fil qui reste pour retrouver les
     fichiers d'origine au collage (`jointesDesTags`). */
  const texte = texteAvecTagsDesJointes(texteBrut ?? '', jointes);
  if (!texte?.trim() && !jointes.length) return null;

  const copierTexteSeul = () => {
    try {
      void navigator.clipboard.writeText(texte);
    } catch {
      // Presse-papiers refusé (page non sécurisée, vieux navigateur) : on passe
      // par un champ caché, la copie reste possible.
      const zone = document.createElement('textarea');
      zone.value = texte;
      zone.style.position = 'fixed';
      zone.style.opacity = '0';
      document.body.appendChild(zone);
      zone.select();
      document.execCommand('copy');
      zone.remove();
    }
  };

  /**
   * Une copie à PLUSIEURS TYPES : seul l'événement « copy » du navigateur
   * permet d'y glisser un type à nous. On passe donc par un champ caché
   * sélectionné, le temps d'un `execCommand` — la même mécanique que la copie
   * d'un tag « [fichier: …] » depuis la barre d'écriture.
   */
  const copierAvecJointes = (html: string | null): boolean => {
    const poser = (event: ClipboardEvent) => {
      event.preventDefault();
      event.clipboardData?.setData('text/plain', texte ?? '');
      event.clipboardData?.setData(TYPE_JOINTES_COLLABLES, emballerJointes(jointes));
      if (html) event.clipboardData?.setData('text/html', html);
    };
    const zone = document.createElement('textarea');
    zone.value = texte ?? ' ';
    zone.style.position = 'fixed';
    zone.style.opacity = '0';
    document.body.appendChild(zone);
    zone.select();
    document.addEventListener('copy', poser, { once: true, capture: true });
    let pris = false;
    try {
      pris = document.execCommand('copy');
    } catch {
      pris = false;
    }
    document.removeEventListener('copy', poser, { capture: true } as EventListenerOptions);
    zone.remove();
    return pris;
  };

  const copier = async () => {
    if (jointes.length) {
      const images = jointes.filter((item) => item.mime.startsWith('image/'));
      const html = await htmlDeLaCopie(texte, images);
      if (copierAvecJointes(html)) {
        setCopie(true);
        window.setTimeout(() => setCopie(false), 1800);
        return;
      }
      // Le navigateur refuse la copie à plusieurs types : le texte, au moins,
      // ne doit pas se perdre.
    }
    copierTexteSeul();
    setCopie(true);
    window.setTimeout(() => setCopie(false), 1800);
  };

  return (
    <button
      type="button"
      onClick={copier}
      title={titre}
      className="inline-flex shrink-0 items-center gap-1 rounded px-1 py-0.5 text-[12.5px] text-faint transition-colors hover:bg-surface hover:text-text"
    >
      {copie ? <Check className="h-2.5 w-2.5 text-success" /> : <Copy className="h-2.5 w-2.5" />}
      {copie ? t('Copié') : libelle}
    </button>
  );
}


/**
 * Une question de l'agent : il attend votre réponse pour reprendre. Choix
 * unique, choix multiple ou texte libre — et toujours la possibilité d'ajouter
 * une précision.
 */
export function QuestionCard({
  messageId,
  agentId,
  projectId,
  question,
  sansEntete,
}: {
  messageId: string;
  /** L'agent qui a posé la question : les images lui sont rattachées. */
  agentId?: string;
  projectId?: string;
  question: Message['questions'][number];
  /**
   * Le bloc qui porte cette question dit DÉJÀ qu'une réponse est attendue —
   * c'est le cas du bandeau fixe posé au-dessus de la barre d'écriture
   * (`QuestionsDeLaCarte`, `chat.tsx`). L'entête serait alors la même phrase
   * deux fois de suite, à deux lignes d'intervalle.
   */
  sansEntete?: boolean;
}) {
  if (question.cancelled) {
    return (
      <div
        className="rounded-lg bg-bloc-fil px-3 py-2.5"
        data-question-agent={question.id}
      >
        <p className="text-[14.5px] leading-relaxed text-faint">{question.question}</p>
        <p className="mt-1 flex min-w-0 items-start gap-1.5 text-[14.5px] leading-relaxed text-faint">
          <X className="mt-0.5 h-3 w-3 shrink-0 text-faint" />
          
{t('Question annulée')}
</p>
      </div>
    );
  }

  if (question.answer) {
    return (
      <div
        className="rounded-lg bg-bloc-fil px-3 py-2.5"
        data-question-agent={question.id}
      >
        <p className="text-[14.5px] leading-relaxed text-faint">{question.question}</p>
        <p className="mt-1 flex min-w-0 items-start gap-1.5 text-[14.5px] leading-relaxed text-text">
          <Check className="mt-0.5 h-3 w-3 shrink-0 text-success" />
          <span className="min-w-0 flex-1 truncate" data-reponse-question>
            {question.answer}
          </span>
        </p>
        {/* La réponse déjà donnée montre ses images, à côté de son texte. */}
        {question.answerAttachments?.length ? (
          <PiecesJointes ids={question.answerAttachments} projectId={projectId} />
        ) : null}
      </div>
    );
  }

  /*
   * LE RENDU EST CELUI DE `BulleQuestion`, PARTAGÉ AVEC TOUTES LES AUTRES
   * QUESTIONS. Ne reste ici que ce qui est propre à une question de l'outil :
   * par où part la réponse, et par où part l'annulation.
   */
  return (
    <BulleQuestion
      question={question}
      projectId={projectId}
      agentId={agentId}
      /* UNE QUESTION SANS RÉPONSE EST « EN COURS » : elle prend le liseré
         orange et son propre étage de fond, sinon elle se confondait avec le
         bloc de cadrage qui la porte. SAUF quand le bloc qui la porte dit déjà
         l'attente (`sansEntete`, panneau de décision) : il a son propre cadre
         jaune, et le liseré intérieur n'était qu'un second cadre. */
      variante={sansEntete ? 'contraste' : 'attention'}
      entete={
        sansEntete ? undefined : (
          <p className="flex items-start gap-1.5 text-[14.5px] leading-relaxed text-text">
            <CornerDownRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
            <span className="min-w-0">{t('L’agent attend votre réponse')}</span>
          </p>
        )
      }
      repere={{ 'data-question-agent': question.id }}
      onRepondre={async (reponse, attachments) => {
        try {
          await client.call({
            type: 'question.answer',
            messageId,
            questionId: question.id,
            answer: reponse,
            attachments,
          });
        } catch (err: any) {
          client.pushToast('error', err?.message ?? t('réponse impossible'));
          throw err;
        }
      }}
      onAnnuler={async () => {
        try {
          await client.call({ type: 'question.cancel', messageId, questionId: question.id });
        } catch (err: any) {
          client.pushToast('error', err?.message ?? 'annulation impossible');
          throw err;
        }
      }}
    />
  );
}

/**
 * LA QUESTION ÉCRITE EN TOUTES LETTRES, dans sa bulle — ET SES CHOIX.
 *
 * L'agent a fini son tour sur une question posée en texte ordinaire, sans
 * passer par l'outil `ask_user`. Cette bulle portait alors son PROPRE champ de
 * saisie : deux façons de répondre à une question coexistaient à l'écran, celle
 * de l'outil avec ses pastilles, et celle-ci avec un champ vide — alors que le
 * texte de l'agent énumère presque toujours les réponses qu'il attend.
 *
 * Elle passe désormais par `BulleQuestion`, comme toutes les autres : les choix
 * lus dans la phrase (`choixDeQuestionEnTexte`) s'affichent en pastilles, et
 * l'écriture libre reste ouverte à côté — l'agent n'ayant rien déclaré, on ne
 * peut jamais garantir que la liste soit complète.
 *
 * Le texte part par le MÊME chemin qu'un message ordinaire (`agent.prompt`) :
 * la question n'a pas d'identifiant d'outil, c'est le tour suivant de l'agent
 * qui la referme. La bulle disparaît alors toute seule — le dernier message du
 * fil n'étant plus la question (`questionEnTexteLibre`, jugé par le fil).
 */
export function QuestionEnTexteCard({
  messageId,
  agentId,
  projectId,
  contenu,
  sansEntete,
}: {
  messageId: string;
  agentId?: string;
  projectId?: string;
  /** Le texte du message : c'est en lui que se lisent les choix proposés. */
  contenu: string;
  /** Le bloc qui la porte annonce déjà l'attente : voir `QuestionCard`. */
  sansEntete?: boolean;
}) {
  const choix = React.useMemo(() => choixDeQuestionEnTexte(contenu), [contenu]);
  const question = React.useMemo(
    () => ({
      /* La question elle-même se lit juste au-dessus, dans la réponse de
         l'agent : la redire ici ferait deux fois la même phrase. */
      question: '',
      kind: 'single' as const,
      options: choix.map((label, rang) => ({ id: `texte-${rang}`, label })),
      /* TOUJOURS ouverte : les choix sont DEVINÉS, pas déclarés. Enfermer la
         réponse dans une liste qu'on a extraite soi-même serait un piège. */
      allowFreeText: true,
    }),
    [choix],
  );

  return (
    <div className="mt-2" data-question-en-texte={messageId}>
      <BulleQuestion
        question={question}
        projectId={projectId}
        agentId={agentId}
        /* Voir `QuestionCard` : le panneau de décision porte déjà son cadre. */
        variante={sansEntete ? 'contraste' : 'attention'}
        entete={
          sansEntete ? undefined : (
            <p className="flex items-start gap-1.5 text-[14.5px] leading-relaxed text-text">
              <CornerDownRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
              <span className="min-w-0">{t('L’agent attend votre réponse')}</span>
            </p>
          )
        }
        onRepondre={async (reponse) => {
          if (!agentId) return;
          try {
            await client.call({ type: 'agent.prompt', agentId, text: reponse });
          } catch (err: any) {
            client.pushToast('error', err?.message ?? t('envoi impossible'));
            throw err;
          }
        }}
        onAnnuler={async () => {
          try {
            await client.call({ type: 'question.cancelTexte', messageId });
          } catch (err: any) {
            client.pushToast('error', err?.message ?? 'annulation impossible');
            throw err;
          }
        }}
      />
    </div>
  );
}

/**
 * « AVEC QUEL COMPTE POURSUIVRE ? »
 *
 * Le tour a été coupé net par la limite d'un compte. Le travail n'est pas
 * cassé : il lui manque du quota. Ce bloc propose les AUTRES comptes du même
 * moteur — jamais un autre moteur, jamais le compte tombé — et le clic relance
 * le même agent, avec son fil, sa branche et ses étapes restantes.
 *
 * La liste n'est pas figée dans le message : elle se calcule à chaque rendu
 * depuis le relevé de quota reçu par l'application. Un compte qui se libère
 * apparaît donc TOUT SEUL, sans recharger la page — c'est ce qui fait tenir le
 * cas « aucun compte libre pour l'instant ».
 */
export function RepriseDeCompteCard({ message }: { message: Message }) {
  const { quotas, engines, agents } = useApp();
  const [busy, setBusy] = React.useState(false);
  const reprise = message.repriseCompte!;
  /*
   * LE MOTEUR ET LE MODÈLE DE LA REPRISE SE CHOISISSENT ICI, avec le même menu
   * que la barre d'écriture. Par défaut, ceux du tour coupé : garder les deux
   * reprend le même fil, en changer ouvre un fil neuf avec passation.
   */
  const modeleActuel = agents[message.agentId]?.run.model;
  const [moteur, setMoteur] = React.useState<string>(reprise.engine);
  const [modele, setModele] = React.useState<string | undefined>(modeleActuel);

  const tousLesChoix = React.useMemo(
    () =>
      comptesDeReprise(
        reprise.engine,
        reprise.compteEpuise,
        quotas.map((quota) => ({
          id: quota.id,
          label: quota.label,
          engine: quota.engine,
          // Un compte à sa LIMITE CONNUE n'est pas proposé, quoi qu'en dise le
          // relevé : le moteur l'a refusé (`limiteConnue`, posée par le démon).
          disponible: quota.available !== false && !quota.disabled && !quota.limiteConnue,
          coupe: quota.disabled,
          consommePct: Math.max(quota.session?.usedPct ?? 0, quota.weekly?.usedPct ?? 0),
          resetsAt: [quota.session?.resetsAt, quota.weekly?.resetsAt]
            .filter((v): v is number => typeof v === 'number' && v > 0)
            .sort((a, b) => a - b)[0],
        })),
        { tousMoteurs: true },
      ),
    [quotas, reprise.engine, reprise.compteEpuise],
  );
  const choix = tousLesChoix.filter((compte) => compte.engine === moteur);
  const possible = choixPossible(choix);
  /* Les AUTRES moteurs qui ont un compte libre : un clic y bascule le choix. */
  const autresMoteursLibres = [...new Set(tousLesChoix.filter((c) => c.disponible && c.engine !== moteur).map((c) => c.engine))];

  // Décision déjà prise — ou reprise déjà CONSOMMÉE par son tour : le bloc
  // reste dans le fil, refermé, et dit sur quel compte le travail est reparti.
  // Aucun bouton — on ne repart pas deux fois, et la question ne se repose pas.
  if (reprise.choisi || reprise.consommeeA) {
    return (
      <div
        className="mt-2 rounded-md border border-border bg-surface/60 px-2.5 py-2"
        data-reprise-compte="reprise"
      >
        <p className="flex min-w-0 items-start gap-1.5 text-[14.5px] leading-relaxed text-muted">
          <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
          <span className="min-w-0">
            {reprise.automatique
              ? t('Le compte « {v0} » avait atteint sa limite : Beluga Build a poursuivi automatiquement sur « {v1} ».', { v0: reprise.compteEpuiseLabel, v1: reprise.choisiLabel ?? reprise.choisi })
              : t('Le compte « {v0} » avait atteint sa limite : le travail a repris sur « {v1} ».', { v0: reprise.compteEpuiseLabel, v1: reprise.choisiLabel ?? reprise.choisi })}
            {reprise.choisiModele ? ` ${t('Modèle : {v0}.', { v0: reprise.choisiModele })}` : ''}</span>
        </p>
      </div>
    );
  }

  /*
   * DÉCISION ABANDONNÉE : la carte a été rangée, ou l'on a cliqué « Annuler ».
   * Même forme refermée que le choix fait — le bloc reste dans le fil parce
   * qu'il raconte pourquoi le travail s'est arrêté là, mais il ne réclame plus
   * rien et n'est plus jaune.
   */
  if (reprise.abandonnee) {
    return (
      <div
        className="mt-2 rounded-md border border-border bg-surface/60 px-2.5 py-2"
        data-reprise-compte="abandonnee"
      >
        <p className="flex min-w-0 items-start gap-1.5 text-[14.5px] leading-relaxed text-muted">
          <X className="mt-0.5 h-3.5 w-3.5 shrink-0 text-faint" />
          <span className="min-w-0">
            {t('Le compte « {v0} » avait atteint sa limite : le travail n’a pas été repris.', { v0: reprise.compteEpuiseLabel })}</span>
        </p>
      </div>
    );
  }

  const reprendre = async (accountId: string) => {
    setBusy(true);
    try {
      // Le modèle ne part que s'il change quelque chose : sinon le démon garde celui de l'agent.
      const autreModele = modele && (moteur !== reprise.engine || modele !== modeleActuel) ? modele : undefined;
      await client.call({ type: 'reprise.compte', messageId: message.id, accountId, ...(autreModele ? { model: autreModele } : {}) });
    } catch (err: any) {
      client.pushToast('warning', err?.message ?? 'reprise impossible');
    } finally {
      setBusy(false);
    }
  };

  const abandonner = async () => {
    setBusy(true);
    try {
      await client.call({ type: 'reprise.abandon', messageId: message.id });
    } catch (err: any) {
      client.pushToast('error', err?.message ?? 'annulation impossible');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="mt-2 rounded-md border border-warning/40 bg-warning/5 px-2.5 py-2"
      data-reprise-compte="attente"
    >
      <p className="flex items-start gap-1.5 text-[14.5px] font-medium leading-relaxed text-text">
        <BatteryLow className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
        
{t('Avec quel compte poursuivre ?')}
</p>
      <p className="mt-1 text-[14.5px] leading-relaxed text-muted">
        {t('Le compte « {v0} » a atteint sa limite en plein travail {v1}. Le travail n’est pas perdu : il repart où il s’est arrêté, avec le même agent et la même branche.', { v0: reprise.compteEpuiseLabel, v1: tempsRestant(reprise.resetsAt) ? ` (${tempsRestant(reprise.resetsAt)})` : '' })}</p>

      {/* LE MOTEUR ET LE MODÈLE, même menu que la barre d'écriture. Un autre
          moteur reprend sur un fil neuf, avec ce qui a déjà été fait. */}
      <div className="mt-2" data-reprise-moteur={moteur}>
        <RunSelectors
          engines={engines}
          choix={{ engine: moteur as RunChoix['engine'], model: modele }}
          pleineLargeur
          onSelect={(patch) => {
            if (patch.engine && patch.engine !== moteur) {
              setMoteur(patch.engine);
              setModele(patch.engine === reprise.engine ? modeleActuel : undefined);
            } else if (patch.model) setModele(patch.model);
          }}
        />
        {moteur !== reprise.engine ? (
          <p className="mt-1 text-[12.5px] text-faint" data-reprise-passation>
            {t('Autre moteur : un fil neuf reprend avec la branche, le plan, les étapes faites et les derniers échanges.')}</p>
        ) : null}
      </div>

      {possible ? (
        <div className="mt-2 space-y-1">
          {choix
            .filter((compte) => compte.disponible)
            .map((compte) => (
              <button
                key={compte.id}
                type="button"
                disabled={busy}
                data-compte-reprise={compte.id}
                onClick={() => void reprendre(compte.id)}
                className="flex w-full items-center gap-2 rounded-md border border-border bg-transparent px-2 py-1.5 text-left text-muted transition-colors hover:bg-raised disabled:opacity-60"
              >
                {busy ? (
                  <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
                ) : (
                  <Circle className="h-3 w-3 shrink-0 text-faint" />
                )}
                <span className="min-w-0 flex-1 truncate text-[14.5px] text-text">{compte.label}</span>
                {typeof compte.consommePct === 'number' ? (
                  <span className="shrink-0 text-[12.5px] text-faint">
                    {t('{v0} % consommés', { v0: Math.round(compte.consommePct) })}</span>
                ) : null}
              </button>
            ))}
        </div>
      ) : (
        <p className="mt-2 text-[14.5px] leading-relaxed text-warning" data-reprise-attente>
          {t('Aucun autre compte n’est libre pour l’instant. Ce choix reste ouvert et s’actualise tout seul : dès qu’un compte retrouve du quota, il apparaît ici.')}</p>
      )}

      {/* Rien de libre sous ce moteur, mais ailleurs si : on le dit, d'un clic. */}
      {!possible && autresMoteursLibres.length ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5" data-reprise-autres-moteurs>
          <span className="text-[12.5px] text-muted">{t('Libre sous un autre moteur :')}</span>
          {autresMoteursLibres.map((id) => (
            <Button
              key={id}
              variant="outline"
              size="sm"
              data-reprise-basculer-moteur={id}
              onClick={() => {
                setMoteur(id);
                setModele(undefined);
              }}
            >
              {nomCourtMoteur(engines.find((e) => e.id === id) ?? { id, label: id })}
            </Button>
          ))}
        </div>
      ) : null}

      {/* Les comptes du même moteur encore à sec : les nommer vaut mieux qu'un
          vide, on sait ce qu'on attend et pour combien de temps. */}
      {choix.some((compte) => !compte.disponible) ? (
        <ul className="mt-2 space-y-0.5">
          {choix
            .filter((compte) => !compte.disponible)
            .map((compte) => (
              <li key={compte.id} className="flex items-center gap-2 px-2 text-[12.5px] text-faint">
                <span className="min-w-0 flex-1 truncate">{compte.label}</span>
                <span className="shrink-0">{tempsRestant(compte.resetsAt) ?? t('à sec')}</span>
              </li>
            ))}
        </ul>
      ) : null}

      {/*
       * LA SORTIE, DANS LA BULLE. C'était la seule bulle jaune du fil à n'en
       * avoir aucune : quand plus aucun compte ne devait revenir, elle restait
       * allumée à vie et gardait « Répondre » sur sa carte. Comme sur une
       * question d'outil, le bouton prend TOUTE LA LARGEUR quand il est la
       * seule issue, et se fait discret dès qu'un compte est proposé à côté.
       */}
      <div className="mt-2 flex justify-end">
        <Button
          variant={possible ? 'ghost' : 'outline'}
          size="sm"
          disabled={busy}
          title={t('Fermer sans reprendre le travail')}
          onClick={() => void abandonner()}
          data-annuler-reprise
          className={cn(
            possible
              ? 'text-faint hover:text-danger'
              : 'w-full justify-center border-danger/40 text-danger hover:bg-danger/10 hover:text-danger',
          )}
        >
          <X className="h-3 w-3" />
          {t('Annuler')}
        </Button>
      </div>
    </div>
  );
}

/**
 * « UNE ERREUR A ARRÊTÉ LE TRAVAIL » — ni une panne passagère (elle s'est déjà
 * retentée toute seule), ni une limite de compte (sa propre bulle jaune) :
 * une erreur qui a coupé le tour net et qui reste sans réponse tant que
 * personne n'a choisi. Trois issues, jamais de choix par défaut : relancer le
 * même agent, ignorer (le travail déjà fait suffit), ou arrêter (la carte
 * revient en « Planifié »).
 */
export function ErreurDeTourCard({ message }: { message: Message }) {
  const [busy, setBusy] = React.useState<'relancer' | 'ignorer' | 'arreter' | null>(null);
  const erreur = message.erreurDeTour!;
  /*
   * RIEN N'AVAIT COMMENCÉ. Quand le tour est mort avant même le lancement du
   * moteur, la demande de l'utilisateur est restée seule au fil : elle voyage
   * dans la décision (`demandeARejouer`). Les trois issues sont les mêmes, mais
   * les mots changent — « relancer le travail » ne veut rien dire d'un travail
   * qui n'a jamais démarré, et le geste attendu est de RENVOYER la phrase.
   */
  const demandePerdue = !!erreur.demandeARejouer;

  if (erreur.choix) {
    const libelle =
      erreur.choix === 'relancer'
        ? demandePerdue
          ? t('Votre demande a été renvoyée.')
          : t('Le travail a été relancé.')
        : erreur.choix === 'ignorer'
          ? t('L’erreur a été ignorée : la carte est rangée telle quelle.')
          : t('Le travail a été arrêté : la carte est revenue en « Demande ».');
    return (
      <div className="mt-2 rounded-md border border-border bg-surface/60 px-2.5 py-2" data-erreur-de-tour="decidee">
        <p className="flex min-w-0 items-start gap-1.5 text-[14.5px] leading-relaxed text-muted">
          <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
          <span className="min-w-0">{libelle}</span>
        </p>
      </div>
    );
  }

  const repondre = async (choix: 'relancer' | 'ignorer' | 'arreter') => {
    setBusy(choix);
    try {
      await client.call({ type: 'erreur.repondre', messageId: message.id, choix });
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('réponse impossible'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mt-2 rounded-md border border-danger/40 bg-danger/5 px-2.5 py-2" data-erreur-de-tour="attente">
      <p className="flex items-start gap-1.5 text-[14.5px] font-medium leading-relaxed text-text">
        <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-danger" />
        {demandePerdue ? t('Votre demande n’est jamais partie') : t('Une erreur a arrêté le travail')}
      </p>
      {/* LA PHRASE SIMPLE D'ABORD : un message de machine (code système,
          sortie de git, trace) se lit par sa famille ou par le classement de
          Laya ; le texte brut reste à un clic, pour qui veut le voir. */}
      <p className="mt-1 text-[14.5px] leading-relaxed text-muted" data-erreur-phrase>
        {t(phraseDeLErreurDeTour(erreur))}
      </p>
      {phraseDeLErreurDeTour(erreur) !== erreur.cause ? (
        <details className="mt-1 text-[12.5px] text-muted">
          <summary className="cursor-pointer select-none">{t('Détail technique')}</summary>
          <p className="mt-0.5 whitespace-pre-wrap break-words font-mono text-[12.5px]">{erreur.cause}</p>
        </details>
      ) : null}
      {/* Les trois boutons ne disent pas LEQUEL choisir : l'explication, si. */}
      <ExplicationDeLErreur texte={erreur.cause} />

      <div className="mt-2 flex flex-wrap justify-end gap-1.5">
        <Button
          variant="outline"
          size="sm"
          disabled={busy !== null}
          onClick={() => void repondre('arreter')}
          data-erreur-arreter
        >
          {busy === 'arreter' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Square className="h-3 w-3" />}
          {t('Arrêter')}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={busy !== null}
          onClick={() => void repondre('ignorer')}
          data-erreur-ignorer
        >
          {busy === 'ignorer' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
          {t('Ignorer')}
        </Button>
        <Button
          variant="default"
          size="sm"
          disabled={busy !== null}
          onClick={() => void repondre('relancer')}
          data-erreur-relancer
        >
          {busy === 'relancer' ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
          {demandePerdue ? t('Renvoyer ma demande') : t('Relancer')}
        </Button>
      </div>
    </div>
  );
}

/**
 * Une carte proposée DÉJÀ DÉCIDÉE, laissée à sa place dans le fil : elle
 * appartient à l'histoire de l'échange. Celles qui attendent encore un clic ne
 * passent plus par ici — elles vivent dans le bandeau fixe au-dessus de la
 * barre d'écriture (`BandeauPropositions`), où le défilement ne les emporte
 * pas.
 */
function ProposalChip({ proposal }: { proposal: Message['proposals'][number] }) {
  const state = useApp();
  const [lancement, setLancement] = React.useState(false);

  if (proposal.decision === 'accepted') {
    const card = proposal.cardId ? state.cards[proposal.cardId] : undefined;
    const peutLancer = card && card.column === 'planned';

    const lancer = (event: React.MouseEvent) => {
      event.stopPropagation();
      if (!card || lancement) return;
      const chiffree = !!card.estimate || !!card.analyseDemandee;
      setLancement(true);
      Promise.resolve()
        .then(() => (chiffree ? undefined : client.validerCarte(card)))
        .then(() => client.demanderLeLancement(card.id))
        .catch(() => {})
        .finally(() => setLancement(false));
    };

    return (
      /* CE N'EST PAS UN `button`, ET C'EST VOULU : sous WebKit (Safari, donc
         tous les navigateurs de l'iPhone), la boîte de contenu d'un `button`
         réclame à la mise en page la hauteur du texte ENTIER d'un paragraphe
         replié — la pastille se dessinait bien sur deux lignes, mais son
         parent en réservait vingt, d'où le grand vide sous une carte validée.
         Un bloc ordinaire muni du rôle « bouton » se mesure honnêtement, et
         garde le clic, le clavier et l'annonce aux lecteurs d'écran. */
      <div
        data-carte-proposee="validee"
        role="button"
        tabIndex={0}
        onClick={() => proposal.cardId && client.openCard(proposal.cardId)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          if (proposal.cardId) client.openCard(proposal.cardId);
        }}
        className="w-full cursor-pointer rounded-md border border-success/40 bg-surface px-3 py-2.5 text-left transition-colors hover:bg-raised"
      >
        <div className="mb-1.5 flex items-center gap-1.5 text-[12.5px] text-success">
          <Check className="h-3 w-3" />
          
{t('Carte créée dans « Demande »')}
</div>
        <p className="text-[14.5px] font-medium leading-snug text-text">{proposal.title}</p>
        {proposal.description ? (
          <p className="mt-1 line-clamp-2 text-[14.5px] leading-relaxed text-muted">{proposal.description}</p>
        ) : null}
        {proposal.labels.length ? (
          <div className="mt-2 flex flex-wrap gap-1">
            {proposal.labels.map((label) => (
              <Badge key={label}>{label}</Badge>
            ))}
          </div>
        ) : null}
        {peutLancer ? (
          <Button size="sm" variant="outline" className="mt-2" disabled={lancement} onClick={lancer}>
            <Play className="h-3 w-3" /> {lancement ? t('Lancement…') : t('Lancer')}
          </Button>
        ) : null}
      </div>
    );
  }

  if (proposal.decision === 'merged') {
    return (
      <div className="flex items-center gap-2 rounded-md border border-accent/30 bg-surface/60 px-3 py-2 text-[14.5px] text-muted">
        <GitMerge className="h-3 w-3 shrink-0 text-accent" />
        <span className="min-w-0 flex-1 truncate">{proposal.title}</span>
        <span className="text-[12.5px]">{t('réunie dans une autre proposition')}</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-surface/60 px-3 py-2 text-[14.5px] text-faint">
      <X className="h-3 w-3 shrink-0" />
      <span className="min-w-0 flex-1 truncate line-through">{proposal.title}</span>
      <span className="text-[12.5px]">{t('carte refusée')}</span>
    </div>
  );
}
