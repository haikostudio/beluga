/**
 * LA FABRICATION SUR LE SERVEUR (décision de l'utilisateur du 26/10/2026) —
 * l'agent choisi pour la conception ÉCRIT la vidéo (une page HTML pilotée par
 * une chronologie GSAP en pause, format HyperFrames) et le serveur la REND en
 * MP4 ou en image, sans service extérieur : coût 0, aucun devis.
 *
 * Les règles pures vivent ici : la capacité déclarée par les plans, les tailles
 * des formats, les bibliothèques servies EN LOCAL (copies épinglées sous
 * `outils/bibliotheques-de-composition/`, aucun chargement réseau pendant le
 * rendu), le squelette de départ, la mise au format et le contrôle de
 * déterminisme. Le disque et les commandes vivent dans `server/src/composition.ts`.
 */

import type { FormatDeMedia } from './services-de-generation.js';

/** La capacité d'un plan fabriqué par composition (ligne « Capacité : composition »), toujours branchée quand le moteur l'est. */
export const CAPACITE_COMPOSITION = 'composition';

export const DIMENSIONS_DES_FORMATS: Readonly<Record<FormatDeMedia, { largeur: number; hauteur: number }>> = {
  '9:16': { largeur: 1080, hauteur: 1920 },
  '1:1': { largeur: 1080, hauteur: 1080 },
  '4:5': { largeur: 1080, hauteur: 1350 },
  '16:9': { largeur: 1920, hauteur: 1080 },
};

export interface BibliothequeDeComposition {
  id: string;
  nom: string;
  version: string;
  licence: string;
  /** Le dossier sous `outils/bibliotheques-de-composition/` (copié en `lib/<id>/`). Absent : fourni par le serveur (GSAP). */
  dossier?: string;
  /** La balise à poser dans la page, chemins relatifs à la composition. */
  balise: string;
  /** À quoi elle sert, et comment la piloter par le temps. */
  usage: string;
}

/**
 * LES BIBLIOTHÈQUES SERVIES EN LOCAL, versions épinglées (relevées sur npm le
 * 26/10/2026). Une copie par composition, seulement celles demandées.
 */
export const BIBLIOTHEQUES_DE_COMPOSITION: readonly BibliothequeDeComposition[] = [
  { id: 'gsap', nom: 'GSAP', version: 'celle du serveur', licence: 'licence GSAP (gratuite)', balise: '<script src="lib/gsap.min.js"></script>', usage: 'la chronologie maîtresse, toujours là : `gsap.timeline({ paused: true })` posée sur `window.__timelines[id]`' },
  { id: 'three', nom: 'Three.js', version: '0.186.1', licence: 'MIT', dossier: 'three', balise: '<script type="importmap">{"imports":{"three":"./lib/three/three.module.js"}}</script>', usage: '3D : `import * as THREE from "three"` dans un `<script type="module">`, rendre dans l’`onUpdate` de la chronologie (temps = `tl.time()`), `preserveDrawingBuffer: true`' },
  { id: 'pixi', nom: 'PixiJS', version: '8.22.0', licence: 'MIT', dossier: 'pixi', balise: '<script src="lib/pixi/pixi.min.js"></script>', usage: '2D rapide (sprites, pixel art) : `await app.init({ autoStart: false, preserveDrawingBuffer: true })`, `app.render()` dans l’`onUpdate`' },
  { id: 'matter', nom: 'Matter.js', version: '0.20.0', licence: 'MIT', dossier: 'matter', balise: '<script src="lib/matter/matter.min.js"></script>', usage: 'physique 2D : `Engine.update(moteur, 1000/60)` à pas fixe jusqu’au temps voulu, jamais `Runner`' },
  { id: 'rapier', nom: 'Rapier 3D', version: '0.21.0', licence: 'Apache-2.0', dossier: 'rapier', balise: '<!-- Rapier : import RAPIER from "./lib/rapier/rapier.mjs"; await RAPIER.init(); -->', usage: 'physique 3D : `world.step()` à pas fixe 1/60 jusqu’au temps voulu' },
  { id: 'ogl', nom: 'OGL', version: '1.0.11', licence: 'Unlicense', dossier: 'ogl', balise: '<!-- OGL : import { Renderer, Program, Mesh, Triangle } from "./lib/ogl/src/index.js"; -->', usage: 'shaders légers : uniforme de temps = `tl.time()`' },
  { id: 'tsparticles', nom: 'tsParticles', version: '4.5.0', licence: 'MIT', dossier: 'tsparticles', balise: '<script src="lib/tsparticles/tsparticles.slim.bundle.min.js"></script>', usage: 'particules pour un site ; dans une vidéo, recalculer les particules en fonction du temps (graine fixe) plutôt que le laisser jouer' },
  { id: 'anime', nom: 'Anime.js', version: '4.5.0', licence: 'MIT', dossier: 'anime', balise: '<script src="lib/anime/anime.umd.min.js"></script>', usage: '`autoplay: false`, puis `a.seek(tl.time() * 1000)` dans l’`onUpdate`' },
  { id: 'p5', nom: 'p5.js', version: '2.3.4', licence: 'LGPL-2.1 (servie telle quelle)', dossier: 'p5', balise: '<script src="lib/p5/p5.min.js"></script>', usage: 'génératif : mode instance, `noLoop()`, `randomSeed`/`noiseSeed`, `redraw()` dans l’`onUpdate`' },
  { id: 'paper', nom: 'Paper.js', version: '0.16.0', licence: 'MIT', dossier: 'paper', balise: '<script src="lib/paper/paper-full.min.js"></script>', usage: 'chemins vectoriels : reconstruire l’état à l’instant t, puis `paper.view.update()`' },
  { id: 'tone', nom: 'Tone.js', version: '15.1.22', licence: 'MIT', dossier: 'tone', balise: '<script src="lib/tone/Tone.js"></script>', usage: 'sons et musique : fabriqués À PART en fichier (action « sons »), jamais joués pendant le rendu' },
  { id: 'gl-transitions', nom: 'GL Transitions', version: '2.0.0', licence: 'MIT', dossier: 'gl-transitions', balise: '<!-- GL Transitions : fetch interdit pendant le rendu — recopier le GLSL voulu depuis lib/gl-transitions/gl-transitions.json -->', usage: 'transitions par shader entre deux plans' },
];

