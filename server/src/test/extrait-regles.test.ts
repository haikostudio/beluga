import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  classerRegles,
  extraitDeSujet,
  lireDemandeDeMemoire,
  mentionDEcart,
  motsDeLaRequete,
  extraitDeControles,
  lignesDeControle,
  MOTS_MINIMUM_POUR_FILTRER,
  PLAFOND_SUJET_NOMME,
  sujetNommeAFiltrer,
  partagerSujets,
  PLAFOND_EXTRAIT_SIGNES,
  SUJETS_PAR_MOTS_MAX,
  sujetNomme,
} from '@haikodev/shared';
import { detailRegles } from '../memory.js';

/*
 * SERVIR LA MÉMOIRE AU POIDS DE LA DEMANDE.
 *
 * Un sujet NOMMÉ vaut le fichier entier ; des MOTS-CLÉS ne valent qu'un extrait,
 * plafonné, et ce qui est écarté est NOMMÉ. C'est le poste de dépense le plus
 * lourd d'une tâche : un mot vague ramenait 36 000 signes de règles.
 */

/** Une règle factice, assez longue pour peser dans un plafond. */
function regle(titre: string, corps: string, remplissage = 0): string {
  return `- **${titre}** ${corps}${remplissage ? '\n  ' + 'x'.repeat(remplissage) : ''}`;
}

/* ------------------------------------------------------------------ */
/* Le classement pur                                                   */
/* ------------------------------------------------------------------ */

test('les mots de moins de quatre lettres ne classent rien', () => {
  assert.deepEqual(motsDeLaRequete('le détail de la carte'), ['détail', 'carte']);
});

test('un même mot répété ne compte qu’une fois', () => {
  assert.deepEqual(motsDeLaRequete('carte carte cartes'), ['carte', 'cartes']);
});

test('la règle qui touche le plus de mots passe devant', () => {
  const regles = [
    regle('Une colonne.', 'Parle de colonne seulement.'),
    regle('Le tiroir.', 'Parle de tiroir, de colonne et de jetons.'),
  ];
  const classees = classerRegles(regles, 'tiroir colonne jetons');
  assert.equal(classees.length, 2);
  assert.match(classees[0].texte, /Le tiroir/);
  assert.equal(classees[0].touches, 3);
  assert.equal(classees[1].touches, 1);
});

test('une règle qui ne touche aucun mot est écartée, jamais rendue', () => {
  const regles = [regle('Hors sujet.', 'Ne parle que de bateaux.'), regle('Utile.', 'Parle de jetons.')];
  const classees = classerRegles(regles, 'jetons');
  assert.equal(classees.length, 1);
  assert.match(classees[0].texte, /Utile/);
});

test('une demande sans mot utile ne classe rien — on ne devine pas', () => {
  assert.equal(classerRegles([regle('A.', 'B.')], 'de la à un').length, 0);
});

/* ------------------------------------------------------------------ */
/* Le plafond                                                          */
/* ------------------------------------------------------------------ */

test('le plafond coupe, et le nombre de règles écartées est exact', () => {
  const regles = [
    regle('Une.', 'jetons.', 400),
    regle('Deux.', 'jetons.', 400),
    regle('Trois.', 'jetons.', 400),
  ];
  const extrait = extraitDeSujet(regles, 'jetons', 900);
  assert.equal(extrait.gardees.length, 2);
  assert.equal(extrait.ecartees, 1);
});

test('la première règle passe TOUJOURS, même seule au-dessus du plafond', () => {
  const extrait = extraitDeSujet([regle('Énorme.', 'jetons.', 5000)], 'jetons', 100);
  assert.equal(extrait.gardees.length, 1);
  assert.equal(extrait.ecartees, 0);
});

test('le plafond par défaut reste très en dessous d’un fichier de sujet entier', () => {
  assert.ok(PLAFOND_EXTRAIT_SIGNES <= 8000, 'un extrait ne doit jamais peser un fichier de règles');
});

test('ce qui est écarté est NOMMÉ, avec le moyen de tout obtenir', () => {
  const mention = mentionDEcart({ id: 'cartes', libelle: 'Cartes' }, { gardees: ['a'], ecartees: 3 });
  assert.match(mention, /3 autres règles/);
  assert.match(mention, /« cartes entier »/);
});

test('rien d’écarté : aucune ligne ajoutée pour parler du vide', () => {
  assert.equal(mentionDEcart({ id: 'cartes', libelle: 'Cartes' }, { gardees: ['a'], ecartees: 0 }), '');
});

