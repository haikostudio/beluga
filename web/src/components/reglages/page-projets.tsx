import * as React from 'react';
import { FolderTree, Loader2, Pencil, Plus, Settings2, Split, X } from 'lucide-react';
import { estUnRegroupement, type Project } from '@beluga/shared';
import {
  BulleInfo,
  Button,
  ConfirmDialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Input,
  PromptDialog,
  ZoneDefilement,
} from '@/components/ui';
import { client } from '@/lib/client';
import { ouvrirConfigProjet } from '@/lib/ouvrir-config-projet';
import { useApp } from '@/lib/use-app';
import { cn } from '@/lib/utils';
import { t } from '@/lib/langue';

/**
 * LA RUBRIQUE « PROJETS » DES RÉGLAGES — réunir plusieurs projets sous un nom
 * commun, d'un geste, et les séparer de même (`shared/src/regroupements.ts`).
 *
 * Elle remplace la section « Dépôts » des réglages d'un projet, trop technique :
 * on coche les projets, on donne un nom, on réunit. Rien ne bouge sur le
 * disque — chaque projet garde son dossier, son dépôt et sa mise en ligne — et
 * la colonne de gauche montre aussitôt le projet réuni, dépliable, avec ses
 * membres dessous.
 */
export function PageProjetsReunis() {
  const state = useApp();
  const actifs = state.projects.filter((p) => !p.archived);
  const regroupements = actifs.filter((p) => estUnRegroupement(p));
  /* Seuls les projets autonomes se cochent : un membre est déjà pris, et
     l'espace de développement ne se réunit à rien. */
  const libres = actifs.filter((p) => !estUnRegroupement(p) && !p.isSelf && !p.regroupementId);

  const [coches, setCoches] = React.useState<Set<string>>(new Set());
  const [nom, setNom] = React.useState('');
  const [enCours, setEnCours] = React.useState<string | null>(null);
  const [erreur, setErreur] = React.useState<string | null>(null);
  const [aRenommer, setARenommer] = React.useState<Project | null>(null);
  const [aSeparer, setASeparer] = React.useState<Project | null>(null);

  const agir = async (cle: string, commande: Record<string, unknown>) => {
    setEnCours(cle);
    setErreur(null);
    try {
      await client.call(commande as any);
      return true;
    } catch (err: any) {
      setErreur(err?.message ?? t('La commande a échoué.'));
      return false;
    } finally {
      setEnCours(null);
    }
  };

  const reunir = async () => {
    const ok = await agir('reunir', { type: 'regroupement.creer', nom: nom.trim(), membres: [...coches] });
    if (ok) {
      setCoches(new Set());
      setNom('');
    }
  };

  /* Les projets libres, rangés comme dans la colonne de gauche : par groupe. */
  const parGroupe = React.useMemo(() => {
    const blocs: { id: string; titre: string | null; projets: Project[] }[] = [];
    const sansGroupe = libres.filter((p) => !p.groupId || !state.groups.some((g) => g.id === p.groupId));
    if (sansGroupe.length) blocs.push({ id: '', titre: null, projets: sansGroupe });
    for (const groupe of [...state.groups].sort((a, b) => (a.rank ?? 1000) - (b.rank ?? 1000))) {
      const projets = libres.filter((p) => p.groupId === groupe.id);
      if (projets.length) blocs.push({ id: groupe.id, titre: groupe.name, projets });
    }
    return blocs;
  }, [libres, state.groups]);

  return (
    <div data-page-projets-reunis className="space-y-5">
      <div>
        <h3 className="mb-1 flex items-center gap-1.5 text-[13.5px] font-medium text-text">
          <FolderTree className="h-3.5 w-3.5 text-faint" />
          {t('Réunir des projets')}
          <BulleInfo cote="start">{t('Un projet réuni travaille plusieurs projets depuis un seul tableau. Chaque projet garde son dossier, son dépôt et sa mise en ligne : une demande faite sur le tableau commun crée une carte dans chaque projet touché, sur sa propre branche.')}</BulleInfo>
        </h3>
      </div>

      {erreur ? (
        <p className="rounded-md bg-danger/10 px-2.5 py-1.5 text-[12.5px] text-danger" data-erreur-projets-reunis>
          {erreur}
        </p>
      ) : null}

      {regroupements.length ? (
        <div className="space-y-2" data-liste-regroupements>
          {regroupements.map((regroupement) => {
            const membres = actifs.filter((p) => p.regroupementId === regroupement.id);
            return (
              <div key={regroupement.id} data-regroupement={regroupement.id} className="rounded-md bg-bloc px-2.5 py-2">
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium text-text">{regroupement.name}</span>
                  <Button variant="ghost" size="sm" onClick={() => setARenommer(regroupement)} title={t('Renommer')}>
                    <Pencil className="h-3 w-3" />
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm" disabled={!libres.length} data-ajouter-au-regroupement>
                        <Plus className="h-3 w-3" />
                        {t('Ajouter')}
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {libres.map((projet) => (
                        <DropdownMenuItem
                          key={projet.id}
                          onSelect={() =>
                            void agir(`${regroupement.id}:a`, {
                              type: 'regroupement.ajouter',
                              id: regroupement.id,
                              membres: [projet.id],
                            })
                          }
                        >
                          {projet.name}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setASeparer(regroupement)}
                    disabled={enCours === `${regroupement.id}:s`}
                    data-separer-regroupement
                  >
                    {enCours === `${regroupement.id}:s` ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Split className="h-3 w-3" />
                    )}
                    {t('Séparer')}
                  </Button>
                </div>
                <ul className="mt-1.5 space-y-0.5 pl-3">
                  {membres.map((membre) => (
                    <li key={membre.id} className="flex items-center gap-2 text-[13px] text-muted" data-membre={membre.id}>
                      <span className="min-w-0 flex-1 truncate">{membre.name}</span>
                      <span className="hidden min-w-0 truncate text-[12px] text-faint sm:inline">{membre.path}</span>
                      <button
                        type="button"
                        onClick={() => ouvrirConfigProjet(membre.id)}
                        className="shrink-0 text-faint hover:text-text"
                        title={t('Réglages du projet')}
                      >
                        <Settings2 className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          void agir(`${membre.id}:r`, {
                            type: 'regroupement.retirer',
                            id: regroupement.id,
                            projectId: membre.id,
                          })
                        }
                        disabled={membres.length <= 2}
                        className="shrink-0 text-faint hover:text-danger disabled:opacity-30"
                        title={membres.length <= 2 ? t('Il faut au moins deux projets : séparez plutôt.') : t('Retirer du projet réuni')}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      ) : null}

      <div className="space-y-2" data-formulaire-reunion>
        <p className="text-[12.5px] font-medium text-muted">{t('Cochez les projets à réunir')}</p>
        {libres.length ? (
          <ZoneDefilement voile={false} classeEnveloppe="max-h-64 rounded-md bg-bloc" className="space-y-2 px-2.5 py-2">
            {parGroupe.map((bloc) => (
              <div key={bloc.id || 'sans-groupe'}>
                {bloc.titre ? (
                  <p className="mb-0.5 text-[11.5px] uppercase tracking-wide text-faint">{bloc.titre}</p>
                ) : null}
                {bloc.projets.map((projet) => (
                  <label
                    key={projet.id}
                    className={cn(
                      'flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-[13px] text-text hover:bg-surface',
                      bloc.titre && 'pl-3',
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={coches.has(projet.id)}
                      data-cocher-projet={projet.id}
                      onChange={(event) => {
                        const suivant = new Set(coches);
                        if (event.target.checked) suivant.add(projet.id);
                        else suivant.delete(projet.id);
                        setCoches(suivant);
                      }}
                    />
                    <span className="min-w-0 truncate">{projet.name}</span>
                  </label>
                ))}
              </div>
            ))}
          </ZoneDefilement>
        ) : (
          <p className="text-[12.5px] text-faint">{t('Aucun projet libre à réunir.')}</p>
        )}
        <div className="flex items-center gap-2">
          <Input
            value={nom}
            onChange={(event) => setNom(event.target.value)}
            placeholder={t('Nom du projet réuni')}
            className="h-8 flex-1"
            data-nom-regroupement
          />
          <Button
            size="sm"
            onClick={reunir}
            disabled={coches.size < 2 || !nom.trim() || enCours === 'reunir'}
            data-reunir-projets
          >
            {enCours === 'reunir' ? <Loader2 className="h-3 w-3 animate-spin" /> : <FolderTree className="h-3 w-3" />}
            {t('Réunir')}
          </Button>
        </div>
      </div>

      <PromptDialog
        open={!!aRenommer}
        title={t('Renommer le projet réuni')}
        defaultValue={aRenommer?.name ?? ''}
        confirmLabel={t('Renommer')}
        onClose={() => setARenommer(null)}
        onConfirm={(valeur) => {
          const cible = aRenommer;
          setARenommer(null);
          if (cible && valeur.trim()) void agir(`${cible.id}:n`, { type: 'regroupement.renommer', id: cible.id, nom: valeur.trim() });
        }}
      />
      <ConfirmDialog
        open={!!aSeparer}
        title={t('Séparer ces projets ?')}
        description={t('Chaque projet redevient autonome, avec ses cartes. Le tableau commun est mis de côté, sans rien effacer.')}
        confirmLabel={t('Séparer')}
        onClose={() => setASeparer(null)}
        onConfirm={() => {
          const cible = aSeparer;
          setASeparer(null);
          if (cible) void agir(`${cible.id}:s`, { type: 'regroupement.separer', id: cible.id });
        }}
      />
    </div>
  );
}
