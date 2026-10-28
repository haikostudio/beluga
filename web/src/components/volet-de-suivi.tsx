import * as React from 'react';
import { ChevronDown, ChevronRight, Clapperboard, Copy, Download, History, Loader2, MoreVertical, Play, RotateCcw } from 'lucide-react';
import {
  arrondi,
  decoupageDuMedia,
  estRetenu,
  enFabricationDuPlan,
  etatDesPlans,
  phaseDesEsquisses,
  realisationDeLaCarte,
  sonDuBrief,
  elementsCourants,
  type EtatDuPlan,
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
  etiquetteDePiece,
  blocsDePiece,
  type BlocDePiece,
  intituleLisible,
  basculerUnNoeud,
  noeudOuvert,
  ouvrirUnNoeud,
  elementOuvertParDefaut,
  PREF_DES_BASCULES_DU_BRIEF,
  type BasculesDuBrief,
  piecesAffichees,
  documentDuBrief,
  documentDuBriefEnMarkdown,
  mediasDuDocument,
  nomsDesImagesDuBrief,
  partieFondueDansSaSection,
  PARTIE_DES_PIECES_FOURNIES,
  ROUTE_ARCHIVE_DES_IMAGES,
  type CorpsDArchive,
  type LotDArchive,
  type MediaDuDocument,
  type PartieDuDocument,
  type SectionDuDocument,
  type Attachment,
  type Card,
  type EtapeDuSuivi,
  type EtatDEtapeDuSuivi,
  type MediaDuSuivi,
  type VersionDuSuivi,
  type TodoItem,
} from '@beluga/shared';
import { AttachmentPreview } from '@/components/attachment-preview';
import { copierLeTexte } from '@/components/bouton-copier-document';
import { VignetteDeCapture } from '@/components/captures-du-flux';
import { LecteurSon } from '@/components/lecteur-son';
import { VignetteVideo } from '@/components/lecteur-video';
import { BoutonRetirerLaValidation, InformationsDuMedia, MenuDuMedia } from '@/components/menu-du-media';
import { adresseDePiece, ImageDePiece } from '@/components/pastille-de-fichier';
import { CLASSE_TRAIT_DE_BRANCHE } from '@/components/pastille-projet';
import { CaseDeTache } from '@/components/todos';
import {
  Drawer,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EnteteDeFeuille,
  ZoneDefilement,
} from '@/components/ui';
import { LectureDuCahierDeRealisation } from '@/components/realisation-volet';
import { studioDuMedia, useEtapesDuMedia } from '@/lib/production-de-carte';
import { ouvrirLeDocument } from '@/lib/document-de-carte';
import { fermerLeSuivi } from '@/lib/suivi-de-carte';
import { useEtatDeLaCase, useSourceDuGlisser } from '@/components/glisser-vers-un-plan';
import { CroixDuVolet } from '@/components/feuille-du-volet';
import { Button } from '@/components/ui';
import { client } from '@/lib/client';
import { Markdown } from '@/lib/markdown';
import { useProduction } from '@/lib/production-de-carte';
import { useApp } from '@/lib/use-app';
import { readPref, usePref } from '@/lib/prefs';
import { useTelechargement } from '@/lib/telechargement';
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
        <span className="min-w-0 flex-1 truncate text-[14.5px] font-medium text-text">{t('Suivi de la production')}</span>
        {/* LA DÉPENSE À DROITE DU TITRE (26/10/2026) : ce qui a été réellement engagé, clic par clic. */}
        {production ? (
          <span className="shrink-0 text-[12.5px] tabular-nums text-faint" data-depense-du-suivi={String(production.depense)}>
            {t('Dépensé : {montant} $', { montant: arrondi(production.depense) })}
          </span>
        ) : null}
        {/* SA CROIX, À CÔTÉ DE LA DÉPENSE (28/10/2026, remplace « toujours ouvert ») :
            fermé, le suivi le reste sur cette carte jusqu'au bouton « Suivi ». Sur
            téléphone, la bande de la feuille du bas porte déjà la sienne. */}
        <CroixDuVolet genre="suivi" onFermer={() => fermerLeSuivi(card.id)} className="-my-1 -mr-2" />
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

/** Le type d'une pièce encore absente de la liste chargée, deviné sur l'extension de son nom (image par défaut). */
function mimeDuNom(nom: string | null): string {
  const ext = (/\.([a-z0-9]{2,5})$/i.exec(nom ?? '')?.[1] ?? '').toLowerCase();
  if (['mp4', 'mov', 'webm', 'm4v'].includes(ext)) return 'video/mp4';
  if (['mp3', 'wav', 'm4a', 'ogg', 'aac', 'flac'].includes(ext)) return 'audio/mpeg';
  if (ext === 'pdf') return 'application/pdf';
  return 'image/png';
}

/**
 * L'ACCORDÉON DES ÉTAPES, VERTICAL : une étape par bloc, les unes sous les
 * autres. L'étape EN COURS s'ouvre d'elle-même (à l'ouverture et chaque fois
 * que le travail passe à la suivante), sans refermer ce que l'utilisateur a
 * ouvert ; n'importe quelle autre s'ouvre ou se referme d'un clic sur sa tête.
 */
