/*
 * LA MISE À JOUR DE L'EXTENSION CHROME DES MAC, CÔTÉ DÉMON (carte « Extension à jour et Jarvis tout en voix »,
 * 20/11/2026) — règles pures dans `shared/src/mise-a-jour-extension.ts`.
 *
 * Une extension non empaquetée ne se met jamais à jour seule. Beluga la met à jour par le programme du Mac
 * (`scripts/relais-mac/relais.js`, geste `mettre_a_jour_extension`) : le paquet est préparé ICI, servi au relais par la
 * voie signée (`/api/relais-mac/extension.zip?jeton=…`), et son empreinte SHA-256 part avec le geste ; le relais
 * remplace le contenu du MÊME dossier (même identifiant : liaison et autorisation de navigation privée gardées), puis
 * l'extension se recharge (1.0.11 et plus) ou Chrome est quitté proprement et rouvert (plus ancienne).
 *
 * Décision de l'utilisateur (20/11/2026, carte « Liaison de l'extension Chrome simplifiée ») : TOUT DE SUITE dès
 * qu'aucun agent ne travaille dans ce Chrome (extension 1.0.11 et plus, qui se recharge sans fermer les onglets) ; la
 * relance de Chrome (plus ancienne) reste la nuit ou sur un clic. Jamais pendant qu'un agent travaille dans ce Chrome :
 * la tournée repasse à la fin de sa séance (`apresUneSeance`), à chaque retour du Chrome ou du programme du Mac, et
 * toutes les dix minutes. Une mise à jour faite seule s'annonce dans la bande en simple information (`avisDuCompte`).
 */
import crypto from 'node:crypto';
import {
  VERSION_EXTENSION_CHROME,
  aMettreAJourSeul,
  avisDeLIssue,
  echecRecent,
  faconDeRecharger,
  type AvisDeMiseAJour,
  retardsDExtension,
  versionAuMoins,
  type ChromeAJuger,
  type RetardDExtension,
} from '@beluga/shared';
import { getDb } from './db.js';
import { bus } from './bus.js';
import { log } from './logger.js';

/** Les paquets préparés pour une mise à jour : jeton → zip, valables dix minutes, pour UN relais. */
const paquets = new Map<string, { appareilRelais: string; zip: Buffer; expireLe: number }>();
/** Les Chrome dont on attend le retour en version neuve. */
const retours = new Map<string, (version: string | null) => void>();
/** Les mises à jour en cours, pour ne pas en lancer deux sur le même Chrome. */
const enCours = new Set<string>();
/**
 * L'ÉTAPE D'UNE MISE À JOUR EN COURS, lue par la fenêtre de Beluga Connect (carte « Extension, rapport SEO-GEO et
 * menus », 21/11/2026) pour cocher ses trois étapes en direct : « telechargement » (le paquet part vers le Mac),
 * « relance » (fichiers remplacés, l'extension se recharge ou Chrome se rouvre). Absente : rien en cours.
 */
const phases = new Map<string, 'telechargement' | 'relance'>();
export function phaseDeLaMiseAJour(chromeId: string): 'telechargement' | 'relance' | null {
  return phases.get(chromeId) ?? null;
}

/** Le relais demande le paquet préparé pour lui : le zip, ou rien (jeton inconnu, expiré, ou d'un autre relais). */
export function paquetPreparePour(appareilRelais: string, jeton: string, maintenant = Date.now()): Buffer | null {
  for (const [cle, p] of paquets) if (p.expireLe < maintenant) paquets.delete(cle);
  const p = paquets.get(jeton);
  return p && p.appareilRelais === appareilRelais ? p.zip : null;
}

export async function preparerLePaquet(appareilRelais: string): Promise<{ jeton: string; empreinte: string }> {
  const { paquetDeLExtension } = await import('./extension-chrome.js');
  let adresse = '';
  try {
  } catch {
    /* le relais garde de toute façon le config.json de l'installation */
  }
  const zip = await paquetDeLExtension(adresse || 'http://localhost:7070');
  const jeton = crypto.randomBytes(12).toString('base64url');
  paquets.set(jeton, { appareilRelais, zip, expireLe: Date.now() + 10 * 60_000 });
  return { jeton, empreinte: crypto.createHash('sha256').update(zip).digest('hex') };
}

interface LigneChrome {
  id: string;
  compte_id: string;
  nom: string;
  version: string | null;
  ordinateur_id: string | null;
  extension_id: string | null;
  mise_a_jour_le: number | null;
}

function ligneDuChrome(chromeId: string): LigneChrome | undefined {
  return getDb()
    .prepare('SELECT id, compte_id, nom, version, ordinateur_id, extension_id, mise_a_jour_le, marque FROM chrome_appareils WHERE id = ? AND revoque_le IS NULL')
    .get(chromeId) as LigneChrome | undefined;
}

