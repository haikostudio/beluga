import fs from 'node:fs';
import path from 'node:path';
import {
  CHOIX_DE_DEPART,
  DIMENSIONS_DES_FORMATS,
  STYLES_DE_REALISATION,
  VOIX_D_ESSAI,
  VOIX_ESSAI_PAR_DEFAUT,
  realisationDeLaCarte,
  styleDeLaReponse,
  type Card,
  type FormatDeMedia,
} from '@beluga/shared';
import * as store from './store.js';
import { bus } from './bus.js';
import { CONFIG } from './config.js';
import { joindreUnFichier } from './joindre-fichier.js';
import { texteDuCatalogue } from './catalogue-de-styles.js';
import { apercusDeLaComposition, compositionDisponible, controlerComposition, preparerComposition } from './composition.js';
import { fabriquerVoixDEssai, voixDEssaiDisponibles } from './voix-de-realisation.js';
import { log } from './logger.js';

/**
 * LES GESTES DU DIRECTEUR ARTISTIQUE PENDANT LA DISCUSSION (outil
 * « production », décision de l'utilisateur du 26/10/2026) — tous gratuits :
 *  - « type » : photo, vidéo ou son, quand la barre d'écriture ne l'a pas dit ;
 *  - « styles » / « style » : les dix styles illustrés, puis le style retenu,
 *    écrit sur la carte (`realisation.style`) ;
 *  - « catalogue » : le catalogue de styles gelé du Studio, pour s'inspirer ;
 *  - « exemples » : les deux vidéos validées du Studio, figées en exemples ;
 *  - « esquisse » : une page écrite par l'agent, contrôlée et photographiée par
 *    le serveur — les IMAGES CLÉS d'un style codé, sans dépense ;
 *  - « voix_essai » : la voix gratuite (Piper) jointe à l'arrêt 2.
 */

export interface ContexteDuDirecteur {
  agentId: string;
  projectId: string;
  cardId?: string;
}

type Resultat = { ok: boolean; text: string };

const FORMATS: readonly FormatDeMedia[] = ['9:16', '1:1', '4:5', '16:9'];

function formatLu(brut: unknown, defaut: FormatDeMedia = '9:16'): FormatDeMedia {
  return FORMATS.find((f) => f === brut) ?? defaut;
}

function ecrireLaRealisation(card: Card, champs: Record<string, unknown>): Card {
  const fraiche = store.getCard(card.id) ?? card;
  const ecrite = store.saveCard({ ...fraiche, realisation: { ...realisationDeLaCarte(fraiche), ...champs } });
  bus.emit({ type: 'card.upsert', card: ecrite });
  return ecrite;
}

/** Le dossier de travail du directeur pendant la discussion : sous les médias de la carte (disque de stockage). */
async function dossierDuDirecteur(card: Card): Promise<string> {
  const { dossierDesMediasDeLaCarte } = await import('./realisation.js');
  return dossierDesMediasDeLaCarte(card, null);
}

export function actionType(card: Card, args: Record<string, unknown>): Resultat {
  const brut = String(args.media ?? args.type ?? '').trim().toLowerCase();
  const media = brut === 'photo' ? 'image' : (CHOIX_DE_DEPART as readonly string[]).find((c) => c === brut);
  if (!media) return { ok: false, text: 'Il faut « media » : video, image (photo) ou son — la réponse de l’utilisateur.' };
  ecrireLaRealisation(card, { medias: [media] });
  return { ok: true, text: `Type écrit : ${media === 'image' ? 'photo' : media}. Passe au style (« styles »)${media === 'son' ? ', sauf pour un son seul : va directement au brief' : ''}.` };
}

/** LES DIX IMAGES DES STYLES, jointes une fois par projet (la même image n'est jamais jointe deux fois : empreinte). */
export async function imagesDesStyles(ctx: ContexteDuDirecteur): Promise<Record<string, string>> {
  const dossier = path.join(CONFIG.selfPath, 'outils', 'styles-de-realisation');
  const ids: Record<string, string> = {};
  for (const s of STYLES_DE_REALISATION) {
    const fichier = path.join(dossier, s.image);
    if (!fs.existsSync(fichier)) continue;
    try {
      const j = await joindreUnFichier({ projectId: ctx.projectId, agentId: ctx.agentId, ...(ctx.cardId ? { cardId: ctx.cardId } : {}), fichier, nom: `style-${s.image}`, deLAgent: true });
      if (j.ok) ids[s.id] = j.attachment.id;
    } catch (err: any) {
      log.warn(`image du style « ${s.id} » non jointe`, err?.message);
    }
  }
  return ids;
}

