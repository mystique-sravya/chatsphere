import { useState, useEffect } from 'react';
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

export default function ChatPage() {
  const [showSettings, setShowSettings] = useState(false);
  const [showCreateRoom, setShowCreateRoom] = useState(false);
  const [showExploreRooms, setShowExploreRooms] = useState(false);
  const [pendingJoinRoom, setPendingJoinRoom] = useState<Room | null>(null);
  const [rightPanel, setRightPanel] = useState<'members' | 'friends' | null>(null);
  const [mobileSidebar, setMobileSidebar] = useState(false);

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

  return (
    <div className="h-[100dvh] flex overflow-hidden">
      {/* Mobile sidebar overlay */}
      {mobileSidebar && currentRoom && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setMobileSidebar(false)}
        />
      )}

      {/* Sidebar */}
      <div
        className={
          currentRoom
            ? `${mobileSidebar ? 'translate-x-0' : '-translate-x-full'} lg:translate-x-0 fixed lg:relative z-50 lg:z-auto transition-transform duration-300`
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

      {/* Main Chat */}
      <div className={`${currentRoom ? 'flex flex-1 min-w-0' : 'hidden lg:flex lg:flex-1 lg:min-w-0'}`}>
        <ChatArea
          ws={ws}
          onMenuClick={() => setMobileSidebar(true)}
          onToggleMembers={() => setRightPanel(rightPanel === 'members' ? null : 'members')}
        />
      </div>

      {/* Right Panel */}
      {rightPanel && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setRightPanel(null)}
        />
      )}
      {rightPanel && (
        <RightPanel type={rightPanel!} onClose={() => setRightPanel(null)} ws={ws} />
      )}

      {/* Modals */}
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
      {showCreateRoom && (
        <CreateRoomModal
          onClose={() => setShowCreateRoom(false)}
          ws={ws}
        />
      )}
      {showExploreRooms && (
        <ExploreRoomsModal onClose={() => setShowExploreRooms(false)} />
      )}
      {pendingJoinRoom && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60" onClick={() => setPendingJoinRoom(null)} />
          <div className="relative glass-card p-6 w-full max-w-sm">
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
          </div>
        </div>
      )}
    </div>
  );
}
