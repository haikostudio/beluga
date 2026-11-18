/**
 * FILMER UN PERSONNAGE 3D IMAGE PAR IMAGE, SANS FOND (demande du 01/11/2026).
 *
 * Le serveur n'a pas de carte graphique : la page Three.js tourne dans le Chrome
 * du système (playwright `channel: 'chrome'`) sur le rendu logiciel SwiftShader.
 * Le temps n'est JAMAIS celui de l'horloge : chaque image pose l'animation à
 * l'instant exact `i / fps` (`AnimationMixer.setTime`), donc deux rendus du même
 * modèle sont identiques et une machine lente ne saute aucune image. Le canevas
 * est transparent ; les images partent en PNG vers ffmpeg, qui assemble une
 * WebM VP9 avec sa couche alpha (`yuva420p`) — le personnage se pose sans fond
 * sur n'importe quelle piste.
 *
 * Aucune adresse extérieure : la page, Three.js (dépendance du démon) et le
 * modèle sont servis par `page.route` sur une origine factice ; tout le reste
 * est refusé. Toujours appelé dans la file lourde (`dansLaFileLourde`).
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';

const ORIGINE = 'http://rendu-3d.beluga';

/** Le dossier du paquet three, résolu depuis le démon (jamais par un chemin absolu). */
function dossierDeThree(): string {
  const require = createRequire(import.meta.url);
  // « three » n'exporte pas son package.json : son point d'entrée vit dans `build/`, le paquet juste au-dessus.
  return path.dirname(path.dirname(require.resolve('three')));
}

const PAGE = `<!doctype html><html><head><meta charset="utf-8">
<style>html,body{margin:0;background:transparent;overflow:hidden}canvas{display:block}</style>
<script type="importmap">{"imports":{"three":"/three/build/three.module.js","three/addons/":"/three/examples/jsm/"}}</script>
</head><body>
<script type="module">
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
const params = new URLSearchParams(location.search);
const largeur = Number(params.get('l')), hauteur = Number(params.get('h')), clip = Number(params.get('clip') || 0);
const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true, premultipliedAlpha: false });
renderer.setPixelRatio(1);
renderer.setSize(largeur, hauteur);
renderer.setClearColor(0x000000, 0);
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.add(new THREE.HemisphereLight(0xffffff, 0x555555, 2.2));
const soleil = new THREE.DirectionalLight(0xffffff, 2.4);
soleil.position.set(1.5, 3, 4);
scene.add(soleil);
const camera = new THREE.PerspectiveCamera(30, largeur / hauteur, 0.01, 1000);
window.__pret = new Promise((resolve, reject) => {
  new GLTFLoader().load('/modele.glb', (gltf) => {
    const racine = gltf.scene;
    scene.add(racine);
    const mixer = new THREE.AnimationMixer(racine);
    const clips = gltf.animations;
    const choisi = clips[Math.min(Math.max(clip, 0), Math.max(clips.length - 1, 0))];
    if (choisi) mixer.clipAction(choisi).play();
    mixer.setTime(0);
    racine.updateMatrixWorld(true);
    // LE CADRAGE : le personnage en pied, centré, une marge de 8 %.
    const boite = new THREE.Box3().setFromObject(racine, true);
    const taille = boite.getSize(new THREE.Vector3());
    const centre = boite.getCenter(new THREE.Vector3());
    const demi = THREE.MathUtils.degToRad(camera.fov / 2);
    const distH = (taille.y / 2) / Math.tan(demi);
    const distL = (Math.max(taille.x, taille.z) / 2) / (Math.tan(demi) * camera.aspect);
    const distance = Math.max(distH, distL) * 1.08 + taille.z / 2;
    // La caméra SUIT le bassin quand le mouvement déplace le personnage (marche, course).
    let bassin = null;
    racine.traverse((o) => { if (!bassin && o.isBone && /hip|pelvis/i.test(o.name)) bassin = o; });
    const depart = bassin ? bassin.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3();
    window.__poser = (t) => {
      mixer.setTime(t);
      racine.updateMatrixWorld(true);
      const ici = bassin ? bassin.getWorldPosition(new THREE.Vector3()).sub(depart) : new THREE.Vector3();
      camera.position.set(centre.x + ici.x, centre.y, centre.z + ici.z + distance);
      camera.lookAt(centre.x + ici.x, centre.y, centre.z + ici.z);
      renderer.render(scene, camera);
      return renderer.domElement.toDataURL('image/png').slice('data:image/png;base64,'.length);
    };
    const gl = renderer.getContext();
    resolve({ clips: clips.length, dureeClip: choisi ? choisi.duration : 0, webgl: !!gl });
  }, undefined, (err) => reject(String(err && err.message || err)));
});
</script></body></html>`;

