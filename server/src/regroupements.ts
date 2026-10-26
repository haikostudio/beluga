/**
 * LES PROJETS RÉUNIS — les gestes, sur la base et sur le disque.
 *
 * Les règles pures vivent dans `shared/src/regroupements.ts` : qui peut être
 * réuni, quels projets une carte mère touche, où ranger la mère. Ici :
 *
 *  - RÉUNIR, RENOMMER, COMPLÉTER, RETIRER, SÉPARER — les commandes de la
 *    rubrique « Projets » des réglages ;
 *  - LANCER UNE CARTE MÈRE : elle pose une carte fille dans chaque projet
 *    touché et les lance, SANS lancer d'agent elle-même ;
 *  - SUIVRE LES MÈRES : chaque fois qu'une fille bouge, la mère se range ;
 *  - CONVERTIR les anciens projets à dépôts annexes, une fois, au démarrage.
 *
 * AUCUN DOSSIER N'EST DÉPLACÉ, AUCUN DÉPÔT N'EST FUSIONNÉ. Réunir ne touche
 * qu'aux fiches des projets ; séparer les rend tels qu'ils étaient.
 */

import fs from 'node:fs';
import path from 'node:path';

import {
  brancheDeLaCarte,
  Card,
  colonneDeLaTeteDeSuite,
  ComprehensionDeCarte,
  etapeAEnchainer,
  etapesALiberer,
  DOSSIER_DES_REGROUPEMENTS,
  Project,
  briefingDeLaFille,
  colonneDeLaMere,
  consigneDeLaFille,
  estUnRegroupement,
  etatDeLaFille,
  memeSuiviDesFilles,
  membresDuRegroupement,
  phraseDeLaMere,
  planDeConversionDesDepots,
  projetsTouchesParLaCarte,
  refusDeLancementDeLaMere,
  refusDeRegroupement,
  type SuiviDUneFille,
} from '@beluga/shared';

import { bus } from './bus.js';
import { CONFIG } from './config.js';
import { rangerLaCarte } from './deplacement-carte.js';
import { log } from './logger.js';
import * as store from './store.js';

/* ------------------------------------------------------------------ */
/* Réunir, renommer, compléter, retirer, séparer                        */
/* ------------------------------------------------------------------ */

function diffuser(projets: readonly Project[]): void {
  for (const project of projets) bus.emit({ type: 'project.upsert', project });
}

/** Le dossier de rangement d'un regroupement : il n'a pas de dépôt, mais un projet a toujours un dossier. */
function dossierDuRegroupement(id: string): string {
  const dossier = path.join(CONFIG.dataDir, DOSSIER_DES_REGROUPEMENTS, id);
  fs.mkdirSync(dossier, { recursive: true });
  return dossier;
}

/** Une carte mère de ce regroupement a-t-elle encore une fille en route ? */
function travailEnRoute(regroupementId: string, projetId?: string): Card | undefined {
  return store
    .listCards(regroupementId)
    .filter((c) => c.column === 'running' && c.cartesFilles?.length)
    .find((mere) =>
      (mere.cartesFilles ?? []).some((f) => {
        if (projetId && f.projectId !== projetId) return false;
        const fille = store.getCard(f.cardId);
        return !!fille && (fille.column === 'planned' || fille.column === 'running');
      }),
    );
}

/**
 * RÉUNIR DES PROJETS SOUS UN NOM COMMUN.
 *
 * Le regroupement prend la place du premier membre dans la colonne de gauche —
 * son rang et son groupe de rangement —, pour qu'on le retrouve là où l'on
 * rangeait déjà ses projets.
 */
