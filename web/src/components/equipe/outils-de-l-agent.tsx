/*
 * LES OUTILS D'UN AGENT, UN PAR ONGLET DE SON VOLET (carte « Beluga piloté par des agents », 26/11/2026, maquettes
 * #383ee, #b7167). Les services ne disparaissent pas : ils s'ouvrent PAR L'AGENT qui en a la charge. Chaque onglet
 * montre l'essentiel, borné au projet — les tâches et l'aperçu du site (développement), le calendrier des publications
 * et les comptes reliés (communication), le dossier, le référencement et les statistiques (marketing), la mise en ligne
 * (déploiement : le MÊME contenu que l'ancien menu « Publier », avec son vrai bouton), l'état du site, les sauvegardes
 * et la sécurité (production) —, et son pied ouvre le service entier, limité au projet.
 */
import * as React from 'react';
import { construireFragment, type Card, type EcranNavigateur, type OutilDAgent } from '@beluga/shared';
import { TachesDeLEquipe } from '@/components/equipe/taches-de-l-equipe';
import { CLASSE_BOUTON_DU_PIED } from '@/components/equipe/gabarit-discussion-volet';
import type { MembreLu } from '@/components/equipe/use-equipe';
import { ContenuPublier } from '@/components/menu-publier';
import { VoletApercu } from '@/components/volet-apercu';
import { SilhouetteRubrique } from '@/components/silhouettes';
import { ArrowUpRight } from '@/components/ui/icones';
import { naviguerVers } from '@/components/ui/lien-interne';
import { client } from '@/lib/client';
import { useApp } from '@/lib/use-app';
import { formatRegional, t } from '@/lib/langue';
import { cn } from '@/lib/utils';

export function libelleDeLOutil(o: OutilDAgent | 'fiche'): string {
  switch (o) {
    case 'taches':
      return t('Tâches');
    case 'apercu':
      return t('Aperçu');
    case 'calendrier':
      return t('Calendrier');
    case 'reseaux':
      return t('Réseaux');
    case 'studio':
      return t('Studio');
    case 'dossier':
      return t('Dossier');
    case 'referencement':
      return t('Référencement');
    case 'statistiques':
      return t('Statistiques');
    case 'mise-en-ligne':
      return t('Mise en ligne');
    case 'etat-du-site':
      return t('État du site');
    case 'sauvegardes':
      return t('Sauvegardes');
    case 'securite':
      return t('Sécurité');
    case 'messagerie':
      return t('Messagerie');
    default:
      return t('Fiche');
  }
}

/** L'écran du service entier, limité au projet. */
function ecranDuService(o: OutilDAgent, projectId: string, marqueId: string | null): EcranNavigateur | null {
  const portee = { portee: projectId };
  switch (o) {
    case 'calendrier':
      return marqueId ? { vue: 'communication2', chemin: `${marqueId}/calendrier` } : { vue: 'communication2', ...portee };
    case 'reseaux':
      return marqueId ? { vue: 'communication2', chemin: `${marqueId}/connexion` } : { vue: 'communication2', ...portee };
    case 'studio':
      return { vue: 'studio', ...portee };
    case 'dossier':
    case 'referencement':
      return { vue: 'marketing2', ...portee };
    case 'statistiques':
      return { vue: 'statistiques', ...portee };
    case 'etat-du-site':
      return { vue: 'surveillance', ...portee };
    case 'sauvegardes':
      return { vue: 'backups', ...portee };
    case 'securite':
      return { vue: 'securite', projetId: projectId };
    case 'messagerie':
      return { vue: 'espace', ...portee } as EcranNavigateur;
    default:
      return null;
  }
}

/** Ce que l'onglet dit faire, en une phrase, au-dessus de ce qu'il montre. */
function phraseDeLOutil(o: OutilDAgent): string {
  switch (o) {
    case 'studio':
      return t('Les visuels et les vidéos du projet se fabriquent dans le Studio, avec son directeur artistique.');
    case 'dossier':
      return t('Le dossier marketing du projet : études de marché, concurrents, offres et recommandations.');
    case 'referencement':
      return t('Le référencement du projet sur Google et sur les moteurs des IA : notes, points à corriger, historique.');
    case 'statistiques':
      return t('Les visites du site du projet : d’où elles viennent, ce qu’elles regardent, ce qu’elles font.');
    case 'messagerie':
      return t('Les demandes des clients du projet et leurs fils de discussion.');
    default:
      return '';
  }
}

