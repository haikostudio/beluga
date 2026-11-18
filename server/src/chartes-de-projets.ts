/**
 * LA CHARTE D'UN PROJET SE RÉDIGE SUR DEMANDE, PUIS L'UTILISATEUR LA VALIDE.
 *
 * Une carte par projet, posée DANS ce projet (`LABEL_CHARTE`) : son agent lit
 * le dépôt, regarde les écrans réels et écrit `docs/chartes/*.md` en état
 * « proposée » plus des modèles de pages, sur SA branche. Rien n'est jamais
 * écrit dans le dépôt d'un autre projet depuis Beluga (DEC-341).
 *
 * UN SEUL déclencheur : le bouton « Faire rédiger la charte » de la
 * configuration d'un projet (carte posée ET lancée). Le passage de nuit qui
 * posait une carte dans chaque projet sans charte a été RETIRÉ (décision du
 * 06/11/2026) : 25 cartes « Charte d'interface du projet » apparaissaient d'un
 * coup dans la zone « En cours », prises pour des agents qui tournaient.
 */
import {
  COLONNES_DU_TRAVAIL_FAIT,
  LABEL_CHARTE,
  TITRE_CARTE_DE_CHARTE,
  consigneDeRedactionDeCharte,
  descriptionDeLaCarteDeCharte,
  type Card,
  type Project,
} from '@beluga/shared';
import { bus } from './bus.js';
import { setMeta } from './db.js';
import * as store from './store.js';

type CreerCarte = (projectId: string, input: Parameters<typeof import('./tools.js').createCard>[1]) => Card;

const COLONNES_RANGEES = new Set<string>([...COLONNES_DU_TRAVAIL_FAIT]);
const clePosee = (projectId: string) => `charte.carte.${projectId}`;

/** La carte de charte encore ouverte d'un projet, s'il en a une. */
export function carteDeCharteOuverte(projectId: string): Card | undefined {
  return store.listCards(projectId).find((c) => c.labels.includes(LABEL_CHARTE) && !COLONNES_RANGEES.has(c.column));
}

/** Pose la carte qui rédige la charte d'un projet ; la lance si demandé. Une carte déjà ouverte est rendue telle quelle. */
export function poserLaCarteDeCharte(project: Project, options: { lancer: boolean; createCard: CreerCarte }): Card {
  const ouverte = carteDeCharteOuverte(project.id);
  if (ouverte) return ouverte;
  const carte = options.createCard(project.id, {
    title: TITRE_CARTE_DE_CHARTE,
    description: descriptionDeLaCarteDeCharte(project.name),
    briefing: consigneDeRedactionDeCharte({ nom: project.name }),
    labels: [LABEL_CHARTE],
    origin: 'agent',
    auteur: 'agent',
  });
  const armee = options.lancer
    ? store.saveCard({ ...carte, scheduling: { ...(carte.scheduling ?? { asap: false, attempts: 0, restarts: 0 }), asap: true } })
    : carte;
  setMeta(clePosee(project.id), String(Date.now()));
  bus.emit({ type: 'card.upsert', card: armee });
  return armee;
}
