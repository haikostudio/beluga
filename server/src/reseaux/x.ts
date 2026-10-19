import crypto from 'node:crypto';
import { DROITS_DEMANDES } from '@beluga/shared';
import { type Adaptateur, type MessageRelu, adresse, appel, basique, echeance, formulaire, instantDe, lireOctets, premierMedia } from './commun.js';

/**
 * X — l'API v2, connexion OAuth 2.0 avec PKCE.
 *
 * Le jeton dure deux heures et se renouvelle (droit `offline.access`). L'accès
 * GRATUIT de X ne permet que de publier, en petit nombre ; relire les réponses
 * et les messages privés demande un accès payant chez X — sans lui, X répond
 * par un refus que l'écran rapporte tel quel. Les images partent par l'envoi
 * simple de médias ; une vidéo seule ne part pas (le texte, si).
 */

const API = 'https://api.x.com/2';

/** Le défi PKCE tiré du vérificateur tenu par le démon. */
export function defiPkce(verificateur: string): string {
  return crypto.createHash('sha256').update(verificateur).digest('base64url');
}

const auth = (jeton: string) => ({ authorization: `Bearer ${jeton}` });

export const x: Adaptateur = {
  urlDeConnexion: ({ app, retour, etat, verificateur }) =>
    adresse('https://x.com/i/oauth2/authorize', {
      response_type: 'code',
      client_id: app.clientId,
      redirect_uri: retour,
      scope: DROITS_DEMANDES.x.join(' '),
      state: etat,
      code_challenge: defiPkce(verificateur),
      code_challenge_method: 'S256',
    }),

  async echangerCode({ app, retour, code, verificateur }) {
    const j = await appel<{ access_token: string; refresh_token?: string; expires_in: number }>(`${API}/oauth2/token`, {
      method: 'POST',
      headers: { authorization: basique(app) },
      body: formulaire({ code, grant_type: 'authorization_code', redirect_uri: retour, code_verifier: verificateur, client_id: app.clientId }),
    });
    const moi = await appel<{ data: { id: string; username: string; name: string; profile_image_url?: string } }>(adresse(`${API}/users/me`, { 'user.fields': 'profile_image_url' }), {
      headers: auth(j.corps.access_token),
    });
    return [
      {
        reseau: 'x',
        distantId: moi.corps.data.id,
        nom: `@${moi.corps.data.username}`,
        avatar: moi.corps.data.profile_image_url,
        jetons: { acces: j.corps.access_token, rafraichissement: j.corps.refresh_token, expireLe: echeance(j.corps.expires_in) },
        renouvelable: !!j.corps.refresh_token,
        details: { utilisateur: moi.corps.data.username },
      },
    ];
  },

  async rafraichir({ app, rafraichissement }) {
    const j = await appel<{ access_token: string; refresh_token?: string; expires_in: number }>(`${API}/oauth2/token`, {
      method: 'POST',
      headers: { authorization: basique(app) },
      body: formulaire({ refresh_token: rafraichissement, grant_type: 'refresh_token', client_id: app.clientId }),
    });
    return { acces: j.corps.access_token, rafraichissement: j.corps.refresh_token ?? rafraichissement, expireLe: echeance(j.corps.expires_in) };
  },

  async publier({ ctx, article }) {
    const image = premierMedia(article, 'image');
    let mediaIds: string[] | undefined;
    if (image) {
      const corps = new FormData();
      corps.set('media', new Blob([new Uint8Array(lireOctets(image))], { type: image.mime }), 'visuel');
      corps.set('media_category', 'tweet_image');
      const r = await appel<{ data?: { id: string }; id?: string; media_id_string?: string }>(`${API}/media/upload`, { method: 'POST', headers: auth(ctx.jeton), body: corps, delaiMs: 180_000 });
      const id = r.corps.data?.id ?? r.corps.id ?? r.corps.media_id_string;
      if (id) mediaIds = [id];
    }
    const r = await appel<{ data: { id: string } }>(`${API}/tweets`, {
      method: 'POST',
      headers: { ...auth(ctx.jeton), 'content-type': 'application/json' },
      body: JSON.stringify({ text: article.texte, ...(mediaIds ? { media: { media_ids: mediaIds } } : {}) }),
    });
    return { distantId: r.corps.data.id, url: `https://x.com/${ctx.details.utilisateur ?? 'i'}/status/${r.corps.data.id}` };
  },

  async lireCommentaires({ ctx, publications }) {
    const sortie: MessageRelu[] = [];
    for (const p of publications) {
      const r = await appel<{ data?: { id: string; text: string; author_id: string; created_at: string }[]; includes?: { users?: { id: string; username: string }[] } }>(
        adresse(`${API}/tweets/search/recent`, { query: `conversation_id:${p.distantId}`, 'tweet.fields': 'author_id,created_at', expansions: 'author_id', max_results: 50 }),
        { headers: auth(ctx.jeton) },
      );
      const noms = new Map((r.corps.includes?.users ?? []).map((u) => [u.id, `@${u.username}`]));
      for (const t of r.corps.data ?? []) {
        sortie.push({
          genre: 'commentaire',
          distantId: t.id,
          fil: p.distantId,
          auteur: noms.get(t.author_id) ?? '',
          auteurId: t.author_id,
          texte: t.text,
          instant: instantDe(t.created_at),
          sortant: t.author_id === ctx.distantId,
          url: `https://x.com/i/status/${t.id}`,
        });
      }
    }
    return sortie;
  },

  async repondreCommentaire({ ctx, message, texte }) {
    const r = await appel<{ data: { id: string } }>(`${API}/tweets`, {
      method: 'POST',
      headers: { ...auth(ctx.jeton), 'content-type': 'application/json' },
      body: JSON.stringify({ text: texte, reply: { in_reply_to_tweet_id: message.distantId } }),
    });
    return { distantId: r.corps.data.id, url: `https://x.com/i/status/${r.corps.data.id}` };
  },

  async lireMessages({ ctx }) {
    const r = await appel<{ data?: { id: string; text?: string; sender_id: string; created_at: string; dm_conversation_id: string }[]; includes?: { users?: { id: string; username: string }[] } }>(
      adresse(`${API}/dm_events`, { 'dm_event.fields': 'id,text,sender_id,created_at,dm_conversation_id', event_types: 'MessageCreate', expansions: 'sender_id', max_results: 50 }),
      { headers: auth(ctx.jeton) },
    );
    const noms = new Map((r.corps.includes?.users ?? []).map((u) => [u.id, `@${u.username}`]));
    return (r.corps.data ?? []).map<MessageRelu>((m) => ({
      genre: 'message',
      distantId: m.id,
      fil: m.dm_conversation_id,
      auteur: noms.get(m.sender_id) ?? '',
      auteurId: m.sender_id,
      texte: m.text ?? '',
      instant: instantDe(m.created_at),
      sortant: m.sender_id === ctx.distantId,
    }));
  },

  async repondreMessage({ ctx, message, texte }) {
    const r = await appel<{ data: { dm_event_id: string } }>(`${API}/dm_conversations/${encodeURIComponent(message.fil)}/messages`, {
      method: 'POST',
      headers: { ...auth(ctx.jeton), 'content-type': 'application/json' },
      body: JSON.stringify({ text: texte }),
    });
    return { distantId: r.corps.data.dm_event_id };
  },
};