export async function actionStyles(card: Card, ctx: ContexteDuDirecteur): Promise<Resultat> {
  const images = await imagesDesStyles(ctx);
  const actuel = realisationDeLaCarte(card).style;
  return {
    ok: true,
    text: [
      `Les ${STYLES_DE_REALISATION.length} styles${actuel ? ` (retenu aujourd’hui : « ${actuel} »)` : ''} — pose-les avec « ask_user », une option par style : « label » = le libellé, « description » = la phrase, « image » = l’identifiant ; ta recommandation en tête, marquée « (recommandé) ». Puis écris la réponse avec l’action « style ».`,
      ...STYLES_DE_REALISATION.map(
        (s) => `- « ${s.id} » ${s.libelle} — ${s.description} [fabrication : ${s.fabrication === 'serveur' ? 'serveur, sans frais' : s.fabrication === 'mixte' ? 'service payant puis habillage serveur' : 'service payant'}]${images[s.id] ? ` · image : ${images[s.id]}` : ' · (image absente)'}`,
      ),
      compositionDisponible() ? '' : 'ATTENTION : le moteur de fabrication sur le serveur n’est pas installé ici — les styles « serveur » ne peuvent pas être fabriqués pour l’instant : dis-le avant de les proposer.',
    ]
      .filter(Boolean)
      .join('\n'),
  };
}

export function actionStyle(card: Card, args: Record<string, unknown>): Resultat {
  const style = styleDeLaReponse(args.style ?? args.id ?? args.reponse);
  if (!style) return { ok: false, text: `Style inconnu. Styles : ${STYLES_DE_REALISATION.map((s) => `« ${s.id} » (${s.libelle})`).join(', ')}.` };
  ecrireLaRealisation(card, { style: style.id });
  return {
    ok: true,
    text: `Style retenu : « ${style.libelle} ». ${
      style.fabrication === 'generation'
        ? 'Images et plans viennent d’un service payant : aperçus sur l’enveloppe, puis devis à l’arrêt 2.'
        : `Les plans ${style.fabrication === 'mixte' ? 'générés sont ensuite habillés' : 'sont écrits par toi et fabriqués'} sur le serveur, sans frais : « Capacité : composition », images clés par « esquisse ».`
    } Lis d’abord ces modes d’emploi (outil « memoire », geste « chercher ») : ${style.competences.join(', ') || 'aucun en particulier'}. Passe au brief.`,
  };
}

export function actionCatalogue(args: Record<string, unknown>): Resultat {
  return { ok: true, text: texteDuCatalogue(args) };
}

/**
 * LES EXEMPLES : les deux vidéos gardées comme modèles par l'ancien Studio,
 * figées dans `outils/exemples-de-realisation/<id>/` (page HyperFrames,
 * composition d'origine, médias décrits, affiche). Sans « id » : la liste ;
 * avec « id » : les chemins à lire. On s'inspire de leur structure, jamais de
 * leurs textes ni de leurs visuels (projets clients).
 */
export function actionExemples(args: Record<string, unknown>): Resultat {
  const racine = path.join(CONFIG.selfPath, 'outils', 'exemples-de-realisation');
  const ids = fs.existsSync(racine) ? fs.readdirSync(racine).filter((d) => fs.existsSync(path.join(racine, d, 'index.html'))).sort() : [];
  if (!ids.length) return { ok: false, text: 'Aucun exemple de réalisation sur ce serveur.' };
  const fiche = (id: string) => {
    try {
      return JSON.parse(fs.readFileSync(path.join(racine, id, 'medias.json'), 'utf8')) as { titre?: string; projet?: string; duree?: number; formats?: string[]; medias?: { genre: string }[] };
    } catch {
      return {};
    }
  };
  const voulu = String(args.id ?? '').trim();
  if (voulu) {
    if (!ids.includes(voulu)) return { ok: false, text: `Exemple inconnu. Exemples : ${ids.join(', ')}.` };
    const d = path.join(racine, voulu);
    return {
      ok: true,
      text: [
        `Exemple « ${fiche(voulu).titre ?? voulu} » — lis ces fichiers avec ton outil de lecture :`,
        `- ${path.join(d, 'index.html')} : la page HyperFrames entière (chronologie GSAP en pause, clips, sous-titres, transitions) ;`,
        `- ${path.join(d, 'composition.json')} : la composition d'origine (pistes, segments, dessins écrits par l'agent) ;`,
        `- ${path.join(d, 'medias.json')} : ce qu'était chaque média (ils ne sont pas recopiés : medias/<id> reste vide) ;`,
        `- ${path.join(d, 'affiche.jpg')} : l'affiche.`,
        'Inspire-toi de la STRUCTURE (rythme, scènes, sous-titres au mot, transitions) ; ne reprends jamais les textes ni les visuels de ce client.',
      ].join('\n'),
    };
  }
  return {
    ok: true,
    text: [
      'Les vidéos validées de l’ancien Studio, gardées comme exemples (« exemples » avec « id » pour les fichiers) :',
      ...ids.map((id) => {
        const f = fiche(id);
        const genres = (f.medias ?? []).reduce<Record<string, number>>((acc, m) => ({ ...acc, [m.genre]: (acc[m.genre] ?? 0) + 1 }), {});
        return `- « ${id} » ${f.titre ?? ''} (${f.projet ?? 'projet'}, ${f.duree ? `${f.duree.toFixed(1)} s` : 'durée inconnue'}, ${(f.formats ?? []).join(' / ')}) — médias : ${Object.entries(genres).map(([g, n]) => `${n} ${g}`).join(', ') || 'aucun'}`;
      }),
    ].join('\n'),
  };
}

