/**
 * LA SEULE PORTE D'ENVOI DES COURRIELS, À TROIS MODES.
 *
 * Tous les courriels du démon — le point du matin, le courriel du lundi, les
 * identifiants d'un compte neuf, les alertes de surveillance — partaient par
 * Resend, sans autre choix. Une installation neuve n'a pas de compte Resend, et
 * n'a aucune raison d'en ouvrir un pour trois messages par semaine. La porte
 * connaît donc trois façons d'envoyer, réglées dans l'identité de
 * l'installation (`modeDesCourriels`, `shared/src/installation.ts`) :
 *
 *  - `serveur` : l'agent d'envoi de la machine (`sendmail -t -i`). Rien à
 *    ouvrir nulle part — mais beaucoup d'hébergeurs ferment le port 25 sortant,
 *    et le courriel reste alors dans la file sans jamais partir. C'est ce que
 *    `sonderLaSortie` vérifie AVANT de laisser croire que tout va bien ;
 *  - `smtp` : n'importe quel service de courriel, par son hôte, son port et un
 *    identifiant. Le mot de passe vit au COFFRE-FORT, jamais dans les réglages ;
 *  - `resend` : le chemin d'origine, inchangé.
 *
 * QUATRE CHOSES NE BOUGENT PAS.
 *
 *  1. **SANS EXPÉDITEUR RÉGLÉ, RIEN NE PART**, quel que soit le mode.
 *  2. **L'INSTALLATION DÉJÀ EN SERVICE NE VOIT RIEN CHANGER** : un mode laissé
 *     vide retient Resend dès qu'une clé est au coffre-fort.
 *  3. **UNE FONCTION DONT UNE VALEUR MANQUE EST ÉTEINTE**, et le dit en une
 *     phrase lisible (`raisonDeLExtinction`) — elle ne retombe jamais sur un
 *     autre mode que celui choisi.
 *  4. **UN ENVOI NE LÈVE JAMAIS** : il rend `null` quand tout va bien, la raison
 *     sinon. Un refus doit SE VOIR, pas faire tomber une tournée.
 *
 * Les secrets se lisent par un LECTEUR passé en argument (le coffre-fort par
 * défaut) : un essai juge ainsi chaque mode sans base ni coffre réel.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import nodemailer from 'nodemailer';
import {
  adresseDeCourrielValide,
  expediteurDesCourriels,
  identiteDInstallation,
  MODES_DE_COURRIEL,
  type AccesCoffre,
  type ModeDeCourriel,
} from '@beluga/shared';
import { listerAcces } from './coffre-fort.js';

/** Ce que la porte lit d'une fiche du coffre-fort — rien de plus. */
export type FicheDeSecret = Pick<AccesCoffre, 'nom' | 'type' | 'champs'> & { projectId?: string | null };
/** D'où viennent les fiches : le coffre-fort en service, une liste écrite à la main dans un essai. */
export type LecteurDeSecrets = () => readonly FicheDeSecret[];

/** Le port retenu quand le réglage est vide : celui de la remise de courrier, avec STARTTLS. */
const PORT_SMTP_PAR_DEFAUT = 587;
const DELAI_DE_CONNEXION_MS = 15_000;
const DELAI_DE_SILENCE_MS = 30_000;
/** Un agent local qui ne rend pas la main en trente secondes ne la rendra pas. */
const DELAI_DE_L_AGENT_MS = 30_000;
const DELAI_DE_SONDE_MS = 6_000;
/**
 * Deux grands services de réception, chez deux hébergeurs différents : si
 * AUCUN ne répond sur le port 25, ce n'est pas eux qui sont en panne, c'est la
 * sortie de ce serveur qui est fermée.
 */
const HOTES_DE_SONDE = ['gmail-smtp-in.l.google.com', 'mx.zoho.eu'] as const;

const SUCCES_DE_L_ESSAI = 'Courriel remis au service d’envoi : regardez votre boîte, courrier indésirable compris.';
const PORT_25_FERME =
  'Votre hébergeur bloque l’envoi direct de courriels (port 25 fermé) : choisissez un service de courriel ci-dessous.';
const SANS_AGENT = 'Ce serveur n’a pas d’agent d’envoi';

