/**
 * LE FILTRE DE CONTENU DES SORTIES PUBLIQUES — les règles pures.
 *
 * Tout ce qui quitte le dépôt privé pour un endroit que d'autres lisent — le
 * dépôt du site `belugabuild`, le miroir public, la démonstration servie à tout
 * visiteur — passe par ici. Le garde-fou par CHEMINS (`docs/`, `data/`, `.env`…)
 * ne voyait rien d'une adresse IP écrite dans un fichier de code : c'est ainsi
 * que la démo servie a fini par montrer l'adresse réelle du serveur, glissée en
 * exemple dans un champ de saisie.
 *
 * Deux temps, toujours dans cet ordre :
 *
 *  1. les REMPLACEMENTS NEUTRES — une adresse IP réelle devient une adresse de
 *     documentation, une adresse personnelle l'identité publique, un chemin de
 *     la machine un chemin d'exemple, un corps de clé privée un corps factice ;
 *  2. les RESTES — ce qui ressemble encore à un secret après remplacement (clé
 *     privée entière, jeton GitHub, clé d'API, valeur interdite). Un seul reste
 *     REFUSE l'envoi, et le refus nomme le fichier, la ligne et le motif.
 *
 * LES VALEURS SENSIBLES NE SONT PAS ÉCRITES ICI. Ce fichier part lui-même au
 * miroir public : il ne connaît que des FORMES (une clé, un jeton), et reçoit
 * les valeurs (IP, adresses, comptes) de l'appelant, qui les lit du côté privé
 * (`prive/valeurs-sensibles.json`, jamais publié). Ses propres expressions sont
 * écrites de façon à ne pas se reconnaître elles-mêmes.
 *
 * Règles PURES : ni base, ni disque, ni réseau.
 */

/** L'adresse IPv4 de documentation (RFC 5737) posée à la place d'une vraie. */
export const ADRESSE_IP_NEUTRE = '198.51.100.7';
/** L'adresse IPv6 de documentation (RFC 3849) posée à la place d'une vraie. */
export const ADRESSE_IP6_NEUTRE = '2001:db8::7';
export const IDENTITE_PUBLIQUE_NOM = 'haikostudio';
export const IDENTITE_PUBLIQUE_MAIL = 'haikostudio@beluga.local';
/** L'identité posée sur tout commit qui part au public. */
export const IDENTITE_PUBLIQUE = `${IDENTITE_PUBLIQUE_NOM} <${IDENTITE_PUBLIQUE_MAIL}>`;
/** Le corps factice d'une clé privée neutralisée. */
export const CORPS_DE_CLE_NEUTRE = 'CLE-D-EXEMPLE';

/** Ce que le côté privé déclare comme sensible. */
export interface ValeursSensibles {
  /** Adresses IP réelles (v4 ou v6) : remplacées par l'adresse de documentation. */
  ips?: string[];
  /** Adresses électroniques personnelles : remplacées par l'identité publique. */
  adresses?: string[];
  /** Valeurs à neutraliser telles quelles (compte, chemin de clé, fichier de jeton…). */
  remplacements?: { valeur: string; neutre: string }[];
  /** Valeurs sans forme neutre : leur seule présence refuse l'envoi. */
  interdits?: string[];
  /** Textes tolérés tels quels, même s'ils ressemblent à un motif (l'adresse de contact du site). */
  listeBlanche?: string[];
  /** Les seules adresses admises comme auteur ou committeur d'un commit public. */
  identitesAdmises?: string[];
}

/** Ce qui interdit l'envoi, nommé assez pour être corrigé sans deviner. */
export interface Reste {
  chemin: string;
  ligne: number;
  motif: string;
  /** Le voisinage du motif, le motif lui-même MASQUÉ : un refus ne doit pas propager le secret. */
  extrait: string;
}

interface Regle {
  motif: string;
  expression: RegExp;
  /** La forme neutre ; absente pour une règle de refus. */
  neutre?: (trouve: string, groupes: string[]) => string;
}

export interface ReglesDeFiltre {
  remplacements: Regle[];
  refus: Regle[];
  listeBlanche: string[];
  identitesAdmises: string[];
}

const echapper = (texte: string) => texte.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Un corps de clé qui n'est qu'un mot d'exemple (« DEMONSTRATION ») n'est pas une clé. */
const CORPS_FACTICE = /^[A-Z][A-Z -]{0,40}$/;

/*
 * Le bloc d'une clé privée, dans ses deux écritures : sur plusieurs vraies
 * lignes (fichier PEM), ou dans une chaîne de code où les retours à la ligne
 * sont écrits « \n ». Le séparateur est gardé tel quel : remplacer « \n » par un
 * vrai retour casserait la chaîne du code qui la porte.
 */
