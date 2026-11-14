type Props = {
  recordIntegrity?: boolean;
  status: string;
  verified: boolean;
  receiptStatus?: number;
};

type Tone = 'complete' | 'pending' | 'error' | 'neutral';

export function ProofVerificationRail({ recordIntegrity, status, verified, receiptStatus }: Props) {
  const registryVerified = status === 'CONFIRMED' && verified;
  const registryTone: Tone = registryVerified ? 'complete'
    : status === 'PENDING' ? 'pending'
      : ['FAILED', 'CONFLICT', 'INTEGRITY_ERROR'].includes(status) ? 'error' : 'neutral';
  const checkpoints: Array<{ label: string; value: string; tone: Tone }> = [
    {
      label: 'Record integrity',
      value: recordIntegrity === true ? 'Hash matches' : recordIntegrity === false ? 'Hash mismatch' : 'Not returned',
      tone: recordIntegrity === true ? 'complete' : recordIntegrity === false ? 'error' : 'neutral',
    },
    { label: 'Registry proof', value: registryVerified ? 'Verified' : status.replaceAll('_', ' '), tone: registryTone },
    {
      label: 'Transaction receipt',
      value: receiptStatus === undefined ? 'Not returned' : `Receipt status ${receiptStatus}`,
      tone: receiptStatus === 1 ? 'complete' : receiptStatus === 0 ? 'error' : 'neutral',
    },
  ];

  return (
    <ol className="proof-verification-rail" aria-label="Verification details returned for this audit record">
      {checkpoints.map((checkpoint) => <li key={checkpoint.label} className={`proof-checkpoint proof-checkpoint-${checkpoint.tone}`}>
        <span className="proof-checkpoint-marker" aria-hidden="true" />
        <span className="proof-checkpoint-label">{checkpoint.label}</span>
        <span className="proof-checkpoint-value">{checkpoint.value}</span>
      </li>)}
    </ol>
  );
}
