#!/usr/bin/env node
/**
 * CHAQUE BLOC SE DÉTACHE DE CE QUI EST DESSOUS, ET AUCUNE RANGÉE DE BOUTONS NE RESTE SEULE SOUS UN TITRE
 * (carte « Blocs contrastés et boutons en entête », 23/11/2026 — captures du Dossier marketing et de Sécurité
 * sur téléphone : les blocs avaient EXACTEMENT la teinte de la feuille du bas, Télécharger et Copier une ligne
 * à part sous le titre).
 *
 *   HAIKO_CONTRASTE_URL=http://localhost:7099 node scripts/verif-contraste-des-blocs.mjs
 *   … HAIKO_CONTRASTE_CAPTURES=/tmp/captures   (facultatif : une capture par écran, clarté et format)
 *   … HAIKO_CONTRASTE_ECRANS=securite,coffre  (facultatif : seulement ces écrans)
 *
 * Vise le SERVEUR DE DÉVELOPPEMENT (jamais `BELUGA_URL`, l'application publiée ; jamais `BELUGA_TOKEN`) : une
 * session d'une heure est posée dans la base servie puis retirée. Rien n'est écrit : les messages du canal qui
 * enregistrent (préférences, « lu », projet affiché) sont retenus au navigateur.
 *
 * Pour chaque écran de la liste, au format téléphone (390 × 844, au doigt) puis ordinateur (1440 × 900), en
 * clair puis en sombre :
 *   1. CONTRASTE — tout élément affiché qui EST un bloc (coins arrondis ≥ 6 px, au moins 120 × 32 px, fond non
 *      transparent, ni champ ni onglet, ni calque flottant à ombre ou position fixe) est comparé au fond
 *      COMPOSÉ de ce qui le porte (ses ancêtres, voiles en transparence compris). Rapport de contraste
 *      minimal : 1,07 — le « léger mais perceptible » de MEM-5902 (1,09–1,14 mesuré sur le suivi de production).
 *   2. ENTÊTE — l'élément qui suit immédiatement un entête de feuille (`[data-entete-feuille]`) ou une tête de page
 *      (`[data-tete-collante]`) ne doit pas être une rangée qui ne contient QUE des
 *      boutons : ses boutons montent dans l'entête (`gauche` / `droite`).
 */
import { poserSessionDEssai } from './lib/session-d-essai.mjs';
import fs from 'node:fs';
import path from 'node:path';

const ADRESSE = (process.env.HAIKO_CONTRASTE_URL || 'http://localhost:7099').replace(/\/$/, '');
const CAPTURES = process.env.HAIKO_CONTRASTE_CAPTURES || '';
const SEUIL = 1.07;

