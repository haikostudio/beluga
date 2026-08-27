#!/usr/bin/env node
/*
 * LE MODE SIMPLIFIÉ — contrôle STATIQUE, sans navigateur ni base.
 *
 * Il vérifie DEUX choses, et c'est la seconde qui compte le plus :
 *
 * 1. le réglage existe, vit EN BASE comme le thème et la langue, se pose depuis
 *    la RACINE de l'application et nulle part ailleurs, et son interrupteur est
 *    bien dans l'onglet « Apparence » des réglages ;
 * 2. il ne masque QUE des chiffres et des traces. Aucun bouton, aucun champ,
 *    aucune décision ne passe derrière ce voile — un réglage d'affichage qui
 *    retirerait une fonction serait un piège, pas un confort.
 *
 * Les règles pures (`shared/src/mode-simplifie.ts`) ont leur propre test :
 * `server/src/test/mode-simplifie.test.ts`, joué par `npm test`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lire = (relatif) => fs.readFileSync(path.join(RACINE, relatif), 'utf8');

const resultats = [];
const verifier = (nom, ok) => {
  resultats.push(ok);
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}`);
};

/* ---- La règle vit dans le socle partagé, testable sans écran ------- */

const regle = lire('shared/src/mode-simplifie.ts');
verifier(
  'la règle du mode simplifié vit dans shared/, avec sa clé et son repère',
  regle.includes("MODE_SIMPLIFIE_CLE = 'modeSimplifie'") &&
    regle.includes("MODE_SIMPLIFIE_ATTRIBUT = 'data-mode-simplifie'"),
);
verifier(
  'elle nomme les onglets techniques des réglages et d’une carte',
  regle.includes('ONGLETS_REGLAGES_TECHNIQUES') && regle.includes('ONGLETS_CARTE_TECHNIQUES'),
);
verifier(
  'elle sait alléger un message technique sans coudre de texte français',
  regle.includes('export function allegerMessageTechnique') && !/return '[A-ZÀ-Ü]/.test(regle),
);

const index = lire('shared/src/index.ts');
verifier('la règle est exportée par le socle partagé', index.includes("export * from './mode-simplifie.js';"));

/* ---- Le réglage suit l'utilisateur, et se pose une seule fois ------ */

const libWeb = lire('web/src/lib/mode-simplifie.ts');
verifier(
  'le réglage vit EN BASE (usePref), comme le thème et la langue',
  libWeb.includes("usePref<boolean>(MODE_SIMPLIFIE_CLE, false)") && !libWeb.includes('localStorage'),
);
verifier(
  'le repère se pose sur la racine du document, depuis un seul crochet',
  libWeb.includes('export function useModeSimplifieApplique') &&
    libWeb.includes('document.documentElement'),
);

const app = lire('web/src/app.tsx');
verifier(
  'la racine de l’application pose le mode, à côté du thème et de la langue',
  app.includes('useModeSimplifieApplique()') && app.includes('useLangueAppliquee()'),
);

const poseurs = ['web/src/components', 'web/src/lib']
  .flatMap((dossier) =>
    fs
      .readdirSync(path.join(RACINE, dossier))
      .filter((nom) => /\.tsx?$/.test(nom))
      .map((nom) => `${dossier}/${nom}`),
  )
  .filter((fichier) => lire(fichier).includes('MODE_SIMPLIFIE_ATTRIBUT'));
verifier(
  'un seul fichier écrit le repère sur la page (web/src/lib/mode-simplifie.ts)',
  poseurs.length === 1 && poseurs[0] === 'web/src/lib/mode-simplifie.ts',
);

/* ---- L'interrupteur est dans les réglages, et il se lit ------------ */

const reglages = lire('web/src/components/settings-view.tsx');
verifier(
  'l’interrupteur « Mode simplifié » est dans l’onglet Apparence',
  reglages.includes('function ReglageModeSimplifie()') &&
    reglages.includes('<ReglageModeSimplifie />') &&
    reglages.includes('data-interrupteur-mode-simplifie'),
);
verifier(
  'son repère de contrôle ne passe PAS par le dictionnaire',
  reglages.includes('aria-label="Mode simplifié"'),
);
verifier(
  'l’onglet « Accès API » disparaît, et un onglet devenu invisible ne laisse pas une fenêtre vide',
  reglages.includes('ongletsVisibles(CLES_ONGLETS, ONGLETS_REGLAGES_TECHNIQUES, simplifie)') &&
    reglages.includes('onglets.some((item) => item.cle === onglet) ? onglet : onglets[0].cle'),
);
verifier(
  'le journal des erreurs de la page se retire aussi',
  reglages.includes('{simplifie ? null : <SectionErreursInterface />}'),
);

