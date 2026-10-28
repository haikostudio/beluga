import * as React from 'react';
import { Check, ChevronLeft, Clapperboard, Download, Footprints, Loader2, MessageSquarePlus, Move3d, RotateCw, ScanFace, SlidersHorizontal, SunMedium, Undo2, X } from 'lucide-react';
import {
  ANGLES_DE_VUE,
  PARAMETRES_DES_ANGLES,
  animationPermise,
  carteDeMedia,
  catalogueDeGeneration,
  decoupageDuMedia,
  etatDesPlans,
  phaseDesEsquisses,
  planDuMedia,
  typesDeMediaDeLaRealisation,
  heureExacte,
  estUneRetoucheDImage,
  genreDePieceDuFil,
  informationsDuMedia,
  planDePieceDuFil,
  type Attachment,
  type CapaciteDeGeneration,
  type EtatDuPlan,
  type InformationDeMedia,
  type MediaDuSuivi,
} from '@beluga/shared';
import {
  ActionTiroir,
  Button,
  Drawer,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  EnteteDeFeuille,
  Input,
  MenuActions,
  Textarea,
  ZoneDefilement,
  ListeDeroulante,
} from '@/components/ui';
import { adresseDePiece, ImageDePiece } from '@/components/pastille-de-fichier';
import { VignetteVideo } from '@/components/lecteur-video';
import { LIBELLES_OPERATIONS_DU_PANNEAU, PanneauDuMedia, type OperationDuPanneau } from '@/components/creation/panneau-du-media';
import { client } from '@/lib/client';
import { joindreAuChamp } from '@/lib/joindre-au-champ';
import { useProduction } from '@/lib/production-de-carte';
import { useTelechargement } from '@/lib/telechargement';
import { useApp } from '@/lib/use-app';
import { t } from '@/lib/langue';
import { cn } from '@/lib/utils';

/**
 * LE MENU « … » D'UN MÉDIA FABRIQUÉ (agent créatif, 24/10/2026 ; refait le
 * 26/10/2026 : « Valider » en premier, et chaque option qui fabrique ouvre SON
 * PANNEAU — `PanneauDuMedia`, feuille du bas avec le modèle choisi d'office et
 * le prix sur le bouton —, au lieu d'écrire un message à l'agent qui
 * reposait ses questions une à une). Ce qui suit décrit le menu d'avant ; les
 * gestes d'image et de vidéo passent désormais tous par leur panneau.
 *
 * (Version du 24/10/2026 :)
 *
 * En haut à droite de chaque image, vidéo ou son — dans la discussion comme
 * dans le suivi de la production —, les trois points ouvrent ses options :
 *  - « Réglages » : TOUTES ses données (consigne, service, modèle, format,
 *    dimensions, durée, réglages de retouche, prix, version, origine), les
 *    modifiables se changent et « Relancer avec ces réglages » repart par
 *    l'agent, devis compris ;
 *  - « Ajouter au suivi » / « Retirer du suivi » : le suivi de droite est le
 *    cahier de la production, il ne garde que ce qu'on y ajoute ; retirer ne
 *    touche jamais au fichier ;
 *  - « Redemander avec une consigne » : le média rejoint le champ d'écriture,
 *    on écrit ce qu'on veut changer ;
 *  - « Télécharger » ;
 *  - pour une IMAGE : « Animer ce plan » (l'agent demande l'image de fin, le
 *    modèle et le nombre de propositions), « Autres angles », « Changer la
 *    lumière », « Remplacer le visage » — l'agent demande alors le modèle
 *    (avec la différence de prix), le réglage puis le nombre d'images ;
 *  - pour une VIDÉO : « Reprendre ses gestes » (contrôle du mouvement : un
 *    personnage d'une image refait les gestes de cette vidéo) ;
 *  rien ne part sans devis validé.
 *
 * Sous le média, une LIGNE D'INFORMATIONS selon son genre (format, dimensions,
 * durée, images par seconde, débit, poids) : seulement ce qui est mesuré.
 *
 * Chaque geste qui parle à l'agent passe par un vrai message de l'utilisateur
 * (`agent.prompt`) : il se lit dans le fil, et deux demandes rapprochées se
 * suivent au lieu de se doubler.
 */

/** L'agent qui porte la discussion de la carte : c'est à lui que parlent les gestes du menu. */
export const ContexteAgentDuFil = React.createContext<string | null>(null);

/** Le média de la production qui correspond à une pièce jointe ou à un identifiant de média. */
export function useMediaDeProduction(cardId: string | null | undefined, ou: { mediaId?: string | null; attachmentId?: string | null }): MediaDuSuivi | null {
  const production = useProduction(cardId);
  return React.useMemo(() => {
    if (!production) return null;
    if (ou.mediaId) return production.medias.find((m) => m.id === ou.mediaId) ?? null;
    if (ou.attachmentId) return production.medias.find((m) => m.attachmentId === ou.attachmentId) ?? null;
    return null;
  }, [production, ou.mediaId, ou.attachmentId]);
}

const MIME_DU_GENRE: Record<MediaDuSuivi['genre'], string> = { image: 'image/png', video: 'video/mp4', son: 'audio/mpeg' };

