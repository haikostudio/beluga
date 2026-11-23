import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/*
 * LA VRAIE POLICE DU PRODUIT DANS LE STUDIO (décision de l'utilisateur, 11/11/2026).
 *
 * Verrouille : l'ordre de recherche (code du projet, puis site, puis bibliothèque libre, puis
 * « introuvable » qui fait demander le fichier), le rangement par empreinte, le refus d'un fichier
 * qui n'est pas une police, la page du Studio qui déclare la police du projet à l'aperçu ET au
 * rendu, et le kit qui accepte une police importée.
 */
const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-polices-'));
process.env.BELUGA_DATA = bacASable;

const shared = await import('@beluga/shared');
const { Project } = shared;
const store = await import('../store.js');
const studio = await import('../studio.js');
const polices = await import('../studio-polices.js');

/** Un faux fichier woff2 : la signature suffit au contrôle, le reste distingue les fichiers. */
const woff2 = (marque: string) => Buffer.concat([Buffer.from('wOF2'), Buffer.alloc(16, 1), Buffer.from(marque)]);

const depot = path.join(bacASable, 'depot');
fs.mkdirSync(path.join(depot, 'public', 'fonts'), { recursive: true });
fs.writeFileSync(path.join(depot, 'public', 'fonts', 'Gilroy-Bold.woff2'), woff2('gilroy-700'));
fs.writeFileSync(path.join(depot, 'public', 'fonts', 'Gilroy-Regular.woff2'), woff2('gilroy-400'));
fs.writeFileSync(path.join(depot, 'public', 'fonts', 'Gilroy-Regular.ttf'), Buffer.concat([Buffer.from([0, 1, 0, 0]), Buffer.alloc(20, 2)]));

const projet = store.saveProject(
  Project.parse({ id: 'p-polices', name: 'Produit', path: depot, devUrl: 'https://produit.test/', createdAt: 1, updatedAt: 1 }),
);

/* Le réseau simulé : un site qui déclare « Satoshi », la bibliothèque qui connaît « Poppins ». */
const appels: string[] = [];
polices.remplacerLeTelechargement(async (url, genre) => {
  appels.push(url);
  if (url === 'https://produit.test/') return { ok: true, statut: 200, texte: '<html><head><link rel="stylesheet" href="/css/site.css"></head></html>' };
  if (url === 'https://produit.test/css/site.css')
    return {
      ok: true,
      statut: 200,
      texte: "@font-face{font-family:'Satoshi';src:url('../fonts/satoshi-500.woff2') format('woff2'),url('../fonts/satoshi-500.woff') format('woff');font-weight:500;font-style:normal}",
    };
  if (url === 'https://produit.test/fonts/satoshi-500.woff2' && genre === 'binaire') return { ok: true, statut: 200, contenu: woff2('satoshi') };
  if (url.startsWith('https://fonts.googleapis.com/css?family=Poppins:'))
    return {
      ok: true,
      statut: 200,
      texte:
        "/* latin-ext */\n@font-face{font-family:'Poppins';font-style:normal;font-weight:400;src:url(https://fonts.gstatic.com/p-ext.woff2) format('woff2');unicode-range:U+0100-02BA;}\n" +
        "/* latin */\n@font-face{font-family:'Poppins';font-style:normal;font-weight:400;src:url(https://fonts.gstatic.com/p-latin.woff2) format('woff2');unicode-range:U+0000-00FF;}\n" +
        "/* cyrillic */\n@font-face{font-family:'Poppins';font-style:normal;font-weight:400;src:url(https://fonts.gstatic.com/p-cyr.woff2) format('woff2');unicode-range:U+0400-045F;}",
    };
  if (url.startsWith('https://fonts.gstatic.com/') && genre === 'binaire') return { ok: true, statut: 200, contenu: woff2(url) };
  return { ok: false, statut: 404 };
});

test('graisse, style et famille se lisent sur un nom de fichier', () => {
  assert.deepEqual(polices.graisseEtStyleDuNom('Gilroy-SemiBold.woff2'), { graisse: '600', style: 'normal' });
  assert.deepEqual(polices.graisseEtStyleDuNom('poppins-latin-700-italic.woff2'), { graisse: '700', style: 'italic' });
  assert.deepEqual(polices.graisseEtStyleDuNom('Inter-Variable.ttf'), { graisse: '100 900', style: 'normal' });
  assert.equal(polices.familleDuNomDeFichier('PlusJakartaSans-Bold.woff2'), 'Plus Jakarta Sans');
  assert.equal(polices.familleDuNomDeFichier('Gilroy-Regular.otf'), 'Gilroy');
});

test('un fichier qui n’est pas une police est refusé', () => {
  const r = polices.rangerFichierDePolice(Buffer.from('<html>pas une police</html>'));
  assert.equal(r.ok, false);
  assert.equal(polices.formatDuContenu(woff2('x')), 'woff2');
});