/* ------------------------------------------------------------------ */
/* Les secrets, lus au coffre-fort                                      */
/* ------------------------------------------------------------------ */

/**
 * LA CLÉ RESEND. On la reconnaît à son SERVICE, pas à son nom : un nom de fiche
 * se retouche, un service non. La fiche d'un autre projet peut porter le même
 * service — on écarte donc celle qui nomme ce projet (« projetc »).
 */
export function cleResendParmi(fiches: readonly FicheDeSecret[]): string | null {
  const resend = fiches.filter(
    (fiche) => fiche.type === 'cle-api' && /resend/i.test(String(fiche.champs.service ?? fiche.nom)),
  );
  const pourBeluga = resend.find((fiche) => !/projetc/i.test(fiche.nom)) ?? resend[0];
  const cle = String(pourBeluga?.champs.cle ?? '').trim();
  return cle || null;
}

/**
 * LE MOT DE PASSE DU SERVICE DE COURRIEL : une fiche de type « mot de passe »
 * dont le nom (ou le service) dit « SMTP ». Quand plusieurs fiches y
 * prétendent, celle qui porte le MÊME identifiant que le réglage l'emporte,
 * puis celle de l'installation (sans projet) : le mot de passe du site d'un
 * client ne doit pas servir à envoyer le point du matin.
 */
export function motDePasseSmtpParmi(fiches: readonly FicheDeSecret[], identifiant = ''): string | null {
  const smtp = fiches.filter(
    (fiche) =>
      fiche.type === 'mot-de-passe' &&
      /smtp/i.test(`${fiche.nom} ${fiche.champs.service ?? ''}`) &&
      String(fiche.champs.motDePasse ?? '').length > 0,
  );
  const retenue =
    (identifiant ? smtp.find((fiche) => String(fiche.champs.identifiant ?? '').trim() === identifiant) : undefined) ??
    smtp.find((fiche) => !fiche.projectId) ??
    smtp[0];
  // Un mot de passe ne se rogne pas : une espace finale peut en faire partie.
  return retenue ? String(retenue.champs.motDePasse) : null;
}

/* ------------------------------------------------------------------ */
/* Le mode retenu, et ce qui lui manque                                 */
/* ------------------------------------------------------------------ */

function estUnMode(valeur: string): valeur is ModeDeCourriel {
  return (MODES_DE_COURRIEL as readonly string[]).includes(valeur);
}

/**
 * PAR OÙ PARTENT LES COURRIELS. La valeur réglée fait foi, même quand il lui
 * manque encore un secret : on ne glisse jamais vers un autre mode que celui
 * choisi. Laissée vide, c'est Resend dès qu'une clé est au coffre-fort —
 * l'installation en service ne voit donc rien changer — et rien sinon.
 */
export function modeRetenu(lire: LecteurDeSecrets = listerAcces): ModeDeCourriel | null {
  // SANS EXPÉDITEUR RÉGLÉ, AUCUN COURRIEL NE PART : la porte s'éteint d'un bloc,
  // avant même de regarder le coffre-fort.
  if (!expediteurDesCourriels()) return null;
  const regle = identiteDInstallation().modeDesCourriels;
  if (estUnMode(regle)) return regle;
  return cleResendParmi(lire()) ? 'resend' : null;
}

/** L'agent d'envoi de la machine : son chemin habituel d'abord, puis le PATH. `null` : il n'y en a pas. */
export function agentDEnvoi(
  existe: (chemin: string) => boolean = estExecutable,
  chemins: string = process.env.PATH ?? '',
): string | null {
  const candidats = [
    '/usr/sbin/sendmail',
    ...chemins
      .split(path.delimiter)
      .filter(Boolean)
      .map((dossier) => path.join(dossier, 'sendmail')),
  ];
  return candidats.find(existe) ?? null;
}

function estExecutable(chemin: string): boolean {
  try {
    fs.accessSync(chemin, fs.constants.X_OK);
    return fs.statSync(chemin).isFile();
  } catch {
    return false;
  }
}

/** Tout ce qu'il faut pour envoyer par le mode retenu — ou la phrase qui dit ce qui manque. */
type Preparation =
  | { pret: false; raison: string }
  | { pret: true; mode: 'resend'; cle: string }
  | { pret: true; mode: 'smtp'; hote: string; port: number; identifiant: string; motDePasse: string }
  | { pret: true; mode: 'serveur'; agent: string };

