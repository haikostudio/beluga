/**
 * LES DÉCROCHAGES DU SERVEUR — le travail réel (règles : `shared/src/decrochages-serveur.ts`).
 *
 * Le SURVEILLANT (`scripts/beluga-watchdog.sh`, root, chaque minute) écrit un
 * relevé de la machine à chaque silence et une ligne dans
 * `data/logs/decrochages/journal.tsv`. Le DÉMON, ici :
 *  1. note ses propres arrêts VOULUS et ses démarrages dans ce même journal,
 *     pour qu'une mise en ligne ne passe jamais pour une panne ;
 *  2. réinstalle le surveillant dans `/usr/local/bin` quand la copie du dépôt a
 *     changé — donc à la mise en ligne, jamais avant ;
 *  3. lit, au démarrage puis toutes les dix minutes, le journal, les coupures
 *     vues par le navigateur et ses propres relances, et ouvre UNE carte
 *     d'enquête quand les décrochages se répètent.
 *
 * LA CARTE SUIT LE CHEMIN DU DÉPANNAGE DES SITES (`depannage-site.ts`) :
 * `createCard` dans « Demande », `ouvrirLeCadrage`, un tour d'enquête, puis la
 * demande du plan — et RIEN de plus. Le plan attend le clic de l'utilisateur.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import {
  LABEL_DECROCHAGE_SERVEUR,
  TITRE_ENQUETE_DECROCHAGES,
  type EtatDeLEnquete,
  type GenreDuJournalDesDecrochages,
  arretsVoulusDuJournalDuDemon,
  coupureSubieDuNavigateur,
  decisionDEnquete,
  demandeDEnqueteDecrochages,
  descriptionDEnqueteDecrochages,
  incidentsDeDecrochage,
  incidentsNonSignales,
  ligneDesDecrochages,
  lireLigneDesDecrochages,
  noteDeNouveauxDecrochages,
} from '@beluga/shared';
import { DEMON_D_ESSAI, PATHS, ROOT } from './config.js';
import * as store from './store.js';
import { bus } from './bus.js';
import { log } from './logger.js';

const PREFERENCE = 'decrochages.enquete';
const SURVEILLANT_INSTALLE = '/usr/local/bin/beluga-watchdog.sh';
/** Les colonnes d'où une enquête se REPREND au lieu d'en ouvrir une autre. */
const COLONNES_NON_RANGEES = ['planned', 'running'];

export function dossierDesDecrochages(): string {
  return path.join(PATHS.logs, 'decrochages');
}

/**
 * UNE LIGNE AU JOURNAL DES DÉCROCHAGES. Synchrone et minuscule : elle est
 * écrite juste avant un `process.exit`. Ne fait jamais tomber le démon.
 */
export function noterDansLeJournalDesDecrochages(genre: GenreDuJournalDesDecrochages, detail?: string): void {
  try {
    fs.mkdirSync(dossierDesDecrochages(), { recursive: true });
    fs.appendFileSync(path.join(dossierDesDecrochages(), 'journal.tsv'), ligneDesDecrochages({ instant: Date.now(), genre, detail }));
  } catch {
    /* un disque plein ne vaut pas un arrêt raté */
  }
}

/** Les `octets` derniers d'un fichier, sans le lire en entier ; vide s'il n'existe pas. */
async function finDuFichier(chemin: string, octets: number): Promise<string> {
  let fichier: fs.promises.FileHandle | null = null;
  try {
    fichier = await fs.promises.open(chemin, 'r');
    const { size } = await fichier.stat();
    const debut = Math.max(0, size - octets);
    const tampon = Buffer.alloc(size - debut);
    await fichier.read(tampon, 0, tampon.length, debut);
    const texte = tampon.toString('utf8');
    // La première ligne est sans doute coupée : on la laisse tomber.
    return debut > 0 ? texte.slice(texte.indexOf('\n') + 1) : texte;
  } catch {
    return '';
  } finally {
    await fichier?.close().catch(() => {});
  }
}

