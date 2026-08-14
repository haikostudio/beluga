import fs from 'node:fs';
import path from 'node:path';
import { validerCleCerveau } from '@haikodev/shared';
import { CONFIG } from './config.js';
import { log } from './logger.js';

/**
 * La clé du cerveau : où on la lit, et comment on la POSE depuis les réglages.
 *
 * Elle vivait uniquement dans l'environnement du serveur : quand elle manquait,
 * l'écran le disait sans rien offrir pour y remédier. Elle se pose désormais
 * depuis le bloc des réglages, s'applique tout de suite (le passage suivant la
 * lit) et survit au redémarrage.
 */

/** Le fichier d'environnement du service, celui que systemd charge au départ. */
export function fichierEnvironnement(): string {
  return process.env.HAIKODEV_ENV_FILE?.trim() || '/etc/haikodev.env';
}

/** Le repli, dans le dossier de données, quand le fichier du service est hors d'atteinte. */
export function fichierDeRepli(): string {
  return path.join(CONFIG.dataDir, 'cerveau.cle');
}

const NOM = 'CERVEAU_API_KEY';

/** La valeur d'un nom dans un fichier d'environnement, sans jamais lever. */
function lireDansLeFichier(chemin: string, nom: string): string | undefined {
  let contenu: string;
  try {
    contenu = fs.readFileSync(chemin, 'utf8');
  } catch {
    return undefined;
  }
  for (const ligne of contenu.split('\n')) {
    const nette = ligne.trim();
    if (!nette || nette.startsWith('#')) continue;
    const sans = nette.startsWith('export ') ? nette.slice(7).trim() : nette;
    if (!sans.startsWith(`${nom}=`)) continue;
    const valeur = sans.slice(nom.length + 1).trim().replace(/^["']|["']$/g, '');
    if (valeur) return valeur;
  }
  return undefined;
}

function lireDansEnvironnement(chemin: string): string | undefined {
  return lireDansLeFichier(chemin, NOM);
}

/**
 * N'IMPORTE QUELLE VARIABLE DU SERVICE, lue comme la clé du cerveau :
 * l'environnement du démon d'abord, le fichier du service ensuite. C'est ce dont
 * la vectorisation a besoin (`server/src/vecteurs.ts`) — un démon lancé à la
 * main n'a pas forcément chargé `/etc/haikodev.env`.
 */
export function lireVariableDEnvironnement(nom: string): string | undefined {
  const enMemoire = process.env[nom]?.trim();
  if (enMemoire) return enMemoire;
  return lireDansLeFichier(fichierEnvironnement(), nom);
}

/**
 * La clé retenue, dans l'ordre : l'environnement du démon, puis le fichier du
 * service, puis le repli du dossier de données. Les deux derniers permettent à
 * une clé posée depuis les réglages de tenir après un redémarrage, quelle que
 * soit la façon dont le démon est relancé.
 *
 * L'ordre suit celui de l'ÉCRITURE, et ce n'est pas un détail : `enregistrerCleCerveau`
 * vise d'abord le fichier du service et ne se rabat sur le repli que s'il ne peut
 * pas y écrire. Le repli lu en premier masquait donc toute clé neuve posée dans le
 * fichier du service dès qu'un vieux repli traînait.
 */
export function lireCleCerveau(): string | undefined {
  const enMemoire = process.env[NOM]?.trim();
  if (enMemoire) return enMemoire;
  const service = lireDansEnvironnement(fichierEnvironnement());
  if (service) return service;
  try {
    const repli = fs.readFileSync(fichierDeRepli(), 'utf8').trim();
    if (repli) return repli;
  } catch {
    /* pas de repli posé */
  }
  return undefined;
}

/** Remplace (ou ajoute) la ligne de la clé sans toucher au reste du fichier. */
function ecrireDansEnvironnement(chemin: string, cle: string): void {
  let lignes: string[] = [];
  try {
    lignes = fs.readFileSync(chemin, 'utf8').split('\n');
  } catch {
    /* fichier encore absent : on le crée */
  }
  const ligne = `${NOM}=${cle}`;
  let remplacee = false;
  lignes = lignes.map((brute) => {
    const nette = brute.trim();
    const sans = nette.startsWith('export ') ? nette.slice(7).trim() : nette;
    if (!sans.startsWith(`${NOM}=`)) return brute;
    remplacee = true;
    return ligne;
  });
  if (!remplacee) {
    while (lignes.length && !lignes[lignes.length - 1].trim()) lignes.pop();
    lignes.push(ligne);
  }
  fs.writeFileSync(chemin, `${lignes.join('\n').replace(/\n+$/, '')}\n`, { mode: 0o600 });
}

export interface PoseDeCle {
  ok: boolean;
  /** Où la clé a été rangée, dit en français dans l'interface. */
  endroit?: string;
  raison?: string;
}

/**
 * Poser la clé : on l'applique d'abord à l'instant (le prochain envoi la lit),
 * puis on la range pour qu'elle survive au redémarrage — dans le fichier du
 * service si on peut y écrire, sinon dans le dossier de données.
 */
export function enregistrerCleCerveau(saisie: string): PoseDeCle {
  const juge = validerCleCerveau(saisie);
  if (!juge.ok) return { ok: false, raison: juge.raison };

  process.env[NOM] = juge.cle;

  const service = fichierEnvironnement();
  try {
    ecrireDansEnvironnement(service, juge.cle);
    return { ok: true, endroit: service };
  } catch (err) {
    log.warn(`cerveau : ${service} non modifiable, clé rangée dans le dossier de données`, err);
  }

  try {
    fs.mkdirSync(path.dirname(fichierDeRepli()), { recursive: true });
    fs.writeFileSync(fichierDeRepli(), `${juge.cle}\n`, { mode: 0o600 });
    return { ok: true, endroit: fichierDeRepli() };
  } catch (err: any) {
    // La clé tient pour ce démon-ci, mais pas au-delà : ça se dit.
    return { ok: false, raison: err?.message ?? 'clé non enregistrée' };
  }
}