export function creerRegroupement(nom: string, membres: readonly string[]): Project {
  const projets = store.listProjects(true);
  const refus = refusDeRegroupement({ nom, membres }, projets);
  if (refus) throw new Error(refus);
  const premiers = membres.map((id) => projets.find((p) => p.id === id)!);
  const tete = [...premiers].sort((a, b) => (a.rank ?? 1000) - (b.rank ?? 1000))[0];
  const id = store.newId();
  const regroupement = store.saveProject(
    Project.parse({
      id,
      name: nom.trim(),
      path: dossierDuRegroupement(id),
      regroupement: true,
      defaultEngine: tete.defaultEngine,
      defaultModel: tete.defaultModel,
      rank: tete.rank,
      groupId: tete.groupId,
      createdAt: store.now(),
      updatedAt: store.now(),
    }),
  );
  const ecrits = premiers.map((p) => store.saveProject({ ...p, regroupementId: id }));
  diffuser([regroupement, ...ecrits]);
  log.info(`projets réunis sous « ${regroupement.name} » : ${premiers.map((p) => p.name).join(', ')}`);
  return regroupement;
}

function regroupementOuErreur(id: string): Project {
  const regroupement = store.getProject(id);
  if (!regroupement || !estUnRegroupement(regroupement)) throw new Error('Ce projet réuni n’existe plus.');
  return regroupement;
}

export function renommerRegroupement(id: string, nom: string): Project {
  const regroupement = regroupementOuErreur(id);
  if (!nom.trim()) throw new Error('Donnez un nom au projet réuni.');
  const ecrit = store.saveProject({ ...regroupement, name: nom.trim() });
  diffuser([ecrit]);
  return ecrit;
}

export function ajouterAuRegroupement(id: string, membres: readonly string[]): Project[] {
  regroupementOuErreur(id);
  const projets = store.listProjects(true);
  const refus = refusDeRegroupement({ membres, regroupementId: id }, projets);
  if (refus) throw new Error(refus);
  const ecrits = membres.map((m) => store.saveProject({ ...projets.find((p) => p.id === m)!, regroupementId: id }));
  diffuser(ecrits);
  return ecrits;
}

/** Retirer un projet d'un regroupement. Il en resterait un seul ? Il faut séparer. */
export function retirerDuRegroupement(id: string, projetId: string): Project {
  regroupementOuErreur(id);
  const membres = membresDuRegroupement(store.listProjects(true), id);
  const projet = membres.find((p) => p.id === projetId);
  if (!projet) throw new Error('Ce projet ne fait pas partie de ce regroupement.');
  if (membres.length <= 2) throw new Error('Il ne resterait qu’un seul projet : séparez plutôt le regroupement.');
  const enRoute = travailEnRoute(id, projetId);
  if (enRoute) throw new Error(`La carte « ${enRoute.title} » travaille encore sur « ${projet.name} » : attendez qu’elle ait rendu.`);
  const ecrit = store.saveProject({ ...projet, regroupementId: undefined });
  diffuser([ecrit]);
  return ecrit;
}

/**
 * SÉPARER : chaque membre redevient un projet autonome, et le tableau commun
 * est MIS DE CÔTÉ — jamais effacé : ses cartes mères gardent l'historique de ce
 * qui a été demandé à l'ensemble. Les cartes filles restent dans leur projet.
 */
export function separerLeRegroupement(id: string): Project[] {
  const regroupement = regroupementOuErreur(id);
  const enRoute = travailEnRoute(id);
  if (enRoute) throw new Error(`La carte « ${enRoute.title} » travaille encore : attendez qu’elle ait rendu avant de séparer.`);
  const membres = membresDuRegroupement(store.listProjects(true), id).map((p) =>
    store.saveProject({ ...p, regroupementId: undefined, groupId: p.groupId ?? regroupement.groupId }),
  );
  const range = store.saveProject({ ...regroupement, archived: true });
  diffuser([...membres, range]);
  log.info(`regroupement « ${regroupement.name} » séparé`);
  return [...membres, range];
}

/* ------------------------------------------------------------------ */
/* La carte mère : elle pose ses filles, elle ne travaille pas           */
/* ------------------------------------------------------------------ */

/**
 * LE CADRAGE D'UNE CARTE D'UN PROJET RÉUNI DOIT NOMMER LES PROJETS TOUCHÉS.
 * Rend la raison du refus, ou `null` — toujours `null` sur un projet ordinaire.
 */
