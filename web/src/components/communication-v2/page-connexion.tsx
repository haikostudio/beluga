import * as React from 'react';
import { Loader2, Puzzle } from '@/components/ui/icones';
import { type CompteSocial, type ConnexionDUnReseau, type EtatDeLaLigneDeConnexion, type ReseauSocial } from '@beluga/shared';
import { Button, CLASSE_GROUPE_DE_LIGNES } from '@/components/ui';
import { LogoReseau } from '@/components/logos-reseaux';
import { SilhouetteMarketing } from '@/components/silhouettes';
import { AgentEnLigne } from '@/components/journal-de-l-agent';
import { PageV2 as PageEnPlace } from './page-v2';
import { Badge2, jouerUnGeste, useLecture } from '@/components/communication-v2/socle/pieces';
import { t } from '@/lib/langue';
import { cn } from '@/lib/utils';
import { useV2 } from './contexte';
import { ChampDeDemande, VIOLET } from './pieces';

interface LigneDeConnexion {
  reseau: ReseauSocial;
  libelle: string;
  comptes: CompteSocial[];
  connexion: ConnexionDUnReseau | null;
  etat: EtatDeLaLigneDeConnexion;
}

interface LectureConnexion {
  principal: string | null;
  chrome: { relies: number; ouverts: number };
  agent: { cardId: string; agentId: string } | null;
  reseaux: LigneDeConnexion[];
}

const A_CONNECTER: readonly EtatDeLaLigneDeConnexion[] = ['a_connecter', 'bloque', 'a_relier'];

/** Ouvre les réglages sur la rubrique de l'extension Chrome (relier un Chrome à Beluga). */
const ouvrirLesReglagesDeLExtension = () => window.dispatchEvent(new CustomEvent('beluga:ouvrir-reglages', { detail: { page: 'extension' } }));

/**
 * ÉTAPE 3 — LA CONNEXION (carte « Réseaux sociaux reliés par Chrome », 09/11/2026) : une ligne par réseau CHOISI.
 * « Connecter » (ou « Tout connecter ») ouvre UN agent pour la marque, dans le Chrome de la personne qui clique : il
 * reprend les accès du coffre, sinon crée la boîte e-mail de la marque et le compte, tente la voie officielle, puis
 * passe par Chrome. Son travail défile SOUS la ligne du réseau qu'il traite, et sa question s'y répond. Chaque ligne
 * finit sur « Publication officielle », « Publication par Chrome » ou le blocage dit en clair — jamais « connecté »
 * sans compte relié en base.
 */
