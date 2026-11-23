/**
 * UN LIEN OUVERT DANS L'APPLICATION INSTALLÉE NE LA REMPLACE PAS.
 *
 * Sans barre d'adresse ni bouton « retour », un lien vers un fichier de
 * l'application remplaçait tout l'écran par la page de téléchargement du
 * système, qu'on ne pouvait plus quitter.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { affichageSurPlace, lienAOuvrirSurPlace, nomDepuisDisposition } from '@beluga/shared';

const origine = 'https://beluga.exemple.ch';
const lien = (href: string, partiel: { telechargement?: string | null; nouvelleFenetre?: boolean } = {}) =>
  lienAOuvrirSurPlace({ href, origine, telechargement: null, nouvelleFenetre: false, ...partiel });

test('une pièce jointe, un téléchargement et un fichier du projet s’ouvrent sur place', () => {
  assert.deepEqual(lien('/api/attachment?id=a1&download=1'), {
    adresse: `${origine}/api/attachment?id=a1&download=1`,
  });
  assert.deepEqual(lien('/api/attachment?id=a1&download=1', { telechargement: 'planche.png' }), {
    adresse: `${origine}/api/attachment?id=a1&download=1`,
    nom: 'planche.png',
  });
  assert.equal(lien('/api/download?token=t1')?.adresse, `${origine}/api/download?token=t1`);
  assert.equal(lien('/api/file?project=p&path=docs%2Fplan.md&download=1')?.nom, 'plan.md');
  /* Une adresse entière de la même origine vaut une adresse relative. */
  assert.ok(lien(`${origine}/api/attachment?id=a1`));
});

test('une page de l’application demandée dans une nouvelle fenêtre s’ouvre sur place aussi', () => {
  assert.ok(lien('/documentation', { nouvelleFenetre: true }));
  assert.ok(lien('/export.csv', { telechargement: '' }));
});

test('un autre site garde son comportement : le système lui donne sa propre fenêtre', () => {
  assert.equal(lien('https://db-ip.com', { nouvelleFenetre: true }), null);
  assert.equal(lien('https://autre.exemple.ch/api/attachment?id=a1'), null);
  assert.equal(lien('mailto:quelqu-un@exemple.ch'), null);
  assert.equal(lien('blob:https://beluga.exemple.ch/1234', { telechargement: 'a.png' }), null);
});

test('changer d’écran dans l’application reste une navigation ordinaire', () => {
  assert.equal(lien('#projet/p1/tache/c1'), null);
  assert.equal(lien('/#projet/p1', { nouvelleFenetre: true }), null);
  assert.equal(lien('/reglages'), null);
  assert.equal(lien(''), null);
});

test('le nom du fichier se lit dans l’entête de la réponse', () => {
  assert.equal(nomDepuisDisposition("attachment; filename*=UTF-8''planche%20finale.png"), 'planche finale.png');
  assert.equal(nomDepuisDisposition('attachment; filename="rapport%C3%A9.pdf"'), 'rapporté.pdf');
  assert.equal(nomDepuisDisposition('inline'), undefined);
  assert.equal(nomDepuisDisposition(null), undefined);
});

test('le type du fichier décide de ce que montre la fenêtre', () => {
  assert.equal(affichageSurPlace('image/png'), 'image');
  assert.equal(affichageSurPlace('video/mp4'), 'video');
  assert.equal(affichageSurPlace('application/pdf'), 'cadre');
  assert.equal(affichageSurPlace('text/html; charset=utf-8'), 'cadre');
  assert.equal(affichageSurPlace('application/zip'), 'aucun');
  assert.equal(affichageSurPlace(undefined), 'aucun');
});

/*
 * LE VERROU (demande du 28/10/2026 — le défaut était revenu sur trois projets).
 * Un BOUTON qui écrit `window.location.href = '/api/download?…'`, `location.assign`
 * ou `window.open` vers un fichier de l'application ne passe par aucun lien : la
 * capture des clics ne le voit pas, et l'application installée devient la page
 * « Ouvrir dans Aperçu » sans issue. Tout fichier ouvert par un geste passe par
 * `ouvrirFichierSurPlace` ; seul son propre fichier en parle.
 */
test('aucun geste de l’interface n’ouvre un fichier de l’application en quittant la page', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../web/src');
  const fichiers: string[] = [];
  const parcourir = (dossier: string) => {
    for (const e of fs.readdirSync(dossier, { withFileTypes: true })) {
      const chemin = path.join(dossier, e.name);
      if (e.isDirectory()) parcourir(chemin);
      else if (/\.(tsx?|mjs)$/.test(e.name) && !/\.test\./.test(e.name)) fichiers.push(chemin);
    }
  };
  parcourir(racine);
  const fautifs: string[] = [];
  /* Une navigation vers une adresse de l'application : /api/…, un jeton de téléchargement ou une pièce jointe. */
  const navigation = /(?:location\.href\s*=|location\.(?:assign|replace)\(|window\.open\()\s*([^;\n]*)/g;
  const versUnFichier = /^[`'"]\/api\/|download|adresseDePiece|attachment|token/;
  for (const f of fichiers) {
    if (f.endsWith(path.join('components', 'visionneuse-de-lien.tsx'))) continue;
    const lignes = fs.readFileSync(f, 'utf8').split('\n');
    lignes.forEach((ligne, i) => {
      if (/^\s*(\*|\/\/)/.test(ligne)) return;
      for (const m of ligne.matchAll(navigation)) {
        if (versUnFichier.test(m[1].trim())) fautifs.push(`${path.relative(racine, f)}:${i + 1} ${ligne.trim()}`);
      }
    });
  }
  assert.deepEqual(fautifs, [], `passer par ouvrirFichierSurPlace :\n${fautifs.join('\n')}`);
});
