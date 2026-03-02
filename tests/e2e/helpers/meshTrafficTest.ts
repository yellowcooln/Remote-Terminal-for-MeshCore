/**
 * Extended Playwright test fixture for tests that depend on receiving
 * messages from other nodes on the mesh network.
 *
 * Usage:
 *   import { test, expect } from '../helpers/meshTrafficTest';
 *   test('my test', { tag: '@mesh-traffic' }, async ({ page }) => { ... });
 *
 * When a @mesh-traffic-tagged test fails, an advisory annotation is added
 * to the HTML report and a console message is printed, letting the user
 * know the failure may be due to low mesh traffic rather than a real bug.
 */
import { test as base, expect } from '@playwright/test';

export { expect };

const TRAFFIC_ADVISORY =
  'This test depends on receiving messages from other nodes on the mesh ' +
  'network. Failure may indicate insufficient mesh traffic rather than a bug.';

export const test = base.extend<{ _meshTrafficAdvisory: void }>({
  _meshTrafficAdvisory: [
    async ({}, use, testInfo) => {
      await use();
      if (testInfo.status !== 'passed' && testInfo.tags.includes('@mesh-traffic')) {
        testInfo.annotations.push({ type: 'notice', description: TRAFFIC_ADVISORY });
        // Also print to console so it's visible in terminal output
        console.log(`\n⚠️  ${TRAFFIC_ADVISORY}\n`);
      }
    },
    { auto: true },
  ],
});
