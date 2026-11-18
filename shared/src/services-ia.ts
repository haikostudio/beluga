/**
 * LES SERVICES D'IA CONNECTÉS, montrés en bas du volet des quotas (carte « Quotas des services d'IA »,
 * 08/11/2026). Un bloc PAR COMPTE de service — jamais le détail par clé ni par projet consommateur —, avec son
 * solde quand le service le publie et un lien vers sa page de facturation. Un service sans route de solde garde
 * son bloc, « solde non communiqué » (décisions de l'utilisateur au cadrage).
 *
 * Règles PURES : la liste FERMÉE des fournisseurs reconnus, la reconnaissance d'une fiche du coffre, la
 * requête de solde et la lecture de sa réponse. `server/src/services-ia-releve.ts` fait les appels ;
 * `server/src/test/services-ia.test.ts` verrouille ces règles.
 *
 * Routes et formats VÉRIFIÉS le 08/11/2026 par des appels réels :
 *  - OpenRouter : `GET /api/v1/credits` avec la clé de PROVISIONNEMENT (seule à lire le compte entier)
 *    → `{data:{total_credits, total_usage}}` en dollars. Une clé ordinaire n'y a pas droit : sans clé de
 *    provisionnement, le bloc dit « non communiqué » plutôt qu'un total faux ;
 *  - kie.ai : `GET https://api.kie.ai/api/v1/chat/credit` → `{code:200, data:<crédits>}` ; les erreurs
 *    arrivent en HTTP 200, seul `code` fait foi (`verdictDuSoldeKie`) ;
 *  - HeyGen : `GET https://api.heygen.com/v3/users/me` (en-tête `X-Api-Key`) →
 *    `data.wallet.remaining_balance` en dollars (la route v2 `remaining_quota` est dépréciée) ;
 *  - Agentik : `GET https://api.agentik.cc/v1/wallet/balance` → `available_usd` (solde + crédit offert) ;
 *  - Groq, API Gemini : AUCUNE route de solde. On sonde seulement la clé (`/models`, gratuit) pour dire
 *    « clé refusée » quand elle l'est.
 * Cursor et Xiaomi MiMo n'y sont pas : ce sont des moteurs, déjà montrés plus haut dans le volet.
 */

import { DOLLARS_PAR_CREDIT, KIE_API, verdictDuSoldeKie } from './kie.js';
import type { RequeteHttp } from './studio-services.js';

export type IdServiceIa = 'openrouter' | 'kie' | 'heygen' | 'agentik' | 'groq' | 'gemini-api';

export type UniteDeSolde = 'usd' | 'credits';

/** Une fiche du coffre, réduite à ce qui sert à la reconnaître et à appeler son service. */
export interface FicheDeServiceIa {
  nom: string;
  type: string;
  champs: Record<string, string>;
}

export interface FournisseurIa {
  id: IdServiceIa;
  nom: string;
  /** La page de facturation (ou d'usage) du service, ouverte dans un nouvel onglet. */
  lien: string;
  unite: UniteDeSolde;
  /** Reconnaît une fiche du coffre : motif cherché dans son NOM et dans son champ « service ». */
  motif: RegExp;
  /** La clé qui lit le compte ENTIER, quand le service en distingue une (OpenRouter : provisionnement). */
  cleDeCompte?: RegExp;
}

export const FOURNISSEURS_IA: readonly FournisseurIa[] = [
  { id: 'openrouter', nom: 'OpenRouter', lien: 'https://openrouter.ai/settings/credits', unite: 'usd', motif: /openrouter/i, cleDeCompte: /provision/i },
  { id: 'kie', nom: 'kie.ai', lien: 'https://kie.ai/billing', unite: 'credits', motif: /\bkie\.ai\b/i },
  { id: 'heygen', nom: 'HeyGen', lien: 'https://app.heygen.com/settings/billing', unite: 'usd', motif: /\bheygen\b/i },
  { id: 'agentik', nom: 'Agentik', lien: 'https://agentik.cc/dashboard/wallet', unite: 'usd', motif: /\bagentik\b/i },
  { id: 'groq', nom: 'Groq', lien: 'https://console.groq.com/settings/billing', unite: 'usd', motif: /\bgroq\b/i },
  { id: 'gemini-api', nom: 'API Gemini', lien: 'https://aistudio.google.com/usage', unite: 'usd', motif: /gemini\s+api/i },
];

