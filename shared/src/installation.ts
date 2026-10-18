import { z } from 'zod';

/**
 * L'IDENTITÉ D'UNE INSTALLATION — ce qui change d'un serveur à l'autre.
 *
 * Beluga Build s'installe chez d'autres que son auteur. Tout ce qui désigne
 * UNE installation précise — son adresse, son nom de domaine, l'adresse de son
 * espace client, qui reçoit le point du matin, au nom de qui partent les
 * courriels — vivait écrit en dur dans le code : installé ailleurs, le
 * programme écrivait donc à quelqu'un d'autre et créait ses adresses sur un
 * nom de domaine qui n'était pas le sien.
 *
 * Ces valeurs sont désormais des RÉGLAGES (`Settings.installation`), vides sur
 * une installation neuve. LA RÈGLE QUI VA AVEC : une fonction dont la valeur
 * manque est ÉTEINTE, elle ne retombe jamais sur une valeur d'exemple. Aucun
 * courriel ne part sans expéditeur, aucune adresse de projet ne se crée sans
 * zone.
 *
 * Le module garde l'identité COURANTE en mémoire : le démon la pose au
 * démarrage et à chaque enregistrement des réglages, l'interface à chaque
 * réception des réglages. Les règles pures qui en ont besoin la lisent ici au
 * lieu de recevoir neuf paramètres ; un test la pose lui-même
 * (`definirIdentiteDInstallation`).
 */
export const IdentiteDInstallation = z.object({
  /** L'adresse de l'administration, « https://… » sans barre finale. */
  adressePublique: z.string().default(''),
  /** L'hôte de l'espace client (« my.exemple.com »), sans protocole. */
  hoteEspaceClient: z.string().default(''),
  /** Le nom de l'espace client, tel que le lit un client (onglet, application installée). */
  nomEspaceClient: z.string().default(''),
  /** La zone des adresses de projets : « exemple.com » donne « projet.exemple.com ». */
  zoneDesProjets: z.string().default(''),
  /** Le nom de l'entreprise, tel qu'il signe les courriels envoyés aux clients. */
  nomDeLEntreprise: z.string().default(''),
  /** Le nom court de qui répond aux clients, tel qu'il signe ses messages. */
  nomCourt: z.string().default(''),
  /** L'adresse qui reçoit le point du matin et les alertes de surveillance. */
  adresseDuRecapitulatif: z.string().default(''),
  /** L'adresse d'où partent les courriels — son domaine doit être vérifié chez le service d'envoi. */
  expediteurDesCourriels: z.string().default(''),
  /** L'adresse de contact annoncée aux services de notifications poussées. */
  contactDesNotifications: z.string().default(''),
  /** Le préfixe des deux fichiers du logo des courriels (« <préfixe>-blanc.png », « <préfixe>-violet.png »). */
  logoDesCourriels: z.string().default(''),
  /** L'adresse de l'outil de facturation, pour l'afficher ; vide : facturation éteinte. */
  adresseDeFacturation: z.string().default(''),
  /** La société de facturation retenue quand un projet n'en nomme aucune. */
  societeDeFacturation: z.string().default(''),
  /**
   * Par où partent les courriels : `serveur` (l'agent d'envoi de la machine),
   * `smtp` (n'importe quel service de courriel) ou `resend`. Vide : le démon
   * retient Resend si une clé est déjà au coffre-fort, sinon rien ne part.
   */
  modeDesCourriels: z.string().default(''),
  /** Le service de courriel choisi (mode `smtp`) : son hôte, son port, l'identifiant. Le mot de passe vit au coffre-fort. */
  smtpHote: z.string().default(''),
  smtpPort: z.string().default(''),
  smtpIdentifiant: z.string().default(''),
  /**
   * Qui tient le nom de domaine des projets : `hetzner`, `cloudflare`,
   * `infomaniak`, `ovh`, `gandi` — ou `joker` quand une règle « tous les noms »
   * mène déjà au serveur. Vide : Hetzner si un jeton est connu, sinon `joker`.
   */
  fournisseurDeNoms: z.string().default(''),
});
export type IdentiteDInstallation = z.infer<typeof IdentiteDInstallation>;

