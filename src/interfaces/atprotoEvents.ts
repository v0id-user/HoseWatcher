interface AtProtoCommitEventBody {
  time: Date;
  repo: string; // Repository name
  seq: number; // Sequence number
  ops: [{ // Operations
    cid: string; // CID of the blob
    path: string; // Path of the blob
    action: 'create' | 'update' | 'delete'; // Action of the blob
  }],
  since: string;
  blocks: Uint8Array; //(bytes, required): CAR "slice" for the corresponding repo diff. The commit object must always be included. | taken from https://atproto.com/specs/sync
  commit: string;
  tooBig: boolean;
}


export type { AtProtoCommitEventBody };
