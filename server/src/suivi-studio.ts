/**
 * UNE VIDÉO DEMANDÉE À N'IMPORTE QUEL AGENT SE FAIT DANS LE STUDIO, ET SE SUIT
 * DANS SA CONVERSATION (décision de l'utilisateur du 02/11/2026).
 *
 *  - L'agent (outil « services », service studio, action « video ») ouvre une
 *    création et son directeur artistique (`lancerAgentStudio`) : le Studio
 *    reste le seul lieu de montage, version gratuite d'abord.
 *  - La création retient son DEMANDEUR (`meta` « studio.demandeur.<création> »)
 *    et le message de SUIVI posé dans le fil du demandeur
 *    (« studio.suivi.<création> ») : un bloc tenu par le DÉMON, pas par le tour
 *    — il survit à la fin du tour et au redémarrage, et se réécrit à chaque
 *    étape (brief, esquisses, montage, téléchargement), puis porte la vidéo
 *    finie en pièce jointe.
 *  - LES BOUTONS À PRIX du directeur (lot de génération, voix finale,
 *    personnage 3D) ont leur MIROIR sur ce bloc (`relaiDe`) : un clic d'un côté
 *    tranche la question d'ORIGINE (une seule décision, verrou de
 *    `question.answer`) et ferme l'autre bouton.
 *  - LES IMAGES AUSSI (carte « Visuel vivant pendant la création de
 *    campagne », 10/11/2026) : l'action « image » ouvre la même création, le
 *    même directeur et le même bloc (`studio.genre.<création>` = « image ») ;
 *    le bloc porte la DERNIÈRE image livrée par le directeur en aperçu, puis
 *    l'export image fini.
 *  - LE BLOC EST UN LECTEUR (carte « Campagne, studio et mode du champ »,
 *    11/11/2026) : le message porte `suiviStudio`, que l'écran rend avec
 *    l'aperçu EN DIRECT de la composition (au clic, lecture seule), puis la
 *    vidéo exportée, l'étape, les formats prêts et « Ouvrir dans le Studio »
 *    SEUL sur sa dernière ligne (`web/src/components/bloc-du-studio.tsx`). Le
 *    texte reste écrit en repli (copie, ancien écran).
 */
import {
  AgentQuestion,
  Message,
  type SuiviStudioDuMessage,
  etapeCouranteDuMedia,
  etapesDuMedia,
  type Creation,
} from '@beluga/shared';
import * as store from './store.js';
import { bus } from './bus.js';
import { getDb, getMeta, setMeta } from './db.js';
import { log } from './logger.js';

const cleDemandeur = (creationId: string) => `studio.demandeur.${creationId}`;
const cleSuivi = (creationId: string) => `studio.suivi.${creationId}`;
const cleLivre = (creationId: string) => `studio.livre.${creationId}`;
const cleMiroir = (questionId: string) => `studio.miroir.${questionId}`;
const cleGenre = (creationId: string) => `studio.genre.${creationId}`;
const cleApercu = (creationId: string) => `studio.apercu.${creationId}`;

/** Ce que la création fabrique pour son demandeur : une vidéo (défaut, et toute création d'avant) ou une image. */
export type GenreDemandeAuStudio = 'video' | 'image';
const genreDe = (creationId: string): GenreDemandeAuStudio => (getMeta(cleGenre(creationId)) === 'image' ? 'image' : 'video');

const lienDuStudio = (creationId: string) => `#studio/${encodeURIComponent(creationId)}`;

const PHRASES_DES_ETAPES: Record<GenreDemandeAuStudio, Record<string, string>> = {
  video: {
    brief: 'Brief — le directeur artistique cadre la vidéo dans le Studio',
    esquisses: 'Esquisses — version gratuite d’abord ; chaque génération payante attend son bouton à prix',
    montage: 'Montage — la vidéo s’assemble dans le Studio',
    telechargement: 'Téléchargement — la vidéo est prête',
  },
  image: {
    brief: 'Brief — le directeur artistique cadre l’image dans le Studio',
    esquisses: 'Esquisses — version gratuite d’abord ; chaque génération payante attend son bouton à prix',
    montage: 'Finition — l’image se met au format dans le Studio',
    telechargement: 'Téléchargement — l’image est prête',
  },
};
const phraseDeLEtape = (genre: GenreDemandeAuStudio, etape: string) => PHRASES_DES_ETAPES[genre][etape] ?? etape;