/** Les trois façons d'envoyer un courriel, dans l'ordre où l'assistant les propose. */
export const MODES_DE_COURRIEL = ['serveur', 'smtp', 'resend'] as const;
export type ModeDeCourriel = (typeof MODES_DE_COURRIEL)[number];

/** Les fournisseurs de noms que le démon sait piloter, plus la règle « tous les noms » (`joker`). */
export const FOURNISSEURS_DE_NOMS = ['hetzner', 'cloudflare', 'infomaniak', 'ovh', 'gandi', 'joker'] as const;
export type FournisseurDeNoms = (typeof FOURNISSEURS_DE_NOMS)[number];

/** Une installation neuve : rien n'est réglé, donc tout ce qui en dépend est éteint. */
export const IDENTITE_VIERGE: IdentiteDInstallation = IdentiteDInstallation.parse({});

let courante: IdentiteDInstallation = IDENTITE_VIERGE;

/** L'identité de CETTE installation, telle que posée par le démon ou l'interface. */
export function identiteDInstallation(): IdentiteDInstallation {
  return courante;
}

/** Pose l'identité courante. Les valeurs sont nettoyées : ni espaces autour, ni barre finale. */
export function definirIdentiteDInstallation(valeurs: Partial<IdentiteDInstallation> | null | undefined): IdentiteDInstallation {
  courante = nettoyerIdentite(valeurs ?? {});
  return courante;
}

/** Une saisie ramenée à sa forme rangée : c'est elle qui s'enregistre. */
export function nettoyerIdentite(valeurs: Partial<IdentiteDInstallation>): IdentiteDInstallation {
  const brut = IdentiteDInstallation.parse({ ...IDENTITE_VIERGE, ...valeurs });
  const propre = Object.fromEntries(
    Object.entries(brut).map(([cle, valeur]) => [cle, String(valeur ?? '').trim()]),
  ) as IdentiteDInstallation;
  return {
    ...propre,
    adressePublique: adresseNormalisee(propre.adressePublique),
    hoteEspaceClient: hoteNu(propre.hoteEspaceClient),
    zoneDesProjets: hoteNu(propre.zoneDesProjets).replace(/^\*\./, ''),
    contactDesNotifications: propre.contactDesNotifications.replace(/^mailto:/i, ''),
    modeDesCourriels: (MODES_DE_COURRIEL as readonly string[]).includes(propre.modeDesCourriels) ? propre.modeDesCourriels : '',
    smtpHote: hoteNu(propre.smtpHote),
    smtpPort: /^\d{1,5}$/.test(propre.smtpPort) ? propre.smtpPort : '',
    fournisseurDeNoms: (FOURNISSEURS_DE_NOMS as readonly string[]).includes(propre.fournisseurDeNoms) ? propre.fournisseurDeNoms : '',
  };
}

/** « exemple.com/ », « https://exemple.com » et « EXEMPLE.com » donnent tous « https://exemple.com ». */
export function adresseNormalisee(saisie: string): string {
  const brut = saisie.trim().replace(/\/+$/, '');
  if (!brut) return '';
  const avecProtocole = /^[a-z]+:\/\//i.test(brut) ? brut : `https://${brut}`;
  try {
    const url = new URL(avecProtocole);
    return `${url.protocol}//${url.host}`.toLowerCase();
  } catch {
    return '';
  }
}

/** Un hôte seul : sans protocole, sans chemin, sans port, en minuscules. */
export function hoteNu(saisie: string): string {
  return saisie
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/:\d+$/, '');
}

/** Un nom de domaine plausible : des libellés séparés par des points, au moins deux. */
export function nomDeDomaineValide(hote: string): boolean {
  return /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(hote);
}

/** Une adresse de courriel plausible — on juge la forme, pas l'existence. */
export function adresseDeCourrielValide(adresse: string): boolean {
  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]{2,}$/.test(adresse.trim());
}

