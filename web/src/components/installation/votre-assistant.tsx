import * as React from 'react';
import { Loader2 } from '@/components/ui/icones';
import { NOM_DE_L_ASSISTANT_MAX, NOM_DE_L_ASSISTANT_PAR_DEFAUT, PRENOM_MAX, nomDeLAssistant, phraseDAppel } from '@beluga/shared';
import { Input, Label, Switch } from '@/components/ui';
import { BoutonInstaller } from '@/components/installation/travail';
import { naviguerVers } from '@/components/ui/lien-interne';
import { usePref } from '@/lib/prefs';
import { CLE_VOIX_ACTIVE, relireLaDictee, useDicteeInstallee, useVoixDisponible } from '@/lib/voix-disponible';
import { client } from '@/lib/client';
import { useApp } from '@/lib/use-app';
import { cn } from '@/lib/utils';
import { t } from '@/lib/langue';

/**
 * « VOTRE ASSISTANT » (carte « En-tête collant et défilement des pages », 17/11/2026) — page nécessaire de
 * l'assistant de premier démarrage, reprise en tête de Réglages › Voix.
 *
 * Deux champs : le PRÉNOM de la personne connectée (rangé dans SON compte : l'assistant l'emploie en lui parlant) et
 * le NOM de l'assistant (commun à l'installation). Du nom découlent la phrase qui l'appelle (« Dis <nom> ») et le
 * titre « Assistant <nom> ». Un nom que le micro ne saurait pas entendre est REFUSÉ — le démon le juge sur le
 * vocabulaire réel du modèle de réveil — avec trois noms proches qui, eux, le sont : un appui en adopte un.
 */

interface Verdict {
  nom: string;
  entendu: boolean;
  inconnus: string[];
  suggestions: string[];
}

/** Ce que la page sait de son état, pour que l'assistant de démarrage garde « Continuer » éteint tant qu'il manque. */
export interface EtatDeVotreAssistant {
  pret: boolean;
}

