/*
 * « DÉPLOYER » DANS LA BARRE D'UN PROJET (carte « Beluga piloté par des agents », 26/11/2026) : le bouton nommé, avec
 * le nombre de tâches prêtes, qui ouvre l'AGENT DE DÉPLOIEMENT du projet sur son onglet « Mise en ligne ». L'agent se
 * trouve dans les équipes déjà lues pour la colonne : aucune lecture de plus. Sans agent de déploiement, « Publier »
 * d'avant reste en place (`BoutonDeployer`).
 */
import * as React from 'react';
import { BoutonDeployer } from '@/components/menu-publier';
import { useEquipesDeLaColonne } from '@/components/equipe/use-equipe';
import { naviguerVers } from '@/components/ui/lien-interne';
import { writePref } from '@/lib/prefs';

export function BoutonDeployerDuProjet({ projectId }: { projectId: string }) {
  const membres = useEquipesDeLaColonne();
  const agent = membres?.find((m) => m.projectId === projectId && m.role === 'deploiement') ?? null;
  const id = agent?.id ?? null;
  const ouvrir = React.useCallback(() => {
    if (!id) return;
    writePref(`agent.onglet.${id}`, 'mise-en-ligne');
    naviguerVers(`projet/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(id)}`);
  }, [id, projectId]);
  /* Tant que les équipes ne sont pas lues, le bouton a déjà sa forme : pas de « Publier » qui clignote une seconde. */
  return <BoutonDeployer projectId={projectId} agentDeploiementId={membres === null ? 'chargement' : id} onOuvrir={ouvrir} />;
}
