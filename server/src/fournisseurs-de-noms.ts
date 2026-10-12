import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { FOURNISSEURS_DE_NOMS, type FournisseurDeNoms } from '@beluga/shared';
import { listerAcces } from './coffre-fort.js';

const execFileAsync = promisify(execFile);

/**
 * LES FOURNISSEURS DE NOMS — cinq façons de poser l'enregistrement « A » d'un
 * projet, derrière UNE interface.
 *
 * `dns.ts` ne connaissait qu'Hetzner : une installation dont le domaine vit
 * ailleurs n'avait que la règle « tous les noms » (joker) pour s'en sortir.
 * Chaque fournisseur est ici un PILOTE qui sait trois gestes — créer, constater,
 * retirer — et rien d'autre : l'ordre critique (enregistrement, propagation
 * vérifiée, reverse-proxy) reste tenu par `dns.ts`, qui ne sait pas à qui il
 * parle.
 *
 * DEUX RÈGLES VALENT POUR TOUS :
 *  - un pilote n'écrit QUE le nom demandé. Un nom déjà présent avec la bonne
 *    adresse est un succès ; présent avec une AUTRE adresse, il est laissé tel
 *    quel et le refus le dit — un projet nommé comme un enregistrement existant
 *    (`www`, `mail`…) ne doit jamais le détourner ;
 *  - un pilote ne lève pas pour un refus du fournisseur : il rend la RAISON, en
 *    clair. Seule une panne de transport (réseau, délai) lève, et `dns.ts` la
 *    rattrape.
 *
 * Chaque pilote reçoit sa fonction de requête : les tests rejouent les échanges
 * sur des réponses simulées, aucune zone réelle n'est jamais touchée.
 */

/** Un fournisseur que le démon PILOTE : tous, sauf la règle « tous les noms ». */
export type FournisseurPilote = Exclude<FournisseurDeNoms, 'joker'>;

export interface PiloteDeNoms {
  /** Pose `<nom>.<zone>` → `ip`. `null` : le nom mène à cette adresse ; sinon la raison du refus. */
  creerA(zone: string, nom: string, ip: string): Promise<string | null>;
  /** Le nom a-t-il un enregistrement « A » ? Lève si le fournisseur ne permet pas de le savoir. */
  existeA(zone: string, nom: string): Promise<boolean>;
  /** Retire le « A » de `<nom>.<zone>`. `null` : il n'y est plus (ou n'y était pas) ; sinon la raison. */
  supprimerA(zone: string, nom: string): Promise<string | null>;
}

/** Le nom de chaque fournisseur, tel qu'il se lit dans un message. */
const NOMS: Readonly<Record<FournisseurPilote, string>> = {
  hetzner: 'Hetzner',
  cloudflare: 'Cloudflare',
  infomaniak: 'Infomaniak',
  ovh: 'OVH',
  gandi: 'Gandi',
};

/** La durée de vie posée sur chaque enregistrement : courte, un projet qui change de machine suit vite. */
const TTL = 300;

/* ------------------------------------------------------------------ */
/* Le fournisseur retenu                                                */
/* ------------------------------------------------------------------ */

/**
 * QUI TIENT LES NOMS de cette installation. La valeur réglée si elle est
 * connue. Sinon — réglage vide, ou valeur que personne ne connaît — la règle
 * d'avant ce réglage, à l'identique : Hetzner si un jeton Hetzner est connu,
 * la règle « tous les noms » sinon. L'installation en service, dont le réglage
 * est vide, ne voit donc aucune différence.
 */
export function fournisseurRetenu(regle: string, aUnJetonHetzner: boolean): FournisseurDeNoms {
  const propre = regle.trim();
  if ((FOURNISSEURS_DE_NOMS as readonly string[]).includes(propre)) return propre as FournisseurDeNoms;
  return aUnJetonHetzner ? 'hetzner' : 'joker';
}

/* ------------------------------------------------------------------ */
/* Les secrets : une fiche du coffre-fort par secret                    */
/* ------------------------------------------------------------------ */

export type GenreDeSecretDeNoms =
  | 'dns'
  | 'dns-cloudflare'
  | 'dns-infomaniak'
  | 'dns-gandi'
  | 'dns-ovh-application'
  | 'dns-ovh-secret'
  | 'dns-ovh-consommateur';

/** La fiche du coffre-fort attendue pour UN secret d'un fournisseur. */
export interface SecretDeFournisseur {
  genre: GenreDeSecretDeNoms;
  /** Le nom de la fiche à créer quand le secret est saisi. */
  nom: string;
  type: 'jeton' | 'cle-api';
  service: string;
  /** Le champ de la fiche qui porte la valeur. */
  champ: 'jeton' | 'cle';
  /** Reconnaît la fiche à « <service> <nom> ». */
  motif: RegExp;
  /** Comment le secret se nomme dans une phrase d'erreur : « le jeton », « la clé de consommateur ». */
  designation: string;
}

