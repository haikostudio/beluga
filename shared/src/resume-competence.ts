/**
 * LE RÉSUMÉ EN FRANÇAIS D'UNE FICHE DE BIBLIOTHÈQUE — les règles, sans base ni
 * disque ni réseau.
 *
 * LE CONSTAT (13/11/2026, carte dd481232) : sur ~1 100 fiches importées, six
 * seulement avaient déjà été servies. Leur description vient de la source —
 * souvent anglaise, parfois vague (« Génère et opère Cerveau UX… ») — et la
 * recherche par le sens, sur une demande en français dite autrement, les
 * classait loin derrière les fiches maison.
 *
 * LA DÉCISION (utilisateur, cadrage de la carte) : un PETIT MODÈLE PAYANT rédige,
 * EN UN LOT et par la clé OpenRouter de Beluga Build, un résumé « À utiliser
 * quand… » et quelques symptômes en français pour chaque fiche de bibliothèque ;
 * les nouveaux imports reçoivent les leurs de la même façon. Le résumé va dans
 * un champ À PART (`resume-fr`), gardé au réimport ; la description d'origine
 * n'est JAMAIS réécrite. Les symptômes ne s'écrivent que sur une fiche qui n'en
 * a pas : un classement posé à la main n'est pas remplacé.
 *
 * L'appel et l'écriture vivent dans `server/src/resume-competences.ts`.
 */

import { ficheEnService, type Competence } from './competences.js';
import { BIBLIOTHEQUES_AU_CHOIX_DE_L_AGENT } from './proposition-competence.js';

/**
 * LE PETIT MODÈLE : google/gemini-3.1-flash-lite (0,25 $ / 1,5 $ le million de
 * jetons, sortie structurée stricte, bon français). Le coût réel de chaque
 * appel est relevé (`usage.cost`) et sommé par lot.
 */
export const MODELE_RESUME_COMPETENCE = 'google/gemini-3.1-flash-lite';
/** Ce que le modèle lit du mode d'emploi, au plus : le début dit de quoi il s'agit. */
export const CORPS_LU_POUR_LE_RESUME_MAX = 1_500;
/** Le résumé rendu, en signes : une à trois phrases. */
export const RESUME_FR_MIN = 40;
export const RESUME_FR_MAX = 420;
/** Les symptômes rendus : assez pour attraper une demande, pas au point de diluer le vecteur. */
export const SYMPTOMES_RESUME_MIN = 3;
export const SYMPTOMES_RESUME_MAX = 8;
const SYMPTOME_MAX = 90;

/** Le schéma de la sortie structurée. */
export const SCHEMA_RESUME_COMPETENCE = {
  type: 'object',
  properties: {
    resume: { type: 'string', description: 'Une à trois phrases en français, commençant par « À utiliser quand ».' },
    symptomes: {
      type: 'array',
      items: { type: 'string' },
      description: 'Quatre à huit demandes courtes en français, telles qu’une personne les écrirait.',
    },
  },
  required: ['resume', 'symptomes'],
  additionalProperties: false,
} as const;

/**
 * CETTE FICHE ATTEND-ELLE SON RÉSUMÉ ? Une fiche de BIBLIOTHÈQUE, en service,
 * sans résumé, dont le contenu est lisible ici. Écartées : les fiches maison
 * (écrites en français par nos agents), les fiches FOURNIES ou PROTÉGÉES d'un
 * serveur loué (en lecture seule), et les bibliothèques laissées au jugement de
 * l'agent (pstack) — leur description anglaise ressort justement d'une
 * recherche en mots anglais (DEC-497).
 */
export function ficheAResumer(
  fiche: Pick<Competence, 'etat' | 'bibliotheque' | 'fournie' | 'protegee'> & { resumeFr?: string },
): boolean {
  if (!fiche.bibliotheque || fiche.fournie || fiche.protegee) return false;
  if (!ficheEnService(fiche.etat)) return false;
  if (fiche.resumeFr?.trim()) return false;
  return !BIBLIOTHEQUES_AU_CHOIX_DE_L_AGENT.includes(fiche.bibliotheque);
}

