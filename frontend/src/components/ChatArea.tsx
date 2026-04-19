import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Send, Menu, Users, Trash2, DoorOpen, MoreVertical, Check, CheckCheck, Link2, Timer,
  Reply, Smile, X, Search, Phone, PhoneOff, Mic, MicOff,
} from 'lucide-react';
import EmojiPicker, { EmojiClickData, Theme } from 'emoji-picker-react';
import { useAuthStore } from '../stores/authStore';
import { useChatStore } from '../stores/chatStore';
import { api } from '../lib/api';
import { formatTime, getRoomAvatar, getConversationDisplayName, getParticipantLabel } from '../lib/utils';
import type { Message } from '../types';
import { useDmVoiceCall } from '../hooks/useDmVoiceCall';

const QUICK_REACTIONS = ['❤️', '😂', '👍', '🔥', '😮'] as const;

interface ChatAreaProps {
  ws: {
    sendMessage: (roomId: string, content: string, replyToId?: string) => void;
    sendTyping: (roomId: string, username: string) => void;
    sendStopTyping: (roomId: string) => void;
    markSeen: (roomId: string, messageIds: string[]) => void;
    joinVoiceCall: (roomId: string) => void;
    leaveVoiceCall: (roomId: string) => void;
    setVoiceMute: (roomId: string, muted: boolean) => void;
    sendVoiceOffer: (roomId: string, targetUserId: string, sdp: RTCSessionDescriptionInit) => void;
    sendVoiceAnswer: (roomId: string, targetUserId: string, sdp: RTCSessionDescriptionInit) => void;
    sendVoiceIceCandidate: (roomId: string, targetUserId: string, candidate: RTCIceCandidateInit) => void;
  };
  onMenuClick: () => void;
  onToggleMembers: () => void;
}

