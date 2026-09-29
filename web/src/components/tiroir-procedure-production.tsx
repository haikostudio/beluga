import * as React from 'react';
import { ChevronDown, Loader2, Rocket, RotateCw } from 'lucide-react';
import {
  agentDeConfiguration,
  decisionsQuiAlertent,
  explicationDuProcessus,
  type EtatProcedure,
  type OngletDeProduction,
  type ProcessusDeProduction,
} from '@beluga/shared';
import {
  BulleInfo,
  Button,
  DialogTitle,
  Drawer,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Tooltip,
  ZoneDefilement,
} from '@/components/ui';
import { Chat } from '@/components/chat';
import { RepereAttention } from '@/components/repere-attention';
import { SilhouetteConversation } from '@/components/silhouettes';
import { Markdown } from '@/lib/markdown';
import { client } from '@/lib/client';
import { useApp } from '@/lib/use-app';
import { estTelephone } from '@/lib/telephone';
import { t } from '@/lib/langue';

/**
 * LE TIROIR DE LA MISE EN PRODUCTION — refonte du 24/09/2026.
 *
 * Le bandeau du bas ouvrait le volet de la DERNIÈRE mise en production : une
 * information dont personne ne se servait, pendant que la procédure elle-même
 * se cachait dans une rubrique des réglages. Il ouvre désormais la PROCÉDURE,
 * dans le même tiroir qu'une tâche (`card-panel.tsx`) : même entête, même
 * barre d'onglets, même conversation. Deux onglets seulement, puisque cet agent
 * n'a ni carte, ni facture, ni branche :
 *
 *  - « Conversation » : le fil de l'agent de CONFIGURATION du projet, retenu
 *    sur le projet (`miseEnProduction.agentId`) — il se retrouve et se
 *    poursuit d'une ouverture à l'autre, questions `ask_user` comprises ;
 *  - « Configuration » : ce que l'agent a configuré, expliqué simplement, puis
 *    le bouton de mise en production (fourni par le bandeau, qui en garde la
 *    logique : contrôles, confirmation, suivi du déroulé).
 *
 * L'onglet d'entrée suit `ongletDEntreeDeProduction` (`shared`).
 */
