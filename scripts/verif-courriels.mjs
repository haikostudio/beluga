#!/usr/bin/env node
/**
 * LES TROIS COURRIELS DE L'ESPACE CLIENT, REGARDÉS DANS UN VRAI NAVIGATEUR.
 *
 *   npm run build:server && node scripts/verif-courriels.mjs
 *
 * Fabrique un exemple de chaque courriel (point du jour, récapitulatif client,
 * identifiants) SANS RIEN ENVOYER — aucune clé, aucun réseau —, écrit les HTML
 * dans un dossier temporaire, puis les ouvre dans Chrome à la largeur d'un
 * téléphone (390 px) et d'un ordinateur (1280 px).
 *
 * Ce qui est vérifié : aucun « (s) » ni clé interne de colonne dans ce qu'on
 * lit ; un objet de 50 signes au plus ; un seul bouton principal par carte ;
 * RIEN NE DÉBORDE en largeur. Les captures restent dans le dossier temporaire
 * pour un œil humain (`GARDER=1` pour ne pas l'effacer).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-courriels-'));
const shared = await import(path.join(RACINE, 'shared/dist/index.js'));

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

/* ------------------------------------------------------------------ */
/* Le décor : deux clients, des messages, des changements anciens      */
/* ------------------------------------------------------------------ */

const heure = (h, m = 0) => new Date(2026, 8, 14, h, m).getTime();
const msg = (auteur, role, texte, date) => ({ auteur, role, texte, date });
const activite = (demandeId, genre, detail, auteurNom, creeLe) => ({
  id: `${demandeId}-${creeLe}`,
  demandeId,
  projectId: 'p1',
  auteurId: auteurNom,
  auteurNom,
  auteurRole: auteurNom === 'Haiko' ? 'admin' : 'client',
  genre,
  detail,
  creeLe,
});
// Les lignes telles qu'elles sont DÉJÀ en base : clés internes et formule vague.
const changements = shared.changementsParDemande([
  activite('d1', 'deplacement', 'en-cours', 'Haiko', heure(9)),
  activite('d1', 'avancement', 'demarree', 'Haiko', heure(9, 5)),
  activite('d1', 'modification', 'a enregistré la fiche', 'Alice', heure(10)),
  activite('d2', 'deplacement', 'termine', 'Haiko', heure(11)),
]);
const demandes = [
  {
    id: 'd1',
    projectId: 'p1',
    titre: 'Refaire la page d’accueil du site vitrine',
    projet: 'Site Atelier Alice',
    nonLus: 2,
    livraisonAnnoncee: new Date(2026, 8, 30).getTime(),
    messages: [
      msg('Alice', 'client', 'Bonjour ! Est-ce qu’on peut garder la photo de l’atelier en haut ?', heure(8, 12)),
      msg('Haiko', 'admin', 'Oui, bien sûr. Je te propose deux cadrages demain.', heure(9, 40)),
    ],
    changements: changements.get('d1'),
  },
  {
    id: 'd2',
    projectId: 'p1',
    titre: 'Corriger le formulaire de contact',
    projet: 'Site Atelier Alice',
    nonLus: 0,
    changements: changements.get('d2'),
  },
];
const discussion = { messages: [msg('Haiko', 'admin', 'Petit mot : la maquette mobile est prête 📱', heure(12))], nonLus: 1 };

const pointClient = shared.pointDuClient(demandes, discussion);
const client = shared.courrielDuClient('Alice Martin', pointClient);
const haiko = shared.courrielDeHaiko(
  shared.pointDeHaiko([
    { id: 'c1', nom: 'Alice Martin', aLire: demandes, nonLus: 2, discussion },
    { id: 'c2', nom: 'Boulangerie Dubois', aLire: [{ ...demandes[1], id: 'd3', titre: 'Ajouter les horaires d’été' }], nonLus: 0 },
  ]),
);
const identifiants = shared.courrielDIdentifiants({ nom: 'Alice Martin', identifiant: 'alice.martin', motDePasse: 'Tulipe-7-Soleil' });

const courriels = { 'point-du-jour': haiko, 'recapitulatif-client': client, identifiants };

/* ------------------------------------------------------------------ */
/* Le contenu                                                           */
/* ------------------------------------------------------------------ */

for (const [nom, { sujet, texte, html }] of Object.entries(courriels)) {
  fs.writeFileSync(path.join(TMP, `${nom}.html`), html);
  fs.writeFileSync(path.join(TMP, `${nom}.txt`), `${sujet}\n\n${texte}`);
  const tout = `${sujet}\n${texte}\n${html}`;
  noter(`${nom} : aucun « (s) »`, !tout.includes('(s)'));
  noter(
    `${nom} : aucune clé interne de colonne ni d’étape`,
    !/«\s*(a-faire|en-cours|termine|valide)\s*»|\bdemarree\b|enregistré la fiche/.test(tout),
  );
  noter(`${nom} : objet de 50 signes au plus`, [...sujet].length <= 50, sujet);
  noter(`${nom} : une version texte`, texte.trim().length > 80);
}
noter(
  'point du jour : un seul bouton par carte, l’espace en lien discret',
  (haiko.html.match(/data-bouton/g) ?? []).length ===
    (haiko.html.match(/data-carte-(demande|discussion)/g) ?? []).length &&
    (haiko.html.match(/data-lien-discret/g) ?? []).length === 1,
);
noter('récapitulatif : vouvoie, et invite à répondre', /vos demandes/.test(client.texte) && client.html.includes('data-invitation'));
noter('identifiants : encadré lisible et un bouton de connexion', identifiants.html.includes('data-identifiants') && (identifiants.html.match(/data-bouton/g) ?? []).length === 1);

/* ------------------------------------------------------------------ */
/* Le rendu, téléphone et ordinateur                                    */
/* ------------------------------------------------------------------ */

const navigateur = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const largeur of [390, 1280]) {
    const page = await navigateur.newPage({ viewport: { width: largeur, height: 900 } });
    for (const nom of Object.keys(courriels)) {
      await page.goto(`file://${path.join(TMP, `${nom}.html`)}`);
      const mesure = await page.evaluate(() => ({
        page: document.documentElement.scrollWidth,
        fenetre: window.innerWidth,
        colonne: Math.round(document.querySelector('table table')?.getBoundingClientRect().width ?? 0),
      }));
      noter(
        `${nom} à ${largeur} px : rien ne déborde`,
        mesure.page <= mesure.fenetre && mesure.colonne <= 600,
        `page ${mesure.page} px, colonne ${mesure.colonne} px`,
      );
      await page.screenshot({ path: path.join(TMP, `${nom}-${largeur}.png`), fullPage: true });
    }
    await page.close();
  }
} finally {
  await navigateur.close();
}

const echecs = resultats.filter((r) => !r.ok);
console.log(`\nExemples et captures : ${TMP}`);
if (!process.env.GARDER) process.on('exit', () => fs.rmSync(TMP, { recursive: true, force: true }));
if (echecs.length) {
  console.error(`\n${echecs.length} contrôle(s) en échec.`);
  process.exit(1);
}
console.log(`\n${resultats.length} contrôles réussis.`);
