/**
 * LE MOTEUR CURSOR — les règles PURES, sans réseau ni disque.
 *
 * Claude et Codex sont des OUTILS EN LIGNE DE COMMANDE déjà authentifiés sur le
 * serveur : HaikoDev lance un processus dans la copie de travail de la carte et
 * lit ce qu'il écrit. Cursor n'a pas d'équivalent ici : on parle à ses AGENTS
 * CLOUD par une API HTTP (`https://api.cursor.com`), avec une clé. Trois
 * conséquences, qui expliquent tout ce fichier :
 *
 *  1. LE TRAVAIL NE SE FAIT PAS SUR LA MACHINE. L'agent Cursor tourne chez
 *     Cursor. On lui donne un DÉPÔT GitHub quand le compte y a accès, sinon il
 *     répond sans dépôt — il réfléchit et rédige, il ne touche pas au projet.
 *  2. LE FIL EST L'AGENT. Un agent Cursor garde sa conversation : le premier
 *     tour le CRÉE, les suivants lui ajoutent un « run ». Son identifiant est
 *     donc l'identifiant de session de HaikoDev.
 *  3. RIEN N'EST INSTANTANÉ. Un run passe par des états (CREATING, RUNNING,
 *     FINISHED…) : on suit ces états, et un état qui n'est plus « en cours » est
 *     TERMINAL — sinon un état inconnu ferait tourner le témoin pour toujours.
 *
 * Tout ce qui suit se calcule sans appeler personne : c'est ce qui le rend
 * rejouable dans un test (`shared/src/test/…`, `server/src/test/moteur-cursor.test.ts`).
 */

/** L'adresse de l'API des agents cloud. Une seule écriture, partout reprise. */
export const API_CURSOR = 'https://api.cursor.com';

/** Le modèle retenu quand rien n'est choisi : le modèle maison de Cursor. */
export const MODELE_CURSOR_PAR_DEFAUT = 'composer-2.5';

/** Un paramètre de modèle, tel que `GET /v1/models` le décrit. */
export interface ParametreCursor {
  id: string;
  displayName?: string;
  values?: { value: string; displayName?: string }[];
}

/**
 * Les deux noms sous lesquels Cursor range l'effort de réflexion : « effort »
 * (Claude, Grok) et « reasoning » (GPT). Un même réglage, deux vocabulaires.
 */
const PARAMS_DE_REFLEXION = ['effort', 'reasoning'];

/** Le paramètre BOOLÉEN des modèles Claude : réfléchir, ou non. */
const PARAM_REFLEXION_OUI_NON = 'thinking';

/**
 * Le niveau tel que HaikoDev le nomme partout ailleurs (`low`, `medium`,
 * `high`, `xhigh`, `max`). Cursor écrit « extra-high » là où le reste du projet
 * écrit « xhigh » : on traduit dans les deux sens plutôt que d'ajouter un
 * sixième mot à l'interface.
 */
export function niveauDepuisCursor(valeur: string): string {
  return valeur === 'extra-high' ? 'xhigh' : valeur;
}

function parametre(parametres: ParametreCursor[] | undefined, id: string): ParametreCursor | undefined {
  return (parametres ?? []).find((p) => p.id === id);
}

function valeursDe(parametre: ParametreCursor | undefined): string[] {
  return (parametre?.values ?? []).map((v) => v.value).filter((v) => typeof v === 'string');
}

/** Le paramètre qui porte l'effort de réflexion pour ce modèle, s'il en a un. */
function parametreDEffort(parametres: ParametreCursor[] | undefined): ParametreCursor | undefined {
  for (const id of PARAMS_DE_REFLEXION) {
    const trouve = parametre(parametres, id);
    if (trouve && valeursDe(trouve).length) return trouve;
  }
  return undefined;
}

