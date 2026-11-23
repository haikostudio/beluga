import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ECART_MINIMAL_DEPANNAGE_MS,
  ECHECS_AVANT_DEPANNAGE,
  LABEL_PANNE_SITE,
  type ControleSurveillance,
  type SiteSurveille,
  decisionDeDepannage,
  degreDeCorrespondance,
  demandeDePanne,
  descriptionDeCarteDePanne,
  echecsDeSuiteDuSite,
  hoteDeLAdresse,
  noteDeNouvelleChute,
  projetDevineDuSite,
  titreDeCarteDePanne,
  tourDeCadrageSansQuestion,
} from '@beluga/shared';

/**
 * LE DÉPANNAGE AUTOMATIQUE D'UN SITE — les règles qui se jugent sans base ni
 * réseau : le compteur d'échecs, la reconnaissance du projet d'après l'adresse,
 * la carte unique par panne et l'écart minimal de six heures.
 *
 * C'est la SEULE exception à « rien ne part sans un clic », et elle s'arrête au
 * plan : les tests de fin de fichier lisent la source pour s'en assurer.
 */

const controle = (instant: number, etat: 'ok' | 'panne'): ControleSurveillance => ({
  siteId: 's1',
  instant,
  etat,
  dureeMs: 12,
  ...(etat === 'panne' ? { raison: 'serveur' as const, code: 500 } : {}),
});

const site = (extra: Partial<SiteSurveille> = {}): SiteSurveille => ({
  id: 's1',
  url: 'https://boutique.exemple.test/',
  nom: 'Boutique',
  etat: 'panne',
  verifieLe: 1_000,
  depuis: 900,
  dernierePanne: 1_000,
  creeLe: 0,
  ...extra,
});

/* ------------------------------------------------------------------ */
/* Le compteur d'échecs                                                 */
/* ------------------------------------------------------------------ */

test('les échecs d’affilée se comptent depuis le plus récent', () => {
  assert.equal(echecsDeSuiteDuSite([controle(1, 'panne'), controle(2, 'panne'), controle(3, 'panne')]), 3);
  // L'ordre d'arrivée ne compte pas : la fonction retrie elle-même.
  assert.equal(echecsDeSuiteDuSite([controle(3, 'panne'), controle(1, 'panne'), controle(2, 'panne')]), 3);
  assert.equal(echecsDeSuiteDuSite([]), 0);
});

test('UN SEUL CONTRÔLE RÉUSSI REMET LE COMPTEUR À ZÉRO', () => {
  // Deux échecs, puis un succès, puis deux échecs : seuls les deux derniers comptent.
  const controles = [controle(1, 'panne'), controle(2, 'panne'), controle(3, 'ok'), controle(4, 'panne'), controle(5, 'panne')];
  assert.equal(echecsDeSuiteDuSite(controles), 2);
  // Le succès est le plus récent : plus aucun échec d'affilée.
  assert.equal(echecsDeSuiteDuSite([...controles, controle(6, 'ok')]), 0);
});

test('DEUX ÉCHECS SUIVIS D’UN SUCCÈS N’OUVRENT AUCUNE CARTE', () => {
  const deux = echecsDeSuiteDuSite([controle(1, 'panne'), controle(2, 'panne')]);
  assert.equal(decisionDeDepannage(site(), deux, 10_000).depanner, false);
  const apresSucces = echecsDeSuiteDuSite([controle(1, 'panne'), controle(2, 'panne'), controle(3, 'ok')]);
  assert.equal(decisionDeDepannage(site({ etat: 'ok' }), apresSucces, 10_000).depanner, false);
});

/* ------------------------------------------------------------------ */
/* La décision                                                          */
/* ------------------------------------------------------------------ */

test('trois échecs d’affilée déclenchent le dépannage', () => {
  assert.deepEqual(decisionDeDepannage(site(), ECHECS_AVANT_DEPANNAGE, 10_000), { depanner: true });
});

