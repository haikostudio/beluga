/**
 * EXÉCUTER LE TRANSFERT vers la cible réglée d'un projet (SSH ou FTP).
 *
 * Le type et les champs d'accès sont des règles PURES (`shared/src/cible-mise-en-production.ts`) :
 * ce fichier ne fait qu'EXÉCUTER — lancer les outils déjà présents sur la
 * machine (`rsync`, `sshpass`, `ssh`, `lftp`), jamais deviner un mot de passe
 * ou une clé qu'on n'a pas.
 *
 * Aucun argument ne passe par un interpréteur de commande : chaque appel va
 * directement à l'exécutable (`execFile`, jamais `bash -lc`), pour qu'un mot
 * de passe contenant des caractères spéciaux ne puisse jamais être interprété
 * comme une commande. Le mot de passe voyage par la variable d'environnement
 * `SSHPASS`, jamais sur la ligne de commande.
 */

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { AccesFTP, AccesSSH, Project } from '@haikodev/shared';
import { typeCibleReglee } from '@haikodev/shared';

const execFileAsync = promisify(execFile);

async function execArgv(
  cmd: string,
  args: string[],
  opts: { env?: NodeJS.ProcessEnv; timeout?: number } = {},
): Promise<{ ok: boolean; out: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(cmd, args, {
      env: opts.env,
      timeout: opts.timeout ?? 5 * 60 * 1000,
      maxBuffer: 8 * 1024 * 1024,
    });
    return { ok: true, out: (stdout + stderr).slice(-4000) };
  } catch (err: any) {
    return { ok: false, out: ((err?.stdout ?? '') + (err?.stderr ?? '') + (err?.message ?? '')).slice(-4000) };
  }
}

