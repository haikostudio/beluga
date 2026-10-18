import { execFile } from 'node:child_process';
import dns from 'node:dns';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  DOSSIER_DES_CLES_DKIM,
  SELECTEUR_DKIM,
  dkimDepuisLeFichier,
  domaineDeLAdresse,
  enregistrementsAttendus,
  hoteNu,
  identiteDInstallation,
  nomDeDomaineValide,
  spfParmi,
  texteDuTxt,
  txtsAvecSpf,
  verdictDesControles,
  type ConstatDeLEnvoiDirect,
  type EnregistrementAttendu,
  type PointDeControle,
} from '@beluga/shared';
import { piloteRetenu, serverIp } from './dns.js';
import { agentDEnvoi, sortieDirecteGardee } from './envoi-des-courriels.js';
import type { PiloteDeNoms } from './fournisseurs-de-noms.js';
import { log } from './logger.js';

const execFileAsync = promisify(execFile);

/**
 * L'ENVOI DIRECT PAR CE SERVEUR, RENDU FIABLE.
 *
 * Un serveur neuf qui envoie lui-même voit ses courriels refusés (ou rangés en
 * indésirables) par Gmail et les autres tant que trois choses manquent : le
 * domaine de l'expéditeur doit l'AUTORISER (SPF), le serveur doit SIGNER ses
 * courriels avec une clé publiée dans ce domaine (DKIM), et son adresse doit
 * avoir un NOM INVERSE qui mène à elle (PTR). DMARC, enfin, dit aux boîtes
 * quoi faire d'un courriel qui ne passe pas.
 *
 * Ce module CONSTATE (DNS public, fichier de clé, journal de l'agent) et
 * ÉCRIT ce qui peut l'être : les TXT chez le fournisseur de noms quand Beluga
 * Build le pilote, le nom de l'agent d'envoi aligné sur le nom inverse, et le
 * nom inverse lui-même chez Hetzner Cloud quand son jeton est connu. La
 * signature, elle, s'installe d'un bouton (genre `signature-des-courriels`,
 * `installation-travaux.ts`). Les jugements vivent dans
 * `shared/src/remise-des-courriels.ts`.
 */


/** Un résolveur PUBLIC : ce que voient les boîtes de réception, pas le cache de cette machine. */
function resolveur(): dns.promises.Resolver {
  const r = new dns.promises.Resolver({ timeout: 5000, tries: 2 });
  r.setServers(['1.1.1.1', '8.8.8.8']);
  return r;
}

async function txtsPublics(nom: string): Promise<string[]> {
  try {
    return (await resolveur().resolveTxt(nom)).map((morceaux) => texteDuTxt(morceaux.map((m) => `"${m}"`).join(' ')));
  } catch {
    return [];
  }
}

/** La clé publique de la signature locale, telle qu'`opendkim-genkey` l'a écrite. `null` : pas de signature installée. */
async function dkimLocal(domaine: string): Promise<string | null> {
  if (!domaine) return null;
  const fichier = path.join(DOSSIER_DES_CLES_DKIM, domaine, `${SELECTEUR_DKIM}.txt`);
  try {
    return dkimDepuisLeFichier(fs.readFileSync(fichier, 'utf8'));
  } catch {
    try {
      const { stdout } = await execFileAsync('sudo', ['-n', 'cat', fichier], { timeout: 10000 });
      return dkimDepuisLeFichier(stdout);
    } catch {
      return null;
    }
  }
}

async function nomInverse(ip: string): Promise<{ ptr: string | null; meneIci: boolean }> {
  if (!ip) return { ptr: null, meneIci: false };
  try {
    const ptr = (await resolveur().reverse(ip))[0]?.replace(/\.$/, '') ?? null;
    if (!ptr) return { ptr: null, meneIci: false };
    const adresses = await resolveur()
      .resolve4(ptr)
      .catch(() => [] as string[]);
    return { ptr, meneIci: adresses.includes(ip) };
  } catch {
    return { ptr: null, meneIci: false };
  }
}

/** Ce qu'on constate, là, maintenant, de l'envoi direct. */
export async function constatDeLEnvoiDirect(): Promise<ConstatDeLEnvoiDirect> {
  const domaine = domaineDeLAdresse(identiteDInstallation().expediteurDesCourriels);
  const [sortie, ip] = await Promise.all([sortieDirecteGardee(), serverIp().catch(() => '')]);
  const [spfs, dkim, dkimPublies, dmarcs, inverse] = await Promise.all([
    domaine ? txtsPublics(domaine) : Promise.resolve([]),
    dkimLocal(domaine),
    domaine ? txtsPublics(`${SELECTEUR_DKIM}._domainkey.${domaine}`) : Promise.resolve([]),
    domaine ? txtsPublics(`_dmarc.${domaine}`) : Promise.resolve([]),
    nomInverse(ip),
  ]);
  return {
    agent: agentDEnvoi() !== null,
    port25: sortie.port25,
    domaine,
    ip,
    spf: spfParmi(spfs),
    dkimLocal: dkim,
    dkimPublie: dkimPublies.find((txt) => /\bp=/.test(txt)) ?? null,
    dmarc: dmarcs.find((txt) => /^v=DMARC1/i.test(txt)) ?? null,
    ptr: inverse.ptr,
    ptrMeneIci: inverse.meneIci,
  };
}

