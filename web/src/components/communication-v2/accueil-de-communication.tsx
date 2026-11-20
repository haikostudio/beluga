import * as React from 'react';
import { Loader2, Plus } from '@/components/ui/icones';
import { cheminCommunicationV2 } from '@beluga/shared';
import { BoutonPrincipal, GestePrincipal } from '@/components/entete-de-zone';
import { RechercheDuService } from '@/components/fenetre-de-service';
import { SilhouetteTableauDeService } from '@/components/silhouettes';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger, ZoneDefilement } from '@/components/ui';
import { colonneProjet } from '@/components/ui/colonne-projet';
import { Tableau, type ColonneDuTableauCommun } from '@/components/ui/tableau';
import { PastilleProjet } from '@/components/pastille-projet';
import { client } from '@/lib/client';
import { t } from '@/lib/langue';
import { useApp } from '@/lib/use-app';
import { useTelephone } from '@/lib/telephone';
import { Badge2, PastilleReseau, TitreDeLigne, dateCourteLocale } from './socle/pieces';
import type { ContenuDuCalendrier, LigneDeCampagneV2 } from './donnees';
import type { MarqueV2 } from './contexte';

/**
 * L'ACCUEIL DE COMMUNICATION : LES PROJETS QUI COMMUNIQUENT (décision de l'utilisateur du 20/11/2026, carte « Fil d'Ariane
 * et Communication repensés » : « on doit avoir le service avec la liste des projets en cours, ensuite on ouvre un
 * projet, on a la liste des campagnes, puis la fiche détail de la campagne »). Une ligne par marque — le projet qu'elle
 * porte —, avec ses campagnes en cours, sa prochaine publication et ses réseaux ; les plus actifs d'abord. Un clic
 * ouvre le projet (`#communication/<marque>`). Plus d'onglets Campagnes / Comptes / Réponses ici : les comptes reliés et
 * les réponses vivent dans le menu « … » de la page du projet. Les lectures sont celles de chaque marque, réunies.
 */
interface LigneDeProjet {
  marque: MarqueV2;
  enCours: number;
  total: number;
  aValider: number;
  reseaux: string[];
  prochaine: { jour: string; heure?: string; titre: string } | null;
}

