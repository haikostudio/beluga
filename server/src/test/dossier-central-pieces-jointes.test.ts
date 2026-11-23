/**
 * LE DOSSIER DES PIÈCES JOINTES NE SUIT PAS LA COPIE DE TRAVAIL D'UNE CARTE.
 *
 * Ce que ces essais verrouillent : le chemin du stockage se déduit du dépôt
 * PRINCIPAL, même quand le code tourne depuis `.worktrees/<carte>`. Sans cette
 * règle, un script de contrôle ou un outil appelé par un agent visait
 * `<copie>/data/attachments` — un dossier vide, créé au passage — et l'image
 * déposée passait pour introuvable alors qu'elle était bien sur le serveur.
 *
 * La déduction est PURE (`shared/src/racine-des-donnees.ts`) : elle lit le
 * TEXTE du marqueur `.git` d'une copie de travail, sans lancer git ni toucher
 * au disque. Le branchement, lui, vit dans `server/src/config.ts`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { depotPrincipalDepuisMarqueur } from '@beluga/shared';

test('le marqueur d’une copie de travail rend le dépôt principal', () => {
  assert.equal(
    depotPrincipalDepuisMarqueur('gitdir: /root/beluga/.git/worktrees/ma-carte\n'),
    '/root/beluga',
  );
});

test('les espaces et l’absence de fin de ligne ne gênent pas', () => {
  assert.equal(
    depotPrincipalDepuisMarqueur('   gitdir:   /root/beluga/.git/worktrees/ma-carte   '),
    '/root/beluga',
  );
});

test('une barre oblique en trop est ignorée', () => {
  assert.equal(
    depotPrincipalDepuisMarqueur('gitdir: /srv/beluga/.git/worktrees/carte-2/'),
    '/srv/beluga',
  );
});

test('un dépôt dont le nom contient « worktrees » ne trompe pas la lecture', () => {
  assert.equal(
    depotPrincipalDepuisMarqueur('gitdir: /root/worktrees/depot/.git/worktrees/carte'),
    '/root/worktrees/depot',
  );
});

test('un texte qui n’est pas un marqueur ne rend rien', () => {
  for (const texte of [
    '',
    'bonjour',
    'gitdir:',
    'gitdir: relatif/.git/worktrees/carte',
    // Un `.git` de sous-module : même préfixe, mais pas une copie de travail.
    'gitdir: /root/beluga/.git/modules/outil',
    // Trop court pour porter `.git/worktrees/<nom>`.
    'gitdir: /worktrees/carte',
  ]) {
    assert.equal(depotPrincipalDepuisMarqueur(texte), null, texte);
  }
});

test('le dossier des pièces jointes reste dans le bac à sable quand il est posé', async () => {
  // `BELUGA_DATA` a le dernier mot : sans ça, un test écrirait ses images dans
  // le stockage réel du serveur.
  const bacASable = '/tmp/bac-a-sable-pieces-jointes';
  process.env.BELUGA_DATA = bacASable;
  const { PATHS } = await import('../config.js');
  assert.equal(PATHS.attachments, `${bacASable}/attachments`);
});
