import type { CSSProperties } from "react";

interface IconProps {
  size?: number;
  style?: CSSProperties;
}

const base = (size: number, style?: CSSProperties) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  style,
});

export const IconDashboard = ({ size = 18, style }: IconProps) => (
  <svg {...base(size, style)}><rect x="3" y="3" width="7" height="9" /><rect x="14" y="3" width="7" height="5" /><rect x="14" y="12" width="7" height="9" /><rect x="3" y="16" width="7" height="5" /></svg>
);
export const IconCases = ({ size = 18, style }: IconProps) => (
  <svg {...base(size, style)}><path d="M4 4h12l4 4v12H4z" /><path d="M16 4v4h4" /><path d="M8 13h8M8 17h5" /></svg>
);
export const IconInvestigators = ({ size = 18, style }: IconProps) => (
  <svg {...base(size, style)}><circle cx="9" cy="8" r="3" /><path d="M3 20a6 6 0 0 1 12 0" /><path d="M16 6a3 3 0 0 1 0 6M18 20a6 6 0 0 0-3-5" /></svg>
);
export const IconAssignments = ({ size = 18, style }: IconProps) => (
  <svg {...base(size, style)}><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M9 12l2 2 4-4" /></svg>
);
export const IconOps = ({ size = 18, style }: IconProps) => (
  <svg {...base(size, style)}><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M9 7h6M9 11h6M9 15h4" /></svg>
);
export const IconAlerts = ({ size = 18, style }: IconProps) => (
  <svg {...base(size, style)}><path d="M12 3l9 16H3z" /><path d="M12 10v4M12 17h.01" /></svg>
);
export const IconReports = ({ size = 18, style }: IconProps) => (
  <svg {...base(size, style)}><path d="M5 21V8M12 21V3M19 21v-7" /></svg>
);
export const IconSettings = ({ size = 18, style }: IconProps) => (
  <svg {...base(size, style)}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2 2 2 0 1 1-4 0 1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0-1.2-2.9 2 2 0 1 1 0-4 1.7 1.7 0 0 0 1.2-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 2.9-1.2 2 2 0 1 1 4 0 1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0 1.2 2.9 2 2 0 1 1 0 4 1.7 1.7 0 0 0-1.4.9z" /></svg>
);
export const IconAudit = ({ size = 18, style }: IconProps) => (
  <svg {...base(size, style)}><path d="M9 3h6l5 5v13H4V3z" /><path d="M9 13l2 2 4-4" /></svg>
);

// Metric icons
export const IconFolderOpen = ({ size = 18, style }: IconProps) => (
  <svg {...base(size, style)}><path d="M3 7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v1H7l-2 9" /><path d="M3 7l2 12h13l2-8H7" /></svg>
);
export const IconFolderCheck = ({ size = 18, style }: IconProps) => (
  <svg {...base(size, style)}><path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><path d="M9 13l2 2 4-4" /></svg>
);
export const IconCuffs = ({ size = 18, style }: IconProps) => (
  <svg {...base(size, style)}><circle cx="7" cy="15" r="4" /><circle cx="17" cy="15" r="4" /><path d="M7 11V7a2 2 0 0 1 4 0M17 11V7a2 2 0 0 0-4 0" /></svg>
);
export const IconWarrant = ({ size = 18, style }: IconProps) => (
  <svg {...base(size, style)}><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M9 8h6M9 12h6M9 16h3" /></svg>
);
export const IconMoney = ({ size = 18, style }: IconProps) => (
  <svg {...base(size, style)}><circle cx="12" cy="12" r="9" /><path d="M12 7v10M9.5 9.5a2.5 2 0 0 1 5 0c0 2.5-5 1.5-5 4a2.5 2 0 0 0 5 0" /></svg>
);
export const IconGun = ({ size = 18, style }: IconProps) => (
  <svg {...base(size, style)}><path d="M4 8h13l3 3-3 1h-3l-2 4H9l1-4H4z" /><path d="M7 12v3" /></svg>
);
export const IconTransfer = ({ size = 18, style }: IconProps) => (
  <svg {...base(size, style)}><path d="M4 8h13l-3-3M20 16H7l3 3" /></svg>
);

// misc
export const IconChevron = ({ size = 16, style }: IconProps) => (
  <svg {...base(size, style)}><path d="M6 9l6 6 6-6" /></svg>
);
export const IconRefresh = ({ size = 14, style }: IconProps) => (
  <svg {...base(size, style)}><path d="M20 11a8 8 0 1 0-2 5.7" /><path d="M20 5v5h-5" /></svg>
);
export const IconCalendar = ({ size = 18, style }: IconProps) => (
  <svg {...base(size, style)}><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 9h18M8 3v4M16 3v4" /></svg>
);
export const IconCheckShield = ({ size = 16, style }: IconProps) => (
  <svg {...base(size, style)}><path d="M12 3l8 3v5c0 5-3.5 8-8 10-4.5-2-8-5-8-10V6z" /><path d="M9 12l2 2 4-4" /></svg>
);
export const IconUserAlert = ({ size = 18, style }: IconProps) => (
  <svg {...base(size, style)}><circle cx="9" cy="8" r="3" /><path d="M3 20a6 6 0 0 1 12 0" /><path d="M19 7v4M19 14h.01" /></svg>
);
export const IconClock = ({ size = 18, style }: IconProps) => (
  <svg {...base(size, style)}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
);
export const IconBarChart = ({ size = 18, style }: IconProps) => (
  <svg {...base(size, style)}><path d="M5 21V10M12 21V4M19 21v-7" /></svg>
);
export const IconPie = ({ size = 18, style }: IconProps) => (
  <svg {...base(size, style)}><path d="M12 3v9h9" /><circle cx="12" cy="12" r="9" /></svg>
);