/**
 * CE QUE LA PAGE PEUT DIRE DE L'INSTALLATION À UN NAVIGATEUR : des noms et des
 * adresses déjà publics, rien d'autre. Le démon le pose dans la page servie
 * (repère `REPERE_D_IDENTITE`), l'interface le lit avant de s'afficher — un
 * client y trouve le nom de son interlocuteur sans rien demander.
 */
export const REPERE_D_IDENTITE = 'beluga-installation';

export function identitePublique(identite: IdentiteDInstallation = courante): Partial<IdentiteDInstallation> {
  return {
    adressePublique: identite.adressePublique,
    hoteEspaceClient: identite.hoteEspaceClient,
    nomEspaceClient: identite.nomEspaceClient,
    zoneDesProjets: identite.zoneDesProjets,
    nomDeLEntreprise: identite.nomDeLEntreprise,
    nomCourt: identite.nomCourt,
  };
}

/* ------------------------------------------------------------------ */
/* Ce que le reste du code demande                                      */
/* ------------------------------------------------------------------ */

/** L'adresse de l'administration, ou '' tant qu'elle n'est pas réglée. */
export function adresseAdministration(): string {
  return courante.adressePublique;
}

/** L'hôte de l'espace client, ou '' : sans lui, aucune porte cliente n'est servie par son nom. */
export function hoteEspaceClient(): string {
  return courante.hoteEspaceClient;
}

/** L'adresse de l'espace client, ou '' quand il n'a pas d'adresse à lui. */
export function adresseEspaceClient(): string {
  return courante.hoteEspaceClient ? `https://${courante.hoteEspaceClient}` : '';
}

/** Le nom de l'espace client : celui réglé, sinon un nom que tout le monde comprend. */
export function nomEspaceClient(): string {
  return courante.nomEspaceClient || 'Espace client';
}

/** La zone des adresses de projets, ou '' : la création d'adresse est alors éteinte. */
export function zoneDesProjets(): string {
  return courante.zoneDesProjets;
}

/** Le nom qui signe les courriels : l'entreprise réglée, sinon celui du produit. */
export function nomDeLEntreprise(): string {
  return courante.nomDeLEntreprise || 'Beluga Build';
}

/** Le nom de qui répond aux clients : le nom court, sinon celui de l'entreprise. */
export function nomCourtDeLInstallation(): string {
  return courante.nomCourt || nomDeLEntreprise();
}

/** Le destinataire du point du matin et des alertes, ou '' : rien ne part. */
export function adresseDuRecapitulatif(): string {
  return courante.adresseDuRecapitulatif;
}

/** L'expéditeur complet (« Nom <adresse> »), ou '' : aucun courriel ne part. */
export function expediteurDesCourriels(): string {
  return courante.expediteurDesCourriels ? `${nomDeLEntreprise()} <${courante.expediteurDesCourriels}>` : '';
}

/**
 * D'où les images des courriels sont servies : l'espace client quand il a son
 * adresse, sinon l'administration. '' : les courriels partent sans image.
 */
export function adresseDesImagesDeCourriel(): string {
  const base = adresseEspaceClient() || courante.adressePublique;
  return base ? `${base}/courriel` : '';
}

/* ------------------------------------------------------------------ */
/* L'adresse provisoire                                                 */
/* ------------------------------------------------------------------ */

/**
 * UNE ADRESSE SÉCURISÉE SANS NOM DE DOMAINE. Un serveur neuf n'a qu'une adresse
 * IP, et aucun certificat ne se délivre pour une IP nue. Les services de noms
 * « joker » répondent à `<ip-avec-tirets>.<service>` par l'IP elle-même : le
 * nom existe donc sans rien enregistrer, et le certificat s'obtient comme pour
 * n'importe quel domaine. C'est l'adresse PROVISOIRE d'une installation, le
 * temps qu'un vrai nom de domaine soit réglé. C'est l'installateur qui la
 * compose (`scripts/installer.sh`) ; ici, on sait seulement la reconnaître.
 */
export const SERVICE_D_ADRESSE_PROVISOIRE = 'sslip.io';

/** L'adresse est-elle provisoire ? L'assistant propose alors de la remplacer. */
export function adresseEstProvisoire(adresse: string, service = SERVICE_D_ADRESSE_PROVISOIRE): boolean {
  return hoteNu(adresse).endsWith(`.${service}`);
}

