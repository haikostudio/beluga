/**
 * LE QUESTIONNAIRE DE RÉALISATION (caméra), CÔTÉ DÉMON — le jumeau du cahier
 * des charges (`server/src/cahier-des-charges.ts`).
 *
 * Les règles et les textes vivent dans `shared/src/mode-realisation.ts` ; ce
 * module fait les gestes : allumer et éteindre la caméra, enregistrer la
 * écrire le document et l'avancement (types de média compris) (outil `cahier_de_realisation`), mettre en pause, reprendre,
 * lire et exporter le document.
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  ajouterALAmbiance,
  documentDeRealisation,
  demandeDeRepriseDeRealisation,
  ENVELOPPE_CONSEILLEE,
  htmlDuCahier,
  lacunesDuCahierDeRealisation,
  lireAvancementDeRealisation,
  nomDeLaRealisationExportee,
  pauseDeRealisationPossible,
  realisationDeLaCarte,
  realisationNeuve,
  repriseDeRealisationPossible,
  type Card,
  typesDeMediaDeLaRealisation,
} from '@beluga/shared';
import * as store from './store.js';
import { bus } from './bus.js';
import { log } from './logger.js';
import { safeJoin } from './files.js';

/* Le moteur et le cadrage se chargent à la demande : les outils importent ce module. */
const moteur = () => import('./runtime.js');
const cadrageDuDemon = () => import('./cadrage.js');

/** La carte de cet agent, si c'est le cadrage d'une carte caméra allumée. */
function carteDeRealisationDeLAgent(agentId: string): Card | null {
  const agent = store.getAgent(agentId);
  if (!agent || agent.role !== 'cadrage' || !agent.cardId) return null;
  const carte = store.getCard(agent.cardId);
  return carte?.parcours?.realisationSouhaitee ? carte : null;
}

/** L'outil `cahier_de_realisation` n'est servi qu'à ce cadrage-là. */
export function estAgentDuQuestionnaireDeRealisation(agentId: string): boolean {
  return !!carteDeRealisationDeLAgent(agentId);
}

/**
 * L'INTERRUPTEUR. L'allumer pose l'état (neuf s'il n'existait pas) et ne lance RIEN : le
 * premier message de l'utilisateur démarre le cadrage, qui pose lui-même la question des types de média. Le
 * plan n'est plus forcé : le document de réalisation le remplace. L'éteindre
 * rend la conversation ordinaire SANS effacer l'état — rallumée, la carte
 * reprend où elle en était.
 */
export function basculerLaRealisation(cardId: string, actif: boolean): Card {
  const card = store.getCard(cardId);
  if (!card) throw new Error('carte introuvable');
  const avant = card.parcours ?? { plans: [] };
  const ecrite = store.saveCard(
    actif
      ? { ...card, parcours: { ...avant, realisationSouhaitee: true }, realisation: card.realisation ?? realisationNeuve() }
      : { ...card, parcours: { ...avant, realisationSouhaitee: false } },
  );
  bus.emit({ type: 'card.upsert', card: ecrite });
  return ecrite;
}

/**
 * LE PREMIER MESSAGE PARTI EN MODE RÉALISATION. Appelé quand un tour de
 * cadrage emporte la consigne du mode : la date posée ouvre le volet
 * (`estVoletDeRealisation`). Une seule fois par carte ; l'écran se met à jour
 * par `card.upsert`.
 */
export function noterLaDemandeDeRealisation(cardId: string, at = Date.now()): Card | null {
  const card = store.getCard(cardId);
  if (!card?.parcours?.realisationSouhaitee || card.realisation?.demandeA) return null;
  const ecrite = store.saveCard({ ...card, realisation: { ...realisationDeLaCarte(card), demandeA: at } });
  bus.emit({ type: 'card.upsert', card: ecrite });
  return ecrite;
}

/** Le document de la carte, lu sur le disque du projet — absent : `null`. */
export function lireLeDocumentDeRealisation(carte: Card): { chemin: string; texte: string } | null {
  const projet = store.getProject(carte.projectId);
  const chemin = documentDeRealisation(carte.id);
  const cible = projet ? safeJoin(projet.path, chemin) : null;
  if (!cible || !fs.existsSync(cible)) return null;
  return { chemin, texte: fs.readFileSync(cible, 'utf8') };
}

/** Le chemin ABSOLU du document, pour les consignes. */
export function cheminAbsoluDuDocument(carte: Card): string {
  const projet = store.getProject(carte.projectId);
  const relatif = documentDeRealisation(carte.id);
  return projet ? path.join(projet.path, relatif) : relatif;
}

/**
 * L'OUTIL : le document ENTIER et l'avancement, après chaque réponse. Le fichier
 * s'écrit dans le dossier du projet (le cadrage n'a pas de branche) ; la carte
 * porte l'avancement, et l'écran se met à jour par `card.upsert`.
 */
