import { execFile } from 'node:child_process';
import path from 'node:path';
import { VARIABLE_CLE_COMPETENCES } from '@beluga/shared';
import { listerAcces } from './coffre-fort.js';
import { CONFIG, DEMON_D_ESSAI } from './config.js';
import { log } from './logger.js';
import { machineHebergee } from './offre-hebergee.js';
import { relaisRecepteurIci } from './relais-installations.js';

/**
 * LE DÉPÔT DE NUIT DU LOT DES SERVEURS CLIENTS (machine de l'auteur seulement).
 *
 * Une fois par nuit, vers 4 h, le démon lance `scripts/lot-competences-clients.mjs
 * --deposer` : le lot est refabriqué SI le pool a changé (sinon reconnu à son
 * empreinte), et déposé au central SI sa version n'y est pas déjà. La clé et le
 * jeton sont lus au coffre-fort, par le NOM de leur fiche, et passés au script
 * par son environnement — jamais écrits ailleurs.
 *
 * Garde : la même que le relais des installations (`relaisRecepteurIci`), et
 * jamais depuis un démon d'essai ni depuis un serveur loué.
 */
export const FICHE_CLE_DU_LOT = 'Clé des compétences protégées — serveurs clients';
export const FICHE_JETON_DU_LOT = 'Central — jeton de dépôt du lot de compétences (production)';
const HEURE_DU_DEPOT = 4;
const PERIODE_MS = 60 * 60 * 1000;

let dernierJour = '';
let enCours = false;

function valeurDeLaFiche(nom: string, champ: string): string | undefined {
  const fiche = listerAcces().find((a) => a.nom === nom && !a.archiveLe);
  return fiche?.champs?.[champ]?.trim() || undefined;
}

/** Lance le dépôt maintenant (bouton, essai à la main) ; rend la sortie du script. */
export function deposerLeLotMaintenant(): Promise<{ ok: boolean; sortie: string }> {
  const cle = valeurDeLaFiche(FICHE_CLE_DU_LOT, 'cle');
  const jeton = valeurDeLaFiche(FICHE_JETON_DU_LOT, 'jeton');
  const adresse = valeurDeLaFiche(FICHE_JETON_DU_LOT, 'adresse');
  if (!cle || !jeton) {
    return Promise.resolve({ ok: false, sortie: `fiche « ${!cle ? FICHE_CLE_DU_LOT : FICHE_JETON_DU_LOT} » absente du coffre-fort` });
  }
  const central = adresse ? new URL(adresse).origin : undefined;
  const script = path.join(CONFIG.selfPath, 'scripts', 'lot-competences-clients.mjs');
  return new Promise((resoudre) => {
    execFile(
      'nice',
      ['-n', '15', process.execPath, script, '--deposer', '--silencieux'],
      {
        cwd: CONFIG.selfPath,
        timeout: 30 * 60 * 1000,
        maxBuffer: 4 * 1024 * 1024,
        env: {
          ...process.env,
          [VARIABLE_CLE_COMPETENCES]: cle,
          BELUGA_JETON_LOT_COMPETENCES: jeton,
          ...(central ? { BELUGA_CENTRAL_ADRESSE: central } : {}),
        },
      },
      (err, stdout, stderr) => resoudre({ ok: !err, sortie: `${stdout}${stderr}`.trim() }),
    );
  });
}

async function tour(): Promise<void> {
  const maintenant = new Date();
  const jour = maintenant.toISOString().slice(0, 10);
  if (enCours || maintenant.getHours() !== HEURE_DU_DEPOT || dernierJour === jour) return;
  enCours = true;
  dernierJour = jour;
  try {
    const { ok, sortie } = await deposerLeLotMaintenant();
    const derniere = sortie.split('\n').filter(Boolean).slice(-1)[0] ?? '';
    if (ok) log.info(`lot de compétences des serveurs clients : ${derniere}`);
    else log.warn(`lot de compétences des serveurs clients non déposé : ${derniere}`);
  } finally {
    enCours = false;
  }
}

export function planifierLeDepotDuLot(): void {
  if (DEMON_D_ESSAI || machineHebergee() || !relaisRecepteurIci()) return;
  const minuterie = setInterval(() => void tour(), PERIODE_MS / 4);
  minuterie.unref?.();
}
