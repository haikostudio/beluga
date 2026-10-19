import { DROITS_DEMANDES } from '@beluga/shared';
import { type Adaptateur, type IdentifiantsApplication, type Jetons, type MessageRelu, ErreurReseau, adresse, appel, echeance, formulaire, instantDe, lireOctets, premierMedia } from './commun.js';

/**
 * YOUTUBE ET LA FICHE GOOGLE (Business Profile) — une seule application Google.
 *
 * Le jeton dure une heure et se renouvelle par le jeton de renouvellement
 * (demandé avec `access_type=offline` et `prompt=consent`, sans quoi Google ne
 * le redonne pas). YouTube publie des VIDÉOS (envoi par reprise) et répond aux
 * commentaires ; la fiche Google publie des actualités et répond aux AVIS.
 */

function urlGoogle(reseau: 'youtube' | 'google-business') {
  return ({ app, retour, etat }: { app: IdentifiantsApplication; retour: string; etat: string }) =>
    adresse('https://accounts.google.com/o/oauth2/v2/auth', {
      client_id: app.clientId,
      redirect_uri: retour,
      response_type: 'code',
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
      scope: DROITS_DEMANDES[reseau].join(' '),
      state: etat,
    });
}

async function jetons(app: IdentifiantsApplication, champs: Record<string, string>): Promise<Jetons> {
  const r = await appel<{ access_token: string; expires_in: number; refresh_token?: string }>('https://oauth2.googleapis.com/token', {
    method: 'POST',
    body: formulaire({ client_id: app.clientId, client_secret: app.secret, ...champs }),
  });
  return { acces: r.corps.access_token, rafraichissement: r.corps.refresh_token, expireLe: echeance(r.corps.expires_in) };
}

const rafraichir: NonNullable<Adaptateur['rafraichir']> = async ({ app, rafraichissement }) => {
  const j = await jetons(app, { grant_type: 'refresh_token', refresh_token: rafraichissement });
  return { ...j, rafraichissement: j.rafraichissement ?? rafraichissement };
};

const auth = (jeton: string) => ({ authorization: `Bearer ${jeton}` });

export const youtube: Adaptateur = {
  urlDeConnexion: urlGoogle('youtube'),

  async echangerCode({ app, retour, code }) {
    const j = await jetons(app, { grant_type: 'authorization_code', code, redirect_uri: retour });
    const r = await appel<{ items?: { id: string; snippet: { title: string; thumbnails?: { default?: { url?: string } } } }[] }>(
      adresse('https://www.googleapis.com/youtube/v3/channels', { part: 'snippet', mine: 'true' }),
      { headers: auth(j.acces) },
    );
    return (r.corps.items ?? []).map((c) => ({
      reseau: 'youtube' as const,
      distantId: c.id,
      nom: c.snippet.title,
      avatar: c.snippet.thumbnails?.default?.url,
      jetons: j,
      renouvelable: !!j.rafraichissement,
    }));
  },

  rafraichir,

  async publier({ ctx, article }) {
    const video = premierMedia(article, 'video');
    if (!video) throw new ErreurReseau('YouTube a besoin d’une vidéo');
    const debut = await appel(adresse('https://www.googleapis.com/upload/youtube/v3/videos', { uploadType: 'resumable', part: 'snippet,status' }), {
      method: 'POST',
      headers: { ...auth(ctx.jeton), 'content-type': 'application/json', 'x-upload-content-type': video.mime, 'x-upload-content-length': String(video.taille) },
      body: JSON.stringify({
        snippet: { title: article.titre.slice(0, 100), description: article.texte, ...(article.langue ? { defaultLanguage: article.langue } : {}) },
        status: { privacyStatus: 'public', selfDeclaredMadeForKids: false },
      }),
    });
    const lieu = debut.entetes.get('location');
    if (!lieu) throw new ErreurReseau('YouTube n’a pas ouvert l’envoi de la vidéo');
    const fin = await appel<{ id: string }>(lieu, { method: 'PUT', headers: { ...auth(ctx.jeton), 'content-type': video.mime }, body: new Uint8Array(lireOctets(video)), delaiMs: 900_000 });
    return { distantId: fin.corps.id, url: `https://www.youtube.com/watch?v=${fin.corps.id}` };
  },

  async lireCommentaires({ ctx, publications }) {
    const sortie: MessageRelu[] = [];
    for (const p of publications) {
      const r = await appel<{
        items?: { id: string; snippet: { topLevelComment: { id: string; snippet: { authorDisplayName: string; authorChannelId?: { value: string }; textOriginal: string; publishedAt: string } } } }[];
      }>(adresse('https://www.googleapis.com/youtube/v3/commentThreads', { part: 'snippet', videoId: p.distantId, maxResults: 50 }), { headers: auth(ctx.jeton) });
      for (const fil of r.corps.items ?? []) {
        const c = fil.snippet.topLevelComment;
        sortie.push({
          genre: 'commentaire',
          distantId: c.id,
          fil: p.distantId,
          auteur: c.snippet.authorDisplayName,
          auteurId: c.snippet.authorChannelId?.value,
          texte: c.snippet.textOriginal,
          instant: instantDe(c.snippet.publishedAt),
          sortant: c.snippet.authorChannelId?.value === ctx.distantId,
          url: `https://www.youtube.com/watch?v=${p.distantId}&lc=${c.id}`,
        });
      }
    }
    return sortie;
  },

  async repondreCommentaire({ ctx, message, texte }) {
    const r = await appel<{ id: string }>(adresse('https://www.googleapis.com/youtube/v3/comments', { part: 'snippet' }), {
      method: 'POST',
      headers: { ...auth(ctx.jeton), 'content-type': 'application/json' },
      body: JSON.stringify({ snippet: { parentId: message.distantId, textOriginal: texte } }),
    });
    return { distantId: r.corps.id };
  },
};

