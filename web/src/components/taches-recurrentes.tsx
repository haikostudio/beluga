import * as React from 'react';
import { ChevronDown, ExternalLink, Loader2, RefreshCw, Repeat, X } from 'lucide-react';
import {
  construireFragment,
  rangerLesVeillesParProjet,
  veilleActive,
  type EtapeParcours,
  type EtatVeille,
  type ProjetDeVeilles,
  type VeilleListee,
} from '@beluga/shared';
import { Button, CLASSE_GROUPE_DE_LIGNES, CLASSE_LIGNE_DE_GROUPE, ConfirmDialog, DialogTitle, Drawer, TitreDePage, ZoneDefilement } from '@/components/ui';
import { SeparateurDuFil, SuiteDuFil } from '@/components/entete-de-zone';
import { ColonneDeService, useColonneDeService } from '@/components/colonne-de-service';
import { RubriqueDeColonne } from '@/components/rubriques-de-colonne';
import { PastilleProjet } from '@/components/pastille-projet';
import { SilhouetteTachesRecurrentes } from '@/components/silhouettes';
import { heureLisible, horairesDeLaVeille, issueLisible, quandLisible, useGestesDeVeille } from '@/components/veille-de-carte';
import { client } from '@/lib/client';
import { useApp } from '@/lib/use-app';
import { t } from '@/lib/langue';
import { cn } from '@/lib/utils';

/**
 * LE SERVICE « TÂCHES RÉCURRENTES » (demande du 22/10/2026) — les VEILLES
 * posées par les agents (`veille_poser`), réunies projet par projet : ce qui
 * se revérifie tout seul, sans moteur, en attendant un tiers.
 *
 * La colonne de gauche liste les projets qui ont des veilles (avec le nombre
 * de celles qui courent) ; à droite, les veilles du projet choisi — celles qui
 * courent en haut, les terminées (levée, arrêtée, échue) dessous dans
 * « Historique », replié. Une ligne ouvre le TIROIR de sa veille : ce qu'elle
 * vérifie, à quel rythme, ses horaires, et les deux gestes du bandeau de la
 * carte. Sur téléphone, où la colonne n'existe pas, la page montre la liste des
 * projets tant qu'aucun n'est choisi ; la flèche de la barre d'en-tête y ramène
 * (`data-recurrentes-retour`).
 *
 * La liste se lit au DÉMON (`veilles.lister`), jamais dans les cartes chargées
 * de l'écran, et se relit à chaque `veilles.compte` : une veille posée,
 * contrôlée ou terminée change la page ouverte.
 */

/** La clé d'un projet dans l'adresse ; les veilles dont la carte a disparu se rangent sous « sans-carte ». */
const SANS_CARTE = 'sans-carte';
const cleDuProjet = (projectId: string | null) => projectId ?? SANS_CARTE;

function etatLisible(etat: EtatVeille): string {
  return etat === 'en_cours'
    ? t('Active')
    : etat === 'levee'
      ? t('Blocage levé')
      : etat === 'expiree'
        ? t('Échue')
        : t('Arrêtée');
}

function frequenceLisible(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes === 60) return t('toutes les heures');
  return minutes % 60 === 0 ? t('toutes les {n} h', { n: minutes / 60 }) : t('toutes les {n} min', { n: minutes });
}

function etapeLisible(etape: EtapeParcours): string {
  switch (etape.action) {
    case 'aller':
      return t('Ouvrir {adresse}', { adresse: etape.url });
    case 'remplir':
      return t('Remplir le champ {cible}', { cible: etape.selecteur });
    case 'cliquer':
      return t('Cliquer sur {cible}', { cible: etape.selecteur });
    case 'attendre':
      return etape.selecteur ? t('Attendre {cible}', { cible: etape.selecteur }) : t('Attendre {n} s', { n: Math.round((etape.ms ?? 0) / 1000) });
    case 'verifierTexte':
      return t('Chercher le texte « {texte} »', { texte: etape.texte });
    case 'verifierSelecteur':
      return t('Vérifier la présence de {cible}', { cible: etape.selecteur });
  }
}

/** Ce que la veille vérifie, en phrases : une par étape. */
function ceQuiEstVerifie(veille: VeilleListee): string[] {
  const { recette } = veille;
  if (recette.recette.type === 'parcours') return recette.recette.etapes.map(etapeLisible);
  return [
    recette.recette.motAttendu
      ? t('Ouvrir {adresse} et chercher « {texte} »', { adresse: recette.url, texte: recette.recette.motAttendu })
      : t('Ouvrir {adresse} et vérifier qu’elle répond', { adresse: recette.url }),
  ];
}