function useApercuDeLOutil<T>(projectId: string, outil: OutilDAgent, actif: boolean): { donnees: T | null; erreur: string | null } {
  const version = useApp().agentsPersoVersions[projectId] ?? 0;
  const [etat, setEtat] = React.useState<{ donnees: T | null; erreur: string | null }>({ donnees: null, erreur: null });
  React.useEffect(() => {
    if (!actif) return;
    let vivant = true;
    client
      .call<T>({ type: 'equipe.outil', projectId, outil }, 30000)
      .then((r) => vivant && setEtat({ donnees: r, erreur: null }))
      .catch((err: any) => vivant && setEtat({ donnees: null, erreur: err?.message ?? t('Lecture impossible') }));
    return () => {
      vivant = false;
    };
  }, [projectId, outil, actif, version]);
  return etat;
}

interface ApercuDeCommunication {
  marqueId: string | null;
  contenus: { id: string; titre: string; texte: string; canal: string; datePrevue: string | null; heurePrevue: string | null; etape: string }[];
  comptes: { id: string; reseau: string; nom: string; etat: string }[];
}

/** LE CONTENU D'UN ONGLET D'OUTIL. Le pied (bouton du bas) est rendu à part, par `PiedDeLOutil`. */
export function ContenuDeLOutil({
  outil,
  projectId,
  membres,
  onOuvrirCarte,
  onFermerLApercu,
}: {
  outil: OutilDAgent;
  projectId: string;
  membres: readonly MembreLu[];
  onOuvrirCarte: (card: Card) => void;
  onFermerLApercu: () => void;
}) {
  const projet = useApp().projects.find((p) => p.id === projectId);
  switch (outil) {
    case 'taches':
      return <TachesDeLEquipe projectId={projectId} membres={membres} onOuvrir={onOuvrirCarte} />;
    case 'apercu':
      return projet?.devUrl?.trim() ? (
        <div className="-mx-5 flex h-full min-h-[480px] flex-col" data-outil-apercu={projectId}>
          <VoletApercu adresse={projet.devUrl.trim()} projectId={projectId} onFermer={onFermerLApercu} />
        </div>
      ) : (
        <p className="pt-1 text-[13.5px] text-muted" data-outil-sans-apercu="">
          {t('Ce projet n’a pas encore d’adresse d’essai : elle se règle dans les paramètres du projet.')}
        </p>
      );
    case 'calendrier':
      return <CalendrierDuProjet projectId={projectId} />;
    case 'reseaux':
      return <ComptesDuProjet projectId={projectId} />;
    case 'mise-en-ligne':
      return (
        <div className="-mx-3" data-outil-mise-en-ligne={projectId}>
          <ContenuPublier projectId={projectId} onFini={() => undefined} />
        </div>
      );
    case 'etat-du-site':
      return <EtatDuSite projectId={projectId} />;
    case 'sauvegardes':
      return <SauvegardesDuProjet projectId={projectId} />;
    case 'securite':
      return <SecuriteDuProjet projectId={projectId} />;
    default:
      return (
        <p className="pt-1 text-[13.5px] text-muted" data-outil-porte={outil}>
          {phraseDeLOutil(outil)}
        </p>
      );
  }
}

