'use client';

import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence, useMotionValue, useTransform } from 'framer-motion';
import PremiumPlayerCard from '@/components/players/PremiumPlayerCard';
import type { Player, GranularPosition } from '@/types';
import { Icon } from '@/components/ui/Icon';
import styles from './AuthShowcase.module.css';

// Pre-defined static player records fetched from our Supabase database.
// These records render instantly, and flipping them triggers real API gamelog lookups!
const SHOWCASE_PLAYERS: Player[] = [
  {
    id: 'fe617316-7d87-458f-bb22-092d4e181d51',
    name: 'Erling Haaland',
    web_name: 'Haaland',
    full_name: null,
    date_of_birth: '2000-07-21',
    nationality: 'Norway',
    pl_team: 'Man City',
    pl_team_id: 13,
    primary_position: 'ST',
    secondary_positions: [] as GranularPosition[],
    market_value: 200,
    market_value_updated_at: '2026-03-05T03:23:54.426Z',
    photo_url: 'https://resources.premierleague.com/premierleague25/photos/players/110x140/223094.png',
    is_active: true,
    created_at: '2026-02-20T07:37:49.456Z',
    updated_at: '2026-05-29T18:59:12.093Z',
    fpl_id: 430,
    api_football_id: 1100,
    transfermarkt_id: null,
    adp: null,
    projected_points: null,
    height_cm: 195,
    fpl_status: 'a',
    fpl_news: null,
    total_points: 686.87,
    form: 21.61,
    form_rating: 8.6,
    ppg: 19.6,
    overall_rank: 2,
    position_ranks: [{ position: 'ST', rank: 1 }]
  },
  {
    id: '1e0ea6bf-3b1e-4e6e-b19a-6b84ed7cdf85',
    name: 'Bukayo Saka',
    web_name: 'Saka',
    full_name: null,
    date_of_birth: '2001-09-05',
    nationality: 'England',
    pl_team: 'Arsenal',
    pl_team_id: 1,
    primary_position: 'RW',
    secondary_positions: [] as GranularPosition[],
    market_value: 130,
    market_value_updated_at: '2026-03-05T03:23:54.426Z',
    photo_url: 'https://resources.premierleague.com/premierleague25/photos/players/110x140/223340.png',
    is_active: true,
    created_at: '2026-02-20T07:37:49.456Z',
    updated_at: '2026-05-29T18:59:12.093Z',
    fpl_id: 16,
    api_football_id: 1460,
    transfermarkt_id: null,
    adp: null,
    projected_points: null,
    height_cm: 178,
    fpl_status: 'a',
    fpl_news: null,
    total_points: 430.43,
    form: 8.16,
    form_rating: 7.9,
    ppg: 14.3,
    overall_rank: 20,
    position_ranks: [{ position: 'RW', rank: 4 }]
  },
  {
    id: '8341cc41-6318-42b5-92e3-2d55de158e6f',
    name: 'Cole Palmer',
    web_name: 'Palmer',
    full_name: null,
    date_of_birth: '2002-05-06',
    nationality: 'England',
    pl_team: 'Chelsea',
    pl_team_id: 7,
    primary_position: 'AM',
    secondary_positions: ['RW', 'CM'] as GranularPosition[],
    market_value: 120,
    market_value_updated_at: '2026-03-05T03:23:55.319Z',
    photo_url: 'https://resources.premierleague.com/premierleague25/photos/players/110x140/244851.png',
    is_active: true,
    created_at: '2026-02-20T07:37:49.456Z',
    updated_at: '2026-05-29T18:59:12.093Z',
    fpl_id: 235,
    api_football_id: 82097,
    transfermarkt_id: null,
    adp: null,
    projected_points: null,
    height_cm: 191,
    fpl_status: 'a',
    fpl_news: null,
    total_points: 256.74,
    form: 6.87,
    form_rating: 6.8,
    ppg: 9.9,
    overall_rank: 131,
    position_ranks: [{ position: 'CM', rank: 34 }, { position: 'AM', rank: 24 }, { position: 'RW', rank: 21 }]
  }
];

