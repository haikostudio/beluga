import fs from 'node:fs';
import {
  type EtatDuTravail,
  type IdServiceCreation,
  type ModeleVideoDeService,
  type RatioClip,
  type ServiceDeCreation,
  SERVICES_CREATION,
  adresseDeSuivi,
  cleAssemblee,
  cleDuModeleVideo,
  entetesDuService,
  lireCreationDeClip,
  lireResultatFal,
  lireSuiviDeClip,
  modeleVideoDeService,
  nomDeFicheDuService,
  plafondFal,
  requeteDeCreation,
  requeteDeTest,
  serviceDeCreation,
  verdictDuTest,
} from '@beluga/shared';
import { enregistrerAcces, listerAcces, supprimerAcces } from './coffre-fort.js';
import { getMeta, setMeta } from './db.js';
import { log } from './logger.js';

/**
 * LES SERVICES DE CRÉATION BRANCHÉS PAR L'UTILISATEUR — côté serveur : la clé
 * de chaque service vit dans le coffre-fort (UNE fiche par service, nommée
 * « Studio — <Service> »), son dernier test dans la méta, et les appels
 * passent par ici. Les règles (catalogue, demandes, lecture des réponses)
 * sont dans `shared/src/studio-services.ts`.
 *
 * AUCUN APPEL PAYANT NE PART D'ICI SANS DÉPENSE VALIDÉE : `fabriquerClipChezLeService`
 * n'est appelé que par `lancerGenerationValidee`, après `raisonDepenseRefusee`.
 * Le test d'une clé est une lecture gratuite (liste, compte, travail inexistant).
 */

const cleDuTest = (id: IdServiceCreation) => `studio.service.test.${id}`;

interface TestDeService {
  ok: boolean;
  raison?: string;
  le: number;
}

function ficheDuService(service: ServiceDeCreation) {
  const nom = nomDeFicheDuService(service);
  return listerAcces().find((a) => a.nom === nom && a.type === 'cle-api' && typeof a.champs?.cle === 'string' && a.champs.cle.trim());
}

/** La clé branchée d'un service, ou rien. Elle ne sort JAMAIS vers l'écran. */
export function cleDuService(id: IdServiceCreation): string | undefined {
  const service = serviceDeCreation(id);
  if (!service) return undefined;
  try {
    return ficheDuService(service)?.champs.cle.trim();
  } catch {
    return undefined;
  }
}

/** Les services dont une clé est branchée. */
export function servicesBranches(): IdServiceCreation[] {
  return SERVICES_CREATION.filter((s) => !!cleDuService(s.id)).map((s) => s.id);
}

/** Les services VIDÉO branchés (OpenRouter sert la voix et la musique, pas les extraits). */
export function servicesVideoBranches(): IdServiceCreation[] {
  return servicesBranches().filter((id) => (serviceDeCreation(id)?.modeles.length ?? 0) > 0);
}

function dernierTest(id: IdServiceCreation): TestDeService | null {
  try {
    const brut = getMeta(cleDuTest(id));
    return brut ? (JSON.parse(brut) as TestDeService) : null;
  } catch {
    return null;
  }
}

/** Ce que la rubrique « Services de création » affiche : jamais la clé, seulement ses quatre derniers signes. */
export function etatDesServices() {
  return SERVICES_CREATION.map((s) => {
    const cle = cleDuService(s.id);
    const test = cle ? dernierTest(s.id) : null;
    return {
      id: s.id,
      nom: s.nom,
      description: s.description,
      adresseCle: s.adresseCle,
      champs: s.champs,
      modeles: s.modeles,
      branche: !!cle,
      fin: cle ? cle.slice(-4) : null,
      test,
    };
  });
}

async function appeler(requete: { methode: string; adresse: string; entetes: Record<string, string>; corps?: unknown }, delai = 20_000): Promise<{ statut: number; corps: any }> {
  const r = await fetch(requete.adresse, {
    method: requete.methode,
    headers: requete.entetes,
    ...(requete.corps !== undefined ? { body: JSON.stringify(requete.corps) } : {}),
    signal: AbortSignal.timeout(delai),
  });
  const texte = await r.text().catch(() => '');
  let corps: any = texte;
  try {
    corps = texte ? JSON.parse(texte) : {};
  } catch {
    /* une page d'erreur en HTML reste du texte */
  }
  return { statut: r.status, corps };
}

