/**
 * LE MONTAGE D'UNE CARTE (chantier « Beluga Creative Studio », carte 3 du
 * 24/10/2026) : les plans qu'une carte a fabriqués (vidéos, images, sons livrés
 * dans son fil) se montent dans une création du Studio LIÉE À LA CARTE, ouverte
 * dans le grand volet de montage à côté de sa conversation.
 *
 * Règles pures : quels plans verser, et comment chacun se pose. Le montage
 * reste une composition modifiée SEULEMENT par opérations (`appliquerOperation`,
 * `poserLExtrait`) — une version par plan versé, annulable comme tout geste.
 */
import type { GenreSegment, Piste, Retouche } from './studio.js';
import { appliquerOperation, compositionVide, pisteAccepte, pisteVisuelle, positionDeNouvellePiste, type Composition, type FormatStudio, type GenrePiste, type OperationStudio, type ResultatOperation } from './studio.js';
import type { MediaLivre } from './medias-livres.js';

/** Les trois formats d'export du montage : vertical, carré, horizontal. */
export const FORMATS_DU_MONTAGE: readonly FormatStudio[] = ['9:16', '1:1', '16:9'];

/**
 * LA MARQUE D'UN PLAN VERSÉ, portée par le média de la bibliothèque qu'il a
 * donné (colonne `categorie`, jamais affichée) : un plan déjà versé ne se
 * reverse pas, même après un redémarrage.
 */
export function marqueDePlanVerse(attachmentId: string): string {
  return `plan:${attachmentId}`;
}

/** Le titre de la création de montage d'une carte. */
export function titreDuMontage(titreDeLaCarte: string): string {
  return `Montage — ${String(titreDeLaCarte ?? '').trim() || 'carte'}`.slice(0, 120);
}

/**
 * LA COMPOSITION DE DÉPART : vide, et SANS durée voulue — un montage de plans
 * dure ce que durent ses plans (l'export coupe au marqueur bleu, qui serait
 * sinon posé à 15 s).
 */
export function compositionDuMontage(format: FormatStudio = '9:16'): Composition {
  const c = compositionVide(format);
  delete c.dureeVoulue;
  return c;
}

/**
 * LES PLANS À VERSER : la DERNIÈRE version de chaque plan (groupe) — les
 * versions précédentes restent dans le fil, l'utilisateur les a remplacées —,
 * dans l'ordre de première livraison, sans ceux déjà versés.
 */
export function plansAVerser<T extends Pick<MediaLivre, 'attachmentId' | 'groupe' | 'version' | 'livreLe' | 'genre'>>(
  medias: readonly T[],
  dejaVerses: ReadonlySet<string>,
): T[] {
  const derniere = new Map<string, T>();
  const premiere = new Map<string, number>();
  for (const m of medias) {
    premiere.set(m.groupe, Math.min(premiere.get(m.groupe) ?? Infinity, m.livreLe));
    const avant = derniere.get(m.groupe);
    if (!avant || m.version > avant.version || (m.version === avant.version && m.livreLe > avant.livreLe)) derniere.set(m.groupe, m);
  }
  return [...derniere.values()]
    .filter((m) => !dejaVerses.has(m.attachmentId))
    .sort((a, b) => premiere.get(a.groupe)! - premiere.get(b.groupe)! || a.groupe.localeCompare(b.groupe));
}

/** La fin des visuels : un plan se pose à la suite du précédent. */
export function finDesVisuels(c: Composition): number {
  return c.pistes.filter((p) => pisteVisuelle(p.genre)).reduce((fin, p) => p.segments.reduce((f, s) => Math.max(f, s.debut + s.duree), fin), 0);
}

export type PlanAPoser =
  /* `transparent` : son fond est retiré, il se pose entier dans le cadre (un sujet détouré ne se rogne pas). */
  | { genre: 'video'; videoMediaId: string; audioMediaId?: string; duree: number; nom: string; transparent?: boolean }
  | { genre: 'image'; mediaId: string; duree?: number; nom: string; transparent?: boolean }
  | { genre: 'son'; mediaId: string; duree: number; nom: string };

/**
 * POSER UN PLAN : une vidéo se SÉPARE (image muette sur une piste de visuels,
 * son sur sa piste, au même instant — `poserLExtrait`) et se pose À LA SUITE des
 * visuels ; une image dure 4 s à la suite ; un son part de 0 sur une piste de
 * son libre (jamais la voix), une piste neuve s'il n'y en a pas.
 */