/**
 * LES NIVEAUX DE RÉFLEXION RÉELLEMENT PROPOSÉS PAR CE MODÈLE, dans le
 * vocabulaire de HaikoDev. Trois cas, et aucun autre :
 *
 *  - un paramètre d'effort : ses valeurs, traduites (`extra-high` → `xhigh`) ;
 *  - un simple oui/non (`thinking`) : « sans réflexion » ou « moyenne », car
 *    l'interface ne connaît que des niveaux nommés, pas une case à cocher ;
 *  - rien du tout : « sans réflexion » seulement.
 *
 * `none` est toujours en tête : c'est le choix qui ne coûte rien.
 */
export function niveauxDeReflexionCursor(parametres: ParametreCursor[] | undefined): string[] {
  const effort = parametreDEffort(parametres);
  if (effort) {
    const niveaux = valeursDe(effort).map(niveauDepuisCursor);
    return niveaux.includes('none') ? ['none', ...niveaux.filter((n) => n !== 'none')] : ['none', ...niveaux];
  }
  if (valeursDe(parametre(parametres, PARAM_REFLEXION_OUI_NON)).length) return ['none', 'medium'];
  return ['none'];
}

/** Une COMBINAISON de réglages que Cursor accepte, telle qu'il l'énumère. */
export interface VarianteCursor {
  params?: { id: string; value: string }[];
  isDefault?: boolean;
}

/** Un modèle du catalogue : ses réglages possibles ET les combinaisons valides. */
export interface ModeleCursor {
  parameters?: ParametreCursor[];
  variants?: VarianteCursor[];
}

/** La valeur d'effort portée par une combinaison, dans le vocabulaire de HaikoDev. */
function effortDeLaVariante(variante: VarianteCursor): string | null {
  const params = variante.params ?? [];
  for (const id of PARAMS_DE_REFLEXION) {
    const trouve = params.find((p) => p.id === id);
    if (trouve) return niveauDepuisCursor(trouve.value);
  }
  const ouiNon = params.find((p) => p.id === PARAM_REFLEXION_OUI_NON);
  // Un simple oui/non : « réfléchit » vaut le niveau moyen, « ne réfléchit
  // pas » vaut « sans réflexion » — les deux seuls mots que l'interface a.
  if (ouiNon) return ouiNon.value === 'true' ? 'medium' : 'none';
  return null;
}

/**
 * LES PARAMÈTRES À ENVOYER pour obtenir ce niveau de réflexion.
 *
 * Cursor n'accepte PAS un réglage isolé : il n'accepte que les COMBINAISONS
 * qu'il énumère lui-même (« Model 'gpt-5.6-luna' does not match a known
 * variant », constaté sur un vrai tour). Envoyer le seul effort voulu faisait
 * donc refuser la demande ENTIÈRE. On repart de ses combinaisons : on garde
 * celles qui portent le niveau demandé, et on retient celle que Cursor donne
 * pour défaut — sinon la première, la plus économe.
 *
 * Rien qui corresponde, ou aucune combinaison connue : on n'envoie AUCUN
 * réglage. Le modèle part avec son défaut, ce qui vaut toujours mieux qu'un
 * tour refusé pour un réglage d'importance secondaire.
 */
export function paramsDeReflexionCursor(
  modele: ModeleCursor | ParametreCursor[] | undefined,
  reflexion: string | undefined,
): { id: string; value: string }[] {
  // Tolérance d'appel : on accepte aussi la simple liste de paramètres, mais
  // seules les combinaisons permettent de composer un envoi valide.
  const variantes = Array.isArray(modele) ? [] : (modele?.variants ?? []);
  if (!variantes.length) return [];

  const voulu = (reflexion ?? '').trim() || 'none';
  const candidates = variantes.filter((v) => {
    const effort = effortDeLaVariante(v);
    return effort === null ? voulu === 'none' : effort === voulu;
  });
  const retenue = candidates.find((v) => v.isDefault) ?? candidates[0];
  return retenue?.params ?? [];
}

/**
 * La fenêtre de contexte annoncée par le paramètre « context » (« 300k »,
 * « 1m »), en jetons. La PREMIÈRE valeur fait foi : c'est celle que Cursor
 * applique quand on ne demande rien. Aucun paramètre : on ne devine pas.
 */
