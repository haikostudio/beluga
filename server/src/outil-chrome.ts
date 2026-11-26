/**
 * L'OUTIL « chrome » DES AGENTS (carte « Pilotage de Chrome par Beluga », 09/11/2026).
 *
 * Tous les agents le reçoivent dès qu'un Chrome est relié quelque part (`unChromeEstRelie`). Il agit dans le Chrome
 * de la PERSONNE QUI PARLE À L'AGENT (`interlocuteurDeLAgent`) — jamais dans celui d'un autre compte —, dans SA
 * fenêtre en cours (aucune fenêtre à part depuis la carte « Panneau Chrome façon discussion »), un groupe d'onglets
 * coloré par agent. Chrome suit l'agent seulement quand la personne regarde déjà un onglet de son groupe.
 *
 * L'ordre des portes, à chaque geste :
 *  1. le Chrome : aucun → le dire ; un seul → pris ; plusieurs → l'agent demande (question bloquante) ;
 *  2. la main : si la personne l'a prise, le geste attend « Rendre la main » ;
 *  3. le site : inconnu → permis, sans question (agent AUTONOME, carte « Fil du chat en ordre chronologique ») ;
 *     lecture seule posée dans les réglages → lire oui, agir jamais ; refusé → rien ;
 *  4. le geste lourd — SEULEMENT l'argent (paiement, banque) et la suppression d'un compte : confirmé à CHAQUE fois,
 *     routines comprises — signes de l'agent (intention) ET de la page (libellé), jamais sa seule bonne foi ;
 *  5. le geste part, et ceux qui agissent laissent une image au film de la session.
 *
 * Les questions BLOQUENT l'agent comme `ask_user` (DEC-026) et leur SUITE fait le geste après le clic
 * (`attente-question.ts`) ; elles s'affichent dans l'application ET dans le panneau latéral de Chrome.
 * LE COFFRE-FORT : la valeur d'un mot de passe ne passe que du démon au Chrome, en mémoire ; jamais dans un
 * résultat d'outil, un journal, un message ni le film.
 */
import {
  AgentQuestion,
  GESTES_CHROME,
  REPONSE_FAIRE_LE_GESTE,
  REPONSE_NE_PAS_FAIRE_LE_GESTE,
  REPONSE_RENDRE_LA_MAIN,
    decisionDeSite,
  fichesPourLaPage,
  gesteLourd,
  blocageDeLaPage,
  carnetDeDepart,
  champDeNomDefinitif,
  ligneDuBlocage,
  sujetDuCarnet,
  RAPPEL_NOM_DEFINITIF,
  gesteValide,
  nomDeCaptureChrome,
  hoteDe,
  mimeDuFichier,
  refusDuDepot,
  origineDeLaPage,
  pagePilotable,
  phraseDuGesteLourd,
  ATTENTE_RECONNEXION_NAVIGATEUR_MS,
  avertissementSafari,
  choisirLOrdinateur,
  ordinateurEnLigne,
  refusDuNavigateur,
  resoudreLOrdinateur,
  type GesteChrome,
} from '@beluga/shared';
import fs from 'node:fs';
import path from 'node:path';
import * as store from './store.js';
import { chercherUnites } from './connaissances.js';
import { cheminDePieceJointe } from './pieces-jointes.js';
import type { ToolContext, ToolDef, ToolResult } from './tools.js';
import {
  ajouterAuFilm,
  chromeRetenu,
  demanderAuChrome,
  genreDuNavigateur,
  modeDuSite,
  ongletConfie,
  ouvrirLaSession,
  prendreLaMain,
  rangerUneImage,
  retenirLeChrome,
  sessionDeLAgent,
  type SessionChrome,
} from './extension-chrome.js';

