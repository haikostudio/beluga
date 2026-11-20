/*
 * LE BOUTON DU BORD — LA SEULE ENTRÉE DE L'ASSISTANT, EN TEXTE COMME EN VOIX (carte « Jarvis : volet, voix et
 * rapidité », décisions de l'utilisateur du 16/11/2026, capture #698f, maquette #115d).
 *
 * Un bouton noir PRESQUE ROND (30 × 30, « D » collé au bord, maquette #6950 : l'icône y garde 6 px d'air de chaque
 * côté), fondu dans un bord de l'écran par ses angles CREUSÉS vers l'intérieur (le svg
 * `data-conges-jarvis` : une maquette qui les avait perdus a été refusée). Son icône : TROIS barres de même largeur,
 * petite, moyenne, petite — le dessin des ondes de la voix (`ondes-de-voix.tsx`). On le GLISSE librement : au lâcher
 * il se colle au bord le plus proche (gauche, droite, haut, bas) et garde sa place, une pour l'ordinateur, une pour le
 * téléphone (préférences du compte, règle pure `shared/src/geste-de-bord.ts`). SUR TÉLÉPHONE (20/11/2026), les CÔTÉS
 * SEULEMENT, dans la zone du contenu : sous la barre d'en-tête affichée, au-dessus du menu du bas. Le TOUCHER ouvre SEULEMENT la BULLE
 * VOCALE et Jarvis écoute (carte « Raccourcis libres et Jarvis vocal », 17/11/2026) ; pendant la conversation, il
 * l'arrête ; volet ouvert, il le referme ; Voix désactivée, il ouvre le volet en texte (`voix-assistant.tsx`).
 *
 * La barre d'appel et la conversation empilée au-dessus d'elle ONT DISPARU : la conversation vocale se lit dans le
 * volet, et en mode voix les ondes y remplacent la zone d'écriture. Ce composant ne tient AUCUNE logique de son : le
 * module de voix (`voix-assistant.tsx`) garde le micro, l'attente du mot, le direct et la veille.
 */
import * as React from 'react';
import { Loader2 } from '@/components/ui/icones';
import {
  CLE_BORD_ORDINATEUR,
  CLE_BORD_TELEPHONE,
  CONGE_DU_BOUTON_DE_BORD,
  EPAISSEUR_DU_BOUTON_DE_BORD,
  boiteDuBoutonDeBord,
  bordVertical,
  placeAuBordLue,
  placeAuLacher,
  type BordDeLEcran,
  type PlaceAuBord,
  type ZoneDuBord,
} from '@beluga/shared';
import { IconeTroisBarres } from '@/components/ondes-de-voix';
import { poserLeBoutonDuBord } from '@/lib/assistant-global';
import { useMorphingDuBord } from '@/lib/morphing-du-bord';
import { usePointerDrag } from '@/lib/dnd';
import { usePref } from '@/lib/prefs';
import { t } from '@/lib/langue';
import { cn } from '@/lib/utils';

const CONGE = CONGE_DU_BOUTON_DE_BORD;
const EPAIS = EPAISSEUR_DU_BOUTON_DE_BORD;
/** La zone tactile invisible autour du bouton (accessibilité : 44 px au moins). */
const CIBLE = 44;

export interface ProprietesJarvisNatif {
  /** Écran de téléphone (< 640 px) : sa place se garde à part de celle de l'ordinateur. */
  telephone: boolean;
  /** L'onglet qui tient la voix : Jarvis joue ses gestes à l'écran sur lui seul (`lib/gestes-de-jarvis.ts`). */
  onglet: string;
  /** Le bouton « Voix » de Réglages : désactivée, rien ne parle ni n'écoute, le bouton pâlit. */
  voixActive: boolean;
  /** Où en est le direct avec Codex (« connexion », « ecoute », « erreur »…), lu par les contrôles. */
  etatDirect?: string;
  /** L'état de l'attente du mot (« attente », « chargement », « refuse »…). */
  etatReveil: string;
  /** Le micro d'attente est-il ouvert (non coupé par l'utilisateur) ? */
  microOuvert: boolean;
  /** Une conversation vocale est-elle en cours ? Les trois barres ondulent. */
  conversation: boolean;
  /** Le volet de l'assistant est-il ouvert ? */
  voletOuvert: boolean;
  /** Le toucher : parler à Jarvis (bulle vocale), l'arrêter, ou refermer le volet. */
  onToucher: () => void;
  /** L'assistant travaille : les barres ondulent aussi. */
  travaille?: boolean;
  /** Des questions de l'assistant attendent une réponse : un point orange sur le bouton, volet fermé. */
  questions?: number;
}

