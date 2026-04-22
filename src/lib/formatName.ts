export function formatPlayerName(
    player?: { name?: string | null; web_name?: string | null } | null,
    format: 'initial_last' | 'full' | 'web_name' | 'first_last_initial' = 'first_last_initial'
): string {
    if (!player || !player.name) return '—';

    // A mapping of full DB names to their preferred mononyms
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

    const dbName = player.name.trim();

    // Direct match check (case-insensitive)
    // We only return a mononym if the DB name specifically matches a known variation or the mononym itself.
    for (const [fullName, mononym] of Object.entries(MONONYM_MAP)) {
        if (dbName.toLowerCase() === fullName.toLowerCase() || 
            dbName.toLowerCase() === mononym.toLowerCase()) {
            return mononym;
        }
    }

    if (format === 'full') {
        return player.name;
    }

    if (format === 'initial_last') {
        const parts = dbName.split(/\s+/);
        if (parts.length === 1) return dbName;

        const firstInitial = parts[0][0].toUpperCase();
        const lastName = parts.slice(1).join(' ');
        return `${firstInitial}. ${lastName}`;
    }

    if (format === 'first_last_initial') {
        const parts = dbName.split(/\s+/);
        if (parts.length === 1) return dbName;

        const firstName = parts[0];
        const lastInitial = parts[parts.length - 1][0].toUpperCase();
        return `${firstName} ${lastInitial}.`;
    }

    // Default to web_name if available, else name
    return player.web_name ?? player.name;
}