export function refusDesProjetsTouches(projectId: string, touches: readonly string[] | undefined): string | null {
  const projet = store.getProject(projectId);
  if (!estUnRegroupement(projet)) return null;
  const membres = membresDuRegroupement(store.listProjects(true), projectId);
  const noms = membres.map((m) => `« ${m.name} »`).join(', ');
  const { projets, inconnus } = projetsTouchesParLaCarte(touches, membres);
  if (inconnus.length) {
    return `Ces projets ne font pas partie de « ${projet!.name} » : ${inconnus.join(', ')}. Les membres sont ${noms}. Rien n’a été enregistré ; rends la compréhension de nouveau.`;
  }
  if (!projets.length) {
    return `Cette carte appartient au projet réuni « ${projet!.name} » : dis dans « projetsTouches » quels projets ce travail modifie, parmi ${noms}. En cas de doute sur l’un d’eux, pose la question avec « ask_user » avant. Rien n’a été enregistré.`;
  }
  return null;
}

/**
 * CE QUE LE CADRAGE D'UN PROJET RÉUNI DOIT SAVOIR : les membres, leurs
 * dossiers, et la règle des projets touchés. Vide sur un projet ordinaire.
 */
export function consigneDuCadrageReuni(projectId: string): string {
  const projet = store.getProject(projectId);
  if (!estUnRegroupement(projet)) return '';
  const membres = membresDuRegroupement(store.listProjects(true), projectId);
  return [
    `PROJET RÉUNI : « ${projet!.name} » réunit ${membres.length} projets, chacun dans SON dépôt :`,
    ...membres.map((m) => `- « ${m.name} » : ${m.path}`),
    'Lis dans ces dossiers ce qu’il faut pour comprendre. Chaque projet touché recevra au lancement SA carte, dans SON dépôt et sur SA branche — jamais une branche commune.',
    'Ta compréhension DOIT nommer ces projets dans « projetsTouches ». Si tu doutes qu’un projet soit concerné, pose la question avec « ask_user ».',
  ].join('\n');
}

/**
 * LANCER UNE CARTE MÈRE.
 *
 * Elle ne lance AUCUN agent et ne consomme aucun quota : elle pose une carte
 * fille dans chaque projet touché — compréhension validée recopiée, consigne
 * de ne toucher qu'à son projet —, lance chacune, puis passe en « Travail »
 * pour les suivre. Chaque fille suit ensuite le parcours ordinaire : sa
 * branche « tache/… » dans SON dépôt, sa copie de travail, sa publication.
 */