/** Une lecture faite pour chaque marque, réunie : `null` tant que toutes ne sont pas revenues. */
function useLectureDesMarques<T>(marques: MarqueV2[] | null, type: string, extra: Record<string, unknown> = {}): { marque: MarqueV2; donnees: T }[] | null {
  const state = useApp();
  const version = state.communicationVersion;
  const [resultat, setResultat] = React.useState<{ marque: MarqueV2; donnees: T }[] | null>(null);
  const cle = (marques ?? []).map((m) => m.id).join(',');
  const cleExtra = JSON.stringify(extra);
  React.useEffect(() => {
    if (!marques) return;
    let vivant = true;
    void Promise.all(
      marques.map((marque) =>
        client
          .call<T>({ type, marqueId: marque.id, ...JSON.parse(cleExtra) } as never)
          .then((donnees) => ({ marque, donnees }))
          .catch(() => null),
      ),
    ).then((lus) => {
      if (vivant) setResultat(lus.filter((x): x is { marque: MarqueV2; donnees: T } => x !== null));
    });
    return () => {
      vivant = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cle, type, cleExtra, version]);
  return resultat;
}

const projetDeLaMarque = (m: MarqueV2) => ({ id: m.projets[0]?.id ?? null, nom: m.projets[0]?.nom ?? m.nom });

/** Le jour de l'appareil, AAAA-MM-JJ. */
function aujourdhui(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Une campagne en cours : pas terminée, et sa période n'est pas finie. */
const campagneEnCours = (c: LigneDeCampagneV2, jour: string) => c.statut !== 'terminee' && (!c.fin || c.fin >= jour);

export function AccueilDeCommunication({ marques, erreur, onVise }: { marques: MarqueV2[] | null; erreur: string | null; onVise: (chemin: string | null) => void }) {
  const telephone = useTelephone();
  const [recherche, setRecherche] = React.useState('');
  const campagnes = useLectureDesMarques<{ campagnes: LigneDeCampagneV2[] }>(marques, 'communication.campagnes');
  const publications = useLectureDesMarques<{ contenus: ContenuDuCalendrier[] }>(marques, 'communication.publications', { periode: 30 });

  const lignes = React.useMemo<LigneDeProjet[] | null>(() => {
    if (!marques || !campagnes) return null;
    const jour = aujourdhui();
    const maintenant = new Date();
    const heure = `${String(maintenant.getHours()).padStart(2, '0')}:${String(maintenant.getMinutes()).padStart(2, '0')}`;
    return marques
      .map((marque) => {
        const siennes = campagnes.find((x) => x.marque.id === marque.id)?.donnees.campagnes ?? [];
        const enCours = siennes.filter((c) => campagneEnCours(c, jour));
        const contenus = publications?.find((x) => x.marque.id === marque.id)?.donnees.contenus ?? [];
        const avenir = contenus
          .filter((c) => c.datePrevue && !['publie', 'echec', 'abandonne'].includes(c.etape) && (c.datePrevue > jour || (c.datePrevue === jour && (c.heurePrevue ?? '23:59') >= heure)))
          .sort((a, b) => `${a.datePrevue}${a.heurePrevue ?? ''}`.localeCompare(`${b.datePrevue}${b.heurePrevue ?? ''}`))[0];
        return {
          marque,
          enCours: enCours.length,
          total: siennes.length,
          aValider: enCours.reduce((n, c) => n + (c.aAccepter ?? 0), 0),
          reseaux: [...new Set(enCours.flatMap((c) => c.reseaux))],
          prochaine: avenir ? { jour: avenir.datePrevue!, ...(avenir.heurePrevue ? { heure: avenir.heurePrevue } : {}), titre: avenir.titre } : null,
        };
      })
      .sort(
        (a, b) =>
          b.enCours - a.enCours ||
          (a.prochaine?.jour ?? '9999').localeCompare(b.prochaine?.jour ?? '9999') ||
          b.total - a.total ||
          projetDeLaMarque(a.marque).nom.localeCompare(projetDeLaMarque(b.marque).nom),
      );
  }, [marques, campagnes, publications]);

  const ouvrir = (l: LigneDeProjet) => onVise(cheminCommunicationV2({ marqueId: l.marque.id }));
  const resumeDesCampagnes = (l: LigneDeProjet) =>
    l.enCours ? t('{n} en cours', { n: l.enCours }) : l.total ? t('Aucune en cours · {n} au total', { n: l.total }) : t('Aucune campagne');
  const prochaine = (l: LigneDeProjet) =>
    l.prochaine ? (
      <TitreDeLigne titre={`${dateCourteLocale(l.prochaine.jour)}${l.prochaine.heure ? ` · ${l.prochaine.heure}` : ''}`} sous={l.prochaine.titre} />
    ) : publications ? (
      <span className="text-faint">{t('Rien de prévu')}</span>
    ) : (
      <span className="text-faint">…</span>
    );

  const colonnes: ColonneDuTableauCommun<LigneDeProjet>[] = [
    colonneProjet((l) => projetDeLaMarque(l.marque)),
    {
      cle: 'campagnes',
      libelle: t('Campagnes'),
      largeur: 190,
      valeur: (l) => l.enCours * 1000 + l.total,
      rendu: (l) => <span className={l.enCours ? 'text-text' : 'text-muted'}>{resumeDesCampagnes(l)}</span>,
    },
    { cle: 'prochaine', libelle: t('Prochaine publication'), largeur: 260, valeur: (l) => l.prochaine?.jour ?? '9999', rendu: prochaine },
    {
      cle: 'reseaux',
      libelle: t('Réseaux'),
      largeur: 110,
      secondaire: true,
      rendu: (l) =>
        l.reseaux.length ? (
          <span className="inline-flex gap-1">
            {l.reseaux.slice(0, 4).map((r) => (
              <PastilleReseau key={r} canal={r} />
            ))}
          </span>
        ) : (
          <span className="text-faint">—</span>
        ),
    },
    {
      cle: 'avalider',
      libelle: t('À valider'),
      largeur: 110,
      droite: true,
      valeur: (l) => l.aValider,
      rendu: (l) => (l.aValider ? <Badge2 ton="attente">{l.aValider}</Badge2> : <span className="text-faint">—</span>),
    },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-v2-accueil="projets">
      <RechercheDuService valeur={recherche} onChange={setRecherche} placeholder={t('Rechercher un projet')} data-v2-accueil-recherche />
      <ZoneDefilement fond="hsl(var(--bg))" className={telephone ? 'px-4 pb-6' : 'pb-6'}>
        {erreur ? (
          <p className="py-6 text-[13px] text-danger">{erreur}</p>
        ) : lignes === null ? (
          <SilhouetteTableauDeService lignes={4} zone="communication-accueil" />
        ) : (
          <Tableau
            repere="accueil-projets"
            lignes={lignes}
            cle={(l) => l.marque.id}
            onLigne={ouvrir}
            aere
            rechercheExterne={recherche}
            colonnes={colonnes}
            vide={t('Aucun projet ne communique encore : « Nouvelle campagne » en lance un.')}
            attributsLigne={(l) => ({ 'data-v2-accueil-projet': l.marque.id })}
            pile={(l) => (
              <>
                <PastilleProjet project={{ name: projetDeLaMarque(l.marque).nom, favicon: l.marque.projets[0]?.favicon ?? l.marque.favicon ?? undefined }} />
                <span className="min-w-0 flex-1">
                  <TitreDeLigne titre={projetDeLaMarque(l.marque).nom} sous={l.prochaine ? `${resumeDesCampagnes(l)} · ${dateCourteLocale(l.prochaine.jour)}` : resumeDesCampagnes(l)} />
                </span>
                {l.aValider ? <Badge2 ton="attente">{l.aValider}</Badge2> : null}
              </>
            )}
          />
        )}
      </ZoneDefilement>
      <NouvelleCampagne marques={marques} onVise={onVise} />
    </div>
  );
}

/**
 * « NOUVELLE CAMPAGNE », EN BAS PLEINE LARGEUR : elle demande d'abord le projet — ses marques, puis les projets qui
 * n'en ont pas encore (le choix crée leur marque, à leur nom). La campagne se crée ensuite en conversation, comme
 * depuis la marque.
 */
function NouvelleCampagne({ marques, onVise }: { marques: MarqueV2[] | null; onVise: (chemin: string | null) => void }) {
  const projets = useApp().projects;
  const [enCours, setEnCours] = React.useState<string | null>(null);
  const sansMarque = projets.filter((p) => !p.archived && !(marques ?? []).some((m) => m.projets.some((x) => x.id === p.id)));
  const creerLaMarque = async (projet: { id: string; name: string }) => {
    if (enCours) return;
    setEnCours(projet.id);
    try {
      const { marque } = await client.call<{ marque: { id: string } }>({ type: 'communication.marque.creer', nom: projet.name, origine: 'projets', projets: [projet.id] } as never);
      onVise(cheminCommunicationV2({ marqueId: marque.id, page: 'campagnes', element: ['nouvelle'] }));
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('La marque n’a pas pu être créée.'));
    } finally {
      setEnCours(null);
    }
  };
  return (
    <GestePrincipal>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <BoutonPrincipal disabled={!marques || !!enCours} data-v2-nouvelle-campagne-accueil>
            {enCours ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            {t('Nouvelle campagne')}
          </BoutonPrincipal>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="center" side="top" className="sm:w-[280px]" data-v2-nouvelle-campagne-pour>
          <DropdownMenuLabel>{t('Pour quel projet ?')}</DropdownMenuLabel>
          {(marques ?? []).map((m) => (
            <DropdownMenuItem key={m.id} className="gap-2.5" onSelect={() => onVise(cheminCommunicationV2({ marqueId: m.id, page: 'campagnes', element: ['nouvelle'] }))} data-v2-nouvelle-pour-marque={m.id}>
              <PastilleProjet project={{ name: projetDeLaMarque(m).nom, favicon: m.projets[0]?.favicon ?? m.favicon ?? undefined }} />
              <span className="min-w-0 flex-1 truncate">{projetDeLaMarque(m).nom}</span>
            </DropdownMenuItem>
          ))}
          {sansMarque.length ? <DropdownMenuSeparator /> : null}
          {sansMarque.map((p) => (
            <DropdownMenuItem key={p.id} className="gap-2.5" onSelect={() => void creerLaMarque(p)} data-v2-nouvelle-pour-projet={p.id}>
              <PastilleProjet project={p} />
              <span className="min-w-0 flex-1 truncate">{p.name}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </GestePrincipal>
  );
}
