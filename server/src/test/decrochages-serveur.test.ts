import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ECART_MINIMAL_ENQUETE_MS,
  INCIDENTS_AVANT_ENQUETE,
  type CoupureDuNavigateur,
  type LigneDesDecrochages,
  arretsVoulusDuJournalDuDemon,
  coupureSubieDuNavigateur,
  decisionDEnquete,
  demandeDEnqueteDecrochages,
  figementsDuJournalDuDemon,
  incidentsDeDecrochage,
  incidentsNonSignales,
  ligneDeFermetureDuCanal,
  ligneDesDecrochages,
  lireLigneDesDecrochages,
  noteDeNouveauxDecrochages,
} from '@beluga/shared';

const MIN = 60_000;
const H = 60 * MIN;
const T0 = Date.parse('2026-10-28T06:00:00Z');

const ligne = (instant: number, genre: string, releve: string | null = null): LigneDesDecrochages => ({ instant, genre, releve, detail: null });
const coupure = (instant: number): CoupureDuNavigateur => ({ instant, geste: 'prefs.set', muetDepuisS: 20 });

test('le journal se relit tel que le démon et le surveillant l’écrivent', () => {
  const ecrite = ligneDesDecrochages({ instant: T0, genre: 'relance-voulue', detail: 'bouton\tavec tab' });
  assert.match(ecrite, /\n$/);
  assert.deepEqual(lireLigneDesDecrochages(ecrite.trim()), { instant: T0, genre: 'relance-voulue', releve: null, detail: 'bouton avec tab' });
  // La ligne du surveillant (bash) : instant, genre, relevé, détail.
  assert.deepEqual(lireLigneDesDecrochages(`${T0}\tsilence\t20261028T060000Z-silence-1.txt\tsilence 1/3`), {
    instant: T0,
    genre: 'silence',
    releve: '20261028T060000Z-silence-1.txt',
    detail: 'silence 1/3',
  });
  assert.equal(lireLigneDesDecrochages('abîmée'), null);
  assert.equal(lireLigneDesDecrochages(''), null);
});

test('une coupure ne compte que si le serveur l’a fait subir, pas une page endormie', () => {
  const subie = coupureSubieDuNavigateur({
    source: 'canal',
    message: 'geste non parti : prefs.set',
    pile: 'canal : en ouverture\ndernière fermeture : fermé par le navigateur ou le serveur (code 1006) il y a 2.1 s\ndernier message reçu : il y a 22.7 s\nveille : non · page cachée : non · réseau : en ligne',
    at: T0,
  });
  assert.deepEqual(subie, { instant: T0, geste: 'prefs.set', muetDepuisS: 22.7 });
  const veille = coupureSubieDuNavigateur({
    source: 'canal',
    message: 'geste non parti : strategie',
    pile: 'canal : en ouverture\ndernière fermeture : mise en veille il y a 852.8 s\nveille : non · page cachée : non · réseau : en ligne',
    at: T0,
  });
  assert.equal(veille, null);
  assert.equal(coupureSubieDuNavigateur({ source: 'canal', message: 'geste non parti : x', pile: 'réseau : hors ligne', at: T0 }), null);
  assert.equal(coupureSubieDuNavigateur({ source: 'fenetre', message: 'TypeError', at: T0 }), null);
});

