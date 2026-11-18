import * as React from 'react';
import { Check, Copy, EllipsisVertical, Loader2 } from '@/components/ui/icones';
import { adresseBelugaPassParDefaut, type EtatBelugaPass } from '@beluga/shared';
import {
  Button,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Input,
  Label,
  Switch,
} from '@/components/ui';
import { RubriqueDeReglages } from '@/components/modeles';
import { Silhouette } from '@/components/silhouettes';
import { RondDEtape, type EtatDuRond } from '@/components/rond-d-etape';
import { client } from '@/lib/client';
import { useApp } from '@/lib/use-app';
import { formatRegional, t } from '@/lib/langue';
import { bytes } from '@/lib/utils';

const nombreDeFiches = (n: number) => (n === 1 ? t('1 fiche') : t('{v0} fiches', { v0: n }));
const nombreDeCoffres = (n: number) => (n === 1 ? t('1 coffre') : t('{v0} coffres', { v0: n }));

/** Au-delà, sans nouvelle de Beluga Pass, la fenêtre propose la saisie à la main. */
const ATTENTE_AVANT_AIDE_MS = 45_000;

type Liaison = { cle: string; lien: string; adresseDeBelugaBuild: string; depuis: number };

/**
 * LA PAGE « BELUGA PASS » DES RÉGLAGES — piste D de la carte « Relier Beluga Pass dans les réglages » (16/11/2026).
 * La première version (grand dessin centré, étapes barrées, liens gris flottants, champ au milieu de la page) a été
 * jugée « dégueulasse » : la page reprend la forme des autres réglages.
 *
 *  - UNE SIMPLE LISTE : Liaison (bouton foncé « Relier », ou menu ⋮ une fois relié), Accès des agents (interrupteur,
 *    grisé tant que rien n'est relié), Sauvegarde chiffrée ; les lectures par un agent dessous, seulement s'il y en a ;
 *  - LA LIAISON DANS UNE PETITE FENÊTRE : « Relier » ouvre l'onglet DANS le geste (sinon le bloqueur le refuse),
 *    génère la clé (`belugapass.lier`, jamais à l'ouverture de la page : une clé neuve invalide l'ancienne), envoie
 *    l'onglet sur le lien rempli et ouvre la fenêtre où trois étapes se cochent seules (`RondDEtape`, jamais barrées).
 *    « Rouvrir » réutilise le lien en mémoire, SANS nouvelle clé.
 *
 * Service : `server/src/belugapass.ts` ; commandes `belugapass.etat|lier|delier|acces` ; événement `belugapass` →
 * `belugapassVersion`, qui relit l'état — d'où les étapes qui se cochent sans rien toucher.
 */