export function poserUnPlanDeLaCarte(composition: Composition, plan: PlanAPoser, idNeuf: (prefixe: string) => string): ResultatOperation {
  const nom = String(plan.nom ?? '').slice(0, 80) || 'Plan';
  const debut = Math.round(finDesVisuels(composition) * 100) / 100;
  if (plan.genre === 'video') {
    return poserLExtrait(composition, { videoMediaId: plan.videoMediaId, ...(plan.audioMediaId ? { audioMediaId: plan.audioMediaId } : {}), debut, duree: Math.max(0.5, plan.duree), nom }, idNeuf);
  }
  if (plan.genre === 'image') {
    let c = composition;
    let piste = c.pistes.find((p) => p.genre === 'image');
    if (!piste) {
      const ajout = appliquerOperation(c, { op: 'piste-ajouter', genre: 'image' }, idNeuf);
      if (!ajout.ok) return ajout;
      c = ajout.composition;
      piste = c.pistes.find((p) => p.genre === 'image')!;
    }
    const r = appliquerOperation(c, { op: 'inserer', pisteId: piste.id, segment: { genre: 'image', debut, duree: plan.duree && plan.duree > 0 ? plan.duree : 4, mediaId: plan.mediaId, ajustement: 'couvrir', nom } }, idNeuf);
    return r.ok ? { ...r, resume: `plan « ${nom} » posé (image)` } : r;
  }
  const duree = Math.max(0.5, plan.duree);
  let c = composition;
  let pisteId = c.pistes.find((p) => p.genre === 'son' && p.segments.every((s) => s.debut >= duree - 1e-3))?.id;
  if (!pisteId) {
    const avant = new Set(c.pistes.map((p) => p.id));
    const ajout = appliquerOperation(c, { op: 'piste-ajouter', genre: 'son' }, idNeuf);
    if (!ajout.ok) return ajout;
    c = ajout.composition;
    pisteId = c.pistes.find((p) => !avant.has(p.id))!.id;
  }
  const r = appliquerOperation(c, { op: 'inserer', pisteId, segment: { genre: 'audio', debut: 0, duree, mediaId: plan.mediaId, debutMedia: 0, volume: 1, nom } }, idNeuf);
  return r.ok ? { ...r, resume: `son « ${nom} » posé` } : r;
}

/**
 * LES PLANS DU MONTAGE, NUMÉROTÉS COMME L'UTILISATEUR LES VOIT : les visuels
 * dans l'ordre du temps (« le plan 2 » est le deuxième), chacun avec le son
 * séparé posé au même instant pour la même durée — c'est lui qu'on coupe ou
 * décale avec l'image.
 */
export function plansDuMontage(c: Composition): { numero: number; segmentId: string; nom: string; debut: number; fin: number; sonId?: string }[] {
  const visuels = c.pistes
    .filter((p) => pisteVisuelle(p.genre))
    .flatMap((p) => p.segments.filter((s) => s.genre === 'video' || s.genre === 'image'))
    .sort((a, b) => a.debut - b.debut);
  const sons = c.pistes.filter((p) => p.genre === 'son').flatMap((p) => p.segments.filter((s) => s.genre === 'audio'));
  return visuels.map((v, i) => {
    const son = v.genre === 'video' ? sons.find((s) => Math.abs(s.debut - v.debut) < 0.01 && Math.abs(s.duree - v.duree) < 0.01) : undefined;
    return {
      numero: i + 1,
      segmentId: v.id,
      nom: String((v as { nom?: string }).nom ?? ''),
      debut: Math.round(v.debut * 100) / 100,
      fin: Math.round((v.debut + v.duree) * 100) / 100,
      ...(son ? { sonId: son.id } : {}),
    };
  });
}

/** Ce que l'outil « studio » dit en tête de « lire » quand la création est le montage d'une carte. */
export function consigneDuMontageDeCarte(c: Composition): string {
  const plans = plansDuMontage(c);
  return [
    'MONTAGE DE TA CARTE (grand volet de montage, ouvert à côté de cette conversation) : l’utilisateur demande ses retouches en mots ici. Chaque retouche passe par « operation » — UNE version par geste, qu’il défait d’un clic sur « Annuler » ; ne recompose jamais tout (« composer » est refusé à un montage qui a déjà ses plans). Une coupe ou un décalage d’un plan vidéo touche AUSSI son son séparé : un seul « lot » (rogner/retirer-passage/deplacer sur l’image ET le son), sauf si l’utilisateur veut décaler le son seul.',
    plans.length
      ? `PLANS (numérotés dans l’ordre du temps) : ${plans.map((p) => `${p.numero}. ${p.segmentId}${p.nom ? ` « ${p.nom} »` : ''} ${p.debut}–${p.fin} s${p.sonId ? ` + son ${p.sonId}` : ''}`).join(' ; ')}`
      : 'PLANS : aucun pour l’instant.',
  ].join('\n');
}

/* ------------------------------------------------------------------ */
/* La pose d'un extrait : l'image et son son, calés sur deux pistes     */
/* ------------------------------------------------------------------ */

export interface PoseDExtrait {
  videoMediaId: string;
  /** Le son séparé de l'extrait ; absent quand l'extrait n'a pas de son (aucune piste vide). */
  audioMediaId?: string;
  debut: number;
  duree: number;
  nom: string;
  /** La piste Vidéo voulue, si elle est libre à cet instant. */
  pisteVisuelleId?: string;
  /** La place et la taille dans l'image (une vidéo détourée), en pixels de composition. */
  cadre?: CadreAnnonce;
  /** Détourée : elle se pose entière dans le cadre. */
  contenir?: boolean;
}

function pisteLibre(piste: Piste, debut: number, fin: number): boolean {
  return piste.segments.every((s) => s.debut + s.duree <= debut + 1e-3 || s.debut >= fin - 1e-3);
}

/**
 * POSER UN EXTRAIT SÉPARÉ (demande du 14/10/2026) : l'image MUETTE sur une
 * piste de visuels, son SON sur une piste de son, au MÊME instant et pour la
 * même durée. Chaque morceau va sur une piste libre à cet endroit ; s'il n'y en
 * a pas, une piste de son type est ajoutée — jamais un extrait posé par-dessus
 * un autre. Pure : `idNeuf` donne les identifiants.
 */
