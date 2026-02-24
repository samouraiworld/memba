import { createConnectTransport } from "@connectrpc/connect-web";
import { createClient } from "@connectrpc/connect";
import { MultisigService } from "../gen/memba/v1/memba_pb";
import { API_BASE_URL } from "./config";

export const transport = createConnectTransport({
    baseUrl: API_BASE_URL,
});

export const api = createClient(MultisigService, transport);
