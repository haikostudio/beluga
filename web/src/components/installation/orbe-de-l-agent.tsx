import * as React from 'react';
import { cn } from '@/lib/utils';

/*
 * L'ORBE DE L'AGENT (carte « Assistant d'installation et Jarvis », 20/11/2026) — PORTAGE de la boule d'appel
 * d'ProjetA (dépôt projeta-vps, web/components/chat/VoiceOrb.vue ; son portage vitrine projeta-saas BouleVoix.vue a le
 * même shader). Les dépôts sont séparés, aucun import croisé : GARDER EN PHASE avec VoiceOrb.vue — même shader,
 * mêmes lissages, mêmes tailles. Seuls écarts :
 *   - COULEURS : noir, blanc et gris au lieu du violet. Les quatre teintes sont lues dans les jetons du thème
 *     (`--raised` → `--faint` → `--muted` → `--text`), sur l'orbe lui-même, puis ramenées à leur seule
 *     LUMINOSITÉ : l'orbe reste gris dans les douze palettes, disque clair et fumée noire en clair, l'inverse en
 *     sombre. Relues quand le thème change (attributs de <html>).
 *   - NIVEAU : pas de voix pendant la mise en route ; c'est l'écriture de l'agent qui le donne (`level`).
 *
 * Un disque rempli d'une fumée qui monte et s'intensifie avec le niveau (lu à chaque image, sans rendu React).
 * Au repos, il respire lentement ; « thinking », plus vite. Plus le niveau est fort, plus il RÉTRÉCIT (75 %).
 * FLUIDITÉ : la phase de montée est INTÉGRÉE image après image (`phase += dt * vitesse`), jamais `t * vitesse`,
 * qui téléportait la fumée à chaque variation. Coût borné : 1,2 px rendu par px CSS au plus, bruit à 4 octaves.
 * La boucle s'arrête onglet caché ou orbe hors écran ; le contexte WebGL est recréé s'il est perdu et libéré au
 * démontage (iOS en limite le nombre). Repli (WebGL absent, mouvement réduit demandé) : un disque en dégradé gris.
 */

const VERT = `
attribute vec2 p;
varying vec2 uv;
void main() { uv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }
`;

const FRAG = `
precision highp float;
varying vec2 uv;
uniform float t;
uniform float lvl;
uniform float ph;
uniform float px;
uniform vec3 c0; uniform vec3 c1; uniform vec3 c2; uniform vec3 c3;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0; float a = 0.5;
  for (int k = 0; k < 4; k++) { v += a * noise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
  return v;
}

void main() {
  vec2 q = uv * 2.0 - 1.0;
  float r = length(q);
  float disc = 1.0 - smoothstep(1.0 - px * 2.0, 1.0, r);
  if (disc <= 0.0) { gl_FragColor = vec4(0.0); return; }

  vec2 w = vec2(fbm(q * 1.6 + vec2(0.0, -ph)), fbm(q * 1.6 + vec2(5.2, -ph * 1.3)));
  float smoke = fbm(q * 2.2 + w * 1.8 + vec2(t * 0.05, -ph * 1.6));
  float crest = -0.55 + lvl * 0.95 + (fbm(vec2(q.x * 2.4, t * 0.35)) - 0.5) * 0.55;
  float body = smoothstep(crest + 0.5, crest - 0.35, q.y);
  float wisp = smoothstep(0.42, 0.78, smoke) * smoothstep(crest + 0.95 + lvl * 0.3, crest - 0.1, q.y);
  float d = clamp(body * (0.3 + smoke * 1.15) + wisp * (0.45 + lvl * 0.4), 0.0, 1.0);
  d = pow(d, 1.25 - lvl * 0.45);

  vec3 col = mix(c0, c1, smoothstep(0.0, 0.35, d));
  col = mix(col, c2, smoothstep(0.3, 0.7, d));
  col = mix(col, c3, smoothstep(0.65, 1.0, d));
  gl_FragColor = vec4(col * disc, disc);
}
`;