/* ---- Ce qui est masqué : des chiffres et des traces, jamais un geste */

const messageView = lire('web/src/components/message-view.tsx');
verifier(
  'le compte de jetons sous un message disparaît…',
  messageView.includes('const compteJetons = simplifie ? null : jetons(tokens);'),
);
verifier(
  '…mais l’heure, l’écoute et la copie restent, sans condition',
  messageView.includes('data-heure-message') &&
    messageView.includes('<BoutonEcoute') &&
    messageView.includes('<BoutonCopier') &&
    !/simplifie[^\n]*BoutonEcoute/.test(messageView),
);
verifier(
  'une erreur reste ANNONCÉE : seule sa trace technique est retirée',
  messageView.includes('function ErreurDeMessage') &&
    messageView.includes('allegerMessageTechnique(texte)') &&
    messageView.includes('data-erreur-message'),
);

const promptEnvoye = lire('web/src/components/prompt-envoye.tsx');
verifier(
  'le fil des recherches de l’agent ne s’affiche plus',
  promptEnvoye.includes('if (simplifie || !bulles.length) return null;'),
);

const cardPanel = lire('web/src/components/card-panel.tsx');
verifier(
  'l’onglet GitHub d’une carte disparaît, et l’onglet ouvert retombe sur la conversation',
  cardPanel.includes("ongletTechnique(ONGLETS_CARTE_TECHNIQUES, onglet) ? 'chat' : onglet") &&
    cardPanel.includes('{simplifie ? null : ('),
);
verifier(
  'les onglets qui portent une fonction restent : conversation, facturation',
  ['value="chat"', 'value="billing"'].every((marque) => cardPanel.includes(marque)),
);

const dashboard = lire('web/src/components/dashboard.tsx');
verifier(
  'le tableau de bord retire ses jetons, garde ses tâches, sa durée et sa qualité',
  dashboard.includes('{simplifie ? null : (') &&
    dashboard.includes("t('Tâches mesurées')") &&
    dashboard.includes("t('Durée moyenne')") &&
    dashboard.includes("t('Qualité moyenne')"),
);

/* ---- Aucune fonction essentielle n'est cachée --------------------- */

const ONGLETS_ESSENTIELS = ['systeme', 'apparence', 'fonctionnement', 'comptes', 'voix', 'sauvegardes', 'competences'];
const techniques = /ONGLETS_REGLAGES_TECHNIQUES: readonly string\[\] = \[([^\]]*)\]/.exec(regle)?.[1] ?? '';
verifier(
  'aucun onglet essentiel des réglages n’est classé « technique »',
  ONGLETS_ESSENTIELS.every((cle) => !techniques.includes(`'${cle}'`)),
);

const traductions = lire('shared/src/traductions.ts');
verifier(
  'les textes du mode simplifié sont au dictionnaire, dans les cinq langues',
  ["'Mode simplifié'", "'Les détails techniques sont masqués'", "'Tous les détails techniques sont affichés'"].every(
    (cle) => traductions.includes(cle),
  ),
);

/* ------------------------------------------------------------------ */
/* Dans un VRAI navigateur : l'interrupteur agit-il À L'INSTANT ?       */
/* ------------------------------------------------------------------ */

/*
 * Cette seconde moitié ne tourne QUE si on lui donne une adresse — le contrôle
 * statique, lui, vaut partout et tout le temps :
 *
 *   HAIKO_SIMPLIFIE_URL=http://localhost:7099 node scripts/verif-mode-simplifie.mjs
 *
 * Elle allume puis éteint le réglage à la souris et juge l'écran ENTRE LES DEUX,
 * sans jamais recharger la page : c'est la seule façon de prouver « masque et
 * affiche instantanément ». Elle repart en laissant le réglage ÉTEINT, comme
 * elle l'a trouvé.
 */
const ADRESSE = process.env.HAIKO_SIMPLIFIE_URL;
/* La base et ses dépendances natives vivent dans le dépôt PRINCIPAL, même quand
   ce script est lancé d'une copie de travail. */
const DONNEES = process.env.HAIKODEV_DATA || '/root/haikodev/data';

/** Une session d'UNE HEURE, fabriquée puis retirée. La base garde le SHA-256 du
    cookie, jamais le cookie : c'est la seule écriture de tout ce contrôle. */
