import { DRAW_THRESHOLD } from '@/lib/scoring/drawBand';

/**
 * The scoreline's margin axis — Gaffa 2.0. Treatment lives in globals.css under
 * "4a. The margin axis"; see design-2.0/README.md § "The surface".
 *
 * Engrave the reference, lay the ink over it: centre is level, the marked zone
 * either side of it is the draw band, and the ink runs from the centre toward
 * whoever leads. Direction is the result, length is the size of it.
 *
 * It is a component rather than a block of CSS each page composes by hand
 * because the two routes that draw one would otherwise each own a copy of the
 * clamp, the percentages and the verdict wording — and a duplicated rule decays
 * into a stale rule, which this project has now recorded three times.
 */

/** Margin at which the axis is full. Beyond this it clamps. */
const AXIS_FULL_SCALE = 50;

export interface MarginAxisProps {
    scoreA: number;
    scoreB: number;
    /** Only a completed matchup has a verdict; live and scheduled show the run of play. */
    isCompleted: boolean;
    teamAName: string;
    teamBName: string;
    /** 'a' | 'b' when one of the two is the viewer's own club, else null. */
    myTeamSide?: 'a' | 'b' | null;
    /** `sm` is the row size; omit for the panel-scale axis. */
    size?: 'sm';
}

/**
 * The sentence the axis has already drawn. Second person when it is your
 * fixture, because "you" is the reason the featured slot exists.
 */
export function marginVerdict({
    scoreA, scoreB, isCompleted, teamAName, teamBName, myTeamSide,
}: MarginAxisProps): React.ReactNode {
    const margin = Math.abs(scoreA - scoreB);
    const drawn = margin <= DRAW_THRESHOLD;
    const marginText = <strong>{margin.toFixed(2)}</strong>;

    if (drawn) {
        return isCompleted
            ? <>Drawn — {marginText} apart, inside the band</>
            : <>Level — {marginText} apart, inside the band</>;
    }

    const leaderIsA = scoreA > scoreB;
    const leader = leaderIsA ? teamAName : teamBName;
    const mineLeads = myTeamSide !== null && myTeamSide !== undefined
        && ((myTeamSide === 'a') === leaderIsA);

    if (isCompleted) {
        if (myTeamSide) {
            return mineLeads
                ? <>Won by {marginText}</>
                : <>Lost by {marginText}</>;
        }
        return <>{leader} by {marginText}</>;
    }

    if (myTeamSide) {
        return mineLeads
            ? <>Ahead by {marginText}</>
            : <>Behind by {marginText}</>;
    }
    return <>{leader} ahead by {marginText}</>;
}

export default function MarginAxis(props: MarginAxisProps) {
    const { scoreA, scoreB, size } = props;

    const margin = Math.abs(scoreA - scoreB);
    /* Half the axis is AXIS_FULL_SCALE points, so a margin maps to at most 50%
       of the track from the centre. */
    const reach = Math.min(margin, AXIS_FULL_SCALE) / AXIS_FULL_SCALE * 50;
    const aLeads = scoreA > scoreB;

    /* Grows from the centre toward the leader. At level there is nothing to
       draw and the tick alone carries it. */
    const inkStyle = reach === 0
        ? { display: 'none' }
        : aLeads
            ? { right: '50%', width: `${reach}%` }
            : { left: '50%', width: `${reach}%` };

    return (
        // `g-track` is load-bearing, not decoration. Without it the axis has no
        // visible extent, so the band reads as a grey lozenge floating in space
        // rather than as a zone marked out on a scale — which is exactly how it
        // shipped the first time. globals.css § "6. Recessed tracks" names "a
        // margin axis" as the thing it was written for.
        <div className={`g-track g-axis${size === 'sm' ? ' g-axis-sm' : ''}`} aria-hidden="true">
            <span className="g-axis-band" />
            <span className="g-axis-ink" style={inkStyle} />
            <span className="g-axis-tick" />
        </div>
    );
}