export const OUTIL_CHROME: ToolDef = {
  name: 'chrome',
  description:
    "PILOTE LE CHROME DE LA PERSONNE QUI TE PARLE (extension Beluga reliée) : ouvrir des onglets, lire une page, " +
    'cliquer, écrire, faire défiler, capturer — avec les comptes où elle est DÉJÀ connectée. Tu travailles dans SA ' +
    'fenêtre, dans ton propre groupe d’onglets : elle te regarde faire en direct. PARCOURS : « ouvrir » (url) → « lire » (texte de la page ' +
    'et REPÈRES numérotés des éléments cliquables) → « cliquer » (repere) / « ecrire » (repere, texte) / « touche » ' +
    '(Enter, Tab, Escape…) → « capturer » pour montrer le résultat. Relis la page après chaque action. ' +
    'AUTONOMIE : tu agis SEUL, de bout en bout, sans demander la permission (aucun ask_user pour ces gestes) : ' +
    'cliquer, remplir, envoyer un formulaire, publier, supprimer un élément ordinaire. Un code ou un lien de ' +
    'validation est arrivé par courriel ? Ouvre toi-même la boîte mail de la personne dans un nouvel onglet, lis le ' +
    'message et récupère-le. Une case anti-robot ou un captcha en image ? « capturer », lis l’image et réponds-y ' +
    'toi-même. SEULES EXCEPTIONS, toujours confirmées par la personne : un geste d’ARGENT (payer, commander, ' +
    'virement, carte ou compte bancaire), la SUPPRESSION D’UN COMPTE, et un NOM PEUT-ÊTRE DÉFINITIF (nom de page, ' +
    'pseudo, nom d’utilisateur, adresse personnalisée) dont tu n’es PAS SÛR — pas dicté mot pour mot par la personne ' +
    'ni écrit dans la fiche du coffre, variante nécessaire, ou délai de changement annoncé : demande d’abord par ' +
    'ask_user (le nom, la contrainte du site, deux à quatre variantes libres vérifiées), puis passe « intention » ' +
    '(paiement, suppression, nom-definitif) ; la page est vérifiée aussi. Un nom dicté exactement ne se redemande pas. ' +
    'Un site mis en lecture seule dans les réglages refuse clic et saisie. ' +
    'BLOCAGES : quand le résultat dit « BLOCAGE RECONNU », suis SA conduite comme une personne (attendre puis UN seul ' +
    'nouvel essai plus lent, code lu dans la boîte mail, image lue sur capture, appli exigée → outil « iphone ») ; ' +
    'jamais de boucle, jamais de camouflage, jamais un compte recréé. Après un blocage, ajoute ce que tu as appris ' +
    'au carnet du site (outil « memoire », geste « proposer », type lesson, sujets « site:<domaine> »). ' +
    'DÉPOSER UN FICHIER (logo, photo de couverture, vidéo, PDF) : « deposer » avec « fichier » (chemin absolu sur le ' +
    'serveur) ou « piece » (identifiant ou « #alias » d’une pièce jointe), et « repere » du bouton qui ouvre la sélection (« Ajouter ' +
    'une photo », « Modifier la photo de couverture »), du champ de fichier ou de la zone de dépôt — ou x/y pour une ' +
    'zone sans repère. Jamais de fenêtre de l’ordinateur : le fichier est posé directement, 15 Mo au plus. Relis puis ' +
    '« capturer » pour vérifier l’aperçu avant d’enregistrer. ' +
    'CONNEXION : sur une page de connexion, « se_connecter » remplit seul la fiche du coffre-fort ' +
    'qui va avec le site (tu ne vois JAMAIS le mot de passe). BLOQUÉ (code SMS) : « demander_la_main » ' +
    'avec « raison » — SEULEMENT quand tu as vraiment tout essayé (code envoyé par SMS au téléphone, clé physique) ; la personne agit puis te rend la main ; relis alors la page. PLUSIEURS ORDINATEURS : tu agis sur celui ' +
    'retenu pour la carte (choisi par la personne) ; passe « ordinateur » (son nom) si elle en désigne un autre ; sinon on ' +
    'le lui demande. Un ordinateur qui ne répond pas : dis-le, ne bascule jamais sur un autre. Ouvrir une application du ' +
    'Mac : outil « ordinateur ». Aucun JavaScript libre. ' +
    'TA RÉPONSE se lit dans un panneau étroit : des phrases courtes, AUCUN JSON ni donnée brute sauf si la personne ' +
    'le demande. Quand c’est VRAIMENT utile, propose en suite (outil « proposer_suites ») « Refaire ce geste chaque ' +
    'semaine » / « chaque mois », « Comparer avec la dernière fois » ou « Relever cette page en tableau » — jamais d’office.',
  inputSchema: {
    type: 'object',
    required: ['geste'],
    properties: {
      geste: { type: 'string', enum: [...GESTES_CHROME] },
      url: { type: 'string', description: 'ouvrir / aller : l’adresse' },
      onglet: { type: 'number', description: 'L’onglet visé (rendu par ouvrir / lister_onglets) ; défaut : ton dernier onglet' },
      repere: { type: 'number', description: 'cliquer / ecrire : le numéro rendu par « lire »' },
      x: { type: 'number' },
      y: { type: 'number' },
      texte: { type: 'string', description: 'ecrire : le texte ; attendre : un texte à voir paraître' },
      effacer: { type: 'boolean', description: 'ecrire : vider le champ avant' },
      touche: { type: 'string', description: 'touche : Enter, Tab, Shift+Tab, Escape, ArrowDown, Backspace…' },
      direction: { type: 'string', enum: ['bas', 'haut'] },
      quantite: { type: 'number', description: 'defiler : en écrans (défaut 1)' },
      ms: { type: 'number', description: 'attendre : au plus tant de millisecondes (défaut 5000)' },
      pleinePage: { type: 'boolean', description: 'capturer : la page entière' },
      intention: { type: 'string', enum: ['paiement', 'suppression', 'nom-definitif'], description: 'Obligatoire si le geste paie (argent, banque), supprime un COMPTE, ou valide un nom peut-être définitif dont tu n’es pas sûr ; rien pour un envoi ou une publication' },
      fichier: { type: 'string', description: 'deposer : chemin ABSOLU du fichier sur le serveur' },
      piece: { type: 'string', description: 'deposer : identifiant ou « #alias » d’une pièce jointe (à la place de « fichier »)' },
      raison: { type: 'string', description: 'demander_la_main : pourquoi (« code reçu par SMS »)' },
      chrome: { type: 'string', description: 'Ancien nom de « ordinateur » : le nom de l’ordinateur (ou du Chrome) à utiliser' },
      ordinateur: { type: 'string', description: 'L’ordinateur où agir (son nom, ex. « Mac mini ») quand la personne l’a désigné ; sinon celui retenu pour la carte' },
    },
  },
};