export function PageBelugaPass() {
  const version = useApp().belugapassVersion;
  const [etat, setEtat] = React.useState<EtatBelugaPass | null>(null);
  const [erreur, setErreur] = React.useState<string | null>(null);
  /* Ce que seule la réponse de « Relier » porte : la clé (montrée dans la fenêtre seulement) et le lien rempli. */
  const [liaison, setLiaison] = React.useState<Liaison | null>(null);
  const [ongletBloque, setOngletBloque] = React.useState(false);
  const [adresse, setAdresse] = React.useState(adresseBelugaPassParDefaut());
  const [fenetre, setFenetre] = React.useState(false);
  const [fenetreAdresse, setFenetreAdresse] = React.useState(false);
  const [enCours, setEnCours] = React.useState<'cle' | 'acces' | 'delier' | null>(null);
  const [confirmerDelier, setConfirmerDelier] = React.useState(false);
  const [confirmerNouvelle, setConfirmerNouvelle] = React.useState(false);

  React.useEffect(() => {
    let vivant = true;
    client
      .call<{ etat: EtatBelugaPass }>({ type: 'belugapass.etat' })
      .then((r) => {
        if (!vivant) return;
        setEtat(r.etat);
        if (r.etat.existe) setAdresse(r.etat.endpoint);
      })
      .catch((e) => vivant && setErreur(String((e as Error)?.message ?? e)));
    return () => {
      vivant = false;
    };
  }, [version]);

  const relier = async () => {
    /* L'ONGLET S'OUVRE DANS LE GESTE, avant tout `await` : après l'attente du serveur, le navigateur le bloquerait. */
    const onglet = typeof window !== 'undefined' ? window.open('', '_blank') : null;
    setEnCours('cle');
    setErreur(null);
    setOngletBloque(false);
    setFenetre(true);
    try {
      const r = await client.call<{ cle: string; lien: string; adresseDeBelugaBuild: string; etat: EtatBelugaPass }>(
        { type: 'belugapass.lier', endpoint: adresse.trim(), origine: window.location.origin },
        20000,
      );
      setEtat(r.etat);
      setLiaison({ cle: r.cle, lien: r.lien, adresseDeBelugaBuild: r.adresseDeBelugaBuild, depuis: Date.now() });
      if (onglet && !onglet.closed) {
        try {
          onglet.opener = null;
        } catch {
          /* rien : l'onglet reste utilisable */
        }
        onglet.location.href = r.lien;
      } else {
        setOngletBloque(true);
      }
    } catch (e) {
      onglet?.close();
      setFenetre(false);
      setErreur(String((e as Error)?.message ?? e));
    } finally {
      setEnCours(null);
    }
  };

  /** ROUVRIR SANS NOUVELLE CLÉ : le lien de la liaison en cours est encore en mémoire. Sinon, une liaison neuve. */
  const rouvrir = () => {
    if (!liaison) {
      void relier();
      return;
    }
    setFenetre(true);
    /* Pas de « noopener » dans les options : Chrome rend alors `null`, et l'on croirait l'onglet bloqué. */
    const onglet = window.open(liaison.lien, '_blank');
    if (onglet) {
      try {
        onglet.opener = null;
      } catch {
        /* rien */
      }
    }
    setOngletBloque(!onglet);
  };

  const basculer = async (ouvrir: boolean) => {
    setEnCours('acces');
    setErreur(null);
    try {
      setEtat((await client.call<{ etat: EtatBelugaPass }>({ type: 'belugapass.acces', ouvrir }, 20000)).etat);
    } catch (e) {
      setErreur(String((e as Error)?.message ?? e));
    } finally {
      setEnCours(null);
    }
  };

  const delier = async () => {
    setEnCours('delier');
    setErreur(null);
    try {
      setEtat((await client.call<{ etat: EtatBelugaPass }>({ type: 'belugapass.delier' }, 20000)).etat);
      setLiaison(null);
    } catch (e) {
      setErreur(String((e as Error)?.message ?? e));
    } finally {
      setEnCours(null);
    }
  };

  const quand = (ms: number | null) => (ms ? new Date(ms).toLocaleString(formatRegional(), { dateStyle: 'medium', timeStyle: 'short' }) : '—');

  if (!etat) {
    return (
      <div className="flex flex-col gap-4" data-belugapass-page="chargement" aria-busy>
        <Silhouette />
        {erreur ? <p className="text-[12.5px] text-danger">{erreur}</p> : null}
      </div>
    );
  }

  const relie = etat.relie;
  const recue = !!etat.derniereSauvegardeLe;
  const etatDeLaPage = relie ? 'relie' : etat.existe ? 'attente' : 'vide';
  const detailDeLaLiaison = relie
    ? etat.derniereErreur ?? t('Relié depuis le {v0}', { v0: quand(etat.relieLe) })
    : etat.existe
      ? t('En attente de Beluga Pass')
      : t('Non relié');

  const menu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" disabled={enCours !== null} title={t('Options')} data-belugapass-options>
          {enCours === 'delier' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <EllipsisVertical className="h-4 w-4" />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {etat.existe ? (
          <DropdownMenuItem onSelect={() => setConfirmerNouvelle(true)} data-belugapass-relier-a-nouveau>
            {t('Relier à nouveau')}
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem onSelect={() => setFenetreAdresse(true)} data-belugapass-autre-adresse>
          {t('Autre adresse de Beluga Pass')}
        </DropdownMenuItem>
        {etat.existe ? (
          <DropdownMenuItem onSelect={() => setConfirmerDelier(true)} className="text-danger" data-belugapass-delier>
            {t('Délier')}
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <div className="flex flex-col gap-7" data-belugapass-page={etatDeLaPage}>
      <RubriqueDeReglages
        titre={t('Beluga Pass')}
        description={t('Beluga Build garde une copie chiffrée de vos coffres, et vos agents peuvent les lire si vous le permettez.')}
      >
        <Ligne libelle={t('Liaison')} detail={detailDeLaLiaison} repere="liaison">
          {!relie ? (
            <Button
              variant="creation"
              size="md"
              onClick={() => (etat.existe ? rouvrir() : void relier())}
              disabled={enCours !== null}
              aria-busy={enCours === 'cle' || undefined}
              data-belugapass-relier
            >
              {enCours === 'cle' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              {etat.existe ? t('Rouvrir') : t('Relier')}
            </Button>
          ) : null}
          {menu}
        </Ligne>
        <Ligne
          libelle={t('Accès des agents')}
          detail={relie && !etat.agentAccess && etat.derniereErreur ? etat.derniereErreur : t('En lecture seule, chaque lecture est signalée dans Beluga Pass.')}
          repere="acces"
        >
          <Switch
            checked={etat.agentAccess}
            disabled={!relie}
            attente={enCours === 'acces'}
            onCheckedChange={(v) => void basculer(v)}
            aria-label="Accès des agents à Beluga Pass"
            data-belugapass-acces={etat.agentAccess ? 'ouvert' : 'ferme'}
          />
        </Ligne>
        <div className="flex min-w-0 flex-col rounded-xl px-3.5 py-3" data-belugapass-sauvegarde={recue ? 'recue' : 'aucune'}>
          <span className="text-[14px] text-text">{t('Sauvegarde chiffrée')}</span>
          <span className="text-[12.5px] text-muted">
            {recue
              ? `${quand(etat.derniereSauvegardeLe)} · ${bytes(etat.volume ?? 0)} · ${nombreDeCoffres(etat.coffres ?? 0)} · ${nombreDeFiches(etat.fiches ?? 0)}`
              : t('Aucune copie reçue pour l’instant.')}
          </span>
        </div>
      </RubriqueDeReglages>

      {erreur ? (
        <p className="px-1 text-[12.5px] text-danger" data-belugapass-erreur>
          {erreur}
        </p>
      ) : null}

      {etat.lectures.length ? (
        <RubriqueDeReglages titre={t('Dernières lectures par un agent')}>
          <div className="flex flex-col" data-belugapass-lectures>
            {etat.lectures.map((l, i) => (
              <div key={`${l.quand}-${i}`} className="flex items-center justify-between gap-3 rounded-xl px-3.5 py-2.5">
                <span className="min-w-0 truncate text-[13.5px] text-text">{l.agent}</span>
                <span className="shrink-0 text-[12px] text-faint">
                  {l.erreur ? t('refusée') : nombreDeFiches(l.fiches)} · {quand(l.quand)}
                </span>
              </div>
            ))}
          </div>
        </RubriqueDeReglages>
      ) : null}

      <FenetreDeLiaison
        ouverte={fenetre}
        fermer={() => setFenetre(false)}
        etat={etat}
        liaison={liaison}
        cleEnCours={enCours === 'cle'}
        ongletBloque={ongletBloque}
        rouvrir={rouvrir}
      />

      <FenetreDAdresse
        ouverte={fenetreAdresse}
        adresse={adresse}
        fermer={() => setFenetreAdresse(false)}
        enregistrer={(a) => {
          setAdresse(a);
          setFenetreAdresse(false);
        }}
      />

      <ConfirmDialog
        open={confirmerDelier}
        title={t('Délier Beluga Pass ?')}
        description={t('Beluga Pass est prévenu, la sauvegarde chiffrée reçue est effacée et la clé de liaison ne vaut plus rien. Vos fiches restent dans Beluga Pass.')}
        confirmLabel={t('Délier')}
        danger
        onConfirm={() => {
          setConfirmerDelier(false);
          void delier();
        }}
        onClose={() => setConfirmerDelier(false)}
      />
      <ConfirmDialog
        open={confirmerNouvelle}
        title={t('Relier à nouveau ?')}
        description={t('La liaison actuelle cesse de fonctionner et Beluga Pass s’ouvre pour en confirmer une nouvelle. L’accès des agents se referme.')}
        confirmLabel={t('Relier à nouveau')}
        onConfirm={() => {
          setConfirmerNouvelle(false);
          void relier();
        }}
        onClose={() => setConfirmerNouvelle(false)}
      />
    </div>
  );
}

/** Une ligne de réglage dont le contrôle reste À DROITE, sur téléphone aussi (un bouton court et un ⋮). */
function Ligne({ libelle, detail, repere, children }: { libelle: string; detail: string; repere: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 rounded-xl px-3.5 py-3" data-ligne-de-reglage data-belugapass-ligne={repere}>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-[14px] text-text">{libelle}</span>
        <span className="text-[12.5px] text-muted" data-belugapass-detail>
          {detail}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-1">{children}</div>
    </div>
  );
}

/**
 * LA PETITE FENÊTRE « RELIER BELUGA PASS » : trois étapes qui se cochent en direct (une clé existe / Beluga Pass a
 * confirmé / première sauvegarde reçue), « Saisir à la main » qui se déplie DANS la fenêtre, et un pied à deux boutons
 * — réduit à « Terminé » une fois tout coché. La fermer ne défait rien.
 */
function FenetreDeLiaison({
  ouverte,
  fermer,
  etat,
  liaison,
  cleEnCours,
  ongletBloque,
  rouvrir,
}: {
  ouverte: boolean;
  fermer: () => void;
  etat: EtatBelugaPass;
  liaison: Liaison | null;
  cleEnCours: boolean;
  ongletBloque: boolean;
  rouvrir: () => void;
}) {
  const [aLaMain, setALaMain] = React.useState(false);
  const [copie, setCopie] = React.useState<'adresse' | 'cle' | null>(null);
  const [maintenant, setMaintenant] = React.useState(() => Date.now());

  const relie = etat.relie;
  const recue = !!etat.derniereSauvegardeLe;
  const fini = relie && recue;
  const attend = ouverte && !!liaison && !relie;

  React.useEffect(() => {
    if (!attend) return;
    setMaintenant(Date.now());
    const minuterie = window.setInterval(() => setMaintenant(Date.now()), 5_000);
    return () => window.clearInterval(minuterie);
  }, [attend]);
  React.useEffect(() => {
    if (!ouverte) {
      setALaMain(false);
      setCopie(null);
    }
  }, [ouverte]);

  const copier = async (quoi: 'adresse' | 'cle', valeur: string) => {
    try {
      await navigator.clipboard.writeText(valeur);
      setCopie(quoi);
    } catch {
      setCopie(null);
    }
  };

  const etapes: { cle: string; titre: string; detail: string; etat: EtatDuRond }[] = [
    {
      cle: 'ouvrir',
      titre: t('Beluga Pass s’est ouvert'),
      detail: t('Ouverture de Beluga Pass…'),
      etat: etat.existe && !cleEnCours ? 'done' : 'running',
    },
    {
      cle: 'confirmer',
      titre: t('Cliquez « Relier » dans Beluga Pass'),
      detail: t('Connectez-vous si besoin, puis confirmez la liaison.'),
      etat: relie ? 'done' : etat.existe && !cleEnCours ? 'running' : 'todo',
    },
    {
      cle: 'sauvegarde',
      titre: t('Première sauvegarde reçue'),
      detail: t('Beluga Pass envoie une copie chiffrée de vos coffres.'),
      etat: recue ? 'done' : relie ? 'running' : 'todo',
    },
  ];
  const sansNouvelles = attend && maintenant - (liaison?.depuis ?? maintenant) > ATTENTE_AVANT_AIDE_MS;
  const adresseDeBuild = liaison?.adresseDeBelugaBuild ?? etat.adresseDeBelugaBuild ?? window.location.origin;

  return (
    <Dialog open={ouverte} onOpenChange={(o) => !o && fermer()}>
      <DialogContent className="sm:w-[min(440px,100%)]" data-belugapass-fenetre={fini ? 'relie' : 'en-cours'}>
        <DialogHeader>
          <DialogTitle>{fini ? t('Beluga Pass est relié') : t('Relier Beluga Pass')}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4 pb-1">
          <ol className="flex flex-col gap-3" data-belugapass-etapes>
            {etapes.map((e) => (
              <li key={e.cle} className="flex items-start gap-2.5" data-belugapass-etape={e.cle} data-etat={e.etat}>
                <RondDEtape etat={e.etat} className="mt-px" />
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className={e.etat === 'todo' ? 'text-[14px] text-faint' : 'text-[14px] text-text'}>{e.titre}</span>
                  {e.etat === 'running' ? <span className="text-[12.5px] text-muted">{e.detail}</span> : null}
                </div>
              </li>
            ))}
          </ol>

          {ongletBloque && liaison && !relie ? (
            <a href={liaison.lien} target="_blank" rel="noopener noreferrer" className="text-[13px] text-important underline-offset-2 hover:underline" data-belugapass-lien>
              {t('Le navigateur a bloqué l’ouverture : cliquez ici pour ouvrir Beluga Pass.')}
            </a>
          ) : null}
          {sansNouvelles ? (
            <p className="text-[12.5px] text-muted" data-belugapass-sans-nouvelles>
              {t('Rien n’arrive ? Vérifiez que vous êtes connecté à Beluga Pass, ou collez l’adresse et la clé à la main.')}
            </p>
          ) : null}

          {!fini && (aLaMain || sansNouvelles) ? (
            <div className="flex flex-col gap-1 rounded-xl bg-surface p-1.5" data-belugapass-saisie>
              <p className="px-2 pt-1 text-[12.5px] text-muted">{t('Dans Beluga Pass : Réglages → Beluga Build, collez ces deux valeurs.')}</p>
              <ValeurACopier
                libelle={t('Adresse de Beluga Build')}
                valeur={adresseDeBuild}
                copiee={copie === 'adresse'}
                copier={() => void copier('adresse', adresseDeBuild)}
                repere="data-belugapass-copier-adresse"
              />
              {liaison ? (
                <ValeurACopier
                  libelle={t('Clé de liaison')}
                  valeur={liaison.cle}
                  copiee={copie === 'cle'}
                  copier={() => void copier('cle', liaison.cle)}
                  repere="data-belugapass-copier"
                  cle
                />
              ) : (
                <p className="px-2 py-1.5 text-[12.5px] text-muted">{t('La clé ne s’affiche qu’au moment où vous reliez.')}</p>
              )}
            </div>
          ) : null}
        </div>
        <DialogFooter>
          {fini ? (
            <Button variant="creation" onClick={fermer} data-belugapass-termine>
              {t('Terminé')}
            </Button>
          ) : (
            <>
              <Button variant="subtle" onClick={() => setALaMain((v) => !v)} aria-pressed={aLaMain} data-belugapass-a-la-main>
                {t('Saisir à la main')}
              </Button>
              <Button variant="creation" onClick={rouvrir} disabled={cleEnCours} data-belugapass-rouvrir>
                {cleEnCours ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                {t('Rouvrir Beluga Pass')}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ValeurACopier({
  libelle,
  valeur,
  copiee,
  copier,
  repere,
  cle,
}: {
  libelle: string;
  valeur: string;
  copiee: boolean;
  copier: () => void;
  repere: string;
  cle?: boolean;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg px-2 py-1.5">
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-[13px] text-text">{libelle}</span>
        <code className="min-w-0 select-all truncate font-mono text-[12px] text-muted" {...(cle ? { 'data-belugapass-cle-montree': '' } : {})}>
          {valeur}
        </code>
      </div>
      <Button variant="subtle" size="sm" className="shrink-0" onClick={copier} {...{ [repere]: '' }}>
        {copiee ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        {copiee ? t('Copiée') : t('Copier')}
      </Button>
    </div>
  );
}

/** « AUTRE ADRESSE DE BELUGA PASS » : une petite fenêtre, la valeur sert à la prochaine liaison. */
function FenetreDAdresse({ ouverte, adresse, fermer, enregistrer }: { ouverte: boolean; adresse: string; fermer: () => void; enregistrer: (a: string) => void }) {
  const [valeur, setValeur] = React.useState(adresse);
  React.useEffect(() => {
    if (ouverte) setValeur(adresse);
  }, [ouverte, adresse]);
  const valide = /^https?:\/\/\S+$/i.test(valeur.trim());
  return (
    <Dialog open={ouverte} onOpenChange={(o) => !o && fermer()}>
      <DialogContent className="sm:w-[min(440px,100%)]" data-belugapass-fenetre-adresse>
        <DialogHeader>
          <DialogTitle>{t('Autre adresse de Beluga Pass')}</DialogTitle>
        </DialogHeader>
        <form
          className="flex flex-col gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            if (valide) enregistrer(valeur.trim());
          }}
        >
          <Label htmlFor="belugapass-adresse">{t('Adresse de Beluga Pass')}</Label>
          <Input id="belugapass-adresse" value={valeur} onChange={(e) => setValeur(e.target.value)} autoComplete="off" data-belugapass-adresse />
        </form>
        <DialogFooter pleineLargeur>
          <Button variant="creation" onClick={() => enregistrer(valeur.trim())} disabled={!valide} data-belugapass-enregistrer-adresse>
            {t('Enregistrer')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
