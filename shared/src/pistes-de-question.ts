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
