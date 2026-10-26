import * as React from 'react';
import { ChevronDown, Clapperboard, History, ImageIcon, Loader2, MessageSquarePlus, Palette, Pencil, Play, RotateCcw } from 'lucide-react';
import {
  arrondi,
  decoupageDuMedia,
  estRetenu,
  etatDesPlans,
  phaseDesEsquisses,
  realisationDeLaCarte,
  sonDuBrief,
  elementsCourants,
  type EtatDuPlan,
  etiquetteDeCorrection,
  type EtapeDEcriture,
  etapesDuSuivi,
  voletDuMedia,
  LIBELLES_TYPES_DE_MEDIA_DE_REALISATION,
  typesDeMediaDeLaRealisation,
  LIBELLE_ETAPE_DE_SUIVI,
  type BlocDuMedia,
  type EtapeDuMedia,
  type EtapeDuVoletDuMedia,
  heureExacte,
  blocsDePiece,
  piecesAffichees,
  type Attachment,
  type Card,
  type EtapeDuSuivi,
  type EtatDEtapeDuSuivi,
  type MediaDuSuivi,
  type VersionDuSuivi,
  type TodoItem,
} from '@beluga/shared';
import { AttachmentPreview } from '@/components/attachment-preview';
import { LecteurSon } from '@/components/lecteur-son';
import { VignetteVideo } from '@/components/lecteur-video';
import { ContexteAgentDuFil, InformationsDuMedia, MenuDuMedia } from '@/components/menu-du-media';
import { ImageDePiece } from '@/components/pastille-de-fichier';
import { CaseDeTache } from '@/components/todos';
import {
  Drawer,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EnteteDeFeuille,
  Textarea,
  ZoneDefilement,
} from '@/components/ui';
import { LectureDuCahierDeRealisation } from '@/components/realisation-volet';
import { studioDuMedia, useEtapesDuMedia } from '@/lib/production-de-carte';
import { ouvrirLeDocument } from '@/lib/document-de-carte';
import { Button } from '@/components/ui';
import { client } from '@/lib/client';
import { joindreAuChamp } from '@/lib/joindre-au-champ';
import { Markdown } from '@/lib/markdown';
import { useProduction } from '@/lib/production-de-carte';
import { useApp } from '@/lib/use-app';
import { cn, heureDuMessage, heureOuDate } from '@/lib/utils';
import { t } from '@/lib/langue';

/*
 * Les libellés, traduits ici : le partagé garde le français (`LIBELLES_ETAPES_DU_SUIVI`).
 */
const LIBELLES_ETAPES: Record<EtapeDuSuivi, () => string> = {
  brief: () => t('Brief'),
  direction: () => t('Direction artistique'),
  style: () => t('Style'),
  scenario: () => t('Scénario'),
  ecriture: () => t('Écriture'),
  storyboard: () => t('Storyboard'),
  plans: () => t('Plans'),
  creation: () => t('Création'),
  son: () => t('Son'),
  'creation-sonore': () => t('Création sonore'),
  montage: () => t('Montage'),
  export: () => t('Export'),
  livraison: () => t('Livraison'),
};
const LIBELLES_ETATS: Record<EtatDEtapeDuSuivi, () => string> = {
  'a-definir': () => t('À définir'),
  'en-cours': () => t('En cours'),
  'a-valider': () => t('À valider'),
  validee: () => t('Validée'),
  terminee: () => t('Terminée'),
  erreur: () => t('En erreur'),
};

/** L'étape se coche comme une tâche (MEM-5458) : faite, en cours ou à valider, à venir, en erreur. */
function etatDeTache(etat: EtatDEtapeDuSuivi): TodoItem['state'] {
  if (etat === 'validee' || etat === 'terminee') return 'done';
  if (etat === 'en-cours' || etat === 'a-valider') return 'running';
  if (etat === 'erreur') return 'unfinished';
  return 'todo';
}

/**
 * LE VOLET DE SUIVI D'UNE PRODUCTION (studio créatif, 24/10/2026). À droite de
 * la conversation d'une carte caméra, dans le volet du document
 * (`card-panel.tsx`) ; une page entière sur téléphone.
 *
 * UN ACCORDÉON VERTICAL D'ÉTAPES (demande ferme de l'utilisateur, 24/10/2026 —
 * le carrousel horizontal a été refusé) : les étapes suivent ce qu'on produit
 * (une vidéo : brief, direction artistique, scénario, storyboard, plans, son,
 * montage, export ; une image ou un son : leurs propres étapes) et s'empilent,
 * chacune dans son PROPRE BLOC : en tête, à gauche, sa case cochée comme une
 * tâche (même case que la liste de tâches, aucun violet), son numéro et son
 * nom ; à droite ce qu'elle contient, son état et le chevron. L'étape EN COURS
 * s'ouvre d'elle-même ; l'utilisateur ouvre ou ferme n'importe quelle autre.
 * Dedans, tout ce qui y est né : les pièces écrites EN ENTIER (avec leurs
 * versions, sans intitulé de rubrique, leur titre sur une bande de fond), puis
 * les rubriques « Ambiance » et « Médias retenus » (avec leur menu « … » et
 * leur ligne d'informations). Tout se calcule depuis la carte et
 * la base (`etapesDuSuivi`), jamais depuis les messages.
 *
 * LES APERÇUS SUIVENT LE MODÈLE DE « CE QUE L'AGENT A VU » (MEM-4031) : une
 * vignette de taille fixe, l'image d'aperçu de la vidéo avec le bouton lecture
 * au centre, l'heure au coin ; un clic l'ouvre en grand, où elle démarre.
 */
