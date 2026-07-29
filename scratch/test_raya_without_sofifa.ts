import { getPlayerDisplayName } from '../src/lib/players/displayName';

const p = {
  name: 'David Raya',
  full_name: 'David Raya Martín',
  web_name: 'Raya',
  sofifa_common_name: undefined,
};

console.log('Without sofifa_common_name:');
console.log('  full:', getPlayerDisplayName(p, 'full'));
console.log('  initial_last:', getPlayerDisplayName(p, 'initial_last'));
console.log('  split:', getPlayerDisplayName(p, 'split'));
