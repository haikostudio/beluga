import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COMMANDES_DE_BELUGA,
  commandesDuMoteur,
  consigneDeLaCommandeDeBeluga,
  descriptionDeLaProposition,
  htmlDeLaPlaquette,
  htmlDeMaquette,
  jourDOuverture,
  lienDeBoutonValable,
  lireLaMarque,
  signatureDeLaMarque,
  lireLaRecette,
  lireLeFormat,
  lireLesBlocs,
  lireUnCommentaire,
  lireUneAncre,
  lireLAdresseDePlaquette,
  avecLesSupportsDeCharte,
  documentDeLaPlaquette,
  repartitionDuSommaire,
  htmlDuLecteur,
  libellesDuLecteur,
  ancrerUnFil,
  recollerLeTexte,
  recapDesCommentairesAEnvoyer,
  courrielDuRecapDesCommentaires,
  nomDeCapture,
  piecesDeLaPlaquette,
  reponseAutoriseLaCapture,
  PLAFOND_DE_CAPTURES,
  FORMATS_DE_PLAQUETTE,
  PAGES_DE_PLAQUETTE,
  TENUE_D_UNE_DIAPOSITIVE,
  construireFragment,
  decouperEnDiapositives,
  formatDeLaPlaquette,
  lireFragment,
  lireLeFormatDePlaquette,
  blocsDeLaSortie,
  codesDeCouleur,
  filPourLeClient,
  monterLeLecteur,
  CONSIGNE_DES_OUTILS_PAYANTS,
  iconeDeSignatureValable,
  ordonnerLesBlocs,
  blocsDontLeTexteChange,
  SEUIL_DE_REFONTE,
  type FilDeCommentaires,
} from '@beluga/shared';

let n = 0;
const nouvelId = () => `b${++n}`;

/* ------------------------------------------------------------------ */
/* La recette de captures                                               */
/* ------------------------------------------------------------------ */

test('une recette se lit : adresses http(s), appareils et thèmes connus, page entière par défaut', () => {
  const r = lireLaRecette({ cibles: [{ url: 'https://exemple.fr/', nom: 'Accueil' }, 'https://exemple.fr/tarifs'], appareils: ['ordinateur', 'telephone', 'tablette'], themes: ['clair', 'sombre'] });
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.total, 8);
  assert.deepEqual(r.recette.appareils, ['ordinateur', 'telephone']);
  assert.equal(r.recette.pleinePage, true);
  assert.equal(r.recette.cibles[1]!.nom, 'tarifs');
  assert.equal(nomDeCapture(r.recette.cibles[0]!, 'telephone', 'sombre'), 'accueil-telephone-sombre.webp');
});

test('une recette refuse une adresse qui n’est pas http(s), et le trop-plein', () => {
  assert.equal(lireLaRecette({ cibles: ['file:///etc/passwd'] }).ok, false);
  assert.equal(lireLaRecette({ cibles: ['javascript:alert(1)'] }).ok, false);
  assert.equal(lireLaRecette({ cibles: [] }).ok, false);
  const trop = Array.from({ length: 11 }, (_, i) => `https://exemple.fr/p${i}`);
  const r = lireLaRecette({ cibles: trop, appareils: ['ordinateur', 'telephone'], themes: ['clair', 'sombre'] });
  assert.equal(r.ok, false);
  assert.ok(44 > PLAFOND_DE_CAPTURES);
});

test('la connexion ne porte qu’un NOM d’accès du coffre, jamais un mot de passe', () => {
  const r = lireLaRecette({ cibles: ['https://app.exemple.fr/'], connexion: { acces: 'Démo Acme', motDePasse: 'secret' } });
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.deepEqual(Object.keys(r.recette.connexion!), ['acces']);
  assert.ok(!JSON.stringify(r.recette).includes('secret'));
  assert.equal(lireLaRecette({ cibles: ['https://app.exemple.fr/'], connexion: {} }).ok, false);
  assert.match(descriptionDeLaProposition(r.recette, r.total), /coffre-fort/);
});

test('seule la réponse « Capturer » autorise la capture', () => {
  assert.equal(reponseAutoriseLaCapture('Capturer'), true);
  assert.equal(reponseAutoriseLaCapture('Capturer\nmais sans la page tarifs'), true);
  assert.equal(reponseAutoriseLaCapture('Modifier la liste'), false);
  assert.equal(reponseAutoriseLaCapture('Pas maintenant'), false);
  assert.equal(reponseAutoriseLaCapture(undefined), false);
});

/* ------------------------------------------------------------------ */
/* La commande « /captures »                                            */
/* ------------------------------------------------------------------ */

test('la commande /captures devient une consigne, et elle est proposée à tous les moteurs', () => {
  const consigne = consigneDeLaCommandeDeBeluga('/captures le site de démo');
  assert.ok(consigne);
  assert.match(consigne!, /le site de démo/);
  assert.match(consigne!, /proposer/);
  assert.equal(consigneDeLaCommandeDeBeluga('/capturesX'), null);
  // Une commande de Beluga se comprend aussi au milieu du texte.
  assert.match(consigneDeLaCommandeDeBeluga('fais des /captures du site')!, /des du site/);
  assert.equal(consigneDeLaCommandeDeBeluga('fais des captures/ecran'), null);
  assert.ok(COMMANDES_DE_BELUGA.some((c) => c.nom === 'captures'));
  for (const moteur of ['claude', 'codex', 'cursor'] as const) {
    assert.ok(commandesDuMoteur(moteur, []).some((c) => c.nom === 'captures' && c.origine === 'beluga'));
  }
  // Une commande du projet de même nom l'emporte.
  const projet = commandesDuMoteur('claude', [{ nom: 'captures', origine: 'projet' }]).find((c) => c.nom === 'captures');
  assert.equal(projet?.origine, 'projet');
});

/* ------------------------------------------------------------------ */
/* La plaquette                                                         */
/* ------------------------------------------------------------------ */

const MARQUE = { nom: 'Acme', couleur: '#0A7cff', texte: '#111111', fond: '#ffffff', logo: 'logo1234' };

test('les blocs se lisent : genre connu, bloc vide refusé, lien de bouton filtré', () => {
  const r = lireLesBlocs(
    [
      { genre: 'couverture', titre: 'Votre nouvel espace', pieces: ['cap12345'] },
      { genre: 'appel', titre: 'On en parle ?', bouton: 'Écrire', lien: 'javascript:alert(1)' },
    ],
    nouvelId,
  );
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.blocs[1]!.lien, undefined);
  assert.equal(lienDeBoutonValable('mailto:contact@acme.fr'), 'mailto:contact@acme.fr');
  assert.equal(lireLesBlocs([{ genre: 'video', titre: 'x' }], nouvelId).ok, false);
  assert.equal(lireLesBlocs([{ genre: 'texte' }], nouvelId).ok, false);
  assert.equal(lireLesBlocs([], nouvelId).ok, false);
});