function noterLIssue(chromeId: string, issue: string): void {
  try {
    getDb().prepare('UPDATE chrome_appareils SET mise_a_jour_le = ?, mise_a_jour_issue = ? WHERE id = ?').run(Date.now(), issue.slice(0, 300), chromeId);
  } catch {
    /* base fermée à l'arrêt */
  }
}

/** LES CHROME EN RETARD d'un compte : version plus ancienne que celle servie, ou navigation privée non autorisée. */
export async function retardsDuCompte(compteId: string, maintenant = Date.now()): Promise<(RetardDExtension & { enCours: boolean })[]> {
  const { chromesDuCompte } = await import('./extension-chrome.js');
  const { programmesDuCompte } = await import('./relais-mac.js');
  const { programmeEnLigne } = await import('@beluga/shared');
  const chromes: ChromeAJuger[] = chromesDuCompte(compteId).map((c) => ({
    id: c.id,
    nom: c.nom,
    genre: c.genre,
    version: c.version,
    incognito: c.incognito ?? null,
    vuLe: c.vuLe,
    enLigne: c.enLigne,
    ordinateurId: c.ordinateurId,
    agentsAuTravail: c.agentsAuTravail,
  }));
  const programmes = new Set(
    programmesDuCompte(compteId, maintenant)
      .filter((p) => programmeEnLigne({ id: p.id, etat: p.etat, vuLe: p.vuLe, autorisations: p.autorisations }))
      .map((p) => p.ordinateurId),
  );
  /* Le nom affiché est celui de l'ORDINATEUR (« MacMini »), plus parlant que la plateforme du navigateur. */
  const noms = new Map<string, string>();
  try {
    for (const o of getDb().prepare('SELECT id, nom FROM ordinateurs WHERE compte_id = ?').all(compteId) as { id: string; nom: string }[]) noms.set(o.id, o.nom);
  } catch {
    /* base pas encore migrée */
  }
  const echecs = new Set<string>();
  try {
    for (const l of getDb().prepare('SELECT id, mise_a_jour_le, mise_a_jour_issue FROM chrome_appareils WHERE compte_id = ? AND revoque_le IS NULL').all(compteId) as {
      id: string;
      mise_a_jour_le: number | null;
      mise_a_jour_issue: string | null;
    }[]) {
      if (echecRecent(l.mise_a_jour_issue, l.mise_a_jour_le, maintenant)) echecs.add(l.id);
    }
  } catch {
    /* base pas encore migrée */
  }
  return retardsDExtension(chromes, VERSION_EXTENSION_CHROME, programmes, maintenant, echecs).map((r) => ({
    ...r,
    nom: (r.ordinateurId && noms.get(r.ordinateurId)) || r.nom,
    enCours: enCours.has(r.chromeId),
  }));
}

/**
 * LES MISES À JOUR FAITES SEULES du compte, pour la bande d'information : une réussite automatique de moins d'un jour,
 * sur un Chrome encore relié, au nom de son ORDINATEUR. La page retire l'avis une fois vu (Chrome + version).
 */
export function avisDuCompte(compteId: string, maintenant = Date.now()): AvisDeMiseAJour[] {
  try {
    const lignes = getDb()
      .prepare(
        `SELECT c.id, c.nom, c.mise_a_jour_le, c.mise_a_jour_issue, o.nom AS ordinateur
           FROM chrome_appareils c LEFT JOIN ordinateurs o ON o.id = c.ordinateur_id
          WHERE c.compte_id = ? AND c.revoque_le IS NULL AND c.mise_a_jour_le IS NOT NULL`,
      )
      .all(compteId) as { id: string; nom: string; mise_a_jour_le: number; mise_a_jour_issue: string | null; ordinateur: string | null }[];
    return lignes.flatMap((l) => {
      const avis = avisDeLIssue(l.mise_a_jour_issue, l.mise_a_jour_le, maintenant);
      return avis ? [{ chromeId: l.id, nom: l.ordinateur || l.nom, version: avis.version, faiteLe: l.mise_a_jour_le }] : [];
    });
  } catch {
    return [];
  }
}

/** Le Chrome s'est (re)connecté : un retour attendu se résout, et une autorisation donnée lève l'attente du suivi GEO. */
export function chromeRevenu(chromeId: string, version: string | null): void {
  const attente = retours.get(chromeId);
  if (attente && versionAuMoins(version, VERSION_EXTENSION_CHROME)) {
    retours.delete(chromeId);
    attente(version);
  }
  /* Un Chrome en retard qui revient : la mise à jour part tout de suite s'il n'a pas d'agent au travail. */
  if (!versionAuMoins(version, VERSION_EXTENSION_CHROME)) bientot();
  try {
    const ligne = getDb().prepare('SELECT incognito FROM chrome_appareils WHERE id = ?').get(chromeId) as { incognito: number | null } | undefined;
  } catch {
    /* base fermée */
  }
}