export function SectionVotreAssistant({
  surEtat,
  versLesMoteurs,
  sansVoix = false,
}: {
  surEtat?: (etat: EtatDeVotreAssistant) => void;
  /**
   * LA VOIX HORS DE LA MISE EN ROUTE (décision du 20/11/2026) : elle demande un compte ChatGPT qu'on n'a pas
   * forcément sous la main ; elle se propose ensuite par l'encadré « Parlez à … à voix haute ».
   */
  sansVoix?: boolean;
  /** Mener à la page « Les moteurs » (assistant de démarrage) ; sans elle, la page des comptes des réglages. */
  versLesMoteurs?: () => void;
}) {
  const state = useApp();
  const nomActuel = nomDeLAssistant(state.settings);
  const prenomActuel = state.monCompte?.prenom ?? '';
  // Le nom de l'assistant est commun à l'installation : seul l'administrateur le change ; chacun règle son prénom.
  const admin = state.monRole === 'admin';

  const [prenom, setPrenom] = React.useState(prenomActuel);
  const [nom, setNom] = React.useState(nomActuel);
  const [verdict, setVerdict] = React.useState<Verdict | null>(null);
  const [verification, setVerification] = React.useState(false);
  const [panne, setPanne] = React.useState<string | null>(null);
  const [enregistrement, setEnregistrement] = React.useState(false);

  // Le réglage arrive (ou change ailleurs) après le premier rendu : le champ le suit tant qu'on ne l'édite pas.
  const nomEdite = React.useRef(false);
  React.useEffect(() => {
    if (!nomEdite.current) setNom(nomActuel);
  }, [nomActuel]);
  const prenomEdite = React.useRef(false);
  React.useEffect(() => {
    if (!prenomEdite.current) setPrenom(prenomActuel);
  }, [prenomActuel]);

  /* LA VÉRIFICATION, pendant la saisie (après une courte pause) : le démon dit si le nom sera entendu. */
  const demande = React.useRef(0);
  React.useEffect(() => {
    const saisi = nom.trim();
    if (!saisi) {
      setVerdict(null);
      return;
    }
    if (saisi === nomActuel) {
      setVerdict({ nom: saisi, entendu: true, inconnus: [], suggestions: [] });
      setPanne(null);
      return;
    }
    const numero = ++demande.current;
    setVerification(true);
    const minuterie = window.setTimeout(() => {
      client
        .call<Verdict>({ type: 'assistant.nom.verifier', nom: saisi }, 60_000)
        .then((v) => {
          if (numero !== demande.current) return;
          setVerdict(v);
          setPanne(null);
        })
        .catch((err: Error) => {
          if (numero !== demande.current) return;
          setVerdict(null);
          setPanne(err.message);
        })
        .finally(() => {
          if (numero === demande.current) setVerification(false);
        });
    }, 350);
    return () => window.clearTimeout(minuterie);
  }, [nom, nomActuel]);

  const enregistrerLeNom = React.useCallback(
    async (choisi: string) => {
      const net = choisi.trim();
      if (!net || net === nomActuel) return;
      setEnregistrement(true);
      try {
        await client.call({ type: 'settings.update', patch: { assistantNom: net } });
        nomEdite.current = false;
      } catch (err) {
        client.pushToast('error', (err as Error).message);
      } finally {
        setEnregistrement(false);
      }
    },
    [nomActuel],
  );

  // Un nom entendu s'enregistre dès que la vérification le dit : rien d'autre à valider.
  React.useEffect(() => {
    if (verdict?.entendu && verdict.nom && verdict.nom !== nomActuel && verdict.nom === nom.trim()) void enregistrerLeNom(verdict.nom);
  }, [verdict, nom, nomActuel, enregistrerLeNom]);

  const enregistrerLePrenom = async () => {
    const net = prenom.trim();
    if (net === prenomActuel) return;
    try {
      const r = await client.call<{ prenom: string }>({ type: 'compte.prenom', prenom: net });
      client.poserMonPrenom(r.prenom);
      prenomEdite.current = false;
    } catch {
      client.pushToast('error', t('Le prénom n’a pas pu être enregistré.'));
    }
  };

  const refuse = !!verdict && !verdict.entendu && !!verdict.nom;
  const nomRetenu = refuse || !nom.trim() ? nomActuel : nom.trim();
  const pret = !!prenomActuel.trim() && !refuse && !!nomActuel && !enregistrement && nom.trim() === nomActuel;
  React.useEffect(() => {
    surEtat?.({ pret });
  }, [pret, surEtat]);

  return (
    <div className="space-y-5" data-section-installation="assistant" data-votre-assistant>
      <div className="space-y-1.5">
        <Label htmlFor="prenom-de-l-utilisateur">{t('Votre prénom')}</Label>
        <Input
          id="prenom-de-l-utilisateur"
          data-prenom-de-l-utilisateur
          value={prenom}
          maxLength={PRENOM_MAX}
          placeholder={t('Votre prénom')}
          autoComplete="given-name"
          onChange={(event) => {
            prenomEdite.current = true;
            setPrenom(event.target.value);
          }}
          onBlur={() => void enregistrerLePrenom()}
          onKeyDown={(event) => {
            if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
          }}
        />
        <p className="text-[12.5px] leading-relaxed text-muted">{t('L’assistant vous appellera ainsi quand ça vient naturellement.')}</p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="nom-de-l-assistant">{t('Le nom de l’assistant')}</Label>
        <div className="relative">
          <Input
            id="nom-de-l-assistant"
            data-nom-de-l-assistant
            data-refuse={refuse ? '' : undefined}
            value={nom}
            maxLength={NOM_DE_L_ASSISTANT_MAX}
            placeholder={NOM_DE_L_ASSISTANT_PAR_DEFAUT}
            autoComplete="off"
            disabled={!admin}
            aria-invalid={refuse}
            className={cn(refuse && 'border-important-trait focus-visible:border-important-trait')}
            onChange={(event) => {
              nomEdite.current = true;
              setNom(event.target.value);
            }}
          />
          {verification || enregistrement ? (
            <Loader2 className="absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-faint" />
          ) : null}
        </div>
        {refuse ? (
          <div className="space-y-2" data-nom-refuse>
            <p className="text-[12.5px] leading-relaxed text-important">
              {t('« {v0} » ne sera pas entendu quand vous l’appellerez. Choisissez plutôt :', { v0: verdict!.nom })}
            </p>
            <div className="flex flex-wrap gap-2">
              {verdict!.suggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  data-suggestion-de-nom={suggestion}
                  className="rounded-full bg-raised px-3 py-1.5 text-[13px] text-text transition-colors hover:bg-surface"
                  onClick={() => {
                    nomEdite.current = true;
                    setNom(suggestion);
                  }}
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {panne ? <p className="text-[12.5px] leading-relaxed text-danger" data-nom-en-panne>{panne}</p> : null}
        <p className="text-[12.5px] leading-relaxed text-muted" data-phrase-d-appel>
          {t('Pour l’appeler, vous direz « {v0} ». Le titre sera « {v1} ».', {
            v0: phraseDAppel(nomRetenu),
            v1: t('Assistant {v0}', { v0: nomRetenu }),
          })}
        </p>
      </div>

      {sansVoix ? null : <BlocAssistantVocal nom={nomRetenu} versLesMoteurs={versLesMoteurs} />}
    </div>
  );
}

/**
 * L'ASSISTANT VOCAL (décision de l'utilisateur, 17/11/2026, maquette #12ea) : plus aucun moteur de voix à installer —
 * c'est le compte ChatGPT relié au moteur Codex qui écoute, réfléchit et parle. Un interrupteur l'allume ou l'éteint
 * (la MÊME préférence que Réglages › Voix) ; sans compte, il reste grisé et un lien mène aux moteurs. Seulement quand la
 * voix n'est pas active, la DICTÉE du serveur est proposée : c'est elle que sert alors le micro du champ d'écriture.
 */
function BlocAssistantVocal({ nom, versLesMoteurs }: { nom: string; versLesMoteurs?: () => void }) {
  const [, setVoixActive] = usePref<boolean>(CLE_VOIX_ACTIVE, true);
  const { disponible, voixActive, compteRelie } = useVoixDisponible();
  const sansCompte = compteRelie === false;
  const dictee = useDicteeInstallee(!disponible);
  return (
    <div className="space-y-2" data-assistant-vocal>
      <p className="text-[14px] font-medium text-text">{t('Assistant vocal')}</p>
      <p className="text-[13.5px] leading-relaxed text-muted">
        {t('Pour parler à {v0} à voix haute et l’entendre répondre, il faut un compte ChatGPT relié au moteur Codex : c’est lui qui écoute, réfléchit et parle. Rien à installer sur ce serveur.', { v0: nom })}
      </p>
      <div className="space-y-1.5 rounded-lg bg-raised px-3 py-2.5">
        <label className={cn('flex items-center justify-between gap-3', sansCompte && 'opacity-60')}>
          <span className="text-[14px] font-medium text-text">{t('Activer l’assistant vocal')}</span>
          <Switch
            checked={disponible}
            disabled={sansCompte}
            onCheckedChange={setVoixActive}
            data-interrupteur-assistant-vocal
            data-interrupteur-voix
            aria-pressed={disponible}
          />
        </label>
        {sansCompte ? (
          <p className="text-[13px] font-medium leading-relaxed text-text" data-assistant-vocal-sans-compte>
            {t('Aucun compte ChatGPT n’est relié.')}{' '}
            <button
              type="button"
              className="underline underline-offset-2"
              data-relier-un-compte-chatgpt
              onClick={() => (versLesMoteurs ? versLesMoteurs() : naviguerVers('#reglages/comptes'))}
            >
              {versLesMoteurs ? t('Relier un compte dans « Les moteurs »') : t('Relier un compte')}
            </button>
          </p>
        ) : !voixActive ? (
          <p className="text-[13px] leading-relaxed text-muted">{t('Éteint : le micro du champ d’écriture sert à la dictée.')}</p>
        ) : null}
      </div>
      {!disponible ? (
        <div className="space-y-1.5 rounded-lg bg-raised px-3 py-2.5" data-fonction="dictee" data-installee={dictee ? '1' : '0'}>
          <p className="text-[14px] font-medium text-text">{t('Dictée')}</p>
          <p className="text-[13px] leading-relaxed text-muted">
            {t('Sans assistant vocal, le bouton micro du champ d’écriture transcrit votre voix sur ce serveur. Plusieurs centaines de mégaoctets à télécharger.')}
          </p>
          {dictee ? (
            <p className="text-[13px] text-muted">{t('Installée.')}</p>
          ) : (
            <BoutonInstaller genre="dictee" apres={async () => void (await relireLaDictee())} />
          )}
        </div>
      ) : null}
    </div>
  );
}
