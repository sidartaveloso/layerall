import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = join(__dirname, 'templates', 'landing.html');

const STRATEGY_NAMES = ['round_robin', 'load_balance', 'most_fast', 'failover'] as const;
const VALID_STRATEGIES = new Set<string>(STRATEGY_NAMES);

/** Public landing page config — drives every section of the template. */
export interface LandingConfig {
  /** Product / brand name (e.g. "AllGeo"). */
  product: string;
  /** One-line tagline used in `<title>`, meta description and the hero gradient line. */
  tagline: string;
  /** Word describing the orchestration domain (e.g. "geocode reverso"). */
  domain: string;
  /** Operation names the orchestrator exposes (e.g. ["reverse","batch"]). */
  operations: string[];
  /** Strategy names enabled on this product (subset of LayerAll strategies). */
  strategies: (typeof STRATEGY_NAMES)[number][];
  /** One entry per integrated provider. */
  providers: LandingProvider[];
  /** Source snippets shown in the hero and SDK tabs, keyed by language id. */
  sdkExamples?: Partial<Record<'node' | 'python' | 'curl', string>>;
  /** Pricing tiers keyed by tier id (e.g. "starter" / "pro" / "enterprise"). */
  pricing?: Record<string, LandingPricingTier>;
  /** Contact call-to-action. */
  cta?: {
    /** Contact email used by the primary CTA buttons. */
    email?: string;
  };
}

export interface LandingProvider {
  /** Display name (e.g. "Google Maps"). */
  name: string;
  /** Traffic weight used by load_balance (defaults to 1). */
  weight?: number;
  /** Base latency in ms shown in the provider card. */
  latency?: number;
  /** Health score in [0,1] shown in the provider card. */
  health?: number;
}

export interface LandingPricingTier {
  /** Display price (e.g. "R$ 0", "Sob consulta"). */
  price?: string;
  /** Volume legend (e.g. "10k/mês"). */
  requests?: string;
  /** Count of providers allowed, or "ilimitado". */
  providers?: number | 'ilimitado';
  /** Extra bullet features. */
  features?: string[];
}

export interface LandingValidationIssue {
  path: string;
  message: string;
}

export interface LandingValidationResult {
  ok: boolean;
  issues: LandingValidationIssue[];
  config?: LandingConfig;
}

/** Validates a raw config object against the LandingConfig shape. */
export function validateLandingConfig(input: unknown): LandingValidationResult {
  const issues: LandingValidationIssue[] = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, issues: [{ path: '', message: 'config deve ser um objeto' }] };
  }
  const c = input as Record<string, unknown>;

  if (typeof c.product !== 'string' || !c.product.trim()) {
    issues.push({ path: 'product', message: 'product deve ser uma string não vazia' });
  }
  if (typeof c.tagline !== 'string' || !c.tagline.trim()) {
    issues.push({ path: 'tagline', message: 'tagline deve ser uma string não vazia' });
  }
  if (typeof c.domain !== 'string' || !c.domain.trim()) {
    issues.push({ path: 'domain', message: 'domain deve ser uma string não vazia' });
  }

  if (!Array.isArray(c.operations) || !c.operations.every(o => typeof o === 'string' && o.trim())) {
    issues.push({ path: 'operations', message: 'operations deve ser um array de strings' });
  } else if (c.operations.length === 0) {
    issues.push({ path: 'operations', message: 'operations não pode ser vazio' });
  }

  if (!Array.isArray(c.strategies) || !c.strategies.every(s => typeof s === 'string')) {
    issues.push({ path: 'strategies', message: 'strategies deve ser um array de strings' });
  } else {
    for (const s of c.strategies) {
      if (!VALID_STRATEGIES.has(s as string)) {
        issues.push({ path: 'strategies', message: `estratégia desconhecida: "${s}". Válidas: ${STRATEGY_NAMES.join(', ')}` });
      }
    }
    if (c.strategies.length === 0) {
      issues.push({ path: 'strategies', message: 'strategies não pode ser vazio' });
    }
  }

  if (!Array.isArray(c.providers) || !c.providers.every(p => p && typeof p === 'object' && typeof (p as { name?: unknown }).name === 'string')) {
    issues.push({ path: 'providers', message: 'providers deve ser um array de objetos { name: string }' });
  } else {
    c.providers.forEach((p, i) => {
      const prov = p as { weight?: unknown; latency?: unknown; health?: unknown };
      if (prov.weight != null && typeof prov.weight !== 'number') {
        issues.push({ path: `providers[${i}].weight`, message: 'weight deve ser number' });
      }
      if (prov.latency != null && typeof prov.latency !== 'number') {
        issues.push({ path: `providers[${i}].latency`, message: 'latency deve ser number' });
      }
      if (prov.health != null && (typeof prov.health !== 'number' || prov.health < 0 || prov.health > 1)) {
        issues.push({ path: `providers[${i}].health`, message: 'health deve ser number em [0,1]' });
      }
    });
    if (c.providers.length === 0) {
      issues.push({ path: 'providers', message: 'providers não pode ser vazio' });
    }
  }

  if (c.sdkExamples != null) {
    if (typeof c.sdkExamples !== 'object' || Array.isArray(c.sdkExamples)) {
      issues.push({ path: 'sdkExamples', message: 'sdkExamples deve ser um objeto { node?, python?, curl? }' });
    } else {
      const allowed = new Set(['node', 'python', 'curl']);
      for (const k of Object.keys(c.sdkExamples)) {
        if (!allowed.has(k)) issues.push({ path: `sdkExamples.${k}`, message: 'chave de sdkExamples inválida (use node, python ou curl)' });
        else if (typeof (c.sdkExamples as Record<string, unknown>)[k] !== 'string') {
          issues.push({ path: `sdkExamples.${k}`, message: 'sdkExamples value deve ser string' });
        }
      }
    }
  }

  if (c.pricing != null) {
    if (typeof c.pricing !== 'object' || Array.isArray(c.pricing)) {
      issues.push({ path: 'pricing', message: 'pricing deve ser um objeto de tiers por id' });
    } else {
      for (const [tier, v] of Object.entries(c.pricing as Record<string, unknown>)) {
        if (!v || typeof v !== 'object') {
          issues.push({ path: `pricing.${tier}`, message: 'tier deve ser um objeto' });
          continue;
        }
        const t = v as { price?: unknown; requests?: unknown; providers?: unknown; features?: unknown };
        if (t.price != null && typeof t.price !== 'string') {
          issues.push({ path: `pricing.${tier}.price`, message: 'price deve ser string' });
        }
        if (t.requests != null && typeof t.requests !== 'string') {
          issues.push({ path: `pricing.${tier}.requests`, message: 'requests deve ser string' });
        }
        if (t.providers != null && typeof t.providers !== 'number' && t.providers !== 'ilimitado') {
          issues.push({ path: `pricing.${tier}.providers`, message: 'providers deve ser number ou "ilimitado"' });
        }
        if (t.features != null && !(Array.isArray(t.features) && t.features.every(f => typeof f === 'string'))) {
          issues.push({ path: `pricing.${tier}.features`, message: 'features deve ser array de strings' });
        }
      }
    }
  }

  if (c.cta != null) {
    if (typeof c.cta !== 'object' || Array.isArray(c.cta)) {
      issues.push({ path: 'cta', message: 'cta deve ser um objeto { email? }' });
    } else if ((c.cta as { email?: unknown }).email != null && typeof (c.cta as { email?: unknown }).email !== 'string') {
      issues.push({ path: 'cta.email', message: 'cta.email deve ser string' });
    }
  }

  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, issues: [], config: c as unknown as LandingConfig };
}

