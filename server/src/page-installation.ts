import { codeEnGroupes, echapperHtml, formeDeCodeValide } from '@beluga/shared';

/**
 * LA PAGE D'INSTALLATION — la première chose qu'affiche une installation neuve.
 *
 * Tant qu'aucun administrateur n'existe, il n'y a personne à qui demander un
 * mot de passe : la page de connexion ne servirait à rien. Le démon sert donc
 * celle-ci à sa place. Elle fait créer son compte au propriétaire, derrière le
 * CODE D'INSTALLATION.
 *
 * LE CODE ARRIVE PAR UN LIEN. L'installation se termine sur une adresse prête à
 * cliquer (`…/?installation=<code>`) : la page reçoit le code du lien, le garde
 * dans un champ caché, et personne ne recopie rien. Le champ de saisie ne
 * revient que sans lien, ou quand le code du lien a été refusé — un lien
 * périmé retombe donc sur la saisie, avec la commande qui en donne un neuf.
 * LA PAGE NE JUGE PAS LE CODE À L'AFFICHAGE : le vérifier ici offrirait un
 * essai gratuit à qui devine, alors que la création du compte compte les siens. Une fois le compte créé, la suite — moteurs, nom de domaine,
 * projets, courriels… — se déroule dans l'application, par l'assistant.
 *
 * Elle est écrite ici, en HTML simple, comme la page de connexion : elle doit
 * s'afficher même quand l'interface n'est pas encore construite.
 *
 * CINQ LANGUES, choisies sur ce que le navigateur annonce (`Accept-Language`) :
 * à cet instant aucun réglage n'existe encore. Ce petit dictionnaire vit ici,
 * pas dans `shared/src/traductions.ts`, qui ne sert que l'interface construite.
 */

type Langue = 'fr' | 'en' | 'es' | 'de' | 'zh';

interface Textes {
  titre: string;
  intro: string;
  code: string;
  aideCode: string;
  lienReconnu: string;
  nom: string;
  aideNom: string;
  identifiant: string;
  aideIdentifiant: string;
  motDePasse: string;
  aideMotDePasse: string;
  confirmation: string;
  bouton: string;
  differents: string;
}

