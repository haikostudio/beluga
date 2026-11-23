import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PLAFOND_PREPARATION_MS } from '@beluga/shared';

/* ------------------------------------------------------------------ */
/* LE RELEVÉ DES QUOTAS NE RETIENT JAMAIS UN TOUR EN OTAGE             */
/* ------------------------------------------------------------------ */

/*
 * Avant de lancer un tour, le démon choisit un compte, et pour choisir il relève
 * les quotas. Ce relevé interroge les comptes L'UN APRÈS L'AUTRE, avec un souffle
 * de 1,5 s entre deux, et un compte au jeton expiré coûte douze secondes de
 * lecture, puis trente secondes de renouvellement par le moteur, puis douze
 * secondes de relecture. Quatre comptes mal en point dépassaient donc les cinq
 * minutes au bout desquelles la veille referme un tour qui n'a jamais démarré :
 * le moteur n'avait pas lu la première ligne que sa carte était déjà morte.
 *
 * Constaté le 05.09.2026 sur deux cartes tuées à deux minutes d'intervalle,
 * journal d'agent vide, un compte au jeton expiré dans le lot.
 */

const ICI = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = fs.readFileSync(path.join(ICI, '../../src/accounts.ts'), 'utf8');

const PLAFOND = /const DELAI_RELEVE_AVANT_TOUR_MS = (\d+)_?(\d*)/.exec(SOURCE);

test('le relevé d’avant-tour a un plafond de temps', () => {
  assert.ok(PLAFOND, 'la constante DELAI_RELEVE_AVANT_TOUR_MS doit exister');
});

test('…et ce plafond tient LARGEMENT sous celui de la préparation', () => {
  const plafond = Number(`${PLAFOND![1]}${PLAFOND![2]}`);
  assert.ok(plafond > 0, 'un plafond nul lancerait tous les tours à l’aveugle');
  assert.ok(
    plafond * 2 < PLAFOND_PREPARATION_MS,
    `le relevé (${plafond} ms) doit laisser de la place au reste de la préparation ` +
      `sous les ${PLAFOND_PREPARATION_MS} ms de la veille`,
  );
});

