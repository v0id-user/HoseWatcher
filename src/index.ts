export interface Env {
    APPWRITE_API_KEY: string;
    PROJECT_ID: string;
  }
  

export default {
    async fetch(request, env, ctx): Promise<Response> {


        return new Response(`Hello World! ${env.PROJECT_ID}`);
    },
} satisfies ExportedHandler<Env>;