export interface DemandeDeRendu3d {
  glb: string;
  sortie: string;
  duree: number;
  largeur: number;
  hauteur: number;
  fps: number;
  /** Le rang du clip d'animation dans le fichier (un GLB à plusieurs mouvements). */
  clip?: number;
  /** Appelé à chaque image (0 à 1). */
  progression?: (part: number) => void;
}

function typeDuFichier(fichier: string): string {
  if (fichier.endsWith('.js')) return 'text/javascript';
  if (fichier.endsWith('.glb')) return 'model/gltf-binary';
  return 'application/octet-stream';
}

/** Filme le modèle : une WebM VP9 transparente de `duree` secondes. */
export async function filmerUnModele3d(d: DemandeDeRendu3d): Promise<{ images: number; dureeClip: number }> {
  if (!fs.existsSync(d.glb)) throw new Error('le modèle 3D est introuvable sur le disque');
  const three = dossierDeThree();
  const navigateur = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'],
  });
  const images = Math.max(1, Math.round(d.duree * d.fps));
  let ffmpeg: ReturnType<typeof spawn> | null = null;
  try {
    const contexte = await navigateur.newContext({ viewport: { width: d.largeur, height: d.hauteur } });
    await contexte.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== ORIGINE) return route.abort();
      if (url.pathname === '/' || url.pathname === '/index.html') return route.fulfill({ status: 200, contentType: 'text/html', body: PAGE });
      if (url.pathname === '/modele.glb') return route.fulfill({ status: 200, contentType: typeDuFichier(d.glb), body: fs.readFileSync(d.glb) });
      if (url.pathname.startsWith('/three/')) {
        const fichier = path.normalize(path.join(three, url.pathname.slice('/three/'.length)));
        if (!fichier.startsWith(three + path.sep) || !fs.existsSync(fichier)) return route.fulfill({ status: 404, body: '' });
        return route.fulfill({ status: 200, contentType: typeDuFichier(fichier), body: fs.readFileSync(fichier) });
      }
      return route.fulfill({ status: 404, body: '' });
    });
    const page = await contexte.newPage();
    await page.goto(`${ORIGINE}/index.html?l=${d.largeur}&h=${d.hauteur}&clip=${d.clip ?? 0}`);
    const info = (await page.evaluate(() => (globalThis as any).__pret, undefined)) as { clips: number; dureeClip: number; webgl: boolean };
    if (!info.webgl) throw new Error('le navigateur du serveur n’a pas de WebGL (rendu logiciel indisponible)');

    fs.mkdirSync(path.dirname(d.sortie), { recursive: true });
    const proc = spawn(
      'ffmpeg',
      ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(d.fps), '-c:v', 'png', '-i', '-',
        '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-b:v', '0', '-crf', '30', '-deadline', 'realtime', '-cpu-used', '8', '-row-mt', '1', '-auto-alt-ref', '0',
        d.sortie],
      { stdio: ['pipe', 'ignore', 'pipe'] },
    );
    ffmpeg = proc;
    let erreur = '';
    proc.stderr!.on('data', (c) => (erreur = (erreur + String(c)).slice(-600)));
    const fin = new Promise<void>((resolve, reject) => {
      proc.on('error', reject);
      proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg a échoué (${code}) : ${erreur.trim()}`))));
    });
    for (let i = 0; i < images; i++) {
      const base64 = (await page.evaluate((t) => (globalThis as any).__poser(t), i / d.fps)) as string;
      const png = Buffer.from(base64, 'base64');
      if (!proc.stdin!.write(png)) await new Promise<void>((r) => proc.stdin!.once('drain', () => r()));
      d.progression?.((i + 1) / images);
    }
    proc.stdin!.end();
    await fin;
    ffmpeg = null;
    return { images, dureeClip: info.dureeClip };
  } finally {
    if (ffmpeg) ffmpeg.kill('SIGKILL');
    await navigateur.close().catch(() => undefined);
  }
}
