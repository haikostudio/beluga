#!/usr/bin/env node
/**
 * DEUX COMPTES D'UN MÊME MOTEUR RENDENT-ILS LE MÊME RELEVÉ ?
 *
 * Chaque compte est relevé avec le jeton de SON coffre. Des pourcentages
 * identiques ET une échéance de fenêtre identique à la minute près ne peuvent
 * donc venir que d'une chose : les deux coffres aboutissent au même abonnement
 * chez le fournisseur. C'est arrivé le 02/09/2026 sur les deux comptes Claude
 * du serveur — même compte Anthropic derrière deux jetons différents —, et
 * l'interface affichait deux jauges jumelles sans rien dire.
 *
 * CE CONTRÔLE JUGE DEUX CHOSES, sans appeler aucun moteur ni dépenser un jeton :
 *  1. LA RÈGLE PURE rapproche bien deux relevés jumeaux, et ne rapproche pas
 *     deux comptes réellement distincts ;
 *  2. LE DERNIER RELEVÉ RÉEL de la machine, s'il en existe un, est ANNONCÉ :
 *     un doublon constaté est dit ici en clair, avec les comptes concernés.
 *
 * Le doublon constaté n'est PAS un échec du contrôle : c'est un état du
 * serveur, que seule une reconnexion peut changer — et elle appartient à
 * l'utilisateur. Le contrôle échoue si la DÉTECTION, elle, ne fonctionne plus.
 *
 *   node scripts/verif-comptes-jumeaux.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

const resultats = [];
function noter(nom, ok, detail = '') {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
}

console.log(`Racine jugée : ${RACINE}`);

/* ------------------------------------------------------------------ */
/* 1. La règle pure                                                    */
/* ------------------------------------------------------------------ */

const partage = path.join(RACINE, 'shared/dist/comptes-jumeaux.js');
if (!fs.existsSync(partage)) {
  noter('la règle des comptes jumeaux est construite', false, `${partage} absent — lancer npm run build:server`);
  console.log('\n0/1 contrôle passé.');
  process.exit(1);
}
noter('la règle des comptes jumeaux est construite', true);

const { groupesDeComptesJumeaux, groupesDeJumeaux, jumeauxParCompte, natureParCompte, signaturesDeGroupe } =
  await import(partage);
const { compteQuiRecoitLeTravail } = await import(path.join(RACINE, 'shared/dist/choix-de-compte.js'));

const CINQ_H = Date.parse('2026-09-03T04:50:00.488Z');
const SEMAINE = Date.parse('2026-09-06T16:00:00.489Z');
const A = { id: 'a', engine: 'claude', sessionPct: 41, sessionResetsAt: CINQ_H, weeklyPct: 15, weeklyResetsAt: SEMAINE };
// Le même abonnement lu par l'autre coffre : l'échéance diffère au millième.
const B = { ...A, id: 'b', sessionResetsAt: CINQ_H - 413, weeklyResetsAt: SEMAINE - 413 };

noter(
  'deux relevés jumeaux sont rapprochés malgré des millièmes différents',
  groupesDeComptesJumeaux([A, B]).length === 1,
);
noter(
  'une échéance écartée de plus d’une minute sépare les comptes',
  groupesDeComptesJumeaux([A, { ...B, sessionResetsAt: CINQ_H + 90_000 }]).length === 0,
);
noter('un pourcentage différent sépare les comptes', groupesDeComptesJumeaux([A, { ...B, weeklyPct: 16 }]).length === 0);
noter('deux moteurs différents ne sont jamais rapprochés', groupesDeComptesJumeaux([A, { ...B, engine: 'codex' }]).length === 0);
noter(
  'deux comptes neufs sans échéance connue ne sont pas déclarés jumeaux',
  groupesDeComptesJumeaux([
    { id: 'x', engine: 'claude', sessionPct: 0, weeklyPct: 0 },
    { id: 'y', engine: 'claude', sessionPct: 0, weeklyPct: 0 },
  ]).length === 0,
);
noter('chaque jumeau reçoit le nom de l’autre', jumeauxParCompte([A, B]).get('a')?.[0] === 'b');

/* ---- L'IDENTITÉ PRIME SUR LES CHIFFRES -------------------------- */

const MOI = '74b52c30-f844-4f64-969e-d4b4ca630be4';
const AUTRE = '11111111-2222-3333-4444-555555555555';
const AvecIdentite = { ...A, compteFournisseur: MOI };
const BAvecIdentite = { ...B, compteFournisseur: MOI };

