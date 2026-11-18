/**
 * L'OUTIL « services » : TOUS LES SERVICES DE BELUGA, POUR TOUT AGENT
 * (décision de l'utilisateur du 02/11/2026), avec les droits de la personne
 * qui lui parle (`interlocuteur.ts`, règle pure `shared/src/services-de-l-agent.ts`).
 *
 * UN SEUL OUTIL, un champ « service » et un champ « action » : chaque outil
 * ajouté à tous les agents se repaie à chaque tour. Les implémentations ne sont
 * pas réécrites : messagerie, surveillances et backups reprennent celles
 * de l'assistant général (`assistant-global.ts`).
 *
 * CE QUI PART DEHORS NE PART JAMAIS DE L'AGENT : une réponse au client et une
 * publication programmée sont des PROPOSITIONS posées dans sa conversation
 * (`gesteAValider`) ; seul le clic de l'utilisateur les fait partir, avec SES
 * droits (`trancherLeGesteAValider`, appelé par `question.answer`).
 *
 * UNE VIDÉO DEMANDÉE S'OUVRE DANS LE STUDIO : création + directeur artistique,
 * suivie dans la conversation du demandeur (`suivi-studio.ts`).
 */
import {
  AgentQuestion,
  accesDeLAgent,
  accesSuffit,
  estFormatStudio,
  refusDuService,
  trouverLeProjetVise,
  SERVICES_DE_L_AGENT,
  type AccesDeLAgent,
  type CompteUtilisateur,
  type ServiceDeLAgent,
} from '@beluga/shared';
import * as store from './store.js';
import { log } from './logger.js';
import { accesDeCetAgent } from './interlocuteur.js';
import { accordRecent, refusSansAccord } from '@beluga/shared';
import type { ToolContext, ToolDef, ToolResult } from './tools.js';

export const OUTIL_SERVICES: ToolDef = {
  name: 'services',
  description:
    "LES SERVICES DE BELUGA, avec les droits de la personne qui te parle. « service » + « action » ; « projet » (nom) facultatif, le tien par défaut. messagerie : lister | lire (id d'une demande) | fil_lire (filId) | proposer_reponse (id OU filId, texte : un bouton « Envoyer au client » attend l'utilisateur). surveillances : lister | historique (id) | verifier (id?). backups : lister | points (id?) | lancer (id). medias : lister (genre image|video|son ?). recurrentes : lister. reseaux : lister | proposer (texte, canal, date AAAA-MM-JJ, heure HH:MM, titre?, creationId? : un bouton « Programmer » attend l'utilisateur). studio : lister | video (demande, titre?, format 9:16|16:9|1:1 ?, campagne? : l'identifiant de la campagne qu'elle sert — refusé tant que sa fiche n'a pas ses huit points, et sa base se fige au lancement) | image (mêmes champs, format 1:1 par défaut : un visuel fixe ; pour une campagne, sa dernière esquisse part en référence) | suivre (creationId). Sur une création que TU as demandée (ou qui sert ta campagne) : montrer (creationId, ou rien pour la dernière de ta campagne : pose le LECTEUR et son suivi dans ton fil — quand la personne demande à voir le média) | lire (creationId : versions, pistes, fichiers, exports, dépenses) | exporter (creationId, format, genre? : relance un export, gratuit) | retouche (creationId, demande : transmise au directeur artistique, qui garde le montage) | recuperer (creationId, id? d'un export ou format? : joint le fichier fini à ta réponse). L'avancement, la liste de tâches du directeur, le lecteur, les boutons à prix et le résultat paraissent dans ta conversation, dans le bloc de suivi : ne recopie jamais son lien. ACCORD D'ABORD : un NOUVEAU média (video, image) pour une campagne qui en a déjà un est refusé sans réponse récente à ta question « ask_user » — un changement se fait par « retouche ». Ne renvoie pas l'utilisateur au Studio pour ce que ces gestes font. referencement (l'audit SEO + GEO du Marketing, « projet » = le projet audité) : lire (notes, passage en cours, historique) | auditer (SEULEMENT quand la personne demande un audit : contrôle technique puis les questions cibles aux six IA, dans une fenêtre privée réduite de son ordinateur ; une carte s'ouvre dans le projet audité et l'audit prend sa ligne dans l'historique) | code_claude (pour une séance de suivi : le code de connexion du compte Claude dédié). Statistiques, coffre-fort, mémoire : leurs propres outils.",
  inputSchema: {
    type: 'object',
    required: ['service', 'action'],
    properties: {
      service: { type: 'string', enum: ['messagerie', 'surveillances', 'backups', 'medias', 'recurrentes', 'reseaux', 'studio', 'referencement'] },
      action: { type: 'string' },
      projet: { type: 'string' },
      id: { type: 'string' },
      filId: { type: 'string' },
      texte: { type: 'string' },
      titre: { type: 'string' },
      description: { type: 'string' },
      echeance: { type: 'string' },
      importance: { type: 'string' },
      genre: { type: 'string' },
      canal: { type: 'string' },
      date: { type: 'string' },
      heure: { type: 'string' },
      creationId: { type: 'string' },
      demande: { type: 'string' },
      format: { type: 'string' },
      campagne: { type: 'string', description: 'Studio « video » : l’identifiant de la campagne que la vidéo sert' },
    },
  },
};

