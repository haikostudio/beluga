import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PROCEDURE_VPS_PAR_DEFAUT,
  contraintePortee,
  gestesExternes,
  mentionPortee,
  porteeDeLEtape,
  procedureAffichee,
  procedureDeLEtape,
  procedureEnPlace,
  refusPorteeDeLEtape,
  transfertExterneAutorise,
} from '@haikodev/shared';

/* ------------------------------------------------------------------ */
/* DÉPLOYER, C'EST SUR CE SERVEUR ; METTRE EN PRODUCTION, C'EST AILLEURS*/
/*                                                                      */
/* Le déploiement a une portée `vps` : rien ne sort de cette machine.    */
/* La mise en production a une portée `externe` : c'est la SEULE étape   */
/* qui peut passer par FTP, par SSH ou par GitHub, et seulement quand    */
/* on l'a explicitement définie.                                        */
/* ------------------------------------------------------------------ */

const ICI = path.dirname(fileURLToPath(import.meta.url));
const SOURCE_DEPLOY = fs.readFileSync(path.resolve(ICI, '../../src/deploy.ts'), 'utf8');
const SOURCE_BLOC = fs.readFileSync(path.resolve(ICI, '../../../web/src/components/deploy-panel.tsx'), 'utf8');
const SOURCE_PANNEAU = fs.readFileSync(
  path.resolve(ICI, '../../../web/src/components/procedure-panel.tsx'),
  'utf8',
);

/* ------------------------------------------------------------------ */
/* La portée de chaque étape                                            */
/* ------------------------------------------------------------------ */

test('la portée est attachée à l’étape, elle ne se règle pas', () => {
  assert.equal(porteeDeLEtape('dev'), 'vps');
  assert.equal(porteeDeLEtape('production'), 'externe');
  assert.equal(transfertExterneAutorise('dev'), false);
  assert.equal(transfertExterneAutorise('production'), true);
});

test('la portée se DIT, dans les deux sens', () => {
  assert.match(mentionPortee('dev'), /ce serveur/i);
  assert.match(mentionPortee('dev'), /FTP/);
  assert.match(mentionPortee('production'), /seule étape/i);
});

/* ------------------------------------------------------------------ */
/* Le déploiement VPS par défaut                                        */
/* ------------------------------------------------------------------ */

test('un projet sans procédure de déploiement a quand même la procédure VPS', () => {
  assert.equal(procedureAffichee('dev', ''), PROCEDURE_VPS_PAR_DEFAUT);
  assert.equal(procedureAffichee('dev', '   '), PROCEDURE_VPS_PAR_DEFAUT);
  // Écrite, c'est elle qui gagne : le défaut ne recouvre jamais un choix.
  assert.equal(procedureAffichee('dev', 'Relancer le service.'), 'Relancer le service.');
});

test('la mise en production, elle, n’a AUCUN défaut', () => {
  assert.equal(procedureAffichee('production', ''), '');
  assert.equal(procedureAffichee('production', '  '), '');
});

test('le déploiement est TOUJOURS en place, la mise en production jamais d’office', () => {
  assert.equal(procedureEnPlace({}, 'dev'), true);
  assert.equal(procedureEnPlace(undefined, 'dev'), true);
  assert.equal(procedureEnPlace({}, 'production'), false);
});

test('le défaut reste le déroulé CONSTATÉ : aucun texte n’est envoyé à un agent', () => {
  // `procedureDeLEtape` rend le vide : c'est HaikoDev qui déroule, pas un agent.
  assert.equal(procedureDeLEtape({}, 'dev'), '');
  assert.equal(procedureDeLEtape({ deploiement: { constate: true } }, 'dev'), '');
});

test('la procédure par défaut interdit noir sur blanc de sortir du serveur', () => {
  assert.match(PROCEDURE_VPS_PAR_DEFAUT, /ne faut surtout pas faire/i);
  assert.match(PROCEDURE_VPS_PAR_DEFAUT, /mise en production/i);
});

/* ------------------------------------------------------------------ */
/* Ce que l'agent qui rédige reçoit                                     */
/* ------------------------------------------------------------------ */

test('l’agent qui écrit un déploiement se voit interdire tout envoi extérieur', () => {
  const lignes = contraintePortee('dev').join('\n');
  assert.match(lignes, /CE SERVEUR/);
  assert.match(lignes, /FTP/);
  assert.match(lignes, /SSH/);
  assert.match(lignes, /GitHub/);
});

