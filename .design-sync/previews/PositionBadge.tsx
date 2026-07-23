import { PositionBadge } from 'gaffa';

const POSITIONS = ['GK', 'CB', 'LB', 'RB', 'LWB', 'RWB', 'DM', 'CM', 'AM', 'LW', 'RW', 'ST'] as const;

export function AllPositions() {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, padding: 16 }}>
      {POSITIONS.map((p) => (
        <PositionBadge key={p} position={p} size="md" />
      ))}
    </div>
  );
}

export function Sizes() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: 16 }}>
      <PositionBadge position="ST" size="sm" />
      <PositionBadge position="ST" size="md" />
      <PositionBadge position="CM" size="sm" />
      <PositionBadge position="CM" size="md" />
    </div>
  );
}
