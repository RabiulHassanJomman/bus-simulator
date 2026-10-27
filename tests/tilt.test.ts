import { describe, expect, it } from 'vitest';
import { screenRoll } from '../src/game/Input';

describe('tilt steering', () => {
  it('portrait: right edge down steers right', () => {
    expect(screenRoll(0, 0, 0)).toBeCloseTo(0);
    expect(screenRoll(0, 20, 0)).toBeCloseTo(20);
    expect(screenRoll(40, -15, 0)).toBeLessThan(0); // held upright-ish, tilted left
  });

  it('landscape (rotated counter-clockwise): roll comes from beta', () => {
    // flat on a table, screen's right edge (device bottom) lowered
    expect(screenRoll(25, 0, 90)).toBeCloseTo(25);
    expect(screenRoll(-25, 0, 90)).toBeCloseTo(-25);
    // landscape the other way round flips the sign
    expect(screenRoll(25, 0, 270)).toBeCloseTo(-25);
  });

  it('landscape held upright like a steering wheel', () => {
    // device x axis points up (gamma -90); rotating the wheel changes beta
    expect(screenRoll(0, -89.9, 90)).toBeCloseTo(0, 0);
    expect(screenRoll(20, -89.9, 90)).toBeCloseTo(20, 0);
  });
});
