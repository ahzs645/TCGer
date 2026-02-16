'use client';

import { useEffect, useState } from 'react';
import {
  User,
  Mail,
  Calendar,
  Shield,
  Edit2,
  Key,
  Save,
  X,
  Loader2
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { getUserProfile, updateUserProfile, changePassword } from '@/lib/api/user';
import type { UserProfile } from '@/lib/api/user';
import { useAuthStore } from '@/stores/auth';

interface ProfileDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ProfileDialog({ open, onOpenChange }: ProfileDialogProps) {
  const { user, token, setAuth } = useAuthStore();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [changePasswordMode, setChangePasswordMode] = useState(false);

  // Profile edit state
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [profileError, setProfileError] = useState('');
  const [profileSaving, setProfileSaving] = useState(false);

  // Password change state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordSuccess, setPasswordSuccess] = useState(false);

  useEffect(() => {
    if (open && token) {
      setLoading(true);
      getUserProfile(token)
        .then((data) => {
          setProfile(data);
          setUsername(data.username || '');
          setEmail(data.email);
        })
        .catch((error) => console.error('Failed to load profile:', error))
        .finally(() => setLoading(false));
    }
  }, [open, token]);

  const handleProfileUpdate = async () => {
    if (!token || !profile) return;

    setProfileError('');
    setProfileSaving(true);

    try {
      const updates: { username?: string; email?: string } = {};

      if (username !== profile.username) {
        updates.username = username;
      }

      if (email !== profile.email) {
        updates.email = email;
      }

      if (Object.keys(updates).length === 0) {
        setEditMode(false);
        setProfileSaving(false);
        return;
      }

      const updatedUser = await updateUserProfile(updates, token);

      // Preserve fields that profile endpoint does not return (enabled game flags).
      if (user) {
        setAuth({ ...user, ...updatedUser }, token);
      }

      // Update local profile state
      setProfile({ ...profile, ...updatedUser });
      setEditMode(false);
    } catch (err) {
      setProfileError(err instanceof Error ? err.message : 'Failed to update profile');
    } finally {
      setProfileSaving(false);
    }
  };

  const handlePasswordChange = async () => {
    if (!token) return;

    setPasswordError('');
    setPasswordSuccess(false);

    if (newPassword !== confirmPassword) {
      setPasswordError('Passwords do not match');
      return;
    }

    if (newPassword.length < 8) {
      setPasswordError('Password must be at least 8 characters');
      return;
    }

    setPasswordSaving(true);

    try {
      await changePassword({ currentPassword, newPassword }, token);
      setPasswordSuccess(true);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');

      // Close password change mode after 2 seconds
      setTimeout(() => {
        setChangePasswordMode(false);
        setPasswordSuccess(false);
      }, 2000);
    } catch (err) {
      setPasswordError(err instanceof Error ? err.message : 'Failed to change password');
    } finally {
      setPasswordSaving(false);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };

  const handleCancel = () => {
    if (profile) {
      setUsername(profile.username || '');
      setEmail(profile.email);
    }
    setEditMode(false);
    setProfileError('');
  };

  const handlePasswordCancel = () => {
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setPasswordError('');
    setPasswordSuccess(false);
    setChangePasswordMode(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <User className="h-5 w-5" />
            Profile
          </DialogTitle>
          <DialogDescription>
            View and manage your account information
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : profile ? (
          <div className="space-y-6">
            {/* Profile Information */}
            <section className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">Account Information</h3>
                {!editMode && !changePasswordMode && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setEditMode(true)}
                  >
                    <Edit2 className="mr-2 h-4 w-4" />
                    Edit Profile
                  </Button>
                )}
              </div>

              {profileError && (
                <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                  {profileError}
                </div>
              )}

              <div className="grid gap-4 rounded-lg border bg-muted/40 p-4">
                <div className="grid gap-2">
                  <Label htmlFor="username" className="flex items-center gap-2 text-xs text-muted-foreground">
                    <User className="h-3 w-3" />
                    Username
                  </Label>
                  {editMode ? (
                    <Input
                      id="username"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      placeholder="Enter username"
                    />
                  ) : (
                    <p className="text-sm font-medium">
                      {profile.username || 'Not set'}
                    </p>
                  )}
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="email" className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Mail className="h-3 w-3" />
                    Email
                  </Label>
                  {editMode ? (
                    <Input
                      id="email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="Enter email"
                    />
                  ) : (
                    <p className="text-sm font-medium">{profile.email}</p>
                  )}
                </div>

                <div className="grid gap-2">
                  <Label className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Calendar className="h-3 w-3" />
                    Member Since
                  </Label>
                  <p className="text-sm font-medium">
                    {formatDate(profile.createdAt)}
                  </p>
                </div>

                {profile.isAdmin && (
                  <div className="grid gap-2">
                    <Label className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Shield className="h-3 w-3" />
                      Role
                    </Label>
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
                        Administrator
                      </span>
                    </div>
                  </div>
                )}
              </div>

              {editMode && (
                <div className="flex gap-2">
                  <Button
                    onClick={handleProfileUpdate}
                    disabled={profileSaving}
                    size="sm"
                  >
                    {profileSaving ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      <>
                        <Save className="mr-2 h-4 w-4" />
                        Save Changes
                      </>
                    )}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={handleCancel}
                    disabled={profileSaving}
                    size="sm"
                  >
                    <X className="mr-2 h-4 w-4" />
                    Cancel
                  </Button>
                </div>
              )}
            </section>

            {!editMode && (
              <>
                <Separator />

                {/* Password Change */}
                <section className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-semibold">Password</h3>
                      <p className="text-xs text-muted-foreground">
                        Change your password to keep your account secure
                      </p>
                    </div>
                    {!changePasswordMode && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setChangePasswordMode(true)}
                      >
                        <Key className="mr-2 h-4 w-4" />
                        Change Password
                      </Button>
                    )}
                  </div>

                  {changePasswordMode && (
                    <div className="space-y-4 rounded-lg border bg-muted/40 p-4">
                      {passwordError && (
                        <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                          {passwordError}
                        </div>
                      )}

                      {passwordSuccess && (
                        <div className="rounded-md bg-green-500/10 p-3 text-sm text-green-600 dark:text-green-400">
                          Password changed successfully!
                        </div>
                      )}

                      <div className="grid gap-2">
                        <Label htmlFor="current-password">Current Password</Label>
                        <Input
                          id="current-password"
                          type="password"
                          value={currentPassword}
                          onChange={(e) => setCurrentPassword(e.target.value)}
                          placeholder="Enter current password"
                        />
                      </div>

                      <div className="grid gap-2">
                        <Label htmlFor="new-password">New Password</Label>
                        <Input
                          id="new-password"
                          type="password"
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          placeholder="Enter new password (min 8 characters)"
                        />
                      </div>

                      <div className="grid gap-2">
                        <Label htmlFor="confirm-password">Confirm New Password</Label>
                        <Input
                          id="confirm-password"
                          type="password"
                          value={confirmPassword}
                          onChange={(e) => setConfirmPassword(e.target.value)}
                          placeholder="Confirm new password"
                        />
                      </div>

                      <div className="flex gap-2">
                        <Button
                          onClick={handlePasswordChange}
                          disabled={passwordSaving || !currentPassword || !newPassword || !confirmPassword}
                          size="sm"
                        >
                          {passwordSaving ? (
                            <>
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              Changing...
                            </>
                          ) : (
                            <>
                              <Save className="mr-2 h-4 w-4" />
                              Change Password
                            </>
                          )}
                        </Button>
                        <Button
                          variant="outline"
                          onClick={handlePasswordCancel}
                          disabled={passwordSaving}
                          size="sm"
                        >
                          <X className="mr-2 h-4 w-4" />
                          Cancel
                        </Button>
                      </div>
                    </div>
                  )}
                </section>
              </>
            )}
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
