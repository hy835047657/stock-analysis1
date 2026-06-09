import { describe, it, expect } from 'vitest';
import { stanceOf, topicOf, convictionOf } from '../src/skills/viewClassifier/index.js';
import { validate } from '../src/skills/tickerValidator/index.js';
import { loadConfig } from '../src/common/index.js';

describe('viewClassifier', () => {
  it('classifies LONG / RISK_FLAG / topic / conviction', () => {
    const cfg = loadConfig();
    expect(stanceOf('I am long $SIVE, target 3x', cfg)).toBe('LONG');
    expect(stanceOf('Short report on this fraud', cfg)).toBe('RISK_FLAG');
    expect(topicOf('CPO photonics ramp')).toBe('PHOTONICS');
    expect(convictionOf({
      view_count: 600000, favorite_count: 2000,
      full_text: 'structural chokepoint thesis, 3x',
    })).toBeGreaterThanOrEqual(4);
  });
});

describe('tickerValidator', () => {
  it('respects blacklist & whitelist without network', async () => {
    const v = await validate(['NASA', 'CEO', 'USA', 'SEC', 'SIVE', 'XFAB']);
    expect(v.NASA).toBe(false);
    expect(v.CEO).toBe(false);
    expect(v.SEC).toBe(false);
    expect(v.SIVE).toBe(true);
    expect(v.XFAB).toBe(true);
  });
});

describe('config', () => {
  it('has L4/L6 layer overrides set to 168h', () => {
    const cfg = loadConfig();
    expect(cfg.pipeline.layer_overrides.L6_risk).toBe(168);
    expect(cfg.pipeline.layer_overrides.L4_macro).toBe(168);
  });

  it('includes sprucepointcap in L6_risk', () => {
    const cfg = loadConfig();
    const spruce = cfg.bloggers.find(b => b.handle === 'sprucepointcap');
    expect(spruce).toBeDefined();
    expect(spruce.layer).toBe('L6_risk');
  });
});
