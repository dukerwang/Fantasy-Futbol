'use client';

import { useState } from 'react';
import { CrestConfig } from './types';
import { SHIELDS } from './shields';
import { DIVISIONS } from './divisions';
import { CURATED_ICONS } from './icons';
import { CREST_PALETTE } from './palette';
import CrestBadge from './CrestBadge';
import styles from './crest.module.css';

interface CrestBuilderProps {
  initialConfig?: CrestConfig | null;
  abbreviation: string;
  teamName: string;
  onSave: (config: CrestConfig) => void;
  onCancel?: () => void;
  saveLabel?: string;
  loading?: boolean;
}

function getRandomConfig(): CrestConfig {
  const randomShape = SHIELDS[Math.floor(Math.random() * SHIELDS.length)].id;
  const randomDivision = DIVISIONS[Math.floor(Math.random() * DIVISIONS.length)].id;
  
  // Pick primary, secondary, border colors from palette
  const pCol = CREST_PALETTE[Math.floor(Math.random() * 8)].hex; // Prefer deep tones for primary
  let sCol = CREST_PALETTE[Math.floor(Math.random() * CREST_PALETTE.length)].hex;
  while (sCol === pCol) {
    sCol = CREST_PALETTE[Math.floor(Math.random() * CREST_PALETTE.length)].hex;
  }
  let bCol = CREST_PALETTE[Math.floor(Math.random() * CREST_PALETTE.length)].hex;
  while (bCol === pCol || bCol === sCol) {
    bCol = CREST_PALETTE[Math.floor(Math.random() * CREST_PALETTE.length)].hex;
  }

  // Icons
  const randomIcon = Math.random() > 0.15 
    ? CURATED_ICONS[Math.floor(Math.random() * CURATED_ICONS.length)].id 
    : null;
  
  // Make icon color contrast with secondary
  let iconCol = CREST_PALETTE[Math.floor(Math.random() * CREST_PALETTE.length)].hex;
  while (iconCol === sCol) {
    iconCol = CREST_PALETTE[Math.floor(Math.random() * CREST_PALETTE.length)].hex;
  }

  // Text overlay
  const showText = Math.random() > 0.3;
  let textCol = '#FFFFFF';
  if (showText) {
    textCol = CREST_PALETTE[Math.floor(Math.random() * CREST_PALETTE.length)].hex;
  }

  return {
    shape: randomShape,
    division: randomDivision,
    primaryColor: pCol,
    secondaryColor: sCol,
    borderColor: bCol,
    icon: randomIcon,
    iconColor: iconCol,
    showText,
    textColor: textCol
  };
}