/** Les actions qui ne font que lire : tout le reste demande « agir ». */
const ACTIONS_DE_LECTURE = new Set(['lister', 'lire', 'fil_lire', 'historique', 'points', 'suivre', 'code_claude']);

const nomDuProjet = (id: string | null | undefined) => (id ? (store.getProject(id)?.name ?? id) : '');

function projetDeLAppel(ctx: ToolContext, voulu: unknown): { ok: true; projectId: string } | { ok: false; text: string } {
  const texte = typeof voulu === 'string' ? voulu.trim() : '';
  if (!texte) return { ok: true, projectId: ctx.projectId };
  const vise = trouverLeProjetVise(
    store.listProjects(true).map((p) => ({ id: p.id, name: p.name, archive: p.archived })),
    texte,
  );
  return vise.ok ? { ok: true, projectId: vise.projet.id } : { ok: false, text: `${vise.raison} Projets : ${store.listProjects().map((p) => p.name).join(', ')}.` };
}

/** Le refus d'une action, ou `null` si elle passe. */
async function refusDeLAction(ctx: ToolContext, service: ServiceDeLAgent, projectId: string | null, requis: 'lire' | 'agir'): Promise<string | null> {
  if (requis === 'agir' && ctx.role === 'cadrage') {
    return 'Le cadrage ne fait que LIRE les services : ce geste partira de l’agent de tâche, après « Lancer ».';
  }
  const acces = await accesDeCetAgent(ctx.agentId, service, projectId);
  return accesSuffit(acces, requis) ? null : refusDuService(service, requis, nomDuProjet(projectId));
}

/* ------------------------------------------------------------------ */
/* L'outil                                                              */
/* ------------------------------------------------------------------ */

export async function outilServices(ctx: ToolContext, args: Record<string, any>): Promise<ToolResult> {
  const service = String(args.service ?? '') as ServiceDeLAgent;
  const action = String(args.action ?? '').trim();
  if (!(SERVICES_DE_L_AGENT as readonly string[]).includes(service)) return { ok: false, text: `Service inconnu : ${service || '(vide)'}.` };
  const projet = projetDeLAppel(ctx, args.projet);
  if (!projet.ok) return { ok: false, text: projet.text };
  const projectId = projet.projectId;
  const requis = ACTIONS_DE_LECTURE.has(action) ? 'lire' : 'agir';
  /* Les surveillances ne vivent dans aucun projet. */
  const refus = await refusDeLAction(ctx, service, service === 'surveillances' ? null : projectId, requis);
  if (refus) return { ok: false, text: refus };
  try {
    const g = await import('./assistant-global.js');
    switch (service) {
      case 'messagerie':
        return await messagerie(ctx, action, args, projectId);
      case 'surveillances':
        if (action === 'supprimer') return { ok: false, text: 'Retirer une surveillance est un geste de l’utilisateur, dans l’écran Surveillance.' };
        return await g.surveillances({ ...args, action });
      case 'backups':
        return backups(action, args, projectId, g.backups);
      case 'medias':
        return await medias(args, projectId);
      case 'recurrentes':
        return await recurrentes(projectId);
      case 'reseaux':
        return await reseaux(ctx, action, args, projectId);
      case 'studio':
        return await studio(ctx, action, args, projectId);
      default:
        return { ok: false, text: `Service non servi par cet outil : ${service}.` };
    }
  } catch (err: any) {
    return { ok: false, text: `Échec : ${err?.message ?? String(err)}` };
  }
}

/* ------------------------------------------------------------------ */
/* Messagerie : lire, et PROPOSER une réponse                           */
/* ------------------------------------------------------------------ */

async function messagerie(ctx: ToolContext, action: string, args: Record<string, any>, projectId: string): Promise<ToolResult> {
  const espace = await import('./espace-client.js');
  const { compteParId } = await import('./comptes.js');
  const g = await import('./assistant-global.js');
  const filDuProjet = (filId: string) => !!compteParId(filId)?.projets.includes(projectId);
  if (action === 'lister') return g.messagerie({ action: 'lister' }, projectId);
  if (action === 'lire') {
    const d = espace.laDemande(String(args.id ?? ''));
    if (!d || d.projectId !== projectId) return { ok: false, text: `Aucune demande « ${args.id ?? ''} » dans ${nomDuProjet(projectId)}.` };
    return g.messagerie({ action: 'lire', id: d.id }, projectId);
  }
  if (action === 'fil_lire') {
    const filId = String(args.filId ?? '');
    if (!filDuProjet(filId)) return { ok: false, text: `Ce fil n’est pas celui d’un client de ${nomDuProjet(projectId)}.` };
    return g.messagerie({ action: 'fil_lire', filId }, projectId);
  }
  if (action === 'proposer_reponse') {
    const texte = String(args.texte ?? '').trim();
    if (!texte) return { ok: false, text: 'Écris la réponse proposée (« texte »).' };
    const id = String(args.id ?? '');
    const filId = String(args.filId ?? '');
    let pour: string;
    let geste: NonNullable<AgentQuestion['gesteAValider']>;
    if (id) {
      const d = espace.laDemande(id);
      if (!d || d.projectId !== projectId) return { ok: false, text: `Aucune demande « ${id} » dans ${nomDuProjet(projectId)}.` };
      pour = `la demande « ${d.titre} »`;
      geste = { genre: 'repondre_demande', projectId, demandeId: d.id, texte };
    } else if (filId) {
      if (!filDuProjet(filId)) return { ok: false, text: `Ce fil n’est pas celui d’un client de ${nomDuProjet(projectId)}.` };
      pour = `le fil de ${compteParId(filId)?.nomAffiche ?? 'ce client'}`;
      geste = { genre: 'envoyer_fil', projectId, filId, texte };
    } else return { ok: false, text: 'Dis à quoi répondre : « id » d’une demande ou « filId » d’un fil.' };
    return {
      ok: true,
      text: `Réponse proposée dans ta conversation, sous un bouton « Envoyer au client » : rien ne part sans le clic de l’utilisateur, et ce clic ne te réveille pas. Dis-le en une phrase.`,
      question: AgentQuestion.parse({
        id: store.newId(),
        question: `Envoyer cette réponse au client (${pour}) ?`,
        description: texte,
        kind: 'single',
        options: [
          { id: 'envoyer', label: 'Envoyer au client' },
          { id: 'non', label: 'Ne pas envoyer' },
        ],
        allowFreeText: false,
        gesteAValider: geste,
      }),
    };
  }
  return { ok: false, text: `Action inconnue pour la messagerie : ${action}. Les réponses écrites partent de l’utilisateur.` };
}

