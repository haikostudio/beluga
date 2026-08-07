import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CONSIGNE_CREATION_PROJET,
  PORT_MAX,
  TITRE_ETAPE_ADRESSE,
  ZONE_PROJETS,
  adresseDuSousDomaine,
  jugerAdresseDemandee,
  normaliserPort,
  normaliserSousDomaine,
} from '@haikodev/shared';
import { etapeAdressePublique } from '../projects.js';

/*
 * L'ADRESSE SE DEMANDE AU MONTAGE.
 *
 * Un projet naissait sans adresse : le sous-domaine se fabriquait à part, à la
 * main, dans les réglages. Le montage porte donc une étape de plus, et le
 * créateur manuel a disparu.
 */

const ICI = path.dirname(fileURLToPath(import.meta.url));
const SOURCE_REGLAGES = fs.readFileSync(
  path.resolve(ICI, '../../../web/src/components/project-settings.tsx'),
  'utf8',
);
const SOURCE_COLONNE = fs.readFileSync(path.resolve(ICI, '../../../web/src/components/sidebar.tsx'), 'utf8');
const SOURCE_RUNTIME = fs.readFileSync(path.resolve(ICI, '../../src/runtime.ts'), 'utf8');

/* ------------------------------------------------------------------ */
/* Lire ce qui a été saisi                                              */
/* ------------------------------------------------------------------ */

test('un nom saisi librement est ramené au nom court attendu', () => {
  assert.equal(normaliserSousDomaine('Mon Nouveau Site'), 'mon-nouveau-site');
  assert.equal(normaliserSousDomaine('  Café Déjà  '), 'cafe-deja');
  assert.equal(normaliserSousDomaine('MON-SITE'), 'mon-site');
});

test("l'adresse entière, le protocole et la zone collée sont tolérés", () => {
  assert.equal(normaliserSousDomaine(`https://mon-site.${ZONE_PROJETS}`), 'mon-site');
  assert.equal(normaliserSousDomaine(`mon-site.${ZONE_PROJETS}`), 'mon-site');
  assert.equal(normaliserSousDomaine(`https://mon-site.${ZONE_PROJETS}/`), 'mon-site');
});

test('un nom sans une seule lettre utilisable ne donne rien', () => {
  assert.equal(normaliserSousDomaine('  ---  '), '');
  assert.equal(normaliserSousDomaine(''), '');
  assert.equal(normaliserSousDomaine(undefined), '');
});

test("l'adresse complète se déduit du nom court", () => {
  assert.equal(adresseDuSousDomaine('Mon Site'), `https://mon-site.${ZONE_PROJETS}`);
  assert.equal(adresseDuSousDomaine('---'), '');
});

test('un port se lit en nombre, hors bornes il ne vaut rien', () => {
  assert.equal(normaliserPort('3000'), 3000);
  assert.equal(normaliserPort(3000), 3000);
  assert.equal(normaliserPort('0'), null);
  assert.equal(normaliserPort(PORT_MAX + 1), null);
  assert.equal(normaliserPort('port'), null);
  assert.equal(normaliserPort(''), null);
});

/* ------------------------------------------------------------------ */
/* Juger la demande                                                     */
/* ------------------------------------------------------------------ */

test("rien de saisi : aucune adresse n'est demandée, et ce n'est pas une erreur", () => {
  const jugement = jugerAdresseDemandee({});
  assert.equal(jugement.demandee, false);
  assert.equal(jugement.erreur, undefined);
});

test('un nom et un port valides sont retenus tels quels', () => {
  const jugement = jugerAdresseDemandee({ sousDomaine: 'Mon Site', port: '3000' });
  assert.equal(jugement.demandee, true);
  assert.equal(jugement.sousDomaine, 'mon-site');
  assert.equal(jugement.port, 3000);
  assert.equal(jugement.erreur, undefined);
});

test('un nom sans port se dit, au lieu de partir à moitié', () => {
  const jugement = jugerAdresseDemandee({ sousDomaine: 'mon-site' });
  assert.equal(jugement.demandee, true);
  assert.match(jugement.erreur ?? '', /port/);
});

