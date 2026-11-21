import * as React from 'react';
import { Hash, Loader2, Power, Smartphone, Square, TerminalSquare } from '@/components/ui/icones';
import { Button, ConfirmDialog } from '@/components/ui';
import { Groupe } from '@/components/reglages/communs';
import { COULEUR_DU_POINT_DE_REDEMARRAGE, useRedemarrage } from '@/components/redemarrage';
import { client } from '@/lib/client';
import { t } from '@/lib/langue';
import { ouvrirLeTerminal } from '@/lib/ouvrir-terminal';
import { plateformeNative, versionNative } from '@/lib/natif';
import { useApp } from '@/lib/use-app';
import { cn, heureDuMessage } from '@/lib/utils';
import { SectionSysteme } from '@/components/reglages/page-capacite';
import {
  CourbesDuServeur,
  ExplorateurDuServeur,
  FicheDeLaMachineVue,
  LesPlusLourds,
  useFicheDuServeur,
} from '@/components/reglages/serveur-machine';

/**
 * LA PAGE « SERVEUR » RÉUNIT TOUT CE QUI PARLE DE LA MACHINE (demande du
 * 06/11/2026) : la fiche (adresses, vCPU, mémoire, disques — stockage externe
 * compris), les courbes (processeur et mémoire sur 24 h, disques sur 30 jours),
 * les dix éléments les plus lourds avec l'explorateur en lecture seule, puis
 * l'ancienne page « Capacité du système » (places des agents, processus) et
 * les trois gestes sur la machine. L'adresse « capacite » mène ici
 * (`settings-view.tsx`).
 *
 * Sur un serveur loué (offre hébergée) : fiche et courbes seulement — ni les
 * plus lourds, ni l'explorateur, ni le ménage, que le démon refuse aussi.
 *
 * Repères : `data-fiche-serveur`, `data-courbes-serveur`, `data-plus-lourds`,
 * `data-parcourir-dossiers`, `data-explorateur-serveur`.
 */

/**
 * CE QUI AGIT SUR LA MACHINE ENTIÈRE : redémarrer le serveur, ouvrir son
 * terminal, arrêter tous les agents. Ces trois gestes vivaient dans le menu
 * « … » de la barre d'en-tête, qu'on n'a pas sous la main sur tous les écrans
 * et qui ne garde plus que ce qui concerne la page affichée (demande du
 * 11/10/2026). Les réglages, eux, s'ouvrent de partout.
 *
 * Repères des contrôles : `data-bouton-redemarrage="reglages"` et
 * `data-etat-redemarrage` sur le redémarrage, `data-terminal-bouton` sur le
 * terminal, `data-arreter-tous-les-agents` sur l'arrêt général.
 */
export function SectionServeur() {
  const state = useApp();
  const offreHebergee = state.offreHebergee;
  const fiche = useFicheDuServeur();
  const [explorateur, setExplorateur] = React.useState<string | null>(null);

  return (
    <div className="flex flex-col gap-7" data-reglages-serveur>
      <VersionEnLigne />

      <Groupe titre={t('La machine')}>
        <FicheDeLaMachineVue donnees={fiche} />
      </Groupe>

      <Groupe titre={t('Au fil du temps')}>
        <CourbesDuServeur donnees={fiche} />
      </Groupe>

      {!offreHebergee ? <LesPlusLourds onParcourir={setExplorateur} /> : null}

      <SectionSysteme />

      {!offreHebergee ? (
        <ExplorateurDuServeur chemin={explorateur} onChemin={setExplorateur} onClose={() => setExplorateur(null)} />
      ) : null}
    </div>
  );
}

/**
 * LES GESTES SUR LE SERVEUR — page « avancée » de la rubrique Serveur (refonte des réglages, 21/11/2026) :
 * redémarrer, ouvrir le terminal (volet du bas, `ouvrirLeTerminal`), arrêter tous les agents.
 */
