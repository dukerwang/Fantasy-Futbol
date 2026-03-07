export function formatPlayerName(
    player: { name: string; web_name?: string | null },
    format: 'initial_last' | 'full' | 'web_name'
): string {
    const webName = player.web_name?.trim() || "";
    // If a player is universally known by a single word (e.g. Rodri, Casemiro, Alisson)
    // we should just use that word override for all standard formats.
    const isOneWordWebName = webName.length > 0 && webName.split(/\s+/).length === 1;

    if (format === 'full') {
        if (isOneWordWebName) return webName;
        return player.name;
    }

    if (format === 'initial_last') {
        if (isOneWordWebName) return webName;

        const parts = player.name.trim().split(/\s+/);

        // If the player only has one name (e.g., Brazilian players like "Alisson" or "Savinho")
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