test('la marque exige un nom et une couleur, et rien de Haiko n’est imposé', () => {
  assert.equal(lireLaMarque({ couleur: '#123456' }).ok, false);
  assert.equal(lireLaMarque({ nom: 'Acme', couleur: 'violet' }).ok, false);
  const m = lireLaMarque(MARQUE);
  assert.ok(m.ok);
  if (!m.ok) return;
  assert.equal(m.marque.couleur, '#0a7cff');
  const html = htmlDuLecteur({ titre: 'T', blocs: [{ id: 'a', genre: 'texte', titre: 'Bonjour', texte: 'x' }], marque: m.marque }, { base: '/plaquette/x', auteur: false, image: () => null });
  assert.ok(!/haiko/i.test(html));
});

test('le rendu échappe tout texte, et ne sert que les images citées', () => {
  const blocs = [
    { id: 'a', genre: 'couverture' as const, titre: '<script>alert(1)</script>', pieces: ['cap12345'] },
    { id: 'b', genre: 'texte' as const, titre: 'Pourquoi', texte: 'Un\n\nDeux "guillemets"' },
  ];
  const html = htmlDuLecteur({ titre: 'Démo', blocs, marque: MARQUE }, { base: '/plaquette/abc', auteur: false, image: (id) => `/plaquette/abc/image/${id}` });
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('/plaquette/abc/image/cap12345'));
  assert.ok(html.includes("/ouverte'"));
  assert.deepEqual(piecesDeLaPlaquette(blocs, MARQUE).sort(), ['cap12345', 'logo1234']);
});

test('la page de l’auteur ne signale pas d’ouverture, et le PDF n’a ni script, ni formulaire, ni commentaire', () => {
  const p = { titre: 'Démo', blocs: [{ id: 'a', genre: 'texte' as const, titre: 'A', texte: 'B' }], marque: MARQUE };
  const auteur = htmlDuLecteur(p, { base: '/plaquette/x', auteur: true, image: () => null });
  assert.ok(!auteur.includes("/ouverte'"));
  assert.ok(auteur.includes('"auteur":true'));
  const pdf = htmlDeLaPlaquette(p, { mode: 'pdf', image: () => null });
  assert.ok(!pdf.includes('<script'));
  assert.ok(!pdf.includes('<form'));
  assert.ok(!pdf.includes('lx-'));
  assert.ok(pdf.includes('@page'));
});

test('un commentaire se lit en texte brut borné ; son ancre est bornée et sa section doit exister', () => {
  const blocs = [{ id: 'a', genre: 'texte' as const, titre: 'A' }];
  const r = lireUnCommentaire({ texte: '  <b>Super</b>  ', nom: 'Léa' });
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.texte, '<b>Super</b>');
  assert.equal(r.nom, 'Léa');
  assert.equal(lireUnCommentaire({ texte: '' }).ok, false);
  assert.equal(lireUnCommentaire({ texte: 'x'.repeat(2001) }).ok, false);
  assert.deepEqual(lireUneAncre({ page: 3.4, y: 1.7, bloc: 'zz' }, blocs), { page: 3, y: 1 });
  assert.deepEqual(lireUneAncre({ page: -2, y: 0.25, bloc: 'a' }, blocs), { page: 1, y: 0.25, bloc: 'a' });
});

test('un fil reste à sa section quand le document bouge, et à sa page quand la section a disparu', () => {
  const pages = [['c'], ['t', 'g'], ['g', 'a']];
  assert.deepEqual(ancrerUnFil({ page: 2, y: 0.4, bloc: 't' }, pages), { page: 2, y: 0.4 });
  /* La section « t » est passée page 3 depuis : le fil la suit, en haut de la section. */
  assert.deepEqual(ancrerUnFil({ page: 2, y: 0.4, bloc: 't' }, [['c'], ['g'], ['t', 'a']]), { page: 3, y: -1 });
  /* Section supprimée : le fil reste à sa page (bornée au document). */
  assert.deepEqual(ancrerUnFil({ page: 9, y: 0.5, bloc: 'disparue' }, pages), { page: 3, y: 0.5 });
  assert.deepEqual(ancrerUnFil({ page: 1, y: 0 }, []), { page: 1, y: 0 });
});

test('un paragraphe coupé sur deux feuilles se recolle à l’identique', () => {
  assert.equal(
    recollerLeTexte([
      { para: '0', coupe: null, texte: 'Premier paragraphe qui' },
      { para: '0', coupe: ' ', texte: 'continue page suivante.' },
      { para: '1', coupe: null, texte: 'Second.\nAvec une ligne.' },
    ]),
    'Premier paragraphe qui continue page suivante.\n\nSecond.\nAvec une ligne.',
  );
});

test('une section masquée disparaît de la page du client et du PDF, et reste grisée dans l’éditeur', () => {
  const p = {
    titre: 'Essai',
    marque: MARQUE,
    blocs: [
      { id: 'v', genre: 'texte' as const, titre: 'Visible', texte: 'Bonjour' },
      { id: 'm', genre: 'texte' as const, titre: 'Secret', texte: 'Pas pour le client', masque: true },
      { id: 'i', genre: 'image' as const, titre: 'Cachée', pieces: ['cache1234'], masque: true },
    ],
  };
  const pdf = htmlDeLaPlaquette(p, { mode: 'pdf', image: (id) => `/i/${id}` });
  assert.ok(pdf.includes('Visible'));
  assert.ok(!pdf.includes('Secret') && !pdf.includes('Pas pour le client'));
  const client = htmlDuLecteur(p, { base: '/plaquette/x', auteur: false, image: (id) => `/i/${id}` });
  assert.ok(!client.includes('Pas pour le client') && !client.includes('cache1234'));
  assert.deepEqual(piecesDeLaPlaquette(p.blocs, MARQUE, { visibles: true }), ['logo1234']);
  const edition = documentDeLaPlaquette(p, { mode: 'document', image: () => null, edition: { masquee: 'Masquée', titre: 'Titre', texte: 'Texte' } });
  assert.ok(edition.corps.includes('Pas pour le client'));
  assert.match(edition.corps, /class="section texte saut-avant masque" data-masquee="Masquée"/);
  assert.ok(edition.corps.includes('data-champ="texte"'));
  assert.ok(!pdf.includes('data-champ'));
  /* En diapositives aussi. */
  const diapos = htmlDeLaPlaquette({ ...p, format: 'diapositives' }, { mode: 'pdf', image: () => null });
  assert.ok(!diapos.includes('Pas pour le client'));
});

