import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  X, Users, Star, StarOff, UserPlus, UserMinus, Search, Check, XIcon, Bell, Clock, UserCheck, MessageCircle, Ban, MoreVertical,
} from 'lucide-react';
import { useChatStore } from '../stores/chatStore';
import { useFriendStore } from '../stores/friendStore';
import { useAuthStore } from '../stores/authStore';
import { api } from '../lib/api';
import { formatDate } from '../lib/utils';
import type { BlockedUser, User } from '../types';

interface RightPanelProps {
  type: 'members' | 'friends';
  onClose: () => void;
  ws: { sendMessage: (roomId: string, content: string) => void };
}

export default function RightPanel({ type, onClose, ws }: RightPanelProps) {
  return (
    <motion.div
      initial={{ x: 50, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 50, opacity: 0 }}
      className="fixed right-0 top-0 z-50 h-[100dvh] w-screen max-w-[92vw] glass border-l border-white/10 flex flex-col sm:max-w-80 lg:static lg:z-auto lg:w-80"
    >
      <div className="p-4 border-b border-white/10 flex items-center justify-between">
        <h3 className="font-semibold">{type === 'members' ? 'Chat Participants' : 'Friends'}</h3>
        <button onClick={onClose} className="p-1 hover:bg-white/10 rounded-lg">
          <X className="w-5 h-5" />
        </button>
      </div>
      {type === 'members' ? <MembersPanel /> : <FriendsPanel />}
    </motion.div>
  );
}

