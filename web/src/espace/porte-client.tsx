/**
 * LA PORTE CLIENT — la racine de l'application servie sur my.haikostudio.cloud.
 *
 * Elle ne monte RIEN de l'application d'administration : ni magasin général, ni
 * colonne de gauche, ni tableau. Le fichier est chargé à la demande depuis
 * `main.tsx`, ce qui en fait un morceau séparé : l'interface de Haiko ne paie
 * pas le poids de celle du client, et réciproquement.
 *
 * Le thème et la langue sont posés depuis leurs REPÈRES LOCAUX. Le réglage vit
 * en base pour un administrateur, mais un client n'a pas accès aux préférences
 * du serveur — et son écran doit malgré tout s'afficher dans les douze palettes
 * et les cinq langues.
 */
import * as React from 'react';
import { Loader2 } from 'lucide-react';
import { abonnerAuxNotifications } from '@/lib/abonnement-push';
import { appliquerLeTheme, useSystemeSombre } from '@/lib/theme';
import { appliquerLaLangue, langueInitiale, t } from '@/lib/langue';
import {
  adresseDeDiscussion,
  adresseDeNotification,
  fragmentDeLEspaceClient,
  lireFragmentDeDemande,
  lireFragmentDeLEspaceClient,
  type EcranEspaceClient,
  reglageApparenceValide,
  themeChoisiDepuisReglage,
  themeDeLAmbiance,
  themeDuSysteme,
  type NotificationEspace,
} from '@beluga/shared';
import { PileDeMessages, usePileDeMessages } from '@/components/messages-passagers';
import { BoutonTheme, type EtatDeTheme } from './bouton-theme';
import { canalEspace } from './canal-espace';
import { phraseDeNotification } from './cloche-espace';
import { EspaceClient, useEtatDuCanal, type MoiDansLEspace } from './espace-client';

/**
 * LE VOILE DE CONNEXION SÉPARE LE TRANSPORT DES DONNÉES. Il ne paraît que tant
 * qu'on n'a JAMAIS reçu son identité : une coupure passagère, plus tard, ne
 * fait pas réapparaître un écran de chargement par-dessus un espace déjà
 * affiché — elle se dit par un bandeau discret.
 */
/**
 * LE REPÈRE LOCAL DE L'APPARENCE DU CLIENT — jamais la source de vérité, qui
 * est son COMPTE. Il garde la forme ENREGISTRÉE (« clair », « sombre »,
 * « auto-origine-sombre »), pas le thème résolu : sans cela, « automatique »
 * se perdrait à chaque rechargement.
 */
const CLE_REPERE_APPARENCE = 'beluga-espace-apparence';

