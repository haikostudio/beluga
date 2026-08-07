import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  AccesVps,
  accesDepuisReglages,
  accesRenseignes,
  argumentsSsh,
  messageErreurSsh,
} from '@haikodev/shared';
import { getSettings } from './store.js';

const execFileAsync = promisify(execFile);

/** Les accès réglés dans l'onglet Système, tels que le serveur les voit. */
export function accesVpsActuel(): AccesVps {
  return accesDepuisReglages(getSettings());
}

export interface TestVps {
  ok: boolean;
  message: string;
}

/**
 * « Tester la connexion » : lance une commande anodine sur la machine et dit en
 * clair si elle répond, ou pourquoi elle refuse. Aucune autre commande n'est
 * jamais lancée par ce chemin.
 */
export async function testerConnexionVps(acces: AccesVps = accesVpsActuel()): Promise<TestVps> {
  if (!accesRenseignes(acces)) {
    return { ok: false, message: "Renseignez au moins l'adresse de la machine et l'utilisateur." };
  }
  const { programme, args } = argumentsSsh(acces, 'echo haikodev-ok');
  try {
    const { stdout } = await execFileAsync(programme, args, { timeout: 20000 });
    if (stdout.includes('haikodev-ok')) {
      return { ok: true, message: `La machine ${acces.hote} répond.` };
    }
    return { ok: false, message: 'La machine a répondu, mais pas comme attendu.' };
  } catch (err: any) {
    const sortie = [err?.stderr, err?.stdout, err?.message].filter(Boolean).join('\n');
    return { ok: false, message: messageErreurSsh(sortie) };
  }
}
