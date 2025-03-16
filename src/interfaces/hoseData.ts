interface HoseDataPost {
    text: string;
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