export default function CrestBuilder({
  initialConfig,
  abbreviation,
  teamName,
  onSave,
  onCancel,
  saveLabel = 'Save Crest Design',
  loading = false
}: CrestBuilderProps) {
  const [config, setConfig] = useState<CrestConfig>(() => {
    return initialConfig || getRandomConfig();
  });

  const handleRandomise = () => {
    setConfig(getRandomConfig());
  };

  const updateField = <K extends keyof CrestConfig>(field: K, value: CrestConfig[K]) => {
    setConfig(prev => ({
      ...prev,
      [field]: value
    }));
  };

  return (
    <div className={styles.builderLayout}>
      {/* Left side: Controls */}
      <div className={styles.controlsCol}>
        <div className={styles.headerRow}>
          <h2 className={styles.builderTitle}>Design your Crest</h2>
          <button 
            type="button" 
            onClick={handleRandomise} 
            className={styles.shuffleBtn}
          >
            <span>🎲</span> Shuffle Design
          </button>
        </div>

        {/* 1. Shield Shape */}
        <div className={styles.settingsGroup}>
          <span className={styles.groupLabel}>1. Shield Shape</span>
          <div className={styles.optionsGrid}>
            {SHIELDS.map((shield) => (
              <button
                key={shield.id}
                type="button"
                className={`${styles.optionBtn} ${config.shape === shield.id ? styles.optionBtnActive : ''}`}
                onClick={() => updateField('shape', shield.id)}
                title={shield.label}
              >
                <svg viewBox="0 0 100 120" className={styles.optionBtnSvg}>
                  <path d={shield.path} fill="currentColor" />
                </svg>
              </button>
            ))}
          </div>
        </div>

        {/* 2. Shield Pattern / Division */}
        <div className={styles.settingsGroup}>
          <span className={styles.groupLabel}>2. Division Pattern</span>
          <div className={styles.optionsGrid}>
            {DIVISIONS.map((div) => (
              <button
                key={div.id}
                type="button"
                className={`${styles.optionBtn} ${config.division === div.id ? styles.optionBtnActive : ''}`}
                onClick={() => updateField('division', div.id)}
                title={div.label}
              >
                <svg viewBox="0 0 100 120" className={styles.optionBtnSvg}>
                  <defs>
                    <clipPath id={`min-clip-${div.id}`}>
                      <path d={SHIELDS[0].path} />
                    </clipPath>
                  </defs>
                  <g clipPath={`url(#min-clip-${div.id})`}>
                    <rect width="100" height="120" fill="#E8E2D5" />
                    <g dangerouslySetInnerHTML={{ __html: div.renderLayers('#8C6212', '#4E2A1E') }} />
                  </g>
                  <path d={SHIELDS[0].path} fill="none" stroke="currentColor" strokeWidth="4" />
                </svg>
              </button>
            ))}
          </div>
        </div>

        {/* 3. Color Palette */}
        <div className={styles.settingsGroup}>
          <span className={styles.groupLabel}>3. Colors</span>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {/* Primary */}
            <div>
              <div style={{ fontSize: '12px', fontWeight: 600, marginBottom: '6px', color: 'var(--color-text-secondary)' }}>
                Primary (Base Shield)
              </div>
              <div className={styles.colorGrid}>
                {CREST_PALETTE.map((c) => (
                  <button
                    key={`p-${c.hex}`}
                    type="button"
                    className={`${styles.colorBtn} ${config.primaryColor === c.hex ? styles.colorBtnActive : ''}`}
                    style={{ background: c.hex }}
                    onClick={() => updateField('primaryColor', c.hex)}
                    title={c.label}
                  />
                ))}
              </div>
            </div>

            {/* Secondary */}
            {config.division !== 'solid' && (
              <div>
                <div style={{ fontSize: '12px', fontWeight: 600, marginBottom: '6px', color: 'var(--color-text-secondary)' }}>
                  Secondary (Pattern Details)
                </div>
                <div className={styles.colorGrid}>
                  {CREST_PALETTE.map((c) => (
                    <button
                      key={`s-${c.hex}`}
                      type="button"
                      className={`${styles.colorBtn} ${config.secondaryColor === c.hex ? styles.colorBtnActive : ''}`}
                      style={{ background: c.hex }}
                      onClick={() => updateField('secondaryColor', c.hex)}
                      title={c.label}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Border */}
            <div>
              <div style={{ fontSize: '12px', fontWeight: 600, marginBottom: '6px', color: 'var(--color-text-secondary)' }}>
                Shield Border
              </div>
              <div className={styles.colorGrid}>
                {CREST_PALETTE.map((c) => (
                  <button
                    key={`b-${c.hex}`}
                    type="button"
                    className={`${styles.colorBtn} ${config.borderColor === c.hex ? styles.colorBtnActive : ''}`}
                    style={{ background: c.hex }}
                    onClick={() => updateField('borderColor', c.hex)}
                    title={c.label}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* 4. Central Motif Icon */}
        <div className={styles.settingsGroup}>
          <span className={styles.groupLabel}>4. Central Motif</span>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div className={styles.iconGrid}>
              {/* None option */}
              <button
                type="button"
                className={`${styles.optionBtn} ${config.icon === null ? styles.optionBtnActive : ''}`}
                onClick={() => updateField('icon', null)}
                title="No motif"
                style={{ fontSize: '11px', fontWeight: 'bold' }}
              >
                None
              </button>

              {CURATED_ICONS.map((icon) => (
                <button
                  key={icon.id}
                  type="button"
                  className={`${styles.optionBtn} ${config.icon === icon.id ? styles.optionBtnActive : ''}`}
                  onClick={() => updateField('icon', icon.id)}
                  title={icon.label}
                >
                  <svg viewBox={icon.viewBox} className={styles.optionBtnSvg}>
                    <path d={icon.path} fill="currentColor" />
                  </svg>
                </button>
              ))}
            </div>

            {config.icon && (
              <div>
                <div style={{ fontSize: '12px', fontWeight: 600, marginBottom: '6px', color: 'var(--color-text-secondary)' }}>
                  Motif Color
                </div>
                <div className={styles.colorGrid}>
                  {CREST_PALETTE.map((c) => (
                    <button
                      key={`i-col-${c.hex}`}
                      type="button"
                      className={`${styles.colorBtn} ${config.iconColor === c.hex ? styles.colorBtnActive : ''}`}
                      style={{ background: c.hex }}
                      onClick={() => updateField('iconColor', c.hex)}
                      title={c.label}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* 5. Typography / Abbreviation */}
        <div className={styles.settingsGroup}>
          <span className={styles.groupLabel}>5. Typography</span>
          
          <div className={styles.textToggleRow}>
            <span className={styles.toggleLabel}>Display Abbreviation ({abbreviation})</span>
            <label className={styles.switch}>
              <input
                type="checkbox"
                checked={config.showText}
                onChange={(e) => updateField('showText', e.target.checked)}
              />
              <span className={styles.slider} />
            </label>
          </div>

          {config.showText && (
            <div>
              <div style={{ fontSize: '12px', fontWeight: 600, marginBottom: '6px', color: 'var(--color-text-secondary)' }}>
                Text Color
              </div>
              <div className={styles.colorGrid}>
                {CREST_PALETTE.map((c) => (
                  <button
                    key={`t-col-${c.hex}`}
                    type="button"
                    className={`${styles.colorBtn} ${config.textColor === c.hex ? styles.colorBtnActive : ''}`}
                    style={{ background: c.hex }}
                    onClick={() => updateField('textColor', c.hex)}
                    title={c.label}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Right side: Live Preview */}
      <div className={styles.previewCol}>
        <span className={styles.groupLabel}>Live Crest Preview</span>
        
        <div className={styles.previewBadgeFrame}>
          <CrestBadge config={config} size={160} teamName={teamName} />
        </div>

        <div className={styles.previewDetails}>
          <h3 className={styles.previewTeamName}>{teamName || 'My Club'}</h3>
          <span className={styles.previewAbbr}>{abbreviation || 'CLUB'}</span>
          <div className={styles.previewDivider} />
          <span style={{ fontSize: '12px', color: 'var(--color-accent-green)', fontWeight: 600 }}>
            SVG Vector Crest
          </span>
        </div>

        <div className={styles.actionButtons}>
          <button
            type="button"
            className={styles.submitBtn}
            onClick={() => onSave(config)}
            disabled={loading}
          >
            {loading ? 'Saving Design...' : saveLabel}
          </button>
          
          {onCancel && (
            <button
              type="button"
              className={styles.secondaryBtn}
              onClick={onCancel}
              disabled={loading}
            >
              Cancel
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
