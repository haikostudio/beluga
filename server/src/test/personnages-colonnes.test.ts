import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  COLONNE_DU_MOTIF,
  COLUMN_KEYS,
  MOTIFS,
  type ColumnKey,
  type MotifNotification,
  PROPORTION_SILHOUETTE,
  COLONNE_VIVANTE,
  TAILLE_MAX_PERSONNAGE,
  avatarDeLAlerte,
  fichierDuPersonnage,
  jugerImageDePersonnage,
  personnageEnMouvement,
  colonneDuMotif,
  imageDeLAlerte,
  imageDuPersonnage,
  portraitDuPersonnage,
} from '@haikodev/shared';

const RACINE = path.resolve(fileURLToPath(import.meta.url), '../../../..');
const PUBLIC = path.join(RACINE, 'web', 'public');

/** La taille d'un PNG se lit dans son entête (IHDR), sans aucune dépendance. */
function taillePng(chemin: string): { largeur: number; hauteur: number; avecAlpha: boolean } {
  const octets = fs.readFileSync(chemin);
  return {
    largeur: octets.readUInt32BE(16),
    hauteur: octets.readUInt32BE(20),
    // Type de couleur 6 = vraies couleurs + canal alpha ; 4 = gris + alpha.
    avecAlpha: octets[25] === 6 || octets[25] === 4,
  };
}

test('chaque colonne a son personnage, détouré, dans les deux découpes', () => {
  for (const colonne of COLUMN_KEYS) {
    const silhouette = path.join(PUBLIC, imageDuPersonnage(colonne));
    const portrait = path.join(PUBLIC, portraitDuPersonnage(colonne));
    assert.ok(fs.existsSync(silhouette), `silhouette absente : ${silhouette}`);
    assert.ok(fs.existsSync(portrait), `portrait absent : ${portrait}`);

    const boite = taillePng(silhouette);
    // Le fond DOIT être transparent : c'est la demande même de cette carte.
    assert.ok(boite.avecAlpha, `${colonne} : la silhouette n'a pas de canal de transparence`);
    // La proportion est la même pour les sept : l'interface pose le même
    // décalage partout sans mesurer chaque image.
    assert.equal(
      Math.round((boite.largeur / boite.hauteur) * 1000),
      Math.round(PROPORTION_SILHOUETTE * 1000),
      `${colonne} : la silhouette n'est pas à la proportion attendue`,
    );

    const rond = taillePng(portrait);
    assert.ok(rond.avecAlpha, `${colonne} : le portrait n'a pas de canal de transparence`);
    assert.equal(rond.largeur, rond.hauteur, `${colonne} : le portrait n'est pas carré`);
  }
});