/*
 * OVH demande TROIS secrets, donc trois fiches — jamais regroupées, le coffre
 * refuse une fiche qui en porte plusieurs. Elles partagent le service « OVH » :
 * c'est le NOM qui les départage. « secret d'application » contient aussi
 * « application » : le motif de la clé d'application écarte donc ce mot-là,
 * sinon la même fiche répondrait aux deux.
 */
export const SECRETS_DES_FOURNISSEURS: Readonly<Record<FournisseurPilote, readonly SecretDeFournisseur[]>> = {
  hetzner: [
    {
      genre: 'dns',
      nom: 'Hetzner — jeton du nom de domaine',
      type: 'jeton',
      service: 'Hetzner',
      champ: 'jeton',
      motif: /hetzner/i,
      designation: 'le jeton',
    },
  ],
  cloudflare: [
    {
      genre: 'dns-cloudflare',
      nom: 'Cloudflare — jeton du nom de domaine',
      type: 'jeton',
      service: 'Cloudflare',
      champ: 'jeton',
      motif: /cloudflare/i,
      designation: 'le jeton',
    },
  ],
  infomaniak: [
    {
      genre: 'dns-infomaniak',
      nom: 'Infomaniak — jeton du nom de domaine',
      type: 'jeton',
      service: 'Infomaniak',
      champ: 'jeton',
      motif: /infomaniak/i,
      designation: 'le jeton',
    },
  ],
  ovh: [
    {
      genre: 'dns-ovh-application',
      nom: 'OVH — clé d’application du nom de domaine',
      type: 'cle-api',
      service: 'OVH',
      champ: 'cle',
      motif: /^(?=.*ovh)(?!.*secret)(?=.*application)/i,
      designation: "la clé d'application",
    },
    {
      genre: 'dns-ovh-secret',
      nom: 'OVH — secret d’application du nom de domaine',
      type: 'cle-api',
      service: 'OVH',
      champ: 'cle',
      motif: /^(?=.*ovh)(?=.*secret)/i,
      designation: "le secret d'application",
    },
    {
      genre: 'dns-ovh-consommateur',
      nom: 'OVH — clé de consommateur du nom de domaine',
      type: 'cle-api',
      service: 'OVH',
      champ: 'cle',
      motif: /^(?=.*ovh)(?=.*consommateur)/i,
      designation: 'la clé de consommateur',
    },
  ],
  gandi: [
    {
      genre: 'dns-gandi',
      nom: 'Gandi — jeton du nom de domaine',
      type: 'jeton',
      service: 'Gandi',
      champ: 'jeton',
      motif: /gandi/i,
      designation: 'le jeton',
    },
  ],
};

/** Ce qu'il faut d'une fiche du coffre pour y reconnaître un secret. */
type FicheLue = { nom: string; type: string; champs: Record<string, string> };

/**
 * D'OÙ VIENNENT LES SECRETS. Deux sources, remplaçables ensemble : les tests
 * jugent la reconnaissance des fiches sans ouvrir le coffre réel ni lire le
 * fichier de la machine.
 */
export interface SourcesDeSecrets {
  /** Le jeton Hetzner gardé dans le fichier du serveur ; vide s'il n'y en a pas. */
  fichierHetzner(): Promise<string>;
  /** Les fiches actives du coffre-fort. */
  fiches(): readonly FicheLue[];
}