export function poserLExtrait(composition: Composition, e: PoseDExtrait, idNeuf: (prefixe: string) => string): ResultatOperation {
  let c = composition;
  const fin = e.debut + e.duree;
  const resumes: string[] = [];
  const appliquer = (op: OperationStudio): string | null => {
    const r = appliquerOperation(c, op, idNeuf);
    if (!r.ok) return r.raison;
    c = r.composition;
    resumes.push(r.resume);
    return null;
  };
  const trouverOuAjouter = (genre: 'video' | 'son', voulue: string | undefined): string | { erreur: string } => {
    const candidates = c.pistes.filter((p) => p.genre === genre);
    const choisie = (voulue ? candidates.find((p) => p.id === voulue && pisteLibre(p, e.debut, fin)) : undefined) ?? candidates.find((p) => pisteLibre(p, e.debut, fin));
    if (choisie) return choisie.id;
    const avant = new Set(c.pistes.map((p) => p.id));
    const derniere = c.pistes.reduce((i, p, k) => (p.genre === genre ? k : i), -1);
    const erreur = appliquer({ op: 'piste-ajouter', genre, position: derniere >= 0 ? derniere + 1 : positionDeNouvellePiste(c.pistes, genre) });
    if (erreur) return { erreur };
    return c.pistes.find((p) => !avant.has(p.id))!.id;
  };
  const visuelle = trouverOuAjouter('video', e.pisteVisuelleId);
  if (typeof visuelle !== 'string') return { ok: false, raison: visuelle.erreur };
  const nom = e.nom.slice(0, 80);
  const erreurImage = appliquer({
    op: 'inserer',
    pisteId: visuelle,
    // L'IMAGE EST MUETTE : son son vit sur sa propre piste, réglable à part.
    segment: {
      genre: 'video',
      debut: e.debut,
      duree: e.duree,
      mediaId: e.videoMediaId,
      ajustement: e.cadre || e.contenir ? 'contenir' : 'couvrir',
      debutMedia: 0,
      volume: 0,
      nom,
      ...(e.cadre ? { retouches: { video: retoucheDuCadre(e.cadre) } } : {}),
    },
  });
  if (erreurImage) return { ok: false, raison: erreurImage };
  if (e.audioMediaId) {
    const sonore = trouverOuAjouter('son', undefined);
    if (typeof sonore !== 'string') return { ok: false, raison: sonore.erreur };
    const erreurSon = appliquer({ op: 'inserer', pisteId: sonore, segment: { genre: 'audio', debut: e.debut, duree: e.duree, mediaId: e.audioMediaId, debutMedia: 0, volume: 1, nom: `Son — ${nom}`.slice(0, 80) } });
    if (erreurSon) return { ok: false, raison: erreurSon };
  }
  return { ok: true, composition: c, resume: e.audioMediaId ? `extrait « ${nom} » posé (image et son)` : `extrait « ${nom} » posé (sans son)` };
}

/* ------------------------------------------------------------------ */
/* La pose d'un média VALIDÉ, dès la validation (31/10/2026)            */
/* ------------------------------------------------------------------ */

/** La marque du SON séparé d'une vidéo versée : le retrait de la validation le retrouve avec son image. */
export function marqueDuSonDePlanVerse(attachmentId: string): string {
  return `sonplan:${attachmentId}`;
}

/** Le préfixe de la catégorie d'une copie d'aperçu : jamais montrée en bibliothèque, jamais embarquée à l'export. */
export const PREFIXE_COPIE_ALPHA = 'copie-alpha:';

/** La copie d'aperçu d'une vidéo transparente, pour les navigateurs qui ne lisent pas son alpha (Safari, iPhone). */
export function marqueDeCopieAlpha(mediaId: string): string {
  return `${PREFIXE_COPIE_ALPHA}${mediaId}`;
}

export type ModeDePose = 'remplacer' | 'ajouter';

/** LA PLACE DANS L'IMAGE annoncée par l'agent : décalage du coin haut gauche et taille, en pixels de composition. */
export interface CadreAnnonce {
  x?: number;
  y?: number;
  largeur?: number;
  hauteur?: number;
}

/**
 * LA PLACE ANNONCÉE DÈS LA PROPOSITION (décision de l'utilisateur du 02/11/2026) :
 * la piste, l'instant, la durée et la taille où ira le média quand une version
 * sera choisie. Portée par le média, sans effet tant qu'aucune version n'est choisie.
 */
export interface PlaceAnnoncee {
  pisteId?: string;
  debut?: number;
  duree?: number;
  cadre?: CadreAnnonce;
}

/** Ce que l'agent annonce dans sa proposition, gardé avec la demande du média. */
export interface AnnonceDuMontage {
  place?: PlaceAnnoncee;
  /** Le fond uni à retirer de la version choisie : « auto » (lu aux coins) ou une couleur. */
  fond?: string;
  /** L'agent a écrit `fond: "aucun"` : un décor plein cadre voulu, que le retrait d'office ne touche pas. */
  garderLeFond?: boolean;
  /** Une image qui prépare la suite : la question propose Utiliser, Poser ou Aucune. */
  role?: 'preparation';
}

/**
 * LA COPIE D'APERÇU D'UNE VIDÉO TRANSPARENTE : un MP4 H.264 ordinaire, que tout
 * iPhone décode au matériel. L'image y est deux fois, côte à côte : la couleur à
 * gauche, le masque en niveaux de gris à droite. `largeur` et `hauteur` sont celles
 * d'UNE moitié ; l'aperçu les recompose image par image (`MOTEUR_APERCU_STUDIO`).
 */
