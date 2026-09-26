import * as React from 'react';
import { Bell, CheckCheck } from 'lucide-react';
import { IconeDeNotification as IconeDeLigne, bordureDIcone } from './icone-notification';
import {
  LigneNotification,
  compteNonLues,
  journalDesNotifications,
  lieuAtteignable,
} from '@beluga/shared';
import { Button, Drawer, EmptyState, Pastille, ZoneDefilement } from '@/components/ui';
import { client } from '@/lib/client';
import { useApp } from '@/lib/use-app';
import { cn, relativeTime } from '@/lib/utils';
import { t } from '@/lib/langue';

/**
 * LA CLOCHE DU BANDEAU, ET SA LISTE UNIQUE.
 *
 * Avant, deux choses vivaient séparément et aucune ne se voyait vraiment : un
 * point d'interrogation n'apparaissant QUE s'il restait une question, et des
 * messages passagers qui s'effaçaient d'eux-mêmes en emportant tout ce que le
 * guichet de notifications avait annoncé. Une tâche terminée pendant qu'on
 * regardait ailleurs était perdue.
 *
 * Désormais : UNE cloche, toujours visible en haut à droite, et UN tiroir qui
 * réunit les deux sources — les demandes ouvertes en tête (elles bloquent), les
 * annonces reçues ensuite (elles se lisent). Le tri vit dans une règle pure,
 * `shared/src/journal-notifications.ts` ; ce fichier ne fait que la montrer.
 *
 * Le repère `data-repere-questions` reste posé sur la PASTILLE, et seulement
 * quand quelque chose attend : la cloche, elle, ne disparaît plus jamais.
 */
export function ClocheNotifications() {
  const state = useApp();
  const [open, setOpen] = React.useState(false);

  /*
   * LES PORTEURS QUE CE NAVIGATEUR CONNAÎT. Une annonce « une réponse est
   * attendue » survit dans le navigateur à ce dont elle parle : la carte
   * supprimée, la conversation de l'assistant d'une fiche de sauvegarde partie
   * avec sa fiche. La ligne restait alors orange, sans rien à ouvrir. On donne
   * donc à la règle ce qu'on sait — et elle n'efface QUE ce qu'elle peut
   * prouver absent.
   */
  const porteurs = React.useMemo(
    () => ({
      cartes: new Set(Object.keys(state.cards)),
      agents: new Set(Object.keys(state.agents)),
      /* …ET LES PROJETS DONT LES CARTES SONT VRAIMENT ARRIVÉES. Sans eux, une
         annonce parlant d'un projet jamais ouvert semblait sans porteur pour
         cette seule raison, et s'effaçait au bout d'une minute : on masquait
         une alerte qui comptait. */
      projetsCharges: new Set(
        Object.entries(state.cartesChargees)
          .filter(([, chargees]) => chargees)
          .map(([projectId]) => projectId),
      ),
    }),
    [state.cards, state.agents, state.cartesChargees],
  );

  const lignes = React.useMemo(
    () =>
      journalDesNotifications(
        state.decisions,
        state.annonces,
        { projetParDefaut: t('Projet'), sansTexte: t('Une décision est attendue.') },
        Date.now(),
        porteurs,
      ),
    [state.decisions, state.annonces, porteurs],
  );
  /*
   * DEUX SIGNAUX, ET PAS UN SEUL CHIFFRE POUR LES DEUX. Ce qui ATTEND une
   * décision porte la pastille chiffrée orange (`data-repere-questions`) :
   * c'est ce qui bloque quelqu'un, et ce compte doit rester exactement celui
   * qu'annoncent les triangles posés sur les projets. Ce qui est seulement À
   * LIRE — une tâche finie, une publication passée — ne mérite pas un chiffre :
   * un simple POINT sur la cloche suffit, et il s'éteint dès qu'on a ouvert le
   * tiroir. Mélanger les deux dans un même nombre ferait dire à la cloche
   * « 4 décisions » quand une seule attend vraiment.
   */
  const aRegler = lignes.filter((ligne) => ligne.source === 'demande').length;
  const nonLues = compteNonLues(state.decisions, state.annonces, Date.now(), porteurs);
  const aLire = nonLues - aRegler;

  const libelle = aRegler
    ? aRegler > 1
      ? t('{compte} décisions attendues de votre part', { compte: aRegler })
      : t('Une décision attendue de votre part')
    : aLire > 0
      ? t('{compte} notifications non lues', { compte: aLire })
      : t('Notifications');

  const ouvrir = () => {
    setOpen(true);
    // Le tiroir ouvert, tout ce qui s'y lit est lu. Les demandes, elles, ne se
    // lisent pas : elles se règlent, et gardent leur pastille jusque-là.
    client.marquerAnnoncesLues();
  };

  return (
    <>
      <Button
        variant="outline"
        size="icon"
        className="relative"
        aria-label={libelle}
        title={libelle}
        data-cloche-notifications
        onClick={ouvrir}
      >
        <Bell className={cn('h-4 w-4', aRegler > 0 && 'text-warning')} />
        {/* CE QUI ATTEND UNE RÉPONSE EST ORANGE : la pastille commune, ton « répondre ». */}
        {aRegler > 0 ? (
          <Pastille nombre={aRegler} ton="repondre" position="coin" data-repere-questions="" />
        ) : aLire > 0 ? (
          <span
            data-point-notifications
            className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-info"
          />
        ) : null}
      </Button>

      <TiroirNotifications open={open} onClose={() => setOpen(false)} lignes={lignes} aRegler={aRegler} />
    </>
  );
}

