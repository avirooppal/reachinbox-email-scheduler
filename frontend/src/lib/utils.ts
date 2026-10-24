import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { format, isToday, isYesterday, differenceInDays } from "date-fns";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Format scheduled time badge according to spec:
 * "Tue 9:15:12 AM" (EEE h:mm:ss a)
 * For dates > 6 days away: "MMM d, h:mm:ss a"
 */
export function formatScheduledBadge(date: string | Date): string {
  const d = typeof date === "string" ? new Date(date) : date;
  if (isNaN(d.getTime())) return "";

  const diffDays = Math.abs(differenceInDays(d, new Date()));
  if (diffDays > 6) {
    return format(d, "MMM d, h:mm:ss a");
  }
  return format(d, "EEE h:mm:ss a");
}

/**
 * Format sent time stamp according to spec:
 * Today: "10:23 AM"
 * Yesterday: "Yesterday"
 * Past: "Nov 3, 10:23 AM"
 */
export function formatSentTimestamp(date: string | Date): string {
  const d = typeof date === "string" ? new Date(date) : date;
  if (isNaN(d.getTime())) return "";

  if (isToday(d)) {
    return format(d, "h:mm a");
  }
  if (isYesterday(d)) {
    return `Yesterday, ${format(d, "h:mm a")}`;
  }
  return format(d, "MMM d, h:mm a");
}

/**
 * Format bytes to readable size (e.g. 1.2 MB)
 */
export function formatBytes(bytes: number, decimals = 1): string {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}
