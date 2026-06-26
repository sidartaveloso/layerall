import { describe, expect, it } from 'vitest';
import {
  validateLandingConfig,
  renderLanding,
  defaultLandingConfig,
} from './landing.js';

describe('validateLandingConfig', () => {
  it('accepts the default config', () => {
    const r = validateLandingConfig(defaultLandingConfig());
    expect(r.ok).toBe(true);
    expect(r.issues).toEqual([]);
  });

  it('rejects non-objects', () => {
    const r = validateLandingConfig(null);
    expect(r.ok).toBe(false);
    expect(r.issues[0].message).toMatch(/objeto/);
  });

  it('flags missing required strings', () => {
    const r = validateLandingConfig({ operations: ['create'], strategies: ['round_robin'], providers: [{ name: 'A' }] });
    expect(r.ok).toBe(false);
    const paths = r.issues.map(i => i.path).sort();
    expect(paths).toContain('product');
    expect(paths).toContain('tagline');
    expect(paths).toContain('domain');
  });

  it('flags unknown strategies', () => {
    const r = validateLandingConfig({
      product: 'AllX', tagline: 't', domain: 'd',
      operations: ['create'], strategies: ['random'],
      providers: [{ name: 'A' }],
    });
    expect(r.ok).toBe(false);
    expect(r.issues.some(i => i.message.includes('random'))).toBe(true);
  });

  it('flags empty arrays', () => {
    const r = validateLandingConfig({
      product: 'AllX', tagline: 't', domain: 'd',
      operations: [], strategies: ['round_robin'], providers: [],
    });
    expect(r.ok).toBe(false);
    const paths = r.issues.map(i => i.path);
    expect(paths).toContain('operations');
    expect(paths).toContain('providers');
  });

  it('flags provider health outside [0,1]', () => {
    const r = validateLandingConfig({
      product: 'AllX', tagline: 't', domain: 'd',
      operations: ['create'], strategies: ['round_robin'],
      providers: [{ name: 'A', health: 1.4 }],
    });
    expect(r.ok).toBe(false);
    expect(r.issues.some(i => i.path === 'providers[0].health')).toBe(true);
  });

  it('flags invalid sdkExamples keys', () => {
    const r = validateLandingConfig({
      product: 'AllX', tagline: 't', domain: 'd',
      operations: ['create'], strategies: ['round_robin'],
      providers: [{ name: 'A' }],
      sdkExamples: { ruby: 'foo' },
    });
    expect(r.ok).toBe(false);
    expect(r.issues.some(i => i.path === 'sdkExamples.ruby')).toBe(true);
  });

  it('flags pricing with wrong providers shape', () => {
    const r = validateLandingConfig({
      product: 'AllX', tagline: 't', domain: 'd',
      operations: ['create'], strategies: ['round_robin'],
      providers: [{ name: 'A' }],
      pricing: { pro: { providers: 'many' } },
    });
    expect(r.ok).toBe(false);
    expect(r.issues.some(i => i.path === 'pricing.pro.providers')).toBe(true);
  });

  it('accepts minimal valid config without optional fields', () => {
    const r = validateLandingConfig({
      product: 'AllGeo', tagline: 'geocoding', domain: 'geo',
      operations: ['reverse'], strategies: ['most_fast'],
      providers: [{ name: 'Google' }, { name: 'Mapbox' }],
    });
    expect(r.ok).toBe(true);
  });
});

describe('renderLanding', () => {
  it('produces a full HTML document', () => {
    const html = renderLanding(defaultLandingConfig());
    expect(html).toMatch(/^<!DOCTYPE html>/);
    expect(html.trim().endsWith('</html>')).toBe(true);
  });

  it('substitutes the product name into the title and visible text', () => {
    const html = renderLanding({ ...defaultLandingConfig(), product: 'AllGeo' });
    expect(html).toContain('<title>AllGeo —');
    expect(html).toContain('>AllGeo</span>');
  });

  it('injects the JSON config into a script tag', () => {
    const cfg = defaultLandingConfig();
    const html = renderLanding(cfg);
    expect(html).toContain('window.__LAYERALL_CONFIG__');
    expect(html).toContain(JSON.stringify(cfg.product));
  });

  it('escapes </script> sequences inside embedded SDK snippets', () => {
    const cfg = defaultLandingConfig();
    cfg.sdkExamples = {
      node: "const x = '</script>'",
      python: '',
      curl: '',
    };
    const html = renderLanding(cfg);
    expect(html).not.toContain("'</script>'");
    // escaped form should be present
    expect(html).toContain('\\u003c/script\\u003e');
  });

  it('falls back to a default hero snippet when sdkExamples.node is absent', () => {
    const cfg = defaultLandingConfig();
    delete cfg.sdkExamples;
    const html = renderLanding(cfg);
    expect(html).toContain('@layerall/sdk');
  });
});