test('le choix du compte passe par le relevé BORNÉ, jamais par l’attente sans fin', () => {
  const bloc = SOURCE.split('export async function pickAccount')[1].split('\n}')[0];
  assert.match(bloc, /quotasPourChoisirUnCompte\(/, 'il attend le relevé borné');
  assert.doesNotMatch(
    bloc,
    /await refreshQuotas\(/,
    'et jamais le relevé nu : c’est lui qui pouvait pendre plus longtemps que le tour',
  );
});

test('le relevé dépassé retombe sur le dernier relevé connu, sans être annulé', () => {
  const bloc = SOURCE.split('async function quotasPourChoisirUnCompte')[1].split('\n}')[0];
  // Le repli : on ne part pas sans rien, on part avec ce qu'on savait déjà.
  assert.match(bloc, /cachedQuotas\(\)/);
  // Et la lecture continue en tâche de fond : elle servira au tour suivant.
  assert.match(bloc, /void releve/);
});

test('une tâche ne relève QUE les comptes du moteur qu’elle utilise', () => {
  /*
   * Le vrai remède, dont le plafond de temps n'est que la ceinture : les
   * comptes des autres moteurs ne pesaient pas dans la décision, mais ils
   * pesaient dans l'attente. Un compte Codex expiré a tué des tours Claude.
   */
  const choix = SOURCE.split('export async function pickAccount')[1].split('\n}')[0];
  assert.match(
    choix,
    /quotasPourChoisirUnCompte\(accounts\)/,
    'le relevé reçoit les comptes DU MOTEUR demandé, déjà filtrés juste au-dessus',
  );

  const releve = SOURCE.split('async function quotasPourChoisirUnCompte')[1].split('\n}')[0];
  assert.match(
    releve,
    /comptes\.map\(\(compte\) => compte\.id\)/,
    'et il les passe en liste ciblée à refreshQuotas, jamais un relevé général',
  );
});

/* ------------------------------------------------------------------ */
/* UNE TOURNÉE DE QUOTAS FINIT TOUJOURS, ET AUCUNE LECTURE NE LA RETIENT */
/* ------------------------------------------------------------------ */

/*
 * Le plafond d'avant-tour ci-dessus protège LE TOUR ; il ne protégeait pas la
 * tournée elle-même. Or la tournée est PARTAGÉE : `refreshQuotas` rend la
 * promesse déjà en cours à qui en redemande une. Le 06.09.2026 une tournée
 * partie à 10 h 29 n'est jamais revenue, et tout ce qui a suivi a hérité de
 * cette promesse morte : jauges figées quatre heures, minuteur de dix minutes
 * sans effet, et surtout chaque clic sur « poursuivre sur ce compte » sans
 * effet lui aussi — `reprendreSurCompte` commence par un relevé frais. À
 * l'écran : la même question de compte reposée sans fin.
 */

test('la lecture d’UN compte a son plafond, sinon un moteur muet retient la tournée', () => {
  assert.match(SOURCE, /const PLAFOND_LECTURE_COMPTE_MS = \d/);
  const boucle = SOURCE.split('async function executerActualisationQuotas')[1];
  assert.match(
    boucle,
    /avecPlafond\(lireQuotaDuMoteur\(account\), PLAFOND_LECTURE_COMPTE_MS/,
    'la lecture d’un compte passe par le plafond, jamais nue',
  );
});

test('…et la tournée entière a le sien, pour que la promesse partagée finisse toujours', () => {
  assert.match(SOURCE, /const PLAFOND_TOURNEE_QUOTAS_MS = \d/);
  const bloc = SOURCE.split('export function refreshQuotas')[1].split('\n}')[0];
  assert.match(bloc, /avecPlafond\(executerActualisationQuotas\(/);
  // Passé le plafond, on rend le dernier relevé connu : personne n'attend dans le vide.
  assert.match(bloc, /cachedQuotas\(\)/);
});

test('la promesse partagée est RELÂCHÉE à la fin, et c’est bien elle qu’on rend', () => {
  const bloc = SOURCE.split('export function refreshQuotas')[1].split('\n}')[0];
  // On range la promesse en la comparant : sans quoi une tournée finie plus tard
  // effacerait la tournée suivante, déjà en route.
  assert.match(bloc, /if \(actualisationEnCours === partagee\) actualisationEnCours = null;/);
  assert.match(bloc, /return tournee;/, 'les appelants partagent la promesse plafonnée, pas une autre');
});

/* ------------------------------------------------------------------ */
/* DEUX COMPTES DIFFÉRENTS, DEUX RELEVÉS : UN RELEVÉ CIBLÉ NE VAUT PAS  */
/* POUR TOUT LE MONDE                                                   */
/* ------------------------------------------------------------------ */

/*
 * La tournée est partagée pour ne pas interroger le fournisseur deux fois dans
 * la même seconde. Ce partage était AVEUGLE : le relevé d'UN SEUL compte — au
 * clic sur « poursuivre sur ce compte », ou avant un tour — était rendu tel quel
 * à qui demandait les chiffres de TOUS les comptes, et il posait en plus la date
 * du dernier relevé général. Les autres comptes étaient donc réputés frais sans
 * avoir été lus, et leurs jauges restaient en arrière pendant cinq minutes.
 */

test('une tournée ciblée ne tient pas lieu de tournée générale', () => {
  assert.match(SOURCE, /function porteeCouvre\(/, 'la portée d’une tournée doit être écrite');
  const couvre = SOURCE.split('function porteeCouvre(')[1].split('\n}')[0];
  // Une tournée générale renseigne tout le monde.
  assert.match(couvre, /if \(enRoute === null\) return true;/);
  // Une tournée ciblée ne peut pas répondre à une demande générale…
  assert.match(couvre, /if \(demandee === null\) return false;/);
  // …ni à un compte qu'elle n'interroge pas.
  assert.match(couvre, /if \(!enRoute\.has\(compte\)\) return false;/);
});

test('une demande que la tournée en route ne couvre pas ATTEND, puis part pour de bon', () => {
  const bloc = SOURCE.split('export function refreshQuotas')[1].split('\n}')[0];
  assert.match(bloc, /if \(enRoute && porteeCouvre\(enRoute\.portee, portee\)\) return enRoute\.tournee;/);
  assert.match(
    bloc,
    /if \(enRoute\) return enRoute\.tournee\.catch\(\(\) => undefined\)\.then\(\(\) => refreshQuotas\(force, seulement\)\);/,
    'elle attend la tournée en cours plutôt que d’interroger le fournisseur en double',
  );
});

test('seule une tournée GÉNÉRALE fait date : un relevé ciblé ne gèle pas les autres comptes', () => {
  const bloc = SOURCE.split('async function executerActualisationQuotas')[1].split('\n}')[0];
  assert.match(
    bloc,
    /if \(!seulement\) lastFetch = Date\.now\(\);/,
    'le relevé d’un seul compte ne doit pas déclarer tous les autres fraîchement lus',
  );
});

/* ------------------------------------------------------------------ */
/* …ET LE CHEMIN DE LANCEMENT NON PLUS                                 */
/* ------------------------------------------------------------------ */

/*
 * La porte dure du lancement (`portesDures`) appelait `refreshQuotas()` NU :
 * tous les comptes, tous moteurs confondus, l'un après l'autre avec 1,5 s de
 * souffle et sans plafond de temps. Mesuré à 5,8 s sur quatre comptes en bonne
 * santé (`scripts/mesure-lancement.mjs`), et bien au-delà dès qu'un jeton a
 * expiré — sur un moteur dont la carte ne se sert même pas.
 */

const ORDONNANCEUR = fs.readFileSync(path.join(ICI, '../../src/scheduler.ts'), 'utf8');

test('la porte dure du lancement relève les quotas du SEUL moteur de la carte, sous plafond', () => {
  const bloc = ORDONNANCEUR.split('export async function portesDures')[1].split('\n}')[0];
  assert.match(bloc, /quotasDuMoteur\(card\.run\.engine\)/, 'elle passe par la porte bornée et ciblée');
  assert.doesNotMatch(bloc, /await refreshQuotas\(/, 'et jamais par le relevé nu, sans portée ni plafond');
});

test('…et le relevé ciblé de ce moteur passe par le même plafond que le choix du compte', () => {
  const bloc = SOURCE.split('export async function quotasDuMoteur')[1].split('\n}')[0];
  assert.match(bloc, /quotasPourChoisirUnCompte\(/, 'même plafond, même repli que `pickAccount`');
  assert.match(bloc, /account\.engine === engine/, 'et seulement les comptes du moteur demandé');
});

test('le même lancement ne paie pas DEUX FOIS la lecture d’un compte', () => {
  /* La porte dure et le choix du compte se suivent de quelques secondes : sans
     date de lecture PAR COMPTE, le relevé ciblé du second ignorait le cache
     (posé seulement par les tournées générales) et relisait tout. */
  const bloc = SOURCE.split('async function executerActualisationQuotas')[1].split('\n}')[0];
  assert.match(bloc, /derniereLecture\.get\(/, 'le cache se lit compte par compte');
  assert.match(SOURCE, /derniereLecture\.set\(account\.id, Date\.now\(\)\)/, 'et se pose à chaque lecture réelle');
});
