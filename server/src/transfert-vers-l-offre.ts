/*
 * LE TRANSFERT D'UNE INSTALLATION GRATUITE VERS L'OFFRE HÉBERGÉE, CÔTÉ INSTALLATION (carte « Fin de la version gratuite »,
 * 21/11/2026). Le contrat avec le central — routes, formes, paquet — est écrit UNE fois dans
 * `shared/src/transfert-vers-l-offre.ts` ; ce module le tient :
 *
 *  - `mesurerLEspace` : les projets actifs et le volume (données + dossiers des projets), lus par `du` ;
 *  - `propositionDuCentral` : la mesure part au central, qui rend la formule conseillée, son prix et le lien
 *    d'abonnement (rien ne se calcule ici) ;
 *  - `recetteDuTransfert` : le travail suivi en direct (`installation-travaux.ts`, genre « transfert ») — attendre le
 *    paiement, recopier la base à chaud, emballer, envoyer par morceaux, vérifier, nettoyer.
 *
 * Rien ne part sans le clic « Transférer mon espace », et rien ne s'envoie avant que le central dise « pret » (payé).
 * Le paquet vit dans `data/transfert/` le temps de l'envoi, puis il est effacé — réussi ou non.
 */

import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  ATTENTE_DU_PAIEMENT_MS,
  EtatDuTransfert,
  PropositionDuCentral,
  ROUTES_DU_TRANSFERT,
  TAILLE_D_UN_MORCEAU,
  dossierDuProjetDansLePaquet,
  dossiersDeProjetsAEmporter,
  nombreDeMorceaux,
  volumeLisible,
  type ManifesteDuTransfert,
  type MesureDeLEspace,
} from '@beluga/shared';
import { CONFIG, PATHS } from './config.js';
import { getDb } from './db.js';
import type { RecetteDeTravail } from './installation-travaux.js';
import { log } from './logger.js';
import { adresseDuRelaisIci, appelerLeRelais, courrielPartageIci, secretAssure, versionDeLInstallation } from './relais-installations.js';
import * as store from './store.js';

const execFileAsync = promisify(execFile);

/** Les projets qui partent : actifs, hors projet de l'outil lui-même (le logiciel ne voyage pas). */
function projetsATransferer() {
  return store
    .listProjects(false)
    .filter((p) => !p.isSelf)
    .map((p) => ({ id: p.id, nom: p.name, chemin: p.path }));
}

/** La taille d'un dossier en octets (`du -sb`), 0 s'il n'existe pas ou ne se lit pas. */
async function tailleDe(dossier: string): Promise<number> {
  if (!dossier || !fs.existsSync(dossier)) return 0;
  try {
    const { stdout } = await execFileAsync('du', ['-sb', dossier], { timeout: 120_000 });
    return Number(stdout.split(/\s+/)[0]) || 0;
  } catch {
    return 0;
  }
}

/** Les projets actifs et le volume réellement transférés. */
export async function mesurerLEspace(): Promise<MesureDeLEspace> {
  const projets = projetsATransferer();
  const dossiers = dossiersDeProjetsAEmporter(projets, CONFIG.dataDir);
  const tailles = await Promise.all([tailleDe(CONFIG.dataDir), ...dossiers.map((p) => tailleDe(p.chemin))]);
  return { projetsActifs: projets.length, octets: tailles.reduce((a, b) => a + b, 0) };
}

export type RenduDeLOffre =
  | { ok: true; mesure: MesureDeLEspace; proposition: PropositionDuCentral }
  | { ok: false; mesure: MesureDeLEspace; raison: string };

/** La formule que le central conseille pour CET espace. */
export async function propositionDuCentral(): Promise<RenduDeLOffre> {
  const mesure = await mesurerLEspace();
  const cle = await secretAssure();
  if ('raison' in cle) return { ok: false, mesure, raison: cle.raison };
  const courriel = courrielPartageIci();
  const r = await appelerLeRelais<unknown>(ROUTES_DU_TRANSFERT.proposition, {
    installation: cle.id,
    secret: cle.secret,
    version: await versionDeLInstallation(),
    ...mesure,
    ...(courriel ? { courriel } : {}),
  });
  if (!r.ok) return { ok: false, mesure, raison: r.raison };
  const lu = PropositionDuCentral.safeParse(r.reponse);
  if (!lu.success) return { ok: false, mesure, raison: 'La réponse de l’équipe Beluga est illisible : réessayez plus tard.' };
  return { ok: true, mesure, proposition: lu.data };
}

const attendre = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

