import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/*
 * Constat du 17/09/2026 : le rangement de nuit comparait une règle candidate
 * aux fiches existantes SEULEMENT à l'intérieur de sa propre catégorie
 * (`convention`), avec un seuil de ressemblance de titre élevé. Une DECISION
 * posée par une carte quelques heures plus tôt, puis reformulée la nuit
 * suivante sous forme de règle nommée, ne pouvait donc jamais être retrouvée :
 * elle doublait, sous une nouvelle unité `convention`, quasiment le même fait
 * (DEC-221/MEM-2781, MEM-1904/MEM-2782, MEM-2736/MEM-2783). Le rangement de
 * nuit cherche désormais une unité proche du MÊME SUJET, toutes catégories
 * confondues, et la COMPLÈTE au lieu de la doubler — sans jamais changer sa
 * catégorie.
 */

// Une base JETABLE, posée avant les imports du démon.
process.env.BELUGA_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'haiko-rangement-nuit-doublon-'));
const { rangerUnProjet } = await import('../instructions-en-attente.js');
const { proposerUnite, unitesDeLaPortee } = await import('../connaissances.js');

const TITRE_DECISION = 'Le port de secours ne redémarre jamais tout seul';
const TITRE_REFORMULE = 'Le port de secours ne redémarre jamais tout seul, il attend un geste humain';

function projetDEssai(): string {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'haiko-rangement-nuit-doublon-projet-'));
  fs.writeFileSync(path.join(dossier, 'CLAUDE.md'), '# Instructions du moteur\n');
  return dossier;
}

