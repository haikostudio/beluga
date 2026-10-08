/**
 * LES COURRIELS DE L'ESPACE CLIENT, ET RIEN D'AUTRE — deux rendez-vous, plus
 * le mot de bienvenue qui porte les identifiants d'un compte neuf.
 *
 * Pas un courriel à chaque changement — un client qui reçoit huit messages pour
 * une journée de travail finit par tous les classer sans les lire. Deux
 * rendez-vous, deux destinataires, deux contenus :
 *
 *  - LE POINT QUOTIDIEN DE HAIKO, chaque matin : TOUS les clients, ce qui reste
 *    à gérer chez lui, et ce qui est nouveau depuis la veille ;
 *  - LE COURRIEL DU LUNDI MATIN, pour chaque client : les demandes qui
 *    attendent SA réponse, celles qui portent un message qu'il n'a pas lu, et
 *    la date de livraison annoncée quand il y en a une.
 *
 * Dans les deux cas, chaque demande citée porte un LIEN qui ouvre sa fiche
 * directement sur la réponse : répondre depuis le courriel, c'est un clic.
 *
 * Tout ce fichier est PUR : aucune base, aucun réseau, aucune horloge cachée.
 * L'instant est toujours passé en argument — sans quoi un essai écrit un lundi
 * passerait, et tomberait le mardi suivant.
 */

import {
  FRAGMENT_DE_DISCUSSION,
  construireFragment,
  construireFragmentDeDemande,
} from './adresse-navigateur.js';
import type { ActiviteDemande } from './espace-client.js';
import {
  cadreBlanc,
  bullesDuBlocTexte,
  carteDeDemande,
  carteDeDiscussion,
  changementsTexte,
  documentDeCourriel,
  encadre,
  encadreDIdentifiants,
  enteteDeClient,
  lienDiscret,
  listeDePoints,
  noteAIcone,
  paragraphe,
  titreDeSection,
  titreTexte,
} from './gabarit-courriel.js';
import { accord, enumeration, nombre, phraseDeChangement } from './phrases-courriel.js';
import { HOTE_ESPACE_CLIENT } from './porte-client.js';

/* ------------------------------------------------------------------ */
/* Les rendez-vous                                                      */
/* ------------------------------------------------------------------ */

/** Le jour de la semaine du courriel client : lundi (0 = dimanche). */
export const JOUR_DU_COURRIEL_CLIENT = 1;
/** L'heure à partir de laquelle il part, le lundi. */
export const HEURE_DU_COURRIEL_CLIENT = 8;
/** L'heure du point quotidien de Haiko : avant celui des clients. */
export const HEURE_DU_POINT_QUOTIDIEN = 7;

/** L'adresse de Haiko. Le point quotidien ne va QU'À elle. */
export const ADRESSE_DE_HAIKO = 'salut@haiko.studio';

/**
 * L'EXPÉDITEUR. `haiko.studio` est le SEUL domaine vérifié chez Resend : un
 * envoi depuis un autre est refusé net. Écrit ici pour qu'on n'ait pas à le
 * redécouvrir en lisant un refus.
 */
export const DOMAINE_EXPEDITEUR = 'haiko.studio';
export const EXPEDITEUR_RECAPITULATIF = `Haiko Studio <bonjour@${DOMAINE_EXPEDITEUR}>`;

/** Où vit l'espace client, et où vit l'administration : les deux liens. */
export const ADRESSE_ESPACE_CLIENT = `https://${HOTE_ESPACE_CLIENT}`;
export const ADRESSE_ADMINISTRATION = 'https://belugatool.haikostudio.cloud';

/* ------------------------------------------------------------------ */
/* Les clés anti-doublon                                                */
/* ------------------------------------------------------------------ */

/**
 * LA CLÉ D'UNE SEMAINE, telle qu'on la retient pour ne pas envoyer deux fois.
 * C'est la seule garantie qui survive à un redémarrage un lundi matin : le
 * démon relit la clé écrite en base, pas un minuteur qu'il aurait perdu.
 *
 * Semaine ISO — celle qui commence le lundi : « 2026-S37 ».
 */
