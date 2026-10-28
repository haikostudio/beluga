import * as React from 'react';
import { BookOpen, Loader2, Search, X } from 'lucide-react';
import { Button, DialogTitle, Drawer, Input, ZoneDefilement } from '@/components/ui';
import { client } from '@/lib/client';
import { Markdown } from '@/lib/markdown';
import { useTelephone } from '@/lib/telephone';
import { cn } from '@/lib/utils';
import { t } from '@/lib/langue';

/*
 * EXPLORER LES COMPÉTENCES — ce que les assistants savent déjà faire.
 *
 * La page « Les compétences » de la mise en route ne montrait que deux
 * interrupteurs de bibliothèques : on importait sans savoir quoi. Elle liste
 * désormais le pool lui-même — nom, résumé, thèmes, origine — et chaque fiche
 * s'ouvre pour être LUE. Le texte ne voyage qu'à l'ouverture
 * (`installation.competence`), la liste n'en porte que le résumé.
 */

interface FicheAExplorer {
  nom: string;
  description: string;
  themes: string[];
  origine: 'publiee' | 'bibliotheque' | 'ici';
  bibliotheque?: string;
}

/** « champ-de-mot-de-passe » devient « Champ de mot de passe ». */
function nomLisible(nom: string): string {
  const texte = nom.replace(/[-_]+/g, ' ').trim();
  return texte.charAt(0).toUpperCase() + texte.slice(1);
}

function origineEnClair(fiche: FicheAExplorer): string {
  if (fiche.origine === 'publiee') return t('Publiée avec Beluga Build');
  if (fiche.origine === 'bibliotheque') return t('Bibliothèque {nom}', { nom: fiche.bibliotheque ?? '' });
  return t('Écrite ici');
}

/** Le premier thème range la fiche ; sans thème, elle va sous « Autre ». */
function themeDeRangement(fiche: FicheAExplorer): string {
  return fiche.themes[0] ?? '';
}

