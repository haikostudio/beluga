/**
 * LA PORTE D'ENTRÉE DES SERVICES EXTÉRIEURS : les clés d'API.
 *
 * Un service du dehors — la boîte mail professionnelle qui reçoit un message
 * d'un client, par exemple — doit pouvoir poser une carte dans un projet sans
 * ouvrir l'interface. Il se présente avec une CLÉ, une par service, nommée,
 * datée et révocable depuis les réglages.
 *
 * Tout ce qui se décide sans base ni disque vit ici : la forme d'une clé, ce
 * qu'un envoi doit contenir, comment on retrouve le projet visé, et pourquoi un
 * appel est refusé. Le SECRET lui-même n'est jamais conservé : le serveur n'en
 * garde qu'une empreinte (`server/src/cles-api.ts`), et la clé en clair n'est
 * montrée qu'une fois, au moment où on la fabrique.
 *
 * Une carte posée par cette porte est une carte comme les autres : elle naît
 * dans « Planifié » et attend un lancement — rien ne part au moteur tout seul.
 */

/** L'adresse de la porte d'entrée. Une seule vérité : le serveur, l'écran des réglages et le contrôle la lisent ici. */
export const ROUTE_CARTE_EXTERNE = '/api/externe/carte';

/**
 * L'adresse qui rend les clients déjà rapprochés d'un projet — pour retrouver
 * le projet d'un client à partir de son NOM, pas seulement de son identifiant.
 * Même clé que la création de carte : la porte reste unique, elle ouvre
 * plusieurs gestes de LECTURE et un seul geste d'ÉCRITURE.
 */
export const ROUTE_CLIENTS_EXTERNE = '/api/externe/clients';

/** Le préfixe visible de toute clé : on reconnaît une clé HaikoDev d'un coup d'œil. */
export const PREFIXE_CLE_API = 'hkd_';

/** La longueur du secret tiré au sort, en octets — 32 octets font 64 signes hexadécimaux. */
export const OCTETS_DE_CLE_API = 32;

/** Ce qui reste LISIBLE dans la liste des clés : le préfixe et les premiers signes. */
export const SIGNES_APERCU_CLE = 6;

/** Les bornes d'un nom de clé — il sert à reconnaître le service, pas à raconter. */
export const NOM_CLE_MIN = 2;
export const NOM_CLE_MAX = 60;

/** Les bornes de ce qu'un service extérieur peut poser sur une carte. */
export const TITRE_EXTERNE_MIN = 3;
export const TITRE_EXTERNE_MAX = 200;
export const DESCRIPTION_EXTERNE_MAX = 20_000;
export const ETIQUETTES_EXTERNES_MAX = 10;

/** Une clé telle qu'elle est RANGÉE : sans le secret, qui n'existe qu'une fois. */
export interface CleApi {
  id: string;
  /** Le nom du service qui l'utilise : « boîte mail », « formulaire du site »… */
  nom: string;
  /** Les premiers signes de la clé, gardés en clair pour la reconnaître dans la liste. */
  apercu: string;
  /** L'empreinte du secret. La clé elle-même n'est conservée nulle part. */
  empreinte: string;
  creeeLe: number;
  /** Posée au moment de la révocation : une clé révoquée n'est jamais effacée de l'histoire. */
  revoqueeLe?: number;
  /** Le dernier appel accepté avec cette clé. */
  dernierUsageLe?: number;
  /** Combien de cartes cette clé a réellement créées. */
  cartesCreees: number;
}

/** Ce qui part vers l'interface : tout sauf l'empreinte, qui ne regarde que le serveur. */
export type CleApiPublique = Omit<CleApi, 'empreinte'>;

export function cleApiPublique(cle: CleApi): CleApiPublique {
  const { empreinte: _empreinte, ...reste } = cle;
  return reste;
}

/* ------------------------------------------------------------------ */
/* Le nom d'une clé                                                    */
/* ------------------------------------------------------------------ */

export type JugementDeNom = { ok: true; nom: string } | { ok: false; raison: string };

/**
 * Une clé sans nom ne se révoque pas : six mois plus tard, personne ne sait
 * plus quel service s'en sert. Le nom est donc exigé, et borné.
 */
export function jugerNomDeCle(brut: unknown): JugementDeNom {
  if (typeof brut !== 'string') return { ok: false, raison: 'Il faut nommer la clé.' };
  const nom = brut.trim().replace(/\s+/g, ' ');
  if (nom.length < NOM_CLE_MIN) return { ok: false, raison: 'Il faut nommer la clé.' };
  if (nom.length > NOM_CLE_MAX) {
    return { ok: false, raison: `Le nom de la clé dépasse ${NOM_CLE_MAX} signes.` };
  }
  return { ok: true, nom };
}

/* ------------------------------------------------------------------ */
/* La clé présentée par l'appelant                                     */
/* ------------------------------------------------------------------ */

