import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { blocReverseProxySousDomaine } from '@beluga/shared';
import { log } from './logger.js';

const execFileAsync = promisify(execFile);

/**
 * Les adresses publiques (PLAN §12) : Beluga Build sait créer lui-même le
 * sous-domaine d'un projet, comme le faisait l'outil précédent. Le jeton du
 * fournisseur vit sur le serveur, jamais dans l'interface.
 *
 * Tout se passe EN LOCAL, sur la machine de Beluga Build : lire le jeton,
 * écrire le reverse-proxy, recharger le service web. L'ancienne exécution
 * distante par SSH (réglage « Accès au VPS ») a été retirée — elle n'était
 * plus jamais renseignée.
 *
 * Ordre CRITIQUE : l'enregistrement DNS d'abord, le reverse-proxy ensuite.
 * L'inverse fait échouer l'émission du certificat et déclenche une limitation
 * d'une heure sur le sous-domaine.
 */

const ZONE = 'haikostudio.cloud';
// Depuis le 2026-08-30 la zone est servie par Hetzner : elle vit dans l'API Cloud
// (/v1/zones), au même endroit que les serveurs. Écrire chez l'ancien fournisseur
// n'aurait plus aucun effet visible sur Internet.
const API = 'https://api.hetzner.cloud/v1/zones';

/** Exécute une commande sur cette machine. */
function exec(programme: string, args: string[], timeout: number): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync(programme, args, { timeout });
}

async function token(): Promise<string | null> {
  try {
    const { stdout } = await exec(
      'sudo',
      ['-n', 'grep', '-oP', 'HETZNER_API_TOKEN=\\K.*', '/etc/beluga/jeton-hetzner'],
      15000,
    );
    return stdout.trim().replace(/^["']|["']$/g, '') || null;
  } catch {
    return null;
  }
}

async function serverIp(): Promise<string> {
  try {
    const res = await fetch('https://api.ipify.org', { signal: AbortSignal.timeout(10000) });
    const ip = (await res.text()).trim();
    if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return ip;
  } catch {
    /* on retombe sur l'adresse connue */
  }
  return '198.51.100.7';
}

/**
 * L'identifiant interne de la zone chez Hetzner, cherché par son nom — ET la
 * preuve que cette zone commande vraiment le nom sur Internet.
 *
 * Une zone peut exister chez le fournisseur sans que le registrar lui ait confié
 * le domaine : Hetzner l'annonce alors en `delegation_status: "invalid"`. Écrire
 * dedans réussit, renvoie 201, et ne change STRICTEMENT rien pour personne.
 * C'est ce qui s'est passé pendant trois semaines sur haikostudio.cloud, sans
 * que rien ne le signale — un joker DNS chez l'ancien fournisseur renvoyait
 * n'importe quel nom vers le serveur, si bien que l'attente de propagation
 * ci-dessous se croyait satisfaite alors qu'aucun enregistrement n'existait.
 */
async function zone(key: string): Promise<{ id: number } | { erreur: string }> {
  const res = await fetch(`${API}?name=${encodeURIComponent(ZONE)}`, {
    headers: { authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) return { erreur: `le fournisseur de noms ne répond pas (${res.status})` };
  const body = (await res.json()) as {
    zones?: Array<{ id: number; name: string; assigned_nameservers?: { delegation_status?: string } }>;
  };
  const trouvee = body.zones?.find((z) => z.name === ZONE);
  if (!trouvee) return { erreur: `zone ${ZONE} introuvable chez le fournisseur de noms` };

  const delegation = trouvee.assigned_nameservers?.delegation_status;
  if (delegation && delegation !== 'valid') {
    return {
      erreur:
        `la zone ${ZONE} existe chez le fournisseur mais ne commande pas encore le domaine ` +
        `(délégation « ${delegation} ») : y écrire n'aurait aucun effet. Le registrar doit ` +
        `d'abord pointer le domaine vers les serveurs de noms de ce fournisseur.`,
    };
  }
  return { id: trouvee.id };
}

export interface DnsResult {
  ok: boolean;
  url?: string;
  error?: string;
}

/** Crée l'enregistrement, attend qu'il se propage, puis pose le reverse-proxy. */
export async function publishSubdomain(subdomain: string, port: number): Promise<DnsResult> {
  const slug = subdomain
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  if (!slug) return { ok: false, error: 'nom de sous-domaine vide' };

  const key = await token();
  if (!key) return { ok: false, error: "aucun accès au fournisseur de noms depuis ce serveur" };

  const ip = await serverIp();

  // 1. L'enregistrement, ajouté seul : les autres noms ne sont pas touchés.
  let zoneIdentifiant: number;
  try {
    const z = await zone(key);
    if ('erreur' in z) return { ok: false, error: z.erreur };
    zoneIdentifiant = z.id;
    const res = await fetch(`${API}/${zoneIdentifiant}/rrsets`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ name: slug, type: 'A', ttl: 300, records: [{ value: ip }] }),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) {
      const body = await res.text();
      // Un conflit dit « ce nom existe déjà », ce qui est le résultat voulu —
      // mais un vrai refus porte le même code. On ne conclut donc pas sur le
      // code seul : on relit la zone pour voir si l'enregistrement y est.
      const conflit = /conflict|already|exist/i.test(body) || res.status === 409 || res.status === 422;
      if (!conflit) return { ok: false, error: `le fournisseur a refusé (${res.status})` };
      const relu = await fetch(`${API}/${zoneIdentifiant}/rrsets/${encodeURIComponent(slug)}/A`, {
        headers: { authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(20000),
      });
      if (!relu.ok) {
        return { ok: false, error: `le fournisseur a refusé (${res.status}) et le nom n'existe pas` };
      }
    }
  } catch (err: any) {
    return { ok: false, error: err?.message ?? 'appel au fournisseur impossible' };
  }

  // 2. La propagation, AVANT de toucher au reverse-proxy. Elle se lit d'ici :
  //    le nom est visible partout sur Internet, machine locale ou distante.
  const nom = `${slug}.${ZONE}`;
  let resolu = false;
  for (let essai = 0; essai < 20 && !resolu; essai++) {
    try {
      const { stdout } = await execFileAsync('dig', ['+short', '@1.1.1.1', nom, 'A'], { timeout: 10000 });
      resolu = stdout.includes(ip);
    } catch {
      /* on réessaie */
    }
    if (!resolu) await new Promise((r) => setTimeout(r, 3000));
  }
  if (!resolu) return { ok: false, error: "le nom n'est pas encore visible sur Internet, réessayez dans un instant" };

  // 3. Le reverse-proxy, une fois le nom résolu.
  try {
    // L'adresse demandée arrive INTACTE au projet : voir blocReverseProxySousDomaine.
    const bloc = blocReverseProxySousDomaine(nom, port);
    await exec(
      'sudo',
      ['-n', 'bash', '-c', `cat > /etc/caddy/project-autostart.d/${slug}.caddy <<'FIN'\n${bloc}FIN`],
      20000,
    );
    await exec('sudo', ['-n', 'caddy', 'validate', '--config', '/etc/caddy/Caddyfile'], 30000);
    await exec('sudo', ['-n', 'systemctl', 'reload', 'caddy'], 30000);
  } catch (err: any) {
    return { ok: false, error: `nom créé, mais le service web a refusé la configuration : ${err?.message ?? err}` };
  }

  log.info(`sous-domaine publié : https://${nom} → 127.0.0.1:${port}`);
  return { ok: true, url: `https://${nom}` };
}