/* ------------------------------------------------------------------ */
/* L'état lu                                                            */
/* ------------------------------------------------------------------ */

interface EtatDeLaVideo {
  genre: GenreDemandeAuStudio;
  etape: string;
  exportPret: { id: string; attachmentId: string } | null;
  /** Pour une image : la dernière livrée par le directeur, montrée en aperçu tant que l'export n'est pas prêt. */
  apercu: string | null;
  exportEnCours: boolean;
  echec: string | null;
  /** Les exports prêts du genre demandé, le plus récent en tête : le lecteur passe d'un format à l'autre. */
  prets: { exportId: string; attachmentId: string; format: string }[];
  /** La liste de tâches du directeur (son dernier message qui en porte), son tour en cours, son compte rendu. */
  taches: { label: string; state: 'todo' | 'running' | 'done' | 'unfinished' }[];
  directeurAuTravail: boolean;
  compteRendu: string | null;
}

/** Le compte rendu du directeur : son dernier message écrit, coupé court (le fil n'est pas le Studio). */
const PLAFOND_DU_COMPTE_RENDU = 600;

function travailDuDirecteur(creation: Creation, auTravail: boolean): Pick<EtatDeLaVideo, 'taches' | 'directeurAuTravail' | 'compteRendu'> {
  if (!creation.agentId) return { taches: [], directeurAuTravail: false, compteRendu: null };
  const recents = store.listMessages(creation.agentId, 30);
  const avecTaches = [...recents].reverse().find((m) => m.role === 'assistant' && m.todos?.length);
  const dernier = [...recents].reverse().find((m) => m.role === 'assistant' && m.content.trim() && !m.suiviStudio);
  const texte = dernier?.content.trim() ?? '';
  return {
    taches: (avecTaches?.todos ?? []).map((t) => ({ label: t.label, state: t.state })),
    directeurAuTravail: auTravail,
    compteRendu: !auTravail && texte ? (texte.length > PLAFOND_DU_COMPTE_RENDU ? `${texte.slice(0, PLAFOND_DU_COMPTE_RENDU).trimEnd()}…` : texte) : null,
  };
}

async function etatDeLaVideo(creation: Creation): Promise<EtatDeLaVideo> {
  const { listerExports } = await import('./studio.js');
  const carte = creation.cardId ? store.getCard(creation.cardId) : null;
  const etape = carte ? etapeCouranteDuMedia(etapesDuMedia({ carte })) : 'brief';
  const genre = genreDe(creation.id);
  const exports = listerExports(creation.id);
  const pret = exports.find((e) => e.etat === 'pret' && e.genre === genre && e.attachmentId) ?? null;
  const dernier = exports[0];
  const { agentsActifs } = await import('./runtime.js');
  const auTravail = !!creation.agentId && agentsActifs().includes(creation.agentId);
  return {
    ...travailDuDirecteur(creation, auTravail),
    genre,
    etape: pret ? 'telechargement' : etape,
    exportPret: pret ? { id: pret.id, attachmentId: pret.attachmentId! } : null,
    apercu: genre === 'image' && !pret && creation.cardId ? derniereImageLivree(creation.cardId) : null,
    exportEnCours: exports.some((e) => e.etat === 'en-file' || e.etat === 'en-cours'),
    echec: !pret && dernier?.etat === 'echoue' ? (dernier.erreur ?? 'export en échec') : null,
    prets: exports
      .filter((e) => e.etat === 'pret' && e.genre === genre && e.attachmentId)
      .map((e) => ({ exportId: e.id, attachmentId: e.attachmentId!, format: e.format })),
  };
}

/** La dernière image livrée sur la carte du directeur (une version gratuite, une génération validée). */
function derniereImageLivree(cardId: string): string | null {
  const l = getDb()
    .prepare("SELECT attachment_id FROM medias_livres WHERE card_id = ? AND genre = 'image' ORDER BY livre_le DESC LIMIT 1")
    .get(cardId) as { attachment_id: string } | undefined;
  return l?.attachment_id ?? null;
}

