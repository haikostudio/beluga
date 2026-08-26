import crypto from 'node:crypto';
import {
  DELAI_REPONSE_MS,
  PERIODE_SURVEILLANCE_MS,
  SITES_MAX,
  type SiteSurveille,
  bascule,
  dejaSurveille,
  doitVerifier,
  jugerAdresse,
  jugerReponse,
  texteAlerte,
} from '@haikodev/shared';
import { getDb } from './db.js';
import { bus } from './bus.js';
import { log } from './logger.js';
import { notify } from './notify.js';

/**
 * LA SURVEILLANCE DES SITES — les appels, et le rangement sur le disque.
 *
 * Les règles qui se décident sans base ni réseau vivent dans
 * `shared/src/surveillance.ts` : ce qui fait une panne, ce qui bascule, ce
 * qu'une adresse doit valoir. Ici : la table, les appels, l'alerte.
 *
 * DEUX PRINCIPES QUI NE BOUGENT PAS.
 *
 *  1. **UNE ALERTE PAR CHUTE, PAS UNE PAR TOURNÉE.** Un site tombé qui reste
 *     tombé ne réveille plus personne : seule la BASCULE pousse une
 *     notification. Le retour à la normale, lui, ne pousse rien — il se lit sur
 *     la pastille qui s'éteint et sur le bandeau de la fenêtre.
 *  2. **AUCUNE TOURNÉE NE PEUT FAIRE TOMBER LE DÉMON.** Chaque appel est
 *     enveloppé : un site injoignable est un RÉSULTAT, pas une exception, et
 *     une tournée qui casse se journalise sans emporter le minuteur.
 */

interface LigneSite {
  id: string;
  url: string;
  nom: string;
  etat: string;
  code: number | null;
  raison: string | null;
  verifie_le: number;
  depuis: number;
  derniere_panne: number;
  cree_le: number;
}

function depuisLigne(ligne: LigneSite): SiteSurveille {
  return {
    id: ligne.id,
    url: ligne.url,
    nom: ligne.nom,
    etat: (ligne.etat as SiteSurveille['etat']) ?? 'inconnu',
    code: ligne.code ?? undefined,
    raison: (ligne.raison as SiteSurveille['raison']) ?? undefined,
    verifieLe: ligne.verifie_le,
    depuis: ligne.depuis,
    dernierePanne: ligne.derniere_panne,
    creeLe: ligne.cree_le,
  };
}

/** Toutes les adresses surveillées : les tombées d'abord, puis par date d'ajout. */
export function listerSites(): SiteSurveille[] {
  const lignes = getDb()
    .prepare('SELECT * FROM sites_surveilles ORDER BY cree_le ASC')
    .all() as LigneSite[];
  const sites = lignes.map(depuisLigne);
  // Ce qui ne va pas se lit en premier : c'est la seule raison d'ouvrir cette
  // fenêtre quand la pastille est allumée.
  return [...sites.filter((s) => s.etat === 'panne'), ...sites.filter((s) => s.etat !== 'panne')];
}

/** Prévenir les onglets ouverts : la pastille et la liste suivent sans recharger. */
function diffuser(): void {
  bus.emit({ type: 'surveillance', sites: listerSites() });
}

export type AjoutSite = { ok: true; site: SiteSurveille } | { ok: false; raison: string };

/**
 * Ajoute une adresse. Elle est APPELÉE TOUT DE SUITE, en tâche de fond : ajouter
 * un site puis attendre une heure pour savoir s'il répond serait une fenêtre qui
 * ne dit rien.
 */
export function ajouterSite(brutUrl: unknown, brutNom?: unknown, maintenant = Date.now()): AjoutSite {
  const juge = jugerAdresse(brutUrl, brutNom);
  if (!juge.ok) return { ok: false, raison: juge.raison };

  const existants = listerSites();
  if (existants.length >= SITES_MAX)
    return { ok: false, raison: `Pas plus de ${SITES_MAX} adresses surveillées.` };
  if (dejaSurveille(existants, juge.url)) return { ok: false, raison: 'Cette adresse est déjà surveillée.' };

  const site: SiteSurveille = {
    id: crypto.randomUUID(),
    url: juge.url,
    nom: juge.nom,
    etat: 'inconnu',
    verifieLe: 0,
    depuis: maintenant,
    dernierePanne: 0,
    creeLe: maintenant,
  };
  getDb()
    .prepare(
      'INSERT INTO sites_surveilles (id, url, nom, etat, verifie_le, depuis, derniere_panne, cree_le) VALUES (?, ?, ?, ?, 0, ?, 0, ?)',
    )
    .run(site.id, site.url, site.nom, site.etat, site.depuis, site.creeLe);
  log.info(`surveillance : « ${site.nom} » ajouté (${site.url})`);
  diffuser();
  void verifierSites([site.id]);
  return { ok: true, site };
}

/** Retire une adresse. La pastille se recalcule aussitôt. */
export function supprimerSite(id: string): { ok: boolean; raison?: string } {
  const res = getDb().prepare('DELETE FROM sites_surveilles WHERE id = ?').run(id);
  if (!res.changes) return { ok: false, raison: 'Adresse introuvable.' };
  diffuser();
  return { ok: true };
}