/** Les fournisseurs qui ne publient aucun solde : leur bloc dit « non communiqué ». */
const SANS_SOLDE: ReadonlySet<IdServiceIa> = new Set(['groq', 'gemini-api']);

/**
 * Le fournisseur d'une fiche, ou `null`. Seules les fiches « clé d'API » qui portent une clé comptent : une
 * fiche « compte en ligne » Gemini ou une note qui cite OpenRouter ne fait pas un service connecté.
 */
export function fournisseurDeLaFiche(fiche: FicheDeServiceIa): FournisseurIa | null {
  if (fiche.type !== 'cle-api' || !String(fiche.champs?.cle ?? '').trim()) return null;
  const texte = `${fiche.nom} ${fiche.champs?.service ?? ''}`;
  return FOURNISSEURS_IA.find((f) => f.motif.test(texte)) ?? null;
}

export interface CompteDeServiceIa {
  fournisseur: FournisseurIa;
  /** Les clés trouvées, la clé de compte d'abord ; elles ne quittent JAMAIS le serveur. */
  cles: string[];
  /** Une clé qui lit le compte entier a été trouvée (OpenRouter). */
  cleDeCompte: boolean;
}

/** Regroupe les fiches par fournisseur, dans l'ordre de la liste fermée : UN compte par service. */
export function comptesDeServicesIa(fiches: readonly FicheDeServiceIa[]): CompteDeServiceIa[] {
  const parId = new Map<IdServiceIa, { fournisseur: FournisseurIa; deCompte: string[]; autres: string[] }>();
  for (const fiche of fiches) {
    const fournisseur = fournisseurDeLaFiche(fiche);
    if (!fournisseur) continue;
    const cle = fiche.champs.cle.trim();
    const groupe = parId.get(fournisseur.id) ?? { fournisseur, deCompte: [], autres: [] };
    const deCompte = fournisseur.cleDeCompte?.test(`${fiche.nom} ${fiche.champs.service ?? ''}`) ?? false;
    const liste = deCompte ? groupe.deCompte : groupe.autres;
    if (!groupe.deCompte.includes(cle) && !groupe.autres.includes(cle)) liste.push(cle);
    parId.set(fournisseur.id, groupe);
  }
  return FOURNISSEURS_IA.filter((f) => parId.has(f.id)).map((f) => {
    const g = parId.get(f.id)!;
    return { fournisseur: f, cles: [...g.deCompte, ...g.autres], cleDeCompte: g.deCompte.length > 0 };
  });
}

/**
 * La requête qui lit le solde (ou sonde la clé, pour un service sans solde). `null` : rien à demander —
 * OpenRouter sans clé de provisionnement, dont les clés ordinaires ne lisent pas le compte.
 */
