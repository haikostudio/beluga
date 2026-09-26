/**
 * LES COMPTES, CÔTÉ BASE.
 *
 * Un compte = une ligne de `users` + ses projets dans `user_projects`. Le mot
 * de passe n'est jamais gardé : seule son empreinte scrypt, avec son sel, comme
 * le faisait déjà le mur d'accès à compte unique.
 *
 * Les règles PURES — forme d'un identifiant, force d'un mot de passe, portée —
 * vivent dans `shared/src/comptes-clients.ts` et sont testées seules. Ici, on
 * ne fait que les appliquer et écrire.
 */
import crypto from 'node:crypto';
import {
  ALPHABET_MOT_DE_PASSE,
  LONGUEUR_MOT_DE_PASSE_TIRE,
  decouperPourLaLecture,
  courrielNettoye,
  jugerCourriel,
  jugerIdentifiant,
  jugerMotDePasse,
  normaliserIdentifiant,
  nomDuCompte,
  porteeNettoyee,
  themeChoisiValide,
  type CompteUtilisateur,
  type RoleCompte,
} from '@beluga/shared';
import { getDb } from './db.js';
import { log } from './logger.js';

interface LigneUtilisateur {
  id: string;
  identifiant: string;
  role: string;
  nom_affiche: string;
  salt: string;
  hash: string;
  actif: number;
  cree_le: number;
  derniere_entree: number | null;
  courriel: string | null;
  apparence: string | null;
}

export function empreinte(motDePasse: string, sel: Buffer): string {
  return crypto.scryptSync(motDePasse, sel, 64, { N: 16384, r: 8, p: 1 }).toString('hex');
}

/** Un mot de passe tiré au hasard, lisible : ni « l » ni « 1 », des tirets tous les cinq signes. */
export function tirerUnMotDePasse(): string {
  let brut = '';
  for (let i = 0; i < LONGUEUR_MOT_DE_PASSE_TIRE; i += 1) {
    brut += ALPHABET_MOT_DE_PASSE[crypto.randomInt(ALPHABET_MOT_DE_PASSE.length)];
  }
  return decouperPourLaLecture(brut);
}

function projetsDuCompte(userId: string): string[] {
  const rows = getDb()
    .prepare('SELECT project_id FROM user_projects WHERE user_id = ? ORDER BY project_id')
    .all(userId) as { project_id: string }[];
  return rows.map((r) => r.project_id);
}

function enCompte(ligne: LigneUtilisateur): CompteUtilisateur {
  return {
    id: ligne.id,
    identifiant: ligne.identifiant,
    role: (ligne.role === 'admin' ? 'admin' : 'client') as RoleCompte,
    nomAffiche: ligne.nom_affiche ?? '',
    actif: ligne.actif === 1,
    creeLe: ligne.cree_le,
    derniereEntree: ligne.derniere_entree ?? undefined,
    projets: ligne.role === 'admin' ? [] : projetsDuCompte(ligne.id),
    courriel: ligne.courriel ?? undefined,
    apparence: ligne.apparence ?? undefined,
  };
}

export function listerComptes(): CompteUtilisateur[] {
  const rows = getDb()
    .prepare('SELECT * FROM users ORDER BY role, identifiant')
    .all() as LigneUtilisateur[];
  return rows.map(enCompte);
}

export function compteParId(id: string): CompteUtilisateur | null {
  const ligne = getDb().prepare('SELECT * FROM users WHERE id = ?').get(id) as LigneUtilisateur | undefined;
  return ligne ? enCompte(ligne) : null;
}

export function compteParIdentifiant(identifiant: string): CompteUtilisateur | null {
  const ligne = getDb()
    .prepare('SELECT * FROM users WHERE identifiant = ?')
    .get(normaliserIdentifiant(identifiant)) as LigneUtilisateur | undefined;
  return ligne ? enCompte(ligne) : null;
}

/** L'empreinte et le sel d'un compte — lus par la seule vérification du mot de passe. */
export function secretDuCompte(id: string): { salt: string; hash: string } | null {
  const ligne = getDb().prepare('SELECT salt, hash FROM users WHERE id = ?').get(id) as
    | { salt: string; hash: string }
    | undefined;
  return ligne ?? null;
}

export interface CreationDeCompte {
  identifiant: string;
  role: RoleCompte;
  nomAffiche?: string;
  projets?: string[];
  /** Absent : un mot de passe est tiré au hasard et rendu UNE seule fois. */
  motDePasse?: string;
}

export interface CompteCree {
  compte: CompteUtilisateur;
  /** Le mot de passe en clair. Rendu UNE fois, jamais relu ensuite. */
  motDePasse: string;
}

