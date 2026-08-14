/**
 * LES PIÈCES JOINTES QUI VOYAGENT DANS LE PRESSE-PAPIERS.
 *
 * Copier un message (ou une sélection portant des tags « [fichier: …] ») doit
 * emporter les FICHIERS avec le texte : au collage dans la barre d'écriture,
 * les mêmes pièces jointes réapparaissent au-dessus du champ, exactement comme
 * si on venait de les ajouter à la main — sans les renvoyer au serveur, ce sont
 * les fichiers D'ORIGINE, désignés par leur identifiant.
 *
 * Le presse-papiers ne sait porter que du texte : les pièces jointes voyagent
 * donc sous un type à nous, en JSON. Tout ce qui est décidé ici (emballer,
 * relire sans faire confiance, fusionner sans doublon) vit sans navigateur ni
 * réseau : cela se teste seul.
 */

import { Attachment } from './models.js';

/**
 * Le type de presse-papiers propre à HaikoDev. Un type inconnu des autres
 * applications : coller ailleurs ne rendra que le texte, ce qui est voulu.
 */
export const TYPE_JOINTES_COLLABLES = 'application/x-haikodev-fichiers';

/** Ce qui part dans le presse-papiers à côté du texte. */
export function emballerJointes(jointes: Attachment[]): string {
  return JSON.stringify(jointes ?? []);
}

/**
 * Relire ce qui a été collé. Le presse-papiers vient du DEHORS : un contenu
 * mal formé, tronqué ou écrit par une version plus ancienne ne doit jamais
 * casser le collage — ce qui n'est pas une pièce jointe valable est écarté,
 * le reste passe.
 */
export function relireJointes(brut: string | null | undefined): Attachment[] {
  if (!brut) return [];
  let lu: unknown;
  try {
    lu = JSON.parse(brut);
  } catch {
    return [];
  }
  if (!Array.isArray(lu)) return [];
  const gardees: Attachment[] = [];
  for (const item of lu) {
    const juge = Attachment.safeParse(item);
    if (juge.success) gardees.push(juge.data);
  }
  return gardees;
}

/**
 * Ajouter les pièces jointes collées à celles déjà posées dans la barre.
 * Un même fichier ne s'ajoute pas deux fois : ni par son identifiant, ni par
 * son empreinte (le même contenu déjà joint sous un autre envoi). L'ordre des
 * pièces déjà là ne bouge pas, les nouvelles se rangent à la suite.
 */
export function ajouterJointesCollees(
  actuelles: Attachment[],
  collees: Attachment[],
): Attachment[] {
  const parId = new Set(actuelles.map((item) => item.id));
  const parEmpreinte = new Set(actuelles.map((item) => item.sha).filter(Boolean));
  const nouvelles: Attachment[] = [];
  for (const item of collees) {
    if (!item || parId.has(item.id)) continue;
    if (item.sha && parEmpreinte.has(item.sha)) continue;
    parId.add(item.id);
    if (item.sha) parEmpreinte.add(item.sha);
    nouvelles.push(item);
  }
  return nouvelles.length ? [...actuelles, ...nouvelles] : actuelles;
}

/**
 * Les pièces jointes d'un message, retrouvées dans la liste du projet. Un
 * identifiant qui ne correspond à rien de connu (liste pas encore chargée,
 * fichier retiré) est simplement sauté : on ne copie que ce qu'on a.
 */
export function jointesDuMessage(ids: string[], connues: Attachment[]): Attachment[] {
  return ids
    .map((id) => connues.find((item) => item.id === id))
    .filter((item): item is Attachment => !!item);
}
