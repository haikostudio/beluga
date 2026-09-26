/**
 * LA CLOCHE DU CLIENT, EN HAUT À DROITE DE SON ESPACE.
 *
 * Le même système que la cloche du bandeau de l'administration — une cloche,
 * une pastille, un tiroir qui liste les nouvelles avec leur image, leur titre,
 * leur heure, le non-lu mis en avant — à une différence près : ses lignes sont
 * GARDÉES PAR LE SERVEUR (`server/src/espace-notifications.ts`). Un client passe
 * du téléphone à l'ordinateur, et ce qu'il a lu sur l'un est lu sur l'autre.
 *
 * Le serveur ne garde que le FAIT (qui, quoi, sur quelle demande) : la phrase
 * se rédige ici, dans la langue du lecteur. Les toasts de la porte client la
 * reprennent mot pour mot (`phraseDeNotification`).
 */
import * as React from 'react';
import { Bell, CheckCheck } from 'lucide-react';
import {
  MOTIFS,
  TITRES_COLONNES_DEMANDE,
  type ColonneDemande,
  type IconeNotification,
  type MotifNotification,
  type NotificationEspace,
} from '@beluga/shared';
import { Button, Drawer, EmptyState, Pastille, ZoneDefilement } from '@/components/ui';
import { Silhouette } from '@/components/silhouettes';
import { IconeDeNotification, bordureDIcone } from '@/components/icone-notification';
import { cn, relativeTime } from '@/lib/utils';
import { t } from '@/lib/langue';
import { canalEspace } from './canal-espace';

/** L'image d'une ligne : celle du motif, ou l'attention quand le motif est inconnu. */
function iconeDe(notification: NotificationEspace): IconeNotification {
  return MOTIFS[notification.motif as MotifNotification]?.icone ?? 'attention';
}

/** La partie d'une fiche qui a bougé, dite dans la langue du lecteur. */
function phraseDeModification(detail: string, auteur: string): string {
  switch (detail) {
    case 'taches':
      return t('{auteur} a mis à jour les cases à cocher', { auteur });
    case 'importance':
      return t('{auteur} a changé l’importance', { auteur });
    case 'description':
      return t('{auteur} a modifié la description', { auteur });
    case 'echeance':
      return t('{auteur} a changé une date', { auteur });
    default:
      return t('{auteur} a modifié la fiche', { auteur });
  }
}

/** Le titre et le texte d'une notification, rédigés ici — le serveur n'en garde que le fait. */
export function phraseDeNotification(
  notification: NotificationEspace,
  /** Lue par Haiko sur la cloche d'un client : les étapes ne disent plus « votre demande ». */
  vueHaiko = false,
): { titre: string; texte: string } {
  const { auteur, demandeTitre: titre, detail } = notification;
  const texte = (() => {
    switch (notification.evenement) {
      case 'nouvelle-demande':
        return t('{auteur} a déposé « {titre} »', { auteur, titre });
      case 'deplacement':
        return t('{auteur} l’a déplacée en « {colonne} »', {
          auteur,
          colonne: t(TITRES_COLONNES_DEMANDE[detail as ColonneDemande] ?? detail),
        });
      case 'commentaire':
        return detail ? t('{auteur} a commenté : {extrait}', { auteur, extrait: detail }) : t('{auteur} a joint un fichier', { auteur });
      case 'message':
        return detail ? t('{auteur} vous a écrit : {extrait}', { auteur, extrait: detail }) : t('{auteur} a joint un fichier', { auteur });
      case 'modification':
        return phraseDeModification(detail, auteur);
      case 'prise-en-charge':
        return t('{auteur} a pris en charge votre demande', { auteur });
      case 'archivage':
        return t('{auteur} a rangé la demande', { auteur });
      case 'demarree':
        return vueHaiko ? t('Le travail a commencé') : t('Le travail sur votre demande a commencé');
      case 'terminee':
        return vueHaiko ? t('Le travail est terminé') : t('Le travail sur votre demande est terminé');
      case 'en-ligne':
        return vueHaiko ? t('La demande est en ligne') : t('Votre demande est en ligne');
      default:
        return titre;
    }
  })();
  const fois = notification.fois > 1 ? ` ${t('({n} fois)', { n: notification.fois })}` : '';
  return {
    titre: notification.evenement === 'message' ? t('Discussion') : titre || t('Notifications'),
    texte: `${texte}${fois}`,
  };
}

