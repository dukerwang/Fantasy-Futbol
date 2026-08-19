import { SupabaseClient } from '@supabase/supabase-js';
import { getDepartureCompensationRate } from '@/lib/transfers/compensation';
import { initialAuctionExpiry } from '@/lib/auction/timer';
import { getLeagueAuctionSettings } from '@/lib/auction/leagueAuctionSettings';

export async function executeDrop(
    admin: SupabaseClient,
    teamId: string,
    playerId: string,
    actionType: 'drop' | 'transfer_out'
) {
    // Get team details
    const { data: team } = await admin
        .from('teams')
        .select('*')
        .eq('id', teamId)
        .single();

    if (!team) throw new Error('Team not found');

    // Get roster entry to verify they actually own the player
    const { data: entry } = await admin
        .from('roster_entries')
        .select('id')
        .eq('team_id', teamId)
        .eq('player_id', playerId)
        .single();

    if (!entry) throw new Error('Player not on roster');

    // Get player details
    const { data: player } = await admin
        .from('players')
        .select('id, market_value, name, is_active')
        .eq('id', playerId)
        .single();

    if (!player) throw new Error('Player not found');

    // Transfer-out compensation only applies once the sync marks the player as
    // having actually left the PL (is_active = false). Without this guard any
    // still-active player could be "transferred out" for 80% of market value
    // instead of paying the 20% drop severance — the only prior gate was a
    // client-side confirm() dialog, which a direct API call bypasses.
    if (actionType === 'transfer_out' && player.is_active) {
        throw new Error(`${player.name} is still active in the Premier League and cannot be transferred out. Use Drop instead.`);
    }

    const marketValue = Number(player.market_value || 0);

    // Severance fee: 20% of market value (rounded down), minimum €2m — charged on plain drops only
    const severanceFee = actionType === 'drop' ? Math.max(2, Math.floor(marketValue * 0.2)) : 0;

    // Priced off the league's configured rate, not a literal. This path used to
    // hardcode 0.8 while the relegation sweep used COMPENSATION_RATE = 1.0, so
    // the same real-world event paid differently depending on who triggered it.
    const compensationRate =
        actionType === 'transfer_out'
            ? await getDepartureCompensationRate(admin, team.league_id)
            : 0;
    const refundAmount = actionType === 'transfer_out' ? Math.round(marketValue * compensationRate) : 0;

    let notes: string;
    if (actionType === 'transfer_out') {
        notes = `Transferred ${player.name} out of PL, refunded €${refundAmount}m`;
    } else if (severanceFee > 0) {
        notes = `Dropped ${player.name} — paid €${severanceFee}m contract severance`;
    } else {
        notes = `Dropped ${player.name} to free agency`;
    }

    // 1. Delete roster entry
    const { error: dropError } = await admin
        .from('roster_entries')
        .delete()
        .eq('id', entry.id);

    if (dropError) throw new Error(dropError.message);

    // 2. Update FAAB (refund for transfer_out; deduct severance for plain drop)
    if (actionType === 'transfer_out') {
        await admin
            .from('teams')
            .update({ faab_budget: team.faab_budget + refundAmount })
            .eq('id', teamId);
    } else if (severanceFee > 0) {
        // Math.max(0, ...) is deliberate: a club with no money still gets to
        // drop a player rather than being trapped with an unwanted roster.
        const charged = Math.min(severanceFee, team.faab_budget);
        await admin
            .from('teams')
            .update({ faab_budget: team.faab_budget - charged })
            .eq('id', teamId);

        // Recirculate a share of what was actually charged, not of the nominal
        // fee — otherwise a broke club's drop would mint money for the league.
        // Never fatal: the drop itself has already committed, and a failed
        // distribution costs the other clubs a few million rather than
        // corrupting the roster.
        if (charged > 0) {
            const { data: solData, error: solErr } = await admin.rpc('distribute_solidarity', {
                p_league_id: team.league_id,
                p_payer_team_id: teamId,
                p_amount: charged,
                p_reason: `Solidarity payment from ${player.name}'s severance fee`,
            });
            if (solErr) {
                console.error('[executeDrop] Solidarity distribution failed:', solErr.message);
            } else {
                // Notification only — the credit itself already landed inside
                // distribute_solidarity, atomically with the drop. A failure
                // here means a club finds out from Finance instead of a
                // notification, not that they went unpaid.
                try {
                    const result = solData as { per_club?: number; recipients?: { team_id: string; team_name: string; user_id: string }[] };
                    const recipients = result?.recipients ?? [];
                    if (recipients.length > 0 && result?.per_club) {
                        const { createNotification } = await import('@/lib/notifications/createNotification');
                        const amount = result.per_club;
                        await Promise.all(
                            recipients.map((recipient) =>
                                recipient.user_id
                                    ? createNotification(admin, {
                                          leagueId: team.league_id,
                                          userId: recipient.user_id,
                                          title: 'Solidarity Paid',
                                          content: `You received **€${amount}m** in solidarity from **${team.team_name}**'s severance fee for dropping **${player.name}**.`,
                                          url: `/league/${team.league_id}/finance`,
                                      })
                                    : Promise.resolve(),
                            ),
                        );
                    }
                } catch (err) {
                    console.error('[executeDrop] Failed to notify solidarity recipients:', err);
                }
            }
        }
    }

    // 3. Log transaction
    await admin.from('transactions').insert({
        league_id: team.league_id,
        team_id: teamId,
        player_id: playerId,
        type: actionType === 'transfer_out' ? 'transfer_out' : 'drop',
        compensation_amount: actionType === 'transfer_out' ? refundAmount : severanceFee,
        notes,
    });

    // 4. For plain drops (not PL transfers), auto-start a system auction
    if (actionType !== 'transfer_out') {
        // Single 72h pre-first-bid window. This path used AUCTION_THRESHOLD (50)
        // to pick between 96h and 48h while the timer and the resolver used 40
        // for the same decision — market value no longer affects duration at all.
        const { quietHours } = await getLeagueAuctionSettings(admin, team.league_id);
        const auctionExpiry = initialAuctionExpiry(Date.now(), quietHours);

        await admin.from('waiver_claims').insert({
            league_id: team.league_id,
            team_id: null,
            player_id: playerId,
            faab_bid: 0,
            priority: 999,
            status: 'pending',
            gameweek: 0,
            is_auction: true,
            expires_at: auctionExpiry,
            opens_at: null,
            // Reference price for the auction premium — see migration 070.
            market_value_at_auction: marketValue,
        });

        // --- SEND IN-APP NOTIFICATION ---
        // In-app + push only — routine market churn, too frequent for email now
        // that the PWA covers always-on notifications.
        try {
            const { data: allTeams } = await admin.from('teams').select('user_id, team_name').eq('league_id', team.league_id);
            if (allTeams && allTeams.length > 0) {
                const { createNotification } = await import('@/lib/notifications/createNotification');
                for (const t of allTeams) {
                    await createNotification(admin, {
                        leagueId: team.league_id,
                        userId: t.user_id,
                        title: 'Player Dropped',
                        content: `**${team.team_name}** dropped **${player.name}** to the waiver pool. A 72-hour transfer auction has automatically begun.`,
                        url: `/league/${team.league_id}/transfers/auctions`
                    });
                }
            }
        } catch (err) {
            console.error('Failed to send drop notifications:', err);
        }
    }

    // 5. Check and activate pending return loans
    try {
        const { data: pendingLoan } = await admin
            .from('player_loans')
            .select(`
                *,
                player:players(id, name)
            `)
            .eq('lender_team_id', teamId)
            .eq('status', 'pending_activation')
            .order('created_at', { ascending: true }) // oldest first
            .limit(1)
            .maybeSingle();

        if (pendingLoan) {
            const { data: league } = await admin
                .from('leagues')
                .select('roster_size')
                .eq('id', team.league_id)
                .single();
            const rosterSize = league?.roster_size ?? 20;

            const { count: activeCount } = await admin
                .from('roster_entries')
                .select('id', { count: 'exact', head: true })
                .eq('team_id', teamId)
                .not('status', 'in', '("ir","taxi","loan_in")');

            if ((activeCount ?? 0) < rosterSize) {
                // Return player to bench
                await admin
                    .from('roster_entries')
                    .update({ status: 'bench' })
                    .eq('team_id', teamId)
                    .eq('player_id', pendingLoan.player_id)
                    .eq('status', 'loan_out');

                // Mark loan as expired / recalled
                const finalStatus = pendingLoan.recall_activated ? 'recalled' : 'expired';
                await admin
                    .from('player_loans')
                    .update({ status: finalStatus, updated_at: new Date().toISOString() })
                    .eq('id', pendingLoan.id);

                // Notify lender
                const { createNotification } = await import('@/lib/notifications/createNotification');
                await createNotification(admin, {
                    leagueId: team.league_id,
                    userId: team.user_id,
                    title: 'Loan Activated',
                    content: `Roster capacity restored. **${(pendingLoan.player as any)?.name}** has returned to your bench.`,
                    url: `/league/${team.league_id}/team`
                });

                // Send a chat message
                await admin.from('chat_messages').insert({
                    league_id: team.league_id,
                    message: `📢 [SYSTEM:ANNOUNCEMENT] Returned loan activated! **${(pendingLoan.player as any)?.name}** has returned to the bench of **${team.team_name}**.`,
                });
            }
        }
    } catch (err) {
        console.error('Failed to auto-activate pending loan return:', err);
    }
}
