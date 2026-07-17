'use client';

import { useId } from 'react';
import { CrestConfig } from './types';
import { SHIELDS } from './shields';
import { DIVISIONS } from './divisions';
import { CURATED_ICONS } from './icons';
import styles from './crest.module.css';

interface CrestBadgeProps {
  config: CrestConfig | null | undefined;
  size?: number;
  teamName?: string | null;
}

export default function CrestBadge({ config, size = 40, teamName }: CrestBadgeProps) {
  const reactId = useId();
  const clipId = `crest-clip-${reactId.replace(/:/g, '')}`;

  // Fallback credentials
  const displayName = teamName || 'My Club';
  const initials = (() => {
    const parts = displayName.trim().split(/\s+/);
    if (parts.length >= 2 && parts[0] && parts[1]) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return displayName.trim().substring(0, 2).toUpperCase();
  })();

  // 1. Render Fallback Badge (Classic Gaffa Green Shield with Cream Initials)
  if (!config) {
    const defaultShield = SHIELDS[0]; // Classic
    return (
      <div 
        className={styles.badgeContainer} 
        style={{ width: size, height: Math.round(size * 1.2) }}
      >
        <svg
          viewBox="0 0 100 120"
          className={styles.badgeSvg}
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d={defaultShield.path}
            fill="#146B40"
            stroke="#F7F3ED"
            strokeWidth="3.5"
          />
          <text
            x="50"
            y="65"
            fill="#F7F3ED"
            className={styles.textOverlay}
            style={{ fontSize: '26px' }}
          >
            {initials}
          </text>
        </svg>
      </div>
    );
  }

  // 2. Render Custom Vector Crest
  const shield = SHIELDS.find(s => s.id === config.shape) || SHIELDS[0];
  const division = DIVISIONS.find(d => d.id === config.division) || DIVISIONS[0];
  const iconObj = config.icon ? CURATED_ICONS.find(i => i.id === config.icon) : null;

  // Render division HTML layers
  const divisionHtml = division.renderLayers(config.secondaryColor, config.borderColor);

  return (
    <div 
      className={styles.badgeContainer} 
      style={{ width: size, height: Math.round(size * 1.2) }}
    >
      <svg
        viewBox="0 0 100 120"
        className={styles.badgeSvg}
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <clipPath id={clipId}>
            <path d={shield.path} />
          </clipPath>
        </defs>

        {/* Shield Content (Clipped) */}
        <g clipPath={`url(#${clipId})`}>
          {/* Primary Base Color */}
          <rect 
            x="0" 
            y="0" 
            width="100" 
            height="120" 
            fill={config.primaryColor} 
            className={styles.shieldBase}
          />
          
          {/* Division Layers */}
          {divisionHtml && (
            <g 
              dangerouslySetInnerHTML={{ __html: divisionHtml }} 
              className={styles.divisionLayer}
            />
          )}
        </g>

        {/* Shield Border Ring */}
        <path
          d={shield.path}
          fill="none"
          stroke={config.borderColor}
          strokeWidth="3.5"
          className={styles.shieldBase}
        />

        {/* Centered Motif Icon */}
        {iconObj && (() => {
          const iconSize = config.showText ? 36 : 48;
          const translateX = 50 - (iconSize / 2);
          const translateY = config.showText ? 26 : 60 - (iconSize / 2);
          const iconViewBox = iconObj.viewBox || '0 0 50 50';
          return (
            <svg 
              x={translateX}
              y={translateY}
              width={iconSize}
              height={iconSize}
              viewBox={iconViewBox}
              className={styles.iconLayer}
            >
              <path 
                d={iconObj.path} 
                fill={config.iconColor} 
              />
            </svg>
          );
        })()}

        {/* Text Overlay */}
        {config.showText && (
          <text
            x="50"
            y={iconObj ? 88 : 61}
            fill={config.textColor}
            className={styles.textOverlay}
            style={{ fontSize: iconObj ? '16px' : '26px' }}
          >
            {initials}
          </text>
        )}
      </svg>
    </div>
  );
}
