import React from "react";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { api } from "./lib/api";
import { LoginPage } from "./components/auth/LoginPage";
import { AppShell } from "./components/layout/AppShell";
import { EmailList } from "./components/email/EmailList";
import { ComposePage } from "./components/compose/ComposePage";
import { EmailDetail } from "./components/email/EmailDetail";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1
    }
  }
});

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const { data, isLoading } = useQuery({
    queryKey: ["auth", "me"],
    queryFn: api.auth.me,
    staleTime: 5 * 60 * 1000,
    retry: false
  });

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white text-xs text-[#6B7280]">
        Loading session...
      </div>
    );
  }

  if (!data?.user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <>{children}</>;
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />

          {/* Protected Main Views */}
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <AppShell>
                  <EmailList view="scheduled" />
                </AppShell>
              </ProtectedRoute>
            }
          />

          <Route
            path="/scheduled"
            element={
              <ProtectedRoute>
                <AppShell>
                  <EmailList view="scheduled" />
                </AppShell>
              </ProtectedRoute>
            }
          />

          <Route
            path="/sent"
            element={
              <ProtectedRoute>
                <AppShell>
                  <EmailList view="sent" />
                </AppShell>
              </ProtectedRoute>
            }
          />

          <Route
            path="/compose"
            element={
              <ProtectedRoute>
                <AppShell>
                  <ComposePage />
                </AppShell>
              </ProtectedRoute>
            }
          />

          <Route
            path="/emails/:id"
            element={
              <ProtectedRoute>
                <AppShell>
                  <EmailDetail />
                </AppShell>
              </ProtectedRoute>
            }
          />

          <Route path="/dashboard" element={<Navigate to="/scheduled" replace />} />
          <Route path="*" element={<Navigate to="/scheduled" replace />} />
        </Routes>
      </BrowserRouter>
      <Toaster position="bottom-right" richColors />
    </QueryClientProvider>
  );
}

export default App;
