import Env from "../interfaces/envVars";

export type RouteHandler = (request: Request, env: Env) => Response;

export interface Route {
    path: string;
    handler: RouteHandler;
}

export class HttpHandler {
    private routes: Map<string, RouteHandler> = new Map();

    constructor(private env: Env) { }

    public addRoute(path: string, handler: RouteHandler): void {
        this.routes.set(path, handler);
    }

    public handle(request: Request): Promise<Response> {
        const url = new URL(request.url);
        console.debug('[ HTTP ] Request URL:', url.pathname);
        const handler = this.routes.get(url.pathname);
        
        // Handle CORS preflight requests
        if (request.method === 'OPTIONS') {
            return Promise.resolve(new Response(null, {
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                    'Access-Control-Allow-Headers': 'Content-Type',
                }
            }));
        }
        
        if (handler && request.headers.get('Upgrade') !== 'websocket') {
            console.debug('[ HTTP ] Handler found, executing...');
            const response = handler(request, this.env);
            
            // Add CORS headers to the actual response
            return Promise.resolve(response).then(originalResponse => {
                const corsHeaders = new Headers(originalResponse.headers);
                corsHeaders.set('Access-Control-Allow-Origin', '*');
                
                return new Response(originalResponse.body, {
                    status: originalResponse.status,
                    statusText: originalResponse.statusText,
                    headers: corsHeaders
                });
            });
        }

        return Promise.resolve(new Response('Not found', { 
            status: 404,
            headers: {
                'Access-Control-Allow-Origin': '*'
            }
        }));
    }
}