const SOURCES_REELLES: SourcesDeSecrets = {
  // Les installations d'avant le coffre-fort gardent leur jeton dans ce fichier.
  async fichierHetzner() {
    const { stdout } = await execFileAsync(
      'sudo',
      ['-n', 'grep', '-oP', 'HETZNER_API_TOKEN=\\K.*', '/etc/beluga/jeton-hetzner'],
      { timeout: 15000 },
    );
    return stdout.trim().replace(/^["']|["']$/g, '');
  },
  fiches: () => listerAcces(),
};

export interface SecretsLus {
  /** Les valeurs trouvées, rangées par genre de secret. */
  valeurs: Partial<Record<GenreDeSecretDeNoms, string>>;
  /** Vide quand tout y est ; sinon la phrase qui dit ce qui manque et où le régler. */
  manque: string;
}

/** « a », « a et b », « a, b et c ». */
function enumerer(mots: readonly string[]): string {
  return mots.length <= 1 ? (mots[0] ?? '') : `${mots.slice(0, -1).join(', ')} et ${mots[mots.length - 1]}`;
}

/**
 * LES SECRETS D'UN FOURNISSEUR, lus là où ils vivent.
 *
 * Chaque secret est UNE fiche du coffre-fort, reconnue à son service (ou à son
 * nom) : c'est là que l'assistant de démarrage et les réglages rangent ce qui
 * est saisi. Hetzner garde en plus sa lecture d'origine — le fichier du serveur
 * d'abord, le coffre ensuite — pour que l'installation en service ne bouge pas.
 *
 * Un coffre illisible vaut « aucun secret » : la publication retombe alors sur
 * le nom déjà existant, et le dit.
 */
export async function secretsDuFournisseur(
  fournisseur: FournisseurPilote,
  sources: SourcesDeSecrets = SOURCES_REELLES,
): Promise<SecretsLus> {
  const attendus = SECRETS_DES_FOURNISSEURS[fournisseur];
  const valeurs: Partial<Record<GenreDeSecretDeNoms, string>> = {};

  if (fournisseur === 'hetzner') {
    try {
      const duFichier = await sources.fichierHetzner();
      if (duFichier) valeurs.dns = duFichier;
    } catch {
      /* pas de fichier : on regarde le coffre */
    }
  }

  let fiches: readonly FicheLue[] = [];
  try {
    fiches = sources.fiches();
  } catch {
    /* coffre illisible : aucun secret n'en sort */
  }
  for (const attendu of attendus) {
    if (valeurs[attendu.genre]) continue;
    const fiche = fiches.find(
      (une) => (une.type === 'jeton' || une.type === 'cle-api') && attendu.motif.test(`${une.champs.service ?? ''} ${une.nom}`),
    );
    const duCoffre = String(fiche?.champs.jeton ?? fiche?.champs.cle ?? '').trim();
    if (duCoffre) valeurs[attendu.genre] = duCoffre;
  }

  const manquants = attendus.filter((attendu) => !valeurs[attendu.genre]);
  if (!manquants.length) return { valeurs, manque: '' };
  const nom = NOMS[fournisseur];
  // « de Cloudflare », mais « d'Infomaniak » : la phrase est lue par quelqu'un.
  const duFournisseur = /^[aeiouy]/i.test(nom) ? `d'${nom}` : `de ${nom}`;
  const manque =
    attendus.length === 1
      ? `le jeton ${duFournisseur} manque : il se règle dans Réglages, page Installation`
      : `${enumerer(manquants.map((m) => m.designation))} ${manquants.length > 1 ? 'manquent' : 'manque'} pour ${nom} : ` +
        'cela se règle dans Réglages, page Installation';
  return { valeurs, manque };
}

/* ------------------------------------------------------------------ */
/* Ce que les pilotes partagent                                         */
/* ------------------------------------------------------------------ */

interface Reponse {
  ok: boolean;
  statut: number;
  texte: string;
  /** Le corps lu comme du JSON ; `null` s'il n'en est pas. */
  json: any;
}

/** Une requête et sa réponse LUE : le corps ne se lit qu'une fois, autant le garder sous ses deux formes. */
async function appeler(requete: typeof fetch, url: string, init: RequestInit, delai = 20000): Promise<Reponse> {
  const res = await requete(url, { ...init, signal: AbortSignal.timeout(delai) });
  const texte = await res.text();
  let json: any = null;
  try {
    json = texte ? JSON.parse(texte) : null;
  } catch {
    /* une page d'erreur qui n'est pas du JSON : le texte suffira */
  }
  return { ok: res.ok, statut: res.status, texte, json };
}

/** Le refus d'un fournisseur, en une phrase : son nom, le code, et ce qu'il en dit quand il le dit. */
function refus(fournisseur: FournisseurPilote, statut: number, detail?: unknown): string {
  const dit = typeof detail === 'string' ? detail.trim().slice(0, 200) : '';
  return `${NOMS[fournisseur]} a refusé (${statut})${dit ? ` : ${dit}` : ''}`;
}

/** Le nom existe, mais mène ailleurs : il n'est PAS remplacé, et on dit où il mène. */
function dejaAilleurs(fournisseur: FournisseurPilote, nomEntier: string, cibles: readonly string[]): string {
  return (
    `${nomEntier} existe déjà chez ${NOMS[fournisseur]} et mène à ${enumerer(cibles) || 'une autre adresse'} : ` +
"il n'a pas été remplacé. Choisissez un autre nom, ou retirez cet enregistrement chez le fournisseur."
  );
}

/* ------------------------------------------------------------------ */
/* Hetzner — la logique d'origine de dns.ts, déplacée sans y toucher    */
/* ------------------------------------------------------------------ */

const API_HETZNER = 'https://api.hetzner.cloud/v1/zones';

function piloteHetzner(jeton: string, requete: typeof fetch): PiloteDeNoms {
  /**
   * L'identifiant interne de la zone chez Hetzner, cherché par son nom — ET la
   * preuve que cette zone commande vraiment le nom sur Internet.
   *
   * Une zone peut exister chez le fournisseur sans que le registrar lui ait confié
   * le domaine : Hetzner l'annonce alors en `delegation_status: "invalid"`. Écrire
   * dedans réussit, renvoie 201, et ne change STRICTEMENT rien pour personne.
   * C'est ce qui s'est passé pendant trois semaines sur une installation, sans
   * que rien ne le signale — un joker DNS chez l'ancien fournisseur renvoyait
   * n'importe quel nom vers le serveur, si bien que l'attente de propagation
   * se croyait satisfaite alors qu'aucun enregistrement n'existait.
   */
  async function zoneChezHetzner(zone: string): Promise<{ id: number } | { erreur: string }> {
    const res = await requete(`${API_HETZNER}?name=${encodeURIComponent(zone)}`, {
      headers: { authorization: `Bearer ${jeton}` },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return { erreur: `le fournisseur de noms ne répond pas (${res.status})` };
    const body = (await res.json()) as {
      zones?: Array<{ id: number; name: string; assigned_nameservers?: { delegation_status?: string } }>;
    };
    const trouvee = body.zones?.find((z) => z.name === zone);
    if (!trouvee) return { erreur: `zone ${zone} introuvable chez le fournisseur de noms` };

    const delegation = trouvee.assigned_nameservers?.delegation_status;
    if (delegation && delegation !== 'valid') {
      return {
        erreur:
          `la zone ${zone} existe chez le fournisseur mais ne commande pas encore le domaine ` +
          `(délégation « ${delegation} ») : y écrire n'aurait aucun effet. Le registrar doit ` +
          `d'abord pointer le domaine vers les serveurs de noms de ce fournisseur.`,
      };
    }
    return { id: trouvee.id };
  }

  return {
    async creerA(zone, nom, ip) {
      const z = await zoneChezHetzner(zone);
      if ('erreur' in z) return z.erreur;
      // L'enregistrement est ajouté seul : les autres noms ne sont pas touchés.
      const res = await requete(`${API_HETZNER}/${z.id}/rrsets`, {
        method: 'POST',
        headers: { authorization: `Bearer ${jeton}`, 'content-type': 'application/json' },
        body: JSON.stringify({ name: nom, type: 'A', ttl: TTL, records: [{ value: ip }] }),
        signal: AbortSignal.timeout(30000),
      });
      if (res.ok) return null;
      const body = await res.text();
      // Un conflit dit « ce nom existe déjà », ce qui est le résultat voulu —
      // mais un vrai refus porte le même code. On ne conclut donc pas sur le
      // code seul : on relit la zone pour voir si l'enregistrement y est.
      const conflit = /conflict|already|exist/i.test(body) || res.status === 409 || res.status === 422;
      if (!conflit) return `le fournisseur a refusé (${res.status})`;
      const relu = await requete(`${API_HETZNER}/${z.id}/rrsets/${encodeURIComponent(nom)}/A`, {
        headers: { authorization: `Bearer ${jeton}` },
        signal: AbortSignal.timeout(20000),
      });
      return relu.ok ? null : `le fournisseur a refusé (${res.status}) et le nom n'existe pas`;
    },

    async existeA(zone, nom) {
      const z = await zoneChezHetzner(zone);
      if ('erreur' in z) throw new Error(z.erreur);
      const res = await requete(`${API_HETZNER}/${z.id}/rrsets/${encodeURIComponent(nom)}/A`, {
        headers: { authorization: `Bearer ${jeton}` },
        signal: AbortSignal.timeout(20000),
      });
      if (res.ok) return true;
      if (res.status === 404) return false;
      throw new Error(`le fournisseur a refusé (${res.status})`);
    },

    async supprimerA(zone, nom) {
      const z = await zoneChezHetzner(zone);
      if ('erreur' in z) return z.erreur;
      const res = await requete(`${API_HETZNER}/${z.id}/rrsets/${encodeURIComponent(nom)}/A`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${jeton}` },
        signal: AbortSignal.timeout(20000),
      });
      return !res.ok && res.status !== 404 ? `le fournisseur a refusé (${res.status})` : null;
    },
  };
}

/* ------------------------------------------------------------------ */
/* Cloudflare                                                           */
/* ------------------------------------------------------------------ */

const API_CLOUDFLARE = 'https://api.cloudflare.com/client/v4';

/*
 * Un jeton d'API à portée réduite (droit « Zone → DNS → Modifier » sur la zone).
 * Toutes les réponses ont la même enveloppe : `{ success, errors: [{ code,
 * message }], result }`.
 *
 * Cloudflare accepte PLUSIEURS « A » sous un même nom (répartition) : poster
 * sans regarder ajouterait une seconde adresse à un nom existant, et la moitié
 * des visites partiraient ailleurs. La création LIT donc d'abord.
 *
 * `proxied: false` : le nom mène droit à ce serveur. Derrière le relais de
 * Cloudflare, la vérification de propagation ne verrait jamais notre adresse,
 * et le certificat ne s'émettrait pas par le chemin habituel.
 */
function piloteCloudflare(jeton: string, requete: typeof fetch): PiloteDeNoms {
  const entetes = { authorization: `Bearer ${jeton}`, 'content-type': 'application/json' };
  const ditPar = (r: Reponse): string | undefined => r.json?.errors?.[0]?.message;

  async function idDeZone(zone: string): Promise<{ id: string } | { erreur: string }> {
    const r = await appeler(requete, `${API_CLOUDFLARE}/zones?name=${encodeURIComponent(zone)}`, { headers: entetes });
    if (!r.ok || r.json?.success === false) return { erreur: refus('cloudflare', r.statut, ditPar(r)) };
    const trouvee = (r.json?.result as Array<{ id: string; name: string }> | undefined)?.find((z) => z.name === zone);
    return trouvee
      ? { id: trouvee.id }
      : { erreur: `zone ${zone} introuvable chez Cloudflare : le jeton doit avoir le droit de modifier le DNS de cette zone` };
  }

  /** Les « A » posés sous ce nom, avec l'adresse où chacun mène. */
  async function enregistrements(id: string, nomEntier: string): Promise<{ liste: Array<{ id: string; content: string }> } | { erreur: string }> {
    const r = await appeler(
      requete,
      `${API_CLOUDFLARE}/zones/${id}/dns_records?type=A&name=${encodeURIComponent(nomEntier)}`,
      { headers: entetes },
    );
    if (!r.ok || r.json?.success === false) return { erreur: refus('cloudflare', r.statut, ditPar(r)) };
    const recus = (r.json?.result ?? []) as Array<{ id: string; type?: string; name?: string; content: string }>;
    // Le filtre de l'adresse suffit en principe ; on le redit ici pour ne jamais
    // toucher un autre nom si le fournisseur venait à répondre plus large.
    return { liste: recus.filter((e) => (e.type ?? 'A') === 'A' && (e.name ?? nomEntier).toLowerCase() === nomEntier) };
  }

  return {
    async creerA(zone, nom, ip) {
      const z = await idDeZone(zone);
      if ('erreur' in z) return z.erreur;
      const nomEntier = `${nom}.${zone}`;
      const avant = await enregistrements(z.id, nomEntier);
      if ('erreur' in avant) return avant.erreur;
      if (avant.liste.some((e) => e.content === ip)) return null;
      if (avant.liste.length) return dejaAilleurs('cloudflare', nomEntier, avant.liste.map((e) => e.content));

      const r = await appeler(
        requete,
        `${API_CLOUDFLARE}/zones/${z.id}/dns_records`,
        { method: 'POST', headers: entetes, body: JSON.stringify({ type: 'A', name: nomEntier, content: ip, ttl: TTL, proxied: false }) },
        30000,
      );
      if (r.ok && r.json?.success !== false) return null;
      // Un refus peut vouloir dire « posé entre-temps » : on relit avant de conclure.
      const apres = await enregistrements(z.id, nomEntier);
      if (!('erreur' in apres) && apres.liste.some((e) => e.content === ip)) return null;
      return refus('cloudflare', r.statut, ditPar(r));
    },

    async existeA(zone, nom) {
      const z = await idDeZone(zone);
      if ('erreur' in z) throw new Error(z.erreur);
      const lus = await enregistrements(z.id, `${nom}.${zone}`);
      if ('erreur' in lus) throw new Error(lus.erreur);
      return lus.liste.length > 0;
    },

    async supprimerA(zone, nom) {
      const z = await idDeZone(zone);
      if ('erreur' in z) return z.erreur;
      const lus = await enregistrements(z.id, `${nom}.${zone}`);
      if ('erreur' in lus) return lus.erreur;
      for (const e of lus.liste) {
        const r = await appeler(requete, `${API_CLOUDFLARE}/zones/${z.id}/dns_records/${encodeURIComponent(e.id)}`, {
          method: 'DELETE',
          headers: entetes,
        });
        if (!r.ok && r.statut !== 404) return refus('cloudflare', r.statut, ditPar(r));
      }
      return null;
    },
  };
}

/* ------------------------------------------------------------------ */
/* Infomaniak                                                           */
/* ------------------------------------------------------------------ */

const API_INFOMANIAK = 'https://api.infomaniak.com/2/zones';

/*
 * API v2 des zones DNS, jeton aux portées `dns:read` et `dns:write`.
 *
 * CE QUI EST ÉTABLI — par un client public qui s'en sert tel quel (le greffon
 * « InfomaniakV2 » de Posh-ACME), le portail developer.infomaniak.com ne se
 * lisant pas hors d'un navigateur :
 *  - `GET /2/zones/{zone}/records` rend `{ result: 'success', data: [...] }`,
 *    chaque enregistrement portant `id`, `type`, `source` (nom RELATIF à la
 *    zone, « . » pour la racine) et `target` ;
 *  - `POST /2/zones/{zone}/records` prend `{ type, source, target, ttl }` ;
 *  - `DELETE /2/zones/{zone}/records/{id}` ;
 *  - une zone absente du compte répond 404 (`object_not_found`).
 *
 * CE QUI N'A PAS PU ÊTRE CONFIRMÉ, et que le code traite donc prudemment :
 *  - la forme exacte d'une erreur (`{ result: 'error', error: { code,
 *    description } }` d'après les autres API d'Infomaniak) : le détail est lu
 *    s'il est là, le code HTTP est toujours dit ;
 *  - la réponse à un doublon : on ne s'appuie pas dessus, la création LIT la
 *    zone avant d'écrire, et relit après un refus ;
 *  - une éventuelle pagination de la liste, ou un filtre par nom : la liste est
 *    lue d'un bloc et filtrée ici. Sur une zone très longue, un nom existant
 *    pourrait ne pas être vu — le refus du fournisseur resterait alors dit ;
 *  - que `source` ne revienne jamais sous sa forme entière : les deux formes
 *    sont acceptées à la lecture.
 */
function piloteInfomaniak(jeton: string, requete: typeof fetch): PiloteDeNoms {
  const entetes = { authorization: `Bearer ${jeton}`, 'content-type': 'application/json', accept: 'application/json' };
  const base = (zone: string) => `${API_INFOMANIAK}/${encodeURIComponent(zone)}/records`;
  const ditPar = (r: Reponse): string | undefined =>
    r.json?.error?.description ?? r.json?.error?.message ?? (typeof r.json?.error === 'string' ? r.json.error : undefined);
  const refuse = (r: Reponse) => !r.ok || r.json?.result === 'error';

  /** Les « A » posés sous ce nom, avec l'adresse où chacun mène. */
  async function enregistrements(zone: string, nom: string): Promise<{ liste: Array<{ id: string; target: string }> } | { erreur: string }> {
    const r = await appeler(requete, base(zone), { headers: entetes });
    if (r.statut === 404) return { erreur: `zone ${zone} introuvable chez Infomaniak : le jeton doit pouvoir lire et écrire son DNS` };
    if (refuse(r)) return { erreur: refus('infomaniak', r.statut, ditPar(r)) };
    const recus = (Array.isArray(r.json?.data) ? r.json.data : []) as Array<{ id: number | string; type?: string; source?: string; target?: string }>;
    return {
      liste: recus
        .filter((e) => e.type === 'A' && (e.source === nom || e.source === `${nom}.${zone}`))
        .map((e) => ({ id: String(e.id), target: String(e.target ?? '') })),
    };
  }

  return {
    async creerA(zone, nom, ip) {
      const avant = await enregistrements(zone, nom);
      if ('erreur' in avant) return avant.erreur;
      if (avant.liste.some((e) => e.target === ip)) return null;
      if (avant.liste.length) return dejaAilleurs('infomaniak', `${nom}.${zone}`, avant.liste.map((e) => e.target));

      const r = await appeler(
        requete,
        base(zone),
        { method: 'POST', headers: entetes, body: JSON.stringify({ source: nom, type: 'A', target: ip, ttl: TTL }) },
        30000,
      );
      if (!refuse(r)) return null;
      // Un refus peut vouloir dire « posé entre-temps » : on relit avant de conclure.
      const apres = await enregistrements(zone, nom);
      if (!('erreur' in apres) && apres.liste.some((e) => e.target === ip)) return null;
      return refus('infomaniak', r.statut, ditPar(r));
    },

    async existeA(zone, nom) {
      const lus = await enregistrements(zone, nom);
      if ('erreur' in lus) throw new Error(lus.erreur);
      return lus.liste.length > 0;
    },

    async supprimerA(zone, nom) {
      const lus = await enregistrements(zone, nom);
      if ('erreur' in lus) return lus.erreur;
      for (const e of lus.liste) {
        const r = await appeler(requete, `${base(zone)}/${encodeURIComponent(e.id)}`, { method: 'DELETE', headers: entetes });
        if (refuse(r) && r.statut !== 404) return refus('infomaniak', r.statut, ditPar(r));
      }
      return null;
    },
  };
}

/* ------------------------------------------------------------------ */
/* OVH                                                                  */
/* ------------------------------------------------------------------ */

const API_OVH = 'https://eu.api.ovh.com/1.0';

interface SecretsOvh {
  application: string;
  secret: string;
  consommateur: string;
}

/*
 * Trois secrets, et CHAQUE requête est signée :
 *   "$1$" + sha1(secret + "+" + clé de consommateur + "+" + MÉTHODE + "+" + adresse + "+" + corps + "+" + heure)
 * L'heure est celle d'OVH (`GET /auth/time`), pas celle de cette machine : une
 * horloge décalée de quelques dizaines de secondes ferait refuser toutes les
 * signatures. L'écart est mesuré une fois par pilote, puis appliqué.
 *
 * DEUX PARTICULARITÉS :
 *  - une écriture ne compte qu'une fois la zone RECHARGÉE (`POST …/refresh`).
 *    Le rechargement est rejoué même quand le nom était déjà là : un essai
 *    précédent a pu poser l'enregistrement sans arriver jusqu'au rechargement ;
 *  - OVH accepte plusieurs enregistrements identiques sous un même nom : la
 *    création LIT d'abord, elle ne s'en remet pas à un refus pour doublon.
 */
function piloteOvh(secrets: SecretsOvh, requete: typeof fetch): PiloteDeNoms {
  let ecart: number | null = null;
  const ditPar = (r: Reponse): string | undefined => r.json?.message;
  const zoneDe = (zone: string) => `/domain/zone/${encodeURIComponent(zone)}`;

  async function heure(): Promise<number> {
    if (ecart === null) {
      const r = await appeler(requete, `${API_OVH}/auth/time`, {});
      const lue = Number.parseInt(r.texte.trim(), 10);
      // Sans heure lue, on signe avec la nôtre : OVH dira lui-même si elle ne convient pas.
      ecart = r.ok && Number.isFinite(lue) ? lue - Math.floor(Date.now() / 1000) : 0;
    }
    return Math.floor(Date.now() / 1000) + ecart;
  }

  async function appel(methode: 'GET' | 'POST' | 'DELETE', chemin: string, corps?: unknown): Promise<Reponse> {
    const url = `${API_OVH}${chemin}`;
    const texte = corps === undefined ? '' : JSON.stringify(corps);
    const instant = String(await heure());
    const signature =
      '$1$' +
      crypto
        .createHash('sha1')
        .update([secrets.secret, secrets.consommateur, methode, url, texte, instant].join('+'))
        .digest('hex');
    return appeler(
      requete,
      url,
      {
        method: methode,
        headers: {
          'X-Ovh-Application': secrets.application,
          'X-Ovh-Consumer': secrets.consommateur,
          'X-Ovh-Timestamp': instant,
          'X-Ovh-Signature': signature,
          'content-type': 'application/json',
        },
        ...(texte ? { body: texte } : {}),
      },
      30000,
    );
  }

  /** Les identifiants des « A » posés sous ce nom. */
  async function identifiants(zone: string, nom: string): Promise<{ ids: number[] } | { erreur: string }> {
    const r = await appel('GET', `${zoneDe(zone)}/record?fieldType=A&subDomain=${encodeURIComponent(nom)}`);
    if (r.statut === 404) return { erreur: `zone ${zone} introuvable chez OVH : les clés doivent avoir accès à /domain/zone/${zone}` };
    if (!r.ok) return { erreur: refus('ovh', r.statut, ditPar(r)) };
    return { ids: Array.isArray(r.json) ? (r.json as number[]) : [] };
  }

  /** Rend la zone servie telle qu'elle vient d'être écrite. */
  async function recharger(zone: string): Promise<string | null> {
    const r = await appel('POST', `${zoneDe(zone)}/refresh`);
    return r.ok
      ? null
      : `la zone ${zone} est écrite chez OVH mais n'a pas pu être rechargée (${r.statut}) : tant qu'elle ne l'est pas, le changement n'est pas servi`;
  }

  return {
    async creerA(zone, nom, ip) {
      const avant = await identifiants(zone, nom);
      if ('erreur' in avant) return avant.erreur;
      if (avant.ids.length) {
        const cibles: string[] = [];
        for (const id of avant.ids) {
          const r = await appel('GET', `${zoneDe(zone)}/record/${id}`);
          if (!r.ok) return refus('ovh', r.statut, ditPar(r));
          cibles.push(String(r.json?.target ?? ''));
        }
        return cibles.includes(ip) ? recharger(zone) : dejaAilleurs('ovh', `${nom}.${zone}`, cibles);
      }
      const r = await appel('POST', `${zoneDe(zone)}/record`, { fieldType: 'A', subDomain: nom, target: ip, ttl: TTL });
      if (!r.ok) return refus('ovh', r.statut, ditPar(r));
      return recharger(zone);
    },

    async existeA(zone, nom) {
      const lus = await identifiants(zone, nom);
      if ('erreur' in lus) throw new Error(lus.erreur);
      return lus.ids.length > 0;
    },

    async supprimerA(zone, nom) {
      const lus = await identifiants(zone, nom);
      if ('erreur' in lus) return lus.erreur;
      if (!lus.ids.length) return null;
      for (const id of lus.ids) {
        const r = await appel('DELETE', `${zoneDe(zone)}/record/${id}`);
        if (!r.ok && r.statut !== 404) return refus('ovh', r.statut, ditPar(r));
      }
      return recharger(zone);
    },
  };
}

/* ------------------------------------------------------------------ */
/* Gandi                                                                */
/* ------------------------------------------------------------------ */

const API_GANDI = 'https://api.gandi.net/v5/livedns';

/*
 * LiveDNS, jeton d'accès personnel (`Authorization: Bearer`). L'enregistrement
 * a sa propre adresse : `/domains/{zone}/records/{nom}/A`.
 *
 * `PUT` REMPLACE ce qui s'y trouve : posé sans regarder, il détournerait un nom
 * existant sans rien dire. La création LIT donc d'abord (404 = le nom est
 * libre), et n'écrit que sur un nom libre.
 */
function piloteGandi(jeton: string, requete: typeof fetch): PiloteDeNoms {
  const entetes = { authorization: `Bearer ${jeton}`, 'content-type': 'application/json' };
  const adresse = (zone: string, nom: string) =>
    `${API_GANDI}/domains/${encodeURIComponent(zone)}/records/${encodeURIComponent(nom)}/A`;
  const ditPar = (r: Reponse): string | undefined => r.json?.message;

  /** Les adresses où mène le nom ; `null` s'il n'a pas de « A ». */
  async function cibles(zone: string, nom: string): Promise<{ valeurs: string[] | null } | { erreur: string }> {
    const r = await appeler(requete, adresse(zone, nom), { headers: entetes });
    if (r.statut === 404) return { valeurs: null };
    if (!r.ok) return { erreur: refus('gandi', r.statut, ditPar(r)) };
    return { valeurs: Array.isArray(r.json?.rrset_values) ? (r.json.rrset_values as string[]) : [] };
  }

  return {
    async creerA(zone, nom, ip) {
      const avant = await cibles(zone, nom);
      if ('erreur' in avant) return avant.erreur;
      if (avant.valeurs?.includes(ip)) return null;
      if (avant.valeurs?.length) return dejaAilleurs('gandi', `${nom}.${zone}`, avant.valeurs);
      const r = await appeler(
        requete,
        adresse(zone, nom),
        { method: 'PUT', headers: entetes, body: JSON.stringify({ rrset_values: [ip], rrset_ttl: TTL }) },
        30000,
      );
      return r.ok ? null : refus('gandi', r.statut, ditPar(r));
    },

    async existeA(zone, nom) {
      const lus = await cibles(zone, nom);
      if ('erreur' in lus) throw new Error(lus.erreur);
      return lus.valeurs !== null;
    },

    async supprimerA(zone, nom) {
      const r = await appeler(requete, adresse(zone, nom), { method: 'DELETE', headers: entetes });
      return !r.ok && r.statut !== 404 ? refus('gandi', r.statut, ditPar(r)) : null;
    },
  };
}

/* ------------------------------------------------------------------ */
/* Le pilote d'un fournisseur, à partir de ses secrets                  */
/* ------------------------------------------------------------------ */

/**
 * Construit le pilote d'un fournisseur. Les secrets sont ceux rendus par
 * `secretsDuFournisseur` : l'appelant ne construit un pilote que lorsque rien
 * n'y manque. `requete` se remplace pour rejouer les échanges sans réseau.
 */
export function piloteDeNoms(
  fournisseur: FournisseurPilote,
  valeurs: Partial<Record<GenreDeSecretDeNoms, string>>,
  requete: typeof fetch = fetch,
): PiloteDeNoms {
  const lu = (genre: GenreDeSecretDeNoms) => valeurs[genre] ?? '';
  switch (fournisseur) {
    case 'hetzner':
      return piloteHetzner(lu('dns'), requete);
    case 'cloudflare':
      return piloteCloudflare(lu('dns-cloudflare'), requete);
    case 'infomaniak':
      return piloteInfomaniak(lu('dns-infomaniak'), requete);
    case 'ovh':
      return piloteOvh(
        { application: lu('dns-ovh-application'), secret: lu('dns-ovh-secret'), consommateur: lu('dns-ovh-consommateur') },
        requete,
      );
    case 'gandi':
      return piloteGandi(lu('dns-gandi'), requete);
  }
}