noter(
  'deux coffres au MÊME compte fournisseur sont jumeaux CERTAINS',
  groupesDeJumeaux([AvecIdentite, BAvecIdentite])[0]?.nature === 'certain',
);
noter(
  'deux identités DIFFÉRENTES ne sont pas jumelées, même à chiffres égaux',
  groupesDeJumeaux([AvecIdentite, { ...BAvecIdentite, compteFournisseur: AUTRE }]).length === 0,
);
noter(
  'deux identités différentes restent DEUX réserves pour le choix du compte',
  signaturesDeGroupe([AvecIdentite, { ...BAvecIdentite, compteFournisseur: AUTRE }]).size === 0,
);
noter(
  'sans identité des deux côtés, le repli par les chiffres tient',
  groupesDeJumeaux([A, B])[0]?.nature === 'presume',
);
noter(
  'un jumelage présumé se dit comme une présomption',
  natureParCompte([A, B]).get('a') === 'presume' && natureParCompte([AvecIdentite, BAvecIdentite]).get('a') === 'certain',
);
noter(
  'deux comptes au même compte fournisseur sont rapprochés même sans chiffres',
  groupesDeJumeaux([
    { id: 'x', engine: 'claude', compteFournisseur: MOI },
    { id: 'y', engine: 'claude', compteFournisseur: MOI },
  ]).length === 1,
);

const signatures = signaturesDeGroupe([A, B]);
const candidats = [
  { id: 'a', plan: 'Pro', priority: 50, sessionPct: 41, weeklyPct: 15, jumeauDe: signatures.get('a') },
  { id: 'b', plan: 'Max x20', priority: 10, sessionPct: 41, weeklyPct: 15, jumeauDe: signatures.get('b') },
];
noter('le choix du compte ne retient qu’un seul des deux jumeaux', compteQuiRecoitLeTravail(candidats)?.id === 'a');

/* ------------------------------------------------------------------ */
/* 2. Le relevé réel de la machine                                     */
/* ------------------------------------------------------------------ */

const BASE = process.env.BELUGA_DB || path.join('/root/beluga/data', 'beluga.db');
if (fs.existsSync(BASE)) {
  const Database = require('better-sqlite3');
  const db = new Database(BASE, { readonly: true });
  // Le dernier relevé de chaque compte, pris dans la même demi-heure : deux
  // lectures éloignées ne se comparent pas.
  const lignes = db
    .prepare(
      `SELECT account, session_pct, weekly_pct, MAX(at) AS at FROM quota_samples
       WHERE at > ? GROUP BY account`,
    )
    .all(Date.now() - 30 * 60_000);
  // Le moteur de chaque compte : on ne rapproche jamais un compte Claude d'un
  // compte Codex, même si leurs pourcentages coïncident par hasard.
  const moteurs = new Map(
    db
      .prepare('SELECT id, engine FROM accounts')
      .all()
      .map((ligne) => [ligne.id, ligne.engine]),
  );
  db.close();

  /*
   * DEUX RELEVÉS NE SE COMPARENT QUE S'ILS SONT DU MÊME INSTANT. Les comptes
   * sont lus l'un après l'autre, et un compte en pause de lecture peut dater de
   * dix minutes : sur une fenêtre de cinq heures, un point de pourcentage a le
   * temps de bouger. On ne rapproche donc que des relevés pris à moins de deux
   * minutes d'écart — au-delà, on ne conclut rien plutôt que de conclure faux.
   */
  const ECART_MAX_MS = 2 * 60_000;
  const doublons = [];
  for (let i = 0; i < lignes.length; i += 1) {
    for (let j = i + 1; j < lignes.length; j += 1) {
      const a = lignes[i];
      const b = lignes[j];
      if (moteurs.get(a.account) !== moteurs.get(b.account)) continue;
      if (Math.abs(a.at - b.at) > ECART_MAX_MS) continue;
      if (a.session_pct === null || a.weekly_pct === null) continue;
      if (Math.round(a.session_pct) !== Math.round(b.session_pct ?? -1)) continue;
      if (Math.round(a.weekly_pct) !== Math.round(b.weekly_pct ?? -1)) continue;
      doublons.push([a.account, b.account]);
    }
  }
  if (doublons.length) {
    console.log(
      `\n  NOTE  deux comptes rendent le même relevé sur la machine : ${doublons
        .map((comptes) => comptes.join(' = '))
        .join(' | ')}`,
    );
    console.log('        Ce n’est pas un échec du contrôle : seule une reconnexion sépare deux comptes.');
  } else {
    console.log('\n  NOTE  aucun relevé jumeau sur la dernière demi-heure.');
  }
} else {
  console.log(`\n  NOTE  base introuvable (${BASE}) : le relevé réel n’est pas jugé.`);
}

/* ------------------------------------------------------------------ */
/* 3. L'écran le dit-il ?                                              */
/* ------------------------------------------------------------------ */

/*
 * On ne peut pas fabriquer deux vrais comptes jumeaux sur la machine : on pose
 * donc le marquage `jumeaux` sur les relevés QUI ARRIVENT à la page, comme le
 * serveur le ferait, et on regarde ce que le volet affiche. C'est bien l'écran
 * qui est jugé — la règle, elle, l'a été plus haut.
 */
