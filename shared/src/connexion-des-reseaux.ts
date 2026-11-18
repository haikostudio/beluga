import { FICHES_RESEAUX, type ReseauSocial } from './reseaux-sociaux.js';

/**
 * LA CONNEXION DES RÉSEAUX PAR CHROME (carte « Réseaux sociaux reliés par Chrome », 09/11/2026).
 *
 * Communication 2 suit quatre étapes : Réseaux (on choisit), Campagnes, Connexion, Calendrier. À la Connexion, UN
 * agent par marque — dans le Chrome de la personne qui clique, par l'extension Beluga — reprend les accès du coffre ou
 * crée la boîte e-mail de la marque puis le compte, et TENTE la voie officielle du réseau (application développeur +
 * connexion OAuth). Refusée, payante ou trop longue à obtenir : le réseau publie PAR CHROME — un agent poste dans ce
 * même Chrome à l'heure prévue. Chrome fermé : une alerte une heure avant, puis le post part à la réouverture, marqué
 * « publié en retard ».
 *
 * Ce fichier ne porte que les règles pures : états d'une ligne, consignes des deux agents, alerte et retard.
 */

/** Comment un compte relié publie : par l'interface officielle du réseau, ou par un agent dans Chrome. */
export const MODES_DE_PUBLICATION = ['officiel', 'chrome'] as const;
export type ModeDePublication = (typeof MODES_DE_PUBLICATION)[number];

export function estModeDePublication(v: unknown): v is ModeDePublication {
  return (MODES_DE_PUBLICATION as readonly unknown[]).includes(v);
}

/** Ce que l'agent de connexion a écrit sur un réseau (outil « marketing », action « connexion »). */
export const ETATS_DE_CONNEXION = ['en_cours', 'connecte', 'bloque'] as const;
export type EtatDeConnexion = (typeof ETATS_DE_CONNEXION)[number];

export interface ConnexionDUnReseau {
  etat: EtatDeConnexion;
  mode?: ModeDePublication;
  /** Le nom du compte chez le réseau (@marque, nom de la page). */
  compte?: string;
  /** Ce qui bloque, ou ce qui reste à faire, en une phrase. */
  note?: string;
  majLe: number;
}

/** L'état des connexions d'un projet, gardé en une ligne JSON ; une lecture abîmée vaut « rien d'écrit ». */
export function lireLesConnexions(brut: string | null | undefined): Partial<Record<ReseauSocial, ConnexionDUnReseau>> {
  if (!brut) return {};
  try {
    const v = JSON.parse(brut) as Record<string, unknown>;
    const sortie: Partial<Record<ReseauSocial, ConnexionDUnReseau>> = {};
    for (const [reseau, c] of Object.entries(v ?? {})) {
      if (!(reseau in FICHES_RESEAUX) || !c || typeof c !== 'object') continue;
      const l = c as Record<string, unknown>;
      if (!(ETATS_DE_CONNEXION as readonly unknown[]).includes(l.etat)) continue;
      sortie[reseau as ReseauSocial] = {
        etat: l.etat as EtatDeConnexion,
        ...(estModeDePublication(l.mode) ? { mode: l.mode } : {}),
        ...(typeof l.compte === 'string' && l.compte.trim() ? { compte: l.compte.trim().slice(0, 120) } : {}),
        ...(typeof l.note === 'string' && l.note.trim() ? { note: l.note.trim().slice(0, 400) } : {}),
        majLe: typeof l.majLe === 'number' ? l.majLe : 0,
      };
    }
    return sortie;
  } catch {
    return {};
  }
}

/** Ce que montre la ligne d'un réseau à la page Connexion. */
export type EtatDeLaLigneDeConnexion = 'officiel' | 'chrome' | 'en_cours' | 'bloque' | 'a_relier' | 'a_connecter';

/**
 * L'ÉTAT D'UNE LIGNE, dans cet ordre : un compte relié EN BASE fait foi (officiel ou Chrome) — jamais « connecté » sur
 * la seule parole de l'agent ; puis l'agent qui travaille ; puis un blocage dit ; puis un compte à relier de nouveau ;
 * sinon, à connecter. Un « en cours » écrit par un agent qui ne travaille plus n'est pas un travail en cours.
 */
