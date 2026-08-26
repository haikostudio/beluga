/**
 * LE MODE SIMPLIFIÉ — une seule règle, écrite ici, appliquée partout.
 *
 * L'application montre par défaut tout ce qu'elle mesure : les jetons sous
 * chaque message, le fil des recherches de l'agent, le journal des erreurs de
 * la page, les clés d'API, les courbes de consommation. C'est précieux pour qui
 * développe, illisible pour qui veut seulement suivre son travail.
 *
 * LE MODE SIMPLIFIÉ NE RETIRE AUCUNE FONCTION : il retire des CHIFFRES et des
 * TRACES. Tout ce qu'on peut FAIRE avant de l'allumer se fait encore après —
 * écrire, lancer, arrêter, publier, régler. Ce qui disparaît n'est jamais un
 * bouton, toujours une donnée de diagnostic.
 *
 * Le réglage vit EN BASE, comme le thème et la langue (`MODE_SIMPLIFIE_CLE`
 * passée à `usePref`) : il suit l'utilisateur du téléphone à l'ordinateur, et
 * vider un cache ne le perd pas. Il s'applique SANS RECHARGER — chaque écran
 * lit la préférence pendant son rendu.
 */

/** La clé du réglage, dans les préférences enregistrées en base. */
export const MODE_SIMPLIFIE_CLE = 'modeSimplifie';

/**
 * Le repère posé sur la racine du document quand le mode est allumé. Il ne
 * commande rien à lui seul : il sert aux feuilles de style et aux contrôles
 * dans un vrai navigateur, qui ont besoin de LIRE l'état sans fouiller React.
 */
export const MODE_SIMPLIFIE_ATTRIBUT = 'data-mode-simplifie';

/**
 * Les onglets des RÉGLAGES qui ne parlent qu'aux développeurs. « Accès API »
 * distribue des clés à des programmes extérieurs : personne d'autre n'y touche.
 */
export const ONGLETS_REGLAGES_TECHNIQUES: readonly string[] = ['acces-api'];

/**
 * Les onglets d'une CARTE qui ne parlent qu'aux développeurs. « GitHub » montre
 * la branche, les enregistrements et les fichiers modifiés — la matière du
 * métier, pas le suivi du travail.
 */
export const ONGLETS_CARTE_TECHNIQUES: readonly string[] = ['github'];

/** Cet onglet doit-il disparaître quand le mode simplifié est allumé ? */
export function ongletTechnique(techniques: readonly string[], cle: string): boolean {
  return techniques.includes(cle);
}

/**
 * Les onglets qui restent visibles, dans leur ordre d'origine. Rendu tel quel
 * quand le mode est éteint : aucun écran ne change tant qu'on n'a rien allumé.
 */
export function ongletsVisibles<T extends { cle: string }>(
  onglets: readonly T[],
  techniques: readonly string[],
  simplifie: boolean,
): readonly T[] {
  if (!simplifie) return onglets;
  return onglets.filter((onglet) => !ongletTechnique(techniques, onglet.cle));
}

/**
 * Une ligne de MESSAGE qui n'apprend rien à qui ne lit pas de code : une trame
 * d'appel (`at …`), un chemin de fichier du serveur, une ligne de `npm`, un
 * numéro d'erreur système, les accents circonflexes qui soulignent une colonne.
 */
function ligneTechnique(ligne: string): boolean {
  const nu = ligne.trim();
  if (!nu) return true;
  if (/^at\s+\S/.test(nu)) return true;
  if (/^\^+$/.test(nu)) return true;
  if (/^(npm|node|yarn|pnpm)\s+(ERR|WARN|error|warn)\b/i.test(nu)) return true;
  if (/^(errno|code|syscall|stack|Require stack)\s*[:=]/i.test(nu)) return true;
  if (/^[A-Za-z_$][\w$]*(Error|Exception)\s*:\s*$/.test(nu)) return true;
  /* Un chemin absolu du serveur, une adresse `file://` ou un dossier de
     dépendances : le lecteur n'y peut rien, et il n'a pas à les voir. */
  if (/(^|\s|['"(])(\/(root|home|usr|var|tmp|opt)\/|file:\/\/)/.test(nu)) return true;
  if (/node_modules|\/dist\/|\.tsx?:\d+|\.js:\d+/.test(nu)) return true;
  return false;
}

/**
 * LE MESSAGE ALLÉGÉ. On garde ce qui se lit, on retire les traces. Rend `null`
 * quand il ne restait QUE de la technique : l'écran écrit alors sa propre
 * phrase, dans la langue de l'utilisateur — cette règle-ci ne sait pas parler
 * cinq langues, et un texte français cousu ici échapperait au dictionnaire.
 */
export function allegerMessageTechnique(texte: string | null | undefined): string | null {
  if (!texte) return null;
  const gardees = texte
    .split('\n')
    .filter((ligne) => !ligneTechnique(ligne))
    .map((ligne) => ligne.trimEnd());
  const rendu = gardees.join('\n').trim();
  return rendu ? rendu : null;
}
