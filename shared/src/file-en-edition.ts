/**
 * UNE DEMANDE EN ATTENTE QU'ON MODIFIE NE PART PAS (demande du 12/10/2026 :
 * « quand j'édite un prompt en attente, ça ne doit pas le lancer »).
 *
 * L'écran pose `enEditionDepuis` sur la demande ouverte dans la barre
 * d'écriture et le rafraîchit toutes les deux minutes ; la file s'arrête
 * DEVANT elle — les suivantes attendent aussi, l'ordre ne se croise jamais.
 * Un repère sans nouvelle depuis dix minutes ne vaut plus : un onglet fermé en
 * pleine modification ne retient pas la file pour toujours.
 */
export const EDITION_EN_FILE_PERIMEE_MS = 10 * 60_000;
/** Le rythme auquel l'écran redit qu'il modifie toujours la demande. */
export const EDITION_EN_FILE_RAFRAICHIE_MS = 2 * 60_000;

/** Cette demande est-elle retenue, parce qu'on la modifie en ce moment ? */
export function retenueParUneEdition(demande: { enEditionDepuis?: number }, maintenant: number): boolean {
  const depuis = demande.enEditionDepuis;
  if (!depuis) return false;
  return maintenant - depuis < EDITION_EN_FILE_PERIMEE_MS;
}
