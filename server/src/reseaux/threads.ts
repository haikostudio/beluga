import { DROITS_DEMANDES } from '@beluga/shared';
import { type Adaptateur, type MessageRelu, ErreurReseau, adresse, appel, attendre, echeance, formulaire, instantDe, premierMedia } from './commun.js';

/**
 * THREADS — l'API Threads de Meta (application à part de celle de Facebook).
 *
 * Le jeton court s'échange contre un jeton de 60 jours, qui se RENOUVELLE
 * lui-même (le jeton actuel sert de clé de renouvellement). Publier se fait en
 * deux temps : un conteneur, puis sa publication. Pas de messages privés.
 */

const API = 'https://graph.threads.net/v1.0';

async function publierConteneur(ctx: { distantId: string; jeton: string }, champs: Record<string, string | undefined>): Promise<string> {
  const conteneur = await appel<{ id: string }>(`${API}/${ctx.distantId}/threads`, { method: 'POST', body: formulaire({ ...champs, access_token: ctx.jeton }) });
  // Meta conseille d'attendre que le conteneur soit traité avant de le publier.
  for (let i = 0; i < 30; i += 1) {
    const etat = await appel<{ status?: string; error_message?: string }>(adresse(`${API}/${conteneur.corps.id}`, { fields: 'status,error_message', access_token: ctx.jeton }));
    if (etat.corps.status === 'FINISHED' || etat.corps.status === 'PUBLISHED') break;
    if (etat.corps.status === 'ERROR' || etat.corps.status === 'EXPIRED') throw new ErreurReseau(`Threads a refusé la publication (${etat.corps.error_message ?? etat.corps.status})`);
    await attendre(3000);
  }
  const r = await appel<{ id: string }>(`${API}/${ctx.distantId}/threads_publish`, { method: 'POST', body: formulaire({ creation_id: conteneur.corps.id, access_token: ctx.jeton }) });
  return r.corps.id;
}

export const threads: Adaptateur = {
  urlDeConnexion: ({ app, retour, etat }) =>
    adresse('https://threads.net/oauth/authorize', {
      client_id: app.clientId,
      redirect_uri: retour,
      scope: DROITS_DEMANDES.threads.join(','),
      response_type: 'code',
      state: etat,
    }),

  async echangerCode({ app, retour, code }) {
    const court = await appel<{ access_token: string; user_id: string | number }>('https://graph.threads.net/oauth/access_token', {
      method: 'POST',
      body: formulaire({ client_id: app.clientId, client_secret: app.secret, grant_type: 'authorization_code', redirect_uri: retour, code }),
    });
    const long = await appel<{ access_token: string; expires_in: number }>(
      adresse('https://graph.threads.net/access_token', { grant_type: 'th_exchange_token', client_secret: app.secret, access_token: court.corps.access_token }),
    );
    const moi = await appel<{ id: string; username?: string; threads_profile_picture_url?: string }>(
      adresse(`${API}/me`, { fields: 'id,username,threads_profile_picture_url', access_token: long.corps.access_token }),
    );
    return [
      {
        reseau: 'threads',
        distantId: String(moi.corps.id),
        nom: moi.corps.username ? `@${moi.corps.username}` : 'Threads',
        avatar: moi.corps.threads_profile_picture_url,
        jetons: { acces: long.corps.access_token, expireLe: echeance(long.corps.expires_in) },
        renouvelable: true,
        details: { utilisateur: moi.corps.username },
      },
    ];
  },

  async rafraichir({ ctx }) {
    const r = await appel<{ access_token: string; expires_in: number }>(adresse('https://graph.threads.net/refresh_access_token', { grant_type: 'th_refresh_token', access_token: ctx.jeton }));
    return { acces: r.corps.access_token, expireLe: echeance(r.corps.expires_in) };
  },

  async publier({ ctx, article }) {
    const media = premierMedia(article);
    const champs =
      media?.genre === 'video'
        ? { media_type: 'VIDEO', video_url: media.urlPublique, text: article.texte }
        : media
          ? { media_type: 'IMAGE', image_url: media.urlPublique, text: article.texte }
          : { media_type: 'TEXT', text: article.texte };
    const id = await publierConteneur(ctx, champs);
    let url: string | undefined;
    try {
      url = (await appel<{ permalink?: string }>(adresse(`${API}/${id}`, { fields: 'permalink', access_token: ctx.jeton }))).corps.permalink;
    } catch {
      url = undefined;
    }
    return { distantId: id, url };
  },

  async lireCommentaires({ ctx, publications }) {
    const sortie: MessageRelu[] = [];
    for (const p of publications) {
      const r = await appel<{ data: { id: string; text?: string; username?: string; timestamp: string; permalink?: string }[] }>(
        adresse(`${API}/${p.distantId}/replies`, { fields: 'id,text,username,timestamp,permalink', access_token: ctx.jeton }),
      );
      for (const c of r.corps.data ?? []) {
        const nous = c.username && `@${c.username}` === ctx.nom;
        sortie.push({
          genre: 'commentaire',
          distantId: c.id,
          fil: p.distantId,
          auteur: c.username ? `@${c.username}` : '',
          texte: c.text ?? '',
          instant: instantDe(c.timestamp),
          sortant: !!nous,
          url: c.permalink,
        });
      }
    }
    return sortie;
  },

  async repondreCommentaire({ ctx, message, texte }) {
    const id = await publierConteneur(ctx, { media_type: 'TEXT', text: texte, reply_to_id: message.distantId });
    return { distantId: id };
  },
};