test('UNE SEULE CARTE PAR PANNE : un quatrième et un cinquième échec n’en ouvrent pas d’autre', () => {
  const avecCarte = site({ incidentCardId: 'c1', incidentDepuis: 5_000, incidentLanceLe: 5_000 });
  for (const echecs of [4, 5, 12]) {
    assert.deepEqual(decisionDeDepannage(avecCarte, echecs, 10_000), {
      depanner: false,
      raison: 'carte-deja-ouverte',
    });
  }
});

test('AU PLUS UNE CARTE TOUTES LES SIX HEURES : un site qui revient puis retombe attend', () => {
  // La carte a été refermée (le site est revenu), mais le lancement est récent.
  const revenu = site({ incidentLanceLe: 1_000_000 });
  assert.deepEqual(decisionDeDepannage(revenu, ECHECS_AVANT_DEPANNAGE, 1_000_000 + ECART_MINIMAL_DEPANNAGE_MS - 1), {
    depanner: false,
    raison: 'trop-recent',
  });
  // Six heures plus tard, une nouvelle panne ouvre bien une nouvelle carte.
  assert.deepEqual(decisionDeDepannage(revenu, ECHECS_AVANT_DEPANNAGE, 1_000_000 + ECART_MINIMAL_DEPANNAGE_MS), {
    depanner: true,
  });
});

test('la date de lancement est ce qui borne, même si le tour a échoué', () => {
  // Aucune carte n'a été posée (le tour est mort), mais la date est là : on
  // n'essaie pas de nouveau à chaque contrôle.
  const rate = site({ incidentLanceLe: 2_000, incidentCardId: undefined });
  assert.equal(decisionDeDepannage(rate, ECHECS_AVANT_DEPANNAGE, 3_000).depanner, false);
});

/* ------------------------------------------------------------------ */
/* Le projet deviné d'après l'adresse                                   */
/* ------------------------------------------------------------------ */

test('l’hôte se lit avec ou sans protocole, et le chemin ne compte pas', () => {
  assert.equal(hoteDeLAdresse('https://Exemple.TEST/page?x=1'), 'exemple.test');
  assert.equal(hoteDeLAdresse('exemple.test'), 'exemple.test');
  assert.equal(hoteDeLAdresse(''), null);
  assert.equal(hoteDeLAdresse('   '), null);
});

test('SEULS LE DOMAINE ET SES SOUS-DOMAINES COMPTENT', () => {
  assert.equal(degreDeCorrespondance('exemple.test', 'exemple.test'), 2);
  assert.equal(degreDeCorrespondance('boutique.exemple.test', 'exemple.test'), 1);
  // L'inverse n'est pas vrai, et un nom qui finit par les mêmes lettres non plus.
  assert.equal(degreDeCorrespondance('exemple.test', 'boutique.exemple.test'), 0);
  assert.equal(degreDeCorrespondance('faux-exemple.test', 'exemple.test'), 0);
});

test('un site dont l’adresse correspond à un projet est rattaché à ce projet', () => {
  const projets = [
    { id: 'p1', nom: 'Boutique', adresses: ['https://boutique.exemple.test'] },
    { id: 'p2', nom: 'Autre', adresses: ['https://autre.test'] },
  ];
  assert.deepEqual(projetDevineDuSite('https://boutique.exemple.test/panier', projets), { id: 'p1', nom: 'Boutique' });
});

test('LE PROJET QUI COLLE EXACTEMENT L’EMPORTE SUR SON DOMAINE PARENT', () => {
  const projets = [
    { id: 'p1', nom: 'Parent', adresses: ['https://exemple.test'] },
    { id: 'p2', nom: 'Boutique', adresses: ['https://boutique.exemple.test'] },
  ];
  assert.deepEqual(projetDevineDuSite('https://boutique.exemple.test', projets), { id: 'p2', nom: 'Boutique' });
});

test('UNE AMBIGUÏTÉ N’IMPOSE RIEN, ET UNE ADRESSE INCONNUE NON PLUS', () => {
  const deuxFois = [
    { id: 'p1', nom: 'Un', adresses: ['https://exemple.test'] },
    { id: 'p2', nom: 'Deux', adresses: ['https://exemple.test/autre-chemin'] },
  ];
  assert.equal(projetDevineDuSite('https://exemple.test', deuxFois), null);
  assert.equal(projetDevineDuSite('https://inconnu.test', deuxFois), null);
  assert.equal(projetDevineDuSite('https://exemple.test', []), null);
});