export function ecrireLaRealisation(agentId: string, args: Record<string, unknown>): { ok: boolean; text: string } {
  const carte = carteDeRealisationDeLAgent(agentId);
  if (!carte) return { ok: false, text: 'Cet outil n’appartient qu’au cadrage d’une carte dont le mode réalisation est allumé.' };
  const avant = realisationDeLaCarte(carte);
  const lu = lireAvancementDeRealisation(args, avant, Date.now());
  if (!lu.ok) return { ok: false, text: lu.raison };
  if (!typesDeMediaDeLaRealisation(lu.realisation).length) {
    return {
      ok: false,
      text: '« Quels types de média voulez-vous ? » n’a pas encore de réponse : pose-la avec « ask_user » en choix multiple (image, video, musique, voix, bruitages), puis rappelle l’outil avec « medias » = la liste choisie. N’écris rien avant.',
    };
  }
  const document = typeof args.document === 'string' ? args.document : '';
  if (!document.trim()) return { ok: false, text: 'Le document ENTIER est obligatoire : il remplace le fichier.' };
  /* LE CAHIER NE SE DIT PAS TERMINÉ SUR LA FOI DE L'AGENT : le document est
     enregistré, mais « termine » est refusé tant qu'il y manque quelque chose. */
  const lacunes = lu.realisation.termineA ? lacunesDuCahierDeRealisation(document) : [];
  if (lacunes.length) lu.realisation = { ...lu.realisation, termineA: undefined, restants: lacunes.map((l) => l.slice(0, 200)) };

  const projet = store.getProject(carte.projectId);
  const chemin = documentDeRealisation(carte.id);
  const cible = projet ? safeJoin(projet.path, chemin) : null;
  if (!cible) return { ok: false, text: 'Dossier du projet introuvable.' };
  fs.mkdirSync(path.dirname(cible), { recursive: true });
  fs.writeFileSync(cible, document.endsWith('\n') ? document : `${document}\n`, 'utf8');

  /* LES APERÇUS À GARDER rejoignent le tableau d'ambiance, rangés sous la rubrique en cours. */
  const aGarder = Array.isArray(args.ambiance)
    ? args.ambiance
        .map((p: any) => ({ piece: String(p?.piece ?? p ?? '').trim().replace(/^#/, ''), legende: typeof p?.legende === 'string' ? p.legende.trim().slice(0, 80) : undefined }))
        .filter((p) => p.piece && store.getAttachment(p.piece)?.mime.startsWith('image/'))
        .map((p) => ({ piece: p.piece, phase: lu.realisation.phase, ...(p.legende ? { legende: p.legende } : {}) }))
    : [];
  if (aGarder.length) lu.realisation = ajouterALAmbiance(lu.realisation, aGarder, Date.now());

  const fraiche = store.getCard(carte.id) ?? carte;
  const ecrite = store.saveCard({ ...fraiche, realisation: lu.realisation });
  bus.emit({ type: 'card.upsert', card: ecrite });
  const r = lu.realisation;
  if (lacunes.length) {
    return {
      ok: false,
      text: `Document enregistré dans ${chemin}, mais le cahier n’est PAS terminé : ${lacunes.join(' ; ')}. Complète-le (une rubrique sans objet s’écrit « Sans objet : <raison> »), puis rappelle « cahier_de_realisation » avec « termine » = vrai.`,
    };
  }
  if (!r.termineA) {
    /* L'ENVELOPPE D'APERÇUS se demande juste après les types de média : l'outil le rappelle tant qu'elle manque. */
    const enveloppe =
      r.enveloppe === undefined
        ? ` L’enveloppe d’aperçus n’est pas encore demandée : ta question SUIVANTE est celle-là (« ask_user », ${ENVELOPPE_CONSEILLEE} $ recommandé), puis passe « enveloppe » à cet outil.`
        : '';
    return {
      ok: true,
      text: `Enregistré : ${r.faites} question(s) tranchée(s)${r.total ? ` sur ${r.total}` : ''}, document ${chemin} à jour.${enveloppe || ' Pose la question suivante.'}`,
    };
  }
  return {
    ok: true,
    text: `Cahier de réalisation complet, enregistré dans ${chemin}. L’utilisateur lance la fabrication depuis le bouton de la carte (« Lancer la fabrication »). Ne rends pas de plan : termine ton tour par une phrase qui dit que le cahier de réalisation est complet.`,
  };
}

/**
 * UN CHOIX EN IMAGES TRANCHÉ : les vignettes des options retenues rejoignent
 * le tableau d'ambiance de la carte, sous la rubrique en cours, avec leur
 * libellé pour légende. La réponse est le texte rendu par l'écran : une option
 * est retenue quand son libellé y figure. Rien hors d'un cadrage caméra.
 */
export function retenirLesImagesChoisies(
  agentId: string,
  question: { options: { label: string; image?: string }[] },
  reponse: string,
): Card | null {
  const carte = carteDeRealisationDeLAgent(agentId);
  if (!carte) return null;
  const r = realisationDeLaCarte(carte);
  const retenues = question.options
    .filter((o) => o.image && o.label && reponse.includes(o.label))
    .map((o) => ({ piece: o.image!, phase: r.phase, legende: o.label.slice(0, 80) }));
  if (!retenues.length) return null;
  const ecrite = store.saveCard({ ...carte, realisation: ajouterALAmbiance(r, retenues, Date.now()) });
  bus.emit({ type: 'card.upsert', card: ecrite });
  return ecrite;
}

/**
 * METTRE EN PAUSE : la file se vide AVANT la coupe (règle de l'arrêt), puis
 * l'agent s'arrête s'il tournait. La colonne ne bouge pas.
 */
export async function mettreLaRealisationEnPause(cardId: string): Promise<Card> {
  const carte = store.getCard(cardId);
  if (!carte) throw new Error('Carte introuvable.');
  const verdict = pauseDeRealisationPossible(carte.realisation);
  if (!verdict.possible) throw new Error(verdict.raison);
  const pausee = store.saveCard({ ...carte, realisation: { ...carte.realisation!, enPauseA: Date.now() } });
  bus.emit({ type: 'card.upsert', card: pausee });
  const { cadrageDeLaCarte } = await cadrageDuDemon();
  const agent = cadrageDeLaCarte(cardId);
  if (agent) {
    const { arreterLAgent, isRunning } = await moteur();
    const vides = store.clearQueue(agent.id);
    if (vides) bus.emit({ type: 'queue.etat', agentId: agent.id, queue: [] });
    if (isRunning(agent.id) || agent.status === 'running') arreterLAgent(agent.id);
  }
  return pausee;
}

/** REPRENDRE : la marque tombe, et l'agent repart avec le document et l'avancement. */
export async function reprendreLaRealisation(cardId: string): Promise<Card> {
  const carte = store.getCard(cardId);
  if (!carte) throw new Error('Carte introuvable.');
  const verdict = repriseDeRealisationPossible(carte.realisation);
  if (!verdict.possible) throw new Error(verdict.raison);
  const realisation = { ...carte.realisation!, enPauseA: undefined };
  const reprise = store.saveCard({ ...carte, realisation });
  bus.emit({ type: 'card.upsert', card: reprise });
  const { cadrageDeLaCarte, ouvrirLeCadrage } = await cadrageDuDemon();
  const agent = cadrageDeLaCarte(cardId) ?? (await ouvrirLeCadrage(cardId));
  if (!agent) throw new Error('Aucun agent de cadrage pour reprendre ce questionnaire.');
  if (process.env.NODE_TEST_CONTEXT) return reprise;
  const { sendPrompt } = await moteur();
  void sendPrompt(
    agent.id,
    demandeDeRepriseDeRealisation(realisation, lireLeDocumentDeRealisation(reprise)?.texte, cheminAbsoluDuDocument(reprise)),
    { template: 'none', silent: true },
  ).catch((err) => log.error(`la reprise du questionnaire de réalisation « ${carte.title} » n'a pas pu partir`, err));
  return reprise;
}

/** UN MESSAGE DE L'UTILISATEUR VAUT REPRISE, comme pour le cahier des charges. */
export function leverLaPauseDeRealisationSurMessage(cardId: string | undefined): void {
  if (!cardId) return;
  const carte = store.getCard(cardId);
  if (!carte?.realisation?.enPauseA) return;
  const reprise = store.saveCard({ ...carte, realisation: { ...carte.realisation, enPauseA: undefined } });
  bus.emit({ type: 'card.upsert', card: reprise });
}

/**
 * L'EXPORT : le document tel quel (`md`), ou mis en page en PDF par le Chrome du
 * système — même mise en page que le cahier des charges. Sans document : `null`.
 */
export async function exporterLaRealisation(
  cardId: string,
  format: 'pdf' | 'md',
): Promise<{ nom: string; type: string; contenu: Buffer } | null> {
  const carte = store.getCard(cardId);
  const lu = carte ? lireLeDocumentDeRealisation(carte) : null;
  if (!carte || !lu) return null;
  const nom = nomDeLaRealisationExportee(carte.title, format);
  if (format === 'md') return { nom, type: 'text/markdown; charset=utf-8', contenu: Buffer.from(lu.texte, 'utf8') };
  const { chromium } = await import('playwright');
  const navigateur = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await navigateur.newPage();
    await page.setContent(htmlDuCahier(lu.texte, nom.replace(/\.pdf$/, '')), { waitUntil: 'load' });
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '18mm', bottom: '18mm', left: '16mm', right: '16mm' },
    });
    return { nom, type: 'application/pdf', contenu: Buffer.from(pdf) };
  } finally {
    await navigateur.close().catch(() => {});
  }
}
