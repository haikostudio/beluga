/**
 * LES MORCEAUX DE LA VERSION D'AVANT RESTENT SERVIS QUELQUE TEMPS.
 *
 * Chaque mise en ligne renomme les morceaux de l'application (leur nom porte
 * une empreinte) et la publication échangeait le dossier servi en entier : les
 * anciens noms disparaissaient à l'instant. Une application restée ouverte, ou
 * installée sur un téléphone, réclame pourtant encore ses anciens morceaux —
 * « Importing a module script failed », et un écran blanc jusqu'à une relance
 * à la main (25 cas sur iPhone en cinq jours, 12/10/2026).
 *
 * On recopie donc, dans le dossier neuf, les morceaux de l'ancien qui n'y sont
 * plus : ils ne gênent personne (un nom haché ne se heurte jamais à un autre),
 * et l'écran ouvert finit son travail ou se recharge proprement.
 *
 * Deux bornes, pour que le dossier ne grossisse pas à chaque publication : une
 * DURÉE (`DUREE_DE_GARDE_MS`) et un POIDS total (`POIDS_MAX_OCTETS`, les plus
 * anciens partent d'abord). Un morceau gardé garde sa date d'origine : c'est
 * elle qui compte, il ne se « rajeunit » pas à chaque publication.
 */
import fs from 'node:fs';
import path from 'node:path';

export const DUREE_DE_GARDE_MS = 36 * 60 * 60 * 1000;
export const POIDS_MAX_OCTETS = 150 * 1024 * 1024;

/** Rend le nombre de fichiers repris de `anciens` dans `nouveaux`. */
export function garderLesMorceauxPrecedents(
  anciens: string,
  nouveaux: string,
  maintenant: number = Date.now(),
  limites: { dureeMs?: number; poidsMax?: number } = {},
): number {
  const dureeMs = limites.dureeMs ?? DUREE_DE_GARDE_MS;
  const poidsMax = limites.poidsMax ?? POIDS_MAX_OCTETS;
  if (!fs.existsSync(anciens)) return 0;
  fs.mkdirSync(nouveaux, { recursive: true });
  const dejaLa = new Set(fs.readdirSync(nouveaux));
  const candidats: { nom: string; mtimeMs: number; taille: number }[] = [];
  for (const nom of fs.readdirSync(anciens)) {
    if (dejaLa.has(nom)) continue;
    const stat = fs.statSync(path.join(anciens, nom), { throwIfNoEntry: false });
    if (!stat?.isFile()) continue;
    if (maintenant - stat.mtimeMs > dureeMs) continue;
    candidats.push({ nom, mtimeMs: stat.mtimeMs, taille: stat.size });
  }
  // Les plus récents d'abord : sous le plafond de poids, ce sont les derniers à partir.
  candidats.sort((a, b) => b.mtimeMs - a.mtimeMs);
  let poids = 0;
  let repris = 0;
  for (const c of candidats) {
    if (poids + c.taille > poidsMax) continue;
    const de = path.join(anciens, c.nom);
    const vers = path.join(nouveaux, c.nom);
    fs.copyFileSync(de, vers);
    fs.utimesSync(vers, new Date(c.mtimeMs), new Date(c.mtimeMs));
    poids += c.taille;
    repris += 1;
  }
  return repris;
}