/** La couleur du rond posé sur la ligne centrale, selon le genre de la ligne. */
function bordureDeLigne(ligne: LigneNotification): string {
  if (ligne.source === 'demande') return 'border-warning';
  return bordureDIcone(ligne.icone);
}

/**
 * Le tiroir : la liste complète, dans un vrai tiroir latéral comme partout
 * ailleurs dans l'application — plus un menu déroulant qui se referme au
 * moindre écart de souris et qu'on ne peut pas faire défiler au doigt.
 */
function TiroirNotifications({
  open,
  onClose,
  lignes,
  aRegler,
}: {
  open: boolean;
  onClose: () => void;
  lignes: LigneNotification[];
  aRegler: number;
}) {
  const aller = (ligne: LigneNotification) => {
    // Une ligne est atteignable dès qu'elle nomme une carte, une conversation
    // ou un projet — le projet manquant se retrouve depuis la carte ou l'agent
    // (`allerVersDecision`). Exiger le projet éteignait le clic sur toutes les
    // décisions nées hors carte.
    if (!lieuAtteignable(ligne.lieu)) return;
    // On referme AVANT de naviguer : la carte ou la conversation visée ouvre
    // souvent son propre tiroir, et deux tiroirs empilés cacheraient ce qu'on
    // vient chercher.
    onClose();
    client.allerVersDecision(ligne.lieu);
  };

  return (
    <Drawer open={open} onClose={onClose} className="max-h-[80dvh]">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 pb-2">
        <Bell className="h-3.5 w-3.5 shrink-0 text-muted" />
        <span className="min-w-0 flex-1 text-[15.5px] font-semibold text-text">{t('Notifications')}</span>
        {lignes.length ? (
          <Button variant="ghost" size="sm" onClick={() => client.viderAnnonces()} data-vider-notifications>
            <CheckCheck className="h-3 w-3" />
            {t('Tout effacer')}
          </Button>
        ) : null}
      </div>

      {aRegler ? (
        <p className="shrink-0 px-3 py-1.5 text-[12.5px] text-warning" data-resume-notifications>
          {aRegler > 1
            ? t('{compte} décisions attendues de votre part', { compte: aRegler })
            : t('Une décision attendue de votre part')}
        </p>
      ) : null}

      <ZoneDefilement classeEnveloppe="min-h-0 flex-1" className="px-2 pb-3">
        {lignes.length ? (
          <ul className="flex flex-col">
            {lignes.map((ligne, index) => {
              const dernier = index === lignes.length - 1;
              return (
                <li key={ligne.cle} className="relative flex gap-2.5" data-notification {...(ligne.source === 'demande' ? { 'data-question-en-attente': '' } : {})}>
                  {/* LA LIGNE CENTRALE : un rond-icône par notification, relié
                      au suivant par un trait continu — même principe que la
                      ligne de temps de la recherche mémoire. */}
                  <div className="relative flex w-6 shrink-0 flex-col items-center">
                    {!dernier ? (
                      <span className="absolute left-1/2 top-6 bottom-[-0.5rem] w-px -translate-x-1/2 bg-faint/30" aria-hidden="true" />
                    ) : null}
                    <span
                      className={cn(
                        'relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 bg-surface',
                        bordureDeLigne(ligne),
                      )}
                    >
                      <IconeDeLigne icone={ligne.icone} classe="h-3 w-3 shrink-0" />
                    </span>
                  </div>

                  {/* UN BLOC, PAS UN `button` : le texte de la ligne est REPLIÉ
                      (`line-clamp-3`), et sous Safari un texte replié dans un
                      bouton fait réserver au parent la hauteur du texte entier.
                      Même clic, même clavier, même annonce aux lecteurs d'écran
                      — hauteur honnête. */}
                  <div
                    role={lieuAtteignable(ligne.lieu) ? 'button' : undefined}
                    tabIndex={lieuAtteignable(ligne.lieu) ? 0 : undefined}
                    data-notification-cliquable={lieuAtteignable(ligne.lieu) ? '' : undefined}
                    onClick={() => aller(ligne)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        aller(ligne);
                      }
                    }}
                    className={cn(
                      'flex min-w-0 flex-1 flex-col items-start gap-0.5 rounded-md px-2 py-1 pb-3 text-left transition-colors',
                      lieuAtteignable(ligne.lieu) ? 'cursor-pointer hover:bg-raised' : 'cursor-default',
                      ligne.source === 'demande' && 'bg-warning/5',
                      !ligne.nonLue && 'opacity-70',
                    )}
                  >
                    {/* LE TITRE EST CELUI DE LA NOTIFICATION PUSH : il porte
                        l'information et doit se lire EN ENTIER, jamais coupé
                        — la couleur la plus lisible de la palette, jamais
                        tronqué. La description vient juste en dessous, dans
                        une teinte plus atténuée qu'elle mais encore lisible. */}
                    <span className="flex w-full items-start gap-1.5">
                      <span className="min-w-0 flex-1 text-[13.5px] font-medium text-text">{ligne.titre}</span>
                      {ligne.a ? <span className="shrink-0 pt-0.5 text-[11px] text-faint">{relativeTime(ligne.a)}</span> : null}
                    </span>
                    <span className="line-clamp-3 w-full text-[13px] text-muted">{ligne.texte}</span>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyState
            icon={<Bell className="h-5 w-5" />}
            title={t('Aucune notification')}
            hint={t('Les questions en attente et les annonces des agents apparaîtront ici.')}
          />
        )}
      </ZoneDefilement>
    </Drawer>
  );
}