function attendreLeRetour(chromeId: string, delaiMs: number): Promise<string | null> {
  return new Promise((resoudre) => {
    const minuteur = setTimeout(() => {
      if (retours.get(chromeId) === fini) retours.delete(chromeId);
      resoudre(null);
    }, delaiMs);
    const fini = (v: string | null) => {
      clearTimeout(minuteur);
      resoudre(v);
    };
    retours.set(chromeId, fini);
  });
}

export type IssueDeMiseAJour = { ok: true; version: string; texte: string } | { ok: false; texte: string; sansProgramme?: boolean };

/**
 * METTRE À JOUR L'EXTENSION D'UN CHROME par le programme de son Mac, puis attendre qu'il revienne en version neuve.
 * `origine` : « clic » (bande, menu de Beluga Connect), « auto » (tournée, dès qu'aucun agent ne travaille) ou « nuit »
 * (relance de Chrome, de 1 h à 6 h).
 */
export async function mettreAJourLExtension(compteId: string, chromeId: string, origine: 'clic' | 'nuit' | 'auto'): Promise<IssueDeMiseAJour> {
  const ligne = ligneDuChrome(chromeId);
  if (!ligne || ligne.compte_id !== compteId) return { ok: false, texte: 'Ce Chrome n’est plus relié.' };
  if (versionAuMoins(ligne.version, VERSION_EXTENSION_CHROME)) return { ok: true, version: ligne.version!, texte: 'L’extension est déjà à jour.' };
  if (enCours.has(chromeId)) return { ok: false, texte: 'La mise à jour est déjà en cours.' };
  const { chromesDuCompte } = await import('./extension-chrome.js');
  const chrome = chromesDuCompte(compteId).find((c) => c.id === chromeId);
  if (chrome && chrome.agentsAuTravail > 0) return { ok: false, texte: 'Un agent travaille dans ce Chrome : la mise à jour attendra qu’il ait fini.' };
  const { relaisDuCompte, demanderAuRelais, capacitesDuRelais } = await import('./relais-mac.js');
  const relais = relaisDuCompte(compteId, Date.now(), ligne.ordinateur_id);
  if (!relais.appareilId || relais.ordinateurId !== ligne.ordinateur_id || relais.etat === 'absent') {
    return { ok: false, sansProgramme: true, texte: 'Le programme du Mac n’est pas installé sur cet ordinateur : la mise à jour se fait à la main, depuis Réglages › Extension.' };
  }
  if (relais.etat === 'hors-ligne') return { ok: false, texte: 'Le programme du Mac ne répond pas : l’ordinateur est-il allumé ?' };
  if ((capacitesDuRelais(relais.appareilId)?.version ?? 1) < 2) {
    return { ok: false, texte: 'Le programme du Mac est trop ancien pour mettre l’extension à jour : rejouez une fois sa commande d’installation (Réglages › Extension).' };
  }
  enCours.add(chromeId);
  phases.set(chromeId, 'telechargement');
  bus.emit({ type: 'extension.change' });
  try {
    const { jeton, empreinte } = await preparerLePaquet(relais.appareilId);
    const facon = faconDeRecharger(chrome?.version ?? ligne.version);
    log.info(`extension Chrome « ${ligne.nom} » : mise à jour ${ligne.version ?? '?'} → ${VERSION_EXTENSION_CHROME} (${origine}, ${facon})`);
    const retour = attendreLeRetour(chromeId, 120_000);
    const fait = await demanderAuRelais<{ dossiers?: { chemin: string }[] }>(
      relais.appareilId,
      'mettre_a_jour_extension',
      {
        chemin: `/api/relais-mac/extension.zip?jeton=${jeton}`,
        empreinte,
        version: VERSION_EXTENSION_CHROME,
        extensionId: ligne.extension_id,
        /* Le navigateur de cette extension (relais 9) : Edge, Brave… ; absent ou inconnu : Chrome. */
        marque: (ligne as { marque?: string | null }).marque ?? 'chrome',
        relancer: facon === 'relancer-chrome',
      },
      150_000,
    );
    phases.set(chromeId, 'relance');
    if (facon === 'extension') {
      const { demanderAuChrome } = await import('./extension-chrome.js');
      await demanderAuChrome(chromeId, 'se_recharger', {}, 15_000).catch(() => {});
    }
    const version = await retour;
    if (!version) {
      noterLIssue(chromeId, `fichiers remplacés (${fait.dossiers?.map((d) => d.chemin).join(', ') ?? '?'}) mais Chrome n’est pas revenu en ${VERSION_EXTENSION_CHROME}`);
      return { ok: false, texte: `Les fichiers sont remplacés, mais Chrome n’est pas revenu en version ${VERSION_EXTENSION_CHROME} : rouvrez Chrome sur ce Mac.` };
    }
    noterLIssue(chromeId, `ok ${version} (${origine})`);
    log.info(`extension Chrome « ${ligne.nom} » : à jour en ${version}`);
    return { ok: true, version, texte: `L’extension est à jour (version ${version}).` };
  } catch (e) {
    const texte = String((e as Error)?.message ?? e);
    noterLIssue(chromeId, `échec : ${texte}`);
    log.warn(`extension Chrome « ${ligne.nom} » : mise à jour impossible`, texte);
    if (/geste inconnu/.test(texte)) return { ok: false, texte: 'Le programme du Mac est trop ancien : rejouez une fois sa commande d’installation (Réglages › Extension).' };
    /* Une extension rangée dans Téléchargements, Documents ou le Bureau : macOS demande d'abord l'accès au dossier, sur le Mac. */
    if (/pas répondu à temps/.test(texte)) {
      return { ok: false, texte: 'Le Mac n’a pas répondu à temps : macOS y demande sans doute l’accès au dossier où l’extension est rangée (Téléchargements). Cliquez « Autoriser » sur le Mac, puis recommencez.' };
    }
    return { ok: false, texte: `Mise à jour impossible : ${texte}` };
  } finally {
    enCours.delete(chromeId);
    phases.delete(chromeId);
    retours.delete(chromeId);
    bus.emit({ type: 'extension.change' });
  }
}