function texteDuBloc(creation: Creation, etat: EtatDeLaVideo): string {
  const image = etat.genre === 'image';
  const lignes = [
    image ? `🖼️ **Image « ${creation.titre} » — Studio**` : `🎬 **Vidéo « ${creation.titre} » — Studio**`,
    etat.exportPret
      ? image
        ? 'L’image est prête : elle est jointe ci-dessous.'
        : 'La vidéo est prête : elle est jointe ci-dessous.'
      : `Étape : ${phraseDeLEtape(etat.genre, etat.etape)}${etat.exportEnCours ? ' — export en cours' : ''}.${etat.apercu ? ' Dernière version jointe ci-dessous.' : ''}`,
    etat.echec ? `Le dernier export a échoué : ${etat.echec}.` : '',
    `[Ouvrir dans le Studio](${lienDuStudio(creation.id)})`,
  ];
  return lignes.filter(Boolean).join('\n\n');
}

/**
 * LE BLOC LU PAR L'ÉCRAN (`SuiviStudioDuMessage`) : un lecteur dans le fil — l'aperçu en direct de la composition,
 * puis le fichier exporté —, l'étape, les formats prêts, et « Ouvrir dans le Studio » SEUL sur sa ligne.
 */
function suiviDuBloc(creation: Creation, etat: EtatDeLaVideo): SuiviStudioDuMessage {
  return {
    creationId: creation.id,
    genre: etat.genre,
    titre: creation.titre,
    etape: etat.etape,
    phrase: phraseDeLEtape(etat.genre, etat.etape),
    version: creation.version,
    formats: creation.formats,
    exportEnCours: etat.exportEnCours,
    ...(etat.echec ? { echec: etat.echec } : {}),
    ...(etat.apercu ? { apercu: etat.apercu } : {}),
    exports: etat.prets,
    taches: etat.taches,
    directeurAuTravail: etat.directeurAuTravail,
    ...(etat.compteRendu ? { compteRendu: etat.compteRendu } : {}),
  };
}

/**
 * Ce que l'outil « services » rend pour « suivre ». AUCUN LIEN À RECOPIER : l'agent le reposait au milieu d'une
 * phrase, où il s'affichait en bouton perdu (capture #b1ff). Le bloc de suivi porte déjà son bouton, seul sur sa ligne.
 */
export async function etatDuSuivi(creation: Creation): Promise<string> {
  const etat = await etatDeLaVideo(creation);
  const lignes = [
    `« ${creation.titre} » (création ${creation.id}, version ${creation.version}) : ${phraseDeLEtape(etat.genre, etat.etape)}${etat.exportEnCours ? ' — export en cours' : ''}.`,
    etat.prets.length ? `Exports prêts : ${etat.prets.map((e) => `${e.format} (export ${e.exportId})`).join(', ')}.` : 'Aucun export prêt.',
    etat.echec ? `Le dernier export a échoué : ${etat.echec}. Tu peux le relancer toi-même (action « exporter »).` : '',
    'Le bloc de suivi de ta conversation montre déjà le lecteur et le bouton du Studio : ne recopie aucun lien dans ta réponse.',
  ];
  return lignes.filter(Boolean).join('\n');
}

async function contenuDuBloc(creation: Creation): Promise<{ content: string; suiviStudio: SuiviStudioDuMessage }> {
  const etat = await etatDeLaVideo(creation);
  return { content: texteDuBloc(creation, etat), suiviStudio: suiviDuBloc(creation, etat) };
}

/* ------------------------------------------------------------------ */
/* Le lancement                                                         */
/* ------------------------------------------------------------------ */