const TEXTES: Record<Langue, Textes> = {
  fr: {
    titre: 'Bienvenue dans Beluga Build',
    intro: 'Cette installation est neuve. Créez votre compte pour commencer : il sera le compte principal.',
    code: "Code d'installation",
    aideCode:
      "Le lien affiché à la fin de l'installation le remplit tout seul. Lien perdu ou déjà utilisé ? Tapez sur le serveur la commande ci-dessous : elle donne un lien neuf.",
    lienReconnu: "Vous arrivez par le lien d'installation : il ne reste qu'à choisir votre compte.",
    nom: 'Votre nom',
    aideNom: 'Tel qu’il s’affichera dans l’application.',
    identifiant: 'Identifiant',
    aideIdentifiant: 'En minuscules, sans accent ni espace.',
    motDePasse: 'Mot de passe',
    aideMotDePasse: 'Douze caractères au moins.',
    confirmation: 'Mot de passe, une seconde fois',
    bouton: 'Créer mon compte',
    differents: 'Les deux mots de passe ne sont pas identiques.',
  },
  en: {
    titre: 'Welcome to Beluga Build',
    intro: 'This is a fresh installation. Create your account to get started: it will be the main account.',
    code: 'Installation code',
    aideCode:
      'The link shown at the end of the installation fills it in for you. Link lost or already used? Run the command below on the server: it gives a fresh link.',
    lienReconnu: 'You came through the installation link: all that is left is to choose your account.',
    nom: 'Your name',
    aideNom: 'As it will appear in the application.',
    identifiant: 'Username',
    aideIdentifiant: 'Lowercase, no accents or spaces.',
    motDePasse: 'Password',
    aideMotDePasse: 'At least twelve characters.',
    confirmation: 'Password, once more',
    bouton: 'Create my account',
    differents: 'The two passwords do not match.',
  },
  es: {
    titre: 'Bienvenido a Beluga Build',
    intro: 'Esta instalación es nueva. Cree su cuenta para empezar: será la cuenta principal.',
    code: 'Código de instalación',
    aideCode:
      'El enlace mostrado al final de la instalación lo rellena solo. ¿Enlace perdido o ya usado? Ejecute en el servidor el comando de abajo: da un enlace nuevo.',
    lienReconnu: 'Ha llegado por el enlace de instalación: solo queda elegir su cuenta.',
    nom: 'Su nombre',
    aideNom: 'Tal como aparecerá en la aplicación.',
    identifiant: 'Identificador',
    aideIdentifiant: 'En minúsculas, sin acentos ni espacios.',
    motDePasse: 'Contraseña',
    aideMotDePasse: 'Doce caracteres como mínimo.',
    confirmation: 'Contraseña, otra vez',
    bouton: 'Crear mi cuenta',
    differents: 'Las dos contraseñas no coinciden.',
  },
  de: {
    titre: 'Willkommen bei Beluga Build',
    intro: 'Diese Installation ist neu. Erstellen Sie Ihr Konto, um zu beginnen: Es wird das Hauptkonto.',
    code: 'Installationscode',
    aideCode:
      'Der Link am Ende der Installation füllt ihn von selbst aus. Link verloren oder schon benutzt? Führen Sie auf dem Server den Befehl unten aus: Er liefert einen neuen Link.',
    lienReconnu: 'Sie kommen über den Installationslink: Es bleibt nur, Ihr Konto zu wählen.',
    nom: 'Ihr Name',
    aideNom: 'So, wie er in der Anwendung erscheint.',
    identifiant: 'Benutzername',
    aideIdentifiant: 'Kleinbuchstaben, ohne Akzente und Leerzeichen.',
    motDePasse: 'Passwort',
    aideMotDePasse: 'Mindestens zwölf Zeichen.',
    confirmation: 'Passwort, noch einmal',
    bouton: 'Mein Konto erstellen',
    differents: 'Die beiden Passwörter stimmen nicht überein.',
  },
  zh: {
    titre: '欢迎使用 Beluga Build',
    intro: '这是一个全新的安装。请创建您的账户以开始使用：它将成为主账户。',
    code: '安装码',
    aideCode: '安装结束时显示的链接会自动填好它。链接丢失或已用过？在服务器上运行下面的命令，即可得到新的链接。',
    lienReconnu: '您是通过安装链接进来的：只需选择您的账户。',
    nom: '您的姓名',
    aideNom: '将显示在应用中。',
    identifiant: '用户名',
    aideIdentifiant: '小写字母，不含重音符号和空格。',
    motDePasse: '密码',
    aideMotDePasse: '至少十二个字符。',
    confirmation: '再次输入密码',
    bouton: '创建我的账户',
    differents: '两次输入的密码不一致。',
  },
};

/** La langue de la page, lue dans ce que le navigateur annonce. Le français par défaut. */
export function langueDeLaPage(acceptLanguage: string | undefined): Langue {
  for (const morceau of String(acceptLanguage ?? '').toLowerCase().split(',')) {
    const code = morceau.trim().slice(0, 2);
    if (code === 'fr' || code === 'en' || code === 'es' || code === 'de' || code === 'zh') return code;
  }
  return 'fr';
}

export interface SaisieDInstallation {
  nomAffiche?: string;
  identifiant?: string;
}

/** Le nom du paramètre d'adresse qui porte le code : `…/?installation=XXXX-…`. */
export const PARAMETRE_DU_LIEN = 'installation';

/**
 * La page. `commande` est la ligne à taper sur le serveur pour tirer un lien
 * neuf ; `saisie` remet ce qui avait été tapé après un refus — jamais le mot de
 * passe. `codeDuLien` est le code venu de l'adresse : il n'est repris que s'il
 * a la FORME d'un code, et voyage alors dans un champ caché.
 */