function question(texte: string, description: string, options: { label: string; description?: string }[], libre = false): AgentQuestion {
  return AgentQuestion.parse({
    id: store.newId(),
    question: texte,
    description,
    kind: 'single',
    options: options.map((o, i) => ({ id: `o${i}`, label: o.label, ...(o.description ? { description: o.description } : {}) })),
    allowFreeText: libre,
  });
}

interface Contexte {
  ctx: ToolContext;
  compteId: string;
  session: SessionChrome;
}

/** L'outil lui-même. */
export async function outilChrome(ctx: ToolContext, args: Record<string, any>): Promise<ToolResult> {
  const geste = args.geste;
  if (!gesteValide(geste)) return { ok: false, text: `Geste inconnu. Gestes : ${GESTES_CHROME.join(', ')}.` };

  /* 1. QUI PARLE, ET SON CHROME */
  const { interlocuteurDeLAgent } = await import('./interlocuteur.js');
  const compte = await interlocuteurDeLAgent(ctx.agentId);
  if (!compte?.id) return { ok: false, text: "Je ne sais pas quelle personne te parle : aucun Chrome ne peut t'être confié. Demande-lui d'écrire dans ta conversation, puis recommence." };
  const lieu = await lOrdinateurDuGeste(ctx, compte.id, args, geste);
  if ('resultat' in lieu) return lieu.resultat;
  const agent = store.getAgent(ctx.agentId);
  if (!agent) return { ok: false, text: 'Agent introuvable.' };
  if (chromeRetenu(ctx.agentId, ctx.cardId) !== lieu.navigateurId) retenirLeChrome(ctx.agentId, ctx.cardId, lieu.navigateurId);
  const session = ouvrirLaSession(agent, lieu.navigateurId);
  const c: Contexte = { ctx, compteId: compte.id, session };

  /* 2. LA MAIN */
  if (geste === 'demander_la_main') {
    prendreLaMain(ctx.agentId, true);
    return attendreLaMain(c, String(args.raison ?? '').slice(0, 300) || 'Un geste que je ne peux pas faire moi-même.');
  }
  if (session.main) return attendreLaMain(c, 'Vous avez repris la main dans Chrome.');

  try {
    await preparer(c);
    return await faireLeGeste(c, geste, args, false);
  } catch (err: any) {
    return { ok: false, text: `Chrome : ${err?.message ?? err}` };
  }
}

/**
 * L'ORDINATEUR, PUIS SON NAVIGATEUR (carte « Choisir l'ordinateur visé depuis le téléphone », 15/11/2026). L'ordinateur
 * voulu (argument « chrome » ou « ordinateur » : son nom, son repère, l'identifiant d'un de ses navigateurs), sinon celui
 * retenu pour la carte (bouton de la barre d'écriture, « /ordinateur:… »), sinon le dernier choisi par le compte, sinon
 * le seul. Plusieurs sans choix : l'agent demande. Navigateur fermé mais programme du Mac en ligne : il le relance et
 * attend sa reconnexion (60 s au plus). Rien ne répond : le dire, sans basculer sur un autre ordinateur.
 * PÉRIMÈTRE : seulement les ordinateurs du compte de la personne qui parle (`ordinateursDuCompte(interlocuteur)`).
 */
