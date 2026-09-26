/**
 * CE QU'ON DIT À L'AGENT QUAND UNE DEMANDE DE CLIENT DEVIENT UNE TÂCHE.
 *
 * La conversion recopiait le titre et la description de la demande dans une
 * carte, et s'arrêtait là : tout ce qui s'était dit APRÈS — les précisions, les
 * réponses, les captures — restait dans la messagerie, et la tâche naissait
 * amputée. Elle passe désormais par l'agent de CADRAGE de la nouvelle carte, à
 * qui l'on donne l'échange entier ; il en tire un titre et une description
 * propres, et c'est le même agent qui prendra ensuite le travail en charge.
 *
 * C'EST AUSSI CE QUI FAIT RÉAPPARAÎTRE LES RÉSUMÉS sous chaque point du
 * déroulé : ils sont écrits par le cadrage (`board_update_card`,
 * `resumeDemande`), et une carte née d'une recopie n'en rencontrait jamais.
 *
 * RÈGLE PURE, SANS BASE NI DISQUE : elle se teste seule, et le serveur ne fait
 * que lui passer ce qu'il a lu.
 */

export interface MessageDeLEchange {
  auteurNom: string;
  texte: string;
  creeLe: number;
}

export interface EchangeAConvertir {
  titre: string;
  description: string;
  auteurNom: string;
  /** Le nom du projet visé, tel qu'il s'affiche : l'agent doit savoir où il est. */
  nomDuProjet: string;
  messages: readonly MessageDeLEchange[];
  /** Les noms des pièces jointes du fil, toutes rattachées à la carte. */
  pieces: readonly string[];
}

/** Ce que le fil devient dans le prompt : un auteur, puis ce qu'il a écrit. */
function filEnClair(messages: readonly MessageDeLEchange[]): string {
  if (!messages.length) return '_Aucun message après la demande._';
  return messages
    .map((message) => {
      const texte = message.texte.trim();
      return `**${message.auteurNom}** :\n${texte || '_(sans texte — voir les pièces jointes)_'}`;
    })
    .join('\n\n');
}

/**
 * LE PREMIER TOUR DU CADRAGE D'UNE TÂCHE NÉE DE LA MESSAGERIE.
 *
 * Il dit d'où vient la demande, donne l'échange entier dans l'ordre, nomme les
 * pièces jointes — déjà rattachées à la carte, donc lisibles — et demande le
 * déroulé habituel : titre, synthèse, puis compréhension. JAMAIS le plan : le
 * plan se demande, comme pour toute autre carte.
 */
export function demandeDeCadrageDUneDemande(echange: EchangeAConvertir): string {
  const pieces = echange.pieces.length
    ? echange.pieces.map((nom) => `- ${nom}`).join('\n')
    : '_Aucune pièce jointe._';
  return [
    `Cette tâche vient d'une demande déposée par **${echange.auteurNom}** dans la messagerie du projet « ${echange.nomDuProjet} ».`,
    '',
    "Voici l'échange ENTIER. Lis-le en entier avant d'écrire quoi que ce soit : le besoin réel est souvent",
    'précisé dans les messages qui suivent la demande, pas dans la demande elle-même.',
    '',
    '## La demande déposée',
    '',
    `**Titre :** ${echange.titre}`,
    '',
    echange.description.trim() || '_Sans description._',
    '',
    '## Ce qui a été dit ensuite',
    '',
    filEnClair(echange.messages),
    '',
    '## Les pièces jointes',
    '',
    'Elles sont DÉJÀ rattachées à cette carte, tu peux les ouvrir :',
    '',
    pieces,
    '',
    '## Ce qu’on attend de toi',
    '',
    "Fais ton déroulé de cadrage habituel : pose le titre et la synthèse de la carte, puis rends ta",
    'compréhension. Le titre et la description doivent refléter tout l’échange, pas seulement la',
    'première phrase ; ce qui n’est qu’une politesse ou une relance n’a pas à y figurer. Ne rends PAS',
    'de plan : il se demandera ensuite, comme pour toute autre carte.',
  ].join('\n');
}