test('aucune capture n’est recadrée : cadre navigateur ou téléphone, captures pleine hauteur en annexes tranchables', () => {
  const p = {
    titre: 'Essai',
    marque: MARQUE,
    blocs: [
      { id: 'c', genre: 'couverture' as const, titre: 'Couverture', pieces: ['site1234'], appareil: 'navigateur' as const, url: 'exemple.fr' },
      { id: 'i', genre: 'image' as const, titre: 'Mobile', pieces: ['mobi1234'], appareil: 'telephone' as const, aBord: 'droite' as const },
      { id: 'z', genre: 'image' as const, titre: 'Détail', pieces: ['zoom1234'], zoom: true },
      { id: 'x', genre: 'annexes' as const, titre: 'Pages entières', pieces: ['long1234'], appareil: 'navigateur' as const },
    ],
  };
  const d = documentDeLaPlaquette(p, { mode: 'document', image: (id) => `/i/${id}` });
  assert.ok(d.corps.includes('cadre-navigateur') && d.corps.includes('exemple.fr'));
  assert.ok(d.corps.includes('cadre-telephone') && d.corps.includes('a-bord-droite'));
  assert.ok(d.corps.includes('annexe tranchable'));
  /* Le seul « cover » est celui du zoom voulu. */
  assert.equal((d.css.match(/object-fit:cover/g) ?? []).length, 1);
  assert.ok(d.css.includes('.cadre-zoom img{width:100%;height:100%;max-height:none;object-fit:cover}'));
  assert.equal(lireLesBlocs([{ genre: 'annexes', pieces: ['long1234'], appareil: 'telephone', aBord: 'milieu', zoom: 'oui' }], nouvelId).ok, true);
  const lu = lireLesBlocs([{ genre: 'image', pieces: ['long1234'], appareil: 'tablette', aBord: 'milieu', url: 'https://exemple.fr/<x>' }], nouvelId);
  assert.ok(lu.ok);
  if (!lu.ok) return;
  assert.equal(lu.blocs[0]!.appareil, undefined);
  assert.equal(lu.blocs[0]!.aBord, undefined);
  assert.equal(lu.blocs[0]!.url, 'exemple.fr/x');
});

test('tu ou vous : lu sous ses noms courants, et les libellés du client le suivent', () => {
  assert.equal(lireLAdresseDePlaquette('Tutoiement'), 'tu');
  assert.equal(lireLAdresseDePlaquette('vous'), 'vous');
  assert.equal(lireLAdresseDePlaquette(''), null);
  assert.equal(libellesDuLecteur('fr', 'tu').prenom, 'Ton prénom');
  assert.equal(libellesDuLecteur('fr', 'vous').prenom, 'Votre prénom');
  assert.equal(libellesDuLecteur('de', 'tu').prenom, 'Dein Vorname');
  assert.equal(libellesDuLecteur('xx', 'vous').pdf, 'Télécharger le PDF');
  const page = htmlDuLecteur({ titre: 'T', adresse: 'tu', blocs: [{ id: 'a', genre: 'texte', texte: 'x' }], marque: MARQUE }, { base: '/plaquette/x', auteur: false, image: () => null });
  assert.ok(page.includes('Ton prénom'));
});

test('le récapitulatif du jour ne part jamais vide, jamais avant 8 h, jamais deux fois le même jour', () => {
  const neufHeures = Date.UTC(2026, 10, 5, 8, 0); // 9 h à Paris
  const septHeures = Date.UTC(2026, 10, 5, 5, 30); // 6 h 30 à Paris
  assert.equal(recapDesCommentairesAEnvoyer({ maintenant: neufHeures, dernierEnvoi: Date.UTC(2026, 10, 4, 9), nouveaux: 0 }), false);
  assert.equal(recapDesCommentairesAEnvoyer({ maintenant: septHeures, dernierEnvoi: Date.UTC(2026, 10, 4, 9), nouveaux: 3 }), false);
  assert.equal(recapDesCommentairesAEnvoyer({ maintenant: neufHeures, dernierEnvoi: Date.UTC(2026, 10, 5, 7, 30), nouveaux: 3 }), false);
  assert.equal(recapDesCommentairesAEnvoyer({ maintenant: neufHeures, dernierEnvoi: Date.UTC(2026, 10, 4, 9), nouveaux: 3 }), true);
  const c = courrielDuRecapDesCommentaires({
    documents: [{ titre: 'Offre <Acme>', lien: 'https://b.exemple/#plaquettes/tous/p1', messages: [{ auteur: 'Léa', texte: 'Le <b>prix</b> ?', creeLe: neufHeures }] }],
    lienDuService: 'https://b.exemple/#plaquettes',
  });
  assert.match(c.sujet, /Un nouveau commentaire/);
  assert.ok(c.html.includes('&lt;b&gt;prix&lt;/b&gt;') && !c.html.includes('<b>prix'));
  assert.ok(c.texte.includes('Léa'));
});

test('le jour d’une ouverture suit le fuseau du métier', () => {
  // 23 h 30 à Paris le 5 novembre = 22 h 30 UTC : encore le 5 à Paris.
  assert.equal(jourDOuverture(Date.UTC(2026, 10, 5, 22, 30)), '2026-11-05');
  assert.equal(jourDOuverture(Date.UTC(2026, 10, 5, 23, 30)), '2026-11-06');
});

/* ------------------------------------------------------------------ */
/* Les maquettes                                                        */
/* ------------------------------------------------------------------ */

test('un format se lit par son nom ou en LARGEURxHAUTEUR borné', () => {
  assert.deepEqual(lireLeFormat('story'), { largeur: 1080, hauteur: 1920, nom: 'story' });
  assert.deepEqual(lireLeFormat('1200x628'), { largeur: 1200, hauteur: 628, nom: '1200x628' });
  assert.equal(lireLeFormat('50x50'), null);
  assert.equal(lireLeFormat(''), null);
  const html = htmlDeMaquette({ style: 'appareils', largeur: 1080, hauteur: 1080, images: [{ src: 'data:x', appareil: 'telephone' }], couleur: '#000000', fond: '#ffffff', texte: '#111111', titre: '<i>' });
  assert.ok(html.includes('class="phone"'));
  assert.ok(!html.includes('<h1><i>'));
});

/* ------------------------------------------------------------------ */
/* Les formats du document (carte « Refonte de l'espace Plaquettes »)   */
/* ------------------------------------------------------------------ */

