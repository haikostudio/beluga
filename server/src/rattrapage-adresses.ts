/**
 * LE RATTRAPAGE DES ADRESSES DE CONTRÔLE, JOUÉ UNE FOIS (30/09/2026).
 *
 * Les adresses du relevé (`<données>/rattrapage-adresses-de-controle.json`,
 * `{ "<projectId>": { "nom", "dev"?, "production"? } }`) ont été relevées le
 * 30/09/2026 sur ce serveur, projet
 * par projet : vhost Caddy du port du projet pour la version de travail
 * (`devUrl`), dépôt du projet, processus déjà écrit et compétences pour le
 * site public (`adresseProduction`). Chacune répondait ce jour-là. Elles sont
 * RE-CONTRÔLÉES ici avant d'être écrites : une adresse qui ne répond plus
 * (erreur réseau ou 5xx) n'est pas inscrite — une adresse de contrôle fausse
 * ferait échouer chaque déploiement.
 *
 * `patchDeRattrapage` (shared) décide : un réglage déjà rempli n'est jamais
 * touché, l'adresse publique porte la marque `adresseProductionRattrapee`, qui
 * n'ouvre AUCUN suivi des visites. Joué au démarrage, sans être attendu ; la
 * marque `META_RATTRAPAGE` empêche qu'il se rejoue. Un projet absent de cette
 * base (démon d'essai) n'est simplement pas trouvé.
 *
 * Les projets restés sans adresse la recevront de l'agent de configuration,
 * quand il écrira son processus.
 */
import fs from 'node:fs';
import path from 'node:path';
import { patchDeRattrapage, type AdressesARattraper } from '@beluga/shared';
import * as store from './store.js';
import { bus } from './bus.js';
import { log } from './logger.js';
import { getMeta, setMeta } from './db.js';
import { CONFIG } from './config.js';

const META_RATTRAPAGE = 'rattrapage-adresses-de-controle-2026-09-30';

/**
 * LE RELEVÉ vit dans les DONNÉES du serveur, jamais dans le code : le dossier
 * `server/` part tel quel au dépôt public, et la liste des sites des projets
 * n'a rien à y faire. Absent (démon d'essai, autre machine) : rien n'est fait,
 * et rien n'est marqué — le relevé posé plus tard sera joué au démarrage suivant.
 */
export const FICHIER_RELEVE = 'rattrapage-adresses-de-controle.json';

function lireLeReleve(): Record<string, AdressesARattraper> | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(CONFIG.dataDir, FICHIER_RELEVE), 'utf8')) as Record<string, AdressesARattraper>;
  } catch {
    return null;
  }
}

/** L'adresse répond-elle ? Toute réponse sous 500 compte, redirection comprise. */
async function repond(adresse: string, lecteur: typeof fetch): Promise<boolean> {
  try {
    const res = await lecteur(adresse, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(10_000) });
    return res.status > 0 && res.status < 500;
  } catch {
    return false;
  }
}

export async function rattraperLesAdressesDeControle(
  lecteur: typeof fetch = fetch,
  releve: Record<string, AdressesARattraper> | null = lireLeReleve(),
): Promise<{ ecrits: string[]; laisses: string[] } | null> {
  if (!releve || getMeta(META_RATTRAPAGE)) return null;
  const ecrits: string[] = [];
  const laisses: string[] = [];
  for (const [projectId, adresses] of Object.entries(releve)) {
    const projet = store.getProject(projectId);
    if (!projet || projet.archived) continue;
    const joignables = new Set<string>();
    for (const adresse of [adresses.dev, adresses.production]) {
      if (!adresse) continue;
      if (await repond(adresse, lecteur)) joignables.add(adresse);
      else laisses.push(`${projet.name} : ${adresse} ne répond pas`);
    }
    /* Relu juste avant d'écrire : un réglage fait entre-temps à l'écran gagne. */
    const frais = store.getProject(projectId);
    const patch = patchDeRattrapage(frais ?? undefined, adresses, (a) => joignables.has(a));
    if (!frais || !patch) continue;
    const enregistre = store.saveProject({ ...frais, ...patch });
    bus.emit({ type: 'project.upsert', project: enregistre });
    ecrits.push(
      `${projet.name} :${patch.devUrl ? ` travail ${patch.devUrl}` : ''}${patch.adresseProduction ? ` production ${patch.adresseProduction}` : ''}`,
    );
  }
  setMeta(META_RATTRAPAGE, JSON.stringify({ le: Date.now(), ecrits: ecrits.length, laisses: laisses.length }));
  for (const ligne of ecrits) log.info(`adresse de contrôle rattrapée — ${ligne}`);
  for (const ligne of laisses) log.warn(`adresse de contrôle non rattrapée — ${ligne}`);
  return { ecrits, laisses };
}