export async function lancerLaCarteMere(
  mere: Card,
  regroupement: Project,
  lancer: (cardId: string) => Promise<{ ok: boolean; error?: string }>,
): Promise<{ ok: boolean; error?: string }> {
  if (mere.cartesFilles?.length) return { ok: true };
  const comprise = mere.parcours?.comprehension;
  if (!comprise?.texte?.trim()) {
    return { ok: false, error: 'Cette carte n’a pas encore de compréhension : discutez-la avant de la lancer.' };
  }
  const membres = membresDuRegroupement(store.listProjects(true), regroupement.id);
  const refus = refusDeLancementDeLaMere(comprise.projetsTouches, membres);
  if (refus) {
    const ecrite = store.saveCard({
      ...mere,
      scheduling: { ...(mere.scheduling ?? { asap: false, attempts: 0, restarts: 0 }), waitingReason: refus },
    });
    bus.emit({ type: 'card.upsert', card: ecrite });
    return { ok: false, error: refus };
  }
  const touches = projetsTouchesParLaCarte(comprise.projetsTouches, membres).projets;
  const maintenant = store.now();
  const filles = touches.map((projet) => {
    const autres = touches.filter((p) => p.id !== projet.id).map((p) => p.name);
    const fille = store.saveCard(
      Card.parse({
        id: store.newId(),
        projectId: projet.id,
        title: mere.title,
        description: mere.description,
        labels: mere.labels,
        attachments: mere.attachments,
        column: 'planned',
        position: store.nextPosition(projet.id, 'planned'),
        origin: 'user',
        run: mere.run,
        analyseDemandee: true,
        briefing: briefingDeLaFille(consigneDeLaFille(projet, mere, autres), comprise),
        carteMereId: mere.id,
        parcours: {
          plans: mere.parcours?.plans ?? [],
          comprehension: ComprehensionDeCarte.parse({ ...comprise }),
          comprehensionValidee: {
            at: maintenant,
            comprehensionAt: comprise.at,
            niveau: mere.parcours?.comprehensionValidee?.niveau,
          },
        },
        scheduling: { asap: false, attempts: 0, restarts: 0 },
        excludedFromDeploy: false,
        createdAt: maintenant,
        updatedAt: maintenant,
      }),
    );
    bus.emit({ type: 'card.upsert', card: fille });
    return fille;
  });
  const lancee = store.saveCard({
    ...(store.getCard(mere.id) ?? mere),
    column: 'running',
    position: mere.column === 'running' ? mere.position : store.nextPosition(mere.projectId, 'running'),
    analyseDemandee: true,
    cartesFilles: filles.map((f) => ({ projectId: f.projectId, cardId: f.id })),
    scheduling: {
      ...(mere.scheduling ?? { asap: false, attempts: 0, restarts: 0 }),
      waitingReason: undefined,
      tourEnVolDepuis: undefined,
      suspendu: false,
    },
  });
  bus.emit({ type: 'card.upsert', card: lancee });
  log.info(`carte mère « ${mere.title} » : ${filles.length} carte(s) posée(s) — ${touches.map((p) => p.name).join(', ')}`);
  /* Chaque fille part par le chemin ordinaire ; un refus (quota, place)
     reste écrit sur SA carte, et la reprise la relancera d'elle-même. */
  for (const fille of filles) {
    void lancer(fille.id).catch((err) => log.warn(`carte fille ${fille.id} : lancement impossible`, err));
  }
  return { ok: true };
}

/** Le relevé de chaque fille d'une mère, tel qu'elle l'affiche. */
function releverLesFilles(mere: Card): { suivi: SuiviDUneFille[]; colonnes: { column: string }[] } {
  const suivi: SuiviDUneFille[] = [];
  const colonnes: { column: string }[] = [];
  for (const f of mere.cartesFilles ?? []) {
    const carte = store.getCard(f.cardId);
    if (!carte) continue;
    colonnes.push({ column: carte.column });
    suivi.push(
      etatDeLaFille({
        carte,
        agent: store.getAgentByCard(carte.id),
        projet: store.getProject(f.projectId)?.name ?? '?',
      }),
    );
  }
  return { suivi, colonnes };
}

/**
 * LA MÈRE SUIT SES FILLES. Appelé à chaque carte ou agent qui bouge : seule une
 * fille (ou l'agent d'une fille) déclenche quelque chose.
 *
 * Deux choses s'écrivent sur la mère, et SEULEMENT quand elles changent — un
 * tour vivant émet des dizaines d'événements, la mère ne se réécrit pas à
 * chacun :
 *  - le RELEVÉ de chaque fille (`suiviDesFilles`), qui fait le fil de la mère ;
 *  - sa COLONNE : « Travail » tant qu'une fille est en route, puis « Archivé »
 *    directement, avec une phrase qui ne parle jamais de déploiement.
 */
export function suivreLaMere(fille: Card): void {
  if (!fille.carteMereId) return;
  const mere = store.getCard(fille.carteMereId);
  if (!mere?.cartesFilles?.length) return;
  if (mere.teteDeSuite) return suivreLaSuite(mere);
  const { suivi, colonnes } = releverLesFilles(mere);
  const colonne = colonneDeLaMere(colonnes);
  const bouge = !!colonne && colonne !== mere.column;
  const rangee = colonne === 'archived';
  const phrase = rangee ? phraseDeLaMere(suivi) : undefined;
  if (!bouge && memeSuiviDesFilles(suivi, mere.suiviDesFilles) && (!rangee || phrase === mere.sansModification)) return;
  const ecrite = store.saveCard({
    ...mere,
    suiviDesFilles: suivi,
    ...(bouge ? { column: colonne!, position: store.nextPosition(mere.projectId, colonne!) } : {}),
    ...(rangee
      ? {
          doneAt: mere.doneAt ?? store.now(),
          archivedAt: mere.archivedAt ?? store.now(),
          sansModification: phrase,
        }
      : bouge
        ? /* Une fille rouverte remet la mère au travail : la phrase de rangement ne vaut plus. */
          { sansModification: undefined }
        : {}),
  });
  bus.emit({ type: 'card.upsert', card: ecrite });
}