/**
 * L'ADRESSE PROPOSÉE POUR L'ESPACE CLIENT — le champ n'arrive plus vide.
 *
 * Ce qui est déjà réglé décide : le nom de domaine des projets, sinon celui de
 * l'adresse de Beluga Build (son premier mot retiré quand elle en a trois ou
 * plus : `beluga.exemple.com` → `espace.exemple.com`). Sans nom de domaine, on
 * propose un sous-domaine de l'adresse PROVISOIRE du serveur
 * (`espace.1-2-3-4.sslip.io`), qui mène ici sans rien enregistrer. Rien à
 * proposer : `null`.
 */
export function adresseProposeePourLEspaceClient(reglages: {
  adressePublique?: string;
  zoneDesProjets?: string;
  ip?: string;
}): { hote: string; origine: 'domaine' | 'provisoire' } | null {
  const zone = hoteNu(reglages.zoneDesProjets ?? '');
  if (zone && !adresseEstProvisoire(zone)) return { hote: `espace.${zone}`, origine: 'domaine' };
  const admin = hoteNu(reglages.adressePublique ?? '');
  if (admin && !adresseEstProvisoire(admin) && nomDeDomaineValide(admin)) {
    const mots = admin.split('.');
    const racine = mots.length >= 3 ? mots.slice(1).join('.') : admin;
    return { hote: `espace.${racine}`, origine: 'domaine' };
  }
  if (admin && adresseEstProvisoire(admin)) return { hote: `espace.${admin}`, origine: 'provisoire' };
  const ip = (reglages.ip ?? '').trim();
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(ip)) return { hote: `espace.${ip.replace(/\./g, '-')}.${SERVICE_D_ADRESSE_PROVISOIRE}`, origine: 'provisoire' };
  return null;
}

/* ------------------------------------------------------------------ */
/* Le code d'installation                                               */
/* ------------------------------------------------------------------ */

/**
 * LE PREMIER COMPTE SE CRÉE DANS LE NAVIGATEUR, DERRIÈRE UN CODE.
 *
 * Entre la fin de l'installation et la création du premier administrateur,
 * l'adresse est publique : sans garde, le premier venu se créerait le compte
 * du propriétaire. Le démon tire donc un CODE à usage unique, montré dans le
 * terminal de l'installation et nulle part ailleurs ; seul qui a la main sur le
 * serveur peut le lire. Le code n'est gardé que HACHÉ, ses essais sont comptés
 * comme ceux du mur d'accès, et la porte se ferme dès qu'un administrateur
 * existe.
 */
export const ALPHABET_DU_CODE = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const LONGUEUR_DU_CODE = 16;

/** Le code tel qu'on le montre : quatre groupes de quatre, plus facile à recopier. */
export function codeEnGroupes(code: string): string {
  return codeNormalise(code).replace(/(.{4})(?=.)/g, '$1-');
}

/** Le code tel qu'on le compare : sans tirets ni espaces, en majuscules. */
export function codeNormalise(saisie: string): string {
  return saisie.replace(/[\s-]+/g, '').toUpperCase();
}

/** La saisie a-t-elle la forme d'un code ? Une forme fausse ne compte pas comme un essai. */
export function formeDeCodeValide(saisie: string): boolean {
  const code = codeNormalise(saisie);
  return code.length === LONGUEUR_DU_CODE && [...code].every((lettre) => ALPHABET_DU_CODE.includes(lettre));
}

/* ------------------------------------------------------------------ */
/* L'assistant de premier démarrage                                     */
/* ------------------------------------------------------------------ */

