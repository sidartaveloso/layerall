# @layerall/cli

CLI tool for scaffolding LayerAll policies and validating them.

## Install

```bash
npm install -g @layerall/cli
# or
npx @layerall/cli <command>
```

## Commands

### `layerall init`

Scaffolds a `layerall.policy.json` with sensible defaults covering all four operations.

```bash
layerall init -p providerA,providerB,providerC -w providerA=50,providerB=30,providerC=20 -o layerall.policy.json
```

### `layerall validate <file>`

Validates the shape of a policy document and reports issues.

```bash
layerall validate layerall.policy.json
```

### `layerall init-landing`

Generates a static marketing landing page (`index.html`) from a JSON config describing
the product, providers, strategies, pricing and SDK snippets. With no `--config`,
emits a brandable agnostic "AllX" template.

```bash
layerall init-landing --config allgeo.json --out landing-geo
layerall init-landing --out landing-default
```

Schema:

```jsonc
{
  "product": "AllGeo",                     // required
  "tagline": "Geocode reverso unificado", // required
  "domain": "geocode reverso",            // required
  "operations": ["reverse", "batch"],      // required
  "strategies": ["round_robin", "most_fast", "failover"], // required
  "providers": [                            // required (≥1)
    { "name": "Google Maps", "weight": 50, "latency": 180, "health": 0.98 }
  ],
  "sdkExamples": { /* "node" | "python" | "curl": "..." */ }, // optional
  "pricing":   { /* "<tier>": { "price": "...", "requests": "...", "providers": number | "ilimitado", "features": ["..."] } */ }, // optional
  "cta":       { "email": "geo@allx.com" }  // optional
}
```

The generated HTML is fully static (Tailwind CDN + Google Fonts, no build step) and
can be hosted on any CDN.

See the root [README](../../README.md).