/** LE PIED D'UN ONGLET D'OUTIL : « Ouvrir <service> », limité au projet ; rien pour la mise en ligne (son bouton est dedans). */
export function PiedDeLOutil({ outil, projectId }: { outil: OutilDAgent; projectId: string }) {
  const communication = outil === 'calendrier' || outil === 'reseaux';
  const { donnees } = useApercuDeLOutil<ApercuDeCommunication>(projectId, outil, communication);
  if (outil === 'taches' || outil === 'apercu' || outil === 'mise-en-ligne') return null;
  const ecran = ecranDuService(outil, projectId, communication ? (donnees?.marqueId ?? null) : null);
  if (!ecran) return null;
  return (
    <button
      type="button"
      onClick={() => naviguerVers(construireFragment(ecran))}
      className={CLASSE_BOUTON_DU_PIED}
      data-ouvrir-le-service={outil}
    >
      <ArrowUpRight />
      <span className="min-w-0 truncate">{t('Ouvrir : {v0}', { v0: libelleDeLOutil(outil) })}</span>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Communication                                                       */
/* ------------------------------------------------------------------ */

function jourLisible(date: string): { jour: string; semaine: string } {
  const d = new Date(`${date}T12:00:00`);
  const lundi = new Date(d);
  lundi.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return {
    jour: d.toLocaleDateString(formatRegional(), { weekday: 'short', day: 'numeric' }),
    semaine: t('Semaine du {v0}', { v0: lundi.toLocaleDateString(formatRegional(), { day: 'numeric', month: 'long' }) }),
  };
}

function libelleDEtape(etape: string): { texte: string; attend: boolean } {
  switch (etape) {
    case 'a_valider':
      return { texte: t('À valider'), attend: true };
    case 'brouillon':
      return { texte: t('Brouillon'), attend: false };
    case 'pret':
      return { texte: t('Prête'), attend: false };
    case 'programme':
      return { texte: t('Programmée'), attend: false };
    case 'publie':
      return { texte: t('Publiée'), attend: false };
    case 'echec':
      return { texte: t('Échec'), attend: true };
    default:
      return { texte: t('Abandonnée'), attend: false };
  }
}

/** LE CALENDRIER DES PUBLICATIONS DU PROJET (maquette #4bde6) : par semaine, jour et réseau, le texte, et l'état. */
function CalendrierDuProjet({ projectId }: { projectId: string }) {
  const { donnees, erreur } = useApercuDeLOutil<ApercuDeCommunication>(projectId, 'calendrier', true);
  if (erreur) return <p className="text-[13px] text-danger">{erreur}</p>;
  if (!donnees) return <SilhouetteRubrique />;
  if (!donnees.contenus.length)
    return (
      <p className="pt-1 text-[13.5px] text-muted" data-calendrier-vide="">
        {donnees.marqueId
          ? t('Aucune publication prévue. Demandez à l’agent de communication de préparer les prochaines.')
          : t('Ce projet n’a pas encore d’espace de communication : l’agent de communication le crée à votre demande.')}
      </p>
    );
  const semaines = new Map<string, ApercuDeCommunication['contenus']>();
  for (const c of donnees.contenus) {
    const cle = c.datePrevue ? jourLisible(c.datePrevue).semaine : t('Sans date');
    semaines.set(cle, [...(semaines.get(cle) ?? []), c]);
  }
  return (
    <div className="flex flex-col gap-5" data-calendrier-du-projet={donnees.contenus.length}>
      {[...semaines.entries()].map(([semaine, contenus]) => (
        <section key={semaine}>
          <h3 className="px-1 pb-1 text-[13px] text-faint">{semaine}</h3>
          <ul className="flex flex-col">
            {contenus.map((c) => {
              const etape = libelleDEtape(c.etape);
              return (
                <li key={c.id} className="flex min-w-0 items-start gap-4 rounded-xl px-1 py-2.5" data-publication-du-calendrier={c.id}>
                  <span className="w-[68px] shrink-0">
                    <span className="block text-[13.5px] font-semibold capitalize text-text">{c.datePrevue ? jourLisible(c.datePrevue).jour : '—'}</span>
                    <span className="block truncate text-[12px] capitalize text-faint">{c.canal}</span>
                  </span>
                  <span className="min-w-0 flex-1 text-[13.5px] leading-snug text-text">{c.titre || c.texte}</span>
                  <span className={cn('shrink-0 whitespace-nowrap text-[12.5px]', etape.attend ? 'font-medium text-important' : 'text-muted')}>{etape.texte}</span>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** LES COMPTES RELIÉS DU PROJET (réseaux sociaux) et leur état. */
function ComptesDuProjet({ projectId }: { projectId: string }) {
  const { donnees, erreur } = useApercuDeLOutil<ApercuDeCommunication>(projectId, 'reseaux', true);
  if (erreur) return <p className="text-[13px] text-danger">{erreur}</p>;
  if (!donnees) return <SilhouetteRubrique />;
  if (!donnees.comptes.length)
    return <p className="pt-1 text-[13.5px] text-muted">{t('Aucun compte relié pour ce projet. Ils se relient depuis la Communication.')}</p>;
  return (
    <ul className="flex flex-col" data-comptes-du-projet={donnees.comptes.length}>
      {donnees.comptes.map((c) => (
        <li key={c.id} className="flex min-w-0 items-center gap-3 px-1 py-2.5">
          <span className="w-[92px] shrink-0 truncate text-[13.5px] font-semibold capitalize text-text">{c.reseau}</span>
          <span className="min-w-0 flex-1 truncate text-[13.5px] text-text">{c.nom}</span>
          <span className={cn('shrink-0 text-[12.5px]', c.etat === 'actif' || c.etat === 'relie' ? 'text-muted' : 'font-medium text-important')}>
            {c.etat === 'actif' || c.etat === 'relie' ? t('Relié') : t('À reconnecter')}
          </span>
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------ */
/* Production                                                          */
/* ------------------------------------------------------------------ */

function quand(at: number | null | undefined): string {
  if (!at) return '—';
  return new Date(at).toLocaleString(formatRegional(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function EtatDuSite({ projectId }: { projectId: string }) {
  const { donnees, erreur } = useApercuDeLOutil<{ sites: { id: string; nom: string; url: string; etat: string; dernierePanne: number | null }[] }>(projectId, 'etat-du-site', true);
  if (erreur) return <p className="text-[13px] text-danger">{erreur}</p>;
  if (!donnees) return <SilhouetteRubrique />;
  if (!donnees.sites.length) return <p className="pt-1 text-[13.5px] text-muted">{t('Aucun site surveillé pour ce projet : l’agent de production peut en poser la surveillance.')}</p>;
  return (
    <ul className="flex flex-col" data-etat-du-site={donnees.sites.length}>
      {donnees.sites.map((s) => (
        <li key={s.id} className="flex min-w-0 items-center gap-3 px-1 py-2.5">
          <span aria-hidden className={cn('block h-2 w-2 shrink-0 rounded-full', s.etat === 'ok' ? 'bg-pret' : s.etat === 'inconnu' ? 'bg-faint' : 'bg-danger')} />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-[14px] font-medium text-text">{s.nom}</span>
            <span className="truncate text-[12.5px] text-faint">{s.url}</span>
          </span>
          <span className="shrink-0 text-[12.5px] text-muted">{s.dernierePanne ? t('Dernière panne : {v0}', { v0: quand(s.dernierePanne) }) : t('Aucune panne')}</span>
        </li>
      ))}
    </ul>
  );
}

function SauvegardesDuProjet({ projectId }: { projectId: string }) {
  const { donnees, erreur } = useApercuDeLOutil<{ sites: { id: string; nom: string; dernier: { statut: string; fin: number; detail: string } | null }[] }>(projectId, 'sauvegardes', true);
  if (erreur) return <p className="text-[13px] text-danger">{erreur}</p>;
  if (!donnees) return <SilhouetteRubrique />;
  if (!donnees.sites.length) return <p className="pt-1 text-[13.5px] text-muted">{t('Aucune sauvegarde réglée pour ce projet.')}</p>;
  return (
    <ul className="flex flex-col" data-sauvegardes-du-projet={donnees.sites.length}>
      {donnees.sites.map((s) => (
        <li key={s.id} className="flex min-w-0 items-center gap-3 px-1 py-2.5">
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-[14px] font-medium text-text">{s.nom}</span>
            <span className="truncate text-[12.5px] text-faint">{s.dernier ? t('Dernier point : {v0}', { v0: quand(s.dernier.fin) }) : t('Aucun point pour l’instant')}</span>
          </span>
          {s.dernier ? (
            <span className={cn('shrink-0 text-[12.5px]', s.dernier.statut === 'echec' ? 'font-medium text-danger' : 'text-muted')}>
              {s.dernier.statut === 'echec' ? t('Échec') : s.dernier.statut === 'partiel' ? t('Partiel') : t('Réussi')}
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function SecuriteDuProjet({ projectId }: { projectId: string }) {
  const { donnees, erreur } = useApercuDeLOutil<{ suivi: boolean; audits: { id: string; lance: number; fini: number | null; note?: number; erreur?: string }[] }>(projectId, 'securite', true);
  if (erreur) return <p className="text-[13px] text-danger">{erreur}</p>;
  if (!donnees) return <SilhouetteRubrique />;
  if (!donnees.suivi) return <p className="pt-1 text-[13.5px] text-muted">{t('La sécurité de ce projet n’est pas encore suivie : le service Sécurité l’ajoute en un clic.')}</p>;
  if (!donnees.audits.length) return <p className="pt-1 text-[13.5px] text-muted">{t('Aucun audit pour l’instant.')}</p>;
  return (
    <ul className="flex flex-col" data-securite-du-projet={donnees.audits.length}>
      {donnees.audits.map((a) => (
        <li key={a.id} className="flex min-w-0 items-center gap-3 px-1 py-2.5">
          <span className="min-w-0 flex-1 truncate text-[14px] text-text">{t('Audit du {v0}', { v0: quand(a.lance) })}</span>
          <span className={cn('shrink-0 text-[12.5px]', a.erreur ? 'text-danger' : 'text-muted')}>
            {a.erreur ? t('Échec') : a.fini === null ? t('En cours') : typeof a.note === 'number' ? t('Note {v0}/100', { v0: a.note }) : t('Terminé')}
          </span>
        </li>
      ))}
    </ul>
  );
}
