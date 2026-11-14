import { describe, expect, it } from 'vitest';
import { complaintBody, complaintScope, complaintText, complaintTransition } from '../src/modules/complaint/complaint-service.js';

describe('complaint rules', () => {
  it('enforces the supported lifecycle without closure or reopening defaults', () => {
    expect(complaintTransition('OPEN', 'acknowledge')).toBe('ACKNOWLEDGED');
    expect(complaintTransition('ACKNOWLEDGED', 'update')).toBe('IN_PROGRESS');
    expect(complaintTransition('IN_PROGRESS', 'resolve')).toBe('RESOLVED');
    expect(() => complaintTransition('OPEN', 'resolve')).toThrow();
    expect(() => complaintTransition('RESOLVED', 'update')).toThrow();
  });
  it('rejects forged identity/status fields and empty descriptions', () => {
    expect(() => complaintBody({ societyId: 'foreign' }, ['title'])).toThrow();
    expect(() => complaintBody({ status: 'RESOLVED' }, ['description'])).toThrow();
    expect(() => complaintText(' ', 'Description', 10000)).toThrow();
  });
  it('does not infer complaint oversight from a committee application role', () => {
    expect(() => complaintScope({ userId: '68a123456789012345678901', societyId: '68a123456789012345678902', role: 'COMMITTEE_MEMBER' })).toThrow();
  });
});