/**
 * LE SURVEILLANT POSÉ HORS DU DÉPÔT SUIT LA COPIE DU DÉPÔT. Il tourne en root
 * depuis `/usr/local/bin` ; le démon (qui redémarre à chaque mise en ligne)
 * l'y recopie quand elle a changé. Un démon d'essai n'y touche jamais.
 */
export function installerLeSurveillant(): void {
  if (DEMON_D_ESSAI || process.env.NODE_ENV !== 'production') return;
  const source = path.join(ROOT, 'scripts', 'beluga-watchdog.sh');
  let voulu: string;
  try {
    // La racine de CETTE installation remplace celle écrite par défaut.
    voulu = fs.readFileSync(source, 'utf8').replace('RACINE="${BELUGA_RACINE:-/root/beluga}"', `RACINE="\${BELUGA_RACINE:-${ROOT}}"`);
    const pose = fs.existsSync(SURVEILLANT_INSTALLE) ? fs.readFileSync(SURVEILLANT_INSTALLE, 'utf8') : null;
    if (pose === voulu) return;
    if (pose === null) return; // Pas de surveillant installé ici : on n'en pose pas un d'office.
  } catch {
    return;
  }
  const copie = path.join(PATHS.logs, '.beluga-watchdog.sh');
  try {
    fs.writeFileSync(copie, voulu, { mode: 0o755 });
  } catch {
    return;
  }
  execFile('sudo', ['-n', 'install', '-m', '755', copie, SURVEILLANT_INSTALLE], { timeout: 15_000 }, (err) => {
    fs.rmSync(copie, { force: true });
    if (err) log.warn('surveillant : mise à jour impossible', err.message);
    else log.info('surveillant : copie de /usr/local/bin mise à jour depuis le dépôt');
  });
}

function lireEtat(): EtatDeLEnquete {
  const brut = store.readPreference(PREFERENCE);
  return brut && typeof brut === 'object' ? (brut as EtatDeLEnquete) : {};
}

function ecrireEtat(etat: EtatDeLEnquete): void {
  store.writePreference(PREFERENCE, etat);
}

function noterDansLeFil(agentId: string, texte: string): void {
  const message = store.saveMessage({
    id: store.newId(),
    agentId,
    role: 'system',
    content: texte,
    createdAt: store.now(),
  } as any);
  bus.emit({ type: 'message.upsert', message });
}

let enCours = false;

/**
 * LE PASSAGE : lit les trois sources, réunit les incidents, et ouvre l'enquête
 * — ou ajoute les nouveaux décrochages à celle qui est encore ouverte.
 */