export function etatDeLaLigneDeConnexion(e: {
  comptes: readonly { etat: string; mode?: ModeDePublication }[];
  connexion?: Pick<ConnexionDUnReseau, 'etat'> | null;
  agentAuTravail: boolean;
}): EtatDeLaLigneDeConnexion {
  const relie = e.comptes.find((c) => c.etat === 'relie');
  if (relie) return relie.mode === 'chrome' ? 'chrome' : 'officiel';
  if (e.agentAuTravail && e.connexion?.etat !== 'bloque') return 'en_cours';
  if (e.connexion?.etat === 'bloque') return 'bloque';
  if (e.comptes.some((c) => c.etat === 'a_relier')) return 'a_relier';
  return 'a_connecter';
}

/* ------------------------------------------------------------------ */
/* La consigne de l'agent de connexion                                 */
/* ------------------------------------------------------------------ */

export interface DemandeDeConnexion {
  nomProjet: string;
  /** Le dossier du coffre de ce projet (son nom, tel qu'il range ses fiches). */
  dossierCoffre: string;
  reseaux: readonly { reseau: ReseauSocial; applicationPrete: boolean }[];
  adresseRetour: string;
  adresseProduit?: string | null;
  /** Le domaine du site, quand il est connu : la boîte de la marque s'y crée. */
  domaine?: string | null;
}

/**
 * LA CONSIGNE DE L'AGENT DE CONNEXION : un seul agent par marque, les réseaux l'un après l'autre (la boîte e-mail ne se
 * crée qu'une fois). Il agit dans le Chrome de la personne qui a cliqué (outil « chrome »), jamais dans un navigateur
 * du serveur. Il ne paie rien et ne publie rien.
 */
