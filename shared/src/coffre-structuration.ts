import {
  type AccesCoffre,
  type ChampLibre,
  type TypeAcces,
  champsACompleter,
  jugerAcces,
} from './coffre-fort.js';

/**
 * LA REMISE EN ORDRE DES FICHES DU COFFRE (20/10/2026) — chaque valeur dans sa case.
 *
 * Avant les modèles par usage, une fiche n'avait que trois ou cinq cases : le
 * reste finissait dans la note ou entassé dans « Service » (« App Store Connect
 * API — Key ID …, Issuer ID …, Team ID … »). Ces règles PURES rangent chaque
 * fiche existante dans les nouvelles cases, SANS RIEN PERDRE :
 *
 *  - des règles générales (le moteur d'une base, les identifiants entassés dans
 *    « Service », l'adresse d'un jeton, la clé publique d'un accès SSH…) ;
 *  - quelques reprises fiche par fiche (`REPRISES`), désignées par le début de
 *    leur identifiant, quand le sens ne se devine pas (un compte ouvert par
 *    Google, une carte bancaire rangée en « mot de passe »…). Elles ne recopient
 *    AUCUNE valeur : elles la lisent dans la fiche elle-même ;
 *  - une note RÉÉCRITE garde son texte entier dans une case en plus « Note
 *    d'origine », et une valeur qu'un changement de type ferait tomber passe
 *    dans une case en plus, avec son caractère secret, jusqu'à la relecture ;
 *  - rejouer la remise en ordre sur une fiche déjà rangée ne change plus rien.
 *
 * Le démon l'applique UNE fois (`server/src/coffre-structuration.ts`), après une
 * copie de sécurité sur le disque de stockage ; `scripts/structurer-coffre.mjs`
 * en montre le plan à blanc.
 */

/** Ce que la remise en ordre change d'une fiche. */
export interface FicheStructuree {
  type: TypeAcces;
  champs: Record<string, string>;
  note: string;
  champsLibres: ChampLibre[];
}

/** Une fiche NEUVE née d'une autre (une pièce d'identité qui en portait deux). */
export interface FicheNee extends FicheStructuree {
  nom: string;
}

export interface Structuration {
  apres: FicheStructuree;
  /** Une phrase par changement, pour la liste à relire. */
  changements: string[];
  creer?: FicheNee[];
}

export const LIBELLE_NOTE_D_ORIGINE = 'Note d’origine';

const nettoyer = (v: string) =>
  v
    .replace(/\(\s*\)/g, '')
    .replace(/\s*,\s*(?=[,)—]|$)/g, '')
    .replace(/\(\s*,\s*/g, '(')
    .replace(/\s+—\s*(?=—|,|$)/g, '')
    .replace(/—\s*\(/g, '(')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s,—-]+|[\s,—-]+$/g, '')
    .trim();

/** Retire un fragment d'un texte et rend le texte propre. */
function sans(texte: string, fragment: string): string {
  return nettoyer(texte.replace(fragment, ''));
}

interface Brouillon {
  type: TypeAcces;
  champs: Record<string, string>;
  note: string;
  libres: ChampLibre[];
  changements: string[];
  noteReecrite: boolean;
  creer: FicheNee[];
}

/** Pose une valeur dans une case vide ; une case déjà remplie n'est jamais écrasée. */
function poser(b: Brouillon, cle: string, valeur: string | undefined, libelle: string): boolean {
  const v = (valeur ?? '').trim();
  if (!v || (b.champs[cle] ?? '').trim()) return false;
  b.champs[cle] = v;
  b.changements.push(`${libelle} rangé dans sa case`);
  return true;
}

function reecrireNote(b: Brouillon, note: string) {
  if (note === b.note) return;
  b.note = note;
  b.noteReecrite = true;
}

function libre(b: Brouillon, libelle: string, valeur: string | undefined, secret = false) {
  const v = (valeur ?? '').trim();
  if (!v || b.libres.some((c) => c.libelle === libelle)) return;
  b.libres.push({ libelle, valeur: v, ...(secret ? { secret: true } : {}) });
  b.changements.push(`case en plus « ${libelle} »`);
}

