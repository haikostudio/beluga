/**
 * L'OUTIL « capture » DES AGENTS (carte « Captures d'écran et plaquette client », 05/11/2026).
 *
 * Gestes, dans l'ordre d'un parcours :
 *  - `proposer`  : pose l'encadré « Capturer / Modifier la liste / Pas maintenant » avec la liste prévue. RIEN n'est
 *                  capturé ici. La recette est gardée sous un identifiant de proposition.
 *  - `capturer`  : exécute une proposition dont l'encadré a reçu « Capturer » — et seulement celle-là (vérifié dans le
 *                  fil, pas sur la parole de l'agent).
 *  - `maquette`  : photographie une maquette gratuite (cadres d'appareils ou planche d'extraits). Refuse sans STYLE et
 *                  sans FORMAT : ils se demandent à l'utilisateur à chaque fois (décision de l'utilisateur). La scène IA,
 *                  payante, part au Studio avec son prix et le clic.
 *  - `plaquette_marques`, `plaquette_creer`, `plaquette_lire`, `plaquette_modifier`, `plaquette_pdf` : la plaquette
 *                  client, un DOCUMENT PDF (A4 portrait, A4 paysage ou diapositives — le FORMAT se demande s'il n'est
 *                  pas dit). La MARQUE est celle du PROJET CIBLÉ — le projet de la carte, un autre seulement s'il est
 *                  nommé (carte « Charte : logo du bon projet ») ; le réglage « marque des plaquettes » ne donne plus
 *                  que la petite SIGNATURE de l'auteur (« Réalisé par … »). La charte est retenue par projet d'une
 *                  plaquette à l'autre. Un bloc « logo » refuse le logo de l'auteur. Rien de Haiko n'est écrit en dur. La création et
 *                  chaque modification FABRIQUENT le PDF et le joignent au fil (carte d'aperçu).
 *
 * L'agent n'envoie JAMAIS le lien au client lui-même : il le donne à l'utilisateur, qui l'envoie.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  AgentQuestion,
  REPONSE_CAPTURER,
  REPONSE_MODIFIER_LA_LISTE,
  REPONSE_PAS_MAINTENANT,
  FORMATS_DE_MAQUETTE,
  FORMATS_DE_PLAQUETTE,
  STYLES_DE_MAQUETTE,
  descriptionDeLaProposition,
  htmlDeMaquette,
  lireLaRecette,
  lireLeFormat,
  lireLeFormatDePlaquette,
  lireLAdresseDePlaquette,
  blocsDontLeTexteChange,
  SEUIL_DE_REFONTE,
  reponseAutoriseLaCapture,
  plaquetteDeLAgentDeCharte,
  type RecetteDeCapture,
} from '@beluga/shared';
import * as store from './store.js';
import type { ToolContext, ToolDef, ToolResult } from './tools.js';
import { cheminDePieceJointe } from './pieces-jointes.js';
import { joindreUnFichier } from './joindre-fichier.js';
import {
  charteRetenue,
  creerPlaquette,
  fabriquerLePdf,
  ficheDeLaPlaquette,
  lirePlaquette,
  listerPlaquettes,
  logoDansLeProjet,
  modifierPlaquette,
  noterUneCapture,
  refaireLePdfPlusTard,
  logosDeLaSignatureParmi,
  projetDeLaSignature,
  retenirLaCharte,
  type Plaquette,
} from './plaquettes.js';

export const OUTIL_CAPTURE: ToolDef = {
  name: 'capture',
  description:
    "L'OUTIL DE CAPTURES D'ÉCRAN, DE MAQUETTES ET DE PLAQUETTE CLIENT. À utiliser dès qu'une demande parle de montrer, présenter, " +
    'capturer un site ou une application, faire des visuels de vitrine ou un document pour un client — et quand l’utilisateur ' +
    'lance la commande /captures. PARCOURS : (1) « proposer » la recette (adresses, appareils, thèmes, connexion par un accès du ' +
    'coffre-fort = COMPTE DE DÉMONSTRATION, jamais de vraies données de clients) : un encadré « Capturer » s’affiche et ton tour ' +
    'attend le clic ; tu ne captures JAMAIS de toi-même. (2) Sur la réponse « Capturer », appelle « capturer » : les images sont jointes au fil et rangées dans les Fichiers (Captures). (3) Propose ensuite une maquette : ' +
    'DEMANDE TOUJOURS à l’utilisateur (ask_user, une question à la fois) le STYLE (appareils = cadres d’ordinateur et de téléphone, ' +
    'gratuits ; planche = extraits côte à côte, gratuite ; scene-ia = photo mise en scène, PAYANTE, via le Studio avec son prix ; ' +
    'combine = cadres ici + scène IA au Studio) puis le FORMAT (a4, a4-paysage, carre, story, paysage, ou LARGEURxHAUTEUR) ; puis ' +
    '« maquette ». (4) LA PLAQUETTE est un DOCUMENT PDF professionnel, une charte graphique complète : si l’utilisateur n’a pas dit le ' +
    'FORMAT, DEMANDE-LE (ask_user) : « a4-portrait », « a4-paysage » ou « diapositives » (présentation 16:9) — jamais de PowerPoint. ' +
    'S’il n’a pas dit s’il faut TUTOYER ou VOUVOYER le client, DEMANDE-LE aussi (ask_user, une question à la fois) et passe « adresse » : « tu » ou « vous » ; ' +
    'tout le texte du document suit ce choix. Quand tu REFAIS une charte existante (« plaquette_modifier » qui réécrit les textes), ' +
    'REDEMANDE tutoyer ou vouvoyer (ask_user) en rappelant le choix actuel, et passe « adresse » : sans lui, la refonte est refusée. ' +
    'LA MARQUE est celle du PROJET QUE LE DOCUMENT DÉCRIT — le projet de ta carte, un autre seulement si l’utilisateur le nomme ' +
    '(« projetMarque ») : logo, couleurs, police, couverture et pieds de page sont À SON IDENTITÉ, jamais à celle du studio qui ' +
    'rédige. Le studio (réglage « plaquette_marques ») n’apparaît qu’en petite signature « Réalisé par … », posée toute seule. ' +
    'Si aucune charte n’est retenue pour ce projet, RELÈVE ses couleurs et polices sur son site (« releve_de_charte ») et cherche ' +
    'son LOGO dans son dépôt (en-tête, pied de page, favicon, dossier public) ou sur son site ; joins-le avec attach_file pour ' +
    'avoir son identifiant et passe le tout dans « marque ». Pas de vrai logo trouvé : DEMANDE-LE (ask_user) — JAMAIS le logo ' +
    'd’un autre projet, ni celui du studio. ' +
    'UNE VRAIE CHARTE, DANS CET ORDRE : couverture ; « sommaire » (page 2, rempli tout seul) ; une « partie » « Charte graphique » avec ' +
    '« logo » (pieces: [version pour fond clair, version pour fond sombre] ; tuiles sur fond clair, sur la couleur, sur fond sombre, zone de protection — tes règles en texte : taille minimale, ' +
    'mauvais usages), « couleurs » (elements: [{ valeur: "#rrggbb", libelle: "Nom — rôle et usage" }] : HEX, RGB et CMJN sont calculés), ' +
    '« typographies » (elements: [{ valeur: "Famille", libelle: "Rôle — graisse, taille" }]), puis les COMPOSANTS réels (galerie de captures ' +
    'de boutons, champs, cartes, avec leurs états), le STYLE DES IMAGES, le TON ET LA VOIX (texte), des EXEMPLES D’APPLICATION ; ' +
    'ensuite une « partie » de PRÉSENTATION DU PRODUIT (sections texte, image, galerie, chiffres) ; enfin « ressources » (pieces: les ' +
    'fichiers à télécharger — logos, images ; visibles à l’écran ET dans le PDF). Les couleurs et polices se RELÈVENT sur le site ' +
    '(« releve_de_charte » avec « url »), jamais devinées. JAMAIS de bloc « appel » ni de « Vos remarques » : le client commente le ' +
    'document directement. Rédige un texte PROFESSIONNEL, clair, sans jargon, puis ' +
    '« plaquette_creer » : le PDF est fabriqué et joint au fil tout seul, avec un aperçu qui l’ouvre et mène au document. ' +
    'LES VISUELS : aucune image n’est recadrée. Une capture de site va dans un cadre de navigateur (appareil « navigateur », « url » ' +
    'pour l’adresse affichée), une capture mobile ou d’application installée dans un cadre d’iPhone (« telephone ») ; une capture ' +
    'PLEINE HAUTEUR (page entière) ne se met JAMAIS en couverture ni en image : elle va dans un bloc « annexes », en bas du document. ' +
    'LE SEUL cas d’une capture pleine hauteur dans une image : un site montré dans un cadre navigateur qui DÉFILE seul en ligne, ' +
    'avec « appareil: navigateur » et « defilant: true » (le PDF garde la capture entière, fixe). ' +
    '« zoom: true » seulement pour montrer volontairement un détail ; « aBord: gauche|droite » pour un visuel qui touche le bord de la page. ' +
    'L’utilisateur retouche le document dans le service « Charte graphique » (textes sur place, sections, charte, format). Tu lui ' +
    'donnes le lien privé, tu ne l’envoies JAMAIS toi-même au client.',
  inputSchema: {
    type: 'object',
    required: ['geste'],
    properties: {
      geste: {
        type: 'string',
        enum: ['proposer', 'capturer', 'maquette', 'releve_de_charte', 'plaquette_marques', 'plaquette_creer', 'plaquette_lire', 'plaquette_modifier', 'plaquette_pdf'],
      },
      url: { type: 'string', description: 'Pour « releve_de_charte » : l’adresse du site du client, dont on lit les couleurs et polices réelles' },
      recette: {
        type: 'object',
        description:
          'Pour « proposer » : { cibles: [{ url, nom }], appareils: ["ordinateur"|"telephone"], themes: ["clair"|"sombre"], pleinePage: true, ' +
          'connexion?: { acces: "<nom ou id de la fiche du coffre>", url?, champIdentifiant?, champMotDePasse?, bouton? }, ' +
          'video?: { appareil, secondesParPage }, masquer?: ["sélecteur CSS"], attente?: ms, langue?: "fr", garderLesSurcouches?: true }. ' +
          'Par défaut le bandeau de cookies est ACCEPTÉ puis retiré, et fenêtres surgissantes, bulles de discussion et boutons flottants sont retirés (en-tête conservé) : ' +
          '« garderLesSurcouches: true » seulement pour MONTRER ces éléments (audit de consentement).',
      },
      proposition: { type: 'string', description: 'Pour « capturer » : l’identifiant rendu par « proposer » (facultatif : la dernière proposition sinon)' },
      images: { type: 'array', items: { type: 'string' }, description: 'Pour « maquette » : identifiants des captures (pièces jointes)' },
      style: { type: 'string', enum: [...STYLES_DE_MAQUETTE], description: 'Pour « maquette » : le style CHOISI par l’utilisateur' },
      format: {
        type: 'string',
        description:
          `Pour « maquette » : le format CHOISI (${Object.keys(FORMATS_DE_MAQUETTE).join(', ')}, ou LARGEURxHAUTEUR). ` +
          `Pour « plaquette_creer/modifier » : ${FORMATS_DE_PLAQUETTE.join(', ')} (demandé à l’utilisateur s’il ne l’a pas dit).`,
      },
      titre: { type: 'string', description: 'Pour « maquette » (titre posé sur l’image, facultatif) et « plaquette_creer »' },
      sousTitre: { type: 'string' },
      couleurs: {
        type: 'object',
        description: 'Pour « maquette » : { couleur, fond, texte } en « #rrggbb » (celles de la marque)',
      },
      projetMarque: {
        type: 'string',
        description: 'Pour « plaquette_creer/modifier » : le projet que le document décrit et dont il prend la marque (id ou nom) — SEULEMENT si l’utilisateur en nomme un autre que celui de la carte ; absent : le projet de la carte',
      },
      marque: {
        type: 'object',
        description:
          'Pour « plaquette_creer/modifier » : la marque du PROJET DÉCRIT { nom, couleur, texte, fond, logo?: "<id de pièce jointe de SON logo>", police?, contact? } — à la création, ' +
          'complète la charte retenue (facultatif quand elle existe). La signature de l’auteur se pose toute seule : ne la mets pas ici',
      },
      blocs: {
        type: 'array',
        description:
          'Pour « plaquette_creer/modifier » : la liste ENTIÈRE des blocs, chacun { genre: couverture|sommaire|partie|texte|image|galerie|chiffres|logo|couleurs|typographies|ressources|annexes, ' +
          'titre?, texte?, pieces?: [id], legende?, elements?: [{ valeur, libelle }], ' +
          'appareil?: navigateur|telephone|aucun, defilant?: true (avec navigateur seulement : site qui défile seul en ligne), url?, zoom?: true, aBord?: gauche|droite, masque?: true, horsClient?: true, horsPdf?: true }. ' +
          'Une charte reçoit d’office, MASQUÉES, les parties « Cartes de visite et papier à lettres » : tu les remplis (maquettes) puis tu les rends visibles. ' +
          'Ordre : couverture, sommaire, partie « Charte graphique » (logo, couleurs, typographies, composants, images, ton, exemples), ' +
          'partie de présentation du produit, ressources ; les captures pleine hauteur dans un bloc « annexes » avant les ressources. Aucun bloc « appel ».',
        items: { type: 'object' },
      },
      langue: { type: 'string', enum: ['fr', 'en', 'es', 'de', 'zh'], description: 'La langue de la plaquette (celle du client)' },
      adresse: {
        type: 'string',
        enum: ['tu', 'vous'],
        description: 'Pour « plaquette_creer/modifier » : tutoyer ou vouvoyer le client — DEMANDÉ à l’utilisateur (ask_user) s’il ne l’a pas dit',
      },
      plaquette: { type: 'string', description: 'L’identifiant de la plaquette (lire, modifier, pdf)' },
    },
  },
};

/* Les propositions en attente du clic : en mémoire (un redémarrage les oublie — l'agent repropose). */
const propositions = new Map<string, { recette: RecetteDeCapture; questionId: string; agentId: string; projectId: string; faite: boolean }>();

