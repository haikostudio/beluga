/**
 * LE MOT DE RÉVEIL — « Dis <nom> », le nom de l'assistant (`nom-de-l-assistant.ts`) — et la façon de comparer ce
 * qui est dit.
 *
 * Depuis la carte « Veille privée et réveil « Dis Jarvis » » (16/11/2026), le mot n'est plus cherché dans une
 * TRANSCRIPTION faite par le serveur (l'ancienne écoute permanente envoyait chaque tranche de parole à
 * `/api/transcribe`) : il est reconnu SUR L'APPAREIL par une petite reconnaissance locale à grammaire restreinte
 * (`web/src/lib/mot-de-reveil.ts`, règles dans `veille-vocale.ts`). Ce fichier ne garde que ce qui sert encore :
 * la normalisation d'un texte et la FORME SONORE — qui rattrape une phrase mal écrite par la
 * transcription du direct (« mets-toi en veille » écrit « mais toi en vieille »).
 */

/**
 * Les nombres que la transcription écrit en CHIFFRES alors qu'ils s'entendent
 * comme des mots. « Dis » s'entend « dix » : le moteur écrit alors « 10 écho »
 * pour « Dis Haiko ». Sans cette table, ce réveil-là passerait à travers.
 */
const NOMBRES_DITS: Record<string, string> = {
  '0': 'zero', '1': 'un', '2': 'deux', '3': 'trois', '4': 'quatre', '5': 'cinq',
  '6': 'six', '7': 'sept', '8': 'huit', '9': 'neuf', '10': 'dix', '11': 'onze',
  '12': 'douze', '13': 'treize', '14': 'quatorze', '15': 'quinze', '16': 'seize',
  '20': 'vingt', '100': 'cent',
};

/**
 * UN mot ramené à ce qu'il sonne, à la française. Rien d'une vraie phonétique :
 * juste assez de règles pour que deux orthographes du même son se rejoignent.
 * Un mot qui s'effacerait entièrement garde sa première lettre.
 */
function motSonore(mot: string): string {
  if (!mot) return '';
  const reduit = (NOMBRES_DITS[mot] ?? mot)
    // Le son « f » : « ph » comme « f ». Avant que le « h » ne disparaisse.
    .replace(/ph/g, 'f')
    // Le son « k » : « ch » (écho, chorale), « qu », « q », « c » dur.
    .replace(/ch/g, 'k')
    .replace(/qu/g, 'k')
    .replace(/q/g, 'k')
    .replace(/c([eiy])/g, 's$1')
    .replace(/c/g, 'k')
    .replace(/g([eiy])/g, 'j$1')
    // Le « h » ne s'entend pas ; « y » se dit « i ».
    .replace(/h/g, '')
    .replace(/y/g, 'i')
    // Les voyelles composées, de la plus longue à la plus courte.
    .replace(/eau/g, 'o')
    .replace(/au/g, 'o')
    .replace(/ai|ei/g, 'e')
    .replace(/ou/g, 'u')
    .replace(/oi/g, 'wa')
    .replace(/eu|oe/g, 'e')
    // « s » et « z » se confondent à l'oreille ; une lettre doublée s'entend une fois.
    .replace(/z/g, 's')
    .replace(/(.)\1+/g, '$1')
    // Le « e » final ne se dit pas, ni la consonne finale qui le suivait.
    .replace(/e$/, '')
    .replace(/[stdxpgz]$/, '');
  return reduit || mot[0];
}

/**
 * Ce qu'un texte SONNE : chaque mot réduit, puis recollé sans espace. C'est
 * cette forme-là que l'on compare quand les lettres ne suffisent plus.
 */
export function formeSonore(texte: string): string {
  return normaliserParole(texte).split(' ').map(motSonore).join('');
}

/**
 * Le texte débarrassé de ce qui ne s'entend pas : majuscules, accents,
 * ponctuation. « Dis, Haïko ! » et « dis haiko » deviennent la même chose.
 */
export function normaliserParole(texte: string): string {
  return texte
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Le message affiché quand le navigateur refuse le micro. Une phrase, en
 * français simple : on ne laisse jamais l'attente du mot échouer en silence.
 */
export const REFUS_MICRO = 'Micro refusé par le navigateur : autorisez-le pour réveiller l’assistant à la voix.';

/**
 * Le message affiché quand le son du navigateur ne s'ouvre pas : sans lui, rien
 * ne peut entendre le mot de réveil.
 */
export const SON_INDISPONIBLE = 'Le son du navigateur n’a pas pu s’ouvrir : le réveil à la voix n’est pas disponible ici.';
