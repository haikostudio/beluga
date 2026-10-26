/**
 * LE NAVIGATEUR DU SERVEUR, UN SEUL À LA FOIS (machine de 7 Go) — un jeton que
 * chaque service prend avant d'ouvrir un Chrome et rend ensuite (la relève des
 * annonces, `leads.ts`). Sorti du Studio, dont la vérification anti-robot des
 * sources de styles a été retirée avec lui (26/10/2026).
 */
let tenuPar: string | null = null;

/** Prendre le navigateur. Faux s'il est déjà pris : on attend sa place, on n'en ouvre pas un second. */
export function prendreLeNavigateur(qui: string): boolean {
  if (tenuPar === qui) return true;
  if (tenuPar) return false;
  tenuPar = qui;
  return true;
}

export function rendreLeNavigateur(qui: string): void {
  if (tenuPar === qui) tenuPar = null;
}
