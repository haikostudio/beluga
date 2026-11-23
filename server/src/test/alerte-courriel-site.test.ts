import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import {
  lienDeLaSurveillance,
  ressourcesInterditesDuCourriel,
  ECHECS_AVANT_COURRIEL,
  ECHECS_AVANT_DEPANNAGE,
  RAPPEL_COURRIEL_MS,
  ECART_MINIMAL_DEPANNAGE_MS,
  type AlerteCourrielDuSite,
  type SiteSurveille,
  courrielDePanneDuSite,
  courrielDeRetourDuSite,
  decisionDeCourrielDePanne,
  doitApaiserParCourriel,
  phraseDeDuree,
  ligneDeVerdict,
} from '@beluga/shared';
import { MIGRATIONS } from '../db.js';

/**
 * LE COURRIEL D'ALERTE DE LA SURVEILLANCE — la mécanique entière, sans qu'un
 * seul courriel ne parte.
 *
 * La promesse de la carte : rien avant TROIS échecs d'affilée, UN SEUL courriel
 * par panne, un rappel toutes les SIX HEURES tant qu'elle dure, et un mot au
 * retour à la normale — à qui a reçu la mauvaise nouvelle, et à personne
 * d'autre.
 */

const HEURE = 3_600_000;

const site = (extra: Partial<SiteSurveille> = {}): SiteSurveille => ({
  id: 's1',
  url: 'https://compta.exemple.test/',
  nom: 'Facturation',
  etat: 'panne',
  raison: 'serveur',
  code: 500,
  verifieLe: 10 * HEURE,
  depuis: 9 * HEURE,
  dernierePanne: 10 * HEURE,
  creeLe: 0,
  ...extra,
});

/* ------------------------------------------------------------------ */
/* Le seuil, le courriel unique et le rappel                            */
/* ------------------------------------------------------------------ */

test('le seuil du courriel est celui du dépannage : un seul compteur pour les deux', () => {
  assert.equal(ECHECS_AVANT_COURRIEL, ECHECS_AVANT_DEPANNAGE);
  assert.equal(RAPPEL_COURRIEL_MS, ECART_MINIMAL_DEPANNAGE_MS);
});

test('rien ne part avant trois échecs d’affilée', () => {
  for (const echecs of [0, 1, 2]) {
    const decision = decisionDeCourrielDePanne({}, echecs);
    assert.equal(decision.ecrire, false);
    assert.equal(decision.ecrire === false && decision.raison, 'pas-assez-d-echecs');
  }
});

test('le troisième échec écrit, une seule fois', () => {
  const premier = decisionDeCourrielDePanne({}, 3, 100);
  assert.deepEqual(premier, { ecrire: true, genre: 'panne' });
  // La fiche garde ce que le serveur y pose AVANT l'envoi.
  const notee: AlerteCourrielDuSite = { alerteCourrielLe: 100, alerteCourrielDepuis: 50 };
  for (const echecs of [4, 5, 20]) {
    const suivant = decisionDeCourrielDePanne(notee, echecs, 100 + 60_000);
    assert.equal(suivant.ecrire, false);
    assert.equal(suivant.ecrire === false && suivant.raison, 'rappel-trop-recent');
  }
});

test('un rappel toutes les six heures, pas un par passage', () => {
  const notee: AlerteCourrielDuSite = { alerteCourrielLe: HEURE, alerteCourrielDepuis: HEURE - 1_000 };
  const juste = decisionDeCourrielDePanne(notee, 12, HEURE + RAPPEL_COURRIEL_MS - 1);
  assert.equal(juste.ecrire, false);
  const apres = decisionDeCourrielDePanne(notee, 12, HEURE + RAPPEL_COURRIEL_MS);
  assert.deepEqual(apres, { ecrire: true, genre: 'rappel' });
});

test('un envoi refusé ne se rejoue pas au contrôle suivant : la date est posée avant, pas après', () => {
  // Le serveur note la date PUIS envoie. Même si l'envoi tombe, la fiche porte
  // la date : le passage suivant ne réécrit donc pas.
  const refuse: AlerteCourrielDuSite = { alerteCourrielLe: 1_000, alerteCourrielDepuis: 900 };
  const suivant = decisionDeCourrielDePanne(refuse, 9, 1_000 + 5 * 60_000);
  assert.equal(suivant.ecrire, false);
});

test('le mot de retour ne part qu’à qui a reçu la mauvaise nouvelle', () => {
  assert.equal(doitApaiserParCourriel({}), false);
  assert.equal(doitApaiserParCourriel({ alerteCourrielLe: 1 }), false);
  assert.equal(doitApaiserParCourriel({ alerteCourrielDepuis: 1 }), true);
});

