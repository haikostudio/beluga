import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  ajustementDeCompetence,
  applicabiliteSurProjet,
  confianceDeLaFiche,
  decisionDEntretien,
  enTeteDeCompetence,
  estPassageDeCompetence,
  etatDeFiche,
  gesteDeLiaison,
  jugerLaFiche,
  nomDeFicheValide,
  nomDepuisLaSource,
  raisonDuRefus,
  texteDeLaFiche,
  texteDesCompetences,
  type Competence,
} from '@haikodev/shared';

/*
 * LE POOL DE COMPÉTENCES : ATTEIGNABLE, LU EN ENTIER, ET QUI DIT CE QU'IL REFUSE.
 *
 * Une compétence vivait dans le dossier personnel de l'utilisateur : les agents
 * lancés par HaikoDev, qui tournent chacun avec le coffre de leur compte, n'en
 * voyaient aucune — d'où un chef d'orchestre qui répond « je ne connais pas de
 * moyen de créer une offre » alors que le mode d'emploi existe. Deux chemins,
 * tous deux verrouillés ici : le coffre du compte (Claude), et le briefing (les
 * deux moteurs, rôles bridés compris).
 *
 * Et depuis le pool : ce qui n'a pas la bonne forme sort avec sa RAISON, une
 * fiche porte un ÉTAT et une PROVENANCE, son arbre est lu, et l'écriture est
 * gardée par un contrôle de qualité.
 *
 * Le dossier partagé se règle par variable, et cette variable est lue AU
 * CHARGEMENT de la configuration : elle se pose donc ici, avant tout import du
 * démon.
 */

const RACINE = fs.mkdtempSync(path.join(os.tmpdir(), 'haiko-competences-'));
const PARTAGE = path.join(RACINE, 'competences');
fs.mkdirSync(PARTAGE, { recursive: true });
process.env.HAIKODEV_COMPETENCES = PARTAGE;
process.env.HAIKODEV_DATA = path.join(RACINE, 'donnees');

const ENTETE_COMPTA = `---
name: compta
description: Créer des offres et des factures dans le logiciel de comptabilité. À utiliser dès qu'on parle de facture.
themes: facturation
symptomes: créer une offre
---`;

function poserCompetence(racine: string, nom: string, entete: string): string {
  const dossier = path.join(racine, nom);
  fs.mkdirSync(dossier, { recursive: true });
  fs.writeFileSync(path.join(dossier, 'SKILL.md'), `${entete}\n\n# ${nom}\n\n## Vérification\n\nOn relance.\n`, 'utf8');
  return dossier;
}

const FICHE: Competence = {
  nom: 'compta',
  description: 'Créer des offres et des factures.',
  dossier: '/partage/compta',
  fichier: '/partage/compta/SKILL.md',
  etat: 'active',
  themes: ['facturation'],
  symptomes: ['créer une offre'],
  projets: [],
  provenance: {},
  annexes: [],
  anomalies: [],
};

test("l'en-tête d'une compétence donne son nom, sa description et ses clés HaikoDev", () => {
  const entete = enTeteDeCompetence(`${ENTETE_COMPTA}\n\n# Facturation\n`);
  assert.equal(entete.nom, 'compta');
  assert.match(entete.description ?? '', /offres et des factures/);
  assert.equal(entete.themes, 'facturation');
});

test("une description écrite sur PLUSIEURS lignes se lit en entier", () => {
  // YAML : `description: >-` puis le texte indenté dessous. Une compétence du
  // coffre l'écrit ainsi, et le sommaire affichait « >- » à la place de sa
  // phrase — donc une fiche que rien ne pouvait plus déclencher.
  const entete = enTeteDeCompetence(
    ['---', 'name: pliee', 'description: >-', '  Ajoute un projet au serveur.', '  À utiliser dès qu’on le demande.', '---', '', '# pliee'].join(
      '\n',
    ),
  );
  assert.equal(entete.nom, 'pliee');
  assert.equal(entete.description, 'Ajoute un projet au serveur. À utiliser dès qu’on le demande.');
});

test('un fichier sans en-tête ne fait tomber personne', () => {
  assert.deepEqual(enTeteDeCompetence('# Sans en-tête\n\ndu texte'), { brut: {} });
  assert.deepEqual(enTeteDeCompetence(''), { brut: {} });
});