function AccordeonDesEtapes({
  cardId,
  etapes,
  types,
  courante,
  enTravail,
  pieceDe,
  onOuvrir,
  carte,
}: {
  cardId: string;
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
  /* LE BRIEF EST UN SEUL DOCUMENT (26/10/2026) : pas de compteur d'éléments ; les autres étapes gardent le leur. */
  const nombre = etape.etape === 'brief' ? 0 : blocsEcrits.reduce((n, b) => n + ecritDuBloc(b), 0);
  /* LE TYPE CRÉÉ ENTRE PARENTHÈSES DANS LE TITRE (« Brief (Vidéo) ») : plus jamais posé seul au-dessus des blocs. */
  const libelle = etape.etape === 'brief' && types ? t('Brief ({types})', { types }) : t(LIBELLE_ETAPE_DE_SUIVI[etape.etape]);
  /* Un seul bloc garni : son nom ferait doublon avec celui de l'étape quand il le répète. */
  const nommerLesBlocs = blocsEcrits.length > 1 || (blocsEcrits.length === 1 && LIBELLES_ETAPES[blocsEcrits[0]!.etape]() !== t(LIBELLE_ETAPE_DE_SUIVI[etape.etape]));
  /* LE BRIEF EST UN SEUL DOCUMENT (26/10/2026) : sommaire, parties, sections,
     images à leur place ; les autres étapes gardent leurs blocs. */
  const ambianceDeLaCarte = carte.realisation?.ambiance;
  const parties = React.useMemo(
    () => (etape.etape === 'brief' ? documentDuBrief(etape.blocs.filter((b) => b.elements.length > 0), ambianceDeLaCarte ?? []) : []),
    [etape, ambianceDeLaCarte],
  );
  /* LES ARCHIVES DE L'ÉTAPE (versions antérieures, pistes écartées), ouvertes
     par le menu à trois points : au Brief dans la ligne du sommaire, ailleurs en
     tête du contenu, et seulement s'il y a quelque chose à reprendre. */
  const archives = React.useMemo(() => archivesDeLEtape(blocsEcrits), [etape]); // eslint-disable-line react-hooks/exhaustive-deps
  const [archivesOuvertes, setArchivesOuvertes] = React.useState(false);
  const ouvrirLesArchives = React.useCallback(() => setArchivesOuvertes(true), []);
  const ecrit = etape.etape === 'brief' ? (
    parties.length ? <DocumentDuBrief cardId={cardId} carte={carte} parties={parties} titre={libelle} onArchives={ouvrirLesArchives} /> : null
  ) : blocsEcrits.length ? (
    <div className="flex flex-col gap-3" data-ecrit-de-l-etape={etape.etape}>
      {blocsEcrits.map((bloc) => (
        <BlocDEtape key={bloc.etape} bloc={bloc} nomme={nommerLesBlocs} />
      ))}
    </div>
  ) : null;
  return (
    <li
      className="etape-du-suivi flex flex-col overflow-hidden rounded-xl transition-colors"
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
        className="entete-d-etape flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors"
      >
        <span className="-mt-[2px]">
          <CaseDeTache etat={etatTache} streaming={enTravail && etape.etat === 'en-cours'} />
        </span>
        <span className="w-4 shrink-0 text-right text-[11.5px] tabular-nums text-faint">{numero}</span>
        {/* Une étape faite n'est pas barrée (elle aurait l'air annulée) : sa case cochée suffit. */}
        <span
          className={cn('min-w-0 flex-1 truncate text-[14px]', courante ? 'font-medium text-text' : etatTache === 'done' ? 'text-muted' : 'text-text')}
          data-types-du-media={etape.etape === 'brief' ? types : undefined}
        >
          {libelle}
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
        <div className="flex flex-col gap-3 px-3 pb-3.5 pt-3" data-contenu-etape={etape.etape}>
          {etape.etape !== 'brief' && aDesArchives(archives) ? (
            <div className="-my-1.5 -mr-1.5 flex justify-end" data-tete-du-contenu={etape.etape}>
              <MenuDeLEtape etape={etape.etape}>
                <EntreeArchives onOuvrir={ouvrirLesArchives} />
              </MenuDeLEtape>
            </div>
          ) : null}
          {/* Le brief pose l'écrit entre ce qu'on crée et l'ambiance ; les autres étapes le posent après ce qui est validé. */}
          <ProductionDeLEtape cardId={cardId} etape={etape} blocs={etape.blocs} types={types} pieceDe={pieceDe} onOuvrir={onOuvrir} carte={carte} ecrit={ecrit} />
          {etape.etape !== 'brief' ? ecrit : null}
        </div>
      ) : null}
      <FeuilleDesArchives
        cardId={cardId}
        etape={etape.etape}
        libelle={libelle}
        archives={archives}
        open={archivesOuvertes}
        onClose={() => setArchivesOuvertes(false)}
      />
    </li>
  );
}

/**
 * UN BLOC ÉCRIT D'UNE ÉTAPE : les pièces d'une étape du suivi (le brief, la
 * direction, le scénario, les plans…), sous son nom quand l'étape en réunit
 * plusieurs, sans intitulé « Écrit ». L'ambiance et les médias validés sont
 * montrés par l'étape elle-même (`ProductionDeLEtape`), jamais deux fois.
 */
function BlocDEtape({ bloc, nomme }: { bloc: BlocDuMedia; nomme: boolean }) {
  const ecrit = piecesAffichees(bloc.elements);
  /* Une seule pièce qui porte déjà le nom du bloc (« Brief », « Scénario ») : l'intitulé ferait doublon. */
  const nom = LIBELLES_ETAPES[bloc.etape]();
  const doublon = ecrit.affichees.length === 1 && ecrit.affichees[0]!.titre.trim().toLowerCase() === nom.trim().toLowerCase();
  return (
    <section className="flex flex-col gap-3" data-bloc-etape={bloc.etape}>
      {nomme && !doublon ? <h3 className="text-[12.5px] font-medium text-muted">{nom}</h3> : null}
      {/* LES PIÈCES ÉCRITES, posées telles quelles (plus d'intitulé « Écrit · N »).
          Les pistes écartées et les versions antérieures vivent dans « Archives ». */}
      {ecrit.affichees.length ? (
        <div className="flex flex-col gap-2" data-rubrique-etape="ecrit">
          {ecrit.affichees.map((e) => (
            <PieceEcrite key={e.id} element={e} />
          ))}
        </div>
      ) : null}
    </section>
  );
}

/** Le nom d'une partie du document du Brief, traduit. */
function libelleDePartie(cle: string): string {
  return cle === PARTIE_DES_PIECES_FOURNIES ? t('Pièces fournies') : (LIBELLES_ETAPES[cle as EtapeDuSuivi]?.() ?? cle);
}

/**
 * LE BRIEF EN UN SEUL DOCUMENT (26/10/2026, demande de l'utilisateur : « juste
 * un cahier des charges »). En tête, le SOMMAIRE (une ligne par partie, qui fait
 * défiler la zone du volet jusqu'à elle) et, en haut à droite, « Copier » (le
 * texte en Markdown, images dites « Image : légende ») et « Télécharger » (une
 * archive : brief.md et ses images sous images/, à leur place dans le texte).
 * Puis chaque partie (brief, direction, scénario, storyboard, plans, pièces
 * fournies), ses sections sans cadre — titre, gestes au survol, texte — et les
 * images fournies ou d'ambiance posées là où le texte en parle
 * (`documentDuBrief`, shared/src/document-du-brief.ts).
 */
