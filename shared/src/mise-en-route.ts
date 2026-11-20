/**
 * LA MISE EN ROUTE EN DISCUSSION (carte « Assistant d'installation et Jarvis », 20/11/2026) — les règles pures.
 *
 * L'assistant de premier démarrage n'est plus une suite de pages : c'est une DISCUSSION plein écran avec l'agent
 * « Beluga ». La première question (le moteur) est écrite d'avance, sans modèle : rien ne peut parler avant qu'un
 * moteur soit relié. Dès qu'un moteur répond, il ÉCRIT LES PAROLES de Beluga pour toutes les questions suivantes, en
 * UN appel court (coût minimal), dans la langue de l'écran. Les QUESTIONS elles-mêmes (leurs champs, leurs boutons)
 * et l'état des étapes restent tenus par l'écran et le démon (`EtatDeLAssistant`, `apresEtape`) : le modèle ne fait
 * que dire les choses, il ne peut ni sauter une étape indispensable, ni inventer un réglage, ni lire un secret.
 */

import { etapesDeLAssistant, type EtapeDeLAssistant, type EtatDeLAssistant } from './installation.js';

/**
 * L'ORDRE DE LA DISCUSSION. Il diffère de celui des anciennes pages : on relie d'abord un moteur (sans lui, Beluga
 * ne parle pas), puis Beluga se présente, demande comment appeler la personne et comment s'appeler lui-même, puis
 * le reste. « copie » n'existe pas sur l'offre hébergée (`etapesDeLAssistant`).
 */
export const ORDRE_DE_LA_DISCUSSION: readonly EtapeDeLAssistant[] = [
  'moteurs',
  'bienvenue',
  'assistant',
  'ordinateur',
  'domaine',
  'projet',
  'copie',
  'courriels',
  'espace-client',
  'competences',
  'facultatif',
];

/** Les étapes de la discussion sur cette machine, dans l'ordre où elles se posent. */
export function etapesDeLaDiscussion(hebergee = false): EtapeDeLAssistant[] {
  const presentes = new Set(etapesDeLAssistant(hebergee));
  return ORDRE_DE_LA_DISCUSSION.filter((etape) => presentes.has(etape));
}

/** La question posée en ce moment : la première pas encore vue, dans l'ordre de la discussion. */
export function questionEnCours(etat: EtatDeLAssistant | undefined | null, hebergee = false): EtapeDeLAssistant | 'fin' {
  const vues = etat?.etapes ?? {};
  return etapesDeLaDiscussion(hebergee).find((etape) => !vues[etape]) ?? 'fin';
}

/** Les paroles de Beluga, une par étape. Absente : l'écran dit le texte écrit d'avance. */
export type ParolesDeLaMiseEnRoute = Partial<Record<EtapeDeLAssistant, string>>;

/** Au-delà, une parole n'est plus une bulle : coupée au mot. */
export const PAROLE_MAX = 420;

/** Ce que chaque étape demande, pour que le modèle sache de quoi parler (jamais montré tel quel). */
const SUJETS: Record<EtapeDeLAssistant, string> = {
  moteurs: '',
  bienvenue:
    "se présenter (tu es Beluga, l'agent de Beluga Build) et dire en deux ou trois phrases ce qu'est Beluga Build : un tableau de tâches que des agents IA réalisent sur ce serveur ; il apprend de chaque projet (mémoire, compétences) ; son code est sur ce serveur et se modifie comme un projet. Finir en proposant de faire les réglages ensemble.",
  assistant:
    "demander le prénom de la personne et le nom qu'elle veut te donner (Beluga par défaut) ; ce nom est aussi le mot qui t'appellera à voix haute.",
  ordinateur:
    "proposer d'équiper l'ordinateur où les agents travailleront (son navigateur, et sur un Mac la petite application Beluga Connect qui fait tout le reste) ; facultatif, on peut le faire plus tard.",
  domaine:
    "demander l'adresse (nom de domaine) à laquelle on ouvrira Beluga Build et sous laquelle les projets recevront la leur ; on peut garder l'adresse provisoire et le faire plus tard.",
  projet:
    "dire qu'il faut relier GitHub (indispensable : c'est par lui que les projets se récupèrent et se sauvegardent), puis qu'on peut ajouter un premier projet.",
  copie:
    "proposer de faire de cette installation sa propre copie : un dépôt privé à son nom, pour sauvegarder ses changements et récupérer les nouveautés ; facultatif.",
  courriels:
    "proposer de régler l'envoi des courriels (écrire aux clients, point du matin) ; rien ne part sans ce réglage ; facultatif.",
  'espace-client':
    "proposer d'ouvrir un espace où les clients déposent leurs demandes et suivent leur avancement ; facultatif.",
  competences:
    "expliquer qu'une compétence est un mode d'emploi que les agents suivent, que l'installation part sans aucune, et proposer d'en choisir dans des bibliothèques publiques ; facultatif.",
  facultatif:
    "présenter les fonctions en plus (aucune n'est nécessaire), dire que c'est la dernière étape et que tout se retrouve ensuite dans les réglages.",
};