async function lOrdinateurDuGeste(
  ctx: ToolContext,
  compteId: string,
  args: Record<string, any>,
  geste: string,
): Promise<{ navigateurId: string; ordinateurId: string } | { resultat: ToolResult }> {
  const { ordinateursDuCompte, ordinateurRetenu, dernierOrdinateur, retenirLOrdinateur } = await import('./ordinateurs.js');
  let ordinateurs = await ordinateursDuCompte(compteId);
  const vouluBrut = [args.ordinateur, args.chrome].find((v) => typeof v === 'string' && v.trim()) as string | undefined;
  if (vouluBrut && !resoudreLOrdinateur(ordinateurs, vouluBrut)) {
    return {
      resultat: {
        ok: false,
        text: `Aucun ordinateur « ${vouluBrut} » parmi ceux de la personne : ${ordinateurs.map((o) => `« ${o.nom} »`).join(', ') || 'aucun'}. Demande-lui lequel viser.`,
      },
    };
  }
  const deLaSession = sessionDeLAgent(ctx.agentId)?.appareilId;
  const retenu =
    ordinateurRetenu(ctx.agentId, ctx.cardId) ??
    (deLaSession ? (ordinateurs.find((o) => o.navigateurs.some((n) => n.id === deLaSession))?.id ?? null) : null);
  const entree = { voulu: vouluBrut ?? null, retenu, dernierUtilise: dernierOrdinateur(compteId) };
  let choix = choisirLOrdinateur(ordinateurs, entree);
  if (choix.genre === 'aucun') return { resultat: { ok: false, text: choix.texte } };
  if (choix.genre === 'choisir') {
    const proposes = choix.ordinateurs;
    const q = question(
      'Sur quel ordinateur dois-je travailler ?',
      'Plusieurs ordinateurs sont reliés à votre compte. Celui que vous choisissez sert pour toute cette carte ; vous pouvez le changer avec le bouton « Ordinateur » de la barre d’écriture.',
      proposes.map((o) => ({ label: o.nom, description: ordinateurEnLigne(o) ? 'Allumé en ce moment' : 'Éteint ou hors ligne' })),
    );
    return {
      resultat: {
        ok: true,
        text: 'Question posée : quel ordinateur utiliser.',
        question: q,
        suite: async (reponse) => {
          const elu = proposes.find((o) => reponse.trim().startsWith(o.nom));
          if (!elu) return 'Aucun ordinateur retenu : demande à la personne lequel utiliser.';
          retenirLOrdinateur(compteId, ctx.agentId, ctx.cardId, elu.id);
          return `Ordinateur « ${elu.nom} » retenu pour cette carte. Refais ton geste « ${geste} ».`;
        },
      },
    };
  }
  if (choix.genre === 'relancer') {
    /* Le navigateur est fermé, le Mac répond : son programme le relance, puis on attend l'extension. */
    const { demanderAuRelais } = await import('./relais-mac.js');
    const nom = choix.ordinateur.nom;
    try {
      await demanderAuRelais(choix.ordinateur.programme!.id, 'relancer_navigateur', { navigateur: choix.navigateur }, 30_000);
    } catch (err: any) {
      return { resultat: { ok: false, text: `Le navigateur de « ${nom} » est fermé et son programme du Mac n’a pas pu le relancer (${err?.message ?? err}). Dis-le à la personne.` } };
    }
    const fin = Date.now() + ATTENTE_RECONNEXION_NAVIGATEUR_MS;
    while (Date.now() < fin) {
      await new Promise((r) => setTimeout(r, 2000));
      ordinateurs = await ordinateursDuCompte(compteId);
      choix = choisirLOrdinateur(ordinateurs, { ...entree, voulu: choix.genre === 'relancer' ? choix.ordinateur.id : entree.voulu });
      if (choix.genre === 'pret') break;
    }
    if (choix.genre !== 'pret') {
      return { resultat: { ok: false, text: `J’ai relancé le navigateur de « ${nom} », mais l’extension Beluga ne s’est pas reconnectée en une minute. Dis-le à la personne : elle doit peut-être ouvrir le navigateur elle-même.` } };
    }
  }
  if (choix.genre === 'injoignable') return { resultat: { ok: false, text: choix.texte } };
  if (choix.genre !== 'pret') return { resultat: { ok: false, text: 'Aucun navigateur disponible.' } };
  /* Le choix tient pour la carte : l'ordinateur pris (même par défaut) devient celui de la carte. */
  if (ordinateurRetenu(ctx.agentId, ctx.cardId) !== choix.ordinateur.id) retenirLOrdinateur(compteId, ctx.agentId, ctx.cardId, choix.ordinateur.id);
  return { navigateurId: choix.navigateur.id, ordinateurId: choix.ordinateur.id };
}

/**
 * LES CARTES QUI TRAVAILLENT DANS UNE FENÊTRE PRIVÉE RÉDUITE, À PART (carte « Audits SEO et GEO dans le Marketing »,
 * 18/11/2026) : les passages du suivi GEO posent leurs questions aux IA sans jamais ouvrir un onglet dans la fenêtre de
 * travail de la personne, ni se servir de ses comptes. Repérées par leur ÉTIQUETTE, jamais par leur titre.
 */
const ETIQUETTES_EN_FENETRE_PRIVEE: readonly string[] = ['suivi-geo'];
/** La réponse de l'extension quand la case « Autoriser en navigation privée » n'est pas cochée. */
const REFUS_NAVIGATION_PRIVEE = 'navigation-privee-non-autorisee';

function enFenetrePrivee(cardId: string | null | undefined): boolean {
  if (!cardId) return false;
  const labels = (store.getCard(cardId) as { labels?: string[] } | null)?.labels ?? [];
  return labels.some((l) => ETIQUETTES_EN_FENETRE_PRIVEE.includes(l));
}

/**
 * Le groupe de l'agent se prépare dans la fenêtre de la personne ; l'onglet confié à la carte y entre, sur place, la
 * première fois. Une carte « en fenêtre privée » reçoit à la place SA fenêtre privée, réduite, qui ne passe jamais
 * devant ; sans l'autorisation de l'extension en navigation privée, rien ne s'ouvre ailleurs : le geste est refusé.
 */