test('l’agent qui écrit une mise en production a le droit de sortir', () => {
  const lignes = contraintePortee('production').join('\n');
  assert.match(lignes, /SEULE étape/);
  assert.match(lignes, /FTP/);
});

/* ------------------------------------------------------------------ */
/* Le garde-fou                                                         */
/* ------------------------------------------------------------------ */

test('un déploiement qui décrit un transfert extérieur est REFUSÉ', () => {
  const refus = refusPorteeDeLEtape('dev', 'Construire, puis scp dist/ vers le serveur du client.');
  assert.ok(refus, 'le refus doit exister');
  assert.match(refus!, /mise en production/i);
  assert.match(refus!, /scp/i);
});

test('les moyens de sortir sont NOMMÉS, un par un', () => {
  assert.deepEqual(gestesExternes('rsync -az dist/ deploy@client.example:/var/www'), [
    'rsync vers un serveur distant',
  ]);
  assert.deepEqual(gestesExternes('ssh deploy@client.example "systemctl restart app"'), [
    'connexion SSH sortante',
  ]);
  assert.deepEqual(gestesExternes('Envoyer par lftp sur ftp://client.example'), [
    'transfert FTP/SFTP',
    'transfert FTP (lftp)',
    'adresse FTP',
  ]);
  assert.deepEqual(gestesExternes('Déposer le dossier construit en SFTP.'), ['transfert FTP/SFTP']);
  assert.deepEqual(gestesExternes('gh workflow run deploy.yml'), [
    'déclenchement d’un workflow GitHub',
  ]);
});

test('UNE LIGNE QUI INTERDIT LE FTP N’EST PAS UN FTP', () => {
  // Toute procédure honnête finit par « ce qu'il ne faut surtout pas faire ».
  assert.deepEqual(gestesExternes(PROCEDURE_VPS_PAR_DEFAUT), []);
  assert.equal(refusPorteeDeLEtape('dev', PROCEDURE_VPS_PAR_DEFAUT), null);
  assert.deepEqual(gestesExternes('Ne jamais envoyer par FTP ni par SSH.'), []);
  assert.deepEqual(gestesExternes('Aucun transfert scp vers l’extérieur.'), []);
});

test('un déploiement local honnête n’est jamais pris en défaut', () => {
  const locale = [
    'Construire le projet avec npm run build.',
    'Copier dist/ dans /var/www/site sur cette machine.',
    'rsync -a dist/ /var/www/site/',
    'Redémarrer le service systemd du projet.',
  ].join('\n');
  assert.deepEqual(gestesExternes(locale), [], 'rsync local ne vise aucun hôte distant');
  assert.equal(refusPorteeDeLEtape('dev', locale), null);
});

test('une MISE EN PRODUCTION n’est jamais refusée pour être sortie du serveur', () => {
  assert.equal(refusPorteeDeLEtape('production', 'Déposer les fichiers par scp sur le serveur du client.'), null);
});

/* ------------------------------------------------------------------ */
/* Le branchement                                                       */
/* ------------------------------------------------------------------ */

test('startDeploy refuse un déploiement hors du serveur, avant la file d’attente', () => {
  const refus = SOURCE_DEPLOY.indexOf('refusPorteeDeLEtape(etape.cible, promptProduction)');
  const file = SOURCE_DEPLOY.indexOf('if (active.has(projectId))');
  assert.notEqual(refus, -1, 'le garde-fou doit être écrit noir sur blanc');
  assert.ok(refus < file, 'on refuse avant même de mettre en file');
});

test('le bouton s’éteint AVANT le clic, avec sa raison', () => {
  const debut = SOURCE_DEPLOY.indexOf('export function blocageMiseEnProduction');
  assert.notEqual(debut, -1);
  const corps = SOURCE_DEPLOY.slice(debut, debut + 800);
  assert.match(corps, /refusPorteeDeLEtape\('dev'/);
});

test('l’écran dit la portée de l’étape, dans le bloc comme dans le tiroir', () => {
  assert.match(SOURCE_BLOC, /data-portee-etape/);
  assert.match(SOURCE_PANNEAU, /data-portee-procedure/);
  assert.match(SOURCE_PANNEAU, /procedureAffichee/, 'le tiroir montre le défaut, jamais du vide');
});
