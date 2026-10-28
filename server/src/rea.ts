/**
 * REA SUR CETTE MACHINE, ET SON BRANCHEMENT SUR L'AGENT D'UN CLONAGE.
 *
 * REA (`rea-agents`, ~230 Mo de modules, plus le JAR JADX) ne vit PAS dans le
 * dépôt : il s'installe une fois sous `outils/rea/` (`scripts/installer-rea.mjs`),
 * comme Jev. Un serveur sans REA n'est pas en panne : l'agent du clonage n'a
 * simplement pas ses outils, et analyse la source par les pages publiques et
 * les captures.
 *
 * Le serveur MCP passe par le relais `scripts/rea-mcp.mjs`, qui ne laisse
 * passer que `OUTILS_REA_DU_CLONAGE` (≈ 40 Ko de schémas au lieu de 216 Ko).
 * JAMAIS `rea setup` : il inscrirait REA dans la configuration GLOBALE des
 * moteurs, donc dans tous les agents.
 */

import fs from 'node:fs';
import path from 'node:path';
import { JAR_JADX, OUTILS_REA_DU_CLONAGE } from '@beluga/shared';
import { CONFIG, ROOT } from './config.js';

const DOSSIER_REA = 'outils/rea';
const SCRIPT_REA = 'node_modules/rea-agents/scripts/rea.mjs';

/** Un serveur MCP, tel que les trois moteurs le lancent. */
export interface ServeurMcp {
  command: string;
  args: string[];
  env: Record<string, string>;
}

/** Où chercher REA, dans l'ordre. Un dossier imposé (`BELUGA_REA_DIR`) est le SEUL regardé. */
function dossiersCandidats(): string[] {
  const impose = process.env.BELUGA_REA_DIR?.trim();
  if (impose) return [impose];
  return [path.join(ROOT, DOSSIER_REA), path.join(CONFIG.depotDuDemon, DOSSIER_REA)];
}

/** Le dossier où REA est installé, s'il l'est. Relu à chaque appel : une installation en cours doit se voir. */
export function dossierRea(): string | undefined {
  for (const dossier of dossiersCandidats()) {
    try {
      if (fs.existsSync(path.join(dossier, SCRIPT_REA))) return dossier;
    } catch {
      /* un dossier illisible n'est pas une panne : on regarde le suivant */
    }
  }
  return undefined;
}

/** Le mode d'emploi livré avec REA, que l'agent du clonage lit en premier. */
export function cheminDuModeDEmploiRea(): string {
  const dossier = dossierRea() ?? path.join(CONFIG.depotDuDemon, DOSSIER_REA);
  return path.join(dossier, 'node_modules/rea-agents/skills/reverse-engineer-anything/SKILL.md');
}

/** Le relais versionné avec le démon. */
function relais(): string {
  const ici = path.join(ROOT, 'scripts', 'rea-mcp.mjs');
  return fs.existsSync(ici) ? ici : path.join(CONFIG.depotDuDemon, 'scripts', 'rea-mcp.mjs');
}

/**
 * LE SERVEUR MCP DE REA pour l'agent d'un clonage, ou `undefined` si REA n'est
 * pas installé. Profil compact, schémas de sortie éteints, réponse plafonnée,
 * Chrome du système, JADX vérifié et borné en mémoire (la machine en a peu).
 */
export function serveurMcpRea(): ServeurMcp | undefined {
  const dossier = dossierRea();
  if (!dossier) return undefined;
  const jar = path.join(dossier, 'jadx', JAR_JADX.nom);
  const env: Record<string, string> = {
    REA_SCRIPT: path.join(dossier, SCRIPT_REA),
    REA_OUTILS_PERMIS: OUTILS_REA_DU_CLONAGE.join(','),
    REA_MCP_INPUT_SCHEMA_PROFILE: 'compact',
    REA_MCP_OUTPUT_SCHEMA_PROFILE: 'off',
    REA_BROWSER_EXECUTABLE: '/usr/bin/google-chrome',
    REA_JADX_HEAP_MIB: '1024',
    PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
    HOME: process.env.HOME ?? '',
  };
  if (fs.existsSync(jar)) env.REA_JADX_MCP_JAR = jar;
  return { command: process.execPath, args: [relais()], env };
}