/* ------------------------------------------------------------------ */
/* Les suites d'étapes : une étape après l'autre, groupées jusqu'au bout */
/* ------------------------------------------------------------------ */

type Lanceur = (cardId: string) => Promise<{ ok: boolean; error?: string }>;

/**
 * LE CHEMIN DE LANCEMENT ORDINAIRE (`startCard`), confié par le démarrage du
 * démon (`veillerSurLesMeres`) ou par le premier lancement d'une suite : ce
 * module ne peut pas importer l'ordonnanceur, qui l'importe déjà.
 */
let lancerUneEtape: Lanceur | null = null;

/**
 * LANCER UNE SUITE D'ÉTAPES (`shared/src/suite-de-cartes.ts`).
 *
 * Comme une mère de projet réuni, la carte globale ne lance AUCUN agent et ne
 * consomme aucun quota : elle passe en « En cours » et lance sa PREMIÈRE étape,
 * par le chemin ordinaire. Ce clic vaut autorisation pour toute la suite :
 * chaque étape suivante partira seule quand la précédente aura rendu son
 * travail (`suivreLaSuite`). Les étapes existent déjà, posées à la validation
 * de la proposition.
 */
export async function lancerLaSuite(mere: Card, lancer: Lanceur): Promise<{ ok: boolean; error?: string }> {
  if (!mere.cartesFilles?.length) return { ok: false, error: 'Cette suite n’a aucune étape à lancer.' };
  lancerUneEtape ??= lancer;
  const fraiche = store.getCard(mere.id) ?? mere;
  const lancee =
    fraiche.column === 'running'
      ? fraiche
      : store.saveCard({
          ...fraiche,
          column: 'running',
          position: store.nextPosition(fraiche.projectId, 'running'),
          scheduling: {
            ...(fraiche.scheduling ?? { asap: false, attempts: 0, restarts: 0 }),
            waitingReason: undefined,
            tourEnVolDepuis: undefined,
            suspendu: false,
          },
        });
  if (lancee !== fraiche) bus.emit({ type: 'card.upsert', card: lancee });
  log.info(`suite « ${mere.title} » lancée : ${mere.cartesFilles.length} étape(s), une à une`);
  suivreLaSuite(lancee, lancer);
  return { ok: true };
}

/**
 * LA CARTE GLOBALE SUIT SES ÉTAPES. Appelé à chaque mouvement d'une étape ou de
 * son agent. Trois gestes, dans cet ordre, et chacun seulement s'il y a lieu :
 *
 *  1. LIBÉRER : quand la dernière étape a fini, les étapes retenues dans le
 *     groupe passent TOUTES ENSEMBLE en « À déployer » ;
 *  2. RANGER la carte globale (`colonneDeLaTeteDeSuite`) et réécrire son relevé
 *     quand il change ;
 *  3. ENCHAÎNER : la première étape non finie, encore jamais lancée, part —
 *     depuis la branche de l'étape d'avant, pour en voir le code. Une étape
 *     bloquée (question, panne) ou au travail ne laisse rien partir.
 *
 * Toutes les écritures précèdent toutes les diffusions : chaque diffusion
 * rappelle ce suivi (garde `carteMereId`), et il doit alors trouver un état
 * déjà cohérent — jamais une étape libérée deux fois, ni lancée deux fois
 * (`departDeLaSuiteAt` est posé AVANT le lancement).
 */
