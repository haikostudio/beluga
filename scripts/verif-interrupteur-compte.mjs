#!/usr/bin/env node
/**
 * L'interrupteur d'un compte répond-il au DOIGT, dans le volet des quotas ?
 *
 * On ouvre le volet en taille de téléphone, on appuie sur l'interrupteur d'un
 * compte — y compris en dehors de ses 18 px visibles, dans la cible élargie —
 * et on vérifie que la commande `account.disable` PART et que la ligne affiche
 * aussitôt « désactivé ». Un second appui remet le compte en service. Le même
 * geste est rejoué à la souris en taille d'ordinateur.
 *
 * Aucun vrai compte n'est touché : la commande est interceptée dans la page,
 * qui se répond à elle-même avec les VRAIES trames du serveur (accusé de
 * réception + événement « quotas »), et la liste des comptes affichée est celle
 * d'un compte d'essai.
 *
 *   node scripts/verif-interrupteur-compte.mjs
 */
import { chromium } from 'playwright';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

/* La racine se déduit du script lui-même : lancé depuis une copie de travail,
   il doit juger CE code-là. */
const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* On vise le serveur de DÉVELOPPEMENT : HAIKODEV_URL, posée pour les agents,
   pointe l'application déjà publiée — on y verrait l'ancienne version. */
const BASE = process.env.HAIKO_INTERRUPTEUR_URL || 'http://localhost:7099';
const DB = path.join(process.env.HAIKODEV_DATA || '/root/haikodev/data', 'haikodev.db');

const resultats = [];
function noter(nom, ok, detail = '') {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
}

/** Une session valable, posée directement en base : on juge l'écran, pas le mur d'accès. */
function jeton() {
  const db = new Database(DB);
  const token = crypto.randomBytes(32).toString('hex');
  const empreinte = crypto.createHash('sha256').update(token).digest('hex');
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    empreinte,
    maintenant,
    maintenant + 3600_000,
    'vérification interrupteur de compte',
  );
  db.close();
  return { token, empreinte };
}

function retirer(empreinte) {
  const db = new Database(DB);
  db.prepare('DELETE FROM sessions WHERE token = ?').run(empreinte);
  db.close();
}

/*
 * Le banc d'essai posé dans la page AVANT tout script : la liaison au serveur
 * est enveloppée pour (1) montrer un compte d'essai à la place des vrais
 * comptes, (2) retenir la commande `account.disable` au lieu de l'envoyer, et
 * (3) répondre à sa place, exactement comme le ferait le serveur.
 */
function bancDEssai() {
  const compte = {
    id: 'essai-interrupteur',
    engine: 'claude',
    label: 'Compte d’essai',
    priority: 100,
    active: true,
    available: true,
    disabled: false,
    session: { usedPct: 12, resetsAt: Date.now() + 3 * 3600_000 },
    weekly: { usedPct: 30, resetsAt: Date.now() + 4 * 86400_000 },
  };
  /* `retard` : combien de millisecondes le serveur d'essai met à répondre. À
     zéro il répond tout de suite ; allongé, il laisse le temps d'observer le
     voyant d'attente du rond. */
  window.__essaiInterrupteur = { envois: [], quotas: [compte], retard: 0 };

  const Vrai = window.WebSocket;
  function Enveloppe(url, protocols) {
    const socket = new Vrai(url, protocols);
    const envoyerVraiment = socket.send.bind(socket);
    let handler = null;

    const pousser = (objet) => {
      if (handler) handler({ data: JSON.stringify(objet) });
    };

    socket.send = (donnees) => {
      try {
        const trame = JSON.parse(donnees);
        const cmd = trame && trame.cmd;
        if (cmd && cmd.type === 'account.disable') {
          window.__essaiInterrupteur.envois.push(cmd);
          const repondre = () => {
            // Le nouvel état n'est écrit qu'AU MOMENT de répondre : sinon un
            // envoi de quotas du vrai serveur, arrivé pendant le retard,
            // basculerait l'interrupteur avant la réponse attendue.
            window.__essaiInterrupteur.quotas = window.__essaiInterrupteur.quotas.map((q) =>
              q.id === cmd.id ? { ...q, disabled: cmd.disabled } : q,
            );
            const quotas = window.__essaiInterrupteur.quotas;
            if (trame.id) pousser({ type: 'ack', id: trame.id, ok: true, data: { ok: true, quotas } });
            pousser({ type: 'quotas', quotas });
          };
          const retard = window.__essaiInterrupteur.retard || 0;
          if (retard) setTimeout(repondre, retard);
          else repondre();
          return;
        }
      } catch {
        /* trame illisible : elle part telle quelle */
      }
      envoyerVraiment(donnees);
    };

    // Le client pose son écouteur par `socket.onmessage = …` : on s'intercale
    // pour remplacer la liste des comptes par celle du banc d'essai.
    Object.defineProperty(socket, 'onmessage', {
      configurable: true,
      get: () => handler,
      set: (h) => {
        handler = h;
      },
    });
    socket.addEventListener('message', (event) => {
      if (!handler) return;
      let parsed;
      try {
        parsed = JSON.parse(event.data);
      } catch {
        handler({ data: event.data });
        return;
      }
      if (parsed && Array.isArray(parsed.quotas)) parsed.quotas = window.__essaiInterrupteur.quotas;
      handler({ data: JSON.stringify(parsed) });
    });
    return socket;
  }
  Enveloppe.prototype = Vrai.prototype;
  Enveloppe.OPEN = Vrai.OPEN;
  Enveloppe.CLOSED = Vrai.CLOSED;
  Enveloppe.CLOSING = Vrai.CLOSING;
  Enveloppe.CONNECTING = Vrai.CONNECTING;
  window.WebSocket = Enveloppe;
}