/**
 * LES PAGES DE L'ASSISTANT, dans l'ordre. Le compte se crée AVANT, sur la page
 * d'installation servie par le démon : ici, tout le monde est déjà entré.
 *
 * DEUX PAGES SONT OBLIGATOIRES — « moteurs » (sans moteur, aucune carte ne
 * part) et « projet » (sans GitHub relié, aucun projet ne se récupère ni ne se
 * sauvegarde ; l'écran garde « Continuer » éteint tant que GitHub ne l'est
 * pas, ajouter un projet reste libre). Chaque autre page se passe (« plus
 * tard ») et se retrouve dans les réglages.
 *
 * « bienvenue » ne règle rien : elle dit ce qu'est Beluga Build avant de rien
 * demander. « copie » fait de l'installation la copie PERSONNELLE de qui
 * l'installe — son dépôt à lui, et le projet de l'application sur son tableau.
 */
export const ETAPES_DE_L_ASSISTANT = [
  'bienvenue',
  'moteurs',
  'domaine',
  'projet',
  'copie',
  'courriels',
  'espace-client',
  'competences',
  'facultatif',
] as const;
export type EtapeDeLAssistant = (typeof ETAPES_DE_L_ASSISTANT)[number];

/**
 * LES PAGES QUE CETTE MACHINE MONTRE. Sur l'offre hébergée, la page « copie »
 * n'existe pas : l'outil y est commun à tous et personne n'en fait sa copie.
 */
export function etapesDeLAssistant(hebergee = false): readonly EtapeDeLAssistant[] {
  return hebergee ? ETAPES_DE_L_ASSISTANT.filter((etape) => etape !== 'copie') : ETAPES_DE_L_ASSISTANT;
}

export const ETAPES_OBLIGATOIRES: readonly EtapeDeLAssistant[] = ['moteurs', 'projet'];

export const EtatDeLAssistant = z.object({
  /**
   * `a-faire` sur une installation neuve ; `termine` dès la dernière page — ou
   * d'office sur une installation qui existait avant l'assistant.
   */
  statut: z.enum(['a-faire', 'termine']).default('termine'),
  /** Ce que chaque page est devenue : faite, ou passée pour plus tard. */
  etapes: z.record(z.enum(['faite', 'passee'])).default({}),
});
export type EtatDeLAssistant = z.infer<typeof EtatDeLAssistant>;

/** L'assistant doit-il occuper l'écran ? */
export function assistantDeDemarrageOuvert(etat: EtatDeLAssistant | undefined | null): boolean {
  return etat?.statut === 'a-faire';
}

/** La première page pas encore vue : c'est là qu'on rouvre l'assistant après un rechargement. */
export function prochaineEtape(etat: EtatDeLAssistant | undefined | null, hebergee = false): EtapeDeLAssistant | 'fin' {
  const vues = etat?.etapes ?? {};
  return etapesDeLAssistant(hebergee).find((etape) => !vues[etape]) ?? 'fin';
}

/** Peut-on quitter cette page sans l'avoir faite ? */
export function etapePassable(etape: EtapeDeLAssistant): boolean {
  return !ETAPES_OBLIGATOIRES.includes(etape);
}

/** L'état après avoir quitté une page. La dernière page vue referme l'assistant. */
export function apresEtape(
  etat: EtatDeLAssistant | undefined | null,
  etape: EtapeDeLAssistant,
  issue: 'faite' | 'passee',
  hebergee = false,
): EtatDeLAssistant {
  const base = EtatDeLAssistant.parse(etat ?? { statut: 'a-faire' });
  if (issue === 'passee' && !etapePassable(etape)) return base;
  const etapes = { ...base.etapes, [etape]: issue };
  const reste = etapesDeLAssistant(hebergee).some((une) => !etapes[une]);
  return { statut: reste ? base.statut : 'termine', etapes };
}

/** Les pages passées pour plus tard : les réglages les rappellent. */
export function etapesRemisesAPlusTard(etat: EtatDeLAssistant | undefined | null, hebergee = false): EtapeDeLAssistant[] {
  const vues = etat?.etapes ?? {};
  return etapesDeLAssistant(hebergee).filter((etape) => vues[etape] === 'passee');
}

/* ------------------------------------------------------------------ */
/* Les bibliothèques de compétences proposées                           */
/* ------------------------------------------------------------------ */

/**
 * Une installation neuve part SANS aucune compétence : celles de l'auteur ne
 * voyagent pas. L'assistant propose à la place des bibliothèques PUBLIQUES, à
 * cocher — chacune s'importe par le mécanisme existant
 * (`shared/src/bibliotheque-competences.ts`).
 */