function reponseDeLaQuestion(agentId: string, questionId: string): { trouvee: boolean; reponse?: string; annulee?: boolean } {
  for (const m of store.listMessages(agentId, 200)) {
    const q = (m.questions ?? []).find((x) => x.id === questionId);
    if (q) return { trouvee: true, reponse: q.answer, annulee: q.cancelled };
  }
  return { trouvee: false };
}

/** Pour les tests : une proposition posée, et la question qui l'accompagne. */
export function propositionEnAttente(id: string) {
  return propositions.get(id);
}

/**
 * LE BLOC « LOGO » NE MONTRE QUE LE LOGO DU PROJET DÉCRIT (décision de l'utilisateur) : refuse le logo de l'auteur
 * (en marque ou en pièce du bloc), et un bloc « logo » sans aucun logo. Rend le refus, ou `null`.
 */
function logoEtranger(marque: Record<string, unknown> | object, blocs: unknown, projetMarque: { id: string; name: string; path?: string | null }): string | null {
  const m = marque as Record<string, unknown>;
  const liste = Array.isArray(blocs) ? (blocs as Record<string, unknown>[]) : [];
  const blocsLogo = liste.filter((b) => b && b.genre === 'logo');
  const piecesLogo = blocsLogo.flatMap((b) => (Array.isArray(b.pieces) ? b.pieces.filter((x): x is string => typeof x === 'string') : []));
  const logoMarque = typeof m.logo === 'string' ? m.logo : undefined;
  const etrangers = logosDeLaSignatureParmi([...(logoMarque ? [logoMarque] : []), ...piecesLogo], projetMarque.id);
  const ou = `cherche le logo de « ${projetMarque.name} » dans son dépôt${projetMarque.path ? ` (${projetMarque.path})` : ''} (en-tête, pied de page, favicon, dossier public) ou sur son site, joins-le avec attach_file ; s’il n’en a pas, DEMANDE-LE à l’utilisateur (ask_user).`;
  if (etrangers.length) return `Ce logo est celui de l’auteur du document, pas de « ${projetMarque.name} » : un document est entièrement à l’identité du projet qu’il décrit. ${ou[0]!.toUpperCase()}${ou.slice(1)}`;
  if (blocsLogo.length && !logoMarque && blocsLogo.some((b) => !Array.isArray(b.pieces) || !b.pieces.length)) {
    return `Le bloc « logo » n’a aucun logo de « ${projetMarque.name} » à montrer : ${ou}`;
  }
  return null;
}

