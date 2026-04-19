import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatTime(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - date.getTime();

  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return date.toLocaleDateString();
}

export function getDiceBearAvatar(seed: string): string {
  return `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(seed)}`;
}

export function getRoomAvatar(seed: string, type: string): string {
  const style = type === 'dm' ? 'thumbs' : type === 'public' ? 'shapes' : 'glass';
  return `https://api.dicebear.com/9.x/${style}/svg?seed=${encodeURIComponent(seed)}`;
}

export function getConversationTypeLabel(type: string): string {
  switch (type) {
    case 'dm':
      return 'Direct chat';
    case 'private':
      return 'Private chat';
    case 'public':
    default:
      return 'Public chat';
  }
}

export function getParticipantLabel(room: { type: string; member_count: number }): string {
  if (room.type === 'dm') {
    if (room.member_count < 2) {
      return 'Other person left';
    }
    return `${room.member_count} participants`;
  }
  return `${room.member_count} members`;
}

export function isRoomMember(room: { members?: Array<{ user_id: string }> }, userId: string): boolean {
  return Array.isArray(room.members) && room.members.some((member) => member.user_id === userId);
}

export function getConversationDisplayName(room: { type: string; name: string; members?: Array<{ user_id: string; username: string }> }, currentUserId: string): string {
  if (room.type !== 'dm' || !Array.isArray(room.members) || room.members.length === 0) {
    return room.name;
  }
  const other = room.members.find((m) => m.user_id !== currentUserId);
  if (other?.username) {
    return other.username;
  }
  return 'User left chat';
}

export const getDmDisplayName = getConversationDisplayName;
