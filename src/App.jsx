import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  startHackatimeLogin, exchangeHackatimeCode,
  getHackatimeMe, getHackatimeProjects, getHackatimeProjectHours,
  submitProject, adminCheck, adminList, adminReview, adminUserProjects,
  loadUserProjects, saveUserProjects, getMySubmissions, getPublishedGames,
  recordPlay, getPlayCounts, getComments, postComment, getGameLogs,
  getShopItems, placeShopOrder,
  adminShopItems, adminShopItemSave, adminShopItemDelete,
  adminShopOrders, adminShopOrderUpdate,
} from './api.js';

    function projectsStorageKey(email) {
      return email ? `ic_projects_${email}` : 'ic_projects';
    }

    function parseJournalField(raw) {
      if (!raw) return null;
      try {
        const entries = JSON.parse(raw);
        return Array.isArray(entries) && entries.length > 0 ? entries : null;
      } catch { return null; }
    }

    /* ─── Palette ─────────────────────────────────────────────────────────── */
    const BG      = '#0d0a1a';
    const SIDEBAR = '#130d24';
    const CARD    = '#1a1030';
    const AMBER   = '#f5c542';
    const AMBERD  = '#b8922a';
    const CORAL   = '#e05c2a';
    const CORALD  = '#a03a14';
    const PURPLE  = '#c084fc';
    const PURPLED = '#7c3aed';
    const GREEN   = '#39d98a';
    const GREEND  = '#1a7a48';
    const CREAM   = '#f0f0e8';
    const MUTED   = '#6b6870';

    // Curated genre / style tags offered as quick-pick chips when submitting a project.
    // Users can also type their own. Keep lowercase to match tag normalization.
    const PRESET_TAGS = [
      'platformer', 'shooter', 'puzzle', 'rpg', 'adventure', 'arcade',
      'strategy', 'simulation', 'racing', 'fighting', 'horror', 'rhythm',
      'roguelike', 'metroidvania', 'survival', 'sandbox', 'action', 'multiplayer',
    ];
    const MAX_TAGS = 8;

    const REVIEW = {
      UNDER: 'Under Review',
      ACCEPTED: 'Accepted',
      REJECTED: 'Rejected',
    };

    function normalizeReviewStatus(status) {
      const lower = String(status || '').toLowerCase();
      if (lower.includes('accept') || lower.includes('approv')) return 'accepted';
      if (lower.includes('reject')) return 'rejected';
      if (lower.includes('under') || lower.includes('pending') || lower.includes('review')) return 'under-review';
      return null;
    }

    function reviewStatusLabel(status) {
      if (status === 'accepted') return 'Accepted';
      if (status === 'rejected') return 'Rejected';
      if (status === 'under-review') return 'Under Review';
      return null;
    }

    function reviewStatusColor(status) {
      if (status === 'accepted') return GREEN;
      if (status === 'rejected') return CORAL;
      if (status === 'under-review') return AMBER;
      return MUTED;
    }

    function mergeSubmissionStatuses(projects, submissions) {
      if (!submissions?.length) return projects;
      return projects.map(p => {
        const match = submissions.find(s =>
          (p.airtableRecordId && s.recordId === p.airtableRecordId)
          || (s.description && (s.description.startsWith(p.name) || s.description.includes(` — ${p.description}`)))
        );
        if (!match?.reviewStatus) return p;
        const submissionStatus = normalizeReviewStatus(match.reviewStatus);
        return submissionStatus
          ? { ...p, submissionStatus, airtableRecordId: match.recordId || p.airtableRecordId }
          : p;
      });
    }
    function px(n) { return typeof n === 'number' ? `${n}px` : n; }

    function ArcadeBtn({ children, onClick, bg = AMBER, dark, style = {}, type = 'button', ...rest }) {
      const darkClr = dark || (bg === AMBER ? AMBERD : bg === CORAL ? CORALD : PURPLED);
      return (
        <button
          type={type}
          className="arcade-btn"
          onClick={onClick}
          style={{ background: bg, color: BG, borderBottom: `4px solid ${darkClr}`, ...style }}
          {...rest}
        >
          {children}
        </button>
      );
    }

    function ArcadeBtnOutline({ children, onClick, color = CORAL, style = {} }) {
      return (
        <button
          type="button"
          className="arcade-btn"
          onClick={onClick}
          style={{
            background: 'transparent',
            color,
            border: `2px solid ${color}`,
            borderBottom: `4px solid ${color}`,
            ...style,
          }}
        >
          {children}
        </button>
      );
    }

    function Cursor({ color = AMBER }) {
      return <span className="blink" style={{ color }}>_</span>;
    }

    function Badge({ children, bg, color = BG }) {
      return (
        <span style={{
          background: bg,
          color,
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: '11px',
          fontWeight: 700,
          padding: '3px 11px',
          borderRadius: 0,
          display: 'inline-block',
          lineHeight: 1.6,
        }}>
          {children}
        </span>
      );
    }

    function Label({ children, size = 10 }) {
      return (
        <div style={{
          fontFamily: "'Press Start 2P', monospace",
          fontSize: px(size),
          color: AMBER,
          marginBottom: '8px',
          lineHeight: 1.6,
        }}>
          {children}
        </div>
      );
    }

    function ScreenshotBox({ src, label, caption }) {
      return (
        <div style={{ margin: '20px 0', textAlign: 'center' }}>
          {src ? (
            <img
              src={src}
              alt={caption || label}
              style={{
                display: 'inline-block',
                /* never scale past the screenshot's native pixels (keeps it sharp),
                   but shrink to fit narrow containers */
                maxWidth: 'min(100%, 624px)',
                width: 'auto',
                height: 'auto',
                border: `1px solid ${PURPLE}`,
                borderRadius: '2px',
                verticalAlign: 'top',
              }}
            />
          ) : (
            <div style={{
              display: 'inline-block',
              border: `1px solid ${PURPLE}`,
              background: '#0a0615',
              borderRadius: '2px',
              padding: '32px 24px',
              maxWidth: '100%',
            }}>
              <p style={{
                fontFamily: "'IBM Plex Mono', monospace",
                fontStyle: 'italic',
                fontSize: '12px',
                color: PURPLE,
                lineHeight: 1.8,
                maxWidth: '480px',
                opacity: 0.85,
              }}>
                [{label}]
              </p>
            </div>
          )}
          {caption && (
            <p style={{
              fontFamily: "'IBM Plex Mono', monospace",
              fontStyle: 'italic',
              fontSize: '12px',
              color: PURPLE,
              textAlign: 'center',
              marginTop: '8px',
              lineHeight: 1.6,
            }}>
              {caption}
            </p>
          )}
        </div>
      );
    }

    /* ─── Modal wrapper ───────────────────────────────────────────────────── */
    function ModalOverlay({ children }) {
      return (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.75)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          padding: '20px',
        }}>
          <div style={{
            background: CARD,
            border: `2px solid ${AMBER}`,
            padding: '40px',
            width: '100%',
            maxWidth: '480px',
            maxHeight: '90vh',
            overflowY: 'auto',
            animation: 'fadeIn 0.2s ease',
          }}>
            {children}
          </div>
        </div>
      );
    }

    /* ─── Sign In Modal ───────────────────────────────────────────────────── */
    function SignInModal({ onClose, authError, authPending }) {
      return (
        <ModalOverlay>
          <h2 style={{ fontFamily: "'Press Start 2P'", fontSize: '16px', color: AMBER, marginBottom: '12px', lineHeight: 1.6 }}>
            PLAYER SELECT
          </h2>
          <p style={{ fontFamily: "'IBM Plex Mono'", fontSize: '13px', color: PURPLE, marginBottom: '28px', lineHeight: 1.6 }}>
            Sign in with Hackatime to track your hours and submit your project
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', alignItems: 'center' }}>
            <img src="key.png" alt="" className="sprite" style={{ width: 64, height: 'auto' }} />
            <ArcadeBtn
              bg={AMBER}
              style={{ width: '100%', fontSize: '13px', padding: '16px', opacity: authPending ? 0.6 : 1 }}
              onClick={() => !authPending && startHackatimeLogin()}
            >
              {authPending ? 'Connecting…' : 'Sign in with Hackatime'}
            </ArcadeBtn>
          </div>

          {authError && (
            <p style={{ fontSize: '12px', color: CORAL, textAlign: 'center', marginTop: '18px', fontFamily: "'IBM Plex Mono'", lineHeight: 1.6 }}>
              {authError}
            </p>
          )}

          <p style={{ fontSize: '10px', color: MUTED, textAlign: 'center', marginTop: '18px', fontFamily: "'IBM Plex Mono'", lineHeight: 1.7 }}>
            You'll be redirected to Hackatime to authorize. Your hours come straight from your Hackatime account.
          </p>
          <div
            onClick={onClose}
            style={{ textAlign: 'center', marginTop: '14px', color: MUTED, cursor: 'pointer', fontFamily: "'IBM Plex Mono'", fontSize: '13px' }}
          >
            ← CANCEL
          </div>
        </ModalOverlay>
      );
    }

    /* ─── Sidebar ─────────────────────────────────────────────────────────── */
    function Sidebar({ page, setPage, user, onSignIn, onSignOut }) {
      // Pages that require sign-in
      const PROTECTED = ['projects', 'shop', 'faq', 'tutorial', 'guidelines', 'admin'];
      const NAV = [
        { id: 'projects',   label: 'Projects'   },
        { id: 'shop',       label: 'Shop'       },
        { id: 'arcade',     label: 'Arcade'     },
        { id: 'guidelines', label: 'Guidelines' },
        { id: 'faq',        label: 'FAQ'        },
        { id: 'tutorial',   label: 'Tutorial'   },
        ...(user?.isAdmin ? [{ id: 'admin', label: 'Admin' }] : []),
      ];

      const handleNav = (id) => {
        if (!user && PROTECTED.includes(id)) { onSignIn(); return; }
        setPage(id);
      };

      return (
        <aside style={{
          width: '280px',
          minWidth: '280px',
          background: 'rgba(19,13,36,0.30)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          height: '100vh',
          position: 'sticky',
          top: 0,
          display: 'flex',
          flexDirection: 'column',
          borderRight: '1px solid rgba(192,132,252,0.18)',
          overflow: 'hidden',
          zIndex: 2,
        }}>
          {/* Logo */}
          <div
            onClick={() => setPage('home')}
            style={{ padding: '28px 20px 24px', cursor: 'pointer', borderBottom: '1px solid rgba(192,132,252,0.15)', flexShrink: 0 }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: user ? '10px' : '0' }}>
              <svg width="40" height="40" viewBox="0 0 40 40" style={{ flexShrink: 0 }}>
                <circle cx="20" cy="20" r="19" fill={AMBER} />
                <circle cx="20" cy="20" r="14" fill={AMBERD} />
                <circle cx="20" cy="20" r="10" fill={AMBER} opacity="0.6" />
                <text x="20" y="25" textAnchor="middle" fill={BG} style={{ fontFamily: "'Press Start 2P'", fontSize: '11px', fontWeight: 'bold' }}>¢</text>
              </svg>
              <span style={{ fontFamily: "'Press Start 2P', monospace", fontSize: '13px', color: AMBER, lineHeight: 1.6, letterSpacing: '-0.01em' }}>
                INSERT<br />COIN
              </span>
            </div>
            {user && (
              <div style={{ fontFamily: "'IBM Plex Mono'", fontSize: '12px', color: PURPLE, marginTop: '6px', wordBreak: 'break-all' }}>
                HELLO, {(user.username || user.email || 'PLAYER').toUpperCase()}
              </div>
            )}
          </div>

          {/* Nav */}
          <nav style={{ flex: 1, padding: '8px 4px', overflowY: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: '4px' }}>
            {NAV.map(item => {
              const active = page === item.id;
              const locked = !user && PROTECTED.includes(item.id);
              return (
                <div
                  key={item.id}
                  className={`nav-link${active ? ' active' : ''}`}
                  onClick={() => handleNav(item.id)}
                  style={{
                    opacity: locked ? 0.45 : 1,
                    display: 'flex',
                    flexDirection: 'row',
                    alignItems: 'center',
                    padding: '12px 14px',
                    gap: '10px',
                    cursor: 'pointer',
                    borderRadius: '4px',
                    outline: active ? `2px solid ${AMBER}` : '2px solid transparent',
                    outlineOffset: '2px',
                    background: active ? 'rgba(245,197,66,0.08)' : 'transparent',
                    position: 'relative',
                    overflow: 'hidden',
                  }}
                >
                  <span style={{
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: '15px',
                    color: active ? AMBER : CREAM,
                    letterSpacing: '0.04em',
                  }}>
                    {item.label}
                  </span>
                  {locked && (
                    <span style={{ position: 'absolute', top: 4, right: 6, fontSize: '11px' }}>🔒</span>
                  )}
                </div>
              );
            })}
          </nav>

          {/* Auth button */}
          <div style={{ padding: '16px 20px', borderTop: '1px solid rgba(192,132,252,0.15)', flexShrink: 0 }}>
            {user
              ? <ArcadeBtn bg={CORAL} style={{ width: '100%', fontSize: '12px' }} onClick={onSignOut}>Sign Out</ArcadeBtn>
              : <ArcadeBtn bg={CORAL} style={{ width: '100%', fontSize: '12px' }} onClick={onSignIn}>Sign In With Hackatime</ArcadeBtn>
            }
          </div>
        </aside>
      );
    }

    /* ─── Home Page ───────────────────────────────────────────────────────── */
    function HomePage({ totalHours }) {
      const pct = Math.min((totalHours / 30) * 100, 100);

      return (
        <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>

          {/* Marquee banner */}
          <div style={{
            background: AMBER,
            padding: '32px 40px',
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '32px',
          }}>
            <Sprite src="cabinet.png" size={88} style={{ opacity: 0.9, flexShrink: 0 }} />
            <div style={{ textAlign: 'center' }}>
              <h1 style={{
                fontFamily: "'Press Start 2P', monospace",
                fontSize: 'clamp(18px, 3.5vw, 34px)',
                color: BG,
                lineHeight: 1.4,
                textShadow: `3px 3px 0 ${AMBERD}`,
                letterSpacing: '0.04em',
              }}>
                INSERT COIN
              </h1>
              <p style={{ fontFamily: "'IBM Plex Mono'", fontSize: '16px', color: BG, marginTop: '12px', opacity: 0.82 }}>
                A Hack Club You Ship We Ship Game Jam
              </p>
            </div>
            <Sprite src="cabinet.png" size={88} style={{ opacity: 0.9, flexShrink: 0, transform: 'scaleX(-1)' }} />
          </div>

          {/* Body */}
          <div style={{ flex: 1, padding: '52px 40px 40px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '40px' }}>

            {/* Theme card */}
            <div style={{
              background: CARD,
              border: `1px solid ${PURPLE}`,
              padding: '40px',
              maxWidth: '720px',
              width: '100%',
              borderRadius: '4px',
            }}>
              <h2 style={{ fontFamily: "'Press Start 2P'", fontSize: '14px', color: AMBER, marginBottom: '28px', lineHeight: 1.6, textAlign: 'center' }}>
                The Challenge
              </h2>
              <p style={{ fontFamily: "'IBM Plex Mono'", fontSize: '15px', color: CREAM, lineHeight: 1.9, marginBottom: '20px' }}>
                Build a game that feels like it belongs inside a real arcade cabinet. Think coin slots, high score tables, attract mode, relentless difficulty curves, and 1–3 minute play sessions. The aesthetic, the mechanics, the soul — all of it should feel like it came straight out of a 1980s arcade.
              </p>
              <p style={{ fontFamily: "'IBM Plex Mono'", fontSize: '15px', color: CREAM, lineHeight: 1.9, marginBottom: '20px' }}>
                Your game must include: a credit/lives system, a high score leaderboard with 3-letter initials, an attract mode on the title screen, and punishing difficulty that ramps over time.
              </p>
              <p style={{ fontFamily: "'IBM Plex Mono'", fontSize: '15px', color: CREAM, lineHeight: 1.9 }}>
                The website you build for your game is just as important as the game itself. It should look like the cabinet — marquee header, CRT screen section, side art panels. You ship both.
              </p>
            </div>

            {/* Mystery / lock card */}
            <div style={{
              background: CARD,
              border: `2px solid ${AMBER}`,
              padding: '40px',
              maxWidth: '720px',
              width: '100%',
              borderRadius: '4px',
              position: 'relative',
              overflow: 'hidden',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '20px' }}>
                <h2 style={{
                  fontFamily: "'Press Start 2P'",
                  fontSize: '18px',
                  color: AMBER,
                  letterSpacing: '0.2em',
                }}>
                  ? ? ?
                </h2>
                <div style={{ display: 'flex', gap: '6px', marginLeft: '8px' }}>
                  {[0,1,2].map(i => (
                    <Sprite key={i} src="heart.png" size={22}
                      style={{ opacity: totalHours >= (i+1)*10 ? 1 : 0.25, transition: 'opacity 0.4s' }} />
                  ))}
                </div>
              </div>
              <p style={{ fontFamily: "'IBM Plex Mono'", fontSize: '15px', color: CREAM, lineHeight: 1.9, marginBottom: '28px' }}>
                Log 30 hours of work to unlock the jam details.<br />
                Something is coming. Keep building.
              </p>

              {/* Progress bar */}
              <div style={{ marginBottom: '8px' }}>
                <div style={{
                  background: '#09061a',
                  height: '20px',
                  borderRadius: '2px',
                  overflow: 'hidden',
                  border: `1px solid rgba(245,197,66,0.25)`,
                }}>
                  <div
                    className="progress-fill"
                    style={{
                      width: `${pct}%`,
                      height: '100%',
                      background: pct >= 100 ? `linear-gradient(90deg, ${AMBER}, ${AMBERD})` : GREEN,
                    }}
                  />
                </div>
                <div style={{ fontFamily: "'IBM Plex Mono'", fontSize: '13px', color: AMBER, textAlign: 'right', marginTop: '6px' }}>
                  {totalHours} / 30 hours logged
                </div>
              </div>

              <div style={{ fontFamily: "'IBM Plex Mono'", fontSize: '13px', color: MUTED, marginTop: '16px' }}>
                ▓▓▓ CLASSIFIED ▓▓▓ <Cursor />
              </div>
            </div>
          </div>

          {/* Attract mode bar */}
          <div style={{ background: AMBER, padding: '7px 0', overflow: 'hidden', flexShrink: 0 }}>
            <div style={{ fontFamily: "'Press Start 2P'", fontSize: '11px', color: BG, textAlign: 'center' }}>
              ★ INSERT COIN ★ INSERT COIN ★ INSERT COIN ★ INSERT COIN ★ INSERT COIN ★ INSERT COIN ★
            </div>
          </div>
        </div>
      );
    }

    /* ─── Create Project Modal ────────────────────────────────────────────── */
    /* ─── Reusable tag picker (preset toggles + custom input) ─────────────── */
    function TagPicker({ tags, setTags }) {
      const [tagInput, setTagInput] = useState('');
      const full = tags.length >= MAX_TAGS;
      const addCustom = () => {
        const t = tagInput.trim().toLowerCase().replace(/[^a-z0-9\-]/g, '');
        if (t && !tags.includes(t) && tags.length < MAX_TAGS) setTags(prev => [...prev, t]);
        setTagInput('');
      };
      return (
        <div>
          {/* Preset tag toggles */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '10px' }}>
            {PRESET_TAGS.map(tag => {
              const active = tags.includes(tag);
              return (
                <button
                  key={tag}
                  type="button"
                  disabled={!active && full}
                  onClick={() => setTags(prev =>
                    prev.includes(tag)
                      ? prev.filter(t => t !== tag)
                      : (prev.length < MAX_TAGS ? [...prev, tag] : prev))}
                  style={{
                    fontFamily: "'IBM Plex Mono'", fontSize: '11px',
                    background: active ? PURPLE : `${PURPLE}18`,
                    color: active ? BG : PURPLE,
                    border: `1px solid ${active ? PURPLE : `${PURPLE}44`}`,
                    borderRadius: '3px', padding: '3px 9px',
                    cursor: (!active && full) ? 'not-allowed' : 'pointer',
                    opacity: (!active && full) ? 0.4 : 1,
                    transition: 'background 0.12s, color 0.12s',
                  }}
                >{tag}</button>
              );
            })}
          </div>
          {/* Custom (non-preset) selected tags, removable */}
          {tags.some(t => !PRESET_TAGS.includes(t)) && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '8px' }}>
              {tags.filter(t => !PRESET_TAGS.includes(t)).map(tag => (
                <span key={tag} style={{
                  display: 'inline-flex', alignItems: 'center', gap: '5px',
                  fontFamily: "'IBM Plex Mono'", fontSize: '11px',
                  background: `${PURPLE}22`, color: PURPLE,
                  border: `1px solid ${PURPLE}55`, borderRadius: '3px',
                  padding: '3px 8px',
                }}>
                  {tag}
                  <button
                    type="button"
                    onClick={() => setTags(prev => prev.filter(t => t !== tag))}
                    style={{ background: 'none', border: 'none', color: PURPLE, cursor: 'pointer', padding: '0', lineHeight: 1, fontSize: '13px' }}
                  >×</button>
                </span>
              ))}
            </div>
          )}
          <input
            type="text"
            value={tagInput}
            onChange={e => setTagInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addCustom(); }
            }}
            placeholder="add a custom tag…"
            disabled={full}
            style={{ width: '100%' }}
          />
          <div style={{ fontFamily: "'IBM Plex Mono'", fontSize: '10px', color: MUTED, marginTop: '6px' }}>
            {tags.length}/{MAX_TAGS} selected
          </div>
        </div>
      );
    }

    function CreateProjectPage({ onCreate, onCancel, htProjects = [] }) {
      const [name,       setName]       = useState('');
      const [desc,       setDesc]       = useState('');
      const [preview,    setPreview]    = useState(null);
      const [htProject,  setHtProject]  = useState('');
      const [tags,       setTags]       = useState([]);

      const chosen = htProjects.find(p => (p.name || p.key) === htProject);
      const chosenHours = chosen
        ? +((chosen.total_seconds || 0) / 3600).toFixed(1)
        : 0;

      const handleFile = e => {
        const f = e.target.files[0];
        if (f) setPreview(URL.createObjectURL(f));
      };

      const handleSubmit = e => {
        e.preventDefault();
        if (!name.trim() || !htProject) return;
        onCreate({
          id: Date.now(),
          name: name.trim(),
          description: desc.trim(),
          headerImage: preview,
          hours: chosenHours,
          journalEntries: [],
          hackatimeProject: htProject,
          tags,
        });
      };

      return (
        <div className="fade-in" style={{ padding: '48px 40px 60px', maxWidth: '640px' }}>
          <button
            onClick={onCancel}
            style={{ background: 'none', border: 'none', color: PURPLE, cursor: 'pointer', fontFamily: "'IBM Plex Mono'", fontSize: '14px', marginBottom: '32px', display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            ← Back to Projects
          </button>

          <h1 style={{ fontFamily: "'Press Start 2P'", fontSize: '18px', color: AMBER, marginBottom: '40px', lineHeight: 1.5 }}>
            NEW PROJECT
          </h1>

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            <div>
              <Label>PROJECT NAME</Label>
              <input type="text" value={name} onChange={e => setName(e.target.value)} style={{ width: '100%' }} required autoFocus />
            </div>

            <div>
              <Label>DESCRIPTION</Label>
              <textarea value={desc} onChange={e => setDesc(e.target.value)} rows={5} style={{ width: '100%' }} />
            </div>

            <div>
              <Label>TAGS</Label>
              <p style={{ fontFamily: "'IBM Plex Mono'", fontSize: '11px', color: MUTED, marginBottom: '8px', lineHeight: 1.7 }}>
                Pick genre / style tags for your game, or type your own. Up to {MAX_TAGS}.
              </p>
              <TagPicker tags={tags} setTags={setTags} />
            </div>

            <div>
              <Label>HEADER IMAGE</Label>
              <input type="file" accept="image/*" onChange={handleFile} style={{ width: '100%', cursor: 'pointer' }} />
              {preview && (
                <img src={preview} alt="preview"
                  style={{ width: '100%', height: '160px', objectFit: 'cover', marginTop: '12px', border: `1px solid ${PURPLE}` }} />
              )}
            </div>

            {htProjects.length === 0 ? (
              <p style={{ fontFamily: "'IBM Plex Mono'", fontSize: '13px', color: CORAL, lineHeight: 1.7 }}>
                No Hackatime projects found on your account. Create a project in Hackatime first, then come back here.
              </p>
            ) : (
              <div>
                <Label>LINK TO HACKATIME PROJECT</Label>
                <select value={htProject} onChange={e => setHtProject(e.target.value)} style={{ width: '100%' }} required>
                  <option value="">— select a Hackatime project —</option>
                  {htProjects.map((p, i) => {
                    const n = p.name || p.key || `project ${i + 1}`;
                    const h = p.total_seconds ? (p.total_seconds / 3600).toFixed(1) : (p.hours || 0);
                    return <option key={i} value={n}>{n} ({h}h tracked)</option>;
                  })}
                </select>
              </div>
            )}

            <div style={{ display: 'flex', gap: '16px', alignItems: 'center', marginTop: '8px' }}>
              <ArcadeBtn type="submit" bg={AMBER} style={{ flex: 1, fontSize: '14px', padding: '16px', opacity: (!htProject || htProjects.length === 0) ? 0.5 : 1 }} disabled={!htProject || htProjects.length === 0}>Insert Project</ArcadeBtn>
              <button type="button" onClick={onCancel}
                style={{ background: 'none', border: 'none', color: MUTED, cursor: 'pointer', fontFamily: "'IBM Plex Mono'", fontSize: '13px' }}>
                ← CANCEL
              </button>
            </div>
          </form>
        </div>
      );
    }

    /* ─── Project Detail ──────────────────────────────────────────────────── */
    function ProjectDetail({ project, onBack, onSetHours, onAddEntry, onSetTags, userToken }) {
      const [entryText, setEntryText] = useState('');
      const [syncing,   setSyncing]   = useState(false);
      const [syncMsg,   setSyncMsg]   = useState(null);

      // Once submitted (under review or accepted) the project is locked from edits.
      const isLocked = project.submissionStatus === 'under-review' || project.submissionStatus === 'accepted';

      // Adapter so TagPicker (functional or plain setter) routes back to project state.
      const setTags = (updater) => {
        const current = project.tags || [];
        const next = typeof updater === 'function' ? updater(current) : updater;
        onSetTags?.(project.id, next);
      };

      const syncHackatime = async () => {
        if (!userToken || !project.hackatimeProject) return;
        setSyncing(true);
        setSyncMsg(null);
        try {
          const result = await getHackatimeProjectHours(userToken, project.hackatimeProject);
          onSetHours(project.id, result.hours || 0);
        } catch {
          setSyncMsg('Could not sync hours');
        } finally { setSyncing(false); }
      };

      useEffect(() => {
        if (!userToken || !project.hackatimeProject) return;
        let cancelled = false;
        (async () => {
          setSyncing(true);
          setSyncMsg(null);
          try {
            const result = await getHackatimeProjectHours(userToken, project.hackatimeProject);
            if (!cancelled) {
              onSetHours(project.id, result.hours || 0);
            }
          } catch {
            if (!cancelled) setSyncMsg('Could not sync hours');
          } finally {
            if (!cancelled) setSyncing(false);
          }
        })();
        return () => { cancelled = true; };
      }, [userToken, project.id, project.hackatimeProject, onSetHours]);

      const doEntry = () => {
        if (!entryText.trim()) return;
        onAddEntry(project.id, entryText.trim());
        setEntryText('');
      };

      return (
        <div className="fade-in">
          {/* Banner */}
          {project.headerImage
            ? <img src={project.headerImage} alt={project.name}
                style={{ width: '100%', height: '280px', objectFit: 'cover', display: 'block' }} />
            : (
              <div style={{
                width: '100%', height: '200px', background: '#0a0615',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                borderBottom: `1px solid ${PURPLE}`,  
              }}>
                <span style={{ fontFamily: "'Press Start 2P'", fontSize: '13px', color: AMBER, opacity: 0.35 }}>NO HEADER</span>
              </div>
            )
          }

          <div style={{ padding: '32px 40px 60px' }}>
            <button
              onClick={onBack}
              style={{ background: 'none', border: 'none', color: PURPLE, cursor: 'pointer', fontFamily: "'IBM Plex Mono'", fontSize: '14px', marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '6px' }}
            >
              ← Back to Projects
            </button>

            <h1 style={{ fontFamily: "'Press Start 2P'", fontSize: '22px', color: AMBER, marginBottom: '16px', lineHeight: 1.4 }}>
              {project.name}
            </h1>

            {project.submissionStatus && reviewStatusLabel(project.submissionStatus) && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: '12px',
                background: 'rgba(0,0,0,0.25)',
                border: `2px solid ${reviewStatusColor(project.submissionStatus)}`,
                borderRadius: '6px', padding: '16px 20px', marginBottom: '24px',
              }}>
                <span style={{
                  fontFamily: "'IBM Plex Mono'", fontSize: '12px', fontWeight: 700,
                  color: BG, background: reviewStatusColor(project.submissionStatus),
                  padding: '4px 12px', borderRadius: 0, whiteSpace: 'nowrap',
                }}>
                  {reviewStatusLabel(project.submissionStatus)}
                </span>
                <span style={{ fontFamily: "'IBM Plex Mono'", fontSize: '13px', color: CREAM, lineHeight: 1.6 }}>
                  {project.submissionStatus === 'under-review' && 'Submitted to the jam — an organizer is reviewing your project.'}
                  {project.submissionStatus === 'accepted' && 'Your project was accepted into the jam!'}
                  {project.submissionStatus === 'rejected' && 'This submission was rejected. You can update your project and submit again.'}
                </span>
              </div>
            )}

            {project.description && (
              <p style={{ fontFamily: "'IBM Plex Mono'", fontSize: '15px', color: CREAM, lineHeight: 1.9, marginBottom: '36px', maxWidth: '680px' }}>
                {project.description}
              </p>
            )}

            {/* Hours block — Hackatime only */}
            <div style={{ background: CARD, border: `1px solid ${PURPLE}`, padding: '28px', marginBottom: '44px', borderRadius: '4px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                    <Sprite src="bolt.png" size={20} />
                    <span style={{ fontFamily: "'Press Start 2P'", fontSize: '10px', color: AMBER }}>HACKATIME HOURS</span>
                  </div>
                  <div style={{ fontFamily: "'IBM Plex Mono'", fontSize: '36px', fontWeight: 700, color: GREEN }}>{project.hours}</div>
                </div>
                {project.hackatimeProject && !isLocked && (
                  <ArcadeBtn bg={GREEN} dark={GREEND} style={{ fontSize: '12px' }} onClick={syncHackatime}>
                    {syncing ? 'Syncing…' : '↻ Sync Hackatime'}
                  </ArcadeBtn>
                )}
              </div>
              {syncMsg && (
                <p style={{ fontFamily: "'IBM Plex Mono'", fontSize: '12px', color: CORAL, marginTop: '12px' }}>{syncMsg}</p>
              )}
            </div>

            {/* Tags — editable until the project is submitted */}
            <div style={{ marginBottom: '44px' }}>
              <h2 style={{ fontFamily: "'Press Start 2P'", fontSize: '13px', color: AMBER, marginBottom: '16px' }}>
                Tags
              </h2>
              {isLocked ? (
                project.tags?.length > 0 ? (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                    {project.tags.map(tag => (
                      <span key={tag} style={{
                        fontFamily: "'IBM Plex Mono'", fontSize: '11px',
                        background: `${PURPLE}18`, color: PURPLE,
                        border: `1px solid ${PURPLE}44`, borderRadius: '3px',
                        padding: '3px 9px',
                      }}>{tag}</span>
                    ))}
                  </div>
                ) : (
                  <p style={{ fontFamily: "'IBM Plex Mono'", fontSize: '13px', color: MUTED, fontStyle: 'italic' }}>
                    No tags were set for this project.
                  </p>
                )
              ) : (
                <>
                  <p style={{ fontFamily: "'IBM Plex Mono'", fontSize: '11px', color: MUTED, marginBottom: '10px', lineHeight: 1.7 }}>
                    Pick genre / style tags for your game, or type your own. Up to {MAX_TAGS}.
                  </p>
                  <TagPicker tags={project.tags || []} setTags={setTags} />
                </>
              )}
            </div>

            {/* Captain's Log */}
            <h2 style={{ fontFamily: "'Press Start 2P'", fontSize: '13px', color: AMBER, marginBottom: '24px' }}>
               Log
            </h2>

            {project.journalEntries.length === 0 && (
              <p style={{ fontFamily: "'IBM Plex Mono'", fontSize: '14px', color: MUTED, marginBottom: '24px', fontStyle: 'italic' }}>
                {isLocked ? 'No entries were logged for this project.' : 'No entries yet. Document your voyage.'}
              </p>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', marginBottom: '28px' }}>
              {project.journalEntries.map((entry, i) => (
                <div key={i} style={{
                  background: '#0f0820',
                  border: `1px solid rgba(192,132,252,0.25)`,
                  padding: '16px 20px',
                  borderRadius: '2px',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <div style={{ fontFamily: "'IBM Plex Mono'", fontSize: '11px', color: PURPLE }}>{entry.date}</div>
                  </div>
                  <div style={{ fontFamily: "'IBM Plex Mono'", fontSize: '14px', color: CREAM, lineHeight: 1.7 }}>{entry.text}</div>
                </div>
              ))}
            </div>

            {/* Add entry — locked once the project has been submitted */}
            {isLocked ? (
              <p style={{ fontFamily: "'IBM Plex Mono'", fontSize: '13px', color: MUTED, fontStyle: 'italic' }}>
                This project has been submitted and can no longer be edited.
              </p>
            ) : (
              <>
                <textarea
                  rows={3} placeholder="What did you work on today?"
                  value={entryText} onChange={e => setEntryText(e.target.value)}
                  style={{ width: '100%', marginBottom: '12px' }}
                />
                <ArcadeBtn bg={PURPLE} dark={PURPLED} style={{ fontSize: '12px' }} onClick={doEntry}>
                  Add Entry
                </ArcadeBtn>
              </>
            )}
          </div>
        </div>
      );
    }

    /* ─── Projects Page ───────────────────────────────────────────────────── */
    function ProjectsPage({ projects, totalHours, pendingHours, onCreate, onView, onSetHours, onAddEntry, onSetTags, currentProject, onOpenCreateModal, onSubmitToJam, userToken, user }) {
      const pct = Math.min((totalHours / 30) * 100, 100);
      const qualified = totalHours >= 30;
      const activeProjects  = projects.filter(p => p.submissionStatus !== 'under-review' && p.submissionStatus !== 'accepted');
      const reviewProjects  = projects.filter(p => p.submissionStatus === 'under-review');
      const doneProjects    = projects.filter(p => p.submissionStatus === 'accepted');

      // Play counts for accepted projects
      const [playCounts, setPlayCounts] = useState({});
      const acceptedIds = doneProjects.filter(p => p.airtableRecordId).map(p => p.airtableRecordId);
      useEffect(() => {
        if (acceptedIds.length === 0) return;
        getPlayCounts(acceptedIds).then(d => setPlayCounts(d.counts || {})).catch(() => {});
      // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [acceptedIds.join(',')]);

      // Comments open state per accepted project
      const [commentsOpen, setCommentsOpen] = useState({});

      const proj = currentProject ? projects.find(p => p.id === currentProject) : null;
      if (proj) {
        return (
          <ProjectDetail
            project={proj}
            onBack={() => onView(null)}
            onSetHours={onSetHours}
            onAddEntry={onAddEntry}
            onSetTags={onSetTags}
            userToken={userToken}
          />
        );
      }

      return (
        <div className="fade-in" style={{ padding: '48px 40px 60px' }}>

          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '24px', marginBottom: '10px', flexWrap: 'wrap' }}>
            <img src="projects.png" alt="Projects" className="sprite" style={{ width: 140, height: 'auto' }} />
            <div style={{ flex: 1 }}>
              <h1 style={{ fontFamily: "'Press Start 2P'", fontSize: '28px', color: CREAM, marginBottom: '10px', lineHeight: 1.4 }}>
                Projects
              </h1>
              <p style={{ fontFamily: "'IBM Plex Mono'", fontSize: '16px', color: PURPLE }}>
                track your progress and hours
              </p>
            </div>
            <ArcadeBtn bg={GREEN} dark={GREEND} style={{ fontSize: '12px' }} onClick={onSubmitToJam}>
              ★ Submit To Jam
            </ArcadeBtn>
          </div>
          <div style={{ marginBottom: '44px' }} />

          {/* Progress bar */}
          <div style={{ marginBottom: '52px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              <div style={{ flex: 1, background: CARD, height: '20px', borderRadius: '4px', overflow: 'hidden', border: `1px solid rgba(192,132,252,0.2)` }}>
                <div
                  className="progress-fill"
                  style={{
                    width: `${pct}%`,
                    height: '100%',
                    background: qualified ? `linear-gradient(90deg, ${AMBER}, ${AMBERD})` : GREEN,
                    borderRadius: '4px',
                    transition: 'width 0.5s ease',
                  }}
                />
              </div>
              <div style={{ fontFamily: "'IBM Plex Mono'", fontSize: '14px', color: qualified ? GREEN : AMBER, whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Sprite src="bolt.png" size={16} />
                {qualified
                  ? <span className="qualified">QUALIFIED ✓</span>
                  : `${totalHours} / 30 hrs`
                }
              </div>
            </div>
            {pendingHours > 0 && (
              <div style={{ marginTop: '10px', fontFamily: "'IBM Plex Mono'", fontSize: '12px', color: AMBER, display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ opacity: 0.7 }}>⏳</span>
                {pendingHours}h pending review — hours will count once your submission is accepted
              </div>
            )}
          </div>

          {/* ── Active projects grid ── */}
          {activeProjects.length > 0 && (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
              gap: '24px',
              marginBottom: '40px',
            }}>
              {activeProjects.map(p => (
                <div key={p.id} className="project-card" style={{
                  background: CARD,
                  border: `1px solid ${PURPLE}`,
                  borderRadius: '8px',
                  overflow: 'hidden',
                }}>
                  {p.headerImage
                    ? <img src={p.headerImage} alt={p.name}
                        style={{ width: '100%', height: '148px', objectFit: 'cover', display: 'block' }} />
                    : (
                      <div style={{ width: '100%', height: '148px', background: '#09061a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <span style={{ fontFamily: "'Press Start 2P'", fontSize: '10px', color: AMBER, opacity: 0.35 }}>NO HEADER</span>
                      </div>
                    )
                  }
                  <div style={{ padding: '20px' }}>
                    <h3 style={{ fontFamily: "'Press Start 2P'", fontSize: '11px', color: AMBER, marginBottom: '10px', lineHeight: 1.7 }}>{p.name}</h3>
                    {p.description && (
                      <p style={{
                        fontFamily: "'IBM Plex Mono'", fontSize: '13px', color: CREAM, lineHeight: 1.7, marginBottom: '14px',
                        display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                      }}>
                        {p.description}
                      </p>
                    )}
                    <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
                      <span style={{
                        background: CORAL, color: 'white',
                        fontFamily: "'IBM Plex Mono'", fontSize: '11px', fontWeight: 700,
                        padding: '3px 10px', borderRadius: 0,
                        display: 'inline-flex', alignItems: 'center', gap: '5px',
                      }}>
                        <Sprite src="heart.png" size={12} />{p.hours}h
                      </span>
                      {p.submissionStatus && reviewStatusLabel(p.submissionStatus) && (
                        <span style={{
                          background: reviewStatusColor(p.submissionStatus),
                          color: BG,
                          fontFamily: "'IBM Plex Mono'", fontSize: '11px', fontWeight: 700,
                          padding: '3px 10px', borderRadius: 0,
                        }}>
                          {reviewStatusLabel(p.submissionStatus)}
                        </span>
                      )}
                      <Badge bg={PURPLE} color={BG}>{p.journalEntries.length} entries</Badge>
                    </div>
                    {p.tags?.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', marginBottom: '4px' }}>
                        {p.tags.map(tag => (
                          <span key={tag} style={{
                            fontFamily: "'IBM Plex Mono'", fontSize: '10px',
                            background: `${PURPLE}18`, color: PURPLE,
                            border: `1px solid ${PURPLE}44`, borderRadius: '3px',
                            padding: '2px 7px',
                          }}>{tag}</span>
                        ))}
                      </div>
                    )}
                    <ArcadeBtn bg={AMBER} style={{ width: '100%', fontSize: '12px' }} onClick={() => onView(p.id)}>
                      VIEW ›
                    </ArcadeBtn>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ── Under Review section ── */}
          {reviewProjects.length > 0 && (
            <div style={{ marginBottom: '48px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
                <h2 style={{ fontFamily: "'Press Start 2P'", fontSize: '12px', color: AMBER, lineHeight: 1.5, margin: 0 }}>
                  Under Review
                </h2>
                <span style={{
                  fontFamily: "'IBM Plex Mono'", fontSize: '11px',
                  background: `${AMBER}22`, color: AMBER,
                  border: `1px solid ${AMBER}55`, borderRadius: '2px',
                  padding: '2px 8px',
                }}>{reviewProjects.length}</span>
              </div>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
                gap: '24px',
              }}>
                {reviewProjects.map(p => (
                  <div key={p.id} className="project-card" style={{
                    background: CARD,
                    border: `1px solid ${AMBER}66`,
                    borderRadius: '8px',
                    overflow: 'hidden',
                    opacity: 0.85,
                  }}>
                    {p.headerImage
                      ? <img src={p.headerImage} alt={p.name}
                          style={{ width: '100%', height: '148px', objectFit: 'cover', display: 'block', filter: 'grayscale(20%)' }} />
                      : (
                        <div style={{ width: '100%', height: '148px', background: '#09061a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <span style={{ fontFamily: "'Press Start 2P'", fontSize: '10px', color: AMBER, opacity: 0.35 }}>UNDER REVIEW</span>
                        </div>
                      )
                    }
                    <div style={{ padding: '20px' }}>
                      <h3 style={{ fontFamily: "'Press Start 2P'", fontSize: '11px', color: AMBER, marginBottom: '10px', lineHeight: 1.7 }}>{p.name}</h3>
                      {p.description && (
                        <p style={{
                          fontFamily: "'IBM Plex Mono'", fontSize: '13px', color: MUTED, lineHeight: 1.7, marginBottom: '14px',
                          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                        }}>
                          {p.description}
                        </p>
                      )}
                      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
                        <span style={{
                          background: `${AMBER}22`, color: AMBER,
                          border: `1px solid ${AMBER}55`,
                          fontFamily: "'IBM Plex Mono'", fontSize: '11px', fontWeight: 700,
                          padding: '3px 10px', borderRadius: 0,
                          display: 'inline-flex', alignItems: 'center', gap: '5px',
                        }}>
                          ⏳ {p.hours}h pending
                        </span>
                        <span style={{
                          background: AMBER, color: BG,
                          fontFamily: "'IBM Plex Mono'", fontSize: '11px', fontWeight: 700,
                          padding: '3px 10px', borderRadius: 0,
                        }}>
                          Under Review
                        </span>
                      </div>
                      {p.tags?.length > 0 && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', marginBottom: '12px' }}>
                          {p.tags.map(tag => (
                            <span key={tag} style={{
                              fontFamily: "'IBM Plex Mono'", fontSize: '10px',
                              background: `${PURPLE}18`, color: PURPLE,
                              border: `1px solid ${PURPLE}44`, borderRadius: '3px',
                              padding: '2px 7px',
                            }}>{tag}</span>
                          ))}
                        </div>
                      )}
                      <ArcadeBtn bg={MUTED} dark={'#3a3840'} style={{ width: '100%', fontSize: '12px' }} onClick={() => onView(p.id)}>
                        VIEW ›
                      </ArcadeBtn>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Published section ── */}
          {doneProjects.length > 0 && (
            <div style={{ marginBottom: '48px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
                <h2 style={{ fontFamily: "'Press Start 2P'", fontSize: '12px', color: AMBER, lineHeight: 1.5, margin: 0 }}>
                  Published
                </h2>
                <span style={{
                  fontFamily: "'IBM Plex Mono'", fontSize: '11px',
                  background: `${AMBER}22`, color: AMBER,
                  border: `1px solid ${AMBER}55`, borderRadius: '2px',
                  padding: '2px 8px',
                }}>{doneProjects.length}</span>
              </div>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
                gap: '24px',
              }}>
                {doneProjects.map(p => (
                  <div key={p.id} className="project-card" style={{
                    background: CARD,
                    border: `2px solid ${AMBER}`,
                    borderRadius: '8px',
                    overflow: 'hidden',
                  }}>
                    {p.itchUrl ? (
                      <iframe
                        src={p.itchUrl}
                        width="100%"
                        height="167"
                        frameBorder="0"
                        allowFullScreen
                        style={{ display: 'block' }}
                      />
                    ) : (
                      <div style={{ width: '100%', height: '148px', background: '#09061a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <span style={{ fontFamily: "'Press Start 2P'", fontSize: '10px', color: AMBER, opacity: 0.35 }}>PUBLISHED</span>
                      </div>
                    )}
                    <div style={{ padding: '20px' }}>
                      <h3 style={{ fontFamily: "'Press Start 2P'", fontSize: '11px', color: AMBER, marginBottom: '10px', lineHeight: 1.7 }}>{p.name}</h3>
                      <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
                        <span style={{ background: AMBER, color: BG, fontFamily: "'IBM Plex Mono'", fontSize: '11px', fontWeight: 700, padding: '3px 10px', borderRadius: 0 }}>
                          ✓ Accepted
                        </span>
                        <span style={{ background: CORAL, color: 'white', fontFamily: "'IBM Plex Mono'", fontSize: '11px', fontWeight: 700, padding: '3px 10px', borderRadius: 0, display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                          <Sprite src="heart.png" size={12} />{p.hours}h
                        </span>
                        {p.airtableRecordId && (
                          <span style={{ background: PURPLE, color: BG, fontFamily: "'IBM Plex Mono'", fontSize: '11px', fontWeight: 700, padding: '3px 10px', borderRadius: 0 }}>
                            🎮 {playCounts[p.airtableRecordId] ?? '…'} plays
                          </span>
                        )}
                      </div>
                      {p.tags?.length > 0 && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', marginBottom: '10px' }}>
                          {p.tags.map(tag => (
                            <span key={tag} style={{
                              fontFamily: "'IBM Plex Mono'", fontSize: '10px',
                              background: `${PURPLE}18`, color: PURPLE,
                              border: `1px solid ${PURPLE}44`, borderRadius: '3px',
                              padding: '2px 7px',
                            }}>{tag}</span>
                          ))}
                        </div>
                      )}
                      {p.itchUrl && (
                        <a href={p.itchUrl} target="_blank" rel="noopener noreferrer"
                          style={{ fontFamily: "'IBM Plex Mono'", fontSize: '12px', color: AMBER, textDecoration: 'none', display: 'block', marginBottom: '10px' }}>
                          Play on itch.io ↗
                        </a>
                      )}
                      {/* Comments toggle */}
                      {p.airtableRecordId && (
                        <div>
                          <button
                            onClick={() => setCommentsOpen(prev => ({ ...prev, [p.id]: !prev[p.id] }))}
                            style={{
                              fontFamily: "'IBM Plex Mono'", fontSize: '11px',
                              background: 'transparent', color: PURPLE,
                              border: `1px solid ${PURPLE}55`, borderBottom: `3px solid ${PURPLE}55`,
                              padding: '6px 12px', cursor: 'pointer', borderRadius: '3px',
                              width: '100%', textAlign: 'left',
                            }}
                          >
                            💬 {commentsOpen[p.id] ? 'Hide Comments' : 'View Comments'}
                          </button>
                          {commentsOpen[p.id] && (
                            <div style={{ marginTop: '12px' }}>
                              <GameComments gameId={p.airtableRecordId} user={user} readOnly />
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Create area */}
          <div style={{
            border: `2px dashed ${PURPLE}`,
            background: 'rgba(26,16,48,0.4)',
            padding: '56px 40px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: '4px',
            maxWidth: '480px',
            margin: '0 auto',
          }}>
            <ArcadeBtn bg={CORAL} style={{ fontSize: '16px', padding: '16px 44px' }} onClick={() => onOpenCreateModal()}>
              + Create Project
            </ArcadeBtn>
          </div>
        </div>
      );
    }

    /* ─── Tutorial Page ───────────────────────────────────────────────────── */

    // ── DropBox ────────────────────────────────────────────────────────────
    function DropBox({ title, children }) {
      const [open, setOpen] = useState(false);
      return (
        <div style={{ border: `1px solid ${AMBER}`, borderRadius: '2px', margin: '16px 0', overflow: 'hidden' }}>
          <button
            onClick={() => setOpen(o => !o)}
            style={{
              width: '100%', textAlign: 'left', padding: '11px 16px',
              background: open ? 'rgba(245,197,66,0.12)' : 'rgba(245,197,66,0.06)',
              color: AMBER, border: 'none', cursor: 'pointer',
              fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px', fontWeight: 700,
              display: 'flex', alignItems: 'center', gap: '10px',
            }}
          >
            <span style={{ transition: 'transform 0.2s', transform: open ? 'rotate(90deg)' : 'none', display: 'inline-block', fontSize: '10px' }}>▶</span>
            {title}
          </button>
          {open && (
            <div style={{
              padding: '16px 20px', borderTop: `1px solid rgba(245,197,66,0.25)`,
              background: 'rgba(13,10,26,0.6)',
              fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px',
              color: CREAM, lineHeight: 1.9, whiteSpace: 'pre-line',
            }}>
              {children}
            </div>
          )}
        </div>
      );
    }

    // ── Step list renderer ─────────────────────────────────────────────────
    function StepsList({ steps }) {
      return (
        <div style={{ position: 'relative', paddingLeft: '4px' }}>
          <div className="timeline-line" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: '44px' }}>
            {steps.map(step => (
              <div key={step.num} style={{ display: 'flex', gap: '28px' }}>
                <div style={{
                  width: '32px', height: '32px', minWidth: '32px',
                  borderRadius: 0, background: GREEN,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontFamily: "'Press Start 2P'", fontSize: '11px', color: BG,
                  zIndex: 1, marginTop: '2px',
                }}>
                  {step.num}
                </div>
                <div style={{
                  flex: 1, background: CARD,
                  border: `1px solid rgba(192,132,252,0.3)`,
                  padding: '28px', borderRadius: '4px',
                }}>
                  <h3 style={{ fontFamily: "'Press Start 2P'", fontSize: '11px', color: AMBER, marginBottom: '16px', lineHeight: 1.7 }}>
                    {step.heading}
                  </h3>
                  <p style={{ fontFamily: "'IBM Plex Mono'", fontSize: '14px', color: CREAM, lineHeight: 1.9, marginBottom: '4px', whiteSpace: 'pre-line' }}>
                    {step.body}
                  </p>
                  {step.dropbox && <DropBox title={step.dropbox.title}>{step.dropbox.content}</DropBox>}
                  {step.src && <ScreenshotBox src={step.src} label={step.label || ''} caption={step.caption} />}
                </div>
              </div>
            ))}
          </div>
        </div>
      );
    }

    // ── Workflow nav ───────────────────────────────────────────────────────
    function WorkflowNav({ section, setSection }) {
      const Node = ({ id, label, locked }) => {
        const active = section === id;
        return (
          <div onClick={() => setSection(id)} style={{
            background: active ? AMBER : CARD,
            border: `2px solid ${active ? AMBERD : locked ? MUTED : PURPLE}`,
            padding: '14px 16px', cursor: 'pointer', textAlign: 'center',
            minWidth: '120px', borderRadius: '4px', transition: 'all 0.15s',
            opacity: locked ? 0.6 : 1,
          }}>
            <div style={{ fontFamily: "'Press Start 2P'", fontSize: '8px', color: active ? BG : locked ? MUTED : CREAM, lineHeight: 1.8 }}>
              {label}
            </div>
            {locked && <div style={{ fontSize: '12px', marginTop: '4px' }}>🔒</div>}
          </div>
        );
      };
      const Arrow = () => (
        <div style={{ color: PURPLE, fontSize: '20px', display: 'flex', alignItems: 'center', userSelect: 'none' }}>→</div>
      );
      return (
        <div style={{
          padding: '24px 40px', display: 'flex', alignItems: 'center', gap: '12px',
          borderBottom: `1px solid rgba(192,132,252,0.2)`, marginBottom: '40px',
          background: 'rgba(19,13,36,0.6)', flexWrap: 'wrap',
        }}>
          <Node id="getting-started" label={"GETTING\nSTARTED"} />
          <Arrow />
          <Node id="unity-basics" label={"UNITY\nBASICS"} />
          <Arrow />
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <Node id="asteroid" label={"ASTEROID\nDESTROYER"} locked />
            <Node id="hackquest" label={"HACK\nQUEST"} locked />
          </div>
        </div>
      );
    }

    // ── Step data ──────────────────────────────────────────────────────────
    const GETTING_STARTED_STEPS = [
      { num:1, heading:'Install Unity', src:'image1.png', caption:'Install Unity Hub',
        body:'Open the Unity Hub download page and download Unity Hub for your operating system. Available for MacOS (Apple Silicon / Intel), Linux (.deb / .rpm), and Windows (x64 / Arm64). Follow the install steps for your platform.' },
      { num:2, heading:'Open Unity Hub and create a new project', src:'image2.png', caption:'Open Unity Hub and open a new project',
        body:'Once Unity Hub is installed and open, you\'ll see your Projects list. Click "+ New project" in the top right corner to begin.' },
      { num:3, heading:'Select editor version and template', src:'image3.png', caption:'Install Unity Editor 6000.2.0f1 and select Universal 2D',
        body:'In the new project dialog, set the Editor version to 6000.2.0f1. Select the Universal 2D template (Core, uses Unity\'s Universal Render Pipeline). Give your project a name and choose a save location, then click "+ Create project".' },
      { num:4, heading:'Wait for the project to build', src:'image4.png', caption:'Wait for your project to build',
        body:'Unity will open and begin installing packages. A splash screen will appear showing Unity Engine 6000.2.0f1 with a progress bar at the bottom. This may take a few minutes — don\'t close the window.' },
    ];

    const UNITY_BASICS_STEPS = [
      { num:1, heading:'Create a Square', src:'unity_1.png', caption:'Adding a square sprite via the Hierarchy',
        body:'Hover over the plus icon in the Hierarchy, go to 2D Objects > Sprites > Square. You\'ll have a square in your scene and the Inspector on the right will show its components. Go ahead and play with them.' },
      { num:2, heading:'Understanding Components', src:'unity_2.png', caption:'Inspector — Transform and Sprite Renderer',
        body:'Here\'s the breakdown:\n\nTransform — position, rotation, and size. Press W to move (drag arrows), E to rotate (drag circle), R to resize (drag squares).\n\nSprite Renderer — visual info: color, material, rendering modes.' },
      { num:3, heading:'Create a Movement Script', src:'unity_3.png', caption:'Creating a new MonoBehaviour script',
        body:'In the Project tab, right-click on an empty space and go to Create > MonoBehaviour Script. Name it "movement", then double-click to open it.' },
      { num:4, heading:'Code Basic Movement', src:'unity_4.png', caption:'transform.Translate(Vector2.up) in void Update',
        body:'Under void Update (runs every frame), add:\n\ntransform.Translate(Vector2.up)\n\nPress Ctrl+S to save. Go back to Unity, drag the script onto your square, press Play, and watch it move.',
        dropbox:{ title:'If the square isn\'t moving...', content:'Make sure the script is on your square — drag it from the Project tab onto the square in the Scene, or onto the square in the Hierarchy.' } },
      { num:5, heading:'Add Key Input', src:'unity_5.png', caption:'if (Input.GetKey) wrapping the movement call',
        body:'Wrap the movement code in an if statement so it only runs when a key is held.\n\nIf you get a "new input handling" error, go to Edit > Project Settings > Player > Active Input Handling and switch to Both.' },
      { num:6, heading:'Speed & Delta Time', src:'unity_6.png', caption:'speed variable and Time.deltaTime multiplication',
        body:'Add a public float speed = 5 at the top of your class. In the Translate call, multiply by speed * Time.deltaTime to keep movement consistent across all frame rates.',
        dropbox:{ title:'What is Time.deltaTime?', content:'Time.deltaTime is the time in seconds since the last frame.\n\nMultiplying movement by it makes your object travel the same distance per second whether the game runs at 30fps or 120fps. Without it, faster machines move the player faster.' } },
      { num:7, heading:'Inspector Properties', src:'unity_7.png', caption:'Speed property visible and editable in the Inspector',
        body:'Open the Inspector — your speed variable now appears as a tweakable property without touching code. This works for all public variables. Press Play and test.' },
      { num:8, heading:'All Four Directions', src:'unity_8.png', caption:'Four directional if statements',
        body:'Copy and paste the input + movement block three more times, changing the key (W/A/S/D or arrow keys) and direction (up/left/down/right) for each. Save and test all four.' },
      { num:9, heading:'Create a "Game Over" Object', src:'unity_9.png', caption:'Game Over object in the Hierarchy',
        body:'Create another square in the Hierarchy and rename it "Game Over". This will act as a trigger zone that ends the game when the player touches it.' },
      { num:10, heading:'Add Colliders & Set as Trigger', src:'unity_10.png', caption:'Box Collider 2D with Is Trigger checked',
        body:'Add a Box Collider 2D to both the player and the Game Over object. On the Game Over object, check the "Is Trigger" checkbox.',
        dropbox:{ title:'What is a trigger?', content:'A normal collider blocks physical movement — objects bounce off.\n\nA trigger lets objects pass through but still fires OnTriggerEnter2D on overlap.\n\nUse triggers for death zones, pickups, and checkpoints — anywhere you want to detect overlap without blocking movement.' } },
      { num:11, heading:'Add Rigidbody 2D', src:'unity_11.png', caption:'Rigidbody 2D set to Kinematic on both objects',
        body:'Add a Rigidbody 2D component to both the player and the Game Over object. Set the Body Type to Kinematic on both.',
        dropbox:{ title:'Kinematic vs Dynamic vs Static', content:'Dynamic — fully physics-driven; affected by gravity and forces. Good for thrown/falling objects.\n\nKinematic — moved by code only; not affected by physics but still detects collisions. Best for player-controlled characters.\n\nStatic — never moves. Used for level geometry like walls and floors.' } },
      { num:12, heading:'Detect the Collision', src:'unity_12.png', caption:'OnTriggerEnter2D method logging to the console',
        body:'On the Game Over object\'s script, create a void OnTriggerEnter2D(Collider2D other) method. Inside it, use Debug.Log to print a message to the console. Press Play and walk the player into the zone.' },
      { num:13, heading:'Check the Console', src:'unity_13.png', caption:'Console output confirming the collision fired',
        body:'You should see your debug message appear in the console when the player touches the Game Over object. Now let\'s make it actually do something.' },
      { num:14, heading:'Destroy the Player', src:'unity_14.png', caption:'Public player reference and Destroy(player) call',
        body:'Add a public GameObject player; reference at the top of the Game Over object\'s class. Inside OnTriggerEnter2D, call Destroy(player) to remove the player from the scene.' },
      { num:15, heading:'Assign the Player Reference', src:'unity_15.png', caption:'Dragging the player object into the Inspector slot',
        body:'Click on your Game Over object and find its script in the Inspector. You\'ll see a Player field showing "None (GameObject)". Drag the player square from the Hierarchy into that slot.' },
      { num:16, heading:'Add a Canvas', src:'unity_16.png', caption:'Canvas added and framed in the Hierarchy',
        body:'In the Hierarchy, click + > UI > Canvas. Click the canvas and press F to view it in full. This is the container for your Game Over screen UI.' },
      { num:17, heading:'Create Panel & Text', src:'unity_17.png', caption:'Dark panel with Game Over text overlaid',
        body:'Create a Panel (+ > UI > Panel). In its Image component, set the color to semi-opaque black. Then create TextMeshPro or Legacy Text. Press T in the scene to resize. Edit the text, size, and color in the component.' },
      { num:18, heading:'Group & Deactivate', src:'unity_18.png', caption:'Game Over group deactivated in the Inspector',
        body:'Ctrl+click the panel and text in the Hierarchy, right-click > Create Empty Parent to group them. Then uncheck the checkbox next to the object name in the Inspector to deactivate it at start — so the screen is hidden when the game begins.' },
      { num:19, heading:'Wire Up the Screen', src:'unity_19.png', caption:'gameOverScreen.SetActive(true) in the trigger method',
        body:'In your script, add public GameObject gameOverScreen. Inside OnTriggerEnter2D, call gameOverScreen.SetActive(true) to display the screen when the player is destroyed.' },
      { num:20, heading:'Player Tags', src:'unity_20.png', caption:'Checking collider.tag == "Player" before triggering game over',
        body:'Select your player in the Hierarchy and set its Tag to "Player". In the trigger code, check if the colliding object\'s tag matches "Player" — this prevents random objects from triggering the game over.',
        dropbox:{ title:'How to create a custom tag', content:'Go to Edit > Project Settings > Tags and Layers. Under the Tags section, click the + button and type your new tag name. Then assign it to any object via the Tag dropdown at the top of its Inspector panel.' } },
    ];

    function TutorialPage() {
      const [section, setSection] = useState('getting-started');

      return (
        <div className="fade-in">
          <div style={{ padding: '48px 40px 0' }}>
            <h1 style={{ fontFamily: "'Press Start 2P'", fontSize: '20px', color: AMBER, marginBottom: '8px', lineHeight: 1.4 }}>
              Tutorial
            </h1>
            <p style={{ fontFamily: "'IBM Plex Mono'", fontSize: '14px', color: MUTED }}>
              Follow the path to build your arcade game
            </p>
          </div>

          <WorkflowNav section={section} setSection={setSection} />

          <div style={{ padding: '0 40px 60px' }}>

            {section === 'getting-started' && (
              <>
                <h2 style={{ fontFamily: "'Press Start 2P'", fontSize: '12px', color: GREEN, marginBottom: '36px', lineHeight: 1.6, display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <Sprite src="controller.png" size={24} /> Getting Started
                </h2>
                <StepsList steps={GETTING_STARTED_STEPS} />
                <div style={{ marginTop: '48px', display: 'flex', justifyContent: 'flex-end' }}>
                  <ArcadeBtn bg={AMBER} onClick={() => setSection('unity-basics')} style={{ fontSize: '12px' }}>
                    Next → Unity Basics
                  </ArcadeBtn>
                </div>
              </>
            )}

            {section === 'unity-basics' && (
              <>
                <h2 style={{ fontFamily: "'Press Start 2P'", fontSize: '12px', color: GREEN, marginBottom: '36px', lineHeight: 1.6, display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <Sprite src="gameboy.png" size={22} /> Unity Basics
                </h2>
                <StepsList steps={UNITY_BASICS_STEPS} />

                {/* Completion message */}
                <div style={{
                  marginTop: '60px',
                  background: CARD,
                  border: `2px solid ${GREEN}`,
                  borderRadius: '4px',
                  padding: '36px 40px',
                  textAlign: 'center',
                }}>
                  <div style={{ fontSize: '28px', marginBottom: '16px' }}>🎮</div>
                  <h3 style={{ fontFamily: "'Press Start 2P'", fontSize: '12px', color: GREEN, marginBottom: '20px', lineHeight: 1.7 }}>
                    Now you know the basics to making a game!
                  </h3>
                  <p style={{ fontFamily: "'IBM Plex Mono'", fontSize: '15px', color: CREAM, lineHeight: 1.9, maxWidth: '560px', margin: '0 auto' }}>
                    Now either go off and make a game off of what you just learned, or continue by creating a starter game.
                  </p>
                </div>

                <div style={{ marginTop: '32px', display: 'flex', gap: '12px', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                  <ArcadeBtn bg={CORAL} onClick={() => setSection('getting-started')} style={{ fontSize: '12px' }}>
                    ← Getting Started
                  </ArcadeBtn>
                  <ArcadeBtn bg={AMBER} onClick={() => setSection('asteroid')} style={{ fontSize: '12px' }}>
                    Asteroid Destroyer →
                  </ArcadeBtn>
                  <ArcadeBtn bg={PURPLE} dark={PURPLED} onClick={() => setSection('hackquest')} style={{ fontSize: '12px' }}>
                    Hack Quest →
                  </ArcadeBtn>
                </div>
              </>
            )}

            {(section === 'asteroid' || section === 'hackquest') && (
              <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '380px' }}>
                <div style={{
                  background: CARD, border: `2px solid ${PURPLE}`,
                  padding: '52px', textAlign: 'center', maxWidth: '480px', borderRadius: '4px',
                }}>
                  <Sprite src="cabinet.png" size={72} style={{ marginBottom: '24px', opacity: 0.75 }} />
                  <h2 style={{ fontFamily: "'Press Start 2P'", fontSize: '12px', color: AMBER, marginBottom: '20px', lineHeight: 1.6 }}>
                    {section === 'asteroid' ? 'Asteroid Destroyer' : 'Hack Quest'}
                  </h2>
                  <p style={{ fontFamily: "'IBM Plex Mono'", fontSize: '14px', color: CREAM, lineHeight: 1.9, marginBottom: '8px' }}>
                    Coming soon. Finish Unity Basics first, then check back when the jam kicks off.
                  </p>
                  <Cursor />
                  <div style={{ marginTop: '28px' }}>
                    <ArcadeBtn bg={CORAL} style={{ fontSize: '12px' }} onClick={() => setSection('unity-basics')}>
                      ← Back to Unity Basics
                    </ArcadeBtn>
                  </div>
                </div>
              </div>
            )}

          </div>
        </div>
      );
    }

    /* ─── Shared GameComments component ─────────────────────────────────── */
    function GameComments({ gameId, user, readOnly = false }) {
      const [comments,  setComments]  = useState(null);
      const [loadingC,  setLoadingC]  = useState(true);
      const [errorC,    setErrorC]    = useState(null);
      const [text,      setText]      = useState('');
      const [posting,   setPosting]   = useState(false);

      useEffect(() => {
        if (!gameId) { setLoadingC(false); return; }
        getComments(gameId)
          .then(d => { setComments(d.comments || []); setLoadingC(false); })
          .catch(e => { setErrorC(e.message); setLoadingC(false); });
      }, [gameId]);

      const submit = async (e) => {
        e.preventDefault();
        if (!text.trim() || posting) return;
        setPosting(true);
        try {
          const d = await postComment(gameId, user?.username || user?.email || 'Arcade Player', text.trim());
          setComments(prev => [...(prev || []), d.comment]);
          setText('');
        } catch (e) { setErrorC(e.message); }
        finally { setPosting(false); }
      };

      if (loadingC) return <p style={{ fontFamily: "'IBM Plex Mono'", fontSize: '12px', color: MUTED }}>Loading comments…</p>;
      if (errorC && !comments) return <p style={{ fontFamily: "'IBM Plex Mono'", fontSize: '12px', color: CORAL }}>Error: {errorC}</p>;

      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {(!comments || comments.length === 0) && (
            <p style={{ fontFamily: "'IBM Plex Mono'", fontSize: '12px', color: MUTED, fontStyle: 'italic', margin: 0 }}>
              No comments yet.{!readOnly ? ' Be the first!' : ''}
            </p>
          )}
          {(comments || []).map((c, i) => (
            <div key={i} style={{
              background: '#0f0820', border: `1px solid rgba(192,132,252,0.2)`,
              padding: '10px 14px', borderRadius: '3px',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                <span style={{ fontFamily: "'IBM Plex Mono'", fontSize: '11px', color: PURPLE, fontWeight: 700 }}>{c.author}</span>
                <span style={{ fontFamily: "'IBM Plex Mono'", fontSize: '10px', color: MUTED }}>
                  {new Date(c.date).toLocaleDateString()}
                </span>
              </div>
              <div style={{ fontFamily: "'IBM Plex Mono'", fontSize: '13px', color: CREAM, lineHeight: 1.6 }}>{c.text}</div>
            </div>
          ))}
          {!readOnly && (
            <form onSubmit={submit} style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
              <input
                type="text" value={text} onChange={e => setText(e.target.value)}
                placeholder="Leave a comment…"
                style={{ flex: 1 }}
              />
              <ArcadeBtn type="submit" bg={PURPLE} dark={PURPLED}
                style={{ fontSize: '11px', opacity: (posting || !text.trim()) ? 0.6 : 1 }}>
                {posting ? '…' : 'Post'}
              </ArcadeBtn>
            </form>
          )}
        </div>
      );
    }

    /* ─── Arcade / Games Page ────────────────────────────────────────────── */
    function toPlayableUrl(url) {
      if (!url) return '';
      return url.replace('itch.io/embed/', 'itch.io/embed-upload/');
    }

    /* ── Single game detail view ───────────────────────────────────────── */
    function GameDetailView({ game, user, onBack, onPlayFullscreen }) {
      const [logs,    setLogs]    = useState(null);
      const [logsLoading, setLogsLoading] = useState(true);
      const [playing, setPlaying] = useState(false); // inline player open

      useEffect(() => {
        getGameLogs(game.id)
          .then(d => { setLogs(d.logs || []); setLogsLoading(false); })
          .catch(() => { setLogs([]); setLogsLoading(false); });
      }, [game.id]);

      const gameDesc = game.description?.includes(' — ')
        ? game.description.split(' — ').slice(1).join(' — ')
        : '';

      return (
        <>
          {/* Full-screen overlay when playing */}
          {playing && (
            <div style={{
              position: 'fixed', inset: 0, zIndex: 500,
              background: 'rgba(0,0,0,0.96)', display: 'flex', flexDirection: 'column',
            }}>
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '12px 20px', background: CARD, borderBottom: `1px solid ${AMBER}33`, flexShrink: 0,
              }}>
                <span style={{ fontFamily: "'Press Start 2P'", fontSize: '10px', color: AMBER }}>{game.name}</span>
                <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                  <span style={{ fontFamily: "'IBM Plex Mono'", fontSize: '11px', color: MUTED }}>by {game.submitter}</span>
                  <button onClick={() => setPlaying(false)} style={{
                    fontFamily: "'Press Start 2P'", fontSize: '10px',
                    background: CORAL, color: BG, border: 'none',
                    padding: '8px 14px', cursor: 'pointer', borderRadius: '2px',
                    borderBottom: `3px solid ${CORALD}`,
                  }}>✕ Close</button>
                </div>
              </div>
              <iframe
                src={toPlayableUrl(game.itchUrl)}
                style={{ flex: 1, border: 'none', display: 'block', width: '100%' }}
                allowFullScreen allow="autoplay; fullscreen *; pointer-lock *"
              />
            </div>
          )}

          <div className="fade-in" style={{ padding: '32px 40px 60px' }}>
            {/* Back */}
            <button onClick={onBack} style={{
              background: 'none', border: 'none', color: PURPLE, cursor: 'pointer',
              fontFamily: "'IBM Plex Mono'", fontSize: '14px', marginBottom: '28px',
              display: 'flex', alignItems: 'center', gap: '6px',
            }}>← Back to Arcade</button>

            {/* Title row */}
            <div style={{ marginBottom: '28px' }}>
              <h1 style={{ fontFamily: "'Press Start 2P'", fontSize: '20px', color: AMBER, lineHeight: 1.4, marginBottom: '8px' }}>
                {game.name}
              </h1>
              <div style={{ fontFamily: "'IBM Plex Mono'", fontSize: '13px', color: MUTED, marginBottom: '12px' }}>
                by {game.submitter}
              </div>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: game.tags?.length > 0 ? '12px' : 0 }}>
                <Badge bg={CORAL} color="white">{game.hours}h</Badge>
                <Badge bg={PURPLE} color={BG}>🎮 {game.plays || 0} plays</Badge>
              </div>
              {game.tags?.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '4px' }}>
                  {game.tags.map(tag => (
                    <span key={tag} style={{
                      fontFamily: "'IBM Plex Mono'", fontSize: '11px',
                      background: `${PURPLE}18`, color: PURPLE,
                      border: `1px solid ${PURPLE}44`, borderRadius: '3px',
                      padding: '3px 9px',
                    }}>{tag}</span>
                  ))}
                </div>
              )}
            </div>

            {/* Two-column layout */}
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(300px,480px) 1fr', gap: '40px', alignItems: 'start', flexWrap: 'wrap' }}>

              {/* Left — embed preview + play button */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                {game.itchUrl ? (
                  <iframe src={game.itchUrl} width="100%" height="167" frameBorder="0"
                    style={{ display: 'block', borderRadius: '4px', pointerEvents: 'none' }} />
                ) : (
                  <div style={{ height: '167px', background: '#09061a', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '4px' }}>
                    <span style={{ fontFamily: "'Press Start 2P'", fontSize: '9px', color: MUTED }}>No embed</span>
                  </div>
                )}
                {game.itchUrl && (
                  <ArcadeBtn bg={AMBER} style={{ fontSize: '14px', padding: '14px' }} onClick={() => {
                    setPlaying(true);
                    recordPlay(game.id).catch(() => {});
                  }}>
                    ▶ Play Now
                  </ArcadeBtn>
                )}
                {gameDesc && (
                  <p style={{ fontFamily: "'IBM Plex Mono'", fontSize: '13px', color: CREAM, lineHeight: 1.8, margin: 0 }}>
                    {gameDesc}
                  </p>
                )}
              </div>

              {/* Right — dev log + comments */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>

                {/* Dev Log */}
                <div>
                  <h2 style={{ fontFamily: "'Press Start 2P'", fontSize: '11px', color: AMBER, marginBottom: '16px', lineHeight: 1.6 }}>
                    📋 Dev Log
                  </h2>
                  {logsLoading && (
                    <p style={{ fontFamily: "'IBM Plex Mono'", fontSize: '12px', color: MUTED }}>Loading log<Cursor /></p>
                  )}
                  {!logsLoading && logs?.length === 0 && (
                    <p style={{ fontFamily: "'IBM Plex Mono'", fontSize: '12px', color: MUTED, fontStyle: 'italic' }}>
                      No dev log entries yet.
                    </p>
                  )}
                  {!logsLoading && logs?.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '340px', overflowY: 'auto', paddingRight: '4px' }}>
                      {logs.map((entry, i) => (
                        <div key={i} style={{
                          background: CARD, border: `1px solid rgba(192,132,252,0.2)`,
                          padding: '12px 16px', borderRadius: '3px',
                        }}>
                          <div style={{ fontFamily: "'IBM Plex Mono'", fontSize: '10px', color: PURPLE, marginBottom: '6px' }}>{entry.date}</div>
                          <div style={{ fontFamily: "'IBM Plex Mono'", fontSize: '13px', color: CREAM, lineHeight: 1.7 }}>{entry.text}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Comments */}
                <div>
                  <h2 style={{ fontFamily: "'Press Start 2P'", fontSize: '11px', color: AMBER, marginBottom: '16px', lineHeight: 1.6 }}>
                    💬 Comments
                  </h2>
                  <GameComments gameId={game.id} user={user} />
                </div>

              </div>
            </div>
          </div>
        </>
      );
    }

    /* ─── Reusable tag filter bar (match-any) ─────────────────────────────── */
    function TagFilterBar({ allTags, selected, onToggle, onClear, accent = PURPLE, style = {} }) {
      const tags = allTags || [];
      return (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center', ...style }}>
          <span style={{ fontFamily: "'IBM Plex Mono'", fontSize: '11px', color: MUTED, marginRight: '2px' }}>
            Filter by tag:
          </span>
          {tags.length === 0 && (
            <span style={{ fontFamily: "'IBM Plex Mono'", fontSize: '11px', color: MUTED, fontStyle: 'italic' }}>
              no tags yet
            </span>
          )}
          {tags.map(tag => {
            const active = selected.includes(tag);
            return (
              <button key={tag} onClick={() => onToggle(tag)} style={{
                fontFamily: "'IBM Plex Mono'", fontSize: '11px',
                background: active ? accent : `${accent}18`,
                color: active ? BG : accent,
                border: `1px solid ${active ? accent : `${accent}44`}`,
                borderRadius: '3px', padding: '4px 11px', cursor: 'pointer',
                transition: 'background 0.12s, color 0.12s',
              }}>{tag}</button>
            );
          })}
          {selected.length > 0 && (
            <button onClick={onClear} style={{
              fontFamily: "'IBM Plex Mono'", fontSize: '11px',
              background: 'none', color: CORAL,
              border: `1px solid ${CORAL}44`, borderRadius: '3px',
              padding: '4px 11px', cursor: 'pointer',
            }}>✕ Clear</button>
          )}
        </div>
      );
    }

    // Collect unique, sorted tags from a list of objects each having a `.tags` array
    function collectTags(items) {
      const set = new Set();
      (items || []).forEach(it => (it?.tags || []).forEach(t => t && set.add(t)));
      return [...set].sort();
    }

    function GamesPage({ user }) {
      const [games,    setGames]    = useState(null);
      const [selectedTags, setSelectedTags] = useState([]);
      const [loading,  setLoading]  = useState(true);
      const [error,    setError]    = useState(null);
      const [viewing,  setViewing]  = useState(null); // game open in detail page

      const loadGames = useCallback((showSpinner = false) => {
        if (showSpinner) setLoading(true);
        getPublishedGames()
          .then(data => { setGames(data.games || []); setError(null); })
          .catch(err => { setError(err.message); })
          .finally(() => setLoading(false));
      }, []);

      useEffect(() => {
        loadGames(true);
        const interval = setInterval(() => loadGames(false), 30000);
        const onVisible = () => {
          if (document.visibilityState === 'visible') loadGames(false);
        };
        document.addEventListener('visibilitychange', onVisible);
        return () => {
          clearInterval(interval);
          document.removeEventListener('visibilitychange', onVisible);
        };
      }, [loadGames]);

      const openDetail = (game) => {
        setViewing(game);
        // Optimistically update play count in the list
        recordPlay(game.id).catch(() => {});
        setGames(prev => prev?.map(g => g.id === game.id ? { ...g, plays: (g.plays || 0) + 1 } : g));
      };

      const allTags = useMemo(() => collectTags(games), [games]);
      const toggleTag = (tag) => setSelectedTags(prev =>
        prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]);
      const visibleGames = selectedTags.length === 0
        ? games
        : (games || []).filter(g => selectedTags.some(t => (g.tags || []).includes(t)));

      if (viewing) {
        return (
          <GameDetailView
            game={viewing}
            user={user}
            onBack={() => setViewing(null)}
          />
        );
      }

      return (
        <div className="fade-in" style={{ padding: '48px 40px 60px' }}>
          <h1 style={{ fontFamily: "'Press Start 2P'", fontSize: '24px', color: AMBER, marginBottom: '8px', lineHeight: 1.4 }}>
            ARCADE
          </h1>
          <p style={{ fontFamily: "'IBM Plex Mono'", fontSize: '13px', color: MUTED, marginBottom: '20px' }}>
            Browse accepted games — click a project to play, view the dev log, and leave a comment.
          </p>

          {!loading && !error && (
            <TagFilterBar
              allTags={allTags}
              selected={selectedTags}
              onToggle={toggleTag}
              onClear={() => setSelectedTags([])}
              style={{ marginBottom: '32px' }}
            />
          )}

          {loading && <div style={{ fontFamily: "'IBM Plex Mono'", fontSize: '14px', color: MUTED }}>Loading games<Cursor /></div>}
          {error   && <div style={{ fontFamily: "'IBM Plex Mono'", fontSize: '14px', color: CORAL }}>Failed to load games: {error}</div>}
          {!loading && !error && games?.length === 0 && (
            <div style={{ fontFamily: "'IBM Plex Mono'", fontSize: '14px', color: MUTED }}>No accepted games yet. Check back soon<Cursor /></div>
          )}
          {!loading && !error && games?.length > 0 && visibleGames.length === 0 && (
            <div style={{ fontFamily: "'IBM Plex Mono'", fontSize: '14px', color: MUTED }}>
              No games match {selectedTags.length > 1 ? 'those tags' : 'that tag'}.{' '}
              <button onClick={() => setSelectedTags([])} style={{
                background: 'none', border: 'none', color: PURPLE, cursor: 'pointer',
                fontFamily: "'IBM Plex Mono'", fontSize: '14px', textDecoration: 'underline', padding: 0,
              }}>Clear filter</button>
            </div>
          )}

          {!loading && !error && visibleGames.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '24px' }}>
              {visibleGames.map(game => (
                <div key={game.id} style={{
                  background: CARD, border: `1px solid ${AMBER}33`,
                  borderRadius: '8px', overflow: 'hidden',
                  display: 'flex', flexDirection: 'column',
                  cursor: 'pointer', transition: 'border-color 0.15s',
                }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = AMBER; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = `${AMBER}33`; }}
                >
                  {/* Embed thumbnail (non-interactive) */}
                  {game.itchUrl ? (
                    <iframe src={game.itchUrl} width="100%" height="167" frameBorder="0"
                      style={{ display: 'block', pointerEvents: 'none' }} />
                  ) : (
                    <div style={{ height: '167px', background: '#09061a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <span style={{ fontFamily: "'Press Start 2P'", fontSize: '9px', color: MUTED }}>No embed</span>
                    </div>
                  )}

                  <div style={{ padding: '16px 20px 20px', display: 'flex', flexDirection: 'column', gap: '8px', flex: 1 }}>
                    <div style={{ fontFamily: "'Press Start 2P'", fontSize: '10px', color: AMBER, lineHeight: 1.7 }}>{game.name}</div>
                    <div style={{ fontFamily: "'IBM Plex Mono'", fontSize: '12px', color: MUTED }}>by {game.submitter}</div>
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '4px' }}>
                      <Badge bg={CORAL} color="white">{game.hours}h</Badge>
                      <Badge bg={PURPLE} color={BG}>🎮 {game.plays || 0} plays</Badge>
                    </div>
                    {game.tags?.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
                        {game.tags.map(tag => {
                          const active = selectedTags.includes(tag);
                          return (
                            <button key={tag} onClick={() => toggleTag(tag)} title={`Filter by "${tag}"`} style={{
                              fontFamily: "'IBM Plex Mono'", fontSize: '10px',
                              background: active ? PURPLE : `${PURPLE}18`,
                              color: active ? BG : PURPLE,
                              border: `1px solid ${active ? PURPLE : `${PURPLE}44`}`,
                              borderRadius: '3px', padding: '2px 7px', cursor: 'pointer',
                            }}>{tag}</button>
                          );
                        })}
                      </div>
                    )}
                    <ArcadeBtn bg={AMBER} style={{ fontSize: '11px', marginTop: 'auto' }} onClick={() => openDetail(game)}>
                      View Project ›
                    </ArcadeBtn>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      );
    }

    const COINS_PER_HOUR = 20;

    // Fixed 5-tier definition — always shown, API items are bucketed into them
    const SHOP_TIERS_DEF = [
      { num: 1, min: 10,   range: '10 players',   color: AMBER     },
      { num: 2, min: 50,   range: '50 players',   color: GREEN     },
      { num: 3, min: 100,  range: '100 players',  color: PURPLE    },
      { num: 4, min: 500,  range: '500 players',  color: CORAL     },
      { num: 5, min: 1000, range: '1000 players', color: '#ffd700' },
    ];

    /* ─── Shop Page ───────────────────────────────────────────────────────── */
    function ShopPage({ projects, totalHours, user }) {
      const [totalPlays,  setTotalPlays]  = useState(0);
      const [playsReady,  setPlaysReady]  = useState(false);
      const [shopItems,   setShopItems]   = useState([]);
      const [itemsReady,  setItemsReady]  = useState(false);
      const [orderingId,  setOrderingId]  = useState(null);
      const [orderMsg,    setOrderMsg]    = useState(null);
      const totalCoins = Math.floor((totalHours || 0) * COINS_PER_HOUR);

      // IDs of submitted (accepted) games this user has
      const submittedIds = (projects || [])
        .filter(p => p.airtableRecordId && p.submissionStatus === 'accepted')
        .map(p => p.airtableRecordId);

      useEffect(() => {
        if (submittedIds.length === 0) { setPlaysReady(true); return; }
        getPlayCounts(submittedIds)
          .then(data => {
            const total = Object.values(data.counts || {}).reduce((s, n) => s + n, 0);
            setTotalPlays(total);
          })
          .catch(() => {})
          .finally(() => setPlaysReady(true));
      // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [submittedIds.join(',')]);

      useEffect(() => {
        getShopItems()
          .then(d => setShopItems(d.items || []))
          .catch(() => setShopItems([]))
          .finally(() => setItemsReady(true));
      }, []);

      // Bucket API items into the fixed 5 tiers by minPlayers value
      const displayTiers = SHOP_TIERS_DEF.map(tier => ({
        ...tier,
        items: shopItems.filter(it => Number(it.minPlayers) === tier.min),
      }));
      const activeTier = [...displayTiers].reverse().find(t => totalPlays >= t.min)?.num ?? 0;
      const nextTier   = displayTiers.find(t => totalPlays < t.min);
      const maxPlays   = nextTier ? nextTier.min : SHOP_TIERS_DEF[SHOP_TIERS_DEF.length - 1].min;

      const handleOrder = async (item) => {
        if (!user?.email) { setOrderMsg('Sign in to place an order.'); return; }
        setOrderingId(item.id);
        setOrderMsg(null);
        try {
          await placeShopOrder(user.email, item.id, totalHours, totalPlays);
          setOrderMsg(`Ordered: ${item.title}`);
        } catch (err) {
          setOrderMsg(err.message || 'Order failed');
        } finally { setOrderingId(null); }
      };


      return (
        <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>

          {/* ── Header ── */}
          <div style={{ padding: '40px 40px 24px', borderBottom: `1px solid ${AMBER}22` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '8px' }}>
              <img src="shop.png" alt="Shop" className="sprite" style={{ width: 56, height: 'auto' }} />
              <h1 style={{ fontFamily: "'Press Start 2P'", fontSize: '18px', color: AMBER, lineHeight: 1.4, margin: 0 }}>
                Shop
              </h1>
            </div>
            <p style={{ fontFamily: "'IBM Plex Mono'", fontSize: '13px', color: MUTED, marginBottom: '12px' }}>
              Earn {COINS_PER_HOUR} coins per hour logged. Unlock tiers when players play your game in the Arcade.
            </p>
            <div style={{ fontFamily: "'IBM Plex Mono'", fontSize: '14px', color: AMBER, marginBottom: '8px' }}>
              ¢ {totalCoins} coins &nbsp;·&nbsp; {totalHours || 0}h logged
            </div>
            {orderMsg && (
              <p style={{ fontFamily: "'IBM Plex Mono'", fontSize: '12px', marginBottom: '12px',
                color: orderMsg.startsWith('Ordered') ? GREEN : CORAL }}>{orderMsg}</p>
            )}
            {submittedIds.length === 0 && (
              <p style={{ fontFamily: "'IBM Plex Mono'", fontSize: '12px', color: AMBER, marginBottom: '16px' }}>
                ⚠ Submit and get a game accepted to start earning players.
              </p>
            )}

            {/* Players progress bar */}
            <div style={{ maxWidth: '480px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                <span style={{ fontFamily: "'IBM Plex Mono'", fontSize: '12px', color: CREAM }}>
                  {playsReady ? `${totalPlays} players` : 'Loading…'}
                </span>
                {nextTier && playsReady && (
                  <span style={{ fontFamily: "'IBM Plex Mono'", fontSize: '12px', color: MUTED }}>
                    {nextTier.min - totalPlays} until {nextTier.min} players
                  </span>
                )}
                {!nextTier && playsReady && (
                  <span style={{ fontFamily: "'IBM Plex Mono'", fontSize: '12px', color: '#ffd700' }}>
                    Max tier reached ★
                  </span>
                )}
              </div>
              <div style={{ height: '6px', background: `${AMBER}22`, borderRadius: '3px', overflow: 'hidden' }}>
                <div className="progress-fill" style={{
                  height: '100%', borderRadius: '3px',
                  background: !nextTier
                    ? '#ffd700'
                    : (displayTiers.find(t => t.num === activeTier + 1) || displayTiers[0]).color,
                  width: `${Math.min((totalPlays / maxPlays) * 100, 100)}%`,
                }} />
              </div>
            </div>
          </div>

          {/* ── Tier columns ── */}
          {!itemsReady && (
            <p style={{ fontFamily: "'IBM Plex Mono'", fontSize: '13px', color: MUTED, padding: '24px 40px' }}>
              Loading shop<Cursor />
            </p>
          )}
          <div style={{ display: 'flex', flex: 1, overflowX: 'auto', borderTop: `1px solid ${AMBER}11` }}>
            {displayTiers.map(({ num, min, range, color, items: tierItems }) => {
              const unlocked  = totalPlays >= min;
              const isCurrent = num === activeTier;
              return (
                <div key={num} style={{
                  flex: '1 0 190px', minWidth: '170px',
                  borderRight: `1px solid ${AMBER}11`,
                  display: 'flex', flexDirection: 'column',
                  opacity: unlocked ? 1 : 0.45,
                  background: isCurrent ? `${color}08` : 'transparent',
                  transition: 'opacity 0.3s',
                }}>
                  {/* Column header — original two-row style */}
                  <div style={{
                    padding: '20px 20px 16px',
                    borderBottom: `2px solid ${unlocked ? color : MUTED}`,
                    background: isCurrent ? `${color}14` : `${color}06`,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', marginBottom: '6px', minHeight: '20px' }}>
                      {isCurrent && (
                        <span style={{
                          fontFamily: "'IBM Plex Mono'", fontSize: '9px',
                          color: BG, background: color,
                          padding: '2px 6px', borderRadius: '2px', fontWeight: 700,
                        }}>YOU</span>
                      )}
                      {!unlocked && <span style={{ fontSize: '14px' }}>🔒</span>}
                    </div>
                    <div style={{ fontFamily: "'IBM Plex Mono'", fontSize: '12px', color: unlocked ? CREAM : MUTED }}>
                      🎮 {range}
                    </div>
                  </div>

                  {/* Shop items */}
                  <div style={{ padding: '20px', flex: 1, display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {tierItems.length === 0 && (
                      <div style={{ fontFamily: "'IBM Plex Mono'", fontSize: '11px', color: MUTED, lineHeight: 1.7, paddingTop: '4px' }}>
                        Coming soon<Cursor />
                      </div>
                    )}
                    {tierItems.map(item => {
                      const canAfford = totalCoins >= item.coins;
                      const available = unlocked && canAfford;
                      return (
                        <div key={item.id} style={{
                          background: CARD,
                          border: `1px solid ${unlocked ? color + '55' : MUTED + '22'}`,
                          borderRadius: '4px', padding: '14px',
                          display: 'flex', flexDirection: 'column', gap: '6px',
                          boxShadow: available ? `0 0 12px ${color}18` : 'none',
                        }}>
                          {/* Optional image */}
                          {item.image && (
                            <div style={{
                              background: '#0f0820', border: `1px solid ${MUTED}22`,
                              borderRadius: '3px', height: '80px',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              overflow: 'hidden', marginBottom: '2px',
                            }}>
                              <img src={item.image} alt="" style={{ maxHeight: '72px', maxWidth: '100%', objectFit: 'contain' }} />
                            </div>
                          )}
                          {/* Icon (emoji) if no image */}
                          {!item.image && item.icon && (
                            <div style={{ fontSize: '22px', lineHeight: 1 }}>{item.icon}</div>
                          )}
                          <div style={{ fontFamily: "'Press Start 2P'", fontSize: '8px', color: unlocked ? color : MUTED, lineHeight: 1.7 }}>
                            {item.title}
                          </div>
                          <div style={{ fontFamily: "'IBM Plex Mono'", fontSize: '11px', color: unlocked ? CREAM : MUTED, lineHeight: 1.6 }}>
                            {item.desc}
                          </div>
                          {item.coins > 0 && (
                            <div style={{ fontFamily: "'IBM Plex Mono'", fontSize: '11px', fontWeight: 700,
                              color: canAfford ? AMBER : MUTED }}>
                              ¢ {item.coins} coins
                              {unlocked && !canAfford && (
                                <span style={{ fontWeight: 400, marginLeft: '6px' }}>
                                  ({item.coins - totalCoins} more needed)
                                </span>
                              )}
                            </div>
                          )}
                          {available && (
                            <ArcadeBtn
                              bg={GREEN} dark={GREEND}
                              style={{ fontSize: '10px', marginTop: '4px', opacity: orderingId === item.id ? 0.6 : 1 }}
                              onClick={() => handleOrder(item)}
                            >
                              {orderingId === item.id ? '…' : 'Order'}
                            </ArcadeBtn>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      );
    }

    /* ─── FAQ Page ────────────────────────────────────────────────────────── */
    function FAQPage() {
      return (
        <div className="fade-in" style={{ padding: '48px 40px', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
          <img src="faq.png" alt="FAQ" className="sprite" style={{ width: 160, height: 'auto', marginBottom: '32px' }} />
          <h1 style={{ fontFamily: "'Press Start 2P'", fontSize: '24px', color: AMBER, marginBottom: '20px', lineHeight: 1.4 }}>FAQ</h1>
          <p style={{ fontFamily: "'IBM Plex Mono'", fontSize: '16px', color: CREAM, lineHeight: 1.9, marginBottom: '32px', maxWidth: '480px' }}>
            Got questions? They'll be answered here soon.
          </p>
          <div style={{ fontFamily: "'IBM Plex Mono'", fontSize: '14px', color: MUTED }}><Cursor /></div>
        </div>
      );
    }

    /* ─── Guidelines Page ───────────────────────────────────────────────── */
    const GUIDELINES = [
      {
        num: '01',
        color: AMBER,
        title: 'Complete Game Loop',
        icon: '🎮',
        desc: 'Your game must have a clear beginning, middle, and end. The player should be able to start, play, win or lose, and return to the start — all without leaving the game.',
        chips: ['Start state', 'Win / lose condition', 'Return to menu'],
      },
      {
        num: '02',
        color: GREEN,
        title: 'Main Menu',
        icon: '📋',
        desc: 'Include a main menu screen that greets the player before the game begins. At minimum it should show your game title and a way to start playing.',
        chips: ['Title screen', 'Start button', 'Optional: settings / credits'],
      },
      {
        num: '03',
        color: PURPLE,
        title: 'Replayability',
        icon: '🔁',
        desc: 'Players should want — and be able — to play again. This can mean randomised levels, score chasing, unlockables, or simply a "Play Again" button after the game ends.',
        chips: ['Play again flow', 'Score / progress', 'Varied experience'],
      },
      {
        num: '04',
        color: CORAL,
        title: 'Submit to itch.io',
        icon: '🚀',
        desc: 'Export your finished game and upload it to itch.io as a public project. Paste the itch.io link into the Projects page here to complete your submission.',
        chips: ['Export build', 'Publish on itch.io', 'Submit link here'],
      },
    ];

    function GuidelinesPage() {
      return (
        <div className="fade-in" style={{ padding: '48px 40px 64px', maxWidth: '760px', margin: '0 auto' }}>
          {/* Header */}
          <div style={{ marginBottom: '48px' }}>
            <h1 style={{ fontFamily: "'Press Start 2P'", fontSize: '18px', color: AMBER, marginBottom: '12px', lineHeight: 1.5 }}>
              Guidelines
            </h1>
            <p style={{ fontFamily: "'IBM Plex Mono'", fontSize: '14px', color: MUTED, lineHeight: 1.8 }}>
              Everything your game needs to qualify for Insert Coin.
            </p>
          </div>

          {/* Requirement cards */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            {GUIDELINES.map(({ num, color, title, icon, desc, chips }) => (
              <div key={num} style={{
                background: CARD,
                border: `2px solid ${color}44`,
                borderLeft: `4px solid ${color}`,
                borderRadius: '4px',
                padding: '28px 32px',
                position: 'relative',
              }}>
                {/* Number badge */}
                <div style={{
                  position: 'absolute', top: '24px', right: '28px',
                  fontFamily: "'Press Start 2P'", fontSize: '11px',
                  color: `${color}66`,
                }}>
                  {num}
                </div>

                {/* Title row */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '14px' }}>
                  <span style={{ fontSize: '20px', lineHeight: 1 }}>{icon}</span>
                  <h2 style={{ fontFamily: "'Press Start 2P'", fontSize: '12px', color, lineHeight: 1.5, margin: 0 }}>
                    {title}
                  </h2>
                </div>

                {/* Description */}
                <p style={{ fontFamily: "'IBM Plex Mono'", fontSize: '14px', color: CREAM, lineHeight: 1.9, marginBottom: '20px', maxWidth: '580px' }}>
                  {desc}
                </p>

                {/* Chips */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                  {chips.map(chip => (
                    <span key={chip} style={{
                      fontFamily: "'IBM Plex Mono'", fontSize: '11px',
                      color, background: `${color}18`,
                      border: `1px solid ${color}44`,
                      borderRadius: '2px', padding: '4px 10px',
                    }}>
                      ✓ {chip}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Footer CTA */}
          <div style={{
            marginTop: '48px', padding: '28px 32px',
            background: `${AMBER}0f`, border: `1px solid ${AMBER}44`,
            borderRadius: '4px', textAlign: 'center',
          }}>
            <p style={{ fontFamily: "'Press Start 2P'", fontSize: '11px', color: AMBER, marginBottom: '8px', lineHeight: 1.8 }}>
              Ready to submit?
            </p>
            <p style={{ fontFamily: "'IBM Plex Mono'", fontSize: '13px', color: MUTED, lineHeight: 1.8 }}>
              Head to the Projects page, finish your entry, and hit Submit.
            </p>
          </div>
        </div>
      );
    }

    /* ─── Layered background scene ───────────────────────────────────────── */

    // Pages at ground level vs underground
    const ABOVE_GROUND = new Set(['home','shop','faq','tutorial','guidelines','admin','arcade']);
    const altOf    = p => ABOVE_GROUND.has(p) ? 'above' : 'below';
    // Home and FAQ each have their own unique terrain; all others share their altitude's terrain
    const terrainOf = p => p === 'home' ? 'home' : p === 'faq' ? 'faq' : altOf(p);

    // Sky layers (fixed, never slide — one per altitude, fade between them)
    const SKY_ABOVE = { file: 'bg2-layer-0.png', op: 0.50 };
    // Cave sky — just the dark void, the animated terrain covers the full scene
    const SKY_BELOW = { file: 'bg-layer-0.png',  op: 0.18 };

    // Cave river animation frames (all 7 are time-based frames of the same scene)
    const CAVE_FRAMES = [
      'bg3-layer-0.png','bg3-layer-1.png','bg3-layer-2.png',
      'bg3-layer-3.png','bg3-layer-4.png','bg3-layer-5.png','bg3-layer-6.png',
    ];

    // FAQ desert oasis frames (3 frames — moon phase + pond shimmer cycle)
    const FAQ_FRAMES = [
      'bg4-layer-0.png','bg4-layer-1.png','bg4-layer-2.png','bg4-layer-1.png',
    ];

    // Terrain layers per page/altitude
    const TERRAIN = {
      // ── Home page — the original first landscape (Mars + stars + planet) ──
      home: [
        { file: 'bg-layer-1.png', anim: null,            dur: null,    delay: null,   op: 0.60 },
        { file: 'bg-layer-2.png', anim: 'bgPlanetFloat', dur: '18s',   delay: '0s',   op: 0.65 },
        { file: 'bg-layer-3.png', anim: 'bgStarTwinkle', dur: '4s',    delay: '0s',   op: 0.70 },
        { file: 'bg-layer-4.png', anim: 'bgStarTwinkle', dur: '6s',    delay: '1.5s', op: 0.70 },
        { file: 'bg-layer-5.png', anim: 'bgPlanetFloat', dur: '22s',   delay: '3s',   op: 0.55 },
        { file: 'bg-layer-6.png', anim: 'bgStarTwinkle', dur: '5s',    delay: '0.8s', op: 0.70 },
        { file: 'bg-layer-7.png', anim: 'bgStarTwinkle', dur: '7s',    delay: '2.5s', op: 0.65 },
      ],
      // ── All other above-ground pages (shop, tutorial, admin) ─────────────
      above: [
        { file: 'bg2-layer-1.png', anim: null,            dur: null,  delay: null,   op: 0.55 },
        { file: 'bg2-layer-2.png', anim: null,            dur: null,  delay: null,   op: 0.60 },
        { file: 'bg2-layer-4.png', anim: 'bgStarTwinkle', dur: '5s',  delay: '0s',   op: 0.70 },
        { file: 'bg2-layer-5.png', anim: null,            dur: null,  delay: null,   op: 0.65 },
        { file: 'bg2-layer-6.png', anim: 'bgPlanetFloat', dur: '14s', delay: '2s',   op: 0.55 },
      ],
      // ── FAQ — desert oasis at night, 3-frame animated scene ──────────────
      faq: [
        { frames: FAQ_FRAMES, speed: 750, op: 1.0, cover: true },
      ],
      // ── Underground (projects) — cave river animation, fixed background ───
      below: [
        { frames: CAVE_FRAMES, speed: 400, op: 1.0, cover: true },
      ],
    };

    // Animation pairs per transition direction
    const SLIDE = {
      left: { enter: 'bgEnterRight',  exit: 'bgExitLeft'   },
      down: { enter: 'bgEnterBelow',  exit: 'bgExitTop'    }, // going underground
      up:   { enter: 'bgEnterAbove',  exit: 'bgExitBottom' }, // coming above ground
    };
    const DURATION = '1.3s';
    const EASE     = 'cubic-bezier(0.4, 0, 0.2, 1)';

    const LAYER_STYLE = {
      position: 'absolute', bottom: 0, left: 0,
      width: '100%', height: 'auto',
      imageRendering: 'pixelated', display: 'block',
    };

    // Frame-sequence layer — cycles through an array of image files
    // cover: fills container completely (objectFit cover, anchored top) — use for full-scene frames
    // anchorTop: non-cover anchor to top edge; default anchors to bottom edge
    function FrameAnimLayer({ frames, speed, op, cover, anchorTop }) {
      const [idx, setIdx] = useState(0);
      useEffect(() => {
        const id = setInterval(() => setIdx(i => (i + 1) % frames.length), speed);
        return () => clearInterval(id);
      }, [frames.length, speed]);
      return (
        <img
          src={frames[idx]}
          alt=""
          style={{
            position: 'absolute',
            top: 0, left: 0,
            width: '100%',
            ...(cover
              ? { height: '100%', objectFit: 'cover', objectPosition: 'top' }
              : { height: 'auto', ...(anchorTop ? {} : { top: 'auto', bottom: 0 }) }
            ),
            imageRendering: 'pixelated',
            display: 'block',
            opacity: op,
          }}
        />
      );
    }

    function TerrainLayers({ alt, anim }) {
      return (
        <div style={{
          position: 'absolute', inset: 0, overflow: 'hidden',
          animation: anim ? `${anim} ${DURATION} ${EASE} forwards` : undefined,
        }}>
          {TERRAIN[alt].map((layer, i) => {
            if (layer.frames) {
              return (
                <FrameAnimLayer
                  key={`frames-${i}`}
                  frames={layer.frames}
                  speed={layer.speed}
                  op={layer.op}
                  cover={layer.cover}
                  anchorTop={layer.anchorTop}
                />
              );
            }
            const { file, anim: la, dur, delay, op } = layer;
            return (
              <img key={file} src={file} alt="" style={{
                ...LAYER_STYLE,
                opacity: op,
                animation: la ? `${la} ${dur} ease-in-out ${delay} infinite` : undefined,
              }} />
            );
          })}
        </div>
      );
    }

    function BackgroundScene({ page }) {
      const [shown,    setShown]    = useState(() => terrainOf(page)); // current terrain key
      const [exiting,  setExiting]  = useState(null);                  // terrain sliding out
      const [enterAnim, setEnterAnim] = useState(null);
      const [exitAnim,  setExitAnim]  = useState(null);
      const prevRef = useRef(page);
      const timerRef = useRef(null);
      const above = altOf(page) === 'above';

      useEffect(() => {
        const fromPage = prevRef.current;
        if (fromPage === page) return;
        prevRef.current = page;

        // Direction uses altitude (above/below) for the up/down logic
        const fromAlt = altOf(fromPage);
        const toAlt   = altOf(page);

        let dir;
        if (fromAlt === toAlt) dir = 'left';
        else if (fromAlt === 'above' && toAlt === 'below') dir = 'down';
        else dir = 'up';

        const { enter, exit } = SLIDE[dir];
        // Terrain key may differ even within the same altitude (e.g. home vs shop)
        setExiting(terrainOf(fromPage));
        setExitAnim(exit);
        setEnterAnim(enter);
        setShown(terrainOf(page));

        clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => {
          setExiting(null);
          setExitAnim(null);
          setEnterAnim(null);
        }, 1400);
      }, [page]);

      return (
        <div style={{ position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none', overflow: 'hidden' }}>
          {/* Sky — fixed, never slides, fades between above/below */}
          <img src={SKY_ABOVE.file} alt="" style={{
            ...LAYER_STYLE, height: '100%', objectFit: 'cover', objectPosition: 'bottom',
            opacity: above ? SKY_ABOVE.op : 0,
            transition: `opacity ${DURATION} ${EASE}`,
          }} />
          <img src={SKY_BELOW.file} alt="" style={{
            ...LAYER_STYLE, height: '100%', objectFit: 'cover', objectPosition: 'bottom',
            opacity: above ? 0 : SKY_BELOW.op,
            transition: `opacity ${DURATION} ${EASE}`,
          }} />

          {/* Exiting terrain slides out */}
          {exiting && <TerrainLayers alt={exiting} anim={exitAnim} />}

          {/* Entering terrain slides in */}
          <TerrainLayers key={page} alt={shown} anim={enterAnim} />

          {/* Vignette */}
          <div style={{
            position: 'absolute', inset: 0, pointerEvents: 'none',
            background: 'linear-gradient(to bottom, rgba(13,10,26,0.55) 0%, rgba(13,10,26,0.05) 40%, rgba(13,10,26,0.0) 70%, rgba(13,10,26,0.35) 100%)',
          }} />
        </div>
      );
    }

    /* ─── Meteor shower ──────────────────────────────────────────────────── */
    const METEOR_FRAMES = ['meteor_1.png','meteor_2.png','meteor_3.png','meteor_4.png'];

    function Meteor({ startX, startY, size, dur, delay, dx, dy }) {
      const [frame, setFrame] = useState(0);
      useEffect(() => {
        const id = setInterval(() => setFrame(f => (f + 1) % METEOR_FRAMES.length), 140);
        return () => clearInterval(id);
      }, []);
      return (
        <img
          src={METEOR_FRAMES[frame]}
          alt=""
          className="meteor"
          style={{
            top: startY,
            left: startX,
            width: size,
            height: 'auto',
            '--dur': dur,
            '--delay': delay,
            '--dx': dx,
            '--dy': dy,
          }}
        />
      );
    }

    const METEORS = [
      { startX: '82%', startY: '-10%', size: 36,  dur: '14s',  delay: '0s',     dx: '-38vw', dy: '120vh' },
      { startX: '65%', startY: '-8%',  size: 28,  dur: '18s',  delay: '5s',     dx: '-30vw', dy: '115vh' },
      { startX: '92%', startY: '-5%',  size: 44,  dur: '12s',  delay: '10s',    dx: '-42vw', dy: '125vh' },
      { startX: '75%', startY: '-12%', size: 24,  dur: '20s',  delay: '3s',     dx: '-25vw', dy: '118vh' },
      { startX: '88%', startY: '-7%',  size: 32,  dur: '16s',  delay: '8s',     dx: '-35vw', dy: '120vh' },
      { startX: '58%', startY: '-9%',  size: 22,  dur: '22s',  delay: '14s',    dx: '-28vw', dy: '112vh' },
    ];

    function MeteorShower() {
      return (
        <>
          {METEORS.map((m, i) => <Meteor key={i} {...m} />)}
        </>
      );
    }

    /* ─── Sprite helpers ─────────────────────────────────────────────────── */
    // Inline sprite icon — use anywhere as a small decoration
    function Sprite({ src, size = 24, style = {}, alt = '' }) {
      return (
        <img
          src={src}
          alt={alt}
          className="sprite"
          style={{ width: size, height: 'auto', display: 'inline-block', verticalAlign: 'middle', ...style }}
        />
      );
    }

    // Scattered background sprites — fixed layer, pointer-events: none
    const BG_SPRITES = [
      { src:'cabinet.png',    x:'82%', y:'12%', size:104, opacity:0.65, rot:-6,  anim:'floatA', dur:'7s'  },
      { src:'controller.png', x:'4%',  y:'30%', size:80,  opacity:0.65, rot:12,  anim:'floatB', dur:'9s'  },
      { src:'heart.png',      x:'75%', y:'60%', size:52,  opacity:0.70, rot:-8,  anim:'floatC', dur:'6s'  },
      { src:'bolt.png',       x:'88%', y:'78%', size:44,  opacity:0.68, rot:15,  anim:'floatA', dur:'8s'  },
      { src:'gameboy.png',    x:'3%',  y:'70%', size:68,  opacity:0.65, rot:-12, anim:'floatB', dur:'11s' },
      { src:'key.png',        x:'50%', y:'5%',  size:40,  opacity:0.65, rot:20,  anim:'floatC', dur:'7.5s'},
      { src:'faq.png',        x:'18%', y:'88%', size:52,  opacity:0.65, rot:-5,  anim:'floatA', dur:'10s' },
      { src:'shop.png',       x:'65%', y:'88%', size:64,  opacity:0.65, rot:8,   anim:'floatB', dur:'8.5s'},
      { src:'faq.png',        x:'6%',  y:'4%',  size:44,  opacity:0.65, rot:5,   anim:'floatC', dur:'12s' },
      { src:'shop.png',       x:'92%', y:'45%', size:56,  opacity:0.65, rot:-10, anim:'floatA', dur:'9.5s'},
    ];

    function BgSprites() {
      return (
        <div style={{
          position: 'fixed', inset: 0,
          pointerEvents: 'none',
          zIndex: 0,
          overflow: 'hidden',
        }}>
          {BG_SPRITES.map((s, i) => (
            <img
              key={i}
              src={s.src}
              alt=""
              className="sprite"
              style={{
                position: 'absolute',
                left: s.x, top: s.y,
                width: s.size, height: 'auto',
                opacity: s.opacity,
                '--rot': `${s.rot}deg`,
                animation: `${s.anim} ${s.dur} ease-in-out infinite`,
                animationDelay: `${(i * 1.3) % 5}s`,
              }}
            />
          ))}
        </div>
      );
    }

    /* ─── Sign-in landing page (shown when not logged in) ─────────────────── */
    function SignInPage({ onSignIn, authError }) {
      return (
        <div className="fade-in" style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', minHeight: '100vh', padding: '40px',
          textAlign: 'center',
        }}>
          {/* Marquee */}
          <div style={{ background: AMBER, width: '100%', padding: '32px 40px', marginBottom: '48px' }}>
            <h1 style={{ fontFamily: "'Press Start 2P'", fontSize: 'clamp(18px,3.5vw,34px)', color: BG, lineHeight: 1.4, textShadow: `3px 3px 0 ${AMBERD}` }}>
              INSERT COIN
            </h1>
            <p style={{ fontFamily: "'IBM Plex Mono'", fontSize: '16px', color: BG, marginTop: '12px', opacity: 0.82 }}>
              A Hack Club You Ship We Ship Game Jam
            </p>
          </div>

          <img src="cabinet.png" alt="" className="sprite" style={{ width: 140, height: 'auto', marginBottom: '32px' }} />

          <h2 style={{ fontFamily: "'Press Start 2P'", fontSize: '14px', color: AMBER, marginBottom: '16px', lineHeight: 1.6 }}>
            SIGN IN TO PLAY
          </h2>
          <p style={{ fontFamily: "'IBM Plex Mono'", fontSize: '15px', color: CREAM, lineHeight: 1.9, maxWidth: '480px', marginBottom: '32px' }}>
            Sign in with your Hackatime account to track your hours, log projects, and submit to the jam.
          </p>

          <ArcadeBtn bg={AMBER} style={{ fontSize: '14px', padding: '18px 40px' }} onClick={onSignIn}>
            Sign In With Hackatime
          </ArcadeBtn>

          {authError && (
            <p style={{ fontFamily: "'IBM Plex Mono'", fontSize: '13px', color: CORAL, marginTop: '20px', maxWidth: '440px', lineHeight: 1.7 }}>
              {authError}
            </p>
          )}

          <div style={{ background: AMBER, width: '100%', padding: '7px 0', marginTop: '48px' }}>
            <span style={{ fontFamily: "'Press Start 2P'", fontSize: '11px', color: BG }}>
              ★ INSERT COIN ★ INSERT COIN ★ INSERT COIN ★ INSERT COIN ★
            </span>
          </div>
        </div>
      );
    }

    /* ─── Auth loading overlay ────────────────────────────────────────────── */
    function AuthLoadingOverlay() {
      return (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(13,10,26,0.93)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          zIndex: 2000,
        }}>
          <img src="key.png" alt="" className="sprite" style={{ width: 64, height: 'auto', marginBottom: '24px', animation: 'blink 1s step-end infinite' }} />
          <p style={{ fontFamily: "'Press Start 2P'", fontSize: '13px', color: AMBER, lineHeight: 1.6 }}>SIGNING IN…</p>
          <p style={{ fontFamily: "'IBM Plex Mono'", fontSize: '13px', color: MUTED, marginTop: '12px' }}>
            Connecting to Hackatime
          </p>
        </div>
      );
    }

    /* ─── Submit Project Page ─────────────────────────────────────────────── */
    function SubmitProjectPage({ user, projects, userRecordId, onRequireSignIn, onDone, onSubmitted }) {
      const [selectedId,   setSelectedId]   = useState('');
      const [firstName,    setFirstName]    = useState('');
      const [lastName,     setLastName]     = useState('');
      const [githubUser,   setGithubUser]   = useState('');
      const [playableUrl,  setPlayableUrl]  = useState('');
      const [status,       setStatus]       = useState(null);
      const [selectedTier, setSelectedTier] = useState(null);
      const [tags,         setTags]         = useState([]);

      const SUBMIT_TIERS = [
        { num: 1, label: 'Tier 1', range: '5–8 hrs',   min: 5,  color: AMBER,     badge: null },
        { num: 2, label: 'Tier 2', range: '8–16 hrs',  min: 8,  color: GREEN,     badge: null },
        { num: 3, label: 'Tier 3', range: '17–33 hrs', min: 17, color: PURPLE,    badge: '🎮 Steam release fee paid' },
        { num: 4, label: 'Tier 4', range: '34–66 hrs', min: 34, color: CORAL,     badge: null },
        { num: 5, label: 'Tier 5', range: '67+ hrs',   min: 67, color: '#ffd700', badge: null },
      ];

      const selectedProject = projects.find(p => String(p.id) === selectedId);
      const submittable = projects.filter(p => p.submissionStatus !== 'accepted' && p.submissionStatus !== 'under-review');

      // Pre-fill Airtable fields from Hackatime profile when available.
      useEffect(() => {
        if (!user) return;
        if (user.githubUsername && !githubUser) setGithubUser(user.githubUsername);
        if (user.firstName && !firstName) setFirstName(user.firstName);
        if (user.lastName && !lastName) setLastName(user.lastName);
      }, [user]);

      // Tags are chosen at project creation — carry them through on submit.
      useEffect(() => {
        setTags(selectedProject?.tags || []);
      // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [selectedId]);

      if (!user) {
        return (
          <div className="fade-in" style={{ padding: '48px 40px', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
            <img src="key.png" alt="" className="sprite" style={{ width: 72, height: 'auto', marginBottom: '28px' }} />
            <h1 style={{ fontFamily: "'Press Start 2P'", fontSize: '18px', color: AMBER, marginBottom: '20px', lineHeight: 1.5 }}>Sign In Required</h1>
            <p style={{ fontFamily: "'IBM Plex Mono'", fontSize: '15px', color: CREAM, lineHeight: 1.9, marginBottom: '28px', maxWidth: '440px' }}>
              You need to sign in with Hackatime before you can submit a project.
            </p>
            <ArcadeBtn bg={AMBER} onClick={onRequireSignIn}>Sign In With Hackatime</ArcadeBtn>
          </div>
        );
      }

      if (projects.length === 0) {
        return (
          <div className="fade-in" style={{ padding: '48px 40px', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
            <img src="projects.png" alt="" className="sprite" style={{ width: 120, height: 'auto', marginBottom: '28px' }} />
            <h1 style={{ fontFamily: "'Press Start 2P'", fontSize: '16px', color: AMBER, marginBottom: '20px', lineHeight: 1.5 }}>No Projects Yet</h1>
            <p style={{ fontFamily: "'IBM Plex Mono'", fontSize: '15px', color: CREAM, lineHeight: 1.9, marginBottom: '28px', maxWidth: '440px' }}>
              Create a project in the Projects page first, then come back to submit it to the jam.
            </p>
            <ArcadeBtn bg={AMBER} onClick={onDone}>Go to Projects</ArcadeBtn>
          </div>
        );
      }

      if (submittable.length === 0) {
        return (
          <div className="fade-in" style={{ padding: '48px 40px', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
            <h1 style={{ fontFamily: "'Press Start 2P'", fontSize: '16px', color: AMBER, marginBottom: '20px', lineHeight: 1.5 }}>Nothing To Submit</h1>
            <p style={{ fontFamily: "'IBM Plex Mono'", fontSize: '15px', color: CREAM, lineHeight: 1.9, marginBottom: '28px', maxWidth: '440px' }}>
              Your projects are already submitted or under review.
            </p>
            <ArcadeBtn bg={AMBER} onClick={onDone}>Back to Projects</ArcadeBtn>
          </div>
        );
      }

      if (status === 'done') {
        return (
          <div className="fade-in" style={{ padding: '48px 40px', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
            <div style={{ fontSize: '40px', marginBottom: '16px' }}>🪙</div>
            <h1 style={{ fontFamily: "'Press Start 2P'", fontSize: '16px', color: AMBER, marginBottom: '20px', lineHeight: 1.5 }}>Under Review</h1>
            <p style={{ fontFamily: "'IBM Plex Mono'", fontSize: '15px', color: CREAM, lineHeight: 1.9, marginBottom: '28px', maxWidth: '440px' }}>
              Your project has been submitted. An organizer will review it soon.
            </p>
            <ArcadeBtn bg={AMBER} onClick={onDone}>Back to Projects</ArcadeBtn>
          </div>
        );
      }

      const projectHours = selectedProject ? (selectedProject.hours || 0) : 0;

      const submit = async (e) => {
        e.preventDefault();
        if (!selectedProject) return;
        if (!selectedTier) { setStatus('Please select a tier before submitting.'); return; }
        const tier = SUBMIT_TIERS.find(t => t.num === selectedTier);
        if (tier && projectHours < tier.min) {
          setStatus(`You need at least ${tier.min} hours to submit at ${tier.label}.`);
          return;
        }
        setStatus('sending');
        try {
          let hours = selectedProject.hours || 0;
          if (user.token && selectedProject.hackatimeProject) {
            try {
              const result = await getHackatimeProjectHours(user.token, selectedProject.hackatimeProject);
              if (result.hours > 0) hours = result.hours;
            } catch {}
          }
          // Extract src URL if user pasted full iframe HTML
          const rawEmbed = playableUrl.trim();
          const srcMatch = rawEmbed.match(/src="([^"]+)"/);
          const embedUrl = srcMatch ? srcMatch[1] : rawEmbed;
          // Flush project data (including journal) to Airtable before submission
          await saveUserProjects(user.email, projects, userRecordId).catch(() => {});
          const result = await submitProject({
            email:            user.email,
            firstName:        firstName.trim(),
            lastName:         lastName.trim(),
            description:      `${selectedProject.name}${selectedProject.description ? ' — ' + selectedProject.description : ''}`,
            playableUrl:      embedUrl,
            githubUser:       githubUser.trim(),
            hours,
            accessToken:      user.token,
            hackatimeProject: selectedProject.hackatimeProject || undefined,
            projectId:        selectedProject.id,
            journalEntries:   selectedProject.journalEntries || [],
            tags:             tags,
          });
          onSubmitted?.(selectedProject.id, result.record?.id, embedUrl, selectedTier, tags);
          setStatus('done');
        } catch (err) {
          setStatus(err.message || 'Submission failed');
        }
      };

      return (
        <div className="fade-in" style={{ padding: '48px 40px 60px', maxWidth: '680px' }}>
          <h1 style={{ fontFamily: "'Press Start 2P'", fontSize: '18px', color: AMBER, marginBottom: '10px', lineHeight: 1.5 }}>SUBMIT TO JAM</h1>
          <p style={{ fontFamily: "'IBM Plex Mono'", fontSize: '13px', color: PURPLE, marginBottom: '36px' }}>Signed in as {user.email}</p>

          <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>

            {/* Project picker */}
            <div>
              <Label>SELECT YOUR PROJECT</Label>
              <select value={selectedId} onChange={e => setSelectedId(e.target.value)} style={{ width: '100%' }} required>
                <option value="">— choose a project —</option>
                {submittable.map(p => (
                  <option key={p.id} value={String(p.id)}>
                    {p.name} ({p.hours}h)
                  </option>
                ))}
              </select>
              {submittable.length === 0 && projects.length > 0 && (
                <p style={{ fontFamily: "'IBM Plex Mono'", fontSize: '12px', color: MUTED, marginTop: '8px' }}>
                  All projects are already submitted or under review.
                </p>
              )}
            </div>

            {/* Show selected project details */}
            {selectedProject && (
              <div style={{ background: CARD, border: `1px solid ${PURPLE}`, borderRadius: '4px', padding: '20px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ fontFamily: "'Press Start 2P'", fontSize: '10px', color: AMBER }}>{selectedProject.name}</div>
                {selectedProject.description && (
                  <div style={{ fontFamily: "'IBM Plex Mono'", fontSize: '13px', color: CREAM, lineHeight: 1.7 }}>{selectedProject.description}</div>
                )}
                <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginTop: '4px' }}>
                  <Badge bg={CORAL} color="white">{selectedProject.hours}h</Badge>
                  {selectedProject.hackatimeProject && <Badge bg={PURPLE} color={BG}>{selectedProject.hackatimeProject}</Badge>}
                  <Badge bg={CARD}>{selectedProject.journalEntries?.length || 0} log entries</Badge>
                </div>
              </div>
            )}

            {/* ── Tier selection ── */}
            <div>
              <Label>SELECT YOUR TIER</Label>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(115px, 1fr))',
                gap: '12px',
              }}>
                {SUBMIT_TIERS.map(tier => {
                  const hasHours = projectHours >= tier.min;
                  const isSelected = selectedTier === tier.num;
                  return (
                    <div
                      key={tier.num}
                      onClick={() => hasHours && setSelectedTier(tier.num)}
                      style={{
                        background: CARD,
                        border: isSelected ? `2px solid ${tier.color}` : `1px solid ${tier.color}44`,
                        borderRadius: '6px',
                        padding: '14px 10px',
                        cursor: hasHours ? 'pointer' : 'not-allowed',
                        opacity: hasHours ? 1 : 0.4,
                        transition: 'all 0.15s',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '6px',
                        position: 'relative',
                      }}
                    >
                      {!hasHours && (
                        <span style={{ position: 'absolute', top: 6, right: 8, fontSize: '12px' }}>🔒</span>
                      )}
                      <div style={{ fontFamily: "'Press Start 2P'", fontSize: '9px', color: tier.color, lineHeight: 1.6 }}>{tier.label}</div>
                      <div style={{ fontFamily: "'IBM Plex Mono'", fontSize: '11px', color: CREAM, lineHeight: 1.5 }}>{tier.range}</div>
                      {tier.badge && (
                        <div style={{ fontFamily: "'IBM Plex Mono'", fontSize: '10px', color: tier.color, lineHeight: 1.5, marginTop: '2px' }}>{tier.badge}</div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            <div style={{ display: 'flex', gap: '16px' }}>
              <div style={{ flex: 1 }}>
                <Label>FIRST NAME</Label>
                <input type="text" value={firstName} onChange={e => setFirstName(e.target.value)} style={{ width: '100%' }} required />
              </div>
              <div style={{ flex: 1 }}>
                <Label>LAST NAME</Label>
                <input type="text" value={lastName} onChange={e => setLastName(e.target.value)} style={{ width: '100%' }} required />
              </div>
            </div>
            <div>
              <Label>GITHUB USERNAME</Label>
              <input type="text" value={githubUser} onChange={e => setGithubUser(e.target.value)} placeholder="your-github-username" style={{ width: '100%' }} />
            </div>
            {/* ── Tags (chosen when the project was created) ── */}
            {selectedProject && (
              <div>
                <Label>TAGS</Label>
                {tags.length > 0 ? (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                    {tags.map(tag => (
                      <span key={tag} style={{
                        fontFamily: "'IBM Plex Mono'", fontSize: '11px',
                        background: `${PURPLE}18`, color: PURPLE,
                        border: `1px solid ${PURPLE}44`, borderRadius: '3px',
                        padding: '3px 9px',
                      }}>{tag}</span>
                    ))}
                  </div>
                ) : (
                  <p style={{ fontFamily: "'IBM Plex Mono'", fontSize: '11px', color: MUTED, lineHeight: 1.7 }}>
                    No tags on this project — add them when creating a project.
                  </p>
                )}
              </div>
            )}

            <div>
              <Label>ITCH.IO EMBED</Label>
              <p style={{ fontFamily: "'IBM Plex Mono'", fontSize: '11px', color: MUTED, marginBottom: '8px', lineHeight: 1.7 }}>
                On your itch.io game page click <strong style={{color:CREAM}}>Embed</strong> and paste the entire &lt;iframe&gt; code, or just paste the embed URL.
              </p>
              <textarea
                value={playableUrl}
                onChange={e => setPlayableUrl(e.target.value)}
                placeholder={'<iframe src="https://itch.io/embed/..." ...></iframe>\nor just: https://itch.io/embed/...'}
                style={{ width: '100%', minHeight: '72px', resize: 'vertical', fontFamily: "'IBM Plex Mono'", fontSize: '12px' }}
                required
              />
              {(() => {
                const raw = playableUrl.trim();
                if (!raw) return null;
                const srcMatch = raw.match(/src="([^"]+)"/);
                const src = srcMatch ? srcMatch[1] : raw;
                return (
                  <iframe
                    key={src}
                    src={src}
                    width="552"
                    height="167"
                    frameBorder="0"
                    allowFullScreen
                    style={{ borderRadius: '4px', marginTop: '8px', maxWidth: '100%', display: 'block' }}
                  />
                );
              })()}
            </div>

            {typeof status === 'string' && status !== 'sending' && (
              <p style={{ fontFamily: "'IBM Plex Mono'", fontSize: '13px', color: CORAL }}>{status}</p>
            )}

            <div style={{ display: 'flex', gap: '16px', alignItems: 'center', marginTop: '8px' }}>
              <ArcadeBtn type="submit" bg={GREEN} dark={GREEND}
                style={{ flex: 1, fontSize: '14px', padding: '16px', opacity: (!selectedProject || status === 'sending') ? 0.5 : 1 }}>
                {status === 'sending' ? 'Submitting…' : 'Submit To Jam'}
              </ArcadeBtn>
              <button type="button" onClick={onDone}
                style={{ background: 'none', border: 'none', color: MUTED, cursor: 'pointer', fontFamily: "'IBM Plex Mono'", fontSize: '13px' }}>
                ← CANCEL
              </button>
            </div>
          </form>
        </div>
      );
    }

    /* ─── Admin list row ──────────────────────────────────────────────────── */
    function AdminSubmissionRow({ record, fields, onView, tags = [], selectedTags = [], onToggleTag }) {
      const v = record.fields || {};
      const f = fields || {};
      const desc = v[f.description] || v['Description'] || '';
      const gameName = desc.split(' — ')[0]?.trim() || desc.trim() || 'Untitled';
      const submitter = [v[f.firstName] || v['First Name'], v[f.lastName] || v['Last Name']].filter(Boolean).join(' ') || '—';
      const reviewSt = v[f.reviewStatus] || v['Review Status'] || REVIEW.UNDER;
      const norm = normalizeReviewStatus(reviewSt);

      return (
        <div style={{
          background: CARD, border: `1px solid ${PURPLE}`, borderRadius: '6px',
          padding: '18px 22px', display: 'flex', alignItems: 'center',
          justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap',
        }}>
          <div style={{ flex: 1, minWidth: '200px' }}>
            <div style={{ fontFamily: "'Press Start 2P'", fontSize: '11px', color: AMBER, marginBottom: '6px', lineHeight: 1.6 }}>
              {gameName}
            </div>
            <div style={{ fontFamily: "'IBM Plex Mono'", fontSize: '12px', color: PURPLE }}>
              {submitter}
              {(v[f.hours] ?? v['Optional - Override Hours Spent']) != null ? ` · ${v[f.hours] ?? v['Optional - Override Hours Spent']}h` : ''}
            </div>
            {tags.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', marginTop: '8px' }}>
                {tags.map(tag => {
                  const active = selectedTags.includes(tag);
                  return (
                    <button key={tag} onClick={() => onToggleTag?.(tag)} title={`Filter by "${tag}"`} style={{
                      fontFamily: "'IBM Plex Mono'", fontSize: '10px',
                      background: active ? PURPLE : `${PURPLE}18`,
                      color: active ? BG : PURPLE,
                      border: `1px solid ${active ? PURPLE : `${PURPLE}44`}`,
                      borderRadius: '3px', padding: '2px 7px', cursor: 'pointer',
                    }}>{tag}</button>
                  );
                })}
              </div>
            )}
          </div>
          <span style={{
            fontFamily: "'IBM Plex Mono'", fontSize: '11px', fontWeight: 700,
            color: BG, background: reviewStatusColor(norm || 'under-review'),
            padding: '4px 12px', borderRadius: 0, whiteSpace: 'nowrap',
          }}>{reviewSt}</span>
          <ArcadeBtn bg={PURPLE} dark={PURPLED} style={{ fontSize: '11px', minWidth: '80px' }} onClick={onView}>
            View
          </ArcadeBtn>
        </div>
      );
    }

    /* ─── Admin project review screen ─────────────────────────────────────── */
    function AdminReviewView({ record, fields, token, user, onBack, onReviewed }) {
      const [logs,        setLogs]        = useState(null);
      const [logsLoading, setLogsLoading] = useState(true);
      const [logsError,   setLogsError]   = useState(null);
      const [reviewing,   setReviewing]   = useState(false);
      const [reviewError, setReviewError] = useState(null);
      const [feedback,    setFeedback]    = useState('');
      const [postingFb,   setPostingFb]   = useState(false);

      const v = record.fields || {};
      const f = fields || {};
      const email = v[f.email] || v['Email'] || '';
      const reviewSt = v[f.reviewStatus] || v['Review Status'] || REVIEW.UNDER;
      const desc = v[f.description] || v['Description'] || '';
      const submittedName = desc.split(' — ')[0]?.trim() || desc.trim();
      const gameDesc = desc.includes(' — ') ? desc.split(' — ').slice(1).join(' — ') : '';
      const submitter = [v[f.firstName] || v['First Name'], v[f.lastName] || v['Last Name']].filter(Boolean).join(' ') || '—';
      const playableUrl = v[f.playableUrl] || v['Playable URL'] || '';
      const journalOnRecord = parseJournalField(v['Journal Data']);

      const loadLogs = useCallback(async () => {
        if (journalOnRecord) {
          setLogs([{ id: record.id, name: submittedName, journalEntries: journalOnRecord }]);
          setLogsLoading(false);
          return;
        }
        if (!email) { setLogsError('No email on this submission record.'); setLogsLoading(false); return; }
        setLogsLoading(true);
        setLogsError(null);
        try {
          const data = await adminUserProjects(token, email);
          setLogs(data.projects || []);
        } catch (err) {
          setLogsError(err.message || 'Failed to load logs');
          setLogs(null);
        } finally { setLogsLoading(false); }
      }, [token, email, record.id, submittedName, journalOnRecord]);

      useEffect(() => { loadLogs(); }, [loadLogs]);

      const matched = logs?.find(p =>
        p.name === submittedName
        || desc.startsWith(p.name)
        || (p.hackatimeProject && desc.includes(p.hackatimeProject))
      );
      const journalEntries = matched
        ? (matched.journalEntries || [])
        : (logs || []).flatMap(p => p.journalEntries || []);

      const review = async (st, withFeedback = false) => {
        setReviewing(true);
        setReviewError(null);
        try {
          if (withFeedback && feedback.trim()) {
            setPostingFb(true);
            await postComment(record.id, user?.email || 'Admin', `[Feedback] ${feedback.trim()}`);
            setPostingFb(false);
            setFeedback('');
          }
          await adminReview(token, record.id, st);
          onReviewed(record.id, st);
          if (st === REVIEW.ACCEPTED || st === REVIEW.REJECTED) onBack();
        } catch (err) {
          setReviewError(err.message || 'Review failed');
        } finally { setReviewing(false); setPostingFb(false); }
      };

      const panelStyle = {
        background: CARD, border: `2px solid ${MUTED}`,
        borderRadius: '4px', padding: '16px', minHeight: '120px',
      };

      return (
        <div className="fade-in" style={{ padding: '32px 40px 60px' }}>
          <button onClick={onBack} style={{
            background: 'none', border: 'none', color: PURPLE, cursor: 'pointer',
            fontFamily: "'IBM Plex Mono'", fontSize: '14px', marginBottom: '24px',
            display: 'flex', alignItems: 'center', gap: '6px',
          }}>← Back to Submissions</button>

          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 260px', gap: '20px', alignItems: 'start' }}>

            {/* ── Left: game, description, logs ── */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

              {/* Video game — itch.io embed is 552×167 */}
              <div style={{ ...panelStyle, padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', width: '100%', maxWidth: '552px' }}>
                <div style={{
                  fontFamily: "'Press Start 2P'", fontSize: '9px', color: MUTED,
                  padding: '10px 16px', borderBottom: `2px solid ${MUTED}`, background: '#0f0820',
                }}>VIDEO GAME</div>
                {playableUrl ? (
                  <div style={{ position: 'relative', width: '100%', aspectRatio: '552 / 167', background: '#09061a' }}>
                    <iframe
                      src={toPlayableUrl(playableUrl)}
                      width="552"
                      height="167"
                      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 'none', display: 'block' }}
                      allowFullScreen
                    />
                  </div>
                ) : (
                  <div style={{ width: '100%', aspectRatio: '552 / 167', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#09061a' }}>
                    <span style={{ fontFamily: "'IBM Plex Mono'", fontSize: '13px', color: MUTED, fontStyle: 'italic' }}>No playable URL provided</span>
                  </div>
                )}
              </div>

              {/* Description */}
              <div style={panelStyle}>
                <div style={{ fontFamily: "'Press Start 2P'", fontSize: '9px', color: MUTED, marginBottom: '12px' }}>DESCRIPTION</div>
                <h2 style={{ fontFamily: "'Press Start 2P'", fontSize: '12px', color: AMBER, marginBottom: '10px', lineHeight: 1.6 }}>{submittedName}</h2>
                <div style={{ fontFamily: "'IBM Plex Mono'", fontSize: '12px', color: PURPLE, marginBottom: '10px' }}>
                  {submitter}{email ? ` · ${email}` : ''}
                  {(v[f.hours] ?? v['Optional - Override Hours Spent']) != null ? ` · ${v[f.hours] ?? v['Optional - Override Hours Spent']}h` : ''}
                  {(v[f.githubUser] || v['GitHub Username']) ? ` · @${v[f.githubUser] || v['GitHub Username']}` : ''}
                </div>
                <p style={{ fontFamily: "'IBM Plex Mono'", fontSize: '13px', color: CREAM, lineHeight: 1.8, margin: 0 }}>
                  {gameDesc || 'No additional description.'}
                </p>
              </div>

              {/* Logs */}
              <div style={{ ...panelStyle, minHeight: '200px' }}>
                <div style={{ fontFamily: "'Press Start 2P'", fontSize: '9px', color: MUTED, marginBottom: '12px' }}>LOGS</div>
                {logsLoading && (
                  <p style={{ fontFamily: "'IBM Plex Mono'", fontSize: '12px', color: MUTED }}>Loading logs…</p>
                )}
                {!logsLoading && logsError && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <p style={{ fontFamily: "'IBM Plex Mono'", fontSize: '12px', color: CORAL, margin: 0 }}>{logsError}</p>
                    <button onClick={loadLogs} style={{
                      fontFamily: "'IBM Plex Mono'", fontSize: '11px', color: PURPLE,
                      background: 'none', border: `1px solid ${PURPLE}`, padding: '3px 10px', cursor: 'pointer',
                    }}>↻ Retry</button>
                  </div>
                )}
                {!logsLoading && !logsError && journalEntries.length === 0 && (
                  <p style={{ fontFamily: "'IBM Plex Mono'", fontSize: '12px', color: MUTED, fontStyle: 'italic', margin: 0 }}>
                    No journal logs found. The submitter may not have synced their log to the server yet.
                  </p>
                )}
                {!logsLoading && !logsError && journalEntries.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '360px', overflowY: 'auto' }}>
                    {journalEntries.map((entry, i) => (
                      <div key={i} style={{ background: '#0f0820', border: `1px solid rgba(192,132,252,0.2)`, padding: '12px 14px', borderRadius: '2px' }}>
                        <div style={{ fontFamily: "'IBM Plex Mono'", fontSize: '10px', color: PURPLE, marginBottom: '4px' }}>{entry.date}</div>
                        <div style={{ fontFamily: "'IBM Plex Mono'", fontSize: '13px', color: CREAM, lineHeight: 1.6 }}>{entry.text}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* ── Right sidebar: actions + feedback ── */}
            <div style={{
              background: CARD, border: `2px solid ${MUTED}`, borderRadius: '4px',
              display: 'flex', flexDirection: 'column', minHeight: '520px',
            }}>
              <div style={{
                background: MUTED, padding: '14px 16px',
                fontFamily: "'Press Start 2P'", fontSize: '9px', color: BG, lineHeight: 1.6,
              }}>
                {submittedName.toUpperCase().slice(0, 24)}
              </div>

              <div style={{
                flex: 1, display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center', gap: '14px', padding: '24px 16px',
              }}>
                <span style={{
                  fontFamily: "'IBM Plex Mono'", fontSize: '10px', fontWeight: 700,
                  color: BG, background: reviewStatusColor(normalizeReviewStatus(reviewSt) || 'under-review'),
                  padding: '6px 14px', borderRadius: 0, marginBottom: '8px',
                  border: `2px solid ${MUTED}`,
                }}>{reviewSt}</span>

                <button onClick={() => review(REVIEW.ACCEPTED)} disabled={reviewing} style={{
                  fontFamily: "'Press Start 2P'", fontSize: '10px', color: CREAM,
                  background: '#0f0820', border: `2px solid ${MUTED}`, borderRadius: 0,
                  padding: '14px 20px', width: '100%', maxWidth: '200px',
                  cursor: reviewing ? 'default' : 'pointer', opacity: reviewing ? 0.5 : 1, lineHeight: 1.8,
                }}>Accept</button>

                <button onClick={() => review(REVIEW.REJECTED, true)} disabled={reviewing} style={{
                  fontFamily: "'Press Start 2P'", fontSize: '10px', color: CREAM,
                  background: '#0f0820', border: `2px solid ${MUTED}`, borderRadius: 0,
                  padding: '14px 20px', width: '100%', maxWidth: '200px',
                  cursor: reviewing ? 'default' : 'pointer', opacity: reviewing ? 0.5 : 1, lineHeight: 1.8,
                }}>Reject for edits</button>
              </div>

              <div style={{ borderTop: `2px solid ${MUTED}`, padding: '16px' }}>
                <div style={{ fontFamily: "'Press Start 2P'", fontSize: '9px', color: MUTED, marginBottom: '10px' }}>FEED BACK</div>
                <textarea
                  value={feedback}
                  onChange={e => setFeedback(e.target.value)}
                  placeholder="Notes for the submitter…"
                  rows={4}
                  style={{
                    width: '100%', resize: 'vertical', boxSizing: 'border-box',
                    background: '#0f0820', border: `1px solid ${MUTED}`, color: CREAM,
                    fontFamily: "'IBM Plex Mono'", fontSize: '12px', padding: '10px',
                    borderRadius: '2px', marginBottom: '10px',
                  }}
                />
                <ArcadeBtn
                  bg={PURPLE} dark={PURPLED}
                  style={{ width: '100%', fontSize: '10px', opacity: (postingFb || !feedback.trim()) ? 0.5 : 1 }}
                  onClick={async () => {
                    if (!feedback.trim() || postingFb) return;
                    setPostingFb(true);
                    try {
                      await postComment(record.id, user?.email || 'Admin', `[Feedback] ${feedback.trim()}`);
                      setFeedback('');
                    } catch (err) { setReviewError(err.message); }
                    finally { setPostingFb(false); }
                  }}
                >
                  {postingFb ? '…' : 'Send Feedback'}
                </ArcadeBtn>
              </div>
            </div>
          </div>

          {reviewError && (
            <p style={{ fontFamily: "'IBM Plex Mono'", fontSize: '12px', color: CORAL, marginTop: '16px' }}>{reviewError}</p>
          )}
        </div>
      );
    }

    const EMPTY_SHOP_ITEM = { title: '', desc: '', coins: 0, minPlayers: 10, image: '', active: true };

    /* ─── Admin shop tab ──────────────────────────────────────────────────── */
    function AdminShopTab({ token }) {
      const [orders,      setOrders]      = useState([]);
      const [items,       setItems]       = useState([]);
      const [loading,     setLoading]     = useState(true);
      const [error,       setError]       = useState(null);
      const [editing,     setEditing]     = useState(null);
      const [form,        setForm]        = useState(EMPTY_SHOP_ITEM);
      const [saving,      setSaving]      = useState(false);

      const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
          const [itemsData, ordersData] = await Promise.all([
            adminShopItems(token),
            adminShopOrders(token),
          ]);
          setItems(itemsData.items || []);
          setOrders(ordersData.orders || []);
        } catch (err) {
          setError(err.message || 'Failed to load shop data');
        } finally { setLoading(false); }
      }, [token]);

      useEffect(() => { load(); }, [load]);

      const startNew = () => { setEditing('new'); setForm({ ...EMPTY_SHOP_ITEM }); };
      const startEdit = (item) => { setEditing(item.id); setForm({ ...item }); };
      const cancelEdit = () => { setEditing(null); setForm(EMPTY_SHOP_ITEM); };

      const saveItem = async (e) => {
        e.preventDefault();
        setSaving(true);
        setError(null);
        try {
          const data = await adminShopItemSave(token, form);
          setItems(data.items || []);
          cancelEdit();
        } catch (err) {
          setError(err.message || 'Save failed');
        } finally { setSaving(false); }
      };

      const deleteItem = async (id) => {
        if (!confirm('Delete this shop item?')) return;
        try {
          const data = await adminShopItemDelete(token, id);
          setItems(data.items || []);
          if (editing === id) cancelEdit();
        } catch (err) {
          setError(err.message || 'Delete failed');
        }
      };

      const updateOrderStatus = async (id, status) => {
        try {
          const data = await adminShopOrderUpdate(token, id, status);
          setOrders(prev => prev.map(o => o.id === id ? data.order : o));
        } catch (err) {
          setError(err.message || 'Update failed');
        }
      };

      const fieldStyle = { width: '100%', boxSizing: 'border-box' };
      const labelStyle = { fontFamily: "'IBM Plex Mono'", fontSize: '11px', color: PURPLE, marginBottom: '4px', display: 'block' };

      return (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '10px' }}>
            <h2 style={{ fontFamily: "'Press Start 2P'", fontSize: '11px', color: AMBER, margin: 0, lineHeight: 1.6 }}>SHOP ORDERS</h2>
            <ArcadeBtn bg={PURPLE} dark={PURPLED} style={{ fontSize: '10px' }} onClick={load}>↻ Refresh</ArcadeBtn>
          </div>

          {error && <p style={{ fontFamily: "'IBM Plex Mono'", fontSize: '12px', color: CORAL, marginBottom: '16px' }}>{error}</p>}
          {loading && <p style={{ fontFamily: "'IBM Plex Mono'", fontSize: '13px', color: MUTED }}>Loading…</p>}

          {!loading && orders.length === 0 && (
            <p style={{ fontFamily: "'IBM Plex Mono'", fontSize: '13px', color: MUTED, fontStyle: 'italic', marginBottom: '32px' }}>No orders yet.</p>
          )}
          {!loading && orders.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '40px' }}>
              {orders.map(o => (
                <div key={o.id} style={{ background: CARD, border: `1px solid ${PURPLE}`, padding: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', flexWrap: 'wrap' }}>
                  <div>
                    <div style={{ fontFamily: "'Press Start 2P'", fontSize: '9px', color: AMBER, marginBottom: '8px', lineHeight: 1.6 }}>{o.itemTitle}</div>
                    <div style={{ fontFamily: "'IBM Plex Mono'", fontSize: '12px', color: CREAM, lineHeight: 1.7 }}>
                      {o.email}<br />
                      ¢ {o.coins} · {o.totalPlays} players · {o.totalHours}h<br />
                      {new Date(o.orderedAt).toLocaleString()}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={{ fontFamily: "'IBM Plex Mono'", fontSize: '10px', fontWeight: 700, color: BG, background: o.status === 'fulfilled' ? GREEN : AMBER, padding: '4px 10px' }}>
                      {o.status}
                    </span>
                    {o.status !== 'fulfilled' && (
                      <ArcadeBtn bg={GREEN} dark={GREEND} style={{ fontSize: '9px' }} onClick={() => updateOrderStatus(o.id, 'fulfilled')}>Mark Fulfilled</ArcadeBtn>
                    )}
                    {o.status === 'fulfilled' && (
                      <button onClick={() => updateOrderStatus(o.id, 'pending')} style={{ fontFamily: "'IBM Plex Mono'", fontSize: '10px', color: MUTED, background: 'none', border: `1px solid ${MUTED}`, padding: '4px 10px', cursor: 'pointer' }}>Reopen</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
            <h2 style={{ fontFamily: "'Press Start 2P'", fontSize: '11px', color: AMBER, margin: 0, lineHeight: 1.6 }}>SHOP ITEMS</h2>
            <ArcadeBtn bg={AMBER} style={{ fontSize: '10px' }} onClick={startNew}>+ New Item</ArcadeBtn>
          </div>

          {editing && (
            <form onSubmit={saveItem} style={{ background: CARD, border: `1px solid ${AMBER}`, padding: '20px', marginBottom: '24px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={labelStyle}>Title</label>
                <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} style={fieldStyle} required />
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={labelStyle}>Description</label>
                <textarea value={form.desc} onChange={e => setForm(f => ({ ...f, desc: e.target.value }))} rows={2} style={fieldStyle} />
              </div>
              <div>
                <label style={labelStyle}>Coins</label>
                <input type="number" min="0" value={form.coins} onChange={e => setForm(f => ({ ...f, coins: Number(e.target.value) }))} style={fieldStyle} />
              </div>
              <div>
                <label style={labelStyle}>Min players</label>
                <input type="number" min="0" value={form.minPlayers} onChange={e => setForm(f => ({ ...f, minPlayers: Number(e.target.value) }))} style={fieldStyle} />
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={labelStyle}>Image path (e.g. /shop-steam-giftcard.png)</label>
                <input value={form.image} onChange={e => setForm(f => ({ ...f, image: e.target.value }))} style={fieldStyle} />
              </div>
              <label style={{ gridColumn: '1 / -1', fontFamily: "'IBM Plex Mono'", fontSize: '12px', color: CREAM, display: 'flex', alignItems: 'center', gap: '8px' }}>
                <input type="checkbox" checked={form.active !== false} onChange={e => setForm(f => ({ ...f, active: e.target.checked }))} />
                Active (visible in shop)
              </label>
              <div style={{ gridColumn: '1 / -1', display: 'flex', gap: '10px' }}>
                <ArcadeBtn type="submit" bg={GREEN} dark={GREEND} style={{ fontSize: '10px', opacity: saving ? 0.6 : 1 }}>{saving ? '…' : 'Save Item'}</ArcadeBtn>
                <ArcadeBtn type="button" bg={CORAL} style={{ fontSize: '10px' }} onClick={cancelEdit}>Cancel</ArcadeBtn>
              </div>
            </form>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {items.map(item => (
              <div key={item.id} style={{ background: CARD, border: `1px solid ${item.active === false ? MUTED : PURPLE}`, padding: '16px', opacity: item.active === false ? 0.6 : 1, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', gap: '14px', alignItems: 'center' }}>
                  {item.image && (
                    <img src={item.image} alt="" style={{ width: '48px', height: '48px', objectFit: 'contain', background: '#0f0820' }} />
                  )}
                  <div>
                    <div style={{ fontFamily: "'Press Start 2P'", fontSize: '9px', color: AMBER, marginBottom: '6px', lineHeight: 1.6 }}>{item.title}</div>
                    <div style={{ fontFamily: "'IBM Plex Mono'", fontSize: '11px', color: MUTED }}>
                      ¢ {item.coins} · {item.minPlayers} players{item.active === false ? ' · inactive' : ''}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <ArcadeBtn bg={PURPLE} dark={PURPLED} style={{ fontSize: '9px' }} onClick={() => startEdit(item)}>Edit</ArcadeBtn>
                  <ArcadeBtn bg={CORAL} style={{ fontSize: '9px' }} onClick={() => deleteItem(item.id)}>Delete</ArcadeBtn>
                </div>
              </div>
            ))}
          </div>
        </div>
      );
    }

    /* ─── Admin Review Page ────────────────────────────────────────────────── */
    function AdminPage({ user }) {
      const [status,       setStatus]       = useState('loading');
      const [records,      setRecords]      = useState([]);
      const [fields,       setFields]       = useState(null);
      const [error,        setError]        = useState(null);
      const [tab,          setTab]          = useState('pending');
      const [viewingId,    setViewingId]    = useState(null);
      const [selectedTags, setSelectedTags] = useState([]);

      const token = user?.token;

      const load = useCallback(async () => {
        if (!token) { setStatus('denied'); return; }
        setError(null);
        try {
          const data = await adminList(token);
          setRecords(data.records || []);
          setFields(data.fields || null);
          setStatus('ready');
        } catch (err) {
          if (err.message?.includes('denied') || err.message?.includes('authenticated')) {
            setStatus('denied');
          } else {
            setError(err.message || 'Failed to load');
            setStatus('ready');
          }
        }
      }, [token]);

      useEffect(() => { load(); }, [load]);

      const handleReviewed = (recordId, reviewStatus) => {
        setRecords(prev => prev.map(r =>
          r.id === recordId
            ? { ...r, fields: { ...r.fields, [fields?.reviewStatus || 'Review Status']: reviewStatus } }
            : r
        ));
      };

      if (status === 'loading') {
        return (
          <div className="fade-in" style={{ padding: '48px 40px', display: 'flex', alignItems: 'center', gap: '16px' }}>
            <p style={{ fontFamily: "'IBM Plex Mono'", fontSize: '14px', color: MUTED }}>Verifying access…</p>
          </div>
        );
      }

      if (status === 'denied') {
        return (
          <div className="fade-in" style={{ padding: '48px 40px', maxWidth: '440px' }}>
            <h1 style={{ fontFamily: "'Press Start 2P'", fontSize: '16px', color: CORAL, marginBottom: '20px', lineHeight: 1.5 }}>ACCESS DENIED</h1>
            <p style={{ fontFamily: "'IBM Plex Mono'", fontSize: '14px', color: CREAM, lineHeight: 1.9 }}>
              Your account ({user?.email || 'unknown'}) does not have admin access.
            </p>
          </div>
        );
      }

      const getReviewSt = r => r.fields?.[fields?.reviewStatus || 'Review Status'] || '';
      const recordTags = r => {
        const raw = (r.fields || {})[fields?.tags || 'Tags'] || '';
        return raw ? raw.split(',').map(t => t.trim()).filter(Boolean) : [];
      };
      const pendingRecords  = records.filter(r => {
        const s = normalizeReviewStatus(getReviewSt(r));
        return !s || s === 'under-review';
      });
      const reviewedRecords = records.filter(r => {
        const s = normalizeReviewStatus(getReviewSt(r));
        return s === 'accepted' || s === 'rejected';
      });
      const tabRecords = tab === 'pending' ? pendingRecords : reviewedRecords;
      const allTags = collectTags(tabRecords.map(r => ({ tags: recordTags(r) })));
      const toggleTag = (tag) => setSelectedTags(prev =>
        prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]);
      const shown = selectedTags.length === 0
        ? tabRecords
        : tabRecords.filter(r => selectedTags.some(t => recordTags(r).includes(t)));
      const viewingRecord = tab !== 'shop' && viewingId ? records.find(r => r.id === viewingId) : null;

      if (viewingRecord) {
        return (
          <AdminReviewView
            record={viewingRecord}
            fields={fields}
            token={token}
            user={user}
            onBack={() => setViewingId(null)}
            onReviewed={handleReviewed}
          />
        );
      }

      return (
        <div className="fade-in" style={{ padding: '48px 40px 60px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '28px', flexWrap: 'wrap', gap: '12px' }}>
            <h1 style={{ fontFamily: "'Press Start 2P'", fontSize: '18px', color: AMBER, lineHeight: 1.5 }}>ADMIN</h1>
            {tab !== 'shop' && <ArcadeBtn bg={PURPLE} dark={PURPLED} style={{ fontSize: '11px' }} onClick={load}>↻ Refresh</ArcadeBtn>}
          </div>

          {/* Tabs */}
          <div style={{ display: 'flex', gap: '0', marginBottom: '28px', borderBottom: `2px solid ${AMBER}33` }}>
            {[
              { key: 'pending',  label: 'Pending Review', count: pendingRecords.length,  color: AMBER  },
              { key: 'reviewed', label: 'Reviewed',       count: reviewedRecords.length, color: GREEN  },
              { key: 'shop',     label: 'Shop',           count: null,                   color: PURPLE },
            ].map(({ key, label, count, color }) => (
              <button key={key} onClick={() => { setTab(key); setViewingId(null); setSelectedTags([]); }} style={{
                fontFamily: "'Press Start 2P'", fontSize: '10px',
                padding: '10px 20px',
                background: tab === key ? `${color}18` : 'transparent',
                color: tab === key ? color : MUTED,
                border: 'none', borderBottom: tab === key ? `2px solid ${color}` : '2px solid transparent',
                cursor: 'pointer', marginBottom: '-2px',
                display: 'flex', alignItems: 'center', gap: '8px',
                lineHeight: 1.5,
              }}>
                {label}
                {count != null && (
                  <span style={{
                    fontFamily: "'IBM Plex Mono'", fontSize: '10px',
                    background: tab === key ? color : `${MUTED}44`,
                    color: tab === key ? BG : MUTED,
                    borderRadius: 0, padding: '1px 7px',
                  }}>{count}</span>
                )}
              </button>
            ))}
          </div>

          {tab === 'shop' && <AdminShopTab token={token} />}

          {tab !== 'shop' && allTags.length > 0 && (
            <TagFilterBar
              allTags={allTags}
              selected={selectedTags}
              onToggle={toggleTag}
              onClear={() => setSelectedTags([])}
              style={{ marginBottom: '24px' }}
            />
          )}

          {tab !== 'shop' && error && <p style={{ fontFamily: "'IBM Plex Mono'", fontSize: '13px', color: CORAL, marginBottom: '20px' }}>{error}</p>}
          {tab !== 'shop' && shown.length === 0 && (
            <p style={{ fontFamily: "'IBM Plex Mono'", fontSize: '14px', color: MUTED, fontStyle: 'italic' }}>
              {selectedTags.length > 0
                ? `No ${tab === 'pending' ? 'pending' : 'reviewed'} submissions match the selected ${selectedTags.length > 1 ? 'tags' : 'tag'}.`
                : (tab === 'pending' ? 'No submissions awaiting review.' : 'No reviewed submissions yet.')}
            </p>
          )}
          {tab !== 'shop' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {shown.map(r => (
                <AdminSubmissionRow
                  key={r.id}
                  record={r}
                  fields={fields}
                  tags={recordTags(r)}
                  selectedTags={selectedTags}
                  onToggleTag={toggleTag}
                  onView={() => setViewingId(r.id)}
                />
              ))}
            </div>
          )}
        </div>
      );
    }

    /* ─── App root ────────────────────────────────────────────────────────── */
    function App() {
      // Include the saved token immediately so Admin/protected pages work before async validation
      const cachedUser = (() => {
        try {
          const u = JSON.parse(localStorage.getItem('ic_user') || 'null');
          const token = localStorage.getItem('ht_token');
          return u && token ? { ...u, token } : null;
        } catch { return null; }
      })();
      const [user,           setUser]           = useState(cachedUser);
      const [projects,       setProjects]       = useState(() => {
        try {
          const u = JSON.parse(localStorage.getItem('ic_user') || 'null');
          if (u?.email) return JSON.parse(localStorage.getItem(projectsStorageKey(u.email)) || '[]');
          return [];
        } catch { return []; }
      });
      const [page,           setPage]           = useState('home');
      const [currentProject, setCurrentProject] = useState(null);
      const [showSignIn,     setShowSignIn]     = useState(false);
      const [authError,      setAuthError]      = useState(null);
      const [authPending,    setAuthPending]    = useState(false);
      const [htProjects,     setHtProjects]     = useState([]);
      const [userRecordId,   setUserRecordId]   = useState(null);
      const saveTimerRef = useRef(null);

      // ── Save projects to localStorage + debounce-sync to Airtable ─────────
      useEffect(() => {
        if (!user?.email) return;
        const key = projectsStorageKey(user.email);
        localStorage.setItem(key, JSON.stringify(projects));
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = setTimeout(() => {
          saveUserProjects(user.email, projects, userRecordId)
            .then(d => { if (d.recordId && d.recordId !== userRecordId) setUserRecordId(d.recordId); })
            .catch(err => console.warn('[sync] Failed to save projects to server:', err.message));
        }, 2000);
      }, [projects, user?.email, userRecordId]);

      // ── Keep submission review status in sync with Airtable for all users ─
      useEffect(() => {
        if (!user?.email) return;
        const syncStatuses = async () => {
          try {
            const subs = await getMySubmissions(user.email);
            setProjects(prev => {
              const merged = mergeSubmissionStatuses(prev, subs.submissions || []);
              const key = projectsStorageKey(user.email);
              localStorage.setItem(key, JSON.stringify(merged));
              return merged;
            });
          } catch {}
        };
        syncStatuses();
        const interval = setInterval(syncStatuses, 45000);
        const onVisible = () => {
          if (document.visibilityState === 'visible') syncStatuses();
        };
        document.addEventListener('visibilitychange', onVisible);
        return () => {
          clearInterval(interval);
          document.removeEventListener('visibilitychange', onVisible);
        };
      }, [user?.email]);

      // ── Restore session + handle OAuth callback ────────────────────────────
      useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const code  = params.get('code');
        const state = params.get('state');

        const loadSession = async (token) => {
          const me = await getHackatimeMe(token);
          const proj = await getHackatimeProjects(token).catch(() => null);
          const list = proj?.data?.data || proj?.data?.projects || proj?.data || [];
          setHtProjects(Array.isArray(list) ? list : []);
          const isAdmin = await adminCheck(token).then(r => r?.success === true).catch(() => false);
          const u = {
            email: me.email,
            username: me.email,
            token,
            isAdmin,
            githubUsername: me.githubUsername || null,
            firstName: me.firstName || '',
            lastName: me.lastName || '',
          };
          setUser(u);
          localStorage.setItem('ht_token', token);
          localStorage.setItem('ic_user', JSON.stringify({
            email: me.email,
            username: me.email,
            isAdmin,
            githubUsername: u.githubUsername,
            firstName: u.firstName,
            lastName: u.lastName,
          }));

          // Load this user's projects from Airtable (server is source of truth in production)
          try {
            const saved = await loadUserProjects(me.email);
            const key = projectsStorageKey(me.email);
            let loaded = saved.projects?.length > 0
              ? saved.projects
              : JSON.parse(localStorage.getItem(key) || '[]');
            try {
              const subs = await getMySubmissions(me.email);
              loaded = mergeSubmissionStatuses(loaded, subs.submissions || []);
            } catch {}
            setProjects(loaded);
            localStorage.setItem(key, JSON.stringify(loaded));
            setUserRecordId(saved.recordId || null);
          } catch {} // Keep email-scoped localStorage if Airtable fails
        };

        if (code && state === 'hackatime') {
          setAuthPending(true);
          // Strip code from URL immediately so it's not re-used on refresh
          window.history.replaceState({}, document.title, window.location.origin + '/');
          exchangeHackatimeCode(code)
            .then(async (data) => {
              await loadSession(data.accessToken);
              setShowSignIn(false);
              setAuthError(null);
            })
            .catch(err => {
              setAuthError(err.message || 'Login failed.');
              setShowSignIn(true); // re-open modal so error is visible
            })
            .finally(() => setAuthPending(false));
        } else {
          const saved = localStorage.getItem('ht_token');
          if (saved) loadSession(saved).catch(() => {
            localStorage.removeItem('ht_token');
            localStorage.removeItem('ic_user');
            setUser(null);
          });
        }
      }, []);

      const handleSignOut = () => {
        localStorage.removeItem('ht_token');
        localStorage.removeItem('ic_user');
        setUser(null);
        setHtProjects([]);
        setUserRecordId(null);
        setPage('home');
      };

      // Hours from under-review projects are pending — don't count until reviewed
      const totalHours = projects
        .filter(p => p.submissionStatus !== 'under-review')
        .reduce((s, p) => s + (p.hours || 0), 0);
      const pendingHours = projects
        .filter(p => p.submissionStatus === 'under-review')
        .reduce((s, p) => s + (p.hours || 0), 0);

      const handleSetPage = p => { setPage(p); setCurrentProject(null); };

      const handleCreate = proj => setProjects(prev => [...prev, proj]);

      const handleSetHours = useCallback((id, hours) =>
        setProjects(prev => prev.map(p => p.id === id ? { ...p, hours } : p)), []);

      const handleAddEntry = useCallback((id, text) => {
        const date = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
        setProjects(prev => prev.map(p =>
          p.id === id ? { ...p, journalEntries: [...p.journalEntries, { date, text }] } : p
        ));
      }, []);

      const handleSetTags = useCallback((id, tags) =>
        setProjects(prev => prev.map(p => p.id === id ? { ...p, tags } : p)), []);

      const handleSubmitted = useCallback((projectId, recordId, itchUrl, selectedTier, tags) => {
        setProjects(prev => prev.map(p =>
          p.id === projectId
            ? { ...p, submissionStatus: 'under-review', airtableRecordId: recordId || p.airtableRecordId,
                itchUrl: itchUrl || p.itchUrl, selectedTier: selectedTier || p.selectedTier,
                tags: tags || p.tags || [] }
            : p
        ));
      }, []);

      const renderMain = () => {
        switch (page) {
          case 'home':     return <HomePage totalHours={totalHours} />;
          case 'projects': return (
            <ProjectsPage
              projects={projects}
              totalHours={totalHours}
              pendingHours={pendingHours}
              onCreate={handleCreate}
              onView={setCurrentProject}
              onSetHours={handleSetHours}
              onAddEntry={handleAddEntry}
              onSetTags={handleSetTags}
              currentProject={currentProject}
              onOpenCreateModal={() => setPage('create-project')}
              onSubmitToJam={() => setPage('submit')}
              userToken={user?.token}
              user={user}
            />
          );
          case 'create-project': return (
            <CreateProjectPage
              onCreate={p => { handleCreate(p); setPage('projects'); }}
              onCancel={() => setPage('projects')}
              htProjects={htProjects}
            />
          );
          case 'submit': return (
            <SubmitProjectPage
              user={user}
              projects={projects}
              userRecordId={userRecordId}
              onRequireSignIn={() => { setAuthError(null); setShowSignIn(true); }}
              onDone={() => setPage('projects')}
              onSubmitted={handleSubmitted}
            />
          );
          case 'admin':      return <AdminPage user={user} />;
          case 'tutorial':   return <TutorialPage />;
          case 'shop':       return <ShopPage projects={projects} totalHours={totalHours} user={user} />;
          case 'arcade':     return <GamesPage user={user} />;
          case 'faq':        return <FAQPage />;
          case 'guidelines': return <GuidelinesPage />;
          default:         return <HomePage totalHours={totalHours} />;
        }
      };

      return (
        <div style={{ display: 'flex', minHeight: '100vh', position: 'relative' }}>
          <BackgroundScene page={page} />
          {altOf(page) === 'above' && <BgSprites />}
          {altOf(page) === 'above' && <MeteorShower />}
          {authPending && <AuthLoadingOverlay />}
          {user && (
            <Sidebar
              page={page}
              setPage={handleSetPage}
              user={user}
              onSignIn={() => { setAuthError(null); setShowSignIn(true); }}
              onSignOut={handleSignOut}
            />
          )}

          <main style={{ flex: 1, overflowY: 'auto', minHeight: '100vh', position: 'relative', zIndex: 1 }}>
            {!user
              ? <SignInPage onSignIn={() => { setAuthError(null); setShowSignIn(true); }} authError={authError} />
              : renderMain()
            }
          </main>

          {showSignIn && (
            <SignInModal
              onClose={() => setShowSignIn(false)}
              authError={authError}
              authPending={authPending}
            />
          )}
        </div>
      );
    }

export default App;
