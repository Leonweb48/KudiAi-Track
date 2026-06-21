/**
 * Community Management System — JSDoc type definitions
 * Mirrors the Supabase PostgreSQL schema (20260707 migrations).
 *
 * Usage: import these as JSDoc @type annotations for IDE autocompletion.
 */

// ─── Enums ────────────────────────────────────────────────────────────────────

export const ChatRole = /** @type {const} */ ({
  OWNER:     'owner',
  ADMIN:     'admin',
  MODERATOR: 'moderator',
  VERIFIED:  'verified',
  PREMIUM:   'premium',
  MEMBER:    'member',
});

export const DisappearingMessages = /** @type {const} */ ({
  OFF:  'off',
  H24:  '24h',
  D7:   '7d',
  D30:  '30d',
  D90:  '90d',
});

export const MediaType = /** @type {const} */ ({
  PHOTO:    'photo',
  VIDEO:    'video',
  AUDIO:    'audio',
  DOCUMENT: 'document',
  LINK:     'link',
});

export const VoiceRole = /** @type {const} */ ({
  HOST:     'host',
  CO_HOST:  'co_host',
  SPEAKER:  'speaker',
  LISTENER: 'listener',
});

export const ReportCategory = /** @type {const} */ ({
  SPAM:                'spam',
  HARASSMENT:          'harassment',
  HATE_SPEECH:         'hate_speech',
  MISINFORMATION:      'misinformation',
  INAPPROPRIATE:       'inappropriate_content',
  IMPERSONATION:       'impersonation',
  VIOLENCE:            'violence',
  OTHER:               'other',
});

export const ReputationAction = /** @type {const} */ ({
  MESSAGE_SENT:       'message_sent',
  MEDIA_SHARED:       'media_shared',
  REACTION_RECEIVED:  'reaction_received',
  POLL_VOTED:         'poll_voted',
  EVENT_ATTENDED:     'event_attended',
  VOICE_JOINED:       'voice_joined',
  HELPFUL_REPLY:      'helpful_reply',
  MILESTONE_REACHED:  'milestone_reached',
  BADGE_EARNED:       'badge_earned',
  ADMIN_GRANT:        'admin_grant',
  ADMIN_DEDUCT:       'admin_deduct',
});

// ─── Level thresholds ─────────────────────────────────────────────────────────

export const LEVEL_THRESHOLDS = [0, 100, 300, 600, 1000, 2000, 4000, 7000, 12000, 20000];

export const LEVEL_TITLES = [
  '', 'Newcomer', 'Member', 'Regular', 'Contributor',
  'Active', 'Veteran', 'Champion', 'Legend', 'Elite', 'Icon',
];

/**
 * Calculate level and progress from reputation points.
 * @param {number} points
 * @returns {{ level: number, title: string, progress: number, pointsToNext: number }}
 */
export function calcLevel(points) {
  let level = 1;
  for (let i = LEVEL_THRESHOLDS.length - 1; i >= 0; i--) {
    if (points >= LEVEL_THRESHOLDS[i]) { level = i + 1; break; }
  }
  level = Math.min(level, 10);
  const current   = LEVEL_THRESHOLDS[level - 1] ?? 0;
  const next      = LEVEL_THRESHOLDS[level]      ?? Infinity;
  const progress  = next === Infinity ? 100 : Math.round(((points - current) / (next - current)) * 100);
  const pointsToNext = next === Infinity ? 0 : next - points;
  return { level, title: LEVEL_TITLES[level] ?? 'Icon', progress, pointsToNext };
}

// ─── Default badge definitions (seeded per org on creation) ──────────────────

export const DEFAULT_BADGES = [
  { name: 'First Message',   icon: '💬', color: '#3b82f6', category: 'milestone',      auto_award: true,  criteria_type: 'message_count', criteria_value: 1   },
  { name: 'Active Chatter',  icon: '🔥', color: '#ef4444', category: 'engagement',     auto_award: true,  criteria_type: 'message_count', criteria_value: 50  },
  { name: 'Top Contributor', icon: '🏆', color: '#f59e0b', category: 'top_contributor', auto_award: true,  criteria_type: 'message_count', criteria_value: 200 },
  { name: 'Rising Star',     icon: '⭐', color: '#8b5cf6', category: 'engagement',     auto_award: true,  criteria_type: 'reputation',    criteria_value: 500 },
  { name: 'Community Pillar',icon: '🏛️', color: '#10b981', category: 'milestone',      auto_award: true,  criteria_type: 'reputation',    criteria_value: 2000},
  { name: 'Verified Member', icon: '✅', color: '#06b6d4', category: 'special',        auto_award: false, criteria_type: null,             criteria_value: null},
  { name: 'Moderator',       icon: '🛡️', color: '#475569', category: 'moderation',     auto_award: false, criteria_type: null,             criteria_value: null},
];

