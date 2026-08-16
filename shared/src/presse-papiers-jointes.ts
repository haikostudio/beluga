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

import { ancre } from './ancres.js';
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

/** La marque d'un fichier dans le texte d'une demande : « [fichier: nom] ». */
const MARQUE_FICHIER = /\[fichier:\s*([^\]\n]+)\]/g;

/** Les noms de fichiers cités par le texte, dans l'ordre, sans répétition. */
export function nomsDesTags(texte: string | null | undefined): string[] {
  if (!texte) return [];
  MARQUE_FICHIER.lastIndex = 0;
  const noms: string[] = [];
  let trouve: RegExpExecArray | null;
  while ((trouve = MARQUE_FICHIER.exec(texte))) {
    const nom = (trouve[1] ?? '').trim();
    if (nom && !noms.includes(nom)) noms.push(nom);
  }
  return noms;
}

/**
 * LE TEXTE COPIÉ NOMME TOUS SES FICHIERS. C'est ce nom, et lui seul, qui
 * permettra de les retrouver au collage quand le presse-papiers n'aura porté
 * que du texte. Un fichier joint sans tag dans la phrase (dépôt à côté du
 * texte, message ancien) reçoit donc le sien, à la fin — le texte d'origine
 * n'est jamais modifié dans la conversation, seule la COPIE le porte.
 */
export function texteAvecTagsDesJointes(texte: string, jointes: Attachment[]): string {
  const cites = new Set(nomsDesTags(texte));
  const manquants = jointes.map((item) => item.name).filter((nom) => nom && !cites.has(nom));
  if (!manquants.length) return texte;
  const marques = manquants.map((nom) => ancre(nom)).join(' ');
  if (!texte.trim()) return marques;
  return /\s$/.test(texte) ? `${texte}${marques}` : `${texte} ${marques}`;
}

/**
 * LE REPLI QUAND LE PRESSE-PAPIERS N'A PORTÉ QUE DU TEXTE.
 *
 * Un type de presse-papiers à nous ne survit pas partout : sur TÉLÉPHONE
 * (iOS, presse-papiers du système), copier un message puis coller ne rend que
 * le texte — les tags « [fichier: …] » revenaient alors morts, sans fichier.
 * Or ces tags NOMMENT les fichiers : il suffit de les retrouver dans la liste
 * du projet, déjà chargée dans la page.
 *
 * Un même nom peut avoir été envoyé plusieurs fois : on retient le plus
 * RÉCENT, celui que l'utilisateur vient de voir. Un nom inconnu (fichier
 * retiré, liste pas encore chargée) est sauté sans bruit — le texte reste
 * collé, comme avant.
 */
export function jointesDesTags(
  texte: string | null | undefined,
  connues: Attachment[],
): Attachment[] {
  const trouvees: Attachment[] = [];
  for (const nom of nomsDesTags(texte)) {
    let meilleure: Attachment | undefined;
    for (const item of connues) {
      if (item.name !== nom) continue;
      if (!meilleure || item.createdAt > meilleure.createdAt) meilleure = item;
    }
    if (meilleure) trouvees.push(meilleure);
  }
  return trouvees;
}