const PANNEAU = '[data-radix-popper-content-wrapper] [role="menu"]';
const INTERRUPTEUR = '[data-interrupteur-compte="essai-interrupteur"]';
/** Combien de temps le serveur d'essai fait attendre, pour observer le voyant. */
const RETARD = 1600;

/** Le voyant d'attente : est-il là, dans le rond, et l'interrupteur est-il bloqué ? */
async function voyant(page) {
  return page.evaluate((selecteur) => {
    const bouton = document.querySelector(selecteur);
    if (!bouton) return null;
    const anneau = bouton.querySelector('[data-voyant-attente]');
    const rond = bouton.querySelector('[data-radix-switch-thumb]') || bouton.firstElementChild;
    const boiteRond = rond?.getBoundingClientRect();
    const boiteAnneau = anneau?.getBoundingClientRect();
    return {
      present: !!anneau,
      /* L'anneau doit tenir DANS le rond : c'est ce qui garantit qu'on n'a ni
         agrandi ni déplacé l'interrupteur. */
      dansLeRond:
        !!boiteAnneau &&
        !!boiteRond &&
        boiteAnneau.left >= boiteRond.left - 0.5 &&
        boiteAnneau.right <= boiteRond.right + 0.5 &&
        boiteAnneau.top >= boiteRond.top - 0.5 &&
        boiteAnneau.bottom <= boiteRond.bottom + 0.5,
      tourne: !!anneau && getComputedStyle(anneau).animationName !== 'none',
      bloque: bouton.hasAttribute('disabled') || bouton.getAttribute('aria-disabled') === 'true',
      occupe: bouton.getAttribute('aria-busy') === 'true',
      largeurInterrupteur: bouton.getBoundingClientRect().width,
      hauteurInterrupteur: bouton.getBoundingClientRect().height,
    };
  }, INTERRUPTEUR);
}

/**
 * Le voyant d'attente, du même geste au doigt qu'à la souris : on retarde la
 * réponse du serveur d'essai, on bascule, on regarde le rond pendant l'attente,
 * puis une fois la réponse arrivée.
 */
