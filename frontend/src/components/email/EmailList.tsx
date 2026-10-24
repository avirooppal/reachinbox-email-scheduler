import React, { useState, useTransition } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { TopBar } from "../layout/TopBar";
import { EmailRow } from "./EmailRow";
import { EmailRowSkeleton } from "../ui/Skeleton";
import { EmptyState } from "../ui/EmptyState";
import { toast } from "sonner";

export interface EmailListProps {
  view: "scheduled" | "sent";
}

export const EmailList: React.FC<EmailListProps> = ({ view }) => {
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState("");
  const [filterStarred, setFilterStarred] = useState(false);
  const [page, setPage] = useState(1);
  const [, startTransition] = useTransition();

  const queryKey = ["emails", view, searchQuery, filterStarred, page];

  const {
    data,
    isLoading,
    isRefetching,
    refetch,
    isError,
    error
  } = useQuery({
    queryKey,
    queryFn: () =>
      api.emails.list({
        status: view,
        q: searchQuery || undefined,
        starred: filterStarred ? true : undefined,
        page,
        limit: 25
      }),
    staleTime: 2000,
    refetchInterval: 3000
  });

  const starMutation = useMutation({
    mutationFn: ({ id, isStarred }: { id: string; isStarred: boolean }) =>
      api.emails.toggleStar(id, isStarred),
    onMutate: async ({ id, isStarred }) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData(queryKey);

      queryClient.setQueryData(queryKey, (old: any) => {
        if (!old || !old.emails) return old;
        return {
          ...old,
          emails: old.emails.map((e: any) =>
            e.id === id ? { ...e, isStarred } : e
          )
        };
      });

      return { previous };
    },
    onError: (_err, _vars, context: any) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKey, context.previous);
      }
      toast.error("Failed to update star");
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["emails"] });
    }
  });

  const handleToggleStar = (id: string, currentStarred: boolean) => {
    starMutation.mutate({ id, isStarred: !currentStarred });
  };

  const handleSearchChange = (q: string) => {
    startTransition(() => {
      setSearchQuery(q);
      setPage(1);
    });
  };

  const emails = data?.emails || [];
  const total = data?.total || 0;
  const totalPages = data?.totalPages || 1;

  return (
    <div className="flex flex-col flex-1 w-full max-w-6xl mx-auto">
      {/* Top Search & Filter Bar */}
      <TopBar
        searchQuery={searchQuery}
        onSearchChange={handleSearchChange}
        onRefresh={() => refetch()}
        isRefreshing={isRefetching}
        filterStarred={filterStarred}
        onToggleFilterStarred={() => setFilterStarred(!filterStarred)}
        placeholder={view === "scheduled" ? "Search scheduled emails" : "Search sent emails"}
      />

      {/* Main Email List View */}
      <div className="flex-1 mt-2">
        {isLoading ? (
          <div className="flex flex-col">
            {Array.from({ length: 8 }).map((_, idx) => (
              <EmailRowSkeleton key={idx} />
            ))}
          </div>
        ) : isError ? (
          <div className="p-8 text-center text-sm text-[#DC2626]">
            Failed to load emails: {(error as Error).message}
          </div>
        ) : emails.length === 0 ? (
          <EmptyState
            title={
              searchQuery
                ? "No matching emails found"
                : view === "scheduled"
                ? "No scheduled emails"
                : "No sent emails yet"
            }
            description={
              searchQuery
                ? "Try adjusting your search terms or filters."
                : view === "scheduled"
                ? "You have no emails queued to send. Compose your first campaign!"
                : "Emails that have been successfully delivered will appear here."
            }
            actionText="Compose New Email"
            actionLink="/compose"
          />
        ) : (
          <div className="flex flex-col">
            {emails.map((email) => (
              <EmailRow
                key={email.id}
                email={email}
                view={view}
                onToggleStar={handleToggleStar}
              />
            ))}

            {/* Pagination Controls */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-3 py-4 mt-2 border-t border-[#F0F1F2] text-xs text-[#6B7280]">
                <span>
                  Showing {emails.length} of {total} emails
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={page <= 1}
                    onClick={() => setPage(page - 1)}
                    className="px-3 py-1 rounded-md border border-[#E5E7EB] disabled:opacity-40 hover:bg-[#F4F5F6] transition-colors"
                  >
                    Previous
                  </button>
                  <span className="tabular-nums">
                    Page {page} of {totalPages}
                  </span>
                  <button
                    type="button"
                    disabled={page >= totalPages}
                    onClick={() => setPage(page + 1)}
                    className="px-3 py-1 rounded-md border border-[#E5E7EB] disabled:opacity-40 hover:bg-[#F4F5F6] transition-colors"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
