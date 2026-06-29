import { getNotifications, addNotification, markNotificationRead, markAllNotificationsRead } from "./firebaseService";

export type NotifType = "leave" | "attendance" | "goal" | "system" | "payroll";

export interface AppNotification {
  id: string;
  userId: string;
  type: NotifType;
  title: string;
  message: string;
  read: boolean;
  createdAt: string;
}

export async function getForUser(userId: string): Promise<AppNotification[]> {
  const docs = await getNotifications(userId);
  return docs.map((d) => ({
    id:        d.id as string,
    userId:    d.userId as string,
    type:      d.type as NotifType,
    title:     d.title as string,
    message:   d.message as string,
    read:      (d.read ?? false) as boolean,
    createdAt: d.createdAt as string,
  })).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function create(notif: Omit<AppNotification, "id" | "read" | "createdAt">): Promise<AppNotification> {
  const createdAt = new Date().toISOString();
  const id = await addNotification({ ...notif, read: false, createdAt });
  return { id, ...notif, read: false, createdAt };
}

export async function markRead(id: string): Promise<boolean> {
  try { await markNotificationRead(id); return true; } catch { return false; }
}

export async function markAllRead(userId: string): Promise<void> {
  await markAllNotificationsRead(userId);
}
