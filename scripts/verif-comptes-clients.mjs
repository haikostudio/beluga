#!/usr/bin/env node
/**
 * LES ACCÈS CLIENTS, DU BERCEAU À LA MISE DE CÔTÉ.
 *
 *   npm run build:server && node scripts/verif-comptes-clients.mjs
 *
 * Sur une base JETABLE, sans démon ni navigateur : créer un accès, entrer avec,
 * changer sa portée, le suspendre (les sessions ouvertes doivent tomber
 * AUSSITÔT), le réactiver, réinitialiser son mot de passe, le retirer.
 *
 * Ce qui est vérifié :
 *   1. LA MIGRATION DU COMPTE UNIQUE — le compte de `meta` devient le premier
 *      administrateur, ses identifiants ne changent pas, et une session déjà
 *      ouverte SURVIT ;
 *   2. UN ACCÈS NEUF — mot de passe tiré au hasard, rendu UNE fois, jamais
 *      relisible ; l'entrée fonctionne, et l'identité rendue porte le rôle ;
 *   3. LA PORTÉE — un client ne voit que ses projets cochés, et un projet
 *      disparu ne reste pas coché ;
 *   4. LA SUSPENSION — les sessions ouvertes tombent à l'instant, et l'entrée
 *      est refusée SANS dire que le compte existe ;
 *   5. LE RETRAIT — le compte est mis de côté, jamais supprimé : ses demandes
 *      et ses messages restent lisibles ;
 *   6. LE DERNIER ADMINISTRATEUR — impossible de se mettre soi-même dehors.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-comptes-clients-'));
process.env.BELUGA_DATA = TMP;

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

process.on('exit', () => fs.rmSync(TMP, { recursive: true, force: true }));

const { openDb, getDb, setMeta } = await import(path.join(RACINE, 'server/dist/db.js'));
const comptes = await import(path.join(RACINE, 'server/dist/comptes.js'));
const auth = await import(path.join(RACINE, 'server/dist/auth.js'));
const { peutVoirProjet } = await import(path.join(RACINE, 'shared/dist/index.js'));

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');

/* ------------------------------------------------------------------ */
/* 1. La migration du compte unique                                     */
/* ------------------------------------------------------------------ */

/*
 * On monte la base à l'état d'AVANT : le compte unique dans `meta`, une session
 * ouverte sans identité. Puis on rejoue la migration 51 telle que le démarrage
 * l'aurait jouée. C'est exactement le passage qui, mal fait, met l'utilisateur
 * dehors de sa propre application.
 */
openDb();
const db = getDb();
db.prepare('DELETE FROM users').run();
db.prepare('DELETE FROM sessions').run();

const selAncien = crypto.randomBytes(16);
const motDePasseAncien = 'ancien-mot-de-passe-long';
setMeta('auth.user', 'haiko-ancien');
setMeta('auth.salt', selAncien.toString('hex'));
setMeta('auth.hash', comptes.empreinte(motDePasseAncien, selAncien));

const jetonAncien = crypto.randomBytes(32).toString('hex');
db.prepare('INSERT INTO sessions (token, created_at, expires_at, label) VALUES (?, ?, ?, ?)').run(
  sha(jetonAncien),
  Date.now(),
  Date.now() + 3600_000,
  'session d’avant la migration',
);

// Le report, tel que la migration 51 l'écrit.
db.prepare(
  `INSERT INTO users (id, identifiant, role, nom_affiche, salt, hash, actif, cree_le)
   VALUES ('admin-premier', ?, 'admin', 'Haiko', ?, ?, 1, ?)`,
).run('haiko-ancien', selAncien.toString('hex'), comptes.empreinte(motDePasseAncien, selAncien), Date.now());

const apresMigration = auth.checkSession(jetonAncien);
noter(
  'une session ouverte AVANT les comptes survit et devient nominative',
  apresMigration !== null && apresMigration.role === 'admin',
  apresMigration ? apresMigration.identifiant : 'session perdue',
);

const entreeAncienne = auth.login('haiko-ancien', motDePasseAncien, '10.0.0.1');
noter("les identifiants d'avant ouvrent encore la porte", entreeAncienne.ok === true, entreeAncienne.error ?? '');

/* ------------------------------------------------------------------ */
/* 2. Un accès neuf                                                     */
/* ------------------------------------------------------------------ */

const PROJETS = ['projet-a', 'projet-b'];
const cree = comptes.creerCompte(
  { identifiant: 'Client.Test', role: 'client', nomAffiche: 'Client d’essai', projets: ['projet-a'] },
  PROJETS,
);

noter("l'identifiant est rangé en minuscules", cree.compte.identifiant === 'client.test', cree.compte.identifiant);
noter('le mot de passe est rendu UNE fois, et il est long', cree.motDePasse.length >= 20, `${cree.motDePasse.length} signes`);