export interface CopieAlphaDApercu {
  url: string;
  largeur: number;
  hauteur: number;
}

/** 1 080 px au plus sur le grand côté : l'aperçu d'un téléphone n'en montre pas plus, et le double se décode encore partout. */
const COTE_MAX_COPIE_ALPHA = 1080;
const IMAGES_PAR_SECONDE_COPIE_ALPHA = 30;

/** La taille d'une moitié de la copie : jamais agrandie, proportions gardées, côtés pairs (exigés par H.264). */
export function tailleDeCopieAlpha(largeur: number, hauteur: number): { largeur: number; hauteur: number } {
  const l = largeur > 0 ? largeur : 720;
  const h = hauteur > 0 ? hauteur : 1280;
  const k = Math.min(1, COTE_MAX_COPIE_ALPHA / Math.max(l, h));
  const pair = (n: number) => Math.max(2, Math.round((n * k) / 2) * 2);
  return { largeur: pair(l), hauteur: pair(h) };
}

/** La chaîne ffmpeg : même image, couleur à gauche et masque à droite, 30 images par seconde au plus. */
export function filtreDeCopieAlpha(largeur: number, hauteur: number, imagesParSeconde?: number): string {
  const { largeur: l, hauteur: h } = tailleDeCopieAlpha(largeur, hauteur);
  const fps = imagesParSeconde && imagesParSeconde > 0 ? Math.min(imagesParSeconde, IMAGES_PAR_SECONDE_COPIE_ALPHA) : IMAGES_PAR_SECONDE_COPIE_ALPHA;
  return `[0:v]fps=${Math.round(fps * 1000) / 1000},scale=${l}:${h}:flags=bicubic,format=yuva420p,split[c][m];[c]format=yuv420p[couleur];[m]alphaextract,format=yuv420p[masque];[couleur][masque]hstack=inputs=2,format=yuv420p[v]`;
}

function nombrePositif(v: unknown): number | undefined {
  const n = Number(v);
  return v !== undefined && v !== null && v !== '' && Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : undefined;
}

export function lirePlaceAnnoncee(brut: unknown): PlaceAnnoncee | null {
  if (!brut || typeof brut !== 'object') return null;
  const b = brut as Record<string, unknown>;
  const place: PlaceAnnoncee = {};
  if (typeof b.pisteId === 'string' && b.pisteId.trim()) place.pisteId = b.pisteId.trim().slice(0, 64);
  const debut = nombrePositif(b.debut);
  if (debut !== undefined) place.debut = debut;
  const duree = nombrePositif(b.duree);
  if (duree) place.duree = Math.max(0.5, duree);
  const c = b.cadre && typeof b.cadre === 'object' ? (b.cadre as Record<string, unknown>) : null;
  if (c) {
    const cadre: CadreAnnonce = {};
    for (const cle of ['x', 'y'] as const) {
      const v = Number(c[cle]);
      if (c[cle] !== undefined && Number.isFinite(v)) cadre[cle] = Math.round(v);
    }
    for (const cle of ['largeur', 'hauteur'] as const) {
      const v = Number(c[cle]);
      if (Number.isFinite(v) && v > 0) cadre[cle] = Math.round(v);
    }
    if (Object.keys(cadre).length) place.cadre = cadre;
  }
  return Object.keys(place).length ? place : null;
}

/** Le fond à retirer annoncé : une couleur « #rrggbb », ou « auto » (lue aux coins de l'image). Tout autre mot désigne un fond uni à lire. */
export function lireFondARetirer(brut: unknown): string | null {
  if (brut === undefined || brut === null || brut === false || brut === '') return null;
  const t = String(brut).trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(t)) return t;
  return t === 'aucun' || t === 'non' ? null : 'auto';
}

/** L'annonce `fond: "aucun"` : le fond est un décor voulu, le retrait d'office passe son chemin. */
export function fondGardeParLAnnonce(brut: unknown): boolean {
  return typeof brut === 'string' && /^(aucun|non)$/i.test(brut.trim());
}

/** La place dite en mots courants, dans le message d'un devis. */
export function phraseDeLaPlace(place: PlaceAnnoncee | null | undefined, fond: string | null | undefined): string {
  const morceaux: string[] = [];
  if (place?.debut !== undefined) morceaux.push(`à ${place.debut.toFixed(1)} s`);
  if (place?.duree) morceaux.push(`pendant ${place.duree.toFixed(1)} s`);
  if (place?.cadre?.largeur || place?.cadre?.hauteur) morceaux.push(`en ${[place.cadre.largeur, place.cadre.hauteur].filter(Boolean).join(' × ')} px`);
  if (fond) morceaux.push('fond retiré');
  return morceaux.join(', ');
}

function retoucheDuCadre(cadre: CadreAnnonce): Retouche {
  return { ...cadre, cadrage: 'contenir' } as Retouche;
}

/** La piste de son qu'un média sonore rejoint, d'après sa CAPACITÉ (jamais son seul genre). */
function typeDePisteDeLaCapacite(capacite: string | null | undefined): 'voix' | 'son' {
  return /voix/.test(String(capacite ?? '')) ? 'voix' : 'son';
}