function preparer(lire: LecteurDeSecrets): Preparation {
  if (!expediteurDesCourriels()) return { pret: false, raison: 'Aucun expéditeur réglé' };
  const mode = modeRetenu(lire);
  if (!mode) return { pret: false, raison: 'Aucune façon d’envoyer n’est choisie' };

  if (mode === 'resend') {
    const cle = cleResendParmi(lire());
    return cle ? { pret: true, mode, cle } : { pret: false, raison: 'La clé Resend manque au coffre-fort' };
  }

  if (mode === 'smtp') {
    const identite = identiteDInstallation();
    if (!identite.smtpHote) return { pret: false, raison: 'L’adresse du service de courriel manque' };
    if (!identite.smtpIdentifiant) return { pret: false, raison: 'L’identifiant du service de courriel manque' };
    const motDePasse = motDePasseSmtpParmi(lire(), identite.smtpIdentifiant);
    if (!motDePasse) return { pret: false, raison: 'Le mot de passe du service de courriel manque' };
    return {
      pret: true,
      mode,
      hote: identite.smtpHote,
      port: Number(identite.smtpPort) || PORT_SMTP_PAR_DEFAUT,
      identifiant: identite.smtpIdentifiant,
      motDePasse,
    };
  }

  const agent = agentDEnvoi();
  return agent ? { pret: true, mode, agent } : { pret: false, raison: SANS_AGENT };
}

/** Un courriel peut-il partir, là, maintenant ? C'est la question que pose chaque appelant avant d'écrire. */
export function envoiPossible(lire: LecteurDeSecrets = listerAcces): boolean {
  return preparer(lire).pret;
}

/**
 * POURQUOI RIEN NE PART, en une phrase qu'un écran ou un journal peut montrer
 * telle quelle (sans point final). Vide quand l'envoi est possible.
 */
export function raisonDeLExtinction(lire: LecteurDeSecrets = listerAcces): string {
  const preparation = preparer(lire);
  return preparation.pret ? '' : preparation.raison;
}

/* ------------------------------------------------------------------ */
/* L'envoi                                                              */
/* ------------------------------------------------------------------ */

/**
 * L'ENVOI LUI-MÊME, par le mode retenu. Rend `null` quand tout va bien, la
 * raison de l'échec sinon — un refus doit SE VOIR, pas se perdre : c'est tout
 * l'intérêt de rendre la raison plutôt que de lever.
 */
export async function envoyerUnCourriel(
  a: string,
  sujet: string,
  texte: string,
  html: string,
  lire: LecteurDeSecrets = listerAcces,
): Promise<string | null> {
  try {
    const preparation = preparer(lire);
    if (!preparation.pret) return preparation.raison;
    const expediteur = expediteurDesCourriels();
    if (preparation.mode === 'resend') return await parResend(preparation.cle, expediteur, a, sujet, texte, html);
    if (preparation.mode === 'smtp') {
      const transport = nodemailer.createTransport(
        reglagesSmtp(preparation.hote, preparation.port, preparation.identifiant, preparation.motDePasse),
      );
      try {
        await transport.sendMail({ from: expediteur, to: a, subject: sujet, text: texte, html });
        return null;
      } finally {
        transport.close();
      }
    }
    const message = await composerLeMessage(expediteur, a, sujet, texte, html);
    return await remettreALAgent(preparation.agent, identiteDInstallation().expediteurDesCourriels, message);
  } catch (err: any) {
    return String(err?.message ?? '') || 'envoi impossible';
  }
}

async function parResend(
  cle: string,
  expediteur: string,
  a: string,
  sujet: string,
  texte: string,
  html: string,
): Promise<string | null> {
  const reponse = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${cle}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: expediteur, to: [a], subject: sujet, text: texte, html }),
  });
  if (reponse.ok) return null;
  return `${reponse.status} ${(await reponse.text()).slice(0, 300)}`;
}

/**
 * LES RÉGLAGES D'UNE CONNEXION AU SERVICE DE COURRIEL. Le port 465 chiffre dès
 * la première ligne ; tout autre port commence en clair et DOIT passer en
 * chiffré (STARTTLS) avant de donner le mot de passe — un service qui ne le
 * propose pas est refusé, on ne lui confie pas un secret en clair. Les délais
 * sont bornés : un service muet est une panne, pas une tournée qui attend.
 */
