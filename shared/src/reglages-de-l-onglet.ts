/**
 * CHAQUE ONGLET GARDE SA PAGE (décision de l'utilisateur du 12/11/2026, carte « Communication et Studio : série de
 * retouches ») : changer de page, de projet, de carte ou de réglage d'affichage dans un onglet de Beluga ne bouge
 * plus les autres onglets ouverts. Seuls le THÈME et la LANGUE restent communs en direct — et le CONTENU qu'on écrit
 * (brouillon d'une conversation, ses pièces jointes en attente), qui suit l'agent et non l'écran.
 *
 * Les réglages restent écrits EN BASE : un onglet NEUF (ou un autre appareil) repart du dernier état connu. Mais un
 * onglet DÉJÀ OUVERT ignore ce qu'un AUTRE onglet change, sauf ces clés vivantes. Un changement posé par le SERVEUR
 * lui-même (un agent qui pilote la colonne de gauche, un ménage) s'applique partout : seul le geste d'un autre onglet
 * est filtré.
 */

export const CLES_VIVANTES_ENTRE_ONGLETS = ['theme', 'langue'] as const;
/** Le contenu écrit, qui suit l'agent : le brouillon et ses pièces jointes en attente. */
export const PREFIXES_VIVANTS_ENTRE_ONGLETS = ['draft.', 'draftAttachments.'] as const;

/** Ce réglage, changé dans un autre onglet, doit-il suivre ici ? */
export function reglageSuitLesAutresOnglets(cle: string): boolean {
  return (CLES_VIVANTES_ENTRE_ONGLETS as readonly string[]).includes(cle) || PREFIXES_VIVANTS_ENTRE_ONGLETS.some((p) => cle.startsWith(p));
}

/**
 * LES RÉGLAGES REÇUS, VUS PAR CET ONGLET.
 *  - `deLOnglet` : l'onglet qui a fait le changement (absent : le serveur lui-même, ou un écran d'avant) ;
 *  - `cetOnglet` : l'identifiant de l'onglet qui reçoit.
 * Un changement venu d'un AUTRE onglet ne garde que ses clés vivantes ; le reste est rendu tel quel.
 */
export function reglagesPourCetOnglet(
  recus: Readonly<Record<string, unknown>>,
  deLOnglet: string | null | undefined,
  cetOnglet: string,
): Record<string, unknown> {
  if (!deLOnglet || deLOnglet === cetOnglet) return { ...recus };
  const gardes: Record<string, unknown> = {};
  for (const [cle, valeur] of Object.entries(recus)) if (reglageSuitLesAutresOnglets(cle)) gardes[cle] = valeur;
  return gardes;
}

/**
 * LE BLOC ENTIER D'UNE RECONNEXION (`ready` après une coupure ou une veille) : pendant l'absence, d'autres onglets ont
 * pu changer leur page. Cet onglet garde donc SES réglages d'affichage connus ; le reste (clés vivantes, clés qu'il
 * n'avait pas encore) vient du serveur. À la PREMIÈRE connexion, tout vient du serveur.
 */
export function reglagesALaReconnexion(
  actuels: Readonly<Record<string, unknown>>,
  recus: Readonly<Record<string, unknown>>,
  reprise: boolean,
): Record<string, unknown> {
  if (!reprise) return { ...recus };
  const rendu: Record<string, unknown> = { ...recus };
  for (const [cle, valeur] of Object.entries(actuels)) {
    if (reglageSuitLesAutresOnglets(cle)) continue;
    rendu[cle] = valeur;
  }
  return rendu;
}
