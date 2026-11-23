/**
 * RELIER GITHUB ET ENVOYER DES COURRIELS QUI ARRIVENT — les règles pures de
 * `shared/src/connexion-github.ts` et `shared/src/remise-des-courriels.ts`,
 * plus la connexion par code et le contrôle du jeton du démon, jugés avec un
 * faux outil et une fausse API : rien ne part chez GitHub, rien n'est écrit
 * dans aucun domaine.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  ADRESSE_D_UN_JETON_CLASSIQUE,
  REFUS_JETON_INCONNU,
  REFUS_JETON_INJOIGNABLE,
  REFUS_JETON_SANS_DEPOTS_PRIVES,
  REFUS_JETON_SANS_WORKFLOW,
  codeDeConnexionLu,
  depotsDepuisLApi,
  dkimDepuisLeFichier,
  droitsDeLEntete,
  enregistrementsAttendus,
  issueDeLEssai,
  raisonDuRefusDeRemise,
  refusDuJetonGithub,
  remiseLueDansLeJournal,
  spfFusionne,
  texteDuTxt,
  txtEntreGuillemets,
  txtsAvecSpf,
  verdictDesControles,
  type ConstatDeLEnvoiDirect,
} from '@beluga/shared';

// Le démon chargé plus bas lit sa base : une base d'essai, jamais celle en service.
const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'connexion-github-'));
process.env.BELUGA_DATA = bacASable;
test.after(() => fs.rmSync(bacASable, { recursive: true, force: true }));

/* ------------------------------------------------------------------ */
/* GitHub                                                               */
/* ------------------------------------------------------------------ */

test('le code de la connexion par code est lu dans ce que l’outil GitHub écrit', () => {
  const sortie = '! First copy your one-time code: 141f-97e5\nOpen this URL to continue in your web browser: https://github.com/login/device\n';
  assert.deepEqual(codeDeConnexionLu(sortie), { code: '141F-97E5', adresse: 'https://github.com/login/device' });
  // La page n'est pas toujours écrite : elle est connue.
  assert.deepEqual(codeDeConnexionLu('! First copy your one-time code: ABCD-1234'), {
    code: 'ABCD-1234',
    adresse: 'https://github.com/login/device',
  });
  assert.equal(codeDeConnexionLu('error connecting to api.github.com'), null);
});

test('un jeton qui ne voit pas les dépôts privés est refusé, un bon jeton passe', () => {
  // Jeton classique : les droits de l'entête font foi.
  assert.equal(refusDuJetonGithub({ reconnu: true, droits: ['repo', 'workflow', 'gist'] }), null);
  assert.equal(refusDuJetonGithub({ reconnu: true, droits: ['public_repo', 'workflow'] }), REFUS_JETON_SANS_DEPOTS_PRIVES);
  assert.equal(refusDuJetonGithub({ reconnu: true, droits: [] }), REFUS_JETON_SANS_DEPOTS_PRIVES);
  assert.equal(refusDuJetonGithub({ reconnu: true, droits: ['repo'] }), REFUS_JETON_SANS_WORKFLOW);
  // Jeton à grain fin : on regarde ce qu'il voit.
  assert.equal(refusDuJetonGithub({ reconnu: true, droits: null, privesPossedes: 46, privesVisibles: 0 }), REFUS_JETON_SANS_DEPOTS_PRIVES);
  assert.equal(refusDuJetonGithub({ reconnu: true, droits: null, privesVisibles: 0 }), REFUS_JETON_SANS_DEPOTS_PRIVES, 'nombre inconnu : prudence');
  assert.equal(refusDuJetonGithub({ reconnu: true, droits: null, privesPossedes: 46, privesVisibles: 1 }), null, '« All repositories » passe');
  assert.equal(refusDuJetonGithub({ reconnu: true, droits: null, privesPossedes: 0, privesVisibles: 0 }), null, 'aucun dépôt privé : rien à cacher');
  // GitHub injoignable n'est pas un « jeton limité ».
  assert.equal(refusDuJetonGithub({ reconnu: false, joignable: false, droits: null }), REFUS_JETON_INJOIGNABLE);
  assert.equal(refusDuJetonGithub({ reconnu: false, droits: null }), REFUS_JETON_INCONNU);
  assert.deepEqual(droitsDeLEntete('repo, workflow,  gist'), ['repo', 'workflow', 'gist']);
  assert.equal(droitsDeLEntete(null), null);
  assert.deepEqual(droitsDeLEntete(''), []);
});

