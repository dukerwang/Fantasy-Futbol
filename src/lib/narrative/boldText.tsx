import React from 'react';

/**
 * Safely parses markdown double-asterisks (e.g. **text**) and returns
 * React elements with <strong> tags, avoiding literal asterisks in the UI.
 */
export function renderBoldedText(text: string) {
  if (!text) return null;
  const parts = text.split(/\*\*(.*?)\*\*/g);
  return parts.map((part, i) => {
    if (i % 2 === 1) {
      return <strong key={i}>{part}</strong>;
    }
    return part;
  });
}