export async function lancerUneVideoPourUnAgent(entree: {
  creation: Creation;
  demandeurId: string;
  demande: string;
  /** « image » : un visuel fixe (défaut : une vidéo). */
  genre?: GenreDemandeAuStudio;
  /** Les pièces de référence (la dernière esquisse d'une campagne), données au directeur avec la demande. */
  references?: string[];
}): Promise<{ lien: string; agentId: string; cardId: string }> {
  const { creation, demandeurId } = entree;
  const genre = entree.genre ?? 'video';
  setMeta(cleDemandeur(creation.id), demandeurId);
  setMeta(cleGenre(creation.id), genre);
  const demandeur = store.getAgent(demandeurId);
  const origine = demandeur?.cardId ? store.getCard(demandeur.cardId)?.title : demandeur?.title;
  const { lancerAgentStudio } = await import('./assistant-studio.js');
  const depart = await lancerAgentStudio({
    creationId: creation.id,
    demande: `${genre === 'image' ? 'IMAGE FIXE demandée (pas de vidéo) : une seule image finie, au format de la création.\n\n' : ''}${entree.demande}${entree.references?.length ? `\n\nLa pièce jointe est l’ESQUISSE retenue pendant la conception : garde sa direction (composition, ambiance, couleurs), en mieux.` : ''}\n\n(${genre === 'image' ? 'Image' : 'Vidéo'} demandée par l’agent ${origine ? `de « ${origine} »` : 'd’un projet'} : son avancement et tes boutons à prix paraissent aussi dans sa conversation. Version gratuite d’abord.)`,
    ...(entree.references?.length ? { attachments: entree.references } : {}),
  });
  const { heriterLInterlocuteur } = await import('./interlocuteur.js');
  heriterLInterlocuteur(demandeurId, depart);
  const bloc = store.saveMessage(
    Message.parse({ id: store.newId(), agentId: demandeurId, role: 'assistant', ...(await contenuDuBloc(creation)), createdAt: Date.now() }),
  );
  setMeta(cleSuivi(creation.id), bloc.id);
  bus.emit({ type: 'message.upsert', message: bloc });
  return { lien: lienDuStudio(creation.id), ...depart };
}

/**
 * LE LECTEUR REPOSÉ À LA DEMANDE (action « montrer », 12/11/2026, capture #9def) : un bloc NEUF en bas du fil du
 * demandeur, et c'est lui que le démon tient désormais à jour — l'ancien reste tel quel, plus haut. Les miroirs de
 * questions déjà relayés restent sur l'ancien.
 */
export async function reposerLeBlocDuStudio(creation: Creation, demandeurId: string): Promise<Message> {
  if (!getMeta(cleDemandeur(creation.id))) setMeta(cleDemandeur(creation.id), demandeurId);
  const bloc = store.saveMessage(
    Message.parse({ id: store.newId(), agentId: demandeurId, role: 'assistant', ...(await contenuDuBloc(creation)), createdAt: Date.now() }),
  );
  setMeta(cleSuivi(creation.id), bloc.id);
  bus.emit({ type: 'message.upsert', message: bloc });
  return bloc;
}

/* ------------------------------------------------------------------ */
/* La mise à jour du bloc                                               */
/* ------------------------------------------------------------------ */

const enCours = new Set<string>();

async function rafraichir(creationId: string): Promise<void> {
  const messageId = getMeta(cleSuivi(creationId));
  if (!messageId || enCours.has(creationId)) return;
  enCours.add(creationId);
  try {
    const { lireCreation } = await import('./studio.js');
    const creation = lireCreation(creationId);
    const bloc = store.getMessage(messageId);
    if (!creation || !bloc) return;
    const etat = await etatDeLaVideo(creation);
    const texte = texteDuBloc(creation, etat);
    const suivi = suiviDuBloc(creation, etat);
    const suiviChange = JSON.stringify(suivi) !== JSON.stringify(bloc.suiviStudio ?? null);
    const livre = etat.exportPret && getMeta(cleLivre(creationId)) !== etat.exportPret.id ? etat.exportPret : null;
    /* L'APERÇU D'UNE IMAGE remplace le précédent : le bloc montre la dernière version, pas toutes. */
    const ancienApercu = getMeta(cleApercu(creationId));
    const apercuNeuf = etat.apercu && etat.apercu !== ancienApercu ? etat.apercu : null;
    if (texte === bloc.content && !suiviChange && !livre && !apercuNeuf) return;
    let attachments = bloc.attachments;
    if (apercuNeuf) attachments = [...attachments.filter((a) => a !== ancienApercu), apercuNeuf];
    if (livre) attachments = [...new Set([...attachments.filter((a) => a !== ancienApercu || etat.genre !== 'image'), livre.attachmentId])];
    const suivant = store.saveMessage({ ...bloc, content: texte, suiviStudio: suivi, attachments });
    if (apercuNeuf) setMeta(cleApercu(creationId), apercuNeuf);
    if (livre) setMeta(cleLivre(creationId), livre.id);
    bus.emit({ type: 'message.upsert', message: suivant });
  } catch (err) {
    log.warn('suivi studio : bloc non mis à jour', err);
  } finally {
    enCours.delete(creationId);
  }
}