/* ------------------------------------------------------------------ */
/* Backups, médias, tâches récurrentes                                  */
/* ------------------------------------------------------------------ */

async function backupsDuProjet(projectId: string): Promise<Set<string>> {
  const { listerSites } = await import('./backups.js');
  return new Set(listerSites().filter((s) => s.projectId === projectId).map((s) => s.id));
}

async function backups(action: string, args: Record<string, any>, projectId: string, implementation: (a: Record<string, any>) => ToolResult): Promise<ToolResult> {
  const { listerSites, listerPoints } = await import('./backups.js');
  const duProjet = await backupsDuProjet(projectId);
  const id = String(args.id ?? '');
  if (action === 'lister') {
    const sites = listerSites().filter((s) => duProjet.has(s.id));
    if (!sites.length) return { ok: true, text: `Aucun site sauvegardé pour ${nomDuProjet(projectId)}.` };
    const points = listerPoints();
    return {
      ok: true,
      text: sites
        .map((s) => {
          const dernier = points.find((p) => p.siteId === s.id);
          return `- [${s.id}] ${s.nom} — ${s.actif ? 'actif' : 'éteint'} — dernier point : ${dernier ? `${new Date(dernier.debut).toISOString().slice(0, 16)} ${dernier.statut}` : 'aucun'}`;
        })
        .join('\n'),
    };
  }
  if (action === 'points' || action === 'lancer') {
    if (id && !duProjet.has(id)) return { ok: false, text: `Aucun site sauvegardé « ${id} » dans ${nomDuProjet(projectId)}.` };
    if (action === 'lancer' && !id) return { ok: false, text: 'Dis quel site sauvegarder (« id », donné par « lister »).' };
    if (action === 'points' && !id) {
      const points = listerPoints().filter((p) => duProjet.has(p.siteId)).slice(0, 40);
      return { ok: true, text: points.map((p) => `- [${p.id}] ${new Date(p.debut).toISOString().slice(0, 16)} — ${p.statut} — ${p.detail}`).join('\n') || 'Aucun point.' };
    }
    return implementation({ action, id });
  }
  return { ok: false, text: `Action inconnue pour les backups : ${action}. Créer ou retirer une fiche est un geste de l’écran Backup.` };
}

async function medias(args: Record<string, any>, projectId: string): Promise<ToolResult> {
  const { mediasDuProjet } = await import('./realisation.js');
  const genre = ['image', 'video', 'son'].includes(String(args.genre)) ? (String(args.genre) as 'image' | 'video' | 'son') : undefined;
  const r = mediasDuProjet(projectId, { genre, limite: 10 });
  if (!r.groupes.length) return { ok: true, text: `Aucun média fabriqué dans ${nomDuProjet(projectId)}.` };
  const lignes = r.groupes.flatMap((g) => [
    `« ${g.titre} » (carte ${g.cardId}) :`,
    ...g.medias.slice(-8).map((m) => `  - ${m.genre} ${m.plan} v${m.version}${m.attachmentId ? ` — pièce ${m.attachmentId}` : ''}${m.modele ? ` — ${m.modele}` : ''}`),
  ]);
  return { ok: true, text: [`Totaux : ${r.totaux.image} image(s), ${r.totaux.video} vidéo(s), ${r.totaux.son} son(s).`, ...lignes].join('\n') };
}

async function recurrentes(projectId: string): Promise<ToolResult> {
  const { listerLesVeilles } = await import('./veille-de-carte.js');
  const veilles = listerLesVeilles().filter((v) => v.projectId === projectId);
  if (!veilles.length) return { ok: true, text: `Aucune tâche récurrente dans ${nomDuProjet(projectId)}. Pour en poser une sur ta carte : « veille_poser ».` };
  return {
    ok: true,
    text: veilles
      .map((v) => `- [${v.id}] « ${v.titreCarte ?? 'carte retirée'} » — ${v.etat} — ${v.raison}${v.dernierControle ? ` — dernier contrôle : ${v.dernierControle.issue}` : ''}`)
      .join('\n'),
  };
}