async function preparer(c: Contexte): Promise<void> {
  const prive = enFenetrePrivee(c.ctx.cardId);
  const confie = prive ? null : ongletConfie(c.ctx.agentId, c.ctx.cardId);
  let reponse: { incognito?: boolean } | undefined;
  try {
    reponse = await demanderAuChrome<{ incognito?: boolean } | undefined>(c.session.appareilId, 'preparer', {
      agentId: c.ctx.agentId,
      titre: c.session.titre,
      couleur: c.session.couleur,
      ...(confie ? { ongletConfie: confie } : {}),
      ...(prive ? { fenetre: 'privee-reduite' } : {}),
    });
  } catch (err: any) {
    if (prive && String(err?.message ?? err).includes(REFUS_NAVIGATION_PRIVEE)) {
      throw new Error(
        "la navigation privée n'est pas autorisée pour l'extension Beluga : rien n'a été ouvert. La personne doit cocher « Autoriser en navigation privée » dans chrome://extensions › Beluga. Arrête la séance et dis-le dans ton compte rendu.",
      );
    }
    throw err;
  }
  /* Une extension qui DIT sa fenêtre (1.0.10 et suivantes) et la dit ordinaire : rien ne continue (19/11/2026). */
  if (prive && reponse && typeof reponse.incognito === 'boolean' && !reponse.incognito) {
    throw new Error("la fenêtre ouverte par l'extension n'est pas privée : rien n'a été fait. Arrête la séance et dis-le dans ton compte rendu.");
  }
}

function attendreLaMain(c: Contexte, raison: string): ToolResult {
  const q = question(
    'À vous la main dans Chrome',
    `${raison} Faites ce qu’il faut dans l’onglet, puis rendez-moi la main : je relirai la page avant de continuer.`,
    [{ label: REPONSE_RENDRE_LA_MAIN, description: 'Je reprends là où je m’étais arrêté.' }],
    true,
  );
  return {
    ok: true,
    text: 'La personne a la main dans Chrome : attends sa réponse.',
    question: q,
    suite: async (reponse) => {
      prendreLaMain(c.ctx.agentId, false);
      return `L'utilisateur a repris la main puis l'a rendue${reponse && !reponse.startsWith(REPONSE_RENDRE_LA_MAIN) ? ` (il précise : « ${reponse.slice(0, 300)} »)` : ''} : relis la page (geste « lire ») avant d'agir.`;
    },
  };
}

const onglet = (args: Record<string, any>) => (Number.isInteger(args.onglet) ? { onglet: args.onglet } : {});

/**
 * LES PORTES DU SITE ET DU GESTE LOURD, puis le geste. `confirme` : la personne vient de dire oui à CE geste
 * lourd — la confirmation ne vaut que pour lui.
 */