test('UNE PAGE QUI SE CHARGE N’EST PAS UN DÉCROCHAGE, une page qui n’arrive jamais à se connecter l’est', () => {
  // Les lignes réelles du 27/10 à 11:10 : quatre demandes de chargement, sur l'ordinateur.
  const chargement = (instant: number, geste: string) => ({
    source: 'canal',
    message: `geste non parti : ${geste}`,
    pile: 'canal : en ouverture\ncoupé depuis : jamais\ndernière fermeture : aucune\ndernière commande envoyée : aucune\ndernier message reçu : jamais\nveille : non · page cachée : non · réseau : en ligne',
    at: instant,
  });
  const releves = [
    chargement(T0, 'installation.nouveautes'),
    chargement(T0, 'cards.enRoute'),
    chargement(T0 + 33_000, 'installation.nouveautes'),
    chargement(T0 + 57_000, 'installation.nouveautes'),
  ];
  const coupures = releves.map(coupureSubieDuNavigateur).filter((c): c is CoupureDuNavigateur => c !== null);
  assert.equal(coupures.length, 0);
  assert.equal(incidentsDeDecrochage({ journal: [], coupures, maintenant: T0 + MIN }).length, 0);

  // Le client a attendu l'ouverture et a renoncé : c'est une vraie panne.
  const attendu = { ...chargement(T0, 'cards.enRoute'), pile: `${chargement(T0, 'x').pile}\nattente de l’ouverture : 10 s` };
  assert.deepEqual(coupureSubieDuNavigateur(attendu), { instant: T0, geste: 'cards.enRoute', muetDepuisS: null });

  // Les lignes réelles du 27/10 à 22:34 : une vraie fermeture (1006), comptée.
  const fermeture = (instant: number, canal: string, depuis: string) => ({
    source: 'canal',
    message: 'geste non parti : prefs.set',
    pile: `canal : ${canal}\ncoupé depuis : il y a ${depuis} s\ndernière fermeture : fermé par le navigateur ou le serveur (code 1006) il y a ${depuis} s\ndernière commande envoyée : ping il y a 7.5 s\ndernier message reçu : il y a 24.6 s\nveille : non · page cachée : non · réseau : en ligne`,
    at: instant,
  });
  const vraies = [fermeture(T0, 'fermé', '0.6'), fermeture(T0 + 1_000, 'en ouverture', '1.4'), fermeture(T0 + 17_000, 'en ouverture', '1.4')]
    .map(coupureSubieDuNavigateur)
    .filter((c): c is CoupureDuNavigateur => c !== null);
  assert.equal(vraies.length, 3);
  const incidents = incidentsDeDecrochage({ journal: [], coupures: vraies, maintenant: T0 + MIN });
  assert.deepEqual(incidents.map((i) => [i.genre, i.nombre]), [['coupures-navigateur', 3]]);
});

test('les relances voulues se lisent dans le journal du démon', () => {
  const texte = [
    '[2026-10-28T06:51:02.123Z] INFO redémarrage demandé depuis l’interface',
    '[2026-10-28T06:52:00.000Z] INFO écoute sur 7070',
    '[2026-10-28T07:10:00.000Z] INFO arrêt demandé (SIGTERM)',
  ].join('\n');
  assert.deepEqual(arretsVoulusDuJournalDuDemon(texte), [Date.parse('2026-10-28T06:51:02.123Z'), Date.parse('2026-10-28T07:10:00.000Z')]);
});

test('NEUF MISES EN LIGNE NE FONT AUCUN INCIDENT, même avec les coupures qu’elles provoquent', () => {
  const arrets = Array.from({ length: 9 }, (_, i) => T0 - i * 2 * H);
  const journal = arrets.flatMap((a) => [ligne(a, 'relance-voulue'), ligne(a + 30_000, 'silence-relance-voulue'), ligne(a + 15_000, 'demarrage')]);
  // Chaque mise en ligne coupe le canal de tous les écrans ouverts.
  const coupures = arrets.flatMap((a) => [coupure(a + 2_000), coupure(a + 10_000), coupure(a + 40_000)]);
  const incidents = incidentsDeDecrochage({ journal, coupures, maintenant: T0 + MIN });
  assert.deepEqual(incidents, []);
  assert.deepEqual(decisionDEnquete(incidents, { carteOuverte: false }, T0), { enqueter: false, raison: 'pas-recurrent' });
  // Même lues seulement dans le journal du démon (avant que le démon ne les note).
  assert.deepEqual(incidentsDeDecrochage({ journal: [], coupures, arretsVoulus: arrets, maintenant: T0 + MIN }), []);
});