/** Les écrans : leur adresse, et au besoin un geste pour descendre d'un cran. */
const ECRANS = [
  { id: 'accueil', adresse: '' },
  { id: 'securite', adresse: '#securite' },
  { id: 'coffre', adresse: '#coffre' },
  { id: 'memoire', adresse: '#memoire' },
  { id: 'statistiques', adresse: '#statistiques' },
  { id: 'studio', adresse: '#studio' },
  { id: 'backups', adresse: '#backups' },
  { id: 'surveillance', adresse: '#surveillance' },
  { id: 'messagerie', adresse: '#espace' },
  { id: 'taches-recurrentes', adresse: '#taches-recurrentes' },
  { id: 'communication', adresse: '#communication' },
  { id: 'charte', adresse: '#charte' },
  { id: 'marketing', adresse: '#marketing2' },
  {
    id: 'marketing-dossier',
    adresse: '#marketing2',
    geste: async (page) => {
      /* Le premier dossier de la liste du service (une ligne du tableau), puis son dossier : à droite sur ordinateur,
         en feuille du bas sur téléphone (il y monte de lui-même ; sinon « … » → « Dossier »). */
      const ouvert = await page.evaluate(() => {
        const racine = [...document.querySelectorAll('[data-feuille-du-bas][data-state="open"]')].pop() ?? document;
        const ligne =
          racine.querySelector('[data-m2-ouvrir-client][data-m2-etat="rapport-pret"]') ??
          racine.querySelector('[data-m2-ouvrir-client]') ??
          racine.querySelector('[data-m2-client]');
        ligne?.click();
        return !!ligne;
      });
      if (!ouvert) return false;
      await page.waitForTimeout(2500);
      if (page.viewportSize().width < 640 && !(await page.locator('[data-m2-feuille-dossier]:visible').count())) {
        await page.locator('[data-options-de-page]:visible, [data-options-de-zone]:visible').last().tap({ timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(500);
        await page.locator('[data-m2-option="dossier"]:visible').first().tap({ timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(1500);
      }
      return true;
    },
  },
  { id: 'reglages', adresse: '#reglages' },
];

const FORMATS = [
  { id: 'telephone', viewport: { width: 390, height: 844 }, tactile: true },
  { id: 'ordinateur', viewport: { width: 1440, height: 900 }, tactile: false },
];
const CLARTES = ['clair', 'sombre'];

const choisis = (process.env.HAIKO_CONTRASTE_ECRANS || '').split(',').map((s) => s.trim()).filter(Boolean);
const ecrans = choisis.length ? ECRANS.filter((e) => choisis.includes(e.id)) : ECRANS;

/** Ce qui est mesuré DANS la page : rendu sérialisable, aucune dépendance. */
function mesurer(seuil) {
  const lire = (valeur) => {
    const t = /rgba?\(([^)]+)\)/.exec(valeur || '');
    if (!t) return null;
    const [r, g, b, a = '1'] = t[1].split(/[,/ ]+/).filter(Boolean);
    return { r: +r, g: +g, b: +b, a: +a };
  };
  const poser = (dessus, dessous) => ({
    r: dessus.r * dessus.a + dessous.r * (1 - dessus.a),
    g: dessus.g * dessus.a + dessous.g * (1 - dessus.a),
    b: dessus.b * dessus.a + dessous.b * (1 - dessus.a),
    a: 1,
  });
  const lum = (c) => {
    const f = (v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  const rapport = (a, b) => {
    const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
    return (x + 0.05) / (y + 0.05);
  };
  /** Le fond composé d'un élément : ses ancêtres empilés, du plus profond au plus proche. */
  const fondCompose = (element) => {
    const pile = [];
    for (let el = element; el; el = el.parentElement) {
      const c = lire(getComputedStyle(el).backgroundColor);
      if (c && c.a > 0) {
        pile.push(c);
        if (c.a >= 1) break;
      }
    }
    let fond = { r: 255, g: 255, b: 255, a: 1 };
    if (document.documentElement.classList.contains('dark')) fond = { r: 0, g: 0, b: 0, a: 1 };
    for (const c of pile.reverse()) fond = poser(c, fond);
    return fond;
  };
  const visible = (el) => {
    const b = el.getBoundingClientRect();
    if (b.width < 1 || b.height < 1 || b.bottom < 0 || b.top > innerHeight || b.right < 0 || b.left > innerWidth) return false;
    const s = getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.05;
  };
  const decrire = (el) => {
    const reperes = [...el.attributes].filter((a) => a.name.startsWith('data-')).map((a) => a.name).slice(0, 3);
    const texte = (el.innerText || '').trim().split('\n')[0].slice(0, 40);
    return `<${el.tagName.toLowerCase()}${reperes.length ? ' ' + reperes.join(' ') : ''}> « ${texte} »`;
  };

  /* CE QUI EST À L'ÉCRAN : une feuille ou une fenêtre ouverte cache la page dessous — seule la plus haute compte. */
  const calques = [...document.querySelectorAll('[data-feuille-du-bas][data-state="open"], [role="dialog"][data-state="open"]')].filter(
    (el) => el.getBoundingClientRect().height > 0,
  );
  const racine = calques.length ? calques[calques.length - 1] : document.body;

  const fautes = [];
  let blocs = 0;
  for (const el of racine.querySelectorAll('*')) {
    if (el.closest('[aria-hidden="true"], [inert]')) continue;
    /* Un bouton pleine largeur qui ouvre (une ligne de chapitre) EST un bloc : seul ce qu'il CONTIENT est écarté. */
    if (el.parentElement?.closest('button, a[href]')) continue;
    if (el.closest('svg, img, video, canvas, iframe, input, textarea, [role="menu"], [role="listbox"], [role="tooltip"], [data-radix-popper-content-wrapper], [data-fond-propre], [data-silhouette], .animate-silhouette, .animate-pulse')) continue;
    const s = getComputedStyle(el);
    const c = lire(s.backgroundColor);
    if (!c || c.a === 0) continue;
    if (parseFloat(s.borderTopLeftRadius) < 6 && parseFloat(s.borderBottomRightRadius) < 6) continue;
    if (s.position === 'fixed' || (s.boxShadow && s.boxShadow !== 'none')) continue;
    if (el.getAttribute('role') === 'dialog' || el.matches('[data-feuille-du-bas], [data-zone]')) continue;
    if (el.matches('[role="tab"], [role="tablist"], [data-barre-onglets], label')) continue;
    /* Un bloc à bordure visible se détache par elle. */
    if (parseFloat(s.borderTopWidth) >= 1 && lire(s.borderTopColor)?.a > 0.3) continue;
    const b = el.getBoundingClientRect();
    if (b.width < 120 || b.height < 32 || !visible(el)) continue;
    blocs += 1;
    const fond = fondCompose(el.parentElement);
    const r = rapport(poser(c, fond), fond);
    if (r < seuil) fautes.push(`${decrire(el)} — rapport ${r.toFixed(3)} (${s.backgroundColor} sur rgb(${fond.r | 0}, ${fond.g | 0}, ${fond.b | 0}))`);
  }

  /* Les rangées de boutons seules sous un titre. */
  const rangees = [];
  for (const tete of racine.querySelectorAll('[data-entete-feuille], [data-tete-collante]')) {
    if (!visible(tete)) continue;
    const suivant = tete.nextElementSibling;
    if (!suivant || !visible(suivant)) continue;
    const boutons = [...suivant.querySelectorAll('button, a[href]')].filter(visible);
    if (!boutons.length || boutons.length > 4) continue;
    /* Une rangée de CONTRÔLES (recherche, onglets, filtre, liste de choix) reste sous le titre : c'est la rangée de la
       page du modèle commun des services. */
    if (suivant.querySelector('input, textarea, [role="tablist"], [role="tab"], [data-barre-onglets], [role="combobox"], [role="group"], [data-recherche-de-la-page]:not(:empty), [data-champ-de-recherche], [aria-haspopup="listbox"]')) continue;
    let reste = suivant.innerText || '';
    for (const bouton of boutons) reste = reste.replace(bouton.innerText || '', '');
    if (reste.trim()) continue;
    if (suivant.getBoundingClientRect().height > 64) continue;
    rangees.push(`${decrire(suivant)} sous ${decrire(tete)} — ${boutons.length} bouton(s) seuls`);
  }
  return { blocs, fautes: [...new Set(fautes)], rangees: [...new Set(rangees)] };
}

async function main() {
  const { chromium } = await import('playwright');
  const session = poserSessionDEssai('vérification du contraste des blocs');
  const navigateur = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const echecs = [];
  let ecransMesures = 0;
  try {
    for (const format of FORMATS) {
      for (const clarte of CLARTES) {
        const contexte = await navigateur.newContext({
          viewport: format.viewport,
          hasTouch: format.tactile,
          isMobile: format.tactile,
          locale: 'fr-CH',
          serviceWorkers: 'block',
          colorScheme: clarte === 'sombre' ? 'dark' : 'light',
        });
        await contexte.addCookies([{ name: 'beluga_session', value: session.cookie, url: ADRESSE }]);
        await contexte.addInitScript((c) => {
          try {
            localStorage.setItem('beluga-theme-flash', c);
          } catch {
            /* la pose d'après suffit */
          }
        }, clarte);
        for (const ecran of ecrans) {
          const page = await contexte.newPage();
          await page.routeWebSocket(/\/ws(\?|$)/, (ws) => {
            const serveur = ws.connectToServer();
            ws.onMessage((message) => {
              try {
                const lu = JSON.parse(String(message));
                const type = lu?.cmd?.type ?? lu?.type ?? '';
                if (['prefs.set', 'card.read', 'project.read'].includes(type)) return;
              } catch {
                /* un message qui n'est pas du JSON passe tel quel */
              }
              serveur.send(message);
            });
          });
          try {
            await page.goto(`${ADRESSE}/${ecran.adresse}`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
          } catch (err) {
            console.error(`Serveur injoignable sur ${ADRESSE} — ${err.message.split('\n')[0]}`);
            process.exit(2);
          }
          await page.waitForSelector('[data-zone]', { timeout: 30_000 }).catch(() => {});
          for (let i = 0; i < 30; i += 1) {
            if (await page.evaluate(() => !document.querySelector('.animate-silhouette'))) break;
            await page.waitForTimeout(400);
          }
          await page.evaluate((c) => {
            const racine = document.documentElement;
            racine.dataset.theme = c;
            racine.classList.toggle('dark', c === 'sombre');
            racine.style.colorScheme = c === 'sombre' ? 'dark' : 'light';
          }, clarte);
          await page.addStyleTag({ content: '[data-assistant-moteurs]{display:none!important}' });
          await page.waitForTimeout(1200);
          if (ecran.geste && !(await ecran.geste(page))) {
            console.log(`  ——   ${ecran.id} · ${format.id} · ${clarte} : rien à ouvrir dans cette base`);
            await page.close();
            continue;
          }
          const lu = await page.evaluate(mesurer, SEUIL);
          ecransMesures += 1;
          const nom = `${ecran.id} · ${format.id} · ${clarte}`;
          if (CAPTURES) {
            fs.mkdirSync(CAPTURES, { recursive: true });
            await page.screenshot({ path: path.join(CAPTURES, `${ecran.id}-${format.id}-${clarte}.png`) });
          }
          const ok = !lu.fautes.length && !lu.rangees.length;
          console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom} : ${lu.blocs} bloc(s) mesuré(s)`);
          for (const f of lu.fautes) {
            console.log(`        bloc fondu — ${f}`);
            echecs.push(`${nom} : ${f}`);
          }
          for (const r of lu.rangees) {
            console.log(`        rangée seule — ${r}`);
            echecs.push(`${nom} : ${r}`);
          }
          await page.close();
        }
        await contexte.close();
      }
    }
  } finally {
    await navigateur.close();
    session.retirer();
  }
  console.log(`\n${ecransMesures} écran(s) mesuré(s), ${echecs.length} défaut(s).`);
  if (!ecransMesures) process.exit(1);
  process.exit(echecs.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