/** La zone sûre du bas (barre d'accueil de l'iPhone), en pixels : `env()` ne se lit qu'à travers un élément posé. */
function zoneSureDuBas(): number {
  const sonde = document.createElement('div');
  sonde.style.cssText = 'position:fixed;bottom:0;left:0;width:0;height:env(safe-area-inset-bottom,0px);visibility:hidden;pointer-events:none';
  document.body.appendChild(sonde);
  const h = sonde.getBoundingClientRect().height;
  sonde.remove();
  return Number.isFinite(h) ? h : 0;
}

/**
 * LE HAUT DU CHAMP D'ÉCRITURE POSÉ AU BAS DE L'ÉCRAN (téléphone) : celui d'une conversation ouverte en page. Un champ
 * dans une feuille ou une fenêtre (qui passe par-dessus le bouton) ne compte pas ; un champ qui ne touche pas le bas
 * non plus. `null` sans champ.
 */
function hautDuChampDuBas(hauteur: number): number | null {
  let haut: number | null = null;
  for (const champ of document.querySelectorAll<HTMLElement>('[data-composer]')) {
    if (champ.closest('[role="dialog"], [data-feuille-du-bas], [data-volet-de-jarvis]')) continue;
    const r = champ.getBoundingClientRect();
    if (r.height <= 0 || r.width <= 0 || r.bottom < hauteur - 160 || r.top >= hauteur) continue;
    haut = haut === null ? r.top : Math.min(haut, r.top);
  }
  return haut;
}

/**
 * LE BAS DE LA BARRE D'EN-TÊTE AFFICHÉE (téléphone) : la plus basse des barres visibles qui touchent le haut de
 * l'écran — celle du tableau, ou celle d'une page ouverte par-dessus. Une barre cachée, vide ou hors de l'écran ne
 * compte pas ; une barre dans une feuille ou une fenêtre (qui passe par-dessus le bouton) non plus. 0 sans barre.
 */
function basDeLEnteteAffichee(hauteur: number): number {
  let bas = 0;
  for (const barre of document.querySelectorAll<HTMLElement>('[data-entete-de-zone]')) {
    if (barre.closest('[role="dialog"]:not([data-page-de-zone]), [data-feuille-du-bas], [data-volet-de-jarvis], [inert]')) continue;
    const r = barre.getBoundingClientRect();
    if (r.height <= 0 || r.width <= 0 || r.top > hauteur / 3 || r.bottom <= 0) continue;
    const vue = getComputedStyle(barre);
    if (vue.visibility === 'hidden' || vue.display === 'none') continue;
    bas = Math.max(bas, r.bottom);
  }
  const banniere = document.querySelector('[data-banniere-extension]')?.getBoundingClientRect();
  if (banniere && banniere.height > 0) bas = Math.max(bas, banniere.bottom);
  return bas;
}

/**
 * Les bords de la zone où le bouton se pose, et le « sol » du bord du bas. SUR TÉLÉPHONE (17/11/2026, capture #1106 :
 * posé au ras du bas, le bouton était à moitié caché sous le champ d'écriture et la barre d'accueil, impossible à
 * reprendre), le sol est le PLUS HAUT de : le menu du bas, le champ d'écriture d'une conversation, la zone sûre du bas.
 * La place retenue est une fraction de la course : un bouton rangé trop bas remonte donc de lui-même.
 */
