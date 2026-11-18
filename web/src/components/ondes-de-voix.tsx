import * as React from 'react';
import { cn } from '@/lib/utils';

/*
 * LES ONDES DE JARVIS (carte « Jarvis : volet, voix et rapidité », décisions de l'utilisateur du 16/11/2026).
 *
 * UN SEUL DESSIN pour tout ce qui dit « la voix » : des barres ARRONDIES de MÊME LARGEUR, qui ne changent que de
 * hauteur. L'icône du bouton du bord en compte trois (petite, moyenne, petite) ; la barre d'ondes du volet de
 * l'assistant, en mode voix, en étale une rangée qui suit le son — JAUNE quand vous parlez (`--voix-vous`), BLEUE
 * quand Jarvis parle (`--voix-jarvis`), grise et presque plate dans le silence.
 *
 * Rien ici n'écoute le son : le lecteur vient du module de voix (`lib/etat-vocal.ts`, `lecteur`), qui tient le micro
 * et la voix de Codex. Ce fichier reste léger : le volet de l'assistant l'emporte sans tirer le module de voix.
 */

/** La largeur commune de chaque barre et l'air entre elles, en px. */
export const LARGEUR_D_UNE_BARRE = 4;

/**
 * L'ICÔNE À TROIS BARRES DU BOUTON DU BORD : petite, moyenne, petite, toutes de la même largeur. `vivante` : elles
 * ondulent doucement (une conversation vocale est en cours).
 */
export function IconeTroisBarres({ vivante = false, className }: { vivante?: boolean; className?: string }) {
  return (
    <span data-icone-trois-barres aria-hidden className={cn('flex items-center gap-[3px]', className)}>
      {[7, 13, 7].map((hauteur, i) => (
        <span
          key={i}
          className={cn('shrink-0 origin-center rounded-full bg-current', vivante && 'animate-onde')}
          style={{ width: LARGEUR_D_UNE_BARRE, height: hauteur, ...(vivante ? { animationDelay: `${i * 120}ms` } : {}) }}
        />
      ))}
    </span>
  );
}

/** Combien de barres porte la barre d'ondes : un nombre IMPAIR, pour qu'une barre tienne le centre (le morphing y naît). */
export const BARRES = 29;
/** La hauteur pleine d'une barre de l'onde, en px (`h-10`). */
const HAUTEUR_D_UNE_BARRE = 40;
/** L'échelle d'une barre au repos : un point (largeur = hauteur). */
const ECHELLE_AU_REPOS = 0.12;

type Lecteur = ((nombre: number) => { niveaux: number[] | null; qui: 'jarvis' | 'vous' | null }) | null;

/** Où en est l'onde : le cercle tourne (« connexion »), le trait se transforme (« morphing »), l'onde vit (« ecoute »). */
export type EtatDeLOnde = 'connexion' | 'morphing' | 'ecoute';

/*
 * LE MORPHING, UN SEUL TRAIT (maquette #ff70 validée par l'utilisateur, 17/11/2026). Le cercle de chargement a le TRAIT
 * D'UNE BARRE (4 px, bouts ronds). À l'écoute réelle : l'arc cesse de tourner et se déplie — sa courbure tombe à zéro —
 * jusqu'à devenir la barre centrale ; deux barres en SORTENT de chaque côté (petite-grande-petite, comme l'icône) ; puis
 * des POINTS naissent au centre et s'étalent vers les bords, chacun pile à la place d'une barre de l'onde ; enfin la
 * vraie onde prend le relais, partant des mêmes hauteurs : aucun saut. Tout se dessine à la main, image par image, sur
 * un seul chemin SVG (aucun re-rendu React).
 */
export const RAYON_DU_CERCLE = 12;
export const LONGUEUR_DE_L_ARC = 2 * Math.PI * RAYON_DU_CERCLE * 0.75;
const DUREES = { arret: 160, deplier: 220, sortir: 280, points: 460 } as const;
/** Un tour du cercle de chargement en 0,9 s : la même vitesse dans la bulle et dans le morphing du bouton. */
export const VITESSE_DU_CERCLE = (2 * Math.PI) / 900;
export const HAUTEUR_CENTRALE = 32;
export const HAUTEUR_LATERALE = 18;

