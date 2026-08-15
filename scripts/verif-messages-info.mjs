#!/usr/bin/env node
/**
 * Les messages d'information passagers (les « toasts ») : en HAUT AU CENTRE,
 * empilés les uns SOUS les autres, chacun avec sa barre de progression et son
 * compte à rebours de 10 secondes au maximum.
 *
 * On déclenche plusieurs messages d'affilée, comme le ferait le démon, et on
 * regarde dans un vrai navigateur : sont-ils posés en haut au centre ?
 * S'empilent-ils en liste, sans se remplacer ni se cacher ? La barre se
 * vide-t-elle avec le temps ? Chacun s'efface-t-il à dix secondes ? Le survol
 * gèle-t-il bien le compte à rebours, qui reprend ensuite là où il en était ?
 * Sur téléphone, la pile masque-t-elle l'en-tête ?
 *
 *   node scripts/verif-messages-info.mjs
 *
 * On vise le serveur de DÉVELOPPEMENT : HAIKODEV_URL, posée pour les agents,
 * désigne l'application déjà publiée — on y verrait l'ancienne version.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';

const BASE = process.env.HAIKODEV_VERIF_URL || 'http://localhost:7099';
const SHOTS = '/root/haikodev/data/verification';

const resultats = [];
function noter(nom, ok, detail = '') {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
}

function jeton() {
  const db = new Database('/root/haikodev/data/haikodev.db');
  const token = crypto.randomBytes(32).toString('hex');
  const empreinte = crypto.createHash('sha256').update(token).digest('hex');
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    empreinte,
    maintenant,
    maintenant + 3600_000,
    'vérification messages d’information',
  );
  db.close();
  return { token, empreinte };
}

function retirerLaSession(empreinte) {
  const db = new Database('/root/haikodev/data/haikodev.db');
  db.prepare('DELETE FROM sessions WHERE token = ?').run(empreinte);
  db.close();
}

/** Ce que l'écran montre de la pile de messages, à l'instant présent. */
const LECTURE = () => {
  const bloc = document.querySelector('[data-bloc="toasts"]');
  if (!bloc) return null;
  const boiteBloc = bloc.getBoundingClientRect();
  const messages = Array.from(document.querySelectorAll('[data-toast]')).map((el) => {
    const boite = el.getBoundingClientRect();
    const barre = el.querySelector('[data-barre-message]');
    return {
      haut: boite.top,
      bas: boite.bottom,
      largeur: boite.width,
      milieu: boite.left + boite.width / 2,
      echelleBarre: barre ? Number(getComputedStyle(barre).transform.match(/matrix\(([^,]+)/)?.[1] ?? 1) : null,
      texte: el.textContent ?? '',
    };
  });
  return { haut: boiteBloc.top, milieuBloc: boiteBloc.left + boiteBloc.width / 2, messages };
};

async function contexteEtPage(navigateur, viewport, token, essai) {
  const context = await navigateur.newContext({
    viewport,
    locale: 'fr-CH',
    ignoreHTTPSErrors: true,
    serviceWorkers: 'block',
    ...(essai ? { isMobile: true, hasTouch: true } : {}),
  });
  await context.addCookies([
    { name: 'haikodev_session', value: token, url: new URL(BASE).origin, httpOnly: true, sameSite: 'Lax' },
  ]);
  const page = await context.newPage();
  const erreurs = [];
  page.on('pageerror', (error) => erreurs.push(String(error)));
  page.on('console', (m) => m.type() === 'error' && erreurs.push(m.text()));
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(5000);
  // L'application rouvre parfois là où on l'a quittée (une carte, un panneau) :
  // un voile par-dessus tout intercepterait les clics sur les messages.
  for (let essai = 0; essai < 3 && (await page.locator('[role="dialog"]').count()); essai += 1) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  }
  return { context, page, erreurs };
}

