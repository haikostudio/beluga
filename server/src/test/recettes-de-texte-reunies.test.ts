import test from 'node:test';
import assert from 'node:assert/strict';
import {
  aplatiLigne,
  dossierPourDepot,
  dossierDeSite,
  enIdentifiant,
  idDEtape,
  idDeMoteurAjoute,
  minusculesSansAccents,
  nomBrancheHorsTache,
  nomDeBranche,
  nomDuDossierDeLaCopie,
  titreDeBranche,
  nomDeRepere,
  normaliserIdentifiant,
  normaliserRecherche,
  slugEntier,
  genreDemande,
  niveauDemande,
} from '@beluga/shared';

/*
 * DEUX RECETTES DE TEXTE RECOPIÉES UNE VINGTAINE DE FOIS, MAINTENANT UNE SEULE.
 *
 * A — « minuscules sans accents » : `minusculesSansAccents`.
 * B — « nom court à tirets » : `slugEntier`, puis la coupe et le repli propres
 *     à chaque appelant.
 *
 * Chaque ancienne écriture est recopiée ici telle qu'elle était, et comparée
 * au résultat actuel sur des chaînes piégeuses, puis sur TOUS les caractères
 * (un à un, et encadrés) : un nom de branche ou de dossier déjà créé ne doit
 * pas bouger d'un signe.
 */

const PIEGES = [
  '',
  ' ',
  '   \t\n ',
  'Échéance',
  'Clé OVH',
  'ÉCOLE Élémentaire à Noël',
  'İstanbul',
  'İ',
  'ǅ ǈ ǋ',
  'ﬁn ﬂeur Œuvre Æsir ß ẞ',
  'Σίσυφος ΟΔΥΣΣΕΥΣ',
  'K Å Ω',
  '́',
  'é̀',
  'ȧb',
  '--déjà--vu--',
  '  -- Titre --  ',
  'a!!!b???c',
  'a - b — c',
  'Base PocketBase',
  'Café (Chine) — v2.0',
  '😀 émoji 😀',
  'x'.repeat(39) + ' y',
  'x'.repeat(40) + '-z',
  'mot-'.repeat(15),
  'Un très long titre de carte qui dépasse largement les quarante signes permis',
  'Un très long titre de carte qui dépasse largement les cinquante signes permis, vraiment',
  'a'.repeat(59) + ' b' + 'c'.repeat(30),
  'ab-' + 'c'.repeat(37) + '-d',
];

/** Tous les caractères du plan de base, hors substituts, plus quelques hors plan. */
function* tousLesCaracteres(): Generator<string> {
  for (let c = 0; c <= 0xffff; c++) {
    if (c >= 0xd800 && c <= 0xdfff) continue;
    yield String.fromCharCode(c);
  }
  for (const c of [0x10000, 0x1d400, 0x1f600, 0x1e900, 0x1e922, 0x10400, 0x10428]) yield String.fromCodePoint(c);
}

function* entrees(): Generator<string> {
  yield* PIEGES;
  for (const c of tousLesCaracteres()) {
    yield c;
    yield ` ${c} `;
    yield `-${c}-`;
    yield `a${c}B`;
  }
}

/* ---- Anciennes écritures, recopiées ---- */

const ancienNotes = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const ancienNotesTrim = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const ancienStyles = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const ancienTrimAvant = (t: string) => t.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

const ancienDossierDeSite = (nom: string, id: string) => {
  const propre = (nom || 'site')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return `${propre || 'site'}-${id.slice(0, 8)}`;
};

const ancienNomDeBranche = (titre: string, cardId: string) => {
  const slug = (titre ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
  return `tache/${slug || 'sans-titre'}-${cardId.slice(0, 6)}`;
};

const ancienIdDEtape = (texte: string) =>
  (texte || 'etape')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '') || 'etape';

const ancienEnIdentifiant = (texte: string, max = 40) =>
  String(texte ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '');

const ancienNomDeRepere = (valeur: string) => {
  const nom = valeur
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
  return nom || undefined;
};

const ancienBrancheHorsTache = (titre: string | undefined, sha: string) => {
  const base = (titre ?? 'travail')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  const empreinte = sha.slice(0, 7) || 'sans-sha';
  return `hors-tache/${base || 'travail'}-${empreinte}`;
};

const ancienMoteur = (nom: string) => {
  const racine =
    nom
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 36) || 'moteur';
  return `ext-${racine}`;
};

