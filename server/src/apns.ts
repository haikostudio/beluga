/**
 * L'ENVOI APNs vers l'application iPhone de Beluga (règle : `shared/src/notifications-iphone.ts`).
 *
 * HTTP/2 vers api.push.apple.com, authentifié par un jeton JWT ES256 signé avec la clé APNs D'ÉQUIPE. La clé
 * n'est JAMAIS versionnée ni recopiée : elle se lit au COFFRE-FORT de Beluga, dans la fiche dont l'identifiant
 * est rangé en méta `apns.fiche` (défaut : la fiche « Kipou — clé APNs », clé d'équipe T3HPQK4TRF, équipe
 * X6ZLFDBZ7M). Sans fiche lisible, l'iPhone ne reçoit rien et le journal le dit une fois.
 */
import crypto from 'node:crypto';
import http2 from 'node:http2';
import { corpsApns, hoteApns, jetonMort, SUJET_APNS, type AbonnementApns, type ContenuANotifier } from '@beluga/shared';
import { getMeta } from './db.js';
import { listerAcces } from './coffre-fort.js';
import { log } from './logger.js';

const FICHE_PAR_DEFAUT = 'e20a6b0f-e26e-4865-9ac7-64551b3ca936';
/** Apple refuse un jeton de plus d'une heure, et en limite le renouvellement : on le garde 50 minutes. */
const DUREE_DU_JETON_MS = 50 * 60 * 1000;

interface CleApns {
  cle: string;
  keyId: string;
  teamId: string;
}

let dejaDit = false;

function laCle(): CleApns | null {
  const voulue = getMeta('apns.fiche') || FICHE_PAR_DEFAUT;
  const fiche = listerAcces().find((a) => a.id === voulue);
  const cle = fiche?.champs?.cle?.trim();
  const keyId = fiche?.champs?.identifiantCle?.trim();
  const teamId = fiche?.champs?.equipe?.trim();
  if (!cle || !keyId || !teamId) {
    if (!dejaDit) log.warn(`notifications iPhone : clé APNs introuvable au coffre (fiche ${voulue}) — rien n'est envoyé à l'iPhone`);
    dejaDit = true;
    return null;
  }
  return { cle, keyId, teamId };
}

let jetonEnCache: { valeur: string; keyId: string; neLe: number } | null = null;

const base64url = (donnees: Buffer | string) => Buffer.from(donnees).toString('base64url');

/** Le jeton JWT d'APNs, ES256, gardé 50 minutes. */
export function jetonDAutorisation(cle: CleApns, maintenant = Date.now()): string {
  if (jetonEnCache && jetonEnCache.keyId === cle.keyId && maintenant - jetonEnCache.neLe < DUREE_DU_JETON_MS) return jetonEnCache.valeur;
  const entete = base64url(JSON.stringify({ alg: 'ES256', kid: cle.keyId }));
  const charge = base64url(JSON.stringify({ iss: cle.teamId, iat: Math.floor(maintenant / 1000) }));
  const signature = crypto.sign('sha256', Buffer.from(`${entete}.${charge}`), { key: cle.cle, dsaEncoding: 'ieee-p1363' });
  const valeur = `${entete}.${charge}.${base64url(signature)}`;
  jetonEnCache = { valeur, keyId: cle.keyId, neLe: maintenant };
  return valeur;
}

export type IssueApns = 'envoyee' | 'jeton-mort' | 'refusee' | 'sans-cle';

/** Envoie une notification à UN appareil iPhone. */
export async function envoyerParApns(abonnement: AbonnementApns, contenu: ContenuANotifier, ancre?: string): Promise<IssueApns> {
  const cle = laCle();
  if (!cle) return 'sans-cle';
  const corps = JSON.stringify(corpsApns(contenu, ancre));
  return await new Promise<IssueApns>((resoudre) => {
    let fini = false;
    const finir = (issue: IssueApns) => {
      if (fini) return;
      fini = true;
      try {
        session.close();
      } catch {
        /* déjà fermée */
      }
      resoudre(issue);
    };
    const session = http2.connect(hoteApns(abonnement.environnement));
    session.on('error', (err) => {
      log.debug('notification iPhone : connexion à APNs impossible', err?.message);
      finir('refusee');
    });
    session.setTimeout(10_000, () => finir('refusee'));
    const requete = session.request({
      ':method': 'POST',
      ':path': `/3/device/${abonnement.jeton}`,
      authorization: `bearer ${jetonDAutorisation(cle)}`,
      'apns-topic': SUJET_APNS,
      'apns-push-type': 'alert',
      'apns-priority': '10',
      'apns-expiration': String(Math.floor(Date.now() / 1000) + 3600),
      ...(contenu.tag ? { 'apns-collapse-id': contenu.tag.slice(0, 64) } : {}),
      'content-type': 'application/json',
    });
    let statut = 0;
    let reponse = '';
    requete.on('response', (entetes) => {
      statut = Number(entetes[':status'] ?? 0);
    });
    requete.setEncoding('utf8');
    requete.on('data', (morceau) => {
      reponse += morceau;
    });
    requete.on('end', () => {
      if (statut === 200) return finir('envoyee');
      let raison: string | undefined;
      try {
        raison = JSON.parse(reponse || '{}').reason;
      } catch {
        raison = undefined;
      }
      if (jetonMort(statut, raison)) return finir('jeton-mort');
      log.debug(`notification iPhone refusée par APNs : ${statut} ${raison ?? ''}`);
      finir('refusee');
    });
    requete.on('error', () => finir('refusee'));
    requete.end(corps);
  });
}