export interface MediaValideAPoser {
  pose: PlanAPoser;
  /** « musique », « voix », « son »… : décide la piste d'un son. */
  capacite: string;
  /** Les médias du Studio des AUTRES versions du même plan : leurs segments marquent la place du plan. */
  autresDuPlan: readonly string[];
  /** La place annoncée par l'agent dans sa proposition. */
  place?: PlaceAnnoncee | null;
  /** La tête de lecture de l'écran, quand on la connaît. */
  tete?: number | null;
  /** La voix d'un son parlé (identifiant de la voix de synthèse) : une piste par voix. */
  voix?: string | null;
}

/** Le nom de la piste d'une voix : c'est par lui qu'une voix retrouve sa piste. */
export function nomDePisteDeVoix(voix: string): string {
  return `Voix · ${voix}`.slice(0, 60);
}

export type IssueDeLaPose =
  | { ok: true; composition: Composition; resume: string; deja?: boolean; retires: string[]; pisteId?: string; debut?: number }
  | { ok: false; occupe: { pisteId: string; nom: string } }
  | { ok: false; raison: string; occupe?: undefined };

function segmentsDe(c: Composition): { piste: Piste; segment: Piste['segments'][number] }[] {
  return c.pistes.flatMap((piste) => piste.segments.map((segment) => ({ piste, segment })));
}

function mediaDuSegment(s: unknown): string | undefined {
  const id = (s as { mediaId?: unknown }).mediaId;
  return typeof id === 'string' ? id : undefined;
}

function nomDuSegment(s: unknown): string {
  return String((s as { nom?: unknown }).nom ?? '').trim();
}

function arrondi2(n: number): number {
  return Math.round(n * 100) / 100;
}

function recouvrent(piste: Piste, debut: number, fin: number): Piste['segments'] {
  return piste.segments.filter((s) => s.debut < fin - 1e-3 && s.debut + s.duree > debut + 1e-3);
}

/**
 * OÙ COMMENCE UNE VERSION CHOISIE : la place annoncée, sinon la tête de lecture,
 * sinon le début du film. JAMAIS APRÈS LA FIN (cause du 02/11/2026 : la mascotte
 * posée à 22,81 s dans un film de 22,8 s, donc invisible). `null` : un montage de
 * plans sans durée voulue, qui grandit à la suite de ce qu'il contient.
 */
function instantDeLaPose(c: Composition, m: MediaValideAPoser): number | null {
  const voulu = m.place?.debut ?? (typeof m.tete === 'number' && Number.isFinite(m.tete) ? m.tete : null);
  if (!c.dureeVoulue) return voulu === null ? null : Math.max(0, voulu);
  const film = c.dureeVoulue;
  const debut = Math.max(0, voulu ?? 0);
  return debut >= film - 0.01 ? 0 : arrondi2(debut);
}

/**
 * POSER UN MÉDIA VALIDÉ SUR SA PISTE (décisions de l'utilisateur du 31/10 et du
 * 02/11/2026). Dans l'ordre : la place d'une autre version du même plan ; la
 * place annoncée ; la tête de lecture. Une MUSIQUE sans place annoncée part du
 * début, sous tout le film (bornée à sa durée, volume 0,6, fondus 0,5 s / 1 s).
 *
 * CHAQUE ÉLÉMENT SUR SA PISTE (décision du 03/11/2026, pour les fondus et les
 * chevauchements) : une musique, un bruitage, une vidéo ou une image va sur une
 * piste À LUI — une piste de son type encore vide, sinon une piste neuve —, sauf
 * place annoncée (`place.pisteId`) ou autre version du même plan. UNE PISTE PAR
 * VOIX (`voix`) : nommée « Voix · <voix> », ses phrases s'y suivent ; une autre
 * voix ouvre la sienne. Rien de ce qui est déjà monté n'est réorganisé.
 * Une place déjà prise n'est JAMAIS écrasée d'office : la règle rend `occupe`,
 * et l'on rappelle avec `remplacer` (l'ancien quitte la piste, `retires`) ou
 * `ajouter` (une piste du même type en plus). Un média déjà sur la ligne de temps
 * ne se repose pas.
 */
