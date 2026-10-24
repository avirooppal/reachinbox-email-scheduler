import React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api } from "../../lib/api";
import { Sidebar } from "./Sidebar";
import { EmailCounts } from "../../types";

export interface AppShellProps {
  children: React.ReactNode;
}

export const AppShell: React.FC<AppShellProps> = ({ children }) => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: authData } = useQuery({
    queryKey: ["auth", "me"],
    queryFn: api.auth.me,
    staleTime: 5 * 60 * 1000,
    retry: false
  });

  const { data: countsData } = useQuery<EmailCounts>({
    queryKey: ["emails", "counts"],
    queryFn: api.emails.counts,
    refetchInterval: 10000,
    initialData: { scheduled: 0, sent: 0 }
  });

  const handleLogout = async () => {
    try {
      await api.auth.logout();
    } catch {}
    queryClient.clear();
    navigate("/login");
  };

  const user = authData?.user || null;
  const counts = countsData || { scheduled: 0, sent: 0 };

  return (
    <div className="flex min-h-screen bg-white text-[#111827]">
      <Sidebar user={user} counts={counts} onLogout={handleLogout} />
      <main className="flex-1 min-w-0 border-l border-[#F0F1F2] px-6 py-4 flex flex-col">
        {children}
      </main>
    </div>
  );
};