/**
 * UN SEUL APPEL, sans exception qui remonte. Le contenu est lu pour savoir s'il
 * est VIDE — la carte le demande — mais jamais gardé : ni journal, ni copie de
 * page. On s'arrête au premier mégaoctet, largement de quoi trancher.
 */
const TAILLE_LUE_MAX = 1_000_000;

async function appeler(url: string): Promise<ReturnType<typeof jugerReponse>> {
  const controle = new AbortController();
  const minuteur = setTimeout(() => controle.abort(), DELAI_REPONSE_MS);
  try {
    const reponse = await fetch(url, {
      redirect: 'follow',
      signal: controle.signal,
      headers: { 'user-agent': 'HaikoDev-surveillance/1.0', accept: '*/*' },
    });
    let taille = 0;
    try {
      const texte = await reponse.text();
      taille = texte.slice(0, TAILLE_LUE_MAX).trim().length;
    } catch {
      // Un corps illisible sur une réponse correcte ne fait pas une panne : le
      // serveur a répondu, c'est ce qu'on mesure.
      taille = reponse.ok ? 1 : 0;
    }
    return jugerReponse({ statut: reponse.status, taille });
  } catch (err) {
    const abandon = (err as { name?: string })?.name === 'AbortError';
    return jugerReponse(abandon ? { delaiDepasse: true } : { erreur: String(err).slice(0, 200) });
  } finally {
    clearTimeout(minuteur);
  }
}

/**
 * Une tournée. Sans liste d'identifiants, elle prend les sites DUS ; avec, elle
 * appelle ceux-là quoi qu'il arrive (bouton « Vérifier maintenant », ajout).
 *
 * Les appels partent ENSEMBLE : cinquante sites à quinze secondes de délai
 * feraient sinon plus de douze minutes de tournée.
 */
export async function verifierSites(ids?: string[], maintenant = Date.now()): Promise<SiteSurveille[]> {
  const tous = listerSites();
  const cibles = ids?.length
    ? tous.filter((site) => ids.includes(site.id))
    : tous.filter((site) => doitVerifier(site, maintenant, PERIODE_SURVEILLANCE_MS));
  if (!cibles.length) return [];

  const verdicts = await Promise.all(
    cibles.map(async (site) => ({ site, verdict: await appeler(site.url) })),
  );

  const db = getDb();
  const tombes: SiteSurveille[] = [];
  const retablis: SiteSurveille[] = [];
  const instant = Date.now();

  for (const { site, verdict } of verdicts) {
    const change = bascule(site.etat, verdict.etat);
    const depuis = change ? instant : site.depuis || instant;
    const dernierePanne = verdict.etat === 'panne' ? instant : site.dernierePanne;
    db.prepare(
      'UPDATE sites_surveilles SET etat = ?, code = ?, raison = ?, verifie_le = ?, depuis = ?, derniere_panne = ? WHERE id = ?',
    ).run(verdict.etat, verdict.code ?? null, verdict.raison ?? null, instant, depuis, dernierePanne, site.id);

    const apres: SiteSurveille = {
      ...site,
      etat: verdict.etat,
      code: verdict.code,
      raison: verdict.raison,
      verifieLe: instant,
      depuis,
      dernierePanne,
    };
    if (change === 'tombe') tombes.push(apres);
    if (change === 'retabli') retablis.push(apres);
  }

  for (const site of tombes) {
    const texte = texteAlerte(site);
    log.warn(`surveillance : ${site.nom} est tombé (${texte.corps})`);
    notify({
      motif: 'site-indisponible',
      title: texte.titre,
      body: texte.corps,
      // Une seule alerte par site : deux chutes du même site à quelques
      // secondes d'intervalle ne font qu'un événement.
      reference: `site:${site.id}`,
      element: site.nom,
    });
  }
  for (const site of retablis) {
    /*
     * Un retour à la normale ne pousse RIEN et n'affiche aucun message passager
     * (TROIS GENRES ALERTENT, pas un de plus : une confirmation se tait). Il se
     * lit là où on le cherche — la pastille du menu qui s'éteint, et le bandeau
     * d'apaisement en tête de la fenêtre.
     */
    log.info(`surveillance : ${site.nom} répond de nouveau`);
  }

  diffuser();
  return listerSites();
}

/**
 * LE MINUTEUR. Il bat toutes les cinq minutes, mais n'appelle que les sites DUS
 * (une heure) : une adresse ajoutée à 14 h 03 est revue à 15 h 03, sans qu'on
 * ait besoin d'un minuteur par site. La première tournée part vingt secondes
 * après le démarrage — le temps que le démon finisse de s'installer.
 */
const BATTEMENT_MS = 5 * 60_000;

export function demarrerSurveillance(): NodeJS.Timeout {
  const tour = () => {
    verifierSites().catch((err) => log.warn('surveillance : tournée impossible', err));
  };
  setTimeout(tour, 20_000).unref?.();
  const minuteur = setInterval(tour, BATTEMENT_MS);
  minuteur.unref?.();
  return minuteur;
}
