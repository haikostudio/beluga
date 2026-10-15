import * as React from 'react';
import { Check, Copy, Loader2, RefreshCw, RotateCw, Send } from 'lucide-react';
import {
  IDENTITE_VIERGE,
  NOM_DE_COPIE_PAR_DEFAUT,
  PREREGLAGES_SMTP,
  adresseDeCourrielValide,
  adresseProposeePourLEspaceClient,
  hoteNu,
  nomDeDepotValide,
  nomDeDomaineValide,
  type EtatDesNouveautes,
  type GenreDeSecret,
  type IdentiteDInstallation,
  type TravailDInstallation,
} from '@beluga/shared';
import { Button, ChampMotDePasse, Input, Switch } from '@/components/ui';
import { Champ } from '@/components/card-panel';
import { ExplorateurDeCompetences } from '@/components/installation/explorateur-competences';
import { BoutonInstaller, SortieDuTravail, useTravailDuGenre } from '@/components/installation/travail';
import { useRedemarrage } from '@/components/redemarrage';
import { client } from '@/lib/client';
import { recupererLesNouveautes } from '@/lib/nouveautes';
import { installationEnDirect, useNouveautes } from '@/lib/travail-installation';
import { useApp } from '@/lib/use-app';
import { cn } from '@/lib/utils';
import { t } from '@/lib/langue';

/*
 * LES RÉGLAGES D'UNE INSTALLATION — écrits UNE fois, montrés à DEUX endroits.
 *
 * L'assistant de premier démarrage (`assistant-demarrage.tsx`) les déroule page
 * par page ; la page « Installation » des réglages
 * (`reglages/page-installation.tsx`) les montre ensemble. Ce sont les MÊMES
 * composants : une page passée « plus tard » dans l'assistant se retrouve donc
 * à l'identique dans les réglages, sans second écran à tenir à jour.
 *
 * Deux sortes de champs :
 *  - un NOM ou une ADRESSE s'enregistre en quittant le champ, par les réglages
 *    ordinaires (`settings.update`, objet `installation`) ;
 *  - un GESTE sur la machine — poser une adresse, ranger une clé, relier
 *    GitHub, importer une bibliothèque — part par sa commande et dit ce qu'il a
 *    fait (`server/src/installation-commandes.ts`).
 */

/** Ce que le démon dit de l'installation (`installation.etat`). */
export interface EtatDeLInstallation {
  adresseProvisoire: boolean;
  reverseProxyGere: boolean;
  ip: string;
  compte: string;
  github: { installe: boolean; connecte: boolean; compte?: string };
  secrets: Record<GenreDeSecret, boolean>;
  /** Par où partent les courriels (`null` : rien ne part) et, sinon, ce qui manque. */
  courriels: { mode: string | null; extinction: string };
  bibliotheques: string[];
  bibliothequesProposees: { id: string; source: string; nom: string; description: string }[];
  facultatif: { id: 'dictee' | 'voix'; installee: boolean; commande: string }[];
  /** La mémoire « par le sens » : posée par l'installateur, réparable d'ici. */
  memoire: { enPlace: boolean; commande: string };
  /** Le travail d'installation en cours ou le dernier terminé, sortie comprise. */
  travail: TravailDInstallation | null;
  /** L'installation est-elle devenue la copie personnelle de qui l'a installée ? */
  copie: { faite: boolean; depot: string; projet: boolean };
  nouveautes: EtatDesNouveautes;
}

/** L'état de l'installation, relu à la demande : chaque geste réussi le rafraîchit. */
export function useEtatDeLInstallation(): {
  etat: EtatDeLInstallation | null;
  /** La première lecture est-elle revenue, réussie ou non ? Avant, l'écran n'affirme rien. */
  lu: boolean;
  relire: () => Promise<void>;
} {
  const [etat, setEtat] = React.useState<EtatDeLInstallation | null>(null);
  const [lu, setLu] = React.useState(false);
  const relire = React.useCallback(async () => {
    try {
      const rendu = await client.call<{ etat: EtatDeLInstallation }>({ type: 'installation.etat' });
      setEtat(rendu.etat);
      // Un travail lancé avant ce chargement (ou depuis un autre appareil) se
      // retrouve ici, sortie comprise ; les nouveautés aussi.
      installationEnDirect.reprendre(rendu.etat?.travail);
      installationEnDirect.recevoirLesNouveautes(rendu.etat?.nouveautes);
    } catch {
      /* le démon ne répond pas : l'écran garde ce qu'il savait */
    } finally {
      setLu(true);
    }
  }, []);
  React.useEffect(() => {
    void relire();
  }, [relire]);
  return { etat, lu, relire };
}

/** L'identité enregistrée, et la fonction qui en retouche un champ. */
export function useIdentite(): {
  identite: IdentiteDInstallation;
  enregistrer: (patch: Partial<IdentiteDInstallation>) => void;
} {
  const state = useApp();
  const identite = (state.settings?.installation ?? IDENTITE_VIERGE) as IdentiteDInstallation;
  const enregistrer = React.useCallback(
    (patch: Partial<IdentiteDInstallation>) => {
      const courante = (client.lireEtat().settings?.installation ?? IDENTITE_VIERGE) as IdentiteDInstallation;
      void client
        .call({ type: 'settings.update', patch: { installation: { ...courante, ...patch } } })
        .catch(() => client.pushToast('error', t('réglage non enregistré')));
    },
    [],
  );
  return { identite, enregistrer };
}