const DEFAULT_HERO_CODE = `import { Orchestrator } from '@layerall/sdk';

const client = new Orchestrator({
  apiKey: process.env.LAYERALL_API_KEY!,
  baseUrl: 'https://api.seu-allx.com',
});

const result = await client.operation('create', {
  payload: { data: {} },
  strategy: 'most_fast',
});
console.log(result.provider, result.status);`;

/** Default config used when --config is not provided: a brandable agnostic template. */
export function defaultLandingConfig(): LandingConfig {
  return {
    product: 'AllX',
    tagline: 'Um SDK. N provedores. Orquestração plugável.',
    domain: 'orquestração',
    operations: ['create', 'send', 'status', 'cancel'],
    strategies: ['round_robin', 'load_balance', 'most_fast', 'failover'],
    providers: [
      { name: 'Provider A', weight: 50, latency: 180, health: 0.96 },
      { name: 'Provider B', weight: 30, latency: 120, health: 0.92 },
      { name: 'Provider C', weight: 20, latency: 90,  health: 0.88 },
    ],
    sdkExamples: {
      node: DEFAULT_HERO_CODE,
      python: `from layerall_sdk import Orchestrator
client = Orchestrator(api_key=...)
result = client.operation('create', payload={'data': {}}, strategy='most_fast')`,
      curl: `curl -X POST 'https://api.seu-allx.com/v1/operation/create' \\
  -H 'Authorization: Bearer $KEY' \\
  -d '{"payload":{"data":{}},"strategy":"most_fast"}'`,
    },
    pricing: {
      starter:    { price: 'R$ 0',           requests: '10k/mês',   providers: 2 },
      pro:        { price: 'R$ 499',         requests: '100k/mês',   providers: 'ilimitado' },
      enterprise: { price: 'Sob consulta',  features: ['SSO', 'SLA', 'Suporte dedicado'] },
    },
    cta: { email: 'contato@allx.com' },
  };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string));
}

/** Renders the full single-file landing HTML for the supplied config. */
export function renderLanding(config: LandingConfig): string {
  const template = readFileSync(TEMPLATE_PATH, 'utf8');
  const heroCode = config.sdkExamples?.node ?? DEFAULT_HERO_CODE;
  const title = `${config.product} — ${config.tagline}`;
  // Escape </script> when embedding JSON inline so user-supplied SDK snippets
  // can't break out of the script tag.
  const json = JSON.stringify(config).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');

  return template
    .replace(/__LAYERALL_TITLE__/g, escapeHtml(title))
    .replace(/__LAYERALL_TAGLINE__/g, escapeHtml(config.tagline))
    .replace(/__LAYERALL_PRODUCT__/g, escapeHtml(config.product))
    .replace(/__LAYERALL_DOMAIN__/g, escapeHtml(config.domain))
    .replace(/__LAYERALL_HERO_CODE__/g, escapeHtml(heroCode))
    .replace(/__LAYERALL_CONFIG_JSON__/g, json);
}