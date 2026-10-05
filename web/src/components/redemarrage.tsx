import * as React from 'react';
import { Loader2, Power } from 'lucide-react';
import {
  avertissementRedemarrage,
  resumeDeCeQuiSeraInterrompu,
  type EtatDemon,
  raisonAgents,
  raisonPublications,
} from '@beluga/shared';
import {
  BulleInfo,
  Button,
  CLASSE_POINT_DE_BOUTON,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenuItem,
} from '@/components/ui';
import { client } from '@/lib/client';
import { t } from '@/lib/langue';
import { useApp } from '@/lib/use-app';
import { cn } from '@/lib/utils';

/**
 * LE REDÉMARRAGE DU SERVEUR, DANS LE MENU DES TROIS POINTS (demande du
 * 02/10/2026, sur tous les écrans).
 *
 * Il a vécu au pied de la colonne des projets, puis en icône dans le bandeau ;
 * il devient une ENTRÉE du menu, à côté du terminal du serveur
 * (`EntreeRedemarrage`). Son état reste visible menu fermé : le POINT commun
 * des boutons de l'entête, sur le coin haut droit des trois points (`PointRedemarrage`) :
 *  - point vert : le serveur tourne, rien n'attend ;
 *  - point orange : un redémarrage est requis (du code serveur plus récent
 *    attend), y compris demandé mais retenu par une publication ou un travail
 *    en cours (il partira tout seul) ;
 *  - point gris : le serveur redémarre (l'entrée montre une roue qui tourne).
 * L'entrée dit son libellé ; la raison vit derrière un « i » à sa droite.
 *
 * LA FENÊTRE DE CONFIRMATION VIT HORS DU MENU (`dialogue`, rendu par le
 * bandeau à côté du menu) : posée dans le menu, elle se démonterait avec lui à
 * l'instant où l'entrée le referme.
 *
 * Publier remplace l'interface tout de suite, mais le serveur continue de
 * tourner avec le code chargé à son démarrage : une correction côté serveur
 * n'existe pas tant qu'on ne l'a pas relancé. Le point orange dit exactement
 * ce moment-là — sinon rien ne le signale, et la correction semble n'avoir eu
 * aucun effet.
 *
 * Repères des contrôles : `data-bouton-redemarrage="menu"` sur l'entrée,
 * `data-etat-redemarrage` (`repos`, `attendu`, `retenu`, `en-cours`) sur
 * l'entrée ET sur le point (`data-point-redemarrage`).
 */
export type EtatRedemarrage = 'repos' | 'attendu' | 'retenu' | 'en-cours';

export function useRedemarrage() {
  const state = useApp();
  const [confirmer, setConfirmer] = React.useState(false);
  const [enCours, setEnCours] = React.useState(false);

  // Le serveur diffuse son état toutes les trente secondes, mais on le demande
  // à l'ouverture : sinon le point reste muet jusqu'au premier battement.
  React.useEffect(() => {
    if (!state.connected) return;
    void client.refreshDaemonStatus();
  }, [state.connected]);

  const demon = state.demon;
  const attendu = !!demon?.redemarrageNecessaire;
  // Une publication en cours interdit le redémarrage : le couper laisserait un
  // lot à moitié parti. La demande, elle, partira toute seule dès la dernière
  // publication terminée.
  const publications = demon?.publications ?? [];
  const publie = publications.length > 0;
  const enAttente = !!demon?.redemarrageEnAttente;
  // Le lien avec le serveur se coupe pendant qu'il redémarre : le dernier état
  // connu devient faux, puisque le serveur qui l'a émis n'est plus celui qui
  // répondra. Tant que la connexion n'est pas revenue, seul le redémarrage
  // compte, et il s'efface tout seul dès la reconnexion.
  const deconnecte = !state.connected;
  const repart = enCours || deconnecte;

  const libelle = repart
    ? t('Redémarrage…')
    : publie
      ? t('Publication en cours')
      : enAttente
        ? t('Redémarrage requis')
        : attendu
          ? t('Redémarrage attendu')
          : t('Redémarrer le serveur');
  const raison = repart
    ? t('Le serveur redémarre — l’application se reconnectera toute seule.')
    : publie
      ? raisonPublications(publications)
      : enAttente
        ? (demon?.agentsEnCours
            ? t('{v0} Il partira tout seul dès qu’il aura fini.', { v0: raisonAgents(demon.agentsEnCours, demon.agentsDetail) })
            : t('Un redémarrage a été demandé mais un travail en cours le retient : il partira tout seul dès qu’il aura fini.'))
        : attendu
          ? t('Du code serveur plus récent attend : redémarrez pour qu’il prenne effet.')
          : null;

  /*
   * CE QUI RETIENT LE REDÉMARRAGE N'ÉTEINT PAS L'ENTRÉE : c'est la FENÊTRE qui
   * dit ce qui sera interrompu, et le forçage reste un second clic délibéré.
   * Seul le temps où le serveur repart l'éteint — il n'y a plus personne à qui
   * parler.
   */
  const retenu = publie || enAttente;
  const etat: EtatRedemarrage = repart ? 'en-cours' : retenu ? 'retenu' : attendu ? 'attendu' : 'repos';

  const dialogue = (
    <DialogueDeRedemarrage
      open={confirmer}
      demon={demon ?? undefined}
      retenu={retenu}
      onClose={() => setConfirmer(false)}
      onPartir={(force) => {
        // L'entrée et le point passent à « en cours » DÈS LE CLIC.
        setEnCours(true);
        // La réponse part avant la coupure ; la reconnexion se fait toute
        // seule, on rend donc la main au bout de quelques secondes. Un refus
        // (publication en cours) revient AVANT la coupure : on le dit et on
        // rend la main tout de suite.
        void client
          .call<{ ok: boolean; raison?: string }>({ type: 'daemon.restart', force })
          .then((res) => {
            if (res && res.ok === false) {
              setEnCours(false);
              if (res.raison) client.pushToast('info', res.raison);
            }
          })
          .catch(() => undefined);
        window.setTimeout(() => setEnCours(false), 12000);
      }}
    />
  );

  return { etat, libelle, raison, repart, ouvrir: () => setConfirmer(true), dialogue };
}