test('une adresse vide ou illisible ne rattache rien', () => {
  const projets = [{ id: 'p1', nom: 'Un', adresses: ['https://exemple.test'] }];
  assert.equal(projetDevineDuSite('', projets), null);
  // Une adresse sans hôte lisible ne peut correspondre à personne.
  assert.equal(projetDevineDuSite('pas une adresse du tout', projets), null);
});

/* ------------------------------------------------------------------ */
/* Le titre, la description et la demande                               */
/* ------------------------------------------------------------------ */

test('le titre de la carte nomme le site, et se coupe s’il est trop long', () => {
  assert.equal(titreDeCarteDePanne('Boutique'), 'Panne de Boutique');
  assert.ok(titreDeCarteDePanne('x'.repeat(200)).length < 70);
  assert.equal(titreDeCarteDePanne('  '), 'Panne de un site surveillé');
});

test('la description dit que rien ne sera corrigé sans accord', () => {
  const texte = descriptionDeCarteDePanne({ nom: 'Boutique', url: 'https://boutique.exemple.test' });
  assert.match(texte, /Boutique/);
  assert.match(texte, /attend votre accord/);
  assert.match(texte, /rien n’est corrigé/i);
});

test('LA DEMANDE PORTE TOUT CE QUE LA SURVEILLANCE SAIT, ET EXIGE LE PLAN', () => {
  const texte = demandeDePanne({
    site: site({ code: 500, raison: 'serveur', etapeEchouee: 'étape 2 (cliquer)', recette: { type: 'appel', motAttendu: 'Panier' } }),
    projet: { nom: 'Boutique', chemin: '/root/boutique', rattache: true, devine: false },
    controles: [controle(1, 'panne'), controle(2, 'panne'), controle(3, 'panne')],
    echecsDeSuite: 3,
  });
  assert.match(texte, /https:\/\/boutique\.exemple\.test/);
  assert.match(texte, /Erreur du serveur/);
  assert.match(texte, /code 500/);
  assert.match(texte, /étape 2 \(cliquer\)/);
  assert.match(texte, /rendre_comprehension/);
  assert.match(texte, /plan/i);
  // Personne n'attend devant l'écran : aucune question — et le garde-fou des suppositions le reconnaît.
  assert.equal(tourDeCadrageSansQuestion(texte), true);
  assert.match(texte, /N’APPELLE|NE POSE AUCUNE QUESTION/);
  assert.match(texte, /ask_user/);
  // Plus aucune supposition (06/10/2026) : ce que seul l'utilisateur tranche se prépare en question sur la carte.
  assert.match(texte, /se PRÉPARE dans le champ « questions »/);
  assert.match(texte, /« recommandee »/);
  assert.doesNotMatch(texte, /je suppose/i);
});

test('AUCUN SECRET DANS LE RÉCIT DE LA PANNE : la recette ne porte que des références', () => {
  const texte = demandeDePanne({
    site: site({
      recette: {
        type: 'parcours',
        etapes: [
          { action: 'aller', url: 'https://boutique.exemple.test/connexion' },
          { action: 'remplir', selecteur: '#pass', acces: { id: 'fiche-42', champ: 'motDePasse' } },
        ],
      },
    }),
    projet: { nom: 'Boutique', chemin: '/root/boutique', rattache: true, devine: false },
    controles: [controle(1, 'panne')],
    echecsDeSuite: 3,
  });
  assert.match(texte, /aucun secret/i);
  assert.ok(!/motdepasse\s*=/i.test(texte), 'aucune valeur de mot de passe ne doit apparaître');
});

test('un projet DEVINÉ est annoncé comme tel, et l’absence de projet aussi', () => {
  const commun = { site: site(), controles: [controle(1, 'panne')], echecsDeSuite: 3 };
  const devine = demandeDePanne({ ...commun, projet: { nom: 'Boutique', chemin: '/x', rattache: true, devine: true } });
  assert.match(devine, /DEVINÉ/);
  const sansProjet = demandeDePanne({ ...commun, projet: { nom: 'Beluga Build', chemin: '/x', rattache: false, devine: false } });
  assert.match(sansProjet, /Aucun projet n’est rattaché/);
});

