import * as React from 'react';
import { Check, Copy, Loader2, LogIn, RefreshCw, Settings, Terminal } from 'lucide-react';
import {
  ConnexionCompte,
  EngineId,
  MoteurDeLAssistant,
  connexionTerminee,
  moteursDeLAssistant,
  type TravailDInstallation,
} from '@beluga/shared';
import { BulleInfo, Badge, Button, ZoneDefilement } from '@/components/ui';
import { AjouterCle, BlocConnexion } from '@/components/connexion-compte';
import { IconeMoteur } from '@/components/icone-moteur';
import { BoutonInstaller, useTravailDuGenre } from '@/components/installation/travail';
import { client } from '@/lib/client';
import { installationEnDirect } from '@/lib/travail-installation';
import { useApp } from '@/lib/use-app';
import { cn } from '@/lib/utils';
import { t } from '@/lib/langue';

/*
 * L'ASSISTANT DE DÉMARRAGE — au moins un moteur avant d'entrer.
 *
 * Beluga Build fait travailler des moteurs en ligne de commande installés SUR LE
 * SERVEUR. Sans un seul d'entre eux, l'application s'ouvre normalement mais
 * chaque carte lancée retombe aussitôt : le tableau semble marcher, le travail
 * ne part jamais. Cet écran barre donc la route tant que la règle pure
 * `auMoinsUnMoteurEnLigne` (`shared/src/assistant-moteurs.ts`) répond non, et
 * s'efface tout seul dès qu'elle répond oui — aucun bouton « continuer », rien
 * à cliquer pour sortir.
 *
 * DEUX GESTES, ET PAS UN DE PLUS, par moteur :
 *  1. INSTALLER l'outil : un BOUTON. Le démon lance la commande de l'éditeur
 *     sous son propre compte — celui qui cherchera l'outil ensuite — et la
 *     sortie s'affiche en direct (`installation/travail.tsx`). Personne ne
 *     colle plus rien dans un terminal ; la commande ne se montre qu'en repli,
 *     après un échec ;
 *  2. CONNECTER un compte : exactement la mécanique des réglages
 *     (`connexion-compte.tsx`), page de connexion pour Claude et Codex, clé
 *     d'accès pour Cursor.
 */

/**
 * LES MOTEURS ET CE QU'IL LEUR MANQUE — la liste seule, sans cadre autour. Elle
 * sert deux écrans : l'assistant qui barre la route tant qu'aucun moteur ne
 * répond (ci-dessous), et la page « Moteurs » de l'assistant de premier
 * démarrage (`assistant-demarrage.tsx`), qui la pose dans sa propre page.
 */
export function ListeDesMoteurs() {
  const state = useApp();
  const moteurs = moteursDeLAssistant(state.engines, state.quotas);

  // Les connexions déjà suivies par le serveur : sans cette demande, une
  // tentative lancée depuis un autre appareil serait invisible ici.
  React.useEffect(() => {
    client
      .call<{ connexions: ConnexionCompte[] }>({ type: 'account.connections' })
      .then((data) => client.reprendreConnexions(data.connexions ?? []))
      .catch(() => undefined);
  }, []);

  return (
    <div className="space-y-2">
      {moteurs.map((moteur) => (
        <CarteMoteur key={moteur.id} moteur={moteur} />
      ))}
    </div>
  );
}

