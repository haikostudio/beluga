import * as React from 'react';
import { Maximize2, Pencil, RotateCcw, RotateCw } from 'lucide-react';
import { t } from '@/lib/langue';
import { usePointerDrag } from '@/lib/dnd';
import { cn } from '@/lib/utils';
import { ListeDeroulante, type OptionSelecteur } from '@/components/ui';
import {
  type AncrePiece,
  type Aimantation,
  type BoiteStudio,
  type Composition,
  type FormatStudio,
  type KitDeMarque,
  type MediaPourLaPage,
  type Retouche,
  FORMATS_STUDIO,
  MARGE_SECURITE_STUDIO,
  MOTEUR_APERCU_STUDIO,
  aimanter,
  retouchesDuFormat,
  traduireEnPage,
  trouverSegment,
} from '@beluga/shared';

/**
 * L'APERÇU DU STUDIO — la page de composition lue EN DIRECT, la même
 * traduction que l'export (`traduireEnPage`).
 *
 * LE CADRE EST ISOLÉ : `sandbox="allow-scripts"` SANS `allow-same-origin`. Le
 * dessin écrit par un modèle tourne dans une origine opaque : il ne lit ni la
 * session ni l'application, et sa politique de contenu coupe tout appel réseau
 * (`connect-src 'none'`). Ses médias passent par des adresses signées.
 *
 * On lui PARLE par messages (aller à un instant, lire, sélectionner), il
 * RÉPOND par messages (temps, sélection, boîte de la pièce choisie, retouche,
 * texte). Seuls les messages de CE cadre sont écoutés, et seuls les types
 * connus sont lus.
 *
 * LE CADRE DE SÉLECTION EST DESSINÉ ICI, À LA TAILLE DE L'ÉCRAN, par-dessus
 * l'aperçu réduit : quatre coins (agrandir), une poignée de rotation et une
 * barre de boutons (modifier le contenu, remettre comme à l'origine, ouvrir
 * l'éditeur). Dessinés dans le cadre, ils étaient réduits avec lui jusqu'à
 * l'invisible. Le déplacement se fait toujours en tirant la pièce elle-même.
 * Sur un TEXTE (même découpé mot par mot pour son animation), les coins
 * agrandissent son CADRE (largeur et hauteur, le texte se réenroule) sans
 * toucher la taille des lettres ; ailleurs, ils agrandissent la pièce entière
 * (échelle), sans jamais la déformer. Deux POIGNÉES DE BORD, sur TOUTE pièce,
 * règlent le cadre sur un seul axe : le bord droit la largeur, le bord bas la
 * hauteur ; une image s'y recadre (elle remplit le cadre) sans se déformer.
 *
 * LE DOUBLE-CLIC dans le cadre écrit sur place un texte simple ; sur toute autre
 * pièce, le cadre demande la fenêtre d'édition (« ouvrir-editeur »), relayée à
 * `onOuvrirEditeur` — absent dans l'aperçu de la fenêtre elle-même.
 *
 * LE DÉPLACEMENT EST DÉCIDÉ ICI : le cadre dit où la main amène la pièce
 * (« deplacement »), la page l'AIMANTE aux repères du cadre (bords, marge de
 * sécurité, centre — `aimanter`, `studio-ancres.ts`), dessine ces repères à la
 * taille de l'écran pendant le geste, et renvoie la position retenue. Alt (ou
 * Ctrl) tenu : aucun aimant, placement libre au pixel. Au relâcher, la retouche
 * emporte son ANCRE, qui la garde collée à son repère dans les autres formats.
 * Les FLÈCHES (une pièce choisie) la poussent d'un pixel, de dix avec Maj.
 */

export interface BoiteDuCadre {
  segmentId: string | null;
  elementId?: string | null;
  /** En pixels de la composition. */
  x?: number;
  y?: number;
  l?: number;
  h?: number;
  /** La pièce est un texte (simple ou découpé mot par mot) : ses coins règlent son cadre. */
  texte?: boolean;
  /** Un texte SIMPLE : « Modifier » l'écrit sur place (une phrase découpée en mots animés ne s'écrase pas). */
  ecrivable?: boolean;
  /** La pièce est une image : son fichier (segment image) ou un paramètre « média » du dessin. */
  image?: 'fichier' | 'parametre' | null;
  parametre?: string | null;
  /** Ce qu'est la pièce : ses réglages en dépendent (une image n'a ni texte ni couleur). */
  nature?: NaturePiece;
  /** Le texte affiché d'une pièce texte (retours à la ligne compris). */
  contenu?: string | null;
  /** Ses styles CALCULÉS dans la page, à l'instant de la tête : l'inspecteur part de là. */
  styles?: StylesDeLaPiece | null;
}