const COULEUR_DU_POINT: Record<EtatRedemarrage, string> = {
  repos: 'bg-success',
  attendu: 'bg-warning',
  retenu: 'bg-warning',
  'en-cours': 'bg-faint',
};

/** Le point d'état, à cheval sur le coin haut droit du bouton des trois points (`CLASSE_POINT_DE_BOUTON`). */
export function PointRedemarrage({ etat }: { etat: EtatRedemarrage }) {
  return (
    <span
      aria-hidden
      data-point-redemarrage={etat === 'en-cours' ? 'gris' : etat === 'repos' ? 'vert' : 'orange'}
      data-etat-redemarrage={etat}
      className={cn(CLASSE_POINT_DE_BOUTON, COULEUR_DU_POINT[etat])}
    />
  );
}

/** L'entrée « Redémarrer le serveur » du menu des trois points. */
export function EntreeRedemarrage({ redemarrage }: { redemarrage: ReturnType<typeof useRedemarrage> }) {
  const { etat, libelle, raison, repart, ouvrir } = redemarrage;
  return (
    <DropdownMenuItem
      data-bouton-redemarrage="menu"
      data-etat-redemarrage={etat}
      disabled={repart}
      onSelect={ouvrir}
    >
      {repart ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Power className="h-3.5 w-3.5" />}
      <span className="min-w-0 flex-1 whitespace-nowrap">{libelle}</span>
      {raison ? (
        // La raison vit derrière un « i » : en ligne, sa phrase décidait de la
        // largeur du menu entier. Un appui sur le « i » (ou dans sa bulle, qui
        // remonte par l'arbre React) ne doit PAS ouvrir la confirmation : on
        // arrête clic, relâchement et touches avant qu'ils n'atteignent l'entrée.
        <span
          onClick={(e) => e.stopPropagation()}
          onPointerUp={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          className="flex shrink-0"
        >
          <BulleInfo cote="end">{raison}</BulleInfo>
        </span>
      ) : null}
      <span aria-hidden className={cn('h-1.5 w-1.5 shrink-0 rounded-full', COULEUR_DU_POINT[etat])} />
    </DropdownMenuItem>
  );
}

/**
 * LA FENÊTRE DU REDÉMARRAGE — ET SON SECOND BOUTON.
 *
 * Un redémarrage demandé pendant qu'un travail tourne est RETENU : il partira
 * tout seul dès la dernière tâche finie, et c'est la bonne règle tant que ce
 * travail avance vraiment. Le jour où plus rien n'avance, elle se retourne
 * contre l'utilisateur — le redémarrage attend un agent qui n'ira jamais au
 * bout, et il fallait un terminal pour s'en sortir.
 *
 * D'où le second bouton, et deux exigences qui vont avec : il ne part JAMAIS
 * tout seul (un clic de plus, sur un bouton nommé « Forcer le redémarrage »),
 * et la fenêtre DIT ce qui sera interrompu avant qu'on ne le clique
 * (`resumeDeCeQuiSeraInterrompu`). Quand rien ne tourne, il n'y a rien à forcer
 * et il ne s'affiche pas.
 */
function DialogueDeRedemarrage({
  open,
  demon,
  retenu,
  onPartir,
  onClose,
}: {
  open: boolean;
  demon?: EtatDemon & { redemarrageNecessaire?: boolean };
  retenu: boolean;
  onPartir: (force: boolean) => void;
  onClose: () => void;
}) {
  const etat = demon ?? { demarreA: 0 };
  const quelqueChoseTourne = (etat.agentsEnCours ?? 0) > 0 || (etat.publications ?? []).length > 0;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:w-[min(480px,100%)]">
        <DialogHeader>
          <DialogTitle>{t('Redémarrer le serveur ?')}</DialogTitle>
        </DialogHeader>
        <DialogDescription className="mt-0">{avertissementRedemarrage(etat)}</DialogDescription>
        {quelqueChoseTourne ? (
          <p className="mt-2 text-[13px] leading-relaxed text-warning" data-redemarrage-interrompu>
            {resumeDeCeQuiSeraInterrompu(etat)}
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t('Annuler')}</Button>
          {quelqueChoseTourne ? (
            <Button
              variant="danger"
              size="sm"
              data-redemarrage-force
              onClick={() => {
                onPartir(true);
                onClose();
              }}
            >
              {t('Forcer le redémarrage')}</Button>
          ) : null}
          {/*
            « Redémarrer » reste ACTIF même quand un travail tourne : il pose
            alors la demande RETENUE, qui partira toute seule dès la dernière
            tâche finie — c'est le comportement d'avant, et il est utile. On
            n'ajoute rien à sa charge : c'est « Forcer » qui passe outre.
          */}
          <Button
            variant="default"
            size="sm"
            title={
              retenu
                ? t('Le redémarrage sera retenu et partira tout seul dès la fin du travail en cours.')
                : undefined
            }
            onClick={() => {
              onPartir(false);
              onClose();
            }}
          >
            {retenu ? t('Redémarrer dès que possible') : t('Redémarrer')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
