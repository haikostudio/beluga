/**
 * Ce qu'on LIT à voix haute d'un message de la conversation.
 *
 * Un message peut être un simple mot comme une longue réponse d'agent, écrite
 * en Markdown. La voix (Piper) n'a que faire des étoiles de gras ou des crochets
 * de lien, et lire une réponse entière n'aurait aucun sens : on NETTOIE d'abord
 * la mise en forme, puis on RAMÈNE un texte trop long à ses premières phrases
 * complètes — jamais coupé au milieu d'un mot.
 *
 * Règle pure, sans navigateur ni serveur : elle se teste seule.
 */

import { VOIX_LONGUEUR_MAX } from './voix-annonce.js';

/**
 * Débarrasse un texte Markdown de sa mise en forme pour l'oreille : les blocs de
 * code, les liens (on garde le texte, pas l'adresse), les titres, les puces, le
 * gras et l'italique disparaissent, et les espaces sont ramenés à un seul.
 */
function nettoyerMarkdown(brut: string): string {
  if (!brut) return '';
  return brut
    .replace(/```[\s\S]*?```/g, ' ') // blocs de code entiers
    .replace(/`([^`]*)`/g, '$1') // code en ligne : on garde le texte
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ') // images : rien à dire
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // liens : le texte, pas l'adresse
    .replace(/^\s{0,3}#{1,6}\s+/gm, '') // titres
    .replace(/^\s{0,3}>\s?/gm, '') // citations
    .replace(/^\s{0,3}([-*+]|\d+[.)])\s+/gm, '') // puces et listes numérotées
    .replace(/[*_~]/g, '') // gras, italique, barré
    .replace(/\s+/g, ' ') // sauts de ligne et espaces multiples
    .trim();
}

/**
 * Le texte réellement passé à la voix. Un message qui tient sous la borne est lu
 * en entier ; au-delà, on garde le plus de PHRASES COMPLÈTES possibles (fin sur
 * un point, un point d'exclamation, d'interrogation ou de suspension). Si même la
 * première phrase dépasse, on coupe au dernier mot entier et on pose « … » pour
 * dire que la suite n'est pas lue — jamais une coupe au milieu d'un mot.
 *
 * Rend une chaîne vide quand il n'y a rien à lire : l'appelant n'affiche alors
 * aucun bouton d'écoute.
 */
export function texteAEcouter(brut: string, max: number = VOIX_LONGUEUR_MAX): string {
  const propre = nettoyerMarkdown(brut);
  if (!propre) return '';
  if (propre.length <= max) return propre;

  // La dernière fin de phrase qui tient sous la borne.
  const finDePhrase = /[.!?…]+(?=\s|$)/g;
  let coupe = -1;
  let trouve: RegExpExecArray | null;
  while ((trouve = finDePhrase.exec(propre)) !== null) {
    const fin = trouve.index + trouve[0].length;
    if (fin <= max) coupe = fin;
    else break;
  }
  if (coupe > 0) return propre.slice(0, coupe).trim();

  // Aucune phrase complète sous la borne : on s'arrête au dernier mot entier.
  const zone = propre.slice(0, max);
  const dernierEspace = zone.lastIndexOf(' ');
  const base = (dernierEspace > 0 ? zone.slice(0, dernierEspace) : zone).trim();
  return base ? `${base}…` : '';
}
