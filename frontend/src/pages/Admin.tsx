import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  Users, MessageCircle, Hash, Activity, Shield, Trash2, Ban, ArrowLeft, CheckCircle,
} from 'lucide-react';
import { api } from '../lib/api';
import { useAuthStore } from '../stores/authStore';
import type { User, Room, AdminStats } from '../types';

export default function AdminPage() {
  const [tab, setTab] = useState<'dashboard' | 'users' | 'rooms'>('dashboard');
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);
  const theme = useAuthStore((s) => s.settings.theme);

  useEffect(() => {
    loadData();
  }, [tab]);

  const loadData = async () => {
    setLoading(true);
    try {
      if (tab === 'dashboard') {
        setStats(await api.adminStats() as AdminStats);
      } else if (tab === 'users') {
        setUsers(await api.adminListUsers() as User[]);
      } else {
        setRooms(await api.adminListRooms() as Room[]);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleBan = async (userId: string, isBanned: boolean) => {
    if (isBanned) {
      await api.adminUnbanUser(userId);
    } else {
      await api.adminBanUser(userId);
    }
    setUsers((prev) =>
      prev.map((u) => (u.id === userId ? { ...u, is_banned: !isBanned } : u))
    );
  };

  const handleDeleteRoom = async (roomId: string) => {
    await api.adminDeleteRoom(roomId);
    setRooms((prev) => prev.filter((r) => r.id !== roomId));
  };

  const tabItems = [
    { key: 'dashboard' as const, icon: Activity, label: 'Dashboard' },
    { key: 'users' as const, icon: Users, label: 'Users' },
    { key: 'rooms' as const, icon: Hash, label: 'Rooms' },
  ];

  return (
    <div className="min-h-screen p-4 md:p-8">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          <a href="/" className="p-2 glass rounded-xl hover:bg-white/10">
            <ArrowLeft className="w-5 h-5" />
          </a>
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Shield className="w-6 h-6 text-primary-400" />
              Admin Panel
            </h1>
            <p className="text-sm opacity-50">Manage users, rooms, and messages</p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-6">
          {tabItems.map(({ key, icon: Icon, label }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                tab === key ? 'bg-primary-500/20 text-primary-400 border border-primary-500/30' : 'glass hover:bg-white/10'
              }`}
            >
              <Icon className="w-4 h-4" />
              {label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <div className="w-10 h-10 border-4 border-primary-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <>
            {/* Dashboard */}
            {tab === 'dashboard' && stats && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {[
                  { label: 'Total Users', value: stats.total_users, icon: Users, color: 'text-blue-400' },
                  { label: 'Active Rooms', value: stats.active_rooms, icon: Hash, color: 'text-green-400' },
                  { label: 'Total Messages', value: stats.total_messages, icon: MessageCircle, color: 'text-purple-400' },
                  { label: 'Online Now', value: stats.online_users, icon: Activity, color: 'text-emerald-400' },
                ].map(({ label, value, icon: Icon, color }) => (
                  <motion.div
                    key={label}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="glass-card p-6"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm opacity-60">{label}</span>
                      <Icon className={`w-5 h-5 ${color}`} />
                    </div>
                    <p className="text-3xl font-bold">{value}</p>
                  </motion.div>
                ))}
              </div>
            )}

            {/* Users */}
            {tab === 'users' && (
              <div className="glass-card overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-white/10">
                        <th className="text-left p-4 font-medium opacity-60">User</th>
                        <th className="text-left p-4 font-medium opacity-60">Email</th>
                        <th className="text-left p-4 font-medium opacity-60">Status</th>
                        <th className="text-left p-4 font-medium opacity-60">Role</th>
                        <th className="text-right p-4 font-medium opacity-60">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {users.map((u) => (
                        <tr key={u.id} className="border-b border-white/5 hover:bg-white/5">
                          <td className="p-4">
                            <div className="flex items-center gap-3">
                              <img
                                src={u.avatar_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${u.username}`}
                                alt={u.username}
                                className="w-8 h-8 rounded-full"
                              />
                              <span className="font-medium">{u.username}</span>
                            </div>
                          </td>
                          <td className="p-4 opacity-60">{u.email}</td>
                          <td className="p-4">
                            <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs ${
                              u.status === 'online' ? 'bg-green-500/20 text-green-400' : 'bg-gray-500/20 opacity-50'
                            }`}>
                              <span className={`w-2 h-2 rounded-full ${u.status === 'online' ? 'bg-green-500' : 'bg-gray-500'}`} />
                              {u.status}
                            </span>
                          </td>
                          <td className="p-4">
                            {u.is_admin ? (
                              <span className="text-yellow-500 text-xs font-medium">Admin</span>
                            ) : u.is_banned ? (
                              <span className="text-red-400 text-xs font-medium">Banned</span>
                            ) : (
                              <span className="opacity-40 text-xs">Member</span>
                            )}
                          </td>
                          <td className="p-4 text-right">
                            {!u.is_admin && (
                              <button
                                onClick={() => handleBan(u.id, u.is_banned)}
                                className={`p-2 rounded-lg text-xs font-medium ${
                                  u.is_banned
                                    ? 'hover:bg-green-500/20 text-green-400'
                                    : 'hover:bg-red-500/20 text-red-400'
                                }`}
                              >
                                {u.is_banned ? (
                                  <span className="flex items-center gap-1"><CheckCircle className="w-4 h-4" /> Unban</span>
                                ) : (
                                  <span className="flex items-center gap-1"><Ban className="w-4 h-4" /> Ban</span>
                                )}
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Rooms */}
            {tab === 'rooms' && (
              <div className="grid gap-3">
                {rooms.map((r) => (
                  <motion.div
                    key={r.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="glass-card p-4 flex items-center gap-4"
                  >
                    <div className="w-10 h-10 rounded-xl bg-primary-500/20 flex items-center justify-center">
                      <Hash className="w-5 h-5 text-primary-400" />
                    </div>
                    <div className="flex-1">
                      <p className="font-medium">{r.name}</p>
                      <p className="text-xs opacity-40">
                        {r.type} &middot; {r.member_count} members &middot; {r.is_active ? 'Active' : 'Inactive'}
                      </p>
                    </div>
                    <button
                      onClick={() => handleDeleteRoom(r.id)}
                      className="p-2 hover:bg-red-500/20 rounded-lg text-red-400"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </motion.div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
