// All imports
import { type } from 'arktype'
import * as cborx from 'cbor-x'
import { CID } from 'multiformats/cid'
import { COMMIT_EVENT_TYPE } from './constants/atprotoEventsTypes'
import { BSKY_POST } from './constants/dataModelTypes'
import { AtProtoCommitEventBody } from './interfaces/atprotoEvents'
import { CarReader } from '@ipld/car/reader'
import { decode as ipldCborDecode } from '@ipld/dag-cbor'
import { AtpAgent } from '@atproto/api'

// ====== Public declarations ======
const agent = new AtpAgent({
  service: 'https://bsky.social'
})
// TODO: use await agent.getPost(params)

/* I copied the same decoder from the implementation of the Atproto decoder @atproto/common
* found in https://github.dev/bluesky-social/atproto/blob/main/packages/common/src/index.ts
* I tried to use the library @atproto/common but it was not working as expected with cloudflare workers
* ==============@Atproto/common START==================
*/

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

const atHeaderType = type({
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
interface AtProtoEventHeader {
  op: 1 | -1; // Operation 1 is a commit, -1 is an error
  t?: "#commit" | "#account"; // Type of the event
}

async function parseAtProtoEvent(event: Uint8Array) {
  console.log('Decoding event:', event);

  const [header, body] = cborDecodeMulti(event) as [AtProtoEventHeader, unknown]; // The type of the body is unknown until we read the event header

  /**
   * `op` ("operation", integer, required): fixed values, indicating what this frame contains
   * 1: a regular message, with type indicated by `t`
   * -1: an error message
   * `t` ("type", string, optional): required if `op` is 1, indicating the Lexicon sub-type for this 
   *                                 message, in short form. Does not include the full Lexicon identifier, 
   *                                 just a fragment. Eg: #commit. Should not be included in header if op is -1.
   */
  console.log('RAW Decoded header:', header);
  console.log('RAW Decoded body:', body);
  if (header.op === 1 && header.t) {
    if (header.t === COMMIT_EVENT_TYPE) {
      const event = body as AtProtoCommitEventBody;

      if (event.tooBig || event.ops[0].action === 'delete') {
        // Ignore these type of events
        return null;
      }

      /* 
      * Decoding the blocks taken from https://github.com/kcchu/atproto-firehose/blob/main/src/subscribeRepos.ts#L64
      * and the specs in https://atproto.com/specs/sync
      * 
      * The block are encoded in CAR format, so we need to decode them
      * 
      * more about the CAR format can be found in:
      * - https://ipld.io/specs/transport/car/carv1/#summary
      * 
      * Also you need to know about the CIDs because it relates to the blocks:
      * - https://github.com/multiformats/cid
      */
      console.log('Decoding blocks');
      // First of all we need to check for the CID if it does exists
      if (!event.ops[0].cid) {
        console.log('Missing CID, path or action');
        return null;
      }
      const cid = event.ops[0].cid;
      const cr = await CarReader.fromBytes(event.blocks);
      if (!cr) {
        console.log('Error decoding the CAR');
        return null;
      }

      // Log operation for getting the block from the CID
      console.log('Getting block from CID');
      // Get the block from the CID
      const block = await cr.get(cid as any);
      if (!block) {
        console.log('Error getting the block');
        return null;
      }

      // Log operation for decoding the block
      console.log('Decoding the block');
      // Decode the block
      const decodedBlock = ipldCborDecode(block.bytes) as { $type: string; }; // inline just to extract the $type
      // Log operation for successful decoding
      console.log('Block decoded successfully ', decodedBlock);
      /**
       * Now we finished dealing with sync events and started dealing with
       * Data models, each event has a $type maybe a like, reply, post, etc.
       * 
       * We need to check for the $type and then parse the event accordingly
       */
      const $type = decodedBlock.$type;
      console.log('Decoded block $type:', $type);
      switch ($type) {
        case BSKY_POST:
          /**
           * For posts we want to get the author and more data so we will use @atproto/api
           * for sake of simplicity.
           * 
           * We will use .getPost(params) to get the post data.
           * 
           * We need to parse the URI to extract the repo and rkey
           *
           * URI Schema: 
           * at://" AUTHORITY [ PATH ] [ "?" QUERY ] [ "#" FRAGMENT ]
           * 
           * Resource: https://atproto.com/specs/at-uri-scheme
           */
          
          //TODO:find a way to get the author
          const query = {
            repo: event.repo,
            rkey: event.rev
          }
          console.log('Querying post', query);
          console.log('Decoded post', decodedBlock);
          const post = await agent.getPost(query);
          console.log('Post:', post);
          return post;
        default:
          console.log('Not supported event type', $type);
          return null;
      }

    }
  } else if (header.op === -1) {
    // I might not ignore this, by for sake of simplicity I will ignore it
    console.log('Decoded error header:', header);
  } else {
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