export async function examinerLesDecrochages(maintenant = Date.now()): Promise<'ouverte' | 'note' | null> {
  if (enCours) return null;
  enCours = true;
  try {
    const dossier = dossierDesDecrochages();
    const journal = (await finDuFichier(path.join(dossier, 'journal.tsv'), 512 * 1024))
      .split('\n')
      .map(lireLigneDesDecrochages)
      .filter((l): l is NonNullable<typeof l> => l !== null);
    const coupures = (await finDuFichier(path.join(PATHS.logs, 'interface-erreurs.log'), 1024 * 1024))
      .split('\n')
      .map((ligne) => {
        try {
          return coupureSubieDuNavigateur(JSON.parse(ligne));
        } catch {
          return null;
        }
      })
      .filter((c): c is NonNullable<typeof c> => c !== null);
    const journalDuDemon = path.join(PATHS.logs, 'service.log');
    const arretsVoulus = arretsVoulusDuJournalDuDemon(await finDuFichier(journalDuDemon, 4 * 1024 * 1024));

    const incidents = incidentsDeDecrochage({ journal, coupures, arretsVoulus, maintenant });
    const etat = lireEtat();
    const carte = etat.cardId ? store.getCard(etat.cardId) : null;
    const carteOuverte = Boolean(carte && COLONNES_NON_RANGEES.includes(carte.column));
    /*
     * UNE ENQUÊTE ENCORE OUVERTE REÇOIT CHAQUE NOUVEAU DÉCROCHAGE, même isolé :
     * on ne double pas la carte, on la nourrit.
     */
    if (carteOuverte && carte) {
      const nouveaux = incidentsNonSignales(incidents, etat);
      const agent = store.getLastAgentByCard(carte.id);
      if (!nouveaux.length || !agent) return null;
      noterDansLeFil(agent.id, noteDeNouveauxDecrochages(nouveaux));
      ecrireEtat({ ...etat, dernierIncidentSignale: Math.max(...nouveaux.map((i) => i.fin)) });
      log.info(`décrochages : ${nouveaux.length} nouveau(x), ajouté(s) à « ${carte.title} »`);
      return 'note';
    }
    const decision = decisionDEnquete(incidents, { ...etat, carteOuverte }, maintenant);
    if (!decision.enqueter) {
      if (decision.raison !== 'pas-recurrent') log.info(`décrochages : pas d’enquête (${decision.raison})`);
      return null;
    }

    const projet = store.listProjects().find((p) => p.isSelf);
    if (!projet) {
      log.warn('décrochages : récurrence constatée, mais aucun projet de l’application pour y ouvrir l’enquête');
      return null;
    }
    const premiere = !etat.lanceLe;
    // Posé AVANT le tour : un lancement qui échoue ne rejoue pas au passage suivant.
    ecrireEtat({ lanceLe: maintenant, dernierIncidentSignale: Math.max(...incidents.map((i) => i.fin)) });

    const { createCard } = await import('./tools.js');
    const card = createCard(projet.id, {
      title: TITRE_ENQUETE_DECROCHAGES,
      description: descriptionDEnqueteDecrochages(incidents),
      labels: [LABEL_DECROCHAGE_SERVEUR],
      origin: 'agent',
      auteur: 'depannage',
      cadrage: true,
    });
    bus.emit({ type: 'card.upsert', card });
    ecrireEtat({ ...lireEtat(), cardId: card.id });
    log.warn(`décrochages : ${incidents.length} incidents en 24 h — enquête ouverte (« ${card.title} »)`);

    const { ouvrirLeCadrage } = await import('./cadrage.js');
    const cadrage = await ouvrirLeCadrage(card.id);
    if (!cadrage) {
      log.error('décrochages : aucun agent de cadrage pour l’enquête');
      return 'ouverte';
    }
    const demande = demandeDEnqueteDecrochages({
      incidents,
      arretsVoulus: [
        ...journal.filter((l) => l.genre === 'relance-voulue' || l.genre === 'arret-par-signal').map((l) => l.instant),
        ...arretsVoulus,
      ].filter((t, i, tous) => t >= maintenant - 24 * 3_600_000 && tous.findIndex((u) => Math.abs(u - t) < 5_000) === i),
      dossierDesReleves: dossier,
      journalDuDemon,
      premiere,
    });
    bus.emit({ type: 'attention', ...store.signalAttention() });
    const { sendPrompt } = await import('./runtime.js');
    void sendPrompt(cadrage.id, demande, { template: 'none', silent: true })
      .then(async () => {
        const { demanderLePlan } = await import('./ws.js');
        await demanderLePlan(card.id);
      })
      .catch((err) => log.error('décrochages : l’enquête a échoué', err));
    return 'ouverte';
  } catch (err: any) {
    log.warn('décrochages : passage impossible', err?.message ?? err);
    return null;
  } finally {
    enCours = false;
  }
}

/**
 * AU DÉMARRAGE : le démarrage est noté, le surveillant remis à jour, puis le
 * passage tourne trois minutes plus tard et toutes les dix minutes. Un démon
 * d'essai ne surveille rien : sa base est vierge, et ses arrêts ne sont pas
 * ceux du vrai service.
 */
export function demarrerLaVeilleDesDecrochages(): NodeJS.Timeout | null {
  if (DEMON_D_ESSAI) return null;
  noterDansLeJournalDesDecrochages('demarrage', `pid ${process.pid}`);
  installerLeSurveillant();
  setTimeout(() => void examinerLesDecrochages(), 3 * 60_000).unref?.();
  const minuterie = setInterval(() => void examinerLesDecrochages(), 10 * 60_000);
  minuterie.unref?.();
  return minuterie;
}
