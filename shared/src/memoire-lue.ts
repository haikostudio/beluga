/**
 * CE QU'UNE CONSULTATION DE LA MÉMOIRE A RAMENÉ — EN RÉFÉRENCES, PAS EN PAVÉ.
 *
 * L'outil `memoire` rend un TEXTE à l'agent, et c'est très bien pour lui : il
 * lit du texte. L'écran, lui, l'affichait tel quel — un mur de vingt lignes où
 * l'on distinguait à peine « MEM-1443 · project · P0 · … » de la suivante, et
 * dont chaque résumé était coupé à 240 signes par un « … » qu'aucun clic ne
 * pouvait rouvrir. On avait sous les yeux la liste exacte de ce que l'agent
 * savait du projet, et personne ne la lisait.
 *
 * Ce fichier RELIT ce texte et rend des RÉFÉRENCES séparées : l'identifiant, le
 * type, l'importance, la portée, le titre, la fiche où elle est rangée, son
 * résumé, et le fait qu'elle était déjà lue dans la session. L'écran n'a plus
 * qu'à poser un volet par référence et à demander la fiche entière au clic
 * (`memoire.unite`).
 *
 * LA FORME LUE EST CELLE QUE LE DÉMON ÉCRIT — `rendreUnitesTrouvees`,
 * `server/src/connaissances.ts` :
 *
 *     N unité(s) pour « demande » :
 *     - MEM-1234 · decision · P1 · global · Titre (fiche 05_decisions) — déjà lue dans cette session
 *       le résumé, sur une ligne indentée de deux espaces
 *
 *     Lis une unité entière avec « lire » et son « id ».
 *
 * TOUT CE QUI N'ENTRE PAS DANS CETTE FORME RETOMBE EN TEXTE : la lecture d'une
 * unité entière (`texteDUneUnite`), une fiche numérotée, un changelog, une
 * proposition acceptée. Mieux vaut un texte lisible qu'un volet vide — c'est la
 * règle de tout ce fichier : on ne devine JAMAIS une référence.
 *
 * Règle pure : ni base, ni disque, ni React. Éprouvée seule dans
 * `server/src/test/memoire-lue.test.ts`.
 */

/** Une référence trouvée dans la mémoire, telle que la recherche l'a listée. */
export interface RefMemoire {
  /** L'identifiant de l'unité : `MEM-1234`, `DEC-007`. C'est la clé du volet. */
  id: string;
  /** Le type de l'unité — `decision`, `convention`… — tel qu'il est écrit. */
  type?: string;
  /** L'importance : `P0` vital, `P3` anecdotique. */
  importance?: string;
  /** La portée : le projet, ou la base commune à tous les projets. */
  portee: 'projet' | 'global';
  /** Le titre lisible de l'unité. */
  titre: string;
  /** La fiche numérotée où elle est rangée (`05_decisions`). */
  fiche?: string;
  /** Le résumé rendu par la recherche, souvent coupé à 240 signes. */
  resume?: string;
  /** Cette unité était déjà dans le contexte de l'agent avant cette recherche. */
  dejaLue: boolean;
}

/**
 * CE QU'UNE CONSULTATION A RENDU.
 *
 *  - `recherche` : une liste de références, avec son entête (« 8 unité(s) pour
 *    « … » ») — le seul mode qui se déplie en volets ;
 *  - `vide`      : la recherche n'a rien trouvé, et le dit ;
 *  - `texte`     : tout le reste — une unité lue entière, une fiche, le
 *    changelog, une proposition —, qui se lit comme du texte mis en forme.
 */
export interface MemoireLue {
  mode: 'recherche' | 'vide' | 'texte';
  /** La phrase de tête d'une recherche, sans les références qui la suivent. */
  entete?: string;
  references: RefMemoire[];
}

/**
 * LES IDENTIFIANTS NE SONT PAS TOUS DES « MEM- ». Une décision porte `DEC-007`,
 * et rien n'interdit à une portée future d'en inventer un troisième préfixe :
 * le motif reste donc LARGE — trois lettres capitales, un tiret, des chiffres —
 * plutôt que d'énumérer ce qu'on connaît aujourd'hui.
 */
const IDENTIFIANT = /^[A-Z]{2,4}-\d{2,}$/;

/** La ligne de tête d'une recherche : « 8 unité(s) pour « … » : ». */
const ENTETE_DE_RECHERCHE = /^\s*\d+\s+unité\(s\)\s+pour\s+/i;

