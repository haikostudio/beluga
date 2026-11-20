/**
 * LE NOM DE L'ASSISTANT ET LA PHRASE QUI L'APPELLE (carte « En-tête collant et défilement des pages », 17/11/2026).
 *
 * L'utilisateur donne un NOM à l'assistant (« Jarvis » par défaut) ; tout en découle :
 *   — la phrase d'appel attendue par le micro sur l'appareil : « Dis <nom> » (`phraseDAppel`) ;
 *   — le titre de sa conversation : « Assistant <nom> » ;
 *   — la façon dont le direct se présente (`consigneDeLaVoix`, voix-directe.ts).
 * Il n'y a plus de « mot de réveil » saisi à part : l'ancien réglage `voixReveil` ne sert qu'à REPRENDRE le nom
 * d'une installation d'avant (« Dis Jarvis » → « Jarvis »).
 *
 * UN NOM DOIT POUVOIR ÊTRE ENTENDU. L'appel est reconnu sur l'appareil par un petit modèle français qui ne connaît
 * qu'une liste fermée de mots (≈ 136 000, lue dans le modèle par le démon) : un mot absent est IGNORÉ par la
 * reconnaissance, l'appel ne marcherait jamais. Un tel nom est refusé, avec trois noms proches qui, eux, sont
 * entendus (`nomsProches`, pris dans `PRENOMS_SURS`, tous vérifiés présents dans le modèle).
 */
import { normaliserParole } from './reveil-vocal.js';

export const NOM_DE_L_ASSISTANT_PAR_DEFAUT = 'Jarvis';
/**
 * LE NOM D'UNE INSTALLATION NEUVE (carte « Assistant d'installation et Jarvis », 20/11/2026) : « Beluga », posé
 * explicitement au premier démarrage réel. Le défaut ci-dessus (« Jarvis ») reste le repli des installations d'avant,
 * qui n'ont jamais réglé de nom : elles ne sont pas renommées. Le modèle de réveil l'écrit « béluga » (vérifié par
 * test sur le vrai modèle).
 */
export const NOM_D_UNE_INSTALLATION_NEUVE = 'Beluga';
export const MOTS_DU_MODELE_D_UNE_INSTALLATION_NEUVE: readonly string[] = ['béluga'];
/** Au-delà, un nom n'est plus un nom. */
export const NOM_DE_L_ASSISTANT_MAX = 30;
/** Le prénom d'une personne, borné comme tout champ court. */
export const PRENOM_MAX = 40;

/** Les mots d'APPEL qu'un ancien mot de réveil pouvait porter devant le nom (« Dis Jarvis », « Hey Nova »). */
const MOTS_D_APPEL = new Set(['dis', 'dit', 'di', 'hey', 'he', 'eh', 'ok', 'okay', 'salut', 'bonjour', 'coucou', 'allo', 'yo']);
/** L'ancien défaut, jamais choisi : il revient au défaut d'aujourd'hui. */
const ANCIEN_NOM_PAR_DEFAUT = 'haiko';

/** Majuscule à chaque mot : « nova » → « Nova », « jean pierre » → « Jean Pierre ». */
function enNomPropre(mots: string[]): string {
  return mots.map((m) => m.charAt(0).toUpperCase() + m.slice(1)).join(' ');
}

/**
 * Le nom repris d'un ancien MOT DE RÉVEIL : les mots d'appel du début retirés (« Dis Jarvis » → « Jarvis »). Vide,
 * réduit à des mots d'appel ou resté à l'ancien défaut (« Dis Haiko ») : le nom par défaut.
 */
export function nomTireDuReveil(reglage?: string | null): string {
  const mots = (reglage ?? '').trim().split(/\s+/).filter(Boolean);
  let debut = 0;
  while (debut < mots.length - 1 && MOTS_D_APPEL.has(normaliserParole(mots[debut]))) debut += 1;
  const reste = mots.slice(debut).map((m) => m.replace(/[,!?.;:]+$/g, '')).filter(Boolean);
  if (!reste.length || (reste.length === 1 && MOTS_D_APPEL.has(normaliserParole(reste[0])))) return NOM_DE_L_ASSISTANT_PAR_DEFAUT;
  if (normaliserParole(reste.join(' ')) === ANCIEN_NOM_PAR_DEFAUT) return NOM_DE_L_ASSISTANT_PAR_DEFAUT;
  return enNomPropre(reste);
}

/** Le nom EFFECTIF de l'assistant : le nom réglé, sinon celui repris de l'ancien mot de réveil, sinon « Jarvis ». */
export function nomDeLAssistant(reglages?: { assistantNom?: string | null; voixReveil?: string | null } | null): string {
  const choisi = (reglages?.assistantNom ?? '').trim();
  return choisi || nomTireDuReveil(reglages?.voixReveil);
}

/** La phrase qui appelle l'assistant, attendue par le micro sur l'appareil : « Dis <nom> ». */
export function phraseDAppel(nom: string): string {
  return `Dis ${(nom || NOM_DE_L_ASSISTANT_PAR_DEFAUT).trim()}`;
}

/**
 * LA PHRASE QUE LE MICRO ÉCOUTE, écrite comme le modèle de réveil l'écrit : « Dis béluga » pour le nom « Beluga ».
 * Le modèle garde les accents ; un mot donné sans eux à sa grammaire serait ignoré. Les formes viennent du démon
 * (`assistantMotsDuModele`), et ne valent que si elles correspondent mot pour mot au nom réglé.
 */
