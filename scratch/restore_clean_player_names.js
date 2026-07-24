process.loadEnvFile('.env.local');
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Custom preferred clean names override list for Brazilian / Portuguese / multi-surname players
const PREFERRED_CLEAN_NAMES = {
  'Estêvão Almeida de Oliveira Gonçalves': 'Estêvão',
  'João Pedro Junqueira de Jesus': 'João Pedro',
  "Rodrigo 'Rodri' Hernandez Cascante": 'Rodri',
  'Gabriel dos Santos Magalhães': 'Gabriel Magalhães',
  'Gabriel Fernando de Jesus': 'Gabriel Jesus',
  'Gabriel Martinelli Silva': 'Gabriel Martinelli',
  'Pedro Lomba Neto': 'Pedro Neto',
  'Norberto Bercique Gomes Betuncal': 'Beto',
  'Francisco Evanilson de Lima Barbosa': 'Evanilson',
  'Rúben dos Santos Gato Alves Dias': 'Rúben Dias',
  'Vitor de Oliveira Nunes dos Reis': 'Vitor Reis',
  'Sávio Moreira de Oliveira': 'Savinho',
  'Andrey Nascimento dos Santos': 'Andrey Santos',
  'Diogo Dalot Teixeira': 'Diogo Dalot',
  'Bruno Guimarães Rodriguez Moura': 'Bruno Guimarães',
  'Murillo Costa dos Santos': 'Murillo Costa',
  'Richarlison de Andrade': 'Richarlison',
  'João Victor de Souza Menezes': 'Souza',
  'Igor Julio dos Santos de Paulo': 'Igor Julio',
  'Alisson Becker': 'Alisson',
  'Mateo Joseph Fernández-Regatillo': 'Mateo Joseph',
  'Stefan Bajčetić Maquieira': 'Stefan Bajčetić',
  'Fábio Freitas Gouveia Carvalho': 'Fábio Carvalho',
  'Fábio Ferreira Vieira': 'Fábio Vieira',
  'Rodrigo Muniz Carvalho': 'Rodrigo Muniz',
  'Emersonn Correia da Silva': 'Emersonn',
  'David Raya Martín': 'David Raya',
  'Jefferson Lerma Solís': 'Jefferson Lerma',
  'Alejandro Garnacho Ferreyra': 'Alejandro Garnacho',
  'Kepa Arrizabalaga Revuelta': 'Kepa',
  'Emiliano Buendía Stati': 'Emiliano Buendía',
  'Marcos Senesi Barón': 'Marcos Senesi',
  'Yéremy Pino Santos': 'Yéremy Pino',
  'Benoît Badiashile Mukinayi': 'Benoît Badiashile',
  'Levi Samuels Colwill': 'Levi Colwill',
  'Moisés Caicedo Corozo': 'Moisés Caicedo',
  'Matheus França de Oliveira': 'Matheus França',
  'Julio Soler Barreto': 'Julio Soler',
  'Carlos Alcaraz Durán': 'Carlos Alcaraz',
  'Jorge Cuenca Barreno': 'Jorge Cuenca',
  'Julián Araujo Zúñiga': 'Julián Araujo',
  'Dário Luís Essugo': 'Dário Essugo',
  'Nico González Iglesias': 'Nico González',
  'Bruno Borges Fernandes': 'Bruno Fernandes',
  'Dominic Solanke-Mitchell': 'Dominic Solanke',
  'Mikel Merino Zazón': 'Mikel Merino',
  'Robert Lynch Sánchez': 'Robert Sánchez',
  'Ezri Konsa Ngoyo': 'Ezri Konsa',
  'Emiliano Martínez Romero': 'Emiliano Martínez',
  'Daniel Muñoz Mejía': 'Daniel Muñoz',
  'Martín Zubimendi Ibáñez': 'Martín Zubimendi',
  'Manuel Ugarte Ribeiro': 'Manuel Ugarte',
  'John Victor Maciel Furtado': 'John Victor',
  'Matheus Santos Carneiro da Cunha': 'Matheus Cunha'
};

async function restoreCleanPlayerNames() {
  console.log('--- RESTORING CLEAN DISPLAY NAMES IN GAFFA DB ---');

  const { data: dbPlayers } = await supabase
    .from('players')
    .select('id, name, web_name, full_name')
    .eq('is_active', true);

  let updatedCount = 0;

  for (const p of dbPlayers) {
    let targetName = null;

    // Check preferred override map
    if (PREFERRED_CLEAN_NAMES[p.name]) {
      targetName = PREFERRED_CLEAN_NAMES[p.name];
    } else if (PREFERRED_CLEAN_NAMES[p.full_name]) {
      targetName = PREFERRED_CLEAN_NAMES[p.full_name];
    } else if (p.name && p.name.split(' ').length > 3 && p.web_name) {
      // If DB name has 4+ words (long legal name), simplify to web_name or clean name
      targetName = p.web_name;
    }

    if (targetName && targetName !== p.name) {
      // Preserve the full legal name in full_name column
      await supabase
        .from('players')
        .update({
          full_name: p.full_name || p.name,
          name: targetName
        })
        .eq('id', p.id);

      console.log(`  -> Restored clean name: "${p.name}" -> "${targetName}"`);
      updatedCount++;
    }
  }

  console.log(`\nSuccessfully restored ${updatedCount} clean display names in Gaffa DB!`);
  console.log('✅ ALL CLEAN DISPLAY NAMES RESTORED!');
}

restoreCleanPlayerNames().catch(console.error);
