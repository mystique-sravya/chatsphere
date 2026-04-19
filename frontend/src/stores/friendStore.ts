import { create } from 'zustand';
import type { Friend, FriendRequest, SentFriendRequest } from '../types';
import { api } from '../lib/api';

interface FriendState {
  friends: Friend[];
  requests: FriendRequest[];
  sentRequests: SentFriendRequest[];

  loadFriends: () => Promise<void>;
  loadRequests: () => Promise<void>;
  loadSentRequests: () => Promise<void>;
  sendRequest: (userId: string) => Promise<void>;
  acceptRequest: (requestId: string) => Promise<void>;
  rejectRequest: (requestId: string) => Promise<void>;
  toggleFavorite: (friendId: string, isFavorite: boolean) => Promise<void>;
  removeFriend: (friendId: string) => Promise<void>;
  handleFriendRemoved: (userId: string) => void;
}

export const useFriendStore = create<FriendState>((set, get) => ({
  friends: [],
  requests: [],
  sentRequests: [],

  loadFriends: async () => {
    const friends = await api.listFriends() as Friend[];
    set({ friends });
  },

  loadRequests: async () => {
    const requests = await api.getFriendRequests() as FriendRequest[];
    set({ requests });
  },

  loadSentRequests: async () => {
    const sentRequests = await api.getSentRequests() as SentFriendRequest[];
    set({ sentRequests });
  },

  sendRequest: async (userId) => {
    await api.sendFriendRequest(userId);
    await get().loadSentRequests();
  },

  acceptRequest: async (requestId) => {
    await api.acceptFriendRequest(requestId);
    await get().loadRequests();
    await get().loadFriends();
  },

  rejectRequest: async (requestId) => {
    await api.rejectFriendRequest(requestId);
    await get().loadRequests();
  },

  toggleFavorite: async (friendId, isFavorite) => {
    await api.toggleFavorite(friendId, isFavorite);
    set((s) => ({
      friends: s.friends.map((f) =>
        f.user_id === friendId ? { ...f, is_favorite: isFavorite } : f
      ),
    }));
  },

  removeFriend: async (friendId) => {
    await api.removeFriend(friendId);
    set((s) => ({ friends: s.friends.filter((f) => f.user_id !== friendId) }));
  },

  handleFriendRemoved: (userId) => {
    set((s) => ({ friends: s.friends.filter((f) => f.user_id !== userId) }));
  },
}));
