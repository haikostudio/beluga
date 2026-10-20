import * as React from 'react';
import { ExternalLink, KeyRound, Loader2, LogIn, Save, Send } from 'lucide-react';
import { ConnexionCompte, connexionTerminee, descriptionMoteur, nomCourtDuMoteur, type EngineId } from '@beluga/shared';
import { BulleInfo, Button, ChampMotDePasse, Input } from '@/components/ui';
import { client } from '@/lib/client';
import { cn } from '@/lib/utils';
import { t } from '@/lib/langue';

/*
 * CONNECTER UN COMPTE DE MOTEUR, à un seul endroit.
 *
 * Les deux gestes vivaient dans l'écran des réglages. L'ASSISTANT DE DÉMARRAGE
 * (`assistant-moteurs.tsx`) a besoin exactement des mêmes, et il s'affiche AVANT
 * que les réglages ne soient téléchargés : les recopier aurait fait deux
 * versions à corriger à chaque changement du protocole de connexion.
 */

/** Le temps qui reste avant l'abandon de la tentative, relu toutes les 15 s. */
function useTempsRestant(expireA: number | undefined, actif: boolean): number | null {
  const [maintenant, setMaintenant] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (!expireA || !actif) return;
    setMaintenant(Date.now());
    const minuteur = window.setInterval(() => setMaintenant(Date.now()), 15_000);
    return () => window.clearInterval(minuteur);
  }, [expireA, actif]);
  if (!expireA || !actif) return null;
  return Math.max(0, Math.ceil((expireA - maintenant) / 60_000));
}

/**
 * Une connexion en cours, telle qu'elle se suit à l'écran : l'adresse à ouvrir
 * sur SON téléphone ou son ordinateur, le code à saisir sur la page, et — pour
 * Claude — le champ où recopier le code que la page rend en retour.
 *
 * CODEX A DEUX VOIES. Le code d'appareil par défaut ; si OpenAI le refuse, le
 * serveur repart d'office sur la voie NAVIGATEUR (aussi ouverte par « Se
 * connecter autrement ») : un bouton vers la page d'OpenAI, puis un champ où
 * coller l'adresse de la page d'erreur `localhost:1455` — le serveur la rejoue
 * lui-même. Aucun terminal, à aucune étape.
 *
 * Rien n'est avalé en silence : une connexion refusée, abandonnée ou trop
 * longue affiche sa cause, en français, à la place de l'adresse. Et Codex n'est
 * dit « opérationnel » qu'après un vrai essai du moteur.
 */
