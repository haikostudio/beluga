/**
 * LA LETTRE D'UN EXEMPLE (décision du 30/10/2026, captures #9d60, #09b9, #e2a3).
 *
 * Chaque exemple fabriqué par « exemple_de_choix » porte une LETTRE simple
 * (A, B, C, D), EN PLUS de sa référence permanente « #alias ». La lettre est
 * portée PAR LA PIÈCE elle-même — son nom, « exemple-B.png » — et jamais
 * déduite de l'ordre des options : un agent qui réordonne ses choix ne doit pas
 * faire dire « B » à la question et « A » au fil.
 *
 * Les pièces nommées avant cette règle (« exemple-2.png ») gardent leur lettre
 * par leur numéro. Une image d'option qui n'est pas un exemple reçoit la
 * première lettre libre, dans l'ordre des options.
 */

/** Les lettres données aux exemples, dans l'ordre des pistes. */
export const LETTRES_D_EXEMPLE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** La lettre du rang (0 → A). */
export function lettreDuRang(rang: number): string {
  return LETTRES_D_EXEMPLE[rang] ?? String(rang + 1);
}

/** Le nom de la pièce d'un exemple : la lettre y est écrite pour de bon. */
export function nomDeLExemple(rang: number, extension: string): string {
  return `exemple-${lettreDuRang(rang)}.${extension.replace(/^\./, '')}`;
}

/** La lettre d'une pièce d'exemple d'après son nom, sinon `null`. */
export function lettreDeLExemple(nom: string | null | undefined): string | null {
  const m = /^exemple-([a-z]|\d{1,2})\.[a-z0-9]{2,5}$/i.exec(String(nom ?? '').trim());
  if (!m) return null;
  const marque = m[1]!;
  if (/^\d+$/.test(marque)) {
    const n = Number(marque);
    return n >= 1 && n <= LETTRES_D_EXEMPLE.length ? lettreDuRang(n - 1) : null;
  }
  return marque.toUpperCase();
}

/**
 * LES LETTRES DES OPTIONS À IMAGE d'une question : celle de la pièce quand elle
 * en porte une, sinon la première lettre encore libre, dans l'ordre des options.
 */
export function lettresDesOptions(
  options: readonly { id: string; image?: string | null }[],
  pieceDe: (id: string) => { name?: string | null } | undefined,
): Map<string, string> {
  const lettres = new Map<string, string>();
  const prises = new Set<string>();
  const sansLettre: string[] = [];
  for (const o of options) {
    if (!o.image) continue;
    const lettre = lettreDeLExemple(pieceDe(o.image)?.name);
    if (lettre && !prises.has(lettre)) {
      lettres.set(o.id, lettre);
      prises.add(lettre);
    } else sansLettre.push(o.id);
  }
  let rang = 0;
  for (const id of sansLettre) {
    while (prises.has(lettreDuRang(rang))) rang += 1;
    const lettre = lettreDuRang(rang);
    lettres.set(id, lettre);
    prises.add(lettre);
  }
  return lettres;
}

/** Le libellé d'un choix en image, tel qu'il part à l'agent : « B (#9d60) — Icônes vivantes ». */
export function libelleDUnChoixEnImage(label: string, lettre?: string | null, alias?: string | null): string {
  const repere = [lettre, alias ? `(#${alias.replace(/^#/, '')})` : ''].filter(Boolean).join(' ');
  return repere ? `${repere} — ${label}` : label;
}

/**
 * LES LIBELLÉS D'UNE RÉPONSE EN IMAGES, dans l'ORDRE DES TOUCHERS : pour une
 * question à plusieurs réponses, c'est l'ordre de préférence, numéroté
 * (« 1. B (#9d60) — … »). Les identifiants inconnus sont ignorés.
 */
export function libellesDUneReponseEnImages(
  options: readonly { id: string; label: string }[],
  choisis: readonly string[],
  plusieurs: boolean,
  repereDe: (id: string) => { lettre?: string | null; alias?: string | null } | undefined,
): string[] {
  const libelles = choisis
    .map((id) => {
      const o = options.find((x) => x.id === id);
      if (!o) return null;
      const r = repereDe(id);
      return libelleDUnChoixEnImage(o.label, r?.lettre, r?.alias);
    })
    .filter((l): l is string => !!l);
  return plusieurs && libelles.length > 1 ? libelles.map((l, i) => `${i + 1}. ${l}`) : libelles;
}

/**
 * La lettre lue dans la phrase d'un média livré (« B — Icônes vivantes ») :
 * le repli d'un exemple venu du service externe, dont la pièce garde le nom
 * que ce service lui a donné.
 */
export function lettreDeLaLegende(legende: string | null | undefined): string | null {
  const m = /^([A-Z]) — \S/.exec(String(legende ?? '').trim());
  return m ? m[1]! : null;
}
