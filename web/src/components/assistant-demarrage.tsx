import * as React from 'react';
import { ArrowLeft, Check, FolderPlus, Loader2 } from 'lucide-react';
import {
  ETAPES_DE_L_ASSISTANT,
  auMoinsUnMoteurEnLigne,
  etapePassable,
  prochaineEtape,
  type EtapeDeLAssistant,
  type EtatDeLAssistant,
} from '@beluga/shared';
import { Button, ZoneDefilement } from '@/components/ui';
import { BoutonRelireLesMoteurs, ListeDesMoteurs } from '@/components/assistant-moteurs';
import {
  LigneDEtat,
  SectionCompetences,
  SectionCopie,
  SectionCourriels,
  SectionDomaine,
  SectionEspaceClient,
  SectionFacultatif,
  SectionGitHub,
  SectionMemoire,
  useEtatDeLInstallation,
  type EtatDeLInstallation,
} from '@/components/installation/sections';
import { TerminalACote, VoletDuTerminal } from '@/components/installation/travail';
import { client } from '@/lib/client';
import { useApp } from '@/lib/use-app';
import { cn } from '@/lib/utils';
import { t } from '@/lib/langue';

/*
 * L'ASSISTANT DE PREMIER DÉMARRAGE — une installation neuve, page par page.
 *
 * Celui qui vient d'installer Beluga Build a créé son compte sur la page
 * d'installation (servie par le démon, ouverte par le lien d'installation). Il
 * arrive ici : neuf pages, dans l'ordre où elles servent. La première ne règle
 * rien — elle dit ce qu'est Beluga Build. UNE SEULE EST OBLIGATOIRE — les
 * moteurs, sans lesquels aucune tâche ne part. Chaque autre page se passe
 * (« Plus tard ») et se retrouve, à l'identique, dans Réglages, page
 * « Installation » : ce sont les mêmes composants (`installation/sections.tsx`).
 *
 * DES PAGES, PAS DES TIROIRS : l'assistant occupe l'écran entier, une page à la
 * fois, avec la liste des pages à gauche pour savoir où l'on en est. Sur
 * téléphone, la liste laisse la place à « page 3 sur 9 », et la flèche de la
 * barre d'en-tête remonte d'un cran.
 *
 * À GAUCHE CE QU'ON RÈGLE, À DROITE CE QUI SE PASSE. L'assistant installe
 * lui-même les moteurs et les fonctions : sur ordinateur, un volet de terminal
 * occupe la droite de l'écran et montre le serveur au travail, sans que
 * personne ait à s'y connecter (`installation/travail.tsx`). Plus étroit, la
 * même sortie se déplie sous le bouton qui l'a lancée.
 *
 * OÙ L'ON EN EST VIT DANS LA BASE (`Settings.assistant`, règle pure
 * `shared/src/installation.ts`) : un rechargement, un autre appareil, et l'on
 * reprend à la première page pas encore vue. La dernière page quittée referme
 * l'assistant pour de bon.
 */

interface Page {
  titre: string;
  intro: string;
}

