const { readFileSync } = require('fs');
const js = readFileSync('../import_sofifa_positions.js', 'utf8');

const POS_MAP = {
  GK: 'GK', SW: 'CB', RWB: 'RWB', RB: 'RB', RCB: 'CB', CB: 'CB', LCB: 'CB',
  LB: 'LB', LWB: 'LWB', RDM: 'DM', CDM: 'DM', LDM: 'DM', RM: 'RM',
  RCM: 'CM', CM: 'CM', LCM: 'CM', LM: 'LM', RAM: 'AM', CAM: 'AM', LAM: 'AM',
  RF: 'RW', CF: 'ST', LF: 'LW', RW: 'RW', RS: 'ST', ST: 'ST', LS: 'ST', LW: 'LW',
};

function processPositions(name, positionsRaw) {
  const allRaw = new Set(positionsRaw);
  const hasLB = allRaw.has('LB') || allRaw.has('LWB');
  const hasLM = allRaw.has('LM');
  const hasLW = allRaw.has('LW') || allRaw.has('LF');
  const isLWB = hasLB && hasLM;
  const hasRB = allRaw.has('RB') || allRaw.has('RWB');
  const hasRM = allRaw.has('RM');
  const hasRW = allRaw.has('RW') || allRaw.has('RF');
  const isRWB = hasRB && hasRM;

  const finalSet = new Set();
  if (isLWB) {
    finalSet.add('LWB');
    if (!hasLW) finalSet.add('LB');
  } else {
    if (hasLB) finalSet.add('LB');
    if (hasLM) finalSet.add('LW');
  }
  if (hasLW) finalSet.add('LW');

  if (isRWB) {
    finalSet.add('RWB');
    if (!hasRW) finalSet.add('RB');
  } else {
    if (hasRB) finalSet.add('RB');
    if (hasRM) finalSet.add('RW');
  }
  if (hasRW) finalSet.add('RW');

  for (const raw of positionsRaw) {
    const mapped = POS_MAP[raw];
    if (mapped && !['LB', 'RB', 'LW', 'RW', 'LWB', 'RWB', 'LM', 'RM', 'LF', 'RF'].includes(raw)) {
      finalSet.add(mapped);
    }
  }

  const allFinal = Array.from(finalSet);
  const sofifaPrimaryRaw = positionsRaw[0];
  let primary = POS_MAP[sofifaPrimaryRaw];
  
  if (sofifaPrimaryRaw === 'LM') primary = isLWB ? 'LWB' : 'LW';
  if (sofifaPrimaryRaw === 'RM') primary = isRWB ? 'RWB' : 'RW';

  const isDefender = ['CB', 'LB', 'RB'].includes(POS_MAP[sofifaPrimaryRaw]);
  if (isLWB && hasLW) primary = isDefender ? 'LWB' : 'LW';
  if (isRWB && hasRW) primary = isDefender ? 'RWB' : 'RW';

  if (isLWB && !hasLW && ['LB', 'LWB'].includes(primary)) primary = 'LWB';
  if (isRWB && !hasRW && ['RB', 'RWB'].includes(primary)) primary = 'RWB';

  const secondary = allFinal.filter(p => p !== primary);
  console.log(`${name}: Primary = ${primary}, Secondary = [${secondary.join(', ')}]`);
}

processPositions('John McGinn', ['RM', 'LM', 'CAM', 'RB']);
