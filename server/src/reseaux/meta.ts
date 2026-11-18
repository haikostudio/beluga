import { DROITS_DEMANDES } from '@beluga/shared';
import { chiffre, type Adaptateur, type CompteTrouve, type IdentifiantsApplication, type MessageRelu, ErreurReseau, adresse, appel, attendre, formulaire, instantDe, premierMedia } from './commun.js';

/**
 * FACEBOOK (pages) ET INSTAGRAM (comptes professionnels) — l'API Graph de Meta.
 *
 * Une seule application Meta pour les deux. La connexion rend un jeton
 * d'utilisateur, échangé contre un jeton LONG ; les jetons de PAGE qu'on en
 * tire n'expirent pas. Instagram passe par la page Facebook à laquelle le
 * compte professionnel est rattaché : c'est son jeton qui publie, commente et
 * répond aux messages.
 *
 * INSTAGRAM SANS PAGE — LA CONNEXION UNIFIÉE (12/11/2026) : quand l'application
 * a sa configuration « Facebook Login for Business » (`configConnexion`), le
 * bouton Relier d'Instagram ouvre `dialog/oauth?config_id=…` ; la personne se
 * connecte avec Facebook OU avec Instagram, choisit le portefeuille et le compte.
 * Le code rend un jeton d'utilisateur SYSTÈME de l'entreprise cliente (sans
 * échéance, pas d'échange long) ; `me/assigned_instagram_accounts` donne les
 * comptes, et tout se fait sur l'identifiant Instagram lui-même (messages
 * compris), sans page. Les applications Meta récentes n'offrent plus la
 * connexion « Instagram seul » : c'est la seule voie pour un compte qu'aucune
 * page ne porte (@belugabuild).
 */

const GRAPH = 'https://graph.facebook.com/v21.0';

function urlDeConnexion(reseau: 'facebook' | 'instagram') {
  return ({ app, retour, etat }: { app: IdentifiantsApplication; retour: string; etat: string }) =>
    reseau === 'instagram' && app.configConnexion
      ? /* Connexion unifiée : les droits viennent de la configuration ; `prompt=login` offre « Continuer avec Instagram ». */
        adresse('https://www.facebook.com/v21.0/dialog/oauth', {
          client_id: app.clientId,
          config_id: app.configConnexion,
          redirect_uri: retour,
          state: etat,
          response_type: 'code',
          override_default_response_type: 'true',
          prompt: 'login',
        })
      : adresse('https://www.facebook.com/v21.0/dialog/oauth', {
          client_id: app.clientId,
          redirect_uri: retour,
          state: etat,
          response_type: 'code',
          scope: DROITS_DEMANDES[reseau].join(','),
        });
}

async function jetonCourt(app: IdentifiantsApplication, retour: string, code: string): Promise<string> {
  const r = await appel<{ access_token: string }>(adresse(`${GRAPH}/oauth/access_token`, { client_id: app.clientId, client_secret: app.secret, redirect_uri: retour, code }));
  return r.corps.access_token;
}

/** Les comptes Instagram confiés par la connexion unifiée, toutes pages de résultats lues. */
async function comptesInstagramConfies(jeton: string): Promise<{ id: string; username?: string; profile_picture_url?: string }[]> {
  const sortie: { id: string; username?: string; profile_picture_url?: string }[] = [];
  let url: string | undefined = adresse(`${GRAPH}/me/assigned_instagram_accounts`, { access_token: jeton, limit: 100, fields: 'id,username,profile_picture_url' });
  for (let i = 0; url && i < 10; i += 1) {
    const r: { corps: { data?: { id: string; username?: string; profile_picture_url?: string }[]; paging?: { next?: string } } } = await appel(url);
    sortie.push(...(r.corps.data ?? []));
    url = r.corps.paging?.next;
  }
  return sortie;
}

/** L'objet qui porte les messages privés d'un compte Instagram : sa page, ou lui-même s'il est relié sans page. */
const porteurDesMessages = (ctx: { distantId: string; details: Record<string, any> }) => String(ctx.details.pageId || ctx.distantId);

