import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { X, Moon, Sun, User, Bell, Palette, Lock } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { api } from '../lib/api';
import { formatDate } from '../lib/utils';
import type { BlockedUser } from '../types';

interface SettingsModalProps {
  onClose: () => void;
}

export default function SettingsModal({ onClose }: SettingsModalProps) {
  const { user, settings, updateUser, changePassword, updateSettings, setTheme } = useAuthStore();
  const [avatarUrl, setAvatarUrl] = useState('');
  const [showAdvancedAvatarUrl, setShowAdvancedAvatarUrl] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [profileMessage, setProfileMessage] = useState('');
  const [passwordMessage, setPasswordMessage] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [blockedUsers, setBlockedUsers] = useState<BlockedUser[]>([]);
  const [loadingBlockedUsers, setLoadingBlockedUsers] = useState(false);
  const [activeTab, setActiveTab] = useState<'profile' | 'security' | 'appearance' | 'notifications'>('profile');
  const [pendingAvatarChange, setPendingAvatarChange] = useState<null | {
    title: string;
    description: string;
    successMessage: string;
    data: Record<string, unknown>;
  }>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadBlockedUsers() {
      setLoadingBlockedUsers(true);
      try {
        const rows = await api.listBlockedUsers() as BlockedUser[];
        if (!cancelled) {
          setBlockedUsers(rows);
        }
      } catch {
        if (!cancelled) {
          setBlockedUsers([]);
        }
      } finally {
        if (!cancelled) {
          setLoadingBlockedUsers(false);
        }
      }
    }

    void loadBlockedUsers();

    return () => {
      cancelled = true;
    };
  }, []);

  const handleSaveProfile = async () => {
    setProfileMessage('');
    if (avatarUrl) {
      setPendingAvatarChange({
        title: 'Change Profile Picture',
        description: 'Your current profile picture will be replaced with the remote image URL you entered.',
        successMessage: 'Profile updated!',
        data: { avatar_url: avatarUrl, avatar_type: 'custom' },
      });
      return;
    }

    setProfileMessage('No profile changes to save');
  };

  const applyAvatarChange = async (change: NonNullable<typeof pendingAvatarChange>) => {
    setProfileSaving(true);
    setProfileMessage('');
    try {
      await updateUser(change.data);
      setProfileMessage(change.successMessage);
      setAvatarUrl('');
      setShowAdvancedAvatarUrl(false);
    } catch (err: any) {
      setProfileMessage(err.message || 'Avatar update failed');
    } finally {
      setProfileSaving(false);
      setPendingAvatarChange(null);
    }
  };

  const handleResetAvatar = async () => {
    setPendingAvatarChange({
      title: 'Reset Profile Picture',
      description: 'Your current profile picture will be replaced with the default DiceBear avatar.',
      successMessage: 'Avatar reset to default',
      data: {
        avatar_url: `https://api.dicebear.com/9.x/lorelei-neutral/svg?seed=${user?.username}`,
        avatar_type: 'dicebear',
        avatar_style: 'lorelei-neutral',
      },
    });
  };

  const handleChangePassword = async () => {
    setPasswordMessage('');

    if (!currentPassword || !newPassword || !confirmPassword) {
      setPasswordMessage('Fill in all password fields');
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordMessage('New password and confirmation do not match');
      return;
    }

    setPasswordSaving(true);
    try {
      await changePassword(currentPassword, newPassword);
      setPasswordMessage('Password updated successfully');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: any) {
      setPasswordMessage(err.message || 'Password update failed');
    } finally {
      setPasswordSaving(false);
    }
  };

  const handleUnblockUser = async (userId: string) => {
    setPasswordMessage('');
    try {
      await api.unblockUser(userId);
      setBlockedUsers((current) => current.filter((userRow) => userRow.user_id !== userId));
      setPasswordMessage('User removed from blocked list');
    } catch (err: any) {
      setPasswordMessage(err.message || 'Unable to unblock user');
    }
  };

  const handleAvatarUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    if (!file.type.startsWith('image/')) {
      setProfileMessage('Choose an image file for your avatar');
      event.target.value = '';
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      setProfileMessage('Avatar image must be smaller than 2 MB');
      event.target.value = '';
      return;
    }

    setProfileSaving(true);
    setProfileMessage('');

    try {
      const avatarDataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('Unable to read avatar file'));
        reader.readAsDataURL(file);
      });

      setPendingAvatarChange({
        title: 'Change Profile Picture',
        description: 'Your current profile picture will be replaced with the uploaded image.',
        successMessage: 'Avatar uploaded successfully',
        data: { avatar_url: avatarDataUrl, avatar_type: 'custom' },
      });
    } catch (err: any) {
      setProfileMessage(err.message || 'Avatar upload failed');
    } finally {
      setProfileSaving(false);
      event.target.value = '';
    }
  };

  const diceBearStyles = ['lorelei-neutral', 'notionists-neutral', 'adventurer-neutral', 'thumbs', 'shapes', 'glass'];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="relative glass-card w-full max-w-lg max-h-[92vh] overflow-y-auto p-4 sm:p-6"
      >
        <div className="flex items-center justify-between mb-5 sm:mb-6">
          <h2 className="text-lg sm:text-xl font-bold">Settings</h2>
          <button onClick={onClose} className="p-1 hover:bg-white/10 rounded-lg">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="grid grid-cols-2 gap-1 mb-5 p-1 glass rounded-xl sm:flex sm:mb-6">
          {([
            { key: 'profile', icon: User, label: 'Profile' },
            { key: 'security', icon: Lock, label: 'Security' },
            { key: 'appearance', icon: Palette, label: 'Appearance' },
            { key: 'notifications', icon: Bell, label: 'Alerts' },
          ] as const).map(({ key, icon: Icon, label }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`flex items-center justify-center gap-2 py-2 rounded-lg text-xs sm:text-sm font-medium transition-colors sm:flex-1 ${
                activeTab === key ? 'bg-primary-500/20 text-primary-400' : 'opacity-60 hover:opacity-100'
              }`}
            >
              <Icon className="w-4 h-4 shrink-0" />
              {label}
            </button>
          ))}
        </div>

        {activeTab === 'profile' && (
          <div className="space-y-4">
            {/* Current avatar */}
            <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:gap-4">
              <img
                src={user?.avatar_url || `https://api.dicebear.com/9.x/lorelei-neutral/svg?seed=${user?.username}`}
                alt="Avatar"
                className="w-16 h-16 rounded-2xl"
              />
              <div className="min-w-0">
                <p className="font-medium">{user?.username}</p>
                <p className="text-sm opacity-50">Username-based account</p>
                <button
                  onClick={handleResetAvatar}
                  className="text-xs text-primary-400 hover:text-primary-300 mt-1"
                >
                  Reset to DiceBear
                </button>
              </div>
            </div>

            {/* DiceBear style picker */}
            <div>
              <label className="text-sm font-medium opacity-60 mb-2 block">Choose Avatar Style</label>
              <div className="grid grid-cols-5 gap-2 sm:grid-cols-6">
                {diceBearStyles.map((style) => (
                  <button
                    key={style}
                    onClick={() => {
                      const url = `https://api.dicebear.com/9.x/${style}/svg?seed=${user?.username}`;
                      setPendingAvatarChange({
                        title: 'Change Profile Picture',
                        description: 'Your current profile picture will be replaced with this DiceBear style.',
                        successMessage: 'Avatar updated!',
                        data: { avatar_url: url, avatar_type: 'dicebear', avatar_style: style },
                      });
                    }}
                    className="p-1 rounded-xl hover:bg-white/10 transition-colors"
                  >
                    <img
                      src={`https://api.dicebear.com/9.x/${style}/svg?seed=${user?.username}`}
                      alt={style}
                      className="w-12 h-12 sm:w-full sm:h-auto rounded-lg mx-auto"
                    />
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-sm font-medium opacity-60 mb-1 block">Upload Profile Image</label>
              <input
                type="file"
                accept="image/*"
                onChange={handleAvatarUpload}
                className="block w-full text-sm opacity-70 file:mb-2 file:mr-0 sm:file:mb-0 sm:file:mr-3 file:rounded-lg file:border-0 file:bg-white/10 file:px-3 file:py-2 file:text-sm file:text-white hover:file:bg-white/20"
              />
              <p className="text-xs opacity-40 mt-1">Use a JPG, PNG, or WebP image up to 2 MB.</p>
            </div>

            <div className="glass rounded-xl p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">Remote Image URL</p>
                  <p className="text-xs opacity-40">Advanced option for a direct public image link</p>
                </div>
                <button
                  onClick={() => setShowAdvancedAvatarUrl((current) => !current)}
                  className="px-3 py-1.5 rounded-lg hover:bg-white/10 text-xs"
                >
                  {showAdvancedAvatarUrl ? 'Hide' : 'Show'}
                </button>
              </div>

              {showAdvancedAvatarUrl && (
                <div className="mt-3 space-y-2">
                  <input
                    type="url"
                    placeholder="https://example.com/avatar.png"
                    value={avatarUrl}
                    onChange={(e) => setAvatarUrl(e.target.value)}
                    className="glass-input text-sm"
                  />
                  <p className="text-xs opacity-40">
                    This must be a direct image file URL, not a Google search page or website link.
                  </p>
                </div>
              )}
            </div>

            {/* Username */}
            <div>
              <label className="text-sm font-medium opacity-60 mb-1 block">Username</label>
              <input
                type="text"
                value={user?.username || ''}
                disabled
                readOnly
                className="glass-input text-sm opacity-60 cursor-not-allowed"
              />
              <p className="text-xs opacity-40 mt-1">Username is permanent and cannot be changed.</p>
            </div>

            <button onClick={handleSaveProfile} disabled={profileSaving} className="glass-button w-full">
              {profileSaving ? 'Saving...' : 'Save Profile'}
            </button>

            {profileMessage && (
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="text-sm text-center text-primary-400"
              >
                {profileMessage}
              </motion.p>
            )}
          </div>
        )}

        {activeTab === 'security' && (
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium opacity-60 mb-1 block">Current Password</label>
              <input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="glass-input text-sm"
                autoComplete="current-password"
              />
            </div>

            <div>
              <label className="text-sm font-medium opacity-60 mb-1 block">New Password</label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="glass-input text-sm"
                minLength={6}
                autoComplete="new-password"
              />
            </div>

            <div>
              <label className="text-sm font-medium opacity-60 mb-1 block">Confirm New Password</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="glass-input text-sm"
                minLength={6}
                autoComplete="new-password"
              />
            </div>

            <button onClick={handleChangePassword} disabled={passwordSaving} className="glass-button w-full">
              {passwordSaving ? 'Updating Password...' : 'Change Password'}
            </button>

            {passwordMessage && (
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="text-sm text-center text-primary-400"
              >
                {passwordMessage}
              </motion.p>
            )}

            <div className="pt-4 border-t border-white/10">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-medium opacity-70">Blocked Users</h3>
                <span className="text-xs opacity-40">{blockedUsers.length}</span>
              </div>

              {loadingBlockedUsers ? (
                <p className="text-sm opacity-40">Loading blocked users...</p>
              ) : blockedUsers.length === 0 ? (
                <p className="text-sm opacity-40">No blocked users</p>
              ) : (
                <div className="space-y-2">
                  {blockedUsers.map((blockedUser) => (
                    <div key={blockedUser.user_id} className="flex items-center gap-3 p-3 glass rounded-xl">
                      <img
                        src={blockedUser.avatar_url || `https://api.dicebear.com/9.x/lorelei-neutral/svg?seed=${blockedUser.username}`}
                        alt={blockedUser.username}
                        className="w-10 h-10 rounded-xl"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{blockedUser.username}</p>
                        <p className="text-xs opacity-40">Blocked {formatDate(blockedUser.created_at)}</p>
                      </div>
                      <button
                        onClick={() => handleUnblockUser(blockedUser.user_id)}
                        className="px-3 py-1.5 text-xs rounded-lg hover:bg-white/10 text-primary-400"
                      >
                        Unblock
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'appearance' && (
          <div className="space-y-4">
            <p className="text-sm font-medium opacity-60">Theme</p>
            <div className="flex gap-3">
              <button
                onClick={() => { setTheme('dark'); updateSettings({ theme: 'dark' }); }}
                className={`flex-1 p-4 rounded-xl flex flex-col items-center gap-2 transition-all ${
                  settings.theme === 'dark' ? 'bg-primary-500/20 border border-primary-500/30' : 'glass hover:bg-white/10'
                }`}
              >
                <Moon className="w-6 h-6" />
                <span className="text-sm font-medium">Dark</span>
              </button>
              <button
                onClick={() => { setTheme('light'); updateSettings({ theme: 'light' }); }}
                className={`flex-1 p-4 rounded-xl flex flex-col items-center gap-2 transition-all ${
                  settings.theme === 'light' ? 'bg-primary-500/20 border border-primary-500/30' : 'glass hover:bg-white/10'
                }`}
              >
                <Sun className="w-6 h-6" />
                <span className="text-sm font-medium">Light</span>
              </button>
            </div>
          </div>
        )}

        {activeTab === 'notifications' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between p-4 glass rounded-xl">
              <div>
                <p className="font-medium text-sm">Push Notifications</p>
                <p className="text-xs opacity-40">Get notified about new messages</p>
              </div>
              <button
                onClick={() => updateSettings({ notifications_enabled: !settings.notifications_enabled })}
                className={`w-12 h-7 rounded-full transition-colors relative ${
                  settings.notifications_enabled ? 'bg-primary-500' : 'bg-gray-600'
                }`}
              >
                <div
                  className={`absolute top-1 w-5 h-5 rounded-full bg-white transition-transform ${
                    settings.notifications_enabled ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>
          </div>
        )}

        <AnimatePresence>
          {pendingAvatarChange && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4"
              onClick={() => setPendingAvatarChange(null)}
            >
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                onClick={(event) => event.stopPropagation()}
                className="glass-card w-full max-w-sm p-5 space-y-4"
              >
                <div>
                  <h3 className="text-lg font-semibold">{pendingAvatarChange.title}</h3>
                  <p className="text-sm opacity-70 mt-2">{pendingAvatarChange.description}</p>
                  <p className="text-xs opacity-50 mt-2">This replaces the previous profile picture in your account data.</p>
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={() => setPendingAvatarChange(null)}
                    className="flex-1 glass-button-secondary text-sm"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => void applyAvatarChange(pendingAvatarChange)}
                    className="flex-1 glass-button text-sm"
                  >
                    Confirm Change
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