export function BlocConnexion({ connexion }: { connexion: ConnexionCompte }) {
  const [code, setCode] = React.useState('');
  const [envoi, setEnvoi] = React.useState(false);
  const [adresse, setAdresse] = React.useState('');
  const [erreurAdresse, setErreurAdresse] = React.useState<string | null>(null);
  const [bascule, setBascule] = React.useState(false);
  const fini = connexionTerminee(connexion);
  const minutes = useTempsRestant(connexion.expireA, !fini);

  if (fini) {
    const avertir = connexion.etape === 'reussie' && connexion.controle === 'echec';
    return (
      <p
        data-connexion-fin={connexion.etape}
        data-connexion-controle={connexion.controle}
        className={cn(
          'mt-1.5 rounded-md px-2 py-1 text-[12.5px] leading-relaxed',
          connexion.etape === 'reussie' && !avertir
            ? 'border border-transparent bg-success/5 text-success'
            : avertir
              ? 'border border-warning/30 bg-warning/5 text-warning'
              : 'border border-danger/30 bg-danger/5 text-danger',
        )}
      >
        {connexion.etape !== 'reussie'
          ? t('Connexion échouée : {v0}', { v0: connexion.message ?? '' })
          : connexion.controle
            ? connexion.message ?? ''
            : t('Connexion réussie')}
      </p>
    );
  }

  // LA CONNEXION A ABOUTI, le moteur fait son essai : rien à cliquer.
  if (connexion.controle === 'en-cours') {
    return (
      <p
        data-connexion-controle="en-cours"
        className="mt-1.5 flex items-center gap-1.5 rounded-md border border-transparent bg-warning/5 px-2 py-1 text-[12.5px] text-warning"
      >
        <Loader2 className="h-3 w-3 animate-spin" />
        {t('Compte connecté : essai du moteur en cours…')}
      </p>
    );
  }

  // LE CODE (ou l'adresse de retour) EST PARTI : le moteur l'échange contre ses
  // jetons. Plus de champ ni de bouton à cliquer — un chargement, jusqu'au résultat.
  if (connexion.codeEnvoyeA || connexion.adresseEnvoyeeA) {
    return (
      <p
        data-connexion-validation="1"
        className="mt-1.5 flex items-center gap-1.5 rounded-md border border-transparent bg-warning/5 px-2 py-1 text-[12.5px] text-warning"
      >
        <Loader2 className="h-3 w-3 animate-spin" />
        {t('Connexion en cours…')}
      </p>
    );
  }

  const changerDeVoie = async (voie: 'appareil' | 'navigateur') => {
    setBascule(true);
    try {
      await client.geste({ type: 'account.voie', id: connexion.id, voie }, t('Changement de méthode de connexion'));
    } finally {
      setBascule(false);
    }
  };

  const envoyerAdresse = async (texte: string) => {
    if (envoi || !texte.trim()) return;
    setEnvoi(true);
    setErreurAdresse(null);
    try {
      const rendu = await client.call<{ ok: boolean; error?: string }>({
        type: 'account.adresseDeRetour',
        id: connexion.id,
        adresse: texte,
      });
      if (!rendu.ok) setErreurAdresse(rendu.error ?? t('adresse refusée'));
      else setAdresse('');
    } catch (err: any) {
      setErreurAdresse(err?.message ?? t('adresse refusée'));
    } finally {
      setEnvoi(false);
    }
  };

  const tempsRestant =
    minutes !== null ? (
      <p className="text-[11.5px] text-faint" data-connexion-temps={minutes}>
        {t('Temps restant : {v0} min', { v0: minutes })}
      </p>
    ) : null;

  const abandonner = (
    /* ABANDONNER ENGAGE : la connexion continue côté serveur si la demande
       n'arrive pas. Elle passe donc par la demande qui attend réponse. */
    <Button
      /* Aplat d'encre (noir en clair, clair en sombre) : en `ghost`, le bouton
         n'était qu'un texte gris sans fond, invisible dans le tiroir. */
      variant="creation"
      size="sm"
      data-connexion-abandonner
      onClick={() => void client.geste({ type: 'account.cancel', id: connexion.id }, t('Abandonner'))}
    >
      {t('Abandonner')}
    </Button>
  );

  /* ---------------- Codex, voie navigateur ---------------- */
  if (connexion.voie === 'navigateur') {
    return (
      <div className="mt-1.5 space-y-2 rounded-md border border-border bg-bg px-2 py-1.5" data-connexion-en-cours="1" data-connexion-voie="navigateur">
        {connexion.proposerNavigateur ? (
          <p className="text-[12.5px] leading-relaxed text-warning" data-connexion-bascule="1">
            {t('OpenAI refuse la connexion par code pour ce compte : connectez-vous plutôt par sa page.')}
          </p>
        ) : null}
        <div className="space-y-1">
          <p className="text-[12.5px] leading-relaxed text-muted">{t('1. Connectez-vous sur la page d’OpenAI.')}</p>
          {connexion.lien ? (
            <Button asChild size="sm">
              <a href={connexion.lien} target="_blank" rel="noreferrer" data-connexion-openai="1">
                <ExternalLink className="h-3.5 w-3.5" />
                {t('Se connecter à OpenAI')}
              </a>
            </Button>
          ) : (
            <p className="flex items-center gap-1.5 text-[12.5px] text-faint">
              <Loader2 className="h-3 w-3 animate-spin" /> {t('Le moteur prépare la connexion…')}
            </p>
          )}
        </div>
        <div className="space-y-1">
          <p className="text-[12.5px] leading-relaxed text-muted">
            {t('2. La page finit sur une erreur « localhost » : c’est normal. Copiez son adresse complète, puis collez-la ici.')}
          </p>
          <div className="flex flex-wrap items-center gap-1.5">
            <Input
              value={adresse}
              disabled={envoi || !connexion.attendAdresseDeRetour}
              inputMode="url"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              onChange={(event) => setAdresse(event.target.value)}
              onPaste={(event) => {
                // Coller suffit : l'adresse part aussitôt, sans second geste.
                const colle = event.clipboardData.getData('text');
                if (colle.trim()) {
                  event.preventDefault();
                  setAdresse(colle);
                  void envoyerAdresse(colle);
                }
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void envoyerAdresse(adresse);
              }}
              placeholder={t('Collez ici l’adresse localhost:1455/…')}
              className="h-8 min-w-0 flex-1 text-[13px]"
              data-connexion-adresse="1"
            />
            <Button size="sm" disabled={envoi || !adresse.trim()} onClick={() => void envoyerAdresse(adresse)} data-connexion-valider-adresse="1">
              {envoi ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
              {t('Valider')}
            </Button>
          </div>
          {erreurAdresse ? (
            <p className="text-[12.5px] leading-relaxed text-danger" data-connexion-erreur-adresse="1">
              {erreurAdresse}
            </p>
          ) : null}
        </div>
        {tempsRestant}
        <div className="flex flex-wrap items-center gap-2">
          {abandonner}
          {connexion.proposerNavigateur ? null : (
            <button
              type="button"
              className="text-[12px] text-faint underline"
              disabled={bascule}
              onClick={() => void changerDeVoie('appareil')}
              data-connexion-voie-appareil="1"
            >
              {bascule ? <Loader2 className="mr-1 inline h-3 w-3 animate-spin" /> : null}
              {t('Revenir au code à saisir')}
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="mt-1.5 space-y-1.5 rounded-md border border-border bg-bg px-2 py-1.5" data-connexion-en-cours="1" data-connexion-voie={connexion.voie}>
      {connexion.lien ? (
        <>
          <p className="text-[12.5px] leading-relaxed text-muted">{t('Ouvrez cette adresse sur votre appareil et connectez-vous :')}</p>
          <a href={connexion.lien} target="_blank" rel="noreferrer" className="block break-all text-[12.5px] text-accent underline">
            {connexion.lien}
          </a>
        </>
      ) : (
        <p className="flex items-center gap-1.5 text-[12.5px] text-faint">
          <Loader2 className="h-3 w-3 animate-spin" /> {t('Le moteur prépare la connexion…')}
        </p>
      )}

      {connexion.code ? (
        <p className="text-[12.5px] leading-relaxed text-muted">
          {t('Puis saisissez ce code sur la page :')} <span className="font-mono text-[14px] text-text">{connexion.code}</span>
        </p>
      ) : null}

      {connexion.attendLeCode ? (
        <div className="flex items-center gap-1.5">
          <Input
            value={code}
            onChange={(event) => setCode(event.target.value)}
            placeholder={t('Collez ici le code rendu par la page')}
            className="h-7 flex-1 text-[12.5px]"
          />
          <Button
            size="sm"
            disabled={!code.trim() || envoi}
            onClick={async () => {
              setEnvoi(true);
              try {
                const rendu = await client.call<{ ok: boolean; error?: string }>({
                  type: 'account.code',
                  id: connexion.id,
                  code,
                });
                if (!rendu.ok) client.pushToast('error', rendu.error ?? 'code refusé');
                else setCode('');
              } finally {
                setEnvoi(false);
              }
            }}
          >
            {envoi ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
            {t('Valider')}
          </Button>
        </div>
      ) : null}

      {connexion.engine === 'codex' ? tempsRestant : null}

      <div className="flex flex-wrap items-center gap-2">
        {abandonner}
        {/* CODEX, SECONDE VOIE : si OpenAI refuse le code dans le navigateur de
            l'utilisateur, le serveur ne le voit jamais — ce lien y mène. */}
        {connexion.engine === 'codex' ? (
          <button
            type="button"
            className="text-[12px] text-faint underline"
            disabled={bascule}
            onClick={() => void changerDeVoie('navigateur')}
            data-connexion-autrement="1"
          >
            {bascule ? <Loader2 className="mr-1 inline h-3 w-3 animate-spin" /> : null}
            {t('Se connecter autrement')}
          </button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * REPRENDRE UNE CONNEXION CODEX TROUVÉE AILLEURS SUR LA MACHINE, d'un clic. Le
 * serveur la DÉPLACE dans le dossier du compte (jamais de copie : deux dossiers
 * se disputeraient la même session), puis fait un vrai essai du moteur.
 */
export function RepriseDeConnexion({ accountId, dossiers }: { accountId: string; dossiers: string[] }) {
  const [envoi, setEnvoi] = React.useState<string | null>(null);
  const [resultat, setResultat] = React.useState<{ ok: boolean; texte: string } | null>(null);
  const reprendre = async (dossier: string) => {
    if (envoi) return;
    setEnvoi(dossier);
    setResultat(null);
    try {
      const rendu = await client.call<{ ok: boolean; message?: string; error?: string }>(
        { type: 'compte.reprendreConnexion', accountId, source: dossier },
        // L'essai réel du moteur peut prendre une minute, et une seconde s'il
        // répare le modèle du compte.
        180_000,
      );
      setResultat({ ok: rendu.ok, texte: (rendu.ok ? rendu.message : rendu.error) ?? '' });
    } catch (err: any) {
      setResultat({ ok: false, texte: err?.message ?? t('reprise impossible') });
    } finally {
      setEnvoi(null);
    }
  };
  return (
    <div className="mt-1.5 space-y-1 rounded-md border border-warning/30 bg-warning/5 px-2 py-1.5" data-reprise-connexion={accountId}>
      <p className="text-[12.5px] leading-relaxed text-warning">
        {t('Aucune connexion dans le dossier de ce compte.')}
      </p>
      {dossiers.map((dossier) => (
        <div key={dossier} className="flex flex-wrap items-center gap-1.5">
          <span className="min-w-0 text-[12.5px] leading-relaxed text-muted">
            {t('Une connexion Codex existe dans {v0}.', { v0: dossier })}
          </span>
          <Button size="sm" variant="outline" disabled={Boolean(envoi)} onClick={() => void reprendre(dossier)} data-reprendre-connexion={dossier}>
            {envoi === dossier ? <Loader2 className="h-3 w-3 animate-spin" /> : <LogIn className="h-3 w-3" />}
            {envoi === dossier ? t('Reprise et essai du moteur…') : t('La reprendre')}
          </Button>
        </div>
      ))}
      {resultat ? (
        <p className={cn('text-[12.5px] leading-relaxed', resultat.ok ? 'text-success' : 'text-danger')} data-reprise-resultat={resultat.ok ? 'ok' : 'echec'}>
          {resultat.texte}
        </p>
      ) : null}
    </div>
  );
}

/**
 * UNE CLÉ D'ACCÈS DE PLUS, pour tout moteur qui se connecte par une clé
 * (Cursor, Xiaomi MiMo… — `connexion: 'cle'` au registre des moteurs). Ces
 * moteurs n'ont pas de page de connexion : sans ce champ, ajouter un compte
 * demandait de créer des fichiers sur le serveur — une possibilité qui
 * n'existait donc pas pour qui n'ouvre pas de terminal.
 *
 * Le compte n'apparaît qu'une fois la clé ÉPROUVÉE par le serveur : une clé
 * refusée dit pourquoi et ne laisse aucune ligne morte dans la liste.
 */
export function AjouterCle({ engine, deplie = false }: { engine: EngineId; deplie?: boolean }) {
  const moteur = nomCourtDuMoteur(engine);
  const [ouvert, setOuvert] = React.useState(deplie);
  const [nom, setNom] = React.useState('');
  const [cle, setCle] = React.useState('');
  const [envoi, setEnvoi] = React.useState(false);
  const [erreur, setErreur] = React.useState<string | null>(null);

  const valider = async () => {
    // Entrée pressée pendant l'envoi : une seule demande part, pas deux.
    if (envoi) return;
    setEnvoi(true);
    setErreur(null);
    try {
      const rendu = await client.call<{ ok: boolean; erreur?: string }>({
        type: 'compte.ajouterCle',
        engine,
        label: nom,
        cle,
      });
      if (!rendu.ok) {
        setErreur(rendu.erreur ?? t('clé refusée'));
        return;
      }
      client.pushToast('success', t('compte {moteur} ajouté', { moteur }));
      setOuvert(deplie);
      setNom('');
      setCle('');
    } catch (err: any) {
      setErreur(err?.message ?? 'ajout impossible');
    } finally {
      setEnvoi(false);
    }
  };

  if (!ouvert) {
    return (
      <Button variant="outline" size="sm" className="mt-1.5" data-cle-cursor={engine === 'cursor' ? 'ouvrir' : undefined} data-cle-moteur={engine} onClick={() => setOuvert(true)}>
        <KeyRound className="h-3 w-3" />

{t('Ajouter une clé {moteur}', { moteur })}
</Button>
    );
  }

  return (
    <div className="mt-1.5 rounded-md border border-border bg-bloc px-2 py-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <Input
          autoFocus={!deplie}
          value={nom}
          placeholder={t('Nom du compte')}
          disabled={envoi}
          onChange={(event) => setNom(event.target.value)}
          className="h-7 w-40 text-[13.5px]"
        />
        <ChampMotDePasse
          value={cle}
          autoComplete="off"
          placeholder={t('Clé d’accès {moteur}', { moteur })}
          disabled={envoi}
          onChange={(event) => setCle(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') valider();
          }}
          cadre="min-w-0 flex-1"
          className="h-7 text-[13.5px]"
        />
        <Button size="sm" disabled={envoi || !nom.trim() || !cle.trim()} onClick={valider}>
          {envoi ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}

{t('Ajouter')}
</Button>
        {deplie ? null : (
          <Button variant="ghost" size="sm" disabled={envoi} onClick={() => setOuvert(false)}>
            {t('Annuler')}</Button>
        )}
        <BulleInfo>
          {engine === 'cursor'
            ? t('La clé se crée sur cursor.com, dans le tableau de bord. Elle est éprouvée avant d\'être retenue : un compte n\'apparaît que s\'il répond vraiment.')
            : t('La clé se crée sur le site de {moteur}. Elle est éprouvée avant d’être retenue : un compte n’apparaît que s’il répond vraiment.', { moteur })}
        </BulleInfo>
      </div>
      {erreur ? <p className="mt-1 text-[12.5px] text-danger">{erreur}</p> : null}
    </div>
  );
}

/**
 * RECONNECTER UN COMPTE À CLÉ : une nouvelle clé pour le MÊME compte.
 *
 * Un compte MiMo ou Cursor n'a pas de page de connexion : son « Reconnecter »
 * ouvrait pourtant la page de Claude. Il déplie désormais ce champ ; la clé
 * est éprouvée par le serveur avant de remplacer l'ancienne, et l'encart ne se
 * referme que sur son accord — un refus reste affiché, avec sa raison.
 */
export function RemplacerCle({
  accountId,
  engine,
  label,
  onFini,
}: {
  accountId: string;
  engine: EngineId;
  label: string;
  onFini: () => void;
}) {
  const moteur = nomCourtDuMoteur(engine);
  const page = descriptionMoteur(engine)?.pageDesCles;
  const [cle, setCle] = React.useState('');
  const [envoi, setEnvoi] = React.useState(false);
  const [erreur, setErreur] = React.useState<string | null>(null);

  const valider = async () => {
    // Entrée pressée pendant l'envoi : une seule demande part, pas deux.
    if (envoi) return;
    setEnvoi(true);
    setErreur(null);
    try {
      const rendu = await client.call<{ ok: boolean; erreur?: string }>({ type: 'compte.remplacerCle', accountId, cle });
      if (!rendu.ok) {
        setErreur(rendu.erreur ?? t('clé refusée'));
        return;
      }
      client.pushToast('success', t('nouvelle clé posée sur « {v0} »', { v0: label }));
      setCle('');
      onFini();
    } catch (err: any) {
      setErreur(err?.message ?? t('clé refusée'));
    } finally {
      setEnvoi(false);
    }
  };

  return (
    <div className="mt-1.5 rounded-md border border-border bg-raised px-2 py-1.5" data-remplacer-cle={accountId}>
      <p className="text-[11.5px] leading-relaxed text-faint">
        {t('Collez la nouvelle clé d’accès de « {v0} ». Elle est éprouvée avant de remplacer l’ancienne.', { v0: label })}{' '}
        {page ? (
          <a href={page} target="_blank" rel="noreferrer" className="underline">
            {t('Obtenir une clé {moteur}', { moteur })}
          </a>
        ) : null}
      </p>
      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        <ChampMotDePasse
          autoFocus
          value={cle}
          autoComplete="off"
          placeholder={t('Clé d’accès {moteur}', { moteur })}
          disabled={envoi}
          onChange={(event) => setCle(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && cle.trim()) void valider();
            if (event.key === 'Escape') onFini();
          }}
          cadre="min-w-0 flex-1"
          className="h-7 text-[13.5px]"
          data-champ-nouvelle-cle
        />
        <Button size="sm" disabled={envoi || !cle.trim()} onClick={valider} data-valider-nouvelle-cle>
          {envoi ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
          {t('Remplacer la clé')}
        </Button>
        <Button size="sm" variant="ghost" disabled={envoi} onClick={onFini}>
          {t('Annuler')}
        </Button>
      </div>
      {erreur ? <p className="mt-1 text-[12.5px] text-danger" data-erreur-nouvelle-cle>{erreur}</p> : null}
    </div>
  );
}
