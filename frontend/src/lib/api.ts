const BASE = '';

// We need a way to get the current token without importing the store directly
// (to avoid circular imports). The authStore sets this after login/load.
let _getToken: () => string | null = () => null;

export function setTokenGetter(getter: () => string | null) {
  _getToken = getter;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = _getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((options.headers as Record<string, string>) || {}),
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${BASE}${path}`, { ...options, headers });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Request failed: ${res.status}`);
  }

  return res.json();
}

export const api = {
  login: (data: { username: string; password: string }) =>
    request<{ token: string; user: unknown }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  signup: (data: { username: string; password: string }) =>
    request<{ token: string; user: unknown }>('/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  getMe: () => request('/api/auth/me'),
  updateMe: (data: Record<string, unknown>) =>
    request('/api/auth/me', { method: 'PUT', body: JSON.stringify(data) }),
  changePassword: (data: { current_password: string; new_password: string }) =>
    request('/api/auth/password', { method: 'PUT', body: JSON.stringify(data) }),

  // Users
  searchUsers: (q: string) => request(`/api/users/search?q=${encodeURIComponent(q)}`),
  getUser: (id: string) => request(`/api/users/${id}`),
  listBlockedUsers: () => request('/api/blocks'),
  blockUser: (id: string) => request(`/api/users/${id}/block`, { method: 'POST' }),
  unblockUser: (id: string) => request(`/api/users/${id}/block`, { method: 'DELETE' }),

  // Rooms
  createRoom: (data: { name: string; type: string; member_ids?: string[] }) =>
    request('/api/rooms/', { method: 'POST', body: JSON.stringify(data) }),
  listRooms: () => request('/api/rooms/'),
  myRooms: () => request('/api/rooms/my'),
  exploreRooms: (search = '') =>
    request(`/api/rooms/explore${search ? `?search=${encodeURIComponent(search)}` : ''}`),
  getRoomByInvite: (code: string) => request(`/api/rooms/invite/${encodeURIComponent(code)}`),
  joinByInvite: (code: string) =>
    request(`/api/rooms/invite/${encodeURIComponent(code)}/join`, { method: 'POST' }),
  getRoom: (id: string) => request(`/api/rooms/${id}`),
  joinRoom: (id: string) => request(`/api/rooms/${id}/join`, { method: 'POST' }),
  leaveRoom: (id: string) => request(`/api/rooms/${id}/leave`, { method: 'POST' }),
  setRoomRetention: (id: string, hours: number | null) =>
    request(`/api/rooms/${id}/retention`, { method: 'PUT', body: JSON.stringify({ message_retention_hours: hours }) }),
  inviteToRoom: (id: string, user_ids: string[]) =>
    request(`/api/rooms/${id}/invite`, { method: 'POST', body: JSON.stringify({ user_ids }) }),
  deleteRoom: (id: string) => request(`/api/rooms/${id}`, { method: 'DELETE' }),

  // Messages
  getMessages: (roomId: string, limit = 50) =>
    request(`/api/messages/${roomId}?limit=${limit}`),
  searchMessages: (roomId: string, query: string, limit = 50) =>
    request(`/api/messages/${roomId}/search?q=${encodeURIComponent(query)}&limit=${limit}`),
  deleteMessage: (id: string, option: string) =>
    request(`/api/messages/${id}`, { method: 'DELETE', body: JSON.stringify({ delete_option: option }) }),
  toggleReaction: (messageId: string, emoji: string) =>
    request(`/api/messages/${messageId}/react`, { method: 'POST', body: JSON.stringify({ emoji }) }),

  // Friends
  sendFriendRequest: (to_user_id: string) =>
    request('/api/friends/request', { method: 'POST', body: JSON.stringify({ to_user_id }) }),
  getFriendRequests: () => request('/api/friends/requests'),
  getSentRequests: () => request('/api/friends/requests/sent'),
  getFriendSuggestions: (limit = 8) => request(`/api/friends/suggestions?limit=${limit}`),
  acceptFriendRequest: (id: string) => request(`/api/friends/requests/${id}/accept`, { method: 'POST' }),
  rejectFriendRequest: (id: string) => request(`/api/friends/requests/${id}/reject`, { method: 'POST' }),
  listFriends: () => request('/api/friends/'),
  toggleFavorite: (friendId: string, is_favorite: boolean) =>
    request(`/api/friends/${friendId}/favorite`, { method: 'PUT', body: JSON.stringify({ is_favorite }) }),
  removeFriend: (friendId: string) => request(`/api/friends/${friendId}`, { method: 'DELETE' }),

  // Settings
  getSettings: () => request('/api/settings/'),
  updateSettings: (data: Record<string, unknown>) =>
    request('/api/settings/', { method: 'PUT', body: JSON.stringify(data) }),

  // Admin
  adminListUsers: () => request('/api/admin/users'),
  adminBanUser: (id: string) => request(`/api/admin/users/${id}/ban`, { method: 'POST' }),
  adminUnbanUser: (id: string) => request(`/api/admin/users/${id}/unban`, { method: 'POST' }),
  adminListRooms: () => request('/api/admin/rooms'),
  adminDeleteRoom: (id: string) => request(`/api/admin/rooms/${id}`, { method: 'DELETE' }),
  adminDeleteMessage: (id: string) => request(`/api/admin/messages/${id}`, { method: 'DELETE' }),
  adminStats: () => request('/api/admin/stats'),
};
