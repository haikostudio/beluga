import * as React from 'react';
import { BarChart3, Brain, Clapperboard, FileText, FolderKanban, KeyRound, Loader2, Search, SquareKanban } from '@/components/ui/icones';
import { construireFragment, minusculesSansAccents, type Card, type EcranNavigateur, type GenreDeRechercheGlobale, type ResultatDeRechercheGlobale, type VueCentrale } from '@beluga/shared';
import { Dialog, DialogContent, DialogHeader, DialogTitle, Input } from '@/components/ui';
import { PastilleProjet } from '@/components/pastille-projet';
import { useServicesOuverts } from '@/components/services';
import { client } from '@/lib/client';
import { t } from '@/lib/langue';
import { useApp } from '@/lib/use-app';
import { cn } from '@/lib/utils';

/**
 * LA RECHERCHE AU CENTRE DE L'ÉCRAN (demande de l'utilisateur, 06/11/2026) : ⌘F (Ctrl+F) ouvre une fenêtre au centre,
 * un champ en haut et, dessous, la liste des SERVICES, des PROJETS et des TÂCHES qui correspondent, rangés par genre.
 * Un SECOND ⌘F, fenêtre ouverte, la referme et laisse le navigateur ouvrir SA recherche dans la page (décision de
 * l'utilisateur). La loupe du menu des services l'ouvre aussi ; la loupe de la colonne de gauche a disparu.
 *
 * Mécanique de la compétence « fenêtre de recherche globale » : services et projets filtrés sur place, tâches
 * demandées au démon (`cards.rechercher`, titres de tous les projets que le compte voit) à partir de deux lettres,
 * 250 ms après la dernière frappe, une réponse périmée jetée ; flèches, Entrée, Échap.
 *
 * ELLE REMPLACE LES LOUPES DU HAUT (carte « Lecteur de charte : commentaires et barre », décision de l'utilisateur) :
 * la même frappe demande aussi `recherche.globale` — documents de charte, fiches du coffre (leur nom seulement),
 * créations du Studio, mémoire, sites suivis, chacun selon les droits du compte. Un résultat ouvre sa page, sur lui.
 * Elle s'ouvre par ⌘F : « Rechercher » a quitté le menu ⋮ de la colonne (14/11/2026), qui a retrouvé sa loupe.
 */

const sansAccents = minusculesSansAccents;

type Resultat =
  | { genre: 'service'; cle: string; vue: VueCentrale; libelle: string; icone: React.ReactNode }
  | { genre: 'projet'; cle: string; projectId: string; libelle: string; icone: React.ReactNode }
  | { genre: 'tache'; cle: string; carte: Card; libelle: string; detail: string }
  | { genre: GenreDeRechercheGlobale; cle: string; element: ResultatDeRechercheGlobale; libelle: string; detail: string };

const ICONES_DES_GENRES: Record<GenreDeRechercheGlobale, React.ReactNode> = {
  charte: <FileText className="h-4 w-4" />,
  coffre: <KeyRound className="h-4 w-4" />,
  studio: <Clapperboard className="h-4 w-4" />,
  memoire: <Brain className="h-4 w-4" />,
  site: <BarChart3 className="h-4 w-4" />,
};

/** L'écran d'un résultat de la recherche élargie : sa page, ouverte sur lui. */
function ecranDuResultat(r: ResultatDeRechercheGlobale): EcranNavigateur {
  if (r.genre === 'charte') return { vue: 'plaquettes', plaquetteId: r.id };
  if (r.genre === 'coffre') return { vue: 'coffre', ficheId: r.id };
  if (r.genre === 'studio') return { vue: 'studio', creationId: r.id };
  if (r.genre === 'memoire') return { vue: 'memoire', uniteId: r.id, ...(r.portee ? { porteeId: r.portee } : {}) };
  return { vue: 'statistiques', siteId: r.id };
}

