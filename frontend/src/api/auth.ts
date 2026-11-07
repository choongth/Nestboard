// Accounts and signing in (see server/README.md, "账号与登录"). The session
// lives in an httpOnly cookie the browser sends by itself.

import { request } from "./client";

export interface User {
  id: string;
  email: string;
  display_name: string;
  is_instance_admin: boolean;
  created_at: string;
}

export const authStatus = () => request<{ needs_setup: boolean }>("GET", "/auth/status");

/** The first account on a new Nestboard; it becomes the instance admin. */
export const setUp = (email: string, displayName: string, password: string) =>
  request<User>("POST", "/auth/setup", { email, display_name: displayName, password });

export const logIn = (email: string, password: string) =>
  request<User>("POST", "/auth/login", { email, password });

export const logOut = () => request<void>("POST", "/auth/logout");

/** Fails with status 401 when nobody is signed in. */
export const getMe = () => request<User>("GET", "/auth/me");

export interface PasswordResetPreview {
  email: string;
  display_name: string;
  expires_at: string;
}

export const previewPasswordReset = (token: string) =>
  request<PasswordResetPreview>("GET", `/password-resets/${encodeURIComponent(token)}`);

/** Sets the new password and signs this browser in. */
export const resetPassword = (token: string, newPassword: string) =>
  request<User>("POST", `/password-resets/${encodeURIComponent(token)}`, { new_password: newPassword });
