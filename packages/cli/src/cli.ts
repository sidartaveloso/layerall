#!/usr/bin/env node
import { Command } from 'commander';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { buildPolicy, validatePolicy } from './policy.js';
import {
  defaultLandingConfig,
  renderLanding,
  validateLandingConfig,
} from './landing.js';

const program = new Command();

program
  .name('layerall')
  .description('CLI for scaffolding LayerAll policies and provider configs')
  .version(getVersion());

program
  .command('init')
  .description('Scaffold a default layerall.policy.json')
  .option('-o, --out <path>', 'output file', 'layerall.policy.json')
  .option('-p, --providers <ids>', 'comma-separated provider ids', 'providerA,providerB,providerC')
  .option('-w, --weights <pairs>', 'comma-separated id=weight pairs')
  .action((opts) => {
    const providers = String(opts.providers).split(',').map((s) => s.trim()).filter(Boolean);
    const weights = parseWeights(opts.weights);
    const policy = buildPolicy({
      providers,
      weights,
      timeoutMs: 8000,
      retries: { max: 1, backoffMs: 300 },
    });
    const outPath = resolve(process.cwd(), opts.out);
    writeFileSync(outPath, JSON.stringify(policy, null, 2) + '\n', 'utf8');
    console.log(`✔ Policy written to ${outPath}`);
  });

program
  .command('validate <file>')
  .description('Validate a layerall.policy.json file')
  .action((file) => {
    const path = resolve(process.cwd(), file);
    if (!existsSync(path)) {
      console.error(`✖ File not found: ${path}`);
      process.exitCode = 1;
      return;
    }
    const raw = readFileSync(path, 'utf8');
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch (err) {
      console.error(`✖ Invalid JSON: ${(err as Error).message}`);
      process.exitCode = 1;
      return;
    }
    const issues = validatePolicy(json);
    if (issues.length === 0) {
      console.log('✔ Policy is valid.');
    } else {
      console.error('✖ Policy issues:');
      for (const i of issues) console.error('  -', i);
      process.exitCode = 1;
    }
  });

program
  .command('init-landing')
  .description('Generate a static marketing landing page from a JSON config')
  .option('-c, --config <path>', 'path to landing-config JSON file')
  .option('-o, --out <path>', 'output directory', 'landing')
  .action((opts) => {
    let configInput: unknown;
    if (opts.config) {
      const cfgPath = resolve(process.cwd(), opts.config);
      if (!existsSync(cfgPath)) {
        console.error(`✖ Config file not found: ${cfgPath}`);
        process.exitCode = 1;
        return;
      }
      try {
        configInput = JSON.parse(readFileSync(cfgPath, 'utf8'));
      } catch (err) {
        console.error(`✖ Invalid JSON config: ${(err as Error).message}`);
        process.exitCode = 1;
        return;
      }
    } else {
      configInput = defaultLandingConfig();
    }
    const result = validateLandingConfig(configInput);
    if (!result.ok || !result.config) {
      console.error('✖ Landing config issues:');
      for (const i of result.issues) console.error(`  - ${i.path || '(root)'}: ${i.message}`);
      process.exitCode = 1;
      return;
    }
    const html = renderLanding(result.config);
    const outDir = resolve(process.cwd(), opts.out);
    mkdirSync(outDir, { recursive: true });
    const outPath = resolve(outDir, 'index.html');
    writeFileSync(outPath, html, 'utf8');
    console.log(`✔ Landing written to ${outPath}`);
  });

program.parse(process.argv);

function parseWeights(input: string | undefined): Record<string, number> | undefined {
  if (!input) return undefined;
  const out: Record<string, number> = {};
  for (const pair of String(input).split(',')) {
    const [id, w] = pair.split('=');
    if (id) out[id.trim()] = Number(w ?? 1);
  }
  return out;
}

function getVersion(): string {
  try {
    const pkg = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8')
    ) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}