async function testerUneCle(id: IdServiceCreation, cle: string): Promise<TestDeService> {
  try {
    const { statut } = await appeler(requeteDeTest(id, cle), 15_000);
    return { ...verdictDuTest(id, statut), le: Date.now() };
  } catch (err: any) {
    return { ok: false, raison: `le service ne répond pas (${String(err?.message ?? err).slice(0, 120)})`, le: Date.now() };
  }
}

/**
 * BRANCHER UN SERVICE : la clé est d'abord TESTÉE (lecture gratuite). Une clé
 * que le service refuse n'est pas rangée ; une panne passagère du service,
 * elle, laisse la clé rangée et le dit.
 */
export async function enregistrerService(id: string, champs: Record<string, unknown>): Promise<{ ok: true; test: TestDeService } | { ok: false; raison: string }> {
  const service = serviceDeCreation(id);
  if (!service) return { ok: false, raison: 'service inconnu' };
  const cle = cleAssemblee(service, champs);
  if (!cle) return { ok: false, raison: service.champs.length > 1 ? 'il faut l’identifiant ET le secret de la clé' : 'la clé est vide' };
  const test = await testerUneCle(service.id, cle);
  if (!test.ok && /refuse cette clé/.test(test.raison ?? '')) return { ok: false, raison: test.raison! };
  const existante = ficheDuService(service);
  const r = enregistrerAcces({
    ...(existante ? { id: existante.id } : {}),
    nom: nomDeFicheDuService(service),
    type: 'cle-api',
    projectId: null,
    champs: { service: service.nom, cle, adresse: service.adresseCle },
    note: 'Branchée depuis les paramètres, rubrique « Services de création » : le Studio s’en sert pour fabriquer les extraits (ou, pour OpenRouter, la voix finale et la musique).',
  });
  if (!r.ok) return { ok: false, raison: r.raison };
  setMeta(cleDuTest(service.id), JSON.stringify(test));
  log.info(`studio : service « ${service.nom} » branché (${test.ok ? 'clé acceptée' : `à revoir : ${test.raison}`})`);
  return { ok: true, test };
}

export async function testerService(id: string): Promise<TestDeService> {
  const service = serviceDeCreation(id);
  if (!service) throw new Error('service inconnu');
  const cle = cleDuService(service.id);
  if (!cle) throw new Error('aucune clé branchée pour ce service');
  const test = await testerUneCle(service.id, cle);
  setMeta(cleDuTest(service.id), JSON.stringify(test));
  return test;
}

/** Retirer un service : sa fiche est ARCHIVÉE six mois (le coffre n'efface pas), plus rien ne s'en sert. */
export function retirerService(id: string): { ok: boolean; raison?: string } {
  const service = serviceDeCreation(id);
  if (!service) return { ok: false, raison: 'service inconnu' };
  const fiche = ficheDuService(service);
  if (!fiche) return { ok: true };
  const r = supprimerAcces(fiche.id);
  if (r.ok) setMeta(cleDuTest(service.id), '');
  return r;
}

/* ------------------------------------------------------------------ */
/* Le modèle vidéo retenu pour une création                             */
/* ------------------------------------------------------------------ */

export interface ModeleVideoRetenu {
  service: IdServiceCreation;
  modele: string;
}

export function modeleVideoRetenu(creationId: string): ModeleVideoRetenu | null {
  try {
    const brut = getMeta(cleDuModeleVideo(creationId));
    if (!brut) return null;
    const m = JSON.parse(brut) as ModeleVideoRetenu;
    return modeleVideoDeService(m.service, m.modele) ? m : null;
  } catch {
    return null;
  }
}

export function retenirModeleVideo(creationId: string, service: string, modele: string): { ok: true; retenu: ModeleVideoRetenu; nom: string } | { ok: false; raison: string } {
  const s = serviceDeCreation(service);
  const m = modeleVideoDeService(service, modele);
  if (!s || !m) return { ok: false, raison: 'ce modèle n’est pas au catalogue des services de création' };
  if (!cleDuService(s.id)) return { ok: false, raison: `${s.nom} n’est pas branché : ajoutez sa clé dans les paramètres, rubrique « Services de création »` };
  const retenu = { service: s.id, modele: m.id };
  setMeta(cleDuModeleVideo(creationId), JSON.stringify(retenu));
  return { ok: true, retenu, nom: `${m.nom} (${s.nom})` };
}