export interface ControlesDeLEnvoiDirect {
  domaine: string;
  ip: string;
  ptr: string | null;
  points: PointDeControle[];
  /** Les enregistrements que le domaine doit porter et ne porte pas encore. */
  aPoser: EnregistrementAttendu[];
  /** Beluga Build peut-il les poser lui-même (fournisseur de noms piloté) ? */
  posables: boolean;
  /** La signature (DKIM) est-elle installée sur ce serveur ? */
  signature: boolean;
}

/** LA LISTE D'AVANT L'ESSAI : les points, et les enregistrements qui manquent. */
export async function controlesDeLEnvoiDirect(): Promise<ControlesDeLEnvoiDirect> {
  const constat = await constatDeLEnvoiDirect();
  const points = verdictDesControles(constat);
  const enDefaut = new Set(points.filter((point) => !point.ok).map((point) => point.id));
  const aPoser = constat.domaine && constat.ip
    ? enregistrementsAttendus({
        domaine: constat.domaine,
        ip: constat.ip,
        spfExistant: constat.spf,
        dkimLocal: constat.dkimLocal,
        dmarcExistant: constat.dmarc,
      }).filter((attendu) => enDefaut.has(attendu.genre))
    : [];
  const { pilote } = await piloteRetenu().catch(() => ({ pilote: null }));
  return { domaine: constat.domaine, ip: constat.ip, ptr: constat.ptr, points, aPoser, posables: Boolean(pilote), signature: Boolean(constat.dkimLocal) };
}

/**
 * LA ZONE QUI TIENT CE NOM chez le fournisseur : le domaine lui-même d'abord,
 * puis ses parents (« mail.exemple.com » vit souvent dans « exemple.com »).
 */
async function zoneDuDomaine(pilote: PiloteDeNoms, domaine: string): Promise<string | null> {
  const etiquettes = domaine.split('.');
  for (let i = 0; i <= etiquettes.length - 2; i++) {
    const zone = etiquettes.slice(i).join('.');
    try {
      await pilote.lireTXT(zone, '');
      return zone;
    } catch {
      /* pas cette zone : la parente */
    }
  }
  return null;
}

/** Le nom relatif à la zone (`''` : la zone elle-même). */
function nomDansLaZone(nomComplet: string, zone: string): string {
  return nomComplet === zone ? '' : nomComplet.slice(0, -(zone.length + 1));
}

export interface PoseDesReglages {
  ok: boolean;
  /** Ce qui a été fait, une ligne par geste. */
  faits: string[];
  /** Ce qui n'a pas pu l'être, une phrase par refus. */
  erreurs: string[];
  controles: ControlesDeLEnvoiDirect;
}

/**
 * POSE CE QUI MANQUE, sans rien casser :
 *  - le SPF est FUSIONNÉ avec celui qui existe, les autres TXT du domaine ne
 *    bougent pas, et jamais deux SPF ne coexistent ;
 *  - la clé DKIM publiée est celle QUI SIGNE ici (lue dans son fichier) ;
 *  - DMARC n'est créé que s'il n'existe pas — une règle déjà posée est celle
 *    du propriétaire du domaine ;
 *  - le nom de l'agent d'envoi suit le nom inverse quand celui-ci mène ici ;
 *    sans nom inverse, chez Hetzner Cloud avec son jeton, il est posé au nom de
 *    l'adresse de Beluga Build.
 */