/** Une ligne d'état : ce qui est en place, en vert ; ce qui manque, en gris. */
export function LigneDEtat({ fait, children }: { fait: boolean; children: React.ReactNode }) {
  return (
    <p
      data-etat-installation={fait ? 'fait' : 'a-faire'}
      className={cn('flex items-start gap-1.5 text-[13px] leading-relaxed', fait ? 'text-success' : 'text-faint')}
    >
      {fait ? <Check className="mt-[3px] h-3 w-3 shrink-0" /> : <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-faint" />}
      <span className="min-w-0">{children}</span>
    </p>
  );
}

/** Un refus du démon, écrit sous le champ qui l'a provoqué. */
function Refus({ texte }: { texte: string | null }) {
  if (!texte) return null;
  return (
    <p data-refus-installation className="text-[13px] leading-relaxed text-danger">
      {texte}
    </p>
  );
}

/** Un champ de l'identité : il s'enregistre en le quittant, s'il a changé et s'il est bien formé. */
function ChampIdentite({
  cle,
  label,
  aide,
  exemple,
  valide,
}: {
  cle: keyof IdentiteDInstallation;
  label: string;
  aide?: string;
  exemple?: string;
  /** Rend le refus à afficher, ou `null` quand la saisie convient. Une saisie vide convient toujours. */
  valide?: (valeur: string) => string | null;
}) {
  const { identite, enregistrer } = useIdentite();
  const [refus, setRefus] = React.useState<string | null>(null);
  return (
    <Champ label={label} aide={aide}>
      <Input
        key={identite[cle]}
        data-identite={cle}
        defaultValue={identite[cle]}
        placeholder={exemple}
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        onBlur={(event) => {
          const valeur = event.target.value.trim();
          const probleme = valeur && valide ? valide(valeur) : null;
          setRefus(probleme);
          if (!probleme && valeur !== identite[cle]) enregistrer({ [cle]: valeur });
        }}
      />
      <Refus texte={refus} />
    </Champ>
  );
}

/** Un secret : jamais relu, jamais affiché. On dit seulement s'il est rangé. */
function ChampSecret({
  genre,
  label,
  aide,
  range,
  apres,
}: {
  genre: GenreDeSecret;
  label: string;
  aide?: string;
  range: boolean;
  apres: () => Promise<void>;
}) {
  const [valeur, setValeur] = React.useState('');
  const [envoi, setEnvoi] = React.useState(false);
  const [refus, setRefus] = React.useState<string | null>(null);
  const ranger = async () => {
    setEnvoi(true);
    setRefus(null);
    try {
      const rendu = await client.call<{ ok: boolean; erreur?: string }>({ type: 'installation.secret', genre, valeur });
      if (rendu.ok) {
        setValeur('');
        await apres();
      } else setRefus(rendu.erreur ?? t('clé refusée'));
    } catch (err: any) {
      setRefus(err?.message ?? t('clé refusée'));
    } finally {
      setEnvoi(false);
    }
  };
  return (
    <Champ label={label} aide={aide}>
      <div className="flex items-center gap-1.5">
        <ChampMotDePasse
          data-secret={genre}
          value={valeur}
          autoComplete="off"
          placeholder={range ? t('Déjà rangée — collez-en une autre pour la remplacer') : t('Collez la clé ici')}
          onChange={(event) => setValeur(event.target.value)}
          cadre="flex-1"
        />
        <Button variant="subtle" size="md" data-ranger-secret={genre} disabled={!valeur.trim() || envoi} onClick={ranger}>
          {envoi ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
          {t('Ranger au coffre-fort')}
        </Button>
      </div>
      <LigneDEtat fait={range}>{range ? t('Clé rangée au coffre-fort.') : t('Aucune clé rangée pour l’instant.')}</LigneDEtat>
      <Refus texte={refus} />
    </Champ>
  );
}

/** Une commande à coller dans un terminal du serveur, avec son bouton de copie. */
export function CommandeACopier({ commande, repere }: { commande: string; repere?: string }) {
  const [copie, setCopie] = React.useState(false);
  const copier = async () => {
    try {
      await navigator.clipboard.writeText(commande);
      setCopie(true);
      setTimeout(() => setCopie(false), 2000);
    } catch {
      client.pushToast('error', t('copie impossible depuis ce navigateur'));
    }
  };
  return (
    <div className="flex items-center gap-1.5">
      <code
        data-commande={repere}
        className="min-w-0 flex-1 select-all overflow-x-auto whitespace-pre rounded bg-raised px-2 py-1.5 font-mono text-[12px] text-text"
      >
        {commande}
      </code>
      <Button variant="ghost" size="icon-sm" onClick={copier} title={t('Copier la commande')}>
        {copie ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
      </Button>
    </div>
  );
}

/** Un geste qui pose une adresse dans le reverse-proxy : le champ, son bouton, sa réponse. */
function ChampDAdresse({
  genre,
  label,
  aide,
  exemple,
  actuelle,
  apres,
  proposition,
}: {
  genre: 'administration' | 'espace-client';
  label: string;
  aide?: string;
  exemple: string;
  actuelle: string;
  apres: () => Promise<void>;
  /** Une adresse déjà remplie, à valider d'un clic ou à corriger, et d'où elle vient. */
  proposition?: { hote: string; explication: string } | null;
}) {
  const [valeur, setValeur] = React.useState(actuelle ? '' : (proposition?.hote ?? ''));
  /* La proposition arrive avec l'état de l'installation : le champ la prend tant qu'on n'y a rien tapé. */
  const touche = React.useRef(false);
  React.useEffect(() => {
    if (!touche.current && !actuelle && proposition?.hote) setValeur(proposition.hote);
  }, [proposition?.hote, actuelle]);
  const [envoi, setEnvoi] = React.useState(false);
  const [refus, setRefus] = React.useState<string | null>(null);
  const [posee, setPosee] = React.useState<string | null>(null);
  const poser = async () => {
    const hote = hoteNu(valeur);
    if (!nomDeDomaineValide(hote)) {
      setRefus(t('Ce n’est pas un nom de domaine : écrivez-le comme « {exemple} ».', { exemple }));
      return;
    }
    setEnvoi(true);
    setRefus(null);
    setPosee(null);
    try {
      const rendu = await client.call<{ ok: boolean; erreur?: string; adresse?: string }>(
        { type: 'installation.adresse', genre, hote },
        90_000,
      );
      if (rendu.ok) {
        setPosee(rendu.adresse ?? hote);
        setValeur('');
        await apres();
      } else setRefus(rendu.erreur ?? t('adresse refusée'));
    } catch (err: any) {
      setRefus(err?.message ?? t('adresse refusée'));
    } finally {
      setEnvoi(false);
    }
  };
  return (
    <Champ label={label} aide={aide}>
      {actuelle ? (
        <p className="text-[13px] text-muted" data-adresse-actuelle={genre}>
          {t('Adresse actuelle : {adresse}', { adresse: actuelle })}
        </p>
      ) : null}
      <div className="flex items-center gap-1.5">
        <Input
          data-adresse={genre}
          value={valeur}
          placeholder={exemple}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          onChange={(event) => {
            touche.current = true;
            setValeur(event.target.value);
          }}
          className="flex-1"
        />
        <Button variant="subtle" size="md" data-poser-adresse={genre} disabled={!valeur.trim() || envoi} onClick={poser}>
          {envoi ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
          {t('Mettre en place')}
        </Button>
      </div>
      {proposition && !actuelle && hoteNu(valeur) === proposition.hote ? (
        <p className="text-[13px] leading-relaxed text-muted" data-adresse-proposee={genre}>
          {proposition.explication}
        </p>
      ) : null}
      {posee ? <LigneDEtat fait>{t('Adresse en place : {adresse}', { adresse: posee })}</LigneDEtat> : null}
      <Refus texte={refus} />
    </Champ>
  );
}

/**
 * UN CHOIX PARMI QUELQUES-UNS, écrit en lignes : chacune dit ce qu'elle
 * implique, ce qu'une liste déroulante cacherait. La ligne choisie porte la
 * couleur de l'élément choisi.
 */
function ChoixEnLignes<Valeur extends string>({
  repere,
  valeur,
  choix,
  onChoisir,
}: {
  repere: string;
  valeur: string;
  /**
   * `bloque` : le choix ne peut pas marcher ici (dit en rouge, et il ne se
   * prend plus) ; `conseille` : celui qu'on recommande, marqué d'un mot.
   */
  choix: readonly { id: Valeur; nom: string; detail?: string; bloque?: string; conseille?: boolean }[];
  onChoisir: (id: Valeur) => void;
}) {
  return (
    <div role="radiogroup" data-choix={repere} className="space-y-1.5">
      {choix.map((un) => {
        const choisi = un.id === valeur;
        return (
          <button
            key={un.id}
            type="button"
            role="radio"
            aria-checked={choisi}
            data-choix-valeur={un.id}
            data-choix-bloque={un.bloque ? '1' : undefined}
            disabled={Boolean(un.bloque) && !choisi}
            onClick={() => onChoisir(un.id)}
            className={cn(
              'flex w-full items-start gap-2.5 rounded-lg bg-raised px-3 py-2.5 text-left transition-colors hover:bg-raised/80 disabled:cursor-not-allowed',
              choisi ? 'text-teinte' : 'text-text',
              un.bloque && !choisi && 'text-muted',
            )}
          >
            <span className="mt-[3px] flex h-3.5 w-3.5 shrink-0 items-center justify-center">
              {choisi ? <Check className="h-3.5 w-3.5" /> : <span className="h-1.5 w-1.5 rounded-full bg-faint" />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2 text-[14px] font-medium">
                {un.nom}
                {un.conseille ? <span className="rounded bg-bg px-1.5 py-px text-[11.5px] font-normal text-muted">{t('Conseillé')}</span> : null}
              </span>
              {un.detail ? <span className="block text-[13px] leading-relaxed text-muted">{un.detail}</span> : null}
              {un.bloque ? <span className="mt-0.5 block text-[13px] leading-relaxed text-danger">{un.bloque}</span> : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}

const refusDeDomaine = (valeur: string) =>
  nomDeDomaineValide(hoteNu(valeur)) ? null : t('Ce n’est pas un nom de domaine : écrivez-le comme « {exemple} ».', { exemple: 'exemple.com' });
const refusDeCourriel = (valeur: string) =>
  adresseDeCourrielValide(valeur) ? null : t('Ce n’est pas une adresse de courriel.');

/* ------------------------------------------------------------------ */
/* Le nom de domaine                                                    */
/* ------------------------------------------------------------------ */

export function SectionDomaine({ etat, relire }: { etat: EtatDeLInstallation | null; relire: () => Promise<void> }) {
  const { identite } = useIdentite();
  return (
    <div className="space-y-5" data-section-installation="domaine">
      {etat?.adresseProvisoire ? (
        <p className="text-[13.5px] leading-relaxed text-muted" data-adresse-provisoire>
          {t('Cette installation répond pour l’instant sur une adresse provisoire. Elle fonctionne et elle est sécurisée, mais elle dépend d’un service extérieur : dès que vous avez un nom de domaine, mettez-le ici.')}
        </p>
      ) : null}
      <ChampDAdresse
        genre="administration"
        label={t('Adresse de Beluga Build')}
        aide={t('Le nom doit déjà mener à ce serveur : créez d’abord, chez votre fournisseur de noms, un enregistrement « A » vers l’adresse {ip}. L’adresse actuelle continue de répondre.', { ip: etat?.ip || '…' })}
        exemple="beluga.exemple.com"
        actuelle={identite.adressePublique}
        apres={relire}
      />
      {etat && !etat.reverseProxyGere ? (
        <ChampIdentite
          cle="adressePublique"
          label={t('Adresse déjà en place')}
          aide={t('Sur ce serveur, les adresses se créent à la main. Écrivez ici celle qui mène à Beluga Build : elle sert aux liens des courriels et au suivi des visites.')}
          exemple="https://beluga.exemple.com"
        />
      ) : null}
      <ChampIdentite
        cle="zoneDesProjets"
        label={t('Nom de domaine des projets')}
        aide={t('Chaque projet reçoit une adresse sous ce nom : « mon-projet.exemple.com ». Laissé vide, aucun projet ne reçoit d’adresse automatiquement.')}
        exemple="exemple.com"
        valide={refusDeDomaine}
      />
      <FournisseurDeNomsDesProjets etat={etat} relire={relire} />
    </div>
  );
}

/**
 * QUI TIENT LE NOM DE DOMAINE DES PROJETS. Chez cinq fournisseurs, Beluga Build
 * crée lui-même l'adresse de chaque projet, avec un jeton rangé au coffre-fort.
 * Partout ailleurs, une règle « tous les noms » posée UNE fois suffit : rien à
 * confier, et n'importe quel fournisseur convient.
 */
function FournisseurDeNomsDesProjets({ etat, relire }: { etat: EtatDeLInstallation | null; relire: () => Promise<void> }) {
  const { identite, enregistrer } = useIdentite();
  // Une installation d'avant ce réglage a son jeton Hetzner : c'est son choix, sans qu'elle l'ait coché.
  const choisi = identite.fournisseurDeNoms || (etat?.secrets.dns ? 'hetzner' : '');
  const zone = identite.zoneDesProjets || 'exemple.com';
  const jeton = (genre: GenreDeSecret, label: string, aide?: string) => (
    <ChampSecret genre={genre} label={label} aide={aide} range={Boolean(etat?.secrets[genre])} apres={relire} />
  );
  return (
    <div className="space-y-3" data-fournisseur-de-noms={choisi || 'aucun'}>
      <Champ
        label={t('Qui gère ce nom de domaine ?')}
        aide={t('Chez ces fournisseurs, Beluga Build crée lui-même l’adresse de chaque projet. Chez tous les autres, une règle posée une fois suffit.')}
      >
        <ChoixEnLignes
          repere="fournisseur-de-noms"
          valeur={choisi}
          onChoisir={(id) => enregistrer({ fournisseurDeNoms: id })}
          choix={[
            { id: 'hetzner', nom: 'Hetzner' },
            { id: 'cloudflare', nom: 'Cloudflare' },
            { id: 'infomaniak', nom: 'Infomaniak' },
            { id: 'ovh', nom: 'OVH' },
            { id: 'gandi', nom: 'Gandi' },
            { id: 'joker', nom: t('Un autre fournisseur'), detail: t('Une règle « tous les noms », posée une fois chez lui.') },
          ]}
        />
      </Champ>
      {choisi === 'hetzner'
        ? jeton('dns', t('Jeton Hetzner'), t('À créer dans la console Hetzner, avec le droit d’écrire dans la zone du nom de domaine.'))
        : null}
      {choisi === 'cloudflare'
        ? jeton('dns-cloudflare', t('Jeton Cloudflare'), t('À créer dans Cloudflare, « My Profile », « API Tokens », avec le droit de modifier les enregistrements de cette zone.'))
        : null}
      {choisi === 'infomaniak'
        ? jeton('dns-infomaniak', t('Jeton Infomaniak'), t('À créer dans le Manager Infomaniak, « Développeur », « Tokens API », avec le droit sur les noms de domaine.'))
        : null}
      {choisi === 'gandi'
        ? jeton('dns-gandi', t('Jeton Gandi'), t('À créer dans votre compte Gandi, « Jetons d’accès personnels », avec le droit de gérer les enregistrements du domaine.'))
        : null}
      {choisi === 'ovh' ? (
        <>
          <p className="text-[13px] leading-relaxed text-muted">
            {t('OVH demande trois clés, créées ensemble sur la page « createToken » de son API, avec les droits GET, POST et DELETE sur « /domain/zone/* ».')}
          </p>
          {jeton('dns-ovh-application', t('OVH — clé d’application'))}
          {jeton('dns-ovh-secret', t('OVH — secret d’application'))}
          {jeton('dns-ovh-consommateur', t('OVH — clé de consommateur'))}
        </>
      ) : null}
      {choisi === 'joker' ? (
        <p className="text-[13.5px] leading-relaxed text-muted" data-regle-tous-les-noms>
          {t('Créez une fois, chez votre fournisseur, un enregistrement de type « A » nommé « *.{zone} » vers l’adresse {ip}. Tous les noms sous « {zone} » mènent alors ici, et Beluga Build n’a aucun jeton à recevoir : il vérifie seulement que l’adresse d’un projet répond avant de la mettre en service.', { zone, ip: etat?.ip || '…' })}
        </p>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* GitHub                                                               */
/* ------------------------------------------------------------------ */

export function SectionGitHub({ etat, relire }: { etat: EtatDeLInstallation | null; relire: () => Promise<void> }) {
  const [jeton, setJeton] = React.useState('');
  const [envoi, setEnvoi] = React.useState(false);
  const [refus, setRefus] = React.useState<string | null>(null);
  const connecter = async () => {
    setEnvoi(true);
    setRefus(null);
    try {
      const rendu = await client.call<{ github: { connecte: boolean; erreur?: string } }>({ type: 'installation.github', jeton });
      if (rendu.github.connecte) setJeton('');
      else setRefus(rendu.github.erreur ?? t('GitHub a refusé ce jeton.'));
      await relire();
    } catch (err: any) {
      setRefus(err?.message ?? t('GitHub a refusé ce jeton.'));
    } finally {
      setEnvoi(false);
    }
  };
  const github = etat?.github;
  return (
    <div className="space-y-3" data-section-installation="github">
      {github?.connecte ? (
        <LigneDEtat fait>{t('GitHub est relié au compte {compte}.', { compte: github.compte ?? '' })}</LigneDEtat>
      ) : github && !github.installe ? (
        <LigneDEtat fait={false}>{t('L’outil GitHub n’est pas installé sur ce serveur.')}</LigneDEtat>
      ) : (
        <Champ
          label={t('Jeton d’accès GitHub')}
          aide={t('À créer sur github.com, dans Settings, Developer settings, Personal access tokens, avec les droits « repo » et « workflow ». Il reste sur ce serveur.')}
        >
          <div className="flex items-center gap-1.5">
            <ChampMotDePasse
              data-jeton-github
              value={jeton}
              autoComplete="off"
              placeholder="ghp_xxxxxxxxxxxx"
              onChange={(event) => setJeton(event.target.value)}
              cadre="flex-1"
            />
            <Button variant="subtle" size="md" data-relier-github disabled={!jeton.trim() || envoi} onClick={connecter}>
              {envoi ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
              {t('Relier GitHub')}
            </Button>
          </div>
          <LigneDEtat fait={false}>{t('GitHub n’est pas encore relié.')}</LigneDEtat>
          <Refus texte={refus} />
        </Champ>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Les courriels                                                        */
/* ------------------------------------------------------------------ */

/** Le choix « Par ce serveur » : dit ouvert une fois la sonde passée, sinon invite à l'essai (bloqué, l'appelant remplace ce détail). */
const CHOIX_PAR_CE_SERVEUR = (sortie: { agent: boolean; port25: boolean } | null) => ({
  id: 'serveur' as const,
  nom: t('Par ce serveur'),
  detail: sortie ? t('Rien à créer ailleurs : la sortie directe est ouverte sur ce serveur.') : t('Rien à créer ailleurs. Beaucoup d’hébergeurs bloquent pourtant cet envoi : faites l’essai.'),
});

export function SectionCourriels({ etat, relire }: { etat: EtatDeLInstallation | null; relire: () => Promise<void> }) {
  const { identite, enregistrer } = useIdentite();
  // Une installation d'avant ce réglage envoie déjà par Resend : c'est ce que le démon retient.
  const mode = identite.modeDesCourriels || etat?.courriels.mode || '';
  /*
   * LA SORTIE DIRECTE EST SONDÉE DÈS L'OUVERTURE. Beaucoup d'hébergeurs ferment
   * le port 25 : on le disait seulement après un essai raté, en rouge sous le
   * bouton. L'étape le sait maintenant d'emblée — « Par ce serveur » se dit
   * bloqué et ne se prend plus, et le service de courriel passe en tête.
   */
  const [sortie, setSortie] = React.useState<{ agent: boolean; port25: boolean } | null>(null);
  React.useEffect(() => {
    let vivant = true;
    client
      .call<{ agent: boolean; port25: boolean }>({ type: 'installation.courriel-sonde' }, 30_000)
      .then((rendu) => vivant && setSortie(rendu))
      .catch(() => undefined);
    return () => {
      vivant = false;
    };
  }, []);
  const blocage = !sortie
    ? undefined
    : !sortie.port25
      ? t('Bloqué chez votre hébergeur : la sortie directe des courriels (port 25) est fermée sur ce serveur. Choisissez un service de courriel.')
      : !sortie.agent
        ? t('Aucun programme d’envoi n’est installé sur ce serveur. Choisissez un service de courriel.')
        : undefined;
  const expediteurGmail = /@(gmail|googlemail)\.com$/i.test(identite.expediteurDesCourriels ?? '');
  const passerParUnService = () => {
    enregistrer({ modeDesCourriels: 'smtp', ...(expediteurGmail ? { smtpHote: 'smtp.gmail.com', smtpPort: '587' } : {}) });
    window.setTimeout(() => void relire(), 400);
  };
  return (
    <div
      className="space-y-5"
      data-section-installation="courriels"
      data-mode-des-courriels={mode || 'aucun'}
      data-sortie-directe={sortie ? (blocage ? 'bloquee' : 'ouverte') : 'sondage'}
    >
      <ChampIdentite
        cle="nomDeLEntreprise"
        label={t('Nom de votre entreprise')}
        aide={t('Il signe les courriels envoyés à vos clients.')}
        exemple="Atelier Durand"
      />
      <ChampIdentite
        cle="nomCourt"
        label={t('Votre nom, tel que vos clients le lisent')}
        aide={t('Il signe vos messages dans l’espace client. Laissé vide, c’est le nom de l’entreprise.')}
        exemple="Ana"
      />
      <ChampIdentite
        cle="expediteurDesCourriels"
        label={t('Adresse d’expédition')}
        aide={t('L’adresse d’où partent les courriels, sur un nom de domaine qui est le vôtre. Laissée vide, aucun courriel ne part.')}
        exemple="bonjour@exemple.com"
        valide={refusDeCourriel}
      />
      <ChampIdentite
        cle="adresseDuRecapitulatif"
        label={t('Votre adresse, pour le point du matin')}
        aide={t('Chaque matin, un courriel résume ce qui vous attend chez vos clients, et une alerte part quand un site surveillé tombe. Laissée vide, rien ne vous est envoyé.')}
        exemple="moi@exemple.com"
        valide={refusDeCourriel}
      />
      <Champ
        label={t('Par où envoyer les courriels')}
        aide={t('Beluga Build vérifie tout seul si ce serveur peut envoyer lui-même. S’il est bloqué par votre hébergeur, n’importe quel service de courriel fait l’affaire.')}
      >
        <ChoixEnLignes
          repere="mode-des-courriels"
          valeur={mode}
          onChoisir={(id) => {
            enregistrer({ modeDesCourriels: id });
            // Le démon dit aussitôt ce qui manque à ce choix.
            window.setTimeout(() => void relire(), 400);
          }}
          choix={[
            ...(blocage ? [] : [CHOIX_PAR_CE_SERVEUR(sortie)]),
            { id: 'smtp', nom: t('Par un service de courriel'), detail: t('Celui que vous avez déjà : votre hébergeur de courriels, Brevo, Mailgun, Gmail…'), conseille: Boolean(blocage) },
            { id: 'resend', nom: 'Resend', detail: t('Un service d’envoi par clé : créez-y un compte et vérifiez votre nom de domaine.') },
            ...(blocage ? [{ ...CHOIX_PAR_CE_SERVEUR(sortie), detail: undefined, bloque: blocage }] : []),
          ]}
        />
        {!sortie ? (
          <p className="flex items-center gap-1.5 text-[13px] text-muted" data-sonde-en-cours>
            <Loader2 className="h-3 w-3 animate-spin" />
            {t('Vérification de l’envoi direct depuis ce serveur…')}
          </p>
        ) : null}
        {blocage && mode === 'serveur' ? (
          <div className="flex flex-wrap items-center gap-2" data-envoi-direct-impossible>
            <p className="min-w-0 flex-1 text-[13px] leading-relaxed text-danger">
              {t('Avec ce choix, aucun courriel ne partira : passez par un service de courriel.')}
            </p>
            <Button variant="subtle" size="sm" onClick={passerParUnService} data-passer-par-un-service>
              {expediteurGmail ? t('Envoyer par Gmail') : t('Passer par un service de courriel')}
            </Button>
          </div>
        ) : null}
      </Champ>
      {mode === 'smtp' ? (
        <div className="space-y-3" data-reglages-smtp>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[13px] text-muted">{t('Préréglages :')}</span>
            {PREREGLAGES_SMTP.map((service) => (
              <Button
                key={service.id}
                variant="ghost"
                size="sm"
                data-prereglage-smtp={service.id}
                onClick={() => enregistrer({ smtpHote: service.hote, smtpPort: service.port, modeDesCourriels: 'smtp' })}
              >
                {service.nom}
              </Button>
            ))}
          </div>
          <ChampIdentite cle="smtpHote" label={t('Serveur d’envoi')} aide={t('L’adresse du serveur d’envoi (SMTP) donnée par votre service de courriel.')} exemple="smtp.exemple.com" valide={refusDeDomaine} />
          <ChampIdentite cle="smtpPort" label={t('Port')} aide={t('Presque toujours 587 ; 465 chez quelques services.')} exemple="587" />
          <ChampIdentite cle="smtpIdentifiant" label={t('Identifiant')} aide={t('Souvent votre adresse de courriel, ou l’identifiant que le service vous a donné.')} exemple="bonjour@exemple.com" />
          <ChampSecret
            genre="smtp"
            label={t('Mot de passe du service de courriel')}
            aide={
              /gmail\.com$/i.test(identite.smtpHote ?? '')
                ? t('Chez Gmail, ce n’est pas votre mot de passe habituel : créez un « mot de passe d’application » dans votre compte Google (Sécurité, Validation en deux étapes, Mots de passe des applications), puis collez-le ici.')
                : undefined
            }
            range={Boolean(etat?.secrets.smtp)}
            apres={relire}
          />
        </div>
      ) : null}
      {mode === 'resend' ? (
        <ChampSecret
          genre="courriels"
          label={t('Clé Resend')}
          aide={t('Créez un compte chez Resend, vérifiez-y votre nom de domaine, puis collez ici la clé d’API.')}
          range={Boolean(etat?.secrets.courriels)}
          apres={relire}
        />
      ) : null}
      {etat ? (
        etat.courriels.mode ? (
          <LigneDEtat fait>{t('Les courriels sont réglés. Un essai vous dit s’ils arrivent vraiment.')}</LigneDEtat>
        ) : (
          <LigneDEtat fait={false}>{etat.courriels.extinction ? `${etat.courriels.extinction}.` : t('Aucun courriel ne part pour l’instant.')}</LigneDEtat>
        )
      ) : null}
      <CourrielDEssai parDefaut={identite.adresseDuRecapitulatif} relire={relire} />
    </div>
  );
}

/**
 * L'ESSAI RÉEL. Un vrai courriel part par la façon choisie, et l'écran dit ce
 * qui s'est RÉELLEMENT passé — y compris « votre hébergeur bloque cet envoi »,
 * qu'aucun réglage ne permet de deviner.
 */
function CourrielDEssai({ parDefaut, relire }: { parDefaut: string; relire: () => Promise<void> }) {
  const [adresse, setAdresse] = React.useState('');
  const [envoi, setEnvoi] = React.useState(false);
  const [bilan, setBilan] = React.useState<{ ok: boolean; texte: string } | null>(null);
  const destinataire = (adresse || parDefaut).trim();
  const envoyer = async () => {
    setEnvoi(true);
    setBilan(null);
    try {
      await relire();
      setBilan(await client.call<{ ok: boolean; texte: string }>({ type: 'installation.courriel-essai', a: destinataire }, 90_000));
    } catch (err: any) {
      setBilan({ ok: false, texte: err?.message ?? t('L’essai n’a pas pu partir.') });
    } finally {
      setEnvoi(false);
    }
  };
  return (
    <Champ label={t('Essayer pour de vrai')} aide={t('Un court message part vers cette adresse, par la façon d’envoyer choisie ci-dessus.')}>
      <div className="flex items-center gap-1.5">
        <Input
          data-courriel-d-essai
          value={adresse}
          placeholder={parDefaut}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          onChange={(event) => setAdresse(event.target.value)}
          className="flex-1"
        />
        <Button variant="subtle" size="md" data-envoyer-courriel-d-essai disabled={envoi || !adresseDeCourrielValide(destinataire)} onClick={() => void envoyer()}>
          {envoi ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
          {envoi ? t('Envoi en cours…') : t('Envoyer un courriel d’essai')}
        </Button>
      </div>
      {bilan ? (
        <p data-bilan-courriel-d-essai={bilan.ok ? 'ok' : 'refus'} className={cn('text-[13px] leading-relaxed', bilan.ok ? 'text-success' : 'text-danger')}>
          {bilan.texte}
        </p>
      ) : null}
    </Champ>
  );
}

/* ------------------------------------------------------------------ */
/* L'espace client                                                      */
/* ------------------------------------------------------------------ */

export function SectionEspaceClient({ etat, relire }: { etat: EtatDeLInstallation | null; relire: () => Promise<void> }) {
  const { identite } = useIdentite();
  /* La configuration déjà faite décide de l'adresse proposée : domaine, sinon adresse provisoire du serveur. */
  const proposee = adresseProposeePourLEspaceClient({ adressePublique: identite.adressePublique, zoneDesProjets: identite.zoneDesProjets, ip: etat?.ip });
  const proposition = proposee
    ? {
        hote: proposee.hote,
        explication:
          proposee.origine === 'domaine'
            ? t('Proposée d’après votre nom de domaine. Créez d’abord chez votre fournisseur de noms un enregistrement « A » vers {ip}, puis mettez-la en place.', { ip: etat?.ip || '…' })
            : t('Proposée d’après l’adresse provisoire de ce serveur : elle fonctionne tout de suite, sans nom de domaine. Vous pourrez la remplacer par la vôtre plus tard.'),
      }
    : null;
  return (
    <div className="space-y-5" data-section-installation="espace-client">
      <ChampIdentite
        cle="nomEspaceClient"
        label={t('Nom de l’espace client')}
        aide={t('Le nom que vos clients voient en haut de leur espace et sous l’icône de l’application installée.')}
        exemple={t('Espace client')}
      />
      <ChampDAdresse
        genre="espace-client"
        label={t('Adresse de l’espace client (facultatif)')}
        aide={t('Une adresse à part pour vos clients, qui ne montre rien de l’administration. Le nom doit déjà mener à ce serveur ({ip}). Sans adresse à part, vos clients se connectent sur la même adresse que vous et arrivent directement dans leur espace.', { ip: etat?.ip || '…' })}
        exemple="my.exemple.com"
        actuelle={identite.hoteEspaceClient ? `https://${identite.hoteEspaceClient}` : ''}
        apres={relire}
        proposition={etat?.reverseProxyGere === false ? null : proposition}
      />
      {etat && !etat.reverseProxyGere ? (
        <ChampIdentite
          cle="hoteEspaceClient"
          label={t('Adresse déjà en place')}
          aide={t('Sur ce serveur, les adresses se créent à la main. Écrivez ici celle qui mène à l’espace client.')}
          exemple="my.exemple.com"
          valide={refusDeDomaine}
        />
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Les bibliothèques de compétences                                     */
/* ------------------------------------------------------------------ */

export function SectionCompetences({ etat, relire }: { etat: EtatDeLInstallation | null; relire: () => Promise<void> }) {
  const [choisies, setChoisies] = React.useState<string[]>([]);
  const [enCours, setEnCours] = React.useState<string | null>(null);
  const [bilans, setBilans] = React.useState<Record<string, { ok: boolean; texte: string }>>({});
  const proposees = etat?.bibliothequesProposees ?? [];
  const importees = etat?.bibliotheques ?? [];

  const importer = async () => {
    for (const source of choisies) {
      setEnCours(source);
      try {
        const rendu = await client.call<{ ok: boolean; texte: string }>({ type: 'installation.bibliotheque', source }, 300_000);
        setBilans((avant) => ({ ...avant, [source]: rendu }));
      } catch (err: any) {
        setBilans((avant) => ({ ...avant, [source]: { ok: false, texte: err?.message ?? t('import impossible') } }));
      }
    }
    setEnCours(null);
    setChoisies([]);
    await relire();
  };

  return (
    <div className="space-y-3" data-section-installation="competences">
      <ul className="space-y-1.5">
        {proposees.map((bibliotheque) => {
          const dejaLa = importees.includes(bibliotheque.id);
          const cochee = choisies.includes(bibliotheque.source);
          const bilan = bilans[bibliotheque.source];
          return (
            <li key={bibliotheque.id}>
              <label
                data-bibliotheque={bibliotheque.id}
                data-importee={dejaLa ? '1' : '0'}
                className={cn('flex cursor-pointer items-center gap-3 rounded-lg bg-raised px-3 py-2.5', dejaLa && 'cursor-default')}
              >
                <Switch
                  checked={dejaLa || cochee}
                  disabled={dejaLa || enCours !== null}
                  onCheckedChange={(coche) =>
                    setChoisies((avant) =>
                      coche ? [...avant, bibliotheque.source] : avant.filter((s) => s !== bibliotheque.source),
                    )
                  }
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px] font-medium text-text">{bibliotheque.nom}</span>
                  <span className="block text-[13px] leading-relaxed text-muted">{t(bibliotheque.description)}</span>
                  {enCours === bibliotheque.source ? (
                    <span className="mt-1 flex items-center gap-1.5 text-[13px] text-muted">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      {t('Import en cours…')}
                    </span>
                  ) : bilan ? (
                    <span className={cn('mt-1 block text-[13px]', bilan.ok ? 'text-success' : 'text-danger')}>{bilan.texte}</span>
                  ) : dejaLa ? (
                    <span className="mt-1 block text-[13px] text-success">{t('Déjà importée.')}</span>
                  ) : null}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      <Button variant="subtle" size="md" data-importer-bibliotheques disabled={!choisies.length || enCours !== null} onClick={importer}>
        {enCours ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
        {t('Importer ce qui est coché')}
      </Button>
      <p className="text-[13.5px] leading-relaxed text-muted" data-sources-par-un-agent>
        {t('Ce choix n’est pas définitif. Vous pourrez toujours ajouter d’autres sources de compétences plus tard : il suffit de le demander à un agent, en lui donnant l’adresse de la bibliothèque.')}
      </p>
      <ExplorateurDeCompetences rafraichir={importees.join(',')} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Les fonctions facultatives                                           */
/* ------------------------------------------------------------------ */

/** Le nom et l'utilité d'une fonction facultative, dans la langue affichée. */
function fonctionEnClair(id: string): { nom: string; detail: string } {
  if (id === 'dictee') {
    return { nom: t('Dictée'), detail: t('Parler à Beluga Build au lieu d’écrire : votre voix est transcrite sur ce serveur.') };
  }
  return { nom: t('Voix'), detail: t('Le point du jour lu à voix haute, par une voix installée sur ce serveur.') };
}

/**
 * La commande, pour qui préfère son terminal. Elle ne se montre qu'APRÈS un
 * échec de l'installation par bouton : c'est un repli, pas le chemin.
 */
function RepliParCommande({ genre, commande }: { genre: string; commande: string }) {
  const { travail } = useTravailDuGenre(genre);
  if (travail?.etat !== 'echoue') return null;
  return (
    <div className="space-y-1" data-repli-par-commande={genre}>
      <p className="text-[13px] leading-relaxed text-muted">{t('Vous pouvez aussi la lancer vous-même, dans un terminal du serveur :')}</p>
      <CommandeACopier commande={commande} repere={genre} />
    </div>
  );
}

export function SectionFacultatif({ etat, relire }: { etat: EtatDeLInstallation | null; relire: () => Promise<void> }) {
  const [relecture, setRelecture] = React.useState(false);
  return (
    <div className="space-y-3" data-section-installation="facultatif">
      <p className="text-[13.5px] leading-relaxed text-muted">
        {t('Ces fonctions téléchargent plusieurs centaines de mégaoctets : elles s’installent à la demande, d’un bouton, et vous voyez l’installation se dérouler.')}
      </p>
      <ul className="space-y-1.5">
        {(etat?.facultatif ?? []).map((fonction) => (
          <li key={fonction.id} data-fonction={fonction.id} data-installee={fonction.installee ? '1' : '0'} className="space-y-1.5 rounded-lg bg-raised px-3 py-2.5">
            <p className="text-[14px] font-medium text-text">{fonctionEnClair(fonction.id).nom}</p>
            <p className="text-[13px] leading-relaxed text-muted">{fonctionEnClair(fonction.id).detail}</p>
            {fonction.installee ? (
              <LigneDEtat fait>{t('Installée.')}</LigneDEtat>
            ) : (
              <>
                <BoutonInstaller genre={fonction.id} apres={relire} />
                <RepliParCommande genre={fonction.id} commande={fonction.commande} />
              </>
            )}
          </li>
        ))}
      </ul>
      <Button
        variant="ghost"
        size="sm"
        disabled={relecture}
        onClick={async () => {
          setRelecture(true);
          await relire();
          setRelecture(false);
        }}
      >
        {relecture ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
        {t('Vérifier à nouveau')}
      </Button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* La mémoire                                                           */
/* ------------------------------------------------------------------ */

/**
 * LA MÉMOIRE « PAR LE SENS » N'EST PAS UNE OPTION : c'est par elle que Beluga
 * Build retrouve ce qu'il a appris d'un projet à l'autre. L'installation la
 * pose d'office ; ici, on lit seulement si elle est en place — et on la répare
 * d'un bouton si son téléchargement avait échoué.
 */
export function SectionMemoire({ etat, relire }: { etat: EtatDeLInstallation | null; relire: () => Promise<void> }) {
  if (!etat) return null;
  return (
    <div className="space-y-2" data-section-installation="memoire" data-memoire={etat.memoire.enPlace ? 'en-place' : 'a-reparer'}>
      {etat.memoire.enPlace ? (
        <LigneDEtat fait>{t('La mémoire de Beluga Build est en place : il retrouve une idée même quand les mots diffèrent.')}</LigneDEtat>
      ) : (
        <>
          <LigneDEtat fait={false}>
            {t('La mémoire de Beluga Build n’a pas pu s’installer avec le reste. Sans elle, il retrouve moins bien ce qu’il a appris : installez-la maintenant.')}
          </LigneDEtat>
          <BoutonInstaller genre="memoire" libelle={t('Installer la mémoire')} apres={relire} />
          <RepliParCommande genre="memoire" commande={etat.memoire.commande} />
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Votre propre Beluga                                                  */
/* ------------------------------------------------------------------ */

/**
 * FAIRE DE CETTE INSTALLATION SA COPIE PERSONNELLE : un dépôt privé sur le
 * GitHub de la personne, et le projet de l'application sur son tableau. C'est
 * de là qu'elle le modifie, avec ses propres agents.
 */
export function SectionCopie({ etat, relire }: { etat: EtatDeLInstallation | null; relire: () => Promise<void> }) {
  const [nom, setNom] = React.useState('');
  const choisi = nom.trim() || NOM_DE_COPIE_PAR_DEFAUT;
  const github = etat?.github;
  if (!etat) return null;
  if (etat.copie.faite) {
    return (
      <div className="space-y-1.5" data-section-installation="copie" data-copie="faite">
        <LigneDEtat fait>{t('Votre copie est en place : {depot}.', { depot: etat.copie.depot })}</LigneDEtat>
        <LigneDEtat fait>{t('Le projet « Beluga Build » est sur votre tableau : demandez-y vos changements comme pour n’importe quel projet.')}</LigneDEtat>
      </div>
    );
  }
  return (
    <div className="space-y-3" data-section-installation="copie" data-copie="a-faire">
      {github?.connecte ? (
        <>
          <Champ
            label={t('Nom de votre dépôt')}
            aide={t('Il est créé en privé sur votre compte GitHub {compte}. Personne d’autre ne le voit.', { compte: github.compte ?? '' })}
          >
            <Input
              data-nom-de-la-copie
              value={nom}
              placeholder={NOM_DE_COPIE_PAR_DEFAUT}
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              onChange={(event) => setNom(event.target.value)}
            />
            {nomDeDepotValide(choisi) ? null : <Refus texte={t('Ce nom ne convient pas : lettres, chiffres et tirets seulement.')} />}
          </Champ>
          <BoutonInstaller
            genre="copie"
            libelle={t('Créer ma copie')}
            commande={{ type: 'installation.copie', nom: choisi }}
            apres={relire}
          />
        </>
      ) : (
        <LigneDEtat fait={false}>
          {t('GitHub n’est pas encore relié. Reliez-le d’abord (page « GitHub et votre premier projet »), puis revenez ici.')}
        </LigneDEtat>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Les nouveautés du dépôt public                                       */
/* ------------------------------------------------------------------ */

/**
 * LE BOUTON « RÉCUPÉRER LES NOUVEAUTÉS » des réglages. Il ne paraît que sur une
 * installation qui SUIT le dépôt public : ailleurs, il n'y a rien à récupérer,
 * donc rien à montrer.
 */
export function SectionNouveautes() {
  const nouveautes = useNouveautes();
  const { travail } = useTravailDuGenre('mise-a-jour');
  const redemarrage = useRedemarrage();
  const [envoi, setEnvoi] = React.useState(false);
  if (!nouveautes?.suivi) return null;

  const recuperer = async () => {
    setEnvoi(true);
    try {
      // Le dépôt public est relu d'abord : le bouton sert aussi à vérifier.
      const relu = await client.call<{ etat: EtatDesNouveautes }>({ type: 'installation.nouveautes', forcer: true }, 120_000);
      installationEnDirect.recevoirLesNouveautes(relu.etat);
      if (relu.etat.erreur) client.pushToast('warning', relu.etat.erreur);
      else if (!relu.etat.disponibles) client.pushToast('success', t('Beluga Build est à jour.'));
      else await recupererLesNouveautes();
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('Les nouveautés n’ont pas pu être récupérées.'));
    } finally {
      setEnvoi(false);
    }
  };

  return (
    <div className="space-y-2" data-section-installation="nouveautes" data-nouveautes={nouveautes.disponibles ? 'disponibles' : 'a-jour'}>
      {nouveautes.disponibles ? (
        <LigneDEtat fait={false}>
          {nouveautes.nombre
            ? t('{n} nouveauté(s) de Beluga Build sont disponibles.', { n: String(nouveautes.nombre) })
            : t('Des nouveautés de Beluga Build sont disponibles.')}
        </LigneDEtat>
      ) : (
        <LigneDEtat fait>{t('Beluga Build est à jour.')}</LigneDEtat>
      )}
      <p className="text-[13px] leading-relaxed text-muted">
        {nouveautes.copie
          ? t('Cette installation est votre copie : les nouveautés sont rapprochées de vos modifications par un agent, dans une tâche que vous lancez et relisez.')
          : t('Rien n’est appliqué sans vous : les nouveautés se récupèrent quand vous le demandez.')}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="subtle" size="md" data-recuperer-les-nouveautes disabled={envoi || travail?.etat === 'en-cours'} onClick={() => void recuperer()}>
          {envoi || travail?.etat === 'en-cours' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          {t('Récupérer les nouveautés')}
        </Button>
        {travail?.etat === 'reussi' ? (
          <Button variant="default" size="md" data-redemarrer-apres-mise-a-jour onClick={redemarrage.ouvrir}>
            <RotateCw className="h-3.5 w-3.5" />
            {t('Redémarrer pour appliquer')}
          </Button>
        ) : null}
      </div>
      {travail?.etat === 'echoue' ? <Refus texte={travail.erreur ?? t('L’installation a échoué.')} /> : null}
      {travail ? <SortieDuTravail /> : null}
      {redemarrage.dialogue}
    </div>
  );
}
