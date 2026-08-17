import fs from 'node:fs';
import path from 'node:path';
import {
  EtatDemon,
  MESSAGE_REDEMARRAGE_FORCE,
  cheminDossierDeCarte,
  decisionSurSignalDArret,
  raisonSignalRetenu,
  redemarrageNecessaire,
  suiteDuRedemarrage,
} from '@haikodev/shared';
import { ROOT } from './config.js';
import { bus } from './bus.js';
import { agentsActifs, agentsActifsDetail } from './runtime.js';
import * as store from './store.js';
import { notify, viderLesGroupes } from './notify.js';
import { log } from './logger.js';

/**
 * L'état du démon lui-même : depuis quand il tourne, et si le code construit
 * qu'il devrait servir est plus récent que lui. C'est ce qui allume le petit
 * triangle sur le bouton de redémarrage.
 */

/** Le démarrage de CE processus, figé une fois pour toutes. */
const DEMARRE_A = Date.now();

/** Les dossiers construits dont dépend le démon en marche. */
const DOSSIERS_CONSTRUITS = [path.join(ROOT, 'server', 'dist'), path.join(ROOT, 'shared', 'dist')];

/** La date d'écriture la plus récente sous un dossier, sans le parcourir sans fin. */
function derniereEcriture(dossier: string, profondeur = 0): number {
  if (profondeur > 4) return 0;
  let derniere = 0;
  let entrees: fs.Dirent[];
  try {
    entrees = fs.readdirSync(dossier, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entree of entrees) {
    const complet = path.join(dossier, entree.name);
    try {
      if (entree.isDirectory()) {
        derniere = Math.max(derniere, derniereEcriture(complet, profondeur + 1));
      } else if (entree.name.endsWith('.js')) {
        derniere = Math.max(derniere, fs.statSync(complet).mtimeMs);
      }
    } catch {
      // Fichier disparu en cours de lecture : il ne dit rien de plus.
    }
  }
  return derniere;
}

/** Les noms des projets dont une publication tourne en ce moment. */
export function publicationsEnCours(): string[] {
  return store.runningDeploys().map((run) => store.getProject(run.projectId)?.name ?? 'un projet');
}

export function etatDemon(): EtatDemon & { redemarrageNecessaire: boolean } {
  const construitA = Math.max(...DOSSIERS_CONSTRUITS.map((d) => derniereEcriture(d)), 0) || undefined;
  const etat: EtatDemon = {
    demarreA: DEMARRE_A,
    construitA,
    agentsEnCours: agentsActifs().length,
    agentsDetail: agentsActifsDetail(),
    publications: publicationsEnCours(),
    redemarrageEnAttente,
  };
  return { ...etat, redemarrageNecessaire: redemarrageNecessaire(etat) };
}

/** Ce qui a déjà été annoncé aux navigateurs : on ne répète pas pour rien. */
let dernierEnvoi = '';

/** Diffuse l'état s'il a changé. Appelé au rythme du relevé de capacité. */
export function diffuserEtatDemon(force = false): void {
  const etat = etatDemon();
  const signature = `${etat.redemarrageNecessaire}:${etat.agentsEnCours}:${etat.redemarrageEnAttente}:${(etat.publications ?? []).join('|')}:${(etat.agentsDetail ?? []).join('|')}`;
  if (!force && signature === dernierEnvoi) return;
  dernierEnvoi = signature;
  bus.emit({ type: 'demon', etat });
}

/*
 * UN REDÉMARRAGE PEUT ÊTRE DEMANDÉ SANS PARTIR TOUT DE SUITE. Tant qu'une
 * publication tourne (celle de HaikoDev ou celle d'un autre projet), le
 * redémarrage attend : on ne coupe jamais un lot en plein vol. La demande est
 * RETENUE ici, et rejouée à chaque fin de publication jusqu'à ce qu'elle puisse
 * partir. Un seul mécanisme : la même règle pure sert le bouton et la fin de
 * publication.
 */
let redemarrageEnAttente = false;

/** Un redémarrage demandé attend-il la fin d'une publication ? */
export function redemarrageEstEnAttente(): boolean {
  return redemarrageEnAttente;
}

/**
 * Rejoue la règle : redémarre, reste en attente, ou ne fait rien. Ni un agent
 * au travail ni une publication en cours ne se laissent contourner par le
 * chemin ORDINAIRE : passer outre couperait un travail en plein vol.
 *
 * Une seule sortie, et elle se réclame en toutes lettres : `force`, posé par le
 * second bouton de la fenêtre du redémarrage, après que celle-ci a nommé ce qui
 * sera interrompu. C'est le geste de dernier recours du jour où plus rien
 * n'avance — sans lui, il fallait ouvrir un terminal.
 */
function evaluerRedemarrage(force = false): { ok: boolean; raison?: string; enAttente: boolean } {
  const suite = suiteDuRedemarrage(redemarrageEnAttente, {
    publications: publicationsEnCours(),
    agents: agentsActifs().length,
    agentsDetail: agentsActifsDetail(),
    force,
  });
  redemarrageEnAttente = suite.enAttente;
  if (suite.redemarrer) {
    redemarrerDemon();
    return { ok: true, enAttente: false };
  }
  diffuserEtatDemon();
  return { ok: false, raison: suite.raison, enAttente: suite.enAttente };
}

/**
 * Demande un redémarrage. S'il peut partir, il part ; sinon il est retenu — le
 * bouton passe alors sur « Redémarrage requis » — et la raison (agent au
 * travail ou nom du projet qui publie) est rendue à qui l'a demandé.
 *
 * FORCÉ, il passe outre — mais jamais brutalement : le travail déjà écrit dans
 * chaque copie de carte est ENREGISTRÉ sur sa branche, puis tous les agents sont
 * arrêtés en force (moteur coupé, achevé s'il fait la sourde oreille,
 * descendance emportée), et seulement ensuite le serveur repart. C'est le geste
 * de dernier recours quand plus rien n'avance : sans lui, il fallait ouvrir un
 * terminal.
 */
export async function demanderRedemarrage(options: { force?: boolean } = {}): Promise<{
  ok: boolean;
  raison?: string;
  enAttente: boolean;
  force?: boolean;
}> {
  redemarrageEnAttente = true;
  if (!options.force) return evaluerRedemarrage();

  log.warn('redémarrage FORCÉ demandé : tout ce qui tourne va être coupé');
  await sauverPuisToutArreter();
  const issue = evaluerRedemarrage(true);
  return { ...issue, force: true };
}

/**
 * AVANT DE COUPER, ON SAUVE — PUIS ON COUPE POUR DE BON.
 *
 * Deux gestes, dans cet ordre, et l'ordre compte. Le travail écrit par un agent
 * vit dans la copie de sa carte : tant qu'il n'est pas enregistré sur la
 * branche, il n'est visible nulle part et ne partira jamais au déploiement. On
 * l'enregistre donc d'office, carte par carte, sous son propre filet — une copie
 * qui refuse ne doit pas retenir le redémarrage que l'utilisateur vient de
 * réclamer. Ensuite seulement, les moteurs tombent.
 */
async function sauverPuisToutArreter(): Promise<void> {
  const runtime = await import('./runtime.js');
  const dossierDeCarte = await import('./dossier-de-carte.js');

  for (const agentId of runtime.agentsActifs()) {
    const agent = store.getAgent(agentId);
    if (!agent?.cardId) continue;
    const carte = store.getCard(agent.cardId);
    const projet = carte ? store.getProject(carte.projectId) : undefined;
    if (!carte || !projet) continue;
    try {
      const dossier = cheminDossierDeCarte(projet.path, carte.title, carte.id);
      const enregistre = await dossierDeCarte.enregistrerLeTravailEnCours(dossier);
      if (enregistre) log.info(`travail de la carte « ${carte.title} » enregistré avant le redémarrage forcé`);
    } catch (err) {
      log.warn(`travail de la carte « ${carte.title} » impossible à enregistrer avant le redémarrage forcé`, err);
    }
  }

  const arretes = runtime.stopAllAgents();
  /*
   * Puis on repasse derrière SANS RIEN DEMANDER. Le geste ordinaire envoie un
   * signal et programme le coup de grâce quelques instants plus tard — mais
   * nous, nous n'existerons plus dans quelques instants : le minuteur mourrait
   * avec le processus et laisserait un moteur récalcitrant orphelin sur la
   * machine. Chaque moteur encore inscrit est donc achevé par son NUMÉRO EXACT.
   */
  const acheves = runtime.acheverTousLesMoteurs();
  log.warn(
    `redémarrage forcé : ${arretes.length} agent(s) coupé(s) — ${arretes.map((a) => a.geste).join(', ') || 'aucun'} ; ${acheves} processus achevé(s)`,
  );
  bus.toast('warning', MESSAGE_REDEMARRAGE_FORCE);
}

/**
 * À appeler quand une publication ou un agent vient de se terminer : si un
 * redémarrage attendait, on rejoue la règle. Dès le DERNIER travail fini, il
 * part tout seul.
 */
export function appliquerRedemarrageEnAttente(): void {
  if (!redemarrageEnAttente) return;
  evaluerRedemarrage();
}

/**
 * UN SIGNAL D'ARRÊT REÇU DU DEHORS (SIGTERM, SIGINT) passe par la même règle
 * que le bouton. Rend `true` s'il faut vraiment s'arrêter, `false` si l'arrêt
 * est RETENU parce qu'une publication ou un agent travaille — il repartira
 * alors tout seul par `appliquerRedemarrageEnAttente()`, dès le dernier travail
 * fini, exactement comme un redémarrage demandé au bouton.
 *
 * Le cas réel : un agent qui fait le ménage de ses processus d'essai avec
 * `pkill -f "server/dist/main.js"` frappe aussi le démon de production. Le
 * signal ne disait rien à personne et coupait tout ; il est maintenant refusé
 * tant qu'il reste du travail en vol.
 */
export function arretParSignal(signal: string): boolean {
  const decision = decisionSurSignalDArret({
    publications: publicationsEnCours(),
    agents: agentsActifs().length,
    agentsDetail: agentsActifsDetail(),
  });
  if (decision.arreter) return true;
  redemarrageEnAttente = true;
  log.warn(raisonSignalRetenu(signal, decision.raison));
  bus.toast(
    'warning',
    `Un arrêt du serveur a été demandé de l’extérieur : il attend la fin du travail en cours. ${decision.raison ?? ''}`.trim(),
  );
  diffuserEtatDemon(true);
  return false;
}

/**
 * L'arrêt volontaire. Le service est déclaré `Restart=always` : quitter, c'est
 * repartir cinq secondes plus tard avec le code construit. On laisse le temps
 * à la réponse de partir, sinon le navigateur croit à une coupure.
 */
export function redemarrerDemon(): void {
  log.info('redémarrage demandé depuis l’interface');
  bus.toast('info', 'Le serveur redémarre — l’application se reconnectera toute seule.');
  /*
   * Le redémarrage coupe tout pendant quelques secondes : le dire évite de
   * croire à une panne, et prévient qui n'était pas devant l'écran. Le groupe
   * de quatre secondes est vidé TOUT DE SUITE — sinon le processus s'arrête
   * avant que l'alerte ne soit partie — avec un plafond de deux secondes pour
   * qu'un appareil injoignable ne retienne pas le serveur.
   */
  notify({
    motif: 'redemarrage-serveur',
    title: 'Le serveur redémarre',
    body: 'L’application se reconnectera toute seule dans quelques secondes.',
    reference: `redemarrage:${DEMARRE_A}`,
    element: 'Redémarrage du serveur',
  });
  const parti = Promise.race([
    viderLesGroupes(),
    new Promise<void>((resolve) => setTimeout(resolve, 2000)),
  ]);
  void parti.finally(() => setTimeout(() => process.exit(0), 400));
}
