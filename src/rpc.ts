export interface RPCRequestMessage {
    type: 'rpc-request';
    requestId: number;
    endpoint: string;
    params: unknown;
}

export interface RPCResponseMessage {
    type: 'rpc-response';
    requestId: number;
    response: unknown;
    error: unknown;
}

export type RPCResult<T> = [T, Transferable[]];

type Endpoint = (...args: any[]) => Promise<RPCResult<any>>;

type PostMessageFn = (message: unknown, options: { transfer?: Transferable[] }) => void;

export class RPCController<
    RX extends Record<keyof RX, Endpoint>,
    TX extends Record<keyof TX, Endpoint>,
> {
    #handlers: RX;
    #requestIDSeq = 0;
    #requestsInFlight = new Map<number, PromiseWithResolvers<any>>();
    #postMessage: PostMessageFn;

    constructor(handlers: RX, postMessage: PostMessageFn) {
        this.#handlers = handlers;
        this.#postMessage = postMessage;
    }

    #getNextRequestID() {
        return this.#requestIDSeq = (this.#requestIDSeq | 0) + 1;
    }

    onMessage(event: MessageEvent) {
        const data = event.data as RPCRequestMessage | RPCResponseMessage;
        if (data.type === 'rpc-request') {
            if (data.endpoint in this.#handlers) {
                let handler = this.#handlers[data.endpoint as keyof RX];
                handler(...data.params as any).then(
                    ([response, transfer]) => [{ response, error: null }, transfer] as const,
                    (error) => [{ response: null, error }, [] as Transferable[]] as const,
                ).then(([{ response, error }, transfer]) => {
                    this.#postMessage({
                        type: 'rpc-response',
                        requestId: data.requestId,
                        response: response,
                        error: error,
                    } satisfies RPCResponseMessage, {
                        transfer: transfer,
                    });
                });
            } else {
                throw new Error(`Unknown endpoint "${data.endpoint}"`);
            }
        } else if (data.type === 'rpc-response') {
            let promiseWithResolvers = this.#requestsInFlight.get(data.requestId);
            if (!promiseWithResolvers) {
                throw new Error(`Unknown request ID "${data.requestId}"`);
            }
            if (data.error) {
                promiseWithResolvers.reject(data.error);
            } else {
                promiseWithResolvers.resolve(data.response);
            }
        }
    }

    send<T extends keyof TX>(
        type: T, params: Parameters<TX[T]>, transfer?: Transferable[],
    ): Promise<Awaited<ReturnType<TX[T]>>[0]> {
        let requestId = this.#getNextRequestID();
        let promiseWithResolvers = Promise.withResolvers<Awaited<ReturnType<TX[T]>>[0]>();
        this.#requestsInFlight.set(requestId, promiseWithResolvers);
        this.#postMessage({
            type: 'rpc-request',
            requestId: requestId,
            endpoint: type as string,
            params: params,
        } satisfies RPCRequestMessage, { transfer });
        return promiseWithResolvers.promise;
    }
}