export async function poserLesReglagesDuDomaine(): Promise<PoseDesReglages> {
  const faits: string[] = [];
  const erreurs: string[] = [];
  const avant = await controlesDeLEnvoiDirect();
  const domaine = avant.domaine;
  if (!domaine) return { ok: false, faits, erreurs: ['L’adresse d’expédition n’est pas réglée.'], controles: avant };

  const retenu = await piloteRetenu().catch(() => ({ pilote: null, manque: '', fournisseur: undefined, valeurs: undefined }));
  const pilote = retenu.pilote;
  if (avant.aPoser.length) {
    if (!pilote) {
      erreurs.push(
        retenu.manque
          ? `Les réglages du domaine n’ont pas pu être posés : ${retenu.manque}.`
          : 'Beluga Build ne gère pas les noms de ce domaine : copiez les enregistrements ci-dessous chez votre fournisseur.',
      );
    } else {
      const zone = await zoneDuDomaine(pilote, domaine);
      if (!zone) {
        erreurs.push(`Le fournisseur de noms de cette installation ne tient pas le domaine ${domaine} : copiez les enregistrements chez celui qui le tient.`);
      } else {
        for (const attendu of avant.aPoser) {
          const nom = nomDansLaZone(attendu.nomComplet, zone);
          try {
            const presents = await pilote.lireTXT(zone, nom);
            let voulus: string[] | null;
            if (attendu.genre === 'spf') voulus = txtsAvecSpf(presents, avant.ip);
            else if (attendu.genre === 'dmarc') voulus = presents.some((txt) => /^v=DMARC1/i.test(txt)) ? null : [...presents, attendu.valeur];
            else voulus = [...presents.filter((txt) => !/\bp=/.test(txt)), attendu.valeur];
            if (!voulus) continue;
            const refus = await pilote.ecrireTXT(zone, nom, voulus);
            if (refus) erreurs.push(`${attendu.genre.toUpperCase()} : ${refus}`);
            else faits.push(`${attendu.genre.toUpperCase()} posé sur ${attendu.nomComplet}`);
          } catch (err: any) {
            erreurs.push(`${attendu.genre.toUpperCase()} : ${String(err?.message ?? err).slice(0, 200)}`);
          }
        }
      }
    }
  }

  // LE NOM INVERSE, et le nom sous lequel l'agent d'envoi se présente.
  let ptr = avant.ptr;
  const ptrOk = avant.points.find((point) => point.id === 'ptr')?.ok ?? false;
  if (!ptrOk && retenu.fournisseur === 'hetzner' && retenu.valeurs?.dns && avant.ip) {
    const hote = hoteNu(identiteDInstallation().adressePublique);
    if (nomDeDomaineValide(hote)) {
      const pose = await poserLeNomInverseChezHetzner(retenu.valeurs.dns, avant.ip, hote);
      if (pose) erreurs.push(pose);
      else {
        faits.push(`Nom inverse de ${avant.ip} posé sur ${hote}`);
        ptr = hote;
      }
    }
  }
  if (ptr && (ptrOk || ptr !== avant.ptr) && agentDEnvoi()) {
    const rendu = await alignerLeNomDeLAgent(ptr);
    if (rendu) faits.push(rendu);
  }

  const controles = await controlesDeLEnvoiDirect();
  log.info(`installation : réglages des courriels — ${faits.length} geste(s), ${erreurs.length} refus`);
  return { ok: erreurs.length === 0, faits, erreurs, controles };
}

/** Le nom sous lequel postfix se présente (`myhostname`) suit le nom inverse. `null` : rien à changer. */
async function alignerLeNomDeLAgent(nom: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('postconf', ['-h', 'myhostname'], { timeout: 10000 });
    if (stdout.trim() === nom) return null;
    await execFileAsync('sudo', ['-n', 'postconf', '-e', `myhostname=${nom}`], { timeout: 15000 });
    await execFileAsync('sudo', ['-n', 'systemctl', 'reload', 'postfix'], { timeout: 30000 });
    return `L’agent d’envoi se présente désormais sous le nom ${nom}`;
  } catch {
    return null;
  }
}

/**
 * LE NOM INVERSE CHEZ HETZNER CLOUD : le serveur qui porte cette adresse est
 * cherché dans le compte du jeton, puis son nom inverse posé. Un serveur
 * d'ailleurs n'y est pas : on le dit, l'hébergeur se règle alors à la main.
 */
async function poserLeNomInverseChezHetzner(jeton: string, ip: string, hote: string): Promise<string | null> {
  const entetes = { authorization: `Bearer ${jeton}`, 'content-type': 'application/json' };
  try {
    const liste = await fetch('https://api.hetzner.cloud/v1/servers?per_page=50', { headers: entetes, signal: AbortSignal.timeout(20000) });
    if (!liste.ok) return `Le nom inverse n’a pas pu être posé : Hetzner a refusé (${liste.status}).`;
    const corps = (await liste.json()) as { servers?: Array<{ id: number; public_net?: { ipv4?: { ip?: string } } }> };
    const serveur = corps.servers?.find((s) => s.public_net?.ipv4?.ip === ip);
    if (!serveur) return `Le nom inverse se pose chez votre hébergeur : l’adresse ${ip} n’appartient pas au compte Hetzner de cette installation.`;
    const r = await fetch(`https://api.hetzner.cloud/v1/servers/${serveur.id}/actions/change_dns_ptr`, {
      method: 'POST',
      headers: entetes,
      body: JSON.stringify({ ip, dns_ptr: hote }),
      signal: AbortSignal.timeout(20000),
    });
    return r.ok ? null : `Le nom inverse n’a pas pu être posé : Hetzner a refusé (${r.status}).`;
  } catch (err: any) {
    return `Le nom inverse n’a pas pu être posé : ${String(err?.message ?? err).slice(0, 160)}.`;
  }
}
