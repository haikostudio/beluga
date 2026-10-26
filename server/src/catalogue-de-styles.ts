import fs from 'node:fs';
import path from 'node:path';
import { CATEGORIES_DU_CATALOGUE, chercherDansLeCatalogue, creditDuStyleDuCatalogue, type StyleDuCatalogue } from '@beluga/shared';
import { CONFIG } from './config.js';
import { log } from './logger.js';

/**
 * LE CATALOGUE DE STYLES GELÉ — les 350 directions de motion design de
 * l'ancienne bibliothèque du Studio, figées le 26/10/2026 dans
 * `outils/catalogue-de-styles/catalogue.json` (plus aucun agent ni contrôle de
 * nuit ne l'enrichit). Le directeur artistique le consulte pour s'en inspirer
 * (« production » action « catalogue ») ; ses aperçus fixes restent dans
 * `data/studio/styles/` quand ils ont été téléchargés.
 */

let cache: StyleDuCatalogue[] | null = null;

export function stylesDuCatalogue(): StyleDuCatalogue[] {
  if (cache) return cache;
  try {
    const brut = JSON.parse(fs.readFileSync(path.join(CONFIG.selfPath, 'outils', 'catalogue-de-styles', 'catalogue.json'), 'utf8')) as { styles?: StyleDuCatalogue[] };
    cache = Array.isArray(brut.styles) ? brut.styles : [];
  } catch (err: any) {
    log.warn('catalogue de styles illisible', err?.message);
    cache = [];
  }
  return cache;
}

/** Le dossier des aperçus téléchargés (le dépôt principal depuis une copie de carte). */
function dossierDesApercus(): string {
  const ici = path.join(CONFIG.dataDir, 'studio', 'styles');
  return fs.existsSync(ici) ? ici : path.join(CONFIG.depotDuDemon, 'data', 'studio', 'styles');
}

/** L'aperçu fixe d'un style, s'il est sur le disque. */
export function apercuDuStyle(s: StyleDuCatalogue): string | null {
  const fixe = s.apercus?.find((f) => f.endsWith('-fixe.webp')) ?? s.apercus?.[0];
  if (!fixe) return null;
  const chemin = path.join(dossierDesApercus(), fixe);
  return fs.existsSync(chemin) ? chemin : null;
}

/** Le texte rendu au directeur : une recherche, ou le détail d'un style. */
export function texteDuCatalogue(args: { recherche?: unknown; categorie?: unknown; id?: unknown; nombre?: unknown }): string {
  const styles = stylesDuCatalogue();
  if (!styles.length) return 'Le catalogue de styles est illisible sur ce serveur.';
  const id = String(args.id ?? '').trim();
  if (id) {
    const s = styles.find((x) => x.id === id);
    if (!s) return `Style « ${id} » introuvable : cherche avec « recherche » ou « categorie ».`;
    const apercu = apercuDuStyle(s);
    return [
      `« ${s.id} » — ${s.titre} : ${s.phrase}`,
      `Catégories : ${s.categories.join(', ') || 'aucune'} · crédit : ${creditDuStyleDuCatalogue(s)}`,
      ...(apercu ? [`Aperçu (image fixe, lis-la) : ${apercu}`] : []),
      'Direction (inspire-toi, ne recopie pas) :',
      s.consigne.length > 6000 ? `${s.consigne.slice(0, 6000)}…` : s.consigne,
    ].join('\n');
  }
  const categorie = String(args.categorie ?? '').trim() || undefined;
  if (categorie && !CATEGORIES_DU_CATALOGUE.some((c) => c.id === categorie)) {
    return `Catégorie inconnue. Catégories : ${CATEGORIES_DU_CATALOGUE.map((c) => `« ${c.id} » (${c.libelle})`).join(', ')}.`;
  }
  const trouves = chercherDansLeCatalogue(styles, String(args.recherche ?? ''), { ...(categorie ? { categorie } : {}), nombre: Number(args.nombre) || 6 });
  if (!trouves.length) return 'Aucun style du catalogue ne répond à cette recherche : élargis-la, ou choisis une catégorie.';
  return [
    `${trouves.length} style(s) du catalogue gelé (${styles.length} en tout) — des directions dont t’inspirer, jamais à recopier dans le livrable :`,
    ...trouves.map((s) => `- « ${s.id} » ${s.titre} [${s.categories.join(', ')}] : ${s.phrase}`),
    'Le détail d’un style (direction complète, aperçu) : « catalogue » avec « id ».',
  ].join('\n');
}