/** La forme attendue : le préfixe, puis 64 signes hexadécimaux. */
const FORME_CLE = new RegExp(`^${PREFIXE_CLE_API}[0-9a-f]{${OCTETS_DE_CLE_API * 2}}$`);

export function formeDeCleApi(brut: unknown): brut is string {
  return typeof brut === 'string' && FORME_CLE.test(brut);
}

/** L'aperçu gardé en clair pour une clé donnée. */
export function apercuDeCle(cle: string): string {
  return cle.slice(0, PREFIXE_CLE_API.length + SIGNES_APERCU_CLE);
}

/**
 * La clé présentée dans les en-têtes d'une requête. Deux façons de la donner,
 * pour ne dépendre d'aucun outil particulier : l'en-tête maison
 * `x-haikodev-cle`, ou l'`Authorization: Bearer …` que tout le monde connaît.
 */
export function cleDesEntetes(entetes: Record<string, string | string[] | undefined>): string | undefined {
  const lire = (nom: string): string | undefined => {
    const valeur = entetes[nom] ?? entetes[nom.toLowerCase()];
    if (Array.isArray(valeur)) return valeur[0];
    return typeof valeur === 'string' ? valeur : undefined;
  };
  const maison = lire('x-haikodev-cle')?.trim();
  if (maison) return maison;
  const porteur = lire('authorization')?.trim();
  if (porteur && /^bearer\s+/i.test(porteur)) return porteur.replace(/^bearer\s+/i, '').trim();
  return undefined;
}

export type RefusDeCle = 'absente' | 'malformee' | 'inconnue' | 'revoquee';

export type JugementDeCle =
  | { ok: true; cle: CleApi }
  | { ok: false; motif: RefusDeCle; raison: string; statut: number };

/**
 * Le verdict sur la clé présentée. `trouvee` est la clé rangée qui porte la
 * même empreinte, ou rien du tout — la recherche appartient au serveur, la
 * DÉCISION appartient à cette règle.
 */
export function jugerLaCle(presentee: unknown, trouvee: CleApi | undefined | null): JugementDeCle {
  if (presentee === undefined || presentee === null || presentee === '') {
    return { ok: false, motif: 'absente', raison: 'Aucune clé fournie.', statut: 401 };
  }
  if (!formeDeCleApi(presentee)) {
    return { ok: false, motif: 'malformee', raison: "La clé fournie n'a pas la forme attendue.", statut: 401 };
  }
  if (!trouvee) {
    return { ok: false, motif: 'inconnue', raison: 'Clé inconnue.', statut: 401 };
  }
  if (trouvee.revoqueeLe) {
    return { ok: false, motif: 'revoquee', raison: 'Cette clé a été révoquée.', statut: 403 };
  }
  return { ok: true, cle: trouvee };
}

/* ------------------------------------------------------------------ */
/* Ce que le service extérieur envoie                                  */
/* ------------------------------------------------------------------ */

export interface DemandeDeCarteExterne {
  /** Le projet visé, désigné par son NOM ou par son identifiant. */
  projet: string;
  titre: string;
  description: string;
  etiquettes: string[];
}

export type JugementDeDemande =
  | { ok: true; demande: DemandeDeCarteExterne }
  | { ok: false; raison: string };

function texte(source: Record<string, unknown>, ...noms: string[]): unknown {
  for (const nom of noms) {
    const valeur = source[nom];
    if (valeur !== undefined && valeur !== null) return valeur;
  }
  return undefined;
}

/**
 * Ce qu'un envoi doit contenir : le projet visé, un titre, et rien d'obligatoire
 * de plus. Les noms de champs sont acceptés en français comme en anglais — un
 * service extérieur n'a pas à deviner la langue du démon.
 */
export function jugerDemandeDeCarte(brut: unknown): JugementDeDemande {
  if (!brut || typeof brut !== 'object' || Array.isArray(brut)) {
    return { ok: false, raison: "L'envoi doit être un objet JSON." };
  }
  const source = brut as Record<string, unknown>;

  const projetBrut = texte(source, 'projet', 'project', 'projectId');
  const projet = typeof projetBrut === 'string' ? projetBrut.trim() : '';
  if (!projet) return { ok: false, raison: 'Il faut dire dans quel projet créer la carte (champ « projet »).' };

  const titreBrut = texte(source, 'titre', 'title');
  const titre = typeof titreBrut === 'string' ? titreBrut.trim().replace(/\s+/g, ' ') : '';
  if (titre.length < TITRE_EXTERNE_MIN) {
    return { ok: false, raison: `Le titre doit faire au moins ${TITRE_EXTERNE_MIN} signes (champ « titre »).` };
  }

  const descriptionBrute = texte(source, 'description', 'texte', 'body');
  const description = typeof descriptionBrute === 'string' ? descriptionBrute.trim() : '';
  if (description.length > DESCRIPTION_EXTERNE_MAX) {
    return { ok: false, raison: `La description dépasse ${DESCRIPTION_EXTERNE_MAX} signes.` };
  }

  const etiquettesBrutes = texte(source, 'etiquettes', 'labels');
  let etiquettes: string[] = [];
  if (etiquettesBrutes !== undefined) {
    if (!Array.isArray(etiquettesBrutes)) return { ok: false, raison: 'Les étiquettes doivent former une liste.' };
    etiquettes = etiquettesBrutes
      .filter((e): e is string => typeof e === 'string')
      .map((e) => e.trim())
      .filter(Boolean)
      .slice(0, ETIQUETTES_EXTERNES_MAX);
  }

  return {
    ok: true,
    demande: { projet, titre: titre.slice(0, TITRE_EXTERNE_MAX), description, etiquettes },
  };
}

