/**
 * LES PISTES D'UNE QUESTION DE CONCEPTION. Une question qui ne propose que deux
 * choix oblige l'utilisateur à inventer lui-même la troisième voie (cas vécu :
 * « Comment la vidéo invite-t-elle à vous contacter ? », deux choix, et la
 * réponse écrite à la main était la bonne). La règle est dite ici UNE fois et
 * reprise par la consigne de réalisation, celle du cahier des charges, celle du
 * cadrage de plan et la description de l'outil « ask_user ».
 */
export const PISTES_MINIMUM_PAR_QUESTION = 4;

export const REGLE_DES_PISTES =
  `PISTES : toute question de CONCEPTION (une idée, une approche, un parti pris — pas une information factuelle) propose AU MOINS ${PISTES_MINIMUM_PAR_QUESTION} pistes réellement DIFFÉRENTES, pas des variantes d'une même idée. ` +
  `L'une d'elles est INATTENDUE : une approche, un compromis ou un détour que l'utilisateur n'aurait pas imaginé tout seul. ` +
  `Chaque piste porte sa « description » : ce qu'elle donne concrètement, et ce qu'elle coûte ou sacrifie. La recommandée vient en tête, marquée « (recommandé) ». ` +
  `Ne réduis jamais une question à deux choix opposés : l'utilisateur garde sa réponse écrite, mais il ne doit pas avoir à imaginer lui-même l'alternative.`;

/**
 * LES EXEMPLES D'UN CHOIX QUI SE VOIT OU S'ENTEND (décisions du 29/10/2026,
 * captures #2a0a et #b2e5). Dite UNE fois ici, reprise par la description de
 * l'outil « ask_user » — que reçoivent tous les agents qui posent des questions.
 * Les couleurs portent leurs points d'office (`couleurs` d'une option) ; tout
 * autre choix visuel ou sonore commence par proposer des exemples, fabriqués
 * par l'outil « exemple_de_choix » (local d'abord, externe plafonné à 1 $ par
 * carte). Le mode caméra en est exempté : son questionnaire illustré les a déjà.
 */
export const NATURES_D_EXEMPLE = ['page', 'image', 'voix'] as const;
/** Un exemple par piste, quatre au plus. */
export const MAX_PISTES_D_EXEMPLE = 4;

export const REGLE_DES_EXEMPLES =
  `EXEMPLES : un choix de COULEURS porte d'office ses teintes dans « couleurs » de chaque option (« #rrggbb »), sans question. ` +
  `Avant tout autre choix dont la réponse se VOIT ou s'ENTEND (couleurs en situation, icône, encadré, composant, mise en page, typographie, illustration, logo, ambiance, voix, musique), demande d'abord par une question à part, en une phrase, si tu dois en fabriquer des exemples (« Oui, montre-moi des exemples (recommandé) » / « Non, le texte suffit ») — pour des couleurs, cette proposition vient APRÈS les points, pour montrer l'élément réel dans chaque variante. ` +
  `Sur « oui » : exemple_de_choix, un exemple par piste (${MAX_PISTES_D_EXEMPLE} au plus), puis repose la question avec « image » ou « media » dans chaque option, en citant la lettre et la référence de chaque exemple (« A (#xxxx) »). ` +
  `Jamais pour une question pratique (nom, réglage, oui/non, information, choix technique), ni en mode caméra.`;