/* ------------------------------------------------------------------ */
/* La panne entière, rejouée                                            */
/* ------------------------------------------------------------------ */

test('une panne de douze heures rejouée toutes les cinq minutes : deux courriels, pas cent quarante-cinq', () => {
  /*
   * LE SCÉNARIO COMPLET, tel que la tournée le joue : la fiche est la seule
   * mémoire, le compteur d'échecs monte, et l'on compte les courriels.
   */
  const fiche: AlerteCourrielDuSite = {};
  const envois: { genre: string; instant: number }[] = [];
  const PAS = 5 * 60_000;
  let passages = 0;
  let echecs = 0;
  let debutDeLaPanne = 0;
  for (let instant = 0; instant <= 12 * HEURE; instant += PAS) {
    passages += 1;
    echecs += 1;
    if (!debutDeLaPanne) debutDeLaPanne = instant;
    const decision = decisionDeCourrielDePanne(fiche, echecs, instant);
    if (!decision.ecrire) continue;
    envois.push({ genre: decision.genre, instant });
    // Ce que fait `marquerAlerteCourrielDuSite`, à l'identique.
    fiche.alerteCourrielLe = instant;
    fiche.alerteCourrielDepuis = fiche.alerteCourrielDepuis ?? debutDeLaPanne;
  }
  assert.equal(passages, 145);
  assert.deepEqual(
    envois.map((e) => e.genre),
    ['panne', 'rappel'],
  );
  assert.equal(envois[0].instant, 2 * PAS, 'le premier part au troisième échec');
  assert.ok(envois[1].instant - envois[0].instant >= RAPPEL_COURRIEL_MS);

  // Le site revient : le mot de fin, puis la fiche est vierge.
  assert.equal(doitApaiserParCourriel(fiche), true);
  delete fiche.alerteCourrielLe;
  delete fiche.alerteCourrielDepuis;
  assert.equal(doitApaiserParCourriel(fiche), false);
  // Et une chute suivante repart à zéro : le courriel de panne, pas un rappel.
  assert.deepEqual(decisionDeCourrielDePanne(fiche, 3, 20 * HEURE), { ecrire: true, genre: 'panne' });
});

test('un site qui clignote sans jamais atteindre le seuil n’écrit jamais', () => {
  const fiche: AlerteCourrielDuSite = {};
  for (let tour = 0; tour < 40; tour++) {
    const echecs = (tour % 3) + 1 === 3 ? 2 : (tour % 3) + 1; // jamais trois d'affilée
    const decision = decisionDeCourrielDePanne(fiche, Math.min(echecs, 2), tour * 5 * 60_000);
    assert.equal(decision.ecrire, false);
  }
});

/* ------------------------------------------------------------------ */
/* Ce que le courriel dit                                               */
/* ------------------------------------------------------------------ */