test('la liste des dépôts : organisations et invitations comprises, sans doublon, le plus récent d’abord', () => {
  const depots = depotsDepuisLApi([
    { full_name: 'moi/ancien', name: 'ancien', owner: { login: 'moi' }, private: true, size: 10, pushed_at: '2025-01-01T00:00:00Z' },
    { full_name: 'mon-orga/site', name: 'site', owner: { login: 'mon-orga' }, private: true, size: 0, pushed_at: '2026-10-01T00:00:00Z' },
    { full_name: 'moi/ancien', name: 'ancien', owner: { login: 'moi' }, private: true, size: 10 },
    { full_name: 'ami/outil', name: 'outil', owner: { login: 'ami' }, private: false, size: 5, updated_at: '2026-05-01T00:00:00Z' },
  ]);
  assert.deepEqual(
    depots.map((d) => [d.slug, d.proprietaire, d.prive, d.vide]),
    [
      ['mon-orga/site', 'mon-orga', true, true],
      ['ami/outil', 'ami', false, false],
      ['moi/ancien', 'moi', true, false],
    ],
  );
  assert.equal(depotsDepuisLApi(depots.map(() => ({})), 10).length, 0);
});

test('le démon refuse un jeton limité AVANT de l’enregistrer, et donne le lien d’un bon jeton', async () => {
  const { connecterGitHub } = await import('../installation-commandes.js');
  const appels: string[] = [];
  const fausseApi = (async (url: unknown, init?: RequestInit) => {
    appels.push(String(url));
    assert.match(String((init?.headers as Record<string, string>)?.authorization), /^Bearer github_pat_essai$/);
    if (String(url).endsWith('/user')) return new Response(JSON.stringify({ login: 'essai', owned_private_repos: 3 }), { status: 200 });
    return new Response('[]', { status: 200 });
  }) as typeof fetch;
  const rendu = await connecterGitHub('github_pat_essai', fausseApi);
  assert.equal(rendu.erreur, REFUS_JETON_SANS_DEPOTS_PRIVES);
  assert.equal(rendu.lienDuJeton, ADRESSE_D_UN_JETON_CLASSIQUE);
  assert.deepEqual(appels, ['https://api.github.com/user', 'https://api.github.com/user/repos?visibility=private&per_page=1']);
});

test('la connexion par code : le code est rendu, un second clic rend le même, un échec se dit', async () => {
  const { annulerLaConnexionParCode, lancerLaConnexionParCode } = await import('../installation-commandes.js');
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'faux-gh-'));
  const attend = path.join(dossier, 'gh-attend');
  fs.writeFileSync(attend, '#!/bin/sh\necho "! First copy your one-time code: ABCD-1234" >&2\nsleep 30\n', { mode: 0o755 });
  const muet = path.join(dossier, 'gh-muet');
  fs.writeFileSync(muet, '#!/bin/sh\necho "authentication failed" >&2\nexit 1\n', { mode: 0o755 });
  try {
    const premier = await lancerLaConnexionParCode(attend);
    assert.equal(premier.etat, 'attente');
    assert.equal(premier.code, 'ABCD-1234');
    assert.ok((premier.expireA ?? 0) > Date.now());
    const second = await lancerLaConnexionParCode(attend);
    assert.equal(second.code, premier.code, 'une seule connexion à la fois');
    assert.equal(annulerLaConnexionParCode().etat, 'aucune');

    const rate = await lancerLaConnexionParCode(muet);
    assert.equal(rate.etat, 'echouee');
    assert.match(rate.erreur ?? '', /authentication failed/);
  } finally {
    annulerLaConnexionParCode();
    fs.rmSync(dossier, { recursive: true, force: true });
  }
});

/* ------------------------------------------------------------------ */
/* Le suivi d'un courriel d'essai                                       */
/* ------------------------------------------------------------------ */