const ADRESSE = process.env.HAIKO_JUMEAUX_URL;
if (!ADRESSE) {
  console.log('\n  NOTE  HAIKO_JUMEAUX_URL non posée : l’affichage n’est pas jugé.');
  console.log('        HAIKO_JUMEAUX_URL=http://localhost:7301 node scripts/verif-comptes-jumeaux.mjs');
} else {
  const { chromium } = await import('playwright');
  const crypto = await import('node:crypto');
  const Database = require('better-sqlite3');

  // Une session d'une heure, fabriquée puis retirée. La colonne « token »
  // garde le SHA-256 du cookie, jamais le cookie lui-même.
  const cookie = crypto.randomBytes(32).toString('hex');
  const empreinte = crypto.createHash('sha256').update(cookie).digest('hex');
  const poser = new Database(BASE);
  poser
    .prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)')
    .run(empreinte, Date.now(), Date.now() + 3600_000, 'vérification comptes jumeaux');
  poser.close();

  const navigateur = await chromium.launch({
    channel: 'chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--ignore-certificate-errors'],
  });
  try {
    const context = await navigateur.newContext({
      viewport: { width: 1280, height: 900 },
      locale: 'fr-CH',
      ignoreHTTPSErrors: true,
      serviceWorkers: 'block',
    });
    await context.addCookies([
      { name: 'beluga_session', value: cookie, url: new URL(ADRESSE).origin, httpOnly: true, sameSite: 'Lax' },
    ]);
    const page = await context.newPage();
    const erreurs = [];
    page.on('pageerror', (e) => erreurs.push(String(e)));

    // Le marquage est posé sur les deux premiers comptes du même moteur, à
    // l'arrivée des relevés — exactement le champ que le serveur remplit.
    await page.addInitScript(() => {
      const marquer = (quotas) => {
        if (!Array.isArray(quotas)) return quotas;
        const parMoteur = {};
        for (const quota of quotas) (parMoteur[quota.engine] ??= []).push(quota);
        const paire = Object.values(parMoteur).find((liste) => liste.length > 1);
        if (!paire) return quotas;
        const [un, deux] = paire;
        un.jumeaux = [{ id: deux.id, label: deux.label }];
        deux.jumeaux = [{ id: un.id, label: un.label }];
        return quotas;
      };
      const proprio = Object.getOwnPropertyDescriptor(WebSocket.prototype, 'onmessage');
      Object.defineProperty(WebSocket.prototype, 'onmessage', {
        configurable: true,
        get: proprio.get,
        set(ecouteur) {
          const filtre = function (evenement) {
            try {
              const message = JSON.parse(evenement.data);
              if (Array.isArray(message?.quotas)) {
                marquer(message.quotas);
                return ecouteur.call(this, { data: JSON.stringify(message) });
              }
            } catch {
              /* message non JSON : on laisse passer */
            }
            return ecouteur.call(this, evenement);
          };
          proprio.set.call(this, filtre);
        },
      });
    });

    await page.goto(ADRESSE, { waitUntil: 'domcontentloaded', timeout: 60000 });
    /*
     * ON ATTEND L'ÉTAT, PAS UN DÉLAI. Les relevés arrivent par le canal temps
     * réel, plusieurs secondes après le premier affichage : un `waitForTimeout`
     * généreux passerait quand même à côté un jour de charge. On attend donc
     * que le volet porte VRAIMENT ses cartes de compte.
     */
    await page.locator('button[title="Quotas des moteurs"]').click({ timeout: 60000 });
    await page.locator('[data-interrupteur-compte]').first().waitFor({ timeout: 60000 });
    await page.locator('[data-comptes-jumeaux]').first().waitFor({ timeout: 30000 }).catch(() => undefined);

    const alertes = page.locator('[data-comptes-jumeaux]');
    const combien = await alertes.count();
    noter('le volet nomme les comptes au relevé identique', combien >= 2, `${combien} alerte(s)`);
    if (combien) {
      const texte = await alertes.first().innerText();
      noter('la phrase dit le même abonnement et le geste à faire', /abonnement/i.test(texte) && /reconnect/i.test(texte), texte);
    } else {
      noter('la phrase dit le même abonnement et le geste à faire', false, 'aucune alerte affichée');
    }
    noter('aucune erreur de page', erreurs.length === 0, erreurs.slice(0, 2).join(' | '));
  } finally {
    await navigateur.close();
    const retirer = new Database(BASE);
    retirer.prepare('DELETE FROM sessions WHERE token = ?').run(empreinte);
    retirer.close();
  }
}

const rates = resultats.filter((r) => !r.ok);
console.log(`\n${resultats.length - rates.length}/${resultats.length} contrôles passés.`);
process.exit(rates.length ? 1 : 0);