export default function ChatArea({ ws, onMenuClick, onToggleMembers }: ChatAreaProps) {
  const [input, setInput] = useState('');
  const [showMenu, setShowMenu] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [messageSearch, setMessageSearch] = useState('');
  const [searchedMessages, setSearchedMessages] = useState<Message[]>([]);
  const [searchingMessages, setSearchingMessages] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [reactionPickerMsgId, setReactionPickerMsgId] = useState<string | null>(null);
  const [hoveredMsgId, setHoveredMsgId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const emojiPickerRef = useRef<HTMLDivElement>(null);
  const reactionPickerRef = useRef<HTMLDivElement>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const user = useAuthStore((s) => s.user)!;
  const { currentRoom, messages, typingUsers, activeRoomUsers, loadMessages, leaveRoom, deleteRoom } = useChatStore();
  const voiceCall = useDmVoiceCall(currentRoom, user.id, ws);

  useEffect(() => {
    if (currentRoom) {
      loadMessages(currentRoom.id);
      setMessageSearch('');
      setSearchedMessages([]);
      setShowSearch(false);
    }
  }, [currentRoom?.id, loadMessages]);

  useEffect(() => {
    if (!currentRoom) {
      return;
    }

    const term = messageSearch.trim();
    if (term.length < 2) {
      setSearchedMessages([]);
      setSearchingMessages(false);
      return;
    }

    const timeoutId = setTimeout(async () => {
      setSearchingMessages(true);
      try {
        const results = await api.searchMessages(currentRoom.id, term) as Message[];
        setSearchedMessages(results);
      } catch {
        setSearchedMessages([]);
      } finally {
        setSearchingMessages(false);
      }
    }, 250);

    return () => clearTimeout(timeoutId);
  }, [currentRoom?.id, messageSearch]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Mark messages as seen
  useEffect(() => {
    if (!currentRoom || messages.length === 0) return;
    const unseenIds = messages
      .filter((m) => m.sender_id !== user.id && m.status !== 'seen')
      .map((m) => m.id);
    if (unseenIds.length > 0) {
      ws.markSeen(currentRoom.id, unseenIds);
    }
  }, [messages, currentRoom?.id]);

  const handleTyping = useCallback(() => {
    if (!currentRoom) return;
    ws.sendTyping(currentRoom.id, user.username);
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      ws.sendStopTyping(currentRoom.id);
    }, 2000);
  }, [currentRoom?.id, user.username, ws]);

  const handleSend = () => {
    if (!input.trim() || !currentRoom) return;
    ws.sendMessage(currentRoom.id, input.trim(), replyingTo?.id);
    ws.sendStopTyping(currentRoom.id);
    setInput('');
    setReplyingTo(null);
    setShowEmojiPicker(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const onEmojiClick = (emojiData: EmojiClickData) => {
    setInput((prev) => prev + emojiData.emoji);
    setShowEmojiPicker(false);
  };

  const handleReaction = async (messageId: string, emoji: string) => {
    setReactionPickerMsgId(null);
    await api.toggleReaction(messageId, emoji);
  };

  // Close pickers on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (emojiPickerRef.current && !emojiPickerRef.current.contains(e.target as Node)) {
        setShowEmojiPicker(false);
      }
      if (reactionPickerRef.current && !reactionPickerRef.current.contains(e.target as Node)) {
        setReactionPickerMsgId(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'seen': return <CheckCheck className="w-4 h-4 text-sky-400" />;
      case 'delivered': return <CheckCheck className="w-4 h-4 text-white/40" />;
      default: return <Check className="w-4 h-4 text-white/40" />;
    }
  };

  if (!currentRoom) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center opacity-40">
          <div className="w-24 h-24 mx-auto mb-4 rounded-3xl bg-primary-500/10 flex items-center justify-center">
            <Send className="w-10 h-10 text-primary-400" />
          </div>
          <h2 className="text-2xl font-semibold mb-2">You are out of chat</h2>
          <p className="text-sm">Choose a chat from the sidebar to jump back in.</p>
        </div>
      </div>
    );
  }

  const typingArray = Array.from(typingUsers.values());
  const showingSearchResults = messageSearch.trim().length >= 2;
  const visibleMessages = showingSearchResults ? searchedMessages : messages;
  const voiceChipClassName = currentRoom.type === 'dm' && (voiceCall.remoteInCall || voiceCall.isInCall)
    ? 'bg-emerald-700/15 text-emerald-900 dark:text-emerald-300 border border-emerald-700/25 dark:border-emerald-500/20'
    : 'bg-slate-500/10 text-slate-700 dark:text-white/60 border border-slate-500/10';
  const voiceBannerClassName = voiceCall.error
    ? 'border-red-500/30 bg-red-500/10 text-red-800 dark:text-red-200'
    : 'border-emerald-700/25 bg-emerald-700/10 text-emerald-950 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-200';

  let voiceBannerText = '';
  if (voiceCall.error) {
    voiceBannerText = voiceCall.error;
  } else if (voiceCall.isInCall && voiceCall.isConnected) {
    voiceBannerText = `${voiceCall.otherParticipantName} is connected. ${voiceCall.remoteMuted ? 'Their mic is muted.' : 'Voice is live.'}`;
  } else if (voiceCall.isInCall && voiceCall.remoteInCall) {
    voiceBannerText = `Connecting to ${voiceCall.otherParticipantName}...`;
  } else if (voiceCall.isInCall) {
    voiceBannerText = 'Calling... waiting for the other person to join.';
  } else if (voiceCall.remoteInCall) {
    voiceBannerText = `${voiceCall.otherParticipantName} is in a call. Join when ready.`;
  }

  const chatMenuItems = (
    <>
      <button
        onClick={() => { setShowSearch(!showSearch); setShowMenu(false); }}
        className="w-full flex items-center gap-2 p-3 rounded-xl hover:bg-white/10 text-sm"
      >
        <Search className="w-4 h-4" /> {showSearch ? 'Hide Search' : 'Search Messages'}
      </button>
      {currentRoom.type !== 'dm' && (
        <button
          onClick={() => { leaveRoom(currentRoom.id); setShowMenu(false); }}
          className="w-full flex items-center gap-2 p-3 rounded-xl hover:bg-white/10 text-sm"
        >
          <DoorOpen className="w-4 h-4" /> Leave Chat
        </button>
      )}
      {currentRoom.invite_code && currentRoom.type !== 'dm' && (
        <button
          onClick={() => {
            navigator.clipboard.writeText(currentRoom.invite_code!);
            setCopiedLink(true);
            setTimeout(() => setCopiedLink(false), 2000);
          }}
          className="w-full flex items-center gap-2 p-3 rounded-xl hover:bg-white/10 text-sm"
        >
          <Link2 className="w-4 h-4" /> {copiedLink ? 'Copied!' : 'Copy Invite Code'}
        </button>
      )}
      {(currentRoom.type === 'dm' || currentRoom.created_by === user.id || user.is_admin) && (
        <button
          onClick={() => { setShowDeleteConfirm(true); setShowMenu(false); }}
          className="w-full flex items-center gap-2 p-3 rounded-xl hover:bg-red-500/20 text-red-400 text-sm"
        >
          <Trash2 className="w-4 h-4" /> {currentRoom.type === 'dm' ? 'Delete Direct Chat' : 'Delete Chat'}
        </button>
      )}
      {currentRoom.type === 'dm' && (
        <button
          onClick={async () => {
            const newHours = currentRoom.message_retention_hours === 24 ? null : 24;
            await api.setRoomRetention(currentRoom.id, newHours);
            useChatStore.getState().loadRooms();
            setShowMenu(false);
          }}
          className="w-full flex items-center gap-2 p-3 rounded-xl hover:bg-white/10 text-sm"
        >
          <Timer className="w-4 h-4" />
          {currentRoom.message_retention_hours === 24 ? 'Keep chat history (7 days)' : 'Auto-delete after 24h'}
        </button>
      )}
    </>
  );

  return (
    <div className="flex-1 flex flex-col h-[100dvh] min-w-0">
      {/* Header */}
      <div className="glass border-b border-white/10 px-4 py-3 flex items-center gap-3">
        <button onClick={onMenuClick} className="lg:hidden p-2 hover:bg-white/10 rounded-xl">
          <Menu className="w-5 h-5" />
        </button>
        <img
          src={getRoomAvatar(`${currentRoom.type}-${currentRoom.name}`, currentRoom.type)}
          alt={currentRoom.name}
          className="w-10 h-10 rounded-2xl border border-white/10 bg-white/10"
        />
        <div className="flex-1 min-w-0">
          <h2 className="font-semibold truncate">{getConversationDisplayName(currentRoom, user.id)}</h2>
          <div className="text-xs opacity-50 flex flex-wrap items-center gap-2">
            <span>{activeRoomUsers.length} active &middot; {getParticipantLabel(currentRoom)}</span>
            {currentRoom.type === 'dm' && (
              <span className={`rounded-full px-2 py-0.5 text-[10px] ${voiceChipClassName}`}>
                {voiceCall.isInCall
                  ? voiceCall.isConnected
                    ? `In call with ${voiceCall.otherParticipantName}`
                    : voiceCall.remoteInCall
                      ? `Connecting to ${voiceCall.otherParticipantName}`
                      : 'Calling...'
                  : voiceCall.remoteInCall
                    ? `${voiceCall.otherParticipantName} is in call`
                    : 'Voice idle'}
              </span>
            )}
          </div>
        </div>
        {currentRoom.type === 'dm' && voiceCall.isSupported && (
          <div className="flex items-center gap-2">
            {voiceCall.isInCall ? (
              <>
                <button
                  onClick={voiceCall.toggleMute}
                  className={`hidden sm:flex items-center gap-2 px-3 py-2 rounded-xl transition-colors ${voiceCall.isMuted ? 'bg-yellow-500/15 text-yellow-300' : 'hover:bg-white/10'}`}
                  title={voiceCall.isMuted ? 'Unmute microphone' : 'Mute microphone'}
                >
                  {voiceCall.isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
                  <span className="text-sm">{voiceCall.isMuted ? 'Unmute' : 'Mute'}</span>
                </button>
                <button
                  onClick={voiceCall.toggleMute}
                  className={`sm:hidden p-2 rounded-xl transition-colors ${voiceCall.isMuted ? 'bg-yellow-500/15 text-yellow-300' : 'hover:bg-white/10'}`}
                  title={voiceCall.isMuted ? 'Unmute microphone' : 'Mute microphone'}
                >
                  {voiceCall.isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
                </button>
                <button
                  onClick={voiceCall.leaveCall}
                  className="hidden sm:flex items-center gap-2 px-3 py-2 rounded-xl bg-red-500/15 text-red-300 hover:bg-red-500/25 transition-colors"
                  title="Leave voice call"
                >
                  <PhoneOff className="w-5 h-5" />
                  <span className="text-sm">Leave</span>
                </button>
                <button
                  onClick={voiceCall.leaveCall}
                  className="sm:hidden p-2 rounded-xl bg-red-500/15 text-red-300 hover:bg-red-500/25 transition-colors"
                  title="Leave voice call"
                >
                  <PhoneOff className="w-5 h-5" />
                </button>
              </>
            ) : (
              <button
                onClick={voiceCall.joinCall}
                disabled={voiceCall.isJoining}
                className="hidden sm:flex items-center gap-2 px-3 py-2 rounded-xl bg-emerald-700/15 text-emerald-900 hover:bg-emerald-700/25 transition-colors disabled:opacity-50 dark:bg-emerald-500/15 dark:text-emerald-300 dark:hover:bg-emerald-500/25"
                title="Join voice call"
              >
                <Phone className="w-5 h-5" />
                <span className="text-sm">{voiceCall.remoteInCall ? 'Join Call' : 'Start Call'}</span>
              </button>
            )}
            {!voiceCall.isInCall && (
              <button
                onClick={voiceCall.joinCall}
                disabled={voiceCall.isJoining}
                className="sm:hidden p-2 rounded-xl bg-emerald-700/15 text-emerald-900 hover:bg-emerald-700/25 transition-colors disabled:opacity-50 dark:bg-emerald-500/15 dark:text-emerald-300 dark:hover:bg-emerald-500/25"
                title="Join voice call"
              >
                <Phone className="w-5 h-5" />
              </button>
            )}
          </div>
        )}
        <button onClick={onToggleMembers} className="p-2 hover:bg-white/10 rounded-xl">
          <Users className="w-5 h-5" />
        </button>
        <div className="relative">
          <button onClick={() => setShowMenu(!showMenu)} className="p-2 hover:bg-white/10 rounded-xl">
            <MoreVertical className="w-5 h-5" />
          </button>
        </div>
      </div>

      {currentRoom.type === 'dm' && (voiceCall.error || voiceCall.isInCall || voiceCall.remoteInCall) && (
        <div className="px-4 py-3 border-b border-white/5">
          <div className={`rounded-2xl border px-3 py-2 text-sm ${voiceBannerClassName}`}>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <span className="font-medium">
                {voiceBannerText}
              </span>
              {!voiceCall.error && !voiceCall.isInCall && voiceCall.remoteInCall && (
                <button
                  onClick={voiceCall.joinCall}
                  disabled={voiceCall.isJoining}
                  className="self-start rounded-xl bg-emerald-700/20 px-3 py-2 text-sm font-medium text-emerald-950 hover:bg-emerald-700/30 disabled:opacity-50 dark:bg-emerald-500/20 dark:text-emerald-100 dark:hover:bg-emerald-500/30"
                >
                  {voiceCall.isJoining ? 'Joining...' : 'Join Call'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {showSearch && (
        <div className="px-4 py-3 border-b border-white/5">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 opacity-40" />
            <input
              type="text"
              value={messageSearch}
              onChange={(e) => setMessageSearch(e.target.value)}
              placeholder="Search messages in this chat"
              className="glass-input !pl-10 pr-10 text-sm"
              autoFocus
            />
            {messageSearch && (
              <button
                onClick={() => setMessageSearch('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 opacity-50 hover:opacity-100"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
          <div className="mt-2 text-xs opacity-40">
            {showingSearchResults
              ? searchingMessages
                ? 'Searching messages...'
                : `${searchedMessages.length} matching message${searchedMessages.length === 1 ? '' : 's'}`
              : 'Type at least 2 characters to search this conversation'}
          </div>
        </div>
      )}

      <AnimatePresence>
        {showMenu && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[90] bg-black/45 backdrop-blur-sm p-4"
            onClick={() => setShowMenu(false)}
          >
            <div className="flex justify-end">
              <motion.div
                initial={{ opacity: 0, y: -12, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -12, scale: 0.96 }}
                transition={{ duration: 0.18 }}
                onClick={(e) => e.stopPropagation()}
                className="mt-16 w-full max-w-xs glass-card p-2 shadow-2xl"
              >
                {chatMenuItems}
              </motion.div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        <AnimatePresence>
          {visibleMessages.map((msg) => {
            const isMine = msg.sender_id === user.id;
            // Group reactions by emoji
            const grouped = (msg.reactions || []).reduce<Record<string, { count: number; users: string[]; userIds: string[] }>>((acc, r) => {
              if (!acc[r.emoji]) acc[r.emoji] = { count: 0, users: [], userIds: [] };
              acc[r.emoji].count++;
              acc[r.emoji].users.push(r.username);
              acc[r.emoji].userIds.push(r.user_id);
              return acc;
            }, {});

            return (
              <motion.div
                key={msg.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className={`flex flex-col ${isMine ? 'items-end' : 'items-start'} group`}
                onMouseEnter={() => setHoveredMsgId(msg.id)}
                onMouseLeave={() => { if (reactionPickerMsgId !== msg.id) setHoveredMsgId(null); }}
              >
                {/* Username OUTSIDE the bubble */}
                {!isMine && (
                  <div className="flex items-center gap-2 mb-0.5 ml-1">
                    <img
                      src={msg.sender_avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${msg.sender_username}`}
                      alt={msg.sender_username}
                      className="w-5 h-5 rounded-full"
                    />
                    <span className="text-xs font-semibold text-primary-400">
                      {msg.sender_username}
                    </span>
                  </div>
                )}


              {showingSearchResults && !searchingMessages && searchedMessages.length === 0 && (
                <div className="text-center text-sm opacity-40 py-6">
                  No messages matched your search.
                </div>
              )}
                {/* Message bubble */}
                <div className="relative max-w-[75%]">
                  <div
                    className={`rounded-2xl px-4 py-2.5 ${
                      isMine
                        ? 'bg-primary-500 text-white rounded-br-md'
                        : 'glass rounded-bl-md'
                    }`}
                  >
                    {/* Reply quote */}
                    {msg.reply_to_id && msg.reply_content && (
                      <div className={`mb-2 px-3 py-1.5 rounded-lg border-l-2 text-xs ${
                        isMine
                          ? 'bg-white/15 border-white/50'
                          : 'bg-white/5 border-primary-400'
                      }`}>
                        <span className="font-semibold opacity-80">{msg.reply_sender_username}</span>
                        <p className="opacity-70 truncate max-w-[200px]">{msg.reply_content}</p>
                      </div>
                    )}

                    {/* Text + time + ticks in one row */}
                    <div className="flex items-end gap-3">
                      <p className="text-sm whitespace-pre-wrap break-words min-w-0">{msg.content}</p>
                      <span className="flex items-center gap-1 shrink-0 translate-y-0.5">
                        <span className="text-[10px] opacity-50 select-none">{formatTime(msg.created_at)}</span>
                        {isMine && getStatusIcon(msg.status)}
                      </span>
                    </div>
                  </div>

                  {/* Reaction bubbles */}
                  {Object.keys(grouped).length > 0 && (
                    <div className={`flex flex-wrap gap-1 mt-1 ${isMine ? 'justify-end' : ''}`}>
                      {Object.entries(grouped).map(([emoji, info]) => (
                        <button
                          key={emoji}
                          onClick={() => handleReaction(msg.id, emoji)}
                          title={info.users.join(', ')}
                          className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[11px] border transition-colors ${
                            info.userIds.includes(user.id)
                              ? 'border-primary-400/50 bg-primary-500/20'
                              : 'border-white/10 bg-white/5 hover:bg-white/10'
                          }`}
                        >
                          <span className="text-xs">{emoji}</span>
                          <span className="opacity-70 text-[10px]">{info.count}</span>
                        </button>
                      ))}
                    </div>
                  )}

                </div>

                {/* Hover actions BELOW the bubble */}
                {hoveredMsgId === msg.id && (
                  <div className={`mt-1 flex flex-col gap-1 ${isMine ? 'items-end' : 'items-start'}`}>
                    <motion.div
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      className={`flex items-center gap-1 ${isMine ? 'flex-row-reverse' : 'flex-row'}`}
                    >
                      <button
                        onClick={() => setReplyingTo(msg)}
                        className="p-1 rounded-md bg-white/5 hover:bg-white/15 border border-white/10 transition-colors"
                        title="Reply"
                      >
                        <Reply className="w-3.5 h-3.5 opacity-70" />
                      </button>

                      <div className="flex items-center gap-1 rounded-full border border-white/10 bg-black/20 px-1.5 py-1 backdrop-blur-md">
                        {QUICK_REACTIONS.map((emoji) => (
                          <button
                            key={emoji}
                            onClick={() => handleReaction(msg.id, emoji)}
                            className="flex h-7 w-7 items-center justify-center rounded-full text-sm transition-transform hover:scale-110 hover:bg-white/10"
                            title={`React with ${emoji}`}
                          >
                            {emoji}
                          </button>
                        ))}
                        <button
                          onClick={() => setReactionPickerMsgId(reactionPickerMsgId === msg.id ? null : msg.id)}
                          className={`flex h-7 w-7 items-center justify-center rounded-full border border-white/10 text-xs font-semibold transition-colors hover:bg-white/10 ${
                            reactionPickerMsgId === msg.id ? 'bg-white/10' : ''
                          }`}
                          title="More reactions"
                        >
                          +
                        </button>
                      </div>
                    </motion.div>

                    {reactionPickerMsgId === msg.id && (
                      <motion.div
                        ref={reactionPickerRef}
                        initial={{ opacity: 0, y: -4, scale: 0.98 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -4, scale: 0.98 }}
                        className={`max-w-[260px] rounded-2xl border border-white/10 bg-slate-900/95 p-2 shadow-2xl backdrop-blur-xl ${
                          isMine ? 'mr-0' : 'ml-0'
                        }`}
                      >
                        <EmojiPicker
                          onEmojiClick={(e) => handleReaction(msg.id, e.emoji)}
                          theme={Theme.DARK}
                          height={320}
                          width={244}
                          searchDisabled
                          previewConfig={{ showPreview: false }}
                          lazyLoadEmojis
                        />
                      </motion.div>
                    )}
                  </div>
                )}
              </motion.div>
            );
          })}
        </AnimatePresence>

        {/* Typing indicator */}
        {typingArray.length > 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex items-center gap-2 text-sm opacity-60"
          >
            <div className="flex gap-1">
              <span className="w-2 h-2 rounded-full bg-primary-400 animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="w-2 h-2 rounded-full bg-primary-400 animate-bounce" style={{ animationDelay: '150ms' }} />
              <span className="w-2 h-2 rounded-full bg-primary-400 animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
            <span>{typingArray.join(', ')} {typingArray.length === 1 ? 'is' : 'are'} typing...</span>
          </motion.div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="p-4 border-t border-white/10">
        {/* Reply preview */}
        {replyingTo && (
          <div className="flex items-center gap-2 mb-2 px-3 py-2 rounded-xl bg-white/5 border border-white/10">
            <Reply className="w-4 h-4 text-primary-400 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-primary-400">{replyingTo.sender_username}</p>
              <p className="text-xs opacity-60 truncate">{replyingTo.content}</p>
            </div>
            <button onClick={() => setReplyingTo(null)} className="p-1 hover:bg-white/10 rounded-lg">
              <X className="w-3.5 h-3.5 opacity-60" />
            </button>
          </div>
        )}

        <div className="flex items-end gap-2 relative">
          {/* Emoji picker for input */}
          <div className="relative" ref={emojiPickerRef}>
            <button
              onClick={() => setShowEmojiPicker(!showEmojiPicker)}
              className="p-3 hover:bg-white/10 rounded-xl transition-colors"
            >
              <Smile className="w-5 h-5 opacity-60" />
            </button>
            {showEmojiPicker && (
              <div className="absolute bottom-full mb-2 left-0 z-50">
                <EmojiPicker
                  onEmojiClick={onEmojiClick}
                  theme={Theme.DARK}
                  height={400}
                  width={320}
                  previewConfig={{ showPreview: false }}
                />
              </div>
            )}
          </div>
          <textarea
            value={input}
            onChange={(e) => { setInput(e.target.value); handleTyping(); }}
            onKeyDown={handleKeyDown}
            placeholder="Type a message..."
            className="glass-input resize-none max-h-32 min-h-[44px]"
            rows={1}
          />
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={handleSend}
            disabled={!input.trim()}
            className="glass-button p-3 rounded-xl disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <Send className="w-5 h-5" />
          </motion.button>
        </div>
      </div>

      {/* Delete confirmation modal */}
      <AnimatePresence>
        {showDeleteConfirm && currentRoom && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
            onClick={() => setShowDeleteConfirm(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="glass-card p-6 w-full max-w-sm space-y-4"
            >
              <h3 className="text-lg font-semibold text-red-400 flex items-center gap-2">
                <Trash2 className="w-5 h-5" /> {currentRoom.type === 'dm' ? 'Delete Direct Chat' : 'Delete Chat'}
              </h3>
              <p className="text-sm opacity-80">
                {currentRoom.type === 'dm'
                  ? 'This will permanently delete this direct chat for both people, including all messages, replies, and reactions. This action cannot be undone.'
                  : 'This will permanently delete this chat, including all messages, replies, and reactions. This action cannot be undone.'}
              </p>
              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => setShowDeleteConfirm(false)}
                  className="flex-1 py-2 px-4 rounded-xl glass-button text-sm"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    deleteRoom(currentRoom.id);
                    setShowDeleteConfirm(false);
                  }}
                  className="flex-1 py-2 px-4 rounded-xl bg-red-500/20 hover:bg-red-500/30 text-red-400 font-semibold text-sm transition-colors"
                >
                  {currentRoom.type === 'dm' ? 'Delete for Both' : 'Delete Forever'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      <audio ref={voiceCall.remoteAudioRef} autoPlay playsInline />
    </div>
  );
}