/* ------------------------------------------------------------------ */
/* Réseaux sociaux : lire, et PROPOSER une publication datée            */
/* ------------------------------------------------------------------ */

const JOUR = /^\d{4}-\d{2}-\d{2}$/;
const HEURE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function libelleDeProgrammation(date: string, heure?: string | null): string {
  const [, m, j] = date.split('-');
  return `Programmer le ${j}/${m}${heure ? ` à ${heure.replace(':', 'h')}` : ''}`;
}

async function reseaux(ctx: ToolContext, action: string, args: Record<string, any>, projectId: string): Promise<ToolResult> {
  const marketing = await import('./marketing.js');
  const sociale = await import('./publication-sociale.js');
  if (action === 'lister') {
    const comptes = sociale.listerComptes(projectId);
    const contenus = marketing.listerContenus(projectId).filter((c) => c.etape !== 'abandonne').slice(0, 25);
    return {
      ok: true,
      text: [
        `Comptes reliés : ${comptes.length ? comptes.map((c) => `${c.reseau} (${c.nom ?? c.id})`).join(', ') : 'aucun — ils se relient dans l’écran Réseaux sociaux'}.`,
        ...contenus.map((c) => `- [${c.id}] « ${c.titre} » — ${c.canal} — ${c.etape}${c.datePrevue ? ` — ${c.datePrevue}${c.heurePrevue ? ` ${c.heurePrevue}` : ''}` : ''}`),
      ].join('\n'),
    };
  }
  if (action !== 'proposer') return { ok: false, text: `Action inconnue pour les réseaux : ${action}. Valider, programmer et publier sont des gestes de l’utilisateur.` };
  const texte = String(args.texte ?? '').trim();
  const canal = String(args.canal ?? '').trim();
  const date = String(args.date ?? '').trim();
  const heure = String(args.heure ?? '').trim();
  if (!texte || !canal) return { ok: false, text: 'Il faut « texte » et « canal » (instagram, facebook, linkedin…).' };
  if (!JOUR.test(date)) return { ok: false, text: 'Propose une date (« date » AAAA-MM-JJ) : on ne programme pas « un jour ».' };
  if (heure && !HEURE.test(heure)) return { ok: false, text: 'L’heure s’écrit HH:MM (« 18:30 »).' };
  let creation: Awaited<ReturnType<typeof import('./studio.js').lireCreation>> = null;
  if (args.creationId) {
    const { lireCreation } = await import('./studio.js');
    creation = lireCreation(String(args.creationId));
    if (!creation || creation.projectId !== projectId) return { ok: false, text: `Aucune création « ${args.creationId} » dans le Studio de ${nomDuProjet(projectId)}.` };
  }
  const r = marketing.creerContenu({
    projectId,
    genre: 'post',
    canal,
    canaux: [canal],
    titre: String(args.titre ?? '').trim() || texte.slice(0, 60),
    texte,
    datePrevue: date,
    etape: 'a_valider',
    origine: 'agent',
  });
  if (!r.ok) return { ok: false, text: r.raison };
  if (heure) marketing.modifierContenu(r.contenu.id, { heurePrevue: heure }, 'agent');
  if (creation) {
    const { getDb } = await import('./db.js');
    getDb().prepare('UPDATE studio_creations SET contenu_marketing_id = ? WHERE id = ?').run(r.contenu.id, creation.id);
  }
  const comptes = sociale.listerComptes(projectId).filter((c) => c.reseau === canal);
  if (!comptes.length) {
    return {
      ok: true,
      text: `Publication déposée dans « À valider » des Réseaux sociaux (${r.contenu.id}). Aucun compte ${canal} n’est relié à ce projet : rien ne peut être programmé tant que l’utilisateur ne l’a pas relié dans l’écran Réseaux sociaux. Dis-le-lui en une phrase.`,
    };
  }
  const libelle = libelleDeProgrammation(date, heure || null);
  return {
    ok: true,
    text: `Publication proposée (${r.contenu.id}, « À valider ») avec un bouton « ${libelle} » dans ta conversation : seul le clic de l’utilisateur la programme, et il ne te réveille pas. Dis en une phrase ce qu’elle apporte.`,
    question: AgentQuestion.parse({
      id: store.newId(),
      question: `${libelle} sur ${canal} ?`,
      description: `${texte}${creation ? `\n\nAvec la vidéo du Studio « ${creation.titre} » (son export prêt part avec elle).` : ''}`,
      kind: 'single',
      options: [
        { id: 'programmer', label: libelle },
        { id: 'non', label: 'Pas maintenant' },
      ],
      allowFreeText: false,
      gesteAValider: { genre: 'programmer', projectId, contenuId: r.contenu.id },
    }),
  };
}

/* ------------------------------------------------------------------ */
/* Studio : lancer une vidéo, la suivre                                 */
/* ------------------------------------------------------------------ */

