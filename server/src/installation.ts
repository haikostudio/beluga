import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  ALPHABET_DU_CODE,
  IDENTITE_VIERGE,
  LONGUEUR_DU_CODE,
  MUR_FENETRE_MS,
  codeEnGroupes,
  codeNormalise,
  decisionDuMur,
  definirIdentiteDInstallation,
  formeDeCodeValide,
  nettoyerIdentite,
  type IdentiteDInstallation,
} from '@beluga/shared';
import { CONFIG, DEMON_D_ESSAI, PREMIER_DEMARRAGE_REEL, ROOT } from './config.js';
import { creerCompte, nombreDAdministrateurs } from './comptes.js';
import { getDb, getMeta, setMeta } from './db.js';
import { log } from './logger.js';
import { inscrireLeProjetDeLOutil } from './projects.js';
import { getSettings, saveSettings } from './store.js';

/**
 * L'INSTALLATION, CÔTÉ DÉMON : son identité, et son premier accès.
 *
 * Les règles vivent dans `shared/src/installation.ts`. Ici : la base, le disque,
 * et les deux moments où une installation se distingue d'une autre —
 *  - AU DÉMARRAGE, l'identité enregistrée est posée en mémoire pour tout le
 *    code qui la lit ; une installation d'AVANT les réglages reprend, une
 *    seule fois, les valeurs qui étaient écrites dans le code ;
 *  - AU PREMIER DÉMARRAGE d'une installation neuve, un code à usage unique est
 *    tiré : c'est lui qui garde la création du premier compte.
 */

/* ------------------------------------------------------------------ */
/* L'identité                                                           */
/* ------------------------------------------------------------------ */

const CLE_REPRISE = 'installation.reprise';

/**
 * Le fichier des valeurs d'une installation d'avant les réglages. Il vit dans
 * `prive/`, qui ne part JAMAIS au dépôt public : une installation faite depuis
 * la copie publique ne le trouve pas, et démarre donc sans aucune valeur.
 */
function fichierDeReprise(): string | null {
  const candidats = [path.join(ROOT, 'prive', 'identite-installation.json'), path.join(CONFIG.depotDuDemon, 'prive', 'identite-installation.json')];
  return candidats.find((chemin) => fs.existsSync(chemin)) ?? null;
}

/**
 * UN DÉMON D'ESSAI NE REPREND PAS L'IDENTITÉ DE L'INSTALLATION D'ORIGINE. Levé
 * du dépôt de travail pour juger un écran, il montrait les adresses de cette
 * installation dans des champs qui sont VIDES chez tout le monde : la capture
 * mentait sur ce qu'un nouvel utilisateur verra. Un essai démarre donc vierge,
 * comme l'arbre public. Le contrôle qui a besoin de l'identité complète (porte
 * de l'espace client, aperçu des courriels) la DEMANDE : `BELUGA_IDENTITE_REPRISE=1`.
 */
function repriseAutorisee(): boolean {
  return !DEMON_D_ESSAI || process.env.BELUGA_IDENTITE_REPRISE === '1';
}

function identiteVierge(identite: IdentiteDInstallation): boolean {
  return Object.values(identite).every((valeur) => !valeur);
}

/**
 * POSE L'IDENTITÉ AU DÉMARRAGE. Trois sources, dans cet ordre :
 *  1. ce que les réglages portent déjà — rien n'y est jamais écrasé ;
 *  2. sur une identité encore vierge, le fichier de reprise — une seule fois,
 *     et jamais sur un démon d'essai qui ne l'a pas demandé (`repriseAutorisee`) ;
 *  3. l'adresse donnée par l'installation (`BELUGA_ADRESSE_PUBLIQUE`), tant
 *     qu'aucune adresse n'est réglée.
 */
export function chargerLIdentiteDInstallation(): IdentiteDInstallation {
  let identite = nettoyerIdentite(getSettings().installation ?? IDENTITE_VIERGE);

  /*
   * LA REPRISE N'EST NOTÉE « FAITE » QUE LORSQU'ELLE A EU LIEU. Un démarrage où
   * le fichier manquerait — dépôt en cours de fusion, copie incomplète — ne
   * doit pas la condamner : sans cette précaution, l'installation d'origine
   * perdrait ses adresses pour de bon au premier faux départ. Une installation
   * faite depuis la copie publique n'a jamais ce fichier : elle regarde, ne
   * trouve rien, et reste vierge.
   */
  if (getMeta(CLE_REPRISE) !== '1' && identiteVierge(identite) && repriseAutorisee()) {
    const fichier = fichierDeReprise();
    if (fichier) {
      try {
        identite = nettoyerIdentite(JSON.parse(fs.readFileSync(fichier, 'utf8')) as Partial<IdentiteDInstallation>);
        saveSettings({ installation: identite });
        setMeta(CLE_REPRISE, '1');
        log.info(`identité de l'installation reprise de ${path.relative(ROOT, fichier) || fichier}`);
      } catch (err: any) {
        log.warn("identité de l'installation : fichier de reprise illisible", err?.message ?? err);
      }
    }
  }

  const donnee = (process.env.BELUGA_ADRESSE_PUBLIQUE ?? '').trim();
  if (donnee && !identite.adressePublique) {
    identite = nettoyerIdentite({ ...identite, adressePublique: donnee });
    saveSettings({ installation: identite });
  }

  return definirIdentiteDInstallation(identite);
}

/* ------------------------------------------------------------------ */
/* Le code d'installation                                               */
/* ------------------------------------------------------------------ */

/** La clé de `meta` qui garde le code HACHÉ — jamais le code lui-même. */
export const CLE_DU_CODE = 'installation.code';