export function poserUnMediaValide(composition: Composition, m: MediaValideAPoser, mode: ModeDePose | undefined, idNeuf: (prefixe: string) => string): IssueDeLaPose {
  const principal = m.pose.genre === 'video' ? m.pose.videoMediaId : m.pose.mediaId;
  if (segmentsDe(composition).some((x) => mediaDuSegment(x.segment) === principal)) {
    return { ok: true, composition, resume: `« ${m.pose.nom} » est déjà sur la ligne de temps`, deja: true, retires: [] };
  }
  const nom = String(m.pose.nom ?? '').slice(0, 80) || 'Média';
  let c = composition;
  const appliquer = (op: OperationStudio): string | null => {
    const r = appliquerOperation(c, op, idNeuf);
    if (!r.ok) return r.raison;
    c = r.composition;
    return null;
  };
  const ajouterUnePiste = (genre: GenrePiste, position?: number): string | { erreur: string } => {
    const avant = new Set(c.pistes.map((p) => p.id));
    const erreur = appliquer({ op: 'piste-ajouter', genre, ...(position !== undefined ? { position } : {}) });
    if (erreur) return { erreur };
    return c.pistes.find((p) => !avant.has(p.id))!.id;
  };
  /** La piste annoncée par l'agent, si elle est du bon type. */
  const pisteAnnoncee = (genre: GenrePiste): Piste | null => (m.place?.pisteId ? c.pistes.find((p) => p.id === m.place!.pisteId && p.genre === genre && !p.masquee) ?? null : null);
  /** UNE PISTE À LUI : une piste de ce type encore vide (et sans nom choisi), sinon une piste neuve — juste sous les sons, devant les visuels. */
  const pisteALui = (genre: GenrePiste): Piste | { erreur: string } => {
    const vide = c.pistes.find((p) => p.genre === genre && !p.masquee && !p.segments.length && !p.nomChoisi);
    if (vide) return vide;
    const derniere = c.pistes.reduce((i, p, k) => (p.genre === genre ? k : i), -1);
    const id = ajouterUnePiste(genre, genre === 'son' || genre === 'voix' ? (derniere >= 0 ? derniere + 1 : undefined) : undefined);
    return typeof id === 'string' ? c.pistes.find((p) => p.id === id)! : id;
  };
  /** LA PISTE D'UNE VOIX : celle qui porte son nom, sinon une piste de voix vide qu'on lui nomme, sinon une neuve. */
  const pisteDeLaVoix = (): Piste | { erreur: string } => {
    const voix = m.voix ? String(m.voix).trim() : '';
    const pistes = c.pistes.filter((p) => p.genre === 'voix' && !p.masquee);
    if (!voix) return pistes.find((p) => !p.nomChoisi?.startsWith('Voix · ')) ?? pistes[0] ?? pisteALui('voix');
    const nom = nomDePisteDeVoix(voix);
    const sienne = pistes.find((p) => p.nomChoisi === nom);
    if (sienne) return sienne;
    const piste = pisteALui('voix');
    if ('erreur' in piste) return piste;
    const erreur = appliquer({ op: 'piste-proprietes', pisteId: piste.id, nom });
    return erreur ? { erreur } : c.pistes.find((p) => p.id === piste.id)!;
  };
  /** Vider la place selon le mode ; rend la piste où insérer. */
  const libererLaPlace = (piste: Piste, genants: Piste['segments'], devant: boolean): { pisteId: string; retires: string[] } | { occupe: { pisteId: string; nom: string } } | { raison: string } => {
    if (!genants.length) return { pisteId: piste.id, retires: [] };
    if (!mode) return { occupe: { pisteId: piste.id, nom: nomDuSegment(genants[0]) || piste.nom } };
    if (mode === 'ajouter') {
      const index = c.pistes.findIndex((p) => p.id === piste.id);
      const id = ajouterUnePiste(piste.genre, devant ? index : index + 1);
      return typeof id === 'string' ? { pisteId: id, retires: [] } : { raison: id.erreur };
    }
    const retires: string[] = [];
    const jumeaux = c.pistes.filter((p) => p.genre === 'son').flatMap((p) => p.segments.filter((s) => s.genre === 'audio' && genants.some((g) => g.genre === 'video' && Math.abs(s.debut - g.debut) < 0.01 && Math.abs(s.duree - g.duree) < 0.01)));
    for (const s of [...genants, ...jumeaux]) {
      const erreur = appliquer({ op: 'supprimer', segmentId: s.id });
      if (erreur) return { raison: erreur };
      const id = mediaDuSegment(s);
      if (id) retires.push(id);
    }
    return { pisteId: piste.id, retires };
  };

  /* LA PLACE DU PLAN : une autre version du même plan, déjà posée. */
  const autres = new Set(m.autresDuPlan);
  const placeDuPlan = segmentsDe(c)
    .filter((x) => autres.has(mediaDuSegment(x.segment) ?? ''))
    .sort((a, b) => a.segment.debut - b.segment.debut)[0];

  if (m.pose.genre === 'son') {
    const type = typeDePisteDeLaCapacite(m.capacite);
    const musique = /musique/.test(String(m.capacite ?? ''));
    /* LA PISTE D'ABORD : une voix retrouve la sienne, tout autre son a la sienne. */
    let piste: Piste | null = placeDuPlan?.piste.genre === type ? placeDuPlan.piste : pisteAnnoncee(type);
    if (!piste) {
      const choisie = type === 'voix' ? pisteDeLaVoix() : pisteALui(type);
      if ('erreur' in choisie) return { ok: false, raison: choisie.erreur };
      piste = choisie;
    }
    /* LES PHRASES D'UNE VOIX SE SUIVENT : sans place annoncée, la suivante part où finit la précédente. */
    const finDeLaVoix = type === 'voix' && !placeDuPlan && m.place?.debut === undefined && piste.segments.length ? arrondi2(piste.segments.reduce((f, x) => Math.max(f, x.debut + x.duree), 0)) : null;
    const instant = placeDuPlan ? placeDuPlan.segment.debut : finDeLaVoix ?? (musique && m.place?.debut === undefined ? 0 : (instantDeLaPose(c, m) ?? 0));
    const film = c.dureeVoulue ?? c.pistes.reduce((fin, p) => (p.genre === type ? fin : p.segments.reduce((f, s) => Math.max(f, s.debut + s.duree), fin)), 0);
    const voulue = m.place?.duree ?? m.pose.duree;
    const duree = arrondi2(Math.max(0.5, musique && film > 0 ? Math.min(voulue, Math.max(0.5, film - instant)) : voulue));
    const place = libererLaPlace(piste, recouvrent(piste, instant, instant + duree), false);
    if ('occupe' in place) return { ok: false, occupe: place.occupe };
    if ('raison' in place) return { ok: false, raison: place.raison };
    const erreur = appliquer({
      op: 'inserer',
      pisteId: place.pisteId,
      segment: { genre: 'audio', debut: instant, duree, mediaId: m.pose.mediaId, debutMedia: 0, volume: musique ? 0.6 : 1, ...(musique ? { fonduEntree: 0.5, fonduSortie: 1 } : {}), nom },
    });
    if (erreur) return { ok: false, raison: erreur };
    return { ok: true, composition: c, resume: `${type === 'voix' ? 'voix' : musique ? 'musique' : 'son'} « ${nom} » posée sur sa piste`, retires: place.retires, pisteId: place.pisteId, debut: instant };
  }

  const type: GenrePiste = m.pose.genre === 'video' ? 'video' : 'image';
  const instant = placeDuPlan ? arrondi2(placeDuPlan.segment.debut) : instantDeLaPose(c, m);
  /* Un montage de plans sans durée voulue ni instant connu grandit à la suite : jamais de place à disputer. */
  if (instant === null) {
    const r = poserUnPlanDeLaCarte(c, m.pose, idNeuf);
    return r.ok ? { ok: true, composition: r.composition, resume: r.resume, retires: [] } : { ok: false, raison: r.raison };
  }
  const dureePropre = m.pose.genre === 'video' ? m.pose.duree || 4 : m.pose.duree && m.pose.duree > 0 ? m.pose.duree : 4;
  const duree = arrondi2(Math.max(0.5, placeDuPlan ? Math.min(placeDuPlan.segment.duree, m.place?.duree ?? dureePropre) : (m.place?.duree ?? dureePropre)));
  let piste: Piste | null = placeDuPlan?.piste.genre === type ? placeDuPlan.piste : pisteAnnoncee(type);
  if (!piste) {
    const aLui = pisteALui(type);
    if ('erreur' in aLui) return { ok: false, raison: aLui.erreur };
    piste = aLui;
  }
  const genants = placeDuPlan?.piste.id === piste.id ? [placeDuPlan.segment, ...recouvrent(piste, instant, instant + duree).filter((s) => s.id !== placeDuPlan.segment.id)] : recouvrent(piste, instant, instant + duree);
  const place = libererLaPlace(piste, genants, true);
  if ('occupe' in place) return { ok: false, occupe: place.occupe };
  if ('raison' in place) return { ok: false, raison: place.raison };
  const cadre = m.place?.cadre;
  if (m.pose.genre === 'video') {
    const r = poserLExtrait(c, { videoMediaId: m.pose.videoMediaId, ...(m.pose.audioMediaId ? { audioMediaId: m.pose.audioMediaId } : {}), debut: instant, duree, nom, pisteVisuelleId: place.pisteId, ...(cadre ? { cadre } : {}), ...(m.pose.transparent ? { contenir: true } : {}) }, idNeuf);
    return r.ok ? { ok: true, composition: r.composition, resume: r.resume, retires: place.retires, pisteId: place.pisteId, debut: instant } : { ok: false, raison: r.raison };
  }
  const erreur = appliquer({
    op: 'inserer',
    pisteId: place.pisteId,
    segment: { genre: 'image', debut: instant, duree, mediaId: m.pose.mediaId, ajustement: cadre || m.pose.transparent ? 'contenir' : 'couvrir', nom, ...(cadre ? { retouches: { image: retoucheDuCadre(cadre) } } : {}) },
  });
  if (erreur) return { ok: false, raison: erreur };
  return { ok: true, composition: c, resume: `image « ${nom} » posée sur sa piste`, retires: place.retires, pisteId: place.pisteId, debut: instant };
}