async function lireLEtat(cle: { id: string; secret: string }, jeton: string): Promise<EtatDuTransfert | { raison: string }> {
  const r = await appelerLeRelais<unknown>(ROUTES_DU_TRANSFERT.etat, { installation: cle.id, secret: cle.secret, jeton });
  if (!r.ok) return { raison: r.raison };
  const lu = EtatDuTransfert.safeParse(r.reponse);
  return lu.success ? lu.data : { raison: 'Réponse illisible.' };
}

/** Un morceau du paquet, envoyé tel quel ; trois essais avant d'abandonner. */
async function envoyerUnMorceau(cle: { id: string; secret: string }, jeton: string, rang: number, total: number, corps: Buffer): Promise<void> {
  const base = adresseDuRelaisIci();
  if (!base) throw new Error('Cette installation ne joint pas l’équipe Beluga.');
  const adresse = `${base}${ROUTES_DU_TRANSFERT.morceau}?${new URLSearchParams({ jeton, rang: String(rang), total: String(total) })}`;
  let derniere = '';
  for (let essai = 1; essai <= 3; essai++) {
    try {
      const r = await fetch(adresse, {
        method: 'POST',
        headers: {
          'content-type': 'application/octet-stream',
          'user-agent': 'BelugaBuild-relais/1',
          'x-beluga-installation': cle.id,
          'x-beluga-secret': cle.secret,
        },
        body: corps,
        signal: AbortSignal.timeout(300_000),
      });
      if (r.ok) return;
      derniere = `réponse ${r.status}`;
    } catch (e) {
      derniere = (e as Error).message;
    }
    await attendre(5_000 * essai);
  }
  throw new Error(`Le morceau ${rang + 1}/${total} n’est pas parti (${derniere}).`);
}