/** Pixels rendus par pixel CSS, au plus : au-delà, on paie sans rien voir. */
const MAX_RENDER_SCALE = 1.2;
/** Taille au niveau maximal. */
const MIN_SCALE = 0.75;
/** Les jetons lus, du fond du disque à la fumée la plus dense. */
const JETONS = ['--raised', '--faint', '--muted', '--text'] as const;

/** La luminosité (0..1) d'un jeton « h s% l% » : l'orbe n'en garde que le gris. */
export function grisDuJeton(valeur: string, repli: number): number {
  const parts = valeur.trim().split(/[\s,/]+/);
  const l = parseFloat(parts[2] ?? '');
  return Number.isFinite(l) ? Math.max(0, Math.min(1, l / 100)) : repli;
}

export type HumeurDeLOrbe = 'idle' | 'thinking' | 'speaking';

export function OrbeDeLAgent({
  level,
  mood = 'idle',
  className,
}: {
  /** Niveau 0..1, lu à chaque image. */
  level: () => number;
  mood?: HumeurDeLOrbe;
  className?: string;
}) {
  const racine = React.useRef<HTMLDivElement | null>(null);
  const toile = React.useRef<HTMLCanvasElement | null>(null);
  const [repli, setRepli] = React.useState(false);
  const [pret, setPret] = React.useState(false);
  const humeur = React.useRef(mood);
  humeur.current = mood;
  const niveau = React.useRef(level);
  niveau.current = level;

  React.useEffect(() => {
    const el = toile.current;
    const boite = racine.current;
    if (!el || !boite) return;
    let gl: WebGLRenderingContext | null = null;
    let prog: WebGLProgram | null = null;
    let uni: Record<string, WebGLUniformLocation | null> = {};
    let raf = 0;
    let derniere = 0;
    let phase = 0;
    let vol = 0;
    let lisse = 0;
    let visible = false;
    let essaye = false;
    let premiereImage = false;
    const debut = performance.now();

    const appliquerLesCouleurs = () => {
      if (!gl) return;
      const style = getComputedStyle(boite);
      const replis = [0.13, 0.52, 0.7, 0.93];
      JETONS.forEach((jeton, i) => {
        const g = grisDuJeton(style.getPropertyValue(jeton), replis[i]!);
        gl!.uniform3f(uni[`c${i}`]!, g, g, g);
      });
    };

    const compiler = (type: number, src: string) => {
      const sh = gl!.createShader(type);
      if (!sh) return null;
      gl!.shaderSource(sh, src);
      gl!.compileShader(sh);
      return gl!.getShaderParameter(sh, gl!.COMPILE_STATUS) ? sh : null;
    };

    const init = (): boolean => {
      gl = el.getContext('webgl', { premultipliedAlpha: true, antialias: false, alpha: true });
      if (!gl) return false;
      const vs = compiler(gl.VERTEX_SHADER, VERT);
      const fs = compiler(gl.FRAGMENT_SHADER, FRAG);
      if (!vs || !fs) return false;
      prog = gl.createProgram()!;
      gl.attachShader(prog, vs);
      gl.attachShader(prog, fs);
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return false;
      gl.useProgram(prog);
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(prog, 'p');
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      uni = Object.fromEntries(['t', 'lvl', 'ph', 'px', 'c0', 'c1', 'c2', 'c3'].map((n) => [n, gl!.getUniformLocation(prog!, n)]));
      appliquerLesCouleurs();
      return true;
    };

    const niveauSuivant = (dt: number) => {
      let cible = 0;
      try {
        cible = Math.max(0, Math.min(1, niveau.current() || 0));
      } catch {
        cible = 0;
      }
      // Taille : attaque ~80 ms, relâche ~250 ms, indépendant de la cadence.
      const tau = cible > vol ? 0.08 : 0.25;
      vol += (cible - vol) * (1 - Math.exp(-dt / tau));
      // Respiration lente au repos, plus vive pendant la réflexion.
      const s = performance.now() / 1000;
      const souffle = humeur.current === 'thinking' ? 0.16 + 0.08 * Math.sin(s * 2.2) : 0.06 + 0.04 * Math.sin(s * 1.1);
      cible = Math.max(cible, souffle);
      // Attaque rapide, relâche lente : la fumée ne clignote pas.
      const k = cible > lisse ? 0.35 : 0.05;
      lisse += (cible - lisse) * k;
      return lisse;
    };

    const image = () => {
      raf = 0;
      if (document.hidden || !visible) return;
      const maintenant = performance.now();
      const dt = derniere ? Math.min(0.05, (maintenant - derniere) / 1000) : 0;
      derniere = maintenant;
      const lvl = niveauSuivant(dt);
      phase += dt * (0.18 + lvl * 0.55);
      boite.style.transform = `scale(${(1 - (1 - MIN_SCALE) * Math.min(1, Math.sqrt(vol))).toFixed(3)})`;
      boite.dataset.niveau = vol.toFixed(2);
      if (gl) {
        const dpr = Math.min(MAX_RENDER_SCALE, window.devicePixelRatio || 1);
        const w = Math.round(el.clientWidth * dpr);
        const h = Math.round(el.clientHeight * dpr);
        if (el.width !== w || el.height !== h) {
          el.width = w;
          el.height = h;
        }
        gl.viewport(0, 0, w, h);
        gl.uniform1f(uni.t!, (maintenant - debut) / 1000);
        gl.uniform1f(uni.lvl!, lvl);
        gl.uniform1f(uni.ph!, phase);
        gl.uniform1f(uni.px!, 2 / Math.max(1, w));
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        if (!premiereImage) {
          premiereImage = true;
          setPret(true);
        }
      }
      raf = requestAnimationFrame(image);
    };

    const boucle = () => {
      derniere = 0;
      if (!raf && !document.hidden && visible) raf = requestAnimationFrame(image);
    };
    const arret = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    };
    const surVisibilite = () => (document.hidden ? arret() : boucle());
    const surPerte = (e: Event) => {
      e.preventDefault();
      arret();
    };
    const surRetour = () => {
      if (init()) boucle();
    };

    const demarrer = () => {
      if (essaye) return;
      essaye = true;
      const reduit = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      if (reduit || !init()) {
        setRepli(true);
        return;
      }
      el.addEventListener('webglcontextlost', surPerte);
      el.addEventListener('webglcontextrestored', surRetour);
    };

    const montrer = (oui: boolean) => {
      visible = oui;
      if (!oui) {
        arret();
        return;
      }
      demarrer();
      boucle();
    };

    document.addEventListener('visibilitychange', surVisibilite);
    // Le thème change : les teintes se relisent (data-theme, classe dark, attributs de zone).
    const observateur = new MutationObserver(() => appliquerLesCouleurs());
    observateur.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme', 'style'] });
    let io: IntersectionObserver | null = null;
    if (typeof IntersectionObserver === 'undefined') montrer(true);
    else {
      io = new IntersectionObserver((entrees) => {
        const e = entrees[entrees.length - 1];
        if (e) montrer(e.isIntersecting);
      });
      io.observe(boite);
    }

    return () => {
      arret();
      io?.disconnect();
      observateur.disconnect();
      document.removeEventListener('visibilitychange', surVisibilite);
      el.removeEventListener('webglcontextlost', surPerte);
      el.removeEventListener('webglcontextrestored', surRetour);
      // Libère le contexte tout de suite (iOS en limite le nombre).
      gl?.getExtension('WEBGL_lose_context')?.loseContext();
      gl = null;
    };
  }, []);

  return (
    <div
      ref={racine}
      className={cn('relative aspect-square will-change-transform', className)}
      data-orbe-de-l-agent
      data-humeur={mood}
      data-orbe-repli={repli || undefined}
      aria-hidden="true"
    >
      <canvas ref={toile} className={cn('absolute inset-0 h-full w-full rounded-full', (repli || !pret) && 'invisible')} />
      {repli || !pret ? (
        <span
          className="absolute inset-0 rounded-full"
          style={{
            background:
              'radial-gradient(120% 90% at 50% 110%, hsl(var(--text)) 0%, hsl(var(--muted)) 35%, hsl(var(--faint)) 60%, hsl(var(--raised)) 100%)',
            filter: 'saturate(0)',
          }}
        />
      ) : null}
    </div>
  );
}
