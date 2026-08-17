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
  avatarDeLAlerte,
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
