import * as React from 'react';
import {
  Project,
  mentionEcartAuSchema,
  type ReglageApparence,
} from '@beluga/shared';
import { BulleInfo, Label } from '@/components/ui';
import { t } from '@/lib/langue';

/* ------------------------------------------------------------------ */
/* CE QUE CHAQUE RUBRIQUE REÇOIT                                        */
/* ------------------------------------------------------------------ */

/**
 * LES RÉGLAGES EN COURS DE SAISIE, TENUS PAR LA COQUILLE.
 *
 * La configuration d'un projet s'enregistre d'un SEUL geste : un unique
 * « Enregistrer », en pied de fenêtre, envoie tout ce qui a été modifié dans
 * n'importe quelle rubrique. Les champs vivent donc dans la coquille
 * (`project-settings.tsx`) et descendent ici : une rubrique AFFICHE et MODIFIE,
 * elle n'enregistre jamais toute seule.
 *
 * C'est ce qui permet de découper la fenêtre sans toucher au comportement :
 * passer d'une rubrique à l'autre ne perd rien, et rien ne part avant le clic.
 */
export interface ContexteConfig {
  project: Project;
  /** La fenêtre est-elle ouverte ? Certaines rubriques ne lisent qu'alors. */
  open: boolean;
  /** Un enregistrement est en cours : les champs se figent le temps qu'il dure. */
  saving: boolean;

  /* --- L'essentiel --- */
  name: string;
  setName: (valeur: string) => void;
  engine: string;
  setEngine: (valeur: string) => void;

  /* --- Apparence --- */
  themeProjet: ReglageApparence | null;
  setThemeProjet: (valeur: ReglageApparence | null) => void;
  apparenceGenerale: ReglageApparence;
  systemeSombre: boolean;

  /* --- Déploiement --- */
  devUrl: string;
  setDevUrl: (valeur: string) => void;
  adresseProduction: string;
  setAdresseProduction: (valeur: string) => void;
  port: string;
  setPort: (valeur: string) => void;
  portLu: number | null;
  portPartage: Project | undefined;
  portHorsPlage: boolean;
  faviconEnCours: boolean;
  relancerFavicon: () => void;
  brancheDev: string;
  setBrancheDev: (valeur: string) => void;
  /** La commande lancée après l'envoi (« npm run build », un script du projet…). Vide = aucune. */
  commandeDeploiement: string;
  setCommandeDeploiement: (valeur: string) => void;
  /** Le service système relancé à la fin. Vide = aucun. */
  serviceDeploiement: string;
  setServiceDeploiement: (valeur: string) => void;

  /* --- Mise en production --- */
  brancheProduction: string;
  setBrancheProduction: (valeur: string) => void;

  /* --- Les branches, lues sur le dépôt, partagées par les deux étapes --- */
  branches: string[];
  branchesEnCours: boolean;
  branchesRaison: string;

  /* --- Client et tarif --- */
  clients: ClientEntry[];
  documents: any[];
  clientsEnCours: boolean;
  facturationJoignable: boolean;
  clientId: string;
  setClientId: (valeur: string) => void;
  rate: string;
  setRate: (valeur: string) => void;
  documentId: string;
  setDocumentId: (valeur: string) => void;
  documentType: 'offer' | 'invoice';
  setDocumentType: (valeur: 'offer' | 'invoice') => void;
  ecartChiffrage: { count: number; ratioMoyen: number } | null;

  /* --- Les gestes qui retirent le projet --- */
  archiver: () => void;
}

export interface ClientEntry {
  id: string;
  name: string;
  companyId?: string;
  companyName?: string;
  companySlug?: string;
}

/* ------------------------------------------------------------------ */
/* Les briques partagées par plusieurs rubriques                        */
/* ------------------------------------------------------------------ */

/**
 * LE TITRE D'UNE RUBRIQUE, et ce qu'elle regroupe derrière son « i ». Chaque
 * rubrique s'ouvre dessus : on doit savoir où l'on vient d'atterrir sans avoir
 * à relire le menu — la phrase d'explication, elle, ne prend plus de place.
 */
export function TeteDeRubrique({
  titre,
  resume,
  aide,
  action,
}: {
  titre: string;
  resume: string;
  aide?: string;
  /** Un bouton posé en haut à droite du titre (l'agent de configuration d'une étape). */
  action?: React.ReactNode;
}) {
  return (
    <header className="mb-3 flex min-h-7 items-center gap-1" data-tete-de-rubrique>
      <h2 className="text-[15px] font-medium text-text">{titre}</h2>
      <BulleInfo cote="start">
        {resume}
        {aide ? `\n\n${aide}` : null}
      </BulleInfo>
      {action ? <div className="ml-auto flex shrink-0 items-center pl-2">{action}</div> : null}
    </header>
  );
}

/**
 * LE CHOIX D'UNE BRANCHE — ET L'ÉCART QU'IL PEUT CRÉER.
 *
 * La liste vient du dépôt GitHub du projet : on ne tape pas un nom de branche,
 * on prend celui qui existe. Rien de choisi reste la première option, et la
 * phrase en dessous dit ce qui s'appliquera alors. Une branche déjà réglée mais
 * absente de la liste (branche effacée, dépôt injoignable) reste proposée : on
 * ne fait jamais disparaître un réglage en silence.
 *
 * Le schéma est imposé sur tous les projets : « dev » au déploiement, « main »
 * en production. Ce choix reste ouvert pour ne pas casser un projet en cours,
 * mais il n'est plus présenté comme une option ordinaire : dès qu'il nomme
 * autre chose, un encart le DIT sous la liste.
 */
export function ChoixDeBranche({
  repere,
  titre,
  cible,
  valeur,
  onChange,
  branches,
  enCours,
  raison,
  mention,
}: {
  repere: string;
  titre: string;
  cible: 'dev' | 'production';
  valeur: string;
  onChange: (valeur: string) => void;
  branches: string[];
  enCours: boolean;
  raison: string;
  mention: string;
}) {
  const proposees = valeur && !branches.includes(valeur) ? [valeur, ...branches] : branches;
  const ecart = mentionEcartAuSchema(cible, valeur);
  return (
    <div {...{ [repere]: '' }}>
      <Label>{titre}</Label>
      <select
        value={valeur}
        onChange={(event) => onChange(event.target.value)}
        disabled={enCours}
        className="mt-1 h-8 w-full rounded-md border border-border bg-raised px-2 text-[14.5px] text-text"
      >
        <option value="">{enCours ? t('Lecture des branches du dépôt…') : t('Branche par défaut')}</option>
        {proposees.map((branche) => (
          <option key={branche} value={branche}>
            {branche}
          </option>
        ))}
      </select>
      <p className="mt-1 text-[11.5px] leading-snug text-faint">
        {valeur ? t('Le lot sera fusionné, enregistré et poussé sur « {valeur} ».', { valeur }) : mention}
        {raison ? ` ${raison}` : ''}
      </p>
      {ecart ? (
        <p
          data-ecart-schema
          className="mt-1 rounded-md border border-en-cours/40 bg-en-cours/10 px-2 py-1.5 text-[11.5px] leading-snug text-text"
        >
          {ecart}
        </p>
      ) : null}
    </div>
  );
}