/** Change le type ; ce que le nouveau type ne porte pas passe dans une case en plus, avec son caractère secret. */
function changerDeType(b: Brouillon, type: TypeAcces, gardes: Record<string, string>, secrets: readonly string[], libelles: Record<string, string>) {
  const avant = b.champs;
  b.changements.push(`type changé : ${b.type} → ${type}`);
  b.type = type;
  b.champs = { ...gardes };
  for (const [cle, valeur] of Object.entries(avant)) {
    if (!valeur?.trim()) continue;
    // Une valeur reprise telle quelle dans une case du nouveau type n'a pas à être recopiée.
    if (Object.values(b.champs).some((v) => v === valeur)) continue;
    libre(b, `${libelles[cle] ?? cle} (d’origine)`, valeur, secrets.includes(cle));
  }
}

const premier = (texte: string, motif: RegExp) => motif.exec(texte ?? '')?.[1]?.trim();

/* ------------------------------------------------------------------ */
/* LES RÈGLES GÉNÉRALES                                                */
/* ------------------------------------------------------------------ */

function moteurDeLaBase(b: Brouillon, nom: string) {
  if (b.type !== 'base-de-donnees') return;
  const texte = `${nom} ${b.note}`;
  const moteur = /postgres/i.test(texte) ? 'PostgreSQL' : /mysql|mariadb/i.test(texte) ? 'MySQL' : '';
  poser(b, 'moteur', moteur, 'Moteur');
}

/** « Service » d'une clé d'API : les identifiants entassés y retrouvent leurs cases. */
function serviceDeLaCle(b: Brouillon) {
  if (b.type !== 'cle-api' || !b.champs.service) return;
  let service = b.champs.service;
  const extraire = (motif: RegExp, cle: string, libelle: string) => {
    const m = motif.exec(service);
    if (!m) return;
    if (poser(b, cle, m[1], libelle) || b.champs[cle] === m[1]!.trim()) service = sans(service, m[0]);
  };
  extraire(/,?\s*Key ID ([A-Z0-9]+)/, 'identifiantCle', 'Key ID');
  extraire(/,?\s*Issuer ID ([0-9a-f-]{36})/i, 'emetteur', 'Issuer ID');
  extraire(/,?\s*Team ID ([A-Z0-9]+)/, 'equipe', 'Team ID');
  extraire(/,?\s*identifiant client ([\w.-]+)/i, 'identifiantCle', 'Identifiant client');
  extraire(/,?\s*identifiant ([\w-]+\.apps\.googleusercontent\.com)/i, 'identifiantCle', 'Identifiant client');
  extraire(/\s*—?\s*client_id ([0-9a-f-]{36})/i, 'identifiantCle', 'Identifiant client');
  // Un compte Stripe (« compte acct_… « Nom » ») quand il ferme le texte.
  const compte = /,?\s*compte (?:[A-ZÀ-Ý][\w-]* )?(acct_[A-Za-z0-9]+(?: « [^»]+ »)?)\s*$/.exec(service);
  if (compte && poser(b, 'equipe', compte[1], 'Compte Stripe')) service = sans(service, compte[0]);
  const enMode = /\((mode (?:test|réel)), (acct_[A-Za-z0-9]+)\)/.exec(service);
  if (enMode && poser(b, 'equipe', enMode[2], 'Compte Stripe')) service = service.replace(enMode[0], `(${enMode[1]})`);
  if (service !== b.champs.service) b.champs.service = service;
}

/** La note d'une clé d'API : l'identifiant client et le projet Google ont leurs cases. */
function noteDeLaCle(b: Brouillon) {
  if (b.type !== 'cle-api') return;
  poser(b, 'identifiantCle', premier(b.note, /Identifiant client\s*:\s*([\w.-]+?)\.?(?:\s|$)/i), 'Identifiant client');
  poser(b, 'identifiantCle', premier(b.note, /identifiant ([\w-]+\.apps\.googleusercontent\.com)/i), 'Identifiant client');
  poser(b, 'identifiantCle', premier(b.note, /\b[A-Z]+_CLIENT_ID=([0-9a-f-]{36})/), 'Identifiant client');
  poser(b, 'equipe', premier(b.note, /Projet Google Cloud\s*:\s*(projects\/\d+)/), 'Projet Google Cloud');
}

