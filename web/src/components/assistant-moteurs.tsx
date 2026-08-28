import * as React from 'react';
import { Check, Copy, Loader2, LogIn, RefreshCw, Terminal } from 'lucide-react';
import {
  ConnexionCompte,
  EngineId,
  MoteurDeLAssistant,
  connexionTerminee,
  moteursDeLAssistant,
} from '@haikodev/shared';
import { Badge, Button, ZoneDefilement } from '@/components/ui';
import { AjouterCleCursor, BlocConnexion } from '@/components/connexion-compte';
import { IconeMoteur } from '@/components/icone-moteur';
import { client } from '@/lib/client';
import { useApp } from '@/lib/use-app';
import { cn } from '@/lib/utils';
import { t } from '@/lib/langue';

/*
 * L'ASSISTANT DE DÉMARRAGE — au moins un moteur avant d'entrer.
 *
 * HaikoDev fait travailler des moteurs en ligne de commande installés SUR LE
 * SERVEUR. Sans un seul d'entre eux, l'application s'ouvre normalement mais
 * chaque carte lancée retombe aussitôt : le tableau semble marcher, le travail
 * ne part jamais. Cet écran barre donc la route tant que la règle pure
 * `auMoinsUnMoteurEnLigne` (`shared/src/assistant-moteurs.ts`) répond non, et
 * s'efface tout seul dès qu'elle répond oui — aucun bouton « continuer », rien
 * à cliquer pour sortir.
 *
 * DEUX GESTES, ET PAS UN DE PLUS, par moteur :
 *  1. INSTALLER l'outil : la commande de l'éditeur, à coller dans un terminal
 *     du serveur. Elle n'est PAS lancée d'ici — le démon ne tourne pas sous le
 *     compte système qui doit recevoir l'outil, et un installateur parti en
 *     aveugle poserait le binaire là où personne ne le cherchera ;
 *  2. CONNECTER un compte : exactement la mécanique des réglages
 *     (`connexion-compte.tsx`), page de connexion pour Claude et Codex, clé
 *     d'accès pour Cursor.
 */

export function AssistantMoteurs() {
  const state = useApp();
  const moteurs = moteursDeLAssistant(state.engines, state.quotas);
  const [relecture, setRelecture] = React.useState(false);

  // Les connexions déjà suivies par le serveur : sans cette demande, une
  // tentative lancée depuis un autre appareil serait invisible ici.
  React.useEffect(() => {
    client
      .call<{ connexions: ConnexionCompte[] }>({ type: 'account.connections' })
      .then((data) => client.reprendreConnexions(data.connexions ?? []))
      .catch(() => undefined);
  }, []);

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
    <div
      data-assistant-moteurs="1"
      className="fixed inset-0 z-[120] flex items-center justify-center bg-bg/95 p-3 backdrop-blur-sm"
    >
      <div className="flex max-h-full w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-xl">
        <header className="shrink-0 border-b border-border px-4 py-3">
          <h1 className="text-[16px] font-medium text-text">{t('Mettons un moteur en place')}</h1>
          <p className="mt-1 text-[13px] leading-relaxed text-muted">
            {t('HaikoDev fait travailler des assistants installés sur ce serveur. Il en faut au moins un pour lancer une tâche : choisissez celui que vous préférez, les autres pourront venir plus tard.')}</p>
        </header>

        <ZoneDefilement className="min-h-0 flex-1 px-4 py-3" fond="hsl(var(--surface))">
          <div className="space-y-2">
            {moteurs.map((moteur) => (
              <CarteMoteur key={moteur.id} moteur={moteur} />
            ))}
          </div>
        </ZoneDefilement>

        <footer className="flex shrink-0 items-center gap-2 border-t border-border px-4 py-2.5">
          <p className="flex-1 text-[12.5px] leading-relaxed text-faint">
            {t('Cet écran se referme tout seul dès qu\'un moteur répond.')}</p>
          <Button variant="outline" size="sm" data-assistant-relire="1" disabled={relecture} onClick={relire}>
            {relecture ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
            {t('Vérifier à nouveau')}</Button>
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

  // Les tentatives de connexion NEUVES de ce moteur (jamais une reconnexion de
  // compte existante, qui se suit depuis les réglages).
  const neuves = state.connexions.filter((c) => !c.accountId && c.engine === moteur.id);
  const enCours = neuves.find((c) => !connexionTerminee(c));
  const derniere = neuves[neuves.length - 1];

  return (
    <section
      data-moteur={moteur.id}
      data-etape={moteur.etape}
      className={cn(
        'rounded-md border px-3 py-2.5',
        pret ? 'border-success/40 bg-success/5' : 'border-border bg-bg',
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
          {moteur.cliInstalle ? null : <EtapeInstallation moteur={moteur} />}
          {moteur.cliInstalle ? (
            <EtapeConnexion moteur={moteur} enCours={enCours} derniere={derniere} />
          ) : null}
        </div>
      )}
    </section>
  );
}

/**
 * La commande d'installation, à copier puis à coller dans un terminal du
 * serveur. Elle est écrite en toutes lettres : rien ne s'exécute d'ici.
 */
function EtapeInstallation({ moteur }: { moteur: MoteurDeLAssistant }) {
  const [copie, setCopie] = React.useState(false);

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
    <div className="rounded-md border border-border bg-surface px-2 py-1.5">
      <p className="flex items-center gap-1.5 text-[12.5px] font-medium text-text">
        <Terminal className="h-3 w-3" />
        {t('1. Installer l\'outil sur le serveur')}
      </p>
      <div className="mt-1 flex items-center gap-1.5">
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
      <p className="mt-1 text-[12.5px] leading-relaxed text-faint">
        {t('À coller dans un terminal du serveur, puis revenez ici et cliquez sur « Vérifier à nouveau ».')}</p>
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
  return (
    <div className="rounded-md border border-border bg-surface px-2 py-1.5">
      <p className="flex items-center gap-1.5 text-[12.5px] font-medium text-text">
        <LogIn className="h-3 w-3" />
        {moteur.connexionParCle ? t('2. Déclarer une clé d\'accès') : t('2. Connecter un compte')}
      </p>

      {moteur.connexionParCle ? (
        <AjouterCleCursor deplie />
      ) : enCours ? (
        <BlocConnexion connexion={enCours} />
      ) : (
        <>
          <Button
            variant="outline"
            size="sm"
            className="mt-1.5"
            data-connecter={moteur.id}
            onClick={() => client.send({ type: 'account.connect', engine: moteur.id as EngineId })}
          >
            <LogIn className="h-3 w-3" />
            {t('Connecter un compte')}</Button>
          {derniere && connexionTerminee(derniere) ? <BlocConnexion connexion={derniere} /> : null}
        </>
      )}
    </div>
  );
}
