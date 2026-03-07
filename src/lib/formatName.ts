export function formatPlayerName(
    player: { name: string; web_name?: string | null },
    format: 'initial_last' | 'full' | 'web_name'
): string {
    const KNOWN_MONONYMS: Record<string, string> = {
        "Rodrigo 'Rodri' Hernandez Cascante": "Rodri",
        "Carlos Henrique Casimiro": "Casemiro",
        "Alisson": "Alisson", // Alisson's name in DB is 'Alisson'
        "Ederson Santana de Moraes": "Ederson",
        "Sávio Moreira de Oliveira": "Savinho",
        "Gabriel Magalhães": "Gabriel",
        "Antony Matheus dos Santos": "Antony",
        "Richarlison de Andrade": "Richarlison",
        "Diogo Jota": "Jota",
        "Luiz Díaz": "Díaz",
        "Pedro Porro": "Porro"
    };

    // A player is mononymous if they are explicitly registered in our known overrides map
    let isMononym = false;
    let webName = player.web_name?.trim() || "";

    for (const [fullName, mononym] of Object.entries(KNOWN_MONONYMS)) {
        if (player.name.includes(fullName) || player.name === fullName) {
            isMononym = true;
            webName = mononym;
            break;
        }
    }

    const parts = player.name.trim().split(/\s+/);
    const lastWord = parts[parts.length - 1].toLowerCase();

    if (format === 'full') {
        if (isMononym) return webName;
        return player.name;
    }

    if (format === 'initial_last') {
        if (isMononym) return webName;

        // If the player only has one name (e.g., Casemiro might just be stored as "Casemiro")
        if (parts.length === 1) {
            return player.name;
        }

        // For typical names like "Nick Pope", "Bruno Fernandes"
        const firstInitial = parts[0][0].toUpperCase();

        // Some players have multi-word last names, but typically in English football
        // the last word is fine, or we use everything after the first name.
        // Let's use everything after the first name to be safe with names like "van Dijk".
        const lastName = parts.slice(1).join(' ');

        return `${firstInitial}. ${lastName}`;
    }

    // Fallback to exactly what FPL uses for their shirt or default display.
    return player.web_name ?? player.name;
}