export function PageConnexion() {
  const { marque } = useV2();
  const { donnees, erreur } = useLecture<LectureConnexion>({ type: 'communication.connexion', marqueId: marque.id }, [marque.id]);
  const [envoi, setEnvoi] = React.useState<string | null>(null);
  const champ = <ChampDeDemande invite={t('Demander au chef à propos de vos réseaux…')} genre="canaux" preparation={t('Le chef regarde vos réseaux…')} repere="connexion" />;
  if (erreur && !donnees) {
    return (
      <PageEnPlace titre={t('Connexion')} invite={null}>
        <p className="text-[13px] text-danger">{erreur}</p>
      </PageEnPlace>
    );
  }
  if (!donnees) {
    return (
      <PageEnPlace titre={t('Connexion')} invite={null}>
        <SilhouetteMarketing />
      </PageEnPlace>
    );
  }
  const { principal, chrome, agent, reseaux } = donnees;
  const sansChrome = chrome.ouverts === 0;
  const restants = reseaux.filter((r) => A_CONNECTER.includes(r.etat));
  const connectes = reseaux.filter((r) => r.etat === 'officiel' || r.etat === 'chrome').length;
  const connecter = async (cles: ReseauSocial[], repere: string) => {
    if (!principal || !cles.length) return;
    setEnvoi(repere);
    await jouerUnGeste('compte.connecter', principal, { reseaux: cles });
    setEnvoi(null);
  };
  /* L'agent traite les réseaux dans l'ordre de la liste : son travail se lit sous le premier encore « en cours ». */
  const traite = agent ? reseaux.find((r) => r.etat === 'en_cours')?.reseau ?? null : null;
  const raisonEteinte = sansChrome ? t('Ouvrez Chrome avec l’extension Beluga : l’agent y travaille.') : agent ? t('Un agent connecte déjà vos réseaux.') : undefined;
  return (
    <PageEnPlace
      titre={t('Connexion')}
      sousTitre={reseaux.length ? t('Étape 2 sur 3 · {n} sur {m} connecté(s)', { n: connectes, m: reseaux.length }) : t('Étape 2 sur 3 · connectez vos réseaux')}
      droite={
        restants.length > 1 ? (
          <span title={raisonEteinte}>
            <Button size="sm" disabled={!!raisonEteinte || envoi !== null} onClick={() => void connecter(restants.map((r) => r.reseau), 'tout')} data-v2-tout-connecter={restants.length}>
              {envoi === 'tout' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              {t('Tout connecter')}
            </Button>
          </span>
        ) : null
      }
      pied={champ}
      data-v2-connexion={reseaux.length}
    >
      <p className="text-[13px] text-muted">{t('Un agent connecte chaque réseau dans votre Chrome : il reprend les accès du coffre, sinon crée la boîte e-mail de la marque et le compte. Il tente la voie officielle du réseau, sinon les posts partiront par Chrome.')}</p>
      {sansChrome ? (
        <div className="flex min-w-0 flex-col gap-2 rounded-xl bg-surface px-3.5 py-3 sm:flex-row sm:items-center" data-v2-connexion-sans-chrome={chrome.relies ? 'ferme' : 'aucun'}>
          <Puzzle className="h-4 w-4 shrink-0 text-muted" />
          <span className="min-w-0 flex-1 text-[13px] text-text">
            {chrome.relies ? t('Votre Chrome est fermé : ouvrez-le avec l’extension Beluga pour connecter vos réseaux.') : t('Aucun Chrome n’est relié à votre compte : installez l’extension Beluga pour connecter vos réseaux.')}
          </span>
          {chrome.relies ? null : (
            <Button size="sm" variant="subtle" onClick={ouvrirLesReglagesDeLExtension} data-v2-relier-chrome>
              {t('Relier Chrome')}
            </Button>
          )}
        </div>
      ) : null}
      {reseaux.length ? (
        <ul className={cn(CLASSE_GROUPE_DE_LIGNES, 'min-w-0')} data-v2-liste-connexion>
          {reseaux.map((r) => (
            <li key={r.reseau} className="flex min-w-0 flex-col gap-2 rounded-xl px-3.5 py-3" data-v2-ligne-connexion={r.reseau} data-etat={r.etat}>
              <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
                <span className="flex min-w-0 flex-1 items-center gap-3">
                  <LogoReseau reseau={r.reseau} className="h-5 w-5 shrink-0" />
                  <span className="min-w-0">
                    <b className="block truncate text-[13.5px] font-semibold text-text">{r.libelle}</b>
                    <EtatEnClair ligne={r} />
                  </span>
                </span>
                <span className="flex shrink-0 items-center justify-end">
                  {r.etat === 'officiel' ? (
                    <Badge2 ton="vert">{t('Publication officielle')}</Badge2>
                  ) : r.etat === 'chrome' ? (
                    <Badge2 ton="vert">{t('Publication par Chrome')}</Badge2>
                  ) : r.etat === 'en_cours' ? (
                    <span className={cn('inline-flex items-center gap-1.5 text-[12.5px] font-medium', VIOLET.texte)}>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      {t('En cours')}
                    </span>
                  ) : (
                    <span title={raisonEteinte}>
                      <Button size="sm" disabled={!!raisonEteinte || envoi !== null || !principal} onClick={() => void connecter([r.reseau], r.reseau)} data-v2-connecter={r.reseau}>
                        {envoi === r.reseau ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                        {r.etat === 'bloque' ? t('Réessayer') : r.etat === 'a_relier' ? t('Connecter de nouveau') : t('Connecter')}
                      </Button>
                    </span>
                  )}
                </span>
              </div>
              {agent && traite === r.reseau ? (
                <AgentEnLigne agentId={agent.agentId} champ={false} classeTexte={VIOLET.texte} enAttente={t('L’agent ouvre votre Chrome…')} repere={`connexion-${r.reseau}`} />
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-xl bg-surface px-3.5 py-3 text-[13px] text-muted" data-v2-connexion-vide>
          {t('Aucun réseau choisi : cochez d’abord vos réseaux à l’étape Réseaux.')}
        </p>
      )}
    </PageEnPlace>
  );
}

/** La phrase grise sous le nom du réseau : le compte connecté, ce que fait l'agent, ou ce qui bloque. */
function EtatEnClair({ ligne }: { ligne: LigneDeConnexion }) {
  const compte = ligne.comptes.find((c) => c.etat === 'relie')?.nom ?? ligne.connexion?.compte;
  const texte =
    ligne.etat === 'officiel' || ligne.etat === 'chrome'
      ? compte ?? t('Connecté')
      : ligne.etat === 'en_cours'
        ? t('L’agent connecte ce réseau dans votre Chrome.')
        : ligne.etat === 'bloque'
          ? ligne.connexion?.note ?? t('L’agent a été bloqué sur ce réseau.')
          : ligne.etat === 'a_relier'
            ? t('L’accès a expiré : connectez-le de nouveau.')
            : t('Pas encore connecté.');
  return <span className={cn('line-clamp-2 block text-[12px] leading-snug', ligne.etat === 'bloque' ? 'text-danger' : 'text-muted')}>{texte}</span>;
}