export type NaturePiece = 'texte' | 'image' | 'svg' | 'groupe' | 'forme';

export interface StylesDeLaPiece {
  /** Telles que le navigateur les donne (`rgb(…)`) : `enHexa` les ramène au sélecteur de couleur. */
  couleur?: string;
  fond?: string;
  remplissage?: string;
  /** En pixels de la composition. */
  taillePolice?: number;
  largeur?: number;
  hauteur?: number;
  /** `text-align` calculé (left, center, right, justify, start…). */
  alignement?: string;
  contour?: string;
  epaisseurContour?: number;
  arrondi?: number;
}

/** `text-align` → l'alignement de la retouche. */
export function alignementDe(css: string | undefined): NonNullable<Retouche['alignement']> {
  if (css === 'center') return 'centre';
  if (css === 'right' || css === 'end') return 'droite';
  if (css === 'justify') return 'justifie';
  return 'gauche';
}

/** « rgb(12, 34, 56) » → « #0c2238 » ; une couleur transparente ou illisible rend `null`. */
export function enHexa(couleur: string | undefined | null): string | null {
  if (!couleur) return null;
  if (/^#[0-9a-f]{6}$/i.test(couleur)) return couleur.toLowerCase();
  const m = couleur.match(/^rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/i);
  if (!m) return null;
  if (m[4] !== undefined && parseFloat(m[4]) === 0) return null;
  return `#${[m[1], m[2], m[3]].map((v) => Math.max(0, Math.min(255, Math.round(Number(v)))).toString(16).padStart(2, '0')).join('')}`;
}

/** Ce que le cadre (et le cadre de sélection) disent à l'éditeur. `effacer` : « Remettre comme à l'origine ». */
export interface MessageDuCadre {
  type: 'pret' | 'temps' | 'fin' | 'selection' | 'retouche' | 'effacer' | 'texte' | 'erreurs' | 'boite' | 'echap' | 'deplacement' | 'fleche' | 'ouvrir-editeur';
  t?: number;
  segmentId?: string | null;
  elementId?: string | null;
  retouche?: Retouche;
  /** Le texte réécrit (message « texte ») ; pour « boite » : la pièce est un texte seul. */
  texte?: string | boolean;
  erreurs?: string[];
  liste?: string[];
  x?: number;
  y?: number;
  l?: number;
  h?: number;
  image?: 'fichier' | 'parametre' | null;
  parametre?: string | null;
  nature?: NaturePiece;
  ecrivable?: boolean;
  contenu?: string | null;
  styles?: StylesDeLaPiece | null;
  /** « deplacement » : la retouche au début du geste, la boîte de la pièce à ce moment, aimant coupé. */
  x0?: number;
  y0?: number;
  boite?: BoiteStudio;
  libre?: boolean;
  /** « fleche » : le pas demandé, en pixels de composition. */
  dx?: number;
  dy?: number;
}

/** Le déplacement en cours : la position retenue et les repères atteints. */
interface Aimant {
  segmentId: string;
  elementId: string;
  x: number;
  y: number;
  ancre: AncrePiece;
  reperes: Aimantation['reperes'];
}

/** Au-delà de 8 pixels D'ÉCRAN, un repère n'attire plus. */
const SEUIL_AIMANT_ECRAN = 8;

export interface PoigneeApercu {
  aller: (t: number) => void;
  lire: (t?: number) => void;
  pause: () => void;
  selectionner: (segmentId: string | null, elementId?: string | null) => void;
  /** Pousser la pièce choisie (flèches du clavier), en pixels de composition. */
  decaler: (dx: number, dy: number) => boolean;
  /** MONTRER SANS ENREGISTRER : une retouche (couleur, alignement…) ou une variable de dessin, pendant le choix. */
  direct: (m: ApercuDirect) => void;
}

/** Ce que l'inspecteur fait voir dans l'aperçu avant que l'opération parte. */
export type ApercuDirect =
  | { segmentId: string; elementId: string; retouche: Retouche }
  | { segmentId: string; variable: string; valeur: string };

/** L'APERÇU QUI MONTRE UN RÉGLAGE EN COURS : fourni par l'écran qui porte l'aperçu, lu par l'inspecteur. */
export const ApercuEnDirect = React.createContext<((m: ApercuDirect) => void) | null>(null);

/** `cadre` : un coin tiré sur un TEXTE (ou un bord, sur toute pièce) agrandit son cadre, sa police ne change pas. */
type ModeGeste = 'echelle' | 'rotation' | 'cadre';
type Bord = 'droite' | 'bas';

interface Geste {
  mode: ModeGeste;
  segmentId: string;
  elementId: string;
  cx: number;
  cy: number;
  d0: number;
  a0: number;
  r0: { echelle: number; rotation: number };
  /** Pour `cadre` : le point de départ (écran), le sens du coin tiré et la taille de départ (composition). */
  x0?: number;
  y0?: number;
  sx?: number;
  sy?: number;
  l0?: number;
  h0?: number;
  /** Un BORD tiré : un seul axe change (le droit : la largeur, le bas : la hauteur). */
  bord?: Bord;
  fin?: Retouche;
}

export const Apercu = React.forwardRef<
  PoigneeApercu,
  {
    composition: Composition;
    format: FormatStudio;
    kit: KitDeMarque;
    adressesMedias: Record<string, { url: string; genre: string }>;
    temps: number;
    muet?: boolean;
    /** Pendant la lecture, le cadre de sélection et sa barre se cachent. */
    lecture?: boolean;
    onMessage: (m: MessageDuCadre) => void;
    /** Les images de la bibliothèque, proposées par « Modifier » sur une image. */
    images?: OptionSelecteur[];
    /** « Modifier » sur une image : le fichier retenu (ou `__importer`). */
    onChangerImage?: (boite: BoiteDuCadre, valeur: string) => void;
    /** « Ouvrir l'éditeur » : la fenêtre d'édition de l'élément (absent : le bouton ne paraît pas). */
    onOuvrirEditeur?: (segmentId: string, elementId: string | null) => void;
    /** Échap pressée DANS le cadre d'aperçu (il a le focus) : la fenêtre qui le porte se ferme. */
    onEchap?: () => void;
    /** La pièce choisie et ce qu'elle est (nature, vraies couleurs) : l'inspecteur s'y règle. */
    onBoite?: (b: BoiteDuCadre | null) => void;
    className?: string;
  }
>(function Apercu({ composition, format, kit, adressesMedias, temps, muet, lecture, onMessage, images, onChangerImage, onOuvrirEditeur, onEchap, onBoite, className }, ref) {
  const cadre = React.useRef<HTMLIFrameElement | null>(null);
  const boite = React.useRef<HTMLDivElement | null>(null);
  const scene = React.useRef<HTMLDivElement | null>(null);
  const [echelle, setEchelle] = React.useState(0.3);
  const [choisie, setChoisie] = React.useState<BoiteDuCadre | null>(null);
  const { largeur, hauteur } = FORMATS_STUDIO[format];
  const tempsRef = React.useRef(temps);
  tempsRef.current = temps;
  const surMessage = React.useRef(onMessage);
  surMessage.current = onMessage;
  const surEchap = React.useRef(onEchap);
  surEchap.current = onEchap;
  const surBoite = React.useRef(onBoite);
  surBoite.current = onBoite;
  const surOuvrirEditeur = React.useRef(onOuvrirEditeur);
  surOuvrirEditeur.current = onOuvrirEditeur;

  const page = React.useMemo(() => {
    const origine = window.location.origin;
    const medias: Record<string, MediaPourLaPage> = {};
    for (const [id, m] of Object.entries(adressesMedias)) medias[id] = { url: `${origine}${m.url}`, genre: m.genre as MediaPourLaPage['genre'] };
    return traduireEnPage(composition, {
      format,
      kit,
      medias,
      gsap: `${origine}/studio/gsap.min.js`,
      polices: `${origine}/studio/polices/`,
      mode: 'apercu',
      sourcesApercu: { scripts: `${origine}/studio/`, medias: `${origine}/studio-media/`, polices: `${origine}/studio/polices/` },
      moteurApercu: MOTEUR_APERCU_STUDIO,
    });
  }, [composition, format, kit, adressesMedias]);

  const dire = React.useCallback((m: Record<string, unknown>) => {
    // Origine opaque : le message part vers « * », mais seul CE cadre le reçoit.
    cadre.current?.contentWindow?.postMessage(m, '*');
  }, []);

  React.useImperativeHandle(
    ref,
    () => ({
      aller: (t) => dire({ type: 'aller', t }),
      lire: (t) => dire({ type: 'lire', ...(typeof t === 'number' ? { t } : {}) }),
      pause: () => dire({ type: 'pause' }),
      selectionner: (segmentId, elementId) => dire({ type: 'selectionner', segmentId, elementId: elementId ?? null }),
      decaler: (dx, dy) => decalerRef.current(dx, dy),
      direct: (m) =>
        'variable' in m
          ? dire({ type: 'variable-en-direct', segmentId: m.segmentId, nom: m.variable, valeur: m.valeur })
          : dire({ type: 'retouche-en-direct', segmentId: m.segmentId, elementId: m.elementId, retouche: m.retouche }),
    }),
    [dire],
  );
  const decalerRef = React.useRef<(dx: number, dy: number) => boolean>(() => false);
  const surDeplacement = React.useRef<(d: MessageDuCadre) => void>(() => undefined);
  const surRetouche = React.useRef<(d: MessageDuCadre) => MessageDuCadre>((d) => d);

  React.useEffect(() => {
    const ecouter = (e: MessageEvent) => {
      if (!cadre.current || e.source !== cadre.current.contentWindow) return;
      const d = e.data as MessageDuCadre & { studio?: number };
      if (!d || d.studio !== 1 || typeof d.type !== 'string') return;
      if (d.type === 'pret') dire({ type: 'aller', t: tempsRef.current });
      if (d.type === 'echap') {
        surEchap.current?.();
        return;
      }
      if (d.type === 'deplacement') {
        surDeplacement.current(d);
        return;
      }
      if (d.type === 'ouvrir-editeur') {
        // L'aperçu de la fenêtre d'édition n'a pas de fenêtre à rouvrir : la pièce reste simplement choisie.
        if (d.segmentId) surOuvrirEditeur.current?.(d.segmentId, d.elementId ?? null);
        return;
      }
      if (d.type === 'fleche') {
        decalerRef.current(Number(d.dx) || 0, Number(d.dy) || 0);
        return;
      }
      if (d.type === 'retouche') {
        surMessage.current(surRetouche.current(d));
        return;
      }
      if (d.type === 'boite') {
        const b: BoiteDuCadre | null =
          d.segmentId && typeof d.x === 'number'
            ? { segmentId: d.segmentId, elementId: d.elementId ?? null, x: d.x, y: d.y, l: d.l, h: d.h, texte: d.texte === true, ecrivable: d.ecrivable === true, image: d.image ?? null, parametre: d.parametre ?? null, nature: d.nature, contenu: d.contenu ?? null, styles: d.styles ?? null }
            : null;
        setChoisie(b);
        surBoite.current?.(b);
        return;
      }
      surMessage.current(d);
    };
    window.addEventListener('message', ecouter);
    return () => window.removeEventListener('message', ecouter);
  }, [dire]);

  React.useEffect(() => {
    dire({ type: 'muet', muet: !!muet });
  }, [muet, dire]);

  // Le cadre garde ses pixels réels (1080 × 1920…) et se réduit pour tenir dans la place.
  React.useEffect(() => {
    const el = boite.current;
    if (!el) return;
    const mesurer = () => {
      const r = el.getBoundingClientRect();
      if (r.width && r.height) setEchelle(Math.max(0.05, Math.min(r.width / largeur, r.height / hauteur)));
    };
    mesurer();
    const obs = new ResizeObserver(mesurer);
    obs.observe(el);
    return () => obs.disconnect();
  }, [largeur, hauteur]);

  /* ---- LES GESTES DU CADRE DE SÉLECTION : un seul glisser, `usePointerDrag` ---- */
  const geste = React.useRef<Geste | null>(null);
  const resoudre = React.useCallback(() => null, []);
  const lacher = React.useCallback(() => {
    const g = geste.current;
    geste.current = null;
    if (g?.fin) surMessage.current({ type: 'retouche', segmentId: g.segmentId, elementId: g.elementId, retouche: g.fin });
  }, []);
  const { dragging, pointer, start } = usePointerDrag({ resolve: resoudre, onDrop: lacher });

  React.useEffect(() => {
    const g = geste.current;
    if (!g || !pointer || !dragging) return;
    if (g.mode === 'cadre') {
      // Pixels d'écran → pixels de la composition, en défaisant l'échelle déjà posée sur la pièce.
      const k = echelle * (g.r0.echelle || 1);
      const largeurTiree = Math.max(8, Math.round(g.l0! + ((pointer.x - g.x0!) * g.sx!) / k));
      const hauteurTiree = Math.max(8, Math.round(g.h0! + ((pointer.y - g.y0!) * g.sy!) / k));
      g.fin = g.bord === 'droite' ? { largeur: largeurTiree } : g.bord === 'bas' ? { hauteur: hauteurTiree } : { largeur: largeurTiree, hauteur: hauteurTiree };
    } else if (g.mode === 'echelle') {
      const k = Math.hypot(pointer.x - g.cx, pointer.y - g.cy) / g.d0;
      g.fin = { echelle: Math.max(0.05, Math.round(g.r0.echelle * k * 100) / 100) };
    } else {
      let deg = Math.round(g.r0.rotation + ((Math.atan2(pointer.y - g.cy, pointer.x - g.cx) - g.a0) * 180) / Math.PI);
      // L'aimant des quarts de tour : à 4° près d'un angle droit, on s'y pose.
      if (Math.abs(deg % 90) < 4) deg = Math.round(deg / 90) * 90;
      g.fin = { rotation: deg };
    }
    dire({ type: 'retouche-en-direct', retouche: g.fin });
  }, [pointer?.x, pointer?.y, dragging]);

  const piece = choisie?.segmentId && choisie.elementId ? choisie : null;
  // Une image se change si c'est le fichier d'un segment « image », ou le paramètre « média » d'un dessin.
  const genreChoisi = piece ? trouverSegment(composition, piece.segmentId!)?.segment.genre : undefined;
  const imageChangeable = !!piece?.image && (piece.image === 'parametre' ? !!piece.parametre : genreChoisi === 'image');
  const retoucheActuelle = (): Retouche => {
    if (!piece) return {};
    const s = trouverSegment(composition, piece.segmentId!)?.segment;
    return s ? (retouchesDuFormat(s, format, composition.format)[piece.elementId!] ?? {}) : {};
  };

  /* ---- LE DÉPLACEMENT AIMANTÉ ---- */
  const [aimant, setAimant] = React.useState<Aimant | null>(null);
  const aimantRef = React.useRef<Aimant | null>(null);
  /** L'instant de la pose, compté depuis le début du segment : la page mesure la pièce à ce moment-là. */
  const instantDansLeSegment = (segmentId: string) => {
    const s = trouverSegment(composition, segmentId)?.segment;
    return s ? Math.round(Math.max(0, Math.min(s.duree, tempsRef.current - s.debut)) * 1000) / 1000 : 0;
  };
  surDeplacement.current = (d) => {
    if (!d.segmentId || !d.elementId || !d.boite || typeof d.x !== 'number' || typeof d.y !== 'number') return;
    const ox = d.x - (d.x0 ?? 0);
    const oy = d.y - (d.y0 ?? 0);
    const amenee = { x: d.boite.x + ox, y: d.boite.y + oy, l: d.boite.l, h: d.boite.h };
    const a: Aimantation = d.libre ? { dx: 0, dy: 0, ancre: {}, reperes: [] } : aimanter(amenee, largeur, hauteur, SEUIL_AIMANT_ECRAN / echelle);
    const suivant: Aimant = { segmentId: d.segmentId, elementId: d.elementId, x: d.x + a.dx, y: d.y + a.dy, ancre: a.ancre, reperes: a.reperes };
    aimantRef.current = suivant;
    setAimant(suivant);
    dire({ type: 'retouche-en-direct', retouche: { x: suivant.x, y: suivant.y } });
  };
  surRetouche.current = (d) => {
    const a = aimantRef.current;
    aimantRef.current = null;
    setAimant(null);
    if (!a || a.segmentId !== d.segmentId || a.elementId !== d.elementId || typeof d.retouche?.x !== 'number') return d;
    // L'ancre part avec la position : posée si l'aimant a pris, effacée (null) sur un placement libre.
    const ancre = a.ancre.h || a.ancre.v ? { ...a.ancre, t: instantDansLeSegment(a.segmentId) } : null;
    return { ...d, retouche: { x: a.x, y: a.y, ancre: ancre as AncrePiece } };
  };

  /* LES FLÈCHES : la pièce bouge aussitôt, la retouche part une fois la main levée du clavier (une version, pas une par pixel). */
  const enAttente = React.useRef<{ segmentId: string; elementId: string; x: number; y: number; ancre: AncrePiece | null; minuteur: number } | null>(null);
  decalerRef.current = (dx, dy) => {
    if (!piece || lecture) return false;
    const p = enAttente.current;
    const memePiece = p && p.segmentId === piece.segmentId && p.elementId === piece.elementId;
    const depart = memePiece ? { x: p.x, y: p.y, ancre: p.ancre } : (() => {
      const r = retoucheActuelle();
      return { x: r.x ?? 0, y: r.y ?? 0, ancre: r.ancre ?? null };
    })();
    if (p) window.clearTimeout(p.minuteur);
    let ancre = depart.ancre ? { ...depart.ancre } : null;
    if (ancre && dx) delete ancre.h;
    if (ancre && dy) delete ancre.v;
    if (ancre && !ancre.h && !ancre.v) ancre = null;
    const suivant = { segmentId: piece.segmentId!, elementId: piece.elementId!, x: depart.x + dx, y: depart.y + dy, ancre, minuteur: 0 };
    suivant.minuteur = window.setTimeout(() => {
      const e = enAttente.current;
      enAttente.current = null;
      if (e) surMessage.current({ type: 'retouche', segmentId: e.segmentId, elementId: e.elementId, retouche: { x: e.x, y: e.y, ancre: e.ancre as AncrePiece } });
    }, 450);
    enAttente.current = suivant;
    dire({ type: 'retouche-en-direct', retouche: { x: suivant.x, y: suivant.y } });
    return true;
  };

  const saisir = (e: React.PointerEvent, mode: ModeGeste, coin?: string, bord?: Bord) => {
    if (!piece || !scene.current || e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    /* LE CADRE D'APERÇU NE PREND PLUS LE POINTEUR DÈS L'APPUI : un cadre isolé garde
       pour lui les mouvements qui passent au-dessus de lui, capture ou pas — le geste
       se perdait dès que la main quittait la poignée, avant même d'avoir démarré. */
    const iframe = cadre.current;
    if (iframe) {
      iframe.style.pointerEvents = 'none';
      const liberer = () => {
        iframe.style.pointerEvents = '';
        window.removeEventListener('pointerup', liberer);
        window.removeEventListener('pointercancel', liberer);
      };
      window.addEventListener('pointerup', liberer);
      window.addEventListener('pointercancel', liberer);
    }
    try {
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
    } catch {
      /* rien */
    }
    const r = scene.current.getBoundingClientRect();
    const cx = r.left + (piece.x! + piece.l! / 2) * echelle;
    const cy = r.top + (piece.y! + piece.h! / 2) * echelle;
    const deja = retoucheActuelle();
    geste.current = {
      mode,
      segmentId: piece.segmentId!,
      elementId: piece.elementId!,
      cx,
      cy,
      d0: Math.hypot(e.clientX - cx, e.clientY - cy) || 1,
      a0: Math.atan2(e.clientY - cy, e.clientX - cx),
      r0: { echelle: deja.echelle ?? 1, rotation: deja.rotation ?? 0 },
      ...(mode === 'cadre'
        ? {
            x0: e.clientX,
            y0: e.clientY,
            sx: coin?.includes('w') ? -1 : 1,
            sy: coin?.startsWith('n') ? -1 : 1,
            l0: deja.largeur ?? piece.styles?.largeur ?? piece.l! / (deja.echelle ?? 1),
            h0: deja.hauteur ?? piece.styles?.hauteur ?? piece.h! / (deja.echelle ?? 1),
            ...(bord ? { bord } : {}),
          }
        : {}),
    };
    start(e, { id: 'poignee', kind: mode, label: mode === 'rotation' ? t('Tourner') : t('Agrandir') });
  };

  const modifier = () => {
    if (!piece) return;
    // Le cadre reçoit d'abord le focus, puis la pièce devient un champ de texte.
    cadre.current?.focus();
    dire({ type: 'editer-texte' });
  };

  const montrer = !!choisie && !lecture && typeof choisie.x === 'number';
  const gauche = (choisie?.x ?? 0) * echelle;
  const haut = (choisie?.y ?? 0) * echelle;
  const l = (choisie?.l ?? 0) * echelle;
  const h = (choisie?.h ?? 0) * echelle;
  const W = largeur * echelle;
  const H = hauteur * echelle;
  // LA BARRE se pose au-dessus de la pièce, en dessous s'il n'y a pas la place, et reste DANS l'aperçu.
  const hauteurBarre = 36;
  const barreEnHaut = haut - hauteurBarre - 30 >= 0;
  const yBarre = barreEnHaut ? haut - hauteurBarre - 30 : Math.min(H - hauteurBarre - 4, haut + h + 10);
  const xBarre = Math.max(4, Math.min(W - 4, gauche + l / 2));
  const retouchee = Object.keys(retoucheActuelle()).length > 0;
  const coins: { cle: string; x: number; y: number; curseur: string }[] = [
    { cle: 'nw', x: gauche, y: haut, curseur: 'nwse-resize' },
    { cle: 'ne', x: gauche + l, y: haut, curseur: 'nesw-resize' },
    { cle: 'sw', x: gauche, y: haut + h, curseur: 'nesw-resize' },
    { cle: 'se', x: gauche + l, y: haut + h, curseur: 'nwse-resize' },
  ];
  // LES BORDS : le droit règle la largeur seule, le bas la hauteur seule, sur toute pièce.
  const bords: { cle: Bord; x: number; y: number; curseur: string; titre: string }[] = [
    { cle: 'droite', x: gauche + l, y: haut + h / 2, curseur: 'ew-resize', titre: t('Largeur du cadre') },
    { cle: 'bas', x: gauche + l / 2, y: haut + h, curseur: 'ns-resize', titre: t('Hauteur du cadre') },
  ];

  return (
    <div ref={boite} className={className ?? 'flex h-full w-full items-center justify-center'} data-studio-apercu>
      <div ref={scene} className="relative rounded-md shadow-lg" style={{ width: W, height: H }}>
        <div className="absolute inset-0 overflow-hidden rounded-md">
          <iframe
            ref={cadre}
            title={t('Aperçu')}
            sandbox="allow-scripts"
            srcDoc={page}
            data-studio-cadre
            className="absolute left-0 top-0 origin-top-left border-0"
            style={{ width: largeur, height: hauteur, transform: `scale(${echelle})` }}
          />
        </div>
        {aimant ? <Reperes aimant={aimant} echelle={echelle} largeur={largeur} hauteur={hauteur} /> : null}
        {montrer ? (
          <div className="pointer-events-none absolute inset-0" data-studio-selection={choisie!.elementId ?? choisie!.segmentId ?? ''}>
            {/* LE CADRE : un trait clair, lisible sur une image sombre comme claire. */}
            <div
              className="absolute rounded-[3px] border-2 border-accent shadow-[0_0_0_1px_rgba(255,255,255,0.7)]"
              style={{ left: gauche, top: haut, width: l, height: h }}
              data-studio-cadre-selection
            />
            {piece ? (
              <>
                {coins.map((c) => (
                  <span
                    key={c.cle}
                    role="presentation"
                    className="pointer-events-auto absolute h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-accent shadow max-sm:h-5 max-sm:w-5"
                    style={{ left: c.x, top: c.y, cursor: c.curseur, touchAction: 'none' }}
                    onPointerDown={(e) => saisir(e, piece.texte ? 'cadre' : 'echelle', c.cle)}
                    data-studio-coin={c.cle}
                    data-studio-coin-mode={piece.texte ? 'cadre' : 'echelle'}
                    title={piece.texte ? t('Agrandir le cadre du texte (la taille des lettres ne change pas)') : t('Agrandir')}
                  />
                ))}
                {bords.map((b) => (
                  <span
                    key={b.cle}
                    role="presentation"
                    className={cn(
                      'pointer-events-auto absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-accent shadow',
                      b.cle === 'droite' ? 'h-5 w-2 max-sm:h-7 max-sm:w-3' : 'h-2 w-5 max-sm:h-3 max-sm:w-7',
                    )}
                    style={{ left: b.x, top: b.y, cursor: b.curseur, touchAction: 'none' }}
                    onPointerDown={(e) => saisir(e, 'cadre', b.cle === 'droite' ? 'e' : 's', b.cle)}
                    data-studio-bord={b.cle}
                    title={b.titre}
                  />
                ))}
                <span className="absolute w-px -translate-x-1/2 bg-accent" style={{ left: gauche + l / 2, top: Math.max(0, haut - 22), height: Math.min(22, haut) }} aria-hidden />
                <span
                  role="presentation"
                  title={t('Tourner')}
                  className="pointer-events-auto absolute flex h-5 w-5 -translate-x-1/2 -translate-y-1/2 cursor-grab items-center justify-center rounded-full border-2 border-white bg-accent text-accent-fg shadow max-sm:h-7 max-sm:w-7"
                  style={{ left: gauche + l / 2, top: Math.max(10, haut - 22), touchAction: 'none' }}
                  onPointerDown={(e) => saisir(e, 'rotation')}
                  data-studio-rotation
                >
                  <RotateCw className="h-2.5 w-2.5" />
                </span>
              </>
            ) : null}
            {/* LA BARRE DE BOUTONS : ce qu'on fait de la pièce choisie. */}
            <div
              className="pointer-events-auto absolute flex -translate-x-1/2 items-center gap-0.5 rounded-full bg-surface p-1 shadow-lg"
              style={{ left: xBarre, top: yBarre, height: hauteurBarre }}
              data-studio-barre-piece
              onPointerDown={(e) => e.stopPropagation()}
            >
              {piece?.ecrivable ? (
                <BoutonBarre libelle={t('Modifier le texte')} aria="Modifier le texte" onClick={modifier} repere="modifier">
                  <Pencil className="h-3.5 w-3.5" />
                </BoutonBarre>
              ) : imageChangeable && images ? (
                <ListeDeroulante
                  valeur=""
                  titre={t('Changer l’image')}
                  repere="studio-changer-image"
                  options={[...images, { valeur: '__importer', libelle: t('Importer une image…') }]}
                  onChoisir={(v) => onChangerImage?.(piece!, v)}
                  declencheur={(ouvrir) => (
                    <BoutonBarre libelle={t('Changer l’image')} aria="Changer l’image" onClick={(e) => ouvrir(e)} repere="modifier">
                      <Pencil className="h-3.5 w-3.5" />
                    </BoutonBarre>
                  )}
                />
              ) : null}
              {piece ? (
                <BoutonBarre
                  libelle={t('Remettre comme à l’origine')}
                  aria="Remettre comme à l’origine"
                  desactive={!retouchee}
                  onClick={() => surMessage.current({ type: 'effacer', segmentId: piece.segmentId, elementId: piece.elementId })}
                  repere="remettre"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                </BoutonBarre>
              ) : null}
              {onOuvrirEditeur ? (
                <BoutonBarre libelle={t('Ouvrir l’éditeur')} aria="Ouvrir l’éditeur" onClick={() => choisie?.segmentId && onOuvrirEditeur(choisie.segmentId, choisie.elementId ?? null)} repere="editeur">
                  <Maximize2 className="h-3.5 w-3.5" />
                </BoutonBarre>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
});

function BoutonBarre({
  libelle,
  aria,
  onClick,
  desactive,
  repere,
  children,
}: {
  libelle: string;
  /** Le nom lu à voix haute : un texte FIXE, jamais traduit (repère des contrôles). */
  aria: string;
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  desactive?: boolean;
  repere: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={aria}
      title={libelle}
      disabled={desactive}
      onClick={onClick}
      className="flex h-7 w-7 items-center justify-center rounded-full text-text transition-colors hover:bg-raised disabled:opacity-40 max-sm:h-8 max-sm:w-8"
      data-studio-barre={repere}
    >
      {children}
    </button>
  );
}

/**
 * LES REPÈRES DU DÉPLACEMENT, dessinés à la taille de l'écran par-dessus
 * l'aperçu (MEM-4385), visibles seulement pendant le geste : la marge de
 * sécurité et les deux axes du centre en pointillés discrets, les repères
 * ATTEINTS en trait plein, et un point là où deux repères se croisent (coin,
 * centre, milieu d'un bord).
 */
function Reperes({ aimant, echelle, largeur, hauteur }: { aimant: Aimant; echelle: number; largeur: number; hauteur: number }) {
  const W = largeur * echelle;
  const H = hauteur * echelle;
  const mx = Math.round(largeur * MARGE_SECURITE_STUDIO) * echelle;
  const my = Math.round(hauteur * MARGE_SECURITE_STUDIO) * echelle;
  const vx = aimant.reperes.find((r) => r.axe === 'x');
  const vy = aimant.reperes.find((r) => r.axe === 'y');
  const trait = 'absolute bg-[#ff3fa4] shadow-[0_0_0_0.5px_rgba(255,255,255,0.8)]';
  return (
    <div className="pointer-events-none absolute inset-0 z-10" data-studio-reperes={`${aimant.ancre.h ?? ''}|${aimant.ancre.v ?? ''}`}>
      <div className="absolute border border-dashed border-white/45" style={{ left: mx, top: my, width: W - 2 * mx, height: H - 2 * my }} />
      <div className="absolute top-0 h-full border-l border-dashed border-white/30" style={{ left: W / 2 }} />
      <div className="absolute left-0 w-full border-t border-dashed border-white/30" style={{ top: H / 2 }} />
      {vx ? <div className={`${trait} top-0 h-full w-px`} style={{ left: Math.min(W - 1, vx.position * echelle) }} data-studio-repere-x={vx.position} /> : null}
      {vy ? <div className={`${trait} left-0 h-px w-full`} style={{ top: Math.min(H - 1, vy.position * echelle) }} data-studio-repere-y={vy.position} /> : null}
      {vx && vy ? (
        <span
          className="absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-[#ff3fa4]"
          style={{ left: Math.min(W - 1, vx.position * echelle), top: Math.min(H - 1, vy.position * echelle) }}
        />
      ) : null}
    </div>
  );
}