const ancienDepot = (nom: string) =>
  nom
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50) || 'projet';

const ancienProjet = (folder: string | undefined, name: string) =>
  (folder?.trim() || name)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50) || 'projet';

/** Ce que `server/src/projects.ts` calcule désormais (la fonction y est privée). */
const nouveauProjet = (folder: string | undefined, name: string) =>
  slugEntier(folder?.trim() || name).slice(0, 50) || 'projet';

const ancienAplati = (texte: string) =>
  texte
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/['’]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

test('famille A : minusculesSansAccents égale chaque ancienne copie, sur tous les caractères', () => {
  let n = 0;
  for (const e of entrees()) {
    n++;
    const voulu = ancienNotes(e);
    assert.equal(minusculesSansAccents(e), voulu, JSON.stringify(e));
    assert.equal(ancienStyles(e), voulu, `lower avant NFD : ${JSON.stringify(e)}`);
    assert.equal(minusculesSansAccents(e).trim(), ancienNotesTrim(e), `trim après : ${JSON.stringify(e)}`);
    assert.equal(minusculesSansAccents(e.trim()), ancienTrimAvant(e), `trim avant : ${JSON.stringify(e)}`);
    assert.equal(normaliserIdentifiant(e), ancienTrimAvant(e));
    assert.equal(normaliserRecherche(e), ancienNotesTrim(e));
  }
  assert.ok(n > 250000);
  assert.equal(normaliserRecherche(undefined as unknown as string), '');
});

test('les lecteurs de mot (genre, niveau) gardent le même trim avant normalisation', () => {
  assert.equal(genreDemande('  Dépôt '), 'code');
  assert.equal(genreDemande(' DATABASE'), 'base');
  assert.equal(niveauDemande('  Léger '), 'leger');
  assert.equal(niveauDemande(' Approfondi'), 'approfondi');
  assert.equal(niveauDemande('   '), undefined);
});

test('famille B : chaque nom court égale son ancienne écriture, coupe et repli compris', () => {
  for (const e of entrees()) {
    const s = JSON.stringify(e);
    assert.equal(dossierDeSite({ nom: e, id: 'abcdefghijkl' } as never), ancienDossierDeSite(e, 'abcdefghijkl'), s);
    // Le dossier de la copie garde l'ancienne écriture de la branche (quarante signes) ;
    // la branche, elle, est plus courte depuis le 15/10/2026.
    assert.equal(`tache/${nomDuDossierDeLaCopie(e, 'abcdefghi')}`, ancienNomDeBranche(e, 'abcdefghi'), s);
    assert.ok(titreDeBranche(e).length <= 24 && !titreDeBranche(e).endsWith('-'), s);
    assert.equal(idDEtape(e), ancienIdDEtape(e), s);
    assert.equal(enIdentifiant(e), ancienEnIdentifiant(e), s);
    assert.equal(enIdentifiant(e, 12), ancienEnIdentifiant(e, 12), s);
    assert.equal(nomDeRepere(e), ancienNomDeRepere(e), s);
    assert.equal(nomBrancheHorsTache([{ titre: e, sha: '0123456789' } as never]), ancienBrancheHorsTache(e, '0123456789'), s);
    assert.equal(idDeMoteurAjoute(e), ancienMoteur(e), s);
    assert.equal(dossierPourDepot(e), ancienDepot(e), s);
    assert.equal(nouveauProjet(undefined, e), ancienProjet(undefined, e), s);
    assert.equal(nouveauProjet(e, 'Nom du projet'), ancienProjet(e, 'Nom du projet'), s);
  }
});

test('le doublon exact aplati de question-en-texte est bien aplatiLigne', () => {
  for (const e of entrees()) assert.equal(aplatiLigne(e), ancienAplati(e), JSON.stringify(e));
});

test('exemples lisibles : ce que les noms deviennent', () => {
  assert.equal(nomDeBranche('Réparer l’écran « Échéance » !', 'abcdef123'), 'tache/reparer-l-ecran-echeance-abcdef');
  assert.equal(dossierPourDepot('Mon Dépôt Été'), 'mon-depot-ete');
  assert.equal(idDEtape('Base PocketBase'), 'base-pocketbase');
  assert.equal(idDEtape(''), 'etape');
  assert.equal(idDeMoteurAjoute('DeepSeek (Chine)'), 'ext-deepseek-chine');
});