export function reglagesSmtp(hote: string, port: number, identifiant: string, motDePasse: string) {
  const chiffreDEmblee = port === 465;
  return {
    host: hote,
    port,
    secure: chiffreDEmblee,
    requireTLS: !chiffreDEmblee,
    auth: { user: identifiant, pass: motDePasse },
    connectionTimeout: DELAI_DE_CONNEXION_MS,
    greetingTimeout: DELAI_DE_CONNEXION_MS,
    socketTimeout: DELAI_DE_SILENCE_MS,
  };
}

/**
 * LE MESSAGE TEL QUE L'AGENT LOCAL LE REÇOIT : entêtes, puis deux parties
 * (texte et HTML) dans un `multipart/alternative`, en UTF-8, sujet encodé. La
 * composition est confiée à la bibliothèque — encoder un sujet accentué ou
 * replier une longue ligne à la main, c'est se tromper un jour sur un cas rare.
 * Rien ne part d'ici : le transport « flux » ne fait que rendre les octets.
 */
export async function composerLeMessage(
  de: string,
  a: string,
  sujet: string,
  texte: string,
  html: string,
): Promise<Buffer> {
  const compositeur = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'unix' });
  const rendu = await compositeur.sendMail({ from: de, to: a, subject: sujet, text: texte, html });
  return Buffer.isBuffer(rendu.message) ? rendu.message : Buffer.from(String(rendu.message));
}

/**
 * LA REMISE À L'AGENT LOCAL : `sendmail -t -i`, le message sur l'entrée
 * standard. `-t` lui fait lire le destinataire dans les entêtes — il ne passe
 * donc jamais par la ligne de commande ; `-i` l'empêche de prendre un point
 * seul sur une ligne pour la fin du message. `-f` pose l'adresse de retour sur
 * l'expéditeur réglé : sans lui, elle vaudrait « compte-du-service@nom-de-la-machine »,
 * un domaine qui n'existe pas et que les boîtes de réception refusent.
 */
function remettreALAgent(agent: string, adresseDeRetour: string, message: Buffer): Promise<string | null> {
  return new Promise((rendre) => {
    let rendu = false;
    const finir = (raison: string | null) => {
      if (rendu) return;
      rendu = true;
      clearTimeout(garde);
      rendre(raison);
    };
    const options = ['-t', '-i', ...(adresseDeCourrielValide(adresseDeRetour) ? ['-f', adresseDeRetour] : [])];
    const enfant = spawn(agent, options, { stdio: ['pipe', 'ignore', 'pipe'] });
    const garde = setTimeout(() => {
      enfant.kill('SIGKILL');
      finir('l’agent d’envoi de ce serveur ne répond pas');
    }, DELAI_DE_L_AGENT_MS);
    let erreurs = '';
    enfant.stderr.on('data', (morceau) => {
      if (erreurs.length < 600) erreurs += String(morceau);
    });
    enfant.on('error', (err: NodeJS.ErrnoException) =>
      finir(err.code === 'ENOENT' ? SANS_AGENT.toLowerCase() : err.message || 'agent d’envoi injoignable'),
    );
    enfant.on('close', (code) =>
      finir(code === 0 ? null : `l’agent d’envoi a refusé le message (code ${code}) ${erreurs.trim().slice(0, 300)}`.trim()),
    );
    // Un agent qui meurt avant d'avoir tout lu ferme son entrée : l'erreur
    // d'écriture ne doit pas remonter, la fermeture dira la vraie raison.
    enfant.stdin.on('error', () => {});
    enfant.stdin.end(message);
  });
}

/* ------------------------------------------------------------------ */
/* La sonde, et le courriel d'essai                                     */
/* ------------------------------------------------------------------ */

/** Une connexion TCP s'ouvre-t-elle dans le délai ? Rien n'est écrit : on ouvre, on referme. */
function connexionOuverte(hote: string, port: number, delaiMs: number): Promise<boolean> {
  return new Promise((rendre) => {
    const prise = net.connect({ host: hote, port });
    let rendu = false;
    const finir = (ouverte: boolean) => {
      if (rendu) return;
      rendu = true;
      clearTimeout(garde);
      prise.destroy();
      rendre(ouverte);
    };
    const garde = setTimeout(() => finir(false), delaiMs);
    prise.once('connect', () => finir(true));
    prise.once('error', () => finir(false));
  });
}

