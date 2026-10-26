import * as React from 'react';
import { ChevronDown, ChevronRight, KeyRound, Loader2, Plus, ShieldOff, UserPlus } from 'lucide-react';
import {
  NIVEAUX_PROJET,
  NIVEAUX_SERVICE,
  SERVICES_OUVRABLES,
  aideDuService,
  droitsDeDepart,
  droitsDuCompte,
  etatDuCompteEnClair,
  jugerIdentifiant,
  libelleDuNiveau,
  libelleDuService,
  nomDuCompte,
  type CompteUtilisateur,
  type DroitsDAcces,
  type NiveauProjet,
  type NiveauService,
  type ServiceOuvrable,
} from '@beluga/shared';
import { Button, ConfirmDialog, Input, Switch } from '@/components/ui';
import { Groupe } from '@/components/reglages/communs';
import { MotDePasseMontre, type SecretMontre } from '@/components/reglages/comptes-clients';
import { client } from '@/lib/client';
import { t } from '@/lib/langue';
import { useApp } from '@/lib/use-app';
import { cn, relativeTime } from '@/lib/utils';

/**
 * LES ACCÈS TIERS À BELUGA, DANS « MON COMPTE ».
 *
 * Une personne qui entre dans l'environnement de développement de Beluga sans
 * en être l'administratrice reçoit une GRILLE (`shared/src/droits-d-acces.ts`) :
 * projet par projet (fermé, voir, travailler, déployer) et service par service
 * (aucun, voir, modifier). Les droits se jugent au serveur ; cet écran ne fait
 * que les poser.
 *
 * L'ancien onglet « Sous-comptes » n'existe plus : les comptes CLIENTS, qui
 * n'ouvrent que la messagerie, se créent depuis la messagerie et n'apparaissent
 * pas ici. Le premier formulaire part de « rien d'ouvert » ; les suivants
 * reprennent la grille du dernier accès créé (`droitsDeDepart`).
 */

/** Une rangée de boutons collés : le niveau choisi est en violet (l'élément choisi). */
function Segments<T extends string>({
  valeurs,
  valeur,
  onChoisir,
  libelle,
  repere,
}: {
  valeurs: readonly T[];
  valeur: T;
  onChoisir: (v: T) => void;
  libelle: (v: T) => string;
  repere: string;
}) {
  return (
    <div className="flex shrink-0 rounded-lg bg-raised p-0.5" role="radiogroup" data-segments={repere} data-valeur={valeur}>
      {valeurs.map((v) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={valeur === v}
          data-niveau={v}
          onClick={() => valeur !== v && onChoisir(v)}
          className={cn(
            'h-[34px] sm:h-7 rounded-md px-2.5 text-[12.5px] transition-colors',
            valeur === v ? 'bg-surface font-medium text-teinte' : 'text-muted hover:text-text',
          )}
        >
          {t(libelle(v))}
        </button>
      ))}
    </div>
  );
}

type NiveauDeLigne = 'ferme' | NiveauProjet;
const NIVEAUX_DE_LIGNE: readonly NiveauDeLigne[] = ['ferme', ...NIVEAUX_PROJET];

