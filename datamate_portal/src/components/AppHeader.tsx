"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  BarChart3, Sparkles, Clock, Database, Menu, X, Bell, DollarSign,
} from "lucide-react";
import {
  getConnectedStatus,
  setConnectedStatus,
} from "@/lib/education-store";

type TabId = "sostenedores" | "perfiles" | "intelligence" | "milo" | "alertas" | "gna";

interface AppHeaderProps {
  activeTab: TabId;
  rightContent?: React.ReactNode;
}

const formatSyncAge = (ms: number) => {
  if (ms <= 0) return "ahora";
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `hace ${sec}s`;
  const min = Math.floor(sec / 60);
  return `hace ${min}m`;
};

const TABS: { id: TabId; label: string; href: string; icon?: React.ReactNode }[] = [
  { id: "sostenedores", label: "Datos", href: "/" },
  { id: "perfiles", label: "Perfiles Fiscales", href: "/sostenedor", icon: <Database className="w-3 sm:w-3.5 h-3 sm:h-3.5" /> },
  { id: "intelligence", label: "Inteligencia", href: "/intelligence", icon: <BarChart3 className="w-3 sm:w-3.5 h-3 sm:h-3.5" /> },
  { id: "milo", label: "EduBot", href: "/milo", icon: <Sparkles className="w-3 sm:w-3.5 h-3 sm:h-3.5" /> },
  { id: "alertas", label: "Alertas", href: "/alertas", icon: <Bell className="w-3 sm:w-3.5 h-3 sm:h-3.5" /> },
  { id: "gna", label: "GNA", href: "/gna", icon: <DollarSign className="w-3 sm:w-3.5 h-3 sm:h-3.5" /> },
];

export default function AppHeader({ activeTab, rightContent }: AppHeaderProps) {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [totalRegistros, setTotalRegistros] = useState(0);
  const [syncAge, setSyncAge] = useState(0);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Check Supabase connection
  useEffect(() => {
    if (getConnectedStatus() !== null) {
      setConnected(getConnectedStatus());
      return;
    }
    fetch("/api/pipeline/stats")
      .then((r) => r.json())
      .then((d) => { setConnected(!d.error); setConnectedStatus(!d.error); })
      .catch(() => { setConnected(false); setConnectedStatus(false); });
  }, []);

  // Poll status
  const checkStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/pipeline/stats");
      const status = await res.json();
      const total = status.totalRows || 0;
      if (total) setTotalRegistros(total);
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
        <div className="flex items-center gap-3 sm:gap-5">
          <span className="text-lg sm:text-xl font-bold text-[var(--accent)]">DataMate</span>
          <span className="text-[10px] sm:text-xs text-[var(--text-muted)] hidden sm:inline">Inteligencia Educativa</span>
          {/* Hamburger - mobile only */}
          <button onClick={() => setMobileMenuOpen(!mobileMenuOpen)} className="sm:hidden p-1 -ml-1 rounded-lg hover:bg-[var(--bg-secondary)]">
            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
          {/* Desktop nav */}
          <div className="hidden sm:contents">
            <div className="w-px h-8 bg-[var(--border)]" />
            {TABS.map((tab) => {
              const isActive = tab.id === activeTab;
              if (isActive) {
                return (
                  <span key={tab.id} className="flex items-center gap-1.5 text-sm font-semibold text-[var(--text)] border-b-2 border-[var(--accent)] pb-0.5">
                    {tab.icon && <span className="text-[var(--accent)]">{tab.icon}</span>}
                    {tab.label}
                  </span>
                );
              }
              return (
                <Link key={tab.id} href={tab.href} className="flex items-center gap-1.5 text-sm font-medium text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors pb-0.5">
                  {tab.icon}
                  {tab.label}
                </Link>
              );
            })}
          </div>
        </div>

        {/* Right: Status */}
        <div className="flex items-center gap-2 text-xs">
          {totalRegistros > 0 && (
            <span className="flex items-center gap-1.5 text-[var(--text-muted)]">
              <Database className="w-3 h-3" />
              <span className="hidden sm:inline">{totalRegistros.toLocaleString()} registros</span>
              {syncAge > 0 && (
                <>
                  <Clock className="w-3 h-3 ml-1" />
                  <span className="hidden sm:inline">{formatSyncAge(syncAge)}</span>
                </>
              )}
            </span>
          )}

          {totalRegistros > 0 && <div className="w-px h-4 bg-[var(--border)] mx-1" />}

          <span className={`w-2 h-2 rounded-full ${connected === true ? "bg-emerald-500 pulse-dot" : connected === false ? "bg-red-500" : "bg-amber-500"}`} />
          <span className="text-[var(--text-muted)] hidden sm:inline">
            {connected === true ? "Conectado" : connected === false ? "Desconectado" : "Conectando..."}
          </span>

          {rightContent && (
            <>
              <div className="w-px h-4 bg-[var(--border)] mx-1" />
              {rightContent}
            </>
          )}
        </div>
      </div>
      {/* Mobile nav dropdown */}
      {mobileMenuOpen && (
        <nav className="sm:hidden border-t border-[var(--border)] bg-white px-4 py-2 space-y-1">
          {TABS.map((tab) => {
            const isActive = tab.id === activeTab;
            return isActive ? (
              <span key={tab.id} className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-semibold bg-blue-50 text-[var(--accent)]">
                {tab.icon}{tab.label}
              </span>
            ) : (
              <Link key={tab.id} href={tab.href} onClick={() => setMobileMenuOpen(false)}
                className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium text-[var(--text-muted)] hover:bg-[var(--bg-secondary)] transition-colors">
                {tab.icon}{tab.label}
              </Link>
            );
          })}
        </nav>
      )}
    </header>
  );
}