/** Ce qui manque de place pour fabriquer le paquet : au pire, autant que l'espace, plus 1 Go d'air. */
function placeLibre(dossier: string): number {
  try {
    const s = fs.statfsSync(dossier);
    return s.bavail * s.bsize;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

/**
 * LE TRAVAIL « TRANSFÉRER MON ESPACE ». Le clic a déjà ouvert la page d'abonnement : le travail attend que le central
 * dise « pret », puis fabrique et envoie le paquet. `jeton` vient de la proposition affichée.
 */
export function recetteDuTransfert(jeton: string): RecetteDeTravail {
  return {
    etapes: [],
    apres: async ({ ecrire }) => {
      const cle = await secretAssure();
      if ('raison' in cle) throw new Error(cle.raison);

      /* 1. LE PAIEMENT. Rien ne s'emballe avant lui. */
      ecrire('En attente du paiement de l’abonnement (la page de paiement s’est ouverte dans un nouvel onglet)…\n');
      const limite = Date.now() + ATTENTE_DU_PAIEMENT_MS;
      let etat = await lireLEtat(cle, jeton);
      while (!('raison' in etat) && etat.etat === 'attente-paiement' && Date.now() < limite) {
        await attendre(10_000);
        etat = await lireLEtat(cle, jeton);
      }
      if ('raison' in etat) throw new Error(etat.raison);
      if (etat.etat === 'attente-paiement') throw new Error('Le paiement n’est pas arrivé : recliquez « Transférer mon espace » une fois l’abonnement payé.');
      if (etat.etat === 'echec') throw new Error(etat.message ?? 'Le serveur hébergé n’a pas pu être préparé.');
      if (etat.etat === 'recu') {
        ecrire(`Votre espace a déjà été reçu${etat.adresse ? ` : ${etat.adresse}` : ''}.\n`);
        return;
      }
      ecrire('Abonnement payé : votre serveur hébergé attend votre espace.\n');

      /* 2. LE PAQUET, dans `data/transfert/`, effacé quoi qu'il arrive. */
      const travail = path.join(CONFIG.dataDir, 'transfert');
      fs.rmSync(travail, { recursive: true, force: true });
      fs.mkdirSync(travail, { recursive: true, mode: 0o700 });
      try {
        const mesure = await mesurerLEspace();
        if (placeLibre(CONFIG.dataDir) < mesure.octets + 1e9) {
          throw new Error(`Pas assez de place pour préparer le transfert : il faut ${volumeLisible(mesure.octets + 1e9)} de libre.`);
        }
        const projets = dossiersDeProjetsAEmporter(projetsATransferer(), CONFIG.dataDir).map((p) => ({ ...p, dossier: dossierDuProjetDansLePaquet(p) }));

        ecrire('Copie de la base de données, sans arrêter Beluga…\n');
        const nomDeLaBase = path.basename(PATHS.db);
        const base = path.join(travail, nomDeLaBase);
        await getDb().backup(base);

        ecrire(`Emballage des données et de ${projets.length} projet(s) (${volumeLisible(mesure.octets)})…\n`);
        /* Comme l'emport du central : des chemins relatifs à « / », renommés à l'entrée du paquet (`data/`,
           `projets/<dossier>/`). La base vive part SANS ses fichiers ouverts : sa copie cohérente la remplace. */
        const relatif = (c: string) => path.relative('/', path.resolve(c));
        /* Les signes spéciaux d'une expression BRE de sed (tar --transform), et la virgule qui la délimite. */
        const echapper = (c: string) => c.replace(/[\\^$.*[\],]/g, '\\$&');
        const data = relatif(CONFIG.dataDir);
        const espace = path.join(travail, 'espace.tar.gz');
        const args = [
          '-czf', espace, '--numeric-owner', '--ignore-failed-read',
          `--exclude=${relatif(travail)}`,
          ...['', '-wal', '-shm'].map((suffixe) => `--exclude=${data}/${nomDeLaBase}${suffixe}`),
          `--exclude=${data}/live`,
          `--transform=s,^${echapper(data)}\\(/\\|$\\),data\\1,S`,
          ...projets.map((p) => `--transform=s,^${echapper(relatif(p.chemin))}\\(/\\|$\\),projets/${p.dossier}\\1,S`),
          '-C', '/', data, ...projets.map((p) => relatif(p.chemin)),
        ];
        await execFileAsync('tar', args, { timeout: 6 * 60 * 60 * 1000, maxBuffer: 16 * 1024 * 1024 }).catch((e: any) => {
          // tar rend 1 quand un fichier a bougé pendant la lecture : le paquet reste bon.
          if (e?.code !== 1) throw new Error(`L’emballage a échoué : ${String(e?.stderr ?? e?.message ?? e).trim().slice(-400)}`);
        });
        const manifeste: ManifesteDuTransfert = {
          format: 1,
          origine: 'installation-gratuite',
          cree: Date.now(),
          version: await versionDeLInstallation(),
          installation: cle.id,
          tailleDonnees: mesure.octets,
          contenu: {
            data: CONFIG.dataDir,
            base: nomDeLaBase,
            projets: projets.map(({ id, nom, chemin, dossier }) => ({ id, nom, chemin, dossier })),
          },
        };
        fs.writeFileSync(path.join(travail, 'manifeste.json'), `${JSON.stringify(manifeste, null, 2)}\n`);
        const paquet = path.join(travail, 'espace-beluga.tar');
        await execFileAsync('tar', ['-cf', paquet, '-C', travail, 'manifeste.json', 'espace.tar.gz', nomDeLaBase], { timeout: 60 * 60 * 1000 });
        fs.rmSync(espace, { force: true });
        fs.rmSync(base, { force: true });

        /* 3. L'ENVOI, morceau par morceau, avec l'avancement. */
        const taille = fs.statSync(paquet).size;
        const total = nombreDeMorceaux(taille);
        const empreinte = crypto.createHash('sha256');
        ecrire(`Envoi de ${volumeLisible(taille)} vers votre serveur hébergé…\n`);
        const fd = fs.openSync(paquet, 'r');
        try {
          const tampon = Buffer.alloc(TAILLE_D_UN_MORCEAU);
          let dernierPourcent = -1;
          for (let rang = 0; rang < total; rang++) {
            const lus = fs.readSync(fd, tampon, 0, TAILLE_D_UN_MORCEAU, rang * TAILLE_D_UN_MORCEAU);
            const morceau = Buffer.from(tampon.subarray(0, lus));
            empreinte.update(morceau);
            await envoyerUnMorceau(cle, jeton, rang, total, morceau);
            const pourcent = Math.floor(((rang + 1) / total) * 100);
            if (pourcent >= dernierPourcent + 5 || rang + 1 === total) {
              dernierPourcent = pourcent;
              ecrire(`  ${pourcent} %\n`);
            }
          }
        } finally {
          fs.closeSync(fd);
        }

        /* 4. LA FIN : le central vérifie la taille et l'empreinte, puis remet l'espace en place. */
        const fin = await appelerLeRelais<{ adresse?: string }>(ROUTES_DU_TRANSFERT.fin, {
          installation: cle.id,
          secret: cle.secret,
          jeton,
          taille,
          sha256: empreinte.digest('hex'),
          morceaux: total,
        });
        if (!fin.ok) throw new Error(fin.raison);
        ecrire(`Votre espace est arrivé${fin.reponse.adresse ? ` : ouvrez ${fin.reponse.adresse}` : ''}. Vous recevez aussi un courriel avec l’adresse de votre nouvel espace.\n`);
        log.info(`transfert : espace envoyé vers l'offre hébergée (${volumeLisible(taille)}, ${total} morceau(x))`);
      } finally {
        fs.rmSync(travail, { recursive: true, force: true });
      }
    },
  };
}