const SEPARATEUR = String.raw`(?:\\r\\n|\\n|\r?\n)?`;
const BLOC_DE_CLE = new RegExp(
  String.raw`-----BEGIN ([A-Z0-9 ]*)PRIVATE KEY-----(${SEPARATEUR})([\s\S]*?)(${SEPARATEUR})-----END \1PRIVATE KEY-----`,
  'g',
);

/**
 * LES FORMES DE SECRETS, reconnues sans rien connaître des valeurs. Chacune
 * exige la longueur réelle du format : « ghp_DEMONSTRATION » ou « sk-exemple »
 * dans une démonstration ne sont pas des jetons.
 */
const FORMES_DE_SECRETS: { motif: string; source: string; drapeaux?: string }[] = [
  {
    motif: 'clé privée',
    // Le séparateur vit DANS l'anticipation : laissé devant, il se ferait vide
    // pour que le corps factice « \nDEMONSTRATION » échappe au test.
    source: String.raw`-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----(?!${SEPARATEUR}[A-Z][A-Z -]{0,40}${SEPARATEUR}-----END )`,
  },
  { motif: 'jeton GitHub', source: String.raw`\bgh[pousr]_[A-Za-z0-9]{36}\b` },
  { motif: 'jeton GitHub', source: String.raw`\bgithub_pat_[A-Za-z0-9_]{40,}` },
  { motif: 'clé d’API', source: String.raw`\bsk-(?:ant-|proj-)?(?=[A-Za-z_-]*\d)[A-Za-z0-9_-]{32,}` },
  { motif: 'clé AWS', source: String.raw`\bAKIA[0-9A-Z]{16}\b` },
  { motif: 'jeton Slack', source: String.raw`\bxox[abprs]-[A-Za-z0-9-]{10,}` },
  { motif: 'clé Google', source: String.raw`\bAIza[0-9A-Za-z_-]{35}` },
];
/*
 * UN CHEMIN SYSTÈME GÉNÉRIQUE N'EST PAS UNE DONNÉE PRIVÉE. Le dossier des clés
 * de root ou le fichier d'environnement du produit s'écrivent pareil sur toutes
 * les machines : le code public en a besoin pour marcher, et les réécrire
 * fausserait le miroir. Ce qui est propre à CETTE machine — un dossier
 * personnel, le nom d'une clé de sauvegarde, le fichier d'un jeton — se déclare
 * côté privé, avec sa forme neutre.
 */

function estIp6(ip: string): boolean {
  return ip.includes(':');
}

/** Compile les règles d'un jeu de valeurs sensibles. */
export function reglesDeFiltre(valeurs: ValeursSensibles = {}): ReglesDeFiltre {
  const remplacements: Regle[] = [];

  remplacements.push({
    motif: 'clé privée',
    expression: BLOC_DE_CLE,
    neutre: (trouve, [type, avant, corps, apres]) =>
      CORPS_FACTICE.test(corps.trim())
        ? trouve
        : `-----BEGIN ${type}PRIVATE KEY-----${avant}${CORPS_DE_CLE_NEUTRE}${apres}-----END ${type}PRIVATE KEY-----`,
  });

  const valeursPropres = (liste?: string[]) =>
    [...new Set((liste ?? []).map((v) => v.trim()).filter(Boolean))].sort((a, b) => b.length - a.length);

  for (const ip of valeursPropres(valeurs.ips)) {
    const bord = estIp6(ip) ? '[0-9a-fA-F:]' : String.raw`[\d.]`;
    const apres = estIp6(ip) ? '[0-9a-fA-F:]' : String.raw`\d`;
    remplacements.push({
      motif: 'adresse IP réelle',
      expression: new RegExp(`(?<!${bord})${echapper(ip)}(?!${apres})`, estIp6(ip) ? 'gi' : 'g'),
      neutre: () => (estIp6(ip) ? ADRESSE_IP6_NEUTRE : ADRESSE_IP_NEUTRE),
    });
  }

  for (const adresse of valeursPropres(valeurs.adresses)) {
    remplacements.push({
      motif: 'adresse personnelle',
      expression: new RegExp(String.raw`(?<![\w.+-])${echapper(adresse)}(?![\w-])`, 'gi'),
      neutre: () => IDENTITE_PUBLIQUE_MAIL,
    });
  }

  const declares = [...(valeurs.remplacements ?? [])]
    .filter((r) => r?.valeur?.trim())
    .sort((a, b) => b.valeur.length - a.valeur.length);
  for (const { valeur, neutre } of declares) {
    remplacements.push({ motif: 'valeur sensible déclarée', expression: new RegExp(echapper(valeur), 'g'), neutre: () => neutre });
  }

  const refus: Regle[] = FORMES_DE_SECRETS.map(({ motif, source, drapeaux }) => ({
    motif,
    expression: new RegExp(source, drapeaux ?? 'g'),
  }));
  for (const interdit of valeursPropres(valeurs.interdits)) {
    refus.push({ motif: 'valeur interdite', expression: new RegExp(echapper(interdit), 'gi') });
  }

  return {
    remplacements,
    refus,
    listeBlanche: valeursPropres(valeurs.listeBlanche),
    identitesAdmises: [
      ...new Set([IDENTITE_PUBLIQUE_MAIL, ...(valeurs.identitesAdmises ?? [])].map((m) => m.trim().toLowerCase())),
    ].filter(Boolean),
  };
}