/** Écrit une clé privée dans un fichier temporaire à droits restreints, le temps de l'appel. */
async function avecFichierCle<T>(cle: string, action: (chemin: string) => Promise<T>): Promise<T> {
  const chemin = path.join(os.tmpdir(), `haikodev-cle-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fs.writeFileSync(chemin, cle.endsWith('\n') ? cle : `${cle}\n`, { mode: 0o600 });
  try {
    return await action(chemin);
  } finally {
    fs.rmSync(chemin, { force: true });
  }
}

/** Les dossiers construits usuels, dans l'ordre où on les cherche. */
export const DOSSIERS_CONSTRUITS_CANDIDATS = ['dist', 'build', 'out', 'web/dist', 'public'];

/**
 * Le dossier construit à transférer : celui réglé quand il existe, sinon le
 * premier des noms usuels trouvé sur le disque. `null` quand rien n'existe —
 * ce n'est pas une erreur à deviner, c'est un réglage à préciser.
 */
export function dossierConstruit(cwd: string, reglage?: string): string | null {
  if (reglage?.trim()) {
    const chemin = path.resolve(cwd, reglage.trim());
    return fs.existsSync(chemin) ? chemin : null;
  }
  for (const candidat of DOSSIERS_CONSTRUITS_CANDIDATS) {
    const chemin = path.join(cwd, candidat);
    if (fs.existsSync(chemin)) return chemin;
  }
  return null;
}

/** Dépose le contenu d'un dossier sur un serveur par SSH (rsync par-dessus SSH). */
export async function transfererParSSH(dossierSource: string, acces: AccesSSH): Promise<{ ok: boolean; out: string }> {
  const port = String(acces.port ?? 22);
  const distant = (acces.dossierDistant?.trim() || '.').replace(/\/*$/, '/');
  const cible = `${acces.utilisateur}@${acces.hote}:${distant}`;
  const rsyncArgs = (sshCommande: string) => ['-az', '-e', sshCommande, `${dossierSource}/`, cible];

  if (acces.cle?.trim()) {
    return avecFichierCle(acces.cle, (chemin) =>
      execArgv('rsync', rsyncArgs(`ssh -p ${port} -i ${chemin} -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null`)),
    );
  }
  if (acces.motDePasse?.trim()) {
    return execArgv(
      'sshpass',
      ['-e', 'rsync', ...rsyncArgs(`ssh -p ${port} -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null`)],
      { env: { ...process.env, SSHPASS: acces.motDePasse } },
    );
  }
  return { ok: false, out: 'ni mot de passe ni clé réglés pour la cible SSH' };
}

/** Lance la commande de fin sur le serveur, une fois les fichiers arrivés. */
export async function lancerCommandeFin(acces: AccesSSH): Promise<{ ok: boolean; out: string } | null> {
  const commande = acces.commandeFin?.trim();
  if (!commande) return null;
  const port = String(acces.port ?? 22);
  const cible = `${acces.utilisateur}@${acces.hote}`;
  const sshOptions = ['-p', port, '-o', 'StrictHostKeyChecking=no', '-o', 'UserKnownHostsFile=/dev/null'];

  if (acces.cle?.trim()) {
    return avecFichierCle(acces.cle, (chemin) => execArgv('ssh', [...sshOptions, '-i', chemin, cible, commande]));
  }
  if (acces.motDePasse?.trim()) {
    return execArgv('sshpass', ['-e', 'ssh', ...sshOptions, cible, commande], {
      env: { ...process.env, SSHPASS: acces.motDePasse },
    });
  }
  return { ok: false, out: 'ni mot de passe ni clé réglés pour la cible SSH' };
}

/** Dépose le contenu d'un dossier sur un serveur par FTP (ou FTPS), via `lftp`. */
export async function transfererParFTP(dossierSource: string, acces: AccesFTP): Promise<{ ok: boolean; out: string }> {
  const port = String(acces.port ?? 21);
  const distant = acces.dossierDistant?.trim() || '/';
  const protocole = acces.securise ? 'ftps' : 'ftp';
  const script = [
    acces.securise ? 'set ftp:ssl-force yes; set ssl:verify-certificate no;' : '',
    'set net:max-retries 2;',
    `mirror -R --parallel=4 "${dossierSource}" "${distant}"`,
    'quit',
  ]
    .filter(Boolean)
    .join(' ');
  return execArgv('lftp', ['-u', `${acces.utilisateur},${acces.motDePasse ?? ''}`, '-p', port, '-e', script, `${protocole}://${acces.hote}`]);
}

/**
 * EXÉCUTE la mise en production pour un type de cible SSH, FTP ou Aucune.
 *
 * Ne s'occupe JAMAIS du type « consigne » : c'est toujours l'agent qui suit le
 * prompt réglé (`confierLaMiseEnLigne`, dans `deploy.ts`), et cette fonction
 * n'est appelée que pour les trois autres types.
 */
export async function executerCibleMiseEnProduction(
  project: Project,
  cwd: string,
): Promise<{ ok: boolean; recit: string }> {
  const reglage = project.miseEnProduction;
  const type = typeCibleReglee(reglage);

  if (type === 'aucune') {
    return {
      ok: true,
      recit: 'Type de mise en production « Aucune » : projet local, rien n’est transféré. La branche a bien été fusionnée, enregistrée et envoyée.',
    };
  }

  if (type !== 'ssh' && type !== 'ftp') {
    return { ok: true, recit: '' };
  }

  const acces = type === 'ssh' ? reglage?.ssh : reglage?.ftp;
  const source = dossierConstruit(cwd, acces?.dossierConstruit);
  if (!source) {
    return {
      ok: false,
      recit: `Aucun dossier construit trouvé (${DOSSIERS_CONSTRUITS_CANDIDATS.join(', ')}) : rien n’a pu être transféré. Réglez « Dossier construit » si le nom diffère.`,
    };
  }

  const transfert = type === 'ssh' ? await transfererParSSH(source, reglage!.ssh!) : await transfererParFTP(source, reglage!.ftp!);
  if (!transfert.ok) {
    return { ok: false, recit: `Le transfert ${type.toUpperCase()} a échoué : ${transfert.out}` };
  }

  const chemin = path.relative(cwd, source) || '.';
  let recit = `Fichiers de « ${chemin} » transférés en ${type.toUpperCase()} vers ${acces?.hote}${
    acces?.dossierDistant ? ` (${acces.dossierDistant})` : ''
  }.`;

  if (type === 'ssh' && reglage?.ssh?.commandeFin?.trim()) {
    const fin = await lancerCommandeFin(reglage.ssh);
    if (fin && !fin.ok) {
      return { ok: false, recit: `${recit} La commande de fin a échoué : ${fin.out}` };
    }
    if (fin) recit += ' Commande de fin exécutée.';
  } else if (type === 'ftp' && reglage?.ftp?.dossierDistant) {
    recit += ' Le protocole FTP ne permet pas de lancer une commande de fin.';
  }

  return { ok: true, recit };
}
