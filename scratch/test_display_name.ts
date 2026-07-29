import { getPlayerDisplayName } from '../src/lib/players/displayName';

const testCases = [
  // SoFIFA common names
  { name: 'Norberto Bercique Gomes Betuncal', web_name: 'Beto', sofifa_common_name: 'Beto', expectedFull: 'Beto', expectedInitial: 'Beto' },
  { name: 'Gabriel Fernando de Jesus', web_name: 'G.Jesus', sofifa_common_name: 'Gabriel Jesus', expectedFull: 'Gabriel Jesus', expectedInitial: 'G. Jesus' },
  { name: 'David Raya Martin', web_name: 'Raya', sofifa_common_name: 'David Raya', expectedFull: 'David Raya', expectedInitial: 'D. Raya' },
  { name: 'Pedro Antonio Porro Sauceda', web_name: 'Pedro Porro', sofifa_common_name: 'Pedro Porro', expectedFull: 'Pedro Porro', expectedInitial: 'P. Porro' },
  { name: 'Rodrigo Hernandez Cascante', web_name: 'Rodri', sofifa_common_name: 'Rodri', expectedFull: 'Rodri', expectedInitial: 'Rodri' },
  { name: 'Diogo Jota', web_name: 'Jota', sofifa_common_name: 'Jota', expectedFull: 'Jota', expectedInitial: 'Jota' },
  { name: 'Francisco Evanilson de Lima Barbosa', web_name: 'Evanilson', sofifa_common_name: 'Evanilson', expectedFull: 'Evanilson', expectedInitial: 'Evanilson' },
  { name: 'Estêvão Almeida de Oliveira Gonçalves', web_name: 'Estêvão', sofifa_common_name: 'Estêvão', expectedFull: 'Estêvão', expectedInitial: 'Estêvão' },
  
  // Fallbacks when sofifa_common_name is null
  { name: 'Erling Haaland', web_name: 'Haaland', sofifa_common_name: null, expectedFull: 'Erling Haaland', expectedInitial: 'E. Haaland' },
  { name: 'Gabriel Martinelli Silva', web_name: 'Martinelli', sofifa_common_name: null, expectedFull: 'Gabriel Martinelli', expectedInitial: 'G. Martinelli' },
];

console.log('--- Testing getPlayerDisplayName with SoFIFA Common Names ---');
let allPassed = true;
for (const tc of testCases) {
  const full = getPlayerDisplayName(tc, 'full');
  const initial = getPlayerDisplayName(tc, 'initial_last');

  if (full !== tc.expectedFull || initial !== tc.expectedInitial) {
    console.error(`❌ FAIL for ${tc.name}: got full="${full}", initial="${initial}" — expected full="${tc.expectedFull}", initial="${tc.expectedInitial}"`);
    allPassed = false;
  } else {
    console.log(`✅ PASS: ${tc.name} -> full: "${full}", initial: "${initial}"`);
  }
}

if (allPassed) {
  console.log('\n🎉 ALL DISPLAY NAME TESTS PASSED!');
} else {
  process.exit(1);
}
