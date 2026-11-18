/**
 * LES IMAGES DE CONCEPTION D'UNE CAMPAGNE (carte « Visuel vivant pendant la création de campagne », 10/11/2026).
 *
 * Pendant qu'il conçoit une campagne, son agent MONTRE l'idée dans sa discussion :
 *  - les questions qui changent le rendu portent une MAQUETTE instantanée par option (exemple_de_choix, nature
 *    « page », pièces nommées « exemple-A.png ») ;
 *  - après chaque grande étape (idée ; message et ton ; stratégie complète) et à chaque changement de direction, il
 *    dessine une ESQUISSE, une vraie image gratuite (action « esquisse » de l'outil « communication », pièce nommée
 *    « esquisse-campagne-… »).
 *
 * Ni l'une ni l'autre n'est un média de la marque : elles restent dans la discussion, JAMAIS dans Médias. La DERNIÈRE
 * esquisse sert d'image à la campagne tant qu'aucune image ni aucun vrai visuel ne la remplace. Règles pures.
 */

/** Le début du nom de chaque esquisse jointe au fil de l'agent de campagne. */
export const PREFIXE_D_ESQUISSE = 'esquisse-campagne-';

/** L'outil écrit sur le bloc d'attente d'une esquisse — et sur sa ligne de médias livrés. */
export const OUTIL_D_ESQUISSE = 'Esquisse de campagne — Codex du serveur, sans frais';

/** Le nom de la n-ième esquisse d'une campagne (n compté à partir de 1). */
export function nomDEsquisse(rang: number): string {
  return `${PREFIXE_D_ESQUISSE}${Math.max(1, Math.floor(rang))}.png`;
}

/**
 * Les outils des EXEMPLES DE CHOIX (`server/src/exemples-de-choix.ts`) : ce qu'ils fabriquent sert une question, pas
 * la marque.
 */
const OUTILS_DE_CONCEPTION = [/page photographi[ée]e/i, /esquisse de campagne/i, /codex du serveur, sinon service externe/i, /voix d.essai du serveur/i];

/**
 * UNE PIÈCE DE CONCEPTION (esquisse ou maquette d'un choix) ? Reconnue par son NOM (« esquisse-campagne-3.png »,
 * « exemple-B.png ») ou par l'OUTIL qui l'a fabriquée. Elle n'entre jamais dans Médias.
 */
export function pieceDeConception(p: { nom?: string | null; outil?: string | null }): boolean {
  const nom = (p.nom ?? '').trim().toLowerCase();
  if (nom.startsWith(PREFIXE_D_ESQUISSE)) return true;
  if (/^exemple-[a-z]{1,2}\.(png|jpe?g|webp|wav|mp3)$/i.test(nom)) return true;
  const outil = p.outil ?? '';
  return OUTILS_DE_CONCEPTION.some((r) => r.test(outil));
}

/**
 * L'IMAGE D'UNE CAMPAGNE dans sa liste : celle posée par ailleurs d'abord, puis le premier vrai visuel de ses
 * publications, et seulement à défaut sa dernière esquisse.
 */
export function apercuDeCampagne(image: string | null | undefined, premierVisuel: string | null | undefined, derniereEsquisse: string | null | undefined): string | null {
  return image || premierVisuel || derniereEsquisse || null;
}
