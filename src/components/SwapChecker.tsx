import { OutputType } from "boltz-core";
import log from "loglevel";
import { createEffect, onCleanup, onMount } from "solid-js";

import { BTC, LBTC, RBTC } from "../consts/Assets";
import { SwapType } from "../consts/Enums";
import {
    swapStatusFinal,
    swapStatusPending,
    swapStatusSuccess,
} from "../consts/SwapStatus";
import { useGlobalContext } from "../context/Global";
import { usePayContext } from "../context/Pay";
import {
    getChainSwapTransactions,
    getReverseTransaction,
} from "../utils/boltzClient";
import { claim, createSubmarineSignature } from "../utils/claim";
import { getApiUrl } from "../utils/helper";
import Lock from "../utils/lock";
import {
    ChainSwap,
    ReverseSwap,
    SubmarineSwap,
    getRelevantAssetForSwap,
} from "../utils/swapCreator";

type SwapStatus = {
    id: string;
    status: string;
};

const reconnectInterval = 5_000;

class BoltzWebSocket {
    private readonly swapClaimLock = new Lock();

    private ws?: WebSocket;
    private reconnectTimeout?: any;
    private isClosed: boolean = false;

    constructor(
        private readonly url: string,
        private readonly relevantIds: Set<string>,
        private readonly prepareSwap: (id: string, status: any) => void,
        private readonly claimSwap: (id: string, status: any) => Promise<void>,
    ) {}

    public connect = () => {
        this.isClosed = false;
        clearTimeout(this.reconnectTimeout);
        this.ws?.close();
        this.ws = new WebSocket(
            `${BoltzWebSocket.formatWsUrl(this.url)}/v2/ws`,
        );

        this.ws.onopen = () => {
            this.subscribeUpdates(Array.from(this.relevantIds.values()));
        };
        this.ws.onclose = () => {
            log.warn(`ws ${this.url} closed`);
            this.handleClose();
        };
        this.ws.onmessage = async (msg) => {
            const data = JSON.parse(msg.data);
            if (data.event === "pong" || data.event === "ping") {
                return;
            }

            log.debug(`ws ${this.url} message`, data);

            if (data.event === "update" && data.channel === "swap.update") {
                const swapUpdates = data.args as SwapStatus[];
                for (const status of swapUpdates) {
                    this.relevantIds.add(status.id);
                    this.prepareSwap(status.id, status);
                    await this.swapClaimLock.acquire(() =>
                        this.claimSwap(status.id, status),
                    );
                }
            }
        };
    };

    public close = () => {
        this.isClosed = true;
        if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
        }

        this.ws?.close();
    };

    public subscribeUpdates = (ids: string[]) => {
        ids.forEach((id) => this.relevantIds.add(id));
        if (this.ws.readyState !== WebSocket.OPEN) {
            return;
        }

        this.ws.send(
            JSON.stringify({
                op: "subscribe",
                channel: "swap.update",
                args: ids,
            }),
        );
    };

    private handleClose = () => {
        // Don't reconnect when it has been closed manually
        if (this.isClosed) {
            return;
        }

        this.reconnectTimeout = setTimeout(
            () => this.connect(),
            reconnectInterval,
        );
    };

    private static formatWsUrl = (url: string) =>
        url.replace("http://", "ws://").replace("https://", "wss://");
}

