type Props = { yes: number; no: number; abstain: number };

function safeCount(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

export function VoteOutcomeTrack({ yes, no, abstain }: Props) {
  const counts = { yes: safeCount(yes), no: safeCount(no), abstain: safeCount(abstain) };
  const total = counts.yes + counts.no + counts.abstain;
  const share = (count: number) => total > 0 ? `${(count / total) * 100}%` : '0%';

  return (
    <div className="vote-outcome-track" role="img" aria-label={`Recorded votes: ${counts.yes} yes, ${counts.no} no, ${counts.abstain} abstain`}>
      <div className="vote-outcome-bar" aria-hidden="true">
        <span className="vote-outcome-yes" style={{ width: share(counts.yes) }} />
        <span className="vote-outcome-no" style={{ width: share(counts.no) }} />
        <span className="vote-outcome-abstain" style={{ width: share(counts.abstain) }} />
      </div>
    </div>
  );
}
