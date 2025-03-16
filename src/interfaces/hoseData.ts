interface HoseDataPost {
    text: string;
    did: string;
    rev: string;
    createdAt: string;
    reply?: {
        parent: {
            uri: string;
        }
    };
    tags?: string[];
    mentions?: string[];
}

export type { HoseDataPost };
