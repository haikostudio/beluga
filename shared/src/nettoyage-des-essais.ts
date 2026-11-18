/**
 * LE NETTOYAGE DES ESSAIS NE TOUCHE JAMAIS UNE VRAIE CARTE.
 *
 * `scripts/nettoyer-essais.mjs` efface, dans la base SERVIE, les cartes que les
 * scripts de vérification ont laissées. Il les reconnaissait par un MOT du
 * titre (`LIKE '%témoin%'`, insensible à la casse) : le 18/11/2026 il a effacé
 * la vraie carte « Colonne repliée et témoin du serveur », son agent au travail
 * et le message que l'utilisateur avait mis en file — lancé par l'agent de
 * cette carte lui-même, en fin de travail.
 *
 * D'où deux règles, pures pour se rejouer seules
 * (`server/src/test/nettoyage-des-essais.test.ts`) :
 *
 *   1. une carte d'essai se reconnaît par le DÉBUT EXACT de son titre, sensible
 *      à la casse : les préfixes que les scripts posent eux-mêmes
 *      (`PREFIXES_DES_CARTES_D_ESSAI`). Un mot au milieu d'un titre ne suffit
 *      plus jamais ;
 *   2. même reconnue, une carte n'est PAS effacée si quelqu'un y tient encore :
 *      un agent au travail, un message en file, ou l'agent qui lance le
 *      nettoyage (`BELUGA_AGENT`). Invariant voisin : « une suppression en
 *      cascade ne touche jamais un agent au travail ».
 *
 * Un script de vérification qui crée une carte DOIT ouvrir son titre par l'un
 * de ces préfixes, sinon elle reste au tableau — c'est voulu : mieux vaut une
 * carte d'essai oubliée qu'une vraie carte perdue.
 */
export const PREFIXES_DES_CARTES_D_ESSAI = [
  'Vérification automatique',
  "Carte d'essai",
  'Carte témoin',
  'Essai témoin',
  'Essai création',
] as const;

/** Le titre a-t-il la forme exacte d'une carte posée par un script d'essai ? */
export function titreDeCarteDEssai(titre: string | null | undefined): boolean {
  const propre = (titre ?? '').trimStart();
  return PREFIXES_DES_CARTES_D_ESSAI.some((prefixe) => propre.startsWith(prefixe));
}

export interface CarteCandidateAuNettoyage {
  titre: string;
  /** Les agents de la carte, avec leur état. */
  agents: { id: string; statut: string }[];
  /** Le nombre de messages en file sur ses agents. */
  enFile: number;
}

/** Pourquoi une carte est gardée — `null` : elle peut partir. */
export function raisonDeGarderLaCarte(
  carte: CarteCandidateAuNettoyage,
  agentAppelant?: string | null,
): string | null {
  if (!titreDeCarteDEssai(carte.titre)) return 'titre hors des préfixes d’essai';
  if (agentAppelant && carte.agents.some((a) => a.id === agentAppelant)) return 'carte de l’agent qui lance le nettoyage';
  if (carte.agents.some((a) => a.statut === 'running')) return 'un agent y travaille';
  if (carte.enFile > 0) return 'un message attend en file';
  return null;
}