export function VoletDeSuivi({ card }: { card: Card }) {
  const production = useProduction(card.id);
  const agentDuFil = React.useContext(ContexteAgentDuFil);
  const etapes = React.useMemo(
    () =>
      etapesDuSuivi({
        column: card.column,
        realisation: card.realisation ?? null,
        elements: production?.elements ?? [],
        medias: production?.medias ?? [],
        lots: production?.lots ?? [],
      }),
    [card.column, card.realisation, production],
  );
  /* LES SIX ÉTAPES DE LA BARRE, DANS LE MÊME ÉTAT (décision du 25/10/2026) :
     Type, Idée, Images clés et prix, Fabrication, Film monté, Livré. Les pièces
     du suivi (brief, direction, scénario…) se rangent dessous (`voletDuMedia`). */
  const media = useEtapesDuMedia(card);
  const groupes = React.useMemo(() => (media ? voletDuMedia(etapes, media.segments) : []), [etapes, media]);
  const courante = production && media ? media.courante : null;
  const types = typesDeMediaDeLaRealisation(card.realisation ?? {})
    .map((type) => t(LIBELLES_TYPES_DE_MEDIA_DE_REALISATION[type]))
    .join(' + ');

  const state = useApp();
  const pieces = state.attachments[card.projectId];
  /* La liste des pièces du projet peut ne pas être encore chargée : on la demande. */
  React.useEffect(() => {
    if (!pieces) client.send({ type: 'attachments.list', projectId: card.projectId });
  }, [pieces, card.projectId]);
  /* LA GALERIE DE L'APERÇU : toutes les pièces du volet, dans l'ordre des étapes.
     Une pièce encore absente de la liste chargée se lit quand même, par une
     fiche reconstituée depuis le média (son genre suffit au lecteur). */
  const galerie = React.useMemo(() => {
    const liste: Attachment[] = [];
    const vues = new Set<string>();
    const ajouter = (id: string, nom: string, mime: string, quand: number) => {
      if (vues.has(id)) return;
      vues.add(id);
      liste.push(
        (pieces ?? []).find((p) => p.id === id) ?? { id, projectId: card.projectId, name: nom, mime, size: 0, sha: id, createdAt: quand },
      );
    };
    for (const e of etapes) {
      for (const id of e.ambiance) ajouter(id, t('Ambiance'), 'image/jpeg', 0);
      for (const m of e.medias) if (m.attachmentId && m.etat !== 'en-cours') ajouter(m.attachmentId, m.plan, MIME_DU_GENRE[m.genre], m.creeLe);
    }
    return liste;
  }, [etapes, pieces, card.projectId]);
  const [ouverte, setOuverte] = React.useState<string | null>(null);
  const piece = ouverte ? galerie.find((p) => p.id === ouverte) ?? null : null;
  const pieceDe = (id: string) => galerie.find((p) => p.id === id);

  return (
    <div className="flex h-full min-h-0 flex-col" data-volet-de-suivi={card.id}>
      <div className="flex shrink-0 items-center gap-2 px-5 pb-2 pt-3">
        <Clapperboard className="h-4 w-4 text-muted" />
        {/* AUCUNE CROIX ICI (décision du 25/10/2026) : sur ordinateur le suivi d'une
            production reste toujours ouvert ; sur téléphone, il est une feuille du
            bas dont la bande du haut porte sa croix et sa poignée (#f41f). */}
        <span className="min-w-0 flex-1 truncate text-[14.5px] font-medium text-text">{t('Suivi de la production')}</span>
        {/* LA DÉPENSE À DROITE DU TITRE (26/10/2026) : ce qui a été réellement engagé, clic par clic. */}
        {production ? (
          <span className="shrink-0 text-[12.5px] tabular-nums text-faint" data-depense-du-suivi={String(production.depense)}>
            {t('Dépensé : {montant} $', { montant: arrondi(production.depense) })}
          </span>
        ) : null}
      </div>
      {/* PLUS D'ONGLETS (demande du 26/10/2026) : une seule liste d'étapes. Tout
          l'ÉCRIT — brief, direction, scénario, storyboard, plans — se lit sous
          « Brief », avec ses versions et ses corrections ; les autres étapes
          montrent ce qui est validé. */}
      {production === null ? (
        <p className="flex items-center gap-2 px-5 py-2 text-[13px] text-faint">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {t('Chargement…')}
        </p>
      ) : (
        <AccordeonDesEtapes
          cardId={card.id}
          agentId={agentDuFil ?? card.agentId ?? null}
          etapes={groupes}
          types={types}
          courante={courante}
          enTravail={card.column === 'running'}
          pieceDe={pieceDe}
          onOuvrir={setOuverte}
          carte={card}
        />
      )}
      {/* LE PIED FIXE : la lecture du cahier de réalisation, sur toute la largeur, hors du défilement des étapes. */}
      <LectureDuCahierDeRealisation carte={card} />
      <AttachmentPreview item={piece} galerie={galerie} onNaviguer={(p) => setOuverte(p.id)} onClose={() => setOuverte(null)} />
    </div>
  );
}

const MIME_DU_GENRE: Record<MediaDuSuivi['genre'], string> = { image: 'image/png', video: 'video/mp4', son: 'audio/mpeg' };

/**
 * L'ACCORDÉON DES ÉTAPES, VERTICAL : une étape par bloc, les unes sous les
 * autres. L'étape EN COURS s'ouvre d'elle-même (à l'ouverture et chaque fois
 * que le travail passe à la suivante), sans refermer ce que l'utilisateur a
 * ouvert ; n'importe quelle autre s'ouvre ou se referme d'un clic sur sa tête.
 */
function AccordeonDesEtapes({
  cardId,
  agentId,
  etapes,
  types,
  courante,
  enTravail,
  pieceDe,
  onOuvrir,
  carte,
}: {
  cardId: string;
  agentId: string | null;
  etapes: readonly EtapeDuVoletDuMedia[];
  /** Les types de média choisis, en mots (« Vidéo ») : la première ligne du « Brief ». */
  types: string;
  courante: EtapeDuMedia | null;
  enTravail: boolean;
  pieceDe: (id: string) => Attachment | undefined;
  onOuvrir: (id: string) => void;
  carte: Card;
}) {
  /* CE QUE L'UTILISATEUR A OUVERT À LA MAIN, et l'étape en cours s'il l'a refermée :
     l'étape en cours est ouverte d'office, celle d'avant se referme quand le travail
     avance — sauf si c'est l'utilisateur qui l'avait ouverte. */
  const [ouvertes, setOuvertes] = React.useState<ReadonlySet<EtapeDuMedia>>(() => new Set());
  const [couranteFermee, setCouranteFermee] = React.useState<EtapeDuMedia | null>(null);
  const estOuverte = (etape: EtapeDuMedia) => ouvertes.has(etape) || (etape === courante && couranteFermee !== courante);
  const basculer = (etape: EtapeDuMedia) => {
    const ouverte = estOuverte(etape);
    setOuvertes((avant) => {
      const apres = new Set(avant);
      if (ouverte) apres.delete(etape);
      else apres.add(etape);
      return apres;
    });
    if (etape === courante) setCouranteFermee(ouverte ? etape : null);
  };
  return (
    <ZoneDefilement className="px-4 pb-6">
      <ol className="flex flex-col gap-2" data-accordeon-du-suivi="" data-etapes-du-suivi={etapes.length}>
        {etapes.map((etape) => (
          <EtapeEnAccordeon
            key={etape.etape}
            cardId={cardId}
            agentId={agentId}
            numero={ETAPES_DU_MEDIA_EN_ORDRE.indexOf(etape.etape) + 1}
            etape={etape}
            types={types}
            courante={etape.etape === courante}
            ouverte={estOuverte(etape.etape)}
            onBasculer={() => basculer(etape.etape)}
            enTravail={enTravail}
            pieceDe={pieceDe}
            onOuvrir={onOuvrir}
            carte={carte}
          />
        ))}
      </ol>
    </ZoneDefilement>
  );
}

/** L'ordre des quatre étapes : le numéro de chacune, dans sa tête. */
const ETAPES_DU_MEDIA_EN_ORDRE: readonly EtapeDuMedia[] = ['brief', 'esquisses', 'montage', 'telechargement'];

/** Le nombre de pièces ÉCRITES montrées dans un bloc (les pistes écartées rangées dans le menu ne comptent pas). */
function ecritDuBloc(bloc: BlocDuMedia): number {
  return piecesAffichees(bloc.elements).affichees.length;
}

/** UNE RUBRIQUE DANS UNE ÉTAPE OUVERTE : son intitulé (icône, nom, nombre), puis son contenu. */
function RubriqueDEtape({ icone, titre, nombre, children, repere }: { icone: React.ReactNode; titre: string; nombre: number; children: React.ReactNode; repere: string }) {
  return (
    <section className="flex flex-col gap-2" data-rubrique-etape={repere}>
      <h4 className="flex items-center gap-1.5 text-[11.5px] font-medium uppercase tracking-wide text-faint">
        {icone}
        <span>{titre}</span>
        <span className="tabular-nums">· {nombre}</span>
      </h4>
      {children}
    </section>
  );
}