// ─── Slow-mode display helper ──────────────────────────────────────────────────

/**
 * @param {number} seconds
 * @returns {string}
 */
export function fmtSlowMode(seconds) {
  if (!seconds) return 'Off';
  if (seconds < 60)  return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3600)}h`;
}

// ─── JSDoc type stubs (for IDE autocompletion) ───────────────────────────────

/**
 * @typedef {Object} GroupSettings
 * @property {string}  org_id
 * @property {string}  [chat_name]
 * @property {string}  [description]
 * @property {string}  [rules]
 * @property {string}  [emoji]
 * @property {string}  [cover_image_url]
 * @property {string}  [category]
 * @property {boolean} [is_private]
 * @property {boolean} [is_verified]
 * @property {string}  [disappearing_messages]  'off'|'24h'|'7d'|'30d'|'90d'
 * @property {boolean} [chat_locked]
 * @property {boolean} [anti_spam_enabled]
 * @property {boolean} [forwarding_restricted]
 * @property {boolean} [copy_restricted]
 * @property {boolean} [screenshot_detection]
 * @property {number}  [max_members]
 * @property {number}  [slow_mode_seconds]
 * @property {string}  [welcome_message]
 */

/**
 * @typedef {Object} GroupMember
 * @property {string}  id
 * @property {string}  org_id
 * @property {string}  full_name
 * @property {string}  [avatar_url]
 * @property {string}  [email]
 * @property {string}  [phone]
 * @property {string}  role            org role
 * @property {string}  chat_role       'owner'|'admin'|'moderator'|'verified'|'premium'|'member'
 * @property {string}  status          'active'|'suspended'|'removed'
 * @property {number}  reputation_points
 * @property {number}  level
 * @property {number}  badge_count
 * @property {number}  message_count
 * @property {boolean} is_muted
 * @property {string}  [muted_until]
 * @property {boolean} is_banned
 * @property {string}  [last_active_at]
 */

/**
 * @typedef {Object} GroupInvite
 * @property {string}  id
 * @property {string}  org_id
 * @property {string}  created_by
 * @property {string}  code
 * @property {string}  [label]
 * @property {string}  [expires_at]
 * @property {number}  [max_uses]
 * @property {number}  use_count
 * @property {boolean} requires_approval
 * @property {boolean} is_active
 */

/**
 * @typedef {Object} GroupEvent
 * @property {string}  id
 * @property {string}  org_id
 * @property {string}  title
 * @property {string}  [description]
 * @property {string}  [cover_image_url]
 * @property {string}  [location]
 * @property {string}  starts_at
 * @property {string}  [ends_at]
 * @property {boolean} is_online
 * @property {string}  [meeting_url]
 * @property {number}  rsvp_count
 * @property {boolean} is_cancelled
 */

/**
 * @typedef {Object} GroupPoll
 * @property {string}  id
 * @property {string}  org_id
 * @property {string}  question
 * @property {boolean} allows_multiple
 * @property {boolean} is_anonymous
 * @property {string}  [expires_at]
 * @property {number}  total_votes
 * @property {boolean} is_closed
 * @property {GroupPollOption[]} [options]
 */

/**
 * @typedef {Object} GroupPollOption
 * @property {string} id
 * @property {string} poll_id
 * @property {string} text
 * @property {number} vote_count
 */

/**
 * @typedef {Object} VoiceRoom
 * @property {string}  id
 * @property {string}  org_id
 * @property {string}  name
 * @property {string}  status        'active'|'ended'|'scheduled'
 * @property {string}  channel_id
 * @property {number}  speaker_count
 * @property {number}  listener_count
 * @property {string}  started_at
 * @property {string}  [ended_at]
 */

/**
 * @typedef {Object} GroupBadge
 * @property {string}  id
 * @property {string}  org_id
 * @property {string}  name
 * @property {string}  icon
 * @property {string}  color
 * @property {string}  category
 * @property {boolean} auto_award
 */

/**
 * @typedef {Object} LeaderboardEntry
 * @property {string} member_id
 * @property {string} org_id
 * @property {string} full_name
 * @property {string} [avatar_url]
 * @property {string} chat_role
 * @property {number} reputation_points
 * @property {number} level
 * @property {number} badge_count
 * @property {number} message_count
 * @property {number} rank
 */

/**
 * @typedef {Object} GroupAnalytics
 * @property {number} total_members
 * @property {number} online_now
 * @property {number} total_messages
 * @property {number} messages_last_7d
 * @property {number} messages_last_30d
 * @property {number} active_members_7d
 * @property {number} media_shared
 * @property {number} polls_created
 * @property {number} events_created
 * @property {number} voice_sessions
 * @property {number} reports_pending
 * @property {number} join_requests
 * @property {LeaderboardEntry[]} top_contributors
 * @property {number} new_members_30d
 * @property {{ date: string, count: number }[]} daily_messages
 */