export function SectionGestesServeur() {
  const state = useApp();
  const offreHebergee = state.offreHebergee;
  const redemarrage = useRedemarrage();
  const [arretTous, setArretTous] = React.useState(false);

  // « starting » compte aussi : un tour resté coincé dans sa préparation est
  // justement celui qu'on veut pouvoir arrêter.
  const enCours = Object.values(state.agents).filter(
    (agent) => agent.status === 'running' || agent.status === 'starting',
  ).length;

  /*
   * L'ARRÊT DE TOUS LES AGENTS DIT CE QU'IL A FAIT, geste par geste. Le serveur
   * rend le bilan rédigé (`bilanDesArrets`) : on ne recompose rien ici, et on
   * n'annonce pas une réussite sur un nombre qui ne dit pas si le clic a mordu.
   */
  const arreterTousLesAgents = () =>
    client
      .call<{ count?: number; bilan?: { message?: string } }>({ type: 'agents.stop-all' })
      .then((response) => {
        const message = response?.bilan?.message;
        if (message) client.pushToast('info', message);
      })
      .catch((err: any) => {
        client.pushToast('error', err?.message ?? t('Arrêt refusé'));
      });

  return (
    <div className="flex flex-col gap-7" data-reglages-gestes-serveur>
      <Groupe titre={t('Gestes sur le serveur')} description={t('Ils agissent sur la machine entière, tous projets confondus.')} liste>
          <Ligne
            icone={redemarrage.repart ? <Loader2 className="h-4 w-4 animate-spin" /> : <Power className="h-4 w-4" />}
            titre={redemarrage.libelle}
            detail={redemarrage.raison ?? undefined}
            point={COULEUR_DU_POINT_DE_REDEMARRAGE[redemarrage.etat]}
          >
            <Button
              variant="subtle"
              size="sm"
              disabled={redemarrage.repart}
              onClick={redemarrage.ouvrir}
              data-bouton-redemarrage="reglages"
              data-etat-redemarrage={redemarrage.etat}
            >
              {t('Redémarrer')}
            </Button>
          </Ligne>
          {/* Le terminal est fermé sur un serveur loué (offre hébergée). */}
          {!offreHebergee ? (
            <Ligne icone={<TerminalSquare className="h-4 w-4" />} titre={t('Terminal du serveur')}>
              <Button variant="subtle" size="sm" onClick={ouvrirLeTerminal} data-terminal-bouton>
                {t('Ouvrir')}
              </Button>
            </Ligne>
          ) : null}
          <Ligne
            icone={<Square className="h-3.5 w-3.5 fill-current" />}
            titre={t('Arrêter tous les agents')}
            detail={enCours ? t('{n} agent(s) au travail', { n: enCours }) : t('Aucun agent au travail')}
          >
            <Button
              variant="arret"
              size="sm"
              disabled={!enCours}
              onClick={() => setArretTous(true)}
              data-arreter-tous-les-agents={enCours}
            >
              {t('Arrêter')}
            </Button>
          </Ligne>
      </Groupe>

      {redemarrage.dialogue}

      <ConfirmDialog
        open={arretTous}
        danger
        title={
          enCours > 1
            ? t('Arrêter les {v0} agents en cours sur tous les projets ?', { v0: enCours })
            : t('Arrêter l’agent en cours ?')
        }
        description={t('Chaque moteur est coupé sur-le-champ, sur tous les projets. Le travail déjà écrit reste sur la branche de sa carte ; c’est la réflexion en cours qui s’arrête.')}
        confirmLabel={t('Arrêter tous les agents')}
        onConfirm={() => {
          void arreterTousLesAgents();
          setArretTous(false);
        }}
        onClose={() => setArretTous(false)}
      />
    </div>
  );
}

/**
 * LA VERSION EN LIGNE (décision de l'utilisateur du 16/11/2026) : de quoi savoir d'un coup d'œil si l'écran affiché
 * porte le dernier travail. L'écran en ligne : son empreinte (celle du cache de l'application installable, `sw.js`),
 * sa date de mise en ligne et son commit, lus dans `version.json` que la construction dépose à côté du paquet
 * (`web/empreinte-paquet.ts`). L'application iPhone ou Mac : son numéro de version (`__belugaNatif.version`), qui
 * n'avance que quand la coque elle-même change. Repères : `data-version-en-ligne`, `data-version-native`.
 */
interface VersionDuPaquet {
  empreinte: string;
  construitA: number;
  commit?: string;
}

function VersionEnLigne() {
  const [paquet, setPaquet] = React.useState<VersionDuPaquet | null | 'absent'>(null);
  React.useEffect(() => {
    let vivant = true;
    fetch('/version.json', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((v) => {
        if (!vivant) return;
        setPaquet(v && typeof v.empreinte === 'string' && typeof v.construitA === 'number' ? v : 'absent');
      })
      .catch(() => vivant && setPaquet('absent'));
    return () => {
      vivant = false;
    };
  }, []);
  const natif = versionNative();
  const plateforme = plateformeNative();
  const detailEcran =
    paquet === null
      ? t('Lecture…')
      : paquet === 'absent'
        ? t('Version de développement : rien n’a encore été mis en ligne depuis ce dossier.')
        : t('Mis en ligne : {v0}', { v0: heureDuMessage(paquet.construitA) });
  return (
    <Groupe titre={t('Version')} liste>
      <>
        <Ligne icone={<Hash className="h-4 w-4" />} titre={t('Écran en ligne')} detail={detailEcran}>
          <span className="font-mono text-[12.5px] text-muted" data-version-en-ligne={paquet && paquet !== 'absent' ? paquet.empreinte : ''}>
            {paquet && paquet !== 'absent' ? [paquet.commit, paquet.empreinte.slice(0, 8)].filter(Boolean).join(' · ') : '—'}
          </span>
        </Ligne>
        {natif ? (
          <Ligne
            icone={<Smartphone className="h-4 w-4" />}
            titre={plateforme === 'mac' ? t('Application Mac') : t('Application iPhone')}
            detail={t('Elle n’avance que quand l’application elle-même change ; vos écrans, eux, suivent la mise en ligne.')}
          >
            <span className="font-mono text-[12.5px] text-muted" data-version-native={natif}>
              {natif}
            </span>
          </Ligne>
        ) : null}
      </>
    </Groupe>
  );
}

/** Une ligne du groupe : ce que fait le geste à gauche, son bouton à droite. */
function Ligne({
  icone,
  titre,
  detail,
  point,
  children,
}: {
  icone: React.ReactNode;
  titre: string;
  detail?: string;
  /** La couleur du point d'état, quand la ligne en porte un. */
  point?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl px-3.5 py-3">
      <span className="flex h-4 w-4 shrink-0 items-center justify-center text-muted">{icone}</span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-[14px] text-text">
          <span className="min-w-0 truncate">{titre}</span>
          {point ? <span aria-hidden className={cn('h-1.5 w-1.5 shrink-0 rounded-full', point)} /> : null}
        </span>
        {detail ? <span className="mt-0.5 block text-[12.5px] leading-relaxed text-muted">{detail}</span> : null}
      </span>
      <span className="shrink-0">{children}</span>
    </div>
  );
}
