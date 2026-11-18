import * as React from 'react';
import { Check, ChevronDown, ChevronRight, Loader2, Sparkles } from '@/components/ui/icones';
import { Button, CLASSE_GROUPE_DE_LIGNES } from '@/components/ui';
import { Silhouette } from '@/components/silhouettes';
import { Markdown } from '@/lib/markdown';
import { client } from '@/lib/client';
import { t } from '@/lib/langue';
import { TeteDeRubrique, type ContexteConfig } from './communs';

interface CharteLue {
  nom: string;
  titre: string;
  domaine: string;
  etat: 'proposee' | 'validee';
  corps: string;
  modeles: string | null;
  interdits: string[];
}

interface ChartesDuProjet {
  chartes: CharteLue[];
  carte: { id: string; titre: string; colonne: string } | null;
}

/**
 * LA CHARTE D'INTERFACE DU PROJET : ce que chaque agent reçoit d'office dès que
 * son travail touche un écran (`docs/chartes/*.md` du dépôt du projet,
 * `shared/src/chartes.ts`). Plusieurs chartes possibles, une par domaine.
 *
 * Une charte rédigée par un agent arrive « proposée » : elle est déjà servie,
 * avec cette mention, et un clic la VALIDE. Un projet sans charte propose de la
 * faire rédiger : une carte part dans CE projet, sur son propre dépôt.
 */
export function RubriqueChartes({ ctx }: { ctx: ContexteConfig }) {
  const projectId = ctx.project.id;
  const [donnees, setDonnees] = React.useState<ChartesDuProjet | null>(null);
  const [ouverte, setOuverte] = React.useState<string | null>(null);
  const [enCours, setEnCours] = React.useState<string | null>(null);
  /* Une lecture qui échoue le DIT : la prendre pour « aucune charte » proposerait d'en rédiger une de trop. */
  const [echec, setEchec] = React.useState(false);

  const lire = React.useCallback(() => {
    client
      .call<ChartesDuProjet>({ type: 'chartes.lister', projectId }, 30000)
      .then((lu) => {
        setEchec(false);
        setDonnees(lu);
      })
      .catch(() => setEchec(true));
  }, [projectId]);

  React.useEffect(() => {
    if (ctx.open) lire();
  }, [ctx.open, lire]);

  const changerLEtat = async (nom: string, etat: 'proposee' | 'validee') => {
    setEnCours(nom);
    try {
      await client.call({ type: 'chartes.etat', projectId, nom, etat }, 30000);
      client.pushToast('success', etat === 'validee' ? t('Charte validée.') : t('Charte repassée en proposition.'));
      lire();
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('Changement impossible.'));
    } finally {
      setEnCours(null);
    }
  };

  const rediger = async () => {
    setEnCours('rediger');
    try {
      await client.call<{ cardId: string }>({ type: 'chartes.rediger', projectId }, 60000);
      client.pushToast('success', t('Une tâche rédige la charte de ce projet.'));
      lire();
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('Tâche impossible à lancer.'));
    } finally {
      setEnCours(null);
    }
  };

  return (
    <div data-rubrique-contenu="chartes" className="min-w-0 space-y-3">
      <TeteDeRubrique
        titre={t('Charte d’interface')}
        resume={t('Les règles d’écran que chaque agent reçoit d’office, à valider.')}
        action={
          donnees && !donnees.carte ? (
            <Button size="sm" variant="subtle" onClick={() => void rediger()} disabled={enCours === 'rediger'} data-chartes-rediger>
              {enCours === 'rediger' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              {donnees.chartes.length ? t('Faire réécrire') : t('Faire rédiger')}
            </Button>
          ) : null
        }
      />

      {donnees?.carte ? (
        <p className="rounded-xl bg-surface px-3.5 py-3 text-[13px] text-muted" data-chartes-carte={donnees.carte.colonne}>
          {t('Une tâche rédige la charte de ce projet : « {titre} ». Elle arrivera ici, à valider.', { titre: donnees.carte.titre })}
        </p>
      ) : null}

      {echec && !donnees ? (
        <p className="rounded-xl bg-surface px-3.5 py-3 text-[13px] text-muted" data-chartes-echec>
          {t('Lecture des chartes impossible pour le moment.')}{' '}
          <button type="button" className="text-text underline-offset-2 hover:underline" onClick={lire}>
            {t('Réessayer')}
          </button>
        </p>
      ) : !donnees ? (
        <div className={CLASSE_GROUPE_DE_LIGNES} aria-busy="true">
          {[0, 1].map((i) => (
            <div key={i} className="flex flex-col gap-1.5 px-3.5 py-3">
              <Silhouette className="h-3.5 w-2/5" />
              <Silhouette className="h-3 w-3/5" />
            </div>
          ))}
        </div>
      ) : donnees.chartes.length === 0 ? (
        <p className="rounded-xl bg-surface px-3.5 py-3 text-[13px] text-muted" data-chartes-vide>
          {t('Ce projet n’a pas encore de charte : les agents ne savent pas quelles règles d’écran suivre. « Faire rédiger » confie à une tâche le soin de l’écrire à partir des écrans existants.')}
        </p>
      ) : (
        <div className={CLASSE_GROUPE_DE_LIGNES} data-chartes-liste>
          {donnees.chartes.map((charte) => {
            const depliee = ouverte === charte.nom;
            return (
              <div key={charte.nom} className="flex min-w-0 flex-col" data-charte={charte.nom} data-charte-etat={charte.etat}>
                <div className="flex min-w-0 items-center gap-2 rounded-xl px-3.5 py-3">
                  <button
                    type="button"
                    onClick={() => setOuverte(depliee ? null : charte.nom)}
                    aria-expanded={depliee}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    data-charte-ouvrir={charte.nom}
                  >
                    {depliee ? <ChevronDown className="h-4 w-4 shrink-0 text-muted" /> : <ChevronRight className="h-4 w-4 shrink-0 text-muted" />}
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-[14px] font-medium text-text">{charte.titre}</span>
                      <span className="truncate text-[12.5px] text-muted">{charte.domaine}</span>
                    </span>
                  </button>
                  {charte.etat === 'validee' ? (
                    <span className="inline-flex shrink-0 items-center gap-1 text-[12.5px] text-muted" data-charte-validee>
                      <Check className="h-3.5 w-3.5" />
                      {t('Validée')}
                    </span>
                  ) : (
                    <Button
                      size="sm"
                      onClick={() => void changerLEtat(charte.nom, 'validee')}
                      disabled={enCours === charte.nom}
                      data-charte-valider={charte.nom}
                    >
                      {enCours === charte.nom ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                      {t('Valider')}
                    </Button>
                  )}
                </div>
                {depliee ? (
                  <div className="flex min-w-0 flex-col gap-2 px-3.5 pb-3 [overflow-wrap:anywhere] sm:pl-10" data-charte-contenu>
                    {charte.interdits.length ? (
                      <p className="text-[12.5px] text-muted">
                        {t('Contrôlé à la fin de chaque tâche : {liste}.', { liste: charte.interdits.map((message) => message.split(' : ')[0]).join(', ') })}
                      </p>
                    ) : null}
                    <div className="min-w-0 text-[13.5px]">
                      <Markdown content={charte.corps} />
                    </div>
                    {charte.etat === 'validee' ? (
                      <div>
                        <Button size="sm" variant="ghost" onClick={() => void changerLEtat(charte.nom, 'proposee')} disabled={enCours === charte.nom}>
                          {t('Repasser en proposition')}
                        </Button>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
