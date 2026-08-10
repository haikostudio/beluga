/**
 * LE DOSSIER OÙ LE CHEF D'ORCHESTRE ÉCRIT.
 *
 * Le chef n'a qu'un seul geste d'écriture dans le projet : l'outil
 * `write_document`. Jusqu'ici il pouvait poser un `.md` N'IMPORTE OÙ — y compris
 * par-dessus `docs/regles/cartes.md`, c'est-à-dire par-dessus les règles du
 * moteur. Ce module referme cette porte et n'en laisse qu'une : un DOSSIER DE
 * PLANS, `docs/plans/`, où vivent ses documents et ses plans.
 *
 * Trois raisons de ranger là plutôt qu'ailleurs :
 *
 *  1. LE CHEF NE GAGNE RIEN SUR LE CODE — c'est la limite de la règle : ses
 *     documents deviennent écrivables, le reste du projet ne bouge pas d'un
 *     cheveu (le bac à sable garde le projet en lecture seule, `bridage-chef.ts`).
 *  2. CE QU'IL ÉCRIT SERT PLUS TARD — le dossier est INDEXÉ par la recherche de
 *     passages (`server/src/passages.ts`) : un plan écrit aujourd'hui remonte
 *     tout seul au lancement de la carte qui le réalise, sans que personne ne le
 *     recopie.
 *  3. UN SEUL ENDROIT SE RELIT — pour modifier un plan, encore faut-il le
 *     retrouver. Un dossier nommé vaut mieux qu'une convention de nommage.
 *
 * Rien ici ne touche à la base ni au disque : la règle se lit et se rejoue seule.
 */

/** Le dossier des documents et des plans du chef, relatif à la racine du projet. */
export const DOSSIER_PLANS = 'docs/plans';

/** Ce qu'on accepte d'écrire par cet outil : du texte, jamais du code. */
export const EXTENSIONS_DOCUMENT = ['.md', '.txt'];

/** L'extension posée d'office quand la demande n'en porte aucune. */
export const EXTENSION_DOCUMENT_PAR_DEFAUT = '.md';

/** Ce que rend l'examen d'un chemin demandé. */
export type CheminDeDocument =
  | { ok: true; chemin: string }
  | { ok: false; raison: string };

/**
 * Un nom de fichier lisible et sans piège : minuscules, sans accent, les espaces
 * et la ponctuation ramenés au tiret. « Plan : refonte de l'accueil » devient
 * « plan-refonte-de-l-accueil ». Un nom vide rend une chaîne vide — c'est
 * l'appelant qui décide quoi en faire.
 */
export function nomDeFichierPropre(brut: string): string {
  return brut
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 80);
}

/**
 * LE CHEMIN D'UN DOCUMENT DU CHEF, tel qu'on l'écrira vraiment.
 *
 * On accepte les trois façons de le demander — « refonte », « refonte.md »,
 * « docs/plans/refonte.md » — et on rend toujours le même chemin rangé. Tout ce
 * qui vise ailleurs est REFUSÉ, avec une phrase qui nomme le dossier permis :
 * un refus muet se lit comme une panne.
 */
export function cheminDuDocumentDuChef(demande: string): CheminDeDocument {
  const brut = String(demande ?? '').trim().replace(/\\/g, '/');
  if (!brut) return { ok: false, raison: 'Le chemin du document est vide.' };
  if (brut.startsWith('/')) {
    return { ok: false, raison: `Chemin refusé : un document du chef s'écrit dans « ${DOSSIER_PLANS}/ », jamais ailleurs.` };
  }

  // On enlève le dossier s'il est déjà là, puis on refuse tout AUTRE dossier :
  // « docs/plans/x.md » et « x.md » désignent le même fichier, « docs/regles/x.md »
  // n'est pas un document du chef.
  const sansDossier = brut.startsWith(`${DOSSIER_PLANS}/`) ? brut.slice(DOSSIER_PLANS.length + 1) : brut;
  if (sansDossier.includes('/')) {
    return {
      ok: false,
      raison:
        `Chemin refusé : le chef écrit ses documents et ses plans dans « ${DOSSIER_PLANS}/ » ` +
        `(un fichier, sans sous-dossier). Modifier le reste du projet s'ouvre en carte.`,
    };
  }
  if (!sansDossier || sansDossier.startsWith('.')) {
    return { ok: false, raison: 'Le nom du document est vide.' };
  }

  const point = sansDossier.lastIndexOf('.');
  const extension = point > 0 ? sansDossier.slice(point).toLowerCase() : '';
  if (extension && !EXTENSIONS_DOCUMENT.includes(extension)) {
    return {
      ok: false,
      raison: `Seuls les documents ${EXTENSIONS_DOCUMENT.join(' ou ')} passent par cet outil : « ${extension} » est refusé.`,
    };
  }

  const nom = nomDeFichierPropre(point > 0 ? sansDossier.slice(0, point) : sansDossier);
  if (!nom) return { ok: false, raison: 'Le nom du document ne garde aucun caractère utilisable.' };

  return { ok: true, chemin: `${DOSSIER_PLANS}/${nom}${extension || EXTENSION_DOCUMENT_PAR_DEFAUT}` };
}
