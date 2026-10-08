/** Every Alerts operation shares the account deletion lock, including user
 * provisioning. A stale component cannot dispatch with a replacement session. */
import { useMemo } from "react"
import { useAccount } from "./accountContext"
import { accountRequest } from "./operations"
import * as api from "../lib/monitoringAuth"

export function useMonitoringOperations() {
    const account = useAccount()
    return useMemo(() => {
        const request = <T,>(run: (token: string) => Promise<T>, fallback: T): Promise<T> => accountRequest(account, run).catch(() => fallback)
        return {
            ensureMonitoringUser: (name: string, email: string) => accountRequest(account, t => api.ensureMonitoringUser(t, name, email)),
            listWebhooks: (kind: api.WebhookKind) => request(t => api.listWebhooks(t, kind), []),
            listAlertContacts: () => request(t => api.listAlertContacts(t), []),
            getReportSchedule: () => request(t => api.getReportSchedule(t), null),
            createWebhook: (kind: api.WebhookKind, input: api.WebhookInput & { ChainID: string }) => request(t => api.createWebhook(t, kind, input), { ok: false, error: "Account access changed. Reopen Settings after finishing account deletion." }),
            updateWebhook: (kind: api.WebhookKind, input: api.WebhookInput & { ID: number }) => request(t => api.updateWebhook(t, kind, input), { ok: false, error: "Account access changed. Reopen Settings after finishing account deletion." }),
            deleteWebhook: (kind: api.WebhookKind, id: number) => request(t => api.deleteWebhook(t, kind, id), false),
            createAlertContact: (input: Omit<api.AlertContact, "ID">) => request(t => api.createAlertContact(t, input), { ok: false, error: "Account access changed. Reopen Settings after finishing account deletion." }),
            updateAlertContact: (input: api.AlertContact) => request(t => api.updateAlertContact(t, input), { ok: false, error: "Account access changed. Reopen Settings after finishing account deletion." }),
            deleteAlertContact: (id: number) => request(t => api.deleteAlertContact(t, id), false),
            updateReportSchedule: (h: number, m: number, tz: string) => request(t => api.updateReportSchedule(t, h, m, tz), false),
        }
    }, [account])
}
