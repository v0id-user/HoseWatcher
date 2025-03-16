import Env from "../interfaces/envVars";

export type RouteHandler = (env: Env, serverWebSocket: WebSocket, request: Request) => Promise<void>;

export interface Route {
    path: string;
    handler: RouteHandler;
}

export class WebSocketHandler {
    private routes: Map<string, RouteHandler> = new Map();

    constructor(private env: Env) { }

    public addRoute(path: string, handler: RouteHandler): void {
        this.routes.set(path, handler);
    }

    public handle(request: Request): Response {
        const url = new URL(request.url);
        const handler = this.routes.get(url.pathname);

        if (handler && request.headers.get('Upgrade') === 'websocket') {
            // Create a new WebSocket pair
            const pair = new WebSocketPair();
            
            // Pass the request object to the handler to access headers
            handler(this.env, pair[1], request);
            
            // Return the client-side socket with proper upgrade headers
            return new Response(null, {
                status: 101,
                headers: {
                    'Upgrade': 'websocket',
                    'Connection': 'Upgrade'
                },
                webSocket: pair[0]
            });
        }

        return new Response('Not found', { status: 404 });
    }
}
