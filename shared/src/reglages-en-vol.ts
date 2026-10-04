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
