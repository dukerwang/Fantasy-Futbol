'use client';

import { useState, useEffect, useCallback } from 'react';
import type { Player } from '@/types';
import PositionBadge from '@/components/players/PositionBadge';
import styles from './GlobalBidModal.module.css';

interface UserTeam {
  id: string;
  team_name: string;
  league_id: string;
  league_name: string;
  league_roster_size: number;
}

interface RosterPlayer {
  id: string;
  name: string;
  primary_position: string;
  pl_team: string;
}

interface TeamInfo {
  faab_budget: number;
  myRoster: RosterPlayer[];
  rosterFull: boolean;
  alreadyRostered: boolean; // player is already on this team
  hasPendingBid: boolean;   // team already has a pending auction bid for this player
}

interface Props {
  player: Player | null;
  userTeams: UserTeam[];
  onClose: () => void;
  onSuccess: (teamName: string, leagueName: string) => void;
}

export default function GlobalBidModal({ player, userTeams, onClose, onSuccess }: Props) {
  const [selectedTeamId, setSelectedTeamId] = useState('');
  const [teamInfo, setTeamInfo] = useState<TeamInfo | null>(null);
  const [teamInfoLoading, setTeamInfoLoading] = useState(false);
  const [teamInfoError, setTeamInfoError] = useState('');

  const [bidAmount, setBidAmount] = useState('0');
  const [dropPlayerId, setDropPlayerId] = useState('');
  const [submitError, setSubmitError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const selectedTeam = userTeams.find((t) => t.id === selectedTeamId);

  // When team is selected, fetch their roster / FAAB info
  const fetchTeamInfo = useCallback(async (teamId: string, leagueId: string) => {
    if (!player) return;
    setTeamInfoLoading(true);
    setTeamInfoError('');
    setTeamInfo(null);
    setDropPlayerId('');

    try {
      const res = await fetch(`/api/leagues/${leagueId}/auctions`);
      if (!res.ok) {
        setTeamInfoError('Failed to load team info.');
        return;
      }
      const data = await res.json();

      const myRoster: RosterPlayer[] = data.myRoster ?? [];
      const alreadyRostered = myRoster.some((p: RosterPlayer) => p.id === player.id);

      // Check if team has a pending bid for this player
      const auctions = data.auctions ?? [];
      const hasPendingBid = auctions.some(
        (a: any) => a.player?.id === player.id && a.my_bid !== null,
      );

      setTeamInfo({
        faab_budget: data.myTeam?.faab_budget ?? 0,
        myRoster,
        rosterFull: data.rosterFull ?? false,
        alreadyRostered,
        hasPendingBid,
      });
      setBidAmount('0');
    } catch {
      setTeamInfoError('Network error. Please try again.');
    } finally {
      setTeamInfoLoading(false);
    }
  }, [player]);

  useEffect(() => {
    if (selectedTeamId && selectedTeam) {
      fetchTeamInfo(selectedTeamId, selectedTeam.league_id);
    } else {
      setTeamInfo(null);
    }
  }, [selectedTeamId, selectedTeam, fetchTeamInfo]);

  // Reset when player changes
  useEffect(() => {
    setSelectedTeamId('');
    setTeamInfo(null);
    setBidAmount('0');
    setDropPlayerId('');
    setSubmitError('');
  }, [player?.id]);

  const handleSubmit = useCallback(async () => {
    if (!player || !selectedTeam || !teamInfo) return;

    const amount = parseInt(bidAmount, 10);
    if (isNaN(amount) || amount < 0) {
      setSubmitError('Enter a valid bid amount.');
      return;
    }
    if (amount > teamInfo.faab_budget) {
      setSubmitError(`${selectedTeam.team_name} only has £${teamInfo.faab_budget}m FAAB.`);
      return;
    }
    if (teamInfo.rosterFull && !dropPlayerId) {
      setSubmitError('Your roster is full — select a player to drop.');
      return;
    }
    if (teamInfo.alreadyRostered) {
      setSubmitError('This player is already on your roster.');
      return;
    }

    setSubmitting(true);
    setSubmitError('');

    const res = await fetch(`/api/leagues/${selectedTeam.league_id}/auctions/bid`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        playerId: player.id,
        bidAmount: amount,
        dropPlayerId: dropPlayerId || null,
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      setSubmitError(data.error ?? 'Something went wrong. Please try again.');
      setSubmitting(false);
      return;
    }

    onSuccess(selectedTeam.team_name, selectedTeam.league_name);
  }, [player, selectedTeam, teamInfo, bidAmount, dropPlayerId, onSuccess]);

  if (!player) return null;

  const canSubmit =
    teamInfo &&
    !teamInfo.alreadyRostered &&
    !teamInfo.hasPendingBid &&
    !teamInfoLoading;

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <button className={styles.closeBtn} onClick={onClose} aria-label="Close">×</button>

        {/* Player header */}
        <div className={styles.playerHeader}>
          {player.photo_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={player.photo_url} alt={player.name} className={styles.playerPhoto} />
          )}
          <div>
            <div className={styles.playerName}>{player.web_name ?? player.name}</div>
            <div className={styles.playerMeta}>
              <PositionBadge position={player.primary_position} size="sm" />
              <span className={styles.playerClub}>{player.pl_team}</span>
              <span className={styles.playerValue}>£{Number(player.market_value ?? 0).toFixed(1)}m</span>
            </div>
          </div>
        </div>

        {userTeams.length === 0 ? (
          <p className={styles.noTeams}>You are not in any active leagues. Join a league to place bids.</p>
        ) : (
          <>
            {/* Step 1: Team selection */}
            <div className={styles.field}>
              <label className={styles.label}>Place bid for team:</label>
              <select
                className={styles.select}
                value={selectedTeamId}
                onChange={(e) => setSelectedTeamId(e.target.value)}
              >
                <option value="">— Select a team —</option>
                {userTeams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.team_name} ({t.league_name})
                  </option>
                ))}
              </select>
            </div>

            {/* Team info loading */}
            {teamInfoLoading && (
              <p className={styles.loading}>Loading team info…</p>
            )}

            {teamInfoError && (
              <p className={styles.errorMsg}>{teamInfoError}</p>
            )}

            {/* Already rostered warning */}
            {teamInfo?.alreadyRostered && (
              <div className={styles.warningBanner}>
                {selectedTeam?.team_name} already has this player on their roster.
              </div>
            )}

            {/* Already bidding warning */}
            {teamInfo?.hasPendingBid && !teamInfo.alreadyRostered && (
              <div className={styles.warningBanner}>
                {selectedTeam?.team_name} already has a pending bid for this player. Go to the league transfer market to update it.
              </div>
            )}

            {/* Step 2: Bid form */}
            {teamInfo && !teamInfo.alreadyRostered && !teamInfo.hasPendingBid && (
              <>
                <div className={styles.faabRow}>
                  <span className={styles.faabLabel}>Available FAAB:</span>
                  <span className={styles.faabAmount}>£{teamInfo.faab_budget}m</span>
                </div>

                <div className={styles.field}>
                  <label className={styles.label}>Your bid (£m):</label>
                  <input
                    type="number"
                    min={0}
                    max={teamInfo.faab_budget}
                    step={1}
                    className={styles.input}
                    value={bidAmount}
                    onChange={(e) => setBidAmount(e.target.value)}
                    autoFocus
                  />
                  <span className={styles.hint}>Max: £{teamInfo.faab_budget}m</span>
                </div>

                {teamInfo.rosterFull && (
                  <div className={styles.field}>
                    <label className={styles.label}>Drop player (roster full — required):</label>
                    <select
                      className={styles.select}
                      value={dropPlayerId}
                      onChange={(e) => setDropPlayerId(e.target.value)}
                    >
                      <option value="">— Select a player to drop —</option>
                      {teamInfo.myRoster.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} ({p.primary_position} · {p.pl_team})
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {submitError && <p className={styles.errorMsg}>{submitError}</p>}

                <div className={styles.actions}>
                  <button className={styles.cancelBtn} onClick={onClose} disabled={submitting}>
                    Cancel
                  </button>
                  <button
                    className={styles.submitBtn}
                    onClick={handleSubmit}
                    disabled={submitting || !canSubmit}
                  >
                    {submitting ? 'Placing bid…' : 'Start Auction'}
                  </button>
                </div>
              </>
            )}

            {/* Show cancel if blocked */}
            {teamInfo && (teamInfo.alreadyRostered || teamInfo.hasPendingBid) && (
              <div className={styles.actions}>
                <button className={styles.cancelBtn} onClick={onClose}>Close</button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
