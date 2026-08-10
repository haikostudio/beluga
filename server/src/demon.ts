import fs from 'node:fs';
import path from 'node:path';
import { EtatDemon, redemarrageNecessaire, suiteDuRedemarrage } from '@haikodev/shared';
import { ROOT } from './config.js';
import { bus } from './bus.js';
import { agentsActifs } from './runtime.js';
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
  const signature = `${etat.redemarrageNecessaire}:${etat.agentsEnCours}:${etat.redemarrageEnAttente}:${(etat.publications ?? []).join('|')}`;
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
 * Rejoue la règle : redémarre, reste en attente, ou ne fait rien. `ignorerAgents`
 * vaut pour le BOUTON, geste humain qui a déjà vu l'avertissement sur les agents
 * et passe outre — mais jamais outre une publication, qu'aucun avertissement ne
 * couvre.
 */
function evaluerRedemarrage(ignorerAgents: boolean): { ok: boolean; raison?: string; enAttente: boolean } {
  const suite = suiteDuRedemarrage(redemarrageEnAttente, {
    publications: publicationsEnCours(),
    agents: ignorerAgents ? 0 : agentsActifs().length,
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
 * Demande un redémarrage. S'il peut partir, il part ; sinon il est retenu et la
 * raison (nom du projet qui publie) est rendue à qui l'a demandé.
 */
export function demanderRedemarrage(opts?: { ignorerAgents?: boolean }): { ok: boolean; raison?: string; enAttente: boolean } {
  redemarrageEnAttente = true;
  return evaluerRedemarrage(opts?.ignorerAgents ?? false);
}

/**
 * À appeler quand une publication vient de se terminer : si un redémarrage
 * attendait, on rejoue la règle. Dès la DERNIÈRE publication finie, il part.
 */
export function appliquerRedemarrageEnAttente(): void {
  if (!redemarrageEnAttente) return;
  evaluerRedemarrage(false);
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