test('les silences rapprochés font un incident, les rafales de coupures aussi, une coupure isolée rien', () => {
  const journal = [
    ligne(T0 - 5 * H, 'silence', 'a-1.txt'),
    ligne(T0 - 5 * H + MIN, 'silence', 'a-2.txt'),
    ligne(T0 - 5 * H + 2 * MIN, 'silence', 'a-3.txt'),
    ligne(T0 - 5 * H + 2 * MIN + 100, 'relance-surveillant', 'a-3.txt'),
    ligne(T0 - 3 * H, 'silence', 'b-1.txt'),
  ];
  const coupures = [
    coupure(T0 - 5 * H + 30_000), // pendant le silence : déjà compté
    coupure(T0 - 2 * H),
    coupure(T0 - 2 * H + 20_000),
    coupure(T0 - 2 * H + 50_000),
    coupure(T0 - H), // isolée
    coupure(T0 - H / 2),
    coupure(T0 - H / 2 + 10), // deux commandes du même clic : pas une rafale
  ];
  const incidents = incidentsDeDecrochage({ journal, coupures, maintenant: T0 });
  assert.equal(incidents.length, 3);
  assert.deepEqual(
    incidents.map((i) => [i.genre, i.nombre, i.relance]),
    [
      ['silence-serveur', 3, true],
      ['silence-serveur', 1, false],
      ['coupures-navigateur', 3, false],
    ],
  );
  assert.deepEqual(incidents[0].releves, ['a-1.txt', 'a-2.txt', 'a-3.txt']);
  // Hors de la fenêtre de 24 h : oublié.
  assert.equal(incidentsDeDecrochage({ journal, coupures, maintenant: T0 + 30 * H }).length, 0);
});

test('la récurrence ouvre UNE enquête, jamais une tempête de cartes', () => {
  const incidents = incidentsDeDecrochage({
    journal: Array.from({ length: INCIDENTS_AVANT_ENQUETE }, (_, i) => ligne(T0 - i * H, 'silence')),
    coupures: [],
    maintenant: T0,
  });
  assert.equal(incidents.length, INCIDENTS_AVANT_ENQUETE);
  assert.deepEqual(decisionDEnquete(incidents.slice(1), { carteOuverte: false }, T0), { enqueter: false, raison: 'pas-recurrent' });
  assert.deepEqual(decisionDEnquete(incidents, { carteOuverte: false }, T0), { enqueter: true });
  assert.deepEqual(decisionDEnquete(incidents, { carteOuverte: true, cardId: 'c' }, T0), { enqueter: false, raison: 'enquete-deja-ouverte' });
  assert.deepEqual(decisionDEnquete(incidents, { carteOuverte: false, lanceLe: T0 - H }, T0), { enqueter: false, raison: 'trop-recent' });
  assert.deepEqual(decisionDEnquete(incidents, { carteOuverte: false, lanceLe: T0 - ECART_MINIMAL_ENQUETE_MS - 1 }, T0), { enqueter: true });
  // Une carte encore ouverte ne reçoit que ce qu'elle n'a pas vu.
  assert.equal(incidentsNonSignales(incidents, { dernierIncidentSignale: T0 - H }).length, 1);
  assert.match(noteDeNouveauxDecrochages(incidents.slice(0, 1)), /aucune autre carte/);
});

test('la demande d’enquête interdit de corriger et joint les constats de départ à la première', () => {
  const incidents = incidentsDeDecrochage({ journal: [ligne(T0, 'silence', 'x.txt')], coupures: [], maintenant: T0 });
  const entree = { incidents, arretsVoulus: [T0 - H], dossierDesReleves: '/d', journalDuDemon: '/s.log' };
  const premiere = demandeDEnqueteDecrochages({ ...entree, premiere: true });
  assert.match(premiere, /CONSTATS DE DÉPART/);
  assert.match(premiere, /NE POSE AUCUNE QUESTION/);
  assert.match(premiere, /NE REDÉMARRE RIEN, NE PUBLIE RIEN/);
  assert.match(premiere, /x\.txt/);
  assert.doesNotMatch(demandeDEnqueteDecrochages({ ...entree, premiere: false }), /CONSTATS DE DÉPART/);
});

