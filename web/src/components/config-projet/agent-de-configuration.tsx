import * as React from 'react';
import { Loader2, RotateCw, Sparkles } from 'lucide-react';
import { agentDeConfiguration, libelleInitier, type CiblePublication, type EtatProcedure } from '@beluga/shared';
import { Button, DialogTitle, Drawer } from '@/components/ui';
import { Chat } from '@/components/chat';
import { BoutonInitierProcedure } from '@/components/boutons-procedure';
import { SilhouetteConversation } from '@/components/silhouettes';
import { client } from '@/lib/client';
import { useApp } from '@/lib/use-app';
import { estTelephone } from '@/lib/telephone';
import { t } from '@/lib/langue';

/**
 * L'AGENT DE CONFIGURATION D'UNE ÉTAPE — dans la rubrique de cette étape, dans
 * les réglages du projet (29/09/2026).
 *
 * Elle vivait dans l'onglet « Conversation » du tiroir de mise en production,
 * et le déploiement n'en avait pas. Les deux agents parlent désormais depuis
 * la rubrique de leur étape, sous le processus qu'ils ont écrit : on lit ce qui
 * est en place, et on en parle au même endroit. Tous les boutons qui menaient à
 * ces agents ouvrent cette rubrique (`ouvrirRubriqueDeLEtape`).
 *
 * LA CONVERSATION N'EST PLUS DANS LE CONTENU : un bouton pleine largeur l'ouvre
 * dans un TIROIR posé par-dessus la fenêtre de réglages. Posée en ligne, avec
 * sa hauteur fixe, elle doublait le défilement de la page (règle de
 * l'utilisateur : jamais deux zones qui défilent l'une dans l'autre). Dans le
 * tiroir, le fil est seul à défiler.
 *
 * Aucun agent encore : rien ne part tout seul à la simple visite des réglages
 * — le bouton « Configuration de la procédure » ouvre le tiroir, et c'est là
 * qu'un second bouton lance le premier tour, où l'agent étudie le projet puis
 * pose ses questions (`ask_user`, qui l'arrête jusqu'à la réponse, affichée dans
 * ce fil). Un agent qui a déjà parlé ne se relance JAMAIS seul : on lui écrit
 * par la barre, et le serveur y joint ce qu'il doit savoir
 * (`contexteDeConfiguration`).
 *
 * `voile` : la mise en production est désactivée. Le bouton s'éteint et la
 * phrase dit pourquoi, dessous — plus de flou : un bouton éteint suffit à
 * ne rien laisser d'atteignable.
 */
export function AgentDeConfiguration({
  projectId,
  cible,
  voile,
}: {
  projectId: string;
  cible: CiblePublication;
  voile?: string | null;
}) {
  const [ouvert, setOuvert] = React.useState(false);
  /* Le libellé du bouton dit où l'on en est : une conversation qui existe se
     reprend, une qui n'existe pas se commence. */
  const state = useApp();
  const commencee =
    !!agentDeConfiguration(state.projects.find((p) => p.id === projectId), cible) ||
    !!state.procedures[`${projectId}:${cible}`]?.enCours;
  return (
    <div
      data-agent-configuration={cible}
      data-conversation-commencee={commencee ? 'oui' : 'non'}
      data-voile-configuration={voile ? 'oui' : 'non'}
    >
      <Button
        variant="outline"
        size="pied"
        disabled={!!voile}
        onClick={() => setOuvert(true)}
        data-ouvrir-agent-configuration={cible}
      >
        <Sparkles className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{commencee ? t('Parler à l’agent de configuration') : t(libelleInitier(cible))}</span>
      </Button>
      {voile ? (
        <p className="mt-1.5 text-[12px] leading-snug text-faint" data-voile-agent={cible}>
          {voile}
        </p>
      ) : null}
      <Drawer open={ouvert && !voile} onClose={() => setOuvert(false)} empile plein={estTelephone()} hauteurFixe>
        <div className="flex min-h-0 flex-1 flex-col" data-tiroir-agent-configuration={cible}>
          <header className="flex shrink-0 items-center gap-2 px-4 pb-[13px]">
            <Sparkles className="h-3.5 w-3.5 shrink-0 text-muted" />
            <DialogTitle className="min-w-0 flex-1 truncate">{t('Agent de configuration')}</DialogTitle>
          </header>
          <div className="flex min-h-0 flex-1 flex-col" data-contenu-agent-configuration>
            <ConversationDeConfiguration projectId={projectId} cible={cible} />
          </div>
        </div>
      </Drawer>
    </div>
  );
}