test('1. le code du projet : les fichiers du dépôt, le meilleur format par graisse', async () => {
  const r = await polices.importerLaPoliceDuProduit(projet.id, 'Gilroy');
  assert.equal(r.ok, true);
  assert.equal(r.police?.source, 'depot');
  assert.equal(r.police?.fichiers.length, 2, 'Regular en woff2 plutôt qu’en ttf, et Bold');
  assert.ok(r.police?.fichiers.every((f) => f.format === 'woff2'));
  assert.deepEqual(r.police?.fichiers.map((f) => f.graisse).sort(), ['400', '700']);
  assert.equal(appels.length, 0, 'aucun appel réseau quand le dépôt suffit');
  for (const f of r.police!.fichiers) assert.ok(polices.fichierDePoliceDuProjet(f.fichier), 'fichier rangé sous son empreinte');
});

test('2. le site du produit : ses @font-face, la meilleure source', async () => {
  const r = await polices.importerLaPoliceDuProduit(projet.id, 'Satoshi');
  assert.equal(r.ok, true);
  assert.equal(r.police?.source, 'site');
  assert.equal(r.police?.fichiers.length, 1);
  assert.equal(r.police?.fichiers[0]!.graisse, '500');
  assert.ok(appels.includes('https://produit.test/fonts/satoshi-500.woff2'), 'le woff2 est préféré au woff');
});

test('3. la bibliothèque libre : latin et latin étendu seulement, avec leur plage', async () => {
  appels.length = 0;
  const r = await polices.importerLaPoliceDuProduit(projet.id, 'Poppins');
  assert.equal(r.ok, true);
  assert.equal(r.police?.source, 'bibliotheque');
  assert.equal(r.police?.fichiers.length, 2);
  assert.ok(!appels.includes('https://fonts.gstatic.com/p-cyr.woff2'));
  assert.ok(r.police?.fichiers.every((f) => f.plage));
});

test('4. introuvable partout : le directeur doit demander le fichier', async () => {
  const r = await polices.importerLaPoliceDuProduit(projet.id, 'Police Maison Inconnue');
  assert.equal(r.ok, false);
  assert.equal(r.essais.length, 3, 'code, site, bibliothèque : les trois essais sont dits');
});

test('un fichier déposé s’ajoute à la famille, et la police retirée quitte le kit', () => {
  const r = polices.importerUnFichierDePolice(projet.id, { famille: 'Gilroy', contenu: woff2('gilroy-900'), nom: 'Gilroy-Black.woff2' });
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.police.fichiers.length, 3);
  const familles = shared.policesDuProjet(studio.assurerEspaceStudio(projet.id).kit).map((p) => p.famille);
  assert.deepEqual(familles.sort(), ['Gilroy', 'Poppins', 'Satoshi']);

  studio.ecrireEspaceStudio(projet.id, { kit: { policeTitre: 'Satoshi', policeTexte: 'Inconnue' } });
  const kit = studio.assurerEspaceStudio(projet.id).kit;
  assert.equal(kit.policeTitre, 'Satoshi', 'le kit accepte une police importée');
  assert.equal(kit.policeTexte, undefined, 'mais pas une police absente');
  assert.equal(kit.polices?.length, 3, 'le formulaire du kit ne touche pas aux polices');

  assert.equal(polices.retirerLaPoliceDuProjet(projet.id, 'Satoshi'), true);
  const apres = studio.assurerEspaceStudio(projet.id).kit;
  assert.equal(apres.policeTitre, undefined, 'une police retirée ne reste pas citée');
  assert.equal(apres.polices?.length, 2);
});

test('la page déclare la police du projet, à l’aperçu comme au rendu', () => {
  const kit = { ...studio.assurerEspaceStudio(projet.id).kit, policeTitre: 'Gilroy' };
  const composition = shared.compositionVide('9:16');
  const rendu = shared.traduireEnPage(composition, { format: '9:16', kit, medias: {}, gsap: 'gsap.min.js', polices: 'polices/', mode: 'rendu' });
  const gilroy = kit.polices!.find((p) => p.famille === 'Gilroy')!;
  for (const f of gilroy.fichiers) assert.ok(rendu.includes(`url('polices/${f.fichier}')`), 'rendu : le fichier copié à côté des embarquées');
  assert.match(rendu, /--marque-police-titre:'Gilroy'/);
  assert.match(rendu, /url\('polices\/inter\.woff2'\)/, 'les embarquées restent');

  const apercu = shared.traduireEnPage(composition, {
    format: '9:16',
    kit,
    medias: {},
    gsap: 'https://app/studio/gsap.min.js',
    polices: 'https://app/studio/polices/',
    policesDuProjet: 'https://app/studio/polices-projet/',
    mode: 'apercu',
    sourcesApercu: { scripts: 'https://app/studio/', medias: 'https://app/studio-media/', polices: 'https://app/studio/' },
  });
  assert.ok(apercu.includes(`https://app/studio/polices-projet/${gilroy.fichiers[0]!.fichier}`));
  assert.match(apercu, /font-src data: https:\/\/app\/studio\//, 'la CSP de l’aperçu laisse passer la route des polices du projet');
  assert.deepEqual(shared.famillesDisponibles(kit).slice(0, 2).sort(), ['Gilroy', 'Poppins'], 'les polices du projet en tête');
});

test('le rendu copie les fichiers des polices du projet', () => {
  const dossier = fs.mkdtempSync(path.join(bacASable, 'rendu-'));
  const n = polices.copierLesPolicesDuProjet(studio.assurerEspaceStudio(projet.id).kit, dossier);
  assert.ok(n >= 3);
  assert.equal(fs.readdirSync(dossier).length, n);
});