test('au plus deux sujets s’ouvrent sur des mots-clés, les mieux servis', () => {
  const sujets = [
    { id: 'a', libelle: 'A' },
    { id: 'b', libelle: 'B' },
    { id: 'c', libelle: 'C' },
  ];
  const poids = (s: { id: string }) => ({ a: 1, b: 9, c: 5 })[s.id] ?? 0;
  const { ouverts, nommes } = partagerSujets(sujets, poids);
  assert.equal(ouverts.length, SUJETS_PAR_MOTS_MAX);
  assert.deepEqual(ouverts.map((s) => s.id), ['b', 'c']);
  assert.deepEqual(nommes.map((s) => s.id), ['a']);
});

/* ------------------------------------------------------------------ */
/* Un sujet NOMMÉ garde son fichier entier                             */
/* ------------------------------------------------------------------ */

test('sujetNomme ne reconnaît qu’un nom exact, jamais un mot noyé dans une phrase', () => {
  assert.equal(sujetNomme('cartes')?.id, 'cartes');
  assert.equal(sujetNomme('  Publication  ')?.id, 'publication');
  assert.equal(sujetNomme('le détail des cartes du tableau'), undefined);
});

/* ------------------------------------------------------------------ */
/* Bout en bout, sur disque                                            */
/* ------------------------------------------------------------------ */

function projetDEssai(): string {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'haikodev-extrait-'));
  fs.mkdirSync(path.join(dossier, 'docs', 'regles'), { recursive: true });
  fs.writeFileSync(
    path.join(dossier, 'docs', 'regles', 'cartes.md'),
    '# Cartes — règles du moteur\n\n' +
      regle('Le tiroir de la carte.', 'Le tiroir montre les jetons mesurés de la carte.') +
      '\n\n' +
      // Elle parle bien de « carte », mais elle pèse à elle seule vingt mille
      // signes : c'est le plafond qui l'écarte, et l'extrait doit le DIRE.
      regle('Une colonne de rangement.', 'Une carte se range dans une colonne.\n  ' + 'y'.repeat(20000)) +
      '\n',
  );
  fs.writeFileSync(
    path.join(dossier, 'docs', 'verifications.md'),
    '# Contrôles\n\n## Cartes\n\n```bash\nnode scripts/verif-cartes.mjs # le tableau\n```\n',
  );
  return dossier;
}

test('des mots-clés rendent un EXTRAIT, pas le fichier entier', () => {
  const dossier = projetDEssai();
  const texte = detailRegles(dossier, 'le tiroir des jetons de la carte');
  assert.match(texte, /Le tiroir de la carte/, 'la règle qui répond doit être là');
  assert.doesNotMatch(texte, /yyyyy/, 'le pavé hors sujet ne doit pas partir');
  assert.match(texte, /1 autre règle de ce sujet/, "ce qui est écarté doit être dit");
  assert.ok(texte.length < 4000, `extrait trop lourd : ${texte.length} signes`);
  fs.rmSync(dossier, { recursive: true, force: true });
});

test('un extrait emporte quand même les CONTRÔLES du sujet', () => {
  const dossier = projetDEssai();
  const texte = detailRegles(dossier, 'le tiroir des jetons de la carte');
  assert.match(texte, /CONTRÔLES/);
  assert.match(texte, /verif-cartes/);
  fs.rmSync(dossier, { recursive: true, force: true });
});

test('le sujet NOMMÉ rend toujours le fichier entier', () => {
  const dossier = projetDEssai();
  const texte = detailRegles(dossier, 'cartes');
  assert.match(texte, /yyyyy/, 'un sujet demandé par son nom ne se rogne pas');
  assert.match(texte, /CONTRÔLES/);
  fs.rmSync(dossier, { recursive: true, force: true });
});

/* ------------------------------------------------------------------ */
/* …SAUF quand une CARTE dit le travail à faire                        */
/* ------------------------------------------------------------------ */

test('le marqueur « entier » se lit en fin de demande, et laisse le sujet', () => {
  assert.deepEqual(lireDemandeDeMemoire('cartes entier'), { requete: 'cartes', entier: true });
  assert.deepEqual(lireDemandeDeMemoire('  cartes EN ENTIER '), { requete: 'cartes', entier: true });
  assert.deepEqual(lireDemandeDeMemoire('cartes'), { requete: 'cartes', entier: false });
});

test('« entier » tout seul reste une demande ordinaire, jamais un marqueur', () => {
  assert.deepEqual(lireDemandeDeMemoire('entier'), { requete: 'entier', entier: false });
});

