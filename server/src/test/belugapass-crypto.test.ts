import test from 'node:test';
import assert from 'node:assert/strict';
import * as bp from '../belugapass-crypto.js';

/*
 * LE CHIFFREMENT DE BELUGA PASS REFAIT CÔTÉ BELUGA BUILD (carte « Audits passés et synchro Beluga Pass »,
 * 15/11/2026). Les VECTEURS ci-dessous ont été produits par bp-core lui-même (le module WebAssembly de Beluga Pass :
 * generate_keypair, random_key, seal, encrypt_json) : les ouvrir ici prouve que les deux côtés parlent la même langue
 * — boîte scellée X25519 + HKDF « BP1-seal », XChaCha20-Poly1305, id en donnée associée, base64url sans bourrage.
 * Aucune de ces valeurs n'est un vrai secret : la paire et la fiche sont fabriquées pour l'essai.
 */
const V = {
 "agent_private": "i5lYOiBZH_3im8HaJjisxHy4M4UqfFhk1lpvIUh-e4A",
 "agent_public": "Y-Q39zM4z346fn1j-Mvo7LgOZFF9nSWW6GHf2vEp4Bc",
 "vault_id": "7d0c1a3e-5b2f-4c8e-9a71-2f6b9d0e4c11",
 "item_id": "c3a9e2f1-0b4d-4e6a-8f12-9d7c5b3a1e00",
 "vault_key": "s8QgWliMuU__ruK68RsHED_8jadoEoIiV_FgA8pIdHI",
 "key_sealed": "OSFLIvatq5KD6d3VK72Hk4FKJOJU3GuF0_OB7uG8zwMBBuN0Dzvqq2ylf2lF2ebf6-cUXfQeAEcT9P5xV4KTDw5hNQP1f0xPklZIz2HtHQxqvBm-PyTdD6wtk_m4HnUq9GgOW1pWhauZ",
 "meta_enc": "AaiTOYVMhToqQKSjGkoGwwh5qtCU0FoYsT6XLkXOb8AsUMNxONiGAuUCePDBo80ru09sXCY0va1W3AuPe_3N85gLm5vpCWdFZ83FCYlrfFG0qXyEwD6jpg",
 "data_enc": "AZKLU-86OToSPMii7oXfb-oQ3_MKy5GaSOVlNo9NCCr8phRQgVnyUUCpe7sYTbpFbj6W3nNMgJYuad0-HxFAA6ITjoaz2AzT0IiFAOsDJH2ZOQZyL_d7o85NhYtYLQ-lq5eFefRmURMJTTHdxbs1u9YaIvqP4TcosGxY6YrzKlAKaTuBg4Stj3WzjnNuRWXcBSQ7vxa4Hc7R70xv5O_1xflUJYrGPCHQWj-MViEHdpML8OQJBTexJ00"
};

test('HChaCha20 rend le vecteur du standard (draft-irtf-cfrg-xchacha, §2.2.1)', () => {
  const cle = Buffer.from('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f', 'hex');
  const nonce = Buffer.from('000000090000004a0000000031415927', 'hex');
  assert.equal(bp.hchacha20(cle, nonce).toString('hex'), '82413b4227b27bfed30e42508a877d73a0f9e4d58a74a853c12ec41326d3ecdc');
});

test('la clé publique se retrouve depuis la clé privée produite par bp-core', () => {
  assert.equal(bp.publiqueDeLaPrivee(V.agent_private), V.agent_public);
});

test('la boîte scellée de bp-core s’ouvre, et le coffre puis la fiche se déchiffrent', () => {
  const cle = bp.ouvrirBoite(V.agent_private, V.key_sealed);
  assert.equal(bp.b64(cle), V.vault_key);
  assert.deepEqual(bp.ouvrirJson(cle, V.vault_id, V.meta_enc), { name: 'Essai', icon: 'folder', color: 'gris' });
  const fiche = bp.ouvrirJson<{ title: string; fields: Record<string, string> }>(cle, V.item_id, V.data_enc);
  assert.equal(fiche.title, 'Site d’essai');
  assert.equal(fiche.fields.username, 'essai@exemple.ch');
});

test('une mauvaise donnée associée, une autre clé ou un bloc abîmé sont refusés', () => {
  const cle = bp.ouvrirBoite(V.agent_private, V.key_sealed);
  assert.throws(() => bp.ouvrirJson(cle, V.vault_id, V.data_enc), 'un bloc ne se déplace pas d’une fiche à un coffre');
  const autre = bp.nouvellePaire();
  assert.throws(() => bp.ouvrirBoite(autre.privee, V.key_sealed));
  const abime = bp.unb64(V.meta_enc);
  abime[abime.length - 1] ^= 1;
  assert.throws(() => bp.ouvrirJson(cle, V.vault_id, bp.b64(abime)));
});

test('ce que Beluga Build scelle et chiffre s’ouvre à l’identique (aller-retour)', () => {
  const paire = bp.nouvellePaire();
  assert.equal(bp.publiqueDeLaPrivee(paire.privee), paire.publique);
  const cle = Buffer.alloc(32, 7);
  assert.deepEqual(bp.ouvrirBoite(paire.privee, bp.sceller(paire.publique, cle)), cle);
  assert.deepEqual(bp.ouvrirJson(cle, 'x', bp.scellerJson(cle, 'x', { a: 1 })), { a: 1 });
});
