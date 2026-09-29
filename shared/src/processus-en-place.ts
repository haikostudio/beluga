/**
 * LE PROCESSUS EN PLACE, LU DANS LES RÉGLAGES DU PROJET — règles pures.
 *
 * Demande du 29/09/2026 : une fois qu'un agent de configuration a défini le
 * processus du déploiement ou de la mise en production, on doit le VOIR dans
 * la rubrique de son étape, pour juger s'il est bon et toujours à jour :
 * l'adresse visée, la branche, les étapes, la date d'écriture — et un signal
 * « à revérifier » quand un réglage a bougé depuis.
 *
 * Ni base, ni disque, ni date : l'écran et le serveur lisent les mêmes règles.
 */

import type { CiblePublication } from './etapes-publication.js';
import { servicesARelancer, type ProcessusDeProduction } from './publication-simple.js';

/** Ce que ces règles lisent d'un projet. */
export type ProjetPourLeProcessus = {
  isSelf?: boolean;
  devUrl?: string;
  port?: number;
  adresseProduction?: string;
  branchesDePublication?: { dev?: string; production?: string };
  deploiement?: { commande?: string; service?: string; processus?: ProcessusDeProduction; agentId?: string };
  miseEnProduction?: { processus?: ProcessusDeProduction; agentId?: string };
};

/** Le processus écrit pour cette étape, s'il y en a un. */
export function processusDeLEtape(
  projet: ProjetPourLeProcessus | undefined,
  cible: CiblePublication,
): ProcessusDeProduction | undefined {
  const processus = cible === 'dev' ? projet?.deploiement?.processus : projet?.miseEnProduction?.processus;
  return processus?.etapes?.length ? processus : undefined;
}

/**
 * LE PROCESSUS DE DÉPLOIEMENT QUI SERA RÉELLEMENT JOUÉ. Beluga Build garde son
 * déroulé propre, avec ses gardes de redémarrage (jamais sous une tâche ou une
 * publication) : son processus écrit se lit dans les réglages, mais il ne
 * remplace jamais ce déroulé.
 */
export function processusJoueAuDeploiement(projet: ProjetPourLeProcessus | undefined): ProcessusDeProduction | undefined {
  if (projet?.isSelf) return undefined;
  return processusDeLEtape(projet, 'dev');
}

/**
 * L'EMPREINTE DES RÉGLAGES QUI DÉCIDENT DU PROCESSUS, prise à son écriture.
 * Déploiement : adresse contrôlée, port, branche, commande, services.
 * Production : adresse publique, branche. Les valeurs sont celles SAISIES
 * (vide = défaut) : un défaut qui change ailleurs n'est pas un réglage du projet.
 */
export function empreinteDesReglages(projet: ProjetPourLeProcessus | undefined, cible: CiblePublication): string {
  const net = (v: unknown) => (v === undefined || v === null ? '' : String(v).trim());
  const champs =
    cible === 'dev'
      ? {
          adresse: net(projet?.devUrl),
          port: net(projet?.port),
          branche: net(projet?.branchesDePublication?.dev),
          commande: net(projet?.deploiement?.commande),
          services: servicesARelancer({ service: projet?.deploiement?.service }).join(' '),
        }
      : {
          adresse: net(projet?.adresseProduction),
          branche: net(projet?.branchesDePublication?.production),
        };
  return JSON.stringify(champs);
}

/** Les réglages qui ont changé depuis l'écriture du processus, par leur nom affichable. */
export type ReglageChange = 'adresse' | 'port' | 'branche' | 'commande' | 'services';

/**
 * LE PROCESSUS EST-IL À REVÉRIFIER ? Oui quand un réglage qui le décide a
 * changé depuis son écriture. Un processus d'avant cette règle n'a pas
 * d'empreinte : rien n'est signalé — on ne crie jamais au loup sans preuve.
 */
export function reglagesChangesDepuisLeProcessus(
  processus: Pick<ProcessusDeProduction, 'empreinte'> | undefined,
  projet: ProjetPourLeProcessus | undefined,
  cible: CiblePublication,
): ReglageChange[] {
  if (!processus?.empreinte) return [];
  let avant: Record<string, string>;
  try {
    avant = JSON.parse(processus.empreinte) as Record<string, string>;
  } catch {
    return [];
  }
  const maintenant = JSON.parse(empreinteDesReglages(projet, cible)) as Record<string, string>;
  return (Object.keys(maintenant) as ReglageChange[]).filter((cle) => (avant[cle] ?? '') !== maintenant[cle]);
}

/**
 * L'ADRESSE VISÉE : celle que l'agent a déclarée en écrivant le processus, et,
 * à défaut (processus d'avant, ou déroulé commun), celle des réglages —
 * l'adresse publique pour la production, l'adresse contrôlée pour le déploiement.
 */
export function adresseVisee(
  processus: Pick<ProcessusDeProduction, 'cible'> | undefined,
  projet: ProjetPourLeProcessus | undefined,
  cible: CiblePublication,
): { adresse?: string; declaree: boolean } {
  const declaree = processus?.cible?.trim();
  if (declaree) return { adresse: declaree, declaree: true };
  const reglee = (cible === 'dev' ? projet?.devUrl : projet?.adresseProduction)?.trim();
  return { adresse: reglee || undefined, declaree: false };
}

/**
 * CE QUE FAIT UNE ÉTAPE, pour choisir l'icône de son rond dans le flux du
 * processus. Deviné sur sa commande (et son libellé, faute de commande) :
 * aucune donnée nouvelle à demander à l'agent, et une étape inconnue reste une
 * simple « commande ».
 */
export type GenreDEtapeDuProcessus =
  | 'fusion'
  | 'envoi'
  | 'github'
  | 'construction'
  | 'installation'
  | 'service'
  | 'controle'
  | 'distant'
  | 'conteneur'
  | 'commande';

