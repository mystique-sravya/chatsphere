export interface User {
  id: string;
  username: string;
  email: string;
  avatar_url: string | null;
  avatar_type: string;
  status: string;
  last_seen: string;
  is_admin: boolean;
  is_banned: boolean;
  created_at: string;
}

export interface Room {
  id: string;
  name: string;
  type: 'public' | 'private' | 'dm';
  created_by: string;
  is_active: boolean;
  invite_code: string | null;
  message_retention_hours: number | null;
  created_at: string;
  member_count: number;
  members: RoomMember[];
  is_member?: boolean;
  has_unread?: boolean;
}

export interface RoomMember {
  user_id: string;
  username: string;
  avatar_url: string | null;
  role: string;
  status: string;
}

export interface Reaction {
  emoji: string;
  user_id: string;
  username: string;
}

export interface Message {
  id: string;
  room_id: string;
  sender_id: string;
  sender_username: string;
  sender_avatar: string | null;
  content: string;
  reply_to_id: string | null;
  reply_content: string | null;
  reply_sender_username: string | null;
  reactions: Reaction[];
  status: string;
  created_at: string;
}

export interface FriendRequest {
  id: string;
  from_user_id: string;
  from_username: string;
  from_avatar: string | null;
  to_user_id: string;
  to_username: string;
  status: string;
  created_at: string;
}

export interface SentFriendRequest {
  id: string;
  from_user_id: string;
  from_username: string;
  to_user_id: string;
  to_username: string;
  to_avatar: string | null;
  status: string;
  created_at: string;
}

export interface Friend {
  user_id: string;
  username: string;
  avatar_url: string | null;
  status: string;
  last_seen: string;
  is_favorite: boolean;
}

export interface BlockedUser {
  user_id: string;
  username: string;
  avatar_url: string | null;
  status: string;
  last_seen: string;
  created_at: string;
}

export interface UserSettings {
  theme: 'dark' | 'light';
  notifications_enabled: boolean;
}

export interface AdminStats {
  total_users: number;
  active_rooms: number;
  total_messages: number;
  online_users: number;
}

export interface VoiceParticipantState {
  user_id: string;
  muted: boolean;
}

export type WSMessage =
  | { type: 'message'; id: string; room_id: string; sender_id: string; sender_username: string; sender_avatar: string | null; content: string; reply_to_id: string | null; reply_content: string | null; reply_sender_username: string | null; reactions: Reaction[]; status: string; created_at: string }
  | { type: 'typing'; user_id: string; username: string; room_id: string }
  | { type: 'stop_typing'; user_id: string; room_id: string }
  | { type: 'user_joined'; user_id: string; username: string; room_id: string; active_users: string[] }
  | { type: 'user_left'; user_id: string; username?: string; room_id: string; active_users: string[] }
  | { type: 'presence'; user_id: string; status: string }
  | { type: 'messages_seen'; user_id: string; message_ids: string[]; room_id: string }
  | { type: 'reaction'; message_id: string; room_id: string; user_id: string; username: string; emoji: string; action: 'added' | 'removed' }
  | { type: 'friend_removed'; user_id: string }
  | { type: 'friend_request_accepted'; user_id: string; username: string }
  | { type: 'incoming_friend_request'; from_user_id: string; from_username: string }
  | { type: 'user_online'; user_id: string }
  | { type: 'user_offline'; user_id: string }
  | { type: 'room_added'; room: Room }
  | { type: 'room_deleted'; room_id: string }
  | { type: 'room_users'; room_id: string; users: string[] }
  | { type: 'voice_state'; room_id: string; participants: VoiceParticipantState[] }
  | { type: 'voice_offer'; room_id: string; from_user_id: string; sdp: RTCSessionDescriptionInit }
  | { type: 'voice_answer'; room_id: string; from_user_id: string; sdp: RTCSessionDescriptionInit }
  | { type: 'voice_ice_candidate'; room_id: string; from_user_id: string; candidate: RTCIceCandidateInit }
  | { type: 'error'; message: string };