/* ------------------------------------------------------------------ */
/* Le prix, quand le service le publie                                  */
/* ------------------------------------------------------------------ */

/**
 * Le plafond d'un extrait : fal.ai PUBLIE ses prix (lus en direct) ; les autres
 * services n'ont pas de lecture de prix par l'API — le devis dit alors « prix
 * non publié », jamais un chiffre inventé.
 */
export async function plafondDuClip(service: IdServiceCreation, modele: string, duree: number): Promise<number | null> {
  if (service !== 'fal') return null;
  const cle = cleDuService('fal');
  if (!cle) return null;
  try {
    const { statut, corps } = await appeler({ methode: 'GET', adresse: `https://api.fal.ai/v1/models/pricing?endpoint_id=${encodeURIComponent(modele)}`, entetes: entetesDuService('fal', cle) }, 15_000);
    if (statut !== 200) return null;
    return plafondFal(corps?.prices?.find((p: any) => p.endpoint_id === modele), duree);
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* La fabrication d'un extrait — APRÈS une dépense validée seulement    */
/* ------------------------------------------------------------------ */

/** Le rythme du suivi : une lecture toutes les 8 s, 20 minutes au plus (réglable par les tests seulement). */
export const RYTHME_DU_SUIVI = { pauseMs: 8_000, delaiMaxMs: 20 * 60_000 };

/**
 * Lance l'extrait chez le service, le SUIT jusqu'au bout (délai borné), puis
 * le TÉLÉCHARGE dans `fichier`. Une panne se dit avec sa raison ; elle ne
 * débite rien côté Beluga.
 */
export async function fabriquerClipChezLeService(
  entree: { service: IdServiceCreation; modele: ModeleVideoDeService; consigne: string; duree: number; ratio: RatioClip | null; son: boolean },
  fichier: string,
  attente: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<void> {
  const cle = cleDuService(entree.service);
  if (!cle) throw new Error(`${serviceDeCreation(entree.service)?.nom ?? entree.service} n’est plus branché : sa clé a été retirée`);
  const creation = await appeler(
    requeteDeCreation(entree.service, entree.modele.id, cle, { consigne: entree.consigne, duree: entree.duree, ratio: entree.ratio, son: entree.son }),
    60_000,
  );
  let etat: EtatDuTravail = lireCreationDeClip(entree.service, entree.modele.id, creation.statut, creation.corps);
  const fin = Date.now() + RYTHME_DU_SUIVI.delaiMaxMs;
  while (etat.etat === 'attente') {
    if (Date.now() > fin) throw new Error('le service n’a pas rendu l’extrait en 20 minutes : il se retrouve peut-être plus tard dans votre compte chez lui');
    await attente(RYTHME_DU_SUIVI.pauseMs);
    const suivi = etat.suivi;
    const r = await appeler({ methode: 'GET', adresse: adresseDeSuivi(entree.service, suivi), entetes: entetesDuService(entree.service, cle) }, 30_000).catch(() => ({ statut: 503, corps: {} }));
    etat = lireSuiviDeClip(entree.service, r.statut, r.corps, suivi);
    if (etat.etat === 'fini' && entree.service === 'fal') {
      const resultat = await appeler({ methode: 'GET', adresse: suivi.split('\n')[1]!, entetes: entetesDuService('fal', cle) }, 30_000);
      etat = resultat.statut === 200 ? lireResultatFal(resultat.corps) : { etat: 'echec', raison: `fal.ai n’a pas rendu le résultat (${resultat.statut})` };
    }
  }
  if (etat.etat === 'echec') throw new Error(etat.raison);
  // Replicate sert ses fichiers derrière la même clé ; les autres, par une adresse signée.
  const telechargement = await fetch(etat.url, {
    ...(entree.service === 'replicate' ? { headers: entetesDuService('replicate', cle) } : {}),
    signal: AbortSignal.timeout(5 * 60_000),
  });
  if (!telechargement.ok) throw new Error(`l’extrait est prêt mais son téléchargement a échoué (${telechargement.status})`);
  fs.writeFileSync(fichier, Buffer.from(await telechargement.arrayBuffer()));
}