test('le courriel de panne dit le site, le verdict, le détail et ce qui est vérifié', () => {
  const courriel = courrielDePanneDuSite({
    site: site({
      recette: { type: 'appel', motAttendu: 'Connexion', explication: 'Remède : relancer le conteneur de facturation.' },
      etapeEchouee: 'appel de la page',
    }),
    controles: [
      { siteId: 's1', instant: 9 * HEURE, etat: 'panne', raison: 'serveur', code: 500, dureeMs: 20, detail: 'le serveur répond 500' },
      { siteId: 's1', instant: 8 * HEURE, etat: 'ok', dureeMs: 20 },
    ],
    echecsDeSuite: 3,
    genre: 'panne',
    maintenant: 10 * HEURE,
  });
  assert.equal(courriel.sujet, 'Facturation ne répond plus');
  assert.match(courriel.texte, /3 contrôles d’affilée/);
  assert.match(courriel.texte, /https:\/\/compta\.exemple\.test\//);
  assert.match(courriel.texte, /Erreur du serveur \(code 500\)/);
  assert.match(courriel.texte, /le serveur répond 500/);
  assert.match(courriel.texte, /Connexion/);
  assert.match(courriel.texte, /Remède : relancer le conteneur de facturation\./);
  // Le HTML suit le gabarit commun : accueil rouge et son illustration, blocs empilés, étapes, boutons.
  assert.match(courriel.html, /data-etat="rouge"/);
  assert.match(courriel.html, /INCIDENT EN COURS/);
  assert.match(courriel.html, /data-illustration="panne"/);
  assert.match(courriel.html, /Détail du dernier contrôle/);
  assert.equal((courriel.html.match(/data-etapes/g) ?? []).length, 1);
  assert.match(courriel.html, /Diagnostic probable/);
  assert.ok(courriel.html.includes(`href="${lienDeLaSurveillance('s1')}"`));
  assert.ok(courriel.html.includes('href="https://compta.exemple.test/"'));
  assert.deepEqual(ressourcesInterditesDuCourriel(courriel.html), []);
});

test('le rappel dit depuis combien de temps, et ne redit pas « ne répond plus »', () => {
  const courriel = courrielDePanneDuSite({
    site: site({ depuis: 4 * HEURE }),
    echecsDeSuite: 90,
    genre: 'rappel',
    maintenant: 10 * HEURE + 20 * 60_000,
  });
  assert.match(courriel.sujet, /toujours en panne \(6 h 20 min\)/);
  assert.match(courriel.texte, /toujours en panne, depuis 6 h 20 min/);
});

test('le mot de retour dit la durée de la panne, et rien de plus', () => {
  const courriel = courrielDeRetourDuSite({
    site: { nom: 'Facturation', url: 'https://compta.exemple.test/' },
    panneDepuis: 9 * HEURE,
    maintenant: 10 * HEURE,
  });
  assert.equal(courriel.sujet, 'Facturation répond de nouveau');
  assert.match(courriel.texte, /La panne a duré 1 h\./);
});

test('les durées et les verdicts se lisent en français', () => {
  assert.equal(phraseDeDuree(0), '0 min');
  assert.equal(phraseDeDuree(14 * 60_000), '14 min');
  assert.equal(phraseDeDuree(2 * HEURE), '2 h');
  assert.equal(phraseDeDuree(2 * HEURE + 5 * 60_000), '2 h 5 min');
  assert.equal(ligneDeVerdict({}), 'Serveur injoignable');
  assert.equal(ligneDeVerdict({ raison: 'contenu', etapeEchouee: 'vérifier « Bonjour »' }), 'Contenu attendu absent — étape « vérifier « Bonjour » »');
});

/* ------------------------------------------------------------------ */
/* La migration, et le branchement du serveur                           */
/* ------------------------------------------------------------------ */

test('la migration est ADDITIVE : une fiche d’avant reste lisible, sans alerte ni courriel', () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE sites_surveilles (
      id TEXT PRIMARY KEY,
      url TEXT NOT NULL,
      nom TEXT NOT NULL,
      etat TEXT NOT NULL
    );
  `);
  db.prepare('INSERT INTO sites_surveilles (id, url, nom, etat) VALUES (?, ?, ?, ?)').run('s1', 'https://x.test/', 'X', 'panne');
  const migration = MIGRATIONS.find((item) => item.name === 'surveillance-alerte-courriel');
  assert.ok(migration, 'la migration du courriel d’alerte existe');
  assert.equal(migration.siTable, 'sites_surveilles');
  db.exec(migration.sql);
  const ligne = db.prepare('SELECT * FROM sites_surveilles WHERE id = ?').get('s1') as Record<string, unknown>;
  assert.equal(ligne.alerte_courriel_le, null);
  assert.equal(ligne.alerte_courriel_depuis, null);
  // Une ligne d'avant n'a donc aucun courriel en cours : rien ne partira au
  // premier passage qui suit la mise en ligne.
  assert.equal(doitApaiserParCourriel({}), false);
  db.close();
});

test('la tournée note la date AVANT l’envoi, et charge le module de courriels seulement quand il sert', () => {
  const source = (fichier: string) => readFileSync(new URL(`../../src/${fichier}`, import.meta.url), 'utf8');
  const tournee = source('surveillance.ts');
  const envoi = source('alerte-courriel-site.ts');
  // L'import est dynamique : un simple contrôle ne charge pas le moteur de courriels.
  assert.match(tournee, /await import\('\.\/alerte-courriel-site\.js'\)/);
  assert.ok(!/^import .*alerte-courriel-site\.js/m.test(tournee), 'aucun import en tête de fichier');
  // La date est posée avant l'appel à l'envoyeur, dans cet ordre.
  const rangDuMarquage = envoi.indexOf('marquerAlerteCourrielDuSite(site.id');
  const rangDeLEnvoi = envoi.indexOf('await envoyer(sujet, texte, html)');
  assert.ok(rangDuMarquage > 0 && rangDeLEnvoi > rangDuMarquage, 'la date est notée avant l’envoi');
  // Aucun destinataire écrit en dur : celui du point quotidien, et lui seul.
  assert.match(envoi, /adresseDuRecapitulatif/);
  assert.ok(!/@haiko\.studio/.test(envoi), 'aucune adresse en dur dans le module d’envoi');
  // Les dates sont effacées avant l'écriture du mot d'apaisement.
  const rangDuMenage = tournee.indexOf('refermerAlerteCourrielDuSite(site.id)');
  const rangDeLApaisement = tournee.indexOf('aApaiser.push(');
  assert.ok(rangDuMenage > 0 && rangDeLApaisement > rangDuMenage, 'la fiche est nettoyée avant le mot de retour');
});
