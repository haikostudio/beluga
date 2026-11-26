/**
 * L'ÉQUIPE D'AGENTS — les règles pures (`shared/src/equipe-d-agents.ts`) et la garde P0 du module du démon.
 *
 * Ce que ces essais verrouillent : l'équipe par défaut (cinq métiers dans un projet, deux dans un groupe, déploiement
 * et production seulement avec une mise en ligne) ; un semis rejoué ne double JAMAIS un rôle et ne ramène pas un rôle
 * retiré ; Eliot (« Eliot - Comm Haiko ») est reconnu comme la communication ; deux agents d'une équipe n'ont jamais
 * le même visage ; l'état d'un membre met ce qui attend l'utilisateur en premier ; un message à toute l'équipe va au
 * bon métier ; la garde anti-boucle refuse soi-même, les chaînes trop longues et le ping-pong ; les liaisons de la
 * table ; les places autour de la table à pas égal ; et — règle P0 — aucun chemin de l'équipe ne publie, ne déploie,
 * n'envoie, ne paie ni ne supprime.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ECHANGES_PAR_HEURE_ENTRE_DEUX,
  EQUIPE_DU_GROUPE,
  EQUIPE_DU_PROJET,
  GESTES_AU_CLIC,
  GESTES_A_VALIDER,
  GESTES_PAR_L_EQUIPE,
  OUTILS_DU_ROLE,
  PORTRAITS,
  PROFONDEUR_MAX_D_ECHANGE,
  VOUS,
  adresseDuPortrait,
  controleDeLaLiaison,
  couleurDeLAgent,
  destinataireDuMessage,
  ecrireRubrique,
  etatDuMembre,
  ficheComplete,
  ficheDUnMembre,
  ficheVide,
  liaisonsDeLEquipe,
  membresASemer,
  outilsDeLAgent,
  placesAutourDeLaTable,
  portraitLibre,
  rangDeLEtat,
  refusDEchange,
  roleDevine,
  tailleDesPortraits,
} from '@beluga/shared';

test('l’équipe par défaut : cinq métiers dans un projet, deux dans un groupe', () => {
  assert.deepEqual(
    membresASemer([], { groupe: false, aUneMiseEnLigne: true }).map((m) => m.role),
    ['dev', 'com', 'marketing', 'deploiement', 'production'],
  );
  assert.deepEqual(
    membresASemer([], { groupe: false, aUneMiseEnLigne: false }).map((m) => m.role),
    ['dev', 'com', 'marketing'],
    'sans mise en ligne, ni déploiement ni production',
  );
  assert.deepEqual(
    membresASemer([], { groupe: true, aUneMiseEnLigne: false }).map((m) => m.role),
    EQUIPE_DU_GROUPE.map((m) => m.role),
  );
  // Mêmes prénoms d'un projet à l'autre.
  assert.deepEqual(
    EQUIPE_DU_PROJET.map((m) => m.prenom),
    ['Max', 'Eliot', 'Zoé', 'Karim', 'Victor'],
  );
});

test('un semis rejoué ne double rien, et un rôle retiré ne revient pas', () => {
  const premier = membresASemer([], { groupe: false, aUneMiseEnLigne: true });
  assert.deepEqual(membresASemer(premier, { groupe: false, aUneMiseEnLigne: true }), [], 'rejoué : rien de plus');
  // Eliot existe déjà (créé à la main) : pas de second « com ».
  const avecEliot = membresASemer([{ role: 'com' }], { groupe: false, aUneMiseEnLigne: true });
  assert.equal(avecEliot.filter((m) => m.role === 'com').length, 0);
  assert.equal(avecEliot.length, 4);
  const sansMarketing = membresASemer([], { groupe: false, aUneMiseEnLigne: true, retires: ['marketing'] });
  assert.ok(!sansMarketing.some((m) => m.role === 'marketing'));
});

test('la reprise : le métier d’un agent d’avant les équipes se devine de sa fiche', () => {
  assert.equal(roleDevine({ nom: 'Eliot - Comm Haiko', mission: 'Gérer la communication de Haiko Studio' }), 'com');
  assert.equal(roleDevine({ nom: 'Veille SEO', mission: 'Suivre le référencement' }), 'marketing');
  assert.equal(roleDevine({ nom: 'Veilleur des demandes', mission: 'Lire les demandes des clients' }), 'libre');
});

test('un membre semé a une fiche complète, et la production se réveille sur les événements du site', () => {
  for (const m of EQUIPE_DU_PROJET) {
    const fiche = ficheDUnMembre(m);
    assert.ok(ficheComplete(fiche), `${m.prenom} : fiche complète`);
    assert.equal(fiche.nom, m.prenom);
    assert.deepEqual(fiche.faitSeul, [], 'il ne fait rien seul d’office');
  }
  const victor = ficheDUnMembre(EQUIPE_DU_PROJET.find((m) => m.role === 'production')!);
  assert.deepEqual(
    victor.declencheurs.map((d) => (d.genre === 'evenement' ? d.source : d.genre)),
    ['surveillance.panne', 'publication.terminee', 'backup.echec', 'securite.alerte'],
  );
});

test('les outils de chaque métier, et ceux d’un agent libre bornés au catalogue', () => {
  assert.deepEqual(OUTILS_DU_ROLE.com, ['calendrier', 'reseaux', 'studio']);
  assert.deepEqual(OUTILS_DU_ROLE.marketing, ['dossier', 'referencement', 'statistiques']);
  assert.deepEqual(outilsDeLAgent('dev', ['studio']), ['taches', 'apercu'], 'un métier garde ses outils');
  assert.deepEqual(outilsDeLAgent('libre', ['studio', 'inconnu', 'studio', 'statistiques']), ['studio', 'statistiques']);
});

test('la réserve : une cinquantaine de visages, et jamais deux fois le même dans une équipe', () => {
  assert.ok(PORTRAITS.length >= 50, `${PORTRAITS.length} portraits`);
  assert.equal(new Set(PORTRAITS.map((p) => p.id)).size, PORTRAITS.length);
  for (const p of PORTRAITS) assert.match(p.couleur, /^#[0-9a-f]{6}$/);
  const pris: string[] = [];
  for (let i = 0; i < 25; i++) pris.push(portraitLibre(pris, i < 5 ? EQUIPE_DU_PROJET[i]!.portrait : null, 12345));
  assert.equal(new Set(pris).size, 25, 'vingt-cinq agents, vingt-cinq visages');
  assert.equal(pris[0], 'max', 'le portrait voulu, quand il est libre');
  assert.equal(portraitLibre(['max'], 'max', 0) !== 'max', true, 'pris : un autre');
  assert.equal(adresseDuPortrait('max'), '/portraits/max.webp');
  assert.equal(adresseDuPortrait('/api/attachments/abc'), '/api/attachments/abc', 'une photo téléversée garde son adresse');
  assert.equal(couleurDeLAgent('#ABCDEF', 'max'), '#abcdef');
  assert.equal(couleurDeLAgent(null, 'max'), PORTRAITS.find((p) => p.id === 'max')!.couleur);
});

test('l’état d’un membre : ce qui attend l’utilisateur passe avant le travail', () => {
  assert.equal(etatDuMembre({ attentes: 1, enPassage: true }), 'vous-attend');
  assert.equal(etatDuMembre({ attentes: 0, enPassage: true }), 'au-travail');
  assert.equal(etatDuMembre({ attentes: 0, enPassage: false, tachesAuTravail: 2 }), 'au-travail', 'le développement travaille par ses tâches');
  assert.equal(etatDuMembre({ attentes: 0, enPassage: false, tachesQuiAttendent: 1 }), 'vous-attend');
  assert.equal(etatDuMembre({ attentes: 0, enPassage: false }), 'repos');
  assert.ok(rangDeLEtat('vous-attend') < rangDeLEtat('au-travail') && rangDeLEtat('au-travail') < rangDeLEtat('repos'));
});

test('un message à toute l’équipe va au métier qui correspond, à défaut au développement', () => {
  const equipe = [
    { id: 'max', role: 'dev' as const },
    { id: 'eliot', role: 'com' as const },
    { id: 'zoe', role: 'marketing' as const },
    { id: 'karim', role: 'deploiement' as const },
    { id: 'victor', role: 'production' as const },
  ];
  assert.equal(destinataireDuMessage('Prépare les posts LinkedIn de décembre', equipe)?.id, 'eliot');
  assert.equal(destinataireDuMessage('Analyse nos concurrents et le référencement', equipe)?.id, 'zoe');
  assert.equal(destinataireDuMessage('Tu peux déployer les deux tâches ?', equipe)?.id, 'karim');
  assert.equal(destinataireDuMessage('Les sauvegardes de cette nuit ont-elles marché ?', equipe)?.id, 'victor');
  assert.equal(destinataireDuMessage('Le bouton du formulaire ne répond plus', equipe)?.id, 'max');
});

test('la garde anti-boucle : soi-même, chaîne trop longue, ping-pong', () => {
  const t = 1_800_000_000_000;
  assert.equal(refusDEchange({ de: VOUS, a: 'zoe', profondeur: 0 }, [], t), null, 'l’utilisateur n’est jamais refusé');
  assert.match(refusDEchange({ de: 'eliot', a: 'eliot', profondeur: 1 }, [], t) ?? '', /lui-même/);
  assert.match(refusDEchange({ de: 'eliot', a: 'zoe', profondeur: PROFONDEUR_MAX_D_ECHANGE + 1 }, [], t) ?? '', /Chaîne trop longue/);
  assert.equal(refusDEchange({ de: 'eliot', a: 'zoe', profondeur: PROFONDEUR_MAX_D_ECHANGE }, [], t), null);
  const pingPong = Array.from({ length: ECHANGES_PAR_HEURE_ENTRE_DEUX }, (_, i) => ({ de: i % 2 ? 'eliot' : 'zoe', a: i % 2 ? 'zoe' : 'eliot', date: t - i * 60_000 }));
  assert.match(refusDEchange({ de: 'eliot', a: 'zoe', profondeur: 1 }, pingPong, t) ?? '', /tournez en rond/);
  // Une heure plus tard, la paire peut reparler.
  assert.equal(refusDEchange({ de: 'eliot', a: 'zoe', profondeur: 1 }, pingPong, t + 2 * 3_600_000), null);
  assert.equal(refusDEchange({ de: 'eliot', a: 'max', profondeur: 1 }, pingPong, t), null, 'un autre collègue reste joignable');
});

test('les liaisons de la table : une par paire d’agents, la plus récente d’abord, jamais l’utilisateur', () => {
  const t = 1_800_000_000_000;
  const membres = new Set(['eliot', 'zoe', 'max']);
  const liaisons = liaisonsDeLEquipe(
    [
      { de: 'eliot', a: 'zoe', date: t - 1000 },
      { de: 'zoe', a: 'eliot', date: t - 500 },
      { de: 'eliot', a: 'max', date: t - 100 },
      { de: VOUS, a: 'max', date: t },
      { de: 'eliot', a: 'zoe', date: t - 3 * 86_400_000 },
    ],
    membres,
    t,
  );
  assert.deepEqual(liaisons, [
    ['eliot', 'max'],
    ['eliot', 'zoe'],
  ]);
});

test('les places autour de la table : à pas égal, la première en haut au centre', () => {
  const cadre = { x0: 96, y0: 150, x1: 488, y1: 640, rayon: 90 };
  const places = placesAutourDeLaTable(10, cadre);
  assert.equal(places.length, 10);
  assert.deepEqual(places[0], { x: 292, y: 150 });
  for (const p of places) {
    assert.ok(p.x >= cadre.x0 - 0.5 && p.x <= cadre.x1 + 0.5 && p.y >= cadre.y0 - 0.5 && p.y <= cadre.y1 + 0.5, `${p.x},${p.y} sur le contour`);
  }
  // Pas égal : les distances entre voisins sont proches (le contour est arrondi, d'où une tolérance).
  const d = places.map((p, i) => Math.hypot(p.x - places[(i + 1) % 10]!.x, p.y - places[(i + 1) % 10]!.y));
  assert.ok(Math.max(...d) - Math.min(...d) < 40, `écarts ${d.map((x) => x.toFixed(0)).join(', ')}`);
  assert.deepEqual(placesAutourDeLaTable(0, cadre), []);
  const c = controleDeLaLiaison({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 100 });
  assert.deepEqual(c, { x: 50, y: 50 });
  assert.ok(tailleDesPortraits(3) > tailleDesPortraits(20));
});

test('P0 : les gestes de publication restent à l’utilisateur, le code passe par l’équipe', () => {
  assert.deepEqual([...GESTES_AU_CLIC], ['deployer', 'mettre_en_production']);
  assert.deepEqual([...GESTES_PAR_L_EQUIPE], ['lancer_carte', 'modifier_code']);
  assert.ok(GESTES_A_VALIDER.includes('publier') && GESTES_A_VALIDER.includes('envoyer_au_client') && GESTES_A_VALIDER.includes('payer') && GESTES_A_VALIDER.includes('supprimer'));
  // Rien de cela ne s'écrit dans « ce qu'il fait seul ».
  for (const ligne of ['Publier les posts', 'Déployer le site', 'Mettre en production', 'Envoyer la réponse au client', 'Payer la facture', 'Supprimer les vieux fichiers']) {
    assert.equal(ecrireRubrique(ficheVide(), 'seul', [ligne]).ok, false, ligne);
  }
});

test('P0 : le module de l’équipe n’atteint aucun geste de publication, d’envoi, de paiement ni de suppression', () => {
  const ici = path.dirname(fileURLToPath(import.meta.url));
  const source = fs.readFileSync(path.resolve(ici, '..', '..', 'src', 'equipe-d-agents.ts'), 'utf8');
  for (const interdit of ['./deploy.js', './production.js', 'startDeploy', 'miseEnProduction', 'lancerLaMiseEnProduction', 'envoyerAuClient', 'deleteCard', 'supprimerLaCarte', 'paiement', 'stripe']) {
    assert.ok(!source.includes(interdit), `le module de l’équipe ne touche pas à ${interdit}`);
  }
});
