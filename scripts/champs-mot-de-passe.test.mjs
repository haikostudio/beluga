/**
 * AUCUN CHAMP DE MOT DE PASSE SANS SON ŒIL.
 *
 * Tout champ secret de l'interface passe par `ChampMotDePasse`
 * (`web/src/components/ui/index.tsx`) : un `type="password"` posé à la main
 * ailleurs serait un champ sans œil. Les pages servies par le démon (bienvenue,
 * connexions) passent par `champMotDePasseHtml`, et la page de bienvenue porte
 * en plus le générateur qui remplit la saisie et sa confirmation.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const RACINE = path.resolve(import.meta.dirname, '..');
const ECRANS = path.join(RACINE, 'web/src');

/*
 * Les seuls endroits qui posent eux-mêmes le type : le champ commun, et la fiche
 * du coffre-fort, dont l'œil vit À CÔTÉ du champ avec le bouton « Copier ».
 */
const PERMIS = new Set(['components/ui/index.tsx', 'components/coffre-fort.tsx']);

function fichiers(dossier) {
  return fs.readdirSync(dossier, { withFileTypes: true }).flatMap((entree) => {
    const chemin = path.join(dossier, entree.name);
    if (entree.isDirectory()) return fichiers(chemin);
    return /\.(tsx|ts)$/.test(entree.name) ? [chemin] : [];
  });
}

test('aucun type « password » posé à la main dans les écrans', () => {
  const fautifs = [];
  for (const fichier of fichiers(ECRANS)) {
    const relatif = path.relative(ECRANS, fichier);
    if (PERMIS.has(relatif)) continue;
    fs.readFileSync(fichier, 'utf8')
      .split('\n')
      .forEach((ligne, i) => {
        if (/type=(?:"password"|\{[^}]*['"]password['"])/.test(ligne)) fautifs.push(`${relatif}:${i + 1}`);
      });
  }
  assert.deepEqual(fautifs, [], `champ de mot de passe sans œil — passez par ChampMotDePasse : ${fautifs.join(', ')}`);
});

test('la page de bienvenue porte l’œil sur les deux champs et le générateur qui remplit les deux', async () => {
  const { pageDInstallation } = await import(path.join(RACINE, 'server/dist/page-installation.js'));
  for (const langue of ['fr', 'en', 'es', 'de', 'zh']) {
    const page = pageDInstallation({ acceptLanguage: langue, commande: 'beluga lien' });
    assert.equal((page.match(/data-oeil-mot-de-passe="masque" data-cible="p2?"/g) ?? []).length, 2, langue);
    assert.match(page, /data-generer-mot-de-passe="1" data-remplir="p,p2"/, langue);
    assert.match(page, /crypto\.getRandomValues/, langue);
    // Le champ garde son nom, son autocomplete et sa longueur minimale.
    assert.match(page, /<input id="p" type="password" name="password" autocomplete="new-password" minlength="12" required>/);
  }
});

test('les deux pages de connexion portent l’œil, jamais le générateur', () => {
  const source = fs.readFileSync(path.join(RACINE, 'server/src/http.ts'), 'utf8');
  assert.equal((source.match(/\$\{CHAMP_DE_CONNEXION\}/g) ?? []).length, 2);
  assert.doesNotMatch(source, /<input[^>]*type="password"/);
  const champ = source.slice(source.indexOf('const CHAMP_DE_CONNEXION'), source.indexOf('const LOGIN_PAGE'));
  assert.doesNotMatch(champ, /remplir/);
});
