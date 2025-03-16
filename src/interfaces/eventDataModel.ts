interface PostEventDataModel {
    text: string;
    createdAt: string;
    langs?: string[];
    reply?: {
        root: {
            cid: string;
            uri: string;
        };
        parent: {
            cid: string;
            uri: string;
        };
    };
    facets?: {
        $type: string;
        index: {
            byteEnd: number;
            byteStart: number;
        };
        features: {
            $type: string;
            did?: string;
            tag?: string;
        }[];
    }[];
}

export type { PostEventDataModel };
