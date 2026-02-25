import { describe, it, expect } from 'vitest';
import { RADIO_PRESETS } from '../utils/radioPresets';

describe('Radio Presets', () => {
  describe('preset values are valid LoRa parameters', () => {
    it('all frequencies are in valid ISM bands', () => {
      for (const preset of RADIO_PRESETS) {
        // 433 MHz: 433.05-434.79, EU 868: 863-870, US/AU/NZ/VN 900: 902-928
        const valid433 = preset.freq >= 433 && preset.freq <= 435;
        const validEU = preset.freq >= 863 && preset.freq <= 870;
        const valid900 = preset.freq >= 902 && preset.freq <= 928;
        expect(valid433 || validEU || valid900).toBe(true);
      }
    });

    it('all spreading factors are valid (7-12)', () => {
      for (const preset of RADIO_PRESETS) {
        expect(preset.sf).toBeGreaterThanOrEqual(7);
        expect(preset.sf).toBeLessThanOrEqual(12);
      }
    });

    it('all coding rates are valid (5-8 for 4/5 to 4/8)', () => {
      for (const preset of RADIO_PRESETS) {
        expect(preset.cr).toBeGreaterThanOrEqual(5);
        expect(preset.cr).toBeLessThanOrEqual(8);
      }
    });

    it('all bandwidths are standard LoRa values', () => {
      const validBandwidths = [7.8, 10.4, 15.6, 20.8, 31.25, 41.7, 62.5, 125, 250, 500];
      for (const preset of RADIO_PRESETS) {
        expect(validBandwidths).toContain(preset.bw);
      }
    });
  });
});