/** Un jeton : l'adresse où il sert sort de « Service ». */
function adresseDuJeton(b: Brouillon) {
  if (b.type !== 'jeton' || !b.champs.service) return;
  let service = b.champs.service;
  const fleche = /\s*→\s*(https?:\/\/\S+)\s*$/.exec(service);
  if (fleche && poser(b, 'adresse', fleche[1], 'Adresse')) service = sans(service, fleche[0]);
  const parentheses = /\s*\((https?:\/\/[^)\s]+)\)/.exec(service);
  if (parentheses && poser(b, 'adresse', parentheses[1], 'Adresse')) service = sans(service, parentheses[0]);
  if (service !== b.champs.service) b.champs.service = service;
}

/** Un accès SSH : la clé publique recopiée dans la note a sa case. */
function clePubliqueDuSsh(b: Brouillon) {
  if (b.type !== 'ssh') return;
  const m = /Publique\s*:\s*(ssh-(?:ed25519|rsa) [A-Za-z0-9+/=]+(?: [\w.@-]+)?)\.?/.exec(b.note);
  if (m && poser(b, 'clePublique', m[1], 'Clé publique')) reecrireNote(b, nettoyer(b.note.replace(m[0], '').replace(/\s+\./g, '.')));
}

/* ------------------------------------------------------------------ */
/* LES REPRISES FICHE PAR FICHE                                        */
/* ------------------------------------------------------------------ */

/**
 * Désignées par le DÉBUT de leur identifiant. Chacune LIT ses valeurs dans la
 * fiche : rien n'est recopié ici, et une fiche qui n'a plus la forme attendue
 * (motif absent) reste telle quelle.
 */
