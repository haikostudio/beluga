import * as React from 'react';
import { ChevronDown, Cpu, Loader2 } from 'lucide-react';
import { MOT_CONFIGURATION, libellesDuRun, type Card, type EngineInfo } from '@beluga/shared';
import { BulleInfo, Button, Drawer, EnteteDeFeuille, ZoneDefilement } from '@/components/ui';
import { RunSelectors, resoudreRun, type ReglageDeRun, type RunChoix } from '@/components/run-selectors';
import { client } from '@/lib/client';
import { useApp } from '@/lib/use-app';
import { cn } from '@/lib/utils';
import { t } from '@/lib/langue';

/**
 * LA CARTE DE CONFIGURATION D'UNE TÂCHE NEUVE — le PREMIER geste du flux.
 *
 * L'utilisateur clique « Nouvelle tâche » : avant de dire ce qu'il veut, il
 * choisit AVEC QUOI ce sera fait — moteur, modèle, niveau de réflexion, et le
 * compte quand plusieurs se disputent le travail. Rien de tout cela ne passe
 * par un moteur : le catalogue est déjà à l'écran, la carte s'affiche seule et
 * ne coûte pas un jeton.
 *
 * Elle porte les valeurs EN CLAIR, une ligne par réglage, et chaque ligne
 * ouvre DIRECTEMENT la liste de ce réglage, en menu ancré SOUS ELLE
 * (`RunSelectors ouvrirSur`) — jamais une page, jamais un aperçu qu'il faudrait
 * re-cliquer. Le choix écrit sur la CARTE, qui est ce que le lancement lira,
 * exactement comme le bloc compact qui prendra sa place dès le premier message
 * (`ReglagesAgent`, juste au-dessus).
 */
export function CarteDeConfiguration({
  card,
  libelles,
}: {
  card: Card;
  libelles: { moteur: string; modele: string; reflexion: string };
}) {
  const state = useApp();
  const choisir = choixDeLaCarte(card, state.engines);

  /* La ligne « Compte » ne paraît que si plusieurs comptes du moteur retenu
     se disputent vraiment le travail — sinon le choix automatique suffit. */
  const moteurChoisi = resoudreRun(state.engines, card.run).engine;
  const comptes = (state.quotas ?? []).filter((c) => c.engine === moteurChoisi?.id && !c.disabled);
  const compte = card.run?.account ? comptes.find((c) => c.id === card.run?.account) : undefined;

  /* Chaque ligne est le bouton de SON menu : le même composant que partout
     ailleurs, ouvert droit sur la liste du réglage nommé. */
  const ligne = (reglage: ReglageDeRun, nom: string, valeur: string) => (
    <RunSelectors
      engines={state.engines}
      choix={card.run}
      onSelect={choisir}
      comptes={state.quotas}
      ouvrirSur={reglage}
      declencheur={<LigneDeConfiguration nom={nom} valeur={valeur} />}
    />
  );

  return (
    <div data-carte-configuration className="rounded-lg border border-border bg-raised px-3 py-3">
      <div className="flex items-center gap-1.5 text-[12.5px] uppercase tracking-wide text-faint">
        <Cpu className="h-3 w-3 shrink-0" />
        {t('Configuration de l’agent')}
      </div>
      <p className="flex items-center gap-1 mt-1 text-[14.5px] font-medium leading-relaxed text-text">{t(MOT_CONFIGURATION.titre)}<BulleInfo cote="start">{t(MOT_CONFIGURATION.indice)}</BulleInfo></p>

      <div className="mt-2.5 flex flex-col gap-1">
        {ligne('moteur', t('Moteur'), libelles.moteur)}
        {ligne('modele', t('Modèle'), libelles.modele)}
        {ligne('reflexion', t('Réflexion'), libelles.reflexion)}
        {comptes.length > 1 ? ligne('compte', t('Compte'), compte?.label ?? t('Automatique')) : null}
      </div>
    </div>
  );
}

/**
 * Une ligne de la carte de configuration : le nom, la valeur, un chevron. C'est
 * un vrai `button`, qui transmet sa référence et ses propriétés : il sert de
 * BOUTON au menu de son réglage (`RunSelectors declencheur`), qui s'ancre sous
 * lui.
 */
