interface EventDataModel{
    $type: string;
    text?: string;
    langs?: string[];
    createdAt?: string;
    subject?: {
        cid: string;
        uri: string;
    };
}