export function demandeDeConnexionDesReseaux(d: DemandeDeConnexion): string {
  const liste = d.reseaux.map((r) => `${FICHES_RESEAUX[r.reseau].libelle} (« ${r.reseau} »)`).join(', ');
  const meta = d.reseaux.filter((r) => r.reseau === 'facebook' || r.reseau === 'instagram');
  return [
    `CONNECTER LES RÉSEAUX DE « ${d.nomProjet} » À BELUGA : ${liste}.`,
    '',
    'Tu travailles DANS LE CHROME de la personne qui a cliqué, par l’outil « chrome » (extension Beluga) — jamais par un navigateur du serveur. Tu traites les réseaux L’UN APRÈS L’AUTRE, dans l’ordre donné, et tu écris l’état de chacun au fur et à mesure : la page Connexion le montre en direct.',
    '',
    'POUR CHAQUE RÉSEAU :',
    `0. Annonce-le : outil « marketing », action « connexion », reseau, etat « en_cours ».`,
    `1. LE COFFRE D'ABORD : outil « coffre_fort », geste « lister » (recherche « ${d.nomProjet} » et le nom du réseau ; dossier « ${d.dossierCoffre}/Commun/Réseaux sociaux »). Regarde AUSSI dans Chrome si une session du compte est déjà ouverte (geste « aller » sur le réseau). Un compte qui existe ne se recrée JAMAIS.`,
    '2. ACCÈS TROUVÉS : connecte-toi dans Chrome (geste « se_connecter » avec la fiche du coffre).',
    `3. AUCUN COMPTE : il faut une adresse e-mail à la marque.`,
    `   a. Cherche-la au coffre (dossier « ${d.dossierCoffre}/Production/E-mail »).`,
    `   b. Absente et le domaine${d.domaine ? ` « ${d.domaine} »` : ''} appartient à Haiko : crée la boîte (hello@ du domaine) chez Infomaniak dans Chrome, range-la au coffre, puis ajoute-la à ProjetE — suis la compétence « boite-d-un-nouveau-domaine-relevee-par-projete ». UNE seule boîte pour toute la marque.`,
    '   c. Domaine d’un CLIENT, ou domaine inconnu : ne crée rien — demande l’adresse à utiliser avec « ask_user ».',
    '   d. Inscris la marque sur le réseau avec cette adresse (nom, photo et description tirés de la marque). Les codes envoyés par courriel se lisent toi-même dans ProjetE ou par IMAP (même compétence). Range AUSSITÔT chaque accès au coffre : une fiche par compte, type mot de passe, identifiant dans sa case, dossier « ' +
      d.dossierCoffre +
      '/Commun/Réseaux sociaux ».',
    '4. LA VOIE OFFICIELLE : tente-la. Crée (ou retrouve) l’application développeur du réseau dans Chrome, avec l’adresse de retour exacte ' +
      d.adresseRetour +
      ' ; rends-la par l’outil « marketing », action « application » (le secret part au coffre). Puis demande l’adresse de connexion officielle — outil « marketing », action « lien_officiel », reseau — et ouvre-la dans le même Chrome (geste « aller ») : accepte les droits demandés. Le retour arrive seul à Beluga et le compte paraît relié en base ; vérifie-le avec l’action « lire ».',
    '5. VOIE OFFICIELLE IMPOSSIBLE — refusée, PAYANTE, ou en revue de plusieurs jours : ne paie JAMAIS. Le réseau publiera par Chrome. Écris : outil « marketing », action « connexion », reseau, etat « connecte », mode « chrome », compte (le nom affiché du compte, @… ou nom de page).',
    '6. Voie officielle réussie : outil « marketing », action « connexion », reseau, etat « connecte », mode « officiel », compte.',
    '7. BLOQUÉ (anti-robot, code SMS sans réponse, association « non disponible ») : outil « marketing », action « connexion », reseau, etat « bloque », note qui dit le blocage en une phrase. Puis passe au réseau suivant. Un anti-robot : geste « demander_la_main » plutôt que de forcer.',
    '',
    ...(meta.length
      ? [
          'FACEBOOK ET INSTAGRAM : une SEULE application Meta, sur le vrai compte de la personne (déjà connecté dans son Chrome), pour toutes ses marques. La page Facebook de la marque se crée depuis ce compte ; Instagram passe en compte professionnel relié à la page. La connexion officielle de Meta ramène toutes les pages : chacune va à son projet par son nom. Jamais de nouveau compte Facebook personnel.',
          '',
        ]
      : []),
    'RÈGLES :',
    `- Site de la marque : ${d.adresseProduit ?? 'inconnu'}.`,
    '- Un code reçu par SMS : déclenche l’envoi PUIS demande le code avec « ask_user », dans le même tour.',
    '- Rien ne se paie, aucun compte ne se supprime : ce sont des gestes de la personne.',
    '- Tu ne publies RIEN pendant la connexion.',
    '- Chaque identifiant obtenu (adresse, mot de passe, clé, secret) part au coffre AUSSITÔT, une fiche par secret ; jamais dans un message.',
    '- Termine par un compte rendu court : pour chaque réseau, connecté (officiel ou par Chrome) ou bloqué, et pourquoi.',
  ].join('\n');
}

/* ------------------------------------------------------------------ */
/* La publication par Chrome                                           */
/* ------------------------------------------------------------------ */

/** Un envoi par Chrome est un agent qui travaille : il a droit à plus de temps qu'un appel d'API. */
export const DUREE_ENVOI_CHROME_MAX_MS = 45 * 60_000;

/** L'alerte « Chrome fermé » part une heure avant l'heure prévue. */
export const AVANCE_ALERTE_CHROME_MS = 60 * 60_000;

/** Au-delà de ce délai après l'heure prévue, un post est dit « publié en retard ». */
export const RETARD_TOLERE_MS = 15 * 60_000;

/**
 * L'ALERTE « CHROME FERMÉ » : une heure avant l'heure prévue (ou dès qu'on le voit, si le post a été programmé plus
 * tard que cela), quand AUCUN Chrome de la personne n'est ouvert — une fois par envoi, jamais redite.
 */
export function alerteChromeAEnvoyer(e: { prevuLe: number | null; maintenant: number; chromeOuvert: boolean; dejaAlertee: boolean }): boolean {
  if (e.prevuLe === null || e.chromeOuvert || e.dejaAlertee) return false;
  return e.maintenant >= e.prevuLe - AVANCE_ALERTE_CHROME_MS;
}

