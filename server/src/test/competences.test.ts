import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { enTeteDeCompetence, gesteDeLiaison, texteDesCompetences } from '@haikodev/shared';

/*
 * LES COMPÉTENCES PARTAGÉES SONT ATTEIGNABLES PAR TOUS LES AGENTS.
 *
 * Une compétence vivait dans le dossier personnel de l'utilisateur : les agents
 * lancés par HaikoDev, qui tournent chacun avec le coffre de leur compte, n'en
 * voyaient aucune — d'où un chef d'orchestre qui répond « je ne connais pas de
 * moyen de créer une offre » alors que le mode d'emploi existe. Deux chemins,
 * tous deux verrouillés ici : le coffre du compte (Claude), et le briefing (les
 * deux moteurs, rôles bridés compris).
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
description: Créer des offres et des factures dans le logiciel de comptabilité.
---`;

function poserCompetence(racine: string, nom: string, entete: string): string {
  const dossier = path.join(racine, nom);
  fs.mkdirSync(dossier, { recursive: true });
  fs.writeFileSync(path.join(dossier, 'SKILL.md'), `${entete}\n\n# ${nom}\n`, 'utf8');
  return dossier;
}

test("l'en-tête d'une compétence donne son nom et sa description", () => {
  const entete = enTeteDeCompetence(`${ENTETE_COMPTA}\n\n# Facturation\n`);
  assert.equal(entete.nom, 'compta');
  assert.match(entete.description ?? '', /offres et des factures/);
});

test('un fichier sans en-tête ne fait tomber personne', () => {
  assert.deepEqual(enTeteDeCompetence('# Sans en-tête\n\ndu texte'), {});
  assert.deepEqual(enTeteDeCompetence(''), {});
});

test('une place libre se lie, une place déjà bonne ne se retouche pas, une place prise se laisse', () => {
  assert.equal(gesteDeLiaison('/partage/compta', undefined), 'lier');
  assert.equal(gesteDeLiaison('/partage/compta', '/partage/compta'), 'deja-liee');
  assert.equal(gesteDeLiaison('/partage/compta', '/coffre/skills/compta-a-moi'), 'occupe');
});

test('le briefing annonce chaque compétence avec le chemin de son mode d’emploi', () => {
  const texte = texteDesCompetences([
    {
      nom: 'compta',
      description: 'Créer des offres et des factures.',
      dossier: '/partage/compta',
      fichier: '/partage/compta/SKILL.md',
    },
  ]);
  assert.match(texte, /compta/);
  assert.match(texte, /\/partage\/compta\/SKILL\.md/);
  // Sans compétence, pas de titre pour ne rien dire.
  assert.equal(texteDesCompetences([]), '');
});

test('les compétences se lisent dans le dossier partagé, lien compris', async () => {
  // Une compétence écrite sur place, une autre simplement LIÉE depuis l'endroit
  // où l'utilisateur la tient à jour : les deux comptent pareil.
  poserCompetence(PARTAGE, 'compta', ENTETE_COMPTA);
  const ailleurs = poserCompetence(RACINE, 'ailleurs', '---\nname: veille\ndescription: Suivre les nouveautés.\n---');
  fs.symlinkSync(ailleurs, path.join(PARTAGE, 'veille'), 'dir');
  // Un dossier sans SKILL.md n'est pas une compétence.
  fs.mkdirSync(path.join(PARTAGE, 'brouillon'), { recursive: true });

  const { listerCompetences } = await import('../competences.js');
  const liste = listerCompetences(PARTAGE);
  assert.deepEqual(
    liste.map((c) => c.nom),
    ['compta', 'veille'],
  );
  assert.equal(liste[0].fichier, path.join(PARTAGE, 'compta', 'SKILL.md'));
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

test.after(() => fs.rmSync(RACINE, { recursive: true, force: true }));