/** « Vérifier à nouveau » : relit le catalogue des moteurs et le relevé des comptes. */
export function BoutonRelireLesMoteurs() {
  const [relecture, setRelecture] = React.useState(false);
  const relire = async () => {
    setRelecture(true);
    try {
      await Promise.all([
        client.call({ type: 'engines.list' }).catch(() => undefined),
        client.call({ type: 'quota.refresh' }).catch(() => undefined),
      ]);
    } finally {
      setRelecture(false);
    }
  };
  return (
    <Button variant="outline" size="sm" data-assistant-relire="1" disabled={relecture} onClick={relire}>
      {relecture ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
      {t('Vérifier à nouveau')}
    </Button>
  );
}

export function AssistantMoteurs({ onOuvrirReglages }: { onOuvrirReglages: () => void }) {
  // Un travail d'installation lancé avant l'ouverture de cet écran (ou depuis
  // un autre appareil) se retrouve ici, sortie comprise.
  React.useEffect(() => {
    client
      .call<{ etat: { travail?: TravailDInstallation | null } }>({ type: 'installation.etat' })
      .then((rendu) => installationEnDirect.reprendre(rendu.etat?.travail))
      .catch(() => undefined);
  }, []);

  return (
    <div
      data-assistant-moteurs="1"
      /*
       * SOUS les tiroirs (`z-50`) et les messages passagers (`z-[100]`), AU-DESSUS
       * de tout le reste : l'écran de travail est bien barré, mais les réglages —
       * le seul endroit qui permet de réparer un compte déjà déclaré — s'ouvrent
       * encore par-dessus.
       */
      className="fixed inset-0 z-[45] flex items-center justify-center bg-bg/95 p-3 backdrop-blur-sm"
    >
      <div className="flex max-h-full w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-xl">
        <header className="shrink-0 border-b border-border px-4 py-3">
          <h1 className="flex items-center gap-1 text-[16px] font-medium text-text">
            {t('Mettons un moteur en place')}
            <BulleInfo cote="start">
              {t('Beluga Build fait travailler des assistants installés sur ce serveur. Il en faut au moins un pour lancer une tâche : choisissez celui que vous préférez, les autres pourront venir plus tard.')}
              {'\n\n'}
              {t('Cet écran se referme tout seul dès qu\'un moteur répond.')}
            </BulleInfo>
          </h1>
        </header>

        <ZoneDefilement className="min-h-0 flex-1 px-4 py-3" fond="hsl(var(--surface))">
          <ListeDesMoteurs />
        </ZoneDefilement>

        <footer className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border px-4 py-2.5">
          <span className="flex-1" />
          {/* LA RÉPARATION RESTE ATTEIGNABLE. Un compte simplement expiré se
              renomme, se coupe ou se rallume depuis les réglages : barrer aussi
              cette porte enfermerait l'utilisateur au lieu de l'aider. */}
          <Button variant="ghost" size="sm" data-assistant-reglages="1" onClick={onOuvrirReglages}>
            <Settings className="h-3 w-3" />
            {t('Ouvrir les réglages')}</Button>
          <BoutonRelireLesMoteurs />
        </footer>
      </div>
    </div>
  );
}

/** Le badge d'un moteur : où il en est, d'un coup d'œil. */
function BadgeEtape({ moteur }: { moteur: MoteurDeLAssistant }) {
  if (moteur.etape === 'pret') return <Badge tone="success">{t('en ligne')}</Badge>;
  if (moteur.etape === 'a-installer') return <Badge tone="neutral">{t('à installer')}</Badge>;
  if (moteur.etape === 'a-reconnecter') return <Badge tone="warning">{t('à reconnecter')}</Badge>;
  return <Badge tone="warning">{t('à connecter')}</Badge>;
}

/**
 * Un moteur et ce qu'il lui manque. Les deux étapes sont TOUJOURS montrées dans
 * l'ordre, celle qui reste à faire ouverte : on ne cache pas l'installation à
 * qui vient de connecter un compte, il doit pouvoir revenir en arrière.
 */
function CarteMoteur({ moteur }: { moteur: MoteurDeLAssistant }) {
  const state = useApp();
  const pret = moteur.etape === 'pret';

  // Les tentatives de connexion NEUVES de ce moteur. La reconnexion d'un compte
  // déjà déclaré se suit à part, sur la ligne de ce compte.
  const neuves = state.connexions.filter((c) => !c.accountId && c.engine === moteur.id);
  const enCours = neuves.find((c) => !connexionTerminee(c));
  const derniere = neuves[neuves.length - 1];

  return (
    <section
      data-moteur={moteur.id}
      data-etape={moteur.etape}
      className={cn(
        'rounded-md border px-3 py-2.5',
        pret ? 'border-transparent bg-raised' : 'border-transparent bg-surface',
      )}
    >
      <div className="flex items-center gap-2">
        <IconeMoteur engine={moteur.id} className="h-4 w-4 text-text" />
        <span className="flex-1 text-[14px] font-medium text-text">{moteur.label}</span>
        <BadgeEtape moteur={moteur} />
      </div>

      <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted">{moteur.libelle}</p>

      {pret ? (
        <p className="mt-1 flex items-center gap-1.5 text-[12.5px] text-success">
          <Check className="h-3 w-3" />
          {t('{n} compte(s) connecté(s).', { n: String(moteur.comptesEnLigne) })}
        </p>
      ) : (
        <div className="mt-2 space-y-2">
          {/* LES DEUX ÉTAPES SONT TOUJOURS LÀ, dans l'ordre. Celle qui est faite
              se replie sur une ligne cochée : on voit d'un coup d'œil ce qui
              reste, sans se demander pourquoi le pas « 2 » n'a pas de « 1 ». */}
          <EtapeInstallation moteur={moteur} />
          <EtapeConnexion moteur={moteur} enCours={enCours} derniere={derniere} />
        </div>
      )}
    </section>
  );
}

/**
 * L'INSTALLATION DE L'OUTIL, D'UN BOUTON. Le démon lance la commande de
 * l'éditeur et montre sa sortie ; une fois l'outil posé, il relit lui-même le
 * catalogue des moteurs, et cette étape se replie sur sa ligne cochée.
 */
function EtapeInstallation({ moteur }: { moteur: MoteurDeLAssistant }) {
  if (moteur.cliInstalle) {
    return (
      <p
        data-etape-installation="faite"
        className="flex items-center gap-1.5 rounded-md border border-border bg-surface px-2 py-1.5 text-[12.5px] text-success"
      >
        <Check className="h-3 w-3 shrink-0" />
        {t('1. Outil installé sur le serveur')}
        {moteur.version ? <span className="truncate text-faint">{moteur.version}</span> : null}
      </p>
    );
  }

  return (
    <div className="space-y-1.5 rounded-md border border-border bg-surface px-2 py-1.5" data-etape-installation="a-faire">
      <p className="flex items-center gap-1.5 text-[12.5px] font-medium text-text">
        <Terminal className="h-3 w-3" />
        {t('1. Installer l\'outil sur le serveur')}
        <BulleInfo cote="start">{t('Beluga Build l’installe lui-même sur ce serveur : vous voyez l’installation se dérouler, et l’étape suivante s’ouvre dès qu’elle est finie.')}</BulleInfo>
      </p>
      <BoutonInstaller genre={moteur.id} />
      <CommandeEnRepli moteur={moteur} />
    </div>
  );
}

/**
 * La commande de l'éditeur, pour qui préfère son terminal — montrée seulement
 * APRÈS un échec de l'installation par bouton.
 */
function CommandeEnRepli({ moteur }: { moteur: MoteurDeLAssistant }) {
  const { travail } = useTravailDuGenre(moteur.id);
  const [copie, setCopie] = React.useState(false);
  if (travail?.etat !== 'echoue') return null;
  const copier = async () => {
    try {
      await navigator.clipboard.writeText(moteur.commandeDInstallation);
      setCopie(true);
      setTimeout(() => setCopie(false), 2000);
    } catch {
      client.pushToast('error', t('copie impossible depuis ce navigateur'));
    }
  };
  return (
    <div className="space-y-1" data-repli-par-commande={moteur.id}>
      <p className="text-[12.5px] leading-relaxed text-muted">
        {t('Vous pouvez aussi la lancer vous-même, dans un terminal du serveur :')}
      </p>
      <div className="flex items-center gap-1.5">
        <code
          data-commande-installation={moteur.id}
          className="min-w-0 flex-1 overflow-x-auto whitespace-pre rounded bg-bg px-2 py-1 font-mono text-[12px] text-text"
        >
          {moteur.commandeDInstallation}
        </code>
        <Button variant="ghost" size="icon-sm" onClick={copier} title={t('Copier la commande')}>
          {copie ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
        </Button>
      </div>
    </div>
  );
}

/**
 * La connexion proprement dite. Claude et Codex ouvrent une page ; Cursor,
 * lui, ne connaît qu'une clé d'accès — les deux gestes n'ont rien en commun et
 * ne se mélangent pas.
 */
function EtapeConnexion({
  moteur,
  enCours,
  derniere,
}: {
  moteur: MoteurDeLAssistant;
  enCours?: ConnexionCompte;
  derniere?: ConnexionCompte;
}) {
  // Rien à connecter tant que l'outil n'est pas là : l'étape s'annonce, grisée,
  // plutôt que de disparaître — on doit voir ce qui vient après.
  const enAttente = !moteur.cliInstalle;

  return (
    <div
      className={cn('rounded-md border border-border bg-surface px-2 py-1.5', enAttente && 'opacity-50')}
      data-etape-connexion={enAttente ? 'en-attente' : 'a-faire'}
    >
      <p className="flex items-center gap-1.5 text-[12.5px] font-medium text-text">
        <LogIn className="h-3 w-3" />
        {moteur.connexionParCle ? t('2. Déclarer une clé d\'accès') : t('2. Connecter un compte')}
      </p>
      {enAttente ? (
        <p className="mt-1 text-[12.5px] leading-relaxed text-faint">
          {t('Cette étape s\'ouvrira une fois l\'outil installé.')}</p>
      ) : (
        <>

      {/* LES COMPTES DÉJÀ DÉCLARÉS D'ABORD : un jeton expiré se refait sur
          place, il n'oblige pas à ouvrir un second compte. */}
      <ComptesAReconnecter moteur={moteur} />

      {moteur.connexionParCle ? (
        <AjouterCle engine={moteur.id} deplie />
      ) : enCours ? (
        <BlocConnexion connexion={enCours} />
      ) : (
        <>
          <Button
            variant="outline"
            size="sm"
            className="mt-1.5"
            data-connecter={moteur.id}
            onClick={() => void client.geste({ type: 'account.connect', engine: moteur.id as EngineId }, t('Connecter un compte'))}
          >
            <LogIn className="h-3 w-3" />
            {t('Connecter un compte')}</Button>
          {derniere && connexionTerminee(derniere) ? <BlocConnexion connexion={derniere} /> : null}
        </>
      )}
        </>
      )}
    </div>
  );
}

/**
 * Les comptes de ce moteur dont la connexion ne tient plus. Chacun porte son
 * bouton « Reconnecter » : la même commande que dans les réglages, avec
 * l'identifiant du compte — le coffre existant est réemployé, aucun compte
 * neuf n'est créé.
 */
function ComptesAReconnecter({ moteur }: { moteur: MoteurDeLAssistant }) {
  const state = useApp();
  const comptes = state.quotas.filter(
    (q) => q.engine === moteur.id && !q.disabled && q.connexion?.doitReconnecter,
  );
  if (!comptes.length) return null;

  return (
    <div className="mt-1.5 space-y-1">
      {comptes.map((compte) => {
        const enCours = state.connexions.find((c) => !connexionTerminee(c) && c.accountId === compte.id);
        return (
          <div key={compte.id} className="rounded-md border border-border bg-bg px-2 py-1.5">
            <div className="flex items-center gap-1.5">
              <span className="flex-1 truncate text-[13px] text-text">{compte.label}</span>
              <span className="text-[12px] text-warning">{compte.connexion?.libelle}</span>
              {enCours ? null : (
                <Button
                  variant="outline"
                  size="sm"
                  data-reconnecter={compte.id}
                  onClick={() =>
                    void client.geste(
                      { type: 'account.connect', engine: moteur.id as EngineId, accountId: compte.id },
                      t('Reconnecter'),
                    )
                  }
                >
                  <LogIn className="h-3 w-3" />
                  {t('Reconnecter')}</Button>
              )}
            </div>
            {enCours ? <BlocConnexion connexion={enCours} /> : null}
          </div>
        );
      })}
    </div>
  );
}
