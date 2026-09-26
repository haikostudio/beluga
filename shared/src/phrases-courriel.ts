/**
 * LES PHRASES DES COURRIELS — ce qu'un humain lit, pas ce que la base retient.
 *
 * Les courriels écrivaient « 2 demande(s) », « a-faire » ou « a enregistré la
 * fiche » : des bouts de base et des parenthèses qu'on ne mettrait jamais dans
 * un vrai message. Tout ce qui se RÉDIGE vit ici, pur et testé seul :
 *
 *  - LE NOMBRE S'ACCORDE, jamais de « (s) » ;
 *  - UN CHANGEMENT DU JOURNAL D'ACTIVITÉ DEVIENT UNE PHRASE. La traduction se
 *    fait À LA LECTURE, pas à l'écriture : les lignes déjà en base portent la
 *    clé interne de colonne (`a-faire`, `termine`) ou l'étape (`demarree`), et
 *    le prochain courriel doit être propre sans migration ;
 *  - LA DATE SE LIT comme on la dit : « lun. 7 sept. à 09:05 ».
 */

import { COLONNES_DEMANDE, TITRES_COLONNES_DEMANDE, type ColonneDemande, type GenreActivite } from './espace-client.js';

/** Le mot accordé au nombre : « demande » ou « demandes ». */
export function accord(n: number, singulier: string, pluriel = `${singulier}s`): string {
  return Math.abs(n) >= 2 ? pluriel : singulier;
}

/** Le nombre et son mot, accordés : « 1 demande », « 3 demandes ». */
export function nombre(n: number, singulier: string, pluriel = `${singulier}s`): string {
  return `${n} ${accord(n, singulier, pluriel)}`;
}

/** « a », « b » et « c » : une énumération comme on l'écrit. */
export function enumeration(bouts: readonly string[]): string {
  const utiles = bouts.filter(Boolean);
  if (utiles.length <= 1) return utiles[0] ?? '';
  return `${utiles.slice(0, -1).join(', ')} et ${utiles[utiles.length - 1]}`;
}

const JOURS = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];
const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

/** Une date dite comme à l'oral, avec l'heure : « lun. 7 sept. à 09:05 ». */
export function dateAmicale(instant: number): string {
  const d = new Date(instant);
  const deux = (n: number) => String(n).padStart(2, '0');
  return `${JOURS[d.getDay()]} ${d.getDate()} ${MOIS[d.getMonth()]} à ${deux(d.getHours())}:${deux(d.getMinutes())}`;
}

/** Une colonne, dite avec son nom lisible. */
function phraseDeColonne(colonne: ColonneDemande): string {
  if (colonne === 'termine') return 'a marqué la demande comme terminée 🎉';
  if (colonne === 'valide') return 'a validé la demande ✅';
  return `a déplacé la demande dans « ${TITRES_COLONNES_DEMANDE[colonne]} »`;
}

/** Les étapes de la carte liée, telles que le journal les range dans `detail`. */
const PHRASES_D_AVANCEMENT: Record<string, string> = {
  demarree: 'Le travail a commencé 🚀',
  terminee: 'Le travail est terminé 🎉',
  'en-ligne': 'C’est en ligne ! 🌐',
};

/**
 * UNE LIGNE DU JOURNAL, EN PHRASE. Rend :
 *
 *  - un PRÉDICAT qui commence par une minuscule (« a déplacé la demande… »),
 *    que le gabarit fait précéder du nom de l'auteur ;
 *  - ou une PHRASE ENTIÈRE qui commence par une majuscule (« Le travail a
 *    commencé 🚀 »), qui se lit seule — personne n'a signé une étape.
 *
 * Une phrase inconnue passe telle quelle : mieux vaut un texte brut qu'un trou.
 */
export function phraseDeChangement(genre: GenreActivite, detail: string): string {
  const brut = detail.trim();
  switch (genre) {
    case 'deplacement':
      return (COLONNES_DEMANDE as readonly string[]).includes(brut)
        ? phraseDeColonne(brut as ColonneDemande)
        : brut
          ? `a déplacé la demande dans « ${brut} »`
          : 'a déplacé la demande';
    case 'avancement':
      return PHRASES_D_AVANCEMENT[brut] ?? brut;
    case 'creation':
      return 'a ouvert la demande ✏️';
    case 'archivage':
      return 'a rangé la demande dans les archives 📦';
    case 'desarchivage':
      return 'a ressorti la demande des archives';
    case 'carte':
      return 'a lancé le travail sur la demande 🛠️';
    case 'modification':
      return brut === 'a enregistré la fiche' ? 'a mis la fiche à jour' : brut;
    default:
      return brut;
  }
}

/** Un prédicat se fait précéder de son auteur ; une phrase entière se lit seule. */
export function estUnPredicat(phrase: string): boolean {
  const premier = phrase.trim().charAt(0);
  return premier !== '' && premier === premier.toLowerCase() && premier !== premier.toUpperCase();
}