/**
 * CE SERVEUR PEUT-IL ENVOYER LUI-MÊME ? Deux faits : un agent d'envoi est
 * installé, et le port 25 SORTANT est ouvert. Beaucoup d'hébergeurs le ferment
 * — l'agent accepte alors chaque message et aucun n'arrive jamais. Le second
 * hôte n'est essayé que si le premier ne répond pas.
 */
export async function sonderLaSortie(
  ouverte: (hote: string, port: number, delaiMs: number) => Promise<boolean> = connexionOuverte,
): Promise<{ agent: boolean; port25: boolean }> {
  const agent = agentDEnvoi() !== null;
  for (const hote of HOTES_DE_SONDE) {
    if (await ouverte(hote, 25, DELAI_DE_SONDE_MS).catch(() => false)) return { agent, port25: true };
  }
  return { agent, port25: false };
}

/**
 * LA SONDE DE L'ÉCRAN, gardée dix minutes. L'étape « Les courriels » la demande
 * dès qu'elle s'ouvre, pour dire AVANT tout essai que l'envoi direct est bloqué
 * chez cet hébergeur — et revenir sur la page ne relance pas deux connexions de
 * six secondes. Une sonde en cours est partagée par tous ceux qui la demandent.
 */
const DUREE_DE_LA_SONDE_GARDEE_MS = 10 * 60_000;
let sondeGardee: { a: number; promesse: Promise<{ agent: boolean; port25: boolean }> } | null = null;

export function sortieDirecteGardee(
  sonder: () => Promise<{ agent: boolean; port25: boolean }> = sonderLaSortie,
  maintenant = Date.now(),
): Promise<{ agent: boolean; port25: boolean }> {
  if (!sondeGardee || maintenant - sondeGardee.a > DUREE_DE_LA_SONDE_GARDEE_MS) {
    const promesse = sonder().catch(() => ({ agent: agentDEnvoi() !== null, port25: false }));
    sondeGardee = { a: maintenant, promesse };
  }
  return sondeGardee.promesse;
}

/**
 * UN VRAI COURRIEL, COURT, POUR SAVOIR. Il part par le mode retenu, et la
 * phrase rendue s'affiche telle quelle : le succès, ou la raison RÉELLE du
 * refus. En mode `serveur`, la sortie est sondée D'ABORD : un agent local
 * accepte tout ce qu'on lui donne, il ne dirait donc jamais lui-même que le
 * port est fermé.
 */
export async function envoyerUnCourrielDEssai(
  a: string,
  lire: LecteurDeSecrets = listerAcces,
  sonder: () => Promise<{ agent: boolean; port25: boolean }> = sonderLaSortie,
): Promise<{ ok: boolean; texte: string }> {
  try {
    const destinataire = String(a ?? '').trim();
    if (!adresseDeCourrielValide(destinataire)) return { ok: false, texte: 'Cette adresse de courriel n’est pas valide.' };

    if (modeRetenu(lire) === 'serveur') {
      const sortie = await sonder();
      if (!sortie.agent) return { ok: false, texte: `${SANS_AGENT} : choisissez un service de courriel ci-dessous.` };
      if (!sortie.port25) return { ok: false, texte: PORT_25_FERME };
    }
    const extinction = raisonDeLExtinction(lire);
    if (extinction) return { ok: false, texte: `${extinction}.` };

    const sujet = 'Courriel d’essai de Beluga Build';
    const phrase = 'Ce message confirme que cette installation de Beluga Build sait envoyer des courriels.';
    const echec = await envoyerUnCourriel(destinataire, sujet, `${phrase}\n`, `<p>${phrase}</p>`, lire);
    return echec ? { ok: false, texte: `L’envoi a été refusé : ${echec}` } : { ok: true, texte: SUCCES_DE_L_ESSAI };
  } catch (err: any) {
    return { ok: false, texte: `L’envoi a été refusé : ${String(err?.message ?? '') || 'envoi impossible'}` };
  }
}
