/**
 * This project idea originally saw it on https://www.youtube.com/watch?v=fxZSP85YcoE were
 * someone perform the same thing with the twitter firehose, so I thought it would be a fun
 * to replicate it with the bluesky firehose.
 * 
 * I'm not affiliated with the original project, I just thought it would be a fun challenge to
 * replicate it.
 */
import { Account, Client } from "node-appwrite";
import { parseAtProtoEvent } from "./atprotoParser";

export interface Env {
    BAAS_ENDPOINT: string;
    APPWRITE_API_KEY: string;
    PROJECT_ID: string;
    DEBUG: boolean;
}

const handleBanner = () => {
    return new Response(`
        _   _              __        __    _       _               
       | | | | ___  ___  __\\ \\      / /_ _| |_ ___| |__   ___ _ __ 
       | |_| |/ _ \\/ __|/ _ \\ \\ /\\ / / _\` | __/ __| '_ \\ / _ \\ '__|
       |  _  | (_) \\__ \\  __/\\ V  V / (_| | || (__| | | |  __/ |   
       |_| |_|\\___/|___/\\___| \\_/\\_/ \\__,_|\\__\\___|_| |_|\\___|_|   
       
       wss://fire.hose.watch/

       Must be authenticated to connect
       visit https://hose.watch/ you will get a token automatically
       ---
       
       Made with ❤️ by @v0id_user
       https://x.com/v0id_user
       https://github.com/v0id-user
       https://tree.v0id.me
`);
}

export default {
    async fetch(request, env, ctx): Promise<Response> {
        const url = new URL(request.url)

        if (url.pathname === '/' && request.headers.get('Upgrade') === 'websocket') {
            /**
            * The authentication is handled by the client using the Appwrite SDK, 
            * so we just need to verify the token
            */

            // Verify the token
            const token: string | undefined = request.headers.get('Authorization')?.split(' ')[1];

            // Skip authentication if DEBUG is true
            if (env.DEBUG) {
                console.log('Debug mode enabled, skipping authentication');
            } else {
                // Only authenticate if not in debug mode
                if (!token) {
                    return new Response('Unauthorized', { status: 401 });
                }

                const client = new Client();
                client.setEndpoint(env.BAAS_ENDPOINT)
                    .setProject(env.PROJECT_ID)
                    .setKey(env.APPWRITE_API_KEY);
                client.setSession(token);

                const account = new Account(client);
                const userAnonymous = await account.get();
                if (userAnonymous.$id !== token) {
                    return new Response('Unauthorized', { status: 401 });
                }
            }

            // Accept WebSocket connection from client
            const pair = new WebSocketPair();
            const [clientWebSocket, serverWebSocket] = [pair[0], pair[1]];
            serverWebSocket.accept(); // Accept the WebSocket connection

            // Connect to the bluesky firehose WebSocket stream
            const firehoseWebSocket = new WebSocket('wss://bsky.network/xrpc/com.atproto.sync.subscribeRepos');

            // Don't call accept() on the firehose WebSocket - it's outgoing, not incoming
            // firehoseWebSocket.accept(); - This line was causing the error

            // Set up event listeners for the firehose WebSocket
            firehoseWebSocket.addEventListener('open', () => {
                console.log('Connected to the firehose WebSocket');
            });

            firehoseWebSocket.addEventListener('message', async (event) => {
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
                // TODO: Relay messages from the firehose WebSocket to the client
                // TODO: Handle the filtering of the messages
                // TODO: Serialize the messages to JSON
                // TODO: Single message is 5KB, so we need to handle that

                // Handle the message data correctly
                let rawData;
                if (typeof event.data === 'string') {
                    // Convert string to ArrayBuffer if needed
                    const encoder = new TextEncoder();
                    rawData = encoder.encode(event.data).buffer;
                } else {
                    // Already an ArrayBuffer
                    rawData = event.data;
                }

                // Parse the event to the common schema
                const parsedEvent = await parseAtProtoEvent(new Uint8Array(rawData));
                await serverWebSocket.send(JSON.stringify(parsedEvent));
            });

            firehoseWebSocket.addEventListener('error', (error) => {
                console.error('Firehose WebSocket error:', error);
                serverWebSocket.send('Error connecting to the firehose');
                serverWebSocket.close();
            });

            firehoseWebSocket.addEventListener('close', () => {
                console.log('Disconnected from the firehose WebSocket');
                serverWebSocket.close();
            });

            // Set up event listeners for the client WebSocket
            serverWebSocket.addEventListener('message', async (event) => {
                // Forward any messages from the client to the firehose if needed
                console.log('Received message from client:', event.data);
            });

            serverWebSocket.addEventListener('close', () => {
                console.log('Client disconnected');
                firehoseWebSocket.close();
            });

            return new Response(null, {
                status: 101,
                headers: {
                    'Upgrade': 'websocket',
                    'Connection': 'Upgrade'
                },
                webSocket: clientWebSocket,
            });
        }

        return handleBanner();
    },
} satisfies ExportedHandler<Env>;
