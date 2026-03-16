"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  BarChart3, Sparkles, Globe, Clock, Database,
} from "lucide-react";
import {
  getConnectedStatus,
  setConnectedStatus,
} from "@/lib/pipeline-store";

type TabId = "pipeline" | "intelligence" | "market" | "milo";

interface AppHeaderProps {
  activeTab: TabId;
  rightContent?: React.ReactNode;
}

const formatSyncAge = (ms: number) => {
  if (ms <= 0) return "just now";
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  return `${min}m ago`;
};

const TABS: { id: TabId; label: string; href: string; icon?: React.ReactNode }[] = [
  { id: "pipeline", label: "Pipeline", href: "/" },
  { id: "intelligence", label: "Intelligence", href: "/intelligence", icon: <BarChart3 className="w-3 sm:w-3.5 h-3 sm:h-3.5" /> },
  { id: "market", label: "Market", href: "/market", icon: <Globe className="w-3 sm:w-3.5 h-3 sm:h-3.5" /> },
  { id: "milo", label: "Milo AI", href: "/milo", icon: <Sparkles className="w-3 sm:w-3.5 h-3 sm:h-3.5" /> },
];

export default function AppHeader({ activeTab, rightContent }: AppHeaderProps) {
  const [connected, setConnected] = useState<boolean | null>(() => getConnectedStatus());
  const [totalLoans, setTotalLoans] = useState(0);
  const [syncAge, setSyncAge] = useState(0);

  // Check connection status
  useEffect(() => {
    if (getConnectedStatus() !== null) {
      setConnected(getConnectedStatus());
      return;
    }
    fetch("/api/auth/test")
      .then((r) => r.json())
      .then((d) => { setConnected(d.success); setConnectedStatus(d.success); })
      .catch(() => { setConnected(false); setConnectedStatus(false); });
  }, []);

  // Poll sync status from Supabase (via API)
  const checkStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/pipeline/stats");
      const status = await res.json();
      const total = status.totalRows || 0;
      if (total) setTotalLoans(total);
      if (status.lastRefresh) {
        setSyncAge(Date.now() - new Date(status.lastRefresh).getTime());
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    checkStatus();
    const interval = setInterval(checkStatus, 30000);
    return () => clearInterval(interval);
  }, [checkStatus]);

  return (
    <header className="border-b border-[var(--border)] bg-white sticky top-0 z-50">
      <div className="max-w-[1600px] mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
        {/* Left: Logo + Nav */}
        <div className="flex items-center gap-4 sm:gap-5">
          <Image src="/logo.png" alt="Premier Lending" width={180} height={40} className="h-7 sm:h-9 w-auto" priority />
          <div className="w-px h-6 sm:h-8 bg-[var(--border)]" />
          {TABS.map((tab) => {
            const isActive = tab.id === activeTab;
            if (isActive) {
              return (
                <span key={tab.id} className="flex items-center gap-1 sm:gap-1.5 text-xs sm:text-sm font-semibold text-[var(--text)] border-b-2 border-[var(--accent)] pb-0.5">
                  {tab.icon && <span className="text-[var(--accent)]">{tab.icon}</span>}
                  {tab.label}
                </span>
              );
            }
            return (
              <Link
                key={tab.id}
                href={tab.href}
                className="flex items-center gap-1 sm:gap-1.5 text-xs sm:text-sm font-medium text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors pb-0.5"
              >
                {tab.icon}
                {tab.label}
              </Link>
            );
          })}
        </div>

        {/* Right: Sync status + Connection + Page actions */}
        <div className="flex items-center gap-2 text-xs">
          {/* Pipeline status */}
          {totalLoans > 0 && (
            <span className="flex items-center gap-1.5 text-[var(--text-muted)]">
              <Database className="w-3 h-3" />
              <span className="hidden sm:inline">{totalLoans.toLocaleString()} loans</span>
              {syncAge > 0 && (
                <>
                  <Clock className="w-3 h-3 ml-1" />
                  <span className="hidden sm:inline">Synced {formatSyncAge(syncAge)}</span>
                </>
              )}
            </span>
          )}

          {/* Separator */}
          {totalLoans > 0 && <div className="w-px h-4 bg-[var(--border)] mx-1" />}

          {/* Connection dot */}
          <span className={`w-2 h-2 rounded-full ${connected === true ? "bg-emerald-500 pulse-dot" : connected === false ? "bg-red-500" : "bg-amber-500"}`} />
          <span className="text-[var(--text-muted)] hidden sm:inline">
            {connected === true ? "Connected" : connected === false ? "Disconnected" : "Connecting..."}
          </span>

          {/* Page-specific right content */}
          {rightContent && (
            <>
              <div className="w-px h-4 bg-[var(--border)] mx-1" />
              {rightContent}
            </>
          )}
        </div>
      </div>
    </header>
  );
}
