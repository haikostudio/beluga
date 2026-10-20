import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  CLE_STRUCTURATION_DU_COFFRE,
  jugerStructuration,
  structurerFiche,
  type AccesCoffre,
  type FicheNee,
} from '@beluga/shared';
import { listerAcces } from './coffre-fort.js';
import { DEMON_D_ESSAI, PATHS } from './config.js';
import { getDb, getMeta, setMeta } from './db.js';
import { log } from './logger.js';

/**
 * LA REMISE EN ORDRE DES FICHES DU COFFRE, APPLIQUÉE UNE FOIS (20/10/2026).
 *
 * Les règles sont pures (`shared/src/coffre-structuration.ts`) ; ici, on les
 * applique à la base, UNE seule fois — la clé `CLE_STRUCTURATION_DU_COFFRE` de
 * la table `meta` le retient. L'ordre ne se discute pas :
 *
 *  1. LA COPIE DE SÉCURITÉ D'ABORD, sur le DISQUE DE STOCKAGE, jamais sur celui du
 *     serveur : toutes les fiches et tous les dossiers, relus avant la moindre
 *     écriture. Sans disque de stockage, ou copie illisible : rien n'est touché.
 *  2. Chaque fiche passe les règles du coffre et le contrôle « rien de perdu » ;
 *     une fiche qui échoue est écartée, jamais appliquée.
 *  3. Tout s'écrit dans UNE transaction ; la date de modification des fiches ne
 *     bouge pas (la liste garde son ordre).
 *
 * Le retour arrière : `node scripts/structurer-coffre.mjs --revenir <copie>`.
 */

export interface BilanDeStructuration {
  fait: boolean;
  raison?: string;
  copie?: string;
  changees?: number;
  creees?: number;
  ecartees?: { id: string; nom: string; raison: string }[];
  aCompleter?: { id: string; nom: string; manque: string[] }[];
}

/** Le dossier des copies, sur le disque de stockage ; `null` = pas de disque de stockage. */
export function dossierDesCopiesDuCoffre(): string | null {
  return PATHS.attachmentsStockage ? path.join(path.dirname(PATHS.attachmentsStockage), 'beluga-coffre-structuration') : null;
}

export function remettreLeCoffreEnOrdre(opts: { sauvegarde: string | null; maintenant?: number }): BilanDeStructuration {
  if (getMeta(CLE_STRUCTURATION_DU_COFFRE)) return { fait: false, raison: 'déjà faite' };
  const maintenant = opts.maintenant ?? Date.now();

  const aChanger: { fiche: AccesCoffre; apres: ReturnType<typeof structurerFiche> & object; nees: (FicheNee & { id: string })[] }[] = [];
  const ecartees: NonNullable<BilanDeStructuration['ecartees']> = [];
  const aCompleter: NonNullable<BilanDeStructuration['aCompleter']> = [];
  for (const fiche of listerAcces()) {
    const s = structurerFiche(fiche);
    if (!s) continue;
    const verdict = jugerStructuration(fiche, s);
    if (!verdict.ok) {
      ecartees.push({ id: fiche.id, nom: fiche.nom, raison: verdict.raison });
      continue;
    }
    aChanger.push({ fiche, apres: s, nees: (s.creer ?? []).map((f) => ({ ...f, id: crypto.randomUUID() })) });
    if (verdict.aCompleter.length) aCompleter.push({ id: fiche.id, nom: fiche.nom, manque: verdict.aCompleter });
  }

  const marquer = (bilan: BilanDeStructuration) => {
    setMeta(CLE_STRUCTURATION_DU_COFFRE, JSON.stringify({ le: maintenant, ...bilan }));
    return bilan;
  };
  if (!aChanger.length) return marquer({ fait: true, changees: 0, creees: 0, ecartees, aCompleter });

  // 1. LA COPIE, relue avant toute écriture.
  if (!opts.sauvegarde) return { fait: false, raison: 'pas de disque de stockage pour la copie de sécurité : rien n’est touché' };
  let copie: string;
  try {
    fs.mkdirSync(opts.sauvegarde, { recursive: true });
    copie = path.join(opts.sauvegarde, `coffre-avant-${new Date(maintenant).toISOString().replace(/[:.]/g, '-')}.json`);
    const contenu = {
      prise: maintenant,
      fiches: getDb().prepare('SELECT * FROM secrets').all(),
      dossiers: getDb().prepare('SELECT * FROM dossiers_coffre').all(),
      nees: aChanger.flatMap((a) => a.nees.map((n) => n.id)),
    };
    fs.writeFileSync(copie, JSON.stringify(contenu), { mode: 0o600 });
    const relue = JSON.parse(fs.readFileSync(copie, 'utf8'));
    if (relue.fiches?.length !== contenu.fiches.length) throw new Error('copie relue incomplète');
  } catch (err) {
    return { fait: false, raison: `copie de sécurité impossible (${(err as Error).message}) : rien n’est touché` };
  }

  // 2 et 3. Une seule transaction.
  const db = getDb();
  const maj = db.prepare('UPDATE secrets SET type = ?, champs = ?, note = ?, champs_libres = ? WHERE id = ? AND archive_le IS NULL');
  const ajout = db.prepare(
    'INSERT INTO secrets (id, nom, type, project_id, champs, note, images, dossier_id, champs_libres, cree_le, modifie_le) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  );
  let creees = 0;
  db.transaction(() => {
    for (const { fiche, apres, nees } of aChanger) {
      const a = apres.apres;
      maj.run(a.type, JSON.stringify(a.champs), a.note, JSON.stringify(a.champsLibres), fiche.id);
      for (const n of nees) {
        ajout.run(n.id, n.nom, n.type, fiche.projectId, JSON.stringify(n.champs), n.note, '[]', fiche.dossierId ?? null, JSON.stringify(n.champsLibres), maintenant, maintenant);
        creees += 1;
      }
    }
  })();

  const bilan = marquer({ fait: true, copie, changees: aChanger.length, creees, ecartees, aCompleter });
  log.info(
    `coffre-fort : remise en ordre faite — ${aChanger.length} fiche(s) rangée(s), ${creees} créée(s), ${ecartees.length} écartée(s), ${aCompleter.length} à compléter ; copie : ${copie}`,
  );
  return bilan;
}

/** Au démarrage du VRAI démon seulement : un essai ne touche jamais au coffre, et rien ne fait tomber le démarrage. */
export function remettreLeCoffreEnOrdreAuDemarrage(): void {
  if (DEMON_D_ESSAI) return;
  try {
    const bilan = remettreLeCoffreEnOrdre({ sauvegarde: dossierDesCopiesDuCoffre() });
    if (!bilan.fait && bilan.raison !== 'déjà faite') log.warn(`coffre-fort : remise en ordre reportée — ${bilan.raison}`);
  } catch (err) {
    log.warn(`coffre-fort : remise en ordre en échec, rien n’est touché — ${(err as Error).message}`);
  }
}
