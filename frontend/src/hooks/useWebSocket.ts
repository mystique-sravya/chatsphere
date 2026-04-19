import { useEffect, useRef, useCallback } from 'react';
import { useAuthStore } from '../stores/authStore';
import { useChatStore } from '../stores/chatStore';
import { useFriendStore } from '../stores/friendStore';
import type { WSMessage } from '../types';
import { emitVoiceSocketEvent } from '../lib/voiceEvents';

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const token = useAuthStore((s) => s.token);
  const addMessage = useChatStore((s) => s.addMessage);
  const setTypingUser = useChatStore((s) => s.setTypingUser);
  const removeTypingUser = useChatStore((s) => s.removeTypingUser);
  const setActiveRoomUsers = useChatStore((s) => s.setActiveRoomUsers);
  const updateMessageStatus = useChatStore((s) => s.updateMessageStatus);
  const markRoomUnread = useChatStore((s) => s.markRoomUnread);

  useEffect(() => {
    if (!token) return;

    const apiUrl = import.meta.env.VITE_API_URL || '';
    let wsUrl: string;
    if (apiUrl) {
      // Production: connect to the Render backend
      const wsBase = apiUrl.replace(/^http/, 'ws');
      wsUrl = `${wsBase}/ws/${token}`;
    } else {
      // Dev: use Vite proxy on same host
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      wsUrl = `${protocol}//${window.location.host}/ws/${token}`;
    }
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      const data: WSMessage = JSON.parse(event.data);

      switch (data.type) {
        case 'message':
          addMessage({
            id: data.id,
            room_id: data.room_id,
            sender_id: data.sender_id,
            sender_username: data.sender_username,
            sender_avatar: data.sender_avatar,
            content: data.content,
            reply_to_id: data.reply_to_id,
            reply_content: data.reply_content,
            reply_sender_username: data.reply_sender_username,
            reactions: data.reactions,
            status: data.status,
            created_at: data.created_at,
          });
          if (data.sender_id !== useAuthStore.getState().user?.id) {
            useChatStore.getState().markRoomUnread(data.room_id);
          }
          break;

        case 'typing':
          setTypingUser(data.user_id, data.username);
          break;

        case 'stop_typing':
          removeTypingUser(data.user_id);
          break;

        case 'user_joined':
        case 'user_left':
          setActiveRoomUsers(data.active_users);
          break;

        case 'messages_seen':
          updateMessageStatus(data.message_ids, 'seen');
          break;

        case 'reaction':
          useChatStore.getState().updateReaction(
            data.message_id, data.room_id, data.emoji, data.user_id, data.username, data.action
          );
          if (data.user_id !== useAuthStore.getState().user?.id) {
            useChatStore.getState().markRoomUnread(data.room_id);
          }
          break;

        case 'friend_removed':
          useFriendStore.getState().handleFriendRemoved(data.user_id);
          break;

        case 'user_online':
          useFriendStore.getState().updateFriendStatus(data.user_id, 'online');
          break;

        case 'user_offline':
          useFriendStore.getState().updateFriendStatus(data.user_id, 'offline');
          break;

        case 'friend_request_accepted':
          useFriendStore.getState().loadFriends();
          useFriendStore.getState().loadSentRequests();
          break;

        case 'incoming_friend_request':
          useFriendStore.getState().loadRequests();
          break;

        case 'room_added':
          useChatStore.getState().loadRooms();
          break;

        case 'room_deleted': {
          const store = useChatStore.getState();
          if (store.currentRoom?.id === data.room_id) {
            useChatStore.setState({ currentRoom: null, messages: [] });
          }
          useChatStore.setState((s) => ({
            rooms: s.rooms.filter((r) => r.id !== data.room_id),
          }));
          break;
        }

        case 'voice_state':
          if (
            data.participants.some((participant) => participant.user_id !== useAuthStore.getState().user?.id)
            && useChatStore.getState().currentRoom?.id !== data.room_id
          ) {
            useChatStore.getState().markRoomUnread(data.room_id);
          }
          emitVoiceSocketEvent(data);
          break;
        case 'voice_offer':
        case 'voice_answer':
        case 'voice_ice_candidate':
          if (useChatStore.getState().currentRoom?.id !== data.room_id) {
            useChatStore.getState().markRoomUnread(data.room_id);
          }
          emitVoiceSocketEvent(data);
          break;
      }
    };

    ws.onclose = () => {
      // Reconnect after 3 seconds
      setTimeout(() => {
        if (useAuthStore.getState().token) {
          // Force re-render to reconnect
          useAuthStore.setState({});
        }
      }, 3000);
    };

    return () => {
      ws.close();
    };
  }, [token, addMessage, setTypingUser, removeTypingUser, setActiveRoomUsers, updateMessageStatus, markRoomUnread]);

  const send = useCallback((data: Record<string, unknown>) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
    }
  }, []);

  const joinRoom = useCallback((roomId: string, username: string) => {
    send({ type: 'join_room', room_id: roomId, username });
  }, [send]);

  const leaveRoom = useCallback((roomId: string, username: string) => {
    send({ type: 'leave_room', room_id: roomId, username });
  }, [send]);

  const sendMessage = useCallback((roomId: string, content: string, replyToId?: string) => {
    send({ type: 'message', room_id: roomId, content, reply_to_id: replyToId || null });
  }, [send]);

  const sendTyping = useCallback((roomId: string, username: string) => {
    send({ type: 'typing', room_id: roomId, username });
  }, [send]);

  const sendStopTyping = useCallback((roomId: string) => {
    send({ type: 'stop_typing', room_id: roomId });
  }, [send]);

  const markSeen = useCallback((roomId: string, messageIds: string[]) => {
    send({ type: 'mark_seen', room_id: roomId, message_ids: messageIds });
  }, [send]);

  const joinVoiceCall = useCallback((roomId: string) => {
    send({ type: 'voice_join', room_id: roomId });
  }, [send]);

  const leaveVoiceCall = useCallback((roomId: string) => {
    send({ type: 'voice_leave', room_id: roomId });
  }, [send]);

  const setVoiceMute = useCallback((roomId: string, muted: boolean) => {
    send({ type: 'voice_mute', room_id: roomId, muted });
  }, [send]);

  const sendVoiceOffer = useCallback((roomId: string, targetUserId: string, sdp: RTCSessionDescriptionInit) => {
    send({ type: 'voice_offer', room_id: roomId, target_user_id: targetUserId, sdp });
  }, [send]);

  const sendVoiceAnswer = useCallback((roomId: string, targetUserId: string, sdp: RTCSessionDescriptionInit) => {
    send({ type: 'voice_answer', room_id: roomId, target_user_id: targetUserId, sdp });
  }, [send]);

  const sendVoiceIceCandidate = useCallback((roomId: string, targetUserId: string, candidate: RTCIceCandidateInit) => {
    send({ type: 'voice_ice_candidate', room_id: roomId, target_user_id: targetUserId, candidate });
  }, [send]);

  return {
    send,
    joinRoom,
    leaveRoom,
    sendMessage,
    sendTyping,
    sendStopTyping,
    markSeen,
    joinVoiceCall,
    leaveVoiceCall,
    setVoiceMute,
    sendVoiceOffer,
    sendVoiceAnswer,
    sendVoiceIceCandidate,
  };
}
