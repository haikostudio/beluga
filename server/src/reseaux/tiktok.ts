import { DROITS_DEMANDES } from '@beluga/shared';
import { type Adaptateur, ErreurReseau, adresse, appel, attendre, echeance, formulaire, lireOctets, premierMedia } from './commun.js';

/**
 * TIKTOK — la Content Posting API (publication directe).
 *
 * Le jeton dure 24 heures, le jeton de renouvellement un an. AVANT L'AUDIT de
 * TikTok, une application ne peut publier qu'en « visible par moi seul » : on
 * prend le niveau le plus ouvert que TikTok propose pour ce compte, et l'écran
 * le dit. La vidéo part en un seul morceau (64 Mo au plus). L'interface
 * officielle n'ouvre ni les commentaires ni les messages.
 */

const API = 'https://open.tiktokapis.com/v2';
const MORCEAU_MAX = 64 * 1024 * 1024;

const jsonAuth = (jeton: string) => ({ authorization: `Bearer ${jeton}`, 'content-type': 'application/json; charset=UTF-8' });

/** TikTok répond 200 avec une erreur dans le corps : on la remonte. */
function verifier(corps: any): void {
  const code = corps?.error?.code;
  if (code && code !== 'ok') throw new ErreurReseau(String(corps.error.message || code), 0, code === 'access_token_invalid');
}

export const tiktok: Adaptateur = {
  urlDeConnexion: ({ app, retour, etat }) =>
    adresse('https://www.tiktok.com/v2/auth/authorize/', {
      client_key: app.clientId,
      scope: DROITS_DEMANDES.tiktok.join(','),
      response_type: 'code',
      redirect_uri: retour,
      state: etat,
    }),

  async echangerCode({ app, retour, code }) {
    const j = await appel<{ access_token: string; expires_in: number; refresh_token: string; open_id: string }>(`${API}/oauth/token/`, {
      method: 'POST',
      body: formulaire({ client_key: app.clientId, client_secret: app.secret, code, grant_type: 'authorization_code', redirect_uri: retour }),
    });
    verifier(j.corps);
    const moi = await appel<{ data: { user: { open_id: string; display_name?: string; avatar_url?: string; username?: string } } }>(
      adresse(`${API}/user/info/`, { fields: 'open_id,display_name,avatar_url,username' }),
      { headers: { authorization: `Bearer ${j.corps.access_token}` } },
    );
    const u = moi.corps.data?.user;
    return [
      {
        reseau: 'tiktok',
        distantId: j.corps.open_id,
        nom: u?.display_name ?? 'TikTok',
        avatar: u?.avatar_url,
        jetons: { acces: j.corps.access_token, rafraichissement: j.corps.refresh_token, expireLe: echeance(j.corps.expires_in) },
        renouvelable: true,
        details: { utilisateur: u?.username },
      },
    ];
  },

  async rafraichir({ app, rafraichissement }) {
    const j = await appel<{ access_token: string; expires_in: number; refresh_token: string }>(`${API}/oauth/token/`, {
      method: 'POST',
      body: formulaire({ client_key: app.clientId, client_secret: app.secret, grant_type: 'refresh_token', refresh_token: rafraichissement }),
    });
    verifier(j.corps);
    return { acces: j.corps.access_token, rafraichissement: j.corps.refresh_token, expireLe: echeance(j.corps.expires_in) };
  },

  async publier({ ctx, article }) {
    const video = premierMedia(article, 'video');
    if (!video) throw new ErreurReseau('TikTok a besoin d’une vidéo');
    if (video.taille > MORCEAU_MAX) throw new ErreurReseau('la vidéo dépasse 64 Mo');
    const createur = await appel<{ data: { privacy_level_options?: string[] } }>(`${API}/post/publish/creator_info/query/`, { method: 'POST', headers: jsonAuth(ctx.jeton) });
    verifier(createur.corps);
    const niveaux = createur.corps.data?.privacy_level_options ?? ['SELF_ONLY'];
    const niveau = niveaux.includes('PUBLIC_TO_EVERYONE') ? 'PUBLIC_TO_EVERYONE' : niveaux[0];
    const init = await appel<{ data: { publish_id: string; upload_url: string } }>(`${API}/post/publish/video/init/`, {
      method: 'POST',
      headers: jsonAuth(ctx.jeton),
      body: JSON.stringify({
        post_info: { title: article.texte.slice(0, 2200), privacy_level: niveau, disable_comment: false, disable_duet: false, disable_stitch: false },
        source_info: { source: 'FILE_UPLOAD', video_size: video.taille, chunk_size: video.taille, total_chunk_count: 1 },
      }),
    });
    verifier(init.corps);
    await appel(init.corps.data.upload_url, {
      method: 'PUT',
      headers: { 'content-type': video.mime, 'content-range': `bytes 0-${video.taille - 1}/${video.taille}` },
      body: new Uint8Array(lireOctets(video)),
      delaiMs: 600_000,
    });
    const publishId = init.corps.data.publish_id;
    for (let i = 0; i < 60; i += 1) {
      const etat = await appel<{ data: { status: string; fail_reason?: string; publicaly_available_post_id?: (string | number)[] } }>(`${API}/post/publish/status/fetch/`, {
        method: 'POST',
        headers: jsonAuth(ctx.jeton),
        body: JSON.stringify({ publish_id: publishId }),
      });
      verifier(etat.corps);
      const d = etat.corps.data;
      if (d.status === 'FAILED') throw new ErreurReseau(`TikTok a refusé la vidéo (${d.fail_reason ?? 'raison inconnue'})`);
      if (d.status === 'PUBLISH_COMPLETE') {
        const id = d.publicaly_available_post_id?.[0];
        const utilisateur = ctx.details.utilisateur;
        return {
          distantId: id ? String(id) : publishId,
          url: id && utilisateur ? `https://www.tiktok.com/@${utilisateur}/video/${id}` : utilisateur ? `https://www.tiktok.com/@${utilisateur}` : undefined,
        };
      }
      await attendre(5000);
    }
    // Toujours en traitement : la vidéo est reçue, TikTok la publiera.
    return { distantId: publishId };
  },
};