/** Les bibliothèques demandées, connues seulement, GSAP toujours en tête. */
export function bibliothequesDemandees(brut: unknown): BibliothequeDeComposition[] {
  const ids = Array.isArray(brut) ? brut.map(String) : String(brut ?? '').split(',');
  const voulues = new Set(['gsap', ...ids.map((x) => x.trim().toLowerCase()).filter(Boolean)]);
  return BIBLIOTHEQUES_DE_COMPOSITION.filter((b) => voulues.has(b.id));
}

/** L'identifiant de composition (`data-composition-id`) tiré d'un nom de plan. */
export function idDeComposition(plan: string): string {
  const base = plan
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return base || 'composition';
}

/**
 * LE SQUELETTE DE DÉPART : une page qui se rend déjà (un fond, un titre qui
 * arrive), avec les polices embarquées et les bibliothèques demandées. L'agent
 * le réécrit entièrement ; il y trouve la forme exacte attendue par le moteur.
 */
export function squeletteDeComposition(e: { id: string; format: FormatDeMedia; duree: number; titre: string; bibliotheques: readonly BibliothequeDeComposition[]; feuilleDesPolices: string }): string {
  const { largeur, hauteur } = DIMENSIONS_DES_FORMATS[e.format];
  const duree = Math.max(0.5, Math.round(e.duree * 100) / 100);
  const titre = e.titre.replace(/[<>&]/g, '');
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="connect-src 'none'">
<style>
${e.feuilleDesPolices}
html, body { margin: 0; padding: 0; background: #0b0b12; }
#root { position: relative; width: ${largeur}px; height: ${hauteur}px; overflow: hidden; font-family: 'Inter', sans-serif; color: #fff; }
.plein { position: absolute; inset: 0; }
#titre { position: absolute; left: 8%; right: 8%; top: 42%; font-family: 'Bebas Neue', sans-serif; font-size: ${Math.round(largeur / 9)}px; line-height: 1; }
</style>
${e.bibliotheques.map((b) => b.balise).join('\n')}
</head>
<body>
<div id="root" data-composition-id="${e.id}" data-start="0" data-duration="${duree}" data-width="${largeur}" data-height="${hauteur}">
  <div id="fond" class="clip plein" data-start="0" data-duration="${duree}" data-track-index="0" style="background: linear-gradient(160deg, #1b1340, #0b0b12);"></div>
  <div id="scene-1" class="clip" data-start="0" data-duration="${duree}" data-track-index="1">
    <div id="titre">${titre}</div>
  </div>
</div>
<script>
  // TOUT CE QUI SE VOIT EST UNE FONCTION DU TEMPS DE CETTE CHRONOLOGIE : ni Date.now, ni Math.random sans graine, ni requestAnimationFrame, ni minuteur, ni réseau.
  const tl = gsap.timeline({ paused: true });
  tl.fromTo('#titre', { y: 80, opacity: 0 }, { y: 0, opacity: 1, duration: 0.6, ease: 'power3.out' }, 0.2);
  window.__timelines = window.__timelines || {};
  window.__timelines['${e.id}'] = tl;
</script>
</body>
</html>
`;
}

/** La durée déclarée par la racine (`data-duration` de l'élément `data-composition-id`), ou `null`. */
export function dureeDeLaComposition(html: string): number | null {
  const racine = /<[^>]*data-composition-id\s*=\s*["'][^"']+["'][^>]*>/i.exec(html)?.[0];
  if (!racine) return null;
  const m = /data-duration\s*=\s*["']([\d.]+)["']/i.exec(racine);
  const d = m ? Number(m[1]) : NaN;
  return Number.isFinite(d) && d > 0 ? d : null;
}

/**
 * METTRE UNE COMPOSITION AU FORMAT : la racine reçoit la largeur et la hauteur
 * du format (attributs ET style), le reste de la page doit suivre (tailles en %
 * ou lues sur la racine). Une seule composition sert ainsi les quatre formats.
 */
export function poserLesDimensions(html: string, format: FormatDeMedia): string {
  const { largeur, hauteur } = DIMENSIONS_DES_FORMATS[format];
  return html.replace(/<[^>]*data-composition-id\s*=\s*["'][^"']+["'][^>]*>/i, (racine) => {
    let r = racine;
    r = /data-width\s*=/.test(r) ? r.replace(/data-width\s*=\s*["'][^"']*["']/, `data-width="${largeur}"`) : r.replace(/>$/, ` data-width="${largeur}">`);
    r = /data-height\s*=/.test(r) ? r.replace(/data-height\s*=\s*["'][^"']*["']/, `data-height="${hauteur}"`) : r.replace(/>$/, ` data-height="${hauteur}">`);
    return r;
  }).replace(/(#root\s*\{[^}]*?)width:\s*\d+px;\s*height:\s*\d+px;/, `$1width: ${largeur}px; height: ${hauteur}px;`);
}

/**
 * LE CONTRÔLE DE DÉTERMINISME, avant tout rendu : ce qui rendrait deux vidéos
 * différentes ou dépendrait du réseau est une ERREUR ; un tirage au hasard est
 * un avertissement (il faut une graine). Les commentaires sont ignorés.
 */
export function fautesDeDeterminisme(html: string): { erreurs: string[]; avertissements: string[] } {
  const sansCommentaires = html.replace(/<!--[\s\S]*?-->/g, '');
  const code = sansCommentaires.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:"'=])\/\/[^\n]*/g, '$1');
  const erreurs: string[] = [];
  const avertissements: string[] = [];
  if (/\bDate\.now\s*\(|new\s+Date\s*\(\s*\)|performance\.now\s*\(/.test(code)) erreurs.push('l’horloge réelle est lue (Date.now, new Date(), performance.now) : tout doit dépendre du temps de la chronologie');
  if (/\brequestAnimationFrame\s*\(/.test(code)) erreurs.push('requestAnimationFrame sert d’horloge : dessiner dans l’onUpdate de la chronologie (ou sur l’évènement « hf-seek »)');
  if (/\bset(Interval|Timeout)\s*\(/.test(code)) erreurs.push('un minuteur (setInterval / setTimeout) fait avancer l’animation : le rendu ne le rejoue pas');
  if (/\bfetch\s*\(|XMLHttpRequest|WebSocket\s*\(/.test(code)) erreurs.push('un appel réseau est fait par la page : tout fichier doit être copié dans le dossier de la composition');
  const distants = [...sansCommentaires.matchAll(/\b(?:src|href)\s*=\s*["'](https?:)?\/\/[^"']+["']/gi)].map((m) => m[0]);
  if (distants.length) erreurs.push(`fichier chargé depuis Internet (${distants.slice(0, 3).join(', ')}) : le copier dans la composition (lib/, medias/)`);
  if (/@import\s+url\(\s*["']?https?:/i.test(code) || /url\(\s*["']?https?:/i.test(code)) erreurs.push('une feuille de style ou une police vient d’Internet : utiliser les polices embarquées (polices/)');
  if (/repeat\s*:\s*-1/.test(code)) erreurs.push('une animation se répète sans fin (repeat: -1) : donner un nombre de répétitions fini');
  if (/\bMath\.random\s*\(/.test(code)) avertissements.push('Math.random est tiré sans graine : utiliser un petit générateur à graine (mulberry32) pour que deux rendus soient identiques');
  if (!/window\.__timelines\s*(\[|\.)/.test(code)) erreurs.push('aucune chronologie n’est posée sur window.__timelines[<data-composition-id>]');
  if (dureeDeLaComposition(html) === null) erreurs.push('la racine n’a pas de data-composition-id avec un data-duration en secondes');
  return { erreurs, avertissements };
}

/** Le délai d'un rendu : ≈ 3,5 × la durée mesuré sur ce serveur (05/10/2026), plafonné large ; jamais moins de 5 minutes. */
export function delaiDeRenduMs(duree: number, format: FormatDeMedia = '9:16'): number {
  const { largeur, hauteur } = DIMENSIONS_DES_FORMATS[format];
  const pixels = (largeur * hauteur) / (1080 * 1920);
  return Math.max(5 * 60_000, Math.ceil(duree * 20_000 * Math.max(1, pixels)));
}

/** Le format d'un visuel selon le canal d'un contenu Marketing : vertical pour les histoires, horizontal pour le site, portrait pour les fils. */
export function formatDuCanal(canal: string | undefined): FormatDeMedia {
  switch (canal) {
    case 'tiktok':
    case 'instagram':
      return '9:16';
    case 'youtube':
    case 'site':
    case 'presse':
    case 'x':
      return '16:9';
    case 'linkedin':
    case 'facebook':
    case 'pinterest':
    case 'publicite-reseaux':
      return '4:5';
    default:
      return '1:1';
  }
}