test('le format se lit sous ses noms courants ; inconnu, il est refusé à la lecture et vaut A4 portrait en base', () => {
  assert.equal(lireLeFormatDePlaquette('a4-paysage'), 'a4-paysage');
  assert.equal(lireLeFormatDePlaquette('A4'), 'a4-portrait');
  assert.equal(lireLeFormatDePlaquette('Paysage'), 'a4-paysage');
  assert.equal(lireLeFormatDePlaquette('Présentation'), 'diapositives');
  assert.equal(lireLeFormatDePlaquette('slides'), 'diapositives');
  assert.equal(lireLeFormatDePlaquette('powerpoint'), null);
  assert.equal(lireLeFormatDePlaquette(undefined), null);
  assert.equal(formatDeLaPlaquette(null), 'a4-portrait');
  assert.equal(formatDeLaPlaquette('diapositives'), 'diapositives');
  assert.deepEqual([...FORMATS_DE_PLAQUETTE], ['a4-portrait', 'a4-paysage', 'diapositives']);
});

test('chaque format imprime sa propre taille de page', () => {
  const p = { titre: 'Essai', marque: { nom: 'Atelier', couleur: '#2b5cff', texte: '#111111', fond: '#ffffff' }, blocs: [{ id: 'c', genre: 'couverture' as const, titre: 'Essai' }] };
  assert.ok(htmlDeLaPlaquette(p, { mode: 'pdf', image: () => null }).includes('size:210mm 297mm'));
  assert.ok(htmlDeLaPlaquette({ ...p, format: 'a4-paysage' }, { mode: 'pdf', image: () => null }).includes('size:297mm 210mm'));
  const diapos = htmlDeLaPlaquette({ ...p, format: 'diapositives' }, { mode: 'pdf', image: () => null });
  assert.ok(diapos.includes(`size:${PAGES_DE_PLAQUETTE.diapositives.largeurMm}mm ${PAGES_DE_PLAQUETTE.diapositives.hauteurMm}mm`));
  assert.ok(diapos.includes('class="feuille fixe couverture diapo'));
});

test('le nom et le contact de la marque ne sortent jamais de la feuille de style (en-tête et pied courants)', () => {
  const html = htmlDeLaPlaquette(
    { titre: 'T"</style><script>x()</script>', marque: { nom: 'A"};}</style>', couleur: '#2b5cff', texte: '#111111', fond: '#ffffff', contact: 'x\\"y' }, blocs: [{ id: 't', genre: 'texte', texte: 'Bonjour' }] },
    { mode: 'pdf', image: () => null },
  );
  const style = html.slice(html.indexOf('<style>'), html.indexOf('</style>') + 8);
  assert.equal(style.match(/<\/style>/g)?.length, 1, 'une seule fin de feuille de style');
  assert.ok(!html.includes('<script>x()'));
});

test('en diapositives, un texte long se coupe à la phrase, une galerie de plus de trois images aussi, rien ne se perd', () => {
  const phrase = 'Une phrase de présentation assez longue pour remplir une diapositive. ';
  const texte = Array.from({ length: 6 }, () => phrase.repeat(4).trim()).join('\n\n');
  const blocs = [
    { id: 'c', genre: 'couverture' as const, titre: 'Couverture' },
    { id: 't', genre: 'texte' as const, titre: 'Long', texte },
    { id: 'g', genre: 'galerie' as const, titre: 'Galerie', pieces: ['aaaa1', 'aaaa2', 'aaaa3', 'aaaa4', 'aaaa5'] },
    { id: 'a', genre: 'appel' as const, titre: 'Fin' },
  ];
  const d = decouperEnDiapositives(blocs);
  const textes = d.filter((x) => x.bloc.id === 't');
  assert.ok(textes.length >= 2, 'le texte long tient sur plusieurs diapositives');
  assert.ok(textes.every((x) => (x.bloc.texte ?? '').length <= TENUE_D_UNE_DIAPOSITIVE.texte));
  assert.equal(textes.map((x) => x.bloc.texte).join('\n\n').replace(/\s+/g, ' '), texte.replace(/\s+/g, ' '), 'aucun mot perdu');
  assert.deepEqual(textes.map((x) => x.suite), [false, ...textes.slice(1).map(() => true)]);
  const galeries = d.filter((x) => x.bloc.id === 'g');
  assert.deepEqual(galeries.map((x) => x.bloc.pieces), [['aaaa1', 'aaaa2', 'aaaa3'], ['aaaa4', 'aaaa5']]);
  assert.equal(d[0]!.bloc.genre, 'couverture');
  assert.equal(d.at(-1)!.bloc.genre, 'appel');
});

test('le document est une source à paginer, rangée sous « .pages » sans toucher la page qui l’accueille', () => {
  const p = { titre: 'Essai', format: 'a4-portrait', marque: { nom: 'Atelier', couleur: '#2b5cff', texte: '#111111', fond: '#ffffff' }, blocs: [{ id: 't', genre: 'texte' as const, texte: 'Bonjour' }] };
  const d = documentDeLaPlaquette(p, { mode: 'document', image: () => null });
  assert.ok(d.corps.startsWith('<div class="pages"') && d.corps.includes('<div class="source">'));
  assert.ok(!/(^|\})\s*(html|body|p|h1|h2|img)\s*[{,]/.test(d.css), 'aucune règle nue sur html, body, p, h1, h2 ou img');
  assert.ok(d.css.includes('width:210mm;height:297mm'));
});

test('l’adresse d’une plaquette ouverte sans filtre de projet passe par « tous »', () => {
  assert.equal(construireFragment({ vue: 'plaquettes', plaquetteId: 'p1' }), 'charte/tous/p1');
  assert.deepEqual(lireFragment('#plaquettes/tous/p1'), { vue: 'plaquettes', plaquetteId: 'p1' });
  assert.deepEqual(lireFragment('#plaquettes/proj/p1'), { vue: 'plaquettes', projectId: 'proj', plaquetteId: 'p1' });
  assert.equal(construireFragment({ vue: 'plaquettes' }), 'charte');
});

/* ------------------------------------------------------------------ */
/* Carte « Aperçu, chat, Agentik et vraie charte » (06/11/2026)         */
/* ------------------------------------------------------------------ */

const IMG = (id: string) => `/i/${id}`;
const MARQUE_ESSAI = { nom: 'Atelier', couleur: '#2b5cff', texte: '#16181d', fond: '#ffffff' };

