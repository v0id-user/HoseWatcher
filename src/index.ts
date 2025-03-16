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
    serverWebSocket.accept();

    const host = request.headers.get('host');

    if (!host?.startsWith('fire')) {
        serverWebSocket.close();
        return;
    }

    // Store rate limiting state in WebSocket object
    const state = {
        // TODO: Make this configurable
        messageCount: 0,
        lastResetTime: Date.now(),
        maxMessages: 15,
        resetInterval: 1000
    };
    
    // Attach state to WebSocket instance
    // Hacky serverless workaround, I'm not sure if this is the best way to do this.
    (serverWebSocket as any).rateLimit = state;

    // Create firehose connection
    const firehoseWebSocket = new WebSocket('wss://bsky.network/xrpc/com.atproto.sync.subscribeRepos');

    // Set up event listeners for the firehose WebSocket
    firehoseWebSocket.addEventListener('open', () => {
        ('Connected to the firehose WebSocket');
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

        const currentTime = Date.now();
        const rateLimitState = (serverWebSocket as any).rateLimit;

        if (currentTime - rateLimitState.lastResetTime >= rateLimitState.resetInterval) {
            rateLimitState.messageCount = 0;
            rateLimitState.lastResetTime = currentTime;
        }

        if (rateLimitState.messageCount >= rateLimitState.maxMessages) {
            return;
        }

        try {
            const rawData = typeof fireHoseevent.data === 'string'
                ? new TextEncoder().encode(fireHoseevent.data) 
                : new Uint8Array(fireHoseevent.data);

            const parsedEvent = await parseAtProtoEvent(rawData);
            
            if (parsedEvent && Object.keys(parsedEvent).length > 0) {
                await serverWebSocket.send(JSON.stringify(parsedEvent));
                rateLimitState.messageCount++;
            }
        } catch (err) {
            console.error('Error processing event:', err);
        }
    });

    firehoseWebSocket.addEventListener('error', (error) => {
        console.error('Firehose WebSocket error:', error);
        serverWebSocket.send('Error connecting to the firehose');
        serverWebSocket.close();
    });

    firehoseWebSocket.addEventListener('close', () => {
        ('Disconnected from the firehose WebSocket');
        serverWebSocket.close();
    });

    serverWebSocket.addEventListener('close', () => {
        ('Disconnected from the server WebSocket');
        firehoseWebSocket.close();
        serverWebSocket.close();
    });
}

export default {
    async fetch(request, env, ctx): Promise<Response> {

        const wsHandler = new WebSocketHandler(env);
        wsHandler.addRoute('/', handleWsFirehoseRelay);


        const version = 'v1'
        const httpHandler = new HttpHandler(env);
        httpHandler.addRoute('/', handleBanner);

        // Very bad, but it works :P
        const wsResponse = wsHandler.handle(request);
        if (request.headers.get('Upgrade') === 'websocket') {
            return wsResponse;
        }
        return httpHandler.handle(request);
    },
} satisfies ExportedHandler<Env>;