/* ------------------------------------------------------------------ */
/* Les miroirs des boutons à prix                                       */
/* ------------------------------------------------------------------ */

/**
 * CE QUI PASSE EN MIROIR : un bouton à prix (lot de génération « Générer · prix », dépense du fil — voix finale, 3D),
 * et depuis le 11/11/2026 TOUTE QUESTION du directeur (une identité douteuse à trancher, un choix du brief) : la
 * création lancée par un agent n'a souvent personne devant le Studio, la question doit atteindre le fil du demandeur.
 * Jamais une compétence proposée ni un miroir de miroir.
 */
function estUnBoutonAPrix(q: AgentQuestion): boolean {
  return !q.relaiDe && !q.competence && !q.cancelled;
}

async function relayerLesPrix(message: Message): Promise<void> {
  const ouvertes = message.questions.filter((q) => estUnBoutonAPrix(q) && q.answer === undefined && !getMeta(cleMiroir(q.id)));
  const tranchees = message.questions.filter((q) => estUnBoutonAPrix(q) && q.answer !== undefined && getMeta(cleMiroir(q.id)));
  if (!ouvertes.length && !tranchees.length) return;
  const { creationDeLAgent } = await import('./studio.js');
  const creation = creationDeLAgent(message.agentId);
  if (!creation) return;
  for (const q of tranchees) fermerLesMiroirs(q.id, q.answer);
  const blocId = getMeta(cleSuivi(creation.id));
  const bloc = blocId ? store.getMessage(blocId) : null;
  if (!bloc || !ouvertes.length) return;
  const miroirs = ouvertes.map((q) => AgentQuestion.parse({ ...q, id: store.newId(), relaiDe: { messageId: message.id, questionId: q.id } }));
  for (let i = 0; i < ouvertes.length; i++) setMeta(cleMiroir(ouvertes[i]!.id), `${bloc.id}:${miroirs[i]!.id}`);
  const suivant = store.saveMessage({ ...bloc, questions: [...bloc.questions, ...miroirs] });
  bus.emit({ type: 'message.upsert', message: suivant });
  bus.emit({ type: 'attention', ...store.signalAttention() });
}

/** La question d'origine est tranchée (dans le Studio ou par son miroir) : le miroir se ferme, sans rien relancer. */
export function fermerLesMiroirs(questionIdOrigine: string, reponse?: string): void {
  const lien = getMeta(cleMiroir(questionIdOrigine));
  if (!lien) return;
  const [messageId, questionId] = lien.split(':');
  const message = messageId ? store.getMessage(messageId) : null;
  if (!message) return;
  const miroir = message.questions.find((q) => q.id === questionId);
  if (!miroir || miroir.answer !== undefined) return;
  let tranchee = reponse;
  if (tranchee === undefined) {
    for (const m of store.listMessages(store.getMessage(miroir.relaiDe?.messageId ?? '')?.agentId ?? '')) {
      const origine = m.questions.find((q) => q.id === questionIdOrigine);
      if (origine?.answer !== undefined) tranchee = origine.answer;
    }
  }
  if (tranchee === undefined) return;
  const suivant = store.saveMessage({
    ...message,
    questions: message.questions.map((q) => (q.id === questionId ? { ...q, answer: tranchee, answeredAt: Date.now() } : q)),
  });
  bus.emit({ type: 'message.upsert', message: suivant });
  bus.emit({ type: 'attention', ...store.signalAttention() });
}

/* ------------------------------------------------------------------ */
/* L'écoute                                                             */
/* ------------------------------------------------------------------ */

let arreter: (() => void) | null = null;

