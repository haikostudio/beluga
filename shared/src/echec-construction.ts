/**
 * CE QUI A CASSÉ LA CONSTRUCTION, DIT PAR SON NOM.
 *
 * L'étape « Construction » de la publication ne gardait que les derniers signes
 * de la sortie et jetait une phrase unique — « La construction a échoué » —
 * sans dire pourquoi. Or la cause est presque toujours écrite en une ligne au
 * milieu du bruit : un fichier illisible (`EACCES: permission denied, open
 * '…/node_modules/.tmp/tsconfig.node…'`, rencontré sur haiko-compta), un outil
 * absent (`tsc: not found`), une erreur de type (`error TS2345: …`).
 *
 * Ces règles sont pures : elles ne lisent ni base ni disque, seulement le texte
 * rendu par la commande. Elles servent DEUX fois — pour dire à l'agent de
 * réparation ce qu'il doit corriger, et pour que le refus final nomme ce qui
 * bloque encore.
 */

/** Combien de causes on nomme au plus : au-delà, on compte. */
export const CAUSES_NOMMEES_MAX = 5;

/*
 * Les formes d'échec qu'on sait reconnaître, de la plus parlante à la plus
 * générale. L'ordre compte : une ligne prise par un motif précis n'est pas
 * reprise par un motif vague.
 */
const MOTIFS: RegExp[] = [
  /*
   * Système de fichiers : droits, fichier ou dossier absent, dossier occupé.
   * On part du CODE, pas du début de ligne : ce qui précède est du bruit
   * d'outil (« error during build: », un préfixe de paquet…) et ferait deux
   * causes différentes pour une seule panne.
   */
  /\b(?:EACCES|EPERM|ENOENT|EEXIST|ENOSPC|EBUSY|EROFS):[^\n]*/g,
  // Un outil que le shell ne trouve pas : « tsc: not found », « vite: command not found ».
  /^.*\b(?:command not found|not found)\s*$/gm,
  // TypeScript : « src/x.ts(12,3): error TS2345: … » ou « error TS6053: … ».
  /^.*\berror TS\d+:.*$/gm,
  // Le reste : une ligne d'erreur ordinaire d'un outil de construction.
  /^\s*(?:Error|error|ERROR|npm ERR!|FATAL|fatal error)\b.*$/gm,
];

/** Une ligne sans son bruit de bord (numéros, préfixes d'outil, espaces). */
function nettoyer(ligne: string): string {
  return ligne.replace(/\s+/g, ' ').trim();
}

/**
 * Les causes relevées dans la sortie d'une construction.
 *
 * L'ordre est celui des MOTIFS, du plus parlant au plus vague : « EACCES:
 * permission denied … » passe devant « error during build: », qui ne dit rien
 * à lui seul. Dans une même famille, l'ordre d'apparition est gardé. Une même
 * ligne n'est jamais redite : `tsc` répète volontiers la même erreur pour
 * chaque paquet de l'espace de travail, et une liste de doublons n'apprend rien.
 */
export function causesDeConstruction(sortie: string): string[] {
  const vues = new Set<string>();
  const causes: string[] = [];
  for (const motif of MOTIFS) {
    motif.lastIndex = 0;
    for (const trouve of sortie.matchAll(motif)) {
      const texte = nettoyer(trouve[0]);
      // Une ligne trop courte ne dit rien ; une ligne à rallonge est un pavé.
      if (texte.length < 8 || texte.length > 300) continue;
      if (vues.has(texte)) continue;
      vues.add(texte);
      causes.push(texte);
    }
  }
  return causes;
}

/**
 * Une phrase courte qui NOMME ce qui a cassé la construction, pour le message
 * d'échec de la publication. Rien à nommer : la phrase générique, jamais un
 * blanc — et jamais « rien n'est mis en ligne » en moins, le refus ne bouge pas.
 */
export function phraseDEchecConstruction(sortie: string): string {
  const causes = causesDeConstruction(sortie);
  if (!causes.length) return 'La construction a échoué : rien n’est mis en ligne.';
  const premiere = causes[0];
  const reste = causes.length - 1;
  const suite = reste > 0 ? `, et ${reste} autre${reste > 1 ? 's' : ''} erreur${reste > 1 ? 's' : ''}` : '';
  return `La construction a échoué : ${premiere}${suite}. Rien n’est mis en ligne.`;
}

/**
 * Le détail montré dans l'étape de publication : les causes EN TÊTE, puis la
 * fin de la sortie brute. Ce qui explique passe devant ce qui reste à fouiller.
 */
/**
 * CE QU'ON DEMANDE À L'AGENT DE SECOURS.
 *
 * Le texte vit ici, avec les règles de lecture de la sortie : il est ainsi
 * rejouable sans base ni disque, et un contrôle peut le lire sans lancer un
 * tour payant. La consigne NOMME la cause et interdit tout contournement — une
 * construction qu'on désactive pour la faire passer ne construit plus rien.
 */
export function consigneDeReparationConstruction(
  commande: string,
  sortie: string,
  passe: number,
  passesMax: number,
): string {
  const causes = causesDeConstruction(sortie);
  const liste = causes.length
    ? causes.slice(0, CAUSES_NOMMEES_MAX).map((c) => `- ${c}`).join('\n')
    : '- (aucune cause relevée dans la sortie : lis-la en entier)';
  return [
    `La publication est EN COURS et bloque (passe ${passe} sur ${passesMax}).`,
    `\`${commande}\` échoue : le projet ne se construit pas, rien ne peut être mis en ligne.`,
    '',
    'Ce qui a cassé la construction :',
    liste,
    '',
    'Fin de la sortie :',
    sortie.slice(-3000),
    '',
    'Fais exactement ceci, et rien d’autre :',
    `1. Reproduis l’échec (\`${commande}\`).`,
    '2. Répare la CAUSE sur place : droits d’un fichier, dossier temporaire à nettoyer, dépendance de construction manquante, erreur de compilation dans le code.',
    '3. Ne désactive JAMAIS la construction pour la faire passer : ne retire pas une étape du script de construction, ne mets pas une erreur en commentaire, n’ignore pas un fichier qui ne compile pas.',
    '4. Reconstruis jusqu’à ce que la commande passe en entier.',
    '5. Enregistre ton travail en nommant tes fichiers un par un (jamais `git add -A` : le dossier est partagé).',
    '',
    'Tu es sur la branche principale, dans le dossier du projet : n’en change pas, ne crée pas de branche.',
    'Ne publie pas, ne redémarre rien : la publication reprendra toute seule dès que tu auras fini. Réponds court.',
  ].join('\n');
}

export function detailDEchecConstruction(sortie: string, signesDeSortie = 800): string {
  const causes = causesDeConstruction(sortie);
  const fin = sortie.slice(-signesDeSortie);
  if (!causes.length) return fin;
  const liste = causes.slice(0, CAUSES_NOMMEES_MAX).map((c) => `- ${c}`).join('\n');
  const reste = causes.length - Math.min(causes.length, CAUSES_NOMMEES_MAX);
  const compte = reste > 0 ? `\n- … et ${reste} autre${reste > 1 ? 's' : ''}` : '';
  return `Ce qui a cassé la construction :\n${liste}${compte}\n\nFin de la sortie :\n${fin}`;
}
