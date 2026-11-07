// For the instance admin only (see server/README.md, "实例管理员").

import type { User } from "./auth";
import { request } from "./client";

export interface UserPage {
  items: User[];
  total: number;
  limit: number;
  offset: number;
}

/** Every account on the instance, by email. */
export const listUsers = (limit = 200, offset = 0) =>
  request<UserPage>("GET", `/admin/users?limit=${limit}&offset=${offset}`);

/** A one-off link to set a new password: /reset-password/<token>. Older unused links stop working. */
export const createPasswordReset = (userId: string, expiresInHours = 24) =>
  request<{ user: User; expires_at: string; token: string }>(
    "POST",
    `/admin/users/${encodeURIComponent(userId)}/password-resets`,
    { expires_in_hours: expiresInHours },
  );
