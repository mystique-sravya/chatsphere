import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Search, Users, Hash, UserPlus, Check } from 'lucide-react';
import { api } from '../lib/api';
import { useChatStore } from '../stores/chatStore';
import type { Room } from '../types';
import { getRoomAvatar } from '../lib/utils';

interface ExploreRoomsModalProps {
  onClose: () => void;
}

export default function ExploreRoomsModal({ onClose }: ExploreRoomsModalProps) {
  const [search, setSearch] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [rooms, setRooms] = useState<(Room & { is_member?: boolean })[]>([]);
  const [loading, setLoading] = useState(true);
  const [joiningId, setJoiningId] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState('');
  const [inviteRoom, setInviteRoom] = useState<(Room & { is_member?: boolean }) | null>(null);
  const { joinRoom, setCurrentRoom, loadRooms } = useChatStore();

  useEffect(() => {
    loadExploreRooms();
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      loadExploreRooms();
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const loadExploreRooms = async () => {
    try {
      setLoading(true);
      const data = await api.exploreRooms(search) as (Room & { is_member?: boolean })[];
      setRooms(data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  const handleJoin = async (room: Room & { is_member?: boolean }) => {
    try {
      setJoiningId(room.id);
      const joined = await joinRoom(room.id);
      setCurrentRoom(joined);
      onClose();
    } catch {
      // ignore
    } finally {
      setJoiningId(null);
    }
  };

  const handleInviteCodeLookup = async () => {
    const code = inviteCode.trim();
    if (!code) return;
    setInviteError('');
    setInviteRoom(null);
    try {
      const room = await api.getRoomByInvite(code) as Room & { is_member?: boolean };
      setInviteRoom(room);
    } catch (err: unknown) {
      setInviteError(err instanceof Error ? err.message : 'Invalid invite code');
    }
  };

  const handleJoinByInvite = async () => {
    if (!inviteRoom) return;
    try {
      setJoiningId(inviteRoom.id);
      const room = await api.joinByInvite(inviteCode.trim()) as Room;
      await loadRooms();
      setCurrentRoom(room);
      onClose();
    } catch (err: unknown) {
      setInviteError(err instanceof Error ? err.message : 'Failed to join');
    } finally {
      setJoiningId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="relative glass-card p-6 w-full max-w-lg max-h-[80vh] flex flex-col"
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold">Explore Public Chats</h2>
          <button onClick={onClose} className="p-1 hover:bg-white/10 rounded-lg">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Invite Code Section */}
        <div className="mb-4">
          <label className="text-xs font-medium opacity-60 mb-1 block">Join by Invite Code</label>
          <div className="flex gap-2">
            <input
              value={inviteCode}
              onChange={(e) => { setInviteCode(e.target.value); setInviteError(''); setInviteRoom(null); }}
              placeholder="Paste invite code..."
              className="glass-input flex-1 text-sm"
              onKeyDown={(e) => e.key === 'Enter' && handleInviteCodeLookup()}
            />
            <button
              onClick={handleInviteCodeLookup}
              disabled={!inviteCode.trim()}
              className="glass-button px-4 py-2 text-sm disabled:opacity-30"
            >
              Lookup
            </button>
          </div>
          {inviteError && <p className="text-red-400 text-xs mt-1">{inviteError}</p>}
          {inviteRoom && (
            <div className="mt-2 p-3 rounded-xl bg-white/5 flex items-center gap-3">
              <img
                src={getRoomAvatar(`${inviteRoom.type}-${inviteRoom.name}`, inviteRoom.type)}
                alt={inviteRoom.name}
                className="w-10 h-10 rounded-2xl border border-white/10 bg-white/10"
              />
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate text-sm">{inviteRoom.name}</p>
                <p className="text-xs opacity-50">{inviteRoom.type === 'private' ? 'private chat' : 'public chat'} &middot; {inviteRoom.member_count} members</p>
              </div>
              {inviteRoom.is_member ? (
                <span className="text-xs text-green-400 flex items-center gap-1"><Check className="w-3 h-3" /> Joined</span>
              ) : (
                <button
                  onClick={handleJoinByInvite}
                  disabled={joiningId === inviteRoom.id}
                  className="glass-button px-3 py-1.5 text-sm"
                >
                  {joiningId === inviteRoom.id ? 'Joining...' : 'Join'}
                </button>
              )}
            </div>
          )}
        </div>

        <hr className="border-white/10 mb-4" />

        {/* Search Public Chats */}
        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 opacity-40" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search public chats..."
            className="glass-input w-full !pl-10 text-sm"
          />
        </div>

        {/* Chat List */}
        <div className="flex-1 overflow-y-auto space-y-2 min-h-0">
          {loading ? (
            <div className="text-center py-8 opacity-40">
              <p className="text-sm">Loading rooms...</p>
            </div>
          ) : rooms.length === 0 ? (
            <div className="text-center py-8 opacity-40">
              <Hash className="w-8 h-8 mx-auto mb-2" />
              <p className="text-sm">No public chats found</p>
              {search && <p className="text-xs mt-1">Try a different search term</p>}
            </div>
          ) : (
            <AnimatePresence>
              {rooms.map((room) => (
                <motion.div
                  key={room.id}
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex items-center gap-3 p-3 rounded-xl bg-white/5 hover:bg-white/10 transition-colors"
                >
                  <img
                    src={getRoomAvatar(`${room.type}-${room.name}`, room.type)}
                    alt={room.name}
                    className="w-10 h-10 rounded-2xl border border-white/10 bg-white/10"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate text-sm">{room.name}</p>
                    <p className="text-xs opacity-50 flex items-center gap-1">
                      <Users className="w-3 h-3" /> {room.member_count} members
                    </p>
                  </div>
                  {room.is_member ? (
                    <span className="text-xs text-green-400 flex items-center gap-1">
                      <Check className="w-3 h-3" /> Joined
                    </span>
                  ) : (
                    <button
                      onClick={() => handleJoin(room)}
                      disabled={joiningId === room.id}
                      className="glass-button px-3 py-1.5 text-sm flex items-center gap-1"
                    >
                      <UserPlus className="w-3.5 h-3.5" />
                      {joiningId === room.id ? 'Joining...' : 'Join'}
                    </button>
                  )}
                </motion.div>
              ))}
            </AnimatePresence>
          )}
        </div>
      </motion.div>
    </div>
  );
}