/* ------------------------------------------------------------------ */
/* Retrouver le projet visé                                           */
/* ------------------------------------------------------------------ */

/** Réduit un nom à sa forme comparable : sans accents, sans casse, sans ponctuation. */
function forme(nom: string): string {
  return nom
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

export interface ProjetDesigne {
  id: string;
  name: string;
  archive?: boolean;
}

export type JugementDeProjet<P extends ProjetDesigne> =
  | { ok: true; projet: P }
  | { ok: false; raison: string; statut: number };

/**
 * Le projet visé, désigné par son identifiant ou par son NOM — un service
 * extérieur connaît « Chez Dupont », pas un identifiant technique. L'identifiant
 * l'emporte, puis le nom exact, puis le nom rapproché (accents et casse mis de
 * côté). Deux projets qui répondent au même nom : on refuse plutôt que de
 * choisir à la place de l'utilisateur.
 */
export function trouverLeProjetVise<P extends ProjetDesigne>(projets: P[], designation: string): JugementDeProjet<P> {
  const vivants = projets.filter((p) => !p.archive);
  const parId = vivants.find((p) => p.id === designation);
  if (parId) return { ok: true, projet: parId };

  const exact = vivants.filter((p) => p.name === designation);
  if (exact.length === 1) return { ok: true, projet: exact[0] };

  const cible = forme(designation);
  const rapproches = vivants.filter((p) => forme(p.name) === cible);
  if (rapproches.length === 1) return { ok: true, projet: rapproches[0] };
  if (rapproches.length > 1) {
    return {
      ok: false,
      statut: 409,
      raison: `Plusieurs projets répondent au nom « ${designation} » : désignez-le par son identifiant.`,
    };
  }

  // Un projet MIS DE CÔTÉ existe encore : le dire vaut mieux qu'un « introuvable »
  // qui enverrait le service chercher une faute de frappe.
  const archive = projets.find((p) => p.archive && (p.id === designation || forme(p.name) === cible));
  if (archive) {
    return { ok: false, statut: 409, raison: `Le projet « ${archive.name} » est mis de côté.` };
  }

  return { ok: false, statut: 404, raison: `Aucun projet nommé « ${designation} ».` };
}

/* ------------------------------------------------------------------ */
/* Retrouver un projet par le nom de son client                        */
/* ------------------------------------------------------------------ */

/** Un projet rapproché d'un client de facturation, tel que rendu à un appelant extérieur. */
export interface ClientRapproche {
  projet: { id: string; nom: string };
  client: { id: string; nom: string };
  entreprise?: { id: string; nom: string };
}

/** Un projet et son lien de facturation, tels que connus du serveur — avant mise en forme. */
export interface ProjetAvecClient {
  id: string;
  name: string;
  archive?: boolean;
  billing?: {
    clientId?: string;
    clientName?: string;
    companyId?: string;
    companyName?: string;
  };
}

/** Les projets vivants qui portent bien un client rapproché, mis en forme pour l'appelant. */
function clientsRapproches(projets: ProjetAvecClient[]): ClientRapproche[] {
  const out: ClientRapproche[] = [];
  for (const p of projets) {
    if (p.archive) continue;
    const b = p.billing;
    if (!b || !b.clientId || !b.clientName) continue;
    const entree: ClientRapproche = {
      projet: { id: p.id, nom: p.name },
      client: { id: b.clientId, nom: b.clientName },
    };
    if (b.companyId && b.companyName) entree.entreprise = { id: b.companyId, nom: b.companyName };
    out.push(entree);
  }
  return out;
}

/**
 * La liste des clients rapprochés d'un projet, filtrée sur le NOM du client
 * OU sur celui de son ENTREPRISE quand une recherche est donnée — sans
 * accents ni casse, sur une PARTIE du nom : « dupont » retrouve « Dupont &
 * Fils SA », et « groupe léa » retrouve un client rattaché à l'entreprise
 * « Groupe Léa » même si son propre nom ne le porte pas. Sans recherche, la
 * liste entière est rendue.
 */
export function rechercherClientsParNom(projets: ProjetAvecClient[], recherche?: string): ClientRapproche[] {
  const tous = clientsRapproches(projets);
  const q = recherche?.trim();
  if (!q) return tous;
  const cible = forme(q);
  return tous.filter((c) => forme(c.client.nom).includes(cible) || (c.entreprise && forme(c.entreprise.nom).includes(cible)));
}