export const BIBLIOTHEQUES_PROPOSEES: readonly { id: string; source: string; nom: string; description: string }[] = [
  {
    id: 'anthropics-skills',
    source: 'anthropics/skills',
    nom: 'Anthropic',
    description: 'Documents, tableurs, présentations, PDF, conception d’interfaces.',
  },
  {
    id: 'openai-skills',
    source: 'openai/skills',
    nom: 'OpenAI',
    description: 'La collection publiée pour Codex.',
  },
];

/* ------------------------------------------------------------------ */
/* Ce que l'écran fait installer                                        */
/* ------------------------------------------------------------------ */

/**
 * L'ASSISTANT INSTALLE LUI-MÊME. Qui vient d'installer Beluga Build n'a pas à
 * retourner dans un terminal : un bouton demande au démon de lancer
 * l'installation, et sa sortie s'affiche en direct à côté.
 *
 * LE NAVIGATEUR NE NOMME QU'UN GENRE, JAMAIS UNE COMMANDE : un moteur du
 * registre, ou une de ces fonctions. La ligne réellement exécutée est écrite
 * dans le démon (`server/src/installation-travaux.ts`) — un texte venu de
 * l'écran ne s'exécute jamais.
 */
/*
 * `voix-reparer` : la voix refaite (fichiers rendus au compte du service,
 * environnement Python inutilisable mis de côté et refait), puis essayée ;
 * `gh` : l'outil GitHub, quand l'installateur n'a pas pu le poser ;
 * `signature-des-courriels` : la signature DKIM des courriels envoyés par ce
 * serveur, pour le domaine de l'adresse d'expédition.
 */
export const FONCTIONS_INSTALLABLES = ['memoire', 'dictee', 'voix', 'voix-reparer', 'gh', 'signature-des-courriels'] as const;
export type FonctionInstallable = (typeof FONCTIONS_INSTALLABLES)[number];

/** Un travail d'installation, tel que l'écran le suit. Un seul à la fois. */
export const TravailDInstallation = z.object({
  /** L'identifiant d'un moteur, une fonction installable, ou un travail de l'installation (`copie`, `mise-a-jour`). */
  genre: z.string(),
  etat: z.enum(['en-cours', 'reussi', 'echoue']),
  debut: z.number(),
  fin: z.number().optional(),
  /** La sortie accumulée : c'est elle qui se relit après un rechargement. */
  sortie: z.string().default(''),
  /** Ce qui a manqué, en une phrase affichable, quand le travail a échoué. */
  erreur: z.string().optional(),
});
export type TravailDInstallation = z.infer<typeof TravailDInstallation>;

/** La sortie gardée d'un travail est bornée : on en garde la FIN, c'est là qu'est l'erreur. */
export const PLAFOND_DE_SORTIE = 200_000;

export function sortieBornee(sortie: string, plafond = PLAFOND_DE_SORTIE): string {
  return sortie.length > plafond ? sortie.slice(sortie.length - plafond) : sortie;
}

/* ------------------------------------------------------------------ */
/* La copie personnelle et les nouveautés                               */
/* ------------------------------------------------------------------ */

/**
 * BELUGA BUILD N'EST PAS UN LOGICIEL LIBRE QU'ON SUIT : c'est une base aboutie,
 * mise à disposition pour que chacun en fasse SON outil. L'installation part du
 * dépôt public ; la page « Votre propre Beluga » en fait un dépôt privé de qui
 * l'installe, et garde le dépôt public sous le nom `amont` — c'est de là que
 * viennent ensuite les nouveautés, à la demande.
 */
export const DEPOT_PUBLIC = 'https://github.com/haikostudio/beluga.git';
export const DISTANT_PUBLIC = 'amont';
export const NOM_DE_COPIE_PAR_DEFAUT = 'beluga';

/** Un nom de dépôt GitHub acceptable — il part tel quel dans une commande, donc rien d'autre ne passe. */
export function nomDeDepotValide(nom: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(nom) && !nom.endsWith('.git') && nom !== '.' && nom !== '..';
}