/** Branché au démarrage : le démon tient les blocs, aucun tour n'en a la charge. */
export function demarrerLeSuiviStudio(): void {
  if (arreter) return;
  arreter = bus.subscribe((event) => {
    if (event.type === 'studio' && event.creationId && !event.progression) {
      if (getMeta(cleSuivi(event.creationId))) void rafraichir(event.creationId);
      return;
    }
    if (event.type === 'card.upsert' && event.card.labels?.includes('studio')) {
      void import('./studio.js').then(({ creationDeLaCarte }) => {
        const c = creationDeLaCarte(event.card.id);
        if (c && getMeta(cleSuivi(c.id))) void rafraichir(c.id);
      });
      return;
    }
    if (event.type === 'message.upsert' && event.message.questions?.length) {
      void relayerLesPrix(event.message).catch((err) => log.warn('suivi studio : prix non relayés', err));
    }
    /* LA LISTE DE TÂCHES DU DIRECTEUR, RELAYÉE EN DIRECT dans le bloc du demandeur (12/11/2026) : seul le bloc se
       réécrit — le demandeur, lui, n'est pas réveillé. */
    if (event.type === 'message.upsert' && event.message.role === 'assistant' && event.message.todos?.length) {
      const creationId = creationDuDirecteur(event.message.agentId);
      if (creationId && getMeta(cleSuivi(creationId))) void rafraichir(creationId);
      return;
    }
    if (event.type === 'agent.upsert') suivreLeTourDuDirecteur(event.agent);
  });
}

/* ------------------------------------------------------------------ */
/* Le tour du directeur : son début, sa fin, son compte rendu           */
/* ------------------------------------------------------------------ */

/** Directeur → création (ou `null` : un agent qui n'est pas le directeur d'une création). Lu une fois par agent. */
const creationsDesDirecteurs = new Map<string, string | null>();
function creationDuDirecteur(agentId: string): string | null {
  if (!creationsDesDirecteurs.has(agentId)) {
    const ligne = getDb().prepare('SELECT id FROM studio_creations WHERE agent_id = ?').get(agentId) as { id: string } | undefined;
    creationsDesDirecteurs.set(agentId, ligne?.id ?? null);
  }
  return creationsDesDirecteurs.get(agentId) ?? null;
}

const toursEnCours = new Set<string>();

/**
 * LE DIRECTEUR COMMENCE OU FINIT SON TOUR : le bloc le dit (« au travail », puis l'aperçu final et le compte rendu),
 * et à la FIN SEULEMENT, son compte rendu repart à l'agent de campagne qui l'a demandé — un seul réveil par tour du
 * directeur, jamais à chaque ligne cochée.
 */
function suivreLeTourDuDirecteur(agent: { id: string; status: string }): void {
  const creationId = creationDuDirecteur(agent.id);
  if (!creationId || !getMeta(cleSuivi(creationId))) return;
  const travaille = agent.status === 'running' || agent.status === 'starting';
  if (travaille) {
    if (!toursEnCours.has(agent.id)) {
      toursEnCours.add(agent.id);
      void rafraichir(creationId);
    }
    return;
  }
  if (!toursEnCours.delete(agent.id)) return;
  void rafraichir(creationId).then(() => rendreLeCompteRendu(creationId, agent.id));
}

async function rendreLeCompteRendu(creationId: string, directeurId: string): Promise<void> {
  if (process.env.BELUGA_AGENT_DE_CAMPAGNE_SANS_MOTEUR === '1') return;
  const demandeurId = getMeta(cleDemandeur(creationId));
  if (!demandeurId) return;
  const { roleDuChef } = await import('./directeur-marketing.js');
  if (roleDuChef(demandeurId)?.niveau !== 'campagne') return;
  const { lireCreation } = await import('./studio.js');
  const creation = lireCreation(creationId);
  if (!creation) return;
  const { compteRendu } = travailDuDirecteur(creation, false);
  if (!compteRendu) return;
  const { sendPrompt } = await import('./runtime.js');
  const demande = [
    `COMPTE RENDU DU DIRECTEUR DU STUDIO — « ${creation.titre} » (création ${creation.id}, version ${creation.version}) :`,
    compteRendu,
    'Le bloc de suivi de ta conversation montre déjà l’aperçu à jour et ce compte rendu. Dis à la personne, en deux phrases au plus, ce qui a changé et ce qui reste à décider ; une suite qui crée, dépense, remplace, publie ou lance une série passe par « ask_user ». Ne recopie aucun lien, ne dis pas « ci-dessus ».',
  ].join('\n\n');
  void sendPrompt(demandeurId, demande, { template: 'none', silent: true }).catch((err) => log.warn(`suivi studio : compte rendu du directeur ${directeurId} non transmis`, err));
}
