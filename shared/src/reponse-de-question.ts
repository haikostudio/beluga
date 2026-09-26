/**
 * CE QUI A ÉTÉ CHOISI, ET CE QUI A ÉTÉ ÉCRIT À LA MAIN.
 *
 * Une réponse à une question est enregistrée en UNE SEULE chaîne : les
 * libellés retenus collés par « , », puis, séparé par « — », le complément
 * libre, puis la mention des images jointes (`texteDeReponse`,
 * `shared/src/images-reponse.ts`). Le récit d'une carte relisait cette chaîne
 * TELLE QUELLE, sous les pastilles de choix : on lisait donc deux fois le même
 * libellé, une fois en pastille bleue et une fois en paragraphe.
 *
 * Cette règle sépare les deux. Les pastilles disent ce qui a été retenu ; le
 * paragraphe ne garde que ce qui n'y est pas — le complément écrit à la main.
 *
 * ELLE NE RÉÉCRIT RIEN : les réponses déjà en base se relisent au nouveau
 * format sans qu'une seule ligne du journal ne bouge. Une chaîne qu'elle
 * n'arrive pas à découper (une vieille forme, une réponse recopiée à la main)
 * retombe en ENTIER dans le complément : mieux vaut la redire que la perdre.
 *
 * Règle pure : ni base, ni disque, ni React. Éprouvée seule dans
 * `server/src/test/reponse-de-question.test.ts`.
 */

/** Le séparateur posé par `texteDeReponse` entre ses morceaux. */
const ENTRE_MORCEAUX = ' — ';

/** Le séparateur posé entre deux libellés retenus. */
const ENTRE_LIBELLES = ', ';

/** Ce qu'une réponse enregistrée portait vraiment. */
export interface ReponseSeparee {
  /** Les libellés retenus, dans l'ordre où ils étaient proposés. */
  libelles: string[];
  /** Ce qui a été écrit à la main, quand il y en a. */
  complement?: string;
}

/**
 * SÉPARER UNE RÉPONSE ENREGISTRÉE.
 *
 * Les libellés sont épluchés en TÊTE de la chaîne, dans l'ordre où ils étaient
 * proposés — c'est exactement l'ordre où `texteDeReponse` les a collés. Un
 * libellé qui ne colle pas arrête l'épluchage : on ne devine pas.
 */
export function separerLaReponse(
  reponse: string | undefined,
  options: readonly string[],
): ReponseSeparee {
  const texte = (reponse ?? '').trim();
  if (!texte) return { libelles: [] };

  const libelles: string[] = [];
  let reste = texte;
  for (const option of options) {
    const libelle = (option ?? '').trim();
    if (!libelle) continue;
    if (!reste.startsWith(libelle)) continue;
    /* Le libellé doit finir sur une FRONTIÈRE : sans quoi « Oui » mangerait le
       début de « Oui, mais plus tard », écrit à la main. */
    const apres = reste.slice(libelle.length);
    if (apres && !apres.startsWith(ENTRE_LIBELLES) && !apres.startsWith(ENTRE_MORCEAUX)) continue;
    libelles.push(libelle);
    reste = apres.startsWith(ENTRE_LIBELLES) ? apres.slice(ENTRE_LIBELLES.length) : apres;
    if (!reste || reste.startsWith(ENTRE_MORCEAUX)) break;
  }

  if (!libelles.length) return { complement: texte, libelles: [] };
  const complement = (reste.startsWith(ENTRE_MORCEAUX) ? reste.slice(ENTRE_MORCEAUX.length) : reste).trim();
  return complement ? { libelles, complement } : { libelles };
}