/** Le titre et l'introduction d'une page, dans la langue affichée. */
function pageDe(etape: EtapeDeLAssistant): Page {
  switch (etape) {
    case 'bienvenue':
      return {
        titre: t('Bienvenue dans Beluga Build'),
        intro: t('Avant de régler quoi que ce soit, voici ce que vous venez d’installer.'),
      };
    case 'copie':
      return {
        titre: t('Votre propre Beluga'),
        intro: t('Faites de cette installation votre copie : un dépôt privé à votre nom, et le projet Beluga Build sur votre tableau. C’est de là que vous le personnalisez avec vos propres agents, et que vous récupérez, quand vous le voulez, les nouveautés de la version d’origine.'),
      };
    case 'moteurs':
      return {
        titre: t('Les moteurs'),
        intro: t('Beluga Build fait travailler des assistants installés sur ce serveur. Il en faut au moins un pour lancer une tâche : choisissez celui que vous préférez, les autres pourront venir plus tard.'),
      };
    case 'domaine':
      return {
        titre: t('Le nom de domaine'),
        intro: t('L’adresse à laquelle vous ouvrez Beluga Build, et le nom sous lequel vos projets recevront la leur.'),
      };
    case 'projet':
      return {
        titre: t('GitHub et votre premier projet'),
        intro: t('Beluga Build travaille dans des dépôts de code. Reliez GitHub, puis ajoutez un premier projet : un dépôt qui existe déjà, ou un projet neuf.'),
      };
    case 'courriels':
      return {
        titre: t('Les courriels'),
        intro: t('Beluga Build peut écrire à vos clients et vous envoyer un point chaque matin. Rien ne part tant que ces réglages sont vides.'),
      };
    case 'espace-client':
      return {
        titre: t('L’espace client'),
        intro: t('Vos clients peuvent déposer leurs demandes et suivre leur avancement dans un espace à eux.'),
      };
    case 'competences':
      return {
        titre: t('Les compétences'),
        intro: t('Une compétence est un mode d’emploi que les assistants suivent. Votre installation part sans aucune : cochez les bibliothèques publiques qui vous intéressent, vos propres compétences s’écriront ensuite au fil du travail.'),
      };
    case 'facultatif':
      return {
        titre: t('Les fonctions en plus'),
        intro: t('Rien de ce qui suit n’est nécessaire pour travailler. Chaque fonction s’ajoute quand vous en avez besoin.'),
      };
  }
}

