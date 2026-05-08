export function formatPlayerName(
    player?: { name?: string | null; web_name?: string | null; full_name?: string | null } | null,
    format: 'initial_last' | 'full' | 'web_name' | 'first_last_initial' = 'initial_last'
): string {
    if (!player) return '—';
    const sourceName = player.full_name || player.name;
    
    // A mapping of full DB names or web names to their preferred mononyms
    const MONONYM_MAP: Record<string, string> = {
        "Rodrigo 'Rodri' Hernandez Cascante": "Rodri",
        "Rodrigo Hernandez Cascante": "Rodri",
        "Rodri": "Rodri",
        "Carlos Henrique Casimiro": "Casemiro",
        "Casemiro": "Casemiro",
        "Alisson Ramses Becker": "Alisson",
        "Alisson": "Alisson",
        "Ederson Santana de Moraes": "Ederson",
        "Ederson": "Ederson",
        "Sávio Moreira de Oliveira": "Savinho",
        "Sávio Moreira": "Savinho",
        "Savio Moreira": "Savinho",
        "Sávio": "Savinho",
        "Savio": "Savinho",
        "Savinho": "Savinho",
        "Gabriel Magalhães": "Gabriel",
        "Gabriel": "Gabriel",
        "Antony Matheus dos Santos": "Antony",
        "Antony": "Antony",
        "Richarlison de Andrade": "Richarlison",
        "Richarlison": "Richarlison",
        "Neto": "Neto",
        "Diogo Jota": "Jota",
        "Lucrecio de Castro": "Neto",
        "Luiz Díaz": "Díaz",
        "Pedro Porro": "Porro"
    };

    const webName = player.web_name?.trim() || '';
    const dbName = sourceName?.trim() || webName;

    if (!dbName) return '—';

    // 1. Check mononyms first (case-insensitive)
    for (const [fullName, mononym] of Object.entries(MONONYM_MAP)) {
        if (dbName.toLowerCase() === fullName.toLowerCase() || 
            webName.toLowerCase() === fullName.toLowerCase() ||
            dbName.toLowerCase() === mononym.toLowerCase()) {
            return mononym;
        }
    }

    if (format === 'full') return sourceName || webName;
    if (format === 'web_name') return webName || dbName;

    if (format === 'initial_last') {
        // If it's already a name with an initial like "B. Fernandes", just return it
        if (/^[A-Z]\.\s+[A-Z]/i.test(dbName)) return dbName;

        const parts = dbName.split(/\s+/);
        if (parts.length === 1) return dbName;

        const firstInitial = parts[0][0].toUpperCase();
        
        // Filter out any parts that are already initials (like "B.") to avoid "B. B. Fernandes"
        // and join the rest as the last name.
        const lastNameParts = parts.slice(1).filter(p => !/^[A-Z]\.$/i.test(p));
        const lastName = lastNameParts.join(' ');
        
        return `${firstInitial}. ${lastName}`;
    }

    // Default fallthrough / legacy 'first_last_initial' behavior
    return webName || dbName;
}
