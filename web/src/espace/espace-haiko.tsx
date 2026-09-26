/**
 * L'ESPACE CLIENT, VU COMME HAIKO.
 *
 * Le client choisi en tête, son espace en dessous : le MÊME écran que le sien,
 * aux deux gestes près qui n'appartiennent qu'à vous — déplacer une demande
 * d'une colonne à l'autre, et la transformer en carte Beluga. Vos messages et
 * vos commentaires sont signés de votre nom.
 *
 * LE CLIENT SE CHOISIT DANS LE TIROIR, SUR LES DEUX ÉCRANS. La colonne de
 * 224 px qui listait les clients à gauche a disparu : elle mangeait un sixième
 * d'un écran d'ordinateur et plus de la moitié d'un téléphone, pour un choix
 * qu'on fait quelques fois par jour. C'est désormais le SÉLECTEUR À TIROIR
 * cherchable — le même composant que le choix du projet, la même recherche à la
 * frappe, le même geste à apprendre — et le tableau des demandes récupère toute
 * la largeur, partout.
 *
 * CE QUE LA COLONNE APPORTAIT NE SE PERD PAS : les messages non lus des AUTRES
 * clients sont comptés sur le bouton du sélecteur, et repris client par client
 * dans le tiroir — projets du client compris.
 *
 * UN CLIENT S'AJOUTE DEPUIS CE TIROIR. Il fallait quitter la Messagerie pour la
 * page « Accès clients » des réglages, puis revenir le chercher. Le pied du
 * tiroir porte maintenant « Ajouter un client » : le formulaire des réglages,
 * le mot de passe montré une fois, la case qui l'envoie par courriel — et le
 * client créé est aussitôt sélectionné.
 *
 * ET CET ÉCRAN N'A PLUS D'ENTÊTE À LUI. Le sélecteur descend DANS l'entête de
 * l'espace (`enteteAvant`), et le rang des projets disparaît.
 *
 * Ce fichier est chargé À LA DEMANDE : un écran qu'on n'ouvre pas ne se
 * télécharge pas.
 */
import * as React from 'react';
import { ArrowLeft, ChevronDown, Settings, UserPlus, UserRound, X } from 'lucide-react';
import { BulleInfo, Button, DialogTitle, Drawer, EmptyState, Pastille, SelecteurTiroir, ZoneDefilement } from '@/components/ui';
import { SilhouetteEspaceHaiko } from '@/components/silhouettes';
import { PastillesMessagerie } from '@/components/pastilles-messagerie';
import { client } from '@/lib/client';
import { t } from '@/lib/langue';
import { useTelephone } from '@/lib/telephone';
import type { DemandeAffichee } from '@beluga/shared';
import {
  FormulaireCompteClient,
  GestionComptesClients,
  MotDePasseMontre,
  type SecretMontre,
} from '@/components/reglages/comptes-clients';
import { RunSelectors, type RunChoix } from '@/components/run-selectors';
import { useApp } from '@/lib/use-app';
import { canalEspace } from './canal-espace';
import { EspaceClient, type MoiDansLEspace } from './espace-client';
import { AccueilMessagerie, type PeriodeDuTableau } from './accueil-messagerie';
import { usePref } from '@/lib/prefs';
import { PERIODE_PAR_DEFAUT_JOURS, bornesDeLEchelle, joursDeLaPeriode, type FicheClientTableau } from '@beluga/shared';

interface ClientVu {
  id: string;
  identifiant: string;
  nomAffiche: string;
  actif: boolean;
  derniereEntree?: number;
  projets: { id: string; nom: string }[];
  fil: { filId: string; nonLus: number; dernier?: number };
  /** Les deux compteurs de la Messagerie, calculés au serveur pour CE client. */
  compteurs: { nonLu: number; aTraiter: number };
  demandes: DemandeAffichee[];
}