const REPRISES: Readonly<Record<string, (b: Brouillon, fiche: AccesCoffre) => void>> = {
  // Compte développeur Apple : tout était dans la note.
  '8fa3d73d': (b) => {
    const equipe = premier(b.note, /Team ID ([A-Z0-9]+)/);
    poser(b, 'compte', equipe ? `Team ID ${equipe}` : '', 'Team ID');
    poser(b, 'adresse', 'https://appstoreconnect.apple.com', 'Adresse');
    if (/code envoyé sur l['’]iPad/i.test(b.note)) poser(b, 'doubleAuth', 'Code envoyé sur l’iPad de l’utilisateur', 'Double authentification');
    reecrireNote(
      b,
      b.note
        .replace(/^Identifiant Apple du compte développeur/, 'Compte développeur Apple')
        .replace(/, Team ID [A-Z0-9]+/, '')
        .replace(/\s*Double authentification : code envoyé sur l['’]iPad de l['’]utilisateur\.\s*/i, ' '),
    );
  },
  // Secret client Microsoft : l'identifiant client et l'échéance ont leurs cases, le keyId du secret une case en plus.
  '29224322': (b) => {
    poser(b, 'service', 'Microsoft Entra ID — application OAuth « ProjetA »', 'Service');
    poser(b, 'expiration', premier(b.note, /EXPIRE LE (\d{4}-\d{2}-\d{2})/), 'Expiration');
    libre(b, 'Identifiant du secret (keyId)', premier(b.note, /keyId ([0-9a-f-]{36})/));
    libre(b, 'Object ID de l’application', premier(b.note, /Object ID de l['’]application\s*:\s*([0-9a-f-]{36})/));
  },
  // Compte Microsoft : sans mot de passe, un code à usage unique.
  '83a9a2d1': (b) => {
    poser(b, 'adresse', 'https://login.live.com', 'Adresse');
    poser(b, 'identifiant', premier(b.note, /login\.live\.com → ([\w.+-]+@[\w.-]+)/), 'Identifiant');
    if (/Compte SANS mot de passe/.test(b.note))
      poser(b, 'connexion', 'Code à usage unique par e-mail (« Send code »), lu dans ProjetE', 'Connexion sans mot de passe');
    poser(b, 'compte', premier(b.note, /tenant ([0-9a-f-]{36})/) ? `tenant ${premier(b.note, /tenant ([0-9a-f-]{36})/)}` : '', 'Tenant');
  },
  // Cloudflare : un compte ouvert par Google, rangé en « autre ».
  '2fc14dfa': (b) => {
    if (b.type !== 'autre') return;
    const valeur = b.champs.valeur ?? '';
    const identifiant = premier(valeur, /avec ([\w.+-]+@[\w.-]+)/);
    const compte = premier(valeur, /identifiant de compte ([0-9a-f]{32})/);
    if (!identifiant) return;
    changerDeType(
      b,
      'mot-de-passe',
      {
        adresse: 'https://dash.cloudflare.com',
        identifiant,
        connexion: '« Continuer avec Google » (aucun mot de passe Cloudflare)',
        ...(compte ? { compte } : {}),
      },
      ['valeur'],
      { valeur: 'Contenu' },
    );
  },
  // L'IBAN de versement : un compte bancaire.
  cf42b5c4: (b, fiche) => {
    if (b.type !== 'autre' || !b.champs.valeur) return;
    const titulaire = premier(fiche.nom, /\(Yuh, ([^)]+)\)/);
    changerDeType(b, 'compte-bancaire', { iban: b.champs.valeur, banque: 'Yuh', ...(titulaire ? { titulaire } : {}) }, ['valeur'], {
      valeur: 'Contenu',
    });
  },
  // La carte Mastercard rangée en « mot de passe » : une carte de paiement.
  '549efc36': (b) => {
    if (b.type !== 'mot-de-passe') return;
    const adresse = b.champs.adresse ?? '';
    changerDeType(
      b,
      'carte-paiement',
      {
        ...(b.champs.identifiant ? { numero: b.champs.identifiant } : {}),
        ...(b.champs.motDePasse ? { cryptogramme: b.champs.motDePasse } : {}),
        ...(premier(adresse, /expiration (\d{2}\/\d{4})/) ? { expiration: premier(adresse, /expiration (\d{2}\/\d{4})/)! } : {}),
        ...(premier(adresse, /titulaire ([^,]+)/) ? { titulaire: premier(adresse, /titulaire ([^,]+)/)! } : {}),
        ...(premier(adresse, /^Carte ([^,]+)/) ? { banque: premier(adresse, /^Carte ([^,]+)/)! } : {}),
      },
      ['motDePasse'],
      { adresse: 'Adresse', identifiant: 'Identifiant', motDePasse: 'Mot de passe' },
    );
  },
  // L'identité : une carte d'identité, et le permis de conduire dans sa propre fiche.
  '2b8bdffb': (b, fiche) => {
    if (b.type !== 'autre' || !b.champs.valeur) return;
    const v = b.champs.valeur;
    const nomInverse = premier(v, /^([^,]+),/);
    const nom = nomInverse ? nomInverse.split(/\s+/).reverse().join(' ') : '';
    const naissance = premier(v, /né(?:e)? le (\d{2}\.\d{2}\.\d{4})/);
    const numero = premier(v, /Carte d['’]identité n° (\w+)/);
    if (!numero) return;
    const delivrance = [premier(v, /délivrée le (\d{2}\.\d{2}\.\d{4})/), premier(v, /délivrée le [\d.]+ à ([^,]+?),/)].filter(Boolean).join(', ');
    changerDeType(
      b,
      'carte-identite',
      {
        ...(nom ? { nom } : {}),
        ...(naissance ? { naissance } : {}),
        numero,
        ...(delivrance ? { delivrance } : {}),
        ...(premier(v, /valable jusqu['’]au (\d{2}\.\d{2}\.\d{4})/) ? { expiration: premier(v, /valable jusqu['’]au (\d{2}\.\d{2}\.\d{4})/)! } : {}),
        autorite: /nationalité suisse/i.test(v) ? 'Suisse' : '',
      },
      ['valeur'],
      { valeur: 'Contenu' },
    );
    libre(b, 'Lieu d’origine', premier(v, /lieu d['’]origine ([^.]+?)\. /));
    libre(b, 'Adresse', premier(v, /Adresse : ([^.]+?)\. /));
    libre(b, 'Téléphone', premier(v, /Téléphone : ([+\d ]+)/));
    const permis = premier(v, /Permis de conduire n° (\w+)/);
    if (permis) {
      b.creer.push({
        nom: fiche.nom.replace(/identité/, 'permis de conduire'),
        type: 'permis-conduire',
        champs: {
          ...(nom ? { nom } : {}),
          ...(naissance ? { naissance } : {}),
          numero: permis,
          ...(premier(v, /Permis de conduire n° \w+, délivré le (\d{2}\.\d{2}\.\d{4})/) ? { delivrance: premier(v, /Permis de conduire n° \w+, délivré le (\d{2}\.\d{2}\.\d{4})/)! } : {}),
          autorite: /nationalité suisse/i.test(v) ? 'Suisse' : '',
        },
        note: 'Permis de conduire du titulaire, lu sur le document le 2026-10-15 avec la carte d’identité (fiche « Mes informations personnelles — identité »).',
        champsLibres: [],
      });
      b.changements.push('permis de conduire rangé dans sa propre fiche');
    }
  },
  // Google (salut@) : la double authentification par SMS.
  c4feb246: (b) => poser(b, 'doubleAuth', premier(b.note, /(SMS au \+[\d ]+\d)/), 'Double authentification'),
  // Infomaniak : la double authentification se demande à l'utilisateur.
  '6d4e1901': (b) => {
    if (/double authentification semble active/i.test(b.note)) poser(b, 'doubleAuth', 'Code demandé à l’utilisateur à la connexion', 'Double authentification');
  },
  // Console Hetzner : le code arrive par e-mail.
  '6e8ee7a5': (b) => {
    if (/validation en deux étapes/i.test(b.note)) poser(b, 'doubleAuth', 'Code par e-mail à l’adresse de connexion (lu dans ProjetE), sinon demandé à l’utilisateur', 'Double authentification');
  },
  // Google (christophebadoux@) : la double authentification se demande.
  b484329c: (b) => {
    if (/double authentification peut être demandée/i.test(b.note)) poser(b, 'doubleAuth', 'Code demandé à l’utilisateur', 'Double authentification');
  },
  // GitHub : un code de vérification d'appareil.
  '977e7422': (b) => {
    if (/code de vérification d['’]appareil/i.test(b.note)) poser(b, 'doubleAuth', 'Code de vérification d’appareil envoyé à l’adresse principale (lu dans ProjetE)', 'Double authentification');
  },
  // SUPER PDP : l'application d'authentification, et le numéro d'utilisateur.
  f4cf6ecc: (b) => {
    poser(b, 'doubleAuth', 'Application d’authentification : fiche « SUPER PDP — bac à sable, secret de double authentification »', 'Double authentification');
    poser(b, 'compte', premier(b.note, /Utilisateur (n° \d+)/), 'Numéro d’utilisateur');
  },
  // Verotel : le numéro de site (shopID).
  '7d978bd1': (b) => poser(b, 'compte', premier(b.note, /\(shopID\)\s*:\s*(\d+)/) ? `shopID ${premier(b.note, /\(shopID\)\s*:\s*(\d+)/)}` : '', 'shopID'),
  // Jeton de la facturation : son échéance.
  e75a11c8: (b) => poser(b, 'expiration', premier(b.note, /Expiration du jeton\s*:\s*([\d-]+)/), 'Expiration'),
  // Jeton Vercel : sa portée et son échéance.
  '6fc55865': (b) => {
    poser(b, 'portee', premier(b.note, /portée : la seule équipe (team_\w+ \([^)]+\))/) ? `équipe ${premier(b.note, /portée : la seule équipe (team_\w+ \([^)]+\))/)}` : '', 'Portée');
    if (/sans expiration/.test(b.note)) poser(b, 'expiration', 'aucune', 'Expiration');
  },
  // Jeton Infomaniak domaines + DNS : sa portée et son échéance.
  '15b65c30': (b) => {
    poser(b, 'portee', premier(b.note, /Portées\s*:\s*([^;]+);/), 'Portée');
    if (/durée illimitée/.test(b.note)) poser(b, 'expiration', 'aucune', 'Expiration');
  },
  // Jeton Hetzner « Beluga clients » : ses droits.
  d1dcc3f3: (b) => poser(b, 'portee', premier(b.note, /droits (lecture \+ écriture)/), 'Portée'),
};

/* ------------------------------------------------------------------ */
/* LA REMISE EN ORDRE D'UNE FICHE                                      */
/* ------------------------------------------------------------------ */

/**
 * La fiche telle qu'elle doit être rangée, ou `null` si rien ne change. Une
 * note réécrite garde son texte entier dans la case en plus « Note d'origine ».
 */
export function structurerFiche(fiche: AccesCoffre): Structuration | null {
  const b: Brouillon = {
    type: fiche.type,
    champs: { ...fiche.champs },
    note: fiche.note ?? '',
    libres: (fiche.champsLibres ?? []).map((c) => ({ ...c })),
    changements: [],
    noteReecrite: false,
    creer: [],
  };
  REPRISES[fiche.id.slice(0, 8)]?.(b, fiche);
  moteurDeLaBase(b, fiche.nom);
  serviceDeLaCle(b);
  noteDeLaCle(b);
  adresseDuJeton(b);
  clePubliqueDuSsh(b);

  if (b.noteReecrite) {
    b.note = nettoyer(b.note);
    libre(b, LIBELLE_NOTE_D_ORIGINE, fiche.note);
    b.changements.push('note épurée (texte d’origine gardé dans « Note d’origine »)');
  }
  const apres: FicheStructuree = { type: b.type, champs: b.champs, note: b.note, champsLibres: b.libres };
  const inchangee =
    apres.type === fiche.type &&
    apres.note === (fiche.note ?? '') &&
    JSON.stringify(apres.champs) === JSON.stringify(fiche.champs) &&
    JSON.stringify(apres.champsLibres) === JSON.stringify(fiche.champsLibres ?? []);
  if (inchangee && !b.creer.length) return null;
  return { apres, changements: [...new Set(b.changements)], ...(b.creer.length ? { creer: b.creer } : {}) };
}

/* ------------------------------------------------------------------ */
/* LES GARDE-FOUS                                                      */
/* ------------------------------------------------------------------ */

/**
 * Les morceaux qui IDENTIFIENT une valeur : nombres, identifiants, adresses,
 * e-mails — tout bloc d'au moins quatre signes qui porte un chiffre ou un « @ ».
 * Les mots courants (« compte », « mode ») peuvent tomber d'un « Service »
 * redécoupé ; un identifiant, jamais.
 */
function morceauxIdentifiants(texte: string): string[] {
  return (texte.match(/[A-Za-z0-9_@.+\-/:=]{4,}/g) ?? [])
    .map((m) => m.replace(/^[.:/=-]+|[.:/=,-]+$/g, ''))
    .filter((m) => m.length >= 4 && /[\d@]/.test(m));
}

const toutLeTexte = (f: { champs: Record<string, string>; note: string; champsLibres?: ChampLibre[] }) =>
  [...Object.values(f.champs), f.note, ...(f.champsLibres ?? []).flatMap((c) => [c.libelle, c.valeur])].join(' \n ');

/**
 * Ce que la remise en ordre perdrait : les morceaux identifiants de la fiche
 * d'avant introuvables dans la fiche d'après (et dans les fiches nées d'elle).
 * Vide = rien n'est perdu.
 */
export function morceauxPerdus(avant: AccesCoffre, structuration: Structuration): string[] {
  const apres = [toutLeTexte(structuration.apres), ...(structuration.creer ?? []).map(toutLeTexte)].join(' \n ');
  const compacte = apres.replace(/\s+/g, '');
  return [...new Set(morceauxIdentifiants(toutLeTexte(avant)))].filter((m) => !apres.includes(m) && !compacte.includes(m.replace(/\s+/g, '')));
}

/** Le verdict d'une fiche : à appliquer, ou écartée avec sa raison. */
export type VerdictDeStructuration =
  | { ok: true; structuration: Structuration; aCompleter: string[] }
  | { ok: false; raison: string };

/**
 * Juge la remise en ordre d'une fiche avec les RÈGLES DU COFFRE (celles que
 * tout enregistrement passe, note comprise) et le contrôle « rien de perdu ».
 */
export function jugerStructuration(fiche: AccesCoffre, structuration: Structuration): VerdictDeStructuration {
  const perdus = morceauxPerdus(fiche, structuration);
  if (perdus.length) return { ok: false, raison: `valeurs qui seraient perdues : ${perdus.join(', ')}` };
  for (const f of [{ nom: fiche.nom, ...structuration.apres }, ...(structuration.creer ?? [])]) {
    const juge = jugerAcces({ ...f, projectId: fiche.projectId });
    if (!juge.ok) return { ok: false, raison: `refusée par les règles du coffre (${f.nom}) : ${juge.raison}` };
  }
  return {
    ok: true,
    structuration,
    aCompleter: champsACompleter(structuration.apres).map((c) => c.libelle),
  };
}

/** La clé qui dit, dans la base, que la remise en ordre a été faite. */
export const CLE_STRUCTURATION_DU_COFFRE = 'coffre.structuration.2026-10-20';
