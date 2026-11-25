/**
 * LA RUBRIQUE « ACCÈS CLIENTS » DES RÉGLAGES D'UN PROJET (carte « Connexion Haiko pour les sites clients »,
 * 25/11/2026, maquette #3961d).
 *
 * Les accès administrateur que les clients du projet voient en cliquant sur « Voir mon site » dans leur espace : un
 * bloc par version du site qui a une adresse (« Site en ligne », « Version de travail »), avec son état (Notés, À créer,
 * Pas d'administration), ses trois valeurs et qui les a notées. L'agent du projet les crée et les note
 * (`server/src/acces-clients.ts`) ; les champs restent modifiables ici, à la main, EN SECOURS — chaque valeur
 * s'enregistre en quittant le champ, comme les chemins libres de la garde. Réservée à l'administrateur.
 */
import * as React from 'react';
import { Ban, CircleCheck, CircleDashed, ExternalLink } from '@/components/ui/icones';
import { Button, Label } from '@/components/ui';
import { ChampACopier } from '@/components/champ-a-copier';
import { client } from '@/lib/client';
import { t } from '@/lib/langue';
import { cn } from '@/lib/utils';
import { useTelephone } from '@/lib/telephone';
import { hoteDuSite, type EtatDAccesClient, type VersionDAcces } from '@beluga/shared';
import { TeteDeRubrique, type ContexteConfig } from './communs';

interface VersionLue {
  version: VersionDAcces;
  adresseDuSite: string;
  etat: EtatDAccesClient;
  acces?: { adresse: string; identifiant: string; motDePasse: string };
  note?: { le: number; par: string | null; carte?: { id: string; titre: string } };
  sansAdministration?: { le: number; par: string | null };
}

interface AccesClientsLus {
  clients: { id: string; nom: string }[];
  versions: VersionLue[];
  carte?: { id: string; titre: string };
}

const dateCourte = (at: number) =>
  new Date(at).toLocaleDateString('fr-CH', { day: '2-digit', month: '2-digit', year: 'numeric' });

/** La pastille d'état, à droite du titre : une forme et un mot, monochrome (charte, règle 14). */
function PastilleDEtat({ etat }: { etat: EtatDAccesClient }) {
  const [Icone, texte] =
    etat === 'notes'
      ? [CircleCheck, t('Notés')]
      : etat === 'sans-administration'
        ? [Ban, t('Pas d’administration')]
        : [CircleDashed, t('À créer')];
  return (
    <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-surface px-2.5 py-1 text-[12.5px] text-text" data-acces-etat={etat}>
      <Icone className="h-3.5 w-3.5" aria-hidden />
      {texte}
    </span>
  );
}

/** Un champ modifiable, enregistré en quittant le champ, avec son bouton « copier » (et l'œil pour le mot de passe). */
function ChampDAcces({
  libelle,
  valeur,
  secret,
  repere,
  onEnregistrer,
}: {
  libelle: string;
  valeur: string;
  secret?: boolean;
  repere: string;
  onEnregistrer: (valeur: string) => void;
}) {
  const [brouillon, setBrouillon] = React.useState(valeur);
  const id = React.useId();
  React.useEffect(() => setBrouillon(valeur), [valeur]);
  return (
    <div className="min-w-0 space-y-1.5" data-acces-champ={repere}>
      <Label htmlFor={id}>{libelle}</Label>
      {/* Posé sur le bloc `raised` de la version : le champ prend le fond `surface` pour s'en détacher, dans les deux clartés. */}
      <ChampACopier
        id={id}
        valeur={brouillon}
        secret={secret}
        onChange={setBrouillon}
        onBlur={() => brouillon !== valeur && onEnregistrer(brouillon)}
        className="bg-surface"
        repere={repere}
      />
    </div>
  );
}