/**
 * OUVRIR UN ACCÈS. Le mot de passe est rendu EN CLAIR une seule fois : il n'est
 * gardé nulle part, et personne — pas même Haiko — ne pourra le relire. Le
 * perdre, c'est le réinitialiser.
 */
export function creerCompte(demande: CreationDeCompte, projetsConnus: readonly string[]): CompteCree {
  const identifiant = normaliserIdentifiant(demande.identifiant);
  const verdict = jugerIdentifiant(identifiant);
  if (!verdict.ok) throw new Error(verdict.raison);
  if (compteParIdentifiant(identifiant)) throw new Error('Cet identifiant est déjà pris.');

  const motDePasse = demande.motDePasse ?? tirerUnMotDePasse();
  const force = jugerMotDePasse(motDePasse);
  if (!force.ok) throw new Error(force.raison);

  const sel = crypto.randomBytes(16);
  const id = crypto.randomUUID();
  const projets = porteeNettoyee(demande.role, demande.projets ?? [], projetsConnus);

  const db = getDb();
  db.prepare(
    `INSERT INTO users (id, identifiant, role, nom_affiche, salt, hash, actif, cree_le)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
  ).run(
    id,
    identifiant,
    demande.role,
    demande.nomAffiche?.trim() || identifiant,
    sel.toString('hex'),
    empreinte(motDePasse, sel),
    Date.now(),
  );
  for (const projectId of projets) {
    db.prepare('INSERT OR IGNORE INTO user_projects (user_id, project_id) VALUES (?, ?)').run(id, projectId);
  }
  log.info('comptes', `accès « ${identifiant} » ouvert (${demande.role})`);
  return { compte: compteParId(id)!, motDePasse };
}

/** Change la portée d'un compte : les projets cochés, et eux seuls. */
export function changerLaPortee(userId: string, projets: readonly string[], projetsConnus: readonly string[]): CompteUtilisateur {
  const compte = compteParId(userId);
  if (!compte) throw new Error('Ce compte est introuvable.');
  const gardes = porteeNettoyee(compte.role, projets, projetsConnus);
  const db = getDb();
  db.prepare('DELETE FROM user_projects WHERE user_id = ?').run(userId);
  for (const projectId of gardes) {
    db.prepare('INSERT OR IGNORE INTO user_projects (user_id, project_id) VALUES (?, ?)').run(userId, projectId);
  }
  return compteParId(userId)!;
}

export function renommerCompte(userId: string, nomAffiche: string): CompteUtilisateur {
  const compte = compteParId(userId);
  if (!compte) throw new Error('Ce compte est introuvable.');
  getDb().prepare('UPDATE users SET nom_affiche = ? WHERE id = ?').run(nomAffiche.trim() || compte.identifiant, userId);
  return compteParId(userId)!;
}

/**
 * L'ADRESSE DE COURRIEL D'UN COMPTE — celle que vise le courriel du lundi
 * matin. Une adresse VIDE est acceptée et efface la précédente : c'est la
 * façon de dire « ne m'écrivez plus ».
 */
export function changerLeCourriel(userId: string, courriel: string): CompteUtilisateur {
  const compte = compteParId(userId);
  if (!compte) throw new Error('Ce compte est introuvable.');
  const verdict = jugerCourriel(courriel);
  if (!verdict.ok) throw new Error(verdict.raison);
  getDb().prepare('UPDATE users SET courriel = ? WHERE id = ?').run(courrielNettoye(courriel) ?? null, userId);
  return compteParId(userId)!;
}

/**
 * SUSPENDRE COUPE LES SESSIONS OUVERTES IMMÉDIATEMENT. Sans cela, un compte
 * retiré continuait d'écrire pendant des jours : la session vivait sa vie sans
 * jamais relire le compte.
 */
export function suspendreCompte(userId: string, suspendu: boolean): CompteUtilisateur {
  const compte = compteParId(userId);
  if (!compte) throw new Error('Ce compte est introuvable.');
  if (compte.role === 'admin' && suspendu && compteAdminActifsSauf(userId) === 0) {
    throw new Error('Impossible de suspendre le dernier administrateur.');
  }
  getDb().prepare('UPDATE users SET actif = ? WHERE id = ?').run(suspendu ? 0 : 1, userId);
  if (suspendu) fermerLesSessions(userId);
  return compteParId(userId)!;
}

function compteAdminActifsSauf(userId: string): number {
  const row = getDb()
    .prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND actif = 1 AND id <> ?")
    .get(userId) as { n: number };
  return row.n;
}

/** Toutes les sessions ouvertes d'un compte tombent. */
export function fermerLesSessions(userId: string): void {
  getDb().prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}

/**
 * RÉINITIALISER LE MOT DE PASSE. Rend le nouveau en clair, UNE fois, et coupe
 * les sessions ouvertes : un mot de passe changé ferme les portes déjà passées.
 */
export function reinitialiserLeMotDePasse(userId: string, choisi?: string): string {
  const compte = compteParId(userId);
  if (!compte) throw new Error('Ce compte est introuvable.');
  const motDePasse = choisi ?? tirerUnMotDePasse();
  const force = jugerMotDePasse(motDePasse);
  if (!force.ok) throw new Error(force.raison);
  const sel = crypto.randomBytes(16);
  getDb()
    .prepare('UPDATE users SET salt = ?, hash = ? WHERE id = ?')
    .run(sel.toString('hex'), empreinte(motDePasse, sel), userId);
  fermerLesSessions(userId);
  return motDePasse;
}

/**
 * RETIRER UN ACCÈS NE SUPPRIME RIEN. Le compte est mis de côté — suspendu,
 * marqué —, ses demandes et ses messages restent lisibles, exactement comme un
 * projet mis de côté. On ne perd jamais l'auteur d'un commentaire.
 */
export function retirerLAcces(userId: string): void {
  suspendreCompte(userId, true);
  getDb().prepare('DELETE FROM user_projects WHERE user_id = ?').run(userId);
}

export function noterEntree(userId: string): void {
  getDb().prepare('UPDATE users SET derniere_entree = ? WHERE id = ?').run(Date.now(), userId);
}

/** Le nom montré d'un compte, jamais vide — sert les bulles et les commentaires. */
export function nomAffiche(userId: string): string {
  const compte = compteParId(userId);
  return compte ? nomDuCompte(compte) : 'Compte retiré';
}

/**
 * Y A-T-IL AU MOINS UN ADMINISTRATEUR ? Une base montée à blanc par un contrôle
 * n'a pas de compte reporté depuis `meta` : le premier démarrage en pose un.
 */
export function nombreDAdministrateurs(): number {
  const row = getDb().prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get() as { n: number };
  return row.n;
}

/* ------------------------------------------------------------------ */
/* MON COMPTE — les gestes qu'une personne fait sur LE SIEN            */
/* ------------------------------------------------------------------ */

/**
 * LE MOT DE PASSE ACTUEL EST-IL LE BON ? Comparé en temps constant, comme à
 * la porte : une comparaison ordinaire dirait, par sa durée, jusqu'où deux
 * empreintes se ressemblent.
 */
export function motDePasseJuste(userId: string, motDePasse: string): boolean {
  const secret = secretDuCompte(userId);
  if (!secret) return false;
  const candidat = empreinte(motDePasse, Buffer.from(secret.salt, 'hex'));
  if (candidat.length !== secret.hash.length) return false;
  return crypto.timingSafeEqual(Buffer.from(candidat), Buffer.from(secret.hash));
}

/**
 * CHANGER SON IDENTIFIANT DE CONNEXION. Il est UNIQUE : un identifiant déjà
 * pris est refusé en le disant. La SESSION NE TOMBE PAS — elle est rattachée au
 * compte (`sessions.user_id`), pas à son identifiant : on ne met donc personne
 * dehors pour avoir changé son nom d'entrée.
 */
export function changerLIdentifiant(userId: string, brut: string): CompteUtilisateur {
  const compte = compteParId(userId);
  if (!compte) throw new Error('Ce compte est introuvable.');
  const identifiant = normaliserIdentifiant(brut);
  const verdict = jugerIdentifiant(identifiant);
  if (!verdict.ok) throw new Error(verdict.raison);
  const deja = compteParIdentifiant(identifiant);
  if (deja && deja.id !== userId) throw new Error('Cet identifiant est déjà pris.');
  if (identifiant === compte.identifiant) return compte;
  getDb().prepare('UPDATE users SET identifiant = ? WHERE id = ?').run(identifiant, userId);
  log.info('comptes', `identifiant « ${compte.identifiant} » devenu « ${identifiant} »`);
  return compteParId(userId)!;
}

/**
 * L'APPARENCE CHOISIE PAR UN COMPTE — le thème qui le suit d'un appareil à
 * l'autre. La valeur est celle qu'enregistre déjà le réglage général
 * (`ThemeChoisi`) ; une valeur vide efface le choix et rend la main au système.
 * Elle est JUGÉE avant d'être écrite : un texte inconnu est refusé plutôt que
 * gardé pour être ignoré ensuite.
 */
export function changerLApparence(userId: string, apparence: string): CompteUtilisateur {
  const compte = compteParId(userId);
  if (!compte) throw new Error('Ce compte est introuvable.');
  const propre = apparence.trim();
  const retenue = propre ? themeChoisiValide(propre) : null;
  if (propre && !retenue) throw new Error('Cette apparence n’existe pas.');
  getDb().prepare('UPDATE users SET apparence = ? WHERE id = ?').run(retenue, userId);
  return compteParId(userId)!;
}
