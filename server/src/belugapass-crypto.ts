/**
 * LE CHIFFREMENT DE BELUGA PASS, côté Beluga Build — la stricte réplique de `bp-core` (`crates/core/src/crypto.rs`),
 * vérifiée par des vecteurs produits par bp-core lui-même (`server/src/test/belugapass-crypto.test.ts`) :
 *
 *  - base64 « url-safe » SANS bourrage (`URL_SAFE_NO_PAD`) ;
 *  - bloc symétrique : `version(1) || nonce(24) || chiffré + étiquette(16)`, XChaCha20-Poly1305, donnée associée =
 *    l'identifiant (du coffre pour `meta_enc`, de la fiche pour `data_enc`) ;
 *  - boîte scellée : `clé publique éphémère(32) || bloc`, clé = HKDF-SHA256(secret X25519, sel = éph || destinataire,
 *    info « BP1-seal »), donnée associée = la clé éphémère.
 *
 * Node a X25519, HKDF et ChaCha20-Poly1305, pas la variante « X » (nonce de 24 octets) : elle se refait ici par la
 * dérivation HChaCha20 du standard (sous-clé = HChaCha20(clé, nonce[0..16]), puis ChaCha20-Poly1305 avec le nonce
 * `0000 || nonce[16..24]`). Rien de ce module n'écrit ni ne journalise un contenu.
 */
import crypto from 'node:crypto';

const FORMAT_V1 = 1;
const NONCE = 24;
const ETIQUETTE = 16;

export function b64(octets: Uint8Array): string {
  return Buffer.from(octets).toString('base64url');
}

export function unb64(texte: string): Buffer {
  const propre = texte.trim().replace(/=+$/, '');
  if (!/^[A-Za-z0-9_-]*$/.test(propre)) throw new Error('format');
  return Buffer.from(propre, 'base64url');
}

/* ------------------------------------------------------------------ */
/* HChaCha20 et XChaCha20-Poly1305                                     */
/* ------------------------------------------------------------------ */

function rotl(v: number, n: number): number {
  return ((v << n) | (v >>> (32 - n))) >>> 0;
}

function quartDeTour(s: Uint32Array, a: number, b: number, c: number, d: number): void {
  s[a] = (s[a]! + s[b]!) >>> 0; s[d] = rotl(s[d]! ^ s[a]!, 16);
  s[c] = (s[c]! + s[d]!) >>> 0; s[b] = rotl(s[b]! ^ s[c]!, 12);
  s[a] = (s[a]! + s[b]!) >>> 0; s[d] = rotl(s[d]! ^ s[a]!, 8);
  s[c] = (s[c]! + s[d]!) >>> 0; s[b] = rotl(s[b]! ^ s[c]!, 7);
}

/** HChaCha20 (draft-irtf-cfrg-xchacha) : une sous-clé de 32 octets tirée de la clé et des 16 premiers octets du nonce. */
export function hchacha20(cle: Uint8Array, nonce16: Uint8Array): Buffer {
  if (cle.length !== 32 || nonce16.length !== 16) throw new Error('format');
  const s = new Uint32Array(16);
  s[0] = 0x61707865; s[1] = 0x3320646e; s[2] = 0x79622d32; s[3] = 0x6b206574;
  const k = Buffer.from(cle);
  const n = Buffer.from(nonce16);
  for (let i = 0; i < 8; i++) s[4 + i] = k.readUInt32LE(i * 4);
  for (let i = 0; i < 4; i++) s[12 + i] = n.readUInt32LE(i * 4);
  for (let i = 0; i < 10; i++) {
    quartDeTour(s, 0, 4, 8, 12); quartDeTour(s, 1, 5, 9, 13); quartDeTour(s, 2, 6, 10, 14); quartDeTour(s, 3, 7, 11, 15);
    quartDeTour(s, 0, 5, 10, 15); quartDeTour(s, 1, 6, 11, 12); quartDeTour(s, 2, 7, 8, 13); quartDeTour(s, 3, 4, 9, 14);
  }
  const sortie = Buffer.alloc(32);
  [0, 1, 2, 3, 12, 13, 14, 15].forEach((idx, i) => sortie.writeUInt32LE(s[idx]!, i * 4));
  return sortie;
}

function sousCleEtNonce(cle: Uint8Array, nonce24: Uint8Array): { cle: Buffer; nonce: Buffer } {
  const nonce = Buffer.alloc(12);
  Buffer.from(nonce24.subarray(16, 24)).copy(nonce, 4);
  return { cle: hchacha20(cle, nonce24.subarray(0, 16)), nonce };
}

/** Chiffre comme `bp_core::crypto::encrypt` : `version || nonce || chiffré + étiquette`. */
export function chiffrer(cle: Uint8Array, clair: Uint8Array, aad: Uint8Array, nonce24 = crypto.randomBytes(NONCE)): Buffer {
  const { cle: k, nonce } = sousCleEtNonce(cle, nonce24);
  const c = crypto.createCipheriv('chacha20-poly1305', k, nonce, { authTagLength: ETIQUETTE });
  c.setAAD(Buffer.from(aad), { plaintextLength: clair.length });
  const corps = Buffer.concat([c.update(Buffer.from(clair)), c.final()]);
  return Buffer.concat([Buffer.from([FORMAT_V1]), Buffer.from(nonce24), corps, c.getAuthTag()]);
}

