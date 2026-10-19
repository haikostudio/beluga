import { DROITS_DEMANDES } from '@beluga/shared';
import { type Adaptateur, type CompteTrouve, type IdentifiantsApplication, type MessageRelu, ErreurReseau, adresse, appel, attendre, formulaire, instantDe, premierMedia } from './commun.js';

/**
 * FACEBOOK (pages) ET INSTAGRAM (comptes professionnels) — l'API Graph de Meta.
 *
 * Une seule application Meta pour les deux. La connexion rend un jeton
 * d'utilisateur, échangé contre un jeton LONG ; les jetons de PAGE qu'on en
 * tire n'expirent pas. Instagram passe par la page Facebook à laquelle le
 * compte professionnel est rattaché : c'est son jeton qui publie, commente et
 * répond aux messages.
 */

const GRAPH = 'https://graph.facebook.com/v21.0';

function urlDeConnexion(reseau: 'facebook' | 'instagram') {
  return ({ app, retour, etat }: { app: IdentifiantsApplication; retour: string; etat: string }) =>
    adresse('https://www.facebook.com/v21.0/dialog/oauth', {
      client_id: app.clientId,
      redirect_uri: retour,
      state: etat,
      response_type: 'code',
      scope: DROITS_DEMANDES[reseau].join(','),
    });
}

async function jetonLong(app: IdentifiantsApplication, retour: string, code: string): Promise<string> {
  const court = await appel<{ access_token: string }>(
    adresse(`${GRAPH}/oauth/access_token`, { client_id: app.clientId, client_secret: app.secret, redirect_uri: retour, code }),
  );
  const long = await appel<{ access_token: string }>(
    adresse(`${GRAPH}/oauth/access_token`, { grant_type: 'fb_exchange_token', client_id: app.clientId, client_secret: app.secret, fb_exchange_token: court.corps.access_token }),
  );
  return long.corps.access_token;
}

interface PageMeta {
  id: string;
  name: string;
  access_token: string;
  picture?: { data?: { url?: string } };
  instagram_business_account?: { id: string; username?: string; profile_picture_url?: string };
}

async function pages(jeton: string): Promise<PageMeta[]> {
  const r = await appel<{ data: PageMeta[] }>(
    adresse(`${GRAPH}/me/accounts`, { access_token: jeton, limit: 100, fields: 'id,name,access_token,picture{url},instagram_business_account{id,username,profile_picture_url}' }),
  );
  return r.corps.data ?? [];
}

async function permalien(id: string, jeton: string, champ: 'permalink_url' | 'permalink'): Promise<string | undefined> {
  try {
    const r = await appel<Record<string, string>>(adresse(`${GRAPH}/${id}`, { fields: champ, access_token: jeton }));
    return r.corps[champ];
  } catch {
    return undefined;
  }
}

/** Les conversations privées d'une page (Messenger ou Instagram), avec leurs derniers messages. */
async function conversations(pageId: string, jeton: string, plateforme: 'messenger' | 'instagram', moi: string): Promise<MessageRelu[]> {
  const r = await appel<{ data: { id: string; messages?: { data: { id: string; message?: string; created_time: string; from?: { id: string; name?: string; username?: string } }[] } }[] }>(
    adresse(`${GRAPH}/${pageId}/conversations`, {
      platform: plateforme,
      access_token: jeton,
      limit: 25,
      fields: 'id,updated_time,messages.limit(10){id,message,created_time,from}',
    }),
  );
  const sortie: MessageRelu[] = [];
  for (const conv of r.corps.data ?? []) {
    for (const m of conv.messages?.data ?? []) {
      const sortant = m.from?.id === moi;
      sortie.push({
        genre: 'message',
        distantId: m.id,
        fil: conv.id,
        auteur: m.from?.name ?? m.from?.username ?? '',
        auteurId: m.from?.id,
        texte: m.message ?? '',
        instant: instantDe(m.created_time),
        sortant,
      });
    }
  }
  return sortie;
}

