"use client";

import { useEffect, useState } from "react";
import {
  User,
  Mail,
  Calendar,
  Shield,
  Edit2,
  Key,
  Save,
  X,
  Loader2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  getUserProfile,
  updateUserProfile,
  changePassword,
} from "@/lib/api/user";
import type { UserProfile } from "@/lib/api/user";
import { useAuthStore } from "@/stores/auth";

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
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [profileError, setProfileError] = useState("");
  const [profileSaving, setProfileSaving] = useState(false);

  // Password change state
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordSuccess, setPasswordSuccess] = useState(false);

  useEffect(() => {
    if (open && token) {
      setLoading(true);
      getUserProfile(token)
        .then((data) => {
          setProfile(data);
          setUsername(data.username || "");
          setEmail(data.email);
        })
        .catch((error) => console.error("Failed to load profile:", error))
        .finally(() => setLoading(false));
    }
  }, [open, token]);

  const handleProfileUpdate = async () => {
    if (!token || !profile) return;

    setProfileError("");
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
      setProfileError(
        err instanceof Error ? err.message : "Failed to update profile",
      );
    } finally {
      setProfileSaving(false);
    }
  };

  const handlePasswordChange = async () => {
    if (!token) return;

    setPasswordError("");
    setPasswordSuccess(false);

    if (newPassword !== confirmPassword) {
      setPasswordError("Passwords do not match");
      return;
    }

    if (newPassword.length < 8) {
      setPasswordError("Password must be at least 8 characters");
      return;
    }

    setPasswordSaving(true);

    try {
      await changePassword({ currentPassword, newPassword }, token);
      setPasswordSuccess(true);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");

      // Close password change mode after 2 seconds
      setTimeout(() => {
        setChangePasswordMode(false);
        setPasswordSuccess(false);
      }, 2000);
    } catch (err) {
      setPasswordError(
        err instanceof Error ? err.message : "Failed to change password",
      );
    } finally {
      setPasswordSaving(false);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  const handleCancel = () => {
    if (profile) {
      setUsername(profile.username || "");
      setEmail(profile.email);
    }
    setEditMode(false);
    setProfileError("");
  };

  const handlePasswordCancel = () => {
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setPasswordError("");
    setPasswordSuccess(false);
    setChangePasswordMode(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} data-oid="lwu:165">
      <DialogContent
        className="max-w-2xl max-h-[85vh] overflow-y-auto"
        data-oid="5s7l-h_"
      >
        <DialogHeader data-oid="h1j-20c">
          <DialogTitle className="flex items-center gap-2" data-oid="u-dbgyp">
            <User className="h-5 w-5" data-oid=":xaiijx" />
            Profile
          </DialogTitle>
          <DialogDescription data-oid="pns0p:5">
            View and manage your account information
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex justify-center py-8" data-oid="qt2upp1">
            <Loader2
              className="h-8 w-8 animate-spin text-muted-foreground"
              data-oid=":-fr1zw"
            />
          </div>
        ) : profile ? (
          <div className="space-y-6" data-oid="mv6gxoi">
            {/* Profile Information */}
            <section className="space-y-4" data-oid="xrfxp3r">
              <div
                className="flex items-center justify-between"
                data-oid="jn4os0u"
              >
                <h3 className="text-sm font-semibold" data-oid="uqchcip">
                  Account Information
                </h3>
                {!editMode && !changePasswordMode && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setEditMode(true)}
                    data-oid=":2enopl"
                  >
                    <Edit2 className="mr-2 h-4 w-4" data-oid="cwer3zu" />
                    Edit Profile
                  </Button>
                )}
              </div>

              {profileError && (
                <div
                  className="rounded-md bg-destructive/10 p-3 text-sm text-destructive"
                  data-oid="xrtcpdo"
                >
                  {profileError}
                </div>
              )}

              <div
                className="grid gap-4 rounded-lg border bg-muted/40 p-4"
                data-oid="yumhcu1"
              >
                <div className="grid gap-2" data-oid="q5ioyc1">
                  <Label
                    htmlFor="username"
                    className="flex items-center gap-2 text-xs text-muted-foreground"
                    data-oid="t6qk3hd"
                  >
                    <User className="h-3 w-3" data-oid="45kf_ve" />
                    Username
                  </Label>
                  {editMode ? (
                    <Input
                      id="username"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      placeholder="Enter username"
                      data-oid="m3nz67z"
                    />
                  ) : (
                    <p className="text-sm font-medium" data-oid=":yr.-yv">
                      {profile.username || "Not set"}
                    </p>
                  )}
                </div>

                <div className="grid gap-2" data-oid="o-l4-t4">
                  <Label
                    htmlFor="email"
                    className="flex items-center gap-2 text-xs text-muted-foreground"
                    data-oid="-tl5pa5"
                  >
                    <Mail className="h-3 w-3" data-oid="mt77j8x" />
                    Email
                  </Label>
                  {editMode ? (
                    <Input
                      id="email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="Enter email"
                      data-oid="zhq30oz"
                    />
                  ) : (
                    <p className="text-sm font-medium" data-oid="h8u:a23">
                      {profile.email}
                    </p>
                  )}
                </div>

                <div className="grid gap-2" data-oid="zzyzmaq">
                  <Label
                    className="flex items-center gap-2 text-xs text-muted-foreground"
                    data-oid="m.d30ms"
                  >
                    <Calendar className="h-3 w-3" data-oid="h28vvc2" />
                    Member Since
                  </Label>
                  <p className="text-sm font-medium" data-oid="_g_2rgc">
                    {formatDate(profile.createdAt)}
                  </p>
                </div>

                {profile.isAdmin && (
                  <div className="grid gap-2" data-oid="-9zbamz">
                    <Label
                      className="flex items-center gap-2 text-xs text-muted-foreground"
                      data-oid="rf-cg9f"
                    >
                      <Shield className="h-3 w-3" data-oid="e8ivvle" />
                      Role
                    </Label>
                    <div className="flex items-center gap-2" data-oid="cxeb:-u">
                      <span
                        className="inline-flex items-center rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary"
                        data-oid="v-qz09w"
                      >
                        Administrator
                      </span>
                    </div>
                  </div>
                )}
              </div>

              {editMode && (
                <div className="flex gap-2" data-oid="amf.z93">
                  <Button
                    onClick={handleProfileUpdate}
                    disabled={profileSaving}
                    size="sm"
                    data-oid="_c3txmu"
                  >
                    {profileSaving ? (
                      <>
                        <Loader2
                          className="mr-2 h-4 w-4 animate-spin"
                          data-oid="hu2m-xm"
                        />
                        Saving...
                      </>
                    ) : (
                      <>
                        <Save className="mr-2 h-4 w-4" data-oid="8tvmhyk" />
                        Save Changes
                      </>
                    )}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={handleCancel}
                    disabled={profileSaving}
                    size="sm"
                    data-oid="kpgz93t"
                  >
                    <X className="mr-2 h-4 w-4" data-oid="z6_m9j_" />
                    Cancel
                  </Button>
                </div>
              )}
            </section>

            {!editMode && (
              <>
                <Separator data-oid="vbk758s" />

                {/* Password Change */}
                <section className="space-y-4" data-oid="9k.a_72">
                  <div
                    className="flex items-center justify-between"
                    data-oid="kt6umo-"
                  >
                    <div data-oid="onfv2rn">
                      <h3 className="text-sm font-semibold" data-oid="76lb2bf">
                        Password
                      </h3>
                      <p
                        className="text-xs text-muted-foreground"
                        data-oid="0x7z3el"
                      >
                        Change your password to keep your account secure
                      </p>
                    </div>
                    {!changePasswordMode && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setChangePasswordMode(true)}
                        data-oid="lc45xd6"
                      >
                        <Key className="mr-2 h-4 w-4" data-oid="5_gkowl" />
                        Change Password
                      </Button>
                    )}
                  </div>

                  {changePasswordMode && (
                    <div
                      className="space-y-4 rounded-lg border bg-muted/40 p-4"
                      data-oid="x7wysez"
                    >
                      {passwordError && (
                        <div
                          className="rounded-md bg-destructive/10 p-3 text-sm text-destructive"
                          data-oid="pr9d1-r"
                        >
                          {passwordError}
                        </div>
                      )}

                      {passwordSuccess && (
                        <div
                          className="rounded-md bg-green-500/10 p-3 text-sm text-green-600 dark:text-green-400"
                          data-oid="ikum24y"
                        >
                          Password changed successfully!
                        </div>
                      )}

                      <div className="grid gap-2" data-oid="bnl9huc">
                        <Label htmlFor="current-password" data-oid="prbh48d">
                          Current Password
                        </Label>
                        <Input
                          id="current-password"
                          type="password"
                          value={currentPassword}
                          onChange={(e) => setCurrentPassword(e.target.value)}
                          placeholder="Enter current password"
                          data-oid="4gi1eih"
                        />
                      </div>

                      <div className="grid gap-2" data-oid="klj4mte">
                        <Label htmlFor="new-password" data-oid="_hr.td-">
                          New Password
                        </Label>
                        <Input
                          id="new-password"
                          type="password"
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          placeholder="Enter new password (min 8 characters)"
                          data-oid="d9jmc9a"
                        />
                      </div>

                      <div className="grid gap-2" data-oid="6p79mhr">
                        <Label htmlFor="confirm-password" data-oid="buw6-j.">
                          Confirm New Password
                        </Label>
                        <Input
                          id="confirm-password"
                          type="password"
                          value={confirmPassword}
                          onChange={(e) => setConfirmPassword(e.target.value)}
                          placeholder="Confirm new password"
                          data-oid="u3i3l8j"
                        />
                      </div>

                      <div className="flex gap-2" data-oid="p0qyk6_">
                        <Button
                          onClick={handlePasswordChange}
                          disabled={
                            passwordSaving ||
                            !currentPassword ||
                            !newPassword ||
                            !confirmPassword
                          }
                          size="sm"
                          data-oid="rxjvzg7"
                        >
                          {passwordSaving ? (
                            <>
                              <Loader2
                                className="mr-2 h-4 w-4 animate-spin"
                                data-oid="al5ed6l"
                              />
                              Changing...
                            </>
                          ) : (
                            <>
                              <Save
                                className="mr-2 h-4 w-4"
                                data-oid="reuub9j"
                              />
                              Change Password
                            </>
                          )}
                        </Button>
                        <Button
                          variant="outline"
                          onClick={handlePasswordCancel}
                          disabled={passwordSaving}
                          size="sm"
                          data-oid="ab690ii"
                        >
                          <X className="mr-2 h-4 w-4" data-oid="qih0nrb" />
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

        <DialogFooter data-oid="uksrmnq">
          <Button
            variant="secondary"
            onClick={() => onOpenChange(false)}
            data-oid="bd-a6_2"
          >
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
