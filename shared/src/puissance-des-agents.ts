/**
 * LA PUISSANCE DES AGENTS DES SERVICES (décision de l'utilisateur, 26/11/2026, carte « Agents des services et Beluga
 * Connect ») : « le plus puissant quand vous discutez avec lui, l'intermédiaire pour ses passages seuls — jamais de
 * Fable ».
 *
 * Un agent des services (agent personnalisé, Marketing, Charte, Communication, surveillance, sauvegardes, sécurité,
 * configuration d'une publication) tournait au palier « standard » quoi qu'on lui demande : il remplissait un
 * formulaire au lieu de raisonner. Désormais :
 *   - un MESSAGE DE L'UTILISATEUR part au palier « approfondi » (le modèle le plus ample du moteur, réflexion haute) ;
 *     ce réglage s'ENREGISTRE sur l'agent, pour que l'écran dise ce qui tourne ;
 *   - un PASSAGE SEUL (demande silencieuse du démon : heure fixe, événement, veille, « Lancer maintenant », tour
 *     confié par un chef) part au palier « standard », pour CE tour seulement — l'agent garde son réglage.
 *
 * UN CHOIX FAIT À LA MAIN N'EST JAMAIS RÉÉCRIT (DEC-213) : seul un réglage posé par le système est concerné — palier
 * « approfondi » retenu sur l'agent (`run.niveau`), aucun modèle, ou l'ancien réglage d'office (le modèle du palier
 * standard avec sa réflexion). Le menu des modèles retire `run.niveau` : un modèle choisi là reste le sien.
 *
 * Les paliers ne valent que pour Claude, le seul moteur dont les agents des services naissent. Fable n'en sort
 * jamais : le catalogue d'un palier l'écarte déjà (`sansModelesBannis`), et ce garde le redit.
 *
 * Règle pure : ni base, ni disque, ni moteur.
 */
import { modeleBanni } from './modele-banni.js';

export interface ReglageDeModele {
  model?: string;
  thinking: string;
}

export interface ReglageDeLAgent {
  engine: string;
  model?: string;
  thinking?: string;
  niveau?: string;
}

export interface PuissanceDuTour {
  /** Le réglage à ENREGISTRER sur l'agent avant ce tour (message de l'utilisateur). */
  enregistrer?: ReglageDeModele & { niveau: 'approfondi' };
  /** Le réglage de CE tour seulement (passage seul). */
  duTour?: ReglageDeModele;
}

/** Le moteur dont les agents des services naissent, et le seul que ces paliers visent. */
export const MOTEUR_DES_AGENTS_DES_SERVICES = 'claude';

/** Le réglage de l'agent a-t-il été posé par le système (et donc peut-il suivre les paliers) ? */
export function reglagePoseParLeSysteme(run: ReglageDeLAgent, passages: ReglageDeModele): boolean {
  if (run.niveau === 'approfondi') return true;
  if (run.niveau) return false;
  if (!run.model) return true;
  // L'ANCIEN RÉGLAGE D'OFFICE : le modèle du palier standard, avec sa réflexion (ou « medium », celle d'avant).
  const reflexion = run.thinking ?? 'none';
  return run.model === passages.model && (reflexion === passages.thinking || reflexion === 'medium');
}

/**
 * Le réglage du tour d'un agent des services. `humain` : le tour porte un message de l'utilisateur. `conversation` et
 * `passages` : les paliers « approfondi » et « standard » traduits pour le moteur de l'agent.
 */
export function puissanceDuTour(entree: {
  run: ReglageDeLAgent;
  humain: boolean;
  conversation: ReglageDeModele;
  passages: ReglageDeModele;
}): PuissanceDuTour {
  const { run, humain, conversation, passages } = entree;
  if (run.engine !== MOTEUR_DES_AGENTS_DES_SERVICES) return {};
  if (!reglagePoseParLeSysteme(run, passages)) return {};
  if (humain) {
    if (!conversation.model || modeleBanni(conversation.model)) return {};
    const deja = run.model === conversation.model && (run.thinking ?? 'none') === conversation.thinking && run.niveau === 'approfondi';
    return deja ? {} : { enregistrer: { model: conversation.model, thinking: conversation.thinking, niveau: 'approfondi' } };
  }
  if (!passages.model || modeleBanni(passages.model)) return {};
  const deja = run.model === passages.model && (run.thinking ?? 'none') === passages.thinking;
  return deja ? {} : { duTour: { model: passages.model, thinking: passages.thinking } };
}

/* ------------------------------------------------------------------ */
/* LE NOM DE LA TÂCHE D'UN AGENT DES SERVICES                          */
/* ------------------------------------------------------------------ */

/**
 * LE NOM D'UNE TÂCHE DIT L'ACTION (décision du 26/11/2026) : la colonne « En cours » et le fil d'Ariane montraient
 * « Nouvel agent » ou « Marketing — Haiko Studio » pour tout ce que faisait un agent. L'agent nomme désormais sa tâche
 * dès sa première réponse (outil `nommer_la_tache`), et la renomme quand son travail change de sujet.
 *
 * Rend le titre retenu, ou la raison du refus : vide, trop court, trop long (80 signes, la limite des cartes), ou
 * resté générique.
 */
export const TITRES_GENERIQUES = ['nouvel agent', 'agent', 'tâche', 'tache', 'nouvelle tâche', 'nouvelle tache', 'marketing', 'studio', 'charte'];

export function titreDeTacheLu(valeur: unknown): { ok: true; titre: string } | { ok: false; raison: string } {
  const titre = typeof valeur === 'string' ? valeur.replace(/\s+/g, ' ').trim().replace(/^[«"“]\s*|\s*[»"”]$/g, '').trim() : '';
  if (!titre) return { ok: false, raison: 'Le titre est vide : trois à six mots qui disent ce que tu fais.' };
  if (titre.length < 4) return { ok: false, raison: 'Le titre est trop court : trois à six mots qui disent ce que tu fais.' };
  if (titre.length > 80) return { ok: false, raison: `Le titre fait ${titre.length} signes : 80 au plus, trois à six mots.` };
  if (TITRES_GENERIQUES.includes(titre.toLowerCase())) return { ok: false, raison: `« ${titre} » ne dit pas ce que tu fais : nomme ton action.` };
  return { ok: true, titre };
}
