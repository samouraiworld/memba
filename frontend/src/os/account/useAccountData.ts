/**
 * The signed-in account's row and topics, read from the backend with a fresh
 * session token per call. Nothing is read with the account feature off, while
 * signed out, or while this person's account is being deleted (in any window:
 * a read would create the account again).
 *
 * @module os/account/useAccountData
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useAccount } from "../../account/accountContext"
import { accountApi, type Topic } from "../../lib/accountApi"
import { ACCOUNT_ENABLED } from "../../lib/config"
import { useDeletion } from "./deletion"
import { accountRequest } from "../../account/operations"

export function useAccountData() {
    const account = useAccount()
    const client = useQueryClient()
    const deletion = useDeletion(account.user?.id)
    const enabled = ACCOUNT_ENABLED && account.status === "ready" && !!account.user && deletion?.userId !== account.user.id
    const key = ["account", account.user?.id ?? ""] as const
    const request = <T,>(run: (token: string) => Promise<T>, signal?: AbortSignal) => accountRequest(account, run, signal)
    const row = useQuery({ queryKey: [...key, "row"], enabled, retry: false, queryFn: ({ signal }) => request(t => accountApi.get(t), signal) })
    const topics = useQuery({ queryKey: [...key, "topics"], enabled: enabled && row.isSuccess, retry: false, queryFn: ({ signal }) => request(t => accountApi.topics(t), signal) })
    const setTopic = useMutation({
        retry: false,
        mutationFn: async ({ topic, on, source, scope }: { topic: Topic; on: boolean; source: string; scope?: string }) =>
            request(t => accountApi.setTopic(t, topic, on, source, scope)),
        onSuccess: (states) => client.setQueryData([...key, "topics"], states),
    })
    return { account, row, topics, setTopic, request }
}
