export type ShipmentEvent = { kind: 'picked_up' | 'delivered' | 'exception' | 'resolved'; at: string };
export function releaseDecision(events: ShipmentEvent[], proofCount: number): 'sign' | 'hold' {
  let exceptionOpen = false;
  let delivered = false;
  for (const event of events) {
    if (event.kind === 'exception') exceptionOpen = true;
    if (event.kind === 'resolved') exceptionOpen = false;
    if (event.kind === 'delivered') delivered = true;
  }
  return delivered && !exceptionOpen && proofCount > 0 ? 'sign' : 'hold';
}
