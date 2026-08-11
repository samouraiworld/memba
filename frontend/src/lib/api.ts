import { createConnectTransport } from "@connectrpc/connect-web";
import { createClient, Code, ConnectError, type Interceptor } from "@connectrpc/connect";
import { MultisigService } from "../gen/memba/v1/memba_pb";
import { API_BASE_URL } from "./config";
import { invalidateSession } from "./authSession";

/**
 * F-29 self-heal: drop a token the server has rejected.
 *
 * The backend answers a rejected token with a message-less `Unauthenticated`
 * (`service.go` `authenticate`), deliberately giving no oracle for WHY —
 * expired, bad signature, wrong chain. That is fine for the client, because the
 * response is the same in every case: this token is dead, stop sending it.
 *
 * Without this the token survived until natural expiry and every call kept
 * 401ing behind a UI that still looked signed in, with a reload changing
 * nothing. Clearing it drops the app to signed-out, which is honest and offers
 * a working "connect" button.
 *
 * Scoped to `Unauthenticated` on purpose. `GetToken` denials ride
 * `PermissionDenied` (`tokenDenied`), and treating those the same way would
 * mean a failed sign-in attempt logs out a perfectly good existing session.
 */
export const authSelfHeal: Interceptor = (next) => async (req) => {
    try {
        return await next(req);
    } catch (err) {
        if (ConnectError.from(err).code === Code.Unauthenticated) {
            invalidateSession("Your session is no longer valid — please sign in again.");
        }
        throw err;
    }
};

export const transport = createConnectTransport({
    baseUrl: API_BASE_URL,
    interceptors: [authSelfHeal],
});

export const api = createClient(MultisigService, transport);
