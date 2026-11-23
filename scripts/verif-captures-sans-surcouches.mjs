#!/usr/bin/env node
/**
 * CAPTURES SANS SURCOUCHES, PAR LE VRAI MOTEUR — sur une base NEUVE (dossier temporaire), sans démon ni quota.
 *
 * Une page-piège servie en local porte tout ce qu'une capture doit retirer : bandeau de cookies (rouge) dont le
 * « Tout accepter » pose un cookie puis RECHARGE la page, fenêtre newsletter (bleue) surgie 1 s après le chargement
 * avec voile et défilement bloqué, fenêtre de sortie (bleue) surgie PENDANT le déroulé, bulle de discussion (orange).
 * Le site propre, c'est l'en-tête collant magenta (60 px) et le bloc vert (150 px) qui n'existe QU'APRÈS acceptation.
 *
 * Attendu, en ordinateur ET en téléphone : magenta 60 rangées (× densité), vert présent, aucune rangée rouge, bleue ou
 * orange ; et, avec « garderLesSurcouches », le bandeau rouge et la fenêtre bleue toujours là.
 *
 *   node scripts/verif-captures-sans-surcouches.mjs [https://un-site-reel.fr …]   (port : HAIKO_VERIF_SURCOUCHES_PORT, 7293)
 *
 * Les adresses réelles données en argument sont capturées de la même façon, rangées dans le dossier temporaire
 * affiché, pour être RELUES à l'œil.
 */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-surcouches-'));
process.env.BELUGA_DATA = path.join(TMP, 'data');
fs.mkdirSync(process.env.BELUGA_DATA, { recursive: true });
delete process.env.BELUGA_TOKEN;
const PORT = Number(process.env.HAIKO_VERIF_SURCOUCHES_PORT || 7293);
const BASE = `http://127.0.0.1:${PORT}`;

const dist = (f) => path.join(RACINE, 'server/dist', f);
const store = await import(dist('store.js'));
const { executerLaRecette } = await import(dist('capture-ecran.js'));
const { cheminDePieceJointe } = await import(dist('pieces-jointes.js'));
const { lireLaRecette } = await import(path.join(RACINE, 'shared/dist/index.js'));
const sharp = (await import('sharp')).default;

let echecs = 0;
const ok = (cond, libelle) => {
  console.log(`${cond ? '✓' : '✗'} ${libelle}`);
  if (!cond) echecs++;
};