/** Un contenu binaire (image, police) ne se lit pas comme du texte. */
export function estBinaire(contenu: string): boolean {
  return contenu.slice(0, 8000).includes('\u0000');
}

function ligneDe(texte: string, index: number): number {
  let ligne = 1;
  for (let i = texte.indexOf('\n'); i !== -1 && i < index; i = texte.indexOf('\n', i + 1)) ligne += 1;
  return ligne;
}

function extraitAutour(texte: string, index: number, longueur: number): string {
  const avant = texte.slice(Math.max(0, index - 40), index);
  const apres = texte.slice(index + longueur, index + longueur + 40);
  return `${avant}‹…›${apres}`.replace(/\s+/g, ' ').trim();
}

/** La liste blanche est masquée à longueur égale : les positions restent justes. */
function masquerListeBlanche(texte: string, regles: ReglesDeFiltre): string {
  let masque = texte;
  for (const blanc of regles.listeBlanche) {
    masque = masque.replace(new RegExp(echapper(blanc), 'gi'), (trouve) => '·'.repeat(trouve.length));
  }
  return masque;
}

function restesDesRefus(texte: string, regles: ReglesDeFiltre, chemin: string): Reste[] {
  const masque = masquerListeBlanche(texte, regles);
  const restes: Reste[] = [];
  for (const regle of regles.refus) {
    for (const trouve of masque.matchAll(regle.expression)) {
      const index = trouve.index ?? 0;
      restes.push({ chemin, ligne: ligneDe(texte, index), motif: regle.motif, extrait: extraitAutour(texte, index, trouve[0].length) });
    }
  }
  return restes;
}

/**
 * FILTRER UN TEXTE : les remplacements neutres, puis ce qui reste.
 * `texte` est le contenu à envoyer ; les restes se lisent sur le texte REMPLACÉ.
 */
export function filtrerTexte(
  texte: string,
  regles: ReglesDeFiltre,
  chemin = '',
): { texte: string; remplacements: number; restes: Reste[] } {
  if (estBinaire(texte)) return { texte, remplacements: 0, restes: [] };
  let sortie = texte;
  let remplacements = 0;
  for (const regle of regles.remplacements) {
    sortie = sortie.replace(regle.expression, (trouve: string, ...args: unknown[]) => {
      const groupes = args.filter((a): a is string => typeof a === 'string' || a === undefined).map((a) => a ?? '');
      const neuf = regle.neutre!(trouve, groupes);
      if (neuf !== trouve) remplacements += 1;
      return neuf;
    });
  }
  return { texte: sortie, remplacements, restes: restesDesRefus(sortie, regles, chemin) };
}

/**
 * EXAMINER UN TEXTE DÉJÀ ENREGISTRÉ, sans rien remplacer : un commit est posé,
 * ce qu'il porte partirait tel quel. Ici, ce que le filtre AURAIT remplacé est
 * donc un reste au même titre qu'un secret.
 */
export function examinerTexte(texte: string, regles: ReglesDeFiltre, chemin = ''): Reste[] {
  if (estBinaire(texte)) return [];
  const restes: Reste[] = [];
  for (const regle of regles.remplacements) {
    for (const trouve of texte.matchAll(regle.expression)) {
      const groupes = trouve.slice(1).map((g) => g ?? '');
      if (regle.neutre!(trouve[0], groupes) === trouve[0]) continue;
      const index = trouve.index ?? 0;
      restes.push({ chemin, ligne: ligneDe(texte, index), motif: regle.motif, extrait: extraitAutour(texte, index, trouve[0].length) });
    }
  }
  // Les refus se lisent APRÈS remplacement : une clé déjà comptée ci-dessus ne
  // se compte pas une seconde fois.
  restes.push(...filtrerTexte(texte, regles, chemin).restes);
  return restes.sort((a, b) => a.ligne - b.ligne);
}