function deposer(dossier: string, ...entrees: string[]): void {
  fs.mkdirSync(path.join(dossier, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(dossier, 'docs', 'instructions-en-attente.md'), ['# Instructions en attente', '', ...entrees].join('\n'));
}

test('une decision déjà posée par une carte n’est pas doublée par une règle reformulée du rangement de nuit', async () => {
  const dossier = projetDEssai();

  // La decision existe déjà, posée par une carte — comme DEC-221.
  const cree = proposerUnite(
    'global',
    {
      type: 'decision',
      importance: 'P1',
      titre: TITRE_DECISION,
      resume: 'Un service de secours attend toujours un geste humain avant de repartir.',
      detail: 'Le service de secours ne se relance jamais tout seul après une panne.',
      raisonnement: 'Un redémarrage automatique avait déjà masqué une panne réelle par le passé.',
      sujets: ['cartes'],
      confiance: 0.9,
      source: { genre: 'carte', ref: 'essai' },
    },
    { auteur: 'essai', motif: 'décision posée par une carte' },
  );
  assert.ok(cree.ok, 'la decision doit se créer');
  const idDecision = cree.ok ? cree.unite.id : '';

  // La nuit reçoit la MÊME règle, reformulée — comme une convention le lendemain.
  deposer(
    dossier,
    `## ${TITRE_REFORMULE}`,
    '- sujet : cartes',
    '',
    'Le port de secours attend toujours un geste humain avant de reprendre : un redémarrage automatique a déjà masqué une vraie panne.',
    '',
  );
  await rangerUnProjet(dossier);

  const surLeSujet = unitesDeLaPortee('global').filter((u) => u.sujets.includes('cartes') && /port de secours/.test(u.titre));
  assert.equal(surLeSujet.length, 1, 'aucune fiche en double : la decision existante est retrouvée et complétée');
  assert.equal(surLeSujet[0].id, idDecision, 'c’est bien la MÊME unité, pas une nouvelle');
  assert.equal(surLeSujet[0].type, 'decision', 'sa catégorie ne change jamais : une decision reste une decision');
  assert.match(surLeSujet[0].detail, /redémarrage automatique a déjà masqué une vraie panne/, 'le contenu est complété par la reformulation de la nuit');
});

test('une règle sans recoupement continue de créer sa propre fiche', async () => {
  const dossier = projetDEssai();

  deposer(
    dossier,
    '## Le repli des broches suit toujours la même minuterie',
    '- sujet : cartes',
    '',
    'Aucune règle proche déjà rangée : ceci doit rester une fiche à part entière.',
    '',
  );
  await rangerUnProjet(dossier);

  const fiches = unitesDeLaPortee('global').filter((u) => u.sujets.includes('cartes') && /repli des broches/.test(u.titre));
  assert.equal(fiches.length, 1, 'la règle inédite crée bien sa propre fiche');
  assert.equal(fiches[0].type, 'convention');
});

test('une règle proche COMPLÈTE la fiche : titre, résumé et ancien détail restent, la règle s’ajoute sans répétition, le rejeu ne change rien', async () => {
  const dossier = projetDEssai();
  const ancienDetail = ['### Contexte', 'Le calendrier commun garde un rappel par rendez-vous.', 'Chaque rappel passe par la file des envois.', 'La file des envois se vide toutes les minutes.'].join('\n');
  const cree = proposerUnite(
    'global',
    {
      type: 'architecture',
      importance: 'P1',
      titre: 'Le calendrier commun et ses rappels',
      resume: 'Le calendrier commun envoie un rappel par rendez-vous via la file des envois.',
      detail: ancienDetail,
      sujets: ['interface'],
      confiance: 0.9,
      source: { genre: 'carte', ref: 'essai' },
    },
    { auteur: 'essai', motif: 'fiche longue posée par une carte' },
  );
  assert.ok(cree.ok);
  const id = cree.ok ? cree.unite.id : '';

  const regle = [
    '## Le calendrier commun et ses rappels manqués',
    '- sujet : interface',
    '',
    'Un rappel manqué reste dans la file des envois jusqu’à son envoi.',
    'La file des envois se vide toutes les minutes.',
    '',
  ];
  for (let i = 0; i < 2; i++) {
    deposer(dossier, ...regle);
    await rangerUnProjet(dossier);
  }

  const fiches = unitesDeLaPortee('global').filter((u) => u.sujets.includes('interface') && /calendrier commun/.test(u.titre));
  assert.equal(fiches.length, 1, 'aucune fiche en double');
  const f = fiches[0];
  assert.equal(f.id, id);
  assert.equal(f.titre, 'Le calendrier commun et ses rappels', 'le titre de la cible est gardé');
  assert.equal(f.resume, 'Le calendrier commun envoie un rappel par rendez-vous via la file des envois.', 'le résumé de la cible est gardé');
  assert.ok(f.detail.startsWith(ancienDetail), 'l’ancien détail est intact');
  assert.match(f.detail, /Un rappel manqué reste dans la file/, 'la règle déposée est ajoutée');
  assert.equal(f.detail.split('La file des envois se vide toutes les minutes.').length - 1, 1, 'la ligne déjà présente n’est pas répétée');
  assert.equal(f.detail.split('Un rappel manqué reste dans la file').length - 1, 1, 'le rejeu n’ajoute rien');
});

test('une règle de plus de 600 signes rangée dans une fiche proche n’y ajoute aucun fragment tronqué', async () => {
  const dossier = projetDEssai();
  const cree = proposerUnite(
    'global',
    {
      type: 'architecture',
      importance: 'P1',
      titre: 'Le registre des relances et ses échéances',
      resume: 'Le registre des relances garde une échéance par dossier ouvert.',
      detail: '### Contexte\nChaque dossier ouvert porte une échéance dans le registre des relances.',
      sujets: ['publication'],
      confiance: 0.9,
      source: { genre: 'carte', ref: 'essai' },
    },
    { auteur: 'essai', motif: 'fiche posée par une carte' },
  );
  assert.ok(cree.ok);
  const id = cree.ok ? cree.unite.id : '';

  const phrases = Array.from({ length: 12 }, (_, i) => `La relance numéro ${i + 1} du registre se range après l’échéance du dossier voisin sans jamais la devancer.`);
  const corps = phrases.join(' ');
  assert.ok(corps.length > 600, 'la règle d’essai dépasse bien 600 signes');
  const entree = ['## Le registre des relances et ses échéances longues', '- sujet : publication', '', corps, ''];
  for (let i = 0; i < 2; i++) {
    deposer(dossier, ...entree);
    await rangerUnProjet(dossier);
  }

  const fiches = unitesDeLaPortee('global').filter((u) => u.sujets.includes('publication') && /registre des relances/.test(u.titre));
  assert.equal(fiches.length, 1, 'aucune fiche en double');
  assert.equal(fiches[0].id, id);
  assert.ok(!/…\s*\n\n/.test(fiches[0].detail) && !fiches[0].detail.includes('…'), 'aucun fragment coupé par « … » n’est ajouté');
  assert.equal(fiches[0].detail.split('La relance numéro 12 du registre').length - 1, 1, 'la dernière phrase n’est présente qu’une fois');
  assert.match(fiches[0].detail, /La relance numéro 1 du registre/, 'la règle entière est bien ajoutée');
});

test('une reformulation d’une fiche proche n’est pas recollée, un fait neuf l’est, et le rejeu ne change rien', async () => {
  const dossier = projetDEssai();
  const cree = proposerUnite(
    'global',
    {
      type: 'decision',
      importance: 'P1',
      titre: 'Le tiroir des archives retient son état ouvert',
      resume: 'Le tiroir des archives retient en base s’il est ouvert ou fermé, par la clé cleTiroirArchives.',
      detail: 'L’état ouvert ou fermé du tiroir des archives se retient en base grâce à la clé cleTiroirArchives, relue au retour sur la page.',
      raisonnement: 'Sans cela, le tiroir se refermait à chaque visite.',
      sujets: ['quotas'],
      confiance: 0.9,
      source: { genre: 'carte', ref: 'essai' },
    },
    { auteur: 'essai', motif: 'fait posé par une carte' },
  );
  assert.ok(cree.ok);
  const id = cree.ok ? cree.unite.id : '';

  // Reformulation seule : rien à ajouter.
  deposer(
    dossier,
    '## Le tiroir des archives retient son état ouvert ou fermé',
    '- sujet : quotas',
    '',
    'Le tiroir des archives retient en base son état ouvert ou fermé avec la clé cleTiroirArchives, relue au retour sur la page.',
    '',
  );
  await rangerUnProjet(dossier);
  const avant = unitesDeLaPortee('global').find((u) => u.id === id)!;
  assert.ok(!avant.detail.includes('retient en base son état'), 'la reformulation n’est pas recollée');

  // Un fait neuf (fichier, contrôle) s’ajoute, la redite voisine non.
  for (let i = 0; i < 2; i++) {
    deposer(
      dossier,
      '## Le tiroir des archives retient son état ouvert ou fermé',
      '- sujet : quotas',
      '',
      'Le tiroir des archives retient en base son état ouvert ou fermé avec la clé cleTiroirArchives, relue au retour sur la page.',
      'Le contrôle scripts/verif-tiroir-archives.mjs rejoue l’ouverture dans un vrai navigateur.',
      '',
    );
    await rangerUnProjet(dossier);
  }
  const apres = unitesDeLaPortee('global').find((u) => u.id === id)!;
  assert.match(apres.detail, /verif-tiroir-archives\.mjs/, 'le fait neuf est ajouté');
  assert.ok(!apres.detail.includes('retient en base son état'), 'la redite voisine reste écartée');
  assert.equal(apres.detail.split('verif-tiroir-archives.mjs').length - 1, 1, 'le rejeu n’ajoute rien');
});

test('une phrase qui finit par « ? » ou « . » devant un guillemet fermant n’est jamais coupée : aucun fragment « » … » n’est ajouté', async () => {
  const dossier = projetDEssai();
  const phraseCitee = 'Le cadrage pose « Image ou vidéo ? » en choix MULTIPLE : photo, clip, bruitage.';
  const cree = proposerUnite(
    'global',
    {
      type: 'architecture',
      importance: 'P1',
      titre: 'Le mode réalisation du studio ouvre un cahier',
      resume: 'Le mode réalisation du studio ouvre un cahier de réalisation avant toute fabrication.',
      detail: `${phraseCitee} Le vieux champ zoulou (\`genre\`) n’est plus écrit (voir « zoulou. »)`,
      sujets: ['agents'],
      confiance: 0.9,
      source: { genre: 'carte', ref: 'essai' },
    },
    { auteur: 'essai', motif: 'fiche posée par une carte' },
  );
  assert.ok(cree.ok);
  const id = cree.ok ? cree.unite.id : '';

  const regle = [
    '## Le mode réalisation du studio ouvre un cahier, et la citation reste entière',
    '- sujet : agents',
    '',
    `${phraseCitee} Le vieux champ zoulou (\`genre\`) n’est plus écrit (voir « zoulou. ») Un ticket « Merci. » Le registre quokka garde la trace de chaque essai.`,
    '',
  ];
  for (let i = 0; i < 2; i++) {
    deposer(dossier, ...regle);
    await rangerUnProjet(dossier);
  }

  const f = unitesDeLaPortee('global').find((u) => u.id === id)!;
  const ajoute = f.detail.slice(f.detail.indexOf('(voir « zoulou. »)') + 1);
  for (const ligne of f.detail.split('\n')) assert.ok(!/^\s*[»”"’)]/.test(ligne), `aucune ligne ne commence par un guillemet fermant : ${ligne}`);
  assert.ok(!/(^|\s)[»”)]\s/.test(ajoute.replace(/[.!?…]\s?[»”"’)]/g, '')), 'rien d’ajouté ne commence par un guillemet fermant');
  assert.match(f.detail, /Le registre quokka garde la trace de chaque essai\./, 'une vraie nouvelle phrase après une fin de citation est ajoutée');
  assert.equal(f.detail.split('Image ou vidéo ? »').length - 1, 1, 'la phrase citée n’est pas répétée');
  assert.equal(f.detail.split('quokka').length - 1, 1, 'le rejeu n’ajoute rien');
});

test('un titre contenu en entier dans celui d’une fiche existante la COMPLÈTE au lieu de créer une jumelle', async () => {
  const dossier = projetDEssai();
  const titreLong = 'Le relevé des abonnés se lit par un curseur unique : horodatage puis identifiant, archives mêlées';
  const titreCourt = 'Le relevé des abonnés se lit par un curseur unique';
  const cree = proposerUnite(
    'global',
    {
      type: 'convention',
      importance: 'P1',
      titre: titreLong,
      resume: 'Le relevé des abonnés avance par un curseur horodatage puis identifiant.',
      detail: 'Le curseur trie par horodatage puis identifiant.',
      sujets: ['interface'],
      confiance: 0.9,
      source: { genre: 'carte', ref: 'essai' },
    },
    { auteur: 'essai', motif: 'fiche posée par une carte' },
  );
  assert.ok(cree.ok);
  const id = cree.ok ? cree.unite.id : '';

  deposer(
    dossier,
    `## ${titreCourt}`,
    '- sujet : interface',
    '',
    'Les abonnés archivés restent dans le même flux que les actifs, sans second appel.',
    '',
  );
  await rangerUnProjet(dossier);

  const fiches = unitesDeLaPortee('global').filter((u) => u.sujets.includes('interface') && /relevé des abonnés/.test(u.titre));
  assert.equal(fiches.length, 1, 'aucune jumelle créée');
  assert.equal(fiches[0].id, id);
  assert.match(fiches[0].detail, /second appel/, 'la règle déposée complète le détail');
});

test('une règle dont le corps est COUPÉ sur plusieurs lignes est recollée par paragraphe : aucun bout de phrase, rejeu sans effet', async () => {
  const dossier = projetDEssai();
  const cree = proposerUnite(
    'global',
    {
      type: 'component',
      importance: 'P1',
      titre: 'Le menu des jetons rapides et ses pastilles violettes',
      resume: 'Le menu des jetons rapides s’ouvre sur une barre posée en début de texte.',
      detail: 'Le menu des jetons rapides s’ouvre sur une barre posée en début de texte.\n\n## Où\nDans le champ de saisie.',
      sujets: ['interface'],
      confiance: 0.9,
      source: { genre: 'carte', ref: 'essai' },
    },
    { auteur: 'essai', motif: 'fiche posée par une carte' },
  );
  assert.ok(cree.ok);
  const regle = [
    '## Le menu des jetons rapides et ses pastilles violettes cumulables',
    '- sujet : interface',
    '',
    'Les jetons reconnus se dessinent en pastilles violettes DANS le champ, par le calque des tags (composer.tsx), sans changer',
    'un pixel de mise en page. Elles s’effacent d’un bloc (`effacementDeJeton`). Un jeton du moteur part seul : à côté',
    'd’un autre, la ligne du menu est grisée et dit pourquoi (`refusDeJeton`) ; choisi au milieu d’un texte, il se pose',
    'en tête (`insereJetonEnTete`).',
    '',
    'Échap, menu ouvert, ne referme que le menu.',
    '- une puce à part',
    '- une seconde puce',
    '',
  ];
  let detail = '';
  for (let i = 0; i < 2; i++) {
    deposer(dossier, ...regle);
    await rangerUnProjet(dossier);
    const f = unitesDeLaPortee('global').find((u) => u.titre === 'Le menu des jetons rapides et ses pastilles violettes');
    assert.ok(f);
    if (i === 0) detail = f.detail;
    else assert.equal(f.detail, detail, 'le rejeu ne change pas la fiche');
  }
  assert.match(detail, /sans changer un pixel de mise en page\. Elles s’effacent d’un bloc/, 'les lignes du paragraphe sont recollées');
  assert.match(detail, /choisi au milieu d’un texte, il se pose en tête \(`insereJetonEnTete`\)\./);
  for (const ligne of detail.split('\n').filter((l) => l.trim())) {
    assert.doesNotMatch(ligne, /^[a-zà-ÿ)]/, `ligne qui commence en milieu de phrase : ${ligne}`);
    assert.ok(ligne.trim().split(/\s+/).length > 1 || /^#/.test(ligne), `mot isolé : ${ligne}`);
  }
  assert.match(detail, /^- une puce à part$/m, 'une puce reste sa propre ligne');
  assert.match(detail, /^- une seconde puce$/m);
});
