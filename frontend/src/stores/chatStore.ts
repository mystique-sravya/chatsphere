import { create } from 'zustand';
import type { Room, Message } from '../types';
import { api } from '../lib/api';
import { decryptMessage } from '../lib/crypto';

interface ChatState {
  rooms: Room[];
  roomsLoading: boolean;
  currentRoom: Room | null;
  messages: Message[];
  messagesByRoom: Record<string, Message[]>;
  unreadRooms: Record<string, boolean>;
  typingUsers: Map<string, string>; // user_id -> username
  activeRoomUsers: string[];

  loadRooms: () => Promise<void>;
  loadMyRooms: () => Promise<void>;
  setCurrentRoom: (room: Room | null) => void;
  loadMessages: (roomId: string) => Promise<void>;
  addMessage: (message: Message) => void;
  createRoom: (name: string, type: string, memberIds?: string[]) => Promise<Room>;
  joinRoom: (roomId: string) => Promise<Room>;
  leaveRoom: (roomId: string) => Promise<void>;
  deleteRoom: (roomId: string) => Promise<void>;
  setTypingUser: (userId: string, username: string) => void;
  removeTypingUser: (userId: string) => void;
  setActiveRoomUsers: (users: string[]) => void;
  markRoomUnread: (roomId: string) => void;
  clearRoomUnread: (roomId: string) => void;
  updateMessageStatus: (messageIds: string[], status: string) => void;
  updateReaction: (messageId: string, roomId: string, emoji: string, userId: string, username: string, action: 'added' | 'removed') => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  rooms: [],
  roomsLoading: true,
  currentRoom: null,
  messages: [],
  messagesByRoom: {},
  unreadRooms: {},
  typingUsers: new Map(),
  activeRoomUsers: [],

  loadRooms: async () => {
    set({ roomsLoading: true });
    const rooms = await api.listRooms() as Room[];
    const currentRoomId = get().currentRoom?.id;
    const unread: Record<string, boolean> = { ...get().unreadRooms };
    for (const room of rooms) {
      if (room.has_unread && room.id !== currentRoomId) {
        unread[room.id] = true;
      }
    }
    set({ rooms, unreadRooms: unread, roomsLoading: false });
  },

  loadMyRooms: async () => {
    set({ roomsLoading: true });
    const rooms = await api.myRooms() as Room[];
    const currentRoomId = get().currentRoom?.id;
    const unread: Record<string, boolean> = { ...get().unreadRooms };
    for (const room of rooms) {
      if (room.has_unread && room.id !== currentRoomId) {
        unread[room.id] = true;
      }
    }
    set({ rooms, unreadRooms: unread, roomsLoading: false });
  },

  setCurrentRoom: (room) => set((state) => {
    if (!room) {
      return { currentRoom: null, messages: [], typingUsers: new Map() };
    }

    if (state.currentRoom?.id === room.id) {
      return { currentRoom: null, messages: [], typingUsers: new Map() };
    }

    return {
      currentRoom: room,
      messages: state.messagesByRoom[room.id] || [],
      unreadRooms: {
        ...state.unreadRooms,
        [room.id]: false,
      },
      typingUsers: new Map(),
    };
  }),

  loadMessages: async (roomId) => {
    const rawMessages = await api.getMessages(roomId) as Message[];
    const messages = await Promise.all(
      rawMessages.map(async (m) => ({
        ...m,
        content: await decryptMessage(roomId, m.content),
        reply_content: m.reply_content ? await decryptMessage(roomId, m.reply_content) : m.reply_content,
      }))
    );
    set((state) => ({
      messages,
      unreadRooms: {
        ...state.unreadRooms,
        [roomId]: false,
      },
      messagesByRoom: {
        ...state.messagesByRoom,
        [roomId]: messages,
      },
    }));
  },

  addMessage: (message) => {
    set((s) => ({
      messages: s.currentRoom?.id === message.room_id ? [...s.messages, message] : s.messages,
      messagesByRoom: {
        ...s.messagesByRoom,
        [message.room_id]: [...(s.messagesByRoom[message.room_id] || []), message],
      },
      typingUsers: (() => {
        const m = new Map(s.typingUsers);
        m.delete(message.sender_id);
        return m;
      })(),
    }));
  },

  createRoom: async (name, type, memberIds = []) => {
    const room = await api.createRoom({ name, type, member_ids: memberIds }) as Room;
    set((s) => {
      const exists = s.rooms.some((r) => r.id === room.id);
      return { rooms: exists ? s.rooms : [room, ...s.rooms] };
    });
    return room;
  },

  joinRoom: async (roomId) => {
    const room = await api.joinRoom(roomId) as Room;
    await get().loadRooms();
    return room;
  },

  leaveRoom: async (roomId) => {
    await api.leaveRoom(roomId);
    if (get().currentRoom?.id === roomId) {
      set({ currentRoom: null, messages: [] });
    }
    await get().loadRooms();
  },

  deleteRoom: async (roomId) => {
    await api.deleteRoom(roomId);
    if (get().currentRoom?.id === roomId) {
      set({ currentRoom: null, messages: [] });
    }
    set((s) => {
      const nextMessagesByRoom = { ...s.messagesByRoom };
      delete nextMessagesByRoom[roomId];

      return {
        rooms: s.rooms.filter((r) => r.id !== roomId),
        messagesByRoom: nextMessagesByRoom,
      };
    });
  },

  setTypingUser: (userId, username) => {
    set((s) => {
      const m = new Map(s.typingUsers);
      m.set(userId, username);
      return { typingUsers: m };
    });
  },

  removeTypingUser: (userId) => {
    set((s) => {
      const m = new Map(s.typingUsers);
      m.delete(userId);
      return { typingUsers: m };
    });
  },

  setActiveRoomUsers: (users) => set({ activeRoomUsers: users }),

  markRoomUnread: (roomId) => {
    set((state) => {
      if (state.currentRoom?.id === roomId) {
        return state;
      }

      return {
        unreadRooms: {
          ...state.unreadRooms,
          [roomId]: true,
        },
      };
    });
  },

  clearRoomUnread: (roomId) => {
    set((state) => ({
      unreadRooms: {
        ...state.unreadRooms,
        [roomId]: false,
      },
    }));
  },

  updateMessageStatus: (messageIds, status) => {
    set((s) => ({
      messages: s.messages.map((m) =>
        messageIds.includes(m.id) ? { ...m, status } : m
      ),
      messagesByRoom: Object.fromEntries(
        Object.entries(s.messagesByRoom).map(([roomId, roomMessages]) => [
          roomId,
          roomMessages.map((message) =>
            messageIds.includes(message.id) ? { ...message, status } : message
          ),
        ])
      ),
    }));
  },

  updateReaction: (messageId, roomId, emoji, userId, username, action) => {
    const updateMsg = (msg: Message): Message => {
      if (msg.id !== messageId) return msg;
      let reactions = [...(msg.reactions || [])];
      if (action === 'added') {
        if (!reactions.some((r) => r.emoji === emoji && r.user_id === userId)) {
          reactions.push({ emoji, user_id: userId, username });
        }
      } else {
        reactions = reactions.filter((r) => !(r.emoji === emoji && r.user_id === userId));
      }
      return { ...msg, reactions };
    };
    set((s) => ({
      messages: s.messages.map(updateMsg),
      messagesByRoom: {
        ...s.messagesByRoom,
        [roomId]: (s.messagesByRoom[roomId] || []).map(updateMsg),
      },
    }));
  },
}));