export function phraseEcoutee(reglages?: { assistantNom?: string | null; voixReveil?: string | null; assistantMotsDuModele?: string[] | null } | null): string {
  const nom = nomDeLAssistant(reglages);
  const formes = (reglages?.assistantMotsDuModele ?? []).filter(Boolean);
  const mots = motsANEntendre(nom);
  const accordees = formes.length === mots.length && formes.every((f, i) => normaliserParole(f) === mots[i]);
  return phraseDAppel(accordees ? formes.join(' ') : nom);
}

/** Le titre de la conversation de l'assistant, tel que le démon le donne à son agent. L'écran le traduit lui-même. */
export function titreDeLAssistant(nom: string): string {
  return `Assistant ${(nom || NOM_DE_L_ASSISTANT_PAR_DEFAUT).trim()}`;
}

/**
 * Le nom tel qu'il sera ENREGISTRÉ : espaces resserrés, majuscule initiale, borné. Vide : `null` (refusé : un
 * assistant a toujours un nom).
 */
export function nomNettoye(saisi: string): string | null {
  const net = (saisi ?? '').replace(/\s+/g, ' ').trim().slice(0, NOM_DE_L_ASSISTANT_MAX);
  if (!net) return null;
  return net.charAt(0).toUpperCase() + net.slice(1);
}

/** Les mots que le micro devra reconnaître pour ce nom, sous la forme où la grammaire les attend. */
export function motsANEntendre(nom: string): string[] {
  return normaliserParole(nom).split(' ').filter(Boolean);
}

/**
 * Le nom sera-t-il ENTENDU ? Chaque mot (sans accent ni ponctuation, comme la grammaire du réveil les écrit) doit
 * appartenir au vocabulaire du modèle. Rend les mots absents ; vide = entendu.
 */
export function motsInconnus(nom: string, connu: (mot: string) => boolean): string[] {
  const mots = motsANEntendre(nom);
  if (!mots.length) return [];
  return mots.filter((mot) => !connu(mot));
}

/**
 * DES PRÉNOMS SÛRS, tous présents dans le vocabulaire du modèle de réveil (vosk-model-small-fr-0.22 — vérifié par
 * test sur le modèle quand il est là, et par `scripts/verif-voix-et-assistant.mjs`). Ils servent de suggestions
 * quand un nom ne serait pas entendu.
 */
export const PRENOMS_SURS: readonly string[] = [
  'Jarvis', 'Nova', 'Alfred', 'Oscar', 'Jules', 'Victor', 'Arthur', 'Hugo', 'Louis', 'Max', 'Léon', 'Gaston',
  'Marcel', 'Albert', 'Edgar', 'Iris', 'Luna', 'Emma', 'Léa', 'Zoé', 'Jade', 'Alice', 'Nina', 'Eva', 'Clara',
  'Camille', 'Chloé', 'Sacha', 'Milo', 'Maya', 'Lina', 'Anna', 'Mia', 'Théo', 'Sam', 'Alex', 'Tom', 'Gabriel',
  'Nathan', 'Lucas', 'Adam', 'Noah', 'Paul', 'Marie', 'Karim', 'Friday',
];

/** Distance d'édition entre deux mots courts. */
function distance(a: string, b: string): number {
  const ligne = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    let diag = ligne[0];
    ligne[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const haut = ligne[j];
      ligne[j] = Math.min(ligne[j] + 1, ligne[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = haut;
    }
  }
  return ligne[b.length];
}

/**
 * TROIS NOMS PROCHES, entendus à coup sûr : même initiale d'abord, puis ceux qui s'écrivent le plus comme le nom
 * saisi, puis à longueur voisine. Un `connu` donné écarte en plus ce que le modèle réel ne connaîtrait pas.
 */
export function nomsProches(saisi: string, combien = 3, connu?: (mot: string) => boolean): string[] {
  const cible = normaliserParole(saisi).replace(/\s/g, '');
  const candidats = PRENOMS_SURS.filter((nom) => !connu || motsInconnus(nom, connu).length === 0).filter(
    (nom) => normaliserParole(nom) !== cible,
  );
  const score = (nom: string) => {
    const n = normaliserParole(nom);
    return (cible && n[0] === cible[0] ? 0 : 10) + distance(n, cible) + Math.abs(n.length - cible.length) / 10;
  };
  return [...candidats].sort((a, b) => score(a) - score(b) || a.localeCompare(b)).slice(0, combien);
}

/**
 * LE VOCABULAIRE DU MODÈLE, RANGÉ PAR FORME NORMALISÉE (carte « Assistant d'installation et Jarvis », 20/11/2026) :
 * le modèle garde les accents (« béluga »), la saisie et la grammaire les comparent sans (« beluga »). Comparer une
 * forme normalisée au vocabulaire brut refusait tout nom accentué. À forme égale, le mot écrit sans accent l'emporte.
 */
export function vocabulaireParForme(mots: Iterable<string>): Map<string, string> {
  const parForme = new Map<string, string>();
  for (const mot of mots) {
    const forme = normaliserParole(mot);
    if (!forme || forme.includes(' ')) continue;
    const deja = parForme.get(forme);
    if (!deja || mot === forme) parForme.set(forme, mot);
  }
  return parForme;
}

/** Le prénom d'une personne tel qu'il sera enregistré : espaces resserrés, borné ; vide = aucun prénom. */
export function prenomNettoye(saisi: string | null | undefined): string {
  return (saisi ?? '').replace(/\s+/g, ' ').trim().slice(0, PRENOM_MAX);
}