test('chaque sortie retire ses propres sections : le client, le PDF, et le masque partout', () => {
  const blocs = lireLesBlocs(
    [
      { genre: 'couverture', titre: 'Titre' },
      { id: 'c', genre: 'texte', titre: 'Pour le PDF seulement', texte: 'x', horsClient: true },
      { id: 'p', genre: 'texte', titre: 'Pour le client seulement', texte: 'y', horsPdf: true },
      { id: 'm', genre: 'texte', titre: 'Masquée', texte: 'z', masque: true },
    ],
    () => 'id',
  );
  assert.ok(blocs.ok);
  if (!blocs.ok) return;
  assert.deepEqual(blocsDeLaSortie(blocs.blocs, 'client').map((b) => b.id), [blocs.blocs[0]!.id, 'p']);
  assert.deepEqual(blocsDeLaSortie(blocs.blocs, 'pdf').map((b) => b.id), [blocs.blocs[0]!.id, 'c']);
  const plaquette = { titre: 'Essai', blocs: blocs.blocs, marque: MARQUE_ESSAI };
  const client = documentDeLaPlaquette(plaquette, { mode: 'document', sortie: 'client', image: IMG }).corps;
  const pdf = htmlDeLaPlaquette(plaquette, { mode: 'pdf', sortie: 'pdf', image: IMG });
  assert.ok(client.includes('Pour le client seulement') && !client.includes('Pour le PDF seulement') && !client.includes('Masquée'));
  assert.ok(pdf.includes('Pour le PDF seulement') && !pdf.includes('Pour le client seulement') && !pdf.includes('Masquée'));
});

