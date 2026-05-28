'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import ChatClient from './chat/ChatClient';
import DraftOrderManager from './DraftOrderManager';
import styles from './preDraftLobby.module.css';
import type { League, Team } from '@/types';

interface Props {
  leagueId: string;
  league: League;
  teams: any[];
  myUserId: string;
  myTeam: any | null;
  currentUsername: string;
  isCommissioner: boolean;
}

function getInitials(name: string, abbr: string | null): string {
  if (abbr && abbr.trim()) return abbr.trim().substring(0, 3).toUpperCase();
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
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

export default function PreDraftLobby({
  leagueId,
  league,
  teams,
  myUserId,
  myTeam,
  currentUsername,
  isCommissioner,
}: Props) {
  const router = useRouter();
  const [modalOpen, setModalOpen] = useState(false);
  const [editName, setEditName] = useState(myTeam?.team_name ?? '');
  const [editAbbr, setEditAbbr] = useState(myTeam?.abbreviation ?? '');
  const [editLogo, setEditLogo] = useState(myTeam?.logo_url ?? '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const supabase = createClient();

  async function handleSaveIdentity(e: React.FormEvent) {
    e.preventDefault();
    if (!myTeam) return;

    if (!editName.trim()) {
      setError('Team name cannot be empty');
      return;
    }

    const abbrClean = editAbbr.trim().substring(0, 4).toUpperCase();

    setLoading(true);
    setError(null);

    const { error: updateErr } = await supabase
      .from('teams')
      .update({
        team_name: editName.trim(),
        abbreviation: abbrClean || null,
        logo_url: editLogo.trim() || null,
      })
      .eq('id', myTeam.id);

    if (updateErr) {
      setError(updateErr.message);
      setLoading(false);
      return;
    }

    setModalOpen(false);
    setLoading(false);
    router.refresh();
  }

  // Sort teams for display
  const sortedTeams = [...teams].sort((a, b) => {
    if (a.draft_order !== null && b.draft_order !== null) return a.draft_order - b.draft_order;
    if (a.draft_order !== null) return -1;
    if (b.draft_order !== null) return 1;
    return a.team_name.localeCompare(b.team_name);
  });

  const isActive = league.status === 'drafting';

  return (
    <div className={styles.lobbyLayout}>
      {/* Left Pane - Lobby & Settings */}
      <div className={styles.leftPane}>
        {/* Status Card */}
        <div className={styles.statusCard}>
          <div className={styles.statusHeader}>
            <h1 className={styles.leagueName}>{league.name}</h1>
            <span className={`${styles.statusBadge} ${isActive ? styles.statusBadgeActive : ''}`}>
              ● {isActive ? 'Draft Active' : 'Lobby Open'}
            </span>
          </div>
          <div className={styles.leagueMeta}>
            <span>COMMISSIONER: <strong>{isCommissioner ? 'YOU' : 'Other Manager'}</strong></span>
            <span>FORMAT: <strong>{String(league.draft_type).toUpperCase()} DRAFT</strong></span>
            <span>MAX TEAMS: <strong>{league.max_teams}</strong></span>
          </div>
        </div>

        {/* Enter Draft Card */}
        <div className={styles.ctaCard}>
          <h2 className={styles.ctaTitle}>
            {isActive ? '🚨 The Draft is Underway!' : '⏳ The Draft Room is Preparing'}
          </h2>
          <p className={styles.ctaDesc}>
            {isActive
              ? 'Picks are being made in real time. Enter the war room now to make selections, set your queue, and configure scouting lists!'
              : 'Join the lobby chat, customize your club credentials, and review the drafting pool. Once the commissioner randomizes the picks and launches the draft, the entry gate will open.'}
          </p>
          <Link href={`/league/${leagueId}/draft`} className={styles.ctaBtn}>
            {isActive ? 'Enter active draft room →' : 'Preview draft board →'}
          </Link>
        </div>

        {/* Club Roster Board */}
        <div className={styles.sectionCard}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>Club Registrations</h2>
            <span className={styles.memberCount}>
              {teams.length} / {league.max_teams} joined
            </span>
          </div>

          <div className={styles.membersGrid}>
            {sortedTeams.map((t) => {
              const isMe = t.user_id === myUserId;
              const hasOrder = t.draft_order !== null;
              const initials = getInitials(t.team_name, t.abbreviation);
              const fallbackBg = getHslColor(t.id);
              const ownerLabel = t.user?.username || t.user?.email?.split('@')[0] || 'Manager';

              return (
                <div key={t.id} className={`${styles.memberRow} ${isMe ? styles.memberRowActive : ''}`}>
                  <div className={styles.memberLeft}>
                    <div className={styles.avatarContainer}>
                      {t.logo_url ? (
                        <img src={t.logo_url} alt="" className={styles.avatarImage} />
                      ) : (
                        <div className={styles.avatarFallback} style={{ background: fallbackBg }}>
                          {initials}
                        </div>
                      )}
                    </div>
                    <div className={styles.memberDetails}>
                      <div className={styles.teamNameRow}>
                        <span className={styles.teamName}>{t.team_name}</span>
                        {t.abbreviation && (
                          <span className={styles.abbrBadge} title="Team abbreviation">
                            {t.abbreviation}
                          </span>
                        )}
                      </div>
                      <span className={styles.managerName}>
                        {ownerLabel} {isMe && <strong>(YOU)</strong>}
                      </span>
                    </div>
                  </div>

                  <div className={styles.memberRight}>
                    {isMe && (
                      <button
                        type="button"
                        onClick={() => setModalOpen(true)}
                        className={styles.editIdentityBtn}
                      >
                        Edit Identity
                      </button>
                    )}
                    {league.commissioner_id === t.user_id && (
                      <span className={styles.commissionerBadge}>COMMISH</span>
                    )}
                    <div className={styles.draftOrderBadge}>
                      {hasOrder ? (
                        <>Draft: <strong className={styles.orderNumBold}>#{t.draft_order}</strong></>
                      ) : (
                        'Draft: waiting...'
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Commissioner Setup - Panel */}
        {isCommissioner && !isActive && (
          <div className={`${styles.sectionCard} ${styles.commCard}`}>
            <div className={`${styles.sectionHeader} ${styles.commHeader}`}>
              <h2 className={`${styles.sectionTitle} ${styles.commTitle}`}>🛠️ Commissioner Controls</h2>
              <span className={styles.memberCount}>Setup Phase</span>
            </div>
            <DraftOrderManager
              leagueId={leagueId}
              initialTeams={teams}
            />
          </div>
        )}
      </div>

      {/* Right Pane - Sidebar Chat */}
      <div className={styles.rightPane}>
        <ChatClient
          leagueId={leagueId}
          leagueName={league.name}
          currentUserId={myUserId}
          currentUsername={currentUsername}
        />
      </div>

      {/* Edit Identity Modal */}
      {modalOpen && (
        <div className={styles.modalOverlay} onClick={() => setModalOpen(false)}>
          <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h3 className={styles.modalTitle}>Edit Club Identity</h3>
              <button
                type="button"
                className={styles.modalCloseBtn}
                onClick={() => setModalOpen(false)}
              >
                &times;
              </button>
            </div>
            <form onSubmit={handleSaveIdentity}>
              <div className={styles.modalBody}>
                <div className={styles.inputGroup}>
                  <label className={styles.inputLabel}>Team Name</label>
                  <input
                    type="text"
                    className={styles.textInput}
                    placeholder="e.g. Duke's Destroyers"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    required
                  />
                </div>

                <div className={styles.inputGroup}>
                  <label className={styles.inputLabel}>Abbreviation (Up to 4 characters)</label>
                  <input
                    type="text"
                    className={styles.textInput}
                    placeholder="e.g. DUD"
                    value={editAbbr}
                    onChange={(e) => setEditAbbr(e.target.value.toUpperCase())}
                    maxLength={4}
                  />
                </div>

                <div className={styles.inputGroup}>
                  <label className={styles.inputLabel}>Profile Logo URL</label>
                  <input
                    type="url"
                    className={styles.textInput}
                    placeholder="e.g. https://domain.com/photo.png"
                    value={editLogo}
                    onChange={(e) => setEditLogo(e.target.value)}
                  />
                </div>

                {error && <p className={styles.modalError}>{error}</p>}
              </div>

              <div className={styles.modalFooter}>
                <button
                  type="button"
                  className={styles.cancelBtn}
                  onClick={() => setModalOpen(false)}
                  disabled={loading}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className={styles.saveBtn}
                  disabled={loading}
                >
                  {loading ? 'Saving…' : 'Save Credentials'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
