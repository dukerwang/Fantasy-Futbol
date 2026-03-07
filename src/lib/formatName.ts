export function formatPlayerName(
    player: { name: string; web_name?: string | null },
    format: 'initial_last' | 'full' | 'web_name'
): string {
    const webName = player.web_name?.trim() || "";
    const parts = player.name.trim().split(/\s+/);
    const lastWord = parts[parts.length - 1].toLowerCase();

    // A player is mononymous if their FPL web_name is exactly 1 word, does not contain initial dots, 
    // and does NOT match the last word of their legal full name. (e.g. Alisson, Rodri, Casemiro, Savinho).
    const isMononym = webName.length > 0 &&
        webName.split(/\s+/).length === 1 &&
        !webName.includes('.') &&
        webName.toLowerCase() !== lastWord;

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
