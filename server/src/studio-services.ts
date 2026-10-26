import fs from 'node:fs';
import {
  type EtatDuTravail,
  type IdServiceCreation,
  type IdServiceEnPlus,
  type IdServiceGeneration,
  IDS_SERVICES_EN_PLUS,
  SERVICES_DE_GENERATION,
  type LigneDePrixKie,
  estServiceCache,
  modeleKie,
  prixKie,
  requeteDesPrixKie,
  verdictDuSoldeKie,
  requeteDeTestEnPlus,
  serviceDeGeneration,
  type ModeleVideoDeService,
  type RatioClip,
  type ServiceDeCreation,
  SERVICES_CREATION,
  adresseDeSuivi,
  cleAssemblee,
  entetesDuService,
  lireCreationDeClip,
  lireResultatFal,
  lireSuiviDeClip,
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

const cleDuTest = (id: IdServiceGeneration) => `studio.service.test.${id}`;

interface TestDeService {
  ok: boolean;
  raison?: string;
  le: number;
}

/*
 * LES SERVICES EN PLUS DU MODE « RÉALISATION » (HeyGen, ElevenLabs,
 * `shared/src/services-de-generation.ts`) se branchent par la MÊME rubrique et
 * le même coffre, une fiche par service. Le Studio ne les voit pas : ses
 * listes de modèles vidéo restent celles de `SERVICES_CREATION`.
 */
type ServiceBranchable = Omit<ServiceDeCreation, 'id'> & { id: IdServiceGeneration };
const estEnPlus = (id: IdServiceGeneration): id is IdServiceEnPlus => (IDS_SERVICES_EN_PLUS as readonly string[]).includes(id);

function ficheDuService(service: ServiceBranchable) {
  const nom = nomDeFicheDuService(service);
  return listerAcces().find((a) => a.nom === nom && a.type === 'cle-api' && typeof a.champs?.cle === 'string' && a.champs.cle.trim());
}

/** La clé branchée d'un service, ou rien. Elle ne sort JAMAIS vers l'écran. */
export function cleDuService(id: IdServiceGeneration): string | undefined {
  const service = serviceDeGeneration(id);
  if (!service) return undefined;
  try {
    return ficheDuService(service)?.champs.cle.trim();
  } catch {
    return undefined;
  }
}

/**
 * Tous les services branchés, ceux du mode Réalisation compris (HeyGen,
 * ElevenLabs). UN SERVICE CACHÉ (Higgsfield, fal.ai depuis le 25/10/2026)
 * n'y est jamais, même si sa clé reste au coffre : plus rien ne s'en sert.
 */
export function servicesDeGenerationBranches(): IdServiceGeneration[] {
  return SERVICES_DE_GENERATION.filter((s) => !estServiceCache(s.id) && !!cleDuService(s.id)).map((s) => s.id);
}

function dernierTest(id: IdServiceGeneration): TestDeService | null {
  try {
    const brut = getMeta(cleDuTest(id));
    return brut ? (JSON.parse(brut) as TestDeService) : null;
  } catch {
    return null;
  }
}

/** Ce que la rubrique « Services de création » affiche : jamais la clé, seulement ses quatre derniers signes. */
export function etatDesServices() {
  return SERVICES_DE_GENERATION.filter((s) => !estServiceCache(s.id)).map((s) => {
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

async function testerUneCle(id: IdServiceGeneration, cle: string): Promise<TestDeService> {
  try {
    const { statut, corps } = await appeler(estEnPlus(id) ? requeteDeTestEnPlus(id, cle) : requeteDeTest(id, cle), 15_000);
    /* kie.ai répond en 200 même à une fausse clé : son champ `code` tranche. */
    if (id === 'kie') return { ...verdictDuSoldeKie(statut, corps), le: Date.now() };
    // Les services en plus suivent la règle commune (aucune exception façon Higgsfield).
    return { ...verdictDuTest(estEnPlus(id) ? 'openrouter' : id, statut), le: Date.now() };
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
  const service = serviceDeGeneration(id);
  if (!service) return { ok: false, raison: 'service inconnu' };
  const cle = cleAssemblee(service as ServiceDeCreation, champs);
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
    note: estEnPlus(service.id)
      ? 'Branchée depuis les paramètres, rubrique « Services de création » : le mode Réalisation des cartes s’en sert pour fabriquer les médias.'
      : 'Branchée depuis les paramètres, rubrique « Services de création » : le Studio s’en sert pour fabriquer les extraits (ou, pour OpenRouter, la voix finale et la musique), et le mode Réalisation des cartes pour fabriquer les médias.',
  });
  if (!r.ok) return { ok: false, raison: r.raison };
  setMeta(cleDuTest(service.id), JSON.stringify(test));
  log.info(`studio : service « ${service.nom} » branché (${test.ok ? 'clé acceptée' : `à revoir : ${test.raison}`})`);
  return { ok: true, test };
}

export async function testerService(id: string): Promise<TestDeService> {
  const service = serviceDeGeneration(id);
  if (!service) throw new Error('service inconnu');
  const cle = cleDuService(service.id);
  if (!cle) throw new Error('aucune clé branchée pour ce service');
  const test = await testerUneCle(service.id, cle);
  setMeta(cleDuTest(service.id), JSON.stringify(test));
  return test;
}

/** Retirer un service : sa fiche est ARCHIVÉE six mois (le coffre n'efface pas), plus rien ne s'en sert. */
export function retirerService(id: string): { ok: boolean; raison?: string } {
  const service = serviceDeGeneration(id);
  if (!service) return { ok: false, raison: 'service inconnu' };
  const fiche = ficheDuService(service);
  if (!fiche) return { ok: true };
  const r = supprimerAcces(fiche.id);
  if (r.ok) setMeta(cleDuTest(service.id), '');
  return r;
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
  if (service === 'kie') {
    const k = modeleKie(modele, 'video');
    return k ? prixKie(await tarifsKie(), k, { secondes: duree }) : null;
  }
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

/*
 * LA LISTE PUBLIQUE DES PRIX DE kie.ai (sans clé, 100 lignes par page, ~600
 * lignes au 25/10/2026), relue au plus toutes les six heures. Un échec rend la
 * dernière liste connue, ou rien : le devis dit alors « prix non trouvé ».
 */
let tarifsKieLus: { le: number; lignes: LigneDePrixKie[] } | null = null;
export async function tarifsKie(): Promise<LigneDePrixKie[]> {
  if (tarifsKieLus && Date.now() - tarifsKieLus.le < 6 * 3_600_000) return tarifsKieLus.lignes;
  try {
    const lignes: LigneDePrixKie[] = [];
    for (let page = 1; page <= 12; page++) {
      const { statut, corps } = await appeler(requeteDesPrixKie(page), 15_000);
      const lues = statut === 200 && Number(corps?.code) === 200 && Array.isArray(corps?.data?.records) ? (corps.data.records as LigneDePrixKie[]) : [];
      lignes.push(...lues);
      if (lues.length < 100 || page >= Number(corps?.data?.pages ?? page)) break;
    }
    if (lignes.length) tarifsKieLus = { le: Date.now(), lignes };
  } catch (err) {
    log.warn('studio : liste des prix de kie.ai illisible', String((err as Error)?.message ?? err));
  }
  return tarifsKieLus?.lignes ?? [];
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