/** « Publié en retard » : parti plus d'un quart d'heure après l'heure prévue (Chrome fermé, puis rattrapage). */
export function publieEnRetard(prevuLe: number | null | undefined, publieLe: number | null | undefined): boolean {
  if (!prevuLe || !publieLe) return false;
  return publieLe - prevuLe > RETARD_TOLERE_MS;
}

export interface DemandeDePublicationParChrome {
  nomProjet: string;
  reseau: ReseauSocial;
  /** Le nom du compte connecté (@marque, nom de la page). */
  compte: string;
  contenuId: string;
  compteId: string;
  texte: string;
  lien?: string | null;
  medias: readonly { genre: string; chemin: string }[];
  /** En minutes, quand le post part après son heure (rattrapage). */
  retardMinutes?: number;
}

/**
 * LA CONSIGNE DE L'AGENT QUI PUBLIE PAR CHROME : un post, un compte, une fois. Il rend l'adresse du post — ou l'échec —
 * par l'outil « marketing », action « publication » ; c'est ce rendu qui empêche tout second envoi.
 */
export function demandeDePublicationParChrome(d: DemandeDePublicationParChrome): string {
  const libelle = FICHES_RESEAUX[d.reseau].libelle;
  return [
    `PUBLIER SUR ${libelle.toUpperCase()} POUR « ${d.nomProjet} », DANS CHROME — UNE SEULE FOIS.`,
    '',
    `Compte : ${d.compte}. Ce post a été validé et programmé par l’utilisateur : tu le publies tel quel, sans rien réécrire.${d.retardMinutes ? ` Il part avec ${d.retardMinutes} min de retard (Chrome était fermé) : publie-le maintenant.` : ''}`,
    '',
    'LE TEXTE, EXACTEMENT :',
    '"""',
    d.texte,
    '"""',
    ...(d.lien ? ['', `Le lien à joindre : ${d.lien}`] : []),
    ...(d.medias.length ? ['', 'LES MÉDIAS (outil « chrome », geste « deposer » avec « fichier » = ce chemin — 15 Mo au plus) :', ...d.medias.map((m) => `- ${m.genre} : ${m.chemin}`)] : []),
    '',
    'MARCHE À SUIVRE :',
    `1. Outil « chrome » : ouvre ${libelle}, vérifie que tu es bien sur le compte « ${d.compte} » (sinon geste « se_connecter » avec la fiche du coffre).`,
    '2. AVANT de publier, regarde le fil du compte : si ce post y est DÉJÀ (même texte, publié il y a peu), ne republie pas — rends son adresse.',
    '3. Crée le post, dépose les médias, colle le texte, publie.',
    `4. Rends le résultat : outil « marketing », action « publication », contenuId « ${d.contenuId} », compteId « ${d.compteId} », et soit url (l’adresse du post publié), soit echec (ce qui a empêché, en une phrase).`,
    '',
    'RÈGLES : un seul envoi — après un clic sur « Publier », tu ne cliques jamais une seconde fois, même si la page tarde ; tu vérifies le fil. Rien ne se paie, rien d’autre ne se publie. Un anti-robot : geste « demander_la_main ».',
  ].join('\n');
}

/** Ce que le calendrier dit d'un post qui passe par Chrome : il attend Chrome, ou il est parti en retard. */
export type EnvoiParChrome = 'attente-chrome' | 'en-retard';

export function envoiParChromeDuContenu(e: {
  prevuLe: number | null;
  etape: string;
  cibles: readonly { etat: string; chrome: boolean; publieLe?: number }[];
  maintenant: number;
}): EnvoiParChrome | null {
  if (e.prevuLe === null) return null;
  if (e.etape === 'programme' && e.prevuLe <= e.maintenant && e.cibles.some((c) => c.chrome && c.etat === 'en_attente')) return 'attente-chrome';
  if (e.cibles.some((c) => c.chrome && c.etat === 'publie' && publieEnRetard(e.prevuLe, c.publieLe))) return 'en-retard';
  return null;
}