export function ExplorateurDeCompetences({ rafraichir }: { rafraichir?: unknown }) {
  const [fiches, setFiches] = React.useState<FicheAExplorer[] | null>(null);
  const [recherche, setRecherche] = React.useState('');
  const [ouverte, setOuverte] = React.useState<FicheAExplorer | null>(null);

  React.useEffect(() => {
    let vivant = true;
    client
      .call<{ fiches: FicheAExplorer[] }>({ type: 'installation.competences' }, 30_000)
      .then((rendu) => vivant && setFiches(rendu.fiches ?? []))
      .catch(() => vivant && setFiches([]));
    return () => {
      vivant = false;
    };
  }, [rafraichir]);

  const mots = recherche.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const retenues = (fiches ?? []).filter((fiche) => {
    const botte = `${fiche.nom} ${fiche.description} ${fiche.themes.join(' ')}`.toLowerCase();
    return mots.every((mot) => botte.includes(mot));
  });
  const groupes = new Map<string, FicheAExplorer[]>();
  for (const fiche of retenues) {
    const cle = themeDeRangement(fiche);
    groupes.set(cle, [...(groupes.get(cle) ?? []), fiche]);
  }
  const themes = [...groupes.keys()].sort((a, b) => (a ? (b ? a.localeCompare(b, 'fr') : -1) : 1));

  return (
    <div className="space-y-2" data-liste-competences={fiches ? String(fiches.length) : 'chargement'}>
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[14px] font-medium text-text">{t('Ce que vos assistants savent déjà faire')}</p>
        {fiches ? <span className="text-[13px] text-faint">{t('{n} compétence(s)', { n: String(fiches.length) })}</span> : null}
      </div>
      {fiches === null ? (
        <div className="space-y-1.5" aria-hidden>
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-12 animate-pulse rounded-lg bg-raised" />
          ))}
        </div>
      ) : fiches.length === 0 ? (
        <p className="text-[13.5px] leading-relaxed text-muted" data-competences-vides>
          {t('Aucune compétence pour l’instant. Importez une bibliothèque ci-dessus, ou laissez vos assistants les écrire au fil du travail.')}
        </p>
      ) : (
        <>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" />
            <Input
              value={recherche}
              onChange={(event) => setRecherche(event.target.value)}
              placeholder={t('Chercher une compétence')}
              className="pl-8"
              data-recherche-competences
            />
          </div>
          <ZoneDefilement className="max-h-[420px] overflow-y-auto" fond="hsl(var(--bg))">
            <div className="space-y-3 pb-1">
              {themes.map((theme) => (
                <section key={theme || 'autres'} className="space-y-1">
                  <h3 className="px-1 text-[12px] font-medium uppercase tracking-wide text-faint">{theme || t('Autre')}</h3>
                  <ul className="space-y-1">
                    {groupes.get(theme)!.map((fiche) => (
                      <li key={fiche.nom}>
                        <div
                          role="button"
                          tabIndex={0}
                          data-competence={fiche.nom}
                          onClick={() => setOuverte(fiche)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              setOuverte(fiche);
                            }
                          }}
                          className="cursor-pointer rounded-lg bg-raised px-3 py-2 transition-colors hover:bg-fond-survol focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-faint/60"
                        >
                          <div className="flex items-baseline gap-2">
                            <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium text-text">{nomLisible(fiche.nom)}</span>
                            <span className="shrink-0 text-[12px] text-faint">{origineEnClair(fiche)}</span>
                          </div>
                          <p className="line-clamp-2 text-[12.5px] leading-relaxed text-muted">{fiche.description}</p>
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
              {!retenues.length ? <p className="px-1 text-[13px] text-muted">{t('Aucune compétence ne correspond à cette recherche.')}</p> : null}
            </div>
          </ZoneDefilement>
        </>
      )}
      {ouverte ? <LectureDeLaCompetence fiche={ouverte} onFermer={() => setOuverte(null)} /> : null}
    </div>
  );
}

/** Le mode d'emploi d'une fiche, lu dans un tiroir. */
function LectureDeLaCompetence({ fiche, onFermer }: { fiche: FicheAExplorer; onFermer: () => void }) {
  const telephone = useTelephone();
  const [texte, setTexte] = React.useState<string | null>(null);
  const [erreur, setErreur] = React.useState<string | null>(null);

  React.useEffect(() => {
    let vivant = true;
    client
      .call<{ ok: boolean; texte?: string; erreur?: string }>({ type: 'installation.competence', nom: fiche.nom }, 30_000)
      .then((rendu) => {
        if (!vivant) return;
        if (rendu.ok && typeof rendu.texte === 'string') setTexte(rendu.texte);
        else setErreur(rendu.erreur ?? t('Lecture impossible.'));
      })
      .catch((err: any) => vivant && setErreur(err?.message ?? t('Lecture impossible.')));
    return () => {
      vivant = false;
    };
  }, [fiche.nom]);

  return (
    <Drawer open onClose={onFermer} plein={telephone}>
      <div className="flex min-h-0 flex-1 flex-col" data-lecture-competence={fiche.nom}>
        <header className="flex shrink-0 items-center gap-1.5 px-3 pb-2">
          <BookOpen className="h-4 w-4 shrink-0 text-muted" />
          <DialogTitle className="min-w-0 flex-1 truncate">{nomLisible(fiche.nom)}</DialogTitle>
          <Button size="icon-sm" variant="ghost" onClick={onFermer} title={t('Fermer')} data-fermer-lecture-competence>
            <X className="h-4 w-4" />
          </Button>
        </header>
        <ZoneDefilement className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
          <p className="mb-3 text-[12.5px] text-faint">
            {origineEnClair(fiche)}
            {fiche.themes.length ? ` · ${fiche.themes.join(', ')}` : ''}
          </p>
          {texte !== null ? (
            <Markdown content={texte} enTexte className={cn('text-[14px]')} />
          ) : erreur ? (
            <p className="text-[13px] text-danger">{erreur}</p>
          ) : (
            <p className="flex items-center gap-1.5 text-[13px] text-muted">
              <Loader2 className="h-3 w-3 animate-spin" />
              {t('Chargement en cours…')}
            </p>
          )}
        </ZoneDefilement>
      </div>
    </Drawer>
  );
}