function suivreLaSuite(mere: Card, lancer: Lanceur | null = lancerUneEtape): void {
  const filles = (mere.cartesFilles ?? [])
    .map((f) => store.getCard(f.cardId))
    .filter((carte): carte is Card => !!carte);
  let { suivi } = releverLesFilles(mere);

  const liberees = etapesALiberer(filles, suivi).map((etape) => rangerLaCarte({ ...etape, etapeFinieAt: undefined }, 'to_deploy'));
  if (liberees.length) ({ suivi } = releverLesFilles(mere));

  const colonne = colonneDeLaTeteDeSuite(
    mere.column,
    suivi.map((f) => ({ column: f.colonne, etat: f.etat })),
  );
  const bouge = !!colonne && colonne !== mere.column;
  let ecrite: Card | null = null;
  if (bouge || !memeSuiviDesFilles(suivi, mere.suiviDesFilles)) {
    const maintenant = store.now();
    ecrite = store.saveCard({
      ...mere,
      suiviDesFilles: suivi,
      ...(bouge
        ? {
            column: colonne!,
            position: store.nextPosition(mere.projectId, colonne!),
            ...(colonne === 'running' ? { doneAt: undefined, archivedAt: undefined } : {}),
            ...(colonne === 'to_deploy' ? { doneAt: mere.doneAt ?? maintenant } : {}),
            ...(colonne === 'archived' ? { doneAt: mere.doneAt ?? maintenant, archivedAt: mere.archivedAt ?? maintenant } : {}),
          }
        : {}),
    });
  }

  let lancee: Card | null = null;
  if ((ecrite ?? mere).column === 'running' && lancer) {
    const aLancer = etapeAEnchainer(
      filles.map((fille, index) => ({
        cardId: fille.id,
        rang: fille.rangDansLaSuite ?? index + 1,
        column: fille.column,
        etat: suivi.find((f) => f.cardId === fille.id)?.etat ?? 'attente',
        departDeLaSuiteAt: fille.departDeLaSuiteAt,
      })),
    );
    const etape = aLancer ? filles.find((f) => f.id === aLancer) : undefined;
    if (etape) {
      const rang = etape.rangDansLaSuite ?? filles.indexOf(etape) + 1;
      const precedente = filles.find((f) => (f.rangDansLaSuite ?? filles.indexOf(f) + 1) === rang - 1);
      lancee = store.saveCard({
        ...etape,
        departDeLaSuiteAt: store.now(),
        /* L'ÉTAPE PART DU CODE DE LA PRÉCÉDENTE : sa branche n'est fusionnée
           qu'au déploiement. Une branche absente du dépôt (étape sans code)
           retombe sur la branche de déploiement (`ouvrirDossierDeCarte`). */
        ...(precedente && !etape.brancheChoisie ? { brancheDeDepart: brancheDeLaCarte(precedente) } : {}),
      });
    }
  }

  if (ecrite) bus.emit({ type: 'card.upsert', card: ecrite });
  for (const etape of liberees) bus.emit({ type: 'card.upsert', card: etape });
  if (lancee && lancer) {
    bus.emit({ type: 'card.upsert', card: lancee });
    log.info(`suite « ${mere.title} » : l’étape ${lancee.rangDansLaSuite ?? '?'} « ${lancee.title} » part`);
    const id = lancee.id;
    void lancer(id).catch((err) => log.warn(`étape ${id} de la suite « ${mere.title} » : lancement impossible`, err));
  }
}

/**
 * LES MÈRES SE RELISENT AU DÉMARRAGE : une mère rangée avant le suivi n'a pas
 * de relevé, et porte encore l'ancienne phrase « prêt à déployer dans … ».
 * Les suites ouvertes aussi : une étape finie pendant l'arrêt du démon doit
 * encore lancer la suivante, ou libérer le groupe.
 */
export function rafraichirLesMeres(): void {
  for (const projet of store.listProjects(true)) {
    if (!estUnRegroupement(projet)) continue;
    for (const mere of store.listCards(projet.id)) {
      const premiere = mere.cartesFilles?.[0] && store.getCard(mere.cartesFilles[0].cardId);
      if (premiere) suivreLaMere(premiere);
    }
  }
  for (const tete of store.tetesDeSuiteOuvertes()) suivreLaSuite(tete);
}