test('une place libre se lie, une place déjà bonne ne se retouche pas, une place prise se laisse', () => {
  assert.equal(gesteDeLiaison('/partage/compta', undefined), 'lier');
  assert.equal(gesteDeLiaison('/partage/compta', '/partage/compta'), 'deja-liee');
  assert.equal(gesteDeLiaison('/partage/compta', '/coffre/skills/compta-a-moi'), 'occupe');
});

test('le briefing porte un SOMMAIRE par thème, pas une ligne par fiche', () => {
  const texte = texteDesCompetences([FICHE, { ...FICHE, nom: 'voix', themes: [] }], '/partage');
  assert.match(texte, /COMPÉTENCES PARTAGÉES \(2\)/);
  assert.match(texte, /facturation \(1\) : compta/);
  // Le thème par défaut rattrape une fiche qui n'en déclare aucun.
  assert.match(texte, /divers \(1\) : voix/);
  assert.match(texte, /SOMMAIRE\.md/);
  // Sans compétence, pas de titre pour ne rien dire.
  assert.equal(texteDesCompetences([]), '');
  // Une fiche archivée n'est pas annoncée : elle est gardée, pas servie.
  assert.equal(texteDesCompetences([{ ...FICHE, etat: 'archivee' }]), '');
});

test('les compétences se lisent dans le dossier partagé, lien compris', async () => {
  // Une compétence écrite sur place, une autre simplement LIÉE depuis l'endroit
  // où l'utilisateur la tient à jour : les deux comptent pareil.
  poserCompetence(PARTAGE, 'compta', ENTETE_COMPTA);
  const ailleurs = poserCompetence(
    RACINE,
    'ailleurs',
    '---\nname: veille\ndescription: Suivre les nouveautés du secteur. À utiliser chaque lundi matin.\n---',
  );
  fs.symlinkSync(ailleurs, path.join(PARTAGE, 'veille'), 'dir');
  // Un dossier sans SKILL.md n'est pas une compétence.
  fs.mkdirSync(path.join(PARTAGE, 'brouillon'), { recursive: true });
  // Un fichier posé à plat non plus.
  fs.writeFileSync(path.join(PARTAGE, 'note.md'), 'une note', 'utf8');

  const { listerCompetences, lirePool } = await import('../competences.js');
  const liste = listerCompetences(PARTAGE);
  assert.deepEqual(
    liste.map((c) => c.nom),
    ['compta', 'veille'],
  );
  assert.equal(liste[0].fichier, path.join(PARTAGE, 'compta', 'SKILL.md'));

  // ET CE QUI EST ÉCARTÉ SORT AVEC SA CAUSE — plus aucun refus muet.
  const { refus } = lirePool(PARTAGE);
  const causes = new Map(refus.map((r) => [r.nom, r.cause]));
  assert.equal(causes.get('brouillon'), 'sans-mode-d-emploi');
  assert.equal(causes.get('note.md'), 'pas-un-dossier');
  assert.match(raisonDuRefus({ nom: 'brouillon', cause: 'sans-mode-d-emploi' }), /mode d'emploi/);
});

test("l'ARBRE d'une fiche est lu : la tête, et ses fichiers de détail", async () => {
  const dossier = poserCompetence(PARTAGE, 'arbre', '---\nname: arbre\ndescription: Une fiche avec des détails. À utiliser au besoin.\n---');
  fs.mkdirSync(path.join(dossier, 'references'), { recursive: true });
  fs.writeFileSync(path.join(dossier, 'references', 'api.md'), '# API\n', 'utf8');
  fs.writeFileSync(path.join(dossier, 'DESIGN.md'), '# Design\n', 'utf8');

  const { listerCompetences } = await import('../competences.js');
  const fiche = listerCompetences(PARTAGE).find((c) => c.nom === 'arbre');
  assert.deepEqual(fiche?.annexes, ['DESIGN.md', 'references/api.md']);
});

test('une fiche ARCHIVÉE reste sur le disque mais sort du service', async () => {
  poserCompetence(
    PARTAGE,
    'ancienne',
    '---\nname: ancienne\ndescription: Une leçon dépassée. À utiliser jamais.\netat: archivee\n---',
  );
  const { listerCompetences, lirePool } = await import('../competences.js');
  assert.equal(
    listerCompetences(PARTAGE).some((c) => c.nom === 'ancienne'),
    false,
  );
  assert.equal(
    lirePool(PARTAGE).fiches.some((c) => c.nom === 'ancienne'),
    true,
  );
  assert.equal(etatDeFiche('archivée'), 'archivee');
  assert.equal(etatDeFiche('n’importe quoi'), 'active');
});

test('un dossier de compétences absent ne rend rien, sans exception', async () => {
  const { listerCompetences } = await import('../competences.js');
  assert.deepEqual(listerCompetences('/dossier/qui/nexiste/pas'), []);
});

test('le briefing d’un projet nomme les compétences partagées', async () => {
  const projet = path.join(RACINE, 'projet');
  fs.mkdirSync(projet, { recursive: true });
  fs.writeFileSync(path.join(projet, 'CLAUDE.md'), '# Projet d’essai\n', 'utf8');

  const { briefing } = await import('../memory.js');
  const texte = briefing(projet, 'Essai', true, 'codex');
  assert.match(texte, /COMPÉTENCES PARTAGÉES/);
  assert.match(texte, /compta/);
});

/* ------------------------------------------------------------------ */
/* LA QUALITÉ, L'ÉCRITURE, LE SERVICE                                   */
/* ------------------------------------------------------------------ */

test("une fiche sans « Vérification » ou sans déclenchement est REFUSÉE à l'écriture, avec sa raison", () => {
  const sansVerification = texteDeLaFiche({
    nom: 'essai',
    description: 'Une procédure utile. À utiliser dès que le bandeau clignote.',
    procedure: 'On fait ceci.',
  });
  assert.equal(jugerLaFiche(sansVerification).ok, false);
  assert.match(jugerLaFiche(sansVerification).raisons.join(' '), /Vérification/);

  const sansDeclenchement = texteDeLaFiche({
    nom: 'essai',
    description: 'Un texte descriptif assez long mais qui ne dit rien du moment où il sert.',
    verification: 'On relance le contrôle.',
  });
  assert.match(jugerLaFiche(sansDeclenchement).raisons.join(' '), /QUAND/);

  const bonne = texteDeLaFiche({
    nom: 'essai',
    description: 'Réparer la barre d’état. À utiliser dès que la barre reste blanche au lancement.',
    symptome: 'La barre reste blanche.',
    procedure: 'On pose la couleur.',
    verification: 'On relance et la barre est noire.',
  });
  assert.equal(jugerLaFiche(bonne).ok, true);
});

test('un nom de fiche ne sort jamais du pool', () => {
  assert.equal(nomDeFicheValide('barre-detat-pwa'), true);
  assert.equal(nomDeFicheValide('../ailleurs'), false);
  assert.equal(nomDeFicheValide('Compta'), false);
  assert.equal(nomDeFicheValide('a'), false);
});

test("le texte d'une fiche garde les deux clés standard EN TÊTE, les autres derrière", () => {
  const texte = texteDeLaFiche({
    nom: 'barre-detat',
    description: 'Réparer la barre d’état. À utiliser dès qu’elle reste blanche.',
    themes: ['mobile'],
    symptomes: ['barre blanche'],
    verification: 'On relance.',
    provenance: { projet: 'HaikoDev', carte: 'c-12' },
  });
  const lignes = texte.split('\n');
  assert.equal(lignes[0], '---');
  assert.match(lignes[1], /^name: barre-detat$/);
  assert.match(lignes[2], /^description: /);
  assert.match(texte, /provenance-projet: HaikoDev/);
  assert.match(texte, /## Vérification/);
});

test("écrire une fiche la crée, la complète, et refuse ce qui n'est pas une procédure", async () => {
  const { ecrireLaFiche, lirePool } = await import('../competences.js');
  const dossier = path.join(RACINE, 'pool-ecriture');
  fs.mkdirSync(dossier, { recursive: true });

  const refus = ecrireLaFiche({ nom: 'sans-preuve', description: 'court' }, { dossier });
  assert.equal(refus.ok, false);
  assert.ok((refus.raisons ?? []).length > 0);

  const creee = ecrireLaFiche(
    {
      nom: 'barre-detat',
      description: 'Réparer la barre d’état. À utiliser dès qu’elle reste blanche au lancement.',
      verification: 'On relance l’application.',
      provenance: { projet: 'HaikoDev', carte: 'c-1' },
      annexes: [{ chemin: 'references/mesures.md', texte: '# Mesures\n' }],
    },
    { dossier },
  );
  assert.equal(creee.ok, true);
  assert.equal(creee.geste, 'creee');
  assert.ok(fs.existsSync(path.join(dossier, 'barre-detat', 'references', 'mesures.md')));

  const completee = ecrireLaFiche(
    {
      nom: 'barre-detat',
      description: 'Réparer la barre d’état. À utiliser dès qu’elle reste blanche au lancement.',
      verification: 'On relance l’application, puis on regarde la couleur.',
    },
    { dossier, carte: { id: 'c-2', projet: 'Autre' } },
  );
  assert.equal(completee.geste, 'completee');
  const fiche = lirePool(dossier).fiches.find((f) => f.nom === 'barre-detat');
  // La provenance d'ORIGINE ne bouge pas ; la carte du jour la renforce.
  assert.equal(fiche?.provenance.carte, 'c-1');
  assert.deepEqual(fiche?.provenance.renforceePar, ['Autre:c-2']);
  // Les deux fichiers d'entrée sont écrits par le démon.
  assert.ok(fs.existsSync(path.join(dossier, 'SOMMAIRE.md')));
  assert.ok(fs.existsSync(path.join(dossier, 'SYMPTOMES.md')));
});

test('changer l’état réécrit la seule clé « etat », jamais le reste', async () => {
  const { changerLEtat, lirePool } = await import('../competences.js');
  const dossier = path.join(RACINE, 'pool-etat');
  poserCompetence(dossier, 'compta', ENTETE_COMPTA);

  assert.equal(changerLEtat('compta', 'depreciee', dossier).ok, true);
  const texte = fs.readFileSync(path.join(dossier, 'compta', 'SKILL.md'), 'utf8');
  assert.match(texte, /etat: depreciee/);
  assert.match(texte, /themes: facturation/);
  assert.equal(lirePool(dossier).fiches[0].etat, 'depreciee');
  // Rien n'est supprimé : la fiche archivée reste lisible sur le disque.
  assert.equal(changerLEtat('compta', 'archivee', dossier).ok, true);
  assert.ok(fs.existsSync(path.join(dossier, 'compta', 'SKILL.md')));
});

test('une compétence se reconnaît à sa source, et son nom s’en déduit', () => {
  assert.equal(estPassageDeCompetence('competences/compta/SKILL.md'), true);
  assert.equal(estPassageDeCompetence('docs/regles/cartes.md'), false);
  assert.equal(nomDepuisLaSource('competences/compta/references/api.md'), 'compta');
  assert.equal(nomDepuisLaSource('server/src/tools.ts'), undefined);
});

test('la confiance monte à l’usage utile et tombe aux contradictions', () => {
  assert.equal(confianceDeLaFiche({ servie: 0, aidee: 0, inutile: 0, contredite: 0 }), 0.5);
  const bonne = confianceDeLaFiche({ servie: 8, aidee: 6, inutile: 0, contredite: 0 });
  const mauvaise = confianceDeLaFiche({ servie: 8, aidee: 1, inutile: 1, contredite: 2 });
  assert.ok(bonne > 0.75, `confiance haute attendue, ${bonne}`);
  assert.ok(mauvaise < 0.25, `confiance basse attendue, ${mauvaise}`);
  assert.equal(decisionDEntretien({ servie: 8, aidee: 1, inutile: 1, contredite: 2 }, mauvaise).geste, 'deprecier');
  assert.equal(decisionDEntretien({ servie: 12, aidee: 0, inutile: 0, contredite: 0 }, 0.5).geste, 'corriger');
  assert.equal(decisionDEntretien({ servie: 8, aidee: 6, inutile: 0, contredite: 0 }, bonne).geste, 'renforcer');
});

test('le classement départage sans renverser, et fait reculer une fiche dépréciée', () => {
  const neutre = ajustementDeCompetence({ confiance: 0.5, applicabilite: 1, etat: 'active' });
  assert.equal(neutre, 0);
  const sure = ajustementDeCompetence({ confiance: 1, applicabilite: 1, etat: 'active' });
  assert.ok(sure > 0 && sure < 0.1, `ajustement petit attendu, ${sure}`);
  const depreciee = ajustementDeCompetence({ confiance: 0.5, applicabilite: 1, etat: 'depreciee' });
  assert.ok(depreciee < -0.1, `recul net attendu, ${depreciee}`);
  // Une fiche qui ne nomme aucun projet s'applique partout : c'est le cas général.
  assert.equal(applicabiliteSurProjet([], 'HaikoDev'), 1);
  assert.equal(applicabiliteSurProjet(['HaikoDev'], 'haikodev'), 1);
  assert.ok(applicabiliteSurProjet(['Autre'], 'HaikoDev') < 1);
});

test.after(() => fs.rmSync(RACINE, { recursive: true, force: true }));
