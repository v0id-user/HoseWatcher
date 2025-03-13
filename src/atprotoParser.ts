/* I copied the same decoder from the implementation of the Atproto decoder @atproto/common
* found in https://github.dev/bluesky-social/atproto/blob/main/packages/common/src/index.ts
* I tried to use the library @atproto/common but it was not working as expected with cloudflare workers
* ==============@Atproto/common START==================
*/
import { type } from 'arktype'
import * as cborx from 'cbor-x'
import { CID } from 'multiformats/cid'

// add extension for decoding CIDs
// decoding code taken from @ipld/dag-cbor
// does not support encoding cids
cborx.addExtension({
  Class: CID,
  tag: 42,
  encode: () => {
    throw new Error('cannot encode cids')
  },
  decode: (bytes: Uint8Array): CID => {
    if (bytes[0] !== 0) {
      throw new Error('Invalid CID for CBOR tag 42; expected leading 0x00')
    }
    return CID.decode(bytes.subarray(1)) // ignore leading 0x00
  },
})

const decoder = new cborx.Decoder({
  // @ts-ignore
  int64AsNumber: true, // not in types for some reason
  useRecords: false,
})

export const cborDecodeMulti = (encoded: Uint8Array): unknown[] => {
  const decoded: unknown[] = []
  decoder.decodeMultiple(encoded, (value) => {
    decoded.push(value)
  })
  return decoded
}

/*
* ==============@Atproto/common END==================
*/

/**
 * ==============My parser implementation START==================
 * 
 * In this parser I will try to simplify the event data and extract
 * the most useful information from it.
 * 
 * I will use the arktype library to define the schema of the event data
 * 
 * Resources can be found in:
 * 
 * - https://atproto.com/specs/event-stream#Framing "Talking about the event frame and parts"
 */

const atEvent = type({
    operation: "'success' | 'error'",
    event: "'#commit'"
})

/**
 * Header of the event
 * based on the type definition of the header 
 * in the event stream spec in
 * 
 * Details about data header and types can be found in:
 * - https://atproto.com/specs/sync
 */
interface AtProtoEventHeader{
    op: 1 | -1; // Operation 1 is a commit, -1 is an error
    t?: '#commit'; // Type of the event, in this case it is a commit
}

interface AtProtoEventBody{
  time: Date;
  repo: string; // Repository name
  seq: number; // Sequence number
  ops: [{ // Operations
    cid: string; // CID of the blob
    path: string; // Path of the blob
    action: 'create' | 'update' | 'delete'; // Action of the blob
  }],
  since: string;
  blocks: Uint8Array;
  commit: string;
  tooBig: boolean;
}

function parseAtProtoEvent(event: Uint8Array) {
    console.log('Decoding event:', event);
    const [header, body] = cborDecodeMulti(event) as [AtProtoEventHeader, AtProtoEventBody];
    
    /**
     * `op` ("operation", integer, required): fixed values, indicating what this frame contains
     * 1: a regular message, with type indicated by `t`
     * -1: an error message
     * `t` ("type", string, optional): required if `op` is 1, indicating the Lexicon sub-type for this 
     *                                 message, in short form. Does not include the full Lexicon identifier, 
     *                                 just a fragment. Eg: #commit. Should not be included in header if op is -1.
     */
    
    if (header.op === 1 && header.t) {
        console.log('Decoded header:', header);
        console.log('Decoded body ops:', body.ops);
        console.log('Decoded body since:', body.since);
        console.log('Decoded body blocks:', body.blocks);
        console.log('Decoded body commit:', body.commit);
        console.log('Decoded body tooBig:', body.tooBig);
        console.log('Decoded body repo:', body.repo);
        const decodedBlocks = cborx.decode(body.blocks);
        console.log('Decoded blocks:', decodedBlocks);
    }else if (header.op === -1) {
      // I might not ignore this, by for sake of simplicity I will ignore it
      console.log('Decoded error header:', header);
    }else{
      /* ignore unknown op or t values
      * as stated in the spec:
      * Clients should ignore frames with headers that have unknown op or t values. 
      * Unknown fields in both headers and payloads should be ignored. Invalid framing or invalid DAG-CBOR 
      * encoding are hard errors, and the client should drop the entire connection instead of skipping the frame. 
      * Servers should ignore any frames received from the client, not treat them as errors.
      */

      return null;
    }

    return header;
}

export { parseAtProtoEvent }

/**
 * ==============My parser implementation END==================
 */