export function fenetreDeContexteCursor(parametres: ParametreCursor[] | undefined): number | undefined {
  const premiere = valeursDe(parametre(parametres, 'context'))[0];
  if (!premiere) return undefined;
  const match = premiere.trim().toLowerCase().match(/^([\d.]+)\s*([km])?$/);
  if (!match) return undefined;
  const nombre = Number(match[1]);
  if (!Number.isFinite(nombre)) return undefined;
  const facteur = match[2] === 'm' ? 1_000_000 : match[2] === 'k' ? 1_000 : 1;
  return Math.round(nombre * facteur);
}

/**
 * L'adresse GitHub d'un dépôt, telle que Cursor l'attend : une URL `https`,
 * sans `.git` final. Les projets sont déclarés avec l'adresse SSH
 * (`git@github.com:org/depot.git`) — l'envoyer telle quelle fait refuser la
 * demande. Rend `null` pour tout ce qui n'est pas GitHub : Cursor ne sait
 * cloner que de là.
 */
export function depotGithubPourCursor(remote: string | undefined | null): string | null {
  const texte = (remote ?? '').trim();
  if (!texte) return null;
  const ssh = texte.match(/^(?:ssh:\/\/)?git@github\.com[:/]+([^/]+)\/(.+?)(?:\.git)?\/?$/i);
  if (ssh) return `https://github.com/${ssh[1]}/${ssh[2]}`;
  const https = texte.match(/^https?:\/\/(?:[^@]+@)?github\.com\/([^/]+)\/(.+?)(?:\.git)?\/?$/i);
  if (https) return `https://github.com/${https[1]}/${https[2]}`;
  return null;
}

/**
 * POURQUOI L'APPEL A ÉTÉ REFUSÉ, en français et pour un lecteur non
 * informaticien. Une panne se dit toujours : un témoin qui tourne sans fin sur
 * une clé refusée est le défaut qu'on répare ici.
 */
export function raisonDeRefusCursor(status: number, message?: string): string {
  const detail = (message ?? '').trim();
  const suffixe = detail ? ` (${detail})` : '';
  if (status === 401 || status === 403) return `Cursor a refusé la clé d'accès${suffixe}.`;
  if (status === 404) return `Cursor n'a pas trouvé ce qui était demandé${suffixe}.`;
  if (status === 400 || status === 422) return `Cursor a refusé la demande${suffixe}.`;
  if (status === 429) return 'Cursor limite les appels pour le moment : la demande n\'est pas partie.';
  if (status >= 500) return `Le service Cursor est indisponible${suffixe}.`;
  return `Cursor a répondu ${status}${suffixe}.`;
}

/** Ce que Cursor annonce tant que le travail continue. Tout le reste est TERMINAL. */
const STATUTS_EN_COURS = new Set(['CREATING', 'PENDING', 'QUEUED', 'RUNNING', 'ACTIVE']);
const STATUTS_REUSSIS = new Set(['FINISHED', 'COMPLETED', 'SUCCEEDED']);
const STATUTS_ARRETES = new Set(['CANCELLED', 'CANCELED', 'STOPPED']);

export type IssueDuRunCursor = 'en-cours' | 'reussi' | 'arrete' | 'echoue';

/**
 * L'issue d'un run. Un statut INCONNU est traité comme un échec, jamais comme
 * un travail qui continue : mieux vaut dire « le moteur s'est arrêté sans
 * raison connue » que laisser une carte tourner indéfiniment.
 */
export function issueDuRunCursor(statut: string | undefined | null): IssueDuRunCursor {
  const mot = (statut ?? '').trim().toUpperCase();
  if (!mot) return 'en-cours';
  if (STATUTS_EN_COURS.has(mot)) return 'en-cours';
  if (STATUTS_REUSSIS.has(mot)) return 'reussi';
  if (STATUTS_ARRETES.has(mot)) return 'arrete';
  return 'echoue';
}