/** La carte globale d'une suite relit ses étapes : appelé à la validation, pour qu'elle les montre tout de suite. */
export function releverLaSuite(mere: Card): void {
  if (mere.teteDeSuite) suivreLaSuite(mere);
}

/** Branche le suivi des mères. Rend la fonction qui le débranche. */
export function veillerSurLesMeres(lancer?: Lanceur): () => void {
  if (lancer) lancerUneEtape = lancer;
  return bus.subscribe((event) => {
    try {
      /* LA GARDE `carteMereId` ÉVITE LA BOUCLE : l'écriture de la mère émet son
         propre `card.upsert`, qui ne porte pas de mère et n'est donc pas suivi. */
      if (event.type === 'card.upsert' && event.card.carteMereId) suivreLaMere(event.card);
      /* L'AGENT D'UNE FILLE BOUGE SANS QUE SA CARTE BOUGE : sa ligne de tâche
         en cours, sa question, sa panne. */
      if (event.type === 'agent.upsert' && event.agent.cardId && event.agent.role === 'task') {
        const carte = store.getCard(event.agent.cardId);
        if (carte?.carteMereId) suivreLaMere(carte);
      }
    } catch (err) {
      log.warn('suivi d’une carte mère', err);
    }
  });
}

/* ------------------------------------------------------------------ */
/* La conversion des anciens dépôts annexes                             */
/* ------------------------------------------------------------------ */

/**
 * LES PROJETS À DÉPÔTS ANNEXES DEVIENNENT DES REGROUPEMENTS — une fois, au
 * démarrage, par le démon qui connaît les deux formes (un démon plus ancien
 * effacerait les champs qu'il ne connaît pas, MEM-2825).
 *
 * Refusée — et retentée au démarrage suivant — tant qu'une carte du projet est
 * en travail ou attend d'être déployée : sa branche vit peut-être aussi dans un
 * dépôt annexe, et la publication du projet seul ne l'emporterait plus.
 */
export function convertirLesDepotsAnnexes(): void {
  const tous = store.listProjects(true);
  for (const projet of tous) {
    const plan = planDeConversionDesDepots(projet, tous);
    if (!plan) continue;
    const enCours = store
      .listCards(projet.id)
      .find((c) => c.column === 'running' || c.column === 'to_deploy');
    if (enCours) {
      log.info(`conversion de « ${projet.name} » en projet réuni reportée : la carte « ${enCours.title} » n’est pas rangée`);
      continue;
    }
    const membres: Project[] = [];
    for (const annexe of plan.annexes) {
      const reglages = {
        path: annexe.depot.path,
        gitRemote: annexe.depot.gitRemote,
        branchesDePublication: annexe.depot.branchesDePublication,
        deploiement: annexe.depot.deploiement,
        miseEnProduction: annexe.depot.miseEnProduction,
        devUrl: annexe.depot.devUrl,
        port: annexe.depot.port,
      };
      const existant = annexe.existant ? store.getProject(annexe.existant) : null;
      membres.push(
        store.saveProject(
          existant
            ? { ...existant, ...reglages, archived: false }
            : Project.parse({
                id: store.newId(),
                name: annexe.nom,
                ...reglages,
                defaultEngine: projet.defaultEngine,
                rank: (projet.rank ?? 1000) + 1,
                groupId: projet.groupId,
                createdAt: store.now(),
                updatedAt: store.now(),
              }),
        ),
      );
    }
    const principal = store.saveProject({ ...projet, depots: [] });
    const regroupement = creerRegroupement(plan.nomDuRegroupement, [principal.id, ...membres.map((m) => m.id)]);
    log.info(
      `« ${projet.name} » converti en projet réuni « ${regroupement.name} » : ${plan.annexes.length} dépôt(s) annexe(s) devenu(s) projet(s)`,
    );
  }
}