export const LigneDeConfiguration = React.forwardRef<
  HTMLButtonElement,
  { nom: string; valeur: string } & React.ButtonHTMLAttributes<HTMLButtonElement>
>(function LigneDeConfiguration({ nom, valeur, className, ...props }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      data-ligne-configuration={nom}
      className={cn(
        'flex w-full items-center gap-2 rounded-md bg-surface px-3 sm:px-2.5 py-2 sm:py-1.5 text-left transition-colors hover:bg-raised',
        className,
      )}
      {...props}
    >
      <span className="shrink-0 text-[12.5px] text-faint">{nom}</span>
      <span data-valeur={valeur} className="min-w-0 flex-1 truncate text-[14.5px] font-medium text-text">
        {valeur}
      </span>
      <ChevronDown className="h-3 w-3 shrink-0 text-faint" />
    </button>
  );
});

/**
 * ÉCRIRE LE RÉGLAGE SUR LA CARTE — un seul geste, partagé par la carte de
 * configuration et la bulle compacte. Le serveur tranche la cascade : on lui
 * donne le souhait, il rend la combinaison qui existe vraiment.
 */
export function choixDeLaCarte(card: Card, engines: EngineInfo[]) {
  return async (patch: Parameters<typeof RunSelectors>[0]['choix'] & object) => {
    const souhait: RunChoix = patch.engine ? { engine: patch.engine } : { ...card.run, ...patch };
    const retenu = resoudreRun(engines, souhait);
    if (!retenu.engine) return;
    try {
      await client.call({
        type: 'card.update',
        id: card.id,
        patch: {
          run: {
            ...card.run,
            engine: retenu.engine.id,
            model: retenu.model?.id,
            thinking: retenu.thinking?.id ?? 'none',
            account: souhait.account,
            // Un choix fait à l'écran l'emporte sur le niveau du cadrage.
            niveau: undefined,
          },
        },
      });
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('réglage impossible'));
    }
  };
}

/**
 * VALIDER LA CONFIGURATION, PUIS LANCER — la carte de construction née d'un
 * cahier des charges terminé (`suiteDuCahier`, demande du 22/10/2026). Son
 * bouton « Lancer » n'envoie rien : il ouvre cette feuille, qui montre les
 * réglages de l'agent (moteur, modèle, réflexion, compte), modifiables ici,
 * et un bouton PROPRE À CETTE ÉTAPE qui les valide et lance la construction.
 */
export function FeuilleDeValidationDeConfiguration({
  carte,
  open,
  onClose,
}: {
  carte: Card;
  open: boolean;
  onClose: () => void;
}) {
  const state = useApp();
  const retenu = resoudreRun(state.engines, carte.run);
  const libelles = libellesDuRun(state.engines, {
    engine: retenu.engine?.id,
    model: retenu.model?.id,
    thinking: retenu.thinking?.id,
  });
  const [envoi, setEnvoi] = React.useState(false);
  /* UN BOUTON QUI PART EN REQUÊTE LE DIT DÈS LE CLIC : la roue tourne tant que
     le lancement n'a pas répondu ; un refus est dit par le chemin commun. */
  const lancer = async () => {
    setEnvoi(true);
    try {
      await client.demanderLeLancement(carte.id);
      onClose();
    } catch {
      /* Le refus est déjà dit en rouge par `demanderLeLancement`. */
    } finally {
      setEnvoi(false);
    }
  };
  return (
    <Drawer open={open} onClose={onClose} feuille>
      <EnteteDeFeuille titre={t('Configuration de l’agent')} data-entete-validation-configuration="" />
      <ZoneDefilement classeEnveloppe="min-h-0 flex-1" className="px-3 pb-4">
        <div data-validation-configuration={carte.id} className="flex flex-col gap-3">
          <CarteDeConfiguration card={carte} libelles={libelles} />
          <Button
            className="w-full"
            disabled={envoi || !retenu.engine}
            onClick={() => void lancer()}
            data-valider-configuration=""
          >
            {envoi ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            {t('Valider la configuration et lancer')}
          </Button>
        </div>
      </ZoneDefilement>
    </Drawer>
  );
}