const JOURNAL = [
  'Oct 18 10:00:01 hote postfix/pickup[1]: 9F2A1B3C: uid=1000 from=<beluga>',
  'Oct 18 10:00:01 hote postfix/cleanup[2]: 9F2A1B3C: message-id=<essai-1@exemple.com>',
  'Oct 18 10:00:01 hote postfix/cleanup[2]: 77AA11BB: message-id=<autre@exemple.com>',
  'Oct 18 10:00:02 hote postfix/smtp[3]: 9F2A1B3C: to=<a@gmail.com>, relay=gmail-smtp-in.l.google.com[142.250.0.26]:25, delay=1, dsn=4.7.0, status=deferred (host said: 421-4.7.0 try again later)',
  'Oct 18 10:00:09 hote postfix/smtp[3]: 9F2A1B3C: to=<a@gmail.com>, relay=gmail-smtp-in.l.google.com[142.250.0.26]:25, delay=8, dsn=5.7.26, status=bounced (host gmail-smtp-in.l.google.com said: 550-5.7.26 Unauthenticated email from exemple.com is not accepted due to domain\'s DMARC policy)',
  'Oct 18 10:00:09 hote postfix/smtp[3]: 77AA11BB: to=<b@gmail.com>, relay=x, dsn=2.0.0, status=sent (250 OK)',
].join('\n');

test('le journal de l’agent : la DERNIÈRE ligne de remise de CE message fait foi', () => {
  const lue = remiseLueDansLeJournal(JOURNAL, '<essai-1@exemple.com>');
  assert.equal(lue.statut, 'bounced');
  assert.equal(lue.dsn, '5.7.26');
  assert.match(lue.reponse ?? '', /Unauthenticated email/);
  assert.equal(remiseLueDansLeJournal(JOURNAL, 'autre@exemple.com').statut, 'sent');
  assert.equal(remiseLueDansLeJournal(JOURNAL, 'inconnu@exemple.com').statut, null);
});

test('l’issue d’un essai ne dit jamais plus que ce qui a été constaté', () => {
  const destinataire = 'a@gmail.com';
  assert.equal(issueDeLEssai({ mode: 'serveur', destinataire, remise: { statut: 'sent' } }).issue, 'arrive');
  assert.equal(issueDeLEssai({ mode: 'serveur', destinataire, remise: { statut: null } }).issue, 'attente');
  assert.equal(issueDeLEssai({ mode: 'serveur', destinataire, remise: null }).issue, 'inconnu');
  assert.equal(issueDeLEssai({ mode: 'serveur', destinataire, remise: null }).ok, false, 'illisible n’est pas un succès');
  const refus = issueDeLEssai({ mode: 'serveur', destinataire, remise: remiseLueDansLeJournal(JOURNAL, 'essai-1@exemple.com') });
  assert.equal(refus.issue, 'refuse');
  assert.match(refus.texte, /gmail\.com/);
  assert.match(refus.texte, /SPF, DKIM, DMARC/);
  const report = issueDeLEssai({ mode: 'serveur', destinataire, remise: { statut: 'deferred', reponse: 'connect to x[1.2.3.4]:25: Connection timed out' } });
  assert.equal(report.issue, 'attente');
  assert.match(report.texte, /port 25/);
  assert.equal(issueDeLEssai({ mode: 'resend', destinataire, evenement: 'bounced' }).issue, 'refuse');
  assert.equal(issueDeLEssai({ mode: 'resend', destinataire, evenement: 'sent' }).issue, 'attente');
  assert.equal(issueDeLEssai({ mode: 'smtp', destinataire, hote: 'smtp.exemple.com' }).issue, 'accepte');
});

test('la raison d’un refus, en mots courants', () => {
  assert.match(raisonDuRefusDeRemise('550 5.7.25 The IP address sending this message does not have a PTR record setup'), /nom inverse/);
  assert.match(raisonDuRefusDeRemise('554 blocked using zen.spamhaus.org'), /liste de bloqués/);
  assert.match(raisonDuRefusDeRemise('550 5.1.1 The email account that you tried to reach does not exist'), /n’existe pas/);
  assert.match(raisonDuRefusDeRemise('550 refusé pour une raison rare'), /« 550 refusé pour une raison rare »/);
});

/* ------------------------------------------------------------------ */
/* Ce que le domaine doit porter                                        */
/* ------------------------------------------------------------------ */