/** La liste, lue au démon à l'ouverture puis à chaque changement annoncé. */
function useVeilles(open: boolean): VeilleListee[] | null {
  const signal = useApp().veilles.a;
  const [veilles, setVeilles] = React.useState<VeilleListee[] | null>(null);
  React.useEffect(() => {
    if (!open) return;
    let vivant = true;
    client
      .call<{ veilles: VeilleListee[] }>({ type: 'veilles.lister' })
      .then((r) => vivant && setVeilles(r.veilles ?? []))
      .catch(() => vivant && setVeilles((v) => v ?? []));
    return () => {
      vivant = false;
    };
  }, [open, signal]);
  return veilles;
}

/** Ouvre la carte d'une veille dans son projet, par l'adresse : la carte n'a pas besoin d'être déjà chargée. */
function ouvrirLaCarte(projectId: string, cardId: string): void {
  window.history.pushState(null, '', `#${construireFragment({ vue: 'projet', projectId, cardId })}`);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function TachesRecurrentes({
  open,
  enPage,
  onClose,
  vise,
  veilleVisee,
  onVise,
}: {
  open: boolean;
  enPage?: boolean;
  onClose: () => void;
  /** Le projet choisi (« sans-carte » pour les veilles orphelines). */
  vise: string | null;
  /** La veille ouverte dans le tiroir. */
  veilleVisee: string | null;
  onVise: (projet: string | null, veilleId?: string | null) => void;
}) {
  const state = useApp();
  const dansLaColonne = useColonneDeService();
  const veilles = useVeilles(open);
  const groupes = React.useMemo(() => (veilles ? rangerLesVeillesParProjet(veilles) : null), [veilles]);

  /* SUR ORDINATEUR, UN PROJET EST TOUJOURS OUVERT : celui du tableau s'il a des
     veilles, sinon le premier de la liste. */
  React.useEffect(() => {
    if (vise || !dansLaColonne || !groupes?.length) return;
    const actif = groupes.find((g) => g.projectId === state.activeProjectId);
    onVise(cleDuProjet((actif ?? groupes[0]!).projectId));
  }, [vise, dansLaColonne, groupes, state.activeProjectId, onVise]);

  const nomDuProjet = (cle: string) =>
    cle === SANS_CARTE ? t('Cartes supprimées') : state.projects.find((p) => p.id === cle)?.name ?? cle;
  const groupeVise = vise ? groupes?.find((g) => cleDuProjet(g.projectId) === vise) ?? null : null;
  const veilleOuverte = veilleVisee ? veilles?.find((v) => v.id === veilleVisee) ?? null : null;

  const listeDesProjets = (actif: boolean) =>
    (groupes ?? []).map((g) => {
      const cle = cleDuProjet(g.projectId);
      const projet = g.projectId ? state.projects.find((p) => p.id === g.projectId) : undefined;
      return (
        <RubriqueDeColonne
          key={cle}
          icone={projet ? <PastilleProjet project={projet} /> : <Repeat />}
          libelle={nomDuProjet(cle)}
          compte={g.actives.length || undefined}
          actif={actif && vise === cle}
          onClick={() => onVise(cle)}
          data-recurrentes-projet={cle}
        />
      );
    });

  return (
    <Drawer open={open} onClose={onClose} enPage={enPage}>
      {dansLaColonne ? (
        <ColonneDeService>
          <nav aria-label="Projets avec des tâches récurrentes" data-colonne-recurrentes className="flex min-h-0 flex-1 flex-col gap-0.5 pt-1">
            {listeDesProjets(true)}
          </nav>
        </ColonneDeService>
      ) : null}

      {vise ? (
        <>
          <SuiteDuFil onRacine={() => onVise(null)} retour={{ action: () => onVise(null), reperes: { 'data-recurrentes-retour': '' } }}>
            <SeparateurDuFil />
            <span className="min-w-0 truncate font-medium text-text" data-recurrentes-fil-projet>
              {nomDuProjet(vise)}
            </span>
          </SuiteDuFil>
          <ZoneDefilement fond="hsl(var(--bg))" className="pb-6">
            {groupes === null ? (
              <SilhouetteTachesRecurrentes />
            ) : (
              <VeillesDuProjet groupe={groupeVise} onOuvrir={(id) => onVise(vise, id)} />
            )}
          </ZoneDefilement>
        </>
      ) : (
        <>
          <TitreDePage>{t('Tâches récurrentes')}</TitreDePage>
          <ZoneDefilement fond="hsl(var(--bg))" className="pb-6">
            {groupes === null ? (
              <SilhouetteTachesRecurrentes />
            ) : !groupes.length ? (
              <p className="text-[14px] text-muted" data-recurrentes-vide>
                {t('Aucune tâche récurrente pour l’instant. Quand un agent attend un tiers, il pose une veille qui revérifie toute seule : elle apparaîtra ici.')}
              </p>
            ) : (
              /* SUR TÉLÉPHONE, LA LISTE DES PROJETS EST DANS LA PAGE. */
              <div className="flex flex-col gap-0.5" data-recurrentes-liste-projets>
                {listeDesProjets(false)}
              </div>
            )}
          </ZoneDefilement>
        </>
      )}

      <TiroirDeVeille veille={veilleOuverte} onClose={() => onVise(vise, null)} />
    </Drawer>
  );
}

function VeillesDuProjet({ groupe, onOuvrir }: { groupe: ProjetDeVeilles | null; onOuvrir: (veilleId: string) => void }) {
  const [historiqueOuvert, setHistoriqueOuvert] = React.useState(false);
  const actives = groupe?.actives ?? [];
  const historique = groupe?.historique ?? [];
  return (
    <div className="flex flex-col gap-6" data-recurrentes-veilles>
      <section className="flex flex-col gap-2" data-recurrentes-actives={actives.length}>
        <h2 className="px-1 text-[13px] font-medium text-muted">{t('En cours de veille')}</h2>
        {actives.length ? (
          <div className={CLASSE_GROUPE_DE_LIGNES}>
            {actives.map((v) => (
              <LigneDeVeille key={v.id} veille={v} onOuvrir={onOuvrir} />
            ))}
          </div>
        ) : (
          <p className="px-1 text-[14px] text-muted">{t('Aucune veille ne court dans ce projet.')}</p>
        )}
      </section>
      {historique.length ? (
        <section className="flex flex-col gap-2" data-recurrentes-historique={historiqueOuvert ? 'ouvert' : 'ferme'}>
          <button
            type="button"
            className="flex items-center gap-1.5 self-start rounded-lg px-1 text-[13px] font-medium text-muted hover:text-text"
            aria-expanded={historiqueOuvert}
            onClick={() => setHistoriqueOuvert((o) => !o)}
            data-recurrentes-historique-bouton
          >
            <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', !historiqueOuvert && '-rotate-90')} />
            {t('Historique ({n})', { n: historique.length })}
          </button>
          {historiqueOuvert ? (
            <div className={CLASSE_GROUPE_DE_LIGNES}>
              {historique.map((v) => (
                <LigneDeVeille key={v.id} veille={v} onOuvrir={onOuvrir} />
              ))}
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

function LigneDeVeille({ veille, onOuvrir }: { veille: VeilleListee; onOuvrir: (veilleId: string) => void }) {
  const active = veilleActive(veille);
  const fin = veille.termineA ?? veille.dernierControle?.a ?? veille.creeA;
  return (
    <button
      type="button"
      className={cn(CLASSE_LIGNE_DE_GROUPE, 'flex min-w-0 flex-col gap-0.5')}
      onClick={() => onOuvrir(veille.id)}
      data-recurrentes-veille={veille.id}
      data-veille={veille.etat}
    >
      <span className="break-words text-[14px] leading-snug text-text">{veille.raison}</span>
      <span className="break-words text-[12.5px] leading-snug text-faint">
        {[
          veille.titreCarte ?? t('carte supprimée'),
          active ? horairesDeLaVeille(veille) : t('{etat} le {date}', { etat: etatLisible(veille.etat), date: quandLisible(fin) }),
        ].join(' · ')}
      </span>
    </button>
  );
}

/** Une ligne du tiroir : son nom à gauche, sa valeur dessous sur téléphone, à droite ailleurs. */
function Ligne({ nom, children }: { nom: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 py-2 sm:flex-row sm:gap-4">
      <dt className="shrink-0 text-[12.5px] text-faint sm:w-40">{nom}</dt>
      <dd className="min-w-0 flex-1 select-text break-words text-[13.5px] text-text">{children}</dd>
    </div>
  );
}

function TiroirDeVeille({ veille, onClose }: { veille: VeilleListee | null; onClose: () => void }) {
  /* Le tiroir garde la dernière veille montrée pendant qu'il se referme. */
  const derniere = React.useRef<VeilleListee | null>(null);
  if (veille) derniere.current = veille;
  const v = veille ?? derniere.current;
  return (
    <Drawer open={!!veille} onClose={onClose} empile>
      {v ? <ContenuDuTiroir key={v.id} veille={v} /> : null}
    </Drawer>
  );
}

function ContenuDuTiroir({ veille }: { veille: VeilleListee }) {
  const { occupe, agir } = useGestesDeVeille(veille.cardId);
  const [confirmer, setConfirmer] = React.useState(false);
  const active = veilleActive(veille);
  const arretable = active || veille.etat === 'expiree';
  const controle = veille.dernierControle;
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-recurrentes-tiroir={veille.id} data-veille={veille.etat}>
      <div className="flex shrink-0 flex-col gap-2 px-3 pb-3">
        {/* Le titre monte dans la barre d'en-tête, comme dernier cran du fil d'Ariane. */}
        <DialogTitle className="min-w-0 truncate">{veille.raison}</DialogTitle>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="rounded-full bg-raised px-2.5 py-0.5 text-[12px] text-muted" data-recurrentes-etat={veille.etat}>
            {etatLisible(veille.etat)}
          </span>
          <div className="ml-auto flex flex-wrap items-center gap-1">
            {active ? (
              <Button variant="ghost" size="sm" disabled={occupe !== null} onClick={() => void agir('verifier')} data-veille-verifier>
                {occupe === 'verifier' ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                {t('Vérifier maintenant')}
              </Button>
            ) : null}
            {arretable ? (
              <Button variant="ghost" size="sm" disabled={occupe !== null} onClick={() => setConfirmer(true)} data-veille-arreter>
                {occupe === 'arreter' ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
                {t('Arrêter la veille')}
              </Button>
            ) : null}
          </div>
        </div>
      </div>
      <ZoneDefilement className="px-3 pb-6">
        <dl className="flex flex-col">
          <Ligne nom={t('Carte')}>
            {veille.projectId && veille.titreCarte ? (
              <button
                type="button"
                className="inline-flex max-w-full items-start gap-1.5 text-left hover:underline"
                onClick={() => ouvrirLaCarte(veille.projectId!, veille.cardId)}
                data-recurrentes-ouvrir-carte
              >
                <span className="min-w-0 break-words">{veille.titreCarte}</span>
                <ExternalLink className="mt-[3px] h-3.5 w-3.5 shrink-0 text-muted" aria-hidden />
              </button>
            ) : (
              <span className="text-muted">{t('carte supprimée')}</span>
            )}
          </Ligne>
          <Ligne nom={t('Ce qui est vérifié')}>
            <ul className="flex flex-col gap-0.5">
              {ceQuiEstVerifie(veille).map((phrase, i) => (
                <li key={i}>{phrase}</li>
              ))}
            </ul>
            {veille.recette.recette.explication ? <p className="mt-1 text-muted">{veille.recette.recette.explication}</p> : null}
            {veille.recette.profil ? (
              <p className="mt-1 text-muted">{t('Page lue avec la session « {profil} »', { profil: veille.recette.profil })}</p>
            ) : null}
          </Ligne>
          <Ligne nom={t('Blocage levé quand')}>
            {veille.recette.leveeSi === 'contenuAbsent' ? t('le contenu vérifié a disparu') : t('le contrôle réussit')}
          </Ligne>
          <Ligne nom={t('Rythme')}>{frequenceLisible(veille.intervalleMs)}</Ligne>
          <Ligne nom={t('Posée le')}>{quandLisible(veille.creeA)}</Ligne>
          <Ligne nom={veille.etat === 'expiree' ? t('Échue le') : t('Échéance')}>{quandLisible(veille.echeance)}</Ligne>
          <Ligne nom={t('Dernier contrôle')}>
            {controle ? (
              <>
                {t('{date}, {issue}', { date: quandLisible(controle.a), issue: issueLisible(controle.issue) })}
                {controle.detail ? <p className="mt-0.5 text-muted">{controle.detail}</p> : null}
              </>
            ) : (
              <span className="text-muted">{t('aucun pour l’instant')}</span>
            )}
          </Ligne>
          {active && veille.prochainControleA ? <Ligne nom={t('Prochain contrôle')}>{heureLisible(veille.prochainControleA)}</Ligne> : null}
          {!active && veille.termineA ? <Ligne nom={t('Terminée le')}>{quandLisible(veille.termineA)}</Ligne> : null}
        </dl>
      </ZoneDefilement>
      <ConfirmDialog
        open={confirmer}
        title={t('Arrêter cette veille ?')}
        description={t('Le contrôle cesse. La carte reste en pause : c’est votre prochain message qui relancera l’agent.')}
        confirmLabel={t('Arrêter la veille')}
        danger
        onConfirm={() => {
          setConfirmer(false);
          void agir('arreter');
        }}
        onClose={() => setConfirmer(false)}
      />
    </div>
  );
}