async function studio(ctx: ToolContext, action: string, args: Record<string, any>, projectId: string): Promise<ToolResult> {
  const s = await import('./studio.js');
  if (action === 'lister') {
    const creations = s.listerCreations(projectId).slice(0, 15);
    return {
      ok: true,
      text: creations.map((c) => `- [${c.id}] « ${c.titre} » — ${c.etat === 'exportee' ? 'exportée' : 'en cours'} — ${c.formats.join(', ')}`).join('\n') || `Aucune création dans le Studio de ${nomDuProjet(projectId)}.`,
    };
  }
  if (action === 'suivre') {
    const { etatDuSuivi } = await import('./suivi-studio.js');
    const c = s.lireCreation(String(args.creationId ?? ''));
    if (!c || c.projectId !== projectId) return { ok: false, text: 'Création introuvable dans ce projet.' };
    return { ok: true, text: await etatDuSuivi(c) };
  }
  if (ACTIONS_AUTOUR_DU_MONTAGE.has(action)) return await autourDuMontage(ctx, action, args, projectId);
  if (action !== 'video' && action !== 'image') return { ok: false, text: `Action inconnue pour le Studio : ${action}.` };
  const image = action === 'image';
  const demande = String(args.demande ?? '').trim();
  if (!demande) return { ok: false, text: image ? 'Écris la demande d’image pour le directeur artistique (« demande ») : sujet, public, message, ton.' : 'Écris la demande de vidéo pour le directeur artistique (« demande ») : sujet, public, durée, ton.' };
  const format = estFormatStudio(args.format) ? args.format : image ? '1:1' : '9:16';
  const titre = String(args.titre ?? '').trim() || demande.split(/[.\n]/)[0]!.slice(0, 80);
  /* UNE VIDÉO POUR UNE CAMPAGNE (04/11/2026) : refusée tant que la fiche n'a pas ses huit points, et rattachée dès le
     lancement — la base de la campagne se fige au premier média EN FABRICATION, pas à sa livraison. */
  /* L'AGENT D'UNE CAMPAGNE sert SA campagne même s'il oublie de la nommer (12/11/2026). */
  const campagne = typeof args.campagne === 'string' && args.campagne.trim() ? args.campagne.trim() : await campagneDeLAgent(ctx.agentId);
  const communication = campagne ? await import('./communication.js') : null;
  const refus = communication?.refusTantQueLaFicheManque(campagne);
  if (refus) return { ok: false, text: refus };
  /* UN NOUVEAU MÉDIA POUR UNE CAMPAGNE QUI EN A DÉJÀ UN passe par l'accord de la personne (12/11/2026, captures #8adf,
     #40a2 : une « Démo v2 » était née au lieu de retoucher la démo). La toute première création n'est pas bloquée. */
  const existantes = campagne && communication ? communication.creationsDeLaCampagne(campagne).map((id) => s.lireCreation(id)).filter((c): c is NonNullable<typeof c> => !!c) : [];
  if (existantes.length && !accordRecent(store.listMessages(ctx.agentId, 12), Date.now())) {
    const derniere = existantes[0]!;
    return {
      ok: false,
      text: refusSansAccord(
        image ? 'créer une nouvelle image' : 'créer une nouvelle vidéo',
        `Ta campagne a déjà « ${derniere.titre} » (création ${derniere.id}) : pour la changer, c’est « retouche » sur cette création (son historique garde chaque version), sans question. Un média EN PLUS, lui, se demande.`,
      ),
    };
  }
  const nee = s.creerCreation({ projectId, titre, formats: [format] });
  if (!nee.ok) return { ok: false, text: nee.raison };
  if (campagne && communication) communication.rattacherCreationACampagne(nee.creation.id, campagne);
  /* LA DERNIÈRE ESQUISSE DE LA CAMPAGNE guide le vrai visuel : elle part en référence au directeur (10/11/2026). */
  const esquisse = campagne && communication ? communication.esquisseDeCampagne(campagne) : null;
  const { lancerUneVideoPourUnAgent } = await import('./suivi-studio.js');
  const depart = await lancerUneVideoPourUnAgent({ creation: nee.creation, demandeurId: ctx.agentId, demande, genre: image ? 'image' : 'video', ...(esquisse ? { references: [esquisse] } : {}) });
  log.info(`services : ${image ? 'image' : 'vidéo'} « ${titre} » lancée dans le Studio pour l’agent ${ctx.agentId}`);
  return {
    ok: true,
    text: `${image ? 'Image' : 'Vidéo'} ouverte dans le Studio (création ${nee.creation.id}) avec son directeur artistique, qui commence par le brief puis une version gratuite${esquisse ? ', en partant de ta dernière esquisse' : ''}. Un bloc de suivi est posé dans ta conversation : il montre l’étape, les boutons à prix, ${image ? 'la dernière version et l’image finie' : 'l’aperçu en direct puis la vidéo finie'}, avec son propre bouton vers le Studio. Dis-le en une phrase, sans recopier aucun lien ; « suivre » relit l’avancement, et « lire », « exporter », « retouche », « recuperer » te donnent tous les gestes autour du montage. Une fois prêt, lie le visuel à sa publication (« lier_media »).`,
  };
}

/**
 * TOUS LES GESTES AUTOUR DU MONTAGE, POUR L'AGENT QUI A DEMANDÉ LA CRÉATION (décision de l'utilisateur du
 * 11/11/2026) : le directeur artistique GARDE le montage ; l'agent de campagne lit tout (versions, fichiers,
 * réglages, exports, dépenses), relance un export dans le format voulu (rendu local, gratuit), transmet une
 * retouche au directeur et récupère un fichier fini dans son propre fil — il ne renvoie plus l'utilisateur au Studio.
 *
 * Seulement sur une création DE SON PROJET, qu'il a demandée ou qui sert SA campagne : un autre agent du projet
 * garde « suivre ». Aucune dépense ne part d'ici : les générations payantes restent des boutons à prix du directeur.
 */
