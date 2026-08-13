import crypto from 'node:crypto';
import {
  CleApi,
  CleApiPublique,
  OCTETS_DE_CLE_API,
  PREFIXE_CLE_API,
  apercuDeCle,
  cleApiPublique,
  jugerNomDeCle,
} from '@haikodev/shared';
import { getDb } from './db.js';
import { log } from './logger.js';

/**
 * LES CLÉS D'API : leur fabrication et leur rangement.
 *
 * Les règles qui se décident sans base vivent dans `shared/src/cles-api.ts`.
 * Ici, ce qui touche au disque et au hasard : tirer un secret, en garder
 * l'empreinte, retrouver une clé, la révoquer.
 *
 * Le secret n'est JAMAIS conservé — ni dans la base, ni dans le journal. Il est
 * rendu une seule fois, à celui qui vient de le fabriquer ; perdu, il ne se
 * retrouve pas, il se remplace.
 */

interface LigneCle {
  id: string;
  nom: string;
  apercu: string;
  empreinte: string;
  creee_le: number;
  revoquee_le: number | null;
  dernier_usage_le: number | null;
  cartes_creees: number;
}

function depuisLigne(ligne: LigneCle): CleApi {
  return {
    id: ligne.id,
    nom: ligne.nom,
    apercu: ligne.apercu,
    empreinte: ligne.empreinte,
    creeeLe: ligne.creee_le,
    revoqueeLe: ligne.revoquee_le ?? undefined,
    dernierUsageLe: ligne.dernier_usage_le ?? undefined,
    cartesCreees: ligne.cartes_creees,
  };
}

/** L'empreinte d'un secret. Calculée SUR LE SERVEUR, jamais transmise. */
export function empreinteDeCle(secret: string): string {
  return crypto.createHash('sha256').update(secret, 'utf8').digest('hex');
}

/** Toutes les clés, la plus récente d'abord — révoquées comprises. */
export function listerClesApi(): CleApiPublique[] {
  const lignes = getDb()
    .prepare('SELECT * FROM api_keys ORDER BY creee_le DESC')
    .all() as LigneCle[];
  return lignes.map((l) => cleApiPublique(depuisLigne(l)));
}

export type CreationDeCle =
  | { ok: true; cle: CleApiPublique; secret: string }
  | { ok: false; raison: string };

/**
 * Fabrique une clé. Le secret rendu ici est la SEULE fois où il existe en
 * clair : l'interface le montre, puis il n'est plus lisible nulle part.
 */
export function creerCleApi(nomBrut: unknown, maintenant = Date.now()): CreationDeCle {
  const juge = jugerNomDeCle(nomBrut);
  if (!juge.ok) return { ok: false, raison: juge.raison };

  const secret = PREFIXE_CLE_API + crypto.randomBytes(OCTETS_DE_CLE_API).toString('hex');
  const cle: CleApi = {
    id: crypto.randomUUID(),
    nom: juge.nom,
    apercu: apercuDeCle(secret),
    empreinte: empreinteDeCle(secret),
    creeeLe: maintenant,
    cartesCreees: 0,
  };
  getDb()
    .prepare(
      'INSERT INTO api_keys (id, nom, apercu, empreinte, creee_le, cartes_creees) VALUES (?, ?, ?, ?, ?, 0)',
    )
    .run(cle.id, cle.nom, cle.apercu, cle.empreinte, cle.creeeLe);
  log.info(`clé d'API créée pour « ${cle.nom} »`);
  return { ok: true, cle: cleApiPublique(cle), secret };
}

/** La clé rangée qui porte cette empreinte, ou rien. */
export function cleParSecret(secret: string): CleApi | undefined {
  const ligne = getDb()
    .prepare('SELECT * FROM api_keys WHERE empreinte = ?')
    .get(empreinteDeCle(secret)) as LigneCle | undefined;
  return ligne ? depuisLigne(ligne) : undefined;
}

/**
 * Révoque une clé : on DATE la révocation, on n'efface pas la ligne. La clé
 * garde son nom et son compteur, et l'appel suivant est refusé.
 */
export function revoquerCleApi(id: string, maintenant = Date.now()): CleApiPublique | null {
  const ligne = getDb().prepare('SELECT * FROM api_keys WHERE id = ?').get(id) as LigneCle | undefined;
  if (!ligne) return null;
  if (!ligne.revoquee_le) {
    getDb().prepare('UPDATE api_keys SET revoquee_le = ? WHERE id = ?').run(maintenant, id);
    log.info(`clé d'API révoquée : « ${ligne.nom} »`);
  }
  return cleApiPublique(depuisLigne({ ...ligne, revoquee_le: ligne.revoquee_le ?? maintenant }));
}

/** Efface une clé DÉJÀ révoquée de la liste. Une clé vivante ne s'efface pas : elle se révoque. */
export function oublierCleApi(id: string): { ok: boolean; raison?: string } {
  const ligne = getDb().prepare('SELECT * FROM api_keys WHERE id = ?').get(id) as LigneCle | undefined;
  if (!ligne) return { ok: false, raison: 'Clé introuvable.' };
  if (!ligne.revoquee_le) return { ok: false, raison: "Révoquez d'abord cette clé." };
  getDb().prepare('DELETE FROM api_keys WHERE id = ?').run(id);
  return { ok: true };
}

/** Note un appel accepté : la date du dernier usage et le compte des cartes créées. */
export function noterUsageDeCle(id: string, maintenant = Date.now()): void {
  getDb()
    .prepare('UPDATE api_keys SET dernier_usage_le = ?, cartes_creees = cartes_creees + 1 WHERE id = ?')
    .run(maintenant, id);
}