export function cleDeSemaine(instant: number): string {
  const d = new Date(instant);
  d.setHours(0, 0, 0, 0);
  // On se place sur le JEUDI de la semaine : c'est lui qui décide de l'année ISO.
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const premierJeudi = new Date(d.getFullYear(), 0, 4);
  premierJeudi.setDate(premierJeudi.getDate() + 3 - ((premierJeudi.getDay() + 6) % 7));
  const semaine = 1 + Math.round((d.getTime() - premierJeudi.getTime()) / (7 * 24 * 3600 * 1000));
  return `${d.getFullYear()}-S${String(semaine).padStart(2, '0')}`;
}

/** La même garantie, mais au jour : « 2026-09-08 ». */
export function cleDuJour(instant: number): string {
  const d = new Date(instant);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * EST-CE LE MOMENT DU COURRIEL CLIENT ? Lundi, 8 h passées, et pas déjà fait
 * cette semaine.
 *
 * Un démon redémarré le lundi à 8 h 30 REPASSE ici : c'est la clé de semaine
 * déjà écrite qui l'arrête, pas la chance.
 */
export function estLHeureDuCourrielDuClient(instant: number, derniereSemaineEnvoyee?: string): boolean {
  const d = new Date(instant);
  if (d.getDay() !== JOUR_DU_COURRIEL_CLIENT) return false;
  if (d.getHours() < HEURE_DU_COURRIEL_CLIENT) return false;
  return cleDeSemaine(instant) !== derniereSemaineEnvoyee;
}

/** EST-CE LE MOMENT DU POINT DE HAIKO ? Chaque matin, une seule fois par jour. */
export function estLHeureDuPointQuotidien(instant: number, dernierJourEnvoye?: string): boolean {
  const d = new Date(instant);
  if (d.getHours() < HEURE_DU_POINT_QUOTIDIEN) return false;
  return cleDuJour(instant) !== dernierJourEnvoye;
}

/** Le début de la semaine couverte : les sept jours qui précèdent l'envoi. */
export function debutDeLaSemaine(instant: number): number {
  return instant - 7 * 24 * 3600 * 1000;
}

/** Le début de la journée couverte par le point de Haiko : les 24 dernières heures. */
export function debutDeLaJournee(instant: number): number {
  return instant - 24 * 3600 * 1000;
}

/* ------------------------------------------------------------------ */
/* La matière : ce qu'une demande devient dans un courriel              */
/* ------------------------------------------------------------------ */

/**
 * UN MESSAGE VU DEPUIS UN COURRIEL. Volontairement plat : le serveur le remplit
 * depuis la base, et tout ce qui suit se teste sans base du tout.
 */
export interface MessageAuCourriel {
  /** Le nom écrit au-dessus de la bulle. */
  auteur: string;
  /** QUEL CÔTÉ : le destinataire du courriel est à droite, l'autre à gauche. */
  role: 'admin' | 'client';
  texte: string;
  date: number;
}

/** Un changement opéré sur une demande, tel qu'il se lit SOUS sa carte. */
export interface ChangementAuCourriel {
  auteur: string;
  role: 'admin' | 'client';
  /** La phrase du journal d'activité, traduite en français lisible (`phraseDeChangement`). */
  detail: string;
  date: number;
}

/**
 * COMBIEN DE BULLES PAR BLOC, AU PLUS. Le plafond n'est pas global : six pour
 * la discussion directe, et six PAR DEMANDE — chaque demande ayant sa carte.
 * Gmail coupe un message au-delà d'environ 102 Ko ; un courriel qui déroulerait
 * tout un historique serait tronqué en plein milieu, sans le dire.
 */
export const MESSAGES_PAR_BLOC = 6;

/** Un bloc de conversation : ses bulles retenues, et ce qui a été écarté. */
export interface BlocDeMessages {
  messages: MessageAuCourriel[];
  /** Combien de messages plus anciens n'ont pas été montrés. */
  ecartes: number;
}

/**
 * LES PLUS RÉCENTS, SIX AU PLUS, REMIS DANS L'ORDRE DE LECTURE. On garde la
 * FIN de la conversation — c'est elle qui attend une réponse — mais on l'écrit
 * du plus ancien au plus récent, comme un fil de messagerie.
 */
export function blocDeMessages(
  messages: readonly MessageAuCourriel[],
  plafond = MESSAGES_PAR_BLOC,
): BlocDeMessages {
  const tries = [...messages].sort((a, b) => a.date - b.date);
  if (tries.length <= plafond) return { messages: tries, ecartes: 0 };
  return { messages: tries.slice(tries.length - plafond), ecartes: tries.length - plafond };
}

/**
 * UNE DEMANDE VUE DEPUIS UN COURRIEL : son titre, ses bulles, ce qui a bougé
 * dessus. Plate elle aussi — aucune base derrière ce type.
 */
export interface DemandeAuCourriel {
  id: string;
  projectId: string;
  titre: string;
  /** Le nom du projet, quand on l'a : un client peut en avoir plusieurs. */
  projet?: string;
  /**
   * Combien de messages il n'a pas encore lus sur cette fiche. C'est la SEULE
   * mesure de ce qui l'attend : le drapeau « réponse attendue » n'existe plus,
   * personne ne le posait et il contredisait le fil une fois sur deux.
   */
  nonLus: number;
  /** La date de livraison ANNONCÉE par Haiko, quand elle est posée. */
  livraisonAnnoncee?: number;
  /**
   * LES MESSAGES NON LUS EUX-MÊMES, plus seulement leur nombre : c'est ce qui
   * fait les bulles de la carte. Vide tant que le serveur ne les remplit pas —
   * une demande sans bulle reste affichable, elle ne montre que son titre.
   */
  messages?: readonly MessageAuCourriel[];
  /** Ce qui a bougé sur CETTE demande, écrit sous ses bulles. */
  changements?: readonly ChangementAuCourriel[];
}

/** Le fil DIRECT d'un client — celui qui ne tient à aucune demande. */
export interface DiscussionAuCourriel {
  messages: readonly MessageAuCourriel[];
  /** Combien de ces messages le destinataire n'a pas lus. */
  nonLus: number;
}

/** Ce que le courriel du lundi a à dire à UN client. */
export interface PointDuClient {
  /** Ce qui porte des messages qu'il n'a pas lus, ou qui a bougé. */
  aLire: DemandeAuCourriel[];
  /** La discussion directe, quand elle porte du non-lu. */
  discussion?: DiscussionAuCourriel;
  /** Rien à dire : dans ce cas AUCUN courriel ne part. */
  vide: boolean;
}

/** Une demande mérite-t-elle sa carte ? Du non-lu, ou un changement. */
export function demandeADireQuelqueChose(demande: DemandeAuCourriel): boolean {
  return demande.nonLus > 0 || (demande.changements?.length ?? 0) > 0;
}

/**
 * UN SEUL BLOC, ET IL SE LIT DANS LA BASE. Le courriel avait deux listes : ce
 * qui « attendait une réponse » — un drapeau à cocher que personne ne cochait —
 * et ce qui n'était pas lu. La première mentait régulièrement ; il ne reste
 * donc que la seconde, qui est un FAIT.
 *
 * LE TRI EST UNE RÈGLE, PAS UN HASARD : le plus de messages non lus d'abord, et
 * à égalité l'ordre d'arrivée est gardé.
 *
 * UNE DEMANDE QUI A SEULEMENT BOUGÉ garde sa carte : le changement se lit sous
 * les bulles, et il valait bien une ligne de courriel quand il vivait dans une
 * liste à part.
 */
export function pointDuClient(
  demandes: readonly DemandeAuCourriel[],
  discussion?: DiscussionAuCourriel,
): PointDuClient {
  const aLire = demandes.filter(demandeADireQuelqueChose).sort((a, b) => b.nonLus - a.nonLus);
  const fil = discussion && discussion.messages.length ? discussion : undefined;
  return { aLire, ...(fil ? { discussion: fil } : {}), vide: aLire.length === 0 && !fil };
}

/** Une ligne du point quotidien : un client, et ce qu'il reste à faire chez lui. */
export interface LigneDeClient {
  id: string;
  nom: string;
  /** Les demandes de ce client où Haiko n'a pas tout lu, ou qui ont bougé. */
  aLire: DemandeAuCourriel[];
  /** Les messages de ce client que Haiko n'a pas lus. */
  nonLus: number;
  /** Le fil direct de ce client, quand il porte quelque chose. */
  discussion?: DiscussionAuCourriel;
}

/** Ce que le point quotidien a à dire, tous clients confondus. */
export interface PointDeHaiko {
  clients: LigneDeClient[];
  /** Combien de DEMANDES portent des messages non lus, tous clients confondus. */
  aLire: number;
  /** Combien de MESSAGES sont non lus, tous clients confondus. */
  nonLus: number;
  nouveautes: number;
  /** Rien nulle part : dans ce cas AUCUN courriel ne part. */
  vide: boolean;
}

/**
 * LE POINT DE HAIKO GARDE LES CLIENTS QUI ONT QUELQUE CHOSE À DIRE, et les
 * range par ce qui presse : le plus de fiches non lues d'abord. Un client sans
 * rien du tout ne fait pas une ligne vide dans le courriel — il n'y figure pas.
 */
export function pointDeHaiko(lignes: readonly LigneDeClient[]): PointDeHaiko {
  const retenues = lignes
    .filter((l) => l.aLire.length || l.nonLus || l.discussion?.messages.length)
    .sort((a, b) => b.aLire.length - a.aLire.length || a.nom.localeCompare(b.nom));
  const aLire = retenues.reduce((n, l) => n + l.aLire.length, 0);
  const nonLus = retenues.reduce((n, l) => n + l.nonLus, 0);
  const nouveautes = retenues.reduce(
    (n, l) => n + l.aLire.reduce((m, d) => m + (d.changements?.length ?? 0), 0),
    0,
  );
  return { clients: retenues, aLire, nonLus, nouveautes, vide: retenues.length === 0 };
}

/**
 * CE QUI A BOUGÉ, LU DANS LE JOURNAL D'ACTIVITÉ — source unique déjà nourrie
 * par l'historique du tiroir et le compteur de non-lus. Les demandes ARCHIVÉES
 * en sont écartées en amont, par la requête : une demande rangée ne relance pas.
 *
 * LES CHANGEMENTS NE FONT PLUS UNE LISTE À PART : chacun rejoint LA DEMANDE
 * qu'il concerne, sous ses bulles. On les range donc par demande, du plus
 * ancien au plus récent, en écartant les phrases vides et les doublons exacts.
 *
 * LA LIGNE DU JOURNAL EST TRADUITE ICI, À LA LECTURE : un déplacement porte la
 * clé interne de sa colonne (« a-faire »), une étape son code (« demarree »).
 * Traduire à la lecture rend propres les lignes DÉJÀ en base, sans migration.
 */
export function changementsParDemande(
  activites: readonly ActiviteDemande[],
  plafondParDemande = MESSAGES_PAR_BLOC,
): Map<string, ChangementAuCourriel[]> {
  const par = new Map<string, ChangementAuCourriel[]>();
  for (const activite of activites) {
    // UN COMMENTAIRE N'EST PAS UN CHANGEMENT : il est déjà là, en bulle, avec
    // son texte entier. Le répéter sous la carte dirait deux fois la même chose.
    if (activite.genre === 'commentaire') continue;
    if (!activite.detail.trim()) continue;
    const detail = phraseDeChangement(activite.genre, activite.detail);
    if (!detail) continue;
    const liste = par.get(activite.demandeId) ?? [];
    if (liste.some((c) => c.detail === detail)) continue;
    liste.push({ auteur: activite.auteurNom, role: activite.auteurRole, detail, date: activite.creeLe });
    par.set(activite.demandeId, liste);
  }
  for (const [id, liste] of par) {
    liste.sort((a, b) => a.date - b.date);
    if (liste.length > plafondParDemande) par.set(id, liste.slice(liste.length - plafondParDemande));
  }
  return par;
}

/* ------------------------------------------------------------------ */
/* Les liens : répondre depuis le courriel                              */
/* ------------------------------------------------------------------ */

/**
 * LE LIEN QUE SUIT UN CLIENT : son espace, ouvert sur la fiche, prêt à
 * répondre. Le projet voyage avec l'identifiant — un client peut en avoir
 * plusieurs, et l'espace doit savoir lequel afficher avant d'ouvrir la fiche.
 */
export function lienDuClient(demande: Pick<DemandeAuCourriel, 'id' | 'projectId'>, base = ADRESSE_ESPACE_CLIENT): string {
  return `${base}/#${construireFragmentDeDemande(demande.projectId, demande.id)}`;
}

/**
 * LE LIEN QUE SUIT HAIKO : son application, écran « Espace client », sur le bon
 * client et la bonne fiche. Ce n'est pas la même adresse que celle du client :
 * l'administration ne se sert pas sur `my.`.
 */
export function lienDeHaiko(clientId: string, demandeId: string, base = ADRESSE_ADMINISTRATION): string {
  return `${base}/#${construireFragment({ vue: 'espace', clientId, demandeId })}`;
}

/**
 * LE LIEN DE LA DISCUSSION DIRECTE, CHEZ LE CLIENT. Le fil n'avait pas
 * d'adresse à lui dans un courriel : il en a une maintenant, la même que celle
 * qu'ouvre une notification poussée touchée.
 */
export function lienDeDiscussionDuClient(base = ADRESSE_ESPACE_CLIENT): string {
  return `${base}/#${FRAGMENT_DE_DISCUSSION}`;
}

/**
 * LE LIEN DE LA DISCUSSION D'UN CLIENT, CÔTÉ HAIKO. L'administration n'ouvre
 * pas un fil par son adresse : elle ouvre l'espace DU CLIENT, où le fil est à
 * un clic. C'est la cible la plus proche que l'adresse sache décrire.
 */
export function lienDeDiscussionDeHaiko(clientId: string, base = ADRESSE_ADMINISTRATION): string {
  return `${base}/#${construireFragment({ vue: 'espace', clientId })}`;
}

/* ------------------------------------------------------------------ */
/* Le troisième courriel : les identifiants d'un compte neuf            */
/* ------------------------------------------------------------------ */

/**
 * LE COURRIEL D'IDENTIFIANTS PART SUR CASE COCHÉE, JAMAIS DE LUI-MÊME. Il fait
 * sortir un mot de passe du démon : il ne part donc que si Haiko l'a demandé en
 * créant le compte, et vers une adresse qui a la forme d'une adresse. Rend
 * `null` quand il peut partir, la raison sinon.
 */
export function refusDEnvoiDesIdentifiants(envoyer: boolean | undefined, courriel: string | undefined): string | null {
  if (!envoyer) return 'L’envoi n’a pas été demandé.';
  const adresse = (courriel ?? '').trim();
  if (!adresse) return 'Aucune adresse de courriel n’a été saisie.';
  if (!/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(adresse)) return "Cette adresse de courriel n'a pas la bonne forme.";
  return null;
}

/** L'équipe qui signe les courriels adressés aux clients. */
const EQUIPE = 'L’équipe Haiko Studio';

/**
 * LE COURRIEL D'IDENTIFIANTS EST UN MOT DE BIENVENUE, pas une fiche technique :
 * ce que l'espace permet en trois points, les identifiants dans un encadré bien
 * lisible, un gros bouton pour se connecter, et un rappel bienveillant. Il
 * VOUVOIE, et reprend la présentation des deux autres courriels.
 */
export function courrielDIdentifiants(input: {
  nom: string;
  identifiant: string;
  motDePasse: string;
  lien?: string;
}): { sujet: string; texte: string; html: string } {
  const lien = input.lien ?? ADRESSE_ESPACE_CLIENT;
  const salutation = `Bienvenue ${input.nom} ! 🎉`;
  const intro =
    'Votre espace client Haiko Studio est prêt. C’est votre coin à vous pour faire avancer vos projets avec nous, simplement.';
  const points = [
    { emoji: '📌', icone: 'dossier', teinte: 'gris', texte: 'Suivre vos demandes, de la première idée à la mise en ligne' },
    { emoji: '💬', icone: 'bulle', teinte: 'gris', texte: 'Échanger avec nous au même endroit, sans chercher le bon courriel' },
    { emoji: '🔔', icone: 'cloche', teinte: 'gris', texte: 'Savoir tout de suite quand quelque chose avance' },
  ] as const;
  const rappel =
    'Ce mot de passe n’appartient qu’à vous : gardez-le précieusement et ne le partagez pas. Un oubli ? Écrivez-nous, on vous en redonne un en un clin d’œil.';
  const fin = `À très vite !\n${EQUIPE}`;

  const texte = [
    salutation,
    '',
    intro,
    '',
    ...titreTexte('Ce que vous pouvez y faire'),
    ...points.map((p) => `  ${p.emoji} ${p.texte}`),
    '',
    ...titreTexte('🔑 Vos identifiants'),
    `Adresse : ${lien}`,
    `Identifiant : ${input.identifiant}`,
    `Mot de passe : ${input.motDePasse}`,
    '',
    `🔒 ${rappel}`,
    '',
    fin,
  ].join('\n');

  const html = documentDeCourriel({
    titre: 'Bienvenue',
    apercu: 'Votre espace client est prêt : voici vos identifiants.',
    surtitre: 'Votre espace client',
    illustration: 'identifiants',
    lienEnTete: { libelle: 'Mon espace', lien },
    salutation,
    intro,
    corps:
      titreDeSection('Ce que vous pouvez y faire') +
      cadreBlanc(listeDePoints(points)) +
      encadreDIdentifiants({
        lien,
        identifiant: input.identifiant,
        motDePasse: input.motDePasse,
        libelleBouton: 'Me connecter à mon espace',
      }) +
      noteAIcone('cadenas', 'gris', rappel),
    fin,
  });
  return { sujet: '🎉 Bienvenue dans votre espace client Haiko Studio', texte, html };
}

/* ------------------------------------------------------------------ */
/* La rédaction                                                         */
/* ------------------------------------------------------------------ */

/** Une date écrite comme on l'écrit ici : « 08.09.2026 ». */
export function dateCourte(instant: number): string {
  const d = new Date(instant);
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
}

/**
 * UN OBJET DE COURRIEL NE SE COUPE PAS SUR TÉLÉPHONE : au-delà d'une
 * cinquantaine de signes, la messagerie le tronque. Un titre de demande ou un
 * nom trop long se raccourcit donc proprement, avec son « … ».
 */
export function raccourcir(texte: string, max: number): string {
  const t = texte.trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/**
 * CE QU'UNE DEMANDE DIT D'ELLE-MÊME SOUS SON TITRE : la livraison annoncée et
 * ce qui reste à lire, accordé. Une seule ligne, discrète — le gros du sens est
 * dans les bulles, pas dans cet en-tête. Le projet, lui, est posé par la carte.
 */
function piedDeDemande(demande: DemandeAuCourriel, avecEmojis = true): string {
  const bouts: string[] = [];
  const emoji = (e: string) => (avecEmojis ? `${e} ` : '');
  if (demande.livraisonAnnoncee) bouts.push(`${emoji('📅')}livraison annoncée le ${dateCourte(demande.livraisonAnnoncee)}`);
  if (demande.nonLus) bouts.push(`${emoji('💬')}${nombre(demande.nonLus, 'message non lu', 'messages non lus')}`);
  return bouts.join(' · ');
}

/** Les bulles d'une demande, plafonnées et remises dans l'ordre de lecture. */
function bullesDeLaDemande(demande: DemandeAuCourriel): BlocDeMessages {
  return blocDeMessages(demande.messages ?? []);
}

/** Une demande en TEXTE : titre, pied, bulles, ce qui a bougé, puis son lien. */
function demandeEnTexte(demande: DemandeAuCourriel, libelle: string, lien: string): string[] {
  const projet = demande.projet ? ` (${demande.projet})` : '';
  const pied = piedDeDemande(demande);
  return [
    `📌 ${demande.titre}${projet}`,
    ...(pied ? [`  ${pied}`] : []),
    ...bullesDuBlocTexte(bullesDeLaDemande(demande)),
    ...changementsTexte(demande.changements ?? []),
    `  → ${libelle} : ${lien}`,
    '',
  ];
}

/** Combien de changements portent ces demandes, tous confondus. */
function combienDeChangements(demandes: readonly DemandeAuCourriel[]): number {
  return demandes.reduce((n, d) => n + (d.changements?.length ?? 0), 0);
}

/** Un bouton de carte qui dit ce qu'on va y faire. */
function libelleChezLeClient(demande: DemandeAuCourriel): string {
  return demande.nonLus ? 'Lire et répondre' : 'Voir la demande';
}

/**
 * LE RÉCAPITULATIF DU CLIENT, en texte simple et en HTML. Écrit ici, donc
 * rejouable dans un essai sans rien envoyer à personne.
 *
 * IL VOUVOIE, sur un ton chaleureux et léger : une accroche qui résume la
 * semaine, puis la discussion directe, les demandes qui ont du nouveau (ses
 * messages à lui à droite, ceux de Haiko à gauche, et ce qui a bougé en
 * phrases simples), et enfin une invitation claire à répondre.
 */
export function courrielDuClient(
  nom: string,
  point: PointDuClient,
  liens: {
    demande?: (demande: DemandeAuCourriel) => string;
    discussion?: () => string;
    espace?: () => string;
  } = {},
): { sujet: string; texte: string; html: string } {
  const lienDeLaDemande = liens.demande ?? ((d: DemandeAuCourriel) => lienDuClient(d));
  const lienDuFil = liens.discussion ?? (() => lienDeDiscussionDuClient());
  const lienDeLEspace = liens.espace ?? (() => ADRESSE_ESPACE_CLIENT);

  const messages = point.aLire.reduce((n, d) => n + d.nonLus, 0) + (point.discussion?.nonLus ?? 0);
  const bouges = combienDeChangements(point.aLire);
  const nouvelles = enumeration([
    messages ? nombre(messages, 'nouveau message', 'nouveaux messages') : '',
    bouges ? `${nombre(bouges, 'changement')} sur vos demandes` : '',
  ]);
  const salutation = `Bonjour ${nom} 👋`;
  const intro = nouvelles
    ? `Voici le point de la semaine chez Haiko Studio : ${nouvelles}. Tout est rassemblé juste en dessous ☕`
    : 'Voici ce qui a avancé cette semaine chez Haiko Studio. Tout est rassemblé juste en dessous ☕';
  const titreDesDemandes = `📌 ${point.aLire.length > 1 ? 'Vos demandes' : 'Votre demande'}`;
  const invitation =
    'Une question, une idée, ou juste un « c’est parfait » ? Répondez directement depuis votre espace client : on lit tout, promis.';
  const fin = `Belle semaine à vous ! 🌿\n${EQUIPE}`;
  const mention = 'Vous recevez ce point parce que vous avez un espace client chez Haiko Studio.';

  /* --- Le texte : la même chose, sans une seule balise. --- */
  const lignes: string[] = [salutation, '', intro, ''];
  if (point.discussion) {
    lignes.push(
      ...titreTexte('💬 Votre discussion avec nous'),
      ...bullesDuBlocTexte(blocDeMessages(point.discussion.messages)),
      `  → Répondre : ${lienDuFil()}`,
      '',
    );
  }
  if (point.aLire.length) {
    lignes.push(...titreTexte(titreDesDemandes));
    for (const demande of point.aLire) {
      lignes.push(...demandeEnTexte(demande, libelleChezLeClient(demande), lienDeLaDemande(demande)));
    }
  }
  lignes.push(invitation, `Votre espace client : ${lienDeLEspace()}`, '', fin);

  /* --- Le HTML : le gabarit commun. --- */
  const corps: string[] = [];
  if (point.discussion) {
    corps.push(
      titreDeSection('Votre discussion avec nous'),
      carteDeDiscussion({
        titre: 'Vos échanges avec Haiko Studio',
        cotePropre: 'client',
        bloc: blocDeMessages(point.discussion.messages),
        lien: lienDuFil(),
        libelleBouton: 'Répondre',
      }),
    );
  }
  if (point.aLire.length) {
    corps.push(titreDeSection(point.aLire.length > 1 ? 'Vos demandes' : 'Votre demande'));
    for (const demande of point.aLire) {
      corps.push(
        carteDeDemande(demande, {
          cotePropre: 'client',
          bloc: bullesDeLaDemande(demande),
          lien: lienDeLaDemande(demande),
          libelleBouton: libelleChezLeClient(demande),
          pied: piedDeDemande(demande, false),
        }),
      );
    }
  }
  corps.push(encadre(paragraphe(invitation) + lienDiscret('Ouvrir mon espace client →', lienDeLEspace()), 'data-invitation'));

  const html = documentDeCourriel({
    titre: 'Votre semaine',
    apercu: intro,
    surtitre: 'Votre semaine',
    illustration: 'client',
    lienEnTete: { libelle: 'Mon espace', lien: lienDeLEspace() },
    salutation,
    intro,
    corps: corps.join(''),
    fin,
    mention,
  });

  const sujet =
    point.aLire.length === 1
      ? `✨ Du nouveau sur « ${raccourcir(point.aLire[0].titre, 28)} »`
      : point.aLire.length > 1
        ? `✨ Du nouveau sur ${point.aLire.length} de vos demandes`
        : point.discussion
          ? '💬 Un message vous attend chez Haiko Studio'
          : '☕ Votre point de la semaine';
  return { sujet, texte: lignes.join('\n'), html };
}

/**
 * LE POINT QUOTIDIEN DE HAIKO. Le même contenu pour tous les clients, dans un
 * seul courriel : c'est un tableau de bord du matin, pas une pile de messages.
 *
 * IL TUTOIE, et s'ouvre sur UNE phrase qui résume la journée. Chaque client a
 * son bandeau — son nom en clair, puis ce qui l'attend, accordé — suivi de son
 * bloc de discussion et de ses cartes. Seul le CÔTÉ change par rapport au
 * courriel du client : ici, c'est l'administration qui est à droite.
 */
export function courrielDeHaiko(
  point: PointDeHaiko,
  liens: {
    demande?: (clientId: string, demande: DemandeAuCourriel) => string;
    discussion?: (clientId: string) => string;
    espace?: () => string;
  } = {},
): { sujet: string; texte: string; html: string } {
  const lienDeLaDemande = liens.demande ?? ((c: string, d: DemandeAuCourriel) => lienDeHaiko(c, d.id));
  const lienDuFil = liens.discussion ?? ((c: string) => lienDeDiscussionDeHaiko(c));
  const lienDeLEspace = liens.espace ?? (() => `${ADRESSE_ADMINISTRATION}/#${construireFragment({ vue: 'espace' })}`);

  // « chez Alice » quand il n'y en a qu'un : plus parlant que « chez 1 client ».
  const chez = point.clients.length === 1 ? point.clients[0].nom : nombre(point.clients.length, 'client');
  const aussi = enumeration([
    point.nonLus ? nombre(point.nonLus, 'message non lu', 'messages non lus') : '',
    point.nouveautes ? nombre(point.nouveautes, 'changement') : '',
  ]);
  const salutation = 'Salut ! ☀️';
  const intro = point.aLire
    ? `${nombre(point.aLire, 'demande')} ${accord(point.aLire, 't’attend', 't’attendent')} chez ${chez}` +
      `${aussi ? `, avec ${aussi}` : ''}. Un café, et c’est parti ☕`
    : `Des messages t’attendent chez ${chez}. Un café, et c’est parti ☕`;
  const fin = 'Bonne journée ! 🚀';
  const mention = 'Ton point du jour, préparé chaque matin par Beluga Build.';

  const lignes: string[] = [salutation, '', intro, ''];
  const corps: string[] = [];

  for (const client of point.clients) {
    const resume =
      enumeration([
        client.aLire.length ? nombre(client.aLire.length, 'demande à regarder', 'demandes à regarder') : '',
        client.nonLus ? nombre(client.nonLus, 'message non lu', 'messages non lus') : '',
      ]) || 'Un mot dans la discussion';
    // Le NOM garde sa casse : un contrôle comme un œil humain y cherchent « Alice ».
    lignes.push(...titreTexte(`👤 ${client.nom}`), resume, '');
    corps.push(enteteDeClient(client.nom, resume));

    if (client.discussion?.messages.length) {
      const bloc = blocDeMessages(client.discussion.messages);
      lignes.push('💬 Discussion directe', ...bullesDuBlocTexte(bloc), `  → Répondre : ${lienDuFil(client.id)}`, '');
      corps.push(
        carteDeDiscussion({
          titre: `Discussion avec ${client.nom}`,
          cotePropre: 'admin',
          bloc,
          lien: lienDuFil(client.id),
          libelleBouton: 'Répondre',
        }),
      );
    }

    for (const demande of client.aLire) {
      lignes.push(...demandeEnTexte(demande, 'Ouvrir', lienDeLaDemande(client.id, demande)));
      corps.push(
        carteDeDemande(demande, {
          cotePropre: 'admin',
          bloc: bullesDeLaDemande(demande),
          lien: lienDeLaDemande(client.id, demande),
          pied: piedDeDemande(demande, false),
        }),
      );
    }
  }

  corps.push(
    `<div style="padding:18px 2px 0 2px;">${lienDiscret('Tout voir dans l’espace client →', lienDeLEspace())}</div>`,
  );
  lignes.push(`Tout voir dans l’espace client : ${lienDeLEspace()}`, '', fin);

  const html = documentDeCourriel({
    titre: 'Point du jour',
    apercu: intro,
    surtitre: 'Point du jour',
    illustration: 'haiko',
    lienEnTete: { libelle: 'Espace client', lien: lienDeLEspace() },
    salutation,
    intro,
    corps: corps.join(''),
    fin,
    mention,
  });

  const cible = raccourcir(chez, 22);
  const sujet = point.aLire
    ? `☕ ${nombre(point.aLire, 'demande')} ${accord(point.aLire, 't’attend', 't’attendent')} chez ${cible}`
    : point.nonLus
      ? `💬 ${nombre(point.nonLus, 'message')} ${accord(point.nonLus, 't’attend', 't’attendent')} chez ${cible}`
      : '☕ Ton point du jour';
  return { sujet, texte: lignes.join('\n'), html };
}