function projetDesigne(designation: string) {
  const d = designation.trim().toLowerCase();
  const tous = store.listProjects().filter((p) => !p.archived);
  return tous.find((p) => p.id === designation) ?? tous.find((p) => p.name.trim().toLowerCase() === d) ?? null;
}

/**
 * LE PDF DANS LE FIL : fabriqué tout de suite (borné), joint au message en cours — le fil le montre en carte d'aperçu
 * (vignette, titre, format) qui ouvre le PDF et mène à la plaquette. Un PDF qui échoue ne défait pas la plaquette :
 * l'échec se dit en clair.
 */
async function pdfDansLeFil(ctx: ToolContext, p: Plaquette, debut: string): Promise<ToolResult> {
  const fiche = ficheDeLaPlaquette(p.id)!;
  const adresse = `#plaquettes/${ctx.projectId}/${p.id}`;
  const lien = `- Lien privé pour le client (ne l’envoie PAS toi-même) : ${fiche.lien}`;
  const r = await fabriquerLePdf(p.id);
  if (!r.ok) {
    return {
      ok: true,
      text:
        `${debut}\n- Le PDF n’a PAS pu être fabriqué : ${r.raison} DIS-LE à l’utilisateur ; il peut le refaire depuis le service « Charte graphique » (${adresse}).\n${lien}`,
    };
  }
  return {
    ok: true,
    text:
      `${debut}\n- PDF (${r.piece.name}) joint au fil, avec son aperçu : un clic l’ouvre et mène au document dans le service « Charte graphique » (${adresse}). Rangé dans les Fichiers (Captures/Plaquettes).\n` +
      `${lien}\n` +
      'Dis à l’utilisateur qu’il peut retoucher le document dans le service « Charte graphique » (textes sur place, sections, charte, format) : le PDF se refait à chaque modification, et les commentaires de son client y arrivent.',
    attachment: r.piece,
  };
}

