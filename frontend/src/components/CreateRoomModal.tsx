import { useState } from 'react';
import { motion } from 'framer-motion';
import { X, Hash, Lock, User } from 'lucide-react';
import { useChatStore } from '../stores/chatStore';
import { useFriendStore } from '../stores/friendStore';
import { getRoomAvatar } from '../lib/utils';

interface CreateRoomModalProps {
  onClose: () => void;
  ws: { joinRoom: (roomId: string, username: string) => void };
}

export default function CreateRoomModal({ onClose, ws }: CreateRoomModalProps) {
  const [name, setName] = useState('');
  const [type, setType] = useState<'public' | 'private' | 'dm'>('public');
  const [selectedFriends, setSelectedFriends] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const createRoom = useChatStore((s) => s.createRoom);
  const setCurrentRoom = useChatStore((s) => s.setCurrentRoom);
  const friends = useFriendStore((s) => s.friends);

  const toggleFriend = (id: string) => {
    setSelectedFriends((prev) =>
      prev.includes(id) ? prev.filter((f) => f !== id) : [...prev, id]
    );
  };

  const handleCreate = async () => {
    // Direct chats don't need a name — auto-generate from selected friend
    const roomName = type === 'dm'
      ? `DM-${selectedFriends[0] || 'chat'}`
      : name.trim();
    if (type !== 'dm' && !roomName) return;
    if (type === 'dm' && selectedFriends.length !== 1) return;
    setLoading(true);
    try {
      const room = await createRoom(roomName, type, selectedFriends);
      setCurrentRoom(room);
      onClose();
    } catch {
      // Handle error silently
    } finally {
      setLoading(false);
    }
  };

  const roomTypes = [
    { value: 'public' as const, icon: Hash, label: 'Public Chat', desc: 'Anyone can join' },
    { value: 'private' as const, icon: Lock, label: 'Private Chat', desc: 'Invite only' },
    { value: 'dm' as const, icon: User, label: 'Direct Chat', desc: 'One-to-one conversation' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="relative glass-card p-6 w-full max-w-md"
      >
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold">Start a Chat</h2>
          <button onClick={onClose} className="p-1 hover:bg-white/10 rounded-lg">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-4">
          {/* Chat type */}
          <div className="grid grid-cols-2 gap-2">
            {roomTypes.map(({ value, icon: Icon, label, desc }) => (
              <button
                key={value}
                onClick={() => setType(value)}
                className={`p-3 rounded-xl text-left transition-all ${
                  type === value
                    ? 'bg-primary-500/20 border border-primary-500/30'
                    : 'glass hover:bg-white/10'
                }`}
              >
                <Icon className="w-5 h-5 mb-1" />
                <p className="text-sm font-medium">{label}</p>
                <p className="text-xs opacity-40">{desc}</p>
              </button>
            ))}
          </div>

          {/* Chat name — not needed for direct chats */}
          {type !== 'dm' && (
            <>
              <input
                type="text"
                placeholder="Chat name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="glass-input"
                maxLength={100}
              />

              {name.trim() && (
                <div className="glass rounded-xl p-3 flex items-center gap-3">
                  <img
                    src={getRoomAvatar(`${type}-${name.trim()}`, type)}
                    alt="Room icon preview"
                    className="w-12 h-12 rounded-2xl border border-white/10 bg-white/10"
                  />
                  <div>
                    <p className="text-sm font-medium">Chat icon preview</p>
                    <p className="text-xs opacity-50">A default icon is generated automatically for each chat.</p>
                  </div>
                </div>
              )}
            </>
          )}

          {type === 'dm' && (
            <p className="text-xs opacity-50 px-1">Select a friend below to start a direct message.</p>
          )}

          {/* Invite friends (for non-public chats) */}
          {type !== 'public' && friends.length > 0 && (
            <div>
              <p className="text-sm font-medium opacity-60 mb-2">
                {type === 'dm' ? 'Choose a Friend' : 'Invite Friends'}
              </p>
              <div className="max-h-40 overflow-y-auto space-y-1">
                {friends.map((f) => (
                  <button
                    key={f.user_id}
                    onClick={() => {
                      if (type === 'dm') {
                        setSelectedFriends([f.user_id]);
                      } else {
                        toggleFriend(f.user_id);
                      }
                    }}
                    className={`w-full flex items-center gap-3 p-2 rounded-xl transition-colors ${
                      selectedFriends.includes(f.user_id) ? 'bg-primary-500/20' : 'hover:bg-white/5'
                    }`}
                  >
                    <img
                      src={f.avatar_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${f.username}`}
                      alt={f.username}
                      className="w-8 h-8 rounded-full"
                    />
                    <span className="text-sm">{f.username}</span>
                    {selectedFriends.includes(f.user_id) && (
                      <span className="ml-auto text-primary-400 text-xs">Selected</span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}

          <button
            onClick={handleCreate}
            disabled={
              loading ||
              (type === 'dm' ? selectedFriends.length !== 1 : !name.trim())
            }
            className="glass-button w-full disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Creating...' : type === 'dm' ? 'Start Chat' : 'Create Chat'}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