function useZoneDuBord(telephone: boolean): { zone: ZoneDuBord; sol: number; largeur: number; hauteur: number } {
  const lire = React.useCallback(() => {
    const repere = document.querySelector('[data-place-de-la-voix]')?.getBoundingClientRect();
    const menu = document.querySelector('nav[data-menu-bas]')?.getBoundingClientRect();
    const terminal = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--hauteur-terminal')) || 0;
    const largeur = window.innerWidth;
    const hauteur = window.innerHeight;
    let sol = menu && menu.height > 0 && menu.top > 0 ? menu.top : hauteur - terminal;
    if (telephone) {
      sol = Math.min(sol, hauteur - terminal - zoneSureDuBas());
      const champ = hautDuChampDuBas(hauteur);
      // La cible tactile (44 px) déborde le bouton visible (30 px) : 12 px d'air la gardent au-dessus du champ.
      if (champ !== null) sol = Math.min(sol, champ - 12);
    }
    sol = Math.round(sol);
    /* SUR TÉLÉPHONE, LA COURSE COMMENCE SOUS LA BARRE D'EN-TÊTE AFFICHÉE (20/11/2026) : son bas réel compte l'heure,
       la bande orange de l'extension (dépliée ou non) et l'en-tête d'une page ouverte par-dessus. */
    const haut = Math.round(Math.max(repere ? repere.bottom : 0, telephone ? Math.max(56, basDeLEnteteAffichee(hauteur)) : 64) + 8);
    return { zone: { haut, bas: sol - 12, gauche: 12, droite: largeur - 12 }, sol, largeur, hauteur };
  }, [telephone]);
  const [mesure, setMesure] = React.useState(lire);
  React.useLayoutEffect(() => {
    const mesurer = () =>
      setMesure((avant) => {
        const neuf = lire();
        return JSON.stringify(neuf) === JSON.stringify(avant) ? avant : neuf;
      });
    mesurer();
    const veille = window.setInterval(mesurer, 1000);
    window.addEventListener('resize', mesurer);
    // La bande orange de l'extension qui paraît, se déplie ou part déplace l'en-tête.
    window.addEventListener('beluga:hauteur-banniere', mesurer);
    // Le clavier qui monte réduit la vue visible sans toujours changer `innerHeight` (iOS).
    window.visualViewport?.addEventListener('resize', mesurer);
    return () => {
      window.clearInterval(veille);
      window.removeEventListener('resize', mesurer);
      window.removeEventListener('beluga:hauteur-banniere', mesurer);
      window.visualViewport?.removeEventListener('resize', mesurer);
    };
  }, [lire]);
  return mesure;
}

/** Les deux congés rentrants, aux deux bouts du bouton, dessinés contre son bord. */
function cheminDesConges(bord: BordDeLEcran, long: number): string {
  const C = CONGE;
  const L = long;
  const W = EPAIS;
  switch (bord) {
    case 'gauche':
      return `M0 0 Q0 ${C} ${C} ${C} L0 ${C} Z M0 ${L} Q0 ${L - C} ${C} ${L - C} L0 ${L - C} Z`;
    case 'droite':
      return `M${W} 0 Q${W} ${C} ${W - C} ${C} L${W} ${C} Z M${W} ${L} Q${W} ${L - C} ${W - C} ${L - C} L${W} ${L - C} Z`;
    case 'haut':
      return `M0 0 Q${C} 0 ${C} ${C} L${C} 0 Z M${L} 0 Q${L - C} 0 ${L - C} ${C} L${L - C} 0 Z`;
    case 'bas':
    default:
      return `M0 ${W} Q${C} ${W} ${C} ${W - C} L${C} ${W} Z M${L} ${W} Q${L - C} ${W} ${L - C} ${W - C} L${L - C} ${W} Z`;
  }
}

/** Les coins arrondis du côté libre ; carrés du côté du bord. */
function rayonDuBouton(bord: BordDeLEcran): string {
  const r = `${EPAIS / 2}px`;
  switch (bord) {
    case 'gauche':
      return `0 ${r} ${r} 0`;
    case 'droite':
      return `${r} 0 0 ${r}`;
    case 'haut':
      return `0 0 ${r} ${r}`;
    case 'bas':
    default:
      return `${r} ${r} 0 0`;
  }
}

const SANS_CIBLE = () => null;