function ConversationDeConfiguration({ projectId, cible }: { projectId: string; cible: CiblePublication }) {
  const state = useApp();
  const projet = state.projects.find((p) => p.id === projectId);
  const agentId = agentDeConfiguration(projet, cible);
  const agent = agentId ? (state.agents[agentId] ?? null) : null;
  const etat: EtatProcedure | undefined = state.procedures[`${projectId}:${cible}`];
  const [erreur, setErreur] = React.useState<string | null>(null);
  const [demande, setDemande] = React.useState(false);

  /* Un agent retenu mais trop ancien pour le premier envoi : on le réclame. */
  React.useEffect(() => {
    if (agentId && !agent) void client.chargerAgent(agentId);
  }, [agentId, agent]);

  const demarrer = React.useCallback(() => {
    setErreur(null);
    setDemande(true);
    void client
      .call<{ etat?: EtatProcedure }>({ type: 'procedure.tour', projectId, cible })
      .then((res) => {
        if (res?.etat) client.majProcedure(projectId, cible, res.etat);
        if (res?.etat?.raison) {
          setErreur(res.etat.raison);
          setDemande(false);
        }
      })
      .catch((err: unknown) => {
        setDemande(false);
        setErreur(err instanceof Error ? err.message : String(err));
      });
  }, [projectId, cible]);

  const raison = erreur ?? (etat && !etat.enCours ? etat.raison : undefined);
  const aucunMessage = agent ? (state.messages[agent.id]?.length ?? 0) === 0 : true;

  if (raison && aucunMessage && !etat?.enCours) {
    return (
      <div className="flex flex-col items-start gap-2 px-4 py-3" data-erreur-procedure>
        <p className="text-[13px] leading-snug text-danger">{raison}</p>
        <Button size="sm" variant="outline" onClick={demarrer} data-relancer-procedure>
          <RotateCw className="h-3 w-3" /> {t('Réessayer')}
        </Button>
      </div>
    );
  }
  /* PERSONNE N'A ENCORE PARLÉ : le bouton lance l'agent, rien ne part seul. */
  if (!agentId && !demande && !etat?.enCours) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center" data-conversation-procedure="aucune">
        <p className="max-w-md text-[13px] leading-snug text-muted">
          {cible === 'dev'
            ? t('Un agent étudie le projet, vous pose ses questions, puis écrit un processus de déploiement propre à ce projet. Tant qu’il n’est pas écrit, le déroulé commun reste en service.')
            : t('Un agent étudie le projet, vous pose ses questions sur l’endroit qui accueille la production, puis écrit le processus que le bouton « Mise en production » suivra.')}
        </p>
        <BoutonInitierProcedure cible={cible} onOuvrir={demarrer} />
      </div>
    );
  }
  if (!agent) {
    return (
      <div className="flex min-h-0 flex-1 flex-col" data-conversation-procedure="demarrage">
        <p className="flex items-center gap-1.5 px-4 pt-3 text-[13px] text-muted">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-en-cours" />
          {t('L’agent étudie le projet avant de vous poser ses questions…')}
        </p>
        <SilhouetteConversation bulles={2} />
      </div>
    );
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-conversation-procedure={agent.id}>
      <Chat agent={agent} projectId={projectId} libelleDuChamp={t('Écrire à l’agent de configuration')} />
    </div>
  );
}