/** La légende d'un média : son plan et sa version. */
export function legendeDuMedia(m: Pick<MediaDuSuivi, 'plan' | 'version'>): string {
  return `${m.plan}${m.version > 1 ? ` · v${m.version}` : ''}`;
}

/* ------------------------------------------------------------------ */
/* Parler à l'agent                                                     */
/* ------------------------------------------------------------------ */

async function direALAgent(agentId: string, texte: string, attachments: string[] = []): Promise<void> {
  await client.call({ type: 'agent.prompt', agentId, text: texte, attachments });
}

/*
 * AJOUTS ET RETRAITS GROUPÉS : trois images ajoutées d'affilée font UN message
 * à l'agent, pas trois tours. On attend un instant de calme avant de le lui dire.
 */
const enAttente = new Map<string, { lignes: string[]; minuterie: ReturnType<typeof setTimeout> | null }>();
function annoncerAuSuivi(agentId: string, ligne: string) {
  const file = enAttente.get(agentId) ?? { lignes: [], minuterie: null };
  file.lignes.push(ligne);
  if (file.minuterie) clearTimeout(file.minuterie);
  file.minuterie = setTimeout(() => {
    enAttente.delete(agentId);
    void direALAgent(agentId, file.lignes.join('\n')).catch(() => client.pushToast('error', t('L’agent n’a pas pu être prévenu : écrivez-lui ce que vous avez retenu.')));
  }, 1500);
  enAttente.set(agentId, file);
}

/* ------------------------------------------------------------------ */
/* La ligne d'informations                                              */
/* ------------------------------------------------------------------ */

function nombre(n: number, decimales = 1): string {
  return (Math.round(n * 10 ** decimales) / 10 ** decimales).toLocaleString(undefined, { maximumFractionDigits: decimales });
}

export function texteDUneInformation(i: InformationDeMedia): string {
  switch (i.genre) {
    case 'format':
      return i.valeur;
    case 'dimensions':
      return `${i.largeur} × ${i.hauteur} px`;
    case 'duree':
      return i.secondes >= 60 ? `${Math.floor(i.secondes / 60)} min ${nombre(i.secondes % 60, 0)} s` : `${nombre(i.secondes)} s`;
    case 'ips':
      return t('{n} im/s', { n: nombre(i.valeur) });
    case 'debit':
      return i.kbps >= 1000 ? `${nombre(i.kbps / 1000)} Mb/s` : `${i.kbps} kb/s`;
    case 'poids':
      return i.octets >= 1_000_000 ? t('{n} Mo', { n: nombre(i.octets / 1_000_000) }) : t('{n} ko', { n: nombre(i.octets / 1000, 0) });
  }
}

/** LA LIGNE D'INFORMATIONS SOUS UN MÉDIA : copiable, sur une ligne qui passe à la ligne plutôt que de déborder. */
export function InformationsDuMedia({ media, className }: { media: MediaDuSuivi; className?: string }) {
  const infos = informationsDuMedia({ genre: media.genre, format: media.format ?? null, mesure: media.mesure ?? null, taille: media.taille ?? null });
  if (!infos.length) return null;
  return (
    <p className={cn('flex min-w-0 select-text flex-wrap gap-x-1.5 text-[11.5px] tabular-nums leading-snug text-faint', className)} data-meta-media={media.id}>
      {infos.map((i, n) => (
        <React.Fragment key={i.genre}>
          {n ? <span aria-hidden>·</span> : null}
          <span data-meta-genre={i.genre}>{texteDUneInformation(i)}</span>
        </React.Fragment>
      ))}
    </p>
  );
}

/** La petite marque d'un média validé, en violet (l'élément choisi). */
export function MarqueDansLeSuivi({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1 rounded bg-teinte-plein px-1 text-[10.5px] leading-4 text-sur-couleur', className)} data-media-dans-le-suivi="">
      <Check className="h-3 w-3" aria-hidden />
      {t('Validé')}
    </span>
  );
}

/**
 * RETIRER LA VALIDATION D'UN MÉDIA, EN HAUT À DROITE DE SA CASE DANS LE VOLET
 * (27/10/2026). Même geste que « Retirer la validation » du menu « … » : le
 * média quitte le volet des esquisses et RESTE dans la discussion — aucun
 * fichier effacé, aucune archive.
 */