export function EspaceHaiko({
  vise,
  onVise,
}: {
  vise?: { clientId?: string; demandeId?: string };
  /** LE CLIENT AFFICHÉ REMONTE DANS L'ADRESSE : « #espace/<client> ». La
   *  demande ouverte, elle, reste celle que l'adresse a posée — c'est un
   *  détail d'affichage DANS la messagerie (`memeEcran`). */
  onVise?: (vise: { clientId?: string; demandeId?: string } | undefined) => void;
} = {}) {
  const [moi, setMoi] = React.useState<{ id: string; nomAffiche: string }>({ id: 'haiko', nomAffiche: 'Haiko' });
  const [clients, setClients] = React.useState<ClientVu[] | null>(null);
  const [choisi, setChoisi] = React.useState<string | null>(null);
  /** Le tiroir « Ajouter un client », et le mot de passe du compte qu'il vient de créer. */
  const [creation, setCreation] = React.useState(false);
  const [secret, setSecret] = React.useState<SecretMontre | null>(null);
  const [gestionAcces, setGestionAcces] = React.useState(false);
  /** Le client à sélectionner dès que la liste rechargée le contient. */
  const aChoisir = React.useRef<string | null>(null);
  /*
   * Le seuil est celui de toute la maison — 640 px. Il ne décide plus ni du
   * CHOIX du client (le tiroir sert partout) ni de la place des projets (il
   * n'y a plus qu'un rang) : il ne sert plus qu'à dire, dans un repère, quel
   * écran est monté.
   */
  const telephone = useTelephone();
  /* Les moteurs installés et les comptes connus : le bloc de réglages les lit. */
  const etat = useApp();

  /*
   * LA CIBLE LUE À L'ARRIVÉE DE LA RÉPONSE, PAS AU DÉPART DE LA DEMANDE. Ouvrir
   * une conversation marque ses messages lus, ce qui relance ce chargement ;
   * revenir à l'accueil juste après laissait une réponse en vol, partie quand
   * l'adresse désignait encore ce client, qui le rouvrait aussitôt.
   */
  const viseCourant = React.useRef(vise);
  viseCourant.current = vise;

  const recharger = React.useCallback(() => {
    void canalEspace
      .demander({ type: 'espace.clients' })
      .then((reponse: { clients: ClientVu[] }) => {
        setClients(reponse.clients);
        /*
         * L'ADRESSE COMMANDE LE CLIENT AFFICHÉ quand elle en désigne un —
         * c'est le lien du point quotidien, qui doit tomber sur la bonne
         * personne. Un client QU'ON VIENT DE CRÉER passe encore avant : on l'a
         * ajouté pour le voir. Sinon on garde celui qu'on regardait déjà.
         */
        const cree = aChoisir.current && reponse.clients.some((c) => c.id === aChoisir.current) ? aChoisir.current : null;
        aChoisir.current = null;
        const cible = viseCourant.current?.clientId;
        const voulu = cible && reponse.clients.some((c) => c.id === cible) ? cible : null;
        /*
         * OUVRIR LA MESSAGERIE, C'EST ARRIVER SUR LA VUE D'ENSEMBLE.
         *
         * Le premier client de la liste était sélectionné d'office : on
         * tombait dans une conversation sans savoir si c'était celle qui
         * attendait quelque chose. `null` = l'accueil. Une notification qui
         * DÉSIGNE un client (`vise`) continue de court-circuiter cet accueil,
         * et un client qu'on vient de créer s'ouvre comme avant : on l'a
         * ajouté pour le voir.
         */
        setChoisi((actuel) => cree ?? voulu ?? actuel);
      })
      .catch(() => {
        /*
         * UN CANAL PAS ENCORE OUVERT N'EST PAS UNE LISTE VIDE. `demander`
         * refuse tout net avant la connexion : poser `[]` affichait « Aucun
         * client pour l'instant » pendant le chargement — un vide annoncé à
         * tort. On garde la silhouette : le passage « en ligne » relance la
         * demande (voir plus bas). Seul un vrai refus, canal ouvert, vide
         * l'écran — sans effacer une liste déjà reçue.
         */
        if (canalEspace.etat() !== 'en-ligne') return;
        setClients((avant) => avant ?? []);
      });
  }, [vise?.clientId]);

  /* Le client choisi est une destination : l'adresse le suit, pour qu'un
     rechargement rouvre la même conversation. */
  const remonter = React.useRef(onVise);
  remonter.current = onVise;
  React.useEffect(() => {
    /* TANT QUE LA LISTE N'EST PAS LÀ, L'ÉCRAN N'A RIEN À DIRE — et tant que le
       client désigné par l'adresse n'est pas affiché, le dire effacerait la
       cible avant de l'avoir ouverte. */
    if (!clients) return;
    if (!choisi && vise?.clientId && clients.some((c) => c.id === vise.clientId)) return;
    remonter.current?.(
      choisi
        ? {
            clientId: choisi,
            ...(vise?.clientId === choisi && vise.demandeId ? { demandeId: vise.demandeId } : {}),
          }
        : undefined,
    );
  }, [choisi, clients]);

  React.useEffect(() => {
    canalEspace.ouvrir();
    recharger();
    // Qui suis-je, vraiment ? Le nom affiché signe les messages et les
    // commentaires : il vient du compte, jamais d'un mot écrit en dur.
    void fetch('/api/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((corps) => {
        if (corps?.user) setMoi({ id: corps.user, nomAffiche: corps.nomAffiche || corps.user });
      })
      .catch(() => undefined);
  }, [recharger]);

  /*
   * LES CHIFFRES DE L'ACCUEIL, EN UN SEUL APPEL. Ils ne se demandent que
   * lorsqu'on regarde l'accueil : entrer dans une conversation n'a aucune
   * raison de recalculer les statistiques de tous les clients.
   */
  const [fiches, setFiches] = React.useState<FicheClientTableau[] | null>(null);
  const [periode, setPeriode] = React.useState<PeriodeDuTableau | null>(null);
  /*
   * LA PÉRIODE CHOISIE SURVIT À LA VISITE. Elle vit dans les réglages, comme le
   * thème : on retrouve sa vue habituelle en rouvrant la Messagerie, sur
   * l'ordinateur comme sur le téléphone. `jours` porte une échelle toute prête,
   * `debut`/`fin` un choix de dates ; les deux ne coexistent jamais.
   */
  const [choixPeriode, setChoixPeriode] = usePref<{ jours?: number; debut?: number; fin?: number }>(
    'messagerie.periode',
    { jours: PERIODE_PAR_DEFAUT_JOURS },
  );
  const echelle = choixPeriode.jours ?? null;

  const relireLesChiffres = React.useCallback(() => {
    /* Une échelle se recalcule À CHAQUE APPEL : « les 30 derniers jours » lus
       hier ne sont pas ceux d'aujourd'hui, et une borne figée en réglage
       vieillirait en silence. */
    const bornes = choixPeriode.jours
      ? bornesDeLEchelle(choixPeriode.jours, Date.now())
      : { debut: choixPeriode.debut, fin: choixPeriode.fin };
    void canalEspace
      .demander({ type: 'espace.tableauDeBord', debut: bornes.debut, fin: bornes.fin })
      .then((reponse: { fiches: FicheClientTableau[]; debut: number; fin: number; jours: number }) => {
        setFiches(reponse.fiches);
        // C'est la période RENDUE qui fait foi : le serveur a pu la ramener
        // sous son plafond, et le graphique doit dire ce qu'il montre.
        setPeriode({ debut: reponse.debut, fin: reponse.fin, jours: reponse.jours });
      })
      .catch(() => {
        /*
         * UN REFUS NE LAISSE PAS L'ÉCRAN EN SILHOUETTE. Sans période, l'accueil
         * reste sur son squelette sans fin : on retient les bornes DEMANDÉES,
         * l'écran s'affiche vide et se lit — la relance au retour du canal
         * remplira les chiffres.
         */
        setFiches([]);
        setPeriode(
          bornes.debut && bornes.fin
            ? { debut: bornes.debut, fin: bornes.fin, jours: joursDeLaPeriode(bornes.debut, bornes.fin).length }
            : null,
        );
      });
  }, [choixPeriode.jours, choixPeriode.debut, choixPeriode.fin]);
  React.useEffect(() => {
    if (choisi !== null) return;
    setFiches(null);
    relireLesChiffres();
    /*
     * ET ON REDEMANDE DÈS QUE LE CANAL RÉPOND. `demander` refuse tout net
     * quand le canal n'est pas encore ouvert : au tout premier affichage,
     * l'appel partait avant la connexion, échouait, et l'accueil restait sur
     * sa silhouette POUR TOUJOURS — aucune erreur, aucun chiffre, un écran
     * gris qu'aucun geste ne débloquait. On refait donc la demande à chaque
     * passage « en ligne », exactement comme la liste des clients.
     */
    return canalEspace.surChangementDEtat((etat) => {
      if (etat === 'en-ligne') relireLesChiffres();
    });
  }, [choisi, relireLesChiffres]);

  /*
   * PAR OÙ L'ON ENTRE CHEZ UN CLIENT. Toucher sa fiche sur l'accueil ouvre le
   * tableau de ses demandes, SANS le volet de discussion par-dessus : la
   * discussion reste à un toucher, sur sa bulle. Seuls une notification ou une
   * adresse `…/discussion` l'ouvrent d'office (`allerVers` de l'espace client).
   * Le numéro change à chaque clic, sinon deux entrées de suite au même
   * endroit ne feraient rien la seconde fois.
   */
  const [arrivee, setArrivee] = React.useState(0);
  /*
   * REVENIR À L'ACCUEIL EFFACE AUSSI LA CIBLE DE L'ADRESSE. Sans quoi
   * « #espace/<client> » restait posé — l'adresse ne s'efface pas d'elle-même
   * tant qu'elle désigne un client connu — et le premier rechargement venu
   * (la lecture des messages en déclenche un) rouvrait ce client : la flèche
   * semblait ne rien faire.
   */
  const revenirALAccueil = React.useCallback(() => {
    viseCourant.current = undefined;
    setChoisi(null);
    remonter.current?.(undefined);
  }, []);

  const ouvrirClient = React.useCallback((clientId: string) => {
    setArrivee((avant) => avant + 1);
    setChoisi(clientId);
  }, []);

  React.useEffect(() => canalEspace.surChangementDEtat((etat) => etat === 'en-ligne' && recharger()), [recharger]);
  /*
   * LES CHIFFRES DU TIROIR SUIVENT L'ACTIVITÉ. `espace.compteurs` est émis à
   * chaque geste qui bouge les compteurs — lecture d'une fiche, commentaire,
   * message, mise en carte, archivage : il ne porte que le TOTAL de
   * l'administrateur, il sert donc de déclencheur et c'est `espace.clients`
   * qui redonne le détail par client.
   *
   * UN MÊME GESTE ÉMET PLUSIEURS ÉVÉNEMENTS : on regroupe les rechargements
   * dans le même court instant, pour ne pas relire les demandes de tous les
   * clients trois fois de suite.
   */
  React.useEffect(() => {
    let minuteur: number | undefined;
    const arret = canalEspace.ecouter((event) => {
      if (event.type !== 'espace.demande' && event.type !== 'espace.fil' && event.type !== 'espace.compteurs') return;
      if (minuteur !== undefined) return;
      minuteur = window.setTimeout(() => {
        minuteur = undefined;
        recharger();
      }, 80);
    });
    return () => {
      if (minuteur !== undefined) window.clearTimeout(minuteur);
      arret();
    };
  }, [recharger]);

  /*
   * TRANSFORMER UNE DEMANDE EN TÂCHE OUVRE D'ABORD SES RÉGLAGES.
   *
   * La conversion partait d'un clic, sans rien demander : la tâche naissait
   * avec les valeurs par défaut du projet, et il fallait rouvrir la carte pour
   * corriger le moteur ou le modèle. Un panneau s'intercale désormais — le
   * MÊME bloc de réglages que le panneau d'une tâche du tableau — et rappelle
   * chez quel client et dans quel projet la tâche va naître. Les choix
   * accompagnent la conversion et ne sont jamais réécrits ensuite.
   */
  const [conversion, setConversion] = React.useState<string | null>(null);
  const [choixDExecution, setChoixDExecution] = React.useState<RunChoix>({});
  const [conversionEnCours, setConversionEnCours] = React.useState(false);

  const transformerEnCarte = React.useCallback((demandeId: string) => {
    setChoixDExecution({});
    setConversion(demandeId);
  }, []);

  const lancerLaConversion = React.useCallback(
    (demandeId: string, run: RunChoix) => {
      setConversionEnCours(true);
      void canalEspace
        .demander({ type: 'espace.demande.enCarte', id: demandeId, run })
        .then(() => {
          client.pushToast(
            'success',
            t('Tâche créée dans « Planifié » : un agent lit la discussion et la rédige.'),
          );
          setConversion(null);
          recharger();
        })
        .catch((err) => client.pushToast('error', err?.message ?? t('La carte n’a pas pu être créée.')))
        .finally(() => setConversionEnCours(false));
    },
    [recharger],
  );

  /*
   * LES COMPTES DU CLIENT SE GÈRENT DEPUIS SON ESPACE. Le burger ouvre la même
   * gestion que la page des réglages, filtrée sur le projet affiché : ouvrir,
   * borner, suspendre, retirer, régénérer — sans quitter la Messagerie.
   */
  const gestesHaiko = React.useMemo(
    () => ({
      onCarte: transformerEnCarte,
      comptesDuClient: (projectId: string) => <GestionComptesClients projectId={projectId} nu />,
    }),
    [transformerEnCarte],
  );

  if (clients === null) {
    return <SilhouetteEspaceHaiko />;
  }

  /** Le bouton du pied, le même dans le tiroir et sur l'écran vide. */
  const boutonAjouter = (avant?: () => void) => (
    <Button
      size="pied"
      onClick={() => {
        avant?.();
        setSecret(null);
        setCreation(true);
      }}
      data-ajouter-client
    >
      <UserPlus className="h-4 w-4" />
      {t('Ajouter un client')}
    </Button>
  );

  /*
   * LE TIROIR DE CRÉATION. Le mot de passe s'y montre une fois, avec ce qu'est
   * devenu le courriel s'il a été demandé ; le tiroir reste ouvert tant qu'on
   * ne l'a pas noté, et le client est déjà sélectionné derrière.
   */
  const tiroirDeCreation = (
    <Drawer open={creation} onClose={() => setCreation(false)} className="max-h-[85dvh]">
      <div className="flex min-h-0 flex-1 flex-col" data-tiroir-ajout-client>
        <header className="flex shrink-0 items-center gap-1.5 px-3 pb-2">
          <DialogTitle className="min-w-0 flex-1 truncate">{t('Ajouter un client')}</DialogTitle>
          <Button size="icon-sm" variant="ghost" onClick={() => setCreation(false)} title={t('Fermer')}>
            <X className="h-4 w-4" />
          </Button>
        </header>
        <ZoneDefilement fond="hsl(var(--surface))" className="min-h-0 flex-1 space-y-3 px-3 pb-3">
          {secret ? (
            <MotDePasseMontre
              secret={secret}
              onFermer={() => {
                setSecret(null);
                setCreation(false);
              }}
            />
          ) : (
            <FormulaireCompteClient
              nu
              onCree={({ compte, secret: neuf }) => {
                setSecret(neuf);
                aChoisir.current = compte.id;
                recharger();
              }}
            />
          )}
        </ZoneDefilement>
      </div>
    </Drawer>
  );

  /*
   * LES ACCÈS CLIENTS VIVENT ICI, PLUS DANS LES RÉGLAGES. L'engrenage posé à
   * droite du titre « Clients » ouvre la gestion entière — créer, borner les
   * projets, envoyer les identifiants, régénérer, suspendre, retirer —, la même
   * que la page des réglages montrait, par-dessus le tiroir de choix. La
   * refermer relit la liste : un accès créé ou retiré s'y voit aussitôt.
   */
  const boutonGestionAcces = (
    <Button
      size="icon-sm"
      variant="ghost"
      onClick={() => setGestionAcces(true)}
      title={t('Accès clients')}
      aria-label="Acces clients"
      data-reglages-clients
    >
      <Settings className="h-4 w-4" />
    </Button>
  );

  const tiroirGestionAcces = (
    <Drawer
      open={gestionAcces}
      onClose={() => {
        setGestionAcces(false);
        recharger();
      }}
      empile
      hauteurFixe
    >
      <div className="flex min-h-0 flex-1 flex-col" data-tiroir-acces-clients>
        <header className="flex shrink-0 items-center gap-1.5 px-3 pb-2">
          <DialogTitle className="min-w-0 flex-1 truncate">{t('Accès clients')}</DialogTitle>
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={() => {
              setGestionAcces(false);
              recharger();
            }}
            title={t('Fermer')}
          >
            <X className="h-4 w-4" />
          </Button>
        </header>
        <ZoneDefilement fond="hsl(var(--surface))" className="min-h-0 flex-1 px-3 pb-3">
          <GestionComptesClients actif={gestionAcces} nu />
        </ZoneDefilement>
      </div>
    </Drawer>
  );

  if (!clients.length) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6" data-espace-haiko data-aucun-client>
        <EmptyState
          icon={<UserRound className="h-5 w-5" />}
          title={t('Aucun client pour l’instant')}
          hint={t('Ajoutez votre premier client : il reçoit un accès à son espace.')}
        />
        <div className="flex w-full max-w-[280px] items-center gap-1.5">
          {boutonAjouter()}
          {boutonGestionAcces}
        </div>
        {tiroirDeCreation}
        {tiroirGestionAcces}
      </div>
    );
  }

  /*
   * AUCUN CLIENT OUVERT = LA VUE D'ENSEMBLE. C'est l'état d'arrivée de la
   * Messagerie ; un clic sur une fiche entre dans la conversation, et la flèche
   * posée à gauche du nom du projet ramène ici.
   */
  if (choisi === null) {
    return (
      <div className="flex h-full min-h-0 flex-col" data-espace-haiko data-vue-accueil>
        <AccueilMessagerie
          fiches={fiches}
          periode={periode}
          echelle={echelle}
          onEchelle={(jours) => setChoixPeriode({ jours })}
          onPeriodeLibre={(debut, fin) => setChoixPeriode({ debut, fin })}
          onOuvrirClient={ouvrirClient}
        />
        {tiroirDeCreation}
        {tiroirGestionAcces}
      </div>
    );
  }

  const client_ = clients.find((c) => c.id === choisi) ?? clients[0]!;
  const projetDuClient = client_.projets[0]?.id ?? '';

  /** Le compte tel que l'écran partagé le lit : c'est Haiko qui regarde. */
  const moiDansLEspace: MoiDansLEspace = {
    id: moi.id,
    identifiant: moi.id,
    nomAffiche: moi.nomAffiche,
    role: 'admin',
    projets: client_.projets,
  };

  /** Ce qui attend une réponse CHEZ LES AUTRES : la colonne le disait, pas nous. */
  const nonLusAilleurs = clients
    .filter((c) => c.id !== client_.id)
    .reduce((total, c) => total + c.fil.nonLus, 0);

  /*
   * LE SÉLECTEUR DE CLIENT DESCEND DANS L'ENTÊTE DE L'ESPACE, sur SA ligne.
   * Il se pose à gauche du nom du projet, et les projets du client — que le
   * tiroir du sélecteur redit client par client — ne prennent plus de rang. Son
   * PIED porte « Ajouter un client », hors du défilement de la liste.
   */
  const selecteurDeClient = (
    <>
      {/* LA FLÈCHE DE RETOUR VERS LA VUE D'ENSEMBLE, en tête de la ligne, à
          gauche du nom du client et du projet — là où on la cherche. */}
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={revenirALAccueil}
        title={t('Revenir à la vue d’ensemble')}
        aria-label="Revenir a la vue d ensemble"
        data-retour-accueil
        className="shrink-0"
      >
        <ArrowLeft className="h-4 w-4" />
      </Button>
    <span className="relative inline-flex min-w-0 shrink-0 max-w-[55%] sm:max-w-[280px]">
      <SelecteurTiroir
        valeur={client_.id}
        options={clients.map((c) => ({
          valeur: c.id,
          libelle: `${c.nomAffiche}${c.actif ? '' : ` ${t('(suspendu)')}`}`,
          /*
           * Le détail ne garde que les PROJETS du client : le chiffre gris des
           * non-lus, sans légende, disait la même chose que la pastille bleue
           * posée au bout de la ligne.
           */
          detail: c.projets.map((p) => p.nom).join(', ') || undefined,
          /* Les deux mêmes pastilles que la colonne de gauche, client par client. */
          fin: <PastillesMessagerie compteurs={c.compteurs} />,
        }))}
        onChoisir={setChoisi}
        titre={t('Clients')}
        repere="client"
        pied={(fermer) => boutonAjouter(fermer)}
        actionTitre={() => boutonGestionAcces}
        declencheur={(ouvrir, libelle) => (
          <Button
            variant="ghost"
            size="sm"
            onClick={ouvrir}
            className="min-w-0 justify-start gap-1.5 px-1.5 text-[14px] font-medium text-text"
            data-choix-client={client_.id}
            title={libelle}
          >
            <UserRound className="h-4 w-4 shrink-0 text-faint" />
            <span className="min-w-0 truncate">{libelle}</span>
            <ChevronDown className="h-3 w-3 shrink-0 text-faint" aria-hidden />
          </Button>
        )}
      />
      <Pastille
        nombre={nonLusAilleurs}
        ton="lire"
        position="coin"
        data-non-lus-ailleurs={nonLusAilleurs || undefined}
        title={t('Messages non lus chez d’autres clients')}
      />
    </span>
    </>
  );

  /*
   * LE PANNEAU DE CONVERSION. Il rappelle CHEZ QUI et DANS QUEL PROJET la tâche
   * va naître — sans quoi, avec plusieurs clients, on ne sait pas où l'on
   * envoie —, puis les trois réglages, puis le bouton. La rédaction du titre et
   * de la description est annoncée : la tâche apparaît tout de suite, mais ses
   * mots définitifs arrivent quelques secondes plus tard.
   */
  const demandeAConvertir = conversion
    ? clients.flatMap((c) => c.demandes.map((d) => ({ demande: d, client: c }))).find((x) => x.demande.id === conversion)
    : undefined;
  const tiroirDeConversion = (
    <Drawer open={Boolean(conversion)} onClose={() => setConversion(null)} empile>
      <div className="flex min-h-0 flex-1 flex-col" data-tiroir-conversion={conversion ?? undefined}>
        <header className="flex shrink-0 items-center gap-1.5 px-3 pb-2">
          <DialogTitle className="min-w-0 truncate">{t('En faire une tâche')}</DialogTitle>
          <BulleInfo cote="start">{t('Un agent lira toute la discussion et ses pièces jointes, puis rédigera le titre et la description de la tâche.')}</BulleInfo>
          <span className="flex-1" />
          <Button size="icon-sm" variant="ghost" onClick={() => setConversion(null)} title={t('Fermer')}>
            <X className="h-4 w-4" />
          </Button>
        </header>
        <ZoneDefilement fond="hsl(var(--surface))" className="min-h-0 flex-1 space-y-3 px-3 pb-3">
          {demandeAConvertir ? (
            <div className="space-y-1 text-[13px]">
              <p className="font-medium text-text" data-conversion-titre>
                {demandeAConvertir.demande.titre}
              </p>
              <p className="text-faint" data-conversion-destination>
                {t('Client : {v0}', { v0: demandeAConvertir.client.nomAffiche })} ·{' '}
                {t('Projet : {v0}', {
                  v0: demandeAConvertir.client.projets.find((p) => p.id === demandeAConvertir.demande.projectId)?.nom
                    ?? demandeAConvertir.demande.projectId,
                })}
              </p>
            </div>
          ) : null}
          <RunSelectors
            engines={etat.engines}
            choix={choixDExecution}
            onSelect={(patch) => setChoixDExecution((avant) => ({ ...avant, ...patch }))}
            pleineLargeur
            comptes={etat.quotas}
          />
          <Button
            size="pied"
            disabled={!conversion || conversionEnCours}
            onClick={() => conversion && lancerLaConversion(conversion, choixDExecution)}
            data-confirmer-conversion
          >
            {conversionEnCours ? t('Création…') : t('Créer la tâche')}
          </Button>
        </ZoneDefilement>
      </div>
    </Drawer>
  );

  return (
    <div className="flex h-full min-h-0 flex-col" data-espace-haiko data-vue={telephone ? 'telephone' : 'large'}>
      {/*
       * LE GESTE QUI N'APPARTIENT QU'À HAIKO — « en faire une carte » — a
       * quitté son rang de boutons : il est sous le « ⋮ » de chaque vignette
       * et sous celui de la fiche, là où on le cherche.
       */}
      <div className="min-h-0 flex-1">
        <EspaceClient
          key={client_.id}
          moi={moiDansLEspace}
          projectIdImpose={projetDuClient}
          filImpose={client_.fil.filId}
          demandeVisee={vise?.clientId === client_.id ? vise?.demandeId : undefined}
          navigation={arrivee ? { n: arrivee } : undefined}
          gestesHaiko={gestesHaiko}
          enteteAvant={selecteurDeClient}
        />
      </div>
      {tiroirDeCreation}
      {tiroirGestionAcces}
      {tiroirDeConversion}
    </div>
  );
}
