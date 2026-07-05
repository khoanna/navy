// fe/src/lib/dashboard/status.test.ts
import { statusTone } from './status';

describe('statusTone', () => {
  it('maps known payment/merchant statuses to tones + human labels', () => {
    expect(statusTone('paid')).toEqual({ tone: 'success', label: 'Paid' });
    expect(statusTone('approved')).toEqual({ tone: 'success', label: 'Approved' });
    expect(statusTone('awaiting_payment')).toEqual({ tone: 'warning', label: 'Awaiting payment' });
    expect(statusTone('pending')).toEqual({ tone: 'warning', label: 'Pending' });
    expect(statusTone('expired')).toEqual({ tone: 'danger', label: 'Expired' });
    expect(statusTone('rejected')).toEqual({ tone: 'danger', label: 'Rejected' });
    expect(statusTone('failed')).toEqual({ tone: 'danger', label: 'Failed' });
  });

  it('falls back to a neutral tone + title-cased label for unknown statuses', () => {
    expect(statusTone('created')).toEqual({ tone: 'neutral', label: 'Created' });
    expect(statusTone('some_new_state')).toEqual({ tone: 'neutral', label: 'Some new state' });
  });
});
