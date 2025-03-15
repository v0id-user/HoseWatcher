import { describe, it, expect } from 'vitest';
import { AtpAgent } from '@atproto/api'
import { didResolve } from '../src/lib/didResolve';

// ====== Public declarations ======
const agent = new AtpAgent({
  service: 'https://bsky.social',
})

describe('General tests', () => {
    it('Testing bluesky api', async () => {
        const query = {
            repo: 'did:plc:mmcsgmxut473ffmsn2ziszrd',
            rkey: '3lkev4vtwms24'
        }
        
        try {
            console.log('Querying post', query);
            const post = await agent.getPost(query);
            console.log('Post:', post);
            console.log('Resolving handle', query.repo);
            const didResolution = await didResolve('did:plc:e3ftuosewor75lyaej44fsbn'); // v0id.me || my account on bluesky
            console.log('Resolved handle:', didResolution);
            const handleResolution = await agent.resolveHandle({
                handle: 'v0id.me'
            });
            console.log('Resolved handle:', handleResolution);
            expect(post).toBeDefined();
            return post;
        } catch (error) {
            console.error('Error:', error);
            throw error;
        }
    })
});
