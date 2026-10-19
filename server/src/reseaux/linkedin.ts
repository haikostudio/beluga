import { DROITS_DEMANDES } from '@beluga/shared';
import { type Adaptateur, type CompteTrouve, type ContexteCompte, type MessageRelu, adresse, appel, echeance, formulaire, instantDe, lireOctets, premierMedia } from './commun.js';

/**
 * LINKEDIN — le profil de la personne ET les pages d'entreprise qu'elle
 * administre (Community Management API, ouverte sur demande par LinkedIn).
 *
 * L'auteur d'une publication est une URN : `urn:li:person:<id>` ou
 * `urn:li:organization:<id>`. Le jeton dure 60 jours ; LinkedIn ne donne un
 * jeton de renouvellement qu'aux applications qu'il a validées pour cela.
 * Pas de messages privés pour les applications.
 */

const REST = 'https://api.linkedin.com/rest';
const VERSION = '202409';

function entetes(jeton: string, json = true): Record<string, string> {
  return {
    authorization: `Bearer ${jeton}`,
    'linkedin-version': VERSION,
    'x-restli-protocol-version': '2.0.0',
    ...(json ? { 'content-type': 'application/json' } : {}),
  };
}

const auteur = (ctx: ContexteCompte) => String(ctx.details.urn ?? `urn:li:person:${ctx.distantId}`);

async function pagesAdministrees(jeton: string): Promise<{ id: string; nom: string }[]> {
  try {
    const r = await appel<{ elements: { organization: string }[] }>(adresse(`${REST}/organizationAcls`, { q: 'roleAssignee', role: 'ADMINISTRATOR', state: 'APPROVED' }), {
      headers: entetes(jeton, false),
    });
    const sortie: { id: string; nom: string }[] = [];
    for (const e of r.corps.elements ?? []) {
      const id = e.organization.split(':').pop()!;
      try {
        const o = await appel<{ localizedName?: string }>(`${REST}/organizations/${id}`, { headers: entetes(jeton, false) });
        sortie.push({ id, nom: o.corps.localizedName ?? `Page ${id}` });
      } catch {
        sortie.push({ id, nom: `Page ${id}` });
      }
    }
    return sortie;
  } catch {
    // Sans la Community Management API, seule la publication sur le profil est ouverte.
    return [];
  }
}

export const linkedin: Adaptateur = {
  urlDeConnexion: ({ app, retour, etat }) =>
    adresse('https://www.linkedin.com/oauth/v2/authorization', {
      response_type: 'code',
      client_id: app.clientId,
      redirect_uri: retour,
      state: etat,
      scope: DROITS_DEMANDES.linkedin.join(' '),
    }),

  async echangerCode({ app, retour, code }) {
    const j = await appel<{ access_token: string; expires_in: number; refresh_token?: string }>('https://www.linkedin.com/oauth/v2/accessToken', {
      method: 'POST',
      body: formulaire({ grant_type: 'authorization_code', code, redirect_uri: retour, client_id: app.clientId, client_secret: app.secret }),
    });
    const jetons = { acces: j.corps.access_token, rafraichissement: j.corps.refresh_token, expireLe: echeance(j.corps.expires_in) };
    const moi = await appel<{ sub: string; name?: string; picture?: string }>('https://api.linkedin.com/v2/userinfo', { headers: { authorization: `Bearer ${jetons.acces}` } });
    const comptes: CompteTrouve[] = [
      {
        reseau: 'linkedin',
        distantId: moi.corps.sub,
        nom: moi.corps.name ?? 'LinkedIn',
        avatar: moi.corps.picture,
        jetons,
        renouvelable: !!jetons.rafraichissement,
        details: { urn: `urn:li:person:${moi.corps.sub}`, genre: 'profil' },
      },
    ];
    for (const p of await pagesAdministrees(jetons.acces)) {
      comptes.push({ reseau: 'linkedin', distantId: `org-${p.id}`, nom: p.nom, jetons, renouvelable: !!jetons.rafraichissement, details: { urn: `urn:li:organization:${p.id}`, genre: 'page' } });
    }
    return comptes;
  },

  async rafraichir({ app, rafraichissement }) {
    const j = await appel<{ access_token: string; expires_in: number; refresh_token?: string }>('https://www.linkedin.com/oauth/v2/accessToken', {
      method: 'POST',
      body: formulaire({ grant_type: 'refresh_token', refresh_token: rafraichissement, client_id: app.clientId, client_secret: app.secret }),
    });
    return { acces: j.corps.access_token, rafraichissement: j.corps.refresh_token ?? rafraichissement, expireLe: echeance(j.corps.expires_in) };
  },

  async publier({ ctx, article }) {
    const corps: Record<string, unknown> = {
      author: auteur(ctx),
      commentary: article.texte,
      visibility: 'PUBLIC',
      distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
      lifecycleState: 'PUBLISHED',
      isReshareDisabledByAuthor: false,
    };
    const image = premierMedia(article, 'image');
    if (image) {
      const init = await appel<{ value: { uploadUrl: string; image: string } }>(`${REST}/images?action=initializeUpload`, {
        method: 'POST',
        headers: entetes(ctx.jeton),
        body: JSON.stringify({ initializeUploadRequest: { owner: auteur(ctx) } }),
      });
      await appel(init.corps.value.uploadUrl, { method: 'PUT', headers: { authorization: `Bearer ${ctx.jeton}`, 'content-type': image.mime }, body: new Uint8Array(lireOctets(image)), delaiMs: 180_000 });
      corps.content = { media: { id: init.corps.value.image, title: article.titre } };
    }
    const r = await appel(`${REST}/posts`, { method: 'POST', headers: entetes(ctx.jeton), body: JSON.stringify(corps) });
    const urn = r.entetes.get('x-restli-id') ?? r.entetes.get('x-linkedin-id') ?? '';
    return { distantId: urn, url: urn ? `https://www.linkedin.com/feed/update/${urn}/` : undefined };
  },

  async lireCommentaires({ ctx, publications }) {
    const sortie: MessageRelu[] = [];
    for (const p of publications) {
      if (!p.distantId) continue;
      const r = await appel<{ elements: { id?: string; $URN?: string; actor: string; message?: { text?: string }; created?: { time: number } }[] }>(
        `${REST}/socialActions/${encodeURIComponent(p.distantId)}/comments`,
        { headers: entetes(ctx.jeton, false) },
      );
      for (const c of r.corps.elements ?? []) {
        const id = c.$URN ?? c.id ?? '';
        sortie.push({
          genre: 'commentaire',
          distantId: id,
          fil: p.distantId,
          auteur: c.actor === auteur(ctx) ? ctx.nom : c.actor.startsWith('urn:li:organization') ? 'Page LinkedIn' : 'Membre LinkedIn',
          auteurId: c.actor,
          texte: c.message?.text ?? '',
          instant: instantDe(c.created?.time),
          sortant: c.actor === auteur(ctx),
        });
      }
    }
    return sortie;
  },

  async repondreCommentaire({ ctx, message, texte }) {
    const r = await appel(`${REST}/socialActions/${encodeURIComponent(message.fil)}/comments`, {
      method: 'POST',
      headers: entetes(ctx.jeton),
      body: JSON.stringify({ actor: auteur(ctx), object: message.fil, message: { text: texte }, ...(message.distantId.startsWith('urn:') ? { parentComment: message.distantId } : {}) }),
    });
    return { distantId: r.entetes.get('x-restli-id') ?? `${message.distantId}#reponse-${Date.now()}` };
  },
};