export function genreDeLEtape(etape: { commande?: string; libelle?: string; genre?: GenreDEtapeDuProcessus }): GenreDEtapeDuProcessus {
  if (etape.genre) return etape.genre;
  const c = ` ${(etape.commande ?? '').toLowerCase()} `;
  const l = (etape.libelle ?? '').toLowerCase();
  if (/\bgh (workflow|run|release|api)\b/.test(c)) return 'github';
  if (/\bcurl\b|\bwget\b|\bhealth|\bping\b/.test(c)) return 'controle';
  if (/\bsystemctl\b|\bservice\s+\S+\s+(restart|reload)|\bpm2\b/.test(c)) return 'service';
  if (/\bdocker\b|\bpodman\b|\bcompose\b/.test(c)) return 'conteneur';
  if (/\bssh\b|\brsync\b|\bscp\b|\blftp\b|\bsftp\b/.test(c)) return 'distant';
  if (/\bgit (merge|pull|rebase)\b/.test(c)) return 'fusion';
  if (/\bgit (push|commit)\b/.test(c)) return 'envoi';
  if (/\bnpm (ci|install)\b|\bpnpm install\b|\byarn install\b|\bcomposer install\b|\bpip install\b|\bcp\b|\binstall\b/.test(c)) return 'installation';
  if (/\bbuild\b|\bmake\b|\bvite\b|\bcompile|\btsc\b/.test(c)) return 'construction';
  if (!etape.commande) {
    if (/fusion/.test(l)) return 'fusion';
    if (/envoy|enregistr/.test(l)) return 'envoi';
    if (/constru/.test(l)) return 'construction';
    if (/install/.test(l)) return 'installation';
    if (/relanc|redémarr/.test(l)) return 'service';
    if (/vérifi|contrôl/.test(l)) return 'controle';
  }
  return 'commande';
}

/**
 * Une étape du déroulé commun, telle que la rubrique la montre : `libelle` et
 * `description` sont des textes à trous (`{branche}`, `{service}`,
 * `{adresse}`) que l'écran traduit PUIS remplit avec `valeurs` — une phrase
 * entière se traduit, jamais des morceaux.
 */
export type EtapeDuDerouleCommun = {
  libelle: string;
  description: string;
  valeurs?: Record<string, string>;
  commande?: string;
  genre: GenreDEtapeDuProcessus;
};

/**
 * LE DÉROULÉ COMMUN DU DÉPLOIEMENT, étape par étape, tant qu'aucun processus
 * n'est écrit : ce que `deploy.ts` joue réellement, dit pour la rubrique.
 */
export function etapesDuDerouleCommun(projet: ProjetPourLeProcessus | undefined, branche: string): EtapeDuDerouleCommun[] {
  const etapes: EtapeDuDerouleCommun[] = [
    {
      libelle: 'Fusionner les branches des cartes du lot dans « {branche} »',
      description: 'Le travail de chaque carte rejoint la branche de travail.',
      valeurs: { branche },
      genre: 'fusion',
    },
    { libelle: 'Enregistrer et envoyer sur le dépôt', description: 'La branche de travail est enregistrée puis envoyée sur le dépôt distant.', genre: 'envoi' },
  ];
  if (projet?.isSelf) {
    etapes.push(
      { libelle: 'Construire Beluga Build', description: 'L’application est reconstruite à partir du code fusionné.', commande: 'npm run build', genre: 'construction' },
      { libelle: 'Installer la version construite', description: 'La nouvelle version remplace celle qui est servie.', genre: 'installation' },
      { libelle: 'Redémarrer dès que plus rien ne tourne', description: 'Jamais pendant qu’une tâche ou une publication travaille.', genre: 'service' },
    );
    return etapes;
  }
  const commande = projet?.deploiement?.commande?.trim();
  if (commande) etapes.push({ libelle: 'Mettre à jour', description: 'La commande de mise à jour est lancée dans le dossier du projet.', commande, genre: 'construction' });
  for (const service of servicesARelancer({ service: projet?.deploiement?.service })) {
    etapes.push({
      libelle: 'Relancer le service {service} et attendre qu’il réponde',
      description: 'Le service redémarre, puis on attend que le port du projet réponde.',
      valeurs: { service },
      genre: 'service',
    });
  }
  const adresse = projet?.devUrl?.trim();
  if (adresse) {
    etapes.push({
      libelle: 'Vérifier que {adresse} répond',
      description: 'Sans réponse, le déploiement est déclaré en échec.',
      valeurs: { adresse },
      genre: 'controle',
    });
  }
  return etapes;
}

/**
 * UN ENREGISTREMENT DES RÉGLAGES NE TOUCHE JAMAIS AUX PROCESSUS NI AUX AGENTS.
 *
 * La fenêtre de réglages envoie `deploiement: { commande, service }` : fusionné
 * à plat, ce bloc REMPLAÇAIT le déploiement entier et effaçait le processus
 * écrit par son agent, et l'agent retenu avec lui. Les deux blocs de procédure
 * se fusionnent donc champ par champ : ce que le patch nomme change, le reste
 * demeure.
 */
export function fusionDesProcedures(
  courant: { deploiement?: object; miseEnProduction?: object },
  patch: Record<string, unknown>,
): { deploiement?: object; miseEnProduction?: object } {
  const fusion: { deploiement?: object; miseEnProduction?: object } = {};
  for (const champ of ['deploiement', 'miseEnProduction'] as const) {
    const recu = patch[champ];
    if (recu && typeof recu === 'object' && !Array.isArray(recu)) {
      fusion[champ] = { ...(courant[champ] ?? {}), ...(recu as object) };
    }
  }
  return fusion;
}