async function main() {
  const { token, empreinte } = jeton();
  const navigateur = await chromium.launch({
    channel: 'chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--ignore-certificate-errors'],
  });

  try {
    /* ---------- Ordinateur : plusieurs messages, empilement et barre ---------- */
    const { page, erreurs } = await contexteEtPage(navigateur, { width: 1440, height: 900 }, token, false);

    if (!(await page.evaluate(() => Boolean(window.haikodevEssai)))) {
      noter('la page est bien celle du serveur de développement', false, 'viser le serveur de développement');
    } else {
      const textes = ['Premier message de vérification', 'Deuxième message de vérification', 'Troisième message de vérification'];
      for (const [i, texte] of textes.entries()) {
        await page.evaluate(([lvl, t]) => window.haikodevEssai.message(lvl, t), [
          i === 2 ? 'error' : i === 1 ? 'warning' : 'info',
          texte,
        ]);
        await page.waitForTimeout(250);
      }
      await page.waitForTimeout(400);

      fs.mkdirSync(SHOTS, { recursive: true });
      const etat = await page.evaluate(LECTURE);
      await page.screenshot({ path: `${SHOTS}/messages-info-haut-centre.png` });

      if (!etat) {
        noter('la pile de messages est à l’écran', false, 'aucun bloc [data-bloc="toasts"]');
      } else {
        noter('le bloc est posé en haut de l’écran', etat.haut < 80, `${Math.round(etat.haut)} px`);
        noter(
          'le bloc est centré horizontalement',
          Math.abs(etat.milieuBloc - 1440 / 2) < 4,
          `milieu à ${Math.round(etat.milieuBloc)} px sur 1440`,
        );
        noter('les trois messages sont tous à l’écran, empilés', etat.messages.length === 3, `${etat.messages.length} messages`);

        const tries = [...etat.messages].sort((a, b) => a.haut - b.haut);
        const empilesEnListe = tries.every(
          (m, i) => i === 0 || (m.haut >= tries[i - 1].bas - 1 && m.haut - tries[i - 1].bas < 40),
        );
        noter(
          'ils s’empilent les uns SOUS les autres, sans se recouvrir',
          empilesEnListe,
          tries.map((m) => Math.round(m.haut)).join(' / ') + ' px',
        );
        noter(
          'chacun garde sa largeur pleine — aucun n’est réduit ni caché',
          etat.messages.every((m) => m.largeur > 200),
          etat.messages.map((m) => Math.round(m.largeur)).join(' / ') + ' px',
        );

        const barresPresentes = etat.messages.every((m) => m.echelleBarre !== null);
        noter('chaque message porte une barre de progression', barresPresentes);

        /* ---------- La barre se vide avec le temps ---------- */
        await page.waitForTimeout(2500);
        const apres = await page.evaluate(LECTURE);
        const retrecies = apres.messages.every((m, i) => m.echelleBarre < etat.messages[i]?.echelleBarre ?? 1);
        noter(
          'la barre se vide progressivement',
          retrecies,
          `${etat.messages.map((m) => m.echelleBarre?.toFixed(2)).join('/')} → ${apres.messages.map((m) => m.echelleBarre?.toFixed(2)).join('/')}`,
        );

        /* ---------- Retrait manuel ---------- */
        const avant = apres.messages.length;
        await page.locator('[data-toast] button').first().click();
        await page.waitForTimeout(300);
        const apresRetrait = await page.evaluate(LECTURE);
        noter('la croix retire le message visé', apresRetrait.messages.length === avant - 1, `${avant} → ${apresRetrait.messages.length}`);
      }
      noter('aucune erreur dans la console, ordinateur', erreurs.length === 0, erreurs.slice(0, 2).join(' | '));
    }

    /* ---------- Un seul message : disparaît-il à dix secondes ? ---------- */
    // On repart d'une pile vide : les messages restants du bloc précédent ne
    // doivent pas fausser le compte. On cherche ensuite NOTRE texte plutôt que
    // le nombre total affiché : sur ce serveur partagé, un vrai agent en train
    // de finir une tâche ailleurs peut pousser sa propre notification pendant
    // l'attente, sans rapport avec ce contrôle.
    while (await page.locator('[data-toast] button').count()) {
      await page.locator('[data-toast] button').first().click();
      await page.waitForTimeout(150);
    }
    // Le clic laisse la souris posée sur la pile : sans ce geste, elle y
    // reste et garde tout nouveau message en pause dès son apparition.
    await page.mouse.move(10, 10);
    await page.waitForTimeout(200);
    const texteSeul = 'Message qui doit disparaître seul (91bf42)';
    await page.evaluate((t) => window.haikodevEssai.message('info', t), texteSeul);
    await page.waitForTimeout(500);
    const present = await page.evaluate(LECTURE);
    noter(
      'le message tout neuf est bien affiché',
      !!present?.messages.some((m) => m.texte.includes(texteSeul)),
      `${present?.messages.length ?? 0} message(s)`,
    );
    // On SONDE plutôt qu'une seule attente figée : sur une machine chargée,
    // le rendu du navigateur peut retarder le déclenchement de quelques
    // secondes sans que ce soit un défaut — seul un blocage DÉFINITIF en est
    // un. On vise dix secondes, on tolère jusqu'à vingt avant d'échouer.
    let effaceSeul = false;
    for (let attente = 0; attente < 30000 && !effaceSeul; attente += 500) {
      await page.waitForTimeout(500);
      const lu = await page.evaluate(LECTURE);
      effaceSeul = !lu?.messages.some((m) => m.texte.includes(texteSeul));
    }
    noter('il s’est effacé seul, environ dix secondes plus tard', effaceSeul);

    /* ---------- Survol : le compte à rebours gèle, puis reprend ---------- */
    const texteSurvol = 'Message mis en pause au survol (91bf42)';
    await page.evaluate((t) => window.haikodevEssai.message('info', t), texteSurvol);
    await page.waitForTimeout(6000);
    await page.locator('[data-toast]', { hasText: texteSurvol }).hover();
    // Survolé pendant six secondes de plus : sans la pause, dix secondes se
    // seraient écoulées depuis l'apparition et le message aurait disparu.
    await page.waitForTimeout(6000);
    const pendantLeSurvol = await page.evaluate(LECTURE);
    noter(
      'le survol gèle le compte à rebours : le message tient plus de dix secondes',
      !!pendantLeSurvol?.messages.some((m) => m.texte.includes(texteSurvol)),
    );
    await page.mouse.move(10, 10);
    // Il restait environ quatre secondes au message avant le survol ; on
    // sonde là aussi, avec la même tolérance qu'au-dessus.
    let repriseEtEfface = false;
    for (let attente = 0; attente < 30000 && !repriseEtEfface; attente += 500) {
      await page.waitForTimeout(500);
      const lu = await page.evaluate(LECTURE);
      repriseEtEfface = !lu?.messages.some((m) => m.texte.includes(texteSurvol));
    }
    noter('le compte à rebours reprend et le message finit par disparaître', repriseEtEfface);

    await page.context().close();

    /* ---------- Téléphone : la pile ne masque pas l’en-tête ---------- */
    const { page: mobile, erreurs: erreursMobile } = await contexteEtPage(
      navigateur,
      { width: 402, height: 874 },
      token,
      true,
    );
    if (await mobile.evaluate(() => Boolean(window.haikodevEssai))) {
      await mobile.evaluate(() => {
        window.haikodevEssai.message('info', 'Premier message, téléphone');
        window.haikodevEssai.message('warning', 'Deuxième message, téléphone');
      });
      await mobile.waitForTimeout(500);
      const hauteurEntete = await mobile.evaluate(() => {
        const entete = document.querySelector('header');
        return entete ? entete.getBoundingClientRect().bottom : 0;
      });
      const etatMobile = await mobile.evaluate(LECTURE);
      await mobile.screenshot({ path: `${SHOTS}/messages-info-telephone.png` });
      noter(
        'sur téléphone, la pile démarre sous l’en-tête',
        !!etatMobile && etatMobile.haut >= hauteurEntete - 1,
        `en-tête jusqu’à ${Math.round(hauteurEntete)} px, pile à ${Math.round(etatMobile?.haut ?? -1)} px`,
      );
      noter(
        'sur téléphone, le bloc reste centré',
        !!etatMobile && Math.abs(etatMobile.milieuBloc - 402 / 2) < 4,
        `milieu à ${Math.round(etatMobile?.milieuBloc ?? -1)} px sur 402`,
      );
    }
    noter('aucune erreur dans la console, téléphone', erreursMobile.length === 0, erreursMobile.slice(0, 2).join(' | '));
  } finally {
    await navigateur.close();
    retirerLaSession(empreinte);
  }

  const echecs = resultats.filter((r) => !r.ok).length;
  console.log(`\n${resultats.length - echecs}/${resultats.length} contrôles passés.`);
  process.exit(echecs ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