/** La phrase rendue quand la recherche n'a rien ramené. */
const RIEN_TROUVE = /^\s*Aucune unité ne répond à/i;

/** La mention posée derrière le titre d'une unité déjà dans le contexte. */
const DEJA_LUE = /\s+[—-]\s+déjà lue dans cette session\s*$/i;

/** La dernière consigne de la liste, qui s'adresse à l'agent et à lui seul. */
const CONSIGNE_FINALE = /^\s*Lis une unité entière avec/i;

/**
 * UNE LIGNE DE RÉFÉRENCE, RELUE.
 *
 * L'ordre des morceaux est fixe (identifiant, type, importance, puis « global »
 * quand la portée n'est pas le projet), mais LE TITRE PEUT TOUT CONTENIR — des
 * points médians, des parenthèses, un « : ». On épluche donc par la GAUCHE ce
 * qui est réglé d'avance, et on garde le reste comme titre, sa fiche retirée
 * par la fin.
 */
function referenceDeLaLigne(ligne: string): RefMemoire | null {
  const corps = ligne.replace(/^\s*-\s+/, '');
  if (corps === ligne) return null;

  const morceaux = corps.split(' · ');
  const id = (morceaux[0] ?? '').trim();
  if (!IDENTIFIANT.test(id)) return null;

  let rang = 1;
  const type = morceaux[rang] && /^[a-z]+$/.test(morceaux[rang].trim()) ? morceaux[rang++].trim() : undefined;
  const importance = morceaux[rang] && /^P\d$/.test(morceaux[rang].trim()) ? morceaux[rang++].trim() : undefined;
  const global = morceaux[rang]?.trim() === 'global';
  if (global) rang++;

  /* LE TITRE REPREND TOUT CE QUI RESTE, ses points médians compris : un titre
     coupé au premier « · » perdrait « ProjetC : marketplace · v2 ». */
  let titre = morceaux.slice(rang).join(' · ').trim();
  if (!titre) return null;

  const dejaLue = DEJA_LUE.test(titre);
  titre = titre.replace(DEJA_LUE, '').trim();

  /* LA FICHE EST À LA FIN, entre parenthèses : on prend la DERNIÈRE, sans quoi
     un titre qui contient lui-même « (fiche … ) » tromperait la lecture. */
  let fiche: string | undefined;
  const marque = /\(fiche\s+([^()]+)\)\s*$/.exec(titre);
  if (marque) {
    fiche = marque[1].trim();
    titre = titre.slice(0, marque.index).trim();
  }
  if (!titre) return null;

  return {
    id,
    ...(type ? { type } : {}),
    ...(importance ? { importance } : {}),
    portee: global ? 'global' : 'projet',
    titre,
    ...(fiche ? { fiche } : {}),
    dejaLue,
  };
}

/**
 * CE QU'UNE CONSULTATION DE LA MÉMOIRE A RAMENÉ.
 *
 * Une seule référence reconnue suffit à passer en mode `recherche` : une liste
 * dont une ligne aurait été abîmée par le bornage du journal vaut mieux
 * amputée qu'entièrement perdue. Aucune, et on retombe sur le texte.
 */
export function lireLaMemoire(texte: string | undefined): MemoireLue {
  const propre = (texte ?? '').trim();
  if (!propre) return { mode: 'texte', references: [] };
  if (RIEN_TROUVE.test(propre)) return { mode: 'vide', references: [] };

  const lignes = propre.split('\n');
  const references: RefMemoire[] = [];
  let entete: string | undefined;

  for (const ligne of lignes) {
    if (!entete && ENTETE_DE_RECHERCHE.test(ligne)) {
      entete = ligne.replace(/\s*:\s*$/, '').trim();
      continue;
    }
    const reference = referenceDeLaLigne(ligne);
    if (reference) {
      references.push(reference);
      continue;
    }
    /* UNE LIGNE INDENTÉE QUI SUIT UNE RÉFÉRENCE EST SON RÉSUMÉ. Le démon
       l'écrit sur une seule ligne, indentée de deux espaces ; une continuation
       repliée par un affichage se recolle à la suite plutôt que de se perdre. */
    const derniere = references[references.length - 1];
    if (derniere && /^\s{2,}\S/.test(ligne) && !CONSIGNE_FINALE.test(ligne)) {
      const suite = ligne.trim();
      derniere.resume = derniere.resume ? `${derniere.resume} ${suite}` : suite;
    }
  }

  if (!references.length) return { mode: 'texte', references: [] };
  return { mode: 'recherche', ...(entete ? { entete } : {}), references };
}