test('une alerte qui parle d’une colonne porte son visage, les autres gardent leur genre', () => {
  assert.equal(avatarDeLAlerte('tache-terminee'), '/personnages/done-rond.png');
  assert.equal(avatarDeLAlerte('decision-attendue'), '/personnages/running-rond.png');
  assert.equal(avatarDeLAlerte('publication-terminee'), '/personnages/in_production-rond.png');
  // Un quota qui monte ou un serveur qui repart n'ont aucune colonne : prendre
  // un personnage au hasard mentirait sur l'endroit où aller.
  assert.equal(avatarDeLAlerte('quota-seuil'), undefined);
  assert.equal(avatarDeLAlerte('redemarrage-serveur'), undefined);
  assert.equal(avatarDeLAlerte('motif-d-une-version-plus-recente'), undefined);
  assert.equal(avatarDeLAlerte(undefined), undefined);
  // Chaque colonne nommée existe vraiment, et l'image du genre reste dispo.
  for (const [motif, colonne] of Object.entries(COLONNE_DU_MOTIF)) {
    assert.ok(COLUMN_KEYS.includes(colonne as ColumnKey), `${motif} vise une colonne inconnue`);
    assert.equal(colonneDuMotif(motif), colonne);
    assert.match(imageDeLAlerte(motif), /^\/notif\//);
  }
});

test('le service worker garde la MÊME table de personnages que la règle', () => {
  // Il ne partage rien avec l'application : sa table est recopiée, donc elle
  // peut dériver. Ce contrôle est là pour l'en empêcher.
  const sw = fs.readFileSync(path.join(PUBLIC, 'sw.js'), 'utf8');
  const table = sw.slice(sw.indexOf('const PERSONNAGES'), sw.indexOf('function avatarDeLAlerte'));
  assert.ok(table, 'le service worker n’a plus de table de personnages');

  for (const motif of Object.keys(MOTIFS) as MotifNotification[]) {
    const ligne = new RegExp(`'${motif}':\\s*'([a-z_]+)'`).exec(table);
    const attendue = COLONNE_DU_MOTIF[motif];
    if (!attendue) {
      assert.equal(ligne, null, `${motif} n'a pas de colonne : rien à traduire`);
      continue;
    }
    assert.ok(ligne, `${motif} manque au service worker`);
    assert.equal(ligne![1], attendue, motif);
  }
});

test('seul le personnage de « En cours » bouge, et seulement quand ça travaille', () => {
  assert.equal(COLONNE_VIVANTE, 'running');
  // Le contraste est TOUT : sans carte au travail, immobilité complète.
  assert.equal(personnageEnMouvement('running', 0), false);
  assert.equal(personnageEnMouvement('running', 1), true);
  assert.equal(personnageEnMouvement('running', 4), true);
  // Les six autres ne bougent jamais, même si des cartes y sont comptées.
  for (const colonne of COLUMN_KEYS.filter((c) => c !== 'running')) {
    assert.equal(personnageEnMouvement(colonne, 3), false, `${colonne} ne doit pas bouger`);
  }
});

test('un personnage remplacé garde son adresse, avec un repère qui casse le cache', () => {
  // L'adresse ne change JAMAIS : c'est le démon qui décide, à cette adresse,
  // s'il sert l'image d'origine ou celle qu'on a déposée. Le repère `?v=` ne
  // sert qu'à faire redemander l'image au navigateur.
  assert.equal(imageDuPersonnage('running'), '/personnages/running.png');
  assert.equal(imageDuPersonnage('running', 1_700_000_000_000), '/personnages/running.png?v=1700000000000');
  assert.equal(portraitDuPersonnage('done', 42), '/personnages/done-rond.png?v=42');
  // Un instant absent ou nul ne pose aucun repère : l'adresse reste nue.
  assert.equal(portraitDuPersonnage('done', 0), '/personnages/done-rond.png');
  for (const colonne of COLUMN_KEYS) {
    assert.equal(fichierDuPersonnage(colonne, 'silhouette'), `${colonne}.png`);
    assert.equal(fichierDuPersonnage(colonne, 'portrait'), `${colonne}-rond.png`);
  }
});

test('un remplacement refusé dit sa raison, jamais un échec muet', () => {
  const png = { mime: 'image/png', nom: 'perso.png', taille: 120_000 };
  assert.equal(jugerImageDePersonnage({ colonne: 'running', ...png }).ok, true);
  // Un navigateur qui n'envoie pas de type : l'extension suffit, et l'inverse aussi.
  assert.equal(jugerImageDePersonnage({ colonne: 'notes', nom: 'x.JPEG', taille: 10 }).ok, true);
  assert.equal(jugerImageDePersonnage({ colonne: 'notes', mime: 'image/webp', taille: 10 }).ok, true);

  const refus = (depot: Parameters<typeof jugerImageDePersonnage>[0]) => {
    const juge = jugerImageDePersonnage(depot);
    assert.equal(juge.ok, false, 'ce dépôt aurait dû être refusé');
    assert.ok(!juge.ok && juge.raison.length > 10, 'un refus sans raison lisible');
    return !juge.ok ? juge.raison : '';
  };
  assert.match(refus({ colonne: 'inconnue', ...png }), /colonne/);
  assert.match(refus({ colonne: 'running', ...png, taille: 0 }), /vide/);
  assert.match(refus({ colonne: 'running', ...png, taille: TAILLE_MAX_PERSONNAGE + 1 }), /Mo/);
  assert.match(refus({ colonne: 'running', mime: 'application/pdf', nom: 'notice.pdf', taille: 500 }), /image/);
});