const CONSIGNE_SYSTEME = [
  'Tu rédiges, en français courant, la ligne qui dit QUAND se servir d’un mode d’emploi destiné à des agents de développement (une « compétence »).',
  'Réponds UNIQUEMENT par un objet JSON { "resume": string, "symptomes": string[] }.',
  '- « resume » : une à trois phrases, 300 signes au plus, qui commencent par « À utiliser quand ». Dis le besoin concret de la personne (ce qu’elle veut obtenir ou ce qui ne va pas), puis en quelques mots ce que la compétence fait. Pas de nom de produit inventé, pas de jargon inutile, pas de guillemets.',
  '- « symptomes » : quatre à huit demandes COURTES (2 à 8 mots), en français, telles qu’un client ou un chef de projet les écrirait (« faire un devis », « mon site ne remonte pas sur Google »). Pas de virgule ni de point-virgule dans une demande.',
  'Reste fidèle au texte : n’attribue pas à la compétence ce qu’elle ne fait pas.',
].join('\n');

/** Les messages envoyés au modèle pour une fiche. */
export function messagesDuResume(
  fiche: Pick<Competence, 'nom' | 'description' | 'themes'>,
  corps: string,
): { role: 'system' | 'user'; content: string }[] {
  const extrait = corps.replace(/\n{3,}/g, '\n\n').trim().slice(0, CORPS_LU_POUR_LE_RESUME_MAX);
  const lignes = [
    `Nom : ${fiche.nom}`,
    `Description d’origine : ${fiche.description.replace(/\s+/g, ' ').trim()}`,
    fiche.themes.length ? `Thèmes : ${fiche.themes.join(', ')}` : '',
    '',
    'Début du mode d’emploi :',
    extrait || '(vide)',
  ].filter((l, i) => l || i > 2);
  return [
    { role: 'system', content: CONSIGNE_SYSTEME },
    { role: 'user', content: lignes.join('\n') },
  ];
}

export type ResumeValide = { ok: true; resume: string; symptomes: string[] } | { ok: false; raison: string };

/**
 * LA SORTIE DU MODÈLE, VÉRIFIÉE. `strict` ne protège pas d'une réponse vide,
 * coupée ou en anglais : un résumé hors bornes, sans « À utiliser », ou sans
 * assez de symptômes est REFUSÉ (la fiche reste sans résumé, un prochain passage
 * la reprendra). Les symptômes sont nettoyés : ni virgule ni point-virgule (ils
 * s'écrivent en une ligne séparée par des virgules), dédoublonnés, bornés.
 */
export function validerLeResume(brut: unknown): ResumeValide {
  let objet: unknown = brut;
  if (typeof brut === 'string') {
    const texte = brut.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
    try {
      objet = JSON.parse(texte);
    } catch {
      return { ok: false, raison: 'réponse qui n’est pas du JSON' };
    }
  }
  if (!objet || typeof objet !== 'object') return { ok: false, raison: 'réponse vide' };
  const { resume, symptomes } = objet as { resume?: unknown; symptomes?: unknown };
  if (typeof resume !== 'string') return { ok: false, raison: 'résumé absent' };
  const propre = resume.replace(/\s+/g, ' ').replace(/^["«\s]+|["»\s]+$/g, '').trim();
  if (propre.length < RESUME_FR_MIN) return { ok: false, raison: 'résumé trop court' };
  if (propre.length > RESUME_FR_MAX) return { ok: false, raison: 'résumé trop long' };
  if (!/^à utiliser\b/i.test(propre)) return { ok: false, raison: 'résumé qui ne commence pas par « À utiliser »' };
  if (!Array.isArray(symptomes)) return { ok: false, raison: 'symptômes absents' };
  const vus = new Set<string>();
  const nets: string[] = [];
  for (const s of symptomes) {
    if (typeof s !== 'string') continue;
    const net = s.replace(/[,;]/g, ' ').replace(/\s+/g, ' ').replace(/^["«\s]+|["».\s]+$/g, '').trim();
    if (net.length < 3 || net.length > SYMPTOME_MAX) continue;
    const cle = net.toLowerCase();
    if (vus.has(cle)) continue;
    vus.add(cle);
    nets.push(net.charAt(0).toLowerCase() + net.slice(1));
  }
  if (nets.length < SYMPTOMES_RESUME_MIN) return { ok: false, raison: 'trop peu de symptômes' };
  return { ok: true, resume: propre.charAt(0).toUpperCase() + propre.slice(1), symptomes: nets.slice(0, SYMPTOMES_RESUME_MAX) };
}
