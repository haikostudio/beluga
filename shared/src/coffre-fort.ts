/**
 * LE COFFRE-FORT — un seul endroit pour tous les identifiants.
 *
 * Les accès d'un projet vivaient éparpillés : la clé d'un service dans une
 * note, le mot de passe d'une console dans une conversation, les accès SSH de
 * la machine dans l'onglet « Système ». Retrouver « le mot de passe de tel
 * site » demandait de se souvenir OÙ on l'avait rangé. Le coffre-fort les
 * réunit, chacun rattaché à un projet — ou à HaikoDev lui-même — et les rend
 * trouvables par leur nom, leur projet ou leur type.
 *
 * Ces règles sont PURES : elles disent quels TYPES d'accès existent, quels
 * CHAMPS chacun porte, ce qui tient debout et comment une recherche retrouve
 * une fiche. Le serveur (`server/src/coffre-fort.ts`) les range sur le disque ;
 * l'interface (`web/src/components/coffre-fort.tsx`) les affiche.
 *
 * CE QUI EST GARDÉ EN CLAIR L'EST À DESSEIN : le coffre sert à RELIRE un
 * identifiant, pas seulement à le vérifier. Une empreinte à sens unique, comme
 * celle des clés d'API (`cles-api.ts`), ne rendrait jamais le mot de passe
 * qu'on est venu chercher.
 */

/** Les types d'accès proposés à la création. L'ordre est celui du menu. */
export const TYPES_ACCES = [
  'cle-api',
  'mot-de-passe',
  'ssh',
  'jeton',
  'base-de-donnees',
  'autre',
] as const;
export type TypeAcces = (typeof TYPES_ACCES)[number];

/** Le nom affiché d'un type, en français — l'interface le traduit. */
export const LIBELLE_TYPE_ACCES: Readonly<Record<TypeAcces, string>> = {
  'cle-api': 'Clé d’API',
  'mot-de-passe': 'Mot de passe',
  ssh: 'Accès SSH',
  jeton: 'Jeton',
  'base-de-donnees': 'Base de données',
  autre: 'Autre',
};

/** Un champ d'une fiche : sa clé technique, son libellé, et s'il est secret. */
export interface ChampAcces {
  /** Clé technique — elle ne change JAMAIS, sinon les fiches déjà rangées se vident. */
  cle: string;
  /** Libellé français, traduit à l'affichage. */
  libelle: string;
  /** Un champ secret se masque par défaut et n'entre pas dans la recherche. */
  secret?: boolean;
  /** Un champ qui peut tenir sur plusieurs lignes (une clé privée, par exemple). */
  multiligne?: boolean;
  /** Exemple affiché en filigrane. */
  exemple?: string;
}

/**
 * Les champs de chaque type. Un type ne porte que ce qui le concerne : demander
 * un port à une clé d'API n'apprend rien à personne.
 */
export const CHAMPS_PAR_TYPE: Readonly<Record<TypeAcces, readonly ChampAcces[]>> = {
  'cle-api': [
    { cle: 'service', libelle: 'Service', exemple: 'OpenAI, Stripe…' },
    { cle: 'cle', libelle: 'Clé', secret: true, multiligne: true },
    { cle: 'adresse', libelle: 'Adresse', exemple: 'https://api.exemple.com' },
  ],
  'mot-de-passe': [
    { cle: 'adresse', libelle: 'Adresse', exemple: 'https://exemple.com/connexion' },
    { cle: 'identifiant', libelle: 'Identifiant' },
    { cle: 'motDePasse', libelle: 'Mot de passe', secret: true },
  ],
  ssh: [
    { cle: 'hote', libelle: 'Machine', exemple: '203.0.113.10' },
    { cle: 'port', libelle: 'Port', exemple: '22' },
    { cle: 'utilisateur', libelle: 'Utilisateur', exemple: 'root' },
    { cle: 'cle', libelle: 'Clé privée', secret: true, multiligne: true },
    { cle: 'motDePasse', libelle: 'Mot de passe', secret: true },
  ],
  jeton: [
    { cle: 'service', libelle: 'Service', exemple: 'GitHub, Vercel…' },
    { cle: 'jeton', libelle: 'Jeton', secret: true, multiligne: true },
  ],
  'base-de-donnees': [
    { cle: 'hote', libelle: 'Machine', exemple: 'localhost' },
    { cle: 'port', libelle: 'Port', exemple: '5432' },
    { cle: 'base', libelle: 'Base' },
    { cle: 'utilisateur', libelle: 'Utilisateur' },
    { cle: 'motDePasse', libelle: 'Mot de passe', secret: true },
  ],
  autre: [{ cle: 'valeur', libelle: 'Contenu', secret: true, multiligne: true }],
};

/** D'où vient une fiche : du coffre lui-même, ou d'un réglage déjà existant. */
export type OrigineAcces = 'coffre' | 'reglages';

/** L'identifiant de la fiche qui reflète les accès SSH centraux d'HaikoDev. */
export const ID_ACCES_VPS = 'reglages:vps';

/** Une fiche du coffre. */
export interface AccesCoffre {
  id: string;
  nom: string;
  type: TypeAcces;
  /** Le projet auquel l'accès est rattaché ; vide = HaikoDev lui-même. */
  projectId: string | null;
  /** Les valeurs, rangées par clé de champ. */
  champs: Record<string, string>;
  note: string;
  creeLe: number;
  modifieLe: number;
  origine: OrigineAcces;
}

export const NOM_ACCES_MAX = 80;
export const NOTE_ACCES_MAX = 2000;
export const VALEUR_CHAMP_MAX = 20000;