/** Le destinataire d'une conversation : celui qui n'est pas la page. */
async function destinataire(conversationId: string, jeton: string, moi: string, connu?: string): Promise<string> {
  if (connu && connu !== moi) return connu;
  const r = await appel<{ participants?: { data: { id: string }[] } }>(adresse(`${GRAPH}/${conversationId}`, { fields: 'participants', access_token: jeton }));
  const autre = r.corps.participants?.data?.find((p) => p.id !== moi);
  if (!autre) throw new ErreurReseau('destinataire introuvable dans cette conversation');
  return autre.id;
}

export const facebook: Adaptateur = {
  urlDeConnexion: urlDeConnexion('facebook'),

  async echangerCode({ app, retour, code }) {
    const jeton = await jetonLong(app, retour, code);
    return (await pages(jeton)).map<CompteTrouve>((p) => ({
      reseau: 'facebook',
      distantId: p.id,
      nom: p.name,
      avatar: p.picture?.data?.url,
      jetons: { acces: p.access_token },
      renouvelable: false,
    }));
  },

  async publier({ ctx, article }) {
    const media = premierMedia(article);
    let id: string;
    if (media?.genre === 'video') {
      const r = await appel<{ id: string }>(`${GRAPH}/${ctx.distantId}/videos`, {
        method: 'POST',
        body: formulaire({ file_url: media.urlPublique, description: article.texte, title: article.titre, access_token: ctx.jeton }),
        delaiMs: 180_000,
      });
      id = r.corps.id;
    } else if (media) {
      const r = await appel<{ id: string; post_id?: string }>(`${GRAPH}/${ctx.distantId}/photos`, {
        method: 'POST',
        body: formulaire({ url: media.urlPublique, caption: article.texte, access_token: ctx.jeton }),
      });
      id = r.corps.post_id ?? r.corps.id;
    } else {
      const r = await appel<{ id: string }>(`${GRAPH}/${ctx.distantId}/feed`, {
        method: 'POST',
        body: formulaire({ message: article.texte, access_token: ctx.jeton }),
      });
      id = r.corps.id;
    }
    return { distantId: id, url: (await permalien(id, ctx.jeton, 'permalink_url')) ?? `https://www.facebook.com/${id}` };
  },

  async lireCommentaires({ ctx, publications }) {
    const sortie: MessageRelu[] = [];
    for (const p of publications) {
      const r = await appel<{ data: { id: string; message?: string; created_time: string; permalink_url?: string; from?: { id: string; name?: string } }[] }>(
        adresse(`${GRAPH}/${p.distantId}/comments`, { access_token: ctx.jeton, limit: 50, filter: 'stream', fields: 'id,message,created_time,from,permalink_url' }),
      );
      for (const c of r.corps.data ?? []) {
        sortie.push({
          genre: 'commentaire',
          distantId: c.id,
          fil: p.distantId,
          auteur: c.from?.name ?? '',
          auteurId: c.from?.id,
          texte: c.message ?? '',
          instant: instantDe(c.created_time),
          sortant: c.from?.id === ctx.distantId,
          url: c.permalink_url,
        });
      }
    }
    return sortie;
  },

  async repondreCommentaire({ ctx, message, texte }) {
    const r = await appel<{ id: string }>(`${GRAPH}/${message.distantId}/comments`, { method: 'POST', body: formulaire({ message: texte, access_token: ctx.jeton }) });
    return { distantId: r.corps.id };
  },

  lireMessages: ({ ctx }) => conversations(ctx.distantId, ctx.jeton, 'messenger', ctx.distantId),

  async repondreMessage({ ctx, message, texte }) {
    const id = await destinataire(message.fil, ctx.jeton, ctx.distantId, message.auteurId);
    const r = await appel<{ message_id: string }>(adresse(`${GRAPH}/${ctx.distantId}/messages`, { access_token: ctx.jeton }), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ recipient: { id }, message: { text: texte }, messaging_type: 'RESPONSE' }),
    });
    return { distantId: r.corps.message_id };
  },
};