async function faireLeGeste(c: Contexte, geste: GesteChrome, args: Record<string, any>, confirme: boolean): Promise<ToolResult> {
  const { appareilId } = c.session;
  const base = { agentId: c.ctx.agentId, ...onglet(args) };

  /* Navigation et liste : aucune porte de site. */
  if (geste === 'lister_onglets') {
    const r = await demanderAuChrome<{ onglets: { id: number; titre: string; url: string; actif: boolean }[] }>(appareilId, 'onglets', base);
    if (!r.onglets.length) return { ok: true, text: 'Aucun onglet dans ton groupe. Ouvre-en un avec « ouvrir ».' };
    return { ok: true, text: r.onglets.map((o) => `- onglet ${o.id}${o.actif ? ' (courant)' : ''} : « ${o.titre} » — ${o.url}`).join('\n') };
  }
  if (geste === 'ouvrir' || geste === 'aller') {
    const url = String(args.url ?? '').trim();
    if (!/^https?:\/\//i.test(url)) return { ok: false, text: 'Donne une adresse complète, en https://…' };
    if (!pagePilotable(url)) return { ok: false, text: 'Chrome interdit le pilotage de ses propres pages et de sa boutique.' };
    const r = await demanderAuChrome<{ id: number; url: string; titre: string }>(appareilId, geste, { ...base, url }, 45_000);
    return { ok: true, text: `Onglet ${r.id} : « ${r.titre} » — ${r.url}. Lis-le avec « lire ».${avecLeSite(c.ctx, { url: r.url, titre: r.titre })}` };
  }
  if (geste === 'fermer') {
    await demanderAuChrome(appareilId, 'fermer', base);
    return { ok: true, text: 'Onglet fermé.' };
  }

  /* LE SITE DE L'ONGLET VISÉ */
  const info = await demanderAuChrome<{ id: number; url: string; titre: string }>(appareilId, 'info', base);
  if (!pagePilotable(info.url)) return { ok: false, text: 'Cette page est une page de Chrome : elle ne se pilote pas.' };
  const origine = origineDeLaPage(info.url);
  if (!origine) return { ok: false, text: 'Cet onglet est vide : ouvre d’abord une page.' };
  const mode = c.session.cetteFois.has(origine) ? 'autorise' : modeDuSite(c.compteId, origine);
  const decision = decisionDeSite(mode, geste);
  if (decision.genre === 'refus') return { ok: false, text: decision.texte };

  /* LE GESTE LOURD */
  if (!confirme && (geste === 'cliquer' || geste === 'touche' || (geste === 'ecrire' && /\n$/.test(String(args.texte ?? ''))))) {
    const sonde = await demanderAuChrome<{ libelle: string; soumission: boolean }>(appareilId, 'sonder', {
      ...base,
      ...(Number.isInteger(args.repere) ? { repere: args.repere } : {}),
      ...(Number.isFinite(args.x) && Number.isFinite(args.y) ? { x: args.x, y: args.y } : {}),
      ...(geste === 'touche' ? { touche: String(args.touche ?? '') } : {}),
      ...(geste === 'ecrire' ? { touche: 'Enter', repere: args.repere } : {}),
    });
    const lourd = gesteLourd({ intention: args.intention, libelle: sonde.libelle, soumission: sonde.soumission });
    if (lourd) return confirmerLeGesteLourd(c, geste, args, lourd, info, sonde.libelle);
  }

  /* LE GESTE — dans Safari, ce qu'il ne sait pas faire se refuse en le disant, et un geste simulé le signale. */
  const genre = genreDuNavigateur(appareilId);
  const refus = refusDuNavigateur(genre, geste, args);
  if (refus) return { ok: false, text: refus };
  const fait = await executer(c, geste, args, mode);
  const avis = genre === 'safari' && fait.ok ? avertissementSafari(geste, args) : null;
  return avis ? { ...fait, text: `${fait.text} ${avis}` } : fait;
}

async function executer(c: Contexte, geste: GesteChrome, args: Record<string, any>, mode: string | null): Promise<ToolResult> {
  const { appareilId } = c.session;
  const base = { agentId: c.ctx.agentId, ...onglet(args), garde: mode };
  switch (geste) {
    case 'lire': {
      const r = await demanderAuChrome<{ url: string; titre: string; texte: string; reperes: { n: number; role: string; nom: string }[] }>(appareilId, 'lire', base);
      const reperes = r.reperes.map((x) => `[${x.n}] ${x.role} « ${x.nom} »`).join('\n');
      return { ok: true, text: `« ${r.titre} » — ${r.url}${avecLeSite(c.ctx, r)}\n\nTEXTE :\n${r.texte}\n\nREPÈRES (pour cliquer / écrire) :\n${reperes || '(aucun)'}` };
    }
    case 'capturer': {
      const r = await demanderAuChrome<{ png: string; url: string; pointClic?: { x: number; y: number } }>(appareilId, 'capturer', { ...base, pleinePage: !!args.pleinePage }, 45_000);
      /* L'endroit cliqué voyage dans le NOM de la capture (`nomDeCaptureChrome`) : le panneau en tire le point violet
         de la vignette, l'image reste propre pour l'agent. */
      const id = await rangerUneImage(c.ctx.projectId, c.ctx.agentId, c.ctx.cardId, `data:image/png;base64,${r.png}`, nomDeCaptureChrome(Date.now(), r.pointClic));
      const piece = id ? store.getAttachment(id) : null;
      return piece ? { ok: true, text: `Capture jointe au fil (${hoteDe(r.url) ?? r.url}).`, attachment: piece } : { ok: false, text: 'Capture impossible à ranger.' };
    }
    case 'defiler':
    case 'attendre': {
      const r = await demanderAuChrome<{ texte: string }>(appareilId, geste, { ...base, direction: args.direction, quantite: args.quantite, texte: args.texte, ms: args.ms }, 40_000);
      return { ok: true, text: r.texte };
    }
    case 'cliquer':
    case 'ecrire':
    case 'touche': {
      const r = await demanderAuChrome<{ texte: string; image?: string }>(appareilId, geste, {
        ...base,
        repere: args.repere,
        x: args.x,
        y: args.y,
        texte: typeof args.texte === 'string' ? args.texte : undefined,
        effacer: !!args.effacer,
        touche: args.touche,
      });
      if (r.image) ajouterAuFilm(c.ctx.agentId, r.image);
      const rappel = geste === 'ecrire' && args.intention !== 'nom-definitif' ? await rappelDuNomDefinitif(appareilId, base, args) : '';
      return { ok: true, text: `${r.texte} Relis la page avant le geste suivant.${rappel}` };
    }
    case 'se_connecter':
      return proposerLaConnexion(c, args);
    case 'deposer': {
      const lu = lireLeFichierADeposer(args, c.ctx.projectId);
      if ('refus' in lu) return { ok: false, text: lu.refus };
      if (!Number.isInteger(args.repere) && !(Number.isFinite(args.x) && Number.isFinite(args.y))) {
        return { ok: false, text: 'Donne le « repere » du bouton, du champ ou de la zone de dépôt (rendu par « lire »), ou des coordonnées x/y.' };
      }
      const r = await demanderAuChrome<{ texte: string; image?: string }>(
        appareilId,
        'deposer',
        { ...base, repere: args.repere, x: args.x, y: args.y, nom: lu.nom, mime: lu.mime, base64: lu.base64 },
        90_000,
      ).catch((err) => {
        if (/Geste inconnu/i.test(String(err?.message ?? err))) {
          throw new Error('l’extension Beluga de ce Chrome est trop ancienne pour déposer un fichier : la personne doit installer la nouvelle version (Réglages → Extension), puis tu recommences');
        }
        throw err;
      });
      if (r.image) ajouterAuFilm(c.ctx.agentId, r.image);
      return { ok: true, text: `${r.texte} Relis la page puis « capturer » pour vérifier l’aperçu.` };
    }
    default:
      return { ok: false, text: 'Geste inconnu.' };
  }
}


/* ------------------------------------------------------------------ */
/* Blocages reconnus et carnet de pièges (13/11/2026)                   */
/* ------------------------------------------------------------------ */

/** Combien de fois un agent a buté sur un même blocage d'un même site — oublié au bout de deux heures. */
const rencontresDeBlocage = new Map<string, { n: number; at: number }>();
/** Les sites dont le carnet a déjà été servi à cet agent (une fois par visite de deux heures). */
const carnetsServis = new Map<string, number>();
const OUBLI_DES_BLOCAGES_MS = 2 * 60 * 60_000;

/**
 * CE QUE L'OUTIL AJOUTE APRÈS « ouvrir » OU « lire » : le blocage reconnu et sa conduite (`blocageDeLaPage`), le
 * passage de main au second (`ligneDuBlocage`), et à la première visite d'un site, son carnet de pièges — le carnet de
 * départ, puis les leçons de la base de connaissances du sujet `site:<hôte>`.
 */
function avecLeSite(ctx: ToolContext, page: { url?: string; titre?: string; texte?: string }): string {
  const lignes: string[] = [];
  const hote = hoteDe(page.url ?? '');
  const maintenant = Date.now();
  const blocage = blocageDeLaPage(page);
  if (blocage && hote) {
    const cle = `${ctx.agentId}|${hote}|${blocage.genre}`;
    const avant = rencontresDeBlocage.get(cle);
    const n = avant && maintenant - avant.at < OUBLI_DES_BLOCAGES_MS ? avant.n + 1 : 1;
    rencontresDeBlocage.set(cle, { n, at: maintenant });
    lignes.push(ligneDuBlocage(blocage, n));
  }
  if (hote) {
    const cle = `${ctx.agentId}|${hote}`;
    const servi = carnetsServis.get(cle);
    if (!servi || maintenant - servi > OUBLI_DES_BLOCAGES_MS) {
      carnetsServis.set(cle, maintenant);
      const pieges = [...carnetDeDepart(hote)];
      try {
        for (const { unite } of chercherUnites(hote, { projectId: ctx.projectId, sujet: sujetDuCarnet(hote), limite: 4 })) {
          pieges.push(`${unite.titre}${unite.resume ? ` — ${unite.resume}` : ''}`);
        }
      } catch {
        /* La base de connaissances indisponible ne prive pas l'agent du carnet de départ. */
      }
      if (pieges.length) lignes.push(`CARNET DE PIÈGES DE ${hote} :\n${pieges.map((p) => `- ${p}`).join('\n')}`);
    }
  }
  return lignes.length ? `\n\n${lignes.join('\n\n')}` : '';
}

/** Après une saisie dans un champ de nom, de pseudo ou d'adresse personnalisée : la règle du nom définitif, rappelée. */
async function rappelDuNomDefinitif(appareilId: string, base: Record<string, unknown>, args: Record<string, any>): Promise<string> {
  if (!Number.isInteger(args.repere)) return '';
  try {
    const sonde = await demanderAuChrome<{ libelle: string }>(appareilId, 'sonder', { ...base, repere: args.repere });
    return champDeNomDefinitif(sonde.libelle) ? `\n\n${RAPPEL_NOM_DEFINITIF}` : '';
  } catch {
    return '';
  }
}

async function confirmerLeGesteLourd(
  c: Contexte,
  geste: GesteChrome,
  args: Record<string, any>,
  intention: NonNullable<ReturnType<typeof gesteLourd>>,
  info: { url: string },
  libelle: string,
): Promise<ToolResult> {
  const site = hoteDe(info.url) ?? info.url;
  const phrase = phraseDuGesteLourd(intention, site, libelle);
  /* La page telle qu'elle partira, jointe à la question. */
  let capture: string | null = null;
  try {
    const r = await demanderAuChrome<{ png: string }>(c.session.appareilId, 'capturer', { agentId: c.ctx.agentId, ...onglet(args) });
    capture = await rangerUneImage(c.ctx.projectId, c.ctx.agentId, c.ctx.cardId, `data:image/png;base64,${r.png}`, `avant-${intention}-${Date.now()}.png`);
  } catch {
    /* sans image, la question se pose quand même */
  }
  /* L'ENCART DE VALIDATION COMMUN (26/11/2026) : la page capturée en grand dans la bulle, « Valider » / « Refuser »
     — qui répondent par ces deux libellés. La capture vit dans l'encart : elle n'est plus jointe une seconde fois au
     message. Et une validation n'est jamais tranchée par Auto (`CHAMPS_HORS_AUTO`). */
  const q = AgentQuestion.parse({
    ...question(phrase.question, '', [
      { label: REPONSE_FAIRE_LE_GESTE, description: 'Le geste part maintenant.' },
      { label: REPONSE_NE_PAS_FAIRE_LE_GESTE, description: 'Rien ne part.' },
    ]),
    description: undefined,
    validation: { geste: phrase.description, captures: capture ? [capture] : [] },
  });
  return {
    ok: true,
    text: `Confirmation demandée (${intention}) : attends la réponse.`,
    question: q,
    suite: async (reponse) => {
      if (!reponse.trim().startsWith(REPONSE_FAIRE_LE_GESTE)) return `La personne ne veut pas : ${intention} NON fait. Ne réessaie pas sans qu'elle le demande.`;
      try {
        const mode = c.session.cetteFois.has(new URL(info.url).origin) ? 'autorise' : modeDuSite(c.compteId, new URL(info.url).origin);
        const r = await executer(c, geste, args, mode);
        return `Confirmé par la personne. ${r.text}`;
      } catch (err: any) {
        return `Confirmé, mais le geste a échoué : ${err?.message ?? err}`;
      }
    },
  };
}

/**
 * LE FICHIER À DÉPOSER : un chemin absolu du serveur (`fichier`) ou une pièce jointe (`piece`). Un fichier ORDINAIRE
 * seulement (ni dossier, ni périphérique), 15 Mo au plus ; son contenu part en base64 vers le Chrome.
 */
function lireLeFichierADeposer(args: Record<string, any>, projectId: string): { nom: string; mime: string; base64: string } | { refus: string } {
  let chemin = '';
  let nom = '';
  if (typeof args.piece === 'string' && args.piece.trim()) {
    const piece = store.pieceJointeDesignee(args.piece, projectId);
    if (!piece) return { refus: `Pièce jointe « ${args.piece} » introuvable.` };
    chemin = cheminDePieceJointe(piece);
    nom = piece.name;
  } else if (typeof args.fichier === 'string' && args.fichier.trim()) {
    chemin = args.fichier.trim();
    if (!path.isAbsolute(chemin)) return { refus: `Donne un chemin ABSOLU (« /… ») : « ${chemin} ».` };
    nom = path.basename(chemin);
  } else {
    return { refus: 'Donne le « fichier » (chemin absolu sur le serveur) ou la « piece » (pièce jointe) à déposer.' };
  }
  let stat: fs.Stats;
  try {
    stat = fs.statSync(chemin);
  } catch {
    return { refus: `Fichier introuvable : ${chemin}.` };
  }
  if (!stat.isFile()) return { refus: `« ${chemin} » n’est pas un fichier ordinaire.` };
  const refus = refusDuDepot(stat.size, nom);
  if (refus) return { refus };
  return { nom, mime: mimeDuFichier(nom), base64: fs.readFileSync(chemin).toString('base64') };
}

/**
 * LA CONNEXION PAR LE COFFRE-FORT. Les fiches dont l'adresse va avec la page, lisibles par la personne. Sans
 * question (agent autonome), le DÉMON lit l'identifiant et le mot de passe et les remet au Chrome, qui les saisit : aucune valeur ne
 * revient jamais à l'agent.
 */
async function proposerLaConnexion(c: Contexte, args: Record<string, any>): Promise<ToolResult> {
  const info = await demanderAuChrome<{ url: string }>(c.session.appareilId, 'info', { agentId: c.ctx.agentId, ...onglet(args) });
  const { listerAcces } = await import('./coffre-fort.js');
  const { compteParId } = await import('./comptes.js');
  const compte = compteParId(c.compteId);
  const lisibles = listerAcces().filter((f) => compte?.role === 'admin' || (f.projectId && compte?.projets.includes(f.projectId)));
  const fiches = fichesPourLaPage(lisibles, info.url);
  const fiche = fiches[0];
  if (!fiche) return { ok: false, text: `Aucune fiche du coffre-fort ne va avec ${hoteDe(info.url)}. Connecte-toi autrement (compte déjà ouvert, lien reçu par courriel) ; « demander_la_main » en dernier recours.` };
  /* Agent AUTONOME : la connexion se fait sans question ; la valeur du mot de passe ne passe toujours que du démon
     au Chrome, jamais par l'agent. */
  try {
    const fait = await demanderAuChrome<{ texte: string; image?: string }>(c.session.appareilId, 'se_connecter', {
      agentId: c.ctx.agentId,
      ...onglet(args),
      identifiant: fiche.champs.identifiant ?? '',
      motDePasse: fiche.champs.motDePasse,
    });
    if (fait.image) ajouterAuFilm(c.ctx.agentId, fait.image);
    return { ok: true, text: `Connexion faite avec la fiche « ${fiche.nom} » (${fait.texte}). Relis la page.` };
  } catch (err: any) {
    return { ok: false, text: `Connexion impossible : ${err?.message ?? err}. Remplis les champs à la main ou, en dernier recours, « demander_la_main ».` };
  }
}