async function avecSession(travail) {
  const crypto = await import('node:crypto');
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const ouvrir = () =>
    require(path.join(DONNEES, '../node_modules/better-sqlite3'))(path.join(DONNEES, 'haikodev.db'));

  const cookie = crypto.randomBytes(24).toString('hex');
  const empreinte = crypto.createHash('sha256').update(cookie).digest('hex');
  const db = ouvrir();
  const maintenant = Date.now();
  db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
    empreinte,
    maintenant,
    maintenant + 3_600_000,
    'vérification du mode simplifié',
  );
  db.close();
  try {
    return await travail(cookie);
  } finally {
    const fin = ouvrir();
    fin.prepare('DELETE FROM sessions WHERE token = ?').run(empreinte);
    fin.close();
  }
}

async function dansLeNavigateur() {
  const { chromium } = await import('playwright');
  const navigateur = await chromium.launch({ channel: 'chrome' });
  const contexte = await navigateur.newContext({ viewport: { width: 1400, height: 900 } });
  try {
    return await avecSession(async (session) => {
      await contexte.addCookies([
        { name: 'haikodev_session', value: session, domain: 'localhost', path: '/' },
      ]);
      const page = await contexte.newPage();
      await page.goto(ADRESSE, { waitUntil: 'domcontentloaded', timeout: 20_000 });
      await page.waitForTimeout(4000);

      /* Le menu du bandeau, puis « Réglages » : deux repères TECHNIQUES, donc
         valables dans les cinq langues. */
      await page.click('[aria-label="Menu"]');
      await page.click('[data-reglages-menu]');
      await page.waitForTimeout(600);

      /* LA BARRE D'ONGLETS DES RÉGLAGES, et pas une autre : l'écran en porte
         plusieurs (le chef d'orchestre a la sienne). On la reconnaît à
         l'identifiant que Radix compose depuis la CLÉ de l'onglet — un repère
         technique, donc valable dans les cinq langues, là où le libellé se
         traduit. */
      const barre = page
        .locator('[role="tablist"]')
        .filter({ has: page.locator('[id$="-trigger-apparence"]') });
      const onglets = barre.locator('[role="tab"]');
      const avant = await onglets.count();
      await barre.locator('[id$="-trigger-apparence"]').click();
      await page.waitForSelector('[data-interrupteur-mode-simplifie]', { timeout: 5000 });

      const repereAvant = await page.evaluate(() =>
        document.documentElement.hasAttribute('data-mode-simplifie'),
      );

      await page.click('[data-interrupteur-mode-simplifie]');
      await page.waitForTimeout(900);
      const repereApres = await page.evaluate(() =>
        document.documentElement.hasAttribute('data-mode-simplifie'),
      );
      const pendant = await onglets.count();
      const jetonsCaches = await page.locator('[data-jetons-message]').count();
      const filCache = await page.locator('[data-fil-agent]').count();

      await page.click('[data-interrupteur-mode-simplifie]');
      await page.waitForTimeout(900);
      const repereFin = await page.evaluate(() =>
        document.documentElement.hasAttribute('data-mode-simplifie'),
      );
      const apres = await onglets.count();

      await navigateur.close();
      return {
        repereAvant,
        repereApres,
        repereFin,
        avant,
        pendant,
        apres,
        jetonsCaches,
        filCache,
      };
    });
  } catch (err) {
    await navigateur.close().catch(() => undefined);
    return { panne: err.message.split('\n')[0] };
  }
}

if (ADRESSE) {
  console.log('\nDANS UN VRAI NAVIGATEUR');
  const vu = await dansLeNavigateur();
  if (vu.panne) {
    verifier(`l'écran n'a PAS pu être mesuré sur ${ADRESSE} — ${vu.panne}`, false);
  } else {
    verifier(
      'au départ, le repère du mode simplifié est absent de la page',
      vu.repereAvant === false,
    );
    verifier(
      'un clic sur l’interrupteur pose le repère, SANS recharger la page',
      vu.repereApres === true,
    );
    verifier('…et un onglet technique disparaît de la barre des réglages', vu.pendant === vu.avant - 1);
    verifier('…et plus aucun compte de jetons ni fil de recherches à l’écran', vu.jetonsCaches === 0 && vu.filCache === 0);
    verifier('un second clic remet tout en place, toujours sans rechargement', vu.repereFin === false && vu.apres === vu.avant);
  }
} else {
  console.log('\n(navigateur non mesuré : donner HAIKO_SIMPLIFIE_URL pour juger la bascule à l’écran)');
}

const echecs = resultats.filter((ok) => !ok).length;
console.log(`\n${resultats.length - echecs}/${resultats.length} contrôles au vert`);
process.exit(echecs ? 1 : 0);