test('le SPF se FUSIONNE : un seul SPF, l’adresse ajoutée avant « all », rien de retiré', () => {
  assert.equal(spfFusionne(null, '1.2.3.4'), 'v=spf1 ip4:1.2.3.4 ~all');
  assert.equal(spfFusionne('v=spf1 include:_spf.google.com ~all', '1.2.3.4'), 'v=spf1 include:_spf.google.com ip4:1.2.3.4 ~all');
  assert.equal(spfFusionne('v=spf1 include:_spf.google.com', '1.2.3.4'), 'v=spf1 include:_spf.google.com ip4:1.2.3.4');
  assert.equal(spfFusionne('v=spf1 ip4:1.2.3.4 -all', '1.2.3.4'), null, 'déjà là : rien à changer');
  assert.equal(spfFusionne(null, '2a01::1'), 'v=spf1 ip6:2a01::1 ~all');
  // Les autres TXT du domaine ne bougent pas, et jamais deux SPF.
  const apres = txtsAvecSpf(['google-site-verification=abc', '"v=spf1 include:mail.exemple ~all"'], '1.2.3.4')!;
  assert.deepEqual(apres, ['google-site-verification=abc', 'v=spf1 include:mail.exemple ip4:1.2.3.4 ~all']);
  assert.equal(apres.filter((txt) => txt.startsWith('v=spf1')).length, 1);
  assert.equal(txtsAvecSpf(['v=spf1 ip4:1.2.3.4 ~all'], '1.2.3.4'), null);
});

test('un TXT long se coupe en morceaux de 255 et se recolle à la lecture', () => {
  const long = `v=DKIM1; k=rsa; p=${'A'.repeat(400)}`;
  const ecrit = txtEntreGuillemets(long);
  assert.equal(ecrit.split('" "').length, 2);
  assert.equal(texteDuTxt(ecrit), long);
  assert.equal(texteDuTxt('sans guillemets'), 'sans guillemets');
});

test('la clé DKIM est lue dans le fichier d’opendkim-genkey, et les trois enregistrements sont calculés', () => {
  const fichier =
    'beluga._domainkey\tIN\tTXT\t( "v=DKIM1; h=sha256; k=rsa; "\n\t  "p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAx' +
    'B'.repeat(60) +
    '" )  ; ----- DKIM key beluga for exemple.com\n';
  const dkim = dkimDepuisLeFichier(fichier)!;
  assert.match(dkim, /^v=DKIM1; h=sha256; k=rsa; p=MIIB/);
  const attendus = enregistrementsAttendus({ domaine: 'exemple.com', ip: '1.2.3.4', spfExistant: null, dkimLocal: dkim, dmarcExistant: null });
  assert.deepEqual(
    attendus.map((a) => [a.genre, a.nomComplet]),
    [
      ['spf', 'exemple.com'],
      ['dkim', 'beluga._domainkey.exemple.com'],
      ['dmarc', '_dmarc.exemple.com'],
    ],
  );
  assert.match(attendus[2]!.valeur, /^v=DMARC1; p=none/);
});

test('les contrôles d’avant l’essai : chaque point dit ce qui lui manque', () => {
  const tout: ConstatDeLEnvoiDirect = {
    agent: true,
    port25: true,
    domaine: 'exemple.com',
    ip: '1.2.3.4',
    spf: 'v=spf1 ip4:1.2.3.4 ~all',
    dkimLocal: 'v=DKIM1; k=rsa; p=CLE',
    dkimPublie: 'v=DKIM1; k=rsa; p=CLE',
    dmarc: 'v=DMARC1; p=none',
    ptr: 'beluga.exemple.com',
    ptrMeneIci: true,
  };
  assert.ok(verdictDesControles(tout).every((point) => point.ok));
  const rien = verdictDesControles({ ...tout, spf: 'v=spf1 include:ailleurs ~all', dkimPublie: 'v=DKIM1; p=AUTRE', dmarc: null, ptr: null });
  const enDefaut = Object.fromEntries(rien.filter((p) => !p.ok).map((p) => [p.id, p.manque]));
  assert.deepEqual(Object.keys(enDefaut), ['spf', 'dkim', 'dmarc', 'ptr']);
  assert.match(enDefaut.dkim!, /ne correspond pas/);
  assert.match(enDefaut.ptr!, /nom inverse/);
  assert.match(verdictDesControles({ ...tout, dkimLocal: null }).find((p) => p.id === 'dkim')!.manque, /pas installée/);
});