/** Les champs connus d'un type, jamais un tableau vide. */
export function champsDuType(type: TypeAcces): readonly ChampAcces[] {
  return CHAMPS_PAR_TYPE[type] ?? CHAMPS_PAR_TYPE.autre;
}

/** Vrai si ce champ de ce type est secret (masqué, hors recherche). */
export function champEstSecret(type: TypeAcces, cle: string): boolean {
  return champsDuType(type).some((c) => c.cle === cle && c.secret === true);
}

export type JugementAcces =
  | { ok: true; nom: string; type: TypeAcces; projectId: string | null; champs: Record<string, string>; note: string }
  | { ok: false; raison: string };

/**
 * Ce qui arrive du navigateur n'est pas cru sur parole : un nom vide, un type
 * inconnu ou un champ démesuré est refusé AVANT d'atteindre le disque, avec une
 * phrase en clair.
 */
export function jugerAcces(brut: unknown): JugementAcces {
  const o = (brut ?? {}) as Record<string, unknown>;

  const nom = String(o.nom ?? '').trim();
  if (!nom) return { ok: false, raison: 'Donnez un nom à cet accès.' };
  if (nom.length > NOM_ACCES_MAX)
    return { ok: false, raison: `Le nom ne peut pas dépasser ${NOM_ACCES_MAX} signes.` };

  const type = String(o.type ?? '') as TypeAcces;
  if (!TYPES_ACCES.includes(type)) return { ok: false, raison: "Ce type d'accès n'existe pas." };

  const projetBrut = o.projectId;
  const projectId =
    typeof projetBrut === 'string' && projetBrut.trim() ? projetBrut.trim() : null;

  const note = String(o.note ?? '').slice(0, NOTE_ACCES_MAX);

  /*
   * On ne garde QUE les champs du type : un champ resté d'un type précédent
   * (le mot de passe d'un « accès SSH » repassé en « clé d'API ») traînerait
   * sinon dans la fiche, invisible et inchangeable.
   */
  const bruts = (o.champs ?? {}) as Record<string, unknown>;
  const champs: Record<string, string> = {};
  for (const champ of champsDuType(type)) {
    const valeur = String(bruts[champ.cle] ?? '');
    if (valeur.length > VALEUR_CHAMP_MAX)
      return { ok: false, raison: `Le champ « ${champ.libelle} » est trop long.` };
    if (valeur) champs[champ.cle] = valeur;
  }

  return { ok: true, nom, type, projectId, champs, note };
}

/** Enlève les accents et la casse : « Clé OVH » se trouve en tapant « cle ovh ». */
export function normaliserRecherche(texte: string): string {
  return (texte ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Le texte sur lequel une recherche mord : le nom, le type, le projet, la note
 * et les champs NON secrets. Un mot de passe ne sert pas à retrouver sa propre
 * fiche — et le taper dans une barre de recherche serait le pire endroit où
 * l'écrire.
 */
export function texteCherchable(acces: AccesCoffre, nomProjet?: string): string {
  const morceaux = [acces.nom, LIBELLE_TYPE_ACCES[acces.type] ?? '', nomProjet ?? '', acces.note];
  for (const champ of champsDuType(acces.type)) {
    if (champ.secret) continue;
    const valeur = acces.champs[champ.cle];
    if (valeur) morceaux.push(valeur);
  }
  return normaliserRecherche(morceaux.join(' '));
}

/**
 * La recherche : tous les mots tapés doivent se retrouver, dans n'importe quel
 * ordre. « ovh ssh » trouve donc « Accès SSH — OVH » sans qu'on ait à écrire le
 * nom exact.
 */
export function filtrerAcces(
  liste: readonly AccesCoffre[],
  recherche: string,
  nomProjet: (projectId: string | null) => string | undefined = () => undefined,
): AccesCoffre[] {
  const mots = normaliserRecherche(recherche).split(/\s+/).filter(Boolean);
  if (!mots.length) return [...liste];
  return liste.filter((acces) => {
    const texte = texteCherchable(acces, nomProjet(acces.projectId));
    return mots.every((mot) => texte.includes(mot));
  });
}

/**
 * La ligne d'aperçu d'une fiche dans la liste : ce qui identifie l'accès sans
 * rien dévoiler. Jamais une valeur secrète.
 */
export function apercuAcces(acces: AccesCoffre): string {
  const c = acces.champs;
  switch (acces.type) {
    case 'ssh':
      return c.hote ? `${c.utilisateur ? `${c.utilisateur}@` : ''}${c.hote}${c.port && c.port !== '22' ? `:${c.port}` : ''}` : '';
    case 'base-de-donnees':
      return c.hote ? `${c.base ? `${c.base} · ` : ''}${c.hote}${c.port ? `:${c.port}` : ''}` : (c.base ?? '');
    case 'mot-de-passe':
      return [c.identifiant, c.adresse].filter(Boolean).join(' · ');
    default:
      return c.service ?? c.adresse ?? '';
  }
}

/** Une fiche est renseignée dès qu'un de ses champs porte quelque chose. */
export function accesRempli(acces: AccesCoffre): boolean {
  return Object.values(acces.champs).some((v) => v.trim().length > 0);
}

/**
 * Le plus récemment touché d'abord, puis par nom : une fiche qu'on vient
 * d'écrire se retrouve en haut, sans avoir à la chercher.
 */
export function trierAcces(liste: readonly AccesCoffre[]): AccesCoffre[] {
  return [...liste].sort((a, b) => b.modifieLe - a.modifieLe || a.nom.localeCompare(b.nom));
}