/** Attend qu'un conteneur Instagram (vidéo surtout) soit prêt à publier. */
async function conteneurPret(id: string, jeton: string): Promise<void> {
  for (let i = 0; i < 60; i += 1) {
    const r = await appel<{ status_code?: string; status?: string }>(adresse(`${GRAPH}/${id}`, { fields: 'status_code,status', access_token: jeton }));
    if (r.corps.status_code === 'FINISHED' || r.corps.status_code === 'PUBLISHED') return;
    if (r.corps.status_code === 'ERROR' || r.corps.status_code === 'EXPIRED') throw new ErreurReseau(`Instagram a refusé le visuel (${r.corps.status ?? r.corps.status_code})`);
    await attendre(5000);
  }
  throw new ErreurReseau('Instagram n’a pas fini de traiter le visuel dans les cinq minutes');
}

export const instagram: Adaptateur = {
  urlDeConnexion: urlDeConnexion('instagram'),

  async echangerCode({ app, retour, code }) {
    const jeton = await jetonLong(app, retour, code);
    return (await pages(jeton))
      .filter((p) => p.instagram_business_account?.id)
      .map<CompteTrouve>((p) => ({
        reseau: 'instagram',
        distantId: p.instagram_business_account!.id,
        nom: p.instagram_business_account!.username ? `@${p.instagram_business_account!.username}` : p.name,
        avatar: p.instagram_business_account!.profile_picture_url,
        jetons: { acces: p.access_token },
        renouvelable: false,
        details: { pageId: p.id },
      }));
  },

  async publier({ ctx, article }) {
    const media = premierMedia(article);
    if (!media) throw new ErreurReseau('Instagram a besoin d’une image ou d’une vidéo');
    const champs =
      media.genre === 'video'
        ? { media_type: 'REELS', video_url: media.urlPublique, caption: article.texte, access_token: ctx.jeton }
        : { image_url: media.urlPublique, caption: article.texte, access_token: ctx.jeton };
    const conteneur = await appel<{ id: string }>(`${GRAPH}/${ctx.distantId}/media`, { method: 'POST', body: formulaire(champs) });
    await conteneurPret(conteneur.corps.id, ctx.jeton);
    const r = await appel<{ id: string }>(`${GRAPH}/${ctx.distantId}/media_publish`, {
      method: 'POST',
      body: formulaire({ creation_id: conteneur.corps.id, access_token: ctx.jeton }),
    });
    return { distantId: r.corps.id, url: await permalien(r.corps.id, ctx.jeton, 'permalink') };
  },

  async lireCommentaires({ ctx, publications }) {
    const sortie: MessageRelu[] = [];
    for (const p of publications) {
      const r = await appel<{ data: { id: string; text?: string; timestamp: string; username?: string; from?: { id: string; username?: string } }[] }>(
        adresse(`${GRAPH}/${p.distantId}/comments`, { access_token: ctx.jeton, limit: 50, fields: 'id,text,timestamp,username,from' }),
      );
      for (const c of r.corps.data ?? []) {
        sortie.push({
          genre: 'commentaire',
          distantId: c.id,
          fil: p.distantId,
          auteur: c.username ? `@${c.username}` : '',
          auteurId: c.from?.id,
          texte: c.text ?? '',
          instant: instantDe(c.timestamp),
          sortant: c.from?.id === ctx.distantId,
        });
      }
    }
    return sortie;
  },

  async repondreCommentaire({ ctx, message, texte }) {
    const r = await appel<{ id: string }>(`${GRAPH}/${message.distantId}/replies`, { method: 'POST', body: formulaire({ message: texte, access_token: ctx.jeton }) });
    return { distantId: r.corps.id };
  },

  lireMessages: ({ ctx }) => conversations(String(ctx.details.pageId ?? ''), ctx.jeton, 'instagram', ctx.distantId),

  async repondreMessage({ ctx, message, texte }) {
    const pageId = String(ctx.details.pageId ?? '');
    const id = await destinataire(message.fil, ctx.jeton, ctx.distantId, message.auteurId);
    const r = await appel<{ message_id: string }>(adresse(`${GRAPH}/${pageId}/messages`, { access_token: ctx.jeton }), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ recipient: { id }, message: { text: texte } }),
    });
    return { distantId: r.corps.message_id };
  },
};