function DocumentDuBrief({
  cardId,
  carte,
  parties,
  titre,
  onArchives,
}: {
  cardId: string;
  carte: Card;
  parties: readonly PartieDuDocument<PieceDuSuivi>[];
  /** Le titre de l'étape (« Brief (Vidéo) »), en tête du texte copié ou téléchargé. */
  titre: string;
  /** Ouvre la feuille « Archives » de l'étape. */
  onArchives: () => void;
}) {
  const state = useApp();
  const pieces = state.attachments[carte.projectId];
  const titreDuTexte = `${titre} · ${carte.title}`;
  const medias = React.useMemo(() => mediasDuDocument(parties), [parties]);
  const texteCopie = React.useMemo(() => documentDuBriefEnMarkdown(parties, { titre: titreDuTexte, libelleDe: libelleDePartie }), [parties, titreDuTexte]);
  const telechargement = useTelechargerLeBrief({ carte, parties, medias, titre: titreDuTexte, nomDe: (id) => pieces?.find((p) => p.id === id)?.name });
  /* LES IMAGES DU BRIEF PASSENT PAR LA VIGNETTE COMMUNE (celle de « Ce que
     l'agent a vu ») : repère codé « #cf0d » en bas à gauche, heure en bas à
     droite, clic pour l'ouvrir en grand ; la légende se lit dessous. La
     visionneuse feuillette toutes les images du Brief. */
  const galerie = React.useMemo(
    () => medias.map((m): Attachment => pieces?.find((p) => p.id === m.attachmentId) ?? { id: m.attachmentId, projectId: carte.projectId, name: m.nomDeFichier ?? m.legende, mime: mimeDuNom(m.nomDeFichier), size: 0, sha: m.attachmentId, createdAt: m.quand ?? 0 }),
    [medias, pieces, carte.projectId],
  );
  const [ouverte, setOuverte] = React.useState<string | null>(null);
  const rendreMedia = React.useCallback(
    (m: MediaDuDocument) => {
      const piece = galerie.find((p) => p.id === m.attachmentId);
      const mime = piece?.mime ?? '';
      const media = mime.startsWith('video/') ? 'video' : mime.startsWith('audio/') ? 'son' : mime === 'application/pdf' ? 'pdf' : 'image';
      const quand = piece?.createdAt || m.quand || null;
      return (
        <VignetteDeCapture
          cle={`brief-${m.attachmentId}`}
          id={m.attachmentId}
          media={media}
          src={adresseDePiece(m.attachmentId)}
          libelle={m.legende}
          repere={piece?.alias ? etiquetteDePiece(piece) : null}
          quand={quand}
          infobulle={[m.legende, t('Ouvrir en grand'), quand ? heureExacte(quand) : ''].filter(Boolean).join(' · ')}
          apercuSeconde={piece?.apercuSeconde}
          onOuvrir={() => setOuverte(m.attachmentId)}
          className="encart-du-suivi"
        />
      );
    },
    [galerie],
  );
  /* CE QU'ON OUVRE OU REPLIE EST RETENU PAR CARTE, SUR TOUS LES APPAREILS
     (préférence en base, `suivi.brief.bascules`) : seuls les nœuds basculés y
     vivent, l'écart au défaut (parties ouvertes, Plans et Scènes repliés). */
  const [bascules, setBascules] = usePref<BasculesDuBrief>(PREF_DES_BASCULES_DU_BRIEF, {});
  const ouvert = (cle: string, parDefaut: boolean) => noeudOuvert(bascules, cardId, cle, parDefaut);
  const basculer = (cle: string) => setBascules(basculerUnNoeud(readPref<BasculesDuBrief>(PREF_DES_BASCULES_DU_BRIEF, {}), cardId, cle));
  /* Le sommaire ouvre la partie visée si elle est repliée, puis la fait défiler une fois montée. */
  const allerA = (ancre: string) => {
    const suite = ouvrirUnNoeud(readPref<BasculesDuBrief>(PREF_DES_BASCULES_DU_BRIEF, {}), cardId, ancre, true);
    if (suite) setBascules(suite);
    requestAnimationFrame(() => requestAnimationFrame(() => document.getElementById(ancre)?.scrollIntoView({ block: 'start', behavior: 'smooth' })));
  };
  return (
    <div className="flex min-w-0 flex-col gap-5" data-ecrit-de-l-etape="brief" data-document-du-brief={parties.length}>
      {/* LE SOMMAIRE DANS SON ENCART (26/10/2026) : un fond creusé qui se
          détache de l'étape en clair comme en sombre ; l'encart s'aligne sur
          le texte, et dedans, l'intitulé, les numéros et les boutons
          s'alignent sur sa marge. En haut à droite, le menu à trois points :
          Copier, Télécharger, Archives (26/10/2026). */}
      <div className="encart-du-suivi rounded-lg px-3 pb-2 pt-1.5" data-tete-du-brief="">
        <div className="flex items-center gap-2">
          <p className="min-w-0 flex-1 text-[11.5px] font-medium uppercase tracking-wide text-faint">{t('Sommaire')}</p>
          <div className="-mr-1.5 flex shrink-0 items-center">
            <MenuDeLEtape etape="brief" occupe={telechargement.occupe}>
              <DropdownMenuItem
                onSelect={() => void copierLeTexte(texteCopie).then(() => client.pushToast('info', t('Brief copié')))}
                data-copier-le-brief=""
                className="text-[13px]"
              >
                <Copy className="h-4 w-4" />
                {t('Copier')}
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={telechargement.lancer}
                disabled={telechargement.occupe}
                title={t('Télécharger le brief et ses images (.zip)')}
                data-telecharger-le-brief=""
                className="text-[13px]"
              >
                {telechargement.occupe ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                {t('Télécharger')}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <EntreeArchives onOuvrir={onArchives} />
            </MenuDeLEtape>
          </div>
        </div>
        <nav aria-label="Sommaire" data-sommaire-du-brief={parties.length}>
          <ol className="flex flex-col">
            {parties.map((p, i) => (
              <li key={p.ancre}>
                <button
                  type="button"
                  onClick={() => allerA(p.ancre)}
                  data-aller-a-la-partie={p.cle}
                  className="survol-du-suivi -mx-2 flex w-[calc(100%+1rem)] items-baseline gap-2.5 rounded px-2 py-1 text-left text-[13px] text-muted transition-colors hover:text-text sm:py-0.5"
                >
                  <span className="shrink-0 text-[11.5px] tabular-nums text-faint">{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate">{libelleDePartie(p.cle)}</span>
                </button>
              </li>
            ))}
          </ol>
        </nav>
      </div>
      <AttachmentPreview item={ouverte ? galerie.find((p) => p.id === ouverte) ?? null : null} galerie={galerie} onNaviguer={(p) => setOuverte(p.id)} onClose={() => setOuverte(null)} />
      {parties.map((p) => {
        const libelle = libelleDePartie(p.cle);
        const fondue = partieFondueDansSaSection(p, libelle);
        const partieOuverte = ouvert(p.ancre, true);
        const section = (sec: SectionDuDocument<PieceDuSuivi>, cle: string, sonOuverture: boolean) =>
          sec.piece ? (
            <PieceEcrite
              key={sec.ancre}
              element={sec.piece}
              document={{ ancre: sec.ancre, niveau: fondue ? 'h3' : 'h4', medias: sec.medias, rendreMedia, ouvert: sonOuverture, onBasculer: () => basculer(cle) }}
            />
          ) : (
            <SectionDImagesSeules key={sec.ancre} section={sec} niveau={fondue ? 'h3' : 'h4'} rendre={rendreMedia} ouvert={sonOuverture} onBasculer={() => basculer(cle)} />
          );
        /* Une partie fondue dans sa section unique (« Brief ») ne fait qu'un nœud : sa section, sous la clé de la partie. */
        if (fondue) {
          return (
            <section key={p.ancre} id={p.ancre} className="flex scroll-mt-2 flex-col" data-partie-du-brief={p.cle} data-bloc-etape={p.cle} data-partie-ouverte={partieOuverte ? '' : undefined}>
              {section(p.sections[0]!, p.ancre, partieOuverte)}
            </section>
          );
        }
        const enfants = p.sections.map((sec) => section(sec, sec.ancre, ouvert(sec.ancre, elementOuvertParDefaut(sec))));
        return (
          <section key={p.ancre} id={p.ancre} className="flex scroll-mt-2 flex-col" data-partie-du-brief={p.cle} data-bloc-etape={p.cle} data-partie-ouverte={partieOuverte ? '' : undefined}>
            <div className="flex min-w-0 items-start gap-1.5" data-titre-partie={p.cle}>
              <FlecheDuBrief ouvert={partieOuverte} onBasculer={() => basculer(p.ancre)} cle={p.ancre} />
              <h3 onClick={basculerSansSelection(() => basculer(p.ancre))} className="min-w-0 flex-1 cursor-pointer text-[15px] font-semibold leading-5 text-text">
                {libelle}
                {/* Repliée, la partie dit ce qu'elle cache. */}
                {partieOuverte ? null : <span className="ml-2 text-[12px] font-normal tabular-nums text-faint">{enfants.length}</span>}
              </h3>
            </div>
            {partieOuverte ? <EnfantsEnArbre niveau="element" ecart={ECART_DES_ELEMENTS} enfants={enfants} /> : null}
          </section>
        );
      })}
    </div>
  );
}

/** Des images posées dans le texte : l'aperçu de chacune, sa légende et son heure. */
function ImagesDuBrief({ medias, rendre }: { medias: readonly MediaDuDocument[]; rendre: (m: MediaDuDocument) => React.ReactNode }) {
  return (
    <ul className="flex flex-wrap gap-2 py-1" data-images-du-brief={medias.length}>
      {medias.map((m) => (
        <li key={m.attachmentId} className="flex min-w-0 max-w-[16rem] flex-col gap-0.5" data-image-du-brief={m.attachmentId} data-origine-image={m.origine}>
          {rendre(m)}
          <span className="w-28 truncate text-[11.5px] leading-4 text-faint" title={m.legende} data-legende-image="">
            {m.legende}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** « Pièces fournies » : les images que le texte ne cite nulle part, sous leur titre. */
function SectionDImagesSeules({
  section,
  niveau,
  rendre,
  ouvert,
  onBasculer,
}: {
  section: SectionDuDocument<PieceDuSuivi>;
  niveau: 'h3' | 'h4';
  rendre: (m: MediaDuDocument) => React.ReactNode;
  ouvert: boolean;
  onBasculer: () => void;
}) {
  const Titre = niveau;
  return (
    <div id={section.ancre} className="flex scroll-mt-2 flex-col gap-1.5" data-section-du-brief={PARTIE_DES_PIECES_FOURNIES}>
      <div className="flex min-w-0 items-start gap-1.5">
        <FlecheDuBrief ouvert={ouvert} onBasculer={onBasculer} cle={section.ancre} />
        <Titre onClick={basculerSansSelection(onBasculer)} className={cn('min-w-0 flex-1 cursor-pointer font-semibold leading-5 text-text', niveau === 'h3' ? 'text-[15px]' : 'text-[13.5px]')}>
          {t('Pièces fournies')}
        </Titre>
      </div>
      {ouvert ? <ImagesDuBrief medias={section.medias} rendre={rendre} /> : null}
    </div>
  );
}

/**
 * « TÉLÉCHARGER » LE BRIEF : une archive préparée par le serveur — brief.md à
 * la racine, chaque image sous images/<nom>, le texte pointant exactement vers
 * elles. La liste part dans le CORPS, jamais dans l'adresse ; le menu à trois
 * points tourne dès le clic (`occupe`).
 */
function useTelechargerLeBrief({
  carte,
  parties,
  medias,
  titre,
  nomDe,
}: {
  carte: Card;
  parties: readonly PartieDuDocument<PieceDuSuivi>[];
  medias: readonly MediaDuDocument[];
  titre: string;
  nomDe: (id: string) => string | undefined;
}) {
  const noms = nomsDesImagesDuBrief(medias, (m) => nomDe(m.attachmentId));
  const markdown = documentDuBriefEnMarkdown(parties, { titre, libelleDe: libelleDePartie, images: noms });
  const nomDeLArchive = `brief-${carte.title}`;
  const courant = React.useRef({ noms, markdown });
  courant.current = { noms, markdown };
  const archive = React.useMemo(
    () => ({
      adresse: `${ROUTE_ARCHIVE_DES_IMAGES}#brief:${carte.id}`,
      nom: `${nomDeLArchive}.zip`,
      preparer: async (signal: AbortSignal) => {
        const { noms: n, markdown: md } = courant.current;
        const corps: CorpsDArchive = { ids: [...n.keys()], chemins: [], nom: nomDeLArchive, nomsDansLArchive: Object.fromEntries(n), textes: [{ nom: 'brief.md', contenu: md }] };
        const reponse = await fetch(ROUTE_ARCHIVE_DES_IMAGES, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(corps),
          signal,
        });
        const rendu = (await reponse.json().catch(() => ({}))) as Partial<LotDArchive> & { error?: string };
        if (!reponse.ok || !rendu.adresse) throw new Error(rendu.error ?? String(reponse.status));
        return rendu.adresse;
      },
    }),
    [carte.id, nomDeLArchive],
  );
  const { etat, lancer } = useTelechargement([archive]);
  return { lancer, occupe: etat === 'reception' };
}

/**
 * LE CONTENU D'UNE ÉTAPE (26/10/2026) : ce qui est VALIDÉ, et l'écrit — tout
 * le reste vit dans la conversation et la bande du bas. Plus de « En
 * conception » ni de case « Image à venir ».
 *  - BRIEF : UN SEUL DOCUMENT (`DocumentDuBrief`) — sommaire, Copier,
 *    Télécharger, puis TOUT l'écrit (brief, direction, scénario, storyboard,
 *    plans, avec versions et corrections), les pièces fournies et l'ambiance
 *    posées dans le texte ; le type vit dans le titre « Brief (Vidéo) ».
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
        {/* Le type vit dans le titre (« Brief (Vidéo) ») ; sans type choisi, l'invite reste dans le corps. */}
        {types ? null : (
          <p className="text-[13px] text-text" data-invite-du-type="">
            {t('Choisissez ce que vous voulez créer au bouton caméra.')}
          </p>
        )}
        {ecrit ?? (
          <p className="text-[12.5px] text-faint" data-etape-vide="">
            {t('Rien d’écrit pour l’instant : le brief s’écrit avec le directeur, et pour une vidéo, le découpage en plans.')}
          </p>
        )}
      </>
    );
  }

  if (etape.etape === 'esquisses') {
    if (video) {
      const decoupage = decoupageDuMedia(production?.elements ?? []);
      const plans = etatDesPlans(decoupage, production?.medias ?? []).filter((p) => p.visuel);
      const phase = phaseDesEsquisses(typesDeLaCarte, carte.realisation);
      const son = sonDuBrief(elementsCourants(production?.elements ?? []).find((e) => e.genre === 'brief')?.contenu);
      const sons = retenus.filter((m) => m.genre === 'son');
      return (
        <>
          {plans.length ? (
            <ol className="flex flex-col gap-2" data-plans-du-suivi={plans.length} data-phase-des-esquisses={phase}>
              {plans.map((plan, i) => (
                <PlanDuSuivi
                  key={plan.cle}
                  cardId={cardId}
                  numero={i + 1}
                  plan={plan}
                  phase={phase}
                  enFabrication={{
                    image: enFabricationDuPlan(plan.cle, decoupage, production?.medias ?? [], 'image'),
                    sequence: enFabricationDuPlan(plan.cle, decoupage, production?.medias ?? [], 'video'),
                  }}
                  pieceDe={pieceDe}
                  onOuvrir={onOuvrir}
                />
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
                <button type="button" onClick={() => onOuvrir(f.piece)} title={t('Ouvrir en grand')} className="encart-du-suivi block aspect-video w-full overflow-hidden rounded-lg">
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
  enFabrication,
  pieceDe,
  onOuvrir,
}: {
  cardId: string;
  numero: number;
  plan: EtatDuPlan;
  phase: string;
  /** Combien de brouillons de ce plan se fabriquent encore, pour sa case image et sa case séquence. */
  enFabrication: { image: number; sequence: number };
  pieceDe: (id: string) => Attachment | undefined;
  onOuvrir: (id: string) => void;
}) {
  const image = plan.images[0] ?? null;
  const production = useProduction(cardId);
  const imageComplete = image ? production?.medias.find((m) => m.id === image.id) ?? null : null;
  const sequence = plan.sequence ? production?.medias.find((m) => m.id === plan.sequence!.id) ?? null : null;
  const animable = phase === 'sequences' && !!image && (!sequence || plan.aRefaire);
  /*
   * GLISSER-DÉPOSER À LA SOURIS (28/10/2026, `glisser-vers-un-plan.tsx`) : la
   * case d'image accepte une image, la case de séquence une vidéo (au second
   * temps seulement) ; une case pleine se glisse elle-même vers un autre plan,
   * où les deux médias échangent leur place.
   */
  const sourceImage = useSourceDuGlisser(
    imageComplete?.attachmentId ? { mediaId: imageComplete.id, attachmentId: imageComplete.attachmentId, genre: 'image', nom: plan.titre, plan: plan.cle } : null,
  );
  const sourceSequence = useSourceDuGlisser(
    sequence?.attachmentId && phase === 'sequences' ? { mediaId: sequence.id, attachmentId: sequence.attachmentId, genre: 'video', nom: plan.titre, plan: plan.cle } : null,
  );
  const etatCaseImage = useEtatDeLaCase(plan.cle, 'image');
  const etatCaseSequence = useEtatDeLaCase(plan.cle, 'video');
  const caseDeDepot = (genre: 'image' | 'video', etat: ReturnType<typeof useEtatDeLaCase>, contenu: React.ReactNode) => (
    <div
      data-case-du-plan={plan.cle}
      data-genre-accepte={genre}
      data-case-etat={etat ?? undefined}
      className={cn(
        'min-w-0 rounded-lg transition-[box-shadow,opacity] duration-150',
        etat === 'accepte' && 'ring-2 ring-teinte-trait',
        etat === 'survolee' && 'ring-2 ring-teinte',
        etat === 'refuse' && 'opacity-40',
      )}
    >
      {contenu}
    </div>
  );
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
  /*
   * LA CASE D'UN PLAN EN FABRICATION (27/10/2026) : le même balayage que le
   * bloc du fil (`.media-en-fabrication`, figé en veille et pour qui demande
   * moins d'animations), tant qu'un brouillon de ce plan se fabrique et que la
   * case n'a pas encore de média validé. Le média arrive ensuite dans le fil,
   * où on le valide ; il rejoint alors la case.
   */
  const enFabricationCase = (n: number) => (
    <div
      className="media-en-fabrication relative flex aspect-video w-full flex-col items-center justify-center gap-0.5 overflow-hidden rounded-lg fond-dans-encart px-2 text-center"
      data-case-en-fabrication={n}
    >
      <span className="text-[11.5px] text-teinte">{t('En fabrication')}</span>
      {n > 1 ? <span className="text-[11px] tabular-nums text-faint">{t('{n} brouillons', { n })}</span> : null}
    </div>
  );
  const vignette = (m: MediaDuSuivi | null, vide: string, fabrication = 0, source: React.HTMLAttributes<HTMLElement> = {}) =>
    !m?.attachmentId && fabrication > 0 ? (
      enFabricationCase(fabrication)
    ) : m?.attachmentId ? (
      <div className="relative" {...source}>
        <button type="button" onClick={() => onOuvrir(m.attachmentId!)} title={t('Ouvrir en grand')} className="fond-dans-encart block aspect-video w-full overflow-hidden rounded-lg">
          {m.genre === 'video' ? (
            <VignetteVideo id={m.attachmentId} nom={m.plan} seconde={pieceDe(m.attachmentId)?.apercuSeconde} className="pointer-events-none h-full w-full object-cover" />
          ) : (
            <ImageDePiece id={m.attachmentId} alt={m.plan} className="h-full w-full object-cover" />
          )}
        </button>
        {/* EN HAUT À DROITE : retirer la validation (la case se vide, le média reste dans la discussion), et le menu « … » à sa gauche. */}
        <div className="absolute right-1 top-1 flex items-center gap-1">
          <MenuDuMedia cardId={cardId} media={m} />
          <BoutonRetirerLaValidation cardId={cardId} media={m} />
        </div>
      </div>
    ) : (
      <div className="flex aspect-video w-full items-center justify-center fond-dans-encart rounded-lg px-2 text-center text-[11.5px] text-faint">{vide}</div>
    );
  return (
    <li className="encart-du-suivi flex min-w-0 flex-col gap-1.5 rounded-lg p-2" data-plan-du-suivi={plan.cle} data-plan-image={image ? '' : undefined} data-plan-sequence={sequence ? '' : undefined} data-plan-a-refaire={plan.aRefaire ? '' : undefined}>
      <p className="flex min-w-0 items-center gap-1.5 text-[12.5px] text-text">
        <span className="tabular-nums text-faint">{numero}</span>
        <span className="min-w-0 flex-1 truncate" title={plan.titre}>
          {plan.titre}
        </span>
        {plan.duree ? <span className="shrink-0 tabular-nums text-faint">{t('{n} s', { n: plan.duree })}</span> : null}
      </p>
      <div className="grid grid-cols-2 gap-1.5">
        {caseDeDepot('image', etatCaseImage, vignette(imageComplete, t('Image à valider'), enFabrication.image, sourceImage))}
        {phase === 'sequences' ? caseDeDepot('video', etatCaseSequence, (
          animable && enFabrication.sequence > 0 ? (
            enFabricationCase(enFabrication.sequence)
          ) : animable ? (
            <div className="flex aspect-video w-full flex-col items-center justify-center gap-1 rounded-lg fond-dans-encart p-1.5">
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
            vignette(sequence, t('Séquence à valider'), enFabrication.sequence, sourceSequence)
          )
        )) : (
          <div className="flex aspect-video w-full items-center justify-center rounded-lg fond-dans-encart px-2 text-center text-[11px] text-faint">{t('La séquence viendra après toutes les images')}</div>
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
      <div className={`${VIGNETTE_DU_SUIVI} relative flex items-center justify-center overflow-hidden rounded encart-du-suivi p-1`}>
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
      <div className="relative flex h-20 w-64 max-w-full shrink-0 flex-col justify-between overflow-hidden rounded encart-du-suivi p-1" title={infobulle}>
        <span className="min-w-0 truncate px-1 pr-14 text-[11px] leading-4 text-muted">{legende}</span>
        <LecteurSon id={media.attachmentId!} nom={legende} compact className="fond-dans-encart" onAgrandir={() => onOuvrir(media.attachmentId!)} />
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
        className={`${VIGNETTE_DU_SUIVI} relative flex items-center justify-center overflow-hidden rounded encart-du-suivi p-1.5 sm:p-1`}
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
              className="mt-0.5 rounded px-1.5 sm:px-1 py-1 sm:py-0.5 text-[12px] text-faint transition-colors survol-du-suivi hover:text-text"
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
function TexteDePiece({
  contenu,
  className,
  avant,
  apres,
  enArbre = false,
  ...repere
}: {
  contenu: string;
  className?: string;
  /** Ce qui se pose avant le premier paragraphe (une image citée par le titre). */
  avant?: React.ReactNode;
  /** Ce qui se pose après le paragraphe `i` (les images que ce paragraphe cite). */
  apres?: (i: number) => React.ReactNode;
  /** Dans l'arbre du Brief : chaque rubrique sur sa branche pointillée, ses images avec elle. */
  enArbre?: boolean;
} & Record<`data-${string}`, string>) {
  const blocs = React.useMemo(() => blocsDePiece(contenu), [contenu]);
  const rendre = (bloc: BlocDePiece, i: number) =>
    bloc.genre === 'intitule' ? (
      <div key={i} className="flex min-w-0 flex-col gap-1" data-intitule-piece="">
        {/* Une seule écriture pour tous les intitulés (« DURÉE » devient « Durée ») : le texte stocké ne bouge pas. */}
        <p className="text-[12.5px] font-semibold leading-5 text-text" data-titre-intitule="">
          {intituleLisible(bloc.titre)}
        </p>
        {bloc.texte ? <Markdown content={bloc.texte} enTexte /> : null}
      </div>
    ) : bloc.genre === 'texte' ? (
      <div key={i} className="flex min-w-0 gap-1.5" data-ligne-piece="">
        {bloc.numero ? <span className="shrink-0 text-[12.5px] leading-5 tabular-nums text-muted">{bloc.numero}</span> : null}
        <Markdown content={bloc.texte} enTexte className="min-w-0 flex-1" />
      </div>
    ) : (
      <Markdown key={i} content={bloc.texte} enTexte />
    );
  if (enArbre) {
    return (
      <div className={cn('piece-du-suivi flex min-w-0 select-text flex-col gap-2 break-words', className)} {...repere}>
        {avant}
        <EnfantsEnArbre
          niveau="rubrique"
          ecart={ECART_DES_RUBRIQUES}
          enfants={blocs.map((bloc, i) => (
            <div key={i} className="flex min-w-0 flex-col gap-1" data-rubrique-du-brief={i}>
              {rendre(bloc, i)}
              {apres?.(i)}
            </div>
          ))}
        />
      </div>
    );
  }
  return (
    <div className={cn('piece-du-suivi flex min-w-0 select-text flex-col gap-3 break-words', className)} {...repere}>
      {avant}
      {blocs.map((bloc, i) => (
        <React.Fragment key={i}>
          {rendre(bloc, i)}
          {apres?.(i)}
        </React.Fragment>
      ))}
    </div>
  );
}

/*
 * L'ARBRE DU BRIEF (26/10/2026) : chaque niveau — partie, élément (Plan, Scène,
 * direction…), rubrique — est décalé de `RETRAIT_DE_L_ARBRE` et relié au
 * précédent par le fil pointillé des projets réunis de la colonne de gauche
 * (`CLASSE_TRAIT_DE_BRANCHE`, coude arrondi chez le dernier). L'axe passe sous
 * le milieu de la flèche du parent (`AXE_DE_L_ARBRE`), la branche s'arrête à
 * 3 px du contenu, à hauteur du milieu de sa première ligne (`MILIEU_DE_LIGNE`,
 * toutes les têtes ont une ligne de 20 px). Aucun cadre : DEC-420.
 */
const RETRAIT_DE_L_ARBRE = 20;
const AXE_DE_L_ARBRE = 7;
const MILIEU_DE_LIGNE = 10;
/** L'air sous la tête d'un nœud, avant son premier enfant (marge de la liste des éléments, `mt-2` du texte d'un élément). */
const ECART_SOUS_LA_TETE = 8;
const ECART_DES_ELEMENTS = 10;
const ECART_DES_RUBRIQUES = 14;

/** La branche d'un enfant de l'arbre : absolue, sans pointeur, elle ne change rien à la ligne. */
function BrancheDuBrief({ premier, dernier, ecart }: { premier: boolean; dernier: boolean; ecart: number }) {
  /* Le premier remonte jusque sous la flèche du parent ; les suivants couvrent l'écart au-dessus d'eux. */
  const haut = premier ? -ECART_SOUS_LA_TETE : -ecart;
  const largeur = RETRAIT_DE_L_ARBRE - 3 - AXE_DE_L_ARBRE;
  const trait = CLASSE_TRAIT_DE_BRANCHE;
  return (
    <span aria-hidden data-branche-du-brief={dernier ? 'dernier' : 'milieu'} className="pointer-events-none absolute inset-0">
      {dernier ? (
        <span className={`${trait} rounded-bl-[5px] border-b border-l`} style={{ left: AXE_DE_L_ARBRE, top: haut, height: MILIEU_DE_LIGNE + 0.5 - haut, width: largeur }} />
      ) : (
        <>
          <span className={`${trait} bottom-0 border-l`} style={{ left: AXE_DE_L_ARBRE, top: haut }} />
          <span className={`${trait} border-t`} style={{ left: AXE_DE_L_ARBRE, top: MILIEU_DE_LIGNE - 0.5, width: largeur }} />
        </>
      )}
    </span>
  );
}

/** Les enfants d'un nœud, chacun sur sa branche. */
function EnfantsEnArbre({ enfants, ecart, niveau }: { enfants: readonly React.ReactNode[]; ecart: number; niveau: 'element' | 'rubrique' }) {
  if (!enfants.length) return null;
  return (
    <ul className="flex min-w-0 flex-col" style={{ gap: ecart, marginTop: niveau === 'element' ? ECART_SOUS_LA_TETE : undefined }} data-enfants-du-brief={niveau}>
      {enfants.map((enfant, i) => (
        <li key={i} className="relative min-w-0" style={{ paddingLeft: RETRAIT_DE_L_ARBRE }} data-noeud-du-brief={niveau}>
          <BrancheDuBrief premier={i === 0} dernier={i === enfants.length - 1} ecart={ecart} />
          {enfant}
        </li>
      ))}
    </ul>
  );
}

/** La flèche d'un nœud : un bouton seul (jamais le titre dedans), qui replie ou déplie ses enfants. */
function FlecheDuBrief({ ouvert, onBasculer, cle }: { ouvert: boolean; onBasculer: () => void; cle: string }) {
  return (
    <button
      type="button"
      onClick={onBasculer}
      aria-expanded={ouvert}
      aria-label={ouvert ? 'Replier' : 'Déplier'}
      title={ouvert ? t('Replier') : t('Déplier')}
      data-basculer-noeud={cle}
      className="survol-du-suivi -ml-[3px] flex h-5 w-5 shrink-0 items-center justify-center rounded text-faint transition-colors hover:text-text"
    >
      <ChevronRight className={cn('h-3.5 w-3.5 transition-transform', ouvert && 'rotate-90')} aria-hidden />
    </button>
  );
}

/** Basculer en touchant le titre d'un nœud, sauf quand on vient d'y sélectionner du texte. */
function basculerSansSelection(basculer: () => void) {
  return () => {
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed && selection.toString().trim()) return;
    basculer();
  };
}

/** « v3 · 14:32 · par vous » : la ligne qui situe une version. */
function metaDeVersion(v: Pick<VersionDuSuivi, 'version' | 'creeLe' | 'auteur'>): string {
  return `v${v.version} · ${heureDuMessage(v.creeLe)} · ${v.auteur === 'utilisateur' ? t('par vous') : t('par l’agent')}`;
}

/**
 * LE MENU À TROIS POINTS D'UNE ÉTAPE (26/10/2026, décision de l'utilisateur) :
 * un petit bouton « ⋮ » en tête de l'étape, jamais dans le bouton de
 * l'accordéon. Au Brief il remplace Copier et Télécharger et les regroupe avec
 * « Archives » ; ailleurs il ne porte que « Archives ». `occupe` : une requête
 * partie du menu (le téléchargement) fait tourner le bouton dès le clic.
 */
function MenuDeLEtape({ etape, occupe = false, children }: { etape: string; occupe?: boolean; children: React.ReactNode }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Plus d’actions"
          title={t('Plus d’actions')}
          aria-busy={occupe || undefined}
          data-menu-de-l-etape={etape}
          className="survol-du-suivi flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-faint transition-colors hover:text-text data-[state=open]:text-text"
        >
          {occupe ? <Loader2 className="h-4 w-4 animate-spin" /> : <MoreVertical className="h-4 w-4" />}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[12rem]" data-entrees-du-menu-de-l-etape={etape}>
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** L'entrée « Archives » d'un menu d'étape. */
function EntreeArchives({ onOuvrir }: { onOuvrir: () => void }) {
  return (
    <DropdownMenuItem onSelect={onOuvrir} data-ouvrir-les-archives="" className="text-[13px]">
      <History className="h-4 w-4" />
      {t('Archives')}
    </DropdownMenuItem>
  );
}

/** Ce qu'une étape garde en archive : les pièces qui ont plusieurs versions, et les pistes écartées avec la pièce qui les reprend. */
interface ArchivesDeLEtape {
  pieces: readonly PieceDuSuivi[];
  pistes: readonly { piste: PieceDuSuivi; hote: PieceDuSuivi }[];
}

/**
 * LES ARCHIVES D'UNE ÉTAPE, depuis ses blocs écrits (`piecesAffichees` sort
 * toujours les directions écartées) : chaque pièce montrée qui a une version
 * antérieure, puis les « Autres pistes ». Une piste se reprend sur la direction
 * retenue (« Utiliser cette direction »), sinon elle se remet en lice.
 */
function archivesDeLEtape(blocs: readonly BlocDuMedia[]): ArchivesDeLEtape {
  const pieces: PieceDuSuivi[] = [];
  const pistes: { piste: PieceDuSuivi; hote: PieceDuSuivi }[] = [];
  for (const bloc of blocs) {
    const ecrit = piecesAffichees(bloc.elements);
    pieces.push(...ecrit.affichees.filter((e) => e.versions.length > 1));
    for (const piste of ecrit.ecartees) pistes.push({ piste, hote: ecrit.retenue ?? { ...piste, versions: [] } });
  }
  return { pieces, pistes };
}

/** Une étape a-t-elle quelque chose en archive ? */
function aDesArchives(a: ArchivesDeLEtape): boolean {
  return a.pieces.length > 0 || a.pistes.length > 0;
}

/**
 * LA FEUILLE « ARCHIVES » D'UNE ÉTAPE (26/10/2026) : à la place des menus
 * « Versions » posés sous chaque pièce. Pour chaque pièce, ses versions (la
 * plus récente d'abord, la version en cours marquée) ; puis les autres pistes.
 * Toucher une ligne l'ouvre dans le tiroir de lecture, qui la reprend.
 */
function FeuilleDesArchives({
  cardId,
  etape,
  libelle,
  archives,
  open,
  onClose,
}: {
  cardId: string;
  etape: string;
  /** Le nom de l'étape, sous le titre de la feuille. */
  libelle: string;
  archives: ArchivesDeLEtape;
  open: boolean;
  onClose: () => void;
}) {
  const [lecture, setLecture] = React.useState<{ piece: PieceDuSuivi; lecture: Lecture } | null>(null);
  /* La dernière pièce lue reste au tiroir pendant qu'il se referme. */
  const derniere = React.useRef<PieceDuSuivi | null>(null);
  if (lecture) derniere.current = lecture.piece;
  const ligne = 'survol-du-suivi flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left text-[13px] transition-colors sm:py-1.5';
  return (
    <>
      <Drawer open={open} onClose={onClose} feuille empile>
        <EnteteDeFeuille titre={t('Archives')} sousTitre={libelle} data-feuille-des-archives={etape} />
        <ZoneDefilement classeEnveloppe="min-h-0 flex-1" className="flex flex-col gap-5 px-4 pb-[calc(16px+env(safe-area-inset-bottom))]">
          {aDesArchives(archives) ? null : (
            <p className="py-2 text-[13px] text-faint" data-archives-vides="">
              {t('Aucune version antérieure pour l’instant.')}
            </p>
          )}
          {archives.pieces.map((piece) => {
            const courante = piece.versions[0]?.version;
            return (
              <section key={piece.id} className="flex flex-col gap-1" data-archive-element={piece.cle} data-nombre-versions={piece.versions.length}>
                <h3 className="flex items-baseline gap-2 px-2 text-[13.5px] font-semibold text-text">
                  <span className="min-w-0 flex-1 truncate">{piece.titre}</span>
                  <span className="shrink-0 text-[12px] font-normal tabular-nums text-faint">{t('{n} versions', { n: piece.versions.length })}</span>
                </h3>
                <ul className="flex flex-col">
                  {piece.versions.map((v) => {
                    const estCourante = v.version === courante;
                    return (
                      <li key={v.id}>
                        <button
                          type="button"
                          onClick={() => setLecture({ piece, lecture: { genre: 'version', version: v } })}
                          data-version-element={v.version}
                          data-version-courante={estCourante ? '' : undefined}
                          className={ligne}
                        >
                          <span className={cn('w-7 shrink-0 tabular-nums', estCourante ? 'font-semibold text-text' : 'text-muted')}>v{v.version}</span>
                          <span className="min-w-0 flex-1 truncate text-faint">
                            {heureDuMessage(v.creeLe)} · {v.auteur === 'utilisateur' ? t('par vous') : t('par l’agent')}
                          </span>
                          {estCourante ? <span className="shrink-0 text-[12px] text-muted">{t('en cours')}</span> : null}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
          {archives.pistes.length ? (
            <section className="flex flex-col gap-1" data-archives-pistes={archives.pistes.length}>
              <h3 className="px-2 text-[13.5px] font-semibold text-text">{t('Autres pistes')}</h3>
              <ul className="flex flex-col">
                {archives.pistes.map(({ piste, hote }) => (
                  <li key={piste.id}>
                    <button type="button" onClick={() => setLecture({ piece: hote, lecture: { genre: 'piste', piste } })} data-piste-ecartee={piste.cle} className={ligne}>
                      <span className="min-w-0 flex-1 truncate text-muted">{piste.titre}</span>
                      <span className="shrink-0 text-[12px] text-faint">{t('Écartée')}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </ZoneDefilement>
      </Drawer>
      {derniere.current ? (
        <TiroirDeLecture
          cardId={cardId}
          piece={derniere.current}
          lecture={lecture?.lecture ?? null}
          onClose={() => setLecture(null)}
          onUtilise={onClose}
        />
      ) : null}
    </>
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
  onUtilise,
}: {
  cardId: string;
  piece: PieceDuSuivi;
  lecture: Lecture | null;
  onClose: () => void;
  /** Une version ou une piste reprise : ce qui doit se refermer avec le tiroir (la feuille « Archives »). */
  onUtilise?: () => void;
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
      onUtilise?.();
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
 * UNE PIÈCE ÉCRITE DU SUIVI, EN LECTURE SEULE (26/10/2026, décision de
 * l'utilisateur : « la modification se fait directement depuis l'agent »).
 * Plus de « Modifier », de « Corriger avec l'agent » ni de « Versions » sous
 * les pièces : on corrige en écrivant à l'agent, et les versions antérieures
 * comme les pistes écartées se reprennent dans la feuille « Archives » du menu
 * à trois points de l'étape (`MenuDeLEtape`, `FeuilleDesArchives`).
 */
/** Une pièce posée dans le document du Brief : son ancre, son niveau de titre, ses images à leur place. */
interface PlaceDansLeDocument {
  ancre: string;
  niveau: 'h3' | 'h4';
  medias: readonly MediaDuDocument[];
  rendreMedia: (m: MediaDuDocument) => React.ReactNode;
  /** Le nœud de l'arbre : ouvert ou replié, et sa flèche. */
  ouvert: boolean;
  onBasculer: () => void;
}

function PieceEcrite({
  element: e,
  document: place,
}: {
  element: PieceDuSuivi;
  /** Dans le document du Brief : plus de cadre ni de bande, un titre de section. */
  document?: PlaceDansLeDocument;
}) {
  const Titre = place?.niveau ?? 'h5';
  const etat =
    e.etat === 'a-valider' ? (
      <span className={cn('shrink-0 text-[11.5px] text-en-cours', place ? 'leading-5' : 'pt-px')}>{t('À valider')}</span>
    ) : e.etat === 'refuse' ? (
      <span className={cn('shrink-0 text-[11.5px] text-faint', place ? 'leading-5' : 'pt-px')}>{t('Écartée')}</span>
    ) : null;
  return (
    /* Une piste ÉCARTÉE (direction non retenue) reste lisible, en retrait. */
    <div
      id={place?.ancre}
      className={
        place
          ? cn('section-du-brief flex scroll-mt-2 flex-col', e.etat === 'refuse' && 'opacity-60')
          : cn('encart-du-suivi rounded-lg px-3 pb-2', e.etat === 'refuse' && 'opacity-60')
      }
      data-creation-suivi="texte"
      data-element-suivi={e.cle}
      data-etat-element={e.etat}
      data-section-du-brief={place ? e.cle : undefined}
    >
      {place ? (
        <>
          {/* LE TITRE DE LA SECTION, sans cadre ni bande : à droite, son état. */}
          <div className="flex min-w-0 items-start gap-1.5" data-titre-section={e.cle} data-noeud-ouvert={place.ouvert ? '' : undefined}>
            <FlecheDuBrief ouvert={place.ouvert} onBasculer={place.onBasculer} cle={place.ancre} />
            <div className="flex min-w-0 flex-1 flex-wrap items-start gap-x-1.5 gap-y-0.5">
              {/* Le titre n'est pas un bouton (on y sélectionne du texte) : le toucher bascule quand même le nœud. */}
              <Titre
                onClick={basculerSansSelection(place.onBasculer)}
                className={cn('min-w-0 flex-1 cursor-pointer break-words font-semibold leading-5 text-text', place.niveau === 'h3' ? 'text-[15px]' : 'text-[13.5px]')}
              >
                {e.titre}
              </Titre>
              {etat}
            </div>
          </div>
          {/* Replié, le texte n'est pas monté : Copier et Télécharger lisent le document, pas l'écran. */}
          {place.ouvert ? (
            <TexteDePiece
              contenu={e.contenu}
              enArbre
              className="mt-2"
              data-texte-entier=""
              avant={place.medias.some((m) => m.apres < 0) ? <ImagesDuBrief medias={place.medias.filter((m) => m.apres < 0)} rendre={place.rendreMedia} /> : null}
              apres={(i) => {
                const ici = place.medias.filter((m) => m.apres === i);
                return ici.length ? <ImagesDuBrief medias={ici} rendre={place.rendreMedia} /> : null;
              }}
            />
          ) : null}
        </>
      ) : (
        <>
          {/* LA BANDE DU TITRE, pleine largeur en haut du bloc, sur un fond plus
              marqué que le corps (`.bande-de-titre-de-piece`) : le titre en gras à
              gauche, son état à droite. */}
          <div className="bande-de-titre-de-piece -mx-3 flex items-start gap-1.5 rounded-t-lg px-3 py-1.5" data-titre-piece={e.cle}>
            <h5 className="min-w-0 flex-1 break-words text-[13.5px] font-semibold leading-snug text-text">{e.titre}</h5>
            {etat}
          </div>
          {/* LE TEXTE ENTIER, sans coupure, mis en page : intitulés en gras, listes, tableaux. */}
          <TexteDePiece contenu={e.contenu} className="mt-2" data-texte-entier="" />
        </>
      )}
    </div>
  );
}