/**
 * UNE ESQUISSE : la page écrite par l'agent (« html ») devient une composition
 * de la carte, contrôlée, puis photographiée aux instants voulus ; chaque image
 * est jointe au fil et son identifiant rendu, prêt pour « soumettre » images-cles.
 */
export async function actionEsquisse(card: Card, ctx: ContexteDuDirecteur, args: Record<string, unknown>): Promise<Resultat> {
  if (!compositionDisponible()) return { ok: false, text: 'Le moteur de fabrication sur le serveur n’est pas installé ici : fais les images clés par « apercu_de_realisation » (enveloppe d’aperçus).' };
  const plan = String(args.plan ?? args.titre ?? '').trim().slice(0, 80) || 'esquisse';
  const html = String(args.html ?? '').trim();
  if (!html) return { ok: false, text: 'Il faut « html » : la page entière de la composition (racine data-composition-id avec data-duration, chronologie GSAP en pause sur window.__timelines). Sans « html », une page de départ est écrite : relance « esquisse » avec ta page.' };
  const format = formatLu(args.format);
  const prep = preparerComposition({ dossierDesMedias: path.join(await dossierDuDirecteur(card), 'esquisses'), plan, format, duree: Number(args.duree) || 6, bibliotheques: args.bibliotheques });
  fs.writeFileSync(path.join(prep.dossier, 'index.html'), html);
  const controle = await controlerComposition(prep.dossier);
  if (controle.erreurs.length) return { ok: false, text: [`La page ne se rend pas encore (${prep.dossier}/index.html) :`, ...controle.erreurs.map((x) => `- ${x}`), 'Corrige et relance « esquisse ».'].join('\n') };
  const instants = (Array.isArray(args.instants) ? args.instants : String(args.instants ?? '').split(',')).map(Number).filter((t) => Number.isFinite(t));
  const apercus = await apercusDeLaComposition(prep.dossier, instants, format);
  if (!apercus.ok) return { ok: false, text: `Aucune image tirée : ${apercus.raison}` };
  const ids: string[] = [];
  for (const [i, image] of apercus.images.entries()) {
    const j = await joindreUnFichier({ projectId: card.projectId, agentId: ctx.agentId, cardId: card.id, fichier: image, nom: `${prep.id}-${i + 1}.png`, deLAgent: true });
    if (j.ok) ids.push(j.attachment.id);
  }
  const { largeur, hauteur } = DIMENSIONS_DES_FORMATS[format];
  return {
    ok: true,
    text: [
      `Esquisse « ${plan} » (${largeur}×${hauteur}) : ${ids.length} image(s) jointe(s) au fil — ${ids.join(', ')}. Regarde-les (fichiers : ${apercus.images.join(', ')}) avant de les soumettre ; passe leurs identifiants dans « images » de « soumettre » images-cles. Sans frais.`,
      ...(controle.avertissements.length ? [`Avertissements : ${controle.avertissements.slice(0, 5).join(' ; ')}`] : []),
      `La page est gardée dans ${prep.dossier} : la fabrication la reprendra.`,
    ].join('\n'),
  };
}

/** LA VOIX D'ESSAI GRATUITE, jointe au fil : son identifiant part dans « voix » de « soumettre » images-cles. */
export async function actionVoixEssai(card: Card, ctx: ContexteDuDirecteur, args: Record<string, unknown>): Promise<Resultat & { attachmentId?: string }> {
  const texte = String(args.texte ?? '').trim();
  if (!texte) return { ok: false, text: 'Il faut « texte » : le texte EXACT de la voix off.' };
  const demandee = String(args.voix ?? '').trim();
  const voix = Object.entries(VOIX_D_ESSAI).find(([id, prenom]) => id === demandee || prenom.toLowerCase() === demandee.toLowerCase())?.[0] ?? VOIX_ESSAI_PAR_DEFAUT;
  const sortie = path.join(await dossierDuDirecteur(card), 'voix', `voix-essai-${Date.now()}.wav`);
  const r = await fabriquerVoixDEssai(texte, sortie, voix);
  if (!r.ok) return { ok: false, text: `Voix d’essai impossible : ${r.raison}. Voix posées : ${voixDEssaiDisponibles().map((v) => v.label).join(', ') || 'aucune'}.` };
  const j = await joindreUnFichier({ projectId: card.projectId, agentId: ctx.agentId, cardId: card.id, fichier: sortie, nom: `voix-d-essai-${VOIX_D_ESSAI[voix]?.toLowerCase() ?? 'claire'}.wav`, deLAgent: true });
  if (!j.ok) return { ok: false, text: `Voix fabriquée (${sortie}) mais non jointe : ${j.refus}` };
  return {
    ok: true,
    attachmentId: j.attachment.id,
    text: `Voix d’essai « ${VOIX_D_ESSAI[voix]} » fabriquée (${r.duree.toFixed(1)} s, sans frais) : pièce jointe ${j.attachment.id}, fichier ${sortie}. Passe cet identifiant dans « voix » de « soumettre » images-cles ; recale la durée des scènes sur elle.`,
  };
}
