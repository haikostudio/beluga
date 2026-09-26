import * as React from 'react';
import { KeyRound, Loader2, Save, Send } from 'lucide-react';
import { ConnexionCompte, connexionTerminee } from '@beluga/shared';
import { BulleInfo, Button, Input } from '@/components/ui';
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

/**
 * Une connexion en cours, telle qu'elle se suit à l'écran : l'adresse à ouvrir
 * sur SON téléphone ou son ordinateur, le code à saisir sur la page, et — pour
 * Claude — le champ où recopier le code que la page rend en retour.
 *
 * Rien n'est avalé en silence : une connexion refusée, abandonnée ou trop
 * longue affiche sa cause, en français, à la place de l'adresse.
 */
export function BlocConnexion({ connexion }: { connexion: ConnexionCompte }) {
  const [code, setCode] = React.useState('');
  const [envoi, setEnvoi] = React.useState(false);
  const fini = connexionTerminee(connexion);

  if (fini) {
    return (
      <p
        data-connexion-fin={connexion.etape}
        className={cn(
          'mt-1.5 rounded-md px-2 py-1 text-[12.5px] leading-relaxed',
          connexion.etape === 'reussie'
            ? 'border border-success/30 bg-success/5 text-success'
            : 'border border-danger/30 bg-danger/5 text-danger',
        )}
      >
        {connexion.etape === 'reussie'
          ? t('Connexion réussie')
          : t('Connexion échouée : {v0}', { v0: connexion.message ?? '' })}
      </p>
    );
  }

  // LE CODE EST PARTI : le moteur l'échange contre ses jetons. Plus de champ ni
  // de bouton à cliquer — un chargement, jusqu'au résultat.
  if (connexion.codeEnvoyeA) {
    return (
      <p
        data-connexion-validation="1"
        className="mt-1.5 flex items-center gap-1.5 rounded-md border border-warning/30 bg-warning/5 px-2 py-1 text-[12.5px] text-warning"
      >
        <Loader2 className="h-3 w-3 animate-spin" />
        {t('Connexion en cours…')}
      </p>
    );
  }

  return (
    <div className="mt-1.5 space-y-1.5 rounded-md border border-border bg-bg px-2 py-1.5" data-connexion-en-cours="1">
      {connexion.lien ? (
        <>
          <p className="text-[12.5px] leading-relaxed text-muted">
            {t('Ouvrez cette adresse sur votre appareil et connectez-vous :')}</p>
          <a
            href={connexion.lien}
            target="_blank"
            rel="noreferrer"
            className="block break-all text-[12.5px] text-accent underline"
          >
            {connexion.lien}
          </a>
        </>
      ) : (
        <p className="flex items-center gap-1.5 text-[12.5px] text-faint">
          <Loader2 className="h-3 w-3 animate-spin" />  {t('Le moteur prépare la connexion…')}
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

      {/* ABANDONNER ENGAGE : la connexion continue côté serveur si la demande
          n'arrive pas. Elle passe donc par la demande qui attend réponse. */}
      <Button
        variant="ghost"
        size="sm"
        onClick={() => void client.geste({ type: 'account.cancel', id: connexion.id }, t('Abandonner'))}
      >
        {t('Abandonner')}</Button>
    </div>
  );
}

/**
 * UNE CLÉ CURSOR DE PLUS. Cursor ne se connecte pas par une page de connexion :
 * il n'a qu'une clé. Sans ce champ, ajouter un second compte Cursor demandait
 * de créer des fichiers sur le serveur — une possibilité qui n'existait donc
 * pas pour qui n'ouvre pas de terminal.
 *
 * Le compte n'apparaît qu'une fois la clé ÉPROUVÉE par le serveur : une clé
 * refusée dit pourquoi et ne laisse aucune ligne morte dans la liste.
 */
export function AjouterCleCursor({ deplie = false }: { deplie?: boolean }) {
  const [ouvert, setOuvert] = React.useState(deplie);
  const [nom, setNom] = React.useState('');
  const [cle, setCle] = React.useState('');
  const [envoi, setEnvoi] = React.useState(false);
  const [erreur, setErreur] = React.useState<string | null>(null);

  const valider = async () => {
    setEnvoi(true);
    setErreur(null);
    try {
      const rendu = await client.call<{ ok: boolean; erreur?: string }>({
        type: 'cursor.ajouterCle',
        label: nom,
        cle,
      });
      if (!rendu.ok) {
        setErreur(rendu.erreur ?? t('clé refusée'));
        return;
      }
      client.pushToast('success', t('compte Cursor ajouté'));
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
      <Button variant="outline" size="sm" className="mt-1.5" data-cle-cursor="ouvrir" onClick={() => setOuvert(true)}>
        <KeyRound className="h-3 w-3" />

{t('Ajouter une clé Cursor')}
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
        <Input
          value={cle}
          placeholder={t('Clé d\'accès Cursor')}
          disabled={envoi}
          onChange={(event) => setCle(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') valider();
          }}
          className="h-7 min-w-0 flex-1 text-[13.5px]"
        />
        <Button size="sm" disabled={envoi || !nom.trim() || !cle.trim()} onClick={valider}>
          {envoi ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}

{t('Ajouter')}
</Button>
        {deplie ? null : (
          <Button variant="ghost" size="sm" disabled={envoi} onClick={() => setOuvert(false)}>
            {t('Annuler')}</Button>
        )}
        <BulleInfo>{t('La clé se crée sur cursor.com, dans le tableau de bord. Elle est éprouvée avant d\'être retenue : un compte n\'apparaît que s\'il répond vraiment.')}</BulleInfo>
      </div>
      {erreur ? <p className="mt-1 text-[12.5px] text-danger">{erreur}</p> : null}
    </div>
  );
}