const NOTE_ETOILES: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };

export const ficheGoogle: Adaptateur = {
  urlDeConnexion: urlGoogle('google-business'),

  async echangerCode({ app, retour, code }) {
    const j = await jetons(app, { grant_type: 'authorization_code', code, redirect_uri: retour });
    const comptes = await appel<{ accounts?: { name: string; accountName?: string }[] }>('https://mybusinessaccountmanagement.googleapis.com/v1/accounts', { headers: auth(j.acces) });
    const sortie = [];
    for (const compte of comptes.corps.accounts ?? []) {
      const lieux = await appel<{ locations?: { name: string; title: string }[] }>(
        adresse(`https://mybusinessbusinessinformation.googleapis.com/v1/${compte.name}/locations`, { readMask: 'name,title', pageSize: 100 }),
        { headers: auth(j.acces) },
      );
      for (const l of lieux.corps.locations ?? []) {
        sortie.push({
          reseau: 'google-business' as const,
          distantId: l.name,
          nom: l.title,
          jetons: j,
          renouvelable: !!j.rafraichissement,
          // L'interface des publications et des avis (v4) nomme l'établissement « accounts/…/locations/… ».
          details: { chemin: `${compte.name}/${l.name}` },
        });
      }
    }
    return sortie;
  },

  rafraichir,

  async publier({ ctx, article }) {
    const image = premierMedia(article, 'image');
    const r = await appel<{ name: string; searchUrl?: string }>(`https://mybusiness.googleapis.com/v4/${ctx.details.chemin}/localPosts`, {
      method: 'POST',
      headers: { ...auth(ctx.jeton), 'content-type': 'application/json' },
      body: JSON.stringify({
        languageCode: article.langue ?? 'fr',
        summary: article.texte,
        topicType: 'STANDARD',
        ...(article.lien ? { callToAction: { actionType: 'LEARN_MORE', url: article.lien } } : {}),
        ...(image ? { media: [{ mediaFormat: 'PHOTO', sourceUrl: image.urlPublique }] } : {}),
      }),
    });
    return { distantId: r.corps.name, url: r.corps.searchUrl };
  },

  /* Les « commentaires » d'une fiche Google sont ses AVIS : ils ne dépendent pas de nos publications. */
  async lireCommentaires({ ctx }) {
    const r = await appel<{ reviews?: { name: string; reviewId: string; reviewer?: { displayName?: string }; starRating?: string; comment?: string; createTime: string; reviewReply?: { comment: string; updateTime: string } }[] }>(
      adresse(`https://mybusiness.googleapis.com/v4/${ctx.details.chemin}/reviews`, { pageSize: 50 }),
      { headers: auth(ctx.jeton) },
    );
    const sortie: MessageRelu[] = [];
    for (const a of r.corps.reviews ?? []) {
      const etoiles = NOTE_ETOILES[a.starRating ?? ''] ?? 0;
      sortie.push({
        genre: 'commentaire',
        distantId: a.name,
        fil: a.name,
        auteur: a.reviewer?.displayName ?? '',
        texte: `${etoiles ? `${'★'.repeat(etoiles)} ` : ''}${a.comment ?? ''}`.trim(),
        instant: instantDe(a.createTime),
        sortant: false,
      });
      if (a.reviewReply) {
        sortie.push({ genre: 'commentaire', distantId: `${a.name}/reply`, fil: a.name, auteur: ctx.nom, texte: a.reviewReply.comment, instant: instantDe(a.reviewReply.updateTime), sortant: true });
      }
    }
    return sortie;
  },

  async repondreCommentaire({ ctx, message, texte }) {
    await appel(`https://mybusiness.googleapis.com/v4/${message.fil}/reply`, {
      method: 'PUT',
      headers: { ...auth(ctx.jeton), 'content-type': 'application/json' },
      body: JSON.stringify({ comment: texte }),
    });
    return { distantId: `${message.fil}/reply` };
  },
};