async function verifierVoyant(page, quoi, basculer) {
  await page.evaluate((ms) => {
    window.__essaiInterrupteur.retard = ms;
  }, RETARD);

  const repos = await voyant(page);
  noter(`${quoi}, aucun voyant au repos`, !!repos && !repos.present && !repos.occupe);

  const avant = await etat(page);
  await basculer();
  await page.waitForTimeout(350);

  const pendant = await voyant(page);
  noter(
    `${quoi}, le voyant tourne dans le rond pendant l’attente`,
    !!pendant && pendant.present && pendant.dansLeRond && pendant.tourne,
    pendant ? `présent ${pendant.present}, dans le rond ${pendant.dansLeRond}, animé ${pendant.tourne}` : 'illisible',
  );
  noter(
    `${quoi}, l’interrupteur est bloqué pendant l’attente`,
    !!pendant && pendant.bloque && pendant.occupe,
    pendant ? `bloqué ${pendant.bloque}, aria-busy ${pendant.occupe}` : 'illisible',
  );
  noter(
    `${quoi}, l’interrupteur n’a ni grandi ni bougé`,
    !!repos &&
      !!pendant &&
      Math.abs(repos.largeurInterrupteur - pendant.largeurInterrupteur) < 0.5 &&
      Math.abs(repos.hauteurInterrupteur - pendant.hauteurInterrupteur) < 0.5,
    pendant ? `${Math.round(pendant.largeurInterrupteur)} × ${Math.round(pendant.hauteurInterrupteur)} px` : 'illisible',
  );

  // Un second appui pendant l'attente ne doit RIEN envoyer de plus.
  await basculer();
  await page.waitForTimeout(150);
  const doublon = await etat(page);
  noter(
    `${quoi}, un second appui pendant l’attente ne part pas en double`,
    !!doublon && doublon.envois === avant.envois + 1,
    doublon ? `${doublon.envois} envoi(s) au lieu de ${avant.envois + 1}` : 'illisible',
  );

  await page.waitForTimeout(RETARD);
  const apres = await voyant(page);
  const etatApres = await etat(page);
  noter(
    `${quoi}, le voyant s’éteint quand la réponse arrive`,
    !!apres && !apres.present && !apres.occupe && !apres.bloque && !!etatApres && etatApres.coche !== avant.coche,
    apres ? `voyant ${apres.present}, bloqué ${apres.bloque}` : 'illisible',
  );

  await page.evaluate(() => {
    window.__essaiInterrupteur.retard = 0;
  });
}

async function ouvrirLeVolet(navigateur, token, mobile) {
  const context = await navigateur.newContext({
    viewport: mobile ? { width: 390, height: 844 } : { width: 1400, height: 900 },
    isMobile: mobile,
    hasTouch: mobile,
    deviceScaleFactor: mobile ? 3 : 1,
    locale: 'fr-CH',
    ignoreHTTPSErrors: true,
    serviceWorkers: 'block',
  });
  await context.addCookies([
    { name: 'haikodev_session', value: token, url: new URL(BASE).origin, httpOnly: true, sameSite: 'Lax' },
  ]);
  const page = await context.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(String(e)));
  await page.addInitScript(bancDEssai);
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(5000);
  await page.locator('button[title="Quotas des moteurs"]').click();
  await page.waitForSelector(INTERRUPTEUR, { timeout: 15000 });
  await page.waitForTimeout(400);
  return { context, page, erreurs };
}

/** L'état lu à l'écran : l'interrupteur, et l'étiquette « désactivé » de la ligne. */
async function etat(page) {
  return page.evaluate((selecteur) => {
    const bouton = document.querySelector(selecteur);
    if (!bouton) return null;
    const ligne = bouton.closest('div.rounded-md');
    return {
      /* `aria-checked` et non `data-state` : à la souris, le déclencheur de
         l'infobulle pose SON `data-state` (« closed ») sur le même bouton. */
      coche: bouton.getAttribute('aria-checked') === 'true',
      etiquette: (ligne?.textContent || '').includes('désactivé'),
      envois: window.__essaiInterrupteur.envois.length,
    };
  }, INTERRUPTEUR);
}

/** Le centre de l'interrupteur, et un point 13 px plus bas : hors du visible, dans la cible. */
async function points(page) {
  const boite = await page.locator(INTERRUPTEUR).boundingBox();
  if (!boite) return null;
  return {
    centre: { x: boite.x + boite.width / 2, y: boite.y + boite.height / 2 },
    dessous: { x: boite.x + boite.width / 2, y: boite.y + boite.height / 2 + 13 },
    hauteur: boite.height,
  };
}

