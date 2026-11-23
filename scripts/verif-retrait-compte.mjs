#!/usr/bin/env node
/**
 * RETIRER UN COMPTE, POUR DE BON — ET LES DEUX REFUS QUI LE BORNENT.
 *
 *   node scripts/verif-retrait-compte.mjs
 *
 * Un compte se coupait et se renommait, il ne DISPARAISSAIT pas : un coffre
 * devenu inutile restait dans les réglages pour toujours. Le piège, en écrivant
 * ce retrait : effacer la ligne en base NE SUFFIT PAS. `bootstrapAccounts`
 * reconstruit au démarrage tout compte dont le coffre est encore sur le disque
 * — un compte retiré revenait donc au premier redémarrage.
 *
 * Le script travaille sur une base NEUVE, dans un dossier temporaire, avec un
 * faux dossier personnel : aucun compte réel n'est touché, aucun moteur appelé.
 * Il rejoue l'amorçage APRÈS le retrait, exactement comme un redémarrage.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-retrait-'));

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

process.on('exit', () => fs.rmSync(TMP, { recursive: true, force: true }));

/* ------------------------------------------------------------------ */
/* Un dossier personnel et une base à soi                              */
/* ------------------------------------------------------------------ */

const MAISON = path.join(TMP, 'maison');
const DATA = path.join(TMP, 'data');
const COFFRE_PRINCIPAL = path.join(MAISON, '.claude');
fs.mkdirSync(COFFRE_PRINCIPAL, { recursive: true });
fs.mkdirSync(DATA, { recursive: true });
// Le coffre du compte principal EXISTE : c'est lui qui ressuscitait le compte.
fs.writeFileSync(
  path.join(COFFRE_PRINCIPAL, '.credentials.json'),
  JSON.stringify({ claudeAiOauth: { accessToken: 'faux', refreshToken: 'faux', subscriptionType: 'max' } }),
);

// Un compte de RELÈVE, déclaré par son `meta.json` — l'autre chemin de l'amorçage.
const RELEVE = path.join(DATA, 'accounts', 'claude-releve');
fs.mkdirSync(RELEVE, { recursive: true });
fs.writeFileSync(
  path.join(RELEVE, 'meta.json'),
  JSON.stringify({ engine: 'claude', label: 'Claude — relève', priority: 50 }, null, 2),
);

process.env.HOME = MAISON;
process.env.BELUGA_DATA = DATA;
process.env.BELUGA_PROJECTS_ROOT = path.join(TMP, 'projets');
delete process.env.CURSOR_API_KEY;

const comptes = await import(path.join(RACINE, 'server/dist/accounts.js'));
const { bootstrapAccounts, listAllAccountRecords, retirerCompte, comptesRetires } = comptes;

/* ------------------------------------------------------------------ */
/* 1. L'amorçage déclare les deux comptes                              */
/* ------------------------------------------------------------------ */

bootstrapAccounts();
const declares = listAllAccountRecords().map((a) => a.id);
noter(
  'l’amorçage déclare le compte principal et le compte de relève',
  declares.includes('claude-principal') && declares.includes('claude-releve'),
  declares.join(', '),
);

/* ------------------------------------------------------------------ */
/* 2. Les deux refus, avec leur raison en clair                        */
/* ------------------------------------------------------------------ */

const occupe = retirerCompte('claude-principal', { comptesOccupes: ['claude-principal'] });
noter(
  'un compte sur lequel un agent travaille n’est pas retiré',
  !occupe.ok && /agent/i.test(occupe.erreur ?? ''),
  occupe.erreur ?? 'aucun refus',
);
noter(
  '…et il est toujours là après le refus',
  listAllAccountRecords().some((a) => a.id === 'claude-principal'),
);

/* ------------------------------------------------------------------ */
/* 3. Le retrait d'un compte de relève                                 */
/* ------------------------------------------------------------------ */

const retrait = retirerCompte('claude-releve');
noter('un compte de relève se retire', retrait.ok, retrait.erreur ?? '');
noter(
  '…il quitte la liste des comptes',
  !listAllAccountRecords().some((a) => a.id === 'claude-releve'),
);
noter('…et il est noté comme retiré', comptesRetires().includes('claude-releve'));
noter(
  '…son coffre porte la marque du retrait',
  JSON.parse(fs.readFileSync(path.join(RELEVE, 'meta.json'), 'utf8')).retire === true,
);
noter(
  '…mais ses identifiants restent sur la machine',
  fs.existsSync(path.join(RELEVE, 'meta.json')),
);

/* ------------------------------------------------------------------ */
/* 4. LE POINT DÉCISIF : un redémarrage ne le ressuscite pas           */
/* ------------------------------------------------------------------ */

bootstrapAccounts();
noter(
  'un redémarrage ne ressuscite pas le compte retiré',
  !listAllAccountRecords().some((a) => a.id === 'claude-releve'),
  listAllAccountRecords().map((a) => a.id).join(', ') || 'aucun compte',
);

/* ------------------------------------------------------------------ */
/* 5. Le dernier compte actif d'un moteur ne se retire pas             */
/* ------------------------------------------------------------------ */

const dernier = retirerCompte('claude-principal');
noter(
  'le dernier compte actif d’un moteur n’est pas retiré',
  !dernier.ok && /dernier/i.test(dernier.erreur ?? ''),
  dernier.erreur ?? 'aucun refus',
);

/* ------------------------------------------------------------------ */
/* 6. Un compte inconnu se refuse sans casser                          */
/* ------------------------------------------------------------------ */

const inconnu = retirerCompte('compte-qui-n-existe-pas');
noter('un compte inconnu se refuse en le disant', !inconnu.ok && !!inconnu.erreur, inconnu.erreur ?? '');

/* ------------------------------------------------------------------ */
/* 7. Reconnecter un compte retiré le RAMÈNE                           */
/* ------------------------------------------------------------------ */

comptes.saveAccountRecord({
  id: 'claude-releve',
  engine: 'claude',
  label: 'Claude — relève revenue',
  priority: 50,
  configDir: RELEVE,
});
noter(
  'déclarer à nouveau un compte retiré le sort de la liste des retirés',
  !comptesRetires().includes('claude-releve') &&
    listAllAccountRecords().some((a) => a.id === 'claude-releve'),
);

/* ------------------------------------------------------------------ */

const reussis = resultats.filter((r) => r.ok).length;
console.log(`\n${reussis}/${resultats.length} contrôles passés.`);
process.exit(reussis === resultats.length ? 0 : 1);
