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

        const handler = this.routes.get(url.pathname);
        if (handler) {
            return Promise.resolve(handler(request, this.env));
        }

        return Promise.resolve(new Response('Not found', { status: 404 }));
    }
}