test('une vraie charte : sommaire en liens internes, parties, couleurs avec leurs codes, ressources, aucun « appel » requis', () => {
  const blocs = lireLesBlocs(
    [
      { genre: 'couverture', titre: 'Charte' },
      { genre: 'sommaire' },
      { id: 'p1', genre: 'partie', titre: 'Charte graphique' },
      { id: 'co', genre: 'couleurs', titre: 'Couleurs', elements: [{ valeur: '#2b5cff', libelle: 'Bleu — principale' }] },
      { id: 'ty', genre: 'typographies', titre: 'Typographies', elements: [{ valeur: 'Inter', libelle: 'Titres' }] },
      { id: 're', genre: 'ressources', titre: 'Ressources', pieces: ['piece1'] },
    ],
    () => Math.random().toString(36).slice(2, 8),
  );
  assert.ok(blocs.ok);
  if (!blocs.ok) return;
  const html = documentDeLaPlaquette(
    { titre: 'Essai', blocs: blocs.blocs, marque: MARQUE_ESSAI },
    { mode: 'document', sortie: 'client', image: IMG, infoDePiece: () => ({ nom: 'logo.png', mime: 'image/png' }), telechargement: (id) => `/t/${id}` },
  ).corps;
  assert.match(html, /<a class="ligne-sommaire chapitre" href="#bloc-p1">/);
  assert.match(html, /href="#bloc-co"[^>]*><span class="n">01<\/span>/);
  assert.match(html, /id="bloc-co"/);
  assert.match(html, /data-page-de="re"/);
  assert.match(html, /class="feuille fixe partie/);
  assert.match(html, /HEX<\/dt><dd>#2B5CFF<\/dd><dt>RGB<\/dt><dd>43 92 255<\/dd>/);
  assert.match(html, /<a class="ressource" href="\/t\/piece1" download>/);
  assert.match(html, /class="badge">PNG</);
  assert.match(html, /class="tuile-police"/);
  assert.doesNotMatch(html, /class="phrase"|Portez votre marque/, 'aucune phrase d’exemple générique sous une police');
  assert.deepEqual(codesDeCouleur('#000000'), { hex: '#000000', rgb: '0 0 0', cmjn: '0 0 0 100' });
  assert.equal(codesDeCouleur('bleu'), null);
});

test('la marque est celle du projet décrit ; l’auteur ne signe qu’en petit, et son logo n’entre jamais dans le bloc « logo »', () => {
  const lue = lireLaMarque({ nom: 'Aerofish', couleur: '#1F2326', texte: '#e9ecec', fond: '#1f2326', signature: 'Haiko Studio' });
  assert.ok(lue.ok);
  if (!lue.ok) return;
  assert.equal(lue.marque.signature, 'Haiko Studio');
  assert.equal(signatureDeLaMarque(lue.marque), 'Haiko Studio');
  /* Un document aux couleurs de l'auteur lui-même ne se signe pas deux fois. */
  assert.equal(signatureDeLaMarque({ ...lue.marque, nom: 'Haiko Studio' }), null);
  const blocs = [
    { id: 'c', genre: 'couverture' as const, titre: 'Aerofish' },
    { id: 'l', genre: 'logo' as const, titre: 'Logo' },
    { id: 'r', genre: 'ressources' as const, titre: 'Ressources', pieces: ['piece1'] },
  ];
  const d = documentDeLaPlaquette({ titre: 'Charte', blocs, marque: lue.marque, format: 'diapositives' }, { mode: 'document', sortie: 'client', image: IMG });
  /* Couverture : le nom de la marque d'abord, la signature en petit à la fin du bas de page. */
  assert.match(d.corps, /<div class="bas"><span>Aerofish<\/span>.*<span class="signature-auteur">Réalisé par Haiko Studio<\/span><\/div>/);
  assert.match(d.corps, /data-signature="Réalisé par Haiko Studio"/);
  /* Le bloc logo, sans logo de la marque : le NOM de la marque, aucune image (et rien de l'auteur). */
  const debut = d.corps.indexOf('<div class="logos">');
  const tuiles = debut >= 0 ? d.corps.slice(debut, d.corps.indexOf('</section>', debut)) : '';
  assert.ok(tuiles.includes('<span class="nom-marque">Aerofish</span>'));
  assert.ok(!/<img/.test(tuiles) && !/Haiko/.test(tuiles));
  /* Avec le logo de la marque : c'est lui, et lui seul. */
  const avecLogo = documentDeLaPlaquette({ titre: 'Charte', blocs, marque: { ...lue.marque, logo: 'logoaero1' } }, { mode: 'document', sortie: 'client', image: IMG }).corps;
  assert.ok(avecLogo.includes('src="/i/logoaero1"'));
  /* Une ancienne plaquette, sans signature : se rend sans « Réalisé par ». */
  const ancienne = documentDeLaPlaquette({ titre: 'Charte', blocs, marque: MARQUE_ESSAI }, { mode: 'document', sortie: 'client', image: IMG }).corps;
  assert.ok(!ancienne.includes('Réalisé par') && ancienne.includes('data-signature=""'));
  /* Le texte de la signature suit la langue du document. */
  assert.ok(documentDeLaPlaquette({ titre: 'C', blocs, marque: lue.marque }, { mode: 'document', sortie: 'client', image: IMG, langue: 'en' }).corps.includes('Made by Haiko Studio'));
});

test('un message supprimé garde sa place ; « moi » ne vaut que pour son auteur, et l’empreinte du visiteur ne sort jamais', () => {
  const fil: FilDeCommentaires = {
    id: 'f',
    page: 1,
    y: 0,
    resolu: false,
    creeLe: 1,
    modifieLe: 1,
    messages: [
      { id: 'a', auteur: 'Claire', role: 'client', texte: 'Bonjour', creeLe: 1, lu: true, visiteur: 'v1' },
      { id: 'b', auteur: 'Claire', role: 'client', texte: '', creeLe: 2, lu: true, supprime: true, visiteur: 'v1' },
      { id: 'c', auteur: 'Haiko', role: 'equipe', texte: 'Merci', creeLe: 3, lu: true },
    ],
  };
  const vu = filPourLeClient(fil, { visiteur: 'v1' });
  assert.deepEqual(vu.messages.map((m) => !!m.moi), [true, true, false]);
  assert.ok(vu.messages.every((m) => !('visiteur' in m) && !('lu' in m)));
  assert.equal(vu.messages[1]!.supprime, true);
  assert.deepEqual(filPourLeClient(fil, { visiteur: 'v2' }).messages.map((m) => !!m.moi), [false, false, false]);
  assert.deepEqual(filPourLeClient(fil, { equipe: true }).messages.map((m) => !!m.moi), [false, false, true]);
});

test('côté équipe, « moi » est le COMPTE qui lit : un collègue est à gauche, un ancien message est reconnu par son nom', () => {
  const fil: FilDeCommentaires = {
    id: 'f',
    page: 1,
    y: 0,
    resolu: false,
    creeLe: 1,
    modifieLe: 1,
    messages: [
      { id: 'a', auteur: 'Claire', role: 'client', texte: 'Bonjour', creeLe: 1, lu: true, visiteur: 'v1' },
      { id: 'b', auteur: 'Haiko', role: 'equipe', texte: 'Ancien', creeLe: 2, lu: true },
      { id: 'c', auteur: 'Haiko', role: 'equipe', texte: 'Neuf', creeLe: 3, lu: true, compte: 'admin' },
      { id: 'd', auteur: 'Camille', role: 'equipe', texte: 'Collègue', creeLe: 4, lu: true, compte: 'camille' },
    ],
  };
  const pourHaiko = filPourLeClient(fil, { equipe: true, compte: 'admin', nomAffiche: 'Haiko' });
  assert.deepEqual(pourHaiko.messages.map((m) => !!m.moi), [false, true, true, false]);
  assert.ok(pourHaiko.messages.every((m) => !('compte' in m)), 'le compte ne sort jamais');
  assert.deepEqual(filPourLeClient(fil, { equipe: true, compte: 'camille', nomAffiche: 'Camille' }).messages.map((m) => !!m.moi), [false, false, false, true]);
  /* Le client voit toute l'équipe à gauche. */
  assert.deepEqual(filPourLeClient(fil, { visiteur: 'v1' }).messages.map((m) => !!m.moi), [true, false, false, false]);
});

test('le lecteur commun est autonome : recopié en texte dans la page du client, sans aucune référence à un module', () => {
  const texte = String(monterLeLecteur);
  assert.ok(!/\bimport\b|require\(|_js_1|plaquette_pages/.test(texte));
  const page = htmlDuLecteur(
    { titre: 'Essai', blocs: [{ id: 'a', genre: 'texte', titre: 'T', texte: 'x' }], marque: MARQUE_ESSAI, adresse: 'vous' },
    { base: '/plaquette/j', auteur: false, image: IMG },
  );
  assert.ok(page.includes('function monterLeLecteur') && page.includes('x-visiteur') && page.includes("'DELETE'"));
  assert.equal(libellesDuLecteur('de', 'vous').supprime, 'Nachricht gelöscht');
});

test('les agents de tâche apprennent à proposer Agentik avec son prix, jamais à dépenser sans accord', () => {
  assert.match(CONSIGNE_DES_OUTILS_PAYANTS, /AGENTIK/);
  assert.match(CONSIGNE_DES_OUTILS_PAYANTS, /ask_user/);
  assert.match(CONSIGNE_DES_OUTILS_PAYANTS, /avant l’accord/);
});

/* ------------------------------------------------------------------ */
/* Finitions du lecteur de charte (06/11/2026)                          */
/* ------------------------------------------------------------------ */

test('une section = une page : chaque section de flux commence une feuille, le sommaire garde la sienne', () => {
  const blocs = [
    { id: 'c', genre: 'couverture' as const, titre: 'Doc' },
    { id: 's', genre: 'sommaire' as const },
    { id: 't', genre: 'texte' as const, titre: 'Un', texte: 'a' },
    { id: 'k', genre: 'chiffres' as const, titre: 'Deux', elements: [{ valeur: '1', libelle: 'x' }] },
    { id: 'g', genre: 'couleurs' as const, titre: 'Trois', elements: [{ valeur: '#112233', libelle: 'Bleu' }] },
  ];
  for (const format of ['a4-portrait', 'a4-paysage'] as const) {
    const corps = documentDeLaPlaquette({ titre: 'Doc', blocs, marque: MARQUE_ESSAI, format }, { mode: 'document', sortie: 'client', image: IMG }).corps;
    const sections = corps.match(/<section class="section [^"]*"/g) ?? [];
    assert.equal(sections.length, 4);
    assert.ok(sections.every((x) => x.includes(' saut-avant')), format);
    assert.match(corps, /class="section sommaire saut-avant saut-apres"/);
  }
});

test('les fichiers à télécharger sont toujours la dernière page : à la lecture des blocs comme au rendu', () => {
  const brut = [
    { id: 'c', genre: 'couverture', titre: 'Doc' },
    { id: 'r', genre: 'ressources', titre: 'Fichiers', pieces: ['piece1'] },
    { id: 'p', genre: 'partie', titre: 'Le site' },
    { id: 't', genre: 'texte', titre: 'Texte', texte: 'a' },
  ];
  const lus = lireLesBlocs(brut, nouvelId);
  assert.ok(lus.ok);
  if (!lus.ok) return;
  assert.deepEqual(lus.blocs.map((b) => b.id), ['c', 'p', 't', 'r']);
  /* Un document d'avant la règle (ressources au milieu) se rend quand même avec ses fichiers en dernier. */
  const corps = documentDeLaPlaquette({ titre: 'Doc', blocs: brut as never, marque: MARQUE_ESSAI }, { mode: 'document', sortie: 'client', image: IMG }).corps;
  assert.ok(corps.indexOf('data-bloc="r"') > corps.indexOf('data-bloc="t"'));
  /* Sans ressources, l'ordre ne bouge pas. */
  assert.deepEqual(ordonnerLesBlocs([{ id: 'a', genre: 'texte' }, { id: 'b', genre: 'image' }] as never).map((b: { id: string }) => b.id), ['a', 'b']);
});

test('l’icône du projet signataire précède « Réalisé par », sur la couverture et la dernière page, et n’est jamais gardée', () => {
  const icone = 'data:image/png;base64,iVBORw0KGgo=';
  assert.equal(iconeDeSignatureValable(icone), icone);
  assert.equal(iconeDeSignatureValable('/api/favicon?project=x'), undefined);
  assert.equal(iconeDeSignatureValable('javascript:alert(1)'), undefined);
  const marque = { ...MARQUE_ESSAI, signature: 'Haiko Studio', signatureIcone: icone };
  const blocs = [{ id: 'c', genre: 'couverture' as const, titre: 'Doc' }];
  const corps = documentDeLaPlaquette({ titre: 'Doc', blocs, marque }, { mode: 'document', sortie: 'client', image: IMG }).corps;
  assert.match(corps, /<span class="signature-auteur"><img class="icone-auteur" src="data:image\/png;base64,iVBORw0KGgo=" alt="">Réalisé par Haiko Studio<\/span>/);
  assert.match(corps, /data-signature-icone="data:image\/png;base64,iVBORw0KGgo="/);
  /* Sans signature, aucune icône ; et la marque relue n'emporte jamais l'icône en base. */
  const sans = documentDeLaPlaquette({ titre: 'Doc', blocs, marque: { ...MARQUE_ESSAI, signatureIcone: icone } }, { mode: 'document', sortie: 'client', image: IMG }).corps;
  assert.ok(!sans.includes('icone-auteur') && !sans.includes('data-signature-icone'));
  const relue = lireLaMarque(marque);
  assert.ok(relue.ok && !('signatureIcone' in relue.marque));
});

test('l’onglet du client dit « <studio> — <titre> » et porte l’icône du studio ; sans signature, le titre seul', () => {
  const icone = 'data:image/png;base64,iVBORw0KGgo=';
  const blocs = [{ id: 'a', genre: 'texte' as const, texte: 'x' }];
  const signe = htmlDuLecteur(
    { titre: 'FishFlow — <charte>', blocs, marque: { ...MARQUE_ESSAI, signature: 'Haiko Studio', signatureIcone: icone } },
    { base: '/plaquette/x', auteur: false, image: () => null },
  );
  assert.match(signe, /<title>Haiko Studio — FishFlow — &lt;charte&gt;<\/title><link rel="icon" href="data:image\/png;base64,iVBORw0KGgo=">/);
  /* La barre du lecteur garde le titre du document seul. */
  assert.match(signe, /<span class="lx-titre">FishFlow — &lt;charte&gt;<\/span>/);
  const seul = htmlDuLecteur({ titre: 'Doc', blocs, marque: { ...MARQUE_ESSAI, signatureIcone: icone } }, { base: '/plaquette/x', auteur: false, image: () => null });
  assert.match(seul, /<title>Doc<\/title>/);
  assert.ok(!seul.includes('rel="icon"'));
});

test('dans l’éditeur, chaque image, couleur, fichier et chiffre porte son repère d’élément ; jamais chez le client ni dans le PDF', () => {
  const blocs = [
    { id: 'i', genre: 'galerie' as const, titre: 'G', pieces: ['piece1', 'piece2'] },
    { id: 'k', genre: 'couleurs' as const, titre: 'C', elements: [{ valeur: '#112233', libelle: 'Bleu' }] },
    { id: 'n', genre: 'chiffres' as const, titre: 'N', elements: [{ valeur: '1', libelle: 'x' }, { valeur: '2', libelle: 'y' }] },
    { id: 'r', genre: 'ressources' as const, titre: 'R', pieces: ['piece3'] },
  ];
  const edition = documentDeLaPlaquette(
    { titre: 'Doc', blocs, marque: MARQUE_ESSAI },
    { mode: 'document', image: IMG, telechargement: () => '/t', edition: { masquee: 'M', titre: 'T', texte: 'X' } },
  ).corps;
  assert.match(edition, /data-element="image" data-element-bloc="i" data-element-index="1"/);
  assert.match(edition, /data-element="couleur" data-element-bloc="k" data-element-index="0"/);
  assert.match(edition, /data-element="chiffre" data-element-bloc="n" data-element-index="1"/);
  assert.match(edition, /<div class="ressource" data-element="ressource" data-element-bloc="r" data-element-index="0">/);
  const client = documentDeLaPlaquette({ titre: 'Doc', blocs, marque: MARQUE_ESSAI }, { mode: 'document', sortie: 'client', image: IMG, telechargement: () => '/t' }).corps;
  assert.ok(!client.includes('data-element'));
  assert.ok(client.includes('<a class="ressource" href="/t" download>'));
});

test('la page du client se remet à jour sans se recharger : elle connaît sa version et rend la nouvelle hors écran', () => {
  const page = htmlDuLecteur(
    { titre: 'Essai', blocs: [{ id: 'a', genre: 'texte', titre: 'T', texte: 'x' }], marque: MARQUE_ESSAI, adresse: 'vous' },
    { base: '/plaquette/j', auteur: false, image: IMG, version: 7 },
  );
  assert.ok(page.includes('"version":7'));
  assert.ok(page.includes("R.base+'/document'") && page.includes('lx-tampon') && page.includes('lecteur.rafraichir(neuve)'));
  assert.ok(page.includes('<style id="lx-doc">'));
});

/* ------------------------------------------------------------------ */
/* Tu ou vous redemandé à la refonte (06/11/2026)                       */
/* ------------------------------------------------------------------ */

test('une refonte des textes redemande tu ou vous ; une retouche d’un bloc, d’images ou d’ordre ne le redemande pas', () => {
  const avant = [
    { id: 'c', genre: 'couverture' as const, titre: 'Doc' },
    { id: 't', genre: 'texte' as const, titre: 'Ton', texte: 'Vous trouverez ici…' },
    { id: 'k', genre: 'chiffres' as const, titre: 'Chiffres', elements: [{ valeur: '1', libelle: 'client' }] },
  ];
  /* Deux blocs réécrits : c'est une refonte. */
  const refonte = [avant[0], { ...avant[1], texte: 'Tu trouveras ici…' }, { ...avant[2], elements: [{ valeur: '1', libelle: 'ami' }] }];
  assert.ok(blocsDontLeTexteChange(avant, refonte) >= SEUIL_DE_REFONTE);
  /* Une faute corrigée dans un seul bloc : pas de question. */
  assert.ok(blocsDontLeTexteChange(avant, [avant[0], { ...avant[1], texte: 'Vous trouverez ici.' }, avant[2]]) < SEUIL_DE_REFONTE);
  /* Images et ordre changés, textes identiques : aucun bloc réécrit. */
  assert.equal(blocsDontLeTexteChange(avant, [avant[2], { ...avant[0], pieces: ['x'] }, avant[1]]), 0);
  /* Des blocs NEUFS avec du texte comptent comme réécrits. */
  assert.equal(blocsDontLeTexteChange(avant, [...avant, { id: 'n1', genre: 'texte', texte: 'a' }, { id: 'n2', genre: 'texte', texte: 'b' }]), 2);
});

test('en diapositives, le sommaire se répartit sur plusieurs feuilles : sept lignes au plus, jamais une feuille à une seule ligne', () => {
  assert.deepEqual(repartitionDuSommaire(20), [[0, 7], [7, 14], [14, 20]]);
  assert.deepEqual(repartitionDuSommaire(7), [[0, 7]]);
  assert.deepEqual(repartitionDuSommaire(8), [[0, 4], [4, 8]]);
  for (let n = 2; n <= 60; n++) {
    const tranches = repartitionDuSommaire(n);
    assert.equal(tranches[tranches.length - 1]![1], n, `${n} lignes : toutes rangées`);
    for (const [debut, fin] of tranches) assert.ok(fin - debut >= 2 && fin - debut <= 7, `${n} lignes : une feuille de ${fin - debut}`);
  }

  /* Vingt lignes (trois parties, dix-sept sections) : trois feuilles « 1/3 », « 2/3 », « 3/3 », sans colonnes. */
  const brut: Record<string, unknown>[] = [{ genre: 'couverture', titre: 'Charte' }, { genre: 'sommaire' }];
  for (let p = 1; p <= 3; p++) {
    brut.push({ id: `p${p}`, genre: 'partie', titre: `Partie ${p}` });
    for (let s = 1; s <= (p === 3 ? 5 : 6); s++) brut.push({ id: `s${p}-${s}`, genre: 'texte', titre: `Section ${p}.${s}`, texte: 'Un court paragraphe.' });
  }
  const blocs = lireLesBlocs(brut, () => Math.random().toString(36).slice(2, 8));
  assert.ok(blocs.ok);
  if (!blocs.ok) return;
  const corps = documentDeLaPlaquette(
    { titre: 'Charte', blocs: blocs.blocs, marque: MARQUE_ESSAI, format: 'diapositives' },
    { mode: 'document', sortie: 'client', image: IMG },
  ).corps;
  assert.equal((corps.match(/class="feuille fixe diapo sommaire/g) ?? []).length, 3, 'trois diapositives de sommaire');
  assert.equal((corps.match(/class="ligne-sommaire/g) ?? []).length, 20, 'chaque ligne apparaît une seule fois');
  /* Le titre « Sommaire » ne paraît que sur la première feuille, et aucune feuille ne porte de repère « n/m ». */
  const feuilles = corps.split('<section class="feuille fixe diapo sommaire').slice(1).map((f) => f.split('</section>')[0]!);
  assert.equal(feuilles.length, 3);
  assert.match(feuilles[0]!, /<header class="entete"><h2[^>]*>Sommaire<\/h2><\/header>/, 'le titre sur la première feuille');
  assert.ok(feuilles.slice(1).every((f) => !f.includes('<header') && f.includes('<nav class="liste-sommaire')), 'les feuilles suivantes commencent par la liste');
  assert.doesNotMatch(corps, /repere-sommaire/, 'aucun repère de page');
  assert.doesNotMatch(corps, /liste-sommaire deux/, 'aucune colonne dans une diapositive de sommaire');
});

test('un site qui défile : le cadre défile seul dans la version en ligne, le PDF garde la capture entière et fixe', () => {
  const brut = [
    { genre: 'image', id: 'site', titre: 'Le site', pieces: ['capture'], appareil: 'navigateur', defilant: true },
    { genre: 'image', id: 'fixe', titre: 'Une capture', pieces: ['autre'], appareil: 'navigateur' },
    { genre: 'image', id: 'tel', titre: 'Un téléphone', pieces: ['mobile'], appareil: 'telephone', defilant: true },
  ];
  const blocs = lireLesBlocs(brut, () => Math.random().toString(36).slice(2, 8));
  assert.ok(blocs.ok);
  if (!blocs.ok) return;
  assert.equal(blocs.blocs[0]!.defilant, true);
  assert.equal(blocs.blocs[2]!.defilant, undefined, 'défilant ne vaut qu’avec un cadre navigateur');
  const plaquette = { titre: 'Site', blocs: blocs.blocs, marque: MARQUE_ESSAI, format: 'a4-portrait' as const };
  const enLigne = documentDeLaPlaquette(plaquette, { mode: 'document', sortie: 'client', image: IMG }).corps;
  assert.equal((enLigne.match(/cadre-navigateur defile/g) ?? []).length, 1, 'un seul cadre défile en ligne');
  assert.match(enLigne, /<div class="vue defile"><img src="\/i\/capture"/);
  assert.match(enLigne, /<div class="vue"><img src="\/i\/autre"/, 'le cadre fixe ne défile pas');
  const pdf = documentDeLaPlaquette(plaquette, { mode: 'pdf', image: IMG }).corps;
  assert.doesNotMatch(pdf, /defile/, 'le PDF garde la capture fixe');
  assert.match(pdf, /\/i\/capture/);
});

test('une charte porte d’office ses cartes de visite et son papier à lettres, masqués, avant les ressources ; une charte qui les a déjà n’en reçoit pas deux', () => {
  let n = 0;
  const nouvelId = () => `x${++n}`;
  const charte = [
    { id: 'c', genre: 'couverture' as const, titre: 'Charte' },
    { id: 'co', genre: 'couleurs' as const, titre: 'Couleurs', elements: [{ valeur: '#2b5cff', libelle: 'Bleu' }] },
    { id: 're', genre: 'ressources' as const, titre: 'Ressources' },
  ];
  const avec = avecLesSupportsDeCharte(charte, nouvelId);
  assert.deepEqual(avec.map((b) => b.genre), ['couverture', 'couleurs', 'partie', 'texte', 'ressources']);
  assert.equal(avec[2]!.titre, 'Cartes de visite et papier à lettres');
  assert.equal(avec[2]!.masque, true);
  assert.equal(avec[3]!.masque, true);
  assert.equal(avecLesSupportsDeCharte(avec, nouvelId).length, avec.length, 'pas de doublon');
  /* Un document qui n'est pas une charte ne reçoit rien. */
  const texte = [{ id: 't', genre: 'texte' as const, texte: 'Bonjour' }];
  assert.equal(avecLesSupportsDeCharte(texte, nouvelId).length, 1);
});
