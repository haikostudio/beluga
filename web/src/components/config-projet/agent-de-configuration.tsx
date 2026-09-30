import * as React from 'react';
import { Loader2, RotateCw, Sparkles } from 'lucide-react';
import {
  LIBELLE_BOUTON_DE_CONFIGURATION,
  agentDeConfiguration,
  agentTientSonTour,
  etatDuBoutonDeConfiguration,
  processusDeLEtape,
  type CiblePublication,
  type EtatProcedure,
} from '@beluga/shared';
import { Button, DialogTitle, Drawer } from '@/components/ui';
import { Chat } from '@/components/chat';
import { BoutonInitierProcedure } from '@/components/boutons-procedure';
import { SilhouetteConversation } from '@/components/silhouettes';
import { client } from '@/lib/client';
import { useApp } from '@/lib/use-app';
import { estTelephone } from '@/lib/telephone';
import {
  EVENEMENT_AGENT_CONFIGURATION,
  ouvrirAgentDeConfiguration,
  type DemandeDAgentDeConfiguration,
} from '@/lib/ouvrir-config-projet';
import { t } from '@/lib/langue';

/**
 * L'AGENT DE CONFIGURATION D'UNE ÉTAPE — un bouton dans l'EN-TÊTE de la
 * rubrique de cette étape (réglages du projet), et un TIROIR monté une seule
 * fois pour toute l'application (refonte du 30/09/2026).
 *
 * LE BOUTON vit en haut à droite du titre « Déploiement » ou « Mise en
 * production » ; il n'est plus pleine largeur en bas de page. Son libellé suit
 * l'état (`etatDuBoutonDeConfiguration`) : « Initialiser » tant qu'aucun
 * processus n'est écrit, « Agent au travail… » avec une roue pendant un tour,
 * « Répondre à l'agent » quand il attend sa réponse, « Reconfigurer » ensuite.
 * `voile` : la mise en production est désactivée, le bouton s'éteint et dit
 * pourquoi au survol — le bloc de l'interrupteur, juste dessous, le dit aussi.
 *
 * LE TIROIR (`TiroirAgentDeConfiguration`) écoute `ouvrirAgentDeConfiguration`.
 * Le bouton d'en-tête l'ouvre par-dessus la fenêtre de réglages ; la vignette
 * de l'agent au tableau et l'aiguillage des agents l'ouvrent seul, sans
 * fenêtre de réglages. Une conversation d'agent ne se pose jamais en ligne
 * dans une page qui défile : dans le tiroir, le fil est seul à défiler.
 *
 * Rien ne part tout seul à la simple visite : sans agent, le tiroir s'ouvre
 * sur une phrase et un second bouton lance le premier tour, où l'agent étudie
 * le projet puis pose ses questions (`ask_user`, affichée dans ce fil). Un
 * agent qui a déjà parlé ne se relance JAMAIS seul : on lui écrit par la
 * barre, et le serveur y joint ce qu'il doit savoir (`contexteDeConfiguration`).
 */
export function BoutonAgentDeConfiguration({
  projectId,
  cible,
  voile,
}: {
  projectId: string;
  cible: CiblePublication;
  voile?: string | null;
}) {
  const state = useApp();
  const projet = state.projects.find((p) => p.id === projectId);
  const agentId = agentDeConfiguration(projet, cible);
  const agent = agentId ? state.agents[agentId] : undefined;
  const procedure = state.procedures[`${projectId}:${cible}`];
  const etat = etatDuBoutonDeConfiguration({
    processus: !!processusDeLEtape(projet, cible),
    auTravail: !!procedure?.enCours || (!!agent && agentTientSonTour(agent)),
    question: !!procedure?.question || agent?.attendReponse === true,
  });
  return (
    <Button
      variant={etat === 'initialiser' ? 'default' : 'subtle'}
      size="sm"
      disabled={!!voile}
      title={voile ?? undefined}
      onClick={() => ouvrirAgentDeConfiguration(projectId, cible)}
      data-agent-configuration={cible}
      data-ouvrir-agent-configuration={cible}
      data-etat-bouton-agent={etat}
      data-voile-configuration={voile ? 'oui' : 'non'}
      className="shrink-0"
    >
      {etat === 'travail' ? (
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-en-cours" />
      ) : (
        <Sparkles className="h-3.5 w-3.5 shrink-0" />
      )}
      <span className="truncate">{t(LIBELLE_BOUTON_DE_CONFIGURATION[etat])}</span>
    </Button>
  );
}

/** Le tiroir de l'agent, monté une fois en haut de l'application. */
export function TiroirAgentDeConfiguration({ initiale }: { initiale?: DemandeDAgentDeConfiguration | null }) {
  /* La demande qui a fait monter le tiroir : il n'écoutait pas encore. */
  const [demande, setDemande] = React.useState<DemandeDAgentDeConfiguration | null>(initiale ?? null);
  React.useEffect(() => {
    const ouvrir = (event: Event) => {
      const detail = (event as CustomEvent<DemandeDAgentDeConfiguration>).detail;
      if (detail?.projectId) setDemande({ projectId: detail.projectId, cible: detail.cible });
    };
    window.addEventListener(EVENEMENT_AGENT_CONFIGURATION, ouvrir);
    return () => window.removeEventListener(EVENEMENT_AGENT_CONFIGURATION, ouvrir);
  }, []);
  return (
    <Drawer open={!!demande} onClose={() => setDemande(null)} empile plein={estTelephone()} hauteurFixe>
      {demande ? (
        <div className="flex min-h-0 flex-1 flex-col" data-tiroir-agent-configuration={demande.cible}>
          <header className="flex shrink-0 items-center gap-2 px-4 pb-[13px]">
            <Sparkles className="h-3.5 w-3.5 shrink-0 text-muted" />
            <DialogTitle className="min-w-0 flex-1 truncate">
              {demande.cible === 'dev' ? t('Agent de configuration du déploiement') : t('Agent de configuration de la mise en production')}
            </DialogTitle>
          </header>
          <div className="flex min-h-0 flex-1 flex-col" data-contenu-agent-configuration>
            <ConversationDeConfiguration
              key={`${demande.projectId}:${demande.cible}`}
              projectId={demande.projectId}
              cible={demande.cible}
            />
          </div>
        </div>
      ) : null}
    </Drawer>
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
        <Button size="sm" variant="subtle" onClick={demarrer} data-relancer-procedure>
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