export function AssistantDemarrage({ assistant }: { assistant: EtatDeLAssistant }) {
  const state = useApp();
  const { etat, relire } = useEtatDeLInstallation();
  const grandEcran = useGrandEcran();
  const premiere = prochaineEtape(assistant);
  const [vue, setVue] = React.useState<EtapeDeLAssistant>(premiere === 'fin' ? 'facultatif' : premiere);
  const [envoi, setEnvoi] = React.useState<'faite' | 'passee' | null>(null);

  const rang = ETAPES_DE_L_ASSISTANT.indexOf(vue);
  const page = pageDe(vue);
  const moteurPret = auMoinsUnMoteurEnLigne(state.engines, state.quotas);
  const peutContinuer = vue !== 'moteurs' || moteurPret;

  /** Une page est atteignable dès qu'elle a été vue, ou que c'est la prochaine. */
  const atteignable = (etape: EtapeDeLAssistant) =>
    Boolean(assistant.etapes[etape]) || etape === premiere || etape === vue;

  const quitter = async (issue: 'faite' | 'passee') => {
    setEnvoi(issue);
    try {
      await client.call({ type: 'installation.etape', etape: vue, issue });
      const suivante = ETAPES_DE_L_ASSISTANT[rang + 1];
      if (suivante) setVue(suivante);
      else client.pushToast('success', t('Installation terminée. Tout se retrouve dans Réglages, page « Installation ».'));
    } catch {
      client.pushToast('error', t('L’étape n’a pas pu être enregistrée.'));
    } finally {
      setEnvoi(null);
    }
  };

  return (
    <TerminalACote.Provider value={grandEcran}>
    <div
      data-assistant-demarrage="1"
      data-etape={vue}
      /* SOUS les fenêtres (`z-50`) et les messages passagers : la fenêtre
         d'ajout de projet et les connexions de compte s'ouvrent par-dessus. */
      className="fixed inset-0 z-[45] flex flex-col bg-bg"
    >
      <header className="flex h-12 shrink-0 items-center gap-2 px-3 sm:px-5">
        {rang > 0 ? (
          <Button
            variant="ghost"
            size="icon"
            data-assistant-retour
            title={t('Page précédente')}
            onClick={() => setVue(ETAPES_DE_L_ASSISTANT[rang - 1])}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
        ) : null}
        <span className="text-[14.5px] font-medium text-text">{t('Mise en route de Beluga Build')}</span>
        <span className="flex-1" />
        <span className="text-[13px] text-faint" data-assistant-avancement>
          {t('Page {n} sur {total}', { n: String(rang + 1), total: String(ETAPES_DE_L_ASSISTANT.length) })}
        </span>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* LA LISTE DES PAGES : où l'on en est, d'un coup d'œil. La page affichée
            porte la couleur de l'élément choisi ; une page faite, sa coche. */}
        <nav className="hidden w-60 shrink-0 flex-col gap-0.5 px-3 py-4 sm:flex" aria-label="pages-de-la-mise-en-route">
          {ETAPES_DE_L_ASSISTANT.map((etape, index) => {
            const issue = assistant.etapes[etape];
            const choisie = etape === vue;
            return (
              <button
                key={etape}
                type="button"
                data-assistant-page={etape}
                data-issue={issue ?? 'a-voir'}
                disabled={!atteignable(etape)}
                onClick={() => setVue(etape)}
                className={cn(
                  'flex items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13.5px] transition-colors disabled:opacity-40',
                  choisie ? 'bg-raised font-medium text-teinte' : 'text-muted hover:bg-raised hover:text-text',
                )}
              >
                <span className="flex h-4 w-4 shrink-0 items-center justify-center text-[11.5px]">
                  {issue === 'faite' ? <Check className="h-3 w-3" /> : index + 1}
                </span>
                <span className="min-w-0 flex-1 truncate">{pageDe(etape).titre}</span>
              </button>
            );
          })}
        </nav>

        <ZoneDefilement className="min-h-0 flex-1 px-4 py-4 sm:px-8 sm:py-6" fond="hsl(var(--bg))">
          <div className="mx-auto w-full max-w-xl pb-6">
            <h1 className="text-[20px] font-semibold tracking-tight text-text">{page.titre}</h1>
            <p className="mt-1.5 text-[14px] leading-relaxed text-muted">{page.intro}</p>
            <div className="mt-5">
              {vue === 'bienvenue' ? (
                <PageDeBienvenue etat={etat} relire={relire} />
              ) : vue === 'copie' ? (
                <SectionCopie etat={etat} relire={relire} />
              ) : vue === 'moteurs' ? (
                <div className="space-y-3">
                  <ListeDesMoteurs />
                  <BoutonRelireLesMoteurs />
                </div>
              ) : vue === 'domaine' ? (
                <SectionDomaine etat={etat} relire={relire} />
              ) : vue === 'projet' ? (
                <div className="space-y-6">
                  <SectionGitHub etat={etat} relire={relire} />
                  <PremierProjet />
                </div>
              ) : vue === 'courriels' ? (
                <SectionCourriels etat={etat} relire={relire} />
              ) : vue === 'espace-client' ? (
                <SectionEspaceClient etat={etat} relire={relire} />
              ) : vue === 'competences' ? (
                <SectionCompetences etat={etat} relire={relire} />
              ) : (
                <SectionFacultatif etat={etat} relire={relire} />
              )}
            </div>
          </div>
        </ZoneDefilement>

        {/* CE QUI SE PASSE SUR LE SERVEUR, à droite, tant que l'écran est assez
            large pour deux volets. Plus étroit, la même sortie se déplie sous
            le bouton qui a lancé le travail. */}
        {grandEcran ? <VoletDuTerminal className="mb-1 mr-3 w-[40%] max-w-[560px] shrink-0 sm:mr-5" /> : null}
      </div>

      <footer className="flex shrink-0 items-center gap-2 px-3 py-3 sm:px-5" style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
        <span className="min-w-0 flex-1 text-[13px] text-faint">
          {vue === 'moteurs' && !moteurPret ? t('Il faut au moins un moteur prêt pour continuer.') : null}
        </span>
        {etapePassable(vue) ? (
          <Button variant="ghost" size="md" data-assistant-plus-tard disabled={envoi !== null} onClick={() => void quitter('passee')}>
            {envoi === 'passee' ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
            {t('Plus tard')}
          </Button>
        ) : null}
        <Button variant="default" size="md" data-assistant-continuer disabled={!peutContinuer || envoi !== null} onClick={() => void quitter('faite')}>
          {envoi === 'faite' ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
          {rang === ETAPES_DE_L_ASSISTANT.length - 1 ? t('Terminer') : t('Continuer')}
        </Button>
      </footer>
    </div>
    </TerminalACote.Provider>
  );
}

/** L'écran est-il assez large pour deux volets côte à côte ? */
function useGrandEcran(): boolean {
  const REQUETE = '(min-width: 1024px)';
  const [large, setLarge] = React.useState(() => typeof window !== 'undefined' && window.matchMedia(REQUETE).matches);
  React.useEffect(() => {
    const requete = window.matchMedia(REQUETE);
    const suivre = () => setLarge(requete.matches);
    suivre();
    requete.addEventListener('change', suivre);
    return () => requete.removeEventListener('change', suivre);
  }, []);
  return large;
}

/**
 * LA PREMIÈRE PAGE NE RÈGLE RIEN : elle dit ce qu'on vient d'installer. Trois
 * idées, parce qu'elles changent la façon de s'en servir — l'outil apprend, il
 * se façonne, et il n'est pas un logiciel libre qu'on se contente de suivre.
 * Elle porte aussi l'état de la mémoire, posée par l'installation elle-même.
 */
function PageDeBienvenue({ etat, relire }: { etat: EtatDeLInstallation | null; relire: () => Promise<void> }) {
  return (
    <div className="space-y-5" data-page-de-bienvenue>
      <Idee titre={t('Un outil qui grandit avec vous')}>
        {t('Beluga Build part vide, et il apprend. Chaque projet que vous développez enrichit sa mémoire — ce qu’il sait de vos projets — et ses compétences — les façons de faire qui ont marché. Plus vous vous en servez, plus ses agents travaillent juste.')}
      </Idee>
      <Idee titre={t('Un outil que vous façonnez')}>
        {t('Le code de Beluga Build est sur ce serveur, et il se modifie comme n’importe lequel de vos projets : depuis le projet « Beluga Build », vous demandez un changement à un agent, et c’est votre propre version qui évolue. Une page de cette mise en route crée cette copie à votre nom.')}
      </Idee>
      <Idee titre={t('Une base, pas un logiciel libre')}>
        {t('Beluga Build n’est pas un outil open source. C’est un outil mis à la disposition de tous, pour que chacun parte d’une base déjà aboutie et conçoive son propre outil de développement.')}
      </Idee>
      <SectionMemoire etat={etat} relire={relire} />
    </div>
  );
}

function Idee({ titre, children }: { titre: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg bg-raised px-3.5 py-3">
      <h2 className="text-[14.5px] font-medium text-text">{titre}</h2>
      <p className="mt-1 text-[13.5px] leading-relaxed text-muted">{children}</p>
    </section>
  );
}

/**
 * LE PREMIER PROJET. La fenêtre d'ajout existe déjà dans la colonne des
 * projets : on la fait ouvrir, par-dessus l'assistant, plutôt que d'en écrire
 * une seconde qui dériverait de la première.
 */
function PremierProjet() {
  const state = useApp();
  const nombre = state.projects.length;
  return (
    <div className="space-y-2" data-premier-projet>
      <p className="text-[14px] font-medium text-text">{t('Votre premier projet')}</p>
      {nombre ? (
        <LigneDEtat fait>{t('{n} projet(s) inscrit(s).', { n: String(nombre) })}</LigneDEtat>
      ) : (
        <LigneDEtat fait={false}>{t('Aucun projet inscrit.')}</LigneDEtat>
      )}
      <Button
        variant="subtle"
        size="md"
        data-ajouter-premier-projet
        onClick={() => window.dispatchEvent(new Event('beluga:ajouter-projet'))}
      >
        <FolderPlus className="h-3.5 w-3.5" />
        {nombre ? t('Ajouter un autre projet') : t('Ajouter mon premier projet')}
      </Button>
    </div>
  );
}