export function TiroirProcedureProduction({
  projectId,
  open,
  onClose,
  onglet,
  onOnglet,
  titre,
  actions,
  configuration,
  deroule,
}: {
  projectId: string;
  open: boolean;
  onClose: () => void;
  onglet: OngletDeProduction;
  onOnglet: (onglet: OngletDeProduction) => void;
  titre?: string;
  /** Les petits boutons de l'entête (« ! ») : à gauche de la flèche qui referme. */
  actions?: React.ReactNode;
  /** Le contenu de l'onglet « Configuration » : l'explication et le bouton, ou le déroulé. */
  configuration: React.ReactNode;
  /** Un déroulé est affiché : il prend la hauteur pleine, sans zone qui défile autour. */
  deroule?: boolean;
}) {
  const state = useApp();
  const projet = state.projects.find((p) => p.id === projectId);
  const agentId = agentDeConfiguration(projet);
  /* La question posée par l'agent allume l'onglet, comme celui d'une carte. */
  const attente = agentId
    ? decisionsQuiAlertent(state.decisions).filter((d) => d.agentId === agentId).length
    : 0;
  return (
    <Drawer open={open} onClose={onClose} plein={deroule || estTelephone()} hauteurFixe>
      <div className="flex min-h-0 flex-1 flex-col" data-tiroir-procedure-production={projectId} data-onglet-production={onglet}>
        <header className="flex shrink-0 items-center gap-2 px-4 pb-[13px]" data-entete-tiroir-production>
          <Rocket className="h-3.5 w-3.5 shrink-0 text-muted" />
          <DialogTitle className="min-w-0 flex-1 truncate">{titre ?? t('Mise en production')}</DialogTitle>
          {/* L'INTERRUPTEUR DE MISE EN PRODUCTION, à gauche du « i » : éteint
              par défaut, il grise le bouton du pied et le serveur refuse. */}
          <InterrupteurMiseEnProduction projectId={projectId} actif={projet?.miseEnProductionActive === true} />
          {actions ? <div className="flex shrink-0 items-center gap-0.5">{actions}</div> : null}
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0 text-muted"
            onClick={onClose}
            aria-label="Fermer"
            title={t('Fermer')}
            data-fermer-tiroir-production
          >
            <ChevronDown className="h-4 w-4" />
          </Button>
        </header>

        <Tabs
          value={onglet}
          onValueChange={(v) => onOnglet(v as OngletDeProduction)}
          className="blocs-au-fond-de-l-onglet flex min-h-0 flex-1 flex-col"
        >
          {/* La barre d'onglets de la carte, à l'identique (`card-panel.tsx`). */}
          <div
            data-barre-onglets
            className="mx-4 mt-1 flex-none overflow-hidden rounded-md border border-border/40 bg-raised/35 backdrop-blur-md"
          >
            <ZoneDefilement axe="horizontal" classeEnveloppe="flex-none" className="px-1.5 py-1">
              <TabsList className="w-full border-0 bg-transparent">
                <TabsTrigger
                  value="configuration"
                  className="flex-1 data-[state=active]:bg-bg/55"
                  data-onglet-tiroir-production="configuration"
                >
                  {t('Configuration')}
                </TabsTrigger>
                <TabsTrigger
                  value="conversation"
                  className="flex-1 gap-1 data-[state=active]:bg-bg/55"
                  data-onglet-tiroir-production="conversation"
                >
                  {t('Conversation')}
                  <RepereAttention compte={attente} />
                </TabsTrigger>
              </TabsList>
            </ZoneDefilement>
          </div>

          <TabsContent value="configuration" className="flex min-h-0 flex-1 flex-col pt-2 data-[state=inactive]:hidden">
            {configuration}
          </TabsContent>

          <TabsContent value="conversation" className="flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden">
            <ConversationDeConfiguration projectId={projectId} active={open && onglet === 'conversation'} />
          </TabsContent>
        </Tabs>
      </div>
    </Drawer>
  );
}

/**
 * L'INTERRUPTEUR QUI PERMET OU NON LA MISE EN PRODUCTION DU PROJET
 * (`miseEnProductionActive`), sur le modèle de celui du déploiement
 * automatique : l'affichage suit l'état voulu pendant l'aller-retour, puis
 * reprend le projet revenu du serveur — diffusé à tous les appareils.
 */
function InterrupteurMiseEnProduction({ projectId, actif }: { projectId: string; actif: boolean }) {
  const [enVol, setEnVol] = React.useState<boolean | null>(null);

  React.useEffect(() => {
    setEnVol((vise) => (vise === null || vise === actif ? null : vise));
  }, [actif]);

  const basculer = (valeur: boolean) => {
    setEnVol(valeur);
    client
      .call({ type: 'project.update', id: projectId, patch: { miseEnProductionActive: valeur } })
      .catch(() => setEnVol(null));
  };

  const affiche = enVol ?? actif;
  return (
    <Tooltip
      label={
        affiche
          ? t('Mise en production activée pour ce projet. Éteindre pour l’empêcher.')
          : t('Mise en production désactivée pour ce projet. Allumer pour la permettre.')
      }
    >
      <span className="mr-1 inline-flex shrink-0 items-center">
        <Switch
          checked={affiche}
          attente={enVol !== null}
          onCheckedChange={basculer}
          aria-label="Mise en production activée"
          data-interrupteur-mise-en-production={affiche ? 'oui' : 'non'}
        />
      </span>
    </Tooltip>
  );
}

/**
 * LA CONVERSATION AVEC L'AGENT DE CONFIGURATION.
 *
 * Aucun agent encore : le PREMIER tour part tout seul à l'ouverture de
 * l'onglet — l'agent étudie le projet puis pose ses questions (`ask_user`,
 * qui l'arrête jusqu'à la réponse). Un agent qui a déjà parlé ne se relance
 * JAMAIS seul : on lui écrit par la barre, comme à n'importe quel agent, et le
 * serveur y joint ce qu'il doit savoir (`contexteDeConfiguration`).
 */