async function jetonLong(app: IdentifiantsApplication, retour: string, code: string): Promise<string> {
  const court = await jetonCourt(app, retour, code);
  const long = await appel<{ access_token: string }>(
    adresse(`${GRAPH}/oauth/access_token`, { grant_type: 'fb_exchange_token', client_id: app.clientId, client_secret: app.secret, fb_exchange_token: court }),
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

  /* Graph API, commentaire de page : `is_hidden` le masque au public, DELETE le supprime. */
  async masquerCommentaire({ ctx, message }) {
    await appel(`${GRAPH}/${message.distantId}`, { method: 'POST', body: formulaire({ is_hidden: 'true', access_token: ctx.jeton }) });
  },

  async supprimerCommentaire({ ctx, message }) {
    await appel(adresse(`${GRAPH}/${message.distantId}`, { access_token: ctx.jeton }), { method: 'DELETE' });
  },

  lireMessages: ({ ctx }) => conversations(ctx.distantId, ctx.jeton, 'messenger', ctx.distantId),

  async lireStatistiques({ ctx, publications }) {
    const abonnes = await chiffre(async () => (await appel<{ followers_count?: number }>(adresse(`${GRAPH}/${ctx.distantId}`, { fields: 'followers_count', access_token: ctx.jeton }))).corps.followers_count ?? null);
    const lignes = [];
    for (const p of publications) {
      /* Meta renomme ses métriques : « post_media_view » d'abord, l'ancienne ensuite. */
      const lireVues = (metrique: string) => async () => valeurDInsights((await appel(adresse(`${GRAPH}/${p.distantId}/insights`, { metric: metrique, access_token: ctx.jeton }))).corps);
      const vues = (await chiffre(lireVues('post_media_view'))) ?? (await chiffre(lireVues('post_impressions')));
      let commentaires: number | null = null;
      let reactions: number | null = null;
      try {
        const r = await appel<{ comments?: { summary?: { total_count?: number } }; reactions?: { summary?: { total_count?: number } } }>(
          adresse(`${GRAPH}/${p.distantId}`, { fields: 'comments.summary(true).limit(0),reactions.summary(true).limit(0)', access_token: ctx.jeton }),
        );
        commentaires = r.corps.comments?.summary?.total_count ?? null;
        reactions = r.corps.reactions?.summary?.total_count ?? null;
      } catch {
        /* Non fournis. */
      }
      lignes.push({ distantId: p.distantId, vues, commentaires, reactions });
    }
    return { abonnes, publications: lignes };
  },

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

/** Une métrique de `…/insights` : sa première valeur, `null` lue comme absente. */
function valeurDInsights(corps: { data?: { name?: string; values?: { value?: unknown }[]; total_value?: { value?: unknown } }[] }, nom?: string): unknown {
  const ligne = nom ? corps.data?.find((d) => d.name === nom) : corps.data?.[0];
  return ligne?.total_value?.value ?? ligne?.values?.[0]?.value ?? null;
}

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
    if (app.configConnexion) {
      /* Connexion unifiée : jeton système sans échéance ; les comptes confiés, puis ceux des pages qu'il ouvrirait aussi. */
      const jeton = await jetonCourt(app, retour, code);
      let entreprise: string | undefined;
      try {
        entreprise = (await appel<{ client_business_id?: string }>(adresse(`${GRAPH}/me`, { fields: 'client_business_id', access_token: jeton }))).corps.client_business_id;
      } catch {
        /* Facultatif : sert seulement à retrouver le portefeuille. */
      }
      const trouves = new Map<string, CompteTrouve>();
      for (const c of await comptesInstagramConfies(jeton)) {
        trouves.set(c.id, {
          reseau: 'instagram',
          distantId: c.id,
          nom: c.username ? `@${c.username}` : c.id,
          avatar: c.profile_picture_url,
          jetons: { acces: jeton },
          renouvelable: false,
          details: { voie: 'unifiee', ...(entreprise ? { entreprise } : {}) },
        });
      }
      for (const p of await pages(jeton).catch(() => [] as PageMeta[])) {
        const ig = p.instagram_business_account;
        if (!ig?.id || trouves.has(ig.id)) continue;
        trouves.set(ig.id, { reseau: 'instagram', distantId: ig.id, nom: ig.username ? `@${ig.username}` : p.name, avatar: ig.profile_picture_url, jetons: { acces: p.access_token }, renouvelable: false, details: { pageId: p.id } });
      }
      return [...trouves.values()];
    }
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

  /* Instagram Graph API : `hide` masque le commentaire, DELETE le supprime. */
  async masquerCommentaire({ ctx, message }) {
    await appel(`${GRAPH}/${message.distantId}`, { method: 'POST', body: formulaire({ hide: 'true', access_token: ctx.jeton }) });
  },

  async supprimerCommentaire({ ctx, message }) {
    await appel(adresse(`${GRAPH}/${message.distantId}`, { access_token: ctx.jeton }), { method: 'DELETE' });
  },

  lireMessages: ({ ctx }) => conversations(porteurDesMessages(ctx), ctx.jeton, 'instagram', ctx.distantId),

  async lireStatistiques({ ctx, publications }) {
    const abonnes = await chiffre(async () => (await appel<{ followers_count?: number }>(adresse(`${GRAPH}/${ctx.distantId}`, { fields: 'followers_count', access_token: ctx.jeton }))).corps.followers_count ?? null);
    const lignes = [];
    for (const p of publications) {
      const vues = await chiffre(async () => valeurDInsights((await appel(adresse(`${GRAPH}/${p.distantId}/insights`, { metric: 'views', access_token: ctx.jeton }))).corps));
      let commentaires: number | null = null;
      let reactions: number | null = null;
      try {
        const r = await appel<{ comments_count?: number; like_count?: number }>(adresse(`${GRAPH}/${p.distantId}`, { fields: 'comments_count,like_count', access_token: ctx.jeton }));
        commentaires = r.corps.comments_count ?? null;
        reactions = r.corps.like_count ?? null;
      } catch {
        /* Non fournis. */
      }
      lignes.push({ distantId: p.distantId, vues, commentaires, reactions });
    }
    return { abonnes, publications: lignes };
  },

  async repondreMessage({ ctx, message, texte }) {
    const id = await destinataire(message.fil, ctx.jeton, ctx.distantId, message.auteurId);
    const r = await appel<{ message_id: string }>(adresse(`${GRAPH}/${porteurDesMessages(ctx)}/messages`, { access_token: ctx.jeton }), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ recipient: { id }, message: { text: texte } }),
    });
    return { distantId: r.corps.message_id };
  },
};