export function requeteDeSoldeIa(id: IdServiceIa, cle: string, cleDeCompte = true): RequeteHttp | null {
  const bearer = { Authorization: `Bearer ${cle}` };
  switch (id) {
    case 'openrouter':
      return cleDeCompte ? { methode: 'GET', adresse: 'https://openrouter.ai/api/v1/credits', entetes: bearer } : null;
    case 'kie':
      return { methode: 'GET', adresse: `${KIE_API}/api/v1/chat/credit`, entetes: bearer };
    case 'heygen':
      return { methode: 'GET', adresse: 'https://api.heygen.com/v3/users/me', entetes: { 'X-Api-Key': cle } };
    case 'agentik':
      return { methode: 'GET', adresse: 'https://api.agentik.cc/v1/wallet/balance', entetes: bearer };
    case 'groq':
      return { methode: 'GET', adresse: 'https://api.groq.com/openai/v1/models', entetes: bearer };
    case 'gemini-api':
      return { methode: 'GET', adresse: 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1', entetes: { 'x-goog-api-key': cle } };
  }
}

/** Ce que le volet reçoit d'un service : des chiffres, un état, un lien public. JAMAIS une clé. */
export interface SoldeDeServiceIa {
  id: IdServiceIa;
  nom: string;
  lien: string;
  unite: UniteDeSolde;
  /** `ok` : chiffres lus ; `non-communique` : le service ne publie pas de solde ; `erreur` : voir `raison`. */
  etat: 'ok' | 'non-communique' | 'erreur';
  restant?: number;
  consomme?: number;
  total?: number;
  raison?: string;
  /** L'instant du relevé. */
  releveLe: number;
}

const nombre = (v: unknown): number | undefined => {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
};

/** Lit la réponse du service. Un chiffre illisible ne devient JAMAIS un zéro : il s'absente, ou c'est une erreur. */
export function lireSoldeIa(
  id: IdServiceIa,
  statut: number,
  corps: any,
): Pick<SoldeDeServiceIa, 'etat' | 'restant' | 'consomme' | 'total' | 'raison'> {
  if (id === 'kie') {
    const verdict = verdictDuSoldeKie(statut, corps);
    if (!verdict.ok) return { etat: 'erreur', raison: verdict.raison };
  } else {
    if (statut === 401 || statut === 403) return { etat: 'erreur', raison: 'le service refuse cette clé (elle est fausse, expirée ou retirée)' };
    if (statut >= 500) return { etat: 'erreur', raison: `le service ne répond pas en ce moment (${statut})` };
    if (statut < 200 || statut >= 300) return { etat: 'erreur', raison: `réponse inattendue du service (${statut})` };
  }
  if (SANS_SOLDE.has(id)) return { etat: 'non-communique' };
  let lu: { restant?: number; consomme?: number; total?: number } = {};
  switch (id) {
    case 'openrouter': {
      const total = nombre(corps?.data?.total_credits);
      const consomme = nombre(corps?.data?.total_usage);
      lu = { total, consomme, restant: total !== undefined && consomme !== undefined ? Math.max(0, total - consomme) : undefined };
      break;
    }
    case 'kie':
      lu = { restant: nombre(corps?.data) };
      break;
    case 'heygen':
      lu = { restant: nombre(corps?.data?.wallet?.remaining_balance) };
      break;
    case 'agentik':
      lu = { restant: nombre(corps?.available_usd) };
      break;
  }
  if (lu.restant === undefined && lu.consomme === undefined) return { etat: 'erreur', raison: 'réponse illisible : le service a changé son format' };
  return { etat: 'ok', ...Object.fromEntries(Object.entries(lu).filter(([, v]) => v !== undefined)) };
}

/** Le bloc d'un service sans rien à demander (OpenRouter sans clé de compte). */
export function soldeNonCommunique(f: FournisseurIa, maintenant = Date.now()): SoldeDeServiceIa {
  return { id: f.id, nom: f.nom, lien: f.lien, unite: f.unite, etat: 'non-communique', releveLe: maintenant };
}

/** La part consommée, en pour cent, quand le total est connu ; sinon `undefined` — jamais une jauge inventée. */
export function partConsommeeIa(solde: Pick<SoldeDeServiceIa, 'consomme' | 'total'>): number | undefined {
  if (solde.total === undefined || solde.consomme === undefined || solde.total <= 0) return undefined;
  return Math.min(100, Math.max(0, (solde.consomme / solde.total) * 100));
}

/** Le seuil d'alerte d'un service qui n'en a pas reçu : 2 $ (décision de l'utilisateur, 08/11/2026). */
export const SEUIL_PAR_DEFAUT_USD = 2;

/**
 * `normal` : au-dessus du seuil ; `bas` : sous le seuil (bloc orange, point au pied de colonne, SANS
 * notification) ; `vide` : plus rien (notification « à sec », à la bascule seulement).
 */
export type NiveauDuSolde = 'normal' | 'bas' | 'vide';

/** Le seuil retenu pour un service, en dollars : le réglage s'il est valide, sinon 2 $. */
export function seuilDuServiceUsd(id: string, seuilsUsd: Readonly<Record<string, number>> | undefined): number {
  const v = seuilsUsd?.[id];
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : SEUIL_PAR_DEFAUT_USD;
}

/** Le seuil dans l'unité du solde : des dollars, ou des crédits pour kie.ai (2 $ = 400 crédits). */
export function seuilDansLUnite(unite: UniteDeSolde, seuilUsd: number): number {
  return unite === 'credits' ? seuilUsd / DOLLARS_PAR_CREDIT : seuilUsd;
}

/**
 * Le niveau d'un solde au regard de son seuil. `null` quand le solde n'est pas lisible — service sans solde,
 * clé refusée, délai dépassé : JAMAIS une fausse alerte « à sec » sur un service qu'on n'a pas su lire.
 */
export function niveauDuSolde(
  solde: Pick<SoldeDeServiceIa, 'id' | 'etat' | 'restant' | 'unite'>,
  seuilsUsd?: Readonly<Record<string, number>>,
): NiveauDuSolde | null {
  if (solde.etat !== 'ok' || typeof solde.restant !== 'number' || !Number.isFinite(solde.restant)) return null;
  if (solde.restant <= 0) return 'vide';
  return solde.restant < seuilDansLUnite(solde.unite, seuilDuServiceUsd(solde.id, seuilsUsd)) ? 'bas' : 'normal';
}

/** Les services à surveiller (bas ou vides), dans l'ordre du relevé : c'est ce qui allume le point du pied de colonne. */
export function servicesIaEnAlerte(
  soldes: readonly SoldeDeServiceIa[],
  seuilsUsd?: Readonly<Record<string, number>>,
): Array<{ solde: SoldeDeServiceIa; niveau: 'bas' | 'vide' }> {
  const sortie: Array<{ solde: SoldeDeServiceIa; niveau: 'bas' | 'vide' }> = [];
  for (const solde of soldes) {
    const niveau = niveauDuSolde(solde, seuilsUsd);
    if (niveau === 'bas' || niveau === 'vide') sortie.push({ solde, niveau });
  }
  return sortie;
}

/**
 * LES SERVICES QUI VIENNENT DE TOMBER À SEC : ceux qui sont `vide` maintenant et ne l'étaient pas au relevé
 * précédent. C'est la seule occasion d'une notification — jamais à chaque tournée, jamais au retour, jamais
 * pour un simple solde bas. Un service illisible (`null`) garde son niveau d'avant : une panne passagère du
 * service ne le fait ni « revenir » ni « retomber ».
 */
export function basculesASec(
  avant: Readonly<Record<string, NiveauDuSolde>>,
  soldes: readonly SoldeDeServiceIa[],
  seuilsUsd?: Readonly<Record<string, number>>,
): { aSec: SoldeDeServiceIa[]; niveaux: Record<string, NiveauDuSolde> } {
  const niveaux: Record<string, NiveauDuSolde> = { ...avant };
  const aSec: SoldeDeServiceIa[] = [];
  for (const solde of soldes) {
    const niveau = niveauDuSolde(solde, seuilsUsd);
    if (niveau === null) continue;
    if (niveau === 'vide' && avant[solde.id] !== 'vide') aSec.push(solde);
    niveaux[solde.id] = niveau;
  }
  return { aSec, niveaux };
}
