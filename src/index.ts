/**
 * This project idea originally saw it on https://www.youtube.com/watch?v=fxZSP85YcoE were
 * someone perform the same thing with the twitter firehose, so I thought it would be a fun
 * to replicate it with the bluesky firehose.
 * 
 * I'm not affiliated with the original project, I just thought it would be a fun challenge to
 * replicate it.
 */
import { parseAtProtoEvent } from "./atprotoParser";
import { HttpHandler } from "./lib/httpHandler";
import Env from "./interfaces/envVars";
import { WebSocketHandler } from "./lib/wsHandler";

const handleBanner = (request: Request, env: Env): Response => {
    const webSocketEndPoint = `wss://${env.HOSER_ENDPOINT}`;

    return new Response(`
        _   _              __        __    _       _               
       | | | | ___  ___  __\\ \\      / /_ _| |_ ___| |__   ___ _ __ 
       | |_| |/ _ \\/ __|/ _ \\ \\ /\\ / / _\` | __/ __| '_ \\ / _ \\ '__|
       |  _  | (_) \\__ \\  __/\\ V  V / (_| | || (__| | | |  __/ |   
       |_| |_|\\___/|___/\\___| \\_/\\_/ \\__,_|\\__\\___|_| |_|\\___|_|   
       
       ${webSocketEndPoint}/

       ---
       
       Made with ❤️ by @v0id_user
       https://x.com/v0id_user
       https://github.com/v0id-user
       https://tree.v0id.me
`);
}

const handleWsFirehoseRelay = async (env: Env, serverWebSocket: WebSocket, request: Request) => {
    try {
        serverWebSocket.accept();

        const host = request.headers.get('host');

        if (!host?.startsWith('fire')) {
            serverWebSocket.close(1000, 'Invalid host');
            return;
        }

        // Create firehose connection
        let firehoseWebSocket: WebSocket;

        try {
            firehoseWebSocket = new WebSocket('wss://bsky.network/xrpc/com.atproto.sync.subscribeRepos');
        } catch (error) {
            console.error('Failed to create firehose connection:', error);
            serverWebSocket.send(JSON.stringify({ error: 'Failed to connect to firehose' }));
            serverWebSocket.close(1011, 'Failed to connect to firehose');
            return;
        }

        // Set up event listeners for the firehose WebSocket
        firehoseWebSocket.addEventListener('open', () => {
            console.log('Connected to the firehose WebSocket');
        });

        firehoseWebSocket.addEventListener('message', async (fireHoseevent) => {
            /**
             * Shoutout to https://github.com/kcchu/atproto-firehose/blob/main/src/eventStream.ts#L44
             * and their implementation of the firehose, I took a lot of inspiration from it.
             * 
             * The data return from the firehose are specific to the ATProto, so we need to decode them.
             * 
             * As mentioned in the https://docs.bsky.app/docs/advanced-guides/firehose 
             * "you need to read off each message as it comes in, and decode the CBOR event data."
             * So we need to handle decoding of the messages with CBOR.
             * 
             * We can find more about CBOR in https://atproto.com/specs/data-model
             * "it is encoded in Concise Binary Object Representation (CBOR). CBOR is an IETF standard roughly based on JSON"
             * So the end result is a JSON object.
             * 
             * RFC for CBOR found in https://cbor.io/
             * and more implementation libraries found in https://cbor.io/impls.html
             * 
             * 
            */
            if (serverWebSocket.readyState !== WebSocket.OPEN) {
                return;
            }

            try {
                let rawData: Uint8Array;

                try {
                    rawData = typeof fireHoseevent.data === 'string'
                        ? new TextEncoder().encode(fireHoseevent.data)
                        : new Uint8Array(fireHoseevent.data);
                } catch (err) {
                    console.error('Error converting event data:', err);
                    return;
                }

                try {
                    const parsedEvent = await parseAtProtoEvent(rawData);

                    if (parsedEvent && Object.keys(parsedEvent).length > 0) {
                        if (serverWebSocket.readyState === WebSocket.OPEN) {
                            try {
                                await serverWebSocket.send(JSON.stringify(parsedEvent));
                            } catch (sendErr) {
                                console.error('Error sending to client:', sendErr);
                            }
                        }
                    }
                } catch (parseErr) {
                    console.error('Error in parseAtProtoEvent:', parseErr);
                    // Continue processing next events
                }
            } catch (err) {
                console.error('Error processing event:', err);
                // Avoid crashing the worker by catching all errors
            }
        });

        firehoseWebSocket.addEventListener('error', (error) => {
            try {
                const errorDetails = {
                    message: error.message || 'No error message available',
                    type: error.type,
                    timeStamp: error.timeStamp,
                    isTrusted: error.isTrusted,
                    ...(error.error && { errorObject: String(error.error) })
                };

                console.error('Firehose WebSocket error:', JSON.stringify(errorDetails, null, 2));
            } catch (err) {
                console.error('Error handling WebSocket error event:', err);
            }
        });

        firehoseWebSocket.addEventListener('close', (event) => {
            console.log('Disconnected from the firehose WebSocket:', event.code, event.reason);

            if (serverWebSocket.readyState === WebSocket.OPEN) {
                serverWebSocket.close(1000, 'Firehose disconnected');
            }
        });

        serverWebSocket.addEventListener('close', (event) => {
            console.log('Client disconnected:', event.code, event.reason);

            if (firehoseWebSocket && firehoseWebSocket.readyState !== WebSocket.CLOSED) {
                firehoseWebSocket.close(1000, 'Client disconnected');
            }
        });

        // Add error handler for server WebSocket
        serverWebSocket.addEventListener('error', (error) => {
            console.error('Server WebSocket error:', error);
        });
    } catch (error) {
        console.error('Critical error in WebSocket handler:', error);

        if (serverWebSocket && serverWebSocket.readyState === WebSocket.OPEN) {
            try {
                serverWebSocket.close(1011, 'Internal server error');
            } catch (closeErr) {
                console.error('Error closing WebSocket:', closeErr);
            }
        }
    }
}

export default {
    async fetch(request, env, ctx): Promise<Response> {
        try {
            const wsHandler = new WebSocketHandler(env);
            wsHandler.addRoute('/', handleWsFirehoseRelay);

            const httpHandler = new HttpHandler(env);
            httpHandler.addRoute('/', handleBanner);

            // Very bad, but it works :P
            if (request.headers.get('Upgrade') === 'websocket') {
                return wsHandler.handle(request);
            }
            return httpHandler.handle(request);
        } catch (error) {
            console.error('Critical error in fetch handler:', error);
            return new Response('Internal Server Error', { status: 500 });
        }
    },
} satisfies ExportedHandler<Env>;