/** Le message affiché quand un run ne s'est pas terminé normalement. */
export function messageDeFinCursor(statut: string | undefined | null, detail?: string): string {
  const issue = issueDuRunCursor(statut);
  const texte = (detail ?? '').trim();
  const suffixe = texte ? ` : ${texte}` : '.';
  if (issue === 'arrete') return `Le tour a été arrêté chez Cursor${suffixe}`;
  if (issue === 'echoue') return `Cursor a interrompu le tour (${statut ?? 'sans statut'})${suffixe}`;
  return `Cursor n'a pas rendu de réponse${suffixe}`;
}

/**
 * L'ATTENTE ENTRE DEUX LECTURES d'un run, en millisecondes. Elle s'allonge :
 * un tour de quelques secondes doit se voir tout de suite, un tour de vingt
 * minutes ne doit pas produire mille appels. Plafonnée à dix secondes.
 */
export function attenteAvantRelecture(essai: number): number {
  const base = 1500 * Math.pow(1.4, Math.max(0, essai));
  return Math.min(10_000, Math.round(base));
}

/* ------------------------------------------------------------------ */
/* Rapatrier ce que l'agent cloud a écrit                              */
/* ------------------------------------------------------------------ */

/** Une branche produite par un agent Cursor, telle que le run l'annonce. */
export interface BrancheCursor {
  /** L'adresse du dépôt où elle a été poussée. */
  depot?: string;
  /** Le nom de la branche (« cursor/… »). */
  branche: string;
  /** La demande de fusion, si Cursor en a ouvert une. */
  demandeDeFusion?: string;
}

/**
 * LES BRANCHES QU'UN RUN A PRODUITES (`run.git.branches`). Un agent qui a
 * seulement répondu n'en produit aucune : la liste vide est le cas NORMAL, pas
 * une anomalie.
 */
export function branchesDuRunCursor(run: unknown): BrancheCursor[] {
  const brutes = (run as any)?.git?.branches;
  if (!Array.isArray(brutes)) return [];
  const branches: BrancheCursor[] = [];
  for (const entree of brutes) {
    const nom = typeof entree?.branch === 'string' ? entree.branch.trim() : '';
    if (!nom) continue;
    branches.push({
      branche: nom,
      depot: typeof entree?.repoUrl === 'string' ? entree.repoUrl.trim() : undefined,
      demandeDeFusion: typeof entree?.prUrl === 'string' ? entree.prUrl.trim() : undefined,
    });
  }
  return branches;
}

/**
 * PEUT-ON RAPATRIER CETTE BRANCHE ICI ?
 *
 * L'agent Cursor pousse son travail sur une branche « cursor/… » du dépôt. Le
 * ramener dans la copie de travail n'a de sens QUE dans le dossier d'une carte,
 * sur sa branche « tache/… » : c'est là que le travail d'une carte vit, et
 * c'est de là que le démon le fusionne. Une conversation ordinaire, elle,
 * travaille dans le dossier du projet, souvent sur la branche principale —
 * y fusionner tout seul reviendrait à livrer sans que personne l'ait demandé.
 *
 * Un dossier de travail SALE bloque aussi : on ne fusionne jamais par-dessus
 * des modifications que personne n'a enregistrées.
 */
export function peutRapatrierIci(brancheLocale: string | undefined, dossierPropre: boolean): boolean {
  return Boolean(brancheLocale?.startsWith('tache/')) && dossierPropre;
}

/** Ce qui s'affiche une fois le travail de Cursor ramené — ou non. */
export function messageDeRapatriement(
  branche: string,
  issue: 'fusionnee' | 'conflit' | 'hors-carte' | 'echec',
  detail?: string,
): string {
  switch (issue) {
    case 'fusionnee':
      return `Travail de Cursor ramené dans la carte (branche « ${branche} »).`;
    case 'conflit':
      return `Le travail de Cursor n'a pas pu être fusionné : la branche « ${branche} » entre en conflit avec la carte. Rien n'a été touché — le travail reste sur cette branche.`;
    case 'hors-carte':
      return `Cursor a écrit sur la branche « ${branche} ». Rien n'est ramené ici : le rapatriement automatique ne se fait que dans le dossier d'une carte.`;
    default:
      return `La branche « ${branche} » de Cursor n'a pas pu être récupérée${detail ? ` : ${detail}` : '.'}`;
  }
}