function BlocDeVersion({
  lue,
  projet,
  carte,
  enVol,
  onNoter,
  onSansAdministration,
  onPoserLaCarte,
  onVoirLaCarte,
}: {
  lue: VersionLue;
  projet: string;
  carte?: { id: string; titre: string };
  enVol: boolean;
  onNoter: (champ: 'adresse' | 'identifiant' | 'motDePasse', valeur: string) => void;
  onSansAdministration: (valeur: boolean) => void;
  onPoserLaCarte: () => void;
  onVoirLaCarte: (id: string) => void;
}) {
  const telephone = useTelephone();
  const acces = lue.acces ?? { adresse: '', identifiant: '', motDePasse: '' };
  const parQui = (par: string | null) =>
    par && /^l’agent de /.test(par) ? t('l’agent de {projet}', { projet }) : par || t('Haiko');
  return (
    <section className="space-y-3 rounded-xl bg-raised px-3.5 py-3" data-acces-version={lue.version}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[14px] font-medium text-text">{lue.version === 'production' ? t('Site en ligne') : t('Version de travail')}</h3>
          <p className="truncate text-[12.5px] text-muted">{hoteDuSite(lue.adresseDuSite)}</p>
        </div>
        <PastilleDEtat etat={lue.etat} />
      </div>

      {lue.etat === 'sans-administration' ? (
        <div className="space-y-2">
          <p className="text-[13px] leading-snug text-muted">
            {t('Cette version n’a pas d’administration ({par}, le {date}) : un clic du client ouvre simplement le site.', {
              par: parQui(lue.sansAdministration?.par ?? null),
              date: dateCourte(lue.sansAdministration?.le ?? Date.now()),
            })}
          </p>
          <Button size="sm" variant="subtle" disabled={enVol} onClick={() => onSansAdministration(false)} data-acces-remettre>
            {t('Elle en a une : remettre à créer')}
          </Button>
        </div>
      ) : (
        <>
          {lue.etat === 'a-creer' ? (
            <div className="space-y-2">
              <p className="text-[13px] leading-snug text-muted">
                {carte
                  ? t('Pas encore d’accès notés. Beluga a préparé la carte « {titre} » dans ce projet : il ne reste qu’à la lancer. En attendant, un clic du client ouvre simplement le site.', { titre: carte.titre })
                  : t('Pas encore d’accès notés : un clic du client ouvre simplement le site. Préparez la carte qui les fait créer par l’agent du projet, ou saisissez-les ci-dessous.')}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {carte ? (
                  <Button size="sm" variant="subtle" className="gap-1.5" onClick={() => onVoirLaCarte(carte.id)} data-acces-voir-la-carte>
                    <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                    {t('Voir la carte')}
                  </Button>
                ) : (
                  <Button size="sm" variant="subtle" disabled={enVol} onClick={onPoserLaCarte} data-acces-poser-la-carte>
                    {t('Préparer la carte')}
                  </Button>
                )}
                <Button size="sm" variant="ghost" disabled={enVol} onClick={() => onSansAdministration(true)} data-acces-sans-administration>
                  {t('Pas d’administration')}
                </Button>
              </div>
            </div>
          ) : null}

          <ChampDAcces
            libelle={t('Adresse de connexion')}
            valeur={acces.adresse}
            repere="adresse"
            onEnregistrer={(valeur) => onNoter('adresse', valeur)}
          />
          <div className={cn('grid gap-3', telephone ? 'grid-cols-1' : 'grid-cols-2')}>
            <ChampDAcces
              libelle={t('Identifiant')}
              valeur={acces.identifiant}
              repere="identifiant"
              onEnregistrer={(valeur) => onNoter('identifiant', valeur)}
            />
            <ChampDAcces
              libelle={t('Mot de passe')}
              valeur={acces.motDePasse}
              secret
              repere="mot-de-passe"
              onEnregistrer={(valeur) => onNoter('motDePasse', valeur)}
            />
          </div>
          {lue.note ? (
            <p className="text-[12.5px] leading-snug text-faint" data-acces-note-par>
              {lue.note.carte
                ? t('Notés par {par} le {date} · carte « {titre} »', {
                    par: parQui(lue.note.par),
                    date: dateCourte(lue.note.le),
                    titre: lue.note.carte.titre,
                  })
                : t('Notés par {par} le {date}', { par: parQui(lue.note.par), date: dateCourte(lue.note.le) })}
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}

export function RubriqueAccesClients({ ctx }: { ctx: ContexteConfig }) {
  const { project } = ctx;
  const [lus, setLus] = React.useState<AccesClientsLus | null>(null);
  const [erreur, setErreur] = React.useState<string | null>(null);
  const [enVol, setEnVol] = React.useState(false);

  React.useEffect(() => {
    let vivant = true;
    setLus(null);
    client
      .call<AccesClientsLus>({ type: 'projet.accesClients', projectId: project.id }, 20000)
      .then((r) => vivant && setLus(r))
      .catch((err) => vivant && setErreur(err?.message ?? t('La commande a échoué.')));
    return () => {
      vivant = false;
    };
  }, [project.id, project.devUrl, project.adresseProduction]);

  const agir = async (commande: Parameters<typeof client.call>[0]) => {
    setEnVol(true);
    setErreur(null);
    try {
      setLus(await client.call<AccesClientsLus>(commande, 20000));
    } catch (err: any) {
      setErreur(err?.message ?? t('La commande a échoué.'));
    } finally {
      setEnVol(false);
    }
  };

  /* Les valeurs déjà tapées d'un accès NEUF, en attendant les trois : la rubrique n'écrit jamais une fiche à moitié. */
  const brouillons = React.useRef<Partial<Record<VersionDAcces, { adresse: string; identifiant: string; motDePasse: string }>>>({});
  const noter = (lue: VersionLue, champ: 'adresse' | 'identifiant' | 'motDePasse', valeur: string) => {
    const base = lue.acces ?? brouillons.current[lue.version] ?? { adresse: '', identifiant: '', motDePasse: '' };
    const suivant = { ...base, [champ]: valeur };
    if (!lue.acces && (!suivant.adresse.trim() || !suivant.identifiant.trim() || !suivant.motDePasse)) {
      brouillons.current[lue.version] = suivant;
      return;
    }
    delete brouillons.current[lue.version];
    void agir({ type: 'projet.accesClients.noter', projectId: project.id, version: lue.version, ...suivant });
  };

  const vusPar = lus?.clients.map((c) => c.nom).join(', ');

  return (
    <div className="space-y-4" data-rubrique-acces-clients>
      <TeteDeRubrique
        titre={t('Accès clients')}
        resume={t('Les accès administrateur que les clients voient en cliquant sur « Voir mon site ».')}
      />
      <p className="text-[13.5px] leading-snug text-muted">
        {t('Les accès administrateur que les clients de ce projet voient en cliquant sur « Voir mon site » dans leur espace. L’agent du projet les crée dans le site et les note ici.')}
      </p>

      {lus === null && !erreur ? (
        <div className="space-y-3" aria-hidden data-acces-silhouette>
          <div className="h-4 w-1/3 animate-pulse rounded bg-raised" />
          <div className="h-48 animate-pulse rounded-xl bg-raised" />
        </div>
      ) : lus ? (
        <>
          <p className="text-[13px] text-muted" data-acces-vus-par>
            {lus.clients.length ? (
              <>
                <span className="text-faint">{t('Vus par')} · </span>
                <span className="text-text">{t('{noms} (client)', { noms: vusPar ?? '' })}</span>
              </>
            ) : (
              <span className="text-faint">{t('Aucun client sur ce projet : ces accès ne sont montrés à personne pour l’instant.')}</span>
            )}
          </p>
          {lus.versions.length ? (
            lus.versions.map((lue) => (
              <BlocDeVersion
                key={lue.version}
                lue={lue}
                projet={project.name}
                carte={lus.carte}
                enVol={enVol}
                onNoter={(champ, valeur) => noter(lue, champ, valeur)}
                onSansAdministration={(valeur) =>
                  void agir({ type: 'projet.accesClients.sansAdministration', projectId: project.id, version: lue.version, valeur })
                }
                onPoserLaCarte={() => void agir({ type: 'projet.accesClients.carte', projectId: project.id })}
                onVoirLaCarte={(id) => {
                  ctx.fermer();
                  client.openCard(id);
                }}
              />
            ))
          ) : (
            <p className="rounded-xl bg-raised px-3.5 py-3 text-[13px] text-muted" data-acces-sans-adresse>
              {t('Ce projet n’a encore aucune adresse de site (rubriques « Déploiement » et « Mise en production ») : il n’y a pas d’accès à noter.')}
            </p>
          )}
        </>
      ) : null}

      {erreur ? (
        <p className="rounded-md bg-danger/10 px-2.5 py-1.5 text-[12.5px] text-danger" data-acces-erreur>
          {erreur}
        </p>
      ) : null}
    </div>
  );
}