export function PorteClient() {
  const [moi, setMoi] = React.useState<MoiDansLEspace | null>(null);
  /*
   * LA PILE COMMUNE DE L'APPLICATION, pas une seconde pile. Elle se pose en
   * HAUT AU CENTRE, au-dessus des tiroirs, et garde la durée de la maison. La
   * porte tenait la sienne, en bas à droite et pour six secondes : deux places
   * et deux durées pour la même chose.
   */
  const pile = usePileDeMessages<{ notification?: NotificationEspace }>();
  const ajouterUnMessage = pile.ajouter;
  const etat = useEtatDuCanal();

  /*
   * OÙ ALLER, DEMANDÉ DU DEHORS : un toast cliqué, une notification poussée
   * touchée, une adresse changée. Le numéro change à chaque fois — cliquer deux
   * fois la même fiche la rouvre.
   */
  const [navigation, setNavigation] = React.useState(() => ({
    n: 0,
    ...lireFragmentDeDemande(window.location.hash),
    discussion: adresseDeDiscussion(window.location.hash),
    ecran: lireFragmentDeLEspaceClient(window.location.hash).ecran,
  }));
  const naviguer = React.useCallback((hash: string) => {
    setNavigation((avant) => ({
      n: avant.n + 1,
      ...lireFragmentDeDemande(hash),
      discussion: adresseDeDiscussion(hash),
      /* TOUS les écrans de l'espace, pas seulement la fiche et la discussion :
         profil, accès, sauvegardes, nouvelle demande se relisent aussi. */
      ecran: lireFragmentDeLEspaceClient(hash).ecran,
    }));
  }, []);

  /*
   * L'ADRESSE PEUT DÉSIGNER UNE FICHE — c'est le lien porté par le courriel du
   * lundi matin. On la relit à chaque Précédent/Suivant : un espace ouvert
   * depuis un courriel tombe sur la demande, prêt à répondre.
   */
  const [vise, setVise] = React.useState(() => lireFragmentDeDemande(window.location.hash));
  React.useEffect(() => {
    const relire = () => {
      setVise(lireFragmentDeDemande(window.location.hash));
      naviguer(window.location.hash);
    };
    /*
     * UNE NOTIFICATION POUSSÉE TOUCHÉE, L'ESPACE DÉJÀ OUVERT : le service worker
     * passe l'adresse (`OPEN_URL`), et l'écran y va sans recharger.
     */
    const surMessage = (event: MessageEvent) => {
      if (event.data?.type === 'OPEN_URL' && typeof event.data.url === 'string') {
        naviguer(new URL(event.data.url, window.location.origin).hash);
      }
    };
    window.addEventListener('hashchange', relire);
    window.addEventListener('popstate', relire);
    navigator.serviceWorker?.addEventListener('message', surMessage);
    return () => {
      window.removeEventListener('hashchange', relire);
      window.removeEventListener('popstate', relire);
      navigator.serviceWorker?.removeEventListener('message', surMessage);
    };
  }, [naviguer]);

  /*
   * L'ESPACE ÉCRIT SON ADRESSE. Il ne faisait que la LIRE : un lien de courriel
   * ouvrait la bonne fiche, mais rien ensuite ne suivait ce qu'on regardait —
   * recharger ramenait au tableau, et l'adresse n'était pas partageable.
   *
   * `replaceState`, jamais `pushState` : la fiche est un détail d'affichage
   * dans l'espace, et la refermer n'a pas à empiler une entrée d'historique
   * (c'est la règle déjà écrite dans `adresse-navigateur.ts`). Il n'émet ni
   * `hashchange` ni `popstate` : l'écouteur ci-dessus ne peut donc pas boucler
   * avec cette écriture.
   */
  const ecrireLAdresse = React.useCallback(
    (ecran: {
      projectId?: string;
      demandeId?: string;
      discussion: boolean;
      ecran?: EcranEspaceClient['ecran'];
    }) => {
      const fragment = fragmentDeLEspaceClient(ecran);
      const voulue = `${window.location.pathname}${window.location.search}${fragment ? `#${fragment}` : ''}`;
      const actuelle = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      if (voulue === actuelle) return;
      window.history.replaceState(window.history.state, '', voulue);
    },
    [],
  );

  React.useEffect(() => {
    appliquerLaLangue(langueInitiale());
  }, []);

  /* ---------------- Le thème, gardé sur le compte ---------------- */

  /*
   * LE CHOIX VIT SUR LE COMPTE, et le navigateur n'en garde qu'un REPÈRE. La
   * source de vérité arrive avec l'identité (`ready.client`) ; le repère ne
   * sert qu'au tout premier instant, avant qu'elle ne réponde — sans lui,
   * l'écran partirait sur le réglage du système puis basculerait sous les yeux.
   * Il garde la forme ENREGISTRÉE (« auto-origine-sombre »), pas le thème
   * résolu : « automatique » survit donc à un rechargement.
   */
  const [apparence, setApparence] = React.useState<string>(() => {
    try {
      return window.localStorage.getItem(CLE_REPERE_APPARENCE) ?? '';
    } catch {
      return '';
    }
  });
  const reglage = React.useMemo(() => reglageApparenceValide(apparence), [apparence]);
  const suitLeSysteme = !reglage || reglage.automatique;
  const systemeSombre = useSystemeSombre(suitLeSysteme);
  const etatDuTheme: EtatDeTheme = reglage ? (reglage.automatique ? 'auto' : reglage.clarte) : 'auto';

  React.useEffect(() => {
    appliquerLeTheme(
      suitLeSysteme
        ? themeDuSysteme(reglage?.ambiance ?? 'origine', systemeSombre)
        : themeDeLAmbiance(reglage.ambiance, reglage.clarte),
    );
  }, [reglage, suitLeSysteme, systemeSombre]);

  /** Ce que dit le compte : on le pose, et le repère local le suit. */
  const appliquerLApparenceDuCompte = React.useCallback((choisi: string) => {
    setApparence(choisi);
    try {
      if (choisi) window.localStorage.setItem(CLE_REPERE_APPARENCE, choisi);
      else window.localStorage.removeItem(CLE_REPERE_APPARENCE);
    } catch {
      /* stockage local indisponible : rien d'autre n'en dépend */
    }
  }, []);

  /**
   * CHANGER DE THÈME L'ÉCRIT SUR LE COMPTE. L'écran bouge tout de suite — on
   * n'attend pas le serveur pour une préférence d'affichage —, et le repère
   * local suit pour le prochain premier affichage. Un refus du serveur ne
   * casse rien : le choix reste celui de l'écran jusqu'à la prochaine entrée.
   */
  const changerLeTheme = React.useCallback((suivant: EtatDeTheme) => {
    const choisi = themeChoisiDepuisReglage({
      ambiance: 'origine',
      clarte: suivant === 'clair' ? 'clair' : 'sombre',
      automatique: suivant === 'auto',
    });
    setApparence(choisi);
    try {
      window.localStorage.setItem(CLE_REPERE_APPARENCE, choisi);
    } catch {
      /* stockage local indisponible : le flash du premier affichage revient, rien d'autre */
    }
    void canalEspace.demander({ type: 'espace.moi.apparence', apparence: choisi }).catch(() => undefined);
  }, []);

  React.useEffect(() => {
    const arreter = canalEspace.ecouter((event) => {
      if (event.type === 'ready.client') {
        const fiche = (event as any).moi as MoiDansLEspace & { apparence?: string };
        setMoi(fiche);
        /* LA VÉRITÉ ARRIVE : le compte l'emporte sur le repère local. Un compte
           qui n'a rien choisi (`''`) laisse la main au réglage du système. */
        if (typeof fiche.apparence === 'string') appliquerLApparenceDuCompte(fiche.apparence);
      }
      /*
       * LE TOAST DE L'ESPACE CLIENT. Le canal ne lui laisse passer que
       * `toast.client`, déjà trié à l'envoi sur son propre compte : ce qui
       * arrive ici le concerne, sans autre vérification à faire.
       */
      if (event.type === 'toast.client') {
        // Un toast qui porte sa notification se rédige dans la langue du lecteur,
        // comme la cloche ; les autres gardent le texte du serveur.
        const notification = (event as { notification?: NotificationEspace }).notification;
        const phrase = notification ? phraseDeNotification(notification) : null;
        const texte = phrase ? `${phrase.titre} — ${phrase.texte}` : String((event as any).text ?? '');
        ajouterUnMessage({ level: 'info', text: texte, notification });
      }
    });
    canalEspace.ouvrir();
    return arreter;
  }, [ajouterUnMessage, appliquerLApparenceDuCompte]);

  /*
   * L'ESPACE CLIENT S'ABONNE AUX NOTIFICATIONS POUSSÉES — il ne le faisait
   * JAMAIS : seule l'administration le demandait, et un client qui installait
   * l'application n'était prévenu de rien. Le service worker est déjà
   * enregistré pour les deux visages depuis `main.tsx` : il n'y a que
   * l'abonnement à demander, une fois l'identité connue.
   */
  React.useEffect(() => {
    if (moi) void abonnerAuxNotifications();
  }, [moi]);

  if (!moi) {
    return (
      <div className="grid h-dvh place-items-center bg-bg text-muted" data-porte-client="connexion">
        <div className="flex items-center gap-2 text-sm">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t('Connexion à votre espace…')}
        </div>
      </div>
    );
  }

  return (
    /*
     * LA PORTE COMMENCE SOUS LA BARRE D'ÉTAT. L'application installée s'étend
     * jusqu'au bord (`viewport-fit=cover`) : sans ce décalage, l'entête passait
     * sous l'heure et la batterie de l'iPhone. Le décalage est posé ICI, pas
     * dans l'entête : la vue Haiko réutilise l'entête SOUS la barre de quotas,
     * qui compte déjà la zone sûre. Le fond `bg-bg` monte jusqu'au bord.
     */
    <div
      className="flex h-dvh flex-col bg-bg text-text"
      style={{ paddingTop: 'var(--zone-sure-haut, 0px)' }}
      data-porte-client="ouverte"
    >
      {etat !== 'en-ligne' ? (
        <div className="bg-warning/15 px-3 py-1 text-center text-xs text-warning" data-bandeau-canal>
          {t('Connexion interrompue — reprise en cours.')}
        </div>
      ) : null}
      {/*
       * UN SEUL RANG D'ENTÊTE, PAS DEUX. La porte posait son propre bandeau —
       * « Messagerie », le nom du client, un lien « Se déconnecter » — au-dessus
       * de celui de l'espace, qui portait déjà le nom du projet et les trois
       * boutons : deux traits et deux hauteurs de rang sur un téléphone, avant
       * même que le tableau commence. Tout est passé À L'ESPACE, par ses deux
       * ouvertures `avant` et `apres` — le titre à gauche du nom du projet, le
       * nom du client et sa déconnexion à droite, devant les trois boutons.
       */}
      <main className="min-h-0 flex-1">
        <EspaceClient
          moi={moi}
          projetInitial={vise.projectId}
          demandeVisee={vise.demandeId}
          navigation={navigation}
          onEcranOuvert={ecrireLAdresse}
          /* « HAIKO CHAT », LE NOM DE L'APPLICATION INSTALLÉE, redit en tête : un
             nom propre, il ne se traduit pas. */
          enteteAvant={<span className="shrink-0 text-[14px] font-semibold text-text">Haiko Chat</span>}
          enteteApres={
            /*
             * LE NOM DE LA PERSONNE CONNECTÉE N'EST PLUS DANS L'ENTÊTE : elle
             * sait qui elle est, et le rang gagne sa place. Reste le thème,
             * qui n'a pas de libellé à rallonger dans les cinq langues.
             */
            <BoutonTheme etat={etatDuTheme} onChanger={changerLeTheme} />
          }
          /*
           * LA DÉCONNEXION VIT DANS LE BURGER, avec les Backups et l'Accès :
           * l'entête ne garde que les noms. Elle reste une NAVIGATION vers
           * `/auth/logout`, que le serveur seul sait honorer.
           */
          monProfil
          onDeconnexion={() => {
            window.location.href = '/auth/logout';
          }}
        />
      </main>

      {/*
       * LES MESSAGES PASSAGERS : LA PILE COMMUNE, EN HAUT AU CENTRE. Un clic
       * mène au même endroit que la cloche — la fiche, ou la discussion.
       */}
      <PileDeMessages
        messages={pile.messages}
        onFermer={pile.retirer}
        onPause={pile.geler}
        onReprendre={pile.reprendre}
        onOuvrir={(message) => {
          const cible = (message as { notification?: NotificationEspace }).notification;
          if (!cible) return;
          pile.retirer(message.id);
          naviguer(adresseDeNotification(cible).replace(/^\//, ''));
        }}
        attributs={(message) => ({
          // LE REPÈRE DE LA PILE CLIENT SUIT SES MESSAGES : les contrôles qui
          // l'observent le retrouvent, désormais sur la pile commune.
          'data-toast-client': '',
          'data-toast-cliquable': (message as { notification?: NotificationEspace }).notification ? '' : undefined,
        })}
      />
    </div>
  );
}
