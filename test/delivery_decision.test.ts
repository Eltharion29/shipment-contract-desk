import { test } from 'node:test';
import assert from 'node:assert/strict';
import { releaseDecision, type ShipmentEvent } from '../src/delivery_decision.ts';
test('delivery proof cannot release a shipment with an open exception', () => {
  const events: ShipmentEvent[] = [
    { kind: 'delivered' as const, at: '2026-11-01T12:00:00Z' },
    { kind: 'exception' as const, at: '2026-11-01T13:00:00Z' },
  ];
  assert.equal(releaseDecision(events, 1), 'hold');
  assert.equal(releaseDecision(events.concat([{ kind: 'resolved', at: '2026-11-01T14:00:00Z' }]), 1), 'sign');
  assert.equal(releaseDecision([], 1), 'hold');
  assert.equal(releaseDecision([{ kind: 'delivered', at: '2026-11-01T12:00:00Z' }], 0), 'hold');
});