/**
 * L'ANGLE DU CERCLE DE CHARGEMENT, PARTAGÉ (17/11/2026) : le morphing du bouton du bord (`lib/morphing-du-bord.ts`)
 * fait tourner le même cercle avant que la bulle ne s'affiche ; la bulle le reprend là où il en était, sans à-coup.
 */
export const cercleDeLaVoix = { phi: 0 };

export const adoucir = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : 1 - Math.pow(1 - x, 3));
const borne = (x: number) => Math.min(1, Math.max(0, x));

/** Un trait vertical de hauteur TOTALE `h` (bouts ronds compris), centré en (x, cy). */
export function trait(x: number, cy: number, h: number): string {
  const demi = Math.max(0, h - LARGEUR_D_UNE_BARRE) / 2;
  return `M${x.toFixed(2)} ${(cy - demi).toFixed(2)}L${x.toFixed(2)} ${(cy + demi + 0.001).toFixed(2)}`;
}

/**
 * L'ARC QUI SE DÉPLIE : un arc de longueur `l`, de courbure `k`, dont le milieu reste au centre et part vers le haut,
 * tourné de `phi`. À `k` = 1/rayon il fait les trois quarts d'un cercle centré sur (cx, cy) ; à `k` = 0, un trait.
 */
export function arc(cx: number, cy: number, k: number, l: number, phi: number): string {
  const decalage = k > 1e-4 ? RAYON_DU_CERCLE * (k * RAYON_DU_CERCLE) : 0;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const morceaux: string[] = [];
  const PAS = 24;
  for (let i = 0; i <= PAS; i += 1) {
    const sgm = -l / 2 + (l * i) / PAS;
    const x0 = k > 1e-4 ? decalage - (1 - Math.cos(k * sgm)) / k : 0;
    const y0 = k > 1e-4 ? -Math.sin(k * sgm) / k : -sgm;
    const x = cx + x0 * cos - y0 * sin;
    const y = cy + x0 * sin + y0 * cos;
    morceaux.push(`${i ? 'L' : 'M'}${x.toFixed(2)} ${y.toFixed(2)}`);
  }
  return morceaux.join('');
}

