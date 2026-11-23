import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEPARTS_PAR_FENETRE,
  DUREE_DE_CROISSANCE_MS,
  FENETRE_DES_DEPARTS_MS,
  OOM_D_UN_ENFANT_LOURD,
  OOM_D_UN_MOTEUR,
  SEUIL_PAUSE_PSI_PCT,
  Settings,
  ajustementOomVoulu,
  porteDesDeparts,
  pressionMemoire,
  psiSomeAvg10,
  reserveDesDepartsRecents,
} from '@beluga/shared';

/* ------------------------------------------------------------------ */
/* LES DÉCROCHAGES DU 15/11/2026 : une rafale de cartes noyait la      */
/* mémoire, et l'arrêt d'un navigateur d'essai emportait le démon.      */
/* ------------------------------------------------------------------ */

/**
 * Rejoue un lot de lancements contre la porte d'étalement, comme la boucle de
 * l'ordonnanceur : un passage toutes les 15 s, trois secondes entre deux
 * départs d'un même passage. Rend les instants de départ.
 */
function rejouerUnLot(cartes: number, dureeMs: number): number[] {
  const departs: number[] = [];
  let enAttente = cartes;
  for (let passage = 0; passage * 15_000 < dureeMs && enAttente > 0; passage += 1) {
    let instant = passage * 15_000;
    for (let i = 0; i < enAttente; i += 1) {
      if (!porteDesDeparts(departs, instant).ok) continue;
      departs.push(instant);
      instant += 3_000;
    }
    enAttente = cartes - departs.length;
  }
  return departs;
}

test('une rafale de 15 lancements : au plus deux partent par minute, les autres attendent', () => {
  const departs = rejouerUnLot(15, 60_000);
  assert.equal(departs.length, DEPARTS_PAR_FENETRE);
  // Aucune fenêtre glissante d'une minute ne porte plus de deux départs.
  for (const t of departs) {
    assert.ok(departs.filter((u) => u >= t && u - t < FENETRE_DES_DEPARTS_MS).length <= DEPARTS_PAR_FENETRE);
  }
});

test('…et la file repart seule : les 15 finissent par partir, aucune ne reste coincée', () => {
  const departs = rejouerUnLot(15, 10 * 60_000);
  assert.equal(departs.length, 15);
  for (const t of departs) {
    assert.ok(departs.filter((u) => u >= t && u - t < FENETRE_DES_DEPARTS_MS).length <= DEPARTS_PAR_FENETRE);
  }
});

test('une carte retenue lit sa raison, stable d’un passage à l’autre', () => {
  const a = porteDesDeparts([0, 3_000], 5_000);
  const b = porteDesDeparts([0, 3_000], 20_000);
  assert.equal(a.ok, false);
  assert.match(a.raison ?? '', /Départs étalés/);
  assert.equal(a.raison, b.raison, 'une phrase qui change réécrirait la carte toutes les 15 s');
  assert.equal(a.dansMs, 55_000);
});

test('les départs anciens ne retiennent plus rien', () => {
  assert.equal(porteDesDeparts([0, 1_000], FENETRE_DES_DEPARTS_MS + 1_000).ok, true);
});

test('la réserve garde la place d’un agent qui vient de partir, puis s’efface', () => {
  assert.equal(reserveDesDepartsRecents([1_000], 1_000, 300), 300);
  assert.equal(reserveDesDepartsRecents([0], DUREE_DE_CROISSANCE_MS / 2, 300), 150);
  assert.equal(reserveDesDepartsRecents([0], DUREE_DE_CROISSANCE_MS, 300), 0);
  // Six agents partis à la même seconde : la place de six agents est déjà prise.
  assert.equal(reserveDesDepartsRecents([0, 0, 0, 0, 0, 0], 0, 300), 1800);
});

test('une machine qui attend sa mémoire suspend les départs, avant d’être pleine', () => {
  const p = pressionMemoire(70, 40, { psiSomeAvg10: 85 });
  assert.equal(p.suspendre, true);
  assert.match(p.raison ?? '', /attend sa mémoire 85 %/);
  // Au repos (2 % mesuré sur ce serveur), rien ne bouge.
  assert.equal(pressionMemoire(70, 90, { psiSomeAvg10: 2 }).suspendre, false);
  assert.equal(pressionMemoire(70, 90, { psiSomeAvg10: SEUIL_PAUSE_PSI_PCT }).suspendre, true);
});

test('un fichier d’échange qui travaille sur une mémoire tendue suspend les départs', () => {
  assert.equal(pressionMemoire(82, 50, { debitEchangeKoS: 4_000 }).suspendre, true);
  // Un va-et-vient sur une mémoire détendue n'est qu'un rangement.
  assert.equal(pressionMemoire(60, 50, { debitEchangeKoS: 4_000 }).suspendre, false);
  // Rempli mais silencieux : des pages froides, rien à suspendre.
  assert.equal(pressionMemoire(78, 100, { debitEchangeKoS: 10 }).suspendre, false);
});

test('la pression du noyau se lit dans /proc/pressure/memory', () => {
  const texte = 'some avg10=91.37 avg60=80.10 avg300=40.00 total=1\nfull avg10=60.00 avg60=1 avg300=1 total=1\n';
  assert.equal(psiSomeAvg10(texte), 91.37);
  assert.equal(psiSomeAvg10(''), undefined);
});

test('le noyau tue un navigateur ou une construction avant un moteur, et jamais le démon d’abord', () => {
  assert.equal(ajustementOomVoulu('chrome', false), OOM_D_UN_ENFANT_LOURD);
  assert.equal(ajustementOomVoulu('node', false), OOM_D_UN_ENFANT_LOURD);
  assert.equal(ajustementOomVoulu('claude\n', false), OOM_D_UN_MOTEUR);
  assert.equal(ajustementOomVoulu('node', true), undefined);
  assert.equal(ajustementOomVoulu('beluga-serveur\n', false), undefined);
  assert.ok(OOM_D_UN_MOTEUR < OOM_D_UN_ENFANT_LOURD);
});

test('le plafond d’agents vaut 6 par défaut', () => {
  assert.equal(Settings.parse({}).maxAgents, 6);
});

test('un serveur d’essai orphelin d’une carte qui ne travaille plus est un reste', async () => {
  const { estUnResteDEssai, copieDeTravailDe, AGE_D_UN_RESTE_MS } = await import('@beluga/shared');
  const vieux = AGE_D_UN_RESTE_MS + 1;
  const cwd = '/root/p/.worktrees/carte-abc123/web';
  assert.equal(copieDeTravailDe(cwd), '/root/p/.worktrees/carte-abc123');
  assert.equal(copieDeTravailDe('/root/p/.worktrees/carte-abc123 (deleted)'), '/root/p/.worktrees/carte-abc123');
  assert.equal(estUnResteDEssai({ ppid: 1, cwd, ageMs: vieux }, []), true);
  // Sa carte travaille encore : on n'y touche pas.
  assert.equal(estUnResteDEssai({ ppid: 1, cwd, ageMs: vieux }, ['/root/p/.worktrees/carte-abc123']), false);
  // Encore rattaché à son moteur, trop jeune, ou hors d'une copie de carte : jamais.
  assert.equal(estUnResteDEssai({ ppid: 4242, cwd, ageMs: vieux }, []), false);
  assert.equal(estUnResteDEssai({ ppid: 1, cwd, ageMs: 60_000 }, []), false);
  assert.equal(estUnResteDEssai({ ppid: 1, cwd: '/root/p', ageMs: vieux }, []), false);
});
