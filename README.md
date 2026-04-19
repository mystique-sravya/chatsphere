# ChatSphere

A real-time social chat platform with glassmorphic UI, WebSocket messaging, voice calls, and smart identity.

## Features

### Authentication & Identity
- **JWT Auth** — Signup/Login with unique, immutable username enforcement
- **Password Change** — Requires current password verification
- **Avatar System** — DiceBear styles, custom image upload, optional remote URL (with confirmation)
- **Admin Panel** — User management, room moderation, ban/unban, stats dashboard

### Chat & Messaging
- **Room Types** — Public, Private, and 1-on-1 DM conversations
- **Real-Time Messaging** — WebSocket-powered with typing indicators and delivered/seen status
- **Replies** — Reply to specific messages with context preview
- **Reactions** — Quick emoji reactions and full emoji picker on any message
- **Message Search** — Search messages within any chat room
- **Message Lifecycle** — Auto-delete after configurable retention, manual delete within 24h window
- **Invite Links** — Share private room invite codes

### Social
- **Friend System** — Send/accept/reject requests, favorites, online status tracking
- **Friend Suggestions** — Discover users you may know
- **Block/Unblock** — Block users from search, friend requests, and DM creation; manage blocked list in settings
- **Presence** — Real-time online/offline status and active room tracking

### Notifications
- **Unread Indicators** — Persistent red dot on chats with unread messages, reactions, or voice activity
- **Friend Request Badge** — Count badge on friends panel for pending requests
- **Server-Persisted** — Unread state survives page refresh via `last_read_at` tracking

### Voice Calls (DM)
- **WebRTC Audio** — Peer-to-peer DM voice calls using browser WebRTC
- **WebSocket Signaling** — Offer/answer/ICE candidate exchange over existing WebSocket
- **Call Controls** — Start, join, mute/unmute, leave with in-call status display
- **Auto-Cleanup** — Stale calls auto-end after 60 seconds without connection

### UI/UX
- **Dark & Light Theme** — Glassmorphism design with smooth Framer Motion animations
- **Fully Mobile Responsive** — Sidebar, chat area, settings, and panels adapt to mobile screens
- **Explore Rooms** — Browse and join public chat rooms
- **Settings Modal** — Tabbed interface for profile, security, appearance, alerts, and blocked users

## Tech Stack

| Layer    | Technology                                                        |
|----------|-------------------------------------------------------------------|
| Frontend | React 18, Vite, TypeScript, Tailwind CSS, Framer Motion, Zustand |
| Backend  | Node.js, Express, WebSocket (`ws`), JWT, bcryptjs                 |
| Database | PostgreSQL (Supabase)                                             |
| Voice    | WebRTC (browser) + WebSocket signaling                            |

## Quick Start

### 1. Backend

```bash
cd backend
npm install

# Copy & configure environment
cp .env.example .env
# Edit .env with your Supabase DATABASE_URL and a JWT secret

# Run
npm run dev    # development (auto-restart on changes)
npm start      # production
```

### 2. Frontend

```bash
cd frontend
npm install
npm run dev
```

App runs at `http://localhost:5173` (API & WebSocket proxied to `:8000`).

### 3. Database

Tables are auto-created on backend startup. No manual migration needed.

## Project Structure

```
chatsphere/
├── backend/
│   ├── index.js              # Express app, routes, WebSocket, DB bootstrap
│   ├── .env.example          # Environment variable template
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── components/       # ChatArea, Sidebar, SettingsModal, RightPanel, etc.
│   │   ├── pages/            # Chat, Login, Signup, Admin
│   │   ├── stores/           # Zustand stores (auth, chat, friends)
│   │   ├── hooks/            # useWebSocket, useDmVoiceCall
│   │   ├── lib/              # API client, utils, voiceEvents
│   │   └── types.ts          # TypeScript interfaces
│   └── ...config files
├── .gitignore
└── README.md
```

## API Endpoints

### Auth
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/signup` | Register new user |
| POST | `/api/auth/login` | Login |
| GET | `/api/auth/me` | Get current user |
| PUT | `/api/auth/me` | Update profile (username is immutable) |
| PUT | `/api/auth/password` | Change password (requires current password) |

### Rooms
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/rooms` | Create room (public/private/dm) |
| GET | `/api/rooms` | List accessible rooms (with unread flags) |
| GET | `/api/rooms/my` | My rooms only |
| GET | `/api/rooms/explore` | Browse public rooms |
| POST | `/api/rooms/:id/join` | Join room |
| POST | `/api/rooms/:id/leave` | Leave room |
| DELETE | `/api/rooms/:id` | Delete room |
| POST | `/api/rooms/:id/invite` | Generate invite code |
| PUT | `/api/rooms/:id/retention` | Set message retention |

### Messages
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/messages/:roomId` | Get messages (also marks room as read) |
| GET | `/api/messages/:roomId/search` | Search messages by keyword |
| DELETE | `/api/messages/:id` | Delete message |
| POST | `/api/messages/:id/react` | Toggle emoji reaction |

### Friends
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/friends/request` | Send friend request |
| GET | `/api/friends/requests` | Pending incoming requests |
| GET | `/api/friends/requests/sent` | Sent requests |
| POST | `/api/friends/requests/:id/accept` | Accept request |
| POST | `/api/friends/requests/:id/reject` | Reject request |
| GET | `/api/friends` | List friends |
| GET | `/api/friends/suggestions` | Friend suggestions |
| PUT | `/api/friends/:id/favorite` | Toggle favorite |
| DELETE | `/api/friends/:id` | Remove friend |

### Blocks
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/blocks` | List blocked users |
| POST | `/api/users/:id/block` | Block user |
| DELETE | `/api/users/:id/block` | Unblock user |

### Admin
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/admin/stats` | Dashboard stats |
| GET | `/api/admin/users` | All users |
| GET | `/api/admin/rooms` | All rooms |
| POST | `/api/admin/users/:id/ban` | Ban user |
| POST | `/api/admin/users/:id/unban` | Unban user |
| DELETE | `/api/admin/rooms/:id` | Delete room |
| DELETE | `/api/admin/messages/:id` | Delete message |

### WebSocket
| Event | Direction | Description |
|-------|-----------|-------------|
| `message` | Both | Send/receive chat messages |
| `typing` / `stop_typing` | Both | Typing indicators |
| `user_joined` / `user_left` | Server→Client | Room presence |
| `messages_seen` | Both | Read receipts |
| `reaction` | Server→Client | Emoji reaction broadcast |
| `voice_join` / `voice_leave` | Both | Voice call signaling |
| `voice_offer` / `voice_answer` | Both | WebRTC SDP exchange |
| `voice_ice_candidate` | Both | ICE candidate relay |
| `voice_state` | Server→Client | Voice participant state |
| `room_added` / `room_deleted` | Server→Client | Room lifecycle |
| `incoming_friend_request` | Server→Client | New friend request |
| `friend_request_accepted` | Server→Client | Request accepted |
| `friend_removed` | Server→Client | Friend removed |

## Deployment

Deploy the backend as a **Node.js Web Service** on [Render](https://render.com):
- **Build command:** `npm install`
- **Start command:** `node index.js`
- **Root directory:** `backend`
- Set `DATABASE_URL`, `JWT_SECRET`, and `CORS_ORIGINS` as environment variables

Deploy the frontend as a **Static Site** on Render (or Vercel/Netlify):
- **Build command:** `npm install && npm run build`
- **Publish directory:** `dist`
- **Root directory:** `frontend`

## License

MIT