export async function outilCapture(ctx: ToolContext, args: Record<string, any>): Promise<ToolResult> {
  const geste = String(args.geste ?? '');
  switch (geste) {
    case 'releve_de_charte': {
      const { releverLaCharte } = await import('./releve-de-charte.js');
      const r = await releverLaCharte(String(args.url ?? '').trim());
      if (!r.ok) return { ok: false, text: r.raison };
      const { releve } = r;
      return {
        ok: true,
        text:
          `Charte relevée sur ${releve.url} (« ${releve.titre} ») — styles calculés par le navigateur :\n` +
          `COULEURS (de la plus présente à la moins présente) :\n${releve.couleurs.map((c) => `- ${c.hex} : ${c.usages.join(', ')} (poids ${c.poids})`).join('\n')}\n` +
          `POLICES :\n${releve.polices.map((p) => `- ${p.famille} : ${p.role} (graisse ${p.graisse}, ${p.taille})`).join('\n')}\n` +
          'Retiens les couleurs qui portent la marque (principale, texte, fond, accent ; jamais une couleur de hasard d’un seul élément) et nomme leur rôle dans le bloc « couleurs » ; une police par rôle dans « typographies ».',
      };
    }
    case 'proposer': {
      const lue = lireLaRecette(args.recette);
      if (!lue.ok) return { ok: false, text: lue.raison };
      const id = crypto.randomBytes(6).toString('hex');
      const question = AgentQuestion.parse({
        id: store.newId(),
        question: `Je capture ces ${lue.total} image${lue.total > 1 ? 's' : ''} ?`,
        description: descriptionDeLaProposition(lue.recette, lue.total),
        kind: 'single',
        options: [
          { id: 'o0', label: REPONSE_CAPTURER, description: 'Les images sont prises maintenant, puis rangées dans les Fichiers du projet.' },
          { id: 'o1', label: REPONSE_MODIFIER_LA_LISTE, description: 'Dites ce qu’il faut ajouter ou retirer ; une nouvelle liste vous sera proposée.' },
          { id: 'o2', label: REPONSE_PAS_MAINTENANT, description: 'Rien n’est capturé.' },
        ],
        allowFreeText: true,
      });
      propositions.set(id, { recette: lue.recette, questionId: question.id, agentId: ctx.agentId, projectId: ctx.projectId, faite: false });
      return {
        ok: true,
        text: `Encadré posé (proposition ${id}). Sur « ${REPONSE_CAPTURER} », appelle capture geste « capturer » avec proposition « ${id} ». Sur « ${REPONSE_MODIFIER_LA_LISTE} », repropose une recette corrigée. Sur « ${REPONSE_PAS_MAINTENANT} », ne capture rien.`,
        question,
      };
    }

    case 'capturer': {
      /* Le tour reçoit la seule réponse du clic, pas le texte de « proposer » : sans identifiant, c'est la DERNIÈRE
         proposition de cet agent qui vaut. */
      let id = String(args.proposition ?? '');
      if (!id) id = [...propositions.entries()].filter(([, x]) => x.agentId === ctx.agentId).map(([k]) => k).pop() ?? '';
      const p = propositions.get(id);
      if (!p || p.agentId !== ctx.agentId) return { ok: false, text: 'Proposition inconnue : appelle d’abord « proposer » — rien ne se capture sans le clic de l’utilisateur.' };
      if (p.faite) return { ok: false, text: 'Cette proposition a déjà été capturée. Pour d’autres images, propose une nouvelle recette.' };
      const r = reponseDeLaQuestion(ctx.agentId, p.questionId);
      if (!r.trouvee || r.annulee || !reponseAutoriseLaCapture(r.reponse)) {
        return { ok: false, text: `L’utilisateur n’a pas répondu « ${REPONSE_CAPTURER} » à l’encadré : rien n’est capturé.` };
      }
      p.faite = true;
      const { executerLaRecette } = await import('./capture-ecran.js');
      const resultat = await executerLaRecette({ recette: p.recette, projectId: ctx.projectId, agentId: ctx.agentId, cardId: ctx.cardId });
      const { attachToCurrentMessage } = await import('./runtime.js');
      for (const piece of [...resultat.pieces, ...(resultat.video ? [resultat.video] : [])]) attachToCurrentMessage(ctx.agentId, { attachment: piece.id });
      const lignes = resultat.pieces.map((a) => `- ${a.name} — id ${a.id} — ![${a.name}](piece:${a.id})`);
      if (resultat.video) lignes.push(`- vidéo ${resultat.video.name} — id ${resultat.video.id}`);
      const erreurs = resultat.erreurs.length ? `\nÀ SIGNALER à l’utilisateur, en clair :\n${resultat.erreurs.map((e) => `- ${e}`).join('\n')}` : '';
      return {
        ok: resultat.pieces.length > 0 || !!resultat.video,
        text:
          `${resultat.pieces.length} image(s)${resultat.video ? ' et une vidéo' : ''} jointes au fil et rangées dans les Fichiers (Captures).\n${lignes.join('\n')}${erreurs}\n` +
          'Montre-les, puis propose une maquette (demande le style puis le format) et une plaquette client (aux couleurs du projet qu’elle décrit).',
      };
    }

    case 'maquette': {
      const style = String(args.style ?? '');
      const format = lireLeFormat(args.format);
      if (!(STYLES_DE_MAQUETTE as readonly string[]).includes(style) || !format) {
        return {
          ok: false,
          text:
            'Le STYLE et le FORMAT se demandent à l’utilisateur à chaque fois (ask_user, une question à la fois) : style « appareils » (cadres, gratuit), ' +
            '« planche » (extraits, gratuit), « scene-ia » (photo mise en scène, payante, au Studio) ou « combine » ; format a4, a4-paysage, carre, story, paysage ou LARGEURxHAUTEUR.',
        };
      }
      if (style === 'scene-ia') {
        return {
          ok: true,
          text:
            'La scène IA est PAYANTE : elle se fait au Studio (outil « services », service studio), avec son prix affiché et le clic de l’utilisateur. ' +
            'Passe-lui les captures choisies comme images de référence et le format demandé. Rien ne se génère d’ici.',
        };
      }
      const ids: string[] = Array.isArray(args.images) ? args.images.filter((x: unknown): x is string => typeof x === 'string').slice(0, 6) : [];
      const pieces = ids.map((id) => store.getAttachment(id)).filter((a): a is NonNullable<typeof a> => !!a && a.projectId === ctx.projectId && !!a.mime?.startsWith('image/'));
      if (!pieces.length) return { ok: false, text: 'Aucune image du projet parmi « images » : passe les identifiants des captures.' };
      const c = (args.couleurs ?? {}) as Record<string, unknown>;
      const teinte = (v: unknown, defaut: string) => (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v : defaut);
      const images = pieces.map((a) => {
        const f = cheminDePieceJointe(a);
        return {
          src: `data:${a.mime};base64,${fs.readFileSync(f).toString('base64')}`,
          appareil: /telephone|mobile|phone/i.test(a.name) ? ('telephone' as const) : ('ordinateur' as const),
        };
      });
      const html = htmlDeMaquette({
        style: style === 'planche' ? 'planche' : 'appareils',
        largeur: format.largeur,
        hauteur: format.hauteur,
        images,
        titre: typeof args.titre === 'string' ? args.titre.slice(0, 120) : undefined,
        sousTitre: typeof args.sousTitre === 'string' ? args.sousTitre.slice(0, 200) : undefined,
        couleur: teinte(c.couleur, '#6d5dfc'),
        fond: teinte(c.fond, '#f6f6f8'),
        texte: teinte(c.texte, '#16181d'),
      });
      const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'maquette-'));
      try {
        const { photographierLeHtml } = await import('./capture-ecran.js');
        const nom = `maquette-${style === 'planche' ? 'planche' : 'appareils'}-${format.nom}`;
        const fichier = await photographierLeHtml(html, format.largeur, format.hauteur, dossier, nom);
        const j = await joindreUnFichier({ projectId: ctx.projectId, agentId: ctx.agentId, cardId: ctx.cardId, fichier, nom: `${nom}.webp`, deLAgent: true });
        if (!j.ok) return { ok: false, text: j.refus };
        noterUneCapture({ attachmentId: j.attachment.id, projectId: ctx.projectId, genre: 'maquette' });
        const suite = style === 'combine' ? ' Pour la scène IA de la combinaison, passe par le Studio (payant, avec son prix et le clic).' : '';
        return {
          ok: true,
          text: `Maquette jointe au fil et rangée dans les Fichiers (Captures/Maquettes) : ${j.attachment.name}, id ${j.attachment.id}. Montre-la : ![maquette](piece:${j.attachment.id}).${suite}`,
          attachment: j.attachment,
        };
      } catch (err) {
        return { ok: false, text: `La maquette n’a pas pu être fabriquée : ${(err as Error).message.split('\n')[0]}` };
      } finally {
        fs.rmSync(dossier, { recursive: true, force: true });
      }
    }

    case 'plaquette_marques': {
      const projets = store.listProjects().filter((p) => !p.archived);
      const cible = store.getProject(ctx.projectId);
      const charte = cible ? charteRetenue(cible.id) : null;
      const auteur = projetDeLaSignature();
      const dejaFaites = listerPlaquettes(ctx.projectId);
      return {
        ok: true,
        text:
          (cible
            ? `LA MARQUE est celle du projet que le document décrit : « ${cible.name} » (id ${cible.id}), le projet de ta carte — ne la demande PAS.` +
              (charte
                ? ` Sa charte est retenue (couleur ${charte.couleur}, texte ${charte.texte}, fond ${charte.fond}${charte.logo ? ', logo' : ', SANS logo'}${charte.police ? `, police ${charte.police}` : ''}) : « plaquette_creer » la reprend toute seule.`
                : ` Aucune charte retenue pour lui : relève ses couleurs et polices sur son site (« releve_de_charte »), cherche son logo dans son dépôt${cible.path ? ` (${cible.path})` : ''} (en-tête, pied de page, favicon, dossier public) ou sur son site, joins-le avec attach_file, et passe le tout dans « marque » — elle sera retenue pour les fois suivantes. Aucun vrai logo : demande-le (ask_user).`)
            : 'Le projet de ta carte est introuvable : demande à l’utilisateur quel projet le document décrit.') +
          (auteur
            ? `\nLA SIGNATURE « Réalisé par ${auteur.name} » se pose toute seule, en petit, sur la couverture et la dernière page : jamais son logo ni ses couleurs dans le document.`
            : '\nAucune signature d’auteur n’est réglée (réglage du service « Charte graphique », menu à trois points) : le document n’en porte pas.') +
          '\nUn autre projet ne se prend QUE si l’utilisateur le nomme (« projetMarque ») :\n' +
          projets.map((p) => `- ${p.name} (id ${p.id})${p.path ? ` — dépôt ${p.path}` : ''}`).join('\n') +
          '\nLe FORMAT se demande s’il n’a pas été dit : a4-portrait, a4-paysage ou diapositives.' +
          (dejaFaites.length ? `\nPlaquettes déjà faites dans ce projet : ${dejaFaites.map((p) => `« ${p.titre} » (id ${p.id}, ${p.format})`).join(', ')}.` : ''),
      };
    }

    case 'plaquette_creer': {
      /* L'AGENT D'UNE CHARTE travaille sur SON document, déjà ouvert : il n'en crée jamais un second. */
      const charteDeLAgent = plaquetteDeLAgentDeCharte(store.getAgent(ctx.agentId)?.service);
      if (charteDeLAgent) {
        return { ok: false, text: `Ce document existe déjà et il est ouvert à droite de la conversation : écris dedans avec « plaquette_modifier », plaquette = ${charteDeLAgent.plaquetteId}.` };
      }
      const format = lireLeFormatDePlaquette(args.format);
      if (!format) {
        return {
          ok: false,
          text: 'Le FORMAT se DEMANDE à l’utilisateur (ask_user) quand il ne l’a pas dit : « a4-portrait », « a4-paysage » ou « diapositives » (présentation). Puis passe-le dans « format ».',
        };
      }
      /* TU OU VOUS se demande comme le format (décision de l'utilisateur) : jamais choisi à sa place. */
      const adresse = lireLAdresseDePlaquette(args.adresse);
      if (!adresse) {
        return {
          ok: false,
          text: 'Faut-il TUTOYER ou VOUVOYER le client ? DEMANDE-LE à l’utilisateur (ask_user) s’il ne l’a pas dit, puis passe « adresse » : « tu » ou « vous », et rédige tout le texte dans ce registre.',
        };
      }
      const designation = typeof args.projetMarque === 'string' ? args.projetMarque.trim() : '';
      /* LA MARQUE = LE PROJET DÉCRIT (décision de l'utilisateur) : celui de la carte, un autre seulement s'il est nommé. */
      const projetMarque = designation ? projetDesigne(designation) : (store.getProject(ctx.projectId) ?? null);
      if (!projetMarque) {
        return {
          ok: false,
          text: designation
            ? `Aucun projet ouvert ne s’appelle « ${designation} » : « plaquette_marques » donne la liste.`
            : 'Le projet de ta carte est introuvable : demande à l’utilisateur quel projet le document décrit, puis passe-le dans « projetMarque ».',
        };
      }
      const retenue = charteRetenue(projetMarque.id);
      const donnee = typeof args.marque === 'object' && args.marque ? (args.marque as Record<string, unknown>) : {};
      const { logoProjet: _, ...charte } = retenue ?? { logoProjet: undefined };
      const brute: Record<string, unknown> = { nom: projetMarque.name, ...charte, ...donnee };
      if (typeof brute.couleur !== 'string') {
        return {
          ok: false,
          text: `Aucune charte n’est encore retenue pour « ${projetMarque.name} » : relève ses couleurs et polices sur son site (« releve_de_charte »), cherche son logo dans son dépôt${projetMarque.path ? ` (${projetMarque.path})` : ''} ou sur son site, joins-le avec attach_file, puis passe « marque » : { couleur, texte, fond, logo, police?, contact? }. Aucun vrai logo : demande-le (ask_user).`,
        };
      }
      const logo = typeof brute.logo === 'string' ? store.pieceJointeDesignee(brute.logo, ctx.projectId)?.id : undefined;
      brute.logo = await logoDansLeProjet(logo, ctx.projectId);
      /* La signature de l'auteur : posée ici, jamais par l'agent. */
      const auteur = projetDeLaSignature();
      if (auteur && auteur.id !== projetMarque.id) brute.signature = auteur.name;
      else delete brute.signature;
      const refusDuLogo = logoEtranger(brute, args.blocs, projetMarque);
      if (refusDuLogo) return { ok: false, text: refusDuLogo };
      const cree = creerPlaquette({
        projectId: ctx.projectId,
        cardId: ctx.cardId,
        agentId: ctx.agentId,
        projetMarqueId: projetMarque.id,
        titre: String(args.titre ?? ''),
        langue: args.langue,
        blocs: args.blocs,
        marque: brute,
        format,
        adresse,
      });
      if (!cree.ok) return { ok: false, text: cree.raison };
      retenirLaCharte(projetMarque.id, cree.plaquette.marque, ctx.projectId);
      return pdfDansLeFil(ctx, cree.plaquette, `Plaquette « ${cree.plaquette.titre} » créée (id ${cree.plaquette.id}, ${format}, ${adresse === 'tu' ? 'tutoiement' : 'vouvoiement'}), aux couleurs de ${projetMarque.name}.`);
    }

    case 'plaquette_lire': {
      const fiche = ficheDeLaPlaquette(String(args.plaquette ?? ''));
      if (!fiche || fiche.plaquette.projectId !== ctx.projectId) return { ok: false, text: 'Plaquette introuvable dans ce projet.' };
      return {
        ok: true,
        text: JSON.stringify(
          {
            titre: fiche.plaquette.titre,
            version: fiche.plaquette.version,
            langue: fiche.plaquette.langue,
            marque: fiche.plaquette.marque,
            blocs: fiche.plaquette.blocs,
            lienActif: fiche.plaquette.lienActif,
            adresse: fiche.plaquette.adresse,
            ouvertures: fiche.ouvertures.total,
            commentaires: fiche.fils.map((f) => ({ page: f.page, bloc: f.bloc, resolu: f.resolu, messages: f.messages.map((m) => ({ auteur: m.auteur, role: m.role, texte: m.texte })) })),
          },
          null,
          2,
        ),
      };
    }

    case 'plaquette_modifier': {
      const p = lirePlaquette(String(args.plaquette ?? ''));
      if (!p || p.projectId !== ctx.projectId) return { ok: false, text: 'Plaquette introuvable dans ce projet.' };
      const format = args.format === undefined ? undefined : lireLeFormatDePlaquette(args.format);
      if (args.format !== undefined && !format) return { ok: false, text: `Format inconnu : ${FORMATS_DE_PLAQUETTE.join(', ')}.` };
      const adresse = args.adresse === undefined ? undefined : lireLAdresseDePlaquette(args.adresse);
      if (args.adresse !== undefined && !adresse) return { ok: false, text: 'Adresse inconnue : « tu » ou « vous ».' };
      /* UNE REFONTE DES TEXTES REDEMANDE TU OU VOUS (décision de l'utilisateur, 06/11/2026) : réécrire plusieurs blocs d'une
         charte existante sans « adresse » est refusé — le registre se redemande, le choix actuel rappelé. Une retouche
         d'un seul bloc, de la couleur ou du format passe sans question. */
      if (Array.isArray(args.blocs) && !adresse && blocsDontLeTexteChange(p.blocs, args.blocs) >= SEUIL_DE_REFONTE) {
        const actuel = p.adresse === 'tu' ? 'tutoyer' : p.adresse === 'vous' ? 'vouvoyer' : 'non choisi';
        return {
          ok: false,
          text: `Tu réécris les textes de ce document : DEMANDE d'abord à l'utilisateur (ask_user) s'il faut TUTOYER ou VOUVOYER le client — choix actuel : ${actuel} —, puis repasse « plaquette_modifier » avec « adresse » (« tu » ou « vous ») et des textes rédigés dans ce registre.`,
        };
      }
      /*
       * LE PROJET DÉCRIT : celui que l'utilisateur nomme (« projetMarque »), sinon celui qui donnait déjà la marque — sauf
       * si c'était l'AUTEUR et que la nouvelle marque porte un autre nom (un ancien document aux couleurs du studio qu'on
       * remet à celles du client) : alors le projet de la plaquette.
       */
      const auteur = projetDeLaSignature();
      const designation = typeof args.projetMarque === 'string' ? args.projetMarque.trim() : '';
      const nommee = designation ? projetDesigne(designation) : null;
      if (designation && !nommee) return { ok: false, text: `Aucun projet ouvert ne s’appelle « ${designation} » : « plaquette_marques » donne la liste.` };
      const avant = (p.projetMarqueId ? store.getProject(p.projetMarqueId) : null) ?? store.getProject(p.projectId) ?? null;
      const nomDonne = args.marque && typeof args.marque === 'object' ? String((args.marque as Record<string, unknown>).nom ?? '').trim() : '';
      const quitteLAuteur = !!auteur && avant?.id === auteur.id && !!nomDonne && nomDonne !== auteur.name;
      const projetMarque = nommee ?? (quitteLAuteur ? (store.getProject(p.projectId) ?? null) : avant);
      let marque = args.marque;
      if (marque && typeof marque === 'object') {
        /* La signature reste posée par Beluga : celle du réglage quand la marque n'est pas l'auteur lui-même. */
        const m = { ...(marque as Record<string, unknown>) };
        if (auteur && auteur.id !== projetMarque?.id) m.signature = auteur.name;
        else delete m.signature;
        marque = m;
      }
      if (projetMarque && (args.blocs !== undefined || args.marque !== undefined)) {
        const refusDuLogo = logoEtranger((marque as Record<string, unknown> | undefined) ?? p.marque, args.blocs ?? p.blocs, projetMarque);
        if (refusDuLogo) return { ok: false, text: refusDuLogo };
      }
      const r = modifierPlaquette(p.id, {
        titre: args.titre,
        blocs: args.blocs,
        marque,
        langue: args.langue,
        format,
        adresse,
        ...(projetMarque && projetMarque.id !== p.projetMarqueId ? { projetMarqueId: projetMarque.id } : {}),
      });
      if (!r.ok) return { ok: false, text: r.raison };
      if (projetMarque && r.plaquette.projetMarqueId === projetMarque.id && args.marque !== undefined) retenirLaCharte(projetMarque.id, r.plaquette.marque, ctx.projectId);
      /* L'AGENT D'UNE CHARTE écrit à chaque décision, et le document se voit déjà à droite de sa conversation : pas de PDF
         fabriqué à chaque pas (Chrome, jusqu'à deux minutes) — il se refait seul un peu plus tard. */
      if (plaquetteDeLAgentDeCharte(store.getAgent(ctx.agentId)?.service)?.plaquetteId === p.id) {
        refaireLePdfPlusTard(p.id);
        return { ok: true, text: `Charte mise à jour (version ${r.plaquette.version}) : elle se voit déjà dans le volet à droite de la conversation. Le PDF se refait tout seul.` };
      }
      return pdfDansLeFil(ctx, r.plaquette, `Plaquette mise à jour (version ${r.plaquette.version}). Le lien privé montre déjà cette version.`);
    }

    case 'plaquette_pdf': {
      const p = lirePlaquette(String(args.plaquette ?? ''));
      if (!p || p.projectId !== ctx.projectId) return { ok: false, text: 'Plaquette introuvable dans ce projet.' };
      return pdfDansLeFil(ctx, p, `PDF de la version ${p.version}.`);
    }

    default:
      return { ok: false, text: `Geste inconnu « ${geste} ».` };
  }
}
