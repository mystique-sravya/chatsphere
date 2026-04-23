import { useState, useEffect, useRef, useCallback } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useWebSocket } from '../hooks/useWebSocket';
import { useAuthStore } from '../stores/authStore';
import { useChatStore } from '../stores/chatStore';
import { useFriendStore } from '../stores/friendStore';
import Sidebar from '../components/Sidebar';
import ChatArea from '../components/ChatArea';
import RightPanel from '../components/RightPanel';
import SettingsModal from '../components/SettingsModal';
import CreateRoomModal from '../components/CreateRoomModal';
import ExploreRoomsModal from '../components/ExploreRoomsModal';
import type { Room } from '../types';
import { isRoomMember } from '../lib/utils';

const isMobile = () => window.innerWidth < 1024;

export default function ChatPage() {
  const [showSettings, setShowSettings] = useState(false);
  const [showCreateRoom, setShowCreateRoom] = useState(false);
  const [showExploreRooms, setShowExploreRooms] = useState(false);
  const [pendingJoinRoom, setPendingJoinRoom] = useState<Room | null>(null);
  const [rightPanel, setRightPanel] = useState<'members' | 'friends' | null>(null);
  const [mobileSidebar, setMobileSidebar] = useState(false);
  const [swipeX, setSwipeX] = useState(0);
  const swipeRef = useRef({ startX: 0, startY: 0, tracking: false, swiping: false });

  const user = useAuthStore((s) => s.user)!;
  const { loadRooms, currentRoom, setCurrentRoom, joinRoom } = useChatStore();
  const { loadFriends, loadRequests, loadSentRequests } = useFriendStore();
  const ws = useWebSocket();

  useEffect(() => {
    if (!currentRoom) {
      setMobileSidebar(true);
    }
  }, [currentRoom]);

  useEffect(() => {
    loadRooms();
    loadFriends();
    loadRequests();
    loadSentRequests();
  }, [loadRooms, loadFriends, loadRequests, loadSentRequests]);

  useEffect(() => {
    if (currentRoom) {
      ws.joinRoom(currentRoom.id, user.username);
      return () => {
        ws.leaveRoom(currentRoom.id, user.username);
      };
    }
  }, [currentRoom?.id]);

  // ── Swipe-back gesture (mobile only) ──
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (!isMobile() || !currentRoom) return;
    const t = e.touches[0];
    // Only track if starting from left edge (< 30px)
    if (t.clientX < 30) {
      swipeRef.current = { startX: t.clientX, startY: t.clientY, tracking: true, swiping: false };
    }
  }, [currentRoom]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    const ref = swipeRef.current;
    if (!ref.tracking) return;
    const t = e.touches[0];
    const dx = t.clientX - ref.startX;
    const dy = Math.abs(t.clientY - ref.startY);
    // If vertical movement > horizontal, cancel swipe
    if (!ref.swiping && dy > Math.abs(dx)) {
      ref.tracking = false;
      return;
    }
    if (dx > 10) ref.swiping = true;
    if (ref.swiping) {
      setSwipeX(Math.min(dx, window.innerWidth));
    }
  }, []);

  const handleTouchEnd = useCallback(() => {
    const ref = swipeRef.current;
    if (ref.swiping && swipeX > window.innerWidth * 0.35) {
      // Swipe past threshold → go back to sidebar
      setCurrentRoom(null as unknown as Room);
      setMobileSidebar(true);
    }
    ref.tracking = false;
    ref.swiping = false;
    setSwipeX(0);
  }, [swipeX, setCurrentRoom]);

  const handleGoBack = useCallback(() => {
    setCurrentRoom(null as unknown as Room);
    setMobileSidebar(true);
  }, [setCurrentRoom]);

  return (
    <div
      className="h-[100dvh] flex overflow-hidden relative"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* ── Sidebar ── */}
      {/* Desktop: always visible | Mobile: full screen when no room, slide overlay when room selected */}
      <div
        className={
          currentRoom
            ? `${mobileSidebar ? 'translate-x-0' : '-translate-x-full'} lg:translate-x-0 fixed lg:relative z-50 lg:z-auto transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]`
            : 'relative z-30 w-full lg:w-auto translate-x-0'
        }
      >
        <Sidebar
          onCreateRoom={() => setShowCreateRoom(true)}
          onOpenSettings={() => setShowSettings(true)}
          onSelectRoom={(room) => {
            setCurrentRoom(room);
            setMobileSidebar(false);
          }}
          onJoinPublicRoom={(room) => {
            if (room.type === 'public' && !isRoomMember(room, user.id)) {
              setPendingJoinRoom(room);
              return;
            }
            setCurrentRoom(room);
            setMobileSidebar(false);
          }}
          onToggleFriends={() => {
            setMobileSidebar(false);
            setRightPanel(rightPanel === 'friends' ? null : 'friends');
          }}
          onExploreRooms={() => setShowExploreRooms(true)}
        />
      </div>

      {/* Mobile sidebar backdrop with blur */}
      <AnimatePresence>
        {mobileSidebar && currentRoom && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="fixed inset-0 bottom-sheet-overlay z-40 lg:hidden"
            onClick={() => setMobileSidebar(false)}
          />
        )}
      </AnimatePresence>

      {/* ── Main Chat Area ── */}
      <div
        className={`${currentRoom ? 'flex flex-1 min-w-0' : 'hidden lg:flex lg:flex-1 lg:min-w-0'}`}
        style={swipeX > 0 ? { transform: `translateX(${swipeX}px)`, transition: 'none' } : undefined}
      >
        <ChatArea
          ws={ws}
          onMenuClick={handleGoBack}
          onToggleMembers={() => setRightPanel(rightPanel === 'members' ? null : 'members')}
        />
      </div>

      {/* Swipe-back edge shadow indicator */}
      {swipeX > 0 && (
        <div
          className="fixed left-0 top-0 h-full w-1 z-[70] lg:hidden"
          style={{
            background: `linear-gradient(to right, rgba(0,0,0,0.15), transparent)`,
            transform: `translateX(${swipeX}px)`,
          }}
        />
      )}

      {/* ── Right Panel ── */}
      <AnimatePresence>
        {rightPanel && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 bottom-sheet-overlay z-40 lg:hidden"
              onClick={() => setRightPanel(null)}
            />
            <RightPanel type={rightPanel} onClose={() => setRightPanel(null)} ws={ws} />
          </>
        )}
      </AnimatePresence>

      {/* ── Modals ── */}
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
      {showCreateRoom && (
        <CreateRoomModal onClose={() => setShowCreateRoom(false)} ws={ws} />
      )}
      {showExploreRooms && (
        <ExploreRoomsModal onClose={() => setShowExploreRooms(false)} />
      )}
      {pendingJoinRoom && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setPendingJoinRoom(null)} />
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="relative glass-card p-6 w-full max-w-sm"
          >
            <h2 className="text-xl font-bold mb-2">Join public chat?</h2>
            <p className="text-sm opacity-70 mb-5">
              {pendingJoinRoom!.name} is public. Do you want to join the chat or go back?
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setPendingJoinRoom(null)}
                className="glass-button-secondary flex-1 text-sm"
              >
                Go Back
              </button>
              <button
                onClick={async () => {
                  const joinedRoom = await joinRoom(pendingJoinRoom!.id);
                  setCurrentRoom(joinedRoom);
                  setPendingJoinRoom(null);
                  setMobileSidebar(false);
                }}
                className="glass-button flex-1 text-sm"
              >
                Join Chat
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}
