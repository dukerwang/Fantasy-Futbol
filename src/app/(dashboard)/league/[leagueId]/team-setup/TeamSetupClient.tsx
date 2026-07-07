'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import styles from './teamSetup.module.css';

interface Props {
  leagueId: string;
  leagueName: string;
  team: {
    id: string;
    team_name: string;
    abbreviation: string | null;
    logo_url: string | null;
  };
  username: string;
}

function getInitials(name: string, abbr: string | null): string {
  if (abbr && abbr.trim()) return abbr.trim().substring(0, 4).toUpperCase();
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2 && parts[0] && parts[1]) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return name.trim().substring(0, 2).toUpperCase();
}

function getHslColor(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const h = Math.abs(hash) % 360;
  return `linear-gradient(135deg, hsl(${h}, 50%, 45%), hsl(${(h + 40) % 360}, 55%, 35%))`;
}

export default function TeamSetupClient({ leagueId, leagueName, team, username }: Props) {
  const router = useRouter();
  const [name, setName] = useState(team.team_name);
  const [abbr, setAbbr] = useState(team.abbreviation ?? '');
  const [logo, setLogo] = useState(team.logo_url ?? '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Profile picture upload & cropper states
  const [imageToCrop, setImageToCrop] = useState<string | null>(null);
  const [cropZoom, setCropZoom] = useState(1);
  const [cropX, setCropX] = useState(0);
  const [cropY, setCropY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [naturalWidth, setNaturalWidth] = useState(0);
  const [naturalHeight, setNaturalHeight] = useState(0);

  const supabase = createClient();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setError('Please select a valid image file (PNG/JPEG)');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setError('File exceeds 5MB size limit.');
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      if (event.target?.result) {
        setImageToCrop(event.target.result as string);
        setCropZoom(1);
        setCropX(0);
        setCropY(0);
        setNaturalWidth(0);
        setNaturalHeight(0);
        setError(null);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleApplyCrop = () => {
    if (!imageToCrop) return;

    const img = new Image();
    img.src = imageToCrop;
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 150;
      canvas.height = 150;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, 150, 150);

        const scale = cropZoom * (150 / 200);
        const cx = 75;
        const cy = 75;

        ctx.save();
        ctx.translate(cx + cropX * (150 / 200), cy + cropY * (150 / 200));
        ctx.scale(scale, scale);

        const imgRatio = img.width / img.height;
        let dw, dh;
        if (imgRatio >= 1) {
          dh = 200;
          dw = 200 * imgRatio;
        } else {
          dw = 200;
          dh = 200 / imgRatio;
        }

        ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh);
        ctx.restore();

        const base64 = canvas.toDataURL('image/jpeg', 0.85);
        setLogo(base64);
        setImageToCrop(null);
      }
    };
  };

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();

    if (!name.trim()) {
      setError('Team name is required');
      return;
    }

    if (!abbr.trim()) {
      setError('Team abbreviation is required');
      return;
    }

    const abbrClean = abbr.trim().substring(0, 4).toUpperCase();
    if (abbrClean.length < 2) {
      setError('Abbreviation must be at least 2 characters');
      return;
    }

    if (!/^[A-Z0-9]+$/.test(abbrClean)) {
      setError('Abbreviation must be alphanumeric (letters and numbers only)');
      return;
    }

    setLoading(true);
    setError(null);

    const { error: updateErr } = await supabase
      .from('teams')
      .update({
        team_name: name.trim(),
        abbreviation: abbrClean,
        logo_url: logo.trim() || null,
      })
      .eq('id', team.id);

    if (updateErr) {
      setError(updateErr.message);
      setLoading(false);
      return;
    }

    setLoading(false);
    router.push(`/league/${leagueId}`);
    router.refresh();
  }

  const fallbackBg = getHslColor(team.id);
  const initials = getInitials(name || 'My Club', abbr);

  return (
    <div className={styles.setupLayout}>
      <div className={styles.setupContainer}>
        {/* Left Form Panel */}
        <div className={styles.setupPanel}>
          <div className={styles.panelHeader}>
            <h1 className={styles.panelTitle}>Club Credentials</h1>
            <p className={styles.panelSubtitle}>
              Configure your credentials for <strong>{leagueName}</strong> before entering the war room.
            </p>
          </div>

          <form onSubmit={handleSave} className={styles.form}>
            {/* Club Name */}
            <div className={styles.inputGroup}>
              <label className={styles.inputLabel} htmlFor="club-name">
                Club Name <span className={styles.requiredAsterisk}>*</span>
              </label>
              <input
                id="club-name"
                type="text"
                className={styles.textInput}
                placeholder="e.g. Duke's FC"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                maxLength={20}
                autoComplete="off"
              />
              <div className={styles.inputFooter}>
                <p className={styles.inputHint}>Your full franchise name displayed across the league.</p>
                <span className={`${styles.charCount} ${name.length >= 18 ? styles.charCountWarn : ''}`}>
                  {name.length} / 20
                </span>
              </div>
            </div>

            {/* Abbreviation */}
            <div className={styles.inputGroup}>
              <label className={styles.inputLabel} htmlFor="club-abbr">
                Abbreviation <span className={styles.requiredAsterisk}>*</span>
              </label>
              <input
                id="club-abbr"
                type="text"
                className={styles.textInput}
                placeholder="e.g. DUD (2-4 characters)"
                value={abbr}
                onChange={(e) => setAbbr(e.target.value.toUpperCase())}
                required
                maxLength={4}
                autoComplete="off"
              />
              <p className={styles.inputHint}>Short letters used for lists, fixtures, and dashboards.</p>
            </div>

            {/* Logo Crest Customization */}
            <div className={styles.inputGroup}>
              <label className={styles.inputLabel}>Club Logo or Crest</label>
              
              {imageToCrop ? (
                <div className={styles.cropperWorkspace}>
                  <p className={styles.cropperHint}>Drag to center your crest, then adjust zoom.</p>
                  
                  <div
                    className={styles.cropperContainer}
                    onMouseDown={(e) => {
                      setIsDragging(true);
                      setDragStart({ x: e.clientX - cropX, y: e.clientY - cropY });
                    }}
                    onMouseMove={(e) => {
                      if (!isDragging) return;
                      setCropX(e.clientX - dragStart.x);
                      setCropY(e.clientY - dragStart.y);
                    }}
                    onMouseUp={() => setIsDragging(false)}
                    onMouseLeave={() => setIsDragging(false)}
                    onTouchStart={(e) => {
                      if (e.touches.length === 1 && e.touches[0]) {
                        setIsDragging(true);
                        setDragStart({ x: e.touches[0].clientX - cropX, y: e.touches[0].clientY - cropY });
                      }
                    }}
                    onTouchMove={(e) => {
                      if (!isDragging || e.touches.length !== 1 || !e.touches[0]) return;
                      setCropX(e.touches[0].clientX - dragStart.x);
                      setCropY(e.touches[0].clientY - dragStart.y);
                    }}
                    onTouchEnd={() => setIsDragging(false)}
                  >
                    <img
                      src={imageToCrop}
                      alt="Crop preview"
                      className={styles.cropperImage}
                      onLoad={(e) => {
                        const img = e.currentTarget;
                        setNaturalWidth(img.naturalWidth);
                        setNaturalHeight(img.naturalHeight);
                      }}
                      style={{
                        width: naturalWidth > 0 && naturalHeight > 0 
                          ? `${(naturalWidth / naturalHeight) >= 1 ? 200 * (naturalWidth / naturalHeight) : 200}px`
                          : '200px',
                        height: naturalWidth > 0 && naturalHeight > 0
                          ? `${(naturalWidth / naturalHeight) >= 1 ? 200 : 200 / (naturalWidth / naturalHeight)}px`
                          : '200px',
                        transform: `translate(${cropX}px, ${cropY}px) scale(${cropZoom})`,
                      }}
                      draggable={false}
                    />
                    <div className={styles.cropperOverlay} />
                  </div>

                  <div className={styles.cropperControls}>
                    <div className={styles.zoomRow}>
                      <span className={styles.zoomLabel}>Zoom:</span>
                      <input
                        type="range"
                        min="1"
                        max="3"
                        step="0.05"
                        value={cropZoom}
                        onChange={(e) => setCropZoom(parseFloat(e.target.value))}
                        className={styles.zoomSlider}
                      />
                    </div>
                    <div className={styles.cropperButtons}>
                      <button
                        type="button"
                        className={styles.cropCancelBtn}
                        onClick={() => setImageToCrop(null)}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        className={styles.cropApplyBtn}
                        onClick={handleApplyCrop}
                      >
                        Apply Crop
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className={styles.uploadArea}>
                  <div className={styles.uploadPreviewRow}>
                    <div className={styles.uploadAvatarPreview}>
                      {logo ? (
                        <img src={logo} alt="Preview" className={styles.previewLogoImg} />
                      ) : (
                        <div className={styles.previewLogoFallback}>
                          {initials}
                        </div>
                      )}
                    </div>
                    <div className={styles.uploadBtnCol}>
                      <label className={styles.fileUploadLabel}>
                        Upload Photo...
                        <input
                          type="file"
                          accept="image/png, image/jpeg, image/jpg"
                          onChange={handleFileChange}
                          className={styles.hiddenFileInput}
                        />
                      </label>
                      <span className={styles.uploadRequirements}>
                        Supports PNG, JPG, or JPEG. Max 5MB.
                      </span>
                      {logo && (
                        <button
                          type="button"
                          onClick={() => setLogo('')}
                          className={styles.removeLogoBtn}
                        >
                          Remove Custom Crest
                        </button>
                      )}
                    </div>
                  </div>
                  
                  <div className={styles.urlInputFallback}>
                    <label className={styles.urlLabel} htmlFor="crest-url">Or enter direct Image URL:</label>
                    <input
                      id="crest-url"
                      type="url"
                      className={styles.textInput}
                      placeholder="e.g. https://domain.com/crest.png"
                      value={logo}
                      onChange={(e) => setLogo(e.target.value)}
                      autoComplete="off"
                    />
                  </div>
                </div>
              )}
            </div>

            {error && <p className={styles.errorText}>{error}</p>}

            <button type="submit" className={styles.submitBtn} disabled={loading}>
              {loading ? 'Registering Club Credentials…' : 'Register Club & Enter League →'}
            </button>
          </form>
        </div>

        {/* Right Preview Panel */}
        <div className={styles.previewPanel}>
          <span className={styles.previewTitle}>Live Crest Preview</span>
          
          <div className={styles.glassCard}>
            <div className={`${styles.crestOuter} ${logo ? styles.crestOuterActive : ''}`}>
              <div className={styles.crestInner}>
                {logo ? (
                  <img src={logo} alt="" className={styles.crestImage} />
                ) : (
                  <div className={styles.crestFallback} style={{ background: fallbackBg }}>
                    {initials}
                  </div>
                )}
              </div>
            </div>

            <div className={styles.previewDetails}>
              <h2 className={styles.previewName}>{name || `${username}'s Club`}</h2>
              {abbr && <span className={styles.previewAbbrBadge}>{abbr}</span>}
              <div className={styles.previewDivider} />
              <span className={styles.previewStatus}>Ready for Selection</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
