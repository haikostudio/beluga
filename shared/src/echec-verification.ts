/**
 * CE QUI A ÉCHOUÉ PENDANT LES VÉRIFICATIONS, DIT PAR SON NOM.
 *
 * La publication lance les contrôles du projet et s'arrête au moindre échec —
 * c'est la règle, elle ne bouge pas. Mais elle ne gardait que les 800 DERNIERS
 * signes de la sortie : avec `node --test`, ces 800 signes sont le décompte
 * final (« # fail 1 »), jamais le nom du contrôle tombé, qui est écrit bien
 * plus haut. L'utilisateur lisait donc « les vérifications échouent » sans
 * pouvoir savoir laquelle.
 *
 * Ces règles sont pures : elles ne lisent ni base ni disque, seulement le texte
 * rendu par la commande.
 */

/** Un contrôle tombé : son nom, et l'endroit d'où il vient s'il est écrit. */
export interface ControleTombe {
  nom: string;
  /** Le fichier et la ligne, quand la sortie les donne. */
  endroit?: string;
}

/** Combien de contrôles tombés on nomme au plus : au-delà, on compte. */
export const ECHECS_NOMMES_MAX = 5;

/**
 * Les contrôles tombés, relevés dans la sortie de `node --test`.
 *
 * On ne retient que les lignes « not ok N - … » de premier niveau : les
 * sous-contrôles sont indentés, et les redire ne ferait que du bruit. Le
 * répertoire d'origine (`location: '…'`) suit sa ligne de quelques lignes : on
 * le prend s'il arrive avant le contrôle suivant.
 */
export function controlesTombes(sortie: string): ControleTombe[] {
  const tombes: ControleTombe[] = [];
  const lignes = sortie.split('\n');
  for (let i = 0; i < lignes.length; i++) {
    const echec = /^not ok \d+ - (.+?)\s*$/.exec(lignes[i]);
    if (!echec) continue;
    const nom = echec[1].trim();
    if (!nom) continue;
    let endroit: string | undefined;
    for (let j = i + 1; j < lignes.length && j < i + 12; j++) {
      if (/^not ok \d+ - /.test(lignes[j])) break;
      const lieu = /^\s*location:\s*'(.+)'\s*$/.exec(lignes[j]);
      if (lieu) {
        endroit = lieu[1];
        break;
      }
    }
    tombes.push(endroit ? { nom, endroit } : { nom });
  }
  return tombes;
}

/**
 * Une phrase courte qui NOMME ce qui est tombé, pour le message d'échec de la
 * publication. Rien à nommer : la phrase générique, jamais un blanc.
 */
export function phraseDEchec(sortie: string): string {
  const tombes = controlesTombes(sortie);
  if (!tombes.length) return 'Les vérifications échouent : rien n\'est mis en ligne.';
  const nommes = tombes.slice(0, ECHECS_NOMMES_MAX).map((c) => `« ${c.nom} »`);
  const reste = tombes.length - nommes.length;
  const suite = reste > 0 ? `, et ${reste} autre${reste > 1 ? 's' : ''}` : '';
  const tete = tombes.length > 1 ? `${tombes.length} vérifications échouent` : 'Une vérification échoue';
  return `${tete} : ${nommes.join(', ')}${suite}. Rien n'est mis en ligne.`;
}

/**
 * Le détail montré dans l'étape de publication : les contrôles tombés EN TÊTE,
 * puis la fin de la sortie brute. Ce qui explique passe devant ce qui reste à
 * fouiller — l'inverse de ce que donnait une simple coupe des derniers signes.
 */
export function detailDEchec(sortie: string, signesDeSortie = 800): string {
  const tombes = controlesTombes(sortie);
  const fin = sortie.slice(-signesDeSortie);
  if (!tombes.length) return fin;
  const liste = tombes
    .slice(0, ECHECS_NOMMES_MAX)
    .map((c) => `- ${c.nom}${c.endroit ? ` (${c.endroit})` : ''}`)
    .join('\n');
  const reste = tombes.length - Math.min(tombes.length, ECHECS_NOMMES_MAX);
  const compte = reste > 0 ? `\n- … et ${reste} autre${reste > 1 ? 's' : ''}` : '';
  return `Contrôles tombés :\n${liste}${compte}\n\nFin de la sortie :\n${fin}`;
}
