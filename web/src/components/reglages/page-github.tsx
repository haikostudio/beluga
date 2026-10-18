import * as React from 'react';
import { Loader2, RotateCcw } from 'lucide-react';
import { Groupe } from '@/components/reglages/communs';
import { LigneDEtat, SectionGitHub, useEtatDeLInstallation } from '@/components/installation/sections';
import { Button } from '@/components/ui';
import { client } from '@/lib/client';
import { cn } from '@/lib/utils';
import { t } from '@/lib/langue';

/** Ce que le démon dit de GitHub (`installation.github-detail`). */
interface DetailGithub {
  installe: boolean;
  connecte: boolean;
  compte?: string;
  version?: string;
  comptes: { login: string; actif: boolean; source: 'environnement' | 'outil'; droits: string[]; valide: boolean }[];
  dossierDeConfiguration: string;
  compteDuService: string;
  projets: { id: string; nom: string; depot: string; dossier: string }[];
}

/** La connexion par code, telle que le démon la lance lui-même. */
const ARGUMENTS_DE_CONNEXION = ['auth', 'login', '--web', '--git-protocol', 'https', '--scopes', 'repo,workflow'].join(' ');

/** Une commande de l'outil GitHub, lancée sous le compte du service : c'est là qu'il garde sa connexion. */
function commandeSousLeService(compte: string, arguments_: string): string {
  return ['sudo', '-u', compte, '-H', 'gh', arguments_].join(' ');
}

/**
 * LA PAGE « GITHUB » DES RÉGLAGES — où l'on en est, d'un coup d'œil.
 *
 * En haut, la même section que dans l'assistant de démarrage (connexion par
 * code, jeton à la main) ; puis le compte relié, d'où vient son jeton et ses
 * droits ; les projets de la colonne de gauche récupérés depuis GitHub ; la
 * façon de régler GitHub sans l'écran ; et, tout en bas, la réinitialisation
 * du jeton — un geste qui coupe les sauvegardes jusqu'à ce qu'on relie de
 * nouveau, d'où la confirmation.
 */