function ConversationDeConfiguration({ projectId, active }: { projectId: string; active: boolean }) {
  const state = useApp();
  const projet = state.projects.find((p) => p.id === projectId);
  const agentId = agentDeConfiguration(projet);
  const agent = agentId ? (state.agents[agentId] ?? null) : null;
  const etat: EtatProcedure | undefined = state.procedures[`${projectId}:production`];
  const [erreur, setErreur] = React.useState<string | null>(null);
  const demande = React.useRef(false);

  /* Un agent retenu mais trop ancien pour le premier envoi : on le réclame. */
  React.useEffect(() => {
    if (active && agentId && !agent) void client.chargerAgent(agentId);
  }, [active, agentId, agent]);

  const demarrer = React.useCallback(() => {
    setErreur(null);
    demande.current = true;
    void client
      .call<{ etat?: EtatProcedure }>({ type: 'procedure.tour', projectId, cible: 'production' })
      .then((res) => {
        if (res?.etat) client.majProcedure(projectId, 'production', res.etat);
        if (res?.etat?.raison) setErreur(res.etat.raison);
      })
      .catch((err: unknown) => {
        demande.current = false;
        setErreur(err instanceof Error ? err.message : String(err));
      });
  }, [projectId]);

  /* LE PREMIER TOUR PART À L'OUVERTURE, une seule fois : jamais quand un
     agent est déjà retenu sur le projet. */
  React.useEffect(() => {
    if (!active || agentId || demande.current || etat?.enCours) return;
    demarrer();
  }, [active, agentId, etat?.enCours, demarrer]);

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

/**
 * L'EXPLICATION DE LA CONFIGURATION, en tête de l'onglet « Configuration » :
 * ce que l'agent a écrit en mots courants, puis le détail des étapes, replié.
 * Un processus d'avant cette refonte n'a pas d'explication : son résumé la
 * remplace, et le détail reste là.
 */
export function ExplicationDeConfiguration({ processus }: { processus?: ProcessusDeProduction }) {
  const { texte, repli } = explicationDuProcessus(processus);
  if (!processus?.etapes?.length) {
    return (
      <div className="flex flex-col gap-1.5 text-[13px] leading-snug" data-explication-configuration="absente">
        <p className="text-muted" data-procedure-absente="archived">
          {t('Ce projet n’a pas encore de processus de mise en production : rien ne peut partir tant qu’il n’est pas configuré.')}{' '}
          <span className="inline-flex align-middle" data-portee-etape="archived">
            <BulleInfo cote="start">
              {t('L’agent de l’onglet « Conversation » étudie le projet, vous pose ses questions sur l’endroit qui accueille la production, puis écrit ici ce qu’il a configuré.')}
            </BulleInfo>
          </span>
        </p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2" data-explication-configuration={repli ? 'repli' : 'agent'}>
      {texte ? <Markdown content={texte} className="text-[13.5px] leading-relaxed" /> : null}
      <details className="group rounded-md bg-raised/35 px-2.5 py-1.5" data-etapes-configuration={processus.etapes.length}>
        <summary className="cursor-pointer select-none text-[12.5px] text-muted">
          {t('Les {v0} étapes jouées par le bouton', { v0: processus.etapes.length })}
        </summary>
        <ol className="mt-1.5 flex flex-col gap-1.5">
          {processus.etapes.map((etape, rang) => (
            <li key={rang} className="text-[12.5px] leading-snug">
              <span className="text-text">
                {rang + 1}. {etape.libelle}
              </span>
              <code className="mt-0.5 block whitespace-pre-wrap break-all font-mono text-[11.5px] text-faint">
                {etape.commande}
              </code>
            </li>
          ))}
        </ol>
      </details>
    </div>
  );
}
