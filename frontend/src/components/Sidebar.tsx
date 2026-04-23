import { motion } from 'framer-motion';
import {
  MessageCircle, Plus, Settings, Users, LogOut, Hash, Lock, User, Crown, ChevronRight, Compass,
} from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { useChatStore } from '../stores/chatStore';
import { useFriendStore } from '../stores/friendStore';
import type { Room } from '../types';
import { getRoomAvatar, isRoomMember, getConversationDisplayName, getConversationTypeLabel, getParticipantLabel } from '../lib/utils';

interface SidebarProps {
  onCreateRoom: () => void;
  onOpenSettings: () => void;
  onSelectRoom: (room: Room) => void;
  onToggleFriends: () => void;
  onJoinPublicRoom: (room: Room) => void;
  onExploreRooms: () => void;
}

export default function Sidebar({ onCreateRoom, onOpenSettings, onSelectRoom, onToggleFriends, onJoinPublicRoom, onExploreRooms }: SidebarProps) {
  const user = useAuthStore((s) => s.user)!;
  const logout = useAuthStore((s) => s.logout);
  const { rooms, currentRoom, unreadRooms, roomsLoading } = useChatStore();
  const { requests } = useFriendStore();

  const getRoomIcon = (type: string) => {
    switch (type) {
      case 'public': return <Hash className="w-4 h-4" />;
      case 'private': return <Lock className="w-4 h-4" />;
      case 'dm': return <User className="w-4 h-4" />;
      default: return <Hash className="w-4 h-4" />;
    }
  };

  return (
    <div className="h-[100dvh] w-screen lg:w-72 glass flex flex-col border-r border-white/10">
      {/* Header — frosted glass */}
      <div className="glass-header p-4 border-b border-white/10 sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary-500 flex items-center justify-center">
            <MessageCircle className="w-6 h-6 text-white" />
          </div>
          <h1 className="text-xl font-bold bg-gradient-to-r from-primary-400 to-accent-400 bg-clip-text text-transparent flex-1">
            ChatSphere
          </h1>
          {/* Mobile: user avatar in header */}
          <button onClick={onOpenSettings} className="lg:hidden relative">
            <img
              src={user.avatar_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${user.username}`}
              alt={user.username}
              className="w-9 h-9 rounded-full border border-white/20"
            />
            <div className="absolute -bottom-0.5 -right-0.5 online-dot w-2.5 h-2.5" />
          </button>
        </div>
      </div>

      {/* User info — hidden on mobile, shown on desktop */}
      <div className="hidden lg:block p-4 border-b border-white/10">
        <div className="flex items-center gap-3">
          <div className="relative">
            <img
              src={user.avatar_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${user.username}`}
              alt={user.username}
              className="w-10 h-10 rounded-full"
            />
            <div className="absolute -bottom-0.5 -right-0.5 online-dot w-3 h-3" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-medium truncate">{user.username}</p>
            <p className="text-xs opacity-50 flex items-center gap-1">
              {user.is_admin && <Crown className="w-3 h-3 text-yellow-500" />}
              Online
            </p>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="p-3 flex gap-2">
        <button onClick={onCreateRoom} className="flex-1 glass-button-secondary text-sm flex items-center justify-center gap-2 py-2">
          <Plus className="w-4 h-4" /> New Chat
        </button>
        <button onClick={onExploreRooms} className="glass-button-secondary px-3 py-2" title="Explore public chats">
          <Compass className="w-4 h-4" />
        </button>
        <button onClick={onToggleFriends} className="relative glass-button-secondary px-3 py-2">
          <Users className="w-4 h-4" />
          {requests.length > 0 && (
            <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 rounded-full text-xs flex items-center justify-center text-white">
              {requests.length}
            </span>
          )}
        </button>
      </div>

      {/* Chat list */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {roomsLoading && rooms.length === 0 && (
          <div className="space-y-2">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="flex items-center gap-3 p-3 rounded-xl animate-pulse">
                <div className="w-10 h-10 rounded-2xl bg-white/10" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 bg-white/10 rounded w-2/3" />
                  <div className="h-2 bg-white/10 rounded w-1/3" />
                </div>
              </div>
            ))}
          </div>
        )}
        {rooms.map((room) => (
          <motion.button
            key={room.id}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => {
              if (room.type === 'public' && !isRoomMember(room, user.id)) {
                onJoinPublicRoom(room);
                return;
              }
              onSelectRoom(room);
            }}
            className={`w-full flex items-center gap-3 p-3 rounded-xl transition-all duration-200 text-left tap-highlight ${
              currentRoom?.id === room.id
                ? 'bg-primary-500/20 border border-primary-500/30'
                : 'hover:bg-white/5'
            }`}
          >
            <img
              src={getRoomAvatar(`${room.type}-${room.name}`, room.type)}
              alt={room.name}
              className="w-10 h-10 rounded-2xl border border-white/10 bg-white/10"
            />
            <div className="flex-1 min-w-0">
              <p className="font-medium truncate text-sm">{getConversationDisplayName(room, user.id)}</p>
              <p className="text-xs opacity-40 flex items-center gap-1.5 flex-wrap">
                <span>{getRoomIcon(room.type)}</span>
                <span>{getConversationTypeLabel(room.type)}</span>
                <span>{getParticipantLabel(room)}</span>
                {room.type === 'public' && !isRoomMember(room, user.id) && (
                  <span className="text-primary-300">Join chat</span>
                )}
                {currentRoom?.id === room.id && <span className="text-primary-300">In chat</span>}
              </p>
            </div>
            {unreadRooms[room.id] && currentRoom?.id !== room.id && (
              <span className="w-2.5 h-2.5 rounded-full bg-red-500 shadow-[0_0_12px_rgba(239,68,68,0.7)]" />
            )}
            {currentRoom?.id === room.id && <ChevronRight className="w-4 h-4 opacity-50" />}
          </motion.button>
        ))}

        {rooms.length === 0 && !roomsLoading && (
          <div className="text-center py-8 opacity-40">
            <MessageCircle className="w-8 h-8 mx-auto mb-2" />
            <p className="text-sm">No chats yet</p>
            <p className="text-xs">Start or join a chat to begin talking</p>
          </div>
        )}
      </div>

      {/* Bottom actions — safe area */}
      <div className="p-3 border-t border-white/10 flex gap-2" style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
        {user.is_admin && (
          <a href="/admin" className="glass-button-secondary px-3 py-2 text-sm flex items-center gap-2">
            <Crown className="w-4 h-4 text-yellow-500" /> Admin
          </a>
        )}
        <button onClick={onOpenSettings} className="glass-button-secondary px-3 py-2">
          <Settings className="w-4 h-4" />
        </button>
        <button onClick={logout} className="glass-button-secondary px-3 py-2 ml-auto text-red-400 hover:text-red-300">
          <LogOut className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