const ACTIONS_AUTOUR_DU_MONTAGE = new Set(['montrer', 'lire', 'exporter', 'retouche', 'recuperer']);

/** La campagne que cet agent sert, s'il est l'agent d'une campagne. */
async function campagneDeLAgent(agentId: string): Promise<string | null> {
  const { roleDuChef } = await import('./directeur-marketing.js');
  const role = roleDuChef(agentId);
  return role?.niveau === 'campagne' && role.campagneId ? role.campagneId : null;
}

async function creationDeLAgentDemandeur(ctx: ToolContext, creationId: string, projectId: string) {
  const s = await import('./studio.js');
  const c = s.lireCreation(creationId);
  if (!c || c.projectId !== projectId) return { ok: false as const, text: `Aucune création « ${creationId} » dans le Studio de ${nomDuProjet(projectId)} (« lister » les donne).` };
  const { getMeta } = await import('./db.js');
  const { agentDeCampagneDeLaCreation } = await import('./communication.js');
  const demandeur = getMeta(`studio.demandeur.${c.id}`);
  if (demandeur !== ctx.agentId && agentDeCampagneDeLaCreation(c.id) !== ctx.agentId) {
    return { ok: false as const, text: `« ${c.titre} » n’a été demandée ni par toi ni pour ta campagne : tu peux la « suivre », pas la piloter.` };
  }
  return { ok: true as const, creation: c };
}

