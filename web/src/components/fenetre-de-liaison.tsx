import * as React from 'react';
import {
  jetonDeLiaisonDansLAdresse,
  ordinateurReconnu,
  PARAMETRE_DE_LIAISON,
  programmeEnLigne,
  type EtatDeLExtension,
  type SystemeDOrdinateur,
} from '@beluga/shared';
import { Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui';
import { Laptop, Loader2 } from '@/components/ui/icones';
import { naviguerVers } from '@/components/ui/lien-interne';
import { client } from '@/lib/client';
import { t } from '@/lib/langue';

/**
 * « RELIER CE MAC ? » — LA FENÊTRE QUI RELIE UN ORDINATEUR D'UN CLIC (décision de l'utilisateur, 21/11/2026, carte
 * « Dépannage de publication discret », maquette #fbd2).
 *
 * Beluga Connect ouvre Beluga sur `/?liaison=<jeton>` — sans écran derrière, que la fenêtre des réglages couvrirait —
 * (`jetonDeLiaisonDansLAdresse`) : la page lit
 * la demande (le nom réel de l'ordinateur), la personne connectée clique « Relier », et l'application, qui attendait
 * de son côté, reçoit sa clé — sans code, sans fenêtre de Chrome. « Pas maintenant » refuse : l'application le sait.
 * Le jeton est retiré de l'adresse dès sa lecture (et gardé le temps d'une connexion, si la session manquait).
 *
 * PLUS JAMAIS DE PAGE OUVERTE PAR BELUGA CONNECT (22/11/2026, carte « Beluga Connect : liaison et suivi ») : quand le
 * code du téléchargement ne suffit plus, l'application envoie sa demande AVEC ce code ; le démon la pousse aux onglets
 * déjà ouverts du compte (`relaisMac.demande`), et un onglet ouvert après coup la reprend (`relaisMac.liaison.enAttente`).
 * L'adresse `/?liaison=` ne sert plus qu'au clic « Ouvrir Beluga » de l'application, quand aucun onglet n'était ouvert.
 */
const CLE_DE_SESSION = 'beluga:demande-de-liaison';

type DemandeLue = { jeton: string; nom: string; systeme: SystemeDOrdinateur };

function jetonEnAttente(): string | null {
  const dansLAdresse = jetonDeLiaisonDansLAdresse(window.location.search);
  if (dansLAdresse) {
    try {
      sessionStorage.setItem(CLE_DE_SESSION, dansLAdresse);
    } catch {
      /* stockage fermé : la lecture se fait tout de suite */
    }
    const url = new URL(window.location.href);
    url.searchParams.delete(PARAMETRE_DE_LIAISON);
    window.history.replaceState(window.history.state, '', url.toString());
    return dansLAdresse;
  }
  try {
    return sessionStorage.getItem(CLE_DE_SESSION);
  } catch {
    return null;
  }
}

function oublierLeJeton(): void {
  try {
    sessionStorage.removeItem(CLE_DE_SESSION);
  } catch {
    /* rien */
  }
}

/** Ce que l'appareil est, en toutes lettres. */
function libelleDuSysteme(systeme: SystemeDOrdinateur): string {
  return systeme === 'mac' ? t('ce Mac') : systeme === 'windows' ? t('ce PC') : t('cet ordinateur');
}

export function FenetreDeLiaison() {
  const [demande, setDemande] = React.useState<DemandeLue | null>(null);
  const [envoi, setEnvoi] = React.useState<'relier' | 'refuser' | null>(null);

  /* Poussée par Beluga Connect à l'onglet déjà ouvert, ou en attente à l'ouverture de l'onglet. */
  React.useEffect(() => {
    let vivant = true;
    const montrer = (d: DemandeLue) => setDemande((avant) => avant ?? d);
    const lacher = client.onDemandeDeLiaison(montrer);
    void client
      .call<{ demandes: DemandeLue[] }>({ type: 'relaisMac.liaison.enAttente' })
      .then((r) => {
        if (vivant && r.demandes?.[0]) montrer(r.demandes[0]);
      })
      .catch(() => undefined);
    return () => {
      vivant = false;
      lacher();
    };
  }, []);

  React.useEffect(() => {
    const jeton = jetonEnAttente();
    if (!jeton) return;
    let vivant = true;
    void client
      .call<{ demande: { nom: string; systeme: SystemeDOrdinateur } | null }>({ type: 'relaisMac.liaison.lire', jeton })
      .then((r) => {
        if (!vivant) return;
        if (!r.demande) {
          oublierLeJeton();
          client.pushToast('error', t('Cette demande de liaison a expiré : rouvrez Beluga Connect sur l’ordinateur.'));
          return;
        }
        setDemande({ jeton, ...r.demande });
      })
      .catch(() => undefined);
    return () => {
      vivant = false;
    };
  }, []);

  if (!demande) return null;

  const fermer = () => {
    oublierLeJeton();
    setDemande(null);
  };
  const relier = async () => {
    if (envoi) return;
    setEnvoi('relier');
    try {
      /* L'ordinateur de CE navigateur, s'il n'a pas encore de programme qui répond : la liaison s'y rattache. */
      let ordinateurId: string | undefined;
      const navigateurId = document.documentElement.dataset.belugaNavigateur || null;
      if (navigateurId) {
        const etat = await client.call<EtatDeLExtension>({ type: 'extension.etat' }).catch(() => null);
        const ici = etat ? ordinateurReconnu(etat.ordinateurs, { navigateurId }) : null;
        if (ici && !programmeEnLigne(ici.programme)) ordinateurId = ici.id;
      }
      const r = await client.call<{ ok: boolean; nom: string }>({ type: 'relaisMac.liaison.accepter', jeton: demande.jeton, ordinateurId });
      client.pushToast('success', t('« {nom} » est relié à Beluga.', { nom: r.nom }));
      fermer();
      /* Puis la page des ordinateurs, où la suite (autorisations, Chrome) se coche d'elle-même. */
      naviguerVers('#reglages/ordinateurs');
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('Le geste n’a pas abouti.'));
      fermer();
    } finally {
      setEnvoi(null);
    }
  };
  const refuser = async () => {
    if (envoi) return;
    setEnvoi('refuser');
    await client.call({ type: 'relaisMac.liaison.refuser', jeton: demande.jeton }).catch(() => undefined);
    setEnvoi(null);
    fermer();
  };

  return (
    <Dialog open onOpenChange={(ouvert) => (!ouvert ? void refuser() : undefined)}>
      <DialogContent data-fenetre-de-liaison className="sm:max-w-[440px]" onOpenAutoFocus={(event) => event.preventDefault()}>
        <DialogHeader>
          <DialogTitle>{t('Relier un ordinateur')}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col items-center gap-2.5 pb-2 text-center">
          <span className="flex size-14 items-center justify-center rounded-2xl bg-surface text-text">
            <Laptop className="h-7 w-7" />
          </span>
          <p className="text-[17px] font-semibold text-text" data-nom-a-relier>
            {t('Relier « {nom} » à Beluga ?', { nom: demande.nom })}
          </p>
          <p className="max-w-[24rem] text-[13.5px] leading-relaxed text-muted">
            {t('Beluga Connect est lancé sur {appareil} et demande à se relier à votre compte. Les agents pourront ensuite y ouvrir Chrome et y travailler, selon les droits que vous lui donnez.', {
              appareil: libelleDuSysteme(demande.systeme),
            })}
          </p>
        </div>
        <DialogFooter>
          <Button variant="ghost" size="md" onClick={() => void refuser()} disabled={!!envoi} data-refuser-la-liaison>
            {envoi === 'refuser' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            {t('Pas maintenant')}
          </Button>
          <Button variant="default" size="md" onClick={() => void relier()} disabled={!!envoi} data-accepter-la-liaison>
            {envoi === 'relier' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            {t('Relier')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