/* ------------------------------------------------------------------ */
/* La pose à la main : menu, glisser, boutons de l'atelier              */
/* ------------------------------------------------------------------ */

/** Les pistes qui acceptent un segment, de haut en bas. Un fichier son va sur Voix ou sur Son selon sa capacité. */
export function pistesPourUnSegment(c: Pick<Composition, 'pistes'>, genre: GenreSegment, capacite?: string | null): Piste[] {
  if (genre === 'audio' && capacite) return c.pistes.filter((p) => p.genre === typeDePisteDeLaCapacite(capacite) && !p.masquee);
  if (genre === 'audio') return c.pistes.filter((p) => p.genre === 'son' && !p.masquee);
  return c.pistes.filter((p) => pisteAccepte(p.genre, genre) && !p.masquee);
}

export interface DemandeDePose {
  /** La piste visée ; sans elle, une piste compatible et libre à cet instant, sinon la première. */
  pisteId?: string | null;
  capacite?: string | null;
  segment: Record<string, unknown> & { genre: GenreSegment; debut: number; duree: number };
  /** Toujours sur une piste neuve de son type, sans rien disputer à celles qui existent. */
  nouvellePiste?: boolean;
}

/** Le type de piste qui reçoit un segment : un son selon sa capacité (Voix ou Son). */
function typeDePisteDuSegment(genre: GenreSegment, capacite?: string | null): GenrePiste {
  if (genre === 'audio') return typeDePisteDeLaCapacite(capacite);
  if (genre === 'voix') return 'voix';
  if (genre === 'sous-titres') return 'sous-titres';
  if (genre === 'image') return 'image';
  if (genre === 'video') return 'video';
  return 'vecteur';
}

