import { minusculesSansAccents } from './mots.js';
/*
 * LA GRILLE D'UN MOIS, du lundi au dimanche. Le calendrier général n'est plus un service (20/11/2026) : ces règles
 * servent au volet « Calendrier » de chaque campagne (`conversation-de-campagne.tsx`), et à la recherche de projet.
 */

/** « AAAA-MM-JJ » d'une date locale. */
export function jourIso(date: Date): string {
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const j = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${m}-${j}`;
}

/**
 * LES SEMAINES D'UN MOIS (`mois` de 0 à 11), du lundi au dimanche : chaque semaine porte sept jours « AAAA-MM-JJ »,
 * débordements des mois voisins compris pour remplir la première et la dernière semaine.
 */
export function semainesDuMois(annee: number, mois: number): string[][] {
  const premier = new Date(annee, mois, 1);
  const decalage = (premier.getDay() + 6) % 7; // lundi = 0
  const debut = new Date(annee, mois, 1 - decalage);
  const dernier = new Date(annee, mois + 1, 0);
  const semaines: string[][] = [];
  const curseur = new Date(debut);
  while (curseur <= dernier || semaines.length === 0 || semaines[semaines.length - 1].length < 7) {
    if (!semaines.length || semaines[semaines.length - 1].length === 7) {
      if (curseur > dernier) break;
      semaines.push([]);
    }
    semaines[semaines.length - 1].push(jourIso(curseur));
    curseur.setDate(curseur.getDate() + 1);
  }
  return semaines;
}

/** Le mois d'à côté : `pas` = -1 (précédent) ou +1 (suivant). */
export function moisVoisin(annee: number, mois: number, pas: number): { annee: number; mois: number } {
  const d = new Date(annee, mois + pas, 1);
  return { annee: d.getFullYear(), mois: d.getMonth() };
}

/**
 * LA RECHERCHE DANS « POUR QUEL PROJET ? » (14/11/2026) : les projets dont le nom contient la saisie, sans tenir compte
 * de la casse ni des accents, dans leur ordre d'origine. Une saisie vide les rend tous.
 */
export function projetsQuiCorrespondent<P extends { name: string }>(projets: readonly P[], saisie: string): P[] {
  const replier = (texte: string) => minusculesSansAccents(texte).trim();
  const voulu = replier(saisie);
  if (!voulu) return [...projets];
  return projets.filter((p) => replier(p.name).includes(voulu));
}
