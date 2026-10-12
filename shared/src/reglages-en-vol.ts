/**
 * UN RÉGLAGE QU'ON VIENT D'ENVOYER NE RECULE PAS.
 *
 * Le serveur répond à CHAQUE `prefs.set` par le bloc ENTIER des réglages, et
 * l'écran remplaçait le sien par ce bloc. Deux réglages envoyés coup sur coup
 * (le brouillon d'une conversation et ses pièces jointes, à chaque image
 * jointe) se marchaient donc dessus : la réponse au premier ne connaît pas
 * encore le second, et le DÉFAISAIT à l'écran jusqu'à la réponse suivante.
 * Dans le champ d'écriture, cela donnait deux réécritures du texte — et un
 * curseur renvoyé à la fin, « après un temps aléatoire ».
 *
 * La règle : tant que le serveur n'a pas ACCUSÉ RÉCEPTION d'un réglage envoyé
 * d'ici, c'est la valeur envoyée qui vaut pour cette clé, quel que soit le
 * bloc reçu. Le serveur diffuse le bloc AVANT d'accuser réception
 * (`server/src/ws.ts`) : tout bloc reçu avant l'accusé est soit plus vieux que
 * notre envoi, soit notre propre écho. Après l'accusé, le serveur fait foi —
 * un autre écran qui écrit la même clé est donc suivi normalement.
 *
 * Règle PURE : ni réseau, ni état. `enVol` donne, par clé, la dernière valeur
 * envoyée et pas encore confirmée.
 */
export function reglagesSansRecul(
  recus: Record<string, unknown>,
  enVol: Iterable<readonly [string, unknown]>,
): Record<string, unknown> {
  let rendu: Record<string, unknown> | null = null;
  for (const [cle, valeur] of enVol) {
    if (Object.is(recus[cle], valeur)) continue;
    rendu ??= { ...recus };
    rendu[cle] = valeur;
  }
  return rendu ?? recus;
}

/**
 * LES PIÈCES PARTIES AVEC UN MESSAGE QUITTENT SON BROUILLON — DÉCIDÉ PAR LE
 * SERVEUR, PAS SEULEMENT PAR L'ÉCRAN QUI ENVOIE.
 *
 * Les pièces jointes en attente d'une conversation vivent dans un réglage
 * (`draftAttachments.<agent>`), que le champ d'écriture vide à l'envoi. Ce
 * vidage est un réglage comme un autre : le dernier qui écrit a raison. Une
 * conversation suivie depuis deux écrans (ordinateur et téléphone, deux
 * onglets) pouvait donc retrouver dans son brouillon des pièces déjà parties
 * — on les voyait « toujours là » au-dessus du champ sous un message envoyé,
 * et elles repartaient avec le message suivant.
 *
 * Le serveur est le seul à SAVOIR qu'un message est arrivé avec ses pièces :
 * il les retire donc lui-même du brouillon en le recevant, quoi que le réglage
 * dise à cet instant. Les pièces ajoutées entre-temps depuis un autre écran,
 * et qui ne sont pas parties, restent. Le champ d'écriture, de son côté, ne
 * réécrit plus une liste qu'il a seulement lue (`composer.tsx`).
 *
 * Règle PURE : `brouillon` est la valeur brute du réglage, `parties` les
 * identifiants envoyés avec le message.
 */
export function brouillonSansLesPiecesParties(
  brouillon: unknown,
  parties: readonly string[],
): { liste: unknown[]; change: boolean } {
  if (!Array.isArray(brouillon)) return { liste: [], change: false };
  if (!parties.length) return { liste: brouillon, change: false };
  const liste = brouillon.filter(
    (piece) => !(piece && typeof piece === 'object' && parties.includes((piece as { id?: unknown }).id as string)),
  );
  return { liste, change: liste.length !== brouillon.length };
}

/**
 * UN BROUILLON VIDE N'EST PAS UN RÉGLAGE : IL SE RETIRE, IL NE SE GARDE PAS.
 *
 * Le champ d'écriture retient le texte (`draft.<agent>`) et les pièces
 * (`draftAttachments.<agent>`) de CHAQUE conversation. Vidé à l'envoi, ou
 * simplement jamais rempli, chacun restait en base à `""` / `[]` : 4 400 lignes
 * vides au 12/10/2026 (une par conversation d'agent jamais nettoyée), soit
 * 280 Ko des 384 Ko du premier message envoyé à chaque écran — et le même
 * paquet rediffusé à chaque pause de frappe. Un brouillon absent se lit déjà
 * comme vide partout (`usePref(cle, '')`, `carte-vide.ts`) : on supprime donc
 * la ligne au lieu de l'écrire.
 *
 * Règle PURE : ne vise que les deux familles de brouillon, jamais un autre
 * réglage (un `false` ou un `""` y peut être une vraie valeur).
 */
export function estUnReglageVide(cle: string, valeur: unknown): boolean {
  if (cle.startsWith('draft.')) return valeur === '';
  if (cle.startsWith('draftAttachments.')) return Array.isArray(valeur) && valeur.length === 0;
  return false;
}

/**
 * LE RÉGLAGE QUI CHANGE PART SEUL, PAS LE BLOC ENTIER.
 *
 * Chaque `prefs.set` rediffusait tous les réglages à tous les écrans. Le
 * serveur ne diffuse plus que la clé qui vient de changer (`partiel`), `null`
 * disant « cette clé n'existe plus » ; l'écran la fusionne dans son bloc. Le
 * bloc entier ne voyage plus qu'à la connexion (`ready`).
 *
 * Règle PURE : ne modifie pas `courants`.
 */
export function fusionnerLesReglages(
  courants: Record<string, unknown>,
  changements: Record<string, unknown>,
): Record<string, unknown> {
  const rendu = { ...courants };
  for (const [cle, valeur] of Object.entries(changements)) {
    if (valeur === null || valeur === undefined) delete rendu[cle];
    else rendu[cle] = valeur;
  }
  return rendu;
}