export function mouvementReduit(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

/**
 * LA BARRE D'ONDES DU MODE VOIX, à la place de la zone d'écriture. Les hauteurs sont posées à la main à chaque image
 * (aucun re-rendu), lissées ; la couleur suit qui parle. `data-qui-parle` (« vous », « jarvis », vide) est lu par les
 * contrôles, `data-voix-etat` (« connexion », « morphing », « ecoute ») aussi. `connexion` vrai : le cercle tourne ;
 * passé à faux, le cercle se transforme en onde (jamais avant l'écoute réelle). `sansMorphing` (une erreur) : l'onde
 * au repos, sans cercle ni transformation.
 */
export function OndesDuDirect({ lecteur, connexion = false, sansMorphing = false }: { lecteur: Lecteur; connexion?: boolean; sansMorphing?: boolean }) {
  const conteneurRef = React.useRef<HTMLDivElement | null>(null);
  const barresRef = React.useRef<(HTMLSpanElement | null)[]>([]);
  const cheminRef = React.useRef<SVGPathElement | null>(null);
  const svgRef = React.useRef<SVGSVGElement | null>(null);
  const lecteurRef = React.useRef(lecteur);
  lecteurRef.current = lecteur;
  const [etat, setEtat] = React.useState<EtatDeLOnde>(() => (connexion && !sansMorphing ? 'connexion' : 'ecoute'));
  /* Les échelles de départ de l'onde vivante : celles où le morphing s'est arrêté. */
  const departRef = React.useRef<number[] | null>(null);
  /* L'angle du cercle qui tourne : gardé d'un état à l'autre, l'arc s'arrête là où il était. */
  const phiRef = React.useRef(cercleDeLaVoix.phi);

  // La connexion aboutie lance le morphing ; une erreur le saute.
  React.useEffect(() => {
    if (sansMorphing) setEtat('ecoute');
    else if (connexion) setEtat('connexion');
    else setEtat((e) => (e === 'connexion' ? (mouvementReduit() ? 'ecoute' : 'morphing') : e));
  }, [connexion, sansMorphing]);

  /* LE CERCLE ET SA TRANSFORMATION, image par image, sur le seul chemin SVG. */
  React.useEffect(() => {
    if (etat === 'ecoute') return;
    const svg = svgRef.current;
    const chemin = cheminRef.current;
    const el = conteneurRef.current;
    if (!svg || !chemin || !el) return;
    const boite = el.getBoundingClientRect();
    const cy = boite.height / 2;
    // Les centres exacts des barres de l'onde : le morphing atterrit dessus.
    const xs = barresRef.current.map((b) => {
      if (!b) return boite.width / 2;
      const r = b.getBoundingClientRect();
      return r.left - boite.left + r.width / 2;
    });
    const milieu = (BARRES - 1) / 2;
    const cx = xs[milieu] ?? boite.width / 2;
    let image = 0;
    let avant = performance.now();
    const debut = performance.now();
    const phiAuDepart = phiRef.current;
    const VITESSE = VITESSE_DU_CERCLE;
    const boucle = (maintenant: number) => {
      const dt = maintenant - avant;
      avant = maintenant;
      if (etat === 'connexion') {
        phiRef.current = (phiRef.current + VITESSE * dt) % (2 * Math.PI);
        cercleDeLaVoix.phi = phiRef.current;
        chemin.setAttribute('d', arc(cx, cy, 1 / RAYON_DU_CERCLE, LONGUEUR_DE_L_ARC, phiRef.current));
        image = requestAnimationFrame(boucle);
        return;
      }
      // LE MORPHING : le temps écoulé depuis l'écoute réelle.
      const t = maintenant - debut;
      const tArret = borne(t / DUREES.arret);
      const tDeplier = borne((t - DUREES.arret * 0.4) / DUREES.deplier);
      const tSortir = borne((t - DUREES.arret * 0.4 - DUREES.deplier) / DUREES.sortir);
      const tPoints = borne((t - DUREES.arret * 0.4 - DUREES.deplier - DUREES.sortir * 0.6) / DUREES.points);
      // 1) L'arc cesse de tourner : il finit son tour, son milieu à droite du centre, ouverture à gauche.
      const phiCible = Math.ceil(phiAuDepart / (2 * Math.PI)) * 2 * Math.PI;
      const angle = phiAuDepart + (phiCible - phiAuDepart) * adoucir(tArret);
      // 2) Il se déplie : sa courbure tombe à zéro et sa longueur devient celle de la barre centrale.
      const d = adoucir(tDeplier);
      const k = (1 / RAYON_DU_CERCLE) * (1 - d);
      const hCentre = LONGUEUR_DE_L_ARC + (HAUTEUR_CENTRALE - LARGEUR_D_UNE_BARRE - LONGUEUR_DE_L_ARC) * d;
      let dessin = arc(cx, cy, k, hCentre, angle);
      // 3) Deux barres sortent de la barre centrale, de chaque côté.
      const s = adoucir(tSortir);
      const p = tPoints;
      const ecart = (xs[milieu + 1] ?? cx + 10) - cx;
      if (s > 0) {
        const hLat = LARGEUR_D_UNE_BARRE + (HAUTEUR_LATERALE - LARGEUR_D_UNE_BARRE) * s;
        dessin += trait(cx - ecart * s, cy, hLat) + trait(cx + ecart * s, cy, hLat);
      }
      // 4) Des points naissent au centre et s'étalent vers les bords, chacun vers la place de sa barre.
      if (p > 0) {
        for (let i = 0; i < BARRES; i += 1) {
          const rang = Math.abs(i - milieu);
          if (rang <= 1) continue;
          // Les plus proches partent d'abord : la vague s'étale, et le dernier point arrive pile à la fin.
          const depart = ((rang - 2) / Math.max(1, milieu - 2)) * 0.55;
          const pi = adoucir(borne((tPoints - depart) / 0.45));
          if (pi <= 0) continue;
          const xDepart = cx + Math.sign(i - milieu) * ecart;
          dessin += trait(xDepart + (xs[i]! - xDepart) * pi, cy, LARGEUR_D_UNE_BARRE);
        }
      }
      chemin.setAttribute('d', dessin);
      // La couleur glisse du texte vers celle de l'onde au repos pendant que les points s'étalent.
      if (p > 0 && !svg.dataset.fondu) {
        svg.dataset.fondu = '1';
        svg.style.color = 'hsl(var(--faint))';
      }
      if (tPoints >= 1) {
        // 5) L'onde vivante prend le relais, depuis les mêmes hauteurs.
        departRef.current = Array.from({ length: BARRES }, (_, i) => {
          const rang = Math.abs(i - milieu);
          const h = rang === 0 ? HAUTEUR_CENTRALE : rang === 1 ? HAUTEUR_LATERALE : LARGEUR_D_UNE_BARRE;
          return h / HAUTEUR_D_UNE_BARRE;
        });
        setEtat('ecoute');
        return;
      }
      image = requestAnimationFrame(boucle);
    };
    image = requestAnimationFrame(boucle);
    return () => cancelAnimationFrame(image);
  }, [etat]);

  /* L'ONDE VIVANTE. */
  React.useEffect(() => {
    if (etat !== 'ecoute') return;
    let image = 0;
    const depart = departRef.current;
    departRef.current = null;
    const lisse = new Array<number>(BARRES).fill(0).map((_, i) => (depart ? Math.max(0, (depart[i]! - ECHELLE_AU_REPOS) / (1 - ECHELLE_AU_REPOS)) : 0));
    let qui: 'jarvis' | 'vous' | null = null;
    let silenceDepuis = 0;
    const boucle = () => {
      const lu = lecteurRef.current?.(BARRES) ?? { niveaux: null, qui: null };
      // Le dernier qui a parlé garde sa couleur un court instant : les barres ne clignotent pas entre deux syllabes.
      const maintenant = performance.now();
      if (lu.qui) {
        qui = lu.qui;
        silenceDepuis = maintenant;
      } else if (maintenant - silenceDepuis > 700) {
        qui = null;
      }
      const el = conteneurRef.current;
      if (el && el.dataset.quiParle !== (qui ?? '')) {
        el.dataset.quiParle = qui ?? '';
        el.style.color = qui === 'jarvis' ? 'hsl(var(--voix-jarvis))' : qui === 'vous' ? 'hsl(var(--voix-vous))' : 'hsl(var(--faint))';
      }
      for (let i = 0; i < BARRES; i += 1) {
        // Les barres du milieu portent les fréquences de la voix ; les bords restent plus calmes.
        const source = lu.niveaux ? lu.niveaux[Math.abs(i - (BARRES - 1) / 2) % lu.niveaux.length] ?? 0 : 0;
        lisse[i] += (source - lisse[i]) * (depart ? 0.12 : 0.35);
        const barre = barresRef.current[i];
        if (barre) barre.style.transform = `scaleY(${(ECHELLE_AU_REPOS + (1 - ECHELLE_AU_REPOS) * Math.min(1, lisse[i])).toFixed(3)})`;
      }
      image = requestAnimationFrame(boucle);
    };
    image = requestAnimationFrame(boucle);
    return () => cancelAnimationFrame(image);
  }, [etat]);

  const enOnde = etat === 'ecoute';
  return (
    <div
      ref={conteneurRef}
      data-ondes-du-volet
      data-voix-etat={etat}
      data-qui-parle=""
      aria-hidden
      className="relative flex h-12 w-full items-center justify-between px-1"
      style={{ color: 'hsl(var(--faint))' }}
    >
      {Array.from({ length: BARRES }, (_, i) => (
        <span
          key={i}
          ref={(el) => {
            barresRef.current[i] = el;
          }}
          className="h-10 shrink-0 origin-center rounded-full bg-current transition-colors duration-200"
          style={{ width: LARGEUR_D_UNE_BARRE, transform: `scaleY(${ECHELLE_AU_REPOS})`, opacity: enOnde ? 1 : 0 }}
        />
      ))}
      {!enOnde ? (
        <svg
          ref={svgRef}
          data-morphing-de-la-voix
          className="pointer-events-none absolute inset-0 h-full w-full overflow-visible transition-[color] duration-300"
          style={{ color: 'hsl(var(--text))' }}
        >
          <path ref={cheminRef} d="" fill="none" stroke="currentColor" strokeWidth={LARGEUR_D_UNE_BARRE} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : null}
    </div>
  );
}