/** LA GRILLE : un projet par ligne, puis un service par ligne. */
export function GrilleDeDroits({
  droits,
  onChanger,
  repere,
}: {
  droits: DroitsDAcces;
  onChanger: (droits: DroitsDAcces) => void;
  repere: string;
}) {
  const state = useApp();
  const projets = React.useMemo(
    () => [...state.projects].sort((a, b) => a.name.localeCompare(b.name)),
    [state.projects],
  );
  const poserProjet = (id: string, niveau: NiveauDeLigne) => {
    const suite = { ...droits.projets };
    if (niveau === 'ferme') delete suite[id];
    else suite[id] = niveau;
    onChanger({ ...droits, projets: suite });
  };
  const poserService = (service: ServiceOuvrable, niveau: NiveauService) => {
    const suite = { ...droits.services };
    if (niveau === 'aucun') delete suite[service];
    else suite[service] = niveau;
    onChanger({ ...droits, services: suite });
  };
  return (
    <div className="flex flex-col gap-3" data-grille-de-droits={repere}>
      <div>
        <p className="mb-1 text-[12px] uppercase tracking-wide text-faint">{t('Projets')}</p>
        <div className="flex flex-col">
          {projets.map((projet) => (
            <div key={projet.id} className="flex items-center gap-2 py-1" data-droit-projet={projet.id}>
              <span className="min-w-0 flex-1 truncate text-[13.5px] text-text">{projet.name}</span>
              <Segments
                valeurs={NIVEAUX_DE_LIGNE}
                valeur={droits.projets[projet.id] ?? 'ferme'}
                onChoisir={(v) => poserProjet(projet.id, v)}
                libelle={libelleDuNiveau}
                repere={`${repere}-${projet.id}`}
              />
            </div>
          ))}
          {!projets.length ? <p className="text-xs text-muted">{t('Aucun projet pour l’instant.')}</p> : null}
        </div>
      </div>
      <div>
        <p className="mb-1 text-[12px] uppercase tracking-wide text-faint">{t('Services')}</p>
        <div className="flex flex-col">
          {SERVICES_OUVRABLES.map((service) => (
            <div key={service} className="flex items-center gap-2 py-1" data-droit-service={service}>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px] text-text">{t(libelleDuService(service))}</span>
                <span className="block text-[12px] leading-snug text-faint">{t(aideDuService(service))}</span>
              </span>
              <Segments
                valeurs={NIVEAUX_SERVICE}
                valeur={droits.services[service] ?? 'aucun'}
                onChoisir={(v) => poserService(service, v)}
                libelle={libelleDuNiveau}
                repere={`${repere}-${service}`}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function FormulaireAcces({
  depart,
  onCree,
}: {
  /** La grille de départ : vide au tout premier accès, celle du dernier accès créé ensuite. */
  depart: DroitsDAcces;
  onCree: (secret: SecretMontre) => void;
}) {
  const [identifiant, setIdentifiant] = React.useState('');
  const [nomAffiche, setNomAffiche] = React.useState('');
  const [courriel, setCourriel] = React.useState('');
  const [droits, setDroits] = React.useState<DroitsDAcces>(depart);
  const [enCours, setEnCours] = React.useState(false);
  // La grille de départ arrive avec la liste des accès : elle se reprend tant qu'on n'a rien coché.
  const touche = React.useRef(false);
  const departCle = JSON.stringify(depart);
  React.useEffect(() => {
    if (!touche.current) setDroits(depart);
  }, [departCle]);

  const creer = async () => {
    const juge = jugerIdentifiant(identifiant);
    if (!juge.ok) {
      client.pushToast('error', juge.raison!);
      return;
    }
    setEnCours(true);
    try {
      const data = await client.call<{ compte: CompteUtilisateur; motDePasse: string }>({
        type: 'comptes.creer',
        identifiant,
        nomAffiche,
        role: 'lecteur',
        droits,
        courriel: courriel.trim() || undefined,
      });
      onCree({ nom: nomDuCompte(data.compte), identifiant: data.compte.identifiant, valeur: data.motDePasse });
      setIdentifiant('');
      setNomAffiche('');
      setCourriel('');
      touche.current = false;
    } catch (err: any) {
      client.pushToast('error', err?.message ?? t('accès non créé'));
    } finally {
      setEnCours(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-md bg-surface p-3" data-formulaire-acces-tiers>
      <div className="flex items-center gap-2 text-[13px] font-medium text-text">
        <UserPlus className="h-4 w-4" />
        {t('Ouvrir un accès')}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <Input value={identifiant} onChange={(e) => setIdentifiant(e.target.value)} placeholder={t('Identifiant')} data-champ-identifiant />
        <Input value={nomAffiche} onChange={(e) => setNomAffiche(e.target.value)} placeholder={t('Nom affiché')} data-champ-nom />
      </div>
      <Input
        type="email"
        value={courriel}
        onChange={(e) => setCourriel(e.target.value)}
        placeholder={t('Adresse de courriel (facultative)')}
      />
      <GrilleDeDroits
        droits={droits}
        onChanger={(suite) => {
          touche.current = true;
          setDroits(suite);
        }}
        repere="creation"
      />
      <div className="flex justify-end">
        <Button onClick={creer} disabled={enCours || !identifiant.trim()} data-creer-acces-tiers>
          {enCours ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          {t('Créer l’accès')}
        </Button>
      </div>
    </div>
  );
}

function LigneAcces({
  compte,
  onChangement,
  onSecret,
  onRetirer,
}: {
  compte: CompteUtilisateur;
  onChangement: () => void;
  onSecret: (secret: SecretMontre) => void;
  onRetirer: (compte: CompteUtilisateur) => void;
}) {
  const [ouverte, setOuverte] = React.useState(false);
  const [droits, setDroits] = React.useState<DroitsDAcces>(() => droitsDuCompte(compte));
  const serveur = JSON.stringify(droitsDuCompte(compte));
  React.useEffect(() => setDroits(droitsDuCompte(compte)), [serveur]);

  const echec = (defaut: string) => (err: any) => {
    client.pushToast('error', err?.message ?? defaut);
    onChangement();
  };
  const changerDroits = (suite: DroitsDAcces) => {
    setDroits(suite);
    void client.call({ type: 'comptes.droits', id: compte.id, droits: suite }).then(onChangement).catch(echec(t('droits non changés')));
  };
  const suspendre = (suspendu: boolean) =>
    void client.call({ type: 'comptes.suspendre', id: compte.id, suspendu }).then(onChangement).catch(echec(t('état non changé')));
  const nouveauMotDePasse = () =>
    void client
      .call<{ motDePasse: string }>({ type: 'comptes.motDePasse', id: compte.id })
      .then((data) => {
        onSecret({ nom: nomDuCompte(compte), identifiant: compte.identifiant, valeur: data.motDePasse });
        onChangement();
      })
      .catch(echec(t('mot de passe non changé')));

  const ouverts = Object.keys(droits.projets).length;
  return (
    <div className="rounded-md bg-surface p-3" data-acces-tiers={compte.id} data-acces-actif={compte.actif ? 'oui' : 'non'}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <button type="button" className="flex min-w-0 items-start gap-1.5 text-left" onClick={() => setOuverte((o) => !o)} data-deplier-droits={compte.id}>
          {ouverte ? <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-faint" /> : <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-faint" />}
          <span className="min-w-0">
            <span className="block truncate text-[13.5px] font-medium text-text">{nomDuCompte(compte)}</span>
            <span className="block text-xs text-muted">
              {compte.identifiant} · {t(etatDuCompteEnClair(compte))}
              {' · '}
              {t('{n} projet(s) ouvert(s)', { n: String(ouverts) })}
              {compte.derniereEntree ? ` · ${relativeTime(compte.derniereEntree)}` : ''}
            </span>
          </span>
        </button>
        <div className="flex flex-wrap items-center gap-2">
          <Switch checked={compte.actif} onCheckedChange={(actif) => suspendre(!actif)} data-suspendre={compte.id} />
          <Button size="sm" variant="ghost" onClick={nouveauMotDePasse} data-reinitialiser={compte.id}>
            <KeyRound className="h-3.5 w-3.5" />
            {t('Nouveau mot de passe')}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => onRetirer(compte)} data-retirer={compte.id}>
            <ShieldOff className="h-3.5 w-3.5" />
            {t('Retirer')}
          </Button>
        </div>
      </div>
      {ouverte ? (
        <div className="mt-3">
          <GrilleDeDroits droits={droits} onChanger={changerDroits} repere={compte.id} />
        </div>
      ) : null}
    </div>
  );
}

/** La section « Accès à Beluga » de « Mon compte » — pour l'administrateur seulement. */
export function AccesTiers() {
  const state = useApp();
  const [comptes, setComptes] = React.useState<CompteUtilisateur[] | null>(null);
  const [secret, setSecret] = React.useState<SecretMontre | null>(null);
  const [aRetirer, setARetirer] = React.useState<CompteUtilisateur | null>(null);

  const recharger = React.useCallback(() => {
    void client
      .call<{ comptes: CompteUtilisateur[] }>({ type: 'comptes.lister' })
      // Les comptes CLIENTS vivent dans la messagerie, pas ici.
      .then((data) => setComptes((data.comptes ?? []).filter((c) => c.role === 'membre' || c.role === 'lecteur')))
      .catch(() => setComptes((avant) => avant ?? []));
  }, []);
  React.useEffect(recharger, [recharger]);

  const projetsConnus = React.useMemo(() => state.projects.map((p) => p.id), [state.projects]);
  const depart = React.useMemo(() => droitsDeDepart(comptes ?? [], projetsConnus), [comptes, projetsConnus]);

  return (
    <Groupe
      titre={t('Accès à Beluga')}
      aide={t('Ouvrez l’environnement de développement à une autre personne : vous choisissez, projet par projet et service par service, ce qu’elle peut voir et faire. Les comptes de vos clients se créent depuis la messagerie.')}
    >
      <div className="space-y-3" data-acces-a-beluga>
        {secret ? <MotDePasseMontre secret={secret} onFermer={() => setSecret(null)} sansInvitation /> : null}
        {comptes ? (
          <FormulaireAcces
            depart={depart}
            onCree={(neuf) => {
              setSecret(neuf);
              recharger();
            }}
          />
        ) : null}
        <div className="flex flex-col gap-2" data-liste-acces-tiers={comptes?.length ?? 0}>
          {(comptes ?? []).map((compte) => (
            <LigneAcces key={compte.id} compte={compte} onChangement={recharger} onSecret={setSecret} onRetirer={setARetirer} />
          ))}
          {comptes && !comptes.length ? <p className="text-xs text-muted">{t('Aucun accès ouvert pour l’instant.')}</p> : null}
        </div>
      </div>
      {aRetirer ? (
        <ConfirmDialog
          open
          title={t('Retirer cet accès ?')}
          description={t('Le compte est mis de côté. Ses demandes et ses messages restent lisibles.')}
          confirmLabel={t('Retirer')}
          danger
          onClose={() => setARetirer(null)}
          onConfirm={() => {
            void client.call({ type: 'comptes.retirer', id: aRetirer.id }).then(recharger);
            setARetirer(null);
          }}
        />
      ) : null}
    </Groupe>
  );
}