const SLIDE_INTERVAL = 6000; // 6s auto-play

export default function AuthShowcase() {
  const [activeSlide, setActiveSlide] = useState(0);
  const [direction, setDirection] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Slides structure
  const slides = [
    {
      eyebrow: 'Public Auctions',
      title: 'The transfer window, made real.',
      desc: 'Bid against your league in the open. Roster expansion is fueled by your club balance, with cash severance paid on every release.',
      visual: <LiveAuctionsVisual />
    },
    {
      eyebrow: 'Scoring Engine',
      title: 'Every action, precisely valued.',
      desc: 'Our scoring engine values actual on-pitch contributions — not arbitrary points. Flip any premium card to view real game logs, form ratings, and granular match statistics.',
      visual: <ScoutingDeckVisual />
    },
    {
      eyebrow: 'Dynasty Draft',
      title: 'A war room built for dynasty.',
      desc: 'Form a foundation that lasts for years. Conduct a live snake-order startup draft, watch the clock, and build a roster that persists season over season.',
      visual: <StartupDraftVisual />
    },
    {
      eyebrow: 'Cup Competitions',
      title: 'Knockout glory on the side.',
      desc: 'Championship aspirations on multiple fronts. Compete in elite two-legged Champions Cup ties and single-elimination open League Cup brackets during the season.',
      visual: <CupsBracketVisual />
    }
  ];

  // Auto-play control
  useEffect(() => {
    // Only pause autoplay on mouse hover if we are on Slide 1 (Scoring Engine/player cards),
    // because Slide 1 has highly interactive elements (3D card tilt, flipping).
    // On other slides, we should autoplay continuously regardless of hover!
    const shouldPause = isPaused && activeSlide === 1;

    if (shouldPause) {
      if (timerRef.current) clearInterval(timerRef.current);
      return;
    }

    timerRef.current = setInterval(() => {
      setDirection(1);
      setActiveSlide((prev) => (prev + 1) % 4); // Constant size of 4 to avoid Fast Refresh dependency changes
    }, SLIDE_INTERVAL);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isPaused, activeSlide]);

  const handleNext = () => {
    setDirection(1);
    setActiveSlide((prev) => (prev + 1) % 4);
  };

  const handlePrev = () => {
    setDirection(-1);
    setActiveSlide((prev) => (prev - 1 + 4) % 4);
  };

  const handleDotClick = (index: number) => {
    setDirection(index > activeSlide ? 1 : -1);
    setActiveSlide(index);
  };

  const slideVariants = {
    enter: (dir: number) => ({
      x: dir > 0 ? 40 : -40,
      opacity: 0,
      visibility: 'hidden' as const
    }),
    center: {
      x: 0,
      opacity: 1,
      visibility: 'visible' as const,
      transition: {
        duration: 0.5,
        ease: [0.22, 1, 0.36, 1] as const
      }
    },
    exit: (dir: number) => ({
      x: dir < 0 ? 40 : -40,
      opacity: 0,
      visibility: 'hidden' as const,
      transition: {
        duration: 0.4,
        ease: [0.22, 1, 0.36, 1] as const
      }
    })
  };

  const isSlidePaused = isPaused && activeSlide === 1;

  return (
    <aside
      className={styles.showcase}
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
    >
      {/* Brand Header */}
      <div className={styles.head}>
        <div className={styles.brand}>
          <span className={styles.brandIcon}>
            <Icon name="activity" size={24} strokeWidth={2.5} />
          </span>
          <span className={styles.brandName}>Gaffa</span>
        </div>
        <span className={styles.tagline}>Dynasty Fantasy Football</span>
      </div>

      {/* Main Slides Track */}
      <div className={styles.track}>
        <AnimatePresence initial={false} custom={direction} mode="wait">
          <motion.section
            key={activeSlide}
            custom={direction}
            variants={slideVariants}
            initial="enter"
            animate="center"
            exit="exit"
            className={styles.slide}
          >
            {/* Copy block */}
            <div className={styles.copy}>
              <div className={styles.eyebrow}>{slides[activeSlide].eyebrow}</div>
              <h2 className={styles.title}>{slides[activeSlide].title}</h2>
              <p className={styles.desc}>{slides[activeSlide].desc}</p>
            </div>

            {/* Visual stage */}
            <div className={styles.visual}>
              {slides[activeSlide].visual}
            </div>
          </motion.section>
        </AnimatePresence>
      </div>

      {/* Controls */}
      <div className={styles.controls}>
        <div className={styles.dots}>
          {slides.map((_, index) => (
            <button
              key={index}
              onClick={() => handleDotClick(index)}
              className={styles.dot}
              aria-label={`Show slide ${index + 1}`}
            >
              {index === activeSlide && (
                <motion.span
                  className={styles.dotFill}
                  layoutId="activeDotProgress"
                  initial={{ width: '0%' }}
                  animate={isSlidePaused ? { width: '100%' } : { width: '100%' }}
                  transition={
                    isSlidePaused
                      ? { duration: 0 }
                      : { duration: SLIDE_INTERVAL / 1000, ease: 'linear' }
                  }
                />
              )}
            </button>
          ))}
        </div>
        <div className={styles.arrows}>
          <button onClick={handlePrev} className={styles.arrow} aria-label="Previous slide">
            ←
          </button>
          <button onClick={handleNext} className={styles.arrow} aria-label="Next slide">
            →
          </button>
        </div>
      </div>
    </aside>
  );
}

