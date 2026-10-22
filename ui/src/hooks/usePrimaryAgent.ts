import { useQuery } from "@tanstack/react-query";
import { authApi } from "@/api/auth";
import { primaryAgentApi } from "@/api/primaryAgent";
import { ApiError } from "@/api/client";
import { queryKeys } from "@/lib/queryKeys";

export function usePrimaryAgent(companyId: string | null | undefined) {
  const session = useQuery({ queryKey: queryKeys.auth.session, queryFn: () => authApi.getSession() });
  const userId = session.data?.user?.id ?? session.data?.session?.userId ?? "local-board";
  const query = useQuery({
    queryKey: queryKeys.primaryAgent.mine(companyId ?? "__none__", userId),
    queryFn: () => primaryAgentApi.get(companyId!),
    enabled: !!companyId && session.isSuccess,
  });
  // Arabic Desktop can bundle a newer UI than the separately published server.
  // The legacy server returns a route-not-found 404 for this *optional* feature.
  // Hide only that unsupported control; never disguise auth/network/real 404s.
  const unsupported = query.error instanceof ApiError && query.error.status === 404 &&
    (query.error.body as { error?: string } | null)?.error === "API route not found";
  return {
    ...query,
    unsupported,
    userId,
    loading: !!companyId && (session.isPending || query.isPending && !session.error),
    error: session.error ?? (unsupported ? null : query.error),
    retry: () => session.isError ? session.refetch() : query.refetch(),
  };
}