test('un port sans nom se dit aussi', () => {
  const jugement = jugerAdresseDemandee({ port: 3000 });
  assert.equal(jugement.demandee, true);
  assert.match(jugement.erreur ?? '', /nom/);
});

/* ------------------------------------------------------------------ */
/* L'étape du montage                                                   */
/* ------------------------------------------------------------------ */

test("sans adresse demandée, le montage ne porte AUCUNE étape d'adresse", async () => {
  let appele = false;
  const resultat = await etapeAdressePublique({}, async () => {
    appele = true;
    return { ok: true };
  });
  assert.equal(resultat.etape, undefined);
  assert.equal(resultat.url, undefined);
  assert.equal(appele, false);
});

test("l'adresse créée est rangée et l'étape le dit", async () => {
  const resultat = await etapeAdressePublique({ sousDomaine: 'Mon Site', port: 3000 }, async (nom, port) => {
    assert.equal(nom, 'mon-site');
    assert.equal(port, 3000);
    return { ok: true, url: `https://mon-site.${ZONE_PROJETS}` };
  });
  assert.equal(resultat.url, `https://mon-site.${ZONE_PROJETS}`);
  assert.equal(resultat.etape?.titre, TITRE_ETAPE_ADRESSE);
  assert.equal(resultat.etape?.fait, true);
});

test('un refus du fournisseur ne fait pas tomber le montage : il se dit', async () => {
  const resultat = await etapeAdressePublique({ sousDomaine: 'mon-site', port: 3000 }, async () => ({
    ok: false,
    error: 'le fournisseur a refusé (403)',
  }));
  assert.equal(resultat.url, undefined);
  assert.equal(resultat.etape?.fait, false);
  assert.match(resultat.etape?.detail ?? '', /refusé/);
});

test('une panne pendant la création est attrapée, jamais lancée plus haut', async () => {
  const resultat = await etapeAdressePublique({ sousDomaine: 'mon-site', port: 3000 }, async () => {
    throw new Error('le réseau ne répond pas');
  });
  assert.equal(resultat.etape?.fait, false);
  assert.match(resultat.etape?.detail ?? '', /réseau/);
});

test('une saisie à moitié donne une étape en échec, pas un appel au fournisseur', async () => {
  let appele = false;
  const resultat = await etapeAdressePublique({ sousDomaine: 'mon-site' }, async () => {
    appele = true;
    return { ok: true };
  });
  assert.equal(appele, false);
  assert.equal(resultat.etape?.fait, false);
});

/* ------------------------------------------------------------------ */
/* Ce qui a disparu, ce qui a été demandé                               */
/* ------------------------------------------------------------------ */

test('le créateur manuel de sous-domaine a quitté les réglages du projet', () => {
  assert.equal(SOURCE_REGLAGES.includes('project.publishDomain'), false);
  assert.equal(SOURCE_REGLAGES.includes('setSousDomaine'), false);
});

test("le champ « Adresse à contrôler » reste dans les réglages", () => {
  assert.equal(SOURCE_REGLAGES.includes('data-url-dev'), true);
  assert.match(SOURCE_REGLAGES, /Adresse à contrôler/);
});

test('le formulaire de création demande le sous-domaine et le port', () => {
  assert.equal(SOURCE_COLONNE.includes('data-adresse-nouveau-projet'), true);
  assert.equal(SOURCE_COLONNE.includes('data-sous-domaine'), true);
  assert.equal(SOURCE_COLONNE.includes('data-port-projet'), true);
  assert.match(SOURCE_COLONNE, /sousDomaine: newSousDomaine/);
});

test("un agent reçoit la consigne de demander l'adresse avant de monter quoi que ce soit", () => {
  assert.match(CONSIGNE_CREATION_PROJET, /ask_user/);
  assert.match(CONSIGNE_CREATION_PROJET, /SOUS-DOMAINE/);
  assert.match(CONSIGNE_CREATION_PROJET, /PORT/);
  assert.equal(SOURCE_RUNTIME.includes('CONSIGNE_CREATION_PROJET'), true);
});