/*
 * LA MÊME CLOCHE, VUE PAR HAIKO SUR LA FICHE D'UN CLIENT (`clientId`). Rien n'y
 * est gardé en base : le serveur la reconstruit (`espace.notifications.client`)
 * depuis ce que compte la Messagerie pour CE client. Pas de « tout marquer lu » :
 * une ligne s'éteint par le geste qui l'éteint ailleurs — ouvrir la demande, ou
 * la discussion —, et la liste se relit à chaque mouvement de l'espace.
 */
export function ClocheEspace({
  onAller,
  clientId,
}: {
  onAller: (notification: NotificationEspace) => void;
  clientId?: string;
}) {
  const [ouvert, setOuvert] = React.useState(false);
  const [nonLues, setNonLues] = React.useState(0);
  /** `null` tant que la première page n'est pas arrivée : le tiroir montre sa silhouette. */
  const [liste, setListe] = React.useState<NotificationEspace[] | null>(null);
  const [suite, setSuite] = React.useState(false);

  const charger = React.useCallback((avant?: number) => {
    if (clientId) {
      void canalEspace
        .demander({ type: 'espace.notifications.client', clientId })
        .then((reponse: { notifications: NotificationEspace[]; nonLues: number }) => {
          setNonLues(reponse.nonLues);
          setSuite(false);
          setListe(reponse.notifications);
        })
        .catch(() => setListe((avantListe) => avantListe ?? []));
      return;
    }
    void canalEspace
      .demander({ type: 'espace.notifications.lister', avant, limite: 30 })
      .then((reponse: { notifications: NotificationEspace[]; suite: boolean; nonLues: number }) => {
        setNonLues(reponse.nonLues);
        setSuite(reponse.suite);
        setListe((avantListe) => (avant && avantListe ? [...avantListe, ...reponse.notifications] : reponse.notifications));
      })
      .catch(() => setListe((avantListe) => avantListe ?? []));
  }, [clientId]);

  React.useEffect(() => charger(), [charger]);
  React.useEffect(() => canalEspace.surChangementDEtat((etat) => etat === 'en-ligne' && charger()), [charger]);
  React.useEffect(() => {
    if (!clientId) return;
    // Un même geste émet plusieurs événements : une seule relecture par instant.
    let minuteur: number | undefined;
    const arret = canalEspace.ecouter((event) => {
      if (!['espace.demande', 'espace.message', 'espace.fil', 'espace.compteurs', 'espace.nonLus'].includes(event.type)) return;
      if (minuteur !== undefined) return;
      minuteur = window.setTimeout(() => {
        minuteur = undefined;
        charger();
      }, 120);
    });
    return () => {
      if (minuteur !== undefined) window.clearTimeout(minuteur);
      arret();
    };
  }, [clientId, charger]);
  React.useEffect(
    () =>
      canalEspace.ecouter((event) => {
        if (clientId || event.type !== 'espace.notification') return;
        const recu = event as { notification?: NotificationEspace; nonLues: number };
        setNonLues(recu.nonLues);
        const nouvelle = recu.notification;
        // Une ligne neuve ou prolongée remonte en tête ; une lecture faite
        // ailleurs (fiche ouverte, autre appareil) relit l'état lu.
        if (nouvelle) setListe((avant) => [nouvelle, ...(avant ?? []).filter((n) => n.id !== nouvelle.id)]);
        else charger();
      }),
    [charger, clientId],
  );

  const lire = (id?: string) => {
    setListe((avant) => avant?.map((n) => ((!id || n.id === id) && !n.luLe ? { ...n, luLe: Date.now() } : n)) ?? avant);
    void canalEspace
      .demander({ type: 'espace.notifications.lire', id })
      .then((reponse: { nonLues: number }) => setNonLues(reponse.nonLues))
      .catch(() => undefined);
  };

  const aller = (notification: NotificationEspace) => {
    // On referme AVANT de naviguer : la fiche visée ouvre son propre tiroir.
    setOuvert(false);
    if (!notification.luLe && !clientId) lire(notification.id);
    onAller(notification);
  };

  const libelle = nonLues ? t('{compte} notifications non lues', { compte: nonLues }) : t('Notifications');

  return (
    <>
      <Button
        size="icon-sm"
        variant={ouvert ? 'subtle' : 'ghost'}
        className="relative shrink-0"
        onClick={() => {
          setOuvert(true);
          charger();
        }}
        title={libelle}
        aria-label="notifications-espace"
        data-cloche-espace={clientId ? 'client' : ''}
      >
        {/* CE QUI EST À LIRE EST BLEU : la pastille commune, ton « lire ». */}
        <Bell className={cn('h-4 w-4', nonLues > 0 && 'text-info')} />
        <Pastille nombre={nonLues} ton="lire" position="coin" data-cloche-espace-pastille={nonLues} />
      </Button>

      <Drawer open={ouvert} onClose={() => setOuvert(false)} className="max-h-[80dvh]">
        <div className="flex shrink-0 items-center gap-2 px-3 pb-2">
          <Bell className="h-3.5 w-3.5 shrink-0 text-muted" />
          <span className="min-w-0 flex-1 text-[15.5px] font-semibold text-text">{t('Notifications')}</span>
          {nonLues && !clientId ? (
            <Button variant="ghost" size="sm" onClick={() => lire()} data-tout-lire-espace>
              <CheckCheck className="h-3 w-3" />
              {t('Tout marquer comme lu')}
            </Button>
          ) : null}
        </div>

        <ZoneDefilement classeEnveloppe="min-h-0 flex-1" className="px-2 pb-3" data-liste-cloche-espace>
          {liste === null ? (
            <div className="flex flex-col gap-3 px-1 py-2" data-silhouette-cloche-espace>
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="flex gap-2.5">
                  <Silhouette className="h-6 w-6 shrink-0 rounded-full" />
                  <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <Silhouette className="h-3.5 w-2/3" />
                    <Silhouette className="h-3 w-full" />
                  </div>
                </div>
              ))}
            </div>
          ) : liste.length ? (
            <ul className="flex flex-col">
              {liste.map((notification, index) => {
                const dernier = index === liste.length - 1;
                const icone = iconeDe(notification);
                const phrase = phraseDeNotification(notification, Boolean(clientId));
                return (
                  <li
                    key={notification.id}
                    className="relative flex gap-2.5"
                    data-notification-espace={notification.evenement}
                    data-non-lue={notification.luLe ? undefined : ''}
                  >
                    <div className="relative flex w-6 shrink-0 flex-col items-center">
                      {!dernier ? (
                        <span className="absolute bottom-[-0.5rem] left-1/2 top-6 w-px -translate-x-1/2 bg-faint/30" aria-hidden="true" />
                      ) : null}
                      <span
                        className={cn(
                          'relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 bg-surface',
                          bordureDIcone(icone),
                        )}
                      >
                        <IconeDeNotification icone={icone} classe="h-3 w-3 shrink-0" />
                      </span>
                    </div>
                    {/* UN BLOC, PAS UN `button` : le texte est replié, et un texte replié
                        ne se pose jamais dans un bouton. */}
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => aller(notification)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          aller(notification);
                        }
                      }}
                      className={cn(
                        'flex min-w-0 flex-1 cursor-pointer flex-col items-start gap-0.5 rounded-md px-2 py-1 pb-3 text-left transition-colors hover:bg-raised',
                        notification.luLe ? 'opacity-70' : 'bg-warning/5',
                      )}
                    >
                      <span className="flex w-full items-start gap-1.5">
                        <span className="min-w-0 flex-1 text-[13.5px] font-medium text-text">{phrase.titre}</span>
                        <span className="shrink-0 pt-0.5 text-[11px] text-faint">{relativeTime(notification.creeLe)}</span>
                      </span>
                      <span className="line-clamp-3 w-full text-[13px] text-muted">{phrase.texte}</span>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState
              icon={<Bell className="h-5 w-5" />}
              title={t('Aucune notification')}
              hint={clientId ? t('Ce qui bouge chez ce client apparaîtra ici.') : t('Ce qui bouge sur vos demandes apparaîtra ici.')}
            />
          )}
          {suite && liste?.length ? (
            <div className="flex justify-center pt-1">
              <Button variant="ghost" size="sm" onClick={() => charger(liste.at(-1)?.creeLe)} data-cloche-espace-suite>
                {t('Voir plus')}
              </Button>
            </div>
          ) : null}
        </ZoneDefilement>
      </Drawer>
    </>
  );
}