export function BoutonRetirerLaValidation({ cardId, media, className }: { cardId: string; media: MediaDuSuivi; className?: string }) {
  const [enVol, setEnVol] = React.useState(false);
  if (!media.retenuLe) return null;
  const retirer = async (event: React.MouseEvent) => {
    event.stopPropagation();
    if (enVol) return;
    setEnVol(true);
    try {
      await client.call({ type: 'production.retenir', cardId, mediaId: media.id, retenu: false });
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('La validation n’a pas pu être enregistrée'));
    } finally {
      setEnVol(false);
    }
  };
  return (
    <button
      type="button"
      onClick={(event) => void retirer(event)}
      aria-busy={enVol}
      disabled={enVol}
      title={t('Retirer la validation')}
      aria-label="Retirer la validation"
      data-retirer-la-validation={media.id}
      className={cn('inline-flex h-7 w-7 items-center justify-center rounded-md bg-surface/85 text-text transition-colors hover:bg-surface', className)}
    >
      {enVol ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Le choix du plan                                                     */
/* ------------------------------------------------------------------ */

/**
 * LES PLANS OÙ CE MÉDIA PEUT ÊTRE PLACÉ (28/10/2026 : « quand on valide, un
 * second menu demande dans quel plan on veut insérer cette image »). Seulement
 * dans une création de média découpée en plans : une image va dans la case
 * d'image d'un plan, une vidéo dans sa case de séquence — qui n'existe qu'au
 * second temps des esquisses. Sans plans (une photo seule) ou pour un son :
 * `null`, et « Valider » reste un seul clic.
 */
function usePlansPourLeMedia(cardId: string, media: Pick<MediaDuSuivi, 'genre'>): EtatDuPlan[] | null {
  const production = useProduction(cardId);
  const carte = useApp().cards[cardId];
  return React.useMemo(() => {
    if (!production || !carte || !carteDeMedia(carte) || media.genre === 'son') return null;
    if (media.genre === 'video' && phaseDesEsquisses(typesDeMediaDeLaRealisation(carte.realisation), carte.realisation) !== 'sequences') return null;
    const plans = etatDesPlans(decoupageDuMedia(production.elements), production.medias).filter((p) => p.visuel);
    return plans.length ? plans : null;
  }, [production, carte, media.genre]);
}

/**
 * PLACER UN MÉDIA DANS UN PLAN : la demande au démon, après l'inscription d'un
 * média du fil encore inconnu. Ne réveille aucun agent et ne coûte rien.
 */
export async function placerDansUnPlan(cardId: string, mediaId: string, plan: string): Promise<void> {
  await client.call({ type: 'production.placer', cardId, mediaId, plan });
}

/**
 * LA LISTE DES PLANS, SECOND NIVEAU DE « VALIDER » : numéro et titre de chaque
 * plan, le plan pour lequel l'agent a fait le média marqué « prévu », et, quand
 * la case est déjà pleine, la vignette de ce qu'on va remplacer.
 */
function ListeDesPlans({
  cardId,
  media,
  plans,
  assurer,
  fermer,
  retour,
}: {
  cardId: string;
  media: MediaDuSuivi;
  plans: EtatDuPlan[];
  assurer: () => Promise<MediaDuSuivi>;
  fermer: () => void;
  /** Le retour au premier niveau, quand la liste est le second niveau d'un menu. */
  retour?: () => void;
}) {
  const [enVol, setEnVol] = React.useState<string | null>(null);
  const prevu = planDuMedia(media.plan, plans);
  const placer = async (cle: string) => {
    if (enVol) return;
    setEnVol(cle);
    try {
      const m = await assurer();
      await placerDansUnPlan(cardId, m.id, cle);
      fermer();
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('La validation n’a pas pu être enregistrée'));
    } finally {
      setEnVol(null);
    }
  };
  return (
    <div className="flex flex-col gap-0.5" data-menu-des-plans={media.id || media.attachmentId || ''}>
      {retour ? (
        <ActionTiroir icone={<ChevronLeft className="h-4 w-4" />} onClick={retour} disabled={!!enVol} data-retour-des-plans="">
          {t('Retour')}
        </ActionTiroir>
      ) : null}
      <p className="px-2 pb-1 pt-1.5 text-[12px] text-faint">{media.genre === 'video' ? t('Dans quel plan placer cette séquence ?') : t('Dans quel plan placer cette image ?')}</p>
      {plans.map((plan, i) => {
        const occupant = media.genre === 'video' ? plan.sequence : (plan.images[0] ?? null);
        const pleine = !!occupant && occupant.id !== media.id;
        const piece = pleine ? (occupant as MediaDuSuivi).attachmentId : null;
        return (
          <ActionTiroir
            key={plan.cle}
            icone={
              enVol === plan.cle ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : piece ? (
                <span className="block h-6 w-10 overflow-hidden rounded-sm bg-raised" data-occupant-du-plan={occupant!.id}>
                  {media.genre === 'video' ? (
                    <VignetteVideo id={piece} nom={plan.titre} className="pointer-events-none h-full w-full object-cover" />
                  ) : (
                    <ImageDePiece id={piece} alt={plan.titre} className="h-full w-full object-cover" />
                  )}
                </span>
              ) : (
                <span className="block w-10 text-center text-[12px] tabular-nums">{i + 1}</span>
              )
            }
            onClick={() => void placer(plan.cle)}
            disabled={!!enVol}
            valeur={plan.cle === prevu ? t('prévu') : undefined}
            data-placer-dans-le-plan={plan.cle}
            data-plan-prevu={plan.cle === prevu ? '' : undefined}
            data-plan-plein={pleine ? '' : undefined}
          >
            <span className="block truncate">
              {piece ? <span className="mr-1 tabular-nums text-faint">{i + 1}</span> : null}
              {plan.titre}
            </span>
            {pleine ? (
              <span className="block truncate text-[12px] text-faint">
                {media.genre === 'video' ? t('remplacera la séquence actuelle') : t('remplacera l’image actuelle')}
              </span>
            ) : null}
          </ActionTiroir>
        );
      })}
    </div>
  );
}

/**
 * « VALIDER » D'UN CLIC, DIRECTEMENT SUR LE MÉDIA (26/10/2026) : le média
 * entre dans le volet de droite (il servira au montage) ; un second clic
 * retire la validation, sans jamais toucher au fichier. Violet une fois validé,
 * discret avant. Plusieurs brouillons d'une même génération peuvent l'être.
 */
export function BoutonValider({ cardId, media, className }: { cardId: string; media: MediaDuSuivi; className?: string }) {
  const [enVol, setEnVol] = React.useState(false);
  const [plansOuverts, setPlansOuverts] = React.useState(false);
  const plans = usePlansPourLeMedia(cardId, media);
  if (media.etat !== 'fini' || !media.attachmentId) return null;
  const valide = !!media.retenuLe;
  /* DANS UNE VIDÉO DÉCOUPÉE EN PLANS, « VALIDER » DEMANDE LE PLAN (28/10/2026) : le clic ouvre la liste, le choix valide. */
  if (!valide && plans) {
    return (
      <DropdownMenu open={plansOuverts} onOpenChange={setPlansOuverts}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            /* Ouvert au clic, pas à l'appui (`ouvertureAuClic`), et le clic ne remonte pas à la vignette qui l'ouvrirait en grand. */
            onPointerDown={(event) => event.preventDefault()}
            onClick={(event) => {
              event.stopPropagation();
              setPlansOuverts(true);
            }}
            title={t('Valider : choisir son plan')}
            aria-pressed={false}
            data-valider-media={media.id}
            data-valider-par-plan=""
            className={cn('inline-flex h-7 items-center gap-1 rounded-md bg-surface/85 px-2 text-[12px] font-medium text-text transition-colors hover:bg-surface', className)}
          >
            <Check className="h-3.5 w-3.5" />
            {t('Valider')}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" collisionPadding={8} className="min-w-[240px] sm:max-w-[min(340px,calc(100vw-16px))]">
          <ListeDesPlans cardId={cardId} media={media} plans={plans} assurer={async () => media} fermer={() => setPlansOuverts(false)} />
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }
  const basculer = async (event: React.MouseEvent) => {
    event.stopPropagation();
    if (enVol) return;
    setEnVol(true);
    try {
      await client.call({ type: 'production.retenir', cardId, mediaId: media.id, retenu: !valide });
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('La validation n’a pas pu être enregistrée'));
    } finally {
      setEnVol(false);
    }
  };
  return (
    <button
      type="button"
      onClick={(event) => void basculer(event)}
      aria-pressed={valide}
      aria-busy={enVol}
      title={valide ? t('Retirer la validation') : t('Valider : il servira au montage')}
      data-valider-media={media.id}
      data-media-valide={valide ? '' : undefined}
      className={cn(
        'inline-flex h-7 items-center gap-1 rounded-md px-2 text-[12px] font-medium transition-colors',
        valide ? 'bg-teinte-plein text-sur-couleur hover:opacity-90' : 'bg-surface/85 text-text hover:bg-surface',
        className,
      )}
    >
      {enVol ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" strokeWidth={valide ? 3 : 2} />}
      {valide ? t('Validé') : t('Valider')}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Le menu                                                              */
/* ------------------------------------------------------------------ */

export function MenuDuMedia({
  cardId,
  media: donne,
  inscrire,
  className,
}: {
  cardId: string;
  media: MediaDuSuivi;
  /**
   * UN MÉDIA DU FIL ENCORE INCONNU DE LA PRODUCTION (`id` vide) : le premier
   * geste qui a besoin de sa ligne (valider, réglages, retouche) l'inscrit
   * d'abord, puis s'enchaîne sur le média rendu.
   */
  inscrire?: () => Promise<MediaDuSuivi>;
  className?: string;
}) {
  const state = useApp();
  const agentDuFil = React.useContext(ContexteAgentDuFil);
  const carte = state.cards[cardId];
  const [inscrit, setInscrit] = React.useState<MediaDuSuivi | null>(null);
  const media = donne.id ? donne : (inscrit ?? donne);
  const agentId = agentDuFil ?? carte?.agentId ?? media.agentId ?? null;
  const [enCours, setEnCours] = React.useState<string | null>(null);
  const [reglages, setReglages] = React.useState(false);
  const [panneau, setPanneau] = React.useState<OperationDuPanneau | null>(null);
  /* LE SECOND NIVEAU DU MENU : la liste des plans, ouverte par « Valider ». Le menu rouvert repart du premier. */
  const [niveau, setNiveau] = React.useState<'actions' | 'plans'>('actions');
  const plans = usePlansPourLeMedia(cardId, media);
  const pret = media.etat === 'fini' && !!media.attachmentId;
  const piece: Attachment | null = media.attachmentId
    ? (state.attachments[carte?.projectId ?? ''] ?? []).find((p: Attachment) => p.id === media.attachmentId) ??
      ({ id: media.attachmentId, projectId: carte?.projectId ?? '', name: `${media.plan}.${media.genre === 'image' ? 'png' : media.genre === 'video' ? 'mp4' : 'mp3'}`, mime: MIME_DU_GENRE[media.genre], size: media.taille ?? 0, sha: media.attachmentId, createdAt: media.creeLe } as Attachment)
    : null;
  const { etat: telechargement, lancer: telecharger } = useTelechargement(piece ? [{ adresse: adresseDePiece(piece.id, true), nom: piece.name }] : []);
  if (!pret) return null;
  const retenu = !!media.retenuLe;

  /* UNE CRÉATION DE MÉDIA : la validation ne réveille pas l'agent, et chaque option qui fabrique ouvre son panneau. */
  const creation = carteDeMedia(carte);
  /* Le média de la production : celui qu'on a, ou celui que l'inscription rend. */
  const assurer = async (): Promise<MediaDuSuivi> => {
    if (media.id || !inscrire) return media;
    const r = await inscrire();
    setInscrit(r);
    return r;
  };
  const basculerLeSuivi = async (fermer: () => void) => {
    if (enCours) return;
    setEnCours('suivi');
    try {
      const m = await assurer();
      await client.call({ type: 'production.retenir', cardId, mediaId: m.id, retenu: !retenu });
      if (agentId && !creation) annoncerAuSuivi(agentId, retenu ? t('Retiré du suivi : « {media} » ({id}).', { media: legendeDuMedia(m), id: m.id }) : t('Ajouté au suivi : « {media} » ({id}).', { media: legendeDuMedia(m), id: m.id }));
      fermer();
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('Le suivi n’a pas pu être mis à jour'));
    } finally {
      setEnCours(null);
    }
  };
  /* Un geste qui ouvre un panneau : le média est d'abord inscrit s'il ne l'était pas. */
  const apresInscription = async (fermer: () => void, suite: () => void) => {
    if (enCours) return;
    if (media.id || !inscrire) {
      fermer();
      suite();
      return;
    }
    setEnCours('inscription');
    try {
      await assurer();
      fermer();
      suite();
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('Ce média n’a pas pu être inscrit dans la production'));
    } finally {
      setEnCours(null);
    }
  };
  const ouvrirLePanneau = (operation: OperationDuPanneau, fermer: () => void) => void apresInscription(fermer, () => setPanneau(operation));
  /* L'ANIMATION ATTEND LE SECOND TEMPS D'UNE VIDÉO (toutes les images d'abord), et une image validée. */
  const animer =
    media.genre === 'image' && retenu && !!carte && typesDeMediaDeLaRealisation(carte.realisation).includes('video') && animationPermise({ types: typesDeMediaDeLaRealisation(carte.realisation), carte }).ok;
  const operations: OperationDuPanneau[] =
    media.genre === 'image' ? ['visage', 'lumiere', 'angles', 'consigne', ...(animer ? (['animer'] as const) : [])] : media.genre === 'video' ? ['gestes', 'consigne'] : [];
  const ICONES: Record<OperationDuPanneau, React.ReactNode> = {
    visage: <ScanFace className="h-4 w-4" />,
    lumiere: <SunMedium className="h-4 w-4" />,
    angles: <Move3d className="h-4 w-4" />,
    consigne: <MessageSquarePlus className="h-4 w-4" />,
    animer: <Clapperboard className="h-4 w-4" />,
    gestes: <Footprints className="h-4 w-4" />,
  };
  const REPERES: Record<OperationDuPanneau, string> = {
    visage: 'data-media-visage',
    lumiere: 'data-media-lumiere',
    angles: 'data-media-autres-angles',
    consigne: 'data-media-redemander',
    animer: 'data-media-animer',
    gestes: 'data-media-mouvement',
  };

  return (
    <>
      <MenuActions
        titre={t('Options du média')}
        repere={`media-${media.id || media.attachmentId}`}
        className={cn('bg-surface/85', className)}
        taille="icon-sm"
        onOuvert={(ouvert) => {
          if (!ouvert) setNiveau('actions');
        }}
      >
        {(fermer) => niveau === 'plans' && plans && !retenu ? (
          <ListeDesPlans cardId={cardId} media={media} plans={plans} assurer={assurer} fermer={fermer} retour={() => setNiveau('actions')} />
        ) : (
          <div className="flex flex-col gap-0.5" data-menu-media={media.id || undefined} data-menu-media-piece={media.attachmentId ?? undefined} data-menu-media-genre={media.genre}>
            {/* « VALIDER » EN PREMIER (26/10/2026) : le média rejoint le volet et servira au montage. Dans une
                vidéo découpée en plans, il ouvre d'abord la liste des plans (28/10/2026). */}
            <ActionTiroir
              icone={enCours === 'suivi' ? <Loader2 className="h-4 w-4 animate-spin" /> : retenu ? <Undo2 className="h-4 w-4" /> : <Check className="h-4 w-4" />}
              onClick={() => (!retenu && plans ? setNiveau('plans') : void basculerLeSuivi(fermer))}
              disabled={!!enCours}
              {...(retenu ? { 'data-media-retirer': '' } : { 'data-media-retenir': '' })}
              {...(!retenu && plans ? { 'data-media-retenir-par-plan': '' } : {})}
            >
              {creation ? (retenu ? t('Retirer la validation') : t('Valider')) : retenu ? t('Retirer du suivi') : t('Ajouter au suivi')}
            </ActionTiroir>
            {/* LES OPTIONS QUI FABRIQUENT : chacune ouvre son panneau, prix sur le bouton. */}
            {creation
              ? operations.map((operation) => (
                  <ActionTiroir key={operation} icone={ICONES[operation]} onClick={() => ouvrirLePanneau(operation, fermer)} disabled={!!enCours} {...{ [REPERES[operation]]: '' }}>
                    {LIBELLES_OPERATIONS_DU_PANNEAU[operation]()}
                  </ActionTiroir>
                ))
              : null}
            {(!creation || media.genre === 'son') && agentId && piece ? (
              <ActionTiroir
                icone={<MessageSquarePlus className="h-4 w-4" />}
                onClick={() => {
                  joindreAuChamp({ agentId, piece });
                  fermer();
                }}
                data-media-redemander=""
              >
                {t('Redemander avec une consigne')}
              </ActionTiroir>
            ) : null}
            <ActionTiroir
              icone={enCours === 'inscription' ? <Loader2 className="h-4 w-4 animate-spin" /> : <SlidersHorizontal className="h-4 w-4" />}
              onClick={() => void apresInscription(fermer, () => setReglages(true))}
              disabled={!!enCours}
              data-media-reglages=""
            >
              {t('Réglages')}
            </ActionTiroir>
            <ActionTiroir
              icone={telechargement === 'reception' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              onClick={() => {
                telecharger();
                fermer();
              }}
              data-media-telecharger=""
            >
              {t('Télécharger')}
            </ActionTiroir>
          </div>
        )}
      </MenuActions>
      {panneau ? <PanneauDuMedia ouvert={!!panneau} onFermer={() => setPanneau(null)} operation={panneau} cardId={cardId} media={media} /> : null}
      {media.id ? <ReglagesDuMedia ouvert={reglages} onFermer={() => setReglages(false)} media={media} agentId={agentId} /> : null}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Les réglages                                                         */
/* ------------------------------------------------------------------ */

const FORMATS = ['16:9', '9:16', '1:1', '4:5'] as const;

function LigneDeReglage({ cle, children }: { cle: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(110px,34%)_1fr] gap-x-3 gap-y-0.5 py-1 text-[13px]">
      <span className="text-faint">{cle}</span>
      <span className="min-w-0 select-text break-words text-text">{children}</span>
    </div>
  );
}

/**
 * « RÉGLAGES » D'UN MÉDIA : tout ce qui l'a fabriqué, lisible et copiable ; la
 * consigne, le format, la durée, le modèle et le réglage d'une retouche se
 * modifient, et « Relancer avec ces réglages » le dit à l'agent, qui refait
 * un devis — rien ne part sans le clic sur le devis.
 */
function ReglagesDuMedia({ ouvert, onFermer, media, agentId }: { ouvert: boolean; onFermer: () => void; media: MediaDuSuivi; agentId: string | null }) {
  const consigneDeDepart = media.consigneOriginale || media.consigne || '';
  const [consigne, setConsigne] = React.useState(consigneDeDepart);
  const [format, setFormat] = React.useState(media.format ?? '');
  const [duree, setDuree] = React.useState(media.duree ? String(media.duree) : '');
  const [modele, setModele] = React.useState(media.modele ?? '');
  const [angle, setAngle] = React.useState('');
  const [envoi, setEnvoi] = React.useState(false);
  React.useEffect(() => {
    if (!ouvert) return;
    setConsigne(consigneDeDepart);
    setFormat(media.format ?? '');
    setDuree(media.duree ? String(media.duree) : '');
    setModele(media.modele ?? '');
    setAngle('');
  }, [ouvert, media.id]);
  const capacite = media.capacite as CapaciteDeGeneration;
  const modeles = catalogueDeGeneration().filter((m) => m.capacite === capacite);
  const changements: string[] = [];
  if (consigne.trim() && consigne.trim() !== consigneDeDepart.trim()) changements.push(t('consigne : {v}', { v: consigne.trim() }));
  if (format && format !== (media.format ?? '')) changements.push(t('format : {v}', { v: format }));
  if (duree && Number(duree) !== media.duree) changements.push(t('durée : {v} s', { v: duree }));
  if (modele && modele !== media.modele) changements.push(t('modèle : {v}', { v: modeles.find((m) => m.id === modele)?.nom ?? modele }));
  if (angle) changements.push(t('angle : {v}', { v: PARAMETRES_DES_ANGLES[angle as keyof typeof PARAMETRES_DES_ANGLES]?.libelle ?? angle }));
  const prix = media.coutReel ?? media.prixAnnonce ?? media.prix;
  const relancer = async () => {
    if (!agentId || envoi || !changements.length) return;
    setEnvoi(true);
    try {
      await direALAgent(
        agentId,
        t('Relancer « {media} » ({id}) avec ces réglages — {changements}. Refaites le devis (version suivante) et demandez-moi combien de propositions.', {
          media: legendeDuMedia(media),
          id: media.id,
          changements: changements.join(' ; '),
        }),
        media.attachmentId ? [media.attachmentId] : [],
      );
      onFermer();
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('La demande n’a pas pu partir'));
    } finally {
      setEnvoi(false);
    }
  };
  return (
    <Drawer open={ouvert} onClose={onFermer} feuille>
      <div className="flex min-h-0 flex-1 flex-col" data-reglages-media={media.id}>
        <EnteteDeFeuille
          titre={t('Réglages de « {media} »', { media: legendeDuMedia(media) })}
          sousTitre={t('Tout ce qui a fabriqué ce média. Changez ce qui se règle, puis relancez : l’agent refait un devis avant toute dépense.')}
        />
        <ZoneDefilement className="min-h-0 flex-1">
          <div className="flex flex-col px-4 pb-3">
            <LigneDeReglage cle={t('Service et modèle')}>{[media.service, media.modeleNom].filter(Boolean).join(' · ')}</LigneDeReglage>
            <LigneDeReglage cle={t('Informations')}>
              {informationsDuMedia({ genre: media.genre, format: media.format ?? null, mesure: media.mesure ?? null, taille: media.taille ?? null }).map(texteDUneInformation).join(' · ') || '—'}
            </LigneDeReglage>
            {(media.reglages ?? []).map((r) => (
              <LigneDeReglage key={r.cle} cle={t(r.cle)}>
                {r.valeur}
              </LigneDeReglage>
            ))}
            <LigneDeReglage cle={t('Prix')}>{prix === null || prix === undefined ? t('prix non publié') : `${prix} $${media.coutReel !== null && media.coutReel !== undefined ? ` (${t('coût réel')})` : ''}`}</LigneDeReglage>
            <LigneDeReglage cle={t('Version')}>{`v${media.version} · ${heureExacte(media.creeLe)}`}</LigneDeReglage>
            {media.consigneOriginale && media.consigne ? (
              <LigneDeReglage cle={t('Envoyé au service (anglais)')}>
                <span className="whitespace-pre-line" lang="en">
                  {media.consigne}
                </span>
              </LigneDeReglage>
            ) : null}

            <p className="mt-3 text-[12px] uppercase tracking-wide text-faint">{t('Ce qui se règle')}</p>
            <label className="mt-1 flex flex-col gap-1 text-[13px] text-muted">
              {t('Consigne')}
              <Textarea value={consigne} onChange={(e) => setConsigne(e.target.value)} rows={4} data-reglage-consigne="" />
            </label>
            {media.genre !== 'son' ? (
              <div className="mt-2 flex flex-col gap-1 text-[13px] text-muted">
                {t('Format')}
                <ListeDeroulante titre={t('Format')} valeur={format} onChoisir={setFormat} empile className="h-9" data-reglage-format="" options={FORMATS.map((f) => ({ valeur: f, libelle: f }))} />
              </div>
            ) : null}
            {media.genre !== 'image' ? (
              <label className="mt-2 flex flex-col gap-1 text-[13px] text-muted">
                {t('Durée (secondes)')}
                <Input type="number" min={1} value={duree} onChange={(e) => setDuree(e.target.value)} data-reglage-duree="" />
              </label>
            ) : null}
            {modeles.length > 1 ? (
              <div className="mt-2 flex flex-col gap-1 text-[13px] text-muted">
                {t('Modèle')}
                <ListeDeroulante
                  titre={t('Modèle')}
                  valeur={modele}
                  onChoisir={setModele}
                  empile
                  className="h-9"
                  data-reglage-modele=""
                  options={modeles.filter((m, i) => modeles.findIndex((x) => x.id === m.id) === i).map((m) => ({ valeur: m.id, libelle: m.nom }))}
                />
              </div>
            ) : null}
            {capacite === 'angles' || (media.genre === 'image' && estUneRetoucheDImage(capacite)) ? (
              capacite === 'angles' ? (
                <div className="mt-2 flex flex-col gap-1 text-[13px] text-muted">
                  {t('Angle')}
                  <ListeDeroulante
                    titre={t('Angle')}
                    valeur={angle}
                    onChoisir={setAngle}
                    empile
                    className="h-9"
                    data-reglage-angle=""
                    options={[{ valeur: '', libelle: t('Inchangé') }, ...ANGLES_DE_VUE.map((a) => ({ valeur: a, libelle: t(PARAMETRES_DES_ANGLES[a].libelle) }))]}
                  />
                </div>
              ) : null
            ) : null}
          </div>
        </ZoneDefilement>
        <div className="flex shrink-0 items-center justify-end gap-2 px-4 pb-3 pt-2">
          <Button variant="ghost" size="sm" onClick={onFermer}>
            {t('Fermer')}
          </Button>
          <Button size="sm" className="gap-1.5" disabled={!agentId || !changements.length || envoi} onClick={() => void relancer()} data-relancer-media="">
            {envoi ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCw className="h-3.5 w-3.5" />}
            {t('Relancer avec ces réglages')}
          </Button>
        </div>
      </div>
    </Drawer>
  );
}

/* ------------------------------------------------------------------ */
/* Posé sur un média du fil                                             */
/* ------------------------------------------------------------------ */

/**
 * LE MENU ET LA LIGNE D'INFORMATIONS D'UNE PIÈCE DU FIL : le bloc d'un média
 * fabriqué et les médias livrés sous une réponse ne connaissent que la pièce
 * jointe ; on retrouve le média de la production qu'elle porte. Hors d'une
 * production (Studio, agent sans carte), rien ne s'affiche.
 */
export function MenuDeLaPiece({ cardId, attachmentId, className }: { cardId: string | null | undefined; attachmentId: string | null | undefined; className?: string }) {
  const media = useMediaDeProduction(cardId, { attachmentId });
  const cartes = useApp().cards;
  if (!cardId || !media) return null;
  const creation = carteDeMedia(cartes[cardId]);
  return (
    <div className={cn('absolute right-1 top-1 z-[1] flex items-center gap-1', className)}>
      {creation ? <BoutonValider cardId={cardId} media={media} /> : media.retenuLe ? <MarqueDansLeSuivi /> : null}
      <MenuDuMedia cardId={cardId} media={media} />
    </div>
  );
}

/** La carte dont le fil est affiché : les pièces des messages y trouvent leur menu « … ». */
export const ContexteCarteDuFil = React.createContext<string | null>(null);

/**
 * LE MENU « … » DE TOUT MÉDIA DU FIL D'UNE CARTE (27/10/2026, capture #ee9e :
 * « les médias doivent être modifiables en tout temps »). Une image rendue
 * par un autre outil, une pièce envoyée par l'utilisateur ou une capture
 * regardée par l'agent n'avaient pas de ligne dans la production : plus de
 * menu du tout. Il se pose désormais sur chaque image, vidéo et son, adapté à
 * son genre (`MenuDuMedia`) ; une pièce que la production ne connaît pas encore
 * y est inscrite au premier geste (`production.inscrire`, idempotent).
 * Un PDF ou un autre fichier n'a pas de menu : il se télécharge déjà d'un clic.
 */
export function MenuDuMediaDuFil({
  cardId,
  attachmentId,
  genre,
  nom,
  className,
}: {
  cardId: string | null | undefined;
  attachmentId: string;
  /** Le genre connu (média livré), sinon déduit de la pièce. */
  genre?: MediaDuSuivi['genre'] | null;
  nom?: string;
  className?: string;
}) {
  const state = useApp();
  const media = useMediaDeProduction(cardId, { attachmentId });
  const carte = cardId ? state.cards[cardId] : undefined;
  const piece = carte ? (state.attachments[carte.projectId] ?? []).find((p: Attachment) => p.id === attachmentId) : undefined;
  const genreDuFil = genre ?? genreDePieceDuFil(piece?.mime);
  const virtuel = React.useMemo<MediaDuSuivi | null>(
    () =>
      genreDuFil
        ? {
            id: '',
            plan: planDePieceDuFil(nom || piece?.name),
            version: 1,
            capacite: genreDuFil,
            genre: genreDuFil,
            service: 'fil',
            etape: null,
            etat: 'fini',
            attachmentId,
            prix: 0,
            creeLe: piece?.createdAt ?? 0,
            taille: piece?.size ?? null,
          }
        : null,
    [genreDuFil, attachmentId, nom, piece?.name, piece?.createdAt, piece?.size],
  );
  const inscrire = React.useCallback(async () => {
    const r = await client.call<{ media: MediaDuSuivi }>({ type: 'production.inscrire', cardId: cardId!, attachmentId });
    return r.media;
  }, [cardId, attachmentId]);
  /* L'AGENT À QUI PARLENT « Redemander » et « Relancer » : celui du fil, sinon le dernier agent de la carte (une carte au cadrage n'a pas encore d'agent attitré). */
  const agentDuFil = React.useContext(ContexteAgentDuFil);
  const agentDeLaCarte =
    agentDuFil ??
    carte?.agentId ??
    (Object.values(state.agents) as { id: string; cardId?: string | null; createdAt: number }[])
      .filter((a) => a.cardId === cardId)
      .sort((a, b) => b.createdAt - a.createdAt)[0]?.id ??
    null;
  if (!cardId || !carte) return null;
  const montre = media ?? virtuel;
  if (!montre) return null;
  return (
    <div className={cn('absolute right-0.5 top-0.5 z-[1] flex items-center gap-1', className)} data-menu-du-media-du-fil={attachmentId} data-menu-du-media-inscrit={media ? '' : undefined}>
      {media?.retenuLe ? <MarqueDansLeSuivi /> : null}
      <ContexteAgentDuFil.Provider value={agentDeLaCarte}>
        <MenuDuMedia cardId={cardId} media={montre} inscrire={media ? undefined : inscrire} />
      </ContexteAgentDuFil.Provider>
    </div>
  );
}

export function InformationsDeLaPiece({ cardId, attachmentId, className }: { cardId: string | null | undefined; attachmentId: string | null | undefined; className?: string }) {
  const media = useMediaDeProduction(cardId, { attachmentId });
  return media ? <InformationsDuMedia media={media} className={className} /> : null;
}