const PAGE = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
body{margin:0;font-family:sans-serif}header{position:sticky;top:0;height:60px;background:#ff00ff;z-index:5}
section{height:700px;border-bottom:1px solid #999;background:#fafafa}#integration{display:none;height:150px;background:#00ff00}
#cookies{position:fixed;left:0;right:0;bottom:0;height:120px;background:#ff0000;z-index:2000}
.voile{position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:1000;display:flex;align-items:center;justify-content:center}
.voile .boite{width:300px;height:300px;background:#0000ff;color:#fff}
#bulle{position:fixed;right:20px;bottom:20px;width:60px;height:60px;border-radius:30px;background:#ff8000;z-index:999}
</style></head><body><header>EN-TETE</header><section>1</section><div id="integration">video integree</div>
<section>2</section><section>3</section><section>4</section><section>5</section><div id="bulle"></div>
<div id="cookies">Nous utilisons des cookies. <button>Personnaliser</button> <button id="oui">Tout accepter</button></div>
<script>
const accepte = document.cookie.includes('consentement=1');
if (accepte) { document.getElementById('cookies').remove(); document.getElementById('integration').style.display = 'block'; }
else document.getElementById('oui').onclick = () => { document.cookie = 'consentement=1; path=/'; location.reload(); };
const fenetre = (t) => { const v = document.createElement('div'); v.className = 'voile'; v.innerHTML = '<div class="boite" role="dialog">' + t + '</div>'; document.body.appendChild(v); document.body.classList.add('modal-open'); document.body.style.overflow = 'hidden'; };
setTimeout(() => fenetre('Newsletter'), 1000);
let sortie = false;
addEventListener('scroll', () => { if (!sortie && scrollY > 1500) { sortie = true; fenetre('Avant de partir'); } });
</script></body></html>`;

const serveur = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(PAGE);
});
await new Promise((r) => serveur.listen(PORT, '127.0.0.1', r));

/** Rangées où paraît chaque couleur pure (tolérance pour la compression webp). */
async function bandes(fichier) {
  const { data, info } = await sharp(fichier).raw().toBuffer({ resolveWithObject: true });
  const n = { magenta: 0, vert: 0, rouge: 0, bleu: 0, orange: 0 };
  for (let y = 0; y < info.height; y++) {
    const vu = {};
    for (let x = 0; x < info.width; x += 4) {
      const i = (y * info.width + x) * info.channels;
      const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
      if (r > 225 && g < 30 && b > 225) vu.magenta = 1;
      else if (r < 30 && g > 225 && b < 30) vu.vert = 1;
      else if (r > 225 && g < 30 && b < 30) vu.rouge = 1;
      else if (r < 30 && g < 30 && b > 225) vu.bleu = 1;
      else if (r > 225 && g > 100 && g < 160 && b < 30) vu.orange = 1;
    }
    for (const k in vu) n[k]++;
  }
  return { ...n, hauteur: info.height };
}

try {
  const projet = store.saveProject({ id: store.newId(), name: 'Essai surcouches', path: TMP, defaultEngine: 'claude', isSelf: false, archived: false, createdAt: store.now(), updatedAt: store.now() });

  const propre = lireLaRecette({ cibles: [{ url: `${BASE}/`, nom: 'Piege' }], appareils: ['ordinateur', 'telephone'], themes: ['clair'] });
  const t0 = Date.now();
  const r1 = await executerLaRecette({ recette: propre.recette, projectId: projet.id });
  ok(r1.pieces.length === 2 && !r1.erreurs.length, `deux captures prises en ${Math.round((Date.now() - t0) / 1000)} s${r1.erreurs.length ? ' — ' + r1.erreurs.join(' | ') : ''}`);
  for (const p of r1.pieces) {
    const b = await bandes(cheminDePieceJointe(p));
    const densite = p.name.includes('telephone') ? 3 : 2;
    console.log(`  ${p.name} : ${JSON.stringify(b)}`);
    ok(Math.abs(b.magenta - 60 * densite) <= 4, `${p.name} : en-tête conservé (${b.magenta} rangées)`);
    ok(b.vert >= 140 * densite, `${p.name} : cookies ACCEPTÉS, le contenu intégré est là`);
    ok(!b.rouge && !b.bleu && !b.orange, `${p.name} : ni bandeau, ni fenêtre, ni bulle`);
  }

  const garde = lireLaRecette({ cibles: [{ url: `${BASE}/`, nom: 'Garde' }], themes: ['clair'], garderLesSurcouches: true, attente: 1500 });
  const r2 = await executerLaRecette({ recette: garde.recette, projectId: projet.id });
  const b2 = r2.pieces[0] ? await bandes(cheminDePieceJointe(r2.pieces[0])) : null;
  ok(!!b2 && b2.rouge > 0 && b2.bleu > 0, `« garderLesSurcouches » montre le bandeau et la fenêtre (${JSON.stringify(b2)})`);

  const reels = process.argv.slice(2).filter((a) => /^https?:\/\//.test(a));
  if (reels.length) {
    const recette = lireLaRecette({ cibles: reels.map((url) => ({ url })), themes: ['clair'] });
    const t1 = Date.now();
    const r3 = await executerLaRecette({ recette: recette.recette, projectId: projet.id });
    console.log(`  sites réels : ${r3.pieces.length} image(s) en ${Math.round((Date.now() - t1) / 1000)} s${r3.erreurs.length ? ' — ' + r3.erreurs.join(' | ') : ''}`);
    for (const p of r3.pieces) console.log(`    ${cheminDePieceJointe(p)}`);
  }
} finally {
  serveur.close();
}
console.log(echecs ? `\n${echecs} contrôle(s) en échec` : '\nTout est vert.');
process.exit(echecs ? 1 : 0);
