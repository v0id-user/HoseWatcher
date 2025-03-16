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
import { HttpHandler } from "./lib/httpHandler";
import Env from "./interfaces/envVars";
import { WebSocketHandler } from "./lib/wsHandler";

const handleBanner = (request: Request, env: Env): Response => {
    const webSocketSchema = env.DEBUG ?
        `ws://` : 'wss://'
    const httpSchema = env.DEBUG ?
        `http://` : 'https://'
    const webSocketEndPoint = `${webSocketSchema}${env.HOSER_ENDPOINT}`;
    const httpEndPoint = `${httpSchema}${env.HOSER_ENDPOINT}`;
    return new Response(`
        _   _              __        __    _       _               
       | | | | ___  ___  __\\ \\      / /_ _| |_ ___| |__   ___ _ __ 
       | |_| |/ _ \\/ __|/ _ \\ \\ /\\ / / _\` | __/ __| '_ \\ / _ \\ '__|
       |  _  | (_) \\__ \\  __/\\ V  V / (_| | || (__| | | |  __/ |   
       |_| |_|\\___/|___/\\___| \\_/\\_/ \\__,_|\\__\\___|_| |_|\\___|_|   
       
       ${webSocketEndPoint}/

       Must be authenticated to connect
       visit ${httpEndPoint}/ you will get a token automatically
       ---
       
       Made with ❤️ by @v0id_user
       https://x.com/v0id_user
       https://github.com/v0id-user
       https://tree.v0id.me
`);
}

export default {
    async fetch(request, env, ctx): Promise<Response> {
        const wsHandler = new WebSocketHandler(env);
        // TODO: Make this works some how
        wsHandler.addRoute('/', async (env, serverWebSocket, request) => {
            // Accept the connection
            serverWebSocket.accept();

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
                    serverWebSocket.close(1008, 'Unauthorized');
                    return;
                }

                const client = new Client();
                client.setEndpoint(env.BAAS_ENDPOINT)
                    .setProject(env.PROJECT_ID)
                    .setKey(env.APPWRITE_API_KEY);
                client.setSession(token);

                const account = new Account(client);
                const userAnonymous = await account.get();
                if (userAnonymous.$id !== token) {
                    serverWebSocket.close(1008, 'Unauthorized');
                    return;
                }
            }

            // Create firehose connection
            const firehoseWebSocket = new WebSocket('wss://bsky.network/xrpc/com.atproto.sync.subscribeRepos');

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

                // TODO: Relay messages from the firehose WebSocket to the client
                // TODO: Handle the filtering of the messages
                // TODO: Serialize the messages to JSON
                // TODO: Single message is 5KB, so we need to handle that

                // Handle the message data correctly
                let rawData;
                if (typeof fireHoseevent.data === 'string') {
                    // Convert string to ArrayBuffer if needed
                    const encoder = new TextEncoder();
                    rawData = encoder.encode(fireHoseevent.data).buffer;
                } else {
                    // Already an ArrayBuffer
                    rawData = fireHoseevent.data;
                }

                // Parse the event to the common schema
                const parsedEvent = await parseAtProtoEvent(new Uint8Array(rawData));
                if (parsedEvent) {
                    await serverWebSocket.send(JSON.stringify(parsedEvent));
                }
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
        });


        const version = 'v1'
        const httpHandler = new HttpHandler(env);
        httpHandler.addRoute('/', handleBanner);

        // Very bad, but it works :P
        return Promise.race([httpHandler.handle(request), wsHandler.handle(request)]);
    },
} satisfies ExportedHandler<Env>;