test('la note d’une carte reprise dit que le site est retombé', () => {
  const note = noteDeNouvelleChute({ nom: 'Boutique' }, 1_700_000_000_000);
  assert.match(note, /Boutique est retombé/);
  assert.match(note, /n’en a pas ouvert une seconde/);
});

/* ------------------------------------------------------------------ */
/* Les invariants, lus dans la source                                   */
/* ------------------------------------------------------------------ */

const SOURCE = (fichier: string): string => readFileSync(new URL(`../../src/${fichier}`, import.meta.url), 'utf8');

test('L’ÉTIQUETTE DE LA CARTE EST PROPRE AUX PANNES DÉTECTÉES', () => {
  assert.equal(LABEL_PANNE_SITE, 'panne détectée');
  assert.match(SOURCE('depannage-site.ts'), /labels: \[LABEL_PANNE_SITE\]/);
});

test('LA CARTE SUIT LE CHEMIN D’UNE CARTE OUVERTE À LA MAIN, JAMAIS CELUI D’UNE CARTE D’AGENT DU DÉMON', () => {
  const source = SOURCE('depannage-site.ts');
  assert.match(source, /createCard\(/);
  assert.match(source, /ouvrirLeCadrage\(/);
  assert.ok(!source.includes('ouvrirCarteDAgent('), 'une carte de panne ne naît pas en « En cours » sans branche');
});

test('LE PLAN EST DEMANDÉ PAR LE CHEMIN ORDINAIRE, APRÈS L’ENQUÊTE', () => {
  const source = SOURCE('depannage-site.ts');
  assert.match(source, /sendPrompt\(cadrage\.id/);
  assert.match(source, /demanderLePlan\(card\.id\)/);
});

test('LA DATE DE LANCEMENT EST POSÉE AVANT LE TOUR, JAMAIS APRÈS', () => {
  const source = SOURCE('depannage-site.ts');
  const marque = source.indexOf('marquerIncidentDuSite(site.id, card.id');
  const tour = source.indexOf('sendPrompt(cadrage.id');
  assert.ok(marque > 0 && tour > 0, 'les deux appels doivent exister');
  assert.ok(marque < tour, 'l’incident se note avant que le tour ne parte');
});

test('LE PROJET DU SITE NE SE CONFOND PAS AVEC CELUI DE SON AGENT DE CONFIGURATION', () => {
  const source = SOURCE('depannage-site.ts');
  // Le projet d'accueil se lit sur `projetRattache`, jamais sur `projectId`.
  assert.match(source, /site\.projetRattache/);
  assert.ok(!/site\.projectId/.test(source), 'projectId désigne l’agent de configuration, pas le site');
});

test('LE DÉCLENCHEUR TOURNE HORS DE LA BOUCLE PARALLÈLE DES CONTRÔLES', () => {
  const source = SOURCE('surveillance.ts');
  const boucle = source.indexOf('await Promise.all(');
  const declencheur = source.indexOf('for (const siteId of aDepanner)');
  assert.ok(boucle > 0 && declencheur > boucle, 'le dépannage se joue après la tournée, comme l’alerte');
});

test('UN CONTRÔLE RÉUSSI REFERME L’INCIDENT, ET LAISSE L’ÉCART DE SIX HEURES', () => {
  const source = SOURCE('surveillance.ts');
  assert.match(source, /refermerIncidentDuSite/);
  const referme = source.split('export function refermerIncidentDuSite(')[1].split('\n}')[0];
  assert.match(referme, /incident_card_id = NULL/);
  assert.ok(!referme.includes('incident_lance_le'), 'la date du dernier lancement n’est jamais effacée');
});

test('L’ALERTE ENVOYÉE AU PREMIER ÉCHEC EST TOUJOURS LÀ', () => {
  const source = SOURCE('surveillance.ts');
  assert.match(source, /motif: 'site-indisponible'/);
  assert.match(source, /reference: `site:\$\{site\.id\}`/);
});
