import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatDistance, formatDuration } from '../lib/format';

describe('formatadores operacionais', () => {
  it('formata distância em metros e quilômetros', () => {
    assert.equal(formatDistance(750), '750 m');
    assert.match(formatDistance(12_300), /12[,.]3 km/);
  });

  it('formata duração em minutos e horas', () => {
    assert.equal(formatDuration(1_800), '30min');
    assert.equal(formatDuration(5_400), '1h 30min');
    assert.equal(formatDuration(7_199), '2h 0min');
  });
});