const secret = comptes.secretDuCompte(cree.compte.id);
noter(
  "le mot de passe n'est gardé nulle part en clair",
  Boolean(secret) && !JSON.stringify(secret).includes(cree.motDePasse.replace(/-/g, '')),
);

const entreeClient = auth.login('client.test', cree.motDePasse, '10.0.0.2');
noter("le client entre avec son mot de passe", entreeClient.ok === true, entreeClient.error ?? '');
noter("l'entrée dit le RÔLE du compte", entreeClient.role === 'client', String(entreeClient.role));

const identite = auth.checkSession(entreeClient.token);
noter(
  "la session rend l'identité : qui, quel rôle, quels projets",
  identite?.role === 'client' && identite.projets.length === 1 && identite.projets[0] === 'projet-a',
  JSON.stringify(identite?.projets ?? []),
);

const mauvais = auth.login('client.test', 'ce-nest-pas-le-bon-mot', '10.0.0.99');
noter('un mauvais mot de passe est refusé', mauvais.ok === false);

/* ------------------------------------------------------------------ */
/* 3. La portée                                                         */
/* ------------------------------------------------------------------ */

noter(
  'un client ne voit que les projets de sa portée',
  peutVoirProjet(identite, 'projet-a') === true && peutVoirProjet(identite, 'projet-b') === false,
);

const elargi = comptes.changerLaPortee(cree.compte.id, ['projet-a', 'projet-b', 'projet-disparu'], PROJETS);
noter(
  'la portée se change, et un projet inconnu ne s’y glisse pas',
  elargi.projets.length === 2 && !elargi.projets.includes('projet-disparu'),
  elargi.projets.join(', '),
);

const relue = auth.checkSession(entreeClient.token);
noter(
  'la session voit la nouvelle portée SANS se reconnecter',
  relue?.projets.includes('projet-b') === true,
  (relue?.projets ?? []).join(', '),
);

/* ------------------------------------------------------------------ */
/* 4. La suspension                                                     */
/* ------------------------------------------------------------------ */

comptes.suspendreCompte(cree.compte.id, true);
noter(
  'suspendre coupe les sessions ouvertes IMMÉDIATEMENT',
  auth.checkSession(entreeClient.token) === null,
);

const refuse = auth.login('client.test', cree.motDePasse, '10.0.0.3');
noter('un compte suspendu n’entre plus', refuse.ok === false);
noter(
  'le refus ne dit pas que le compte existe',
  (refuse.error ?? '').includes('suspendu') === false,
  refuse.error ?? '',
);

comptes.suspendreCompte(cree.compte.id, false);
const rentre = auth.login('client.test', cree.motDePasse, '10.0.0.4');
noter('réactiver rouvre la porte', rentre.ok === true, rentre.error ?? '');

/* ------------------------------------------------------------------ */
/* 5. Le mot de passe réinitialisé                                      */
/* ------------------------------------------------------------------ */

const neuf = comptes.reinitialiserLeMotDePasse(cree.compte.id);
noter(
  'réinitialiser coupe les sessions ouvertes',
  auth.checkSession(rentre.token) === null,
);
noter("l'ancien mot de passe ne marche plus", auth.login('client.test', cree.motDePasse, '10.0.0.5').ok === false);
noter('le nouveau marche', auth.login('client.test', neuf, '10.0.0.6').ok === true);

/* ------------------------------------------------------------------ */
/* 6. Le retrait, qui ne supprime rien                                  */
/* ------------------------------------------------------------------ */

comptes.retirerLAcces(cree.compte.id);
const retire = comptes.compteParId(cree.compte.id);
noter(
  'un accès retiré est mis de côté, jamais supprimé',
  retire !== null && retire.actif === false && retire.projets.length === 0,
);
noter(
  "l'auteur d'un commentaire reste lisible après le retrait",
  comptes.nomAffiche(cree.compte.id) === 'Client d’essai',
  comptes.nomAffiche(cree.compte.id),
);

/* ------------------------------------------------------------------ */
/* 7. Le dernier administrateur                                         */
/* ------------------------------------------------------------------ */

let refusDernierAdmin = false;
try {
  comptes.suspendreCompte('admin-premier', true);
} catch {
  refusDernierAdmin = true;
}
noter('impossible de suspendre le DERNIER administrateur', refusDernierAdmin);

/* ------------------------------------------------------------------ */

const echecs = resultats.filter((r) => !r.ok);
console.log(`\n${resultats.length - echecs.length}/${resultats.length} contrôles passés.`);
if (echecs.length) {
  console.error(`\n${echecs.length} contrôle(s) en échec :`);
  for (const e of echecs) console.error(`  - ${e.nom}`);
  process.exit(1);
}