export function RechercheCentrale({
  onOuvrirVue,
  onOuvrirCarte,
}: {
  onOuvrirVue: (vue: VueCentrale) => void;
  onOuvrirCarte: (card: Card) => void;
}) {
  const state = useApp();
  const services = useServicesOuverts();
  const [ouvert, setOuvert] = React.useState(false);
  const [texte, setTexte] = React.useState('');
  const [taches, setTaches] = React.useState<Card[]>([]);
  const [elements, setElements] = React.useState<ResultatDeRechercheGlobale[]>([]);
  const [enCours, setEnCours] = React.useState(false);
  const [rang, setRang] = React.useState(0);
  const ouvertRef = React.useRef(ouvert);
  ouvertRef.current = ouvert;
  /* Ouvrir repart TOUJOURS d'un champ vide (une recherche d'avant ne revient pas). */
  const ouvrir = React.useCallback(() => {
    setTexte('');
    setTaches([]);
    setElements([]);
    setEnCours(false);
    setRang(0);
    ouvertRef.current = true;
    setOuvert(true);
  }, []);


  /* ⌘F / Ctrl+F : le premier ouvre la fenêtre ; fenêtre ouverte, le suivant la referme et laisse passer le geste au
     navigateur (sa recherche dans la page s'ouvre). */
  React.useEffect(() => {
    const surTouche = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== 'f') return;
      if (ouvertRef.current) {
        ouvertRef.current = false;
        setOuvert(false);
        return;
      }
      e.preventDefault();
      ouvrir();
    };
    window.addEventListener('keydown', surTouche, true);
    return () => window.removeEventListener('keydown', surTouche, true);
  }, [ouvrir]);

  const cherche = texte.trim();
  React.useEffect(() => {
    setRang(0);
    if (cherche.length < 2) {
      setTaches([]);
      setElements([]);
      setEnCours(false);
      return;
    }
    let abandon = false;
    setEnCours(true);
    const minuterie = window.setTimeout(() => {
      void Promise.all([
        client.rechercherDansLaColonne(cherche).catch(() => [] as Card[]),
        client
          .call<{ resultats: ResultatDeRechercheGlobale[] }>({ type: 'recherche.globale', texte: cherche })
          .then((r) => r.resultats ?? [])
          .catch(() => [] as ResultatDeRechercheGlobale[]),
      ]).then(([cartes, trouves]) => {
        if (abandon) return;
        setTaches(cartes.slice(0, 12));
        setElements(trouves);
        setEnCours(false);
      });
    }, 250);
    return () => {
      abandon = true;
      window.clearTimeout(minuterie);
    };
  }, [cherche]);

  const resultats = React.useMemo<Resultat[]>(() => {
    const q = sansAccents(cherche);
    const correspond = (nom: string) => !q || sansAccents(nom).includes(q);
    const liste: Resultat[] = [];
    if (state.monRole === 'admin' && correspond(t('Tableaux de bord')))
      liste.push({ genre: 'service', cle: 'service:en-route', vue: 'en-route', libelle: t('Tableaux de bord'), icone: <SquareKanban className="h-4 w-4" /> });
    for (const s of services) {
      if (correspond(t(s.cleLibelle))) liste.push({ genre: 'service', cle: `service:${s.cle}`, vue: s.cle, libelle: t(s.cleLibelle), icone: <s.Icone className="h-4 w-4" /> });
    }
    const projets = state.projects.filter((p) => !p.archived && correspond(p.name));
    for (const p of (q ? projets : projets.slice(0, 6)))
      liste.push({ genre: 'projet', cle: `projet:${p.id}`, projectId: p.id, libelle: p.name, icone: <PastilleProjet project={p} /> });
    const nomDuProjet = new Map(state.projects.map((p) => [p.id, p.name]));
    for (const c of taches) liste.push({ genre: 'tache', cle: `tache:${c.id}`, carte: c, libelle: c.title, detail: nomDuProjet.get(c.projectId) ?? '' });
    for (const e of elements) liste.push({ genre: e.genre, cle: `${e.genre}:${e.id}`, element: e, libelle: e.titre, detail: e.detail });
    return liste;
  }, [cherche, services, state.projects, state.monRole, taches, elements]);

  const choisir = (r: Resultat | undefined) => {
    if (!r) return;
    setOuvert(false);
    if (r.genre === 'service') onOuvrirVue(r.vue);
    else if (r.genre === 'projet') {
      client.setActiveProject(r.projectId);
      onOuvrirVue('projet');
    } else if (r.genre === 'tache') onOuvrirCarte(r.carte);
    else window.location.hash = construireFragment(ecranDuResultat(r.element));
  };

  const groupes: { genre: Resultat['genre']; titre: string }[] = [
    { genre: 'service', titre: t('Services') },
    { genre: 'projet', titre: t('Projets') },
    { genre: 'tache', titre: t('Tâches') },
    { genre: 'charte', titre: t('Charte graphique') },
    { genre: 'coffre', titre: t('Coffre-fort') },
    { genre: 'studio', titre: t('Studio') },
    { genre: 'memoire', titre: t('Mémoire') },
    { genre: 'site', titre: t('Statistiques') },
  ];

  return (
    <Dialog open={ouvert} onOpenChange={setOuvert}>
      <DialogContent className="sm:w-[min(620px,100%)]" data-recherche-centrale>
        <DialogHeader>
          <DialogTitle>{t('Rechercher')}</DialogTitle>
        </DialogHeader>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
          <Input
            autoFocus
            value={texte}
            onChange={(e) => setTexte(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setRang((r) => Math.min(resultats.length - 1, r + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setRang((r) => Math.max(0, r - 1));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                choisir(resultats[rang]);
              }
            }}
            placeholder={t('Un service, un projet, une tâche, un document…')}
            aria-label="Rechercher"
            className="h-11 pl-9 pr-9 text-[16px] sm:text-[14px]"
            data-champ-recherche-centrale
          />
          {enCours ? <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-faint" data-recherche-centrale-en-cours /> : null}
        </div>
        <div className="mt-3 flex min-h-[120px] flex-col gap-3 pb-1" data-resultats-recherche-centrale>
          {groupes.map(({ genre, titre }) => {
            const lignes = resultats.filter((r) => r.genre === genre);
            if (!lignes.length) return null;
            return (
              <section key={genre} className="flex flex-col gap-0.5" data-groupe-recherche={genre}>
                <p className="px-2 pb-1 text-[12px] font-medium text-faint">{titre}</p>
                {lignes.map((r) => {
                  const i = resultats.indexOf(r);
                  return (
                    <div
                      key={r.cle}
                      role="button"
                      tabIndex={-1}
                      onClick={() => choisir(r)}
                      onPointerMove={() => setRang(i)}
                      className={cn('flex min-w-0 cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 text-[13.5px] text-text', i === rang && 'bg-raised')}
                      data-resultat-recherche={r.genre}
                      data-choisi={i === rang ? '' : undefined}
                    >
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center text-muted">
                        {r.genre === 'tache' ? (
                          <SquareKanban className="h-4 w-4" />
                        ) : r.genre === 'projet' && !r.icone ? (
                          <FolderKanban className="h-4 w-4" />
                        ) : r.genre === 'service' || r.genre === 'projet' ? (
                          r.icone
                        ) : (
                          ICONES_DES_GENRES[r.genre]
                        )}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{r.libelle}</span>
                      {'detail' in r && r.detail ? <span className="max-w-[40%] shrink-0 truncate text-[12px] text-faint">{r.detail}</span> : null}
                    </div>
                  );
                })}
              </section>
            );
          })}
          {!resultats.length && !enCours ? (
            <p className="px-2 text-[13px] text-faint" data-recherche-centrale-vide>
              {t('Rien ne correspond à « {texte} ».', { texte: cherche })}
            </p>
          ) : null}
          {cherche.length === 1 ? <p className="px-2 text-[12.5px] text-faint">{t('Tapez au moins deux lettres pour chercher aussi dans les tâches et les documents.')}</p> : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