async function autourDuMontage(ctx: ToolContext, action: string, args: Record<string, any>, projectId: string): Promise<ToolResult> {
  let creationId = String(args.creationId ?? '').trim();
  /* « montrer » sans creationId : la dernière création de la campagne de l'agent. */
  if (!creationId && action === 'montrer') {
    const campagne = await campagneDeLAgent(ctx.agentId);
    const { creationsDeLaCampagne } = await import('./communication.js');
    creationId = campagne ? (creationsDeLaCampagne(campagne)[0] ?? '') : '';
    if (!creationId) return { ok: false, text: 'Aucune création du Studio pour ta campagne : rien à montrer (« lister » donne celles du projet).' };
  }
  const trouvee = await creationDeLAgentDemandeur(ctx, creationId, projectId);
  if (!trouvee.ok) return trouvee;
  const c = trouvee.creation;
  const s = await import('./studio.js');

  if (action === 'montrer') {
    /* LE LECTEUR DANS LE FIL, À LA DEMANDE (12/11/2026, capture #9def : l'agent renvoyait à un « bloc ci-dessus » qui
       n'existait pas). Le bloc de suivi est reposé EN BAS du fil, et c'est lui que le démon tient à jour ensuite. */
    const { reposerLeBlocDuStudio } = await import('./suivi-studio.js');
    await reposerLeBlocDuStudio(c, ctx.agentId);
    return { ok: true, text: `Le lecteur de « ${c.titre} » est posé dans ta conversation (étape, aperçu, formats prêts, bouton du Studio). Dis-le en une phrase, sans lien et sans « ci-dessus ».` };
  }

  if (action === 'lire') {
    const composition = s.compositionCourante(c.id);
    const versions = s.historique(c.id).slice(-8);
    const exports = s.listerExports(c.id).slice(0, 10);
    const medias = s.listerMedias(c.projectId, c.id).slice(0, 20);
    const depenses = s.listerDepenses(c.id);
    const pistes = composition?.pistes ?? [];
    const enSecondes = (n: number) => `${n.toFixed(1)} s`;
    const duree = pistes.flatMap((p) => p.segments).reduce((m, x) => Math.max(m, x.debut + x.duree), 0);
    return {
      ok: true,
      text: [
        `CRÉATION « ${c.titre} » (${c.id}) — version ${c.version}, formats ${c.formats.join(', ')}, ${enSecondes(duree)}${composition?.dureeVoulue !== undefined ? `, durée voulue ${enSecondes(composition.dureeVoulue)}` : ''}.`,
        `PISTES : ${pistes.map((p) => `${p.nom} (${p.genre}, ${p.segments.length} élément${p.segments.length > 1 ? 's' : ''})`).join(' ; ') || 'aucune'}.`,
        `VERSIONS RÉCENTES : ${versions.map((v) => `v${v.numero} ${v.raison} (${v.auteur})`).join(' ; ') || 'aucune'}.`,
        `EXPORTS : ${exports.map((e) => `[${e.id}] ${e.genre} ${e.format} v${e.version} — ${e.etat}${e.erreur ? ` (${e.erreur})` : ''}${e.attachmentId ? ` — pièce ${e.attachmentId}` : ''}`).join(' ; ') || 'aucun'}.`,
        `FICHIERS DE LA BIBLIOTHÈQUE : ${medias.map((m) => `[${m.id}] ${m.genre} « ${m.nom} »`).join(' ; ') || 'aucun'}.`,
        `DÉPENSES : ${depenses.length ? depenses.map((d) => `${d.genre} ${d.etat}${typeof d.montantReel === 'number' ? ` ${d.montantReel.toFixed(2)} $` : d.plafond !== null ? ` (plafond ${d.plafond.toFixed(2)} $)` : ''}`).join(' ; ') : 'aucune'} — total ${s.totalDepense(c.id).toFixed(2)} $.`,
        'Le montage reste au directeur artistique : pour changer la vidéo, « retouche » avec la consigne.',
      ].join('\n'),
    };
  }

  if (action === 'exporter') {
    const { estFormatStudio: estFormat } = await import('@beluga/shared');
    const { getMeta } = await import('./db.js');
    const genre: 'video' | 'image' = args.genre === 'image' || args.genre === 'video' ? args.genre : getMeta(`studio.genre.${c.id}`) === 'image' ? 'image' : 'video';
    const format = estFormat(args.format) ? args.format : c.formats[0];
    if (!format) return { ok: false, text: 'Dis le format : 9:16, 1:1, 4:5 ou 16:9.' };
    if (!c.formats.includes(format)) {
      const r = s.modifierCreation(c.id, { formats: [...c.formats, format] });
      if (!r.ok) return { ok: false, text: r.raison };
    }
    const { lancerExport } = await import('./studio-rendu.js');
    const r = lancerExport(c.id, format, genre);
    if (!r.ok) return { ok: false, text: `Export refusé : ${r.raison}.` };
    return {
      ok: true,
      text: `Export ${genre === 'image' ? 'image' : 'vidéo'} ${format} lancé (${r.export.id}, gratuit, rendu sur le serveur). Le bloc de suivi de ta conversation le montre en cours puis lit le fichier fini. Dis-le en une phrase, sans lien.`,
    };
  }

  if (action === 'retouche') {
    const consigne = String(args.demande ?? args.texte ?? '').trim();
    if (!consigne) return { ok: false, text: 'Écris la retouche pour le directeur artistique (« demande ») : quoi changer, où, pourquoi.' };
    const { isRunning } = await import('./runtime.js');
    if (c.agentId && isRunning(c.agentId)) {
      return { ok: false, text: 'Le directeur artistique travaille encore sur cette création : attends la fin de son tour (« suivre ») avant de lui transmettre une retouche.' };
    }
    const { lancerAgentStudio } = await import('./assistant-studio.js');
    const demandeur = store.getAgent(ctx.agentId);
    const origine = demandeur?.cardId ? store.getCard(demandeur.cardId)?.title : demandeur?.title;
    await lancerAgentStudio({
      creationId: c.id,
      demande: `RETOUCHE transmise par l’agent ${origine ? `de « ${origine} »` : 'qui a demandé cette création'} (au nom de l’utilisateur) :\n\n${consigne}\n\nC’est une retouche : agis sans repasser par le brief, version gratuite d’abord.`,
    });
    return { ok: true, text: 'Retouche transmise au directeur artistique : il la monte dans le Studio, et le bloc de suivi de ta conversation se met à jour (nouvelle version, puis export). Dis-le en une phrase.' };
  }

  /* recuperer : un export prêt, joint au message de l'agent dans SON fil. */
  const exports = s.listerExports(c.id).filter((e) => e.etat === 'pret' && e.attachmentId);
  const voulu = String(args.id ?? '').trim();
  const { estFormatStudio: estFormat } = await import('@beluga/shared');
  const choisi = voulu ? exports.find((e) => e.id === voulu) : estFormat(args.format) ? exports.find((e) => e.format === args.format) : exports[0];
  if (!choisi) return { ok: false, text: exports.length ? `Aucun export prêt de ce nom : ${exports.map((e) => `${e.id} (${e.genre} ${e.format})`).join(', ')}.` : 'Aucun export prêt : lance-le avec « exporter ».' };
  const { attachToCurrentMessage } = await import('./runtime.js');
  attachToCurrentMessage(ctx.agentId, { attachment: choisi.attachmentId! });
  return { ok: true, text: `Fichier ${choisi.genre} ${choisi.format} joint à ta réponse (pièce ${choisi.attachmentId}) : l’utilisateur le lit et le télécharge dans la conversation. Tu peux le lier à une publication (« lier_media »).` };
}

/* ------------------------------------------------------------------ */
/* Le clic de l'utilisateur sur un geste préparé                        */
/* ------------------------------------------------------------------ */