export function JarvisNatif(p: ProprietesJarvisNatif) {
  const { zone, sol, largeur, hauteur } = useZoneDuBord(p.telephone);
  const [brute, retenir] = usePref<unknown>(p.telephone ? CLE_BORD_TELEPHONE : CLE_BORD_ORDINATEUR, null);
  /* SUR TÉLÉPHONE, LES CÔTÉS SEULEMENT (décision du 20/11/2026, qui remplace « côtés ou haut » du 17/11/2026) : gauche
     ou droite, entre l'en-tête et le menu du bas ; une place ancienne en haut ou en bas revient sur un côté. */
  const options = React.useMemo(() => ({ cotesSeulement: p.telephone }), [p.telephone]);
  const retenue = placeAuBordLue(brute, options);

  /* LE GLISSER : le SEUL de l'application (`usePointerDrag`). Pendant le geste, le bouton se colle déjà au bord le plus
     proche du pointeur ; au lâcher, cette place est retenue. Le clic qui suit un glisser n'ouvre rien. */
  const dernierPoint = React.useRef<{ x: number; y: number } | null>(null);
  const vientDeGlisser = React.useRef(false);
  const mesureRef = React.useRef({ zone, largeur, hauteur, options });
  mesureRef.current = { zone, largeur, hauteur, options };
  const { dragging, pointer, start } = usePointerDrag({
    resolve: SANS_CIBLE,
    onDrop: () => {
      const point = dernierPoint.current;
      dernierPoint.current = null;
      vientDeGlisser.current = true;
      window.setTimeout(() => {
        vientDeGlisser.current = false;
      }, 0);
      if (!point) return;
      const m = mesureRef.current;
      retenir(placeAuLacher(point.x, point.y, m.largeur, m.hauteur, m.zone, m.options));
    },
  });
  if (pointer) dernierPoint.current = pointer;
  const enGlisser = dragging?.kind === 'bouton-du-bord' && !!pointer;
  const place: PlaceAuBord = enGlisser ? placeAuLacher(pointer!.x, pointer!.y, largeur, hauteur, zone, options) : retenue;
  const boite = boiteDuBoutonDeBord(place, zone, largeur, sol);
  const vertical = bordVertical(place.bord);
  const long = vertical ? boite.height : boite.width;

  /* Le volet s'ouvre du côté du bouton : il lit ici son bord et le milieu de sa place. */
  const centre = Math.round(vertical ? boite.top + boite.height / 2 : boite.left + boite.width / 2);
  React.useEffect(() => {
    poserLeBoutonDuBord({ bord: place.bord, centre });
  }, [place.bord, centre]);

  const reduit = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const transition = enGlisser || reduit ? 'none' : 'left 240ms cubic-bezier(.2,.9,.25,1.05), top 240ms cubic-bezier(.2,.9,.25,1.05)';
  const haut = place.bord === 'haut' ? `calc(${boite.top}px + var(--zone-sure-haut, 0px))` : boite.top;
  const attend = p.microOuvert && p.etatReveil === 'attente';
  /* LE BOUTON DEVIENT LA BULLE (17/11/2026, illustration #0666) : tant que la bulle ou le volet est ouvert — et pendant
     le morphing qui l'y transforme puis l'en ramène —, il reste monté (sa boîte se lit) mais ne se voit ni ne se touche. */
  const morphing = useMorphingDuBord();
  const cache = morphing !== 'repos';

  /* SUR TÉLÉPHONE, L'ASSISTANT OUVERT EST UNE FEUILLE DU BAS (17/11/2026) : le bouton ne reste pas posé par-dessus — on
     la referme d'un glissé, de sa croix ou d'un appui sur le voile, et il revient. */
  if (p.telephone && p.voletOuvert) return null;

  return (
    /* L'ENVELOPPE porte les repères du module de voix, lus par les contrôles et par les gestes de Jarvis (qui ne
       jouent jamais sur lui, `[data-module-voix]`) ; `contents` : elle ne pose aucune boîte. AU-DESSUS DES FENÊTRES
       OUVERTES : un appui sur le bouton ne referme pas la fenêtre dessous (`vientDAuDessusDeTout`, ui/index.tsx). */
    <div
      className="contents"
      data-module-voix
      data-etat-reveil={p.etatReveil}
      data-conversation={p.conversation ? '' : undefined}
      data-ouvert={p.voletOuvert ? '' : undefined}
      data-etat-direct={p.etatDirect}
      data-voix-active={p.voixActive ? '' : undefined}
      data-onglet={p.onglet}
      data-telephone={p.telephone ? '' : undefined}
      data-au-dessus-de-tout
    >
      <div
        data-jarvis-natif
        data-languette-jarvis
        data-bord={place.bord}
        data-glisse={enGlisser ? '' : undefined}
        data-morphing={morphing}
        aria-hidden={cache || undefined}
        className="pointer-events-none fixed z-[56]"
        style={{ left: boite.left, top: haut, width: boite.width, height: boite.height, transition, visibility: cache ? 'hidden' : undefined }}
      >
        {/* LES CONGÉS RENTRANTS : deux quarts de creux, aux deux bouts, de la couleur du bouton. */}
        <svg
          aria-hidden
          data-conges-jarvis
          width={boite.width}
          height={boite.height}
          viewBox={`0 0 ${boite.width} ${boite.height}`}
          className="absolute inset-0"
          style={{ color: 'hsl(var(--encre))' }}
        >
          <path d={cheminDesConges(place.bord, long)} fill="currentColor" />
        </svg>
        <button
          type="button"
          aria-label={p.voletOuvert ? 'Fermer l’assistant' : 'Ouvrir l’assistant'}
          aria-expanded={p.voletOuvert}
          title={p.conversation ? t('Arrêter Jarvis') : p.voletOuvert ? t('Fermer l’assistant') : t('Parler à Jarvis — glisser pour le poser sur un autre bord')}
          data-bouton-du-bord
          className={cn(
            'pointer-events-auto absolute flex cursor-grab items-center justify-center bg-[hsl(var(--encre))] text-[hsl(var(--encre-fg))] shadow-lg active:cursor-grabbing',
            !p.voixActive && 'opacity-90',
          )}
          style={{
            left: vertical ? 0 : CONGE,
            top: vertical ? CONGE : 0,
            width: vertical ? EPAIS : long - 2 * CONGE,
            height: vertical ? long - 2 * CONGE : EPAIS,
            borderRadius: rayonDuBouton(place.bord),
            touchAction: 'none',
          }}
          onPointerDown={(event) => {
            if (event.button !== undefined && event.button !== 0) return;
            start(event, { id: 'bouton-du-bord', kind: 'bouton-du-bord', label: 'Assistant' });
          }}
          onClick={() => {
            if (vientDeGlisser.current) {
              vientDeGlisser.current = false;
              return;
            }
            p.onToucher();
          }}
        >
          {/* La cible tactile déborde du bouton visible (30 px) : 44 × 44 au moins, sur les DEUX axes, sans rien
              dessiner de plus. */}
          <span
            aria-hidden
            data-cible-du-bord
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
            style={{ width: CIBLE, height: CIBLE }}
          />
          {/* JARVIS TRAVAILLE (décision de l'utilisateur, 20/11/2026) : hors conversation, un rond de chargement remplace les
              trois barres tant que son travail dure — veille comprise. Même icône que le reste de l'application. */}
          {p.travaille && !p.conversation ? (
            <Loader2 data-jarvis-travaille aria-hidden className="h-[18px] w-[18px] animate-spin" />
          ) : (
            <IconeTroisBarres vivante={p.conversation} />
          )}
          {!p.voletOuvert && (p.questions ?? 0) > 0 ? (
            /* DANS l'arrondi du « D », au-dessus de la barre de droite, sans toucher celle du milieu (côté gauche
               quand le bouton est au bord droit, l'arrondi y étant à gauche). */
            <span
              aria-hidden
              data-assistant-question
              className="absolute h-1.5 w-1.5 rounded-full bg-warning"
              style={{ top: 3, left: place.bord === 'droite' ? 5 : EPAIS - 11 }}
            />
          ) : null}
          {attend ? (
            <span
              aria-hidden
              data-attente-du-mot
              className="absolute h-[3px] w-[3px] rounded-full bg-[hsl(var(--encre-fg))]"
              style={{ top: 3, left: '50%', marginLeft: -1.5 }}
            />
          ) : null}
        </button>
      </div>
    </div>
  );
}
