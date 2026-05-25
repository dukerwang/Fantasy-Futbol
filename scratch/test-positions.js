const POS_MAP = {
  GK: 'GK',
  SW: 'CB',
  RWB: 'RWB',
  RB: 'RB',
  RCB: 'CB',
  CB: 'CB',
  LCB: 'CB',
  LB: 'LB',
  LWB: 'LWB',
  RDM: 'DM',
  CDM: 'DM',
  LDM: 'DM',
  DM: 'DM',
  RM: 'RM',
  RCM: 'CM',
  CM: 'CM',
  LCM: 'CM',
  LM: 'LM',
  RAM: 'AM',
  CAM: 'AM',
  LAM: 'AM',
  AM: 'AM',
  RF: 'RW',
  CF: 'ST',
  LF: 'LW',
  RW: 'RW',
  RS: 'ST',
  ST: 'ST',
  LS: 'ST',
  LW: 'LW',
};

function processPositions(name, positionsRaw, roles = []) {
  const sofifaPrimaryRaw = positionsRaw[0];

  const allRaw = new Set(positionsRaw);
  
  const hasLB = allRaw.has('LB') || allRaw.has('LWB');
  const hasLM = allRaw.has('LM');
  const hasLW = allRaw.has('LW') || allRaw.has('LF');
  
  const hasRB = allRaw.has('RB') || allRaw.has('RWB');
  const hasRM = allRaw.has('RM');
  const hasRW = allRaw.has('RW') || allRaw.has('RF');

  const hasBothMid = hasLM && hasRM;
  const hasOnlyOneFB = (hasLB && !hasRB) || (!hasLB && hasRB);

  const finalSet = new Set();
  
  let primary = POS_MAP[sofifaPrimaryRaw];

  const applySide = (side, hasFB, hasMid, hasWing) => {
    const fb = `${side}B`;
    const wb = `${side}WB`;
    const wing = `${side}W`;
    const midRaw = `${side}M`;
    const fbRaw = `${side}B`;
    const wingRaw = `${side}W`;

    const pCat = sofifaPrimaryRaw === midRaw ? 'mid' : sofifaPrimaryRaw === wingRaw ? 'wing' : sofifaPrimaryRaw === fbRaw ? 'fb' : 'other';

    if (hasBothMid && hasOnlyOneFB) {
      if (hasMid) {
        finalSet.add(wing);
        if (pCat === 'mid' || pCat === 'wing') primary = wing;
      }
      if (hasFB) {
        finalSet.add(wb);
        if (pCat === 'fb') primary = wb;
      }
      return;
    }

    if (!hasFB || !hasMid) {
      if (hasMid) {
        finalSet.add(wing);
        if (pCat === 'mid') primary = wing;
      }
      if (hasWing) {
        finalSet.add(wing);
        if (pCat === 'wing') primary = wing;
      }
      if (hasFB) {
        finalSet.add(fb);
        if (pCat === 'fb') primary = fb;
      }
      return;
    }

    if (hasFB && hasMid && hasWing) {
      if (pCat === 'mid' || pCat === 'wing') {
        primary = wing;
        finalSet.add(wing);
        finalSet.add(wb);
      } else if (pCat === 'fb') {
        primary = wb;
        finalSet.add(wb);
        finalSet.add(wing);
      } else {
        finalSet.add(wing);
        finalSet.add(wb);
      }
      return;
    }

    if (hasFB && hasMid && !hasWing) {
      const firstRoleLower = (roles[0] || '').toLowerCase();
      const isAttackingOrInverted = firstRoleLower.includes('attacking wingback') || firstRoleLower.includes('inverted wingback');
      
      if (isAttackingOrInverted) {
        if (pCat === 'fb' || pCat === 'mid') primary = wb;
        finalSet.add(wb);
        finalSet.add(fb);
      } else {
        if (pCat === 'fb' || pCat === 'mid') primary = fb;
        finalSet.add(fb);
        finalSet.add(wb);
      }
      return;
    }
  };

  applySide('L', hasLB, hasLM, hasLW);
  applySide('R', hasRB, hasRM, hasRW);

  for (const raw of positionsRaw) {
    const mapped = POS_MAP[raw];
    if (mapped && !['LB', 'RB', 'LW', 'RW', 'LWB', 'RWB', 'LM', 'RM', 'LF', 'RF'].includes(raw)) {
      finalSet.add(mapped);
    }
  }

  if (primary && !finalSet.has(primary)) {
    finalSet.add(primary);
  }

  const finalSecondary = Array.from(finalSet).filter(p => p !== primary);
  
  console.log(`${name}: Primary = ${primary}, Secondary = [${finalSecondary.join(', ')}]`);
}

processPositions('Reece James', ['RB', 'CDM']); 
processPositions('Adrien Truffert', ['LB', 'LM'], ['Wingback +', 'Support']);
processPositions('Matheus Nunes', ['RB', 'CM', 'RM'], ['Attacking wingback +', 'Support']); 
processPositions('Jeremie Frimpong', ['RB', 'RM', 'RW']); 
processPositions('John McGinn', ['RM', 'LM', 'CAM', 'RB']);
processPositions('Patrick Dorgu', ['LM', 'LB', 'RM', 'LW']);

