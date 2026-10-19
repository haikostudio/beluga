import { DROITS_DEMANDES } from '@beluga/shared';
import { type Adaptateur, ErreurReseau, adresse, appel, basique, echeance, formulaire, lireOctets, premierMedia } from './commun.js';

/**
 * PINTEREST — l'API v5.
 *
 * Le jeton dure 30 jours, le renouvellement un an. Une épingle part sur le
 * PREMIER tableau du compte (retenu à la connexion), avec son image envoyée en
 * base64 : pas besoin que Pinterest vienne la chercher. Ni commentaires ni
 * messages par l'interface officielle.
 */

const API = 'https://api.pinterest.com/v5';

export const pinterest: Adaptateur = {
  urlDeConnexion: ({ app, retour, etat }) =>
    adresse('https://www.pinterest.com/oauth/', {
      client_id: app.clientId,
      redirect_uri: retour,
      response_type: 'code',
      scope: DROITS_DEMANDES.pinterest.join(','),
      state: etat,
    }),

  async echangerCode({ app, retour, code }) {
    const j = await appel<{ access_token: string; refresh_token?: string; expires_in: number }>(`${API}/oauth/token`, {
      method: 'POST',
      headers: { authorization: basique(app) },
      body: formulaire({ grant_type: 'authorization_code', code, redirect_uri: retour }),
    });
    const jeton = j.corps.access_token;
    const moi = await appel<{ username: string; profile_image?: string; id?: string }>(`${API}/user_account`, { headers: { authorization: `Bearer ${jeton}` } });
    const tableaux = await appel<{ items?: { id: string; name: string }[] }>(adresse(`${API}/boards`, { page_size: 25 }), { headers: { authorization: `Bearer ${jeton}` } });
    const tableau = tableaux.corps.items?.[0];
    return [
      {
        reseau: 'pinterest',
        distantId: moi.corps.id ?? moi.corps.username,
        nom: tableau ? `@${moi.corps.username} · ${tableau.name}` : `@${moi.corps.username}`,
        avatar: moi.corps.profile_image,
        jetons: { acces: jeton, rafraichissement: j.corps.refresh_token, expireLe: echeance(j.corps.expires_in) },
        renouvelable: !!j.corps.refresh_token,
        details: { tableauId: tableau?.id ?? null, utilisateur: moi.corps.username },
      },
    ];
  },

  async rafraichir({ app, rafraichissement }) {
    const j = await appel<{ access_token: string; refresh_token?: string; expires_in: number }>(`${API}/oauth/token`, {
      method: 'POST',
      headers: { authorization: basique(app) },
      body: formulaire({ grant_type: 'refresh_token', refresh_token: rafraichissement }),
    });
    return { acces: j.corps.access_token, rafraichissement: j.corps.refresh_token ?? rafraichissement, expireLe: echeance(j.corps.expires_in) };
  },

  async publier({ ctx, article }) {
    const image = premierMedia(article, 'image');
    if (!image) throw new ErreurReseau('Pinterest a besoin d’une image');
    if (!ctx.details.tableauId) throw new ErreurReseau('ce compte Pinterest n’a aucun tableau : créez-en un, puis reliez-le à nouveau');
    const r = await appel<{ id: string }>(`${API}/pins`, {
      method: 'POST',
      headers: { authorization: `Bearer ${ctx.jeton}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        board_id: ctx.details.tableauId,
        title: article.titre.slice(0, 100),
        description: article.texte.slice(0, 500),
        ...(article.lien ? { link: article.lien } : {}),
        media_source: { source_type: 'image_base64', content_type: image.mime === 'image/png' ? 'image/png' : 'image/jpeg', data: lireOctets(image).toString('base64') },
      }),
      delaiMs: 180_000,
    });
    return { distantId: r.corps.id, url: `https://www.pinterest.com/pin/${r.corps.id}/` };
  },
};