test('le surveillant relève avant de relancer, borne ses commandes et ne relance jamais en essai', () => {
  const script = readFileSync(new URL('../../../scripts/beluga-watchdog.sh', import.meta.url), 'utf8');
  assert.match(script, /timeout 8/);
  assert.match(script, /head -c "\$PLAFOND_RELEVE"/);
  assert.match(script, /silence-relance-voulue/);
  const relance = script.lastIndexOf('systemctl restart');
  assert.ok(script.indexOf('releve=$(ecrire_releve') < relance, 'le relevé part avant la relance');
  assert.ok(script.indexOf('if [ "$ESSAI" = "1" ]') < relance, 'l’essai sort avant la relance');
});

test('chaque fermeture du canal laisse une ligne lisible : code, durée, tampon, adresse, appareil', () => {
  const ligne = ligneDeFermetureDuCanal({
    code: 1006,
    raison: '',
    ouvertA: T0,
    fermeA: T0 + 754_321,
    enAttente: 0,
    adresse: '203.0.113.7',
    appareil: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/141.0',
  });
  assert.equal(ligne, 'canal fermé : code 1006 après 754.3 s · en attente 0 o · 203.0.113.7 · Mac');
  assert.match(ligneDeFermetureDuCanal({ code: 1001, raison: 'départ', ouvertA: T0, fermeA: T0, enAttente: 12, appareil: 'iPhone' }), /code 1001 \(départ\) après 0 s · en attente 12 o · adresse inconnue · iPhone$/);
});

test('une rafale du navigateur ne compte que si le serveur a flanché (décision du 18/11/2026)', () => {
  // Le 18/11 à 19:55 : iPhone sur réseau mobile, canal 1006, aucun gel du démon.
  const t = Date.parse('2026-11-18T18:55:30.000Z');
  const coupures: CoupureDuNavigateur[] = [
    { instant: t, geste: 'prefs.set', muetDepuisS: 3 },
    { instant: t + 8_000, geste: 'cards.list', muetDepuisS: 11 },
    { instant: t + 28_000, geste: 'files.upload', muetDepuisS: 31 },
  ];
  const journalDuDemon = [
    '[2026-11-18T18:50:44.000Z] WARN le démon s\'est figé 1.6 s (mémoire 400 Mo)',
    '[2026-11-18T18:55:40.000Z] WARN le démon s’est figé 1.4 s (mémoire 400 Mo)',
    '[2026-11-18T18:57:42.000Z] WARN le démon s\'est figé 2.1 s (mémoire 400 Mo)',
  ].join('\n');
  const traces = figementsDuJournalDuDemon(journalDuDemon);
  assert.deepEqual(traces, []);
  const maintenant = t + 10 * MIN;
  assert.equal(incidentsDeDecrochage({ journal: [], coupures, tracesDuServeur: traces, maintenant }).length, 0);

  // Le même instant avec un figement de 6 s du démon : la rafale compte.
  const fige = figementsDuJournalDuDemon('[2026-11-18T18:56:10.000Z] WARN le démon s\'est figé 6.2 s (mémoire 900 Mo)');
  assert.equal(fige.length, 1);
  const comptee = incidentsDeDecrochage({ journal: [], coupures, tracesDuServeur: fige, maintenant });
  assert.deepEqual(comptee.map((i) => i.genre), ['coupures-navigateur']);

  // Un figement à plus de 30 s de la rafale ne la rattrape pas.
  const loin = figementsDuJournalDuDemon('[2026-11-18T18:57:00.000Z] WARN le démon s\'est figé 8.0 s');
  assert.equal(incidentsDeDecrochage({ journal: [], coupures, tracesDuServeur: loin, maintenant }).length, 0);

  // Les vrais silences de la sonde comptent toujours, traces ou non.
  const journal: LigneDesDecrochages[] = [
    { instant: Date.parse('2026-11-18T07:29:00.000Z'), genre: 'silence', releve: 'a.txt', detail: null },
  ];
  const silences = incidentsDeDecrochage({ journal, coupures: [], tracesDuServeur: [], maintenant: Date.parse('2026-11-18T08:00:00.000Z') });
  assert.deepEqual(silences.map((i) => i.genre), ['silence-serveur']);
});