/** Déchiffre comme `bp_core::crypto::decrypt` ; lève une erreur sur un bloc abîmé, une mauvaise clé ou un mauvais id. */
export function dechiffrer(cle: Uint8Array, bloc: Uint8Array, aad: Uint8Array): Buffer {
  if (cle.length !== 32) throw new Error('clé');
  if (bloc.length < 1 + NONCE + ETIQUETTE || bloc[0] !== FORMAT_V1) throw new Error('format');
  const nonce24 = bloc.subarray(1, 1 + NONCE);
  const chiffre = bloc.subarray(1 + NONCE, bloc.length - ETIQUETTE);
  const etiquette = bloc.subarray(bloc.length - ETIQUETTE);
  const { cle: k, nonce } = sousCleEtNonce(cle, nonce24);
  const d = crypto.createDecipheriv('chacha20-poly1305', k, nonce, { authTagLength: ETIQUETTE });
  d.setAAD(Buffer.from(aad), { plaintextLength: chiffre.length });
  d.setAuthTag(Buffer.from(etiquette));
  return Buffer.concat([d.update(Buffer.from(chiffre)), d.final()]);
}

/** `bp_core::crypto::open_json` : un JSON chiffré par la clé d'un coffre, l'id en donnée associée. */
export function ouvrirJson<T = unknown>(cleDuCoffre: Uint8Array, id: string, donnee: string): T {
  return JSON.parse(dechiffrer(cleDuCoffre, unb64(donnee), Buffer.from(id, 'utf8')).toString('utf8')) as T;
}

export function scellerJson(cleDuCoffre: Uint8Array, id: string, valeur: unknown): string {
  return b64(chiffrer(cleDuCoffre, Buffer.from(JSON.stringify(valeur), 'utf8'), Buffer.from(id, 'utf8')));
}

/* ------------------------------------------------------------------ */
/* X25519 et boîte scellée                                             */
/* ------------------------------------------------------------------ */

const PREFIXE_PKCS8_X25519 = Buffer.from('302e020100300506032b656e04220420', 'hex');
const PREFIXE_SPKI_X25519 = Buffer.from('302a300506032b656e032100', 'hex');

function clePrivee(brute: Uint8Array): crypto.KeyObject {
  if (brute.length !== 32) throw new Error('clé privée');
  return crypto.createPrivateKey({ key: Buffer.concat([PREFIXE_PKCS8_X25519, Buffer.from(brute)]), format: 'der', type: 'pkcs8' });
}

function clePublique(brute: Uint8Array): crypto.KeyObject {
  if (brute.length !== 32) throw new Error('clé publique');
  return crypto.createPublicKey({ key: Buffer.concat([PREFIXE_SPKI_X25519, Buffer.from(brute)]), format: 'der', type: 'spki' });
}

function publiqueBrute(cle: crypto.KeyObject): Buffer {
  return Buffer.from((cle.export({ format: 'der', type: 'spki' }) as Buffer).subarray(PREFIXE_SPKI_X25519.length));
}

/** Une paire X25519 neuve, en base64url : `{ privee, publique }`. */
export function nouvellePaire(): { privee: string; publique: string } {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('x25519');
  const privee = (privateKey.export({ format: 'der', type: 'pkcs8' }) as Buffer).subarray(PREFIXE_PKCS8_X25519.length);
  return { privee: b64(privee), publique: b64(publiqueBrute(publicKey)) };
}

/** La clé publique d'une clé privée X25519 (base64url). */
export function publiqueDeLaPrivee(privee: string): string {
  return b64(publiqueBrute(crypto.createPublicKey(clePrivee(unb64(privee)))));
}

function secretPartage(privee: crypto.KeyObject, publique: crypto.KeyObject): Buffer {
  const s = crypto.diffieHellman({ privateKey: privee, publicKey: publique });
  // `was_contributory` de bp-core : un secret tout à zéro (clé publique piégée) est refusé.
  if (s.every((o) => o === 0)) throw new Error('clé publique');
  return s;
}

function cleDeBoite(secret: Buffer, eph: Uint8Array, destinataire: Uint8Array): Buffer {
  return Buffer.from(crypto.hkdfSync('sha256', secret, Buffer.concat([Buffer.from(eph), Buffer.from(destinataire)]), 'BP1-seal', 32));
}

/** `bp_core::crypto::open` : ouvre une boîte scellée pour la clé privée donnée (base64url), rend les octets. */
export function ouvrirBoite(privee: string, scelle: string): Buffer {
  const boite = unb64(scelle);
  if (boite.length < 32 + 1 + NONCE + ETIQUETTE) throw new Error('format');
  const prive = clePrivee(unb64(privee));
  const propre = publiqueBrute(crypto.createPublicKey(prive));
  const eph = boite.subarray(0, 32);
  const cle = cleDeBoite(secretPartage(prive, clePublique(eph)), eph, propre);
  return dechiffrer(cle, boite.subarray(32), eph);
}

/** `bp_core::crypto::seal` : scelle des octets pour une clé publique (base64url). Sert aux essais. */
export function sceller(publique: string, clair: Uint8Array): string {
  const dest = unb64(publique);
  const { privateKey, publicKey } = crypto.generateKeyPairSync('x25519');
  const eph = publiqueBrute(publicKey);
  const cle = cleDeBoite(secretPartage(privateKey, clePublique(dest)), eph, dest);
  return b64(Buffer.concat([eph, chiffrer(cle, clair, eph)]));
}
