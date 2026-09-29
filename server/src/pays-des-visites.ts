import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { Reader, type CountryResponse } from 'mmdb-lib';
import { codePaysValide } from '@beluga/shared';
import { CONFIG } from './config.js';
import { log } from './logger.js';

/**
 * LE PAYS D'UNE VISITE, SANS GARDER L'ADRESSE (demande du 28/09/2026).
 *
 * Le pays se déduit de l'adresse IP AU MOMENT de la collecte, puis l'adresse
 * est jetée : seul le code ISO (« FR », « CH ») est écrit avec l'événement
 * (`marketing_evenements.pays`). Deux sources, dans l'ordre :
 *
 *  1. l'entête `CF-IPCountry`, quand un relais Cloudflare le pose ;
 *  2. la base locale GRATUITE « IP to Country Lite » de DB-IP (licence
 *     CC BY 4.0 — l'écran cite « DB-IP » sous le bloc des pays), au format
 *     MaxMind, lue UNE fois en mémoire (~8 Mo) par `mmdb-lib`.
 *
 * La base vit dans `<données>/geo/` — jamais dans le dépôt. Le démon la
 * télécharge seul si elle manque ou date de plus de 35 jours (DB-IP la publie
 * chaque mois) ; `BELUGA_BASE_PAYS=0` coupe ce téléchargement. Sans base, les
 * visites arrivent sans pays : rien ne casse.
 */

export const FICHIER_BASE_PAYS = path.join(CONFIG.dataDir, 'geo', 'dbip-country-lite.mmdb');
const AGE_MAX_MS = 35 * 86_400_000;

let lecteur: Reader<CountryResponse> | null = null;
let lecteurDate = 0;

function chargerLecteur(): typeof lecteur {
  try {
    const stat = fs.statSync(FICHIER_BASE_PAYS);
    if (lecteur && stat.mtimeMs === lecteurDate) return lecteur;
    lecteur = new Reader<CountryResponse>(fs.readFileSync(FICHIER_BASE_PAYS));
    lecteurDate = stat.mtimeMs;
  } catch {
    lecteur = null;
  }
  return lecteur;
}

/** L'adresse telle que la base la lit : sans préfixe IPv4-dans-IPv6 ni port. */
function adresseNette(ip: string): string | null {
  let a = ip.trim();
  if (a.startsWith('::ffff:')) a = a.slice(7);
  if (/^\d+\.\d+\.\d+\.\d+:\d+$/.test(a)) a = a.split(':')[0];
  if (!a || a === 'inconnu') return null;
  // Adresses privées ou locales : aucun pays.
  if (/^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1$|fc|fd|fe80)/i.test(a)) return null;
  return a;
}

/**
 * LE CODE PAYS d'une requête, ou `undefined`. L'adresse n'est lue que le temps
 * de cette fonction ; elle n'est ni rendue, ni écrite, ni journalisée.
 */
export function paysDeLaRequete(ip: string, entetePays?: string | string[]): string | undefined {
  const cf = codePaysValide(Array.isArray(entetePays) ? entetePays[0] : entetePays);
  if (cf) return cf;
  const adresse = adresseNette(ip);
  if (!adresse) return undefined;
  try {
    return codePaysValide(chargerLecteur()?.get(adresse)?.country?.iso_code) ?? undefined;
  } catch {
    return undefined;
  }
}

/** L'adresse du fichier du mois (DB-IP), en UTC. */
function adresseDuMois(instant: number): string {
  const mois = new Date(instant).toISOString().slice(0, 7);
  return `https://download.db-ip.com/free/dbip-country-lite-${mois}.mmdb.gz`;
}

let telechargementEnCours = false;

/**
 * TÉLÉCHARGE LA BASE si elle manque ou a vieilli : le fichier du mois, ou
 * celui du mois précédent en début de mois (publié quelques jours après).
 * Écrit à côté puis renommé : un lecteur ne voit jamais un fichier à moitié.
 */
export async function assurerLaBaseDesPays(maintenant = Date.now()): Promise<boolean> {
  if (process.env.BELUGA_BASE_PAYS === '0' || telechargementEnCours) return false;
  try {
    const stat = fs.statSync(FICHIER_BASE_PAYS);
    if (maintenant - stat.mtimeMs < AGE_MAX_MS) return false;
  } catch {
    /* absente : on la télécharge */
  }
  telechargementEnCours = true;
  try {
    for (const adresse of [adresseDuMois(maintenant), adresseDuMois(maintenant - 28 * 86_400_000)]) {
      const r = await fetch(adresse, { signal: AbortSignal.timeout(60_000) }).catch(() => null);
      if (!r?.ok) continue;
      const brut = zlib.gunzipSync(Buffer.from(await r.arrayBuffer()));
      new Reader(brut); // un fichier illisible ne remplace jamais le précédent
      fs.mkdirSync(path.dirname(FICHIER_BASE_PAYS), { recursive: true });
      const provisoire = `${FICHIER_BASE_PAYS}.part`;
      fs.writeFileSync(provisoire, brut);
      fs.renameSync(provisoire, FICHIER_BASE_PAYS);
      log.info(`statistiques : base des pays à jour (${adresse.split('/').pop()})`);
      return true;
    }
    log.warn('statistiques : base des pays introuvable chez DB-IP, les visites arrivent sans pays');
    return false;
  } catch (err) {
    log.warn('statistiques : base des pays non téléchargée', err);
    return false;
  } finally {
    telechargementEnCours = false;
  }
}