/** Ouvrir, dans le Chrome lui-même, sa page d'extension pour cocher « Autoriser en navigation privée » (1.0.11 et plus). */
export async function ouvrirLesReglagesDeLExtension(compteId: string, chromeId: string): Promise<void> {
  const ligne = ligneDuChrome(chromeId);
  if (!ligne || ligne.compte_id !== compteId) throw new Error('Ce Chrome n’est plus relié.');
  const { demanderAuChrome } = await import('./extension-chrome.js');
  await demanderAuChrome(chromeId, 'ouvrir_reglages_extension', {}, 15_000);
}

/**
 * LA TOURNÉE DES MISES À JOUR : chaque Chrome en retard de version, dont le programme du Mac répond et où aucun agent ne
 * travaille, est mis à jour seul (`aMettreAJourSeul` : tout de suite s'il se recharge, la nuit s'il faut relancer
 * Chrome), au plus une fois toutes les trente minutes après un échec. Une seule tournée à la fois.
 */
let tourneeEnCours = false;
export async function tourneeDesMisesAJour(maintenant = Date.now()): Promise<number> {
  if (tourneeEnCours) return 0;
  tourneeEnCours = true;
  let comptes: string[] = [];
  try {
    comptes = (getDb().prepare('SELECT DISTINCT compte_id FROM chrome_appareils WHERE revoque_le IS NULL').all() as { compte_id: string }[]).map((l) => l.compte_id);
  } catch {
    tourneeEnCours = false;
    return 0;
  }
  let faits = 0;
  try {
    const { chromesDuCompte } = await import('./extension-chrome.js');
    for (const compteId of comptes) {
      for (const r of await retardsDuCompte(compteId, maintenant)) {
        if (r.enCours) continue;
        const ligne = ligneDuChrome(r.chromeId);
        const agents = chromesDuCompte(compteId).find((c) => c.id === r.chromeId)?.agentsAuTravail ?? 0;
        if (!aMettreAJourSeul(r, agents, ligne?.mise_a_jour_le ?? null, maintenant)) continue;
        const issue = await mettreAJourLExtension(compteId, r.chromeId, faconDeRecharger(r.version) === 'extension' ? 'auto' : 'nuit');
        if (issue.ok) faits += 1;
      }
    }
  } finally {
    tourneeEnCours = false;
  }
  return faits;
}

/** Ancien nom, gardé pour les appelants (suivi GEO) : la tournée ne dépend plus de la nuit. */
export const tourneeDeNuit = tourneeDesMisesAJour;

let prochaine: NodeJS.Timeout | null = null;
/** Une tournée dans quelques secondes (regroupe les déclencheurs rapprochés : retour du Chrome, fin de séance…). */
export function bientot(delaiMs = 5_000): void {
  if (prochaine) return;
  prochaine = setTimeout(() => {
    prochaine = null;
    void tourneeDesMisesAJour().catch((e) => log.warn('mise à jour automatique de l’extension', String(e?.message ?? e)));
  }, delaiMs);
  prochaine.unref();
}

let minuterie: NodeJS.Timeout | null = null;

/** Toutes les dix minutes, et une première fois une minute après le démarrage du démon. */
export function planifierLaMiseAJourDeNuit(): void {
  if (minuterie) return;
  minuterie = setInterval(() => bientot(0), 10 * 60_000);
  minuterie.unref();
  bientot(60_000);
}