/** « Nom <adresse> » ou une adresse nue : l'adresse, en minuscules. */
function adresseDeLIdentite(identite: string): string {
  const m = /<\s*([^>]+?)\s*>/.exec(identite);
  return (m ? m[1] : identite).trim().toLowerCase();
}

/** Les identités de commits qui ne sont pas l'identité publique. */
export function examinerIdentites(identites: string[], regles: ReglesDeFiltre, chemin = '(identité git)'): Reste[] {
  const vues = new Set<string>();
  const restes: Reste[] = [];
  for (const identite of identites) {
    const adresse = adresseDeLIdentite(identite);
    if (!adresse || vues.has(adresse)) continue;
    vues.add(adresse);
    if (regles.identitesAdmises.includes(adresse)) continue;
    restes.push({ chemin, ligne: 0, motif: 'identité git non neutre', extrait: identite.replace(/<[^>]*>/, '<‹…›>') });
  }
  return restes;
}

/** Le refus en clair : fichier, ligne, motif — et combien d'autres au-delà. */
export function recitDesRestes(restes: Reste[], max = 20): string {
  if (!restes.length) return 'Filtre de contenu : aucun reste.';
  const lignes = restes
    .slice(0, max)
    .map((r) => `  - ${r.chemin}${r.ligne ? `:${r.ligne}` : ''} — ${r.motif} — « ${r.extrait.slice(0, 120)} »`);
  if (restes.length > max) lignes.push(`  … et ${restes.length - max} autre(s).`);
  return `FILTRE DE CONTENU : ${restes.length} reste(s), l'envoi est refusé.\n${lignes.join('\n')}`;
}

/** Une adresse est-elle publique (ni privée, ni locale, ni de documentation) ? */
export function adresseIpPublique(ip: string): boolean {
  const propre = ip.trim().toLowerCase();
  if (!propre) return false;
  if (propre.includes(':')) {
    return !(
      propre === '::1' ||
      propre.startsWith('fe80') ||
      propre.startsWith('fc') ||
      propre.startsWith('fd') ||
      propre.startsWith('2001:db8') ||
      propre.startsWith('::ffff:')
    );
  }
  const parts = propre.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return false;
  const [a, b, c] = parts;
  if (a === 10 || a === 127 || a === 0) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 169 && b === 254) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if ((a === 192 && b === 0 && c === 2) || (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113)) return false;
  return true;
}

/** Les adresses publiques de la machine, lues dans ce que rend `os.networkInterfaces()`. */
export function ipsPubliquesDesInterfaces(
  interfaces: Record<string, { address: string; internal?: boolean }[] | undefined>,
): string[] {
  const ips = new Set<string>();
  for (const liste of Object.values(interfaces)) {
    for (const une of liste ?? []) {
      if (une.internal) continue;
      const adresse = une.address.split('%')[0];
      if (adresseIpPublique(adresse)) ips.add(adresse);
    }
  }
  return [...ips];
}

/** Ajoute aux valeurs déclarées les adresses publiques lues sur la machine. */
export function avecLesIpsDeLaMachine(valeurs: ValeursSensibles, ips: string[]): ValeursSensibles {
  return { ...valeurs, ips: [...new Set([...(valeurs.ips ?? []), ...ips])] };
}

/**
 * LES MÊMES REMPLACEMENTS, POUR `git filter-repo --replace-text`.
 *
 * La réécriture d'un historique suit les règles littérales (IP, adresses,
 * valeurs déclarées, dossier des clés). Les FORMES (bloc de clé) n'y figurent
 * pas : la relecture complète par ce filtre, après réécriture, dit s'il en reste.
 */
export function expressionsPourFilterRepo(valeurs: ValeursSensibles): string {
  const lignes: string[] = [];
  for (const ip of valeurs.ips ?? []) lignes.push(`${ip}==>${estIp6(ip) ? ADRESSE_IP6_NEUTRE : ADRESSE_IP_NEUTRE}`);
  for (const adresse of valeurs.adresses ?? []) lignes.push(`${adresse}==>${IDENTITE_PUBLIQUE_MAIL}`);
  const declares = [...(valeurs.remplacements ?? [])].sort((a, b) => b.valeur.length - a.valeur.length);
  for (const { valeur, neutre } of declares) lignes.push(`${valeur}==>${neutre}`);
  return `${lignes.join('\n')}\n`;
}