test('un sujet nommé ne se filtre que gros, sans « entier », et sur une vraie demande', () => {
  const demande = 'le bouton arrêt de la carte reste allumé';
  assert.equal(sujetNommeAFiltrer({ signes: 30000, demande, entier: false }), true);
  assert.equal(sujetNommeAFiltrer({ signes: 30000, demande, entier: true }), false, '« entier » est un choix');
  assert.equal(sujetNommeAFiltrer({ signes: 500, demande, entier: false }), false, 'un petit sujet part entier');
  assert.equal(
    sujetNommeAFiltrer({ signes: 30000, demande: 'de la à un', entier: false }),
    false,
    'sans mot utile on ne devine pas',
  );
});

test('le plafond du sujet nommé et le minimum de mots restent des garde-fous sobres', () => {
  assert.ok(PLAFOND_SUJET_NOMME >= 6000, 'un sujet moyen ne doit pas être rogné pour rien');
  assert.ok(MOTS_MINIMUM_POUR_FILTRER >= 2, 'un seul mot ne classe pas un fichier de règles');
});

/** Un projet dont le sujet « cartes » pèse plus qu'un plafond, comme le vrai. */
function grosProjet(): string {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'haikodev-gros-'));
  fs.mkdirSync(path.join(dossier, 'docs', 'regles'), { recursive: true });
  fs.writeFileSync(
    path.join(dossier, 'docs', 'regles', 'cartes.md'),
    '# Cartes\n\n' +
      regle('Le bouton arrêt.', "Un arrêt à la main ramène la carte en « Planifié ».") +
      '\n\n' +
      regle('Le départ programmé.', 'Une carte porte une date de départ.\n  ' + 'z'.repeat(12000)) +
      '\n',
  );
  return dossier;
}

test('un sujet NOMMÉ sur une carte est servi au poids de la demande de la carte', () => {
  const dossier = grosProjet();
  const travail = "Le bouton arrêt d'une carte laisse la carte allumée";
  const entier = detailRegles(dossier, 'cartes');
  const filtre = detailRegles(dossier, 'cartes', travail);

  assert.match(filtre, /Le bouton arrêt/, 'la règle qui parle du travail doit être là');
  assert.doesNotMatch(filtre, /zzzzz/, 'le pavé hors sujet ne part plus');
  assert.match(filtre, /1 autre règle de ce sujet/, "ce qui est écarté doit être dit");
  assert.match(filtre, /« cartes entier »/, 'le moyen de tout obtenir doit être écrit');
  assert.ok(filtre.length < entier.length / 5, `filtré ${filtre.length} vs entier ${entier.length}`);
  fs.rmSync(dossier, { recursive: true, force: true });
});

test('« cartes entier » rend le fichier entier, même avec une carte en cours', () => {
  const dossier = grosProjet();
  const texte = detailRegles(dossier, 'cartes entier', "Le bouton arrêt d'une carte laisse la carte allumée");
  assert.match(texte, /zzzzz/, 'l’agent a demandé le sujet entier : on obéit');
  fs.rmSync(dossier, { recursive: true, force: true });
});

test('aucune règle ne parle du travail : le sujet part entier, jamais le silence', () => {
  const dossier = grosProjet();
  const texte = detailRegles(dossier, 'cartes', 'la couleur des factures suisses imprimées');
  assert.match(texte, /zzzzz/, 'rogner jusqu’au vide serait pire que tout rendre');
  fs.rmSync(dossier, { recursive: true, force: true });
});

/* ------------------------------------------------------------------ */
/* Les CONTRÔLES suivent la même règle                                 */
/* ------------------------------------------------------------------ */

const SECTION = [
  '## Cartes',
  '',
  '```bash',
  "node scripts/verif-arret-carte.mjs # l'arrêt d'une carte la ramène en « Planifié »",
  'node scripts/verif-themes.mjs # les six ambiances et leurs palettes',
  'node scripts/verif-langues.mjs # les cinq langues de l’interface',
  '```',
].join('\n');

test('les lignes de contrôle excluent le titre et les bornes du bloc', () => {
  const lignes = lignesDeControle(SECTION);
  assert.equal(lignes.length, 3);
  assert.ok(lignes.every((l) => !l.startsWith('#') && !l.startsWith('```')));
});

test('seuls les contrôles qui parlent de la demande sont gardés, les autres comptés', () => {
  const extrait = extraitDeControles(SECTION, "l'arrêt d'une carte reste allumé", 3000);
  assert.equal(extrait.gardees.length, 1);
  assert.match(extrait.gardees[0], /verif-arret-carte/);
  assert.equal(extrait.ecartees, 2);
});

test('une demande qui ne touche aucun contrôle n’en garde aucun — l’appelant rendra tout', () => {
  assert.deepEqual(extraitDeControles(SECTION, 'betterave sucrière', 3000), { gardees: [], ecartees: 0 });
});
