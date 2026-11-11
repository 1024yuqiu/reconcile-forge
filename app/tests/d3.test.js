import test from 'node:test';
import assert from 'node:assert/strict';
import { latestPreview } from '../static/ui/preview-state.js';

test('two worksheet switches discard the earlier response arriving last, including its completion', async () => {
  const requests = latestPreview();
  let label = '6 rows · 5 columns · header row 3';
  const seen = [];
  const pending = [];
  async function select(sheet) {
    const request = requests.begin();
    label = 'Loading…'; seen.push(label);
    const preview = await new Promise(resolve => pending.push(resolve));
    if (!request.current()) return;
    label = preview; seen.push(label);
  }
  const first = select('Read me');
  const last = select('Transactions');
  assert.equal(label, 'Loading…');
  pending[1]('6 rows · 5 columns · header row 3'); await last;
  pending[0]('1 rows · 1 columns · header row 1'); await first;
  assert.equal(label, '6 rows · 5 columns · header row 3');
  assert.deepEqual(seen, ['Loading…', 'Loading…', '6 rows · 5 columns · header row 3']);
});
