'use client';

import { useState } from 'react';
import PremiumPlayerCard from '@/components/players/PremiumPlayerCard';
import ListingEditor from '@/components/transfers/ListingEditor';
import type { EnrichedPlayer, RosterPlayer, TransfersListing } from '@/lib/transfers/buildTransfersModel';
import type { SquadEntry } from './ClubClient';
import { money, signedMoney, statusMeta, valueOf, ageOf } from './clubDerive';
import styles from './club.module.css';

interface Props {
  entry: SquadEntry | null;
  teamId: string;
  leagueId: string;
  /** False on a rival's club: the file stays, every control that mutates it goes. */
  viewerIsOwner: boolean;
  academyAgeLimit: number;
  onAfter: () => void;
}

// Auction wins are recorded as 'waiver' in this app (see migration 059).
const ACQ_LABEL: Record<string, string> = {
  waiver: 'Auction', draft: 'Drafted', trade: 'Traded in', free_agent: 'Free agent', retained_return: 'Reinstated',
};

export default function Inspector({ entry, teamId, leagueId, viewerIsOwner, academyAgeLimit, onAfter }: Props) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirmDrop, setConfirmDrop] = useState(false);
  const [listingOpen, setListingOpen] = useState(false);

  if (!entry) {
    return (
      <aside className={`${styles.panel} g-panel`}>
        <div className={styles.panelHead}><h2 className={styles.panelTitle}>Player file</h2></div>
        <div className={styles.inspEmpty}>
          <div className={styles.inspEmptyMark}>☆</div>
          <p>Select any player to open their card, contract history and squad actions.</p>
        </div>
      </aside>
    );
  }

  const p = entry.player;
  const value = valueOf(entry);
  const paid = Number(entry.acquisitionValue ?? 0);
  const net = value - paid;
  const severance = Math.max(2, Math.floor(value * 0.2));
  const isPurchase = entry.acquisitionType === 'waiver' || entry.acquisitionType === 'trade';
  const age = ageOf(p.date_of_birth);
  const acqDate = entry.acquiredAt ? new Date(entry.acquiredAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '';

  // Mirrors what the hub itself refuses: ListingEditor already filters
  // loan_in/loan_out out of its "who can I list" picker (POST /listings
  // rejects them outright), and a listing with live bidding can't be edited —
  // same as ListingCard's "Locked — will sell" state.
  const loaned = entry.status === 'loan_in' || entry.status === 'loan_out';
  const listing = entry.listing;
  const listingLive = listing?.status === 'active';

  // "List for Transfer" opens the same ListingEditor the Transfers hub uses,
  // pre-targeted at this player — one dialog covers trade/sale/loan gates,
  // replacing the old separate "List for Sale" / "Offer on Loan" links and the
  // Trade Block toggle, which never touched the real listings system at all.
  const listingForEditor: TransfersListing | null = listing
    ? {
        id: listing.id,
        seller_team_id: teamId,
        player_id: entry.playerId,
        player: p as unknown as EnrichedPlayer,
        min_bid: listing.min_bid,
        ask_price: listing.ask_price,
        buy_now_price: listing.buy_now_price,
        open_to_trade: listing.open_to_trade,
        open_to_sale: listing.open_to_sale,
        open_to_loan: listing.open_to_loan,
        status: listing.status,
        auction_expires_at: listing.auction_expires_at,
        created_at: listing.created_at,
        updated_at: listing.updated_at,
      }
    : null;
  const myRosterForEditor: RosterPlayer[] = listing
    ? []
    : [{ ...(p as unknown as EnrichedPlayer), status: entry.status, recent_ppg: 0, listing: null }];

  async function call(path: string, body: { playerId: string; action?: string; actionType?: string }) {
    setBusy(true); setErr(null); setConfirmDrop(false);
    try {
      const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) { const d = await res.json().catch(() => ({})); setErr(d.error ?? 'Action failed'); return; }
      onAfter();
    } catch {
      setErr('Network error — please try again.');
    } finally {
      setBusy(false);
    }
  }

  // Contextual primary actions (real roster transitions). Owner only — every
  // endpoint behind these already rejects a non-owner (POST /teams/[teamId]/*
  // checks `team.user_id !== user.id`), so this is the UI half of a rule the
  // server keeps regardless.
  const primary: { label: string; run: () => void }[] = [];
  if (!viewerIsOwner) { /* no transitions offered */ }
  else if (entry.status === 'ir') primary.push({ label: 'Activate from IR', run: () => call(`/api/teams/${teamId}/ir`, { playerId: entry.playerId, action: 'activate' }) });
  else if (entry.status === 'taxi') primary.push({ label: 'Promote to squad', run: () => call(`/api/teams/${teamId}/taxi`, { playerId: entry.playerId, action: 'activate' }) });
  else {
    const f = p.fpl_status;
    if (f === 'i' || f === 'd' || f === 'u') primary.push({ label: 'Place on IR', run: () => call(`/api/teams/${teamId}/ir`, { playerId: entry.playerId, action: 'move_to_ir' }) });
    if (age != null && age <= academyAgeLimit) primary.push({ label: 'Send to Academy', run: () => call(`/api/teams/${teamId}/taxi`, { playerId: entry.playerId, action: 'move_to_taxi' }) });
  }

  return (
    <div>
      <PremiumPlayerCard player={p} />

      <section className={`${styles.panel} g-panel`} style={{ marginTop: 16 }}>
        <div className={styles.panelHead}>
          <h2 className={styles.panelTitle}>Club file</h2>
          <span className="g-label">{statusMeta(entry.status).label}</span>
        </div>

        <div className={styles.fileRows}>
          <FileRow k="Acquired" v={`${ACQ_LABEL[entry.acquisitionType] ?? entry.acquisitionType}${acqDate ? ` · ${acqDate}` : ''}`} />
          {isPurchase && <FileRow k="Fee paid" v={money(paid)} />}
          <FileRow k="Market value now" v={money(value)} />
          {isPurchase && <FileRow k="Net vs. fee" v={signedMoney(net)} cls={net >= 0 ? styles.posNet : styles.negNet} />}
          {/* Severance is what it costs YOU to cut him. Meaningless on a rival's
              file, where the same money is somebody else's problem. */}
          {viewerIsOwner && (
            <FileRow k="Cost to drop" v={<>{money(severance)}<span className={styles.fileSubtle}> severance</span></>} />
          )}
        </div>

        {err && <div className={styles.inspErr}>{err}</div>}

        {!viewerIsOwner ? (
          <div className={styles.acts}>
            <a
              className={`${styles.act} ${styles.actPrimary} ${styles.actWide}`}
              href={`/league/${leagueId}/transfers/deals?proposeTeam=${teamId}&proposePlayer=${entry.playerId}`}
            >
              Make an offer
            </a>
            {listingLive && <span className={styles.act} aria-disabled="true">Listed for transfer</span>}
          </div>
        ) : (
        <div className={styles.acts}>
          {primary.map((a) => (
            <button key={a.label} type="button" className={`${styles.act} ${styles.actPrimary} ${styles.actWide}`} disabled={busy} onClick={a.run}>
              {a.label}
            </button>
          ))}

          {!loaned && (
            listingLive ? (
              <span className={styles.act} aria-disabled="true">Locked — will sell</span>
            ) : (
              <button
                type="button"
                className={styles.act}
                disabled={busy || entry.isPendingDrop}
                onClick={() => setListingOpen(true)}
              >
                {listing ? 'Manage Listing' : 'List for Transfer'}
              </button>
            )
          )}

          {entry.isPendingDrop ? (
            <span className={`${styles.act} ${styles.actDanger}`} aria-disabled="true">Drop queued</span>
          ) : confirmDrop ? (
            <button type="button" className={`${styles.act} ${styles.actDanger}`} disabled={busy}
              onClick={() => call(`/api/teams/${teamId}/drop`, { playerId: entry.playerId, actionType: 'drop' })}>
              Confirm — {money(severance)}
            </button>
          ) : (
            <button type="button" className={`${styles.act} ${styles.actDanger}`} disabled={busy} onClick={() => setConfirmDrop(true)}>
              Drop
            </button>
          )}
        </div>
        )}
      </section>

      {listingOpen && viewerIsOwner && (
        <ListingEditor
          open
          onClose={() => setListingOpen(false)}
          leagueId={leagueId}
          listing={listingForEditor}
          myRoster={myRosterForEditor}
          initialPlayerId={listing ? undefined : entry.playerId}
          onDone={onAfter}
        />
      )}
    </div>
  );
}

function FileRow({ k, v, cls }: { k: string; v: React.ReactNode; cls?: string }) {
  return (
    <div className={styles.fileRow}>
      <span className={styles.fileK}>{k}</span>
      <span className={`${styles.fileV} ${cls ?? ''}`}>{v}</span>
    </div>
  );
}