function EtapeEnAccordeon({
  cardId,
  agentId,
  numero,
  etape,
  types,
  courante,
  ouverte,
  onBasculer,
  enTravail,
  pieceDe,
  onOuvrir,
  carte,
}: {
  cardId: string;
  agentId: string | null;
  numero: number;
  etape: EtapeDuVoletDuMedia;
  types: string;
  courante: boolean;
  ouverte: boolean;
  onBasculer: () => void;
  enTravail: boolean;
  pieceDe: (id: string) => Attachment | undefined;
  onOuvrir: (id: string) => void;
  carte: Card;
}) {
  const etatTache = etatDeTache(etape.etat);
  /* L'ÉCRIT DE L'ÉTAPE (brief, direction, scénario, storyboard, plans… sous « Brief ») :
     un bloc par pièce du suivi, sous son nom quand il y en a plusieurs. */
  const blocsEcrits = etape.blocs.filter((b) => b.elements.length > 0);
  const nombre = blocsEcrits.reduce((n, b) => n + ecritDuBloc(b), 0);
  /* Un seul bloc garni : son nom ferait doublon avec celui de l'étape quand il le répète. */
  const nommerLesBlocs = blocsEcrits.length > 1 || (blocsEcrits.length === 1 && LIBELLES_ETAPES[blocsEcrits[0]!.etape]() !== t(LIBELLE_ETAPE_DE_SUIVI[etape.etape]));
  const ecrit = blocsEcrits.length ? (
    <div className="flex flex-col gap-3" data-ecrit-de-l-etape={etape.etape}>
      {blocsEcrits.map((bloc) => (
        <BlocDEtape key={bloc.etape} cardId={cardId} agentId={agentId} bloc={bloc} nomme={nommerLesBlocs} />
      ))}
    </div>
  ) : null;
  return (
    <li
      className={cn('flex flex-col overflow-hidden rounded-xl transition-colors', courante ? 'bg-raised' : 'bg-raised/45')}
      data-etape-suivi={etape.etape}
      data-etat-etape={etape.etat}
      data-etape-courante={courante ? '' : undefined}
      data-etape-ouverte={ouverte ? '' : undefined}
    >
      {/* LA TÊTE DE L'ÉTAPE EST LE BOUTON DE L'ACCORDÉON : à gauche la case et le
          nom, à droite ce qu'elle contient, son état et le chevron. */}
      <button
        type="button"
        onClick={onBasculer}
        aria-expanded={ouverte}
        data-ouvrir-etape={etape.etape}
        data-entete-etape={etape.etape}
        className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-raised"
      >
        <span className="-mt-[2px]">
          <CaseDeTache etat={etatTache} streaming={enTravail && etape.etat === 'en-cours'} />
        </span>
        <span className="w-4 shrink-0 text-right text-[11.5px] tabular-nums text-faint">{numero}</span>
        {/* Une étape faite n'est pas barrée (elle aurait l'air annulée) : sa case cochée suffit. */}
        <span className={cn('min-w-0 flex-1 truncate text-[14px]', courante ? 'font-medium text-text' : etatTache === 'done' ? 'text-muted' : 'text-text')}>
          {t(LIBELLE_ETAPE_DE_SUIVI[etape.etape])}
        </span>
        {nombre ? (
          <span className="shrink-0 text-[11.5px] tabular-nums text-faint" data-nombre-etape={nombre}>
            {nombre > 1 ? t('{n} éléments', { n: nombre }) : t('{n} élément', { n: nombre })}
          </span>
        ) : null}
        <span className={cn('shrink-0 text-[12px]', etape.etat === 'a-valider' ? 'text-en-cours' : etape.etat === 'erreur' ? 'text-danger' : 'text-faint')}>
          {LIBELLES_ETATS[etape.etat]()}
        </span>
        <ChevronDown className={cn('h-3.5 w-3.5 shrink-0 text-faint transition-transform', ouverte ? 'rotate-180' : '')} aria-hidden />
      </button>
      {ouverte ? (
        <div className="flex flex-col gap-3 px-3 pb-3 pt-0.5" data-contenu-etape={etape.etape}>
          {/* Le brief pose l'écrit entre ce qu'on crée et l'ambiance ; les autres étapes le posent après ce qui est validé. */}
          <ProductionDeLEtape cardId={cardId} etape={etape} blocs={etape.blocs} types={types} pieceDe={pieceDe} onOuvrir={onOuvrir} carte={carte} ecrit={ecrit} />
          {etape.etape !== 'brief' ? ecrit : null}
        </div>
      ) : null}
    </li>
  );
}

/**
 * UN BLOC ÉCRIT D'UNE ÉTAPE : les pièces d'une étape du suivi (le brief, la
 * direction, le scénario, les plans…), sous son nom quand l'étape en réunit
 * plusieurs, sans intitulé « Écrit ». L'ambiance et les médias validés sont
 * montrés par l'étape elle-même (`ProductionDeLEtape`), jamais deux fois.
 */
function BlocDEtape({ cardId, agentId, bloc, nomme }: { cardId: string; agentId: string | null; bloc: BlocDuMedia; nomme: boolean }) {
  const ecrit = piecesAffichees(bloc.elements);
  /* Une seule pièce qui porte déjà le nom du bloc (« Brief », « Scénario ») : l'intitulé ferait doublon. */
  const nom = LIBELLES_ETAPES[bloc.etape]();
  const doublon = ecrit.affichees.length === 1 && ecrit.affichees[0]!.titre.trim().toLowerCase() === nom.trim().toLowerCase();
  return (
    <section className="flex flex-col gap-3" data-bloc-etape={bloc.etape}>
      {nomme && !doublon ? <h3 className="text-[12.5px] font-medium text-muted">{nom}</h3> : null}
      {/* LES PIÈCES ÉCRITES, posées telles quelles (plus d'intitulé « Écrit · N »).
          Les pistes écartées sont dans le menu « Versions » : celui de la direction
          retenue, ou, sans retenue, celui de chaque direction montrée. */}
      {ecrit.affichees.length ? (
        <div className="flex flex-col gap-2" data-rubrique-etape="ecrit">
          {ecrit.affichees.map((e) => (
            <PieceEcrite
              key={e.id}
              cardId={cardId}
              agentId={agentId}
              element={e}
              pistes={(ecrit.retenue ? e === ecrit.retenue : e.genre === 'concept') ? ecrit.ecartees : undefined}
            />
          ))}
        </div>
      ) : null}
      {ecrit.ecartees.length && !ecrit.affichees.some((e) => e.genre === 'concept') ? <PistesEcarteesSeules cardId={cardId} pistes={ecrit.ecartees} /> : null}
    </section>
  );
}

/**
 * LE CONTENU D'UNE ÉTAPE (26/10/2026) : ce qui est VALIDÉ, et l'écrit — tout
 * le reste vit dans la conversation et la bande du bas. Plus de « En
 * conception » ni de case « Image à venir ».
 *  - BRIEF : ce qu'on crée, TOUT l'écrit (brief, direction, scénario,
 *    storyboard, plans, avec versions et corrections), puis l'ambiance.
 *  - ESQUISSES : les médias validés ; pour une VIDÉO, plan par plan dans
 *    l'ordre du découpage — son image validée, puis sa séquence validée, ou son
 *    bouton « Animer · prix » au second temps, ou la marque « à refaire » —,
 *    puis la voix off et la musique.
 *  - MONTAGE : les médias finaux, et l'ouverture du studio du média.
 *  - TÉLÉCHARGEMENT : l'ouverture de la page des fichiers.
 */
