/*
 * « NOUVEL AGENT › TYPE › PROJET » (décision de l'utilisateur, 14/11/2026). Le type choisi crée son élément DANS le
 * projet choisi, puis l'ouvre en onglet de ce projet — l'agent à gauche, ses données à droite :
 *  - Programmation : la carte d'agent habituelle (cadrage) ;
 *  - Studio : une création vide, ouverte dans l'éditeur ;
 *  - Campagne : la marque du projet (créée au besoin), sur « Nouvelle campagne » ;
 *  - Marketing : un dossier d'étude rattaché au projet (le site de l'entreprise, s'il a été donné) ;
 *  - Charte graphique : un document neuf et SON agent, sans carte (17/11/2026, « créer une charte passe par l'agent ») —
 *    la page de la charte s'ouvre, l'agent à gauche qui commence, le document à droite qui se remplit ;
 *  - Surveillance, Tâche récurrente : une carte d'agent du projet, déjà amorcée — ces deux-là se créent PAR L'AGENT
 *    (une surveillance ne porte jamais de secret dans sa recette).
 * Une ENTREPRISE EXTÉRIEURE devient d'abord un projet léger à son nom (`project.creerLeger`).
 */
import type { Card, Project } from '@beluga/shared';
import { TITRE_CARTE_DE_CADRAGE } from '@beluga/shared';
import type { CibleDeCreation, TypeDAgent } from '@/components/menus-de-la-colonne';
import { naviguerVers } from '@/components/ui/lien-interne';
import { client } from '@/lib/client';
import { t } from '@/lib/langue';
import { writePref } from '@/lib/prefs';

/** Une saisie qui ressemble à une adresse de site (« exemple.fr », « https://… »). */
export const ressembleAUnSite = (saisie: string) => /^(https?:\/\/)?[\w-]+(\.[\w-]+)+/.test(saisie.trim()) && !/\s/.test(saisie.trim());

/** Le nom d'une entreprise lu dans son adresse : « https://www.exemple.fr/x » → « exemple.fr ». */
export const nomDuSite = (adresse: string) =>
  adresse
    .trim()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split(/[/?#]/)[0];

/** Ouvre une adresse d'objet (« marketing2/<id> »…) en onglet du projet donné. */
export function ouvrirDansLeProjet(projectId: string, adresse: string) {
  client.setActiveProject(projectId);
  naviguerVers('#' + adresse);
}

/**
 * La première demande amorcée dans la carte d'un agent qui crée lui-même son élément. Le TITRE est une clé du
 * dictionnaire ; la DEMANDE est un message à l'agent, posé dans le champ : elle reste en français.
 */
const CLES_AMORCES: Partial<Record<TypeDAgent, { titre: string; demande: string }>> = {
  surveillance: { titre: 'Surveillance', demande: 'Mets en place une surveillance pour ce projet.' },
  recurrente: { titre: 'Tâche récurrente', demande: 'Crée une tâche récurrente pour ce projet.' },
};

async function carteDAgent(projectId: string, titre: string, onCarteCree: (cardId: string) => void, brouillon?: string) {
  const data = await client.call<{ card: Card }>({ type: 'card.create', projectId, title: titre, cadrage: true });
  if (!data?.card) return;
  onCarteCree(data.card.id);
  /* La demande amorcée attend dans le champ d'écriture (le brouillon de l'agent) : rien ne part sans l'utilisateur. */
  if (brouillon && data.card.agentId) writePref(`draft.${data.card.agentId}`, brouillon);
  /* LE PROJET CHOISI DEVIENT LE PROJET AFFICHÉ (15/11/2026, « j'ai créé une tâche pour HaikoBill et ça m'indique le
     haut de Beluga ») : comme pour Studio, Campagne et Marketing, l'écran passe d'abord sur le projet de la carte —
     sinon le fil d'Ariane ET le menu « Publier » restaient sur le projet regardé avant. */
  if (client.lireEtat().activeProjectId !== projectId) client.setActiveProject(projectId);
  client.openCard(data.card.id);
}

export async function creerUnAgentDeType(type: TypeDAgent, cible: CibleDeCreation, onCarteCree: (cardId: string) => void): Promise<void> {
  try {
    let projectId: string;
    let site: string | undefined;
    if ('projectId' in cible) projectId = cible.projectId;
    else {
      const saisie = cible.entreprise.trim();
      site = ressembleAUnSite(saisie) ? saisie : undefined;
      const r = await client.call<{ project: Project }>({ type: 'project.creerLeger', nom: site ? nomDuSite(site) : saisie, ...(site ? { site } : {}) });
      projectId = r.project.id;
    }
    switch (type) {
      case 'programmation':
        await carteDAgent(projectId, TITRE_CARTE_DE_CADRAGE, onCarteCree);
        return;
      case 'studio': {
        const r = await client.call<{ creation: { id: string } }>({ type: 'studio.creation.creer', projectId });
        ouvrirDansLeProjet(projectId, `studio/${r.creation.id}`);
        return;
      }
      case 'campagne': {
        const projet = client.lireEtat().projects.find((p) => p.id === projectId);
        const { marques } = await client.call<{ marques: { id: string; projets: { id: string }[] }[] }>({ type: 'communication.marques' });
        let marque = marques.find((m) => m.projets.some((p) => p.id === projectId));
        if (!marque) {
          const r = await client.call<{ marque: { id: string } }>({
            type: 'communication.marque.creer',
            nom: projet?.name ?? t('Marque'),
            origine: 'projets',
            projets: [projectId],
          });
          marque = { id: r.marque.id, projets: [{ id: projectId }] };
        }
        ouvrirDansLeProjet(projectId, `communication2/${marque.id}/campagnes/nouvelle`);
        return;
      }
      case 'charte': {
        const r = await client.call<{ plaquetteId: string }>({ type: 'plaquettes.creerVide', projectId });
        ouvrirDansLeProjet(projectId, `plaquettes/${projectId}/${r.plaquetteId}`);
        return;
      }
      default: {
        const amorce = CLES_AMORCES[type];
        await carteDAgent(projectId, amorce ? t(amorce.titre) : TITRE_CARTE_DE_CADRAGE, onCarteCree, amorce?.demande);
      }
    }
  } catch (err: any) {
    client.pushToast('error', err?.message ?? t('création impossible'));
  }
}