/**
 * UN MOTEUR SANS QUOTA PUBLIÉ n'affiche AUCUNE jauge. Cursor facture à la
 * dépense et ne publie ni fenêtre de cinq heures ni plafond hebdomadaire :
 * afficher « fenêtre 0 % · semaine 0 % » sur sa ligne de compte serait une
 * mesure inventée, et c'est exactement ce que HaikoDev refuse ailleurs.
 */
export function moteurSansQuota(engine: string | undefined): boolean {
  return engine === 'cursor';
}

/** L'état d'un compte Cursor tel que les réglages l'affichent. */
export interface EtatCompteCursor {
  /** La clé répond-elle ? */
  cleAcceptee: boolean;
  /** Le nom que Cursor donne à cette clé, quand elle est acceptée. */
  nomDeLaCle?: string;
  /** Pourquoi elle ne répond pas, en français. */
  erreur?: string;
  /** Les dépôts que ce compte peut ouvrir, du plus court au plus long nom. */
  depots: string[];
  /** Pourquoi la liste des dépôts n'a pas pu être lue. */
  erreurDepots?: string;
}

/**
 * LES DÉPÔTS RENDUS PAR CURSOR, ramenés à des noms « organisation/dépôt ».
 * L'API ne documente pas la forme exacte de chaque entrée et l'a déjà changée :
 * on accepte donc plusieurs écritures (nom complet, adresse, propriétaire +
 * nom) plutôt que d'en supposer une seule, et on écarte ce qui n'est pas
 * reconnaissable au lieu d'afficher un objet brut.
 */
export function depotsDepuisCursor(items: unknown): string[] {
  if (!Array.isArray(items)) return [];
  const noms = new Set<string>();
  for (const entree of items) {
    if (typeof entree === 'string') {
      const nom = nomDeDepot(entree);
      if (nom) noms.add(nom);
      continue;
    }
    if (!entree || typeof entree !== 'object') continue;
    const objet = entree as Record<string, unknown>;
    const candidats = [objet.fullName, objet.full_name, objet.name, objet.repository, objet.url, objet.repoUrl];
    let trouve: string | null = null;
    for (const candidat of candidats) {
      if (typeof candidat !== 'string') continue;
      trouve = nomDeDepot(candidat);
      if (trouve) break;
    }
    // « propriétaire » et « nom » séparés : la forme la plus courante après l'adresse.
    if (!trouve && typeof objet.owner === 'string' && typeof objet.name === 'string') {
      trouve = `${objet.owner}/${objet.name}`;
    }
    if (trouve) noms.add(trouve);
  }
  return [...noms].sort((a, b) => a.localeCompare(b));
}

/** « organisation/dépôt », quelle que soit l'écriture reçue. */
function nomDeDepot(valeur: string): string | null {
  const texte = valeur.trim().replace(/\.git$/i, '').replace(/\/+$/, '');
  if (!texte) return null;
  const adresse = depotGithubPourCursor(texte);
  if (adresse) return adresse.replace(/^https:\/\/github\.com\//i, '');
  return /^[^/\s]+\/[^/\s]+$/.test(texte) ? texte : null;
}

/**
 * LE COÛT D'UN TOUR, tel que `GET /v1/agents/{id}/usage` le rend : Cursor
 * compte en CENTIMES de dollar, HaikoDev en dollars. Une valeur absente reste
 * absente — jamais un zéro qui passerait pour une mesure.
 */
export function coutEnDollars(centimes: unknown): number | undefined {
  return typeof centimes === 'number' && Number.isFinite(centimes) ? centimes / 100 : undefined;
}
