'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import NavigationLink from '@/components/ui/NavigationLink';
import { createClient } from '@/lib/supabase/client';
import SidebarChat from './SidebarChat';
import DraftOrderManager from './DraftOrderManager';
import CrestBadge from '@/components/crest/CrestBadge';
import styles from './preDraftLobby.module.css';
import type { League } from '@/types';

interface Props {
  leagueId: string;
  league: League;
  teams: any[];
  myUserId: string;
  myTeam: any | null;
  currentUsername: string;
  isCommissioner: boolean;
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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inviteCopied, setInviteCopied] = useState(false);

  async function handleCopyInvite() {
    if (!league.invite_code) return;
    try {
      await navigator.clipboard.writeText(league.invite_code);
      setInviteCopied(true);
      setTimeout(() => setInviteCopied(false), 1500);
    } catch {
      // clipboard access denied — ignore, code is still visible to copy manually
    }
  }

  const supabase = createClient();

  // Scheduling States
  const [schedTimeInput, setSchedTimeInput] = useState(
    league.draft_scheduled_at
      ? (() => {
          const d = new Date(league.draft_scheduled_at);
          const tzoffset = d.getTimezoneOffset() * 60000;
          return new Date(d.getTime() - tzoffset).toISOString().slice(0, 16);
        })()
      : ''
  );
  const [schedSaving, setSchedSaving] = useState(false);
  const [schedError, setSchedError] = useState<string | null>(null);
  const [schedSuccess, setSchedSuccess] = useState<string | null>(null);

  // Dynamic Countdown Timer
  const [timeLeft, setTimeLeft] = useState<{
    days: number;
    hours: number;
    minutes: number;
    seconds: number;
    totalMs: number;
  } | null>(null);

  useEffect(() => {
    if (!league.draft_scheduled_at) {
      setTimeLeft(null);
      return;
    }

    const scheduledMs = new Date(league.draft_scheduled_at).getTime();

    function calculateTimeLeft() {
      const now = Date.now();
      const difference = scheduledMs - now;

      if (difference <= 0) {
        return { days: 0, hours: 0, minutes: 0, seconds: 0, totalMs: 0 };
      }

      return {
        days: Math.floor(difference / (1000 * 60 * 60 * 24)),
        hours: Math.floor((difference / (1000 * 60 * 60)) % 24),
        minutes: Math.floor((difference / 1000 / 60) % 60),
        seconds: Math.floor((difference / 1000) % 60),
        totalMs: difference,
      };
    }

    setTimeLeft(calculateTimeLeft());

    const timer = setInterval(() => {
      const remaining = calculateTimeLeft();
      setTimeLeft(remaining);
      if (remaining.totalMs <= 0) {
        clearInterval(timer);
        router.refresh();
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [league.draft_scheduled_at, router]);

  async function handleSaveSchedule(e: React.FormEvent) {
    e.preventDefault();
    if (!schedTimeInput) {
      setSchedError('Please select a valid date and time.');
      return;
    }

    const scheduledDate = new Date(schedTimeInput);
    if (isNaN(scheduledDate.getTime())) {
      setSchedError('Invalid date/time selected.');
      return;
    }

    if (scheduledDate.getTime() <= Date.now()) {
      setSchedError('Scheduled draft time must be in the future.');
      return;
    }

    setSchedSaving(true);
    setSchedError(null);
    setSchedSuccess(null);

    try {
      const res = await fetch(`/api/leagues/${leagueId}/draft/schedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scheduledAt: scheduledDate.toISOString() }),
      });

      const json = await res.json();
      if (!res.ok) {
        setSchedError(json.error ?? 'Failed to save schedule.');
        return;
      }

      setSchedSuccess('Draft schedule updated successfully!');
      router.refresh();
    } catch (err: any) {
      setSchedError(err.message ?? 'An error occurred while saving the schedule.');
    } finally {
      setSchedSaving(false);
    }
  }

  async function handleCancelSchedule() {
    if (!confirm('Are you sure you want to cancel the scheduled draft? This will clear the countdown.')) {
      return;
    }

    setSchedSaving(true);
    setSchedError(null);
    setSchedSuccess(null);

    try {
      const res = await fetch(`/api/leagues/${leagueId}/draft/schedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scheduledAt: null }),
      });

      const json = await res.json();
      if (!res.ok) {
        setSchedError(json.error ?? 'Failed to cancel schedule.');
        return;
      }

      setSchedSuccess('Draft schedule cleared successfully.');
      setSchedTimeInput('');
      router.refresh();
    } catch (err: any) {
      setSchedError(err.message ?? 'An error occurred while clearing the schedule.');
    } finally {
      setSchedSaving(false);
    }
  }

  async function handleSaveIdentity(e: React.FormEvent) {
    e.preventDefault();
    if (!myTeam) return;

    if (!editName.trim()) {
      setError('Team name cannot be empty');
      return;
    }

    const abbrClean = editAbbr.trim().substring(0, 4).toUpperCase();
    if (!abbrClean) {
      setError('Team abbreviation is required');
      return;
    }
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
        team_name: editName.trim(),
        abbreviation: abbrClean,
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
            <div>
              <h1 className={styles.leagueName}>{league.name}</h1>
            </div>
            <span className={isActive ? styles.statusLive : styles.statusOpen}>
              {isActive ? 'Draft live' : 'Lobby open'}
            </span>
          </div>
          <div className={styles.leagueMeta}>
            <span className={styles.metaItem}>Commissioner <strong>{isCommissioner ? 'you' : 'another manager'}</strong></span>
            <span className={styles.metaItem}>Format <strong>{String(league.draft_type).toLowerCase()} draft</strong></span>
            <span className={styles.metaItem}>Max teams <strong>{league.max_teams}</strong></span>
            {league.invite_code && (
              <span className={styles.metaItem}>
                Invite code <strong>{league.invite_code.toUpperCase()}</strong>
                <button
                  type="button"
                  className={styles.inviteCodeCopyBtn}
                  onClick={handleCopyInvite}
                  title="Copy invite code to share with friends"
                >
                  {inviteCopied ? '✓' : '⧉'}
                </button>
              </span>
            )}
          </div>
        </div>

        {/* Enter Draft Card */}
        <div className={styles.ctaCard}>
          <h2 className={styles.ctaTitle}>
            {isActive
              ? 'The draft is underway'
              : league.draft_scheduled_at
              ? 'Draft scheduled'
              : 'The draft room is preparing'}
          </h2>
          <p className={styles.ctaDesc}>
            {isActive
              ? 'Picks are being made in real time. Enter the draft room now to make selections, set your queue, and configure scouting lists!'
              : league.draft_scheduled_at
              ? 'The countdown has begun. Research players, configure your queue, and prepare your draft room. Kickoff is automated.'
              : 'Join the League lobby, customize your club credentials, and review the drafting pool. Once the commissioner randomizes the picks and launches the draft, the entry gate will open.'}
          </p>

          {!isActive && league.draft_scheduled_at && timeLeft && (
            timeLeft.totalMs > 0 ? (
              <div className={styles.countdownContainer}>
                <div className={styles.countdownSegment}>
                  <span className={styles.countdownValue}>{timeLeft.days}</span>
                  <span className={styles.countdownLabel}>DAYS</span>
                </div>
                <div className={styles.countdownDivider}>:</div>
                <div className={styles.countdownSegment}>
                  <span className={styles.countdownValue}>{timeLeft.hours.toString().padStart(2, '0')}</span>
                  <span className={styles.countdownLabel}>HRS</span>
                </div>
                <div className={styles.countdownDivider}>:</div>
                <div className={styles.countdownSegment}>
                  <span className={styles.countdownValue}>{timeLeft.minutes.toString().padStart(2, '0')}</span>
                  <span className={styles.countdownLabel}>MINS</span>
                </div>
                <div className={styles.countdownDivider}>:</div>
                <div className={styles.countdownSegment}>
                  <span className={styles.countdownValue}>{timeLeft.seconds.toString().padStart(2, '0')}</span>
                  <span className={styles.countdownLabel}>SECS</span>
                </div>
              </div>
            ) : (
              <div className={styles.countdownStarting}>
                Draft starting now — entering the draft room…
              </div>
            )
          )}

          <NavigationLink href={`/league/${leagueId}/draft`} className={styles.ctaBtn}>
            {isActive ? 'Enter active draft room →' : 'Preview draft board →'}
          </NavigationLink>

          {!isActive && (
            <NavigationLink href={`/league/${leagueId}/draft/mock`} className={styles.mockDraftBtn}>
              Practice with a mock draft →
            </NavigationLink>
          )}
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
              const ownerLabel = t.user?.username || t.user?.email?.split('@')[0] || 'Manager';

              return (
                <div key={t.id} className={`${styles.memberRow} ${isMe ? styles.memberRowActive : ''}`}>
                  <div className={styles.memberLeft}>
                    <div className={styles.avatarContainer}>
                      <CrestBadge config={t.crest_config} teamName={t.team_name} teamId={t.id} size={38} />
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
                      <span className={styles.commissionerBadge}>Commissioner</span>
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
              <h2 className={`${styles.sectionTitle} ${styles.commTitle}`}>Commissioner Controls</h2>
              <span className={styles.memberCount}>Setup phase</span>
            </div>

            {/* Scheduling Section */}
            <div className={styles.schedulerSection}>
              <h3 className={styles.schedulerTitle}>Schedule Draft Kickoff</h3>
              <p className={styles.schedulerHint}>
                Set a date and time for the draft to automatically begin. A minimum of 4 managers must be joined.
              </p>
              
              <form onSubmit={handleSaveSchedule} className={styles.schedulerForm}>
                <div className={styles.scheduleInputWrapper}>
                  <input
                    type="datetime-local"
                    value={schedTimeInput}
                    onChange={(e) => setSchedTimeInput(e.target.value)}
                    className={styles.scheduleInput}
                    disabled={schedSaving}
                  />
                  
                  <div className={styles.schedulerBtns}>
                    <button
                      type="submit"
                      disabled={schedSaving}
                      className={styles.saveScheduleBtn}
                    >
                      {schedSaving ? 'Saving...' : league.draft_scheduled_at ? 'Update Schedule' : 'Schedule Draft'}
                    </button>
                    
                    {league.draft_scheduled_at && (
                      <button
                        type="button"
                        onClick={handleCancelSchedule}
                        disabled={schedSaving}
                        className={styles.cancelScheduleBtn}
                      >
                        Cancel schedule
                      </button>
                    )}
                  </div>
                </div>
              </form>
              
              {schedError && <p className={styles.schedulerError}>{schedError}</p>}
              {schedSuccess && <p className={styles.schedulerSuccess}>{schedSuccess}</p>}
            </div>

            <div className={styles.sectionDivider} />

            <DraftOrderManager
              leagueId={leagueId}
              initialTeams={teams}
            />
          </div>
        )}
      </div>

      {/* Right Pane - Sidebar Chat */}
      <div className={styles.rightPane}>
        <SidebarChat
          leagueId={leagueId}
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

                {error && <p className={styles.modalError}>{error}</p>}

                <div className={styles.fullSetupLinkContainer}>
                  <CrestBadge config={myTeam?.crest_config} teamName={editName} size={40} />
                  <NavigationLink
                    href={`/league/${leagueId}/team-setup`}
                    className={styles.fullSetupLink}
                    onClick={() => setModalOpen(false)}
                  >
                    Design your crest in the creator suite →
                  </NavigationLink>
                </div>
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
