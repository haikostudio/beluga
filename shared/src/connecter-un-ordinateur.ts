/*
 * CONNECTER CET ORDINATEUR (carte « Beluga Connect : installation simplifiée », 21/11/2026) — les règles pures du
 * parcours de Réglages › Ordinateurs : un seul bouton, un téléchargement, puis tout se coche en direct.
 *
 *  - LE SYSTÈME de l'appareil d'où l'on clique (Mac, Windows, Linux) choisit le paquet de Beluga Connect.
 *  - LA REMORQUE : Windows et Linux reçoivent l'application Go PERSONNALISÉE — l'adresse de ce Beluga et un code de
 *    liaison à usage unique sont ajoutés à la FIN du fichier servi (après l'exécutable, que Windows et Linux ignorent).
 *    Au premier lancement, l'application les lit sur son propre fichier et se relie seule : aucun code à taper, aucun
 *    clic de liaison. Le Mac garde le lien `beluga-connect://relier` (son archive signée ne se touche pas).
 *  - LA RECONNAISSANCE : l'ordinateur sur lequel on est se reconnaît par l'extension du navigateur courant (elle pose
 *    son identifiant d'appareil — jamais son secret — sur la page Beluga), sinon par le programme relié APRÈS
 *    l'émission du code du parcours.
 */
import type { Ordinateur, SystemeDOrdinateur } from './ordinateurs.js';

/** Le système de l'appareil, d'après ce que dit le navigateur ; `null` : ni Mac, ni Windows, ni Linux (téléphone…). */
export function systemeDeLAppareil(agent: { userAgent?: string; platform?: string; plateformeUA?: string | null }): SystemeDOrdinateur | null {
  const ua = agent.userAgent ?? '';
  if (/iPhone|iPad|iPod|Android/i.test(ua)) return null;
  const p = `${agent.plateformeUA ?? ''} ${agent.platform ?? ''} ${ua}`;
  if (/Win/i.test(p)) return 'windows';
  if (/Mac/i.test(p)) return 'mac';
  if (/CrOS/i.test(p)) return null;
  if (/Linux|X11/i.test(p)) return 'linux';
  return null;
}

/** La marque qui clôt la remorque (16 octets) : rien d'autre ne se lit comme une remorque. */
export const MARQUE_DE_REMORQUE = 'BELUGA-CONNECT-1';

export interface Remorque {
  base: string;
  code: string;
}

/** L'adresse d'un Beluga acceptée dans une remorque ou un lien : http(s), un hôte, rien d'autre. */
export function baseValable(brut: unknown): string | null {
  const s = String(brut ?? '').replace(/\/+$/, '');
  return /^https?:\/\/[A-Za-z0-9.:\[\]-]+$/.test(s) && s.length <= 200 ? s : null;
}

/**
 * LES OCTETS AJOUTÉS au fichier servi : le JSON de la remorque, sa longueur sur 4 octets (gros-boutiste), puis la
 * marque. L'application lit les 20 derniers octets de son fichier, vérifie la marque, puis lit le JSON.
 */
export function octetsDeRemorque(r: Remorque): Uint8Array {
  const base = baseValable(r.base);
  if (!base || !/^\d{6}$/.test(r.code)) throw new Error('remorque invalide');
  const json = new TextEncoder().encode(JSON.stringify({ base, code: r.code }));
  const marque = new TextEncoder().encode(MARQUE_DE_REMORQUE);
  const sortie = new Uint8Array(json.length + 4 + marque.length);
  sortie.set(json, 0);
  new DataView(sortie.buffer).setUint32(json.length, json.length, false);
  sortie.set(marque, json.length + 4);
  return sortie;
}

/** Relire la remorque d'un fichier (la même lecture que l'application Go) ; `null` sans remorque. */
export function lireLaRemorque(octets: Uint8Array): Remorque | null {
  const n = MARQUE_DE_REMORQUE.length;
  if (octets.length < n + 4) return null;
  if (new TextDecoder().decode(octets.subarray(octets.length - n)) !== MARQUE_DE_REMORQUE) return null;
  const longueur = new DataView(octets.buffer, octets.byteOffset).getUint32(octets.length - n - 4, false);
  if (longueur > 4096 || longueur > octets.length - n - 4) return null;
  try {
    const v = JSON.parse(new TextDecoder().decode(octets.subarray(octets.length - n - 4 - longueur, octets.length - n - 4)));
    const base = baseValable(v?.base);
    return base && /^\d{6}$/.test(String(v?.code)) ? { base, code: String(v.code) } : null;
  } catch {
    return null;
  }
}

/**
 * QUEL ORDINATEUR EST CELUI-CI ? D'abord celui qui porte le navigateur courant (identifiant posé par l'extension),
 * puis celui dont Beluga Connect s'est relié après l'émission du code du parcours (5 s de marge d'horloge).
 */
export function ordinateurReconnu(
  ordinateurs: readonly Ordinateur[],
  indices: { navigateurId?: string | null; codeEmisLe?: number | null },
): Ordinateur | null {
  if (indices.navigateurId) {
    const o = ordinateurs.find((x) => x.navigateurs.some((n) => n.id === indices.navigateurId));
    if (o) return o;
  }
  if (indices.codeEmisLe) {
    const depuis = indices.codeEmisLe - 5_000;
    const relies = ordinateurs
      .filter((o) => (o.programme?.relieLe ?? 0) >= depuis || o.navigateurs.some((n) => (n.creeLe ?? 0) >= depuis))
      .sort((a, b) => (b.programme?.relieLe ?? 0) - (a.programme?.relieLe ?? 0));
    if (relies[0]) return relies[0];
  }
  return null;
}

/*
 * « RELIER CE MAC ? » (21/11/2026) — LA LIAISON PART DE BELUGA CONNECT : l'application ouvre Beluga sur
 * `<base>/?liaison=<jeton>` (SANS écran derrière : la fenêtre des réglages la couvrirait), et la page demande « Relier « <nom> » à Beluga ? ». Le jeton n'ouvre
 * rien à lui seul : il faut la session de la personne ET son clic ; la clé de l'appareil est remise à l'application par
 * une autre voie (clé de retrait), jamais par cette adresse.
 */
export const PARAMETRE_DE_LIAISON = 'liaison';

/** Le jeton porté par l'adresse de la page, s'il a la bonne forme (base64url, 16 à 64 signes). */
export function jetonDeLiaisonDansLAdresse(recherche: string): string | null {
  const valeur = new URLSearchParams(recherche.startsWith('?') ? recherche.slice(1) : recherche).get(PARAMETRE_DE_LIAISON);
  return valeur && /^[A-Za-z0-9_-]{16,64}$/.test(valeur) ? valeur : null;
}