export const SwapChecker = () => {
    const {
        swap,
        setSwap,
        setSwapStatus,
        setSwapStatusTransaction,
        setFailureReason,
    } = usePayContext();
    const { notify, updateSwapStatus, getSwap, getSwaps, setSwapStorage, t } =
        useGlobalContext();

    const assetWebsocket = new Map<string, BoltzWebSocket>();

    const prepareSwap = async (swapId: string, data: any) => {
        const currentSwap = await getSwap(swapId);
        if (currentSwap === null) {
            log.warn(`prepareSwap: swap ${swapId} not found`);
            return;
        }
        if (swap() && swap().id === currentSwap.id) {
            setSwapStatus(data.status);
            if (data.transaction) {
                setSwapStatusTransaction(data.transaction);
            }
            if (data.failureReason) {
                setFailureReason(data.failureReason);
            }
        }
        if (data.status) {
            await updateSwapStatus(currentSwap.id, data.status);
        }
    };

    const claimSwap = async (swapId: string, data: any) => {
        const currentSwap = await getSwap(swapId);
        if (currentSwap === null) {
            log.warn(`claimSwap: swap ${swapId} not found`);
            return;
        }

        if (
            currentSwap.version !== OutputType.Taproot ||
            getRelevantAssetForSwap(currentSwap) === RBTC
        ) {
            return;
        }

        if (data.status === swapStatusSuccess.InvoiceSettled) {
            data.transaction = await getReverseTransaction(
                getRelevantAssetForSwap(currentSwap),
                currentSwap.id,
            );
        } else if (
            currentSwap.type === SwapType.Chain &&
            data.status === swapStatusSuccess.TransactionClaimed
        ) {
            data.transaction = (
                await getChainSwapTransactions(
                    getRelevantAssetForSwap(currentSwap),
                    currentSwap.id,
                )
            ).serverLock.transaction;
        }

        if (
            currentSwap.claimTx === undefined &&
            data.transaction !== undefined &&
            ((currentSwap.type === SwapType.Reverse &&
                [
                    swapStatusPending.TransactionConfirmed,
                    swapStatusPending.TransactionMempool,
                    swapStatusSuccess.InvoiceSettled,
                ].includes(data.status)) ||
                (currentSwap.type === SwapType.Chain &&
                    [
                        swapStatusSuccess.TransactionClaimed,
                        swapStatusPending.TransactionServerConfirmed,
                        swapStatusPending.TransactionServerMempool,
                    ].includes(data.status)))
        ) {
            try {
                const res = await claim(
                    currentSwap as ReverseSwap | ChainSwap,
                    data.transaction,
                );
                const claimedSwap = (await getSwap(res.id)) as
                    | ReverseSwap
                    | ChainSwap;
                claimedSwap.claimTx = res.claimTx;
                await setSwapStorage(claimedSwap);

                if (claimedSwap.id === swap().id) {
                    setSwap(claimedSwap);
                }
                notify(
                    "success",
                    t("swap_completed", { id: res.id }),
                    true,
                    true,
                );
            } catch (e) {
                const msg = t("claim_fail", { id: currentSwap.id });
                log.warn(msg, e);
                notify("error", msg);
            }
        } else if (data.status === swapStatusPending.TransactionClaimPending) {
            try {
                await createSubmarineSignature(currentSwap as SubmarineSwap);
                notify(
                    "success",
                    t("swap_completed", { id: currentSwap.id }),
                    true,
                    true,
                );
            } catch (e) {
                const msg =
                    "creating cooperative signature for submarine swap claim failed";
                log.warn(msg, e);
                notify("error", msg);
            }
        }
    };

    onMount(async () => {
        const urlsToAsset = new Map<string, string[]>();
        for (const [asset, url] of [BTC, LBTC, RBTC].map((asset) => [
            asset,
            getApiUrl(asset),
        ])) {
            urlsToAsset.set(url, (urlsToAsset.get(url) || []).concat(asset));
        }

        const swapsToCheck = (await getSwaps()).filter(
            (s) =>
                !swapStatusFinal.includes(s.status) ||
                ((s.status === swapStatusSuccess.InvoiceSettled ||
                    (s.type === SwapType.Chain &&
                        s.status === swapStatusSuccess.TransactionClaimed)) &&
                    s.claimTx === undefined),
        );

        for (const [url, assets] of urlsToAsset.entries()) {
            log.debug(`opening ws for assets [${assets.join(", ")}]: ${url}`);
            const ws = new BoltzWebSocket(
                url,
                new Set<string>(
                    swapsToCheck
                        .filter((s) =>
                            assets.includes(getRelevantAssetForSwap(s)),
                        )
                        .map((s) => s.id),
                ),
                prepareSwap,
                claimSwap,
            );
            ws.connect();
            for (const asset of assets) {
                assetWebsocket.set(asset, ws);
            }
        }
    });

    onCleanup(() => {
        const sockets = assetWebsocket.values();
        assetWebsocket.clear();

        for (const ws of sockets) {
            ws.close();
        }
    });

    createEffect(() => {
        const activeSwap = swap();
        if (activeSwap === undefined || activeSwap === null) {
            return;
        }
        // on page reload assetWebsocket is not yet initialized
        const ws = assetWebsocket.get(getRelevantAssetForSwap(activeSwap));
        if (ws === undefined) {
            return;
        }
        ws.subscribeUpdates([activeSwap.id]);
    });

    return "";
};