const NOMS_DE_LANGUE: Record<string, string> = {
  fr: 'français',
  en: 'anglais',
  es: 'espagnol',
  de: 'allemand',
  zh: 'chinois simplifié',
};

/**
 * LA DEMANDE AU MOTEUR : toutes les paroles en un appel. Courte (coût), et sans rien de propre à l'installation :
 * aucun secret, aucune adresse, aucun prénom (le modèle écrit `{prenom}` là où il veut l'employer, après l'étape
 * « assistant » seulement, et l'écran le remplace).
 */
export function demandeDesParoles(options: { langue?: string; nom?: string; hebergee?: boolean }): string {
  const nom = (options.nom || 'Beluga').trim();
  const langue = NOMS_DE_LANGUE[options.langue ?? 'fr'] ?? 'français';
  const etapes = etapesDeLaDiscussion(options.hebergee).filter((e) => e !== 'moteurs');
  const lignes = etapes.map((etape) => `- "${etape}" : ${SUJETS[etape]}`);
  return [
    `Tu es ${nom}, l'agent qui accueille une personne qui vient d'installer Beluga Build sur son serveur. Tu mènes sa mise en route comme une discussion : une bulle par étape, sous laquelle l'écran pose lui-même les champs et les boutons.`,
    `Écris en ${langue}, en vouvoyant, sur un ton chaleureux, simple et un peu joueur, sans jargon technique. Chaque bulle : une à trois phrases courtes (moins de 300 caractères), qui disent ce qu'on règle et pourquoi. Ne décris pas les boutons, ne pose qu'une question par bulle, n'invente aucun réglage.`,
    `Tu peux écrire {prenom} pour nommer la personne, seulement à partir de l'étape qui suit "assistant".`,
    `Les étapes, dans l'ordre :`,
    ...lignes,
    `Réponds UNIQUEMENT par un objet JSON dont chaque clé est une étape ci-dessus et chaque valeur le texte de la bulle. Rien avant, rien après.`,
  ].join('\n');
}

function couperAuMot(texte: string, max: number): string {
  if (texte.length <= max) return texte;
  const coupe = texte.slice(0, max);
  const espace = coupe.lastIndexOf(' ');
  return `${(espace > max * 0.6 ? coupe.slice(0, espace) : coupe).replace(/[\s,;:]+$/, '')}…`;
}

/** Une parole lisible : texte brut, sans balises ni mise en forme, bornée. */
function paroleNette(valeur: unknown): string {
  if (typeof valeur !== 'string') return '';
  const net = valeur
    .replace(/<[^>]*>/g, '')
    .replace(/[*_`#>]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return couperAuMot(net, PAROLE_MAX);
}

/**
 * LIT LA SORTIE DU MOTEUR, avec tolérance : l'objet est cherché entre la première « { » et la dernière « } »
 * (un modèle ajoute volontiers une phrase ou des balises de code). Seules les étapes connues sont gardées.
 * Illisible : un objet vide, et l'écran garde ses textes écrits d'avance.
 */
export function lireLesParoles(texte: string): ParolesDeLaMiseEnRoute {
  const debut = texte.indexOf('{');
  const fin = texte.lastIndexOf('}');
  if (debut < 0 || fin <= debut) return {};
  let brut: unknown;
  try {
    brut = JSON.parse(texte.slice(debut, fin + 1));
  } catch {
    return {};
  }
  if (!brut || typeof brut !== 'object' || Array.isArray(brut)) return {};
  const paroles: ParolesDeLaMiseEnRoute = {};
  for (const etape of ORDRE_DE_LA_DISCUSSION) {
    if (etape === 'moteurs') continue;
    const parole = paroleNette((brut as Record<string, unknown>)[etape]);
    if (parole) paroles[etape] = parole;
  }
  return paroles;
}

/**
 * Le prénom posé dans une parole. Avant de le connaître, `{prenom}` (et la virgule ou l'espace qui l'entoure)
 * disparaît proprement : « Parfait, {prenom} ! » devient « Parfait ! ».
 */
export function paroleAvecPrenom(parole: string, prenom: string | null | undefined): string {
  const net = (prenom ?? '').trim();
  if (net) return parole.replace(/\{prenom\}/g, net);
  const sans = parole
    .replace(/(^|[.!?]\s+)\{prenom\}[,\s]*(\p{L})/gu, (_t, avant: string, lettre: string) => `${avant}${lettre.toUpperCase()}`)
    .replace(/[,\s]*\{prenom\}(?=\s*[!?.,;:])/g, '')
    .replace(/\{prenom\}[,\s]*/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return sans;
}