export type IssueDeLaPoseManuelle =
  | { ok: true; operation: OperationStudio; retires: string[]; pisteId: string }
  | { ok: false; occupe: { pisteId: string; nom: string } }
  | { ok: false; raison: string; occupe?: undefined };

/**
 * UNE POSE À LA MAIN : UNE seule opération, donc un seul « Annuler ». Une place
 * prise rend `occupe`, puis se tranche par `remplacer` (ce qui est recouvert
 * quitte la piste, `retires` nomme ses médias) ou `ajouter` (une piste du même
 * type : devant pour un visuel, qui resterait caché derrière ; dessous pour un
 * son). Le même média peut être posé plusieurs fois : c'est un geste voulu.
 */
export function poseManuelle(c: Composition, d: DemandeDePose, mode: ModeDePose | undefined, idNeuf: (prefixe: string) => string): IssueDeLaPoseManuelle {
  const genre = d.segment.genre;
  const debut = arrondi2(Math.max(0, Number(d.segment.debut) || 0));
  const duree = Math.max(0.1, Number(d.segment.duree) || 4);
  const fin = debut + duree;
  const segment = { ...d.segment, debut };
  if (d.nouvellePiste) {
    const type = typeDePisteDuSegment(genre, d.capacite);
    const neuve = idNeuf('piste');
    return { ok: true, retires: [], pisteId: neuve, operation: { op: 'lot', operations: [{ op: 'piste-ajouter', genre: type, id: neuve, position: positionDeNouvellePiste(c.pistes, type) }, { op: 'inserer', pisteId: neuve, segment }] } };
  }
  const compatibles = pistesPourUnSegment(c, genre, d.capacite);
  let piste: Piste | undefined;
  if (d.pisteId) {
    piste = c.pistes.find((p) => p.id === d.pisteId);
    if (!piste) return { ok: false, raison: 'cette piste n’existe plus' };
    if (!pisteAccepte(piste.genre, genre)) return { ok: false, raison: `la piste « ${piste.nom} » n’accepte pas ce média` };
    if (piste.masquee) return { ok: false, raison: `la piste « ${piste.nom} » est masquée : affichez-la d’abord` };
  } else {
    piste = compatibles.find((p) => !recouvrent(p, debut, fin).length) ?? compatibles[0];
  }
  if (!piste) {
    const type = typeDePisteDuSegment(genre, d.capacite);
    const id = idNeuf('piste');
    return { ok: true, retires: [], pisteId: id, operation: { op: 'lot', operations: [{ op: 'piste-ajouter', genre: type, id }, { op: 'inserer', pisteId: id, segment }] } };
  }
  const genants = recouvrent(piste, debut, fin);
  if (!genants.length) return { ok: true, retires: [], pisteId: piste.id, operation: { op: 'inserer', pisteId: piste.id, segment } };
  if (!mode) return { ok: false, occupe: { pisteId: piste.id, nom: nomDuSegment(genants[0]) || piste.nom } };
  if (mode === 'remplacer') {
    return {
      ok: true,
      pisteId: piste.id,
      retires: genants.map(mediaDuSegment).filter((x): x is string => !!x),
      operation: { op: 'lot', operations: [...genants.map((s) => ({ op: 'supprimer', segmentId: s.id }) as OperationStudio), { op: 'inserer', pisteId: piste.id, segment }] },
    };
  }
  const index = c.pistes.findIndex((p) => p.id === piste!.id);
  const id = idNeuf('piste');
  return {
    ok: true,
    pisteId: id,
    retires: [],
    operation: { op: 'lot', operations: [{ op: 'piste-ajouter', genre: piste.genre, id, position: pisteVisuelle(piste.genre) ? index : index + 1 }, { op: 'inserer', pisteId: id, segment }] },
  };
}

/**
 * RETIRER LA VALIDATION RETIRE DE LA PISTE (décision du 31/10/2026) : tous les
 * segments qui portent l'un de ces médias du Studio quittent la ligne de temps ;
 * le média, lui, reste dans la bibliothèque et le fichier dans le fil.
 */
export function retirerLesMediasDeLaComposition(composition: Composition, mediaIds: readonly string[], idNeuf: (prefixe: string) => string): { composition: Composition; retires: number } {
  const ids = new Set(mediaIds);
  /* Le son séparé d'une vidéo retirée part avec elle (même instant, même durée), même posé sans marque. */
  const videos = segmentsDe(composition).filter((x) => x.segment.genre === 'video' && ids.has(mediaDuSegment(x.segment) ?? ''));
  const sonsJumeaux = new Set(
    composition.pistes
      .filter((p) => p.genre === 'son')
      .flatMap((p) => p.segments.filter((s) => s.genre === 'audio' && videos.some((v) => Math.abs(v.segment.debut - s.debut) < 0.01 && Math.abs(v.segment.duree - s.duree) < 0.01)))
      .map((s) => s.id),
  );
  let c = composition;
  let retires = 0;
  for (const { segment } of segmentsDe(composition)) {
    if (!ids.has(mediaDuSegment(segment) ?? '') && !sonsJumeaux.has(segment.id)) continue;
    const r = appliquerOperation(c, { op: 'supprimer', segmentId: segment.id }, idNeuf);
    if (r.ok) {
      c = r.composition;
      retires++;
    }
  }
  return { composition: c, retires };
}