function ProductionDeLEtape({
  cardId,
  etape,
  blocs,
  types,
  pieceDe,
  onOuvrir,
  carte,
  ecrit,
}: {
  cardId: string;
  etape: EtapeDuVoletDuMedia;
  blocs: readonly BlocDuMedia[];
  types: string;
  pieceDe: (id: string) => Attachment | undefined;
  onOuvrir: (id: string) => void;
  carte: Card;
  /** L'écrit de l'étape, déjà monté : le brief le pose entre ce qu'on crée et l'ambiance. */
  ecrit: React.ReactNode;
}) {
  const production = useProduction(cardId);
  const retenus = blocs.flatMap((b) => b.medias).filter((m) => estRetenu(m));
  const ambiance = blocs.flatMap((b) => b.ambiance);
  const typesDeLaCarte = typesDeMediaDeLaRealisation(carte.realisation ?? {});
  const video = typesDeLaCarte.includes('video');
  const rien = (texte: string) => (
    <p className="text-[12.5px] text-faint" data-etape-vide="">
      {texte}
    </p>
  );

  if (etape.etape === 'brief') {
    return (
      <>
        <p className="text-[13px] text-text" data-types-du-media="">
          {types || t('Choisissez ce que vous voulez créer au bouton caméra.')}
        </p>
        {ecrit ?? (
          <p className="text-[12.5px] text-faint" data-etape-vide="">
            {t('Rien d’écrit pour l’instant : le brief s’écrit avec le directeur, et pour une vidéo, le découpage en plans.')}
          </p>
        )}
        {ambiance.length ? <GrilleDAmbiance ambiance={ambiance} onOuvrir={onOuvrir} /> : null}
      </>
    );
  }

  if (etape.etape === 'esquisses') {
    if (video) {
      const plans = etatDesPlans(decoupageDuMedia(production?.elements ?? []), production?.medias ?? []).filter((p) => p.visuel);
      const phase = phaseDesEsquisses(typesDeLaCarte, carte.realisation);
      const son = sonDuBrief(elementsCourants(production?.elements ?? []).find((e) => e.genre === 'brief')?.contenu);
      const sons = retenus.filter((m) => m.genre === 'son');
      return (
        <>
          {plans.length ? (
            <ol className="flex flex-col gap-2" data-plans-du-suivi={plans.length} data-phase-des-esquisses={phase}>
              {plans.map((plan, i) => (
                <PlanDuSuivi key={plan.cle} cardId={cardId} numero={i + 1} plan={plan} phase={phase} pieceDe={pieceDe} onOuvrir={onOuvrir} />
              ))}
            </ol>
          ) : (
            rien(t('Le découpage en plans s’écrit au brief.'))
          )}
          {sons.length || son.voix || son.musique ? (
            <RubriqueDEtape icone={<Clapperboard className="h-3 w-3" />} titre={t('Voix et musique')} nombre={sons.length} repere="sons">
              {sons.length ? (
                <ul className="flex flex-col gap-2">
                  {sons.map((m) => (
                    <CreationDuSuivi key={m.id} cardId={cardId} media={m} piece={m.attachmentId ? pieceDe(m.attachmentId) : undefined} onOuvrir={onOuvrir} />
                  ))}
                </ul>
              ) : (
                rien(phase === 'sequences' ? t('La voix off et la musique prévues au brief se valident ici.') : t('La voix off et la musique viennent au second temps, avec les séquences.'))
              )}
            </RubriqueDEtape>
          ) : null}
        </>
      );
    }
    return retenus.length ? (
      <ul className="flex flex-col gap-2" data-valides-du-suivi={retenus.length}>
        {retenus.map((m) => (
          <CreationDuSuivi key={m.id} cardId={cardId} media={m} piece={m.attachmentId ? pieceDe(m.attachmentId) : undefined} onOuvrir={onOuvrir} />
        ))}
      </ul>
    ) : (
      rien(etape.etat === 'a-definir' ? t('Rien encore : cette étape viendra en son temps.') : t('Validez d’un clic, sur le média, les brouillons que vous gardez : ils se rangent ici.'))
    );
  }

  if (etape.etape === 'montage') {
    const finaux = realisationDeLaCarte(carte).finaux ?? [];
    return (
      <>
        {finaux.length ? (
          <ul className="grid grid-cols-2 gap-2" data-finaux-du-suivi={finaux.length}>
            {finaux.map((f) => (
              <li key={f.piece} className="min-w-0">
                <button type="button" onClick={() => onOuvrir(f.piece)} title={t('Ouvrir en grand')} className="block aspect-video w-full overflow-hidden rounded-lg bg-surface/70">
                  {f.genre === 'image' ? <ImageDePiece id={f.piece} alt={f.nom ?? ''} className="h-full w-full object-contain" /> : f.genre === 'video' ? <VignetteVideo id={f.piece} nom={f.nom ?? ''} className="h-full w-full object-contain" /> : <span className="flex h-full items-center justify-center text-[12px] text-muted">{f.nom}</span>}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {etape.etat === 'a-definir' ? (
          rien(t('Rien encore : cette étape viendra en son temps.'))
        ) : (
          <Button type="button" size="sm" className="self-start" onClick={() => ouvrirLeDocument(studioDuMedia(carte))} data-ouvrir-le-studio="">
            {video ? t('Ouvrir le montage') : typesDeLaCarte.includes('image') ? t('Ouvrir le studio photo') : t('Ouvrir le studio son')}
          </Button>
        )}
        {typesDeLaCarte.includes('image') && typesDeLaCarte.some((x) => x !== 'image' && x !== 'video') && etape.etat !== 'a-definir' ? (
          <Button type="button" size="sm" variant="ghost" className="self-start" onClick={() => ouvrirLeDocument({ cardId, genre: 'studio-son' })} data-ouvrir-le-studio-son="">
            {t('Ouvrir le studio son')}
          </Button>
        ) : null}
      </>
    );
  }

  return etape.etat === 'a-definir' ? (
    rien(t('Rien encore : cette étape viendra en son temps.'))
  ) : (
    <Button type="button" size="sm" className="self-start" onClick={() => ouvrirLeDocument({ cardId, genre: 'telechargement' })} data-ouvrir-le-telechargement="">
      {t('Ouvrir la page Téléchargement')}
    </Button>
  );
}

function GrilleDAmbiance({ ambiance, onOuvrir }: { ambiance: readonly string[]; onOuvrir: (id: string) => void }) {
  return (
    <RubriqueDEtape icone={<Palette className="h-3 w-3" />} titre={t('Ambiance')} nombre={ambiance.length} repere="ambiance">
      <ul className="grid grid-cols-3 gap-1.5">
        {ambiance.map((id) => (
          <li key={`ambiance-${id}`} data-creation-suivi="ambiance">
            <button type="button" className="group relative aspect-square w-full overflow-hidden rounded-lg bg-surface/70" onClick={() => onOuvrir(id)} title={t('Ouvrir en grand')}>
              <ImageDePiece id={id} alt="" className="h-full w-full object-cover transition-transform group-hover:scale-[1.03]" />
            </button>
          </li>
        ))}
      </ul>
    </RubriqueDEtape>
  );
}

/** Le prix d'une animation, lu une fois par image et par durée (le meilleur modèle, deux variantes). */
const prixDesAnimations = new Map<string, Promise<{ service: string; modele: string; prix: number | null } | null>>();
function usePrixDeLAnimation(cardId: string, mediaId: string | null, duree: number | null): { service: string; modele: string; prix: number | null } | null | undefined {
  const [prix, setPrix] = React.useState<{ service: string; modele: string; prix: number | null } | null | undefined>(undefined);
  React.useEffect(() => {
    if (!mediaId) return;
    const cle = `${mediaId}|${duree ?? ''}`;
    let promesse = prixDesAnimations.get(cle);
    if (!promesse) {
      promesse = client
        .call<{ modeles: { service: string; modele: string; prix: number | null }[]; recommande: string | null }>({
          type: 'realisation.panneau.chiffrer',
          cardId,
          mediaId,
          operation: 'animer',
          ...(duree ? { duree } : {}),
        })
        .then((r) => r.modeles.find((m) => m.modele === r.recommande) ?? null)
        .catch(() => null);
      prixDesAnimations.set(cle, promesse);
    }
    let vivant = true;
    void promesse.then((r) => vivant && setPrix(r));
    return () => {
      vivant = false;
    };
  }, [cardId, mediaId, duree]);
  return prix;
}

/**
 * UN PLAN D'UNE VIDÉO DANS LE SUIVI : son image validée, puis sa séquence
 * validée — ou, au second temps, son bouton « Animer · prix » : UN CLIC VAUT
 * ACCORD et lance l'animation (le meilleur modèle, la durée du plan, deux
 * variantes, le son d'ambiance). Une séquence animée d'une image qui n'est plus
 * validée est « à refaire ».
 */
function PlanDuSuivi({
  cardId,
  numero,
  plan,
  phase,
  pieceDe,
  onOuvrir,
}: {
  cardId: string;
  numero: number;
  plan: EtatDuPlan;
  phase: string;
  pieceDe: (id: string) => Attachment | undefined;
  onOuvrir: (id: string) => void;
}) {
  const image = plan.images[0] ?? null;
  const production = useProduction(cardId);
  const imageComplete = image ? production?.medias.find((m) => m.id === image.id) ?? null : null;
  const sequence = plan.sequence ? production?.medias.find((m) => m.id === plan.sequence!.id) ?? null : null;
  const animable = phase === 'sequences' && !!image && (!sequence || plan.aRefaire);
  const prix = usePrixDeLAnimation(cardId, animable ? image!.id : null, plan.duree);
  const [envoi, setEnvoi] = React.useState(false);
  const animer = async () => {
    if (!image || !prix || envoi) return;
    setEnvoi(true);
    try {
      await client.call({
        type: 'realisation.panneau.lancer',
        cardId,
        mediaId: image.id,
        operation: 'animer',
        service: prix.service,
        modele: prix.modele,
        variantes: 2,
        son: true,
        ...(plan.duree ? { duree: Math.min(15, Math.max(3, Math.round(plan.duree))) } : {}),
      });
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('L’animation n’a pas pu partir'));
    } finally {
      setEnvoi(false);
    }
  };
  const vignette = (m: MediaDuSuivi | null, vide: string) =>
    m?.attachmentId ? (
      <div className="relative">
        <button type="button" onClick={() => onOuvrir(m.attachmentId!)} title={t('Ouvrir en grand')} className="block aspect-video w-full overflow-hidden rounded-lg bg-surface/70">
          {m.genre === 'video' ? (
            <VignetteVideo id={m.attachmentId} nom={m.plan} seconde={pieceDe(m.attachmentId)?.apercuSeconde} className="pointer-events-none h-full w-full object-cover" />
          ) : (
            <ImageDePiece id={m.attachmentId} alt={m.plan} className="h-full w-full object-cover" />
          )}
        </button>
        <MenuDuMedia cardId={cardId} media={m} className="absolute right-1 top-1" />
      </div>
    ) : (
      <div className="flex aspect-video w-full items-center justify-center rounded-lg bg-surface/40 px-2 text-center text-[11.5px] text-faint">{vide}</div>
    );
  return (
    <li className="flex min-w-0 flex-col gap-1.5 rounded-lg bg-surface/40 p-2" data-plan-du-suivi={plan.cle} data-plan-image={image ? '' : undefined} data-plan-sequence={sequence ? '' : undefined} data-plan-a-refaire={plan.aRefaire ? '' : undefined}>
      <p className="flex min-w-0 items-center gap-1.5 text-[12.5px] text-text">
        <span className="tabular-nums text-faint">{numero}</span>
        <span className="min-w-0 flex-1 truncate" title={plan.titre}>
          {plan.titre}
        </span>
        {plan.duree ? <span className="shrink-0 tabular-nums text-faint">{t('{n} s', { n: plan.duree })}</span> : null}
      </p>
      <div className="grid grid-cols-2 gap-1.5">
        {vignette(imageComplete, t('Image à valider'))}
        {phase === 'sequences' ? (
          animable ? (
            <div className="flex aspect-video w-full flex-col items-center justify-center gap-1 rounded-lg bg-surface/40 p-1.5">
              {plan.aRefaire ? <span className="text-[11px] text-en-cours" data-sequence-a-refaire="">{t('À refaire : l’image a changé')}</span> : null}
              <Button
                type="button"
                size="sm"
                className="gap-1 bg-accent text-accent-fg hover:opacity-90"
                disabled={!prix || envoi}
                aria-busy={envoi}
                onClick={() => void animer()}
                data-animer-le-plan={plan.cle}
              >
                {envoi || prix === undefined ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                {prix === undefined ? t('Animer') : t('Animer · {prix}', { prix: prix?.prix === null || !prix ? t('prix non publié') : `${arrondi(prix.prix * 2)} $` })}
              </Button>
            </div>
          ) : (
            vignette(sequence, t('Séquence à valider'))
          )
        ) : (
          <div className="flex aspect-video w-full items-center justify-center rounded-lg bg-surface/20 px-2 text-center text-[11px] text-faint">{t('La séquence viendra après toutes les images')}</div>
        )}
      </div>
    </li>
  );
}

/** La vignette du volet : la même boîte que celle de « Ce que l'agent a vu ». */
const VIGNETTE_DU_SUIVI = 'h-20 w-28 shrink-0';

/** L'heure au coin, sur son propre fond de thème ; elle ne capte pas le clic. */
function HeureDeVignette({ quand }: { quand: number }) {
  return (
    <span
      className="pointer-events-none absolute bottom-0.5 right-0.5 rounded-sm bg-surface/85 px-1 text-[10.5px] leading-4 tabular-nums text-muted"
      data-capture-heure={quand}
    >
      {heureOuDate(quand)}
    </span>
  );
}

function CreationDuSuivi({ cardId, media, piece, onOuvrir }: { cardId: string; media: MediaDuSuivi; piece?: Attachment; onOuvrir: (id: string) => void }) {
  const legende = `${media.plan}${media.version > 1 ? ` · v${media.version}` : ''}`;
  const pret = media.etat !== 'en-cours' && !!media.attachmentId;
  const infobulle = [t('Ouvrir en grand'), heureExacte(media.creeLe)].join(' · ');
  let vignette: React.ReactNode;
  if (!pret) {
    vignette = (
      <div className={`${VIGNETTE_DU_SUIVI} relative flex items-center justify-center overflow-hidden rounded bg-raised/60 p-1`}>
        {media.etat === 'echec' ? (
          <span className="px-2 text-center text-[12px] text-danger">{t('Échec')}</span>
        ) : (
          <Loader2 className="h-4 w-4 animate-spin text-faint" />
        )}
        <HeureDeVignette quand={media.creeLe} />
      </div>
    );
  } else if (media.genre === 'son') {
    /* UN SON SE JOUE SUR PLACE (comme dans la bande) : le lecteur à onde, et
       son bouton « agrandir » ouvre la visionneuse. */
    vignette = (
      <div className="relative flex h-20 w-64 max-w-full shrink-0 flex-col justify-between overflow-hidden rounded bg-raised p-1" title={infobulle}>
        <span className="min-w-0 truncate px-1 pr-14 text-[11px] leading-4 text-muted">{legende}</span>
        <LecteurSon id={media.attachmentId!} nom={legende} compact className="bg-surface" onAgrandir={() => onOuvrir(media.attachmentId!)} />
        <span className="pointer-events-none absolute right-0 top-0.5">
          <HeureDeVignette quand={media.creeLe} />
        </span>
      </div>
    );
  } else {
    vignette = (
      <button
        type="button"
        onClick={() => onOuvrir(media.attachmentId!)}
        title={infobulle}
        data-ouvrir-media={media.id}
        className={`${VIGNETTE_DU_SUIVI} relative flex items-center justify-center overflow-hidden rounded bg-raised p-1.5 sm:p-1`}
      >
        {media.genre === 'video' ? (
          <>
            <VignetteVideo id={media.attachmentId!} nom={legende} seconde={piece?.apercuSeconde} className="pointer-events-none max-h-full max-w-full rounded object-contain" />
            <span className="pointer-events-none absolute inset-0 flex items-center justify-center" data-capture-lecture>
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-surface/85 text-text">
                <Play className="h-4 w-4 translate-x-[1px]" fill="currentColor" aria-hidden />
              </span>
            </span>
          </>
        ) : (
          <ImageDePiece id={media.attachmentId!} alt={legende} className="max-h-full max-w-full rounded object-contain" />
        )}
        <HeureDeVignette quand={media.creeLe} />
      </button>
    );
  }
  return (
    <li
      className={cn('flex min-w-0 gap-2.5', media.genre === 'son' && pret ? 'flex-col' : 'items-start')}
      data-creation-suivi={pret ? media.genre : 'en-cours'}
      data-media-suivi={media.id}
    >
      {/* LE MENU « … » EN HAUT À DROITE DE LA VIGNETTE : réglages, retirer du suivi, retouches. */}
      <div className="relative shrink-0 self-start">
        {vignette}
        {pret ? <MenuDuMedia cardId={cardId} media={media} className="absolute right-0.5 top-0.5" /> : null}
      </div>
      <div className="min-w-0 flex-1">
        <DetailDuMedia media={media} legende={legende} />
        {pret ? <InformationsDuMedia media={media} className="mt-0.5" /> : null}
      </div>
    </li>
  );
}

/** Au-delà, la consigne se replie sur trois lignes, avec « Voir toute la consigne ». */
const CONSIGNE_LONGUE = 220;

/**
 * LE DÉTAIL D'UNE FABRICATION, hors du bouton de la vignette : le plan et sa
 * version, le service et le modèle, le prix, la raison d'un échec, puis la
 * consigne telle que l'agent l'a écrite et, dessous, la version anglaise
 * réellement envoyée au service quand elle a été traduite.
 */
function DetailDuMedia({ media, legende }: { media: MediaDuSuivi; legende: string }) {
  const [deplie, setDeplie] = React.useState(false);
  const francaise = media.consigneOriginale || media.consigne || '';
  const anglaise = media.consigneOriginale ? media.consigne ?? '' : '';
  const longue = francaise.length + anglaise.length > CONSIGNE_LONGUE;
  const repliee = longue && !deplie;
  const service = [media.service !== 'montage' ? media.service : t('Montage'), media.modeleNom].filter(Boolean).join(' · ');
  return (
    <div className="min-w-0 flex-1 text-[12px] leading-snug" data-detail-media={media.id}>
      <p className="flex flex-wrap items-baseline gap-x-1.5 text-[12.5px] text-text">
        <span className="font-medium">{legende}</span>
        {media.prix !== null ? <span className="text-faint">{arrondi(media.prix)} $</span> : null}
      </p>
      {service ? <p className="break-words text-faint">{service}</p> : null}
      {media.etat === 'echec' && media.echec ? (
        <p className="mt-0.5 break-words text-danger" data-echec-media="">
          {media.echec}
        </p>
      ) : null}
      {francaise ? (
        <div className="mt-1 select-text">
          <p className={cn('whitespace-pre-line break-words text-muted', repliee && 'line-clamp-3')} data-consigne-media="">
            {francaise}
          </p>
          {anglaise && !repliee ? (
            <div className="mt-1">
              <p className="text-[11px] text-faint">{t('Envoyé au service (anglais)')}</p>
              <p className="whitespace-pre-line break-words text-muted" lang="en" data-consigne-anglaise="">
                {anglaise}
              </p>
            </div>
          ) : null}
          {longue ? (
            <button
              type="button"
              onClick={() => setDeplie((d) => !d)}
              aria-expanded={deplie}
              data-voir-consigne={media.id}
              className="mt-0.5 rounded px-1.5 sm:px-1 py-1 sm:py-0.5 text-[12px] text-faint transition-colors hover:bg-raised hover:text-text"
            >
              {deplie ? t('Replier la consigne') : t('Voir toute la consigne')}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

type PieceDuSuivi = BlocDuMedia['elements'][number];

/** Ce que le tiroir de lecture montre : une version de la pièce, ou une autre piste de direction. */
type Lecture = { genre: 'version'; version: VersionDuSuivi } | { genre: 'piste'; piste: PieceDuSuivi };

/**
 * LE TEXTE D'UNE PIÈCE, MIS EN PAGE (`blocsDePiece`, capture #2243) : chaque
 * intitulé est un petit titre en gras sur sa ligne, son contenu juste dessous ;
 * aucun tiret devant les éléments ; tableaux et blocs de code tels quels.
 */
function TexteDePiece({ contenu, className, ...repere }: { contenu: string; className?: string } & Record<`data-${string}`, string>) {
  const blocs = React.useMemo(() => blocsDePiece(contenu), [contenu]);
  return (
    <div className={cn('piece-du-suivi flex min-w-0 select-text flex-col gap-2 break-words', className)} {...repere}>
      {blocs.map((bloc, i) =>
        bloc.genre === 'intitule' ? (
          <div key={i} className="flex min-w-0 flex-col gap-0.5" data-intitule-piece="">
            <p className="text-[12.5px] font-semibold leading-snug text-text" data-titre-intitule="">
              {bloc.titre}
            </p>
            {bloc.texte ? <Markdown content={bloc.texte} enTexte /> : null}
          </div>
        ) : bloc.genre === 'texte' ? (
          <div key={i} className="flex min-w-0 gap-1.5" data-ligne-piece="">
            {bloc.numero ? <span className="shrink-0 text-[12.5px] leading-snug tabular-nums text-muted">{bloc.numero}</span> : null}
            <Markdown content={bloc.texte} enTexte className="min-w-0 flex-1" />
          </div>
        ) : (
          <Markdown key={i} content={bloc.texte} enTexte />
        ),
      )}
    </div>
  );
}

/** « v3 · 14:32 · par vous » : la ligne qui situe une version. */
function metaDeVersion(v: Pick<VersionDuSuivi, 'version' | 'creeLe' | 'auteur'>): string {
  return `v${v.version} · ${heureDuMessage(v.creeLe)} · ${v.auteur === 'utilisateur' ? t('par vous') : t('par l’agent')}`;
}

/**
 * LE MENU « VERSIONS » D'UNE PIÈCE (25/10/2026), en haut à droite de la pièce,
 * à la place de l'ancien « vN » : toutes les versions, la plus récente d'abord
 * (la version en cours marquée « en cours », sans violet), puis, sur la
 * direction retenue (ou, sans retenue, sur chaque direction montrée), les
 * AUTRES PISTES écartées. Choisir une entrée l'ouvre
 * dans le tiroir de lecture. Sans version antérieure ni autre piste : pas de menu.
 */
function MenuDesVersions({ piece, pistes, onLire }: { piece: PieceDuSuivi; pistes: readonly PieceDuSuivi[]; onLire: (l: Lecture) => void }) {
  const versions = piece.versions;
  if (versions.length < 2 && !pistes.length) return null;
  const courante = versions[0]?.version;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          data-versions-element={piece.cle}
          data-nombre-versions={versions.length}
          data-ouvrir-versions={piece.cle}
          className="-mr-1 -mt-0.5 flex shrink-0 items-center gap-1 rounded px-1.5 py-1 text-[11.5px] font-normal text-faint transition-colors hover:bg-raised hover:text-text data-[state=open]:bg-raised data-[state=open]:text-text sm:py-0.5"
        >
          <History className="h-3 w-3" />
          {t('Versions')}
          <span className="tabular-nums">{versions.length + pistes.length}</span>
          <ChevronDown className="h-3 w-3" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="sm:max-w-[320px]" data-menu-versions={piece.cle}>
        {versions.length > 1 ? (
          <>
            <DropdownMenuLabel>{t('Versions')}</DropdownMenuLabel>
            {versions.map((v) => {
              const estCourante = v.version === courante;
              return (
                <DropdownMenuItem
                  key={v.id}
                  onSelect={() => onLire({ genre: 'version', version: v })}
                  data-version-element={v.version}
                  data-version-courante={estCourante ? '' : undefined}
                  className="text-[13px]"
                >
                  <span className={cn('w-6 shrink-0 tabular-nums', estCourante ? 'font-semibold text-text' : 'text-muted')}>v{v.version}</span>
                  <span className="min-w-0 flex-1 truncate text-faint">
                    {heureDuMessage(v.creeLe)} · {v.auteur === 'utilisateur' ? t('par vous') : t('par l’agent')}
                  </span>
                  {estCourante ? <span className="shrink-0 text-[12px] text-muted">{t('en cours')}</span> : null}
                </DropdownMenuItem>
              );
            })}
          </>
        ) : null}
        {pistes.length ? (
          <>
            {versions.length > 1 ? <DropdownMenuSeparator /> : null}
            <DropdownMenuLabel>{t('Autres pistes')}</DropdownMenuLabel>
            {pistes.map((p) => (
              <DropdownMenuItem key={p.id} onSelect={() => onLire({ genre: 'piste', piste: p })} data-piste-ecartee={p.cle} className="text-[13px]">
                <span className="min-w-0 flex-1 truncate text-muted">{p.titre}</span>
                <span className="shrink-0 text-[12px] text-faint">{t('Écartée')}</span>
              </DropdownMenuItem>
            ))}
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * LE TIROIR DE LECTURE D'UNE VERSION (25/10/2026, décision de l'utilisateur :
 * un tiroir, pas une page) : son titre, sa ligne (version, heure, auteur), le
 * texte ENTIER mis en page, et le bouton qui la reprend à la place du contenu
 * en place.
 *  - une VERSION de la pièce : « Utiliser cette version » (`production.revenir`)
 *    écrit une version NOUVELLE avec son contenu, rien ne s'efface ;
 *  - une AUTRE PISTE de direction : « Utiliser cette direction »
 *    (`production.choisirDirection`) la retient, écarte l'ancienne et remet la
 *    suite à revalider.
 *    Sans direction retenue, « Remettre cette piste en lice » la repasse à
 *    proposer, à côté des autres (le choix se refait dans la question d'accord).
 * La version en cours n'a pas de bouton : « Version en cours ». Le bouton dit
 * qu'il travaille dès le clic ; un double clic n'écrit qu'une fois (le démon).
 */
function TiroirDeLecture({
  cardId,
  piece,
  lecture,
  onClose,
}: {
  cardId: string;
  piece: PieceDuSuivi;
  lecture: Lecture | null;
  onClose: () => void;
}) {
  const [enCours, setEnCours] = React.useState(false);
  /* Le dernier contenu lu reste à l'écran pendant que le tiroir se referme. */
  const derniere = React.useRef<Lecture | null>(null);
  if (lecture) derniere.current = lecture;
  const l = lecture ?? derniere.current;
  const estCourante = l?.genre === 'version' && l.version.version === piece.versions[0]?.version;
  const titre = l ? (l.genre === 'version' ? l.version.titre : l.piste.titre) : '';
  const contenu = l ? (l.genre === 'version' ? l.version.contenu : l.piste.contenu) : '';
  const meta = l
    ? l.genre === 'version'
      ? `${metaDeVersion(l.version)}${estCourante ? ` · ${t('en cours')}` : ''}`
      : [t('Autre piste'), l.piste.versions[0] ? metaDeVersion(l.piste.versions[0]) : null].filter(Boolean).join(' · ')
    : '';

  const utiliser = async () => {
    if (!l || enCours || estCourante) return;
    setEnCours(true);
    try {
      let aval: EtapeDEcriture[] = [];
      if (l.genre === 'version') {
        const r = (await client.call({ type: 'production.revenir', cardId, cle: piece.cle, version: l.version.version })) as { aval?: EtapeDEcriture[] };
        aval = r.aval ?? [];
      } else {
        const r = (await client.call({ type: 'production.choisirDirection', cardId, cle: l.piste.cle })) as { ok: boolean; raison?: string; aval?: EtapeDEcriture[] };
        if (!r.ok) {
          client.pushToast('error', r.raison ?? t('Impossible de reprendre cette direction'));
          return;
        }
        aval = r.aval ?? [];
      }
      onClose();
      if (aval.length) {
        client.pushToast('info', t('Version reprise. À revalider : {etapes}', { etapes: aval.map((x) => LIBELLES_ETAPES[x as EtapeDuSuivi]()).join(', ') }));
      }
    } catch {
      client.pushToast('error', l.genre === 'version' ? t('Impossible de revenir à cette version') : t('Impossible de reprendre cette direction'));
    } finally {
      setEnCours(false);
    }
  };

  return (
    <Drawer open={lecture !== null} onClose={onClose} feuille empile>
      <EnteteDeFeuille titre={titre} sousTitre={meta} data-tiroir-version={piece.cle} />
      <ZoneDefilement classeEnveloppe="min-h-0 flex-1" className="px-4 pb-4">
        <TexteDePiece contenu={contenu} className="mx-auto max-w-[720px] pt-1" data-texte-de-version="" />
      </ZoneDefilement>
      <div className="flex shrink-0 items-center justify-end gap-2 px-4 pb-[calc(12px+env(safe-area-inset-bottom))] pt-2">
        {estCourante ? (
          <span className="text-[12.5px] text-faint" data-version-en-cours="">
            {t('Version en cours')}
          </span>
        ) : (
          <button
            type="button"
            onClick={() => void utiliser()}
            disabled={enCours}
            data-utiliser-version={l?.genre === 'version' ? l.version.version : l?.genre === 'piste' ? l.piste.cle : undefined}
            className="flex items-center gap-1.5 rounded-md bg-text px-3.5 py-2 text-[13px] font-medium text-surface transition-opacity hover:opacity-90 disabled:opacity-60 sm:py-1.5"
          >
            {enCours ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
            {l?.genre === 'piste' ? (piece.etat === 'valide' ? t('Utiliser cette direction') : t('Remettre cette piste en lice')) : t('Utiliser cette version')}
          </button>
        )}
      </div>
    </Drawer>
  );
}

/**
 * TOUTES LES DIRECTIONS ÉCARTÉES, AUCUNE MONTRÉE (pour en demander d'autres) :
 * aucune direction ne porte le menu, alors une ligne seule le porte, pour que
 * les pistes restent lisibles et reprenables.
 */
function PistesEcarteesSeules({ cardId, pistes }: { cardId: string; pistes: readonly PieceDuSuivi[] }) {
  const [lecture, setLecture] = React.useState<Lecture | null>(null);
  const hote = React.useMemo<PieceDuSuivi>(() => ({ ...pistes[0], versions: [] }), [pistes]);
  return (
    <div className="flex items-center gap-1.5 px-1" data-pistes-ecartees-seules="">
      <span className="min-w-0 flex-1 text-[12.5px] text-faint">{t('Toutes les pistes sont écartées')}</span>
      <MenuDesVersions piece={hote} pistes={pistes} onLire={setLecture} />
      <TiroirDeLecture cardId={cardId} piece={hote} lecture={lecture} onClose={() => setLecture(null)} />
    </div>
  );
}

/**
 * UNE PIÈCE ÉCRITE DU SUIVI, CORRIGEABLE (25/10/2026). Une information fausse
 * dans le brief, une direction, le scénario ou un plan se corrige de deux
 * façons, sous la pièce :
 *
 *  - « Modifier » l'ouvre sur place (titre et texte) ; « Enregistrer » écrit
 *    une NOUVELLE version signée « par vous » (`production.modifier`), l'ancienne
 *    reste dans « Versions ». Si l'agent a écrit une autre version pendant la
 *    correction, l'écran le dit et propose d'enregistrer quand même ;
 *  - « Corriger avec l'agent » pose l'étiquette de la pièce (« [pièce: Brief ·
 *    brief] ») dans la barre d'écriture de la carte : on écrit ce qui est faux,
 *    l'agent relit la pièce et la réécrit par « modifier ». Sans barre affichée
 *    (le cahier en cours se répond dans le panneau de décision), un petit champ
 *    s'ouvre sous la pièce et la demande part directement à l'agent.
 *
 * Corriger une étape remet les étapes suivantes à revalider : l'écran le dit.
 */
function PieceEcrite({ cardId, agentId, element: e, pistes = [] }: { cardId: string; agentId: string | null; element: PieceDuSuivi; pistes?: readonly PieceDuSuivi[] }) {
  const [lecture, setLecture] = React.useState<Lecture | null>(null);
  const [edition, setEdition] = React.useState<{ titre: string; contenu: string; depuis: number } | null>(null);
  const [conflit, setConflit] = React.useState<number | null>(null);
  const [enregistre, setEnregistre] = React.useState(false);
  const [demande, setDemande] = React.useState<string | null>(null);
  const [envoi, setEnvoi] = React.useState(false);
  /* L'agent a écrit une version pendant qu'on corrigeait : on le dit sans attendre l'enregistrement. */
  const aBouge = edition !== null && e.version !== edition.depuis;

  const enregistrer = async (forcer: boolean) => {
    if (!edition || enregistre) return;
    setEnregistre(true);
    try {
      const r = (await client.call({
        type: 'production.modifier',
        cardId,
        cle: e.cle,
        titre: edition.titre,
        contenu: edition.contenu,
        depuisVersion: forcer ? undefined : edition.depuis,
      })) as { ok: boolean; raison?: string; conflit?: number | null; aval?: EtapeDEcriture[]; deja?: boolean };
      if (!r.ok) {
        if (r.conflit) setConflit(r.conflit);
        else client.pushToast('error', r.raison ?? t('Impossible d’enregistrer la correction'));
        return;
      }
      setEdition(null);
      setConflit(null);
      if (r.aval?.length) {
        client.pushToast('info', t('Correction enregistrée. À revalider : {etapes}', { etapes: r.aval.map((x) => LIBELLES_ETAPES[x as EtapeDuSuivi]()).join(', ') }));
      }
    } catch {
      client.pushToast('error', t('Impossible d’enregistrer la correction'));
    } finally {
      setEnregistre(false);
    }
  };

  const etiquette = etiquetteDeCorrection(e.titre, e.cle);
  const corrigerAvecLAgent = () => {
    if (!agentId) return;
    if (joindreAuChamp({ agentId, texte: etiquette })) return;
    setDemande('');
  };
  const envoyerALAgent = async () => {
    if (!agentId || demande === null || !demande.trim() || envoi) return;
    setEnvoi(true);
    try {
      await client.call({ type: 'agent.prompt', agentId, text: `${etiquette.replace(/\u00A0/g, ' ')} ${demande.trim()}`, attachments: [] });
      setDemande(null);
    } catch {
      client.pushToast('error', t('Impossible d’envoyer la demande à l’agent'));
    } finally {
      setEnvoi(false);
    }
  };

  const bouton = 'flex items-center gap-1 rounded px-1 py-0.5 text-[12px] text-faint transition-colors hover:bg-raised hover:text-text disabled:opacity-60';
  return (
    /* Une piste ÉCARTÉE (direction non retenue) reste lisible, en retrait. */
    <div
      className={cn('rounded-lg bg-surface/70 px-3 pb-2', edition && 'pt-2', e.etat === 'refuse' && !edition && 'opacity-60')}
      data-creation-suivi="texte"
      data-element-suivi={e.cle}
      data-etat-element={e.etat}
    >
      {edition ? (
        <div className="flex flex-col gap-1.5" data-edition-piece={e.cle}>
          <input
            value={edition.titre}
            onChange={(ev) => setEdition({ ...edition, titre: ev.target.value })}
            maxLength={200}
            aria-label={t('Titre')}
            data-edition-titre=""
            className="w-full rounded-lg bg-raised px-2.5 py-1.5 text-[13px] font-medium text-text focus-visible:outline-none"
          />
          <Textarea
            value={edition.contenu}
            onChange={(ev) => setEdition({ ...edition, contenu: ev.target.value })}
            rows={Math.min(14, Math.max(4, edition.contenu.split('\n').length + 1))}
            aria-label={t('Texte de la pièce')}
            data-edition-contenu=""
            className="resize-y px-2.5 py-1.5 text-[12.5px] leading-snug"
            autoFocus
          />
          {aBouge || conflit ? (
            <p className="text-[12px] text-en-cours" data-conflit-piece="">
              {t('L’agent a écrit une version plus récente (v{v}) pendant votre correction.', { v: conflit ?? e.version })}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => void enregistrer(!!conflit)}
              disabled={enregistre || !edition.contenu.trim()}
              data-enregistrer-piece=""
              className="flex items-center gap-1 rounded-md bg-text px-3 sm:px-2.5 py-1.5 sm:py-1 text-[12px] font-medium text-surface transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              {enregistre ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
              {conflit ? t('Enregistrer quand même') : t('Enregistrer')}
            </button>
            <button
              type="button"
              onClick={() => {
                setEdition(null);
                setConflit(null);
              }}
              disabled={enregistre}
              data-annuler-piece=""
              className={bouton}
            >
              {t('Annuler')}
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* LA BANDE DU TITRE, pleine largeur en haut du bloc, sur un fond plus
              marqué que le corps (`.bande-de-titre-de-piece`) : le titre en gras à
              gauche ; à droite l'état et le menu « Versions ». */}
          <div className="bande-de-titre-de-piece -mx-3 flex items-start gap-1.5 rounded-t-lg px-3 py-1.5" data-titre-piece={e.cle}>
            <h5 className="min-w-0 flex-1 break-words text-[13.5px] font-semibold leading-snug text-text">{e.titre}</h5>
            {e.etat === 'a-valider' ? <span className="shrink-0 pt-px text-[11.5px] text-en-cours">{t('À valider')}</span> : null}
            {e.etat === 'refuse' ? <span className="shrink-0 pt-px text-[11.5px] text-faint">{t('Écartée')}</span> : null}
            <MenuDesVersions piece={e} pistes={pistes} onLire={setLecture} />
          </div>
          {/* LE TEXTE ENTIER, sans coupure, mis en page : intitulés en gras, listes, tableaux. */}
          <TexteDePiece contenu={e.contenu} className="mt-2" data-texte-entier="" />
        </>
      )}
      {!edition ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-x-1" data-actions-piece={e.cle}>
          <button
            type="button"
            onClick={() => {
              setConflit(null);
              setEdition({ titre: e.titre, contenu: e.contenu, depuis: e.version });
            }}
            data-modifier-piece={e.cle}
            className={bouton}
          >
            <Pencil className="h-3 w-3" />
            {t('Modifier')}
          </button>
          {agentId ? (
            <button type="button" onClick={corrigerAvecLAgent} data-corriger-avec-agent={e.cle} className={bouton}>
              <MessageSquarePlus className="h-3 w-3" />
              {t('Corriger avec l’agent')}
            </button>
          ) : null}
        </div>
      ) : null}
      {demande !== null && !edition ? (
        <div className="mt-1.5 flex flex-col gap-1.5" data-demande-piece={e.cle}>
          <Textarea
            value={demande}
            onChange={(ev) => setDemande(ev.target.value)}
            rows={3}
            placeholder={t('Ce qui est faux, et ce qu’il faut mettre à la place…')}
            data-demande-texte=""
            className="px-2.5 py-1.5 text-[12.5px] leading-snug"
            autoFocus
          />
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => void envoyerALAgent()}
              disabled={envoi || !demande.trim()}
              data-envoyer-demande-piece=""
              className="flex items-center gap-1 rounded-md bg-text px-3 sm:px-2.5 py-1.5 sm:py-1 text-[12px] font-medium text-surface transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              {envoi ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
              {t('Envoyer à l’agent')}
            </button>
            <button type="button" onClick={() => setDemande(null)} disabled={envoi} className={bouton}>
              {t('Annuler')}
            </button>
          </div>
        </div>
      ) : null}
      <TiroirDeLecture cardId={cardId} piece={e} lecture={lecture} onClose={() => setLecture(null)} />
    </div>
  );
}
