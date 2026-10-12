import * as React from 'react';
import { Loader2, Power, Square, TerminalSquare } from 'lucide-react';
import { Button, CLASSE_GROUPE_DE_LIGNES, ConfirmDialog } from '@/components/ui';
import { Groupe } from '@/components/reglages/communs';
import { COULEUR_DU_POINT_DE_REDEMARRAGE, useRedemarrage } from '@/components/redemarrage';
import { client } from '@/lib/client';
import { t } from '@/lib/langue';
import { ouvrirLeTerminal } from '@/lib/ouvrir-terminal';
import { useApp } from '@/lib/use-app';
import { cn } from '@/lib/utils';

/**
 * CE QUI AGIT SUR LA MACHINE ENTIÈRE : redémarrer le serveur, ouvrir son
 * terminal, arrêter tous les agents. Ces trois gestes vivaient dans le menu
 * « … » de la barre d'en-tête, qu'on n'a pas sous la main sur tous les écrans
 * et qui ne garde plus que ce qui concerne la page affichée (demande du
 * 11/10/2026). Les réglages, eux, s'ouvrent de partout.
 *
 * Repères des contrôles : `data-bouton-redemarrage="reglages"` et
 * `data-etat-redemarrage` sur le redémarrage, `data-terminal-bouton` sur le
 * terminal, `data-arreter-tous-les-agents` sur l'arrêt général.
 */
export function SectionServeur() {
  const state = useApp();
  const redemarrage = useRedemarrage();
  const [arretTous, setArretTous] = React.useState(false);

  // « starting » compte aussi : un tour resté coincé dans sa préparation est
  // justement celui qu'on veut pouvoir arrêter.
  const enCours = Object.values(state.agents).filter(
    (agent) => agent.status === 'running' || agent.status === 'starting',
  ).length;

  /*
   * L'ARRÊT DE TOUS LES AGENTS DIT CE QU'IL A FAIT, geste par geste. Le serveur
   * rend le bilan rédigé (`bilanDesArrets`) : on ne recompose rien ici, et on
   * n'annonce pas une réussite sur un nombre qui ne dit pas si le clic a mordu.
   */
  const arreterTousLesAgents = () =>
    client
      .call<{ count?: number; bilan?: { message?: string } }>({ type: 'agents.stop-all' })
      .then((response) => {
        const message = response?.bilan?.message;
        if (message) client.pushToast('info', message);
      })
      .catch((err: any) => {
        client.pushToast('error', err?.message ?? t('Arrêt refusé'));
      });

  return (
    <div className="space-y-5" data-reglages-serveur>
      <Groupe titre={t('Serveur et agents')}>
        <div className={CLASSE_GROUPE_DE_LIGNES}>
          <Ligne
            icone={redemarrage.repart ? <Loader2 className="h-4 w-4 animate-spin" /> : <Power className="h-4 w-4" />}
            titre={redemarrage.libelle}
            detail={redemarrage.raison ?? undefined}
            point={COULEUR_DU_POINT_DE_REDEMARRAGE[redemarrage.etat]}
          >
            <Button
              variant="subtle"
              size="sm"
              disabled={redemarrage.repart}
              onClick={redemarrage.ouvrir}
              data-bouton-redemarrage="reglages"
              data-etat-redemarrage={redemarrage.etat}
            >
              {t('Redémarrer')}
            </Button>
          </Ligne>
          <Ligne icone={<TerminalSquare className="h-4 w-4" />} titre={t('Terminal du serveur')}>
            <Button variant="subtle" size="sm" onClick={ouvrirLeTerminal} data-terminal-bouton>
              {t('Ouvrir')}
            </Button>
          </Ligne>
          <Ligne
            icone={<Square className="h-3.5 w-3.5 fill-current" />}
            titre={t('Arrêter tous les agents')}
            detail={enCours ? t('{n} agent(s) au travail', { n: enCours }) : t('Aucun agent au travail')}
          >
            <Button
              variant="arret"
              size="sm"
              disabled={!enCours}
              onClick={() => setArretTous(true)}
              data-arreter-tous-les-agents={enCours}
            >
              {t('Arrêter')}
            </Button>
          </Ligne>
        </div>
      </Groupe>

      {redemarrage.dialogue}

      <ConfirmDialog
        open={arretTous}
        danger
        title={
          enCours > 1
            ? t('Arrêter les {v0} agents en cours sur tous les projets ?', { v0: enCours })
            : t('Arrêter l’agent en cours ?')
        }
        description={t('Chaque moteur est coupé sur-le-champ, sur tous les projets. Le travail déjà écrit reste sur la branche de sa carte ; c’est la réflexion en cours qui s’arrête.')}
        confirmLabel={t('Arrêter tous les agents')}
        onConfirm={() => {
          void arreterTousLesAgents();
          setArretTous(false);
        }}
        onClose={() => setArretTous(false)}
      />
    </div>
  );
}

/** Une ligne du groupe : ce que fait le geste à gauche, son bouton à droite. */
function Ligne({
  icone,
  titre,
  detail,
  point,
  children,
}: {
  icone: React.ReactNode;
  titre: string;
  detail?: string;
  /** La couleur du point d'état, quand la ligne en porte un. */
  point?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl px-3.5 py-3">
      <span className="flex h-4 w-4 shrink-0 items-center justify-center text-muted">{icone}</span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-[14px] text-text">
          <span className="min-w-0 truncate">{titre}</span>
          {point ? <span aria-hidden className={cn('h-1.5 w-1.5 shrink-0 rounded-full', point)} /> : null}
        </span>
        {detail ? <span className="mt-0.5 block text-[12.5px] leading-relaxed text-muted">{detail}</span> : null}
      </span>
      <span className="shrink-0">{children}</span>
    </div>
  );
}