/* ============================================================
   SLIDE 1 — Live Auctions Visual (João Pedro & Hugo Ekitiké)
   ============================================================ */
function LiveAuctionsVisual() {
  const auctions = [
    {
      player: {
        id: '00b2b501-9743-4473-9ba0-dce35927a988',
        name: 'João Pedro',
        web_name: 'João Pedro',
        primary_position: 'ST',
        pl_team: 'Chelsea',
        photo_url: 'https://resources.premierleague.com/premierleague25/photos/players/110x140/475168.png',
        ppg: 14.1,
        form_rating: 7.0,
        market_value: 65,
      },
      highest_bid: 34,
      highest_bidder_team_name: 'Holloway Utd',
      isLeading: false,
      timeRemaining: '18h 39m',
      isUrgent: false,
    },
    {
      player: {
        id: 'a6c56de0-590b-4d90-9e09-748b48bb4050',
        name: 'Hugo Ekitiké',
        web_name: 'Ekitiké',
        primary_position: 'ST',
        pl_team: 'Liverpool',
        photo_url: 'https://resources.premierleague.com/premierleague25/photos/players/110x140/510663.png',
        ppg: 12.1,
        form_rating: 6.4,
        market_value: 85,
      },
      highest_bid: 52,
      highest_bidder_team_name: 'You (Half-Court)',
      isLeading: true,
      timeRemaining: '11m 26s',
      isUrgent: true,
    }
  ];

  return (
    <div className={styles.auctionsGrid}>
      {auctions.map((auction, idx) => {
        return (
          <div
            key={idx}
            className={`${styles.auctionCard} ${auction.isUrgent ? styles.auctionCardUrgent : ''}`}
          >
            <div className={styles.auctionCardTop}>
              <div className={styles.auctionAvatarContainer}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={auction.player.photo_url}
                  alt={auction.player.web_name}
                  className={styles.auctionAvatar}
                  draggable="false"
                />
              </div>
              <div className={styles.auctionPlayerInfo}>
                <h4 className={styles.auctionPlayerName}>{auction.player.name}</h4>
                <div className={styles.auctionPlayerClub}>
                  <span className={styles.posBadgeMini} style={{ backgroundColor: 'var(--color-pos-st)' }}>
                    {auction.player.primary_position}
                  </span>
                  <span className={styles.clubNameMini}>{auction.player.pl_team}</span>
                </div>
              </div>
            </div>

            <div className={styles.auctionCardStats}>
              <div className={styles.statColMini}>
                <span className={styles.statLabelMini}>PPG</span>
                <span className={styles.statValueMini}>{auction.player.ppg.toFixed(1)}</span>
              </div>
              <div className={styles.statColMini}>
                <span className={styles.statLabelMini}>Form</span>
                <span className={styles.statValueMini}>{auction.player.form_rating.toFixed(1)}</span>
              </div>
              <div className={styles.statColMini}>
                <span className={styles.statLabelMini}>Mkt Val</span>
                <span className={styles.statValueMini}>€{auction.player.market_value}m</span>
              </div>
            </div>

            <div className={styles.auctionInfoBox}>
              <div className={styles.auctionInfoRow}>
                <div>
                  <div className={styles.auctionLabelMini}>Current Bid</div>
                  <div className={styles.auctionBidMini}>€{auction.highest_bid}m</div>
                  <div className={styles.auctionLeaderMini}>
                    {auction.highest_bidder_team_name}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div className={styles.auctionLabelMini}>Time Left</div>
                  <div
                    className={`${styles.auctionTimeMini} ${
                      auction.isUrgent ? styles.auctionTimeUrgent : ''
                    }`}
                  >
                    {auction.timeRemaining}
                  </div>
                  <div className={styles.auctionLeaderMini}>Active</div>
                </div>
              </div>
              <button className={styles.auctionBidBtnMini}>
                {auction.isLeading ? 'Raise Bid' : 'Place Bid'}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ============================================================
   SLIDE 2 — Scoring Engine Player Card Carousel (Sliding)
   ============================================================ */
function ScoutingDeckVisual() {
  const [idx, setIdx] = useState(0);
  const [cardDirection, setCardDirection] = useState(0);
  const [scale, setScale] = useState(1);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Pre-load all standard player images to browser cache immediately on mount
  useEffect(() => {
    SHOWCASE_PLAYERS.forEach((p) => {
      if (p.photo_url) {
        const img = new Image();
        img.src = p.photo_url;
      }
    });
  }, []);

  // Adjust card scaling based on layout sizing
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const parent = el.parentElement;
    if (!parent) return;

    const fit = () => {
      const availW = parent.clientWidth - 110; // Extra room for side navigation arrows
      const availH = parent.clientHeight - 40; // Clean layout without hint text
      if (availW <= 0 || availH <= 0) return;
      const s = Math.min(availW / 360, availH / 540, 1.0); // Allow scale up to 100%
      setScale(Math.max(0.45, s));
    };

    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(parent);
    window.addEventListener('resize', fit);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', fit);
    };
  }, []);

  const handleNext = (e: React.MouseEvent) => {
    e.stopPropagation();
    setCardDirection(1);
    setIdx((prev) => (prev + 1) % SHOWCASE_PLAYERS.length);
  };

  const handlePrev = (e: React.MouseEvent) => {
    e.stopPropagation();
    setCardDirection(-1);
    setIdx((prev) => (prev - 1 + SHOWCASE_PLAYERS.length) % SHOWCASE_PLAYERS.length);
  };

  const jump = (index: number) => {
    setCardDirection(index > idx ? 1 : -1);
    setIdx(index);
  };

  const activePlayer = SHOWCASE_PLAYERS[idx];

  const cardVariants = {
    enter: (dir: number) => ({
      x: dir > 0 ? 340 : -340,
      opacity: 0,
      scale: 0.96,
    }),
    center: {
      x: 0,
      opacity: 1,
      scale: 1,
      transition: {
        x: { type: 'spring' as const, stiffness: 320, damping: 28 },
        opacity: { duration: 0.2 },
        scale: { duration: 0.2 }
      }
    },
    exit: (dir: number) => ({
      x: dir < 0 ? 340 : -340,
      opacity: 0,
      scale: 0.96,
      transition: {
        x: { type: 'spring' as const, stiffness: 320, damping: 28 },
        opacity: { duration: 0.2 },
        scale: { duration: 0.2 }
      }
    })
  };

  return (
    <div className={styles.deck} ref={wrapRef}>
      <div className={styles.carouselContainer}>
        {/* Left Nav Arrow */}
        <button
          onClick={handlePrev}
          className={styles.carouselNavBtn}
          style={{ left: '-48px' }}
          aria-label="Previous Player Card"
        >
          ‹
        </button>

        {/* Centered PremiumPlayerCard with sliding transition */}
        <div className={styles.deckScale} style={{ width: 360 * scale, height: 560 * scale }}>
          <div className={styles.deckStack} style={{ transform: `scale(${scale})` }}>
            <AnimatePresence initial={false} custom={cardDirection} mode="wait">
              <motion.div
                key={activePlayer.id}
                custom={cardDirection}
                variants={cardVariants}
                initial="enter"
                animate="center"
                exit="exit"
                className={styles.deckCard}
              >
                <PremiumPlayerCard player={activePlayer} />
              </motion.div>
            </AnimatePresence>
          </div>
        </div>

        {/* Right Nav Arrow */}
        <button
          onClick={handleNext}
          className={styles.carouselNavBtn}
          style={{ right: '-48px' }}
          aria-label="Next Player Card"
        >
          ›
        </button>
      </div>

      <div className={styles.deckFoot}>
        <div className={styles.deckDots}>
          {SHOWCASE_PLAYERS.map((pl, i) => (
            <button
              key={pl.id}
              onClick={() => jump(i)}
              className={`${styles.deckDot} ${i === idx ? styles.deckDotActive : ''}`}
              aria-label={`Scout player ${pl.name}`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   SLIDE 3 — Startup Draft Visual (Authentic Board Banner & Table)
   ============================================================ */
function StartupDraftVisual() {
  return (
    <div className={styles.draftRoomLayout}>
      <header className={styles.topBanner}>
        <div className={styles.clockBlock}>
          <span className={styles.clockLabel}>ON THE CLOCK</span>
          <span className={styles.clockTime}>01:42</span>
        </div>
        <div className={styles.pickStripWrap}>
          <div className={styles.pickStrip}>
            <div className={`${styles.stripItem} ${styles.stripItemPast}`}>
              <span className={styles.stripPickLabel}>1.01</span>
              <span className={styles.stripTeamName}>HCF</span>
            </div>
            <div className={`${styles.stripItem} ${styles.stripItemCurrent}`}>
              <span className={styles.stripPickLabel}>1.02</span>
              <span className={styles.stripTeamName}>HLW</span>
            </div>
            <div className={`${styles.stripItem} ${styles.stripItemFuture}`}>
              <span className={styles.stripPickLabel}>1.03</span>
              <span className={styles.stripTeamName}>VDP</span>
            </div>
            <div className={`${styles.stripItem} ${styles.stripItemFuture}`}>
              <span className={styles.stripPickLabel}>1.04</span>
              <span className={styles.stripTeamName}>THD</span>
            </div>
          </div>
        </div>
        <div className={styles.bannerMeta}>
          <span className={styles.bannerRoundLabel}>ROUND 1 / 10</span>
          <span className={styles.bannerPickLabel}>Pick 2 of 40</span>
        </div>
      </header>

      <div className={styles.timerBar}>
        <div className={styles.timerFill} style={{ width: '70%' }} />
      </div>

      <div className={styles.mainArea}>
        <main className={styles.boardPanel}>
          <div className={styles.boardHeader}>
            <h1 className={styles.boardHeadline}>The War Room</h1>
            <p className={styles.boardSubtitle}>
              Dynasty League · Round 1/10 · 1 pick made
            </p>
          </div>
          
          <table className={styles.boardTable}>
            <thead>
              <tr>
                <th className={styles.roundHeaderCell}>RD</th>
                <th className={styles.teamHeaderCell}>HCF</th>
                <th className={`${styles.teamHeaderCell} ${styles.teamHeaderCellActive}`}>
                  <span>HLW</span>
                </th>
                <th className={styles.teamHeaderCell}>VDP</th>
                <th className={styles.teamHeaderCell}>THD</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className={styles.roundCell}>1</td>
                
                {/* Pick 1.01 - Filled */}
                <td className={`${styles.pickCell} ${styles.pickCellFilled}`}>
                  <span className={styles.cellLabel}>1.01</span>
                  <div className={styles.pickedContent}>
                    <span className={`${styles.posBadge} ${styles.posST}`} style={{ backgroundColor: 'var(--color-pos-st)' }}>
                      ST
                    </span>
                    <span className={styles.pickedName}>E. Haaland</span>
                  </div>
                </td>

                {/* Pick 1.02 - Active On the Clock */}
                <td className={`${styles.pickCell} ${styles.pickCellCurrent}`}>
                  <span className={styles.cellLabel}>1.02</span>
                  <div className={styles.onClockContent}>
                    <span className={styles.onClockDot} />
                    <span className={styles.onClockText}>SELECTING</span>
                  </div>
                </td>

                {/* Pick 1.03 - Future */}
                <td className={`${styles.pickCell} ${styles.pickCellFuture}`}>
                  <span className={styles.cellLabel}>1.03</span>
                  <span className={styles.warRoomEmptyText}>—</span>
                </td>

                {/* Pick 1.04 - Future */}
                <td className={`${styles.pickCell} ${styles.pickCellFuture}`}>
                  <span className={styles.cellLabel}>1.04</span>
                  <span className={styles.warRoomEmptyText}>—</span>
                </td>
              </tr>
              <tr>
                <td className={styles.roundCell}>2</td>
                <td className={`${styles.pickCell} ${styles.pickCellFuture}`}>
                  <span className={styles.cellLabel}>2.04</span>
                  <span className={styles.warRoomEmptyText}>—</span>
                </td>
                <td className={`${styles.pickCell} ${styles.pickCellFuture}`}>
                  <span className={styles.cellLabel}>2.03</span>
                  <span className={styles.warRoomEmptyText}>—</span>
                </td>
                <td className={`${styles.pickCell} ${styles.pickCellFuture}`}>
                  <span className={styles.cellLabel}>2.02</span>
                  <span className={styles.warRoomEmptyText}>—</span>
                </td>
                <td className={`${styles.pickCell} ${styles.pickCellFuture}`}>
                  <span className={styles.cellLabel}>2.01</span>
                  <span className={styles.warRoomEmptyText}>—</span>
                </td>
              </tr>
            </tbody>
          </table>
        </main>
      </div>
    </div>
  );
}

/* ============================================================
   SLIDE 4 — Cups In-Season Tournament Board
   ============================================================ */
function CupsBracketVisual() {
  return (
    <div className={styles.cupsContainer}>
      {/* Card 1: Champions Cup (Elite Tier - Two Legged Aggregate) */}
      <div className={styles.cupCard}>
        <div className={styles.cupHeader}>
          <span className={styles.cupEyebrow}>In-Season Tournament</span>
          <h4 className={styles.cupTitle}>Champions Cup</h4>
        </div>
        <div className={styles.cupTie}>
          <div className={styles.cupTieHeader}>Quarter-Finals · Aggregate</div>
          
          <div className={`${styles.cupRow} ${styles.cupRowWin}`}>
            <span className={styles.cupTeam}>Half-Court FC</span>
            <span className={styles.cupScore}>
              85.5 <small>(47.3 + 38.2)</small>
            </span>
          </div>
          <div className={styles.cupRow}>
            <span className={styles.cupTeam}>Vardy Party</span>
            <span className={styles.cupScore}>
              76.4 <small>(41.8 + 34.6)</small>
            </span>
          </div>
        </div>
      </div>

      {/* Card 2: League Cup (Open Knockout - Single Elimination) */}
      <div className={styles.cupCard}>
        <div className={styles.cupHeader}>
          <span className={styles.cupEyebrow}>Knockout Tournament</span>
          <h4 className={styles.cupTitle}>League Cup</h4>
        </div>
        <div className={styles.cupTie}>
          <div className={styles.cupTieHeader}>Round of 16 · Single Leg</div>
          
          <div className={styles.cupRow}>
            <span className={styles.cupTeam}>The Hairdryers</span>
            <span className={styles.cupScore}>42.6</span>
          </div>
          <div className={`${styles.cupRow} ${styles.cupRowWin}`}>
            <span className={styles.cupTeam}>Holloway Utd</span>
            <span className={styles.cupScore}>58.1</span>
          </div>
        </div>
      </div>
    </div>
  );
}