function MembersPanel() {
  const { currentRoom, activeRoomUsers } = useChatStore();

  if (!currentRoom) return null;

  const online = currentRoom.members.filter((m) => activeRoomUsers.includes(m.user_id));
  const offline = currentRoom.members.filter((m) => !activeRoomUsers.includes(m.user_id));

  return (
    <div className="flex-1 overflow-y-auto p-3 space-y-4">
      {online.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase opacity-40 mb-2 px-2">
            Online — {online.length}
          </p>
          {online.map((m) => (
            <div key={m.user_id} className="flex items-center gap-3 p-2 rounded-xl hover:bg-white/5">
              <div className="relative">
                <img
                  src={m.avatar_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${m.username}`}
                  alt={m.username}
                  className="w-9 h-9 rounded-full"
                />
                <div className="absolute -bottom-0.5 -right-0.5 online-dot w-2.5 h-2.5" />
              </div>
              <div>
                <p className="text-sm font-medium">{m.username}</p>
                <p className="text-xs opacity-40">{m.role}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {offline.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase opacity-40 mb-2 px-2">
            Offline — {offline.length}
          </p>
          {offline.map((m) => (
            <div key={m.user_id} className="flex items-center gap-3 p-2 rounded-xl hover:bg-white/5 opacity-50">
              <img
                src={m.avatar_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${m.username}`}
                alt={m.username}
                className="w-9 h-9 rounded-full"
              />
              <div>
                <p className="text-sm font-medium">{m.username}</p>
                <p className="text-xs opacity-40">{m.role}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function FriendsPanel() {
  const [tab, setTab] = useState<'friends' | 'requests' | 'search'>('friends');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<User[]>([]);
  const [searching, setSearching] = useState(false);
  const [blockedUsers, setBlockedUsers] = useState<BlockedUser[]>([]);
  const [suggestions, setSuggestions] = useState<User[]>([]);
  const { friends, requests, sentRequests, toggleFavorite, removeFriend, acceptRequest, rejectRequest, sendRequest } = useFriendStore();
  const createRoom = useChatStore((s) => s.createRoom);
  const setCurrentRoom = useChatStore((s) => s.setCurrentRoom);

  useEffect(() => {
    let cancelled = false;

    async function loadBlockedUsers() {
      try {
        const [rows, suggestionRows] = await Promise.all([
          api.listBlockedUsers() as Promise<BlockedUser[]>,
          api.getFriendSuggestions() as Promise<User[]>,
        ]);
        if (!cancelled) {
          setBlockedUsers(rows);
          setSuggestions(suggestionRows);
        }
      } catch {
        if (!cancelled) {
          setBlockedUsers([]);
          setSuggestions([]);
        }
      }
    }

    void loadBlockedUsers();

    return () => {
      cancelled = true;
    };
  }, []);

  const handleStartDm = async (friendId: string) => {
    try {
      const room = await createRoom(`DM-${friendId}`, 'dm', [friendId]);
      setCurrentRoom(room);
    } catch {
      // Direct chat creation failed silently
    }
  };

  const handleSearch = async () => {
    if (searchQuery.length < 2) return;
    setSearching(true);
    try {
      const results = await api.searchUsers(searchQuery) as User[];
      setSearchResults(results);
    } catch {
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  };

  const handleBlockUser = async (userId: string) => {
    try {
      await api.blockUser(userId);
      const [blocked, suggestionRows] = await Promise.all([
        api.listBlockedUsers() as Promise<BlockedUser[]>,
        api.getFriendSuggestions() as Promise<User[]>,
      ]);
      setBlockedUsers(blocked);
      setSuggestions(suggestionRows);
      setSearchResults((current) => current.filter((userRow) => userRow.id !== userId));
      useFriendStore.setState((state) => ({
        friends: state.friends.filter((friend) => friend.user_id !== userId),
        requests: state.requests.filter((request) => request.from_user_id !== userId),
        sentRequests: state.sentRequests.filter((request) => request.to_user_id !== userId),
      }));
    } catch {
      // Block action failed silently in side panel
    }
  };

  const handleUnblockUser = async (userId: string) => {
    try {
      await api.unblockUser(userId);
      setBlockedUsers((current) => current.filter((userRow) => userRow.user_id !== userId));
      setSuggestions(await api.getFriendSuggestions() as User[]);
    } catch {
      // Unblock action failed silently in side panel
    }
  };

  const favorites = friends.filter((f) => f.is_favorite);
  const regular = friends.filter((f) => !f.is_favorite);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Tabs */}
      <div className="flex p-2 gap-1 border-b border-white/10">
        {(['friends', 'requests', 'search'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-2 text-xs font-medium rounded-lg transition-colors ${
              tab === t ? 'bg-primary-500/20 text-primary-400' : 'hover:bg-white/5 opacity-60'
            }`}
          >
            {t === 'friends' ? 'Friends' : t === 'requests' ? `Requests (${requests.length + sentRequests.length})` : 'Search'}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {tab === 'friends' && (
          <>
            {favorites.length > 0 && (
              <div>
                <p className="text-xs font-semibold uppercase opacity-40 mb-2 px-2">Favorites</p>
                {favorites.map((f) => (
                  <FriendItem key={f.user_id} friend={f} onToggleFav={toggleFavorite} onRemove={removeFriend} onStartDm={handleStartDm} onBlock={handleBlockUser} />
                ))}
              </div>
            )}
            <div>
              {regular.length > 0 && (
                <p className="text-xs font-semibold uppercase opacity-40 mb-2 px-2">All Friends</p>
              )}
              {regular.map((f) => (
                <FriendItem key={f.user_id} friend={f} onToggleFav={toggleFavorite} onRemove={removeFriend} onStartDm={handleStartDm} onBlock={handleBlockUser} />
              ))}
            </div>
            {friends.length === 0 && (
              <p className="text-center text-sm opacity-40 py-8">No friends yet. Search for users to add!</p>
            )}
          </>
        )}

        {tab === 'requests' && (
          <>
            {requests.length > 0 && (
              <div>
                <p className="text-xs font-semibold uppercase opacity-40 mb-2 px-2">
                  Incoming — {requests.length}
                </p>
                {requests.map((r) => (
                  <div key={r.id} className="flex items-center gap-3 p-2 rounded-xl glass">
                    <img
                      src={r.from_avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${r.from_username}`}
                      alt={r.from_username}
                      className="w-9 h-9 rounded-full"
                    />
                    <div className="flex-1">
                      <p className="text-sm font-medium">{r.from_username}</p>
                      <p className="text-xs opacity-40">{formatDate(r.created_at)}</p>
                    </div>
                    <button onClick={() => acceptRequest(r.id)} className="p-1.5 hover:bg-green-500/20 rounded-lg text-green-400">
                      <Check className="w-4 h-4" />
                    </button>
                    <button onClick={() => rejectRequest(r.id)} className="p-1.5 hover:bg-red-500/20 rounded-lg text-red-400">
                      <XIcon className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {sentRequests.length > 0 && (
              <div>
                <p className="text-xs font-semibold uppercase opacity-40 mb-2 px-2">
                  Sent — {sentRequests.length}
                </p>
                {sentRequests.map((r) => (
                  <div key={r.id} className="flex items-center gap-3 p-2 rounded-xl glass opacity-70">
                    <img
                      src={r.to_avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${r.to_username}`}
                      alt={r.to_username}
                      className="w-9 h-9 rounded-full"
                    />
                    <div className="flex-1">
                      <p className="text-sm font-medium">{r.to_username}</p>
                      <p className="text-xs opacity-40">{formatDate(r.created_at)}</p>
                    </div>
                    <span className="flex items-center gap-1 text-xs text-yellow-400">
                      <Clock className="w-3.5 h-3.5" /> Pending
                    </span>
                  </div>
                ))}
              </div>
            )}

            {requests.length === 0 && sentRequests.length === 0 && (
              <p className="text-center text-sm opacity-40 py-8">No pending requests</p>
            )}
          </>
        )}

        {tab === 'search' && (
          <>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 opacity-40" />
                <input
                  type="text"
                  placeholder="Search users..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                  className="glass-input !pl-10 py-2 text-sm"
                />
              </div>
              <button onClick={handleSearch} className="glass-button py-2 px-3 text-sm">
                Go
              </button>
            </div>
            {searchQuery.trim().length < 2 && suggestions.length > 0 && (
              <div>
                <p className="text-xs font-semibold uppercase opacity-40 mb-2 px-2">Suggestions</p>
                {suggestions.map((u) => (
                  <div key={u.id} className="flex items-center gap-3 p-2 rounded-xl hover:bg-white/5">
                    <img
                      src={u.avatar_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${u.username}`}
                      alt={u.username}
                      className="w-9 h-9 rounded-full"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{u.username}</p>
                      <p className="text-xs opacity-40">Suggested from shared chats or mutual connections</p>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => sendRequest(u.id)}
                        className="p-1.5 hover:bg-primary-500/20 rounded-lg text-primary-400"
                        title="Send friend request"
                      >
                        <UserPlus className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleBlockUser(u.id)}
                        className="p-1.5 hover:bg-red-500/20 rounded-lg text-red-400"
                        title="Block user"
                      >
                        <Ban className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {searchResults.map((u) => {
              const isFriend = friends.some((f) => f.user_id === u.id);
              const hasSentRequest = sentRequests.some((r) => r.to_user_id === u.id);
              const hasIncomingRequest = requests.some((r) => r.from_user_id === u.id);
              const isBlocked = blockedUsers.some((blockedUser) => blockedUser.user_id === u.id);

              return (
                <div key={u.id} className="flex items-center gap-3 p-2 rounded-xl hover:bg-white/5">
                  <img
                    src={u.avatar_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${u.username}`}
                    alt={u.username}
                    className="w-9 h-9 rounded-full"
                  />
                  <div className="flex-1">
                    <p className="text-sm font-medium">{u.username}</p>
                  </div>
                  {isFriend ? (
                    <span className="flex items-center gap-1 text-xs text-green-400">
                      <UserCheck className="w-3.5 h-3.5" /> Friends
                    </span>
                  ) : isBlocked ? (
                    <button
                      onClick={() => handleUnblockUser(u.id)}
                      className="px-2 py-1 text-xs rounded-lg hover:bg-white/10 text-primary-400"
                    >
                      Unblock
                    </button>
                  ) : hasSentRequest ? (
                    <span className="flex items-center gap-1 text-xs text-yellow-400">
                      <Clock className="w-3.5 h-3.5" /> Sent
                    </span>
                  ) : hasIncomingRequest ? (
                    <span className="flex items-center gap-1 text-xs text-blue-400">
                      <Bell className="w-3.5 h-3.5" /> Received
                    </span>
                  ) : (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => sendRequest(u.id)}
                        className="p-1.5 hover:bg-primary-500/20 rounded-lg text-primary-400"
                        title="Send friend request"
                      >
                        <UserPlus className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleBlockUser(u.id)}
                        className="p-1.5 hover:bg-red-500/20 rounded-lg text-red-400"
                        title="Block user"
                      >
                        <Ban className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}

function FriendItem({
  friend,
  onToggleFav,
  onRemove,
  onStartDm,
  onBlock,
}: {
  friend: any;
  onToggleFav: (id: string, fav: boolean) => void;
  onRemove: (id: string) => void;
  onStartDm: (id: string) => void;
  onBlock: (id: string) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent | TouchEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('touchstart', handler);
    return () => { document.removeEventListener('mousedown', handler); document.removeEventListener('touchstart', handler); };
  }, [menuOpen]);

  return (
    <div className="flex items-center gap-3 p-2 rounded-xl hover:bg-white/5 group">
      <div className="relative">
        <img
          src={friend.avatar_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${friend.username}`}
          alt={friend.username}
          className="w-9 h-9 rounded-full"
        />
        {friend.status === 'online' && (
          <div className="absolute -bottom-0.5 -right-0.5 online-dot w-2.5 h-2.5" />
        )}
      </div>
      <div
        className="flex-1 min-w-0 cursor-pointer"
        onClick={() => onStartDm(friend.user_id)}
        title="Start a chat"
      >
        <p className="text-sm font-medium truncate">{friend.username}</p>
        <p className="text-xs opacity-40">
          {friend.status === 'online' ? 'Online' : `Last seen ${formatDate(friend.last_seen)}`}
        </p>
      </div>

      {/* Desktop: inline hover-reveal buttons */}
      <div className="hidden lg:flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={() => onStartDm(friend.user_id)}
          className="p-1 hover:bg-primary-500/20 rounded-lg text-primary-400"
          title="Message"
        >
          <MessageCircle className="w-4 h-4" />
        </button>
        <button
          onClick={() => onToggleFav(friend.user_id, !friend.is_favorite)}
          className="p-1 hover:bg-yellow-500/20 rounded-lg"
        >
          {friend.is_favorite ? (
            <Star className="w-4 h-4 text-yellow-500 fill-yellow-500" />
          ) : (
            <StarOff className="w-4 h-4 opacity-40" />
          )}
        </button>
        <button
          onClick={() => onRemove(friend.user_id)}
          className="p-1 hover:bg-red-500/20 rounded-lg text-red-400"
        >
          <UserMinus className="w-4 h-4" />
        </button>
        <button
          onClick={() => onBlock(friend.user_id)}
          className="p-1 hover:bg-red-500/20 rounded-lg text-red-400"
          title="Block user"
        >
          <Ban className="w-4 h-4" />
        </button>
      </div>

      {/* Mobile: three-dot menu */}
      <div className="relative lg:hidden" ref={menuRef}>
        <button
          onClick={() => setMenuOpen(!menuOpen)}
          className="p-1.5 hover:bg-white/10 rounded-lg"
        >
          <MoreVertical className="w-4 h-4 opacity-60" />
        </button>
        {menuOpen && (
          <div className="absolute right-0 top-full mt-1 w-40 py-1 glass rounded-xl border border-white/10 shadow-xl z-50">
            <button
              onClick={() => { onStartDm(friend.user_id); setMenuOpen(false); }}
              className="flex items-center gap-2 w-full px-3 py-2 text-sm hover:bg-white/10 text-primary-400"
            >
              <MessageCircle className="w-4 h-4" /> Message
            </button>
            <button
              onClick={() => { onToggleFav(friend.user_id, !friend.is_favorite); setMenuOpen(false); }}
              className="flex items-center gap-2 w-full px-3 py-2 text-sm hover:bg-white/10"
            >
              {friend.is_favorite ? (
                <><Star className="w-4 h-4 text-yellow-500 fill-yellow-500" /> Unfavorite</>
              ) : (
                <><StarOff className="w-4 h-4 opacity-60" /> Favorite</>
              )}
            </button>
            <button
              onClick={() => { onRemove(friend.user_id); setMenuOpen(false); }}
              className="flex items-center gap-2 w-full px-3 py-2 text-sm hover:bg-white/10 text-red-400"
            >
              <UserMinus className="w-4 h-4" /> Remove
            </button>
            <button
              onClick={() => { onBlock(friend.user_id); setMenuOpen(false); }}
              className="flex items-center gap-2 w-full px-3 py-2 text-sm hover:bg-white/10 text-red-400"
            >
              <Ban className="w-4 h-4" /> Block
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