/** « git@github.com:a/b.git » et « https://github.com/a/b » désignent tous deux « a/b ». */
export function depotDeLAdresse(adresse: string): string {
  const trouve = /github\.com[:/]+([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i.exec(adresse.trim());
  return trouve ? `${trouve[1]}/${trouve[2]}`.toLowerCase() : '';
}

/** Ce qu'il faut faire d'un distant `origin` qui pointe sur le dépôt public. */
export type PlanDeDetachement = 'rien' | 'renommer' | 'retirer';

/**
 * LE DÉPÔT PUBLIC SE LIT, IL NE SE POUSSE JAMAIS depuis un projet de l'outil.
 * Une installation clonée depuis le dépôt public a `origin` dessus : la mise en
 * ligne y enverrait le travail et réclamerait le jeton de Haiko Studio. On le
 * range donc sous le nom `amont` (lecture des nouveautés) — ou on le retire
 * quand `amont` existe déjà. Un `origin` qui n'est pas le dépôt public (celui
 * de l'auteur, le dépôt privé d'une copie) n'est JAMAIS touché.
 */
export function planDeDetachement(distants: Record<string, string>): PlanDeDetachement {
  const origine = distants.origin;
  if (!origine || depotDeLAdresse(origine) !== depotDeLAdresse(DEPOT_PUBLIC)) return 'rien';
  return distants[DISTANT_PUBLIC] ? 'retirer' : 'renommer';
}

export const EtatDesNouveautes = z.object({
  /** L'installation suit-elle le dépôt public ? Faux : rien ne s'affiche, nulle part. */
  suivi: z.boolean(),
  /** Le dépôt public porte-t-il du nouveau par rapport à cette installation ? */
  disponibles: z.boolean().default(false),
  /** Combien d'enregistrements nouveaux, quand cela se compte. */
  nombre: z.number().optional(),
  /** Le sommet du dépôt public au dernier relevé : c'est lui qu'on écarte en refermant le bandeau. */
  sommet: z.string().optional(),
  /** Cette installation est-elle devenue une copie personnelle (dépôt à soi, projet sur le tableau) ? */
  copie: z.boolean().default(false),
  releveLe: z.number().optional(),
  erreur: z.string().optional(),
});
export type EtatDesNouveautes = z.infer<typeof EtatDesNouveautes>;

/** Faut-il montrer le bandeau « Mettre à jour » ? Jamais pour un sommet déjà écarté. */
export function bandeauDeMiseAJour(etat: EtatDesNouveautes | null | undefined, ecarte: string | null | undefined): boolean {
  if (!etat?.suivi || !etat.disponibles || !etat.sommet) return false;
  return etat.sommet !== ecarte;
}

/* ------------------------------------------------------------------ */
/* Les secrets que l'écran fait ranger                                  */
/* ------------------------------------------------------------------ */

/** Chaque secret a SA fiche au coffre-fort ; l'écran ne nomme que son genre. */
export const GENRES_DE_SECRET = [
  'courriels',
  'smtp',
  'dns',
  'dns-cloudflare',
  'dns-infomaniak',
  'dns-gandi',
  'dns-ovh-application',
  'dns-ovh-secret',
  'dns-ovh-consommateur',
] as const;
export type GenreDeSecret = (typeof GENRES_DE_SECRET)[number];

/** Des services de courriel courants : le préréglage ne remplit que l'hôte et le port. */
export const PREREGLAGES_SMTP: readonly { id: string; nom: string; hote: string; port: string }[] = [
  { id: 'brevo', nom: 'Brevo', hote: 'smtp-relay.brevo.com', port: '587' },
  { id: 'mailgun', nom: 'Mailgun', hote: 'smtp.eu.mailgun.org', port: '587' },
  { id: 'infomaniak', nom: 'Infomaniak', hote: 'mail.infomaniak.com', port: '587' },
  { id: 'gmail', nom: 'Gmail', hote: 'smtp.gmail.com', port: '587' },
  { id: 'resend', nom: 'Resend', hote: 'smtp.resend.com', port: '587' },
];