export function pageDInstallation(options: {
  acceptLanguage?: string;
  erreur?: string;
  commande: string;
  saisie?: SaisieDInstallation;
  codeDuLien?: string;
}): string {
  const langue = langueDeLaPage(options.acceptLanguage);
  const t = TEXTES[langue];
  const e = echapperHtml;
  const duLien = options.codeDuLien && formeDeCodeValide(options.codeDuLien) ? codeEnGroupes(options.codeDuLien) : '';
  const champDuCode = duLien
    ? `<input type="hidden" name="code" value="${e(duLien)}" data-code-du-lien="1">
  <p class="sub lien" data-lien-reconnu="1">${e(t.lienReconnu)}</p>`
    : `<div>
    <label for="c">${e(t.code)}</label>
    <input id="c" class="code" name="code" autocomplete="off" autocapitalize="characters" autocorrect="off" spellcheck="false" placeholder="XXXX-XXXX-XXXX-XXXX" required autofocus>
    <small>${e(t.aideCode)}</small>
    <code>${e(options.commande)}</code>
  </div>
  <hr>`;
  return `<!doctype html>
<html lang="${langue}" class="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#09090b">
<meta name="robots" content="noindex">
<meta name="referrer" content="no-referrer">
<title>Beluga Build</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin:0; min-height:100dvh; display:grid; place-items:center; background:#09090b; color:#fafafa;
         font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; padding:24px; }
  form { width:100%; max-width:400px; display:flex; flex-direction:column; gap:16px; }
  h1 { font-size:20px; font-weight:600; margin:0; letter-spacing:-0.01em; }
  p.sub { margin:0 0 6px; color:#a1a1aa; font-size:13.5px; line-height:1.55; }
  label { font-size:12.5px; color:#d4d4d8; display:block; margin-bottom:6px; }
  small { display:block; margin-top:6px; color:#a1a1aa; font-size:12px; line-height:1.5; }
  input { width:100%; padding:10px 12px; border-radius:8px; border:0; background:#18181b;
          color:#fafafa; font-size:14px; outline:none; }
  input:focus { background:#27272a; }
  input.code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing:0.08em; text-transform:uppercase; }
  code { display:block; margin-top:6px; padding:8px 10px; border-radius:8px; background:#18181b; color:#e4e4e7;
         font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size:12px; overflow-x:auto; white-space:nowrap; user-select:all; }
  button { padding:11px 12px; border-radius:8px; border:0; background:#fafafa; color:#09090b;
           font-size:14px; font-weight:600; cursor:pointer; }
  button:hover { background:#e4e4e7; }
  .err { background:#2a1215; color:#fca5a5; padding:10px 12px; border-radius:8px; font-size:13px; line-height:1.5; }
  p.lien { color:#d4d4d8; }
  hr { width:100%; border:0; height:1px; background:#27272a; margin:2px 0; }
</style>
</head>
<body>
<form method="POST" action="/auth/installation" data-page-installation="1">
  <h1>${e(t.titre)}</h1>
  <p class="sub">${e(t.intro)}</p>
  ${options.erreur ? `<div class="err" data-erreur-installation="1">${e(options.erreur)}</div>` : ''}
  ${champDuCode}
  <div>
    <label for="n">${e(t.nom)}</label>
    <input id="n" name="nomAffiche" autocomplete="name" value="${e(options.saisie?.nomAffiche ?? '')}" required${duLien ? ' autofocus' : ''}>
    <small>${e(t.aideNom)}</small>
  </div>
  <div>
    <label for="u">${e(t.identifiant)}</label>
    <input id="u" name="username" autocomplete="username" autocapitalize="off" autocorrect="off" spellcheck="false" value="${e(options.saisie?.identifiant ?? '')}" required>
    <small>${e(t.aideIdentifiant)}</small>
  </div>
  <div>
    <label for="p">${e(t.motDePasse)}</label>
    <input id="p" name="password" type="password" autocomplete="new-password" minlength="12" required>
    <small>${e(t.aideMotDePasse)}</small>
  </div>
  <div>
    <label for="p2">${e(t.confirmation)}</label>
    <input id="p2" name="password2" type="password" autocomplete="new-password" minlength="12" required>
  </div>
  <button type="submit">${e(t.bouton)}</button>
</form>
${duLien ? `<script>try{history.replaceState(null,'','/')}catch(e){}</script>` : ''}
</body>
</html>`;
}

/** Le message « les deux mots de passe diffèrent », dans la langue de la page. */
export function messageMotsDePasseDifferents(acceptLanguage: string | undefined): string {
  return TEXTES[langueDeLaPage(acceptLanguage)].differents;
}