function hacher(code: string): string {
  return crypto.createHash('sha256').update(`beluga-installation:${codeNormalise(code)}`).digest('hex');
}

function tirerUnCode(): string {
  let code = '';
  for (let i = 0; i < LONGUEUR_DU_CODE; i++) code += ALPHABET_DU_CODE[crypto.randomInt(ALPHABET_DU_CODE.length)];
  return code;
}

/** L'installation attend-elle encore son premier compte ? */
export function installationEnAttente(): boolean {
  return PREMIER_DEMARRAGE_REEL && nombreDAdministrateurs() === 0;
}

/**
 * TIRE LE CODE AU PREMIER DÉMARRAGE et le rend EN CLAIR, une seule fois, pour
 * le journal du terminal. Un code déjà tiré n'est pas remplacé ici : le script
 * `scripts/code-installation.mjs` en tire un neuf à la demande, pour qui a
 * perdu le premier.
 */
export function preparerLeCodeDInstallation(): string | null {
  if (!installationEnAttente()) return null;
  // Une installation neuve s'ouvre sur l'assistant ; le noter ici, c'est le
  // noter une seule fois, au même moment que le code.
  const assistant = getSettings().assistant;
  if (assistant.statut !== 'a-faire' && !Object.keys(assistant.etapes).length) {
    saveSettings({ assistant: { statut: 'a-faire', etapes: {} } });
  }
  if (getMeta(CLE_DU_CODE)) return null;
  const code = tirerUnCode();
  setMeta(CLE_DU_CODE, hacher(code));
  return codeEnGroupes(code);
}

/**
 * TIRE UN CODE NEUF À LA DEMANDE, pour qui a perdu le premier. Appelé par
 * `scripts/code-installation.mjs`, sur le serveur : il faut déjà avoir la main
 * sur la machine pour le lancer. Rend `null` quand un administrateur existe —
 * la porte est fermée, aucun code ne la rouvre.
 */
export function renouvelerLeCodeDInstallation(): string | null {
  if (nombreDAdministrateurs() > 0) return null;
  const code = tirerUnCode();
  setMeta(CLE_DU_CODE, hacher(code));
  return codeEnGroupes(code);
}

export interface PremierCompte {
  code: string;
  nomAffiche: string;
  identifiant: string;
  motDePasse: string;
}

export type ResultatDuPremierCompte =
  | { ok: true; identifiant: string }
  | { ok: false; raison: 'ferme' | 'trop-d-essais' | 'code' | 'compte'; message: string };

function essaisRates(ip: string): number[] {
  const rows = getDb()
    .prepare('SELECT at FROM auth_attempts WHERE ip = ? AND ok = 0 AND at > ?')
    .all(ip, Date.now() - MUR_FENETRE_MS) as { at: number }[];
  return rows.map((r) => r.at);
}

/**
 * CRÉE LE PREMIER ADMINISTRATEUR, si le code est le bon.
 *
 * Quatre gardes, dans cet ordre :
 *  1. la porte n'existe que tant qu'AUCUN administrateur n'existe ;
 *  2. les essais ratés d'une adresse sont comptés comme ceux du mur d'accès —
 *     trois, espacés de cinq minutes — et un refus ne regarde même pas le code ;
 *  3. le code est comparé HACHÉ, en temps constant ;
 *  4. le compte passe par `creerCompte`, donc par les mêmes règles
 *     d'identifiant et de mot de passe que tout autre compte.
 * Le code est effacé dès que le compte existe : il ne sert qu'une fois.
 */
export function creerLePremierCompte(demande: PremierCompte, ip: string): ResultatDuPremierCompte {
  if (!installationEnAttente()) {
    return { ok: false, raison: 'ferme', message: 'Cette installation a déjà son compte : utilisez la page de connexion.' };
  }
  const decision = decisionDuMur(essaisRates(ip), Date.now());
  if (!decision.autorise) {
    return { ok: false, raison: 'trop-d-essais', message: decision.message ?? 'Trop de tentatives.' };
  }

  const attendu = getMeta(CLE_DU_CODE) ?? '';
  const donne = formeDeCodeValide(demande.code) ? hacher(demande.code) : '';
  const bon =
    !!attendu && donne.length === attendu.length && crypto.timingSafeEqual(Buffer.from(donne), Buffer.from(attendu));
  if (!bon) {
    getDb().prepare('INSERT INTO auth_attempts (ip, at, ok) VALUES (?, ?, 0)').run(ip, Date.now());
    return { ok: false, raison: 'code', message: "Ce code d'installation n'est pas le bon." };
  }

  try {
    const cree = creerCompte(
      {
        identifiant: demande.identifiant,
        role: 'admin',
        nomAffiche: demande.nomAffiche.trim() || demande.identifiant,
        motDePasse: demande.motDePasse,
      },
      [],
    );
    getDb().prepare('DELETE FROM meta WHERE key = ?').run(CLE_DU_CODE);
    log.info(`premier compte créé par le code d'installation : ${cree.compte.identifiant}`);
    // Le projet de l'outil arrive sur le tableau avec le premier compte : c'est de là qu'on modifie
    // Beluga, GitHub relié ou non. Sans effet sur l'offre hébergée. Une panne ici ne défait pas le compte.
    void inscrireLeProjetDeLOutil().catch((err) => log.warn("projet de l'outil non inscrit", err));
    return { ok: true, identifiant: cree.compte.identifiant };
  } catch (err: any) {
    // Un identifiant ou un mot de passe refusé n'est pas un essai de code raté.
    return { ok: false, raison: 'compte', message: err?.message ?? 'Compte refusé.' };
  }
}
