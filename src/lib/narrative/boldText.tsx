import React from 'react';

/**
 * Safely parses markdown double-asterisks (e.g. **text**) and returns
 * React elements. If the bolded portion starts with "p:PLAYER_ID:DISPLAY_NAME",
 * it renders it as a clickable button to view the player's card details.
 */
export function renderBoldedText(
  text: string,
  onPlayerClick?: (playerId: string) => void
) {
  if (!text) return null;
  const parts = text.split(/\*\*(.*?)\*\*/g);
  return parts.map((part, i) => {
    if (i % 2 === 1) {
      if (part.startsWith('p:')) {
        const [, playerId, displayName] = part.split(':');
        if (playerId && displayName) {
          if (onPlayerClick) {
            return (
              <button
                key={i}
                onClick={() => onPlayerClick(playerId)}
                className="playercard-clickable-btn"
              >
                {displayName}
              </button>
            );
          }
          // Fallback if no click handler passed: just bold it
          return <strong key={i}>{displayName}</strong>;
        }
      }
      return <strong key={i}>{part}</strong>;
    }
    return part;
  });
}