/** Le premier choix fait partir le geste ; tout autre le laisse en place, sans rien envoyer. */
export async function trancherLeGesteAValider(
  question: Pick<AgentQuestion, 'gesteAValider' | 'options'>,
  reponse: string,
  compte: CompteUtilisateur,
): Promise<{ ok: true; fait: boolean } | { ok: false; raison: string }> {
  const geste = question.gesteAValider;
  if (!geste) return { ok: false, raison: 'aucun geste à valider' };
  const oui = question.options[0]?.label;
  if (!oui || reponse.trim() !== oui) return { ok: true, fait: false };
  const service: ServiceDeLAgent = geste.genre === 'programmer' ? 'reseaux' : 'messagerie';
  const acces: AccesDeLAgent = accesDeLAgent({ interlocuteur: compte, service, projectId: geste.projectId });
  if (!accesSuffit(acces, 'agir')) return { ok: false, raison: refusDuService(service, 'agir', nomDuProjet(geste.projectId)).replace('à la personne qui te parle : dis-le-lui simplement ; c’est', 'à votre accès :') };
  if (geste.genre === 'programmer') {
    const marketing = await import('./marketing.js');
    const sociale = await import('./publication-sociale.js');
    const id = geste.contenuId ?? '';
    const c = marketing.lireContenu(id);
    if (!c) return { ok: false, raison: 'cette publication n’existe plus' };
    if (c.etape === 'programme' || c.etape === 'publie') return { ok: true, fait: true };
    const comptes = sociale.listerComptes(c.projectId).filter((x) => c.canaux.includes(x.reseau));
    if (!comptes.length) return { ok: false, raison: 'aucun compte relié pour ce réseau' };
    if (c.etape !== 'pret') {
      const r = marketing.changerEtape(id, 'pret', 'humain');
      if (!r.ok) return { ok: false, raison: r.raison };
    }
    const cibles = sociale.ecrireCibles(id, comptes.map((x) => x.id));
    if (!cibles.ok) return { ok: false, raison: cibles.raison };
    const r = marketing.changerEtape(id, 'programme', 'humain');
    return r.ok ? { ok: true, fait: true } : { ok: false, raison: r.raison };
  }
  const { commandeDeLEspaceClient } = await import('./espace-commandes.js');
  const cmd =
    geste.genre === 'repondre_demande'
      ? { type: 'espace.demande.commenter', id: geste.demandeId, texte: geste.texte ?? '' }
      : { type: 'espace.fil.envoyer', filId: geste.filId, texte: geste.texte ?? '' };
  await commandeDeLEspaceClient(cmd as never, compte);
  return { ok: true, fait: true };
}


/* ------------------------------------------------------------------ */
/* Les droits sur les outils déjà existants                             */
/* ------------------------------------------------------------------ */

/**
 * LES OUTILS DE SERVICE D'AVANT CET OUTIL suivent la même règle : coffre-fort,
 * statistiques, mémoire, réseaux (« marketing ») et Studio sur le projet de
 * l'appel ; les outils propres de l'assistant général au seul propriétaire.
 */
export async function refusParLesDroits(ctx: ToolContext, nom: string, args: Record<string, any>, projetVise?: string): Promise<string | null> {
  const projectId = projetVise ?? ctx.projectId;
  const lecture = (a: unknown, ecritures: readonly string[]) => !ecritures.includes(String(a ?? ''));
  const parService: Record<string, [ServiceDeLAgent, boolean]> = {
    coffre_fort: ['coffre', lecture(args.action, ['enregistrer', 'supprimer', 'restaurer', 'ranger', 'dossier_creer', 'dossier_supprimer'])],
    statistiques: ['statistiques', ['etat', 'lire', 'parcours'].includes(String(args.action ?? ''))],
    memoire: ['memoire', ['chercher', 'lire', 'brouillon'].includes(String(args.geste ?? ''))],
    remember: ['memoire', false],
    marketing: ['reseaux', ['lire', 'messages'].includes(String(args.action ?? ''))],
    studio: ['studio', false],
  };
  if (nom.startsWith('assistant_')) {
    const { interlocuteurDeLAgent } = await import('./interlocuteur.js');
    const qui = await interlocuteurDeLAgent(ctx.agentId);
    return qui?.role === 'admin' ? null : 'Cet outil de l’assistant est réservé au propriétaire de l’application. Pour un projet ouvert à la personne qui te parle, passe par l’outil « services ».';
  }
  const regle = parService[nom];
  if (!regle) return null;
  const [service, lit] = regle;
  /*
   * CES OUTILS-LÀ SERVAIENT DÉJÀ TOUT AGENT : seule la grille d'un accès tiers
   * CONNU les restreint. Un interlocuteur inconnu (tour de nuit, lancement
   * automatique) garde leur usage d'avant — sinon l'agent de nuit ne relirait
   * plus le coffre ni n'écrirait sa mémoire. L'outil « services », lui, applique
   * le droit le plus étroit (`outilServices`).
   */
  const { interlocuteurDeLAgent } = await import('./interlocuteur.js');
  const qui = await interlocuteurDeLAgent(ctx.agentId);
  if (!qui || qui.role === 'admin') return null;
  const acces = accesDeLAgent({ interlocuteur: qui, service, projectId });
  const requis = lit ? 'lire' : 'agir';
  return accesSuffit(acces, requis) ? null : refusDuService(service, requis, nomDuProjet(projectId));
}

/* ------------------------------------------------------------------ */
/* Le guide remis à l'agent                                             */
/* ------------------------------------------------------------------ */

/**
 * LE GUIDE DES SERVICES de cet agent, sur SON projet, réduit à ce que son
 * interlocuteur ouvre (`guideDesServices`). Il ne bouge qu'avec les droits :
 * la consigne système reste la même d'un tour à l'autre.
 */
export async function guideDesServicesDeLAgent(agentId: string, projectId: string): Promise<string> {
  const { guideDesServices } = await import('@beluga/shared');
  const acces: Partial<Record<ServiceDeLAgent, AccesDeLAgent>> = {};
  for (const service of SERVICES_DE_L_AGENT) acces[service] = await accesDeCetAgent(agentId, service, service === 'surveillances' ? null : projectId);
  return guideDesServices(acces);
}