export function PageGithub() {
  const { etat, relire } = useEtatDeLInstallation();
  const [detail, setDetail] = React.useState<DetailGithub | null>(null);
  const [confirmer, setConfirmer] = React.useState(false);
  const [reinitialisation, setReinitialisation] = React.useState(false);
  const [bilan, setBilan] = React.useState<{ ok: boolean; texte: string } | null>(null);

  const lire = React.useCallback(async () => {
    try {
      setDetail((await client.call<{ detail: DetailGithub }>({ type: 'installation.github-detail' }, 40_000)).detail);
    } catch {
      /* le démon ne répond pas : la page garde ce qu'elle savait */
    }
  }, []);
  React.useEffect(() => {
    void lire();
    const relu = () => void lire();
    window.addEventListener('beluga:connexion-github', relu);
    return () => window.removeEventListener('beluga:connexion-github', relu);
  }, [lire]);
  // Une connexion faite dans la section du haut se voit aussi plus bas.
  const connecte = etat?.github.connecte;
  React.useEffect(() => {
    void lire();
  }, [connecte, lire]);

  const reinitialiser = async () => {
    setReinitialisation(true);
    setBilan(null);
    try {
      const rendu = await client.call<{ ok: boolean; texte: string; detail: DetailGithub }>({ type: 'installation.github-reinitialiser' }, 60_000);
      setBilan({ ok: rendu.ok, texte: rendu.texte });
      setDetail(rendu.detail);
      await relire();
    } catch (err: any) {
      setBilan({ ok: false, texte: err?.message ?? t('La réinitialisation n’a pas abouti.') });
    } finally {
      setReinitialisation(false);
      setConfirmer(false);
    }
  };

  const compteSysteme = detail?.compteDuService || etat?.compte || 'beluga';
  return (
    <div className="space-y-7" data-page-github>
      <Groupe titre={t('La connexion')}>
        <SectionGitHub etat={etat} relire={relire} />
      </Groupe>

      <Groupe titre={t('Où l’on en est')}>
        {!detail ? (
          <p className="flex items-center gap-1.5 text-[13px] text-muted">
            <Loader2 className="h-3 w-3 animate-spin" />
            {t('Lecture de l’état de GitHub…')}
          </p>
        ) : (
          <div className="space-y-2" data-etat-github>
            <LigneDEtat fait={detail.installe}>
              {detail.installe
                ? t('Outil GitHub installé (version {version}).', { version: detail.version ?? '?' })
                : t('L’outil GitHub n’est pas installé sur ce serveur.')}
            </LigneDEtat>
            {detail.comptes.length ? (
              detail.comptes.map((compte) => (
                <div key={`${compte.login}-${compte.source}`} className="rounded-lg bg-raised px-3 py-2" data-compte-github={compte.login}>
                  <p className="text-[13.5px] text-text">
                    {compte.login}
                    {compte.actif ? <span className="ml-1.5 text-[12px] text-faint">{t('(utilisé)')}</span> : null}
                  </p>
                  <p className={cn('text-[12.5px] leading-relaxed', compte.valide ? 'text-muted' : 'text-danger')}>
                    {compte.valide ? t('Jeton accepté par GitHub.') : t('GitHub refuse ce jeton : réinitialisez-le, puis reliez GitHub de nouveau.')}{' '}
                    {compte.source === 'environnement'
                      ? t('Il vient de la configuration du service (variable d’environnement).')
                      : t('Il est rangé par l’outil GitHub sur ce serveur.')}
                  </p>
                  {compte.droits.length ? (
                    <p className="text-[12px] leading-relaxed text-faint">
                      {t('Droits : {droits}', { droits: compte.droits.join(', ') })}
                    </p>
                  ) : null}
                </div>
              ))
            ) : (
              <LigneDEtat fait={false}>{t('Aucun compte GitHub n’est relié à ce serveur.')}</LigneDEtat>
            )}
          </div>
        )}
      </Groupe>

      <Groupe titre={t('Les projets récupérés depuis GitHub')}>
        {detail ? (
          detail.projets.length ? (
            <ul className="space-y-1" data-projets-github>
              {detail.projets.map((projet) => (
                <li key={projet.id} className="flex min-w-0 items-baseline gap-2 text-[13px]">
                  <span className="shrink-0 text-text">{projet.nom}</span>
                  <span className="min-w-0 truncate text-faint" title={projet.dossier}>
                    {projet.depot}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-muted">{t('Aucun projet de la colonne de gauche ne vient encore de GitHub.')}</p>
          )
        ) : null}
      </Groupe>

      <Groupe titre={t('Sans passer par l’écran')}>
        <div className="space-y-1.5 text-[13px] leading-relaxed text-muted" data-github-en-ligne-de-commande>
          <p>{t('Sur le serveur, l’outil GitHub se règle sous le compte du service. Pour voir où il en est :')}</p>
          <code className="block select-all break-all rounded-md bg-raised px-2.5 py-1.5 font-mono text-[12px] text-text">
            {commandeSousLeService(compteSysteme, 'auth status')}
          </code>
          <p>{t('Pour le relier de nouveau (le code s’affiche dans le terminal) :')}</p>
          <code className="block select-all break-all rounded-md bg-raised px-2.5 py-1.5 font-mono text-[12px] text-text">
            {[
              commandeSousLeService(compteSysteme, ARGUMENTS_DE_CONNEXION),
              commandeSousLeService(compteSysteme, 'auth setup-git'),
            ].join(' && ')}
          </code>
          {detail ? (
            <p>{t('La connexion est rangée dans le dossier {dossier}.', { dossier: detail.dossierDeConfiguration })}</p>
          ) : null}
        </div>
      </Groupe>

      <Groupe titre={t('Réinitialiser le jeton')}>
        <div className="space-y-2" data-reinitialiser-github>
          <p className="text-[13px] leading-relaxed text-muted">
            {t('Retire le jeton rangé sur ce serveur. Tant que GitHub n’est pas relié de nouveau, les projets ne se récupèrent plus et le travail des tâches ne se sauvegarde plus sur GitHub.')}
          </p>
          {confirmer ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="danger" size="md" disabled={reinitialisation} onClick={() => void reinitialiser()} data-confirmer-reinitialisation>
                {reinitialisation ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
                {reinitialisation ? t('Réinitialisation…') : t('Oui, retirer le jeton')}
              </Button>
              <Button variant="ghost" size="md" disabled={reinitialisation} onClick={() => setConfirmer(false)}>
                {t('Annuler')}
              </Button>
            </div>
          ) : (
            <Button variant="subtle" size="md" onClick={() => setConfirmer(true)} data-reinitialiser-jeton>
              <RotateCcw className="h-3 w-3" />
              {t('Réinitialiser le jeton')}
            </Button>
          )}
          {bilan ? (
            <p className={cn('text-[13px] leading-relaxed', bilan.ok ? 'text-success' : 'text-danger')} data-bilan-reinitialisation>
              {bilan.texte}
            </p>
          ) : null}
        </div>
      </Groupe>
    </div>
  );
}
