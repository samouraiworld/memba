import { createConnectTransport } from "@connectrpc/connect-web";
import { createClient } from "@connectrpc/connect";
import { MultisigService } from "../gen/memba/v1/memba_pb";

const baseUrl = import.meta.env.VITE_API_URL || "";

export const transport = createConnectTransport({
    baseUrl,
});

export const api = createClient(MultisigService, transport);