async function main() {
  console.log(`Racine jugée : ${RACINE}`);
  const { token, empreinte } = jeton();
  const navigateur = await chromium.launch({
    channel: 'chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--ignore-certificate-errors'],
  });

  /* ------------------------------- Téléphone ------------------------------ */
  {
    const { context, page, erreurs } = await ouvrirLeVolet(navigateur, token, true);

    // L'infobulle ne doit plus s'interposer : sans survol, aucun déclencheur.
    const declencheur = await page.evaluate(
      (s) => !!document.querySelector(s)?.hasAttribute('data-state') && !!document.querySelector(s)?.closest('[data-radix-tooltip-trigger]'),
      INTERRUPTEUR,
    );
    const infobulle = await page.evaluate(
      (s) => document.querySelector(s)?.getAttribute('aria-describedby') ?? null,
      INTERRUPTEUR,
    );
    noter(
      'au doigt, aucun déclencheur d’infobulle sur l’interrupteur',
      !declencheur && !infobulle,
      infobulle ? `aria-describedby=${infobulle}` : '',
    );

    const p = await points(page);
    noter('l’interrupteur est visible dans le volet', !!p, p ? `hauteur ${Math.round(p.hauteur)} px` : 'absent');

    // Premier appui, DÉLIBÉRÉMENT sous les 18 px visibles : la cible élargie
    // doit le recevoir.
    const avant = await etat(page);
    await page.touchscreen.tap(p.dessous.x, p.dessous.y);
    await page.waitForTimeout(600);
    const apres = await etat(page);
    noter(
      'un appui au doigt, 13 px sous le centre, coupe le compte',
      avant.coche && apres && !apres.coche && apres.envois === avant.envois + 1,
      apres ? `coché ${avant.coche} → ${apres.coche}, envois ${apres.envois}` : 'état illisible',
    );
    noter('la ligne affiche aussitôt « désactivé »', !!apres?.etiquette);

    const cmd = await page.evaluate(() => window.__essaiInterrupteur.envois.at(-1));
    noter(
      'la commande partie est bien « account.disable » avec disabled=true',
      cmd?.type === 'account.disable' && cmd?.disabled === true,
      JSON.stringify(cmd ?? null),
    );

    // Second appui : le compte revient en service.
    const p2 = await points(page);
    await page.touchscreen.tap(p2.centre.x, p2.centre.y);
    await page.waitForTimeout(600);
    const rallume = await etat(page);
    const cmd2 = await page.evaluate(() => window.__essaiInterrupteur.envois.at(-1));
    noter(
      'un second appui remet le compte en service',
      !!rallume?.coche && !rallume.etiquette && cmd2?.disabled === false,
      rallume ? `coché ${rallume.coche}, étiquette ${rallume.etiquette}` : 'état illisible',
    );

    // Le voyant d'attente, au doigt.
    await verifierVoyant(page, 'au doigt', async () => {
      const p3 = await points(page);
      await page.touchscreen.tap(p3.centre.x, p3.centre.y);
    });

    noter('aucune erreur de page (téléphone)', erreurs.length === 0, erreurs.slice(0, 2).join(' | '));
    await context.close();
  }

  /* ------------------------------ Ordinateur ------------------------------ */
  {
    const { context, page, erreurs } = await ouvrirLeVolet(navigateur, token, false);
    const avant = await etat(page);
    const p = await points(page);

    // L'infobulle, elle, reste servie à la souris. On la demande AVANT le clic :
    // un appui sur le déclencheur ferme l'infobulle tant que le pointeur ne
    // ressort pas.
    await page.mouse.move(p.centre.x, p.centre.y);
    await page.waitForTimeout(900);
    const bulle = await page.locator('[data-infobulle]').count();
    noter('à la souris, l’infobulle s’affiche encore au survol', bulle > 0, `${bulle} infobulle(s)`);

    await page.mouse.click(p.centre.x, p.centre.y);
    await page.waitForTimeout(600);
    const apres = await etat(page);
    noter(
      'à la souris, le clic coupe toujours le compte',
      avant.coche && apres && !apres.coche && apres.etiquette && apres.envois === avant.envois + 1,
      apres ? `coché ${avant.coche} → ${apres.coche}` : 'état illisible',
    );

    // Le voyant d'attente, à la souris.
    await verifierVoyant(page, 'à la souris', async () => {
      const q = await points(page);
      await page.mouse.click(q.centre.x, q.centre.y);
    });

    noter('aucune erreur de page (ordinateur)', erreurs.length === 0, erreurs.slice(0, 2).join(' | '));
    await context.close();
  }

  await navigateur.close();
  retirer(empreinte);

  const echecs = resultats.filter((r) => !r.ok);
  console.log(`\n${resultats.length - echecs.length}/${resultats.length} vérifications passées`);
  process.exit(echecs.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
